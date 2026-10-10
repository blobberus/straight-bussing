#!/usr/bin/env python3
"""Health check and local fallback for the constant ground-truth collector. Runbook: monitoring.md.

  python tools/monitor.py status              # read-only; exit 0 HEALTHY, 1 DEGRADED, 2 DOWN
  python tools/monitor.py local [--hours H]   # also collect on this machine (0 = until stopped)
  python tools/monitor.py resume [--hours H]  # same, first merges what an interrupted session left
  python tools/monitor.py stop                # stop the local collector (graceful, then forced)
  python tools/monitor.py dispatch            # start a CI run now (GITHUB_TOKEN, or a logged-in gh CLI)

The local collector mirrors .github/workflows/collect.yml: overlapping truth_logger.py chunks seeded
from the data branch CSV, each merged with tools/merge_arrivals.py into a worktree of the 'data'
branch and pushed (re-merge + retry on races). Merging dedupes, so it is safe to run next to CI.
Files live in data/monitor/ (runs/ = not yet pushed, merged/ = pushed, state.json, monitor.log).
Stdlib only; Windows and Linux.
"""
import argparse, json, os, random, shutil, signal, subprocess, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = os.environ.get("SB_REPO", "blobberus/straight-bussing")
WORKFLOW = "collect.yml"
CSV = "data/ground_truth/arrivals.csv"
FEED = "https://passio3.com/chicago/passioTransit/gtfs/realtime/vehiclePositions.json"
RUN_S = 70 * 60                  # one CI run logs this long (collect.yml --duration 4200)
UA = "StraightBussing-monitor (student project)"
BRANCH = "monitor-data"          # local branch for the worktree; pushes go to <remote>/data


def github_token():
    """$GITHUB_TOKEN, else the logged-in gh CLI's token, else None (unauthenticated: 60 API calls/h, no dispatch)."""
    if os.environ.get("GITHUB_TOKEN"):
        return os.environ["GITHUB_TOKEN"]
    try:
        r = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=20)
        return (r.stdout.strip() or None) if r.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


class Ctx:
    def __init__(self, root=None, remote="origin"):
        self.root = Path(root or Path(__file__).resolve().parent.parent)
        self.remote = remote
        d = self.dir = self.root / "data" / "monitor"
        self.runs, self.merged, self.wt = d / "runs", d / "merged", d / "databranch"
        self.pid, self.state, self.log, self.seed, self.stop = (d / "monitor.pid", d / "state.json",
                                                               d / "monitor.log", d / "seed.csv", d / "STOP")


# ---------------------------------------------------------------- helpers
def ts(t=None):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t or time.time()))


def epoch(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def age(s):
    s = int(max(0, s))
    return f"{s}s" if s < 120 else f"{s // 60} min" if s < 7200 else f"{s / 3600:.1f} h"


def http(url, token=None, method="GET", data=None, headers=None, timeout=20):
    h = {"User-Agent": UA, **(headers or {})}
    if token and "api.github.com" in url:
        h["Authorization"] = "Bearer " + token
    if "api.github.com" in url:
        h["Accept"] = "application/vnd.github+json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    return urllib.request.urlopen(req, timeout=timeout)


def gh(path, token=None):
    with http("https://api.github.com" + path, token) as r:
        return json.loads(r.read().decode("utf-8"))


def git(ctx, *args, cwd=None, check=True):
    r = subprocess.run(["git", "-c", "core.autocrlf=false", *args], cwd=cwd or ctx.root,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode:
        raise RuntimeError(f"git {' '.join(args)}: {(r.stderr or r.stdout).strip()[:300]}")
    return r


def alive(pid):
    if not pid or pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        k = ctypes.windll.kernel32
        h = k.OpenProcess(0x1000, False, int(pid))          # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        code = ctypes.c_ulong()
        ok = k.GetExitCodeProcess(h, ctypes.byref(code))
        k.CloseHandle(h)
        return bool(ok) and code.value == 259                # STILL_ACTIVE
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def kill_tree(pid):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass


def read_pid(ctx):
    try:
        return int(ctx.pid.read_text().split()[0])
    except (OSError, ValueError, IndexError):
        return 0


def load_state(ctx):
    try:
        return json.loads(ctx.state.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(ctx, st):
    tmp = ctx.state.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1), encoding="utf-8")
    os.replace(tmp, ctx.state)


def has_rows(p):
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            return any(ln.strip() and not ln.startswith("epoch,") for ln in f)
    except OSError:
        return False


# ---------------------------------------------------------------- status
def parked(r, now):
    """True when a run's timestamps can't be its logging window: it waited in its concurrency slot behind
    another run (GitHub reports run_started_at = creation time) or its job ran far longer than a normal run."""
    s = epoch(r.get("run_started_at") or r["created_at"])
    if r["status"] == "in_progress":
        return now - s > RUN_S + 600
    return r["status"] == "completed" and r["conclusion"] == "success" and epoch(r["updated_at"]) - s > RUN_S + 600


def log_window(run_id, token, now):
    """(start, end) of the run's 'Log arrivals' step from the jobs API (end = now while it runs), or None."""
    try:
        for j in gh(f"/repos/{REPO}/actions/runs/{run_id}/jobs", token).get("jobs", []):
            for st in j.get("steps") or []:
                if str(st.get("name", "")).startswith("Log arrivals") and st.get("started_at"):
                    return epoch(st["started_at"]), epoch(st["completed_at"]) if st.get("completed_at") else now
    except Exception:
        pass
    return None


def coverage(runs, now, complete, window=86400):
    """-> (window_start, fraction covered, [(gap_start, gap_end)]) from successful/in-progress runs.
    A run with r["log_window"] = (start, end) (from log_window(), set for parked runs) uses it as is."""
    iv = []
    for r in runs:
        s = epoch(r.get("run_started_at") or r["created_at"])
        if r.get("log_window") and r["status"] in ("in_progress", "completed") and r.get("conclusion") in (None, "success"):
            iv.append(tuple(r["log_window"]))
            continue
        if r["status"] == "in_progress":
            e = min(now, s + RUN_S)
        elif r["status"] == "completed" and r["conclusion"] == "success":
            e = min(epoch(r["updated_at"]), s + RUN_S + 300)
        else:
            continue
        iv.append((s, e))
    start = now - window
    if runs and complete:                      # the whole history fits: start at the first run
        start = max(start, min(epoch(r.get("run_started_at") or r["created_at"]) for r in runs))
    covered, gaps, cur = 0.0, [], start
    for s, e in sorted(iv):
        s, e = max(s, start), min(e, now)
        if e <= cur:
            continue
        if s > cur:
            if s - cur > 120:
                gaps.append((cur, s))
            covered += e - s
        else:
            covered += e - cur
        cur = e
    if now - cur > 120:
        gaps.append((cur, now))
    span = now - start
    return start, (covered / span if span > 0 else 1.0), gaps


def data_branch(token):
    """-> dict(commit_age, msg, size, rows, rows_exact, newest) or None if the branch is missing."""
    try:
        b = gh(f"/repos/{REPO}/branches/data", token)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    c = b["commit"]["commit"]
    out = {"commit_age": time.time() - epoch(c["committer"]["date"]), "msg": c["message"].splitlines()[0]}
    try:
        with http(f"https://raw.githubusercontent.com/{REPO}/data/{CSV}", headers={"Range": "bytes=-65536"}) as r:
            body, cr = r.read().decode("utf-8", "replace"), r.headers.get("Content-Range") or ""
        size = int(cr.rsplit("/", 1)[1]) if "/" in cr else len(body.encode())
        lines = body.splitlines()
        exact = size <= 65536 or not cr
        if not exact:
            lines = lines[1:]
        rows = [ln for ln in lines if ln and not ln.startswith("epoch,")]
        eps = [int(ln.split(",", 1)[0]) for ln in rows if ln.split(",", 1)[0].isdigit()]
        avg = max(1, sum(len(ln) + 1 for ln in rows) / max(1, len(rows)))
        out.update(size=size, rows=len(rows) if exact else int(size / avg), rows_exact=exact,
                   newest=max(eps) if eps else None)
    except urllib.error.HTTPError as e:
        out.update(size=0, rows=0, rows_exact=True, newest=None, csv_error=f"http {e.code}")
    return out


def status(ctx, a):
    token, now, issues = github_token(), time.time(), []   # issues: (level, reason, action)
    DISPATCH = "python tools/monitor.py dispatch (or Actions tab -> Collect ground truth -> Run workflow)"
    print(f"Straight Bussing collector status  {ts(now)}  ({REPO})")
    wf = runs = None
    try:
        wf = gh(f"/repos/{REPO}/actions/workflows/{WORKFLOW}", token)
        d = gh(f"/repos/{REPO}/actions/workflows/{WORKFLOW}/runs?per_page=100", token)
        runs, total = d["workflow_runs"], d["total_count"]
    except Exception as e:
        issues.append((1, f"GitHub API unavailable ({e})", "retry later or set GITHUB_TOKEN (rate limit is 60/h)"))
    if wf:
        print(f"workflow  {WORKFLOW}: {wf['state']}")
        if wf["state"] != "active":
            issues.append((2, f"workflow is {wf['state']}", "Actions tab -> Collect ground truth -> Enable workflow, then dispatch"))
    if runs is not None:
        if not runs:
            reg = max(epoch(wf["created_at"]), epoch(wf["updated_at"])) if wf else now
            lvl = 2 if now - reg > 3 * 3600 else 1
            print(f"runs      none yet (workflow registered {age(now - reg)} ago)")
            issues.append((lvl, "no scheduled run has fired yet", DISPATCH))
        else:
            last = epoch(runs[0].get("run_started_at") or runs[0]["created_at"])
            print(f"runs      {total} total, newest started {age(now - last)} ago")
            for r in runs[:a.n]:
                s = epoch(r.get("run_started_at") or r["created_at"])
                print(f"  {ts(s)[:16]}  {r['event']:<17} {r['status']:<11} {r['conclusion'] or '':<9} {r['html_url']}")
            if now - last > 2 * 3600:
                issues.append((2, f"no run started for {age(now - last)}", DISPATCH + "; if it keeps happening, take over locally"))
            elif now - last > 50 * 60:
                issues.append((1, f"no run started for {age(now - last)} (self-chained runs start about every 40 min)",
                               DISPATCH))
            done = [r for r in runs if r["status"] == "completed"]
            if len(done) >= 3 and all(r["conclusion"] == "failure" for r in done[:3]):
                issues.append((2, "the last 3 runs failed", "read the failing step log (see monitoring.md 'Runs failing')"))
            elif any(r["conclusion"] == "failure" and now - epoch(r["created_at"]) < 86400 for r in done):
                issues.append((1, "a run failed in the last 24 h", "read its log (monitoring.md 'Runs failing')"))
            for r in [r for r in runs if now - epoch(r["created_at"]) < 86400 + 2 * RUN_S and parked(r, now)][:12]:
                r["log_window"] = log_window(r["id"], token, now)   # a few per day; bounded API use
            start, frac, gaps = coverage(runs, now, total <= len(runs))
            print(f"coverage  {frac:.0%} of the time since {ts(start)[:16]} (approx; successful + running runs)")
            for g0, g1 in gaps[-5:]:
                print(f"  gap {ts(g0)[11:16]} - {ts(g1)[11:16]} ({age(g1 - g0)})")
            if now - start > 2 * 3600 and frac < 0.95:
                issues.append((1, f"coverage {frac:.0%} < 95%", "check failures/gaps above; consider python tools/monitor.py local"))
    vehicles = None
    try:
        with http(FEED + f"?_={int(now)}", timeout=15) as r:
            f = json.loads(r.read().decode("utf-8"))
        vehicles = len(f.get("entity", []))
        fa = now - (f.get("header", {}).get("timestamp") or now)
        print(f"feed      Passio: {vehicles} vehicles, feed {age(fa)} old")
    except Exception as e:
        print(f"feed      Passio unreachable: {e}")
        issues.append((1, "Passio feed unreachable (nothing to collect)", "wait; check https://passio3.com is up"))
    try:
        db = data_branch(token)
        if db is None:
            print("data      no 'data' branch yet (created by the first run that sees buses)")
            if runs and any(r["conclusion"] == "success" for r in runs) and vehicles:
                issues.append((1, "buses are running but no data branch exists", "read the last run's 'Merge' step log"))
        else:
            nw = f", newest arrival {ts(db['newest'])[:16]} ({age(now - db['newest'])} ago)" if db.get("newest") else ""
            print(f"data      last commit {age(db['commit_age'])} ago ({db['msg']}); arrivals.csv "
                  f"{db['size'] / 1e6:.2f} MB, {'' if db['rows_exact'] else '~'}{db['rows']:,} rows{nw}")
            if vehicles and db.get("newest") and now - db["newest"] > 3 * 3600:
                issues.append((1, "buses are running but no new arrivals merged for 3 h", "read the last runs' logs"))
    except Exception as e:
        print(f"data      could not read the data branch: {e}")
    pid, st = read_pid(ctx), load_state(ctx)
    left = sorted(ctx.runs.glob("run-*.csv")) if ctx.runs.exists() else []
    if alive(pid):
        print(f"local     RUNNING pid {pid}; {st.get('files_merged', 0)} files merged, {st.get('rows_added', 0)} rows added, "
              f"last push {ts(st['last_publish'])[:16] if st.get('last_publish') else 'none yet'}"
              f"{'; last error: ' + st['last_error'] if st.get('last_error') else ''}")
    else:
        print(f"local     not running{'; ' + str(len(left)) + ' unmerged run file(s)' if left else ''}")
        if left:
            issues.append((1, f"{len(left)} local run file(s) were never pushed", "python tools/monitor.py resume --hours 0.01"))
    level = max([i[0] for i in issues], default=0)
    print(f"VERDICT   {['HEALTHY', 'DEGRADED', 'DOWN'][level]}")
    for lvl, why, act in sorted(issues, key=lambda i: -i[0]):
        print(f"  [{['ok', 'warn', 'DOWN'][lvl]}] {why}\n         -> {act}")
    if not issues:
        print("  nothing to do")
    return level


# ---------------------------------------------------------------- local collector
def log(ctx, msg):
    line = f"{ts()} {msg}"
    print(line, flush=True)
    with open(ctx.log, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def remote_has_data(ctx):
    return git(ctx, "ls-remote", "--exit-code", "--heads", ctx.remote, "data", check=False).returncode == 0


def fetch_data(ctx):
    git(ctx, "fetch", "--no-tags", "-q", ctx.remote, f"+refs/heads/data:refs/remotes/{ctx.remote}/data")


def refresh_seed(ctx):
    try:
        if remote_has_data(ctx):
            fetch_data(ctx)
            with open(ctx.seed, "wb") as f:
                subprocess.run(["git", "show", f"{ctx.remote}/data:{CSV}"], cwd=ctx.root, stdout=f,
                               stderr=subprocess.DEVNULL)
        elif not ctx.seed.exists():
            ctx.seed.write_text("", encoding="utf-8")
    except Exception as e:
        log(ctx, f"seed refresh failed (keeping the old seed): {e}")


def _rmtree(path):
    """shutil.rmtree that also clears Windows read-only flags (some PCs mark every folder read-only)."""
    def clear_and_retry(func, p, _exc):
        os.chmod(p, 0o700)
        func(p)
    shutil.rmtree(path, onerror=clear_and_retry)


def prepare_worktree(ctx):
    if ctx.wt.exists():
        git(ctx, "worktree", "remove", "--force", str(ctx.wt), check=False)
        if ctx.wt.exists():
            _rmtree(ctx.wt)
    meta = ctx.root / ".git" / "worktrees" / ctx.wt.name   # git can't prune it when it is read-only
    if meta.exists():
        _rmtree(meta)
    git(ctx, "worktree", "prune")
    git(ctx, "branch", "-D", BRANCH, check=False)
    if remote_has_data(ctx):
        fetch_data(ctx)
        git(ctx, "worktree", "add", "-f", "-B", BRANCH, str(ctx.wt), f"{ctx.remote}/data")
        return
    if git(ctx, "worktree", "add", "--orphan", "-b", BRANCH, str(ctx.wt), check=False).returncode:
        git(ctx, "worktree", "add", "--detach", str(ctx.wt))
        git(ctx, "checkout", "--orphan", BRANCH, cwd=ctx.wt)
        git(ctx, "rm", "-rfq", ".", cwd=ctx.wt, check=False)
    (ctx.wt / "README.md").write_text("# data branch\nAutomated ground-truth data. See docs/DATA.md on main.\n",
                                      encoding="utf-8")


def _push(ctx):
    """Push the worktree's commit to <remote>/data. Separate function so tests can inject a race."""
    return git(ctx, "push", "-q", ctx.remote, "HEAD:refs/heads/data", cwd=ctx.wt, check=False).returncode == 0


def publish(ctx, files, model=True):
    """Merge run files into the data branch and push. -> (ok, rows_added, message)."""
    files = [f for f in files if has_rows(f)]
    if not files:
        return True, 0, "no rows"
    ident = [] if git(ctx, "config", "user.email", check=False).stdout.strip() else \
        ["-c", "user.name=straight-bussing-monitor", "-c", "user.email=monitor@localhost"]
    last = ""
    for attempt in range(1, 6):
        try:
            prepare_worktree(ctx)
            into, added = ctx.wt / CSV, 0
            for f in files:
                r = subprocess.run([sys.executable, str(ctx.root / "tools" / "merge_arrivals.py"), "--into", str(into),
                                    "--add", str(f), "--rotate-mb", "40"], capture_output=True, text=True, cwd=ctx.root)
                if r.returncode:
                    raise RuntimeError("merge_arrivals failed: " + (r.stderr or r.stdout)[-300:])
                for tok in r.stdout.split():
                    if tok.startswith("added="):
                        added += int(tok[6:])
            rm = ctx.root / "tools" / "refresh_model.py"
            if model and rm.exists():
                subprocess.run([sys.executable, str(rm), "--data", str(into), "--out", str(ctx.wt / "web/data/learned.json")],
                               capture_output=True, cwd=ctx.root)
            git(ctx, "add", "-A", "data", cwd=ctx.wt)
            for extra in ("README.md", "web/data/learned.json"):
                if (ctx.wt / extra).exists():
                    git(ctx, "add", extra, cwd=ctx.wt)
            if git(ctx, "diff", "--cached", "--quiet", cwd=ctx.wt, check=False).returncode == 0:
                return True, 0, "nothing new (all duplicates)"
            git(ctx, *ident, "commit", "-qm", f"data: arrivals {datetime.now(timezone.utc):%Y-%m-%dT%H:%MZ} "
                f"(local monitor, {len(files)} file(s))", cwd=ctx.wt)
            if _push(ctx):
                return True, added, f"pushed +{added} rows (attempt {attempt})"
            last = f"push rejected (attempt {attempt})"
        except Exception as e:
            last = f"attempt {attempt}: {e}"
        log(ctx, last + "; re-merging on top of the remote")
        time.sleep(min(30, random.uniform(2, 6) * attempt))
    return False, 0, "gave up after 5 attempts: " + last


def publish_pending(ctx, st, active, model):
    busy = {str(p) for p in active}
    files = [f for f in sorted(ctx.runs.glob("run-*.csv")) if str(f) not in busy]
    if not files:
        return
    ok, added, msg = publish(ctx, files, model)
    log(ctx, f"publish {len(files)} file(s): {msg}")
    if ok:
        for f in files:
            os.replace(f, ctx.merged / f.name)
        st["files_merged"] = st.get("files_merged", 0) + len(files)
        st["rows_added"] = st.get("rows_added", 0) + added
        st["last_publish"], st["last_error"] = time.time(), ""
    else:
        st["last_error"] = msg
    for old in ctx.merged.glob("run-*.csv"):                  # keep a week of pushed runs for audit
        if time.time() - old.stat().st_mtime > 7 * 86400:
            old.unlink(missing_ok=True)
    save_state(ctx, st)


def lock(ctx):
    for _ in range(2):
        try:
            fd = os.open(ctx.pid, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{os.getpid()} {ts()}\n".encode())
            os.close(fd)
            return True
        except FileExistsError:
            if alive(read_pid(ctx)):
                return False
            ctx.pid.unlink(missing_ok=True)                   # stale: previous session died
    return False


def local(ctx, a, resume=False):
    for d in (ctx.dir, ctx.runs, ctx.merged):
        d.mkdir(parents=True, exist_ok=True)
    if not lock(ctx):
        print(f"already running (pid {read_pid(ctx)}); nothing to do")
        return 0
    stopping = []
    for sig in ("SIGINT", "SIGTERM", "SIGBREAK"):
        if hasattr(signal, sig):
            signal.signal(getattr(signal, sig), lambda *_: stopping.append(1))
    ctx.stop.unlink(missing_ok=True)
    st = load_state(ctx)
    prev = st.get("stopped_at"), st.get("pid")
    st.update(pid=os.getpid(), started=time.time(), stopped_at=None, hours=a.hours, chunk_min=a.chunk_min)
    save_state(ctx, st)
    left = sorted(ctx.runs.glob("run-*.csv"))
    clean = prev[0] is not None or not prev[1]
    log(ctx, f"local collector start (pid {os.getpid()}, remote {ctx.remote}, chunks {a.chunk_min} min, "
             f"{'until stopped' if a.hours <= 0 else str(a.hours) + ' h'})")
    if resume or left:
        log(ctx, f"recovering: {len(left)} unmerged run file(s) "
                 f"({', '.join(f.name for f in left) or 'none'}); last session "
                 f"{'ended cleanly' if clean else 'was interrupted'}; totals so far {st.get('files_merged', 0)} files, "
                 f"{st.get('rows_added', 0)} rows")
    publish_pending(ctx, st, [], not a.no_model)
    D = a.chunk_min * 60
    overlap = min(120.0, max(D * 0.1, 1.5 * a.interval), D / 2)   # truth_logger stops up to one poll early
    end = time.time() + a.hours * 3600 if a.hours > 0 else None
    active, next_start, beat = [], time.time(), 0
    try:
        while True:
            now = time.time()
            if ctx.stop.exists():
                stopping.append(1)
            if not stopping and now >= next_start and (end is None or now < end - 2):
                dur = D if end is None else min(D, end - now)
                path = ctx.runs / f"run-{datetime.now():%Y%m%d-%H%M%S}.csv"
                refresh_seed(ctx)
                logf = open(ctx.dir / "logger.log", "ab")
                p = subprocess.Popen([sys.executable, str(ctx.root / "tools" / "truth_logger.py"), "--duration",
                                      f"{dur:.0f}", "--seed", str(ctx.seed), "--out", str(path),
                                      "--interval", str(a.interval)], cwd=ctx.root, stdout=logf, stderr=subprocess.STDOUT)
                logf.close()
                active.append((p, path))
                next_start = now + max(1.0, dur - overlap)
                st["chunks_started"] = st.get("chunks_started", 0) + 1
                log(ctx, f"chunk {st['chunks_started']} started: {path.name} for {dur:.0f} s (logger pid {p.pid})")
            if stopping:
                for p, _ in active:
                    p.terminate()
                    p.wait(timeout=30)
            if any(p.poll() is not None for p, _ in active):
                active = [x for x in active if x[0].poll() is None]
                publish_pending(ctx, st, [x[1] for x in active], not a.no_model)
            if not active and (stopping or (end is not None and time.time() >= end - 2)):
                break
            if now - beat > 60:
                st["heartbeat"], st["active"], beat = now, [[x[0].pid, x[1].name] for x in active], now
                save_state(ctx, st)
            time.sleep(min(5.0, max(0.5, D / 8)))
        publish_pending(ctx, st, [], not a.no_model)
    finally:
        for p, _ in active:
            if p.poll() is None:
                p.kill()
        st.update(stopped_at=time.time(), active=[])
        save_state(ctx, st)
        ctx.pid.unlink(missing_ok=True)
        ctx.stop.unlink(missing_ok=True)
        log(ctx, f"local collector stopped; totals {st.get('files_merged', 0)} files, {st.get('rows_added', 0)} rows; "
                 f"unmerged left: {len(list(ctx.runs.glob('run-*.csv')))}")
    return 0


def stop(ctx, a):
    pid = read_pid(ctx)
    if not alive(pid):
        print("local collector is not running" + (" (removed a stale pid file)" if ctx.pid.exists() else ""))
        ctx.pid.unlink(missing_ok=True)
        return 0
    ctx.stop.write_text(ts(), encoding="utf-8")
    t_end = time.time() + a.wait
    while time.time() < t_end and alive(pid):
        time.sleep(1)
    if alive(pid):
        kill_tree(pid)
        for cp, _ in load_state(ctx).get("active") or []:
            if alive(cp):
                kill_tree(cp)
        ctx.pid.unlink(missing_ok=True)
        print(f"forced stop of pid {pid}; unmerged files stay in data/monitor/runs/ for 'resume'")
    else:
        print(f"stopped pid {pid} cleanly")
    return 0


def dispatch(ctx, a):
    token = github_token()
    steps = (f"Manual: open https://github.com/{REPO}/actions/workflows/{WORKFLOW} -> 'Run workflow' -> "
             "branch main -> Run workflow.")
    if not token:
        print("GITHUB_TOKEN not set and gh CLI not logged in. " + steps)
        return 1
    try:
        with http(f"https://api.github.com/repos/{REPO}/actions/workflows/{WORKFLOW}/dispatches", token, "POST",
                  json.dumps({"ref": "main"}).encode(), {"Content-Type": "application/json"}) as r:
            print(f"dispatched ({r.status}); check with: python tools/monitor.py status")
            return 0
    except Exception as e:
        print(f"dispatch failed: {e}. {steps}")
        return 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["status", "local", "resume", "stop", "dispatch"])
    ap.add_argument("--hours", type=float, default=0, help="local/resume: run this long (0 = until stopped)")
    ap.add_argument("--chunk-min", type=float, default=30, help="local: minutes per logger chunk")
    ap.add_argument("--interval", type=float, default=10, help="local: seconds between polls")
    ap.add_argument("--remote", default="origin", help="git remote holding the data branch")
    ap.add_argument("--no-model", action="store_true", help="local: skip refresh_model.py")
    ap.add_argument("-n", type=int, default=8, help="status: runs to list")
    ap.add_argument("--wait", type=float, default=90, help="stop: seconds to wait before forcing")
    a = ap.parse_args()
    ctx = Ctx(remote=a.remote)
    if a.cmd == "status":
        return status(ctx, a)
    if a.cmd in ("local", "resume"):
        return local(ctx, a, resume=a.cmd == "resume")
    return {"stop": stop, "dispatch": dispatch}[a.cmd](ctx, a)


if __name__ == "__main__":
    sys.exit(main())

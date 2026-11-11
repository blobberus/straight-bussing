#!/usr/bin/env python3
"""Collector health: find collection problems automatically and tell the owner, so a failure is never silent.

  python tools/health.py code --code main|fallback|broken [--detail selftest.txt]   # every run, after the pre-flight
  python tools/health.py run --status logger.json --log-outcome success --merge-outcome success --code main
  python tools/health.py data --dir databranch/data/ground_truth          # the collected rows of the last days
  python tools/health.py archive                                          # the daily archive's release assets
  python tools/health.py report --source NAME [--problem KEY=TEXT ...]    # any other job (none = all clear)
  python tools/health.py watchdog --src-data CLONE                        # from ANOTHER repo's job (the data repo's sync)
  add --dry-run to print what would be done, --no-issue to only print and annotate

Why (risk review 2026-11-01, docs/DATA-COLLECTION-LOG.md DC-021): every collect run stays green on purpose (rows found
so far are always merged), so a run that logged nothing, a feed outage (Oct 28, 7:31 to 8:11 PM: every read timed out,
no arrival logged, nobody told), a broken push to main or a missing archive day was only found when someone ran
monitoring.md by hand.

Each command checks one SOURCE (code, run, data, archive, or a name given to report) and keeps ONE GitHub issue, labeled
collector-health, in step: it opens (or reopens) the issue when a new problem appears, edits the list while problems
last (edits send no e-mail), comments only when a new kind of problem appears, and closes the issue with a comment once
every source is clear. A problem already announced is not announced again while the issue is closed by hand (it is
announced again after 14 days if it is still there). State lives in a hidden marker at the end of the issue body.
The issue is opened in the repository the job runs in (GITHUB_REPOSITORY) with the job's GH_TOKEN (permission
issues: write). Repo variable HEALTH_ISSUES=off = annotations and job summaries only. A health problem never fails a
run: this script always exits 0 (`run` writes healthy=true|false to $GITHUB_OUTPUT for the collector-ok tag).
Stdlib + the gh CLI. Tests: tools/test_health.py.
"""
import argparse, csv, json, os, re, statistics, subprocess, sys, time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L
import service_gate as G

ROOT = Path(__file__).resolve().parent.parent
LABEL = "collector-health"
TITLE = "Collector health: problems found"
OWNER = "blobberus"
MARK = re.compile(r"<!-- sb-health: (\{.*\}) -->", re.S)
TOLD_KEEP_S = 14 * 86400          # a problem still there after this long is announced again
SLOT_S = 600                      # gap check: 10-minute slots of the service day
BUSY = 0.9                        # a slot is "normally busy" when this share of reference days had an arrival in it
GAP_SLOTS = 2                     # this many busy slots in a row with no arrival = a collection gap (20 min)
VOLUME = 0.6                      # a day with fewer arrivals than this share of its usual count
ROUTE_LOW, ROUTE_MIN = 0.2, 100   # a route under this share of its usual count (routes that usually log >= ROUTE_MIN)
PRED_LOW = 0.5                    # share of (non-gps) arrivals that carry Passio's prediction (usual 80 to 95%)
OUTAGE_S = 900                    # a run that could not read the vehicle feed this long
FIRST_ARCHIVE_DAY = "2026-10-12"  # the first day archived with prediction updates
ARCHIVE_KINDS = ("raw-polls", "pred-updates", "eta", "gtfs")
ARCHIVE_EXTRA = {"alerts": "2026-10-14", "bus-changes": "2026-10-30"}  # archived from these days on; archive_day.py
                                  # skips them quietly when they fail, so a missing one is only seen here (DC-026)
ARTIFACT_DAYS = 85                # run artifacts live 90 days: older days can no longer be archived


# ------------------------------------------------------------------ helpers
def ct(epoch):
    return L.chicago(epoch)


def clock(epoch):
    return ct(epoch).strftime("%I:%M %p").lstrip("0")


def day_label(d):
    return f"{d:%a %b} {d.day}"


def service_day(epoch):
    return (ct(epoch) - timedelta(hours=4)).date()


def day_start(d):
    """04:00 Chicago on service day d (epoch)."""
    return int(datetime(d.year, d.month, d.day, 4, tzinfo=G.CT).timestamp())


def day_type(d):
    return "weekday" if d.weekday() < 5 else ("Saturday" if d.weekday() == 5 else "Sunday")


def regime(d, calendar=None):
    """The academic calendar's regime for date d ('class', 'break', 'holiday', ... or '')."""
    cal = calendar if calendar is not None else load_json(ROOT / "data" / "calendar.json") or {}
    for r in cal.get("regimes") or []:
        if r.get("start", "") <= d.isoformat() <= r.get("end", ""):
            return r.get("regime", "")
    return ""


def load_json(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def annotate(level, title, msg):
    if os.environ.get("GITHUB_ACTIONS"):
        esc = lambda m: m.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::{level} title={esc(title)}::{esc(msg)}")


def summary(lines):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path and lines:
        with open(path, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n\n")


def run_url():
    repo, rid = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_RUN_ID")
    return f"https://github.com/{repo}/actions/runs/{rid}" if repo and rid else "this run"


# ------------------------------------------------------------------ the checks
def check_code(code, detail=""):
    """The pre-flight self-test's verdict (collect.yml, every run) -> problems."""
    url = run_url()
    if code == "fallback":
        return {"code:fallback": (f"main's collector code failed its pre-flight self-test, so runs collect with the last good "
                                  f"code (git tag collector-ok) until main is fixed ({url}). Fix: run `python "
                                  f"tools/collector_selftest.py`. Self-test said: {detail[-400:] or 'see the run log'}")}
    if code == "broken":
        return {"code:broken": (f"No working collector code: main's code and the collector-ok tag both failed the self-test, "
                                f"so runs try main's code anyway ({url}). Self-test said: {detail[-400:] or 'see the run log'}")}
    return {}


def check_run(status, log_outcome="success", merge_outcome="success", code="main", guard=""):
    """One collect run -> (problems {key: text}, healthy). healthy = this run proved main's collector code works (it is
    then fit to become the collector-ok tag): main's code, a status file, enough polls, the feed readable, no format
    errors, few processing errors, rows logged whenever buses were seen, the merge pushed. guard = what
    tools/check_merge.py found when it stopped the push (empty = it did not)."""
    url, today = run_url(), service_day(time.time()).isoformat()
    p = {}
    s = status
    if s is None:
        p["run:crash"] = f"The logger wrote no status file: it crashed or was killed ({url}). Rows found before that are merged."
    else:
        polls, fails = int(s.get("polls") or 0), int(s.get("fetch_errors") or 0)
        if polls == 0:
            p["run:crash"] = f"The logger made no poll at all ({url}): {s.get('first_error') or 'no error recorded'}."
        if int(s.get("max_fail_s") or 0) >= OUTAGE_S:
            spans = [x for x in s.get("fail_spans") or [] if x[1] - x[0] >= OUTAGE_S] or (s.get("fail_spans") or [])[-1:]
            when = "; ".join(f"{clock(a)} to {clock(b)}" for a, b in spans) or "during the run"
            p[f"run:outage:{today}"] = (f"Passio's vehicle feed could not be read for {int(s['max_fail_s']) // 60} min ({when}, "
                                        f"Chicago): no arrivals were logged then ({fails} failed reads, {url}). Usually "
                                        "Passio's side; nothing to fix unless it repeats.")
        if int(s.get("schema_errors") or 0) > 10:
            p["run:schema"] = (f"Passio's feed came in an unexpected shape in {s['schema_errors']} reads: {s.get('schema_first')}. "
                               "Buses may read as missing; check tools/truth_logger.py reports() against the feed.")
        if int(s.get("bus_polls") or 0) >= 180 and int(s.get("rows") or 0) == 0:
            p["run:norows"] = (f"Buses were in the feed for {s['bus_polls']} polls but the run logged no arrival ({url}): the "
                               "detector or the stop data (web/data) may be broken.")
        if int(s.get("errors") or 0) > 100:
            p["run:errors"] = f"{s['errors']} processing errors in one run; first: {s.get('first_error')} ({url})."
    if guard:
        p["run:guard"] = (f"The no-rows-lost guard (tools/check_merge.py) stopped this run's push, so the data branch is "
                          f"unchanged: {guard[-400:]}. The run's own rows are kept as the artifact unmerged-<run> for 90 days "
                          f"({url}); fix the merge, then merge them by hand (monitoring.md).")
    elif merge_outcome not in ("success", "skipped", ""):
        p["run:push"] = (f"The run could not merge or push its rows to the data branch ({url}): about 10 min of arrivals that "
                         "no overlapping run logged are lost; its rows are kept as the artifact unmerged-<run>. If it "
                         "repeats, see monitoring.md (push failed).")
    healthy = (code == "main" and s is not None and log_outcome == "success" and merge_outcome == "success"
               and int(s.get("polls") or 0) >= 30 and int(s.get("fetch_errors") or 0) < int(s.get("polls") or 0)
               and int(s.get("schema_errors") or 0) == 0 and int(s.get("errors") or 0) <= 100
               and not (int(s.get("bus_polls") or 0) >= 60 and int(s.get("rows") or 0) == 0))
    return p, healthy


def read_rows(gt_dir, since):
    """arrivals.csv plus its archive/ files -> list of (epoch, route_name, vehicle, stop, source, has_pred, fields_ok)
    for rows at or after `since`. Files that end before `since` are skipped by their name's date when possible."""
    gt = Path(gt_dir)
    files = sorted((gt / "archive").glob("arrivals-*.csv")) + [gt / "arrivals.csv"]
    out = []
    for f in files:
        if not f.exists():
            continue
        with open(f, encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                try:
                    e = int(r["epoch"])
                except (KeyError, TypeError, ValueError):
                    continue
                if e < since:
                    continue
                out.append((e, r.get("route_name") or r.get("route_id") or "?", r.get("vehicle_id") or "",
                            r.get("stop_id") or "", r.get("source") or "", bool(r.get("passio_pred_epoch")),
                            bool(r.get("vehicle_id") and r.get("stop_id") and r.get("route_id"))))
    return out


def check_data(rows, now, days_back=2, refs_days=28, calendar=None):
    """Collected rows -> problems {key: text} for the last `days_back` finished service days, and today's slots that
    should have merged by now (a run merges at its end, so only up to 80 min ago)."""
    by_day = defaultdict(list)
    for r in rows:
        by_day[service_day(r[0])].append(r)
    per_route = {x: Counter(r[1] for r in rs) for x, rs in by_day.items()}
    if calendar is None:
        calendar = load_json(ROOT / "data" / "calendar.json") or {}
    today = service_day(now)
    p = {}
    for k in range(days_back, -1, -1):
        d = today - timedelta(days=k)
        reg = regime(d, calendar)
        if reg in ("break", "holiday"):
            continue                            # reduced service is normal then; the checks would cry wolf
        refs = [today - timedelta(days=j) for j in range(k + 1, k + 1 + refs_days)]
        refs = [x for x in refs if day_type(x) == day_type(d) and by_day.get(x) and regime(x, calendar) not in ("break", "holiday")]
        mine = by_day.get(d, [])
        finished = k > 0
        if len(refs) >= 3:
            # gaps: normally busy 10-minute slots with no arrival on any route
            busy_share = Counter()
            for x in refs:
                busy_share.update({int((e - day_start(x)) // SLOT_S) for e, *_ in by_day[x]})
            busy = sorted(s for s, n in busy_share.items() if n >= BUSY * len(refs))
            have = {int((e - day_start(d)) // SLOT_S) for e, *_ in mine}
            upto = (now - 80 * 60 - day_start(d)) // SLOT_S      # a run merges at its end: newer slots may still come
            missing = [s for s in busy if s < upto and s not in have]
            run, gaps = [], []
            for s in missing:
                if run and s == run[-1] + 1:
                    run.append(s)
                    continue
                if len(run) >= GAP_SLOTS:
                    gaps.append((run[0], run[-1]))
                run = [s]
            if len(run) >= GAP_SLOTS:
                gaps.append((run[0], run[-1]))
            if gaps:
                txt = ", ".join(f"{clock(day_start(d) + a * SLOT_S)} to {clock(day_start(d) + (b + 1) * SLOT_S)}" for a, b in gaps)
                p[f"data:gap:{d}"] = (f"No arrival on any route {txt} on {day_label(d)} (Chicago), hours that normally always have "
                                      "arrivals: a collection gap (feed outage, chain stopped, or every run failed).")
            if finished:
                counts = [len(by_day[x]) for x in refs]
                med = statistics.median(counts)
                if len(mine) < VOLUME * med:
                    p[f"data:volume:{d}"] = (f"Only {len(mine):,} arrivals were logged on {day_label(d)} (a {day_type(d)} usually has "
                                             f"about {med:,.0f}).")
                got = per_route.get(d, Counter())
                for name in sorted({n for x in refs for n in per_route[x]}):
                    m = statistics.median(per_route[x].get(name, 0) for x in refs)
                    if m >= ROUTE_MIN and got.get(name, 0) < ROUTE_LOW * m:
                        p[f"data:route:{d}:{name}"] = (f"{name} logged {got.get(name, 0)} arrivals on {day_label(d)} (usually about "
                                                       f"{m:,.0f}). If it did not run (check the operator's alerts), nothing to fix.")
        if finished and mine:
            bad = sum(1 for r in mine if not r[6])
            if bad:
                p[f"data:fields:{d}"] = f"{bad} rows of {day_label(d)} lack the stop, bus or route id."
            seen, dup = {}, 0
            for e, _, veh, stop, *_ in sorted(mine):
                last = seen.get((veh, stop))
                if last is not None and e - last <= 300:
                    dup += 1
                seen[(veh, stop)] = e
            if dup:
                p[f"data:dups:{d}"] = (f"{dup} duplicate arrivals on {day_label(d)} (same bus and stop within 300 s): "
                                       "tools/merge_arrivals.py should have removed them.")
            rule = [r for r in mine if r[4] != "gps"]
            if len(rule) >= 500:
                share = sum(1 for r in rule if r[5]) / len(rule)
                if share < PRED_LOW:
                    p[f"data:pred:{d}"] = (f"Only {share:.0%} of {day_label(d)}'s arrivals carry Passio's prediction (usually 80 to "
                                           "95%): the prediction logging may be broken, or Passio published few times.")
    return p


def archive_kinds(d):
    """The asset kinds a finished service day d should have on its release."""
    return ARCHIVE_KINDS + tuple(k for k, since in ARCHIVE_EXTRA.items() if d.isoformat() >= since)


def check_archive(assets, now):
    """assets: set of release asset names -> problems: finished days (up to the artifacts' lifetime) whose archive files
    are missing. A day is due once the next day's archive run (about 5:41 AM) has had a day of slack."""
    today = service_day(now)
    first = max(date.fromisoformat(FIRST_ARCHIVE_DAY), today - timedelta(days=ARTIFACT_DAYS))
    missing = []
    d = first
    while d <= today - timedelta(days=2):
        lack = [k for k in archive_kinds(d) if not any(a.startswith(f"{k}-{d}") for a in assets)]
        if lack:
            missing.append(f"{d} ({', '.join(lack)})")
        d += timedelta(days=1)
    if not missing:
        return {}
    left = min(date.fromisoformat(m[:10]) for m in missing) + timedelta(days=90) - today
    return {"archive:missing": (f"The daily archive lacks files for {len(missing)} day(s): {'; '.join(missing[:8])}"
                                f"{' ...' if len(missing) > 8 else ''}. The raw run artifacts expire 90 days after each "
                                f"day (the oldest in about {left.days} days): run the Archive workflow (archive.yml) "
                                "before then.")}


def check_watchdog(buses, newest, now, collecting, idle_only=False):
    """The collector seen from outside (the public data repo's sync chain, which runs on its own schedule, so it still
    runs when the collector's self-chain and its cron backstop have both stopped). buses = live buses Passio reports
    now; newest = epoch of the newest arrival on the data branch; collecting = a collect.yml run is logging now.
    -> problems. Quiet while no bus runs (nothing to log) and while a run is collecting."""
    if buses <= 0:
        return {}
    age = (now - newest) / 60 if newest else 10 ** 6
    restart = ("Restart it: Actions > Collect ground truth > Run workflow (slot a, mode collect), or `python tools/monitor.py "
               "dispatch` (monitoring.md); a repository secret COLLECT_DISPATCH_TOKEN in the data repo (a fine-grained token "
               "with Actions: read and write on the app repo) lets this watchdog restart it by itself.")
    newest_txt = f"the newest arrival is {age:.0f} min old" if newest else "no arrival on the data branch"
    if not collecting and age > 45:
        what = "only an idle run is active" if idle_only else "no collect run is active"
        return {"watchdog:stopped": f"{buses} bus(es) are running but {what} and {newest_txt}: the collector looks stopped. {restart}"}
    # No "nothing merged for 3 h while collecting" rule (it fired at every service start after a quiet night or weekend
    # morning, 2026-11-01 4:00 PM): a run that logs or pushes nothing is reported by the run itself (health.py run).
    return {}


def newest_arrival(gt_dir):
    """Epoch of the newest row in arrivals.csv (or, right after a rotation, the newest archive file)."""
    gt = Path(gt_dir)
    for f in [gt / "arrivals.csv"] + sorted((gt / "archive").glob("arrivals-*.csv"), reverse=True):
        rows = L.read_tail(f, 200_000) if f.exists() else []
        eps = [int(r["epoch"]) for r in rows if str(r.get("epoch", "")).isdigit()]
        if eps:
            return max(eps)
    return None


# ------------------------------------------------------------------ the issue
class GhIssues:
    """The few gh calls the issue needs; tests pass a fake with the same methods."""

    def __init__(self, repo):
        self.repo = repo

    def _gh(self, *args, input=None):
        r = subprocess.run(["gh", *args, "-R", self.repo], capture_output=True, text=True, timeout=60, input=input)
        if r.returncode:
            raise RuntimeError(f"gh {' '.join(args[:2])}: {(r.stderr or r.stdout).strip()[:300]}")
        return r.stdout

    def find(self):
        out = self._gh("issue", "list", "--label", LABEL, "--state", "all", "--limit", "5", "--json", "number,state,body")
        items = sorted(json.loads(out or "[]"), key=lambda i: -int(i["number"]))
        return items[0] if items else None

    def create(self, body):
        try:
            self._gh("label", "create", LABEL, "--color", "B60205", "--description", "Automatic data collection alerts")
        except RuntimeError:
            pass                                 # already there
        out = self._gh("issue", "create", "--title", TITLE, "--label", LABEL, "--body-file", "-", input=body)
        return out.strip()

    def edit(self, number, body):
        self._gh("issue", "edit", str(number), "--body-file", "-", input=body)

    def comment(self, number, text):
        self._gh("issue", "comment", str(number), "--body-file", "-", input=text)

    def reopen(self, number):
        self._gh("issue", "reopen", str(number))

    def close(self, number):
        self._gh("issue", "close", str(number))


def parse_state(body):
    m = MARK.search(body or "")
    try:
        st = json.loads(m.group(1)) if m else {}
    except ValueError:
        st = {}
    st.setdefault("sources", {})
    st.setdefault("told", {})
    return st


def render(state, now):
    rows = [(src, k, v) for src, ps in sorted(state["sources"].items()) for k, v in sorted(ps.items(), key=lambda x: x[1]["since"])]
    when = ct(now).strftime("%b %d, %I:%M %p")
    head = (f"Automatic health report of the ground-truth collector for @{OWNER} (written by tools/health.py; runbook "
            "monitoring.md; log docs/DATA-COLLECTION-LOG.md).\n\n")
    if rows:
        body = head + f"**{len(rows)} open problem(s)** (updated {when} Chicago):\n\n"
        body += "".join(f"- **{src}** (since {ct(v['since']).strftime('%b %d %I:%M %p')}): {v['text']}\n" for src, k, v in rows)
    else:
        body = head + f"**All clear** (checked {when} Chicago). This issue reopens by itself if a new problem appears.\n"
    body += ("\nThis issue is kept up to date automatically: it closes itself when every check is clear. Turn the issue off "
             "with the repository variable HEALTH_ISSUES=off.\n")
    return body + f"\n<!-- sb-health: {json.dumps(state, separators=(',', ':'))} -->\n"


def update_issue(api, source, problems, now, dry_run=False, log=print):
    """Bring the one health issue in step with `problems` of `source`. -> what was done (str)."""
    cur = api.find()
    state = parse_state(cur["body"] if cur else "")
    old = state["sources"].get(source, {})
    state["sources"][source] = {k: {"text": t, "since": (old.get(k) or {}).get("since", int(now))} for k, t in problems.items()}
    if not state["sources"][source]:
        del state["sources"][source]
    state["told"] = {k: t for k, t in state["told"].items() if now - t < TOLD_KEEP_S}
    open_keys = {k for ps in state["sources"].values() for k in ps}
    fresh = sorted(k for k in open_keys if k not in state["told"])
    texts = {k: v["text"] for ps in state["sources"].values() for k, v in ps.items()}
    for k in fresh:
        state["told"][k] = int(now)
    body = render(state, now)
    act = "nothing"
    if open_keys:
        new_txt = "".join(f"- {texts[k]}\n" for k in fresh)
        if cur is None:
            act = "open"
        elif cur["state"].upper() != "OPEN":
            act = "reopen" if fresh else "edit-closed"
        else:
            act = "comment" if fresh else "edit"
        if dry_run:
            return f"dry-run: {act} ({len(open_keys)} open, {len(fresh)} new)"
        if act == "open":
            log(f"health issue opened: {api.create(body)}")
        else:
            api.edit(cur["number"], body)
            if act == "reopen":
                api.reopen(cur["number"])
                api.comment(cur["number"], f"@{OWNER} New collector problem(s):\n\n{new_txt}")
            elif act == "comment":
                api.comment(cur["number"], f"New collector problem(s):\n\n{new_txt}")
    elif cur is not None and cur["state"].upper() == "OPEN":
        act = "close"
        if dry_run:
            return "dry-run: close (all clear)"
        api.edit(cur["number"], body)
        api.comment(cur["number"], f"All clear: every collector check passed ({ct(now).strftime('%b %d, %I:%M %p')} Chicago). Closing.")
        api.close(cur["number"])
    elif cur is not None and old:                # closed by hand with this source's problems: keep its state current
        act = "edit-closed"
        if not dry_run:
            api.edit(cur["number"], body)
    return act


def publish(source, problems, args):
    """Print, annotate, summarize, and (unless off) update the issue. Never raises."""
    lines = [f"**Health ({source}):** " + ("all clear" if not problems else f"{len(problems)} problem(s)")]
    for k, t in sorted(problems.items()):
        print(f"health {source}: {t}")
        annotate("error", f"Collector health: {k}", t)
        lines.append(f"- {t}")
    if not problems:
        print(f"health {source}: all clear")
    summary(lines)
    off = os.environ.get("HEALTH_ISSUES", "").strip().lower() == "off"
    repo = os.environ.get("GITHUB_REPOSITORY") or args.repo
    if args.no_issue or off or not repo:
        print(f"health issue: skipped ({'--no-issue' if args.no_issue else 'HEALTH_ISSUES=off' if off else 'no repository'})")
        return
    try:
        act = update_issue(GhIssues(repo), source, problems, time.time(), args.dry_run)
        print(f"health issue: {act}")
    except Exception as ex:                      # the issue is a messenger: its failure must never fail the job
        print(f"health issue: failed ({type(ex).__name__}: {str(ex)[:200]})")
        annotate("warning", "Collector health issue not updated", str(ex)[:200])


# ------------------------------------------------------------------ CLI
def text_of(path, n=600):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")[-n:].strip() if path else ""
    except OSError:
        return ""


def cmd_code(a):
    publish("code", check_code(a.code, text_of(a.detail)), a)


def cmd_run(a):
    status = load_json(a.status) if a.status else None
    problems, healthy = check_run(status, a.log_outcome, a.merge_outcome, a.code, text_of(a.guard))
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            print(f"healthy={'true' if healthy else 'false'}", file=f)
    print(f"run healthy (fit for the collector-ok tag): {healthy}")
    publish("run", problems, a)


def cmd_data(a):
    if not (Path(a.dir) / "arrivals.csv").exists():
        print(f"health data: skipped ({a.dir}/arrivals.csv is not here; the last answer stays)")
        return
    now = a.now or time.time()
    rows = read_rows(a.dir, day_start(service_day(now) - timedelta(days=40)))
    problems = check_data(rows, now)
    if not a.skip_archive:
        problems.update(archive_problems(a, now))
    publish("data", problems, a)


def archive_problems(a, now):
    repo = os.environ.get("GITHUB_REPOSITORY") or a.repo
    today = service_day(now)
    months = sorted({(today - timedelta(days=k)).strftime("%Y-%m") for k in range(0, ARTIFACT_DAYS + 1)
                     if (today - timedelta(days=k)).isoformat() >= FIRST_ARCHIVE_DAY})
    assets = set()
    for m in months:
        r = subprocess.run(["gh", "release", "view", f"data-archive-{m}", "-R", repo, "--json", "assets", "--jq",
                            ".assets[].name"], capture_output=True, text=True, timeout=60)
        if r.returncode and "release not found" not in (r.stderr or "").lower():
            print(f"health archive: could not list data-archive-{m}: {(r.stderr or '').strip()[:200]}")
            return {}                            # can't tell: say nothing rather than a false alarm
        assets.update(x.strip() for x in r.stdout.splitlines() if x.strip())
    return check_archive(assets, now)


def cmd_archive(a):
    publish("archive", archive_problems(a, time.time()), a)


def cmd_watchdog(a):
    ok, buses = G.probe()
    newest = newest_arrival(Path(a.src_data) / "data" / "ground_truth")
    r = subprocess.run(["gh", "run", "list", "-R", a.app_repo, "-w", "collect.yml", "-L", "20", "--json",
                        "status,displayTitle"], capture_output=True, text=True, timeout=60)
    if r.returncode:
        print(f"health watchdog: cannot list {a.app_repo}'s runs ({(r.stderr or '').strip()[:200]}): saying nothing")
        return
    active = [x for x in json.loads(r.stdout or "[]") if x.get("status") in ("in_progress", "queued", "waiting", "requested")]
    idle = [x for x in active if str(x.get("displayTitle", "")).startswith("Collector idle")]
    collecting = len(active) > len(idle)
    print(f"health watchdog: feed {'ok' if ok else 'unreadable'}, {buses} live bus(es); newest arrival "
          f"{'none' if newest is None else f'{(time.time() - newest) / 60:.0f} min old'}; "
          f"{len(active) - len(idle)} collecting run(s), {len(idle)} idle")
    problems = check_watchdog(buses, newest, time.time(), collecting, bool(idle)) if ok else {}
    if problems and os.environ.get("COLLECT_DISPATCH_TOKEN"):
        d = subprocess.run(["gh", "workflow", "run", "collect.yml", "-R", a.app_repo, "--ref", "main", "-f", "slot=a",
                            "-f", "mode=collect"], capture_output=True, text=True, timeout=60,
                           env={**os.environ, "GH_TOKEN": os.environ["COLLECT_DISPATCH_TOKEN"]})
        note = "restarted it (dispatched a collect run)" if d.returncode == 0 else f"could not restart it: {(d.stderr or '').strip()[:150]}"
        problems = {k: f"{v} The watchdog {note}." for k, v in problems.items()}
        print(f"health watchdog: {note}")
    publish("watchdog", problems, a)


def cmd_report(a):
    problems = {}
    for kv in a.problem or []:
        k, _, t = kv.partition("=")
        problems[f"{a.source}:{k.strip()}"] = t.strip() or k.strip()
    publish(a.source, problems, a)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("code", help="the pre-flight self-test's verdict (every run)")
    c.add_argument("--code", required=True, choices=["main", "fallback", "broken"])
    c.add_argument("--detail", help="file with the self-test output")
    r = sub.add_parser("run", help="one collect run (logger status + step outcomes)")
    r.add_argument("--status", help="the logger's --status-file")
    r.add_argument("--log-outcome", default="success")
    r.add_argument("--merge-outcome", default="success")
    r.add_argument("--code", default="main", choices=["main", "fallback", "broken"])
    r.add_argument("--guard", help="file with tools/check_merge.py's output when it stopped the push")
    d = sub.add_parser("data", help="the collected rows of the last days (+ the archive)")
    d.add_argument("--dir", required=True, help="data/ground_truth of a data branch checkout")
    d.add_argument("--now", type=float)
    d.add_argument("--skip-archive", action="store_true")
    sub.add_parser("archive", help="the daily archive's release assets")
    p = sub.add_parser("report", help="report problems of any source (none given = that source is clear)")
    p.add_argument("--source", required=True)
    p.add_argument("--problem", action="append", help="KEY=TEXT (repeatable)")
    w = sub.add_parser("watchdog", help="from outside: buses running but the collector stopped?")
    w.add_argument("--src-data", required=True, help="a clone of the app repo's data branch")
    w.add_argument("--app-repo", default="blobberus/straight-bussing")
    for s in sub.choices.values():
        s.add_argument("--repo", default="blobberus/straight-bussing")
        s.add_argument("--dry-run", action="store_true")
        s.add_argument("--no-issue", action="store_true")
    a = ap.parse_args(argv)
    try:
        {"code": cmd_code, "run": cmd_run, "data": cmd_data, "archive": cmd_archive, "report": cmd_report,
         "watchdog": cmd_watchdog}[a.cmd](a)
    except Exception as ex:                      # health must never fail a collect run
        print(f"health {a.cmd}: crashed ({type(ex).__name__}: {ex})")
        annotate("warning", "Collector health check crashed", f"{type(ex).__name__}: {str(ex)[:200]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

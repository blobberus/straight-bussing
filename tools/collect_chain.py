#!/usr/bin/env python3
"""Self-chaining for .github/workflows/collect.yml. GitHub drops most scheduled runs (about 4 of 48 a day
fired on 2026-10-09), so each run starts its own successor; the :07/:37 cron stays as a backstop.

  python tools/collect_chain.py watch --slot a --state "$RUNNER_TEMP/chain.json"   # background, at job start
  python tools/collect_chain.py wait --state "$RUNNER_TEMP/chain.json"             # last step of the job

`watch` sleeps --after seconds (40 min), then runs `gh workflow run collect.yml --ref main -f slot=<other>`,
so a 70-min run overlaps its successor by ~30 min and never more than 2 runs exist. Why it can't explode:
  1. collect.yml runs in one of two concurrency groups (slot a / b, cancel-in-progress: false). GitHub never
     runs two runs of one group at once, so at most 2 collect runs execute, whatever started them.
  2. A run dispatches at most once, and only while it is the ONLY queued / in-progress collect run (runs
     parked by a concurrency group are 'pending' and don't count). Each run adds at most one run, no
     sooner than 40 min after it started: a chain, never a tree.
  3. If a newer run is active, that run leads the chain; this one only keeps watching in case it vanishes.
  4. Any GitHub API error means "don't dispatch". Gives up --until seconds (85 min) after it started.
  5. Kill switches: repo variable COLLECT_CHAIN=off (runs that start afterwards never dispatch), or
     disable the workflow in the Actions tab (checked before every dispatch; the keepalive step respects it).
`wait` keeps the job alive while the watcher still has a duty (state 'sleeping' or 'leader'), then prints the
outcome and a ::warning:: if the chain did not continue. Stdlib + the gh CLI (GH_TOKEN). Tests: test_chain.py.

Only while buses run (since 2026-10-18; the rule is tools/service_gate.py): every run is a collect run or an
idle run (input mode = collect / sleep; auto = decide at start, the cron backstop and manual runs).
  python tools/collect_chain.py gate --mode auto --slot a     # first step: collect, or hand over to an idle run
  python tools/collect_chain.py sleep --slot b                 # the idle run itself (foreground, up to 5 h 40 min)
A collect run's logger stops once no bus has run for 30 min (truth_logger.py --stop-when-idle); its watcher
then starts the next run at once, and the next run is an idle run whenever service_gate says so (`watch --live`).
An idle run logs nothing: every 2 min it reads the vehicle feed (up to 3 tries), every 10 min the service
alerts, and it starts a collect run as soon as a bus reports, an alert changes, or a scheduled route start is
45 min away; at 5 h 40 min it hands over to the next idle run. The same rules 1 to 5 apply to it.
"""
import argparse, json, os, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import service_gate as G

WORKFLOW = "collect.yml"
MODES = ("collect", "sleep")
ACTIVE = {"queued", "in_progress", "requested", "waiting"}   # 'pending' = parked behind its slot's running run
WAITING = {"sleeping", "leader"}                              # states in which the job must stay alive


def _start_key(r):
    """When the run's job really started (a run parked by concurrency starts long after it was created);
    not started yet = newest."""
    return (r.get("jobStartedAt") or "~", r.get("createdAt") or "", int(r.get("databaseId") or 0))


def decide(runs, me):
    """runs: gh run list JSON (databaseId, status, createdAt; jobStartedAt when > 1 run is active).
    -> (verdict, why). dispatch: I am the only active collect run. follower: a newer run is active and leads.
    leader: only older runs are active; wait for them to end. unknown: I am not listed (stale API): do nothing."""
    active = [r for r in runs if r.get("status") in ACTIVE]
    mine = next((r for r in active if int(r.get("databaseId") or 0) == me), None)
    if mine is None:
        return "unknown", f"run {me} is not listed as active ({len(active)} active)"
    others = [r for r in active if r is not mine]
    if not others:
        return "dispatch", "this is the only active collect run"
    ids = ", ".join(str(r.get("databaseId")) for r in others)
    if any(_start_key(r) > _start_key(mine) for r in others):
        return "follower", f"a newer run leads the chain (active: {ids})"
    return "leader", f"waiting for older run(s) {ids} to end before starting the next"


def check(api, me):
    """Workflow state + the run list + decide(). -> (verdict, why); verdict 'off' = the workflow is not active,
    'unknown' = an API error (never dispatch on it)."""
    try:
        wf = api.workflow_state()
        if wf != "active":
            return "off", f"workflow is {wf}"
        runs = api.list_runs()
        active = [r for r in runs if r.get("status") in ACTIVE]
        if len(active) > 1:
            for r in active:
                r["jobStartedAt"] = api.job_started(int(r["databaseId"]))
        return decide(runs, me)
    except Exception as ex:
        return "unknown", f"GitHub API error, not dispatching: {str(ex)[:200]}"


class Watcher:
    """The chain rules for one run as a step function (the CLI drives it with the real clock, tests with a fake).
    choose(now) -> (mode, why): what the next run does ('collect' / 'sleep'; default collect). early(now) -> True
    once this run's logger stopped because no bus runs: the first check is then at once, not `after` s in."""

    def __init__(self, api, me, slot, t0, after=2400, until=5100, every=60, enabled=True, dry_run=False,
                 choose=None, early=None):
        self.api, self.me, self.next_slot = api, me, "b" if slot == "a" else "a"
        self.t0, self.until, self.every, self.dry_run = t0, until, every, dry_run
        self.choose, self.early = choose, early
        self.next_at, self.failures = t0 + after, 0
        self.state, self.why = "sleeping", f"first check {after / 60:.0f} min after the job started"
        if not enabled:
            self.state, self.why = "done:off", "repo variable COLLECT_CHAIN is 'off'"

    @property
    def done(self):
        return self.state.startswith("done:")

    @property
    def deadline(self):
        return self.t0 + self.until

    def _set(self, state, why):
        self.state, self.why = state, why

    def step(self, now):
        if self.done:
            return
        if now < self.next_at:
            if not (self.state == "sleeping" and self.early and self.early(now)):
                return
        self.next_at = now + self.every
        if now >= self.deadline:
            return self._set("done:gave-up", f"no dispatch within {self.until / 60:.0f} min; last: {self.why}")
        verdict, why = check(self.api, self.me)
        if verdict == "off":
            return self._set("done:off", why)
        if verdict == "dispatch":
            mode, mwhy = self.choose(now) if self.choose else ("collect", "")
            what = f"{'an idle' if mode == 'sleep' else 'the next'} run in slot {self.next_slot}"
            what += f" ({mwhy}; {why})" if mwhy else f" ({why})"
            if self.dry_run:
                return self._set("done:dry-run", f"would start {what}")
            try:
                self.api.dispatch(self.next_slot, mode)
                return self._set("done:dispatched", f"started {what}")
            except Exception as ex:          # if it did start a run anyway, the next check sees 2 and stops
                self.failures += 1
                verdict, why = "leader", f"dispatch failed ({self.failures}/3): {str(ex)[:200]}"
                if self.failures >= 3:
                    return self._set("done:error", why)
        self._set(verdict, why)


class Sleeper:
    """An idle run as a step function: no logging; it starts a collect run as soon as gate(now) says buses run
    (gate(now) -> (mode, why), e.g. live_gate()), and before its own time limit it starts the next idle run.
    It dispatches under the chain rules (only while it is the only active run; dispatch at most once), and
    ends when a newer run leads. GitHub's API is read only when it wants to dispatch, or every check_every s."""

    def __init__(self, api, me, slot, t0, gate, until=20400, hard=20880, every=120, check_every=600,
                 enabled=True, dry_run=False):
        self.api, self.me, self.next_slot, self.gate = api, me, "b" if slot == "a" else "a", gate
        self.t0, self.until, self.hard, self.every, self.check_every = t0, until, hard, every, check_every
        self.dry_run, self.next_at, self.next_check, self.failures = dry_run, t0, t0 + check_every, 0
        self.state, self.why, self.woke = "idle", "no bus is running", None
        if not enabled:
            self.state, self.why = "done:off", "repo variable COLLECT_CHAIN is 'off'"

    @property
    def done(self):
        return self.state.startswith("done:")

    @property
    def deadline(self):
        return self.t0 + self.hard

    def _set(self, state, why):
        self.state, self.why = state, why

    def step(self, now):
        if self.done or now < self.next_at:
            return
        self.next_at = now + self.every
        if now >= self.t0 + self.hard:
            return self._set("done:gave-up", f"no dispatch within {self.hard / 60:.0f} min; last: {self.why}")
        try:
            mode, mwhy = self.gate(now)
        except Exception as ex:              # a gate bug: hand over to a collect run (when unsure, collect)
            mode, mwhy = "collect", f"gate error {type(ex).__name__}: {str(ex)[:120]}"
        if mode == "collect" and self.woke is None:
            self.woke = (now, mwhy)
        due = now >= self.t0 + self.until
        if mode != "collect" and not due:
            if now < self.next_check:
                return self._set("idle", mwhy)
            self.next_check = now + self.check_every
            verdict, why = check(self.api, self.me)
            if verdict == "off":
                return self._set("done:off", why)
            if verdict == "follower":
                return self._set("done:follower", why)
            return self._set("idle", mwhy)
        verdict, why = check(self.api, self.me)
        if verdict == "off":
            return self._set("done:off", why)
        if verdict == "follower":
            return self._set("done:follower", why)
        nxt = "collect" if mode == "collect" else "sleep"
        what = (f"a collect run in slot {self.next_slot} ({mwhy})" if nxt == "collect"
                else f"the next idle run in slot {self.next_slot} (time limit; {mwhy})")
        if verdict != "dispatch":
            return self._set("leader" if verdict == "leader" else "waking", f"to start {what}: {why}")
        if self.dry_run:
            return self._set("done:dry-run", f"would start {what}")
        try:
            self.api.dispatch(self.next_slot, nxt)
            return self._set("done:dispatched", f"started {what}")
        except Exception as ex:
            self.failures += 1
            self._set("waking", f"dispatch failed ({self.failures}/3): {str(ex)[:200]}")
            if self.failures >= 3:
                self._set("done:error", self.why)


def live_gate(service, names=None, probe=G.probe, alerts=None, every_alerts=600):
    """gate(now) for a Sleeper: probe the vehicle feed (up to 3 reads) + the schedule (service_gate.decide);
    with alerts() -> signature, also 'collect' when Passio's service alerts change (read every every_alerts s)."""
    st = {"sig": None, "next": 0.0}

    def gate(now):
        ok, buses = probe()
        v = G.decide(now, G.spans_around(service, now), None, ok, buses, names)
        if v.mode == "collect" or alerts is None or now < st["next"]:
            return v.mode, v.why
        st["next"] = now + every_alerts
        try:
            sig = alerts()
        except Exception:
            return v.mode, v.why
        if st["sig"] is None:
            st["sig"] = sig
        elif sig != st["sig"]:
            return "collect", "Passio's service alerts changed (recording the new version)"
        return v.mode, v.why
    return gate


class GhApi:
    def __init__(self, repo, ref="main"):
        self.repo, self.ref = repo, ref

    def _gh(self, *args):
        r = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise RuntimeError(f"gh {' '.join(args[:2])}: {(r.stderr or r.stdout).strip()[:300]}")
        return r.stdout

    def workflow_state(self):
        return self._gh("api", f"repos/{self.repo}/actions/workflows/{WORKFLOW}", "--jq", ".state").strip()

    def list_runs(self):
        return json.loads(self._gh("run", "list", "-R", self.repo, "-w", WORKFLOW, "-L", "40",
                                   "--json", "databaseId,status,createdAt,event"))

    def job_started(self, run_id):
        out = self._gh("api", f"repos/{self.repo}/actions/runs/{run_id}/jobs", "--jq",
                       '[.jobs[] | select(.status == "in_progress" or .status == "completed") | .started_at] | min // ""')
        return out.strip() or None

    def dispatch(self, slot, mode="collect"):
        self._gh("workflow", "run", WORKFLOW, "-R", self.repo, "--ref", self.ref, "-f", f"slot={slot}",
                 "-f", f"mode={mode}")


def stamp():
    return datetime.now(timezone.utc).strftime("%H:%M:%SZ")


def save(path, w):
    if path:
        tmp = Path(str(path) + ".tmp")
        tmp.write_text(json.dumps({"state": w.state, "why": w.why, "deadline": w.deadline, "pid": os.getpid(),
                                   "updated": int(time.time())}), encoding="utf-8")
        os.replace(tmp, path)


def load(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def alive(pid):
    if os.name == "nt":                     # os.kill(pid, 0) would terminate it on Windows
        return True
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError, TypeError):
        return False


def chain_enabled():
    return os.environ.get("COLLECT_CHAIN", "").strip().lower() != "off"


def live_choice(live_path, service, names=None, stale_s=180, done_path=None):
    """(choose, early) for a collect run's Watcher from its logger's --live-file (and its --status-file, written
    when the logger exits). The logger stopping because no bus runs, or ending early for any other reason (a
    crash), means: start the next run now. A missing or stale file means 'collect': when unsure, collect."""
    def ended():
        return bool(done_path) and Path(done_path).exists()

    def choose(now):
        live = G.load_json(live_path)
        if not live:
            return "collect", "no logger status (collecting to be safe)"
        if not live.get("idle_stop") and ended():
            return "collect", "the logger ended early (a crash?), so a new collect run takes over"
        if not live.get("idle_stop") and now - float(live.get("t") or 0) > stale_s:
            return "collect", "the logger's status is stale (collecting to be safe)"
        svc = service() if callable(service) else service        # read late: the job refreshes web/data first
        v = G.from_live(live, now, G.spans_around(svc, now), names)
        return (v.mode, v.why) if v else ("collect", "unreadable logger status (collecting to be safe)")

    def early(now):
        return bool((G.load_json(live_path) or {}).get("idle_stop")) or ended()
    return choose, early


def cmd_watch(a):
    me = int(a.run_id or os.environ.get("GITHUB_RUN_ID") or 0)
    choose = early = None
    if a.live:
        choose, early = live_choice(a.live, lambda: G.load_json(a.service), G.route_names(), done_path=a.logger_status)
    w = Watcher(GhApi(a.repo, a.ref), me, a.slot, time.time(), a.after, a.until, a.every, chain_enabled(),
                a.dry_run, choose, early)
    last = None
    try:
        while True:
            w.step(time.time())
            if (w.state, w.why) != last:
                last = (w.state, w.why)
                save(a.state, w)
                print(f"{stamp()} chain {w.state}: {w.why}", flush=True)
            if w.done:
                return 0
            wake = min(w.next_at, w.deadline, time.time() + 30 if early else w.next_at)
            time.sleep(max(1.0, wake - time.time()))
    except BaseException as ex:
        w.state, w.why = "done:crash", repr(ex)[:300]
        save(a.state, w)
        print(f"{stamp()} chain crashed: {ex!r}", flush=True)
        raise


def cmd_wait(a):
    cap = time.time() + a.max_wait
    s = load(a.state)
    while s and s.get("state") in WAITING and time.time() < min(s.get("deadline", 0), cap) and alive(s.get("pid")):
        time.sleep(a.poll)
        s = load(a.state) or s
    if not s:
        msg = "the chain watcher never wrote its state; the next run depends on the cron backstop"
        print(f"::warning title=Collect chain::{msg}")
        return 0
    state, why = s.get("state"), s.get("why", "")
    line = f"chain {state}: {why}"
    print(line)
    if state == "done:dispatched":
        print(f"::notice title=Collect chain::{why}")
    elif state == "follower" or state == "done:off" or state == "done:dry-run":
        pass                                # another run leads / switched off on purpose
    else:                                   # gave up, error, crash, unknown, or still waiting at the deadline
        print(f"::warning title=Collect chain did not start the next run::{state}: {why} "
              "(the :07/:37 cron is the backstop; see monitoring.md)")
    summary(f"**Self-chain:** {state}: {why}")
    return 0


def summary(line):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            print(line, file=f)
            print("", file=f)


def cmd_gate(a):
    """First step of every run: prints and writes mode=collect|sleep|none to $GITHUB_OUTPUT. An explicit mode
    (set by the run that started this one) is kept. auto (cron backstop, manual runs, runs started by a collector
    of before 2026-10-18): probe + schedule; idle = this run becomes a short idle run itself (collect.yml passes
    --until 4500: its job limit is 95 min), so it carries the chain on whether or not an older run still has to;
    a newer run makes it a follower and it ends. 'none' only with COLLECT_CHAIN=off."""
    def emit(mode, why):
        print(f"mode {mode}: {why}", flush=True)
        out = os.environ.get("GITHUB_OUTPUT")
        if out:
            with open(out, "a", encoding="utf-8") as f:
                print(f"mode={mode}", file=f)
        label = {"collect": "collecting", "sleep": "idle run", "none": "nothing to do"}[mode]
        summary(f"**Mode:** {label}: {why}")
        return 0
    if a.mode in MODES:
        return emit(a.mode, "set by the run that started this one")
    service, names, now = G.load_json(a.service), G.route_names(), time.time()
    ok, buses = G.probe()
    v = G.decide(now, G.spans_around(service, now), None, ok, buses, names)
    if v.mode == "collect":
        return emit("collect", v.why)
    if not chain_enabled():
        return emit("none", f"{v.why}; COLLECT_CHAIN is off, so no idle run either")
    return emit("sleep", f"{v.why}; this run waits as an idle run")


def cmd_sleep(a):
    me = int(a.run_id or os.environ.get("GITHUB_RUN_ID") or 0)
    service, names = G.load_json(a.service), G.route_names()
    alerts = lambda: G.alerts_signature(G.fetch("serviceAlerts", timeout=10))
    s = Sleeper(GhApi(a.repo, a.ref), me, a.slot, time.time(), live_gate(service, names, alerts=alerts), a.until,
                a.hard, a.every, a.check_every, chain_enabled(), a.dry_run)
    t0, last, beat = time.time(), None, 0.0
    while True:
        s.step(time.time())
        if s.state != last or time.time() - beat > 1800:
            last, beat = s.state, time.time()
            print(f"{stamp()} idle run {s.state}: {s.why}", flush=True)
        if s.done:
            break
        time.sleep(max(1.0, min(s.next_at, s.deadline) - time.time()))
    mins = (time.time() - t0) / 60
    woke = f"; buses or a start found at {datetime.fromtimestamp(s.woke[0], G.CT):%I:%M %p} ({s.woke[1]})" if s.woke else ""
    summary(f"**Idle run:** {mins:.0f} min, {s.state}: {s.why}{woke}")
    if s.state == "done:dispatched":
        print(f"::notice title=Collect chain::{s.why}")
    elif s.state not in ("done:follower", "done:off", "done:dry-run"):
        print(f"::warning title=Idle run did not start the next run::{s.state}: {s.why} "
              "(the :07/:37 cron is the backstop; see monitoring.md)")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("watch", help="background: dispatch the next run when the rules allow")
    w.add_argument("--slot", choices=["a", "b"], required=True, help="this run's concurrency slot")
    w.add_argument("--state", help="JSON state file shared with 'wait'")
    w.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "blobberus/straight-bussing"))
    w.add_argument("--ref", default="main")
    w.add_argument("--run-id", type=int, help="this run's id (default $GITHUB_RUN_ID)")
    w.add_argument("--after", type=float, default=2400, help="seconds before the first check (default 40 min)")
    w.add_argument("--until", type=float, default=5100, help="give up this many seconds after start (85 min)")
    w.add_argument("--every", type=float, default=60, help="seconds between checks")
    w.add_argument("--dry-run", action="store_true", help="decide but never dispatch")
    w.add_argument("--live", help="the logger's --live-file: the next run is collect or idle by service_gate")
    w.add_argument("--logger-status", help="the logger's --status-file (exists once it exited): hand over at once")
    w.add_argument("--service", default=str(G.SERVICE))
    t = sub.add_parser("wait", help="end of job: wait while the watcher still has a duty, then report")
    t.add_argument("--state", required=True)
    t.add_argument("--poll", type=float, default=15)
    t.add_argument("--max-wait", type=float, default=5400, help="hard cap in seconds")
    g = sub.add_parser("gate", help="first step: collect, idle, or nothing (writes mode= to $GITHUB_OUTPUT)")
    s = sub.add_parser("sleep", help="the idle run: wait for buses, then start a collect run")
    for p in (g, s):
        p.add_argument("--slot", choices=["a", "b"], required=True)
        p.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "blobberus/straight-bussing"))
        p.add_argument("--ref", default="main")
        p.add_argument("--run-id", type=int)
        p.add_argument("--service", default=str(G.SERVICE))
        p.add_argument("--dry-run", action="store_true")
    g.add_argument("--mode", default="auto", help="collect / sleep (kept as is) or auto (decide now)")
    s.add_argument("--until", type=float, default=20400, help="hand over to the next idle run after this (5 h 40 min)")
    s.add_argument("--hard", type=float, default=20880, help="give up this many seconds after start (5 h 48 min)")
    s.add_argument("--every", type=float, default=120, help="seconds between feed checks")
    s.add_argument("--check-every", type=float, default=600, help="seconds between GitHub run-list checks while idle")
    a = ap.parse_args(argv)
    return {"watch": cmd_watch, "wait": cmd_wait, "gate": cmd_gate, "sleep": cmd_sleep}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())

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
"""
import argparse, json, os, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

WORKFLOW = "collect.yml"
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


class Watcher:
    """The chain rules for one run as a step function (the CLI drives it with the real clock, tests with a fake)."""

    def __init__(self, api, me, slot, t0, after=2400, until=5100, every=60, enabled=True, dry_run=False):
        self.api, self.me, self.next_slot = api, me, "b" if slot == "a" else "a"
        self.t0, self.until, self.every, self.dry_run = t0, until, every, dry_run
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
        if self.done or now < self.next_at:
            return
        self.next_at = now + self.every
        if now >= self.deadline:
            return self._set("done:gave-up", f"no dispatch within {self.until / 60:.0f} min; last: {self.why}")
        try:
            wf = self.api.workflow_state()
            if wf != "active":
                return self._set("done:off", f"workflow is {wf}")
            runs = self.api.list_runs()
            active = [r for r in runs if r.get("status") in ACTIVE]
            if len(active) > 1:
                for r in active:
                    r["jobStartedAt"] = self.api.job_started(int(r["databaseId"]))
            verdict, why = decide(runs, self.me)
        except Exception as ex:
            verdict, why = "unknown", f"GitHub API error, not dispatching: {str(ex)[:200]}"
        if verdict == "dispatch":
            if self.dry_run:
                return self._set("done:dry-run", f"would start the next run in slot {self.next_slot} ({why})")
            try:
                self.api.dispatch(self.next_slot)
                return self._set("done:dispatched", f"started the next run in slot {self.next_slot} ({why})")
            except Exception as ex:          # if it did start a run anyway, the next check sees 2 and stops
                self.failures += 1
                verdict, why = "leader", f"dispatch failed ({self.failures}/3): {str(ex)[:200]}"
                if self.failures >= 3:
                    return self._set("done:error", why)
        self._set(verdict, why)


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

    def dispatch(self, slot):
        self._gh("workflow", "run", WORKFLOW, "-R", self.repo, "--ref", self.ref, "-f", f"slot={slot}")


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


def cmd_watch(a):
    enabled = os.environ.get("COLLECT_CHAIN", "").strip().lower() != "off"
    me = int(a.run_id or os.environ.get("GITHUB_RUN_ID") or 0)
    w = Watcher(GhApi(a.repo, a.ref), me, a.slot, time.time(), a.after, a.until, a.every, enabled, a.dry_run)
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
            time.sleep(max(1.0, min(w.next_at, w.deadline) - time.time()))
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
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"**Self-chain:** {state}: {why}\n\n")
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
    t = sub.add_parser("wait", help="end of job: wait while the watcher still has a duty, then report")
    t.add_argument("--state", required=True)
    t.add_argument("--poll", type=float, default=15)
    t.add_argument("--max-wait", type=float, default=5400, help="hard cap in seconds")
    a = ap.parse_args(argv)
    return cmd_watch(a) if a.cmd == "watch" else cmd_wait(a)


if __name__ == "__main__":
    sys.exit(main())

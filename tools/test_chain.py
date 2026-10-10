#!/usr/bin/env python3
"""Asserts on tools/collect_chain.py (self-chaining of collect.yml): the decision rule, the watcher's
single dispatch / waiting / kill switches / API failures, and a multi-day simulation of GitHub (two
concurrency slots, dropped and late crons, queue latency, slow merges, crashed loggers) showing that
runs never exceed 2, never multiply, and keep the collection gap-free.
  python tools/test_chain.py        -> prints 'ok N tests', exits 1 on failure (hermetic, ~5 s)"""
import json, os, random, sys, tempfile, traceback
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import collect_chain as C

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(i, status, created, job=None):
    r = {"databaseId": i, "status": status, "createdAt": iso(created)}
    if job is not None:
        r["jobStartedAt"] = iso(job)
    return r


@test
def decide_rules():
    T = 1_800_000_000
    assert C.decide([run(5, "in_progress", T)], 5)[0] == "dispatch"
    assert C.decide([run(5, "in_progress", T), run(4, "completed", T - 99), run(6, "pending", T + 9)], 5)[0] == "dispatch"
    assert C.decide([run(4, "in_progress", T - 60, T - 60), run(5, "in_progress", T, T)], 5)[0] == "leader"
    assert C.decide([run(4, "in_progress", T - 60, T - 60), run(5, "in_progress", T, T)], 4)[0] == "follower"
    assert C.decide([run(5, "in_progress", T, T), run(6, "queued", T + 5)], 5)[0] == "follower"   # not started = newest
    # created earlier but parked by concurrency, so its job started later: it is the newer run
    assert C.decide([run(4, "in_progress", T - 900, T + 600), run(5, "in_progress", T, T)], 5)[0] == "follower"
    assert C.decide([run(4, "in_progress", T - 900, T + 600), run(5, "in_progress", T, T)], 4)[0] == "leader"
    assert C.decide([run(4, "in_progress", T)], 5)[0] == "unknown"                       # I am not listed
    assert C.decide([], 5)[0] == "unknown"


class FakeApi:
    def __init__(self, runs, state="active"):
        self.runs, self.state, self.dispatched, self.fail_list, self.fail_dispatch = runs, state, [], 0, 0

    def workflow_state(self):
        return self.state

    def list_runs(self):
        if self.fail_list:
            self.fail_list -= 1
            raise RuntimeError("HTTP 502")
        return [dict(r) for r in self.runs]

    def job_started(self, rid):
        return next((r.get("job") for r in self.runs if r["databaseId"] == rid), None)

    def dispatch(self, slot):
        if self.fail_dispatch:
            self.fail_dispatch -= 1
            raise RuntimeError("HTTP 500")
        self.dispatched.append(slot)


def drive(w, t0, t1, step=10):
    t = t0
    while t <= t1 and not w.done:
        w.step(t)
        t += step
    return t


@test
def alone_dispatches_once_into_the_other_slot_after_40_min():
    T = 1_800_000_000
    api = FakeApi([run(7, "in_progress", T)])
    w = C.Watcher(api, 7, "a", T)
    drive(w, T, T + 2390)
    assert not api.dispatched and w.state == "sleeping"
    drive(w, T + 2400, T + 9000)
    assert api.dispatched == ["b"] and w.state == "done:dispatched", (api.dispatched, w.state)
    w.step(T + 9999)
    assert api.dispatched == ["b"]
    api = FakeApi([run(8, "in_progress", T)])
    w = C.Watcher(api, 8, "b", T)
    drive(w, T, T + 9000)
    assert api.dispatched == ["a"]


@test
def leader_waits_for_the_older_run_then_dispatches():
    T = 1_800_000_000
    older = dict(run(6, "in_progress", T - 2400), job=iso(T - 2400))
    me = dict(run(7, "in_progress", T), job=iso(T))
    api = FakeApi([older, me])
    w = C.Watcher(api, 7, "a", T)
    drive(w, T, T + 2700)
    assert w.state == "leader" and not api.dispatched, w.state
    older["status"] = "completed"
    drive(w, T + 2710, T + 9000)
    assert api.dispatched == ["b"], api.dispatched


@test
def follower_never_dispatches_while_a_newer_run_is_active():
    T = 1_800_000_000
    api = FakeApi([dict(run(7, "in_progress", T), job=iso(T)), dict(run(9, "in_progress", T + 60), job=iso(T + 60))])
    w = C.Watcher(api, 7, "a", T)
    drive(w, T, T + 6000)
    assert not api.dispatched and w.state == "done:gave-up", w.state


@test
def kill_switches_and_api_errors_mean_no_dispatch():
    T = 1_800_000_000
    api = FakeApi([run(7, "in_progress", T)])
    w = C.Watcher(api, 7, "a", T, enabled=False)
    drive(w, T, T + 9000)
    assert w.state == "done:off" and not api.dispatched
    api = FakeApi([run(7, "in_progress", T)], state="disabled_manually")
    w = C.Watcher(api, 7, "a", T)
    drive(w, T, T + 9000)
    assert w.state == "done:off" and not api.dispatched
    api = FakeApi([run(7, "in_progress", T)])
    api.fail_list = 10 ** 6
    w = C.Watcher(api, 7, "a", T)
    drive(w, T, T + 9000)
    assert w.state == "done:gave-up" and not api.dispatched, w.state
    api = FakeApi([run(7, "in_progress", T)])                         # transient errors: dispatches after
    api.fail_list = 3
    w = C.Watcher(api, 7, "a", T)
    drive(w, T, T + 9000)
    assert api.dispatched == ["b"]
    api = FakeApi([run(7, "in_progress", T)])                         # dispatch keeps failing: 3 tries max
    api.fail_dispatch = 99
    w = C.Watcher(api, 7, "a", T)
    drive(w, T, T + 9000)
    assert w.state == "done:error" and api.fail_dispatch == 96, (w.state, api.fail_dispatch)
    w = C.Watcher(FakeApi([run(7, "in_progress", T)]), 7, "a", T, dry_run=True)
    drive(w, T, T + 9000)
    assert w.state == "done:dry-run"


@test
def failed_dispatch_that_still_started_a_run_is_not_repeated():
    T = 1_800_000_000
    runs = [dict(run(7, "in_progress", T), job=iso(T))]
    api = FakeApi(runs)

    def flaky(slot):                 # GitHub created the run but the call timed out
        runs.append(run(8, "queued", T + 2400))
        raise RuntimeError("timeout")
    api.dispatch = flaky
    w = C.Watcher(api, 7, "a", T)
    drive(w, T, T + 9000)
    assert len(runs) == 2 and w.state == "done:gave-up", (len(runs), w.state)


@test
def wait_reports_and_returns():
    d = Path(tempfile.mkdtemp(prefix="sb-chain-"))
    p = d / "chain.json"
    for state, warn in (("done:dispatched", False), ("follower", False), ("done:gave-up", True), ("leader", True)):
        p.write_text(json.dumps({"state": state, "why": "x", "deadline": 0, "pid": os.getpid()}), encoding="utf-8")
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            assert C.main(["wait", "--state", str(p), "--poll", "0.01"]) == 0
        assert ("::warning" in buf.getvalue()) == warn, (state, buf.getvalue())
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        C.main(["wait", "--state", str(d / "missing.json")])
    assert "::warning" in buf.getvalue()


# ------------------------------------------------------------------ simulation of GitHub Actions
class Sim:
    """10-second ticks. Runs: pending (parked by its slot's concurrency group) -> queued -> in_progress ->
    completed. A job: setup, 70 min logging, merge, then the final 'wait' step while the watcher is
    sleeping/leader (up to its deadline); job timeout 95 min. Crons at :07 (slot a) and :37 (slot b) fire
    with probability cron_p, 0-40 min late."""

    def __init__(self, seed, cron_p=0.1, crash_p=0.0, manual_p=0.0, stale_s=10):
        self.rnd, self.cron_p, self.crash_p, self.manual_p, self.stale_s = random.Random(seed), cron_p, crash_p, manual_p, stale_s
        self.runs, self.live, self.future, self.next_id, self.t, self.cancelled = [], [], [], 1, 0, 0

    def create(self, t, slot, event):
        for o in self.live:
            if o["slot"] == slot and o["status"] == "pending":
                o["status"], o["end"] = "completed", t       # GitHub cancels the older pending run
                self.cancelled += 1
        r = {"id": self.next_id, "slot": slot, "event": event, "status": "pending", "created": t, "ciso": iso(t), "start": None,
             "dispatches": 0, "w": None, "end": None}
        self.next_id += 1
        self.runs.append(r)
        self.live.append(r)
        return r

    def api(self, me):
        sim = self

        class Api:
            def workflow_state(self):
                return "active"

            def list_runs(self):                                       # like gh run list -L 40
                return [{"databaseId": r["id"], "status": r["status"], "createdAt": r["ciso"]}
                        for r in sim.runs[-40:] if r["created"] <= sim.t - sim.stale_s or r["id"] == me["id"]]

            def job_started(self, rid):
                r = next(x for x in sim.runs if x["id"] == rid)
                return iso(r["start"]) if r["start"] is not None and r["status"] == "in_progress" else None

            def dispatch(self, slot):
                me["dispatches"] += 1
                sim.create(sim.t, slot, "workflow_dispatch")
        return Api()

    def tick(self, t):
        self.t = t
        if t % 1800 == 420 and self.rnd.random() < self.cron_p:          # :07 / :37
            self.future.append((t + self.rnd.uniform(0, 2400), "a" if t % 3600 == 420 else "b", "schedule"))
        if self.manual_p and self.rnd.random() < self.manual_p:
            self.future.append((t, "a", "manual"))
        for ev in [e for e in self.future if e[0] <= t]:
            self.future.remove(ev)
            self.create(t, ev[1], ev[2])
        for slot in "ab":
            busy = any(r["slot"] == slot and r["status"] in ("queued", "in_progress") for r in self.live)
            pend = [r for r in self.live if r["slot"] == slot and r["status"] == "pending"]
            if not busy and pend:
                r = pend[0]
                r["status"], r["ready"] = "queued", t + self.rnd.uniform(5, 90)
        for r in list(self.live):
            if r["status"] == "queued" and t >= r["ready"]:
                r["status"], r["start"] = "in_progress", t
                r["log0"] = t + self.rnd.uniform(40, 120)                  # checkout, python, GTFS, seed
                dur = self.rnd.uniform(60, 4200) if self.rnd.random() < self.crash_p else 4200
                r["log1"] = r["log0"] + dur
                r["merged"] = r["log1"] + self.rnd.uniform(20, 240)
                r["w"] = C.Watcher(self.api(r), r["id"], r["slot"], t + 20)
            if r["status"] == "in_progress":
                r["w"].step(t)
                duty = r["w"].state in C.WAITING and t < r["w"].deadline
                if (t >= r["merged"] and not duty) or t >= r["start"] + 95 * 60:
                    r["status"], r["end"] = "completed", t
        self.live = [r for r in self.live if r["status"] != "completed"]

    def go(self, hours, first=True):
        if first:
            self.create(0, "a", "manual")
        for t in range(0, int(hours * 3600), 10):
            self.tick(t)
        return self

    def report(self, t_from, t_to):
        """-> (max running, max logging, fraction of time logging, longest gap s, runs started); 10 s bins."""
        n = int((t_to - t_from) // 10)
        run_d, log_d = [0] * (n + 1), [0] * (n + 1)

        def add(d, a, b):
            i, j = max(0, -(-int(a - t_from) // 10)), min(n, -(-int(b - t_from) // 10))
            if i < j:
                d[i] += 1
                d[j] -= 1
        started = [r for r in self.runs if r["start"] is not None]
        for r in started:
            end = r["end"] if r["end"] is not None else 1e18
            add(run_d, r["start"], min(end, t_to))
            add(log_d, r["log0"], min(r["log1"], end, t_to))
        mx_run = mx_log = covered = gap = longest = cr = cl = 0
        for i in range(n):
            cr, cl = cr + run_d[i], cl + log_d[i]
            mx_run, mx_log = max(mx_run, cr), max(mx_log, cl)
            if cl:
                covered, gap = covered + 1, 0
            else:
                gap += 10
                longest = max(longest, gap)
        return mx_run, mx_log, covered / n, longest, len(started)


@test
def simulation_bounded_and_gap_free():
    hours = 72
    worst_gap, cover, n_runs = 0, 1.0, []
    for seed in range(8):
        for cron_p in (0.0, 0.1, 1.0):
            s = Sim(seed, cron_p=cron_p).go(hours)
            mx_run, mx_log, frac, longest, started = s.report(600, hours * 3600 - 600)
            assert mx_run <= 2 and mx_log <= 2, (seed, cron_p, mx_run, mx_log)
            assert all(r["dispatches"] <= 1 for r in s.runs)
            crons = sum(1 for r in s.runs if r["event"] == "schedule")
            assert started <= hours * 3600 / 2400 + crons + 2, (seed, cron_p, started, crons)   # a chain, not a tree
            assert started >= hours * 3600 / 2700, (seed, cron_p, started)                      # and it stays alive
            worst_gap, cover = max(worst_gap, longest), min(cover, frac)
            n_runs.append(started)
    print(f"    {len(n_runs)} x 72 h: {min(n_runs)}-{max(n_runs)} runs each, worst gap {worst_gap / 60:.1f} min, "
          f"worst coverage {cover:.2%}")
    assert cover >= 0.995 and worst_gap <= 8 * 60, (cover, worst_gap)


@test
def simulation_stress_crashes_manual_dispatches_stale_api():
    """Loggers that crash early, random manual dispatches, a slow API view: still <= 2 runs, no blow-up."""
    hours = 48
    for seed in range(4):
        s = Sim(seed, cron_p=0.5, crash_p=0.2, manual_p=0.002, stale_s=60).go(hours)
        mx_run, mx_log, frac, longest, started = s.report(600, hours * 3600 - 600)
        assert mx_run <= 2 and mx_log <= 2, (seed, mx_run, mx_log)
        assert all(r["dispatches"] <= 1 for r in s.runs)
        chained = sum(1 for r in s.runs if r["event"] == "workflow_dispatch")
        assert chained <= hours * 3600 / 2400 + 2, (seed, chained)


def main():
    fails = 0
    for fn in TESTS:
        try:
            fn()
            print("pass", fn.__name__)
        except Exception:
            fails += 1
            print("FAIL", fn.__name__)
            traceback.print_exc()
    print(f"{'ok' if not fails else 'FAILED'} {len(TESTS) - fails}/{len(TESTS)} tests")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()

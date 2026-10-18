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
        self.modes = []

    def workflow_state(self):
        return self.state

    def list_runs(self):
        if self.fail_list:
            self.fail_list -= 1
            raise RuntimeError("HTTP 502")
        return [dict(r) for r in self.runs]

    def job_started(self, rid):
        return next((r.get("job") for r in self.runs if r["databaseId"] == rid), None)

    def dispatch(self, slot, mode="collect"):
        if self.fail_dispatch:
            self.fail_dispatch -= 1
            raise RuntimeError("HTTP 500")
        self.dispatched.append(slot)
        self.modes.append(mode)


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

    def flaky(slot, mode="collect"):  # GitHub created the run but the call timed out
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

            def dispatch(self, slot, mode="collect"):
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


# ------------------------------------------------------------------ only while buses run (2026-10-18)
import service_gate as G


@test
def watcher_hands_over_to_an_idle_run_as_soon_as_its_logger_stops():
    T = 1_800_000_000
    api = FakeApi([run(7, "in_progress", T)])
    idle = {"stop": False}
    w = C.Watcher(api, 7, "a", T, choose=lambda now: ("sleep", "no live bus"), early=lambda now: idle["stop"])
    drive(w, T, T + 1790)
    assert not api.dispatched and w.state == "sleeping"
    idle["stop"] = True
    drive(w, T + 1800, T + 1900)
    assert api.dispatched == ["b"] and api.modes == ["sleep"] and "idle" in w.why, (api.modes, w.why)
    api = FakeApi([run(8, "in_progress", T)])                       # no choose: the next run collects
    drive(C.Watcher(api, 8, "a", T), T, T + 9000)
    assert api.modes == ["collect"]


@test
def live_choice_collects_when_unsure_and_follows_the_logger_otherwise():
    d = Path(tempfile.mkdtemp(prefix="sb-live-"))
    p = d / "live.json"
    choose, early = C.live_choice(str(p), None)
    T = 1_800_000_000
    assert choose(T)[0] == "collect" and not early(T)                                   # no file yet
    p.write_text(json.dumps({"t": T, "started": T - 3600, "last_bus": T - 2400, "last_ok": T}), encoding="utf-8")
    assert choose(T + 60)[0] == "sleep"                                                 # 41 min without a bus
    assert choose(T + 600)[0] == "collect"                                              # stale: the logger hangs
    p.write_text(json.dumps({"t": T, "started": T - 3600, "last_bus": T - 600, "last_ok": T}), encoding="utf-8")
    assert choose(T + 60)[0] == "collect"
    p.write_text(json.dumps({"t": T, "started": T - 3600, "last_bus": T - 2400, "last_ok": T, "idle_stop": "x"}),
                 encoding="utf-8")
    assert early(T) and choose(T + 900)[0] == "sleep"                                  # stopped on purpose
    p.write_text("{oops", encoding="utf-8")
    assert choose(T)[0] == "collect" and not early(T)
    done = d / "logger.json"                                                            # the logger exited
    choose, early = C.live_choice(str(p), None, done_path=str(done))
    p.write_text(json.dumps({"t": T, "started": T - 600, "last_bus": T - 60, "last_ok": T}), encoding="utf-8")
    assert not early(T) and choose(T)[0] == "collect"
    done.write_text("{}", encoding="utf-8")
    m, why = choose(T + 30)
    assert early(T) and m == "collect" and "ended early" in why, why


def drive_sleeper(s, t0, t1, step=10):
    t = t0
    while t <= t1 and not s.done:
        s.step(t)
        t += step
    return t


@test
def sleeper_wakes_a_collect_run_when_buses_report():
    T = 1_800_000_000
    api = FakeApi([run(7, "in_progress", T)])
    calls = []

    def gate(now):
        calls.append(now)
        return ("collect", "2 buses reporting live") if now >= T + 3600 else ("sleep", "no live bus")
    s = C.Sleeper(api, 7, "a", T, gate)
    drive_sleeper(s, T, T + 3590)
    assert not api.dispatched and s.state == "idle" and len(calls) == 30, (s.state, len(calls))   # every 2 min
    drive_sleeper(s, T + 3600, T + 4000)
    assert api.dispatched == ["b"] and api.modes == ["collect"] and s.state == "done:dispatched", (api.modes, s.state)
    assert s.woke and s.woke[0] <= T + 3600 + 120


@test
def sleeper_waits_for_an_older_run_then_starts_the_collect_run():
    T = 1_800_000_000
    older = dict(run(6, "in_progress", T - 2400), job=iso(T - 2400))
    api = FakeApi([older, dict(run(7, "in_progress", T), job=iso(T))])
    s = C.Sleeper(api, 7, "a", T, lambda now: ("collect", "bus"))
    drive_sleeper(s, T, T + 600)
    assert s.state == "leader" and not api.dispatched, s.state
    older["status"] = "completed"
    drive_sleeper(s, T + 610, T + 1200)
    assert api.modes == ["collect"]


@test
def sleeper_hands_over_to_the_next_idle_run_before_its_time_limit():
    T = 1_800_000_000
    api = FakeApi([run(7, "in_progress", T)])
    s = C.Sleeper(api, 7, "b", T, lambda now: ("sleep", "no live bus"))
    drive_sleeper(s, T, T + 20390)
    assert not api.dispatched
    drive_sleeper(s, T + 20400, T + 21000)
    assert api.dispatched == ["a"] and api.modes == ["sleep"] and "idle run" in s.why, s.why


@test
def sleeper_ends_as_follower_when_a_newer_run_leads_and_obeys_the_kill_switches():
    T = 1_800_000_000
    runs = [dict(run(7, "in_progress", T), job=iso(T))]
    api = FakeApi(runs)
    s = C.Sleeper(api, 7, "a", T, lambda now: ("sleep", "no live bus"))
    drive_sleeper(s, T, T + 900)
    assert s.state == "idle"
    runs.append(dict(run(9, "in_progress", T + 1000), job=iso(T + 1000)))         # a cron run started collecting
    drive_sleeper(s, T + 910, T + 2000)
    assert s.state == "done:follower" and not api.dispatched, s.state
    s = C.Sleeper(FakeApi([run(7, "in_progress", T)]), 7, "a", T, lambda now: ("collect", "x"), enabled=False)
    assert s.done and s.state == "done:off"
    api = FakeApi([run(7, "in_progress", T)], state="disabled_manually")
    s = C.Sleeper(api, 7, "a", T, lambda now: ("collect", "x"))
    drive_sleeper(s, T, T + 600)
    assert s.state == "done:off" and not api.dispatched

    def broken(now):
        raise ValueError("bad schedule")
    api = FakeApi([run(7, "in_progress", T)])
    drive_sleeper(C.Sleeper(api, 7, "a", T, broken), T, T + 600)                  # a gate bug: collect
    assert api.modes == ["collect"]


@test
def an_auto_run_with_no_bus_carries_the_chain_after_an_older_run():
    """2026-10-18 handover: a collector of the old code started an auto run and was done; the auto run found no bus.
    It must not just end (the chain would die with the older run): it idles itself and hands over at 75 min."""
    T = 1_800_000_000
    older = dict(run(6, "in_progress", T - 2400), job=iso(T - 2400))
    api = FakeApi([older, dict(run(7, "in_progress", T), job=iso(T))])
    s = C.Sleeper(api, 7, "b", T, lambda now: ("sleep", "no live bus"), until=4500, hard=5100)
    drive_sleeper(s, T, T + 1800)
    assert s.state == "idle" and not api.dispatched, s.state
    older["status"] = "completed"
    drive_sleeper(s, T + 1810, T + 5100)
    assert api.dispatched == ["a"] and api.modes == ["sleep"] and s.state == "done:dispatched", (api.modes, s.state)


@test
def gate_command_auto_idles_itself_without_a_bus():
    import io, contextlib
    d = Path(tempfile.mkdtemp(prefix="sb-gate-"))
    out, svc = d / "out.txt", d / "service.json"
    svc.write_text("{}", encoding="utf-8")
    old_probe, old_env = C.G.probe, {k: os.environ.get(k) for k in ("GITHUB_OUTPUT", "COLLECT_CHAIN")}
    os.environ["GITHUB_OUTPUT"] = str(out)
    os.environ.pop("COLLECT_CHAIN", None)
    try:
        for buses, want in ((0, "sleep"), (2, "collect")):
            C.G.probe = lambda b=buses: (True, b)
            out.write_text("", encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                assert C.main(["gate", "--mode", "auto", "--slot", "a", "--service", str(svc)]) == 0
            assert out.read_text(encoding="utf-8").strip() == f"mode={want}", (buses, out.read_text(encoding="utf-8"))
        os.environ["COLLECT_CHAIN"] = "off"
        C.G.probe = lambda: (True, 0)
        out.write_text("", encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            C.main(["gate", "--mode", "auto", "--slot", "a", "--service", str(svc)])
        assert out.read_text(encoding="utf-8").strip() == "mode=none"
    finally:
        C.G.probe = old_probe
        for k, v in old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


@test
def live_gate_wakes_on_a_changed_service_alert():
    sigs = ["A", "A", "B"]
    gate = C.live_gate(None, probe=lambda: (True, 0), alerts=lambda: sigs.pop(0), every_alerts=600)
    T = 1_800_000_000
    assert gate(T)[0] == "sleep"            # baseline A
    assert gate(T + 120)[0] == "sleep"      # not due
    assert gate(T + 600)[0] == "sleep"      # A again
    m, why = gate(T + 1200)
    assert m == "collect" and "alerts changed" in why, why
    gate = C.live_gate(None, probe=lambda: (True, 2))
    assert gate(T)[0] == "collect"


@test
def gate_command_keeps_an_explicit_mode_and_writes_the_step_output():
    import io, contextlib
    d = Path(tempfile.mkdtemp(prefix="sb-gate-"))
    out = d / "out.txt"
    old = os.environ.get("GITHUB_OUTPUT")
    os.environ["GITHUB_OUTPUT"] = str(out)
    try:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            assert C.main(["gate", "--mode", "sleep", "--slot", "a"]) == 0
        assert out.read_text(encoding="utf-8").strip() == "mode=sleep", out.read_text(encoding="utf-8")
    finally:
        if old is None:
            os.environ.pop("GITHUB_OUTPUT", None)
        else:
            os.environ["GITHUB_OUTPUT"] = old


class GatedSim:
    """A week of GitHub Actions with the gate: buses report on a weekday / weekend pattern (with a surprise
    night bus) unlike the timetable (night routes 'until 4:29', a weekend route that never runs), Passio answers
    empty on 35% of reads, crons fire rarely and late. Collect runs: 70 min logging that stops when the Activity
    says idle, Watcher with choose/early. Idle runs: Sleeper with a probing gate. Auto (cron) runs gate first."""

    BASE = int(datetime(2026, 10, 19, tzinfo=G.CT).timestamp())          # a Monday, 00:00 Chicago

    def __init__(self, seed, cron_p=0.1, empty_p=0.35, crash_p=0.0):
        self.rnd, self.cron_p, self.empty_p, self.crash_p = random.Random(seed), cron_p, empty_p, crash_p
        self.runs, self.live, self.future, self.next_id, self.t = [], [], [], 1, 0
        week = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
        self.service = {"routes": {
            "D": {"days": {k: {"spans": [["05:00", "10:15"]]} for k in week[:5]}, "exceptions": []},
            "F": {"days": {k: {"spans": [["05:00", "20:55"]]} for k in week}, "exceptions": []},
            "N": {"days": {k: {"spans": [["16:00", "28:29"]]} for k in week}, "exceptions": []}}}
        self.spans = sorted(x for k in range(-1, 9) for x in G.day_spans(
            self.service, (datetime.fromtimestamp(self.BASE, G.CT) + timedelta(days=k)).date()))

    def buses(self, t):
        """Live buses at sim time t (s from Monday 00:00)."""
        day, m = int(t // 86400), (t % 86400) / 60
        prev = (day - 1) % 7
        if (day % 7) < 5 and 4 * 60 + 50 <= m:
            return 3
        if (day % 7) >= 5 and 15 * 60 + 50 <= m:
            return 2
        if m < 40 and day > 0:                                               # until 00:40 every night
            return 1
        if day % 7 == 3 and 2 * 60 + 40 <= m < 3 * 60 + 50:                  # Thursday: a night bus at 2:40
            return 1
        return 0

    def read(self, t):
        return 0 if self.rnd.random() < self.empty_p else self.buses(t)

    def probe(self):
        for _ in range(3):
            n = self.read(self.t)
            if n:
                return True, n
        return True, 0

    def create(self, t, slot, event, mode):
        for o in self.live:
            if o["slot"] == slot and o["status"] == "pending":
                o["status"], o["end"] = "completed", t
        r = {"id": self.next_id, "slot": slot, "event": event, "mode": mode, "status": "pending", "created": t,
             "ciso": iso(t), "start": None, "dispatches": 0, "end": None, "log0": None, "log1": None}
        self.next_id += 1
        self.runs.append(r)
        self.live.append(r)

    def api(self, me):
        sim = self

        class Api:
            def workflow_state(self):
                return "active"

            def list_runs(self):
                return [{"databaseId": r["id"], "status": r["status"], "createdAt": r["ciso"]} for r in sim.runs[-40:]]

            def job_started(self, rid):
                r = next(x for x in sim.runs if x["id"] == rid)
                return iso(r["start"]) if r["start"] is not None and r["status"] == "in_progress" else None

            def dispatch(self, slot, mode="collect"):
                me["dispatches"] += 1
                sim.create(sim.t, slot, "workflow_dispatch", mode)
        return Api()

    def gate(self, now):
        ok, n = self.probe()
        v = G.decide(self.BASE + now, self.spans, None, ok, n)
        return v.mode, v.why

    def begin(self, r, t):
        r["status"], r["start"] = "in_progress", t
        limits = {}
        if r["mode"] == "auto":                    # an auto run with no bus becomes a short idle run itself
            mode, _ = self.gate(t)
            r["mode"] = mode
            limits = {"until": 4500, "hard": 5100}
            r["job_limit"] = 95 * 60
        if r["mode"] == "sleep":
            r["w"] = C.Sleeper(self.api(r), r["id"], r["slot"], t + 15, lambda now: self.gate(now), **limits)
            return
        r["log0"] = t + self.rnd.uniform(40, 120)
        r["log_cap"] = r["log0"] + (self.rnd.uniform(60, 4200) if self.rnd.random() < self.crash_p else 4200)
        r["act"], r["idle"] = None, False
        sim = self

        def choose(now):
            if r["act"] is None or (r["log1"] is not None and not r["idle"]):
                return "collect", "no logger status, or the logger ended early"
            v = r["act"].verdict(sim.BASE + now)
            return v.mode, v.why
        r["w"] = C.Watcher(self.api(r), r["id"], r["slot"], t + 20, choose=choose,
                           early=lambda now: r["idle"] or r["log1"] is not None)

    def tick(self, t):
        self.t = t
        if t % 1800 == 420 and self.rnd.random() < self.cron_p:
            self.future.append((t + self.rnd.uniform(0, 2400), "a" if t % 3600 == 420 else "b"))
        for ev in [e for e in self.future if e[0] <= t]:
            self.future.remove(ev)
            self.create(t, ev[1], "schedule", "auto")
        for slot in "ab":
            busy = any(r["slot"] == slot and r["status"] in ("queued", "in_progress") for r in self.live)
            pend = [r for r in self.live if r["slot"] == slot and r["status"] == "pending"]
            if not busy and pend:
                pend[0]["status"], pend[0]["ready"] = "queued", t + self.rnd.uniform(5, 90)
        for r in list(self.live):
            if r["status"] == "queued" and t >= r["ready"]:
                self.begin(r, t)
            if r["status"] != "in_progress":
                continue
            r["w"].step(t)
            if r["mode"] == "sleep":
                if r["w"].done or t >= r["start"] + r.get("job_limit", 355 * 60):
                    r["status"], r["end"] = "completed", t
                continue
            if r["log1"] is None and t >= r["log0"]:                       # logging (10 s polls)
                if r["act"] is None:
                    r["act"], r["gate_at"] = G.Activity(self.BASE + t, self.spans), t + 60
                r["act"].saw(self.BASE + t, {"fresh": self.read(t)})
                if t >= r["gate_at"]:
                    r["gate_at"] = t + 60
                    if r["act"].verdict(self.BASE + t).mode == "sleep":
                        r["idle"], r["log1"] = True, t
                if r["log1"] is None and t >= r["log_cap"]:
                    r["log1"] = t
                if r["log1"] is not None:
                    r["merged"] = r["log1"] + self.rnd.uniform(20, 240)
            duty = r["w"].state in C.WAITING and t < r["w"].deadline
            if (r["log1"] is not None and t >= r["merged"] and not duty) or t >= r["start"] + 95 * 60:
                if r["log1"] is None and r["log0"] is not None and t >= r["log0"]:
                    r["log1"] = t
                r["status"], r["end"] = "completed", t
        self.live = [r for r in self.live if r["status"] != "completed"]

    def go(self, hours):
        self.create(0, "a", "manual", "auto")
        for t in range(0, int(hours * 3600), 10):
            self.tick(t)
        return self

    def report(self, t_to):
        """-> dict: bus time covered, worst gap while buses run, logging hours, runner hours, max running."""
        n = int(t_to // 10)
        log_d, run_d = [0] * (n + 2), [0] * (n + 2)
        for r in self.runs:
            if r["start"] is None:
                continue
            end = r["end"] if r["end"] is not None else t_to
            run_d[int(r["start"] // 10)] += 1
            run_d[min(n, int(end // 10))] -= 1
            if r.get("log0") is not None:
                l1 = r["log1"] if r["log1"] is not None else end
                if l1 > r["log0"]:
                    log_d[int(r["log0"] // 10)] += 1
                    log_d[min(n, int(l1 // 10))] -= 1
        cl = cr = bus_bins = covered = gap = worst = mx = log_bins = run_bins = 0
        for i in range(n):
            cl, cr = cl + log_d[i], cr + run_d[i]
            mx, log_bins, run_bins = max(mx, cr), log_bins + cl, run_bins + cr
            if self.buses(i * 10):
                bus_bins += 1
                if cl:
                    covered, gap = covered + 1, 0
                else:
                    gap += 10
                    worst = max(worst, gap)
            else:
                gap = 0
        return {"bus_cover": covered / max(1, bus_bins), "worst_gap": worst, "log_h": log_bins / 360,
                "run_h": run_bins / 360, "bus_h": bus_bins / 360, "max_running": mx}


from datetime import timedelta


@test
def simulation_a_week_collects_every_bus_and_idles_otherwise():
    hours = 7 * 24
    worst, cover, ratio = 0, 1.0, []
    for seed in range(4):
        for cron_p in (0.0, 0.1):
            s = GatedSim(seed, cron_p=cron_p).go(hours)
            rep = s.report(hours * 3600)
            assert rep["max_running"] <= 2, (seed, rep)
            assert all(r["dispatches"] <= 1 for r in s.runs), seed
            worst, cover = max(worst, rep["worst_gap"]), min(cover, rep["bus_cover"])
            ratio.append(rep["log_h"] / rep["bus_h"])
            alive = [r for r in s.runs if r["start"] is not None and r["start"] > hours * 3600 - 6 * 3600]
            assert alive, (seed, cron_p, "the chain died")
    print(f"    8 x 1 week: buses {rep['bus_h']:.0f} h, logging {min(ratio):.2f}-{max(ratio):.2f} x the bus time "
          f"(before: ~{1.75 * hours / rep['bus_h']:.2f} x), runners {rep['run_h']:.0f} h of {hours * 1.75:.0f}, "
          f"worst gap while buses run {worst / 60:.1f} min, bus time covered >= {cover:.2%}")
    assert cover >= 0.995 and worst <= 8 * 60, (cover, worst)
    assert max(ratio) < 2.1, ratio


@test
def simulation_gated_with_crashing_loggers_stays_bounded():
    for seed in range(3):
        s = GatedSim(seed, cron_p=0.5, crash_p=0.2).go(72)
        rep = s.report(72 * 3600)
        assert rep["max_running"] <= 2 and all(r["dispatches"] <= 1 for r in s.runs), (seed, rep)
        assert rep["bus_cover"] >= 0.97, (seed, rep)


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

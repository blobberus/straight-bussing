#!/usr/bin/env python3
"""Asserts on tools/health.py (automatic collector health alerts, risk review 2026-11-01, DC-021).
  python tools/test_health.py        -> prints 'ok N tests', exits 1 on failure"""
import json, os, subprocess, sys, tempfile, traceback
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import health as H

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def at(d, hh, mm=0):
    return int(datetime(d.year, d.month, d.day, hh, mm, tzinfo=H.G.CT).timestamp())


def day_rows(d, every=120, start=(6, 0), end=(23, 30), routes=("East", "Central"), skip=None, pred=True):
    """Synthetic arrivals: each route every `every` s between start and end (Chicago), minus `skip` (a, b) epochs."""
    out, t, n = [], at(d, *start), 0
    while t < at(d, *end):
        for i, r in enumerate(routes):
            e = t + 7 * i
            if skip and skip[0] <= e < skip[1]:
                continue
            n += 1
            out.append((e, r, f"V{i}", f"S{n % 9}", "transition", pred, True))
        t += every
    return out


BASE = {"polls": 420, "rows": 300, "errors": 0, "fetch_errors": 2, "first_error": "", "bus_polls": 400,
        "max_fail_s": 20, "fail_spans": [], "schema_errors": 0, "schema_first": ""}


@test
def a_healthy_run_has_no_problem_and_may_become_the_good_code():
    p, ok = H.check_run(dict(BASE))
    assert p == {} and ok, (p, ok)
    p, ok = H.check_run({**BASE, "rows": 0, "bus_polls": 0, "polls": 200})     # a quiet run before the first bus
    assert p == {} and ok, (p, ok)


@test
def each_run_problem_is_named():
    p, ok = H.check_run(dict(BASE), code="fallback")
    assert p == {} and not ok, "fallback code never becomes the good code (check_code reports it)"
    assert "collector-ok" in H.check_code("fallback", "test_truth.py: FAILED")["code:fallback"]
    assert "No working collector code" in H.check_code("broken")["code:broken"] and H.check_code("main") == {}
    p, ok = H.check_run(dict(BASE), merge_outcome="failure", guard="arrivals: 12 row(s) lost (100 -> 88)")
    assert list(p) == ["run:guard"] and "12 row(s) lost" in p["run:guard"] and not ok, p
    p, ok = H.check_run(None)
    assert "run:crash" in p and not ok
    p, ok = H.check_run({**BASE, "polls": 0})
    assert "run:crash" in p and not ok
    spans = [[at(date(2026, 10, 28), 19, 31), at(date(2026, 10, 28), 20, 6)]]
    p, ok = H.check_run({**BASE, "max_fail_s": 2100, "fail_spans": spans, "fetch_errors": 320})
    k = next(k for k in p if k.startswith("run:outage:"))
    assert "35 min" in p[k] and "7:31 PM to 8:06 PM" in p[k], p[k]
    assert ok, "a Passio outage says nothing about our code"
    p, ok = H.check_run({**BASE, "schema_errors": 50, "schema_first": "vehiclePositions: no header.timestamp"})
    assert "run:schema" in p and "header.timestamp" in p["run:schema"] and not ok
    p, ok = H.check_run({**BASE, "rows": 0, "bus_polls": 300})
    assert "run:norows" in p and not ok
    p, ok = H.check_run(dict(BASE), merge_outcome="failure")
    assert "run:push" in p and not ok
    p, ok = H.check_run({**BASE, "errors": 500, "first_error": "detector update: KeyError"})
    assert "run:errors" in p and not ok
    p, ok = H.check_run({**BASE, "errors": 3})
    assert p == {} and ok
    p, ok = H.check_run(dict(BASE), log_outcome="failure")
    assert not ok, "a failed logging step never becomes the good code"


@test
def the_data_check_finds_a_gap_in_hours_that_always_have_arrivals():
    rows, d0 = [], date(2026, 10, 5)                   # a Monday; 4 weeks of weekdays as reference
    for k in range(30):
        d = d0 + timedelta(days=k)
        if d.weekday() < 5:
            gap = (at(d, 19, 31), at(d, 20, 11)) if d == date(2026, 10, 28) else None
            rows += day_rows(d, skip=gap)
    p = H.check_data(rows, at(date(2026, 10, 29), 18), calendar={})
    assert list(p) == ["data:gap:2026-10-28"], p
    assert "7:40 PM to 8:10 PM" in p["data:gap:2026-10-28"], p
    p = H.check_data(rows, at(date(2026, 10, 29), 21), calendar={})        # today: slots more than 80 min old only
    assert "data:gap:2026-10-29" not in p, p


@test
def the_data_check_flags_a_thin_day_a_missing_route_duplicates_and_missing_predictions():
    rows, d0 = [], date(2026, 10, 5)
    target = date(2026, 10, 28)
    for k in range(24):
        d = d0 + timedelta(days=k)
        if d.weekday() >= 5:
            continue
        if d == target:
            r = day_rows(d, routes=("East",), every=120, pred=False)              # Central gone, no predictions
            r += [(r[0][0] + 30, "East", r[0][2], r[0][3], "transition", False, True)]   # a duplicate
            r += [(r[1][0] + 1, "East", "", "S1", "transition", False, False)]           # no bus id
            rows += r
        else:
            rows += day_rows(d)
    p = H.check_data(rows, at(date(2026, 10, 29), 9), calendar={})
    assert "data:volume:2026-10-28" in p, p                # half the usual rows
    assert "data:route:2026-10-28:Central" in p and "logged 0" in p["data:route:2026-10-28:Central"], p
    assert "data:dups:2026-10-28" in p and "data:fields:2026-10-28" in p and "data:pred:2026-10-28" in p, p
    assert not any(k.endswith("2026-10-27") for k in p), p


@test
def breaks_and_holidays_pause_the_data_checks():
    rows, d0 = [], date(2026, 11, 2)
    for k in range(24):
        d = d0 + timedelta(days=k)
        if d.weekday() < 5 and d < date(2026, 11, 23):
            rows += day_rows(d)
    cal = {"regimes": [{"start": "2026-11-21", "end": "2026-11-29", "regime": "break"}]}
    assert H.check_data(rows, at(date(2026, 11, 25), 12), calendar=cal) == {}
    p = H.check_data(rows, at(date(2026, 11, 25), 12), calendar={})
    assert any(k.startswith("data:volume:2026-11-24") for k in p), p   # without the calendar it would alarm


@test
def the_archive_check_lists_missing_days_while_the_artifacts_still_exist():
    now = at(date(2026, 11, 1), 12)
    assets = set()
    d = date(2026, 10, 12)
    while d <= date(2026, 10, 30):
        for k in H.ARCHIVE_KINDS:
            assets.add(f"{k}-{d}.csv.gz" if k != "gtfs" else f"gtfs-{d}.zip")
        d += timedelta(days=1)
    assert H.check_archive(assets, now) == {}
    assets -= {"raw-polls-2026-10-20.csv.gz", "eta-2026-10-21.csv.gz"}
    p = H.check_archive(assets, now)
    assert "2026-10-20 (raw-polls)" in p["archive:missing"] and "2026-10-21 (eta)" in p["archive:missing"], p
    assert "about 78 days" in p["archive:missing"], p      # Oct 20 + 90 days = Jan 18


def quiet(*_):
    pass


@test
def the_watchdog_speaks_only_when_buses_run_and_nothing_collects_them():
    now = 1_800_000_000
    assert H.check_watchdog(0, now - 99999, now, False) == {}, "no bus: nothing to log"
    assert H.check_watchdog(5, now - 600, now, True) == {}
    assert H.check_watchdog(5, now - 30 * 60, now, False) == {}, "between runs, merges still fresh"
    p = H.check_watchdog(5, now - 50 * 60, now, False)
    assert "watchdog:stopped" in p and "no collect run is active" in p["watchdog:stopped"], p
    assert "only an idle run" in H.check_watchdog(5, now - 50 * 60, now, False, idle_only=True)["watchdog:stopped"]
    assert H.check_watchdog(5, now - 170 * 60, now, True) == {}
    assert "watchdog:stale" in H.check_watchdog(5, now - 200 * 60, now, True)
    assert "no arrival on the data branch" in H.check_watchdog(2, None, now, False)["watchdog:stopped"]


class FakeIssues:
    def __init__(self):
        self.issue, self.log = None, []

    def find(self):
        return None if self.issue is None else dict(self.issue)

    def create(self, body):
        self.issue = {"number": 7, "state": "OPEN", "body": body}
        self.log.append("create")
        return "https://github.com/x/y/issues/7"

    def edit(self, number, body):
        self.issue["body"] = body
        self.log.append("edit")

    def comment(self, number, text):
        self.log.append("comment: " + text)

    def reopen(self, number):
        self.issue["state"] = "OPEN"
        self.log.append("reopen")

    def close(self, number):
        self.issue["state"] = "CLOSED"
        self.log.append("close")


@test
def the_issue_opens_updates_quietly_and_closes_when_every_source_is_clear():
    api, t = FakeIssues(), 1_800_000_000
    assert H.update_issue(api, "run", {}, t, log=quiet) == "nothing" and api.log == []
    assert H.update_issue(api, "run", {"run:crash": "the logger crashed"}, t, log=quiet) == "open"
    assert "@blobberus" in api.issue["body"] and "the logger crashed" in api.issue["body"]
    assert H.update_issue(api, "run", {"run:crash": "the logger crashed again"}, t + 60, log=quiet) == "edit"   # no e-mail
    assert H.update_issue(api, "data", {"data:gap:d": "a gap"}, t + 120, log=quiet) == "comment"
    assert api.log[-1].startswith("comment: New collector problem") and "a gap" in api.log[-1]
    assert H.update_issue(api, "run", {}, t + 180, log=quiet) == "edit", "the data problem keeps it open"
    assert "a gap" in api.issue["body"] and "logger crashed" not in api.issue["body"].split("<!--")[0]
    assert H.update_issue(api, "data", {}, t + 240, log=quiet) == "close" and api.issue["state"] == "CLOSED"
    assert "All clear" in api.log[-2]
    st = H.parse_state(api.issue["body"])
    assert st["sources"] == {} and set(st["told"]) == {"run:crash", "data:gap:d"}


@test
def a_problem_already_told_does_not_reopen_an_issue_closed_by_hand():
    api, t = FakeIssues(), 1_800_000_000
    H.update_issue(api, "run", {"run:code": "fallback"}, t, log=quiet)
    api.issue["state"] = "CLOSED"                          # the owner closed it while the problem lasts
    assert H.update_issue(api, "run", {"run:code": "fallback"}, t + 600, log=quiet) == "edit-closed"
    assert api.issue["state"] == "CLOSED"
    assert H.update_issue(api, "run", {"run:code": "fallback", "run:push": "push failed"}, t + 900, log=quiet) == "reopen"
    assert api.issue["state"] == "OPEN" and "@blobberus" in api.log[-1] and "push failed" in api.log[-1]
    api.issue["state"] = "CLOSED"
    later = t + H.TOLD_KEEP_S + 1000                       # still there two weeks later: told again
    assert H.update_issue(api, "run", {"run:code": "fallback", "run:push": "push failed"}, later) == "reopen"


@test
def the_cli_never_fails_a_run_and_writes_healthy_for_the_tag_step():
    d = Path(tempfile.mkdtemp(prefix="sb-health-"))
    (d / "s.json").write_text(json.dumps(BASE), encoding="utf-8")
    out, summ = d / "out.txt", d / "summary.md"
    env = {**os.environ, "GITHUB_OUTPUT": str(out), "GITHUB_STEP_SUMMARY": str(summ), "GITHUB_REPOSITORY": "x/y",
           "PATH": ""}                                     # no gh on PATH: the issue update fails, the run does not
    tools = Path(__file__).resolve().parent
    r = subprocess.run([sys.executable, str(tools / "health.py"), "run", "--status", str(d / "s.json")],
                       capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0, r.stderr
    assert "healthy=true" in out.read_text(encoding="utf-8")
    assert "health issue: failed" in r.stdout, r.stdout
    r = subprocess.run([sys.executable, str(tools / "health.py"), "run", "--status", str(d / "missing.json"),
                        "--no-issue"], capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0 and "healthy=false" in out.read_text(encoding="utf-8").splitlines()[-1]
    assert "The logger wrote no status file" in r.stdout
    r = subprocess.run([sys.executable, str(tools / "health.py"), "data", "--dir", str(d / "nope"), "--skip-archive",
                        "--no-issue"], capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0 and "skipped" in r.stdout and "all clear" not in r.stdout, r.stdout   # never a vacuous clear
    (d / "self.txt").write_text("selftest: import arrival_detector: SyntaxError", encoding="utf-8")
    r = subprocess.run([sys.executable, str(tools / "health.py"), "code", "--code", "fallback", "--detail",
                        str(d / "self.txt"), "--no-issue"], capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0 and "SyntaxError" in r.stdout, r.stdout
    r = subprocess.run([sys.executable, str(tools / "health.py"), "report", "--source", "archive", "--problem",
                        "failed=The archive job failed", "--no-issue"], capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0 and "The archive job failed" in r.stdout


@test
def the_real_history_raises_only_the_real_outage():
    """Oct 12 to 31 from the data branch, when a copy is at hand (tools/test_health.py does not download it): the only
    data problem is the Oct 28 feed outage (DC-021)."""
    p = Path(os.environ.get("SB_ARRIVALS_DIR", "")) / "arrivals.csv"
    if not os.environ.get("SB_ARRIVALS_DIR") or not p.exists():
        return
    rows = H.read_rows(p.parent, 0)
    seen = set()
    d = date(2026, 10, 12)
    while d <= date(2026, 10, 31):
        seen |= set(H.check_data(rows, at(d, 23)))
        d += timedelta(days=1)
    assert seen == {"data:gap:2026-10-28"}, seen


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

#!/usr/bin/env python3
"""Daylight saving pinned across the collector tools (stdlib, no network): python tools/test_dst.py

Clocks fall back on Sunday 2026-11-01 at 2:00 AM Chicago (01:00 to 01:59 happens twice) and spring forward on
Sunday 2027-03-14 at 2:00 AM (02:00 to 02:59 never happens). The service day runs 04:00 to 04:00, so the
service day of Saturday 2026-10-31 is 25 hours long and the one of 2027-03-13 is 23 hours.
"""
import builtins, sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L          # noqa: E402
import build_eta_dataset as B     # noqa: E402
import raw_fetch as R             # noqa: E402
import service_gate as G          # noqa: E402
import context_fetch as C         # noqa: E402

try:
    from zoneinfo import ZoneInfo
    Z = ZoneInfo("America/Chicago")
except Exception:                 # no tz database here: compare against the rule itself
    Z = None

tests = []


def test(fn):
    tests.append(fn)
    return fn


def utc(y, m, d, h, mi=0):
    return int(datetime(y, m, d, h, mi, tzinfo=timezone.utc).timestamp())


def without_zoneinfo(fn):
    """Call fn() while `import zoneinfo` fails (the fallback rules)."""
    real = builtins.__import__

    def imp(name, *a, **k):
        if name == "zoneinfo":
            raise ImportError("test: no zoneinfo")
        return real(name, *a, **k)
    builtins.__import__ = imp
    try:
        return fn()
    finally:
        builtins.__import__ = real


def instants(*days):
    """Every 15 minutes over the given UTC days."""
    for y, m, d in days:
        t0 = utc(y, m, d, 0)
        yield from range(t0, t0 + 2 * 86400, 900)


@test
def fallback_rules_match_the_tz_database_at_both_changes():
    if Z is None:
        return
    ct = without_zoneinfo(G._chicago)                       # service_gate's own fallback tzinfo
    for t in instants((2026, 10, 31), (2027, 3, 13)):
        want = datetime.fromtimestamp(t, Z).replace(tzinfo=None)
        assert L.chicago(t, force_rule=True) == want, (t, L.chicago(t, force_rule=True), want)
        got = datetime.fromtimestamp(t, ct).replace(tzinfo=None)
        assert got == want, ("service_gate fallback", datetime.fromtimestamp(t, timezone.utc), got, want)


@test
def service_day_lengths_and_the_repeated_hour():
    a, b = B.day_bounds("2026-10-31")
    assert b - a == 25 * 3600, (b - a) / 3600
    a, b = B.day_bounds("2027-03-13")
    assert b - a == 23 * 3600, (b - a) / 3600
    # both copies of 01:30 and the hour after the change belong to Saturday's service day; 04:00 CST starts Sunday's
    for t in (utc(2026, 11, 1, 6, 30), utc(2026, 11, 1, 7, 30), utc(2026, 11, 1, 9, 30)):
        assert str(B.service_day_of(t)) == "2026-10-31", datetime.fromtimestamp(t, timezone.utc)
    assert str(B.service_day_of(utc(2026, 11, 1, 10, 0))) == "2026-11-01"
    assert B.day_bounds("2026-11-01")[0] == utc(2026, 11, 1, 10, 0)


@test
def raw_fetch_files_polls_by_the_same_service_day():
    for t in instants((2026, 10, 31), (2027, 3, 13)):
        assert R.service_day(t) == str(B.service_day_of(t)), (datetime.fromtimestamp(t, timezone.utc), R.service_day(t))


@test
def gtfs_time_zero_is_noon_minus_12_hours():
    # GTFS: stop times count from "noon minus 12 h" of the service day (equal to midnight except on change days)
    for day, noon_utc_h in (("2026-10-31", 17), ("2026-11-01", 18), ("2027-03-14", 17), ("2026-10-15", 17)):
        y, m, d = map(int, day.split("-"))
        assert B.local_midnight(day) == utc(y, m, d, noon_utc_h) - 12 * 3600, day


@test
def traffic_hours_turn_into_the_right_instant():
    cases = {   # Chicago wall clock -> UTC
        (2026, 10, 15, 8): utc(2026, 10, 15, 13),          # CDT
        (2026, 11, 1, 0): utc(2026, 11, 1, 5),             # still CDT
        (2026, 11, 1, 1): utc(2026, 11, 1, 6),             # the repeated hour: its first (CDT) copy
        (2026, 11, 1, 2): utc(2026, 11, 1, 8),             # CST from here on
        (2026, 11, 1, 5): utc(2026, 11, 1, 11),
        (2027, 3, 14, 1): utc(2027, 3, 14, 7),             # CST
        (2027, 3, 14, 3): utc(2027, 3, 14, 8),             # CDT after the skipped hour
        (2027, 1, 10, 12): utc(2027, 1, 10, 18),           # CST
    }
    for (y, m, d, h), want in cases.items():
        assert C.chicago_epoch(datetime(y, m, d, h)) == want, ((y, m, d, h), C.chicago_epoch(datetime(y, m, d, h)), want)
    rows = C.parse_regions([{"region_id": "1", "day": "2026-11-01T00:00:00.000", "hour": "3", "avg_speed": "20"}])
    assert rows[0]["epoch"] == utc(2026, 11, 1, 9) and rows[0]["local_time"] == "2026-11-01 03:00:00", rows


@test
def scheduled_spans_through_the_change():
    service = {"routes": {"N": {"days": {"sat": {"spans": [["16:00", "28:29"]]}, "sun": {"spans": [["16:00", "28:29"]]}}}}}
    (rid, a, b), = G.day_spans(service, date(2026, 10, 31))
    assert a == utc(2026, 10, 31, 21) and b == utc(2026, 11, 1, 10, 29), (a, b)   # 4:29 AM CST on the wall clock
    (rid, a, b), = G.day_spans(service, date(2026, 11, 1))
    assert a == utc(2026, 11, 1, 22) and b == utc(2026, 11, 2, 10, 29), (a, b)


if __name__ == "__main__":
    fails = 0
    for t in tests:
        try:
            t()
            print("pass", t.__name__)
        except AssertionError as e:
            fails += 1
            print("FAIL", t.__name__, e)
    print(("ok" if not fails else "FAILED"), f"{len(tests) - fails}/{len(tests)} tests")
    sys.exit(1 if fails else 0)

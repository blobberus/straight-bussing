#!/usr/bin/env python3
"""Tests for tools/usage_report.py (stdlib, no network): python tools/test_usage_report.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import usage_report as U  # noqa: E402

A, B, C = "a" * 32, "b" * 32, "c" * 32
S1, S2, S3, S4 = "1" * 32, "2" * 32, "3" * 32, "4" * 32


def start(v, s, day="2026-10-27", wd="2", t="08:15", app="browser", nu="0"):
    return {"received_utc": "x", "anon_id": v, "session_id": s, "day": day, "weekday": wd, "start_time": t, "app": app,
            "version": "2.0.0", "new_user": nu}


STARTS = [start(A, S1, nu="1"), start(A, S2, t="17:40"), start(B, S3, app="home-screen", nu="1"),
          start(C, S4, day="2026-10-26", wd="1", t="23:05")]
ENDS = [{"session_id": S1, "duration_s": "60"}, {"session_id": S1, "duration_s": "240"},   # largest per visit wins
        {"session_id": S3, "duration_s": "30"}, {"session_id": "9" * 32, "duration_s": "999"}]   # unknown visit: ignored
PLACES = [{"session_id": S1, "zone": "Reynolds Club"}, {"session_id": S2, "zone": "Reynolds Club"},
          {"session_id": S3, "zone": "'=Away"}]
tests = []


def test(fn):
    tests.append(fn)
    return fn


@test
def counts_distinct_visitors_and_visits():
    r = U.summarize(STARTS, ENDS, PLACES)
    assert "**3 distinct visitors**, 4 visits" in r, r
    assert "1 visitors came back" in r
    assert "| 2026-10-27 | Tue | 2 | 3 | 2 |" in r and "| 2026-10-26 | Mon | 1 | 1 | 0 |" in r


@test
def hours_in_twelve_hour_clock():
    r = U.summarize(STARTS, ENDS, PLACES)
    assert "| 8 AM | 2 | 50% | 2 |" in r and "| 5 PM | 1 |" in r and "| 11 PM | 1 |" in r, r


@test
def length_uses_the_largest_per_visit_and_ignores_unknown_visits():
    r = U.summarize(STARTS, ENDS, PLACES)
    assert "2 of 4 visits have a length" in r, r
    assert "Median **2.2 min**" in r   # median of 240 s and 30 s = 135 s
    assert "| 3 to 10 min | 1 |" in r and "| under 1 min | 1 |" in r


@test
def places_and_each_visitors_favorite():
    r = U.summarize(STARTS, ENDS, PLACES)
    assert "| Reynolds Club | 2 | 67% |" in r, r
    assert "| =Away | 1 | 33% |" in r   # the receiver's formula guard is removed for reading
    assert "Each visitor's most frequent place" in r


@test
def since_filters_by_day_and_empty_data_is_fine():
    r = U.summarize(STARTS, ENDS, PLACES, since="2026-10-27")
    assert "**2 distinct visitors**, 3 visits" in r
    assert "No visits in the data." in U.summarize([], [], [])
    assert "No visit lengths yet." in U.summarize(STARTS, [], [])


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

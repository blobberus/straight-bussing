#!/usr/bin/env python3
"""Tests for tools/build_gtfs.py build_timetable (web/data/timetable.json: Directions' "Leave at", owner 2026-11-09).
Stdlib only, hermetic (an in-memory GTFS zip): python tools/test_timetable.py"""
import io, json, sys, zipfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_gtfs as BG

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def gtfs(files):
    """An in-memory zip from {name: [header, row, ...]} (lists of strings, joined with commas)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, lines in files.items():
            z.writestr(name, "\n".join(",".join(r) for r in lines) + "\n")
    buf.seek(0)
    return zipfile.ZipFile(buf)


ST_HEAD = ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "shape_dist_traveled"]
BASE = {
    "feed_info.txt": [["feed_start_date", "feed_end_date"], ["20261108", "20261209"]],
    "calendar.txt": [["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
                      "start_date", "end_date"],
                     ["WK", "1", "1", "1", "1", "1", "0", "0", "20250101", "20271231"],
                     ["ALL", "1", "1", "1", "1", "1", "1", "1", "20250101", "20271231"],
                     ["OLD", "1", "1", "1", "1", "1", "1", "1", "20200101", "20201231"]],   # not in effect: left out
    "calendar_dates.txt": [["service_id", "date", "exception_type"],
                           ["WK", "20261126", "2"], ["WK", "20261128", "1"], ["WK", "20250101", "2"]],  # last: before the window
    "frequencies.txt": [["trip_id", "start_time", "end_time", "headway_secs"], ["F", "06:30:00", "07:30:00", "1500"]],
}


def build(trips, stop_times):
    files = dict(BASE)
    files["trips.txt"] = [["route_id", "service_id", "trip_id"]] + trips
    files["stop_times.txt"] = [ST_HEAD] + stop_times
    z = gtfs(files)
    tr = BG.rows(z, "trips.txt")
    sched = {}
    for st in BG.rows(z, "stop_times.txt"):
        a, d = BG.hms(st["arrival_time"]), BG.hms(st["departure_time"])
        a = d if a is None else a
        d = a if d is None else d
        dist = float(st["shape_dist_traveled"]) if st.get("shape_dist_traveled") else None
        sched.setdefault(st["trip_id"], []).append((int(st["stop_sequence"]), st["stop_id"], a, d, dist))
    return BG.build_timetable(z, tr, sched, BG.rows(z, "frequencies.txt"), today=date(2026, 11, 9))


def loop(tid, start, end, mid=("B", "C"), dist=(0, 100, 300, 400)):
    """A loop A -> B -> C -> A with only its ends timed (B and C interpolated by shape distance)."""
    ids = ("A",) + mid + ("A",)
    return [[tid, start if i == 0 else end if i == 3 else "", start if i == 0 else end if i == 3 else "", s, str(i + 1),
             str(dist[i])] for i, s in enumerate(ids)]


@test
def calendars_dates_and_the_feed_window():
    t = build([["R", "WK", "t1"]], loop("t1", "08:00:00", "08:20:00"))
    assert t["v"] == 1 and t["feed"] == {"start": "2026-11-08", "end": "2026-12-09"}, t["feed"]
    assert t["services"] == {"ALL": {"days": "1111111", "start": "2025-01-01", "end": "2027-12-31"},
                             "WK": {"days": "1111100", "start": "2025-01-01", "end": "2027-12-31"}}, t["services"]
    assert t["dates"] == {"2026-11-26": {"WK": 2}, "2026-11-28": {"WK": 1}}, t["dates"]


@test
def a_pattern_has_its_stops_interpolated_offsets_and_starts():
    t = build([["R", "WK", "t1"], ["R", "WK", "t2"]], loop("t1", "08:00:00", "08:20:00") + loop("t2", "08:30:00", "08:50:00"))
    assert t["routes"] == {"R": [{"stops": ["A", "B", "C", "A"], "t": [0, 300, 900, 1200],
                                  "starts": {"WK": [28800, 30600]}}]}, t["routes"]


@test
def a_different_run_time_is_its_own_pattern_most_trips_first():
    t = build([["R", "WK", "t1"], ["R", "WK", "t2"], ["R", "WK", "t3"]],
              loop("t1", "08:00:00", "08:40:00") + loop("t2", "09:00:00", "09:20:00") + loop("t3", "10:00:00", "10:20:00"))
    pats = t["routes"]["R"]
    assert [p["t"][-1] for p in pats] == [1200, 2400], pats
    assert pats[0]["starts"] == {"WK": [32400, 36000]} and pats[1]["starts"] == {"WK": [28800]}, pats


@test
def frequency_trips_expand_from_their_template_end_time_excluded():
    t = build([["D", "WK", "F"]], loop("F", "00:00:00", "00:10:00"))
    assert t["routes"]["D"][0]["starts"] == {"WK": [23400, 24900, 26400]}, t["routes"]["D"]   # 6:30, 6:55, 7:20


@test
def after_midnight_trips_of_a_night_route_move_past_24_00():
    # a night route from 4:00 PM writes its 12:30 AM trip as 00:30 of the same service day (service.json lists 16:00 to 24:50)
    t = build([["N", "ALL", "n1"], ["N", "ALL", "n2"], ["N", "ALL", "n3"]],
              loop("n1", "16:00:00", "16:20:00") + loop("n2", "23:30:00", "23:50:00") + loop("n3", "00:30:00", "00:50:00"))
    assert t["routes"]["N"][0]["starts"] == {"ALL": [57600, 84600, 88200]}, t["routes"]["N"]
    # a route that starts early in the morning keeps its morning trips on the same day
    m = build([["M", "WK", "m1"], ["M", "WK", "m2"]], loop("m1", "05:00:00", "05:20:00") + loop("m2", "10:00:00", "10:20:00"))
    assert m["routes"]["M"][0]["starts"] == {"WK": [18000, 36000]}, m["routes"]["M"]


@test
def a_trip_without_two_timepoints_or_with_backward_times_is_left_out():
    bad = [["b1", "08:00:00", "08:00:00", "A", "1", "0"], ["b1", "", "", "B", "2", "100"]]
    back = loop("b2", "09:00:00", "08:50:00")
    t = build([["R", "WK", "b1"], ["R", "WK", "b2"], ["R", "OLD", "t1"]], bad + back + loop("t1", "08:00:00", "08:20:00"))
    assert t["routes"] == {}, t["routes"]   # t1's service is not in effect during the feed


@test
def the_committed_file_is_small_and_matches_the_app_data():
    p = BG.OUT / "timetable.json"
    d = json.loads(p.read_text(encoding="utf-8"))
    assert p.stat().st_size < 40000, p.stat().st_size
    assert d["v"] == 1 and d["routes"] and d["services"], list(d)
    routes = json.loads((BG.OUT / "routes.json").read_text(encoding="utf-8"))
    for rid, pats in d["routes"].items():
        assert rid in routes, rid
        for pt in pats:
            assert len(pt["stops"]) == len(pt["t"]) >= 2 and pt["t"][0] == 0, (rid, pt["stops"][:3])
            assert all(b >= a for a, b in zip(pt["t"], pt["t"][1:])), rid
            for sid, starts in pt["starts"].items():
                assert sid in d["services"] and starts == sorted(starts), (rid, sid)
    # the 53rd Street Express (Regenstein to Vue53, the long way around): 7:00 AM to 7:00 PM on weekdays
    s53 = [x for pt in d["routes"]["4346"] for v in pt["starts"].values() for x in v]
    assert min(s53) == 7 * 3600 and max(s53) == 19 * 3600, (min(s53), max(s53))


def main():
    fails = 0
    for fn in TESTS:
        try:
            fn()
            print("pass", fn.__name__)
        except Exception as e:   # noqa: BLE001
            fails += 1
            print("FAIL", fn.__name__, "-", repr(e))
    print(("ok" if not fails else f"{fails} failed"), f"{len(TESTS) - fails}/{len(TESTS)} tests")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

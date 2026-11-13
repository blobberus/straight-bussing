#!/usr/bin/env python3
"""Tests for tools/collection_flags.py (per-line data-collection flags, owner 2026-11-13). Stdlib, offline, hermetic:
every case builds its own arrival rows, tracks and timetable in memory (or in a temporary folder).

  python tools/test_collection_flags.py
"""
import csv, gzip, json, math, sys, tempfile, traceback
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import collection_flags as C
from service_gate import CT

TESTS = []
DAY = "2026-11-10"                       # a Tuesday (standard time)
LAT0, LON0 = 41.7900, -87.6000           # a straight north-south street for the test routes
M_LAT = 1 / 111320.0                     # degrees of latitude per metre


def test(fn):
    TESTS.append(fn)
    return fn


def at(hh, mm=0, ss=0, day=DAY):
    """Epoch of a Chicago clock time on a calendar day."""
    y, mo, d = (int(x) for x in day.split("-"))
    return int(datetime(y, mo, d, hh, mm, ss, tzinfo=CT).timestamp())


def north(m):
    """(lat, lon) m metres north of the origin on the test street."""
    return LAT0 + m * M_LAT, LON0


class St:
    """A tiny AL.Static stand-in: route A runs north on the street (stops every 400 m), route B runs east on a street
    1 km away (no stop near A's)."""
    def __init__(self):
        self.stops = {f"a{i}": {"lat": north(400 * i)[0], "lon": LON0, "name": f"A stop {i}"} for i in range(5)}
        self.route_stops = {"A": [f"a{i}" for i in range(5)]}
        self.variant_only = {}
        self.shapes = {"A": [[list(north(0)), list(north(1600))]],
                       "B": [[[LAT0 + 1000 * M_LAT, LON0 - 0.02], [LAT0 + 1000 * M_LAT, LON0 + 0.02]]]}
        self.routes = {"A": {"long": "Route A"}, "B": {"long": "Route B"}}
        self.service = {"routes": {r: {"days": {d: {"spans": [["06:00", "22:00"]]} for d in C.DOWS}} for r in ("A", "B")}}

    def route_name(self, rid):
        return self.routes.get(rid, {}).get("long", rid)


class Statics:
    def __init__(self, trips=None):
        st = St()
        self.s = {"key": "t", "st": st, "trips": trips or {"t1": "A", "t2": "B"}, "service": st.service, "routes": st.routes}

    def for_day(self, day):
        return self.s


def arow(e, rid="A", stop="a1", veh="1", source="transition", trip="t1"):
    return {"epoch": e, "day": C.service_day(e), "route_id": rid, "route": f"Route {rid}", "trip_id": trip,
            "vehicle_id": veh, "stop_id": stop, "source": source}


# ---------------------------------------------------------------- time helpers
@test
def test_service_day_and_clock_across_daylight_saving():
    assert C.service_day(at(3, 59, day="2026-11-11")) == "2026-11-10"      # before 04:00 = the day before
    assert C.service_day(at(4, 0, day="2026-11-11")) == "2026-11-11"
    # Nov 1 2026: clocks go back at 2 AM; a listed '24:55' of Oct 31 is 00:55 CDT Nov 1, '28:00' is 04:00 CST
    assert C.clock_epoch("2026-10-31", "24:55") == int(datetime(2026, 11, 1, 0, 55, tzinfo=CT).timestamp())
    assert C.clock_epoch("2026-10-31", "28:00") - C.clock_epoch("2026-10-31", "24:00") == 5 * 3600


@test
def test_outside_listed_hours_uses_the_e30_pads():
    sp = [(at(6), at(22))]
    assert not C.outside(sp, at(12))
    assert not C.outside(sp, at(22, 15))                  # 15 min after the end: still inside the pad
    assert C.outside(sp, at(22, 16))
    assert not C.outside(sp, at(5, 30))                   # 30 min before the start: inside
    assert C.outside(sp, at(5, 29))
    assert C.outside([], at(12))                          # not listed that day at all


# ---------------------------------------------------------------- arrival-row measures
@test
def test_arrival_facts_sources_predictions_and_trips():
    e = at(12)
    arr = [arow(e, source="gps", trip=""), arow(e + 600, stop="a2", source="pass"), arow(e + 1200, stop="a3"),
           arow(e + 1800, stop="a4", trip="t2"), arow(e + 2400, stop="a0", trip="zz"), arow(at(23, 30), stop="a1")]
    preds = {("1", "a3"): [e + 1200 + 50]}               # within 60 s: a Passio time; a2 and a4 have none
    det = defaultdict(C.new_det)
    F, names = C.arrival_facts(arr, preds, Statics(), det)
    c = F[(DAY, "A")]
    assert c["rows"] == 6 and c["gps_rows"] == 1 and c["pass_rows"] == 1
    assert c["pred_target_rows"] == 5 and c["nopred_rows"] == 4          # gps rows are never a target
    assert c["trip_rows"] == 5 and c["trip_other_route"] == 1 and c["trip_unknown"] == 1 and c["trip_bad_rows"] == 2
    assert c["outside_rows"] == 1 and c["hours_rows"] == 6
    assert det[(DAY, "A", "gps_only_rows")]["s"]["a1"] == 1
    assert det[(DAY, "A", "trip_not_in_timetable")]["o"] == Counter({"B": 1, "none": 1})
    assert names["A"] == "Route A"


@test
def test_double_logged_needs_the_same_stop_back_to_back():
    e = at(12)
    arr = [arow(e), arow(e + 400), arow(e + 800, stop="a2"), arow(e + 1000, stop="a1"), arow(e + 2000, stop="a1")]
    F, _ = C.arrival_facts(arr, {}, None, defaultdict(C.new_det))
    # e+400 repeats a1 right after a1 (400 s); e+1000 follows a2; e+2000 is 1,000 s after e+1000 (> 900 s)
    assert F[(DAY, "A")]["double_rows"] == 1


@test
def test_thin_days_against_the_weekday_median():
    F = defaultdict(Counter)
    tuesdays = ["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10"]
    for d, n in zip(tuesdays, (100, 104, 98, 40)):
        F[(d, "A")]["rows"] = n
        F[(d, "B")]["rows"] = 5                            # median 5 < THIN_MIN_MEDIAN: never thin
    C.thin_days(F, Statics(), tuesdays, ["A", "B"])
    assert [F[(d, "A")]["thin_day"] for d in tuesdays] == [0, 0, 0, 1]
    assert F[("2026-11-10", "A")]["weekday_median"] == 99 and F[("2026-11-10", "A")]["listed_day"] == 1
    assert sum(F[(d, "B")]["thin_day"] for d in tuesdays) == 0


# ---------------------------------------------------------------- geometry
@test
def test_route_stops_hits_only_in_the_route_direction():
    geo = C.RouteStops(St())
    (la0, lo0), (la1, lo1) = north(350), north(450)        # passes a1 (400 m) going north
    assert [s for s, _ in geo.hits("A", la0, lo0, la1, lo1)] == ["a1"]
    assert geo.hits("A", la1, lo1, la0, lo0) == []         # the same street southbound: the far side
    (la2, lo2) = north(410)
    assert geo.hits("A", la2, lo2, la1, lo1) == []         # starts inside the circle: leaving the stop
    (la3, lo3) = north(405)
    assert geo.hits("A", la0, lo0, la3, lo3 + 0) != []     # ends inside: arriving
    assert geo.hits("A", la0, lo0, la0 + 5 * M_LAT, lo0) == []   # under 15 m: jitter


def track_on(rid, t0, minutes, step=10, start_m=0, speed=8.0, street="A"):
    """Reports every `step` s for `minutes`, labeled rid, driving north on A's street (or east and round again on B's)."""
    out = []
    for k in range(int(minutes * 60 / step)):
        m = start_m + speed * step * k
        if street == "A":
            lat, lon = north(m)
        else:
            lat, lon = LAT0 + 1000 * M_LAT, LON0 - 0.015 + (m % 2500) / (111320.0 * math.cos(math.radians(LAT0)))
        out.append((t0 + k * step, rid, "t1", lat, lon, speed))
    return out


@test
def test_wrong_label_episode_needs_thirty_minutes_on_another_line():
    lidx = C.LineIndex(St().shapes)
    t0 = (at(12) // C.BIN_S) * C.BIN_S
    eps = C.wrong_label_episodes({"7": track_on("A", t0, 40, street="B")}, lidx)
    assert len(eps) == 1 and eps[0][1:3] == ("A", "B") and eps[0][5] == 4
    assert C.wrong_label_episodes({"7": track_on("A", t0, 20, street="B")}, lidx) == []   # 2 bins: too short
    assert C.wrong_label_episodes({"7": track_on("A", t0, 40)}, lidx) == []               # on its own line


@test
def test_frozen_runs_only_while_moving():
    t0 = at(12)
    lat, lon = north(100)
    frozen = [(t0 + 60 * k, "A", "t1", lat, lon, 6.0) for k in range(6)]
    assert C.frozen_runs(frozen) == [("A", t0, t0 + 300)]
    standing = [(t0 + 60 * k, "A", "t1", lat, lon, 0.0) for k in range(6)]
    assert C.frozen_runs(standing) == []                    # a parked bus is not frozen
    jumped = standing + [(t0 + 330, "A", "t1", north(400)[0], lon, 0.0)]
    assert C.frozen_runs(jumped) == [("A", t0, t0 + 300)]   # its next report 300 m away within 60 s


@test
def test_poll_facts_visits_gaps_and_listed_time():
    t0 = (at(12) // C.BIN_S) * C.BIN_S
    tr = track_on("A", t0, 3, speed=10.0)                   # 0 to 1,700 m in 3 min: passes a1..a4 (a0: starts on it)
    t_a1 = t0 + 40                                          # 400 m at 10 m/s
    arr = {"1": [arow(t_a1 + 5, stop="a1"), arow(t0 + 125, stop="a3", rid="B")]}
    polls = C.DayPolls.from_tracks({"1": tr})
    det = defaultdict(C.new_det)
    F, eps, missed, stops = C.poll_facts(DAY, polls, Statics().s, arr, det)
    c = F["A"]
    assert c["visits"] == 4                                 # a1, a2, a3, a4 (a0: the track starts on it)
    assert c["visits_logged"] == 1 and c["visits_other_line"] == 1 and c["visits_missed"] == 2
    assert sorted(m[2] for m in missed) == ["a2", "a4"]
    assert stops[("A", "a3")]["logged_other_line"] == 1
    assert c["listed_bins"] == 1 and c["listed_nobus_bins"] == 0   # only the one bin had the feed alive
    assert abs(c["online_min"] - (len(tr) - 1) * 10 / 60) < 1e-6
    # a 3-min hole while the bus drove 1.8 km with another bus reporting all along -> a report gap
    other = [(t0 + 10 * k, "B", "t2", north(0)[0], LON0, 0.0) for k in range(60)]
    gap = [r for r in tr if r[0] < t0 + 20] + [(t0 + 200, "A", "t1", north(1500)[0], LON0, 10.0)]   # 190 s, 1.4 km
    polls2 = C.DayPolls.from_tracks({"1": gap, "2": other})
    F2, *_ = C.poll_facts(DAY, polls2, Statics().s, {}, defaultdict(C.new_det))
    assert F2["A"]["gaps"] == 1 and abs(F2["A"]["gap_min"] - 190 / 60) < 1e-6


@test
def test_day_polls_reads_fresh_reports_and_unknown_routes():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / f"raw-polls-{DAY}.jsonl.gz"
        h = at(12)
        polls = [{"t": h, "h": h, "v": [["1", "t1", "A", LAT0, LON0, 0, 5.0, 1, "a0", None, h - 5],
                                         ["2", "", "", LAT0, LON0, 0, 0.0, 1, "", None, h - 5],
                                         ["3", "t1", "A", LAT0, LON0, 0, 0.0, 1, "a0", None, h - 900]]},     # stale
                 {"t": h + 10, "h": h + 10, "v": [["1", "t1", "A", LAT0, LON0, 0, 5.0, 1, "a0", None, h - 5]]}]  # repeat
        with gzip.open(p, "wt", encoding="utf-8") as f:
            for q in polls:
                f.write(json.dumps(q) + "\n")
        dp = C.DayPolls(p, DAY, {"A": {}})
        assert list(dp.tracks) == ["1"] and len(dp.tracks["1"]) == 1
        assert dp.unknown == Counter({"": 1}) and dp.polls == [h, h + 10]


# ---------------------------------------------------------------- grading and flags
def srow(m="gps_only_rows", value=30.0, base=10.0, den=1000, events=300, over=(5, 5, 5), rid="A", period="all"):
    return {"period": period, "route_id": rid, "route": f"Route {rid}", "measure": m, "value": value, "baseline": base,
            "numerator": value * den / 100, "denominator": den, "unit": "rows", "events": events, "days": 20,
            "data_from": "2026-10-10", "data_to": "2026-11-11", "ratio": value / base, "excess": value - base,
            "days_over_high": over[0], "days_over_medium": over[1], "days_over_low": over[2]}


@test
def test_grade_follows_the_collection_rule():
    assert C.grade("gps_only_rows", srow()) == "high"                         # 3 x, +20 points, n 1000, 5 days
    assert C.grade("gps_only_rows", srow(over=(2, 5, 5))) == "medium"         # high on 2 days only
    assert C.grade("gps_only_rows", srow(value=16.0)) == "medium"             # 1.6 x, +6 points
    assert C.grade("gps_only_rows", srow(value=13.0)) == "low"                # 1.3 x, +3 points
    assert C.grade("gps_only_rows", srow(value=13.0, over=(0, 0, 1))) == ""   # one day over: no flag
    assert C.grade("double_logged_visits", srow("double_logged_visits", 0.15, 0.06)) == ""   # 2.5 x of almost nothing
    assert C.grade("gps_only_rows", srow(den=200, events=60)) == "medium"     # n under 300
    assert C.grade("thin_line_days", srow("thin_line_days", 40.0, 2.0, den=25, events=10)) == "medium"   # never high


@test
def test_scope_helpers():
    assert C.hour_ranges(Counter({18: 10, 19: 9, 20: 8, 3: 1, 12: 1})) == "18-20"
    assert C.hour_ranges(Counter({23: 5, 0: 5})) == "0-1|23-24"
    assert C.hour_ranges(Counter({h: 1 for h in range(24)})) == ""           # spread over the day
    assert C.top_share(Counter({"4322": 8, "4331": 1, "12": 1})) == ["4322"]
    assert C.top_share(Counter({str(k): 1 for k in range(10)})) == []
    num, den = Counter({"s1": 40, "s2": 2, "s3": 1}), Counter({"s1": 50, "s2": 100, "s3": 100})
    assert C.hot_stops(num, den, line_rate=17.0) == ["s1"]
    assert C.hot_stops(Counter({"s1": 5, "s2": 5, "s3": 5}), Counter({"s1": 50, "s2": 50, "s3": 50}), 10.0) == []


def fake_col():
    F = defaultdict(Counter)
    days = [f"2026-11-{d:02d}" for d in range(2, 7)]                          # Mon to Fri
    for d in days:
        F[(d, "A")].update(rows=100, gps_rows=40)
        F[(d, "B")].update(rows=300, gps_rows=15)
    det = defaultdict(C.new_det)
    for d in days:
        det[(d, "A", "gps_only_rows")]["v"]["4331"] += 40
        det[(d, "A", "gps_only_rows")]["s"]["a1"] += 40
        det[(d, "A", "rows:all")]["s"].update({"a1": 50, "a2": 50})
    return {"F": F, "det": det, "names": {"A": "Route A", "B": "Route B"}, "days": days, "episodes": [],
            "missed": [], "stops": {}, "fleet": {}}


@test
def test_build_flags_writes_valid_registry_rows():
    import flag_lines as FL
    col = fake_col()
    summary = C.summarize(col)
    prev = [{"flag_id": "collection:gps_only_rows:A", "first_flagged": "2026-11-09"}]
    flags = C.build_flags(summary, col, "2026-11-13", prev)
    assert [f["flag_id"] for f in flags] == ["collection:gps_only_rows:A"]
    f = flags[0]
    assert f["severity"] == "high" and f["status"] == "open" and f["first_flagged"] == "2026-11-09"
    assert f["value"] == "40.000" and f["baseline"] == "13.750" and f["n"] == "500"
    assert f["metric"].endswith("(percent; all collected days)")
    sc, problems, warns = FL.parse_scope(f["scope"])
    assert not problems and not warns, (problems, warns)
    assert sc["stops"] == ["a1"] and sc["vehicles"] == ["4331"] and sc["days"] == ["weekday"]
    routes = {"A": ("Route A", ""), "B": ("Route B", "")}
    p, w = FL.validate_row(f, routes, None)                                    # category checked by the registry
    assert p == [] or p == ["category 'collection' is not one of transition, prediction_miss, display"], p
    assert "data/labeled/collection/line_summary.csv" in f["evidence"] and "773" not in f["agent_action"]


@test
def test_write_csv_is_deterministic_and_gzips_without_a_timestamp():
    with tempfile.TemporaryDirectory() as tmp:
        a, b = Path(tmp) / "a.csv.gz", Path(tmp) / "b.csv.gz"
        rows = [{"x": 1.0, "y": 2.25}, {"x": "s", "y": 3}]
        C.write_csv(a, ["x", "y"], rows, gz=True)
        C.write_csv(b, ["x", "y"], rows, gz=True)
        assert a.read_bytes() == b.read_bytes()
        assert gzip.decompress(a.read_bytes()).decode() == "x,y\n1,2.2\ns,3\n" or \
            gzip.decompress(a.read_bytes()).decode() == "x,y\n1,2.3\ns,3\n"


@test
def test_stop_logging_tells_a_missed_stop_from_one_not_driven():
    days = [f"2026-11-{d:02d}" for d in range(2, 12)]                        # 10 days
    col = {"F": defaultdict(Counter), "det": defaultdict(C.new_det), "names": {"A": "Route A"}, "days": days,
           "stops": defaultdict(Counter), "line_stops": {}, "episodes": [], "missed": []}
    for d in days:
        col["F"][(d, "A")]["rows"] = 400
        col["line_stops"][(d, "A")] = {"s1", "s2", "s3", "s4", "s5"}
        col["det"][(d, "A", "rows:all")]["s"].update({"s1": 100, "s2": 100, "s3": 100, "s4": 2, "s5": 1})
        for sid, m in (("s1", 5), ("s2", 8), ("s3", 3), ("s4", 63)):                # s5: never within 500 m
            col["stops"][(d, "A", sid)]["closest_m"] = m
    sl = C.stop_logging(col, days)
    assert sl[("A", "s4")]["rare"] and sl[("A", "s4")]["closest_m"] == 63 and sl[("A", "s4")]["line_median"] == 1000
    assert sl[("A", "s5")]["rare"] and sl[("A", "s5")]["closest_m"] is None and not sl[("A", "s1")]["rare"]
    rows = {(r["period"], r["route_id"], r["measure"]): r for r in C.stop_summary(col)}
    r = rows[("all", "A", "stops_rarely_logged")]
    assert r["grade"] == "high" and r["numerator"] == 1 and [x for x, _ in r["stops"]] == ["s4"]
    assert rows[("all", "A", "listed_stops_not_driven")]["grade"] == "low"
    assert rows[("all", "ALL", "stops_rarely_logged")]["grade"] == ""


if __name__ == "__main__":
    failed = 0
    for fn in TESTS:
        try:
            fn()
            print(f"ok   {fn.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"{len(TESTS) - failed}/{len(TESTS)} passed")
    sys.exit(1 if failed else 0)

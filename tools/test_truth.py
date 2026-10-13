#!/usr/bin/env python3
"""Asserts on the ground-truth arrival detector (tools/arrivals_lib.py) using synthetic bus positions.
  python tools/test_truth.py        -> prints 'ok N tests', exits 1 on failure"""
import json, math, random, sys, tempfile, traceback
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L
from arrival_detector import Tracker

SPEC_HEADER = ("epoch,ts_utc,local_time,dow,hour,minute_of_day,route_id,route_name,trip_id,vehicle_id,stop_id,"
               "stop_name,stop_address,stop_lat,stop_lon,stop_index,prev_stop_id,dist_prev_m,prev_arrival_epoch,"
               "segment_s,speed_mps,dwell_s,passio_pred_epoch,passio_pred_lead_s,source")
LAT, LON0, STEP = 41.79, -87.600, 0.003            # stops ~249 m apart on an east-west line
T0 = 1791400000


def fake_static():
    st = L.Static(web_data=Path(tempfile.gettempdir()) / "sb-no-such-dir")
    st.stops = {s: {"name": "Stop " + s, "lat": LAT, "lon": LON0 + STEP * i} for i, s in enumerate("ABCD")}
    st.stops["X"] = {"name": "Off-route", "lat": LAT + 0.01, "lon": LON0}
    st.route_stops = {"R": ["A", "B", "C", "D", "A"], "S": ["A", "B", "X", "D", "A"]}
    st.routes = {"R": {"short": "R", "long": "Test Loop"}, "S": {"short": "S", "long": "Skip Loop"}}
    return st


def simulate(st, path, t0=T0, speed=8.0, dwell=20, poll=10, trip="T1", veh="V1", route="R",
             no_stop=(), noise_m=0.0, seed=1, lead_m=150.0, flip_m=None):
    """Bus drives in from `lead_m` m west of the first stop, then along `path` (stop ids, route
    order), dwelling at each stop except `no_stop`. stop_id = the stop being approached; it switches
    to the next stop on departure, or (Passio-like, `flip_m`) once the bus is within flip_m of it.
    -> (reports, truth {path index: arrival epoch})"""
    rnd = random.Random(seed)
    pts = [(st.stops[s]["lat"], st.stops[s]["lon"]) for s in path]
    start = (pts[0][0], pts[0][1] - lead_m / (111320 * math.cos(math.radians(LAT))))
    tl, t = [], float(t0)                          # (arrive, depart) per path index
    for i in range(len(path)):
        t += L.hav_m(*(pts[i - 1] if i else start), *pts[i]) / speed
        dw = 0 if path[i] in no_stop else dwell
        if i == 0 and not lead_m:
            dw = max(dw, 15)                       # already waiting at its first stop
        tl.append((t, t + dw))
        t += dw
    reps, now = [], t0 + 3
    while now < tl[-1][1] + 25:
        i = next((k for k, (a, d) in enumerate(tl) if now <= d), len(tl) - 1)
        a, d = tl[i]
        if now >= a:
            lat, lon, sp = pts[i][0], pts[i][1], 0.0
        else:
            p0, ts = (pts[i - 1], tl[i - 1][1]) if i else (start, t0)
            f = (now - ts) / (a - ts)
            lat, lon, sp = p0[0] + f * (pts[i][0] - p0[0]), p0[1] + f * (pts[i][1] - p0[1]), speed
        si = i + 1 if flip_m and i + 1 < len(path) and L.hav_m(lat, lon, *pts[i]) <= flip_m else i
        if noise_m:
            lat += rnd.gauss(0, noise_m) / 111320
            lon += rnd.gauss(0, noise_m) / (111320 * math.cos(math.radians(LAT)))
        reps.append({"veh": veh, "trip": trip, "route": route, "lat": lat, "lon": lon, "speed": sp,
                     "q": None, "stop_id": path[si], "vt": int(now)})
        now += poll
    return reps, {i: a for i, (a, _) in enumerate(tl)}


def run(tr, reps, final=True):
    out = []
    for r in reps:
        out += tr.update(r, r["vt"] + 2)
        out += tr.drain(r["vt"] + 2)
    if final:
        out += tr.drain(reps[-1]["vt"] + 5, final=True)
    return sorted(out, key=lambda e: e["epoch"])


TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


@test
def header_matches_spec():
    assert ",".join(L.COLUMNS) == SPEC_HEADER and len(L.COLUMNS) == 25


@test
def basic_loop_every_stop_once_within_10s():
    st = fake_static()
    reps, truth = simulate(st, ["A", "B", "C", "D", "A"])
    ev = run(Tracker(st), reps)
    assert [e["idx"] for e in ev] == [0, 1, 2, 3, 4], [e["idx"] for e in ev]
    for e in ev:
        assert abs(e["epoch"] - truth[e["idx"]]) <= 10, (e["idx"], e["epoch"] - truth[e["idx"]])
    for e in ev[:-1]:
        assert e["dwell"] is not None and 10 <= e["dwell"] <= 30, e["dwell"]
    rows = [dict(zip(L.COLUMNS, L.fmt_row(st, e))) for e in ev]
    for r in rows[1:]:
        assert r["prev_stop_id"] and float(r["dist_prev_m"]) > 0, r
        assert 0 < float(r["speed_mps"]) <= 20, r["speed_mps"]
    assert rows[0]["prev_stop_id"] == "" and rows[4]["stop_index"] == 4 and rows[4]["stop_id"] == "A"


@test
def pass_through_without_stopping_is_a_transition():
    st = fake_static()
    reps, truth = simulate(st, ["A", "B", "C", "D"], no_stop={"C"}, seed=3)
    ev = run(Tracker(st), reps)
    c = [e for e in ev if e["idx"] == 2]
    assert len(c) == 1 and c[0]["source"] == "transition", ev
    assert abs(c[0]["epoch"] - truth[2]) <= 10, c[0]["epoch"] - truth[2]


@test
def gps_jitter_and_stop_id_flapping_do_not_duplicate():
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "C", "D"], noise_m=8.0, seed=5)
    flap = []
    for r in reps:                                  # stop_id bounces back for one report after each switch
        if flap and flap[-1]["stop_id"] != r["stop_id"]:
            flap.append(dict(r))
            flap.append(dict(r, stop_id=flap[-2]["stop_id"], vt=r["vt"] + 3))
            flap.append(dict(r, vt=r["vt"] + 6))
        else:
            flap.append(r)
    ev = run(Tracker(st), flap)
    idx = [e["idx"] for e in ev]
    assert sorted(idx) == [0, 1, 2, 3] and len(set(idx)) == len(idx), idx


@test
def skipped_stop_links_previous_seen_stop():
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "D"], route="S")     # X is never approached
    ev = run(Tracker(st), reps)
    assert [e["idx"] for e in ev] == [0, 1, 3], [e["idx"] for e in ev]
    r = dict(zip(L.COLUMNS, L.fmt_row(st, ev[2])))
    assert r["prev_stop_id"] == "B" and float(r["dist_prev_m"]) > 400, r


@test
def trip_flip_at_terminal_is_one_visit():
    st = fake_static()
    r1, t1 = simulate(st, ["A", "B", "C", "D", "A"], trip="T1", dwell=20)
    end = r1[-1]["vt"]
    r2, t2 = simulate(st, ["A", "B", "C"], t0=end + 7, trip="T2", dwell=120, lead_m=0)
    tr = Tracker(st)
    ev = run(tr, r1 + r2)
    keys = [(e["trip"], e["idx"]) for e in ev]
    assert ("T1", 4) in keys and ("T2", 0) not in keys and ("T2", 1) in keys, keys
    term = next(e for e in ev if e["trip"] == "T1" and e["idx"] == 4)
    assert term["dwell"] and term["dwell"] > 100, term["dwell"]       # layover measured on old trip
    r = dict(zip(L.COLUMNS, L.fmt_row(st, next(e for e in ev if e["trip"] == "T2" and e["idx"] == 1))))
    assert r["prev_stop_id"] == "A" and int(r["prev_arrival_epoch"]) == term["epoch"], r
    assert r["speed_mps"] and 3 < float(r["speed_mps"]) <= 20, r["speed_mps"]


@test
def trip_id_flips_on_arrival_at_terminal():
    """Old trip only ever seen heading to the terminal; the new trip id appears as the bus gets there."""
    st = fake_static()
    r1, t1 = simulate(st, ["A"], dwell=0, trip="T1", lead_m=200)
    r1 = [r for r in r1 if r["vt"] < t1[0]]
    r2, _ = simulate(st, ["A", "B", "C"], t0=int(t1[0]), trip="T2", lead_m=0, flip_m=45, dwell=30)
    ev = run(Tracker(st), r1 + r2)
    keys = [(e["trip"], e["idx"]) for e in ev]
    assert keys[0] == ("T1", 4) and ("T2", 0) not in keys and ("T2", 1) in keys, keys
    assert abs(ev[0]["epoch"] - t1[0]) <= 10, ev[0]["epoch"] - t1[0]
    r = dict(zip(L.COLUMNS, L.fmt_row(st, next(e for e in ev if e["trip"] == "T2" and e["idx"] == 1))))
    assert r["prev_stop_id"] == "A" and int(r["prev_arrival_epoch"]) == ev[0]["epoch"], r


KX = 111320 * math.cos(math.radians(LAT))          # metres per degree of longitude
B_EAST = STEP * KX                                 # stop B, metres east of stop A (~249)


def rep_m(east, north, stop_id, vt, speed, trip="T1", veh="V1", route="R"):
    """A report `east` / `north` metres from stop A."""
    return {"veh": veh, "trip": trip, "route": route, "lat": LAT + north / 111320, "lon": LON0 + east / KX,
            "speed": speed, "q": None, "stop_id": stop_id, "vt": int(vt)}


@test
def late_stop_id_switch_far_from_the_stop_gets_no_row():
    """E01 B2: the bus serves A, then detours 300 m north of the line; Passio's stop_id stays B until the
    bus is 500 m past B, then moves to C. No report came within 120 m of B, and B does not lie between
    the last two reports, so B gets no row (before the fix: a row at the midpoint of those reports)."""
    st = fake_static()
    reps = [rep_m(-150, 0, "A", T0, 8), rep_m(-70, 0, "A", T0 + 10, 8), rep_m(0, 0, "A", T0 + 20, 0),
            rep_m(0, 0, "A", T0 + 30, 0)]
    pts = [(0, n) for n in (80, 160, 240, 300)] + [(e, 300) for e in range(80, int(B_EAST) + 500, 80)]
    pts.append((B_EAST + 500, 300))
    for k, (e, n) in enumerate(pts):
        reps.append(rep_m(e, n, "B" if e < B_EAST + 500 else "C", T0 + 40 + 10 * k, 8))
    reps += [rep_m(B_EAST + 500 + 80 * j, 300, "C", reps[-1]["vt"] + 10 * j, 8) for j in (1, 2)]
    ev = run(Tracker(st), reps)
    assert [e["idx"] for e in ev] == [0], [(e["idx"], e["source"], e["epoch"] - T0) for e in ev]


@test
def transition_between_two_distant_reports_uses_the_midpoint():
    """E01 B2 positive control: reports 50 s apart, 200 m before and 200 m after B (both > 120 m away,
    B between them): B still gets a transition row at the midpoint time."""
    st = fake_static()
    reps = [rep_m(B_EAST - 200, 0, "B", T0, 8), rep_m(B_EAST + 200, 0, "C", T0 + 50, 8)]
    ev = run(Tracker(st), reps)
    assert [(e["idx"], e["source"], e["epoch"]) for e in ev] == [(1, "transition", T0 + 25)], ev


def line_static(n=10):
    """Stops S0..S{n-1} ~249 m apart on the test line, one-way route L."""
    st = fake_static()
    st.stops = {f"S{i}": {"name": f"Stop S{i}", "lat": LAT, "lon": LON0 + STEP * i} for i in range(n)}
    st.route_stops = {"L": [f"S{i}" for i in range(n)]}
    st.routes = {"L": {"short": "L", "long": "Test Line"}}
    return st


@test
def flap_back_to_an_old_trip_id_starts_afresh():
    """E01 B3: the bus runs trip A (S0-S3), Passio calls it trip B for 10 min (S4-S6), then A again. A's
    old state must not link S7 back to S3 across B's arrivals, nor write a row for the stop A was
    heading to 10 min ago (S4, already logged on B)."""
    st = line_static()
    reps, truth = simulate(st, [f"S{i}" for i in range(9)], route="L", trip="A", speed=3.0, dwell=120)
    i4 = next(k for k, r in enumerate(reps) if r["stop_id"] == "S4")
    i7 = next(k for k, r in enumerate(reps) if r["stop_id"] == "S7")
    for r in reps[i4:i7]:
        r["trip"] = "B"
    assert reps[i7]["vt"] - reps[i4]["vt"] > 540
    ev = run(Tracker(st), reps)
    keys = [(e["trip"], e["idx"]) for e in ev]
    assert keys == [("A", 0), ("A", 1), ("A", 2), ("A", 3), ("B", 4), ("B", 5), ("B", 6), ("A", 7), ("A", 8)], keys
    for e in ev:
        assert abs(e["epoch"] - truth[e["idx"]]) <= 10, (e["trip"], e["idx"], e["epoch"] - truth[e["idx"]])
    assert ev[7]["prev"] is None or ev[7]["prev"]["idx"] == 6, ev[7]["prev"]
    assert ev[8]["prev"]["idx"] == 7 and ev[5]["prev"]["idx"] == 4, (ev[8]["prev"], ev[5]["prev"])


@test
def no_link_across_a_gap_longer_than_max_link_s():
    """E01 B3: the bus serves A and B, the feed loses it for 30 min (less than STATE_TTL), and it comes
    back on the same trip before C. C's row must not claim a 30-min segment from B; D links to C."""
    st = fake_static()
    r1, _ = simulate(st, ["A", "B"])
    r2, _ = simulate(st, ["C", "D"], t0=r1[-1]["vt"] + 1800)
    ev = run(Tracker(st), r1 + r2)
    assert [e["idx"] for e in ev] == [0, 1, 2, 3], [e["idx"] for e in ev]
    assert ev[2]["prev"] is None and ev[3]["prev"]["idx"] == 2, (ev[2]["prev"], ev[3]["prev"])


@test
def seed_links_only_to_recent_rows():
    """E01 B3: a restart seeded from the shared CSV still blocks duplicates of every row up to STATE_TTL
    old, but links the next segment only to a row at most MAX_LINK_S old."""
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "C"])
    ev = run(Tracker(st), reps)
    rows = [dict(zip(L.COLUMNS, map(str, L.fmt_row(st, e)))) for e in ev]
    last = ev[-1]["epoch"]
    for age, linked in ((300, True), (L.MAX_LINK_S - 1, True), (L.MAX_LINK_S + 60, False), (3000, False)):
        tr = Tracker(st)
        tr.seed(rows, last + age)
        s = tr.v[("V1", "T1")]
        assert s["done"] == {0, 1, 2}, (age, s["done"])
        assert (s["prev"] is not None and s["prev"]["idx"] == 2) == linked, (age, s["prev"])


@test
def brief_trip_id_flap_keeps_the_state():
    """A flap of one poll (Passio briefly reports another trip id) is not a flap back after a long time:
    the state is kept, so every stop is still logged once on the main trip id and every segment links
    to the stop before it (resetting here would cost the link and, poll by poll, most transitions)."""
    st = line_static()
    reps, truth = simulate(st, [f"S{i}" for i in range(6)], route="L", trip="A", speed=4.0)
    k = next(k for k, r in enumerate(reps) if r["stop_id"] == "S3") + 1      # just after leaving S2
    s3 = st.stops["S3"]
    assert min(L.hav_m(r["lat"], r["lon"], s3["lat"], s3["lon"]) for r in reps[k:k + 2]) > L.NEAR_M  # no handoff
    reps[k]["trip"] = "B"
    ev = run(Tracker(st), reps)
    assert [(e["trip"], e["idx"]) for e in ev] == [("A", i) for i in range(6)], [(e["trip"], e["idx"]) for e in ev]
    assert [e["prev"]["idx"] if e["prev"] else None for e in ev] == [None, 0, 1, 2, 3, 4], [e["prev"] for e in ev]
    for e in ev:
        assert abs(e["epoch"] - truth[e["idx"]]) <= 10, (e["idx"], e["epoch"] - truth[e["idx"]])


@test
def same_trip_second_lap_is_logged():
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "C", "D", "A", "B", "C"])
    ev = run(Tracker(st), reps)
    assert [e["idx"] for e in ev] == [0, 1, 2, 3, 4, 1, 2], [e["idx"] for e in ev]


@test
def restart_resumes_from_csv_tail_without_duplicates():
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "C", "D", "A"])
    half = len(reps) // 2
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "a.csv"
        p.write_text(SPEC_HEADER + "\n", encoding="utf-8")
        ev1 = run(Tracker(st), reps[:half])
        with open(p, "a", encoding="utf-8", newline="") as f:
            for e in ev1:
                f.write(L.row_text(L.fmt_row(st, e)))
        tail = L.read_tail(p)
        assert len(tail) == len(ev1) and tail[0]["stop_id"] == "A"
        tr = Tracker(st)
        tr.seed(tail, reps[half]["vt"])
        ev2 = run(tr, reps[half - 3:])                 # overlap: re-sent reports must not duplicate
    idx = [e["idx"] for e in ev1] + [e["idx"] for e in ev2]
    assert sorted(idx) == [0, 1, 2, 3, 4], idx


@test
def bus_already_at_stop_when_logging_starts_gets_no_row():
    st = fake_static()
    reps, truth = simulate(st, ["A", "B", "C"], lead_m=0, dwell=60)
    ev = run(Tracker(st), reps)
    assert [e["idx"] for e in ev] == [1, 2], [e["idx"] for e in ev]      # A's arrival was never seen
    assert abs(ev[0]["epoch"] - truth[1]) <= 10


@test
def passio_early_stop_id_switch_is_deferred():
    st = fake_static()
    reps, truth = simulate(st, ["A", "B", "C", "D"], speed=4.0, flip_m=45)
    ev = run(Tracker(st), reps)
    assert [e["idx"] for e in ev] == [0, 1, 2, 3], [e["idx"] for e in ev]
    for e in ev:
        assert abs(e["epoch"] - truth[e["idx"]]) <= 6, (e["idx"], e["source"], e["epoch"] - truth[e["idx"]])
    assert all(10 <= e["dwell"] <= 30 for e in ev[:-1]), [e["dwell"] for e in ev]


@test
def stale_and_repeated_reports_are_ignored():
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "C"])
    tr = Tracker(st)
    assert tr.update(dict(reps[0]), reps[0]["vt"] + 500) == [] and not tr.v       # 500 s old
    out = []
    for r in reps:
        out += tr.update(r, r["vt"] + 2) + tr.update(dict(r), r["vt"] + 4)        # duplicate vt
    out += tr.drain(reps[-1]["vt"] + 9, final=True)
    assert sorted(e["idx"] for e in out) == [0, 1, 2]


@test
def prediction_must_be_at_least_120s_old():
    tr = Tracker(fake_static())
    arr = T0 + 1000
    tr.add_prediction("T1", "B", arr - 400, arr - 30)
    tr.add_prediction("T1", "B", arr - 300, arr + 12)
    tr.add_prediction("T1", "B", arr - 60, arr + 2)
    assert tr.pred_for("T1", "B", arr) == (arr + 12, 300)
    assert tr.pred_for("T1", "C", arr) is None


def tu_entity(trip, made, stops, veh=None):
    """One tripUpdates entity; stops = [(stop_id, stop_sequence, predicted epoch)]."""
    u = {"trip": {"trip_id": trip}, "timestamp": made,
         "stop_time_update": [{"stop_id": s, "stop_sequence": q, "arrival": {"time": t}} for s, q, t in stops]}
    if veh is not None:
        u["vehicle"] = {"id": veh, "label": "x" + veh}
    return {"trip_update": u}


@test
def predictions_are_kept_per_vehicle_on_a_shared_trip():
    """E01 B1: every Downtown Campus Connector bus runs trip 874028. Two buses 25 min apart, both predicted
    at B in one poll (the second listed last): each arrival must carry its own bus's prediction (before
    the fix the first bus got the second's, ~+1,500 s off). An update without a vehicle id still counts."""
    import truth_logger as TL
    st = fake_static()
    r1, t1 = simulate(st, ["A", "B", "C"], trip="F", veh="V1")
    r2, t2 = simulate(st, ["A", "B", "C"], t0=T0 + 1500, trip="F", veh="V2")
    r3, t3 = simulate(st, ["A", "B", "C"], t0=T0 + 30, trip="G", veh="V3")
    made = T0 - 200
    p1, p2, p3 = int(t1[1]) + 5, int(t2[1]) - 7, int(t3[1]) + 9
    tr = Tracker(st)
    TL.store_predictions(tr, {"entity": [tu_entity("F", made, [("B", 2, p1)], veh="V1"),
                                         tu_entity("F", made, [("B", 2, p2)], veh="V2"),
                                         tu_entity("G", made, [("B", 2, p3)])]}, made)
    ev = run(tr, sorted(r1 + r2 + r3, key=lambda r: r["vt"]))
    at_b = {e["veh"]: e for e in ev if e["idx"] == 1}
    assert sorted(at_b) == ["V1", "V2", "V3"], [(e["veh"], e["idx"]) for e in ev]
    assert at_b["V1"]["pred"] == (p1, at_b["V1"]["epoch"] - made), at_b["V1"]["pred"]
    assert at_b["V2"]["pred"] == (p2, at_b["V2"]["epoch"] - made), at_b["V2"]["pred"]
    assert at_b["V3"]["pred"] == (p3, at_b["V3"]["epoch"] - made), at_b["V3"]["pred"]   # no vehicle id
    assert tr.pred_for("F", "B", at_b["V1"]["epoch"], veh="V9") is None    # another bus: not V1's or V2's


@test
def loop_terminal_prediction_matches_the_visit_index():
    """E01 B1: one update predicts the loop terminal A as stop_sequence 1 (leaving) and 5 (back again).
    The arrival at index 0 must store the seq-1 time, the one at index 4 the seq-5 time (before the fix
    both got whichever was listed last)."""
    import truth_logger as TL
    st = fake_static()
    reps, truth = simulate(st, ["A", "B", "C", "D", "A"])
    made = T0 - 300
    first, last = int(truth[0]) + 3, int(truth[4]) + 4
    tr = Tracker(st)
    TL.store_predictions(tr, {"entity": [tu_entity("T1", made, [("A", 1, first), ("B", 2, int(truth[1])),
                                                                ("C", 3, int(truth[2])), ("D", 4, int(truth[3])),
                                                                ("A", 5, last)], veh="V1")]}, made)
    ev = run(tr, reps)
    assert [e["idx"] for e in ev] == [0, 1, 2, 3, 4], [e["idx"] for e in ev]
    assert ev[0]["pred"][0] == first and ev[4]["pred"][0] == last, (ev[0]["pred"], ev[4]["pred"], first, last)
    assert ev[1]["pred"][0] == int(truth[1])


@test
def predictions_at_every_target_lead():
    """predictions.csv (owner goal 2026-10-12, the 10% rule): for each target lead L the newest prediction made
    at least L before the arrival; leads with none are left out."""
    tr = Tracker(fake_static())
    arr = T0 + 5000
    ups = ((arr - 1900, arr + 100), (arr - 1000, arr + 40), (arr - 650, arr + 20),
           (arr - 320, arr + 10), (arr - 130, arr + 4), (arr - 50, arr + 1))
    for i, (made, pred) in enumerate(ups):                                  # each one shown until the next appears
        tr.add_prediction("T1", "B", made, pred, veh="V1", last=(ups[i + 1][0] - 10) if i + 1 < len(ups) else arr)
    got = tr.preds_at("T1", "B", arr, veh="V1")
    want = {1800: (arr + 100, arr - 1900), 1200: (arr + 100, arr - 1900), 900: (arr + 40, arr - 1000),
            600: (arr + 20, arr - 650), 300: (arr + 10, arr - 320), 180: (arr + 10, arr - 320),
            120: (arr + 4, arr - 130), 60: (arr + 4, arr - 130)}
    assert got == {k: (p, m, m) for k, (p, m) in want.items()}, got     # (pred, made, first seen)
    assert tr.pred_for("T1", "B", arr, veh="V1") == (arr + 4, 130)          # the arrivals.csv column, unchanged
    assert tr.preds_at("T1", "B", arr, veh="V2") == {}                      # another bus's arrival: nothing


@test
def predictions_about_the_previous_lap_are_skipped():
    """A loop that keeps its trip id (the Downtown Campus Connector's frequency trip): predictions made before the
    bus's previous visit to the stop, or still predicting that visit, are not about this arrival."""
    tr = Tracker(fake_static())
    arr = T0 + 5000
    tr.visits[("V1", "B")] = (arr - 1500, "F", 1)                           # the same bus was at B 25 min ago
    tr.add_prediction("F", "B", arr - 1700, arr - 1500, veh="V1", last=arr - 1460)   # made for that earlier visit
    tr.add_prediction("F", "B", arr - 1450, arr - 1440, veh="V1", last=arr - 1010)   # made after it, still about it
    tr.add_prediction("F", "B", arr - 1000, arr + 20, veh="V1", last=arr)   # this lap, on display until it came
    assert tr.preds_at("F", "B", arr, veh="V1") == {lt: (arr + 20, arr - 1000, arr - 1000) for lt in (60, 120, 180, 300, 600, 900)}
    assert tr.pred_for("F", "B", arr, veh="V1") == (arr + 20, 1000)
    tr.visits[("V1", "B")] = (arr - 3 * L.STATE_TTL, "F", 1)                # too long ago to matter
    assert tr.preds_at("F", "B", arr, veh="V1")[1200] == (arr - 1440, arr - 1450, arr - 1450)
    # the previous visit was on ANOTHER trip id (a 15-min loop, the next run): a 30-min-ahead prediction for this
    # run, made before the bus passed the stop on the earlier one, is real and kept
    tr2 = Tracker(fake_static())
    tr2.visits[("V1", "B")] = (arr - 900, "E", 1)
    tr2.add_prediction("G", "B", arr - 1850, arr + 40, veh="V1", last=arr - 1000)
    tr2.add_prediction("G", "B", arr - 1000, arr + 10, veh="V1", last=arr)
    got = tr2.preds_at("G", "B", arr, veh="V1")
    assert got[1800] == (arr + 40, arr - 1850, arr - 1850) and got[600] == (arr + 10, arr - 1000, arr - 1000), got


@test
def arrivals_record_visits_and_prediction_rows():
    """The detector remembers each bus's visits (seeded from the CSV tail too) and an arrival event carries the
    predictions.csv leads; Writer writes those rows next to the arrivals row."""
    import truth_logger as TL, io as _io, csv as _csv
    st = fake_static()
    reps, truth = simulate(st, ["A", "B", "C"])
    tr = Tracker(st)
    tr.add_prediction("T1", "C", T0 - 1900, int(truth[2]) + 30, veh="V1", last=T0 - 710)
    tr.add_prediction("T1", "C", T0 - 700, int(truth[2]) + 30, veh="V1", last=int(truth[2]))
    ev = run(tr, reps)
    at_c = next(e for e in ev if e["idx"] == 2)
    assert sorted(at_c["preds"]) == [60, 120, 180, 300, 600, 900, 1200, 1800], sorted(at_c["preds"])
    assert tr.visits[("V1", "C")] == (at_c["epoch"], "T1", 2)
    d = Path(tempfile.mkdtemp(prefix="sb-pred-"))
    w = TL.Writer(d / "run.csv", st, d / "run_pred.csv")
    w.write([at_c])
    rows = list(_csv.DictReader(_io.StringIO((d / "run_pred.csv").read_text(encoding="utf-8"))))
    assert w.n == 1 and w.np == 8 == len(rows), (w.n, w.np, len(rows))
    r30 = next(r for r in rows if r["lead_target_s"] == "1800")
    assert r30["pred_seen_epoch"] == str(T0 - 1900) and list(rows[0]) == L.PRED_COLUMNS
    assert int(r30["pred_minus_actual_s"]) == int(truth[2]) + 30 - at_c["epoch"]
    assert int(r30["pred_lead_s"]) == at_c["epoch"] - (T0 - 1900) and r30["stop_name"] == "Stop C"
    tr2 = Tracker(st)
    tr2.seed([{"epoch": str(at_c["epoch"]), "stop_index": "2", "vehicle_id": "V1", "trip_id": "T1",
               "route_id": "R", "stop_id": "C", "dwell_s": ""}], at_c["epoch"] + 60)
    assert tr2.visits[("V1", "C")] == (at_c["epoch"], "T1", 2)


@test
def prediction_log_round_trip():
    """--pred-log / --pred-seed: a new run reloads the last hour of Passio's updates, in time order, once each."""
    import truth_logger as TL
    d = Path(tempfile.mkdtemp(prefix="sb-plog-"))
    tr = Tracker(fake_static())
    log = TL.PredLog(d / "a.jsonl")
    tr.on_pred = log
    now = T0 + 7200
    tr.add_prediction("T1", "B", now - 4000, now + 10, 2, "V1")     # older than an hour: not reloaded
    tr.add_prediction("T1", "B", now - 900, now + 20, 2, "V1")
    tr.add_prediction("T1", "B", now - 900, now + 20, 2, "V1")      # repeated update: logged once
    tr.add_prediction("T1", "B", now - 300, now + 25, 2, "V1")
    log.flush()
    assert log.n == 3
    tr2 = Tracker(fake_static())
    assert TL.seed_predictions(tr2, [d / "a.jsonl", d / "a.jsonl", d / "missing.jsonl"], now) == 4
    assert list(tr2.preds[("V1", "T1", "B")]) == [(now - 900, now + 20, 2, now - 900, now - 900),
                                                   (now - 300, now + 25, 2, now - 300, now - 300)]
    (d / "old.jsonl").write_text('["V1","T1","C",%d,%d,3]\n' % (now - 100, now + 50), encoding="utf-8")   # 6 fields
    assert TL.seed_predictions(tr2, [d / "old.jsonl"], now) == 1
    assert list(tr2.preds[("V1", "T1", "C")]) == [(now - 100, now + 50, 3, now - 100, now - 100)]
    # still shown 70 s later: logged again with the newer 'last', and a reload keeps first and last sighting
    tr.add_prediction("T1", "B", now - 300, now + 25, 2, "V1", seen=now - 230, last=now - 230)
    tr.add_prediction("T1", "B", now - 300, now + 25, 2, "V1", seen=now - 200, last=now - 200)   # < 60 s: not logged
    log.flush()
    assert log.n == 4, log.n
    tr3 = Tracker(fake_static())
    TL.seed_predictions(tr3, [d / "a.jsonl"], now)
    assert list(tr3.preds[("V1", "T1", "B")])[-1] == (now - 300, now + 25, 2, now - 300, now - 230)


@test
def a_changed_prediction_with_an_old_timestamp_counts_from_when_it_appeared():
    """Passio sometimes changes the predicted time and keeps the old trip-update timestamp (57 of 651 updates on
    2026-10-12). Such an update was not on display before it appeared, so it can't stand in for an earlier lead."""
    tr = Tracker(fake_static())
    arr = T0 + 5000
    tr.add_prediction("T1", "B", arr - 700, arr + 90, veh="V1", seen=arr - 695, last=arr - 40)
    tr.add_prediction("T1", "B", arr - 700, arr + 3, veh="V1", seen=arr - 30, last=arr)   # same timestamp, new time
    got = tr.preds_at("T1", "B", arr, veh="V1")
    assert got[600] == (arr + 90, arr - 700, arr - 695) and got[60] == got[600], got
    assert tr.pred_for("T1", "B", arr, veh="V1") == (arr + 90, 700)


@test
def a_withdrawn_prediction_is_not_on_display():
    """Owner goal / E19 fix 3: for lead L use the prediction Passio was SHOWING at arrival - L. One it had stopped
    publishing by then gives no row ("no prediction shown"), not an old number; arrivals.csv's column is unchanged."""
    tr = Tracker(fake_static())
    arr = T0 + 5000
    tr.add_prediction("T1", "B", arr - 700, arr + 15, veh="V1", seen=arr - 700, last=arr - 695)   # gone in 5 s
    assert tr.preds_at("T1", "B", arr, veh="V1") == {}
    assert tr.pred_for("T1", "B", arr, veh="V1") == (arr + 15, 700)
    tr.add_prediction("T1", "B", arr - 700, arr + 15, veh="V1", seen=arr - 100, last=arr - 100)   # shown again later
    got = tr.preds_at("T1", "B", arr, veh="V1")
    assert sorted(got) == [60, 120, 180, 300, 600] and got[600] == (arr + 15, arr - 700, arr - 700), got


@test
def updates_without_a_vehicle_id_count_only_for_the_only_bus_on_the_trip():
    """E01 B1 follow-up: an update with no vehicle id can't be attributed when two buses share the trip id."""
    st = fake_static()
    tr = Tracker(st)
    arr = T0 + 5000
    tr.add_prediction("F", "B", arr - 400, arr + 9)                               # no vehicle id
    tr._state(("V1", "F"), "R", arr)["last_t"] = arr
    assert tr.pred_for("F", "B", arr, veh="V1") == (arr + 9, 400)                 # V1 is alone on F
    tr._state(("V2", "F"), "R", arr)["last_t"] = arr - 60
    assert tr.pred_for("F", "B", arr, veh="V1") is None and tr.preds_at("F", "B", arr, veh="V1") == {}


@test
def chicago_dst_rule():
    cases = {datetime(2026, 7, 1, 12, tzinfo=timezone.utc): "2026-07-01 07:00",
             datetime(2026, 1, 15, 12, tzinfo=timezone.utc): "2026-01-15 06:00",
             datetime(2026, 3, 8, 7, 59, tzinfo=timezone.utc): "2026-03-08 01:59",
             datetime(2026, 3, 8, 8, 0, tzinfo=timezone.utc): "2026-03-08 03:00",
             datetime(2026, 11, 1, 6, 59, tzinfo=timezone.utc): "2026-11-01 01:59",
             datetime(2026, 11, 1, 7, 0, tzinfo=timezone.utc): "2026-11-01 01:00"}
    for d, want in cases.items():
        for force in (True, False):
            got = L.chicago(d.timestamp(), force_rule=force).strftime("%Y-%m-%d %H:%M")
            assert got == want, (d, force, got)
    assert L.chicago(datetime(2026, 10, 5, 15, tzinfo=timezone.utc).timestamp()).weekday() == 0   # Monday


@test
def randomized_runs_error_bound():
    """Many random speeds / dwells / poll phases / GPS noise: every stop once, |error| <= 10 s."""
    st, errs = fake_static(), []
    for seed in range(40):
        rnd = random.Random(seed)
        reps, truth = simulate(st, ["A", "B", "C", "D", "A"], t0=T0 + rnd.randint(0, 9), speed=rnd.uniform(3, 13),
                               dwell=rnd.choice((0, 5, 15, 30, 60)), noise_m=rnd.uniform(0, 6), seed=seed,
                               no_stop={"C"} if seed % 3 == 0 else (), flip_m=(None, 25, 45)[seed % 3 - 1])
        ev = run(Tracker(st), reps)
        assert sorted(e["idx"] for e in ev) == [0, 1, 2, 3, 4], (seed, [e["idx"] for e in ev])
        errs += [e["epoch"] - truth[e["idx"]] for e in ev]
    worst = max(map(abs, errs))
    assert worst <= 10, worst
    print(f"    detection error over {len(errs)} arrivals: mean {sum(errs) / len(errs):+.1f} s, "
          f"mean |e| {sum(map(abs, errs)) / len(errs):.1f} s, max |e| {worst:.1f} s")


@test
def real_network_distances_positive():
    st = L.Static()
    if not st.route_stops:
        return
    for rid, order in st.route_stops.items():
        for i in range(1, len(order)):
            d, how = st.dist_between(rid, i - 1, i)
            assert d and d > 0 and how in ("shape", "haversine"), (rid, i, d)


def vp_feed(reps, junk=()):
    """vehiclePositions JSON for reports from simulate(), plus optional junk entities."""
    ents = [{"vehicle": {"position": {"latitude": r["lat"], "longitude": r["lon"], "speed": r["speed"]},
                         "trip": {"trip_id": r["trip"], "route_id": r["route"]}, "vehicle": {"id": r["veh"]},
                         "stop_id": r["stop_id"], "timestamp": r["vt"]}} for r in reps]
    return {"header": {"timestamp": max([r["vt"] for r in reps] or [0])}, "entity": list(junk) + ents}


@test
def gzip_deflate_and_plain_feeds_decode():
    import gzip, zlib
    import truth_logger as TL
    raw = b'{"entity": [], "header": {"timestamp": 1}}'
    want = {"entity": [], "header": {"timestamp": 1}}
    assert TL.decode_body(raw, None) == want
    assert TL.decode_body(raw, "identity") == want
    assert TL.decode_body(gzip.compress(raw), "gzip") == want
    assert TL.decode_body(gzip.compress(raw), None) == want            # gzip without the header: magic bytes
    assert TL.decode_body(zlib.compress(raw), "deflate") == want
    co = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    assert TL.decode_body(co.compress(raw) + co.flush(), "deflate") == want   # raw deflate


@test
def fetch_asks_for_gzip_and_accepts_either_reply():
    import gzip
    import truth_logger as TL
    raw, seen = b'{"entity": [{"id": "1"}]}', []

    class Resp:
        def __init__(self, body, enc):
            self.body, self.headers = body, {"Content-Encoding": enc} if enc else {}

        def read(self):
            return self.body

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    replies = [Resp(gzip.compress(raw), "gzip"), Resp(raw, None)]   # 2nd: server ignores Accept-Encoding

    def fake_urlopen(req, timeout=None):
        seen.append((req.get_header("Accept-encoding"), timeout))
        return replies.pop(0)

    real = TL.urllib.request.urlopen
    TL.urllib.request.urlopen = fake_urlopen
    try:
        assert TL.fetch("tripUpdates") == {"entity": [{"id": "1"}]}
        assert TL.fetch("vehiclePositions") == {"entity": [{"id": "1"}]}
    finally:
        TL.urllib.request.urlopen = real
    assert seen == [("gzip", 15), ("gzip", 15)], seen


@test
def malformed_feeds_and_entries_never_stop_the_run():
    """Junk entities, bad types, non-dict feeds, fetch failures and a detector exception are counted and
    skipped; the good vehicle still yields every arrival exactly once."""
    import io
    import truth_logger as TL
    st = fake_static()
    reps, truth = simulate(st, ["A", "B", "C", "D", "A"])
    tr = Tracker(st)
    real_update = tr.update

    def update(rep, now):
        if rep["veh"] == "BOOM":
            raise ValueError("detector bug")
        return real_update(rep, now)

    tr.update = update
    out = Path(tempfile.mkdtemp(prefix="sb-truth-")) / "run.csv"
    w, log = TL.Writer(out, st), io.StringIO()
    err = TL.Errors(out=log)
    good_tu = {"trip_update": {"trip": {"trip_id": "T1"}, "timestamp": T0, "stop_time_update": [
        {"stop_id": "B", "arrival": {"time": T0 + 60}}, "junk-stop"]}}
    bad_tu = [7, "junk", {"trip_update": {"trip": {"trip_id": "T1"}, "timestamp": "bad",
                                          "stop_time_update": [{"stop_id": "B", "arrival": {"time": T0}}]}}]
    boom = dict(reps[0], veh="BOOM")
    for k, r in enumerate(reps):
        def get(name, k=k, r=r):
            if k % 7 == 3:
                raise OSError("timed out")
            if name == "tripUpdates":
                return ["not", "a", "feed"] if k % 5 == 1 else {"entity": bad_tu + [good_tu]}
            junk = [None, "x", {"vehicle": {"position": {"latitude": 1}, "trip": "not-a-dict"}}]
            return vp_feed([r, dict(boom, vt=r["vt"])], junk=junk)
        TL.poll(tr, w, r["vt"] + 2, err, get=get)
    TL.poll(tr, w, reps[-1]["vt"] + 3, err, get=lambda name: 42)    # a feed that is not even a dict
    w.write(tr.drain(reps[-1]["vt"] + 5, final=True))
    rows = [ln.split(",") for ln in out.read_text(encoding="utf-8").splitlines()[1:]]
    idx = [int(r[L.COLUMNS.index("stop_index")]) for r in rows]
    assert w.n == len(rows) and idx == [0, 1, 2, 3, 4], idx
    assert err.proc > 0 and err.fetch > 0 and err.first, (err.proc, err.fetch, err.first)
    assert "detector bug" in log.getvalue() and "ERROR" in log.getvalue()
    assert err.proc > 100 and log.getvalue().count("\n") <= 40 + err.proc // 100 + err.fetch // 100, "log not sampled"


@test
def raw_polls_keep_every_position_poll_and_never_stop_the_run():
    """--raw-out: one JSON line per vehiclePositions poll (empty feeds too), junk entities skipped; a raw
    file that cannot be written is counted as an error while arrival rows keep coming."""
    import io
    import truth_logger as TL
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "C"])
    d = Path(tempfile.mkdtemp(prefix="sb-raw-"))
    log = io.StringIO()
    tr, w, err = Tracker(st), TL.Writer(d / "run.csv", st), TL.Errors(out=log)
    raw = TL.RawPolls(d / "raw" / "raw.jsonl")
    junk = [None, "x", {"vehicle": {"position": "nope"}}, {"vehicle": {"position": {"latitude": 1}, "trip": "bad"}}]
    for r in reps:
        TL.poll(tr, w, r["vt"] + 2, err, get=lambda name, r=r: vp_feed([r], junk=junk) if name == "vehiclePositions"
                else {"entity": []}, raw=raw)
    TL.poll(tr, w, reps[-1]["vt"] + 12, err, get=lambda name: {"header": {"timestamp": 5}, "entity": []}, raw=raw)
    lines = [json.loads(ln) for ln in (d / "raw" / "raw.jsonl").read_text(encoding="utf-8").splitlines()]
    assert raw.n == len(lines) == len(reps) + 1, (raw.n, len(lines))
    first = lines[0]["v"]
    assert len(first) == 2 and dict(zip(TL.RawPolls.FIELDS, first[1]))["veh"] == reps[0]["veh"], first
    assert dict(zip(TL.RawPolls.FIELDS, first[1]))["lat"] == reps[0]["lat"]
    assert lines[-1] == {"t": reps[-1]["vt"] + 12, "h": 5, "v": []}
    assert "raw polls" not in log.getvalue(), log.getvalue()     # (the junk entities are the detector's errors)
    rows_before, log = w.n, io.StringIO()
    err = TL.Errors(out=log)                     # fresh counts (the first error log is already sampled)
    (d / "raw" / "raw.jsonl").unlink()
    (d / "raw" / "raw.jsonl").mkdir()            # now unwritable: errors are counted, the detector keeps going
    reps2, _ = simulate(st, ["A", "B", "C"], t0=reps[-1]["vt"] + 600, trip="T2")
    for r in reps2:
        TL.poll(tr, w, r["vt"] + 2, err, get=lambda name, r=r: vp_feed([r]) if name == "vehiclePositions"
                else {"entity": []}, raw=raw)
    w.write(tr.drain(reps2[-1]["vt"] + 5, final=True))
    assert err.proc == len(reps2) == log.getvalue().count("raw polls") and "raw polls" in err.first, err.first
    assert w.n > rows_before, (w.n, rows_before)


def east_reps(points, t0, trip="T1", route="L", veh="V1"):
    """Reports 10 s apart at (east metres from S0, stop_id Passio names, speed)."""
    return [rep_m(e, 0, sid, t0 + 10 * k, sp, trip=trip, veh=veh, route=route) for k, (e, sid, sp) in enumerate(points)]


@test
def a_stop_passio_jumps_over_gets_a_pass_row_when_the_bus_drives_past():
    """2026-10-12 raw tracks: Passio's stop_id jumps over stops (night routes, Red Line). The bus drives past
    S2 without stopping while Passio names S3 from S1 on: S2 gets one 'pass' row at the time it passed."""
    st = line_static()
    reps, truth = simulate(st, [f"S{i}" for i in range(6)], route="L", no_stop={"S2"}, seed=7)
    for r in reps:
        if r["stop_id"] == "S2":
            r["stop_id"] = "S3"
    ev = run(Tracker(st), reps)
    assert [e["idx"] for e in ev] == [0, 1, 2, 3, 4, 5], [(e["idx"], e["source"]) for e in ev]
    s2 = ev[2]
    assert s2["source"] == "pass" and abs(s2["epoch"] - truth[2]) <= 10 and s2["dwell"] == 0, s2
    assert s2["prev"]["idx"] == 1 and ev[3]["prev"]["idx"] == 2, (s2["prev"], ev[3]["prev"])
    assert all(e["source"] != "pass" for e in ev if e["idx"] != 2)


@test
def driving_past_a_stop_the_other_way_is_not_a_pass():
    """A stop on the far side of the street: the bus goes by it against the route's direction. Westbound
    route W (S5 -> S2): an eastbound drive past S3 is not a visit; the same drive on the eastbound route L,
    with Passio lagging one stop behind (S2 named), is one."""
    st = line_static()
    st.route_stops["W"] = ["S5", "S4", "S3", "S2"]
    pts = [(2.5 * B_EAST + 80 * k, "S4", 8) for k in range(5)]          # 0.5 to 0.82 B_EAST past S2, eastbound
    assert pts[1][0] < 3 * B_EAST < pts[-1][0]
    assert run(Tracker(st), east_reps(pts, T0, route="W")) == []
    ev = run(Tracker(st), east_reps([(e, "S2", sp) for e, _, sp in pts], T0, route="L"))
    assert [(e["idx"], e["source"]) for e in ev] == [(3, "pass")], [(e["idx"], e["source"]) for e in ev]


@test
def a_standing_bus_jittering_near_a_stop_is_not_a_pass():
    """GPS jitter of a parked bus 25 m from S5 (in the forward window of the S2 Passio names) moves it a few
    metres per report: never a pass."""
    st = line_static()
    rnd = random.Random(3)
    pts = [(5 * B_EAST + rnd.uniform(-6, 6), "S2", None) for _ in range(30)]
    reps = [rep_m(e, 25 + rnd.uniform(-6, 6), sid, T0 + 10 * k, sp, route="L") for k, (e, sid, sp) in enumerate(pts)]
    assert run(Tracker(st), reps) == []


@test
def a_stop_passio_names_too_early_is_still_logged_when_the_bus_passes_it():
    """Passio moves its stop_id from S2 to S3 while the bus is still 169 m short of S2 (more than NEAR_M):
    no transition time then, but the drive past S2 gives it a 'pass' row (before: no row at all)."""
    st = line_static()
    pts = [(B_EAST, "S1", 0), (B_EAST, "S1", 0), (B_EAST + 80, "S3", 8)]
    pts += [(B_EAST + 80 + 80 * k, "S3", 8) for k in range(1, 6)]
    ev = run(Tracker(st), east_reps(pts, T0))
    got = [(e["idx"], e["source"]) for e in ev]
    assert got[0] == (2, "pass"), got            # (S1: already standing there when logging began, no row)
    want = T0 + 20 + (B_EAST - 80) / 8           # reached S2 249 - 80 m after the report at B + 80 (T0 + 20)
    assert abs(ev[0]["epoch"] - want) <= 10, ev[0]["epoch"] - want


@test
def a_late_switch_keeps_the_time_the_bus_drove_past():
    """Passio keeps naming S2 for two minutes after the bus drove past it (longer than the HIST reports kept),
    then names S4: S2's transition row is timed when the bus passed, and S3, passed while Passio still named
    S2, gets a 'pass' row."""
    st = line_static()
    pts = [(B_EAST - 160 + 40 * k, "S2", 4) for k in range(40)]       # 4 m/s from 160 m before S1 eastward
    pts = [(e, "S2" if k < 30 else "S4", sp) for k, (e, _, sp) in enumerate(pts)]
    reps = east_reps(pts, T0)
    ev = run(Tracker(st), reps)
    got = {e["idx"]: e for e in ev}
    assert 2 in got and got[2]["source"] == "transition", [(e["idx"], e["source"]) for e in ev]
    passed2 = T0 + 10 * (2 * B_EAST - (B_EAST - 160)) / 40
    assert abs(got[2]["epoch"] - passed2) <= 10, got[2]["epoch"] - passed2
    assert 3 in got and got[3]["source"] == "pass", [(e["idx"], e["source"]) for e in ev]
    assert reps[29]["vt"] - got[2]["epoch"] > 10 * L.HIST, "S2 must be older than the reports kept"


@test
def a_trip_renamed_mid_lap_still_logs_the_stops_passio_skipped():
    """Red Line 2026-10-12: Passio renames a bus's trip in the middle of a lap and names a stop two ahead.
    The stops between the last one logged (old trip) and the new trip's first named stop get 'pass' rows."""
    st = line_static()
    reps, truth = simulate(st, [f"S{i}" for i in range(6)], route="L", trip="A", no_stop={"S2", "S3"}, seed=9)
    k = next(k for k, r in enumerate(reps) if r["stop_id"] == "S2")   # just left S1
    for r in reps[k:]:
        r["trip"] = "B"
        if r["stop_id"] in ("S2", "S3"):
            r["stop_id"] = "S4"
    ev = run(Tracker(st), reps)
    got = [(e["trip"], e["idx"], e["source"]) for e in ev]
    assert [(t, i) for t, i, _ in got] == [("A", 0), ("A", 1), ("B", 2), ("B", 3), ("B", 4), ("B", 5)], got
    assert got[2][2] == got[3][2] == "pass", got
    for e in ev:
        assert abs(e["epoch"] - truth[e["idx"]]) <= 10, (e["idx"], e["epoch"] - truth[e["idx"]])


def variant_static():
    """Loop M = T, P, Q, R, T; its other pattern P, Q, R, V, P serves V, 27 m north of T (like 57th St. & Metra
    NB and SB on Midway Metra): union order T, P, Q, R, V, T with V variant-only."""
    st = line_static()
    st.stops.update({"T": {"name": "T", "lat": LAT, "lon": LON0 + 4 * STEP},
                     "P": {"name": "P", "lat": LAT, "lon": LON0 + STEP}, "Q": {"name": "Q", "lat": LAT, "lon": LON0 + 2 * STEP},
                     "R": {"name": "R", "lat": LAT, "lon": LON0 + 3 * STEP},
                     "V": {"name": "V", "lat": LAT + 27 / 111320, "lon": LON0 + 4 * STEP}})
    order, added = L.union_order(["T", "P", "Q", "R", "T"], [["P", "Q", "R", "V", "P"]])
    st.route_stops["M"] = order
    st.variant_only = {"M": {i for i, x in enumerate(order) if x in added}}
    return st


@test
def a_second_pattern_s_own_stop_joins_the_route_order():
    order, added = L.union_order(["T", "P", "Q", "R", "T"], [["P", "Q", "R", "V", "P"], ["T", "P", "T"]])
    assert order == ["T", "P", "Q", "R", "V", "T"] and added == {"V"}, (order, added)
    assert L.union_order(["A", "B"], []) == (["A", "B"], set())


@test
def the_stop_27_m_away_is_logged_only_when_passio_names_it():
    """Morning: the bus stands at T (Passio names T): T gets the row, never V 27 m away. Afternoon: Passio names
    V and the bus stands there: V gets the row, never T (before: the afternoon visits were logged at T)."""
    st = variant_static()
    te = 4 * B_EAST
    am = east_reps([(te - 200, "T", 8), (te - 100, "T", 8), (te, "T", 0), (te, "T", 0), (te, "T", 0), (te, "P", 0),
                    (te, "P", 0), (te - 100, "P", 8)], T0, route="M")
    ev = run(Tracker(st), am)
    assert [st.route_stops["M"][e["idx"]] for e in ev] == ["T"], [(e["idx"], e["source"]) for e in ev]
    pm = [rep_m(te - 200, 27, "V", T0, 8, route="M"), rep_m(te - 100, 27, "V", T0 + 10, 8, route="M")]
    pm += [rep_m(te, 27, "V" if k < 3 else "P", T0 + 20 + 10 * k, 0, route="M") for k in range(6)]
    pm.append(rep_m(te - 100, 27, "P", T0 + 80, 8, route="M"))
    ev = run(Tracker(st), pm)
    assert [st.route_stops["M"][e["idx"]] for e in ev] == ["V"], [(e["idx"], e["source"]) for e in ev]


@test
def build_gtfs_lists_the_patterns_with_stops_route_stops_lacks():
    import build_gtfs as BG
    trips = [{"trip_id": f"a{i}", "route_id": "M"} for i in range(5)] + [{"trip_id": f"p{i}", "route_id": "M"} for i in range(3)]
    trips += [{"trip_id": "x", "route_id": "M"}, {"trip_id": "s1", "route_id": "N"}]
    stimes = {f"a{i}": list(enumerate(["T", "P", "Q", "R", "T"])) for i in range(5)}
    stimes.update({f"p{i}": list(enumerate(["P", "Q", "R", "V", "P"])) for i in range(3)})
    stimes.update({"x": list(enumerate(["P", "Z"])), "s1": list(enumerate(["A", "B"]))})
    got = BG.route_variants(trips, stimes, {"M": ["T", "P", "Q", "R", "T"], "N": ["A", "B"]})
    assert got == {"M": [["P", "Q", "R", "V", "P"]]}, got       # one-trip pattern x and route N: nothing


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

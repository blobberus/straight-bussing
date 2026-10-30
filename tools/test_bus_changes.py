#!/usr/bin/env python3
"""Tests for tools/bus_changes.py (bus count changes per route, owner 2026-10-30) and its hooks: truth_logger.poll,
the merge + classification, the forecast table's bus_change_min / leaving_bus. Stdlib, offline.

  python tools/test_bus_changes.py
"""
import csv, gzip, io, json, sys, tempfile, time, traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bus_changes as BC
import build_eta_dataset as B
import truth_logger as TL

T0 = 1_793_106_000          # 2026-10-27 8:00 AM CDT, a Tuesday
TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


class St:
    """A tiny Static: two routes, three stops, a timetable that drops from 2 buses to 1 at 9 AM on Tuesdays."""
    def __init__(self):
        self.route_stops = {"R": ["S1", "S2", "S3"], "Q": ["S3", "S1"]}
        self.stops = {"S1": {"name": "First St"}, "S2": {"name": "Second St"}, "S3": {"name": "Third St"}}
        tue = {"buses": [0] * 7 + [2, 2, 1, 1] + [1] * 13}
        self.service = {"routes": {"R": {"days": {"tue": tue}}}}

    def route_name(self, rid):
        return {"R": "Red", "Q": "Quad"}.get(rid, rid)


def rep(veh, route, t, trip="T1", stop="S1", vt=None):
    return {"veh": veh, "route": route, "trip": trip, "stop_id": stop, "vt": t if vt is None else vt, "lat": 41.8, "lon": -87.6}


def run(bc, until, buses, start=T0, step=10):
    """Poll every step s from start to until; buses(t) -> report dicts of that poll. -> all rows."""
    rows = []
    t = start
    while t <= until:
        rows += bc.observe(buses(t), t)
        t += step
    return rows


@test
def drop_confirmed_after_ten_minutes_timed_to_the_last_report():
    bc = BC.BusChanges(St(), T0)
    rows = run(bc, T0 + 3600, lambda t: [rep("A", "R", t)] + ([rep("B", "R", t, trip="T9", stop="S2")] if t < T0 + 1200 else []))
    assert len(rows) == 1, rows
    r = dict(zip(BC.COLUMNS, rows[0]))
    assert r["kind"] == "drop" and r["vehicle_id"] == "B" and r["epoch"] == T0 + 1190, r
    assert (r["buses_before"], r["buses_after"], r["staying_vehicles"]) == (2, 1, "A"), r
    assert r["trip_id"] == "T9" and r["last_stop_id"] == "S2" and r["last_stop_name"] == "Second St", r
    assert r["local_time"] == "2026-10-27 08:19:50" and r["route_name"] == "Red", r


@test
def a_blip_under_ten_minutes_is_not_a_drop():
    bc = BC.BusChanges(St(), T0)
    gap = lambda t: T0 + 1200 <= t < T0 + 1200 + 540          # 9 min without B
    rows = run(bc, T0 + 3600, lambda t: [rep("A", "R", t)] + ([] if gap(t) else [rep("B", "R", t)]))
    assert rows == [], rows


@test
def a_route_that_empties_is_not_a_drop():
    bc = BC.BusChanges(St(), T0)
    rows = run(bc, T0 + 3600, lambda t: [rep("A", "R", t), rep("B", "R", t)] if t < T0 + 1200 else [])
    assert rows == [], rows   # end of service or a feed outage silences every bus


@test
def stale_reports_do_not_keep_a_bus():
    bc = BC.BusChanges(St(), T0)
    rows = run(bc, T0 + 3600, lambda t: [rep("A", "R", t)] + ([rep("B", "R", t)] if t < T0 + 1200 else [rep("B", "R", t, vt=T0 + 1190)]))
    assert len(rows) == 1 and rows[0][4] == "drop" and rows[0][7] == "B", rows   # a frozen feed clock is not a report


@test
def add_after_warmup_with_five_minutes_of_reports_and_none_during_warmup():
    bc = BC.BusChanges(St(), T0)
    rows = run(bc, T0 + 3600, lambda t: [rep("A", "R", t)] + ([rep("C", "R", t)] if t >= T0 + 2000 else [])
               + ([rep("W", "R", t)] if t >= T0 + 60 else []))     # W: already there at the run's start
    adds = [dict(zip(BC.COLUMNS, r)) for r in rows if r[4] == "add"]
    assert [a["vehicle_id"] for a in adds] == ["C"], adds
    assert adds[0]["epoch"] == T0 + 2000 and (adds[0]["buses_before"], adds[0]["buses_after"]) == (2, 3), adds


@test
def a_routes_first_bus_is_not_an_add():
    bc = BC.BusChanges(St(), T0)
    assert run(bc, T0 + 3600, lambda t: [rep("A", "R", t)] if t >= T0 + 1000 else []) == []


@test
def a_bus_that_moves_to_another_route_says_where():
    bc = BC.BusChanges(St(), T0)
    rows = run(bc, T0 + 3600, lambda t: [rep("A", "R", t)] + ([rep("B", "R", t)] if t < T0 + 1200 else [rep("B", "Q", t)]))
    d = [dict(zip(BC.COLUMNS, r)) for r in rows if r[4] == "drop"]
    assert len(d) == 1 and d[0]["moved_to_route"] == "Q", rows


@test
def unknown_routes_and_missing_ids_are_ignored():
    bc = BC.BusChanges(St(), T0)
    rows = run(bc, T0 + 3600, lambda t: [rep("A", "R", t), rep("B", "R", t), rep("Z", "NOPE", t), rep(None, "R", t)])
    assert rows == [], rows


@test
def timetable_columns_and_expected_drop():
    st = St()
    assert BC.sched_buses(st, "R", T0) == 2 and BC.sched_buses(st, "R", T0 + 3600 * 2) == 1   # 8 AM 2, 10 AM 1
    assert BC.expected_change(st, "R", T0 + 3600 + 300, "drop") == 1        # 9:05: 2 buses at 8:35, 1 at 9:35
    assert BC.expected_change(st, "R", T0 + 300, "drop") == 0
    assert BC.expected_change(st, "Q", T0, "drop") == ""                   # no timetable for Q


@test
def merge_drops_copies_from_overlapping_runs_and_sorts():
    st = St()
    with tempfile.TemporaryDirectory() as d:
        a, b, into = Path(d) / "a.csv", Path(d) / "b.csv", Path(d) / "bus_changes.csv"
        for path, rows in ((a, [["R", "Red", T0 + 600, "", "drop", 2, 1, "B"]]),
                           (b, [["R", "Red", T0 + 610, "", "drop", 2, 1, "B"], ["R", "Red", T0 + 100, "", "add", 1, 2, "C"]])):
            bc = BC.BusChanges(st, T0, out=path)
            with open(path, "a", encoding="utf-8", newline="") as f:
                for r in rows:
                    f.write(",".join(str(x) for x in r + [""] * (len(BC.COLUMNS) - len(r))) + "\n")
        assert BC.merge(into, a) == 1 and BC.merge(into, b) == 1
        got = BC.read_rows(into)
        assert [(r["kind"], r["vehicle_id"], r["epoch"]) for r in got] == [("add", "C", str(T0 + 100)), ("drop", "B", str(T0 + 600))], got
        empty = Path(d) / "empty.csv"
        BC.BusChanges(st, T0, out=empty)                                    # header only
        assert BC.merge(Path(d) / "none.csv", empty) == 0 and not (Path(d) / "none.csv").exists()


@test
def classification_lasting_layover_pending_moved_returning():
    rows = [
        {"route_id": "R", "kind": "drop", "vehicle_id": "B", "epoch": T0},              # back on R after 20 min: layover
        {"route_id": "R", "kind": "drop", "vehicle_id": "D", "epoch": T0},              # no R arrival, log goes on: lasting
        {"route_id": "R", "kind": "drop", "vehicle_id": "E", "epoch": T0 + 3000},       # log ends too early: pending
        {"route_id": "R", "kind": "add", "vehicle_id": "B", "epoch": T0 + 1100},        # its layover's end
        {"route_id": "R", "kind": "add", "vehicle_id": "F", "epoch": T0 + 1100},        # a new bus
    ]
    arr = [{"epoch": T0 + 1200, "vehicle_id": "B", "route_id": "R"},
           {"epoch": T0 + 900, "vehicle_id": "D", "route_id": "Q"},                       # D went to Q
           {"epoch": T0 + 2000, "vehicle_id": "A", "route_id": "R"},
           {"epoch": T0 + 4000, "vehicle_id": "D", "route_id": "R"}]                     # D back after 67 min
    BC.annotate(rows, arr)
    b, d, e, add_b, add_f = rows
    assert (b["lasting"], b["returned_min"]) == (0, 20), b
    assert (d["lasting"], d["returned_min"], d["moved_to_route"]) == (1, 67, "Q"), d
    assert e["lasting"] == "", e
    assert add_b["returning"] == 1 and add_f["returning"] == 0, (add_b, add_f)


@test
def merge_with_arrivals_classifies_every_row():
    st = St()
    with tempfile.TemporaryDirectory() as d:
        add, into, arr = Path(d) / "run.csv", Path(d) / "bus_changes.csv", Path(d) / "arrivals.csv"
        BC.BusChanges(st, T0, out=add)
        with open(add, "a", encoding="utf-8", newline="") as f:
            f.write(",".join(str(x) for x in ["R", "Red", T0, "", "drop", 2, 1, "B"] + [""] * (len(BC.COLUMNS) - 8)) + "\n")
        arr.write_text("epoch,vehicle_id,route_id\n%d,B,R\n%d,A,R\n" % (T0 + 600, T0 + 4000), encoding="utf-8")
        BC.merge(into, add, arrivals=arr)
        r = BC.read_rows(into)[0]
        assert (r["lasting"], r["returned_min"]) == ("0", "10"), r


@test
def truth_logger_poll_feeds_the_change_tracker():
    st = St()

    class Tr:
        def update(self, rep, now): return []
        def drain(self, now): return []
        def add_prediction(self, *a, **k): pass

    class W:
        def write(self, ev): pass

    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "changes.csv"
        bc = BC.BusChanges(st, T0, out=out)
        err = TL.Errors(out=io.StringIO())
        for t in range(T0, T0 + 3601, 10):
            ents = [{"vehicle": {"vehicle": {"id": "A"}, "trip": {"trip_id": "T1", "route_id": "R"}, "position": {"latitude": 41.8, "longitude": -87.6}, "timestamp": t}}]
            if t < T0 + 1200:
                ents.append({"vehicle": {"vehicle": {"id": "B"}, "trip": {"trip_id": "T2", "route_id": "R"}, "position": {"latitude": 41.8, "longitude": -87.6}, "timestamp": t}})
            feed = {"header": {"timestamp": t}, "entity": ents}
            TL.poll(Tr(), W(), t, err, get=lambda name, f=feed: {"entity": []} if name == "tripUpdates" else f, changes=bc)
        got = BC.read_rows(out)
        assert len(got) == 1 and got[0]["vehicle_id"] == "B" and got[0]["kind"] == "drop" and bc.n == 1, got
        assert err.proc == 0


@test
def forecast_rows_are_flagged_near_a_lasting_drop_only():
    rows = [{"query_epoch": T0 - 600, "route_id": "R", "vehicle_id": "B"},
            {"query_epoch": T0 + 1200, "route_id": "R", "vehicle_id": "A"},
            {"query_epoch": T0 + 4000, "route_id": "R", "vehicle_id": "A"},
            {"query_epoch": T0, "route_id": "Q", "vehicle_id": "A"}]
    changes = [{"route_id": "R", "kind": "drop", "vehicle_id": "B", "epoch": T0, "lasting": "1"},
               {"route_id": "Q", "kind": "drop", "vehicle_id": "A", "epoch": T0, "lasting": "0"}]   # a layover: no flag
    B.flag_bus_changes(rows, changes)
    assert (rows[0]["bus_change_min"], rows[0]["leaving_bus"]) == (-10.0, 1), rows[0]
    assert (rows[1]["bus_change_min"], rows[1]["leaving_bus"]) == (20.0, 0), rows[1]
    assert "bus_change_min" not in rows[2] and "bus_change_min" not in rows[3], rows
    assert B.COLUMNS[-2:] == ["bus_change_min", "leaving_bus"]


@test
def detect_from_raw_polls():
    st = St()
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "raw.jsonl.gz"
        with gzip.open(p, "wt", encoding="utf-8") as f:
            for t in range(T0, T0 + 3601, 10):
                v = [["A", "T1", "R", 41.8, -87.6, 0, 5, 1, "S1", None, t]]
                if t < T0 + 1200:
                    v.append(["B", "T2", "R", 41.8, -87.6, 0, 5, 1, "S2", None, t])
                f.write(json.dumps({"t": t, "h": t, "v": v}) + "\n")
        rows = BC.detect([p], st)
        assert len(rows) == 1 and rows[0][4] == "drop" and rows[0][7] == "B" and rows[0][8] == "S2", rows


def main():
    fails = 0
    for fn in TESTS:
        t0 = time.time()
        try:
            fn()
            print(f"pass {fn.__name__} ({time.time() - t0:.1f}s)")
        except Exception:
            fails += 1
            print("FAIL", fn.__name__)
            traceback.print_exc()
    print(f"{'ok' if not fails else 'FAILED'} {len(TESTS) - fails}/{len(TESTS)} tests")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()

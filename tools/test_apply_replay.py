#!/usr/bin/env python3
"""Tests for tools/apply_replay.py (hermetic, temp dirs only).
  python tools/test_apply_replay.py        -> prints 'ok N tests', exits 1 on failure"""
import csv, io, shutil, sys, tempfile, traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply_replay as A
from arrivals_lib import COLUMNS, PRED_COLUMNS, PREV_VISIT_GAP_S

TESTS, TMPS = [], []
T0 = 1792100000            # 2026-10-16 morning


def test(fn):
    TESTS.append(fn)
    return fn


def tmp():
    d = Path(tempfile.mkdtemp(prefix="sb-apply-test-"))
    TMPS.append(d)
    return d


def write(path, cols, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({c: r.get(c, "") for c in cols})
    path.write_text(buf.getvalue(), encoding="utf-8", newline="")


def arrival(epoch, veh="101", stop="S1", trip="t1", source="transition"):
    return {"epoch": epoch, "local_time": "2026-10-16 08:00:00", "route_id": "R", "route_name": "Central",
            "trip_id": trip, "vehicle_id": veh, "stop_id": stop, "stop_name": "Stop", "source": source}


def pred(epoch, lead, pe, made, veh="101", stop="S1", trip="t1"):
    return {"epoch": epoch, "local_time": "2026-10-16 08:30:00", "route_id": "R", "route_name": "Central",
            "trip_id": trip, "vehicle_id": veh, "stop_id": stop, "stop_name": "Stop", "stop_index": 3,
            "lead_target_s": lead, "pred_epoch": pe, "pred_made_epoch": made, "pred_lead_s": lead + 30,
            "pred_minus_actual_s": pe - epoch, "pred_seen_epoch": made}


def rows(path):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


@test
def mispaired_rows_go_valid_rows_stay_missing_rows_come_in():
    d, r = tmp(), tmp()
    gt = d / "data" / "ground_truth"
    lap1, lap2 = T0, T0 + 1800                  # bus 101 at S1 twice, 30 min apart (a loop)
    write(gt / "arrivals.csv", COLUMNS, [arrival(lap1), arrival(lap2, trip="t2")])
    live = [pred(lap2, 1200, lap1 + 40, lap2 - 1250, trip="t2"),     # about lap 1 (DC-011), the replay drops it
            pred(lap2, 600, lap2 + 20, lap2 - 640, trip="t2"),       # fine, the replay lost it (its own limits)
            pred(lap2, 900, lap1 + 10, lap2 - 950, trip="t2"),       # looks like lap 1 but the replay keeps it
            pred(lap1, 300, lap1 + 5, lap1 - 330)]                   # lap 1's own row, untouched
    write(gt / "predictions.csv", PRED_COLUMNS, live)
    write(r / "arrivals-2026-10-16.csv", COLUMNS, [arrival(lap1), arrival(lap2, trip="t2"),
                                                     arrival(lap2 + 120, stop="S2", trip="t2", source="pass")])
    write(r / "predictions-2026-10-16.csv", PRED_COLUMNS,
          [pred(lap2, 900, lap1 + 10, lap2 - 950, trip="t2"), pred(lap1, 300, lap1 + 5, lap1 - 330),
           pred(lap2, 300, lap2 + 15, lap2 - 330, trip="t2")])            # the DC-008 kind: missing live
    s = A.apply(d, r, ["2026-10-16"], dry_run=True, out=io.StringIO())
    assert len(rows(gt / "predictions.csv")) == 4 and len(rows(gt / "arrivals.csv")) == 2, "dry run writes nothing"
    s = A.apply(d, r, ["2026-10-16"], out=io.StringIO())
    assert s["arrivals_added"] == 1 and s["predictions_removed"] == 1 and s["predictions_added"] == 1, s
    got = {(p["epoch"], p["lead_target_s"]) for p in rows(gt / "predictions.csv")}
    assert got == {(str(lap2), "600"), (str(lap2), "900"), (str(lap1), "300"), (str(lap2), "300")}, got
    assert any(a["source"] == "pass" for a in rows(gt / "arrivals.csv"))
    before = ((gt / "arrivals.csv").read_bytes(), (gt / "predictions.csv").read_bytes())
    s = A.apply(d, r, ["2026-10-16"], out=io.StringIO())
    assert s.get("arrivals_added", 0) == 0 and s["predictions_removed"] == 0 and s.get("predictions_added", 0) == 0, s
    assert ((gt / "arrivals.csv").read_bytes(), (gt / "predictions.csv").read_bytes()) == before, "idempotent"


@test
def the_previous_lap_rule_matches_the_detector():
    vis = {("101", "S1"): [(T0, "t1"), (T0 + 1800, "t2")]}
    row = lambda pe, made, trip="t2", ep=T0 + 1800: [str(pred(ep, 1200, pe, made, trip=trip)[c]) for c in PRED_COLUMNS]
    assert A.previous_lap(row(T0 + PREV_VISIT_GAP_S - 1, T0 - 100), vis), "predicted within 120 s of the last visit"
    assert not A.previous_lap(row(T0 + PREV_VISIT_GAP_S + 1, T0 + 200), vis), "after it: about this visit"
    assert A.previous_lap(row(T0 + 1790, T0 - 10, trip="t1"), vis), "made before the last visit on the same trip"
    assert not A.previous_lap(row(T0 + 1790, T0 - 10, trip="t2"), vis), "another trip id: the made rule does not apply"
    assert not A.previous_lap(row(T0 - 10, T0 - 300, ep=T0), vis), "the first visit has no earlier one"
    far = {("101", "S1"): [(T0, "t1"), (T0 + 3 * 3600, "t2")]}
    assert not A.previous_lap(row(T0 + 10, T0 - 100, ep=T0 + 3 * 3600), far), "a visit over 2 h back does not count"


@test
def rows_outside_the_replayed_days_are_never_touched():
    d, r = tmp(), tmp()
    gt = d / "data" / "ground_truth"
    lap1, lap2 = T0, T0 + 1800
    write(gt / "arrivals.csv", COLUMNS, [arrival(lap1), arrival(lap2)])
    old = T0 + 5 * 86400                          # a later day, mis-paired, not replayed: stays
    write(gt / "predictions.csv", PRED_COLUMNS, [pred(lap2, 1200, lap1 + 40, lap2 - 1250)])
    write(r / "predictions-2026-10-20.csv", PRED_COLUMNS, [pred(old, 300, old + 5, old - 330)])
    s = A.apply(d, r, ["2026-10-20"], out=io.StringIO())
    assert s["predictions_removed"] == 0 and len(rows(gt / "predictions.csv")) == 2, s


@test
def only_source_adds_that_kind_of_row_and_changes_nothing_else():
    """--only-source approach (DC-030 backfill): the replay's approach rows of visits nothing logged come in with their
    predictions rows; an approach row of a visit already logged does not (nor its predictions rows), the replay's
    other rows (a pass row the live file lacks, a re-timed transition) are ignored, no predictions row is removed or
    replaced, and a second run changes nothing."""
    d, r = tmp(), tmp()
    gt = d / "data" / "ground_truth"
    lap1, lap2 = T0, T0 + 1800
    write(gt / "arrivals.csv", COLUMNS, [arrival(lap1), arrival(lap2, trip="t2")])
    live = [pred(lap2, 1200, lap1 + 40, lap2 - 1250, trip="t2"), pred(lap1, 300, lap1 + 5, lap1 - 330)]
    write(gt / "predictions.csv", PRED_COLUMNS, live)
    before = (gt / "arrivals.csv").read_bytes(), (gt / "predictions.csv").read_bytes()
    write(r / "arrivals-2026-10-16.csv", COLUMNS, [
        arrival(lap1 + 3), arrival(lap2 + 60, stop="S2", trip="t2", source="pass"),
        arrival(lap1 + 600, stop="S9", source="approach"),                 # a visit nothing logged: comes in
        arrival(lap2 + 600, source="approach", trip="t2")])                # lap 2 at S1 logged 10 min off: stays out
    write(r / "predictions-2026-10-16.csv", PRED_COLUMNS, [
        pred(lap1 + 600, 300, lap1 + 610, lap1 + 270, stop="S9"), pred(lap1 + 600, 600, lap1 + 640, lap1 - 30, stop="S9"),
        pred(lap2 + 600, 1200, lap2 + 610, lap2 - 630, trip="t2"),          # the logged visit's: never comes in
        pred(lap1 + 3, 300, lap1 + 9, lap1 - 327)])                        # a re-timed rule row's: ignored
    s = A.apply(d, r, ["2026-10-16"], dry_run=True, out=io.StringIO(), only_source="approach")
    assert ((gt / "arrivals.csv").read_bytes(), (gt / "predictions.csv").read_bytes()) == before, "dry run"
    s = A.apply(d, r, ["2026-10-16"], out=io.StringIO(), only_source="approach")
    assert s == {"arrivals_added": 1, "arrivals_replaced": 0, "arrivals_skipped_logged": 1, "predictions_added": 2,
                 "predictions_replaced": 0}, s
    a = rows(gt / "arrivals.csv")
    assert [(x["stop_id"], x["source"]) for x in a] == [("S1", "transition"), ("S1", "transition"), ("S9", "approach")], a
    p = rows(gt / "predictions.csv")
    assert [(x["stop_id"], x["lead_target_s"]) for x in p] == [("S1", "1200"), ("S1", "300"), ("S9", "300"), ("S9", "600")], p
    assert (gt / "predictions.csv").read_bytes().startswith(before[1]), "existing lines untouched"
    after = (gt / "arrivals.csv").read_bytes(), (gt / "predictions.csv").read_bytes()
    s = A.apply(d, r, ["2026-10-16"], out=io.StringIO(), only_source="approach")
    assert s["arrivals_added"] == 0 and s["predictions_added"] == 0, s
    assert ((gt / "arrivals.csv").read_bytes(), (gt / "predictions.csv").read_bytes()) == after, "idempotent"


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
    for d in TMPS:
        shutil.rmtree(d, ignore_errors=True)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()

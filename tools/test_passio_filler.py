#!/usr/bin/env python3
"""Asserts on tools/passio_filler.py (Passio's filler times, DC-031).
  python tools/test_passio_filler.py        -> prints 'ok N tests', exits 1 on failure"""
import contextlib, csv, gzip, io, json, sys, tempfile, traceback
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import passio_filler as F
from arrivals_lib import PRED_COLUMNS

T0 = 1795200000                  # Fri 2026-11-20 12:40 PM CST
DAY = "2026-11-20"


def e(seq, stop, pred, seen=T0, last=T0 + 30):
    return (seq, stop, pred, seen, last)


def kinds_of(entries, **kw):
    return [(x[1], k) for x, k in F.classify(entries, **kw)]


def test_run_of_two_second_steps():
    # the live feed's pattern: one real time, then every listed stop +2 s
    got = kinds_of([e(1, "A", T0 + 600), e(2, "B", T0 + 602), e(3, "C", T0 + 604), e(4, "D", T0 + 606)])
    assert got == [("A", "head"), ("B", "filler"), ("C", "filler"), ("D", "filler")], got


def test_thresholds_0_to_3_s():
    got = kinds_of([e(1, "A", T0 + 100), e(2, "B", T0 + 103), e(3, "C", T0 + 107), e(4, "D", T0 + 107),
                    e(5, "E", T0 + 105), e(6, "F", T0 + 300)])
    # +3 filler, +4 not, +0 filler, -2 not (an earlier time is no filler), +195 normal
    assert got == [("A", "head"), ("B", "filler"), ("C", "head"), ("D", "filler"), ("E", "normal"), ("F", "normal")], got
    assert kinds_of([e(1, "A", T0), e(2, "B", T0 + 3)], filler_s=2) == [("A", "normal"), ("B", "normal")]


def test_listed_order_is_stop_sequence_not_input_order():
    got = kinds_of([e(3, "C", T0 + 604), e(1, "A", T0 + 600), e(2, "B", T0 + 602), e(10, "J", T0 + 900)])
    assert got == [("A", "head"), ("B", "filler"), ("C", "filler"), ("J", "normal")], got


def test_head_after_a_normal_entry_and_two_runs():
    got = kinds_of([e(1, "A", T0 + 60), e(2, "B", T0 + 180), e(3, "C", T0 + 182), e(4, "D", T0 + 400),
                    e(5, "E", T0 + 402)])
    assert got == [("A", "normal"), ("B", "head"), ("C", "filler"), ("D", "head"), ("E", "filler")], got


def test_two_versions_of_one_stop_pair_by_display_time():
    # Passio changed B's and C's times but kept the timestamp: C's new version (seen at +60) follows B's new version
    es = [e(1, "A", T0 + 100, T0, T0 + 120), e(2, "B", T0 + 200, T0, T0 + 50), e(2, "B", T0 + 300, T0 + 60, T0 + 120),
          e(3, "C", T0 + 202, T0, T0 + 50), e(3, "C", T0 + 302, T0 + 60, T0 + 120)]
    got = [(x[1], x[2] - T0, k) for x, k in F.classify(es)]
    assert got == [("A", 100, "normal"), ("B", 200, "head"), ("B", 300, "head"), ("C", 202, "filler"),
                   ("C", 302, "filler")], got


def test_loop_lists_a_stop_twice():
    got = kinds_of([e(1, "T", T0 + 60), e(2, "B", T0 + 62), e(3, "C", T0 + 64), e(4, "T", T0 + 66)])
    assert got == [("T", "head"), ("B", "filler"), ("C", "filler"), ("T", "filler")], got


def run(*argv):
    """passio_filler.main with its printed tables kept out of the test output."""
    with contextlib.redirect_stdout(io.StringIO()):
        return F.main(list(argv))


def preds_from(lines):
    return F.load_pred_updates([write_pred(tmp(), lines)], *F.ALL_TIME)


def tmp():
    return Path(tempfile.mkdtemp(prefix="sb-filler-"))


def write_pred(d, lines, day=DAY):
    p = d / f"pred-updates-{day}.jsonl.gz"
    with gzip.open(p, "wt", encoding="utf-8") as f:
        for x in lines:
            f.write(json.dumps(x) + "\n")
    return p


UPD = [  # one bus, two trip updates (made T0 and T0 + 60), the second repeated a minute later (dedupe)
    ["V1", "T1", "A", T0, T0 + 300, 1, T0 + 5, T0 + 50], ["V1", "T1", "B", T0, T0 + 302, 2, T0 + 5, T0 + 50],
    ["V1", "T1", "C", T0, T0 + 304, 3, T0 + 5, T0 + 50],
    ["V1", "T1", "A", T0 + 60, T0 + 290, 1, T0 + 65, T0 + 110], ["V1", "T1", "B", T0 + 60, T0 + 400, 2, T0 + 65, T0 + 110],
    ["V1", "T1", "C", T0 + 60, T0 + 402, 3, T0 + 65, T0 + 110], ["V1", "T1", "C", T0 + 60, T0 + 402, 3, T0 + 65, T0 + 170],
    ["V2", "T9", "A", T0, T0 + 30, 1, T0 + 5, T0 + 50],
]


def test_kinds_per_update_and_dedupe():
    km = F.kinds(preds_from(UPD))
    assert len(km) == 7, km                              # the repeated C line is one entry
    assert km[("V1", "T1", "B", T0, T0 + 302, 2)] == "filler"
    assert km[("V1", "T1", "A", T0, T0 + 300, 1)] == "head"
    assert km[("V1", "T1", "B", T0 + 60, T0 + 400, 2)] == "head"
    assert km[("V1", "T1", "A", T0 + 60, T0 + 290, 1)] == "normal"
    assert km[("V2", "T9", "A", T0, T0 + 30, 1)] == "normal"
    assert F.entry_shares(preds_from(UPD)) == {"filler": 3, "head": 2, "normal": 2}


def test_lookup_other_trip_and_no_vehicle():
    idx = F.kind_index(F.kinds(preds_from(UPD + [[None, "T5", "Q", T0, T0 + 99, 2, T0, T0]])))
    assert F.lookup(idx, "V1", "T1", "C", T0, T0 + 304) == "filler"
    assert F.lookup(idx, "V1", "T7", "C", T0, T0 + 304) == "filler"     # a re-matched trip id (DC-010)
    assert F.lookup(idx, "V1", "T1", "C", T0, T0 + 305) == "unknown"
    assert F.lookup(idx, "V3", "T5", "Q", T0, T0 + 99) == "normal"      # an update without a vehicle id


def test_metrics_use_the_shrink_tolerance():
    m = F.metrics([170, -170, 181, 0], 1800)            # 3 min allowed at 30 min ahead
    assert m["n"] == 4 and m["pass_shrink"] == 0.75 and m["late_2"] == 0.5 and m["early_2"] == 0.25, m
    m = F.metrics([61, 60, -60, -121], 300)             # 1 min at 5 min ahead
    assert m["pass_shrink"] == 0.5 and m["within_1"] == 0.5 and m["early_2"] == 0.25 and m["median_err_s"] == 0, m
    assert F.metrics([], 60)["pass_shrink"] is None


def pred_row(epoch, lead, pred, made, veh="V1", trip="T1", stop="C", route="R1"):
    r = dict.fromkeys(PRED_COLUMNS, "")
    r.update(epoch=epoch, route_id=route, route_name="Line One", trip_id=trip, vehicle_id=veh, stop_id=stop,
             stop_name="Stop C", lead_target_s=lead, pred_epoch=pred, pred_made_epoch=made,
             pred_lead_s=epoch - made, pred_minus_actual_s=pred - epoch, pred_seen_epoch=made + 5)
    return r


def write_preds(p, rows):
    with open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=PRED_COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return p


def test_days_end_to_end():
    d = tmp()
    write_pred(d, UPD)
    # C came at T0 + 250: the filler time (T0 + 304) is 54 s late, the newer head-run filler (T0 + 402) 152 s late
    p = write_preds(d / "predictions.csv", [pred_row(T0 + 250, 60, T0 + 402, T0 + 60), pred_row(T0 + 250, 120, T0 + 304, T0),
                                            pred_row(T0 + 250, 120, T0 + 304, T0),          # a duplicate (rotation)
                                            pred_row(T0 + 400, 300, T0 + 30, T0, veh="V2", trip="T9", stop="A")])
    a = run("days", "--pred-dir", str(d), "--predictions", str(p), "--csv", str(d / "out.csv"))
    got = {(r["kind"], r["lead_s"]): r for r in a}
    assert got[("filler", 60)]["n"] == 1 and got[("filler", 60)]["late_2"] == 1.0, got
    assert got[("filler", 120)]["n"] == 1 and got[("filler", 120)]["pass_shrink"] == 1.0, got
    assert got[("normal", 300)]["n"] == 1 and got[("normal", 300)]["early_2"] == 1.0, got
    assert got[("not_filler", 300)]["n"] == 1 and ("not_filler", 60) not in got, got
    rows = list(csv.DictReader(open(d / "out.csv", encoding="utf-8")))
    assert {r["day"] for r in rows} == {DAY} and len(rows) == len(a)


def test_mark_adds_one_column_and_keeps_rows():
    d = tmp()
    write_pred(d, UPD)
    rows = [pred_row(T0 + 250, 120, T0 + 304, T0), pred_row(T0 + 250, 60, T0 + 999, T0)]
    rows[1]["pred_epoch"] = ""                           # no Passio time on this row
    p = write_preds(d / "predictions.csv", rows)
    c = run("mark", "--pred-dir", str(d), "--in", str(p), "--out", str(d / "m.csv.gz"))
    out = list(csv.DictReader(io.TextIOWrapper(gzip.open(d / "m.csv.gz"), encoding="utf-8")))
    assert list(out[0].keys()) == PRED_COLUMNS + ["passio_kind"], out[0].keys()
    assert [r["passio_kind"] for r in out] == ["filler", ""] and c == {"filler": 1, "(no time)": 1}


def test_hours_bins_by_update_time():
    d = tmp()
    write_pred(d, UPD)
    res = run("hours", "--pred-dir", str(d), "--day", DAY, "--minutes", "1")
    assert [(h, n) for h, n, _ in res] == [("12:40", 4), ("12:41", 3)], res
    assert res[0][2] == 0.5 and abs(res[1][2] - 1 / 3) < 1e-9, res


def test_split_time_is_chicago_time():
    assert F.local_epoch("2026-10-27 18:00") == int(datetime(2026, 10, 27, 23, 0, tzinfo=timezone.utc).timestamp())  # CDT
    assert F.local_epoch("2026-11-20 10:40") == int(datetime(2026, 11, 20, 16, 40, tzinfo=timezone.utc).timestamp())  # CST


def test_late_table_before_and_since():
    d = tmp()
    write_pred(d, UPD)
    p = write_preds(d / "predictions.csv", [pred_row(T0 + 160, 300, T0 + 304, T0)])     # filler, 144 s late
    arr = d / "arrivals.csv"
    arr.write_text("epoch,route_id,stop_id,trip_id,source\n%d,R1,C,T1,transition\n%d,R1,A,T1,gps\n" % (T0 + 160, T0),
                   encoding="utf-8")
    res = run("late", "--pred-dir", str(d), "--predictions", str(p), "--arrivals", str(arr),
              "--split", "2026-11-20 10:00")
    s = res["since"]["R1"]
    assert s["late_all"] == 1.0 and s["late_filler"] == 1.0 and s["late_not_filler"] is None, s
    assert s["arrivals"] == 1 and s["cover_all"] == 1.0 and s["cover_not_filler"] == 0.0, s   # the gps row is no target
    assert res["before"]["ALL"] == {} or res["before"]["ALL"]["shown"] == 0


TESTS = [v for k, v in dict(globals()).items() if k.startswith("test_")]


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

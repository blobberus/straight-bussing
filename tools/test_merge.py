#!/usr/bin/env python3
"""Asserts on tools/merge_arrivals.py (overlapping collector runs -> one clean CSV).
  python tools/test_merge.py        -> prints 'ok N tests', exits 1 on failure"""
import sys, tempfile, traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arrivals_lib import COLUMNS
from merge_arrivals import HEADER, merge

T0 = 1791400000


def row(epoch, stop="A", idx=0, veh="V1", trip="T1", prev="", name="Stop, with comma"):
    r = {c: "" for c in COLUMNS}
    r.update(epoch=str(epoch), vehicle_id=veh, trip_id=trip, stop_id=stop, stop_index=str(idx),
             prev_stop_id=prev, stop_name=f'"{name}"', source="transition")
    return ",".join(r[c] for c in COLUMNS) + "\n"


def write(p, rows, header=True):
    p.write_text((HEADER if header else "") + "".join(rows), encoding="utf-8", newline="")


def body(p):
    return p.read_text(encoding="utf-8").splitlines(keepends=True)[1:]


def tmp():
    return Path(tempfile.mkdtemp(prefix="sb-merge-"))


def test_creates_file_and_sorts():
    d = tmp()
    write(d / "run.csv", [row(T0 + 60, "B", 1), row(T0, "A", 0)])
    s = merge(d / "gt" / "arrivals.csv", d / "run.csv")
    assert s["added"] == 2, s
    out = (d / "gt" / "arrivals.csv").read_text(encoding="utf-8")
    assert out.startswith(HEADER) and sum(ln.startswith("epoch,") for ln in out.splitlines()) == 1
    assert body(d / "gt" / "arrivals.csv") == [row(T0, "A", 0), row(T0 + 60, "B", 1)]


def test_overlap_duplicates_dropped_and_idempotent():
    d = tmp()
    write(d / "a.csv", [row(T0, "A", 0, prev="Z"), row(T0 + 90, "B", 1, prev="A")])
    write(d / "b.csv", [row(T0 + 7, "A", 0, prev="Z"), row(T0 + 85, "B", 1, prev="A"), row(T0 + 200, "C", 2)])
    into = d / "arrivals.csv"
    merge(into, d / "a.csv")
    s = merge(into, d / "b.csv")
    assert s["added"] == 1 and s["dup"] == 2 and s["replaced"] == 0, s
    before = into.read_bytes()
    s = merge(into, d / "b.csv")
    assert s["added"] == 0 and into.read_bytes() == before, s


def test_richer_row_replaces_in_place():
    d = tmp()
    write(d / "a.csv", [row(T0, "A", 0), row(T0 + 90, "B", 1)])            # run just started: no prev
    write(d / "b.csv", [row(T0 + 4, "A", 0, prev="Z")])
    into = d / "arrivals.csv"
    merge(into, d / "a.csv")
    s = merge(into, d / "b.csv")
    assert s["replaced"] == 1 and s["added"] == 0, s
    assert body(into) == [row(T0 + 4, "A", 0, prev="Z"), row(T0 + 90, "B", 1)]


def test_distinct_visits_kept():
    d = tmp()
    rows = [row(T0, "A", 0), row(T0 + 600, "A", 0),                       # second lap, same trip id
            row(T0 + 5, "A", 0, veh="V2"), row(T0 + 5, "A", 4, trip="T2")]   # other bus / other index
    write(d / "run.csv", rows)
    s = merge(d / "arrivals.csv", d / "run.csv")
    assert s["added"] == 4 and s["dup"] == 0, s


def test_bad_lines_skipped_and_existing_lines_untouched():
    d = tmp()
    into = d / "arrivals.csv"
    odd = row(T0, "A", 0).replace("transition", "proximity")
    write(into, [odd])
    (d / "run.csv").write_text(HEADER + "garbage,1,2\n\n" + row(T0 + 500, "B", 1), encoding="utf-8")
    s = merge(into, d / "run.csv")
    assert s["bad"] == 1 and s["added"] == 1, s
    assert body(into)[0] == odd


def test_rotation_and_dedupe_against_archive():
    d = tmp()
    into = d / "arrivals.csv"
    write(d / "a.csv", [row(T0 + i * 300, "A", 0, trip=f"T{i}") for i in range(50)])
    s = merge(into, d / "a.csv", rotate_mb=0.001)
    assert "rotated" in s and into.read_text(encoding="utf-8") == HEADER, s
    assert len(list((d / "archive").glob("arrivals-*.csv"))) == 1
    write(d / "b.csv", [row(T0 + 49 * 300 + 3, "A", 0, trip="T49"), row(T0 + 99999, "B", 1)])
    s = merge(into, d / "b.csv")
    assert s["dup"] == 1 and s["added"] == 1, s


def test_missing_run_file_is_noop():
    d = tmp()
    write(d / "arrivals.csv", [row(T0)])
    s = merge(d / "arrivals.csv", d / "nope.csv")
    assert s["added"] == 0 and body(d / "arrivals.csv") == [row(T0)], s


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

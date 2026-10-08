#!/usr/bin/env python3
"""Merge one collector run's arrival rows into the shared ground-truth CSV (schema: docs/DATA.md).

  python tools/merge_arrivals.py --into data/ground_truth/arrivals.csv --add run.csv [--rotate-mb 40]

Collector runs overlap on purpose (.github/workflows/collect.yml) so there is never a gap, which
means two runs can log the same arrival a few seconds apart. A row is a duplicate when vehicle,
trip, stop and stop_index match and the epochs are within DUP_S. The kept row is the one with more
filled fields (a run that just started has no previous stop or Passio prediction yet). Existing
lines are never re-serialised, so git diffs stay small. Idempotent: merging the same file twice
changes nothing. Stdlib only.
"""
import argparse, csv, os, sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arrivals_lib import COLUMNS, read_tail

DUP_S = 120          # same vehicle+trip+stop within this many seconds = one arrival
HEADER = ",".join(COLUMNS) + "\n"
I_EPOCH, I_TRIP, I_VEH, I_STOP, I_IDX = (COLUMNS.index(c) for c in
                                         ("epoch", "trip_id", "vehicle_id", "stop_id", "stop_index"))


def parse(line):
    """-> (fields, epoch) or None for headers, blank or malformed lines."""
    try:
        r = next(csv.reader([line]))
        return (r, int(r[I_EPOCH])) if len(r) == len(COLUMNS) else None
    except (StopIteration, ValueError, csv.Error):
        return None


def key(r):
    return r[I_VEH], r[I_TRIP], r[I_STOP], r[I_IDX]


def filled(r):
    return sum(1 for x in r if x != "")


def read_lines(p):
    if not p.exists():
        return []
    return [ln if ln.endswith("\n") else ln + "\n" for ln in p.read_text(encoding="utf-8").splitlines()]


def merge(into, add, rotate_mb=0.0):
    """-> dict(added, replaced, dup, bad). Writes `into` atomically; may rotate it to archive/."""
    into, add = Path(into), Path(add)
    lines = [ln for ln in read_lines(into) if not ln.startswith("epoch,")]
    index = {}                                    # key -> [(epoch, line_no)], for the shared file
    for i, ln in enumerate(lines):
        p = parse(ln)
        if p:
            index.setdefault(key(p[0]), []).append((p[1], i))
    archived = {}                                 # just after a rotation the overlap is in the archive
    arch = sorted((into.parent / "archive").glob(into.stem + "-*.csv"))
    if arch:
        for r in read_tail(arch[-1]):
            try:
                archived.setdefault((r["vehicle_id"], r["trip_id"], r["stop_id"], r["stop_index"]), []).append(int(r["epoch"]))
            except (KeyError, ValueError):
                pass

    stats = dict(added=0, replaced=0, dup=0, bad=0)
    new = []                                      # (epoch, line) appended at the end, sorted
    for ln in read_lines(add):
        if ln.startswith("epoch,") or not ln.strip():
            continue
        p = parse(ln)
        if not p:
            stats["bad"] += 1
            continue
        r, ep = p
        k = key(r)
        if any(abs(ep - e) <= DUP_S for e in archived.get(k, ())):
            stats["dup"] += 1
            continue
        hit = next(((e, i) for e, i in index.get(k, ()) if abs(ep - e) <= DUP_S), None)
        if hit is None:
            new.append((ep, ln))
            index.setdefault(k, []).append((ep, None))      # also dedupes within this run
        elif hit[1] is not None and filled(r) > filled(parse(lines[hit[1]])[0]):
            lines[hit[1]] = ln
            stats["replaced"] += 1
        else:
            stats["dup"] += 1
    new.sort(key=lambda x: x[0])
    stats["added"] = len(new)

    into.parent.mkdir(parents=True, exist_ok=True)
    tmp = into.with_name(into.name + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(HEADER)
        f.writelines(lines)
        f.writelines(ln for _, ln in new)
    os.replace(tmp, into)

    if rotate_mb > 0 and into.stat().st_size >= rotate_mb * 1e6:   # GitHub rejects files > 100 MB
        dest = into.parent / "archive" / f"{into.stem}-{datetime.now(timezone.utc):%Y%m%d-%H%M}.csv"
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.replace(into, dest)
        into.write_text(HEADER, encoding="utf-8", newline="")
        stats["rotated"] = str(dest)
    return stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--into", required=True, help="shared CSV (created if missing)")
    ap.add_argument("--add", required=True, help="CSV written by one truth_logger.py run")
    ap.add_argument("--rotate-mb", type=float, default=0, help="archive --into once it passes this size (0 = never)")
    a = ap.parse_args()
    s = merge(a.into, a.add, a.rotate_mb)
    print("merge: " + " ".join(f"{k}={v}" for k, v in s.items()))


if __name__ == "__main__":
    main()

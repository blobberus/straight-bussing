#!/usr/bin/env python3
"""Merge one collector run's prediction rows into the shared predictions CSV (schema: arrivals_lib.PRED_COLUMNS,
docs/DATA.md "predictions.csv").

  python tools/merge_predictions.py --into data/ground_truth/predictions.csv --add run_pred.csv [--rotate-mb 40]

Same idea as merge_arrivals.py: overlapping runs log the same arrival, so a row is a duplicate when vehicle,
stop and target lead match and the arrival epochs are within DUP_S = 300 s. Of two duplicates the kept one is
the fresher prediction (smaller pred_lead_s, which is still >= the target lead): a run that started later may
have missed Passio updates, never the other way round. Existing lines are never re-serialised; idempotent.
"""
import argparse, csv, os, sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arrivals_lib import PRED_COLUMNS

DUP_S = 300
HEADER = ",".join(PRED_COLUMNS) + "\n"
I_EPOCH, I_VEH, I_STOP, I_LEAD, I_PLEAD = (PRED_COLUMNS.index(c) for c in
                                           ("epoch", "vehicle_id", "stop_id", "lead_target_s", "pred_lead_s"))


def parse(line):
    """-> (fields, epoch, pred_lead) or None for headers, blank or malformed lines."""
    try:
        r = next(csv.reader([line]))
        if len(r) != len(PRED_COLUMNS):
            return None
        return r, int(r[I_EPOCH]), int(r[I_PLEAD])
    except (StopIteration, ValueError, csv.Error):
        return None


def key(r):
    return r[I_VEH], r[I_STOP], r[I_LEAD]


def read_lines(p):
    if not p.exists():
        return []
    return [ln if ln.endswith("\n") else ln + "\n" for ln in p.read_text(encoding="utf-8").splitlines()]


def merge(into, add, rotate_mb=0.0):
    """-> dict(added, replaced, dup, bad). Writes `into` atomically; may rotate it to archive/."""
    into, add = Path(into), Path(add)
    lines = [ln for ln in read_lines(into) if not ln.startswith("epoch,")]
    index = {}                                    # key -> [(epoch, line_no or None)]
    for i, ln in enumerate(lines):
        p = parse(ln)
        if p:
            index.setdefault(key(p[0]), []).append((p[1], i))
    archived = {}
    arch = sorted((into.parent / "archive").glob(into.stem + "-*.csv"))
    if arch:                                      # just after a rotation the overlap is in the archive
        for ln in read_lines(arch[-1])[-20000:]:
            p = parse(ln)
            if p:
                archived.setdefault(key(p[0]), []).append(p[1])
    stats = dict(added=0, replaced=0, dup=0, bad=0)
    new = []                                      # [epoch, line, pred_lead]
    for ln in read_lines(add):
        if ln.startswith("epoch,") or not ln.strip():
            continue
        p = parse(ln)
        if not p:
            stats["bad"] += 1
            continue
        r, ep, plead = p
        k = key(r)
        if any(abs(ep - e) <= DUP_S for e in archived.get(k, ())):
            stats["dup"] += 1
            continue
        hit = next(((e, i) for e, i in index.get(k, ()) if abs(ep - e) <= DUP_S), None)
        if hit is None:
            new.append([ep, ln, plead])
            index.setdefault(k, []).append((ep, -1 - (len(new) - 1)))   # negative = position in `new`
            continue
        i = hit[1]
        old = parse(lines[i] if i >= 0 else new[-1 - i][1])
        if old and plead < old[2]:
            if i >= 0:
                lines[i] = ln
            else:
                new[-1 - i][1:] = [ln, plead]
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
        f.writelines(x[1] for x in new)
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
    ap.add_argument("--add", required=True, help="predictions CSV written by one truth_logger.py run (--pred-out)")
    ap.add_argument("--rotate-mb", type=float, default=0, help="archive --into once it passes this size (0 = never)")
    a = ap.parse_args()
    if not Path(a.add).exists():
        print("merge predictions: no file (nothing to add)")
        return
    s = merge(a.into, a.add, a.rotate_mb)
    print("merge predictions: " + " ".join(f"{k}={v}" for k, v in s.items()))


if __name__ == "__main__":
    main()

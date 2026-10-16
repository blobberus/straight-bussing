#!/usr/bin/env python3
"""Put replayed days (tools/replay_day.py output) into the data branch's shared CSVs, conservatively (owner
2026-10-16: "Update all data collected if needed").

  python tools/apply_replay.py --data-dir DATA_WORKTREE --replay-dir DIR --day 2026-10-12 2026-10-13 [--dry-run]

DATA_WORKTREE is a checkout of the data branch (data/ground_truth/arrivals.csv, predictions.csv); DIR holds
arrivals-<day>.csv and predictions-<day>.csv from replay_day.py. Nothing is pushed: commit the result yourself.

arrivals.csv: each day's replayed rows are merged in with merge_arrivals (vehicle + stop within 300 s is the same
arrival; the richer row stays), which adds what the live run missed (the GPS `pass` rows of DC-002 before
2026-10-13, an arrival a run edge lost). A live row is never removed: no fix since collection began drops arrivals.

predictions.csv: a live row of a replayed day is removed only when BOTH hold:
  1. today's rule says it was about the bus's previous visit to that stop (DC-011, arrival_detector.Tracker._candidates):
     the same bus reached the stop 0 to 2 * STATE_TTL s before this arrival and the prediction was for a time before,
     or within PREV_VISIT_GAP_S after, that visit (or it was made before that visit on the same trip id);
  2. the replay with today's code has no row for that bus, stop and lead with an arrival within 300 s.
Then the replayed rows are merged with merge_predictions (adds what the old code missed, e.g. the DC-008 rows under a
re-matched trip id; of two duplicates the fresher prediction stays). A live row the replay could not rebuild (inputs
not kept, the replay's own limits) stays.

Idempotent: applying the same replay twice changes nothing the second time.
"""
import argparse, bisect, csv, io, os, sys, tempfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arrivals_lib import PRED_COLUMNS, PREV_VISIT_GAP_S, STATE_TTL
import merge_arrivals
import merge_predictions

DUP_S = merge_predictions.DUP_S
P = {c: PRED_COLUMNS.index(c) for c in ("epoch", "vehicle_id", "stop_id", "trip_id", "lead_target_s", "pred_epoch",
                                         "pred_made_epoch")}


def _int(x):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None


def visits(arrivals_path):
    """(vehicle, stop) -> sorted [(epoch, trip_id)] of every arrival in arrivals.csv."""
    out = defaultdict(list)
    with open(arrivals_path, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            e = _int(r.get("epoch"))
            if e is not None and r.get("vehicle_id") and r.get("stop_id"):
                out[(r["vehicle_id"], r["stop_id"])].append((e, r.get("trip_id") or ""))
    for v in out.values():
        v.sort()
    return out


def previous_lap(row, vis):
    """Rule 1 above for a predictions.csv row (list of fields)."""
    ep, pred, made = _int(row[P["epoch"]]), _int(row[P["pred_epoch"]]), _int(row[P["pred_made_epoch"]])
    if ep is None or pred is None:
        return False
    v = vis.get((row[P["vehicle_id"]], row[P["stop_id"]]), [])
    k = bisect.bisect_left(v, (ep - 60, ""))       # visits before this arrival (60 s: the same visit, merge slack)
    if not k:
        return False
    pv, ptrip = v[k - 1]
    if not 0 < ep - pv <= 2 * STATE_TTL:
        return False
    return pred < pv + PREV_VISIT_GAP_S or (ptrip == row[P["trip_id"]] and made is not None and made <= pv)


def replay_index(paths):
    """(vehicle, stop, lead) -> sorted arrival epochs of the replayed predictions rows; plus the epoch span covered."""
    idx, lo, hi = defaultdict(list), None, None
    for p in paths:
        with open(p, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                e = _int(r.get("epoch"))
                if e is None:
                    continue
                idx[(r["vehicle_id"], r["stop_id"], r["lead_target_s"])].append(e)
                lo, hi = (e if lo is None else min(lo, e)), (e if hi is None else max(hi, e))
    for v in idx.values():
        v.sort()
    return idx, lo, hi


def in_replay(row, idx):
    v = idx.get((row[P["vehicle_id"]], row[P["stop_id"]], row[P["lead_target_s"]]), [])
    ep = _int(row[P["epoch"]])
    k = bisect.bisect_left(v, ep - DUP_S)
    return k < len(v) and v[k] <= ep + DUP_S


def apply(data_dir, replay_dir, days, dry_run=False, out=sys.stdout):
    gt = Path(data_dir) / "data" / "ground_truth"
    arr, pred = gt / "arrivals.csv", gt / "predictions.csv"
    rdir = Path(replay_dir)
    a_files = [rdir / f"arrivals-{d}.csv" for d in days if (rdir / f"arrivals-{d}.csv").exists()]
    p_files = [rdir / f"predictions-{d}.csv" for d in days if (rdir / f"predictions-{d}.csv").exists()
               and (rdir / f"predictions-{d}.csv").stat().st_size > len(merge_predictions.HEADER)]
    work = Path(tempfile.mkdtemp(prefix="sb-apply-"))
    stats = {}
    try:
        a_into, p_into = (work / "arrivals.csv", work / "predictions.csv") if dry_run else (arr, pred)
        if dry_run:
            a_into.write_bytes(arr.read_bytes())
            p_into.write_bytes(pred.read_bytes())
        for f in a_files:
            s = merge_arrivals.merge(str(a_into), str(f))
            for k in ("added", "replaced"):
                stats[f"arrivals_{k}"] = stats.get(f"arrivals_{k}", 0) + s.get(k, 0)
        removed, kept_lines = 0, []
        idx, lo, hi = replay_index(p_files)
        vis = visits(a_into)
        with open(p_into, encoding="utf-8", newline="") as f:
            lines = f.readlines()
        for line in lines:
            r = merge_predictions.parse(line)
            if r is not None and lo is not None and lo - DUP_S <= r[1] <= hi + DUP_S:
                row = r[0]
                if previous_lap(row, vis) and not in_replay(row, idx):
                    removed += 1
                    continue
            kept_lines.append(line)
        if removed:
            tmp = p_into.with_name(p_into.name + ".tmp")
            with open(tmp, "w", encoding="utf-8", newline="") as f:
                f.writelines(kept_lines)
            os.replace(tmp, p_into)
        stats["predictions_removed"] = removed
        for f in p_files:
            s = merge_predictions.merge(str(p_into), str(f))
            for k in ("added", "replaced"):
                stats[f"predictions_{k}"] = stats.get(f"predictions_{k}", 0) + s.get(k, 0)
        print(f"apply replay {', '.join(days)}: " + " ".join(f"{k}={v}" for k, v in stats.items())
              + (" (dry run, nothing written)" if dry_run else ""), file=out)
        return stats
    finally:
        for p in work.glob("*"):
            p.unlink()
        work.rmdir()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True, help="a checkout of the data branch")
    ap.add_argument("--replay-dir", required=True, help="replay_day.py --out directory")
    ap.add_argument("--day", nargs="+", required=True)
    ap.add_argument("--dry-run", action="store_true", help="report what would change, write nothing")
    a = ap.parse_args(argv)
    apply(a.data_dir, a.replay_dir, a.day, a.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())

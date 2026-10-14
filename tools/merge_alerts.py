#!/usr/bin/env python3
"""Merge collector runs' alert versions into the shared alerts CSV (schema: alerts_lib.COLUMNS, docs/DATA.md
"alerts.csv").

  python tools/merge_alerts.py --into data/ground_truth/alerts.csv --add run_alerts.csv [more.csv ...]

One row per (alert_id, version). Overlapping runs see the same version: the merged row keeps the earliest
first_seen and the latest last_seen (blank fields are filled from the other copy); nothing else changes. The file
is small (a few versions a day), so it is rewritten whole, atomically, sorted by first_seen. Idempotent: merging
the same run twice gives the same bytes. A row of the shared file that cannot be read as a version (hand edit) is
kept as it is; such a row in a run file is skipped and counted (bad=). No rotation (years to reach 1 MB).
"""
import argparse, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import alerts_lib as A


def merge(into, adds):
    """-> dict(added, extended, same, bad, total). Writes `into` (created if missing, header only if empty)."""
    rows, odd = A.read_csv(into)
    index = {}
    for r in rows:
        A.absorb(index, r)                       # the shared file holds no duplicates; tolerate them anyway
    stats = dict(added=0, extended=0, same=0, bad=0)
    for p in adds:
        new, bad = A.read_csv(p)
        stats["bad"] += len(bad)
        for r in new:
            stats[A.absorb(index, r)] += 1
    A.write_csv(into, odd + list(index.values()))
    stats["total"] = len(index)
    if odd:
        stats["kept_unreadable"] = len(odd)
    return stats


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--into", required=True, help="shared CSV (created if missing)")
    ap.add_argument("--add", nargs="+", required=True, help="alert version CSVs written by truth_logger.py --alerts-out")
    a = ap.parse_args(argv)
    adds = [p for p in a.add if Path(p).exists()]
    if not adds:
        print("merge alerts: no file (nothing to add)")
        return 0
    s = merge(a.into, adds)
    print("merge alerts: " + " ".join(f"{k}={v}" for k, v in s.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())

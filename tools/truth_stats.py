#!/usr/bin/env python3
"""Summarize the ground-truth CSV: rows, stops, hour coverage, Passio MAE by prediction lead time.
  python tools/truth_stats.py [path]"""
import csv, statistics, sys
from collections import Counter
from pathlib import Path

DEFAULT = Path(__file__).resolve().parent.parent / "data" / "ground_truth" / "arrivals.csv"
BUCKETS = [(120, 300), (300, 600), (600, 1200), (1200, 3600)]


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    print(f"rows: {len(rows)}")
    if not rows:
        return
    ep = [int(r["epoch"]) for r in rows]
    print(f"span: {rows[0]['local_time']} .. {max(rows, key=lambda r: int(r['epoch']))['local_time']} (local)")
    print(f"stops covered: {len({r['stop_id'] for r in rows})}  routes: {len({r['route_id'] for r in rows})}  "
          f"vehicles: {len({r['vehicle_id'] for r in rows})}")
    print("sources:", dict(Counter(r["source"] for r in rows)))
    hc = Counter(int(r["hour"]) for r in rows)
    print("rows by local hour:", " ".join(f"{h:02d}:{hc[h]}" for h in sorted(hc)))
    dc = Counter(int(r["dow"]) for r in rows)
    print("rows by dow (0=Mon):", dict(sorted(dc.items())))
    sp = [float(r["speed_mps"]) for r in rows if r["speed_mps"]]
    if sp:
        print(f"speed_mps: n={len(sp)} median={statistics.median(sp):.1f} min={min(sp):.1f} max={max(sp):.1f}")
    errs = [(int(r["passio_pred_lead_s"]), int(r["passio_pred_epoch"]) - int(r["epoch"]))
            for r in rows if r["passio_pred_epoch"]]
    print(f"rows with a Passio prediction: {len(errs)}")
    for lo, hi in BUCKETS:
        e = [x for ld, x in errs if lo <= ld < hi]
        if e:
            print(f"  lead {lo // 60:>2}-{hi // 60:<2} min: n={len(e):4d} MAE={statistics.mean(map(abs, e)):6.1f}s "
                  f"bias={statistics.mean(e):+6.1f}s")


if __name__ == "__main__":
    main()

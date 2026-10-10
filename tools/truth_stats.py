#!/usr/bin/env python3
"""Summarize the ground-truth CSV: rows, stops, hour coverage, Passio MAE by prediction lead time.
  python tools/truth_stats.py [path]"""
import csv, statistics, sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_core import SAME_VISIT_S, clean_dicts

DEFAULT = Path(__file__).resolve().parent.parent / "data" / "ground_truth" / "arrivals.csv"
BUCKETS = [(120, 300), (300, 600), (600, 1200), (1200, 3600)]


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    print(f"rows: {len(rows)}")
    if not rows:
        return
    by_t = sorted(rows, key=lambda r: int(r["epoch"]))      # rows are appended at departure: only roughly sorted
    print(f"span: {by_t[0]['local_time']} .. {by_t[-1]['local_time']} (local)")
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
    dist = [float(r["dist_prev_m"]) for r in rows if r["dist_prev_m"]]
    dw = [float(r["dwell_s"]) for r in rows if r["dwell_s"]]
    visits = defaultdict(list)          # trip ids repeat daily (and DCC buses share one): dedupe on bus + stop + time
    for r in rows:
        visits[(r["vehicle_id"], r["stop_id"])].append(int(r["epoch"]))
    gaps = [b - a for v in visits.values() for a, b in zip(sorted(v), sorted(v)[1:])]
    print(f"sanity: speeds outside 0-20 m/s: {sum(not 0 < x <= 20 for x in sp)}, dist_prev_m <= 0: "
          f"{sum(x <= 0 for x in dist)}, same bus + stop <= 120 s (old merge rule): {sum(g <= 120 for g in gaps)}, "
          f"121-{SAME_VISIT_S} s (merged since E01 B4): {sum(120 < g <= SAME_VISIT_S for g in gaps)}, "
          f"median dwell: {statistics.median(dw) if dw else '-'} s")
    kept, stale, untrusted = clean_dicts(rows)
    kept = {id(r) for r in kept}
    print(f"E01 checks (RouteKnower.md 3.3): stale prev links {len(stale)}, Passio predictions not trusted "
          f"{len(untrusted)} (trip id shared by 2+ buses, trip start, or lead >= 300 s)")
    errs = [(int(r["passio_pred_lead_s"]), int(r["passio_pred_epoch"]) - int(r["epoch"]))
            for r in rows if r["passio_pred_epoch"]]
    print(f"rows with a Passio prediction: {len(errs)}")
    for lo, hi in BUCKETS:
        e = [x for ld, x in errs if lo <= ld < hi]
        if e:
            print(f"  lead {lo // 60:>2}-{hi // 60:<2} min: n={len(e):4d} MAE={statistics.mean(map(abs, e)):6.1f}s "
                  f"bias={statistics.mean(e):+6.1f}s")
    ok = [int(r["passio_pred_epoch"]) - int(r["epoch"]) for r in rows
          if r["passio_pred_epoch"] and id(r) in kept and id(r) not in untrusted]
    if ok:
        print(f"  trusted only (E01; leads >= 5 min are not a fair sample): n={len(ok)} "
              f"MAE={statistics.mean(map(abs, ok)):.1f}s bias={statistics.mean(ok):+.1f}s")


if __name__ == "__main__":
    main()

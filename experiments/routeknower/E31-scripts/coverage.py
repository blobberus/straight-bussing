#!/usr/bin/env python3
"""E31: arrivals with NO Passio time on display. For a rider at the stop, no time is a miss too.

Every arrival the collector logged from Passio's own data (arrivals.csv, every source but `gps`: the GPS sweep never
looks up a prediction, arrival_detector) from the first predictions.csv row on is a TARGET. It is covered at a lead
when predictions.csv has a row for the same bus and stop with an arrival epoch within MAX_SHIFT_S (a replay can move an
arrival by seconds) at that lead_target_s. Reported per line and stop: the share with a time 5 min ahead (the goal's
under-10 point), 10 min ahead, and at any lead (1 to 30 min).

  python experiments/routeknower/E31-scripts/coverage.py --arrivals arrivals.csv --predictions <archive.csv> <current.csv>
      [--from 2026-10-12 --to 2026-11-10]     # prints the share covered per line
"""
import argparse, sys
from bisect import bisect_left
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import misses_lib as M          # noqa: E402

MAX_SHIFT_S = 60


class PredIndex:
    """predictions rows -> per (vehicle, stop) sorted [(epoch, lead set)] for coverage lookups."""

    def __init__(self, preds):
        by = defaultdict(dict)
        for r in preds:
            by[(r["vehicle_id"], r["stop_id"])].setdefault(r["epoch_i"], set()).add(r["lead"])
        self.by = {k: sorted(v.items()) for k, v in by.items()}

    def leads_at(self, veh, stop, epoch, max_shift=MAX_SHIFT_S):
        """-> the set of leads predicted for the arrival nearest epoch (within max_shift), else an empty set."""
        lst = self.by.get((str(veh), str(stop)))
        if not lst:
            return set()
        i = bisect_left(lst, (epoch, set()))
        best = None
        for j in (i - 1, i):
            if 0 <= j < len(lst) and abs(lst[j][0] - epoch) <= max_shift:
                if best is None or abs(lst[j][0] - epoch) < abs(best[0] - epoch):
                    best = lst[j]
        return set(best[1]) if best else set()


def targets(arrivals, index):
    """-> list of dicts per arrival: route_id, route, stop_id, stop, stop_index, vehicle_id, trip_id, epoch, day,
    has_5, has_10, has_any, source."""
    out = []
    for a in arrivals:
        leads = index.leads_at(a["vehicle_id"], a["stop_id"], a["epoch_i"])
        out.append({"route_id": a["route_id"], "route": a.get("route_name", ""), "stop_id": a["stop_id"],
                    "stop": a.get("stop_name", ""), "stop_index": a.get("stop_index", ""),
                    "vehicle_id": a["vehicle_id"], "trip_id": a.get("trip_id", ""), "epoch": a["epoch_i"],
                    "day": a["day"], "source": a.get("source", ""),
                    "has_5": int(300 in leads), "has_10": int(600 in leads), "has_any": int(bool(leads))})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--arrivals", required=True)
    ap.add_argument("--predictions", nargs="+", required=True, help="oldest first (archive, then current)")
    ap.add_argument("--from", dest="day_from", default="2026-10-12")
    ap.add_argument("--to", dest="day_to", default=None)
    a = ap.parse_args(argv)
    preds = M.load_predictions(a.predictions, a.day_from, a.day_to)
    t0 = min(r["epoch_i"] for r in preds)
    tg = targets(M.load_arrivals(a.arrivals, t_from=t0, day_to=a.day_to), PredIndex(preds))
    by = defaultdict(lambda: [0, 0, 0])
    for t in tg:
        v = by[t["route"]]
        v[0] += 1
        v[1] += t["has_5"]
        v[2] += t["has_any"]
    for k, (n, h5, ha) in sorted(by.items(), key=lambda kv: kv[1][1] / kv[1][0]):
        print(f"{k:30s} {n:7d} arrivals  time 5 min ahead {h5 / n:6.1%}  any time {ha / n:6.1%}")


if __name__ == "__main__":
    main()

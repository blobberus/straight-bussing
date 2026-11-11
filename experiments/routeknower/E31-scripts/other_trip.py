#!/usr/bin/env python3
"""E31: what a rider's screen showed for an arrival that has NO time in predictions.csv, from Passio's raw prediction
updates (release assets pred-updates-<day>.jsonl.gz).

DC-025 (2026-11-10): since Oct 28 the first stops after a terminal often get the bus's time only under ANOTHER trip id
(the trip update has the bus on its next or previous timetable trip while its vehicle report keeps the other). The
collector does not count those times (arrival_detector preds_at / _other_trip_preds skip a trip that has not started:
the owner's call to change, with a replay). A screen lists every trip update with the bus's number, so riders did see
them. This module measures that view at one moment, LEAD_S (5 min, the goal's under-10 point) before the arrival:

  t = arrival - LEAD_S; for every trip id of the SAME bus (never another bus, never an update without a vehicle id)
  with this stop, the update on display at t (the newest first seen by t, still shown by a poll within SHOW_GRACE_S);
  it counts if its time is no more than SHOWN_PAST_S before t, within an hour of the arrival, and about this visit:
  first seen after the bus's previous visit to the stop and predicting PREV_VISIT_GAP_S or more past it (the
  arrivals_lib constants). The earliest such time is what the screen showed first; err = shown - arrival.

  python experiments/routeknower/E31-scripts/other_trip.py --pred-updates <dir> --arrivals arrivals.csv \
      --predictions <archive.csv> <current.csv> [--from D --to D]      # prints per line how often and how far off
"""
import argparse, sys
from bisect import bisect_right
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import misses_lib as M          # noqa: E402
import coverage as C            # noqa: E402
L = M.L
sys.path.insert(0, str(M.ROOT / "tools"))
import build_eta_dataset as E   # noqa: E402  (load_pred_updates, day_bounds: the collector's own readers)

LEAD_S = 300


def bus_index(updates):
    """load_pred_updates output -> {(veh, stop): {trip: sorted entries}} (vehicle-less updates dropped)."""
    out = defaultdict(dict)
    for (veh, trip, stop), v in updates.items():
        if veh is not None:
            out[(veh, stop)][trip] = v
    return out


def shown_at(entries, t):
    """entries sorted by first seen: (seen, last, made, pred, seq) -> the one on display at t, or None."""
    i = bisect_right([e[0] for e in entries], t)
    if not i:
        return None
    e = entries[i - 1]
    return e if e[1] >= t - L.SHOW_GRACE_S else None


def screen_time(index, veh, stop, epoch, prev_visit=None, lead=LEAD_S):
    """-> (shown epoch, trip id) the screen showed first for this bus and stop `lead` s before the arrival, or None."""
    t = epoch - lead
    best = None
    for trip, entries in (index.get((str(veh), str(stop))) or {}).items():
        e = shown_at(entries, t)
        if e is None:
            continue
        seen, _, _, pred, _ = e
        if pred < t - L.SHOWN_PAST_S or abs(pred - epoch) >= 3600:
            continue
        if prev_visit is not None and (seen <= prev_visit or pred < prev_visit + L.PREV_VISIT_GAP_S):
            continue
        if best is None or pred < best[0]:
            best = (pred, trip)
    return best


def previous_visits(arrivals):
    """arrivals (any source) -> {(veh, stop): sorted epochs}."""
    by = defaultdict(list)
    for a in arrivals:
        by[(a["vehicle_id"], a["stop_id"])].append(a["epoch_i"])
    for v in by.values():
        v.sort()
    return by


def prev_of(visits, veh, stop, epoch):
    lst = visits.get((veh, stop)) or []
    i = bisect_right(lst, epoch - 1)
    return lst[i - 1] if i else None


def day_screens(day, upd_paths, gaps, visits):
    """gaps: the day's target dicts (coverage.targets) with no 5-min time -> list of (target, shown, trip, err)."""
    t0, t1 = E.day_bounds(day)
    index = bus_index(E.load_pred_updates(upd_paths, t0, t1))
    out = []
    for g in gaps:
        pv = prev_of(visits, g["vehicle_id"], g["stop_id"], g["epoch"])
        hit = screen_time(index, g["vehicle_id"], g["stop_id"], g["epoch"], pv)
        if hit:
            out.append((g, hit[0], hit[1], hit[0] - g["epoch"]))
    return out


def updates_for(folder, day):
    p = Path(folder)
    return sorted(p.glob(f"pred-updates-{day}.jsonl*"))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pred-updates", required=True, help="folder with pred-updates-<day>.jsonl.gz")
    ap.add_argument("--arrivals", required=True)
    ap.add_argument("--predictions", nargs="+", required=True)
    ap.add_argument("--from", dest="day_from", default="2026-10-12")
    ap.add_argument("--to", dest="day_to", default=None)
    a = ap.parse_args(argv)
    preds = M.load_predictions(a.predictions, a.day_from, a.day_to)
    t0 = min(r["epoch_i"] for r in preds)
    arr_all = M.load_arrivals(a.arrivals, t_from=t0 - 7200, day_to=a.day_to, skip_sources=())
    visits = previous_visits(arr_all)
    tg = C.targets([x for x in arr_all if x["source"] != "gps" and x["epoch_i"] >= t0], C.PredIndex(preds))
    by_day = defaultdict(list)
    for t in tg:
        if not t["has_5"]:
            by_day[t["day"]].append(t)
    agg = defaultdict(lambda: [0, 0, 0])
    for day in sorted(by_day):
        ups = updates_for(a.pred_updates, day)
        if not ups:
            continue
        for g, _, _, err in day_screens(day, ups, by_day[day], visits):
            v = agg[g["route"]]
            v[0] += 1
            v[1] += err < -180
            v[2] += err > 120
    for k, (n, late3, early2) in sorted(agg.items()):
        print(f"{k:30s} {n:6d} arrivals showed another trip's time 5 min ahead; bus > 3 min later {late3 / n:6.1%}, "
              f"> 2 min earlier {early2 / n:6.1%}")


if __name__ == "__main__":
    main()

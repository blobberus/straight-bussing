#!/usr/bin/env python3
"""E30 detectors anchored on E29's bus count changes (data/labeled/transitions/transitions.csv): what Passio and the
other buses of the line did around them.

  ghost_predictions_after_leave  a lasting leave (break / shift_end / route_switch / feed_drop) after which Passio still
                    showed a time for the bus on this line for >= GHOST_MIN min (E29 passio_pred_after_min; stops =
                    E29 phantom_stops, the stops it promised and never served). beyond_gone_min = minutes past the
                    app's 15-min GONE rule (core/transition.js, shipped Nov 6).
  joining_bus_no_predictions  a non-layover add whose bus served >= 2 stops of the line (logged arrivals) before Passio
                    showed any time for it on the line (a prediction >= 1 min ahead of when it was seen; at most 60 min
                    looked at). The four Downtown Campus Connector stops without any Passio time since Oct 27 (DC-025)
                    are not counted.
  staying_bus_late_after_drop  after a lasting leave that leaves >= 1 bus on the line, the staying buses' Passio
                    predictions 10, 15 and 20 min ahead for their arrivals in the next 45 min (predictions.csv): an
                    episode when n >= 2 and the median error is >= 3 min late (the bus came later than shown; DC-020).
  bunching_after_add  a non-layover add after which the joining bus and another bus of the line visited the same stop
                    within 2 min of each other >= 3 times in the next 30 min.
The per-row inputs of the baselines (every prediction row and every arrival, tagged by whether it sits in one of these
windows) come from tag_predictions() and bunched_share().
"""
import bisect, csv, statistics
from collections import defaultdict

import odd_lib as L

GHOST_MIN = 5
GONE_MIN = 15
JOIN_LOOK_S = 3600
JOIN_MIN_SERVED = 2
STAY_AFTER_S = 2700
STAY_LEADS = (600, 900, 1200)
LATE_S = 180
BUNCH_S, BUNCH_AFTER_S, BUNCH_MIN = 120, 1800, 3


def load_predictions(paths):
    """predictions.csv rows (data branch, + its archive) -> {(route_id, vehicle_id): sorted [(arrival epoch, lead_target_s,
    pred_minus_actual_s, stop_id)]}; one row per (arrival, stop, lead)."""
    by, seen = defaultdict(list), set()
    for p in paths:
        with open(p, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                try:
                    k = (int(r["epoch"]), r["vehicle_id"], r["stop_id"], int(r["lead_target_s"]))
                    if k in seen:
                        continue
                    seen.add(k)
                    by[(r["route_id"], r["vehicle_id"])].append((k[0], k[3], int(float(r["pred_minus_actual_s"])), r["stop_id"]))
                except (KeyError, ValueError):
                    continue
    for v in by.values():
        v.sort()
    return by


def _vehicles_on(polls, rid, a, b, but):
    return sorted({veh for veh, tr in polls.tracks.items() if veh != but and any(
        r[1] == rid for r in tr[bisect.bisect_left(tr, (a,)):bisect.bisect_right(tr, (b, "￿"))])})


def ghost_predictions(day, trans_rows):
    out = []
    for r in trans_rows:
        if r["kind"] != "leave" or r["label"] not in L.LASTING or r["passio_pred_after_min"] in ("", None):
            continue
        m = float(r["passio_pred_after_min"])
        if m < GHOST_MIN:
            continue
        t = int(r["epoch"])
        out.append({"service_day": day, "code": "ghost_predictions_after_leave", "vehicle_id": r["vehicle_id"],
                    "route_id": r["route_id"], "start": t, "end": t + int(m * 60), "duration_min": round(m, 1),
                    "lat": r["spot_lat"], "lon": r["spot_lon"], "outcome": r["label"],
                    "stops_affected": int(r["phantom_stops"] or 0), "beyond_gone_min": round(max(0.0, m - GONE_MIN), 1),
                    "event_ref": r["event_id"], "spot_name": r["spot"]})
    return out


def joining_no_predictions(day, trans_rows, arr, preds, routes_of):
    out = []
    for r in trans_rows:
        if r["kind"] != "add" or r["label"] == "layover_swap":
            continue
        veh, rid, t = r["vehicle_id"], r["route_id"], int(r["epoch"])
        pl = preds.get(veh, [])
        i = bisect.bisect_left(pl, (t - 120,))
        first = None
        while i < len(pl) and pl[i][0] <= t + JOIN_LOOK_S:
            seen, last, trip, stop, pred = pl[i]
            if routes_of.get(trip) == rid and pred >= seen + 60:
                first = seen
                break
            i += 1
        until = first if first is not None else t + JOIN_LOOK_S
        served = [a for a in L.arrivals_in(arr, veh, t - 60, until, rid)
                  if not (a[2] in L.DCC_DARK_STOPS and a[0] >= L.DCC_DARK_FROM)]
        if len(served) < JOIN_MIN_SERVED:
            continue
        out.append({"service_day": day, "code": "joining_bus_no_predictions", "vehicle_id": veh, "route_id": rid,
                    "start": t, "end": until, "duration_min": round((until - t) / 60, 1),
                    "lat": r["spot_lat"], "lon": r["spot_lon"],
                    "outcome": "predicted_later" if first is not None else "no_time_in_60_min",
                    "stops_affected": len(served), "arrivals_during": len(served), "event_ref": r["event_id"],
                    "spot_name": r["spot"], "pred_visible": "n"})
    return out


def staying_late(day, trans_rows, polls, preds_csv):
    """-> (episodes, tagged rows [(route_id, err_s, arrival epoch, vehicle, stop, buses_after)] of the staying buses
    after drops)."""
    out, tagged = [], []
    for r in trans_rows:
        if r["kind"] != "leave" or r["label"] not in L.LASTING or int(r["buses_after"] or 0) < 1:
            continue
        rid, t, veh = r["route_id"], int(r["epoch"]), r["vehicle_id"]
        stay = _vehicles_on(polls, rid, t - 600, t + 600, veh)
        rows = []
        for v in stay:
            lst = preds_csv.get((rid, v), [])
            i = bisect.bisect_left(lst, (t,))
            while i < len(lst) and lst[i][0] <= t + STAY_AFTER_S:
                if lst[i][1] in STAY_LEADS:
                    rows.append((lst[i][0], v, lst[i][2], lst[i][3]))
                i += 1
        tagged.extend((rid, x[2], x[0], x[1], x[3], int(r["buses_after"])) for x in rows)
        if len(rows) < 2:
            continue
        med = statistics.median(x[2] for x in rows)
        if med > -LATE_S:
            continue
        late = [x for x in rows if x[2] <= -LATE_S]
        out.append({"service_day": day, "code": "staying_bus_late_after_drop", "vehicle_id": ";".join(sorted({x[1] for x in rows})),
                    "route_id": rid, "start": t, "end": max(x[0] for x in rows),
                    "duration_min": round((max(x[0] for x in rows) - t) / 60, 1), "lat": r["spot_lat"], "lon": r["spot_lon"],
                    "outcome": r["label"], "other_vehicle": veh, "median_err_min": round(med / 60, 1),
                    "max_late_min": round(-min(x[2] for x in rows) / 60, 1), "pred_rows": len(rows), "late_rows": len(late),
                    "stops_affected": len({x[3] for x in late}), "event_ref": r["event_id"], "spot_name": r["spot"],
                    "observed": int(r["buses_after"])})
    return out, tagged


def _bunched(arr_route, i, s=BUNCH_S):
    """Is arrival i of a route-sorted list [(epoch, veh, stop)] within s of another bus at the same stop?"""
    e, v, stop = arr_route[i]
    j = i - 1
    while j >= 0 and e - arr_route[j][0] <= s:
        if arr_route[j][2] == stop and arr_route[j][1] != v:
            return True
        j -= 1
    j = i + 1
    while j < len(arr_route) and arr_route[j][0] - e <= s:
        if arr_route[j][2] == stop and arr_route[j][1] != v:
            return True
        j += 1
    return False


def route_arrivals(arr, t0, t1):
    """{route_id: sorted [(epoch, veh, stop)]} of the day."""
    by = defaultdict(list)
    for veh, lst in arr.items():
        for a in lst[bisect.bisect_left(lst, (t0,)):bisect.bisect_left(lst, (t1,))]:
            by[a[1]].append((a[0], veh, a[2]))
    for v in by.values():
        v.sort()
    return by


def bunching_after_add(day, trans_rows, rarr):
    out = []
    for r in trans_rows:
        if r["kind"] != "add" or r["label"] == "layover_swap":
            continue
        rid, veh, t = r["route_id"], r["vehicle_id"], int(r["epoch"])
        lst = rarr.get(rid, [])
        i0, i1 = bisect.bisect_left(lst, (t,)), bisect.bisect_right(lst, (t + BUNCH_AFTER_S, "￿"))
        hits = [lst[i] for i in range(i0, i1) if lst[i][1] == veh and _bunched(lst, i)]
        if len(hits) < BUNCH_MIN:
            continue
        others = set()
        for e, v, stop in hits:
            for x in lst[bisect.bisect_left(lst, (e - BUNCH_S,)):bisect.bisect_right(lst, (e + BUNCH_S, "￿"))]:
                if x[2] == stop and x[1] != veh:
                    others.add(x[1])
        out.append({"service_day": day, "code": "bunching_after_add", "vehicle_id": veh, "route_id": rid,
                    "start": t, "end": hits[-1][0], "duration_min": round((hits[-1][0] - t) / 60, 1),
                    "lat": r["spot_lat"], "lon": r["spot_lon"], "outcome": r["label"],
                    "other_vehicle": ";".join(sorted(others)), "stops_affected": len({h[2] for h in hits}),
                    "arrivals_during": len(hits), "event_ref": r["event_id"], "spot_name": r["spot"]})
    return out


def bunched_flags(rarr):
    """{route_id: [(epoch, bunched bool)]} for every arrival of the day (the baseline of bunching_after_add)."""
    return {rid: [(lst[i][0], _bunched(lst, i)) for i in range(len(lst))] for rid, lst in rarr.items()}

#!/usr/bin/env python3
"""E30 detectors: buses shown but not in service (E28) and buses off their line (E27b / E27c) around transitions.

  linger_not_in_service  an E28 dwell episode (still within 80 m for >= 3 min, experiments/routeknower/E28-scripts/
                    endofservice.py, one CSV per day) labeled break, end_of_shift, garage_return or
                    parked_never_served, lasting >= LINGER_MIN min: the bus sits on the map with its route label while
                    it is not serving. pred_visible = Passio predicted it in at least a quarter of the episode's minutes.
  off_route_drive   a bus > OFF_M (250 m, E27b) from its labeled line AND from its route's learned driven corridor
                    (web/data/corridors.json, E27c) on >= 2 reports spanning >= 45 s, inside its listed hours +- 30
                    min (after_hours covers the rest). outcome: garage (a report within 700 m of the operator's garage),
                    in_service (an arrival on its route <= 15 min before and <= 20 min after), not_serving.
"""
import csv, json, math
from collections import defaultdict
from pathlib import Path

import numpy as np

import odd_lib as L

LINGER_LABELS = {"break", "end_of_shift", "garage_return", "parked_never_served"}
LINGER_MIN = 5.0
OFF_M, OFF_MIN_S, OFF_GAP_S = 250, 45, 120
HOURS_PAD_S = 1800
SERVE_BEFORE_S, SERVE_AFTER_S = 900, 1200


def lingers(day, e28_dir):
    p = Path(e28_dir) / f"{day}.csv"
    out = []
    if not p.exists():
        return out
    for r in L.read_csv(p):
        if r["label"] not in LINGER_LABELS or float(r["duration_min"] or 0) < LINGER_MIN:
            continue
        a = _epoch(r["start"])
        b = a + int(float(r["duration_min"]) * 60)
        share = float(r["pred_share"] or 0)
        out.append({"service_day": day, "code": "linger_not_in_service", "vehicle_id": r["vehicle"], "route_id": r["route_id"],
                    "start": a, "end": b, "duration_min": round(float(r["duration_min"]), 1), "lat": r["lat"], "lon": r["lon"],
                    "outcome": r["label"], "pred_visible": "y" if share >= 0.25 else "n", "pred_share": share,
                    "spot_name": r["spot"].split(" (")[0], "shown_min": r.get("shown_by_app_min", "")})
    return out


def _epoch(s):
    d = L.datetime.strptime(s, "%Y-%m-%d %H:%M")
    return int(d.replace(tzinfo=L.CT).timestamp())


def load_corridors(path):
    try:
        j = json.loads(Path(path).read_text(encoding="utf-8"))
        return {rid: O_xy(v["pts"]) for rid, v in (j.get("routes") or {}).items() if v.get("pts")}
    except (OSError, ValueError, KeyError):
        return {}


def O_xy(pts):
    return L.O.xy([p[0] for p in pts], [p[1] for p in pts])


def own_dist(polls, st, corridors):
    """{veh: np.array} distance of each fresh report to its labeled line (or the route's corridor, whichever is
    nearer); inf for a label the timetable does not know."""
    out = {}
    for veh, tr in polls.tracks.items():
        d = np.full(len(tr), np.inf)
        by = defaultdict(list)
        for i, r in enumerate(tr):
            by[r[1]].append(i)
        for rid, idx in by.items():
            segs = st["segs"].get(rid)
            if segs is None:
                continue
            idx = np.array(idx)
            P = L.O.xy([tr[i][3] for i in idx], [tr[i][4] for i in idx])
            dd = L.O.dist_to_segs(P, segs)
            c = corridors.get(rid)
            far = np.where(dd > OFF_M)[0]
            if c is not None and len(far):
                dc = np.sqrt(((P[far, None, :] - c[None]) ** 2).sum(2)).min(1)
                dd[far] = np.minimum(dd[far], dc)
            d[idx] = dd
        out[veh] = d
    return out


def off_route(day, polls, st, spans3, arr, dists, preds=None, routes_of=None):
    out = []
    for veh, tr in polls.tracks.items():
        d = dists.get(veh)
        if d is None:
            continue
        i, n = 0, len(tr)
        while i < n:
            if not (d[i] > OFF_M and math.isfinite(d[i])):
                i += 1
                continue
            j = i
            while j + 1 < n and d[j + 1] > OFF_M and math.isfinite(d[j + 1]) and tr[j + 1][1] == tr[i][1] \
                    and tr[j + 1][0] - tr[j][0] <= OFF_GAP_S:
                j += 1
            a, b, rid = tr[i][0], tr[j][0], tr[i][1]
            side, gap = L.hours_outside(spans3.get(rid, []), a)
            if j > i and b - a >= OFF_MIN_S and gap <= HOURS_PAD_S:
                seg = tr[i:j + 1]
                k = i + int(np.argmax(d[i:j + 1]))
                gar = any(L.hav_m(r[3], r[4], *L.GARAGE) <= L.GARAGE_M for r in seg)
                before = L.arrivals_in(arr, veh, a - SERVE_BEFORE_S, a, rid)
                after = L.arrivals_in(arr, veh, b, b + SERVE_AFTER_S, rid)
                outcome = "garage" if gar else ("in_service" if before and after else "not_serving")
                pv = ""
                if preds is not None:
                    vis = L.T.preds_visible(preds.get(veh, []), min(b, a + OFF_MIN_S), routes_of or {}, rid)
                    pv = "y" if any(p[4] >= a + OFF_MIN_S + 120 for p in vis) else "n"
                out.append({"service_day": day, "code": "off_route_drive", "vehicle_id": veh, "route_id": rid,
                            "start": a, "end": b, "duration_min": round((b - a) / 60, 1),
                            "lat": round(tr[k][3], 5), "lon": round(tr[k][4], 5), "outcome": outcome,
                            "max_dist_m": round(float(d[k])), "pred_visible": pv,
                            "arrivals_during": len(L.arrivals_in(arr, veh, a, b, rid))})
            i = j + 1
    return out

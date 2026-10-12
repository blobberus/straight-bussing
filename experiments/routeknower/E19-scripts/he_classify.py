"""Huge-error investigation, step 2: flag the evidence for each cause on every predicted arrival.
Writes he_rows.json (one dict per row with a prediction) for the summaries."""
import sys, json, math, bisect, statistics
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, r"C:\Users\billy\Documents\straight-bussing\tools")
import model_core as C

ROOT = Path(r"C:\Users\billy\Documents\straight-bussing")
RK = Path(sys.argv[1]).parent
B1_FIX = 1791620287 + 2 * 3600
stops = json.loads((ROOT / "web/data/stops.json").read_text(encoding="utf-8"))
route_stops = json.loads((ROOT / "web/data/route_stops.json").read_text(encoding="utf-8"))

dicts = C.read_dicts(sys.argv[1])
kept, stale, nop = C.clean_dicts(dicts)


def hav(a, b, c, d):
    return C.haversine(a, b, c, d)


# ---- raw polls: per vehicle sorted reports (vt, lat, lon, speed, trip, route, stop) and poll coverage
raw = defaultdict(list)
poll_t = []
for f in sorted((RK / "raw" / "days").glob("*.jsonl")):
    for ln in f.read_text(encoding="utf-8").splitlines():
        if not ln.strip():
            continue
        p = json.loads(ln)
        poll_t.append(p["t"])
        for v in p.get("v") or []:
            veh, trip, route, lat, lon, br, sp, q, sid, status, vt = v
            if lat is None or lon is None:
                continue
            raw[str(veh)].append((int(vt or p["t"]), lat, lon, sp, str(trip), str(route), str(sid)))
for v in raw.values():
    v.sort()
poll_t.sort()
RAW_T0, RAW_T1 = (poll_t[0], poll_t[-1]) if poll_t else (0, 0)
print("raw polls:", len(poll_t), "polls,", sum(len(v) for v in raw.values()), "reports,", len(raw), "vehicles;",
      C.chicago(RAW_T0), "to", C.chicago(RAW_T1))


def raw_between(veh, t0, t1):
    v = raw.get(veh, [])
    i, j = bisect.bisect_left(v, (t0,)), bisect.bisect_right(v, (t1 + 1,))
    return v[i:j]


def polls_cover(t0, t1):
    """True if the collector was polling throughout [t0, t1] (no gap > 60 s)."""
    if t0 < RAW_T0 or t1 > RAW_T1:
        return False
    i, j = bisect.bisect_left(poll_t, t0 - 30), bisect.bisect_right(poll_t, t1 + 30)
    pts = poll_t[i:j]
    return len(pts) > 1 and all(b - a <= 60 for a, b in zip(pts, pts[1:])) and pts[0] <= t0 + 30 and pts[-1] >= t1 - 30


# ---- arrivals indexes
by_veh = defaultdict(list)      # veh -> [(epoch, stop, trip, route, idx, dwell)]
by_stop = defaultdict(list)     # stop -> [(epoch, veh)]
by_trip = defaultdict(list)
for d in kept:
    ep = C._f(d.get("epoch"))
    if ep is None:
        continue
    by_veh[d["vehicle_id"]].append((ep, d["stop_id"], d["trip_id"], d["route_id"], d["stop_index"], C._f(d.get("dwell_s"))))
    by_stop[d["stop_id"]].append((ep, d["vehicle_id"]))
    by_trip[d["trip_id"]].append((ep, d["vehicle_id"]))
for x in (by_veh, by_stop, by_trip):
    for v in x.values():
        v.sort()

# loop time per route: median gap between the same vehicle's consecutive visits to the same stop (5-120 min)
gaps = defaultdict(list)
for veh, lst in by_veh.items():
    last = {}
    for ep, sid, trip, rid, idx, dw in lst:
        k = (rid, sid)
        if k in last and 300 < ep - last[k] < 7200:
            gaps[rid].append(ep - last[k])
        last[k] = ep
loop_s = {rid: statistics.median(v) for rid, v in gaps.items() if len(v) >= 10}
# headway at a stop: median gap between consecutive buses of the same route
hw = defaultdict(list)
for sid, lst in by_stop.items():
    pass
route_of = {}
for d in kept:
    route_of[(d["vehicle_id"], C._f(d.get("epoch")))] = d["route_id"]

out = []
for d in kept:
    ep, pe, lead = C._f(d.get("epoch")), C._f(d.get("passio_pred_epoch")), C._f(d.get("passio_pred_lead_s"))
    if ep is None or pe is None or lead is None:
        continue
    veh, sid, rid, trip = d["vehicle_id"], d["stop_id"], d["route_id"], d["trip_id"]
    e = pe - ep
    made = ep - lead
    f = {"ep": ep, "e": e, "lead": lead, "veh": veh, "stop": sid, "route": rid, "route_name": d["route_name"],
         "stop_name": d["stop_name"], "trip": trip, "idx": d["stop_index"], "local": d["local_time"],
         "hour": int(C._f(d.get("hour"), 0)), "dow": int(C._f(d.get("dow"), 0)), "dwell": C._f(d.get("dwell_s")),
         "source": d.get("source"), "clean": id(d) not in nop, "post": ep >= B1_FIX, "stale_link": id(d) in stale,
         "loop_s": loop_s.get(rid)}
    # same vehicle, same stop, other visits
    own = [x for x in by_veh[veh] if x[1] == sid and abs(x[0] - ep) > 120]
    prev_same = max((x[0] for x in own if x[0] < ep), default=None)
    next_same = min((x[0] for x in own if x[0] > ep), default=None)
    f["prev_same_dt"] = None if prev_same is None else ep - prev_same
    f["next_same_dt"] = None if next_same is None else next_same - ep
    f["wrong_lap"] = any(t is not None and abs(pe - t) <= 90 for t in (prev_same, next_same))
    # pred falls before this bus's previous visit to this stop ended: it cannot be for this visit
    f["pred_before_prev_visit"] = prev_same is not None and pe <= prev_same + 60
    # another vehicle at this stop near the predicted time
    lst = by_stop[sid]
    i, j = bisect.bisect_left(lst, (pe - 90, "")), bisect.bisect_right(lst, (pe + 90, "\uffff"))
    f["other_bus_at_pred"] = any(v != veh for _, v in lst[i:j])
    tl = by_trip.get(trip, [])
    i, j = bisect.bisect_left(tl, (ep - C.SHARED_TRIP_S, "")), bisect.bisect_right(tl, (ep + C.SHARED_TRIP_S, "\uffff"))
    f["shared_trip"] = any(v != veh for _, v in tl[i:j])
    f["past_pred"] = pe < made - 60          # Passio said "already there" when it made the prediction
    # this vehicle's own logged arrivals between made and the arrival, and long dwells there
    mid = [x for x in by_veh[veh] if made < x[0] < ep]
    f["stops_between"] = len(mid)
    f["max_dwell_between"] = max([x[5] or 0 for x in mid] + [0])
    f["route_change"] = any(x[3] != rid for x in mid)
    f["trip_change"] = any(x[2] != trip for x in mid)
    # raw polls
    cov = polls_cover(made, ep)
    f["raw"] = cov
    if cov:
        rr = raw_between(veh, int(made) - 15, int(ep) + 15)
        f["raw_n"] = len(rr)
        ts = [r[0] for r in rr]
        f["raw_max_gap"] = max([b - a for a, b in zip(ts, ts[1:])] + ([ep - made] if not ts else [ts[0] - made, ep - ts[-1]]))
        # longest stationary stretch (all reports within 40 m of the stretch's first report)
        best, k0 = 0, 0
        for k in range(len(rr)):
            while hav(rr[k0][1], rr[k0][2], rr[k][1], rr[k][2]) > 40:
                k0 += 1
            best = max(best, rr[k][0] - rr[k0][0])
        f["raw_stationary_s"] = best
        f["raw_trip_change"] = len({r[4] for r in rr}) > 1
        f["raw_route_change"] = len({r[5] for r in rr}) > 1
        f["raw_routes"] = sorted({r[5] for r in rr})
        # where was the bus at the logged arrival time?
        near = [r for r in raw.get(veh, []) if abs(r[0] - ep) <= 45]
        st = stops.get(sid)
        if near and st:
            r0 = min(near, key=lambda r: abs(r[0] - ep))
            f["raw_dist_at_arrival_m"] = round(hav(r0[1], r0[2], st["lat"], st["lon"]))
        if st and rr:
            f["raw_min_dist_m"] = round(min(hav(r[1], r[2], st["lat"], st["lon"]) for r in rr))
        # was the bus near the stop already when Passio made the prediction?
        at_made = [r for r in rr if abs(r[0] - made) <= 45]
        if at_made and st:
            r1 = min(at_made, key=lambda r: abs(r[0] - made))
            f["raw_dist_at_made_m"] = round(hav(r1[1], r1[2], st["lat"], st["lon"]))
    f["midway_variant"] = rid == "5703" and sid not in route_stops.get(rid, [])
    out.append(f)

(RK / "he_rows.json").write_text(json.dumps(out), encoding="utf-8")
print("rows", len(out), "with raw coverage", sum(f["raw"] for f in out))
print("loop time per route (min):", {k: round(v / 60, 1) for k, v in loop_s.items()})

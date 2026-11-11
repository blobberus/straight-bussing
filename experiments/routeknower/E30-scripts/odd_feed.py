#!/usr/bin/env python3
"""E30 detectors on the position feed alone (one service day of raw polls). Each returns episode dicts (run_odd.py
fills the transition window and the spot name). Rules, all measured on a bus's fresh reports (odd_lib.DayPolls):

  feed_drop_mid_route  the bus sent no fresh report for >= DROP_MIN_S while the feed stayed alive (other buses
                       reported, no pause > 2 min in the first DROP_MIN_S), its last report was moving (E29: 3 m/s or
                       150 m in 2 min) ON its labeled line (40 m), > 1.5 km from the operator's garage and > 150 m from
                       every learned linger spot (E28, a layover place). outcome: reappeared_far (its next report >=
                       400 m away: it drove on unseen), reappeared_near, not_back (no report in 3 h / the day),
                       feed_quiet_after (the whole feed went quiet before the bus came back: cut there).
  sparse_reporting     the same gap from a bus that was already reporting rarely (its last two reports > 2 min apart,
                       DC-023 item 6): it is on the map at a position minutes old most of the time. Gaps of one bus
                       less than 10 min apart merge into one episode (gaps = how many).
  frozen_gps           >= 5 reports spanning >= 5 min at identical coordinates (to 1e-6 deg) while the bus was really
                       moving: a reported speed >= 3 m/s during the run, or its next report >= 200 m away within 60 s.
  stale_position       the feed kept listing the bus with a report 90 to 300 s old (the app still shows it as current)
                       for >= 3 min.
  position_jump        consecutive reports <= 120 s apart, >= 500 m apart, faster than 35 m/s; jumps of one bus within
                       5 min merge (jumps = how many; a tablet replaying old positions after a gap scatters several).
                       outcome: spike (the bus ends within 200 m of where it was before the first jump), else
                       teleport.
  twin_buses           two buses with the same route label within 25 m of each other, both moving, for >= 3 min (a
                       convoy or one bus reported twice); or any two buses at identical coordinates at the same time.
  after_hours          the bus reported with a route label > 15 min after the end or > 30 min before the start of the
                       route's listed hours (DC-023 item 7), for >= 3 min. outcome: served (logged an arrival on that
                       route meanwhile), else not_serving.
"""
import bisect, math
from collections import defaultdict

import odd_lib as L

DROP_MIN_S = 300
LOOK_S = 3 * 3600
DROP_FAR_M = 400
GARAGE_FAR_M = 1500
LINGER_M = 150
FROZEN_N, FROZEN_S = 5, 300
FROZEN_JUMP_M, FROZEN_JUMP_S = 200, 60
STALE_MIN_S, STALE_MIN_RUN_S = L.STALE_LISTED_S, 180
JUMP_M, JUMP_MPS, JUMP_DT_S, SPIKE_BACK_M, JUMP_MERGE_S = 500, 35.0, 120, 200, 300
SPARSE_PREV_S, SPARSE_MERGE_S = 120, 600
TWIN_M, TWIN_BIN_S, TWIN_MIN_BINS = 25, 30, 6
AFTER_END_S, BEFORE_START_S, AFTER_MIN_S, AFTER_GAP_S = 900, 1800, 180, 600


def _ep(day, code, veh, rid, a, b, lat, lon, **kw):
    e = {"service_day": day, "code": code, "vehicle_id": veh, "route_id": rid, "start": int(a), "end": int(b),
         "duration_min": round((b - a) / 60, 1), "lat": round(lat, 5) if lat is not None else "",
         "lon": round(lon, 5) if lon is not None else ""}
    e.update(kw)
    return e


def feed_drops(day, polls, routes, lidx, spots, preds=None, routes_of=None, day_end=None):
    """feed_drop_mid_route episodes. preds/routes_of (optional) tell whether Passio kept a time for the bus."""
    out = []
    day_end = day_end or L.day_bounds(day)[1]
    for veh, tr in polls.tracks.items():
        for i, r in enumerate(tr):
            nxt = tr[i + 1] if i + 1 < len(tr) else None
            end = nxt[0] if nxt else min(day_end, r[0] + LOOK_S)
            if end - r[0] < DROP_MIN_S or r[1] not in routes:
                continue
            if nxt is not None and nxt[0] - r[0] > LOOK_S:
                nxt, end = None, r[0] + LOOK_S
            if not L.is_moving(tr, i) or not lidx.on(r[1], r[3], r[4]):
                continue
            if L.hav_m(r[3], r[4], *L.GARAGE) <= GARAGE_FAR_M or L.near_spot(spots, r[3], r[4], LINGER_M):
                continue
            if not polls.feed_alive(r[0], r[0] + DROP_MIN_S):
                continue
            # the feed must stay alive for the whole counted time: cut the episode where it stops
            alive_to = _alive_until(polls, r[0], end)
            if alive_to - r[0] < DROP_MIN_S:
                continue
            if nxt is None or nxt[0] > alive_to:
                outcome, far = "not_back", ""
                if nxt is not None and nxt[0] > alive_to:
                    outcome = "feed_quiet_after"
            else:
                far = round(L.hav_m(r[3], r[4], nxt[3], nxt[4]))
                outcome = "reappeared_far" if far >= DROP_FAR_M else "reappeared_near"
            stale = any(a > L.FRESH_S for h, a, _ in polls.listing.get(veh, []) if r[0] < h < alive_to)
            prev_gap = r[0] - tr[i - 1][0] if i else None
            code = "sparse_reporting" if prev_gap is not None and prev_gap > SPARSE_PREV_S else "feed_drop_mid_route"
            pv = ""
            if preds is not None:
                vis = L.T.preds_visible(preds.get(veh, []), r[0] + DROP_MIN_S, routes_of or {}, r[1])
                pv = len({p[3] for p in vis if p[4] >= r[0] + DROP_MIN_S + 120})
            out.append(_ep(day, code, veh, r[1], r[0], min(alive_to, nxt[0] if nxt else alive_to),
                           r[3], r[4], outcome=outcome, max_dist_m=far, other_route=(nxt[1] if nxt and nxt[1] != r[1] else ""),
                           stops_affected=pv, listed_stale="y" if stale else "n", speed_mps=r[5] if r[5] is not None else "",
                           prev_gap_s=prev_gap if prev_gap is not None else "", gaps=1))
    return _merge(out, "sparse_reporting", SPARSE_MERGE_S)


def _merge(eps, code, within_s):
    """Merge episodes of `code` of one bus that start within within_s of the previous one's end."""
    keep, last = [], {}
    for e in sorted(eps, key=lambda e: (e["vehicle_id"], e["start"])):
        p = last.get(e["vehicle_id"])
        if e["code"] == code and p is not None and p["code"] == code and e["start"] - p["end"] <= within_s:
            p["end"] = max(p["end"], e["end"])
            p["duration_min"] = round((p["end"] - p["start"]) / 60, 1)
            p["gaps"] = p.get("gaps", 1) + e.get("gaps", 1)
            if e.get("max_dist_m") not in ("", None):
                p["max_dist_m"] = max(e["max_dist_m"], p["max_dist_m"] if p.get("max_dist_m") not in ("", None) else 0)
            p["outcome"] = e["outcome"]
            continue
        keep.append(e)
        last[e["vehicle_id"]] = e
    return keep


def _alive_until(polls, a, b, max_gap_s=120):
    ft = polls.feed_t
    i = bisect.bisect_right(ft, a)
    prev = a
    while i < len(ft) and ft[i] <= b:
        if ft[i] - prev > max_gap_s:
            return prev
        prev = ft[i]
        i += 1
    return b if b - prev <= max_gap_s else prev


def frozen_gps(day, polls, routes):
    out = []
    for veh, tr in polls.tracks.items():
        i, n = 0, len(tr)
        while i < n:
            key = (round(tr[i][3], 6), round(tr[i][4], 6))
            j = i
            while j + 1 < n and (round(tr[j + 1][3], 6), round(tr[j + 1][4], 6)) == key and tr[j + 1][0] - tr[j][0] <= 600:
                j += 1
            span = tr[j][0] - tr[i][0]
            if j - i + 1 >= FROZEN_N and span >= FROZEN_S:
                spd = max((x[5] or 0) for x in tr[i:j + 1])
                jump = ""
                if j + 1 < n and tr[j + 1][0] - tr[j][0] <= FROZEN_JUMP_S:
                    jump = round(L.hav_m(tr[j][3], tr[j][4], tr[j + 1][3], tr[j + 1][4]))
                if spd >= L.MOVING_MPS or (jump != "" and jump >= FROZEN_JUMP_M):
                    rid = tr[i][1]
                    out.append(_ep(day, "frozen_gps", veh, rid, tr[i][0], tr[j][0],
                                   tr[i][3], tr[i][4], outcome="moving_speed" if spd >= L.MOVING_MPS else "jumped_after",
                                   max_dist_m=jump, speed_mps=round(spd, 1), reports=j - i + 1))
            i = j + 1
    return out


def stale_positions(day, polls, routes):
    out = []
    for veh, ls in polls.listing.items():
        i, n = 0, len(ls)
        while i < n:
            if not (STALE_MIN_S < ls[i][1] <= L.FRESH_S):
                i += 1
                continue
            j = i
            while j + 1 < n and STALE_MIN_S < ls[j + 1][1] <= L.FRESH_S and ls[j + 1][0] - ls[j][0] <= 120:
                j += 1
            if ls[j][0] - ls[i][0] >= STALE_MIN_RUN_S:
                rid = ls[i][2]
                tr = polls.tracks.get(veh, [])
                k = bisect.bisect_right(tr, (ls[i][0],)) - 1
                lat, lon = (tr[k][3], tr[k][4]) if k >= 0 else (None, None)
                out.append(_ep(day, "stale_position", veh, rid, ls[i][0], ls[j][0], lat, lon,
                               outcome="stale_listed", max_age_s=max(x[1] for x in ls[i:j + 1])))
            i = j + 1
    return out


def position_jumps(day, polls, routes):
    out = []
    for veh, tr in polls.tracks.items():
        jumps = []
        for i in range(len(tr) - 1):
            a, b = tr[i], tr[i + 1]
            dt = b[0] - a[0]
            if dt <= 0 or dt > JUMP_DT_S:
                continue
            d = L.hav_m(a[3], a[4], b[3], b[4])
            if d >= JUMP_M and d / dt >= JUMP_MPS:
                jumps.append((i, d, d / dt))
        k = 0
        while k < len(jumps):
            m = k
            while m + 1 < len(jumps) and tr[jumps[m + 1][0]][0] - tr[jumps[m][0] + 1][0] <= JUMP_MERGE_S:
                m += 1
            i0, i1 = jumps[k][0], jumps[m][0] + 1
            end_i = min(len(tr) - 1, i1 + 1)
            back = L.hav_m(tr[i0][3], tr[i0][4], tr[end_i][3], tr[end_i][4]) <= SPIKE_BACK_M
            a, b = tr[i0], tr[i1]
            out.append(_ep(day, "position_jump", veh, a[1], a[0], b[0], b[3], b[4],
                           outcome="spike" if back else "teleport", max_dist_m=round(max(j[1] for j in jumps[k:m + 1])),
                           speed_mps=round(max(j[2] for j in jumps[k:m + 1]), 1), jumps=m - k + 1,
                           net_m=round(L.hav_m(a[3], a[4], b[3], b[4]))))
            k = m + 1
    return out


def twin_buses(day, polls, routes):
    """Pairs of buses together: per 30-s bin each bus's first report in it; a pair counts in a bin when both have the
    same route label, both are moving and they are within TWIN_M (or at identical coordinates, any label)."""
    bins = defaultdict(dict)
    for veh, tr in polls.tracks.items():
        for i, r in enumerate(tr):
            b = r[0] // TWIN_BIN_S
            if veh not in bins[b]:
                bins[b][veh] = (r[1], r[3], r[4], L.is_moving(tr, i), r[0])
    hits = defaultdict(list)
    for b, vs in bins.items():
        ks = sorted(vs)
        for x in range(len(ks)):
            for y in range(x + 1, len(ks)):
                p, q = vs[ks[x]], vs[ks[y]]
                same = (round(p[1], 6), round(p[2], 6)) == (round(q[1], 6), round(q[2], 6)) and abs(p[4] - q[4]) <= 5
                if same or (p[0] == q[0] and p[3] and q[3] and L.hav_m(p[1], p[2], q[1], q[2]) <= TWIN_M):
                    hits[(ks[x], ks[y])].append((b, p, q, same))
    out = []
    for (va, vb), hs in hits.items():
        hs.sort()
        i = 0
        while i < len(hs):
            j = i
            while j + 1 < len(hs) and hs[j + 1][0] - hs[j][0] <= 2:
                j += 1
            ident = any(h[3] for h in hs[i:j + 1])
            if j - i + 1 >= TWIN_MIN_BINS or ident:
                p = hs[i][1]
                out.append(_ep(day, "twin_buses", va, p[0], hs[i][0] * TWIN_BIN_S, (hs[j][0] + 1) * TWIN_BIN_S, p[1], p[2],
                               other_vehicle=vb, other_route=hs[i][2][0] if hs[i][2][0] != p[0] else "",
                               outcome="identical_coordinates" if ident else "convoy"))
            i = j + 1
    return out


def after_hours(day, polls, routes, spans3, arr, preds=None, routes_of=None):
    """Stretches of a route label outside its listed hours (spans3 = offroute.spans_for: 3 days of spans)."""
    out = []
    for veh, tr in polls.tracks.items():
        run = []

        def flush():
            if run and run[-1][0] - run[0][0] >= AFTER_MIN_S:
                rid, side = run[0][1], run[0][-1]
                served = L.arrivals_in(arr, veh, run[0][0], run[-1][0] + 60, rid)
                pv = ""
                if preds is not None:
                    pv = "n"
                    for r in run[::6]:
                        if any(p[4] >= r[0] + 120 for p in L.T.preds_visible(preds.get(veh, []), r[0], routes_of or {}, rid)):
                            pv = "y"
                            break
                gap = max(x[4] for x in run)
                out.append(_ep(day, "after_hours", veh, rid, run[0][0], run[-1][0], run[-1][2], run[-1][3],
                               outcome="served" if served else "not_serving", arrivals_during=len(served),
                               pred_visible=pv, side=side, outside_min=round(gap / 60, 1)))
        for r in tr:
            rid = r[1]
            if rid not in routes:
                flush(); run = []
                continue
            side, gap = L.hours_outside(spans3.get(rid, []), r[0])
            odd = (side == "after" and gap > AFTER_END_S) or (side == "before" and gap > BEFORE_START_S)
            if odd and run and (run[-1][1] != rid or r[0] - run[-1][0] > AFTER_GAP_S):
                flush(); run = []
            if odd:
                run.append((r[0], rid, r[3], r[4], gap, side))
            elif run:
                flush(); run = []
        flush()
    return out

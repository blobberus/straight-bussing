"""Per-vehicle arrival detector for the ground-truth logger (stdlib only).

Feeds of Passio vehicle reports in, arrival events out (rows via arrivals_lib.fmt_row).
Rules: docs/DATA.md "Detection". Tests: tools/test_truth.py.
"""
import math
from collections import defaultdict, deque

from arrivals_lib import (DEPART_SPEED, HIST, MAX_GAP, MAX_SKIP, MIN_PRED_AGE, NEAR_M, RADIUS_M,
                          SAME_VISIT_S, STATE_TTL, STOP_SPEED, hav_m)


class Tracker:
    """Turns vehicle reports into arrival events. An event is emitted once its dwell is known
    (departure seen, vehicle silent > 120 s, or shutdown), so rows lag real time by the dwell."""

    def __init__(self, st):
        self.st = st
        self.v = {}                                            # (veh, trip) -> state
        self.preds = defaultdict(lambda: deque(maxlen=400))    # (veh|None, trip, stop_id) -> (made, predicted, seq)
        self.trip_seq = {}                                     # trip -> {stop_id: {stop_sequence}}
        self.last_arr = {}                                     # veh -> (stop_id, epoch, prev dict) of last arrival

    # ---- Passio predictions (tripUpdates) ----
    @staticmethod
    def _veh(veh):
        return None if veh is None or veh == "" else str(veh)

    def add_prediction(self, trip, stop_id, made, predicted, seq=None, veh=None):
        """Keyed per vehicle (trip_update.vehicle.id): buses can share a trip id (every Downtown Campus
        Connector bus runs one frequency trip), and their predictions must not overwrite each other.
        Updates without a vehicle id are kept under veh None."""
        try:
            seq = None if seq is None else int(seq)
        except (TypeError, ValueError):
            seq = None
        d = self.preds[(self._veh(veh), trip, stop_id)]
        if not d or d[-1] != (made, predicted, seq):
            d.append((made, predicted, seq))
        if seq is not None:
            self.trip_seq.setdefault(trip, {}).setdefault(stop_id, set()).add(seq)
            while len(self.trip_seq) > 3000:
                del self.trip_seq[next(iter(self.trip_seq))]

    def pred_for(self, trip, stop_id, epoch, veh=None, idx=None, loop_stop=False):
        """Most recent prediction made >= MIN_PRED_AGE s before epoch -> (pred_epoch, lead_s) | None.
        This vehicle's own predictions, else the trip's predictions that came without a vehicle id. At a
        loop stop (in the route twice) only a prediction whose stop_sequence is idx + 1 counts (or that
        has no sequence): one update predicts the terminal both as stop 1 and as stop N."""
        best = None
        d = self.preds.get((self._veh(veh), trip, stop_id)) or self.preds.get((None, trip, stop_id), ())
        for made, pred, seq in d:
            if loop_stop and seq is not None and idx is not None and seq != idx + 1:
                continue
            if made <= epoch - MIN_PRED_AGE and abs(pred - epoch) < 3600:
                best = (made, pred)
        return (best[1], epoch - best[0]) if best else None

    # ---- resume from CSV tail ----
    def seed(self, rows, now):
        for r in rows:
            try:
                ep, idx = int(r["epoch"]), int(r["stop_index"])
                if now - ep > STATE_TTL:
                    continue
                s = self._state((r["vehicle_id"], r["trip_id"]), r["route_id"], now)
                s["done"].add(idx)
                if s["prev"] is None or ep >= s["prev"]["epoch"]:
                    s["prev"] = {"idx": idx, "epoch": ep, "dwell": float(r["dwell_s"]) if r["dwell_s"] else None}
                la = self.last_arr.get(r["vehicle_id"])
                if la is None or ep >= la[1]:
                    self.last_arr[r["vehicle_id"]] = (r["stop_id"], ep, s["prev"])
            except (ValueError, KeyError):
                continue

    def _state(self, key, route, t):
        s = self.v.get(key)
        if s is None:
            s = self.v[key] = {"route": route, "done": set(), "prev": None, "last_t": t, "last_vt": None,
                               "pend": None, "pnext": None, "hist": deque(maxlen=HIST), "defer": None,
                               "handed": False}
        return s

    def _resolve(self, s, order, rep):
        """Route-stop index of the stop the vehicle is heading to. stop_id is trusted over
        current_stop_sequence (Passio's sequence does not match route order); loop terminals
        (first == last stop) are disambiguated by tripUpdates stop_sequence, then forward progress."""
        sid, q, n = rep.get("stop_id"), rep.get("q"), len(order)
        idxs = [i for i, x in enumerate(order) if x == sid] if sid else []
        if not idxs:
            return q - 1 if (not sid and q is not None and 1 <= q <= n) else None
        if len(idxs) == 1:
            return idxs[0]
        seqs = (self.trip_seq.get(rep["trip"]) or {}).get(sid)
        if seqs:
            c = [i for i in idxs if i + 1 in seqs]
            if len(c) == 1:
                return c[0]
        if s["pnext"] is not None:
            pn = s["pnext"]                          # nearest occurrence; ties go forward
            return min(idxs, key=lambda i: (abs(i - pn), i < pn))
        return idxs[-1] if any(i > 0 for i in s["done"]) else idxs[0]

    def _approach(self, s, stop, fallback):
        """Arrival time at `stop` from recent reports, best first: (1) the earliest pair of consecutive
        reports in the latest visit whose straight line passes the stop (interpolated); (2) earliest
        report of the latest run inside RADIUS_M that is nearly as close as the closest; (3) closest
        report within NEAR_M; (4) fallback. None if every remembered report is already at the stop
        (the arrival itself was never observed, e.g. at logger start or during a layover)."""
        h = list(s["hist"])
        kx = 111320.0 * math.cos(math.radians(stop["lat"]))
        xy = [((lon - stop["lon"]) * kx, (lat - stop["lat"]) * 111320.0) for lat, lon, _, _ in h]
        dist = [math.hypot(x, y) for x, y in xy]
        if dist and all(d <= RADIUS_M for d in dist):
            return None
        best, seen = None, False
        for k in range(len(h) - 2, -1, -1):
            if min(dist[k], dist[k + 1]) > NEAR_M:
                if seen:
                    break
                continue
            seen = True
            (ax, ay), (bx, by) = xy[k], xy[k + 1]
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            if L2 < 9:                               # standing still: no crossing information
                continue
            t = -(ax * dx + ay * dy) / L2           # slack: GPS noise / stopping just short of the pole
            t = min(1.0, max(0.0, t)) if -0.25 <= t <= 1.25 else None
            if t is not None and math.hypot(ax + t * dx, ay + t * dy) <= RADIUS_M:
                t0, t1, v0 = h[k][2], h[k + 1][2], h[k][3]
                # moving at v0 when last seen: it reached the stop after t*L/v0 (it may then have
                # waited until the next report); otherwise assume constant motion between reports
                best = min(t1, t0 + t * math.sqrt(L2) / v0) if v0 and v0 > STOP_SPEED else t0 + t * (t1 - t0)
        if best is not None:
            return best
        run = []                                     # latest contiguous run inside the radius
        for d, r in zip(reversed(dist), reversed(h)):
            if d <= RADIUS_M:
                run.append((d, r[2]))
            elif run:
                break
        if run:
            dmin = min(d for d, _ in run)
            return min(vt for d, vt in run if d <= dmin + 10)
        near = [(d, r[2]) for d, r in zip(dist, h) if d <= NEAR_M]
        return min(near)[1] if near else fallback

    def _stop_of(self, route, idx):
        return self.st.stops[self.st.route_stops[route][idx]]

    def _depart(self, s, lat, lon, sp, vt, out):
        """Track the pending arrival's dwell; close it once the vehicle has left (outside the radius
        or moving >= DEPART_SPEED). Dwell = arrival -> midpoint of last stopped report and the next
        report; 0 if the vehicle never stopped there."""
        p = s["pend"]
        if p is None:
            return
        a = self._stop_of(p["route"], p["idx"])
        if hav_m(lat, lon, a["lat"], a["lon"]) <= RADIUS_M and (sp is None or sp < DEPART_SPEED):
            if sp is not None and sp < STOP_SPEED:
                p["stop_vt"], p["after_vt"] = vt, None
            elif p["stop_vt"] is not None and p["after_vt"] is None:
                p["after_vt"] = vt
            return
        if p["stop_vt"] is None:
            p["dwell"] = 0
        else:
            after = p["after_vt"] or vt
            dep = (p["stop_vt"] + after) / 2 if after - p["stop_vt"] <= MAX_GAP else p["stop_vt"]
            dw = int(round(dep - p["epoch"]))
            p["dwell"] = max(0, dw) if dw < 1800 else None
        out.append(self._finish(s, p))
        s["pend"] = None

    def _transition(self, s, key, route, idx, fallback, lat, lon, sp, vt, out):
        """stop_id moved past stop idx. Passio often switches 20-50 m BEFORE the bus reaches the
        stop, so if the bus is still closing in we defer the arrival until it stops, turns away,
        or 60 s pass."""
        a = self._stop_of(route, idx)
        d = hav_m(lat, lon, a["lat"], a["lon"])
        h = s["hist"]
        pd = hav_m(h[-2][0], h[-2][1], a["lat"], a["lon"]) if len(h) >= 2 else None
        if d <= NEAR_M and pd is not None and d < pd - 2 and (sp is None or sp >= STOP_SPEED):
            s["defer"] = {"idx": idx, "until": vt + 60, "last_d": d, "fb": fallback}
            return
        self._arrive(s, key, route, idx, self._approach(s, a, fallback), "transition", out)

    def _handoff(self, s, key, lat, lon, sp, vt, out):
        """The vehicle now reports another trip id. If it is near the stop the old trip was heading
        to, that was the old trip's final arrival (loop terminal = last route index)."""
        if s["handed"] or s["pnext"] is None or (s["last_vt"] is not None and vt <= s["last_vt"]):
            return
        s["handed"] = True
        order = self.st.route_stops[s["route"]]
        idx = len(order) - 1 if s["pnext"] == 0 and order[0] == order[-1] else s["pnext"]
        a = self.st.stops[order[idx]]
        if hav_m(lat, lon, a["lat"], a["lon"]) > NEAR_M:
            return
        s["hist"].append((lat, lon, vt, sp))
        self._arrive(s, key, s["route"], idx, self._approach(s, a, None), "transition", out)

    def _check_defer(self, s, key, route, lat, lon, sp, vt, out, force=False):
        d = s["defer"]
        if not d:
            return
        if d["idx"] in s["done"]:
            s["defer"] = None
            return
        a = self._stop_of(route, d["idx"])
        dist = None if force else hav_m(lat, lon, a["lat"], a["lon"])
        if force or vt >= d["until"] or dist > d["last_d"] + 2 or (sp is not None and sp < STOP_SPEED):
            s["defer"] = None
            self._arrive(s, key, route, d["idx"], self._approach(s, a, d["fb"]), "transition", out)
        else:
            d["last_d"] = dist

    def update(self, rep, now):
        """rep: veh,trip,route,lat,lon,speed,q,stop_id,vt. -> list of finished event dicts."""
        out = []
        key, route = (rep["veh"], rep["trip"]), rep["route"]
        order = self.st.route_stops.get(route)
        if not order or rep["lat"] is None or not rep["trip"]:
            return out
        vt = rep["vt"] or now
        if abs(now - vt) > 90:                       # stale report from a parked/offline vehicle
            return out
        new = key not in self.v
        s = self._state(key, route, now)
        if s["last_vt"] is not None and vt <= s["last_vt"]:
            return out                               # repeated report
        lat, lon = rep["lat"], rep["lon"]
        older = sorted((s2["last_t"], k2) for k2, s2 in self.v.items() if k2[0] == key[0] and k2 != key)
        for _, k2 in older:                          # trip id changed (normally at the terminal)
            s2 = self.v[k2]
            self._check_defer(s2, k2, s2["route"], lat, lon, None, vt, out, force=True)
            self._handoff(s2, k2, lat, lon, rep["speed"], vt, out)
            self._depart(s2, lat, lon, rep["speed"], vt, out)
        if new and older:                            # keep the approach history across the trip change
            s["hist"].extend(x for x in self.v[older[-1][1]]["hist"] if x[2] < vt)
        s["last_t"] = now
        nxt = self._resolve(s, order, rep)
        sp = rep["speed"]
        if sp is None and s["hist"] and vt > s["hist"][-1][2]:
            h = s["hist"][-1]
            sp = hav_m(lat, lon, h[0], h[1]) / (vt - h[2])
        s["hist"].append((lat, lon, vt, sp))
        self._depart(s, lat, lon, sp, vt, out)

        pn, n = s["pnext"], len(order)
        if pn is not None and nxt is not None and nxt != pn:
            skip = max(MAX_SKIP, (n - 1) // 2)       # night service often skips unrequested stops
            fwd = pn < nxt <= pn + skip
            ring = n - 1 if order[0] == order[-1] and n > 2 else 0      # loop: index n-1 == index 0
            fw, bw = ((nxt - pn) % ring, (pn - nxt) % ring) if ring else (0, 0)
            lap = bool(ring) and nxt < pn and 0 < fw <= skip and fw < bw
            if fwd or lap:                           # left stop pn (stops in between were skipped)
                self._check_defer(s, key, route, lat, lon, sp, vt, out, force=True)
                gap_ok = s["last_vt"] is not None and vt - s["last_vt"] <= MAX_GAP
                fb = (s["last_vt"] + vt) / 2 if gap_ok else None
                if lap:
                    self._arrive(s, key, route, pn, self._approach(s, self._stop_of(route, pn), fb), "transition", out)
                else:
                    self._transition(s, key, route, pn, fb, lat, lon, sp, vt, out)
            if lap:                                  # same trip id starts another lap
                if s["pend"] is not None:
                    out.append(self._finish(s, s["pend"]))
                    s["pend"] = None
                s["done"], s["prev"], s["defer"] = set(), None, None
        if nxt is not None and sp is not None and sp < STOP_SPEED:      # proximity + stopped
            for i in sorted({max(0, nxt - 1), nxt, min(n - 1, nxt + 1)}):
                a = self.st.stops.get(order[i])
                if i not in s["done"] and a and hav_m(lat, lon, a["lat"], a["lon"]) <= RADIUS_M:
                    self._arrive(s, key, route, i, self._approach(s, a, vt), "proximity", out)
                    break
        self._check_defer(s, key, route, lat, lon, sp, vt, out)
        s["last_vt"] = vt
        if nxt is not None:
            s["pnext"] = nxt
        return out

    def _arrive(self, s, key, route, idx, epoch, source, out):
        """Record an arrival at route index idx (epoch None = visit whose arrival was not observed:
        it only blocks duplicates and links the next segment)."""
        if idx in s["done"]:
            return
        s["done"].add(idx)
        sid = self.st.route_stops[route][idx]
        la = self.last_arr.get(key[0])
        ref = epoch if epoch is not None else (s["hist"][-1][2] if s["hist"] else la[1] if la else 0)
        if la and la[0] == sid and 0 <= ref - la[1] < (SAME_VISIT_S if epoch is not None else STATE_TTL):
            if s["prev"] is None:                    # same physical visit (trip id flipped at terminal):
                s["prev"] = {"idx": idx, "epoch": la[1], "dwell": None, "visit": la[2]}   # link, no row
            return
        if epoch is None:
            return
        epoch = int(epoch)
        if s["pend"] is not None:                    # previous stop never saw a departure
            out.append(self._finish(s, s["pend"]))
            s["pend"] = None
        pv = s["prev"]
        prev = pv if pv and pv["idx"] < idx and 0 < epoch - pv["epoch"] <= STATE_TTL else None
        a, sv, av = self.st.stops[sid], None, None
        for lat, lon, t, v in s["hist"]:             # already stopped there since arriving?
            if t >= epoch and v is not None and v < STOP_SPEED and hav_m(lat, lon, a["lat"], a["lon"]) <= RADIUS_M:
                sv, av = t, None
            elif sv is not None and av is None:
                av = t
        loop_stop = self.st.route_stops[route].count(sid) > 1
        s["pend"] = {"epoch": epoch, "route": route, "trip": key[1], "veh": key[0], "idx": idx, "source": source,
                     "prev": prev, "dwell": None,
                     "pred": self.pred_for(key[1], sid, epoch, veh=key[0], idx=idx, loop_stop=loop_stop),
                     "stop_vt": sv, "after_vt": av}
        s["prev"] = {"idx": idx, "epoch": epoch, "dwell": None}
        self.last_arr[key[0]] = (sid, epoch, s["prev"])

    @staticmethod
    def _finish(s, e):
        if s["prev"] and s["prev"]["idx"] == e["idx"] and s["prev"]["epoch"] == e["epoch"]:
            s["prev"]["dwell"] = e["dwell"]
        return e

    def drain(self, now, final=False):
        """Close pending rows of vehicles silent >120 s (all at shutdown) and expire old state."""
        out = []
        for key, s in list(self.v.items()):
            if s["defer"] and (final or now - s["last_t"] > 120):
                self._check_defer(s, key, s["route"], None, None, None, now, out, force=True)
            if s["pend"] is not None and (final or now - s["last_t"] > 120):
                out.append(self._finish(s, s["pend"]))
                s["pend"] = None
            if s["pend"] is None and now - s["last_t"] > STATE_TTL:
                del self.v[key]
        for k in [k for k, d in self.preds.items() if d and d[-1][0] < now - 2 * STATE_TTL]:
            del self.preds[k]
        return out

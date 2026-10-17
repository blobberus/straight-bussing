"""Per-vehicle arrival detector for the ground-truth logger (stdlib only).

Feeds of Passio vehicle reports in, arrival events out (rows via arrivals_lib.fmt_row).
Rules: docs/DATA.md "Detection". Tests: tools/test_truth.py.
"""
import math
from collections import defaultdict, deque

from arrivals_lib import (DEPART_SPEED, FROZEN_S, GPS_HIST, GPS_HOLD_S, GPS_SKIP, GPS_WRONG_ROUTE, HIST, MAX_GAP,
                          MAX_LINK_S, MAX_SKIP, MAX_SPEED, MIN_PRED_AGE, NEAR_M, PASS_MIN_MOVE_M, PRED_LEADS, PREV_VISIT_GAP_S,
                          RADIUS_M, SAME_VISIT_S, SHOW_GRACE_S, SHOWN_PAST_S, STATE_TTL, STOP_SPEED, WRONG_MIN_OFF,
                          WRONG_MIN_RUN, WRONG_MIN_SPAN_S, hav_m)


class Tracker:
    """Turns vehicle reports into arrival events. An event is emitted once its dwell is known
    (departure seen, vehicle silent > 120 s, or shutdown), so rows lag real time by the dwell."""

    def __init__(self, st):
        self.st = st
        self.v = {}                                            # (veh, trip) -> state
        self.preds = defaultdict(lambda: deque(maxlen=400))    # key -> (made, predicted, seq, seen, last seen)
        self.bus_keys = defaultdict(set)                       # veh -> {(trip, stop_id)} it has predictions under
        self._logged = {}                                      # key -> last 'last seen' written to the pred log
        self.trip_seq = {}                                     # trip -> {stop_id: {stop_sequence}}
        self.last_arr = {}                                     # veh -> (stop_id, epoch, prev dict) of last arrival
        self.visits = {}                                       # (veh, stop_id) -> (epoch, trip, idx) of its last arrival there
        self.on_pred = None                                    # callback(veh, trip, stop_id, made, predicted, seq)
        self.gps = {}                                          # veh -> GPS sweep state (DC-003, _sweep)
        self.logged = defaultdict(lambda: deque(maxlen=8))     # (veh, stop_id) -> epochs of every row logged there
        self.rule_log = defaultdict(lambda: deque(maxlen=40))  # veh -> (epoch, route, idx) of its recent rows (any source)
        self._at_stop = None                                   # stop_id -> [(route, idx)], built on first use
        self.wrong_route = GPS_WRONG_ROUTE                     # the sweep may follow another route than Passio's

    # ---- Passio predictions (tripUpdates) ----
    @staticmethod
    def _veh(veh):
        return None if veh is None or veh == "" else str(veh)

    def add_prediction(self, trip, stop_id, made, predicted, seq=None, veh=None, seen=None, last=None):
        """Keyed per vehicle (trip_update.vehicle.id): buses can share a trip id (every Downtown Campus
        Connector bus runs one frequency trip), and their predictions must not overwrite each other.
        Updates without a vehicle id are kept under veh None. seen = the poll that first showed this update
        (Passio sometimes changes the predicted time and keeps the old timestamp: 57 of 651 updates on
        2026-10-12), so 'on display L before the arrival' is judged by max(made, seen), never by made alone.
        last = the latest poll still showing it: a prediction Passio stopped publishing was not on display."""
        try:
            seq = None if seq is None else int(seq)
        except (TypeError, ValueError):
            seq = None
        seen = made if seen is None else max(made, seen)
        last = seen if last is None else max(last, seen)
        key = (self._veh(veh), trip, stop_id)
        d = self.preds[key]
        if d and d[-1][:3] == (made, predicted, seq):    # the same update shown again: it is still on display
            if last > d[-1][4]:
                d[-1] = d[-1][:4] + (last,)
                if self.on_pred is not None and last - self._logged.get(key, last) >= 60:
                    self._logged[key] = last             # about once a minute while it stays up (next run's seed)
                    self.on_pred(key[0], trip, stop_id, made, predicted, seq, d[-1][3], last)
            return
        d.append((made, predicted, seq, seen, last))
        if key[0] is not None:
            self.bus_keys[key[0]].add((trip, stop_id))
        if self.on_pred is not None:                     # the run's prediction log (truth_logger --pred-log)
            self._logged[key] = last
            self.on_pred(key[0], trip, stop_id, made, predicted, seq, seen, last)
        if seq is not None:
            self.trip_seq.setdefault(trip, {}).setdefault(stop_id, set()).add(seq)
            while len(self.trip_seq) > 3000:
                del self.trip_seq[next(iter(self.trip_seq))]

    def _candidates(self, trip, stop_id, epoch, veh=None, idx=None, loop_stop=False):
        """Predictions that can be about THIS arrival, oldest first: (made, predicted).
        This vehicle's own predictions, else the trip's predictions that came without a vehicle id. At a
        loop stop (in the route twice) only a prediction whose stop_sequence is idx + 1 counts (or that
        has no sequence): one update predicts the terminal both as stop 1 and as stop N. A prediction of a time
        before, or within PREV_VISIT_GAP_S after, the bus's previous visit to this stop was about that earlier
        visit (a rider reading it saw the bus come then) and is skipped, whatever trip id the previous visit had:
        Passio rolls a bus over to its next trip id early and lists the current lap's times under it (DC-011,
        2026-10-16: on 2026-10-15 such rows paired a lap's time with the lap after on Drexel, Midway Metra,
        Apostolic/Drexel). When the previous visit was on the SAME trip id (loops that keep one trip id for two
        laps, the Downtown Campus Connector's frequency trip; E19 cause A3), a prediction MADE before that visit is
        skipped too. Neither applies when the stop_sequence names this visit at another index (the loop terminal:
        one update predicts both ends). A prediction made before a previous visit under another trip id still
        counts if it predicts a later time: on a 15-min loop a real 30-min-ahead prediction for the next run is
        made before the bus passes the stop on this one."""
        d = self.preds.get((self._veh(veh), trip, stop_id))
        if not d and self._only_bus(trip, veh, epoch):    # updates without a vehicle id: only if no other bus has
            d = self.preds.get((None, trip, stop_id), ())  # this trip id (shared trip ids, E01 B1)
        pv = self.visits.get((self._veh(veh), stop_id))
        if pv is not None and not 0 < epoch - pv[0] <= 2 * STATE_TTL:
            pv = None
        for made, pred, seq, seen, last in d or ():
            if loop_stop and seq is not None and idx is not None and seq != idx + 1:
                continue
            if abs(pred - epoch) >= 3600:
                continue
            if pv is not None and (pred < pv[0] + PREV_VISIT_GAP_S or (pv[1] == trip and made <= pv[0])):
                if not (seq is not None and idx is not None and seq == idx + 1 and pv[2] != idx):
                    continue
            yield made, pred, seen, last

    def _only_bus(self, trip, veh, epoch):
        """No other vehicle reported on this trip id within 10 min of epoch."""
        me = self._veh(veh)
        return not any(k[1] == trip and self._veh(k[0]) != me and abs(s.get("last_t", 0) - epoch) <= 600
                       for k, s in self.v.items())

    def pred_for(self, trip, stop_id, epoch, veh=None, idx=None, loop_stop=False):
        """Most recent prediction made >= MIN_PRED_AGE s before epoch -> (pred_epoch, lead_s) | None
        (the arrivals.csv passio_pred_* columns)."""
        best = None
        for made, pred, seen, last in self._candidates(trip, stop_id, epoch, veh, idx, loop_stop):
            if seen <= epoch - MIN_PRED_AGE:
                best = (made, pred)
        return (best[1], epoch - best[0]) if best else None

    def preds_at(self, trip, stop_id, epoch, veh=None, idx=None, loop_stop=False, leads=PRED_LEADS):
        """For each target lead L, the prediction on display L s before epoch: the newest one made and first seen
        by then, if a poll still showed it within SHOW_GRACE_S of that moment -> {L: (pred_epoch, made, seen)}
        (predictions.csv). No row for L = no prediction on display then (none yet, or Passio had withdrawn it).
        A lead shorter than one this trip id filled may instead take the bus's prediction under the trip id
        Passio re-matched it to meanwhile (_other_trip_preds)."""
        newest = {}
        for made, pred, seen, last in self._candidates(trip, stop_id, epoch, veh, idx, loop_stop):
            for lt in leads:
                if seen <= epoch - lt:
                    newest[lt] = (pred, made, seen, last)
        out = {lt: v[:3] for lt, v in newest.items() if v[3] >= epoch - lt - SHOW_GRACE_S}
        gaps = [lt for lt in leads if out and lt < max(out) and lt not in out]
        if gaps and not loop_stop:
            out.update(self._other_trip_preds(trip, stop_id, epoch, veh, gaps))
        return out

    @staticmethod
    def _shown(d, t, seq=False):
        """The update of one (veh, trip, stop) on display at t: the newest first seen by t, if a poll still showed
        it within SHOW_GRACE_S of t (entries are in the order first seen) -> entry | None. seq: only entries with
        this stop_sequence (a loop terminal is in one trip update twice, as stop 1 and stop N)."""
        for x in reversed(d or ()):
            if x[3] <= t and (seq is False or x[2] == seq):
                return x if x[4] >= t - SHOW_GRACE_S else None
        return None

    def _other_trip_preds(self, trip, stop_id, epoch, veh, leads):
        """Passio re-matches a running bus to other timetable trips and back: its trip update moves between two or
        three trip ids within minutes while vehiclePositions keeps one (Central, Apostolic/Drexel; on 2026-10-13
        86 of the 144 arrivals with a 20-min but no 10-min row). A screen lists the stop's time from every trip
        update with the bus's number, whatever the trip id. preds_at asks only for leads shorter than one the own
        trip id filled: the stop was still ahead of the bus then, so this arrival was its next visit. Such a lead
        takes the earliest time THIS bus (same vehicle id: never another bus, never an update without one) showed
        for the stop under another trip id, by the same display rule and no more than SHOWN_PAST_S past (a screen
        drops it then), within 3600 s of the arrival, from a trip update that is about the run the bus was on:
        - its first stop (stop_sequence 1) is not on display (else it is a trip that has not started: the bus's
          next trip, shown a lap ahead or rolled over early, so its time for this stop is the next lap's),
        - no later stop of it (higher stop_sequence) is predicted earlier (else Passio has the bus past the stop),
        - first seen after the bus's previous visit to the stop, predicting PREV_VISIT_GAP_S or more past it.
        Not at loop stops (in the route twice). -> {L: (pred_epoch, made, seen)} for the leads it fills."""
        me = self._veh(veh)
        keys = self.bus_keys.get(me) if me is not None else None
        trips = sorted({tr2 for tr2, s2 in keys if s2 == stop_id and tr2 != trip}) if keys else ()
        if not trips:
            return {}
        pv = self.visits.get((me, stop_id))
        if pv is not None and not 0 < epoch - pv[0] <= 2 * STATE_TTL:
            pv = None
        out = {}
        for lt in leads:
            t = epoch - lt
            for tr2 in trips:
                x = self._shown(self.preds.get((me, tr2, stop_id)), t)
                if x is None or x[2] is None or x[1] < t - SHOWN_PAST_S or abs(x[1] - epoch) >= 3600:
                    continue
                made, pred, seq, seen, last = x
                if pv is not None and (seen <= pv[0] or pred < pv[0] + PREV_VISIT_GAP_S):
                    continue
                if (lt not in out or pred < out[lt][0]) and self._mid_run(me, tr2, t, seq, pred):
                    out[lt] = (pred, made, seen)
        return out

    def _mid_run(self, veh, trip, t, seq, pred):
        """The bus's trip update `trip`, as shown at t, is about the run it is on, seen from a stop with
        stop_sequence seq predicted at pred: its first stop is not on display and no later stop predicted earlier."""
        for tr3, s2 in self.bus_keys.get(veh, ()):
            if tr3 != trip:
                continue
            d = self.preds.get((veh, trip, s2))
            for q in {e[2] for e in d or ()}:
                y = self._shown(d, t, q)
                if y is not None and q is not None and (q == 1 or (q > seq and y[1] < pred)):
                    return False
        return True

    # ---- resume from CSV tail ----
    def seed(self, rows, now):
        """Resume from the shared CSV's tail. GPS-sweep rows (DC-003) only feed the sweep's duplicate check: the
        Passio-driven rules start from their own rows, so the sweep never changes what they log."""
        for r in rows:
            try:
                ep, idx = int(r["epoch"]), int(r["stop_index"])
                if now - ep > STATE_TTL:
                    continue
                self.rule_log[self._veh(r["vehicle_id"])].append((ep, r["route_id"], idx))
                if r.get("source") == "gps":
                    self.logged[(self._veh(r["vehicle_id"]), r["stop_id"])].append(ep)
                    continue
                s = self._state((r["vehicle_id"], r["trip_id"]), r["route_id"], now)
                s["done"].add(idx)                   # blocks duplicates up to STATE_TTL, links only recent rows
                if (s["prev"] is None or ep >= s["prev"]["epoch"]) and now - ep <= MAX_LINK_S:
                    s["prev"] = {"idx": idx, "epoch": ep, "dwell": float(r["dwell_s"]) if r["dwell_s"] else None}
                la = self.last_arr.get(r["vehicle_id"])
                if la is None or ep >= la[1]:
                    self.last_arr[r["vehicle_id"]] = (r["stop_id"], ep, s["prev"])
                vk = (self._veh(r["vehicle_id"]), r["stop_id"])
                if ep > self.visits.get(vk, (0,))[0]:
                    self.visits[vk] = (ep, r["trip_id"], idx)
                self.logged[vk].append(ep)
            except (ValueError, KeyError):
                continue

    def _state(self, key, route, t):
        s = self.v.get(key)
        if s is None:
            s = self.v[key] = {"route": route, "done": set(), "prev": None, "last_t": t, "last_vt": None,
                               "pend": None, "pnext": None, "hist": deque(maxlen=HIST), "defer": None,
                               "handed": False, "pn_pass": None, "skipped": set(), "floor": None, "vnamed": None}
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

    def _close(self, sid_a, sid_b):
        """Two stops within RADIUS_M of each other (GPS cannot tell which one the bus stands at)."""
        a, b = self.st.stops.get(sid_a), self.st.stops.get(sid_b)
        return bool(a and b) and hav_m(a["lat"], a["lon"], b["lat"], b["lon"]) <= RADIUS_M

    def _heading(self, route, j):
        """Direction the route runs at stop index j (from the stop before to the stop after), as (east, north)
        metres, or None. A bus driving the other way past the stop (it serves the far side of the street)
        does not count as passing it."""
        order = self.st.route_stops[route]
        n = len(order)
        ring = order[0] == order[-1] and n > 2
        i0 = j - 1 if j > 0 else (n - 2 if ring else j)
        i1 = j + 1 if j < n - 1 else (1 if ring else j)
        a, b = self.st.stops.get(order[i0]), self.st.stops.get(order[i1])
        if not a or not b:
            return None
        kx = 111320.0 * math.cos(math.radians(a["lat"]))
        v = ((b["lon"] - a["lon"]) * kx, (b["lat"] - a["lat"]) * 111320.0)
        return v if math.hypot(*v) >= 5 else None

    def _passes(self, s, key, route, out):
        """The GPS track went past a stop of the route (the latest two reports' line comes within RADIUS_M of
        it, moving the route's direction) that Passio's stop_id did not name: Passio jumps over stops it is
        not asked to serve, renames the trip mid-lap, or names a stop the bus never goes to (2026-10-12 raw
        tracks: South logged 48% of the stops its buses drove past, Red Line/Arts Block 57%, Central 76%; one
        Red Line step in five skipped a stop). Eligible: the stops Passio jumped over (or that lie between the
        last stop logged and a renamed trip's first named stop) and the stops after the named one, within the
        forward skip window; they get a 'pass' row at the time of closest approach. The named stop itself only
        keeps that time, as the fallback for a transition Passio reports too late to time from the recent
        reports. Runs after the named stop is updated, so a stop whose transition is still deferred (Passio
        switched early) never gets one."""
        pn, h = s["pnext"], s["hist"]
        if pn is None or len(h) < 2 or s["last_vt"] is None:
            return
        (la0, lo0, t0, _), (la1, lo1, t1, _) = h[-2], h[-1]
        if not 0 < t1 - t0 <= MAX_GAP:
            return
        kx = 111320.0 * math.cos(math.radians(la0))
        mv = ((lo1 - lo0) * kx, (la1 - la0) * 111320.0)
        L2 = mv[0] * mv[0] + mv[1] * mv[1]
        if L2 < PASS_MIN_MOVE_M ** 2:
            return
        order = self.st.route_stops[route]
        n = len(order)
        vonly = getattr(self.st, "variant_only", {}).get(route, ())
        top = max(s["done"]) if s["done"] else -1
        s["skipped"] = {j for j in s["skipped"] if j > top}     # behind the latest logged stop: never passed
        for j in sorted(s["skipped"] | set(range(pn, min(n - 1, pn + max(MAX_SKIP, (n - 1) // 2)) + 1))):
            if j in s["done"] or j in vonly:         # a variant's own stop: only when Passio names it
                continue
            a = self.st.stops.get(order[j])
            if not a:
                continue
            ax, ay = (lo0 - a["lon"]) * kx, (la0 - a["lat"]) * 111320.0
            f = max(0.0, min(1.0, -(ax * mv[0] + ay * mv[1]) / L2))
            if math.hypot(ax + f * mv[0], ay + f * mv[1]) > RADIUS_M:
                continue
            hd = self._heading(route, j)
            if hd is not None and hd[0] * mv[0] + hd[1] * mv[1] <= 0:
                continue
            when = t0 + f * (t1 - t0)
            pv = self.visits.get((self._veh(key[0]), order[j]))
            if j != pn and pv is not None and abs(when - pv[0]) < 300:
                s["done"].add(j)                     # logged a moment ago under the bus's other trip id
                continue
            if j == pn:
                if s["pn_pass"] is None or s["pn_pass"][0] != pn:
                    s["pn_pass"] = (pn, when)
            else:
                self._arrive(s, key, route, j, when, "pass", out)

    @staticmethod
    def _spans(s, stop):
        """True if `stop` lies between the last two reports (inside the ellipse with them as foci,
        widened by 2 x RADIUS_M), so the midpoint of their times can stand in for the arrival. False when
        Passio's stop_id moved on while the bus was nowhere near the stop (it switched late, or over a
        stop the bus does not serve): then the visit gets no row rather than a time it was elsewhere."""
        if len(s["hist"]) < 2:
            return False
        (la0, lo0, _, _), (la1, lo1, _, _) = s["hist"][-2], s["hist"][-1]
        return (hav_m(la0, lo0, stop["lat"], stop["lon"]) + hav_m(la1, lo1, stop["lat"], stop["lon"])
                <= hav_m(la0, lo0, la1, lo1) + 2 * RADIUS_M)

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
        when = self._approach(s, a, fallback)
        if when is None and d > NEAR_M:
            # Passio moved on while the bus was still far from the stop (or long past it, unseen): no time to
            # log, but a GPS pass still can (Red Line: Passio often switches 150+ m before the stop)
            s["skipped"].add(idx)
            return
        self._arrive(s, key, route, idx, when, "transition", out)

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
        if (not new and older and self.v[older[-1][1]]["last_t"] > s["last_t"]
                and s["last_vt"] is not None and vt - s["last_vt"] > MAX_GAP):
            # back on a trip id this bus left more than MAX_GAP ago (Passio flaps between ids, E01 B3):
            # its next stop, approach reports, done stops and prev link belong to an earlier stretch of
            # driving. Start it afresh, like a new state. (A flap of a poll or two keeps the state.)
            s.update(prev=None, pnext=None, defer=None, done=set(), handed=False, pn_pass=None, skipped=set(),
                     floor=None)
            s["hist"].clear()
        if (new or not s["hist"]) and older:         # keep the approach history across the trip change
            s["hist"].extend(x for x in self.v[older[-1][1]]["hist"] if x[2] < vt)
        if new and older:                            # Passio renamed the trip mid-lap (Red Line: up to twice a lap):
            o = self.v[older[-1][1]]                 # the stops between the last one logged and the new trip's
            if o["route"] == route and o["done"]:    # first named stop are still ahead of the bus
                s["floor"] = max(o["done"]) + 1
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
            if fwd and nxt > pn + 1:                 # stops Passio jumped over: a GPS pass still counts
                s["skipped"].update(range(pn + 1, nxt))
            if fwd or lap:                           # left stop pn (stops in between were skipped)
                self._check_defer(s, key, route, lat, lon, sp, vt, out, force=True)
                gap_ok = s["last_vt"] is not None and vt - s["last_vt"] <= MAX_GAP
                fb = (s["last_vt"] + vt) / 2 if gap_ok and self._spans(s, self._stop_of(route, pn)) else None
                if fb is None and s["pn_pass"] is not None and s["pn_pass"][0] == pn and vt - s["pn_pass"][1] <= MAX_LINK_S:
                    fb = s["pn_pass"][1]                 # it drove past pn earlier; Passio switched late
                if lap:
                    self._arrive(s, key, route, pn, self._approach(s, self._stop_of(route, pn), fb), "transition", out)
                else:
                    self._transition(s, key, route, pn, fb, lat, lon, sp, vt, out)
            if lap:                                  # same trip id starts another lap
                if s["pend"] is not None:
                    out.append(self._finish(s, s["pend"]))
                    s["pend"] = None
                s["done"], s["prev"], s["defer"], s["skipped"] = set(), None, None, set()
        vonly = getattr(self.st, "variant_only", {}).get(route, ())
        if nxt in vonly:                             # Passio names a stop only the route's other pattern serves:
            s["vnamed"] = (nxt, vt)                  # this bus runs that pattern now
        vn = s["vnamed"] if s["vnamed"] and vt - s["vnamed"][1] <= SAME_VISIT_S else None
        if nxt is not None and sp is not None and sp < STOP_SPEED:      # proximity + stopped
            for i in sorted({max(0, nxt - 1), nxt, min(n - 1, nxt + 1)}):
                if i in vonly and i != nxt:          # 57th St. & Metra NB and SB are 27 m apart: the one Passio names
                    continue
                if vn and i != vn[0] and self._close(order[i], order[vn[0]]):
                    continue                         # standing at the variant's stop, not at its 27 m neighbour
                a = self.st.stops.get(order[i])
                if i not in s["done"] and a and hav_m(lat, lon, a["lat"], a["lon"]) <= RADIUS_M:
                    self._arrive(s, key, route, i, self._approach(s, a, vt), "proximity", out)
                    break
        self._check_defer(s, key, route, lat, lon, sp, vt, out)
        if nxt is not None:
            if s["floor"] is not None and s["floor"] < nxt <= s["floor"] + max(MAX_SKIP, (n - 1) // 2):
                s["skipped"].update(range(s["floor"], nxt))
            s["floor"] = None
            s["pnext"] = nxt
        self._passes(s, key, route, out)
        s["last_vt"] = vt
        self._sweep(rep, vt, lat, lon, sp)
        return out

    # ---- GPS sweep (DC-003, RouteKnower E21): stops the track drove past that no Passio-driven rule logged ----
    # Passio's feed can freeze a bus's trip and "next stop" for an hour while it drives (Red Line, Downtown Campus
    # Connector), jump over the end of a loop, lag behind the bus, or file it under another route. The rules above
    # follow Passio's stop and miss those visits. The sweep follows the GPS alone, per bus: every stop of the bus's
    # route whose RADIUS_M circle the track touched while moving in the route's direction, in route order with the
    # visit before it (or confirmed by the one after it), timed like _approach. It waits GPS_HOLD_S and writes a row
    # (source 'gps') only if nothing else logged that bus at that stop within SAME_VISIT_S and the visit fits between
    # the rules' own rows around it (route order, speed), so it only adds rows, never
    # changes one. The route is Passio's, unless the track clearly follows another route (_wrong_route). trip_id is
    # Passio's trip when its assignment was live, blank when it was frozen or another route; no Passio prediction is
    # attached to these rows (Passio showed them under the frozen or wrong trip).

    def _stops_at(self):
        if self._at_stop is None:
            self._at_stop = defaultdict(list)
            for route, order in self.st.route_stops.items():
                for j, sid in enumerate(order):
                    self._at_stop[sid].append((route, j))
        return self._at_stop

    def _hits(self, la0, lo0, la1, lo1):
        """Stops whose RADIUS_M circle the segment enters (or crosses), moving with a route's direction there:
        [(stop_id, {(route, idx)})] (only the route indexes whose direction fits). A segment that starts inside the
        circle is the bus leaving: never a hit (a bus already standing there when logging began has no arrival)."""
        kx = 111320.0 * math.cos(math.radians(la0))
        mv = ((lo1 - lo0) * kx, (la1 - la0) * 111320.0)
        L2 = mv[0] * mv[0] + mv[1] * mv[1]
        if L2 < PASS_MIN_MOVE_M ** 2:
            return []
        pad = 0.001                                   # ~110 m: the radius plus slack
        lat_lo, lat_hi = min(la0, la1) - pad, max(la0, la1) + pad
        lon_lo, lon_hi = min(lo0, lo1) - 1.4 * pad, max(lo0, lo1) + 1.4 * pad
        out = []
        for sid, places in self._stops_at().items():
            a = self.st.stops.get(sid)
            if not a or not (lat_lo <= a["lat"] <= lat_hi and lon_lo <= a["lon"] <= lon_hi):
                continue
            ax, ay = (lo0 - a["lon"]) * kx, (la0 - a["lat"]) * 111320.0
            if math.hypot(ax, ay) <= RADIUS_M:
                continue                              # already at the stop: leaving it (its arrival came before)
            f = max(0.0, min(1.0, -(ax * mv[0] + ay * mv[1]) / L2))
            if math.hypot(ax + f * mv[0], ay + f * mv[1]) > RADIUS_M:
                continue
            fits = set()
            for route, j in places:
                hd = self._heading(route, j)
                if hd is None or hd[0] * mv[0] + hd[1] * mv[1] > 0:
                    fits.add((route, j))
            if fits:
                out.append((sid, fits))
        return out

    def _ahead(self, route, a, b):
        """Stops from index a forward to index b on the route (wrapping on a loop), or None if b is not 1 to GPS_SKIP
        stops ahead of a."""
        order = self.st.route_stops[route]
        n = len(order)
        ring = n - 1 if order[0] == order[-1] and n > 2 else 0
        d = (b - a) % ring if ring else b - a
        return d if 1 <= d <= GPS_SKIP else None

    def _chain(self, route, hits):
        """Longest run at the end of hits (time order) that follows the route: each hit fits the route's direction at
        an index 1 to GPS_SKIP stops after the previous one. -> list of (hit, idx)."""
        run = []
        for h in reversed(hits):
            idxs = [j for r, j in h[2] if r == route]
            if not idxs:
                break
            if not run:
                run.append((h, idxs[0]))
                continue
            nxt = run[-1][1]
            j = next((j for j in idxs if self._ahead(route, j, nxt)), None)
            if j is None:
                break
            run.append((h, j))
        return run[::-1]

    def _wrong_route(self, g, proute):
        """The track follows exactly one other route clearly better than Passio's: at least WRONG_MIN_RUN recent
        visits in that route's order over WRONG_MIN_SPAN_S or more, WRONG_MIN_OFF of them at stops Passio's route
        does not have, and Passio's route explaining at most one of those visits. Used only with self.wrong_route
        (GPS_WRONG_ROUTE, off: no real episode was corroborated yet). -> (route, chain) or None (none, or two routes tie: a shared
        corridor stays Passio's)."""
        recent = [h for h in g["chain"] if g["chain"][-1][0] - h[0] <= MAX_LINK_S * 2]
        if len(recent) < WRONG_MIN_RUN:
            return None
        mine = set(self.st.route_stops.get(proute, ()))
        found = []
        for route in {r for r, _ in recent[-1][2]} - {proute}:
            run = self._chain(route, recent)
            if (len(run) < WRONG_MIN_RUN or run[-1][0][0] - run[0][0][0] < WRONG_MIN_SPAN_S
                    or sum(1 for (h, _) in run if h[1] not in mine) < WRONG_MIN_OFF):
                continue
            if proute and len(self._chain(proute, [h for h, _ in run])) > 1:
                continue
            found.append((len(run), route, run))
        if not found:
            return None
        found.sort(key=lambda x: -x[0])
        if len(found) > 1 and found[1][0] == found[0][0]:
            return None
        return found[0][1], found[0][2]

    def _sweep(self, rep, vt, lat, lon, sp):
        veh = self._veh(rep["veh"])
        if veh is None:
            return
        g = self.gps.get(veh)
        if g is None:
            g = self.gps[veh] = {"hist": deque(maxlen=GPS_HIST), "named": None, "hit": {}, "chain": deque(maxlen=12),
                                 "anchor": {}, "cand": [], "override": None, "last_vt": None}
        if g["last_vt"] is not None and vt <= g["last_vt"]:
            return
        named = (rep.get("trip"), rep.get("stop_id"))
        if g["named"] is None or g["named"][:2] != named:
            g["named"] = (named[0], named[1], vt)
        frozen = vt - g["named"][2] >= FROZEN_S
        prev = g["hist"][-1] if g["hist"] else None
        g["hist"].append((lat, lon, vt, sp))
        g["last_vt"] = vt
        proute = rep.get("route") if rep.get("route") in self.st.route_stops else None
        ov = g["override"]
        if ov and (ov["passio"] != proute or vt - ov["last"] > MAX_LINK_S):
            g["override"] = ov = None
        if prev is None or not 0 < vt - prev[2] <= MAX_GAP:
            return
        for sid, fits in self._hits(prev[0], prev[1], lat, lon):
            last = g["hit"].get(sid)
            if last is not None and vt - last < SAME_VISIT_S:
                continue                              # the same visit (approach, dwell, departure)
            g["hit"][sid] = vt
            when = self._approach({"hist": g["hist"]}, self.st.stops[sid], None)
            if when is None:
                continue                              # it never arrived in the reports kept (parked all along)
            h = (when, sid, fits)
            g["chain"].append(h)
            if ov is None and proute and self.wrong_route:
                w = self._wrong_route(g, proute)
                if w:
                    ov = g["override"] = {"route": w[0], "passio": proute, "last": vt}
                    g["anchor"].pop(w[0], None)
                    for (hh, j) in w[1]:              # the visits that showed it are this route's too
                        self._candidate(g, veh, w[0], j, hh[0], hh[1], "", True)
                    continue
            elif ov is not None:
                if len(self._chain(proute, list(g["chain"])[-3:])) >= 2:
                    g["override"] = ov = None         # the track fits Passio's route again
                elif any(r == ov["route"] for r, _ in fits):
                    ov["last"] = vt
            route = ov["route"] if ov else proute
            if route is None:
                continue
            idxs = [j for r, j in fits if r == route]
            if not idxs:
                continue
            trip = "" if ov or frozen else (rep.get("trip") or "")
            anc = g["anchor"].get(route)
            j = None
            recent = anc is not None and 0 < when - anc[1] <= MAX_LINK_S
            if recent:
                ok = [(self._ahead(route, anc[0], i), -i, i) for i in idxs if self._ahead(route, anc[0], i)]
                j = min(ok)[2] if ok else None
            if j is not None and anc[2] is not None and anc[2]["start"]:
                anc[2]["ok"] = True                   # the visit before it, which started a chain, is confirmed
            self._candidate(g, veh, route, j if j is not None else idxs[0], when, sid, trip, j is not None,
                            start=j is not None or not recent)

    def _candidate(self, g, veh, route, idx, when, sid, trip, ok, start=True):
        """start: the visit may be confirmed by the next one (it follows the bus's previous visit on the route, or
        there was none recently); a visit out of order with a recent one may not (the bus is not following the
        route's order there)."""
        c = {"epoch": int(when), "route": route, "trip": trip, "veh": veh, "idx": idx, "sid": sid, "ok": ok,
             "start": start}
        g["cand"].append(c)
        g["anchor"][route] = (idx, when, c)

    def _logged_near(self, veh, sid, epoch):
        """Any row of this bus at this stop within SAME_VISIT_S: the same visit (a bus circling a terminal block
        during its layover re-enters the stop's circle minutes after it was logged; no loop here is shorter)."""
        return any(abs(e - epoch) <= SAME_VISIT_S for e in self.logged.get((veh, sid), ()))

    def _fits_rules(self, veh, c):
        """A GPS visit fits between the bus's rows around it on the same route (the rules' and the GPS rows it
        already wrote): the latest one before it (within MAX_LINK_S) is behind it in route order (within half the
        route) and reachable at a plausible speed, and the first one after it (within GPS_HOLD_S) is ahead of it. A
        geometric coincidence (a route passing the same corner twice) or a maneuver near a terminal does not fit."""
        route, j, ep = c["route"], c["idx"], c["epoch"]
        order = self.st.route_stops[route]
        n = len(order)
        ring = n - 1 if order[0] == order[-1] and n > 2 else 0
        half = max(GPS_SKIP, (n - 1) // 2)
        fwd = (lambda a, b: (b - a) % ring) if ring else (lambda a, b: b - a)
        log = [x for x in self.rule_log.get(veh, ()) if x[1] == route]
        before = [x for x in log if 0 < ep - x[0] <= MAX_LINK_S]
        if before:
            b = max(before)
            if not 1 <= fwd(b[2], j) <= half:
                return False
            d, _ = self.st.dist_between(route, b[2], j) if b[2] < j else (None, None)
            if d and d / max(1, ep - b[0]) > MAX_SPEED:
                return False
        after = [x for x in log if 0 < x[0] - ep <= GPS_HOLD_S]
        if after and not 1 <= fwd(j, min(after)[2]) <= half:
            return False
        return True

    def _sweep_flush(self, now, final=False):
        """Held GPS visits old enough (GPS_HOLD_S; MAX_LINK_S for one still waiting for its confirmation) -> rows,
        unless any rule logged that bus at that stop within SAME_VISIT_S, or the visit does not fit between the
        rules' rows around it (_fits_rules). At shutdown (final) the younger ones are dropped,
        not forced out: the collector's runs overlap by about 30 min, so the next run sees those visits with the
        context they need, and a run's last minutes never get a half-observed row."""
        out = []
        for veh, g in list(self.gps.items()):
            keep = []
            for c in g["cand"]:
                age = now - c["epoch"]
                if age < GPS_HOLD_S or (not c["ok"] and age < MAX_LINK_S):
                    if not final:
                        keep.append(c)
                    continue
                if not c["ok"] or self._logged_near(veh, c["sid"], c["epoch"]) or not self._fits_rules(veh, c):
                    continue
                self.logged[(veh, c["sid"])].append(c["epoch"])
                self.rule_log[veh].append((c["epoch"], c["route"], c["idx"]))
                out.append({"epoch": c["epoch"], "route": c["route"], "trip": c["trip"], "veh": veh, "idx": c["idx"],
                            "source": "gps", "prev": None, "dwell": None, "pred": None, "preds": {}})
            g["cand"] = keep
            if not keep and g["last_vt"] is not None and now - g["last_vt"] > STATE_TTL:
                del self.gps[veh]
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
            # same physical visit as the bus's last arrival (trip id flipped at the terminal or flapped): no
            # row, but the next segment starts here unless this trip already has a later arrival
            if s["prev"] is None or la[1] > s["prev"]["epoch"]:
                s["prev"] = {"idx": idx, "epoch": la[1], "dwell": None, "visit": la[2]}
            return
        if epoch is None:
            return
        epoch = int(epoch)
        if s["pend"] is not None:                    # previous stop never saw a departure
            out.append(self._finish(s, s["pend"]))
            s["pend"] = None
        pv = s["prev"]
        # link to pv only if it is earlier on the route, at most MAX_LINK_S ago, and the bus logged no later
        # arrival under another trip id in between (Passio flapped the id; E01 B3: such links jump over it)
        ok = pv and pv["idx"] < idx and 0 < epoch - pv["epoch"] <= MAX_LINK_S and not (la and la[1] > pv["epoch"])
        prev = pv if ok else None
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
                     "preds": self.preds_at(key[1], sid, epoch, veh=key[0], idx=idx, loop_stop=loop_stop),
                     "stop_vt": sv, "after_vt": av}
        vk = (self._veh(key[0]), sid)
        if epoch > self.visits.get(vk, (0,))[0]:      # after the lookups: they need the previous visit
            self.visits[vk] = (epoch, key[1], idx)
        self.logged[vk].append(epoch)
        self.rule_log[self._veh(key[0])].append((epoch, route, idx))
        if pv is None or epoch >= pv["epoch"]:       # (a deferred arrival logged after a later one is not
            s["prev"] = {"idx": idx, "epoch": epoch, "dwell": None}   # what the next stop follows)
        if la is None or epoch >= la[1]:             # the bus's latest arrival by time, as in seed()
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
            bk = self.bus_keys.get(k[0])
            if bk is not None:
                bk.discard(k[1:])
                if not bk:
                    del self.bus_keys[k[0]]
        for k in [k for k, t in self.visits.items() if t[0] < now - 2 * STATE_TTL]:
            del self.visits[k]
        out += self._sweep_flush(now, final)
        return out

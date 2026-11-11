#!/usr/bin/env python3
"""E30 detectors: the timetable against what the feed shows (owner item 7: "the timetable says a bus leaves or joins
but none does, or the reverse"), at the line's service start and end and at its timetable steps.

A line's OBSERVED bus count at minute u = buses that sent a fresh report under its label in [u - 10 min, u] (the
collector's drop rule, tools/bus_changes.py: Passio leaves buses out of the feed for up to 10 min).

  timetable_drop_missed  a timetable step down (buses per hour x -> y < x) at clock hour H with the line running >= x
                    buses in the 45 min before, still >= x from 15 to 45 min after, and no lasting leave of the line
                    within 45 min of H: the timetable loses a bus, none leaves.
  timetable_add_missed  a step up (x -> y > x): the line never reaches y buses in the 45 min after H and no non-layover
                    add within 30 min before to 45 min after: the timetable adds a bus, none joins. duration = minutes
                    until it reached y (at most 120).
  unscheduled_leave  a lasting leave the timetable does not have (E29 timetable_change = 0) that leaves the line below its
                    timetable 15 min later, with no other bus joining within 15 min. duration = minutes until the line
                    is back at its timetable count (at most 120).
  extra_bus_added   a non-layover add the timetable does not have that puts the line above its timetable. duration =
                    minutes it stayed above (at most 120).
  service_start_late / service_start_missing  the first bus under the line's label in a listed span comes > 15 min after
                    the span starts / none in the first 60 min (a bus already on the line 45 min before counts as on
                    time).
  service_end_early  the line's last bus leaves the feed > 15 min before the listed span ends (spans ending before
                    01:00); duration = the minutes without a bus.
  night_feed_silent  the same for spans that end after 01:00 (NightRide listed to 04:29): Passio lists no bus after about
                    midnight (known since 2026-10-10, project notes "Empty live feed during scheduled service"); kept
                    apart so it does not swamp the other codes.
"""
import bisect
from collections import defaultdict

import odd_lib as L

STEP_BEFORE_S, STEP_AFTER_S, STEP_SETTLE_S = 2700, 2700, 900
ADD_BEFORE_S = 1800
CAP_S = 7200
START_LATE_S, START_LOOK_S, START_EARLY_OK_S = 900, 3600, 2700
END_EARLY_S = 900
NIGHT_END_H = 1          # a span ending after this clock hour (past midnight) is a night span
SILENT_S = 600


class BusCount:
    """Observed buses per line over the day (see the module docstring)."""

    def __init__(self, polls, routes):
        self.times = defaultdict(dict)          # rid -> veh -> sorted report times
        for veh, tr in polls.tracks.items():
            for r in tr:
                if r[1] in routes:
                    self.times[r[1]].setdefault(veh, []).append(r[0])

    def at(self, rid, u):
        n = 0
        for ts in self.times.get(rid, {}).values():
            i = bisect.bisect_right(ts, u)
            if i and ts[i - 1] >= u - SILENT_S:
                n += 1
        return n

    def series(self, rid, a, b, step=60):
        return [(u, self.at(rid, u)) for u in range(int(a), int(b) + 1, step)]

    def first(self, rid, a, b):
        best = None
        for ts in self.times.get(rid, {}).values():
            i = bisect.bisect_left(ts, a)
            if i < len(ts) and ts[i] <= b and (best is None or ts[i] < best):
                best = ts[i]
        return best

    def last(self, rid, a, b):
        best = None
        for ts in self.times.get(rid, {}).values():
            i = bisect.bisect_right(ts, b)
            if i and ts[i - 1] >= a and (best is None or ts[i - 1] > best):
                best = ts[i - 1]
        return best


def _ep(day, code, rid, a, b, **kw):
    e = {"service_day": day, "code": code, "vehicle_id": kw.pop("vehicle_id", ""), "route_id": rid, "start": int(a),
         "end": int(b), "duration_min": round((b - a) / 60, 1), "lat": kw.pop("lat", ""), "lon": kw.pop("lon", "")}
    e.update(kw)
    return e


def step_mismatches(day, steps, bc, trans_rows):
    out = []
    lasting = [r for r in trans_rows if r["kind"] == "leave" and r["label"] in L.LASTING]
    adds = [r for r in trans_rows if r["kind"] == "add" and r["label"] != "layover_swap"]
    for rid, t, x, y in steps:
        before = bc.series(rid, t - STEP_BEFORE_S, t)
        after = bc.series(rid, t, t + STEP_AFTER_S)
        if not before or max(n for _, n in before) == 0:
            continue                                   # the line was not running: start / end codes cover it
        if y < x:
            settled = [n for u, n in after if u >= t + STEP_SETTLE_S]
            had = max(n for _, n in before) >= x
            left = any(r["route_id"] == rid and abs(int(r["epoch"]) - t) <= STEP_BEFORE_S for r in lasting)
            if had and settled and min(settled) >= x and not left:
                out.append(_ep(day, "timetable_drop_missed", rid, t, t + STEP_AFTER_S, outcome=f"{x}->{y} kept {min(settled)}",
                               expected=y, observed=min(settled)))
        else:
            reached = next((u for u, n in bc.series(rid, t, t + CAP_S) if n >= y), None)
            joined = any(r["route_id"] == rid and t - ADD_BEFORE_S <= int(r["epoch"]) <= t + STEP_AFTER_S for r in adds)
            if (reached is None or reached > t + STEP_AFTER_S) and not joined:
                end = reached if reached is not None else t + CAP_S
                out.append(_ep(day, "timetable_add_missed", rid, t, end, outcome=f"{x}->{y} observed {max(n for _, n in after)}",
                               expected=y, observed=max(n for _, n in after)))
    return out


def unscheduled(day, trans_rows, bc, service):
    out = []
    for r in trans_rows:
        if r["label"] == "layover_swap" or str(r["timetable_change"]) != "0":
            continue
        rid, t, veh = r["route_id"], int(r["epoch"]), r["vehicle_id"]
        if r["kind"] == "leave" and r["label"] in L.LASTING:
            sb = L.sched_buses(service, rid, t + 900)
            if sb is None or bc.at(rid, t + 900) >= sb:
                continue
            rm = r.get("replacement_min")
            if rm not in ("", None) and 0 <= float(rm) <= 15:
                continue
            back = next((u for u, n in bc.series(rid, t + 900, t + CAP_S, 120)
                         if n >= (L.sched_buses(service, rid, u) or 0)), None)
            end = back if back is not None else t + CAP_S
            out.append(_ep(day, "unscheduled_leave", rid, t, end, vehicle_id=veh, lat=r["spot_lat"], lon=r["spot_lon"],
                           outcome=r["label"], expected=sb, observed=bc.at(rid, t + 900), event_ref=r["event_id"],
                           spot_name=r["spot"]))
        elif r["kind"] == "add":
            sb = L.sched_buses(service, rid, t)
            if sb is None or int(r["buses_after"] or 0) <= sb:
                continue
            down = next((u for u, n in bc.series(rid, t + 300, t + CAP_S, 120)
                         if n <= (L.sched_buses(service, rid, u) or 0)), None)
            end = down if down is not None else t + CAP_S
            out.append(_ep(day, "extra_bus_added", rid, t, end, vehicle_id=veh, lat=r["spot_lat"], lon=r["spot_lon"],
                           outcome=r["label"], expected=sb, observed=int(r["buses_after"]), event_ref=r["event_id"],
                           spot_name=r["spot"]))
    return out


def start_end(day, spans, bc):
    out = []
    for rid, sp in spans.items():
        for a, b in sp:
            early = bc.first(rid, a - START_EARLY_OK_S, b)
            if early is None or early > a + START_LOOK_S:
                end = b if early is None else early
                out.append(_ep(day, "service_start_missing", rid, a, end, expected=1, observed=0,
                               outcome="no bus in the span" if early is None else f"first bus {L.ct(early, '%H:%M')}"))
            elif early > a + START_LATE_S:
                out.append(_ep(day, "service_start_late", rid, a, early, outcome=f"first bus {L.ct(early, '%H:%M')}"))
            if early is None:
                continue
            last = bc.last(rid, a, b + END_EARLY_S)
            if last is None or last >= b - END_EARLY_S:
                continue
            night = L.datetime.fromtimestamp(b, L.CT).hour >= NIGHT_END_H and L.datetime.fromtimestamp(b, L.CT).hour < 6
            out.append(_ep(day, "night_feed_silent" if night else "service_end_early", rid, last, b,
                           outcome=f"last bus {L.ct(last, '%H:%M')}, listed to {L.ct(b, '%H:%M')}"))
    return out

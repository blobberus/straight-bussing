#!/usr/bin/env python3
"""E29 (2026-11-06): what buses do at TRANSITION time, when a line's bus count changes. Owner: "Create a detailed log
of bus behavior during transition time in order to find which buses and where they tend to go on break (or add
themselves). Create a sheet log of this behavior and detail which buses go off the map or route and where (same for
if a bus gets added)."

Events are tools/bus_changes.py's confirmed changes (the collector's own rule, rebuilt from each day's merged raw polls
with bus_changes.day_changes and the day's timetable, classified with the data branch's arrivals.csv):
  leave  a bus silent on its route for 10 min while another bus of the route still reports (timed to its last report)
  add    a new bus on a running route for 5 min (at least 3 reports)
For every event the bus's own track (every fresh report it sent, under any route label, at most 300 s older than the
poll), its logged arrivals on any route, Passio's prediction updates for it and the route's line say where it left
(or joined) the route, where it went (or came from), for how long, and whether Passio kept predicting it.

LABEL, leave (first match):
  layover_swap   back on the same route within 30 min (bus_changes `lasting` = 0; Passio leaves buses out of the feed
                 between trips, DC-020)
  route_switch   its next logged arrival is on another route, within 60 min of leaving
  feed_drop      the bus sent no report at all while away, its last report was moving (>= 3 m/s) on the route's line and
                 not near the garage: it vanished from the feed mid-route (it may have kept driving unseen)
  break          it served riders again (any route) 30 min to 3 h later
  shift_end      no logged arrival on any route in the 3 h after
  unknown        the arrivals log does not reach 30 min past the event (end of the data)
LABEL, add (first match):
  layover_swap      the same bus left this route in the 30 min before (`returning` = 1)
  added_from_route  its last logged arrival in the 60 min before was on another route
  added_from_break  it served riders (any route) 30 min to 3 h before and paused since
  added_from_garage its first report of the service day, or a report within GARAGE_M of the garage in the 60 min before
  unknown           none of these (e.g. a bus relabeled from a route it never served)

Writes into --out (data/labeled/transitions/): transitions.csv (one row per event), transition_spots.csv (named leave
and add spots with counts and typical times per line), transition_summary.csv (per line and clock hour), and a JSON of
the numbers (--json). Columns and caveats: data/labeled/transitions/README.md. Read-only on every input.

  python experiments/routeknower/E29-scripts/transitions.py --dl <E28 fetch.py folder> --out data/labeled/transitions
      [--days 2026-11-05 ...] [--cache e29-events.pkl] [--json e29.json]
"""
import argparse, bisect, csv, gzip, io, json, math, pickle, sys, tempfile, zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "tools"))
sys.path.insert(0, str(HERE.parent / "E27-scripts"))
sys.path.insert(0, str(HERE.parent / "E28-scripts"))
import arrivals_lib as L      # noqa: E402
import bus_changes as BC      # noqa: E402
import offroute as O          # noqa: E402

FRESH_S = 300            # a report at most this much older than its poll (core/operating.js rule 1)
LOOK_S = 3 * 3600        # where it went / came from: looked for this far
SWITCH_S = 3600          # next arrival on another route within this = a route switch
BREAK_MIN_S = 1800       # a pause this long before serving again = a break
GARAGE = O_GARAGE = (41.8206, -87.6416)
GARAGE_M = 700
LINE_M = 40              # on its line: within this of the route's drawn shape
NAME_M = 160             # a spot takes the name of the nearest stop within this
SPOT_M = 150             # events within this of a spot's centre belong to it (transition_spots.csv)
DWELL_M, DWELL_S = 80, 180   # a parked stretch: within 80 m for 3 min (E28's still rule)
MOVING_MPS = 3.0
PRED_SEEN_S = 90         # a prediction stays visible this long after the logger last saw it (E28)
FUTURE_S = 120
COLUMNS = ["event_id", "service_day", "dow", "local_time", "hour", "epoch", "route_id", "route", "kind", "label",
           "vehicle_id", "buses_before", "buses_after", "sched_buses_hour", "sched_buses_next_hour", "timetable_change",
           "trip_id", "spot", "spot_lat", "spot_lon", "spot_stop_m", "line_m", "last_stop", "last_stop_time",
           "where", "where_lat", "where_lon", "where_route", "away_min", "came_back", "back_route", "back_stop",
           "back_time", "reports_while_away", "moving_at_event", "passio_pred_at_leave", "passio_pred_after_min",
           "phantom_stops", "replacement_vehicle", "replacement_min", "replacement_spot", "lasting", "returned_min",
           "moved_to_route", "evidence"]
DOW = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
NAMES = {}


def hav_m(a_lat, a_lon, b_lat, b_lon):
    kx = O.R * math.radians(1) * math.cos(math.radians((a_lat + b_lat) / 2))
    return math.hypot((a_lon - b_lon) * kx, (a_lat - b_lat) * O.R * math.radians(1))


def ct(t, fmt="%Y-%m-%d %H:%M"):
    return datetime.fromtimestamp(t, O.CT).strftime(fmt)


def day_bounds(day):
    d = date.fromisoformat(day)
    a = datetime(d.year, d.month, d.day, 4, tzinfo=O.CT)
    b = datetime(d.year, d.month, d.day, tzinfo=O.CT) + timedelta(days=1)
    return int(a.timestamp()), int(b.replace(hour=4).timestamp())


def clock_min(t):
    """Minutes since midnight of the SERVICE day (00:30 after midnight = 1470)."""
    dt = datetime.fromtimestamp(t, O.CT)
    m = dt.hour * 60 + dt.minute + dt.second / 60
    return m + 1440 if dt.hour < 4 else m


def hhmm(m):
    m = int(round(m))
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


# ---------------------------------------------------------------- inputs
def load_tracks(dl, days_needed):
    """Every fresh report of every bus (any route label), deduped (veh, report time) -> {veh: sorted list of
    (vt, rid, trip, lat, lon, speed, stop)}."""
    by, seen = defaultdict(list), set()
    for day in days_needed:
        p = Path(dl) / f"raw-polls-{day}.jsonl.gz"
        if not p.exists():
            continue
        with gzip.open(p, "rt", encoding="utf-8") as f:
            for ln in f:
                try:
                    poll = json.loads(ln)
                except ValueError:
                    continue
                h = int(poll.get("h") or poll.get("t") or 0)
                for v in poll.get("v") or []:
                    try:
                        veh, trip, rid, lat, lon = str(v[0]), str(v[1]), str(v[2]), float(v[3]), float(v[4])
                        spd = float(v[6]) if v[6] is not None else None
                        vt = int(v[10] or 0)
                    except (ValueError, TypeError, IndexError):
                        continue
                    if not vt or (veh, vt) in seen or h - vt > FRESH_S:
                        continue
                    seen.add((veh, vt))
                    by[veh].append((vt, rid, trip, lat, lon, spd, "" if v[8] is None else str(v[8])))
    for v in by.values():
        v.sort()
    return by


def load_arrivals(path):
    """Per vehicle: sorted (epoch, route_id, stop_id, stop_name, lat, lon)."""
    by = defaultdict(list)
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                by[str(r["vehicle_id"])].append((int(r["epoch"]), str(r["route_id"]), str(r["stop_id"]), r["stop_name"],
                                                 float(r["stop_lat"] or 0), float(r["stop_lon"] or 0)))
            except (ValueError, KeyError):
                continue
    for v in by.values():
        v.sort()
    return by


def load_preds(dl, days_needed):
    """Per vehicle: sorted (seen, last, trip, stop, pred) from the logged prediction updates."""
    by = defaultdict(list)
    for day in days_needed:
        p = Path(dl) / f"pred-updates-{day}.jsonl.gz"
        if not p.exists():
            continue
        with gzip.open(p, "rt", encoding="utf-8") as f:
            for ln in f:
                try:
                    x = json.loads(ln)
                    veh, trip, stop, pred = str(x[0]), str(x[1]), str(x[2]), int(x[4])
                    seen = int(x[6]) if len(x) > 6 else int(x[3])
                    last = int(x[7]) if len(x) > 7 else seen
                except (ValueError, TypeError, IndexError):
                    continue
                by[veh].append((seen, last, trip, stop, pred))
    for v in by.values():
        v.sort()
    return by


def trip_routes(zpath):
    """trip_id -> route_id from the day's GTFS zip."""
    out = {}
    if not zpath:
        return out
    with zipfile.ZipFile(zpath) as z:
        with z.open("trips.txt") as f:
            for r in csv.DictReader(io.TextIOWrapper(f, "utf-8-sig")):
                out[str(r["trip_id"])] = str(r["route_id"])
    return out


# ---------------------------------------------------------------- helpers on one bus
def reports_between(track, a, b):
    i = bisect.bisect_left(track, (a,))
    j = bisect.bisect_right(track, (b, "￿"))
    return track[i:j]


def arrivals_between(arr, veh, a, b):
    lst = arr.get(str(veh), [])
    i = bisect.bisect_left(lst, (a,))
    j = bisect.bisect_right(lst, (b, "￿"))
    return lst[i:j]


def longest_dwell(reps):
    """The longest stretch within DWELL_M of its first report lasting DWELL_S: (minutes, lat, lon) or None."""
    best, i, n = None, 0, len(reps)
    while i < n:
        j = i
        while j + 1 < n and reps[j + 1][0] - reps[j][0] <= 600 and hav_m(reps[i][3], reps[i][4], reps[j + 1][3], reps[j + 1][4]) <= DWELL_M:
            j += 1
        dur = reps[j][0] - reps[i][0]
        if dur >= DWELL_S and (best is None or dur > best[0] * 60):
            seg = reps[i:j + 1]
            best = (dur / 60, float(np.mean([r[3] for r in seg])), float(np.mean([r[4] for r in seg])))
        i = j + 1 if j > i else i + 1
    return best


class Namer:
    """Names a point: the operator's garage, else the nearest stop within NAME_M, else the nearest map label within
    250 m ('near X'), else the nearest stop within 600 m ('N m from X'), else its coordinates."""

    def __init__(self, stops, landmarks):
        self.stops = [(s["lat"], s["lon"], s["name"], sid) for sid, s in stops.items() if s.get("lat")]
        self.marks = landmarks

    def stop(self, lat, lon):
        return min(((hav_m(lat, lon, a, b), n, sid) for a, b, n, sid in self.stops), default=(1e9, "", ""))

    def __call__(self, lat, lon):
        if lat is None:
            return "", 1e9
        if hav_m(lat, lon, *GARAGE) <= GARAGE_M:
            return "Operator garage", hav_m(lat, lon, *GARAGE)
        d, n, _ = self.stop(lat, lon)
        if d <= NAME_M:
            return n, d
        dm, nm = min(((hav_m(lat, lon, a, b), x) for x, a, b in self.marks), default=(1e9, ""))
        if dm <= 250:
            return f"near {nm}", dm
        if d <= 600:
            return f"{round(d, -1):.0f} m from {n}", d
        return f"Unnamed ({lat:.4f}, {lon:.4f})", d


def line_dist(st, rid, lat, lon):
    segs = st["segs"].get(rid)
    if segs is None or lat is None:
        return float("inf")
    return float(O.dist_to_segs(O.xy([lat], [lon]), segs)[0])


def preds_visible(pl, t, routes_of, rid=None):
    """Prediction entries of one bus visible at t (seen <= t <= last + PRED_SEEN_S, predicted time >= t - 60), on route
    rid's trips when given."""
    out = []
    i = bisect.bisect_right(pl, (t, math.inf))
    for k in range(max(0, i - 3000), i):
        seen, last, trip, stop, pred = pl[k]
        if last + PRED_SEEN_S >= t and pred >= t - 60 and (rid is None or routes_of.get(trip, rid) == rid):
            out.append(pl[k])
    return out


# ---------------------------------------------------------------- events of one day
def leave_details(ev, st, tracks, arr, preds, routes_of, namer, adds_by_route):
    veh, rid, t = ev["vehicle_id"], ev["route_id"], int(ev["epoch"])
    tr = tracks.get(veh, [])
    before = [r for r in reports_between(tr, t - 1800, t) if r[1] == rid]
    # the last report on the route and the last one on its line (the leave point)
    last = before[-1] if before else None
    on_line = [r for r in reversed(before) if line_dist(st, rid, r[3], r[4]) <= LINE_M]
    lp = on_line[0] if on_line else last
    spot, sm = namer(lp[3], lp[4]) if lp else ("", 1e9)
    moving = None
    if last is not None:
        prev = [r for r in before if r[0] >= last[0] - 120]
        moving = (last[5] is not None and last[5] >= MOVING_MPS) or (len(prev) > 1 and hav_m(prev[0][3], prev[0][4], last[3], last[4]) >= 150)
    # away period: until its next logged arrival on any route (within LOOK_S)
    nxt = arrivals_between(arr, veh, t + 60, t + LOOK_S)
    back = nxt[0] if nxt else None
    end = back[0] if back else t + LOOK_S
    away = reports_between(tr, t + 30, end)
    gar = next((r for r in away if hav_m(r[3], r[4], *GARAGE) <= GARAGE_M), None)
    dw = longest_dwell(away)
    other_labels = Counter(r[1] for r in away if r[1] != rid)
    if gar is not None:
        where, wl = "Operator garage", (gar[3], gar[4])
    elif dw and dw[0] >= 10:
        nm, _ = namer(dw[1], dw[2])
        where, wl = f"parked at {nm} ({dw[0]:.0f} min)", (dw[1], dw[2])
    elif not away:
        where, wl = "out of the feed", (None, None)
    else:
        nm, _ = namer(away[-1][3], away[-1][4])
        where, wl = f"drove off (last seen near {nm})", (away[-1][3], away[-1][4])
    # Passio while it was leaving
    pl = preds.get(veh, [])
    vis = preds_visible(pl, t, routes_of, rid)
    at_leave = any(p[4] >= t + FUTURE_S for p in vis)
    later = [min(p[1] + PRED_SEEN_S, p[4]) for p in pl[bisect.bisect_left(pl, (t - 7200,)):]
             if routes_of.get(p[2], rid) == rid and p[0] <= t + 3600 and p[1] + PRED_SEEN_S > t and p[4] > t]
    after_min = None
    if later:
        end_t = max(later)
        if back is not None and back[1] == rid:
            end_t = min(end_t, back[0])
        after_min = (end_t - t) / 60
    served = {a[2] for a in arrivals_between(arr, veh, t - 60, t + 2700) if a[1] == rid}
    phantom = {p[3] for p in vis if t < p[4] <= t + 2700 and p[3] not in served}
    # replacement: another bus added on the route within 30 min either side
    rep = min((a for a in adds_by_route.get(rid, []) if a[1] != veh and abs(a[0] - t) <= 1800),
              key=lambda a: abs(a[0] - t), default=None)
    lasting = str(ev.get("lasting", ""))
    ln = line_dist(st, rid, lp[3], lp[4]) if lp else float("inf")
    d = {"spot": spot, "spot_lat": round(lp[3], 5) if lp else "", "spot_lon": round(lp[4], 5) if lp else "",
         "spot_stop_m": round(namer.stop(lp[3], lp[4])[0]) if lp else "", "line_m": round(ln) if math.isfinite(ln) else "",
         "last_stop": ev.get("last_stop_name", ""), "last_stop_time": "",
         "where": where, "where_lat": round(wl[0], 5) if wl[0] is not None else "",
         "where_lon": round(wl[1], 5) if wl[1] is not None else "",
         "where_route": " / ".join(NAMES.get(r, r) for r, _ in other_labels.most_common(2)),
         "away_min": round((back[0] - t) / 60, 1) if back else "", "came_back": "y" if back else "n",
         "back_route": NAMES.get(back[1], back[1]) if back else "", "back_stop": back[3] if back else "",
         "back_time": ct(back[0]) if back else "", "reports_while_away": len(away),
         "moving_at_event": "" if moving is None else ("y" if moving else "n"),
         "passio_pred_at_leave": "y" if at_leave else "n",
         "passio_pred_after_min": "" if after_min is None else round(max(0.0, after_min), 1),
         "phantom_stops": len(phantom) if lasting == "1" else 0,
         "replacement_vehicle": rep[1] if rep else "", "replacement_min": round((rep[0] - t) / 60, 1) if rep else "",
         "replacement_spot": rep[2] if rep else ""}
    la = [a for a in arrivals_between(arr, veh, t - 3600, t + 60) if a[1] == rid]
    if la:
        d["last_stop"], d["last_stop_time"] = la[-1][3], ct(la[-1][0])
    # label
    ev_txt = [f"left {NAMES.get(rid, rid)} at {spot or 'an unknown spot'} {ct(t, '%H:%M')}"]
    gar_far = lp is None or hav_m(lp[3], lp[4], *GARAGE) > 1500
    if lasting == "0":
        lab = "layover_swap"
        ev_txt.append(f"back on the route after {ev.get('returned_min', '?')} min (a layover out of the feed)" if not len(away)
                      else f"back on the route after {ev.get('returned_min', '?')} min")
    elif lasting == "":
        lab = "unknown"
        ev_txt.append("the arrivals log ends before 30 min after")
    elif back is not None and back[1] != rid and back[0] - t <= SWITCH_S:
        lab = "route_switch"
        ev_txt.append(f"served {NAMES.get(back[1], back[1])} from {back[3]} {(back[0] - t) / 60:.0f} min later")
    elif not away and moving and ln <= 150 and gar_far:
        lab = "feed_drop"
        ev_txt.append("vanished from the feed while moving on its line" +
                      (f"; next arrival {(back[0] - t) / 60:.0f} min later on {NAMES.get(back[1], back[1])}" if back else "; not seen serving again in 3 h"))
    elif back is not None:
        lab = "break"
        ev_txt.append(f"{where}; served {NAMES.get(back[1], back[1])} again at {back[3]} after {(back[0] - t) / 60:.0f} min")
    else:
        lab = "shift_end"
        ev_txt.append(f"{where}; no arrival on any route in the 3 h after")
    ev_txt.append("Passio still predicted it" + (f" for {d['passio_pred_after_min']} min" if d["passio_pred_after_min"] != "" else "")
                  + (f", {d['phantom_stops']} stop(s) never served" if d["phantom_stops"] else "") if at_leave else "no Passio prediction ahead when it left")
    if rep:
        ev_txt.append(f"bus {rep[1]} added {abs(rep[0] - t) / 60:.0f} min {'after' if rep[0] >= t else 'before'} at {rep[2]}")
    if str(ev.get("expected")) == "1":
        ev_txt.append("the timetable also loses a bus here")
    return lab, d, "; ".join(ev_txt)


def add_details(ev, st, tracks, arr, namer, day_start):
    veh, rid, t = ev["vehicle_id"], ev["route_id"], int(ev["epoch"])
    tr = tracks.get(veh, [])
    first = next((r for r in reports_between(tr, t - 5, t + 600) if r[1] == rid), None)
    spot, sm = namer(first[3], first[4]) if first else ("", 1e9)
    prior = reports_between(tr, t - LOOK_S, t - 1)
    prior_day = [r for r in prior if r[0] >= day_start]
    pa = arrivals_between(arr, veh, t - LOOK_S, t - 1)
    last_arr = pa[-1] if pa else None
    gar = next((r for r in reversed(prior) if r[0] >= t - 3600 and hav_m(r[3], r[4], *GARAGE) <= GARAGE_M), None)
    pause = [r for r in prior if not last_arr or r[0] > last_arr[0]]
    dw = longest_dwell(pause)
    label_before = next((r[1] for r in reversed(prior) if r[1] != rid), "")
    if gar is not None:
        where, wl = "Operator garage", (gar[3], gar[4])
    elif dw and dw[0] >= 10:
        nm, _ = namer(dw[1], dw[2])
        where, wl = f"parked at {nm} ({dw[0]:.0f} min)", (dw[1], dw[2])
    elif not prior_day:
        where, wl = "first report of the day", (None, None)
    elif last_arr is not None:
        where, wl = f"from {NAMES.get(last_arr[1], last_arr[1])} at {last_arr[3]}", (last_arr[4], last_arr[5])
    else:
        nm, _ = namer(prior[-1][3], prior[-1][4])
        where, wl = f"near {nm}", (prior[-1][3], prior[-1][4])
    ln = line_dist(st, rid, first[3], first[4]) if first else float("inf")
    d = {"spot": spot, "spot_lat": round(first[3], 5) if first else "", "spot_lon": round(first[4], 5) if first else "",
         "spot_stop_m": round(namer.stop(first[3], first[4])[0]) if first else "",
         "line_m": round(ln) if math.isfinite(ln) else "",
         "last_stop": last_arr[3] if last_arr else "", "last_stop_time": ct(last_arr[0]) if last_arr else "",
         "where": where, "where_lat": round(wl[0], 5) if wl[0] is not None else "",
         "where_lon": round(wl[1], 5) if wl[1] is not None else "",
         "where_route": NAMES.get(last_arr[1], last_arr[1]) if last_arr and t - last_arr[0] <= SWITCH_S and last_arr[1] != rid
         else NAMES.get(label_before, label_before),
         "away_min": round((t - last_arr[0]) / 60, 1) if last_arr else "", "came_back": "",
         "back_route": "", "back_stop": "", "back_time": "",
         "reports_while_away": len([r for r in prior if not last_arr or r[0] > last_arr[0]]),
         "moving_at_event": "", "passio_pred_at_leave": "", "passio_pred_after_min": "", "phantom_stops": "",
         "replacement_vehicle": "", "replacement_min": "", "replacement_spot": ""}
    ev_txt = [f"joined {NAMES.get(rid, rid)} at {spot or 'an unknown spot'} {ct(t, '%H:%M')}"]
    if str(ev.get("returning")) == "1":
        lab = "layover_swap"
        ev_txt.append("the same bus left this route in the 30 min before (back from a layover)")
    elif last_arr is not None and last_arr[1] != rid and t - last_arr[0] <= SWITCH_S:
        lab = "added_from_route"
        ev_txt.append(f"last served {NAMES.get(last_arr[1], last_arr[1])} at {last_arr[3]} {(t - last_arr[0]) / 60:.0f} min before")
    elif last_arr is not None and t - last_arr[0] >= BREAK_MIN_S:
        lab = "added_from_break"
        ev_txt.append(f"{where}; last served {NAMES.get(last_arr[1], last_arr[1])} {(t - last_arr[0]) / 60:.0f} min before")
    elif not prior_day or gar is not None:
        lab = "added_from_garage"
        ev_txt.append("first report of the service day" if not prior_day else "came from the operator's garage")
    else:
        lab = "unknown"
        ev_txt.append(f"{where}" + (f"; reported as {NAMES.get(label_before, label_before)} before" if label_before else ""))
    if str(ev.get("expected")) == "1":
        ev_txt.append("the timetable also adds a bus here")
    return lab, d, "; ".join(ev_txt)


def day_events(day, dl, arr_path, arr, static_cache, landmarks):
    zp = O.zip_for(dl, day)
    st = O.build_static(zp, static_cache)
    sdir = Path(static_cache) / st["version"]
    lst = L.Static(sdir, sdir / "route_patterns.json")
    NAMES.update({rid: (r.get("long") or r.get("short") or rid) for rid, r in st["routes"].items()})
    t0, t1 = day_bounds(day)
    raw = Path(dl) / f"raw-polls-{day}.jsonl.gz"
    evs = BC.day_changes([raw], [arr_path], lst, t0, t1)
    d = date.fromisoformat(day)
    near = [(d + timedelta(days=k)).isoformat() for k in (-1, 0, 1)]
    tracks = load_tracks(dl, near)
    preds = load_preds(dl, near)
    routes_of = trip_routes(zp)
    namer = Namer(st["stops"], landmarks)
    adds_by_route = defaultdict(list)
    for e in evs:
        if e["kind"] == "add":
            veh, rid, t = e["vehicle_id"], e["route_id"], int(e["epoch"])
            first = next((r for r in reports_between(tracks.get(veh, []), t - 5, t + 600) if r[1] == rid), None)
            adds_by_route[rid].append((t, veh, namer(first[3], first[4])[0] if first else ""))
    out = []
    for k, e in enumerate(sorted(evs, key=lambda e: (int(e["epoch"]), e["route_id"], e["kind"]))):
        if e["kind"] == "drop":
            lab, dd, evid = leave_details(e, st, tracks, arr, preds, routes_of, namer, adds_by_route)
        else:
            lab, dd, evid = add_details(e, st, tracks, arr, namer, t0)
        t = int(e["epoch"])
        dt = datetime.fromtimestamp(t, O.CT)
        row = {"event_id": f"{day}-{k + 1:03d}", "service_day": day, "dow": DOW[(dt - timedelta(hours=4)).weekday()],
               "local_time": ct(t, "%Y-%m-%d %H:%M:%S"), "hour": dt.hour, "epoch": t, "route_id": e["route_id"],
               "route": NAMES.get(e["route_id"], e["route_name"]), "kind": "leave" if e["kind"] == "drop" else "add",
               "label": lab, "vehicle_id": e["vehicle_id"], "buses_before": e["buses_before"],
               "buses_after": e["buses_after"], "sched_buses_hour": e["sched_buses_hour"],
               "sched_buses_next_hour": e["sched_buses_next_hour"], "timetable_change": e["expected"],
               "trip_id": e["trip_id"], "lasting": e.get("lasting", ""), "returned_min": e.get("returned_min", ""),
               "moved_to_route": NAMES.get(e.get("moved_to_route") or "", e.get("moved_to_route") or ""),
               "evidence": evid, **dd}
        out.append(row)
    return out, st


# ---------------------------------------------------------------- spots and summaries
def spot_table(rows):
    """Named spots per (kind, line): counts by label, days seen, typical clock times (p10 / p50 / p90)."""
    groups = defaultdict(list)
    for r in rows:
        if r["label"] == "layover_swap" or not r["spot"]:
            continue
        groups[(r["kind"], r["route"], r["spot"])].append(r)
    out = []
    for (kind, route, spot), rs in groups.items():
        mins = [clock_min(int(r["epoch"])) for r in rs]
        wk = [r for r in rs if r["dow"] not in ("Sat", "Sun")]
        lab = Counter(r["label"] for r in rs)
        out.append({"kind": kind, "route": route, "spot": spot,
                    "lat": round(float(np.mean([float(r["spot_lat"]) for r in rs if r["spot_lat"] != ""] or [0])), 5),
                    "lon": round(float(np.mean([float(r["spot_lon"]) for r in rs if r["spot_lon"] != ""] or [0])), 5),
                    "events": len(rs), "days": len({r["service_day"] for r in rs}), "weekday_events": len(wk),
                    "labels": " / ".join(f"{k} {v}" for k, v in lab.most_common()),
                    "time_p10": hhmm(np.percentile(mins, 10)), "time_p50": hhmm(np.percentile(mins, 50)),
                    "time_p90": hhmm(np.percentile(mins, 90)),
                    "typical_where": Counter(r["where"].split(" (")[0] for r in rs).most_common(1)[0][0],
                    "vehicles": len({r["vehicle_id"] for r in rs}),
                    "passio_predicted_at_leave": sum(1 for r in rs if r["passio_pred_at_leave"] == "y") if kind == "leave" else ""})
    out.sort(key=lambda r: (r["kind"] != "leave", -r["events"]))
    return out


def summary_table(rows, ndays_by_type):
    """Per line and clock hour: leaves (by label), adds (by label), days with an event, events per day."""
    g = defaultdict(list)
    for r in rows:
        g[(r["route"], int(r["hour"]), "weekend" if r["dow"] in ("Sat", "Sun") else "weekday")].append(r)
    out = []
    for (route, hour, dt), rs in sorted(g.items(), key=lambda kv: (kv[0][0], kv[0][2], (kv[0][1] - 4) % 24)):
        lv = [r for r in rs if r["kind"] == "leave"]
        ad = [r for r in rs if r["kind"] == "add"]
        real = [r for r in lv if r["label"] != "layover_swap"]
        lab = Counter(r["label"] for r in rs)
        out.append({"route": route, "day_type": dt, "hour": hour, "leaves": len(lv), "leaves_not_layover": len(real),
                    "adds": len(ad), **{k: lab.get(k, 0) for k in ("break", "shift_end", "route_switch", "feed_drop",
                                                                    "layover_swap", "added_from_garage", "added_from_break",
                                                                    "added_from_route", "unknown")},
                    "days_with_leave": len({r["service_day"] for r in real}),
                    "days_of_type": ndays_by_type[dt],
                    "leaves_per_day": round(len(real) / max(1, ndays_by_type[dt]), 2),
                    "top_leave_spot": Counter(r["spot"] for r in real).most_common(1)[0][0] if real else "",
                    "top_add_spot": Counter(r["spot"] for r in ad if r["label"] != "layover_swap").most_common(1)[0][0]
                    if any(r["label"] != "layover_swap" for r in ad) else "",
                    "passio_predicted_leaving_bus": sum(1 for r in real if r["passio_pred_at_leave"] == "y"),
                    "phantom_stops": sum(int(r["phantom_stops"] or 0) for r in real)})
    return out


def write_csv(path, rows, cols):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})


def landmarks():
    try:
        j = json.loads((REPO / "web" / "data" / "landmarks.json").read_text(encoding="utf-8"))
        return [(x[0], float(x[1]), float(x[2])) for x in j.get("l", [])]
    except (OSError, ValueError, IndexError):
        return []


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dl", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--days", nargs="*")
    ap.add_argument("--cache", help="pickle of the event rows: written once, then read")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    dl, out = Path(a.dl), Path(a.out)
    days = a.days or sorted(p.name[10:20] for p in dl.glob("raw-polls-*.jsonl.gz"))
    static_cache = Path(tempfile.gettempdir()) / "sb-e27-static"
    if a.cache and Path(a.cache).exists():
        rows, names = pickle.loads(Path(a.cache).read_bytes())
        NAMES.update(names)
    else:
        arr = load_arrivals(dl / "arrivals.csv")
        marks = landmarks()
        rows = []
        for day in days:
            dr, _ = day_events(day, dl, dl / "arrivals.csv", arr, static_cache, marks)
            rows.extend(dr)
            c = Counter(r["label"] for r in dr)
            print(f"{day}: {len(dr)} events {dict(c)}", file=sys.stderr)
        if a.cache:
            Path(a.cache).write_bytes(pickle.dumps((rows, dict(NAMES))))
    out.mkdir(parents=True, exist_ok=True)
    rows.sort(key=lambda r: (int(r["epoch"]), r["route_id"], r["kind"]))
    write_csv(out / "transitions.csv", rows, COLUMNS)
    write_csv(out / "transition_spots.csv", sp := spot_table(rows), list(sp[0].keys()))
    nd = Counter("weekend" if date.fromisoformat(d).weekday() >= 5 else "weekday" for d in {r["service_day"] for r in rows})
    write_csv(out / "transition_summary.csv", sm := summary_table(rows, nd), list(sm[0].keys()))
    res = {"days": sorted({r["service_day"] for r in rows}), "events": len(rows),
           "by_kind_label": {k: dict(Counter(r["label"] for r in rows if r["kind"] == k)) for k in ("leave", "add")},
           "leave_passio_predicting": sum(1 for r in rows if r["kind"] == "leave" and r["label"] != "layover_swap"
                                          and r["passio_pred_at_leave"] == "y"),
           "leave_not_layover": sum(1 for r in rows if r["kind"] == "leave" and r["label"] != "layover_swap"),
           "phantom_stops": sum(int(r["phantom_stops"] or 0) for r in rows if r["kind"] == "leave")}
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()

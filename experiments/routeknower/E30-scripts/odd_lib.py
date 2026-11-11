#!/usr/bin/env python3
"""E30 (2026-11-11): shared inputs and helpers for the odd-behavior study at TRANSITION times.

Owner (2026-11-11): "The analysis should check for buses that have odd behavior during transition times and lines that
have large prediction misses. Create or indicate wherever appropriate for another agent to analyze and notice and
account for this data. Flag these lines and also tell me."

A transition window is 30 min on each side of (kinds, per line):
  bus_change       a non-layover leave or add of E29 (data/labeled/transitions/transitions.csv)
  handover         a lasting leave and a non-layover add on the same line within 30 min (a shift change), centred
                   between them
  service_start    the start of a listed span of the line (web/data/service.json, the day's timetable)
  service_end      the end of a listed span
  timetable_step   a clock-hour boundary inside the listed hours where the timetable's buses per hour change
Every detector (odd_feed.py, odd_labels.py, odd_passio.py, odd_schedule.py, odd_dwell.py) writes episodes everywhere;
run_odd.py tags each with the window it falls in (or none), so the rate inside the windows can be set against the
rate outside them on the same line (the baseline).

Read-only on every input. Stdlib + numpy (the E27 / E29 scripts it reuses need numpy too).
"""
import bisect, csv, gzip, json, math, sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
for p in (REPO / "tools", HERE.parent / "E27-scripts", HERE.parent / "E29-scripts"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
import offroute as O          # noqa: E402
import transitions as T       # noqa: E402

FRESH_S = 300                 # a report at most this much older than its poll is fresh (core/operating.js STALE_S)
STALE_LISTED_S = 90           # the collector's own freshness rule (tools/bus_changes.py FRESH_S)
WINDOW_S = 1800               # a transition window: 30 min on each side
HANDOVER_S = 1800             # a lasting leave and an add on one line within this = a shift change
LINE_M = 40                   # on a line: within this of its drawn shape (E27, E29)
CELL_M = 20                   # raster cell of LineIndex
MOVING_MPS = 3.0              # E29's moving rule: speed >= 3 m/s, or 150 m in the last 2 min
MOVED_M, MOVED_S = 150, 120
GARAGE, GARAGE_M = T.GARAGE, T.GARAGE_M
SHIP_DAY = "2026-11-06"       # E27b off-route hide, the 15-min GONE rule and the idle hide shipped this day
LASTING = {"break", "shift_end", "route_switch", "feed_drop"}
DCC_DARK_STOPS = {"132963", "132964", "155006", "132965"}   # DC-025 item 3: no Passio time since 2026-10-27 18:30
DCC_DARK_FROM = 1793143800    # 2026-10-27 18:30 CDT
CT = O.CT
DOW = T.DOW


def period(day):
    """'before' (Oct 10 to Nov 5) or 'after' (from Nov 6, the day the display rules shipped)."""
    return "after" if day >= SHIP_DAY else "before"


def hav_m(a_lat, a_lon, b_lat, b_lon):
    return T.hav_m(a_lat, a_lon, b_lat, b_lon)


def ct(t, fmt="%Y-%m-%d %H:%M"):
    return datetime.fromtimestamp(t, CT).strftime(fmt)


def hour_of(t):
    return datetime.fromtimestamp(t, CT).hour


def day_bounds(day):
    return T.day_bounds(day)


def day_type(day):
    wd = date.fromisoformat(day).weekday()
    return "weekend" if wd >= 5 else "weekday"


# ---------------------------------------------------------------- the day's polls
class DayPolls:
    """One pass over raw-polls-<day>.jsonl.gz.
    tracks   {veh: [(vt, rid, trip, lat, lon, spd, stop, h)]} fresh reports (h - vt <= FRESH_S), deduped on (veh, vt)
    listing  {veh: [(h, age, rid)]} every poll that listed the bus (age = h - vt), deduped on (veh, h)
    feed_t   sorted report times of every fresh report (any bus): the feed is alive where these are dense
    poll_h   sorted poll times"""

    def __init__(self, path):
        self.tracks, self.listing = defaultdict(list), defaultdict(list)
        seen, lseen, feed, polls = set(), set(), [], []
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for ln in f:
                try:
                    poll = json.loads(ln)
                except ValueError:
                    continue
                h = int(poll.get("h") or poll.get("t") or 0)
                polls.append(h)
                for v in poll.get("v") or []:
                    try:
                        veh, trip, rid, lat, lon = str(v[0]), str(v[1]), str(v[2]), float(v[3]), float(v[4])
                        spd = float(v[6]) if v[6] is not None else None
                        vt = int(v[10] or 0)
                    except (ValueError, TypeError, IndexError):
                        continue
                    if not vt:
                        continue
                    if (veh, h) not in lseen:
                        lseen.add((veh, h))
                        self.listing[veh].append((h, h - vt, rid))
                    if (veh, vt) in seen or h - vt > FRESH_S:
                        continue
                    seen.add((veh, vt))
                    stop = "" if len(v) < 9 or v[8] is None else str(v[8])
                    self.tracks[veh].append((vt, rid, trip, lat, lon, spd, stop, h))
                    feed.append(vt)
        for v in self.tracks.values():
            v.sort()
        for v in self.listing.values():
            v.sort()
        self.feed_t = sorted(feed)
        self.poll_h = sorted(polls)

    @classmethod
    def from_tracks(cls, tracks, listing=None, poll_h=None):
        """Test seam: build from ready tracks."""
        self = cls.__new__(cls)
        self.tracks = defaultdict(list, {k: sorted(v) for k, v in tracks.items()})
        self.listing = defaultdict(list, listing or {})
        self.feed_t = sorted(r[0] for v in tracks.values() for r in v)
        self.poll_h = sorted(poll_h or self.feed_t)
        return self

    def feed_alive(self, a, b, max_gap_s=120):
        """True when fresh reports (any bus) never pause more than max_gap_s between a and b (the feed and the
        collector were working, so a bus missing from it was missing from Passio's feed)."""
        ft = self.feed_t
        i = bisect.bisect_left(ft, a)
        prev = a
        while i < len(ft) and ft[i] <= b:
            if ft[i] - prev > max_gap_s:
                return False
            prev = ft[i]
            i += 1
        return b - prev <= max_gap_s


def is_moving(track, i):
    """E29's rule on report i of a track: speed >= 3 m/s, or 150 m covered in the 2 min before it."""
    r = track[i]
    if r[5] is not None and r[5] >= MOVING_MPS:
        return True
    j = i
    while j > 0 and track[j - 1][0] >= r[0] - MOVED_S:
        j -= 1
    return j < i and hav_m(track[j][3], track[j][4], r[3], r[4]) >= MOVED_M


# ---------------------------------------------------------------- lines
class LineIndex:
    """Each route's drawn line rasterized into CELL_M cells within radius_m (a fast 'is this point on line R')."""

    def __init__(self, shapes, radius_m=LINE_M, cell_m=CELL_M):
        self.cell, self.cells = cell_m, {}
        k = int(math.ceil(radius_m / cell_m))
        disk = [(dx, dy) for dx in range(-k, k + 1) for dy in range(-k, k + 1)
                if math.hypot(max(0, abs(dx) - 0.5), max(0, abs(dy) - 0.5)) * cell_m <= radius_m]
        for rid, lines in (shapes or {}).items():
            cs = set()
            for line in lines or []:
                for (la, lo), (lb, lob) in zip(line[:-1], line[1:]):
                    (xa, ya), (xb, yb) = O.xy([la, lb], [lo, lob])
                    n = max(1, int(math.hypot(xb - xa, yb - ya) / (cell_m / 2)))
                    for s in range(n + 1):
                        x, y = xa + (xb - xa) * s / n, ya + (yb - ya) * s / n
                        cx, cy = int(math.floor(x / cell_m)), int(math.floor(y / cell_m))
                        for dx, dy in disk:
                            cs.add((cx + dx, cy + dy))
            self.cells[str(rid)] = cs

    def _cell(self, lat, lon):
        x, y = O.xy([lat], [lon])[0]
        return int(math.floor(x / self.cell)), int(math.floor(y / self.cell))

    def on(self, rid, lat, lon):
        cs = self.cells.get(str(rid))
        return bool(cs) and self._cell(lat, lon) in cs

    def lines_at(self, lat, lon):
        c = self._cell(lat, lon)
        return {rid for rid, cs in self.cells.items() if c in cs}


# ---------------------------------------------------------------- timetable
def _hm(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def listed_spans(service, day):
    """{route_id: [(a, b)]} the listed spans of THIS service day (epochs; '28:29' = 04:29 the next morning)."""
    d = date.fromisoformat(day)
    key = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")[d.weekday()]
    mid = datetime(d.year, d.month, d.day, tzinfo=CT)
    out = {}
    for rid, r in ((service or {}).get("routes") or {}).items():
        dd = (r.get("days") or {}).get(key)
        if not dd:
            continue
        sp = []
        for a, b in dd.get("spans") or []:
            ta = mid + timedelta(minutes=_hm(a))
            tb = mid + timedelta(minutes=_hm(b))
            # wall-clock minutes past midnight: rebuild through the local calendar (daylight saving safe)
            ta = datetime(ta.year, ta.month, ta.day, ta.hour, ta.minute, tzinfo=CT)
            tb = datetime(tb.year, tb.month, tb.day, tb.hour, tb.minute, tzinfo=CT)
            sp.append((int(ta.timestamp()), int(tb.timestamp())))
        if sp:
            out[str(rid)] = sp
    return out


def sched_buses(service, rid, t):
    """Timetable buses for the Chicago clock hour of t (service.json days.<dow>.buses), or None."""
    dt = datetime.fromtimestamp(t, CT)
    key = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")[dt.weekday()]
    try:
        b = (((service or {}).get("routes") or {}).get(str(rid), {}).get("days", {}).get(key) or {}).get("buses")
        return int(b[dt.hour]) if b and len(b) > dt.hour else None
    except (TypeError, ValueError, IndexError):
        return None


def timetable_steps(service, day, spans):
    """[(route_id, t, before, after)] clock-hour boundaries inside a listed span of the day where the timetable's buses
    per hour change (t = the boundary; before = the hour before, after = the hour from t)."""
    t0, t1 = day_bounds(day)
    out = []
    for rid, sp in spans.items():
        for a, b in sp:
            t = (a // 3600 + 1) * 3600
            while t < min(b, t1 + 3600):
                x, y = sched_buses(service, rid, t - 1), sched_buses(service, rid, t)
                if x is not None and y is not None and x != y and t0 <= t:
                    out.append((rid, t, x, y))
                t += 3600
    return sorted(set(out), key=lambda s: (s[1], s[0]))


def hours_outside(spans3, t):
    """('before' | 'after' | '', seconds) outside the route's listed hours at t, from the 3-day spans
    (offroute.spans_for): inside a span = ('', 0)."""
    best, side = math.inf, ""
    for a, b in spans3:
        if a <= t < b:
            return "", 0.0
        if t < a and a - t < best:
            best, side = a - t, "before"
        if t >= b and t - b < best:
            best, side = t - b, "after"
    return side, best


# ---------------------------------------------------------------- windows
def build_windows(day, trans_rows, spans, steps):
    """The transition windows of one service day: [{route_id, kind, t, a, b, ref}] (see the module docstring)."""
    W = []
    real = [r for r in trans_rows if r["label"] != "layover_swap"]
    for r in real:
        t = int(r["epoch"])
        W.append({"route_id": r["route_id"], "kind": "bus_change", "t": t, "a": t - WINDOW_S, "b": t + WINDOW_S,
                  "ref": r["event_id"]})
    leaves = [r for r in real if r["kind"] == "leave"]
    adds = [r for r in real if r["kind"] == "add"]
    for lv in leaves:
        tl = int(lv["epoch"])
        best = min((a for a in adds if a["route_id"] == lv["route_id"] and a["vehicle_id"] != lv["vehicle_id"]
                    and abs(int(a["epoch"]) - tl) <= HANDOVER_S), key=lambda a: abs(int(a["epoch"]) - tl), default=None)
        if best is not None:
            t = (tl + int(best["epoch"])) // 2
            W.append({"route_id": lv["route_id"], "kind": "handover", "t": t, "a": t - WINDOW_S, "b": t + WINDOW_S,
                      "ref": f"{lv['event_id']}+{best['event_id']}"})
    for rid, sp in spans.items():
        for a, b in sp:
            W.append({"route_id": rid, "kind": "service_start", "t": a, "a": a - WINDOW_S, "b": a + WINDOW_S,
                      "ref": ct(a, "%H:%M")})
            W.append({"route_id": rid, "kind": "service_end", "t": b, "a": b - WINDOW_S, "b": b + WINDOW_S,
                      "ref": ct(b, "%H:%M")})
    for rid, t, x, y in steps:
        W.append({"route_id": rid, "kind": "timetable_step", "t": t, "a": t - WINDOW_S, "b": t + WINDOW_S,
                  "ref": f"{x}->{y}"})
    return W


class WindowIndex:
    """Lookup of the transition window a (route, time span) falls in: the window of that route whose centre is nearest
    the episode's start among those overlapping it. Priority on ties: bus_change, handover, service_end,
    service_start, timetable_step."""
    PRI = {"bus_change": 0, "handover": 1, "service_end": 2, "service_start": 3, "timetable_step": 4}

    def __init__(self, windows):
        self.by = defaultdict(list)
        for w in windows:
            self.by[str(w["route_id"])].append(w)
        for v in self.by.values():
            v.sort(key=lambda w: w["a"])

    def at(self, rid, a, b=None):
        b = a if b is None else b
        best = None
        for w in self.by.get(str(rid), []):
            if w["a"] > b:
                break
            if w["b"] < a:
                continue
            key = (abs(w["t"] - a), self.PRI[w["kind"]])
            if best is None or key < best[0]:
                best = (key, w)
        return best[1] if best else None

    def covered_s(self, rid, a, b):
        """Seconds of [a, b] inside any window of the route."""
        iv = sorted((max(a, w["a"]), min(b, w["b"])) for w in self.by.get(str(rid), []) if w["b"] > a and w["a"] < b)
        tot, cur = 0, None
        for x, y in iv:
            if cur is None or x > cur[1]:
                if cur:
                    tot += cur[1] - cur[0]
                cur = [x, y]
            else:
                cur[1] = max(cur[1], y)
        if cur:
            tot += cur[1] - cur[0]
        return tot


def exposure(tracks, widx, routes, step_cap_s=60):
    """Bus-minutes per (route_id, in_window) from the fresh reports: each report stands for the time to the next one,
    at most step_cap_s. Only route labels in `routes`."""
    out = defaultdict(float)
    for veh, tr in tracks.items():
        for i, r in enumerate(tr):
            if r[1] not in routes:
                continue
            nxt = tr[i + 1][0] if i + 1 < len(tr) else r[0] + step_cap_s
            dt = min(step_cap_s, max(0, nxt - r[0]))
            if not dt:
                continue
            inside = widx.covered_s(r[1], r[0], r[0] + dt)
            out[(r[1], True)] += inside / 60
            out[(r[1], False)] += (dt - inside) / 60
    return out


# ---------------------------------------------------------------- other inputs
def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path, rows, cols):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})


def load_arrivals_full(path):
    """Per vehicle: sorted (epoch, route_id, stop_id, stop_name, lat, lon, has_pred, source)."""
    by = defaultdict(list)
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                by[str(r["vehicle_id"])].append((int(r["epoch"]), str(r["route_id"]), str(r["stop_id"]), r["stop_name"],
                                                 float(r["stop_lat"] or 0), float(r["stop_lon"] or 0),
                                                 bool(r.get("passio_pred_epoch")), r.get("source", "")))
            except (ValueError, KeyError):
                continue
    for v in by.values():
        v.sort()
    return by


def arrivals_in(arr, veh, a, b, rid=None):
    lst = arr.get(str(veh), [])
    i = bisect.bisect_left(lst, (a,))
    j = bisect.bisect_right(lst, (b, "￿"))
    return [x for x in lst[i:j] if rid is None or x[1] == rid]


def linger_spots(path, min_episodes=20):
    """E28's learned linger spots (lat, lon, name) with at least min_episodes (layover places)."""
    out = []
    try:
        for r in read_csv(path):
            if int(r["episodes"]) >= min_episodes:
                out.append((float(r["lat"]), float(r["lon"]), r["spot"]))
    except (OSError, KeyError, ValueError):
        pass
    return out


def near_spot(spots, lat, lon, m):
    return next((s[2] for s in spots if hav_m(lat, lon, s[0], s[1]) <= m), "")

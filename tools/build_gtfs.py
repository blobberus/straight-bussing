#!/usr/bin/env python3
"""Download the Passio GTFS zip and convert it to compact JSON in web/data/ (or: --zip FILE --out DIR)."""
import csv, io, json, statistics, sys, zipfile, urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

URL = "https://passio3.com/chicago/passioTransit/gtfs/google_transit.zip"
OUT = Path(__file__).resolve().parent.parent / "web" / "data"
# collector-only: stop patterns a route runs besides its route_stops.json one (not deployed, so not in the app)
PATTERNS = Path(__file__).resolve().parent.parent / "data" / "route_patterns.json"
MAX_SHAPES_PER_DIR = 2


def rows(z, name):
    try:
        with z.open(name) as f:
            return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))
    except KeyError:
        return []


def color(v):
    v = (v or "").strip().lstrip("#")
    return "#" + v.upper() if len(v) == 6 and all(c in "0123456789abcdefABCDEF" for c in v) else None


def hms(v):
    try:
        h, m, sec = (int(x) for x in v.strip().split(":"))
        return h * 3600 + m * 60 + sec
    except (AttributeError, ValueError):
        return None


def interpolate(seq):
    """Fill missing times between timepoints (by shape distance, else stop index).
    Returns [(seq, stop, arr, dep, interpolated?)] or None if <2 timepoints."""
    n = len(seq)
    known = [i for i, x in enumerate(seq) if x[2] is not None]
    if len(known) < 2:
        return None
    pos = [x[4] if x[4] is not None else float(i) for i, x in enumerate(seq)]
    if any(b < a for a, b in zip(pos, pos[1:])):
        pos = [float(i) for i in range(n)]
    out = []
    for i, x in enumerate(seq):
        if x[2] is not None:
            out.append((x[0], x[1], x[2], x[3], False))
            continue
        lo = max((k for k in known if k < i), default=None)
        hi = min((k for k in known if k > i), default=None)
        if lo is None or hi is None:
            return None
        span = pos[hi] - pos[lo]
        f = (pos[i] - pos[lo]) / span if span > 0 else (i - lo) / (hi - lo)
        t = int(round(seq[lo][3] + f * (seq[hi][2] - seq[lo][3])))
        out.append((x[0], x[1], t, t, True))
    return out


def build_segments(trips, route_stops, sched, freqs=()):
    """Scheduled per-segment seconds (median over trips), dwell and headway per route."""
    by_route = defaultdict(list)
    svc = {}
    trip_route = {t["trip_id"]: t["route_id"] for t in trips}
    for t in trips:
        by_route[t["route_id"]].append(t["trip_id"])
        svc[t["trip_id"]] = t.get("service_id", "")
    out = {}
    for rid, order in route_stops.items():
        pair = defaultdict(list)
        dwell = []
        starts = defaultdict(list)
        for tid in by_route.get(rid, ()):
            seq = interpolate(sorted(sched.get(tid, ()), key=lambda x: x[0]))
            if not seq:
                continue
            if seq[0][1] == order[0]:
                starts[svc[tid]].append(seq[0][3])
            for (_, f, _, fd, _), (_, t2, ta, _, _) in zip(seq, seq[1:]):
                pair[(f, t2)].append(ta - fd)
            dwell += [d - a for _, _, a, d, ip in seq[1:-1] if not ip and 0 <= d - a <= 600]
        segs = []
        for f, t2 in zip(order, order[1:]):
            v = pair.get((f, t2))
            segs.append(int(round(statistics.median(v))) if v else None)
        gaps = []
        for v in starts.values():
            v = sorted(set(v))
            gaps += [b - a for a, b in zip(v, v[1:]) if b > a]
        fh = [int(f["headway_secs"]) for f in freqs if trip_route.get(f["trip_id"]) == rid]
        if fh and not gaps:
            gaps = fh
        o = {"seg": segs}
        if dwell:
            o["dwell"] = int(round(statistics.median(dwell)))
        if gaps:
            o["hw"] = round(statistics.median(gaps) / 60, 1)
        out[rid] = o
    return out


DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
CAL_COLS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def ymd(v):
    try:
        return datetime.strptime(v.strip(), "%Y%m%d").date()
    except (AttributeError, ValueError):
        return None


def hhmm(sec):
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}"


def trip_intervals(trips, sched, freqs):
    """trip_id -> [(start_s, end_s)] service-day seconds; frequency trips expand from their template."""
    by_trip = defaultdict(list)
    for f in freqs:
        by_trip[f["trip_id"]].append(f)
    out = {}
    for t in trips:
        tid = t["trip_id"]
        times = [x for st in sched.get(tid, ()) for x in (st[2], st[3]) if x is not None]
        if not times:
            continue
        start, end = min(times), max(times)
        fs = by_trip.get(tid)
        if not fs:
            out[tid] = [(start, end)]
            continue
        inst = []
        for f in fs:
            a, b = hms(f.get("start_time")), hms(f.get("end_time"))
            try:
                hw = int(f.get("headway_secs") or 0)
            except ValueError:
                hw = 0
            if a is None or b is None or hw <= 0:
                continue
            t0 = a
            while t0 < b:
                inst.append((t0, t0 + (end - start)))
                t0 += hw
        out[tid] = inst or [(start, end)]
    return out


def ref_stops(trips, sched, route_stops):
    """route_id -> the stop most of its trips leave from (a trip's last stop never counts: the bus ends or turns there),
    ties to the earliest stop in route_stops order. The route page's "Schedule by hour" reads its departures there."""
    cnt = defaultdict(Counter)
    for t in trips:
        seq = sorted(sched.get(t["trip_id"], ()), key=lambda x: x[0])
        for sid in {x[1] for x in (seq[:-1] if len(seq) > 1 else seq)}:
            cnt[t["route_id"]][sid] += 1
    out = {}
    for rid, c in cnt.items():
        order = route_stops.get(rid) or []
        out[rid] = min(c, key=lambda sid: (-c[sid], order.index(sid) if sid in order else len(order), sid))
    return out


def trip_departures(trips, sched, freqs, refs):
    """trip_id -> departure seconds (service day) at its route's reference stop (ref_stops): the first visit that is not
    the trip's last stop, times between timepoints interpolated; frequency trips expand from their template like
    trip_intervals. Trips that never leave the reference stop are left out."""
    by_trip = defaultdict(list)
    for f in freqs:
        by_trip[f["trip_id"]].append(f)
    out = {}
    for t in trips:
        tid, ref = t["trip_id"], refs.get(t["route_id"])
        raw = sorted(sched.get(tid, ()), key=lambda x: x[0])
        seq = interpolate(raw) or raw
        body = seq[:-1] if len(seq) > 1 else seq
        hit = next((x[3] for x in body if x[1] == ref and x[3] is not None), None)
        if hit is None:
            continue
        fs = by_trip.get(tid)
        if not fs:
            out[tid] = [hit]
            continue
        start = min(x for st in raw for x in (st[2], st[3]) if x is not None)
        inst = []
        for f in fs:
            a, b = hms(f.get("start_time")), hms(f.get("end_time"))
            try:
                hw = int(f.get("headway_secs") or 0)
            except ValueError:
                hw = 0
            if a is None or b is None or hw <= 0:
                continue
            t0 = a
            while t0 < b:
                inst.append(t0 + hit - start)
                t0 += hw
        out[tid] = inst or [hit]
    return out


def dep_list(deps, day0):
    """Departure seconds -> sorted service-day minutes, delta coded: [first, gap, gap, ...]. Minutes before the day's
    start (day0, minutes) are after midnight (a night route writes 00:30 for its 12:30 AM trip) and get + 24 h."""
    ms = sorted({(m if m >= day0 else m + 1440) for m in ((s // 60) % 1440 for s in deps)})
    return [b - a for a, b in zip([0] + ms, ms)]


def day_summary(intervals, deps=()):
    """[(start,end)] for one route on one service day (+ departure seconds at its reference stop) ->
    {first,last,trips,buses[24],spans,dep} or None. dep = dep_list (web core/schedule.js hourlyHeadways)."""
    iv = [(a, b) for a, b in intervals if b >= a]
    if not iv:
        return None
    buses = [0] * 24
    ev = sorted([(a, 1) for a, b in iv if b > a] + [(b, -1) for a, b in iv if b > a])
    cur, i = 0, 0
    while i < len(ev):                      # sweep: max concurrent trips touching each local hour
        t = ev[i][0]
        while i < len(ev) and ev[i][0] == t:
            cur += ev[i][1]
            i += 1
        nxt = ev[i][0] if i < len(ev) else t
        if cur > 0:
            for h in range(t // 3600, (max(nxt - 1, t)) // 3600 + 1):
                buses[h % 24] = max(buses[h % 24], cur)
    for a, b in iv:                         # zero-length trips still mean a bus that hour
        buses[(a // 3600) % 24] = max(buses[(a // 3600) % 24], 1)
    spans = service_spans(iv)
    out = {"first": spans[0][0], "last": spans[-1][1], "trips": len(iv), "buses": buses,
           "spans": [list(x) for x in spans]}
    if deps:
        h, m = spans[0][0].split(":")
        out["dep"] = dep_list(deps, int(h) * 60 + int(m))
    return out


def service_spans(iv, min_gap=60):
    """Service windows from trip intervals folded onto one 24 h clock (night routes write after-midnight
    trips as 00:xx on the same service day). Windows split at gaps >= min_gap minutes; the day starts
    after the longest gap. -> [("HH:MM", "HH:MM")], end may be >= 24:00."""
    cov = [False] * 1440
    for a, b in iv:
        for m in range(a // 60, max(a // 60, (b - 1) // 60) + 1):
            cov[m % 1440] = True
    if all(cov):
        return [("00:00", "24:00")]
    gaps, m = [], 0                          # circular uncovered runs (start, length)
    start = cov.index(False)
    while m < 1440:
        i = (start + m) % 1440
        if not cov[i]:
            n = 0
            while n < 1440 and not cov[(i + n) % 1440]:
                n += 1
            gaps.append((i, n))
            m += n
        else:
            m += 1
    longest = max(gaps, key=lambda g: g[1])
    day0 = (longest[0] + longest[1]) % 1440      # first covered minute after the longest gap
    out, cur, m = [], None, 0
    while m < 1440:
        i = (day0 + m) % 1440
        if cov[i]:
            if cur is None:
                cur = [day0 + m, day0 + m + 1]
            else:
                cur[1] = day0 + m + 1
            m += 1
            continue
        n = 0
        while m + n < 1440 and not cov[(day0 + m + n) % 1440]:
            n += 1
        if cur and (n >= min_gap or m + n >= 1440):
            out.append(cur)
            cur = None
        m += n
    if cur:
        out.append(cur)
    base = (out[0][0] // 1440) * 1440            # keep the first start within 00:00-23:59
    return [(hhmm((a - base) * 60), hhmm((b - base) * 60)) for a, b in out]


def build_service(z, trips, sched, freqs, today=None, route_stops=None):
    """Per-route hours by weekday, scheduled buses per hour, departures at the route's reference stop ("at"),
    calendar_dates changes in the feed window."""
    info = (rows(z, "feed_info.txt") or [{}])[0]
    today = today or datetime.now(timezone.utc).date()
    w0 = ymd(info.get("feed_start_date", "")) or today
    w1 = ymd(info.get("feed_end_date", "")) or (w0 + timedelta(days=60))
    cal = {}
    for c in rows(z, "calendar.txt"):
        a, b = ymd(c.get("start_date", "")), ymd(c.get("end_date", ""))
        if a and b and (b < w0 or a > w1):
            continue                        # not in effect during this feed
        cal[c["service_id"]] = {"days": {k for k, col in zip(DAY_KEYS, CAL_COLS) if c.get(col, "0").strip() == "1"},
                                "a": a, "b": b}
    cdates = defaultdict(dict)              # date -> {service_id: 1 added | 2 removed}
    for r in rows(z, "calendar_dates.txt"):
        d = ymd(r.get("date", ""))
        if d and w0 <= d <= w1 and r.get("exception_type", "").strip() in ("1", "2"):
            cdates[d][r["service_id"]] = int(r["exception_type"])
    iv = trip_intervals(trips, sched, freqs)
    refs = ref_stops(trips, sched, route_stops or {})
    dep = trip_departures(trips, sched, freqs, refs)
    by_route = defaultdict(lambda: defaultdict(list))   # rid -> service_id -> [(s,e)]
    dep_route = defaultdict(lambda: defaultdict(list))  # rid -> service_id -> [departure s at refs[rid]]
    for t in trips:
        by_route[t["route_id"]][t.get("service_id", "")] += iv.get(t["trip_id"], [])
        dep_route[t["route_id"]][t.get("service_id", "")] += dep.get(t["trip_id"], [])

    def active(svcs, d):
        k = DAY_KEYS[d.weekday()]
        on = {s for s in svcs if s in cal and k in cal[s]["days"] and (not cal[s]["a"] or cal[s]["a"] <= d <= cal[s]["b"])}
        for s, typ in cdates.get(d, {}).items():
            if s in svcs:
                (on.add if typ == 1 else on.discard)(s)
        return on

    out = {}
    for rid, svcs in sorted(by_route.items()):
        days, deps = {}, dep_route[rid]
        for k in DAY_KEYS:
            on = [s for s in svcs if s in cal and k in cal[s]["days"]]
            days[k] = day_summary([x for s in on for x in svcs[s]], [x for s in on for x in deps[s]])
        exc = []
        for d in sorted(cdates):
            k = DAY_KEYS[d.weekday()]
            regular = {s for s in svcs if s in cal and k in cal[s]["days"] and (not cal[s]["a"] or cal[s]["a"] <= d <= cal[s]["b"])}
            now_on = active(svcs, d)
            if now_on == regular:
                continue
            got = day_summary([x for s in now_on for x in svcs[s]], [x for s in now_on for x in deps[s]])
            reg_trips = days[k]["trips"] if days[k] else 0
            e = {"date": d.isoformat(), "type": "removed" if (got["trips"] if got else 0) < reg_trips else "added", "days": k}
            e["hours"] = got   # with buses + dep: the route page's bars and Schedule by hour follow a changed day too
            exc.append(e)
        out[rid] = {"days": days, "exceptions": exc}
        if rid in refs:
            out[rid]["at"] = refs[rid]
    return {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "feed": {"start": w0.isoformat(), "end": w1.isoformat()}, "routes": out}


def feed_calendar(z, today=None):
    """The feed window and its calendars: (w0, w1, {service_id: {"days": "1111100" Mon..Sun, "start", "end"}},
    {date: {service_id: 1 added | 2 removed}}). Same rules as build_service: calendars not in effect during the feed
    window are left out, calendar_dates only inside it."""
    info = (rows(z, "feed_info.txt") or [{}])[0]
    today = today or datetime.now(timezone.utc).date()
    w0 = ymd(info.get("feed_start_date", "")) or today
    w1 = ymd(info.get("feed_end_date", "")) or (w0 + timedelta(days=60))
    cal = {}
    for c in rows(z, "calendar.txt"):
        a, b = ymd(c.get("start_date", "")), ymd(c.get("end_date", ""))
        if a and b and (b < w0 or a > w1):
            continue
        cal[c["service_id"]] = {"days": "".join("1" if c.get(col, "0").strip() == "1" else "0" for col in CAL_COLS),
                                "start": a.isoformat() if a else None, "end": b.isoformat() if b else None}
    dates = defaultdict(dict)
    for r in rows(z, "calendar_dates.txt"):
        d = ymd(r.get("date", ""))
        if d and w0 <= d <= w1 and r.get("exception_type", "").strip() in ("1", "2"):
            dates[d.isoformat()][r["service_id"]] = int(r["exception_type"])
    return w0, w1, cal, dict(sorted(dates.items()))


def build_timetable(z, trips, sched, freqs, today=None):
    """Scheduled times at every stop, for planning a trip at a chosen start time (Directions' "Leave at", owner
    2026-11-09). Loaded by the app only when a rider picks a start time (web data/timetable.js, iOS Kit Timetable).

    {v:1, generated, feed:{start, end},
     services: {service_id: {days:"1111100" (Mon..Sun), start:"YYYY-MM-DD"|null, end}},
     dates: {"YYYY-MM-DD": {service_id: 1 added | 2 removed}},     calendar_dates inside the feed window
     routes: {rid: [{stops:[stop ids in trip order], t:[seconds after the trip's start at each stop],
                     starts:{service_id: [trip start, seconds after the service day's midnight]}}]}}

    One entry per stop pattern + timing; t comes from the timepoints, the stops between them interpolated by shape
    distance (interpolate). Arrival = departure (the feed has no dwell). Frequency trips are expanded from their
    template (start_time <= start < end_time, every headway_secs). Night routes write their after-midnight trips as
    00:xx of the same service day (service_spans): a start before the service day's first window (the first start
    after its longest gap, the hours service.json lists) is moved past 24:00, so 12:10 AM after Friday's service is
    Friday 24:10, as core/schedule.js reads the hours."""
    w0, w1, cal, dates = feed_calendar(z, today)
    by_trip = defaultdict(list)
    for f in freqs:
        by_trip[f["trip_id"]].append(f)
    pats = defaultdict(dict)               # rid -> (stops, t) -> {sid: set(starts)}
    spans_iv = defaultdict(list)           # (rid, sid) -> [(start, end)] for the service day's first window
    for t in trips:
        sid = t.get("service_id", "")
        if sid not in cal:
            continue
        seq = interpolate(sorted(sched.get(t["trip_id"], ()), key=lambda x: x[0]))
        if not seq:
            continue
        t0 = seq[0][2]
        offs = tuple(x[2] - t0 for x in seq)
        if any(b < a for a, b in zip(offs, offs[1:])):
            continue                       # times running backwards: not a usable trip
        stops = tuple(x[1] for x in seq)
        starts = [t0]
        fs = by_trip.get(t["trip_id"])
        if fs:
            starts = []
            for f in fs:
                a, b = hms(f.get("start_time")), hms(f.get("end_time"))
                try:
                    hw = int(f.get("headway_secs") or 0)
                except ValueError:
                    hw = 0
                if a is None or b is None or hw <= 0:
                    continue
                s = a
                while s < b:
                    starts.append(s)
                    s += hw
        if not starts:
            continue
        pats[t["route_id"]].setdefault((stops, offs), defaultdict(set))[sid].update(starts)
        spans_iv[(t["route_id"], sid)] += [(s, s + offs[-1]) for s in starts]
    def first_window(iv):                  # seconds of the service day's first window start
        h, m = service_spans(iv)[0][0].split(":")
        return int(h) * 3600 + int(m) * 60
    day0 = {k: first_window(v) for k, v in spans_iv.items()}
    out = {}
    for rid in sorted(pats):
        lst = []
        for (stops, offs), by_sid in pats[rid].items():
            st = {}
            for sid, v in sorted(by_sid.items()):
                d0 = day0.get((rid, sid), 0)
                st[sid] = sorted({s + 86400 if s < 86400 and s < d0 else s for s in v})
            lst.append({"stops": list(stops), "t": list(offs), "starts": st})
        lst.sort(key=lambda p: (-sum(len(v) for v in p["starts"].values()), p["stops"]))   # most trips first
        out[rid] = lst
    return {"v": 1, "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "feed": {"start": w0.isoformat(), "end": w1.isoformat()},
            "services": {sid: cal[sid] for sid in sorted(cal)}, "dates": dates, "routes": out}


def route_variants(trips, stimes, route_stops, min_trips=3):
    """Per route, the other stop patterns (>= min_trips trips) that serve stops route_stops.json lacks: Midway
    Metra's afternoon loop (from 3:30 PM) runs through 57th St. & Metra (NB), which its morning pattern (the one
    in route_stops.json) does not. The collector adds those stops to its own copy of the route order
    (arrivals_lib.Static), so they get rows; the app's route_stops.json is unchanged."""
    pats = defaultdict(Counter)
    for t in trips:
        seq = tuple(sid for _, sid in sorted(stimes.get(t["trip_id"], ())))
        if seq:
            pats[t["route_id"]][seq] += 1
    out = {}
    for rid, cnt in sorted(pats.items()):
        have = set(route_stops.get(rid) or ())
        extra = [list(p) for p, n in cnt.most_common() if n >= min_trips and set(p) - have]
        if have and extra:
            out[rid] = extra
    return out


def route_aliases(trips, routes):
    """route_id -> sorted shape ids of its trips: the ids Passio also uses for a route. Its service alerts can name a
    route by its internal id, which is the GTFS shape id of that route's trips (the North alert of 2026-10-14 named
    38734, North's shape; route 1075; DC-009). A shape used by trips of two routes, or equal to a route id, could name
    either, so it is left out. routes.json carries the list as "alias_ids"; the app maps an alert's unknown route id
    through it (web core/arrivals.js alertRouteIds, iOS Kit Arrivals.alertRouteIds)."""
    by = defaultdict(set)
    for t in trips:
        s, r = str(t.get("shape_id") or "").strip(), t.get("route_id")
        if s and r in routes:
            by[s].add(r)
    out = defaultdict(list)
    for s, rs in by.items():
        if len(rs) == 1 and s not in routes:
            out[next(iter(rs))].append(s)
    return {r: sorted(v) for r, v in out.items()}


def dump(name, obj):
    (OUT / name).write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def main(argv=None):
    """Default: download Passio's zip into web/data (+ data/route_patterns.json). --zip / --out / --patterns build
    an archived day's zip into another folder instead (tools/replay_day.py; never over web/data)."""
    import argparse
    global OUT, PATTERNS
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--zip", help="a local google_transit.zip instead of downloading Passio's")
    ap.add_argument("--out", help="write the JSON files here instead of web/data")
    ap.add_argument("--patterns", help="write route_patterns.json here instead of data/route_patterns.json")
    ap.add_argument("--save-zip", help="also keep the zip it built from here (collect.yml records the timetable version: "
                                       "tools/gtfs_versions.py)")
    a = ap.parse_args(argv)
    OUT = Path(a.out) if a.out else OUT
    PATTERNS = Path(a.patterns) if a.patterns else PATTERNS
    if a.zip:
        data = Path(a.zip).read_bytes()
    else:
        req = urllib.request.Request(URL, headers={"User-Agent": "straight-bussing/1.0"})
        data = urllib.request.urlopen(req, timeout=60).read()
    z = zipfile.ZipFile(io.BytesIO(data))
    if a.save_zip:
        Path(a.save_zip).write_bytes(data)
    OUT.mkdir(parents=True, exist_ok=True)

    routes = {}
    for r in rows(z, "routes.txt"):
        routes[r["route_id"]] = {
            "short": r.get("route_short_name", ""),
            "long": r.get("route_long_name", ""),
            "color": color(r.get("route_color")) or "#444444",
            "text_color": color(r.get("route_text_color")) or "#FFFFFF",
        }

    stops = {s["stop_id"]: {"name": s.get("stop_name", ""),
                            "lat": round(float(s["stop_lat"]), 5),
                            "lon": round(float(s["stop_lon"]), 5)}
             for s in rows(z, "stops.txt") if s.get("stop_lat") and s.get("stop_lon")}

    trips = rows(z, "trips.txt")
    for rid, ids in route_aliases(trips, routes).items():   # Passio's own ids for a route (service alerts)
        routes[rid]["alias_ids"] = ids
    # shape usage counts per (route, direction)
    usage = defaultdict(Counter)
    for t in trips:
        if t.get("shape_id"):
            usage[(t["route_id"], t.get("direction_id", ""))][t["shape_id"]] += 1

    pts = defaultdict(list)
    for s in rows(z, "shapes.txt"):
        pts[s["shape_id"]].append((int(s["shape_pt_sequence"]), round(float(s["shape_pt_lat"]), 5),
                                   round(float(s["shape_pt_lon"]), 5)))
    lines = {k: [[a, b] for _, a, b in sorted(v)] for k, v in pts.items()}

    shapes = defaultdict(list)
    seen = defaultdict(set)
    for (rid, _d), cnt in sorted(usage.items()):
        kept = 0
        for sid, _n in cnt.most_common():
            line = lines.get(sid)
            if not line:
                continue
            key = json.dumps(line)
            if key in seen[rid]:
                continue
            seen[rid].add(key)
            shapes[rid].append(line)
            kept += 1
            if kept >= MAX_SHAPES_PER_DIR:
                break

    # representative trip per route: the one with most stop_times
    stimes = defaultdict(list)
    sched = defaultdict(list)  # trip_id -> [(seq, stop_id, arr_s, dep_s)]
    for st in rows(z, "stop_times.txt"):
        stimes[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"]))
        a, d = hms(st.get("arrival_time")), hms(st.get("departure_time"))
        a = d if a is None else a
        d = a if d is None else d
        try:
            dist = float(st.get("shape_dist_traveled") or "")
        except ValueError:
            dist = None
        sched[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"], a, d, dist))
    best = {}
    for t in trips:
        n = len(stimes.get(t["trip_id"], ()))
        if n and n > best.get(t["route_id"], (0, None))[0]:
            best[t["route_id"]] = (n, t["trip_id"])
    route_stops = {rid: [sid for _, sid in sorted(stimes[tid])] for rid, (_, tid) in best.items()}
    variants = route_variants(trips, stimes, route_stops)
    if not (routes and stops and route_stops):   # an outage page or an empty feed must not wipe web/data
        sys.exit(f"GTFS zip looks empty ({len(routes)} routes, {len(stops)} stops, {len(route_stops)} routed); "
                 "web/data left unchanged")

    # build everything first, then write: a failure part-way leaves the committed web/data/*.json intact
    out = {"routes.json": routes, "stops.json": stops, "shapes.json": dict(shapes), "route_stops.json": route_stops,
           "segments.json": {"v": 1, "routes": build_segments(trips, route_stops, sched, rows(z, "frequencies.txt"))},
           "service.json": build_service(z, trips, sched, rows(z, "frequencies.txt"), route_stops=route_stops),
           "timetable.json": build_timetable(z, trips, sched, rows(z, "frequencies.txt")),   # Directions' "Leave at"
           "meta.json": {"generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": URL}}
    for name, obj in out.items():
        dump(name, obj)
    PATTERNS.parent.mkdir(parents=True, exist_ok=True)
    PATTERNS.write_text(json.dumps({"source": URL, "routes": variants}, indent=1, ensure_ascii=False) + "\n",
                        encoding="utf-8")

    total = 0
    for p in sorted(OUT.glob("*.json")):
        sz = p.stat().st_size
        total += sz
        print(f"{p.name:18}{sz:>9} bytes")
    print(f"total {total} bytes; {len(routes)} routes, {len(stops)} stops, "
          f"{sum(len(v) for v in shapes.values())} shapes")


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Download the Passio GTFS zip and convert it to compact JSON in web/data/."""
import csv, io, json, statistics, sys, zipfile, urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

URL = "https://passio3.com/chicago/passioTransit/gtfs/google_transit.zip"
OUT = Path(__file__).resolve().parent.parent / "web" / "data"
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


def day_summary(intervals):
    """[(start,end)] for one route on one service day -> {first,last,trips,buses[24]} or None."""
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
    return {"first": spans[0][0], "last": spans[-1][1], "trips": len(iv), "buses": buses,
            "spans": [list(x) for x in spans]}


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


def build_service(z, trips, sched, freqs, today=None):
    """Per-route hours by weekday, scheduled buses per hour, calendar_dates changes in the feed window."""
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
    by_route = defaultdict(lambda: defaultdict(list))   # rid -> service_id -> [(s,e)]
    for t in trips:
        by_route[t["route_id"]][t.get("service_id", "")] += iv.get(t["trip_id"], [])

    def active(svcs, d):
        k = DAY_KEYS[d.weekday()]
        on = {s for s in svcs if s in cal and k in cal[s]["days"] and (not cal[s]["a"] or cal[s]["a"] <= d <= cal[s]["b"])}
        for s, typ in cdates.get(d, {}).items():
            if s in svcs:
                (on.add if typ == 1 else on.discard)(s)
        return on

    out = {}
    for rid, svcs in sorted(by_route.items()):
        days = {}
        for k in DAY_KEYS:
            on = [s for s in svcs if s in cal and k in cal[s]["days"]]
            days[k] = day_summary([x for s in on for x in svcs[s]])
        exc = []
        for d in sorted(cdates):
            k = DAY_KEYS[d.weekday()]
            regular = {s for s in svcs if s in cal and k in cal[s]["days"] and (not cal[s]["a"] or cal[s]["a"] <= d <= cal[s]["b"])}
            now_on = active(svcs, d)
            if now_on == regular:
                continue
            got = day_summary([x for s in now_on for x in svcs[s]])
            reg_trips = days[k]["trips"] if days[k] else 0
            e = {"date": d.isoformat(), "type": "removed" if (got["trips"] if got else 0) < reg_trips else "added", "days": k}
            e["hours"] = {"first": got["first"], "last": got["last"], "trips": got["trips"], "spans": got["spans"]} if got else None
            exc.append(e)
        out[rid] = {"days": days, "exceptions": exc}
    return {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "feed": {"start": w0.isoformat(), "end": w1.isoformat()}, "routes": out}


def dump(name, obj):
    (OUT / name).write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "straight-bussing/1.0"})
    data = urllib.request.urlopen(req, timeout=60).read()
    z = zipfile.ZipFile(io.BytesIO(data))
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
    if not (routes and stops and route_stops):   # an outage page or an empty feed must not wipe web/data
        sys.exit(f"GTFS zip looks empty ({len(routes)} routes, {len(stops)} stops, {len(route_stops)} routed); "
                 "web/data left unchanged")

    # build everything first, then write: a failure part-way leaves the committed web/data/*.json intact
    out = {"routes.json": routes, "stops.json": stops, "shapes.json": dict(shapes), "route_stops.json": route_stops,
           "segments.json": {"v": 1, "routes": build_segments(trips, route_stops, sched, rows(z, "frequencies.txt"))},
           "service.json": build_service(z, trips, sched, rows(z, "frequencies.txt")),
           "meta.json": {"generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": URL}}
    for name, obj in out.items():
        dump(name, obj)

    total = 0
    for p in sorted(OUT.glob("*.json")):
        sz = p.stat().st_size
        total += sz
        print(f"{p.name:18}{sz:>9} bytes")
    print(f"total {total} bytes; {len(routes)} routes, {len(stops)} stops, "
          f"{sum(len(v) for v in shapes.values())} shapes")


if __name__ == "__main__":
    sys.exit(main())

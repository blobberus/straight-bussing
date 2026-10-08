#!/usr/bin/env python3
"""Download the Passio GTFS zip and convert it to compact JSON in web/data/."""
import csv, io, json, statistics, sys, zipfile, urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
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

    dump("routes.json", routes)
    dump("stops.json", stops)
    dump("shapes.json", dict(shapes))
    dump("route_stops.json", route_stops)
    dump("segments.json", {"v": 1, "routes": build_segments(trips, route_stops, sched, rows(z, "frequencies.txt"))})
    dump("meta.json", {"generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                       "source": URL})

    total = 0
    for p in sorted(OUT.glob("*.json")):
        sz = p.stat().st_size
        total += sz
        print(f"{p.name:18}{sz:>9} bytes")
    print(f"total {total} bytes; {len(routes)} routes, {len(stops)} stops, "
          f"{sum(len(v) for v in shapes.values())} shapes")


if __name__ == "__main__":
    sys.exit(main())

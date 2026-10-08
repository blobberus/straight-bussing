#!/usr/bin/env python3
"""Download the Passio GTFS zip and convert it to compact JSON in web/data/."""
import csv, io, json, sys, zipfile, urllib.request
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
    for st in rows(z, "stop_times.txt"):
        stimes[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"]))
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

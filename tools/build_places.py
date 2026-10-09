#!/usr/bin/env python3
"""Build web/data/places.json: named places within a 30-minute walk of the campus shuttle stops, for instant,
private, typo-tolerant place search in the app (web/js/data/places.js). Stdlib only.

  python tools/build_places.py                 # query OpenStreetMap (Overpass API) and write web/data/places.json
  python tools/build_places.py --check         # also print a few sample lookups

Scope: "campus stops" = shuttle stops within 5 km of the campus point (the south-side network; downtown stops are
9+ km away). "30-minute walk" uses the app's walking model (80 m/min on the straight line x 1.2), so a place is
kept when it is within 2,000 m of a campus stop. Kept: anything named with an amenity / shop / tourism / leisure /
office / healthcare / craft / historic tag, named buildings (apartments, dorms, university, hotels, churches ...),
and apartment buildings that only have an address. Each place records its nearest campus stop and walking minutes.

Data: (c) OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright). The file is a derived
database under the same licence. Overpass API usage policy: a single query per build is well within limits.
"""
import argparse, json, math, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "data"
OUT = WEB_DATA / "places.json"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
UA = "StraightBussing-build/1.0 (unofficial student project; github.com/blobberus/straight-bussing)"
CAMPUS = (41.7886, -87.5987)
CAMPUS_STOP_M = 5000          # stops this close to campus are "campus stops"
WALK_M_PER_MIN, DETOUR, WALK_MIN = 80, 1.2, 30
MAX_M = WALK_MIN * WALK_M_PER_MIN / DETOUR   # 2,000 m straight line
SKIP_AMENITY = {"parking", "parking_space", "parking_entrance", "bench", "waste_basket", "bicycle_parking", "vending_machine",
                "waste_disposal", "recycling", "charging_station", "telephone", "drinking_water", "shelter", "grit_bin", "clock",
                "post_box", "loading_dock", "motorcycle_parking", "bicycle_rental", "atm", "fire_hydrant"}
BUILDINGS = "apartments|dormitory|residential|university|college|hotel|commercial|retail|church|civic|public|school|hospital|office"
KIND = {"fast_food": "Fast food", "restaurant": "Restaurant", "cafe": "Cafe", "bar": "Bar", "pub": "Pub", "supermarket": "Grocery",
        "convenience": "Convenience store", "greengrocer": "Grocery", "pharmacy": "Pharmacy", "chemist": "Pharmacy", "apartments": "Apartments",
        "dormitory": "Dorm", "residential": "Residential", "place_of_worship": "Place of worship", "fitness_centre": "Gym",
        "ice_cream": "Ice cream", "fuel": "Gas station", "department_store": "Department store", "bakery": "Bakery", "books": "Bookstore"}
STREET = {"Street": "St", "Avenue": "Ave", "Boulevard": "Blvd", "Drive": "Dr", "Road": "Rd", "Place": "Pl", "Court": "Ct", "Parkway": "Pkwy",
          "East": "E", "West": "W", "North": "N", "South": "S"}


def hav(a, b, c, d):
    p1, p2 = math.radians(a), math.radians(c)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(d - b) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def campus_stops():
    stops = json.loads((WEB_DATA / "stops.json").read_text(encoding="utf-8"))
    return [(sid, s["name"], s["lat"], s["lon"]) for sid, s in stops.items() if hav(*CAMPUS, s["lat"], s["lon"]) <= CAMPUS_STOP_M]


def overpass(query, tries=3):
    last = None
    for i in range(tries):
        url = OVERPASS[i % len(OVERPASS)]
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": query}).encode(), headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except Exception as e:  # network, 429, 504
            last = e
            time.sleep(10 * (i + 1))
    raise RuntimeError(f"Overpass failed: {last}")


def short_street(s):
    return " ".join(STREET.get(w, w) for w in (s or "").split())


def kind_of(t):
    for key in ("amenity", "shop", "tourism", "leisure", "healthcare", "office", "craft", "historic", "building"):
        v = t.get(key)
        if v and v not in ("yes", "no"):
            return KIND.get(v, v.replace("_", " ").capitalize()), v
    return "Place", ""


def build(stops):
    lats, lons = [s[2] for s in stops], [s[3] for s in stops]
    dlat, dlon = MAX_M / 111000, MAX_M / (111000 * math.cos(math.radians(CAMPUS[0])))
    bb = f"{min(lats) - dlat:.5f},{min(lons) - dlon:.5f},{max(lats) + dlat:.5f},{max(lons) + dlon:.5f}"
    sel = "".join(f'  nwr["name"]["{k}"]({bb});\n' for k in ("amenity", "shop", "tourism", "leisure", "office", "healthcare", "craft", "historic"))
    q = (f"[out:json][timeout:170];\n(\n{sel}"
         f'  nwr["name"]["building"~"^({BUILDINGS})$"]({bb});\n'
         f'  nwr["building"="apartments"]["addr:housenumber"]({bb});\n'
         f'  nwr["name"]["railway"="station"]({bb});\n);\nout center tags;')
    elements = overpass(q).get("elements", [])
    places, seen = [], set()
    for e in elements:
        t = e.get("tags") or {}
        c = e.get("center") or e
        lat, lon = c.get("lat"), c.get("lon")
        if lat is None or lon is None or t.get("amenity") in SKIP_AMENITY or t.get("shop") == "vacant":
            continue
        addr = " ".join(x for x in (t.get("addr:housenumber", ""), short_street(t.get("addr:street", ""))) if x)
        name = (t.get("name") or "").strip()
        if name.lower().startswith(("former ", "closed ")):
            continue
        if not name:
            if not addr:
                continue
            name = addr                                   # unnamed apartment building: its address is its name
        best = min(stops, key=lambda s: hav(lat, lon, s[2], s[3]))
        d = hav(lat, lon, best[2], best[3])
        if d > MAX_M:
            continue
        label, raw = kind_of(t)
        key = (name.lower(), round(lat, 3), round(lon, 3))
        if key in seen:
            continue
        seen.add(key)
        extra = " ".join(x for x in (t.get("brand", ""), t.get("alt_name", ""), t.get("short_name", ""), t.get("cuisine", "").replace(";", " "),
                                     raw.replace("_", " ")) if x and x.lower() != name.lower())
        places.append([name, label, addr if addr != name else "", round(lat, 5), round(lon, 5),
                       stops.index(best), max(1, round(d * DETOUR / WALK_M_PER_MIN)), extra])
    places.sort(key=lambda p: (p[6], p[0].lower()))
    return {"v": 1, "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "license": "ODbL 1.0, (c) OpenStreetMap contributors, https://www.openstreetmap.org/copyright",
            "about": "Named places within a 30-minute walk of campus shuttle stops. p = [name, kind, address, lat, lon, stop index, walk minutes, search terms]",
            "stops": [s[1] for s in stops], "p": places}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--min-keep", type=float, default=0.6, help="refuse to overwrite if the new file has fewer than this share of the old places")
    a = ap.parse_args(argv)
    stops = campus_stops()
    data = build(stops)
    out = Path(a.out)
    if out.exists():
        try:
            old = len(json.loads(out.read_text(encoding="utf-8")).get("p", []))
            if old and len(data["p"]) < a.min_keep * old:
                print(f"refusing to overwrite: {len(data['p'])} places vs {old} before (Overpass partial?)", file=sys.stderr)
                return 1
        except (OSError, ValueError):
            pass
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{out}: {len(data['p'])} places near {len(stops)} campus stops, {out.stat().st_size // 1024} KB")
    if a.check:
        for q in ("chipotle", "medici", "starbucks", "apartments", "trader"):
            hits = [p for p in data["p"] if q in (p[0] + " " + p[7]).lower()][:4]
            print(" ", q, "->", [(p[0], p[2], f"{p[6]} min to {data['stops'][p[5]]}") for p in hits])
    return 0


if __name__ == "__main__":
    sys.exit(main())

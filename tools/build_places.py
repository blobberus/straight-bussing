#!/usr/bin/env python3
"""Build web/data/places.json: named places within a 30-minute walk of the campus shuttle stops, for instant,
private, typo-tolerant place search in the app (web/js/data/places.js). Stdlib only.

  python tools/build_places.py                 # query OpenStreetMap (Overpass API) and write web/data/places.json
  python tools/build_places.py --check         # also print a few sample lookups
  python tools/build_places.py --save-raw r.json / --from-raw r.json   # keep / reuse the Overpass answer

Scope: "campus stops" = shuttle stops within 5 km of the campus point (the south-side network; downtown stops are
9+ km away). "30-minute walk" uses the app's walking model (80 m/min on the straight line x 1.2), so a place is
kept when it is within 2,000 m of a campus stop. Kept: anything named with an amenity / shop / tourism / leisure /
office / healthcare / craft / historic tag, named buildings of useful types (apartments, dorms, university, hotels,
churches ...), EVERY named building inside the UChicago campus box (most campus buildings are building=yes or
building=university) and anything named that the University of Chicago operates, train stations (Metra, CTA, also
railway=halt), named parking garages (not surface lots), and apartment buildings that only have an address.
Junk is dropped: utility / industrial / construction buildings, "Former ..." names, surface parking, benches ...

Search names: OSM alt_name / short_name / old_name / official_name / loc_name, plus the curated nicknames in
tools/place_aliases.json ("Reg", "Max P", "I-House", "Bart Mart" ...). Aliases are extra names for a real OSM
feature, never new places. Each place records its nearest campus stop and walking minutes.

Data: (c) OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright). The file is a derived
database under the same licence. Overpass API usage policy: a single query per build is well within limits.
"""
import argparse, json, math, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "data"
OUT = WEB_DATA / "places.json"
ALIASES = Path(__file__).resolve().parent / "place_aliases.json"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
UA = "StraightBussing-build/1.0 (unofficial student project; github.com/blobberus/straight-bussing)"
CAMPUS = (41.7886, -87.5987)
# UChicago main + medical campus, Midway, south campus to 61st St, Ratner / Max P / Campus North up to 55th St
# (south, west, north, east): every named building in here is kept.
CAMPUS_BOX = (41.7830, -87.6075, 41.7960, -87.5860)
CAMPUS_STOP_M = 5000          # stops this close to campus are "campus stops"
WALK_M_PER_MIN, DETOUR, WALK_MIN = 80, 1.2, 30
MAX_M = WALK_MIN * WALK_M_PER_MIN / DETOUR   # 2,000 m straight line
DUP_M = 150                   # same name this close = the same place (two OSM objects for one building)
SKIP_AMENITY = {"parking_space", "parking_entrance", "bench", "waste_basket", "bicycle_parking", "vending_machine",
                "waste_disposal", "recycling", "charging_station", "telephone", "drinking_water", "shelter", "grit_bin", "clock",
                "post_box", "loading_dock", "motorcycle_parking", "bicycle_rental", "atm", "fire_hydrant"}
BUILDINGS = "apartments|dormitory|residential|university|college|hotel|commercial|retail|church|civic|public|school|hospital|office"
# Named buildings that are never a destination (also inside the campus box)
JUNK_BUILDING = {"construction", "industrial", "service", "power_substation", "transformer_tower", "bunker", "roof", "shed",
                 "ruins", "train_station", "garages", "hut", "kiosk", "storage_tank", "water_tower", "greenhouse", "carport"}
GARAGE_BUILDING = {"garage", "parking", "yes"}
KIND = {"fast_food": "Fast food", "restaurant": "Restaurant", "cafe": "Cafe", "bar": "Bar", "pub": "Pub", "supermarket": "Grocery",
        "convenience": "Convenience store", "greengrocer": "Grocery", "pharmacy": "Pharmacy", "chemist": "Pharmacy", "apartments": "Apartments",
        "dormitory": "Dorm", "residential": "Residential", "place_of_worship": "Place of worship", "fitness_centre": "Gym",
        "ice_cream": "Ice cream", "fuel": "Gas station", "department_store": "Department store", "bakery": "Bakery", "books": "Bookstore",
        "parking": "Parking garage"}
STREET = {"Street": "St", "Avenue": "Ave", "Boulevard": "Blvd", "Drive": "Dr", "Road": "Rd", "Place": "Pl", "Court": "Ct", "Parkway": "Pkwy",
          "East": "E", "West": "W", "North": "N", "South": "S"}
NAME_TAGS = ("alt_name", "short_name", "old_name", "official_name", "loc_name", "name:en")


def hav(a, b, c, d):
    p1, p2 = math.radians(a), math.radians(c)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(d - b) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def campus_stops():
    stops = json.loads((WEB_DATA / "stops.json").read_text(encoding="utf-8"))
    return [(sid, s["name"], s["lat"], s["lon"]) for sid, s in stops.items() if hav(*CAMPUS, s["lat"], s["lon"]) <= CAMPUS_STOP_M]


def overpass(query, tries=4):
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


def in_box(lat, lon, box=CAMPUS_BOX):
    return box[0] <= lat <= box[2] and box[1] <= lon <= box[3]


def is_station(t):
    return t.get("railway") in ("station", "halt") or t.get("public_transport") == "station"


def kind_of(t):
    """(label shown in the app, raw OSM value used as a search term)."""
    if is_station(t) and not t.get("amenity"):
        net = (t.get("network") or t.get("operator") or "")
        return ("Metra station" if "Metra" in net else "CTA station" if "CTA" in net or "Chicago Transit" in net else "Train station"), "station"
    for key in ("amenity", "shop", "tourism", "leisure", "healthcare", "office", "craft", "historic", "building"):
        v = t.get(key)
        if v and v not in ("yes", "no"):
            return KIND.get(v, v.replace("_", " ").capitalize()), v
    if t.get("building") and (t.get("operator") or "").find("University of Chicago") >= 0:
        return "University", "university"
    return "Place", ""


def keep(t, lat, lon):
    """Is this element a destination? (named / address-only filters happen in build())."""
    a, b = t.get("amenity"), t.get("building")
    if a in SKIP_AMENITY or t.get("shop") == "vacant":
        return False
    if a == "parking":                     # garages yes, surface lots no
        return bool(t.get("name")) and (t.get("parking") in ("multi-storey", "underground") or b in GARAGE_BUILDING)
    if b in JUNK_BUILDING and not any(t.get(k) for k in ("amenity", "shop", "tourism", "leisure", "office", "healthcare")):
        return False
    if t.get("railway") in ("station", "halt") or t.get("public_transport") == "station":
        return t.get("railway") != "facility"
    return True


def query(bb):
    cb = f"{CAMPUS_BOX[0]},{CAMPUS_BOX[1]},{CAMPUS_BOX[2]},{CAMPUS_BOX[3]}"
    sel = "".join(f'  nwr["name"]["{k}"]({bb});\n' for k in ("amenity", "shop", "tourism", "leisure", "office", "healthcare", "craft", "historic"))
    return (f"[out:json][timeout:170];\n(\n{sel}"
            f'  nwr["name"]["building"~"^({BUILDINGS})$"]({bb});\n'
            f'  nwr["name"]["building"]({cb});\n'
            f'  nwr["name"]["operator"~"University of Chicago"]({bb});\n'
            f'  nwr["building"="apartments"]["addr:housenumber"]({bb});\n'
            f'  nwr["name"]["railway"~"^(station|halt)$"]({bb});\n'
            f'  nwr["name"]["public_transport"="station"]({bb});\n);\nout center tags;')


def osm_key(e):
    return e["type"][0] + str(e["id"])


def load_aliases(path=ALIASES):
    """{'w150456352': {'name':..., 'aliases':[...], 'kind'?:...}} from tools/place_aliases.json."""
    if not Path(path).exists():
        return {}
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    out = {}
    for a in data.get("places", []):
        k = re.sub(r"^(node|way|relation)/", lambda m: m.group(1)[0], a["osm"])
        out[k] = a
    return out


def alt_names(t, name):
    seen, out = {name.lower()}, []
    for k in NAME_TAGS:
        for v in (t.get(k) or "").split(";"):
            v = v.strip()
            if v and v.lower() not in seen and not v.lower().startswith(("sp plus",)):
                seen.add(v.lower()); out.append(v)
    return out


def build(stops, elements, aliases):
    places, found, by_name = [], set(), {}
    # better objects first, so duplicates (same name within DUP_M) keep the most informative one
    rank = lambda e: (0 if any((e.get("tags") or {}).get(k) for k in ("amenity", "shop", "tourism", "leisure")) else 1, e["type"] != "way")
    for e in sorted(elements, key=rank):
        t = e.get("tags") or {}
        c = e.get("center") or e
        lat, lon = c.get("lat"), c.get("lon")
        if lat is None or lon is None or not keep(t, lat, lon):
            continue
        b, op = t.get("building"), t.get("operator") or ""
        if b and not re.fullmatch(BUILDINGS, b) and not (t.get("amenity") or t.get("shop") or t.get("tourism") or t.get("leisure")
                                                          or t.get("office") or t.get("healthcare") or t.get("craft") or t.get("historic")
                                                          or is_station(t) or b == "apartments"):
            if not (in_box(lat, lon) or "University of Chicago" in op):
                continue                                  # a named building=yes far from campus: not kept (as before)
        addr = " ".join(x for x in (t.get("addr:housenumber", ""), short_street(t.get("addr:street", ""))) if x)
        name = (t.get("name") or "").strip()
        if name.lower().startswith(("former ", "closed ")):
            continue
        if not name:
            if not addr or b != "apartments":
                continue
            name = addr                                   # unnamed apartment building: its address is its name
        best = min(stops, key=lambda s: hav(lat, lon, s[2], s[3]))
        d = hav(lat, lon, best[2], best[3])
        if d > MAX_M:
            continue
        cur = aliases.get(osm_key(e))
        names = alt_names(t, name)
        if cur:
            found.add(osm_key(e))
            if cur.get("label") and cur["label"] != name:
                names, name = ([] if cur.get("drop_name") else [name]) + names, cur["label"]
            names += [a for a in cur.get("aliases", []) if a.lower() not in {n.lower() for n in names + [name]}]
        dup = next((p for p in by_name.get(name.lower(), []) if hav(lat, lon, p[3], p[4]) < DUP_M), None)
        if dup:                                           # same place mapped twice: keep the first, add its names
            more = [n for n in names if n.lower() not in {x.lower() for x in [dup[0]] + (dup[8] if len(dup) > 8 else [])}]
            if more:
                if len(dup) == 8:
                    dup.append([])
                dup[8] += more
            if cur and cur.get("kind"):
                dup[1] = cur["kind"]
            continue
        label, raw = kind_of(t)
        if cur:
            label = cur.get("kind", label)
        net = " ".join(x for x in (t.get("network", ""), "train" if is_station(t) else "") if x).replace(";", " ")
        extra = " ".join(x for x in (t.get("brand", ""), t.get("cuisine", "").replace(";", " "), raw.replace("_", " "), net)
                         if x and x.lower() != name.lower())
        row = [name, label, addr if addr != name else "", round(lat, 5), round(lon, 5),
               stops.index(best), max(1, round(d * DETOUR / WALK_M_PER_MIN)), extra]
        if names:
            row.append(names)
        places.append(row)
        by_name.setdefault(name.lower(), []).append(row)
    missing = [f"{k} {a.get('name')}" for k, a in aliases.items() if k not in found]
    places.sort(key=lambda p: (p[6], p[0].lower()))
    return {"v": 2, "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "license": "ODbL 1.0, (c) OpenStreetMap contributors, https://www.openstreetmap.org/copyright",
            "about": "Named places within a 30-minute walk of campus shuttle stops. p = [name, kind, address, lat, lon, stop index, "
                     "walk minutes, search terms, other names?] (other names: OSM alt/short/old names + tools/place_aliases.json)",
            "stops": [s[1] for s in stops], "p": places}, missing


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--save-raw", help="also write the raw Overpass answer here")
    ap.add_argument("--from-raw", help="use a saved Overpass answer instead of querying")
    ap.add_argument("--min-keep", type=float, default=0.6, help="refuse to overwrite if the new file has fewer than this share of the old places")
    a = ap.parse_args(argv)
    stops = campus_stops()
    lats, lons = [s[2] for s in stops], [s[3] for s in stops]
    dlat, dlon = MAX_M / 111000, MAX_M / (111000 * math.cos(math.radians(CAMPUS[0])))
    bb = f"{min(lats) - dlat:.5f},{min(lons) - dlon:.5f},{max(lats) + dlat:.5f},{max(lons) + dlon:.5f}"
    if a.from_raw:
        raw = json.loads(Path(a.from_raw).read_text(encoding="utf-8"))
    else:
        raw = overpass(query(bb))
        if a.save_raw:
            Path(a.save_raw).write_text(json.dumps(raw), encoding="utf-8")
    data, missing = build(stops, raw.get("elements", []), load_aliases())
    for m in missing:
        print("alias target not found in OSM answer:", m, file=sys.stderr)
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
    print(f"{out}: {len(data['p'])} places near {len(stops)} campus stops, {out.stat().st_size // 1024} KB, {len(missing)} alias targets missing")
    if a.check:
        for q in ("chipotle", "medici", "starbucks", "apartments", "trader", "regenstein", "metra"):
            hits = [p for p in data["p"] if q in (p[0] + " " + p[7] + " " + " ".join(p[8] if len(p) > 8 else [])).lower()][:4]
            print(" ", q, "->", [(p[0], p[2], f"{p[6]} min to {data['stops'][p[5]]}") for p in hits])
    return 0


if __name__ == "__main__":
    sys.exit(main())

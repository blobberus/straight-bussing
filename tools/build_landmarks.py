#!/usr/bin/env python3
"""Build web/data/landmarks.json: the building and place names the map shows by default (owner request 2026-10-13:
"the buildings on the maps should also have their names like Google maps. Not every building, but highly trafficked
ones and prominent off campus locations relevant to the bus coverage", and "UChicago dorm buildings"). Stdlib only.

  python tools/build_landmarks.py            # resolve tools/landmarks.json and write web/data/landmarks.json
  python tools/build_landmarks.py --check    # resolve and validate only (exit 1 on a problem), write nothing

The list is curated in tools/landmarks.json (label, tier, kind; order = priority within a tier). Coordinates are never
typed in by hand: each entry names its OpenStreetMap feature ("osm" = the exact name in web/data/places.json, which
tools/build_places.py derives from OSM), or, for the few places outside that file (downtown), an explicit OSM object
("ref" way/123 or node/123 with its lat/lon as OSM gives them). An entry that resolves to nothing is an error.

Checks: tier 1-3; no dash characters a screen would show (U+2013, U+2014); every label within COVER_M of a shuttle
stop (relevant to the bus coverage); no two labels within DUP_M of each other.

Output: {"v": 1, "generated", "license", "about", "l": [[label, lat, lon, tier, kind, osm_name, until?], ...]} sorted by
tier, then list order (the map's collision priority); until (optional) = the zoom from which the label hides (a group
name such as "Max Palevsky Commons" that splits into its buildings, a higher tier, when you zoom in). Data: (c) OpenStreetMap contributors, ODbL 1.0.
"""
import argparse, json, math, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "data"
SRC = Path(__file__).resolve().parent / "landmarks.json"
OUT = WEB_DATA / "landmarks.json"
COVER_M = 800        # a label this far from every shuttle stop is not "relevant to the bus coverage"
DUP_M = 15           # two labels this close would sit on top of each other
KINDS = {"library", "hub", "dorm", "dining", "academic", "medical", "arts", "sports", "shop", "transit", "landmark"}
DASHES = ("–", "—")


def hav(a, b, c, d):
    r = math.pi / 180
    x = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(x))


def load_places(path=WEB_DATA / "places.json"):
    """OSM name (lower case) -> [(name, lat, lon), ...] from places.json (p = [name, kind, address, lat, lon, ...])."""
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    out = {}
    for p in d.get("p", []):
        out.setdefault(str(p[0]).strip().lower(), []).append((p[0], float(p[3]), float(p[4])))
    return out


def load_stops(path=WEB_DATA / "stops.json"):
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    return [(s["name"], float(s["lat"]), float(s["lon"])) for s in d.values()]


def resolve(entries, places, stops):
    """Resolved rows + problems (a non-empty problem list means: do not write)."""
    rows, problems = [], []
    for i, e in enumerate(entries):
        label, osm, tier, kind = e.get("label"), e.get("osm"), e.get("tier"), e.get("kind")
        where = f"#{i + 1} {label!r}"
        if not label or not osm:
            problems.append(f"{where}: needs label and osm"); continue
        if any(ch in label for ch in DASHES):
            problems.append(f"{where}: dash character in the label")
        if tier not in (1, 2, 3):
            problems.append(f"{where}: tier must be 1, 2 or 3")
        if kind not in KINDS:
            problems.append(f"{where}: unknown kind {kind!r}")
        if e.get("ref"):
            if not str(e["ref"]).startswith(("node/", "way/", "relation/")) or "lat" not in e or "lon" not in e:
                problems.append(f"{where}: ref needs node/ way/ relation/ plus the lat and lon OSM gives"); continue
            lat, lon = float(e["lat"]), float(e["lon"])
        else:
            hits = places.get(str(osm).strip().lower(), [])
            if not hits:
                problems.append(f"{where}: no OSM feature named {osm!r} in places.json"); continue
            if len(hits) > 1 and max(hav(hits[0][1], hits[0][2], h[1], h[2]) for h in hits) > 150:
                problems.append(f"{where}: {len(hits)} OSM features named {osm!r} far apart; use a more exact name or a ref"); continue
            lat, lon = hits[0][1], hits[0][2]
        near = min((hav(lat, lon, s[1], s[2]), s[0]) for s in stops) if stops else (0, "")
        if near[0] > COVER_M:
            problems.append(f"{where}: {near[0]:.0f} m from the nearest stop ({near[1]}): outside the bus coverage")
        until = e.get("until")
        if until is not None and not (isinstance(until, (int, float)) and until > {1: 14.5, 2: 16, 3: 17}.get(tier, 99)):
            problems.append(f"{where}: until must be a zoom above the tier's first zoom")
        rows.append([label, round(lat, 6), round(lon, 6), tier, kind, osm, i, until])
    for a in range(len(rows)):
        for b in range(a + 1, len(rows)):
            if rows[a][7] is not None or rows[b][7] is not None:
                continue   # a group name may sit on one of its buildings: it hides before they show
            if hav(rows[a][1], rows[a][2], rows[b][1], rows[b][2]) < DUP_M:
                problems.append(f"{rows[a][0]!r} and {rows[b][0]!r} are within {DUP_M} m")
    seen = set()
    for r in rows:
        if r[0].lower() in seen:
            problems.append(f"label {r[0]!r} twice")
        seen.add(r[0].lower())
    rows.sort(key=lambda r: (r[3], r[6]))
    return [r[:6] + ([r[7]] if r[7] is not None else []) for r in rows], problems


def build(src=SRC, places_path=WEB_DATA / "places.json", stops_path=WEB_DATA / "stops.json"):
    cur = json.loads(Path(src).read_text(encoding="utf-8"))
    return resolve(cur.get("l", []), load_places(places_path), load_stops(stops_path))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="validate only, write nothing")
    a = ap.parse_args(argv)
    rows, problems = build()
    for p in problems:
        print("problem:", p)
    if problems:
        return 1
    tiers = {t: sum(1 for r in rows if r[3] == t) for t in (1, 2, 3)}
    print(f"{len(rows)} labels: tier 1 {tiers[1]}, tier 2 {tiers[2]}, tier 3 {tiers[3]}")
    if a.check:
        return 0
    out = {"v": 1, "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "license": "Data (c) OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
           "about": "Map labels shown by default (tools/landmarks.json, tools/build_landmarks.py). l = [label, lat, lon, tier, kind, osm name, until?]; "
                    "tier 1 from zoom 14.5, 2 from 16, 3 from 17; until = hidden from that zoom on; order = priority.",
           "l": rows}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("wrote", OUT.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())

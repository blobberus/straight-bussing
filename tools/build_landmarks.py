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

Easter eggs (owner 2026-10-14): easter-eggs.json at the repo root maps an address (or "place name, address") to a
nickname the map shows instead of the label once you zoom in to its "zoom". Output "eggs": [[row index, nickname], ...]
and "egg_zoom". A place with no label yet gets a tier 3 one (its OSM name) at the end. A bad egg is reported and
skipped (the labels are still written; --check fails), so a typo in that file never costs the map its names.
"""
import argparse, json, math, re, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "data"
SRC = Path(__file__).resolve().parent / "landmarks.json"
EGGS = ROOT / "easter-eggs.json"
OUT = WEB_DATA / "landmarks.json"
COVER_M = 800        # a label this far from every shuttle stop is not "relevant to the bus coverage"
DUP_M = 15           # two labels this close would sit on top of each other
KINDS = {"library", "hub", "dorm", "housing", "dining", "academic", "medical", "arts", "sports", "shop", "transit", "landmark"}   # housing = off-campus apartments many students live in (Vue53)
DASHES = ("–", "—")
EGG_Z = (16, 18)     # the nickname zoom must be one the map reaches (the web map stops at 18)
EGG_TIER = 3         # a nicknamed place without a label gets one from this tier (the last: rows stay sorted)
EGG_MAX = 40         # characters
EGG_KIND = {"fast food": "dining", "restaurant": "dining", "cafe": "dining", "bar": "dining", "library": "library",
            "dorm": "dorm", "apartments": "housing", "residential": "housing", "museum": "landmark", "grocery": "shop"}
_ADDR = {"street": "st", "avenue": "ave", "av": "ave", "boulevard": "blvd", "drive": "dr", "place": "pl", "road": "rd",
         "court": "ct", "parkway": "pkwy", "east": "e", "west": "w", "north": "n", "south": "s"}


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


def norm_addr(s):
    """'1522 East 53rd Street.' -> '1522 e 53rd st' (case, punctuation, the common long words)."""
    return " ".join(_ADDR.get(w, w) for w in re.sub(r"[^\w\s-]", " ", str(s).lower()).split())


def load_place_rows(path=WEB_DATA / "places.json"):
    """[(name, kind, address, lat, lon), ...] from places.json."""
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    return [(str(p[0]), str(p[1]), str(p[2]), float(p[3]), float(p[4])) for p in d.get("p", [])]


def find_place(key, places):
    """An easter egg's key -> (place, None) or (None, why). key = an address, a place name, or "place name, address"
    (two places at one address); place = (name, kind, address, lat, lon)."""
    k = str(key).strip()
    named = [p for p in places if p[0].lower() == k.lower()]
    if len(named) == 1:
        return named[0], None
    name, _, addr = k.partition(",")
    for want, at in ((None, k), (name.strip(), addr.strip())) if addr.strip() else ((None, k),):
        hits = [p for p in places if norm_addr(p[2]) == norm_addr(at)]
        if want:
            hits = [p for p in hits if want.lower() in p[0].lower()]
        if len(hits) == 1:
            return hits[0], None
        if len(hits) > 1:
            return None, (f"{len(hits)} places at {at!r} ({', '.join(sorted(p[0] for p in hits))}): "
                          f"write \"Place name, {at}\"")
    if named:
        return None, f"{len(named)} places named {k!r}: write its address instead"
    return None, f"no place with the address or name {k!r} in web/data/places.json (the map's place search)"


def resolve_eggs(doc, rows, places, stops):
    """easter-eggs.json + resolve()'s rows -> (rows, eggs [[row index, nickname]], zoom, problems). Rows of a place
    (its OSM name) all take the nickname; a place without a label gets a tier 3 row at the end."""
    if not isinstance(doc, dict):
        return rows, [], None, ["easter-eggs.json: not a JSON object"]
    problems, zoom = [], doc.get("zoom", 17.5)
    if isinstance(zoom, bool) or not isinstance(zoom, (int, float)) or not EGG_Z[0] <= zoom <= EGG_Z[1]:
        problems.append(f"easter-eggs.json: zoom must be a number from {EGG_Z[0]} to {EGG_Z[1]} (17.5 used)")
        zoom = 17.5
    names = doc.get("names", {})
    if not isinstance(names, dict):
        return rows, [], None, problems + ['easter-eggs.json: names must be "address": "name" lines inside { }']
    rows, eggs = [list(r) for r in rows], {}
    for key, nick in names.items():
        where = f"easter egg {key!r}"
        nick = nick.strip() if isinstance(nick, str) else ""
        if not nick:
            problems.append(f"{where}: needs a name in quotes"); continue
        if any(ch in nick for ch in DASHES) or len(nick) > EGG_MAX:
            problems.append(f"{where}: {nick!r} has a dash character or is over {EGG_MAX} characters"); continue
        place, why = find_place(key, places)
        if not place:
            problems.append(f"{where}: {why}"); continue
        pname, kind, _, lat, lon = place
        idx = [i for i, r in enumerate(rows) if r[5].lower() == pname.lower()]
        if not idx:
            near = min(hav(lat, lon, s[1], s[2]) for s in stops) if stops else 0
            clash = [r[0] for r in rows if hav(lat, lon, r[1], r[2]) < DUP_M]
            if near > COVER_M or clash:
                problems.append(f"{where}: {pname} is " + (f"{near:.0f} m from every stop" if near > COVER_M
                                                           else f"within {DUP_M} m of the label {clash[0]!r}")); continue
            rows.append([pname, round(lat, 6), round(lon, 6), EGG_TIER, EGG_KIND.get(kind.lower(), "landmark"), pname])
            idx = [len(rows) - 1]
        for i in idx:
            eggs[i] = nick
    return rows, [[i, eggs[i]] for i in sorted(eggs)], zoom, problems


def build(src=SRC, places_path=WEB_DATA / "places.json", stops_path=WEB_DATA / "stops.json"):
    cur = json.loads(Path(src).read_text(encoding="utf-8"))
    return resolve(cur.get("l", []), load_places(places_path), load_stops(stops_path))


def build_eggs(rows, eggs_path=EGGS, places_path=WEB_DATA / "places.json", stops_path=WEB_DATA / "stops.json"):
    """-> (rows, eggs, zoom, problems); no easter-eggs.json = no eggs. Bad JSON is one problem (with its line)."""
    p = Path(eggs_path)
    if not p.exists():
        return rows, [], None, []
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except ValueError as e:
        return rows, [], None, [f"{p.name} is not valid JSON ({e}); a missing comma or quote?"]
    return resolve_eggs(doc, rows, load_place_rows(places_path), load_stops(stops_path))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="validate only, write nothing")
    a = ap.parse_args(argv)
    rows, problems = build()
    for p in problems:
        print("problem:", p)
    if problems:
        return 1
    rows, eggs, egg_zoom, egg_problems = build_eggs(rows)
    for p in egg_problems:
        print("easter egg problem (skipped):", p)
    tiers = {t: sum(1 for r in rows if r[3] == t) for t in (1, 2, 3)}
    print(f"{len(rows)} labels: tier 1 {tiers[1]}, tier 2 {tiers[2]}, tier 3 {tiers[3]}; "
          + (f"{len(eggs)} easter egg name(s) from zoom {egg_zoom}" if eggs else "no easter eggs"))
    if a.check:
        return 1 if egg_problems else 0
    out = {"v": 1, "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "license": "Data (c) OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
           "about": "Map labels shown by default (tools/landmarks.json, tools/build_landmarks.py). l = [label, lat, lon, tier, kind, osm name, until?]; "
                    "tier 1 from zoom 14.5, 2 from 16, 3 from 17; until = hidden from that zoom on; order = priority. "
                    "eggs = [[index in l, nickname]] shown instead of the label from egg_zoom on (easter-eggs.json).",
           "l": rows}
    if eggs:
        out.update(eggs=eggs, egg_zoom=egg_zoom)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("wrote", OUT.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())

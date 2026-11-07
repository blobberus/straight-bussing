#!/usr/bin/env python3
"""E27c (2026-11-07): the streets each route's buses really drive, learned from their GPS (web/data/corridors.json), and
the off-route rule measured against them. Owner: "the buses that are not driving on their designated routes are still
showing sometimes (for example, the downtown connector still shows even if its not on its route)."

Why: E27b (core/offroute.js, 2026-11-06) measures a bus's distance to its route's DRAWN line (shapes.json). The drawn
line is wrong in places: the Downtown Campus Connector's line turns east at Van Buren while every bus goes north on
Canal to Adams (Union Station) and then east, 125 to 340 m off the line on every lap, so E27b needed 250 m and still
blinked there; with 250 m everything within a block or two of a line stays shown (DCC buses parked on 60th Street, at
Cottage Grove, inside the campus, on garage roads).

THE DRIVEN CORRIDOR (learned): in-service movement = a bus's consecutive reports at most MAX_DT_S apart, both with a
logged arrival on its route at most IN_MIN before and after (data branch arrivals.csv), the segment between them
rasterized every 10 m into CELL_M cells. A cell is kept when its 3 x 3 neighborhood was driven in service on at least
DAYS_FRAC of the route's service days and by at least LAP_SHARE of all its laps (passes / (days x laps per day; laps
per day = the 75th percentile of a stop's arrivals per day, median over days)), and the cell is CORR_MIN_M to
CORR_MAX_M from the drawn line (nearer: the line covers it; farther: another path, like the Apostolic 8 AM run to the
57th Street Metra station, an off-line service run the owner has not decided on: it stays hidden as in E27b).
corridors.json keeps each route's cell centers with the signature of the drawn line they were learned against (points,
length) and valid_until (45 days after the last learned day); the app ignores a route whose line changed.

THE RULE (core/offroute.js, Kit OffRoute.swift; replayed here report by report like a phone would see it):
  distance = to the drawn line or a corridor point, whichever is nearer
  FAR   farther than 250 m for 45 s on >= 2 distinct reports (E27b)
  FAST  farther than 500 m on 2 distinct reports in a row: hidden at once (no 45 s: after a reload or app start)
  NEAR  farther than 120 m for 120 s on >= 2 reports, only for routes with a valid corridor entry
  an operator detour alert (E27b) exempts a bus only within 3 km of its route

  python experiments/routeknower/E27-scripts/corridor.py --cache reports.pkl --dl <gtfs dir> --arrivals arrivals.csv
      --write web/data/corridors.json          # learn on every day in the cache, write the app's file
      --eval [--split 2026-11-01]              # E27b vs E27c; --split: learn before the date, score from it
The cache is offroute.py --cache (the per-report table); --dl holds gtfs-<day>.zip (offroute.zip_for).
"""
import argparse, bisect, csv, json, math, pickle, sys, tempfile
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import offroute as O   # noqa: E402
import offroute_rules as OR   # noqa: E402

CELL_M = 25.0
STEP_M = 10.0
MAX_DT_S = 40
MAX_SEG_M = 400
IN_MIN = 20
DAYS_FRAC = 2 / 3
MIN_DAYS = 5
LAP_SHARE = 0.05
CORR_MIN_M = 80
CORR_MAX_M = 400
VALID_DAYS = 45
PAD_S = 1800
GAP_S = 600
RULE = dict(far_m=250, far_s=45, fast_m=500, near_m=120, near_s=120, detour_max_m=3000)


# ---------------------------------------------------------------- inputs
def load_reports(cache):
    allrep, stats, stop_offs, days = pickle.loads(Path(cache).read_bytes())
    allrep.sort(key=lambda r: (r["veh"], r["t"]))
    for r, s in zip(allrep, O.step_s(allrep)):
        r["step"] = s
        r["shown_op"] = not (r["gap"] > 0 and not r["pred"])   # core/operating.js shows it
    return allrep, days


def arrival_gaps(allrep, arr):
    """Minutes since the bus's last arrival on its route and to its next one (inf beyond 60 min)."""
    for r in allrep:
        lst = arr.get(r["veh"], [])
        i = bisect.bisect_left(lst, (r["t"], "", "", ""))
        prev = nxt = math.inf
        j = i - 1
        while j >= 0 and r["t"] - lst[j][0] <= 3600:
            if lst[j][1] == r["rid"]:
                prev = (r["t"] - lst[j][0]) / 60
                break
            j -= 1
        j = i
        while j < len(lst) and lst[j][0] - r["t"] <= 3600:
            if lst[j][1] == r["rid"]:
                nxt = (lst[j][0] - r["t"]) / 60
                break
            j += 1
        r["prev_arr"], r["next_arr"] = prev, nxt


def laps_per_day(path):
    cnt = defaultdict(Counter)
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                t = int(r["epoch"])
            except ValueError:
                continue
            cnt[(r["route_id"], OR.service_day(t))][r["stop_id"]] += 1
    per = defaultdict(list)
    for (rid, _), c in cnt.items():
        v = sorted(c.values())
        per[rid].append(v[int(0.75 * (len(v) - 1))])
    return {rid: float(np.median(v)) for rid, v in per.items()}


# ---------------------------------------------------------------- learning
def cell_of(x, y):
    return int(math.floor(x / CELL_M)), int(math.floor(y / CELL_M))


def center_xy(c):
    return (c[0] + 0.5) * CELL_M, (c[1] + 0.5) * CELL_M


def same_line(a, b, tol_m=10.0):
    """Two drawings of a route's line are the same path (every vertex of each within tol_m of the other's segments):
    Passio sometimes re-samples a line without moving it (Apostolic, Oct 26)."""
    if not a or not b:
        return False
    sa, sb = O.segs_of(a), O.segs_of(b)
    pa = np.concatenate([O.xy([p[0] for p in l], [p[1] for p in l]) for l in a])
    pb = np.concatenate([O.xy([p[0] for p in l], [p[1] for p in l]) for l in b])
    return bool(O.dist_to_segs(pa, sb).max() <= tol_m and O.dist_to_segs(pb, sa).max() <= tol_m)


def same_line_days(dl, days):
    """{rid: set(service days)} on which the route's drawn line was the last day's one (core/offroute.js only uses a
    corridor while the app's line matches the one it was learned against), and the last day's static data."""
    cache = Path(tempfile.gettempdir()) / "sb-e27-static"
    last = O.build_static(O.zip_for(dl, days[-1]), cache)
    out = defaultdict(set)
    seen = {}
    for day in days:
        st = O.build_static(O.zip_for(dl, day), cache)
        for rid, lines in last["shapes"].items():
            k = (st["version"], rid)
            if k not in seen:
                seen[k] = same_line(st["shapes"].get(rid), lines)
            if seen[k]:
                out[rid].add(day)
    return out, last


def learn(allrep, sel, laps, segs_of_route):
    """{rid: set(cells)} for the routes with at least MIN_DAYS service days in `sel` (absent = not learned); `sel` also
    leaves out the days a route's drawn line was not the final one (same_line_days)."""
    passes = defaultdict(lambda: defaultdict(set))
    rdays = defaultdict(set)
    prev = None
    for r in allrep:
        ok = sel(r) and r["prev_arr"] <= IN_MIN and r["next_arr"] <= IN_MIN
        if ok:
            rdays[r["rid"]].add(OR.service_day(r["t"]))
        if ok and prev is not None and prev["ok"] and prev["veh"] == r["veh"] and prev["rid"] == r["rid"] \
                and r["t"] - prev["t"] <= MAX_DT_S and (r["d"] > 40 or prev["d"] > 40):
            (x0, y0), (x1, y1) = O.xy(prev["lat"], prev["lon"]), O.xy(r["lat"], r["lon"])
            L = math.hypot(x1 - x0, y1 - y0)
            if L <= MAX_SEG_M:
                k = max(1, int(L // STEP_M))
                key = (r["veh"], OR.service_day(r["t"]), prev["t"] // 900)
                for i in range(k + 1):
                    passes[r["rid"]][cell_of(x0 + (x1 - x0) * i / k, y0 + (y1 - y0) * i / k)].add(key)
        prev = {"veh": r["veh"], "rid": r["rid"], "t": r["t"], "lat": r["lat"], "lon": r["lon"], "d": r["d"], "ok": ok}
    out = {}
    for rid, days in rdays.items():
        nd, L = len(days), laps.get(rid, 0)
        if nd < MIN_DAYS or not L:
            continue
        cells = passes.get(rid, {})
        keep = []
        for (cx, cy) in cells:
            u = set()
            for i in (-1, 0, 1):
                for j in (-1, 0, 1):
                    u |= cells.get((cx + i, cy + j), set())
            if len({p[1] for p in u}) >= max(MIN_DAYS, DAYS_FRAC * nd) and len(u) / (nd * L) >= LAP_SHARE:
                keep.append((cx, cy))
        segs = segs_of_route(rid)
        if keep and segs is not None:
            d = O.dist_to_segs(np.array([center_xy(c) for c in keep]), segs)
            keep = [c for c, x in zip(keep, d) if CORR_MIN_M < x <= CORR_MAX_M]
        out[rid] = set(keep)
    return out


def corridor_distance(allrep, corr, line_days):
    """dc (distance to the nearest corridor point, inf beyond 400 m or none) and de = min(d, dc) on every report;
    learned = the route has a corridor and that day's line is the one it was learned against (else E27b, like the app)."""
    idx = {}
    for rid, cells in corr.items():
        b = defaultdict(list)
        for c in cells:
            px, py = center_xy(c)
            b[(int(px // 400), int(py // 400))].append((px, py))
        idx[rid] = b
    for r in allrep:
        best = math.inf
        if r["d"] > 60 and r["rid"] in idx:
            x, y = (float(v) for v in O.xy(r["lat"], r["lon"]))
            b, kx, ky = idx[r["rid"]], int(x // 400), int(y // 400)
            for i in (-1, 0, 1):
                for j in (-1, 0, 1):
                    for px, py in b.get((kx + i, ky + j), ()):
                        best = min(best, (px - x) ** 2 + (py - y) ** 2)
            best = math.sqrt(best)
        r["dc"] = best
        r["de"] = min(r["d"], best)
        r["learned"] = r["rid"] in corr and OR.service_day(r["t"]) in line_days.get(r["rid"], ())
        if not r["learned"]:
            r["dc"], r["de"] = math.inf, r["d"]


# ---------------------------------------------------------------- replay
def runs(allrep):
    i, n = 0, len(allrep)
    while i < n:
        j = i + 1
        while j < n and allrep[j]["veh"] == allrep[i]["veh"] and allrep[j]["rid"] == allrep[i]["rid"] and allrep[j]["t"] - allrep[j - 1]["t"] <= GAP_S:
            j += 1
        yield i, j
        i = j


def replay(allrep, rule, key="de"):
    """Hidden flag per report. rule: far_m, far_s, fast_m?, near_m?, near_s?, detour_max_m? (None = off)."""
    out = [False] * len(allrep)
    for i, j in runs(allrep):
        far = near = None
        nfast = 0
        for k in range(i, j):
            r = allrep[k]
            d = r[key]
            far = (far or {"since": r["t"], "n": 0}) if d > rule["far_m"] else None
            if far: far["n"] += 1
            use_near = rule.get("near_m") is not None and r.get("learned")
            near = (near or {"since": r["t"], "n": 0}) if use_near and d > rule["near_m"] else None
            if near: near["n"] += 1
            nfast = nfast + 1 if rule.get("fast_m") and d > rule["fast_m"] else 0
            hide = (far is not None and far["n"] >= 2 and r["t"] - far["since"] >= rule["far_s"]) or \
                   (near is not None and near["n"] >= 2 and r["t"] - near["since"] >= rule["near_s"]) or nfast >= 2
            if hide and r["alert"] and r["gap"] <= PAD_S and (rule.get("detour_max_m") is None or d <= rule["detour_max_m"]):
                hide = False
            out[k] = hide
    return out


def score(allrep, hid, sel):
    """Bus-minutes (only reports core/operating.js shows): hidden, hidden while in service (an arrival on its route
    <= 15 min before and <= 20 min after = mid), within 2 min of an arrival, in the 10 min before its next arrival;
    blinks (hidden, then back within 5 min); shown while visibly off the drawn line (> 40 / > 100 m) and not mid; shown
    > 100 m off on another route's line; shown farther than 250 m (waiting the clock)."""
    res = Counter()
    hides, cur, prev = [], None, None
    for r, h in zip(allrep, hid):
        if prev is None or prev["veh"] != r["veh"] or prev["rid"] != r["rid"] or r["t"] - prev["t"] > GAP_S:
            if cur: hides.append(cur)
            cur = None
        prev = r
        if not sel(r) or not r["shown_op"]:
            continue
        s, mid = r["step"] / 60, r["prev_arr"] <= 15 and r["next_arr"] <= 20
        if h:
            res["hidden"] += s
            res["hidden_mid"] += s if mid else 0
            res["hidden_serving2"] += s if (r["prev_arr"] <= 2 or r["next_arr"] <= 2) else 0
            res["hidden_next10"] += s if r["next_arr"] <= 10 else 0
            if cur is None:
                cur = {"a": r["t"], "mid": mid, "back": False}
            cur["b"] = r["t"]
            continue
        if cur:
            cur["back"], cur["b"] = True, r["t"]
            hides.append(cur)
            cur = None
        res["shown_off40_notmid"] += s if r["d"] > 40 and not mid else 0
        res["shown_off100_notmid"] += s if r["d"] > 100 and not mid else 0
        res["shown_off100_mid"] += s if r["d"] > 100 and mid else 0
        res["shown_off100_other_line"] += s if r["d"] > 100 and r["da"] <= 40 else 0
        res["shown_far_250"] += s if r["de"] > 250 else 0
    if cur:
        hides.append(cur)
    short = [h for h in hides if h["back"] and h["b"] - h["a"] < 300]
    out = {k: round(v, 1) for k, v in sorted(res.items())}
    out.update(hides=len(hides), blinks=len(short), blinks_mid=sum(1 for h in short if h["mid"]))
    return out


# ---------------------------------------------------------------- the app's file
def shape_sig(lines):
    """Points and length (m, haversine) of a route's drawn lines: the app compares them (n equal, length within 1%)."""
    n, m = 0, 0.0
    for line in lines or []:
        pts = [(float(p[0]), float(p[1])) for p in line]
        n += len(pts)
        for (a, b), (c, d) in zip(pts, pts[1:]):
            p1, p2, dl = math.radians(a), math.radians(c), math.radians(d - b)
            h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
            m += 2 * O.R * math.asin(math.sqrt(min(1.0, h)))
    return {"n": n, "m": round(m)}


def write_file(path, corr, final_shapes, days):
    """The app's file. `shape` = the last learned day's line (the one Pages deploys: pages.yml rebuilds web/data from
    Passio's GTFS, so the committed web/data/shapes.json can be older)."""
    routes = {}
    for rid in sorted(corr, key=lambda x: int(x) if x.isdigit() else x):
        if not final_shapes.get(rid):
            continue
        pts = sorted({(round(cy / O.KY + O.LAT0, 5), round(cx / O.KX + O.LON0, 5)) for cx, cy in (center_xy(c) for c in corr[rid])})
        routes[rid] = {"shape": shape_sig(final_shapes[rid]), "pts": [list(p) for p in pts]}
    last = date.fromisoformat(days[-1])
    out = {"note": "The streets each route's buses really drive where its drawn line (shapes.json) is off (RouteKnower E27c, "
                   "experiments/routeknower/E27-scripts/corridor.py --write): centers of 25 m cells driven in service on at "
                   "least two thirds of the route's days by at least 5% of its laps, 80 to 400 m from the drawn line. "
                   "core/offroute.js measures a bus's distance to the line or these points; a route is used only while "
                   "its drawn line still matches `shape` (points, meters) and before valid_until; a route not listed "
                   "keeps the E27b rule (250 m for 45 s).",
           "from": days[0], "to": days[-1], "valid_until": (last + timedelta(days=VALID_DAYS)).isoformat(), "cell_m": int(CELL_M),
           "routes": routes}
    Path(path).write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print("wrote", path, {k: len(v["pts"]) for k, v in routes.items()}, file=sys.stderr)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--dl", required=True)
    ap.add_argument("--arrivals", required=True)
    ap.add_argument("--write")
    ap.add_argument("--eval", action="store_true")
    ap.add_argument("--split", help="learn before this service day, score from it (out of sample)")
    ap.add_argument("--out", help="--eval results as JSON")
    ap.add_argument("--rule", default="{}", help="--eval: JSON overrides of RULE, e.g. {\"near_s\": 180}")
    a = ap.parse_args(argv)
    allrep, days = load_reports(a.cache)
    arrival_gaps(allrep, O.load_arrivals(a.arrivals))
    laps = laps_per_day(a.arrivals)
    line_days, st = same_line_days(a.dl, days)
    print("days with the final line:", {k: len(v) for k, v in line_days.items()}, file=sys.stderr)
    on_line = lambda r: OR.service_day(r["t"]) in line_days.get(r["rid"], ())
    learn_sel = (lambda r: on_line(r) and OR.service_day(r["t"]) < a.split) if a.split else on_line
    corr = learn(allrep, learn_sel, laps, lambda rid: st["segs"].get(rid))
    print("corridor points:", {k: len(v) for k, v in corr.items()}, file=sys.stderr)
    if a.write:
        write_file(a.write, corr, st["shapes"], days)
    if a.eval:
        corridor_distance(allrep, corr, line_days)
        sel = (lambda r: OR.service_day(r["t"]) >= a.split) if a.split else (lambda r: True)
        name = lambda rid: st["routes"].get(rid, {}).get("short") or st["routes"].get(rid, {}).get("long") or rid
        rule = {**RULE, **json.loads(a.rule)}
        out = {"days": [days[0], days[-1], len(days)], "split": a.split, "rule": rule}
        old, new = replay(allrep, dict(far_m=250, far_s=45), key="d"), replay(allrep, rule)
        out["E27b"], out["E27c"] = score(allrep, old, sel), score(allrep, new, sel)
        out["by_route"] = {name(rid): {"E27b": score(allrep, old, lambda r, rid=rid: sel(r) and r["rid"] == rid),
                                       "E27c": score(allrep, new, lambda r, rid=rid: sel(r) and r["rid"] == rid)}
                           for rid in sorted({r["rid"] for r in allrep})}
        txt = json.dumps(out, indent=1)
        if a.out:
            Path(a.out).write_text(txt, encoding="utf-8")
        print(txt)


if __name__ == "__main__":
    main()

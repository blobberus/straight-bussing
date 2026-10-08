#!/usr/bin/env python3
"""Expected TRUE bus speed (and time) on the segment arriving at a stop, at a given time.

  python tools/estimate_speed.py --route 1075 --stop "Regenstein" --when "mon 08:30"
  python tools/estimate_speed.py --route North --stop 8633 --when now
  python tools/estimate_speed.py --route 1075 --stop 8633 --from 8579 --when "2026-10-12 17:15"
--route: route id, short name or part of the long name. --stop: stop id or part of its name.
--when: now | HH:MM (today) | <mon..sun> HH:MM | YYYY-MM-DD HH:MM  (America/Chicago wall clock).
Speed = segment distance / moving time (dwell removed), from the shrunk hierarchy in
model_segments (docs/ALGORITHMS.md). Uses real data if >= 200 rows, otherwise synthetic (warned)."""
import argparse, json, math, sys
from datetime import date, datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import model_core as C
from model_segments import SegmentModel, tune_k

DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _load(name, default):
    try:
        return json.loads((C.WEB_DATA / name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def parse_when(s, now=None):
    """-> (dow Mon=0, hour, minute, label). Raises ValueError on bad input."""
    now = now or C.chicago(datetime.now().timestamp())
    s = (s or "now").strip().lower()
    if s == "now":
        return now.weekday(), now.hour, now.minute, now.strftime("%a %Y-%m-%d %H:%M (now)")
    parts = s.replace("t", " ", 1).split() if s[:4].isdigit() else s.split()
    if len(parts) == 2 and parts[0][:3] in DAYS:
        dow, hm = DAYS.index(parts[0][:3]), parts[1]
        label_day = DAYS[dow].title()
    elif len(parts) == 2 and len(parts[0]) == 10:
        d = date.fromisoformat(parts[0])
        dow, hm, label_day = d.weekday(), parts[1], d.strftime("%a %Y-%m-%d")
    elif len(parts) == 1 and ":" in parts[0]:
        dow, hm, label_day = now.weekday(), parts[0], now.strftime("%a") + " (today)"
    else:
        raise ValueError(f"cannot parse --when {s!r}")
    h, m = (int(x) for x in hm.split(":")[:2])
    if not (0 <= h < 24 and 0 <= m < 60):
        raise ValueError(f"bad time {hm!r}")
    return dow, h, m, f"{label_day} {h:02d}:{m:02d}"


def resolve_route(q, routes, route_stops):
    q = str(q).strip()
    if q in route_stops:
        return q
    ql = q.lower()
    hits = [r for r, v in routes.items() if r in route_stops and
            (v.get("short", "").lower() == ql or ql in v.get("long", "").lower())]
    if len(hits) == 1:
        return hits[0]
    raise SystemExit(f"route {q!r}: " + ("ambiguous: " + ", ".join(f"{h} ({routes[h].get('long')})" for h in hits)
                                        if hits else "not found. Known: " + ", ".join(
                                            f"{r} {routes.get(r, {}).get('short', '')}" for r in sorted(route_stops))))


def resolve_stop(q, order, stops):
    q = str(q).strip()
    if q in order:
        return q
    hits = [s for s in dict.fromkeys(order) if q.lower() in stops.get(s, {}).get("name", "").lower()]
    if len(hits) == 1:
        return hits[0]
    raise SystemExit(f"stop {q!r}: " + ("ambiguous: " if hits else "not on this route. Stops: ") +
                     "; ".join(f"{s} {stops.get(s, {}).get('name', '')}" for s in (hits or dict.fromkeys(order))))


def previous_stop(order, stop):
    i = order.index(stop)
    if i > 0:
        return order[i - 1]
    loop = len(order) > 2 and order[0] == order[-1]
    if loop:
        return order[-2]
    raise SystemExit("that is the first stop of a non-loop route: no segment arrives there")


def estimate(route, prev, stop, how, rows, k=None, sched=None, coords=None):
    """-> dict with run/seg/speed/interval/n/level/source. Falls back to the schedule with no rows."""
    if rows:
        k = k if k is not None else tune_k(rows, folds=3)[0]
        m = SegmentModel(k).fit(rows)
        d0 = C.haversine(*coords) * 1.25 if coords else None
        p = m.predict(route, prev, stop, how, d0)
        d = p["dist"]
        return {"dist": d, "run": p["run"], "dwell": p["dwell"], "seg": p["seg"], "p10": p["p10"] + p["dwell"],
                "p90": p["p90"] + p["dwell"], "speed": p["speed"], "v_lo": d / p["p90"] if d else None,
                "v_hi": d / p["p10"] if d else None, "n": p["n"], "level": p["level"],
                "path": " -> ".join(f"{a} (n={n}, w={w:.2f})" for a, n, w in p["path"]), "k": k}
    if sched is None or coords is None:
        return None
    d = C.haversine(*coords) * 1.25            # straight line x typical street detour
    return {"dist": d, "run": sched, "dwell": 0.0, "seg": sched, "p10": None, "p90": None, "speed": d / sched,
            "v_lo": None, "v_hi": None, "n": 0, "level": "schedule (no observed data)", "path": "schedule", "k": None}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--route", required=True)
    ap.add_argument("--stop", required=True)
    ap.add_argument("--from", dest="prev")
    ap.add_argument("--when", default="now")
    ap.add_argument("--data")
    ap.add_argument("--synthetic", action="store_true", help="force the synthetic dataset")
    a = ap.parse_args(argv)
    routes, rs, stops = _load("routes.json", {}), _load("route_stops.json", {}), _load("stops.json", {})
    addr, segs = _load("stop_addresses.json", {}), _load("segments.json", {}).get("routes", {})
    rid = resolve_route(a.route, routes, rs)
    order = rs[rid]
    stop = resolve_stop(a.stop, order, stops)
    prev = resolve_stop(a.prev, order, stops) if a.prev else previous_stop(order, stop)
    try:
        dow, h, mi, label = parse_when(a.when)
    except ValueError as e:
        raise SystemExit(str(e))
    how = C.how_bucket(dow, h)
    if a.synthetic:
        path, kind = C.SYNTH_CSV, "synthetic"
    else:
        path, kind = C.find_data(a.data)
    rows = C.load_rows(path) if path else []
    sched = None
    i = next((j for j in range(len(order) - 1) if order[j] == prev and order[j + 1] == stop), None)
    if i is not None and i < len((segs.get(rid) or {}).get("seg") or []):
        sched = float(segs[rid]["seg"][i])
    sp, ss = stops.get(prev, {}), stops.get(stop, {})
    coords = (sp["lat"], sp["lon"], ss["lat"], ss["lon"]) if sp and ss else None
    e = estimate(rid, prev, stop, how, rows, sched=sched, coords=coords)
    if not e:
        raise SystemExit("no data and no schedule for this segment")
    rname = routes.get(rid, {}).get("long") or rid
    print(f"Route   {rid} {rname}")
    print(f"Segment {sp.get('name', prev)} -> {ss.get('name', stop)}  ({e['dist']:.0f} m)")
    if addr.get(stop, {}).get("address"):
        print(f"Stop    {addr[stop]['address']}")
    print(f"When    {label}  (hour-of-week bucket {how}, {C.daypart_name(C.daypart(dow, h))})")
    v = e["speed"]
    print(f"Expected speed  {v:.2f} m/s = {v * 3.6:.1f} km/h = {v * 2.236936:.1f} mph   (moving; dwell removed)")
    if e["v_lo"]:
        print(f"  80% interval  {e['v_lo']:.2f}-{e['v_hi']:.2f} m/s = {e['v_lo'] * 3.6:.1f}-{e['v_hi'] * 3.6:.1f} km/h")
    print(f"Segment time    {e['seg']:.0f} s arrival-to-arrival = run {e['run']:.0f} s + dwell {e['dwell']:.0f} s at previous stop")
    if e["p10"] is not None:
        print(f"  80% interval  {e['p10']:.0f}-{e['p90']:.0f} s  (log-normal, right-skewed)")
    print(f"Samples n={e['n']}  hierarchy level: {e['level']}" + (f"  (k={e['k']})" if e["k"] is not None else ""))
    print(f"  path: {e['path']}")
    if sched is not None and rows:
        print(f"Schedule says   {sched:.0f} s for this segment")
    src = f"{path.name} ({kind}, {len(rows)} usable rows)" if path else "none"
    print(f"Data    {src}")
    if kind == "synthetic":
        print("WARNING: synthetic data. This shows the method works, NOT the real speed of real buses.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

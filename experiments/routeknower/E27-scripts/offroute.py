#!/usr/bin/env python3
"""E27 (2026-11-04): how long can a bus that serves riders be away from its route line, and how long are buses that
do not operate (garage runs after service, parked at a lot, filed under a route they are nowhere near) away from it?
Owner: "If buses are not following their routes for a long period of time (measure this by the bus operation data and
their listed hours), remove them from the map."

For every fresh report (at most 300 s older than the feed, the app's core/operating.js rule 1) of a bus on a known
route in the archived raw position polls: its distance to its route's shape (the drawn line), to its route's nearest
stop and to any route's shape, whether the route is inside its listed hours (service.json of that day's timetable,
calendar exceptions applied) and whether the bus's trip still had a live Passio prediction (operating.js rule 3).
Off-route EPISODES: per bus, consecutive fresh reports farther than D m from the route's shape (broken by a report
within D, a route change or a report gap over GAP_S). For candidate rules (D, minutes away inside / outside the listed
hours, the buffer around the hours) it counts the bus-minutes each would hide and how many of them belonged to buses
that were serving riders: a logged arrival (data branch arrivals.csv) on the route during the hidden part, or the bus
back on its route and logging an arrival within 30 min after the episode (a detour or an off-line layover).

Read-only. Inputs: release assets raw-polls-<day>.jsonl.gz, gtfs-<day>.zip, pred-updates-<day>.jsonl.gz and the
data branch's arrivals.csv / alerts.csv; the timetable JSON is built with tools/build_gtfs.py into a temp folder.

  python experiments/routeknower/E27-scripts/offroute.py --dl <raw-polls + gtfs dir> --pred <pred-updates dir>
      --arrivals arrivals.csv --alerts alerts.csv [--days 2026-10-20 ...] [--out results.json]
"""
import argparse, bisect, csv, gzip, hashlib, json, math, re, subprocess, sys, tempfile
from collections import defaultdict, Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tools"))
from service_gate import day_spans, CT   # noqa: E402

FRESH_S = 300          # core/operating.js STALE_S
GAP_S = 600            # a report gap longer than this ends an episode (the app restarts the clock too)
STEP_CAP_S = 60        # a report stands for at most this long when counting bus-minutes
SERVE_AFTER_S = 1800   # "came back to serve": an arrival on its route within this long after the episode
PRED_GRACE_S = 60
R = 6371000.0
LAT0, LON0 = 41.79, -87.60
KX = math.radians(1) * R * math.cos(math.radians(LAT0))
KY = math.radians(1) * R
DETOUR_RE = re.compile(r"detour|re-?rout|closed|closure|blocked|construction|bypass|not serv|will not stop|temporar", re.I)


def xy(lat, lon):
    return np.stack([(np.asarray(lon, float) - LON0) * KX, (np.asarray(lat, float) - LAT0) * KY], axis=-1)


def segs_of(lines):
    a, b = [], []
    for line in lines or []:
        p = xy([q[0] for q in line], [q[1] for q in line])
        if len(p) >= 2:
            a.append(p[:-1]); b.append(p[1:])
    if not a:
        return None
    return np.concatenate(a), np.concatenate(b)


def dist_to_segs(P, segs, chunk=1500):
    """Distance (m) of each point in P (N, 2) to the nearest segment."""
    if segs is None or not len(P):
        return np.full(len(P), np.inf)
    A, B = segs
    AB = B - A
    L2 = np.maximum((AB ** 2).sum(1), 1e-9)
    out = np.empty(len(P))
    for i in range(0, len(P), chunk):
        p = P[i:i + chunk, None, :]
        t = np.clip(((p - A) * AB).sum(2) / L2, 0, 1)
        d = p - (A + t[..., None] * AB)
        out[i:i + chunk] = np.sqrt((d ** 2).sum(2)).min(1)
    return out


# ---------------------------------------------------------------- static data per timetable
def build_static(zpath, cache):
    h = hashlib.sha1(Path(zpath).read_bytes()).hexdigest()[:12]
    out = Path(cache) / h
    if not (out / "service.json").exists():
        out.mkdir(parents=True, exist_ok=True)
        subprocess.run([sys.executable, str(REPO / "tools" / "build_gtfs.py"), "--zip", str(zpath), "--out", str(out),
                        "--patterns", str(out / "route_patterns.json")], check=True, capture_output=True)
    load = lambda n: json.loads((out / n).read_text(encoding="utf-8"))
    st = {"routes": load("routes.json"), "shapes": load("shapes.json"), "route_stops": load("route_stops.json"),
          "stops": load("stops.json"), "service": load("service.json"), "version": h}
    st["segs"] = {rid: segs_of(lines) for rid, lines in st["shapes"].items()}
    allsegs = [s for s in st["segs"].values() if s is not None]
    st["allsegs"] = (np.concatenate([s[0] for s in allsegs]), np.concatenate([s[1] for s in allsegs]))
    st["stopxy"] = {rid: xy([st["stops"][s]["lat"] for s in ids if s in st["stops"]],
                            [st["stops"][s]["lon"] for s in ids if s in st["stops"]])
                    for rid, ids in st["route_stops"].items()}
    alias = {}
    for rid, r in st["routes"].items():
        alias[rid] = rid
        for a in r.get("alias_ids") or []:
            alias.setdefault(str(a), rid)
    st["alias"] = alias
    return st


def zip_for(dl, day):
    """DC-021: before 2026-11-01 gtfs-<D>.zip holds the next morning's timetable, so day D uses gtfs-<D-1>.zip."""
    d = date.fromisoformat(day)
    order = [d - timedelta(days=1), d] if d < date(2026, 11, 1) else [d, d - timedelta(days=1)]
    for k in order + [d + timedelta(days=1)]:
        p = Path(dl) / f"gtfs-{k}.zip"
        if p.exists():
            return p
    return None


def spans_for(service, day):
    d = date.fromisoformat(day)
    out = defaultdict(list)
    for k in (-1, 0, 1):
        for rid, a, b in day_spans(service, d + timedelta(days=k)):
            out[rid].append((a, b))
    return out


def hours_gap(spans, t):
    """Seconds outside the route's listed hours at t: 0 inside a span, else the distance to the nearest span edge;
    inf when the route has no span in the 3 days."""
    best = math.inf
    for a, b in spans:
        if a <= t < b:
            return 0.0
        best = min(best, a - t if t < a else t - b)
    return best


# ---------------------------------------------------------------- live predictions (operating.js rule 3)
def load_preds(pred_dir, day):
    by = defaultdict(list)
    d = date.fromisoformat(day)
    for k in (d - timedelta(days=1), d, d + timedelta(days=1)):
        p = Path(pred_dir) / f"pred-updates-{k}.jsonl.gz"
        if not p.exists():
            continue
        with gzip.open(p, "rt", encoding="utf-8") as f:
            for ln in f:
                try:
                    x = json.loads(ln)
                    veh, trip, stop, made, pred = x[:5]
                    seen = int(x[6]) if len(x) > 6 else int(made)
                    last = int(x[7]) if len(x) > 7 else seen
                except (ValueError, TypeError, IndexError):
                    continue
                by[(str(veh), str(trip))].append((seen, last, int(pred)))
    for v in by.values():
        v.sort()
    return by


def has_pred(preds, veh, trip, t):
    lst = preds.get((str(veh), str(trip)))
    if not lst:
        return False
    i = bisect.bisect_right(lst, (t, math.inf, math.inf))
    for seen, last, pred in reversed(lst[max(0, i - 400):i]):
        if last + 90 >= t and pred >= t - PRED_GRACE_S:
            return True
    return False


# ---------------------------------------------------------------- arrivals, alerts
def load_arrivals(path):
    by = defaultdict(list)
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                by[str(r["vehicle_id"])].append((int(r["epoch"]), str(r["route_id"]), r.get("source", ""),
                                                 r.get("stop_name", "")))
            except (ValueError, KeyError):
                continue
    for v in by.values():
        v.sort()
    return by


def arrivals_between(arr, veh, rid, a, b):
    lst = arr.get(str(veh), [])
    i = bisect.bisect_left(lst, (a, "", "", ""))
    out = []
    while i < len(lst) and lst[i][0] <= b:
        if rid is None or lst[i][1] == rid:
            out.append(lst[i])
        i += 1
    return out


def load_alerts(path):
    out = []
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                a, b = int(r["active_start"] or 0), int(r["active_end"] or 0)
                fs, ls = int(r["first_seen"]), int(r["last_seen"])
            except ValueError:
                continue
            routes = [x for x in (r.get("route_ids") or "").replace(";", " ").split() if x]
            text = (r.get("header") or "") + " " + (r.get("description") or "")
            out.append({"from": max(a, fs) if a else fs, "to": min(b, ls + 120) if b else ls + 120, "routes": routes,
                        "detour": bool(DETOUR_RE.search(text)), "header": r.get("header", "")})
    return out


def detour_alert(alerts, alias, rid, t):
    """The app's rule (core/offroute.js): an active alert naming the route (any text) or naming no route but reading
    like a detour."""
    for al in alerts:
        if not (al["from"] <= t <= al["to"]):
            continue
        if al["routes"]:
            if any(alias.get(x) == rid for x in al["routes"]):
                return True
        elif al["detour"]:
            return True
    return False


# ---------------------------------------------------------------- one day
def day_reports(dl, pred_dir, day, cache, arr, alerts):
    zp = zip_for(dl, day)
    st = build_static(zp, cache)
    spans = spans_for(st["service"], day)
    preds = load_preds(pred_dir, day)
    seen, rows = set(), []
    with gzip.open(Path(dl) / f"raw-polls-{day}.jsonl.gz", "rt", encoding="utf-8") as f:
        for ln in f:
            try:
                p = json.loads(ln)
            except ValueError:
                continue
            h = int(p.get("h") or p.get("t") or 0)
            for v in p.get("v") or []:
                try:
                    veh, trip, rid, lat, lon = str(v[0]), str(v[1]), str(v[2]), float(v[3]), float(v[4])
                    vt = int(v[10] or 0)
                except (ValueError, TypeError, IndexError):
                    continue
                if (veh, vt) in seen or not vt:
                    continue
                seen.add((veh, vt))
                if h - vt > FRESH_S:
                    continue                         # rule 1 already hides it
                rows.append((veh, trip, rid, lat, lon, vt, h))
    rows.sort(key=lambda r: (r[0], r[5]))
    known = [r for r in rows if r[2] in st["routes"]]
    n_unknown = len(rows) - len(known)
    P = xy([r[3] for r in known], [r[4] for r in known]) if known else np.zeros((0, 2))
    d_own = np.full(len(known), np.inf)
    d_stop = np.full(len(known), np.inf)
    by_rid = defaultdict(list)
    for i, r in enumerate(known):
        by_rid[r[2]].append(i)
    for rid, idx in by_rid.items():
        idx = np.array(idx)
        d_own[idx] = dist_to_segs(P[idx], st["segs"].get(rid))
        sx = st["stopxy"].get(rid)
        if sx is not None and len(sx):
            d_stop[idx] = np.sqrt(((P[idx, None, :] - sx[None]) ** 2).sum(2)).min(1)
    far = np.where(d_own > 100)[0]
    d_any = d_own.copy()
    if len(far):
        d_any[far] = dist_to_segs(P[far], st["allsegs"])
    out = []
    for i, (veh, trip, rid, lat, lon, vt, h) in enumerate(known):
        gap = hours_gap(spans.get(rid, []), vt)
        pred = has_pred(preds, veh, trip, vt) if gap > 0 or d_own[i] > 150 else None
        out.append({"veh": veh, "trip": trip, "rid": rid, "lat": lat, "lon": lon, "t": vt, "d": float(d_own[i]),
                    "ds": float(d_stop[i]), "da": float(d_any[i]), "gap": gap, "pred": pred,
                    "alert": detour_alert(alerts, st["alias"], rid, vt)})
    # how far each route's own stops sit from its line (shape sanity check)
    stop_off = {}
    for rid, sx in st["stopxy"].items():
        if sx is not None and len(sx) and st["segs"].get(rid) is not None:
            stop_off[rid] = float(dist_to_segs(sx, st["segs"][rid]).max())
    return out, n_unknown, st, stop_off


def episodes(reports, D):
    """Per bus: runs of reports farther than D m from the route's line."""
    eps, cur, prev = [], None, None
    for r in reports:
        brk = prev is None or r["veh"] != prev["veh"] or r["rid"] != prev["rid"] or r["t"] - prev["t"] > GAP_S
        if brk and cur:
            eps.append(cur); cur = None
        if r["d"] > D:
            if cur is None:
                cur = {"veh": r["veh"], "rid": r["rid"], "rows": []}
            cur["rows"].append(r)
        elif cur:
            eps.append(cur); cur = None
        prev = r
    if cur:
        eps.append(cur)
    for e in eps:
        rs = e["rows"]
        e["start"], e["end"] = rs[0]["t"], rs[-1]["t"]
        e["min"] = (e["end"] - e["start"]) / 60
        e["maxd"] = max(x["d"] for x in rs)
        e["inhours"] = sum(1 for x in rs if x["gap"] == 0) / len(rs)
    return eps


def step_s(reports):
    """Seconds each report stands for (to the bus's next report, capped)."""
    out = [0.0] * len(reports)
    for i, r in enumerate(reports):
        nxt = reports[i + 1] if i + 1 < len(reports) else None
        if nxt and nxt["veh"] == r["veh"]:
            out[i] = float(min(STEP_CAP_S, max(0, nxt["t"] - r["t"])))
        else:
            out[i] = 10.0
    return out


def evaluate(eps, arr, y_in, y_out, buf_s, use_alert=True):
    """Bus-minutes hidden by the rule: off its line (> D m, the episodes given) for at least y_in min inside the
    listed hours (+ buf_s), y_out min outside them; never inside the listed hours during a detour alert. Reports the
    existing rules already hide (outside the hours with no live prediction) are counted apart."""
    res = Counter()
    worst = []
    for e in eps:
        hid_s = hid_serving = 0.0
        for r in e["rows"]:
            s = r["step"]
            inside = r["gap"] <= buf_s
            if r["gap"] > 0 and not r["pred"]:
                res["already_hidden_s"] += s
                continue
            res["shown_off_s"] += s
            el = (r["t"] - e["start"]) / 60
            hide = el >= (y_in if inside else y_out) and not (use_alert and r["alert"] and r["gap"] == 0)
            if hide:
                hid_s += s
                if r["serving"]:
                    hid_serving += s
        res["hidden_s"] += hid_s
        res["hidden_serving_now_s"] += hid_serving
        if hid_s:
            res["episodes_hidden"] += 1
            if e["came_back"] is not None:
                res["hidden_came_back_s"] += hid_s
                res["episodes_came_back"] += 1
                worst.append((hid_s, e, e["came_back"]))
            if e["inhours"] > 0:
                res["hidden_inhours_s"] += hid_s
    worst.sort(key=lambda w: -w[0])
    return res, worst


def annotate(eps, arr):
    """came_back: seconds from the episode's end to the bus's next arrival on its route (within SERVE_AFTER_S), else
    None; serving: a logged arrival on the route within 2 min of the report."""
    for e in eps:
        after = arrivals_between(arr, e["veh"], e["rid"], e["end"] + 1, e["end"] + SERVE_AFTER_S)
        e["came_back"] = (after[0][0] - e["end"]) if after else None
        before = arrivals_between(arr, e["veh"], e["rid"], e["start"] - SERVE_AFTER_S, e["start"] - 1)
        e["prev_stop"] = (round((e["start"] - before[-1][0]) / 60, 1), before[-1][3]) if before else None
        e["next_stop"] = (round((after[0][0] - e["end"]) / 60, 1), after[0][3]) if after else None
        for r in e["rows"]:
            r["serving"] = bool(arrivals_between(arr, e["veh"], e["rid"], r["t"] - 120, r["t"] + 120))
    return eps


def fmt_t(t):
    return datetime.fromtimestamp(t, CT).strftime("%m-%d %H:%M")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dl", required=True)
    ap.add_argument("--pred", required=True)
    ap.add_argument("--arrivals", required=True)
    ap.add_argument("--alerts", required=True)
    ap.add_argument("--days", nargs="*")
    ap.add_argument("--out")
    ap.add_argument("--cache", help="pickle of the per-report table (written once, then read: fast reruns)")
    a = ap.parse_args(argv)
    days = a.days or sorted(p.name[10:20] for p in Path(a.dl).glob("raw-polls-*.jsonl.gz"))
    cache = Path(tempfile.gettempdir()) / "sb-e27-static"
    arr = load_arrivals(a.arrivals)
    alerts = load_alerts(a.alerts)
    allrep, stats = [], Counter()
    stop_offs = {}
    import pickle
    if a.cache and Path(a.cache).exists():
        allrep, stats, stop_offs, days = pickle.loads(Path(a.cache).read_bytes())
    else:
        for day in days:
            reps, n_unknown, st, stop_off = day_reports(a.dl, a.pred, day, cache, arr, alerts)
            stop_offs[st["version"]] = stop_off
            stats["unknown_route_fresh"] += n_unknown
            allrep.extend(reps)
            print(f"{day}: {len(reps)} fresh reports on known routes (timetable {st['version']})", file=sys.stderr)
        if a.cache:
            Path(a.cache).write_bytes(pickle.dumps((allrep, stats, stop_offs, days)))
    allrep.sort(key=lambda r: (r["veh"], r["t"]))
    steps = step_s(allrep)
    for r, s in zip(allrep, steps):
        r["step"] = s
    tot = sum(steps)
    # 1. distance distribution, inside / outside the listed hours
    out = {"days": days, "reports": len(allrep), "bus_hours": round(tot / 3600, 1),
           "unknown_route_fresh": stats["unknown_route_fresh"], "stop_off_max_m": stop_offs}
    for name, sel in (("inside", lambda r: r["gap"] == 0), ("outside_shown", lambda r: r["gap"] > 0 and r["pred"]),
                      ("outside_hidden_already", lambda r: r["gap"] > 0 and not r["pred"])):
        rs = [(r, s) for r, s in zip(allrep, steps) if sel(r)]
        w = sum(s for _, s in rs) or 1
        out["dist_" + name] = {"bus_hours": round(w / 3600, 1), **{f"within_{m}": round(sum(s for r, s in rs if r["d"] <= m) / w, 4)
                                                                   for m in (40, 100, 200, 300, 500, 1000)}}
    # 2. episodes by threshold
    out["episodes"] = {}
    EPS = {D: annotate(episodes(allrep, D), arr) for D in (150, 300, 500)}
    for D in (150, 300, 500):
        eps = EPS[D]
        inside = [e for e in eps if e["inhours"] == 1]
        came = [e for e in inside if e["came_back"] is not None]
        q = lambda xs, p: round(float(np.percentile(xs, p)), 1) if xs else None
        out["episodes"][D] = {
            "n": len(eps), "inside_hours": len(inside),
            "inside_came_back": len(came),
            "came_back_min_p50_p90_p99_max": [q([e["min"] for e in came], p) for p in (50, 90, 99, 100)],
            "inside_not_back_min_p50_p90_max": [q([e["min"] for e in inside if e not in came], p) for p in (50, 90, 100)],
            "came_back_longest": [{"veh": e["veh"], "rid": e["rid"], "from": fmt_t(e["start"]), "min": round(e["min"], 1),
                                   "maxd": round(e["maxd"]), "alert": any(x["alert"] for x in e["rows"]),
                                   "prev": e["prev_stop"], "next": e["next_stop"],
                                   "far": [round(max(e["rows"], key=lambda x: x["d"])[k], 5) for k in ("lat", "lon")],
                                   "at": [round(e["rows"][len(e["rows"]) // 2]["lat"], 5), round(e["rows"][len(e["rows"]) // 2]["lon"], 5)]}
                                  for e in sorted(came, key=lambda e: -e["min"])[:40]],
        }
    # 3. candidate rules
    out["rules"] = []
    for D in (150, 300, 500):
        for y_in in (5, 10, 15, 20, 30):
            for y_out in (0, 2, 5):
                for buf in (0, 30):
                    res, worst = evaluate(EPS[D], arr, y_in, y_out, buf * 60)
                    out["rules"].append({"D": D, "y_in": y_in, "y_out": y_out, "buf_min": buf,
                                         **{k: round(v / 60, 1) if k.endswith("_s") else v for k, v in res.items()},
                                         "worst": [{"veh": e["veh"], "rid": e["rid"], "from": fmt_t(e["start"]),
                                                    "min": round(e["min"], 1), "hidden_min": round(h / 60, 1),
                                                    "maxd": round(e["maxd"]), "back_after_min": round(b / 60, 1)}
                                                   for h, e, b in worst[:5]]})
    # 4. where buses are when off their line (> 300 m), by 300 m cell
    cells = Counter()
    for r, s in zip(allrep, steps):
        if r["d"] > 300:
            cells[(round(r["lat"] / 0.003) * 0.003, round(r["lon"] / 0.004) * 0.004, r["gap"] == 0)] += s
    out["off_cells"] = [{"lat": round(k[0], 4), "lon": round(k[1], 4), "inside": k[2], "bus_min": round(v / 60)}
                        for k, v in cells.most_common(25)]
    # 5. off-line minutes per route inside the hours
    per = defaultdict(lambda: Counter())
    for r, s in zip(allrep, steps):
        if r["gap"] == 0:
            per[r["rid"]]["all"] += s
            if r["d"] > 300:
                per[r["rid"]]["off300"] += s
            if r["d"] > 300 and r["da"] <= 40:
                per[r["rid"]]["off300_on_other_line"] += s
    out["per_route_inside"] = {rid: {k: round(v / 60) for k, v in c.items()} for rid, c in per.items()}
    txt = json.dumps(out, indent=1)
    if a.out:
        Path(a.out).write_text(txt, encoding="utf-8")
    print(txt)


if __name__ == "__main__":
    main()

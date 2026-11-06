#!/usr/bin/env python3
"""E28 (2026-11-06): where do buses linger at the end of a trip or a shift, and which of those buses still show as
serving riders? Owner: "Identify bus activity at the end of their trip and log their behavior on where they tend to
linger which may indicate they are going to end their shift so that the app doesn't suggest these trips. Log this
information in a labeled bus data file" (the buses parked "in front of Regenstein library" at 11:50 PM).

For every fresh report (at most 300 s older than the feed: core/operating.js rule 1) of a bus on a known route in the
archived raw position polls, a DWELL EPISODE is a run of the bus's reports that stay within R_DWELL m of the run's first
report for at least MIN_DWELL_S (broken by a report gap over GAP_S). Each episode gets what a phone could know at the
time (minutes still, whether Passio still predicts a stop for the bus and how far ahead, the route's listed hours,
the distance to the nearest named linger spot) and what happened next, from the logged arrivals (data branch
arrivals.csv, by vehicle) and the bus's next reports: it served riders again (an arrival at a stop at least
AWAY_M from the spot), drove to the operator's garage, or the feed dropped it.

LABEL (first match; garage = within GARAGE_M of the operator's garage at 41.8206, -87.6416):
  garage_return        at the garage after serving (an arrival in the BEFORE_S before the episode)
  parked_never_served  no arrival in the BEFORE_S before, none in the SOON_S after (or at the garage before a shift)
  layover              served again within SOON_S of the episode's end and still under BREAK_S
  break                served again within LATER_S, but the pause (the episode, or the time to the next arrival) is
                       BREAK_S or longer
  end_of_shift         served before (BEFORE_S) and not again within LATER_S
Episodes before the first service of a shift that serve within SOON_S are layovers (waiting to start).

Writes per service day <out>/<day>.csv (one row per episode, columns in COLUMNS, docs in data/labeled/end_of_service/
README.md), <out>/linger_spots.csv and <out>/summary.csv (by line), and a JSON of the numbers to --json.

  python experiments/routeknower/E28-scripts/endofservice.py --dl <fetch.py folder> --out data/labeled/end_of_service
      [--days 2026-11-05 ...] [--cache episodes.pkl] [--json e28.json]
"""
import argparse, bisect, csv, gzip, json, math, pickle, sys, tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "E27-scripts"))
import offroute as O   # noqa: E402

R_DWELL = 80            # m: a bus within this of the run's first report is still in the same place
MIN_DWELL_S = 180       # an episode lasts at least this long
GAP_S = 600             # a report gap longer than this ends an episode
SAMPLE_S = 60           # the prediction state is read every minute of an episode
AWAY_M = 200            # "served": an arrival at a stop at least this far from the episode's spot
BEFORE_S = 3600         # served before: an arrival in the hour before the episode
SOON_S = 1800           # served again soon: an arrival within 30 min after the episode
LATER_S = 3 * 3600      # served again later (a break): within 3 h
BREAK_S = 1800          # a pause this long (episode or time to the next arrival) is a break, not a layover
GARAGE = (41.8206, -87.6416)
GARAGE_M = 700
SPOT_M = 120            # episodes within this of a spot's centre belong to it
NAME_M = 160            # a spot takes the name of the nearest stop within this
PRED_GRACE_S = 60
PRED_SEEN_S = 90        # a prediction stays visible this long after the logger last saw it
FUTURE_S = 120          # a prediction at least this far ahead = Passio expects the bus to move later, not "now"
ROUTE_NAMES = {}

COLUMNS = ["vehicle", "route_id", "route", "start", "end", "duration_min", "lat", "lon", "spot", "spot_m",
           "had_trip_updates", "pred_share", "future_pred_share", "in_listed_hours", "min_after_last_trip",
           "last_arrival_min_before", "last_arrival_stop", "next_arrival_min_after", "next_arrival_stop",
           "next_arrival_route", "next", "next_min", "shown_by_app_min", "label", "evidence"]


def hav_m(a_lat, a_lon, b_lat, b_lon):
    kx = O.R * math.radians(1) * math.cos(math.radians((a_lat + b_lat) / 2))
    return math.hypot((a_lon - b_lon) * kx, (a_lat - b_lat) * O.R * math.radians(1))


def ct(t, fmt="%Y-%m-%d %H:%M"):
    return datetime.fromtimestamp(t, O.CT).strftime(fmt)


def day_bounds(day):
    d = date.fromisoformat(day)
    a = datetime(d.year, d.month, d.day, 4, tzinfo=O.CT)
    b = datetime(d.year, d.month, d.day, tzinfo=O.CT) + timedelta(days=1)
    return int(a.timestamp()), int(b.replace(hour=4).timestamp())


# ---------------------------------------------------------------- inputs of one day
def load_reports(dl, day, st):
    """Fresh reports on known routes, deduped (vehicle, report time): (veh, trip, rid, lat, lon, speed, stop, vt, h)."""
    t0, t1 = day_bounds(day)
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
                    spd = float(v[6]) if v[6] is not None else None
                    vt = int(v[10] or 0)
                except (ValueError, TypeError, IndexError):
                    continue
                if not vt or (veh, vt) in seen or not (t0 <= vt < t1):
                    continue
                seen.add((veh, vt))
                if h - vt > O.FRESH_S or rid not in st["routes"]:
                    continue
                rows.append((veh, trip, rid, lat, lon, spd, str(v[8]) if v[8] is not None else "", vt, h))
    rows.sort(key=lambda r: (r[0], r[7]))
    return rows


def load_pred_grid(dl, day):
    """Per vehicle, per minute: (soonest prediction >= t - grace, latest prediction, trip ids) from the logged
    prediction updates (pred-updates-<day>, each visible from `seen` to `last` + PRED_SEEN_S)."""
    grid = defaultdict(dict)
    d = date.fromisoformat(day)
    for k in (d - timedelta(days=1), d, d + timedelta(days=1)):
        p = Path(dl) / f"pred-updates-{k}.jsonl.gz"
        if not p.exists():
            continue
        with gzip.open(p, "rt", encoding="utf-8") as f:
            for ln in f:
                try:
                    x = json.loads(ln)
                    veh, trip, pred = str(x[0]), str(x[1]), int(x[4])
                    seen = int(x[6]) if len(x) > 6 else int(x[3])
                    last = int(x[7]) if len(x) > 7 else seen
                except (ValueError, TypeError, IndexError):
                    continue
                g = grid[veh]
                for m in range(seen // 60, (last + PRED_SEEN_S) // 60 + 1):
                    t = m * 60
                    if pred < t - PRED_GRACE_S:
                        continue
                    cur = g.get(m)
                    if cur is None:
                        g[m] = [pred, pred, {trip}]
                    else:
                        cur[0] = min(cur[0], pred); cur[1] = max(cur[1], pred); cur[2].add(trip)
    return grid


def load_arrivals(path):
    """Per vehicle: sorted (epoch, route, stop_id, stop_name, lat, lon, source)."""
    by = defaultdict(list)
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                by[str(r["vehicle_id"])].append((int(r["epoch"]), str(r["route_id"]), str(r["stop_id"]), r["stop_name"],
                                                 float(r["stop_lat"] or 0), float(r["stop_lon"] or 0), r.get("source", "")))
            except (ValueError, KeyError):
                continue
    for v in by.values():
        v.sort()
    return by


def arrival_away(arr, veh, lat, lon, a, b, last=False):
    """The first (or last) arrival of the bus between a and b at a stop at least AWAY_M from (lat, lon)."""
    lst = arr.get(str(veh), [])
    i, j = bisect.bisect_left(lst, (a,)), bisect.bisect_right(lst, (b, "￿"))
    rng = range(j - 1, i - 1, -1) if last else range(i, j)
    for k in rng:
        x = lst[k]
        if x[4] and hav_m(lat, lon, x[4], x[5]) >= AWAY_M:
            return x
    return None


def since_listed_end(spans, t):
    """Minutes since the end of the route's listed hours at t: negative inside a span (minutes left), positive after
    the most recent span ended, None when no span ended in the 3 days around."""
    best = None
    for a, b in spans:
        if a <= t < b:
            return (t - b) / 60
        if b <= t and (best is None or b > best):
            best = b
    return (t - best) / 60 if best is not None else None


# ---------------------------------------------------------------- episodes
def dwell_runs(rows):
    """Index runs [i, j] of one bus staying within R_DWELL m of the run's first report for >= MIN_DWELL_S."""
    out, i, n = [], 0, len(rows)
    while i < n:
        a = rows[i]
        j = i
        while j + 1 < n and rows[j + 1][0] == a[0] and rows[j + 1][7] - rows[j][7] <= GAP_S \
                and hav_m(a[3], a[4], rows[j + 1][3], rows[j + 1][4]) <= R_DWELL:
            j += 1
        if rows[j][7] - a[7] >= MIN_DWELL_S:
            out.append((i, j))
            i = j + 1
        else:
            i += 1
    return out


def what_next(rows, j, arr, ep):
    """After the episode: 'served' (an arrival away from the spot within SOON_S), 'garage' (within GARAGE_M of the
    garage within 60 min, before any arrival), 'feed_dropped' (the bus's reports stop within 30 min of the episode and
    nothing comes for 30 min more: it left the feed, often on its way to the garage after the night service),
    'moved_no_service' otherwise (it drove on without logging an arrival in 30 min). -> (kind, minutes until it)."""
    veh, t1 = rows[j][0], rows[j][7]
    nxt = arrival_away(arr, veh, ep["lat"], ep["lon"], t1 + 1, t1 + SOON_S)
    k, g, last = j + 1, None, t1
    while k < len(rows) and rows[k][0] == veh and rows[k][7] <= t1 + 3600:
        if rows[k][7] - last > 1800:
            break
        last = rows[k][7]
        if g is None and hav_m(rows[k][3], rows[k][4], *GARAGE) <= GARAGE_M:
            g = rows[k][7]
        k += 1
    if nxt and (g is None or nxt[0] <= g):
        return "served", (nxt[0] - t1) / 60
    if g is not None and ep["garage_m"] > GARAGE_M:
        return "garage", (g - t1) / 60
    more = k < len(rows) and rows[k][0] == veh and rows[k][7] - last <= 1800
    if last - t1 <= 1800 and not more:
        return "feed_dropped", (last - t1) / 60
    return "moved_no_service", None


def label(ep):
    """The episode's label and its evidence (module docstring)."""
    b, a, dur = ep["before_min"], ep["after_min"], ep["dur_min"]
    served_before = b is not None and b * 60 <= BEFORE_S
    soon = a is not None and a * 60 <= SOON_S
    later = a is not None and a * 60 <= LATER_S
    ev = [f"still {dur:.0f} min at {ep['spot'] or 'an unnamed spot'}"]
    ev.append(f"last arrival {b:.0f} min before ({ep['before_stop']})" if b is not None else "no arrival in the 3 h before")
    ev.append(f"next arrival {a:.0f} min after ({ep['after_stop']})" if a is not None else "no arrival in the 6 h after")
    if ep["next"] in ("garage", "feed_dropped"):
        ev.append({"garage": "drove to the garage", "feed_dropped": "left the feed"}[ep["next"]]
                  + (f" {ep['next_min']:.0f} min after" if ep["next_min"] is not None else ""))
    ev.append(f"Passio predicted a stop {ep['pred_share'] * 100:.0f}% of the time" if ep["pred_share"] else "no Passio prediction")
    if ep["since_end_min"] is not None and ep["since_end_min"] > 0:
        ev.append(f"{ep['since_end_min']:.0f} min after the listed hours")
    if ep["garage_m"] <= GARAGE_M:
        lab = "garage_return" if served_before else "parked_never_served"
    elif soon:
        lab = "layover" if dur * 60 < BREAK_S else "break"
    elif later and b is not None and b * 60 <= LATER_S:
        lab = "break"
    elif later:
        lab = "parked_never_served"
    elif served_before:
        lab = "end_of_shift"
    else:
        lab = "parked_never_served"
    return lab, "; ".join(ev)


def episodes_of_day(rows, st, spans, grid, arr, stops):
    eps = []
    for i, j in dwell_runs(rows):
        r0, r1 = rows[i], rows[j]
        veh = r0[0]
        lat = float(np.mean([r[3] for r in rows[i:j + 1]]))
        lon = float(np.mean([r[4] for r in rows[i:j + 1]]))
        t0, t1 = r0[7], r1[7]
        rid = r1[2]
        g = grid.get(veh, {})
        mins = list(range(t0 // 60 + 1, t1 // 60 + 1)) or [t0 // 60]
        has = [m for m in mins if m in g]
        fut = [m for m in has if g[m][1] >= m * 60 + FUTURE_S]
        # how long the app showed the bus during the episode (core/operating.js + core/offroute.js, approximately:
        # inside the listed hours or with a prediction on its trip; never when off every line for 15 / 5 min)
        da = float(O.dist_to_segs(O.xy([lat], [lon]), st["allsegs"])[0])
        shown = 0.0
        for k in range(i, j + 1):
            r = rows[k]
            step = min(60, (rows[k + 1][7] - r[7]) if k < j else 10)
            gap = O.hours_gap(spans.get(r[2], []), r[7])
            m = g.get(r[7] // 60)
            on_trip = bool(m and r[1] in m[2])
            if not (gap == 0 or on_trip):
                continue
            if da > 300 and r[7] - t0 >= (900 if gap <= 1800 else 300):
                continue
            shown += step
        ep = {"veh": veh, "rid": rid, "rid0": r0[2], "t0": t0, "t1": t1, "dur_min": (t1 - t0) / 60, "lat": lat, "lon": lon,
              "n": j - i + 1, "trip0": r0[1], "trip1": r1[1],
              "pred_share": len(has) / len(mins), "fut_share": len(fut) / len(mins),
              "inside": O.hours_gap(spans.get(rid, []), t0) == 0, "since_end_min": since_listed_end(spans.get(rid, []), t0),
              "garage_m": hav_m(lat, lon, *GARAGE), "line_m": da, "shown_min": shown / 60}
        bef = arrival_away(arr, veh, lat, lon, t0 - 3 * 3600, t0 - 1, last=True)
        aft = arrival_away(arr, veh, lat, lon, t1 + 1, t1 + 6 * 3600)
        ep["before_min"] = (t0 - bef[0]) / 60 if bef else None
        ep["before_stop"] = bef[3] if bef else ""
        ep["after_min"] = (aft[0] - t1) / 60 if aft else None
        ep["after_stop"] = aft[3] if aft else ""
        ep["after_route"] = aft[1] if aft else ""
        # nearest stop of any route (the spot's name) and the minutes still at each report (for the rule study)
        best = min(((hav_m(lat, lon, s["lat"], s["lon"]), s["name"]) for s in stops.values()), default=(1e9, ""))
        ep["stop_m"], ep["stop_name"] = best
        ep["next"], ep["next_min"] = what_next(rows, j, arr, ep)
        eps.append(ep)
    return eps


def name_spots(eps, stops):
    """Group episodes into linger spots (greedy, densest first, SPOT_M) named after the nearest stop or the garage."""
    pts = sorted(eps, key=lambda e: -e["dur_min"])
    spots = []
    for e in pts:
        hit = next((s for s in spots if hav_m(e["lat"], e["lon"], s["lat"], s["lon"]) <= SPOT_M), None)
        if hit is None:
            hit = {"lat": e["lat"], "lon": e["lon"], "eps": []}
            spots.append(hit)
        hit["eps"].append(e)
    for s in spots:
        s["lat"] = float(np.average([e["lat"] for e in s["eps"]], weights=[e["dur_min"] for e in s["eps"]]))
        s["lon"] = float(np.average([e["lon"] for e in s["eps"]], weights=[e["dur_min"] for e in s["eps"]]))
        if hav_m(s["lat"], s["lon"], *GARAGE) <= GARAGE_M:
            s["name"] = "Operator garage (41.820, -87.642)"
        else:
            d, nm = min(((hav_m(s["lat"], s["lon"], x["lat"], x["lon"]), x["name"]) for x in stops.values()), default=(1e9, ""))
            s["name"] = nm if d <= NAME_M else f"Unnamed ({s['lat']:.4f}, {s['lon']:.4f})"
    merged = {}
    for s in spots:                                      # neighbouring groups with the same nearest stop are one spot
        m = merged.get(s["name"])
        if m is None:
            merged[s["name"]] = s
        else:
            m["eps"].extend(s["eps"])
    spots = list(merged.values())
    for s in spots:
        w = [e["dur_min"] for e in s["eps"]]
        s["lat"] = float(np.average([e["lat"] for e in s["eps"]], weights=w))
        s["lon"] = float(np.average([e["lon"] for e in s["eps"]], weights=w))
        for e in s["eps"]:
            e["spot"], e["spot_m"] = s["name"], hav_m(e["lat"], e["lon"], s["lat"], s["lon"])
    return spots


def row_of(e):
    return {"vehicle": e["veh"], "route_id": e["rid"], "route": ROUTE_NAMES.get(e["rid"], e["rid"]),
            "start": ct(e["t0"]), "end": ct(e["t1"]), "duration_min": round(e["dur_min"], 1),
            "lat": round(e["lat"], 5), "lon": round(e["lon"], 5), "spot": e["spot"], "spot_m": round(e["spot_m"]),
            "had_trip_updates": "y" if e["pred_share"] > 0 else "n", "pred_share": round(e["pred_share"], 2),
            "future_pred_share": round(e["fut_share"], 2), "in_listed_hours": "y" if e["inside"] else "n",
            "min_after_last_trip": "" if e["since_end_min"] is None else round(e["since_end_min"], 1),
            "last_arrival_min_before": "" if e["before_min"] is None else round(e["before_min"], 1),
            "last_arrival_stop": e["before_stop"],
            "next_arrival_min_after": "" if e["after_min"] is None else round(e["after_min"], 1),
            "next_arrival_stop": e["after_stop"], "next_arrival_route": ROUTE_NAMES.get(e["after_route"], e["after_route"]),
            "next": e["next"], "next_min": "" if e["next_min"] is None else round(e["next_min"], 1),
            "shown_by_app_min": round(e["shown_min"], 1), "label": e["label"], "evidence": e["evidence"]}


def write_csv(path, rows, cols):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dl", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--days", nargs="*")
    ap.add_argument("--cache", help="pickle of (episodes, reports by day): written once, then read")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    dl, out = Path(a.dl), Path(a.out)
    days = a.days or sorted(p.name[10:20] for p in dl.glob("raw-polls-*.jsonl.gz"))
    cache = Path(tempfile.gettempdir()) / "sb-e27-static"
    if a.cache and Path(a.cache).exists():
        eps, stops, names = pickle.loads(Path(a.cache).read_bytes())
    else:
        arr = load_arrivals(dl / "arrivals.csv")
        eps, stops, names = [], {}, {}
        for day in days:
            st = O.build_static(O.zip_for(dl, day), cache)
            spans = O.spans_for(st["service"], day)
            rows = load_reports(dl, day, st)
            grid = load_pred_grid(dl, day)
            stops.update(st["stops"])
            names.update({rid: (r.get("long") or r.get("short") or rid) for rid, r in st["routes"].items()})
            de = episodes_of_day(rows, st, spans, grid, arr, st["stops"])
            for e in de:
                e["day"] = day
            eps.extend(de)
            print(f"{day}: {len(rows)} reports, {len(de)} dwell episodes", file=sys.stderr)
        if a.cache:
            Path(a.cache).write_bytes(pickle.dumps((eps, stops, names)))
    ROUTE_NAMES.update(names)
    spots = name_spots(eps, stops)
    for e in eps:
        e["label"], e["evidence"] = label(e)
    out.mkdir(parents=True, exist_ok=True)
    by_day = defaultdict(list)
    for e in eps:
        by_day[e["day"]].append(e)
    counts = {}
    for day, de in sorted(by_day.items()):
        de.sort(key=lambda e: (e["t0"], e["veh"]))
        write_csv(out / f"{day}.csv", [row_of(e) for e in de], COLUMNS)
        counts[day] = dict(Counter(e["label"] for e in de))
    # linger spots
    srows = []
    for s in sorted(spots, key=lambda s: -sum(e["dur_min"] for e in s["eps"])):
        if len(s["eps"]) < 5:
            continue
        lab = Counter(e["label"] for e in s["eps"])
        hrs = [((datetime.fromtimestamp(e["t0"], O.CT).hour - 4) % 24 + 4) + datetime.fromtimestamp(e["t0"], O.CT).minute / 60
               for e in s["eps"]]
        eos = [e for e in s["eps"] if e["label"] == "end_of_shift"]
        fmt = lambda h: f"{int(h) % 24:02d}:{int(round((h % 1) * 60)) % 60:02d}"
        srows.append({"spot": s["name"], "lat": round(s["lat"], 5), "lon": round(s["lon"], 5), "episodes": len(s["eps"]),
                      "bus_hours": round(sum(e["dur_min"] for e in s["eps"]) / 60, 1),
                      "median_min": round(float(np.median([e["dur_min"] for e in s["eps"]])), 1),
                      "p90_min": round(float(np.percentile([e["dur_min"] for e in s["eps"]], 90)), 1),
                      **{k: lab.get(k, 0) for k in ("layover", "break", "end_of_shift", "garage_return", "parked_never_served")},
                      "routes": " / ".join(f"{ROUTE_NAMES.get(r, r)} {n}" for r, n in Counter(e["rid"] for e in s["eps"]).most_common(4)),
                      "typical_start_p10_p50_p90": " / ".join(fmt(float(np.percentile(hrs, p))) for p in (10, 50, 90)),
                      "end_of_shift_typical_start": " / ".join(fmt(float(np.percentile(
                          [((datetime.fromtimestamp(e["t0"], O.CT).hour - 4) % 24 + 4) + datetime.fromtimestamp(e["t0"], O.CT).minute / 60 for e in eos], p)))
                          for p in (10, 50, 90)) if eos else "",
                      "shown_by_app_bus_hours_not_layover": round(sum(e["shown_min"] for e in s["eps"] if e["label"] not in ("layover",)) / 60, 1)})
    write_csv(out / "linger_spots.csv", srows, list(srows[0].keys()) if srows else ["spot"])
    # summary by line
    per = defaultdict(list)
    for e in eps:
        per[e["rid"]].append(e)
    nd = len(by_day)
    lrows = []
    for rid, es in sorted(per.items(), key=lambda kv: -sum(e["shown_min"] for e in kv[1] if e["label"] != "layover")):
        lab = Counter(e["label"] for e in es)
        mins = Counter()
        for e in es:
            mins[e["label"]] += e["dur_min"]
        lrows.append({"route_id": rid, "route": ROUTE_NAMES.get(rid, rid), "days": len({e["day"] for e in es}),
                      "episodes": len(es), **{k: lab.get(k, 0) for k in ("layover", "break", "end_of_shift", "garage_return", "parked_never_served")},
                      **{f"{k}_bus_min": round(mins.get(k, 0)) for k in ("layover", "break", "end_of_shift", "garage_return", "parked_never_served")},
                      "shown_idle_bus_min": round(sum(e["shown_min"] for e in es if e["label"] != "layover")),
                      "shown_idle_bus_min_per_day": round(sum(e["shown_min"] for e in es if e["label"] != "layover") / max(1, nd), 1),
                      "end_of_shift_with_predictions": sum(1 for e in es if e["label"] == "end_of_shift" and e["pred_share"] > 0)})
    write_csv(out / "summary.csv", lrows, list(lrows[0].keys()) if lrows else ["route_id"])
    res = {"days": sorted(by_day), "episodes": len(eps), "labels": dict(Counter(e["label"] for e in eps)), "per_day": counts}
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()

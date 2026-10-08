"""Shared helpers for learn.py / evaluate.py (stdlib only)."""
import glob, gzip, json, math, statistics
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "data"
RADIUS_M = 40.0
MAX_SEG_FACTOR = 4.0     # drop segment samples longer than 4x schedule + 10 min (layovers, breakdowns)
K_SHRINK = 5


def load_json(p, default=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return default


def load_obs(obs_dir):
    """Yield observation dicts from every *.jsonl(.gz) file in obs_dir (bad lines skipped)."""
    files = sorted(glob.glob(str(Path(obs_dir) / "*.jsonl.gz")) + glob.glob(str(Path(obs_dir) / "*.jsonl")))
    for f in files:
        op = gzip.open if f.endswith(".gz") else open
        try:
            with op(f, "rt", encoding="utf-8") as fh:
                for line in fh:
                    try:
                        yield json.loads(line)
                    except ValueError:
                        pass
        except (OSError, EOFError):
            pass


def _chicago_offset(ts):
    """UTC offset hours for America/Chicago without tzdata (US DST rules)."""
    d = datetime.fromtimestamp(ts, timezone.utc)

    def nth_sunday(y, m, n):
        first = datetime(y, m, 1, tzinfo=timezone.utc)
        return first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))
    start = nth_sunday(d.year, 3, 2).replace(hour=8)    # 2:00 CST = 08:00 UTC
    end = nth_sunday(d.year, 11, 1).replace(hour=7)     # 2:00 CDT = 07:00 UTC
    return -5 if start <= d < end else -6


def how_bucket(ts):
    """dow*24+hour in America/Chicago, Monday=0 (matches web/predict.js)."""
    d = datetime.fromtimestamp(ts + _chicago_offset(ts) * 3600, timezone.utc)
    return d.weekday() * 24 + d.hour


def dist_m(a_lat, a_lon, b_lat, b_lon):
    dy = (a_lat - b_lat) * 111320.0
    dx = (a_lon - b_lon) * 111320.0 * math.cos(math.radians((a_lat + b_lat) / 2))
    return math.hypot(dx, dy)


def vts(o):
    return o.get("vt") or o["t"]


def extract_events(obs, stops, route_stops, radius=RADIUS_M):
    """-> {(vehicle, trip): {"route", "ev": [(stop_id, ts)]}} ordered by time.
    Ground truth: closest-approach poll within `radius` m of a stop on the route;
    fallback: when current_stop_sequence advances, the previous stop was just left
    (Passio's stop_id is the NEXT stop the vehicle is heading to)."""
    by = defaultdict(list)
    for o in obs:
        if o.get("k") == "v" and o.get("tr") and o.get("la") is not None:
            by[(o.get("id"), o["tr"])].append(o)
    out = {}
    for key, lst in by.items():
        lst.sort(key=vts)
        route = lst[0].get("r")
        cand = list(dict.fromkeys(s for s in route_stops.get(route, ()) if s in stops))
        if not cand:
            continue
        ev, run = [], None   # run = [stop, best_d, best_ts]
        for o in lst:
            best = None
            for s in cand:
                d = dist_m(o["la"], o["lo"], stops[s]["lat"], stops[s]["lon"])
                if d <= radius and (best is None or d < best[1]):
                    best = (s, d)
            if best and run and run[0] == best[0]:
                if best[1] < run[1]:
                    run[1], run[2] = best[1], vts(o)
            else:
                if run:
                    ev.append((run[0], run[2]))
                run = [best[0], best[1], vts(o)] if best else None
        if run:
            ev.append((run[0], run[2]))
        seen = {s for s, _ in ev}
        prev = None
        for o in lst:   # sequence-advance fallback
            if prev and o.get("q") is not None and prev.get("q") is not None and 0 < o["q"] - prev["q"] <= 2 \
                    and prev.get("s") in cand and prev["s"] not in seen:
                ev.append((prev["s"], vts(o)))
                seen.add(prev["s"])
            prev = o
        ev.sort(key=lambda e: e[1])
        if ev:
            out[key] = {"route": route, "ev": ev}
    return out


def segment_samples(events, route_stops, seg_sched):
    """-> list of (route, seg_index, seconds, ts_end) from consecutive events on adjacent route stops."""
    res = []
    for tr in events.values():
        r, ev = tr["route"], tr["ev"]
        order = route_stops.get(r) or []
        sch = seg_sched.get(r) or {}
        dwell = sch.get("dwell") or 0
        segs = sch.get("seg") or []
        for (a, ta), (b, tb) in zip(ev, ev[1:]):
            idx = [i for i in range(len(order) - 1) if order[i] == a and order[i + 1] == b]
            if len(idx) != 1:
                continue
            i = idx[0]
            sec = tb - ta - dwell
            s0 = segs[i] if i < len(segs) else None
            if sec < 5 or sec > 3600 or (s0 is not None and sec > MAX_SEG_FACTOR * s0 + 600):
                continue
            res.append((r, i, sec, tb))
    return res


def pct(v, q):
    v = sorted(v)
    k = (len(v) - 1) * q
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def build_model(samples, min_bucket=3):
    """Aggregate samples into the learned.json 'routes' structure."""
    allv, hv = defaultdict(list), defaultdict(list)
    for r, i, sec, ts in samples:
        allv[(r, i)].append(sec)
        hv[(r, i)].append((how_bucket(ts), sec))
    routes = {}
    for (r, i), v in allv.items():
        e = {"a": [round(statistics.median(v)), len(v), round(pct(v, .1)), round(pct(v, .9))]}
        buckets = defaultdict(list)
        for b, sec in hv[(r, i)]:
            buckets[b].append(sec)
        h = {str(b): [round(statistics.median(x)), len(x)] for b, x in buckets.items() if len(x) >= min_bucket}
        if h:
            e["h"] = h
        routes.setdefault(r, {"s": {}})["s"][str(i)] = e
    return routes


def predictions(obs):
    """-> list of (poll_t, trip, route, [(seq, stop_id, predicted_ts)])"""
    return [(o["t"], o["tr"], o.get("r"), o["p"]) for o in obs if o.get("k") == "p"]

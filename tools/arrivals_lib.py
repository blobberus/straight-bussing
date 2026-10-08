"""Shared helpers for the ground-truth arrival logger (stdlib only).

Schema, geometry (distance along the route shape), America/Chicago time without tzdata,
CSV row formatting and tail reader. The arrival detector itself is tools/arrival_detector.py.
"""
import csv, io, json, math
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "data"
DEFAULT_OUT = ROOT / "data" / "ground_truth" / "arrivals.csv"

COLUMNS = ("epoch,ts_utc,local_time,dow,hour,minute_of_day,route_id,route_name,trip_id,vehicle_id,stop_id,"
           "stop_name,stop_address,stop_lat,stop_lon,stop_index,prev_stop_id,dist_prev_m,prev_arrival_epoch,"
           "segment_s,speed_mps,dwell_s,passio_pred_epoch,passio_pred_lead_s,source").split(",")

RADIUS_M = 40.0          # proximity arrival radius
STOP_SPEED = 1.0         # m/s: "stopped" threshold for proximity arrivals
DEPART_SPEED = 2.0       # m/s: moving this fast (or leaving the radius) ends the dwell
NEAR_M = 120.0           # a passing report this close can still time a transition
MAX_GAP = 60             # s: longest report gap we interpolate a transition across
MAX_SKIP = 3             # stop_id may jump this many stops forward (skipped / missed stops)
SAME_VISIT_S = 900       # same vehicle + same stop with nothing in between within 15 min = one visit
MAX_SPEED = 30.0         # m/s: segment speeds above this are timing artefacts (left blank)
MIN_PRED_AGE = 120       # predictions must be >= this old at arrival to count
STATE_TTL = 3600         # forget a (vehicle, trip) after this many seconds silent
HIST = 8                 # recent reports kept per (vehicle, trip) for back-dating arrivals

try:
    from zoneinfo import ZoneInfo
    _CHI = ZoneInfo("America/Chicago")
    datetime.fromtimestamp(0, _CHI)
except Exception:        # no tzdata (Windows): hand-written US rule
    _CHI = None


def _nth_sunday(y, m, n):
    first = datetime(y, m, 1, tzinfo=timezone.utc)
    return first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))


def chicago(epoch, force_rule=False):
    """-> naive local datetime (America/Chicago) for a UTC epoch (zoneinfo, else US DST rule)."""
    if _CHI is not None and not force_rule:
        return datetime.fromtimestamp(epoch, _CHI).replace(tzinfo=None)
    d = datetime.fromtimestamp(epoch, timezone.utc)
    start = _nth_sunday(d.year, 3, 2).replace(hour=8)   # 2:00 CST = 08:00 UTC
    end = _nth_sunday(d.year, 11, 1).replace(hour=7)    # 2:00 CDT = 07:00 UTC
    off = -5 if start <= d < end else -6
    return (d + timedelta(hours=off)).replace(tzinfo=None)


def hav_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 12742000.0 * math.asin(math.sqrt(a))


def load_json(p, default=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return default


class Static:
    """Static network data + per-route along-shape cumulative stop distances."""

    def __init__(self, web_data=WEB_DATA):
        web_data = Path(web_data)
        self.stops = load_json(web_data / "stops.json", {})
        self.route_stops = load_json(web_data / "route_stops.json", {})
        self.routes = load_json(web_data / "routes.json", {})
        self.shapes = load_json(web_data / "shapes.json", {})
        self.addr = load_json(web_data / "stop_addresses.json", {})
        self._cum = {}

    def route_name(self, rid):
        r = self.routes.get(rid) or {}
        return r.get("long") or r.get("short") or str(rid)

    def address(self, sid):
        a = self.addr.get(sid) or {}
        return a.get("address") or (self.stops.get(sid) or {}).get("name", "")

    def stop_cum(self, rid):
        """Cumulative along-shape metres per entry of route_stops[rid] (None if no shape)."""
        if rid not in self._cum:
            try:
                self._cum[rid] = self._compute_cum(rid)
            except Exception:
                self._cum[rid] = None
        return self._cum[rid]

    def _compute_cum(self, rid):
        order = self.route_stops.get(rid) or []
        lines = [ln for ln in (self.shapes.get(rid) or []) if len(ln) > 1]
        if not order or not lines:
            return None
        longest = max(lines, key=len)
        pts = longest if len(longest) > 0.6 * sum(map(len, lines)) else [p for ln in lines for p in ln]
        kx = 111320.0 * math.cos(math.radians(pts[0][0]))
        xy = [(p[1] * kx, p[0] * 111320.0) for p in pts]
        cum, tot = [0.0], 0.0
        for a, b in zip(xy, xy[1:]):
            tot += math.hypot(b[0] - a[0], b[1] - a[1])
            cum.append(tot)
        res, prev = [], -1e9
        for sid in order:
            s = self.stops.get(sid)
            if not s:
                res.append(None)
                continue
            sx, sy = s["lon"] * kx, s["lat"] * 111320.0
            cands = []
            for i in range(len(xy) - 1):
                (ax, ay), (bx, by) = xy[i], xy[i + 1]
                dx, dy = bx - ax, by - ay
                L2 = dx * dx + dy * dy
                t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((sx - ax) * dx + (sy - ay) * dy) / L2))
                d = math.hypot(ax + t * dx - sx, ay + t * dy - sy)
                cands.append((d, cum[i] + t * math.sqrt(L2)))
            best = min(c[0] for c in cands)
            ok = [c for c in cands if c[0] <= best + 25 and c[1] >= prev - 5]
            pos = min(ok, key=lambda c: c[1])[1] if ok else min(cands)[1]
            res.append(pos)
            prev = max(prev, pos)
        return res

    def dist_between(self, rid, i, j):
        """Metres along the route from stop index i to j (i<j) -> (metres, 'shape'|'haversine')."""
        order = self.route_stops.get(rid) or []
        a, b = self.stops.get(order[i]), self.stops.get(order[j])
        hav = hav_m(a["lat"], a["lon"], b["lat"], b["lon"]) if a and b else None
        cum = self.stop_cum(rid)
        if cum and cum[i] is not None and cum[j] is not None:
            d = cum[j] - cum[i]
            if d > 0 and (hav is None or 0.9 * hav <= d <= 4 * hav + 200):
                return d, "shape"
        if hav is not None:
            return hav * 1.15, "haversine"
        return None, None


def fmt_row(st, e):
    """e: dict epoch,route,trip,veh,idx,source,prev({idx,epoch,dwell}|None),dwell,pred((epoch,lead)|None)."""
    rid, idx = e["route"], e["idx"]
    sid = st.route_stops[rid][idx]
    s = st.stops[sid]
    local = chicago(e["epoch"])
    prev = e.get("prev")
    dist = seg = speed = pe = psid = ""
    if prev:
        d, _ = st.dist_between(rid, prev["idx"], idx)
        seg_s = e["epoch"] - prev["epoch"]
        psid, pe, seg = st.route_stops[rid][prev["idx"]], prev["epoch"], seg_s
        if d:
            dist = round(d, 1)
            eff = seg_s - (prev.get("dwell") or (prev.get("visit") or {}).get("dwell") or 0)
            if eff > 0 and d / eff <= MAX_SPEED:      # implausible (timing jitter) -> blank
                speed = round(d / eff, 2)
    pred = e.get("pred")
    return [e["epoch"], datetime.fromtimestamp(e["epoch"], timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            local.strftime("%Y-%m-%d %H:%M:%S"), local.weekday(), local.hour, local.hour * 60 + local.minute,
            rid, st.route_name(rid), e["trip"], e["veh"], sid, s.get("name", ""), st.address(sid),
            s["lat"], s["lon"], idx, psid, dist, pe, seg, speed,
            "" if e.get("dwell") is None else e["dwell"],
            pred[0] if pred else "", pred[1] if pred else "", e["source"]]


def row_text(row):
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerow(row)
    return buf.getvalue()


def read_tail(path, nbytes=600_000):
    """Parse the last ~nbytes of the CSV -> list of header-keyed dicts ([] if missing)."""
    p = Path(path)
    if not p.exists() or p.stat().st_size == 0:
        return []
    with open(p, "rb") as f:
        size = f.seek(0, 2)
        f.seek(max(0, size - nbytes))
        data = f.read().decode("utf-8", "replace")
    lines = data.splitlines()
    if size > nbytes:
        lines = lines[1:]
    return [dict(zip(COLUMNS, r)) for r in csv.reader(lines) if len(r) == len(COLUMNS) and r[0] != "epoch"]

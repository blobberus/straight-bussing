"""Shared building blocks for the arrival/speed models (stdlib only, no numpy).

Loads data/ground_truth/arrivals.csv (schema: docs/DATA.md, written by tools/truth_logger.py),
derives the run time and true speed of every observed segment, buckets time DST-safely, robust
statistics and forecast metrics.  Math and notation: docs/ALGORITHMS.md.

Row semantics (matches tools/arrivals_lib.fmt_row):
  segment_s = epoch - prev_arrival_epoch            arrival-to-arrival, INCLUDES the dwell at prev stop
  dwell_s   = dwell at THIS stop (known after the bus leaves it)
  run       = segment_s - dwell(prev stop)          time actually moving   -> speed v = d / run
"""
import csv, math, statistics
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "data"
GT_DIR = ROOT / "data" / "ground_truth"
REAL_CSV = GT_DIR / "arrivals.csv"
SYNTH_CSV = GT_DIR / "synthetic_arrivals.csv"
MIN_REAL_ROWS = 200
PERIODS = ("night", "am", "mid", "pm", "eve")
Z80 = 1.2815515655446004          # N(0,1) 90th percentile -> 80% central interval is exp(mu +- Z80*sigma)
MIN_RUN_S = 3.0                   # below this a "segment" is a GPS glitch
MAX_SEG_S = 1800.0                # longer = layover / detour / bus parked; not a travel time
MAX_SPEED = 30.0                  # m/s (108 km/h): faster is impossible for a campus shuttle

try:
    from zoneinfo import ZoneInfo
    _TZ = ZoneInfo("America/Chicago")
except Exception:                 # no tz database: fall back to the US rule below
    _TZ = None


class Row:
    """One observed segment traversal prev_stop -> stop (see module docstring)."""
    __slots__ = ("epoch", "route", "trip", "vehicle", "prev", "stop", "idx", "dist", "prev_epoch",
                 "seg_s", "dwell", "dwell_here", "run", "speed", "how", "dp", "passio", "lead",
                 "lat", "lon", "source")

    @property
    def key(self):
        return (self.route, self.prev, self.stop)


def _f(x, default=None):
    try:
        v = float(x)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


# ---------- time buckets (DST-safe) ----------
def period_of(hour):
    return 0 if hour < 6 else 1 if hour < 10 else 2 if hour < 15 else 3 if hour < 19 else 4


def daypart(dow, hour):
    """(weekend?, period) -> small int 0..9. Monday = dow 0."""
    return (1 if dow >= 5 else 0) * 5 + period_of(hour)


def daypart_name(dp):
    return ("weekend " if dp >= 5 else "weekday ") + PERIODS[dp % 5]


def parse_local(s):
    """'YYYY-MM-DD HH:MM[:SS][+-offset]' or ISO with 'T' -> (dow Mon=0, hour, minute) or None.
    We read the wall-clock digits as written, so a DST change never shifts the bucket."""
    try:
        s = s.strip()
        y, m, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
        h, mi = int(s[11:13]), int(s[14:16])
        if not (0 <= h < 24 and 0 <= mi < 60):
            return None
        return date(y, m, d).weekday(), h, mi
    except (ValueError, IndexError, AttributeError):
        return None


def _us_central_offset_h(utc):
    """-5 during US DST (2nd Sunday of March 02:00 local -> 1st Sunday of November 02:00), else -6."""
    y = utc.year
    mar = datetime(y, 3, 8, tzinfo=timezone.utc)
    start = mar + timedelta(days=(6 - mar.weekday()) % 7, hours=8)       # 02:00 CST = 08:00 UTC
    nov = datetime(y, 11, 1, tzinfo=timezone.utc)
    end = nov + timedelta(days=(6 - nov.weekday()) % 7, hours=7)         # 02:00 CDT = 07:00 UTC
    return -5 if start <= utc < end else -6


def chicago(epoch):
    """Unix seconds -> naive-looking aware datetime in America/Chicago wall-clock time."""
    utc = datetime.fromtimestamp(float(epoch), timezone.utc)
    if _TZ is not None:
        return utc.astimezone(_TZ)
    return utc + timedelta(hours=_us_central_offset_h(utc))


def how_bucket(dow, hour):
    """Hour-of-week bucket 0..167, Monday 00:00 = 0 (same convention as the web predictor)."""
    return int(dow) * 24 + int(hour)


def how_of_epoch(epoch):
    t = chicago(epoch)
    return how_bucket(t.weekday(), t.hour)


def haversine(lat1, lon1, lat2, lon2):
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# ---------- loading ----------
def make_row(d, prev_dwell=None):
    """CSV dict -> Row, or None if unusable (first stop of a trip, bad numbers, layover, glitch).
    prev_dwell: dwell at the previous stop if the caller knows it (load_rows looks it up)."""
    ep, pe = _f(d.get("epoch")), _f(d.get("prev_arrival_epoch"))
    seg = _f(d.get("segment_s"))
    if seg is None and ep is not None and pe is not None:
        seg = ep - pe
    if ep is None or pe is None or seg is None or seg <= 0 or seg > MAX_SEG_S or not d.get("prev_stop_id"):
        return None
    dist = _f(d.get("dist_prev_m"), 0.0) or 0.0
    if dist <= 0:
        return None
    r = Row()
    r.epoch, r.prev_epoch, r.seg_s, r.dist = ep, pe, seg, dist
    r.route, r.trip, r.vehicle = str(d.get("route_id", "")), str(d.get("trip_id", "")), str(d.get("vehicle_id", ""))
    r.prev, r.stop = str(d["prev_stop_id"]), str(d.get("stop_id", ""))
    r.idx = int(_f(d.get("stop_index"), -1))
    r.lat, r.lon = _f(d.get("stop_lat")), _f(d.get("stop_lon"))
    r.dwell_here = _f(d.get("dwell_s"))
    r.source = str(d.get("source", ""))
    sp = _f(d.get("speed_mps"))
    if prev_dwell is not None and 0 <= prev_dwell < seg:
        r.dwell = prev_dwell
    elif sp and sp > 0:                       # logger already removed the previous dwell: run = d / v
        r.dwell = max(0.0, seg - dist / sp)
    else:
        r.dwell = None                        # unknown; load_rows fills a route median
    r.run = seg - (r.dwell or 0.0)
    if r.run < MIN_RUN_S:
        return None
    r.speed = dist / r.run
    if r.speed > MAX_SPEED:
        return None
    loc = parse_local(d.get("local_time", ""))
    if loc is None:
        dow, hour = _f(d.get("dow")), _f(d.get("hour"))
        if dow is not None and hour is not None:
            loc = (int(dow) % 7, int(hour) % 24, 0)
        else:
            t = chicago(ep)
            loc = (t.weekday(), t.hour, t.minute)
    r.how, r.dp = how_bucket(loc[0], loc[1]), daypart(loc[0], loc[1])
    r.passio = _f(d.get("passio_pred_epoch"))
    r.lead = _f(d.get("passio_pred_lead_s"))
    return r


def rows_from_dicts(dicts):
    """list[dict] -> list[Row] sorted by epoch, with the previous stop's dwell joined in."""
    dicts = list(dicts)
    dwell_at = {}
    for d in dicts:
        dw, ep = _f(d.get("dwell_s")), _f(d.get("epoch"))
        if dw is not None and ep is not None:
            dwell_at[(str(d.get("trip_id", "")), str(d.get("stop_id", "")), int(ep))] = dw
    rows = []
    for d in dicts:
        pe = _f(d.get("prev_arrival_epoch"))
        pd = dwell_at.get((str(d.get("trip_id", "")), str(d.get("prev_stop_id", "")), int(pe))) if pe is not None else None
        r = make_row(d, pd)
        if r is not None:
            rows.append(r)
    by_route = {}
    for r in rows:
        if r.dwell is not None:
            by_route.setdefault(r.route, []).append(r.dwell)
    med = {k: statistics.median(v) for k, v in by_route.items()}
    keep = []
    for r in rows:
        if r.dwell is None:
            r.dwell = min(med.get(r.route, 0.0), 0.5 * r.seg_s)
            r.run = r.seg_s - r.dwell
            r.speed = r.dist / r.run
        keep.append(r)
    keep.sort(key=lambda r: (r.epoch, r.trip))
    return keep


def read_dicts(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def load_rows(path):
    """Read an arrivals CSV -> list[Row] sorted by arrival epoch (first stops of trips skipped)."""
    return rows_from_dicts(read_dicts(path))


def count_rows(path):
    p = Path(path)
    if not p.exists():
        return 0
    with open(p, encoding="utf-8") as fh:
        return max(0, sum(1 for _ in fh) - 1)


def find_data(explicit=None, min_rows=MIN_REAL_ROWS, allow_synthetic=True):
    """(path, kind). Explicit path wins; else real arrivals.csv with >= min_rows; else synthetic."""
    if explicit:
        p = Path(explicit)
        return (p, "synthetic" if "synth" in p.name else "real") if p.exists() else (None, None)
    if count_rows(REAL_CSV) >= min_rows:
        return REAL_CSV, "real"
    if allow_synthetic and count_rows(SYNTH_CSV) > 0:
        return SYNTH_CSV, "synthetic"
    return None, None


# ---------- robust statistics ----------
def median(v):
    return statistics.median(v)


def quantile(v, q):
    """Linear-interpolated quantile of an unsorted list."""
    s = sorted(v)
    if not s:
        return float("nan")
    k = (len(s) - 1) * q
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def mad_sigma(v):
    """Robust standard deviation: 1.4826 * median absolute deviation (= sd for a normal)."""
    m = statistics.median(v)
    return 1.4826 * statistics.median(abs(x - m) for x in v)


def log_stats(times):
    """Robust log-normal fit: (mu, sigma) = (median(log t), 1.4826*MAD(log t)); sigma None if n < 3."""
    lg = [math.log(max(t, MIN_RUN_S)) for t in times]
    mu = statistics.median(lg)
    return mu, (mad_sigma(lg) if len(lg) >= 3 else None)


def harmonic_speed(dists, times):
    """Space-mean (harmonic) speed = sum(d) / sum(t). NOT the mean of d/t (that over-weights fast hops)."""
    st = sum(times)
    return sum(dists) / st if st > 0 else None


def solve(A, b):
    """Gaussian elimination with partial pivoting for small dense systems."""
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        if abs(M[p][c]) < 1e-12:
            return [0.0] * n
        M[c], M[p] = M[p], M[c]
        for r in range(c + 1, n):
            f = M[r][c] / M[c][c]
            for k in range(c, n + 1):
                M[r][k] -= f * M[c][k]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        x[r] = (M[r][n] - sum(M[r][k] * x[k] for k in range(r + 1, n))) / M[r][r]
    return x


# ---------- metrics (e = prediction - actual) ----------
def mae(e):
    return sum(abs(x) for x in e) / len(e) if e else float("nan")


def rmse(e):
    return math.sqrt(sum(x * x for x in e) / len(e)) if e else float("nan")


def mape(e, y, floor=10.0):
    """Mean absolute percentage error, ignoring actuals below `floor` seconds (division blow-up)."""
    v = [abs(a) / b for a, b in zip(e, y) if b >= floor]
    return 100.0 * sum(v) / len(v) if v else float("nan")


def pinball(y, q_pred, tau):
    """Quantile (pinball) loss of predicting quantile tau as q_pred when the truth is y."""
    d = y - q_pred
    return tau * d if d >= 0 else (tau - 1) * d


def coverage(y, lo, hi):
    return sum(1 for a, l, h in zip(y, lo, hi) if l <= a <= h) / len(y) if y else float("nan")


def time_split(rows, frac=0.7):
    """Time-ordered split (rows sorted by epoch): train = earliest frac, test = the rest. No shuffling."""
    c = int(len(rows) * frac)
    return rows[:c], rows[c:]


def rolling_origins(n, folds=4, min_train=0.4):
    """Expanding-window folds [(train_end, test_end)]: train rows[:train_end], test rows[train_end:test_end]."""
    start = int(n * min_train)
    step = max(1, (n - start) // folds)
    out = []
    for f in range(folds):
        lo = start + f * step
        hi = n if f == folds - 1 else lo + step
        if lo < hi:
            out.append((lo, hi))
    return out

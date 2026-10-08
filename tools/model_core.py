"""Shared building blocks for the arrival/speed models (stdlib only).

Loads data/ground_truth/arrivals.csv, derives features, buckets time DST-safely, robust stats.
Math: docs/ALGORITHMS.md.  Row = one observed bus arrival at stop_id coming from prev_stop_id.
"""
import csv, math, statistics
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "data"
GT_DIR = ROOT / "data" / "ground_truth"
PERIODS = ("night", "am", "mid", "pm", "eve")
Z80 = 1.2815515655446004          # N(0,1) 90th percentile -> 80% central interval
MIN_RUN_S = 1.0


class Row:
    """One observed segment traversal (prev_stop -> stop)."""
    __slots__ = ("epoch", "route", "trip", "vehicle", "prev", "stop", "idx", "dist", "prev_epoch",
                 "seg_s", "dwell", "run", "speed", "how", "dp", "passio", "lead", "lat", "lon")

    @property
    def key(self):
        return (self.route, self.prev, self.stop)


def _f(x, default=None):
    try:
        v = float(x)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


def period_of(hour):
    return 0 if hour < 6 else 1 if hour < 10 else 2 if hour < 15 else 3 if hour < 19 else 4


def daypart(dow, hour):
    """(weekend?, period) -> small int 0..9. Monday = dow 0."""
    return (1 if dow >= 5 else 0) * 5 + period_of(hour)


def daypart_name(dp):
    return ("weekend " if dp >= 5 else "weekday ") + PERIODS[dp % 5]


def parse_local(s):
    """'YYYY-MM-DD HH:MM[:SS][+-offset]' or ISO with 'T' -> (dow Mon=0, hour, minute) or None.
    We read the wall-clock digits as written, so DST never shifts the bucket."""
    try:
        s = s.strip()
        y, m, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
        return date(y, m, d).weekday(), int(s[11:13]), int(s[14:16])
    except (ValueError, IndexError, AttributeError):
        return None


def how_bucket(dow, hour):
    """Hour-of-week bucket 0..167, Monday 00:00 = 0 (same as web/predict.js)."""
    return dow * 24 + hour


def haversine(lat1, lon1, lat2, lon2):
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def make_row(d):
    """dict with CSV column names -> Row, or None if unusable (first segment of a trip, bad numbers)."""
    ep, pe = _f(d.get("epoch")), _f(d.get("prev_arrival_epoch"))
    seg = _f(d.get("segment_s"))
    if ep is None or pe is None or seg is None or seg <= 0 or not d.get("prev_stop_id"):
        return None
    r = Row()
    r.epoch, r.prev_epoch, r.seg_s = ep, pe, seg
    r.route, r.trip, r.vehicle = str(d.get("route_id", "")), str(d.get("trip_id", "")), str(d.get("vehicle_id", ""))
    r.prev, r.stop = str(d["prev_stop_id"]), str(d.get("stop_id", ""))
    r.idx = int(_f(d.get("stop_index"), -1))
    r.lat, r.lon = _f(d.get("stop_lat")), _f(d.get("stop_lon"))
    r.dist = _f(d.get("dist_prev_m"), 0.0)
    r.dwell = max(0.0, _f(d.get("dwell_s"), 0.0))
    # run time = arrival-to-arrival minus dwell at the previous stop; v = d / run (docs: section 3)
    r.run = max(MIN_RUN_S, seg - r.dwell)
    sp = _f(d.get("speed_mps"))
    r.speed = sp if sp and sp > 0 else (r.dist / r.run if r.dist and r.dist > 0 else None)
    loc = parse_local(d.get("local_time", ""))
    if loc is None:
        dow, hour = _f(d.get("dow")), _f(d.get("hour"))
        if dow is None or hour is None:
            return None
        loc = (int(dow) % 7, int(hour) % 24, 0)
    r.how, r.dp = how_bucket(loc[0], loc[1]), daypart(loc[0], loc[1])
    pe_ = _f(d.get("passio_pred_epoch"))
    r.passio = pe_
    r.lead = _f(d.get("passio_pred_lead_s"))
    return r


def load_rows(path):
    """Read the CSV -> list[Row] sorted by arrival epoch. Rows with no previous stop are skipped."""
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        for d in csv.DictReader(fh):
            r = make_row(d)
            if r is not None and r.dist and r.dist > 0:
                rows.append(r)
    rows.sort(key=lambda r: r.epoch)
    return rows


def find_data(explicit=None, min_rows=200):
    """(path, kind). Prefers real arrivals.csv with enough rows, then a synthetic file, else None."""
    cands = [(Path(explicit), "explicit")] if explicit else [
        (GT_DIR / "arrivals.csv", "real"), (GT_DIR / "synthetic_arrivals.csv", "synthetic")]
    for p, kind in cands:
        if p.exists():
            try:
                n = sum(1 for _ in open(p, encoding="utf-8")) - 1
            except OSError:
                continue
            if n >= min_rows or explicit:
                return p, kind
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
    """Robust sd: 1.4826 * median absolute deviation."""
    m = statistics.median(v)
    return 1.4826 * statistics.median(abs(x - m) for x in v)


def log_stats(times):
    """Robust log-normal fit: (mu, sigma) = (median(log t), 1.4826*MAD(log t)). n>=3 for sigma else None."""
    lg = [math.log(max(t, MIN_RUN_S)) for t in times]
    mu = statistics.median(lg)
    return mu, (mad_sigma(lg) if len(lg) >= 3 else None)


def harmonic_speed(dists, times):
    """Space-mean (harmonic) speed = sum(d) / sum(t). NOT the mean of d/t (which over-weights fast, short hops)."""
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


# ---------- metrics ----------
def mae(e):
    return sum(abs(x) for x in e) / len(e) if e else float("nan")


def rmse(e):
    return math.sqrt(sum(x * x for x in e) / len(e)) if e else float("nan")


def mape(e, y, floor=10.0):
    v = [abs(a) / b for a, b in zip(e, y) if b >= floor]
    return 100.0 * sum(v) / len(v) if v else float("nan")


def pinball(y, q_pred, tau):
    d = y - q_pred
    return tau * d if d >= 0 else (tau - 1) * d


def coverage(y, lo, hi):
    return sum(1 for a, l, h in zip(y, lo, hi) if l <= a <= h) / len(y) if y else float("nan")


def time_split(rows, frac=0.7):
    """Time-ordered split (rows sorted by epoch): train = earliest frac, test = the rest. No shuffling."""
    c = int(len(rows) * frac)
    return rows[:c], rows[c:]

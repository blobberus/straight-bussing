#!/usr/bin/env python3
"""E31 (2026-11-11): lines with LARGE prediction misses. Shared rules, loaders and small statistics (stdlib only).

Owner, 2026-11-11: "The analysis should check for ... lines that have large prediction misses. Create or indicate
wherever appropriate for another agent to analyze and notice and account for this data. Flag these lines".

What is scored: Passio's time on display (what Straight Bussing shows riders), from data/ground_truth/predictions.csv
(one row per arrival and lead: the newest prediction the collector had seen `lead_target_s` before the arrival and
still shown then; the archive file data/ground_truth/archive/predictions-*.csv holds the older rows). The goal leads
are 5, 10, 15, 20 and 30 min (under 10 min the goal is measured ONCE per arrival, at 5 min ahead: GOAL-AND-METHOD 1.1);
1, 2 and 3 min are diagnostics only.

err = predicted - actual (seconds). Positive = the bus came EARLIER than shown: a rider who trusted the time can miss
the bus (the "too late" side of the goal, the dangerous one). Negative = the bus came later than shown (the rider waits).

THE LARGE-MISS RULE (E31): a prediction shown L before the arrival is a large miss when it is off by MORE than twice the
owner's allowed error at that lead (arrivals_lib.shrink_tol: 1 min under 20 min ahead, 2 min at 20, 3 min at 30), capped
at 5 min: threshold 2 min at 5, 10 and 15 min ahead, 4 min at 20, 5 min at 30 (and 2 min at the 1 to 3 min
diagnostics). Direction: `bus_early` (err > +threshold) or `bus_late` (err < -threshold). Gross misses (E19: more than
10 min or half the lead off) are large misses too and are NOT set aside here: riders saw them; they are also counted
on their own (`gross`).
"""
import csv, gzip, random, sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))
import arrivals_lib as L          # noqa: E402  (shrink_tol, chicago: the goal is never reimplemented here)

GOAL_LEADS = (300, 600, 900, 1200, 1800)        # the goal's points in predictions.csv (under 10 min: 5 min ahead)
DIAG_LEADS = (60, 120, 180)                      # diagnostics only, never part of the goal or a flag
ALL_LEADS = DIAG_LEADS + GOAL_LEADS
LARGE_FACTOR = 2                                 # large = more than twice the goal's allowed error ...
LARGE_CAP_S = 300                                # ... capped at 5 minutes
EARLY, LATE = "bus_early", "bus_late"
DOW = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
NIGHT = "10 PM to 5 AM"
HOUR_BUCKETS = ((5, NIGHT), (7, "5 to 7 AM"), (10, "7 to 10 AM"), (15, "10 AM to 3 PM"), (19, "3 to 7 PM"),
                (22, "7 to 10 PM"))          # the clock ranges of algorithm-test/lateness.py hour_bucket (E26)
AGE_BUCKETS = ((60, "under 1 min"), (120, "1 to 2 min"), (300, "2 to 5 min"), (900, "5 to 15 min"))


# ---------------------------------------------------------------- the rule
def large_threshold_s(lead_s):
    """Seconds off beyond which a prediction shown lead_s before the arrival is a LARGE miss."""
    return min(LARGE_FACTOR * L.shrink_tol(lead_s), LARGE_CAP_S)


def direction(err_s, lead_s):
    """-> 'bus_early' (the bus came more than the threshold EARLIER than shown), 'bus_late', or '' (not large)."""
    thr = large_threshold_s(lead_s)
    if err_s > thr:
        return EARLY
    if err_s < -thr:
        return LATE
    return ""


def gross(err_s, lead_s):
    """E19 gross miss (tools/build_eta_dataset.py GROSS): more than 10 min or half the lead off."""
    return abs(err_s) > max(600.0, 0.5 * lead_s)


def passes(err_s, lead_s):
    """The owner's goal (the 10 minute shrink) on one prediction; gross misses never pass."""
    return not gross(err_s, lead_s) and abs(err_s) <= L.shrink_tol(lead_s)


def band_b(err_s, lead_s):
    """Band B (GOAL-AND-METHOD 1.2): the allowed error too early to 1% of the lead too late, gross aside."""
    return not gross(err_s, lead_s) and -L.shrink_tol(lead_s) <= err_s <= 0.01 * lead_s


def too_late(err_s, lead_s):
    """Shown more than 1% of the lead later than the bus came (the goal's 'too late', reading B)."""
    return err_s > 0.01 * lead_s


# ---------------------------------------------------------------- time slices
def service_day(epoch):
    """Chicago date with the night service (before 04:00) counted to the previous day (build_eta_dataset)."""
    return (L.chicago(int(epoch)) - timedelta(hours=4)).date().isoformat()


def day_type(day):
    wd = date.fromisoformat(day).weekday()
    return "sat" if wd == 5 else "sun" if wd == 6 else "weekday"


def week_of(day):
    """Monday of the service day's week (YYYY-MM-DD): the weekly-trend key."""
    d = date.fromisoformat(day)
    return (d - timedelta(days=d.weekday())).isoformat()


def hour_bucket(hour):
    """Chicago clock hour of the arrival -> E26's ranges (rush hours 7 to 10 AM and 3 to 7 PM)."""
    for below, name in HOUR_BUCKETS:
        if hour < below:
            return name
    return NIGHT


def age_bucket(age_s):
    """Age of the shown prediction at the moment it was on display (pred_lead_s - lead_target_s)."""
    if age_s is None:
        return "unknown"
    for below, name in AGE_BUCKETS:
        if age_s < below:
            return name
    return "15 min or more"


def local_text(epoch):
    return L.chicago(int(epoch)).strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------- loading
def _open(p):
    p = Path(p)
    return gzip.open(p, "rt", encoding="utf-8", newline="") if p.suffix == ".gz" else open(p, encoding="utf-8",
                                                                                           newline="")


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def load_predictions(paths, day_from=None, day_to=None, leads=ALL_LEADS):
    """predictions.csv files (oldest first: the archive, then the current file) -> list of dicts, one per (vehicle,
    stop, arrival epoch, lead_target_s); a later file's row replaces an earlier one (the files overlap by minutes).
    Adds: lead (int), err (float s), day, and age_s (how old the shown prediction was then)."""
    best = {}
    for p in paths:
        with _open(p) as f:
            for r in csv.DictReader(f):
                try:
                    lead, err, ep = int(r["lead_target_s"]), float(r["pred_minus_actual_s"]), int(r["epoch"])
                except (KeyError, TypeError, ValueError):
                    continue
                if lead not in leads:
                    continue
                day = service_day(ep)
                if (day_from and day < day_from) or (day_to and day > day_to):
                    continue
                pl = num(r.get("pred_lead_s"))
                r.update(lead=lead, err=err, epoch_i=ep, day=day, age_s=None if pl is None else pl - lead)
                best[(r["vehicle_id"], r["stop_id"], ep, lead)] = r
    return list(best.values())


def load_arrivals(path, t_from=None, day_to=None, skip_sources=("gps",)):
    """arrivals.csv -> list of dicts (epoch_i, day) from epoch t_from on; GPS-sweep rows are skipped by default: the
    collector never looks up a Passio time for them (arrival_detector, source 'gps'), so they say nothing about
    coverage."""
    out = []
    with _open(path) as f:
        for r in csv.DictReader(f):
            try:
                ep = int(r["epoch"])
            except (KeyError, TypeError, ValueError):
                continue
            if (t_from and ep < t_from) or r.get("source") in skip_sources:
                continue
            day = service_day(ep)
            if day_to and day > day_to:
                continue
            r.update(epoch_i=ep, day=day)
            out.append(r)
    return out


def load_routes(path=ROOT / "web" / "data" / "routes.json"):
    return L.load_json(path, {}) or {}


# ---------------------------------------------------------------- statistics
def rate(k, n):
    return k / n if n else None


def boot_ci(by_day, boots=2000, seed=7):
    """by_day {day: (k, n)} -> (lo, hi) 95% range of sum(k)/sum(n), resampling whole days; days are the unit of noise
    (GOAL-AND-METHOD 2.5). None if no data."""
    days = [v for v in by_day.values() if v[1]]
    if not days:
        return None
    rnd = random.Random(seed)
    vals = []
    for _ in range(boots):
        k = n = 0
        for _ in days:
            dk, dn = days[rnd.randrange(len(days))]
            k += dk
            n += dn
        vals.append(k / n if n else 0.0)
    vals.sort()
    return vals[int(0.025 * boots)], vals[min(boots - 1, int(0.975 * boots))]


def fmt(x, nd=4):
    if x is None:
        return ""
    if isinstance(x, float):
        return f"{x:.{nd}f}"
    return str(x)


def write_csv(path, columns, rows):
    """rows: dicts; written with '\\n' line ends (gzip if the name ends in .gz)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    op = (lambda: gzip.open(path, "wt", encoding="utf-8", newline="", compresslevel=9)) if path.suffix == ".gz" \
        else (lambda: open(path, "w", encoding="utf-8", newline=""))
    with op() as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(columns)
        for r in rows:
            w.writerow([fmt(r.get(c)) for c in columns])


def utc_day(epoch):
    return datetime.fromtimestamp(int(epoch), timezone.utc).date().isoformat()


class Counts:
    """k / n tallies per key and per service day, for rates with a day-bootstrap range."""

    def __init__(self):
        self.k = defaultdict(int)
        self.n = defaultdict(int)
        self.days = defaultdict(lambda: defaultdict(lambda: [0, 0]))

    def add(self, key, day, hit):
        self.n[key] += 1
        self.days[key][day][1] += 1
        if hit:
            self.k[key] += 1
            self.days[key][day][0] += 1

    def rate(self, key):
        return rate(self.k[key], self.n[key])

    def ci(self, key, boots=2000, seed=7):
        return boot_ci({d: tuple(v) for d, v in self.days[key].items()}, boots, seed)

#!/usr/bin/env python3
"""Collection flags: per-line issues in the data the collector RECORDS (owner, 2026-11-13: "Run a data collection
check recording bus line issues").

A collection flag says: on this line, the collected data (arrivals.csv, predictions.csv, the raw polls behind them) is
less complete or less right than on the other lines, so a model trained on it, a scorer or a checkup reading it can be
misled. It is about the data, not about how good Passio's times are (RouteKnower E31, category prediction_miss) or what
the app shows (E32, display) or how buses behave at transition times (E30, transition). Every measure is per service
day (04:00 to 04:00 Chicago time) and per line, set against the same measure over all lines (the baseline): a behavior
every line shares is a fact of the feed, not a flag.

Measures (data/labeled/collection/README.md has the rules and the severity rule):
  from arrivals.csv / predictions.csv (every day since Oct 8; predictions since Oct 12 noon):
    gps_only_rows          rows the GPS sweep logged alone (source gps: Passio's next stop was frozen or wrong; no
                           Passio time, previous stop or dwell, trip_id often blank)
    feed_skipped_stops     rows Passio's feed never named (source pass: the GPS track went past the stop)
    no_passio_time         non-gps rows with no Passio prediction at any lead (predictions.csv, same bus and stop
                           within 60 s)
    trip_not_in_timetable  non-gps rows whose trip_id is not a trip of that line in the day's timetable (trips.txt)
    double_logged_visits   a row with another row of the same bus at the same stop within 15 min and no other stop
                           of that bus between (one visit logged twice; the merge dedupes only within 5 min)
    rows_outside_hours     rows more than 15 min after the end or 30 min before the start of the line's listed hours
    thin_line_days         listed days with under half the rows of the line's median for that weekday
  from the archived raw polls (raw-polls-<day>, every day since Oct 10) and the day's timetable (gtfs-<day>.zip):
    stops_missed           stops a bus drove past (its GPS track within 40 m, moving the route's direction, inside the
                           listed hours) with no arrival row for that bus and stop within 10 min
    wrong_line_label       bus-hours a bus labeled with this line drove another line's drawn route (DC-024's test,
                           all day); its rows are filed under the label
    service_under_other_label  bus-hours this line's route was driven by a bus labeled with another line (its visits
                           are missing from this line or filed under the other)
    listed_time_no_bus     10-min bins inside the listed hours with no bus of the line reporting, while the feed had
                           other buses and the collector polled
    row_time_off_gps       logged visits whose row is more than 2 min from the GPS track's pass of the stop
    stops_rarely_logged    stops the line's buses come within 120 m of that get under a quarter of the line's median
                           rows per stop (the 40 m radius misses them)
    listed_stops_not_driven  stops of the route order the buses do not come within 120 m of (no rows expected)
    report_gaps            share of a line's bus time in report gaps over 2 min while the bus drove on unseen
    frozen_gps             share of a line's bus time with the GPS position frozen while the bus was moving
  fleet facts (no line): reports with an empty or unknown route id, feed-silent listed time.

Writes (default data/labeled/collection/): line_days.csv (service day x line: every measure's numerator and
denominator), line_summary.csv (period x line x measure, with the baseline, ratio, days over and grade),
stop_coverage.csv (period x line x stop), wrong_label_episodes.csv, missed_visits.csv.gz; and the flags,
data/labeled/flags/collection_flags.csv (category `collection`; tools/flag_lines.py merges it into the registry).

  python tools/collection_flags.py --dl <folder: raw-polls-<day>.jsonl.gz, gtfs-<day>.zip, arrivals.csv,
      predictions.csv (+ predictions-*.csv)> [--from 2026-10-08] [--to <day>] [--cache <dir>]
      [--out-dir data/labeled/collection] [--flags data/labeled/flags/collection_flags.csv] [--today YYYY-MM-DD]
      [--json numbers.json] [--no-polls]
The folder is what experiments/routeknower/E28-scripts/fetch.py (or the data repo's findings run) downloads. Stdlib
only; each day's timetable is built with tools/build_gtfs.py (cached by the zip's content, build_service_seen.py).
Unofficial analysis of the public Passio feed; not a statement by the operator or the University.
"""
import argparse, bisect, csv, gzip, io, json, math, statistics, sys, zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import arrivals_lib as AL            # noqa: E402
import build_service_seen as SS      # noqa: E402  (zip_for, static_for, day_bounds, listed_spans, xy)
from service_gate import CT          # noqa: E402

OUT_DIR = ROOT / "data" / "labeled" / "collection"
FLAGS = ROOT / "data" / "labeled" / "flags" / "collection_flags.csv"
FIRST_DAY = "2026-10-08"
RECENT_DAYS = 14                     # the "last 14 service days" grade (like E31)
PRED_JOIN_S = 60                     # an arrival has a Passio time when predictions.csv has a row within this (E31)
PRED_FROM = 1792171200               # 2026-10-12 12:20 CDT: the first predictions.csv row
DOUBLE_S = AL.SAME_VISIT_S           # 900 s: same bus + stop with nothing between = one visit
AFTER_END_S, BEFORE_START_S = 900, 1800   # E30 after_hours: outside the listed hours by more than this
THIN_SHARE, THIN_MIN_MEDIAN = 0.5, 20     # db_audit.py's thin line-day rule
FRESH_S = SS.FRESH_S                 # 300 s: a report at most this old at its poll is fresh
RADIUS_M = AL.RADIUS_M               # 40 m: the collector's stop radius
MAX_GAP_S = AL.MAX_GAP               # 60 s: the longest report gap a pass is drawn across (the detector's rule)
MIN_MOVE_M = AL.PASS_MIN_MOVE_M      # 15 m: shorter moves are GPS jitter
VISIT_MERGE_S = 900                  # hits of one bus at one stop within this = one visit (every line's lap is longer:
                                     # 5th percentile 16 to 39 min; a route passing near its own stop twice merges)
VISIT_MATCH_S = 600                  # a visit is logged when a row of that bus and stop lies within this
ROW_OFF_S = 120                      # ... and that row's time is off the GPS pass when more than this away
APPROACH_M = 500                     # closest approach of a line's buses to each of its stops is measured up to this
NEAR_M = AL.NEAR_M                   # 120 m: buses come this close = the line serves the stop (the detector's own reach)
RARE_SHARE, RARE_LOW_SHARE, RARE_MIN_MEDIAN = 0.25, 0.10, 40   # a stop under 25% (10%) of the line's median rows
BIN_S = 600                          # 10-min bins (wrong-line test, listed time)
DOWS = SS.DOWS
CATEGORY = "collection"
EVIDENCE_NOTE = ("Unofficial analysis of the public Passio feed; not a statement by the operator or the University. "
                 "Official service information: 773.702.8181.")


# ---------------------------------------------------------------- small helpers
def service_day(epoch):
    """The Chicago service day (04:00 to 04:00) of an epoch."""
    return (datetime.fromtimestamp(epoch, CT) - timedelta(hours=4)).date().isoformat()


def clock_epoch(day, hhmm):
    """'HH:MM' of a service day (may pass 24:00, e.g. '24:55') -> epoch, daylight saving safe."""
    h, m = (int(x) for x in str(hhmm).split(":"))
    d = date.fromisoformat(day) + timedelta(days=(h * 60 + m) // 1440)
    mm = (h * 60 + m) % 1440
    return int(datetime(d.year, d.month, d.day, mm // 60, mm % 60, tzinfo=CT).timestamp())


def spans_of(service, rid, day):
    """[(a, b)] epochs of the route's listed spans on a service day (a calendar exception replaces the weekday)."""
    return [(clock_epoch(day, a), clock_epoch(day, b)) for a, b in SS.listed_spans(service, rid, day)]


def outside(spans, t, after_s=AFTER_END_S, before_s=BEFORE_START_S):
    """True when t is more than after_s past the end and more than before_s before the start of every span (or the
    route has no span that day)."""
    if not spans:
        return True                                    # not listed that day at all
    return all(not (a - before_s <= t <= b + after_s) for a, b in spans)


def in_any(spans, t):
    return any(a <= t < b for a, b in spans)


def rate(num, den, scale=100.0):
    return scale * num / den if den else 0.0


def recent_from(days, n=RECENT_DAYS):
    """The first day of the last n calendar days ending at the newest day."""
    return (date.fromisoformat(max(days)) - timedelta(days=n - 1)).isoformat() if days else ""


# ---------------------------------------------------------------- inputs
def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def load_arrivals(path, d0=FIRST_DAY, d1="9999-12-31"):
    """arrivals.csv -> [dict(epoch, day, route_id, route, trip_id, vehicle_id, stop_id, source, pred)] sorted by epoch."""
    out = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            try:
                e = int(r["epoch"])
            except (KeyError, ValueError):
                continue
            d = service_day(e)
            if not d0 <= d <= d1:
                continue
            out.append({"epoch": e, "day": d, "route_id": str(r.get("route_id") or ""), "route": r.get("route_name") or "",
                        "trip_id": str(r.get("trip_id") or ""), "vehicle_id": str(r.get("vehicle_id") or ""),
                        "stop_id": str(r.get("stop_id") or ""), "source": r.get("source") or ""})
    out.sort(key=lambda r: (r["epoch"], r["vehicle_id"], r["stop_id"]))
    return out


def load_prediction_keys(paths):
    """{(vehicle, stop): sorted arrival epochs with at least one Passio prediction row} from predictions.csv files."""
    by = defaultdict(set)
    for p in paths:
        with open(p, encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                try:
                    by[(str(r["vehicle_id"]), str(r["stop_id"]))].add(int(r["epoch"]))
                except (KeyError, ValueError):
                    continue
    return {k: sorted(v) for k, v in by.items()}


def near(sorted_list, t, within):
    i = bisect.bisect_left(sorted_list, t - within)
    return i < len(sorted_list) and sorted_list[i] <= t + within


class Statics:
    """Each service day's timetable (gtfs-<day>.zip in the download folder, SS.zip_for's rule) built once per content:
    AL.Static (stops, route order, shapes, service) and trips {trip_id: route_id}."""

    def __init__(self, dl, cache):
        self.dl, self.cache, self.by_key, self.day_key = Path(dl), Path(cache), {}, {}

    def for_day(self, day):
        if day in self.day_key:
            k = self.day_key[day]
            return self.by_key.get(k) if k else None
        z = SS.zip_for(self.dl, day)
        if z is None:
            self.day_key[day] = None
            return None
        info = SS.static_for(z, self.cache)
        k = info["key"]
        if k not in self.by_key:
            folder = self.cache / k
            st = AL.Static(folder, folder / "route_patterns.json")
            trips = {}
            with zipfile.ZipFile(z) as zf:
                if "trips.txt" in zf.namelist():
                    for r in csv.DictReader(io.TextIOWrapper(zf.open("trips.txt"), "utf-8-sig")):
                        trips[str(r.get("trip_id", ""))] = str(r.get("route_id", ""))
            self.by_key[k] = {"key": k, "st": st, "trips": trips, "service": st.service, "routes": st.routes}
        self.day_key[day] = k
        return self.by_key[k]


# ---------------------------------------------------------------- per line-day facts from the arrival rows
# Every measure is a (numerator, denominator) pair per (service day, route); line_days.csv keeps both.
MEASURES = {
    # name: (numerator column, denominator column, unit of n)
    "gps_only_rows": ("gps_rows", "rows", "arrival rows"),
    "feed_skipped_stops": ("pass_rows", "rows", "arrival rows"),
    "no_passio_time": ("nopred_rows", "pred_target_rows", "non-gps arrival rows since Oct 12 noon"),
    "trip_not_in_timetable": ("trip_bad_rows", "trip_rows", "non-gps arrival rows"),
    "double_logged_visits": ("double_rows", "rows", "arrival rows"),
    "rows_outside_hours": ("outside_rows", "hours_rows", "arrival rows on days with a timetable"),
    "thin_line_days": ("thin_day", "listed_day", "listed service days"),
}


def new_det():
    """Where a measure's events fell: hours (Chicago clock), buses, stops, other lines."""
    return {"h": Counter(), "v": Counter(), "s": Counter(), "o": Counter()}


def mark(det, day, rid, m, t=None, veh=None, stop=None, other=None, w=1):
    d = det[(day, rid, m)]
    if t is not None:
        d["h"][datetime.fromtimestamp(t, CT).hour] += w
    if veh:
        d["v"][veh] += w
    if stop:
        d["s"][stop] += w
    if other:
        d["o"][other] += w


def double_logged(arr):
    """ids of rows whose bus's previous row (any line) is the same stop within DOUBLE_S: one visit logged twice."""
    by_veh = defaultdict(list)
    for r in arr:
        by_veh[r["vehicle_id"]].append(r)
    out = set()
    for rows in by_veh.values():
        for p, q in zip(rows, rows[1:]):
            if p["stop_id"] == q["stop_id"] and q["epoch"] - p["epoch"] <= DOUBLE_S:
                out.add(id(q))
    return out


def arrival_facts(arr, pred_keys, statics, det):
    """{(day, route_id): Counter} from the arrival rows (MEASURES' columns plus `trip_unknown` / `trip_other_route`)
    and {route_id: name}; det gets where each measure's events fell."""
    F = defaultdict(Counter)
    names = {}
    double = double_logged(arr)
    for r in arr:
        d, rid, e = r["day"], r["route_id"], r["epoch"]
        c = F[(d, rid)]
        names.setdefault(rid, r["route"])
        c["rows"] += 1
        det[(d, rid, "rows:all")]["s"][r["stop_id"]] += 1
        gps = r["source"] == "gps"
        if gps:
            c["gps_rows"] += 1
            mark(det, d, rid, "gps_only_rows", e, r["vehicle_id"], r["stop_id"])
        if r["source"] == "pass":
            c["pass_rows"] += 1
            mark(det, d, rid, "feed_skipped_stops", e, r["vehicle_id"], r["stop_id"])
        if id(r) in double:
            c["double_rows"] += 1
            mark(det, d, rid, "double_logged_visits", e, r["vehicle_id"], r["stop_id"])
        if not gps and e >= PRED_FROM:
            c["pred_target_rows"] += 1
            det[(d, rid, "no_passio_time:all")]["s"][r["stop_id"]] += 1
            if not near(pred_keys.get((r["vehicle_id"], r["stop_id"]), ()), e, PRED_JOIN_S):
                c["nopred_rows"] += 1
                mark(det, d, rid, "no_passio_time", e, r["vehicle_id"], r["stop_id"])
        s = statics.for_day(d) if statics else None
        if s is None:
            continue
        c["hours_rows"] += 1
        if outside(spans_of(s["service"], rid, d), e):
            c["outside_rows"] += 1
            mark(det, d, rid, "rows_outside_hours", e, r["vehicle_id"], r["stop_id"])
        if not gps and r["trip_id"]:
            c["trip_rows"] += 1
            tr = s["trips"].get(r["trip_id"])
            if tr != rid:
                c["trip_unknown" if tr is None else "trip_other_route"] += 1
                c["trip_bad_rows"] += 1
                mark(det, d, rid, "trip_not_in_timetable", e, r["vehicle_id"], r["stop_id"], other=tr or "none")
    return F, names


def thin_days(F, statics, days, routes):
    """Marks listed_day / thin_day in F: a line listed on a day (its timetable has spans that day) whose rows are under
    THIN_SHARE of its median over the listed days of the same weekday (a median of at least THIN_MIN_MEDIAN), on days
    the collector logged anything at all."""
    logged = {d for d in days if any(F[(d, r)]["rows"] for r in routes)}
    listed = defaultdict(list)                         # (route, dow) -> [(day, rows)]
    for d in sorted(logged):
        s = statics.for_day(d) if statics else None
        if s is None:
            continue
        for rid in routes:
            if spans_of(s["service"], rid, d):
                listed[(rid, date.fromisoformat(d).weekday())].append((d, F[(d, rid)]["rows"]))
    for (rid, _), xs in listed.items():
        med = statistics.median(n for _, n in xs)
        for d, n in xs:
            F[(d, rid)]["listed_day"] = 1
            F[(d, rid)]["weekday_median"] = int(med)
            F[(d, rid)]["thin_day"] = int(med >= THIN_MIN_MEDIAN and n < THIN_SHARE * med)


# ---------------------------------------------------------------- the day's raw polls
class DayPolls:
    """One pass over raw-polls-<day>.jsonl.gz (the archive's merged polls of every collect run that day).
    tracks   {veh: [(vt, rid, trip, lat, lon, speed)]} fresh reports (poll time - report time <= FRESH_S), deduped on
             (veh, vt), sorted
    polls    sorted poll times inside the service day
    alive    10-min bins with at least one fresh report of any bus (Passio's feed had buses)
    unknown  Counter of fresh reports by route id that is empty or not a route of the day's timetable"""

    def __init__(self, path, day, routes):
        t0, t1 = SS.day_bounds(day)
        self.tracks, self.polls, self.alive, self.unknown = defaultdict(list), [], set(), Counter()
        seen = set()
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for ln in f:
                try:
                    p = json.loads(ln)
                except ValueError:
                    continue
                h = int(p.get("h") or p.get("t") or 0)
                if not t0 <= h < t1:
                    continue
                self.polls.append(h)
                for v in p.get("v") or []:
                    try:
                        veh, trip, rid, lat, lon = str(v[0]), str(v[1] or ""), str(v[2] or ""), float(v[3]), float(v[4])
                        spd = float(v[6]) if len(v) > 6 and v[6] is not None else None
                        vt = int(v[10] or 0)
                    except (ValueError, TypeError, IndexError):
                        continue
                    if not vt or h - vt > FRESH_S or (veh, vt) in seen:
                        continue
                    seen.add((veh, vt))
                    self.alive.add(vt // BIN_S)
                    if rid not in routes:
                        self.unknown[rid] += 1
                        continue
                    self.tracks[veh].append((vt, rid, trip, lat, lon, spd))
        for v in self.tracks.values():
            v.sort()
        self.polls.sort()

    @classmethod
    def from_tracks(cls, tracks, polls=None):
        """Test seam: ready tracks {veh: [(vt, rid, trip, lat, lon, speed)]}."""
        self = cls.__new__(cls)
        self.tracks = defaultdict(list, {k: sorted(v) for k, v in tracks.items()})
        self.polls = sorted(polls if polls is not None else {r[0] for v in tracks.values() for r in v})
        self.alive = {r[0] // BIN_S for v in tracks.values() for r in v}
        self.unknown = Counter()
        return self

    def polled_bins(self, min_polls=3):
        c = Counter(h // BIN_S for h in self.polls)
        return {b for b, n in c.items() if n >= min_polls}

    def feed_alive(self, a, b, max_gap_s=120):
        """Fresh reports of some bus never pause more than max_gap_s between a and b (feed and collector working)."""
        if not hasattr(self, "_feed"):
            self._feed = sorted(r[0] for v in self.tracks.values() for r in v)
        ft = self._feed
        i = bisect.bisect_left(ft, a)
        prev = a
        while i < len(ft) and ft[i] <= b:
            if ft[i] - prev > max_gap_s:
                return False
            prev = ft[i]
            i += 1
        return b - prev <= max_gap_s


def kxy(lat0):
    return 111320.0 * math.cos(math.radians(lat0)), 111320.0


def heading(order, stops, j):
    """The direction the route runs at stop index j (stop before -> stop after) as (east, north) metres, or None
    (arrival_detector._heading: a bus driving the other way past the stop serves the far side of the street)."""
    n = len(order)
    ring = n > 2 and order[0] == order[-1]
    i0 = j - 1 if j > 0 else (n - 2 if ring else j)
    i1 = j + 1 if j < n - 1 else (1 if ring else j)
    a, b = stops.get(order[i0]), stops.get(order[i1])
    if not a or not b:
        return None
    kx, ky = kxy(a["lat"])
    v = ((b["lon"] - a["lon"]) * kx, (b["lat"] - a["lat"]) * ky)
    return v if math.hypot(*v) >= 5 else None


class RouteStops:
    """Per route: its stops (route order plus other patterns' stops, without a variant's own stops, which only count
    when Passio names them) with the route's direction at each."""

    def __init__(self, st):
        self.by = {}
        for rid, order in (st.route_stops or {}).items():
            vonly = st.variant_only.get(rid, set())
            per = {}
            for j, sid in enumerate(order):
                s = st.stops.get(sid)
                if j in vonly or not s:
                    continue
                per.setdefault(sid, [s["lat"], s["lon"], []])[2].append(heading(order, st.stops, j))
            self.by[str(rid)] = [(sid, la, lo, hds) for sid, (la, lo, hds) in per.items()]

    def closest(self, rid, la0, lo0, la1, lo1, out, within=APPROACH_M):
        """For each stop of the route within `within` m of the segment: out[stop] = min(out[stop], distance)."""
        kx, ky = kxy(la0)
        mx, my = (lo1 - lo0) * kx, (la1 - la0) * ky
        L2 = mx * mx + my * my
        pad = within / 111320.0
        lat_lo, lat_hi = min(la0, la1) - pad, max(la0, la1) + pad
        lon_lo, lon_hi = min(lo0, lo1) - 1.4 * pad, max(lo0, lo1) + 1.4 * pad
        for sid, la, lo, _ in self.by.get(rid, ()):
            if not (lat_lo <= la <= lat_hi and lon_lo <= lo <= lon_hi):
                continue
            ax, ay = (lo0 - lo) * kx, (la0 - la) * ky
            f = 0.0 if L2 <= 1e-9 else max(0.0, min(1.0, -(ax * mx + ay * my) / L2))
            d = math.hypot(ax + f * mx, ay + f * my)
            if d <= within and d < out.get(sid, math.inf):
                out[sid] = d

    def hits(self, rid, la0, lo0, la1, lo1):
        """[(stop_id, f)] stops of the route whose RADIUS_M circle the segment enters or crosses, moving the route's
        direction there (f = where along the segment it comes closest). A segment that starts inside the circle is
        the bus leaving the stop: no hit (arrival_detector._hits)."""
        kx, ky = kxy(la0)
        mx, my = (lo1 - lo0) * kx, (la1 - la0) * ky
        L2 = mx * mx + my * my
        if L2 < MIN_MOVE_M ** 2:
            return []
        pad = 0.001
        lat_lo, lat_hi = min(la0, la1) - pad, max(la0, la1) + pad
        lon_lo, lon_hi = min(lo0, lo1) - 1.4 * pad, max(lo0, lo1) + 1.4 * pad
        out = []
        for sid, la, lo, hds in self.by.get(rid, ()):
            if not (lat_lo <= la <= lat_hi and lon_lo <= lo <= lon_hi):
                continue
            ax, ay = (lo0 - lo) * kx, (la0 - la) * ky
            if math.hypot(ax, ay) <= RADIUS_M:
                continue
            f = max(0.0, min(1.0, -(ax * mx + ay * my) / L2))
            if math.hypot(ax + f * mx, ay + f * my) > RADIUS_M:
                continue
            if any(hd is None or hd[0] * mx + hd[1] * my > 0 for hd in hds):
                out.append((sid, f))
        return out


class LineIndex:
    """Each route's drawn line (shapes.json, [lat, lon] points) rasterized into CELL_M cells within LINE_M: a fast
    'which lines run here' (the DC-024 test; experiments/routeknower/E30-scripts/odd_lib.LineIndex, stdlib)."""
    LINE_M, CELL_M = 40, 20

    def __init__(self, shapes):
        self.cells = defaultdict(set)
        c = self.CELL_M
        k = int(math.ceil(self.LINE_M / c))
        disk = [(dx, dy) for dx in range(-k, k + 1) for dy in range(-k, k + 1)
                if math.hypot(max(0, abs(dx) - 0.5), max(0, abs(dy) - 0.5)) * c <= self.LINE_M]
        for rid, lines in (shapes or {}).items():
            for line in lines or []:
                for p, q in zip(line[:-1], line[1:]):
                    (xa, ya), (xb, yb) = SS.xy(p[0], p[1]), SS.xy(q[0], q[1])
                    n = max(1, int(math.hypot(xb - xa, yb - ya) / (c / 2)))
                    for s in range(n + 1):
                        cx = int(math.floor((xa + (xb - xa) * s / n) / c))
                        cy = int(math.floor((ya + (yb - ya) * s / n) / c))
                        for dx, dy in disk:
                            self.cells[(cx + dx, cy + dy)].add(str(rid))

    def lines_at(self, lat, lon):
        x, y = SS.xy(lat, lon)
        return self.cells.get((int(math.floor(x / self.CELL_M)), int(math.floor(y / self.CELL_M))), set())


# ---------------------------------------------------------------- per line-day facts from the raw polls
WL_MOVE_MPS, WL_MOVE_M = 2.0, 15         # DC-024: a moving report (speed, or moved since the previous report)
WL_MIN_MOVING, WL_LABEL_MAX, WL_OTHER_MIN = 15, 0.30, 0.85
WL_MIN_BINS, WL_MERGE_BINS = 3, 3        # >= 30 min, bins of one label <= 20 min apart merge
GAP_S, GAP_MOVED_M = 120, 200            # a report gap over 2 min while the bus drove >= 200 m and the feed was alive
FROZEN_N, FROZEN_S, FROZEN_MPS, FROZEN_JUMP_M, FROZEN_JUMP_S = 5, 300, 3.0, 200, 60   # E30 frozen_gps
ONLINE_STEP_S = 600                      # bus time on a line: report-to-report steps up to this (longer = off the map)


def wrong_label_episodes(tracks, lidx):
    """DC-024 / E30 wrong_line_label on the whole day: per bus, its moving reports per 10-min clock bin against every
    drawn line; a bin is off its label with >= 15 moving reports, under 30% on the labeled line and >= 85% on one other
    line; off bins of one label <= 20 min apart merge; >= 3 bins = an episode.
    -> [(veh, label, driven, start, end, bins)]."""
    out = []
    for veh, tr in tracks.items():
        acc = defaultdict(list)
        for i, r in enumerate(tr):
            moving = (r[5] >= WL_MOVE_MPS) if r[5] is not None else (
                i > 0 and AL.hav_m(tr[i - 1][3], tr[i - 1][4], r[3], r[4]) >= WL_MOVE_M)
            if moving:
                acc[r[0] // BIN_S].append((r[1], lidx.lines_at(r[3], r[4])))
        bins = {}
        for b, xs in acc.items():
            lab = Counter(x[0] for x in xs).most_common(1)[0][0]
            xs = [x for x in xs if x[0] == lab]
            n = len(xs)
            on = sum(lab in x[1] for x in xs) / n
            other = Counter(ln for x in xs for ln in x[1] if ln != lab)
            best, cnt = other.most_common(1)[0] if other else ("", 0)
            if n >= WL_MIN_MOVING and on < WL_LABEL_MAX and best and cnt / n >= WL_OTHER_MIN:
                bins[b] = (lab, best)
        off = sorted(bins)
        i = 0
        while i < len(off):
            j = i
            while j + 1 < len(off) and off[j + 1] - off[j] <= WL_MERGE_BINS and bins[off[j + 1]][0] == bins[off[i]][0]:
                j += 1
            if j - i + 1 >= WL_MIN_BINS:
                drv = Counter(bins[k][1] for k in off[i:j + 1]).most_common(1)[0][0]
                out.append((veh, bins[off[i]][0], drv, off[i] * BIN_S, (off[j] + 1) * BIN_S, j - i + 1))
            i = j + 1
    return out


def frozen_runs(tr):
    """E30 frozen_gps on one bus's track: >= 5 reports over >= 5 min at identical coordinates (1e-6 deg) while the
    bus was really moving (a reported speed >= 3 m/s in the run, or its next report >= 200 m away within 60 s).
    -> [(route_id of the run's first report, start, end)]."""
    out, i, n = [], 0, len(tr)
    while i < n:
        key = (round(tr[i][3], 6), round(tr[i][4], 6))
        j = i
        while j + 1 < n and (round(tr[j + 1][3], 6), round(tr[j + 1][4], 6)) == key and tr[j + 1][0] - tr[j][0] <= 600:
            j += 1
        if j - i + 1 >= FROZEN_N and tr[j][0] - tr[i][0] >= FROZEN_S:
            spd = max((x[5] or 0) for x in tr[i:j + 1])
            jump = (j + 1 < n and tr[j + 1][0] - tr[j][0] <= FROZEN_JUMP_S
                    and AL.hav_m(tr[j][3], tr[j][4], tr[j + 1][3], tr[j + 1][4]) >= FROZEN_JUMP_M)
            if spd >= FROZEN_MPS or jump:
                out.append((tr[i][1], tr[i][0], tr[j][0]))
        i = j + 1
    return out


def visit_groups(ts):
    """Hit times of one bus at one stop -> visits (lists of times; hits within VISIT_MERGE_S are one visit)."""
    ts = sorted(ts)
    groups = [[ts[0]]] if ts else []
    for t in ts[1:]:
        if t - groups[-1][-1] <= VISIT_MERGE_S:
            groups[-1].append(t)
        else:
            groups.append([t])
    return groups


def poll_facts(day, polls, s, arr_by_veh, det):
    """One service day from its raw polls (s = Statics.for_day(day)) and the arrival rows by bus ->
    ({route_id: Counter}, wrong-label episodes [(veh, label, driven, a, b, bins, rows filed under the label)],
    missed visits [(veh, route_id, stop_id, t)], {(route_id, stop_id): Counter of visits})."""
    st, routes = s["st"], s["routes"]
    if "geo" not in s:
        s["geo"], s["lidx"] = RouteStops(st), LineIndex(st.shapes)
    geo, lidx = s["geo"], s["lidx"]
    F = defaultdict(Counter)
    eps = []
    wrong = defaultdict(list)
    for veh, lab, drv, a, b, nb in wrong_label_episodes(polls.tracks, lidx):
        wrong[veh].append((a, b))
        rows = sum(1 for r in arr_by_veh.get(veh, ()) if a <= r["epoch"] < b and r["route_id"] == lab)
        F[lab]["wrong_label_min"] += nb * BIN_S / 60
        F[lab]["wrong_label_rows"] += rows
        F[drv]["other_label_min"] += nb * BIN_S / 60
        for t in range(a, b, BIN_S):
            mark(det, day, lab, "wrong_line_label", t, veh, other=drv, w=BIN_S / 60)
            mark(det, day, drv, "service_under_other_label", t, veh, other=lab, w=BIN_S / 60)
        eps.append((veh, lab, drv, a, b, nb, rows))
    spans = {rid: spans_of(st.service, rid, day) for rid in routes}
    padded = {rid: [(a - BEFORE_START_S, b + AFTER_END_S) for a, b in sp] for rid, sp in spans.items()}
    missed, stop_c, closest = [], defaultdict(Counter), defaultdict(dict)
    for veh, tr in polls.tracks.items():
        wr = wrong.get(veh, ())
        hits = defaultdict(list)
        for i in range(1, len(tr)):
            p, q = tr[i - 1], tr[i]
            dt = q[0] - p[0]
            if p[1] != q[1] or dt <= 0:
                continue
            rid = q[1]
            if dt <= ONLINE_STEP_S:
                F[rid]["online_min"] += dt / 60
                if dt > GAP_S and AL.hav_m(p[3], p[4], q[3], q[4]) >= GAP_MOVED_M and polls.feed_alive(p[0], q[0]):
                    F[rid]["gap_min"] += dt / 60
                    F[rid]["gaps"] += 1
                    mark(det, day, rid, "report_gaps", p[0], veh, w=dt / 60)
            if dt > MAX_GAP_S or not in_any(padded.get(rid, ()), q[0]) or in_any(wr, q[0]):
                continue
            geo.closest(rid, p[3], p[4], q[3], q[4], closest[rid])
            for sid, f in geo.hits(rid, p[3], p[4], q[3], q[4]):
                hits[(rid, sid)].append(p[0] + f * dt)
        for rid, a, b in frozen_runs(tr):
            F[rid]["frozen_min"] += (b - a) / 60
            F[rid]["frozen_runs"] += 1
            mark(det, day, rid, "frozen_gps", a, veh, w=(b - a) / 60)
        rows = arr_by_veh.get(veh, ())
        ep = [r["epoch"] for r in rows]
        for (rid, sid), ts in hits.items():
            for g in visit_groups(ts):
                lo, hi = bisect.bisect_left(ep, g[0] - VISIT_MATCH_S), bisect.bisect_right(ep, g[-1] + VISIT_MATCH_S)
                here = [r for r in rows[lo:hi] if r["stop_id"] == sid]
                c = stop_c[(rid, sid)]
                c["visits"] += 1
                F[rid]["visits"] += 1
                det[(day, rid, "stops_missed:all")]["s"][sid] += 1
                same = [r for r in here if r["route_id"] == rid]
                if same:
                    c["logged"] += 1
                    F[rid]["visits_logged"] += 1
                    if min(abs(r["epoch"] - t) for r in same for t in g) > ROW_OFF_S:
                        c["row_off"] += 1
                        F[rid]["visits_row_off"] += 1
                        mark(det, day, rid, "row_time_off_gps", g[0], veh, sid)
                elif here:
                    c["logged_other_line"] += 1
                    F[rid]["visits_other_line"] += 1
                else:
                    c["missed"] += 1
                    F[rid]["visits_missed"] += 1
                    missed.append((veh, rid, sid, int(g[0])))
                    mark(det, day, rid, "stops_missed", g[0], veh, sid)
    # listed time with no bus: 10-min bins wholly inside a listed span while the collector polled and the feed had buses
    polled = polls.polled_bins()
    seen_bins = defaultdict(set)
    for tr in polls.tracks.values():
        for r in tr:
            seen_bins[r[1]].add(r[0] // BIN_S)
    for rows in arr_by_veh.values():
        for r in rows:
            seen_bins[r["route_id"]].add(r["epoch"] // BIN_S)
    driven = defaultdict(set)                           # the route had a bus on it, under another line's label
    for veh, lab, drv, a, b, nb, rows in eps:
        driven[drv].update(range(a // BIN_S, b // BIN_S))
    for rid, sp in spans.items():
        for a, b in sp:
            for bn in range(-(-a // BIN_S), b // BIN_S):
                if bn not in polled:
                    continue
                if bn not in polls.alive:
                    F[rid]["listed_feed_silent_bins"] += 1
                    continue
                F[rid]["listed_bins"] += 1
                if bn in seen_bins[rid]:
                    continue
                if bn in driven[rid]:
                    F[rid]["listed_other_label_bins"] += 1
                else:
                    F[rid]["listed_nobus_bins"] += 1
                    mark(det, day, rid, "listed_time_no_bus", bn * BIN_S)
    for rid, per in closest.items():
        for sid, d in per.items():
            stop_c[(rid, sid)]["closest_m"] = round(d, 1)       # a min, not a sum: collect() keeps it per day
    return F, eps, missed, stop_c


POLL_MEASURES = {
    "stops_missed": ("visits_missed", "visits", "stop visits driven past (GPS)"),
    "row_time_off_gps": ("visits_row_off", "visits_logged", "logged stop visits driven past (GPS)"),
    "wrong_line_label": ("wrong_label_min", "online_min", "bus-minutes under the line's label"),
    "service_under_other_label": ("other_label_min", "online_min", "bus-minutes under the line's label"),
    "listed_time_no_bus": ("listed_nobus_bins", "listed_bins", "listed 10-min bins with the feed alive"),
    "report_gaps": ("gap_min", "online_min", "bus-minutes under the line's label"),
    "frozen_gps": ("frozen_min", "online_min", "bus-minutes under the line's label"),
}
MEASURES.update(POLL_MEASURES)


# ---------------------------------------------------------------- the whole window
def newest_day(dl, polls=True):
    """The newest complete service day: the newest archived raw-polls day (the archive builds a day after it ends),
    else the day before the newest arrival's (that one may still be running)."""
    if polls:
        got = sorted(p.name[10:20] for p in Path(dl).glob("raw-polls-*.jsonl.gz"))
        if got:
            return got[-1]
    last = None
    with open(Path(dl) / "arrivals.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            try:
                last = max(last or 0, int(r["epoch"]))
            except (KeyError, ValueError):
                continue
    if last is None:
        raise SystemExit(f"no arrival rows in {Path(dl) / 'arrivals.csv'}")
    return (date.fromisoformat(service_day(last)) - timedelta(days=1)).isoformat()


def collect(dl, d0=FIRST_DAY, d1=None, cache=None, polls=True, log=print):
    """Every measure per (service day, line) over the window. -> dict with F {(day, rid): Counter}, det, names,
    days, poll_days, episodes, missed, stops {(day, rid, stop): Counter}, fleet (unknown route ids, silent feed)."""
    dl = Path(dl)
    statics = Statics(dl, cache or dl / "collection-static")
    d1 = d1 or newest_day(dl, polls)
    arr = load_arrivals(dl / "arrivals.csv", d0, d1)
    if not arr:
        raise SystemExit(f"no arrival rows in {dl / 'arrivals.csv'} between {d0} and {d1}")
    preds = sorted(dl.glob("predictions-*.csv")) + ([dl / "predictions.csv"] if (dl / "predictions.csv").exists() else [])
    pred_keys = load_prediction_keys(preds)
    det = defaultdict(new_det)
    F, names = arrival_facts(arr, pred_keys, statics, det)
    days = sorted({r["day"] for r in arr})
    routes = sorted({rid for _, rid in F})
    thin_days(F, statics, days, routes)
    by_day_veh = defaultdict(lambda: defaultdict(list))
    for r in arr:
        by_day_veh[r["day"]][r["vehicle_id"]].append(r)
    out = {"F": F, "det": det, "names": names, "days": days, "poll_days": [], "episodes": [], "missed": [],
           "stops": defaultdict(Counter), "fleet": defaultdict(Counter), "statics": statics, "line_stops": {}}
    if not polls:
        return out
    for d in days:
        path = dl / f"raw-polls-{d}.jsonl.gz"
        s = statics.for_day(d)
        if not path.exists() or s is None:
            continue
        dp = DayPolls(path, d, s["routes"])
        # a bus's rows on this day and the next morning's (a service day ends at 04:00)
        f, eps, missed, stop_c = poll_facts(d, dp, s, by_day_veh[d], det)
        for rid, c in f.items():
            F[(d, rid)].update(c)
            names.setdefault(rid, s["st"].route_name(rid))
        for (rid, sid), c in stop_c.items():
            out["stops"][(d, rid, sid)].update(c)
        for rid, order in (s["st"].route_stops or {}).items():
            vonly = s["st"].variant_only.get(rid, set())
            out["line_stops"][(d, rid)] = {sid for j, sid in enumerate(order) if j not in vonly}
        out["episodes"] += [(d,) + e for e in eps]
        out["missed"] += [(d,) + m for m in missed]
        fl = out["fleet"][d]
        fl["unknown_route_reports"] += sum(dp.unknown.values())
        fl["empty_route_reports"] += dp.unknown.get("", 0)
        fl["reports"] += sum(len(v) for v in dp.tracks.values()) + sum(dp.unknown.values())
        fl["listed_feed_silent_bins"] += sum(c["listed_feed_silent_bins"] for c in f.values())
        out["poll_days"].append(d)
        log(f"{d}: {sum(len(v) for v in dp.tracks.values())} reports, {len(eps)} wrong-label episodes, "
            f"{sum(c['visits'] for c in f.values())} visits ({len(missed)} missed)")
    return out


# ---------------------------------------------------------------- periods and grades
# Severity (data/labeled/collection/README.md "Severity rule (collection)"): ratio = the line's rate / all lines' in
# the same period; excess = the line's rate - all lines' (points); n = the measure's denominator; events = its
# numerator in whole events (rows, visits, bins, episodes, gaps, frozen runs, days); days over = service days whose own
# rate is at least the grade's ratio x the period's all-lines rate (a day needs MIN_DAY_DEN of the denominator).
GRADES = (("high", 2.0, 300, 30, 3), ("medium", 1.5, 100, 10, 3), ("low", 1.25, 30, 5, 2))   # ratio, n, events, days
EXCESS = {   # minimum excess in points for high / medium / low (a tiny share twice a tinier one is no flag)
    "gps_only_rows": (10, 5, 2), "feed_skipped_stops": (10, 5, 2), "no_passio_time": (10, 5, 2),
    "trip_not_in_timetable": (5, 2, 1), "double_logged_visits": (1, 0.5, 0.2), "rows_outside_hours": (5, 2, 1),
    "thin_line_days": (10, 5, 3), "stops_missed": (5, 3, 1.5), "row_time_off_gps": (5, 3, 1.5), "wrong_line_label": (2, 1, 0.5),
    "service_under_other_label": (2, 1, 0.5), "listed_time_no_bus": (10, 5, 2), "report_gaps": (2, 1, 0.5),
    "frozen_gps": (1, 0.5, 0.25),
}
# (n, events) per grade for whole-day measures: thin days are at most medium (n = listed days, never 300)
N_OVERRIDE = {"thin_line_days": ((10 ** 9, 10 ** 9), (10, 3), (5, 2))}
EVENTS = {"wrong_line_label": "wl_episodes", "service_under_other_label": "ol_episodes", "report_gaps": "gaps",
          "frozen_gps": "frozen_runs"}
MIN_DAY_DEN = {"thin_line_days": 1, "listed_time_no_bus": 6, "wrong_line_label": 60, "service_under_other_label": 60,
               "report_gaps": 60, "frozen_gps": 60, "stops_missed": 10, "row_time_off_gps": 10}
DEFAULT_MIN_DAY_DEN = 20


def periods(days):
    rf = recent_from(days)
    return {"all": days, "recent": [d for d in days if d >= rf]}


def episode_counts(col):
    """Adds wl_episodes / ol_episodes per (day, rid) to F from the wrong-label episodes."""
    for d, veh, lab, drv, a, b, nb, rows in col["episodes"]:
        col["F"][(d, lab)]["wl_episodes"] += 1
        col["F"][(d, drv)]["ol_episodes"] += 1


def summarize(col):
    """-> rows of line_summary.csv: period x line (and ALL) x measure."""
    F, names = col["F"], col["names"]
    episode_counts(col)
    routes = sorted({rid for _, rid in F if rid})
    out = []
    for per, days in periods(col["days"]).items():
        dset = set(days)
        for m, (num, den, unit) in MEASURES.items():
            tot_n = sum(c[num] for (d, _), c in F.items() if d in dset)
            tot_d = sum(c[den] for (d, _), c in F.items() if d in dset)
            base = rate(tot_n, tot_d)
            ev_col = EVENTS.get(m, num)
            for rid in routes + ["ALL"]:
                cs = [(d, F[(d, rid)]) for d in days] if rid != "ALL" else None
                if rid == "ALL":
                    n_, d_ = tot_n, tot_d
                    ev = sum(c[ev_col] for (d, _), c in F.items() if d in dset)
                    dd = sum(1 for d in days if any(F[(d, r)][den] for r in routes))
                    over = {}
                else:
                    n_ = sum(c[num] for _, c in cs)
                    d_ = sum(c[den] for _, c in cs)
                    ev = sum(c[ev_col] for _, c in cs)
                    dd = sum(1 for _, c in cs if c[den])
                    over = {}
                    for g, ratio, *_ in GRADES:
                        lim = ratio * base
                        mind = MIN_DAY_DEN.get(m, DEFAULT_MIN_DAY_DEN)
                        over[g] = sum(1 for _, c in cs if c[den] >= mind and c[num] > 0 and rate(c[num], c[den]) >= lim)
                if not d_:
                    continue
                v = rate(n_, d_)
                row = {"period": per, "route_id": rid, "route": names.get(rid, "All lines") if rid != "ALL" else "All lines",
                       "measure": m, "value": round(v, 3), "baseline": round(base, 3), "numerator": round(n_, 1),
                       "denominator": round(d_, 1), "unit": unit, "events": int(round(ev)), "days": dd,
                       "data_from": days[0] if days else "", "data_to": days[-1] if days else "",
                       "ratio": round(v / base, 3) if base else "", "excess": round(v - base, 3)}
                for g in ("high", "medium", "low"):
                    row[f"days_over_{g}"] = over.get(g, "")
                row["grade"] = grade(m, row) if rid != "ALL" else ""
                out.append(row)
    return out + (stop_summary(col) if col.get("line_stops") else [])


def stop_logging(col, days):
    """{(route_id, stop_id): facts} for every stop of a line's route order on the period's days with raw polls: rows
    (any source), the line's median rows per stop, the days the stop was listed, and the median over those days of the
    closest approach of the line's buses (None = never within APPROACH_M)."""
    dset = set(days)
    rows = defaultdict(Counter)
    for (d, rid, m), x in col["det"].items():
        if m == "rows:all" and d in dset:
            rows[rid].update(x["s"])
    listed = defaultdict(list)
    for (d, rid), sids in col.get("line_stops", {}).items():
        if d in dset and col["F"].get((d, rid), {}).get("rows"):
            for sid in sids:
                c = col["stops"].get((d, rid, sid))
                listed[(rid, sid)].append(c["closest_m"] if c and "closest_m" in c else None)
    by_line = defaultdict(list)
    for (rid, sid) in listed:
        by_line[rid].append(sid)
    out = {}
    for rid, sids in by_line.items():
        med = statistics.median(rows[rid].get(x, 0) for x in sids)
        for sid in sids:
            ap = listed[(rid, sid)]
            got = sorted(x for x in ap if x is not None)
            # days with no approach at all count as farther than any measured one
            close = statistics.median(got + [math.inf] * (len(ap) - len(got))) if ap else None
            out[(rid, sid)] = {"rows": rows[rid].get(sid, 0), "line_median": med, "days_listed": len(ap),
                               "closest_m": None if close is None or close == math.inf else round(close),
                               "rare": med >= RARE_MIN_MEDIAN and rows[rid].get(sid, 0) < RARE_SHARE * med}
    return out


STOP_MEASURES = {"stops_rarely_logged": "stops the line's buses come within 120 m of (the line's route order)",
                 "listed_stops_not_driven": "stops of the line's route order"}


def stop_summary(col):
    """line_summary.csv rows for the two stop-level measures (whole-period counts, not daily rates)."""
    names, out = col["names"], []
    for per, days in periods(col["days"]).items():
        sl = stop_logging(col, days)
        lines = sorted({rid for rid, _ in sl})
        for m in STOP_MEASURES:
            pick = (lambda f: f["rare"] and f["closest_m"] is not None and f["closest_m"] <= NEAR_M)                 if m == "stops_rarely_logged" else (lambda f: f["rare"] and (f["closest_m"] is None or f["closest_m"] > NEAR_M))
            tot_n = sum(1 for f in sl.values() if pick(f))
            tot_d = len(sl)
            base = rate(tot_n, tot_d)
            for rid in lines + ["ALL"]:
                mine = {k: f for k, f in sl.items() if rid == "ALL" or k[0] == rid}
                hit = sorted((k for k, f in mine.items() if pick(f)), key=lambda k: (mine[k]["rows"], k))
                v = rate(len(hit), len(mine))
                row = {"period": per, "route_id": rid, "route": names.get(rid, rid) if rid != "ALL" else "All lines",
                       "measure": m, "value": round(v, 3), "baseline": round(base, 3), "numerator": len(hit),
                       "denominator": len(mine), "unit": STOP_MEASURES[m], "events": len(hit),
                       "days": len(days), "data_from": days[0], "data_to": days[-1],
                       "ratio": round(v / base, 3) if base else "", "excess": round(v - base, 3),
                       "days_over_high": "", "days_over_medium": "", "days_over_low": "", "grade": "",
                       "stops": [(k[1], mine[k]) for k in hit]}
                if rid != "ALL" and hit:
                    worst = min(mine[k]["rows"] / mine[k]["line_median"] for k in hit)
                    long_ = max(mine[k]["days_listed"] for k in hit)
                    if m == "stops_rarely_logged":
                        row["grade"] = "high" if worst < RARE_LOW_SHARE and long_ >= 7 else "medium"
                    else:
                        row["grade"] = "low"
                out.append(row)
    return out


def grade(m, row):
    """The severity a summary row earns under the collection rule ('' = none)."""
    if not row["baseline"] and row["value"] <= 0:
        return ""
    ratio = row["value"] / row["baseline"] if row["baseline"] else math.inf
    for k, (g, r_min, n_min, ev_min, days_min) in enumerate(GRADES):
        if m in N_OVERRIDE:
            n_min, ev_min = N_OVERRIDE[m][k]
        if (ratio >= r_min and row["excess"] >= EXCESS[m][k] and row["denominator"] >= n_min
                and row["events"] >= ev_min and (row[f"days_over_{g}"] or 0) >= days_min):
            return g
    return ""


# ---------------------------------------------------------------- flags
import flag_lines as FL                   # noqa: E402  (the registry's columns and scope grammar)

EVID = "data/labeled/collection/"
TEXT = {   # measure: (metric, agent_action, extra evidence files)
    "gps_only_rows": (
        "share of the line's arrival rows the GPS sweep logged alone (source gps: Passio's next stop for the bus was "
        "frozen or wrong; such a row has no Passio time, previous stop, segment or dwell, and a blank trip_id when the "
        "feed was frozen)",
        "train and score with the source in mind: never read a gps row's empty Passio time, dwell or previous stop as "
        "zero, and a scorer that needs Passio's time scores this line on fewer rows (the rest are real arrivals, keep "
        "them as truth); DC-003",
        ""),
    "feed_skipped_stops": (
        "share of the line's arrival rows for stops Passio's feed never named as the bus's next stop (source pass: "
        "timed at the GPS track's closest approach)",
        "these visits exist in the data only because the GPS track went past the stop: Passio's stop sequence (and "
        "anything built on it, like next-stop features or Passio's share of rows with a time) skips them; a pass "
        "row's time is a drive-by, not a dwell",
        ""),
    "no_passio_time": (
        "share of the line's non-gps arrival rows with no Passio prediction at any lead 1 to 30 min (predictions.csv, "
        "the same bus and stop within 60 s), since Oct 12 noon",
        "Passio's scoring sample on this line is smaller and not random (whole stops and first stops drop out): slice "
        "or weight by stop (scope) and never compare this line's Passio share with another's unweighted; the all-lead, "
        "all-stop collection side of E31's stops_without_predictions (5 min ahead, last 14 days); Passio's side "
        "(DC-025), the rows themselves are complete",
        ""),
    "trip_not_in_timetable": (
        "share of the line's non-gps arrival rows whose trip_id is not a trip of that line in the day's timetable",
        "join these rows to the timetable by time, not by trip_id",
        ""),
    "double_logged_visits": (
        "share of the line's arrival rows that repeat the bus's previous row at the same stop within 15 min (one "
        "visit logged twice)",
        "drop the second row of each pair before counting visits or headways",
        ""),
    "rows_outside_hours": (
        "share of the line's arrival rows more than 15 min after the end or 30 min before the start of its listed "
        "hours (or on a day it is not listed)",
        "rows no listed trip explains (timetable features blank): keep them as truth (riders were served) but score "
        "them as their own slice and never learn the line's hours from them; the bus-level side is E30's after_hours",
        ""),
    "thin_line_days": (
        "listed service days with under half the line's median rows for that weekday, % of the line's listed days",
        "a checkup must not read these days as normal and volume or headway baselines leave them out; look at the "
        "day's raw polls first (the bus missing from Passio's feed or filed under another line, DC-024, DC-026)",
        ""),
    "stops_missed": (
        "share of the stop visits the GPS track drove past (within 40 m, the route's direction, its listed hours) "
        "with no arrival row of that bus at that stop within 10 min",
        "visit counts and headways at the scope's stops are undercounted: never read a missing row there as a skipped "
        "stop; every miss is in missed_visits.csv.gz (a detector change to log them is a replay, the owner's call)",
        "stop_coverage.csv; missed_visits.csv.gz"),
    "row_time_off_gps": (
        "share of the logged stop visits whose row is more than 2 min from the GPS track's pass of the stop",
        "segment and dwell times built on these rows are off by minutes: drop segments longer than the GPS allows or "
        "weight these stops' rows down",
        "stop_coverage.csv"),
    "wrong_line_label": (
        "share of the line's labeled bus time a bus spent driving another line's route (DC-024's test all day: 10-min "
        "bins with under 30% of the moving reports on the label's line and 85% or more on one other, 30 min or "
        "more)",
        "the episodes' rows (wrong_label_episodes.csv) are visits of the line driven filed under this line: leave them "
        "out of this line's training labels and score them apart (refiling them by GPS is a replay, the owner's call, "
        "DC-024); E30's wrong_line_label is the part inside transition windows",
        "wrong_label_episodes.csv"),
    "service_under_other_label": (
        "bus time this line's route was driven by a bus labeled with another line (the same test), as a share of the "
        "line's own labeled bus time",
        "this line's rows miss those visits (they are filed under the label's line where both serve the stop, else "
        "not logged): its visit counts, headways and bus counts are undercounted then (wrong_label_episodes.csv, "
        "driven = this line)",
        "wrong_label_episodes.csv"),
    "listed_time_no_bus": (
        "share of the line's listed 10-min bins with no bus of the line reporting or logged, while the collector "
        "polled and the feed had other buses",
        "the timetable lists service the data has no trace of: no rows to learn or score there; never fill those hours "
        "with timetable times as if observed, and a checkup reads 0 rows there as the feed's, not a collection gap; "
        "E30's service_start_missing / service_end_early are the transition-window part",
        ""),
    "report_gaps": (
        "share of the line's labeled bus time inside report gaps over 2 min while the bus drove on (200 m or more) "
        "and the feed had other buses",
        "arrivals inside these gaps were timed by interpolation or missed: weight down segments that span a gap; "
        "E30's feed_drop_mid_route / sparse_reporting are the 5-min-plus gaps near transitions",
        ""),
    "stops_rarely_logged": (
        "share of the line's stops (its route order) that its buses come within 120 m of but that get under a quarter "
        "of the line's median rows per stop (the collector's 40 m radius misses the stop as the buses drive it)",
        "the scope's stops have almost no ground truth although the buses serve them: never score or train them as "
        "if visits were rare (the rows are missing, not the service); a detector that keeps the closest approach to a "
        "named stop within 120 m would log them (a replay, the owner's call)",
        "stop_coverage.csv"),
    "listed_stops_not_driven": (
        "share of the line's stops (its route order) that its buses do not come within 120 m of on most days and that "
        "get under a quarter of the line's median rows per stop",
        "the timetable lists stops these buses do not drive to: expect no rows there (no collection gap) and never "
        "count them in the line's stop coverage",
        "stop_coverage.csv"),
    "frozen_gps": (
        "share of the line's labeled bus time with the GPS position frozen while the bus was moving (5 or more "
        "reports over 5 min or more at identical coordinates)",
        "no arrival can be detected while the position is frozen: rows around these runs are missing or late; the "
        "same runs as E30's frozen_gps (inside transition windows), measured here all day",
        ""),
}
EVENT_WORD = {"wrong_line_label": "episodes", "service_under_other_label": "episodes", "report_gaps": "gaps",
              "frozen_gps": "frozen runs", "thin_line_days": "thin days", "listed_time_no_bus": "empty bins",
              "stops_missed": "missed visits", "row_time_off_gps": "visits"}
STOP_SCOPED = {"stops_missed": "stops_missed:all", "no_passio_time": "no_passio_time:all", "gps_only_rows": "rows:all",
               "feed_skipped_stops": "rows:all", "row_time_off_gps": "stops_missed:all"}
HOUR_SCOPED = {"wrong_line_label", "service_under_other_label", "listed_time_no_bus", "rows_outside_hours", "report_gaps"}
BUS_SCOPED = {"wrong_line_label", "service_under_other_label", "report_gaps", "frozen_gps", "gps_only_rows"}
SEV_ORDER = {"high": 0, "medium": 1, "low": 2, "": 3}


def det_sum(det, days, rid, m):
    out = new_det()
    for d in days:
        x = det.get((d, rid, m))
        if x:
            for k in out:
                out[k].update(x[k])
    return out


def hour_ranges(h, share=0.6, max_hours=6):
    """The fewest clock hours holding >= share of the events (at most max_hours) as scope ranges '17-20|22-24', or ''."""
    tot = sum(h.values())
    if not tot:
        return ""
    got, acc = [], 0
    for hr, n in sorted(h.items(), key=lambda x: (-x[1], x[0])):
        got.append(hr)
        acc += n
        if acc >= share * tot:
            break
    if acc < share * tot or len(got) > max_hours:
        return ""
    got.sort()
    runs = [[got[0], got[0]]]
    for x in got[1:]:
        if x == runs[-1][1] + 1:
            runs[-1][1] = x
        else:
            runs.append([x, x])
    return "|".join(f"{a}-{b + 1}" for a, b in runs)


def top_share(c, share=0.6, max_items=3):
    """The fewest keys (at most max_items) holding >= share of the counter, or []."""
    tot = sum(c.values())
    got, acc = [], 0
    for k, n in sorted(c.items(), key=lambda x: (-x[1], str(x[0]))):
        if len(got) == max_items:
            break
        got.append(k)
        acc += n
        if acc >= share * tot:
            return got
    return []


def hot_stops(num, den, line_rate, min_den=20, max_stops=6, min_explain=0.25):
    """Stops where the measure concentrates: own rate >= 1.5 x the line's and >= the line's + 5 points on >= min_den,
    most events first; [] when they explain under min_explain of the line's events (it is line-wide)."""
    tot = sum(num.values())
    if not tot:
        return []
    hot = [s for s in num if den.get(s, 0) >= min_den and rate(num[s], den[s]) >= max(1.5 * line_rate, line_rate + 5)]
    hot.sort(key=lambda s: (-num[s], s))
    hot = hot[:max_stops]
    return hot if sum(num[s] for s in hot) >= min_explain * tot else []


def day_kind(col, rid, m, days):
    """'weekday' / 'weekend' when >= 90% of the measure's events fell on such days, else ''."""
    num = MEASURES[m][0]
    wd = we = 0.0
    for d in days:
        v = col["F"].get((d, rid), {}).get(num, 0)
        if date.fromisoformat(d).weekday() >= 5:
            we += v
        else:
            wd += v
    if wd + we <= 0:
        return ""
    return "weekday" if wd >= 0.9 * (wd + we) else ("weekend" if we >= 0.9 * (wd + we) else "")


def scope_for(col, rid, m, days, line_rate):
    det = col["det"]
    d = det_sum(det, days, rid, m)
    parts = []
    if m in STOP_SCOPED:
        hs = hot_stops(d["s"], det_sum(det, days, rid, STOP_SCOPED[m])["s"], line_rate)
        if hs:
            parts.append("stops=" + "|".join(hs))
    if m in HOUR_SCOPED:
        hr = hour_ranges(d["h"])
        if hr:
            parts.append("hours=" + hr)
    dk = day_kind(col, rid, m, days)
    if dk:
        parts.append("days=" + dk)
    if m == "thin_line_days":
        thin = [x for x in days if col["F"].get((x, rid), {}).get("thin_day")]
        if thin:
            parts.append("dates=" + "|".join(thin))
    if m in BUS_SCOPED:
        vs = top_share(d["v"])
        if vs:
            parts.append("vehicles=" + "|".join(vs))
    return parts, d


def flag_note(m, ra, rr, use, d, col, rid, days, names):
    """Plain words for the note= part: both periods, the chosen period's events, and what else the measure knows."""
    def pc(x):
        return f"{x:.1f}%" if x >= 0.95 or x == 0 else f"{x:.2f}%"
    bits = []
    if m in STOP_MEASURES:
        sn = stop_names(col)
        for sid, f in use["stops"]:
            ap = f"closest {f['closest_m']} m" if f["closest_m"] is not None else f"never within {APPROACH_M} m"
            bits.append(f"{sid} {sn.get(sid, '')} {f['rows']} rows (line median {f['line_median']:g}), {ap}")
        bits.append(f"{use['numerator']} of {use['denominator']} stops, {use['days']} days")
        return "; ".join(bits).replace(";", ",").replace("=", " ")
    if ra:
        bits.append(f"all days {pc(ra['value'])} (all lines {pc(ra['baseline'])})")
    if rr:
        bits.append(f"last 14 days {pc(rr['value'])} (all lines {pc(rr['baseline'])})")
    bits.append(f"{use['events']} {EVENT_WORD.get(m, 'rows')} on {use['days']} days"
                + (" (last 14 days)" if use is rr and ra is not rr else ""))
    if m in ("wrong_line_label", "service_under_other_label") and d["o"]:
        lines = ", ".join(names.get(k, k) for k, _ in d["o"].most_common(3))
        bits.append(("lines driven " if m == "wrong_line_label" else "labels used ") + lines)
    if m == "wrong_line_label":
        rows = sum(e[7] for e in col["episodes"] if e[2] == rid and e[0] in set(days))
        bits.append(f"{rows} rows filed under this line meanwhile")
    if m == "listed_time_no_bus":
        ol = sum(col["F"].get((x, rid), {}).get("listed_other_label_bins", 0) for x in days)
        if ol:
            bits.append(f"{ol} more bins had the route driven under another label (not counted)")
    if m == "thin_line_days":
        bits.append("rows vs median " + ", ".join(
            f"{x} {col['F'][(x, rid)]['rows']}/{col['F'][(x, rid)]['weekday_median']}"
            for x in days if col["F"].get((x, rid), {}).get("thin_day")))
    return "; ".join(bits).replace(";", ",").replace("=", " ")


def build_flags(summary, col, today, prev=None):
    """-> collection flag rows (flag_lines.COLS) from the graded summary rows; prev: the previous collection_flags.csv
    rows (first_flagged is kept)."""
    first = {r["flag_id"]: r["first_flagged"] for r in prev or () if FL.valid_date(r.get("first_flagged", ""))}
    by = defaultdict(dict)
    for r in summary:
        if r["route_id"] != "ALL":
            by[(r["route_id"], r["measure"])][r["period"]] = r
    pers = periods(col["days"])
    out = []
    for (rid, m), pr in sorted(by.items()):
        ra, rr = pr.get("all"), pr.get("recent")
        ga, gr = (ra or {}).get("grade", ""), (rr or {}).get("grade", "")
        if not ga and not gr:
            continue
        use, per = (ra, "all") if SEV_ORDER[ga] <= SEV_ORDER[gr] else (rr, "recent")
        sev = use["grade"]
        if m in STOP_MEASURES:
            parts, d = ["stops=" + "|".join(sid for sid, _ in use["stops"])], new_det()
        else:
            parts, d = scope_for(col, rid, m, pers[per], use["value"])
        parts.append("note=" + flag_note(m, ra, rr, use, d, col, rid, pers[per], col["names"]))
        metric, action, extra = TEXT[m]
        metric += " (percent; " + ("last 14 service days" if per == "recent" else "all collected days") + ")"
        fid = f"{CATEGORY}:{m}:{rid}"
        ev = "; ".join([EVID + "line_summary.csv", EVID + "line_days.csv"] + [EVID + x.strip() for x in extra.split(";")
                        if x.strip()] + ["tools/collection_flags.py"])
        out.append({"flag_id": fid, "route_id": rid, "route": col["names"].get(rid, rid), "category": CATEGORY,
                    "flag": m, "severity": sev, "scope": ";".join(parts), "metric": metric,
                    "value": f"{use['value']:.3f}", "baseline": f"{use['baseline']:.3f}",
                    "n": str(int(round(use["denominator"]))), "data_from": use["data_from"], "data_to": use["data_to"],
                    "evidence": ev, "agent_action": action[:1].upper() + action[1:] + ".",
                    "first_flagged": min(first.get(fid, today), today), "last_checked": today,
                    "status": "watch" if sev == "low" else "open"})
    out.sort(key=lambda r: (SEV_ORDER[r["severity"]], r["route"].lower(), r["flag"]))
    return out


# ---------------------------------------------------------------- evidence files
DAY_COLS = ["service_day", "dow", "route_id", "route", "rows", "gps_rows", "pass_rows", "pred_target_rows", "nopred_rows",
            "trip_rows", "trip_bad_rows", "trip_unknown", "trip_other_route", "double_rows", "hours_rows", "outside_rows",
            "listed_day", "weekday_median", "thin_day", "online_min", "visits", "visits_logged", "visits_other_line",
            "visits_missed", "visits_row_off", "wrong_label_min", "wl_episodes", "wrong_label_rows", "other_label_min",
            "ol_episodes", "listed_bins", "listed_nobus_bins", "listed_other_label_bins", "listed_feed_silent_bins",
            "gap_min", "gaps",
            "frozen_min", "frozen_runs"]
SUMMARY_COLS = ["period", "route_id", "route", "measure", "value", "baseline", "ratio", "excess", "numerator",
                "denominator", "unit", "events", "days", "days_over_high", "days_over_medium", "days_over_low", "grade",
                "data_from", "data_to"]
STOP_COLS = ["period", "route_id", "route", "stop_id", "stop", "visits", "logged", "logged_other_line", "missed",
             "missed_share", "row_off", "row_off_share", "line_missed_share", "rows", "line_median_rows",
             "days_listed", "closest_m", "gps_rows", "pass_rows", "pred_target_rows", "nopred_rows", "nopred_share",
             "hotspot"]
EP_COLS = ["service_day", "vehicle_id", "label_route_id", "label_route", "driven_route_id", "driven_route", "start",
           "end", "minutes", "rows_filed_under_label"]
MISS_COLS = ["service_day", "local_time", "vehicle_id", "route_id", "route", "stop_id", "stop"]


def fmt(v):
    if isinstance(v, float):
        return f"{v:.1f}" if abs(v - round(v)) > 1e-9 else str(int(round(v)))
    return v


def write_csv(path, cols, rows, gz=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({c: fmt(r.get(c, "")) for c in cols})
    data = buf.getvalue().encode("utf-8")
    if gz:
        with open(path, "wb") as f:
            with gzip.GzipFile(fileobj=f, mode="wb", mtime=0, filename="") as g:
                g.write(data)
    else:
        path.write_bytes(data)


def stop_names(col):
    names = {}
    for s in col["statics"].by_key.values():
        for sid, x in (s["st"].stops or {}).items():
            names[str(sid)] = x.get("name", "")
    return names


def stop_rows(col, summary):
    names, sn = col["names"], stop_names(col)
    line_rate = {(r["period"], r["route_id"]): r["value"] for r in summary if r["measure"] == "stops_missed"}
    out = []
    for per, days in periods(col["days"]).items():
        dset = set(days)
        acc = defaultdict(Counter)
        for (d, rid, sid), c in col["stops"].items():
            if d in dset:
                acc[(rid, sid)].update({k: v for k, v in c.items() if k != "closest_m"})
        sl = stop_logging(col, days) if col.get("line_stops") else {}
        for k in sl:
            acc[k]
        for (d, rid, m), x in col["det"].items():
            if d not in dset or m not in ("rows:all", "gps_only_rows", "feed_skipped_stops", "no_passio_time:all",
                                          "no_passio_time"):
                continue
            key = {"rows:all": "rows", "gps_only_rows": "gps_rows", "feed_skipped_stops": "pass_rows",
                   "no_passio_time:all": "pred_target_rows", "no_passio_time": "nopred_rows"}[m]
            for sid, n in x["s"].items():
                acc[(rid, sid)][key] += n
        for (rid, sid), c in sorted(acc.items()):
            lr = line_rate.get((per, rid), 0.0)
            ms = rate(c["missed"], c["visits"])
            hot = []
            if c["visits"] >= 20 and ms >= max(1.5 * lr, lr + 5):
                hot.append("missed")
            if c["pred_target_rows"] >= 30 and rate(c["nopred_rows"], c["pred_target_rows"]) >= 75:
                hot.append("no_passio_time")
            f = sl.get((rid, sid))
            if f and f["rare"]:
                hot.append("rarely_logged" if f["closest_m"] is not None and f["closest_m"] <= NEAR_M else "not_driven")
            out.append({"period": per, "route_id": rid, "route": names.get(rid, rid), "stop_id": sid,
                        "stop": sn.get(sid, ""), "visits": c["visits"], "logged": c["logged"],
                        "logged_other_line": c["logged_other_line"], "missed": c["missed"],
                        "missed_share": round(ms, 2), "row_off": c["row_off"],
                        "row_off_share": round(rate(c["row_off"], c["logged"]), 2), "line_missed_share": round(lr, 2),
                        "rows": c["rows"], "line_median_rows": f["line_median"] if f else "",
                        "days_listed": f["days_listed"] if f else "",
                        "closest_m": (f["closest_m"] if f["closest_m"] is not None else f">{APPROACH_M}") if f else "",
                        "gps_rows": c["gps_rows"], "pass_rows": c["pass_rows"],
                        "pred_target_rows": c["pred_target_rows"], "nopred_rows": c["nopred_rows"],
                        "nopred_share": round(rate(c["nopred_rows"], c["pred_target_rows"]), 2),
                        "hotspot": "|".join(hot)})
    return out


def local(t):
    return datetime.fromtimestamp(t, CT).strftime("%Y-%m-%d %H:%M:%S")


def write_evidence(out_dir, col, summary):
    out_dir = Path(out_dir)
    names, sn = col["names"], stop_names(col)
    days = []
    for (d, rid), c in sorted(col["F"].items()):
        if not rid:
            continue
        r = {"service_day": d, "dow": DOWS[date.fromisoformat(d).weekday()], "route_id": rid, "route": names.get(rid, rid)}
        r.update({k: c.get(k, 0) for k in DAY_COLS[4:]})
        days.append(r)
    write_csv(out_dir / "line_days.csv", DAY_COLS, days)
    write_csv(out_dir / "line_summary.csv", SUMMARY_COLS,
              sorted(summary, key=lambda r: (r["period"] != "all", r["measure"], r["route_id"] == "ALL", r["route"])))
    write_csv(out_dir / "stop_coverage.csv", STOP_COLS, stop_rows(col, summary))
    write_csv(out_dir / "wrong_label_episodes.csv", EP_COLS, [
        {"service_day": d, "vehicle_id": veh, "label_route_id": lab, "label_route": names.get(lab, lab),
         "driven_route_id": drv, "driven_route": names.get(drv, drv), "start": local(a), "end": local(b),
         "minutes": nb * BIN_S // 60, "rows_filed_under_label": rows}
        for d, veh, lab, drv, a, b, nb, rows in sorted(col["episodes"], key=lambda e: (e[4], e[1]))])
    write_csv(out_dir / "missed_visits.csv.gz", MISS_COLS, [
        {"service_day": d, "local_time": local(t), "vehicle_id": veh, "route_id": rid, "route": names.get(rid, rid),
         "stop_id": sid, "stop": sn.get(sid, "")}
        for d, veh, rid, sid, t in sorted(col["missed"], key=lambda m: (m[4], m[1], m[3]))], gz=True)


def run_facts(col, summary, flags):
    days, pdays = col["days"], col["poll_days"]
    fleet = Counter()
    for c in col["fleet"].values():
        fleet.update(c)
    sev = Counter(f["severity"] for f in flags)
    return {"data_from": days[0], "data_to": days[-1], "service_days": len(days),
            "poll_days": len(pdays), "poll_from": pdays[0] if pdays else "", "poll_to": pdays[-1] if pdays else "",
            "recent_from": recent_from(days), "arrival_rows": int(sum(c.get("rows", 0) for c in col["F"].values())),
            "stop_visits": int(sum(c.get("visits", 0) for c in col["F"].values())),
            "wrong_label_episodes": len(col["episodes"]), "missed_visits": len(col["missed"]),
            "reports": int(fleet["reports"]), "unknown_route_reports": int(fleet["unknown_route_reports"]),
            "empty_route_reports": int(fleet["empty_route_reports"]),
            "listed_feed_silent_bins": int(fleet["listed_feed_silent_bins"]),
            "flags": len(flags), "high": sev["high"], "medium": sev["medium"], "low": sev["low"]}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dl", required=True, help="folder with arrivals.csv, predictions*.csv, raw-polls-<day>, gtfs-<day>")
    ap.add_argument("--from", dest="d0", default=FIRST_DAY)
    ap.add_argument("--to", dest="d1", default=None, help="newest service day (default: the newest archived raw polls)")
    ap.add_argument("--cache", default=None, help="timetable cache (default <dl>/collection-static)")
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    ap.add_argument("--flags", default=str(FLAGS))
    ap.add_argument("--prev", default=None, help="previous collection_flags.csv (default: --flags)")
    ap.add_argument("--today", default=None)
    ap.add_argument("--json", default=None)
    ap.add_argument("--no-polls", action="store_true", help="arrival-row measures only (no raw polls)")
    a = ap.parse_args(argv)
    today = a.today or FL.today_chicago()
    col = collect(a.dl, a.d0, a.d1, a.cache, polls=not a.no_polls,
                  log=lambda *x: print(*x, file=sys.stderr, flush=True))
    summary = summarize(col)
    prev_path = Path(a.prev or a.flags)
    prev = FL.read_rows(prev_path)[1] if prev_path.exists() else []
    flags = build_flags(summary, col, today, prev)
    write_evidence(a.out_dir, col, summary)
    facts = run_facts(col, summary, flags)
    (Path(a.out_dir) / "run.txt").write_text("".join(f"{k}={v}\n" for k, v in facts.items()), encoding="utf-8")
    write_csv(a.flags, FL.COLS, flags)
    if a.json:
        Path(a.json).write_text(json.dumps({"run": facts, "summary": summary}, indent=1), encoding="utf-8")
    print(f"collection_flags: {facts['service_days']} days ({facts['data_from']} to {facts['data_to']}; raw polls "
          f"{facts['poll_days']} days), {len(flags)} flags ({facts['high']} high, {facts['medium']} medium, "
          f"{facts['low']} low) -> {a.flags}; evidence in {a.out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

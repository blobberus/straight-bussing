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
VISIT_MERGE_S = 300                  # hits of one bus at one stop within this = one visit
VISIT_MATCH_S = 600                  # a visit is logged when a row of that bus and stop lies within this
ROW_OFF_S = 120                      # ... and that row's time is off the GPS pass when more than this away
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
    missed, stop_c = [], defaultdict(Counter)
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
                    if min(abs(r["epoch"] - g[0]) for r in same) > ROW_OFF_S:
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
    for rid, sp in spans.items():
        for a, b in sp:
            for bn in range(-(-a // BIN_S), b // BIN_S):
                if bn not in polled:
                    continue
                if bn not in polls.alive:
                    F[rid]["listed_feed_silent_bins"] += 1
                    continue
                F[rid]["listed_bins"] += 1
                if bn not in seen_bins[rid]:
                    F[rid]["listed_nobus_bins"] += 1
                    mark(det, day, rid, "listed_time_no_bus", bn * BIN_S)
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
           "stops": defaultdict(Counter), "fleet": defaultdict(Counter), "statics": statics}
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

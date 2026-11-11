#!/usr/bin/env python3
"""When each line's buses are really seen starting and ending their service, bus by bus, and when a bus leaves one line
to start another (owner, 2026-11-11: "Refresh the end of service data in another file where each line is shown their
daily seeming end and start time for each bus and transition (explain the reasoning in the same file)").

Writes web/data/service_seen.json: per line and day type (weekday / Saturday / Sunday, split further where the
timetable or the buses differ, e.g. Friday), the line's first and last served stop and last report, each bus in the
order it first reported (Bus 1, Bus 2, ...) with its usual seen start and end (median, 10th to 90th percentile, days
seen), its breaks, the timetable's listed hours for comparison, and the usual line-to-line transitions (a bus leaving
one line and starting another). The reasoning (what every field means, the data, the method, why seen differs from
listed, layovers against lasting changes, how the app uses it, when to refresh) is written INTO the file
(`about`, `fields`, `method`, ...), so the file explains itself.

Inputs, one folder per run (experiments/routeknower/E28-scripts/fetch.py writes it): raw-polls-<day>.jsonl.gz and
gtfs-<day>.zip per Chicago service day (04:00 to 04:00; release assets, tools/archive_day.py) and the data branch's
arrivals.csv. Optional: data/labeled/transitions/odd_episodes.csv (E30), whose wrong_line_label episodes' arrivals are
left out (the bus was filed under another line), and data/calendar.json (holidays and breaks are left out).
Stdlib only; each day's timetable is built with tools/build_gtfs.py (cached by the zip's content).

  python experiments/routeknower/E28-scripts/fetch.py --out <dl> --from 2026-10-10 --to <newest complete day>
  python tools/build_service_seen.py --dl <dl> [--from 2026-10-10] [--to <day>] [--odd data/labeled/transitions/odd_episodes.csv]
      [--out web/data/service_seen.json] [--cache <dir>] [--json <numbers.json>]
"""
import argparse, csv, gzip, hashlib, json, math, subprocess, sys, zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from service_gate import CT   # noqa: E402  (America/Chicago, with a fallback when the system has no zone data)

FRESH_S = 300            # a report at most this much older than its poll is fresh (web/js/core/operating.js STALE_S)
LAYOVER_S = 1800         # back on the same line within this = a layover, the same stint (tools/bus_changes.py LASTING_S)
SHIFT_GAP_S = 3 * 3600   # back on the same line within this = a break inside one shift; later = a new shift (E29 LATER_S)
MIN_ARRIVALS = 3         # a stint needs this many logged arrivals (fewer = a wrong-label blip or a pass, left out)
REPORT_PAD_S = 3600      # first / last report under the line's label: looked for this far before / after the stops
TRANSITION_S = 3 * 3600  # another line within this after the last stop = a transition (longer = a new shift)
DIRECT_S = 1800          # a transition this short is `direct`; longer = `after_break`
CLUSTER_MIN = 60         # transitions of one pair whose clock times are within this belong together (breaks: 30)
CLUSTER_MAX_MIN = 120    # ... but a group wider than this is split at its largest gap
BREAK_CLUSTER_MIN = 30   # breaks at one stop whose start times are within this belong together
MIN_DAYS = 2             # a transition pattern is kept when seen on at least this many days
MIN_BREAK_DAYS = 3       # a break pattern, on at least this many
OFF_LINE_M = 250         # web/js/core/offroute.js BLOCK_M: farther than this from the label's drawn line = off route
LISTED_PAD_MIN = 60      # a shift with under half its time inside the listed spans widened by this is `outside_listed`
FEED_GAP_S = 600         # no poll at all for this long = a collector gap (stints are not split across one)
SPLIT_MIN = 30           # Friday (or any day) is split off when its line-level start or end median differs this much
SPLIT_DAYS = 3           # ... with at least this many days on each side
VALID_DAYS = 45          # valid_until = newest day + this (like web/data/idle.json)
DOWS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
BASE_GROUPS = (("weekday", ("mon", "tue", "wed", "thu", "fri")), ("sat", ("sat",)), ("sun", ("sun",)))
LEFT_OUT_REGIMES = ("holiday", "break")


# ---------------------------------------------------------------- small helpers
def day_bounds(day):
    d = date.fromisoformat(day)
    n = d + timedelta(days=1)
    return (int(datetime(d.year, d.month, d.day, 4, tzinfo=CT).timestamp()),
            int(datetime(n.year, n.month, n.day, 4, tzinfo=CT).timestamp()))


def clock_min(t, day):
    """Service-day clock minutes of epoch t (00:30 the next morning = 24:30 = 1470)."""
    dt = datetime.fromtimestamp(t, CT)
    extra = (dt.date() - date.fromisoformat(day)).days * 1440
    return dt.hour * 60 + dt.minute + dt.second / 60 + extra


def hhmm(m):
    """1470.4 -> '24:30' (service-day clock, may pass 24:00, like web/data/service.json and idle.json)."""
    m = int(round(m))
    return f"{m // 60:02d}:{m % 60:02d}"


def mins(s):
    h, m = str(s).split(":")
    return int(h) * 60 + int(m)


def pct(xs, q):
    """Linear interpolation between the sorted values (q in 0..1)."""
    xs = sorted(xs)
    if not xs:
        return None
    pos = q * (len(xs) - 1)
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def stat(xs):
    """{p10, p50, p90, n} as service-day clock times, or None."""
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return {"p10": hhmm(pct(xs, 0.1)), "p50": hhmm(pct(xs, 0.5)), "p90": hhmm(pct(xs, 0.9)), "n": len(xs)}


def med(xs, nd=0):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    v = pct(xs, 0.5)
    return round(v, nd) if nd else int(round(v))


def xy(lat, lon):
    return ((lon + 87.60) * 111320 * math.cos(math.radians(41.79)), (lat - 41.79) * 110540)


def seg_dist(p, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 <= 1e-9 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2))
    return math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))


class Lines:
    """Distance from a point to a route's drawn line (shapes.json), brute force over the route's segments."""

    def __init__(self, shapes):
        self.segs = {}
        for rid, lines in (shapes or {}).items():
            s = []
            for line in lines or []:
                pts = [xy(q[0], q[1]) for q in line]
                s += list(zip(pts[:-1], pts[1:]))
            self.segs[str(rid)] = s

    def dist(self, rid, lat, lon):
        s = self.segs.get(str(rid))
        if not s:
            return None
        p = xy(lat, lon)
        return min(seg_dist(p, a, b) for a, b in s)


# ---------------------------------------------------------------- inputs
def zip_for(dl, day):
    """docs/DATA-COLLECTION-LOG.md DC-021: before 2026-11-01 gtfs-<D>.zip holds the next morning's timetable, so day D
    uses gtfs-<D-1>.zip; from Nov 1 gtfs-<D>.zip is the day's own."""
    d = date.fromisoformat(day)
    order = [d - timedelta(days=1), d] if d < date(2026, 11, 1) else [d, d - timedelta(days=1)]
    for k in order + [d + timedelta(days=1)]:
        p = Path(dl) / f"gtfs-{k}.zip"
        if p.exists():
            return p
    return None


def static_for(zpath, cache):
    """routes / shapes / service JSON of a timetable (tools/build_gtfs.py), cached by the zip's content (the same key as
    experiments/routeknower/E32-scripts/inputs.py, so its folders can be reused)."""
    h = hashlib.sha1()
    with zipfile.ZipFile(zpath) as z:
        for n in sorted(z.namelist()):
            h.update(n.encode())
            h.update(z.read(n))
    out = Path(cache) / ("static-" + h.hexdigest()[:12])
    if not (out / "service.json").exists():
        out.mkdir(parents=True, exist_ok=True)
        subprocess.run([sys.executable, str(ROOT / "tools" / "build_gtfs.py"), "--zip", str(zpath), "--out", str(out),
                        "--patterns", str(out / "route_patterns.json")], check=True, capture_output=True)
    load = lambda n: json.loads((out / n).read_text(encoding="utf-8"))
    return {"routes": load("routes.json"), "shapes": load("shapes.json"), "service": load("service.json"),
            "key": out.name}


def listed_spans(service, rid, day):
    """The route's listed spans on a service day as [['HH:MM', 'HH:MM']] (a calendar exception replaces the weekday)."""
    r = ((service or {}).get("routes") or {}).get(str(rid)) or {}
    exc = next((e for e in r.get("exceptions") or [] if e.get("date") == day), None)
    if exc is not None:
        return [list(s) for s in ((exc.get("hours") or {}).get("spans") or [])]
    dd = (r.get("days") or {}).get(DOWS[date.fromisoformat(day).weekday()]) or {}
    return [list(s) for s in dd.get("spans") or []]


def load_reports(path, day, routes):
    """Fresh reports of the service day: ({veh: [(vt, rid, lat, lon)]} sorted, sorted poll times)."""
    t0, t1 = day_bounds(day)
    by, seen, polls = defaultdict(list), set(), []
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for ln in f:
            try:
                p = json.loads(ln)
            except ValueError:
                continue
            h = int(p.get("h") or p.get("t") or 0)
            if t0 <= h < t1 + FRESH_S:
                polls.append(h)
            for v in p.get("v") or []:
                try:
                    veh, rid, lat, lon, vt = str(v[0]), str(v[2]), float(v[3]), float(v[4]), int(v[10] or 0)
                except (ValueError, TypeError, IndexError):
                    continue
                if not vt or not (t0 <= vt < t1) or (veh, vt) in seen or h - vt > FRESH_S or rid not in routes:
                    continue
                seen.add((veh, vt))
                by[veh].append((vt, rid, lat, lon))
    for v in by.values():
        v.sort()
    return by, sorted(polls)


def load_arrivals(path):
    """Per vehicle: sorted (epoch, route_id, stop_name)."""
    by = defaultdict(list)
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            try:
                by[str(r["vehicle_id"])].append((int(r["epoch"]), str(r["route_id"]), r.get("stop_name") or ""))
            except (KeyError, ValueError):
                continue
    for v in by.values():
        v.sort()
    return by


def load_wrong_labels(path):
    """E30 wrong_line_label episodes: {veh: [(start, end)]} epochs (local_time / end_time are Chicago clock)."""
    out = defaultdict(list)
    if not path or not Path(path).exists():
        return out
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r.get("code") != "wrong_line_label":
                continue
            try:
                a = datetime.strptime(r["local_time"], "%Y-%m-%d %H:%M").replace(tzinfo=CT)
                b = datetime.strptime(r["end_time"], "%Y-%m-%d %H:%M").replace(tzinfo=CT)
            except (KeyError, ValueError):
                continue
            out[str(r["vehicle_id"])].append((int(a.timestamp()) - 60, int(b.timestamp()) + 60))
    return out


def calendar_regime(cal, day):
    for r in (cal or {}).get("regimes") or []:
        if r.get("start", "") <= day <= r.get("end", ""):
            return r.get("regime") or ""
    return ""


def feed_gaps(polls, t0, t1):
    """[(a, b)] stretches of the day with no poll at all for FEED_GAP_S or more (the collector was down)."""
    out, prev = [], None
    for h in polls:
        if prev is not None and h - prev >= FEED_GAP_S:
            out.append((prev, h))
        prev = h
    return out


def listed_share(spans, a, b):
    """Share of [a, b] (clock minutes) inside the spans; a point counts as 1 when inside one."""
    if b <= a:
        return 1.0 if any(x <= a <= y for x, y in spans) else 0.0
    return sum(max(0.0, min(b, y) - max(a, x)) for x, y in spans) / (b - a)


def covered_by_gap(gaps, a, b):
    """True when a collector gap explains the silence between a and b: it overlaps it, and what it leaves uncovered
    is no longer than a layover."""
    for x, y in gaps:
        ov = min(b, y) - max(a, x)
        if ov > 0 and (b - a) - ov <= LAYOVER_S:
            return True
    return False


# ---------------------------------------------------------------- one service day
def stints_of(arr, gaps):
    """A bus's logged arrivals -> stints [(rid, start, end, n, first stop, last stop)]: consecutive arrivals on one line
    with gaps up to LAYOVER_S (or a collector gap); stints with fewer than MIN_ARRIVALS are dropped, and the stints
    around them re-joined when they are on the same line within LAYOVER_S."""
    raw = []
    for t, rid, stop in arr:
        s = raw[-1] if raw else None
        if s and s[0] == rid and (t - s[2] <= LAYOVER_S or covered_by_gap(gaps, s[2], t)):
            raw[-1] = (rid, s[1], t, s[3] + 1, s[4], stop)
        else:
            raw.append((rid, t, t, 1, stop, stop))
    keep = [s for s in raw if s[3] >= MIN_ARRIVALS]
    out = []
    for s in keep:
        p = out[-1] if out else None
        if p and p[0] == s[0] and (s[1] - p[2] <= LAYOVER_S or covered_by_gap(gaps, p[2], s[1])):
            out[-1] = (p[0], p[1], s[2], p[3] + s[3], p[4], s[5])
        else:
            out.append(s)
    return out


def label_reports(reps, rid, a, b):
    return [r for r in reps if a <= r[0] <= b and r[1] == rid]


def day_facts(day, reports, arrivals, wrong, static, polls):
    """Shifts (one bus on one line, breaks inside), line facts and transitions of one service day."""
    t0, t1 = day_bounds(day)
    gaps = feed_gaps(polls, t0, t1)
    lines = static.get("_lines") or Lines(static["shapes"])
    static["_lines"] = lines
    shifts, trans, breaks = [], [], []
    for veh, arr in arrivals.items():
        a = [x for x in arr if t0 <= x[0] < t1 and str(x[1]) in static["routes"]
             and not any(p <= x[0] <= q for p, q in wrong.get(veh, ()))]
        if not a:
            continue
        st = stints_of(a, gaps)
        reps = reports.get(veh, [])
        # shifts: the bus's stints on one line within SHIFT_GAP_S of each other (the gaps between them are breaks)
        by_line = defaultdict(list)
        for s in st:
            by_line[s[0]].append(s)
        for rid, ss in by_line.items():
            cur = None
            for s in ss:
                if cur and s[1] - cur["end"] <= SHIFT_GAP_S:
                    cur["breaks"].append((cur["end"], s[1], cur["last_stop"], s[4]))
                    cur.update(end=s[2], n=cur["n"] + s[3], last_stop=s[5])
                else:
                    if cur:
                        shifts.append(cur)
                    cur = {"day": day, "veh": veh, "rid": rid, "start": s[1], "end": s[2], "n": s[3],
                           "first_stop": s[4], "last_stop": s[5], "breaks": []}
            if cur:
                shifts.append(cur)
        # transitions: consecutive stints on different lines within TRANSITION_S
        for x, y in zip(st, st[1:]):
            if x[0] == y[0] or y[1] - x[2] > TRANSITION_S:
                continue
            way = [r for r in reps if x[2] < r[0] < y[1]]
            lab = Counter("from" if r[1] == x[0] else "to" if r[1] == y[0] else "other" for r in way)
            first_to = next((r[0] for r in way if r[1] == y[0]), None)
            last_from = max((r[0] for r in way if r[1] == x[0]), default=None)
            off = [d > OFF_LINE_M for d in (lines.dist(r[1], r[2], r[3]) for r in way) if d is not None]
            trans.append({"day": day, "veh": veh, "from": x[0], "to": y[0], "leave": x[2], "join": y[1],
                          "left_at": x[5], "joined_at": y[4], "labels": lab, "reports": len(way),
                          "to_label_min": None if first_to is None else (first_to - x[2]) / 60,
                          "from_label_min": None if last_from is None else (last_from - x[2]) / 60,
                          "off_line": sum(off), "judged": len(off)})
    for sh in shifts:
        reps = reports.get(sh["veh"], [])
        before = label_reports(reps, sh["rid"], sh["start"] - REPORT_PAD_S, sh["start"])
        after = label_reports(reps, sh["rid"], sh["end"], sh["end"] + REPORT_PAD_S)
        sh["first_report"] = before[0][0] if before else sh["start"]
        sh["last_report"] = after[-1][0] if after else sh["end"]
        spans = [(mins(x) - LISTED_PAD_MIN, mins(y) + LISTED_PAD_MIN)
                 for x, y in listed_spans(static["service"], sh["rid"], day)]
        sh["outside"] = listed_share(spans, clock_min(sh["start"], day), clock_min(sh["end"], day)) < 0.5
        if sh["outside"]:
            continue
        for b in sh["breaks"]:
            breaks.append({"day": day, "veh": sh["veh"], "rid": sh["rid"], "from": b[0], "to": b[1], "at": b[2],
                           "back_at": b[3]})
    outside = [s for s in shifts if s["outside"]]
    shifts = [s for s in shifts if not s["outside"]]
    # bus order per line: by first report under the line's label
    per = defaultdict(list)
    for sh in shifts:
        per[sh["rid"]].append(sh)
    for rid, ss in per.items():
        ss.sort(key=lambda s: (s["first_report"], s["start"], s["veh"]))
        for k, s in enumerate(ss, 1):
            s["order"] = k
    for tr in trans:
        tr["from_order"] = next((s["order"] for s in shifts if s["veh"] == tr["veh"] and s["rid"] == tr["from"]
                                 and s["start"] <= tr["leave"] <= s["end"]), None)
        tr["to_order"] = next((s["order"] for s in shifts if s["veh"] == tr["veh"] and s["rid"] == tr["to"]
                               and s["start"] <= tr["join"] <= s["end"]), None)
    trans = [t for t in trans if t["from_order"] is not None and t["to_order"] is not None]
    return {"day": day, "shifts": shifts, "transitions": trans, "breaks": breaks, "gaps": gaps, "outside": outside}


# ---------------------------------------------------------------- aggregation
def clusters(items, key_min, gap=CLUSTER_MIN, width=CLUSTER_MAX_MIN):
    """Split items (sorted by key_min) where consecutive clock times are more than `gap` minutes apart; a group wider
    than `width` minutes is split again at its largest gap (while that gap is 10 min or more)."""
    items = sorted(items, key=key_min)
    out, cur = [], []
    for it in items:
        if cur and key_min(it) - key_min(cur[-1]) > gap:
            out.append(cur)
            cur = []
        cur.append(it)
    if cur:
        out.append(cur)
    final = []
    while out:
        c = out.pop(0)
        ks = [key_min(x) for x in c]
        if ks[-1] - ks[0] <= width or len(c) < 2:
            final.append(c)
            continue
        g, i = max((ks[j + 1] - ks[j], j) for j in range(len(c) - 1))
        if g < 10:
            final.append(c)
            continue
        out[:0] = [c[:i + 1], c[i + 1:]]
    return final


def top(counter, n=1):
    return [k for k, _ in counter.most_common(n)]


def vehicles(items, n=3):
    """The buses seen most, as 'bus xdays' (days, not times)."""
    c = Counter()
    for v, d in {(x["veh"], x["day"]) for x in items}:
        c[v] += 1
    return [f"{v} x{k}" for v, k in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:n]]


def spans_seen(lst, day_shifts):
    """Per listed span (a line listed twice a day, e.g. Midway Metra's morning and afternoon): the seen first and last
    stop of the shifts that overlap it most (spans widened by LISTED_PAD_MIN)."""
    out = []
    for i, (a, b) in enumerate(lst):
        firsts, lasts = [], []
        for day, ss in day_shifts.items():
            mine = []
            for s in ss:
                x, y = clock_min(s["start"], day), clock_min(s["end"], day)
                ov = [max(0.0, min(y, mins(q) + LISTED_PAD_MIN) - max(x, mins(p) - LISTED_PAD_MIN)) for p, q in lst]
                if x == y:
                    ov = [1.0 if mins(p) - LISTED_PAD_MIN <= x <= mins(q) + LISTED_PAD_MIN else 0.0 for p, q in lst]
                if max(ov) > 0 and ov.index(max(ov)) == i:
                    mine.append((x, y))
            if mine:
                firsts.append(min(x for x, _ in mine))
                lasts.append(max(y for _, y in mine))
        out.append({"listed": [a, b], "first_stop": stat(firsts), "last_stop": stat(lasts),
                    "end_early_min": int(round(mins(b) - pct(lasts, 0.5))) if lasts else None})
    return out


def line_day_stats(day_rows):
    """Line-level facts per day: first stop, last stop, last report, buses (shifts)."""
    out = {}
    for day, ss in day_rows.items():
        out[day] = {"first_stop": min(clock_min(s["start"], day) for s in ss),
                    "first_report": min(clock_min(s["first_report"], day) for s in ss),
                    "last_stop": max(clock_min(s["end"], day) for s in ss),
                    "last_report": max(clock_min(s["last_report"], day) for s in ss),
                    "buses": len(ss), "vehicles": len({s["veh"] for s in ss})}
    return out


def dow_label(dows):
    """['mon', 'wed', 'thu', 'fri'] -> 'mon+wed-fri' (runs of consecutive days joined with '-')."""
    ix = sorted(DOWS.index(d) for d in dows)
    runs, cur = [], [ix[0]]
    for i in ix[1:]:
        if i == cur[-1] + 1:
            cur.append(i)
        else:
            runs.append(cur)
            cur = [i]
    runs.append(cur)
    return "+".join(DOWS[r[0]] if len(r) == 1 else f"{DOWS[r[0]]}-{DOWS[r[-1]]}" for r in runs)


def differs(one, rest):
    """(median difference, True) when the medians differ by SPLIT_MIN and the two sets barely overlap (the later
    set's 25th percentile above the earlier set's 75th): a real pattern, not a few odd days."""
    a, b = pct(one, 0.5), pct(rest, 0.5)
    if abs(a - b) < SPLIT_MIN:
        return a - b, False
    lo, hi = (rest, one) if a > b else (one, rest)
    return a - b, pct(hi, 0.25) > pct(lo, 0.75)


def group_days(rid, days, listed_of, line_days):
    """Day types for one line: weekday / sat / sun, split where the listed hours differ inside a group, then a single
    weekday whose line-level first or last stop differs from the rest of its group (differs(); Friday nights were
    the suspect). Returns [(type, dows, days, why)]."""
    groups = []
    for name, dows in BASE_GROUPS:
        ds = [d for d in days if DOWS[date.fromisoformat(d).weekday()] in dows]
        sig = defaultdict(list)
        for d in ds:
            sig[json.dumps(listed_of(rid, d))].append(d)
        parts = list(sig.values())
        if len(parts) > 1:
            for part in parts:
                pd = sorted({DOWS[date.fromisoformat(d).weekday()] for d in part}, key=DOWS.index)
                groups.append((dow_label(pd), pd, part, "the timetable lists different hours on these days"))
        elif ds:
            groups.append((name, list(dows), ds, ""))
    final = []
    for name, dows, ds, why in groups:
        split = None
        for dw in (dows if len(dows) >= 2 else ()):
            one = [d for d in ds if DOWS[date.fromisoformat(d).weekday()] == dw and d in line_days]
            rest = [d for d in ds if DOWS[date.fromisoformat(d).weekday()] != dw and d in line_days]
            if len(one) < SPLIT_DAYS or len(rest) < SPLIT_DAYS:
                continue
            for k in ("first_stop", "last_stop"):
                diff, real = differs([line_days[d][k] for d in one], [line_days[d][k] for d in rest])
                if real:
                    split = (dw, k, diff)
                    break
            if split:
                break
        if not split:
            final.append((name, dows, ds, why))
            continue
        dw, k, diff = split
        rest_dows = [x for x in dows if x != dw]
        note = (f"{dw} split off: its {k.replace('_', ' ')} is {abs(diff):.0f} min {'later' if diff > 0 else 'earlier'} "
                f"(median) than on the other days")
        final.append((dow_label(rest_dows), rest_dows, [d for d in ds if DOWS[date.fromisoformat(d).weekday()] != dw],
                      note))
        final.append((dw, [dw], [d for d in ds if DOWS[date.fromisoformat(d).weekday()] == dw], note))
    return final


def weekday_check(rid, days, line_days, dw="fri"):
    """[first stop, last stop] median minutes of one weekday minus the other weekdays (positive = later), or None."""
    one = [d for d in days if DOWS[date.fromisoformat(d).weekday()] == dw and d in line_days]
    rest = [d for d in days if DOWS[date.fromisoformat(d).weekday()] in ("mon", "tue", "wed", "thu") and d in line_days]
    if len(one) < 2 or len(rest) < 2:
        return None
    return [int(round(pct([line_days[d][k] for d in one], 0.5) - pct([line_days[d][k] for d in rest], 0.5)))
            for k in ("first_stop", "last_stop")]


def build(facts, statics, names, used_days, left_out, gaps_by_day, a_from, a_to):
    shifts = [s for f in facts for s in f["shifts"]]
    trans = [t for f in facts for t in f["transitions"]]
    brks = [b for f in facts for b in f["breaks"]]
    listed_of = lambda rid, d: listed_spans(statics[d]["service"], rid, d)
    by_line_day = defaultdict(lambda: defaultdict(list))
    for s in shifts:
        by_line_day[s["rid"]][s["day"]].append(s)
    rids = sorted(set(by_line_day) | {rid for d in used_days for rid in statics[d]["service"].get("routes", {})
                                      if listed_of(rid, d)})
    lines, group_of, fri_check = {}, {}, {}
    for rid in rids:
        ld = line_day_stats(by_line_day.get(rid, {}))
        entries = []
        for name, dows, ds, why in group_days(rid, used_days, listed_of, ld):
            listed = Counter(json.dumps(listed_of(rid, d)) for d in ds)
            lst, lst_n = listed.most_common(1)[0]
            lst = json.loads(lst)
            seen_days = [d for d in ds if d in ld]
            if not seen_days and not lst:
                continue
            for d in ds:
                group_of[(rid, d)] = name
            e = {"type": name, "dows": dows, "days_total": len(ds), "days_seen": len(seen_days),
                 "listed": {"spans": lst, "days": lst_n}}
            if why:
                e["split"] = why
            if seen_days:
                L = [ld[d] for d in seen_days]
                e["seen"] = {k: stat([x[k] for x in L]) for k in ("first_report", "first_stop", "last_stop", "last_report")}
                e["seen"]["buses"] = {"p50": med([x["buses"] for x in L]), "max": max(x["buses"] for x in L)}
                if lst:
                    st, en = mins(lst[0][0]), mins(lst[-1][1])
                    fs = pct([x["first_stop"] for x in L], 0.5)
                    ls = pct([x["last_stop"] for x in L], 0.5)
                    e["vs_listed"] = {"start_late_min": int(round(fs - st)), "end_early_min": int(round(en - ls)),
                                      "days_ending_15_min_early": sum(1 for x in L if x["last_stop"] < en - 15),
                                      "days_ending_after_listed": sum(1 for x in L if x["last_stop"] > en)}
                if len(lst) > 1:
                    e["spans_seen"] = spans_seen(lst, {d: by_line_day[rid][d] for d in seen_days})
                buses = []
                kmax = max(x["buses"] for x in L)
                for k in range(1, kmax + 1):
                    ss = [s for d in seen_days for s in by_line_day[rid][d] if s["order"] == k]
                    if not ss:
                        continue
                    veh = Counter(s["veh"] for s in ss)
                    b = {"bus": k, "days": len(ss),
                         "first_report": stat([clock_min(s["first_report"], s["day"]) for s in ss]),
                         "first_stop": stat([clock_min(s["start"], s["day"]) for s in ss]),
                         "last_stop": stat([clock_min(s["end"], s["day"]) for s in ss]),
                         "last_report": stat([clock_min(s["last_report"], s["day"]) for s in ss]),
                         "starts_at": top(Counter(s["first_stop"] for s in ss))[0],
                         "ends_at": top(Counter(s["last_stop"] for s in ss))[0],
                         "breaks_days": sum(1 for s in ss if s["breaks"]),
                         "vehicle": top(veh)[0], "vehicle_days": veh.most_common(1)[0][1]}
                    buses.append(b)
                e["buses"] = buses
                by_at = defaultdict(list)
                for b in brks:
                    if b["rid"] == rid and b["day"] in seen_days:
                        by_at[b["at"]].append(b)
                bp = []
                for at, bl in by_at.items():
                    for cl in clusters(bl, lambda b: clock_min(b["from"], b["day"]), gap=BREAK_CLUSTER_MIN):
                        nd = len({b["day"] for b in cl})
                        if nd < MIN_BREAK_DAYS:
                            continue
                        bp.append({"from": stat([clock_min(b["from"], b["day"]) for b in cl]),
                                   "to": stat([clock_min(b["to"], b["day"]) for b in cl]),
                                   "days": nd, "times": len(cl), "at": at,
                                   "back_at": top(Counter(b["back_at"] for b in cl))[0],
                                   "vehicles": vehicles(cl)})
                if bp:
                    e["breaks"] = sorted(bp, key=lambda b: mins(b["from"]["p50"]))
            out_l = [s for f in facts if f["day"] in ds for s in f["outside"] if s["rid"] == rid]
            if out_l:
                e["outside_listed"] = {"days": len({s["day"] for s in out_l}), "times": len(out_l),
                                       "first_stop": stat([clock_min(s["start"], s["day"]) for s in out_l]),
                                       "last_stop": stat([clock_min(s["end"], s["day"]) for s in out_l]),
                                       "vehicles": vehicles(out_l)}
            entries.append(e)
        fri = weekday_check(rid, used_days, ld)
        if fri is not None:
            fri_check[rid] = fri
        if entries:
            nm = names.get(rid, rid)
            lines[rid] = {"name": nm, "days": entries}
    # transitions: per (from, to, from-line day type), clustered by the leave clock time
    tout = []
    grp = defaultdict(list)
    for t in trans:
        g = group_of.get((t["from"], t["day"]))
        if g is not None:
            grp[(t["from"], t["to"], g)].append(t)
    for (fr, to, g), ts in sorted(grp.items()):
        e_days = next((e["days_total"] for e in lines.get(fr, {}).get("days", []) if e["type"] == g), None)
        for cl in clusters(ts, lambda t: clock_min(t["leave"], t["day"])):
            nd = len({t["day"] for t in cl})
            if nd < MIN_DAYS:
                continue
            lab = Counter()
            for t in cl:
                lab.update(t["labels"])
            way = sum(lab.values())
            label = ("none" if not way else max(("from", "to", "other"), key=lambda k: lab[k]))
            off, judged = sum(t["off_line"] for t in cl), sum(t["judged"] for t in cl)
            gap = [(t["join"] - t["leave"]) / 60 for t in cl]
            tout.append({"from": fr, "from_name": names.get(fr, fr), "to": to, "to_name": names.get(to, to),
                         "day_type": g, "days": nd, "of_days": e_days, "times": len(cl),
                         "kind": "direct" if pct(gap, 0.5) <= DIRECT_S / 60 else "after_break",
                         "leave": stat([clock_min(t["leave"], t["day"]) for t in cl]),
                         "join": stat([clock_min(t["join"], t["day"]) for t in cl]),
                         "gap_min": med(gap), "left_at": top(Counter(t["left_at"] for t in cl))[0],
                         "joined_at": top(Counter(t["joined_at"] for t in cl))[0],
                         "from_bus": top(Counter(t["from_order"] for t in cl))[0],
                         "to_bus": top(Counter(t["to_order"] for t in cl))[0],
                         "label_on_the_way": label,
                         "label_share": {k: round(lab[k] / way, 2) for k in ("from", "to", "other")} if way else None,
                         "to_label_after_min": med([t["to_label_min"] for t in cl], 1),
                         "off_line_share": round(off / judged, 2) if judged else None,
                         "unseen_on_the_way": sum(1 for t in cl if not t["reports"]),
                         "vehicles": vehicles(cl)})
    tout.sort(key=lambda t: (t["day_type"], mins(t["leave"]["p50"]), t["from"], t["to"]))
    newest = date.fromisoformat(used_days[-1])
    return {"from": a_from, "to": a_to, "days_used": len(used_days), "days_left_out": left_out,
            "collector_gaps": {d: [f"{hhmm(clock_min(a, d))}-{hhmm(clock_min(b, d))}" for a, b in g]
                               for d, g in sorted(gaps_by_day.items()) if g},
            "valid_until": (newest + timedelta(days=VALID_DAYS)).isoformat(),
            "friday_vs_mon_thu": fri_check, "lines": lines, "transitions": tout}


# ---------------------------------------------------------------- the reasoning written into the file
ABOUT = {
    "about": (
        "When each campus shuttle line's buses are REALLY seen starting and ending service, bus by bus, compared with "
        "the timetable, and when a bus leaves one line to start another (a transition). Owner, 2026-11-11: \"Refresh the "
        "end of service data in another file where each line is shown their daily seeming end and start time for each "
        "bus and transition (explain the reasoning in the same file).\" Built by tools/build_service_seen.py from what "
        "Passio's public feed showed and what the collector logged; learned, unofficial, not a timetable: it says "
        "what usually happened, never what will happen. web/data/idle.json is a separate, older file (E28 linger spots)."),
    "fields": {
        "from, to, days_used": "the service days used (a service day runs 04:00 to 04:00 Chicago time)",
        "days_left_out": "days in the range not used, with why (holidays and breaks from data/calendar.json, missing data)",
        "collector_gaps": "stretches with no poll at all (the collector was down); stints are not split across them, but a "
                          "start or end inside one is read late or early",
        "valid_until": "newest day + 45 days; after it, treat the file as stale (refresh it)",
        "lines.<route_id>.name": "the line (GTFS route_id = the live feed's route_id)",
        "lines.<route_id>.days[]": "one entry per day type: `type` (weekday, sat, sun, or a split such as mon-thu + fri), "
                                   "`dows` (the days of the week it covers: pick the entry whose dows include today), "
                                   "`days_total` (service days of that type in the range), `days_seen` (days a bus "
                                   "served the line), `split` (why the type was split, if it was)",
        "listed": "the timetable's listed spans on those days ('HH:MM' service-day clock; 24:25 = 00:25 the next "
                  "morning), from each day's own timetable; `days` = days with that listing (the most common one)",
        "seen": "line level, per day then summarized: first_report (first fresh report under the line's label within an "
                "hour before a bus's first stop), first_stop (first logged arrival of any bus), last_stop (last logged "
                "arrival of any bus), last_report (last fresh report under the label within an hour after a bus's last "
                "stop); buses = shifts per day (p50, max)",
        "stat {p10, p50, p90, n}": "service-day clock times: median (p50) and the 10th to 90th percentile spread over "
                                   "n days (linear interpolation; with fewer than 5 days p10 / p90 are about the "
                                   "earliest / latest day)",
        "vs_listed": "start_late_min = median first stop - listed start; end_early_min = listed end - median last stop "
                     "(positive = the buses stop before the listed end); days_ending_15_min_early; days_ending_after_listed",
        "buses[]": "Bus 1, Bus 2, ... = the line's shifts of the day in the order they first reported under the line's "
                   "label (NOT the app's Bus N labels, which follow vehicle numbers: web/js/core/busnum.js). Per bus: "
                   "days (days the line had a k-th bus), first_report, first_stop, last_stop, last_report (stats), "
                   "starts_at / ends_at (the most common first / last stop), breaks_days (days that bus took a break "
                   "of 30 min to 3 h inside its shift), vehicle / vehicle_days (the bus number seen most in that slot)",
        "breaks[]": "a line's usual breaks inside a shift (same line again 30 min to 3 h later), per stop where they "
                    "start, seen on 3 days or more: from / to (stats of the break's start = the last stop before it, "
                    "and end = the first stop after it), days, times, at / back_at (stops), vehicles (top 3, 'bus "
                    "xdays')",
        "spans_seen": "for a line listed twice a day (Midway Metra): per listed span, the seen first / last stop of the "
                      "shifts that overlap it most and end_early_min (listed span end - median last stop)",
        "outside_listed": "shifts seen under the line's label with under half their time inside the listed hours "
                          "widened by 60 min (usually a bus that kept last night's label): counted here, never as a "
                          "Bus k",
        "friday_vs_mon_thu": "per line, Friday's median [first stop, last stop] minus Monday to Thursday's, in minutes "
                             "(positive = later): the check for Friday nights",
        "transitions[]": "a bus leaving one line and starting another within 3 h: from / to (route ids + names), "
                         "day_type (of the from line), days (days seen) of of_days, times, kind (direct = median gap "
                         "up to 30 min, after_break = longer), leave (its last stop on the from line), join (its first "
                         "stop on the to line), gap_min (median), left_at / joined_at (stops), from_bus / to_bus (its "
                         "order on each line that day), label_on_the_way (the label most of its reports between leave "
                         "and join carried: from, to, other, or none = out of the feed), label_share, "
                         "to_label_after_min (median minutes after leaving until it first reported under the new "
                         "line's label), off_line_share (share of its reports on the way farther than 250 m from the "
                         "drawn line of the label they carried: what the app's off-route rule measures; learned "
                         "corridors not applied), unseen_on_the_way (times with no report at all on the way), "
                         "vehicles (top 3)",
    },
    "method": [
        "Data: every archived service day from `from` to `to` (raw position polls = what the app's feed showed; each "
        "day's own timetable; the collector's logged arrivals, data branch data/ground_truth/arrivals.csv, every "
        "source). A report counts when it is at most 300 s older than its poll (web/js/core/operating.js).",
        "A STINT = a bus's consecutive logged arrivals on one line with gaps of at most 30 min (or a collector gap); "
        "stints with fewer than 3 arrivals are dropped as noise (a pass under a wrong label) and the stints around them "
        "re-joined. Arrivals inside E30's wrong_line_label episodes (data/labeled/transitions/odd_episodes.csv: the bus "
        "drove another line under this label) are left out.",
        "A SHIFT = one bus's stints on one line within 3 h of each other; the gaps of 30 min to 3 h inside it are its "
        "breaks; a return after more than 3 h is a new shift (a new Bus k). seen start = its first stop, seen end = its "
        "last stop; first / last report = its earliest / latest fresh report under the line's label up to an hour "
        "before / after (a bus deadheading from the garage, or lingering after its last trip, under the label).",
        "Bus order: per line and day, the shifts sorted by first report (Bus 1 reported first). Each Bus k is then "
        "summarized over the days of the day type that had a k-th bus.",
        "A TRANSITION = a bus's stint on line A followed by a stint on line B (B not A) within 3 h; leave = its last "
        "stop on A, join = its first stop on B. Grouped per (A, B, A's day type) and split where the leave clock times "
        "of consecutive cases are more than 60 min apart; kept when seen on 2 days or more.",
        "Day types: weekday (Mon to Fri), Saturday, Sunday; split where the timetable lists different hours inside a "
        "type, and a single weekday is split off when its median first or last stop differs from the rest by 30 min "
        "or more (3 days or more on each side).",
        "Holidays and breaks (data/calendar.json regimes holiday / break) are left out: the shuttles run a different "
        "service then. Reading period and finals are kept (same timetable).",
    ],
    "why_seen_differs_from_listed": [
        "Listed ends outlast the service on every weekday (RouteKnower E30, service_end_early): the Downtown Campus "
        "Connector is listed to 00:25 but its last bus ends about 22:04 to 23:09; Apostolic/Drexel to 00:55 vs about "
        "00:00 (the NightRide notice's end); 53rd Street Express to 19:25 vs about 18:10; Midway Metra's morning span "
        "to 11:55 vs about 10:00 on 20 of 22 weekdays.",
        "Some listed buses never come: North's second bus from 21:00 was missing on 26 of 32 days (E30 "
        "timetable_add_missed); Friend Center/Metra's 05:00 weekend listing never runs (known since Oct 25).",
        "NightRide (North, South, East) is listed to about 04:29 but Passio lists no bus after about midnight "
        "(the app says \"No shuttles are reporting live locations\" then; project notes 2026-10-10).",
        "Some lines run past the listed end: Central (listed to 23:14) reports until about 23:30 to 00:00 on most "
        "nights (E30 after_hours).",
        "The timetable is the operator's plan; Passio's feed shows the buses that actually report. A bus can also serve "
        "unseen (its tablet off): `days_seen` and the collector gaps say how much to trust a line's numbers.",
    ],
    "layovers_vs_lasting": (
        "Between trips Passio leaves a bus out of the feed for 10 to 27 min (a layover), so a short silence is not the "
        "end of service. The same 30-min rule as the collector's bus count changes (tools/bus_changes.py LASTING_S, "
        "data/ground_truth/bus_changes.csv `lasting`: a dropped bus back on its line within 30 min is a layover, "
        "lasting = 0) joins a bus's arrivals into one stint; a longer gap on the same line (up to 3 h) is a break "
        "inside the shift (listed under breaks), and a move to another line is a transition. A bus's seen end is "
        "therefore its last stop before at least 3 h without serving the line, never a layover."),
    "how_the_app_uses_it": (
        "Planned (display-rules work, 2026-11-11): (1) end of service for the idle rule: past a line's usual last stop "
        "(the last bus's last_stop p90, today's listed hours equal to `listed`), a still bus of the line is very likely "
        "done for the day; (2) transition windows: a bus off its new line's route between a transition's leave and join "
        "(from the from line's end spot, under the label shown in label_on_the_way) is on its way to start service, "
        "not lost. The app must check `valid_until` and that today's listed hours equal `listed.spans`, and never show "
        "these learned times as a schedule. Whoever wires it documents the use in docs/ARCHITECTURE.md."),
    "refresh": (
        "Monthly, after a timetable change, or when valid_until passes (and after a holiday or a break, which are left "
        "out). Commands: python experiments/routeknower/E28-scripts/fetch.py --out <dl> --from 2026-10-10 --to <newest "
        "complete day>; python tools/build_service_seen.py --dl <dl> --odd data/labeled/transitions/odd_episodes.csv; "
        "python tools/test_service_seen.py. About 3 min for 32 days plus the downloads. docs/DATA.md \"Seen service "
        "windows\"."),
}


def dump(doc):
    """JSON with the explanation at the top and one line per bus / transition (readable, small)."""
    head = {k: doc[k] for k in ("about", "fields", "method", "why_seen_differs_from_listed", "layovers_vs_lasting",
                                "how_the_app_uses_it", "refresh")}
    meta = {k: doc[k] for k in ("generated", "from", "to", "days_used", "days_left_out", "collector_gaps", "valid_until",
                                "friday_vs_mon_thu")}
    c = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    parts = ["{"]
    for k, v in list(head.items()) + list(meta.items()):
        parts.append(f" {json.dumps(k)}: {json.dumps(v, ensure_ascii=False, indent=1).replace(chr(10), chr(10) + ' ')},")
    parts.append(' "lines": {')
    lk = list(doc["lines"])
    for i, rid in enumerate(lk):
        ln = doc["lines"][rid]
        parts.append(f'  {json.dumps(rid)}: {{"name": {json.dumps(ln["name"])}, "days": [')
        for j, e in enumerate(ln["days"]):
            body = {k: v for k, v in e.items() if k not in ("buses", "breaks")}
            s = "   {" + c(body)[1:-1]
            if e.get("buses"):
                s += ',\n    "buses": [\n' + ",\n".join("     " + c(b) for b in e["buses"]) + "\n    ]"
            if e.get("breaks"):
                s += ',\n    "breaks": [\n' + ",\n".join("     " + c(b) for b in e["breaks"]) + "\n    ]"
            s += "}" + ("," if j < len(ln["days"]) - 1 else "")
            parts.append(s)
        parts.append("  ]}" + ("," if i < len(lk) - 1 else ""))
    parts.append(" },")
    parts.append(' "transitions": [')
    parts.append(",\n".join("  " + c(t) for t in doc["transitions"]))
    parts.append(" ]")
    parts.append("}")
    return "\n".join(parts) + "\n"


# ---------------------------------------------------------------- main
def newest_day(dl):
    days = sorted(p.name[len("raw-polls-"):len("raw-polls-") + 10] for p in Path(dl).glob("raw-polls-*.jsonl.gz"))
    return days[-1] if days else None


def run(dl, d0, d1, out, cache, odd=None, cal_path=None, generated=None, log=print):
    cal = json.loads(Path(cal_path).read_text(encoding="utf-8")) if cal_path and Path(cal_path).exists() else {}
    arrivals = load_arrivals(Path(dl) / "arrivals.csv")
    wrong = load_wrong_labels(odd)
    facts, statics, used, left_out, gaps_by_day, names = [], {}, [], [], {}, {}
    d = date.fromisoformat(d0)
    while d <= date.fromisoformat(d1):
        day = d.isoformat()
        d += timedelta(days=1)
        reg = calendar_regime(cal, day)
        rp = Path(dl) / f"raw-polls-{day}.jsonl.gz"
        zp = zip_for(dl, day)
        if reg in LEFT_OUT_REGIMES:
            left_out.append({"day": day, "why": f"calendar: {reg}"})
            continue
        if not rp.exists() or zp is None:
            left_out.append({"day": day, "why": "no raw polls" if not rp.exists() else "no timetable"})
            continue
        st = static_for(zp, cache)
        statics[day] = st
        for rid, r in st["routes"].items():
            names.setdefault(rid, r.get("long") or r.get("short") or rid)
        reps, polls = load_reports(rp, day, st["routes"])
        f = day_facts(day, reps, arrivals, wrong, st, polls)
        facts.append(f)
        used.append(day)
        gaps_by_day[day] = f["gaps"]
        log(f"{day}: {len(f['shifts'])} shifts, {len(f['transitions'])} transitions, {len(f['breaks'])} breaks")
    doc = build(facts, statics, names, used, left_out, gaps_by_day, used[0] if used else d0, used[-1] if used else d1)
    doc["generated"] = generated or date.today().isoformat()
    doc.update(ABOUT)
    txt = dump(doc)
    json.loads(txt)   # the hand-made layout must stay valid JSON
    if out:
        Path(out).write_text(txt, encoding="utf-8", newline="\n")
        log(f"wrote {out}: {len(doc['lines'])} lines, {len(doc['transitions'])} transitions, {len(txt)} bytes")
    return doc, facts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dl", required=True, help="fetch.py folder: raw-polls-<day>.jsonl.gz, gtfs-<day>.zip, arrivals.csv")
    ap.add_argument("--from", dest="d0", default="2026-10-10")
    ap.add_argument("--to", dest="d1", help="newest service day (default: the newest raw-polls file)")
    ap.add_argument("--out", default=str(ROOT / "web" / "data" / "service_seen.json"))
    ap.add_argument("--odd", default=str(ROOT / "data" / "labeled" / "transitions" / "odd_episodes.csv"),
                    help="E30 odd_episodes.csv (its wrong_line_label arrivals are left out); '' = none")
    ap.add_argument("--calendar", default=str(ROOT / "data" / "calendar.json"))
    ap.add_argument("--cache", default=None, help="folder for the built timetables (default: <dl>/static)")
    ap.add_argument("--json", help="also write the per-day facts here (shifts, transitions, breaks) for checks")
    a = ap.parse_args(argv)
    d1 = a.d1 or newest_day(a.dl)
    cache = a.cache or str(Path(a.dl) / "static")
    log = lambda m: print(m, file=sys.stderr, flush=True)
    doc, facts = run(a.dl, a.d0, d1, a.out, cache, a.odd or None, a.calendar, log=log)
    if a.json:
        rows = [{**{k: v for k, v in s.items() if k != "breaks"}, "breaks": len(s["breaks"])}
                for f in facts for s in f["shifts"]]
        Path(a.json).write_text(json.dumps({"shifts": rows, "transitions": [
            {**t, "labels": dict(t["labels"])} for f in facts for t in f["transitions"]]}, indent=0), encoding="utf-8")


if __name__ == "__main__":
    main()

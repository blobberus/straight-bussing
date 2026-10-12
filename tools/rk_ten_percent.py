#!/usr/bin/env python3
"""The owner's "10% rule" on the data we have (2026-10-12): a prediction made L before the arrival must be within
10% of L (1 min at 10 min ahead, 3 min at 30 min ahead), and "most arrival times should be under 1% too late"
(prediction later than the actual arrival). Readings of the 1% rule reported side by side:
  A1  share of predictions later than the actual arrival at all (err > 0)
  A2  share later by more than 10% of L (err > 0.1 L): the late-side miss of the 10% band
  B   asymmetric band: pass if -0.10 L <= err <= +0.01 L ("late>1%" = err > 0.01 L)
err = predicted - actual (positive = prediction later than actual = the bus came early, a missed bus).
"+floor": tolerance max(60 s, 10% of L) on the early side (the app shows whole minutes) and max(10 s, 1% of L) on the
late side (the detector is +-10 s).

Methods (rolling origin by Chicago service day: fit on days before d, score day d):
  Passio            the stored prediction (newest made >= 120 s ahead; leads 120-299 s only, rider set as E18)
  ours              bus's last logged arrival at or before q = A - L (same vehicle, any trip id / lap), then shrunk
                    hierarchy segment run times + learned dwells (model_segments.SegmentModel via backtest.fit_all)
                    around the loop to the target (all 14 routes are loops in route_stops.json); the terminal
                    layover is the learned median dwell at the terminal; clamped to >= q
  ours+sched layover  same, but when the path ends a lap and the target row is on another trip, the bus leaves the
                    terminal no earlier than that trip's GTFS start time (block knowledge; slightly optimistic)
  schedule segments last arrival + GTFS segment seconds (segments.json), no layover (backtest's "schedule")
  timetable         GTFS stop_times arrival of the target trip at the stop (no live data; not for frequency trips)
  timetable+delay   timetable + the bus's delay at its last logged stop (its own trip's schedule there)
A target counts for lead L only if it is the bus's NEXT visit to that stop after q (a rider's query) and the bus
had a logged arrival on the same route within 25 min before q. Provisional huge-error rule: |err| > max(10 min, L).
  python tools/rk_ten_percent.py <arrivals.csv> <google_transit.zip> [tools dir] [--out report.md]
  (google_transit.zip: https://passio3.com/chicago/passioTransit/gtfs/google_transit.zip)
"""
import argparse, bisect, calendar, csv, io, math, statistics, sys, zipfile
from collections import defaultdict, Counter
from datetime import datetime, timezone
from pathlib import Path

LEADS = (120, 300, 600, 900, 1200, 1800)
MAX_KNOWN_AGE = 1500
B1_FIX = 1791620287 + 2 * 3600
K_SHIFT = 20.0


def huge(e, L):
    return abs(e) > max(600.0, L)


def metrics(pairs):
    """pairs [(err, L)] -> dict of rates."""
    n = len(pairs)
    if not n:
        return None
    m = {"n": n}
    m["sym"] = sum(abs(e) <= 0.1 * L for e, L in pairs) / n
    m["symf"] = sum(abs(e) <= max(60.0, 0.1 * L) for e, L in pairs) / n
    m["B"] = sum(-0.1 * L <= e <= 0.01 * L for e, L in pairs) / n
    m["Bf"] = sum(-max(60.0, 0.1 * L) <= e <= max(10.0, 0.01 * L) for e, L in pairs) / n
    m["late1"] = sum(e > 0.01 * L for e, L in pairs) / n
    m["A1"] = sum(e > 0 for e, L in pairs) / n
    m["A2"] = sum(e > 0.1 * L for e, L in pairs) / n
    m["mae"] = statistics.fmean(abs(e) for e, _ in pairs)
    m["med"] = statistics.median(e for e, _ in pairs)
    return m


P = lambda x: f"{100 * x:.0f}%"
HEAD = ["| method | lead | n | 10% rule | 10% + floor | band B | B + floor | late > 1% L | A1 late at all | A2 late > 10% L | MAE s | median err s |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]


def line(name, lead, m):
    if not m:
        return f"| {name} | {lead} | 0 | | | | | | | | | |"
    return (f"| {name} | {lead} | {m['n']} | **{P(m['sym'])}** | {P(m['symf'])} | **{P(m['B'])}** | {P(m['Bf'])} | "
            f"{P(m['late1'])} | {P(m['A1'])} | {P(m['A2'])} | {m['mae']:.0f} | {m['med']:+.0f} |")


def lead_name(L):
    return f"{L // 60} min"


# ---------------- GTFS timetable ----------------
class Timetable:
    def __init__(self, zpath):
        z = zipfile.ZipFile(zpath)
        rd = lambda n: list(csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig")))
        self.freq = {r["trip_id"] for r in rd("frequencies.txt")} if "frequencies.txt" in z.namelist() else set()
        raw = defaultdict(list)                         # trip -> [(seq, stop_id, arrival s or None, dist)]
        for r in rd("stop_times.txt"):
            t = r.get("arrival_time") or r.get("departure_time")
            sec = None
            if t:
                h, mi, s = (int(x) for x in t.split(":"))
                sec = h * 3600 + mi * 60 + s
            try:
                dist = float(r.get("shape_dist_traveled") or "nan")
            except ValueError:
                dist = float("nan")
            raw[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], sec, dist))
        self.st = {}
        for trip, v in raw.items():                     # non-timepoint stops have no time: interpolate by
            v.sort()                                    # shape distance (else by sequence) between timepoints
            known = [i for i, x in enumerate(v) if x[2] is not None]
            out = []
            for i, (seq, stop, sec, dist) in enumerate(v):
                if sec is None:
                    lo = max((k for k in known if k < i), default=None)
                    hi = min((k for k in known if k > i), default=None)
                    if lo is None or hi is None:
                        continue
                    a, b = v[lo], v[hi]
                    if not (math.isnan(a[3]) or math.isnan(b[3]) or math.isnan(dist)) and b[3] > a[3]:
                        f = (dist - a[3]) / (b[3] - a[3])
                    else:
                        f = (i - lo) / (hi - lo)
                    sec = a[2] + f * (b[2] - a[2])
                out.append((seq, stop, sec))
            self.st[trip] = out

    def at(self, trip, stop, idx, midnight):
        """Scheduled epoch of `trip` at `stop` (the first occurrence for idx 0, else the last), or None."""
        if trip in self.freq or trip not in self.st:
            return None
        occ = [x for x in self.st[trip] if x[1] == stop]
        if not occ:
            return None
        o = occ[0] if idx == 0 else occ[-1]
        if len(occ) > 1 and idx not in (0,):
            near = [x for x in occ if x[0] == idx + 1]
            o = near[0] if near else o
        return midnight + o[2]

    def start(self, trip, midnight):
        if trip in self.freq or trip not in self.st:
            return None
        return midnight + self.st[trip][0][2]


def local_midnight(C, day):
    y, m, d = (int(x) for x in day.split("-"))
    noon = datetime(y, m, d, 12, tzinfo=timezone.utc)
    return calendar.timegm((y, m, d, 0, 0, 0)) - C._us_central_offset_h(noon) * 3600


# ---------------- main evaluation ----------------
def evaluate(args):
    sys.path.insert(0, args.tools)
    global C
    import model_core as C
    import backtest as BT
    import json
    order = json.loads((Path(args.tools).parent / "web" / "data" / "route_stops.json").read_text(encoding="utf-8"))
    segsched = json.loads((Path(args.tools).parent / "web" / "data" / "segments.json").read_text(encoding="utf-8"))["routes"]
    tt = Timetable(args.gtfs)
    dicts = C.read_dicts(args.arrivals)
    kept, stale, nop = C.clean_dicts(dicts)
    rows = C.rows_from_dicts(dicts)
    rday = lambda r: r.trip.rsplit("|", 1)[-1]
    days = sorted({rday(r) for r in rows})

    arr = []                                            # every kept arrival
    for d in kept:
        ep = C._f(d.get("epoch"))
        if ep is None:
            continue
        arr.append({"ep": ep, "veh": str(d.get("vehicle_id")), "route": str(d.get("route_id")),
                    "rname": d.get("route_name") or str(d.get("route_id")), "stop": str(d.get("stop_id")),
                    "idx": int(C._f(d.get("stop_index"), -1)), "trip": str(d.get("trip_id")),
                    "day": str(C._service_day(d, ep)), "hour": int(C._f(d.get("hour"), 0)),
                    "dow": int(C._f(d.get("dow"), 0)), "d": d})
    byveh = defaultdict(list)
    for a in arr:
        byveh[a["veh"]].append(a)
    for v in byveh.values():
        v.sort(key=lambda a: a["ep"])
    vep = {k: [a["ep"] for a in v] for k, v in byveh.items()}

    results = []                                        # (day, method, L, err, target, info)
    excl = defaultdict(Counter)
    for d in days[1:]:
        train = [r for r in rows if rday(r) < d]
        if len(train) < 300:
            continue
        F = BT.fit_all(train)
        m = F["seg"]
        # learned terminal turn: p10 of observed dwell at each route's terminal (training rows)
        term = {rid: o[0] for rid, o in order.items()}
        turn = {}
        for rid in order:
            v = sorted(r.dwell for r in train if r.route == rid and r.prev == term[rid] and r.dwell is not None)
            turn[rid] = v[len(v) // 10] if v else 0.0
        cache = {}

        def segp(route, a, b, how):
            k = (route, a, b, how)
            if k not in cache:
                p = m.predict(route, a, b, how)
                cache[k] = (p["run"], p["dwell"])
            return cache[k]

        for t in (a for a in arr if a["day"] == d):
            route, o = t["route"], order.get(t["route"])
            if not o or t["idx"] < 0:
                continue
            N1 = len(o) - 1                              # positions 0..N1-1; index N1 == position 0 (terminal)
            tpos = t["idx"] % N1
            mid = local_midnight(C, t["day"])
            for L in LEADS:
                q = t["ep"] - L
                e = vep[t["veh"]]
                i = bisect.bisect_right(e, q) - 1
                if i < 0 or q - e[i] > MAX_KNOWN_AGE:
                    excl[L]["no logged arrival of the bus in the 25 min before q"] += 1
                    continue
                p = byveh[t["veh"]][i]
                if p["route"] != route:
                    excl[L]["bus on another route at q"] += 1
                    continue
                j = bisect.bisect_right(e, q)
                k = bisect.bisect_left(e, t["ep"])
                if any(x["stop"] == t["stop"] and x["idx"] % N1 == tpos for x in byveh[t["veh"]][j:k]):
                    excl[L]["not the bus's next visit to the stop"] += 1
                    continue
                ppos = p["idx"] % N1
                path = []
                x = ppos
                while True:
                    path.append(x)
                    x = (x + 1) % N1
                    if x == tpos:
                        break
                    if len(path) > N1:
                        break
                crosses = 0 in path                      # the bus leaves the terminal on the way (layover inside)
                tc, tc2, schs = p["ep"], p["ep"], p["ep"]
                sseg = (segsched.get(route) or {}).get("seg") or []
                sdw = float((segsched.get(route) or {}).get("dwell") or 0)
                start_T = tt.start(t["trip"], mid)
                ok_s = True
                for h, s in enumerate(path):
                    a_, b_ = o[s], o[s + 1]
                    run, dw = segp(route, a_, b_, C.how_of_epoch(tc))
                    tc += run + dw                       # ours: dw at o[s]; at the terminal = learned layover
                    if s == 0 and start_T is not None and abs(start_T - tc2) < 3600:
                        tc2 = max(tc2 + turn.get(route, 0.0), start_T) + run   # wait for the target trip's start
                    else:
                        tc2 += run + dw
                    if s < len(sseg) and isinstance(sseg[s], (int, float)):
                        schs += float(sseg[s]) + sdw
                    else:
                        ok_s = False
                info = {"crosses": crosses, "route": t["rname"], "stop": (route, t["stop"]), "hour": t["hour"],
                        "dow": t["dow"], "age": q - p["ep"], "nseg": len(path), "terminal_target": tpos == 0}
                preds = {"ours": max(q, tc), "ours+sched layover": max(q, tc2)}
                if ok_s:
                    preds["schedule segments"] = max(q, schs)
                sT = tt.at(t["trip"], t["stop"], t["idx"], mid)
                if sT is not None:
                    preds["timetable"] = sT
                    sp = tt.at(p["trip"], p["stop"], p["idx"], local_midnight(C, p["day"]))
                    if sp is not None and abs(p["ep"] - sp) < 3600:
                        preds["timetable+delay"] = max(q, sT + (p["ep"] - sp))
                for name, v in preds.items():
                    results.append((d, name, L, v - t["ep"], info))
    return results, excl, days, C


def passio_rows(C, path):
    dicts = C.read_dicts(path)
    kept, _s, nop = C.clean_dicts(dicts)
    out = []
    for d in kept:
        ep, pe, lead = C._f(d.get("epoch")), C._f(d.get("passio_pred_epoch")), C._f(d.get("passio_pred_lead_s"))
        if ep is None or pe is None or lead is None:
            continue
        out.append({"err": pe - ep, "L": lead, "rider": (120 <= lead < 300) and (id(d) not in nop or ep >= B1_FIX),
                    "route": d.get("route_name"), "day": str(C._service_day(d, ep)), "clean": id(d) not in nop})
    return out


def quantile(v, p):
    v = sorted(v)
    i = p * (len(v) - 1)
    lo = int(i)
    return v[lo] + (v[min(lo + 1, len(v) - 1)] - v[lo]) * (i - lo)


def shifted(items, p, keyf, lf):
    """Rolling safety shift: for day d, subtract the shrunk p-quantile of err for its key from earlier days' errors.
    items [(day, err, L, info)] -> [(err', L)] on days that have history."""
    days = sorted({it[0] for it in items})
    out = []
    for d in days[1:]:
        tr = [it for it in items if it[0] < d and not huge(it[1], it[2])]
        te = [it for it in items if it[0] == d]
        if not tr or not te:
            continue
        byk, byl = defaultdict(list), defaultdict(list)
        for it in tr:
            byk[keyf(it)].append(it[1]); byl[lf(it)].append(it[1])
        gl = {k: quantile(v, p) for k, v in byl.items()}
        sh = {k: (len(v) * quantile(v, p) + K_SHIFT * gl.get(k[1], 0.0)) / (len(v) + K_SHIFT) for k, v in byk.items()}
        for it in te:
            s = sh.get(keyf(it), gl.get(lf(it), 0.0))
            out.append((it[1] - s, it[2]))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("arrivals"); ap.add_argument("gtfs")
    ap.add_argument("tools", nargs="?", default=str(Path(__file__).resolve().parent))
    ap.add_argument("--out")
    args = ap.parse_args(argv)
    results, excl, days, C = evaluate(args)
    md = ["# The 10% rule on the data we have (2026-10-12)", "",
          f"Data: `{Path(args.arrivals).name}`, service days {', '.join(days)}; rolling origin by service day "
          f"(test days {', '.join(days[1:])}). err = predicted - actual: positive = the prediction was later than the "
          "bus (the bus came early, a rider could miss it). Columns: **10% rule** |err| <= 0.1 L; **+ floor** "
          "|err| <= max(60 s, 0.1 L); **band B** -0.1 L <= err <= +0.01 L; **B + floor** -max(60 s, 0.1 L) <= err <= "
          "max(10 s, 0.01 L); **late > 1% L** = fails B on the late side; **A1** err > 0; **A2** err > 0.1 L.", "",
          "Methods: **Passio** = the one stored prediction per arrival (newest made >= 120 s ahead; only leads 120-299 s "
          "can be scored). **ours** = the bus's last logged arrival at or before q = A - L (same vehicle, across trip ids "
          "and laps), plus the shrunk-hierarchy segment run times and learned dwells around the loop (all 14 routes are "
          "loops in route_stops.json) to the target, clamped to >= q; the terminal layover is the learned median dwell at "
          "the terminal (training days only). **ours+sched layover** = the same, but the bus leaves the terminal no earlier "
          "than the GTFS start time of the trip the target row is on (block knowledge; slightly optimistic). **schedule "
          "segments** = last arrival + GTFS segment seconds (segments.json), no layover. **timetable** = GTFS stop_times "
          "time of the target's trip at the stop (non-timepoint stops interpolated by shape distance); **timetable+delay** "
          "= timetable + the bus's delay at its last logged stop. A target counts for lead L only if it is the bus's next "
          "visit to that stop after q and the bus had a logged arrival on the same route within 25 min before q. Model fit "
          "on earlier service days only. Provisional huge-error rule: |err| > max(10 min, L).", ""]

    # ---- Passio ----
    pr = passio_rows(C, args.arrivals)
    rider = [r for r in pr if r["rider"]]
    md += ["## 1. Passio (the ETA riders see), stored lead 2-5 min", "",
           "Its tolerance uses each row's own lead (120-299 s, so 10% = 12-30 s).", ""] + HEAD
    md.append(line("Passio, every stored prediction (any lead, untrusted included)", "stored",
                   metrics([(r["err"], r["L"]) for r in pr])))
    md.append(line("Passio, rider set (E18: clean or post-fix, lead 120-299 s)", "2-5 min",
                   metrics([(r["err"], r["L"]) for r in rider])))
    rk = [r for r in rider if not huge(r["err"], r["L"])]
    md.append(line("Passio, rider set without huge errors", "2-5 min", metrics([(r["err"], r["L"]) for r in rk])))
    for lo, hi in ((120, 150), (150, 180), (180, 300)):
        md.append(line("Passio, rider set without huge errors", f"{lo}-{hi - 1} s",
                       metrics([(r["err"], r["L"]) for r in rk if lo <= r["L"] < hi])))
    md += ["", f"Huge errors in the rider set: {len(rider) - len(rk)} of {len(rider)} "
               f"({(len(rider) - len(rk)) / max(1, len(rider)):.1%}). Untrusted or lead >= 300 s rows (E01 rules) are "
               f"{len(pr) - len(rider)} of {len(pr)} stored predictions.", ""]

    # ---- ours / schedule by lead ----
    methods = ["ours", "ours+sched layover", "schedule segments", "timetable", "timetable+delay"]
    for title, filt in (("all rows", lambda e, L: True), ("without huge errors (|err| > max(10 min, L))", lambda e, L: not huge(e, L))):
        md += ["", f"## 2. Ours and the schedule by lead, {title}", ""] + HEAD
        for L in LEADS:
            for mth in methods:
                v = [(e, LL) for d, n, LL, e, info in results if n == mth and LL == L and filt(e, LL)]
                md.append(line(mth, lead_name(L), metrics(v)))
    md += ["", "### Huge errors excluded (share of that method's rows at that lead)", "",
           "| lead | " + " | ".join(methods) + " |", "|---|" + "---:|" * len(methods)]
    for L in LEADS:
        cells = []
        for mth in methods:
            v = [e for d, n, LL, e, info in results if n == mth and LL == L]
            h = sum(huge(e, L) for e in v)
            cells.append(f"{h} ({h / max(1, len(v)):.1%})")
        md.append(f"| {lead_name(L)} | " + " | ".join(cells) + " |")
    md += ["", "### Targets not scored (no live basis for a prediction at that lead)", "",
           "| lead | scored (ours) | " + " | ".join(sorted({k for c in excl.values() for k in c})) + " |",
           "|---|---:|" + "---:|" * len({k for c in excl.values() for k in c})]
    keys = sorted({k for c in excl.values() for k in c})
    for L in LEADS:
        n = sum(1 for d, nm, LL, e, i in results if nm == "ours" and LL == L)
        md.append(f"| {lead_name(L)} | {n} | " + " | ".join(str(excl[L][k]) for k in keys) + " |")

    # ---- by route at 10 and 30 min ----
    for L in (600, 1800):
        md += ["", f"## 3. By route at {lead_name(L)} (without huge errors)", "",
               "| route | method | n | 10% rule | band B | late > 1% L | A1 | MAE s | median err s |",
               "|---|---|---:|---:|---:|---:|---:|---:|---:|"]
        routes = Counter(info["route"] for d, n, LL, e, info in results if n == "ours" and LL == L)
        for rt, _ in routes.most_common():
            for mth in ("ours", "ours+sched layover", "timetable+delay"):
                v = [(e, LL) for d, n, LL, e, info in results if n == mth and LL == L and info["route"] == rt and not huge(e, LL)]
                mm = metrics(v)
                if mm and mm["n"] >= 20:
                    md.append(f"| {rt} | {mth} | {mm['n']} | {P(mm['sym'])} | {P(mm['B'])} | {P(mm['late1'])} | "
                              f"{P(mm['A1'])} | {mm['mae']:.0f} | {mm['med']:+.0f} |")

    # ---- error sources at long leads ----
    md += ["", "## 4. Where the long-lead error comes from (ours, without huge errors)", "",
           "| lead | slice | n | 10% rule | median err s | MAE s |", "|---|---|---:|---:|---:|---:|"]
    for L in (600, 1200, 1800):
        base = [(e, info) for d, n, LL, e, info in results if n == "ours" and LL == L and not huge(e, L)]
        for name, f in (("path crosses the terminal (layover inside)", lambda i: i["crosses"]),
                        ("no terminal on the path", lambda i: not i["crosses"]),
                        ("target is the terminal", lambda i: i["terminal_target"]),
                        ("bus's last logged stop < 2 min before q", lambda i: i["age"] < 120),
                        ("last logged stop 5-25 min before q", lambda i: i["age"] >= 300),
                        ("weekday 6-10 AM", lambda i: i["dow"] < 5 and 6 <= i["hour"] < 10),
                        ("weekday 4-8 PM", lambda i: i["dow"] < 5 and 16 <= i["hour"] < 20),
                        ("night 8 PM-5 AM", lambda i: i["hour"] >= 20 or i["hour"] < 5),
                        ("weekend", lambda i: i["dow"] >= 5)):
            v = [(e, L) for e, i in base if f(i)]
            mm = metrics(v)
            if mm:
                md.append(f"| {lead_name(L)} | {name} | {mm['n']} | {P(mm['sym'])} | {mm['med']:+.0f} | {mm['mae']:.0f} |")
    md += ["", "### Huge errors of ours at 10-30 min, by slice", "", "| lead | slice | huge | of | share | median huge err s |",
           "|---|---|---:|---:|---:|---:|"]
    for L in (600, 1800):
        allv = [(e, info) for d, n, LL, e, info in results if n == "ours" and LL == L]
        for name, f in (("crosses the terminal", lambda i: i["crosses"]), ("no terminal", lambda i: not i["crosses"]),
                        ("night 8 PM-5 AM", lambda i: i["hour"] >= 20 or i["hour"] < 5)):
            v = [e for e, i in allv if f(i)]
            h = [e for e in v if huge(e, L)]
            if v:
                md.append(f"| {lead_name(L)} | {name} | {len(h)} | {len(v)} | {len(h) / len(v):.1%} | "
                          f"{statistics.median(h):+.0f} |" if h else f"| {lead_name(L)} | {name} | 0 | {len(v)} | 0% | |")

    # ---- safety shift ----
    md += ["", "## 5. Safety shift: subtract a high quantile of past errors (fewer late predictions), rolling", "",
           "Shift per (route, lead) from earlier test days (huge errors left out of the fit), shrunk toward the lead's "
           "(k = 20); scored on later test days. Passio: per route, fitted on all earlier days.", "",
           "| method | lead | shift quantile | n | 10% rule | 10% + floor | band B | B + floor | late > 1% L | A1 | A2 | MAE s |",
           "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    pit = [(r["day"], r["err"], r["L"], {"route": r["route"]}) for r in rk]
    for pq in (None, 0.5, 0.75, 0.9, 0.95, 0.99):
        if pq is None:
            ds = sorted({x[0] for x in pit})[1:]
            v = [(e, L) for d, e, L, i in pit if d in ds]
        else:
            v = shifted(pit, pq, lambda it: (it[3]["route"], "p"), lambda it: "p")
        mm = metrics(v)
        if not mm:
            continue
        md.append(f"| Passio | 2-5 min | {pq if pq is not None else 'none'} | {mm['n']} | {P(mm['sym'])} | {P(mm['symf'])} | "
                  f"{P(mm['B'])} | {P(mm['Bf'])} | {P(mm['late1'])} | {P(mm['A1'])} | {P(mm['A2'])} | {mm['mae']:.0f} |")
    for L in (300, 600, 1800):
        it = [(d, e, LL, info) for d, n, LL, e, info in results if n == "ours" and LL == L and not huge(e, LL)]
        for pq in (None, 0.5, 0.75, 0.9, 0.95, 0.99):
            if pq is None:
                ds = sorted({x[0] for x in it})[1:]
                v = [(e, LL) for d, e, LL, i in it if d in ds]
            else:
                v = shifted(it, pq, lambda x: (x[3]["route"], x[2]), lambda x: x[2])
            mm = metrics(v)
            if mm:
                md.append(f"| ours | {lead_name(L)} | {pq if pq is not None else 'none'} | {mm['n']} | {P(mm['sym'])} | "
                          f"{P(mm['symf'])} | {P(mm['B'])} | {P(mm['Bf'])} | {P(mm['late1'])} | {P(mm['A1'])} | "
                          f"{P(mm['A2'])} | {mm['mae']:.0f} |")
    # ---- timetable fit per route ----
    md += ["", "## 6. Does a bus's trip id match the run it is driving? (timetable error per route, 2-min targets)", "",
           "If the live trip id named the scheduled run, the timetable error would be small and centred. On most routes it "
           "is not: errors cluster at -10 to -20 min (about one headway), so the bus carries the id of an earlier "
           "scheduled run. That makes 'timetable' useless as a baseline there and is one source of huge errors.", "",
           "| route | n | median err s | share > 10 min off |", "|---|---:|---:|---:|"]
    tv = defaultdict(list)
    for d, n, L, e, info in results:
        if n == "timetable" and L == 120:
            tv[info["route"]].append(e)
    for rt, v in sorted(tv.items(), key=lambda kv: -len(kv[1])):
        md.append(f"| {rt} | {len(v)} | {statistics.median(v):+.0f} | {sum(abs(e) > 600 for e in v) / len(v):.0%} |")
    text = "\n".join(md) + "\n"
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Hidden buses that Passio still had times for (owner, 2026-11-11, on E32: "Keep hidden bus times off until it reports
again. If passio is still reporting them, add them to a hidden bus file in the data (explain in the file what this file
is)."). Reads E32's replay of the app's display rules (replay.py results + inputs.py work folder) and writes
data/labeled/hidden_buses/hidden_buses.csv: one row per EPISODE, a stretch of minutes in which one rule kept a bus (or
its times) off the screen while Passio's tripUpdates still had times for it. The explanation is in the file itself
(`#` lines at the top) and in the README beside it.

Rules (what the replayed app did at each whole minute, data/live.js order):
  off_route      core/offroute.js hid the bus (250 m from its line for 45 s): bus and times dropped
  idle           core/idle.js hid it (`idle_reason`: idle / parked / past / linger): bus and times dropped
  gone           core/transition.js GONE (silent 15 min while the feed is alive): its times dropped
  not_operating  after an off_route / idle hide (within 15 min) the bus stopped reporting, so core/operating.js no
                 longer lists it (5 min stale) and the two rules no longer see it: in the SHIPPED app its Passio times
                 come back until GONE (E32 "times back after a hide"); under the owner's 2026-11-11 rule they stay off
                 until the bus reports again (`times_shown_by_app` says which the replayed code did)
  held           core/transition.js heldStep (the owner's rule, live since 2026-11-11): a bus a rule hid that then stopped
                 reporting keeps its times off until it reports again (replay.html poll field 8, `held`)
  transitioning  core/seen.js (2026-11-11): an off-route bus on its way to a new line stays on the map, marked
                 "Transitioning to new line" (replay.html poll field 9), but with TRANSITION_TIMES false (the replay's
                 `transTimes`) its Passio times are dropped: listed only then (badge shown, times kept off)
An episode joins the minutes of one (bus, line, rule) no more than 2 min apart; only episodes with at least one minute
of Passio times 0 to 60 min ahead are written. What the bus did = the data branch's arrivals.csv.

  python experiments/routeknower/E32-scripts/hidden_buses.py --work <inputs.py work> --results <replay.py results>
      --arrivals arrivals.csv [--from 2026-10-10] [--to 2026-11-10] [--out data/labeled/hidden_buses/hidden_buses.csv]
      [--rules shipped|<label>] [--json summary.json]
"""
import argparse, bisect, csv, io, json, math, sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

CT = ZoneInfo("America/Chicago")
REPO = Path(__file__).resolve().parents[3]
AHEAD_S = 3600          # Passio times up to this far ahead count
MERGE_S = 120           # minutes of one (bus, line, rule) at most this far apart are one episode
RESHOWN_S = 900         # not_operating: within this of the last off_route / idle hide (measure.py reshown_time_min)
SERVE_S = 900           # came to serve: an arrival on its line from the hide's start to 15 min after its end
TRUE_EARLY_S, TRUE_LATE_S = 60, 900    # a hidden time came true: the bus logged that stop 1 min before to 15 min after
NEXT_LOOK_S = 3 * 3600
SPARSE_S = 120          # core/transition.js SPARSE_S (a bus whose median report gap is longer reports too rarely)
PRIORITY = ("off_route", "idle", "gone", "held", "transitioning", "not_operating")

COLUMNS = ["day", "route_id", "route", "vehicle", "rule", "idle_reason", "hidden_from", "hidden_to", "hidden_min",
           "passio_times_min", "stops_with_times", "nearest_time_ahead_min", "first_time_ahead_min",
           "first_times", "first_times_came_true", "times_shown_by_app", "reports_while_hidden", "next_report_min",
           "next_arrival_on_line_min", "came_to_serve_15", "then", "sparse_reporter", "lat", "lon", "near_stop",
           "near_stop_m", "rules", "evidence"]
DOCS = {
    "day": "service day (04:00 to 04:00 Chicago time)",
    "route_id, route": "the line the bus was labeled with (GTFS route_id) and its name",
    "vehicle": "Passio's bus number",
    "rule": "off_route / idle / gone / held / transitioning / not_operating (see RULES above)",
    "idle_reason": "for idle: idle (still 30 min, no time 2 min ahead), parked (still 90 min), past (past the listed "
                   "hours + 60 min), linger (a learned end-of-shift spot, web/data/idle.json)",
    "hidden_from, hidden_to": "first and last whole minute of the episode (Chicago, HH:MM)",
    "hidden_min": "minutes in the episode",
    "passio_times_min": "minutes of it in which Passio still had a time 0 to 60 min ahead for the bus",
    "stops_with_times": "distinct stops Passio had a time for during the episode",
    "nearest_time_ahead_min": "the soonest of those times, in minutes ahead, over the episode",
    "first_time_ahead_min": "the soonest time at the episode's first minute with times",
    "first_times, first_times_came_true": "times Passio had at that first minute, and how many came true (the bus "
                                          "logged that stop from 1 min before to 15 min after the time)",
    "times_shown_by_app": "y = the replayed app still showed those times (not_operating: no rule held them), n = kept off",
    "reports_while_hidden": "fresh position reports the bus sent during the episode (Passio still reporting the bus)",
    "next_report_min": "minutes from the episode's end to its next fresh report (blank: none that day)",
    "next_arrival_on_line_min": "minutes from the episode's start to its next logged arrival on the line (within 3 h)",
    "came_to_serve_15": "y = it logged an arrival on its line from the episode's start to 15 min after its end "
                        "(hiding it hid a bus about to serve); n = it did not",
    "then": "what the bus was next: shown, another rule, silent (not listed, no rule), end_of_day",
    "sparse_reporter": "y = it reported too rarely to judge (median gap over 120 s within 30 min, e.g. 12647)",
    "lat, lon, near_stop, near_stop_m": "where it was at the episode's start and the nearest stop of its line",
    "rules": "the replayed rule set (shipped = the display rules live since 2026-11-06, replayed on every day)",
    "evidence": "the facts in words",
}


def ct(t, fmt="%H:%M"):
    return datetime.fromtimestamp(t, CT).strftime(fmt)


def day_bounds(day):
    d = date.fromisoformat(day)
    n = d + timedelta(days=1)
    return (int(datetime(d.year, d.month, d.day, 4, tzinfo=CT).timestamp()),
            int(datetime(n.year, n.month, n.day, 4, tzinfo=CT).timestamp()))


def days_between(a, b):
    d, e, out = date.fromisoformat(a), date.fromisoformat(b), []
    while d <= e:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def hav(a, b, c, d):
    kx = 111320 * math.cos(math.radians((a + c) / 2))
    return math.hypot((d - b) * kx, (c - a) * 110540)


class Arrivals:
    def __init__(self, path):
        self.vr, self.vs = defaultdict(list), defaultdict(list)
        with open(path, encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                try:
                    e = int(r["epoch"])
                except (KeyError, ValueError):
                    continue
                self.vr[(r["vehicle_id"], r["route_id"])].append(e)
                self.vs[(r["vehicle_id"], r["stop_id"])].append(e)
        for d in (self.vr, self.vs):
            for v in d.values():
                v.sort()

    def next_vr(self, v, rid, a, b):
        x = self.vr.get((v, rid)) or []
        i = bisect.bisect_left(x, a)
        return x[i] if i < len(x) and x[i] <= b else None

    def any_vs(self, v, stop, a, b):
        x = self.vs.get((v, stop)) or []
        i = bisect.bisect_left(x, a)
        return i < len(x) and x[i] <= b


def poll_field(p, i, default=None):
    return p[i] if len(p) > i and p[i] is not None else default


def day_episodes(day, inp, res, A, stops, rstops, names, label):
    """The episodes of one replayed day (rows in COLUMNS order, as dicts)."""
    snaps = inp["snaps"]
    ipolls = {p[0]: p for p in inp["polls"]}
    rep_t, rep_pos = defaultdict(set), defaultdict(dict)
    for p in inp["polls"]:
        for v in p[1]:
            rep_t[v[0]].add(int(v[7]))
            rep_pos[v[0]][int(v[7])] = (v[3], v[4])
    rep = {k: sorted(x) for k, x in rep_t.items()}
    t0, t1 = day_bounds(day)

    def pos_at(v, t):
        x = rep.get(v) or []
        i = bisect.bisect_right(x, t) - 1
        return rep_pos[v][x[i]] if i >= 0 else None

    def reports_in(v, a, b):
        x = rep.get(v) or []
        return bisect.bisect_right(x, b) - bisect.bisect_left(x, a)

    def next_report(v, t):
        x = rep.get(v) or []
        i = bisect.bisect_right(x, t)
        return x[i] if i < len(x) else None

    def sparse(v, t):
        x = rep.get(v) or []
        w = x[bisect.bisect_left(x, t - 1800):bisect.bisect_right(x, t + 1800)]
        g = sorted(b - a for a, b in zip(w, w[1:]))
        return len(w) >= 2 and g[len(g) // 2] > SPARSE_S

    last_hid, marks = {}, Counter()
    trans_times = res.get("transTimes", True) is not False
    state = {}                      # minute -> {veh: (rule, rid, why)}
    times = {}                      # minute -> {veh: [(stop, p)]}
    shown = {}                      # minute -> set of veh shown on the map
    minutes = []
    for rp in res["polls"]:
        h, op, off, idle, gone = rp[0], rp[1], rp[2], rp[3], rp[4]
        held = set(poll_field(rp, 8, []) or [])        # replay.html since cc0ef86c: [.., oldNums, held, marked]
        marked = set(poll_field(rp, 9, []) or [])      # off-route buses kept on screen as transitioning (core/seen.js)
        if trans_times:
            marked_hidden = set()                      # their times stay on screen: not a hide
        else:
            marked_hidden = marked
        offs, idles, gones = set(off), {v: w for v, w in idle}, set(gone)
        oprid = {v: r for v, r in op}
        for v in offs | set(idles):
            last_hid[v] = h
        if h % 60:
            continue
        ip = ipolls.get(h)
        if ip is None:
            continue
        minutes.append(h)
        tm, srid = defaultdict(list), {}
        for i in ip[2]:
            veh, trip, rid, st = snaps[i]
            for s, p in st:
                if h <= p <= h + AHEAD_S:
                    tm[veh].append((s, p))
            if rid:
                srid.setdefault(veh, rid)
        times[h] = tm
        shown[h] = {v for v in oprid if v not in offs and v not in idles}
        for v in marked:
            marks["_marked_min"] += 1
            marks["_marked_times_min"] += bool(tm.get(v))
        st = {}
        for v in set(oprid) | set(srid) | gones | held | marked_hidden:
            rid = oprid.get(v) or srid.get(v)
            if not rid:
                continue
            if v in offs:
                st[v] = ("off_route", rid, "")
            elif v in idles:
                st[v] = ("idle", rid, idles[v] or "")
            elif v in gones:
                st[v] = ("gone", rid, "")
            elif v in held:
                st[v] = ("held", rid, "")
            elif v in marked_hidden:
                st[v] = ("transitioning", rid, "")
            elif v not in oprid and h - last_hid.get(v, -10 ** 9) <= RESHOWN_S:
                st[v] = ("not_operating", rid, "")
        state[h] = st
    # episodes per (vehicle, line, rule)
    runs, out, no_times = {}, [], Counter()

    def close(r):
        if not r["times_min"]:
            no_times[r["rule"]] += 1
            return
        v, rid, rule = r["v"], r["rid"], r["rule"]
        a, b = r["start"], r["last"]
        nx = A.next_vr(v, rid, a, a + NEXT_LOOK_S)
        nr = next_report(v, b)
        # what came next for the bus
        k = bisect.bisect_right(minutes, b)
        then = "end_of_day"
        if k < len(minutes):
            h2 = minutes[k]
            s2 = state[h2].get(v)
            then = s2[0] if s2 else ("shown" if v in shown[h2] else "silent")
        q = pos_at(v, a)
        near = ("", "")
        if q:
            best = min(((hav(q[0], q[1], stops[s]["lat"], stops[s]["lon"]), s) for s in set(rstops.get(rid) or [])
                        if s in stops), default=None)
            if best:
                near = (stops[best[1]].get("name", best[1]), round(best[0]))
        ft = r["first_times"]
        true_n = sum(1 for s, p in ft if A.any_vs(v, s, p - TRUE_EARLY_S, p + TRUE_LATE_S))
        served = nx is not None and nx <= b + SERVE_S
        shown_by_app = "y" if rule == "not_operating" else "n"     # no rule holds them: the replayed app showed them
        ev = (f"{names.get(rid, rid)} bus {v} {rule}{' (' + r['why'] + ')' if r['why'] else ''} {ct(a)}-{ct(b)}: Passio "
              f"had times {r['times_min']} of {r['n']} min at {len(r['stops'])} stops (soonest {r['near']:.0f} min "
              f"ahead); {len(ft)} times at the first minute, {true_n} came true; "
              + (f"it served the line {round((nx - a) / 60)} min after the hide began" if nx is not None
                 else "no arrival on the line within 3 h"))
        out.append({"day": day, "route_id": rid, "route": names.get(rid, rid), "vehicle": v, "rule": rule,
                    "idle_reason": r["why"], "hidden_from": ct(a), "hidden_to": ct(b), "hidden_min": r["n"],
                    "passio_times_min": r["times_min"], "stops_with_times": len(r["stops"]),
                    "nearest_time_ahead_min": round(r["near"], 1), "first_time_ahead_min": round(r["first_ahead"], 1),
                    "first_times": len(ft), "first_times_came_true": true_n, "times_shown_by_app": shown_by_app,
                    "reports_while_hidden": reports_in(v, a, b + 59),
                    "next_report_min": "" if nr is None else round((nr - b) / 60, 1),
                    "next_arrival_on_line_min": "" if nx is None else round((nx - a) / 60, 1),
                    "came_to_serve_15": "y" if served else "n", "then": then,
                    "sparse_reporter": "y" if sparse(v, a) else "n",
                    "lat": round(q[0], 5) if q else "", "lon": round(q[1], 5) if q else "",
                    "near_stop": near[0], "near_stop_m": near[1], "rules": label, "evidence": ev,
                    "_start": a})

    for h in minutes:
        for v, (rule, rid, why) in state[h].items():
            key = (v, rid, rule)
            tl = times[h].get(v) or []
            r = runs.get(key)
            if r is None or h - r["last"] > MERGE_S:
                if r is not None:
                    close(r)
                r = runs[key] = {"v": v, "rid": rid, "rule": rule, "why": why, "start": h, "last": h, "n": 0,
                                 "times_min": 0, "stops": set(), "near": math.inf, "first_times": [],
                                 "first_ahead": math.nan}
            r["last"] = h
            r["n"] += 1
            if why and not r["why"]:
                r["why"] = why
            if tl:
                if not r["times_min"]:
                    r["first_times"] = sorted(set(tl), key=lambda x: x[1])
                    r["first_ahead"] = min(p - h for _, p in tl) / 60
                r["times_min"] += 1
                r["stops"].update(s for s, _ in tl)
                r["near"] = min(r["near"], min(p - h for _, p in tl) / 60)
    for r in runs.values():
        close(r)
    out.sort(key=lambda e: (e["_start"], e["vehicle"], e["rule"]))
    no_times.update(marks)
    return out, no_times


def header(rows, d0, d1, label, n_days, totals):
    by_rule = Counter(r["rule"] for r in rows)
    served = Counter(r["rule"] for r in rows if r["came_to_serve_15"] == "y")
    lines = [
        "Hidden buses that Passio still had times for (Straight Bussing, data/labeled/hidden_buses/hidden_buses.csv).",
        "WHAT: one row per EPISODE in which the app's display rules kept a bus, or its times, off the screen while",
        "Passio's public tripUpdates feed still published arrival times for it (0 to 60 min ahead). Owner 2026-11-11:",
        "\"Keep hidden bus times off until it reports again. If passio is still reporting them, add them to a hidden bus",
        "file in the data (explain in the file what this file is).\"",
        "WHY: Passio keeps predicting buses that have left their line (E29: 611 of 774 lasting leaves) and the app hides",
        "them on purpose; this file keeps every such case so the hides can be checked (did the bus come to serve after",
        "all? did Passio's times come true?) and so other agents and models know which Passio times the app did not show.",
        "HOW: RouteKnower E32 replays every archived day through the app's own code (experiments/routeknower/E32-scripts:",
        "inputs.py rebuilds the feeds on a 10 s grid, replay.py runs web/js/data/live.js in headless Edge); this file is",
        "made by hidden_buses.py from that replay, read at each whole minute, and the collector's arrivals.csv.",
        "RULES: off_route = core/offroute.js (250 m from its line for 45 s); idle = core/idle.js (idle_reason idle /",
        "parked / past / linger); gone = core/transition.js GONE (silent 15 min while the feed is alive, its times",
        "dropped); not_operating = after an off_route / idle hide the bus stopped reporting and left the operating list",
        "(5 min stale), so in the shipped code its Passio times came back until GONE (E32 'times back after a hide');",
        "held = core/transition.js heldStep (the owner's rule, live since 2026-11-11): the times of a bus a rule hid that",
        "then stopped reporting stay off until it reports again (in the replays of code from before it: none);",
        "transitioning = core/seen.js: an off-route bus on its way to a new line stays on the map, marked 'Transitioning",
        "to new line', but its Passio times are dropped (TRANSITION_TIMES false; not listed when a replay keeps them).",
        f"DATA: service days {d0} to {d1} ({n_days} replayed) with the rule set '{label}' (the web/js the replay ran:",
        "shipped = the rules live 2026-11-06 to 11-11; main@<commit> = main at that commit), applied to every day: what",
        "those rules WOULD have hidden. Buses marked as transitioning: "
        f"{totals.get('_marked_min', 0)} bus-minutes, {totals.get('_marked_times_min', 0)} of them with Passio times.",
        "Episodes join the minutes of one (bus, line, rule) at most 2 min apart; only those with Passio times are listed.",
        "COLUMNS:", *(f"  {k}: {v}" for k, v in DOCS.items()),
        "TOTALS: " + ", ".join(f"{k} {by_rule[k]} episodes ({served[k]} came to serve within 15 min)"
                               for k in PRIORITY if by_rule[k]) + f"; hidden episodes without Passio times (not listed): "
        + ", ".join(f"{k} {totals.get(k, 0)}" for k in PRIORITY if totals.get(k)) + "; Passio bus-minutes of times "
        "per rule: " + ", ".join(f"{k} {sum(int(r['passio_times_min']) for r in rows if r['rule'] == k)}"
                                 for k in PRIORITY if by_rule[k]),
        "REFRESH: weekly by the data repo's findings.yml when its replay step runs (findings/hidden_buses/), else by hand:",
        "  python experiments/routeknower/E32-scripts/inputs.py --dl <fetch.py dir> --alerts <dl>/alerts.csv --days ... --out <work>",
        "  python experiments/routeknower/E32-scripts/replay.py --work <work> --results <results> --days ... --plan 0",
        "  python experiments/routeknower/E32-scripts/hidden_buses.py --work <work> --results <results> --arrivals <dl>/arrivals.csv",
        "Readers: skip lines starting with '#' (pandas: comment='#'; Python csv: filter them out). README.md beside it.",
    ]
    return "".join("# " + ln + "\n" for ln in lines)


def read_rows(path):
    """The CSV rows of a hidden_buses.csv (comment lines skipped)."""
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(ln for ln in f if not ln.startswith("#")))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", required=True)
    ap.add_argument("--results", required=True)
    ap.add_argument("--arrivals", required=True)
    ap.add_argument("--from", dest="d0", default="2026-10-10")
    ap.add_argument("--to", dest="d1")
    ap.add_argument("--out", default=str(REPO / "data" / "labeled" / "hidden_buses" / "hidden_buses.csv"))
    ap.add_argument("--rules", default="shipped", help="label of the replayed rule set (shipped = the code live then)")
    ap.add_argument("--json", help="also write per line and rule counts here")
    a = ap.parse_args(argv)
    res_days = sorted(p.stem for p in Path(a.results).glob("*.json"))
    d1 = a.d1 or (res_days[-1] if res_days else a.d0)
    A = Arrivals(a.arrivals)
    rows, totals, used = [], Counter(), []
    for day in days_between(a.d0, d1):
        ip, rp = Path(a.work) / f"{day}.json", Path(a.results) / f"{day}.json"
        if not (ip.exists() and rp.exists()):
            print(f"{day}: no replay, skipped", file=sys.stderr)
            continue
        inp = json.loads(ip.read_text(encoding="utf-8"))
        res = json.loads(rp.read_text(encoding="utf-8"))
        sd = Path(a.work) / inp["static"]
        load = lambda n: json.loads((sd / n).read_text(encoding="utf-8"))
        routes = load("routes.json")
        names = {rid: (r.get("long") or r.get("short") or rid) for rid, r in routes.items()}
        rows_d, nt = day_episodes(day, inp, res, A, load("stops.json"), load("route_stops.json"), names, a.rules)
        rows += rows_d
        totals.update(nt)
        used.append(day)
        print(f"{day}: {len(rows_d)} episodes", file=sys.stderr, flush=True)
    for r in rows:
        r.pop("_start", None)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLUMNS, lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    txt = header(rows, used[0] if used else a.d0, used[-1] if used else d1, a.rules, len(used), totals) + buf.getvalue()
    out.write_text(txt, encoding="utf-8", newline="\n")
    print(f"wrote {out}: {len(rows)} episodes", file=sys.stderr)
    if a.json:
        per = defaultdict(Counter)
        for r in rows:
            per[r["route"]][r["rule"]] += 1
            per[r["route"]][r["rule"] + "_served"] += r["came_to_serve_15"] == "y"
            per[r["route"]][r["rule"] + "_times_min"] += int(r["passio_times_min"])
        Path(a.json).write_text(json.dumps({"days": used, "per_line": per}, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()

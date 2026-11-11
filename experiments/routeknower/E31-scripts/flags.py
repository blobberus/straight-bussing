#!/usr/bin/env python3
"""E31: the prediction-miss FLAGS, one row per (line, flag), in the shared schema of data/labeled/flags/README.md
(tools/flag_lines.py merges them into data/labeled/flags/flagged_lines.csv; never edit that file here).

Reads the tables misses.py wrote (data/labeled/prediction_misses/) and writes data/labeled/flags/prediction_flags.csv.

  python experiments/routeknower/E31-scripts/flags.py [--tables data/labeled/prediction_misses]
      [--out data/labeled/flags/prediction_flags.csv] [--today YYYY-MM-DD]
  python tools/flag_lines.py --check-inputs          # the registry's validator (exit 0 before a commit)

Flags (category prediction_miss) and the SEVERITY RULE (E31; also in data/labeled/prediction_misses/README.md). Rates
are over the five goal leads pooled (5, 10, 15, 20, 30 min ahead) in the period named; "the range" = the day-bootstrap
95% range of the line's rate (days are the unit of noise):
  large_early_miss   the bus came more than the large-miss threshold EARLIER than Passio showed (riders miss it).
                     high: (rate >= 1.5 x all lines OR >= all lines + 15 points) AND the range's low end above the
                     all-lines rate AND n >= 300 on >= 5 days; medium: the same with 1.25 x / + 10 points; low (watch):
                     1.1 x / + 5 points on n >= 100 and >= 3 days, range not required. Judged on the last 14 service
                     days and on all days (each against all lines in the same days); the row keeps the window with the
                     higher severity (the last 14 days on a tie): data_from and the metric say which
  large_late_miss    the same for the bus coming LATER than shown
  stops_without_predictions  stops where under 25% of >= 30 arrivals had a Passio time 5 min ahead (last 14 days).
                     high: under 10% at the flagged stops together on >= 100 arrivals; else medium
  first_stop_next_trip_times stops 0 to 3 of a line (the terminal and the first stops after it) where, for >= 20%
                     of >= 30 arrivals, the only time a screen showed 5 min ahead was under another trip id of the same
                     bus (DC-025; other_trip.py), last 14 days; value = share of those times that were large misses.
                     high: >= 50% and above the all-lines large-miss rate at 5 min, on >= 100; medium: above that rate
                     on >= 30; else low (watch)
  other_trip_times   the same at the line's later stops (position 4 on)
  worse_near_transitions     goal-lead large-miss rate within 30 min of a bus count change / the rate elsewhere on the
                     same line, all days. high: >= 1.5 on >= 300 near; medium: >= 1.25 on >= 100; low (watch): >= 1.15
                     on >= 100; always above the same ratio over all lines
  worse_when_behind  the same ratio for buses more than 10 min behind the timetable; same thresholds
"""
import argparse, csv, sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import misses_lib as M          # noqa: E402

TABLES = M.ROOT / "data" / "labeled" / "prediction_misses"
OUT = M.ROOT / "data" / "labeled" / "flags" / "prediction_flags.csv"
COLS = ("flag_id,route_id,route,category,flag,severity,scope,metric,value,baseline,n,data_from,data_to,evidence,"
        "agent_action,first_flagged,last_checked,status").split(",")
CAT = "prediction_miss"
EVIDENCE = "data/labeled/prediction_misses/{f}; experiments/routeknower/E31-scripts/; RouteKnower E31"
HOURS = {"10 PM to 5 AM": "22-05", "5 to 7 AM": "05-07", "7 to 10 AM": "07-10", "10 AM to 3 PM": "10-15",
         "3 to 7 PM": "15-19", "7 to 10 PM": "19-22"}
RATE_RULE = {"high": (1.5, 0.15, 300, 5, True), "medium": (1.25, 0.10, 300, 5, True), "low": (1.1, 0.05, 100, 3, False)}
RATIO_RULE = {"high": (1.5, 300), "medium": (1.25, 100), "low": (1.15, 100)}
SEV_RANK = {"high": 0, "medium": 1, "low": 2}
FIRST_STOPS = 3                  # stop positions 0 to 3: the terminal and the first stops after it


def read(path):
    p = Path(path)
    if not p.exists():
        return []
    with open(p, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def f(x):
    return M.num(x)


def today_chicago():
    return M.L.chicago(int(datetime.now(timezone.utc).timestamp())).date().isoformat()


def rate_severity(value, base, lo, n, days):
    """The large_early_miss / large_late_miss rule -> 'high' | 'medium' | 'low' | None."""
    if value is None or base is None:
        return None
    for sev in ("high", "medium", "low"):
        ratio, pts, n_min, d_min, need_range = RATE_RULE[sev]
        if n >= n_min and days >= d_min and (value >= ratio * base or value >= base + pts) and value > base \
                and (not need_range or (lo is not None and lo > base)):
            return sev
    return None


def ratio_severity(ratio, n_near, base=None):
    """worse_near_transitions / worse_when_behind -> severity or None; never at or under the all-lines ratio."""
    if ratio is None or (base is not None and ratio <= base):
        return None
    for sev in ("high", "medium", "low"):
        r, n_min = RATIO_RULE[sev]
        if ratio >= r and n_near >= n_min:
            return sev
    return None


def scope_text(parts):
    return ";".join(f"{k}={v}" for k, v in parts if v)


def fmt(x, nd=4):
    return "" if x is None else (f"{x:.{nd}f}" if isinstance(x, float) else str(x))


def build(tables=TABLES, today=None, prev=None):
    """-> list of flag dicts (COLS). prev: the previous prediction_flags.csv rows (first_flagged is kept)."""
    today = today or today_chicago()
    meta = dict(ln.split("=", 1) for ln in (Path(tables) / "run.txt").read_text(encoding="utf-8").split() if "=" in ln)
    lines = read(Path(tables) / "line_summary.csv")
    stops = read(Path(tables) / "stop_hotspots.csv")
    sl = read(Path(tables) / "slices.csv")
    first = {r["flag_id"]: r["first_flagged"] for r in prev or ()}
    L_ = {(r["period"], r["route_id"], r["lead_min"]): r for r in lines}
    d_all, d_recent, d_to = meta["data_from"], meta["recent_from"], meta["data_to"]
    out = []

    def add(rid, route, flag, sev, scope, metric, value, base, n, dfrom, fname, action):
        fid = f"{CAT}:{flag}:{rid}"
        out.append({"flag_id": fid, "route_id": rid, "route": route, "category": CAT, "flag": flag, "severity": sev,
                    "scope": scope, "metric": metric, "value": fmt(value), "baseline": fmt(base), "n": str(int(n)),
                    "data_from": dfrom, "data_to": d_to, "evidence": EVIDENCE.format(f=fname),
                    "agent_action": action, "first_flagged": min(first.get(fid, today), today), "last_checked": today,
                    "status": "watch" if sev == "low" else "open"})

    routes = sorted({r["route_id"] for r in lines if r["route_id"] != "ALL"})
    # ---- large misses by direction (goal leads pooled; the last 14 days or all days, the more severe)
    for d, flag, word in (("early", "large_early_miss", "EARLIER"), ("late", "large_late_miss", "LATER")):
        for rid in routes:
            best = None
            for win in ("recent", "all"):
                r, base = L_.get((win, rid, "goal")), L_.get((win, "ALL", "goal"))
                if not r or not base:
                    continue
                b = f(base[f"large_{d}_rate"])
                v, lo, n, days = f(r[f"large_{d}_rate"]), f(r[f"large_{d}_lo"]), int(r["n"]), int(r["days"])
                sev = rate_severity(v, b, lo, n, days)
                if sev and (best is None or SEV_RANK[sev] < SEV_RANK[best[0]]):
                    best = (sev, win, r, v, b, n)
            if not best:
                continue
            sev, win, r, v, b, n = best
            leads = [lm for lm in ("5", "10", "15", "20", "30")
                     if (x := L_.get((win, rid, lm))) and (y := L_.get((win, "ALL", lm)))
                     and int(x["n"]) >= 50 and f(x[f"large_{d}_rate"]) is not None
                     and f(x[f"large_{d}_rate"]) >= 1.1 * (f(y[f"large_{d}_rate"]) or 0) and f(x[f"large_{d}_rate"]) > 0.02]
            hot = sorted((s for s in stops if s["period"] == win and s["route_id"] == rid
                          and f"large_{d}" in s["hotspot"].split("|")),
                         key=lambda s: -(f(s[f"large_{d}_rate"]) or 0) * int(s["n"] or 0))[:8]
            hrs = [x for x in sl if x["period"] == win and x["route_id"] == rid and x["dimension"] == "hours"
                   and int(x["n"]) >= 100 and (f(x[f"large_{d}_rate"]) or 0) >= 1.25 * v]
            rr = L_.get(("recent", rid, "goal")) or {}
            bef, tr = rr.get(f"before_large_{d}_rate"), rr.get(f"trend_{d}")
            note = (f"last 14 days {100 * f(rr[f'large_{d}_rate']):.1f}%, before them {100 * f(bef):.1f}% ({tr})"
                    if bef not in (None, "") and tr else "")
            scope = scope_text([("lead", lead_range(leads)), ("stops", "|".join(s["stop_id"] for s in hot)),
                                ("hours", "|".join(HOURS[x["value"]] for x in hrs if x["value"] in HOURS)),
                                ("note", note)])
            th = "2 min at 5 to 15 min ahead, 4 at 20, 5 at 30"
            span = "last 14 service days" if win == "recent" else "all service days"
            metric = (f"share of Passio's times 5 to 30 min ahead that the bus beat by more than the large-miss "
                      f"threshold ({th}), {span}") if d == "early" else \
                     (f"share of Passio's times 5 to 30 min ahead that the bus came later than by more than the "
                      f"large-miss threshold ({th}), {span}")
            action = (f"score this line (and the scope's stops and hours) as its own slice with the bus {word} than "
                      f"shown counted against the 1% rule; a model must not be too late here more often than Passio"
                      if d == "early" else
                      f"score this line (and the scope's stops and hours) as its own slice; a model must beat Passio "
                      f"here without becoming too late more often (no route more than 10% worse, RouteKnower 6.6)")
            if tr == "worse" and d == "early":
                action += ("; the rate changed with Passio's feed change of Oct 27 about 6 PM (DC-025): never fit a "
                           "correction across that date, test on days after it")
            add(rid, r["route"], flag, sev, scope, metric, v, b, n, d_recent if win == "recent" else d_all,
                "line_summary.csv", action)
    # ---- stops with no time on display (recent)
    base5 = f((L_.get(("recent", "ALL", "5")) or {}).get("coverage"))
    allstops = {(s["route_id"], s["stop_id"]): s for s in stops if s["period"] == "all"}
    by = defaultdict(list)
    for s in stops:
        if s["period"] == "recent" and "no_time" in s["hotspot"].split("|"):
            by[s["route_id"]].append(s)
    for rid, ss in sorted(by.items()):
        n = sum(int(s["targets"]) for s in ss)
        has = sum(round(f(s["coverage_5"]) * int(s["targets"])) for s in ss)
        v = has / n if n else None
        bef = []
        for s in ss:                                   # the same stops before the last 14 days (all minus recent)
            a = allstops.get((rid, s["stop_id"]))
            if a and a.get("targets"):
                an, ah = int(a["targets"]), round(f(a["coverage_5"]) * int(a["targets"]))
                bn, bh = an - int(s["targets"]), ah - round(f(s["coverage_5"]) * int(s["targets"]))
                if bn > 0:
                    bef.append((bn, bh))
        anyn = sum(round(f(s["coverage_any"]) * int(s["targets"])) for s in ss)
        note = f"a time at any lead 1 to 30 min ahead {100 * anyn / n:.0f}%" if n else ""
        if bef:
            bn, bh = sum(x[0] for x in bef), sum(x[1] for x in bef)
            note += f"; before the last 14 days {100 * bh / bn:.0f}% of {bn} arrivals had one 5 min ahead"
        sev = "high" if v is not None and v < 0.10 and n >= 100 else "medium"
        add(rid, ss[0]["route"], "stops_without_predictions", sev,
            scope_text([("stops", "|".join(s["stop_id"] for s in ss)), ("lead", "0-10"), ("note", note)]),
            "share of arrivals at the scope's stops with a Passio time on display 5 min ahead, last 14 service days",
            v, base5, n, d_recent, "stop_hotspots.csv",
            "count these arrivals as misses in every coverage figure (no time on display), never score a model only "
            "where Passio had a time, and check what the app shows at these stops")
    # ---- the only time a screen showed was another trip's (recent), first stops vs later stops
    b5 = f((L_.get(("recent", "ALL", "5")) or {}).get("large_rate"))
    by = defaultdict(list)
    for s in stops:
        if s["period"] == "recent" and "other_trip_times" in s["hotspot"].split("|"):
            pos = min((int(i) for i in s["stop_index"].split("|") if i.isdigit()), default=99)
            by[(s["route_id"], "first_stop_next_trip_times" if pos <= FIRST_STOPS else "other_trip_times")].append(s)
    for (rid, flag), ss in sorted(by.items()):
        n = sum(int(s["screen_other_trip_5"]) for s in ss)
        big = sum(int(s["screen_other_trip_early"]) + int(s["screen_other_trip_late"]) for s in ss)
        e = sum(int(s["screen_other_trip_early"]) for s in ss)
        v = big / n if n else None
        above = v is not None and b5 is not None and v > b5
        sev = "high" if above and v >= 0.5 and n >= 100 else "medium" if above and n >= 30 else "low"
        idx = sorted({i for s in ss for i in s["stop_index"].split("|") if i.isdigit()}, key=int)
        side = (f"{e} of {n} times the bus came earlier than shown" if e * 2 > big else
                f"{big - e} of {n} times the bus came later than shown")
        add(rid, ss[0]["route"], flag, sev,
            scope_text([("stops", "|".join(s["stop_id"] for s in ss)), ("lead", "0-10"),
                        ("note", f"stop positions {', '.join(idx)}; {side}")]),
            "share of the times a screen showed only under another trip id of the same bus 5 min ahead (no own-trip "
            "time) that were large misses (more than 2 min either way), last 14 service days",
            v, b5, n, d_recent, "stop_hotspots.csv",
            "score these stops' arrivals with the time riders saw (the bus's other trip id, other_trip.py) as their "
            "own slice; counting it in predictions.csv is a detector change with a replay (owner's call, DC-025)")
    # ---- near a bus count change / bus far behind (all days, more samples)
    for flag, nk, rk, word in (("worse_near_transitions", "n_near_transition", "large_rate_near_transition",
                                "within 30 min of a change in the line's bus count"),
                               ("worse_when_behind", "n_behind10", "large_rate_behind10",
                                "while the bus ran more than 10 min behind the timetable")):
        base = L_.get(("all", "ALL", "goal"))
        other = "large_rate_away_from_transition" if flag == "worse_near_transitions" else None
        bratio = ratio_of(base, rk, other)
        for rid in routes:
            r = L_.get(("all", rid, "goal"))
            if not r:
                continue
            ratio, n_near = ratio_of(r, rk, other), int(r.get(nk) or 0)
            sev = ratio_severity(ratio, n_near, bratio)
            if not sev:
                continue
            scope = scope_text([("lead", "5-30"), ("note", "transitions = data/labeled/transitions/transitions.csv "
                                                           "(E29)" if flag == "worse_near_transitions" else
                                 "delay_s > 600 in the forecast table")])
            add(rid, r["route"], flag, sev, scope,
                f"large-miss rate (goal leads) {word} divided by the rate otherwise on the same line, all days",
                ratio, bratio, n_near, d_all, "line_summary.csv",
                "score these predictions as their own slice and give a model the inputs a phone has at query time "
                "(transition_min, added_recently, delay_s); never drop them from the test rows" if
                flag == "worse_near_transitions" else
                "carry the bus's current delay into its next stops and trips (Passio does not: E20, E26); score buses "
                "more than 10 min behind as their own slice")
    return out


def ratio_of(r, rk, other=None):
    """rate in rk / the rate of the rest of the line (other column, or derived from the line's overall rate)."""
    if not r:
        return None
    a = f(r.get(rk))
    if a is None:
        return None
    if other:
        b = f(r.get(other))
    else:
        n, nk = int(r["n"]), int(r.get("n_behind10") or 0)
        tot = f(r.get("large_rate"))
        b = (tot * n - a * nk) / (n - nk) if n > nk and tot is not None else None
    return round(a / b, 4) if b else None


def lead_range(leads):
    """['5', '10', '15'] -> '5-20' (minutes ahead, the next goal lead as the exclusive end; 30 -> 30-45)."""
    if not leads:
        return ""
    goal = [5, 10, 15, 20, 30, 45]
    lo, hi = int(leads[0]), int(leads[-1])
    return f"{lo}-{goal[goal.index(hi) + 1]}"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--tables", default=str(TABLES))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--today", default=None)
    a = ap.parse_args(argv)
    prev = read(a.out)
    rows = build(a.tables, a.today, prev)
    rank = {"high": 0, "medium": 1, "low": 2}
    rows.sort(key=lambda r: (rank[r["severity"]], r["flag"], r["route"].lower()))
    p = Path(a.out)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        print(f"{r['severity']:6s} {r['flag']:28s} {r['route']:28s} value {r['value']:>8s} base {r['baseline']:>8s} "
              f"n {r['n']}")


if __name__ == "__main__":
    main()

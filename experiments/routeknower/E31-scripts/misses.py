#!/usr/bin/env python3
"""E31 (2026-11-11): which lines have LARGE prediction misses, where, when and in which direction.

Scores Passio's time on display (what riders see) in predictions.csv against the logged arrivals with the large-miss
rule of misses_lib (more than twice the goal's allowed error, capped at 5 min; bus_early = the bus came earlier than
shown, the dangerous side). Each prediction gets what the bus was doing (forecast tables, features.py), how near it was
to a bus count change on its line (transitions_near.py); every non-GPS arrival is a coverage target (coverage.py) and an
arrival with no 5-min time gets what a screen showed under another trip id (other_trip.py, needs --pred-updates).

  gh release download data-archive-2026-10 -R blobberus/straight-bussing -p "eta-*.csv.gz" -D <eta>   (and -11;
      pred-updates-*.jsonl.gz the same way into <pu>)
  git show origin/data:data/ground_truth/predictions.csv > predictions.csv   (Git Bash: MSYS_NO_PATHCONV=1; also
      data/ground_truth/archive/predictions-*.csv, arrivals.csv, bus_changes.csv)
  python experiments/routeknower/E31-scripts/misses.py --predictions <archive.csv> <predictions.csv> \
      --arrivals arrivals.csv --eta-dir <eta> --pred-updates <pu> --bus-changes bus_changes.csv \
      [--transitions data/labeled/transitions/transitions.csv] [--from 2026-10-12 --to 2026-11-10] \
      [--out data/labeled/prediction_misses]
  python experiments/routeknower/E31-scripts/flags.py      # then: data/labeled/flags/prediction_flags.csv

Writes into --out: line_summary.csv, stop_hotspots.csv, weekly_trend.csv, slices.csv, large_misses.csv.gz, run.txt
(columns: the folder's README.md). Tables come per PERIOD: `all` (the whole window), `recent` (the last 14 service
days: what riders see now) and, in line_summary only, `before` (the days before them; trend_early / trend_late compare
the two). Stdlib only; about 3 minutes for 30 days. Read-only on its inputs.
"""
import argparse, statistics, sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import misses_lib as M          # noqa: E402
import features as F            # noqa: E402
import transitions_near as T    # noqa: E402
import coverage as C            # noqa: E402
import other_trip as O          # noqa: E402

OUT = M.ROOT / "data" / "labeled" / "prediction_misses"
GOAL = "goal"                    # lead_min value of the rows that pool the five goal leads
RECENT_DAYS = 14                 # period "recent": the last 14 service days; "before": the days before them
BEHIND_MIN = 10                  # "the bus more than 10 min behind" (E24, E26)
ALL = ("ALL", "All lines")

LINE_COLUMNS = ("period,route_id,route,lead_min,days,n,targets,coverage,large,large_rate,large_early,large_early_rate,"
                "large_early_lo,large_early_hi,large_late,large_late_rate,large_late_lo,large_late_hi,gross,gross_rate,"
                "pass_shrink_rate,band_b_rate,too_late_rate,median_err_min,p90_abs_err_min,early_ratio_vs_all,"
                "late_ratio_vs_all,share_of_all_large_early,share_of_all_large_late,before_large_early_rate,"
                "before_large_late_rate,trend_early,trend_late,n_near_transition,"
                "large_rate_near_transition,large_rate_away_from_transition,n_no_timetable,large_rate_no_timetable,"
                "n_behind10,large_rate_behind10,n_next_trip,large_rate_next_trip,large_rate_current_trip,"
                "features_known").split(",")
STOP_COLUMNS = ("period,route_id,route,stop_id,stop,stop_index,days,n,large_rate,large_early_rate,large_late_rate,"
                "median_err_min,n_5,large_early_rate_5,large_late_rate_5,line_large_early_rate,line_large_late_rate,"
                "targets,coverage_5,coverage_any,line_coverage_5,no_time_5,screen_other_trip_5,screen_other_trip_early,"
                "screen_other_trip_late,hotspot").split(",")
WEEK_COLUMNS = ("route_id,route,week,days,n,large_rate,large_early_rate,large_late_rate,pass_shrink_rate,"
                "median_err_min,n_5,large_early_rate_5,large_late_rate_5,targets,coverage_5").split(",")
SLICE_COLUMNS = ("period,route_id,route,dimension,value,n,large_rate,large_early_rate,large_late_rate,median_err_min,"
                 "line_large_rate").split(",")
MISS_COLUMNS = ("service_day,local_time,route_id,route,stop_id,stop,vehicle_id,trip_id,lead_min,predicted,actual,"
                "error_min,direction,near_transition_min,no_timetable,behind_min,gross,pred_age_s,next_trip,"
                "transition_kind,shown_at").split(",")


def lead_min(lead):
    return lead // 60


def r4(x):
    return None if x is None else round(x, 4)


def med_min(errs):
    return round(statistics.median(errs) / 60.0, 2) if errs else None


def p90_min(errs):
    if not errs:
        return None
    a = sorted(abs(e) for e in errs)
    return round(a[min(len(a) - 1, int(0.9 * len(a)))] / 60.0, 2)


# ---------------------------------------------------------------- enrich
def enrich(preds, eta_dir, transitions, log=print):
    """Adds to every predictions row: dir, gross, pass, band_b, too_late, t_show, hour, day_type, week, age, the
    forecast-table features (next_trip, no_timetable, behind_min, feat 1/0) and near (near_transition_min, kind)."""
    by_day = defaultdict(list)
    for r in preds:
        by_day[r["day"]].append(r)
    for day in sorted(by_day):
        rows = by_day[day]
        path = Path(eta_dir) / f"eta-{day}.csv.gz" if eta_dir else None
        ix = F.EtaIndex().add_table(path, day) if path and path.exists() else None
        hit = 0
        for r in rows:
            e, ld = r["err"], r["lead"]
            r["dir"] = M.direction(e, ld)
            r["gross"] = int(M.gross(e, ld))
            r["pass"] = M.passes(e, ld)
            r["band_b"] = M.band_b(e, ld)
            r["too_late"] = M.too_late(e, ld)
            r["t_show"] = r["epoch_i"] - ld
            r["hour"] = M.L.chicago(r["t_show"]).hour
            r["day_type"] = M.day_type(day)
            r["week"] = M.week_of(day)
            r["age"] = M.age_bucket(r["age_s"])
            f = ix.match(r["vehicle_id"], r["stop_id"], r["epoch_i"], ld) if ix else None
            r.update(F.derive(f))
            r["feat"] = int(f is not None)
            hit += f is not None
            nt = transitions.nearest(r["route_id"], r["t_show"]) if transitions and transitions.covered(day) else None
            r["near_min"], r["near_kind"] = (nt[0], nt[1]) if nt else ("", "")
            r["near"] = "" if not (transitions and transitions.covered(day)) else \
                int(nt is not None and abs(nt[0]) <= T.NEAR_MIN)
        log(f"{day}: {len(rows):6d} predictions, forecast-table features for {hit / len(rows):6.1%}"
            f"{'' if ix else ' (no table)'}")
    return preds


# ---------------------------------------------------------------- tables
class Tally:
    """Per key: n, large, early, late, gross, pass (non-gross), band B, too late, errors, and per-day counts."""

    def __init__(self):
        self.d = defaultdict(lambda: {"n": 0, "large": 0, "early": 0, "late": 0, "gross": 0, "ok": 0, "pass": 0,
                                      "band_b": 0, "too_late": 0, "errs": [], "days": set(),
                                      "early_d": defaultdict(lambda: [0, 0]), "late_d": defaultdict(lambda: [0, 0])})

    def add(self, key, r):
        v = self.d[key]
        v["n"] += 1
        v["days"].add(r["day"])
        v["errs"].append(r["err"])
        ed, ld_ = v["early_d"][r["day"]], v["late_d"][r["day"]]
        ed[1] += 1
        ld_[1] += 1
        if r["dir"]:
            v["large"] += 1
        if r["dir"] == M.EARLY:
            v["early"] += 1
            ed[0] += 1
        if r["dir"] == M.LATE:
            v["late"] += 1
            ld_[0] += 1
        if r["gross"]:
            v["gross"] += 1
        else:
            v["ok"] += 1
            v["pass"] += r["pass"]
            v["band_b"] += r["band_b"]
        v["too_late"] += r["too_late"]

    def get(self, key):
        return self.d.get(key)


def line_summary(preds, targets, boots=2000, period="all"):
    """-> rows of LINE_COLUMNS for one period (every line and ALL; leads 1..30 and the pooled goal leads)."""
    tal, slices = Tally(), Tally()
    names = {}
    for r in preds:
        names[r["route_id"]] = r["route_name"]
        keys = [(r["route_id"], lead_min(r["lead"])), (ALL[0], lead_min(r["lead"]))]
        if r["lead"] in M.GOAL_LEADS:
            keys += [(r["route_id"], GOAL), (ALL[0], GOAL)]
        for k in keys:
            tal.add(k, r)
            if r["near"] != "":
                slices.add(k + ("near", r["near"]), r)
            if r["feat"]:
                slices.add(k + ("no_tt", r["no_timetable"]), r)
                b = r["behind_min"]
                if b != "":
                    slices.add(k + ("behind", int(b > BEHIND_MIN)), r)
                slices.add(k + ("next", r["next_trip"]), r)
                slices.add(k + ("feat",), r)
    cov = defaultdict(lambda: [0, 0])
    for t in targets:
        for rid in (t["route_id"], ALL[0]):
            for ld in M.ALL_LEADS:
                c = cov[(rid, lead_min(ld))]
                c[0] += 1
                c[1] += t.get(f"has_{ld // 60}", 0)
    out = []
    order = [lead_min(x) for x in M.ALL_LEADS] + [GOAL]
    routes = sorted(names, key=lambda x: names[x].lower()) + [ALL[0]]
    for rid in routes:
        for lm in order:
            v = tal.get((rid, lm))
            if not v:
                continue
            base = tal.get((ALL[0], lm))
            n = v["n"]
            row = {"period": period, "route_id": rid, "route": names.get(rid, ALL[1]), "lead_min": lm,
                   "days": len(v["days"]), "n": n,
                   "large": v["large"], "large_rate": r4(v["large"] / n), "large_early": v["early"],
                   "large_early_rate": r4(v["early"] / n), "large_late": v["late"], "large_late_rate": r4(v["late"] / n),
                   "gross": v["gross"], "gross_rate": r4(v["gross"] / n),
                   "pass_shrink_rate": r4(M.rate(v["pass"], v["ok"])), "band_b_rate": r4(M.rate(v["band_b"], v["ok"])),
                   "too_late_rate": r4(v["too_late"] / n), "median_err_min": med_min(v["errs"]),
                   "p90_abs_err_min": p90_min(v["errs"])}
            for name, dk in (("large_early", "early_d"), ("large_late", "late_d")):
                ci = M.boot_ci({d: tuple(x) for d, x in v[dk].items()}, boots)
                row[name + "_lo"], row[name + "_hi"] = (r4(ci[0]), r4(ci[1])) if ci else (None, None)
            if base and rid != ALL[0]:
                be, bl = base["early"] / base["n"], base["late"] / base["n"]
                row["early_ratio_vs_all"] = r4(v["early"] / n / be) if be else None
                row["late_ratio_vs_all"] = r4(v["late"] / n / bl) if bl else None
                row["share_of_all_large_early"] = r4(M.rate(v["early"], base["early"]))
                row["share_of_all_large_late"] = r4(M.rate(v["late"], base["late"]))
            if isinstance(lm, int) and lm * 60 in M.ALL_LEADS:
                c = cov.get((rid, lm))
                if c and c[0]:
                    row["targets"], row["coverage"] = c[0], r4(c[1] / c[0])
            elif lm == GOAL:
                c = cov.get((rid, 5))
                if c and c[0]:
                    row["targets"], row["coverage"] = c[0], r4(c[1] / c[0])     # the goal's under-10 point
            for name, key, val in (("near_transition", "near", 1), ("away_from_transition", "near", 0),
                                   ("no_timetable", "no_tt", 1), ("behind10", "behind", 1),
                                   ("next_trip", "next", 1), ("current_trip", "next", 0)):
                x = slices.get((rid, lm, key, val))
                row["large_rate_" + name] = r4(x["large"] / x["n"]) if x else None
                if name in ("near_transition", "no_timetable", "behind10", "next_trip"):
                    row["n_" + name] = x["n"] if x else 0
            ff = slices.get((rid, lm, "feat"))
            row["features_known"] = r4((ff["n"] if ff else 0) / n)
            out.append(row)
    return out


def trend(a, b, rel=1.2, pts=0.02):
    """'worse' / 'better' / 'same' from rate a (before) to rate b (recent): a change of at least 20% (relative) and 2
    points; '' if either is unknown."""
    if a in (None, "") or b in (None, ""):
        return ""
    if b >= a * rel and b - a >= pts:
        return "worse"
    if b <= a / rel and a - b >= pts:
        return "better"
    return "same"


def add_trends(rows):
    """On every 'recent' row: the same line and lead's rates before the recent window, and the trend per direction."""
    before = {(r["route_id"], r["lead_min"]): r for r in rows if r["period"] == "before"}
    for r in rows:
        b = before.get((r["route_id"], r["lead_min"]))
        if r["period"] != "recent" or not b:
            continue
        r["before_large_early_rate"], r["before_large_late_rate"] = b["large_early_rate"], b["large_late_rate"]
        r["trend_early"] = trend(b["large_early_rate"], r["large_early_rate"])
        r["trend_late"] = trend(b["large_late_rate"], r["large_late_rate"])
    return rows


def stop_hotspots(preds, targets, screens, line_rows, period="all"):
    """-> rows of STOP_COLUMNS for one period, one per (line, stop); line_rows: line_summary rows of the same period."""
    line = {(r["route_id"], r["lead_min"]): r for r in line_rows}
    tal, tal5 = Tally(), Tally()
    names, idx = {}, defaultdict(set)
    for r in preds:
        if r["lead"] not in M.GOAL_LEADS:
            continue
        k = (r["route_id"], r["stop_id"])
        names[k] = (r["route_name"], r["stop_name"])
        idx[k].add(r["stop_index"])
        tal.add(k, r)
        if r["lead"] == 300:
            tal5.add(k, r)
    cov = defaultdict(lambda: {"n": 0, "h5": 0, "ha": 0, "gap": 0})
    for t in targets:
        k = (t["route_id"], t["stop_id"])
        names.setdefault(k, (t["route"], t["stop"]))
        idx[k].add(t["stop_index"])
        c = cov[k]
        c["n"] += 1
        c["h5"] += t["has_5"]
        c["ha"] += t["has_any"]
        c["gap"] += 1 - t["has_5"]
    scr = defaultdict(lambda: [0, 0, 0])
    for g, _, _, err in screens:
        x = scr[(g["route_id"], g["stop_id"])]
        x[0] += 1
        d = M.direction(err, 300)
        x[1] += d == M.EARLY
        x[2] += d == M.LATE

    def first_index(k):
        ints = [int(i) for i in idx[k] if str(i).isdigit()]
        return min(ints) if ints else 0
    out = []
    for k in sorted(names, key=lambda k: (names[k][0].lower(), first_index(k), k[1])):
        v, v5, c, x = tal.get(k), tal5.get(k), cov.get(k), scr.get(k)
        lg, l5 = line.get((k[0], GOAL)) or {}, line.get((k[0], 5)) or {}
        row = {"period": period, "route_id": k[0], "route": names[k][0], "stop_id": k[1], "stop": names[k][1],
               "stop_index": "|".join(sorted({str(i) for i in idx[k]}, key=lambda z: (len(z), z))),
               "line_large_early_rate": lg.get("large_early_rate"), "line_large_late_rate": lg.get("large_late_rate"),
               "line_coverage_5": l5.get("coverage"), "n": 0, "n_5": 0}
        if v:
            row.update(days=len(v["days"]), n=v["n"], large_rate=r4(v["large"] / v["n"]),
                       large_early_rate=r4(v["early"] / v["n"]), large_late_rate=r4(v["late"] / v["n"]),
                       median_err_min=med_min(v["errs"]))
        if v5:
            row.update(n_5=v5["n"], large_early_rate_5=r4(v5["early"] / v5["n"]),
                       large_late_rate_5=r4(v5["late"] / v5["n"]))
        if c:
            row.update(targets=c["n"], coverage_5=r4(c["h5"] / c["n"]), coverage_any=r4(c["ha"] / c["n"]),
                       no_time_5=c["gap"])
        row["screen_other_trip_5"] = x[0] if x else 0
        row["screen_other_trip_early"] = x[1] if x else 0
        row["screen_other_trip_late"] = x[2] if x else 0
        row["hotspot"] = hotspot(row)
        out.append(row)
    return out


def hotspot(row, ratio=1.5, n_min=50, cov_low=0.25, cov_n=30, other_share=0.2, other_n=30):
    """'|'-joined reasons a stop stands out on its line in its period: large_early / large_late (rate >= 1.5 x the
    line's and 2 points more, n >= 50 goal-lead predictions), no_time (a time 5 min ahead for under 25% of >= 30
    arrivals), other_trip_times (for >= 20% of >= 30 arrivals the screen's only time 5 min ahead was under another
    trip id)."""
    why = []
    if (row.get("n") or 0) >= n_min:
        for name in ("early", "late"):
            a, b = row.get(f"large_{name}_rate"), row.get(f"line_large_{name}_rate")
            if a is not None and b not in (None, "") and a >= ratio * b and a - b >= 0.02:
                why.append("large_" + name)
    cv, tn = row.get("coverage_5"), row.get("targets") or 0
    if cv is not None and tn >= cov_n and cv < cov_low:
        why.append("no_time")
    so = row.get("screen_other_trip_5") or 0
    if tn >= other_n and so >= other_n and so / tn >= other_share:
        why.append("other_trip_times")
    return "|".join(why)


def weekly(preds, targets):
    tal, tal5 = Tally(), Tally()
    names = {ALL[0]: ALL[1]}
    for r in preds:
        if r["lead"] not in M.GOAL_LEADS:
            continue
        names[r["route_id"]] = r["route_name"]
        for rid in (r["route_id"], ALL[0]):
            tal.add((rid, r["week"]), r)
            if r["lead"] == 300:
                tal5.add((rid, r["week"]), r)
    cov = defaultdict(lambda: [0, 0])
    for t in targets:
        for rid in (t["route_id"], ALL[0]):
            c = cov[(rid, M.week_of(t["day"]))]
            c[0] += 1
            c[1] += t["has_5"]
    out = []
    for (rid, wk) in sorted(tal.d, key=lambda k: (k[0] == ALL[0], names.get(k[0], "").lower(), k[1])):
        v, v5, c = tal.get((rid, wk)), tal5.get((rid, wk)), cov.get((rid, wk))
        row = {"route_id": rid, "route": names.get(rid, ""), "week": wk, "days": len(v["days"]), "n": v["n"],
               "large_rate": r4(v["large"] / v["n"]), "large_early_rate": r4(v["early"] / v["n"]),
               "large_late_rate": r4(v["late"] / v["n"]), "pass_shrink_rate": r4(M.rate(v["pass"], v["ok"])),
               "median_err_min": med_min(v["errs"]), "n_5": v5["n"] if v5 else 0}
        if v5:
            row["large_early_rate_5"], row["large_late_rate_5"] = r4(v5["early"] / v5["n"]), r4(v5["late"] / v5["n"])
        if c and c[0]:
            row["targets"], row["coverage_5"] = c[0], r4(c[1] / c[0])
        out.append(row)
    return out


def behind_bucket(b):
    if b == "":
        return "unknown"
    return "more than 10 min behind" if b > 10 else "5 to 10 min behind" if b > 5 else \
        "2 to 5 min behind" if b > 2 else "within 2 min" if b >= -2 else "more than 2 min ahead"


def slices(preds, period="all"):
    """-> rows of SLICE_COLUMNS: goal leads pooled, per line and ALL, by lead, hour range (the display moment's Chicago
    hour), day type, prediction age, current / next trip, timetable or not, delay, near a bus count change."""
    dims = {
        "lead_min": lambda r: str(lead_min(r["lead"])),
        "hours": lambda r: M.hour_bucket(r["hour"]),
        "day_type": lambda r: r["day_type"],
        "prediction_age": lambda r: r["age"],
        "trip": lambda r: "" if not r["feat"] else ("next trip" if r["next_trip"] else "current trip"),
        "timetable": lambda r: "" if not r["feat"] else ("no timetable time" if r["no_timetable"] else "timetable"),
        "delay": lambda r: "" if not r["feat"] else behind_bucket(r["behind_min"]),
        "bus_count_change": lambda r: "" if r["near"] == "" else ("within 30 min" if r["near"] else "none within 30 min"),
    }
    tal = Tally()
    names = {ALL[0]: ALL[1]}
    for r in preds:
        if r["lead"] not in M.GOAL_LEADS:
            continue
        names[r["route_id"]] = r["route_name"]
        for rid in (r["route_id"], ALL[0]):
            tal.add((rid, "_", "_"), r)
            for dim, fn in dims.items():
                val = fn(r)
                if val != "":
                    tal.add((rid, dim, val), r)
    out = []
    for k in sorted(tal.d, key=lambda k: (k[0] == ALL[0], names.get(k[0], "").lower(), list(dims).index(k[1])
                                          if k[1] in dims else -1, k[2])):
        if k[1] == "_":
            continue
        v, base = tal.get(k), tal.get((k[0], "_", "_"))
        out.append({"period": period, "route_id": k[0], "route": names.get(k[0], ""), "dimension": k[1],
                    "value": k[2], "n": v["n"],
                    "large_rate": r4(v["large"] / v["n"]), "large_early_rate": r4(v["early"] / v["n"]),
                    "large_late_rate": r4(v["late"] / v["n"]), "median_err_min": med_min(v["errs"]),
                    "line_large_rate": r4(base["large"] / base["n"])})
    return out


def miss_rows(preds):
    for r in sorted(preds, key=lambda r: (r["epoch_i"], r["vehicle_id"], r["stop_id"], r["lead"])):
        if not r["dir"] or r["lead"] not in M.GOAL_LEADS:
            continue
        yield {"service_day": r["day"], "local_time": M.local_text(r["epoch_i"]), "route_id": r["route_id"],
               "route": r["route_name"], "stop_id": r["stop_id"], "stop": r["stop_name"], "vehicle_id": r["vehicle_id"],
               "trip_id": r["trip_id"], "lead_min": lead_min(r["lead"]), "predicted": r["pred_epoch"],
               "actual": r["epoch_i"], "error_min": round(r["err"] / 60.0, 2), "direction": r["dir"],
               "near_transition_min": r["near_min"], "no_timetable": r["no_timetable"], "behind_min": r["behind_min"],
               "gross": r["gross"], "pred_age_s": "" if r["age_s"] is None else int(r["age_s"]),
               "next_trip": r["next_trip"], "transition_kind": r["near_kind"], "shown_at": M.local_text(r["t_show"])}


# ---------------------------------------------------------------- main
def run(a, log=print):
    preds = M.load_predictions(a.predictions, a.day_from, a.day_to)
    if not preds:
        raise SystemExit("no predictions in the window")
    t0 = min(r["epoch_i"] for r in preds)
    day_to = a.day_to or max(r["day"] for r in preds)
    log(f"{len(preds)} predictions, {min(r['day'] for r in preds)} to {day_to}")
    tr = T.Transitions(a.transitions, a.bus_changes)
    enrich(preds, a.eta_dir, tr, log)
    arr_all = M.load_arrivals(a.arrivals, t_from=t0 - 7200, day_to=day_to, skip_sources=())
    tg = C.targets([x for x in arr_all if x.get("source") != "gps" and x["epoch_i"] >= t0], C.PredIndex(preds))
    _add_lead_cover(tg, preds)                     # coverage at every lead, for line_summary
    screens = []
    if a.pred_updates:
        visits = O.previous_visits(arr_all)
        gaps = defaultdict(list)
        for t in tg:
            if not t["has_5"]:
                gaps[t["day"]].append(t)
        for day in sorted(gaps):
            ups = O.updates_for(a.pred_updates, day)
            if ups:
                screens += O.day_screens(day, ups, gaps[day], visits)
        log(f"screen times under another trip id 5 min ahead: {len(screens)} of {sum(map(len, gaps.values()))} "
            f"arrivals with no 5-min row")
    out = Path(a.out)
    days = sorted({r["day"] for r in preds})
    recent_from = days[-RECENT_DAYS] if len(days) > RECENT_DAYS else days[0]
    lines, stops, sl = [], [], []
    for name, (p, t, sc) in periods(preds, tg, screens, recent_from).items():
        rows = line_summary(p, t, a.boots, name)
        lines += rows
        if name != "before":
            stops += stop_hotspots(p, t, sc, rows, name)
            sl += slices(p, name)
    M.write_csv(out / "line_summary.csv", LINE_COLUMNS, add_trends(lines))
    M.write_csv(out / "stop_hotspots.csv", STOP_COLUMNS, stops)
    M.write_csv(out / "weekly_trend.csv", WEEK_COLUMNS, weekly(preds, tg))
    M.write_csv(out / "slices.csv", SLICE_COLUMNS, sl)
    M.write_csv(out / "large_misses.csv.gz", MISS_COLUMNS, list(miss_rows(preds)))
    meta = {"data_from": days[0], "data_to": day_to, "recent_from": recent_from, "days": len(days),
            "predictions": len(preds), "targets": len(tg), "screens": len(screens)}
    (out / "run.txt").write_text("".join(f"{k}={v}\n" for k, v in meta.items()), encoding="utf-8")
    log(f"wrote {out}: {meta}")
    return meta


def periods(preds, targets, screens, recent_from):
    """-> {'all' | 'before' | 'recent': (preds, targets, screens)}: the whole window, the days before the last
    RECENT_DAYS service days, and those days (recent_from on)."""
    out = {"all": (preds, targets, screens)}
    for name, keep in (("before", lambda d: d < recent_from), ("recent", lambda d: d >= recent_from)):
        out[name] = ([r for r in preds if keep(r["day"])], [t for t in targets if keep(t["day"])],
                     [x for x in screens if keep(x[0]["day"])])
    return out


def _add_lead_cover(targets, preds):
    """has_<minutes> for every lead (coverage.targets sets has_5, has_10 and has_any)."""
    ix = C.PredIndex(preds)
    for t in targets:
        leads = ix.leads_at(t["vehicle_id"], t["stop_id"], t["epoch"])
        for ld in M.ALL_LEADS:
            t["has_" + str(ld // 60)] = int(ld in leads)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--predictions", nargs="+", required=True, help="oldest first: the archive file(s), then current")
    ap.add_argument("--arrivals", required=True)
    ap.add_argument("--eta-dir", default=None, help="folder with eta-<day>.csv.gz (features; optional)")
    ap.add_argument("--pred-updates", default=None, help="folder with pred-updates-<day>.jsonl.gz (optional)")
    ap.add_argument("--transitions", default=str(M.ROOT / "data" / "labeled" / "transitions" / "transitions.csv"))
    ap.add_argument("--bus-changes", default=None)
    ap.add_argument("--from", dest="day_from", default="2026-10-12")
    ap.add_argument("--to", dest="day_to", default=None)
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--boots", type=int, default=2000)
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    main()

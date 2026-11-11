#!/usr/bin/env python3
"""E31: the markdown tables behind RouteKnower.md E31, from the files misses.py and flags.py wrote.

  python experiments/routeknower/E31-scripts/report.py [--tables data/labeled/prediction_misses]
      [--flags data/labeled/flags/prediction_flags.csv] [--out experiments/routeknower/E31-prediction-misses-tables.md]

Read-only on its inputs; a missing file only drops its section.
"""
import argparse, csv, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import misses_lib as M          # noqa: E402

TABLES = M.ROOT / "data" / "labeled" / "prediction_misses"
FLAGS = M.ROOT / "data" / "labeled" / "flags" / "prediction_flags.csv"
OUT = M.ROOT / "experiments" / "routeknower" / "E31-prediction-misses-tables.md"
LEADS = ("5", "10", "15", "20", "30")


def read(p):
    p = Path(p)
    if not p.exists():
        return []
    with open(p, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def pct(x, nd=0):
    v = M.num(x)
    return "" if v is None else f"{100 * v:.{nd}f}%"


def mins(x):
    v = M.num(x)
    return "" if v is None else f"{v:+.1f}"


def table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "|".join("---" if i == 0 else "---:" for i in range(len(head))) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return out + [""]


def build(tables=TABLES, flags=FLAGS):
    t = Path(tables)
    meta = {}
    if (t / "run.txt").exists():
        meta = dict(ln.split("=", 1) for ln in (t / "run.txt").read_text(encoding="utf-8").split() if "=" in ln)
    lines, stops = read(t / "line_summary.csv"), read(t / "stop_hotspots.csv")
    weeks, sl, fl = read(t / "weekly_trend.csv"), read(t / "slices.csv"), read(flags)
    L_ = {(r["period"], r["route_id"], r["lead_min"]): r for r in lines}
    routes = sorted({(r["route"], r["route_id"]) for r in lines if r["route_id"] != "ALL"}, key=lambda x: x[0].lower())
    md = ["# E31 tables: large prediction misses per line", "",
          f"Data: {meta.get('data_from', '?')} to {meta.get('data_to', '?')} ({meta.get('days', '?')} service days), "
          f"{int(meta.get('predictions', 0)):,} Passio times, {int(meta.get('targets', 0)):,} arrivals as coverage "
          f"targets; \"last 14 days\" = {meta.get('recent_from', '?')} on. Made by "
          "`experiments/routeknower/E31-scripts/report.py` from `data/labeled/prediction_misses/` (rules and columns: "
          "its README). Large miss = off by more than twice the goal's allowed error (2 min at 5 to 15 min ahead, 4 at "
          "20, 5 at 30). **Bus early** = the bus came earlier than the time shown (a rider can miss it); **bus late** = "
          "it came later. Unofficial analysis of the public Passio feed.", ""]
    # 1. all lines by lead
    md += ["## 1. All lines, by lead: before the last 14 days and in them", ""]
    rows = []
    for lm in LEADS:
        b, r = L_.get(("before", "ALL", lm)), L_.get(("recent", "ALL", lm))
        if b and r:
            rows.append([f"{lm} min", f"{int(b['n']):,} / {int(r['n']):,}", f"{pct(b['large_early_rate'], 1)} / "
                         f"**{pct(r['large_early_rate'], 1)}**", f"{pct(b['large_late_rate'], 1)} / "
                         f"{pct(r['large_late_rate'], 1)}", f"{pct(b['pass_shrink_rate'])} / {pct(r['pass_shrink_rate'])}",
                         f"{pct(b['coverage'])} / {pct(r['coverage'])}", f"{mins(b['median_err_min'])} / "
                         f"{mins(r['median_err_min'])}"])
    md += table(["Lead", "Passio times", "Bus early (large)", "Bus late (large)", "Within the goal", "Arrivals with a time",
                 "Median error, min"], rows)
    # 2. per line, goal leads pooled
    md += ["## 2. Per line, goal leads pooled", "",
           "Rates with the day-bootstrap 95% range; x = the line's rate / all lines' in the same days.", ""]
    rows = []
    for name, rid in routes + [("All lines", "ALL")]:
        a, r = L_.get(("all", rid, "goal")), L_.get(("recent", rid, "goal"))
        if not a:
            continue
        rr = r or {}
        rows.append([name, f"{int(a['n']):,}", f"{pct(a['large_early_rate'], 1)} ({pct(a['large_early_lo'], 1)} to "
                     f"{pct(a['large_early_hi'], 1)})", f"{pct(a['large_late_rate'], 1)}",
                     f"{pct(rr.get('large_early_rate'), 1)}" + (f" x{M.num(rr['early_ratio_vs_all']):.1f}"
                                                               if rr.get("early_ratio_vs_all") else ""),
                     f"{pct(rr.get('large_late_rate'), 1)}" + (f" x{M.num(rr['late_ratio_vs_all']):.2f}"
                                                              if rr.get("late_ratio_vs_all") else ""),
                     f"{rr.get('trend_early', '')} / {rr.get('trend_late', '')}", pct(a.get("gross_rate"), 1),
                     pct(a.get("pass_shrink_rate")), pct(rr.get("coverage"))])
    md += table(["Line", "Times (all days)", "Bus early, all days", "Bus late, all days", "Bus early, last 14 days",
                 "Bus late, last 14 days", "Trend early / late", "Gross", "Within the goal", "Time 5 min ahead, last 14"],
                rows)
    # 3. per line at 5 min ahead
    md += ["## 3. Per line, 5 min ahead (the goal's under-10 point): before the last 14 days and in them", ""]
    rows = []
    for name, rid in routes + [("All lines", "ALL")]:
        b, r = L_.get(("before", rid, "5")), L_.get(("recent", rid, "5"))
        if b and r:
            rows.append([name, f"{int(b['n']):,} / {int(r['n']):,}", f"{pct(b['large_early_rate'], 1)} / "
                         f"**{pct(r['large_early_rate'], 1)}**", f"{pct(b['large_late_rate'], 1)} / "
                         f"{pct(r['large_late_rate'], 1)}", f"{mins(b['median_err_min'])} / {mins(r['median_err_min'])}",
                         f"{pct(b['coverage'])} / {pct(r['coverage'])}"])
    md += table(["Line", "Times", "Bus early", "Bus late", "Median error, min", "Time 5 min ahead"], rows)
    # 4. stops
    rec = [s for s in stops if s["period"] == "recent"]
    for d, title in (("early", "the bus came far EARLIER than shown"), ("late", "the bus came far LATER than shown")):
        top = sorted((s for s in rec if int(s["n"] or 0) >= 100),
                     key=lambda s: -(M.num(s[f"large_{d}_rate"]) or 0))[:15]
        md += [f"## 4{'a' if d == 'early' else 'b'}. Stops where {title} (last 14 days, 100+ goal-lead times)", ""]
        md += table(["Line", "Stop", "Position", "Times", f"Bus {d}, goal leads", f"Bus {d}, 5 min ahead",
                     f"Line's rate"], [[s["route"], s["stop"], s["stop_index"], s["n"], pct(s[f"large_{d}_rate"]),
                                        pct(s[f"large_{d}_rate_5"]), pct(s[f"line_large_{d}_rate"])] for s in top])
    nt = sorted((s for s in rec if "no_time" in s["hotspot"].split("|")), key=lambda s: (s["route"], s["stop_index"]))
    allc = {(s["route_id"], s["stop_id"]): s for s in stops if s["period"] == "all"}
    md += ["## 5. Stops with almost no time 5 min ahead (last 14 days)", ""]
    md += table(["Line", "Stop", "Position", "Arrivals", "Time 5 min ahead", "Time at any lead", "All days, 5 min ahead"],
                [[s["route"], s["stop"], s["stop_index"], s["targets"], pct(s["coverage_5"]), pct(s["coverage_any"]),
                  pct((allc.get((s["route_id"], s["stop_id"])) or {}).get("coverage_5"))] for s in nt])
    ot = sorted((s for s in rec if "other_trip_times" in s["hotspot"].split("|")),
                key=lambda s: (s["route"], s["stop_index"]))
    md += ["## 6. Stops whose only time 5 min ahead was another trip id's (last 14 days, DC-025)", ""]
    md += table(["Line", "Stop", "Position", "Arrivals", "No own time 5 min ahead", "Screen showed another trip's",
                 "of those, bus far earlier", "bus far later"],
                [[s["route"], s["stop"], s["stop_index"], s["targets"], s["no_time_5"], s["screen_other_trip_5"],
                  s["screen_other_trip_early"], s["screen_other_trip_late"]] for s in ot])
    # 7. weekly
    md += ["## 7. Week by week, 5 min ahead: bus early (large) and a time on display", ""]
    wk = sorted({w["week"] for w in weeks})
    rows = []
    for name, rid in [("All lines", "ALL")] + routes:
        by = {w["week"]: w for w in weeks if w["route_id"] == rid}
        if by:
            rows.append([name] + [f"{pct(by[k]['large_early_rate_5'])} / {pct(by[k]['coverage_5'])}" if k in by else ""
                                  for k in wk])
    md += table(["Line"] + [f"week of {k[5:]}" + (" (2 days)" if k == wk[-1] else "") for k in wk], rows)
    # 8. situations
    md += ["## 8. Situations (all days, goal leads): large-miss rate in it / otherwise on the line", ""]
    rows = []
    for name, rid in routes + [("All lines", "ALL")]:
        a = L_.get(("all", rid, "goal"))
        if a:
            rows.append([name, f"{pct(a['large_rate_near_transition'])} / {pct(a['large_rate_away_from_transition'])} "
                         f"({int(a['n_near_transition'] or 0):,})",
                         f"{pct(a['large_rate_behind10'])} ({int(a['n_behind10'] or 0):,})",
                         f"{pct(a['large_rate_no_timetable'])} ({int(a['n_no_timetable'] or 0):,})"
                         if int(a["n_no_timetable"] or 0) else "",
                         f"{pct(a['large_rate_next_trip'])} / {pct(a['large_rate_current_trip'])}", pct(a["large_rate"])])
    md += table(["Line", "Within 30 min of a bus count change / not (n)", "Bus over 10 min behind (n)",
                 "No timetable time (n)", "Next trip / current trip", "Line overall"], rows)
    # 9. hours (recent)
    md += ["## 9. Hours of the day, last 14 days (goal leads): bus early / bus late", ""]
    hrs = ["5 to 7 AM", "7 to 10 AM", "10 AM to 3 PM", "3 to 7 PM", "7 to 10 PM", M.NIGHT]
    rows = []
    for name, rid in [("All lines", "ALL")] + routes:
        by = {x["value"]: x for x in sl if x["period"] == "recent" and x["route_id"] == rid and x["dimension"] == "hours"}
        if by:
            rows.append([name] + [f"{pct(by[h]['large_early_rate'])} / {pct(by[h]['large_late_rate'])}"
                                  if h in by and int(by[h]["n"]) >= 50 else "" for h in hrs])
    md += table(["Line"] + hrs, rows)
    # 10. flags
    if fl:
        md += ["## 10. The flags (`data/labeled/flags/prediction_flags.csv`)", ""]
        md += table(["Severity", "Flag", "Line", "Value", "All lines", "n", "Days", "Scope"],
                    [[r["severity"], r["flag"], r["route"], r["value"], r["baseline"], r["n"],
                      f"{r['data_from']} to {r['data_to']}", r["scope"].replace("|", ", ")] for r in fl])
    return "\n".join(md) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--tables", default=str(TABLES))
    ap.add_argument("--flags", default=str(FLAGS))
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args(argv)
    text = build(a.tables, a.flags)
    Path(a.out).write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {a.out} ({len(text.splitlines())} lines)")


if __name__ == "__main__":
    main()

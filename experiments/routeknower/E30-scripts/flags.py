#!/usr/bin/env python3
"""E30: turn the odd-behavior tables into line flags (data/labeled/flags/transition_flags.csv, the shared schema of
data/labeled/flags/README.md; tools/flag_lines.py merges it into flagged_lines.csv).

SEVERITY RULE (E30; it wins over the registry's default, data/labeled/flags/README.md):
  value     the line's rate of the behavior (per 10 bus-hours inside transition windows, per 100 bus count changes,
            per 100 listed spans or timetable steps, or a share / ratio: see each metric)
  baseline  the same metric over all lines (same days)
  ratio     value / baseline; ep = the line's episodes; days = service days with one
  high      ratio >= 2, ep >= 30 (spans / steps: >= 15), days >= 5, and the behavior can mislead a rider (a bus shown
            wrongly, a time that never comes true, a bus listed that does not run)
  medium    ratio >= 1.5 with ep >= 30 (>= 15) on >= 3 days; or ratio >= 2 with ep >= 10 (>= 8) on >= 3 days; or a
            would-be high that does not mislead riders (an extra bus the timetable does not list)
  low       ratio >= 1.5 with ep >= 10 (>= 8) on >= 3 days (status watch)
  none      anything else: a behavior common to every line (ratio < 1.5) is a fact of the feed, reported in
            data/labeled/transitions/README.md and RouteKnower E30, not a line flag; fewer episodes are not flagged.
  status    open for high and medium, watch for low.
Scope: vehicles=<bus> when one bus has >= 50% of the line's episodes; hours=<a-b> when <= 6 consecutive clock hours
hold >= 60%; days=weekday when >= 90% are on weekdays; stops=<id> when one named stop holds >= 40%; note = the top
spot and the rate before / after Nov 6 (the day the display rules shipped).

  python experiments/routeknower/E30-scripts/flags.py --tables data/labeled/transitions --json e30.json
      --out data/labeled/flags/transition_flags.csv [--today 2026-11-11]
"""
import argparse, csv, json, sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import odd_lib as L          # noqa: E402

COLS = ["flag_id", "route_id", "route", "category", "flag", "severity", "scope", "metric", "value", "baseline", "n",
        "data_from", "data_to", "evidence", "agent_action", "first_flagged", "last_checked", "status"]
EVID = "data/labeled/transitions/odd_episodes.csv; data/labeled/transitions/odd_summary.csv; RouteKnower E30"
WIN = "inside transition windows (30 min around a bus count change, a shift change, a listed start or end, a timetable step)"
MODEL_SLICE = "score this line's rows in the flag's scope as their own slice"
# code -> (family, rider-facing, metric words, agent action)
CODES = {
    "feed_drop_mid_route": ("rate", True, f"buses vanishing from the feed while moving on the line (5 min or more), per 10 bus-hours {WIN}",
                            f"{MODEL_SLICE}; drop these episodes' arrivals from training labels (the bus was unseen); app agents: the bus disappears from the map, check that the gone rule (15 min) does not drop a bus that comes back"),
    "sparse_reporting": ("rate", True, f"bus reporting only every few minutes (gaps of 5 min or more), per 10 bus-hours {WIN}",
                         f"{MODEL_SLICE}; positions and arrivals of the scoped bus are minutes old or missing: exclude its gps-derived arrivals from training labels"),
    "position_jump": ("rate", True, f"position jumps (500 m or more in one report, faster than 35 m/s), per 10 bus-hours {WIN}",
                      "drop the jumped reports before matching a bus to its line or stops; app agents: the bus jumps on the map (E27c FAST rule hides two in a row)"),
    "frozen_gps": ("rate", True, f"GPS frozen at one point for 5 min while the bus moved, per 10 bus-hours {WIN}",
                   "treat a run of identical coordinates as no position; never infer dwell from it"),
    "twin_buses": ("rate", True, f"two buses of the line within 25 m for 3 min (or identical coordinates), per 10 bus-hours {WIN}",
                   "check headway features for convoy buses; never count the twins as two independent arrivals"),
    "stale_position": ("rate", True, f"bus listed with a 90 to 300 s old report for 3 min, per 10 bus-hours {WIN}",
                       "use the report time, not the poll time, for every position feature"),
    "after_hours": ("rate", True, f"bus reporting under the line's label more than 15 min after (30 min before) its listed hours, per 10 bus-hours {WIN}",
                    f"{MODEL_SLICE}; exclude after-hours reports from on-route training rows; app agents: these buses are shown (core/idle.js hides them only when still)"),
    "wrong_line_label": ("rate", True, f"bus labeled this line while it drove another line's road for 30 min or more, per 10 bus-hours {WIN}",
                         "refile or drop the episode's arrivals before training (they are filed under the wrong line); app agents: the bus is on the wrong line's map and times (DC-024 item 3, owner's call)"),
    "label_flipflop": ("rate", True, f"route label changing to another line and back within 10 min, per 10 bus-hours {WIN}",
                       "smooth the label over 10 min before using it as a feature"),
    "linger_not_in_service": ("rate", True, f"bus still for 5 min or more on the map but not in service (E28 break, end of shift, garage return, never served), per 10 bus-hours {WIN}",
                              f"{MODEL_SLICE}; never use these buses' times as a next-bus candidate in training; app agents: replay core/idle.js on these episodes (E32)"),
    "off_route_drive": ("rate", True, f"bus more than 250 m from its line and its learned corridor (45 s, 2 reports) inside its listed hours, per 10 bus-hours {WIN}",
                        f"{MODEL_SLICE}; app agents: replay core/offroute.js on these episodes, the in-service ones are hidden while serving"),
    "ghost_predictions_after_leave": ("event", True, "Passio times kept 5 min or more for a bus that left the line for good, per 100 lasting leaves (E29 break, shift end, route switch, off the map)",
                                      "drop a bus's predictions once it is gone (forecast table gone_rule) before scoring; never train on those rows as on-time evidence"),
    "unscheduled_leave": ("event", True, "lasting leaves the timetable does not have that leave the line below its listed bus count for 15 min, per 100 lasting leaves",
                          f"{MODEL_SLICE}; headway and wait estimates from the timetable are too short after these leaves"),
    "extra_bus_added": ("event", False, "buses joining the line above its listed bus count (no timetable change), per 100 joins that are not a layover",
                        "do not take the timetable's bus count as the line's real count in headway features"),
    "bunching_after_add": ("event", True, "joins after which the new bus ran within 2 min of another at 3 stops in 30 min, per 100 joins that are not a layover",
                           "score the 30 min after a join as its own slice; headway features must use the real spacing"),
    "joining_bus_no_predictions": ("share", True, "share of a joining bus's arrivals in its first 30 min on the line with no Passio time (percent)",
                                   "do not treat a missing Passio time as no bus (forecast table added_recently); app agents: the joining bus has a position but no time"),
    "staying_bus_late_after_drop": ("ratio", True, "mean absolute error of the staying bus's Passio times 10 to 20 min ahead in the 45 min after a 2-to-1 drop, divided by the line's at other times",
                                    "score the staying bus after a 2-to-1 drop as its own slice (forecast table bus_change_min, transition_kind); its times run late (DC-020)"),
    "timetable_add_missed": ("span", True, "timetable steps up (one more bus per hour) with no bus joining within 45 min, per 100 steps up",
                             "do not plan or estimate headways with the timetable's added bus at these hours; the operator often runs fewer (alerts like the NightRide 30-min notice)"),
    "timetable_drop_missed": ("span", False, "timetable steps down with the line keeping its buses, per 100 steps down",
                              "the timetable's bus count is low at these hours"),
    "service_start_late": ("span", True, "listed spans whose first bus came more than 15 min after the listed start, per 100 spans",
                           "the first listed trips are often not run on time: score them as their own slice; planner: label the first trips as schedule estimates"),
    "service_start_missing": ("span", True, "listed spans with no bus in their first 60 min, per 100 spans",
                              "the timetable lists service the feed never shows here: never plan a trip on it without a live bus"),
    "service_end_early": ("span", True, "service days whose last bus left more than 15 min before the line's listed end, per 100 spans",
                          "the listed end outlasts the real service: after the line's last bus do not show schedule estimates as if a bus will come; the gap is in duration_min"),
}
NOT_FLAGGED = {"night_feed_silent"}     # NightRide listed to 04:29, no bus in the feed after midnight: known since 2026-10-10


def ratio(v, b):
    return v / b if b else (float("inf") if v else 0.0)


def severity(fam, rider, r, ep, days):
    big = 15 if fam == "span" else 30         # span / step episodes are one a day at most
    small = 8 if fam == "span" else 10
    if r >= 2 and ep >= big and days >= 5:
        return "high" if rider else "medium"
    if (r >= 1.5 and ep >= big and days >= 3) or (r >= 2 and ep >= small and days >= 3):
        return "medium"
    if r >= 1.5 and ep >= small and days >= 3:
        return "low"
    return None


def fmt(x, nd=3):
    return f"{x:.{nd}f}".rstrip("0").rstrip(".") if isinstance(x, float) else str(x)


def scope_of(eps, stops_by_name):
    parts = []
    n = len(eps)
    vc = Counter(v for e in eps for v in str(e["vehicle_id"]).split(";") if v).most_common(1)
    if vc and vc[0][1] >= 0.5 * n and vc[0][1] >= 10:
        parts.append(f"vehicles={vc[0][0]}")
    hc = Counter(int(e["hour"]) for e in eps)
    best = None
    for w in range(1, 7):
        for a in range(24):
            hrs = [(a + k) % 24 for k in range(w)]
            c = sum(hc[h] for h in hrs)
            if c >= 0.6 * n:
                best = (a, (a + w) % 24 or 24)
                break
        if best:
            break
    if best:
        parts.append(f"hours={best[0]}-{best[1]}")
    wk = sum(1 for e in eps if e["dow"] not in ("Sat", "Sun"))
    if wk >= 0.9 * n:
        parts.append("days=weekday")
    sc = Counter(e["spot"] for e in eps if e["spot"]).most_common(1)
    if sc and sc[0][1] >= 0.4 * n and sc[0][0] in stops_by_name:
        parts.append(f"stops={'|'.join(stops_by_name[sc[0][0]])}")
    return parts, (sc[0] if sc else None)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tables", required=True, help="folder with odd_episodes.csv, odd_summary.csv, transitions.csv")
    ap.add_argument("--json", required=True, help="run_odd.py --json (the baselines)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--today", default=datetime.now(L.CT).date().isoformat())
    a = ap.parse_args(argv)
    tb = Path(a.tables)
    eps = L.read_csv(tb / "odd_episodes.csv")
    summ = [r for r in L.read_csv(tb / "odd_summary.csv") if r["scope"] == "line"]
    trans = L.read_csv(tb / "transitions.csv")
    base = json.loads(Path(a.json).read_text(encoding="utf-8"))["baselines"]
    routes = json.loads((L.REPO / "web" / "data" / "routes.json").read_text(encoding="utf-8"))
    stops = json.loads((L.REPO / "web" / "data" / "stops.json").read_text(encoding="utf-8"))
    by_name = {}
    for sid, s in stops.items():
        by_name.setdefault(s["name"], []).append(sid)
    days_all = sorted({e["service_day"] for e in eps} | {r["service_day"] for r in trans})
    d0, d1 = days_all[0], days_all[-1]
    prev = {}
    if Path(a.out).exists():
        prev = {r["flag_id"]: r for r in L.read_csv(a.out)}
    S = {(r["route_id"], r["code"], r["period"]): r for r in summ}
    eps_by = {}
    for e in eps:
        eps_by.setdefault((e["route_id"], e["code"]), []).append(e)
    # 2-to-1 drops per line (the staying-bus metric's events)
    drops21 = Counter((r["route_id"]) for r in trans if r["kind"] == "leave" and r["label"] in L.LASTING and r["buses_after"] == "1")
    drop_days = {}
    for r in trans:
        if r["kind"] == "leave" and r["label"] in L.LASTING and r["buses_after"] == "1":
            drop_days.setdefault(r["route_id"], set()).add(r["service_day"])
    out = []
    for code, (fam, rider, metric, action) in CODES.items():
        for rid in routes:
            le = eps_by.get((rid, code), [])
            if fam in ("rate", "event", "span"):
                s, sa = S.get((rid, code, "all")), S.get(("all", code, "all"))
                if not s or not sa or s["rate_in_window"] in ("", None) or sa["rate_in_window"] in ("", None):
                    continue
                v, b = float(s["rate_in_window"]), float(sa["rate_in_window"])
                ep, days = int(s["episodes"]), int(s["days"])
                bef, aft = S.get((rid, code, "before")), S.get((rid, code, "after"))
                trend = (f"before Nov 6 {bef['rate_in_window'] if bef else 0}, from Nov 6 "
                         f"{aft['rate_in_window'] if aft else 0} ({aft['episodes'] if aft else 0} episodes)")
            elif fam == "share":
                x, xa = base.get(f"{rid}|all", {}), base.get("all|all", {})
                if not x.get("no_pred_share_join") or not x.get("n_arr_join"):
                    continue
                v, b = 100 * x["no_pred_share_join"], 100 * xa["no_pred_share_join"]
                ep = x["n_arr_join"]
                days = len({e["service_day"] for e in eps_by.get((rid, "joining_bus_no_predictions"), [])})
                xb, xf = base.get(f"{rid}|before", {}), base.get(f"{rid}|after", {})
                trend = (f"before Nov 6 {fmt(100 * (xb.get('no_pred_share_join') or 0), 1)}, from Nov 6 "
                         f"{fmt(100 * (xf.get('no_pred_share_join') or 0), 1)} (n {xf.get('n_arr_join', 0)}); "
                         f"this line's other arrivals {fmt(100 * (x.get('no_pred_share_all') or 0), 1)}")
                le = eps_by.get((rid, "joining_bus_no_predictions"), [])
            else:   # ratio: staying bus after a 2-to-1 drop
                x, xa = base.get(f"{rid}|all", {}), base.get("all|all", {})
                if not x.get("pred_mae_min_stay1") or not x.get("pred_mae_min_all"):
                    continue
                v = x["pred_mae_min_stay1"] / x["pred_mae_min_all"]
                b = xa["pred_mae_min_stay1"] / xa["pred_mae_min_all"]
                ep, days = drops21.get(rid, 0), len(drop_days.get(rid, ()))
                trend = (f"staying bus {fmt(x['pred_mae_min_stay1'], 1)} min vs {fmt(x['pred_mae_min_all'], 1)} min at other times, "
                         f"{x['n_pred_stay1']} times from {ep} drops; late by 3 min or more {fmt(100 * (x.get('pred_late_share_stay1') or 0), 1)} "
                         f"vs {fmt(100 * (x.get('pred_late_share_all') or 0), 1)} percent")
                le = [e for e in eps_by.get((rid, "staying_bus_late_after_drop"), []) if e.get("observed") == "1"]
            r = ratio(v, b)
            sev = severity(fam, rider, r, ep, days)
            if sev is None:
                continue
            parts, top = scope_of(le, by_name) if le else ([], None)
            note = trend + (f"; top spot {top[0]} ({top[1]} of {len(le)})" if top else "")
            parts.append("note=" + note.replace(";", ",").replace("=", " "))
            fid = f"transition:{code}:{rid}"
            out.append({"flag_id": fid, "route_id": rid, "route": routes[rid].get("long") or rid, "category": "transition",
                        "flag": code, "severity": sev, "scope": ";".join(parts), "metric": metric,
                        "value": fmt(round(v, 3)), "baseline": fmt(round(b, 3)), "n": str(int(ep)),
                        "data_from": d0, "data_to": d1, "evidence": EVID, "agent_action": action,
                        "first_flagged": prev.get(fid, {}).get("first_flagged") or a.today, "last_checked": a.today,
                        "status": "open" if sev in ("high", "medium") else "watch"})
    rank = {"high": 0, "medium": 1, "low": 2}
    out.sort(key=lambda r: (rank[r["severity"]], r["route"], r["flag"]))
    L.write_csv(a.out, out, COLS)
    print(f"{len(out)} flags: " + ", ".join(f"{k} {v}" for k, v in Counter(r["severity"] for r in out).items()), file=sys.stderr)
    for r in out:
        print(f"{r['severity']:6s} {r['route'][:26]:26s} {r['flag']:30s} {r['value']:>7s} vs {r['baseline']:>7s} n={r['n']:>5s} {r['scope'][:90]}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""E32: display_flags.csv (data/labeled/flags/, shared schema in its README) from measure.py's output.

One row per (flag, line) where the shipped display rules, replayed on the archived days, showed riders something
misleading clearly more often on that line than on all lines together. Values are the SHIPPED rules (`new` in
measure.py) over the whole replayed period; the E32 entry in RouteKnower.md has the before / after tables.

Severity (E32's own rule; README "Severity rules"):
  high    a measure that misleads riders about a time or a recommendation (ghost_times_after_leave,
          false_hide_*_serving_bus, planner_recommends_leaving_bus): value >= 2 x the all-lines value, n >= 300,
          >= 30 events on >= 3 service days, and still there after the rules shipped (from Nov 6: >= 10 events and
          >= 1.5 x that period's all-lines value);
  medium  the same measures at >= 1.5 x with n >= 300 and >= 30 events on >= 3 days (or high's numbers without the
          after-ship confirmation); bus_number_churn and ghost_bus_on_map (no wrong time shown) at >= 2 x with >= 100
          events on >= 3 days (their ceiling);
  low     >= 1.5 x on fewer events (10 to 29) or n < 300, or churn / badges at >= 1.5 x; status watch.
Lines under 1.5 x are not flagged. Each line is graded on the whole replayed period and on the days after the rules
shipped alone (there "still there" holds by definition); the row takes the higher grade and that period's numbers.

  python experiments/routeknower/E32-scripts/flags.py --m <measure.py --out dir> --out data/labeled/flags/display_flags.csv
      [--period all] [--after after] [--today 2026-11-11]
"""
import argparse, csv, json
from collections import Counter
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
COLS = ["flag_id", "route_id", "route", "category", "flag", "severity", "scope", "metric", "value", "baseline", "n",
        "data_from", "data_to", "evidence", "agent_action", "first_flagged", "last_checked", "status"]
EVID = ("experiments/routeknower/E32-scripts/ (measure.py, flags.py); web/tests/fixtures/display_episodes.json; "
        "web/tests/data-display.js; RouteKnower E32")

# flag -> (value key in rates, events key, n key, per-hour tally, vehicle key, rider-misleading, metric, agent action)
FLAGS = {
    "ghost_times_after_leave": ("ghost_time_pct", "ghost_time_min", "time_min", "hour_ghost_time_min", "ghost_time_min", True,
        "percent of bus-minutes with times on display (1 to 30 min ahead) from a bus that then logged no arrival on the "
        "line until 15 min after its last displayed time (shipped rules)",
        "Treat this line's times from a parked or leaving bus as doubtful: models score the minutes after a bus's last "
        "arrival as their own slice; app agents replay E32's fixtures (web/tests/data-display.js) before changing "
        "core/idle.js or core/transition.js, and never hide on this flag alone."),
    "false_hide_offroute_serving_bus": ("false_off_pct", "false_off_min", "hide_off_min", "hour_false_off_min", "false_off_min", True,
        "percent of minutes core/offroute.js hid a bus (and its times) that then logged an arrival on the line within 15 min",
        "Before changing core/offroute.js (or its Kit port) replay E32's fixtures; these buses serve riders from an "
        "off-line loop or layover, so the owner's pending options (learned off-line service runs, the rider's own bus "
        "exempt) would keep their times."),
    "false_hide_gone_serving_bus": ("false_gone_pct", "false_gone_min", "hide_gone_min", "hour_false_gone_min", "false_gone_min", True,
        "percent of minutes core/transition.js GONE dropped a bus's times (no report for 15 min) and the bus then logged "
        "an arrival on the line within 15 min",
        "This line's buses leave the feed for more than 15 min and come back to serve; a GONE change (per-line threshold, "
        "a scheduled departure kept as est.) needs the owner's decision and a replay of E32's gone fixtures."),
    "false_hide_idle_serving_bus": ("false_idle_pct", "false_idle_min", "hide_idle_min", "hour_false_idle_min", "false_idle_min", True,
        "percent of minutes core/idle.js hid a still bus that then logged an arrival on the line within 15 min",
        "Before changing core/idle.js thresholds or idle.json linger spots for this line, replay E32's idle fixtures; the "
        "hidden buses here served again soon after."),
    "planner_recommends_leaving_bus": ("plan_risky_pct", "plan_risky", "plan_live_legs", "hour_plan_risky", "plan_risky", True,
        "percent of the planner's live bus legs (sampled stop pairs every 5 min, core/planner.js plan()) whose bus never "
        "boarded on the line or logged no arrival near the rider's stop (left the line first)",
        "Directions on this line can offer a bus that leaves before the rider's stop and no live signal predicts it (E29, "
        "E32): keep its time labeled live-but-unconfirmed in any new wording, and score planner changes on this slice."),
    "bus_number_churn": ("num_swap_per_10h", "num_swap", None, "hour_num_swap", "num_swap", False,
        "Bus 1 / Bus 2 swaps per 10 service hours (a bus shown in two polls in a row whose number changed)",
        "core/busnum.js renumbers this line whenever a rule hides or shows a bus (off-route toggles); a number hold "
        "through rule toggles is an owner decision; replay E32's number fixture before changing busnum or offroute."),
    "ghost_bus_on_map": ("ghost_badge_pct", "ghost_badge_min", "badge_min", "hour_ghost_badge_min", "ghost_badge_min", False,
        "percent of map-badge minutes from a bus that logged no arrival on its line within 20 min before or after",
        "Buses parked or between shifts stay on this line's map; replay E32's fixtures before changing core/idle.js "
        "(the 80 m still radius restarts on downtown GPS jitter)."),
}


def ranges(hours):
    """Sorted clock hours -> 'a-b' ranges (end exclusive), '|'-joined."""
    hs = sorted(set(hours))
    out, i = [], 0
    while i < len(hs):
        j = i
        while j + 1 < len(hs) and hs[j + 1] == hs[j] + 1:
            j += 1
        out.append(f"{hs[i]:02d}-{(hs[j] + 1) % 24 if hs[j] + 1 != 24 else 24:02d}")
        i = j + 1
    return "|".join(out)


def scope_of(flag, rid, lines, veh, epi):
    vkey, hkey = FLAGS[flag][4], FLAGS[flag][3]
    parts = []
    hist = {int(k): v for k, v in (lines[rid]["new"].get(hkey) or {}).items()}
    tot = sum(hist.values())
    if tot >= 10:
        top = [h for h, n in sorted(hist.items(), key=lambda kv: -kv[1]) if n >= 0.08 * tot]
        cov = sum(hist[h] for h in top) / tot
        if cov >= 0.6 and len(top) <= 8:
            parts.append("hours=" + ranges(top))
    vs = Counter({v: n for (r, v), n in veh.items() if r == rid and n})
    vt = sum(vs.values())
    if vt:
        top, acc = [], 0
        for v, n in vs.most_common(4):
            if n < 0.15 * vt:
                break
            top.append(v)
            acc += n
            if acc >= 0.6 * vt:
                break
        if top and vs.most_common(1)[0][1] >= 0.25 * vt:
            parts.append("vehicles=" + "|".join(top))
    if flag.startswith("false_hide_"):
        rule = flag.split("_")[2].replace("offroute", "off")
        near = Counter(e["near_stop"] for e in epi if e["route_id"] == rid and e["kind"] == "false_" + rule and e.get("near_stop"))
        nt = sum(near.values())
        top = [s for s, n in near.most_common(3) if n >= 0.25 * nt and n >= 3]
        if top:
            parts.append("stops=" + "|".join(top))
    return ";".join(parts)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--m", required=True, help="measure.py --out folder (summary.json, rates.json, vehicles.csv, episodes.csv)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--period", default="all")
    ap.add_argument("--after", default="after")
    ap.add_argument("--today", default=date.today().isoformat())
    a = ap.parse_args(argv)
    M = Path(a.m)
    S = json.loads((M / "summary.json").read_text(encoding="utf-8"))
    T = json.loads((M / "rates.json").read_text(encoding="utf-8"))
    routes = json.loads((REPO / "web" / "data" / "routes.json").read_text(encoding="utf-8"))
    P, PA = T[a.period], T.get(a.after)
    lines = S["periods"][a.period]["lines"]
    days = P["days"]
    day_periods = {k: v for k, v in S["periods"].items() if len(k) == 10 and k[4] == "-" and k in days}
    epi = [e for e in csv.DictReader(open(M / "episodes.csv", encoding="utf-8")) if e["period"] == a.period]
    vrows = [r for r in csv.DictReader(open(M / "vehicles.csv", encoding="utf-8")) if r["period"] == a.period and r["app"] == "new"]
    old = {}
    prev = Path(a.out)
    if prev.exists():
        old = {r["flag_id"]: r for r in csv.DictReader(open(prev, encoding="utf-8"))}
    out = []
    after_days = set(PA["days"]) if PA else set()

    def grade(val, base, nn, ev, nd, misleading, still):
        if val is None or not base or val < 1.5 * base:
            return None
        ratio = val / base
        if misleading:
            if ratio >= 2 and nn >= 300 and ev >= 30 and nd >= 3 and still:
                return "high"
            if nn >= 300 and ev >= 30 and nd >= 3:
                return "medium"
            return "low" if ev >= 10 else None
        if ratio >= 2 and ev >= 100 and nd >= 3:
            return "medium"
        return "low" if ev >= 10 else None

    rank = {None: 9, "high": 0, "medium": 1, "low": 2}
    for flag, (vk, ek, nk, hk, vehk, misleading, metric, action) in FLAGS.items():
        veh = {(r["route_id"], r["vehicle_id"]): int(float(r.get(vehk) or 0)) for r in vrows}
        for rid in sorted(P["lines"]):
            cands = []
            for per, PP, dset in ((a.period, P, set(days)), (a.after, PA, after_days)):
                if not PP or rid not in PP["lines"]:
                    continue
                n, base = PP["lines"][rid]["new"], PP["all"]["new"][vk]
                val, ev = n[vk], n.get(ek, 0) or 0
                nn = n[nk] if nk else int(round(n["service_h"] * 60))
                nd = sum(1 for d, D in day_periods.items() if d in dset and (D["lines"].get(rid, {}).get("new", {}).get(ek, 0) or 0) > 0)
                if per == a.period:
                    aft = PA["lines"].get(rid, {}).get("new", {}) if PA else {}
                    ba = PA["all"]["new"][vk] if PA else None
                    still = bool(aft and ba and aft.get(vk) is not None and (aft.get(ek, 0) or 0) >= 10 and aft[vk] >= 1.5 * ba)
                else:
                    still = True
                sev = grade(val, base, nn, ev, nd, misleading, still)
                cands.append((rank[sev], per, PP, sev, val, base, nn, ev))
            cands = [c for c in cands if c[3]]
            if not cands:
                continue
            _, per, PP, sev, val, base, nn, ev = min(cands, key=lambda c: (c[0], c[1] != a.period))
            scope = scope_of(flag, rid, lines, veh, epi)
            if PA and rid in PA["lines"]:
                aft, ba = PA["lines"][rid]["new"], PA["all"]["new"][vk]
                other = (f"after the rules shipped ({PA['days'][0]} to {PA['days'][-1]}): {aft.get(vk)} vs all lines {ba}, "
                         f"{aft.get(ek, 0) or 0} events") if per == a.period else (
                         f"{days[0]} to {days[-1]}: {P['lines'][rid]['new'].get(vk)} vs all lines {P['all']['new'][vk]}")
            else:
                other = "no data after the rules shipped"
            scope = (scope + ";" if scope else "") + "note=" + other
            fid = f"display:{flag}:{rid}"
            r = routes.get(rid) or {}
            out.append({"flag_id": fid, "route_id": rid, "route": r.get("long") or r.get("short") or rid,
                        "category": "display", "flag": flag, "severity": sev, "scope": scope, "metric": metric,
                        "value": f"{val}", "baseline": f"{base}", "n": str(int(nn)), "data_from": PP["days"][0],
                        "data_to": PP["days"][-1], "evidence": EVID, "agent_action": action,
                        "first_flagged": old.get(fid, {}).get("first_flagged") or a.today, "last_checked": a.today,
                        "status": "open" if sev in ("high", "medium") else "watch"})
    sev_order = {"high": 0, "medium": 1, "low": 2}
    out.sort(key=lambda r: (sev_order[r["severity"]], r["flag"], r["route_id"]))
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, COLS, lineterminator="\n")
        w.writeheader()
        w.writerows(out)
    for r in out:
        print(r["severity"], r["flag"], r["route"], r["value"], "vs", r["baseline"], "n", r["n"], "|", r["scope"][:120])


if __name__ == "__main__":
    main()

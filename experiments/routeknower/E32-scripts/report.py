#!/usr/bin/env python3
"""E32: per-line tables from measure.py's summary.json (markdown, for RouteKnower.md E32) and the rates flags.py reads.

  python experiments/routeknower/E32-scripts/report.py --summary <dir>/summary.json [--json rates.json]
"""
import argparse, json
from pathlib import Path

ROUTES = json.loads((Path(__file__).resolve().parents[3] / "web" / "data" / "routes.json").read_text(encoding="utf-8"))


def name(rid):
    r = ROUTES.get(rid) or {}
    return r.get("long") or r.get("short") or rid


def rates(c, svc):
    g = lambda k: c.get(k, 0)
    div = lambda a, b: round(100 * a / b, 1) if b else None
    hide = sum(g(f"hide_{r}_min") for r in ("off", "idle", "gone"))
    false = sum(g(f"false_{r}_min") for r in ("off", "idle", "gone"))
    return {
        "service_h": round(svc / 60, 1),
        "ghost_time_pct": div(g("ghost_time_min"), g("time_min")), "ghost_time_min": g("ghost_time_min"), "time_min": g("time_min"),
        "ghost_next_pct": div(g("ghost_next_min"), g("next_min")), "next_min": g("next_min"),
        "ghost_badge_pct": div(g("ghost_badge_min"), g("badge_min")), "ghost_badge_min": g("ghost_badge_min"), "badge_min": g("badge_min"),
        "leaves": g("leaves"), "leave_shown_avg": round(g("leave_shown_min") / g("leaves"), 1) if g("leaves") else None,
        "leaves_shown_15_pct": div(g("leaves_shown_15"), g("leaves")), "leave_shown_min": g("leave_shown_min"),
        "hide_min": hide, "false_hide_min": false, "false_hide_pct": div(false, hide),
        **{f"false_{r}_pct": div(g(f"false_{r}_min"), g(f"hide_{r}_min")) for r in ("off", "idle", "gone")},
        **{f"hide_{r}_min": g(f"hide_{r}_min") for r in ("off", "idle", "gone")},
        **{f"false_{r}_min": g(f"false_{r}_min") for r in ("off", "idle", "gone")},
        **{f"false_{r}_episodes": g(f"false_{r}_episodes") for r in ("off", "idle", "gone")},
        **{f"hide_{r}_episodes": g(f"hide_{r}_episodes") for r in ("off", "idle", "gone")},
        "plan_live_legs": g("plan_live_legs"), "plan_risky_pct": div(g("plan_risky"), g("plan_live_legs")),
        "plan_risky": g("plan_risky"), "plan_ghost_board": g("plan_ghost_board"), "plan_left": g("plan_left_before_alight"),
        "plan_top_legs": g("plan_top_live_legs"), "plan_top_risky_pct": div(g("plan_top_risky"), g("plan_top_live_legs")),
        "plan_top_risky": g("plan_top_risky"),
        "num_swap": g("num_swap"), "num_flip": g("num_flip"), "num_swap_per_10h": round(10 * g("num_swap") / (svc / 60), 2) if svc else None,
        "unjudged_sparse_min": g("unjudged_sparse_time_min") + g("unjudged_sparse_badge_min"),
        "unseen_time_min": g("unseen_time_min"), "plan_unseen": g("plan_unseen"),
        "reshown_time_min": g("reshown_time_min"), "reshown_per_10h": round(10 * g("reshown_time_min") / (svc / 60), 2) if svc else None,
        "rolling_min": g("rolling_min"), "rolling_ghost_min": g("rolling_ghost_min"),
    }


def tables(S):
    out = {}
    for per, P in S["periods"].items():
        out[per] = {"days": P["days"], "lines": {}, "all": {}}
        tot = {"new": {}, "old": {}}
        svc_all = 0
        for rid, L in P["lines"].items():
            svc = L.get("service_min", 0)
            svc_all += svc
            out[per]["lines"][rid] = {app: rates(L.get(app, {}), svc) for app in ("new", "old")}
            for app in ("new", "old"):
                for k, v in L.get(app, {}).items():
                    if isinstance(v, dict):
                        d = tot[app].setdefault(k, {})
                        for h, n in v.items():
                            d[h] = d.get(h, 0) + n
                    else:
                        tot[app][k] = tot[app].get(k, 0) + v
        out[per]["all"] = {app: rates(tot[app], svc_all) for app in ("new", "old")}
    return out


def fmt(v):
    return "" if v is None else str(v)


def markdown(T):
    lines = []
    for per, P in T.items():
        if len(per) == 10 and per[4] == "-":   # one-day periods (flags.py counts days with them)
            continue
        lines.append(f"\n{per}: {P['days'][0]} to {P['days'][-1]} ({len(P['days'])} days). new = shipped rules, old = before them.\n")
        lines.append("| Line | service h | ghost times % new / old | ghost next bus % new / old | ghost badges % new / old "
                     "| leaves | shown after leave, avg min new / old | false hides % (min) | risky plans % new / old (top) "
                     "| number swaps per 10 h new / old |")
        lines.append("|---|---|---|---|---|---|---|---|---|---|")
        rows = sorted(P["lines"].items(), key=lambda kv: -(kv[1]["new"]["service_h"] or 0))
        for rid, R in rows + [("all", P["all"])]:
            n, o = R["new"], R["old"]
            if not n["service_h"]:
                continue
            lines.append(f"| {name(rid) if rid != 'all' else '**all lines**'} | {n['service_h']} | {fmt(n['ghost_time_pct'])} / {fmt(o['ghost_time_pct'])} "
                         f"| {fmt(n['ghost_next_pct'])} / {fmt(o['ghost_next_pct'])} | {fmt(n['ghost_badge_pct'])} / {fmt(o['ghost_badge_pct'])} "
                         f"| {n['leaves']} | {fmt(n['leave_shown_avg'])} / {fmt(o['leave_shown_avg'])} "
                         f"| {fmt(n['false_hide_pct'])} ({n['false_hide_min']} of {n['hide_min']}) "
                         f"| {fmt(n['plan_risky_pct'])} / {fmt(o['plan_risky_pct'])} ({fmt(n['plan_top_risky_pct'])} / {fmt(o['plan_top_risky_pct'])}) "
                         f"| {fmt(n['num_swap_per_10h'])} / {fmt(o['num_swap_per_10h'])} |")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--summary", required=True)
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    T = tables(json.loads(Path(a.summary).read_text(encoding="utf-8")))
    print(markdown(T))
    if a.json:
        Path(a.json).write_text(json.dumps(T, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()

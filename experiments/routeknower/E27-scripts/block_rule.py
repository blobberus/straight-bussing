#!/usr/bin/env python3
"""E27b (2026-11-06): the "more than a block" off-route rule. Owner: "If a bus is off it's route for more than a block,
make the bus disappear from the map (so it does not confuse viewers of the route) as it is most likely not running
anymore--still continue to track the bus."

Reads the per-report table offroute.py --cache wrote (fresh reports of buses on known routes: distance to the bus's
OWN route line `d`, to any line `da`, seconds outside the listed hours `gap`, Passio still predicting the bus `pred`,
an operator detour alert `alert`) and replays candidate rules report by report, as a phone would see them:

  FAR      the report is more than D m from its OWN route's line (shapes.json, the drawn line)
  HIDDEN   FAR on at least N_MIN reports in a row (same route, no report gap over GAP_S) spanning at least CONFIRM_S,
           unless an operator alert names its route (or names none and reads like a detour) inside its listed hours
           padded 30 min (the old rule's exemption, kept for rider safety). Back within D m = shown at once.

For each rule: bus-minutes hidden (reports already hidden by core/operating.js, outside the hours with no live
prediction, are left out), by episode class (offroute_rules.classify: mid = in service on both sides, pullout, pullin,
break, none), hidden while serving (a logged arrival on its route within 2 min), hidden in the 10 min before the bus
logged its next arrival on its route (came back to serve), hidden while Passio predicted the bus and the bus then logged
an arrival within 10 min (a prediction honored), short hides (hidden, then shown again within 5 min: a blink), single
report spikes, and the minutes the new rule hides that the old rule (core/offroute.js before 2026-11-06) kept visible,
by the old rule's reason (on another route's line, under its 15 / 5 min clock, following on another street, heading
back, the detour alert). Places: 150 m cells of hidden time inside the listed hours, with the route's closest stop.

  python experiments/routeknower/E27-scripts/block_rule.py --cache reports.pkl --dl <gtfs dir> --arrivals arrivals.csv
      [--out block.json]
"""
import argparse, json, math, pickle, sys, tempfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import offroute as O   # noqa: E402
import offroute_rules as OR   # noqa: E402

GAP_S = 600
PAD_S = 1800
OLD = dict(off=300, hide_in=900, hide_out=300, follow=1500, ret=1000)


def old_rule_flags(reps):
    """The old core/offroute.js answer per report of one bus's run (list of reports in time order): hidden or the
    reason it was shown. Needs px/py (closest point of the own line, offroute_rules) for 'following'."""
    out = []
    st = None
    for r in reps:
        far = r["d"] > OLD["off"] and r["da"] > OLD["off"]
        if not far:
            out.append("near" if r["d"] <= OLD["off"] else "other_line")
            st = None
            continue
        cont = st is not None and st["rid"] == r["rid"] and r["t"] - st["last"] <= GAP_S
        if not cont:
            st = {"rid": r["rid"], "since": r["t"], "dmax": 0.0, "box": None}
        st["last"] = r["t"]
        st["dmax"] = max(st["dmax"], r["d"])
        if "px" in r:
            b = st["box"]
            st["box"] = [r["px"], r["px"], r["py"], r["py"]] if b is None else [min(b[0], r["px"]), max(b[1], r["px"]), min(b[2], r["py"]), max(b[3], r["py"])]
        inside = r["gap"] <= PAD_S
        if r["t"] - st["since"] < (OLD["hide_in"] if inside else OLD["hide_out"]):
            out.append("clock")
            continue
        b = st["box"]
        if b and math.hypot(b[1] - b[0], b[3] - b[2]) >= OLD["follow"]:
            out.append("following")
            continue
        if r["d"] <= st["dmax"] - OLD["ret"]:
            out.append("returning")
            continue
        if inside and r["alert"]:
            out.append("alert")
            continue
        out.append("hidden")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--dl", required=True)
    ap.add_argument("--arrivals", required=True)
    ap.add_argument("--out")
    ap.add_argument("--chosen", default="250,2,45", help="D,N_MIN,CONFIRM_S of the rule to describe in full")
    ap.add_argument("--only-chosen", action="store_true", help="skip the grid")
    a = ap.parse_args(argv)
    allrep, stats, stop_offs, days = pickle.loads(Path(a.cache).read_bytes())
    allrep.sort(key=lambda r: (r["veh"], r["t"]))
    arr = O.load_arrivals(a.arrivals)
    cache = Path(tempfile.gettempdir()) / "sb-e27-static"
    statics = {}

    def static(day):
        if day not in statics:
            statics[day] = O.build_static(O.zip_for(a.dl, day) or O.zip_for(a.dl, days[0]), cache)
        return statics[day]

    # closest point of the own line (old rule's "following"; places)
    by = defaultdict(list)
    for i, r in enumerate(allrep):
        if r["d"] > 140:
            by[(OR.service_day(r["t"]), r["rid"])].append(i)
    for (day, rid), idx in by.items():
        segs = static(day)["segs"].get(rid)
        if segs is None:
            continue
        P = O.xy([allrep[i]["lat"] for i in idx], [allrep[i]["lon"] for i in idx])
        pr = OR.project(P, segs)
        for j, i in enumerate(idx):
            allrep[i]["px"], allrep[i]["py"] = float(pr[j, 1]), float(pr[j, 2])
    steps = O.step_s(allrep)
    for r, s in zip(allrep, steps):
        r["step"] = s
    # runs per bus (route change or gap breaks a run): the old rule per run
    old = [None] * len(allrep)
    i = 0
    while i < len(allrep):
        j = i + 1
        while j < len(allrep) and allrep[j]["veh"] == allrep[i]["veh"] and allrep[j]["rid"] == allrep[i]["rid"] and allrep[j]["t"] - allrep[j - 1]["t"] <= GAP_S:
            j += 1
        for k, f in enumerate(old_rule_flags(allrep[i:j])):
            old[i + k] = f
        i = j
    shown_rep = [not (r["gap"] > 0 and not r["pred"]) for r in allrep]    # core/operating.js already hides the rest
    tot_shown_in = sum(r["step"] for r, s in zip(allrep, shown_rep) if s and r["gap"] <= PAD_S) / 60

    # next arrival on the route after each report (came back / prediction honored)
    def next_arrival(r, within):
        x = O.arrivals_between(arr, r["veh"], r["rid"], r["t"] + 1, r["t"] + within)
        return x[0] if x else None

    out = {"days": [days[0], days[-1], len(days)], "reports": len(allrep), "bus_min_shown_inside_padded": round(tot_shown_in)}
    old_hidden = sum(r["step"] for r, s, f in zip(allrep, shown_rep, old) if s and f == "hidden") / 60
    out["old_rule_hidden_bus_min"] = round(old_hidden, 1)

    def replay(D, nmin, confirm, describe=False):
        res = Counter()
        cells = Counter()
        cell_info = {}
        by_route = defaultdict(Counter)
        hides = []           # (veh, rid, start, end, cls)
        eps = O.episodes(allrep, D)
        cls_of = {}
        for e in eps:
            c = OR.classify(e, arr)
            for r in e["rows"]:
                cls_of[id(r)] = c
        prev = None
        run = None           # current far run: since, n
        hid_since = None
        for idx, r in enumerate(allrep):
            if prev is None or prev["veh"] != r["veh"] or prev["rid"] != r["rid"] or r["t"] - prev["t"] > GAP_S:
                if hid_since is not None:
                    hides.append((prev["veh"], prev["rid"], hid_since, prev["t"], cls_of.get(id(prev), "?")))
                run, hid_since = None, None
            prev = r
            far = r["d"] > D
            if not far:
                if hid_since is not None:
                    hides.append((r["veh"], r["rid"], hid_since, r["t"], cls_of.get(id(allrep[idx - 1]), "?")))
                    hid_since = None
                run = None
                continue
            if run is None:
                run = {"since": r["t"], "n": 0}
                if r["d"] > D and (idx + 1 >= len(allrep) or allrep[idx + 1]["veh"] != r["veh"] or allrep[idx + 1]["d"] <= D):
                    res["spikes_1_report"] += 1
            run["n"] += 1
            inside = r["gap"] <= PAD_S
            hide = run["n"] >= nmin and r["t"] - run["since"] >= confirm and not (inside and r["alert"])
            if not shown_rep[idx]:
                continue                      # core/operating.js already hides it
            s = r["step"]
            cls = cls_of.get(id(r), "?")
            if inside and r["alert"] and run["n"] >= nmin and r["t"] - run["since"] >= confirm:
                res["kept_by_alert_s"] += s
            if not hide:
                continue
            if hid_since is None:
                hid_since = r["t"]
            res["hidden_s"] += s
            res["hidden_" + cls + "_s"] += s
            if r["gap"] <= PAD_S:
                res["hidden_inside_s"] += s
            if O.arrivals_between(arr, r["veh"], r["rid"], r["t"] - 120, r["t"] + 120):
                res["hidden_serving_2min_s"] += s
            nx = next_arrival(r, 600)
            if nx:
                res["hidden_10min_before_next_arrival_s"] += s
                if r["pred"]:
                    res["hidden_pred_honored_10min_s"] += s
            if r["pred"]:
                res["hidden_while_passio_predicts_s"] += s
            f = old[idx]
            if f != "hidden":
                res["new_vs_old_" + f + "_s"] += s
                if cls == "mid":
                    res["new_vs_old_mid_" + f + "_s"] += s
            if describe:
                by_route[r["rid"]]["hidden"] += s
                by_route[r["rid"]][cls] += s
                if f != "hidden":
                    by_route[r["rid"]]["old_" + f] += s
            if describe and r["gap"] <= PAD_S:
                k = (round(r["lat"] / 0.00135), round(r["lon"] / 0.0018))
                cells[k] += s
                ci = cell_info.setdefault(k, {"rids": Counter(), "cls": Counter(), "lat": r["lat"], "lon": r["lon"]})
                ci["rids"][r["rid"]] += s
                ci["cls"][cls] += s
        if hid_since is not None and prev is not None:
            hides.append((prev["veh"], prev["rid"], hid_since, prev["t"], cls_of.get(id(prev), "?")))
        # blinks: a hide that ended (back within D) and lasted under 5 min, inside the hours
        short = [h for h in hides if h[3] - h[2] < 300]
        res["hides"] = len(hides)
        res["short_hides_lt5min"] = len(short)
        res["short_hides_lt5min_mid"] = sum(1 for h in short if h[4] == "mid")
        row = {"D": D, "n_min": nmin, "confirm_s": confirm,
               **{k[:-2] + "_bus_min" if k.endswith("_s") else k: (round(v / 60, 1) if k.endswith("_s") else v) for k, v in sorted(res.items())}}
        if describe:
            st = static(days[-1])
            places = []
            for k, v in cells.most_common(30):
                ci = cell_info[k]
                rid = ci["rids"].most_common(1)[0][0]
                best = None
                for sid in st["route_stops"].get(rid, []):
                    s0 = st["stops"].get(sid)
                    if not s0:
                        continue
                    dd = math.hypot((s0["lat"] - ci["lat"]) * 111000, (s0["lon"] - ci["lon"]) * 83000)
                    if best is None or dd < best[0]:
                        best = (dd, s0["name"])
                places.append({"lat": round(k[0] * 0.00135, 4), "lon": round(k[1] * 0.0018, 4), "bus_min": round(v / 60, 1),
                               "routes": {st["routes"].get(x, {}).get("short", x): round(y / 60, 1) for x, y in ci["rids"].most_common(3)},
                               "classes": {x: round(y / 60, 1) for x, y in ci["cls"].most_common()},
                               "near_stop": best and f"{best[1]} ({round(best[0])} m)"})
            row["places_inside_hours"] = places
            mids = sorted([h for h in hides if h[4] == "mid"], key=lambda h: -(h[3] - h[2]))
            row["mid_hides_longest"] = [{"veh": h[0], "rid": st["routes"].get(h[1], {}).get("short", h[1]), "from": O.fmt_t(h[2]),
                                         "min": round((h[3] - h[2]) / 60, 1)} for h in mids[:25]]
            dur = [(h[3] - h[2]) / 60 for h in hides]
            row["hide_minutes_p50_p90_max"] = [round(float(np.percentile(dur, p)), 1) for p in (50, 90, 100)] if dur else None
            per_day = Counter(OR.service_day(h[2]) for h in short)
            row["short_hides_per_day_p50_max"] = [float(np.median(list(per_day.values()))) if per_day else 0, max(per_day.values()) if per_day else 0]
            row["by_route"] = {st["routes"].get(x, {}).get("short") or st["routes"].get(x, {}).get("long") or x:
                               {k: round(v / 60, 1) for k, v in c.most_common()} for x, c in sorted(by_route.items(), key=lambda kv: -kv[1]["hidden"])}
            row["dc022"] = [{"veh": h[0], "rid": st["routes"].get(h[1], {}).get("short", h[1]), "from": O.fmt_t(h[2]), "to": O.fmt_t(h[3])}
                            for h in hides if h[0] in ("4313", "4325", "4327") and OR.DC022[0] <= h[2] <= OR.DC022[1]]
        return row

    out["rules"] = []
    for D in () if a.only_chosen else (150, 200, 225, 250, 300):
        for nmin, confirm in ((1, 0), (2, 0), (2, 30), (2, 45), (2, 60)):
            out["rules"].append(replay(D, nmin, confirm))
            print("rule", D, nmin, confirm, file=sys.stderr)
    cD, cn, cc = (int(x) for x in a.chosen.split(","))
    out["chosen"] = replay(cD, cn, cc, describe=True)
    txt = json.dumps(out, indent=1)
    if a.out:
        Path(a.out).write_text(txt, encoding="utf-8")
    print(txt)


if __name__ == "__main__":
    main()

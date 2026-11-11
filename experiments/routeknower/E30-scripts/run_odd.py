#!/usr/bin/env python3
"""E30 (2026-11-11): odd bus behavior at TRANSITION times, per line, bus, spot and hour; Oct 10 to Nov 5 against the
days after the display rules shipped (Nov 6 on). Owner: "The analysis should check for buses that have odd behavior
during transition times ... Flag these lines and also tell me."

Runs every detector of odd_feed.py, odd_labels.py, odd_passio.py, odd_schedule.py and odd_dwell.py on each service day,
tags each episode with the transition window it falls in (odd_lib.build_windows: 30 min around a bus count change, a
shift change, a listed start or end, a timetable step; blank = outside every window), names its spot like E29, and
keeps the day's denominators (bus-hours inside / outside the windows, events, spans, prediction rows, arrivals). Each
day is saved to --work as it finishes (a restart skips the days already there). Then:
  <out>/odd_episodes.csv  one row per odd episode (data/labeled/transitions/README.md "Odd behavior (E30)")
  <out>/odd_summary.csv   per line (all lines too) and per bus, code and period: episodes, minutes, rate inside and
                          outside the windows (or per 100 events / spans), top spot and hour, days
  --json                  the headline numbers (flags.py reads it to write data/labeled/flags/transition_flags.csv)

  python experiments/routeknower/E30-scripts/run_odd.py --dl <E28 fetch.py folder> --e28 <endofservice.py --out folder>
      --transitions data/labeled/transitions/transitions.csv --out data/labeled/transitions --work <scratch dir>
      [--days 2026-11-09 ...] [--predictions <dl>/predictions*.csv] [--json e30.json]
"""
import argparse, glob, json, pickle, statistics, sys, tempfile
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import odd_lib as L          # noqa: E402
import odd_feed as F         # noqa: E402
import odd_labels as LB      # noqa: E402
import odd_passio as P       # noqa: E402
import odd_schedule as S     # noqa: E402
import odd_dwell as D        # noqa: E402

O, T = L.O, L.T

EP_COLS = ["episode_id", "service_day", "period", "dow", "local_time", "end_time", "hour", "route_id", "route",
           "vehicle_id", "code", "spot", "spot_lat", "spot_lon", "duration_min", "window_kind", "window_ref",
           "window_offset_min", "window_own_bus", "outcome", "passio_showed", "other_route", "other_vehicle", "max_dist_m",
           "stops_affected", "arrivals_during", "pred_visible", "median_err_min", "max_late_min", "relabel_min",
           "beyond_gone_min", "expected", "observed", "event_ref", "evidence"]
# how a code's rate is measured: 'bus_hours' = per 10 bus-hours inside vs outside the windows; otherwise per 100 of
# the named denominator (event-anchored codes are inside a window by construction)
UNIT = {"feed_drop_mid_route": "bus_hours", "sparse_reporting": "bus_hours", "frozen_gps": "bus_hours", "stale_position": "bus_hours",
        "position_jump": "bus_hours", "twin_buses": "bus_hours", "after_hours": "bus_hours",
        "wrong_line_label": "bus_hours", "label_flipflop": "bus_hours", "linger_not_in_service": "bus_hours",
        "off_route_drive": "bus_hours",
        "ghost_predictions_after_leave": "lasting_leaves", "staying_bus_late_after_drop": "lasting_leaves",
        "unscheduled_leave": "lasting_leaves", "joining_bus_no_predictions": "real_adds",
        "bunching_after_add": "real_adds", "extra_bus_added": "real_adds",
        "timetable_drop_missed": "steps_down", "timetable_add_missed": "steps_up",
        "service_start_late": "spans", "service_start_missing": "spans", "service_end_early": "spans",
        "night_feed_silent": "spans"}
CODES = list(UNIT)


def passio_text(e):
    c = e["code"]
    if c == "ghost_predictions_after_leave":
        return f"kept a time for it {e['duration_min']} min after it left; {e.get('stops_affected', 0)} stops never served"
    if c == "joining_bus_no_predictions":
        return ("no time for it while it served " + str(e.get("stops_affected", "")) + " stops"
                + ("" if e["outcome"] == "predicted_later" else " (none in 60 min)"))
    if c == "staying_bus_late_after_drop":
        return f"times for the staying bus a median {abs(e['median_err_min'])} min early (bus later), worst {e['max_late_min']} min"
    if c in ("feed_drop_mid_route", "sparse_reporting"):
        s = e.get("stops_affected")
        return f"times for {s} stops 7 min into the gap" if s else ("no time for it" if s == 0 else "")
    if c in ("after_hours", "off_route_drive", "linger_not_in_service", "joining_bus_no_predictions"):
        return {"y": "predicted it", "n": "no time for it"}.get(e.get("pred_visible", ""), "")
    if c == "wrong_line_label":
        return f"labeled {e.get('route_name', e['route_id'])} while it drove {e.get('other_name', e.get('other_route', ''))}"
    return ""


def evidence_text(e, names):
    c, o = e["code"], e.get("outcome", "")
    nm = lambda r: names.get(r, r)
    bits = {
        "feed_drop_mid_route": f"no report for {e['duration_min']} min while moving on its line; {o}"
                               + (f" {e['max_dist_m']} m away" if e.get("max_dist_m") not in ("", None) else "")
                               + (f" as {nm(e['other_route'])}" if e.get("other_route") else ""),
        "sparse_reporting": f"{e.get('gaps', 1)} report gaps of 5 min or more in {e['duration_min']} min (reports "
                            f"{e.get('prev_gap_s', '')} s apart before); {o}",
        "frozen_gps": f"{e.get('reports', '')} reports at one point for {e['duration_min']} min; {o}",
        "stale_position": f"listed with a report up to {e.get('max_age_s', '')} s old for {e['duration_min']} min",
        "position_jump": f"{e.get('jumps', 1)} jumps, the largest {e.get('max_dist_m', '')} m in one report "
                         f"({e.get('speed_mps', '')} m/s), {e.get('net_m', '')} m net; {o}",
        "twin_buses": f"with bus {e.get('other_vehicle', '')} within 25 m for {e['duration_min']} min; {o}",
        "after_hours": f"{e.get('outside_min', '')} min {e.get('side', '')} the listed hours; {e.get('arrivals_during', 0)} arrivals; {o}",
        "wrong_line_label": f"drove {nm(e.get('other_route', ''))} for {e['duration_min']} min under this label; "
                            + (f"relabeled after {e['relabel_min']} min" if e.get("relabel_min") not in ("", None) else "never relabeled")
                            + f"; {e.get('arrivals_during', 0)} visits filed under the label",
        "label_flipflop": f"label went to {nm(e.get('other_route', ''))} and back within {e['duration_min']} min",
        "linger_not_in_service": f"still {e['duration_min']} min at {e.get('spot_name', '')}, E28 {o}",
        "off_route_drive": f"up to {e.get('max_dist_m', '')} m off its line for {e['duration_min']} min; {o}",
        "ghost_predictions_after_leave": f"E29 {e.get('event_ref', '')} {o}; {e.get('beyond_gone_min', 0)} min past the 15-min GONE rule",
        "joining_bus_no_predictions": f"E29 {e.get('event_ref', '')}; served {e.get('stops_affected', '')} stops in {e['duration_min']} min before a Passio time",
        "staying_bus_late_after_drop": f"after E29 {e.get('event_ref', '')} ({o} of {e.get('other_vehicle', '')}); "
                                       f"{e.get('late_rows', '')} of {e.get('pred_rows', '')} times 10-20 min ahead >= 3 min late",
        "bunching_after_add": f"E29 {e.get('event_ref', '')}; {e.get('arrivals_during', '')} visits within 2 min of bus {e.get('other_vehicle', '')}",
        "unscheduled_leave": f"E29 {e.get('event_ref', '')} {o}; line at {e.get('observed', '')} buses, timetable {e.get('expected', '')}",
        "extra_bus_added": f"E29 {e.get('event_ref', '')} {o}; line at {e.get('observed', '')} buses, timetable {e.get('expected', '')}",
        "timetable_drop_missed": f"timetable {o}",
        "timetable_add_missed": f"timetable {o}",
        "service_start_late": f"listed from {L.ct(e['start'], '%H:%M')}; {o}",
        "service_start_missing": f"listed from {L.ct(e['start'], '%H:%M')}; {o}",
        "service_end_early": o, "night_feed_silent": o}
    return bits.get(c, o)


# ---------------------------------------------------------------- one day
def run_day(day, a, trans_by_day, arr, preds_csv, static_cache, line_cache, spots, corridors, marks):
    zp = O.zip_for(a.dl, day)
    st = O.build_static(zp, static_cache)
    names = {rid: (r.get("long") or r.get("short") or rid) for rid, r in st["routes"].items()}
    routes = set(st["routes"])
    if st["version"] not in line_cache:
        line_cache[st["version"]] = L.LineIndex(st["shapes"])
    lidx = line_cache[st["version"]]
    polls = L.DayPolls(Path(a.dl) / f"raw-polls-{day}.jsonl.gz")
    preds = T.load_preds(a.dl, [day])
    routes_of = T.trip_routes(zp)
    spans = L.listed_spans(st["service"], day)
    spans3 = O.spans_for(st["service"], day)
    steps = L.timetable_steps(st["service"], day, spans)
    tr = trans_by_day.get(day, [])
    W = L.build_windows(day, tr, spans, steps)
    widx = L.WindowIndex(W)
    t0, t1 = L.day_bounds(day)
    bc = S.BusCount(polls, routes)
    eps = []
    eps += F.feed_drops(day, polls, routes, lidx, spots, preds, routes_of, t1)
    eps += F.frozen_gps(day, polls, routes)
    eps += F.stale_positions(day, polls, routes)
    eps += F.position_jumps(day, polls, routes)
    eps += F.twin_buses(day, polls, routes)
    eps += F.after_hours(day, polls, routes, spans3, arr, preds, routes_of)
    eps += LB.wrong_line(day, polls, lidx, routes, arr)
    eps += LB.flipflops(day, polls, routes)
    eps += P.ghost_predictions(day, tr)
    eps += P.joining_no_predictions(day, tr, arr, preds, routes_of)
    stay_eps, stay_rows = P.staying_late(day, tr, polls, preds_csv)
    eps += stay_eps
    rarr = P.route_arrivals(arr, t0, t1)
    eps += P.bunching_after_add(day, tr, rarr)
    eps += S.step_mismatches(day, steps, bc, tr)
    eps += S.unscheduled(day, tr, bc, st["service"])
    eps += S.start_end(day, spans, bc)
    eps += D.lingers(day, a.e28)
    dists = D.own_dist(polls, st, corridors)
    eps += D.off_route(day, polls, st, spans3, arr, dists, preds, routes_of)
    namer = T.Namer(st["stops"], marks)
    for e in eps:
        e["route_id"] = str(e["route_id"])
        w = widx.at(e["route_id"], e["start"], e["end"])
        e["window_kind"] = w["kind"] if w else ""
        e["window_ref"] = w["ref"] if w else ""
        e["window_offset_min"] = round((e["start"] - w["t"]) / 60, 1) if w else ""
        own = set(str(e["vehicle_id"]).split(";"))
        e["window_own_bus"] = "" if not w else ("y" if w.get("vehicles", set()) & own and
                                                 not widx.at(e["route_id"], e["start"], e["end"], own) else "n")
        if not e.get("spot_name"):
            try:
                e["spot_name"] = namer(float(e["lat"]), float(e["lon"]))[0] if e["lat"] not in ("", None) else ""
            except (TypeError, ValueError):
                e["spot_name"] = ""
        e["route_name"] = names.get(e["route_id"], e["route_id"])
        e["other_name"] = names.get(str(e.get("other_route", "")), e.get("other_route", ""))
    # denominators
    den = defaultdict(Counter)
    for (rid, inside), m in L.exposure(polls.tracks, widx, routes).items():
        den[rid]["bus_min_in" if inside else "bus_min_out"] += m
    for r in tr:
        if r["kind"] == "leave" and r["label"] in L.LASTING:
            den[r["route_id"]]["lasting_leaves"] += 1
        if r["kind"] == "add" and r["label"] != "layover_swap":
            den[r["route_id"]]["real_adds"] += 1
    for rid, sp in spans.items():
        den[rid]["spans"] += len(sp)
    for rid, t, x, y in steps:
        den[rid]["steps_down" if y < x else "steps_up"] += 1
    # prediction baseline: every row 10 / 15 / 20 min ahead of an arrival this day vs the staying buses' rows
    stay_keys = {}
    for r in stay_rows:
        k = (r[0], r[2], r[3], r[4])
        stay_keys[k] = min(stay_keys.get(k, 99), r[5])
    for (rid, veh), lst in preds_csv.items():
        for e_, lead, err, stop in lst:
            if t0 <= e_ < t1 and lead in P.STAY_LEADS:
                ba = stay_keys.get((rid, e_, veh, stop))
                k = "all" if ba is None else "stay"
                den[rid][f"pred_{k}"] += 1
                den[rid][f"pred_{k}_late"] += err <= -P.LATE_S
                den[rid][f"pred_{k}_abs"] += abs(err)
                if ba == 1:                                  # the drop left ONE bus on the line (2 -> 1, DC-020)
                    den[rid]["pred_stay1"] += 1
                    den[rid]["pred_stay1_late"] += err <= -P.LATE_S
                    den[rid]["pred_stay1_abs"] += abs(err)
    # arrival baselines: share with a Passio time (non-gps, not the dark DCC stops) and share bunched,
    # overall vs the joining bus's arrivals in the 30 min after a non-layover add
    join = defaultdict(list)
    for r in tr:
        if r["kind"] == "add" and r["label"] != "layover_swap":
            join[(r["route_id"], r["vehicle_id"])].append(int(r["epoch"]))
    bun = P.bunched_flags(rarr)
    for rid, lst in rarr.items():
        flags = bun[rid]
        for (e_, veh, stop), (_, b) in zip(lst, flags):
            j = any(0 <= e_ - t <= P.BUNCH_AFTER_S for t in join.get((rid, veh), []))
            den[rid]["arr_join" if j else "arr_all"] += 1
            den[rid]["arr_join_bunched" if j else "arr_all_bunched"] += b
    for veh, lst in arr.items():
        for x in lst:
            if not (t0 <= x[0] < t1) or x[7] == "gps" or (x[2] in L.DCC_DARK_STOPS and x[0] >= L.DCC_DARK_FROM):
                continue
            j = any(0 <= x[0] - t <= P.BUNCH_AFTER_S for t in join.get((x[1], veh), []))
            den[x[1]]["pred_arr_join" if j else "pred_arr_all"] += 1
            den[x[1]]["pred_arr_join_has" if j else "pred_arr_all_has"] += x[6]
    veh_min = defaultdict(float)
    for veh, trk in polls.tracks.items():
        for i, r in enumerate(trk):
            if r[1] in routes:
                nxt = trk[i + 1][0] if i + 1 < len(trk) else r[0] + 60
                veh_min[(r[1], veh)] += min(60, max(0, nxt - r[0])) / 60
    return {"day": day, "episodes": eps, "den": {k: dict(v) for k, v in den.items()}, "names": names,
            "veh_min": dict(veh_min), "windows": Counter((w["route_id"], w["kind"]) for w in W)}


# ---------------------------------------------------------------- outputs
def episode_rows(results):
    rows = []
    for res in results:
        names = res["names"]
        for e in sorted(res["episodes"], key=lambda e: (e["start"], e["route_id"], e["code"], str(e["vehicle_id"]))):
            dt = datetime.fromtimestamp(e["start"], L.CT)
            r = {k: e.get(k, "") for k in EP_COLS}
            r.update({"period": L.period(e["service_day"]), "dow": L.DOW[(dt - L.timedelta(hours=4)).weekday()],
                      "local_time": L.ct(e["start"], "%Y-%m-%d %H:%M:%S"), "end_time": L.ct(e["end"], "%Y-%m-%d %H:%M:%S"),
                      "hour": dt.hour, "route": names.get(e["route_id"], e["route_id"]), "spot": e.get("spot_name", ""),
                      "spot_lat": e.get("lat", ""), "spot_lon": e.get("lon", ""), "passio_showed": passio_text(e),
                      "evidence": evidence_text(e, names)})
            rows.append(r)
    rows.sort(key=lambda r: (r["local_time"], r["route_id"], r["code"], str(r["vehicle_id"])))
    cnt = Counter()
    for r in rows:
        cnt[r["service_day"]] += 1
        r["episode_id"] = f"{r['service_day']}-{cnt[r['service_day']]:04d}"
    return rows


def _rate(n, den):
    return round(n / den, 3) if den else ""


SUM_COLS = ["scope", "route_id", "route", "vehicle_id", "code", "period", "days", "episodes", "episodes_in_window",
            "minutes", "unit", "rate_in_window", "rate_outside", "ratio", "denominator_in", "denominator_out",
            "all_lines_rate_in_window", "share_of_all_lines", "top_spot", "top_spot_n", "top_hour", "top_hour_n",
            "top_vehicle", "top_vehicle_n"]


def summary_rows(rows, results):
    names = {}
    den = defaultdict(Counter)              # (rid, period) -> counters
    vmin = defaultdict(float)               # (rid, veh, period) -> bus-min
    ndays = Counter()
    for res in results:
        names.update(res["names"])
        p = L.period(res["day"])
        ndays[p] += 1
        for rid, c in res["den"].items():
            den[(rid, p)].update(c)
            den[("all", p)].update(c)
        for (rid, veh), m in res["veh_min"].items():
            vmin[(rid, veh, p)] += m
    for k in list(den):
        if k[1] != "all":
            den[(k[0], "all")].update(den[k])
    for k in list(vmin):
        vmin[(k[0], k[1], "all")] += vmin[k]
    ndays["all"] = ndays["before"] + ndays["after"]
    g = defaultdict(list)
    for r in rows:
        for p in (r["period"], "all"):
            g[("line", r["route_id"], "", r["code"], p)].append(r)
            g[("line", "all", "", r["code"], p)].append(r)
            for v in str(r["vehicle_id"]).split(";"):
                if v:
                    g[("vehicle", r["route_id"], v, r["code"], p)].append(r)
    out = []
    for (scope, rid, veh, code, p), rs in g.items():
        unit = UNIT.get(code, "bus_hours")
        n_in = sum(1 for r in rs if r["window_kind"])
        n = len(rs)
        dd = den.get((rid, p), Counter())
        if unit == "bus_hours":
            if scope == "vehicle":
                d_in, d_out = "", vmin.get((rid, veh, p), 0) / 600
                r_in, r_out = "", _rate(n, d_out)
            else:
                d_in, d_out = dd["bus_min_in"] / 600, dd["bus_min_out"] / 600
                r_in, r_out = _rate(n_in, d_in), _rate(n - n_in, d_out)
            u = "per 10 bus-hours"
        else:
            d_in, d_out = dd[unit] / 100 if dd[unit] else 0, ""
            r_in, r_out = _rate(n, d_in), ""
            u = f"per 100 {unit.replace('_', ' ')}"
        all_dd = den.get(("all", p), Counter())
        if unit == "bus_hours":
            all_n_in = len([r for r in g.get(("line", "all", "", code, p), []) if r["window_kind"]])
            all_rate = _rate(all_n_in, all_dd["bus_min_in"] / 600)
        else:
            all_rate = _rate(len(g.get(("line", "all", "", code, p), [])), all_dd[unit] / 100)
        sp = Counter(r["spot"] for r in rs if r["spot"]).most_common(1)
        hr = Counter(r["hour"] for r in rs).most_common(1)
        vh = Counter(v for r in rs for v in str(r["vehicle_id"]).split(";") if v).most_common(1)
        ratio = round(r_in / r_out, 2) if r_in not in ("", None) and r_out not in ("", 0, None) else ""
        out.append({"scope": scope, "route_id": rid, "route": "All lines" if rid == "all" else names.get(rid, rid),
                    "vehicle_id": veh, "code": code, "period": p, "days": len({r["service_day"] for r in rs}),
                    "episodes": n, "episodes_in_window": n_in,
                    "minutes": round(sum(float(r["duration_min"] or 0) for r in rs), 1), "unit": u,
                    "rate_in_window": r_in, "rate_outside": r_out, "ratio": ratio,
                    "denominator_in": round(d_in, 2) if d_in not in ("", None) else "",
                    "denominator_out": round(d_out, 2) if d_out not in ("", None) else "",
                    "all_lines_rate_in_window": all_rate,
                    "share_of_all_lines": round(n / max(1, len(g.get(("line", "all", "", code, p), []))), 3),
                    "top_spot": sp[0][0] if sp else "", "top_spot_n": sp[0][1] if sp else "",
                    "top_hour": hr[0][0] if hr else "", "top_hour_n": hr[0][1] if hr else "",
                    "top_vehicle": vh[0][0] if vh else "", "top_vehicle_n": vh[0][1] if vh else ""})
    pord = {"all": 0, "before": 1, "after": 2}
    out.sort(key=lambda r: (r["scope"] != "line", r["code"], r["route_id"] != "all", r["route"], r["vehicle_id"], pord[r["period"]]))
    return out, den, ndays


def baselines(den):
    """Per line and period: the arrival / prediction shares that the event-anchored codes are compared with."""
    out = {}
    for (rid, p), c in den.items():
        def share(a, b):
            return round(c[a] / c[b], 4) if c[b] else None
        out[f"{rid}|{p}"] = {
            "pred_late_share_all": share("pred_all_late", "pred_all"), "pred_late_share_stay": share("pred_stay_late", "pred_stay"),
            "pred_late_share_stay1": share("pred_stay1_late", "pred_stay1"),
            "pred_mae_min_all": round(c["pred_all_abs"] / c["pred_all"] / 60, 2) if c["pred_all"] else None,
            "pred_mae_min_stay": round(c["pred_stay_abs"] / c["pred_stay"] / 60, 2) if c["pred_stay"] else None,
            "pred_mae_min_stay1": round(c["pred_stay1_abs"] / c["pred_stay1"] / 60, 2) if c["pred_stay1"] else None,
            "n_pred_all": c["pred_all"], "n_pred_stay": c["pred_stay"], "n_pred_stay1": c["pred_stay1"],
            "no_pred_share_all": round(1 - c["pred_arr_all_has"] / c["pred_arr_all"], 4) if c["pred_arr_all"] else None,
            "no_pred_share_join": round(1 - c["pred_arr_join_has"] / c["pred_arr_join"], 4) if c["pred_arr_join"] else None,
            "n_arr_join": c["pred_arr_join"],
            "bunched_share_all": share("arr_all_bunched", "arr_all"), "bunched_share_join": share("arr_join_bunched", "arr_join"),
            "n_bunch_join": c["arr_join"], "bus_hours_in": round(c["bus_min_in"] / 60, 1),
            "bus_hours_out": round(c["bus_min_out"] / 60, 1), "lasting_leaves": c["lasting_leaves"],
            "real_adds": c["real_adds"], "spans": c["spans"]}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dl", required=True)
    ap.add_argument("--e28", required=True, help="folder of endofservice.py's per-day CSVs")
    ap.add_argument("--transitions", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--work", required=True, help="scratch folder: one pickle per finished day")
    ap.add_argument("--days", nargs="*")
    ap.add_argument("--predictions", nargs="*", help="predictions.csv files (default <dl>/predictions*.csv)")
    ap.add_argument("--json")
    ap.add_argument("--redo", action="store_true", help="recompute days already in --work")
    a = ap.parse_args(argv)
    dl, work = Path(a.dl), Path(a.work)
    work.mkdir(parents=True, exist_ok=True)
    days = a.days or sorted(p.name[10:20] for p in dl.glob("raw-polls-*.jsonl.gz"))
    trans = L.read_csv(a.transitions)
    trans_by_day = defaultdict(list)
    for r in trans:
        trans_by_day[r["service_day"]].append(r)
    todo = [d for d in days if a.redo or not (work / f"{d}.pkl").exists()]
    if todo:
        arr = L.load_arrivals_full(dl / "arrivals.csv")
        preds_csv = P.load_predictions(a.predictions or sorted(glob.glob(str(dl / "predictions*.csv"))))
        spots = L.linger_spots(L.REPO / "data" / "labeled" / "end_of_service" / "linger_spots.csv")
        corridors = D.load_corridors(L.REPO / "web" / "data" / "corridors.json")
        marks = T.landmarks()
        static_cache = Path(tempfile.gettempdir()) / "sb-e27-static"
        line_cache = {}
        for d in todo:
            res = run_day(d, a, trans_by_day, arr, preds_csv, static_cache, line_cache, spots, corridors, marks)
            (work / f"{d}.pkl").write_bytes(pickle.dumps(res))
            print(d, len(res["episodes"]), dict(Counter(e["code"] for e in res["episodes"])), file=sys.stderr, flush=True)
    results = [pickle.loads((work / f"{d}.pkl").read_bytes()) for d in days]
    rows = episode_rows(results)
    out = Path(a.out)
    L.write_csv(out / "odd_episodes.csv", rows, EP_COLS)
    summ, den, ndays = summary_rows(rows, results)
    L.write_csv(out / "odd_summary.csv", summ, SUM_COLS)
    res = {"days": days, "ndays": dict(ndays), "episodes": len(rows),
           "by_code": dict(Counter(r["code"] for r in rows)),
           "by_code_period": {f"{c}|{p}": n for (c, p), n in Counter((r["code"], r["period"]) for r in rows).items()},
           "baselines": baselines(den)}
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps({k: res[k] for k in ("ndays", "episodes", "by_code")}, indent=1))


if __name__ == "__main__":
    main()

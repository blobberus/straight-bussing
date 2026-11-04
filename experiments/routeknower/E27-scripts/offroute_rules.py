#!/usr/bin/env python3
"""E27 part 2: what tells a bus that serves riders while off its line (a detour on a parallel street, the Downtown
Campus Connector off Lake Shore Drive) from one that does not operate (garage runs, parked at a lot)? Reads the
per-report table offroute.py --cache wrote, adds per off-line report the closest point of the route's line, builds the
off-line episodes (> D m from the route's line, the app's rule) and scores candidate rules.

Episode classes from the bus's logged arrivals on its route (data branch arrivals.csv):
  mid      an arrival at most 15 min before the episode and at most 20 min after it (in service on both sides:
           a detour or a short off-line layover; riders may be on board: a hide here is WRONG)
  pullout  no arrival in the 30 min before, one within 30 min after (leaving the garage)
  pullin   an arrival within 30 min before, none within 30 min after (going to the garage, after service)
  break    arrivals on both sides within 60 min, not mid (a long layover or a driver's break off the line)
  none     no arrival within 30 min on either side (not serving at all)

  python experiments/routeknower/E27-scripts/offroute_rules.py --cache reports.pkl --dl <gtfs dir>
      --arrivals arrivals.csv [--out rules.json]
"""
import argparse, json, math, pickle, sys, tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import offroute as O   # noqa: E402

D_OFF = 300
DC022 = (1793597400, 1793602800)   # 2026-11-01 23:30 to 11-02 01:00 CST: three buses driving to the garage after service


def service_day(t):
    dt = datetime.fromtimestamp(t, O.CT)
    return (dt - timedelta(hours=4)).date().isoformat()


def project(P, segs):
    """Closest point on the line for each point: (distance, x, y)."""
    A, B = segs
    AB = B - A
    L2 = np.maximum((AB ** 2).sum(1), 1e-9)
    out = np.empty((len(P), 3))
    for i in range(0, len(P), 1000):
        p = P[i:i + 1000, None, :]
        t = np.clip(((p - A) * AB).sum(2) / L2, 0, 1)
        q = A + t[..., None] * AB
        d = np.sqrt(((p - q) ** 2).sum(2))
        k = d.argmin(1)
        r = np.arange(len(k))
        out[i:i + 1000, 0] = d[r, k]
        out[i:i + 1000, 1:] = q[r, k]
    return out


def classify(e, arr):
    before = O.arrivals_between(arr, e["veh"], e["rid"], e["start"] - 3600, e["start"] - 1)
    after = O.arrivals_between(arr, e["veh"], e["rid"], e["end"] + 1, e["end"] + 3600)
    b = (e["start"] - before[-1][0]) / 60 if before else math.inf
    a = (after[0][0] - e["end"]) / 60 if after else math.inf
    if b <= 15 and a <= 20:
        return "mid"
    if b > 30 and a <= 30:
        return "pullout"
    if b <= 30 and a > 30:
        return "pullin"
    if b <= 60 and a <= 60:
        return "break"
    return "none"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--dl", required=True)
    ap.add_argument("--arrivals", required=True)
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    allrep, stats, stop_offs, days = pickle.loads(Path(a.cache).read_bytes())
    arr = O.load_arrivals(a.arrivals)
    cache = Path(tempfile.gettempdir()) / "sb-e27-static"
    statics = {}
    # closest point on the route's line for every off-line report
    by = defaultdict(list)
    for i, r in enumerate(allrep):
        if r["d"] > 150:
            by[(service_day(r["t"]), r["rid"])].append(i)
    for (day, rid), idx in by.items():
        if day not in statics:
            zp = O.zip_for(a.dl, day) or O.zip_for(a.dl, days[0])
            statics[day] = O.build_static(zp, cache)
        segs = statics[day]["segs"].get(rid)
        if segs is None:
            continue
        P = O.xy([allrep[i]["lat"] for i in idx], [allrep[i]["lon"] for i in idx])
        pr = project(P, segs)
        for j, i in enumerate(idx):
            allrep[i]["px"], allrep[i]["py"] = float(pr[j, 1]), float(pr[j, 2])
            allrep[i]["x"], allrep[i]["y"] = float(P[j, 0]), float(P[j, 1])
    steps = O.step_s(allrep)
    for r, s in zip(allrep, steps):
        r["step"] = s
    eps = O.episodes(allrep, D_OFF)
    for e in eps:
        e["cls"] = classify(e, arr)
        nxt = O.arrivals_between(arr, e["veh"], e["rid"], e["end"] + 1, e["end"] + 1800)
        e["came_back_t"] = nxt[0][0] if nxt else None
    out = {"D": D_OFF, "episodes": len(eps)}
    # features per class (inside the listed hours, shown by today's rules: inside or with a live prediction)
    feat = defaultdict(list)
    for e in eps:
        rs = [r for r in e["rows"] if "px" in r]
        if not rs:
            continue
        ext = math.hypot(max(r["px"] for r in rs) - min(r["px"] for r in rs), max(r["py"] for r in rs) - min(r["py"] for r in rs))
        e["extent"] = ext
        e["anyfar"] = sum(1 for r in e["rows"] if r["da"] > D_OFF) / len(e["rows"])
        e["inside"] = e["rows"][0]["gap"] == 0
        feat[(e["cls"], e["inside"])].append(e)
    q = lambda xs, p: round(float(np.percentile(xs, p)), 1) if xs else None
    out["classes"] = {f"{c}|{'in' if i else 'out'}": {
        "n": len(v), "min_p50_p90_max": [q([e["min"] for e in v], p) for p in (50, 90, 100)],
        "extent_m_p10_p50_p90": [q([e["extent"] for e in v], p) for p in (10, 50, 90)],
        "far_from_every_line_share_p50": q([e["anyfar"] for e in v], 50)} for (c, i), v in sorted(feat.items())}
    # long mid-service episodes: what were they?
    out["mid_longest"] = [{"veh": e["veh"], "rid": e["rid"], "from": O.fmt_t(e["start"]), "min": round(e["min"], 1),
                           "maxd": round(e["maxd"]), "extent": round(e["extent"]), "anyfar": round(e["anyfar"], 2),
                           "inside": e["inside"]}
                          for e in sorted([e for e in eps if e["cls"] == "mid" and "extent" in e], key=lambda e: -e["min"])[:30]]

    # candidate rules, evaluated report by report as the app would (state carried along the episode)
    def run(y_in, y_out, buf_min, any_line, ext_m, ext_win_min=None, ret_m=None, follow="box"):
        res = Counter()
        worst, every = [], []
        for e in eps:
            hid = 0.0
            first = None
            serving = 0.0
            pts = []
            st = None                                 # the clock: first report of this far run
            dmax = 0.0                                # farthest from its line in this far run
            hid_lead = 0.0                            # hidden in the last 10 min before the bus served again
            for r in e["rows"]:
                s = r["step"]
                if r["gap"] > 0 and not r["pred"]:
                    continue                          # already hidden by core/operating.js
                inside = r["gap"] <= buf_min * 60
                res["shown_off_" + e["cls"]] += s
                far = r["d"] > D_OFF and (not any_line or r["da"] > D_OFF)
                if not far:
                    pts, st, dmax = [], None, 0.0
                    continue
                if st is None:
                    st = r["t"]
                dmax = max(dmax, r["d"])
                returning = ret_m is not None and r["d"] <= dmax - ret_m
                if "px" in r:
                    pts.append((r["t"], r["px"], r["py"], r["x"], r["y"], r["d"]))
                el = (r["t"] - st) / 60
                follows = False
                if ext_m:
                    win = [p for p in pts if ext_win_min is None or p[0] >= r["t"] - ext_win_min * 60]
                    if win:
                        ext = math.hypot(max(p[1] for p in win) - min(p[1] for p in win), max(p[2] for p in win) - min(p[2] for p in win))
                        follows = ext >= ext_m
                        if follow == "away":          # ... unless it is heading away from its line
                            follows = follows and win[-1][5] < min(p[5] for p in win) + 500
                        elif follow == "ratio":       # the line's closest point kept pace with the bus
                            a0, a1 = win[0], win[-1]
                            line_mv = math.hypot(a1[1] - a0[1], a1[2] - a0[2])
                            bus_mv = math.hypot(a1[3] - a0[3], a1[4] - a0[4])
                            follows = line_mv >= ext_m and line_mv >= 0.6 * bus_mv
                if el >= (y_in if inside else y_out) and not (r["alert"] and inside) and not follows and not returning:
                    hid += s
                    first = first or r
                    if e.get("came_back_t") and e["came_back_t"] - r["t"] <= 600:
                        hid_lead += s
                    if O.arrivals_between(arr, e["veh"], e["rid"], r["t"] - 120, r["t"] + 120):
                        serving += s
            res["hidden_serving_now_s"] += serving
            if e["veh"] in ("4313", "4325", "4327") and DC022[0] <= e["start"] <= DC022[1]:
                res["dc022_hidden_s"] += hid
            res["hidden_last10_before_serving_s"] += hid_lead
            if hid:
                far_r = max(e["rows"], key=lambda x: x["d"])
                after = O.arrivals_between(arr, e["veh"], e["rid"], e["end"] + 1, e["end"] + 3600)
                every.append({"cls": e["cls"], "veh": e["veh"], "rid": e["rid"], "from": O.fmt_t(e["start"]),
                              "hidden_from": O.fmt_t(first["t"]), "min": round(e["min"], 1), "hidden_min": round(hid / 60, 1),
                              "maxd": round(e["maxd"]), "extent": round(e.get("extent", 0)),
                              "far": [round(far_r["lat"], 4), round(far_r["lon"], 4)],
                              "next_arrival_after_min": round((after[0][0] - e["end"]) / 60, 1) if after else None})
                res["hidden_" + e["cls"]] += hid
                res["episodes_hidden_" + e["cls"]] += 1
                if e["cls"] == "mid":
                    worst.append((hid, e))
        worst.sort(key=lambda w: -w[0])
        tot = {k: round(v / 60, 1) if not k.startswith("episodes") else v for k, v in sorted(res.items())}
        run.every = every
        hidden = sum(v for k, v in res.items() if k.startswith("hidden_") and k[7:] in ("mid", "pullout", "pullin", "break", "none"))
        return {"y_in": y_in, "y_out": y_out, "buf_min": buf_min, "any_line": any_line, "ext_m": ext_m,
                "ext_win_min": ext_win_min, "hidden_bus_min": round(hidden / 60, 1),
                "hidden_mid_bus_min": round(res["hidden_mid"] / 60, 1), **tot,
                "worst_mid": [{"veh": e["veh"], "rid": e["rid"], "from": O.fmt_t(e["start"]), "min": round(e["min"], 1),
                               "hidden_min": round(h / 60, 1), "maxd": round(e["maxd"]), "extent": round(e.get("extent", 0))}
                              for h, e in worst[:6]]}

    out["rules"] = []
    for any_line in (False, True):
        for ext in (0, 1000, 1500, 2000):
            for y_in in (10, 15, 20, 25, 30, 40):
                for y_out in (0, 5):
                    out["rules"].append(run(y_in, y_out, 30, any_line, ext, None))
    # the chosen rule (core/offroute.js) and its neighbour, every hidden episode
    out["chosen"] = {}
    for y_in in (10, 15, 20):
        for follow, win in (("box", None),):
            for ret in (None, 500, 1000, 1500):
                r = run(y_in, 5, 30, True, 1500, win, ret, follow)
                out["chosen"][f"{y_in}_{follow}{win or ''}_ret{ret}"] = {**{k: v for k, v in r.items() if k != "worst_mid"},
                                                                     "hidden_episodes": run.every}
    txt = json.dumps(out, indent=1)
    if a.out:
        Path(a.out).write_text(txt, encoding="utf-8")
    print(txt)


if __name__ == "__main__":
    main()

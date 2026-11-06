#!/usr/bin/env python3
"""E28 part 3: which lines are most affected by idle buses, odd hours and off-route time? (owner 2026-11-06: "determine
5 bus lines that are most plagued by the scheduling and routing issue"). Six measures per line, each ranked 1 (worst)
to 14, ranks added; per day = per day the line has listed hours. Output: docs/LINES-MOST-AFFECTED.md's table.

  idle_shown_day        non-layover still minutes today's app showed (data/labeled/end_of_service/summary.csv)
  phantom_pred_day      minutes Passio predicted a stop for a bus in an end_of_shift / parked / garage episode
  offroute_far_min      E27: minutes inside the listed hours more than 300 m from every route line (all.json of offroute.py)
  outside_hours_day     fresh reports more than 15 min outside the route's listed hours
  listed_no_live_share  share of the listed minutes with no fresh report of the route within 3 min
  miss_share            E24: the line's share of all Passio prediction misses (docs/TEN-PERCENT-SHORTFALLS.md section 4)

  python experiments/routeknower/E28-scripts/lines_rank.py --dl <fetch.py folder> --episodes episodes.pkl
      --reports reports.pkl --summary data/labeled/end_of_service/summary.csv --e27 all.json [--json out.json]
"""
import argparse, csv, json, pickle, sys, tempfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "E27-scripts"))
import offroute as O        # noqa: E402
import endofservice as E    # noqa: E402
import idle_rules as IR     # noqa: E402

E24_MISS_SHARE = {"5704": 14, "4346": 14, "6126": 13, "5699": 12, "5703": 9, "5700": 8, "1077": 7, "1078": 7, "5702": 6,
                  "1075": 4, "1076": 3, "5701": 3, "5715": 0.5, "5716": 0.5}
KEYS = ["idle_shown_day", "phantom_pred_day", "offroute_far_min", "outside_hours_day", "listed_no_live_share", "miss_share"]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dl", required=True)
    ap.add_argument("--episodes", required=True)
    ap.add_argument("--reports", required=True)
    ap.add_argument("--summary", required=True)
    ap.add_argument("--e27", required=True)
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    eps, stops, names = pickle.loads(Path(a.episodes).read_bytes())
    E.ROUTE_NAMES.update(names)
    E.name_spots(eps, stops)
    for e in eps:
        e["label"], e["evidence"] = E.label(e)
    R = pickle.loads(Path(a.reports).read_bytes())
    days = sorted(set(R["day"]))
    st = R["step"]
    cache = Path(tempfile.gettempdir()) / "sb-e27-static"
    by_day_rid = defaultdict(list)
    for i in range(len(R["t"])):
        by_day_rid[(R["day"][i], R["rid"][i])].append(R["t"][i])
    silent, listed, run_days = Counter(), Counter(), defaultdict(set)
    for d in days:
        svc = O.build_static(O.zip_for(a.dl, d), cache)["service"]
        t0, t1 = E.day_bounds(d)
        for rid, s0, s1 in O.day_spans(svc, date.fromisoformat(d)):
            s0, s1 = max(s0, t0), min(s1, t1)
            if s1 <= s0:
                continue
            ts = np.array(sorted(by_day_rid.get((d, rid), [])))
            mins = np.arange(s0, s1, 60)
            near = np.zeros(len(mins), bool)
            if len(ts):
                k = np.searchsorted(ts, mins)
                for off in (k - 1, k):
                    ok = (off >= 0) & (off < len(ts))
                    near[ok] |= np.abs(ts[off[ok]] - mins[ok]) <= 180
            silent[rid] += int((~near).sum())
            listed[rid] += len(mins)
            run_days[rid].add(d)
    phantom = Counter()
    for e in eps:
        if e["label"] in ("end_of_shift", "parked_never_served", "garage_return"):
            phantom[e["rid"]] += e["pred_share"] * e["dur_min"]
    summ = {r["route_id"]: r for r in csv.DictReader(open(a.summary, encoding="utf-8"))}
    e27 = json.loads(Path(a.e27).read_text(encoding="utf-8"))["per_route_inside"]
    rows = []
    for rid in sorted(listed):
        n = max(1, len(run_days[rid]))
        m = R["rid"] == rid
        o = e27.get(rid, {})
        rows.append({"rid": rid, "name": names.get(rid, rid), "days": n,
                     "idle_shown_day": float(summ[rid]["shown_idle_bus_min"]) / n if rid in summ else 0.0,
                     "eos_day": int(summ[rid]["end_of_shift"]) / n if rid in summ else 0.0,
                     "phantom_pred_day": phantom[rid] / n,
                     "offroute_far_min": o.get("off300", 0) - o.get("off300_on_other_line", 0),
                     "outside_hours_day": float(st[(R["gap"] > 900) & m].sum()) / 60 / n,
                     "listed_no_live_share": silent[rid] / max(1, listed[rid]),
                     "miss_share": E24_MISS_SHARE.get(rid, 0)})
    for k in KEYS:
        for i, r in enumerate(sorted(rows, key=lambda r: -r[k])):
            r["rank_" + k] = i + 1
    for r in rows:
        r["rank_sum"] = sum(r["rank_" + k] for k in KEYS)
    rows.sort(key=lambda r: r["rank_sum"])
    for r in rows:
        print(f'{r["name"][:26]:26} {r["rank_sum"]:3}  idle/day {r["idle_shown_day"]:6.1f}  shift ends/day {r["eos_day"]:.2f}  '
              f'phantom/day {r["phantom_pred_day"]:6.1f}  far {r["offroute_far_min"]:5}  outside/day {r["outside_hours_day"]:5.1f}  '
              f'no live {r["listed_no_live_share"]:.3f}  misses {r["miss_share"]}%')
    if a.json:
        Path(a.json).write_text(json.dumps(rows, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()

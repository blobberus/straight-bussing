"""Huge-error investigation, step 4: one exclusive cause per huge error, counts, examples."""
import sys, json, bisect
from collections import Counter, defaultdict
from pathlib import Path
sys.path.insert(0, r"C:\Users\billy\Documents\straight-bussing\tools")
import model_core as C

RK = Path(__file__).parent
recs = json.loads((RK / "he_rows.json").read_text(encoding="utf-8"))
dicts = C.read_dicts(str(RK / "arrivals.csv"))
kept, _s, _n = C.clean_dicts(dicts)
by_stop = defaultdict(list)
for d in kept:
    ep = C._f(d.get("epoch"))
    if ep is not None:
        by_stop[d["stop_id"]].append((ep, d["vehicle_id"], d["route_id"]))
for v in by_stop.values():
    v.sort()


def same_route_bus_at(f, t, tol=60):
    lst = by_stop[f["stop"]]
    i, j = bisect.bisect_left(lst, (t - tol, "", "")), bisect.bisect_right(lst, (t + tol, "\uffff", "\uffff"))
    return any(v != f["veh"] and r == f["route"] for _, v, r in lst[i:j])


def cause(f):
    pe = f["ep"] + f["e"]
    if not f["clean"] and f["lead"] < 300 and f["idx"] != "0" and not f["post"]:
        return "A1 logger: shared trip id before the B1 fix"
    if f["idx"] == "0" and not f["post"]:
        return "A2 logger: loop start before the B1 fix"
    if f["wrong_lap"]:
        return "A3 logger: prediction is this bus's other lap"
    if same_route_bus_at(f, pe) and not f["post"]:
        return "A4 logger: prediction matches another bus of the route (pre-B1)"
    if (f.get("track_dist_m") or 0) > 100:
        return "A5 detector: bus not at the stop at the logged time"
    if f["lead"] >= 300:
        standing = f.get("raw_stationary_s", 0) >= 180 or f["max_dwell_between"] >= 180 or (f["dwell"] or 0) >= 180
        return "R1 stale: bus standing (layover / hold), no fresh prediction" if standing else "R2 stale: no fresh prediction (other)"
    if f["past_pred"]:
        return "R3 Passio: prediction already in the past when made"
    if f.get("sched") is not None and abs(f["actual_minus_sched"]) > 600:
        return "R4 Passio: bus > 10 min off its trip's timetable (trip / slot mismatch)"
    if f["idx"] == "0":
        return "R5 loop start after the fix"
    return "R6 unexplained (real large miss)"


for f in recs:
    f["cause"] = cause(f)
TOT = len(recs)
md = []


def table(sel, title):
    c = Counter(f["cause"] for f in sel)
    md.append(f"\n**{title}** (n = {len(sel)}; {len(sel) / TOT:.1%} of all {TOT} rows with a prediction)\n")
    md.append("| cause | rows | share | bus came early (e > 0) | median abs error s | routes (top) |")
    md.append("|---|---:|---:|---:|---:|---|")
    for k, n in sorted(c.items()):
        s = [f for f in sel if f["cause"] == k]
        a = sorted(abs(f["e"]) for f in s)
        rt = Counter(f["route_name"] for f in s).most_common(3)
        md.append(f"| {k} | {n} | {n / len(sel):.0%} | {sum(f['e'] > 0 for f in s) / n:.0%} | {a[len(a)//2]:.0f} | "
                  + ", ".join(f"{r} {m}" for r, m in rt) + " |")


table([f for f in recs if abs(f["e"]) > 300], "|error| > 5 min, every row with a prediction")
table([f for f in recs if abs(f["e"]) > 600], "|error| > 10 min")
table([f for f in recs if abs(f["e"]) > 300 and f["post"]], "|error| > 5 min, logged after the 2026-10-10 fixes")
table([f for f in recs if 180 < abs(f["e"]) <= 300], "|error| 3 to 5 min (the shoulder)")

# examples per cause
md.append("\n### Examples (up to 4 per cause, |error| > 5 min)\n")
md.append("| cause | route | stop | bus | local time | lead s | error s | evidence |")
md.append("|---|---|---|---|---|---:|---:|---|")
for k in sorted({f["cause"] for f in recs if abs(f["e"]) > 300}):
    s = sorted([f for f in recs if f["cause"] == k and abs(f["e"]) > 300], key=lambda f: (not f["raw"], -abs(f["e"])))[:4]
    for f in s:
        ev = []
        if f.get("sched") is not None:
            ev.append(f"actual-timetable {f['actual_minus_sched']:+.0f} s, pred-timetable {f['pred_minus_sched']:+.0f} s")
        if f["raw"]:
            ev.append(f"raw: standing {f.get('raw_stationary_s')} s, dist at arrival {f.get('raw_dist_at_arrival_m')} m, closest {f.get('raw_min_dist_m')} m")
        if f["prev_same_dt"] is not None:
            ev.append(f"own previous visit {f['prev_same_dt']:.0f} s before")
        if f["trip_change"]:
            ev.append("trip id changed after the prediction")
        md.append(f"| {k.split(':')[0]} | {f['route_name']} | {f['stop_name']} | {f['veh']} | {f['local'][5:16]} | {f['lead']:.0f} | {f['e']:+.0f} | {'; '.join(ev)} |")

(RK / "he_causes.md").write_text("\n".join(md) + "\n", encoding="utf-8")
(RK / "he_rows.json").write_text(json.dumps(recs), encoding="utf-8")
print("\n".join(md))

"""Timetable test with interpolated stop times (GTFS gives times at timepoints only)."""
import csv, io, json, sys, zipfile
from collections import defaultdict, Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools"))
import model_core as C

RK = Path(__file__).parent
z = zipfile.ZipFile(RK / "google_transit.zip")


def rows(name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))


def hms(s):
    h, m, sec = (int(x) for x in s.strip().split(":"))
    return h * 3600 + m * 60 + sec


st = defaultdict(list)
for r in rows("stop_times.txt"):
    st[r["trip_id"]].append(r)
freq = defaultdict(list)
for r in rows("frequencies.txt"):
    freq[r["trip_id"]].append((hms(r["start_time"]), hms(r["end_time"]), int(r["headway_secs"])))
sched = {}
for trip, lst in st.items():
    lst.sort(key=lambda r: int(r["stop_sequence"]))
    known = [(i, hms(r["arrival_time"] or r["departure_time"])) for i, r in enumerate(lst) if (r["arrival_time"] or r["departure_time"]).strip()]
    times = [None] * len(lst)
    for (i0, t0), (i1, t1) in zip(known, known[1:]):
        for i in range(i0, i1 + 1):
            times[i] = t0 + (t1 - t0) * (i - i0) / max(1, i1 - i0)
    by_stop = defaultdict(list)
    for r, t, i in zip(lst, times, range(len(lst))):
        if t is not None:
            by_stop[r["stop_id"]].append((t, i == 0 or i == len(lst) - 1 or r.get("timepoint") == "1"))
    sched[trip] = by_stop
print("frequency trips:", len(freq))

recs = json.loads((RK / "he_rows.json").read_text(encoding="utf-8"))


def midnight(ep):
    loc = C.chicago(ep - 4 * 3600)
    return loc.replace(hour=12, minute=0, second=0, microsecond=0).timestamp() - 12 * 3600


n_ok = 0
for f in recs:
    f["sched"] = None
    if f["trip"] in freq:
        f["freq_trip"] = True
        continue
    s = sched.get(f["trip"], {}).get(f["stop"])
    if not s:
        continue
    m0 = midnight(f["ep"])
    pe = f["ep"] + f["e"]
    t, tp = min(((m0 + x, tp) for x, tp in s), key=lambda c: abs(c[0] - pe))
    ta = min((m0 + x for x, _ in s), key=lambda c: abs(c - f["ep"]))
    f["sched"], f["pred_minus_sched"], f["actual_minus_sched"], f["timepoint"] = t, pe - t, f["ep"] - ta, tp
    n_ok += 1
(RK / "he_rows.json").write_text(json.dumps(recs), encoding="utf-8")
print("rows with a timetable time:", n_ok, "of", len(recs), "; frequency-trip rows:", sum(bool(f.get('freq_trip')) for f in recs))


def cls(f):
    if f["clean"]:
        return "clean"
    if f["lead"] >= 300:
        return "stuck"
    if f["idx"] == "0":
        return "index0"
    return "shared-" + ("post" if f["post"] else "pre")


print("\nprediction vs timetable (interpolated), by class and |error|")
for c in ("clean", "shared-pre", "shared-post", "index0", "stuck"):
    for lo, hi in ((0, 120), (120, 300), (300, 600), (600, 10**9)):
        sel = [f for f in recs if cls(f) == c and lo <= abs(f["e"]) < hi and f.get("sched") is not None]
        if len(sel) < 5:
            continue
        d = sorted(abs(f["pred_minus_sched"]) for f in sel)
        a = sorted(abs(f["actual_minus_sched"]) for f in sel)
        print(f"  {c:12s} |e| {lo:4d}-{hi if hi < 10**9 else 'inf':>4}: n={len(sel):5d} |pred-sched|<=60s {sum(x <= 60 for x in d) / len(d):4.0%} "
              f"median |pred-sched| {d[len(d)//2]:5.0f}  median |actual-sched| {a[len(a)//2]:5.0f}"
              f"  pred>=sched-30 {sum(f['pred_minus_sched'] >= -30 for f in sel) / len(sel):4.0%}")
# the lap episodes: clean, e > 300
print("\nclean, bus came > 5 min before the prediction (e > 300): prediction vs timetable")
for f in sorted([f for f in recs if f["clean"] and f["e"] > 300 and f.get("sched")], key=lambda f: f["ep"]):
    print(f"  {f['route_name'][:18]:18s} {f['stop_name'][:26]:26s} {f['local'][5:16]} veh={f['veh']} e={f['e']:+5.0f} pred-sched={f['pred_minus_sched']:+6.0f} actual-sched={f['actual_minus_sched']:+6.0f} tp={int(f['timepoint'])}")
print("\nclean, bus came > 5 min after the prediction (e < -300): prediction vs timetable")
for f in sorted([f for f in recs if f["clean"] and f["e"] < -300 and f.get("sched")], key=lambda f: f["ep"]):
    print(f"  {f['route_name'][:18]:18s} {f['stop_name'][:26]:26s} {f['local'][5:16]} veh={f['veh']} e={f['e']:+5.0f} pred-sched={f['pred_minus_sched']:+6.0f} actual-sched={f['actual_minus_sched']:+6.0f} past={int(f['past_pred'])}")

"""Huge-error investigation, step 3: is Passio's stored prediction just the timetable?
Downloads the public GTFS zip (same URL as tools/build_gtfs.py) once into the scratchpad."""
import csv, io, json, sys, zipfile, urllib.request
from collections import defaultdict, Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
sys.path.insert(0, r"C:\Users\billy\Documents\straight-bussing\tools")
import model_core as C

RK = Path(__file__).parent
ZIP = RK / "google_transit.zip"
if not ZIP.exists():
    req = urllib.request.Request("https://passio3.com/chicago/passioTransit/gtfs/google_transit.zip",
                                 headers={"User-Agent": "straight-bussing/1.0"})
    ZIP.write_bytes(urllib.request.urlopen(req, timeout=60).read())
z = zipfile.ZipFile(ZIP)


def rows(name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))


def hms(s):
    h, m, sec = (int(x) for x in s.strip().split(":"))
    return h * 3600 + m * 60 + sec


sched = defaultdict(lambda: defaultdict(list))   # trip -> stop -> [secs after service-day midnight]
for st in rows("stop_times.txt"):
    t = st.get("arrival_time") or st.get("departure_time")
    if t:
        sched[st["trip_id"]][st["stop_id"]].append(hms(t))
print("GTFS trips:", len(sched))

recs = json.loads((RK / "he_rows.json").read_text(encoding="utf-8"))


def midnight(ep):
    """Chicago midnight of the service day (4 AM cut) as epoch; noon-minus-12h trick for DST safety."""
    loc = C.chicago(ep - 4 * 3600)
    noon = loc.replace(hour=12, minute=0, second=0, microsecond=0)
    return noon.timestamp() - 12 * 3600


hit = Counter()
for f in recs:
    s = sched.get(f["trip"], {}).get(f["stop"])
    if not s:
        f["sched"] = None
        hit["no schedule for trip+stop"] += 1
        continue
    m0 = midnight(f["ep"])
    cand = [m0 + x for x in s]
    pe = f["ep"] + f["e"]
    best = min(cand, key=lambda c: abs(c - pe))
    f["pred_minus_sched"] = pe - best
    f["actual_minus_sched"] = f["ep"] - min(cand, key=lambda c: abs(c - f["ep"]))
    f["sched"] = best
(RK / "he_rows.json").write_text(json.dumps(recs), encoding="utf-8")
print(dict(hit))


def cls(f):
    if f["clean"]:
        return "clean"
    if f["lead"] >= 300:
        return "stuck"
    if f["idx"] == "0":
        return "index0"
    return "shared-" + ("post" if f["post"] else "pre")


print("\nshare of predictions equal to the timetable (|pred - sched| <= 30 s), by class and |error|")
for c in ("clean", "shared-pre", "shared-post", "index0", "stuck"):
    for lo, hi in ((0, 120), (120, 300), (300, 600), (600, 10**9)):
        sel = [f for f in recs if cls(f) == c and lo <= abs(f["e"]) < hi and f.get("sched") is not None]
        if len(sel) < 5:
            continue
        eq = sum(abs(f["pred_minus_sched"]) <= 30 for f in sel)
        print(f"  {c:12s} |e| {lo:4d}-{hi if hi < 10**9 else 'inf':>4}: n={len(sel):5d} pred==timetable {eq / len(sel):5.0%}"
              f"   median |actual - timetable| {sorted(abs(f['actual_minus_sched']) for f in sel)[len(sel)//2]:5.0f} s")

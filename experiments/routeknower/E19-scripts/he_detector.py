"""Detector check with the track, not single reports: distance from the stop to the polyline of this bus's
raw reports in [arrival - 90 s, arrival + 90 s] (reports can be 20-40 s apart, a bus moves 100-300 m between)."""
import json, math, sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, r"C:\Users\billy\Documents\straight-bussing\tools")
import model_core as C

RK = Path(__file__).parent
ROOT = Path(r"C:\Users\billy\Documents\straight-bussing")
stops = json.loads((ROOT / "web/data/stops.json").read_text(encoding="utf-8"))
raw = defaultdict(list)
for f in sorted((RK / "raw" / "days").glob("*.jsonl")):
    for ln in f.read_text(encoding="utf-8").splitlines():
        if ln.strip():
            p = json.loads(ln)
            for v in p.get("v") or []:
                if v[3] is not None:
                    raw[str(v[0])].append((int(v[10] or p["t"]), v[3], v[4]))
for v in raw.values():
    v.sort()


def seg_dist(lat, lon, a, b):
    """metres from (lat, lon) to segment a-b (equirectangular, fine at this scale)."""
    k = math.cos(math.radians(lat)) * 111320.0
    ax, ay = (a[2] - lon) * k, (a[1] - lat) * 110540.0
    bx, by = (b[2] - lon) * k, (b[1] - lat) * 110540.0
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
    return math.hypot(ax + t * dx, ay + t * dy)


recs = json.loads((RK / "he_rows.json").read_text(encoding="utf-8"))
n = flagged = 0
out = []
for f in recs:
    if not f["raw"]:
        continue
    st = stops.get(f["stop"])
    v = [r for r in raw.get(f["veh"], []) if abs(r[0] - f["ep"]) <= 90]
    if not st or len(v) < 2:
        continue
    n += 1
    d = min(seg_dist(st["lat"], st["lon"], a, b) for a, b in zip(v, v[1:]))
    f["track_dist_m"] = round(d)
    if d > 100:
        flagged += 1
        out.append(f)
(RK / "he_rows.json").write_text(json.dumps(recs), encoding="utf-8")
print(f"rows with a track around the arrival: {n}; track never within 100 m of the stop: {flagged} ({flagged / n:.2%})")
for f in sorted(out, key=lambda f: f["ep"]):
    print(f"  {f['route_name'][:18]:18s} {f['stop_name'][:28]:28s} veh {f['veh']} {f['local'][5:16]} {f['source']:10s} e {f['e']:+6.0f} track {f['track_dist_m']} m")

import sys, json
from collections import Counter
from pathlib import Path
RK = Path(__file__).parent
rows = json.loads((RK / "he_rows.json").read_text(encoding="utf-8"))
sel = [f for f in rows if f["clean"] and abs(f["e"]) > 300]
print("clean |e|>300:", len(sel))
print(Counter((f["route_name"], f["stop_name"]) for f in sel).most_common(25))
print(Counter(f["idx"] for f in sel).most_common(10))
print("hour:", sorted(Counter(f["hour"] for f in sel).items()))
print("trip_change share", sum(f["trip_change"] for f in sel) / len(sel))
for f in sorted(sel, key=lambda f: (f["route_name"], f["stop_name"], f["ep"])):
    print(f"{f['route_name'][:18]:18s} {f['stop_name'][:30]:30s} i={f['idx']:>2s} veh={f['veh']} {f['local'][5:16]} lead={f['lead']:4.0f} e={f['e']:+6.0f} "
          f"dw={f['dwell']} betw={f['stops_between']} maxdw={f['max_dwell_between']:.0f} tchg={int(f['trip_change'])} oth={int(f['other_bus_at_pred'])} "
          f"past={int(f['past_pred'])} prevS={f['prev_same_dt']} nextS={f['next_same_dt']} loop={round((f['loop_s'] or 0)/60)} "
          f"raw={int(f['raw'])} st={f.get('raw_stationary_s')} dA={f.get('raw_dist_at_arrival_m')} min={f.get('raw_min_dist_m')}")

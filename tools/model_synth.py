"""Seeded SYNTHETIC arrival generator in the arrivals.csv schema. Proves the code, NOT accuracy.

  python tools/model_synth.py --days 21 --out data/synthetic_model.csv
Ground truth built in: per-segment speed, rush-hour slowdown, AR(1) trip delay, log-normal noise,
dwell, and a deliberately simple 'Passio' that uses schedule times and a lead-dependent error."""
import argparse, csv, json, math, random
from datetime import datetime, timedelta, timezone
from pathlib import Path
import model_core as C

HEADER = ("epoch,ts_utc,local_time,dow,hour,minute_of_day,route_id,route_name,trip_id,vehicle_id,stop_id,stop_name,"
          "stop_address,stop_lat,stop_lon,stop_index,prev_stop_id,dist_prev_m,prev_arrival_epoch,segment_s,speed_mps,"
          "dwell_s,passio_pred_epoch,passio_pred_lead_s,source").split(",")


def _cdt(ts):
    """Fixed UTC-5 (CDT) for synthetic local time; real data uses the logger's own local_time."""
    return datetime.fromtimestamp(ts - 5 * 3600, timezone.utc)


def hour_factor(dow, hour):
    """Slowdown multiplier on run time."""
    if dow < 5:
        return 1.35 if hour in (8, 9, 16, 17, 18) else 1.1 if hour in (7, 10, 15, 19) else 0.95
    return 0.85


def generate(days=21, seed=7, max_routes=4, start="2026-09-01", web=C.WEB_DATA):
    rnd = random.Random(seed)
    rs = json.loads((web / "route_stops.json").read_text(encoding="utf-8"))
    stops = json.loads((web / "stops.json").read_text(encoding="utf-8"))
    sched = json.loads((web / "segments.json").read_text(encoding="utf-8")).get("routes", {})
    t0 = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp()) + 5 * 3600
    out = []
    routes = [r for r in sorted(rs) if len(rs[r]) > 4 and all(s in stops for s in rs[r])][:max_routes]
    for rid in routes:
        order = rs[rid]
        n = len(order) - 1
        sg = (sched.get(rid) or {}).get("seg") or [60] * n
        dist, vseg = [], []
        for i in range(n):
            a, b = stops[order[i]], stops[order[i + 1]]
            d = max(60.0, 1.25 * C.haversine(a["lat"], a["lon"], b["lat"], b["lon"]))
            sv = d / max(sg[i] if i < len(sg) else 60, 15)
            dist.append(d)
            vseg.append(min(14, max(2.5, 0.5 * sv + 0.5 * 7.0)) * math.exp(rnd.gauss(0, 0.2)))
        headway = ((sched.get(rid) or {}).get("hw") or 15) * 60
        for day in range(days):
            for k in range(int(15 * 3600 / headway)):
                ts = t0 + day * 86400 + int(6.5 * 3600) + k * headway + rnd.randint(-60, 60)
                trip = f"{rid}-{day}-{k}"
                veh = f"B{rid[-2:]}{k % 3}"
                delay = 0.0
                t = float(ts)
                for i in range(n):
                    loc = _cdt(t)
                    dow, hr = loc.weekday(), loc.hour
                    delay = 0.7 * delay + rnd.gauss(0, 0.06)          # AR(1) trip-level log delay
                    run = dist[i] / vseg[i] * hour_factor(dow, hr) * math.exp(delay + rnd.gauss(0, 0.12))
                    dwell = max(0.0, rnd.gauss(18, 6)) if i > 0 else 0.0
                    prev_t = t
                    t = t + dwell + run
                    seg = t - prev_t
                    lead = max(30.0, rnd.uniform(0.3, 1.5) * seg)
                    sch = (sg[i] if i < len(sg) else 60) + dwell
                    pe = prev_t + sch + rnd.gauss(0.08 * lead, 0.15 * lead)   # 'Passio': schedule-ish + lead error
                    ll = _cdt(t)
                    s = stops[order[i + 1]]
                    out.append({
                        "epoch": int(round(t)), "ts_utc": datetime.fromtimestamp(t, timezone.utc).isoformat(),
                        "local_time": ll.strftime("%Y-%m-%d %H:%M:%S"), "dow": ll.weekday(), "hour": ll.hour,
                        "minute_of_day": ll.hour * 60 + ll.minute, "route_id": rid, "route_name": rid,
                        "trip_id": trip, "vehicle_id": veh, "stop_id": order[i + 1], "stop_name": s["name"],
                        "stop_address": "", "stop_lat": s["lat"], "stop_lon": s["lon"], "stop_index": i + 1,
                        "prev_stop_id": order[i], "dist_prev_m": round(dist[i], 1),
                        "prev_arrival_epoch": int(round(prev_t)), "segment_s": round(seg, 1),
                        "speed_mps": round(dist[i] / run, 3), "dwell_s": round(dwell, 1),
                        "passio_pred_epoch": int(round(pe)), "passio_pred_lead_s": int(lead), "source": "synthetic"})
    out.sort(key=lambda r: r["epoch"])
    return out


def write_csv(rows, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=HEADER)
        w.writeheader()
        w.writerows(rows)


def synthetic_rows(**kw):
    return [r for r in (C.make_row(d) for d in generate(**kw)) if r and r.dist > 0]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=21)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=str(C.ROOT / "data" / "synthetic_model.csv"))
    a = ap.parse_args()
    rows = generate(a.days, a.seed)
    write_csv(rows, a.out)
    print(f"wrote {len(rows)} synthetic rows to {a.out}")

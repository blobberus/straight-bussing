"""Seeded SYNTHETIC arrival generator in the arrivals.csv schema. Proves the code, NOT accuracy.

  python tools/model_synth.py --days 21 --out <path outside the repo or data/ground_truth>
Ground truth built in (so tests can check the models recover it): per-segment free speed, rush-hour
slowdown, AR(1) trip delay that carries over segment to segment, log-normal noise, dwell, and a
deliberately simple 'Passio' that adds scheduled times to the last stop with lead-dependent error.
Semantics match tools/arrivals_lib.fmt_row: dwell_s = dwell at THIS stop, segment_s includes the
dwell at the previous stop, speed_mps = dist / (segment_s - previous dwell)."""
import argparse, csv, json, math, random, tempfile
from datetime import datetime, timezone
from pathlib import Path
import model_core as C

HEADER = ("epoch,ts_utc,local_time,dow,hour,minute_of_day,route_id,route_name,trip_id,vehicle_id,stop_id,stop_name,"
          "stop_address,stop_lat,stop_lon,stop_index,prev_stop_id,dist_prev_m,prev_arrival_epoch,segment_s,speed_mps,"
          "dwell_s,passio_pred_epoch,passio_pred_lead_s,source").split(",")


def hour_factor(dow, hour):
    """Ground-truth slowdown multiplier on run time."""
    if dow < 5:
        return 1.35 if hour in (8, 9, 16, 17, 18) else 1.1 if hour in (7, 10, 15, 19) else 0.95
    return 0.85


def generate(days=21, seed=7, max_routes=4, start="2026-09-01", web=C.WEB_DATA):
    rnd = random.Random(seed)
    rs = json.loads((web / "route_stops.json").read_text(encoding="utf-8"))
    stops = json.loads((web / "stops.json").read_text(encoding="utf-8"))
    sched = json.loads((web / "segments.json").read_text(encoding="utf-8")).get("routes", {})
    t0 = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp()) + 5 * 3600  # 00:00 CDT
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
                trip, veh = f"{rid}-{day}-{k}", f"B{rid[-2:]}{k % 3}"
                dw = [max(0.0, rnd.gauss(18, 6)) for _ in range(n + 1)]       # dwell at stop i
                delay, t = 0.0, float(ts)
                arr = [t]
                for i in range(n + 1):
                    if i > 0:
                        loc = C.chicago(arr[i - 1] + dw[i - 1])
                        delay = 0.7 * delay + rnd.gauss(0, 0.06)                # AR(1) trip-level log delay
                        run = dist[i - 1] / vseg[i - 1] * hour_factor(loc.weekday(), loc.hour) \
                            * math.exp(delay + rnd.gauss(0, 0.12))
                        arr.append(arr[i - 1] + dw[i - 1] + run)
                    t = arr[i]
                    ll = C.chicago(t)
                    s = stops[order[i]]
                    row = {"epoch": int(round(t)), "ts_utc": datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                           "local_time": ll.strftime("%Y-%m-%d %H:%M:%S"), "dow": ll.weekday(), "hour": ll.hour,
                           "minute_of_day": ll.hour * 60 + ll.minute, "route_id": rid, "route_name": rid,
                           "trip_id": trip, "vehicle_id": veh, "stop_id": order[i], "stop_name": s["name"],
                           "stop_address": "", "stop_lat": s["lat"], "stop_lon": s["lon"], "stop_index": i,
                           "prev_stop_id": "", "dist_prev_m": "", "prev_arrival_epoch": "", "segment_s": "",
                           "speed_mps": "", "dwell_s": round(dw[i], 1), "passio_pred_epoch": "",
                           "passio_pred_lead_s": "", "source": "synthetic"}
                    if i > 0:
                        seg = int(round(t)) - int(round(arr[i - 1]))
                        run = seg - dw[i - 1]
                        # 'Passio': prediction made `lead` s before arrival = last stop + schedule + noise
                        lead = rnd.choice((120, 200, 300, 450, 700, 1000))
                        sch = sum(float(x) for x in sg[max(0, i - 3):i]) if sg else 60.0 * min(i, 3)
                        pe = t + 0.05 * (sch - seg) + rnd.gauss(0.04 * lead, 0.12 * lead + 10)
                        row.update({"prev_stop_id": order[i - 1], "dist_prev_m": round(dist[i - 1], 1),
                                    "prev_arrival_epoch": int(round(arr[i - 1])), "segment_s": seg,
                                    "speed_mps": round(dist[i - 1] / max(run, 1.0), 3),
                                    "passio_pred_epoch": int(round(pe)), "passio_pred_lead_s": lead})
                    out.append(row)
    out.sort(key=lambda r: (r["epoch"], r["trip_id"]))
    return out


def write_csv(rows, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=HEADER)
        w.writeheader()
        w.writerows(rows)


def synthetic_rows(**kw):
    return C.rows_from_dicts(generate(**kw))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=21)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=str(Path(tempfile.gettempdir()) / "sb_synthetic_model.csv"))
    a = ap.parse_args()
    rows = generate(a.days, a.seed)
    write_csv(rows, a.out)
    print(f"wrote {len(rows)} synthetic rows to {a.out}")

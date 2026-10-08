#!/usr/bin/env python3
"""Poll the Passio GTFS-realtime JSON feeds and append compact observations.

Output: data/observations/YYYY-MM-DD.jsonl.gz (UTC date; gzip members appended, readable with gzip.open).
Line types:
  {"k":"v","t":poll_ts,"id":vehicle,"r":route,"tr":trip,"la":lat,"lo":lon,"sp":m/s,"b":bearing,
   "s":stop_id,"q":current_stop_sequence,"vt":vehicle_ts,"oc":occupancy}
  {"k":"p","t":poll_ts,"tr":trip,"r":route,"id":vehicle,"p":[[stop_seq,stop_id,predicted_arrival_ts],...]}
No rider data exists in these feeds; nothing personal is collected.

  python tools/collect.py --once
  python tools/collect.py --duration 60 --interval 10
  python tools/collect.py                # run forever (Ctrl+C to stop)
"""
import argparse, gzip, json, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://passio3.com/chicago/passioTransit/gtfs/realtime/"
UA = "StraightBussing-collector (student project)"
OUT = Path(__file__).resolve().parent.parent / "data" / "observations"


def fetch(name, timeout=15):
    req = urllib.request.Request(BASE + name + ".json", headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def r5(x, n=5):
    return round(x, n) if isinstance(x, (int, float)) else None


def vehicle_lines(feed, t):
    for e in feed.get("entity", []):
        v = e.get("vehicle") or {}
        pos, trip, veh = v.get("position") or {}, v.get("trip") or {}, v.get("vehicle") or {}
        if "latitude" not in pos:
            continue
        yield {"k": "v", "t": t, "id": veh.get("id"), "r": trip.get("route_id"), "tr": trip.get("trip_id"),
               "la": r5(pos.get("latitude")), "lo": r5(pos.get("longitude")),
               "sp": r5(pos.get("speed"), 2), "b": r5(pos.get("bearing"), 0),
               "s": v.get("stop_id"), "q": v.get("current_stop_sequence"),
               "vt": v.get("timestamp"), "oc": v.get("occupancy_status")}


def update_lines(feed, t, max_stops):
    for e in feed.get("entity", []):
        u = e.get("trip_update") or {}
        trip, veh = u.get("trip") or {}, u.get("vehicle") or {}
        p = []
        for st in (u.get("stop_time_update") or [])[:max_stops]:
            arr = (st.get("arrival") or st.get("departure") or {}).get("time")
            if arr is not None:
                p.append([st.get("stop_sequence"), st.get("stop_id"), arr])
        if p:
            yield {"k": "p", "t": t, "tr": trip.get("trip_id"), "r": trip.get("route_id"), "id": veh.get("id"), "p": p}


def poll(out_dir, max_stops):
    t = int(time.time())
    lines, errs = [], 0
    for name, fn in (("vehiclePositions", lambda f: vehicle_lines(f, t)),
                     ("tripUpdates", lambda f: update_lines(f, t, max_stops))):
        try:
            lines.extend(fn(fetch(name)))
        except Exception as e:  # network/JSON problems must not kill the loop
            errs += 1
            print(f"{datetime.now():%H:%M:%S} {name}: {e}", file=sys.stderr)
    # serviceAlerts: third feed, polled sparsely (alerts change rarely) via poll counter in main()
    return t, lines, errs


def write(out_dir, t, lines):
    if not lines:
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    day = datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d")
    blob = "".join(json.dumps(l, separators=(",", ":")) + "\n" for l in lines).encode()
    with gzip.open(out_dir / f"{day}.jsonl.gz", "ab") as f:
        f.write(blob)


def alert_lines(t):
    try:
        feed = fetch("serviceAlerts")
    except Exception as e:
        print(f"serviceAlerts: {e}", file=sys.stderr)
        return []
    n = len(feed.get("entity", []))
    return [{"k": "a", "t": t, "n": n, "e": feed.get("entity", [])}] if n else []


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--interval", type=float, default=10, help="seconds between polls (default 10; min 5)")
    ap.add_argument("--duration", type=float, default=0, help="stop after N seconds (0 = forever)")
    ap.add_argument("--once", action="store_true", help="single poll then exit")
    ap.add_argument("--out", type=Path, default=OUT, help="output directory")
    ap.add_argument("--max-stops", type=int, default=15, help="predicted stops kept per trip")
    ap.add_argument("--alerts-every", type=int, default=30, help="poll serviceAlerts every N polls")
    a = ap.parse_args()
    interval = max(5.0, a.interval)
    start, n = time.time(), 0
    try:
        while True:
            t0 = time.time()
            t, lines, errs = poll(a.out, a.max_stops)
            if n % max(1, a.alerts_every) == 0:
                lines += alert_lines(t)
            write(a.out, t, lines)
            n += 1
            nv = sum(1 for l in lines if l["k"] == "v")
            print(f"{datetime.now():%H:%M:%S} poll {n}: {nv} vehicles, {len(lines)} lines, {errs} errors", flush=True)
            if a.once or (a.duration and time.time() - start + interval > a.duration):
                break
            time.sleep(max(0.0, interval - (time.time() - t0)))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

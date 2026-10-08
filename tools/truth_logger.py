#!/usr/bin/env python3
"""Ground-truth arrival logger: polls Passio vehiclePositions + tripUpdates and appends one CSV row
per true bus arrival at a stop (schema in arrivals_lib.COLUMNS, docs in docs/DATA.md).

  python tools/truth_logger.py --once
  python tools/truth_logger.py --duration 180
  python tools/truth_logger.py --out some.csv --interval 10
No rider data exists in these feeds; nothing personal is collected.
"""
import argparse, json, sys, time, urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L

BASE = "https://passio3.com/chicago/passioTransit/gtfs/realtime/"
UA = "StraightBussing-collector (student project)"


def fetch(name, timeout=15):
    req = urllib.request.Request(BASE + name + ".json", headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def reports(feed):
    for e in feed.get("entity", []):
        v = e.get("vehicle") or {}
        pos, trip, veh = v.get("position") or {}, v.get("trip") or {}, v.get("vehicle") or {}
        if "latitude" not in pos or not trip.get("trip_id"):
            continue
        yield {"veh": veh.get("id"), "trip": trip.get("trip_id"), "route": trip.get("route_id"),
               "lat": pos.get("latitude"), "lon": pos.get("longitude"), "speed": pos.get("speed"),
               "q": v.get("current_stop_sequence"), "stop_id": v.get("stop_id"), "vt": v.get("timestamp")}


def store_predictions(tr, feed, now):
    for e in feed.get("entity", []):
        u = e.get("trip_update") or {}
        trip = (u.get("trip") or {}).get("trip_id")
        made = u.get("timestamp") or now
        made = min(made, now)
        for st in u.get("stop_time_update") or []:
            t = (st.get("arrival") or st.get("departure") or {}).get("time")
            if trip and t is not None and st.get("stop_id"):
                tr.add_prediction(trip, st["stop_id"], made, t)


class Writer:
    def __init__(self, path, st):
        self.path, self.st, self.n = Path(path), st, 0
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists() or self.path.stat().st_size == 0:
            self.path.write_text(",".join(L.COLUMNS) + "\n", encoding="utf-8", newline="\n")

    def write(self, events):
        if not events:
            return
        events.sort(key=lambda e: e["epoch"])
        with open(self.path, "a", encoding="utf-8", newline="") as f:
            for e in events:
                f.write(L.row_text(L.fmt_row(self.st, e)))
                self.n += 1
            f.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="single poll then exit")
    ap.add_argument("--duration", type=float, help="seconds to run")
    ap.add_argument("--interval", type=float, default=10)
    ap.add_argument("--out", default=str(L.DEFAULT_OUT))
    a = ap.parse_args()
    st = L.Static()
    if not st.route_stops:
        sys.exit("web/data/route_stops.json missing (run tools/build_gtfs.py)")
    tr, w = L.Tracker(st), Writer(a.out, st)
    tr.seed(L.read_tail(a.out), int(time.time()))
    end = time.time() + a.duration if a.duration else None
    polls = 0
    try:
        while True:
            t0 = time.time()
            now = int(t0)
            for name, fn in (("tripUpdates", lambda f: store_predictions(tr, f, now)), ("vehiclePositions", None)):
                try:
                    feed = fetch(name)
                except Exception as ex:   # network/JSON problems must not kill the loop
                    print(f"{datetime.now():%H:%M:%S} {name}: {ex}", file=sys.stderr)
                    continue
                if fn:
                    fn(feed)
                else:
                    ev = []
                    for rep in reports(feed):
                        ev += tr.update(rep, now)
                    w.write(ev + tr.drain(now))
            polls += 1
            if polls % 6 == 0:
                print(f"{datetime.now():%H:%M:%S} polls={polls} rows={w.n}", flush=True)
            if a.once or (end and time.time() + a.interval > end):
                break
            time.sleep(max(0.5, a.interval - (time.time() - t0)))
    except KeyboardInterrupt:
        pass
    finally:
        w.write(tr.drain(int(time.time()), final=True))
    print(f"done: {w.n} rows appended to {a.out}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""E32 (2026-11-11): rebuild, poll by poll, the three live feeds the app read on a past service day, so the SHIPPED web
code (web/js/data/live.js startLive and the planner) can replay what riders saw (replay.html, driven by replay.py).

Per Chicago service day (04:00 to 04:00), from the archived release assets (tools/archive_day.py) and the data branch:
  vehiclePositions  a 10 s grid (the app polls every 10 s) from the day's first to its last raw poll; at each grid time
                    every vehicle's latest report the collector had seen by then, if at most FRESH_S old (older ones are
                    ghosts core/operating.js drops; their last report time still reaches core/transition.js, which keeps
                    every bus's latest report). raw-polls-<day>.jsonl.gz keeps a vehicle only when its report changed,
                    so a bus Passio left out of a single poll (DC-015) cannot be seen: the replay is one poll smoother
                    than the real feed (the 45 s number hold and EMPTY_HOLD_S are not exercised by it).
  tripUpdates       pred-updates-<day>.jsonl.gz [veh, trip, stop, made, predicted, seq, seen, last]: a prediction is
                    on display from `seen` to `last` + SLACK_S (the logger re-logs a prediction about once a minute
                    while Passio shows it); per (vehicle, trip, stop) the newest one; one trip update per (vehicle,
                    trip), stops in sequence order, route from the day's GTFS trips.txt.
  serviceAlerts     data branch alerts.csv: every alert version from first_seen to last_seen + 120 s.
The static files the app loads (routes, stops, shapes, route_stops, service) are built from the day's own GTFS zip with
tools/build_gtfs.py (cached by zip content) plus today's learned web/data/corridors.json, idle.json and service_seen.json
(core/offroute.js, core/idle.js and core/seen.js check the line and the hours they were learned against, so an older
timetable simply does not use them; without service_seen.json no off-route bus is kept on screen as transitioning).

Output (one JSON file per day, read by replay.html):
  {day, grid_s, slack_s, static: <folder name>, alerts: [GTFS-rt alert], snaps: [[veh, trip, rid, [[stop, time], ...]]],
   polls: [[t, [[veh, trip, rid, lat, lon, bearing, speed, report time], ...], [snap index...], [alert index...]]]}

  python experiments/routeknower/E32-scripts/inputs.py --dl <dir> [<dir> ...] --alerts alerts.csv --days 2026-11-06 ...
      --out <work dir>
"""
import argparse, csv, gzip, hashlib, io, json, shutil, subprocess, sys, zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[3]
CT = ZoneInfo("America/Chicago")
GRID_S = 10          # web/js/data/live.js intervalMs
FRESH_S = 300        # core/operating.js STALE_S
LEARNED = ("corridors.json", "idle.json", "service_seen.json")   # learned web/data files the replayed rules read
SLACK_S = 60         # a logged prediction stays on display this long after the logger last saw it
ALERT_SLACK_S = 120


def day_bounds(day):
    d = date.fromisoformat(day)
    a = datetime(d.year, d.month, d.day, 4, tzinfo=CT)
    n = d + timedelta(days=1)
    b = datetime(n.year, n.month, n.day, 4, tzinfo=CT)
    return int(a.timestamp()), int(b.timestamp())


def find(dls, name):
    for d in dls:
        p = Path(d) / name
        if p.exists():
            return p
    return None


def static_for(zpath, cache):
    """Build the app's static JSON from a GTFS zip (tools/build_gtfs.py), cached by the zip's content."""
    h = hashlib.sha1()
    with zipfile.ZipFile(zpath) as z:
        for n in sorted(z.namelist()):
            h.update(n.encode()); h.update(z.read(n))
    key = "static-" + h.hexdigest()[:12]
    out = Path(cache) / key
    if not (out / "service.json").exists():
        out.mkdir(parents=True, exist_ok=True)
        subprocess.run([sys.executable, str(REPO / "tools" / "build_gtfs.py"), "--zip", str(zpath), "--out", str(out),
                        "--patterns", str(out / "route_patterns.json")], check=True, capture_output=True)
        for f in LEARNED:
            if (REPO / "web" / "data" / f).exists():
                shutil.copy2(REPO / "web" / "data" / f, out / f)
    return key


def trip_routes(zpath):
    with zipfile.ZipFile(zpath) as z, z.open("trips.txt") as f:
        return {str(r["trip_id"]): str(r["route_id"]) for r in csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))}


def load_alerts(path):
    out = []
    for r in csv.DictReader(open(path, encoding="utf-8")):
        try:
            a, b = int(r["first_seen"]), int(r["last_seen"])
        except (ValueError, KeyError):
            continue
        periods = []
        for p in (r.get("active_periods") or "").replace(",", ";").split(";"):
            if "/" in p:
                s, e = p.split("/", 1)
                periods.append({k: int(v) for k, v in (("start", s), ("end", e)) if v.strip().isdigit()})
        ents = [{"agency_id": r.get("agency_ids") or "", "route_id": x.strip()}
                for x in (r.get("route_ids") or "").replace(",", ";").split(";") if x.strip()]
        if not ents:
            ents = [{"agency_id": r.get("agency_ids") or ""}]
        alert = {"active_period": periods, "informed_entity": ents,
                 "header_text": {"translation": [{"text": r.get("header") or "", "language": "en"}]},
                 "description_text": {"translation": [{"text": r.get("description") or "", "language": "en"}]}}
        out.append((a, b + ALERT_SLACK_S, alert))
    return out


def build_day(day, dls, alerts, cache):
    t0, t1 = day_bounds(day)
    raw = find(dls, f"raw-polls-{day}.jsonl.gz")
    pred = find(dls, f"pred-updates-{day}.jsonl.gz")
    zp = find(dls, f"gtfs-{day}.zip")
    if not (raw and pred and zp):
        raise SystemExit(f"{day}: missing input (raw {raw}, pred {pred}, gtfs {zp})")
    key = static_for(zp, cache)
    trips = trip_routes(zp)
    polls = []
    with gzip.open(raw, "rt", encoding="utf-8") as f:
        for ln in f:
            try:
                p = json.loads(ln)
            except ValueError:
                continue
            t = int(p.get("t") or 0)
            if t0 <= t < t1:
                polls.append((t, p.get("v") or []))
    polls.sort(key=lambda x: x[0])
    rows = []
    with gzip.open(pred, "rt", encoding="utf-8") as f:
        for ln in f:
            try:
                x = json.loads(ln)
                veh, trip, stop, made, pt, seq = str(x[0]), str(x[1]), str(x[2]), int(x[3]), int(x[4]), int(x[5] or 0)
                seen = int(x[6]) if len(x) > 6 else made
                last = int(x[7]) if len(x) > 7 else seen
            except (ValueError, TypeError, IndexError):
                continue
            if veh and veh != "None":
                rows.append((seen, last, veh, trip, stop, made, pt, seq))
    rows.sort()
    if not polls:
        raise SystemExit(f"{day}: no polls")
    g = -(-polls[0][0] // GRID_S) * GRID_S
    end = polls[-1][0]
    latest, active = {}, {}
    snaps, snap_ix, out_polls = [], {}, []
    pi = ri = 0
    alert_ix = {}
    while g <= end:
        while pi < len(polls) and polls[pi][0] <= g:
            for v in polls[pi][1]:
                try:
                    veh, vt = str(v[0]), int(v[10] or 0)
                    lat, lon = float(v[3]), float(v[4])
                except (ValueError, TypeError, IndexError):
                    continue
                if vt and vt > latest.get(veh, (0,))[0]:
                    spd = None if v[6] is None else round(float(v[6]), 2)
                    brg = None if v[5] is None else round(float(v[5]), 1)
                    latest[veh] = (vt, [veh, str(v[1]) if v[1] is not None else "", str(v[2]) if v[2] is not None else "",
                                        round(lat, 7), round(lon, 7), brg, spd, vt])
            pi += 1
        while ri < len(rows) and rows[ri][0] <= g:
            seen, last, veh, trip, stop, made, pt, seq = rows[ri]
            k = (veh, trip, stop)
            cur = active.get(k)
            if cur is None or (made, seen) >= (cur[0], cur[3]):
                active[k] = (made, pt, seq, seen, last)
            elif last > cur[4] and made == cur[0]:
                active[k] = (made, pt, seq, cur[3], last)
            ri += 1
        for k in [k for k, v in active.items() if v[4] + SLACK_S < g]:
            del active[k]
        vehicles = [r for vt, r in latest.values() if g - vt <= FRESH_S]
        vehicles.sort(key=lambda r: r[0])
        by = {}
        for (veh, trip, stop), (made, pt, seq, seen, last) in active.items():
            by.setdefault((veh, trip), []).append((seq, stop, pt))
        cur_route = {r[0]: r[2] for r in vehicles}
        sids = []
        for (veh, trip), lst in sorted(by.items()):
            lst.sort()
            rid = trips.get(trip) or cur_route.get(veh) or ""
            sk = (veh, trip, rid, tuple((s, p) for _, s, p in lst))
            i = snap_ix.get(sk)
            if i is None:
                i = snap_ix[sk] = len(snaps)
                snaps.append([veh, trip, rid, [[s, p] for _, s, p in lst]])
            sids.append(i)
        aids = []
        for j, (a, b, al) in enumerate(alerts):
            if a <= g <= b:
                if j not in alert_ix:
                    alert_ix[j] = len(alert_ix)
                aids.append(alert_ix[j])
        out_polls.append([g, vehicles, sids, aids])
        g += GRID_S
    alist = [None] * len(alert_ix)
    for j, i in alert_ix.items():
        alist[i] = alerts[j][2]
    return {"day": day, "grid_s": GRID_S, "slack_s": SLACK_S, "static": key, "alerts": alist, "snaps": snaps,
            "polls": out_polls}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dl", nargs="+", required=True, help="folders with raw-polls / pred-updates / gtfs per day")
    ap.add_argument("--alerts", required=True, help="the data branch's alerts.csv")
    ap.add_argument("--days", nargs="+", required=True)
    ap.add_argument("--out", required=True, help="work folder: <day>.json + static-<hash>/ folders")
    a = ap.parse_args(argv)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    alerts = load_alerts(a.alerts)
    for day in a.days:
        if (out / f"{day}.json").exists():
            print(day, "exists", file=sys.stderr)
            continue
        d = build_day(day, a.dl, alerts, out)
        (out / f"{day}.json").write_text(json.dumps(d, separators=(",", ":")), encoding="utf-8")
        print(day, len(d["polls"]), "polls", len(d["snaps"]), "trip update snapshots", d["static"], file=sys.stderr)


if __name__ == "__main__":
    main()

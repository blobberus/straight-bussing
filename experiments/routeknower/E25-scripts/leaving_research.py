#!/usr/bin/env python3
"""E25 (2026-10-30): can we tell, in real time and before it happens, which bus of a route is about to leave service?
Owner: "If you know which specific bus is going to leave its shift soon, specify it on the bus and on the map and on
the route". Truth = DC-020's LASTING drops (tools/bus_changes.py: a bus silent on its route 10 min while another bus
still reports, and no arrival on the route for 30 min after).

Every minute of each archived day, for every bus running on a route that has 2+ buses, compute candidate signals:
  a   Passio's live trip updates for the bus list only its current trip (no next-trip times) while another bus of the
      route has next-trip times
  b   the timetable (GTFS; no block_id, so shifts are rebuilt by chaining trips: a trip continues the shift of the
      trip that ended at its first stop 0 to 25 min before) says the bus's current trip is the last of its shift while
      the route keeps running (later trips start after it ends)
  c   the bus's current trip ends at a garage / lot stop
  and combinations. Precision = flagged minutes where the bus really leaves within H min; recall at 30 / 15 / 5 min
  before each lasting drop. Read-only; inputs are the release assets of the data archive.

  python experiments/routeknower/E25-scripts/leaving_research.py --dl <raw-polls+gtfs+changes dir> --pred <pred-updates dir>
      [--days 2026-10-20 ...] [--out results.json]
"""
import argparse, csv, gzip, io, json, sys, zipfile
from collections import defaultdict, Counter
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools"))
import arrivals_lib as L   # noqa: E402
import build_eta_dataset as B   # noqa: E402

FRESH_S = 90          # a report this old or older is a parked / offline bus (bus_changes.FRESH_S)
SHOWN_S = 90          # a prediction counts as on display this long after its last sighting
CHAIN_GAP_S = 25 * 60  # rebuilt shifts: the next trip starts 0 to 25 min after the previous one ended, at its last stop
LEADS = (30, 15, 5)
HORIZONS = (30, 45, 60)
GARAGE_WORDS = ("garage", " lot", "yard", "depot")


# ---------------------------------------------------------------- GTFS: trips, shifts
def load_gtfs(zpath, day):
    z = zipfile.ZipFile(zpath)
    rd = lambda n: list(csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig"))) if n in z.namelist() else []
    d = date.fromisoformat(day)
    ymd = d.strftime("%Y%m%d")
    wd = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")[d.weekday()]
    active = {r["service_id"] for r in rd("calendar.txt") if r.get(wd) == "1" and r["start_date"] <= ymd <= r["end_date"]}
    for r in rd("calendar_dates.txt"):
        if r["date"] == ymd:
            (active.add if r["exception_type"] == "1" else active.discard)(r["service_id"])
    freq = {r["trip_id"] for r in rd("frequencies.txt")}
    stops = {r["stop_id"]: r.get("stop_name", "") for r in rd("stops.txt")}
    trips = {r["trip_id"]: r for r in rd("trips.txt") if r["service_id"] in active and r["trip_id"] not in freq}
    st = defaultdict(list)
    for r in rd("stop_times.txt"):
        if r["trip_id"] not in trips:
            continue
        tm = (r.get("arrival_time") or r.get("departure_time") or "").strip()
        try:
            h, m, s = (int(x) for x in tm.split(":"))
            sec = h * 3600 + m * 60 + s
        except ValueError:
            sec = None
        st[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], sec))
    info = {}
    for tid, lst in st.items():
        lst.sort()
        timed = [x for x in lst if x[2] is not None]
        if not timed:
            continue
        info[tid] = {"route": trips[tid]["route_id"], "start": timed[0][2], "end": timed[-1][2],
                     "first_stop": lst[0][1], "last_stop": lst[-1][1], "last_name": stops.get(lst[-1][1], "")}
    return info


def rebuild_shifts(info):
    """Chain trips per route into shifts -> {trip: {"final": bool, "next_start_after_end": bool}}."""
    by_route = defaultdict(list)
    for tid, x in info.items():
        by_route[x["route"]].append((x["start"], tid))
    out = {}
    for rid, lst in by_route.items():
        lst.sort()
        chains = []   # [last_end, last_stop, [trips]]
        for start, tid in lst:
            x = info[tid]
            best = None
            for ch in chains:
                gap = start - ch[0]
                if ch[1] == x["first_stop"] and 0 <= gap <= CHAIN_GAP_S and (best is None or gap < best[0]):
                    best = (gap, ch)
            if best:
                ch = best[1]
                ch[0], ch[1] = x["end"], x["last_stop"]
                ch[2].append(tid)
            else:
                chains.append([x["end"], x["last_stop"], [tid]])
        starts = sorted(info[t]["start"] for _, t in lst)
        for ch in chains:
            for i, tid in enumerate(ch[2]):
                final = i == len(ch[2]) - 1
                end = info[tid]["end"]
                route_goes_on = any(s > end + 10 * 60 for s in starts)   # the route has trips starting after it
                out[tid] = {"final": final, "route_goes_on": route_goes_on}
    return out


# ---------------------------------------------------------------- feeds
def read_polls(path, t0, t1):
    """-> sorted list of (t, {veh: (trip, route, vt)})."""
    out = []
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            try:
                p = json.loads(line)
            except ValueError:
                continue
            t = p.get("t")
            if not t or not (t0 <= t < t1):
                continue
            cur = {}
            for v in p.get("v") or []:
                try:
                    veh, trip, route, vt = str(v[0]), str(v[1] or ""), str(v[2] or ""), int(v[10] or 0)
                except (IndexError, TypeError, ValueError):
                    continue
                if veh and route and vt and t - vt <= FRESH_S:
                    cur[veh] = (trip, route, vt)
            out.append((t, cur))
    out.sort(key=lambda x: x[0])
    return out


def read_preds(path, t0, t1):
    """-> {veh: [(seen, last, trip)]} (one entry per update)."""
    out = defaultdict(list)
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
                veh, trip, seen, last = str(r[0]), str(r[1]), int(r[6] or r[3]), int(r[7] or r[6] or r[3])
            except (ValueError, IndexError, TypeError):
                continue
            if last + SHOWN_S < t0 or seen > t1 + 3600:
                continue
            out[veh].append((seen, last, trip))
    for v in out.values():
        v.sort()
    return out


def shown_trips(preds, veh, q):
    return {trip for seen, last, trip in preds.get(veh, ()) if seen <= q <= last + SHOWN_S}


def read_drops(path):
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    return [r for r in rows if r["kind"] == "drop" and r.get("lasting") == "1"]


# ---------------------------------------------------------------- evaluation
def evaluate(day, dl, pdir):
    t0, t1 = B.day_bounds(day)
    info = load_gtfs(Path(dl) / f"gtfs-{day}.zip", day)
    shifts = rebuild_shifts(info)
    polls = read_polls(Path(dl) / f"raw-polls-{day}.jsonl.gz", t0, t1)
    preds = read_preds(Path(pdir) / f"pred-updates-{day}.jsonl.gz", t0, t1)
    drops = read_drops(Path(dl) / f"changes-{day}.csv")
    leave = defaultdict(list)   # (veh, route) -> [last_seen epochs of lasting drops]
    for r in drops:
        leave[(r["vehicle_id"], r["route_id"])].append(int(r["last_seen_epoch"]))
    loc0 = B.local_midnight(day)   # timetable seconds count from local midnight (GTFS noon - 12 h)

    # one sample per minute: the poll nearest each minute
    samples, last_min = [], None
    for t, cur in polls:
        m = t // 60
        if m != last_min:
            samples.append((t, cur))
            last_min = m
    rows = []   # (q, veh, route, signals dict, label_by_H dict)
    for q, cur in samples:
        by_route = defaultdict(list)
        for veh, (trip, route, vt) in cur.items():
            by_route[route].append((veh, trip))
        for route, buses in by_route.items():
            if len(buses) < 2:
                continue
            nexts = {}
            for veh, trip in buses:
                sh = shown_trips(preds, veh, q)
                nexts[veh] = bool(sh - {trip})
            for veh, trip in buses:
                sh = shown_trips(preds, veh, q)
                others_next = any(nexts[v] for v, _ in buses if v != veh)
                a = bool(sh) and not (sh - {trip}) and others_next
                x = info.get(trip)
                b = bool(x and shifts.get(trip, {}).get("final") and shifts.get(trip, {}).get("route_goes_on"))
                b_near = b and x is not None and (loc0 + x["end"]) - q <= 45 * 60   # its last trip ends within 45 min
                c = bool(x and any(w in (" " + x["last_name"].lower()) for w in GARAGE_WORDS))
                sig = {"a": a, "b": b, "b_near": b_near, "c": c, "a&b": a and b, "a&b_near": a and b_near,
                       "a|b_near": a or b_near, "b_near&c": b_near and c, "a&c": a and c}
                ls = leave.get((veh, route), [])
                lab = {H: any(q < e <= q + H * 60 for e in ls) for H in HORIZONS}
                rows.append((q, veh, route, sig, lab))
    # recall at a lead: the bus's state at last_seen - lead
    idx = defaultdict(dict)   # (veh, route) -> {minute: sig}
    for q, veh, route, sig, lab in rows:
        idx[(veh, route)][q // 60] = sig
    rec = []
    for r in drops:
        if int(r["buses_before"] or 0) < 2:
            continue
        e = int(r["last_seen_epoch"])
        k = (r["vehicle_id"], r["route_id"])
        for lead in LEADS:
            m = (e - lead * 60) // 60
            sig = idx[k].get(m) or idx[k].get(m - 1) or idx[k].get(m + 1)
            rec.append((r["route_name"], r["route_id"], r["buses_before"], lead, sig))
    return rows, rec, len(drops)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dl", required=True)
    ap.add_argument("--pred", required=True)
    ap.add_argument("--days", nargs="*", default=["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28"])
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    names = {}
    allrows, allrec, ndrops = [], [], 0
    for day in a.days:
        rows, rec, n = evaluate(day, a.dl, a.pred)
        allrows += [(day,) + r for r in rows]
        allrec += rec
        ndrops += n
        for x in rec:
            names[x[1]] = x[0]
        print(f"{day}: {len(rows)} bus-minutes on 2+ bus routes, {n} lasting drops", file=sys.stderr)
    sigs = list(allrows[0][4].keys()) if allrows else []
    res = {"days": a.days, "lasting_drops": ndrops, "bus_minutes": len(allrows), "signals": {}}
    for s in sigs:
        flagged = [r for r in allrows if r[4][s]]
        prec = {H: (sum(1 for r in flagged if r[5][H]) / len(flagged)) if flagged else None for H in HORIZONS}
        recall = {}
        for lead in LEADS:
            xs = [x for x in allrec if x[3] == lead]
            seen = [x for x in xs if x[4] is not None]
            recall[lead] = {"drops": len(xs), "bus_on_map": len(seen), "flagged": sum(1 for x in seen if x[4][s])}
        per_route = {}
        for rid in sorted({r[3] for r in allrows}):
            fr = [r for r in flagged if r[3] == rid]
            xs = [x for x in allrec if x[1] == rid and x[3] == 15 and x[4] is not None]
            per_route[names.get(rid, rid)] = {"flagged_min": len(fr), "prec45": (sum(1 for r in fr if r[5][45]) / len(fr)) if fr else None,
                                              "recall15": (sum(1 for x in xs if x[4][s]) / len(xs)) if xs else None, "drops15": len(xs)}
        false_buses = len({(r[0], r[2], r[3]) for r in flagged if not r[5][60]})
        res["signals"][s] = {"flagged_min": len(flagged), "precision": prec, "recall": recall, "per_route": per_route,
                             "false_alarm_bus_days": false_buses}
    txt = json.dumps(res, indent=1, default=str)
    if a.out:
        Path(a.out).write_text(txt, encoding="utf-8")
    print(txt)


if __name__ == "__main__":
    main()

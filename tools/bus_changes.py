#!/usr/bin/env python3
"""Bus count changes on a route (owner 2026-10-30: "A large propagating timing error I noticed originates from when
buses transition from 2 bus to 1 bus schedule. When collecting data, flag buses that are during a transition and mark
the one that disappears."). docs/DATA.md "bus_changes.csv", docs/DATA-COLLECTION-LOG.md DC-020.

Fed by every vehiclePositions poll of the collector (truth_logger.poll, so tools/replay_day.py reproduces it), it keeps
per route the set of buses running there (fresh reports, at most 90 s old like the detector's own rule, on a route the
static data knows) and writes one row per CONFIRMED change:
  drop  the route goes from N to N-1 buses (N >= 2) while it keeps running: a bus has sent no report on the route for
        GONE_S (10 min) while at least one other bus of the route reported within that time. Timed back to the leaving
        bus's last report. A route that empties (end of service, or a feed outage that silences every bus) is not a drop.
  add   N to N+1 (N >= 1): a bus newly reporting on the route for ADD_S (5 min, at least 3 reports). A route's first bus
        of the day is not an add. A bus first seen during a run's first ADD_S counts as already there (no row): an
        overlapping earlier run, which saw it arrive, writes that row.
Feed blips never count: Passio often sends an empty or partial list (DC-015); one report within GONE_S keeps a bus.
Overlapping collector runs see the same change: merge() drops copies (same route, kind and bus within MERGE_S).

  python tools/bus_changes.py merge --into data/ground_truth/bus_changes.csv --add run_changes.csv
  python tools/bus_changes.py detect --raw raw-polls-2026-10-27.jsonl.gz [--web-data DIR] --out changes.csv
"""
import argparse, csv, gzip, io, json, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L

COLUMNS = ("route_id", "route_name", "epoch", "local_time", "kind", "buses_before", "buses_after", "vehicle_id",
           "last_stop_id", "last_stop_name", "last_seen_epoch", "trip_id", "staying_vehicles", "sched_buses_hour",
           "sched_buses_next_hour", "expected", "moved_to_route", "returned_min", "lasting", "returning")
GONE_S = 600          # a bus silent on the route this long has left it (confirmation of a drop)
ADD_S = 300           # a new bus must report on the route this long (first to latest report) to count
MIN_REPORTS = 3       # ... with at least this many reports
FRESH_S = 90          # a report older than this (by the feed's own clock vs the poll) is a parked/offline bus
MERGE_S = 300         # the same change seen by two overlapping runs: epochs within this
LASTING_S = 1800      # a dropped bus that logs no arrival on the route for this long: a lasting drop (the transition);
                      # back sooner = a layover (between trips Passio leaves the bus out of the feed for 10 to 27 min)
RETURN_LOOK_S = 3 * 3600   # returned_min is looked for this far ahead
DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def sched_buses(st, rid, epoch):
    """Timetable buses for the Chicago clock hour of epoch (web/data/service.json days.<dow>.buses), or None."""
    try:
        t = L.chicago(epoch)
        day = ((getattr(st, "service", None) or {}).get("routes") or {}).get(str(rid), {}).get("days", {}).get(DAY_KEYS[t.weekday()])
        b = (day or {}).get("buses")
        return int(b[t.hour]) if b and len(b) > t.hour else None
    except (TypeError, ValueError, KeyError, IndexError, AttributeError):
        return None


def expected_change(st, rid, epoch, kind):
    """1 if the timetable's bus count falls (drop) / rises (add) between 30 min before and 30 min after, 0 if not,
    '' when the timetable does not say."""
    a, b = sched_buses(st, rid, epoch - 1800), sched_buses(st, rid, epoch + 1800)
    if a is None or b is None:
        return ""
    return int(b < a) if kind == "drop" else int(b > a)


class BusChanges:
    """Per-route running buses and their confirmed changes. observe() once per poll; rows are COLUMNS lists."""

    def __init__(self, st, t_start, out=None, gone_s=GONE_S, add_s=ADD_S, min_reports=MIN_REPORTS):
        self.st, self.t0, self.gone_s, self.add_s, self.min_reports = st, t_start, gone_s, add_s, min_reports
        self.seen = {}                          # (route, veh) -> {first, last, n, trip, stop}
        self.members = defaultdict(set)         # route -> buses counted as running there
        self.logged = {}                        # (route, veh) -> (stop_id, epoch) of its last logged arrival
        self.out = Path(out) if out else None
        self.n = 0
        if self.out and (not self.out.exists() or self.out.stat().st_size == 0):
            self.out.parent.mkdir(parents=True, exist_ok=True)
            self.out.write_text(",".join(COLUMNS) + "\n", encoding="utf-8", newline="")

    def _active(self, route, veh, now):
        s = self.seen.get((route, veh))
        return s is not None and now - s["last"] < self.gone_s

    def _row(self, route, veh, kind, epoch, before, after, staying, now):
        s = self.seen.get((route, veh)) or {}
        stop_id, stop_name = "", ""
        if kind == "drop":
            lg = self.logged.get((route, veh))
            stop_id = lg[0] if lg else (s.get("stop") or "")
            stop_name = (self.st.stops.get(str(stop_id)) or {}).get("name", "") if stop_id else ""
        moved = ""
        if kind == "drop":
            other = sorted((v["last"], r) for (r, vv), v in self.seen.items()
                           if vv == veh and r != route and now - v["last"] < FRESH_S * 2)
            moved = other[-1][1] if other else ""
        sh, sn = sched_buses(self.st, route, epoch), sched_buses(self.st, route, epoch + 3600)
        return [route, self.st.route_name(route), int(epoch), L.chicago(epoch).strftime("%Y-%m-%d %H:%M:%S"), kind,
                before, after, veh, stop_id, stop_name, int(s["last"]) if s.get("last") else "",
                s.get("trip") or "", ";".join(sorted(staying)), "" if sh is None else sh, "" if sn is None else sn,
                expected_change(self.st, route, epoch, kind), moved, "", "", ""]

    def observe(self, reports, now, events=()):
        """reports: truth_logger.reports() dicts of one poll; events: the arrivals the detector logged in it
        (for the leaving bus's last stop). -> confirmed change rows (also appended to `out`)."""
        for e in events or ():
            try:
                rid, veh = e["route"], e["veh"]
                sid = self.st.route_stops[rid][e["idx"]]
                k = (rid, veh)
                if k not in self.logged or e["epoch"] >= self.logged[k][1]:
                    self.logged[k] = (sid, e["epoch"])
            except (KeyError, IndexError, TypeError):
                continue
        for rep in reports:
            veh, route, trip = rep.get("veh"), rep.get("route"), rep.get("trip")
            vt = rep.get("vt") or now
            try:
                vt = int(vt)
            except (TypeError, ValueError):
                continue
            if not veh or not route or route not in self.st.route_stops or abs(now - vt) > FRESH_S:
                continue
            k = (route, veh)
            s = self.seen.get(k)
            if s is None or vt - s["last"] >= self.gone_s:        # first sighting, or back after leaving
                s = self.seen[k] = {"first": vt, "last": vt, "n": 0, "trip": trip, "stop": rep.get("stop_id")}
            if vt >= s["last"]:
                s["last"], s["trip"], s["stop"] = vt, trip, rep.get("stop_id") or s.get("stop")
            s["n"] += 1
        rows = []
        for (route, veh), s in list(self.seen.items()):         # adds
            mem = self.members[route]
            if veh in mem or not self._active(route, veh, now):
                continue
            if s["last"] - s["first"] < self.add_s or s["n"] < self.min_reports:
                continue
            others = {v for v in mem if self._active(route, v, now)}
            mem.add(veh)
            if others and s["first"] >= self.t0 + self.add_s:     # a real N -> N+1, seen arriving in this run
                rows.append(self._row(route, veh, "add", s["first"], len(others), len(others) + 1, others, now))
        for route, mem in list(self.members.items()):           # drops
            for veh in sorted(mem):
                s = self.seen.get((route, veh))
                if s is not None and now - s["last"] < self.gone_s:
                    continue
                others = {v for v in mem if v != veh and self._active(route, v, now)}
                mem.discard(veh)
                if others and s is not None:                     # the route keeps running: a real N -> N-1
                    rows.append(self._row(route, veh, "drop", s["last"], len(others) + 1, len(others), others, now))
        if rows and self.out:
            with open(self.out, "a", encoding="utf-8", newline="") as f:
                for r in rows:
                    f.write(L.row_text(r))
        self.n += len(rows)
        return rows


# ---------------------------------------------------------------- files
def read_rows(path):
    p = Path(path)
    if not p.exists() or p.stat().st_size == 0:
        return []
    with open(p, encoding="utf-8", newline="") as f:
        return [r for r in csv.DictReader(f) if r.get("route_id")]


def annotate(rows, arrivals, now=None):
    """Classify drops with the arrivals log (data/ground_truth/arrivals.csv rows as dicts), which knows where every bus
    went across all runs: returned_min = minutes from the drop to the bus's next logged arrival on the same route
    (within RETURN_LOOK_S); lasting = 1 if none within LASTING_S, 0 if sooner, blank while the log does not reach
    LASTING_S past the drop yet; moved_to_route = the route of the bus's first arrival elsewhere within LASTING_S (kept
    if the live check already named one). Adds: returning = 1 if the same bus dropped off this route in the
    LASTING_S before (a layover's end), else 0. rows are changed in place; -> rows."""
    by = defaultdict(list)
    latest = 0
    for a in arrivals:
        try:
            ep = int(float(a["epoch"]))
        except (KeyError, TypeError, ValueError):
            continue
        by[str(a.get("vehicle_id"))].append((ep, str(a.get("route_id"))))
        latest = max(latest, ep)
    for v in by.values():
        v.sort()
    if now is not None:
        latest = max(latest, int(now))
    drops = defaultdict(list)
    for r in rows:
        if r.get("kind") == "drop":
            drops[(r["route_id"], r["vehicle_id"])].append(int(float(r["epoch"])))
    for r in rows:
        ep, rid, veh = int(float(r["epoch"])), str(r["route_id"]), str(r["vehicle_id"])
        if r.get("kind") == "add":
            r["returning"] = int(any(ep - LASTING_S <= d < ep for d in drops[(rid, veh)]))
            continue
        later = [x for x in by.get(veh, []) if ep < x[0] <= ep + RETURN_LOOK_S]
        back = next((x[0] for x in later if x[1] == rid), None)
        r["returned_min"] = "" if back is None else round((back - ep) / 60)
        if back is not None and back - ep < LASTING_S:
            r["lasting"] = 0
        elif latest >= ep + LASTING_S:
            r["lasting"] = 1
        else:
            r["lasting"] = ""
        if not r.get("moved_to_route"):
            elsewhere = next((x[1] for x in later if x[1] != rid and x[0] <= ep + LASTING_S), None)
            r["moved_to_route"] = elsewhere or ""
    return rows


def merge(into, add, arrivals=None):
    """Add a run's change rows to the shared file; a copy (same route, kind, bus, epoch within MERGE_S) of a row
    already there is dropped. With `arrivals` (path to arrivals.csv) every row is (re)classified by annotate(). Sorted
    by epoch. -> rows added."""
    into = Path(into)
    have = read_rows(into)
    idx = defaultdict(list)
    for r in have:
        idx[(r["route_id"], r["kind"], r["vehicle_id"])].append(int(float(r["epoch"])))
    added = 0
    for r in read_rows(add):
        k = (r["route_id"], r["kind"], r["vehicle_id"])
        try:
            ep = int(float(r["epoch"]))
        except (TypeError, ValueError):
            continue
        if any(abs(ep - x) <= MERGE_S for x in idx[k]):
            continue
        idx[k].append(ep)
        have.append(r)
        added += 1
    if not have:                                 # nothing yet: no empty file on the data branch
        return 0
    if arrivals and Path(arrivals).exists():
        with open(arrivals, encoding="utf-8", newline="") as f:
            annotate(have, list(csv.DictReader(f)))
    elif not added and into.exists():
        return 0
    have.sort(key=lambda r: (int(float(r["epoch"])), r["route_id"], r["kind"], r["vehicle_id"]))
    into.parent.mkdir(parents=True, exist_ok=True)
    tmp = into.with_name(into.name + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(COLUMNS), lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        for r in have:
            w.writerow({c: r.get(c, "") for c in COLUMNS})
    tmp.replace(into)
    return added


def _lines(path):
    p = Path(path)
    opener = gzip.open if p.suffix == ".gz" else open
    with opener(p, "rt", encoding="utf-8") as f:
        for ln in f:
            yield ln


def polls_from_raw(paths):
    """RawPolls JSONL (truth_logger RawPolls / raw-polls-<day> assets) -> sorted [(t, [report dicts])]; polls of
    overlapping runs at the same second are merged."""
    by = defaultdict(dict)
    for p in paths:
        for ln in _lines(p):
            try:
                poll = json.loads(ln)
                t = int(poll["t"])
            except (ValueError, KeyError, TypeError):
                continue
            for v in poll.get("v") or []:
                try:
                    rep = {"veh": None if v[0] is None else str(v[0]), "trip": v[1], "route": None if v[2] is None else str(v[2]),
                           "lat": v[3], "lon": v[4], "speed": v[6], "q": v[7], "stop_id": v[8], "vt": v[10]}
                except (IndexError, TypeError):
                    continue
                if rep["veh"] and rep["trip"] and rep["lat"] is not None:
                    by[t][(rep["veh"], rep["vt"])] = rep
    return [(t, list(by[t].values())) for t in sorted(by)]


def detect(paths, st):
    """One pass over raw polls (a day's merged polls or one run's) -> change rows (COLUMNS lists)."""
    polls = polls_from_raw(paths)
    if not polls:
        return []
    bc = BusChanges(st, polls[0][0])
    rows = []
    for t, reps in polls:
        rows += bc.observe(reps, t)
    return rows


def day_changes(raw_paths, arrival_paths, st, t0, t1):
    """A day's changes rebuilt from its merged raw polls and classified with the arrivals log (archive_day.py: the
    bus-changes-<day> asset and the forecast table's bus_change_min / leaving_bus). -> row dicts in [t0, t1)."""
    rows = [dict(zip(COLUMNS, r)) for r in detect(raw_paths, st)]
    arr = []
    for p in arrival_paths:
        pth = Path(p)
        if not pth.exists():
            continue
        with (gzip.open(pth, "rt", encoding="utf-8", newline="") if pth.suffix == ".gz" else open(pth, encoding="utf-8", newline="")) as f:
            for a in csv.DictReader(f):
                try:
                    if t0 - 3600 <= int(float(a["epoch"])) <= t1 + RETURN_LOOK_S:
                        arr.append(a)
                except (KeyError, TypeError, ValueError):
                    continue
    annotate(rows, arr)
    return [r for r in rows if t0 <= int(float(r["epoch"])) < t1]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("merge", help="add a run's rows to the shared bus_changes.csv (duplicates dropped)")
    m.add_argument("--into", required=True)
    m.add_argument("--add", required=True, nargs="+")
    m.add_argument("--arrivals", help="arrivals.csv: classify drops (lasting / layover, returned_min, moved_to_route)")
    d = sub.add_parser("detect", help="find the changes in raw position polls")
    d.add_argument("--raw", required=True, nargs="+")
    d.add_argument("--web-data", default=str(L.WEB_DATA))
    d.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "merge":
        n = sum(merge(a.into, f, a.arrivals) for f in a.add)
        print(f"bus changes: {n} new rows merged into {a.into}")
    else:
        st = L.Static(Path(a.web_data))
        rows = detect(a.raw, st)
        with open(a.out, "w", encoding="utf-8", newline="") as f:
            f.write(",".join(COLUMNS) + "\n")
            for r in rows:
                f.write(L.row_text(r))
        print(f"{len(rows)} changes ({sum(1 for r in rows if r[4] == 'drop')} drops) -> {a.out}")


if __name__ == "__main__":
    main()

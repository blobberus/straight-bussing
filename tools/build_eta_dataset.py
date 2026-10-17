#!/usr/bin/env python3
"""Forecast-snapshot dataset for the owner's 10% rule (2026-10-12): what every source predicted, every minute,
for every bus arrival 0 to 45 minutes ahead, with the features known at that minute and the real arrival.

  python tools/build_eta_dataset.py --day 2026-10-13 --arrivals arrivals.csv --pred pred-updates-*.jsonl[.gz] \
      [--raw raw-polls-*.jsonl[.gz]] [--gtfs google_transit.zip] --out eta-2026-10-13.csv.gz [--summary s.csv]
  python tools/build_eta_dataset.py report data/eta/summary.csv        # pass rates by lead with day-bootstrap CIs

One row = (query minute t, bus, one of its arrivals in (t, t + 45 min]) plus rows for predictions Passio showed at t
for a visit that never happened (label_status no_arrival). Error = predicted - actual (positive = predicted too late,
the bus came early); rel = error / lead with lead = actual - t, so the 10% rule is one threshold at every lead:
|rel| <= 0.10 passes, rel > +0.01 is "too late" (reading B). Schema: docs/DATA.md "eta-<day>.csv.gz".

Passio's prediction at t follows the collector's attribution rules (tools/arrival_detector.py): this bus's own update
(an update without a vehicle id only if no other bus has the trip id), the loop-stop stop_sequence, first seen by t
and still shown within SHOW_GRACE_S, and only for the bus's NEXT visit on that trip; an update made before the
previous visit on the same trip, or predicting a time before or within 120 s after the bus's visit to the stop
before this arrival under any trip id (Passio lists the current lap under the next trip id: DC-011), is passio_status
previous_lap. When the own trip id shows nothing for this arrival at t (none, or only the previous lap) but did at an
earlier minute (the stop was still ahead of the bus), the bus's prediction under a trip id Passio re-matched it to
meanwhile counts, as in predictions.csv (DC-010: the detector's DC-008 rule, Tracker._other_trip_preds, reused as is;
never another bus, never its next trip, never its previous visit, not at loop stops).

Why two layouts: these query-centric rows are the training table (features at the moment a rider asks); the same
arrival appears in up to 45 rows, so evaluation takes ONE row per arrival and lead bin (summary(), and the
arrival-centric predictions.csv), never a plain average over rows. Stdlib only. Tests: tools/test_eta.py.
"""
import argparse, bisect, csv, gzip, io, json, math, random, statistics, sys, zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L
from arrival_detector import Tracker

STEP_S = 60
HORIZON_S = 2700                 # 45 min
KNOWN_S = 1800                   # the bus counts as known at t if it logged an arrival this recently (or a report)
REPORT_S = 300                   # a raw report this recent gives speed / standing / current trip
STAND_M = 40.0                   # standing: within this many metres of where it stopped
GROSS = lambda err, lead: abs(err) > max(600.0, 0.5 * lead)     # E19 gross miss: out of the pass rate, still counted
LEAD_BINS = ((0, 360, "0-6"), (360, 600, "6-10"), (600, 900, "10-15"), (900, 1200, "15-20"),
             (1200, 1800, "20-30"), (1800, 2701, "30-45"))
SOURCES = (("passio", "passio_epoch"), ("timetable", "tt_epoch"), ("timetable_delay", "ttd_epoch"))

COLUMNS = ("query_epoch,query_local,service_day,dow,day_type,cal_regime,hour,vehicle_id,route_id,route_name,trip_id,"
           "stop_id,stop_name,stop_index,visit_rank,next_trip,cur_trip_id,stops_away,dist_m,crosses_terminal,"
           "last_stop_id,last_arrival_epoch,last_age_s,speed_mps,standing_s,delay_s,actual_epoch,lead_s,label_status,"
           "passio_status,passio_epoch,passio_made_epoch,passio_seen_epoch,passio_age_s,passio_err_s,passio_rel,"
           "tt_epoch,tt_err_s,tt_rel,ttd_epoch,ttd_err_s,ttd_rel").split(",")
SUMMARY_COLUMNS = ("service_day,source,lead_bin,route,segment,targets,n,pass_10,pass_10_floor,late_1,early_10,"
                   "gross,gross_early,mae_s,median_err_s,pass_shrink,early_shrink").split(",")
# pass_shrink / early_shrink (2026-10-17): the owner's current goal, the 10 minute shrink (arrivals_lib.shrink_tol:
# 3 min at >= 30 min ahead, 2 at >= 20, 1 below); pass_10 / pass_10_floor / early_10 stay for the 10% rule history.


# ---------------------------------------------------------------- inputs
def _open(p):
    p = Path(p)
    return gzip.open(p, "rt", encoding="utf-8") if p.suffix == ".gz" else open(p, encoding="utf-8")


def service_day_of(epoch):
    """Chicago date with the night service (before 04:00) counted to the previous day."""
    return (L.chicago(epoch) - timedelta(hours=4)).date()


def day_bounds(day):
    """Service day 'YYYY-MM-DD' -> (start, end) epochs: 04:00 local to 04:00 the next day (DST-safe)."""
    d = date.fromisoformat(str(day))

    def local_epoch(dd, hh):
        guess = int(datetime(dd.year, dd.month, dd.day, hh, tzinfo=timezone.utc).timestamp())
        for _ in range(3):                    # local = utc + offset; iterate the offset
            off = (L.chicago(guess) - datetime.fromtimestamp(guess, timezone.utc).replace(tzinfo=None)).total_seconds()
            guess = int(datetime(dd.year, dd.month, dd.day, hh, tzinfo=timezone.utc).timestamp() - off)
        return guess
    return local_epoch(d, 4), local_epoch(d + timedelta(days=1), 4)


def local_midnight(day):
    """GTFS time zero of the service day: local noon minus 12 h (= 04:00 minus 4 h; DST switches at 2 AM)."""
    return day_bounds(day)[0] - 4 * 3600


def load_arrivals(paths, t0, t1):
    """arrivals.csv files -> per vehicle sorted [(epoch, trip, route, stop_id, idx)] in [t0, t1], one row per visit."""
    import model_core as C
    dicts = []
    for p in paths:
        with _open(p) as f:
            for d in csv.DictReader(f):
                ep = C._f(d.get("epoch"))
                if ep is not None and t0 - 3600 <= ep <= t1:
                    dicts.append(d)
    kept, _, _ = C.clean_dicts(dicts)       # drops a visit logged twice (E01)
    by = defaultdict(list)
    for d in kept:
        try:
            by[str(d["vehicle_id"])].append((int(d["epoch"]), str(d["trip_id"]), str(d["route_id"]), str(d["stop_id"]),
                                             int(d["stop_index"])))
        except (KeyError, ValueError):
            continue
    for v in by.values():
        v.sort()
    return by


def load_pred_updates(paths, t0, t1):
    """PredLog lines [veh, trip, stop, made, predicted, seq, seen?, last?] -> {(veh|None, trip, stop): sorted
    [(seen, last, made, predicted, seq)]}, one entry per update (earliest seen, latest last)."""
    best = {}
    for p in paths:
        with _open(p) as f:
            for ln in f:
                try:
                    x = json.loads(ln)
                    veh, trip, stop, made, pred, seq = x[:6]
                    seen = x[6] if len(x) > 6 else made
                    last = x[7] if len(x) > 7 else seen
                    made, pred = int(made), int(pred)
                    seen, last = max(made, int(seen)), max(made, int(seen), int(last))
                except (ValueError, TypeError):
                    continue
                if last < t0 - 3600 or seen > t1:
                    continue
                veh = None if veh in (None, "") else str(veh)
                seq = None if seq is None else int(seq)
                k = (veh, str(trip), str(stop), made, pred, seq)
                b = best.get(k)
                best[k] = (seen, last) if b is None else (min(b[0], seen), max(b[1], last))
    out = defaultdict(list)
    for (veh, trip, stop, made, pred, seq), (seen, last) in best.items():
        out[(veh, trip, stop)].append((seen, last, made, pred, seq))
    for v in out.values():
        v.sort()
    return out


def load_raw(paths, t0, t1):
    """RawPolls lines -> per vehicle sorted [(vt, lat, lon, speed, trip, standing_since)] (deduped on vt)."""
    seen, by = set(), defaultdict(list)
    for p in paths:
        with _open(p) as f:
            for ln in f:
                try:
                    poll = json.loads(ln)
                except ValueError:
                    continue
                for v in poll.get("v") or []:
                    try:
                        veh, trip, lat, lon, sp, vt = str(v[0]), v[1], float(v[3]), float(v[4]), v[6], int(v[10])
                    except (TypeError, ValueError, IndexError):
                        continue
                    if not t0 - 3600 <= vt <= t1 or (veh, vt) in seen:
                        continue
                    seen.add((veh, vt))
                    by[veh].append([vt, lat, lon, None if sp is None else float(sp), None if trip is None else str(trip)])
    for veh, v in by.items():
        v.sort()
        anchor = None
        for r in v:                           # standing_since: when it came to rest within STAND_M of here
            if anchor is None or L.hav_m(anchor[1], anchor[2], r[1], r[2]) > STAND_M:
                anchor = r
            r.append(anchor[0])
    return by


def load_timetable(gtfs_zip):
    """GTFS zip -> {trip_id: {(stop_id, occurrence): seconds after local midnight}} (None if unavailable).
    occurrence 0 = first time the trip lists the stop, -1 = last (a loop lists its terminal twice)."""
    if not gtfs_zip or not Path(gtfs_zip).exists():
        return None
    try:
        z = zipfile.ZipFile(gtfs_zip)
        rows = csv.DictReader(io.TextIOWrapper(z.open("stop_times.txt"), encoding="utf-8-sig"))
        freq = set()                          # headway trips (Downtown Campus Connector): no fixed times to compare
        if "frequencies.txt" in z.namelist():
            freq = {r["trip_id"].strip() for r in csv.DictReader(io.TextIOWrapper(z.open("frequencies.txt"), encoding="utf-8-sig"))}
    except (OSError, KeyError, zipfile.BadZipFile):
        return None
    tmp = defaultdict(list)
    for r in rows:
        tm = (r.get("arrival_time") or r.get("departure_time") or "").strip()
        try:
            h, m, s = (int(x) for x in tm.split(":"))
            sec = h * 3600 + m * 60 + s
        except ValueError:
            sec = None                        # a non-timepoint stop: GTFS leaves its time blank
        try:
            dist = float(r.get("shape_dist_traveled") or "nan")
            tmp[r["trip_id"].strip()].append([int(r["stop_sequence"]), r["stop_id"].strip(), sec, dist])
        except (ValueError, KeyError):
            continue
    tt = {}
    for trip, lst in tmp.items():
        if trip in freq:
            continue
        lst.sort()
        timed = [i for i, x in enumerate(lst) if x[2] is not None]
        for a, b in zip(timed, timed[1:]):    # interpolate the stops between two timepoints (shape distance, else order)
            sa, sb = lst[a][2], lst[b][2]
            da, db = lst[a][3], lst[b][3]
            for i in range(a + 1, b):
                di = lst[i][3]
                f = (di - da) / (db - da) if db > da and not math.isnan(di) else (i - a) / (b - a)
                lst[i][2] = round(sa + max(0.0, min(1.0, f)) * (sb - sa))
        d = {}
        for seq, sid, sec, _ in lst:
            if sec is None:
                continue
            d.setdefault((sid, 0), sec)
            d[(sid, -1)] = sec
        tt[trip] = d
    return tt


# ---------------------------------------------------------------- the table
class OtherTrips:
    """DC-010: the detector's rule for a lead the own trip id left empty (DC-008, Tracker._other_trip_preds), on the
    day's prediction updates. A Tracker holds every update of a bus with a vehicle id (a list per key: a whole day, not
    the live 400-entry window) and is asked for one lead at a time, with the bus's previous visit to the stop set from
    the day's arrivals as the live detector has it when the arrival is logged."""

    def __init__(self, preds, arrivals, st):
        self.tr = Tracker(st)
        self.tr.preds = defaultdict(list)
        for (veh, trip, sid), lst in preds.items():
            if veh is None:
                continue
            for seen, last, made, pred, seq in lst:      # in the order first seen, as the live polls add them
                self.tr.add_prediction(trip, sid, made, pred, seq, veh, seen=seen, last=last)
        self.prev = defaultdict(list)                     # (veh, stop) -> sorted [(epoch, trip, idx)] of its visits
        for veh, lst in arrivals.items():
            for ep, trip, rid, sid, idx in lst:
                self.prev[(veh, sid)].append((ep, trip, idx))
        for v in self.prev.values():
            v.sort()

    def at(self, veh, trip, sid, ep, t):
        """The bus's prediction for its arrival at sid (epoch ep, own trip `trip`) shown at t under another trip id
        -> ((seen, last, made, pred, seq), other trip id) | None."""
        tr, key = self.tr, (veh, sid)
        lst = self.prev.get(key, ())
        i = bisect.bisect_left(lst, (ep,))
        if i:
            tr.visits[key] = lst[i - 1]
        else:
            tr.visits.pop(key, None)
        got = tr._other_trip_preds(trip, sid, ep, veh, [ep - t]).get(ep - t)
        if got is None:
            return None
        pred, made, seen = got
        for tr2 in sorted({t2 for t2, s2 in tr.bus_keys.get(veh, ()) if s2 == sid and t2 != trip}):
            x = tr._shown(tr.preds.get((veh, tr2, sid)), t)
            if x is not None and (x[0], x[1], x[3]) == (made, pred, seen):
                return (seen, x[4], made, pred, x[2]), tr2
        return (seen, seen, made, pred, None), None


class Index:
    """Sorted per-key lists with a cached key column for bisect."""
    def __init__(self, d):
        self.d, self.k = d, {k: [x[0] for x in v] for k, v in d.items()}

    def upto(self, key, t):
        ks = self.k.get(key)
        if not ks:
            return None
        i = bisect.bisect_right(ks, t)
        return self.d[key][i - 1] if i else None

    def after(self, key, t):
        ks = self.k.get(key)
        if not ks:
            return []
        return self.d[key][bisect.bisect_right(ks, t):]


def _fmt(x, nd=0):
    if x is None:
        return ""
    if isinstance(x, float):
        return f"{x:.{nd}f}" if nd else str(int(round(x)))
    return str(x)


def build(day, arrivals, preds, raw=None, timetable=None, st=None, step=STEP_S, horizon=HORIZON_S, cal=()):
    """-> list of row dicts (COLUMNS) for one service day."""
    st = st or L.Static()
    t0, t1 = day_bounds(day)
    raw = raw or {}
    raw_idx = Index(raw)
    pred_seen = {k: [e[0] for e in v] for k, v in preds.items()}
    midnight = local_midnight(day)
    try:
        from context_join import regime_on
        regime = regime_on(cal, str(day)) if cal else ""
    except Exception:
        regime = ""
    trip_buses = defaultdict(list)           # trip -> [(epoch, veh)] (shared trip ids)
    visits = defaultdict(list)               # (veh, trip, stop) -> sorted arrival epochs
    stop_visits = defaultdict(list)          # (veh, stop) -> sorted (arrival epoch, stop index), any trip id
    for veh, lst in arrivals.items():
        for ep, trip, rid, sid, idx in lst:
            trip_buses[trip].append((ep, veh))
            visits[(veh, trip, sid)].append(ep)
            stop_visits[(veh, sid)].append((ep, idx))
    for v in list(trip_buses.values()) + list(visits.values()) + list(stop_visits.values()):
        v.sort()
    live = defaultdict(lambda: defaultdict(set))   # veh -> minute -> {(trip, stop)} Passio could be showing then
    for (veh, trip, sid), lst in preds.items():
        if veh is None:
            continue
        lo, hi = min(e[0] for e in lst), max(e[1] for e in lst) + L.SHOW_GRACE_S
        for m in range(lo // 60, hi // 60 + 1):
            live[veh][m].add((trip, sid))

    def only_bus(trip, veh, t):
        lst = trip_buses.get(trip, ())
        i = bisect.bisect_left(lst, (t - 600, ""))
        while i < len(lst) and lst[i][0] <= t + 600:
            if lst[i][1] != veh:
                return False
            i += 1
        return True

    def shown(veh, trip, sid, t, seq_want, loop, ep=None):
        """Passio's update on display at t for this bus's next visit -> (status, entry|None). ep: that visit's
        arrival, to check the time against the bus's visit to the stop before it (any trip id, as the detector)."""
        key = (veh, trip, sid)
        if key not in preds:
            key = (None, trip, sid)
            if key not in preds or not only_bus(trip, veh, t):
                return "none", None
        lst, i = preds[key], bisect.bisect_right(pred_seen[key], t)
        best = None
        while i > 0:                          # newest first seen by t (at a loop stop: the matching stop_sequence)
            e = lst[i - 1]
            if not (loop and e[4] is not None and seq_want is not None and e[4] != seq_want):
                best = e
                break
            i -= 1
        if best is None or best[1] < t - L.SHOW_GRACE_S:
            return "none", None
        ev = visits.get((veh, trip, sid), [])
        i = bisect.bisect_right(ev, t)
        pv = ev[i - 1] if i else None        # the bus's previous visit on this trip, before t
        if pv is not None and t - pv <= 2 * L.STATE_TTL and (best[2] <= pv or best[3] < pv + L.PREV_VISIT_GAP_S):
            return "previous_lap", best
        if ep is not None:                   # Passio listed the bus's earlier visit (current lap, next trip id: DC-011)
            sv = stop_visits.get((veh, sid), [])
            k = bisect.bisect_left(sv, (ep, -1))
            pa = sv[k - 1] if k else None
            if (pa is not None and ep - pa[0] <= 2 * L.STATE_TTL and best[3] < pa[0] + L.PREV_VISIT_GAP_S
                    and not (loop and best[4] is not None and best[4] == seq_want and pa[1] + 1 != seq_want)):
                return "previous_lap", best
        return "shown", best

    other = None                             # OtherTrips, built on first use (DC-010)
    own = set()                              # (veh, arrival epoch, stop): its own trip id showed it at an earlier minute
    rows = []
    vehicles = sorted(set(arrivals) | set(live))
    for veh in vehicles:
        lst = arrivals.get(veh, [])
        ts = [x[0] for x in lst]
        rep = raw.get(veh, [])
        first = min([x[0] for x in lst[:1]] + [x[0] for x in rep[:1]] or [t1])
        start = max(t0, (first - horizon) // step * step + step)
        for t in range(start, t1, step):
            j = bisect.bisect_right(ts, t)
            last = lst[j - 1] if j else None
            r = raw_idx.upto(veh, t)
            if r is not None and t - r[0] > REPORT_S:
                r = None
            known = (last is not None and t - last[0] <= KNOWN_S) or r is not None
            fut = [a for a in lst[j:] if a[0] <= t + horizon]
            if not fut and not known:
                if j >= len(lst) and (not rep or rep[-1][0] < t):
                    break
                continue
            cur_trip = (r[4] if r is not None and r[4] else None) or (last[1] if last else None)
            speed = r[3] if r is not None else None
            standing = (t - r[5]) if r is not None else None
            delay = None
            if timetable and last and last[1] in timetable:
                rs = st.route_stops.get(last[2]) or []
                occ = -1 if rs and last[4] == len(rs) - 1 and len(rs) > 1 and rs[0] == rs[-1] else 0
                sec = timetable[last[1]].get((last[3], occ))
                if sec is not None:
                    delay = last[0] - (midnight + sec)
            ranks, matched = defaultdict(int), set()
            loc = L.chicago(t)
            base = {"query_epoch": t, "query_local": loc.strftime("%Y-%m-%d %H:%M"), "service_day": str(day),
                    "dow": loc.weekday(), "day_type": "weekend" if loc.weekday() >= 5 else "weekday",
                    "cal_regime": regime, "hour": loc.hour, "vehicle_id": veh, "cur_trip_id": cur_trip or "",
                    "last_stop_id": last[3] if last else "", "last_arrival_epoch": last[0] if last else "",
                    "last_age_s": (t - last[0]) if last else "", "speed_mps": _fmt(speed, 1) if speed is not None else "",
                    "standing_s": standing if standing is not None else "", "delay_s": "" if delay is None else delay}
            for ep, trip, rid, sid, idx in fut:
                rs = st.route_stops.get(rid) or []
                loop = rs.count(sid) > 1
                ranks[(trip, sid, idx if loop else None)] += 1
                rank = ranks[(trip, sid, idx if loop else None)]
                nxt = bool(cur_trip) and trip != cur_trip
                stops_away = dist = None
                crosses = nxt
                if last and rs:
                    n = len(rs)
                    if trip == last[1] and rid == last[2] and idx > last[4]:
                        stops_away = idx - last[4]
                        d, _ = st.dist_between(rid, last[4], idx) if idx > last[4] else (None, None)
                        dist = d
                    elif rid == last[2] and trip != last[1]:
                        stops_away = (n - 1 - last[4]) + idx
                        d1 = st.dist_between(rid, last[4], n - 1)[0] if last[4] < n - 1 else 0.0
                        d2 = st.dist_between(rid, 0, idx)[0] if idx > 0 else 0.0
                        dist = None if d1 is None or d2 is None else d1 + d2
                        crosses = True
                status, e = ("none", None)
                if rank == 1:
                    status, e = shown(veh, trip, sid, t, idx + 1, loop, ep)
                    if status == "shown":
                        own.add((veh, ep, sid))
                    elif not loop and (veh, ep, sid) in own:     # a lead the own trip id left empty (DC-010)
                        other = other or OtherTrips(preds, arrivals, st)
                        got = other.at(veh, trip, sid, ep, t)
                        if got is not None:
                            (e, tr2), status = got, "shown"
                            if tr2:                              # the same time is no phantom visit under tr2
                                matched.add((tr2, sid, None))
                    if e is not None:
                        matched.add((trip, sid, e[4] if loop else None))
                row = dict(base, route_id=rid, route_name=st.route_name(rid), trip_id=trip, stop_id=sid,
                           stop_name=(st.stops.get(sid) or {}).get("name", ""), stop_index=idx, visit_rank=rank,
                           next_trip=int(nxt), stops_away=_fmt(stops_away), dist_m=_fmt(dist), crosses_terminal=int(crosses),
                           actual_epoch=ep, lead_s=ep - t, label_status="arrived", passio_status=status)
                if status == "shown":
                    row.update(passio_epoch=e[3], passio_made_epoch=e[2], passio_seen_epoch=e[0], passio_age_s=t - e[2])
                if timetable and trip in timetable:
                    occ = -1 if loop and idx == len(rs) - 1 else 0
                    sec = timetable[trip].get((sid, occ))
                    if sec is not None:
                        row["tt_epoch"] = midnight + sec
                        if delay is not None:
                            row["ttd_epoch"] = midnight + sec + delay
                _errors(row)
                rows.append(row)
            # Passio showed a visit that no logged arrival matches: a rider-facing count, not a training label
            for (trip, sid) in sorted(live.get(veh, {}).get(t // 60, ())):
                status, e = shown(veh, trip, sid, t, None, False)
                if e is None or status != "shown" or not t < e[3] <= t + horizon:
                    continue
                if (trip, sid, None) in matched or (trip, sid, e[4]) in matched:
                    continue
                if any(a[1] == trip and a[3] == sid for a in fut) or any(
                        a[1] == trip and a[3] == sid and abs(a[0] - e[3]) <= 1800 for a in lst):
                    continue
                rows.append(dict(base, route_id="", route_name="", trip_id=trip, stop_id=sid,
                                 stop_name=(st.stops.get(sid) or {}).get("name", ""), stop_index="", visit_rank="",
                                 next_trip=int(bool(cur_trip) and trip != cur_trip), stops_away="", dist_m="",
                                 crosses_terminal="", actual_epoch="", lead_s=e[3] - t, label_status="no_arrival",
                                 passio_status="shown", passio_epoch=e[3], passio_made_epoch=e[2],
                                 passio_seen_epoch=e[0], passio_age_s=t - e[2]))
    rows.sort(key=lambda r: (r["query_epoch"], r["vehicle_id"], r["lead_s"]))
    return rows


def _errors(row):
    lead = row["lead_s"]
    for name, col in SOURCES:
        p = row.get(col)
        if p in (None, ""):
            continue
        err = p - row["actual_epoch"]
        pre = {"passio": "passio", "timetable": "tt", "timetable_delay": "ttd"}[name]
        row[pre + "_err_s"] = err
        row[pre + "_rel"] = f"{err / lead:.4f}" if lead > 0 else ""


def write_rows(rows, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    opener = (lambda: gzip.open(path, "wt", encoding="utf-8", newline="", compresslevel=9)) if path.suffix == ".gz" \
        else (lambda: open(path, "w", encoding="utf-8", newline=""))
    with opener() as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(COLUMNS)
        for r in rows:
            w.writerow(["" if r.get(c) is None else r.get(c, "") for c in COLUMNS])


# ---------------------------------------------------------------- aggregation
def lead_bin(lead):
    return next((b[2] for b in LEAD_BINS if b[0] <= lead < b[1]), None)


def summary(rows, day):
    """One sample per (arrival, lead bin, source): the row whose lead is nearest the bin middle (rows of one arrival
    are near-copies; averaging them all would weight long waits). -> list of SUMMARY_COLUMNS dicts, for all routes
    and per route (segment all), and current trip vs next trip (route ALL)."""
    mids = {b[2]: (b[0] + min(b[1], HORIZON_S)) / 2 for b in LEAD_BINS}
    picks = {}                                # (source, bin, arrival) -> (distance to mid, row)
    targets = defaultdict(set)                # (bin, route, segment) -> arrivals with any row in the bin
    for r in rows:
        if r.get("label_status") != "arrived" or not r["lead_s"] or r["lead_s"] <= 0:
            continue
        b = lead_bin(r["lead_s"])
        if b is None:
            continue
        akey = (r["vehicle_id"], r["stop_id"], r["actual_epoch"])
        seg = "next_trip" if r["next_trip"] else "current_trip"
        for g in (("ALL", "all"), (r["route_id"], "all"), ("ALL", seg)):
            targets[(b, g[0], g[1])].add(akey)
        for name, col in SOURCES:
            if r.get(col) in (None, ""):
                continue
            k = (name, b, akey)
            dist = abs(r["lead_s"] - mids[b])
            if k not in picks or dist < picks[k][0]:
                picks[k] = (dist, r)
    groups = defaultdict(list)
    for (name, b, akey), (_, r) in picks.items():
        err = r[{"passio": "passio_err_s", "timetable": "tt_err_s", "timetable_delay": "ttd_err_s"}[name]]
        seg = "next_trip" if r["next_trip"] else "current_trip"
        for g in (("ALL", "all"), (r["route_id"], "all"), ("ALL", seg)):
            groups[(name, b, g[0], g[1])].append((err, r["lead_s"]))
    out = []
    order = {b[2]: i for i, b in enumerate(LEAD_BINS)}
    for (name, b, route, seg), v in sorted(groups.items(), key=lambda kv: (kv[0][0], order[kv[0][1]], kv[0][2], kv[0][3])):
        ok = [(e, ld) for e, ld in v if not GROSS(e, ld)]
        n = len(ok)
        out.append({"service_day": str(day), "source": name, "lead_bin": b, "route": route, "segment": seg,
                    "targets": len(targets[(b, route, seg)]), "n": len(v),
                    "pass_10": sum(abs(e) <= 0.10 * ld for e, ld in ok),
                    "pass_10_floor": sum(abs(e) <= max(60.0, 0.10 * ld) for e, ld in ok),
                    "late_1": sum(e > 0.01 * ld for e, ld in v), "early_10": sum(e < -0.10 * ld for e, ld in v),
                    "gross": len(v) - n, "gross_early": sum(1 for e, ld in v if GROSS(e, ld) and e > 0),
                    "mae_s": round(statistics.fmean(abs(e) for e, _ in ok)) if ok else "",
                    "median_err_s": round(statistics.median(e for e, _ in ok)) if ok else "",
                    "pass_shrink": sum(abs(e) <= L.shrink_tol(ld) for e, ld in ok),
                    "early_shrink": sum(e < -L.shrink_tol(ld) for e, ld in v)})
    return out


def merge_summary(path, new_rows):
    """Replace the rows of the days in new_rows inside the summary CSV at path (created if missing)."""
    path = Path(path)
    days = {r["service_day"] for r in new_rows}
    old = []
    if path.exists():
        with open(path, encoding="utf-8", newline="") as f:
            old = [r for r in csv.DictReader(f) if r.get("service_day") not in days]
    allr = old + [{k: str(v) for k, v in r.items()} for r in new_rows]
    allr.sort(key=lambda r: (r["service_day"], r["source"], r["lead_bin"], r["route"], r["segment"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=SUMMARY_COLUMNS, lineterminator="\n")
        w.writeheader()
        for r in allr:
            w.writerow({c: r.get(c, "") for c in SUMMARY_COLUMNS})
    tmp.replace(path)
    return len(allr)


def report(path, boots=2000, seed=7, route="ALL", segment="all"):
    """Pass rates under the owner's goal (the 10 minute shrink; the 10% rule alongside) by source and lead bin across
    days, with a 95% bootstrap CI over days. Rows written before 2026-10-17 lack pass_shrink: those days count only
    for the 10% column until their summary is rebuilt."""
    with open(path, encoding="utf-8", newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["route"] == route and r["segment"] == segment]
    by = defaultdict(dict)
    for r in rows:
        if r.get("pass_shrink") in (None, ""):
            continue
        by[(r["source"], r["lead_bin"])][r["service_day"]] = (int(r["n"]) - int(r["gross"]), int(r["pass_shrink"]),
                                                              int(r["n"]), int(r["late_1"]), int(r["targets"]),
                                                              int(r["pass_10"]))
    rnd = random.Random(seed)
    order = {b[2]: i for i, b in enumerate(LEAD_BINS)}
    out = [f"Accuracy goal (10 minute shrink: 3 min at >= 30 min, 2 at >= 20, 1 below) by lead ({route}, {segment}); "
           "one sample per arrival and bin; 95% CI = bootstrap over days", "",
           "| source | lead min | days | n | pass | 95% CI | (old 10% rule) | too late > 1% | shown / targets |",
           "|---|---|---:|---:|---:|---|---:|---:|---:|"]
    for (src, b) in sorted(by, key=lambda k: (k[0], order.get(k[1], 9))):
        d = by[(src, b)]
        days = sorted(d)
        den = sum(x[0] for x in d.values())
        if not den:
            continue
        rate = sum(x[1] for x in d.values()) / den
        sims = []
        for _ in range(boots if len(days) > 1 else 0):
            pick = [d[rnd.choice(days)] for _ in days]
            s = sum(x[0] for x in pick)
            if s:
                sims.append(sum(x[1] for x in pick) / s)
        sims.sort()
        ci = f"{sims[int(0.025 * len(sims))]:.0%} to {sims[int(0.975 * len(sims)) - 1]:.0%}" if sims else "one day"
        n = sum(x[2] for x in d.values())
        late = sum(x[3] for x in d.values()) / n if n else 0
        tg = sum(x[4] for x in d.values())
        old = sum(x[5] for x in d.values()) / den
        out.append(f"| {src} | {b} | {len(days)} | {n} | {rate:.0%} | {ci} | {old:.0%} | {late:.0%} | {n / tg:.0%} |" if tg else
                   f"| {src} | {b} | {len(days)} | {n} | {rate:.0%} | {ci} | {old:.0%} | {late:.0%} | |")
    return "\n".join(out)


# ---------------------------------------------------------------- CLI
def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["report"]:
        ap = argparse.ArgumentParser(prog="build_eta_dataset.py report")
        ap.add_argument("summary")
        ap.add_argument("--route", default="ALL")
        ap.add_argument("--segment", default="all", choices=("all", "current_trip", "next_trip"))
        a = ap.parse_args(argv[1:])
        print(report(a.summary, route=a.route, segment=a.segment))
        return 0
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--day", required=True, help="service day YYYY-MM-DD (04:00 to 04:00 Chicago)")
    ap.add_argument("--arrivals", nargs="+", required=True)
    ap.add_argument("--pred", nargs="*", default=[], help="PredLog files (pred-updates artifacts, data/monitor/predlog)")
    ap.add_argument("--raw", nargs="*", default=[], help="raw position polls (raw-polls artifacts)")
    ap.add_argument("--gtfs", help="google_transit.zip for the timetable columns")
    ap.add_argument("--web-data", default=str(L.WEB_DATA))
    ap.add_argument("--calendar", default=str(L.ROOT / "data" / "calendar.json"))
    ap.add_argument("--step", type=int, default=STEP_S)
    ap.add_argument("--out", required=True, help="eta-<day>.csv or .csv.gz")
    ap.add_argument("--summary", help="also merge this day's aggregate rows into this summary CSV")
    a = ap.parse_args(argv)
    t0, t1 = day_bounds(a.day)
    st = L.Static(a.web_data)
    try:
        from context_join import load_calendar
        cal = load_calendar(a.calendar)
    except Exception:
        cal = ()
    rows = build(a.day, load_arrivals(a.arrivals, t0, t1 + HORIZON_S), load_pred_updates(a.pred, t0, t1 + HORIZON_S),
                 load_raw(a.raw, t0, t1), load_timetable(a.gtfs), st, a.step, cal=cal)
    write_rows(rows, a.out)
    shown = sum(1 for r in rows if r.get("passio_status") == "shown")
    print(f"{a.day}: {len(rows)} rows ({shown} with a Passio prediction shown) -> {a.out}")
    if a.summary:
        print(f"summary: {merge_summary(a.summary, summary(rows, a.day))} rows in {a.summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

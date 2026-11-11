#!/usr/bin/env python3
"""E32: what the app showed riders around transitions, measured on replay.py's results against what the buses did.

Two apps are compared on the same polls: `new` = the shipped rules (what data/live.js keeps: operating buses minus the
off-route and idle ones, trip updates minus those of off-route, idle and gone buses, numbers from core/busnum.js
numberStep) and `old` = the app before the rules (operating buses, every trip update, numbers in vehicle id order with
no hold). What the buses did = the data branch's arrivals.csv (the collector's logged arrivals, every source). Every
measure is per minute (the poll on each whole minute) and per line:

  ghost_time_min     a bus with times on display (predicted 1 to 30 min ahead) on a line that logs no arrival on that
                     line from 1 min before until 15 min after its last displayed time: every one of its times is a
                     ghost (robust to a missed detection at one stop). ghost_next_min: stop-minutes where such a ghost
                     is the FIRST time a stop shows for that line (the "next bus" a rider reads).
  ghost_badge_min    a bus on the map that logs no arrival on its line within 20 min before or after (parked, a garage
                     run near the line, between shifts).
  after_leave        leave episodes: a bus's last logged arrival on a line before 30 min or more without one (break,
                     shift end, line switch). kept_min = from that arrival to the last minute the app still showed the
                     bus on that line's map (from 5 min after it) or a ghost time from it; badge_min / time_min = how
                     many minutes of each.
  false_hide_min     a minute a rule (off, idle, gone) kept a bus or its times off the screen and the bus then logged an
                     arrival on its line within 15 min: it was coming to serve riders. Episodes = hidden stretches
                     (minutes merge within 2 min) with at least one such minute.
  plan_risky         planner samples (replay.html: stop pairs on each line that shows a bus, every 5 min): a bus leg
                     on a live time whose bus logged no arrival on the leg's line from 1 min before the sample until 15
                     min after the boarding time (ghost_board), or did but logged none from 2 min before to 15 min
                     after the time it was to reach the rider's stop (left_before_alight). top = the first option.
  num_swap           a bus shown in two polls in a row whose number changed from one number to another (Bus 1 to Bus 2);
                     num_flip = a swap undone within 2 min; join / leave = the number changed in a poll where a bus
                     joined or left the line; rule = that bus was operating in both polls and only a rule's verdict
                     changed (shown -> hidden or back); events = polls with at least one swap on the line.
A ghost or a risky leg whose bus sent no report at all through the judged span is not counted either (unseen_time_min,
plan_unseen): it may have driven the line unseen. A bus that reports too rarely for the arrivals log to see it serve (2+ reports within 30 min, median gap over 120 s,
like 12647 on the DCC on Nov 6) is not judged (the unjudged_sparse_* counts).
  rolling_min        a candidate rule, not shipped: minutes where a bus within 150 m of where it was 10 min ago shows a time
                     at its next stop 5+ min later than it showed 10 min ago (rolling_ghost_min = those that were ghosts:
                     the rule's precision and recall against ghost_time_min).
The golden check: at each of replay.html's arrivalsFor samples (every stop, every 15 min) this script's own reading of
the shown times must equal web/js/core/arrivals.js arrivalsFor on the shipped state (mismatches reported, expect 0).

Writes --out/summary.json (per period, app, line), --out/episodes.csv (leave episodes and false hides, the fixture
candidates) and --out/vehicles.csv (the buses behind each measure).

  python experiments/routeknower/E32-scripts/measure.py --work <work> --results <results> --arrivals arrivals.csv
      --periods before=2026-10-10:2026-11-05 after=2026-11-06:2026-11-10 --out <dir>
"""
import argparse, bisect, csv, json, math, sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

CT = ZoneInfo("America/Chicago")
LEAD_LO, LEAD_HI = 60, 1800       # displayed times 1 to 30 min ahead are judged
SERVED_PAD = 900                  # an arrival up to 15 min after the predicted time counts
BADGE_WIN = 1200                  # a badge is serving when the bus logs an arrival on its line within 20 min
LEAVE_GAP = 1800                  # 30 min without an arrival on the line after the last one = a leave
AFTER_GRACE = 300                 # a badge in the first 5 min after the last arrival is not counted (end of trip dwell)
FALSE_WIN = 900                   # a hidden bus that logs an arrival on its line within 15 min was coming to serve
FLIP_S = 120
ROLL_S, ROLL_M, ROLL_SLIDE_S = 600, 150, 300   # the ROLLING candidate (not shipped): still 10 min, times slid 5+ min
SPARSE_S = 120                    # core/transition.js SPARSE_S
GAP_OK_S = 180                    # a leave's display stretch continues over gaps this short
BACK_S = 1200                     # ... and ends 20 min before the bus's next arrival (it is coming back)


def ct(t, fmt="%Y-%m-%d %H:%M"):
    return datetime.fromtimestamp(t, CT).strftime(fmt)


def days_of(spec):
    a, b = spec.split(":")
    d, e = date.fromisoformat(a), date.fromisoformat(b)
    out = []
    while d <= e:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


class Arrivals:
    def __init__(self, path):
        vr, vs = defaultdict(list), defaultdict(list)
        with open(path, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                try:
                    e = int(r["epoch"])
                except (ValueError, KeyError):
                    continue
                v, rid, s = r["vehicle_id"], r["route_id"], r["stop_id"]
                vr[(v, rid)].append(e)
                vs[(v, s)].append(e)
        for d in (vr, vs):
            for k in d:
                d[k].sort()
        self.vr, self.vs = vr, vs

    def any_vr(self, v, rid, a, b):
        x = self.vr.get((v, rid))
        if not x:
            return False
        i = bisect.bisect_left(x, a)
        return i < len(x) and x[i] <= b

    def any_vs(self, v, stop, a, b):
        x = self.vs.get((v, stop))
        if not x:
            return False
        i = bisect.bisect_left(x, a)
        return i < len(x) and x[i] <= b

    def next_vr(self, v, rid, a):
        x = self.vr.get((v, rid))
        if not x:
            return None
        i = bisect.bisect_right(x, a)
        return x[i] if i < len(x) else None

    def leaves(self, t0, t1):
        """(v, rid, last arrival, next arrival or None) for every leave whose last arrival is in [t0, t1)."""
        out = []
        for (v, rid), x in self.vr.items():
            i = bisect.bisect_left(x, t0)
            while i < len(x) and x[i] < t1:
                nxt = x[i + 1] if i + 1 < len(x) else None
                if nxt is None or nxt - x[i] >= LEAVE_GAP:
                    out.append((v, rid, x[i], nxt))
                i += 1
        return out


class Reports:
    """Each bus's distinct report times on the day (from the replayed vehicle feed)."""
    def __init__(self, inp):
        by, pos = defaultdict(set), defaultdict(dict)
        for p in inp["polls"]:
            for v in p[1]:
                by[v[0]].add(int(v[7]))
                pos[v[0]][int(v[7])] = (v[3], v[4])
        self.t = {k: sorted(x) for k, x in by.items()}
        self.pos = {k: [(t, *pos[k][t]) for t in self.t[k]] for k in self.t}
        self.memo = {}

    def seen(self, v, a, b):
        """Did the bus send a report in [a, b]? A bus that sent none may have driven the line unseen (DCC 4324 left the
        feed on Lake Shore Drive at 08:28 on Nov 6 and reappeared downtown at 09:34): the arrivals log cannot judge it."""
        x = self.t.get(v) or []
        i = bisect.bisect_left(x, a)
        return i < len(x) and x[i] <= b

    def at(self, v, t):
        """The bus's latest reported position at or before t (lat, lon), or None."""
        x = self.pos.get(v) or []
        i = bisect.bisect_right(x, (t, 999, 999)) - 1
        return x[i][1:] if i >= 0 else None

    def sparse(self, v, t):
        """A bus that reports too rarely for the arrivals log to see it serve: 2+ reports within 30 min of t, and the
        median gap between them over SPARSE_S (12647 on the DCC reported every 5 to 15 min on Nov 6 while it drove the
        line and logged one arrival all day). A bus with fewer reports there has left the feed: judged as usual."""
        k = (v, t // 300)
        if k in self.memo:
            return self.memo[k]
        x = self.t.get(v) or []
        i, j = bisect.bisect_left(x, t - 1800), bisect.bisect_right(x, t + 1800)
        w = x[i:j]
        g = sorted(b - a for a, b in zip(w, w[1:]))
        r = len(w) >= 2 and g[len(g) // 2] > SPARSE_S
        self.memo[k] = r
        return r


def day_bounds(day):
    d = date.fromisoformat(day)
    a = datetime(d.year, d.month, d.day, 4, tzinfo=CT)
    n = d + timedelta(days=1)
    return int(a.timestamp()), int(datetime(n.year, n.month, n.day, 4, tzinfo=CT).timestamp())


class Tally(Counter):
    """Counts, plus hour_<measure> dicts (Chicago clock hour -> count) for the flags' scope."""
    def __missing__(self, k):
        if k.startswith("hour_"):
            self[k] = {}
            return self[k]
        return 0


def z():
    return defaultdict(Tally)


def hr(t):
    return datetime.fromtimestamp(t, CT).hour


def measure_day(day, inp, res, A, acc, epi, vehs, gold, work):
    snaps = inp["snaps"]
    RP = Reports(inp)
    ipolls = {p[0]: p for p in inp["polls"]}
    rpolls = res["polls"]
    t0, t1 = day_bounds(day)
    # per-minute display state for both apps
    shown = {"new": {}, "old": {}}     # minute -> {veh: rid}
    times = {"new": {}, "old": {}}     # minute -> {(veh, rid): [(stop, p)]}
    hidden = {}                        # minute -> [(veh, rid, rule)]
    service = Counter()                # line -> minutes with an operating bus
    prev = {"new": None, "old": None}
    prev_op = None
    last_change = {"new": {}, "old": {}}
    for k, rp in enumerate(rpolls):
        h, op, off, idle, gone, nums, away, onums = rp
        offs, idles, gones = set(off), {v for v, _ in idle}, set(gone)
        oprid = {v: r for v, r in op}
        newshown = {v: r for v, r in op if v not in offs and v not in idles}
        # numbers: swaps between consecutive polls
        for app, nm, sh in (("new", nums, newshown), ("old", onums, oprid)):
            pv = prev[app]
            if pv is not None:
                psh, pnm = pv
                joined = {r for v, r in sh.items() if psh.get(v) != r}
                left = {r for v, r in psh.items() if sh.get(v) != r}
                # a rule toggle: the bus was operating in both polls, only the rule's verdict changed (new app only)
                pop = prev_op or {}
                toggled = {r for v, r in list(sh.items()) + list(psh.items())
                           if (sh.get(v) == r) != (psh.get(v) == r) and pop.get(v) == r and oprid.get(v) == r}
                swapped = set()
                for v, r in sh.items():
                    if psh.get(v) != r:
                        continue
                    a, b = pnm.get(v, 0), nm.get(v, 0)
                    if a != b and a > 0 and b > 0:
                        c = acc[app][r]
                        c["num_swap"] += 1
                        c["hour_num_swap"][hr(h)] = c["hour_num_swap"].get(hr(h), 0) + 1
                        c["num_swap_join" if r in joined else "num_swap_leave" if r in left else "num_swap_other"] += 1
                        if r in toggled:
                            c["num_swap_rule"] += 1
                        if r not in swapped:
                            swapped.add(r)
                            c["num_swap_events"] += 1
                        lc = last_change[app].get(v)
                        if lc and lc[0] >= h - FLIP_S and lc[1] == b and lc[2] == a:
                            c["num_flip"] += 1
                        last_change[app][v] = (h, a, b)
                        vehs[(app, r, v)]["num_swap"] += 1
            prev[app] = (sh, nm)
        prev_op = oprid
        if h % 60:
            continue
        for r in set(oprid.values()):
            service[r] += 1
        ip = ipolls[h]
        drop = offs | idles | gones
        tn, to = defaultdict(list), defaultdict(list)
        for i in ip[2]:
            veh, trip, rid, stops = snaps[i]
            if not rid:
                continue
            for s, p in stops:
                if p > h - 30:
                    to[(veh, rid)].append((s, p))
                    if veh not in drop:
                        tn[(veh, rid)].append((s, p))
        shown["new"][h], shown["old"][h] = newshown, oprid
        times["new"][h], times["old"][h] = tn, to
        hl = [(v, oprid[v], "off") for v in off] + [(v, oprid[v], "idle") for v, _ in idle]
        for v in gone:
            rids = {snaps[i][2] for i in ip[2] if snaps[i][0] == v and snaps[i][2]}
            hl += [(v, r, "gone") for r in rids]
        hidden[h] = hl
    for r, n in service.items():
        acc["svc"][r]["service_min"] += n
    # golden check of this script's reading of the shown times against arrivalsFor
    js = Counter((a[0], a[1], a[2], a[3], a[4]) for a in res.get("arrivals") or [])
    if js or res.get("arrivals") is not None:
        mine = Counter()
        stops = json.loads((Path(work) / inp["static"] / "stops.json").read_text(encoding="utf-8"))
        for h in sorted({a[0] for a in res.get("arrivals") or []}):
            for (veh, rid), lst in times["new"].get(h, {}).items():
                for s, p in lst:
                    if s in stops:
                        mine[(h, s, rid, p, veh)] += 1
        gold["checked"] += sum(js.values())
        gold["mismatch"] += sum(((js - mine) + (mine - js)).values())
    # ghost times and badges, per minute
    ghost_min = {"new": set(), "old": set()}
    badge_min = {"new": set(), "old": set()}
    anytime = {"new": set(), "old": set()}
    for app in ("new", "old"):
        for h, tm in times[app].items():
            nxt = {}
            for (veh, rid), lst in tm.items():
                ahead = [(s, p) for s, p in lst if h + LEAD_LO < p <= h + LEAD_HI]
                if not ahead:
                    continue
                hi = max(p for _, p in ahead)
                c = acc[app][rid]
                anytime[app].add((h, veh, rid))
                if RP.sparse(veh, h):
                    c["unjudged_sparse_time_min"] += 1
                    continue
                ghost = not A.any_vr(veh, rid, h - 60, hi + SERVED_PAD)
                if ghost and not RP.seen(veh, h, hi + SERVED_PAD):
                    c["unseen_time_min"] += 1      # no report either: it may have served unseen (not counted)
                    continue
                c["time_min"] += 1
                if ghost:
                    c["ghost_time_min"] += 1
                    c["hour_ghost_time_min"][hr(h)] = c["hour_ghost_time_min"].get(hr(h), 0) + 1
                    ghost_min[app].add((h, veh, rid))
                    vehs[(app, rid, veh)]["ghost_time_min"] += 1
                # a candidate rule, NOT shipped: ROLLING times = the bus has stayed within ROLL_M for ROLL_S and its time
                # at its next stop slid ROLL_SLIDE_S or more later over that span (a parked bus whose times stay "18 min"
                # or "Now": DCC 12645 downtown and AP/DX 12644 at Goldblatt on Nov 6)
                s0, p0 = min(ahead, key=lambda x: x[1])
                was = [p for s, p in times[app].get(h - ROLL_S, {}).get((veh, rid), []) if s == s0]
                if was and p0 - min(was) >= ROLL_SLIDE_S:
                    q0, q1 = RP.at(veh, h - ROLL_S), RP.at(veh, h)
                    if q0 and q1 and hav(q0[0], q0[1], q1[0], q1[1]) <= ROLL_M:
                        c["rolling_min"] += 1
                        if ghost:
                            c["rolling_ghost_min"] += 1
                for s, p in lst:
                    if (s, rid) not in nxt or p < nxt[(s, rid)][0]:
                        nxt[(s, rid)] = (p, ghost)
            for (s, rid), (p, g) in nxt.items():
                if h + LEAD_LO < p <= h + LEAD_HI:
                    acc[app][rid]["next_min"] += 1
                    if g:
                        acc[app][rid]["ghost_next_min"] += 1
            for veh, rid in shown[app][h].items():
                c = acc[app][rid]
                if RP.sparse(veh, h):
                    c["unjudged_sparse_badge_min"] += 1
                    continue
                c["badge_min"] += 1
                if not A.any_vr(veh, rid, h - BADGE_WIN, h + BADGE_WIN):
                    c["ghost_badge_min"] += 1
                    c["hour_ghost_badge_min"][hr(h)] = c["hour_ghost_badge_min"].get(hr(h), 0) + 1
                    badge_min[app].add((h, veh, rid))
                    vehs[(app, rid, veh)]["ghost_badge_min"] += 1
    # leave episodes: how long the app kept showing the bus (its badge on the line or a time from it) after its last
    # arrival, as one stretch (gaps up to GAP_OK_S), ending BACK_S before its next arrival (it is coming back to serve)
    minutes = sorted(times["new"])
    for v, rid, last, nxt in A.leaves(t0, t1):
        end = min(nxt - BACK_S if nxt is not None else t1, t1)
        row = {"kind": "leave", "day": day, "route_id": rid, "vehicle_id": v, "start": ct(last), "start_epoch": last,
               "next_arrival_min": round((nxt - last) / 60, 1) if nxt else ""}
        if RP.sparse(v, last):
            acc["new"][rid]["leaves_unjudged_sparse"] += 1
            acc["old"][rid]["leaves_unjudged_sparse"] += 1
            continue
        for app in ("new", "old"):
            kept, nb, nt, ns, stretch = 0, 0, 0, 0, True
            prev_h = last
            i = bisect.bisect_right(minutes, last)
            while i < len(minutes) and minutes[i] < end:
                h = minutes[i]
                on = shown[app][h].get(v) == rid
                tm = (h, v, rid) in anytime[app]
                if on and h >= last + AFTER_GRACE:
                    nb += 1
                g = (h, v, rid) in ghost_min[app]
                if g:
                    nt += 1
                if g or (on and h >= last + AFTER_GRACE):
                    ns += 1
                if stretch:
                    if on or tm:
                        if h - prev_h > GAP_OK_S:
                            stretch = False
                        else:
                            kept, prev_h = (h - last) / 60, h
                    elif h - prev_h > GAP_OK_S:
                        stretch = False
                i += 1
            row[f"{app}_kept_min"], row[f"{app}_badge_min"], row[f"{app}_time_min"] = round(kept, 1), nb, nt
            row[f"{app}_shown_min"] = ns
            c = acc[app][rid]
            c["leaves"] += 1
            c["leave_kept_min"] += round(kept)
            c["leave_badge_min"] += nb
            c["leave_time_min"] += nt
            c["leave_shown_min"] += ns
            if ns >= 5:
                c["leaves_shown_5"] += 1
            if ns >= 15:
                c["leaves_shown_15"] += 1
            if kept >= 5:
                c["leaves_kept_5"] += 1
            if kept >= 15:
                c["leaves_kept_15"] += 1
        epi.append(row)
    # false hides (new app only), episodes per (vehicle, line, rule)
    stops = json.loads((Path(work) / inp["static"] / "stops.json").read_text(encoding="utf-8"))
    rstops = json.loads((Path(work) / inp["static"] / "route_stops.json").read_text(encoding="utf-8"))

    def where(v, rid, t):
        q = RP.at(v, t)
        if not q:
            return {}
        best = min(((hav(q[0], q[1], stops[s]["lat"], stops[s]["lon"]), s) for s in set(rstops.get(rid) or []) if s in stops),
                   default=None)
        return {"lat": round(q[0], 5), "lon": round(q[1], 5), "near_stop": best[1] if best else "",
                "near_stop_m": round(best[0]) if best else ""}
    runs = {}
    for h in minutes:
        for v, rid, rule in hidden.get(h, []):
            c = acc["new"][rid]
            if RP.sparse(v, h):
                c[f"unjudged_sparse_{rule}_min"] += 1
                continue
            nx = A.next_vr(v, rid, h)
            false = nx is not None and nx <= h + FALSE_WIN
            c[f"hide_{rule}_min"] += 1
            if false:
                c[f"false_{rule}_min"] += 1
                c[f"hour_false_{rule}_min"][hr(h)] = c[f"hour_false_{rule}_min"].get(hr(h), 0) + 1
                vehs[("new", rid, v)][f"false_{rule}_min"] += 1
            key = (v, rid, rule)
            r = runs.get(key)
            if r and h - r["last"] <= 120:
                r["last"] = h
                r["n"] += 1
                r["false"] += false
                if false and r["first_false"] is None:
                    r["first_false"], r["serve"] = h, nx
            else:
                if r:
                    _close(r, day, epi, acc, where)
                runs[key] = {"v": v, "rid": rid, "rule": rule, "start": h, "last": h, "n": 1, "false": int(false),
                             "first_false": h if false else None, "serve": nx if false else None}
    for r in runs.values():
        _close(r, day, epi, acc, where)
    # planner samples
    for rec in res.get("plans") or []:
        h, rid0, b0, a0 = rec[:4]
        for app, opts in (("new", rec[4]), ("old", rec[5])):
            for k, (walk, arrive, legs) in enumerate(opts):
                for rid, bs, als, v, bt, at, live, src in legs:
                    if not live or v is None:
                        continue
                    c = acc[app][rid]
                    if RP.sparse(v, h):
                        c["plan_unjudged_sparse"] += 1
                        continue
                    c["plan_live_legs"] += 1
                    if k == 0:
                        c["plan_top_live_legs"] += 1
                    ghost = not A.any_vr(v, rid, h - 60, bt + SERVED_PAD)
                    reached = A.any_vs(v, als, bt - 60, at + SERVED_PAD) or A.any_vr(v, rid, at - 120, at + SERVED_PAD)
                    left = (not ghost) and not reached
                    if (ghost and not RP.seen(v, h, bt + SERVED_PAD)) or (left and not RP.seen(v, bt, at + SERVED_PAD)):
                        c["plan_unseen"] += 1       # the bus sent no report then: it may have served unseen (not counted)
                        ghost = left = False
                    if ghost or left:
                        c["plan_risky"] += 1
                        c["hour_plan_risky"][hr(h)] = c["hour_plan_risky"].get(hr(h), 0) + 1
                        c["plan_ghost_board" if ghost else "plan_left_before_alight"] += 1
                        if k == 0:
                            c["plan_top_risky"] += 1
                        vehs[(app, rid, v)]["plan_risky"] += 1
                        if app == "new":
                            epi.append({"kind": "plan_" + ("ghost_board" if ghost else "left_before_alight"), "day": day,
                                        "route_id": rid, "vehicle_id": v, "start": ct(h), "start_epoch": h,
                                        "board": bs, "alight": als, "rank": k, "board_min": round((bt - h) / 60, 1),
                                        "ride_min": round((at - bt) / 60, 1)})


def hav(a, b, c, d):
    kx = 111320 * math.cos(math.radians((a + c) / 2))
    return math.hypot((d - b) * kx, (c - a) * 110540)


def _close(r, day, epi, acc, where):
    c = acc["new"][r["rid"]]
    c[f"hide_{r['rule']}_episodes"] += 1
    if r["false"]:
        c[f"false_{r['rule']}_episodes"] += 1
        epi.append({"kind": "false_" + r["rule"], "day": day, "route_id": r["rid"], "vehicle_id": r["v"],
                    "start": ct(r["start"]), "start_epoch": r["start"], "hidden_min": r["n"],
                    "false_min": r["false"], "served_after_min": round((r["serve"] - r["first_false"]) / 60, 1),
                    "first_false": ct(r["first_false"]), **where(r["v"], r["rid"], r["start"])})


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", required=True)
    ap.add_argument("--results", required=True)
    ap.add_argument("--arrivals", required=True)
    ap.add_argument("--periods", nargs="+", required=True, help="name=YYYY-MM-DD:YYYY-MM-DD")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    A = Arrivals(a.arrivals)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    summary, all_epi, all_veh = {"golden": {}, "periods": {}}, [], []
    for spec in a.periods:
        name, rng = spec.split("=")
        acc = {"new": z(), "old": z(), "svc": z()}
        epi, vehs, gold, days = [], defaultdict(Counter), Counter(), []
        for day in days_of(rng):
            ip, rp = Path(a.work) / f"{day}.json", Path(a.results) / f"{day}.json"
            if not (ip.exists() and rp.exists()):
                print(f"{name} {day}: no replay, skipped", file=sys.stderr)
                continue
            inp, res = json.loads(ip.read_text(encoding="utf-8")), json.loads(rp.read_text(encoding="utf-8"))
            if res.get("mismatch"):
                print(f"{day}: {res['mismatch']} polls where the reason chain and startLive disagree", file=sys.stderr)
            gold["chain_mismatch"] += res.get("mismatch") or 0
            measure_day(day, inp, res, A, acc, epi, vehs, gold, a.work)
            days.append(day)
            print(f"{name} {day} done", file=sys.stderr)
        for e in epi:
            e["period"] = name
            e["hour"] = hr(int(e["start_epoch"]))
        all_epi += epi
        for (app, rid, v), c in vehs.items():
            all_veh.append({"period": name, "app": app, "route_id": rid, "vehicle_id": v, **c})
        summary["golden"][name] = dict(gold)
        summary["periods"][name] = {"days": days, "lines": {
            rid: {"service_min": acc["svc"][rid]["service_min"], "new": dict(acc["new"][rid]), "old": dict(acc["old"][rid])}
            for rid in sorted(set(acc["new"]) | set(acc["old"]) | set(acc["svc"]))}}
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    cols = sorted({k for e in all_epi for k in e}, key=lambda k: (k not in ("period", "kind", "day", "route_id", "vehicle_id", "start"), k))
    with open(out / "episodes.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, cols)
        w.writeheader()
        w.writerows(all_epi)
    vcols = sorted({k for e in all_veh for k in e}, key=lambda k: (k not in ("period", "app", "route_id", "vehicle_id"), k))
    with open(out / "vehicles.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, vcols, restval=0)
        w.writeheader()
        w.writerows(all_veh)
    print(json.dumps(summary["golden"]), file=sys.stderr)


if __name__ == "__main__":
    main()

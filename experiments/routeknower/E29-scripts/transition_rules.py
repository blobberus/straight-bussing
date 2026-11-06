#!/usr/bin/env python3
"""E29 part 2: can the app tell that a bus is about to leave its route (so it stops recommending it), and which live
predictions belong to buses that have already left? Owner (2026-11-06): "add to the current display behavior of buses to
avoid recommending routes on buses that are about to leave their routes."

A. ABOUT TO LEAVE (visit level). Every logged arrival (route R, stop S, bus V, time T) is a visit; it is a LEAVE VISIT
   when it is V's last arrival on R before a lasting leave of V from R (transitions.csv: break / shift_end /
   route_switch / feed_drop) that comes within 20 min. Cues known live at T, scored on held-out days (trained on days up
   to --train-to, tested on the later ones; training rows use the other training days only):
     window  the leave rate of visits to (R, S) on the same day type within +-15 min of T's clock time
     trip    the leave rate of visits of the same trip id at S (timetabled lines)
     vehicle the leave rate of the same bus's visits to (R, S) on the same day type within +-15 min (the operator often
             gives a bus the same run: 4322's Apostolic break at South Campus Residence Hall at 08:43)
     passio  Passio shows the bus at no stop more than 5 min after T (read 5 min before T)
     plus on-route time, hours since the bus's first report, buses on the route, a small network on all of them.
   Precision = leave visits / flagged visits; the app would need it high (a wrong flag steers a rider away from a bus
   that serves them).
B. GONE (prediction level). Passio keeps trip updates for buses that left the vehicle feed. For every minute and every
   Passio prediction then visible (seen <= t <= last + 90 s, predicted time > t + 60 s) of a bus whose last report (any
   route) is at least X min old while the feed itself still lists fresh buses (one report within 300 s): was the predicted visit ever served (the
   bus logged an arrival at that stop between t - 60 s and the predicted time + 15 min)? Variants: plain, feed_alive,
   feed_alive_regular (also its last two reports at most SPARSE_S apart: a bus that reports only every few minutes
   drives on unseen between reports, and the arrival log misses its stops, DC-023 item 6). The shipped rule is
   feed_alive_regular at CHOSEN_GONE_MIN.
C. Writes data/labeled/transitions/leave_windows.csv (per line, day type and last stop: the clock windows in which a
   bus that made its last stop there left, at least 3 days; in-sample precision) for the forecast table's break_window
   and leave_spot_dist_m columns (tools/build_eta_dataset.py).

  python experiments/routeknower/E29-scripts/transition_rules.py --dl <E28 fetch.py folder>
      --transitions data/labeled/transitions/transitions.csv [--train-to 2026-10-28] [--windows-out ...] [--json e29b.json]
"""
import argparse, bisect, csv, json, pickle, sys, tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import transitions as T     # noqa: E402
O = T.O

LASTING = {"break", "shift_end", "route_switch", "feed_drop"}
LEAVE_AFTER_S = 1200        # a leave within 20 min of the visit makes it a leave visit
WIN_MIN = 15                # window cue: visits within +-15 min of the clock time
GONE_XS = (5, 8, 10, 12, 15, 20, 30)
CHOSEN_GONE_MIN = 15        # web/js/core/transition.js GONE_S / 60
SERVED_AFTER_S = 900        # a predicted visit counts as served up to 15 min after the predicted time
FEED_ALIVE_S = 300          # the feed is alive while some bus reported within this (core/transition.js FRESH_S)
SPARSE_S = 120              # a bus whose last two reports were further apart reports too rarely to judge (SPARSE_S)
GROUPS = ("weekday", "sat", "sun")


def group_of(day):
    w = date.fromisoformat(day).weekday()
    return "sat" if w == 5 else "sun" if w == 6 else "weekday"


def read_transitions(path):
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    leaves = defaultdict(list)
    for r in rows:
        if r["kind"] == "leave" and r["label"] in LASTING:
            leaves[r["vehicle_id"]].append((int(r["epoch"]), r["route_id"], r["label"]))
    for v in leaves.values():
        v.sort()
    return rows, leaves


def arrivals_by_day(path):
    by = defaultdict(list)
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                e = int(r["epoch"])
            except (ValueError, KeyError):
                continue
            sd = (datetime.fromtimestamp(e, O.CT) - timedelta(hours=4)).date().isoformat()
            by[sd].append((e, r["route_id"], r["stop_id"], r["vehicle_id"], r["trip_id"], r["stop_name"],
                           float(r["stop_lat"] or 0), float(r["stop_lon"] or 0)))
    for v in by.values():
        v.sort()
    return by


# ---------------------------------------------------------------- one day
def day_study(day, dl, arr_all, arr_day, leaves, static_cache):
    """-> (visits rows, gone counters {(X, alive, split): Counter}, per-route gone counter at the chosen X)."""
    zp = O.zip_for(dl, day)
    st = O.build_static(zp, static_cache)
    routes_of = T.trip_routes(zp)
    d = date.fromisoformat(day)
    near = [(d + timedelta(days=k)).isoformat() for k in (-1, 0, 1)]
    tracks = T.load_tracks(dl, near)
    preds = T.load_preds(dl, near)
    t0, t1 = T.day_bounds(day)
    grp = group_of(day)
    # ---- A. visits
    vr = defaultdict(list)
    for a in arr_day:
        vr[(a[3], a[1])].append(a[0])
    rep_by_route = defaultdict(list)
    all_reports = []
    for veh, tr in tracks.items():
        for x in tr:
            rep_by_route[x[1]].append((x[0], veh))
            all_reports.append(x[0])
    for v in rep_by_route.values():
        v.sort()
    all_reports.sort()
    visits = []
    for (e, rid, sid, veh, trip, sname, slat, slon) in arr_day:
        lv = leaves.get(veh, [])
        k = bisect.bisect_left(lv, (e - 60,))
        lab = ""
        if k < len(lv) and lv[k][0] <= e + LEAVE_AFTER_S and lv[k][1] == rid:
            ts = vr[(veh, rid)]
            j = bisect.bisect_right(ts, lv[k][0] + 60)
            if j and ts[j - 1] == e:
                lab = lv[k][2]
        ts = vr[(veh, rid)]
        j = bisect.bisect_left(ts, e)
        s = j
        while s > 0 and ts[s] - ts[s - 1] < 2400:
            s -= 1
        rr = rep_by_route.get(rid, [])
        a0, a1 = bisect.bisect_left(rr, (e - 300,)), bisect.bisect_right(rr, (e, "￿"))
        pl = preds.get(veh, [])
        vis5 = T.preds_visible(pl, e - 300, routes_of, rid)
        tr = tracks.get(veh, [])
        fr = next((x[0] for x in tr if x[0] >= t0), e)
        visits.append({"day": day, "e": e, "rid": rid, "sid": sid, "veh": veh, "trip": trip, "cm": T.clock_min(e),
                       "group": grp, "lab": lab, "onroute": (e - ts[s]) / 60, "nb": len({v for _, v in rr[a0:a1]}),
                       "beyond5": sum(1 for p in vis5 if p[4] > e + 300), "shift_h": (e - fr) / 3600,
                       "sname": sname, "slat": slat, "slon": slon})
    # ---- B. gone predictions
    gone = defaultdict(Counter)
    per_route = defaultdict(Counter)
    for veh, pl in preds.items():
        tr = tracks.get(veh, [])
        tts = [r[0] for r in tr]
        av = arr_all.get(veh, [])
        avt = [a[0] for a in av]
        vis = defaultdict(set)
        for seen, last, trip, stop, pred in pl:
            for m in range(seen // 60 + 1, (last + T.PRED_SEEN_S) // 60 + 1):
                t = m * 60
                if pred > t + 60 and t0 <= t < t1:
                    vis[m].add((stop, pred, trip))
        for m, items in vis.items():
            t = m * 60
            i = bisect.bisect_right(tts, t)
            absent = (t - tts[i - 1]) if i else 1e9
            regular = i < 2 or tts[i - 1] - tts[i - 2] <= SPARSE_S       # it reported often before falling silent (unknown: yes)
            q = bisect.bisect_left(all_reports, t - FEED_ALIVE_S)
            alive = q < len(all_reports) and all_reports[q] <= t
            served = []
            for stop, pred, trip in items:
                k = bisect.bisect_left(avt, t - 60)
                ok = False
                while k < len(av) and av[k][0] <= pred + SERVED_AFTER_S:
                    if av[k][2] == stop:
                        ok = True
                        break
                    k += 1
                served.append((ok, routes_of.get(trip, "")))
            ns = sum(1 for ok, _ in served if ok)
            for x in GONE_XS:
                drop = absent >= x * 60
                for variant in ("plain", "feed_alive", "feed_alive_regular"):
                    dd = drop and (variant == "plain" or alive) and (variant != "feed_alive_regular" or regular)
                    c = gone[(x, variant)]
                    c[("pred", dd, True)] += ns
                    c[("pred", dd, False)] += len(served) - ns
                    c[("bus", dd)] += 1
            if absent >= CHOSEN_GONE_MIN * 60 and alive and regular:
                for ok, rid in served:
                    per_route[rid][ok] += 1
    return visits, gone, per_route


# ---------------------------------------------------------------- A. scoring the cues
def leave_scores(V, train_to):
    lab = np.array([bool(v["lab"]) for v in V])
    is_test = np.array([v["day"] > train_to for v in V])
    train_days = sorted({v["day"] for v in V if v["day"] <= train_to})
    idx, tidx, vidx = defaultdict(list), defaultdict(list), defaultdict(list)
    for i, v in enumerate(V):
        idx[(v["rid"], v["sid"], v["group"])].append(i)
        tidx[(v["rid"], v["trip"], v["sid"])].append(i)
        vidx[(v["rid"], v["veh"], v["sid"], v["group"])].append(i)
    W = np.zeros((len(V), 3))
    TR = np.zeros((len(V), 2))
    VW = np.zeros((len(V), 3))
    train_set = set(train_days)
    for i, v in enumerate(V):
        allowed = train_set if is_test[i] else train_set - {v["day"]}
        n = l = 0
        ds = set()
        for j in idx[(v["rid"], v["sid"], v["group"])]:
            u = V[j]
            if u["day"] in allowed and abs(u["cm"] - v["cm"]) <= WIN_MIN:
                n += 1
                if u["lab"]:
                    l += 1
                    ds.add(u["day"])
        W[i] = (n, l, len(ds))
        n = l = 0
        ds = set()
        for j in vidx[(v["rid"], v["veh"], v["sid"], v["group"])]:
            u = V[j]
            if u["day"] in allowed and abs(u["cm"] - v["cm"]) <= WIN_MIN:
                n += 1
                if u["lab"]:
                    l += 1
                    ds.add(u["day"])
        VW[i] = (n, l, len(ds))
        n = l = 0
        for j in tidx[(v["rid"], v["trip"], v["sid"])]:
            u = V[j]
            if u["day"] in allowed and abs(u["cm"] - v["cm"]) <= 30:
                n += 1
                l += bool(u["lab"])
        TR[i] = (n, l)
    wr = np.where(W[:, 0] > 0, W[:, 1] / np.maximum(W[:, 0], 1), 0)
    vr = np.where(VW[:, 0] > 0, VW[:, 1] / np.maximum(VW[:, 0], 1), 0)
    tr = np.where(TR[:, 0] > 0, TR[:, 1] / np.maximum(TR[:, 0], 1), 0)
    nob = np.array([v["beyond5"] == 0 for v in V])

    def sc(mask):
        out = {}
        for part, m in (("train", ~is_test), ("test", is_test)):
            mm = mask & m
            out[part] = {"flagged": int(mm.sum()), "leave": int(lab[mm].sum()),
                         "precision": round(float(lab[mm].mean()), 3) if mm.sum() else None,
                         "recall": round(float(lab[mm].sum() / max(1, lab[m].sum())), 3)}
        return out

    res = {"visits": len(V), "leave_visits": int(lab.sum()), "base_rate": round(float(lab.mean()), 4),
           "train_days": train_days, "test_days": sorted({v["day"] for v in V if v["day"] > train_to}), "rules": {}}
    res["rules"]["passio_nothing_beyond_5min"] = sc(nob)
    for nb in (1, 2, 3, 4, 5, 6):
        res["rules"][f"buses_on_route_{nb}"] = sc(np.array([v["nb"] == nb for v in V]))
    for a in (0.3, 0.5, 0.7):
        res["rules"][f"window_rate>={a}"] = sc((wr >= a) & (W[:, 2] >= 3))
        res["rules"][f"window_rate>={a}+passio"] = sc((wr >= a) & (W[:, 2] >= 3) & nob)
        res["rules"][f"trip_rate>={a}"] = sc((tr >= a) & (TR[:, 1] >= 3))
        res["rules"][f"trip_rate>={a}+passio"] = sc((tr >= a) & (TR[:, 1] >= 3) & nob)
    for a in (0.5, 0.7, 0.9):          # the same bus at the same stop and time on other days (vehicle assignments)
        for md in (2, 3):
            res["rules"][f"vehicle_window_rate>={a}_days>={md}"] = sc((vr >= a) & (VW[:, 2] >= md))
    try:
        import torch
        X = np.column_stack([wr, W[:, 1], W[:, 2], tr, TR[:, 1], nob, [min(v["onroute"], 600) / 600 for v in V],
                             [min(v["shift_h"], 16) / 16 for v in V], [v["nb"] for v in V],
                             [v["group"] == "weekday" for v in V], [np.sin(v["cm"] / 1440 * 2 * np.pi) for v in V],
                             [np.cos(v["cm"] / 1440 * 2 * np.pi) for v in V]]).astype(np.float32)
        mu, sd = X[~is_test].mean(0), X[~is_test].std(0) + 1e-6
        Xn = (X - mu) / sd
        torch.manual_seed(0)
        net = torch.nn.Sequential(torch.nn.Linear(X.shape[1], 32), torch.nn.ReLU(), torch.nn.Linear(32, 1))
        opt = torch.optim.Adam(net.parameters(), 1e-3, weight_decay=1e-4)
        xt = torch.tensor(Xn[~is_test])
        yt = torch.tensor(lab[~is_test].astype(np.float32))
        pw = torch.tensor(float((1 - lab[~is_test].mean()) / max(lab[~is_test].mean(), 1e-6)))
        for _ in range(400):
            opt.zero_grad()
            loss = torch.nn.functional.binary_cross_entropy_with_logits(net(xt).squeeze(1), yt, pos_weight=pw)
            loss.backward()
            opt.step()
        with torch.no_grad():
            s = net(torch.tensor(Xn)).squeeze(1).numpy()
        top = {}
        for part, m in (("train", ~is_test), ("test", is_test)):
            o = np.argsort(-s[m])
            top[part] = {str(k): round(float(lab[m][o[:k]].mean()), 3) for k in (10, 20, 50, 100)}
        res["network_top_k_precision"] = top
    except ImportError:
        res["network_top_k_precision"] = "skipped (no torch)"
    return res


# ---------------------------------------------------------------- C. learned leave windows
def leave_windows(V, min_days=3, gap_min=20, pad_min=5):
    """Per (route, day type, last stop): clusters of leave-visit clock times (gaps <= gap_min) seen on >= min_days
    days, padded by pad_min; with the in-sample precision (leave visits / all visits there in the window)."""
    tim = defaultdict(list)
    info = {}
    for v in V:
        info[(v["rid"], v["sid"])] = (v["sname"], v["slat"], v["slon"])
        if v["lab"]:
            tim[(v["rid"], v["group"], v["sid"])].append((v["cm"], v["day"]))
    vis = defaultdict(list)
    for v in V:
        vis[(v["rid"], v["group"], v["sid"])].append((v["cm"], bool(v["lab"])))
    out = []
    for k, ts in tim.items():
        ts.sort()
        cl = [[ts[0]]]
        for x in ts[1:]:
            if x[0] - cl[-1][-1][0] <= gap_min:
                cl[-1].append(x)
            else:
                cl.append([x])
        for c in cl:
            days = {d for _, d in c}
            if len(days) < min_days:
                continue
            w0, w1 = c[0][0] - pad_min, c[-1][0] + pad_min
            inwin = [lb for cm, lb in vis[k] if w0 <= cm <= w1]
            nm, la, lo = info[(k[0], k[2])]
            out.append({"route_id": k[0], "route": T.NAMES.get(k[0], k[0]), "day_type": k[1], "stop_id": k[2],
                        "stop": nm, "lat": round(la, 5), "lon": round(lo, 5), "from": T.hhmm(w0), "to": T.hhmm(w1),
                        "days": len(days), "leaves": len(c), "visits_in_window": len(inwin),
                        "precision_in_sample": round(sum(inwin) / max(1, len(inwin)), 2)})
    out.sort(key=lambda r: (r["route"], r["day_type"], r["from"]))
    return out


def gone_summary(gone, per_route, ndays):
    res = {}
    for (x, variant), c in sorted(gone.items()):
        dp = c[("pred", True, True)] + c[("pred", True, False)]
        res[f"{x}min_{variant}"] = {
            "prediction_minutes_dropped": dp,
            "never_served": round(c[("pred", True, False)] / max(1, dp), 4),
            "served_prediction_minutes_lost_per_day": round(c[("pred", True, True)] / max(1, ndays), 1),
            "phantom_prediction_minutes_removed_per_day": round(c[("pred", True, False)] / max(1, ndays), 1),
            "bus_minutes_dropped": c[("bus", True)]}
    res["per_route_at_chosen"] = {T.NAMES.get(r, r): {"dropped": c[True] + c[False],
                                                      "never_served": round(c[False] / max(1, c[True] + c[False]), 4)}
                                  for r, c in sorted(per_route.items(), key=lambda kv: -sum(kv[1].values()))}
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dl", required=True)
    ap.add_argument("--transitions", required=True)
    ap.add_argument("--train-to", default="2026-10-28")
    ap.add_argument("--days", nargs="*")
    ap.add_argument("--cache", help="pickle of the per-day study (visits + gone counters)")
    ap.add_argument("--windows-out")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    dl = Path(a.dl)
    days = a.days or sorted(p.name[10:20] for p in dl.glob("raw-polls-*.jsonl.gz"))
    _, leaves = read_transitions(a.transitions)
    if a.cache and Path(a.cache).exists():
        V, gone_by_day, route_by_day, names = pickle.loads(Path(a.cache).read_bytes())
        T.NAMES.update(names)
    else:
        arr_all = T.load_arrivals(dl / "arrivals.csv")
        abd = arrivals_by_day(dl / "arrivals.csv")
        cache = Path(tempfile.gettempdir()) / "sb-e27-static"
        V, gone_by_day, route_by_day = [], {}, {}
        for day in days:
            st = O.build_static(O.zip_for(dl, day), cache)
            T.NAMES.update({rid: (r.get("long") or r.get("short") or rid) for rid, r in st["routes"].items()})
            v, g, pr = day_study(day, dl, arr_all, abd.get(day, []), leaves, cache)
            V.extend(v)
            gone_by_day[day], route_by_day[day] = g, pr
            print(f"{day}: {len(v)} visits, {sum(1 for x in v if x['lab'])} leave visits", file=sys.stderr)
        if a.cache:
            Path(a.cache).write_bytes(pickle.dumps((V, gone_by_day, route_by_day, dict(T.NAMES))))
    res = {"A_about_to_leave": leave_scores(V, a.train_to), "B_gone": {}}
    for split, keep in (("all", lambda d: True), ("train", lambda d: d <= a.train_to), ("test", lambda d: d > a.train_to)):
        g, pr = defaultdict(Counter), defaultdict(Counter)
        ds = [d for d in gone_by_day if keep(d)]
        for d in ds:
            for k, c in gone_by_day[d].items():
                g[k].update(c)
            for k, c in route_by_day[d].items():
                pr[k].update(c)
        res["B_gone"][split] = gone_summary(g, pr, len(ds))
    if a.windows_out:
        w = leave_windows(V)
        Path(a.windows_out).parent.mkdir(parents=True, exist_ok=True)
        T.write_csv(Path(a.windows_out), w, list(w[0].keys()))
        res["C_windows"] = len(w)
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()

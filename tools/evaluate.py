#!/usr/bin/env python3
"""Compare Passio's predicted arrivals vs actual arrivals, and our schedule/learned estimates.

  python tools/evaluate.py [--obs data/observations]

For every poll where Passio predicted arrival P for (trip, stop) and the bus really arrived at A
(ground truth: obslib.extract_events), error = P - A, bucketed by true time-to-arrival A - poll
(horizon). Ours: arrival = last known stop arrival + sum of segment times (learned if available
from a model trained on the earlier ~70% of trips, else schedule). Only a held-out split is
reported as 'learned'; with too little data it says so."""
import argparse, statistics, sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import obslib as L

BINS = [(0, 120, "0-2 min"), (120, 300, "2-5 min"), (300, 600, "5-10 min"), (600, 1200, "10-20 min")]


def bin_of(h):
    for lo, hi, name in BINS:
        if lo <= h < hi:
            return name
    return None


def est_arrival(model, rs, seg, route, last_stop, last_ts, target, poll_t):
    """Last known arrival + modelled travel to target stop; None if unknown."""
    order = rs.get(route) or []
    if last_stop not in order or target not in order:
        return None
    i = order.index(last_stop)
    j = next((k for k in range(i + 1, len(order)) if order[k] == target), None)
    if j is None:
        return None
    total = 0.0
    sch = seg.get(route) or {}
    for k in range(i, j):
        s = (sch.get("seg") or [None] * len(order))[k] if k < len(sch.get("seg") or []) else None
        e = (((model or {}).get("routes") or {}).get(route) or {}).get("s", {}).get(str(k))
        if e:
            a = e["a"]
            w = a[1] / (a[1] + L.K_SHRINK)
            h = e.get("h", {}).get(str(L.how_bucket(last_ts)))
            m, n = (h[0], h[1]) if h else (a[0], a[1])
            w = n / (n + L.K_SHRINK)
            total += w * m + (1 - w) * (s if s is not None else m)
        elif s is not None:
            total += s
        else:
            return None
    return max(last_ts + total, poll_t + 20)


def mae(errs):
    return statistics.mean(abs(e) for e in errs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--obs", default=str(L.ROOT / "data" / "observations"))
    a = ap.parse_args()
    stops = L.load_json(L.WEB_DATA / "stops.json", {}) or {}
    rs = L.load_json(L.WEB_DATA / "route_stops.json", {}) or {}
    seg = (L.load_json(L.WEB_DATA / "segments.json", {}) or {}).get("routes", {})
    obs = list(L.load_obs(a.obs))
    events = L.extract_events(obs, stops, rs) if obs else {}
    if not events:
        print("not enough data yet (no usable observations)")
        return
    actual = {}
    for (_v, tr), t in events.items():
        for s, ts in t["ev"]:
            actual.setdefault((tr, s), ts)
    trips_sorted = sorted(events.items(), key=lambda kv: kv[1]["ev"][0][1])
    split = int(len(trips_sorted) * 0.7)
    held_out = {k[1] for k, _ in trips_sorted[split:]}
    model = None
    if len(trips_sorted) >= 10:
        train = dict(trips_sorted[:split])
        samples = L.segment_samples(train, rs, seg)
        if len(samples) >= 10:
            model = {"routes": L.build_model(samples)}
    else:
        held_out = {k[1] for k, _ in trips_sorted}
    # last arrival event of each trip up to time t
    ev_by_trip = {tr: t["ev"] for (_v, tr), t in events.items()}
    route_of = {tr: t["route"] for (_v, tr), t in events.items()}

    passio, sched, learned = defaultdict(list), defaultdict(list), defaultdict(list)
    for poll_t, tr, r, plist in L.predictions(obs):
        for _q, s, p in plist:
            A = actual.get((tr, s))
            if A is None or A < poll_t:
                continue
            b = bin_of(A - poll_t)
            if not b:
                continue
            passio[b].append(p - A)
            if tr not in held_out:
                continue
            prior = [e for e in ev_by_trip.get(tr, ()) if e[1] <= poll_t and e[0] != s]
            if not prior:
                continue
            ls, lt = prior[-1]
            es = est_arrival(None, rs, seg, route_of.get(tr), ls, lt, s, poll_t)
            if es is not None:
                sched[b].append(es - A)
            if model:
                el = est_arrival(model, rs, seg, route_of.get(tr), ls, lt, s, poll_t)
                if el is not None:
                    learned[b].append(el - A)

    if not passio:
        print(f"{len(events)} vehicle-trips, {len(actual)} actual arrivals, but no matching Passio predictions: "
              "not enough data yet")
        return
    print(f"{len(events)} vehicle-trips, {len(actual)} actual arrivals; held-out trips: {len(held_out)}")
    if not model:
        print("(learned model: not enough data yet to train/hold out; showing Passio and schedule only)")
    print(f"{'horizon':10}{'Passio MAE':>14}{'n':>7}{'schedule MAE':>15}{'n':>7}{'learned MAE':>14}{'n':>7}")
    for _lo, _hi, name in BINS:
        def cell(d):
            return f"{mae(d[name]):>12.0f}s{len(d[name]):>7}" if d.get(name) else f"{'-':>13}{'':>7}"
        print(f"{name:10}" + cell(passio) + cell(sched) + cell(learned))


if __name__ == "__main__":
    main()

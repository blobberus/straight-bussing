#!/usr/bin/env python3
"""Deterministic synthetic ground-truth CSV (same schema as arrivals.csv) for backtests.
Writes data/ground_truth/synthetic_arrivals.csv (~3 weeks, < 5 MB). NOT real data.
  python tools/make_synthetic_truth.py [--weeks 4] [--seed 7]"""
import argparse, math, random, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L

OUT = L.ROOT / "data" / "ground_truth" / "synthetic_arrivals.csv"
MAX_BYTES = 4_800_000


def slow(hour_f, weekend):
    """Travel-time multiplier by local hour: rush hours and class changes are slower."""
    if weekend:
        return 1.0 + 0.12 * math.exp(-((hour_f - 13) ** 2) / 8)
    return (1.0 + 0.35 * math.exp(-((hour_f - 8.5) ** 2) / 1.2) + 0.45 * math.exp(-((hour_f - 17) ** 2) / 1.5)
            + 0.1 * math.exp(-((hour_f - 12.5) ** 2) / 2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int, default=3)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    st = L.Static()
    routes = sorted((r for r in st.route_stops if len(st.route_stops[r]) >= 6), key=lambda r: (len(st.route_stops[r]), r))[:3]
    start = datetime(2026, 9, 7, 0, 0, tzinfo=timezone.utc) + timedelta(hours=5)   # Mon 2026-09-07 00:00 CDT
    # fixed per-route headway and per-segment free-flow speed
    head = {r: rnd.choice([1200, 1500, 1800]) for r in routes}
    free = {r: [rnd.uniform(5.0, 9.5) for _ in st.route_stops[r]] for r in routes}
    dwell0 = {r: rnd.uniform(12, 25) for r in routes}
    rows = []
    for r in routes:
        order = st.route_stops[r]
        dist = [None] + [st.dist_between(r, i - 1, i)[0] or 300.0 for i in range(1, len(order))]
        veh_n = 0
        for day in range(7 * a.weeks):
            day0 = int(start.timestamp()) + day * 86400
            local = L.chicago(day0 + 3600)
            weekend = local.weekday() >= 5
            t_first, t_last = (9, 21) if weekend else (7, 22)
            h = head[r] * (1.4 if weekend else 1.0)
            t = day0 + t_first * 3600 + rnd.uniform(0, h)
            while t < day0 + t_last * 3600:
                veh_n += 1
                veh, trip = str(4300 + veh_n % 5), str(500000 + r_hash(r) + veh_n)
                ep, prev, delay_state = int(t), None, 0.0
                for i in range(len(order)):
                    if i > 0:
                        hf = L.chicago(ep).hour + L.chicago(ep).minute / 60
                        base = dist[i] / free[r][i] * slow(hf, weekend)
                        delay_state = 0.6 * delay_state + rnd.gauss(0, 0.05)           # autocorrelated trip noise
                        seg = max(8, base * (1 + delay_state) * rnd.lognormvariate(0, 0.12) + rnd.choice((0, 0, 0, 20)))
                        ep = int(prev["epoch"] + (prev["dwell"] or 0) + seg)
                    dwell = int(max(3, rnd.gauss(dwell0[r], 6) * (1.5 if 11.5 <= L.chicago(ep).hour + 0.01 <= 13 else 1)))
                    # Passio-like prediction: slightly optimistic, noisier at long lead
                    lead = rnd.choice((130, 200, 300, 450, 700, 1000)) if rnd.random() < 0.8 else None
                    pred = None
                    if lead:
                        pred = (ep + int(rnd.gauss(-0.04 * lead, 0.06 * lead + 8)), lead)
                    ev = {"epoch": ep, "route": r, "trip": trip, "veh": veh, "idx": i, "source": rnd.choice(("transition", "proximity")),
                          "prev": prev, "dwell": dwell, "pred": pred}
                    rows.append(L.fmt_row(st, ev))
                    prev = {"idx": i, "epoch": ep, "dwell": dwell}
                t += h * rnd.uniform(0.8, 1.25)
    rows.sort(key=lambda x: x[0])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write(",".join(L.COLUMNS) + "\n")
        size = 0
        n = 0
        for row in rows:
            txt = L.row_text(row)
            size += len(txt.encode("utf-8"))
            if size > MAX_BYTES:
                break
            f.write(txt)
            n += 1
    print(f"wrote {n} rows ({OUT.stat().st_size / 1e6:.2f} MB) to {OUT}")


def r_hash(r):
    return sum(map(ord, r)) % 1000 * 1000


if __name__ == "__main__":
    main()

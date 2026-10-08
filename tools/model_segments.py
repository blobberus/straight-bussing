"""Segment-time model: hierarchical shrinkage (c) + same-day residual correction (d). Stdlib only.

Hierarchy (parent -> child), all on log run time, run = segment_s - dwell:
  global speed -> route x daypart speed -> segment -> segment x daypart -> segment x hour-of-week
Each level L blends:  est = w*child_stat + (1-w)*parent_est,  w = n/(n+k)   (docs/ALGORITHMS.md s5)
The top two levels are speeds (harmonic, sum d / sum t), turned into times via the segment length.
"""
import json, math, sys
from collections import defaultdict
from datetime import datetime, timezone
import model_core as C

LEVELS = ("global", "route-daypart", "segment", "segment-daypart", "segment-hour")
SIGMA_MIN, SIGMA_MAX = 0.05, 1.0


class SegmentModel:
    def __init__(self, k=5.0, min_n=20):
        self.k, self.min_n = float(k), min_n
        self.fitted = False

    # ---------------- fit ----------------
    def fit(self, rows):
        g_d = g_t = 0.0
        rd = defaultdict(lambda: [0.0, 0.0, 0])
        for r in rows:
            g_d += r.dist; g_t += r.run
            a = rd[(r.route, r.dp)]
            a[0] += r.dist; a[1] += r.run; a[2] += 1
        self.v_g = g_d / g_t if g_t > 0 else 5.0
        self.n_g = len(rows)
        self.rdp = {k: (a[0] / a[1], a[2]) for k, a in rd.items() if a[1] > 0}
        # pooled robust sigma of log(run) around the route-daypart speed model
        res = [math.log(r.run) - math.log(r.dist / self.rdp[(r.route, r.dp)][0]) for r in rows]
        self.sigma_g = min(SIGMA_MAX, max(SIGMA_MIN, C.mad_sigma(res))) if len(res) >= 3 else 0.3
        self.med_run_g = C.median([r.run for r in rows]) if rows else 60.0
        buckets = [defaultdict(list) for _ in range(3)]
        dist, dwell_seg, dwell_route, idx = defaultdict(list), defaultdict(list), defaultdict(list), defaultdict(list)
        for r in rows:
            buckets[0][r.key].append(r.run)
            buckets[1][r.key + (r.dp,)].append(r.run)
            buckets[2][r.key + (r.how,)].append(r.run)
            dist[r.key].append(r.dist); idx[r.key].append(r.idx)
            dwell_seg[(r.route, r.prev)].append(r.dwell); dwell_route[r.route].append(r.dwell)
        self.st = [{k: (len(v),) + C.log_stats(v) for k, v in b.items()} for b in buckets]
        self.dist = {k: C.median(v) for k, v in dist.items()}
        self.idx = {k: max(set(v), key=v.count) for k, v in idx.items()}
        self.dwell_seg = {k: C.median(v) for k, v in dwell_seg.items() if len(v) >= 3}
        self.dwell_route = {k: C.median(v) for k, v in dwell_route.items()}
        self.dwell_g = C.median([r.dwell for r in rows]) if rows else 0.0
        self.span_days = (rows[-1].epoch - rows[0].epoch) / 86400 if rows else 0
        self.n = len(rows)
        self.fitted = True
        return self

    # ---------------- predict ----------------
    def dwell(self, route, prev):
        return self.dwell_seg.get((route, prev), self.dwell_route.get(route, self.dwell_g))

    def predict(self, route, prev, stop, how, dist=None):
        """-> dict(mu, sigma, run (median s), p10, p90, dist, speed, dwell, level, n, path) for the RUN time."""
        key = (route, prev, stop)
        dow, hour = divmod(how, 24)
        dp = C.daypart(dow, hour)
        d = self.dist.get(key, dist)
        k = self.k
        path = [("global", self.n_g, 0.0)]
        if d:
            mu = math.log(d / self.v_g)
        else:                                  # no length known: only a crude global time
            mu = math.log(self.med_run_g)
        sigma = self.sigma_g
        rdp = self.rdp.get((route, dp))
        if rdp and d:
            w = rdp[1] / (rdp[1] + k)
            mu = w * math.log(d / rdp[0]) + (1 - w) * mu
            path.append(("route-daypart", rdp[1], w))
        for lv, kk in ((2, key), (3, key + (dp,)), (4, key + (how,))):
            s = self.st[lv - 2].get(kk)
            if not s:
                continue
            n, m, sg = s
            w = n / (n + k)
            mu = w * m + (1 - w) * mu
            if sg is not None:
                sigma = w * sg + (1 - w) * sigma
            path.append((LEVELS[lv], n, w))
        sigma = min(SIGMA_MAX, max(SIGMA_MIN, sigma))
        deep = [p for p in path if p[1] >= self.min_n and p[0] != "global"]
        if deep:
            level, nn = deep[-1][0], deep[-1][1]
        else:
            level = path[-1][0] + " (low data)"; nn = path[-1][1]
        run = math.exp(mu)
        return {"mu": mu, "sigma": sigma, "run": run, "p10": math.exp(mu - C.Z80 * sigma),
                "p90": math.exp(mu + C.Z80 * sigma), "dist": d, "speed": (d / run) if d else None,
                "dwell": self.dwell(route, prev), "level": level, "n": nn, "path": path}

    def predict_row(self, r):
        return self.predict(r.route, r.prev, r.stop, r.how, r.dist)


# ---------------- choose k by time-ordered cross-validation ----------------
def tune_k(rows, ks=(0.5, 1, 2, 5, 10, 20, 50), folds=4, min_train=0.3):
    """Rolling-origin (expanding window) CV of run-time MAE. rows sorted by time.
    Returns (best_k, [(k, mae)]). Test block f is predicted by a model fit only on rows before it."""
    n = len(rows)
    start = int(n * min_train)
    step = max(1, (n - start) // folds)
    table = []
    for k in ks:
        errs = []
        for f in range(folds):
            lo = start + f * step
            hi = n if f == folds - 1 else lo + step
            if lo >= hi:
                continue
            m = SegmentModel(k).fit(rows[:lo])
            errs.extend(abs(m.predict_row(r)["run"] - r.run) for r in rows[lo:hi])
        table.append((k, C.mae(errs) if errs else float("inf")))
    best = min(table, key=lambda t: (round(t[1], 6), t[0]))[0]
    return best, table


# ---------------- (d) EWMA / same-day residual correction ----------------
class Corrector:
    """log(run) = base mu + g1*seg_resid + g2*trip_resid + g3*route_resid  (residuals decay in time).
    seg_resid: EWMA of recent buses on this segment; route_resid: recent buses on the route;
    trip_resid: how late/early THIS bus has been on its previous segments (carry-over)."""

    def __init__(self, tau_seg=1800.0, tau_route=1800.0, alpha=0.5, clamp=0.7):
        self.tau_seg, self.tau_route, self.alpha, self.clamp = tau_seg, tau_route, alpha, clamp
        self.g = [0.0, 0.0, 0.0]

    def stream(self, model, rows):
        """Replay `rows` (sorted by epoch) in real time. For row i the query happens at prev_epoch
        (when the bus departs the previous stop); only rows with epoch <= prev_epoch have updated the
        state, so nothing from the future leaks. -> {id(row): (features, base_mu)}"""
        ev = []
        for r in rows:
            ev.append((r.epoch, 0, id(r), r))
            ev.append((r.prev_epoch, 1, id(r), r))
        ev.sort(key=lambda e: (e[0], e[1], e[2]))
        seg, route, trip, out, base = {}, {}, {}, {}, {}

        def read(st, key, t, tau):
            v = st.get(key)
            return v[0] * math.exp(-max(0.0, t - v[1]) / tau) if v else 0.0
        for t, typ, rid, r in ev:
            if typ == 1:
                b = model.predict_row(r)["mu"]
                base[rid] = b
                out[rid] = ([read(seg, r.key, t, self.tau_seg), trip.get(r.trip, 0.0),
                             read(route, r.route, t, self.tau_route)], b)
            else:
                b = base.get(rid)
                if b is None:
                    b = model.predict_row(r)["mu"]
                e = math.log(r.run) - b
                a = self.alpha
                for st, key, tau in ((seg, r.key, self.tau_seg), (route, r.route, self.tau_route)):
                    d = read(st, key, t, tau)
                    st[key] = (d + a * (e - d), t)
                trip[r.trip] = 0.6 * e + 0.4 * trip.get(r.trip, 0.0)
        return out

    def fit(self, model, train_rows, ridge=1.0):
        """OLS (ridge) of the log residual on the 3 features. In-sample base residuals are a little
        optimistic, so gains are conservative; the backtest scores them out of sample."""
        S = self.stream(model, train_rows)
        A = [[ridge if i == j else 0.0 for j in range(3)] for i in range(3)]
        b = [0.0] * 3
        for r in train_rows:
            f, mu = S[id(r)]
            y = math.log(r.run) - mu
            for i in range(3):
                b[i] += f[i] * y
                for j in range(3):
                    A[i][j] += f[i] * f[j]
        self.g = [max(-0.2, min(1.2, x)) for x in C.solve(A, b)]
        return self

    def corrected_mu(self, feats, mu):
        c = sum(g * f for g, f in zip(self.g, feats))
        return mu + max(-self.clamp, min(self.clamp, c))


# ---------------- export for web/predict.js ----------------
def seg_index(order, prev, stop, hint=None):
    """Index i such that order[i]==prev and order[i+1]==stop (None if absent/ambiguous)."""
    c = [i for i in range(len(order) - 1) if order[i] == prev and order[i + 1] == stop]
    if len(c) == 1:
        return c[0]
    if hint is not None and (hint - 1) in c:
        return hint - 1
    return None


def export_learned(model, route_stops, out_path, rows=None, corr=None, kind="real"):
    """Write web/data/learned.json (schema v2, backwards compatible with v1 readers):
    routes[rid].s[segIdx] = {a:[medRun,n,p10,p90,sigma], h:{how:[hierarchyMedianRun,n]}, d:meters, v:m/s}
    routes[rid].dw = median dwell. predict.js shrinks a/h toward the schedule with the same k."""
    routes = {}
    hows = defaultdict(set)
    for (rt, prev, stop, how) in model.st[2]:
        hows[(rt, prev, stop)].add(how)
    for key, (n, mu, sg) in model.st[0].items():
        rt, prev, stop = key
        i = seg_index(route_stops.get(rt) or [], prev, stop, model.idx.get(key))
        if i is None:
            continue
        sigma = sg if sg is not None else model.sigma_g
        run = math.exp(mu)
        e = {"a": [round(run, 1), n, round(math.exp(mu - C.Z80 * sigma), 1), round(math.exp(mu + C.Z80 * sigma), 1),
                   round(sigma, 3)]}
        d = model.dist.get(key)
        if d:
            e["d"] = round(d)
            e["v"] = round(d / run, 2)
        h = {}
        for how in sorted(hows.get(key, ())):
            n_h = model.st[2][key + (how,)][0]
            if n_h >= 3:
                p = model.predict(rt, prev, stop, how)
                h[str(how)] = [round(p["run"], 1), n_h]
        if h:
            e["h"] = h
        routes.setdefault(rt, {"s": {}})["s"][str(i)] = e
    for rt, d in model.dwell_route.items():
        if rt in routes:
            routes[rt]["dw"] = round(d, 1)
    out = {"v": 2, "k": model.k, "kind": kind, "n": model.n, "span_days": round(model.span_days, 2),
           "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "vg": round(model.v_g, 2), "sigma": round(model.sigma_g, 3), "routes": routes}
    if corr is not None:
        out["corr"] = {"g": [round(x, 3) for x in corr.g], "tau": corr.tau_seg}
    out_path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    return out


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--data")
    a = ap.parse_args()
    p, kind = C.find_data(a.data)
    if not p:
        sys.exit("no data")
    rows = C.load_rows(p)
    k, tab = tune_k(rows)
    print("data", p, kind, len(rows), "rows; best k =", k)
    for kk, m in tab:
        print(f"  k={kk:<5} CV MAE {m:.2f}s")

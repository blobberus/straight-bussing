"""Segment-time model: hierarchical empirical-Bayes shrinkage + same-day residual correction. Stdlib only.

Hierarchy (parent -> child), all on log RUN time (run = segment_s - dwell at the previous stop):
  global speed -> route x daypart speed -> segment -> segment x daypart -> segment x hour-of-week
Each level blends  mu = w*child + (1-w)*parent,  w = n/(n+k),  k chosen by rolling-origin CV.
The top two levels are harmonic speeds (sum d / sum t) turned into times with the segment length,
so an unseen segment still gets a sensible time.  Math: docs/ALGORITHMS.md sections 4-6.
"""
import json, math, sys
from collections import defaultdict
from datetime import datetime, timezone
import model_core as C

LEVELS = ("global", "route-daypart", "segment", "segment-daypart", "segment-hour")
SIGMA_MIN, SIGMA_MAX = 0.05, 1.0
K_GRID = (0.5, 1, 2, 5, 10, 20, 50)


class SegmentModel:
    def __init__(self, k=5.0, min_n=20):
        self.k, self.min_n = float(k), min_n
        self.fitted = False

    # ---------------- fit ----------------
    def fit(self, rows):
        if not rows:
            raise ValueError("no rows to fit")
        g_d = g_t = 0.0
        rd = defaultdict(lambda: [0.0, 0.0, 0])
        for r in rows:
            g_d += r.dist; g_t += r.run
            a = rd[(r.route, r.dp)]
            a[0] += r.dist; a[1] += r.run; a[2] += 1
        self.v_g = g_d / g_t if g_t > 0 else 5.0                    # harmonic (space-mean) speed
        self.n_g = len(rows)
        self.rdp = {k: (a[0] / a[1], a[2]) for k, a in rd.items() if a[1] > 0}
        res = [math.log(r.run) - math.log(r.dist / self.rdp[(r.route, r.dp)][0]) for r in rows]
        self.sigma_g = min(SIGMA_MAX, max(SIGMA_MIN, C.mad_sigma(res))) if len(res) >= 3 else 0.3
        self.med_run_g = C.median([r.run for r in rows])
        buckets = [defaultdict(list) for _ in range(3)]
        dist, idx = defaultdict(list), defaultdict(list)
        dwell_seg, dwell_route = defaultdict(list), defaultdict(list)
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
        self.dwell_g = C.median([r.dwell for r in rows])
        self.span_days = (rows[-1].epoch - rows[0].epoch) / 86400
        self.n = len(rows)
        self.fitted = True
        return self

    # ---------------- predict ----------------
    def dwell(self, route, prev):
        return self.dwell_seg.get((route, prev), self.dwell_route.get(route, self.dwell_g))

    def predict(self, route, prev, stop, how, dist=None, upto=4):
        """RUN-time distribution for one segment at hour-of-week `how` (upto: deepest level index used).
        -> dict(mu, sigma, run=median s, p10, p90, dist, speed, dwell, seg=run+dwell, level, n, path)."""
        key = (route, prev, stop)
        dp = C.daypart(*divmod(how, 24))
        d = self.dist.get(key, dist)
        k = self.k
        path = [("global", self.n_g, 0.0)]
        mu = math.log(d / self.v_g) if d else math.log(self.med_run_g)
        sigma = self.sigma_g
        rdp = self.rdp.get((route, dp))
        if rdp and d:
            w = rdp[1] / (rdp[1] + k)
            mu = w * math.log(d / rdp[0]) + (1 - w) * mu
            path.append(("route-daypart", rdp[1], w))
        for lv, kk in ((2, key), (3, key + (dp,)), (4, key + (how,))):
            s = self.st[lv - 2].get(kk) if lv <= upto else None
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
        level, nn = (deep[-1][0], deep[-1][1]) if deep else (path[-1][0] + " (low data)", path[-1][1])
        run = math.exp(mu)
        dw = self.dwell(route, prev)
        return {"mu": mu, "sigma": sigma, "run": run, "p10": math.exp(mu - C.Z80 * sigma),
                "p90": math.exp(mu + C.Z80 * sigma), "dist": d, "speed": (d / run) if d else None,
                "dwell": dw, "seg": run + dw, "level": level, "n": nn, "path": path}

    def predict_row(self, r):
        return self.predict(r.route, r.prev, r.stop, r.how, r.dist)


class RawBucketModel:
    """Baseline WITHOUT shrinkage: median run of segment x hour-of-week if n >= min_n, else segment
    median, else distance / global harmonic speed. Shows what shrinkage buys."""

    def __init__(self, min_n=3):
        self.min_n = min_n

    def fit(self, rows):
        h, s = defaultdict(list), defaultdict(list)
        for r in rows:
            h[r.key + (r.how,)].append(r.run); s[r.key].append(r.run)
        self.h = {k: C.median(v) for k, v in h.items() if len(v) >= self.min_n}
        self.s = {k: C.median(v) for k, v in s.items()}
        self.v_g = C.harmonic_speed([r.dist for r in rows], [r.run for r in rows]) or 5.0
        return self

    def run(self, r):
        return self.h.get(r.key + (r.how,)) or self.s.get(r.key) or r.dist / self.v_g


# ---------------- choose k by time-ordered cross-validation ----------------
def tune_k(rows, ks=K_GRID, folds=4, min_train=0.4):
    """Rolling-origin (expanding window) CV of run-time MAE; rows sorted by time. Each test block is
    predicted by a model fit only on rows before it. -> (best_k, [(k, mae)])."""
    origins = C.rolling_origins(len(rows), folds, min_train)
    table = []
    for k in ks:
        errs = []
        for lo, hi in origins:
            m = SegmentModel(k).fit(rows[:lo])
            errs.extend(abs(m.predict_row(r)["run"] - r.run) for r in rows[lo:hi])
        table.append((k, C.mae(errs) if errs else float("inf")))
    best = min(table, key=lambda t: (round(t[1], 6), t[0]))[0]
    return best, table


# ---------------- same-day residual correction (EWMA + carry-over) ----------------
class Corrector:
    """log(run) = mu_base + g1*s_seg + g2*phi^j*s_trip + g3*s_route.
    s_seg  : EWMA of residuals of earlier buses on THIS segment, decayed by exp(-dt/tau_seg)
    s_route: same over the whole route (catches route-wide slowdowns: weather, events)
    s_trip : EWMA of THIS bus's residuals on its previous segments (it is running late/early);
             for a segment j hops ahead it is damped by phi^j (AR(1) carry-over, phi fit on data)."""

    def __init__(self, tau_seg=1800.0, tau_route=1800.0, alpha=0.5, beta=0.6, clamp=0.7):
        self.tau_seg, self.tau_route, self.alpha, self.beta, self.clamp = tau_seg, tau_route, alpha, beta, clamp
        self.g, self.phi = [0.0, 0.0, 0.0], 0.5
        self.reset()

    def reset(self):
        self.seg, self.route, self.trip = {}, {}, {}

    @staticmethod
    def _read(st, key, t, tau):
        v = st.get(key)
        return v[0] * math.exp(-max(0.0, t - v[1]) / tau) if v else 0.0

    def features(self, key, route, trip, t, ahead=0):
        return [self._read(self.seg, key, t, self.tau_seg),
                self.trip.get(trip, 0.0) * (self.phi ** ahead),
                self._read(self.route, route, t, self.tau_route)]

    def observe(self, r, base_mu):
        """Bus r just arrived: fold its log residual into the state."""
        e = math.log(r.run) - base_mu
        t = r.epoch
        for st, key, tau in ((self.seg, r.key, self.tau_seg), (self.route, r.route, self.tau_route)):
            d = self._read(st, key, t, tau)
            st[key] = (d + self.alpha * (e - d), t)
        self.trip[r.trip] = self.beta * e + (1 - self.beta) * self.trip.get(r.trip, 0.0)
        return e

    def replay(self, model, rows, extra=()):
        """Replay rows in time order. Arrival of row r updates the state at r.epoch; the segment
        query for r happens at r.prev_epoch (bus leaves prev stop), AFTER arrivals at that instant.
        extra: [(t, fn)] callbacks fn(self) at time t (e.g. arrival-time queries in the backtest).
        Nothing from the future leaks. -> {id(row): (features, base_mu)}"""
        self.reset()
        base = {id(r): model.predict_row(r)["mu"] for r in rows}
        ev = [(r.epoch, 0, i, r) for i, r in enumerate(rows)]
        ev += [(r.prev_epoch, 1, i, r) for i, r in enumerate(rows)]
        ev += [(t, 2, i, fn) for i, (t, fn) in enumerate(extra)]
        ev.sort(key=lambda e: (e[0], e[1], e[2]))
        out = {}
        for t, typ, _i, obj in ev:
            if typ == 0:
                self.observe(obj, base[id(obj)])
            elif typ == 1:
                out[id(obj)] = (self.features(obj.key, obj.route, obj.trip, t), base[id(obj)])
            else:
                obj(self)
        return out

    def fit(self, model, train_rows, ridge=1.0):
        """Ridge least squares of the log residual on the 3 features, plus phi = lag-1 autocorrelation
        of a bus's consecutive residuals. In-sample base residuals are slightly optimistic, so the
        gains are conservative; the backtest scores everything out of sample."""
        S = self.replay(model, train_rows)
        A = [[ridge if i == j else 0.0 for j in range(3)] for i in range(3)]
        b = [0.0] * 3
        by_trip = defaultdict(list)
        for r in train_rows:
            f, mu = S[id(r)]
            y = math.log(r.run) - mu
            by_trip[r.trip].append((r.epoch, y))
            for i in range(3):
                b[i] += f[i] * y
                for j in range(3):
                    A[i][j] += f[i] * f[j]
        self.g = [max(-0.2, min(1.2, x)) for x in C.solve(A, b)]
        num = den = 0.0
        for seq in by_trip.values():
            seq.sort()
            for (_, a), (_, c) in zip(seq, seq[1:]):
                num += a * c; den += a * a
        self.phi = max(0.0, min(0.95, num / den)) if den > 0 else 0.5
        self.reset()
        return self

    def corrected_mu(self, feats, mu):
        c = sum(g * f for g, f in zip(self.g, feats))
        return mu + max(-self.clamp, min(self.clamp, c))


# ---------------- export for the web predictor ----------------
def seg_index(order, prev, stop, hint=None):
    """Index i such that order[i]==prev and order[i+1]==stop (None if absent/ambiguous)."""
    c = [i for i in range(len(order) - 1) if order[i] == prev and order[i + 1] == stop]
    if len(c) == 1:
        return c[0]
    if hint is not None and (hint - 1) in c:
        return hint - 1
    return None


def fit_bias(rows, min_n=30):
    """Per-route multiplicative bias of Passio's ETA: median of actual remaining / predicted remaining,
    remaining measured from the moment the prediction was made (q = epoch - lead). Used by the web
    predictor's etaAdjust. Only predictions 2-20 min out; routes with n >= min_n and 0.5 <= m <= 2."""
    ratios = defaultdict(list)
    for r in rows:
        if r.passio is None or not r.lead or r.lead < 30:
            continue
        q = r.epoch - r.lead
        pred_rem = r.passio - q
        if 120 <= pred_rem <= 1200:
            ratios[r.route].append(r.lead / pred_rem)
    out = {}
    for rt, v in ratios.items():
        if len(v) >= min_n:
            m = C.median(v)
            if 0.5 <= m <= 2:
                out[rt] = {"m": round(m, 3), "a": 0, "n": len(v)}
    return out


def export_learned(model, route_stops, out_path, corr=None, kind="real", bias=None, min_how_n=5, min_rel=0.03,
                   scale=1.0):
    """Build (and optionally write) learned.json in the format web/js/core/predict.js reads (v2):
      routes[rid].s["<segIdx>"] = {a:[medianRunSec, n, p10RunSec, p90RunSec, sigma],
                                   h:{"<how 0-167>":[shrunkMedianRunSec, n_bucket]}, d:meters, v:m/s}
      routes[rid].dw = median dwell s (the reader adds it at intermediate stops); bias = fit_bias().
    Times are RUN seconds (dwell excluded). h values are already shrunk through the hierarchy, so the
    reader weights them with a's n. An h entry is written only if n_bucket >= min_how_n and it differs
    from the all-hours median by >= min_rel (otherwise the reader's fallback to a is just as good).
    scale: calibrated sigma multiplier (backtest.scale_by_cv) so p10/p90 really cover ~80 %."""
    routes = {}
    hows = defaultdict(set)
    for (rt, prev, stop, how) in model.st[2]:
        hows[(rt, prev, stop)].add(how)
    n_how = 0
    for key, (n, mu, sg) in sorted(model.st[0].items()):
        rt, prev, stop = key
        i = seg_index(route_stops.get(rt) or [], prev, stop, model.idx.get(key))
        if i is None:
            continue
        sigma = (sg if sg is not None else model.sigma_g) * scale
        run = math.exp(mu)
        e = {"a": [round(run, 1), n, round(math.exp(mu - C.Z80 * sigma), 1),
                   round(math.exp(mu + C.Z80 * sigma), 1), round(sigma, 3)]}
        d = model.dist.get(key)
        if d:
            e["d"], e["v"] = round(d), round(d / run, 2)
        h = {}
        for how in sorted(hows.get(key, ())):
            n_h = model.st[2][key + (how,)][0]
            if n_h >= min_how_n:
                ph = model.predict(rt, prev, stop, how)["run"]
                if abs(ph - run) / run >= min_rel:
                    h[str(how)] = [round(ph, 1), n_h]
        if h:
            e["h"] = h
            n_how += len(h)
        routes.setdefault(rt, {"s": {}})["s"][str(i)] = e
    for rt, dw in model.dwell_route.items():
        if rt in routes:
            routes[rt]["dw"] = round(dw, 1)
    out = {"v": 2, "kind": kind, "k": model.k, "n": model.n, "span_days": round(model.span_days, 2),
           "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "vg": round(model.v_g, 2), "sigma": round(model.sigma_g * scale, 3), "scale": round(scale, 3),
           "n_how": n_how, "routes": routes}
    if corr is not None:
        out["corr"] = {"g": [round(x, 3) for x in corr.g], "phi": round(corr.phi, 3), "tau": corr.tau_seg}
    if bias:
        out["bias"] = bias
    if out_path is not None:
        out_path.write_text(json.dumps(out, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    return out


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Fit the segment model and print the k CV table.")
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

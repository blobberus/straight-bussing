"""(f) Log-normal travel-time distributions: p10/p50/p90 per bucket and uncertainty propagation.

Why log: run time T = d/v >= 0, right-skewed (a stalled bus adds minutes, no bus saves minutes), and
effects (rush hour, a red light) multiply. log T is roughly symmetric -> fit N(mu, sigma^2) on log T.
  quantile_q = exp(mu + z_q * sigma);  median = e^mu;  mean = e^(mu + sigma^2/2)  (> median)
"""
import math, sys
from statistics import NormalDist
import model_core as C

ND = NormalDist()


def fit_lognormal(times):
    """Robust (median / MAD) log-normal fit -> (mu, sigma). sigma None if n<3."""
    return C.log_stats(times)


def lognormal_q(mu, sigma, q):
    return math.exp(mu + ND.inv_cdf(q) * sigma)


def lognormal_mean_var(mu, sigma):
    m = math.exp(mu + sigma * sigma / 2)
    return m, (math.exp(sigma * sigma) - 1) * m * m


def sum_lognormals(parts, rho=0.3):
    """Distribution of T = sum T_i, T_i ~ LogNormal(mu_i, s_i), pairwise correlation rho of the T_i.
    mean = sum m_i; var = sum v_i + rho * sum_{i!=j} sd_i sd_j  (rho=0 independent, 1 comonotone).
    Fenton-Wilkinson: match mean/var with ONE log-normal -> (mu, sigma) of the total."""
    ms, vs = zip(*(lognormal_mean_var(m, s) for m, s in parts))
    sds = [math.sqrt(v) for v in vs]
    mean = sum(ms)
    var = sum(vs) + rho * (sum(sds) ** 2 - sum(v for v in vs))
    s2 = math.log(1 + var / (mean * mean))
    return math.log(mean) - s2 / 2, math.sqrt(s2)


def empirical_table(rows, min_n=20):
    """{(route, prev, stop, how): (n, p10, p50, p90)} from raw run times (buckets with n >= min_n)."""
    g = {}
    for r in rows:
        g.setdefault(r.key + (r.how,), []).append(r.run)
    return {k: (len(v), C.quantile(v, .1), C.quantile(v, .5), C.quantile(v, .9)) for k, v in g.items() if len(v) >= min_n}


def interval_report(model, test_rows):
    """Calibration of the model's 80% interval on held-out rows (target 0.80), plus mean pinball loss."""
    ys, lo, hi, pb = [], [], [], 0.0
    for r in test_rows:
        p = model.predict_row(r)
        ys.append(r.run); lo.append(p["p10"]); hi.append(p["p90"])
        pb += C.pinball(r.run, p["p10"], 0.1) + C.pinball(r.run, p["run"], 0.5) + C.pinball(r.run, p["p90"], 0.9)
    n = max(1, len(ys))
    return {"coverage80": C.coverage(ys, lo, hi), "pinball": pb / (3 * n), "n": len(ys)}


if __name__ == "__main__":
    from model_segments import SegmentModel
    p, kind = C.find_data(sys.argv[1] if len(sys.argv) > 1 else None)
    if not p:
        sys.exit("no data")
    rows = C.load_rows(p)
    tr, te = C.time_split(rows)
    m = SegmentModel(5).fit(tr)
    print(kind, p, interval_report(m, te))
    mu, s = sum_lognormals([(math.log(60), .3)] * 5, rho=0.3)
    print("5 segments of 60s (sigma .3, rho .3): median %.0fs p10 %.0f p90 %.0f" %
          (math.exp(mu), lognormal_q(mu, s, .1), lognormal_q(mu, s, .9)))

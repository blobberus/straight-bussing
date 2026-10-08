#!/usr/bin/env python3
"""Time-ordered backtest of every segment-time / arrival-time method. Writes docs/BACKTEST.md.

  python tools/backtest.py                 # real data/ground_truth/arrivals.csv if >= 200 rows
  python tools/backtest.py --synthetic     # data/ground_truth/synthetic_arrivals.csv (proves code only)
  python tools/backtest.py --data X.csv --no-write
Methods: schedule, Passio (if the CSV has its predictions), global median, segment x hour median
(no shrinkage), shrunk hierarchy (k by CV), shrunk + EWMA/carry-over correction.
Evaluations: (A) 70/30 time split on segment seconds; (B) arrival time at the same lead Passio had;
(C) rolling-origin folds. Math: docs/ALGORITHMS.md."""
import argparse, json, math, sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import model_core as C
import model_quantile as Q
from model_segments import Corrector, RawBucketModel, SegmentModel, seg_index, tune_k

LEAD_BINS = ((0, 120, "0-2 min"), (120, 300, "2-5 min"), (300, 600, "5-10 min"), (600, 1200, "10-20 min"))
OUT_MD = C.ROOT / "docs" / "BACKTEST.md"


class Schedule:
    """Scheduled segment seconds from web/data/segments.json (GTFS, interpolated between timepoints)."""

    def __init__(self, web=C.WEB_DATA):
        try:
            self.seg = json.loads((web / "segments.json").read_text(encoding="utf-8")).get("routes", {})
            self.order = json.loads((web / "route_stops.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.seg, self.order = {}, {}

    def __call__(self, r):
        s = self.seg.get(r.route) or {}
        i = seg_index(self.order.get(r.route) or [], r.prev, r.stop, r.idx)
        arr = s.get("seg") or []
        if i is None or i >= len(arr) or not isinstance(arr[i], (int, float)):
            return None
        return float(arr[i]) + float(s.get("dwell") or 0)


def scale_by_cv(rows, k, folds=3):
    """Calibrate the interval width multiplier on rolling-origin predictions inside `rows`."""
    preds, ys = [], []
    for lo, hi in C.rolling_origins(len(rows), folds, 0.5):
        m = SegmentModel(k).fit(rows[:lo])
        for r in rows[lo:hi]:
            p = m.predict_row(r)
            preds.append((p["mu"], p["sigma"], p["dwell"])); ys.append(r.seg_s)
    return Q.calibrate_scale(preds, ys)


def fit_all(train, k=None):
    k = k if k is not None else tune_k(train, folds=3)[0]
    m = SegmentModel(k).fit(train)
    return {"k": k, "seg": m, "raw": RawBucketModel().fit(train), "corr": Corrector().fit(m, train),
            "gmed": C.median([r.seg_s for r in train]), "scale": scale_by_cv(train, k)}


def segment_eval(F, sched, train, test):
    """(A) per-segment seconds on test rows. -> {method: dict(err, y, lo, hi, pin)} and level counts."""
    m, corr, sc = F["seg"], F["corr"], F["scale"]
    S = corr.replay(m, train + test)                  # state flows through train into test, no peeking
    out = defaultdict(lambda: {"err": [], "y": [], "lo": [], "hi": [], "pin": []})
    levels = Counter()

    def add(name, r, pred, lo=None, hi=None):
        o = out[name]
        o["err"].append(pred - r.seg_s); o["y"].append(r.seg_s)
        if lo is not None:
            o["lo"].append(lo); o["hi"].append(hi)
            o["pin"].append((C.pinball(r.seg_s, lo, .1) + C.pinball(r.seg_s, pred, .5) + C.pinball(r.seg_s, hi, .9)) / 3)
    for r in test:
        s = sched(r)
        if s is not None:
            add("schedule", r, s)
        add("global median", r, F["gmed"])
        add("segment-hour median", r, F["raw"].run(r) + m.dwell(r.route, r.prev))
        p = m.predict_row(r)
        levels[p["level"]] += 1
        lo, md, hi = Q.interval(p["mu"], p["sigma"], p["dwell"], sc)
        add("shrunk hierarchy", r, md, lo, hi)
        f, mu = S[id(r)]
        lo, md, hi = Q.interval(corr.corrected_mu(f, mu), p["sigma"], p["dwell"], sc)
        add("shrunk + EWMA", r, md, lo, hi)
    return out, levels


def chains(rows):
    """trip -> rows sorted by epoch, cut where consecutive rows do not join (missed stop)."""
    by = defaultdict(list)
    for r in rows:
        by[r.trip].append(r)
    out = {}
    for t, lst in by.items():
        lst.sort(key=lambda r: r.epoch)
        out[t] = lst
    return out


def arrival_eval(F, sched, train, test, scale_arr=1.0):
    """(B) predict the arrival at stop j at query time q = arrival - Passio lead, from the bus's last
    known arrival A_p <= q plus the predicted segments p+1..j (every method gets the same info).
    -> (res[bin][method] = {err, y, lo, hi}, items [(mu_t, s_t, offset, y, q)] for interval calibration)."""
    m, corr = F["seg"], F["corr"]
    rho = min(0.9, max(0.0, corr.phi))
    ch = chains(train + test)
    pos = {id(r): (r.trip, i) for lst in ch.values() for i, r in enumerate(lst)}
    res = defaultdict(lambda: defaultdict(lambda: {"err": [], "y": [], "lo": [], "hi": []}))
    items, extra = [], []
    for r in test:
        if r.passio is None or not r.lead or r.lead <= 0:
            continue
        lb = next((b[2] for b in LEAD_BINS if b[0] <= r.lead < b[1]), None)
        if lb is None:
            continue
        q = r.epoch - r.lead
        trip, j = pos[id(r)]
        lst = ch[trip]
        p = j
        while p >= 0 and lst[p].prev_epoch > q:     # walk back to the segment whose start is known by q
            if p > 0 and (lst[p - 1].stop != lst[p].prev or lst[p - 1].epoch != lst[p].prev_epoch):
                p = -2
                break
            p -= 1
        if p < 0:
            continue                                  # bus had not reached a logged stop yet, or a gap
        known_t, segs = lst[p].prev_epoch, lst[p:j + 1]   # A_p = arrival at segs[0].prev

        def cb(state, r=r, q=q, known_t=known_t, segs=segs, lb=lb):
            parts, dw_sum, base, corrd, sch, ok = [], 0.0, 0.0, 0.0, 0.0, True
            for h, s in enumerate(segs):
                pr = m.predict_row(s)
                f = state.features(s.key, s.route, s.trip, q, ahead=h)
                cm = corr.corrected_mu(f, pr["mu"])
                parts.append((cm, pr["sigma"])); dw_sum += pr["dwell"]
                base += pr["seg"]; corrd += math.exp(cm) + pr["dwell"]
                sv = sched(s)
                ok = ok and sv is not None
                sch += sv or 0.0
            mu_t, s_t = Q.sum_lognormals(parts, rho)
            y = r.epoch
            preds = {"Passio": r.passio, "shrunk hierarchy": max(q, known_t + base),
                     "shrunk + EWMA": max(q, known_t + corrd)}
            if ok:
                preds["schedule"] = max(q, known_t + sch)
            for name, v in preds.items():
                o = res[lb][name]
                o["err"].append(v - y); o["y"].append(y)
            o = res[lb]["shrunk + EWMA"]
            o["lo"].append(max(q, known_t + dw_sum + Q.lognormal_q(mu_t, s_t * scale_arr, .1)))
            o["hi"].append(known_t + dw_sum + Q.lognormal_q(mu_t, s_t * scale_arr, .9))
            items.append((mu_t, s_t, known_t + dw_sum, y, q))
        extra.append((q, cb))
    corr.replay(m, train + test, extra)
    return res, items


def arrival_scale(train):
    """Calibrate the arrival-interval width on the training period only: fit on its first 70%,
    run (B) on its last 30%, bisect the multiplier on the summed sigma for 80% coverage."""
    a, b = C.time_split(train, 0.7)
    if len(a) < 100 or not b:
        return 1.0
    _, items = arrival_eval(fit_all(a), Schedule(), a, b)
    if not items:
        return 1.0

    def cov(c):
        return sum(1 for mu, st, off, y, q in items
                   if max(q, off + Q.lognormal_q(mu, st * c, .1)) <= y <= off + Q.lognormal_q(mu, st * c, .9)) / len(items)
    lo, hi = 0.3, 6.0
    if cov(hi) < 0.8:
        return hi
    for _ in range(30):
        mid = (lo + hi) / 2
        lo, hi = (lo, mid) if cov(mid) >= 0.8 else (mid, hi)
    return hi


def rolling_eval(rows, sched, folds=4):
    """(C) expanding-window folds; every model refit (and k re-tuned) on rows before each test block."""
    out = defaultdict(list)
    for lo, hi in C.rolling_origins(len(rows), folds, 0.4):
        F = fit_all(rows[:lo])
        A, _ = segment_eval(F, sched, rows[:lo], rows[lo:hi])
        for name, o in A.items():
            out[name].append((C.mae(o["err"]), len(o["err"])))
    return out


# ---------------- report ----------------
def fmt(x, d=1):
    return "-" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.{d}f}"


def table_a(A):
    lines = ["| method | MAE s | RMSE s | MAPE % | 80% coverage | pinball s | n |", "|---|---:|---:|---:|---:|---:|---:|"]
    order = ["schedule", "global median", "segment-hour median", "shrunk hierarchy", "shrunk + EWMA"]
    for name in order:
        o = A.get(name)
        if not o:
            lines.append(f"| {name} | - | - | - | - | - | 0 |")
            continue
        cov = C.coverage(o["y"], o["lo"], o["hi"]) if o["lo"] else None
        pin = sum(o["pin"]) / len(o["pin"]) if o["pin"] else None
        lines.append(f"| {name} | {fmt(C.mae(o['err']))} | {fmt(C.rmse(o['err']))} | {fmt(C.mape(o['err'], o['y']))} | "
                     f"{fmt(cov * 100 if cov is not None else None, 0)}{'%' if cov is not None else ''} | {fmt(pin)} | {len(o['err'])} |")
    return lines


def table_b(B):
    names = ["Passio", "schedule", "shrunk hierarchy", "shrunk + EWMA"]
    lines = ["| lead | " + " | ".join(f"{n} MAE s" for n in names) + " | EWMA 80% cov | n |",
             "|---|" + "---:|" * (len(names) + 2)]
    for _a, _b, lb in LEAD_BINS:
        d = B.get(lb)
        if not d:
            continue
        cells = [fmt(C.mae(d[n]["err"])) if d.get(n) and d[n]["err"] else "-" for n in names]
        e = d.get("shrunk + EWMA")
        cov = C.coverage(e["y"], e["lo"], e["hi"]) if e and e.get("lo") else None
        lines.append(f"| {lb} | " + " | ".join(cells) + f" | {fmt(cov * 100 if cov is not None else None, 0)}% | "
                     f"{len(d['Passio']['err'])} |")
    return lines


def _rel(path):
    return path.relative_to(C.ROOT).as_posix() if path.is_relative_to(C.ROOT) else path.name


def analyze(path, kind, rolling=True, h="##"):
    """Run (A), (B), (C) on one CSV -> markdown lines (headings at level h). None if too little data."""
    rows = C.load_rows(path)
    if len(rows) < 100:
        return None
    sched = Schedule()
    train, test = C.time_split(rows, 0.7)
    k, ktab = tune_k(train)
    F = fit_all(train, k)
    A, levels = segment_eval(F, sched, train, test)
    F["scale_arr"] = arrival_scale(train)
    B, _ = arrival_eval(F, sched, train, test, F["scale_arr"])
    R = rolling_eval(rows, sched) if rolling else {}
    t0 = datetime.fromtimestamp(rows[0].epoch, timezone.utc).strftime("%Y-%m-%d")
    t1 = datetime.fromtimestamp(rows[-1].epoch, timezone.utc).strftime("%Y-%m-%d")
    tsplit = datetime.fromtimestamp(test[0].epoch, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    md = [f"Data: `{_rel(path)}` ({kind}). {len(rows)} usable segment rows, {len({r.route for r in rows})} routes, "
          f"{len({r.key for r in rows})} segments, {t0} to {t1}. Train = earliest 70% ({len(train)} rows), "
          f"test = latest 30% ({len(test)} rows) from {tsplit}.", "",
          f"{h} Shrinkage strength k (rolling-origin CV inside the training period)", "",
          "| k | " + " | ".join(str(x) for x, _ in ktab) + " |", "|---|" + "---:|" * len(ktab),
          "| run-time MAE s | " + " | ".join(fmt(v, 2) for _, v in ktab) + " |", "",
          f"Chosen k = {k}. Interval width multipliers, calibrated out of sample inside the training period: "
          f"segment {F['scale']:.2f}, arrival {F['scale_arr']:.2f}. "
          f"EWMA gains g = {[round(x, 3) for x in F['corr'].g]}, carry-over phi = {F['corr'].phi:.2f}.", "",
          f"{h} (A) Segment time, 70/30 time split", ""] + table_a(A) + [
          "", "Deepest hierarchy level with >= 20 samples used for test predictions: " +
          ", ".join(f"{lv} {n}" for lv, n in levels.most_common()) + ".", "",
          f"{h} (B) Arrival time at Passio's lead (same information time for every method)", "",
          "Query time q = actual arrival - Passio lead. Ours = last arrival the bus had logged by q + predicted",
          "segments (clamped to >= q). Interval: Fenton-Wilkinson sum of log-normals with correlation rho = phi,",
          "width calibrated on the training period. Passio is only scored on these same rows.", ""]
    md += table_b(B) if B else ["No rows with Passio predictions in the test period."]
    if R:
        nf = len(next(iter(R.values())))
        md += ["", f"{h} (C) Rolling origin ({nf} expanding folds, models refit and k re-tuned per fold)", "",
               "| method | " + " | ".join(f"fold {i + 1} MAE s" for i in range(nf)) + " | mean |",
               "|---|" + "---:|" * (nf + 1)]
        for name, v in R.items():
            md.append(f"| {name} | " + " | ".join(fmt(x) for x, _ in v) + f" | {fmt(sum(x for x, _ in v) / len(v))} |")
    return md


SYNTH_NOTE = ["> **SYNTHETIC DATA.** These numbers prove the code runs end to end and that the models recover",
              "> structure that was deliberately built into a simulator. They say NOTHING about accuracy on real",
              "> UChicago shuttles. Re-run `python tools/backtest.py` once >= 200 real rows exist.",
              "> The Passio column is only as meaningful as the simulator's fake Passio:",
              "> `tools/make_synthetic_truth.py` derives it from the TRUE arrival time plus noise (an oracle that",
              "> no real predictor can match), `tools/model_synth.py` from the schedule plus lead-dependent noise.", ""]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data")
    ap.add_argument("--synthetic", action="store_true", help="use data/ground_truth/synthetic_arrivals.csv")
    ap.add_argument("--also", help="second CSV appended as its own section (e.g. a tools/model_synth.py file)")
    ap.add_argument("--out", default=str(OUT_MD))
    ap.add_argument("--no-write", action="store_true")
    ap.add_argument("--no-rolling", action="store_true")
    a = ap.parse_args(argv)
    if a.synthetic:
        path, kind = (C.SYNTH_CSV, "synthetic") if C.SYNTH_CSV.exists() else (None, None)
    else:
        path, kind = C.find_data(a.data, allow_synthetic=False)
    if not path:
        n = C.count_rows(C.REAL_CSV)
        print(f"not enough data yet: {n} real rows in {C.REAL_CSV} (need {C.MIN_REAL_ROWS}). "
              "Run with --synthetic to exercise the code on synthetic data.")
        return 0
    body = analyze(path, kind, not a.no_rolling)
    if body is None:
        print(f"not enough usable segment rows yet in {path}")
        return 0
    import model_kalman
    kd = model_kalman.demo(quiet=True)
    md = ["# Backtest results", ""] + (SYNTH_NOTE if kind == "synthetic" else [])
    md += [f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} by `tools/backtest.py`. "
           "Errors are prediction minus actual; MAE/RMSE in seconds. Method definitions: docs/ALGORITHMS.md.", ""]
    md += body
    if a.also:
        p2 = Path(a.also)
        k2 = "synthetic" if "synth" in p2.name.lower() else "real"
        extra = analyze(p2, k2, False, "###")
        if extra:
            cmd = "python tools/model_synth.py --out X.csv" if k2 == "synthetic" else ""
            md += ["", f"## Second dataset: `{p2.name}` ({k2})", "",
                   "Different simulator: stronger AR(1) trip delay (so carry-over matters) and a Passio that does",
                   "not see the future. Rolling origin skipped." + (f" Regenerate: `{cmd}`." if cmd else ""), ""] + extra
    md += ["", "## Live-bus Kalman filter (simulation, `python tools/model_kalman.py`)", "",
           f"Position error: filtered {kd['pos_filtered']:.1f} m vs raw GPS {kd['pos_raw']:.1f} m. ETA MAE: constant-velocity "
           f"extrapolation {kd['kalman_cv']:.0f} s, filtered position + learned speed {kd['kalman_learned']:.1f} s, raw GPS + "
           f"learned speed {kd['raw_learned']:.1f} s. Lesson: the filter cleans position and rejects GPS jumps; the ETA "
           "must come from learned segment speeds, not from the instantaneous velocity.", "",
           "## How to read this", "",
           "- (A) isolates the travel-time model; (B) is what a rider feels and is the fair comparison with Passio.",
           "- Coverage should be near 80%; pinball loss rewards sharp AND calibrated quantiles (lower is better).",
           "- Schedule rows are only those whose stop pair exists in `web/data/route_stops.json`.",
           "- Reproduce: `python tools/backtest.py" + (" --synthetic" if kind == "synthetic" else "") +
           (" --also <model_synth csv>" if a.also else "") + "`."]
    text = "\n".join(md) + "\n"
    print(text)
    if not a.no_write:
        Path(a.out).write_text(text, encoding="utf-8")
        print(f"wrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

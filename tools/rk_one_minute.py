#!/usr/bin/env python3
"""E18: can most stops get within 1 minute? Passio's rider-facing ETA error per stop, and what simple
corrections would buy (RouteKnower.md; protocol section 6, information-time rules 6.2).

  python tools/rk_one_minute.py <arrivals.csv> [--out experiments/routeknower/E18-report.md]

Scored: the stored Passio prediction (newest one made >= 120 s before the arrival; leads 120-300 s,
the only leads the collector keeps, E01 B5). Error = predicted - actual (positive = the bus came early).
Sets: "clean" = E01 trust rules (model_core.clean_dicts); "post-fix" = every row logged after the
collector fixes of 2026-10-10 (B1: predictions per bus, terminal sequence), which is what riders saw.
Corrections are fitted on earlier service days only and scored on the next day (rolling origin).
"""
import argparse, math, statistics, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import model_core as C
import model_quantile as Q
import backtest as BT

B1_FIX = 1791620287 + 2 * 3600      # cc40831 (2026-10-10 03:18 CDT) + the next collector runs picking it up
GOAL_S = 60
MIN_STOP_N = 15
K_SHRINK = 10.0


def pct(x):
    return f"{100 * x:.0f}%"


def summarize(errs):
    a = [abs(e) for e in errs]
    n = len(errs)
    return {"n": n, "mae": statistics.fmean(a), "medae": statistics.median(a), "bias": statistics.fmean(errs),
            "w30": sum(x <= 30 for x in a) / n, "w60": sum(x <= GOAL_S for x in a) / n,
            "w120": sum(x <= 120 for x in a) / n,
            "early": sum(e > GOAL_S for e in errs) / n, "late": sum(e < -GOAL_S for e in errs) / n}


def row_line(name, s):
    return (f"| {name} | {s['n']} | {s['mae']:.0f} | {s['medae']:.0f} | {s['bias']:+.0f} | {pct(s['w30'])} | "
            f"**{pct(s['w60'])}** | {pct(s['w120'])} | {pct(s['early'])} | {pct(s['late'])} |")


HEAD = ["| set | n | MAE s | median AE s | bias s | within 30 s | within 60 s | within 2 min | bus > 1 min early | bus > 1 min late |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]


def load(path):
    dicts = C.read_dicts(path)
    kept, _stale, no_passio = C.clean_dicts(dicts)
    out = []
    for d in kept:
        ep, pe, lead = C._f(d.get("epoch")), C._f(d.get("passio_pred_epoch")), C._f(d.get("passio_pred_lead_s"))
        if ep is None or pe is None or lead is None or not (120 <= lead < 300):
            continue
        out.append({"ep": ep, "err": pe - ep, "lead": lead, "route": d.get("route_name") or d.get("route_id"),
                    "stop": (str(d.get("route_id")), str(d.get("stop_id"))), "stop_name": d.get("stop_name", ""),
                    "day": str(C._service_day(d, ep)), "hour": int(C._f(d.get("hour"), 0)),
                    "dow": int(C._f(d.get("dow"), 0)), "idx": str(d.get("stop_index", "")), "dwell": C._f(d.get("dwell_s")),
                    "clean": id(d) not in no_passio, "post": ep >= B1_FIX})
    return out


def per_stop(rows, errfn=lambda r: r["err"]):
    by = defaultdict(list)
    for r in rows:
        by[r["stop"]].append(errfn(r))
    return {k: summarize(v) for k, v in by.items() if len(v) >= MIN_STOP_N}


def stop_goal_lines(name, st):
    n = len(st)
    if not n:
        return [f"| {name} | 0 | - | - | - |"]
    mae_ok = sum(s["mae"] <= GOAL_S for s in st.values())
    med_ok = sum(s["medae"] <= GOAL_S for s in st.values())
    w80 = sum(s["w60"] >= 0.8 for s in st.values())
    return [f"| {name} | {n} | {mae_ok} ({pct(mae_ok / n)}) | {med_ok} ({pct(med_ok / n)}) | {w80} ({pct(w80 / n)}) |"]


def shrunk_bias(train):
    """Per-stop median error shrunk toward its route's, the route's toward the global (k = K_SHRINK)."""
    g = statistics.median([r["err"] for r in train]) if train else 0.0
    by_r, by_s = defaultdict(list), defaultdict(list)
    for r in train:
        by_r[r["stop"][0]].append(r["err"]); by_s[r["stop"]].append(r["err"])
    rb = {k: (len(v) * statistics.median(v) + K_SHRINK * g) / (len(v) + K_SHRINK) for k, v in by_r.items()}
    sb = {k: (len(v) * statistics.median(v) + K_SHRINK * rb[k[0]]) / (len(v) + K_SHRINK) for k, v in by_s.items()}
    return lambda stop: sb.get(stop, rb.get(stop[0], g))


def rolling_bias(rows):
    """Each service day d (after the first): fit shrunk bias on days < d, score on d."""
    days = sorted({r["day"] for r in rows})
    raw, cor, per_day = [], [], []
    for d in days[1:]:
        train = [r for r in rows if r["day"] < d]
        test = [r for r in rows if r["day"] == d]
        if not train or not test:
            continue
        b = shrunk_bias(train)
        e0 = [r["err"] for r in test]
        e1 = [r["err"] - b(r["stop"]) for r in test]
        raw += [(r, e) for r, e in zip(test, e0)]
        cor += [(r, e) for r, e in zip(test, e1)]
        per_day.append((d, summarize(e0), summarize(e1)))
    return raw, cor, per_day


def offset_checks(rows):
    """Is the per-stop offset real? (a) drive-through vs stopped arrivals (a detector timing the end of a stop
    would make stopped buses look later); (b) the same stop's offset on the first two days vs the rest."""
    out = []
    by = defaultdict(lambda: ([], []))
    for r in rows:
        dw = r["dwell"]
        if dw is not None:
            by[r["stop"]][0 if dw == 0 else 1].append(r["err"])
    pairs = [(statistics.median(a), statistics.median(b)) for a, b in by.values() if len(a) >= 8 and len(b) >= 8]
    if len(pairs) > 2:
        out.append(f"- Drive-through vs stopped (dwell 0 vs > 0), {len(pairs)} stops with >= 8 of each: per-stop median "
                   f"offset correlation {statistics.correlation(*zip(*pairs)):.2f}, median difference "
                   f"{statistics.median(b - a for a, b in pairs):+.0f} s. Overall median error: drive-through "
                   f"{statistics.median([r['err'] for r in rows if r['dwell'] == 0]):+.0f} s, stopped "
                   f"{statistics.median([r['err'] for r in rows if (r['dwell'] or 0) > 0]):+.0f} s.")
    days = sorted({r["day"] for r in rows})
    early = set(days[:2])
    bd = defaultdict(lambda: ([], []))
    for r in rows:
        bd[r["stop"]][0 if r["day"] in early else 1].append(r["err"])
    pairs = [(statistics.median(a), statistics.median(b)) for a, b in bd.values() if len(a) >= 10 and len(b) >= 10]
    if len(pairs) > 2:
        out.append(f"- Stability: per-stop median offset on {', '.join(sorted(early))} vs the later days, {len(pairs)} stops: "
                   f"correlation {statistics.correlation(*zip(*pairs)):.2f}, median change "
                   f"{statistics.median(abs(a - b) for a, b in pairs):.0f} s.")
    return out


def quantile(v, p):
    v = sorted(v)
    i = p * (len(v) - 1)
    lo = int(i)
    return v[lo] + (v[min(lo + 1, len(v) - 1)] - v[lo]) * (i - lo)


def tilted(rows, p, key):
    """Rolling origin: shift each prediction by the shrunk p-quantile of its key's training errors.
    p > 0.5 shifts less (toward 'show it earlier'), which protects riders from a bus that comes early."""
    days = sorted({r["day"] for r in rows})
    errs = []
    for d in days[1:]:
        tr = [r for r in rows if r["day"] < d]
        te = [r for r in rows if r["day"] == d]
        if not tr or not te:
            continue
        g = quantile([r["err"] for r in tr], p)
        by_r, by_k = defaultdict(list), defaultdict(list)
        for r in tr:
            by_r[r["stop"][0]].append(r["err"]); by_k[key(r)].append(r["err"])
        rb = {k: (len(v) * quantile(v, p) + K_SHRINK * g) / (len(v) + K_SHRINK) for k, v in by_r.items()}
        kb = {k: (len(v) * quantile(v, p) + K_SHRINK * rb[k[0] if isinstance(k[0], str) else k[0][0]]) / (len(v) + K_SHRINK)
              for k, v in by_k.items()}
        errs += [r["err"] - kb.get(key(r), rb.get(r["stop"][0], g)) for r in te]
    return errs


def daypart(r):
    h = r["hour"]
    return "weekend" if r["dow"] >= 5 else "am" if 5 <= h < 10 else "midday" if 10 <= h < 16 else "pm" if 16 <= h < 20 else "night"


def capture_eval(F, sched, train, test):
    """backtest.arrival_eval with the row kept: [(row, {method: predicted epoch})] at Passio's lead."""
    m, corr = F["seg"], F["corr"]
    ch = BT.chains(train + test)
    pos = {id(r): (r.trip, i) for lst in ch.values() for i, r in enumerate(lst)}
    out, extra = [], []
    for r in test:
        if r.passio is None or not r.lead or not (120 <= r.lead < 300):
            continue
        q = r.epoch - r.lead
        trip, j = pos[id(r)]
        lst = ch[trip]
        p = j
        while p >= 0 and lst[p].prev_epoch > q:
            if p > 0 and (lst[p - 1].stop != lst[p].prev or lst[p - 1].epoch != lst[p].prev_epoch):
                p = -2
                break
            p -= 1
        if p < 0:
            continue
        known_t, segs = lst[p].prev_epoch, lst[p:j + 1]

        def cb(state, r=r, q=q, known_t=known_t, segs=segs):
            base = corrd = 0.0
            for h, s in enumerate(segs):
                pr = m.predict_row(s)
                f = state.features(s.key, s.route, s.trip, q, ahead=h)
                base += pr["seg"]; corrd += math.exp(corr.corrected_mu(f, pr["mu"])) + pr["dwell"]
            out.append((r, {"Passio": r.passio, "ours": max(q, known_t + base), "ours+EWMA": max(q, known_t + corrd)}))
        extra.append((q, cb))
    corr.replay(m, train + test, extra)
    return out


def rolling_blend(path):
    rows = C.load_rows(path)
    day = lambda r: r.trip.rsplit("|", 1)[-1]
    days = sorted({day(r) for r in rows})
    sched = BT.Schedule()
    res = []
    for d in days[1:]:
        train = [r for r in rows if day(r) < d]
        test = [r for r in rows if day(r) == d]
        if len(train) < 300 or not test:
            continue
        F = BT.fit_all(train)
        cap = capture_eval(F, sched, train, test)
        # Passio bias per stop from the training rows (same rule as rolling_bias), applied to the test rows
        tr = [{"err": r.passio - r.epoch, "stop": (r.route, r.stop)} for r in train
              if r.passio is not None and r.lead and 120 <= r.lead < 300]
        b = shrunk_bias(tr)
        for r, p in cap:
            p["Passio bias-corrected"] = p["Passio"] - b((r.route, r.stop))
            res.append((d, r, p))
    return res


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("arrivals")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    rows = load(a.arrivals)
    clean = [r for r in rows if r["clean"]]
    post = [r for r in rows if r["post"]]
    days = sorted({r["day"] for r in rows})
    md = [f"Rows with a stored Passio prediction at a 2-5 min lead: {len(rows)} ({len(clean)} clean by the E01 rules, "
          f"{len(post)} logged after the 2026-10-10 collector fixes); service days {', '.join(days)}.", "",
          "## 1. Passio today (what riders see), 2-5 min ahead", ""] + HEAD
    md.append(row_line("clean (E01 rules), all days", summarize([r["err"] for r in clean])))
    md.append(row_line("post-fix, every row", summarize([r["err"] for r in post])))
    md.append(row_line("post-fix, shared trip id (Downtown Campus Connector etc.)",
                       summarize([r["err"] for r in post if not r["clean"] and r["idx"] != "0"] or [0])))
    md.append(row_line("post-fix, loop start (index 0)", summarize([r["err"] for r in post if r["idx"] == "0"] or [0])))
    rider = [r for r in rows if r["clean"] or r["post"]]
    md.append(row_line("**rider set** (clean, plus post-fix shared/terminal)", summarize([r["err"] for r in rider])))

    md += ["", "### By lead (rider set)", ""] + HEAD
    for lo, hi in ((120, 180), (180, 240), (240, 300)):
        md.append(row_line(f"{lo}-{hi} s", summarize([r["err"] for r in rider if lo <= r["lead"] < hi])))
    md += ["", "### By route (rider set)", ""] + HEAD
    by_route = defaultdict(list)
    for r in rider:
        by_route[r["route"]].append(r["err"])
    for k, v in sorted(by_route.items(), key=lambda kv: -len(kv[1])):
        if len(v) >= 30:
            md.append(row_line(k, summarize(v)))
    md += ["", "### By time of day (rider set)", ""] + HEAD
    parts = (("weekday 5-10 AM", lambda r: r["dow"] < 5 and 5 <= r["hour"] < 10),
             ("weekday 10 AM-4 PM", lambda r: r["dow"] < 5 and 10 <= r["hour"] < 16),
             ("weekday 4-8 PM", lambda r: r["dow"] < 5 and 16 <= r["hour"] < 20),
             ("weekday night (8 PM-5 AM)", lambda r: r["dow"] < 5 and (r["hour"] >= 20 or r["hour"] < 5)),
             ("weekend", lambda r: r["dow"] >= 5))
    for name, f in parts:
        v = [r["err"] for r in rider if f(r)]
        if v:
            md.append(row_line(name, summarize(v)))

    md += ["", "### Is the offset real, or our detector?", ""] + offset_checks(rider)

    st = per_stop(rider)
    md += ["", f"## 2. Stops meeting the 1-minute goal (rider set, stops with n >= {MIN_STOP_N})", "",
           "| version | stops | MAE <= 60 s | median error <= 60 s | >= 80% of predictions within 60 s |",
           "|---|---:|---:|---:|---:|"]
    md += stop_goal_lines("Passio as is", st)
    med = {k: statistics.median([r["err"] for r in rider if r["stop"] == k]) for k in st}
    md += stop_goal_lines("Passio minus each stop's own median error (in-sample: an upper bound for bias correction)",
                          per_stop([r for r in rider if r["stop"] in med], lambda r: r["err"] - med[r["stop"]]))
    w = sorted(st.items(), key=lambda kv: -kv[1]["mae"])
    names = {r["stop"]: (r["route"], r["stop_name"]) for r in rider}
    md += ["", "Worst 12 stops (rider set):", "", "| route | stop | n | MAE s | median error s | within 60 s |",
           "|---|---|---:|---:|---:|---:|"]
    for k, s in w[:12]:
        md.append(f"| {names[k][0]} | {names[k][1]} | {s['n']} | {s['mae']:.0f} | "
                  f"{statistics.median([r['err'] for r in rider if r['stop'] == k]):+.0f} | {pct(s['w60'])} |")

    raw, cor, per_day = rolling_bias(rider)
    md += ["", "## 3. Out of sample: per-stop bias correction fitted on earlier days (M2)", "",
           "| test day | n | Passio MAE / within 60 s | corrected MAE / within 60 s |", "|---|---:|---:|---:|"]
    for d, s0, s1 in per_day:
        md.append(f"| {d} | {s0['n']} | {s0['mae']:.0f} s / {pct(s0['w60'])} | {s1['mae']:.0f} s / {pct(s1['w60'])} |")
    if raw:
        md += ["", ""] + HEAD + [row_line("Passio (test days)", summarize([e for _, e in raw])),
                                 row_line("Passio bias-corrected", summarize([e for _, e in cor]))]
        st0 = per_stop([dict(r, e=e) for r, e in raw], lambda r: r["e"])
        st1 = per_stop([dict(r, e=e) for r, e in cor], lambda r: r["e"])
        md += ["", "| version (test days) | stops | MAE <= 60 s | median error <= 60 s | >= 80% within 60 s |",
               "|---|---:|---:|---:|---:|"] + stop_goal_lines("Passio", st0) + stop_goal_lines("bias-corrected", st1)

    md += ["", "### Safety tilt: shift by a quantile above the median (less shift, fewer early buses)", "",
           "| correction (rolling origin) | within 60 s | bus > 1 min early | bus > 1 min late | MAE s |",
           "|---|---:|---:|---:|---:|"]
    s0 = summarize([e for _, e in raw])
    md.append(f"| Passio as is | {pct(s0['w60'])} | {pct(s0['early'])} | {pct(s0['late'])} | {s0['mae']:.0f} |")
    for kname, key in (("per stop", lambda r: r["stop"]), ("per stop x daypart", lambda r: (r["stop"], daypart(r)))):
        for p in (0.5, 0.6, 0.7, 0.8):
            s1 = summarize(tilted(rider, p, key))
            md.append(f"| {kname}, quantile {p:g} | {pct(s1['w60'])} | {pct(s1['early'])} | {pct(s1['late'])} | {s1['mae']:.0f} |")

    bl = rolling_blend(a.arrivals)
    md += ["", "## 4. Out of sample: our model and blends, same rows (segment chains with a known start, M10)", ""]
    if bl:
        methods = ["Passio", "Passio bias-corrected", "ours", "ours+EWMA"]
        md += HEAD
        for mth in methods:
            md.append(row_line(mth, summarize([p[mth] - r.epoch for _, r, p in bl])))
        for wgt in (0.25, 0.5, 0.75):
            md.append(row_line(f"{wgt:g} x Passio bias-corrected + {1 - wgt:g} x ours",
                               summarize([wgt * p["Passio bias-corrected"] + (1 - wgt) * p["ours"] - r.epoch for _, r, p in bl])))
        md.append("")
        md.append("Test days: " + ", ".join(sorted({d for d, _, _ in bl})) + f" ({len(bl)} rows).")
    text = "\n".join(md) + "\n"
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()

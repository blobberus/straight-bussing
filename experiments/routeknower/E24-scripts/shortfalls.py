#!/usr/bin/env python3
"""E24 (2026-10-25): where Passio's live times, the ones Straight Bussing shows riders, fall short of the 10% rule.

The 10% rule (owner, 2026-10-12; replaced as the goal by the 10 minute shrink on 2026-10-17, kept as a column of
data/eta/summary.csv): a prediction made L before the bus reached the stop passes if |predicted - actual| <= 10% of L.
err = predicted - actual: positive = the bus came EARLIER than shown (a rider can miss it), negative = it came later.
Scoring is the daily summary's (tools/build_eta_dataset.py summary()): per service day, one sample per (arrival,
lead bin, source), the forecast-table row nearest the bin middle (the goal bin 0-10 at about 5 min ahead); gross
misses (|err| > max(10 min, half the lead), E19) are out of the pass rate but counted; days are the unit of noise.
This script only slices the same samples in more ways (route, stop, hour, what the bus was doing, ...).

  gh release download data-archive-2026-10 -p "eta-*.csv.gz" -D <eta folder>
  git show origin/data:data/ground_truth/predictions.csv > predictions.csv   (and arrivals.csv; Git Bash: MSYS_NO_PATHCONV=1)
  python experiments/routeknower/E24-scripts/shortfalls.py --eta-dir <eta folder> \
      [--predictions predictions.csv --arrivals arrivals.csv] [--out tables.md]

Stdlib only. Read-only. Output: markdown tables (the synopsis is docs/TEN-PERCENT-SHORTFALLS.md).
"""
import argparse, csv, gzip, random, statistics, sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))
import arrivals_lib as L          # noqa: E402
import build_eta_dataset as E     # noqa: E402

BINS = E.GOAL_BINS                                      # 0-10 (once per arrival, ~5 min ahead), 10-15, ..., 30-45
MIDS = {b[2]: (b[0] + min(b[1], E.HORIZON_S)) / 2 for b in E.SUMMARY_BINS}
SRC = (("passio", "passio_epoch"), ("timetable", "tt_epoch"), ("timetable_delay", "ttd_epoch"))
FEAT = ("service_day", "dow", "day_type", "route_name", "stop_id", "stop_name", "stop_index", "next_trip",
        "stops_away", "crosses_terminal", "delay_s", "standing_s", "passio_age_s", "speed_mps", "vehicle_id")
DOW = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- loading (one sample per arrival, bin, source)
def load_day(path):
    """-> (samples, targets) for one service day, sampled exactly like summary().
    samples: [(source, bin, err, lead, feat)], feat = dict of FEAT + 'hour' (Chicago hour of the arrival).
    targets: {(bin, akey): (feat, has_passio)} for coverage."""
    with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
        rd = csv.reader(f)
        h = {c: i for i, c in enumerate(next(rd))}
        i_lab, i_lead, i_act = h["label_status"], h["lead_s"], h["actual_epoch"]
        i_veh, i_stop = h["vehicle_id"], h["stop_id"]
        i_src = [(name, h[col]) for name, col in SRC]
        fi = [(c, h[c]) for c in FEAT]
        picks, tg, has_p = {}, {}, set()
        for r in rd:
            if r[i_lab] != "arrived":
                continue
            lead = num(r[i_lead])
            if not lead or lead <= 0:
                continue
            bins = [b for b in E.summary_bins(lead) if b in BINS]
            if not bins:
                continue
            akey = (r[i_veh], r[i_stop], r[i_act])
            row = None
            for b in bins:
                dist = abs(lead - MIDS[b])
                k = (b, akey)
                if k not in tg or dist < tg[k][0]:
                    row = row or r
                    tg[k] = (dist, row, lead)
                for name, i in i_src:
                    if r[i] == "":
                        continue
                    if name == "passio":
                        has_p.add(k)
                    pk = (name, b, akey)
                    if pk not in picks or dist < picks[pk][0]:
                        row = row or r
                        picks[pk] = (dist, row, lead, i)
    feats = {}

    def feat(r):
        k = id(r)
        if k not in feats:
            d = {c: r[i] for c, i in fi}
            d["hour"] = L.chicago(int(r[i_act])).hour
            d["_akey"] = (r[i_veh], r[i_stop], r[i_act])
            feats[k] = d
        return feats[k]

    samples = []
    for (name, b, akey), (_, r, lead, i) in picks.items():
        err = float(r[i]) - float(akey[2])
        samples.append((name, b, err, lead, feat(r)))
    targets = {k: (feat(r), k in has_p) for k, (_, r, _) in tg.items()}
    return samples, targets


# ---------------------------------------------------------------- metrics
def gross(e, ld):
    return E.GROSS(e, ld)


def metrics(pairs):
    """pairs [(err, lead)] -> dict; pass rates over non-gross samples, direction shares over all."""
    n = len(pairs)
    if not n:
        return None
    ok = [(e, ld) for e, ld in pairs if not gross(e, ld)]
    m = {"n": n, "gross": n - len(ok), "ok": len(ok)}
    d = len(ok) or 1
    m["p10"] = sum(abs(e) <= 0.10 * ld for e, ld in ok) / d
    m["p10f"] = sum(abs(e) <= max(60.0, 0.10 * ld) for e, ld in ok) / d
    m["bandB"] = sum(-0.10 * ld <= e <= 0.01 * ld for e, ld in ok) / d
    m["shrink"] = sum(abs(e) <= L.shrink_tol(ld) for e, ld in ok) / d
    m["late1"] = sum(e > 0.01 * ld for e, ld in pairs) / n          # shown later than the bus came (> 1% of L)
    m["early_miss"] = sum(e > 0.10 * ld for e, ld in ok) / d        # bus came > 10% EARLIER than shown
    m["later_miss"] = sum(e < -0.10 * ld for e, ld in ok) / d       # bus came > 10% LATER than shown
    m["gross_rate"] = (n - len(ok)) / n
    m["gross_later"] = sum(1 for e, ld in pairs if gross(e, ld) and e < 0) / n
    m["med"] = statistics.median(e for e, _ in ok) if ok else 0.0
    m["mae"] = statistics.fmean(abs(e) for e, _ in ok) if ok else 0.0
    return m


def pct(x, nd=0):
    return "" if x is None else f"{100 * x:.{nd}f}%"


def mins(s):
    return f"{s / 60:+.1f}" if s is not None else ""


def boot_ci(by_day, boots=2000, seed=7):
    """95% bootstrap interval over days of the 10% pass rate (resampling whole days, as build_eta_dataset report)."""
    per = []
    for pairs in by_day.values():
        m = metrics(pairs)
        if m and m["ok"]:
            per.append((round(m["p10"] * m["ok"]), m["ok"]))
    if len(per) < 2:
        return None
    rnd = random.Random(seed)
    sims = []
    for _ in range(boots):
        pick = [rnd.choice(per) for _ in per]
        sims.append(sum(p for p, _ in pick) / sum(o for _, o in pick))
    sims.sort()
    return sims[int(0.025 * len(sims))], sims[int(0.975 * len(sims)) - 1]


# ---------------------------------------------------------------- tables
def matrix(title, rows, keyf, order=None, min_n=60, note=""):
    """Passio 10% pass rate by group x goal bin. rows: passio samples (bin, err, lead, feat)."""
    g = defaultdict(lambda: defaultdict(list))
    for b, e, ld, ft in rows:
        k = keyf(ft, e, ld)
        if k is not None:
            g[k][b].append((e, ld))
    keys = order or sorted(g, key=lambda k: -sum(len(v) for v in g[k].values()))
    n_miss = lambda pairs: sum(1 for e, ld in pairs if not gross(e, ld) and abs(e) > 0.10 * ld)
    tot_miss = sum(n_miss(p) for k in g for p in g[k].values()) or 1
    out = [f"### {title}", ""] + ([note, ""] if note else [])
    out += ["| group | samples | " + " | ".join(f"{b} min" for b in BINS) +
            " | share of all misses | misses where the bus came later | median error at 10-15 min | gross |",
            "|---|---:|" + "---:|" * len(BINS) + "---:|---:|---:|---:|"]
    for k in keys:
        if k not in g:
            continue
        allp = [p for b in BINS for p in g[k][b]]
        if len(allp) < min_n:
            continue
        cells = []
        for b in BINS:
            m = metrics(g[k][b])
            cells.append(f"{pct(m['p10'])} ({m['n']:,})" if m and m["n"] >= 20 else (f"({m['n']})" if m else ""))
        ma = metrics(allp)
        miss = ma["early_miss"] + ma["later_miss"]
        m15 = metrics(g[k]["10-15"])
        out.append(f"| {k} | {len(allp):,} | " + " | ".join(cells) + f" | {pct(n_miss(allp) / tot_miss)} |"
                   f" {pct(ma['later_miss'] / miss) if miss else ''} | {mins(m15['med']) if m15 else ''} |"
                   f" {pct(ma['gross_rate'])} |")
    return out + [""]


def headline(by_src_bin, by_src_bin_day):
    out = ["### Headline: each source by lead (all days pooled; 95% interval = bootstrap over days)", "",
           "| source | lead | samples | 10% rule | 95% interval | 10% rule, 1-min floor | band B (10% early to 1% late) |"
           " bus came > 10% later | bus came > 10% earlier | gross | median error (min) | mean abs error (min) |",
           "|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|"]
    for src in ("passio", "timetable", "timetable_delay"):
        for b in BINS:
            m = metrics(by_src_bin[(src, b)])
            if not m:
                continue
            ci = boot_ci(by_src_bin_day[(src, b)])
            out.append(f"| {src} | {b} | {m['n']:,} | {pct(m['p10'])} | {pct(ci[0])} to {pct(ci[1])} | {pct(m['p10f'])} |"
                       f" {pct(m['bandB'])} | {pct(m['later_miss'])} | {pct(m['early_miss'])} | {pct(m['gross_rate'])} |"
                       f" {mins(m['med'])} | {m['mae'] / 60:.1f} |" if ci else
                       f"| {src} | {b} | {m['n']:,} | {pct(m['p10'])} | | {pct(m['p10f'])} | {pct(m['bandB'])} |"
                       f" {pct(m['later_miss'])} | {pct(m['early_miss'])} | {pct(m['gross_rate'])} | {mins(m['med'])} |"
                       f" {m['mae'] / 60:.1f} |")
    return out + [""]


def spread(rows):
    out = ["### How far off Passio is, against what the 10% rule allows (non-gross samples)", "",
           "| lead | allowed (10% of the bin middle) | 10th pct | 25th | median | 75th | 90th | median abs | 80% of predictions within |",
           "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for b in BINS:
        es = sorted(e for bb, e, ld, _ in rows if bb == b and not gross(e, ld))
        ab = sorted(abs(e) for e in es)
        if not es:
            continue
        q = lambda v, p: v[min(len(v) - 1, int(p * len(v)))]
        out.append(f"| {b} min | {0.1 * MIDS[b] / 60:.1f} min | {mins(q(es, .1))} | {mins(q(es, .25))} | {mins(q(es, .5))} |"
                   f" {mins(q(es, .75))} | {mins(q(es, .9))} | {q(ab, .5) / 60:.1f} | {q(ab, .8) / 60:.1f} |")
    return out + ["", "Minutes; negative = the bus came later than shown.", ""]


def coverage(targets_all):
    """Share of arrivals with a Passio time on display somewhere in the bin (n / targets of the summary)."""
    out = ["### Coverage: arrivals with any Passio time on display in the lead bin", "",
           "| group | " + " | ".join(f"{b} min" for b in BINS) + " |", "|---|" + "---:|" * len(BINS)]

    def line(name, sel):
        cells = []
        for b in BINS:
            v = [hp for (bb, _), (ft, hp) in targets_all.items() if bb == b and sel(ft)]
            cells.append(f"{pct(sum(v) / len(v))} ({len(v):,})" if v else "")
        out.append(f"| {name} | " + " | ".join(cells) + " |")
    line("all arrivals", lambda ft: True)
    line("current trip", lambda ft: ft["next_trip"] in ("0", ""))
    line("next trip (bus must finish its lap first)", lambda ft: ft["next_trip"] == "1")
    routes = Counter(ft["route_name"] for (_, _), (ft, _) in targets_all.items())
    for r, n in routes.most_common():
        if n >= 300:
            line(r, lambda ft, r=r: ft["route_name"] == r)
    return out + [""]


def keyed_compare(keyed):
    """Same arrivals for every source (scoring rule 6). keyed: {(bin, segment, akey): {source: (err, lead)}} -> table
    on the arrivals all three sources predicted."""
    out = ["### The same arrivals scored for each source (10% rule)", "",
           "| trip | lead | arrivals | Passio | printed timetable | timetable + current delay | best of the three per bin |",
           "|---|---|---:|---:|---:|---:|---|"]
    for seg in ("current_trip", "next_trip"):
        for b in BINS:
            v = [d for (bb, sg, _), d in keyed.items() if bb == b and sg == seg and len(d) == 3]
            if len(v) < 50:
                continue
            ms = {s: metrics([d[s] for d in v]) for s in ("passio", "timetable", "timetable_delay")}
            best = max(ms, key=lambda s: ms[s]["p10"])
            out.append(f"| {seg.replace('_', ' ')} | {b} | {len(v):,} | {pct(ms['passio']['p10'])} |"
                       f" {pct(ms['timetable']['p10'])} | {pct(ms['timetable_delay']['p10'])} | {best} |")
    return out + ["", "Timetable rows exist only where the GTFS has a time for the trip (not the Downtown Campus "
                  "Connector's frequency trips), so these are fewer arrivals than the headline.", ""]


def best_shift(rels, lo, hi):
    """The shift s (in units of the lead) that puts the most of rels inside [s + lo, s + hi]; ties: nearest 0."""
    v = sorted(rels)
    best, s_best, j = -1, 0.0, 0
    for i, r in enumerate(v):
        while j < len(v) and v[j] <= r + (hi - lo):
            j += 1
        s = r - lo
        if j - i > best or (j - i == best and abs(s) < abs(s_best)):
            best, s_best = j - i, s
    return s_best


def headroom(rows, min_n=30):
    """Rolling origin by day: shift each Passio time by a constant share of its lead, learned on EARLIER days only,
    per (route, stop, trip segment, bin), else (route, segment, bin), else (segment, bin), else none. Two targets:
    the shift that fits the most past errors inside the 10% band, and the one that fits the most inside band B
    (10% early to 1% late, the working reading of the 1% rule). Scored after the first two Passio days."""
    days = sorted({ft["service_day"] for _, _, _, ft in rows})
    seg = lambda ft: "next" if ft["next_trip"] == "1" else "cur"
    levels = (lambda b, ft: (ft["route_name"], ft["stop_id"], seg(ft), b),
              lambda b, ft: (ft["route_name"], seg(ft), b),
              lambda b, ft: (seg(ft), b))
    targets = {"10%": (-0.10, 0.10), "band B": (-0.10, 0.01)}
    hist = [defaultdict(list) for _ in levels]
    res = {"raw": defaultdict(list), **{t: defaultdict(list) for t in targets}}
    for i, d in enumerate(days):
        today = [(b, e, ld, ft) for b, e, ld, ft in rows if ft["service_day"] == d]
        if i >= 2:
            shifts = {t: [{k: best_shift(v, lo, hi) for k, v in h.items() if len(v) >= min_n} for h in hist]
                      for t, (lo, hi) in targets.items()}
            for b, e, ld, ft in today:
                res["raw"][b].append((e, ld))
                for t in targets:
                    s = next((shifts[t][n][kf(b, ft)] for n, kf in enumerate(levels) if kf(b, ft) in shifts[t][n]), 0.0)
                    res[t][b].append((e - s * ld, ld))
        for b, e, ld, ft in today:
            if not gross(e, ld):
                for h, kf in zip(hist, levels):
                    h[kf(b, ft)].append(e / ld)
    out = ["### Headroom: the same Passio times with a learned shift (rolling origin: learned on earlier days only)", "",
           f"Scored days: {days[2]} to {days[-1]} ({len(days) - 2} service days). Each cell: 10% rule / band B / "
           "shown later than the bus came by more than 1% of the lead (the 1% rule, dangerous direction).", "",
           "| lead | samples | Passio as shown | shift tuned for the 10% rule | shift tuned for band B |",
           "|---|---:|---|---|---|"]
    cell = lambda m: f"{pct(m['p10'])} / {pct(m['bandB'])} / {pct(m['late1'])}"
    for b in BINS:
        a = metrics(res["raw"][b])
        if not a:
            continue
        out.append(f"| {b} min | {a['n']:,} | {cell(a)} | {cell(metrics(res['10%'][b]))} | {cell(metrics(res['band B'][b]))} |")
    return out + ["", f"Shift per stop and trip segment when that group had at least {min_n} past samples, else per route, "
                  "else per segment. Gross misses stay out of the pass rates as everywhere; the too-late share counts "
                  "every sample.", ""]


def median_matrix(title, rows, keyf, order, note=""):
    """Median error (minutes) by group x goal bin, n in brackets."""
    g = defaultdict(lambda: defaultdict(list))
    for b, e, ld, ft in rows:
        k = keyf(ft)
        if k is not None and not gross(e, ld):
            g[k][b].append(e)
    out = [f"### {title}", ""] + ([note, ""] if note else [])
    out += ["| group | " + " | ".join(f"{b} min" for b in BINS) + " |", "|---|" + "---:|" * len(BINS)]
    for k in order:
        if k in g:
            out.append(f"| {k} | " + " | ".join(f"{mins(statistics.median(g[k][b]))} ({len(g[k][b]):,})"
                                                 if len(g[k][b]) >= 30 else "" for b in BINS) + " |")
    return out + [""]


def stops_table(rows, b="10-15", min_n=120, top=12):
    g = defaultdict(list)
    for bb, e, ld, ft in rows:
        if bb == b:
            g[(ft["route_name"], ft["stop_name"], ft["stop_index"] == "0")].append((e, ld))
    ms = [(k, metrics(v)) for k, v in g.items() if len(v) >= min_n]
    tot_miss = sum(1 for v in g.values() for e, ld in v if not gross(e, ld) and abs(e) > 0.10 * ld) or 1
    out = [f"### Stops: the {top} worst and the {top} with the most misses at {b} min ahead (at least {min_n} samples)", "",
           "| route | stop | samples | 10% rule | median error (min) | share of all misses at this lead |",
           "|---|---|---:|---:|---:|---:|"]
    for (r, s, first), m in sorted(ms, key=lambda x: x[1]["p10"])[:top]:
        miss = m["ok"] - round(m["p10"] * m["ok"])
        out.append(f"| {r} | {s}{' (first stop)' if first else ''} | {m['n']:,} | {pct(m['p10'])} | {mins(m['med'])} |"
                   f" {pct(miss / tot_miss, 1)} |")
    out += ["", "| route | stop | samples | 10% rule | median error (min) | share of all misses at this lead |",
            "|---|---|---:|---:|---:|---:|"]
    for (r, s, first), m in sorted(ms, key=lambda x: -(x[1]["ok"] - x[1]["p10"] * x[1]["ok"]))[:top]:
        miss = m["ok"] - round(m["p10"] * m["ok"])
        out.append(f"| {r} | {s}{' (first stop)' if first else ''} | {m['n']:,} | {pct(m['p10'])} | {mins(m['med'])} |"
                   f" {pct(miss / tot_miss, 1)} |")
    return out + [""]


def daily(rows):
    g = defaultdict(lambda: defaultdict(list))
    for b, e, ld, ft in rows:
        g[ft["service_day"]][b].append((e, ld))
    out = ["### Day by day (Passio, 10% rule)", "",
           "| service day | " + " | ".join(f"{b} min" for b in BINS) + " | samples |", "|---|" + "---:|" * (len(BINS) + 1)]
    for d in sorted(g):
        dw = DOW[date.fromisoformat(d).weekday()]
        cells = [pct((metrics(g[d][b]) or {}).get("p10")) if len(g[d][b]) >= 20 else "" for b in BINS]
        out.append(f"| {d} {dw} | " + " | ".join(cells) + f" | {sum(len(v) for v in g[d].values()):,} |")
    return out + [""]


def fixed_leads(pred_path, arr_path):
    """predictions.csv view: one row per arrival and exact lead (1, 2, 3, 5, 10, 15, 20, 30 min)."""
    with open(pred_path, encoding="utf-8", newline="") as f:
        P = list(csv.DictReader(f))
    t0 = min(int(r["epoch"]) for r in P)
    with open(arr_path, encoding="utf-8", newline="") as f:
        n_arr = sum(1 for r in csv.DictReader(f) if int(r["epoch"]) >= t0 and r["source"] != "gps")
    by = defaultdict(list)
    for r in P:
        by[int(r["lead_target_s"])].append((float(r["pred_minus_actual_s"]), float(r["lead_target_s"])))
    out = [f"### Exact leads (predictions.csv, {L.chicago(t0):%b %d %H:%M} on; {n_arr:,} arrivals that can carry a prediction)", "",
           "| lead | allowed by the 10% rule | arrivals with a time on display | 10% rule | with a 1-min floor | band B |"
           " bus came > 10% later | bus came > 10% earlier | gross | median error (min) |",
           "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for ld in sorted(by):
        m = metrics(by[ld])
        allow = f"{0.1 * ld:.0f} s" if ld < 600 else f"{0.1 * ld / 60:.1f} min"
        out.append(f"| {ld // 60} min | {allow} | {pct(m['n'] / n_arr)} | {pct(m['p10'])} | {pct(m['p10f'])} | {pct(m['bandB'])} |"
                   f" {pct(m['later_miss'])} | {pct(m['early_miss'])} | {pct(m['gross_rate'])} | {mins(m['med'])} |")
    return out + ["", "`gps` arrivals (DC-003) never carry a prediction and are left out of the count.", ""]


# ---------------------------------------------------------------- main
def bucket(v, edges, labels, blank="unknown"):
    if v is None:
        return blank
    for e, lab in zip(edges, labels):
        if v < e:
            return lab
    return labels[-1]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--eta-dir", required=True)
    ap.add_argument("--predictions")
    ap.add_argument("--arrivals")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    files = sorted(Path(a.eta_dir).glob("eta-*.csv.gz"))
    if not files:
        sys.exit(f"no eta-*.csv.gz in {a.eta_dir}")
    samples, targets_all = [], {}
    for p in files:
        s, t = load_day(p)
        samples += s
        day = p.name[4:14]                 # an arrival key is unique within a day file (summary() is per day)
        targets_all.update({(b, (day,) + akey): v for (b, akey), v in t.items()})
        print(f"{p.name}: {len(s):,} samples", file=sys.stderr)
    by_src_bin, by_src_bin_day = defaultdict(list), defaultdict(lambda: defaultdict(list))
    for src, b, e, ld, ft in samples:
        by_src_bin[(src, b)].append((e, ld))
        by_src_bin_day[(src, b)][ft["service_day"]].append((e, ld))
    P = [(b, e, ld, ft) for src, b, e, ld, ft in samples if src == "passio"]
    days = sorted({ft["service_day"] for _, _, _, ft in P})
    pdays = set(days)        # coverage only on days Passio's predictions were collected (from 2026-10-12 12:20)
    targets_all = {k: v for k, v in targets_all.items() if k[1][0] in pdays}

    out = [f"# E24 tables: Passio against the 10% rule ({days[0]} to {days[-1]}, {len(days)} service days with Passio; "
           f"timetable sources from {min(f.name[4:14] for f in files)})", ""]
    out += headline(by_src_bin, by_src_bin_day)
    out += spread(P)
    if a.predictions and a.arrivals:
        out += fixed_leads(a.predictions, a.arrivals)
    out += coverage(targets_all)
    out += matrix("By trip: the one the bus drives now vs its next trip", P,
                  lambda ft, e, ld: "next trip" if ft["next_trip"] == "1" else "current trip")
    out += matrix("By route", P, lambda ft, e, ld: ft["route_name"], min_n=200)
    hours = [(5, "5-7 AM"), (7, "7-10 AM"), (10, "10 AM-3 PM"), (15, "3-7 PM"), (19, "7-10 PM"), (22, "10 PM-5 AM")]

    def hb(ft, e, ld):
        h = ft["hour"]
        return "10 PM-5 AM" if h < 5 else [x for s, x in hours if h >= s][-1]
    out += matrix("By time of day (Chicago time of the arrival)", P, hb, order=[x for _, x in hours])
    out += matrix("By day of the week", P, lambda ft, e, ld: DOW[int(ft["dow"])] if ft["dow"] != "" else None,
                  order=list(DOW))
    out += matrix("By stops still to go before the target stop", P,
                  lambda ft, e, ld: bucket(num(ft["stops_away"]), (2, 4, 7, 11, 999), ("1", "2-3", "4-6", "7-10", "11+")),
                  order=["1", "2-3", "4-6", "7-10", "11+", "unknown"])
    out += median_matrix("Current trip only: median error by stops still to go (minutes; negative = bus later than shown)",
                         [x for x in P if x[3]["next_trip"] != "1"],
                         lambda ft: bucket(num(ft["stops_away"]), (2, 4, 7, 11, 999), ("1", "2-3", "4-6", "7-10", "11+"), None),
                         ["1", "2-3", "4-6", "7-10", "11+"])
    out += matrix("By whether the bus must pass the end of its line first", P,
                  lambda ft, e, ld: "crosses the end of the line" if ft["crosses_terminal"] == "1" else "same run")
    out += matrix("By the bus's current delay against the timetable (at its last stop)", P,
                  lambda ft, e, ld: bucket(num(ft["delay_s"]), (-120, 120, 300, 600, 1e9),
                                           ("more than 2 min early", "on time (within 2 min)", "2-5 min late",
                                            "5-10 min late", "over 10 min late"), "no timetable (frequency trip) or unknown"),
                  order=["more than 2 min early", "on time (within 2 min)", "2-5 min late", "5-10 min late",
                         "over 10 min late", "no timetable (frequency trip) or unknown"])
    out += matrix("By how old Passio's prediction was when a rider looked", P,
                  lambda ft, e, ld: bucket(num(ft["passio_age_s"]), (60, 120, 300, 900, 1e12),
                                           ("under 1 min", "1-2 min", "2-5 min", "5-15 min", "over 15 min")),
                  order=["under 1 min", "1-2 min", "2-5 min", "5-15 min", "over 15 min", "unknown"])
    out += matrix("By what the bus was doing when a rider looked", P,
                  lambda ft, e, ld: bucket(num(ft["standing_s"]), (30, 120, 300, 1e12),
                                           ("moving", "standing under 2 min", "standing 2-5 min", "standing over 5 min"),
                                           "no recent position"),
                  order=["moving", "standing under 2 min", "standing 2-5 min", "standing over 5 min", "no recent position"])
    out += matrix("First stop of the route vs the rest", P,
                  lambda ft, e, ld: "first stop (Passio predicts the departure)" if ft["stop_index"] == "0" else "other stops")
    out += stops_table(P)
    out += daily(P)

    # same arrivals for every source (each source's sample of an arrival may come from a different minute's row,
    # whose trip segment can differ; the Passio row's segment names the group when there is one)
    keyed, segs = defaultdict(dict), {}
    for src, b, e, ld, ft in samples:
        k = (b, ft["service_day"], ft["_akey"])
        keyed[k][src] = (e, ld)
        if src == "passio" or k not in segs:
            segs[k] = "next_trip" if ft["next_trip"] == "1" else "current_trip"
    keyed = {(k[0], segs[k], k[1:]): v for k, v in keyed.items()}
    out += keyed_compare(keyed)
    out += headroom(P)
    text = "\n".join(out)
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()

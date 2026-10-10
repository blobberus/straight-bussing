#!/usr/bin/env python3
"""RouteKnower E01: data-quality audit of the ground-truth arrivals (RouteKnower.md §3.3 items 1-5).

  python tools/rk_data_audit.py --data arrivals.csv [--gtfs google_transit.zip] [--out report.md]

Read-only, stdlib only. Prints markdown tables (or writes them below the results marker of --out).
--gtfs (the static zip, optional) adds the scheduled-time check and the stop patterns of each route.
Terms: a *vehicle lap* is one bus going once around its loop, cut where the stop position goes back
(trip ids ignored, because Passio changes them mid-lap); *position* = stop_index mod (n - 1), so the
terminal (index 0 and n - 1) is one position. Experiment write-up: experiments/routeknower/E01-*.md."""
import argparse, bisect, csv, hashlib, io, json, math, statistics, sys, zipfile
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import model_core as C

MARK = "<!-- E01:RESULTS -->"
LEAD_BINS = ((120, 300, "2-5"), (300, 600, "5-10"), (600, 1200, "10-20"), (1200, 3600, "20-60"))


def hav(a, b):
    return C.haversine(a["lat"], a["lon"], b["lat"], b["lon"])


def sday(r):
    """Service day (4 AM local cut, like the data repo)."""
    return r["local_time"][:10] if int(r["hour"]) >= 4 else "<" + r["local_time"][:10]


def q(v, p):
    return C.quantile(v, p) if v else float("nan")


def table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "|".join("---" if i == 0 else "---:" for i in range(len(head))) + "|"]
    return out + ["| " + " | ".join(str(x) for x in r) + " |" for r in rows]


class Data:
    def __init__(self, path, web, gtfs=None):
        self.path = Path(path)
        self.rows = C.read_dicts(path)
        rd = lambda n: json.loads((Path(web) / n).read_text(encoding="utf-8"))
        self.order, self.routes, self.stops = rd("route_stops.json"), rd("routes.json"), rd("stops.json")
        for r in self.rows:
            r["ep"], r["i"] = int(r["epoch"]), int(r["stop_index"])
            r["pe"] = int(r["prev_arrival_epoch"]) if r["prev_arrival_epoch"] else None
            r["n"] = len(self.order.get(r["route_id"]) or [None, None])
        self.byv = defaultdict(list)
        for r in self.rows:
            self.byv[r["vehicle_id"]].append(r)
        for v in self.byv.values():
            v.sort(key=lambda r: r["ep"])
        self.veps = {k: [r["ep"] for r in v] for k, v in self.byv.items()}
        self.at = {(r["vehicle_id"], r["stop_id"], r["ep"]): r for r in self.rows}
        bt = defaultdict(list)
        for r in self.rows:
            bt[r["trip_id"]].append((r["ep"], r["vehicle_id"]))
        self.bytrip = {k: sorted(v) for k, v in bt.items()}
        self.gtfs = load_gtfs(gtfs) if gtfs else None

    def name(self, rid):
        return (self.routes.get(rid) or {}).get("long", rid)

    def prev_idx(self, r):
        """Route index of the row's previous stop (nearest occurrence before stop_index)."""
        c = [i for i, s in enumerate(self.order.get(r["route_id"], [])) if s == r["prev_stop_id"] and i < r["i"]]
        return max(c) if c else None

    def between(self, r):
        """Other arrivals of the same vehicle strictly between prev_arrival_epoch and epoch."""
        e = self.veps[r["vehicle_id"]]
        return bisect.bisect_left(e, r["ep"]) - bisect.bisect_right(e, r["pe"])

    def shared(self, r, w=2700):
        """Another vehicle logged the same trip id within +-w s (Passio gives several buses one trip id)."""
        v = self.bytrip[r["trip_id"]]
        lo, hi = bisect.bisect_left(v, (r["ep"] - w, "")), bisect.bisect_right(v, (r["ep"] + w, "\uffff"))
        return any(x[1] != r["vehicle_id"] for x in v[lo:hi])

    def laps(self):
        """route -> list of vehicle laps (lists of rows), trip ids ignored."""
        out = defaultdict(list)
        for v in self.byv.values():
            cur = []
            for r in v:
                p = r["i"] % (r["n"] - 1)
                if cur and (r["route_id"] != cur[-1]["route_id"] or p < cur[-1]["i"] % (r["n"] - 1)
                            or r["ep"] - cur[-1]["ep"] > 1800):
                    out[cur[0]["route_id"]].append(cur)
                    cur = []
                cur.append(r)
            if cur:
                out[cur[0]["route_id"]].append(cur)
        return out


def load_gtfs(path):
    z = zipfile.ZipFile(path)
    rows = lambda n: list(csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig")))
    st = defaultdict(list)
    for s in rows("stop_times.txt"):
        t = (s.get("arrival_time") or s.get("departure_time") or "").strip()
        h, m, x = (int(v) for v in t.split(":")) if t.count(":") == 2 else (None, 0, 0)
        st[s["trip_id"]].append((int(s["stop_sequence"]), s["stop_id"], None if h is None else h * 3600 + m * 60 + x))
    for k, v in st.items():                      # untimed stops: interpolate by position between timepoints
        v.sort()
        known = [i for i, x in enumerate(v) if x[2] is not None]
        for i, (sq, sid, t) in enumerate(v):
            if t is None and known:
                a = max((j for j in known if j < i), default=known[0])
                b = min((j for j in known if j > i), default=known[-1])
                ta, tb = v[a][2], v[b][2]
                v[i] = (sq, sid, ta if a == b else ta + (tb - ta) * (i - a) / (b - a))
    trips = {t["trip_id"]: t for t in rows("trips.txt")}
    freq = {f["trip_id"] for f in rows("frequencies.txt")}
    info = (rows("feed_info.txt") or [{}])[0]
    return {"st": {k: sorted(v) for k, v in st.items()}, "trips": trips, "freq": freq, "info": info}


# ---------------- sections ----------------
def snapshot(D):
    h = hashlib.sha256(D.path.read_bytes()).hexdigest()
    by = sorted(D.rows, key=lambda r: r["ep"])
    days = Counter(sday(r) for r in D.rows)
    return [f"Snapshot: `{D.path.name}`, {len(D.rows)} rows, {by[0]['local_time']} to {by[-1]['local_time']} local, "
            f"service days {dict(sorted(days.items()))}, sha256 `{h}`."]


def duplicates(D):
    """Item 4: the merge rule (same vehicle + stop within 120 s) and what is left just above it."""
    exact = len(D.rows) - len({tuple(v for k, v in r.items() if k not in ("ep", "i", "pe", "n")) for r in D.rows})
    by = defaultdict(list)
    for r in D.rows:
        by[(r["vehicle_id"], r["stop_id"])].append(r)
    gaps, near = Counter(), []
    for v in by.values():
        v.sort(key=lambda r: r["ep"])
        for a, b in zip(v, v[1:]):
            g = b["ep"] - a["ep"]
            gaps["<=120 s" if g <= 120 else "121-300 s" if g <= 300 else "301-600 s" if g <= 600 else
                 "601-900 s" if g <= 900 else None] += 1
            if 120 < g <= 300:
                near.append((a, b, g))
    gaps.pop(None, None)
    kinds = Counter("same trip + index" if a["trip_id"] == b["trip_id"] and a["i"] == b["i"] else "trip id differs"
                    for a, b, _ in near)
    within = sum(1 for a, b, g in near if a["dwell_s"] and g <= float(a["dwell_s"]) + 60)
    out = [f"Exact duplicate rows: **{exact}**. Same vehicle + stop within 120 s (the merge rule since d43ed21): "
           f"**{gaps['<=120 s']}**.", "",
           "Same vehicle + stop revisits by gap: " + ", ".join(f"{k}: {gaps[k]}" for k in
                                                                ("121-300 s", "301-600 s", "601-900 s")) +
           f". The {len(near)} pairs 121-300 s apart: {dict(kinds)}; {within} start inside the first row's dwell "
           "(+60 s). No loop on this network is shorter than ~15 min, so these are one visit timed twice."]
    return out


def pairs(D):
    """Item 1: distinct (prev, stop) pairs per route, adjacency, and why pairs are non-adjacent."""
    head = ["route", "rows", "no prev", "pairs", "adjacent rows", "skip 1", "skip 2", "skip >= 3",
            "rows in pairs n < 5", "stale links"]
    out = []
    for rid in sorted(D.order, key=D.name):
        rr = [r for r in D.rows if r["route_id"] == rid]
        wp = [r for r in rr if r["pe"] is not None]
        if not rr:
            continue
        pc = Counter((r["prev_stop_id"], r["stop_id"]) for r in wp)
        sk = Counter(min(r["i"] - (D.prev_idx(r) or 0) - 1, 3) for r in wp)
        stale = sum(1 for r in wp if D.between(r) > 0)
        out.append([D.name(rid), len(rr), f"{(len(rr) - len(wp)) / len(rr):.0%}", len(pc),
                    f"{sk[0]} ({sk[0] / max(1, len(wp)):.0%})", sk[1], sk[2], sk[3],
                    sum(c for c in pc.values() if c < 5), stale])
    return table(head, out)


def stale_links(D):
    """Rows whose prev link jumps over other arrivals of the same bus, by cause."""
    wp = [r for r in D.rows if r["pe"] is not None]
    st = [r for r in wp if D.between(r) > 0]
    seg = [int(r["segment_s"]) for r in st]
    flip = sum(1 for r in st if any(x["trip_id"] != r["trip_id"] for x in
                                     D.byv[r["vehicle_id"]][bisect.bisect_right(D.veps[r["vehicle_id"]], r["pe"]):
                                                            bisect.bisect_left(D.veps[r["vehicle_id"]], r["ep"])]))
    return [f"Stale links (another arrival of the same bus lies between `prev_arrival_epoch` and `epoch`, so the "
            f"segment cannot be one drive): **{len(st)} of {len(wp)}** rows with a previous stop "
            f"({len(st) / len(wp):.1%}); median segment_s {q(seg, .5):.0f} s, {sum(s > 1800 for s in seg)} over 30 min; "
            f"{flip} have a different trip id in between (trip-id flap), {len(st) - flip} the same trip id "
            "(a collector that missed part of the lap and linked across it)."]


def teleports(D):
    """Consecutive arrivals of one bus too far apart for the time between them (> 25 m/s, > 300 m)."""
    bad, src = Counter(), Counter()
    for v in D.byv.values():
        for a, b in zip(v, v[1:]):
            d = hav(D.stops[a["stop_id"]], D.stops[b["stop_id"]])
            dt = b["ep"] - a["ep"]
            if d > 300 and (dt <= 0 or d / dt > 25):
                bad[D.name(a["route_id"])] += 1
                src[a["source"]] += 1
    return [f"Impossible hops (two consecutive arrivals of one bus > 300 m apart at > 25 m/s): **{sum(bad.values())}**, "
            f"{dict(bad.most_common())}; the earlier row's source: {dict(src)}."]


def detection(D, focus=("5701", "5715", "6126", "5702", "5704", "5703")):
    """Item 2: detected share per trip-id group (as in §3.1) vs per vehicle lap, and per stop index."""
    L = D.laps()
    head = ["route", "n", "share per trip id (/n, §3.1)", "per trip id (/(n-1))", "vehicle laps",
            "share per lap", "full laps", "share in full laps", "trip ids per full lap"]
    g = defaultdict(list)
    for r in D.rows:
        g[(r["route_id"], r["vehicle_id"], r["trip_id"], sday(r))].append(r)
    out = []
    per_stop = {}
    for rid in sorted(D.order, key=D.name):
        n = len(D.order[rid])
        tg = [v for k, v in g.items() if k[0] == rid]
        if not tg:
            continue
        laps = L[rid]
        full = [l for l in laps if min(r["i"] % (n - 1) for r in l) <= 1 and max(r["i"] % (n - 1) for r in l) >= n - 2]
        sh = lambda l: len({r["i"] % (n - 1) for r in l}) / (n - 1)
        out.append([D.name(rid), n, f"{statistics.median(len({r['i'] for r in v}) / n for v in tg):.2f}",
                    f"{statistics.median(sh(v) for v in tg):.2f}", len(laps),
                    f"{statistics.median(sh(l) for l in laps):.2f}", len(full),
                    f"{statistics.median(sh(l) for l in full):.2f}" if full else "-",
                    f"{statistics.mean(len({r['trip_id'] for r in l}) for l in full):.1f}" if full else "-"])
        if rid in focus:
            det = Counter(p for l in full for p in {r["i"] % (n - 1) for r in l})
            per_stop[rid] = (len(full), [(i, D.order[rid][i], det[i % (n - 1)]) for i in range(n - 1)])
    lines = table(head, out) + [""]
    for rid, (nf, rows) in per_stop.items():
        o = D.order[rid]
        lines.append(f"{D.name(rid)}: stops detected in {nf} full laps: " + ", ".join(
            f"{i} {D.stops[s]['name'][:22]} {c / max(1, nf):.0%} ({hav(D.stops[s], D.stops[o[i + 1]]):.0f} m on)"
            for i, s, c in rows) + ".")
    return lines


def schedule_check(D):
    """Rows whose trip id is far from that trip's scheduled time at the stop (GTFS stop_times)."""
    if not D.gtfs:
        return ["(no --gtfs: scheduled-time check skipped)"]
    G = D.gtfs
    dev = defaultdict(list)
    for r in D.rows:
        st = G["st"].get(r["trip_id"])
        if not st or r["trip_id"] in G["freq"]:
            continue
        seq = r["i"] + 1
        m = [t for s, sid, t in st if s == seq and sid == r["stop_id"] and t is not None] or \
            [t for s, sid, t in st if sid == r["stop_id"] and t is not None]
        if not m:
            continue
        loc = r["local_time"]
        secs = int(loc[11:13]) * 3600 + int(loc[14:16]) * 60 + int(loc[17:19])
        if int(r["hour"]) < 4:
            secs += 86400
        dev[r["route_id"]].append(min(abs(secs - t) for t in m) / 60)
    out = []
    for rid in sorted(dev, key=D.name):
        v = dev[rid]
        out.append([D.name(rid), len(v), f"{q(v, .5):.1f}", f"{q(v, .9):.1f}", sum(x > 20 for x in v),
                    f"{sum(x > 20 for x in v) / len(v):.1%}"])
    pat = []
    seen = defaultdict(set)
    for r in D.rows:
        seen[r["route_id"]].add(r["trip_id"])
    for rid in sorted(D.order, key=D.name):
        tl = [t for t, tr in G["trips"].items() if tr["route_id"] == rid]
        c = Counter(tuple(s for _, s, _ in G["st"].get(t, ())) for t in tl)
        if len(c) < 2 and not any(t in G["freq"] for t in tl):
            continue
        o = D.order[rid]
        desc = []
        for p, n in c.most_common():
            live = sum(1 for t in tl if t in seen[rid] and tuple(s for _, s, _ in G["st"][t]) == p)
            extra = [D.stops.get(s, {}).get("name", s)[:24] for s in dict.fromkeys(p) if s not in o]
            miss = [D.stops.get(s, {}).get("name", s)[:24] for s in dict.fromkeys(o) if s not in p]
            desc.append(f"{n} trips x {len(p)} stops ({live} trip ids seen live)" +
                        (" = route_stops" if list(p) == o else f", not in route_stops: {extra or '-'}, skips: {miss or '-'}"))
        pat.append(f"{D.name(rid)}: " + "; ".join(desc) +
                   (" (frequency-based: one trip id for every bus all day)" if any(t in G["freq"] for t in tl) else ""))
    return (table(["route", "rows", "median abs(actual - scheduled) min", "p90", "> 20 min", "share"], out) +
            ["", f"GTFS feed {G['info'].get('feed_start_date')}-{G['info'].get('feed_end_date')}. Routes with variants: "] +
            [f"- {p}" for p in pat])


def tails(D, clean=False):
    """Item 3: worst 2% of segment time (vs its segment median), speed and dwell after load_rows, by cause."""
    R = C.rows_from_dicts(D.rows, clean=clean)
    byk = defaultdict(list)
    for r in R:
        byk[r.key].append(r.run)
    med = {k: statistics.median(v) for k, v in byk.items()}
    index = {(r["vehicle_id"], r["stop_id"], r["ep"]): r for r in D.rows}

    def cause(r):
        d = index.get((r.vehicle, r.stop, int(r.epoch)))
        if d is None:
            return "?"
        n = d["n"]
        pi = D.prev_idx(d)
        if D.between(d) > 0:
            return "stale link"
        p = index.get((r.vehicle, r.prev, int(r.prev_epoch)))
        if p is None:
            return "prev row missing"
        if p["trip_id"] != d["trip_id"] and not (p["i"] == p["n"] - 1 and d["i"] in (0, 1)):
            return "trip-id flip mid-lap"
        if r.speed > 20:
            return "timing artefact (> 20 m/s)"
        if pi == 0 or d["i"] == n - 1:
            return "touches terminal (layover)"
        if pi is not None and d["i"] - pi > 1:
            return "skipped stops"
        return "other (traffic / detour / long dwell)"

    def summarize(sel, title):
        c = Counter(cause(r) for r in sel)
        return f"- **{title}** (n = {len(sel)}): " + ", ".join(f"{k} {v}" for k, v in c.most_common())

    k = max(1, round(0.02 * len(R)))
    ratio = sorted(R, key=lambda r: r.run / med[r.key], reverse=True)[:k]
    fast = sorted(R, key=lambda r: r.speed, reverse=True)[:k]
    slow = sorted(R, key=lambda r: r.speed)[:k]
    all_c = Counter(cause(r) for r in R)
    rec = Counter((D.name(r.route), D.stops[r.prev]["name"][:22], D.stops[r.stop]["name"][:22]) for r in ratio
                  if cause(r).startswith("other"))
    dw = [d for d in D.rows if d["dwell_s"]]
    dw_top = sorted(dw, key=lambda d: float(d["dwell_s"]), reverse=True)[:max(1, round(0.02 * len(dw)))]
    dterm = Counter("terminal" if d["i"] in (0, d["n"] - 1) else "mid-route" for d in dw_top)
    res = [f"{'With' if clean else 'Without'} the E01 rules: {len(R)} segment rows (of {len(D.rows)}). Worst 2% = {k} rows.",
           f"Causes over all rows: " + ", ".join(f"{a} {b}" for a, b in all_c.most_common()) + ".",
           summarize(ratio, "run time / segment median, top 2%") +
           f" (ratio {ratio[-1].run / med[ratio[-1].key]:.1f}x to {ratio[0].run / med[ratio[0].key]:.0f}x)",
           "  - recurring segments among the 'other' rows: " + "; ".join(
               f"{a}: {b} -> {c} {n}" for (a, b, c), n in rec.most_common(7)),
           summarize(fast, "fastest 2%") + f" (>= {fast[-1].speed:.1f} m/s)",
           summarize(slow, "slowest 2%") + f" (<= {slow[-1].speed:.2f} m/s)",
           f"- **dwell_s top 2%** (n = {len(dw_top)}, >= {float(dw_top[-1]['dwell_s']):.0f} s): {dict(dterm)}; "
           f"stops: " + ", ".join(f"{D.stops[s]['name'][:20]} {c}" for s, c in Counter(d['stop_id'] for d in dw_top).most_common(6))]
    return res[:-1] if clean else res, R


def tail_metric(R):
    """Heaviness of the residual tail: RMSE / MAE of log-free residuals against the (route, prev, stop) median."""
    byk = defaultdict(list)
    for r in R:
        byk[r.key].append(r.run)
    med = {k: statistics.median(v) for k, v in byk.items()}
    e = [r.run - med[r.key] for r in R]
    return len(R), C.mae(e), C.rmse(e)


def passio(D):
    """Item 5: Passio |error| by route group x lead bin, and what the long-lead rows are."""
    P = [r for r in D.rows if r["passio_pred_epoch"]]
    for r in P:
        r["err"], r["lead"] = int(r["passio_pred_epoch"]) - r["ep"], int(r["passio_pred_lead_s"])
        r["sh"] = D.shared(r)

    def cells(rows):
        o = []
        for lo, hi, _ in LEAD_BINS:
            e = [abs(r["err"]) for r in rows if lo <= r["lead"] < hi]
            o.append(f"{statistics.mean(e):.0f} ({len(e)})" if e else "-")
        return o
    groups = [("all rows", P), ("Downtown Campus Connector", [r for r in P if r["route_id"] == "5704"]),
              ("other routes, trip id shared with another bus", [r for r in P if r["route_id"] != "5704" and r["sh"]]),
              ("other routes, own trip id, trip start (index 0)", [r for r in P if r["route_id"] != "5704" and not r["sh"] and r["i"] == 0]),
              ("other routes, own trip id, rest", [r for r in P if r["route_id"] != "5704" and not r["sh"] and r["i"] > 0])]
    lines = table(["rows", "2-5 min MAE s (n)", "5-10", "10-20", "20-60"], [[g] + cells(v) for g, v in groups])
    leads = [r["lead"] for r in P]
    long_ = sorted([r for r in P if r["lead"] >= 300 and r["route_id"] != "5704"], key=lambda r: r["ep"])
    eps = sorted(r["ep"] for r in P if r["route_id"] != "5704")
    lp = sorted((r["ep"], r["lead"] >= 300, r["vehicle_id"]) for r in P if r["route_id"] != "5704")
    alone = 0
    for r in long_:
        lo, hi = bisect.bisect_left(lp, (r["ep"] - 150,)), bisect.bisect_right(lp, (r["ep"] + 150, True, "\uffff"))
        oth = [x for x in lp[lo:hi] if x[2] != r["vehicle_id"]]
        alone += bool(oth) and sum(x[1] for x in oth) / len(oth) <= 0.5
    frozen = sum(1 for r in long_ if abs(r["err"] + r["lead"]) < 90)
    lines += ["", f"Lead of the stored prediction: median {q(leads, .5):.0f} s, p90 {q(leads, .9):.0f} s, "
              f"{sum(x >= 300 for x in leads) / len(leads):.1%} >= 300 s. Off the DCC, {len(long_)} rows have a lead >= 300 s; "
              f"in {alone} of them the other buses arriving within +-150 s had normal leads (the feed was up: Passio had "
              f"stopped updating this trip + stop), and in {frozen} the prediction equals the time it was made "
              "(+-90 s: Passio said \"arriving now\" and froze)."]
    return lines


def effect(D):
    """Before/after the E01 load_rows cleaning (C.rows_from_dicts with clean=False vs default)."""
    out = []
    for name, rows in (("before E01 rules", C.rows_from_dicts(D.rows, clean=False)), ("after E01 rules", C.rows_from_dicts(D.rows))):
        n, m, r = tail_metric(rows)
        pe = [abs(x.passio - x.epoch) for x in rows if x.passio is not None]
        out.append([name, n, f"{m:.1f}", f"{r:.1f}", f"{r / m:.2f}", len(pe), f"{statistics.mean(pe):.0f}" if pe else "-",
                    f"{q(pe, .9):.0f}" if pe else "-"])
    return table(["load_rows", "segment rows", "MAE vs segment median s", "RMSE s", "RMSE / MAE", "rows with Passio",
                  "Passio MAE s", "Passio p90 s"], out)


def build(D):
    t_lines, _ = tails(D)
    t_after, _ = tails(D, clean=True)
    sec = [("Snapshot", snapshot(D)), ("Item 4: duplicates", duplicates(D)),
           ("Item 1: (prev, stop) pairs per route", pairs(D) + [""] + stale_links(D) + [""] + teleports(D)),
           ("Item 2: detection share", detection(D)),
           ("Scheduled-time check (trip ids far from their own schedule)", schedule_check(D)),
           ("Item 3: heavy tails", t_lines + [""] + t_after), ("Item 5: Passio error by lead", passio(D)),
           ("Effect of the E01 load_rows rules", effect(D))]
    out = []
    for title, lines in sec:
        out += [f"### {title}", ""] + lines + [""]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True)
    ap.add_argument("--web", default=str(C.WEB_DATA))
    ap.add_argument("--gtfs", help="static google_transit.zip (optional)")
    ap.add_argument("--out", help="markdown file: replaces everything below the results marker")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    md = build(Data(a.data, a.web, a.gtfs))
    if not a.out:
        print(md)
        return
    p = Path(a.out)
    head = p.read_text(encoding="utf-8").split(MARK)[0] if p.exists() else ""
    p.write_text(head + MARK + "\n" + md, encoding="utf-8")
    print(f"wrote {p}")


if __name__ == "__main__":
    main()

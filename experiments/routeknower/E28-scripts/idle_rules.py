#!/usr/bin/env python3
"""E28 part 2: which rule hides the buses that linger without serving (end of a shift, parked, a long break) and never
a bus about to serve riders? Replays every fresh report of every bus poll by poll as the app would (a per-bus "still"
clock: the time since the bus came within STILL_M of where it stopped), with what a phone knows at that moment (Passio's
predictions for the bus from the logged prediction updates, the route's listed hours, the learned linger cutoffs) and
scores each candidate rule against what happened next (the logged arrivals by vehicle).

Rules (a bus is hidden when ANY enabled part holds; each needs the bus still for its own minimum):
  A  idle:      still >= idle_min AND Passio predicts no stop for the bus at least FUTURE_S ahead
  B  past hours: still >= past_min AND the route is outside its listed hours by more than pad_min
  C  linger:    still >= past_min at a learned linger spot of its route after that spot's learned cutoff (the latest
                time on the training days a bus still there ever served again within 30 min, + margin; only spots with
                at least min_eos end-of-shift episodes after it)

Scores (bus-minutes, the time each report stands for, capped at 60 s, on reports today's app shows):
  hidden by label of the episode the report is in (layover / break / end_of_shift / garage_return / parked_never_served,
  moving = in no episode), near_10 = hidden while the bus's next arrival away from that spot came within 10 min (a
  rider could have used it), near_2 = within 2 min of a logged arrival; idle_shown = the non-layover still minutes
  today's app shows (the target).

  python experiments/routeknower/E28-scripts/idle_rules.py --dl <fetch.py folder> --episodes episodes.pkl
      --cache reports.pkl [--train-to 2026-10-28] [--json rules.json] [--cutoffs web/data/idle.json]
  Refresh web/data/idle.json only (no scoring, no per-report table; seconds):
  python experiments/routeknower/E28-scripts/idle_rules.py --dl <fetch.py folder> --episodes episodes.pkl
      --cutoffs-only --write-idle web/data/idle.json
"""
import argparse, bisect, json, math, pickle, sys, tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "E27-scripts"))
import offroute as O        # noqa: E402
import endofservice as E    # noqa: E402

STEP_CAP_S = 60
FUTURE_S = 120
# The shipped rule (web/js/core/idle.js, Kit Idle.swift): still = within still_m of where the bus stopped
CHOSEN = {"still_m": 80, "idle_min": 30, "parked_min": 90, "past_min": 3, "pad_min": 60, "margin_min": 2}
VALID_DAYS = 45        # idle.json is ignored this long after the last learned day
DAY_KINDS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


SIG = {}


def hours_sig(rid, day):
    """The route's listed hours on a service day as 'HH:MM-HH:MM' spans joined by ',' (the app ignores a learned linger
    cutoff when today's listed hours differ: a new timetable may move the evening trips)."""
    k = (rid, day)
    if k not in SIG:
        d = date.fromisoformat(day)
        r = ((SIG.get("_service", {}).get(day) or {}).get("routes") or {}).get(rid) or {}
        exc = next((x for x in r.get("exceptions") or [] if x.get("date") == day), None)
        dd = (exc.get("hours") or {}) if exc is not None else ((r.get("days") or {}).get(DAY_KINDS[d.weekday()]) or {})
        spans = dd.get("spans") or ([[dd["first"], dd["last"]]] if dd.get("first") and dd.get("last") else [])
        SIG[k] = ",".join(f"{a}-{b}" for a, b in spans)
    return SIG[k]


def kind_of(t):
    """service.json day key of the service day (04:00 to 04:00)."""
    return DAY_KINDS[(datetime.fromtimestamp(t, O.CT) - timedelta(hours=4)).weekday()]


def clock_min(t):
    """Minutes since midnight of the SERVICE day (00:30 after midnight = 1470)."""
    dt = datetime.fromtimestamp(t, O.CT)
    m = dt.hour * 60 + dt.minute + dt.second / 60
    return m + 1440 if dt.hour < 4 else m


# ---------------------------------------------------------------- per-report table
def build_reports(dl, days, arr):
    """Per report: what the app knows and what happened. Columns in the returned dict of numpy arrays."""
    cache = Path(tempfile.gettempdir()) / "sb-e27-static"
    cols = defaultdict(list)
    for day in days:
        st = O.build_static(O.zip_for(dl, day), cache)
        spans = O.spans_for(st["service"], day)
        rows = E.load_reports(dl, day, st)
        grid = E.load_pred_grid(dl, day)
        if not rows:
            continue
        P = O.xy([r[3] for r in rows], [r[4] for r in rows])
        d_own = np.full(len(rows), np.inf)
        by = defaultdict(list)
        for i, r in enumerate(rows):
            by[r[2]].append(i)
        for rid, idx in by.items():
            idx = np.array(idx)
            d_own[idx] = O.dist_to_segs(P[idx], st["segs"].get(rid))
        d_any = d_own.copy()
        far = np.where(d_own > 300)[0]
        if len(far):
            d_any[far] = O.dist_to_segs(P[far], st["allsegs"])
        for i, r in enumerate(rows):
            veh, trip, rid, lat, lon, spd, stop, vt, h = r
            nxt = rows[i + 1] if i + 1 < len(rows) and rows[i + 1][0] == veh else None
            step = float(min(STEP_CAP_S, nxt[7] - vt)) if nxt else 10.0
            g = grid.get(veh, {}).get(vt // 60)
            na = E.arrival_away(arr, veh, lat, lon, vt + 1, vt + 6 * 3600)
            lst = arr.get(veh, [])
            k = bisect.bisect_left(lst, (vt - 120,))
            serve_now = k < len(lst) and lst[k][0] <= vt + 120
            cols["veh"].append(veh); cols["rid"].append(rid); cols["trip"].append(trip)
            cols["lat"].append(lat); cols["lon"].append(lon); cols["t"].append(vt); cols["step"].append(step)
            cols["pmin"].append(g[0] if g else 0); cols["pmax"].append(g[1] if g else 0)
            cols["ptrip"].append(bool(g and trip in g[2]))
            cols["gap"].append(O.hours_gap(spans.get(rid, []), vt))
            cols["dany"].append(float(d_any[i]))
            cols["next_s"].append((na[0] - vt) if na else 1e9)
            cols["serve_now"].append(serve_now)
            cols["day"].append(day)
        print(f"{day}: {len(rows)} reports", file=sys.stderr)
    out = {k: np.array(v) for k, v in cols.items()}
    return out


def label_reports(R, eps):
    """Label of the episode each report sits in ('moving' outside every episode)."""
    lab = np.array(["moving"] * len(R["t"]), dtype=object)
    by = defaultdict(list)
    for e in eps:
        by[e["veh"]].append((e["t0"], e["t1"], e["label"]))
    idx = defaultdict(list)
    for i, v in enumerate(R["veh"]):
        idx[v].append(i)
    for v, ii in idx.items():
        es = sorted(by.get(v, []))
        if not es:
            continue
        starts = [e[0] for e in es]
        for i in ii:
            t = R["t"][i]
            k = bisect.bisect_right(starts, t) - 1
            if k >= 0 and es[k][0] <= t <= es[k][1]:
                lab[i] = es[k][2]
    return lab


def shown_today(R):
    """Today's app (core/operating.js + core/offroute.js, approximately): inside the listed hours or with a
    prediction on the bus's trip, and not off every line (> 300 m) for 15 min inside / 5 min outside the hours."""
    n = len(R["t"])
    shown = np.zeros(n, bool)
    off_since = {}
    for i in range(n):
        v, t = R["veh"][i], R["t"][i]
        if i == 0 or R["veh"][i - 1] != v or t - R["t"][i - 1] > 600:
            off_since.pop(v, None)
        if not (R["gap"][i] == 0 or R["ptrip"][i]):
            continue
        if R["dany"][i] > 300:
            s = off_since.setdefault(v, t)
            if t - s >= (900 if R["gap"][i] <= 1800 else 300):
                continue
        else:
            off_since.pop(v, None)
        shown[i] = True
    return shown


# ---------------------------------------------------------------- learned linger cutoffs (rule C)
def learn_cutoffs(eps, train_days, past_min, margin_min=2, min_eos=3, spot_m=E.SPOT_M):
    """Per (route, spot, day kind group): the latest service-day clock time at which a bus of the route still there
    (>= past_min) later served again within 30 min, + margin; kept when >= min_eos end_of_shift / garage episodes of
    that route at that spot start after it. Day kind groups: the route's buses keep the same evening pattern every
    day (night routes), else weekdays / Saturday / Sunday apart."""
    groups = defaultdict(list)
    for e in eps:
        if e["day"] not in train_days or e["dur_min"] < past_min or e["spot"].startswith(("Unnamed", "Operator garage")):
            continue
        k = kind_of(e["t0"])
        grp = "sat" if k == "sat" else "sun" if k == "sun" else "weekday"
        groups[(e["rid"], e["spot"])].append((grp, e))
    out = []
    for (rid, spot), lst in groups.items():
        for grp in ("weekday", "sat", "sun", "daily"):
            es = [e for g, e in lst if grp == "daily" or g == grp]
            if not es:
                continue
            # the latest clock time a still bus of the route was seen there before it served again (episode END)
            served = [clock_min(e["t1"]) for e in es if e["label"] in ("layover", "break")]
            last_served = max(served) if served else None
            eos_all = [e for e in es if e["label"] == "end_of_shift"]
            if last_served is not None:
                cut = last_served + margin_min
            elif eos_all:
                cut = min(clock_min(e["t0"]) for e in eos_all)    # never served there: from the earliest shift end seen
            else:
                continue
            eos = [e for e in eos_all if clock_min(e["t1"]) >= cut + past_min]
            if len(eos) >= min_eos:
                lat = float(np.mean([e["lat"] for e in es])); lon = float(np.mean([e["lon"] for e in es]))
                out.append({"rid": rid, "spot": spot, "days": grp, "after": round(cut, 1), "lat": round(lat, 5),
                            "lon": round(lon, 5), "eos_after": len(eos), "served_before_cut": len(served),
                            "n_days": len({e["day"] for e in es}),
                            "hours": sorted({hours_sig(rid, e["day"]) for e in es} - {""})})
    # a route+spot keeps one entry: the specific day groups if each has its own, else daily
    best = {}
    for c in out:
        k = (c["rid"], c["spot"])
        best.setdefault(k, []).append(c)
    final = []
    for k, cs in best.items():
        spec = [c for c in cs if c["days"] != "daily"]
        final.extend(spec if spec else [c for c in cs if c["days"] == "daily"])
    return final


def cutoff_index(cuts):
    by = defaultdict(list)
    for c in cuts:
        by[c["rid"]].append(c)
    return by


def in_linger(cidx, rid, lat, lon, t, radius=E.SPOT_M):
    k = kind_of(t)
    grp = "sat" if k == "sat" else "sun" if k == "sun" else "weekday"
    cm = clock_min(t)
    for c in cidx.get(rid, ()):
        if c["days"] not in (grp, "daily"):
            continue
        if cm >= c["after"] and E.hav_m(lat, lon, c["lat"], c["lon"]) <= radius:
            return True
    return False


# ---------------------------------------------------------------- the replay
def replay(R, lab, shown, rule, cidx, sel=None):
    """Hide flags per report for `rule` = {still_m, idle_min, parked_min, past_min, pad_min, use_a, use_a2, use_b,
    use_c}."""
    n = len(R["t"])
    hide = np.zeros(n, bool)
    anchor = None
    for i in range(n):
        v, t, rid = R["veh"][i], R["t"][i], R["rid"][i]
        lat, lon = R["lat"][i], R["lon"][i]
        if (anchor is None or anchor[0] != v or anchor[1] != rid or t - R["t"][i - 1] > 600
                or E.hav_m(lat, lon, anchor[2], anchor[3]) > rule["still_m"]):
            anchor = (v, rid, lat, lon, t)
        if not shown[i] or (sel is not None and not sel[i]):
            continue
        still = (t - anchor[4]) / 60
        h = False
        if rule.get("use_a") and still >= rule["idle_min"] and not (R["pmax"][i] >= t + FUTURE_S):
            h = True
        if not h and rule.get("use_a2") and still >= rule["parked_min"]:
            h = True
        if not h and rule.get("use_b") and still >= rule["past_min"] and R["gap"][i] > rule["pad_min"] * 60:
            h = True
        if not h and rule.get("use_c") and still >= rule["past_min"] and in_linger(cidx, rid, lat, lon, t):
            h = True
        hide[i] = h
    return hide


def score(R, lab, shown, hide, sel=None):
    m = shown if sel is None else (shown & sel)
    st = R["step"]
    res = {}
    for L in ("layover", "break", "end_of_shift", "garage_return", "parked_never_served", "moving"):
        res["hid_" + L] = round(float(st[hide & m & (lab == L)].sum()) / 60, 1)
        res["shown_" + L] = round(float(st[m & (lab == L)].sum()) / 60, 1)
    res["hidden"] = round(float(st[hide & m].sum()) / 60, 1)
    res["near_10"] = round(float(st[hide & m & (R["next_s"] <= 600)].sum()) / 60, 1)
    res["near_2"] = round(float(st[hide & m & R["serve_now"]].sum()) / 60, 1)
    target = m & np.isin(lab, ["end_of_shift", "garage_return", "parked_never_served"])
    res["target_shown"] = round(float(st[target].sum()) / 60, 1)
    res["target_hidden"] = round(float(st[target & hide].sum()) / 60, 1)
    res["target_share"] = round(res["target_hidden"] / res["target_shown"], 3) if res["target_shown"] else None
    return res


def near_list(R, lab, shown, hide, k=15):
    """The hidden runs that served again within 10 min: (vehicle, route, from, hidden min, served after min, label)."""
    runs, cur = [], None
    for i in np.where(hide & shown)[0]:
        if cur and cur["veh"] == R["veh"][i] and R["t"][i] - cur["t1"] <= 120:
            cur["t1"] = R["t"][i]; cur["min"] += R["step"][i] / 60; cur["next_s"] = R["next_s"][i]
        else:
            if cur:
                runs.append(cur)
            cur = {"veh": R["veh"][i], "rid": R["rid"][i], "t0": R["t"][i], "t1": R["t"][i], "min": R["step"][i] / 60,
                   "next_s": R["next_s"][i], "label": lab[i], "lat": R["lat"][i], "lon": R["lon"][i]}
    if cur:
        runs.append(cur)
    bad = [r for r in runs if r["next_s"] <= 600]
    bad.sort(key=lambda r: -r["min"])
    return len(runs), [{"veh": r["veh"], "route": E.ROUTE_NAMES.get(r["rid"], r["rid"]), "from": E.ct(r["t0"]),
                        "to": E.ct(r["t1"], "%H:%M"), "hidden_min": round(r["min"], 1),
                        "served_after_min": round(r["next_s"] / 60, 1), "label": r["label"],
                        "at": [round(r["lat"], 5), round(r["lon"], 5)]} for r in bad[:k]]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dl", required=True)
    ap.add_argument("--episodes", required=True, help="endofservice.py --cache pickle")
    ap.add_argument("--cache", help="pickle of the per-report table (written once, then read); needed unless --cutoffs-only")
    ap.add_argument("--train-to", default="2026-10-28")
    ap.add_argument("--json")
    ap.add_argument("--grid", action="store_true", help="score the whole parameter grid (slow)")
    ap.add_argument("--write-idle", help="write the learned linger cutoffs as web/data/idle.json")
    ap.add_argument("--cutoffs-only", action="store_true",
                    help="only learn the linger cutoffs from every day and write --write-idle (skips the scoring)")
    a = ap.parse_args(argv)
    if not a.cutoffs_only and not a.cache:
        ap.error("--cache is required unless --cutoffs-only")
    eps, stops, names = pickle.loads(Path(a.episodes).read_bytes())
    E.ROUTE_NAMES.update(names)
    E.name_spots(eps, stops)
    for e in eps:
        e["label"], e["evidence"] = E.label(e)
    days = sorted({e["day"] for e in eps})
    if a.cutoffs_only:
        cache = Path(tempfile.gettempdir()) / "sb-e27-static"
        SIG["_service"] = {d: O.build_static(O.zip_for(a.dl, d), cache)["service"] for d in days}
        cuts = learn_cutoffs(eps, set(days), CHOSEN["past_min"], CHOSEN["margin_min"])
        if a.write_idle:
            write_idle(a.write_idle, cuts, days)
        if a.json:
            Path(a.json).write_text(json.dumps({"days": days, "cutoffs_all": cuts}, indent=1, default=float),
                                    encoding="utf-8")
        return
    if Path(a.cache).exists():
        R = pickle.loads(Path(a.cache).read_bytes())
    else:
        R = build_reports(a.dl, days, E.load_arrivals(Path(a.dl) / "arrivals.csv"))
        Path(a.cache).write_bytes(pickle.dumps(R))
    if "serve_away" not in R:
        arr = E.load_arrivals(Path(a.dl) / "arrivals.csv")
        R["serve_away"] = np.array([E.arrival_away(arr, R["veh"][i], R["lat"][i], R["lon"][i], R["t"][i] - 120,
                                                   R["t"][i] + 120) is not None for i in range(len(R["t"]))])
        Path(a.cache).write_bytes(pickle.dumps(R))
    R["serve_now"] = R["serve_away"]          # near_2 = an arrival AWAY from where the bus stands (not its own stop)
    lab = label_reports(R, eps)
    shown = shown_today(R)
    train = [d for d in days if d <= a.train_to]
    test = np.array([d > a.train_to for d in R["day"]])
    out = {"days": days, "train": [train[0], train[-1]], "reports": int(len(R["t"])),
           "bus_hours_shown": round(float(R["step"][shown].sum()) / 3600, 1)}
    # listed hours of every learned day (for the hours signature of each linger cutoff)
    cache = Path(tempfile.gettempdir()) / "sb-e27-static"
    SIG["_service"] = {d: O.build_static(O.zip_for(a.dl, d), cache)["service"] for d in days}
    base = {"still_m": CHOSEN["still_m"], "idle_min": 30, "parked_min": 90, "past_min": 3, "pad_min": 60,
            "use_a": False, "use_a2": False, "use_b": False, "use_c": False}
    runs = []
    cut_all = learn_cutoffs(eps, set(days), CHOSEN["past_min"], CHOSEN["margin_min"])
    cut_tr = learn_cutoffs(eps, set(train), CHOSEN["past_min"], CHOSEN["margin_min"])
    out["cutoffs_all"] = cut_all
    out["cutoffs_train"] = cut_tr

    def run(name, cuts=None, sel=None, detail=False, **kw):
        rule = {**base, **kw}
        h = replay(R, lab, shown, rule, cutoff_index(cuts or []), sel)
        res = {"name": name, **{k: v for k, v in rule.items()}, **score(R, lab, shown, h, sel)}
        res["runs_hidden"], res["near_runs"] = near_list(R, lab, shown, h)
        if detail:
            night = {}
            for i in np.where(h)[0]:
                if R["day"][i] == "2026-11-05" and clock_min(R["t"][i]) >= 1410:
                    night.setdefault(R["veh"][i] + " " + E.ROUTE_NAMES.get(R["rid"][i], R["rid"][i]), []).append(int(R["t"][i]))
            res["nov5_night"] = {k: [E.ct(min(v), "%H:%M:%S"), E.ct(max(v), "%H:%M:%S")] for k, v in night.items()}
            per = defaultdict(Counter)
            for i in np.where(h & shown)[0]:
                per[E.ROUTE_NAMES.get(R["rid"][i], R["rid"][i])][lab[i]] += R["step"][i] / 60
            res["per_route_hidden_min"] = {k: {"all": round(sum(c.values()), 1), **{x: round(y, 1) for x, y in c.items()}}
                                           for k, c in sorted(per.items(), key=lambda kv: -sum(kv[1].values()))}
            parts = {}
            for part in ("use_a", "use_a2", "use_b", "use_c"):
                only = {**rule, "use_a": False, "use_a2": False, "use_b": False, "use_c": False, part: True}
                hp = replay(R, lab, shown, only, cutoff_index(cuts or []), sel)
                parts[part] = score(R, lab, shown, hp, sel)
            res["parts"] = parts
        runs.append(res)
        print(name, {k: res[k] for k in ("hidden", "near_10", "near_2", "target_share", "hid_layover", "hid_break",
                                          "hid_end_of_shift", "hid_parked_never_served", "hid_moving")}, file=sys.stderr)
        return h
    if a.grid:
        for im in (15, 20, 25, 30, 40):
            run(f"A idle {im}", use_a=True, idle_min=im)
        for pk in (45, 60, 90, 120):
            run(f"A2 parked {pk}", use_a2=True, parked_min=pk)
        for pm in (3, 5):
            for pad in (15, 30, 45, 60):
                run(f"B past {pm} pad {pad}", use_b=True, past_min=pm, pad_min=pad)
        for pm in (3, 5):
            for mg in (2, 5):
                run(f"C linger {pm} margin {mg} (cutoffs from all days)", cuts=learn_cutoffs(eps, set(days), pm, mg),
                    use_c=True, past_min=pm)
                run(f"C linger {pm} margin {mg} TEST days only, cutoffs from train", cuts=learn_cutoffs(eps, set(train), pm, mg),
                    sel=test, use_c=True, past_min=pm)
    kw = {k: CHOSEN[k] for k in ("idle_min", "parked_min", "past_min", "pad_min")}
    run("CHOSEN (cutoffs from all days)", cuts=cut_all, detail=True, use_a=True, use_a2=True, use_b=True, use_c=True, **kw)
    run("CHOSEN TEST days only, cutoffs from train", cuts=cut_tr, sel=test, detail=True, use_a=True, use_a2=True,
        use_b=True, use_c=True, **kw)
    out["runs"] = runs
    out["chosen"] = CHOSEN
    txt = json.dumps(out, indent=1, default=float)
    if a.json:
        Path(a.json).write_text(txt, encoding="utf-8")
    if a.write_idle:
        write_idle(a.write_idle, cut_all, days)


def write_idle(path, cuts, days):
    """web/data/idle.json: the learned linger cutoffs (core/idle.js lingerAt; Kit Idle.lingerAt)."""
    fmt = lambda m: f"{int(m // 60):02d}:{int(round(m % 60)) % 60:02d}"
    last = date.fromisoformat(days[-1])
    rows = [{"route": c["rid"], "spot": c["spot"], "lat": c["lat"], "lon": c["lon"], "r": E.SPOT_M, "after": fmt(math.ceil(c["after"])),
             "days": c["days"], "hours": c["hours"], "seen": c["eos_after"]}
            for c in sorted(cuts, key=lambda c: (c["rid"], c["spot"], c["days"]))]
    doc = {"note": "Where and from what time buses of a route linger at the end of their shift (RouteKnower E28, "
                   "experiments/routeknower/E28-scripts/idle_rules.py --write-idle). A bus still for 3 min at a spot "
                   "of its route after `after` (service-day clock, may pass 24:00) never served riders again in the "
                   "data; used only while today's listed hours of the route are one of `hours` and before valid_until.",
           "from": days[0], "to": days[-1], "valid_until": (last + timedelta(days=VALID_DAYS)).isoformat(),
           "linger": rows}
    Path(path).write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {path}: {len(rows)} linger cutoffs", file=sys.stderr)


if __name__ == "__main__":
    main()

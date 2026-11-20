#!/usr/bin/env python3
"""Passio's filler times in the trip updates (DC-031, RouteKnower E34; owner 2026-11-20: "The upcoming arrivals seem to
be broken when looking at individual routes").

Since Tue Oct 27, 5:38 PM CDT, Passio's tripUpdates give most stops of a trip update no forecast of their own: the
previous listed stop's time + 2 s (sometimes 3). The rule is the app's (web core/eta.js markFiller, iOS Kit): in ONE
trip update (one vehicle + trip + timestamp `made`; entries in stop_sequence order, which is the listed order), an
entry whose time is 0 to FILLER_S seconds after the previous listed entry's time is FILLER, not a forecast. The entry
a filler run follows is its HEAD (a real time: it stays live). Every other entry is NORMAL.

  python tools/passio_filler.py days  --pred-dir DIR --predictions P.csv [P2.csv ...] [--from D] [--to D] [--csv out.csv]
  python tools/passio_filler.py hours --pred-dir DIR --day 2026-10-27 [--minutes 10] [--from-hour 15 --to-hour 20]
  python tools/passio_filler.py week  --pred-dir DIR --predictions ... --arrivals arrivals.csv --from D --to D
  python tools/passio_filler.py late  --pred-dir DIR --predictions ... --arrivals arrivals.csv [--lead 300]
                                      [--split "2026-10-27 18:00"] [--from D] [--to D]
  python tools/passio_filler.py mark  --pred-dir DIR --in predictions.csv|eta-<day>.csv.gz --out marked.csv[.gz]

DIR holds the archived `pred-updates-<day>.jsonl.gz` (release assets data-archive-YYYY-MM: `gh release download
data-archive-2026-11 -p "pred-updates-*" -D DIR`). P.csv: `data/ground_truth/predictions.csv` and its
`archive/predictions-*.csv` from the data branch; arrivals.csv the same branch's.

Scoring reuses the collector's own matching: predictions.csv is, for each logged arrival and target lead (1, 2, 3, 5,
10, 15, 20, 30 min), the prediction Passio had on display for that bus at that stop then (`Tracker._candidates`,
merged by `merge_predictions.py`). A row is joined to its update entry on vehicle + stop + made + predicted time (the
trip id can differ: DC-010's re-matched trip ids) and gets that entry's kind. Metrics per kind and lead: pass = within
the owner's allowed error (`arrivals_lib.shrink_tol`: 3 min at 30 min ahead, 2 at 20, 1 below), late = shown more than
2 min later than the bus came (docs/PASSIO-FEED-ISSUES.md section 2), early = more than 2 min earlier, within 1 min,
median error (predicted - actual; positive = shown later than the bus came). Stdlib only. Tests:
tools/test_passio_filler.py.
"""
import argparse, csv, gzip, statistics, sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L
from build_eta_dataset import load_pred_updates, service_day_of, day_bounds

FILLER_S = 3                   # web core/eta.js FILLER_S, iOS Kit: the app's rule
KINDS = ("filler", "head", "normal")
LEADS = L.PRED_LEADS           # predictions.csv target leads, seconds
LATE_S = 120                   # "late": shown more than 2 min later than the bus came (PASSIO-FEED-ISSUES.md section 2)
SPLIT = "2026-10-27 18:00"     # PASSIO-FEED-ISSUES.md section 2 "before" / "since" (Chicago time)
ALL_TIME = (0, 1 << 62)


# ---------------------------------------------------------------- the rule
def snapshots(preds):
    """load_pred_updates output {(veh, trip, stop): [(seen, last, made, pred, seq)]} -> one trip update per
    (veh, trip, made): {(veh, trip, made): [(seq, stop, pred, seen, last)]}."""
    out = defaultdict(list)
    for (veh, trip, stop), lst in preds.items():
        for seen, last, made, pred, seq in lst:
            out[(veh, trip, made)].append((seq, stop, pred, seen, last))
    return out


def _order(e):
    seq = e[0]
    return (seq is None, seq if seq is not None else 0, e[3], e[2])


def classify(entries, filler_s=FILLER_S):
    """ONE trip update's entries [(seq, stop, pred, seen, last)] -> [(entry, kind)] in listed (stop_sequence) order.
    filler: its time is 0 to filler_s s after the previous listed entry's time; head: a non-filler entry that a filler
    entry follows; normal: the rest. Passio sometimes changes a time and keeps the timestamp, so one (veh, trip, made)
    can hold two versions of a stop (same seq): an entry's previous entry is the version at the previous listed seq
    that was on display longest at the same polls (overlap of [seen, last]), then the one first seen nearest."""
    es = sorted(entries, key=_order)
    groups = []
    for e in es:
        if groups and groups[-1][0][0] == e[0] and e[0] is not None:
            groups[-1].append(e)
        else:
            groups.append([e])
    kind, head = {}, set()
    for g, grp in enumerate(groups):
        for e in grp:
            if g == 0:
                kind[e] = "normal"
                continue
            prev = max(groups[g - 1], key=lambda c: (min(e[4], c[4]) - max(e[3], c[3]), -abs(e[3] - c[3])))
            if 0 <= e[2] - prev[2] <= filler_s:
                kind[e] = "filler"
                if kind.get(prev) != "filler":
                    head.add(prev)
            else:
                kind[e] = "normal"
    return [(e, "head" if e in head and kind[e] != "filler" else kind[e]) for e in es]


def kinds(preds, filler_s=FILLER_S):
    """-> {(veh, trip, stop, made, pred, seq): kind} for every update entry."""
    out = {}
    for (veh, trip, made), es in snapshots(preds).items():
        for (seq, stop, pred, _, _), k in classify(es, filler_s):
            out[(veh, trip, stop, made, pred, seq)] = k
    return out


def kind_index(kmap):
    """{(veh, trip, stop, made, pred, seq): kind} -> {(veh, stop, made, pred): {trip: kind}} for joining a prediction
    row (its trip id can be another than the update's). One trip listing the same stop twice at the same time keeps
    'filler' (the second listing is the filler one)."""
    idx = defaultdict(dict)
    for (veh, trip, stop, made, pred, seq), k in kmap.items():
        d = idx[(veh, stop, made, pred)]
        if d.get(trip) != "filler":
            d[trip] = k
    return idx


def lookup(idx, veh, trip, stop, made, pred):
    """The kind of the update entry a prediction row came from, else 'unknown' (no archived entry, or two trips'
    entries of different kinds and neither is the row's trip)."""
    d = idx.get((veh, stop, made, pred)) or idx.get((None, stop, made, pred))
    if not d:
        return "unknown"
    if trip in d:
        return d[trip]
    ks = set(d.values())
    return ks.pop() if len(ks) == 1 else "unknown"


# ---------------------------------------------------------------- inputs
def pred_file(pred_dir, day):
    d = Path(pred_dir)
    for name in (f"pred-updates-{day}.jsonl.gz", f"pred-updates-{day}.jsonl"):
        if (d / name).exists():
            return d / name
    return None


def day_entries(pred_dir, day):
    """The day's own archived entries (load_pred_updates, deduped) or None without a file."""
    p = pred_file(pred_dir, day)
    return None if p is None else load_pred_updates([p], *ALL_TIME)


def day_kind_index(pred_dir, day):
    """Kind index for the predictions of arrivals on service day `day`: its file and the day before's (a prediction
    made before 4 AM for a later arrival), entries shown from an hour before the day's start. None without a file."""
    p = pred_file(pred_dir, day)
    if p is None:
        return None
    prev = pred_file(pred_dir, (date.fromisoformat(day) - timedelta(days=1)).isoformat())
    t0, t1 = day_bounds(day)
    return kind_index(kinds(load_pred_updates([x for x in (prev, p) if x], t0, t1)))


def _int(x):
    try:
        return int(x)
    except (TypeError, ValueError):
        return None


def read_predictions(paths, day_from=None, day_to=None):
    """predictions.csv files -> {service_day: [row dict]} (ints; deduped on vehicle + stop + lead + arrival epoch, as
    the rotated archive and the live file can share the minutes around a rotation)."""
    out, seen = defaultdict(list), set()
    for p in paths:
        with open_text(p) as f:
            for r in csv.DictReader(f):
                ep, lead = _int(r.get("epoch")), _int(r.get("lead_target_s"))
                pred, made, err = _int(r.get("pred_epoch")), _int(r.get("pred_made_epoch")), _int(r.get("pred_minus_actual_s"))
                if None in (ep, lead, pred, made, err):
                    continue
                day = service_day_of(ep).isoformat()
                if (day_from and day < day_from) or (day_to and day > day_to):
                    continue
                k = (r["vehicle_id"], r["stop_id"], lead, ep)
                if k in seen:
                    continue
                seen.add(k)
                out[day].append({"epoch": ep, "lead": lead, "pred": pred, "made": made, "err": err,
                                 "veh": r["vehicle_id"], "trip": r["trip_id"], "stop": r["stop_id"],
                                 "stop_name": r.get("stop_name", ""), "route": r["route_id"],
                                 "route_name": r.get("route_name", "")})
    return out


def open_text(p):
    """A CSV file, gzipped or not, for csv.reader."""
    p = Path(p)
    return gzip.open(p, "rt", encoding="utf-8", newline="") if p.suffix == ".gz" else open(p, encoding="utf-8", newline="")


def read_arrivals(path, day_from=None, day_to=None):
    """arrivals.csv -> (list of (service_day, epoch, route, stop, source), {trip: route})."""
    rows, trips = [], defaultdict(Counter)
    with open_text(path) as f:
        for r in csv.DictReader(f):
            ep = _int(r.get("epoch"))
            if ep is None:
                continue
            if r.get("trip_id"):
                trips[r["trip_id"]][r["route_id"]] += 1
            day = service_day_of(ep).isoformat()
            if (day_from and day < day_from) or (day_to and day > day_to):
                continue
            rows.append((day, ep, r["route_id"], r["stop_id"], r.get("source", "")))
    return rows, {t: c.most_common(1)[0][0] for t, c in trips.items()}


def mark_rows(rows_by_day, pred_dir):
    """Sets r['kind'] on every prediction row (classified per day). -> days without an archived file."""
    missing = []
    for day, rows in sorted(rows_by_day.items()):
        idx = day_kind_index(pred_dir, day)
        if idx is None:
            missing.append(day)
        for r in rows:
            r["kind"] = "unknown" if idx is None else lookup(idx, r["veh"], r["trip"], r["stop"], r["made"], r["pred"])
    return missing


# ---------------------------------------------------------------- scoring
def metrics(errs, lead):
    """errs: predicted - actual (s) at one target lead -> dict n, pass_shrink, late_2, early_2, within_1 (shares) and
    median_err_s; shares None without rows."""
    n = len(errs)
    if not n:
        return {"n": 0, "pass_shrink": None, "late_2": None, "early_2": None, "within_1": None, "median_err_s": None}
    tol = L.shrink_tol(lead)
    return {"n": n,
            "pass_shrink": sum(abs(e) <= tol for e in errs) / n,
            "late_2": sum(e > LATE_S for e in errs) / n,
            "early_2": sum(e < -LATE_S for e in errs) / n,
            "within_1": sum(abs(e) <= 60 for e in errs) / n,
            "median_err_s": statistics.median(errs)}


def score(rows, key=lambda r: r["kind"]):
    """-> {(group, lead): metrics} plus group 'all' and 'not_filler' (head + normal + unknown) per lead."""
    by = defaultdict(list)
    for r in rows:
        g = key(r)
        by[(g, r["lead"])].append(r["err"])
        by[("all", r["lead"])].append(r["err"])
        if r.get("kind") != "filler":
            by[("not_filler", r["lead"])].append(r["err"])
    return {k: metrics(v, k[1]) for k, v in by.items()}


def entry_shares(preds):
    """-> Counter of kinds over the day's update entries."""
    return Counter(kinds(preds).values())


def pct(x, nd=0):
    return "" if x is None else f"{100 * x:.{nd}f}%"


# ---------------------------------------------------------------- commands
def days_between(a, b):
    d, e = date.fromisoformat(a), date.fromisoformat(b)
    while d <= e:
        yield d.isoformat()
        d += timedelta(days=1)


def available_days(pred_dir):
    return sorted(p.name[len("pred-updates-"):len("pred-updates-") + 10] for p in Path(pred_dir).glob("pred-updates-*.jsonl*"))


def cmd_days(a, out=None):
    out = out or sys.stdout
    days = [d for d in available_days(a.pred_dir) if (not a.from_ or d >= a.from_) and (not a.to or d <= a.to)]
    preds = read_predictions(a.predictions, days[0] if days else None, days[-1] if days else None) if a.predictions else {}
    rows_out = []
    print("day        entries  filler   head  | 5 min ahead: n  late filler / head / normal / all / without filler"
          "  | within allowed: filler / not filler", file=out)
    for day in days:
        c = entry_shares(day_entries(a.pred_dir, day))
        tot = sum(c.values()) or 1
        rows = preds.get(day, [])
        if rows:
            mark_rows({day: rows}, a.pred_dir)
        s = score(rows)
        for (g, lead), m in sorted(s.items()):
            rows_out.append({"day": day, "kind": g, "lead_s": lead, **m})
        f5 = lambda g, k="late_2": (s.get((g, 300)) or {}).get(k)
        print(f"{day} {tot:8d} {pct(c['filler'] / tot):>6} {pct(c['head'] / tot):>6}  | {(s.get(('all', 300)) or {}).get('n', 0):5d}"
              f"  {pct(f5('filler')):>5} / {pct(f5('head')):>4} / {pct(f5('normal')):>4} / {pct(f5('all')):>4} / "
              f"{pct(f5('not_filler')):>4}  | {pct(f5('filler', 'pass_shrink')):>4} / {pct(f5('not_filler', 'pass_shrink')):>4}",
              file=out)
    if a.csv:
        write_csv(a.csv, rows_out, ["day", "kind", "lead_s", "n", "pass_shrink", "late_2", "early_2", "within_1",
                                    "median_err_s"])
    return rows_out


def cmd_hours(a, out=None):
    out = out or sys.stdout
    preds = day_entries(a.pred_dir, a.day)
    if preds is None:
        raise SystemExit(f"no pred-updates file for {a.day} in {a.pred_dir}")
    by = defaultdict(Counter)
    for (veh, trip, stop, made, pred, seq), k in kinds(preds).items():
        t = L.chicago(made)
        if not a.from_hour <= t.hour < a.to_hour:
            continue
        b = t.replace(minute=t.minute - t.minute % a.minutes, second=0)
        by[b][k] += 1
    res = []
    for b, c in sorted(by.items()):
        tot = sum(c.values())
        res.append((b.strftime("%H:%M"), tot, c["filler"] / tot))
        print(f"{b:%H:%M}  entries {tot:6d}  filler {pct(c['filler'] / tot):>4}", file=out)
    return res


def _group_table(rows, targets, key, lead):
    """Per group (key(row)): shown n at `lead`, filler share, late shares by kind, and the share of the group's
    arrivals (targets: Counter group -> arrivals) with a time on display, with and without filler."""
    by = defaultdict(list)
    for r in rows:
        if r["lead"] == lead:
            by[key(r)].append(r)
    out = []
    for g in sorted(set(targets) | set(by)):
        rs = by.get(g, [])
        fil = [r["err"] for r in rs if r["kind"] == "filler"]
        nof = [r["err"] for r in rs if r["kind"] != "filler"]
        heads = [r["err"] for r in rs if r["kind"] == "head"]
        late = lambda v: (sum(e > LATE_S for e in v) / len(v)) if v else None
        out.append({"group": g, "arrivals": targets.get(g, 0), "shown": len(rs),
                    "filler_share": len(fil) / len(rs) if rs else None,
                    "late_all": late([r["err"] for r in rs]), "late_filler": late(fil), "late_not_filler": late(nof),
                    "late_head": late(heads), "heads": len(heads),
                    "cover_all": len(rs) / targets[g] if targets.get(g) else None,
                    "cover_not_filler": len(nof) / targets[g] if targets.get(g) else None})
    return out


def cmd_week(a, out=None):
    out = out or sys.stdout
    arr, trip_route = read_arrivals(a.arrivals, a.from_, a.to)
    arr = [x for x in arr if x[4] != "gps"]                 # coverage targets: arrivals Passio could have named (E31)
    preds = read_predictions(a.predictions, a.from_, a.to)
    mark_rows(preds, a.pred_dir)
    rows = [r for v in preds.values() for r in v]
    names = {r["route"]: r["route_name"] for r in rows}
    snames = {r["stop"]: r["stop_name"] for r in rows}
    ent = Counter()                                       # (route, kind) over the week's update entries
    unmapped = 0
    for day in days_between(a.from_, a.to):
        preds_d = day_entries(a.pred_dir, day)
        if preds_d is None:
            continue
        for (veh, trip, stop, made, pred, seq), k in kinds(preds_d).items():
            rid = trip_route.get(trip)
            unmapped += rid is None
            ent[(rid or "?", k)] += 1
    routes = _group_table(rows, Counter(x[2] for x in arr), lambda r: r["route"], a.lead)
    print(f"Per line, {a.from_} to {a.to}; update entries (trip -> line by arrivals.csv; {unmapped} unmapped) and the "
          f"times on display {a.lead // 60} min ahead (predictions.csv; late = shown > 2 min later than the bus)", file=out)
    print("line                          entries filler | shown filler | late all / filler / not filler | arrivals with a"
          " time: all / without filler", file=out)
    for g in routes:
        rid = g["group"]
        e_tot = sum(v for (r, k), v in ent.items() if r == rid)
        e_fil = ent[(rid, "filler")]
        print(f"{(names.get(rid) or rid)[:28]:28s} {e_tot:8d} {pct(e_fil / e_tot if e_tot else None):>5} | {g['shown']:5d}"
              f" {pct(g['filler_share']):>5} | {pct(g['late_all']):>4} / {pct(g['late_filler']):>4} / "
              f"{pct(g['late_not_filler']):>4} | {pct(g['cover_all']):>4} / {pct(g['cover_not_filler']):>4}", file=out)
    stops = _group_table(rows, Counter((x[2], x[3]) for x in arr), lambda r: (r["route"], r["stop"]), a.lead)
    print(f"\nPer line and stop ({a.lead // 60} min ahead): shown, filler share, late filler / not filler, arrivals with a"
          " time all / without filler", file=out)
    for g in stops:
        rid, sid = g["group"]
        print(f"{(names.get(rid) or rid)[:20]:20s} {sid:>7} {snames.get(sid, '')[:34]:34s} {g['shown']:4d} "
              f"{pct(g['filler_share']):>5} | {pct(g['late_filler']):>4} / {pct(g['late_not_filler']):>4} | "
              f"{pct(g['cover_all']):>4} / {pct(g['cover_not_filler']):>4}", file=out)
    if a.csv:
        write_csv(a.csv, [{"line": names.get(g["group"][0], g["group"][0]), "route_id": g["group"][0],
                           "stop_id": g["group"][1], "stop_name": snames.get(g["group"][1], ""), **{k: v for k, v in g.items()
                                                                                                  if k != "group"}}
                          for g in stops],
                  ["line", "route_id", "stop_id", "stop_name", "arrivals", "shown", "filler_share", "late_all",
                   "late_filler", "late_not_filler", "heads", "late_head", "cover_all", "cover_not_filler"])
    return routes, stops


def local_epoch(s):
    """'YYYY-MM-DD HH:MM' Chicago time -> epoch (DST-safe, via day_bounds' offset search)."""
    d = datetime.strptime(s, "%Y-%m-%d %H:%M")
    t0 = day_bounds(d.date().isoformat())[0]               # 04:00 local that day
    return t0 + int((d - datetime(d.year, d.month, d.day, 4)).total_seconds())


def cmd_late(a, out=None):
    out = out or sys.stdout
    split = local_epoch(a.split)
    arr, _ = read_arrivals(a.arrivals, a.from_, a.to)
    arr = [x for x in arr if x[4] != "gps"]
    preds = read_predictions(a.predictions, a.from_, a.to)
    missing = mark_rows(preds, a.pred_dir)
    rows = [r for v in preds.values() for r in v if r["lead"] == a.lead]
    names = {r["route"]: r["route_name"] for r in rows}
    side = lambda ep: "before" if ep < split else "since"
    res = {}
    for half in ("before", "since"):
        rs = [r for r in rows if side(r["epoch"]) == half]
        tg = Counter(x[2] for x in arr if side(x[1]) == half)
        res[half] = {g["group"]: g for g in _group_table(rs, tg, lambda r: r["route"], a.lead)}
        allg = _group_table(rs, Counter({"ALL": sum(tg.values())}), lambda r: "ALL", a.lead)
        res[half]["ALL"] = allg[0] if allg else {}
    print(f"Late = shown more than 2 min later than the bus came, {a.lead // 60} min ahead; before / since {a.split}"
          f"{' (no pred-updates file: ' + ', '.join(missing) + ')' if missing else ''}", file=out)
    print("line                        | before: all  without filler | since: all  filler  without filler (heads) | "
          "filler share since | a time since: all / without filler", file=out)
    order = sorted((g for g in res["since"] if g != "ALL"), key=lambda g: -(res["since"][g].get("late_all") or 0)) + ["ALL"]
    for g in order:
        b, s = res["before"].get(g, {}), res["since"].get(g, {})
        print(f"{(names.get(g) or g)[:27]:27s} | {pct(b.get('late_all'), 1):>6} {pct(b.get('late_not_filler'), 1):>8}      | "
              f"{pct(s.get('late_all'), 1):>6} {pct(s.get('late_filler'), 1):>6} {pct(s.get('late_not_filler'), 1):>8}"
              f" ({pct(s.get('late_head'), 1):>5})       | {pct(s.get('filler_share')):>5}        | "
              f"{pct(s.get('cover_all')):>4} / {pct(s.get('cover_not_filler')):>4}",
              file=out)
    return res


def cmd_mark(a, out=None):
    """Copy a predictions.csv or an eta-<day>.csv.gz with one more column, passio_kind (filler / head / normal /
    unknown; blank where the row has no Passio time). The data files keep their format: this writes a new file."""
    out = out or sys.stdout
    with open_text(a.inp) as f:
        rd = csv.DictReader(f)
        cols = list(rd.fieldnames or [])
        data = list(rd)
    eta = "passio_made_epoch" in cols
    made_c, pred_c = ("passio_made_epoch", "passio_epoch") if eta else ("pred_made_epoch", "pred_epoch")
    by_day = defaultdict(list)
    for r in data:
        ep = _int(r.get("query_epoch" if eta else "epoch"))
        day = r.get("service_day") or (service_day_of(ep).isoformat() if ep is not None else None)
        by_day[day].append(r)
    for day, rs in by_day.items():
        idx = day_kind_index(a.pred_dir, day) if day else None
        for r in rs:
            made, pred = _int(r.get(made_c)), _int(r.get(pred_c))
            if made is None or pred is None:
                r["passio_kind"] = ""
            else:
                r["passio_kind"] = "unknown" if idx is None else lookup(idx, r["vehicle_id"], r["trip_id"], r["stop_id"],
                                                                     made, pred)
    write_csv(a.out, data, cols + ["passio_kind"])
    c = Counter(r["passio_kind"] or "(no time)" for r in data)
    print(f"mark: {len(data)} rows -> {a.out}: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())), file=out)
    return c


def write_csv(path, rows, cols):
    p = Path(path)
    f = gzip.open(p, "wt", encoding="utf-8", newline="") if p.suffix == ".gz" else open(p, "w", encoding="utf-8", newline="")
    with f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: (f"{v:.4f}" if isinstance(v, float) else v) for k, v in r.items()})


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("days", "hours", "week", "late", "mark"):
        s = sub.add_parser(name)
        s.add_argument("--pred-dir", required=True, help="folder of pred-updates-<day>.jsonl.gz")
        if name in ("days", "week", "late"):
            s.add_argument("--predictions", nargs="+", required=name != "days", default=[],
                           help="predictions.csv and its archive files")
            s.add_argument("--from", dest="from_", required=name == "week")
            s.add_argument("--to", required=name == "week")
            s.add_argument("--csv")
        if name in ("week", "late"):
            s.add_argument("--arrivals", required=True)
            s.add_argument("--lead", type=int, default=300, choices=LEADS)
        if name == "late":
            s.add_argument("--split", default=SPLIT, help='Chicago time "YYYY-MM-DD HH:MM"')
        if name == "hours":
            s.add_argument("--day", required=True)
            s.add_argument("--minutes", type=int, default=60)
            s.add_argument("--from-hour", type=int, default=0)
            s.add_argument("--to-hour", type=int, default=24)
        if name == "mark":
            s.add_argument("--in", dest="inp", required=True)
            s.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    return {"days": cmd_days, "hours": cmd_hours, "week": cmd_week, "late": cmd_late, "mark": cmd_mark}[a.cmd](a)


if __name__ == "__main__":
    main()

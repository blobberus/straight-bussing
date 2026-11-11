#!/usr/bin/env python3
"""Whole-database audit: every file of the data branch and every daily-archive release asset, all days since the
collection began. tools/health.py stays the alarm (the last 2 days, on every run); this is the deep check a checkup
(monitoring.md) or an analysis agent runs before trusting the data (DC-026, 2026-11-11).

  python tools/db_audit.py                       # origin/data through git + the data-archive releases through gh
  python tools/db_audit.py --dir CHECKOUT        # a checkout of the data branch instead (the folder holding data/)
  python tools/db_audit.py --assets FILE         # release assets from a file: {"name": size, ...}; --no-gh: skip them
  python tools/db_audit.py --mirror CLONE        # also check the public copy (clone of blobberus/straight-bussing-data)
  add --days for the per-day table, --json FILE for every finding; `git fetch origin data` first for the newest rows

Levels: error = rows wrong or missing (exit 1), warn = odd, worth a look, note = a fact to know before analysing.
Checks:
- schema: each file's header is its writer's column list, every row has that many fields
- arrivals (arrivals.csv + archive/arrivals-*.csv): ts_utc / local_time / dow / hour / minute_of_day agree with epoch
  (Chicago time, daylight saving included), ids present, source known, coordinates near Chicago, segment_s = epoch -
  prev_arrival_epoch, values in range, gps rows without prediction / dwell / previous stop, one name per route id,
  duplicates (same bus and stop within 300 s, tools/merge_arrivals.py's rule), late-appended blocks (replays and
  backfills: the file is append-ordered, sort by epoch before use)
- days: every service day (4 AM cut) from the first one to the last finished one has rows; each line against
  the median of the same weekday on the other weeks; health.py's 20-minute gap rule on every day
- predictions (predictions.csv + archive/predictions-*.csv): lead_target_s one of arrivals_lib.PRED_LEADS,
  pred_lead_s = epoch - pred_made_epoch >= lead_target_s, pred_minus_actual_s = pred_epoch - epoch, first seen by
  that moment, duplicates (bus, stop, lead within 300 s), every row has its arrival (bus and stop within 300 s)
- bus_changes, alerts, gtfs_versions, eta/summary: their keys unique, counts and times consistent, every recorded
  timetable zip present, the timetable record keeps up with the arrivals
- archive: every finished day has each asset kind of its time (health.archive_kinds: alerts from 2026-10-14,
  bus-changes from 2026-10-30), no near-empty file on a day with service, summary.csv rows exactly
  for the archived days (the day before yesterday onwards may still be waiting: GitHub fires the archive cron late)
- mirror (--mirror): per-day / per-route files have the arrivals header and the data branch's row counts (same rule
  as the data repo's scripts/sync.py: 4 AM service day, exact-key dedupe), index.json agrees with the files, the
  methodology copies match main
Read-only. Stdlib + git + gh. Tests: tools/test_db_audit.py.
"""
import argparse, bisect, csv, io, json, statistics, subprocess, sys, time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L
import alerts_lib as AL
import bus_changes as BC
import gtfs_versions as GV
import health as H
from build_eta_dataset import SUMMARY_COLUMNS

ROOT = Path(__file__).resolve().parent.parent
REPO = "blobberus/straight-bussing"
csv.field_size_limit(10 ** 7)

FIRST_EPOCH = 1791435600               # 2026-10-08 00:00 Chicago: nothing can be older
SOURCES = {"transition", "proximity", "pass", "gps"}
LAT, LON = (41.6, 42.1), (-87.95, -87.45)
RANGES = {"dist_prev_m": (0, 30000), "segment_s": (0, 3600), "speed_mps": (0, 30), "dwell_s": (0, 3600),
          "passio_pred_lead_s": (120, 3 * 3600)}
PRED_ERR_MAX = 3600                    # the collector keeps predictions within an hour of the arrival
DUP_S = 300
LATE_S = 2 * 3600                      # a row this much older than the rows before it was appended later
SEEN_FROM = 1791829800                 # 2026-10-12 13:30 Chicago: every later row has pred_seen_epoch (docs/DATA.md)
LINE_LOW, LINE_MIN, DAY_LOW = 0.5, 50, 0.6
ARCHIVE_FROM = "2026-10-10"
KIND_FROM = {**{k: ARCHIVE_FROM for k in H.ARCHIVE_KINDS}, **H.ARCHIVE_EXTRA}   # kind -> the first day it exists
EXT = {"raw-polls": ".jsonl.gz", "pred-updates": ".jsonl.gz", "eta": ".csv.gz", "gtfs": ".zip", "alerts": ".csv.gz",
       "bus-changes": ".csv.gz"}
TINY = {"raw-polls": ARCHIVE_FROM, "pred-updates": H.FIRST_ARCHIVE_DAY, "eta": ARCHIVE_FROM}   # kind -> sized from
TINY_BYTES = 1000                      # a gzip file this small holds (next to) nothing
# Findings already explained in docs/DATA-COLLECTION-LOG.md: listed as notes with their entry, never as errors again.
KNOWN = {"days:gap:2026-10-28": "DC-021: Passio's vehicle feed timed out 7:31 to 8:11 PM, nothing to log",
         "days:line:2026-10-08:South": "DC-002: only the stops Passio named were logged then; no polls kept to replay",
         "days:line:2026-10-09:South": "DC-002: only the stops Passio named were logged then; no polls kept to replay",
         "days:gap:2026-11-05": "DC-023: GitHub's API failed the chain's dispatches, nothing ran 10:39 AM to 12:39 PM"}
MIRROR_LAG_S = 2 * 3600                # the public copy syncs about every 30 min: the newest hours may lag


# ------------------------------------------------------------------ sources
class Branch:
    """The data branch's files: through git (`git show REF:path`) or from a checkout folder."""

    def __init__(self, ref="origin/data", repo=ROOT, folder=None):
        self.ref, self.repo, self.folder = ref, Path(repo), Path(folder) if folder else None

    def names(self):
        if self.folder:
            return sorted(p.relative_to(self.folder).as_posix() for p in self.folder.rglob("*") if p.is_file())
        out = subprocess.run(["git", "-C", str(self.repo), "ls-tree", "-r", "--name-only", self.ref],
                             capture_output=True, text=True, check=True).stdout
        return sorted(x for x in out.splitlines() if x)

    def text(self, name):
        if self.folder:
            p = self.folder / name
            return p.read_text(encoding="utf-8") if p.exists() else None
        r = subprocess.run(["git", "-C", str(self.repo), "show", f"{self.ref}:{name}"], capture_output=True)
        return r.stdout.decode("utf-8") if r.returncode == 0 else None


def read_csv(text):
    """CSV text -> (header list, row lists)."""
    rows = list(csv.reader(io.StringIO(text or "")))
    return (rows[0], rows[1:]) if rows else ([], [])


def release_assets(repo, months):
    """-> {asset name: size} of the data-archive-YYYY-MM releases (gh), or None if a release could not be read."""
    out = {}
    for m in months:
        r = subprocess.run(["gh", "release", "view", f"data-archive-{m}", "-R", repo, "--json", "assets", "--jq",
                            ".assets[] | [.name, .size] | @tsv"], capture_output=True, text=True, timeout=120)
        if r.returncode:
            if "release not found" in (r.stderr or "").lower():
                continue
            return None
        for line in r.stdout.splitlines():
            if "\t" in line:
                name, size = line.rsplit("\t", 1)
                out[f"{m}/{name}"] = int(size)
    return out


# ------------------------------------------------------------------ findings
class Audit:
    def __init__(self):
        self.found, self.facts = [], {}

    def add(self, level, check, text):
        if check in KNOWN and level != "note":
            level, text = "note", f"{text} [known, {KNOWN[check]}]"
        self.found.append({"level": level, "check": check, "text": text})

    def count(self, level, check, bad, what, examples=()):
        """bad = Counter or int; one finding with the count (and up to 3 examples)."""
        n = sum(bad.values()) if isinstance(bad, Counter) else int(bad)
        if not n:
            return
        ex = list(examples)[:3]
        detail = f" by day: {', '.join(f'{k} {v}' for k, v in sorted(bad.items())[:12])}" if isinstance(bad, Counter) else ""
        self.add(level, check, f"{n:,} {what}{detail}{(' (e.g. ' + '; '.join(ex) + ')') if ex else ''}")

    def errors(self):
        return sum(1 for f in self.found if f["level"] == "error")


def schema(a, name, header, rows, expected):
    if list(header) != list(expected):
        miss = [c for c in expected if c not in header]
        extra = [c for c in header if c not in expected]
        a.add("error", f"schema:{name}", f"{name}: header differs from the writer's columns (missing {miss}, extra "
                                         f"{extra}, or another order)")
    bad = [i for i, r in enumerate(rows) if len(r) != len(header)]
    if bad:
        a.add("error", f"schema:{name}", f"{name}: {len(bad):,} rows have another field count than the header "
                                         f"(first at data line {bad[0] + 2})")


def ix(header):
    return {c: i for i, c in enumerate(header)}


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def local(epoch):
    return L.chicago(epoch).strftime("%Y-%m-%d %H:%M:%S")


def sday(epoch):
    return H.service_day(epoch)


def dup_count(keyed, window=DUP_S):
    """keyed: {key: [epochs]} -> Counter(service day of the later row) of rows within `window` of the previous one."""
    out = Counter()
    for eps in keyed.values():
        eps.sort()
        for p, e in zip(eps, eps[1:]):
            if e - p <= window:
                out[str(sday(e))] += 1
    return out


# ------------------------------------------------------------------ arrivals
def check_arrivals(a, header, rows, now, route_names=None):
    """-> list of dicts (epoch, day, route, vehicle, stop, source, pred) of the usable rows, for the later checks."""
    c = ix(header)
    if "epoch" not in c:
        return []
    get = lambda r, k: r[c[k]] if k in c and c[k] < len(r) else ""
    bad = defaultdict(Counter)
    ex = defaultdict(list)
    out, keyed, names, ids = [], defaultdict(list), defaultdict(set), defaultdict(set)
    late, run_max, run_max_day = Counter(), 0, ""

    def flag(kind, r, e):
        d = str(sday(e)) if e else "?"
        bad[kind][d] += 1
        if len(ex[kind]) < 3:
            ex[kind].append(f"{get(r, 'local_time')} bus {get(r, 'vehicle_id')} stop {get(r, 'stop_id')}")

    for r in rows:
        try:
            e = int(get(r, "epoch"))
        except ValueError:
            flag("epoch", r, 0)
            continue
        if not FIRST_EPOCH <= e <= now + 3600:
            flag("epoch", r, e)
            continue
        t = L.chicago(e)
        if (get(r, "local_time") != t.strftime("%Y-%m-%d %H:%M:%S") or get(r, "dow") != str(t.weekday())
                or get(r, "hour") != str(t.hour) or get(r, "minute_of_day") != str(t.hour * 60 + t.minute)
                or get(r, "ts_utc") != datetime.fromtimestamp(e, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")):
            flag("time", r, e)
        veh, stop, rid, src = get(r, "vehicle_id"), get(r, "stop_id"), get(r, "route_id"), get(r, "source")
        if not (veh and stop and rid):
            flag("ids", r, e)
        if src not in SOURCES:
            flag("source", r, e)
        lat, lon = num(get(r, "stop_lat")), num(get(r, "stop_lon"))
        if lat is None or lon is None or not (LAT[0] <= lat <= LAT[1] and LON[0] <= lon <= LON[1]):
            flag("coords", r, e)
        si = get(r, "stop_index")
        if not si.isdigit() or int(si) > 60:
            flag("stop_index", r, e)
        for col, (lo, hi) in RANGES.items():
            v = num(get(r, col))
            if get(r, col) and (v is None or not lo <= v <= hi):
                flag(f"range:{col}", r, e)
        prev = get(r, "prev_arrival_epoch")
        if prev and get(r, "segment_s") and num(get(r, "segment_s")) != e - (num(prev) or 0):
            flag("segment", r, e)
        pe, pl = get(r, "passio_pred_epoch"), get(r, "passio_pred_lead_s")
        if bool(pe) != bool(pl):
            flag("pred_pair", r, e)
        elif pe and (num(pe) is None or abs(num(pe) - e) > PRED_ERR_MAX):
            flag("pred_err", r, e)
        if src == "gps" and (pe or get(r, "dwell_s") or get(r, "prev_stop_id")):
            flag("gps", r, e)
        names[rid].add(get(r, "route_name"))
        ids[get(r, "route_name")].add(rid)
        if run_max - e > LATE_S:
            late[(str(sday(e)), src, run_max_day)] += 1
        if e > run_max:
            run_max, run_max_day = e, str(sday(e))
        keyed[(veh, stop)].append(e)
        out.append({"epoch": e, "day": sday(e), "route": get(r, "route_name") or rid, "route_id": rid, "vehicle": veh,
                    "stop": stop, "source": src, "pred": bool(pe), "ok": bool(veh and stop and rid)})
    what = {"epoch": ("error", "rows with an epoch that is not a number, before 2026-10-08 or in the future"),
            "time": ("error", "rows whose ts_utc / local_time / dow / hour / minute_of_day disagree with epoch"),
            "ids": ("error", "rows without a bus, stop or route id"),
            "source": ("error", f"rows with a source other than {sorted(SOURCES)}"),
            "coords": ("error", "rows with stop coordinates missing or far from Chicago"),
            "stop_index": ("error", "rows with a stop_index that is not a small whole number"),
            "segment": ("error", "rows whose segment_s is not epoch - prev_arrival_epoch"),
            "pred_pair": ("error", "rows with only one of passio_pred_epoch / passio_pred_lead_s"),
            "pred_err": ("warn", f"rows whose Passio time is more than {PRED_ERR_MAX // 60} min from the arrival"),
            "gps": ("warn", "gps rows that carry a prediction, dwell or previous stop (the gps sweep logs none)")}
    for col, (lo, hi) in RANGES.items():
        what[f"range:{col}"] = ("warn", f"rows with {col} outside {lo} to {hi}")
    for kind, (level, text) in what.items():
        a.count(level, f"arrivals:{kind}", bad.get(kind, Counter()), text, ex.get(kind, ()))
    a.count("error", "arrivals:dups", dup_count(keyed), "duplicate arrivals (same bus and stop within 300 s; "
                                                         "tools/merge_arrivals.py should have dropped them)")
    many = {k: sorted(v) for k, v in names.items() if len(v) > 1}
    if many:
        a.add("warn", "arrivals:names", f"route ids with more than one route_name: {many}")
    many = {k: sorted(v) for k, v in ids.items() if len(v) > 1}
    if many:
        a.add("warn", "arrivals:ids", f"route names with more than one route_id: {many}")
    if route_names is not None:
        gone = Counter(x["route"] for x in out if x["route_id"] not in route_names)
        if gone:
            last = {}
            for x in out:
                if x["route_id"] not in route_names:
                    last[x["route"]] = max(last.get(x["route"], ""), str(x["day"]))
            a.add("note", "arrivals:retired", "lines in the data but not in today's timetable (web/data/routes.json): "
                  + ", ".join(f"{k} ({v:,} rows, last {last[k]})" for k, v in sorted(gone.items())))
    if late:
        groups = defaultdict(Counter)
        for (d, src, on), n in late.items():
            groups[on][d] += n
        a.add("note", "arrivals:order", "the file is append-ordered, not sorted: blocks appended later (replays / "
              "backfills) " + "; ".join(f"after {on}: {sum(g.values()):,} rows of {min(g)} to {max(g)}"
                                        for on, g in sorted(groups.items())) + " (sort by epoch before use)")
    a.facts["arrivals"] = len(out)
    return out


# ------------------------------------------------------------------ days
def check_days(a, arr, now, calendar=None):
    """Every finished service day present; each line against the same weekday on the other weeks; health.py's gaps."""
    if not arr:
        a.add("error", "days:none", "no arrivals at all")
        return {}
    today = sday(now)
    by_day = defaultdict(list)
    for x in arr:
        by_day[x["day"]].append(x)
    cal = calendar if calendar is not None else H.load_json(ROOT / "data" / "calendar.json") or {}
    first = min(by_day)
    d, missing, quiet = first, [], []
    while d < today:
        if not by_day.get(d):
            (quiet if H.regime(d, cal) in ("break", "holiday") else missing).append(str(d))
        d += timedelta(days=1)
    if missing:
        a.add("error", "days:missing", f"service days with no arrival at all: {', '.join(missing)}")
    if quiet:
        a.add("note", "days:quiet", f"break or holiday days with no arrival (data/calendar.json; maybe no service): "
                                    f"{', '.join(quiet)}")
    per = {d: Counter(x["route"] for x in xs) for d, xs in by_day.items()}
    table = {}
    for d in sorted(by_day):
        xs = by_day[d]
        rule = [x for x in xs if x["source"] != "gps"]
        table[str(d)] = {"weekday": f"{d:%a}", "rows": len(xs), "lines": len(per[d]),
                         "buses": len({x["vehicle"] for x in xs}), "stops": len({x["stop"] for x in xs}),
                         "gps": sum(1 for x in xs if x["source"] == "gps"),
                         "pred_share": round(sum(1 for x in rule if x["pred"]) / len(rule), 3) if rule else None,
                         "by_line": dict(sorted(per[d].items()))}
        if d < first or d >= today or H.regime(d, cal) in ("break", "holiday"):
            continue
        refs = [x for x in by_day if x != d and x >= first and x < today and x.weekday() == d.weekday()
                and H.regime(x, cal) not in ("break", "holiday")]
        if len(refs) < 2:
            continue
        med = statistics.median(len(by_day[x]) for x in refs)
        if len(xs) < DAY_LOW * med:
            a.add("warn", f"days:volume:{d}", f"{d:%a %b} {d.day}: {len(xs):,} arrivals, the same weekday's median "
                                              f"is {med:,.0f}")
        for line in sorted({n for x in refs for n in per[x]}):
            m = statistics.median(per[x].get(line, 0) for x in refs)
            got = per[d].get(line, 0)
            if m >= LINE_MIN and got < LINE_LOW * m:
                a.add("warn", f"days:line:{d}:{line}", f"{d:%a %b} {d.day}: {line} logged {got} arrivals (the same "
                                                       f"weekday's median {m:,.0f}; a service change, a relabeled "
                                                       "bus or a collection gap: check the alerts and the runs)")
    rows = [(x["epoch"], x["route"], x["vehicle"], x["stop"], x["source"], x["pred"], x["ok"]) for x in arr]
    days_back = (today - first).days
    for key, text in H.check_data(rows, now, days_back=days_back, calendar=cal).items():
        if key.startswith("data:gap:"):
            a.add("error", key.replace("data:", "days:"), text)
        elif key.startswith("data:pred:"):
            a.add("warn", key.replace("data:", "days:"), text)
    a.facts["days"] = table
    return table


# ------------------------------------------------------------------ predictions
def check_predictions(a, header, rows, arr):
    c = ix(header)
    need = ("epoch", "vehicle_id", "stop_id", "lead_target_s", "pred_epoch", "pred_made_epoch", "pred_lead_s",
            "pred_minus_actual_s", "pred_seen_epoch", "local_time")
    if any(k not in c for k in need):
        return
    seen_arr = defaultdict(list)
    for x in arr:
        seen_arr[(x["vehicle"], x["stop"])].append(x["epoch"])
    for v in seen_arr.values():
        v.sort()
    bad, ex, keyed = defaultdict(Counter), defaultdict(list), defaultdict(list)
    leads = set(L.PRED_LEADS)
    for r in rows:
        if len(r) != len(header):
            continue
        g = {k: r[c[k]] for k in need}
        try:
            e, t, made, pe, pl, pma = (int(g[k]) for k in ("epoch", "lead_target_s", "pred_made_epoch", "pred_epoch",
                                                             "pred_lead_s", "pred_minus_actual_s"))
        except ValueError:
            bad["number"]["?"] += 1
            continue
        d = str(sday(e))

        def flag(kind):
            bad[kind][d] += 1
            if len(ex[kind]) < 3:
                ex[kind].append(f"{g['local_time']} bus {g['vehicle_id']} stop {g['stop_id']} lead {t}")
        if t not in leads:
            flag("lead")
        if pl != e - made or pl < t:
            flag("pred_lead")
        if pma != pe - e:
            flag("pma")
        if abs(pma) > PRED_ERR_MAX:
            flag("err")
        if g["pred_seen_epoch"]:
            if int(g["pred_seen_epoch"]) > e - t:
                flag("seen")
        elif e >= SEEN_FROM:
            flag("noseen")
        if g["local_time"] != local(e):
            flag("time")
        keyed[(g["vehicle_id"], g["stop_id"], t)].append(e)
        v = seen_arr.get((g["vehicle_id"], g["stop_id"]), [])
        i = bisect.bisect_left(v, e - DUP_S)
        if not (i < len(v) and v[i] <= e + DUP_S):
            flag("orphan")
    what = {"number": ("error", "prediction rows with a field that is not a whole number"),
            "lead": ("error", f"prediction rows with a lead_target_s other than {sorted(leads)}"),
            "pred_lead": ("error", "prediction rows whose pred_lead_s is not epoch - pred_made_epoch or is below the "
                                   "target lead"),
            "pma": ("error", "prediction rows whose pred_minus_actual_s is not pred_epoch - epoch"),
            "err": ("warn", f"prediction rows more than {PRED_ERR_MAX // 60} min off"),
            "seen": ("error", "prediction rows first seen after the moment they are scored at (epoch - lead)"),
            "noseen": ("warn", "prediction rows without pred_seen_epoch after the column existed (Oct 12)"),
            "time": ("error", "prediction rows whose local_time disagrees with epoch"),
            "orphan": ("warn", "prediction rows with no arrival of that bus at that stop within 300 s")}
    for kind, (level, text) in what.items():
        a.count(level, f"predictions:{kind}", bad.get(kind, Counter()), text, ex.get(kind, ()))
    a.count("error", "predictions:dups", dup_count(keyed), "duplicate prediction rows (same bus, stop and lead within "
                                                           "300 s; tools/merge_predictions.py should have dropped them)")
    a.facts["predictions"] = len(rows)


# ------------------------------------------------------------------ the small files
def check_bus_changes(a, header, rows):
    c = ix(header)
    bad, keyed = Counter(), defaultdict(list)
    for r in rows:
        if len(r) != len(header):
            continue
        g = lambda k: r[c[k]]
        try:
            e, b0, b1 = int(g("epoch")), int(g("buses_before")), int(g("buses_after"))
        except ValueError:
            bad["number"] += 1
            continue
        if g("kind") not in ("drop", "add") or b1 != b0 + (1 if g("kind") == "add" else -1):
            bad["kind"] += 1
        if g("lasting") not in ("", "0", "1") or g("returning") not in ("", "0", "1"):
            bad["flags"] += 1
        if g("local_time") != local(e):
            bad["time"] += 1
        keyed[(g("route_id"), g("kind"), g("vehicle_id"))].append(e)
    for k, text in (("number", "rows with an epoch or bus count that is not a whole number"),
                    ("kind", "rows whose kind is not drop / add or whose bus counts do not step by one"),
                    ("flags", "rows with lasting / returning other than blank, 0 or 1"),
                    ("time", "rows whose local_time disagrees with epoch")):
        a.count("error", f"bus_changes:{k}", bad[k], f"bus_changes.csv: {text}")
    a.count("error", "bus_changes:dups", dup_count(keyed), "bus_changes.csv: duplicate changes (route, kind and bus "
                                                           "within 300 s)")


def check_alerts(a, header, rows):
    c = ix(header)
    versions, bad = Counter(), Counter()
    for r in rows:
        if len(r) != len(header):
            continue
        g = lambda k: r[c[k]]
        versions[g("version")] += 1
        try:
            if int(g("first_seen")) > int(g("last_seen")):
                bad["order"] += 1
            if g("first_seen_local") != local(int(g("first_seen"))) or g("last_seen_local") != local(int(g("last_seen"))):
                bad["time"] += 1
            if g("active_start") and g("active_end") and int(g("active_start")) > int(g("active_end")):
                bad["active"] += 1
        except ValueError:
            bad["number"] += 1
    dup = sum(n - 1 for n in versions.values() if n > 1)
    a.count("error", "alerts:dups", dup, "alerts.csv: versions listed more than once (merge_alerts keeps one row each)")
    for k, level, text in (("order", "error", "first_seen after last_seen"), ("time", "error", "local times disagree "
                           "with the epochs"), ("active", "warn", "active_start after active_end"),
                           ("number", "error", "a time that is not a number")):
        a.count(level, f"alerts:{k}", bad[k], f"alerts.csv rows with {text}")


def check_gtfs_versions(a, header, rows, names, newest):
    c = ix(header)
    vs = Counter(r[c["version"]] for r in rows if len(r) == len(header))
    dup = [v for v, n in vs.items() if n > 1]
    if dup:
        a.add("error", "gtfs_versions:dups", f"gtfs_versions.csv lists a version twice: {dup}")
    last = 0
    for r in rows:
        if len(r) != len(header):
            continue
        f = "data/ground_truth/" + r[c["file"]]
        if f not in names:
            a.add("error", "gtfs_versions:file", f"timetable {r[c['version']]}: its zip {f} is not on the branch")
        try:
            if int(r[c["first_seen"]]) > int(r[c["last_seen"]]):
                a.add("error", "gtfs_versions:order", f"timetable {r[c['version']]}: first_seen after last_seen")
            last = max(last, int(r[c["last_seen"]]))
        except ValueError:
            a.add("error", "gtfs_versions:number", f"timetable {r[c['version']]}: a time that is not a number")
    if newest and (not last or newest - last > 36 * 3600):
        a.add("warn", "gtfs_versions:stale", "the timetable record (gtfs_versions.csv) has no run in the 36 h before "
                                             "the newest arrival: the merge step's `gtfs_versions.py record` may fail")


def check_summary(a, header, rows):
    c = ix(header)
    keys = Counter(tuple(r[c[k]] for k in ("service_day", "source", "lead_bin", "route", "segment"))
                   for r in rows if len(r) == len(header))
    dup = sum(n - 1 for n in keys.values() if n > 1)
    a.count("error", "summary:dups", dup, "summary.csv rows repeated (same day, source, lead bin, route, segment)")
    return {k[0] for k in keys}


def check_archive(a, assets, now, summary_days, day_rows, first_day=None):
    """assets: {"YYYY-MM/name": size} or {"name": size}; first_day: the first service day with arrivals."""
    today = sday(now)
    by_day = defaultdict(dict)
    for full, size in assets.items():
        month, _, name = full.rpartition("/")
        for kind, ext in EXT.items():
            if name.startswith(kind + "-") and name.endswith(ext):
                day = name[len(kind) + 1:-len(ext)]
                try:
                    date.fromisoformat(day)
                except ValueError:
                    continue
                if month and month != day[:7]:
                    a.add("warn", "archive:month", f"{name} sits on the release of {month}")
                if kind in by_day[day]:
                    a.add("error", "archive:twice", f"{name} is on two releases")
                by_day[day][kind] = size
                break
        else:
            a.add("note", "archive:other", f"release asset of no known kind: {full}")
    start = KIND_FROM
    d, lack, waiting = max(date.fromisoformat(ARCHIVE_FROM), first_day or date.min), [], []
    while d < today:
        have = by_day.get(str(d), {})
        miss = [k for k, s in start.items() if str(d) >= s and k not in have]
        if miss:
            (waiting if d >= today - timedelta(days=1) else lack).append(f"{d} ({', '.join(miss)})")
        for k, since in TINY.items():
            if str(d) >= since and k in have and have[k] < TINY_BYTES and day_rows.get(str(d), 0) >= 100:
                a.add("warn", "archive:tiny", f"{k}-{d}: {have[k]} bytes on a day with {day_rows[str(d)]:,} arrivals")
        d += timedelta(days=1)
    if lack:
        a.add("error", "archive:missing", f"archive days missing files: {'; '.join(lack)} (gh workflow run archive.yml; "
                                          "a day with only some files: -f day=YYYY-MM-DD -f replace=true)")
    if waiting:
        a.add("note", "archive:waiting", f"not archived yet: {'; '.join(waiting)} (normal until about noon: GitHub "
                                         "fires the archive cron 6 to 10 h late)")
    eta_days = {d for d, k in by_day.items() if "eta" in k}
    if summary_days is not None:
        no_sum = sorted(eta_days - summary_days)
        no_eta = sorted(summary_days - eta_days)
        if no_sum:
            a.add("error", "summary:missing", f"archived days without summary.csv rows: {', '.join(no_sum)}")
        if no_eta:
            a.add("warn", "summary:extra", f"summary.csv days without an eta-<day> asset: {', '.join(no_eta)}")
    a.facts["archived_days"] = len(eta_days)


# ------------------------------------------------------------------ the public copy
def mirror_counts(header, rows):
    """The data repo's scripts/sync.py rule: 4 AM service day by local_time, exact-key dedupe -> {(day, route): n}."""
    c = ix(header)
    key = [c[k] for k in ("vehicle_id", "trip_id", "stop_id", "stop_index", "epoch")]
    seen, out = set(), Counter()
    for r in rows:
        if len(r) != len(header) or not r[c["epoch"]]:
            continue
        k = tuple(r[i] for i in key)
        if k in seen:
            continue
        seen.add(k)
        lt = r[c["local_time"]]
        try:
            t = datetime.strptime(lt[:19], "%Y-%m-%d %H:%M:%S")
            day = (t - timedelta(days=1)).strftime("%Y-%m-%d") if t.hour < 4 else t.strftime("%Y-%m-%d")
        except ValueError:
            day = lt[:10] or "unknown"
        out[(day, r[c["route_name"]] or r[c["route_id"]] or "unknown")] += 1
    return out


def check_mirror(a, folder, header, rows, main_text=None):
    folder = Path(folder)
    try:
        idx = json.loads((folder / "data" / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as ex:
        a.add("error", "mirror:index", f"the public copy's data/index.json can't be read ({ex})")
        return
    synced = datetime.strptime(idx.get("synced", "1970-01-01 00:00"), "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    settled = (L.chicago(synced.timestamp() - MIRROR_LAG_S) - timedelta(hours=4)).date().isoformat()
    want = mirror_counts(header, rows)
    files = {}
    for p in (folder / "data" / "arrivals").glob("*/*.csv"):
        h, rs = read_csv(p.read_text(encoding="utf-8"))
        files[(p.parent.name, p.stem)] = (h, len(rs))
    bad_head = sorted(f"{d}/{s}" for (d, s), (h, _) in files.items() if list(h) != list(L.COLUMNS))
    if bad_head:
        a.add("error", "mirror:header", f"{len(bad_head)} of {len(files)} per-day files in the public copy lack the "
                                        f"arrivals header (first {bad_head[0]}, header {files[tuple(bad_head[0].split('/'))][0][:10]}...)")
    idx_n = {(d["day"], name): r["rows"] for d in idx.get("days", []) for name, r in d.get("routes", {}).items()}
    idx_f = {(d["day"], name): Path(r["file"]).stem for d in idx.get("days", []) for name, r in d.get("routes", {}).items()}
    wrong, missing, extra, stale = [], [], [], []
    for (day, route), n in sorted(want.items()):
        if day >= settled:
            continue
        f = files.get((day, idx_f.get((day, route), "")))
        if (day, route) not in idx_n or f is None:
            missing.append(f"{day} {route}")
        elif idx_n[(day, route)] != n or f[1] != n:
            wrong.append(f"{day} {route}: data branch {n}, index {idx_n[(day, route)]}, file {f[1]}")
    for (day, route), n in sorted(idx_n.items()):
        if day < settled and (day, route) not in want:
            extra.append(f"{day} {route} ({n})")
    if missing:
        a.add("error", "mirror:missing", f"{len(missing)} day/line files missing from the public copy: {', '.join(missing[:8])}")
    if wrong:
        a.add("error", "mirror:counts", f"{len(wrong)} day/line files whose row count differs from the data branch: "
                                        f"{'; '.join(wrong[:6])}{' ...' if len(wrong) > 6 else ''}")
    if extra:
        a.add("error", "mirror:extra", f"{len(extra)} day/line files in the public copy the data branch has no rows for: "
                                       f"{', '.join(extra[:8])}")
    if main_text is not None:
        for p in sorted((folder / "methodology").rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(folder / "methodology").as_posix()
            src = main_text(rel)
            if src is None:
                stale.append(f"{rel} (gone from main)")
            elif src.replace("\r\n", "\n") != p.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n"):
                stale.append(rel)
        if stale:
            a.add("warn", "mirror:methodology", f"{len(stale)} methodology copies differ from main: {', '.join(stale[:8])}"
                                                f"{' ...' if len(stale) > 8 else ''} (the copy follows within the hour; a "
                                                "file gone from main stays in the copy)")
    a.facts["mirror"] = {"synced": idx.get("synced"), "rows": idx.get("rows"), "days": len(idx.get("days", [])),
                         "files": len(files)}


# ------------------------------------------------------------------ main
def audit(branch, now, assets=None, mirror=None, main_text=None, route_names=None, calendar=None):
    a = Audit()
    names = branch.names()
    gt = "data/ground_truth/"

    def load(name, expected):
        text = branch.text(name)
        if text is None:
            a.add("error", f"file:{name}", f"{name} is missing")
            return list(expected), []
        h, rs = read_csv(text)
        schema(a, name, h, rs, expected)
        return h, rs

    arr_files = sorted(n for n in names if n.startswith(gt + "archive/arrivals-") and n.endswith(".csv")) + [gt + "arrivals.csv"]
    ah, arows = list(L.COLUMNS), []
    for f in arr_files:
        h, rs = load(f, L.COLUMNS)
        if list(h) == list(L.COLUMNS):
            arows += rs
    arr = check_arrivals(a, ah, arows, now, route_names)
    table = check_days(a, arr, now, calendar)
    pred_files = sorted(n for n in names if n.startswith(gt + "archive/predictions-") and n.endswith(".csv")) + [gt + "predictions.csv"]
    prows = []
    for f in pred_files:
        h, rs = load(f, L.PRED_COLUMNS)
        if list(h) == list(L.PRED_COLUMNS):
            prows += rs
    check_predictions(a, list(L.PRED_COLUMNS), prows, arr)
    unknown = [n for n in names if n.startswith(gt + "archive/") and not n.rsplit("/", 1)[1].startswith(("arrivals-", "predictions-"))]
    if unknown:
        a.add("warn", "file:archive", f"files in {gt}archive/ that are neither arrivals- nor predictions- rotations: {unknown} "
                                      "(readers that glob archive/*.csv would mix them in)")
    h, rs = load(gt + "bus_changes.csv", BC.COLUMNS)
    check_bus_changes(a, h, rs)
    h, rs = load(gt + "alerts.csv", AL.COLUMNS)
    check_alerts(a, h, rs)
    h, rs = load(gt + "gtfs_versions.csv", GV.COLUMNS)
    check_gtfs_versions(a, h, rs, set(names), max((x["epoch"] for x in arr), default=0))
    h, rs = load("data/eta/summary.csv", SUMMARY_COLUMNS)
    summary_days = check_summary(a, h, rs)
    if assets is not None:
        check_archive(a, assets, now, summary_days, {d: t["rows"] for d, t in table.items()},
                      min((x["day"] for x in arr), default=None))
    if mirror:
        check_mirror(a, mirror, ah, arows, main_text)
    return a


def report(a, days=False):
    out = []
    for level in ("error", "warn", "note"):
        fs = [f for f in a.found if f["level"] == level]
        if fs:
            out.append(f"{level.upper()} ({len(fs)})")
            out += [f"  [{f['check']}] {f['text']}" for f in fs]
    if days and a.facts.get("days"):
        out.append("per service day: rows, lines, buses, stops, gps rows, Passio share (non-gps rows)")
        for d, t in a.facts["days"].items():
            share = f"{t['pred_share']:.0%}" if t["pred_share"] is not None else "-"
            out.append(f"  {d} {t['weekday']} {t['rows']:>6,} {t['lines']:>3} {t['buses']:>3} {t['stops']:>3} "
                       f"{t['gps']:>5} {share:>4}")
    facts = {k: v for k, v in a.facts.items() if k != "days"}
    out.append(f"VERDICT {'ERRORS' if a.errors() else 'CLEAN'}: {a.errors()} error(s), "
               f"{sum(1 for f in a.found if f['level'] == 'warn')} warning(s); {json.dumps(facts)}")
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", default="origin/data", help="the data branch ref (git mode)")
    ap.add_argument("--dir", help="a checkout of the data branch (the folder holding data/) instead of git")
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--assets", help="release assets as JSON {name: size} (instead of asking gh)")
    ap.add_argument("--no-gh", action="store_true", help="skip the release checks")
    ap.add_argument("--mirror", help="a clone of blobberus/straight-bussing-data to compare")
    ap.add_argument("--main-ref", default="origin/main", help="git ref the methodology copies are compared with")
    ap.add_argument("--days", action="store_true", help="print the per-day table")
    ap.add_argument("--json", help="write the findings and facts as JSON here")
    ap.add_argument("--now", type=float, help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    now = a.now or time.time()
    branch = Branch(a.ref, ROOT, a.dir)
    assets = None
    if a.assets:
        assets = json.loads(Path(a.assets).read_text(encoding="utf-8"))
    elif not a.no_gh:
        today = sday(now)
        months = sorted({(today - timedelta(days=k)).strftime("%Y-%m") for k in range(0, 120)
                         if (today - timedelta(days=k)).isoformat() >= ARCHIVE_FROM})
        assets = release_assets(a.repo, months)
        if assets is None:
            print("db_audit: could not list the releases (gh); archive checks skipped", file=sys.stderr)

    def main_text(rel):
        r = subprocess.run(["git", "-C", str(ROOT), "show", f"{a.main_ref}:{rel}"], capture_output=True)
        return r.stdout.decode("utf-8", errors="replace") if r.returncode == 0 else None
    routes = H.load_json(ROOT / "web" / "data" / "routes.json")
    route_names = set(routes) if isinstance(routes, dict) else None
    res = audit(branch, now, assets, a.mirror, main_text if a.mirror else None, route_names)
    print(report(res, a.days))
    if a.json:
        Path(a.json).write_text(json.dumps({"findings": res.found, "facts": res.facts}, indent=1), encoding="utf-8")
    return 1 if res.errors() else 0


if __name__ == "__main__":
    raise SystemExit(main())

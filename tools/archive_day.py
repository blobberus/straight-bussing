#!/usr/bin/env python3
"""Keep the prediction data for good: the CI artifacts (pred-updates-<run>, raw-polls-<run>) expire after 90 days
and the local collector's logs after 14. Per Chicago service day (04:00 to 04:00) this merges them into one gzipped
file each, builds the forecast-snapshot table (tools/build_eta_dataset.py) and uploads the three files to the GitHub
Release `data-archive-YYYY-MM` (release assets: no growth of the git history; about 5.5 MB a day, plus the day's
GTFS zip so the timetable columns can be rebuilt exactly, and alerts-<day>.csv.gz, the operator's service alert
versions in the feed that day, from the data branch's alerts.csv, once alert collection has begun). The day's
aggregate rows (the owner's accuracy goal by lead) are merged into data/eta/summary.csv on the data branch (tiny).

  python tools/archive_day.py --catch-up 10 --arrivals A.csv --gtfs g.zip --data-dir databranch   # CI (archive.yml)
  python tools/archive_day.py --day 2026-10-12 --local                  # this PC, if CI was down (adds local logs)
  python tools/archive_day.py --merge-summary work/summary-*.csv --data-dir databranch          # CI commit step

Only finished days are archived (3 h after the day ends, so the last runs have uploaded); a day already archived is
skipped unless --replace. Needs the logged-in gh CLI (GH_TOKEN in CI). Stdlib + gh. Tests: tools/test_eta.py.
"""
import argparse, glob, gzip, io, json, subprocess, sys, time, zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L
import build_eta_dataset as B

REPO = "blobberus/straight-bussing"
PREFIXES = ("pred-updates-", "raw-polls-")
SETTLE_S = 3 * 3600
LOCAL = L.ROOT / "data" / "monitor"


def gh(*args, binary=False, check=True):
    r = subprocess.run(["gh", *args], capture_output=True, timeout=600)
    if check and r.returncode:
        raise RuntimeError(f"gh {' '.join(args[:3])}: {r.stderr.decode('utf-8', 'replace').strip()[:300]}")
    return r.stdout if binary else r.stdout.decode("utf-8")


def tag_of(day):
    return "data-archive-" + str(day)[:7]


def asset_names(day):
    return [f"pred-updates-{day}.jsonl.gz", f"raw-polls-{day}.jsonl.gz", f"eta-{day}.csv.gz"]


def finished(day, now):
    return now >= B.day_bounds(day)[1] + SETTLE_S


def last_days(n, now):
    """The n service days before the current one, newest first."""
    cur = B.service_day_of(now)
    return [str(cur - timedelta(days=k)) for k in range(1, n + 1)]


def _epoch(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


# ---------------------------------------------------------------- merging one day
def merge_pred(lines, day):
    """PredLog lines (JSON text or lists) -> sorted 8-field lists for the day, one per update (earliest seen,
    latest last); the day of an update is the service day of when it was first seen."""
    t0, t1 = B.day_bounds(day)
    best = {}
    for ln in lines:
        try:
            x = json.loads(ln) if isinstance(ln, str) else ln
            veh, trip, stop, made, pred, seq = x[:6]
            seen = int(x[6]) if len(x) > 6 else int(made)
            last = int(x[7]) if len(x) > 7 else seen
        except (ValueError, TypeError, IndexError):
            continue
        if not t0 <= seen < t1:
            continue
        k = (veh, trip, stop, int(made), int(pred), seq)
        b = best.get(k)
        best[k] = (seen, last) if b is None else (min(b[0], seen), max(b[1], last))
    return sorted(([*k, s, l] for k, (s, l) in best.items()), key=lambda x: (x[6], str(x[0]), str(x[1]), str(x[2])))


def merge_raw(lines, day):
    """RawPolls lines -> the day's polls sorted by time, each vehicle report kept once (vehicle, report time)."""
    t0, t1 = B.day_bounds(day)
    polls, seen = {}, set()
    parsed = []
    for ln in lines:
        try:
            p = json.loads(ln) if isinstance(ln, str) else ln
            if isinstance(p, dict) and t0 <= int(p["t"]) < t1:
                parsed.append(p)
        except (ValueError, TypeError, KeyError):
            continue
    parsed.sort(key=lambda p: p["t"])
    for p in parsed:
        fresh = []
        for v in p.get("v") or []:
            key = (v[0], v[-1]) if isinstance(v, list) and v else None
            if key is None or key in seen:
                continue
            seen.add(key)
            fresh.append(v)
        if fresh or p["t"] not in polls:
            q = polls.setdefault(p["t"], {"t": p["t"], "h": p.get("h"), "v": []})
            q["v"] += fresh
    return [polls[t] for t in sorted(polls)]


def write_gz_lines(objs, path):
    with gzip.open(path, "wt", encoding="utf-8", newline="\n", compresslevel=9) as f:
        for o in objs:
            f.write(json.dumps(o, separators=(",", ":")) + "\n")


# ---------------------------------------------------------------- inputs
def artifact_list(repo):
    out = gh("api", "--paginate", f"repos/{repo}/actions/artifacts?per_page=100", "--jq",
             '.artifacts[] | select(.expired | not) | [.id, .name, .created_at] | @json')
    return [json.loads(x) for x in out.splitlines() if x.strip()]


def artifact_lines(repo, aid):
    z = zipfile.ZipFile(io.BytesIO(gh("api", f"repos/{repo}/actions/artifacts/{aid}/zip", binary=True)))
    lines = []
    for m in z.namelist():
        lines += z.read(m).decode("utf-8", "replace").splitlines()
    return lines


def inputs_from_artifacts(repo, day, arts):
    """-> (pred lines, raw lines) of the artifacts created while the day ran (2 h before to 3 h after)."""
    t0, t1 = B.day_bounds(day)
    pred, raw = [], []
    for aid, name, created in arts:
        if not name.startswith(PREFIXES) or not t0 - 7200 <= _epoch(created) <= t1 + SETTLE_S:
            continue
        lines = artifact_lines(repo, aid)
        (pred if name.startswith("pred-updates-") else raw).extend(lines)
    return pred, raw


def inputs_from_local(day, root=LOCAL):
    t0, t1 = B.day_bounds(day)
    pred, raw = [], []
    for sub, dest in (("predlog", pred), ("raw", raw)):
        for f in sorted(glob.glob(str(Path(root) / sub / "*.jsonl*"))):
            if Path(f).stat().st_mtime < t0 - 7200:
                continue
            with B._open(f) as fh:
                dest.extend(fh.read().splitlines())
    return pred, raw


# ---------------------------------------------------------------- one day
def alerts_of_day(path, day):
    """The service alert versions in the feed at some poll of the service day (data/ground_truth/alerts.csv), or
    None when there is nothing to say: no file, no rows, or alert collection started after the day ended."""
    import alerts_lib as AL
    if not path or not Path(path).exists():
        return None
    rows, _ = AL.read_csv(path)
    t0, t1 = B.day_bounds(day)
    if not rows or min(int(r["first_seen"]) for r in rows) >= t1:
        return None
    return AL.in_window(rows, t0, t1)


def write_alerts(rows, path):
    import alerts_lib as AL
    with gzip.open(path, "wt", encoding="utf-8", newline="", compresslevel=9) as f:
        f.write(AL.to_text(rows))


def archive(day, repo, arts, work, arrivals, gtfs=None, local=False, upload=True, clobber=False, web_data=None,
            local_dir=LOCAL, alerts=None):
    """Build and (optionally) upload the day's three files (plus alerts-<day>.csv.gz when `alerts`, the data branch's
    alerts.csv, covers the day). -> (summary rows, message) or (None, why skipped)."""
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    pred, raw = inputs_from_artifacts(repo, day, arts) if arts is not None else ([], [])
    if local:
        lp, lr = inputs_from_local(day, local_dir)
        pred, raw = pred + lp, raw + lr
    pred, raw = merge_pred(pred, day), merge_raw(raw, day)
    if not pred and not any(p["v"] for p in raw):
        return None, f"{day}: no prediction updates or position polls found"
    names = asset_names(day)
    paths = [work / n for n in names]
    write_gz_lines(pred, paths[0])
    write_gz_lines(raw, paths[1])
    t0, t1 = B.day_bounds(day)
    st = L.Static(web_data) if web_data else L.Static()
    try:
        from context_join import load_calendar
        cal = load_calendar(L.ROOT / "data" / "calendar.json")
    except Exception:
        cal = ()
    rows = B.build(day, B.load_arrivals(arrivals, t0, t1 + B.HORIZON_S), B.load_pred_updates([paths[0]], t0, t1 + B.HORIZON_S),
                   B.load_raw([paths[1]], t0, t1), B.load_timetable(gtfs), st, cal=cal)
    B.write_rows(rows, paths[2])
    summ = B.summary(rows, day)
    B.merge_summary(work / f"summary-{day}.csv", summ)
    msg = (f"{day}: {len(pred)} prediction updates, {sum(len(p['v']) for p in raw)} position reports, {len(rows)} table rows "
           f"({sum(p.stat().st_size for p in paths) / 1e6:.1f} MB gz)")
    alert_file = None
    try:                                      # optional: never costs the day's main files
        day_alerts = alerts_of_day(alerts, day)
        if day_alerts is not None:
            alert_file = work / f"alerts-{day}.csv.gz"
            write_alerts(day_alerts, alert_file)
            msg += f", {len(day_alerts)} alert versions"
    except Exception as ex:
        alert_file = None
        msg += f", alerts skipped ({type(ex).__name__}: {ex})"
    if upload:
        tag = tag_of(day)
        if gh("release", "view", tag, "--repo", repo, "--json", "tagName", check=False).strip() == "":
            gh("release", "create", tag, "--repo", repo, "--prerelease", "--latest=false",
               "--title", f"Prediction data archive {str(day)[:7]}",
               "--notes", "Daily files for the 10% rule work: Passio prediction updates, raw position polls, the "
                          "forecast-snapshot table (eta-<day>.csv.gz) and the operator's service alert versions "
                          "(alerts-<day>.csv.gz). Made by .github/workflows/archive.yml; "
                          "schemas in docs/DATA.md. Unofficial student project; public feed data only.")
        extra = [alert_file] if alert_file else []
        if gtfs and Path(gtfs).exists():      # the timetable used (80 kB): rebuilds stay exact after a GTFS change
            g = work / f"gtfs-{day}.zip"
            g.write_bytes(Path(gtfs).read_bytes())
            extra.append(g)
        gh("release", "upload", tag, *map(str, paths + extra), "--repo", repo, *(["--clobber"] if clobber else []))
        msg += f" -> release {tag}"
    return summ, msg


def archived(repo, day):
    out = gh("release", "view", tag_of(day), "--repo", repo, "--json", "assets", "--jq", ".assets[].name", check=False)
    return f"eta-{day}.csv.gz" in out.split()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--day", help="one service day YYYY-MM-DD")
    ap.add_argument("--catch-up", type=int, default=0, help="also every finished day of the last N not yet archived")
    ap.add_argument("--local", action="store_true", help="add this PC's data/monitor/predlog and raw logs")
    ap.add_argument("--local-dir", default=str(LOCAL), help="the local collector folder (default data/monitor)")
    ap.add_argument("--no-artifacts", action="store_true", help="local files only (no GitHub artifact download)")
    ap.add_argument("--replace", action="store_true", help="rebuild and overwrite an archived day")
    ap.add_argument("--no-upload", action="store_true", help="build into --work only")
    ap.add_argument("--arrivals", nargs="*", default=[str(LOCAL / "databranch" / "data" / "ground_truth" / "arrivals.csv")])
    ap.add_argument("--gtfs", help="google_transit.zip (timetable columns; optional)")
    ap.add_argument("--alerts", default=str(LOCAL / "databranch" / "data" / "ground_truth" / "alerts.csv"),
                    help="the data branch's alerts.csv: also upload alerts-<day>.csv.gz (optional; skipped if missing)")
    ap.add_argument("--data-dir", help="data branch worktree: merge the day's summary rows into data/eta/summary.csv")
    ap.add_argument("--work", default=str(L.ROOT / "data" / "eta_work"))
    ap.add_argument("--merge-summary", nargs="*", help="only merge these summary-<day>.csv files into --data-dir")
    a = ap.parse_args(argv)
    if a.merge_summary is not None:
        if not a.data_dir:
            ap.error("--merge-summary needs --data-dir")
        import csv
        rows = []
        for f in a.merge_summary:
            with open(f, encoding="utf-8", newline="") as fh:
                rows += list(csv.DictReader(fh))
        if rows:
            n = B.merge_summary(Path(a.data_dir) / "data" / "eta" / "summary.csv", rows)
            print(f"summary: {len(rows)} new rows, {n} in data/eta/summary.csv")
        return 0
    now = time.time()
    days = ([a.day] if a.day else []) + [d for d in last_days(a.catch_up, now) if d != a.day]
    if not days:
        ap.error("give --day or --catch-up N")
    arts = None if a.no_artifacts else artifact_list(a.repo)
    arrivals = [p for p in a.arrivals if Path(p).exists()]
    archive_rows, failed = [], 0
    for day in days:
        if not finished(day, now) and not a.day:
            continue
        if not a.replace and not a.no_upload and archived(a.repo, day):
            print(f"{day}: already archived")
            continue
        try:
            summ, msg = archive(day, a.repo, arts, a.work, arrivals, a.gtfs, a.local, not a.no_upload, a.replace,
                                local_dir=a.local_dir, alerts=a.alerts)
        except Exception as ex:               # one bad day must not stop the others
            failed += 1
            print(f"{day}: FAILED {ex!r}", file=sys.stderr)
            continue
        print(msg)
        if summ:
            archive_rows += summ
    if a.data_dir and archive_rows:
        n = B.merge_summary(Path(a.data_dir) / "data" / "eta" / "summary.csv", archive_rows)
        print(f"summary: {len(archive_rows)} new rows, {n} in data/eta/summary.csv")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

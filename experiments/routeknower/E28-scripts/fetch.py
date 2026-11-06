#!/usr/bin/env python3
"""E28 (2026-11-06): gather the inputs for the end-of-service study in one folder.

Per Chicago service day (04:00 to 04:00): raw-polls-<day>.jsonl.gz, pred-updates-<day>.jsonl.gz, gtfs-<day>.zip and
alerts-<day>.csv.gz from the monthly release `data-archive-YYYY-MM` (tools/archive_day.py); a day not archived yet (the
archive runs a few hours after the day ends) is merged from the collector's 90-day artifacts with archive_day's own
merge_raw / merge_pred, and borrows the previous day's timetable. The data branch's arrivals.csv, alerts.csv and
bus_changes.csv are copied next to them. Files already present are kept (E27's folder can be passed as --reuse).

  python experiments/routeknower/E28-scripts/fetch.py --out <dir> --from 2026-10-10 --to 2026-11-05 [--reuse <E27 dl dir>]
"""
import argparse, shutil, subprocess, sys
from datetime import date, timedelta
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_DIR / "tools"))
import archive_day as A   # noqa: E402

REPO = "blobberus/straight-bussing"
KINDS = ("raw-polls-{}.jsonl.gz", "pred-updates-{}.jsonl.gz", "gtfs-{}.zip", "alerts-{}.csv.gz")


def release_assets(tag):
    r = subprocess.run(["gh", "release", "view", tag, "-R", REPO, "--json", "assets", "--jq", ".assets[].name"],
                       capture_output=True, text=True)
    return set(r.stdout.split()) if r.returncode == 0 else set()


def download(tag, name, out):
    subprocess.run(["gh", "release", "download", tag, "-R", REPO, "-p", name, "-D", str(out), "--clobber"], check=True,
                   capture_output=True)


def from_artifacts(day, out, arts):
    pred, raw = A.inputs_from_artifacts(REPO, day, arts)
    raw_m, pred_m = A.merge_raw(raw, day), A.merge_pred(pred, day)
    A.write_gz_lines(raw_m, out / f"raw-polls-{day}.jsonl.gz")
    A.write_gz_lines(pred_m, out / f"pred-updates-{day}.jsonl.gz")
    print(f"{day}: from artifacts, {len(raw_m)} polls, {sum(len(p['v']) for p in raw_m)} reports, {len(pred_m)} "
          "prediction updates", file=sys.stderr)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--from", dest="d0", required=True)
    ap.add_argument("--to", dest="d1", required=True)
    ap.add_argument("--reuse", nargs="*", default=[], help="folders with files already downloaded (copied, not fetched)")
    ap.add_argument("--refresh", nargs="*", default=[], help="days to rebuild from artifacts even if present")
    a = ap.parse_args(argv)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    d, last = date.fromisoformat(a.d0), date.fromisoformat(a.d1)
    tags, arts = {}, None
    while d <= last:
        day = d.isoformat()
        tag = A.tag_of(day)
        if tag not in tags:
            tags[tag] = release_assets(tag)
        for k in KINDS:
            name = k.format(day)
            if (out / name).exists() and day not in a.refresh:
                continue
            src = next((Path(r) / name for r in a.reuse if (Path(r) / name).exists()), None)
            if src and day not in a.refresh:
                shutil.copy2(src, out / name)
            elif name in tags[tag] and day not in a.refresh:
                download(tag, name, out)
        if not (out / f"raw-polls-{day}.jsonl.gz").exists() or day in a.refresh:
            arts = arts if arts is not None else A.artifact_list(REPO)
            from_artifacts(day, out, arts)
        if not (out / f"gtfs-{day}.zip").exists():
            prev = out / f"gtfs-{(d - timedelta(days=1)).isoformat()}.zip"
            if prev.exists():
                shutil.copy2(prev, out / f"gtfs-{day}.zip")
                print(f"{day}: timetable borrowed from the day before", file=sys.stderr)
        d += timedelta(days=1)
    for f in ("arrivals.csv", "alerts.csv", "bus_changes.csv"):
        txt = subprocess.run(["git", "-C", str(REPO_DIR), "show", f"origin/data:data/ground_truth/{f}"],
                             capture_output=True, check=True).stdout
        (out / f).write_bytes(txt)
        print(f, len(txt.splitlines()), "lines", file=sys.stderr)


if __name__ == "__main__":
    main()

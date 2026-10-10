#!/usr/bin/env python3
"""Download the raw position polls that collect.yml keeps as 90-day artifacts (RouteKnower E03) and
merge them into one deduplicated JSON-lines file per Chicago service day.

  python tools/raw_fetch.py                 # new artifacts -> data/raw_polls/days/YYYY-MM-DD.jsonl
  python tools/raw_fetch.py --list          # what is on GitHub (name, size, expires)

Artifacts need auth even on a public repo: the logged-in gh CLI is used. Overlapping runs repeat polls,
so vehicles are deduped on (vehicle, vt) and each day file is sorted by poll time. Format per line:
{"t": poll epoch, "h": feed header ts, "v": [[truth_logger.RawPolls.FIELDS...], ...]} (only new vehicle
reports are kept on a line). Downloads stay local (data/.gitignore); download again before they expire.
"""
import argparse, io, json, subprocess, sys, zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L

REPO = "blobberus/straight-bussing"
ROOT = Path(__file__).resolve().parent.parent / "data" / "raw_polls"
PREFIX = "raw-polls-"


def gh(*args, binary=False):
    r = subprocess.run(["gh", *args], capture_output=True, timeout=300)
    if r.returncode:
        sys.exit(f"gh {' '.join(args[:2])} failed: {r.stderr.decode('utf-8', 'replace').strip()[:300]}")
    return r.stdout if binary else r.stdout.decode("utf-8")


def artifacts(repo):
    out = gh("api", "--paginate", f"repos/{repo}/actions/artifacts?per_page=100", "--jq",
             f'.artifacts[] | select(.name | startswith("{PREFIX}")) | select(.expired | not) '
             '| [.id, .name, .size_in_bytes, .expires_at] | @json')
    return [json.loads(ln) for ln in out.splitlines() if ln.strip()]


def service_day(epoch):
    """Chicago date, with the night service (before 04:00) counted to the previous day."""
    return L.chicago(epoch - 4 * 3600).strftime("%Y-%m-%d")


def merge_into_days(lines, days_dir):
    """lines: parsed poll dicts from any number of runs -> appended to per-day files, deduped on (veh, vt)."""
    by_day = {}
    for p in lines:
        if isinstance(p, dict) and isinstance(p.get("t"), (int, float)):
            by_day.setdefault(service_day(int(p["t"])), []).append(p)
    days_dir.mkdir(parents=True, exist_ok=True)
    added = 0
    for day, polls in sorted(by_day.items()):
        path = days_dir / f"{day}.jsonl"
        old = [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()] \
            if path.exists() else []
        seen, merged = set(), []
        for p in sorted(old + polls, key=lambda p: p["t"]):
            fresh = []
            for v in p.get("v") or []:
                key = (v[0], v[-1]) if isinstance(v, list) and v else None
                if key is None or key in seen:
                    continue
                seen.add(key)
                fresh.append(v)
            # keep a poll with new reports, or a genuinely empty poll (quiet feed); drop all-duplicate polls
            if fresh or (not p.get("v") and not (merged and merged[-1]["t"] == p["t"])):
                merged.append({"t": p["t"], "h": p.get("h"), "v": fresh})
        added += sum(len(p["v"]) for p in merged) - sum(len(p.get("v") or []) for p in old)
        tmp = path.with_suffix(".tmp")
        tmp.write_text("".join(json.dumps(p, separators=(",", ":")) + "\n" for p in merged),
                       encoding="utf-8", newline="\n")
        tmp.replace(path)
    return added, sorted(by_day)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--out", default=str(ROOT), help="folder (default data/raw_polls)")
    ap.add_argument("--list", action="store_true", help="only list the artifacts on GitHub")
    a = ap.parse_args()
    arts = artifacts(a.repo)
    if a.list:
        for aid, name, size, exp in arts:
            print(f"{name:<28} {size / 1e3:>8.0f} kB  expires {exp[:10]}")
        print(f"{len(arts)} artifact(s), {sum(x[2] for x in arts) / 1e6:.1f} MB")
        return 0
    out = Path(a.out)
    done_file = out / "downloaded.txt"
    done = set(done_file.read_text(encoding="utf-8").split()) if done_file.exists() else set()
    new = [x for x in arts if x[1] not in done]
    print(f"{len(arts)} artifact(s) on GitHub, {len(new)} new")
    total = 0
    for aid, name, size, exp in new:
        z = zipfile.ZipFile(io.BytesIO(gh("api", f"repos/{a.repo}/actions/artifacts/{aid}/zip", binary=True)))
        lines = []
        for member in z.namelist():
            for ln in z.read(member).decode("utf-8", "replace").splitlines():
                try:
                    lines.append(json.loads(ln))
                except ValueError:            # a run killed mid-write leaves a partial last line
                    pass
        added, days = merge_into_days(lines, out / "days")
        total += added
        out.mkdir(parents=True, exist_ok=True)
        with open(done_file, "a", encoding="utf-8") as f:
            f.write(name + "\n")
        print(f"{name}: {len(lines)} polls, +{added} vehicle reports ({', '.join(days) or 'empty'})")
    print(f"done: +{total} vehicle reports in {out / 'days'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

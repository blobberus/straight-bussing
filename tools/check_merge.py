#!/usr/bin/env python3
"""No-rows-lost guard: a collect run checks the merged ground-truth files before it pushes them to the data branch.

  python tools/check_merge.py snapshot databranch/data/ground_truth > before.json   # right after the checkout
  python tools/check_merge.py verify databranch/data/ground_truth --before before.json   # after the merges; exit 1 = don't push

Why (risk review 2026-11-01, DC-021): every run rewrites the shared CSVs and pushes them, and every later run builds on
what it pushed. A merge bug (or a truncated write) could drop rows, cut a file short or break its columns, and the
loss would be carried forward silently; git history keeps the old copy, but nobody would know to look.

What `verify` requires, per file family (arrivals, predictions, alerts, bus_changes; a file's rotated copies in
archive/ count with it):
  - the header is unchanged, and every line has the header's number of columns (arrivals, predictions);
  - no rows lost: arrivals, predictions and bus_changes never have fewer rows than before (merges only add or replace
    a row by a richer copy); alerts never have fewer distinct alert versions (rows of one version may collapse, DC-012);
  - archive files that existed are untouched (same size), and every file ends with a newline (not cut short).
Stdlib only. Tests: tools/test_merge.py.
"""
import argparse, csv, json, sys
from pathlib import Path

FAMILIES = {"arrivals": "arrivals.csv", "predictions": "predictions.csv", "alerts": "alerts.csv",
            "bus_changes": "bus_changes.csv"}
STRICT_COLUMNS = ("arrivals", "predictions")


def read(path):
    """-> (header, rows as lists, bad line count, ends with newline)."""
    raw = Path(path).read_bytes()
    text = raw.decode("utf-8", "replace")
    rows = list(csv.reader(text.splitlines()))
    if not rows:
        return "", [], 0, True
    header, body = rows[0], [r for r in rows[1:] if r]
    bad = sum(1 for r in body if len(r) != len(header))
    return ",".join(header), body, bad, raw.endswith(b"\n")


def family_files(gt, name):
    gt = Path(gt)
    main = gt / FAMILIES[name]
    arch = sorted((gt / "archive").glob(Path(FAMILIES[name]).stem + "-*.csv"))
    return main, arch


def snapshot(gt):
    out = {}
    for name in FAMILIES:
        main, arch = family_files(gt, name)
        if not main.exists() and not arch:
            continue
        header, rows, n_versions = "", 0, 0
        versions = set()
        for f in arch + ([main] if main.exists() else []):
            h, body, _, _ = read(f)
            header = h or header
            rows += len(body)
            if name == "alerts" and h:
                i = h.split(",").index("version") if "version" in h.split(",") else None
                versions |= {r[i] for r in body if i is not None and len(r) > i}
        out[name] = {"header": header, "rows": rows, "versions": len(versions),
                     "archives": {f.name: f.stat().st_size for f in arch}}
    return out


def verify(gt, before):
    """-> list of problems (empty = safe to push)."""
    now, problems = snapshot(gt), []
    for name, b in before.items():
        a = now.get(name)
        if a is None:
            problems.append(f"{name}: the file is gone (had {b['rows']} rows)")
            continue
        if b["header"] and a["header"] != b["header"]:
            problems.append(f"{name}: the header changed")
        if name == "alerts":
            if a["versions"] < b["versions"]:
                problems.append(f"alerts: {b['versions'] - a['versions']} alert version(s) lost ({b['versions']} -> {a['versions']})")
        elif a["rows"] < b["rows"]:
            problems.append(f"{name}: {b['rows'] - a['rows']} row(s) lost ({b['rows']} -> {a['rows']})")
        for f, size in b["archives"].items():
            if a["archives"].get(f) != size:
                problems.append(f"{name}: archive/{f} changed or vanished (archives are never rewritten)")
    for name in now:
        main, arch = family_files(gt, name)
        for f in ([main] if main.exists() else []) + arch:
            _, _, bad, nl = read(f)
            if name in STRICT_COLUMNS and bad:
                problems.append(f"{f.name}: {bad} line(s) with the wrong number of columns")
            if f.stat().st_size and not nl:
                problems.append(f"{f.name}: does not end with a newline (cut short?)")
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("snapshot")
    s.add_argument("dir")
    v = sub.add_parser("verify")
    v.add_argument("dir")
    v.add_argument("--before", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "snapshot":
        print(json.dumps(snapshot(a.dir)))
        return 0
    before = json.loads(Path(a.before).read_text(encoding="utf-8") or "{}")
    problems = verify(a.dir, before)
    after = snapshot(a.dir)
    for name, x in after.items():
        print(f"check_merge: {name} {before.get(name, {}).get('rows', 0)} -> {x['rows']} rows")
    for p in problems:
        print(f"check_merge: PROBLEM {p}")
    print("check_merge: ok, no rows lost" if not problems else "check_merge: NOT SAFE TO PUSH")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

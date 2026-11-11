#!/usr/bin/env python3
"""E32c: before / after tables of a display rule change, per line, from two measure.py summaries of the same days.

Both summaries must come from the same inputs.py work folder and arrivals.csv (only the web code differs: replay.py
--web <copy> for a variant, or the repo at two commits). Only the shipped app (`new`) is compared; each cell is
"before -> after".

  python experiments/routeknower/E32-scripts/compare.py --before <dir>/summary.json --after <dir>/summary.json
      [--period all] [--lines 5704,6126] [--title "..."]
"""
import argparse, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import report as R   # noqa: E402  (rates per line, route names)

COLS = [  # header, rates key, kind
    ("ghost times %", "ghost_time_pct", "pct"),
    ("ghost next bus %", "ghost_next_pct", "pct"),
    ("ghost badges %", "ghost_badge_pct", "pct"),
    ("false hides min (% of hidden)", ("false_hide_min", "false_hide_pct"), "minpct"),
    ("hidden min", "hide_min", "n"),
    ("risky legs %", "plan_risky_pct", "pct"),
    ("number swaps per 10 h", "num_swap_per_10h", "pct"),
    ("number gaps min", "num_gap_min", "n"),
    ("shown after a leave, avg min", "leave_shown_avg", "pct"),
    ("times back after a hide, min", "reshown_time_min", "n"),
    ("transitioning min (coming to serve)", ("trans_min", "trans_served_min"), "pair"),
]


def cell(a, b, key, kind):
    if kind == "pair":
        (k1, k2) = key
        f = lambda r: f"{r.get(k1, 0)} ({r.get(k2, 0)})"
        return f(a) if f(a) == f(b) else f"{f(a)} -> {f(b)}"
    if kind == "minpct":
        (k1, k2) = key
        f = lambda r: f"{r[k1]} ({'' if r[k2] is None else r[k2]})"
        return f"{f(a)} -> {f(b)}"
    x, y = a.get(key), b.get(key)
    s = lambda v: "" if v is None else (f"{v:,}" if isinstance(v, int) else str(v))
    return s(x) if x == y else f"{s(x)} -> {s(y)}"


def table(TA, TB, per, lines=None, title=""):
    A, B = TA[per], TB[per]
    if A["days"] != B["days"]:
        raise SystemExit(f"{per}: the two summaries cover different days")
    out = [f"\n{title}{per}: {A['days'][0]} to {A['days'][-1]} ({len(A['days'])} days), shipped app, before -> after\n",
           "| Line | " + " | ".join(c[0] for c in COLS) + " |", "|---|" + "---|" * len(COLS)]
    rows = sorted(A["lines"], key=lambda r: -(A["lines"][r]["new"]["service_h"] or 0))
    for rid in [r for r in rows if not lines or r in lines] + ["all"]:
        a = A["all"]["new"] if rid == "all" else A["lines"][rid]["new"]
        b = B["all"]["new"] if rid == "all" else (B["lines"].get(rid) or {}).get("new")
        if not b or not a["service_h"]:
            continue
        out.append(f"| {'**all lines**' if rid == 'all' else R.name(rid)} | " + " | ".join(cell(a, b, c[1], c[2]) for c in COLS) + " |")
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--before", required=True)
    ap.add_argument("--after", required=True)
    ap.add_argument("--period", nargs="+", default=["all"])
    ap.add_argument("--lines", help="route ids to list (comma-separated); default every line")
    ap.add_argument("--title", default="")
    a = ap.parse_args(argv)
    TA = R.tables(json.loads(Path(a.before).read_text(encoding="utf-8")))
    TB = R.tables(json.loads(Path(a.after).read_text(encoding="utf-8")))
    lines = set(a.lines.split(",")) if a.lines else None
    for per in a.period:
        print(table(TA, TB, per, lines, a.title))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Markdown table of XCTest `measure` results from a `swift test` / `xcodebuild test` log.

  python3 ios/scripts/bench_summary.py kit-bench.log [--json out.json]

Reads lines like
  Test Case '-[StraightBussingKitTests.BenchmarkTests testDirectionsPlan]' measured [Time, seconds] average: 0.004,
  relative standard deviation: 3.1%, values: [0.004121, ...]
and prints one row per test: average and best of the measured runs in milliseconds (from `values`, which have more
digits than `average`), and the relative standard deviation. Used by .github/workflows/ios.yml for the run summary;
numbers are recorded in ios/README.md "Performance".
"""
import json
import re
import sys

LINE = re.compile(r"Test Case '-\[[\w.]+ (\w+)\]' measured \[([^\]]+)\] average: ([\d.]+), "
                  r"relative standard deviation: ([\d.]+)%, values: \[([^\]]*)\]")


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    out_json = None
    if "--json" in args:
        i = args.index("--json")
        out_json = args[i + 1]
        args = args[:i] + args[i + 2:]
    rows = {}
    with open(args[0], encoding="utf-8", errors="replace") as f:
        for line in f:
            m = LINE.search(line)
            if not m:
                continue
            name, metric, avg, rsd, values = m.groups()
            vals = [float(v) for v in values.split(",") if v.strip()]
            scale = 1000.0 if "seconds" in metric else 1.0
            mean = (sum(vals) / len(vals)) if vals else float(avg)
            rows[name] = {"metric": metric, "avg_ms": mean * scale, "min_ms": (min(vals) if vals else float(avg)) * scale,
                          "rsd": float(rsd), "runs": len(vals)}
    if not rows:
        print("no measured results in the log")
        return 0
    print("| Benchmark | avg ms | best ms | RSD | runs |")
    print("|---|---:|---:|---:|---:|")
    for name, r in rows.items():
        print(f"| {name.removeprefix('test')} | {r['avg_ms']:.3f} | {r['min_ms']:.3f} | {r['rsd']:.1f}% | {r['runs']} |")
    if out_json:
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())

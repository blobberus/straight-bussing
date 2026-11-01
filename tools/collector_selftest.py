#!/usr/bin/env python3
"""Pre-flight check of the collector code, run by every collect.yml run before it trusts main's tools/.

  python tools/collector_selftest.py            # exit 0 = this code can collect, 1 = it cannot (prints why)
  python tools/collector_selftest.py --quick    # imports and argument parsing only (about 1 s)

Every run checks out main and runs its tools/, so one bad push (a syntax error, a renamed function, a broken rule)
would stop collection at the next run while the job stays green: the logger logs nothing and nobody is told. The
workflow therefore runs this first; if it fails, the run collects with the last code that passed it and finished a
healthy run (the git tag collector-ok, moved forward by such runs) and raises a health alert (tools/health.py).

What it checks, all offline (no Passio, no GitHub): every module a run imports loads; the logger and merge scripts
parse their command lines; and the hermetic test suites of the parts a run depends on pass (detector and logger,
merges and the no-rows-lost guard, alerts, bus changes, the collect / idle gate, the self-chain, timetable versions,
health alerts). Takes about 15 s. Stdlib only.
"""
import argparse, importlib, os, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODULES = ["arrivals_lib", "arrival_detector", "truth_logger", "merge_arrivals", "merge_predictions", "merge_alerts",
           "alerts_lib", "bus_changes", "service_gate", "collect_chain", "build_gtfs", "raw_fetch", "check_merge",
           "gtfs_versions", "health"]
SCRIPTS = ["truth_logger.py", "merge_arrivals.py", "merge_predictions.py", "merge_alerts.py", "collect_chain.py",
           "check_merge.py", "gtfs_versions.py", "health.py"]
SUITES = ["test_truth.py", "test_merge.py", "test_alerts.py", "test_bus_changes.py", "test_gate.py", "test_chain.py",
          "test_gtfs_versions.py", "test_health.py"]


def check_imports():
    sys.path.insert(0, str(HERE))
    bad = []
    for m in MODULES:
        try:
            importlib.import_module(m)
        except Exception as ex:                      # SyntaxError, ImportError, a crash at import time
            bad.append(f"import {m}: {type(ex).__name__}: {str(ex)[:200]}")
    return bad


def run(args, timeout):
    t0 = time.time()
    # the suites must never touch the real job: no step outputs or summary, no annotations, no GitHub token
    env = {k: v for k, v in os.environ.items() if k not in
           ("GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY", "GITHUB_ENV", "GITHUB_ACTIONS", "GH_TOKEN", "GITHUB_TOKEN")}
    env["PYTHONHASHSEED"] = os.environ.get("PYTHONHASHSEED", "0")
    try:
        r = subprocess.run([sys.executable, *args], cwd=HERE.parent, capture_output=True, text=True, timeout=timeout,
                           env=env)
    except subprocess.TimeoutExpired:
        return False, f"timed out after {timeout} s", time.time() - t0
    tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
    return r.returncode == 0, " | ".join(tail)[:300], time.time() - t0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--quick", action="store_true", help="imports and argument parsing only")
    ap.add_argument("--timeout", type=float, default=120, help="seconds per test suite")
    a = ap.parse_args(argv)
    fails = check_imports()
    for s in SCRIPTS:
        ok, out, _ = run([f"tools/{s}", "--help"], 30)
        if not ok:
            fails.append(f"{s} --help: {out}")
    if not a.quick:
        for s in SUITES:
            if not (HERE / s).exists():
                fails.append(f"{s}: missing")
                continue
            ok, out, dt = run([f"tools/{s}"], a.timeout)
            print(f"{'ok  ' if ok else 'FAIL'} {s} ({dt:.1f} s): {out}", flush=True)
            if not ok:
                fails.append(f"{s}: {out}")
    for f in fails:
        print(f"selftest: {f}", flush=True)
    print("selftest: ok, this code can collect" if not fails else f"selftest: FAILED ({len(fails)} problem(s))")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

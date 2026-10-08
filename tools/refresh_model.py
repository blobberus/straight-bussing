#!/usr/bin/env python3
"""Refit the segment model from ground truth and (re)write web/data/learned.json. Idempotent.

  python tools/refresh_model.py                    # real data/ground_truth/arrivals.csv (>= 200 rows)
  python tools/refresh_model.py --synthetic        # exercise on synthetic data; writes a TEMP file only
  python tools/refresh_model.py --synthetic --allow-synthetic   # really write synthetic learned.json (dev only)
  python tools/refresh_model.py --backtest         # also regenerate docs/BACKTEST.md from the same data
Never writes learned.json from synthetic data unless --allow-synthetic. Rewrites the file only when
the model content changed (the 'generated' timestamp alone does not count). Always exits 0 when
there is simply not enough data, so the hourly workflow (.github/workflows/collect.yml) keeps going."""
import argparse, json, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import model_core as C
from model_segments import Corrector, SegmentModel, export_learned, fit_bias, tune_k

LEARNED = C.WEB_DATA / "learned.json"
MIN_USABLE = 100


def _content(d):
    """Model content without volatile fields, for the idempotency comparison."""
    return {k: v for k, v in (d or {}).items() if k != "generated"}


def build(rows, kind, route_stops, k=None):
    """Fit everything on ALL rows (the backtest is where held-out scoring happens) -> learned dict."""
    k = k if k is not None else tune_k(rows)[0]
    m = SegmentModel(k).fit(rows)
    corr = Corrector().fit(m, rows)
    from backtest import scale_by_cv            # interval width calibrated out of sample
    return export_learned(m, route_stops, None, corr=corr, kind=kind, bias=fit_bias(rows),
                          scale=scale_by_cv(rows, k))


def write_if_changed(out, path):
    path = Path(path)
    try:
        old = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        old = None
    if old is not None and _content(old) == _content(out):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    return True


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", help="explicit CSV (treated as synthetic if its name contains 'synth')")
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--allow-synthetic", action="store_true", help="permit writing web/data/learned.json from synthetic")
    ap.add_argument("--out", help="output path (default web/data/learned.json; temp file for synthetic)")
    ap.add_argument("--min-rows", type=int, default=C.MIN_REAL_ROWS)
    ap.add_argument("--k", type=float, help="fixed shrinkage k (default: rolling-origin CV)")
    ap.add_argument("--backtest", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    if a.synthetic:
        path, kind = (C.SYNTH_CSV, "synthetic") if C.SYNTH_CSV.exists() else (None, None)
    elif a.data:
        path, kind = C.find_data(a.data)
    else:
        n_real = C.count_rows(C.REAL_CSV)
        if n_real < a.min_rows:
            print(f"not enough data yet: {n_real} real rows in data/ground_truth/arrivals.csv "
                  f"(need {a.min_rows}). learned.json left untouched.")
            return 0
        path, kind = C.REAL_CSV, "real"
    if not path:
        print("not enough data yet: no input CSV found. learned.json left untouched.")
        return 0
    rows = C.load_rows(path)
    if len(rows) < MIN_USABLE:
        print(f"not enough data yet: {len(rows)} usable segment rows in {path.name} (need {MIN_USABLE}).")
        return 0

    if a.out:
        out_path = Path(a.out)
    elif kind == "synthetic" and not a.allow_synthetic:
        out_path = Path(tempfile.gettempdir()) / "sb_learned_synthetic.json"
    else:
        out_path = LEARNED
    if kind == "synthetic" and not a.allow_synthetic and out_path.resolve() == LEARNED.resolve():
        print("refusing to write web/data/learned.json from SYNTHETIC data (pass --allow-synthetic for dev use)")
        return 2

    route_stops = json.loads((C.WEB_DATA / "route_stops.json").read_text(encoding="utf-8"))
    out = build(rows, kind, route_stops, a.k)
    nb = sum(len(r["s"]) for r in out["routes"].values())
    print(f"{kind} data {path.name}: {len(rows)} usable rows over {out['span_days']} days; k={out['k']}; "
          f"{nb} segments, {out['n_how']} hour-of-week buckets; harmonic mean speed {out['vg']} m/s; "
          f"Passio bias for {len(out.get('bias', {}))} routes")
    if a.dry_run:
        print("dry run: nothing written")
    elif write_if_changed(out, out_path):
        print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")
    else:
        print(f"{out_path} unchanged")
    if kind == "synthetic":
        print("NOTE: synthetic data proves the pipeline, not real-world accuracy.")
    if a.backtest:
        import backtest
        backtest.main((["--synthetic"] if a.synthetic else (["--data", str(path)] if a.data else [])))
    return 0


if __name__ == "__main__":
    sys.exit(main())

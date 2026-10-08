#!/usr/bin/env python3
"""Compatibility entry point: refit the learned model and write web/data/learned.json.

  python tools/learn.py [refresh_model options]       # = python tools/refresh_model.py ...
  python tools/learn.py --legacy-obs [--obs DIR] [--out FILE]   # old v1 path from raw observations

The v2 pipeline learns from data/ground_truth/arrivals.csv (tools/truth_logger.py) with the
hierarchical model in tools/model_segments.py; see docs/ALGORITHMS.md. The legacy path (v1 schema,
from data/observations/*.jsonl.gz via obslib) is kept only for old local logs."""
import argparse, json, statistics, sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))


def fit_bias(events, preds):
    """Per-route multiplicative bias of Passio ETAs (actual remaining / predicted remaining)."""
    actual = {}
    for (_v, tr), t in events.items():
        for s, ts in t["ev"]:
            actual.setdefault((tr, s), ts)
    ratios = defaultdict(list)
    for poll_t, tr, r, plist in preds:
        for _q, s, p in plist:
            a = actual.get((tr, s))
            if a is None or p - poll_t < 120 or p - poll_t > 1200 or a - poll_t < 30:
                continue
            ratios[r].append((a - poll_t) / (p - poll_t))
    return {r: {"m": round(statistics.median(v), 3), "a": 0, "n": len(v)}
            for r, v in ratios.items() if len(v) >= 30 and 0.5 <= statistics.median(v) <= 2}


def legacy(obs_dir, out_path, min_samples=200):
    import obslib as L
    stops = L.load_json(L.WEB_DATA / "stops.json", {}) or {}
    rs = L.load_json(L.WEB_DATA / "route_stops.json", {}) or {}
    seg = (L.load_json(L.WEB_DATA / "segments.json", {}) or {}).get("routes", {})
    obs = list(L.load_obs(obs_dir))
    if not obs or not stops or not rs:
        print("not enough data yet (no observations found in %s)" % obs_dir)
        return None
    events = L.extract_events(obs, stops, rs)
    samples = L.segment_samples(events, rs, seg)
    print(f"{len(obs)} observation lines, {len(events)} vehicle-trips, {len(samples)} segment samples")
    if len(samples) < min_samples:
        print(f"not enough data yet (need >= {min_samples} segment samples)")
        return None
    ts = [s[3] for s in samples]
    model = {"v": 1, "k": L.K_SHRINK, "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
             "span_days": round((max(ts) - min(ts)) / 86400, 2), "n": len(samples), "routes": L.build_model(samples)}
    bias = fit_bias(events, L.predictions(obs))
    if bias:
        model["bias"] = bias
    Path(out_path).write_text(json.dumps(model, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out_path}")
    return model


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--legacy-obs" in argv:
        argv.remove("--legacy-obs")
        root = Path(__file__).resolve().parent.parent
        ap = argparse.ArgumentParser()
        ap.add_argument("--obs", default=str(root / "data" / "observations"))
        ap.add_argument("--out", default=str(root / "web" / "data" / "learned.json"))
        ap.add_argument("--min-samples", type=int, default=200)
        a = ap.parse_args(argv)
        legacy(a.obs, a.out, a.min_samples)
        return 0
    import refresh_model
    return refresh_model.main(argv)


if __name__ == "__main__":
    sys.exit(main())

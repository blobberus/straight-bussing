#!/usr/bin/env python3
"""Derive actual stop arrivals + segment times from data/observations and write web/data/learned.json.

  python tools/learn.py [--obs data/observations] [--out web/data/learned.json]
Method and schema: docs/LEARNING.md. Safe on tiny data (prints 'not enough data yet')."""
import argparse, json, statistics, sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import obslib as L


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


def run(obs_dir, out_path, quiet=False, min_samples=10):
    say = (lambda *a: None) if quiet else print
    stops = L.load_json(L.WEB_DATA / "stops.json", {}) or {}
    rs = L.load_json(L.WEB_DATA / "route_stops.json", {}) or {}
    seg = (L.load_json(L.WEB_DATA / "segments.json", {}) or {}).get("routes", {})
    obs = list(L.load_obs(obs_dir))
    if not obs or not stops or not rs:
        say("not enough data yet (no observations found in %s)" % obs_dir)
        return None
    events = L.extract_events(obs, stops, rs)
    samples = L.segment_samples(events, rs, seg)
    n_ev = sum(len(t["ev"]) for t in events.values())
    say(f"{len(obs)} observation lines, {len(events)} vehicle-trips, {n_ev} stop arrivals, {len(samples)} segment samples")
    if len(samples) < min_samples:
        say(f"not enough data yet (need >= {min_samples} segment samples; collect for a few days)")
        return None
    ts = [s[3] for s in samples]
    model = {"v": 1, "k": L.K_SHRINK,
             "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
             "span_days": round((max(ts) - min(ts)) / 86400, 2), "n": len(samples),
             "routes": L.build_model(samples)}
    bias = fit_bias(events, L.predictions(obs))
    if bias:
        model["bias"] = bias
    out_path = Path(out_path)
    out_path.write_text(json.dumps(model, separators=(",", ":")), encoding="utf-8")
    say(f"wrote {out_path} ({out_path.stat().st_size} bytes)")
    return model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--obs", default=str(L.ROOT / "data" / "observations"))
    ap.add_argument("--out", default=str(L.WEB_DATA / "learned.json"))
    ap.add_argument("--min-samples", type=int, default=10)
    a = ap.parse_args()
    run(a.obs, a.out, min_samples=a.min_samples)


if __name__ == "__main__":
    main()

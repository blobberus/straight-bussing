# Backtest results

> **SYNTHETIC DATA.** These numbers prove the code runs end to end and that the models recover
> structure that was deliberately built into a simulator. They say NOTHING about accuracy on real
> UChicago shuttles. Re-run `python tools/backtest.py` once >= 200 real rows exist.
> The Passio column is only as meaningful as the simulator's fake Passio:
> `tools/make_synthetic_truth.py` derives it from the TRUE arrival time plus noise (an oracle that
> no real predictor can match), `tools/model_synth.py` from the schedule plus lead-dependent noise.

Generated 2026-10-08 03:40 UTC by `tools/backtest.py`. Errors are prediction minus actual; MAE/RMSE in seconds. Method definitions: docs/ALGORITHMS.md.

Data: `data/ground_truth/synthetic_arrivals.csv` (synthetic). 16541 usable segment rows, 4 routes, 26 segments, 2026-09-07 to 2026-09-28. Train = earliest 70% (11578 rows), test = latest 30% (4963 rows) from 2026-09-21 21:29 UTC.

## Shrinkage strength k (rolling-origin CV inside the training period)

| k | 0.5 | 1 | 2 | 5 | 10 | 20 | 50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| run-time MAE s | 21.28 | 20.74 | 20.22 | 19.86 | 19.78 | 19.82 | 20.02 |

Chosen k = 10. Interval width multipliers, calibrated out of sample inside the training period: segment 1.43, arrival 1.14. EWMA gains g = [0.054, -0.022, 0.215], carry-over phi = 0.09.

## (A) Segment time, 70/30 time split

| method | MAE s | RMSE s | MAPE % | 80% coverage | pinball s | n |
|---|---:|---:|---:|---:|---:|---:|
| schedule | 70.0 | 119.6 | 51.4 | - | - | 4963 |
| global median | 124.8 | 284.0 | 89.8 | - | - | 4963 |
| segment-hour median | 22.9 | 43.5 | 15.9 | - | - | 4963 |
| shrunk hierarchy | 21.2 | 39.3 | 14.6 | 80% | 6.9 | 4963 |
| shrunk + EWMA | 21.0 | 39.3 | 14.6 | 80% | 6.9 | 4963 |

Deepest hierarchy level with >= 20 samples used for test predictions: segment-daypart 4732, segment 227, route-daypart 4.

## (B) Arrival time at Passio's lead (same information time for every method)

Query time q = actual arrival - Passio lead. Ours = last arrival the bus had logged by q + predicted
segments (clamped to >= q). Interval: Fenton-Wilkinson sum of log-normals with correlation rho = phi,
width calibrated on the training period. Passio is only scored on these same rows.

| lead | Passio MAE s | schedule MAE s | shrunk hierarchy MAE s | shrunk + EWMA MAE s | EWMA 80% cov | n |
|---|---:|---:|---:|---:|---:|---:|
| 2-5 min | 14.4 | 111.3 | 34.1 | 33.8 | 78% | 1170 |
| 5-10 min | 25.6 | 154.6 | 56.0 | 55.8 | 82% | 822 |
| 10-20 min | 56.3 | 204.9 | 106.4 | 107.3 | 78% | 254 |

## (C) Rolling origin (4 expanding folds, models refit and k re-tuned per fold)

| method | fold 1 MAE s | fold 2 MAE s | fold 3 MAE s | fold 4 MAE s | mean |
|---|---:|---:|---:|---:|---:|
| schedule | 70.2 | 68.5 | 71.0 | 69.1 | 69.7 |
| global median | 124.3 | 124.7 | 123.6 | 126.0 | 124.7 |
| segment-hour median | 23.1 | 22.9 | 22.9 | 22.8 | 22.9 |
| shrunk hierarchy | 21.5 | 21.3 | 21.2 | 21.1 | 21.3 |
| shrunk + EWMA | 21.4 | 21.2 | 20.9 | 21.2 | 21.2 |

## Second dataset: `model_synth.csv` (synthetic)

Different simulator: stronger AR(1) trip delay (so carry-over matters) and a Passio that does
not see the future. Rolling origin skipped. Regenerate: `python tools/model_synth.py --out X.csv`.

Data: `model_synth.csv` (synthetic). 42000 usable segment rows, 4 routes, 50 segments, 2026-09-01 to 2026-09-15. Train = earliest 70% (29399 rows), test = latest 30% (12601 rows) from 2026-09-10 23:36 UTC.

### Shrinkage strength k (rolling-origin CV inside the training period)

| k | 0.5 | 1 | 2 | 5 | 10 | 20 | 50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| run-time MAE s | 12.09 | 12.03 | 12.00 | 12.08 | 12.25 | 12.50 | 12.95 |

Chosen k = 2. Interval width multipliers, calibrated out of sample inside the training period: segment 1.53, arrival 1.41. EWMA gains g = [-0.2, 0.292, 0.089], carry-over phi = 0.23.

### (A) Segment time, 70/30 time split

| method | MAE s | RMSE s | MAPE % | 80% coverage | pinball s | n |
|---|---:|---:|---:|---:|---:|---:|
| schedule | 34.0 | 57.3 | 36.9 | - | - | 12601 |
| global median | 34.0 | 47.7 | 45.1 | - | - | 12601 |
| segment-hour median | 11.2 | 15.7 | 13.2 | - | - | 12601 |
| shrunk hierarchy | 10.7 | 14.9 | 12.6 | 74% | 3.5 | 12601 |
| shrunk + EWMA | 10.5 | 14.6 | 12.4 | 74% | 3.5 | 12601 |

Deepest hierarchy level with >= 20 samples used for test predictions: segment-daypart 12601.

### (B) Arrival time at Passio's lead (same information time for every method)

Query time q = actual arrival - Passio lead. Ours = last arrival the bus had logged by q + predicted
segments (clamped to >= q). Interval: Fenton-Wilkinson sum of log-normals with correlation rho = phi,
width calibrated on the training period. Passio is only scored on these same rows.

| lead | Passio MAE s | schedule MAE s | shrunk hierarchy MAE s | shrunk + EWMA MAE s | EWMA 80% cov | n |
|---|---:|---:|---:|---:|---:|---:|
| 2-5 min | 26.7 | 74.2 | 19.1 | 18.8 | 79% | 3657 |
| 5-10 min | 46.2 | 121.6 | 29.0 | 28.4 | 85% | 2916 |
| 10-20 min | 92.5 | 209.6 | 46.0 | 46.1 | 88% | 1262 |

## Live-bus Kalman filter (simulation, `python tools/model_kalman.py`)

Position error: filtered 10.1 m vs raw GPS 19.7 m. ETA MAE: constant-velocity extrapolation 223 s, filtered position + learned speed 12.0 s, raw GPS + learned speed 11.5 s. Lesson: the filter cleans position and rejects GPS jumps; the ETA must come from learned segment speeds, not from the instantaneous velocity.

## How to read this

- (A) isolates the travel-time model; (B) is what a rider feels and is the fair comparison with Passio.
- Coverage should be near 80%; pinball loss rewards sharp AND calibrated quantiles (lower is better).
- Schedule rows are only those whose stop pair exists in `web/data/route_stops.json`.
- Reproduce: `python tools/backtest.py --synthetic --also <model_synth csv>`.

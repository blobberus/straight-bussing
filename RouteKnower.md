# RouteKnower: experiment plan for learning bus driving and station arrival times

> **What this is.** The single plan for turning the ground-truth arrivals we collect into a model that
> predicts (1) how long a shuttle takes to drive between stations and (2) when it will reach a station,
> and for **proving** each step with tests before it reaches riders. Written for Nathan and for any
> Claude agent. Agents: read this whole file before running an experiment, follow **§10 Agent
> protocol**, and log every result in **§11**.
>
> Status: **collecting data; pilot run done (E00).** Created 2026-10-08. Ship target: **before
> December 2026** (see §8). Improving the data and the model is an ongoing project that continues
> after shipping.

Related files (read, don't duplicate): `docs/DATA.md` (CSV schema, detector), `docs/ALGORITHMS.md`
(math of the existing models), `docs/BACKTEST.md` (latest backtest report), `docs/LEARNING.md` (older
plan), `monitoring.md` (keeping the collector alive), `web/js/core/predict.js` (how the app reads a model).

---

## 0. Summary

- **Collection:** about 180 arrivals per service hour, so roughly 3,500 a day once the night routes
  are counted. A clean 4-week dataset exists around **Nov 5**; that is the earliest honest "ship"
  evaluation.
- **Models already built:** the strongest candidates exist as stdlib Python in `tools/model_*.py`
  and `tools/backtest.py`. RouteKnower is mostly about **testing them on real data, adding a few cheap
  methods** (§5: M2, M5, M10, M11), and **wiring a winner into the live site** (§9).
- **The live site ignores the learned model today.** Pages builds from `main`, but `learned.json` only
  lives on the `data` branch. The app falls back to GTFS schedule times for ride estimates. Shipping a
  model is a deliberate, gated step (§9).
- **The app does not wait on the model.** It already works with Passio and the schedule. If no model
  passes the ship gate (§6.6) by Nov 13, ship without it and keep improving.

## 1. What we are predicting

| ID | Quantity | Who uses it | Where in the app |
|---|---|---|---|
| Q1 | **Segment run time** x: driving time from station a to the next station b (dwell removed) | building block | `predict.rideMinutes` |
| Q2 | **Dwell** w: time stopped at a station | building block | added between segments |
| Q3 | **Arrival time at a station** at lead L (L = how far ahead the prediction is made) | riders: "bus in 4 min" | Plan Trip / stop ETAs (Passio today) |
| Q4 | **Wait time / next-bus probability** at a station when no live prediction exists | riders arriving at a stop | Plan Trip, planner wait |
| Q5 | **Ride time A to B** = sum of x and w along the route | trip planner totals | Directions option cards |
| Q6 | **Uncertainty**: p10 / p50 / p90 of each of the above | honest "4 to 7 min" ranges | estimate labels |

Riders feel Q3, Q4 and Q5. Q1 and Q2 matter only through them. A good Q1 score with a bad Q3 score is not a win.

## 2. What already exists (do not rebuild)

| Piece | File | State |
|---|---|---|
| Arrival detector (+-10 s) | `tools/arrival_detector.py`, `tools/truth_logger.py` | live, collecting |
| Collection (CI every 30 min + local stopgap) | `.github/workflows/collect.yml`, `tools/monitor.py` | live (see `monitoring.md`) |
| Clean segment rows (drops layovers > 30 min, GPS glitches) | `tools/model_core.py` `load_rows` | done |
| Hierarchical shrunk medians (global, route-daypart, segment, segment-daypart, segment-hour-of-week) | `tools/model_segments.py` `SegmentModel` | done, synthetic-tested |
| Same-day EWMA + trip carry-over correction | `model_segments.Corrector` | done, synthetic-tested |
| Log-normal intervals + calibration + Fenton sum | `tools/model_quantile.py` | done |
| Kalman filter on along-route position | `tools/model_kalman.py` | simulation only |
| Time-ordered backtest (70/30, rolling origin, same information time as Passio) | `tools/backtest.py` | done; writes `docs/BACKTEST.md` |
| Model export to the app | `tools/refresh_model.py` -> `web/data/learned.json` (on `data` branch) | runs in CI; **not deployed to the site** |
| App reader | `web/js/core/predict.js` (shrinks learned toward schedule) | done |

## 3. The data

Schema: `docs/DATA.md`. One row = one bus arriving at one station. Get the latest snapshot:
```
cd /c/Users/billy/Documents/straight-bussing      # or your clone
git fetch -q origin data
MSYS_NO_PATHCONV=1 git show origin/data:data/ground_truth/arrivals.csv > "$TEMP/rk/arrivals.csv"
python tools/truth_stats.py "$TEMP/rk/arrivals.csv"
```

### 3.1 State on 2026-10-08 (first real day, 04:59 to 15:12)
- 1,854 rows: 181 rows per service hour, 222 bytes per row.
- 145 of 155 route segments seen. Median 14 samples per segment (p10 1, p90 21), so about **1.4 samples per
  segment per service hour**.
- 8 of 14 routes seen. **Not yet seen:** North / South / East / Central (night routes, 4 PM to 4:30 AM
  daily), Regents Express (5:20 to 9 PM), South Loop Shuttle (Saturday only).
- Passio predictions attached to 1,792 rows: median lead 155 s, median |error| 62 s, mean error
  -32.6 s (buses arrive earlier than Passio says, on average).
- 91% of rows have `segment_s`; 0 rows without a stop; 2 exact duplicates got past the merge.

### 3.2 Expected volume (estimates; recheck weekly with `truth_stats.py`)

Each trip passes each segment once, so **samples per segment per day ≈ trips per day x ~0.9** (detector hit rate).

| Route (weekday) | Service hours | Trips | Trips per hour | Samples per hour-of-week bucket per week |
|---|---:|---:|---:|---:|
| Red Line/Arts Block | 14.8 | 77 | 5.2 | ~5 |
| Apostolic/Drexel | 14.9 | 78 | 5.2 | ~5 |
| Midway Metra | 13.2 | 46 | 3.5 | ~3 |
| North / South / East (daily) | 12.5 | 39 | 3.1 | ~3 |
| 53rd Street Express | 12.4 | 29 | 2.3 | ~2 |
| Downtown Campus Connector | 17.9 | 38 | 2.1 | ~2 |
| Friend Center/Metra (daily) | 15.9 | 32 | 2.0 | ~2 |
| Drexel / Apostolic (5 to 10:30 AM) | ~5.3 | 31 | ~6 | ~5 |
| Regents Express | 3.7 | 9 | 2.4 | ~2 |

Source: `web/data/service.json` (Wednesday column; GTFS feed window 2026-10-07 to 2026-11-07, so recheck after it renews).
Totals: about 3,500 rows a day, about 25k a week, about 0.8 MB a day. The CSV rotates to `archive/` at 40 MB, every 6 to 7 weeks.

### 3.3 Data quality issues to fix first (they hurt every model)
1. **Downtown Campus Connector**: 46 distinct (prev, stop) pairs seen but median n = 2. That probably means skipped
   stops are creating non-adjacent pairs, or the route has variants. Check `route_stops.json` against the live trips (E01).
2. **Heavy tails**: pilot RMSE (~270 s) is about 3x MAE. Layovers, trip-id flips at terminals and detours
   under the 30-minute cut still pollute segment times. Look at the worst 2% (E01).
3. **Duplicates**: 2 exact duplicates passed `merge_arrivals.py`. Find which rule missed them.
4. **Passio outliers**: 5 to 10 minute lead had MAE 1,973 s on n = 10. That is almost surely a trip/terminal matching
   issue, not Passio being 30 minutes wrong. Fix before any Passio comparison is trusted.
5. **Detector truth check**: the +-10 s claim comes from simulation. Validate it in the field: one
   person at one stop logs 20+ real arrivals with a phone clock, then compares (E02).
6. **Raw positions are not stored.** Only arrivals are kept, so the Kalman filter (M8) and any
   live-position method cannot be tested on real data. Fix: keep raw `vehiclePositions` +
   `tripUpdates` polls (`tools/collect.py` format, ~10-15 MB/day gzip) as a **GitHub Actions artifact**
   (90-day retention, no git bloat) or on the local PC (E03).

## 4. How much data: targets

The rule behind every target: a bucket needs **n >= 20** samples to be trusted on its own (`min_n` in the
hierarchy). With n >= 5 it can be exported, but it is shrunk heavily toward its parent. Evaluation needs
**at least 10 separate service days in the test window**, because whole days are the unit of noise (weather, events).

| Tier | Definition (all must hold) | Calendar time | Expected | Unlocks |
|---|---|---|---|---|
| **T0 Pilot** | >= 200 real rows | 1 day | **done 2026-10-08** | code runs on real data (E00) |
| **T1 Minimum** | every running segment n >= 50; weekday segment x daypart n >= 20 for 80% of buckets; 2 weekends incl. night routes | 2 weeks | ~Oct 22 | M2, M3 at daypart level, M5, M11; first weekly report |
| **T2 Ship** | 4 full weeks (20 weekdays, 8 weekend days); weekday-hour buckets (Mon-Fri pooled per hour) n >= 20 for 80% of (segment, hour) with service; holdout of >= 10 days | 4-5 weeks | **~Nov 5 to Nov 12** | ship-gate evaluation (§6.6), M6, M10, intervals |
| **T3 Good** | 8-10 weeks incl. Thanksgiving week and finals week (both tagged); hour-of-week n >= 20 for most buckets | to mid-Dec | ~Dec 15 | M9 trial, calendar features, regime-specific models |
| **T4 Ideal** | a full academic year: 3 quarters + breaks + summer; >= 2 occurrences of every calendar regime; weather joined | 12 months | ~Oct 2027 | seasonal/weather effects, stable per-regime models |

Ongoing beyond T4: **never stop collecting.** Train on a rolling window (e.g. the last 8 weeks weighted up,
plus all calendar-matched history), because routes, roads and schedules drift. GTFS changes (new stops,
rerouted lines) restart the affected segments at T0.

Why hour-of-week takes so long: a route with 2-5 trips an hour puts only 2-5 samples a week into each
of the 168 hour-of-week buckets. Pooling weekdays (24 buckets) gets 10-25 a week, and that is what makes T2 reachable by November.

## 5. Candidate methods

Effort: S = hours, M = a day or two, L = a week. "Data" is the tier from §4 the method needs before testing.

| ID | Method | Predicts | Data | Status | Effort |
|---|---|---|---|---|---|
| M0 | **Schedule** (GTFS segment seconds; intermediate stops interpolated) | Q1, Q5 | none | baseline, in app | - |
| M1 | **Passio raw** ETA from `tripUpdates` | Q3 | none | baseline, in app | - |
| M2 | **Passio bias correction**: multiply or shift Passio's remaining time by a factor per route x lead bin x daypart | Q3 | T1 | partial (`bias` in learned.json) | S |
| M3 | **Hierarchical shrunk medians** with log-normal spread | Q1, Q2, Q5, Q6 | T1 (daypart) / T2 (hour) | built | - |
| M4 | M3 + **same-day EWMA + trip carry-over** | Q1, Q3 | T1 | built; no gain in pilot | - |
| M5 | **Previous-bus predictor**: the last bus's run time over the same segment, weighted by how recent it is (exp(-age/τ)), blended with M3 | Q1, Q3 | T1 | new | S |
| M6 | **Historical analog (kNN trips)**: match this trip's segments so far + time of week to past trips; predict the rest from the neighbours' remaining times | Q3, Q5 | T2 | new | M |
| M7 | **Dwell model**: station x hour x class-change window (:50 to :10) x terminal flag | Q2 | T1 | new (M3 has median dwell only) | S-M |
| M8 | **Kalman live position** + learned speeds beyond the next stop | Q3 at short lead | raw positions (E03) | simulation only | M |
| M9 | **Gradient-boosted quantile trees** (p10/p50/p90 on log x; features in `docs/ALGORITHMS.md` §11), exported as lookup tables | Q1, Q3, Q6 | T3 | new | L |
| M10 | **Stacked blend**: w(lead, route) x Passio + (1 - w) x ours, weights fit by least squares on the training period | Q3 | T2 | new | S |
| M11 | **Headway / wait model**: distribution of gaps between consecutive arrivals at a station, per route x hour; P(next bus within N min) and bunching rate | Q4 | T1 | new | S |
| M12 | **Split-conformal intervals** on residuals by lead bin (instead of a log-normal calibration multiplier) | Q6 | T2 | new | S |

Notes and priors:
- **M10 is the most likely ship candidate.** Passio sees each bus's live position; we see history. Blends
  usually beat both on their own, and M10 works when either input is missing.
- **M5 is cheap and robust** on congested days (a slow road stays slow for the next bus). Try it before M6.
- **M11 is the only method for Q4.** It also improves the planner's "headway estimate" wait.
- **M9 waits for T3.** With little data, trees overfit what the shrinkage hierarchy already captures.
  Adopt it only if it beats M3/M10 in rolling-origin tests. Running it offline may need pip packages
  (scikit-learn / LightGBM) in a local venv; the shipped artifact must stay a JSON lookup table (the app is build-free).
- Every method must use only information available at prediction time (§6.2).

## 6. How to test (the protocol)

Formulas and the existing backtest are in `docs/ALGORITHMS.md` §9. RouteKnower adds the rider-facing metrics,
significance tests and ship gate below.

### 6.1 Splits
- **Time order only.** Never shuffle. Train on earlier days and test on later ones.
- **Main split:** whole days. Hold out the last 30% of service days, or at least 10 days.
- **Rolling origin:** expanding window, one week per fold, at least 3 folds. Refit and re-tune everything per fold.
- Report weekday and weekend separately; they run different routes.

### 6.2 Information-time rules (leakage checklist; every experiment ticks each)
- [ ] The prediction for an arrival at time A with lead L uses only rows with `epoch` <= A - L.
- [ ] No feature built from the whole day or the whole test period (e.g. "today's mean").
- [ ] Hyperparameters (k, τ, blend weights, calibration) are fit inside the training period only.
- [ ] Segments are joined by **(route, prev_stop_id, stop_id)**, not by index alone, because GTFS refreshes shift indexes.
- [ ] Synthetic rows (trip ids starting `syn`) and `synthetic_arrivals.csv` are excluded.
- [ ] Duplicates are removed before splitting.

### 6.3 Metrics
| Metric | For | Target direction |
|---|---|---|
| MAE, median AE, p90 AE (seconds) | Q1, Q3, Q5 | lower |
| **Within +-1 min / +-2 min rate** at lead bins 0-2, 2-5, 5-10, 10-20 min | Q3 (what riders feel) | higher |
| **Early-miss rate**: share where the bus arrives > 60 s *before* the predicted time | Q3, Q5 | lower; counts double, because an early bus means a missed bus |
| Pinball loss at τ = 0.1/0.5/0.9 | Q6 | lower |
| 80% interval coverage | Q6 | 75-85% |
| **Planner miss rate**: replay planned trips; share where the rider arrives at the boarding stop after the bus actually left | Q5 + walking | lower |
| Log score of P(next bus within N min) / Brier score | Q4 | lower |

### 6.4 Slices (report all; a model that wins on average but loses badly on a slice is not shipped)
Route; daypart; weekday/weekend; lead bin; segment length (< 60 s, 60-180 s, > 180 s); timepoint vs
interpolated schedule stop; calendar regime (class day / finals / break / holiday, from `data/calendar.json`, E04); later, weather (rain/snow).

### 6.5 Significance
Compare methods on the **same rows**. For each test day, compute the per-day MAE difference
(candidate - baseline). Bootstrap over **days** (block bootstrap, 2,000 resamples) for a 95% interval. A win needs the whole interval below 0.
Fewer than 10 test days means the result is "inconclusive" no matter how big the gap looks.

### 6.6 Ship gate (all must hold, measured at T2 or later)
For **ride times in the planner** (replace the schedule fallback in `predict.rideMinutes`):
1. Ride-time MAE at least 20% better than M0 (schedule) in every rolling fold, with a significant difference (§6.5).
2. No route worse than M0 by more than 5%.
3. 80% interval coverage within 75-85%.

For **ETAs shown to riders** (adjust or replace Passio):
1. Better than M1 (Passio raw) at the 2-5 and 5-10 minute leads, significant by §6.5.
2. Early-miss rate no worse than Passio's.
3. No route worse than Passio by more than 10% MAE.

If a gate fails, that output keeps the current source (schedule / Passio) and the experiment is logged as "not yet". No exceptions near the deadline.

### 6.7 After shipping: monitoring
- Weekly: re-run the backtest on the latest 4 weeks (`python tools/backtest.py --data <snapshot> --out experiments/routeknower/weekly-YYYY-MM-DD.md`).
- Alarm: if live MAE drifts more than 25% above the shipped model's backtest MAE for 3 days, fall back to schedule/Passio (§9 rollback) and open an experiment.
- After every GTFS change: check segment joins (§6.2) and rebuild `learned.json`.

## 7. Experiment queue

Run in order unless a precondition blocks. "Pre" = data tier (§4) or experiment needed first.

| ID | Experiment | Pre | Output / decision |
|---|---|---|---|
| E00 | Pilot backtest on day 1 | T0 | done; see §11 |
| E01 | Data-quality audit: DCC segment pairs, worst 2% segment times, duplicates, Passio 5-10 min outliers (§3.3 items 1-4) | T0 | fixes to detector/merge/`load_rows`; re-run E00 |
| E02 | Field truth check of the detector (20+ hand-logged arrivals at one stop) | none | confirm or revise the +-10 s claim in `docs/DATA.md` |
| E03 | Store raw position polls as CI artifacts (or locally) for M8 | none | 2+ weeks of raw polls |
| E04 | `data/calendar.json`: class days, finals, breaks, holidays (from the official academic calendar; Thanksgiving is Thu 2026-11-26) | none | calendar flags available to every model |
| E05 | Weekly baseline report: M0, M1, M3, M4 at T1 | T1 | first real numbers; tune k on real data |
| E06 | M2 Passio bias + M5 previous-bus | T1 | adopt if significant at T1, re-check at T2 |
| E07 | M11 headway / wait model | T1 | P(next bus in N min) calibration; feeds planner wait |
| E08 | M7 dwell model | T1 | adopt if Q5 MAE improves |
| E09 | **Ship evaluation**: M3/M4/M5/M10 on 4+ weeks, full §6 protocol, gate §6.6 | T2 | ship candidate RK-1 or "not yet" |
| E10 | M6 kNN analog | T2 | adopt if it beats E09's winner |
| E11 | M12 conformal vs log-normal intervals | T2 | pick the interval method |
| E12 | M8 Kalman on real raw polls | E03 + 2 weeks | short-lead ETA gain? |
| E13 | M9 gradient boosting | T3 | adopt only if it beats the current model in rolling origin |
| E14 | Calendar-regime models (finals, breaks) | T3 + E04 | per-regime buckets or features |

## 8. Timeline to ship before December

Dates are targets; the gates in §6.6 decide, not the calendar.

| Dates | Phase | Work |
|---|---|---|
| Oct 8 to Oct 21 | **Collect + clean** | Keep both collectors healthy (`monitoring.md`). Run E01-E04. Confirm night routes and weekends appear (first night data Oct 8 evening; first weekend Oct 10-11). |
| Oct 22 to Nov 4 | **First models** (T1) | E05-E08 weekly. Build M5, M10, M11 code (can be built before T2 and tested at T2). Draft the §9 deploy path behind a flag. |
| Nov 5 to Nov 12 | **Select** (T2) | E09 ship evaluation on 4+ weeks. Decide RK-1 by **Thu Nov 12** (model freeze). The GTFS feed window ends Nov 7: check that segment joins survive the renewal. |
| Nov 13 to Nov 24 | **Integrate + QA** | Deploy RK-1 through §9 if it passed; QA on a real iPhone; ship by **Tue Nov 24**, before Thanksgiving week (service is irregular then). |
| Nov 25 to Dec | **Post-ship** | Weekly monitoring (§6.7). Tag Thanksgiving and finals as calendar regimes; do not let them pollute normal-week buckets. |
| Winter quarter on | **Sharpen** | T3 experiments (E13, E14); recalibrate at the quarter boundary; keep collecting toward T4. |

## 9. Deploying a winning model (not built yet)

1. `refresh_model.py` already writes `web/data/learned.json` on the `data` branch after each CI run.
2. Add to `.github/workflows/pages.yml`: after `build_gtfs.py`, fetch `learned.json` from the `data` branch
   **only if** a gate file `data/model/approved.json` (committed by a human, naming the passing experiment and
   the model version) is present and matches. Otherwise ship without it; the app falls back to the schedule.
3. `predict.js` already shrinks learned toward the schedule and tolerates a 404. Show the source ("learned" /
   "schedule") and keep every number labelled "est." (ship checklist #2 in `CLAUDE.md`).
4. Bump the cache name in `web/sw.js` if `learned.json` joins the precache list (it is network-first data, so it probably should not).
5. **Rollback:** delete or flag `approved.json` and re-run Pages. The next deploy drops the model.

## 10. Agent protocol (how to run an experiment)

1. **Pick** the first experiment in §7 whose precondition is met. Check the tier with `truth_stats.py` and §4.
   Tell Nathan which one and why if you are unsure.
2. **Snapshot** the data (§3) into `$TEMP/rk/arrivals-YYYYMMDD.csv`. Record the row count, date range and
   `sha256sum`, so the result can be reproduced.
3. **Code** goes in `tools/rk_<name>.py`: stdlib Python, reusing `model_core.load_rows` and the backtest's
   information-time logic. Do not change production models (`model_*.py`, `refresh_model.py`, `predict.js`)
   unless the experiment's decision is "adopt" and Nathan agrees.
4. **Never overwrite** `docs/BACKTEST.md` with an experiment run: pass `--out experiments/routeknower/...`.
   `docs/BACKTEST.md` is rewritten only by a full real-data run (E05 or later).
5. **Write up** `experiments/routeknower/E##-<slug>.md` using the template below, and add a row to §11.
6. **Decide:** adopt / reject / inconclusive (needs tier X). Inconclusive is a fine result; a false win is not.
7. **Windows note:** Controlled Folder Access is on for Nathan's PC; if a Git Bash redirect into the repo
   fails with "Permission denied", write with Python or the Edit/Write tools.
8. **Privacy:** the data has no rider information. Keep it that way; never join user locations or devices.

Template:
```
# E##: <title>
Date: YYYY-MM-DD · Agent/person: · Data: <snapshot name>, <rows>, <date range>, sha256 <...>
Question: <one sentence>
Method(s): <IDs from §5, parameters>
Protocol: split <...>, folds <...>, leakage checklist §6.2 [x] all
Results: <table: method x metric x slice; include n and test days>
Significance: <bootstrap CI over days>
Decision: adopt | reject | inconclusive (needs T#) — why
Follow-ups: <new experiments or fixes>
Reproduce: <exact commands>
```

## 11. Experiment log

| ID | Date | Data | Result | Decision |
|---|---|---|---|---|
| E00 | 2026-10-08 | day 1, 1,636 usable segment rows, 8 routes, 128 segments; train 04:59-11:02, test 11:02-15:00 | Segment MAE: schedule 111 s, segment-hour median 96 s, shrunk hierarchy 99 s, + EWMA 103 s. Arrival at 2-5 min lead (n = 422): **Passio 156 s, schedule 116 s, shrunk hierarchy 97 s**. Coverage 74-75%. RMSE ~270 s (heavy tails) | **Inconclusive** (one day, morning-train / afternoon-test, 1 test day). Pipeline works on real data. Next: E01. Details: `experiments/routeknower/E00-pilot-2026-10-08.md` |

## 12. Open questions
- Does Passio's ETA come from a schedule or from live positions per route? (The pilot's mean error of -33 s says
  buses beat Passio's ETA on average.) M2 and M10 answer this with data.
- Are some stops request-only at night (no row when skipped)? That affects Q4 and the night-route models.
- Does the academic calendar (class changes at :50 to :10) show up in dwell and run times? E08 and E14 answer this.
- Permission from UChicago Transportation is still unresolved (`CLAUDE.md`); collection stays low-volume and public-data-only.

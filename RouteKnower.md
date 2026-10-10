# RouteKnower: experiment plan for learning bus driving and station arrival times

> **What this is.** The single plan for turning the ground-truth arrivals we collect into a model that
> predicts (1) how long a shuttle takes to drive between stations and (2) when it will reach a station,
> and for **proving** each step with tests before it reaches riders. Written for Nathan and for any
> Claude agent. Agents: read this whole file before running an experiment, follow **§10 Agent
> protocol**, and log every result in **§11**.
>
> Status: **collecting arrivals + weather/traffic context; E00, E01, E04, E15 done.** Created 2026-10-08,
> revised the same day after an objective review (§13). Ship target: **Fri Nov 20, 2026**, before
> Thanksgiving Break (§8). Improving the data and the model continues after shipping.

Related files (read, don't duplicate): `docs/DATA.md` (CSV schemas, detector, context data), `docs/ALGORITHMS.md`
(math of the existing models), `docs/BACKTEST.md` (latest backtest report), browsable data + viewer:
https://github.com/blobberus/straight-bussing-data (auto-synced mirror of the data and this methodology), `monitoring.md` (keeping the
collectors alive), `web/js/core/predict.js` (how the app reads a model). `docs/LEARNING.md` is superseded.

---

## 0. Summary

- **Collection:** ~180 arrivals per service hour in the daytime and ~300 in the 4-7 PM peak, when the night
  routes join; a full day should be **~4,000-4,500 rows** (re-measure after the first complete day). A clean
  4-week dataset exists around **Nov 5**: the earliest honest "ship" evaluation.
- **Context:** weather (Chicago Midway observations + campus-point model data, 2018 to today) and typical traffic
  (City of Chicago Traffic Tracker, 2018 to Apr 2026) are collected and joined to every arrival (§3.4).
  Rain and snow slow Hyde Park traffic by only ~2-4.5 % (E15), so weather is a **secondary** factor; same-day
  congestion measured by the shuttles themselves (M13) is the main "traffic today" signal.
- **Models already built:** stdlib Python in `tools/model_*.py` and `tools/backtest.py`. RouteKnower is mostly about
  **testing them on real data, adding a few cheap methods** (§5: M2, M5, M10, M11, M13, M14), and **wiring a
  winner into the live site** (§9).
- **The live site ignores the learned model today.** Pages builds from `main`; `learned.json` only lives on the
  `data` branch. Shipping a model is a deliberate, gated step (§9).
- **The app does not wait on the model.** It works with Passio and the schedule. If no model passes the ship gate
  (§6.6) by Nov 12, ship without it and keep improving.

## 1. What we are predicting

| ID | Quantity | Who uses it | Where in the app |
|---|---|---|---|
| Q1 | **Segment run time** x: driving time from station a to the next station b (dwell removed) | building block | `predict.rideMinutes` |
| Q2 | **Dwell** w: time stopped at a station | building block | added between segments |
| Q3 | **Arrival time at a station** at lead L (L = how far ahead the prediction is made) | riders: "bus in 4 min" | Plan Trip / stop ETAs (Passio today) |
| Q4 | **Wait time / next-bus probability** at a station when no live prediction exists | riders arriving at a stop | Plan Trip, planner wait |
| Q5 | **Ride time A to B** = sum of x and w along the route | trip planner totals | Directions option cards |
| Q6 | **Uncertainty**: p10 / p50 / p90 of each of the above | honest "4 to 7 min" ranges | estimate labels |

Riders feel Q3, Q4 and Q5. A good Q1 score with a bad Q3 score is not a win.

## 2. What already exists (do not rebuild)

| Piece | File | State |
|---|---|---|
| Arrival detector (+-10 s in simulation) | `tools/arrival_detector.py`, `tools/truth_logger.py` | live, collecting |
| Collection (CI every 30 min + local stopgap) | `.github/workflows/collect.yml`, `tools/monitor.py` | live (see `monitoring.md`) |
| Context collection (weather daily, traffic history) | `.github/workflows/context.yml`, `tools/context_fetch.py` | added 2026-10-08 |
| Context join (leakage-safe features per arrival) | `tools/context_join.py`, tests `tools/test_context.py` | added 2026-10-08 |
| Academic calendar regimes | `data/calendar.json` | 2026-27, from the College Catalog |
| Clean segment rows (drops layovers > 30 min, GPS glitches; E01: stale links, duplicate visits, untrusted Passio) | `tools/model_core.py` `load_rows` | done |
| Data-quality audit (pairs, detection per vehicle lap, tails, Passio by cause) | `tools/rk_data_audit.py` | E01, 2026-10-10 |
| Hierarchical shrunk medians (global ... segment x hour-of-week) | `tools/model_segments.py` `SegmentModel` | done, synthetic-tested |
| Same-day EWMA + trip carry-over correction | `model_segments.Corrector` | done, synthetic-tested |
| Log-normal intervals + calibration + Fenton sum | `tools/model_quantile.py` | done |
| Kalman filter on along-route position | `tools/model_kalman.py` | simulation only |
| Time-ordered backtest (70/30, rolling origin, same information time as Passio) | `tools/backtest.py` | done; writes `docs/BACKTEST.md` |
| Model export to the app | `tools/refresh_model.py` -> `web/data/learned.json` (on `data` branch) | runs in CI; **not deployed to the site** |
| App reader | `web/js/core/predict.js` (shrinks learned toward schedule) | done |

## 3. The data

Schemas: `docs/DATA.md`. One arrivals row = one bus arriving at one station. Latest snapshot:
```
cd /c/Users/billy/Documents/straight-bussing      # or your clone
git fetch -q origin data
MSYS_NO_PATHCONV=1 git show origin/data:data/ground_truth/arrivals.csv > "$TEMP/rk/arrivals.csv"
for f in weather_mdw weather_campus traffic_regions_hourly; do
  MSYS_NO_PATHCONV=1 git show origin/data:data/context/$f.csv > "$TEMP/rk/$f.csv"; done
python tools/truth_stats.py "$TEMP/rk/arrivals.csv"
python tools/context_join.py --arrivals "$TEMP/rk/arrivals.csv" --context "$TEMP/rk" --out "$TEMP/rk/arrivals_ctx.csv"
```

### 3.1 State on 2026-10-08 (first real day, 04:59 to 20:51 at the time of the review)
- 3,253 rows. Daytime ~180 rows/hour; 4-7 PM ~300/hour once the night routes (North, South, East, Central,
  4 PM to 4:30 AM daily) start. 222 bytes per row.
- 13 of 14 routes seen; South Loop Shuttle runs Saturdays only.
- **Share of a route's stops detected per observed trip** (median): 0.82-0.94 on most day routes, but Drexel 0.62,
  Regents Express 0.62, East 0.64, Central 0.73. Night routes skip unrequested stops (no row by design); Drexel and
  Regents in daytime need a look (E01). (E01: this measure splits laps at trip-id changes and counts the terminal
  twice; per full vehicle lap most routes are 0.93-1.00, Drexel 0.86.)
- Passio predictions on 97% of rows; at the first snapshot median lead 155 s, median |error| 62 s, mean error
  -32.6 s (buses arrived earlier than Passio said, on average). (E01: on predictions that can be attributed to the
  bus, 2026-10-08/09: MAE 78 s, mean error -42 s.)
- 2 exact duplicates got past the merge.

### 3.2 Expected volume (estimates; recheck weekly with `truth_stats.py`)

Each trip passes each segment once, so **samples per segment per day ≈ trips per day x detection share** (§3.1:
0.6-0.95 depending on the route).

| Route (weekday) | Service hours | Trips | Trips per hour | Samples per hour-of-week bucket per week |
|---|---:|---:|---:|---:|
| Red Line/Arts Block | 14.8 | 77 | 5.2 | ~5 |
| Apostolic/Drexel | 14.9 | 78 | 5.2 | ~4 |
| Midway Metra | 13.2 | 46 | 3.5 | ~3 |
| North / South / East (daily) | 12.5 | 39 | 3.1 | ~2-3 |
| 53rd Street Express | 12.4 | 29 | 2.3 | ~2 |
| Downtown Campus Connector | 17.9 | 38 | 2.1 | ~2 |
| Friend Center/Metra (daily) | 15.9 | 32 | 2.0 | ~2 |
| Drexel / Apostolic (5 to 10:30 AM) | ~5.3 | 31 | ~6 | ~3-5 |
| Regents Express | 3.7 | 9 | 2.4 | ~1-2 |

Source: `web/data/service.json` (Wednesday column; GTFS feed window 2026-10-07 to 2026-11-07, recheck after it renews).
Totals: ~4,000-4,500 rows a day, ~30k a week, ~1 MB a day. The CSV rotates to `archive/` at 40 MB (~6 weeks).

### 3.3 Data quality issues to fix first (they hurt every model)
Items 1-5 were audited in **E01 (2026-10-10)**, `experiments/routeknower/E01-data-quality-2026-10-10.md`. `load_rows` now
applies the E01 rules (`model_core.clean_dicts`); collector fixes B1-B5 are proposed there, not applied yet.
1. **Downtown Campus Connector**: many distinct (prev, stop) pairs with tiny counts: skipped stops making
   non-adjacent pairs, or route variants. Check `route_stops.json` against live trips (E01).
   **E01:** not a route_stops mismatch (GTFS: one frequency trip 874028, 15 stops = route_stops; full laps detect 93%). 18% of
   DCC links jump over other arrivals of the same bus (one trip id all day keeps stale detector state alive) and 48 rows are
   mistimed transitions. Stale links are dropped now (DCC segment keys 37 -> 26); detector bugs B2, B3.
2. **Low detection share on Drexel and Regents Express** in daytime (0.62): missed detections or variants (E01).
   **E01:** mostly the measure: per trip id with the terminal counted twice. Drexel is 0.86 per full vehicle lap; its real
   misses (Goldblatt 56%, Wyler 50%, but 94-100% on other routes at the same stops) follow trip-id flaps of one bus (4327 went
   back to its first trip id 8 times). Regents: 50 rows, too few (recheck at T1). Found instead: **Midway Metra variant**, 20 of
   46 trips serve 57th St Metra (NB), which `route_stops.json` lacks (41% of its rows; Bernard Mitchell 54%).
3. **Heavy tails**: pilot RMSE ~3x MAE. Layovers, trip-id flips at terminals and detours under the 30-minute cut still
   pollute segment times. Look at the worst 2% (E01).
   **E01:** worst 2% = holds at turnaround points and lots (bus waits outside the 40 m radius), terminal layovers, stale links,
   and > 20 m/s timing artefacts. Cut: stale links, duplicate visits, > 20 m/s under 2 km. Kept: holds and layovers (riders sit
   through them; model them in M7). Residual RMSE / MAE 2.64 -> 2.53.
4. **Duplicates**: 2 exact duplicates passed `merge_arrivals.py`. Find which rule missed them. **2026-10-10**: no exact
   duplicates left, but 51 same-bus same-stop pairs < 120 s apart with different trip ids (collectors disagreeing on
   Passio's trip id, incl. terminal flips). Merge now dedupes on vehicle + stop; 41 rows dropped from the data branch.
   **E01:** 0 left within 120 s; 10 pairs 121-300 s apart are one visit timed twice (analysis keeps the earliest; merge
   window 300 s proposed, B4).
5. **Passio outliers**: 5-10 minute lead MAE 1,973 s on n = 10 in E00 is almost surely a trip/terminal matching
   issue. Fix before any Passio comparison is trusted.
   **E01:** our logger, not Passio. It keys predictions by trip + stop, but all DCC buses share trip 874028, so they overwrite
   each other (DCC 2-5 min MAE 618 s vs 78 s elsewhere; errors ~one 25-min headway). And only the newest prediction >= 120 s
   old is stored, so a lead >= 5 min means Passio stopped updating that trip: those bins sample failures. `load_rows` now
   withholds Passio on shared trip ids, trip starts and leads >= 300 s (Passio MAE 147 -> 74 s). Fixed-lead logging (B5)
   is needed before Passio can be scored beyond 5 minutes.
6. **Detector truth check**: the +-10 s claim comes from simulation. Validate in the field: 20+ hand-logged arrivals at
   one stop with a phone clock (E02).
7. **Raw positions were not stored** before 2026-10-10, so the Kalman filter (M8) could not be tested on real data.
   Now every CI run keeps its polls as a 90-day artifact; `tools/raw_fetch.py` downloads them (E03, `docs/DATA.md`).

### 3.4 Context data: weather, traffic, calendar (vetted 2026-10-08)

**Accepted sources**

| Factor | Source | What we take | Why it qualifies | Limits |
|---|---|---|---|---|
| Weather (measured) | [Iowa Environmental Mesonet ASOS archive](https://mesonet.agron.iastate.edu/request/download.phtml), station MDW (Chicago Midway) | hourly routine METAR: temp, wind, visibility, 1-h precip, weather codes (RA, SN, FG...), snow depth | official NWS/FAA airport sensors; free archive back decades; documented API (1 req/s throttle) | ~10 km west of campus (lake effect differs); hourly resolution; little QC |
| Weather (campus point) | [Open-Meteo](https://open-meteo.com/en/docs/historical-weather-api) at 41.7886, -87.5987 | hourly precip, rain, snowfall, snow depth, weather code, wind | CC BY 4.0 (credit "Weather data by Open-Meteo.com"); no key; free under 10k calls/day non-commercial | model output, not a measurement; archive lags ~5 days |
| Weather (backup, live) | [NWS api.weather.gov](https://weather-gov.github.io/api/general-faqs) `/stations/KMDW/observations` | same station, live | public domain, no key (contact User-Agent required) | fields may be missing; not used for history |
| Typical traffic | City of Chicago [Traffic Tracker, Historical Congestion by Region 2018-2026](https://data.cityofchicago.org/d/kf7e-cur8) | hourly mean arterial speed: Hyde Park-Kenwood-Woodlawn (76 of 91 stops), Loop, Washington Park, Downtown Lakefront | official city data from CTA bus GPS (relevant: it measures buses); free | **stopped updating 2026-04-30** (city deprecated it, no successor found); arterials only |
| Traffic today | our own shuttles: **fleet congestion index** (M13) | median observed/scheduled segment time of all shuttle segments finished in the last 30 min | measures exactly our roads, live, no third party | only where shuttles run; noisy at low service |
| Academic calendar | [College Catalog 2026-27](http://collegecatalog.uchicago.edu/thecollege/academiccalendar/) -> `data/calendar.json` | class / reading / finals / break / holiday regimes | official | "subject to change"; re-check each quarter |

**Rejected sources (and why)**
- **Google Maps (scraping or the Routes API).** The [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms)
  §3.2.3 forbid scraping or storing Google Maps content ("No Scraping", "No Caching"), forbid using it "to improve
  machine learning and artificial intelligence models, including to train, test, validate or fine-tune the models",
  and forbid using it "with or near a non-Google Map" (our map is OpenFreeMap). Any of these alone rules it out.
- **Traffic Tracker by segment** (`4g9f-3jbs`): also stopped 2026-04-30, its API times out even for one segment over
  four months, and only 66 of ~1,250 segments lie on shuttle routes: mostly DuSable Lake Shore Dr / downtown
  (Downtown Campus Connector, South Loop Shuttle), plus Stony Island and Garfield; campus streets are not covered.
- **CTA Bus Tracker / GTFS-Realtime** (live bus GPS on Hyde Park streets, the same input the city used):
  [requires a developer key](https://www.transitchicago.com/developers/) under CTA's license. Good candidate if
  Nathan registers a key (E17); not used until then.
- **TomTom / HERE traffic APIs**: need keys; their terms on storing data could not be verified (TomTom's terms page did
  not load), so not adopted.

**Leakage rule for context** (also in §6.2): a feature may only use values known when the bus *started* the segment.
`tools/context_join.py` uses the latest Midway report at or before the start (max 90 min old), the Open-Meteo hour
*ending* at or before it, and fleet segments that *finished* before it. For live use in the app, the same features come
from the current observation (or a forecast for trips planned ahead), never from later actuals.

**E15 result (prior):** on 2022-2026 history, Hyde Park arterial speeds are 2.0 % lower in light rain (95% CI 1.4-2.5),
3.5 % in heavy rain (2.9-4.0) and 3.5 % in snow (2.6-4.4); similar in the Loop (heavy rain 4.5 %). On a 10-minute ride that
is ~15-30 s. Midway reported measurable precipitation on ~20 of 54 service days between Oct 8 and Nov 30 in 2018-2025 (range
15-24) and snow on ~5 (mostly flurries). Details: `experiments/routeknower/E15-weather-traffic-prior.md`.

## 4. How much data: targets

Rules: a bucket needs **n >= 20** to be trusted on its own (`min_n`); with n >= 5 it can be exported but is shrunk toward
its parent. Evaluation needs **at least 10 separate service days in the test window** (whole days are the unit of noise).
Weather effects need **wet days**, not just rows: a weather slice is only reported with >= 5 wet days in the test window.

| Tier | Definition (all must hold) | Calendar time | Expected | Unlocks |
|---|---|---|---|---|
| **T0 Pilot** | >= 200 real rows | 1 day | **done 2026-10-08** | code runs on real data (E00) |
| **T1 Minimum** | every running segment n >= 50; weekday segment x daypart n >= 20 for 80% of buckets; 2 weekends incl. night routes | 2 weeks | ~Oct 22 | M2, M3 daypart, M5, M11, M13; first weekly report |
| **T2 Ship** | 4 full weeks (20 weekdays, 8 weekend days); weekday-hour buckets n >= 20 for 80% of (segment, hour); holdout >= 10 days; **>= 10 wet service days** | 4-5 weeks | **~Nov 5 to Nov 12** | ship gate (§6.6), M6, M10, M14 re-estimated, intervals |
| **T3 Good** | 8-10 weeks incl. Thanksgiving Break (Nov 23-27), reading period and finals (Dec 5-11), first snow days; hour-of-week n >= 20 for most buckets | to mid-Dec | ~Dec 15 | M9 trial, calendar regimes, first snow estimates |
| **T4 Ideal** | a full academic year: 3 quarters + breaks + summer; >= 2 occurrences of every calendar regime; >= 10 snow days incl. accumulating snow | 12 months | ~Oct 2027 | seasonal / weather models per regime |

Ongoing beyond T4: **never stop collecting.** Train on a rolling window (e.g. the last 8 weeks weighted up, plus
calendar-matched history), because routes, roads and schedules drift. GTFS changes restart the affected segments at T0.

Why hour-of-week takes so long: a route with 2-5 trips an hour puts only 2-5 samples a week into each of the 168
hour-of-week buckets. Pooling weekdays (24 buckets) gets 10-25 a week, which makes T2 reachable by November.

## 5. Candidate methods

Effort: S = hours, M = a day or two, L = a week. "Data" is the tier from §4 needed before testing.

| ID | Method | Predicts | Data | Status | Effort |
|---|---|---|---|---|---|
| M0 | **Schedule** (GTFS segment seconds; intermediate stops interpolated) | Q1, Q5 | none | baseline, in app | - |
| M1 | **Passio raw** ETA from `tripUpdates` | Q3 | none | baseline, in app | - |
| M2 | **Passio bias correction** per route x lead bin x daypart | Q3 | T1 | partial (`bias` in learned.json) | S |
| M3 | **Hierarchical shrunk medians** with log-normal spread | Q1, Q2, Q5, Q6 | T1 / T2 | built | - |
| M4 | M3 + **same-day EWMA + trip carry-over** | Q1, Q3 | T1 | built; no gain in pilot | - |
| M5 | **Previous-bus predictor**: last bus's run time on the same segment, weighted by recency, blended with M3 | Q1, Q3 | T1 | new | S |
| M6 | **Historical analog (kNN trips)** by time of week, calendar regime and weather class | Q3, Q5 | T2 | new | M |
| M7 | **Dwell model**: station x hour x class-change window (:50 to :10) x terminal flag x rain | Q2 | T1 | new | S-M |
| M8 | **Kalman live position** + learned speeds beyond the next stop | Q3 short lead | raw positions (E03) | simulation only | M |
| M9 | **Gradient-boosted quantile trees** on log x; features incl. weather, fleet index, calendar regime; exported as lookup tables | Q1, Q3, Q6 | T3 | new | L |
| M10 | **Stacked blend** w(lead, route) x Passio + (1 - w) x ours | Q3 | T2 | new | S |
| M11 | **Headway / wait model**: gaps between consecutive arrivals per route x hour; P(next bus within N min) | Q4 | T1 | new | S |
| M12 | **Split-conformal intervals** by lead bin | Q6 | T2 | new | S |
| M13 | **Fleet congestion index** (`fl_idx`): today's observed/scheduled ratio over the last 30 min, all routes, as a multiplier or feature | Q1, Q3 | T1 | feature built (context join) | S |
| M14 | **Weather multipliers** on run time and dwell by weather class (prior from E15: light rain x1.02, heavy rain x1.04, snow x1.04), re-estimated with shrinkage toward the prior | Q1, Q2 | T2 (>= 10 wet days) | prior done | S |

Notes and priors (**hypotheses, to be tested, not results**):
- M10 is a plausible ship candidate: Passio sees live positions, we see history; blends often beat both.
- M5 and M13 should matter more than weather: E15 shows weather moves arterial speed only ~2-4.5 %.
- M11 is the only method for Q4 and also improves the planner's headway-based wait.
- M9 waits for T3; with little data, trees overfit what the hierarchy captures. Offline runs may use pip packages in a
  local venv; the shipped artifact must stay a JSON lookup table (the app is build-free).

## 6. How to test (the protocol)

Formulas and the existing backtest: `docs/ALGORITHMS.md` §9.

### 6.1 Splits
- **Time order only.** Never shuffle. Train on earlier days, test on later ones.
- **Main split: whole days.** Hold out the last 30% of service days, or at least 10 days. (E00 split by rows because only
  one day existed; that is not acceptable for decisions.)
- **Rolling origin:** expanding window, one week per fold, >= 3 folds; refit and re-tune everything per fold.
- Weekday and weekend separately; break weeks separately from class weeks.

### 6.2 Information-time rules (leakage checklist; tick each)
- [ ] The prediction for an arrival at time A with lead L uses only rows with `epoch` <= A - L.
- [ ] Context features (weather, fleet index) use only values known at the query time (§3.4); never the weather that
      actually happened later in the trip.
- [ ] No feature built from the whole day or the whole test period (e.g. "today's mean").
- [ ] Hyperparameters (k, τ, blend weights, calibration, weather multipliers) fit inside the training period only.
- [ ] Segments joined by **(route, prev_stop_id, stop_id)**, not by index alone (GTFS refreshes shift indexes).
- [ ] Synthetic rows (trip ids starting `syn`) and `synthetic_arrivals.csv` excluded.
- [ ] Duplicates removed before splitting.

### 6.3 Metrics
| Metric | For | Target direction |
|---|---|---|
| MAE, median AE, p90 AE (seconds) | Q1, Q3, Q5 | lower |
| **Within +-1 min / +-2 min rate** at lead bins 0-2, 2-5, 5-10, 10-20 min | Q3 | higher |
| **Early-miss rate**: bus arrives > 60 s *before* the predicted time | Q3, Q5 | lower; counts double (an early bus means a missed bus) |
| Pinball loss at τ = 0.1/0.5/0.9 | Q6 | lower |
| 80% interval coverage | Q6 | 75-85% |
| **Planner miss rate**: replay planned trips; rider reaches the stop after the bus left | Q5 + walking | lower |
| Log score / Brier score of P(next bus within N min) | Q4 | lower |

### 6.4 Slices (a model that wins on average but loses badly on a slice is not shipped)
Route; daypart; weekday/weekend; lead bin; segment length (< 60 s, 60-180 s, > 180 s); timepoint vs interpolated stop;
**calendar regime** (class / reading / finals / break / holiday); **weather class** (dry / light rain / heavy rain / snow,
from `wx_*`); **fleet index tercile** (calm / normal / congested day).

### 6.5 Significance
Compare methods on the **same rows**. Per test day, compute the MAE difference (candidate - baseline); bootstrap over
**days** (2,000 resamples) for a 95% interval. A win needs the whole interval below 0. Fewer than 10 test days =
"inconclusive"; a weather slice with fewer than 5 wet days = "inconclusive".

### 6.6 Ship gate (all must hold, measured at T2 or later)
For **ride times in the planner** (replace the schedule fallback in `predict.rideMinutes`):
1. Ride-time MAE at least 20% better than M0 in every rolling fold, significant (§6.5).
2. No route worse than M0 by more than 5%; no weather class or calendar regime worse than M0 by more than 10%.
3. 80% interval coverage within 75-85%.

For **ETAs shown to riders** (adjust or replace Passio):
1. Better than M1 at the 2-5 and 5-10 minute leads, significant.
2. Early-miss rate no worse than Passio's.
3. No route worse than Passio by more than 10% MAE.

A failed gate keeps the current source for that output; logged as "not yet". No exceptions near the deadline.

### 6.7 After shipping: monitoring
- Weekly: backtest on the latest 4 weeks (`python tools/backtest.py --data <snapshot> --out experiments/routeknower/weekly-YYYY-MM-DD.md`).
- Alarm: live MAE > 25% above the shipped model's backtest MAE for 3 days -> fall back to schedule/Passio (§9) and open an experiment.
- After every GTFS change: check segment joins and rebuild `learned.json`. Each quarter: update `data/calendar.json`.

## 7. Experiment queue

| ID | Experiment | Pre | Output / decision |
|---|---|---|---|
| E00 | Pilot backtest on day 1 | T0 | done (inconclusive) |
| E01 | Data-quality audit: DCC pairs, Drexel/Regents detection share, worst 2% segment times, duplicates, Passio 5-10 min outliers (§3.3 items 1-5) | T0 | **done 2026-10-10**: `load_rows` rules adopted, E00 re-run; collector fixes B1-B5 proposed (owner to apply) |
| E02 | Field truth check of the detector (20+ hand-logged arrivals at one stop) | none | confirm or revise the +-10 s claim |
| E03 | Store raw position polls (CI artifact or local) for M8 | none | **started 2026-10-10**: CI artifact `raw-polls-<run>` (90 days), `tools/raw_fetch.py`; 2+ weeks by Oct 24 |
| E04 | `data/calendar.json` from the official academic calendar | none | **done 2026-10-08** |
| E05 | Weekly baseline report: M0, M1, M3, M4 at T1 | T1 | first real numbers; tune k |
| E06 | M2 Passio bias + M5 previous-bus + M13 fleet index | T1 | adopt if significant at T1, re-check at T2 |
| E07 | M11 headway / wait model | T1 | calibration of P(next bus in N min) |
| E08 | M7 dwell model (incl. rain) | T1 | adopt if Q5 MAE improves |
| E09 | **Ship evaluation**: M3/M4/M5/M10/M13/M14 on 4+ weeks, full §6 protocol, gate §6.6 | T2 | ship candidate RK-1 or "not yet" |
| E10 | M6 kNN analog | T2 | adopt if it beats E09's winner |
| E11 | M12 conformal vs log-normal intervals | T2 | pick the interval method |
| E12 | M8 Kalman on real raw polls | E03 + 2 weeks | short-lead ETA gain? |
| E13 | M9 gradient boosting | T3 | adopt only if it beats the current model in rolling origin |
| E14 | Calendar-regime models (Thanksgiving Break, finals, winter break) | T3 + E04 | per-regime buckets or features |
| E15 | Weather effect on arterial traffic (prior) | history | **done 2026-10-08**: ~2-4.5 % slower; secondary factor |
| E16 | Weather effect on shuttle run time and dwell (M14 re-estimate) | T2 + 10 wet days | multipliers with CIs; compare to E15 prior |
| E17 | CTA bus GPS on Hyde Park streets as a live traffic feed | Nathan's CTA developer key | adopt if it improves on M13 |

## 8. Timeline to ship before December

Dates are targets; the gates in §6.6 decide. Calendar dates from the 2026-27 College Catalog.

| Dates | Phase | Work |
|---|---|---|
| Oct 8 to Oct 21 | **Collect + clean** | Keep collectors healthy (`monitoring.md`; context workflow runs daily). E01-E03. First full night-route data Oct 8-9; first weekend Oct 10-11. |
| Oct 22 to Nov 4 | **First models** (T1) | E05-E08 weekly. Build M5, M10, M11, M13 code. Draft the §9 deploy path behind a flag. |
| Nov 5 to Nov 12 | **Select** (T2) | E09 + E16 on 4+ weeks. Decide RK-1 by **Thu Nov 12** (model freeze). GTFS feed window ends Nov 7: check segment joins survive the renewal. |
| Nov 13 to Nov 20 | **Integrate + QA** | Deploy RK-1 via §9 if it passed; QA on a real iPhone; **ship by Fri Nov 20**. Thanksgiving Break (Mon-Fri Nov 23-27) has light, irregular service: a quiet week to watch the release, not to launch into. |
| Nov 30 to Dec 12 | **Post-ship** | Weekly monitoring (§6.7). Reading period Dec 5-7 and finals Dec 8-11 are their own regimes; winter break starts Dec 12 (Winter Quarter begins Jan 4). |
| Winter quarter on | **Sharpen** | T3 experiments (E13, E14, snow in E16); recalibrate at the quarter boundary; keep collecting toward T4. |

## 9. Deploying a winning model (not built yet)

1. `refresh_model.py` already writes `web/data/learned.json` on the `data` branch after each CI run.
2. Add to `.github/workflows/pages.yml`: after `build_gtfs.py`, fetch `learned.json` from the `data` branch **only if** a
   gate file `data/model/approved.json` (committed by a human, naming the passing experiment and model version) matches.
   Otherwise ship without it; the app falls back to the schedule.
3. `predict.js` already shrinks learned toward the schedule and tolerates a 404. Show the source ("learned" / "schedule")
   and keep every number labelled "est." (ship checklist #2 in `CLAUDE.md`). Weather or fleet adjustments, if adopted,
   need the live inputs in the browser: NWS and Open-Meteo both allow cross-origin requests; fleet index comes from the
   live Passio feed the app already polls.
4. Bump the cache name in `web/sw.js` only if `learned.json` joins the precache list (it is network-first data; it should not).
5. **Rollback:** delete or flag `approved.json` and re-run Pages.

## 10. Agent protocol (how to run an experiment)

1. **Pick** the first experiment in §7 whose precondition is met (check the tier with `truth_stats.py` and §4).
2. **Snapshot** the data (§3) into `$TEMP/rk/`; record row counts, date range and `sha256sum`.
3. **Code** goes in `tools/rk_<name>.py`: stdlib Python, reusing `model_core.load_rows`, `context_join.join` and the
   backtest's information-time logic. Do not change production models (`model_*.py`, `refresh_model.py`, `predict.js`)
   unless the decision is "adopt" and Nathan agrees.
4. **Never overwrite** `docs/BACKTEST.md` with an experiment run: pass `--out experiments/routeknower/...`.
5. **Write up** `experiments/routeknower/E##-<slug>.md` with the template below; add a row to §11.
6. **Decide:** adopt / reject / inconclusive (needs tier X). Inconclusive is a fine result; a false win is not.
7. **Windows note:** Controlled Folder Access is on for Nathan's PC; if a Git Bash write into the repo fails with
   "Permission denied", write with Python or the Edit/Write tools.
8. **Sources:** use only the vetted sources in §3.4. A new source needs the same vetting (terms allow storing and
   modelling, documented API, coverage of our streets) written into §3.4 before use. Never scrape Google Maps.
9. **Privacy:** the data has no rider information. Keep it that way; never join user locations or devices.

Template:
```
# E##: <title>
Date: YYYY-MM-DD · Agent/person: · Data: <snapshot name>, <rows>, <date range>, sha256 <...>
Question: <one sentence>
Method(s): <IDs from §5, parameters>
Protocol: split <...>, folds <...>, leakage checklist §6.2 [x] all
Results: <table: method x metric x slice; include n, test days and wet days>
Significance: <bootstrap CI over days>
Decision: adopt | reject | inconclusive (needs T#) — why
Follow-ups: <new experiments or fixes>
Reproduce: <exact commands>
```

## 11. Experiment log

| ID | Date | Data | Result | Decision |
|---|---|---|---|---|
| E00 | 2026-10-08 | day 1, 1,636 usable segment rows, 8 routes; train 04:59-11:02, test 11:02-15:00 (row split) | Segment MAE: schedule 111 s, segment-hour median 96 s, shrunk hierarchy 99 s, + EWMA 103 s. Arrival at 2-5 min lead (n = 422): Passio 156 s, schedule 116 s, shrunk hierarchy 97 s. Coverage 74-75%. RMSE ~270 s | **Inconclusive**: one day, row split, 1 test day. Pipeline works on real data. `experiments/routeknower/E00-pilot-2026-10-08.md` |
| E01 | 2026-10-10 | data commit `ab837cf`: 6,824 rows, 2026-10-08 04:59 to 2026-10-09 20:28 CDT (2 service days) + GTFS zip + tripUpdates fixture | DCC: one frequency trip id for all buses; 18% stale links, 48 mistimed transitions, route_stops correct. Drexel 0.86 per full lap (0.50 per trip id); misses follow trip-id flaps. Midway Metra variant (57th St Metra NB) missing from route_stops. Tails: holds at lots/turnarounds, layovers, stale links, > 20 m/s artefacts. Passio: logger mixes DCC buses (618 s vs 78 s MAE); leads >= 5 min sample Passio failures. Rules cut 2.3% of segments, keys 233 -> 192; backtest 2-5 min Passio 114 -> 62 s, shrunk 63 -> 53 s | **Adopt** `load_rows` rules (analysis side). Collector bugs B1-B5 proposed, not applied. `experiments/routeknower/E01-data-quality-2026-10-10.md` |
| E04 | 2026-10-08 | 2026-27 College Catalog | `data/calendar.json`: Autumn begins Sep 28; Thanksgiving Break Nov 23-27; reading Dec 5-7; finals Dec 8-11; quarter ends Dec 12; Winter Jan 4 - Mar 13; Spring Mar 22 - Jun 5 | **Done**; ship date moved to Nov 20 (§8) |
| E15 | 2026-10-08 | Traffic Tracker regions 2022-01..2026-04 x MDW METARs (64,551 joined hours) | Hyde Park speeds -2.0 % light rain, -3.5 % heavy rain, -3.5 % snow (95% CIs exclude 0); ~20 wet / ~5 snow service days expected Oct 8-Nov 30 | **Adopt as prior** for M14; weather secondary. `experiments/routeknower/E15-weather-traffic-prior.md` |

## 12. Open questions
- Does Passio's ETA come from a schedule or from live positions? (Pilot mean error -33 s: buses beat Passio on average.) M2/M10 answer it.
- Are some stops request-only at night (no row when skipped)? Affects Q4 and the night-route models.
- Does the academic calendar (class changes at :50 to :10) show up in dwell and run times? E08, E14.
- How different is campus weather from Midway's (lake effect)? Compare `wx_*` with `gr_*` once wet days accumulate.
- Permission from UChicago Transportation is still unresolved (`CLAUDE.md`); collection stays low-volume, public-data-only.

## 13. Review log (objective review, 2026-10-08)

Checked every claim in the first version against the data and primary sources. Corrections:

| # | Was | Now | Evidence |
|---|---|---|---|
| 1 | "roughly 3,500 rows a day" | ~4,000-4,500 (night routes add a ~300/h evening peak) | evening rows on 2026-10-08 (§3.1) |
| 2 | "detector hit rate ~0.9" for every route | 0.62-0.94 by route; Drexel / Regents low in daytime | per-trip detected share (§3.1) |
| 3 | Ship "by Tue Nov 24, before Thanksgiving week" | Ship by **Fri Nov 20**: Thanksgiving Break is the whole week Nov 23-27 | 2026-27 College Catalog |
| 4 | Weather and traffic only a vague "later" feature | Vetted sources, collected + joined; measured prior (E15) | §3.4 |
| 5 | Implicit assumption that city traffic data is live | Chicago Traffic Tracker stopped 2026-04-30; history only | portal metadata, newest record 2026-04-30 |
| 6 | Google Maps suggested as a data source (request) | Rejected: terms forbid scraping, caching, ML training and use with non-Google maps | Maps Platform Terms §3.2.3 |
| 7 | "M10 is the most likely ship candidate" stated as fact | Marked as a hypothesis | no real-data test yet |
| 8 | `docs/LEARNING.md` listed as a related plan | Marked superseded (it says GitHub Actions is unsuitable, which is how we now collect) | `monitoring.md`, `collect.yml` |
| 9 | Tiers counted only rows | T2 also needs >= 10 wet days; snow cannot be validated before shipping | E15 day counts |
| 10 | Slices lacked weather / congestion / calendar | Added weather class, fleet index tercile, calendar regime | §6.4 |

Still unverified (do not rely on them yet): the detector's +-10 s accuracy on real buses (E02); how well Midway
weather represents campus (§12). Passio's 5-10 min outliers are explained (E01: logger, not Passio), but Passio
beyond 5 minutes ahead cannot be scored until fixed-lead predictions are logged (E01 B5).

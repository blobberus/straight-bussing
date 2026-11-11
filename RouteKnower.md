# RouteKnower: experiment plan for learning bus driving and station arrival times

> **What this is.** The single plan for turning the ground-truth arrivals we collect into a model that
> predicts (1) how long a shuttle takes to drive between stations and (2) when it will reach a station,
> and for **proving** each step with tests before it reaches riders. Written for the owner and for any
> Claude agent. Agents: read this whole file before running an experiment, follow **§10 Agent
> protocol**, and log every result in **§11**.
>
> Status: **collecting arrivals, Passio's predictions 1-30 min ahead (`predictions.csv`, since 2026-10-12) and
> weather/traffic context; E00, E01, E04, E15, E18, E19 done.** Owner goal since 2026-10-17: the **10 minute shrink** (3 min at >= 30 min ahead, 2 min at >= 20 min, 1 min below; it replaced the 10% rule of 2026-10-12, E19). Created 2026-10-08,
> revised the same day after an objective review (§13). Ship target: **Fri Nov 20, 2026**, before
> Thanksgiving Break (§8). Improving the data and the model continues after shipping.

Related files (read, don't duplicate): `docs/DATA.md` (CSV schemas, detector, context data), `docs/ALGORITHMS.md`
(math of the existing models), `docs/BACKTEST.md` (latest backtest report), browsable data + viewer:
https://github.com/blobberus/straight-bussing-data (auto-synced mirror of the data and this methodology), `monitoring.md` (keeping the
collectors alive), `web/js/core/predict.js` (how the app reads a model). `docs/LEARNING.md` is superseded. For the owner, in plain English:
**`docs/GOAL-AND-METHOD.md`** (the goal: the 10 minute shrink, earlier the 10% rule; the scoring rules, current standings, the optimization plan; keep it in step with
this file) and `docs/DATA-GUIDE.md` (every file and column with the numbers so far); visual overview
`docs/prediction-explainer.html`; first Passio far-lead analysis: `experiments/routeknower/E20-prelim-*`.

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
| Collection (CI: while buses run a 70-min run starts every 40 min, polls every 10 s; idle runs otherwise; + local stopgap) | `.github/workflows/collect.yml`, `tools/monitor.py` | live (see `monitoring.md`) |
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
cd straight-bussing      # your clone
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
applies the E01 rules (`model_core.clean_dicts`). Collector fixes **B1-B4 applied 2026-10-10** (`cc40831` per-bus Passio
keys, `9eb11c7` no far-away transition rows, `2ba339c` no stale links, `c3831ca` merge window 300 s); B5 done 2026-10-12 as a separate `predictions.csv` (leads 1-30 min; the arrivals schema is unchanged). Rows
logged before then keep the defects, so the `load_rows` rules stay.
1. **Downtown Campus Connector**: many distinct (prev, stop) pairs with tiny counts: skipped stops making
   non-adjacent pairs, or route variants. Check `route_stops.json` against live trips (E01).
   **E01:** not a route_stops mismatch (GTFS: one frequency trip 874028, 15 stops = route_stops; full laps detect 93%). 18% of
   DCC links jump over other arrivals of the same bus (one trip id all day keeps stale detector state alive) and 48 rows are
   mistimed transitions. Stale links are dropped now (DCC segment keys 37 -> 26); detector bugs B2, B3 (applied).
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
   window 300 s since `c3831ca`, B4).
5. **Passio outliers**: 5-10 minute lead MAE 1,973 s on n = 10 in E00 is almost surely a trip/terminal matching
   issue. Fix before any Passio comparison is trusted.
   **E01:** our logger, not Passio. It keys predictions by trip + stop, but all DCC buses share trip 874028, so they overwrite
   each other (DCC 2-5 min MAE 618 s vs 78 s elsewhere; errors ~one 25-min headway). And only the newest prediction >= 120 s
   old is stored, so a lead >= 5 min means Passio stopped updating that trip: those bins sample failures. `load_rows` now
   withholds Passio on shared trip ids, trip starts and leads >= 300 s (Passio MAE 147 -> 74 s). Since `cc40831` (B1) the
   logger keeps predictions per bus and matches the loop-terminal stop_sequence, so rows from then on can relax the
   shared-trip and trip-start rules once enough exist. Fixed-lead logging (B5, `predictions.csv` since 2026-10-12) is needed before Passio can be scored
   beyond 5 minutes.
6. **Detector truth check**: the +-10 s claim comes from simulation. Validate in the field: 20+ hand-logged arrivals at
   one stop with a phone clock (E02).
7. **Raw positions were not stored** before 2026-10-10, so the Kalman filter (M8) could not be tested on real data.
   Now every CI run keeps its polls as a 90-day artifact; `tools/raw_fetch.py` downloads them (E03, `docs/DATA.md`).
8. **Stops Passio skips were never logged** (found 2026-10-13 by replaying the raw polls against GPS passes): the
   detector only logged stops Passio named; Passio jumps over stops (night routes, Red Line), renames Red Line trips
   mid-lap and switches 150+ m early. Logged share of the stops buses drove past: 83% (Mon Oct 12), 74% (Sun Oct 11);
   South 48%. **B6 (`004ef84`)**: `source = pass` rows from the GPS track, and Midway Metra's afternoon pattern
   (57th St. & Metra NB, `data/route_patterns.json`): 88% / 88%, South 88%. Rows before 2026-10-13 ~17:00 lack them,
   so per-stop sample sizes and headways from earlier days undercount skipped stops (night routes, Red Line). Still
   missing: buses whose Passio stop / trip freezes or that Passio files under another route (~60 bus-hours on
   Oct 12; Red Line 62%): needs a GPS-only route matcher (E21); the archived raw polls allow re-deriving old days.
   **E21 (2026-10-17)**: the GPS sweep (`source = gps`) logs the stops frozen, lapped or lagging buses drive past:
   84-88% -> 91-95% of the stops driven past, Red Line 96-97%; the wrong-route case stays open (detection off).

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
  the owner registers a key (E17); not used until then.
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
- **2026-10-16, owner: may run deep learning on the routes on Google Colab.** Starting point:
  `experiments/routeknower/colab/` (notebook + TECHNICAL.md + PLAIN-ENGLISH). First look (E23): a small deep
  tabular network learns no correction on 4 days; quantile trees (M9) gain 1 to 2 points at 10 to 30 min. So
  trees and per-stop corrections first; revisit deep learning at T3 or with a GPS sequence input (raw polls).

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
**Flagged lines** (`data/labeled/flags/flagged_lines.csv`, summary `docs/FLAGGED-LINES.md`, rules in its README): every active flag is its own slice, the line narrowed by the flag's `scope` (stops, hours, days, buses, lead); report n; the data repo bench scores every model on them (`algorithm-test/run_all.py --only 13`).

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
1. Better than M1 at the 2-5 and 5-10 minute leads, significant. (For the owner's goal, the 10 minute shrink, under
   10 minutes counts once per arrival, at about 5 minutes ahead: GOAL-AND-METHOD 1.1 and 5.4.)
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
| E01 | Data-quality audit: DCC pairs, Drexel/Regents detection share, worst 2% segment times, duplicates, Passio 5-10 min outliers (§3.3 items 1-5) | T0 | **done 2026-10-10**: `load_rows` rules adopted, E00 re-run; collector fixes B1-B4 applied 2026-10-10 (`cc40831`, `9eb11c7`, `2ba339c`, `c3831ca`), B5 open |
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
| E17 | CTA bus GPS on Hyde Park streets as a live traffic feed | The owner's CTA developer key | adopt if it improves on M13 |
| E18 | One-minute goal (owner request): Passio's error per stop and what M2 / M10 buy, 2-3 min ahead | T0 | **done 2026-10-12**: worth pursuing, inconclusive for shipping (4 test days); re-run weekly, decide at T1 |
| E19 | **The 10% rule** (owner goal 2026-10-12: error <= 10% of the lead, 1 min at 10 min, 3 min at 30 min; "under 1% too late") on the data we have, and what the huge errors are | T0 | **done 2026-10-12**: no source meets it yet; predictions.csv (1-30 min) collected from today |
| E20 | Passio at 1-30 min from `predictions.csv` under the 10% rule (E19 scoring rule), plus our layover / run-matching model; also scored in the **rider's view** (the next bus of the route at the stop, whatever its trip id: about half of Passio's gross misses at 30 min are a lap mix-up, `docs/GOAL-AND-METHOD.md` 2.9) | 1 week of predictions.csv | first look Oct 19, decide at T1 |
| E21 | GPS-only route matcher: which route and lap a bus really drives when Passio's stop / trip freezes or names the wrong route (~60 bus-hours on 2026-10-12); re-derive the archived days | raw polls (archived) | **done 2026-10-17** (section 11): adopted for frozen / lapped / lagging buses; wrong route detected but off |

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
   and keep every number labelled "est." (ship checklist #2 in `.claude/rules/project.md`). Weather or fleet adjustments, if adopted,
   need the live inputs in the browser: NWS and Open-Meteo both allow cross-origin requests; fleet index comes from the
   live Passio feed the app already polls.
4. Bump the cache name in `web/sw.js` only if `learned.json` joins the precache list (it is network-first data; it should not).
5. **Rollback:** delete or flag `approved.json` and re-run Pages.

## 10. Agent protocol (how to run an experiment)

1. **Pick** the first experiment in §7 whose precondition is met (check the tier with `truth_stats.py` and §4).
2. **Snapshot** the data (§3) into `$TEMP/rk/`; record row counts, date range and `sha256sum`.
3. **Code** goes in `tools/rk_<name>.py`: stdlib Python, reusing `model_core.load_rows`, `context_join.join` and the
   backtest's information-time logic. Do not change production models (`model_*.py`, `refresh_model.py`, `predict.js`)
   unless the decision is "adopt" and the owner agrees.
4. **Never overwrite** `docs/BACKTEST.md` with an experiment run: pass `--out experiments/routeknower/...`.
5. **Write up** `experiments/routeknower/E##-<slug>.md` with the template below; add a row to §11.
6. **Decide:** adopt / reject / inconclusive (needs tier X). Inconclusive is a fine result; a false win is not.
7. **Windows note:** Controlled Folder Access is on for the owner's PC; if a Git Bash write into the repo fails with
   "Permission denied", write with Python or the Edit/Write tools.
8. **Sources:** use only the vetted sources in §3.4. A new source needs the same vetting (terms allow storing and
   modelling, documented API, coverage of our streets) written into §3.4 before use. Never scrape Google Maps.
9. **Privacy:** the data has no rider information. Keep it that way; never join user locations or devices.
10. **Flagged lines:** read `data/labeled/flags/README.md` first; score every active flag as a slice (§6.4), keep flagged episodes out of training labels where its `agent_action` says so, and write a new pattern as a flag in the producer's file (never by hand in `flagged_lines.csv`), then run `python tools/flag_lines.py`.

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
| E01 | 2026-10-10 | data commit `ab837cf`: 6,824 rows, 2026-10-08 04:59 to 2026-10-09 20:28 CDT (2 service days) + GTFS zip + tripUpdates fixture | DCC: one frequency trip id for all buses; 18% stale links, 48 mistimed transitions, route_stops correct. Drexel 0.86 per full lap (0.50 per trip id); misses follow trip-id flaps. Midway Metra variant (57th St Metra NB) missing from route_stops. Tails: holds at lots/turnarounds, layovers, stale links, > 20 m/s artefacts. Passio: logger mixes DCC buses (618 s vs 78 s MAE); leads >= 5 min sample Passio failures. Rules cut 2.3% of segments, keys 233 -> 192; backtest 2-5 min Passio 114 -> 62 s, shrunk 63 -> 53 s | **Adopt** `load_rows` rules (analysis side). Collector bugs B1-B4 applied 2026-10-10 (`cc40831`, `9eb11c7`, `2ba339c`, `c3831ca`); B5 open. `experiments/routeknower/E01-data-quality-2026-10-10.md` |
| E04 | 2026-10-08 | 2026-27 College Catalog | `data/calendar.json`: Autumn begins Sep 28; Thanksgiving Break Nov 23-27; reading Dec 5-7; finals Dec 8-11; quarter ends Dec 12; Winter Jan 4 - Mar 13; Spring Mar 22 - Jun 5 | **Done**; ship date moved to Nov 20 (§8) |
| E18 | 2026-10-12 | data `2c7f653`: 9,569 rows, Oct 8 to 12 (4 test days, rolling origin by day); 6,973 rider-facing Passio predictions, 2-3 min ahead | Passio today: 60% within 1 min, 30% of stops (36 of 119) have 80% of predictions within 1 min; buses come 40 s later than shown on average, a per-stop offset that is real (drive-through vs stopped r = 0.92) and stable (r = 0.89 across days). Per-stop offset fitted on earlier days: 62 -> 87% within 1 min, stops at goal 31 -> 85%, MAE 67 -> 42 s, but bus > 1 min early 3 -> 7% (quantile 0.8 per stop x daypart: 74%, early 3%). Our model / blends add nothing at this lead | **Worth pursuing; inconclusive** (< 10 test days). B5 first (score 5-10 min), then decide at T1 with the early-miss rule. `experiments/routeknower/E18-one-minute-goal-2026-10-12.md` |
| E19 | 2026-10-12 | data `2c7f653` (Oct 8-12, 4 test days) + raw polls Oct 10-12 + GTFS | 10% rule: Passio 2-5 min 13% (60% with a 1-min floor); ours 30% at 10 min, 20% at 30 min; timetable + current delay 63% at 30 min. 1% rule: reading B (at most 1% of L too late for most) holds, A1/A2 (< 1% too late) unreachable without destroying accuracy. Huge errors (> 5 min, 9.9% of rows, 1.1% post-fix at 2 min): 51% old logger bugs (fixed B1), 5% other-lap attribution (fixed today), 31% Passio stale (70% of post-fix: layovers), 5% Passio on the wrong run (bus 5-35 min early, dangerous) | **Not met**; collector now logs Passio at 1-30 min with previous-visit, per-bus, first-seen and on-display rules (`predictions.csv`); E20 next. `experiments/routeknower/E19-ten-percent-rule-2026-10-12.md` |
| E15 | 2026-10-08 | Traffic Tracker regions 2022-01..2026-04 x MDW METARs (64,551 joined hours) | Hyde Park speeds -2.0 % light rain, -3.5 % heavy rain, -3.5 % snow (95% CIs exclude 0); ~20 wet / ~5 snow service days expected Oct 8-Nov 30 | **Adopt as prior** for M14; weather secondary. `experiments/routeknower/E15-weather-traffic-prior.md` |
| E22 | 2026-10-16 | archived raw polls + prediction updates Oct 12-15 replayed through tools/arrival_detector.py (replay = live: 99.8% of arrivals, 99% of shared prediction rows identical) | DC-011: of the rows > 15 min off, the ones from a next-trip update listing the current lap (a time at or before the bus's previous visit under another trip id) were ours: 73-102 predictions.csv rows a day, 1,306-1,668 forecast-table rows; 30-min > 15 min off 32-39% -> 27-31%. The rest (95% from the update for exactly this visit, no visit near the predicted time) is Passio's own error | **Adopt**: the previous-visit time test now ignores the trip id (detector + build_eta_dataset); keep the remaining rows; 30-min Passio score usable |
| E23 | 2026-10-16 | eta tables Oct 12-15 (4 days with Passio predictions), rolling origin by day: learn Oct 12-13 / test Oct 14, learn Oct 12-14 / test Oct 15 (`experiments/routeknower/colab/routeknower_colab.ipynb`) | band B vs Passio: quantile trees (LightGBM, 17 features known at the query minute) 0-6 min 0.0, 6-10 +0.1, 10-15 +0.9 (0.1 to 1.7), 15-20 +1.4 (0.1 to 2.7), 20-30 +2.1 (-1.7 to 5.9), 30-45 -1.6 points; too late lower in every bin; per-stop shift table -2.1 to +2.0, 4 routes > 10% worse; deep tabular network (embeddings, multi-quantile pinball) identical to Passio in every bin. Passio itself: band B 4 to 24%, too late 4 to 9%. 40 s on a CPU, 713 MB | **Trees are the lead candidate (M9), not yet a ship candidate** (2 test days; gate needs 10, ~Nov 5-12). Deep learning parked until T3 or a GPS sequence input. Bigger gains need inputs (layover / terminal state, M5, M11, M13), not capacity |
| E21 | 2026-10-17 | raw polls + prediction updates Oct 10-16 replayed (tools/replay_day.py) with the GPS sweep (`Tracker._sweep`) | +1,826 `gps` rows (Red Line 773, Central 324, Downtown Campus Connector 214, South 183); every other arrival and predictions row identical; share of the stop visits buses drove past with a row 84-88% -> 91-95% a day (Red Line 55-75% -> 96-97%, South Oct 15 35% -> 86%); 196 sampled rows checked on the raw polls: about 99% real passes. Wrong-route detection: 6 episodes on Oct 15, none corroborated by Passio, pass-through drives fit too | **Adopt** the sweep (live from the next collector run; backfill Oct 10-16). Wrong-route override **off** (`GPS_WRONG_ROUTE`) until an episode can be confirmed. GPS rows carry no Passio prediction, so the 10 minute shrink scores do not change |
| E23b | 2026-10-17 | the same notebook rerun under the owner's new goal (the 10 minute shrink), eta tables Oct 12-16, test Oct 14, 15, 16 | band B (allowed error early to 1% late) vs Passio: trees 0-6 0.0, 6-10 +0.2 (0.1 to 0.3), 10-15 +0.6 (0.4 to 0.9), 15-20 -0.8 (-2.8 to 1.0), 20-30 +1.4 (-1.7 to 5.5), 30-45 -1.5; too late lower in every bin; North > 10% worse; deep +1.0 at 15-20 but too late higher; Passio band B 9 to 30%, within the allowed error 12 to 34%. 89 s, 810 MB | unchanged: trees lead, not a ship candidate (3 test days of 10); deep learning parked |
| E23c | 2026-10-17 | E23b with under 10 min measured once per arrival (owner: no gaming by always showing 1 min; goal bin 0-10 = the prediction nearest 5 min ahead) | band B vs Passio: trees 0-10 0.0, 10-15 +0.3 (0.1 to 0.5), 15-20 -1.2 (-2.8 to 0.1), 20-30 +1.4 (-1.5 to 4.8), 30-45 -1.4; too late lower; North > 10% worse; deep no gain. Passio 0-10 band B 17%, within the allowed error 21 to 22%. 81 s | unchanged: trees lead, not a ship candidate; deep learning parked |
| E24 | 2026-10-25 | eta tables Oct 10-24 (Passio Oct 12-24, 13 service days, 123,927 samples scored like summary.csv) + predictions.csv (`experiments/routeknower/E24-scripts/shortfalls.py`) | 10% rule, Passio: 8% (about 5 min), 17%, 25%, 32%, 15% (30-45); 93% of misses = bus later than shown, median error -1.7 to -9.2 min; current trip 4-12% vs next trip 15-40%; bus > 10 min late 5-10% at 15-30 min vs on time 34-51%; printed timetable ahead of Passio in 8 of 10 same-arrival cells, timetable + delay 58% vs 40% (next trip, 20-30); no time on display 15% to 83%; rush hours 53% and 4 routes 53% of misses; no trend over 2 weeks. Constant per-stop shift learned on past days: 10% rule to about 50% but too late 1 in 10 -> 2-5 in 10 (2026-11-01: that shift used the true lead, a leak; leak-free 22/38/47/52/38%, too late 11-43%: data repo `algorithm-test/results/10-e24-leak-check.md`) | Synopsis `docs/TEN-PERCENT-SHORTFALLS.md`, tables `experiments/routeknower/E24-ten-percent-shortfalls-tables.md`. A constant correction fails the 1% rule: parts A/B/C need per-bus features (trip type, delay, layover, route) |
| E25 | 2026-10-30 | 7 weekdays (Oct 20-23, 26-28) of raw polls + prediction updates + GTFS; truth = DC-020 lasting drops (267) | Can we say which bus is about to leave service (owner)? Best signal 'last trip of a rebuilt shift, ending within 45 min': 46% precision (leaves within 45 min), recall 4 of 193 drops 15 min before; Passio without next-trip times 25%; garage-ending trip 11%; most leaving buses are off-timetable (136 Downtown Campus Connector, 49 moved to another route) | Not shipped (rule: 90% precision at 15 min). `experiments/routeknower/E25-leaving-bus.md`; next: a learned model on more weeks or the operator's run assignments |
| E26 | 2026-11-01 | eta release tables Oct 12-30 (19 service days, 183,904 samples scored like summary.csv, 95/95 cells checked); rolling origin, test Oct 20-30, trained on earlier days only (a random quarter of every query minute); data repo `algorithm-test/` | Owner: individual algorithm or a deep-learning LLM? Band B vs Passio (18.3/9.8/10.7/20.7/12.0%): boosted trees q15 29.2/15.1/13.0/24.0/8.5 (too late +7.2 under 10 min); small network q15 29.9/16.9/16.0/26.0/10.9; network tuned per lead (`deep_safe`) 26.8/14.7/15.0/26.2/13.3 with too late -1.3..+0.9 (all within noise); fits that see the answers stay under 34%; trees plateau after 6 days, the network keeps gaining; no route > 10% worse for the network (trees: 3). Lateness perpetrators by excess late minutes: no-timetable trips (91% Downtown Campus Connector) 6.8%, buses > 10 min behind 4.3%, Red Line/Arts Block 3.1%, 3-7 PM 2.6%; all four fixed only 12.9 -> 17.5%. E24 headroom leaked the true lead (up to 10 points high, verdict stands) | A small specialized model (network first, trees as a check), not a language model; the inputs cap accuracy, so next add carried-over lateness, frequency spacing, dwell, traffic, bus changes, then rerun `algorithm-test/run_all.py`. `algorithm-test/CONCLUSION.md` |
| E27 | 2026-11-04 | raw position polls Oct 10 to Nov 3 (25 service days, 1.54 M fresh reports on known routes, 4,355 bus-hours) + each day's timetable (route lines, listed hours) + arrivals.csv + alerts.csv + pred-updates (`experiments/routeknower/E27-scripts/offroute.py`, `offroute_rules.py`) | Owner: hide buses "not following their routes for a long period of time (measure this by the bus operation data and their listed hours)". Inside the listed hours buses are within 40 m of their line 90.2% of the time, 300 m 95.9%, 1 km 97.7%. 1,506 runs > 300 m off the line; classed by the bus's own arrivals: in service on both sides (mid) median 1.5 min, p90 17.6, but the Downtown Campus Connector drives 2.5 km off Lake Shore Drive for up to 32 min with riders (every DCC bus Oct 22 4-7 PM, Oct 14, Oct 15), the Apostolic bus runs to the 57th St Metra station every weekday 8 AM (920 m, 23-30 min, along another line), a Midway Metra bus spent 76 min downtown (along the DCC line). A time limit alone cannot tell those from garage runs (the Nov 2 DC-022 buses: 19-24 min). The rule: > 300 m from its line AND every other line, 15 min inside the listed hours (+-30 min) / 5 min outside, never while the line's closest points spread >= 1.5 km since the clock started (following on another street) or the bus is >= 1 km closer than its farthest point (heading back), nor inside the hours during a detour alert. It hides 835 bus-min in 25 days (109 runs: 86 going to the garage after service 643 min, 12 never serving 131, 8 leaving the garage 21.5, 1 layover 0.5, 2 parked breaks mid-service 39.1: a Red Line bus at the garage Oct 12, a DCC bus parked 1 km off at Museum Campus Oct 14); 105 of 109 at the operator's garage (41.82, -87.64); hidden within 2 min of a logged arrival 0.5 bus-min, in the 10 min before the bus served again 17.3; no moving detour or Metra run hidden. DC-022: Central hidden from 00:11, North 00:23 to its last report, East 00:27 to 00:36 (and their 830 Passio prediction rows dropped with them) | **Shipped** 2026-11-04 as web `core/offroute.js` (data/live.js) + Kit `OffRoute.swift` (`LiveState.applying`), golden cases from real polls `web/tests/fixtures/offroute_golden.json` (`make_golden.py`); **replaced 2026-11-06 by E27b** (more than a block off its own line for 45 s). Without "heading back" the rule hides 932 bus-min, 66.5 of them in the 10 min before buses served again; without "following" too, 1,163 incl. 106 of buses in service on both sides (DCC detours); without "every other line" (own line only) 2,519 incl. 419 in service (the Metra runs, fill-ins) |
| E27b | 2026-11-06 | the E27 per-report table rebuilt for Oct 10 to Nov 5 (27 service days, 1.70 M fresh reports, 4,809 bus-hours; `offroute.py --cache`) + arrivals.csv + alerts.csv + pred-updates; candidate rules replayed report by report (`experiments/routeknower/E27-scripts/block_rule.py`, golden `make_golden.py`) | Owner: "If a bus is off it's route for more than a block, make the bus disappear from the map (so it does not confuse viewers of the route) as it is most likely not running anymore--still continue to track the bus." Inside the listed hours buses are within 40 m of their own line 90.1% of the time, 100 m 93.1%, 200 m 95.1%, 300 m 96.1%; reports every 5 to 15 s; a block = 1/8 mile (201 m), lines up to about 55 m from stops, parked jitter about 16 m. Grid D 150 / 200 / 225 / 250 / 300 m x one report / 2 reports / 30 / 45 / 60 s: at 200 m / 30 s 12,878 bus-min hidden with 1,207 short hides (back within 5 min), 508 of them the Downtown Campus Connector's downtown loop near Union Station, which runs 125 to 300 m off its drawn line every lap; at 250 m / 45 s 11,394 hidden (422 a day; the E27 rule hid 959 on the same days), 535 short hides (66 at the DCC loop). By what the bus did around it: going to the garage after service 5,707, never serving 1,643, leaving the garage 914, breaks 543, in service on both sides (arrival <= 15 min before and <= 20 min after) 2,588; hidden within 2 min of a logged arrival 107, in the 10 min before its next arrival 1,517; while Passio predicted it 7,717, of which it arrived within 10 min 1,170 (15%: dropping its times is right). Single reports past 250 m: 230, none hidden at 45 s (one real spike in the golden file: DCC 12643 Nov 5 21:49, 569 m). What the E27 exemptions kept visible that this hides (10,436 bus-min): near another line 5,298 (1,929 in service on both sides: the Apostolic 8 AM Metra run every weekday, about 30 min; Apostolic/Drexel trips near the 57th St Metra station), the 15 / 5 min clock 4,201, 250 to 300 m 593, following on another street 243 (all DCC: the Lake Shore Drive detours Oct 14, 15, 22), heading back 101; the detour alert exemption kept 226 shown. By route (hidden / in service on both sides): DCC 3,027 / 670, Apostolic/Drexel 2,562 / 1,002, Red Line 1,416 / 69, South 750 / 67, East 662 / 0, Apostolic 548 / 355, North 485 / 54, Friend Center/Metra 438 / 182, Central 414 / 40, 53rd St Express 392 / 63, Midway Metra 380 / 23, Drexel 190 / 19, South Loop 79 / 36, Regents Express 53 / 9. DC-022: Central hidden from 00:01 (E27 00:11), North 00:02 (00:23), East 00:09 (00:27) | **Shipped** as web `core/offroute.js` (BLOCK_M 250 m from its OWN line, CONFIRM_S 45 s on >= 2 distinct reports, only the operator detour alert exempts; data/live.js keeps the clocks and `store.away`, drops the bus and its trip updates; the route page says "1 bus is away from the route and hidden from the map.") + Kit `OffRoute.swift` (`LiveState.awayBuses`, RouteDetailView), golden real polls (every poll, 7 cases with alerts) `web/tests/fixtures/offroute_golden.json`; docs/ARCHITECTURE.md "Buses that do not follow their route". Owner trade-off to confirm: the Apostolic Metra run, Apostolic/Drexel near Metra and the DCC Lake Shore Drive detours (no operator alert) are now hidden while serving; a learned list of off-line service corridors (like E28's linger spots) could give them back |
| E27c | 2026-11-07 | the E27 per-report table for Oct 10 to Nov 6 (28 service days, `offroute.py --cache`, each day's timetable) + arrivals.csv + alerts.csv; corridors and rules replayed report by report (`experiments/routeknower/E27-scripts/corridor.py --eval [--split 2026-11-01]`, golden `make_golden.py`) | Owner: "the buses that are not driving on their designated routes are still showing sometimes (for example, the downtown connector still shows even if its not on its route)." Why: under E27b the Downtown Campus Connector was shown visibly off its drawn line (> 40 m) 10,750 of 86,582 shown bus-min, 3,244 of them > 100 m off while not in service (no arrival on its route 15 min before and 20 min after); all routes 6,169. Places: Union Station every lap (the drawn line takes Van Buren, the buses take Adams and Clinton, 125 to 350 m off: E27b's 250 m and its blinks), the Gleacher layover, and in Hyde Park not serving: a break spot at Cottage Grove and 60th (700 bus-min; Nov 6 12:11 to 12:39 bus 12642, Passio predicting it), 60th Street, buses parked inside the campus near 58th (about 200 m), garage roads. The experimental site ran the 2026-11-04 rule; the iPhone app had E27b. The Oct 28 Goldblatt reroute alert (no route, "construction") kept 145 bus-min of garage runs shown (115 > 2 km off); the standing UGo assistance alert never matches. Learned DRIVEN CORRIDOR: rasterized in-service movement (arrival <= 20 min before and after), 25 m cells driven on >= 2/3 of the route's days by >= 5% of its laps, 80 to 400 m from the drawn line, only days with the current line (AP/DX was redrawn Oct 26): DCC 311 points, AP 31, SLS 24, FCM 9, MM 6, South 2. Tried and dropped: a 10 min in-service window (loses Apostolic/Drexel and SLS paths, in-service hides 1,766), half of days (keeps the Cottage/60th break corner), a single tier at 120 m / 45 s (blinks 171 vs 93 in the test week), a 1 km detour cap (the DCC Lake Shore Drive detours ran 2.5 km off). Rule replay, E27b -> E27c, bus-min, 28 days in sample / Nov 1 to 6 with an Oct corridor: hidden 12,005 -> 14,549 / 2,598 -> 2,988; in service 1,651 -> 1,783 / 285 -> 272; within 2 min of an arrival 116 -> 223 / 20 -> 36 (mostly buses returning to start service); 10 min before the next arrival 1,641 -> 1,987 / 291 -> 343; blinks 438 -> 484 / 93 -> 93 (in service 237 -> 200 / 42 -> 22); shown > 100 m off not serving 6,169 -> 3,756 / 1,185 -> 782 (DCC 3,244 -> 1,962 / 681 -> 389); > 100 m off on another route's line 5,265 -> 3,159; GPS jumps beyond 500 m that came straight back: 1 single report, 1 run of 4 (FAST hides only two in a row) | **Shipped** 2026-11-07 as web `core/offroute.js` (distance to the line or `web/data/corridors.json`; FAR 250 m / 45 s, FAST 500 m twice in a row, NEAR 120 m / 2 min for routes with a usable corridor, detour alert within 3 km; data/static.js `cleanCorridors`, data/live.js passes store.corridors) + Kit `OffRoute.swift` (`CorridorData`, `StaticData.corridors`), golden real polls 11 cases (+ union, hp_stray, campus, alert_far). Refresh before valid_until (45 days) or after Passio redraws a line: `offroute.py --cache` on the archived days, then `corridor.py --cache ... --write web/data/corridors.json` (and `--eval` for the numbers). Proposal for the owner: redraw the DCC line downtown (Adams and Clinton instead of Van Buren). Owner questions (a) trip bus exempt, (b) off-line service runs: untouched (the 400 m cap keeps the Apostolic Metra run hidden) |
| E28 | 2026-11-06 | raw position polls Oct 10 to Nov 5 (27 service days; Nov 5 merged from the collector's artifacts) + pred-updates + each day's timetable + arrivals.csv (`experiments/routeknower/E28-scripts/`: fetch.py, endofservice.py, idle_rules.py, make_golden.py, lines_rank.py) | Owner: buses parked "in front of Regenstein library" at 11:50 PM shown as moving; log where buses linger at the end of a trip or shift (labeled file), stop showing and suggesting idle buses, name the 5 most affected lines. 7,982 dwell episodes (80 m, 3 min+) labeled from what the bus did next (`data/labeled/end_of_service/`, one CSV per day + linger_spots.csv + summary.csv): layover 6,756 (p50 6.5 min, p99 24.5), break 504, end_of_shift 448, garage_return 94, parked_never_served 180. Busiest spots: Goldblatt Pavilion (1,420), Reynolds Club on 57th St beside Regenstein (1,132; end-of-shift lingers start 23:49 median), Gleacher Center (895), Logan Center (735), Burton-Judson (405). The owner's buses: NightRide North 4328 / East 4325 / Central 4313 at Reynolds Club, South at Burton-Judson, Apostolic/Drexel at Goldblatt, every night 23:45 to 00:00 in a layover identical to the earlier ones (Passio predicting the midnight trip), then the garage; the feed lists no bus after about 00:05 (night routes listed to 04:29). Passio predicted 113 of 116 Downtown Campus Connector shift ends, and layovers can lack predictions: predictions alone cannot tell. Replay poll by poll of rules a phone can run (still clock within 80 m): idle 30 min with no prediction 2 min ahead (698 bus-min hidden, 140 in the 10 min before the bus served again: long breaks), parked 90 min (553, 6.7), past listed hours + 60 min and 3 min still (83, 0), learned linger cutoff per route + spot (latest still-then-served time + 2 min, >= 3 later shift ends; 465, 0; trained Oct 10-28, tested Oct 29-Nov 5: 134, 0). Without the learned cutoffs the 11:50 PM buses cannot be told from layovers (E25's 46% for leaving buses in general). | **Shipped** as web `core/idle.js` (data/live.js; data/idle.json, 11 cutoffs with the listed hours they were learned under, valid to Dec 20) + Kit `Idle.swift`, golden real polls `web/tests/fixtures/idle_golden.json`: 1,799 bus-min hidden in 27 days (67 a day), 4.9 within 2 min of an arrival; Nov 5: South hidden 23:49:46, North 23:50:16, Central 23:53:56, Apostolic/Drexel 23:53 and 23:58; East never (it logs the first stops of the midnight trip; twice in 27 nights it went past campus). Planner: no headway estimate past the listed hours. 5 most affected lines (`docs/LINES-MOST-AFFECTED.md`, six measures incl. E24 / E27): Downtown Campus Connector, Apostolic/Drexel, Red Line/Arts Block, East, Midway Metra. Refresh: fetch.py, endofservice.py --cache, idle_rules.py --write-idle web/data/idle.json (monthly or after a timetable change) |
| E29 | 2026-11-06 | raw position polls Oct 10 to Nov 5 (27 service days) + pred-updates + each day's timetable + arrivals.csv; events = tools/bus_changes.py rebuilt per day (`experiments/routeknower/E29-scripts/`: transitions.py, transition_rules.py, make_golden.py); bench = data repo `algorithm-test/transitions.py` (eta tables Oct 12 to Nov 5) | Owner: "a detailed log of bus behavior during transition time ... which buses go off the map or route and where (same for if a bus gets added)", add it to the prediction details, and stop recommending buses about to leave their routes. 1,926 transitions labeled (`data/labeled/transitions/`: transitions.csv + spots, summary, leave windows, README): leaves break 231, shift_end 205, route_switch 160, feed_drop 178, layover 181; joins from the garage 289, a break 226, another line 141, a layover 213, unknown 102; a weekday has about 40 leaves and 39 joins that are not layovers. Patterns: Downtown Campus Connector half of all leaves (midday breaks 11:00 to 13:45 at Midway Plaisance & Cottage Grove, 59th & Ellis, Rockefeller Chapel; rejoins at Rockefeller Chapel about 11:06; evening drop at Gleacher Center about 18:30, often off the map); Apostolic 4322 takes a half-hour break at South Campus Residence Hall at 08:42 to 08:44 (6 days) and the peak ends at S Drexel Ave & 57th St 09:50 to 10:05; Drexel and Midway Metra leave about 10:00, mostly to another line; Red Line 4331 breaks about 10:20 to 10:35 and 14:15 (garage); Apostolic/Drexel steps down at Goldblatt about 20:50 to 21:00; NightRide shift ends at Ellis Ave & 57th St 21:15 to 22:05. Passio kept predicting 611 of 774 lasting leaves (a median 20 min after a break, 14 after a shift end): 4,164 stops promised that the bus never served. ABOUT TO LEAVE, per visit (82,569, 0.6% a bus's last stop before leaving), held out Oct 29 to Nov 5: the line's leave window (+-15 min, same stop) >= 0.3 31%, + Passio nothing beyond 32%, the trip >= 0.5 25%, a small network top-k 30 to 50%; the same bus at the same stop and time on earlier days >= 0.7: 91% (10 of 11) but recall 6.6% and 72% on the training days. GONE (a bus silent >= X min while the feed is alive and its last two reports <= 120 s apart): X = 15 min, 98.8% of Passio's dropped times never came true (train 98.75%, test 99.2%; 650 phantom prediction-min removed a day, 7.8 real ones lost), 10 min 91.2%, 5 min 75.9%; Apostolic/Drexel 86% (long layovers out of the feed). Bench (test Oct 26 to Nov 5, 18.5% of samples within 15 min of a transition): band B normal / transition, Passio 15.7/15.0, 10.4/6.8, 10.3/7.6, 21.0/12.1, 14.1/6.1; deep_safe 25.7/24.1, 15.1/13.9, 14.9/12.2, 27.7/19.5, 11.0/12.1 (every predictor worse at 10 to 45 min, the models keep their lead); 70.0% of Passio's times for a bus in the 45 min before it leaves never came true (35.5% otherwise) | **Shipped** the gone rule as web `core/transition.js` (data/live.js drops the gone buses' trip updates with dropHidden) + Kit `Transition.swift` (`LiveState.applying`), golden real polls `web/tests/fixtures/transition_golden.json` (Central 4317 dropped 16 min after it left, DCC 12643 15 min, two layovers out of the feed and a sparse reporter never); docs/ARCHITECTURE.md "Buses that left their route". About to leave **not shipped** (no high-precision signal; the vehicle-run cue to revisit with 3+ more weeks). Forecast table: transition_min, transition_kind, bus_leaves_min, bus_leaves_within, added_recently, break_window, leave_spot_dist_m, absent_s, gone_rule (docs/DATA.md); data repo CONCLUSION section 6. Refresh: fetch.py (E28), transitions.py --cache, transition_rules.py --windows-out data/labeled/transitions/leave_windows.csv |
| E30 | 2026-11-11 | raw position polls Oct 10 to Nov 10 (32 service days; Nov 10 merged from the collector's run artifacts) + pred-updates + each day's timetable + arrivals.csv + predictions.csv (+ its archive) + E28 dwell episodes; E29 refreshed through Nov 10 first (2,250 events; the 1,926 of Oct 10 to Nov 5 identical). `experiments/routeknower/E30-scripts/` (odd_lib, odd_feed, odd_labels, odd_passio, odd_schedule, odd_dwell, run_odd, flags; test_odd.py 24 tests) | Owner: "buses that have odd behavior during transition times ... Flag these lines and also tell me." Transition windows = 30 min around a non-layover bus count change, a shift change, a listed start or end, a timetable step. 22 measured behavior codes, 5,815 episodes (`data/labeled/transitions/odd_episodes.csv`, `odd_summary.csv`, README there). All lines per 10 bus-hours inside vs outside the windows: vanishing from the feed mid-route 0.96 vs 0.41, off the line 3.49 vs 1.22, lingering not in service 2.53 vs 1.10, under another line's label 0.30 vs 0.05, after hours 0.49 vs 0.26, position jumps 1.24 vs 0.81. Repeat buses: 4322 has 170 of 387 vanishings (124 near South Campus Residence Hall, Apostolic and Apostolic/Drexel 6 to 9 AM) and 250 of 578 jumps; 12647 55 of 61 sparse-reporting episodes (Downtown Campus Connector, 6 days); 4331 16 of the 18 Apostolic/Drexel-label runs on Friend Center/Metra's loop about 6 PM. Timetable against the feed: listed ends outlast the service every weekday (Downtown Campus Connector 00:25 vs last bus 22:04 to 23:09, Apostolic/Drexel 00:55 vs 00:00, 53rd Street Express 19:25 vs about 18:10, Midway Metra's morning span 11:55 vs about 10:00 on 20 of 22 weekdays); North's 9 PM second bus missing on 26 of 32 days; Friend Center/Metra's 5 AM weekend listing never runs. Passio: times kept 5 min or more for 312 of 915 lasting leaves (257 past 15 min); a joining bus has no Passio time on 27.0% of its first-30-min arrivals vs 10.1% of the others (every line 1.9 to 4.3 times); after a 2-to-1 drop the staying bus's error 10 to 20 min ahead is 14.7 vs 6.2 min on Apostolic (42 times, 21 drops) and 8.8 vs 5.2 on Drexel, all lines 5.1 vs 5.3 (DC-020 holds on Apostolic and Drexel, not across lines). Nov 6 to 10 against before (5 days): Passio's feed the same within noise (ghost times 41.8 vs 32.7 per 100 lasting leaves, vanishing 0.83 vs 0.98, jumps 0.83 vs 1.31 with 4322 quieter) | **Flags** `data/labeled/flags/transition_flags.csv`: 40 (9 high, 25 medium, 6 low; the E30 severity rule in data/labeled/transitions/README.md). High: service_end_early on 53rd Street Express, Apostolic/Drexel and the Downtown Campus Connector; Apostolic feed_drop_mid_route and position_jump (bus 4322); Downtown Campus Connector sparse_reporting (12647); after_hours on Central and Midway Metra; South linger_not_in_service. No app change (E32 replays the shipped display rules on these episodes). Models: slice every flag; keep vanishing, sparse, frozen and wrong-label episodes' arrivals out of training labels. Refresh: README "Reproduce / refresh"; follow-ups E30b to E30d (section 7) |

**E29 retry procedure: which bus will leave (owner 2026-11-06: "retry which bus will leave after applicable intervals of
new data collected and revise it").** Automatic, in the data repo (github.com/blobberus/straight-bussing-data):
`.github/workflows/findings.yml` runs every Monday about 17:41 UTC and by hand (`gh workflow run findings.yml -R
blobberus/straight-bussing-data`). It clones this repo read-only, downloads every archived service day, reruns
`E29-scripts/transitions.py`, `E28-scripts/endofservice.py` and `E29-scripts/transition_rules.py` with an expanding
window (train on every day up to 7 days before the newest, test on the newest 7), appends one row per signal to
`findings/leave_eval_history.csv`, re-learns the leave windows, and rebuilds the agents' workbook
`findings/straight-bussing-findings.xlsx` (+ `findings/csv/`, index `findings/README.md`). A signal is READY when the
data reaches 2026-11-26 (3 weeks past Nov 5), held-out precision >= 90% and recall >= 20% on >= 30 flagged visits, training
precision >= 85%, on two weekly runs in a row (reruns on the same week never count twice); then the workflow opens or
updates ONE data repo issue, "Leave prediction ready for review". It never changes the app. First run (2026-11-06, data
Oct 10 to Nov 5, trained to Oct 29, tested Oct 30 to Nov 5): nothing ready; best the same bus on the same run 8 of 9
(89%) but recall 6.5%, the line's window + Passio 13 of 35 (37%); the shipped gone rule 99.1%. To ship a ready signal (a
reviewed change, owner's go-ahead):
1. Reproduce here: `python experiments/routeknower/E28-scripts/fetch.py --out <dl> --from 2026-10-10 --to <newest
   archived day>`; `python experiments/routeknower/E29-scripts/transitions.py --dl <dl> --out data/labeled/transitions
   --cache <c.pkl>`; `python experiments/routeknower/E29-scripts/transition_rules.py --dl <dl> --transitions
   data/labeled/transitions/transitions.csv --train-to <newest day - 7> --windows-out
   data/labeled/transitions/leave_windows.csv --json e29.json`; the signal's held-out row must match the issue.
2. Write the signal's learned table to `web/data/` (route, stop, clock window, day type, vehicle if the signal uses one,
   the listed hours it was learned under, `valid_until` 45 days after the last learned day), the way `idle_rules.py
   --write-idle` writes `web/data/idle.json`; load it in `data/static.js` and Kit `StaticLoader`.
3. A pure rule in `web/js/core/transition.js` (e.g. `leavingBefore(bus, ride, table, t)`) used only by `core/planner.js`
   `wait()` (skip a live arrival whose bus would pass its learned leave stop inside the window before the rider's alight
   stop; take the next live bus or the headway estimate, "est.") and the Nearby next bus; never the map. Port 1:1 to Kit
   `Transition.swift` + `Planner.swift`; golden cases from real polls (`E29-scripts/make_golden.py`).
4. Ship gate: the issue's numbers on two runs, no line where it is wrong more than 10% of the time, owner review; full
   browser suite, `tools/test_precache.py`, sw bump, iOS CI on the branch, one commit. Keep watching
   `leave_eval_history.csv`: two runs under 85% precision = remove the table.

## 12. Open questions
- Does Passio's ETA come from a schedule or from live positions? (Error = predicted - actual: the pilot's -33 s and E18's -40 s mean buses come *later* than Passio shows, by a stable amount per stop; corrected 2026-10-12, this line used to say the opposite.) M2/M10 answer it.
- Are some stops request-only at night (no row when skipped)? Affects Q4 and the night-route models.
- Does the academic calendar (class changes at :50 to :10) show up in dwell and run times? E08, E14.
- How different is campus weather from Midway's (lake effect)? Compare `wx_*` with `gr_*` once wet days accumulate.
- Permission from UChicago Transportation is still unresolved (`.claude/rules/project.md`); collection stays low-volume, public-data-only.

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
beyond 5 minutes ahead cannot be scored until fixed-lead predictions are logged (E01 B5; logged in
`data/ground_truth/predictions.csv` since 2026-10-12).

> **Superseded (review 2026-10-08).** This was the first plan. Several parts no longer match the project:
> collection now runs on GitHub Actions + a local fallback (`monitoring.md`), not `tools/collect.py`; ground
> truth is `data/ground_truth/arrivals.csv` on the `data` branch (`docs/DATA.md`); the models are
> `tools/model_*.py` (`docs/ALGORITHMS.md`); and the experiment plan, data targets and test protocol are in
> **`RouteKnower.md`**. Keep this file for history only; do not follow its deployment advice.

# Learning real bus patterns (plan)

Goal: predict how long a bus takes to reach a stop better than Passio GO!'s own ETA, and prove it
with numbers. Everything below is stdlib Python + one plain browser script; no server needed.

## Pieces

| File | Role |
|---|---|
| `tools/build_gtfs.py` | also writes `web/data/segments.json` (scheduled seconds per consecutive stop pair, dwell, headway) |
| `tools/collect.py` | polls the 3 Passio realtime feeds, appends `data/observations/YYYY-MM-DD.jsonl.gz` |
| `tools/obslib.py` | shared: loading, ground-truth arrival extraction, aggregation |
| `tools/learn.py` | observations -> `web/data/learned.json` |
| `tools/evaluate.py` | MAE per horizon: Passio vs schedule vs learned (held-out trips) |
| `web/predict.js` | `window.Predict` used by the planner |

## Data schema (one JSON object per line, gzip members appended)

- Vehicle: `{"k":"v","t":poll_ts,"id":vehicle,"r":route,"tr":trip,"la","lo","sp"(m/s),"b"(bearing),"s":stop_id,"q":current_stop_sequence,"vt":vehicle_ts,"oc":occupancy}`
- Passio prediction: `{"k":"p","t":poll_ts,"tr","r","id","p":[[stop_seq,stop_id,predicted_arrival_ts],...]}` (first 15 stops per trip)
- Alerts: `{"k":"a","t","n","e":[...]}` (every ~30th poll)

Size: about 1.5-2 KB gzipped per poll, so roughly 10-15 MB/day if run around the clock (less at night).
`data/.gitignore` keeps `*.jsonl.gz` out of git.

## Ground truth (what "actual arrival" means)

Passio's `stop_id` is the NEXT stop the vehicle is heading to (distance to it shrinks poll to poll).
Actual arrival at stop S for a trip is derived two ways:
1. Closest-approach poll within 40 m of S (only stops on that trip's route). Resolution is about
   the poll interval (10 s), fine for segments of 1-3 minutes.
2. Fallback: `current_stop_sequence` increases, so the previous stop was just left; its time is that
   poll. Biased late by dwell plus up to 10 s.
Segment sample = arrival(B) - arrival(A) for adjacent route stops, minus scheduled dwell. Samples
over 4x schedule + 10 min (layovers, detours) or under 5 s are dropped. Matching is by position in
`route_stops.json`; ambiguous pairs (stop pair twice in a route) are skipped.

## Models, in order

1. Baseline (live now): scheduled seconds per segment, summed along the route (`segments.json`).
   Caveat: GTFS only has times at timepoints; the rest are interpolated by distance, so some
   scheduled segments are rough.
2. Per-segment medians by hour-of-week (168 buckets, America/Chicago, Monday=0), shrunk toward the
   schedule: `w = n/(n+5)`, `est = w*learned + (1-w)*schedule`. Medians (plus p10/p90 stored) resist
   outliers. Needs only a few weeks. This is what `learn.py` produces.
3. Later, when there is enough data: gradient boosted trees (quantile loss, p10/p50/p90) on
   segment travel time, trained offline in Python (a stdlib tree ensemble is possible; scikit-learn
   or LightGBM if allowed), exported as small lookup tables or tree JSON for `predict.js`.
   Candidate features: route, segment index, hour, day of week, holiday/academic-calendar flag,
   weather (optional, free NWS API), upstream delay (how late the bus already is vs its own
   typical time), current speed, vehicle occupancy, time since last stop, headway to the bus ahead.
4. Live correction: blend learned travel time with the bus's current position/progress so the
   estimate tightens as the bus approaches (the evaluation compares by horizon for this reason).

## Evaluation (the proof)

`python tools/evaluate.py` takes each poll's Passio-predicted arrival P for (trip, stop) and the
derived actual A, and reports MAE of P-A bucketed by true time-to-arrival (0-2, 2-5, 5-10,
10-20 min). The schedule and learned estimates are scored on the same rows. Learned is trained on
the earliest 70% of trips and tested on the latest 30% (no leakage); with under 10 trips it prints
that it cannot hold out. Report median absolute error and the 80th percentile too once data allows
(riders feel the bad tail). Success criterion: learned MAE < Passio MAE at 5-10 and 10-20 min.
`learn.py` also fits a per-route multiplicative bias of Passio ETAs (`bias`), which
`Predict.etaAdjust` can apply to Passio's live number.

## How much data

- ~1 week (all hours): medians per segment exist, hour buckets mostly empty -> falls back to all-hours median.
- 4-6 weeks incl. weekdays/weekends: usable hour-of-week model; first honest evaluation.
- A full semester (and a break) before trusting term-calendar effects; a year for seasons.
Class-change times and weather are where the schedule is most wrong, so expect gains there first.

## Deploying the collector

10 s polling needs an always-on process. Not suitable: GitHub Actions (cron min is 5 min, jobs are
short and unreliable), free serverless tiers. Suitable:
- This Windows PC: `python tools/collect.py` in a Task Scheduler task ("At log on", restart on
  failure, "Run whether user is logged on or not"). Loses data when the PC sleeps.
- Raspberry Pi / small always-on VPS (about $4/month): `systemd` unit running
  `python3 tools/collect.py`, restart=always. Best option; rsync `data/observations/` home weekly.
Use the default 10 s interval or slower; one request per feed per poll; User-Agent
`StraightBussing-collector (student project)`. Do not poll faster than the feed updates.
Then: `python tools/learn.py && python tools/evaluate.py`, commit `web/data/learned.json`
(small, a few tens of KB).

## How the web app consumes it

`web/predict.js` loads `data/segments.json`, `data/route_stops.json` and (optional, 404 tolerated)
`data/learned.json`. `Predict.rideMinutes(route, from, to, whenTs)` sums segments along the route
order (loops wrap when first == last stop) and returns `{min, source:'schedule'|'learned', conf}`;
`min:null` when unknown. It never throws. The planner MUST present these durations as estimates
(e.g. "about 12 min", "est."), never as guarantees, and show a lower-confidence style when
`source:'schedule'`. The service worker should cache `learned.json` network-first.

## Privacy

Only public vehicle telemetry is collected: vehicle id, position, route, trip, predictions. No rider
accounts, device ids, locations of users, or analytics. Vehicle positions are not personal data,
but data/observations/ stays out of git. Do not publish raw logs without checking Passio/UChicago terms.

## Risks

- Permission from UChicago Transportation is unresolved; the collector is low-volume and identified.
- Feed changes (ids, schema) break extraction; `learn.py` skips bad lines but check the stats it prints.
- Route/stop ids change at each GTFS refresh; learned.json is keyed by route id and segment index, so
  regenerate it after `route_stops.json` changes (a stale model would mislabel segments).
- Detours, breakdowns, bus swaps pollute samples; medians and the sample filters limit this.
- Selection bias: only completed segments are learned; cancelled trips are invisible.
- Overfitting to little data: shrinkage and the held-out evaluation guard against it.

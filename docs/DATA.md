# Ground-truth arrival data

Goal: a growing, honest record of **when buses really reached each stop**, to measure Passio's
predictions and train our own (`tools/model_*.py`, `docs/ALGORITHMS.md`). Unofficial, estimates only.

| File | Where | What |
|---|---|---|
| `data/ground_truth/arrivals.csv` | `data` branch only (git-ignored on main) | real arrivals, collected around the clock (every 10 s), merged about every 40 min (once per CI run) |
| `data/ground_truth/predictions.csv` | `data` branch | since 2026-10-12: Passio's prediction 1, 2, 3, 5, 10, 15, 20 and 30 min before each arrival (one row per arrival and lead; schema below), for the owner's "10% rule" |
| `data/ground_truth/alerts.csv` | `data` branch | since 2026-10-14: the operator's service alerts (Passio `serviceAlerts`), one row per alert version with when our collector first and last saw it (schema below); context for odd days (detours, reduced service), not ground truth about buses |
| `data/ground_truth/archive/*.csv` | `data` branch | same schemas, rotated when a live file passes 40 MB (arrivals, predictions; alerts.csv never rotates) |
| CI artifacts `raw-polls-<run>`, `pred-updates-<run>` | GitHub Actions, 90 days | every position poll (E03) and every Passio prediction update `[veh, trip, stop_id, made, predicted, seq, seen, last]` (repeated about once a minute while it stays on display) per run (`tools/raw_fetch.py --list`) |
| Release `data-archive-YYYY-MM` assets | GitHub Releases (prerelease), kept | from service day 2026-10-12 on (Oct 10-11: positions only), one set per service day, uploaded the morning after: `pred-updates-<day>.jsonl.gz`, `raw-polls-<day>.jsonl.gz` (the two artifacts merged and deduped), `eta-<day>.csv.gz` (forecast snapshots, below), `gtfs-<day>.zip`, and from the first day alerts were collected `alerts-<day>.csv.gz` (the alerts.csv versions in the feed at some poll of that service day; header only = none seen); about 5.5 MB a day, no growth of the git history (`.github/workflows/archive.yml`, `tools/archive_day.py`) |
| `data/eta/summary.csv` | `data` branch | the owner's goal (10 minute shrink; the 10% rule beside it) per service day x source x lead bin x route / segment (below); a few hundred rows a day |
| `web/data/learned.json` | `data` branch | model refreshed after each run (if `tools/refresh_model.py` exists) |
| `data/ground_truth/synthetic_arrivals.csv` | main | **fake**, seeded 3-week demo (ids start `syn`); `tools/make_synthetic_truth.py` |
| `web/data/places.json` | main | named places within a 30-min walk of campus stops for on-device place search; `tools/build_places.py` (OpenStreetMap Overpass, ODbL); refreshed by the daily Pages run |
| `web/data/stop_addresses.json` | main | `{stop_id: {address, street, housenumber?, neighborhood?}}`; `tools/build_addresses.py` |

## Schema (one row = one bus arriving at one stop)
Plain-English version of every column, with a worked example row and spreadsheet recipes: `docs/DATA-GUIDE.md`.

`epoch` unix s (UTC) · `ts_utc` ISO · `local_time` America/Chicago wall clock · `dow` 0=Mon · `hour` ·
`minute_of_day` · `route_id` `route_name` `trip_id` `vehicle_id` (Passio) · `stop_id` `stop_name`
`stop_address` `stop_lat` `stop_lon` · `stop_index` position in `web/data/route_stops.json[route]` (loops: last
index = back at the first stop), plus the stops only a route's other timetable pattern serves (`data/route_patterns.json`,
since 2026-10-13: Midway Metra's afternoon 57th St. & Metra (NB) is index 14, so its loop end 57th St. & Metra (SB)
is 15 from then on, 14 before) · `prev_stop_id` `prev_arrival_epoch` previous detected stop of the same
trip (stops in between may have been skipped; blank if it is > 25 min old or the bus logged another arrival
in between) · `dist_prev_m` metres along the route shape
(`web/data/shapes.json`; else haversine x 1.15) · `segment_s` = epoch - prev_arrival_epoch (includes the
previous dwell) · `speed_mps` = dist / (segment_s - previous dwell), blank if > 30 m/s · `dwell_s` time
stopped here (0 = drove through, blank = unknown) · `passio_pred_epoch` Passio's newest prediction for this
bus + trip + stop (at a loop terminal: the one with the matching stop_sequence) made >= 120 s before the
arrival, `passio_pred_lead_s` = epoch - when it was made · `source`
`transition` | `proximity` | `pass` (since 2026-10-13) | `gps` (since 2026-10-17, DC-003; `trip_id` may be blank,
no prev / dwell / Passio prediction). Rows are appended when the bus leaves the stop (a `gps` row 10 min after the
visit), so files are only roughly sorted.

## predictions.csv (added 2026-10-12; one row = one arrival x one target lead)
The arrivals file keeps its 25 columns; this file sits next to it. Join on `vehicle_id` + `stop_id` + `epoch`
(within 300 s: two collector runs can time one arrival a few seconds apart). Owner goal (since 2026-10-17), the **10 minute
shrink**: a prediction made L before the arrival should be right within 3 min at >= 30 min ahead, 2 min at >= 20 min, 1 min below (`arrivals_lib.shrink_tol`;
from 2026-10-12 to 10-16 the goal was the 10% rule, 10% of L).

`epoch` `local_time` `route_id` `route_name` `trip_id` `vehicle_id` `stop_id` `stop_name` `stop_index` (as in
arrivals.csv) · `lead_target_s` 60, 120, 180, 300, 600, 900, 1200 or 1800 · `pred_epoch` Passio's newest
prediction for this bus at this stop **on display** `lead_target_s` before the arrival (made and first seen by our
poll by then) · `pred_made_epoch` when it was made (Passio's trip-update timestamp) · `pred_lead_s` = epoch -
pred_made_epoch (>= lead_target_s; the excess is how stale the prediction was at that moment) ·
`pred_minus_actual_s` = pred_epoch - epoch (**positive = the prediction was later than the actual arrival: the bus
came early**, the case riders miss) · `pred_seen_epoch` the poll that first showed this update (blank on rows
logged 2026-10-12 12:20 to about 13:00 CDT, before the column existed). Passio sometimes changes the predicted time
and keeps the old timestamp (57 of 651 updates on 2026-10-12), so the lead is judged by max(made, seen): a
prediction that appeared 30 s before the bus can't pass for a 10-minute one. It must also still have been on
display then: a poll showed it within 90 s of that moment (`SHOW_GRACE_S`; the tracker keeps each update's first and
last sighting). A missing row = **no prediction on display** at that lead (none yet, it often does not predict a run
before it starts, or Passio had withdrawn it), which is itself a rider-facing count, not a data gap.
**Scoring notes** (`experiments/routeknower/E19-*`): at a route's first stop Passio predicts the departure, so
compare there with epoch + dwell_s; score Passio on rows from 2026-10-10 05:18 CDT on (collector fixes B1-B4).

Attribution (`Tracker._candidates`, same rules as `passio_pred_*` in arrivals.csv since 2026-10-12): this bus's own
predictions (E01 B1; an update without a vehicle id only when no other bus has that trip id); at a loop stop only
the matching stop_sequence; and, when the bus's previous visit to this stop was on the same trip id,
**not** a prediction made before that visit or predicting a time within 120 s of it (`PREV_VISIT_GAP_S`): that one
was about the earlier lap of a loop that keeps its trip id (Downtown Campus Connector). A previous visit under another
trip id does not block (a real 30-min-ahead prediction for the next run of a 15-min loop is made before it). A stop_sequence that names this visit on
the same trip overrides it (one update predicts both ends of a loop).
**Re-matched trip ids** (since 2026-10-14, `Tracker._other_trip_preds`; predictions.csv only, `passio_pred_*` keeps the
own trip id): Passio's tripUpdates move a running bus between two or three timetable trip ids and back within minutes
while vehiclePositions keeps one (Central, Apostolic/Drexel, Friend Center/Metra), and the stop's prediction moves
with them; a screen still lists it under the bus's number. On 2026-10-13 that was 86 of the 144 arrivals with a 20-min
row but no 10-min row (Central: 23 of 45). A lead shorter than one the own trip id filled (so the stop was still
ahead of the bus) and left empty by it takes the earliest time **this bus** (same vehicle id; never another bus or an
update without one) showed for the stop under another trip id, by the same display rule and no more than 30 s past
(`SHOWN_PAST_S`), first seen after its previous visit there and predicting 120 s or more past it, from a trip update
about the run it was on: its first stop not on display (else it is the bus's next trip, a lap ahead or rolled over
early) and no later stop of it predicted earlier (else Passio has the bus past the stop). Never at loop stops. The
row's `trip_id` stays the arrival's. Replaying 2026-10-13 (archived pred-updates + raw polls): +290 rows, no existing
row changed; coverage 10 min 75.9 -> 77.2%, 20 min 57.2 -> 57.5%, 30 min unchanged; Central 10 min 38 -> 62%; the
added rows' errors look like Passio's usual early bias (median -35 s at 1 min, -195 s at 10 min; 6 of 290 off by
more than 15 min). Rows logged before 2026-10-14 lack them (the data branch is not rewritten). The remaining gaps
are mostly real: Passio showed nothing for that bus at that stop then (44 of the 144), or only its next lap.
Coverage: a CI run only knows predictions
from its own start (runs overlap ~30 min, so each arrival is covered by the run that started 30 to 70 min before
it); local chunks reload the last hour of updates from the previous chunks (`--pred-seed`). Merge:
`tools/merge_predictions.py` (duplicate = vehicle + stop + lead within 300 s; the fresher prediction stays).

## alerts.csv (added 2026-10-14; one row = one version of one operator alert)
What the operator told riders through Passio's `serviceAlerts` feed (detours, stop closures, reduced service,
"buses delayed", the route-help phone number), with the time window our collector saw it in the feed. A context
feature: it explains anomalies in arrivals.csv / predictions.csv, it says nothing about where buses were.
Collected by `tools/truth_logger.py --alerts-out` (class `AlertLog`): **at the start of each run and every 5 min**
(`--alerts-every 300`), in its own thread with its own 8 s timeout and counters, so a slow or dead alerts feed can
never delay or stop the 10 s arrival loop. Each run writes its versions to `run_alerts.csv`; `tools/merge_alerts.py`
merges them into this file in the same commit as the arrivals (a merge failure only warns: the arrivals are still
pushed). Parsing and the version rule: `tools/alerts_lib.py`. Tests: `tools/test_alerts.py`.

A **version** = a 12-hex hash of header, description, cause, effect, active periods and informed entities
(order-independent; Passio's extra `startDatetime` / `endDatetime` strings are ignored). A changed text, window or
route makes a new row; the same version seen again only moves `last_seen`. Merge: one row per `version`, earliest
`first_seen`, latest `last_seen`, every entity id joined; the file is rewritten whole, sorted by `first_seen`
(a few versions a day; no rotation). Since 2026-10-16 (DC-012): Passio's entity id is the alert's place in the feed,
so an alert's id changes when one listed above it ends ("UGo Bus Route Assistance" went from 2 to 1); rows used to
be keyed by id + version and split there; the next merge collapses such rows.

`alert_id` every Passio entity id the version was seen under, `;`-separated (`1;2`); positions in the feed, not
stable ids: **key on `version`** ·
`version` · `first_seen` `last_seen` unix s of the first / last of our polls that showed it, plus `first_seen_local`
`last_seen_local` (Chicago clock) · `active_start` `active_end` the earliest start / latest end of its active
periods (epoch; blank = open on that side, or no period = always active), `active_start_local` `active_end_local` ·
`active_periods` every period as `start/end` joined with `;` (a blank side is open) · `cause` `effect` verbatim
(blank when Passio sends none: so far it never has; never defaulted to UNKNOWN_*) · `agency_ids` (`1068` = the whole
network) `route_ids` `stop_ids` from the informed entities, joined with `;` (a trip entity adds its route_id) ·
`route_names` aligned with `route_ids`, filled only for ids in `web/data/routes.json` · `header` `description` the
English (or untagged) translation, else the first, **verbatim** (commas, quotes, line breaks are CSV-quoted).

**Caveats.** Times are poll times, so good to about 5 min (overlapping runs poll independently, often closer): an
alert left the feed within ~5 min after `last_seen`, and one that appeared and vanished between two polls, or while no
collector ran, is missing. A version that leaves the feed and comes back unchanged keeps one row (its first_seen to
last_seen spans the gap). The first rows' `first_seen` is when collection began, not when the operator posted them:
`active_start` is the operator's own start. **Route ids are not always GTFS ids**: on 2026-10-14 the North alert named
route `38734` (Passio's own id; GTFS North is `1075`), so `route_names` is blank there and a join on `route_id` misses
it; match by header text or treat it as unknown. For leakage-safe features at a moment t use only versions with
`first_seen <= t`; "shown at t" = first_seen <= t <= last_seen (+ up to 5 min), "in effect" = active_start <= t <
active_end. Fetch health per run: `logger.json` keys `alert_polls` `alert_ok` `alert_fetch_errors` `alert_errors`
`alert_last_error` `alert_versions` `alert_in_feed`; the run summary line ends `alerts: N versions, F of P polls
failed`, and a `Service alerts not collected` warning appears when more than half failed (never part of the
"Collector run degraded" verdict).

## Forecast snapshots for training and analysis: `eta-<day>.csv.gz` (added 2026-10-12)
`tools/build_eta_dataset.py`. **One row = (query minute t, bus, one of that bus's arrivals in (t, t + 45 min])**, plus
rows for a visit Passio showed at t that no arrival matches (`label_status` no_arrival: a bus going out of service, a
wrong run, or a stop the detector missed). It answers the question a rider asks at t, so it is the **training
table**; `predictions.csv` stays the **evaluation** view (one row per arrival and fixed lead, no oversampling).

Columns: `query_epoch` `query_local` `service_day` `dow` `day_type` (weekday / weekend) `cal_regime`
(data/calendar.json) `hour` · the bus: `vehicle_id` `cur_trip_id` (from the latest position report, else its last
arrival) `last_stop_id` `last_arrival_epoch` `last_age_s` `speed_mps` `standing_s` (seconds it has stayed within 40 m;
raw polls) `delay_s` (its last arrival minus the timetable time of that stop) · the target: `route_id` `route_name`
`trip_id` `stop_id` `stop_name` `stop_index` `visit_rank` (1 = the bus's next visit to that stop on that trip, 2 = the
lap after) `next_trip` (the target is on a later trip than the one it drives now) `stops_away` `dist_m` (along the
route shape from its last stop) `crosses_terminal` · the label: `actual_epoch` `lead_s` (= actual - t)
`label_status` (arrived / no_arrival) · the predictions, each with `_err_s` = predicted - actual (**positive = too
late, the bus came early**) and `_rel` = err / lead_s, so **the 10% rule is |rel| <= 0.10 at every lead and "too late"
(reading B) is rel > +0.01**: `passio_status` (shown / none / previous_lap) `passio_epoch` `passio_made_epoch`
`passio_seen_epoch` `passio_age_s` `passio_err_s` `passio_rel`; `tt_epoch` (GTFS timetable of the target trip; blank
on headway trips, the Downtown Campus Connector) `tt_err_s` `tt_rel`; `ttd_epoch` (timetable + the bus's current
delay) `ttd_err_s` `ttd_rel`. Passio at t uses the collector's rules (this bus, loop stop_sequence, first seen by t
and still shown within 90 s, only for its next visit; an update made before the previous visit on the same trip =
previous_lap; since 2026-10-16 (DC-010) a minute the own trip id left empty, after one it filled for the same arrival,
takes the bus's prediction under a trip id Passio re-matched it to, by the detector's own rule, as in
predictions.csv, and that time is no longer a no_arrival row). Inputs: the archived `pred-updates`, `raw-polls`, `gtfs` files of the day and arrivals.csv. About
130,000 rows and 4 MB gzipped per service day.

**Aggregating it (`summary()`, `data/eta/summary.csv`).** Rows of one arrival are near-copies (up to 45 per arrival),
so never average over rows: per source and lead bin (the goal bins 0-10, 10-15, 15-20, 20-30, 30-45 min; under 10
min the goal counts each arrival once, owner 2026-10-17; plus the diagnostic 0-6, 6-10) each arrival gives
ONE sample, its row nearest the middle of the bin. Per (service_day, source, lead_bin, route or ALL, segment all /
current_trip / next_trip): `targets` (arrivals with a row in the bin), `n` (with that source), `pass_shrink`
(|err| within the owner's allowed error, the 10 minute shrink; since 2026-10-17, every day rebuilt),
`early_shrink` (err below minus that), `pass_10`
(|err| <= 10% of lead), `pass_10_floor` (with a 60 s floor), `late_1` (err > 1% of lead), `early_10`, `gross`
(|err| > max(10 min, half the lead): out of the pass counts, E19 rule) and `gross_early`, `mae_s`, `median_err_s`
(without gross). Pass rate = pass_shrink / (n - gross) (the 10% history: pass_10 / (n - gross)); coverage = n / targets. Across days:
`python tools/build_eta_dataset.py report data/eta/summary.csv [--route R] [--segment next_trip]` pools the days and
gives a 95% bootstrap interval **over days** (RouteKnower 6.5: days are the unit of noise; >= 10 days to decide).

## Detection (`tools/arrival_detector.py`, every 10 s on Passio `vehiclePositions` + `tripUpdates`)
- **transition**: the vehicle's `stop_id` moves forward along the route (up to half the loop: night
  service skips unrequested stops, which get no row), or its trip id changes near the stop the old trip
  was heading to (its final arrival). Passio flips `stop_id` 20-50 m *before* the stop, so while the
  bus is still closing in the arrival waits until it stops, turns away, or 60 s pass.
- **proximity**: within 40 m of the current/adjacent stop at < 1 m/s.
- **pass** (since 2026-10-13): the GPS track itself went past a stop of the route that Passio's `stop_id` did not
  name: the line between two reports (>= 15 m apart, <= 60 s) comes within 40 m of the stop while moving the
  route's direction there (from the stop before to the stop after; the far side of the street does not count).
  Eligible: stops Passio jumped over, stops between the last one logged and a renamed trip's first named stop
  (Passio renames Red Line trips mid-lap), stops ahead of the named one within the forward skip window, and a
  stop Passio moved past while the bus was still > 120 m short of it. Time = the closest approach on that line.
  A pass time for the named stop itself is kept as the transition time when Passio switches too late to time it
  from the remembered reports. Never for a stop only another pattern serves (below), and never within 300 s of
  the same bus's row at that stop under another trip id. Raw-track replay (2026-10-12 / -11): logged share of the
  stops buses drove past 83% -> 88% (weekday) and 74% -> 88% (Sunday night routes); South 48% -> 88%, Downtown
  Campus Connector 70% -> 84%, Regents Express 53% -> 67%; every pass row has a GPS pass, transition times
  unchanged.
- **Other timetable patterns** (`data/route_patterns.json`, written by `tools/build_gtfs.py`; collector only, the
  app keeps `route_stops.json`): stops another pattern serves join the route order after the stop they follow
  (`arrivals_lib.union_order`). Today only Midway Metra: 20 of its 46 weekday trips (3:30 PM on) run through 57th
  St. & Metra (NB), 27 m from the morning loop's end (SB). GPS cannot tell those two apart, so the variant's stop
  counts only when Passio names it, and while it does, its 27 m neighbour gets no proximity row (before: the
  afternoon visits were logged at SB).
- **gps** (since 2026-10-17, DC-003, `Tracker._sweep`): the stops the rules above miss because Passio's stop is wrong
  (frozen for an hour while the bus drives, a jump over the end of a loop, behind the bus). Per bus, every stop of
  its route whose 40 m circle the track enters moving the route's direction, in route order with the bus's
  previous GPS visit (or starting a chain the next one confirms), timed like a transition. Held 10 min
  (`GPS_HOLD_S`); written only if no rule logged that bus at that stop within 15 min and it fits the bus's rows
  before and after (order, speed). `trip_id` blank when Passio had named the same trip and stop for 15 min
  (`FROZEN_S`); no Passio prediction, previous-stop link or dwell. Never changes another row: seeding ignores GPS
  rows for the rules' state, and a merge keeps any rule's row of the same visit (`merge_arrivals.rank`). Replay
  Oct 10-16: +1,826 rows, the share of the stop visits buses drove past with a row 84-88% -> 91-95% (Red Line
  55-75% -> 96-97%), every other row identical; about 99% of 196 sampled rows confirmed on the raw polls.
- **Not caught yet:** a bus Passio files under another route keeps only the rows on Passio's route. The sweep can
  detect it (`GPS_WRONG_ROUTE`, off: no episode was corroborated so far; DC-003 in docs/DATA-COLLECTION-LOG.md).
- Time = when the track crosses the stop, interpolated between reports with the reported speed; else the
  earliest closest report inside 40 m; else closest within 120 m; else (transitions only) the midpoint of
  the last two reports, if they are <= 60 s apart and the stop lies between them. No row if the bus was
  already at the stop in every remembered report (logger start, layovers): we never saw it arrive; and no
  row if `stop_id` moved on while the bus was nowhere near the stop (it switched late, or over a stop the
  bus does not serve).
- `current_stop_sequence` is ignored when `stop_id` is present (it does not match route order);
  loop terminals are disambiguated with `tripUpdates` stop_sequence, then forward progress.
- Dedupe per vehicle+trip+stop index; also one row per physical visit when the trip id flips at a terminal
  (the new trip links to it). GPS jitter / `stop_id` flapping, repeated or stale (> 90 s) reports, and a
  second lap on the same trip id are handled. Restart-safe: the CSV tail (last ~600 kB) is re-read.
- Links (`prev_*`): only to an arrival at most 25 min old (`MAX_LINK_S`; a feed or collector gap means
  stops were missed) with no later arrival of the same bus under another trip id in between. Passio flaps
  trip ids: a bus back on a trip id it left > 60 s ago starts that trip's state afresh (no row for the
  stop it was heading to back then); a flap of a poll or two keeps it. A restart links only to CSV rows
  <= 25 min old.

## Error bounds
Arrival times are good to about **+-10 s**: reports come every ~10 s, GPS is +-5-10 m. Simulation
(`tools/test_truth.py`, 200 arrivals, noise, early flips): mean |error| 1.2 s, max 7.7 s. Replaying a real
16-minute capture at 5 s vs 10 s cadence: 29 of 30 arrivals in both, median difference 0 s, max 8 s. `dwell_s` is
+-5-10 s; short segments (< 60 s) have large relative speed error. Passio outages leave gaps, not errors.

**Known defects in the real file (RouteKnower E01, 2026-10-10; `experiments/routeknower/E01-data-quality-2026-10-10.md`).**
About 4% of `prev_*` links jump over other arrivals of the same bus (trip-id flaps, collector gaps); >= 1.5% of transition
rows are timed while the bus was elsewhere; the same visit is sometimes logged twice 2-5 min apart. The Passio
prediction is ambiguous when several buses share a trip id (every Downtown Campus Connector bus runs trip 874028)
or at a trip's first stop, and `passio_pred_lead_s` is ~2-4 min unless Passio had stopped updating that trip (a
lead >= 5 min is a failure case, not a 5-minute forecast). `tools/model_core.py` `load_rows` handles all of these
(`clean_dicts`); read the CSV raw only with that in mind. Collector fixes B1-B4 (2026-10-10: `cc40831` per-bus
predictions, `9eb11c7` far-away transitions, `2ba339c` stale links, `c3831ca` 300 s merge window) stop new rows from
having the first four; rows logged before keep them, and the lead caveat stays for this column; fixed-lead logging exists since 2026-10-12 (`predictions.csv`, below).

## Run it
```
python tools/truth_logger.py --once                 # one poll (smoke test)
python tools/truth_logger.py --duration 180         # 3 minutes -> data/ground_truth/arrivals.csv
python tools/truth_logger.py --out my.csv --interval 10 --rotate-mb 40
python tools/truth_logger.py --seed arrivals.csv --out run.csv   # write only new rows (what CI does)
python tools/merge_arrivals.py --into arrivals.csv --add run.csv # dedupe-merge a run into the shared CSV
python tools/truth_logger.py --once --alerts-out a.csv          # also write the service alert versions
python tools/merge_alerts.py --into alerts.csv --add a.csv      # merge them (min first_seen, max last_seen)
python tools/test_alerts.py                         # alerts: parsing, versions, merge, isolation tests
python tools/truth_stats.py [csv]                   # coverage, speeds, Passio MAE by lead time
python tools/test_truth.py                          # detector tests
python tools/test_merge.py                          # merge / dedupe tests
```
Windows, hourly in the background (run once in **cmd.exe**; delete with `schtasks /Delete /TN SBTruth /F`):
```
schtasks /Create /TN SBTruth /SC HOURLY /ST 00:07 /F /TR "\"%LOCALAPPDATA%\Programs\Python\Python311\pythonw.exe\" \"%USERPROFILE%\Documents\straight-bussing\tools\truth_logger.py\" --duration 3300"
```

## Replaying a day (added 2026-10-16)
`tools/replay_day.py` rebuilds a past service day's arrivals.csv and predictions.csv rows with today's collector code
(after a detector fix, or to fill rows an older version missed), from what the CI runs kept: each run's
vehiclePositions polls (artifact `raw-polls-<run>`) and prediction updates (`pred-updates-<run>`), the day's
`gtfs-<day>.zip` release asset, and the runs' own seed / merge times from their job steps. It re-runs every run the
way `collect.yml` ran it (`truth_logger.poll`, `Tracker`, `Writer`; seeded from the rows merged before it started;
merged with `merge_arrivals` / `merge_predictions` in the order the runs ended), so run edges come out as live.
It only reads GitHub and writes the files you name; putting rows on the data branch is a separate, deliberate step.
```
python tools/replay_day.py --day 2026-10-15 --out DIR --compare      # DIR/arrivals-<day>.csv, predictions-<day>.csv
python tools/replay_day.py --day 2026-10-12 2026-10-13 --out DIR     # several days; inputs cached in %TEMP%/sb-replay
python tools/replay_day.py --day 2026-10-12 --out DIR --source release   # one pass over the merged day files
python tools/test_replay.py                                           # hermetic: a replayed run = the live rows, exactly
```
- Check (2026-10-15, the same code live and replayed): arrivals 3,431 of 3,431 identical (every field); prediction
  rows 20,504 live, 20,485 reproduced, 19 only live, 58 only replayed (0.4%). The rest is the prediction log: a run
  writes an update again only once a minute, so the last minute it was on display is not in the log; the replay
  moves each logged last sighting 44 s on (`LAST_EXT_S`, never past the next update or the run's end; `--logged-last`
  takes it as logged: 224 only live, 2 only replayed).
- Limits: run artifacts are kept 90 days (raw polls since 2026-10-10 09:01Z, prediction logs since 2026-10-12 19:08Z;
  `python tools/raw_fetch.py --list`); older days fall back to the day's release files (`--source release`: the runs'
  polls merged into one stream, so one pass sees denser polls than a run did during overlaps, and an update shown,
  replaced and shown again is one stretch). Days before 2026-10-10 cannot be replayed (no polls were kept). Where no
  prediction log exists (2026-10-10 / 11, and 2026-10-12 before the predictions started) a replayed arrival keeps the
  live row's `passio_pred_*` columns (`--no-live-pred` leaves them empty) and there are no predictions rows.
- Static data comes from the archived zip, not today's web/data (`build_gtfs.py --zip --out`); stop addresses from
  today's `web/data/stop_addresses.json`.
- Putting a replay on the data branch: `python tools/apply_replay.py --data-dir <data checkout> --replay-dir DIR --day ...
  [--dry-run]` (tests: `tools/test_apply_replay.py`). arrivals.csv: the replayed rows merged in with merge_arrivals (no
  live row is ever removed). predictions.csv: a live row is removed only when today's previous-visit rule (DC-011) says
  it was about the bus's previous visit AND the replay has no such row; then the replayed rows are merged in with
  merge_predictions. A live row the replay could not rebuild stays. Idempotent. Then rebuild that day's forecast table
  (`build_eta_dataset.py`, release asset `eta-<day>.csv.gz` with `--clobber`, its `data/eta/summary.csv` rows with
  `archive_day.py --merge-summary`).


## Using the data on Google Colab (added 2026-10-16)
The owner may run machine learning (possibly deep learning) on the routes in Google Colab; the starting point is
`experiments/routeknower/colab/` (`routeknower_colab.ipynb`, `TECHNICAL.md`, `PLAIN-ENGLISH.md` / `.ipynb`). The
notebook needs no login and reads only public files:
- `https://api.github.com/repos/blobberus/straight-bussing/releases` to list the daily archive, then the
  `eta-<day>.csv.gz` assets (`https://github.com/blobberus/straight-bussing/releases/download/data-archive-YYYY-MM/eta-<day>.csv.gz`):
  the forecast snapshots, the training table.
- `https://raw.githubusercontent.com/blobberus/straight-bussing/data/data/eta/summary.csv`: the project's own pass
  rates, which the notebook must reproduce before it trusts its scoring.
What this asks of collection: keep it running without gaps (each day is one more test day; the ship gate needs 10),
keep the daily archive (release assets are permanent; run artifacts expire after 90 days), and rebuild past tables
with the replay tools above whenever the collector's rules change, so the notebook always learns from one
consistent version. Nothing new needs logging for now.
## Automatic collection and reading it
`.github/workflows/collect.yml` (must live on **main**: GitHub only runs schedules from the default branch).
Each run logs for 70 min and, 40 min in, starts its own successor (`tools/collect_chain.py`), so runs
overlap by ~30 min. Why: GitHub fired only ~4 of the 48 scheduled runs on 2026-10-09 (23% coverage). The
:07/:37 cron stays as a backstop that restarts the chain if it ever stops. It can't run away: two
concurrency slots (a/b) cap it at 2 running collect runs, and a run dispatches at most once, only while it
is the only active collect run (tests: `tools/test_chain.py`, incl. a 72-h simulation with crashes and
manual dispatches). Off switch: repo variable `COLLECT_CHAIN=off` (Settings > Secrets and variables >
Actions > Variables), or "Disable workflow" in the Actions tab (the keepalive step respects that). Each run:
1. checks out main, refreshes `web/data` from the GTFS zip (falls back to the committed copy),
2. seeds the detector from the tail of the shared CSV, logs 70 min into its own `run.csv`,
3. merges with `tools/merge_arrivals.py` into a worktree of the orphan `data` branch: duplicates from
   the overlap (same vehicle + stop within 300 s, whatever trip id or stop_index: collectors can
   disagree on Passio's trip id) are dropped, keeping the row with
   more filled fields; the file is archived past 40 MB; predictions.csv (`merge_predictions.py`) and alerts.csv
   (`merge_alerts.py`, failure only warns) are merged in the same commit,
4. refreshes `web/data/learned.json`, commits `data: arrivals <ts>`, pushes. If another run pushed first
   it re-fetches and re-merges (5 tries),
5. re-enables its own workflow through the API so GitHub's 60-day idle rule does not switch it off
   (unless someone disabled it by hand),
6. annotates the run (`::warning::`) when logging stopped early, the feed kept failing, or the chain did
   not start the next run; the job stays green so the merge always runs.

It never pushes to main, so Pages never redeploys. One row per bus per stop visit; no rows overnight
while no shuttles run.
```
git fetch origin data
git show origin/data:data/ground_truth/arrivals.csv > data/ground_truth/arrivals.csv
```
or download `https://raw.githubusercontent.com/blobberus/straight-bussing/data/data/ground_truth/arrivals.csv`.

**Cost**: free; GitHub Actions minutes are unlimited for public repos (at most 2 runners are busy at any
time; a private repo would need ~90k min/month vs 2k free, so never make this repo private with the chain on). If the Actions tab ever shows the
workflow disabled, press "Enable workflow" there.

**Raw position polls** (RouteKnower E03, since 2026-10-10): each CI run also keeps every vehiclePositions
poll (`truth_logger.py --raw-out`, one JSON line per poll: `{"t", "h", "v": [[veh, trip, route, lat, lon,
bearing, speed, q, stop_id, status, vt], ...]}`) as the artifact `raw-polls-<run id>` (about 1 MB per run,
kept 90 days, never on the data branch). `python tools/raw_fetch.py` downloads the new ones into
`data/raw_polls/days/<service day>.jsonl` (deduped on vehicle + vt; git-ignored); `--list` shows what is on
GitHub. Download at least every 2 months or they expire.

**Privacy**: the feeds hold only vehicle positions and predictions, no riders. Nothing personal is
collected; addresses come from public OpenStreetMap data via Photon (stop coordinates only).

## Context data: weather, traffic, academic calendar (added 2026-10-08)
Used as model features and test slices (RouteKnower.md §3.4). Collected by `tools/context_fetch.py`, joined to
arrivals by `tools/context_join.py` (leakage-safe: only values known when the bus started the segment).

| File (data branch) | Source | Cadence | Caveats |
|---|---|---|---|
| `data/context/weather_mdw.csv` | Iowa Environmental Mesonet ASOS archive, Chicago Midway (MDW) routine METARs: temp, wind, visibility, 1-h precip, weather codes, snow depth | daily workflow `context.yml` re-fetches the last 4 days; history from 2018-03 | MDW is ~10 km west of campus: lake-effect and local showers can differ; METAR precip is hourly |
| `data/context/weather_campus.csv` | Open-Meteo hourly model data at the campus point (CC BY 4.0, credit "Weather data by Open-Meteo.com") | same workflow | model output, not a measurement; archive (ERA5) has ~5-day lag, recent days come from the forecast model |
| `data/context/traffic_regions_hourly.csv` | City of Chicago Traffic Tracker, Historical Congestion Estimates by Region 2018-2026 (`kf7e-cur8`): hourly mean arterial speed from CTA bus GPS, regions 21 Hyde Park-Kenwood-Woodlawn, 13 Loop, 20 Washington Park, 29 Downtown Lakefront | one-time backfill | **the city stopped updating it on 2026-04-30**: typical patterns only, nothing current; arterials only (the segment-level dataset is too slow to query and barely covers campus streets) |
| `data/calendar.json` (main) | UChicago College Catalog 2026-27 academic calendar | by hand each quarter | "dates subject to change"; regimes: class, reading, finals, break, holiday |

Live traffic for today comes from the shuttles themselves: `fl_idx` in the join = median observed/scheduled
segment time over all shuttle segments finished in the last 30 min (RouteKnower M13).

## Browse the data: github.com/blobberus/straight-bussing-data
A separate public repo mirrors this data for browsing, synced every 30 minutes by its own workflow (no secrets: it reads
this public repo): `data/arrivals/<service day>/<route>.csv` (GitHub renders each as a table; a service day runs 4 AM to
3:59 AM), `data/latest.csv`, a viewer page with a time x stop chart of every bus trip
(https://blobberus.github.io/straight-bussing-data/), and a mirror of the RouteKnower methodology (`methodology/`).
The source of truth stays here; edit methodology in this repo.

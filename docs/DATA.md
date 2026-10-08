# Ground-truth arrival data

Goal: a growing, honest record of **when buses really reached each stop**, to measure Passio's
predictions and train our own (`tools/model_*.py`, `docs/ALGORITHMS.md`). Unofficial, estimates only.

| File | Where | What |
|---|---|---|
| `data/ground_truth/arrivals.csv` | `data` branch only (git-ignored on main) | real arrivals, collected around the clock, merged every 30 min |
| `data/ground_truth/archive/*.csv` | `data` branch | same schema, rotated when the live file passes 40 MB |
| `web/data/learned.json` | `data` branch | model refreshed after each run (if `tools/refresh_model.py` exists) |
| `data/ground_truth/synthetic_arrivals.csv` | main | **fake**, seeded 3-week demo (ids start `syn`); `tools/make_synthetic_truth.py` |
| `web/data/stop_addresses.json` | main | `{stop_id: {address, street, housenumber?, neighborhood?}}`; `tools/build_addresses.py` |

## Schema (one row = one bus arriving at one stop)
`epoch` unix s (UTC) · `ts_utc` ISO · `local_time` America/Chicago wall clock · `dow` 0=Mon · `hour` ·
`minute_of_day` · `route_id` `route_name` `trip_id` `vehicle_id` (Passio) · `stop_id` `stop_name`
`stop_address` `stop_lat` `stop_lon` · `stop_index` position in `web/data/route_stops.json[route]` (loops: last
index = back at the first stop) · `prev_stop_id` `prev_arrival_epoch` previous detected stop of the same
trip (stops in between may have been skipped) · `dist_prev_m` metres along the route shape
(`web/data/shapes.json`; else haversine x 1.15) · `segment_s` = epoch - prev_arrival_epoch (includes the
previous dwell) · `speed_mps` = dist / (segment_s - previous dwell), blank if > 30 m/s · `dwell_s` time
stopped here (0 = drove through, blank = unknown) · `passio_pred_epoch` Passio's newest prediction for this
trip+stop made >= 120 s before the arrival, `passio_pred_lead_s` = epoch - when it was made · `source`
`transition` | `proximity`. Rows are appended when the bus leaves the stop, so files are only roughly sorted.

## Detection (`tools/arrival_detector.py`, every 10 s on Passio `vehiclePositions` + `tripUpdates`)
- **transition**: the vehicle's `stop_id` moves forward along the route (up to half the loop: night
  service skips unrequested stops, which get no row), or its trip id changes near the stop the old trip
  was heading to (its final arrival). Passio flips `stop_id` 20-50 m *before* the stop, so while the
  bus is still closing in the arrival waits until it stops, turns away, or 60 s pass.
- **proximity**: within 40 m of the current/adjacent stop at < 1 m/s.
- Time = when the track crosses the stop, interpolated between reports with the reported speed; else the
  earliest closest report inside 40 m; else closest within 120 m. No row if the bus was already at the
  stop in every remembered report (logger start, layovers): we never saw it arrive.
- `current_stop_sequence` is ignored when `stop_id` is present (it does not match route order);
  loop terminals are disambiguated with `tripUpdates` stop_sequence, then forward progress.
- Dedupe per vehicle+trip+stop index; also one row per physical visit when the trip id flips at a terminal
  (the new trip links to it). GPS jitter / `stop_id` flapping, repeated or stale (> 90 s) reports, and a
  second lap on the same trip id are handled. Restart-safe: the CSV tail (last ~600 kB) is re-read.

## Error bounds
Arrival times are good to about **+-10 s**: reports come every ~10 s, GPS is +-5-10 m. Simulation
(`tools/test_truth.py`, 200 arrivals, noise, early flips): mean |error| 1.2 s, max 7.7 s. Replaying a real
16-minute capture at 5 s vs 10 s cadence: 29 of 30 arrivals in both, median difference 0 s, max 8 s. `dwell_s` is
+-5-10 s; short segments (< 60 s) have large relative speed error. Passio outages leave gaps, not errors.

## Run it
```
python tools/truth_logger.py --once                 # one poll (smoke test)
python tools/truth_logger.py --duration 180         # 3 minutes -> data/ground_truth/arrivals.csv
python tools/truth_logger.py --out my.csv --interval 10 --rotate-mb 40
python tools/truth_logger.py --seed arrivals.csv --out run.csv   # write only new rows (what CI does)
python tools/merge_arrivals.py --into arrivals.csv --add run.csv # dedupe-merge a run into the shared CSV
python tools/truth_stats.py [csv]                   # coverage, speeds, Passio MAE by lead time
python tools/test_truth.py                          # detector tests
python tools/test_merge.py                          # merge / dedupe tests
```
Windows, hourly in the background (run once in **cmd.exe**; delete with `schtasks /Delete /TN SBTruth /F`):
```
schtasks /Create /TN SBTruth /SC HOURLY /ST 00:07 /F /TR "\"C:\Users\NK\AppData\Local\Programs\Python\Python311\pythonw.exe\" \"C:\Users\NK\Documents\straight-bussing\tools\truth_logger.py\" --duration 3300"
```

## Automatic collection and reading it
`.github/workflows/collect.yml` (must live on **main**: GitHub only runs schedules from the default branch)
starts a run at :07 and :37 every hour, and each run logs for 70 min. Runs always overlap, so a start
GitHub delays or skips leaves no gap. Each run:
1. checks out main, refreshes `web/data` from the GTFS zip (falls back to the committed copy),
2. seeds the detector from the tail of the shared CSV, logs 70 min into its own `run.csv`,
3. merges with `tools/merge_arrivals.py` into a worktree of the orphan `data` branch: duplicates from
   the overlap (same vehicle + trip + stop + stop_index within 120 s) are dropped, keeping the row with
   more filled fields; the file is archived past 40 MB,
4. refreshes `web/data/learned.json`, commits `data: arrivals <ts>`, pushes. If another run pushed first
   it re-fetches and re-merges (5 tries),
5. re-enables its own workflow through the API so GitHub's 60-day idle rule does not switch it off.

It never pushes to main, so Pages never redeploys. One row per bus per stop visit; no rows overnight
while no shuttles run.
```
git fetch origin data
git show origin/data:data/ground_truth/arrivals.csv > data/ground_truth/arrivals.csv
```
or download `https://raw.githubusercontent.com/blobberus/straight-bussing/data/data/ground_truth/arrivals.csv`.

**Cost**: free; GitHub Actions minutes are unlimited for public repos (about 2-3 runners are busy at any
time; a private repo would need ~100k min/month vs 2k free). If the Actions tab ever shows the
workflow disabled, press "Enable workflow" there.

**Privacy**: the feeds hold only vehicle positions and predictions, no riders. Nothing personal is
collected; addresses come from public OpenStreetMap data via Photon (stop coordinates only).

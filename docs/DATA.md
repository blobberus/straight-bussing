# Ground-truth arrival data

Goal: a growing, honest record of **when buses really reached each stop**, to measure Passio's
predictions and train our own (`tools/model_*.py`, `docs/ALGORITHMS.md`). Unofficial, estimates only.

| File | Where | What |
|---|---|---|
| `data/ground_truth/arrivals.csv` | `data` branch only (git-ignored on main) | real arrivals, appended hourly |
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
python tools/truth_stats.py [csv]                   # coverage, speeds, Passio MAE by lead time
python tools/test_truth.py                          # detector tests
```
Windows, hourly in the background (run once in **cmd.exe**; delete with `schtasks /Delete /TN SBTruth /F`):
```
schtasks /Create /TN SBTruth /SC HOURLY /ST 00:07 /F /TR "\"C:\Users\NK\AppData\Local\Programs\Python\Python311\pythonw.exe\" \"C:\Users\NK\Documents\straight-bussing\tools\truth_logger.py\" --duration 3300"
```

## Automatic collection and reading it
`.github/workflows/collect.yml` runs at :07 every hour (and on demand): checks out main, logs 55 min into a
worktree of the orphan `data` branch, refreshes the model, commits `data: arrivals <ts>`, pushes (3 rebase
retries; conflicting appends are merged as a line union). It never pushes to main, so Pages never redeploys.
```
git fetch origin data
git show origin/data:data/ground_truth/arrivals.csv > data/ground_truth/arrivals.csv
```
or download `https://raw.githubusercontent.com/blobberus/straight-bussing/data/data/ground_truth/arrivals.csv`.

**Cost**: free; GitHub Actions minutes are unlimited for public repos (a private repo would need ~41k
min/month vs 2k free). Scheduled runs can start late or be skipped under GitHub load, and are disabled
after 60 days without repo activity (re-enable in the Actions tab).

**Privacy**: the feeds hold only vehicle positions and predictions, no riders. Nothing personal is
collected; addresses come from public OpenStreetMap data via Photon (stop coordinates only).

# Data collection log

Every checkup of the ground-truth collector and every error found in the collected data, newest first. The runbook
is `monitoring.md` (how to check and fix); the data itself is described in `docs/DATA.md` / `docs/DATA-GUIDE.md`.
What the data is for: an honest record of when buses really reached each stop and what Passio showed riders
beforehand, to score predictions against the 10% rule (`docs/GOAL-AND-METHOD.md`).

**Add an entry** after each checkup ("run monitoring.md", a data check) and whenever an error is found:
one `## Checkups` line per checkup, one `DC-NNN` entry per error (next free number). Status is one of
**open**, **fixed** (commit), **accepted** (expected, nothing to fix) or **watch** (fixed or harmless, recheck later).
Impact says which rows are wrong or missing and whether old rows can be repaired.

## Checkups
| When (Chicago) | Verdict | Coverage | Data | Notes |
|---|---|---|---|---|
| 2026-10-16 12:45 | healthy; verified and backfilled (owner: "make any changes or fixes needed. Update all data collected if needed") | 100% since the last checkup (`monitor.py status` HEALTHY) | fixes DC-009 to DC-012 on main; Oct 10 to 15 replayed with today's code (tools/replay_day.py, validated on Oct 15: 3,431 of 3,431 arrivals identical) and applied (tools/apply_replay.py, data `2db4cbc`): arrivals +576 (Oct 10 +122, 11 +109, 12 +250, 13 +95; GPS pass rows), predictions +2,248 missed rows, -558 previous-lap rows (502 of them predicted over 15 min early), 160 replaced by a fresher copy; 0 duplicates; eta-<day> assets of Oct 10 to 15 re-uploaded and their summary rows rebuilt (data `da1782b`) | Oct 8 / 9 cannot be replayed (no polls were kept); see DC-002, DC-008, DC-010, DC-011 |
| 2026-10-16 01:11 | healthy | 100% of 31.6 h of actual logging time since the last checkup (83 runs, all succeeded, no gap over 1 min) | arrivals: 3,637 (Oct 14), 3,419 (Oct 15), 0 duplicates, 0 rows missing stop / bus / route, 89 to 90 stations and 13 lines a day; predictions.csv 73,396 rows, 10-min coverage 67% (Oct 13) -> 71% (Oct 14) -> 76% (Oct 15); alerts.csv 3 rows, polled live (last_seen 23 min old); archive through Oct 14 incl. alerts-2026-10-14.csv.gz, Oct 15 due with today's run; data repo synced 03:28Z; weather current | `monitor.py status` HEALTHY; found DC-012; DC-008 checked (watch); DC-011 unchanged; traffic context ends 2026-04-30 (known: the city stopped the dataset, RouteKnower §3.4) |
| 2026-10-14 17:33 | healthy | 100% of 33.9 h of actual logging time (job start to end), no gaps, 145/145 runs since Oct 11 succeeded | arrivals: 3,469 (Oct 12), 3,640 (Oct 13), 2,473 (Oct 14 so far); predictions.csv 46,386 rows since Oct 12 12:20; no duplicate rows; archive complete through Oct 13 | `monitor.py status` said DEGRADED: DC-004, DC-005 (both false or harmless); the data check found DC-006 to DC-011 |

## Errors

### DC-013 The public data repo synced every 4 to 5 hours, not every 30 min (fixed)
- Found 2026-10-16 during the verification. github.com/blobberus/straight-bussing-data's `sync.yml` cron is
  `4,34 * * * *`, but GitHub fired it only at 23:35, 03:28, 08:25, 13:26 and 17:36 UTC (Oct 15 to 16), the same
  dropped-schedule behavior as DC-001. The public per-day / per-route CSVs lagged the data branch by up to 5 h.
- Impact: freshness only; every sync rebuilds all days from arrivals.csv, so nothing was lost (the backfilled
  Oct 10 to 13 counts reached it with the 18:50Z sync).
- Fixed (data repo `13a5b57`): each sync run waits 25 min, then dispatches the next run unless one is already
  waiting (one chain; the concurrency group holds at most one waiting run); the cron stays as a backstop; repo
  variable `SYNC_CHAIN=off` stops it. Started by hand at 18:52Z.

### DC-012 Passio's alert ids are list positions, so one alert splits into rows (fixed)
- Found 2026-10-16. serviceAlerts entity ids are the alert's place in the feed, not a stable id: "UGo Bus Route
  Assistance" was id 2 while the North alert was listed first, and became id 1 when that one ended (Oct 15 00:00).
  `alerts.csv` keys a row by (alert_id, version), so the same alert text has two rows: id 2 (first seen Oct 14 18:49)
  and id 1 (first seen Oct 15 00:00, the renumbering, not when it appeared).
- Impact: 3 rows now (2 real alerts). first_seen / last_seen are split across the rows of one alert. Recoverable:
  the version (content hash) is the same, so the rows merge by version with the earliest first_seen and latest
  last_seen.
- Fixed 2026-10-16: `tools/alerts_lib.py` keys a row by its version alone (`key`); `alert_id` lists every entity
  id the version was seen under (`join_ids`, `1;2`), also for one alert under two ids in one feed; `merge_alerts.py`
  collapses rows an older merge split, so alerts.csv migrates itself at the next merge (a run that started on the old
  code may split it once more; the following merge collapses it again). The version includes the active periods,
  so a new posting of the same text with new dates is still its own row. Test
  `an_alert_keeps_one_row_when_passio_renumbers_it` (test_alerts 17); the tests no longer leave a temp dir behind
  (148 had piled up in %TEMP%; git's read-only object files needed a chmod before rmtree).

### DC-011 Many 30-min predictions are another lap's time (fixed in part; the rest is Passio's own error)
- Found 2026-10-14 during DC-008. 35.6% of the 30-min rows and 7.2% of the 20-min rows are more than 15 min off;
  many look like a prediction for a different lap on loops shorter than the lead (e.g. Apostolic/Drexel bus 4538
  at Levi Hall). Either Passio really shows such times (then the rows are right and Passio is bad that far out)
  or the selection pairs a lap's prediction with the wrong arrival. Needs its own experiment (RouteKnower) before
  the 30-min score is trusted.
- 2026-10-16: unchanged on Oct 15: 33.9% of 30-min rows and 7.0% of 20-min rows more than 15 min off.
- Investigated 2026-10-16 (RouteKnower E22): Oct 12 to 15 replayed from the archived raw polls and prediction updates
  through the detector (the replay reproduces the live rows: 99.8% of arrivals, 18,554 of 18,745 shared prediction
  rows identical on Oct 15), every far row traced to the update it came from.
- Cause of the part that was ours: Passio rolls a bus over to its next trip id early and lists the CURRENT lap's
  times under it; the detector skipped a prediction about the bus's previous visit only when that visit had the
  same trip id, so such a time (e.g. Drexel 4325 at Goldblatt: 'in 0.6 min' 20 min ahead, and the bus came 0.6 min
  later on its current lap) was scored against the lap after it. The same in `tools/build_eta_dataset.py`.
- Fixed: a prediction of a time before, or within PREV_VISIT_GAP_S after, the bus's previous visit to the stop is
  about that visit whatever its trip id (`Tracker._candidates` in `tools/arrival_detector.py`; `shown()` in
  `build_eta_dataset.py` marks it `previous_lap`); tests in `tools/test_truth.py`, `tools/test_eta.py`. A real
  next-lap prediction (a later time) is kept. Effect per day, Oct 12 to 15: 73 to 102 predictions.csv rows
  dropped (85 to 100% of them > 15 min off), none added; 30-min rows > 15 min off 38.7 -> 27.9% (Oct 12),
  33.5 -> 27.4%, 36.3 -> 30.9%, 32.4 -> 27.9% (Oct 15); 20-min 0.3 to 1.9 points lower; arrivals.csv only its
  passio_pred_epoch value on 2 to 11 arrivals a day (format unchanged). Forecast table: 1,306 to 1,668 rows a day
  go shown -> previous_lap (99 to 100% > 15 min off, all predicted early).
- Accepted (Passio's own error, rows kept as an honest record): after the fix 95% of the remaining far rows come
  from the update for exactly this visit (this trip id, stop_sequence = the stop's place on the trip), with no
  visit of the bus near the predicted time: mostly predicted too early (schedule times while a bus lays over or
  runs late; the Downtown Campus Connector's downtown stops), or a time already past when shown (92 rows on Oct 15).
  So the 30-min score is now trustworthy as a score of what Passio showed: about 28% of its 30-min times are
  more than 15 min off.
- Backfilled 2026-10-16: the live rows of Oct 12 to 15 that the fixed rule calls a previous-lap prediction and the
  replay does not reproduce were removed (558; 502 predicted over 15 min early, median 22 min early; 360 at the
  30-min lead, 164 at 20 min; Apostolic/Drexel 241, Midway Metra 140). Oct 15: 30-min rows over 15 min off
  33.9% -> 28.8%. The forecast tables of Oct 12 to 15 were rebuilt with `previous_lap`.

### DC-010 The forecast-snapshot table has the same trip id gap as DC-008 (fixed 2026-10-16, backfilled)
- Found 2026-10-14. `tools/build_eta_dataset.py` looked up Passio's prediction by the arrival's trip id only, like
  the detector did before the DC-008 fix, so `eta-<day>.csv.gz` and `data/eta/summary.csv` missed the same
  re-matched predictions (Central the most), and counted those times as `no_arrival` phantom visits.
- Fixed: `OtherTrips` in `build_eta_dataset.py` asks the detector's own `Tracker._other_trip_preds` (reused, not
  copied) for a minute the own trip id left empty after one it filled for the same arrival; never another bus, its
  next trip, its previous visit or a loop stop. The borrowed time is not also a no_arrival row. 2 tests in
  `tools/test_eta.py` (the DC-008 cases).
- Check: the old code rebuilds the archived `eta-2026-10-13` and `eta-2026-10-15` tables row for row; the new
  one changes only empty Passio cells to shown and drops phantom rows. Oct 15: +1,009 cells shown, -731 no_arrival
  rows (205,455 -> 204,724 rows); coverage at 10 min 79.6 -> 81.0%, at 1 min 89.6 -> 91.0%; Central 6-10 min
  79 -> 86%, 10-15 min 78 -> 83%; 10% rule pass within 1 point. Oct 13: +1,266 cells, -1,026 phantom rows; 10 min
  75.2 -> 76.8%; Central 6-10 min 55 -> 78%, 10-15 min 47 -> 69%, and its 10% pass there 26 -> 16% (the filled
  minutes were Passio's confused ones, so the old scores flattered it).
- Past days (2026-10-12 to the deploy; Oct 10-11 have no prediction updates) still have the old tables and summary
  rows: rebuild each from its archived release files (pred-updates, raw-polls, gtfs) with build_eta_dataset.py, after
  any arrivals.csv backfill of that day, then re-upload only eta-<day>.csv.gz (--clobber) and merge its summary rows
  (archive_day.py --merge-summary). Not archive_day.py --replace: that rebuilds from the 90-day run artifacts and
  re-uploads all of the day's files.
- Backfilled 2026-10-16: eta-2026-10-10 to 10-15 rebuilt from the replayed arrivals with the DC-010 and DC-011
  code and re-uploaded (`--clobber`), their rows of data/eta/summary.csv replaced (1,272 rows). The old tables
  can be rebuilt from the same release inputs with the code before fee6831.

### DC-008 Passio predictions vanished between leads: our trip id lookup (fixed)
- Found 2026-10-14 (data check of origin/data at 22:29Z).
- What: 309 arrivals had a 20-min Passio prediction row but no 10-min row (80 on Central, 48% at 10 min vs 54% at
  20); 207 had a 30-min row but no 20-min row.
- Cause (Oct 13 replayed from the archived prediction updates, 144 cases): Passio's tripUpdates move a running bus
  between 2 or 3 timetable trip ids and back while vehiclePositions keeps one, and the stop's prediction moves
  with them; the detector looked only under the arrival's trip id (86 of 144). 44 are real gaps (Passio showed
  nothing for that bus at that stop), 8 borderline on the 90 s display rule, 1 a loop shorter than the lead.
- Impact: about 1.5 points of 10-min coverage lost (Central about 24); the missing rows were Passio's confused
  moments, so its scores were slightly flattering.
- Fixed: `Tracker._other_trip_preds` (`tools/arrival_detector.py`) fills a missing shorter lead from the SAME bus's
  prediction under another trip id (never another bus, never its next trip, never its previous visit, not at loop
  stops); `SHOWN_PAST_S` in `arrivals_lib.py`; 2 tests in `tools/test_truth.py`. Replaying Oct 13: +290 rows, 0
  changed; 10 min 75.9 -> 77.2%, Central 38 -> 62%. Rows before the deploy are not rewritten (a replay of the
  archived updates could add about 290 a day since Oct 12; no tool for that yet).
- Checked 2026-10-16 (watch): 10-min coverage of all arrivals 67% (Oct 13) -> 76% (Oct 15, the first full day on the
  fix), Central 32% -> 69%. Still 151 arrivals on Oct 15 with a 20-min row but no 10-min row (174 on Oct 13; Central
  39 -> 23), spread over the lines (Midway Metra 20, Red Line/Arts Block 17, East 16). Most should be real gaps;
  replay Oct 15's archived prediction updates (pred-updates-2026-10-15, archived after about 15:20Z Oct 16) to split
  real gaps from misses before calling it done.
- Backfilled 2026-10-16: Oct 12 to 14 replayed with today's code and applied (the Checkups line of 2026-10-16):
  10-min coverage Oct 13 67% -> 68% of all arrivals (72% of the arrivals live had), Oct 14 71% -> 72%; Central at
  10 min Oct 13 32% -> 53%, Oct 14 65% -> 76%; arrivals with a 20-min row but no 10-min row Oct 13 174 -> 114,
  Oct 14 145 -> 117. The rest (Oct 15: 149) are Passio's own gaps: the replay with the fix finds nothing more.

### DC-009 An operator alert names Passio's own route id, so the app's route view skips it (fixed, app side)
- Found 2026-10-14 while adding DC-007. The live North alert ("The North route will run every 30 minutes...")
  names `route_id` 38734, Passio's internal id; the GTFS id the app uses for North is 1075. The web route view's
  "Hours & service" (`web/js/ui/views/route.js` `renderService`, matching `informed_entity.route_id` to the GTFS
  id) never shows it on North; check the same match on iOS. The alert still shows where all active alerts are listed.
- Impact on the data: `alerts.csv` keeps the id verbatim and leaves `route_names` blank for non-GTFS ids, so a
  learner must map 38734 -> North itself. Rider safety (ship checklist 1): fix the app's match, not the data.
- Cause (2026-10-16): 38734 is no stray id: it is the GTFS `shape_id` of every North trip in `trips.txt`. Passio's
  internal route id is the route pattern's shape id, and in the official zip each of the 15 shapes belongs to exactly
  one route (Midway Metra has two) and none equals a route id. On the web the alert also lost its route chip in the
  Alerts list and, on a route page with no bus reporting, was dropped from "From the shuttle operator" too (it
  counted as tied to a route), so it showed on no route page at all.
- Fixed: `tools/build_gtfs.py` `route_aliases` writes each route's shape ids into `routes.json` as `alias_ids` (a shape
  two routes share, or equal to a route id, is left out); web `core/arrivals.js` `alertRouteIds` and Kit
  `Arrivals.alertRouteIds` map an informed route id that is not a route through them (an alias two routes list maps
  to neither). Used by the route page's Schedule changes, the route page's operator list (now: alerts tied to no
  known route, so an id nothing matches still shows there) and the Alerts list chips, web and iOS. Tests: build_gtfs,
  core-arrivals, route-view, views-outage, views-render, data-static, Kit ArrivalsTests.
- For the collector (`alerts.csv` route_names): the same rule. A route_id that is a routes.json key names that
  route; else the one route whose `alias_ids` contains it; else (none, or two) leave route_names blank.
- Collector side (2026-10-16): `arrivals_lib.Static.alert_route` (same rule) fills `route_names` in alerts.csv for
  Passio's own ids (38734 -> North); `route_ids` stay verbatim; the North row already written was filled the
  same way (data `629d71d`). Test `an_alert_route_id_maps_like_the_app`.

### DC-007 Operator service alerts were not recorded (fixed)
- Found 2026-10-14.
- What: the CI collector polls tripUpdates and vehiclePositions every 10 s but never serviceAlerts (only the unused
  `tools/collect.py` did). Detours, stop closures and "buses delayed" notices that explain bad arrivals were lost.
- Impact: no alert history before 2026-10-14; cannot be recovered (Passio keeps no alert archive).
- Fixed: `truth_logger.py` polls serviceAlerts at start and every 5 min in its own thread (8 s timeout, own
  counters, never delays the 10 s loop); one row per alert version (id + content hash, first / last seen) merged
  into `data/ground_truth/alerts.csv` by `tools/merge_alerts.py`; daily `alerts-<day>.csv.gz` in the archive;
  a run whose alert polls mostly fail shows the warning "Service alerts not collected" (arrivals unaffected).
  `tools/test_alerts.py`. The data branch now gets a commit on most runs, overnight too (last_seen moves).

### DC-006 Docs said data merges every 30 min (fixed)
- Found 2026-10-14. `docs/DATA.md`, `docs/DATA-GUIDE.md`, `RouteKnower.md` still described the pre-2026-10-10 cadence.
  Since the self-chain (DC-001) a 70-min run starts every 40 min, polls every 10 s and merges once at its end.
- Impact: documentation only. Fixed: the three docs now say about every 40 min.

### DC-005 Local run file left unpushed (fixed)
- Found 2026-10-14. A local collector chunk on this PC (08:22-08:28 CDT) was interrupted before its push.
- Impact: none: `monitor.py resume --hours 0.01` pushed it (+0 rows, CI had logged the same arrivals; +1 row from
  the resume's own few seconds). Commits `13c60b1`, `627d43e` on `data`.

### DC-004 Monitor reported "no run started for 79 min" while a run was logging (fixed)
- Found 2026-10-14 15:10 CDT. `monitor.py status` judged the chain by each run's creation time. A backstop cron run
  created at 13:50 waited in its concurrency slot and only began logging at 14:58, so the newest run looked 79 min
  old (DEGRADED) while collection was continuous; the chain had handed over correctly ("chain follower: a newer run
  leads the chain").
- Impact: false alarm only (could prompt a needless dispatch). No data lost.
- Fixed: `last_start` in `tools/monitor.py` reads the in-progress runs' "Log arrivals" step start when the newest
  run looks late; test `test_last_start_queued_run`.

### DC-003 Buses with a frozen or wrong Passio trip assignment (open, backfilled)
- Known since 2026-10-13 (RouteKnower E21). A bus whose Passio trip / route assignment is stale or wrong is not
  matched to its route's stops, so some of its arrivals are missing. Not fixed yet.

### DC-002 Stops Passio did not name were not logged (fixed 2026-10-13, backfilled)
- Replaying the raw GPS showed the collector logged only stops Passio named for the bus: South 48%, all lines 83% of
  the stops buses drove past. Fixed by `source = pass` rows from the GPS track (`tools/arrival_detector.py`
  `_passes`, `data/route_patterns.json`) and Midway Metra's afternoon stop: 88%. Earlier rows stay as they were;
  the raw polls (release assets) allow a replay.
- Backfilled 2026-10-16: Oct 10 to 13 replayed from the archived polls with today's detector: +576 arrivals, mostly
  `pass` rows (Oct 10 +122, 11 +109, 12 +250, 13 +95). Oct 8 and 9 have no kept polls and stay as logged.

### DC-001 GitHub dropped most scheduled runs (fixed 2026-10-10, backfilled)
- On 2026-10-09 GitHub fired about 4 of 48 scheduled `collect.yml` runs (23% coverage, multi-hour gaps). Fixed by the
  self-chain (`tools/collect_chain.py`: each run dispatches its successor 40 min in; cron is only a backstop). Gaps
  before 2026-10-10 cannot be filled.

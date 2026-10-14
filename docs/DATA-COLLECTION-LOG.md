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
| 2026-10-14 17:33 | healthy | 100% of 33.9 h of actual logging time (job start to end), no gaps, 145/145 runs since Oct 11 succeeded | arrivals: 3,469 (Oct 12), 3,640 (Oct 13), 2,473 (Oct 14 so far); predictions.csv 46,386 rows since Oct 12 12:20; no duplicate rows; archive complete through Oct 13 | `monitor.py status` said DEGRADED: DC-004, DC-005 (both false or harmless); the data check found DC-006 to DC-009 |

## Errors

### DC-008 Passio predictions vanish between leads (open, under investigation)
- Found 2026-10-14 (data check of origin/data at 22:29Z).
- What: 309 arrivals have a 20-min Passio prediction row but no 10-min row (80 on Central, whose coverage is 48% at
  10 min vs 54% at 20 min); 207 have a 30-min row but no 20-min row.
- Impact: if our selection drops predictions that were on screen, Passio's coverage at 10-20 min is understated.
- Cause / resolution: being investigated.

### DC-009 An operator alert names Passio's own route id, so the app's route view skips it (open, app side)
- Found 2026-10-14 while adding DC-007. The live North alert ("The North route will run every 30 minutes...")
  names `route_id` 38734, Passio's internal id; the GTFS id the app uses for North is 1075. The web route view's
  "Hours & service" (`web/js/ui/views/route.js` `renderService`, matching `informed_entity.route_id` to the GTFS
  id) never shows it on North; check the same match on iOS. The alert still shows where all active alerts are listed.
- Impact on the data: `alerts.csv` keeps the id verbatim and leaves `route_names` blank for non-GTFS ids, so a
  learner must map 38734 -> North itself. Rider safety (ship checklist 1): fix the app's match, not the data.

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

### DC-001 GitHub dropped most scheduled runs (fixed 2026-10-10, backfilled)
- On 2026-10-09 GitHub fired about 4 of 48 scheduled `collect.yml` runs (23% coverage, multi-hour gaps). Fixed by the
  self-chain (`tools/collect_chain.py`: each run dispatches its successor 40 min in; cron is only a backstop). Gaps
  before 2026-10-10 cannot be filled.

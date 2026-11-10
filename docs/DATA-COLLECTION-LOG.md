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
| 2026-11-10 03:30 | healthy; one archive day lost to a GitHub 503 (fixed) | 100% since Nov 9 02:23 (collecting 82%, idle with no bus 18%); all 78 finished runs since Sat Nov 7 12:38 PM succeeded, every chain hand-off on its first try, no hole between runs; an idle run since 12:32 AM Tue, collecting from 4:15 AM | arrivals: 756 on Sat Nov 7 (Saturdays 929 to 1,065: 1 bus a line all evening), 1,017 on Sun Nov 8 (the most of any Sunday), 3,949 on Mon Nov 9 (Mondays 3,925 to 4,070; Apostolic, Midway Metra, Friend Center/Metra and Red Line absent from the feed until 7 to 7:30 AM); 0 duplicates, 0 rows missing ids; Passio time on 82% / 85% / 83% of non-`gps` arrivals; ~101,800 rows; timetable 708be9d370e2 unchanged; archive of Nov 8 failed on one HTTP 503, dispatched by hand (complete through Nov 8); weather daily; data repo synced every 25 min except Mon 12:22 to 2:57 PM (a run GitHub never started); weekly findings ran Mon 6:50 PM (7 h late), +27 rows, no signal ready | DC-025: archive retry on 5xx (`de1d192f`); since Oct 27 evening Passio publishes no time for 4 Downtown Campus Connector stops (Gleacher Center, River East, Randolph & Michigan, Michigan & Roosevelt) and gives the first stops after a terminal their time under another trip id: the Passio share fell from 85 to 93% to 81 to 85% (the owner may tell Passio); wrong-line labels Nov 9: 4 episodes, 3.5 bus-hours; issue #1 closed Nov 8, reopened Nov 9 for the archive, closed again; backup verified (Nov 6, not due) |
| 2026-11-07 13:00 | healthy; nothing lost since the Nov 5 gap | 100% since Nov 6 12:58 (collecting 54%, idle with no bus 46%); 62 of 62 runs since Nov 5 12:39 PM succeeded, every chain hand-off went through on its first try; an idle run since 10:20 AM Sat, collecting from 3:15 PM for the 4 PM Saturday lines | arrivals: 3,987 on Fri Nov 6 (14 lines, 93 stations, 20 buses; Fridays Oct 16 / 23 / 30: 3,995 / 3,944 / 4,203), Sat Nov 7 48 by 4:25 PM (first bus 3:45 PM, 4 lines; earlier Saturdays 29 to 60 by then); 0 duplicates, 0 rows missing ids; Passio prediction on 85% of non-`gps` arrivals (Fridays 85 to 93%), `gps` rows back to 364 (Nov 4 / 5: 611 / 552); ~96,400 rows; timetable 708be9d370e2 unchanged (last seen Nov 7 05:30); archive complete through Nov 6 (by the schedule, 10:37 AM Nov 7); weather daily; data repo synced every 25 min | `collector-health` issue #1 still open for the Nov 5 gap only (closes itself on Nov 8); DC-024: buses driving another line than Passio's label measured over 12 days (Nov 6: 10 episodes, 7.2 bus-hours, the most of any day), the Downtown Campus Connector's real streets against its drawn line, archive polls holding one bus twice, a false "no new arrivals for 3 h" warning at service starts (fixed `0e0699d3`); backup verified (Nov 6, 151 files; not due) |
| 2026-11-06 03:45 | degraded: one 2-hour gap on Thu Nov 5 (DC-023, fixed); otherwise healthy | 92% since Nov 5 03:43 (collecting 66%, idle with no bus 26%), the only gap 10:39 AM to 12:39 PM Nov 5; every collect run since Nov 2 succeeded; an idle run since 02:35, collecting from 4:15 AM | arrivals: 3,931 (Mon Nov 2), 4,148 (Tue), 4,080 (Wed), 3,656 (Thu, about 310 short in the gap); the week before 3,925 / 4,151 / 3,728 / 4,168 / 4,203; 13 lines and 92 stations each day, 0 duplicates, 0 rows missing ids; Passio prediction on 85% / 85% / 81% / 82% of non-`gps` arrivals (the week before 81 to 92%); ~89,400 rows; timetable 708be9d370e2 unchanged (last seen Nov 6 00:37); archive complete through Nov 4, Nov 5 dispatched by hand; weather daily; data repo synced every 25 min | `collector-health` issue #1 open for the Nov 5 gap (it closes itself once Nov 5 leaves the 2-day window, about Nov 8); the data repo's watchdog issue opened 12:12 PM and closed 1:03 PM Nov 5; owner's report of idle buses at Regenstein checked on the raw polls (DC-023 item 5); off-GitHub backup refreshed (151 files, 314 MB, verified; the one before was Nov 2) |
| 2026-11-04 11:30 | healthy; no alert since Nov 2 | 100% since Nov 3 11:26 (collecting 84%, idle with no bus 16%); 13 buses live at 11:25 AM | arrivals: 4,148 on Tue Nov 3 (13 lines, 92 stations: the most of any day so far), 1,385 on Nov 4 by 10:32 AM, ~82,600 rows; 0 duplicates, 0 rows missing ids; prediction on 85% / 88% of non-`gps` arrivals; health.py data all clear; timetable 708be9d370e2 unchanged (last seen Nov 4 10:33); archive complete through Nov 2 | the daily archive's schedule fires 6 to 10 hours late (Nov 1 16:54Z, Nov 2 20:29Z, Nov 3 18:00Z for a 10:41Z cron), so Nov 3 was not archived yet at 11:30 AM: dispatched by hand (it catches up 85 days anyway, and the health check flags a day only after 2 days) |
| 2026-11-03 04:00 | healthy; no alert in 24 h | 100% since Nov 2 03:42 (collecting 90%, idle with no bus 10%); every finished collect run succeeded; an idle run since 01:15, collecting again from 4:15 AM for the 5 AM buses | arrivals: 3,931 on Mon Nov 2 (13 lines, 92 stations; weekdays 3,700 to 4,200), ~80,400 rows; 0 duplicates, 0 rows missing ids; prediction on 85% of non-`gps` arrivals; health.py data all clear; timetable 708be9d370e2 still in use (last seen Nov 3 01:14); archive complete through Nov 1 (the first day on the new release data-archive-2026-11, built with the recorded timetable) | the DC-022 fix held: the same after-service pattern (buses listed on trips on their way to the garage, last arrival 00:06) raised no "buses but no rows" alert this time; no watchdog alert in the data repo |
| 2026-11-02 01:30 | healthy; the first day with the safety nets (DC-021) | 100% since Nov 1 01:26 (collecting 52%, idle with no bus 48%); 28 of 28 finished collect runs since Nov 1 09:00Z succeeded (2 cancelled were my test dispatches), 1 idle run running; Passio 0 buses at 1:26 AM, next start 5 AM | arrivals: 929 on Sat Oct 31 (5 lines, 37 stations), 776 on Sun Nov 1 (4 lines, 35 stations; Sundays 729 to 856), ~79,600 rows; 0 duplicates, 0 rows missing ids; prediction on 71% / 75% of non-`gps` arrivals; health.py data all clear; timetable 708be9d370e2 recorded Nov 1 03:26 to Nov 2 01:23 (no change since Oct 26); archive complete through Oct 31 (archived with the recorded timetable); data repo synced 06:52Z; weather current; collector-tests green; tag collector-ok = main (686ec5d); off-GitHub backup refreshed (121 files, 259 MB) | two automatic alerts in the first day, both false, both closed by themselves (DC-022, fixed); watch: South's single bus 4314 logged 60 to 71% of its stops through the GPS sweep on Sat / Sun (142 and 107 rows; 4320 the same on Oct 27, 93): Passio did not name those stops for that bus, South's totals stayed normal (201, 177), but those arrivals carry no Passio prediction |
| 2026-11-01 03:30 | risk review (DC-021); found an unreported outage | arrivals Oct 12 to 31 replayed through the new data checks: every daytime 10-minute slot that normally has arrivals had some, except Oct 28 7:40 to 8:10 PM | arrivals.csv 72,792 rows, predictions 312,385 (incl. archive), alerts 19, bus changes 44; 0 rows lost in a guard check of the real branch; first off-GitHub backup 257 MB | DC-021: Oct 28, 7:31 to 8:11 PM, every feed read timed out, about 160 arrivals lost, nobody told; safety nets added (self-test + fallback, no-rows-lost guard, health issue, watchdog, timetable versions, archive 85 days, backup) |
| 2026-10-28 15:50 | healthy | 100% since Oct 27 15:50 (collecting 84%, idle with no bus 16%); 31 of 31 finished collect runs since the last checkup succeeded, 2 running; 13 buses live | arrivals: 4,146 on Tue Oct 27 (the most of any day so far; 92 stations, 13 lines), 2,139 on Oct 28 by 3:33 PM, ~61,100 rows; 0 duplicates (none within 300 s), 0 rows missing stop / bus / route; 10-min prediction (within 300 s) for 73% of non-`gps` arrivals Oct 27, 65% Oct 28 so far: before 4 PM Downtown Campus Connector 46% and Apostolic/Drexel 47% against 68% / 86% the day before, while their arrivals were logged as usual (Passio published fewer times; an operator alert 10:21 AM to 1:13 PM rerouted shuttles around a construction vehicle at 59th & Ellis, "Goldblatt Pavilion boarding"); alerts.csv 14 versions; archive complete through Oct 27 (the DC-018 fix held: today's run succeeded); data repo synced 20:43Z; weather current | gaps only overnight; Midway Metra's last arrival 11:38 AM is its usual midday break (a bus was live again at 3:50 PM); recheck the prediction share tomorrow; DC-017 still open |
| 2026-10-27 17:25 | healthy collector; the daily archive failed for Oct 26 (DC-018, fixed) | 100% since Oct 26 17:25 (collecting 84%, idle with no bus 16%); 78 of 78 finished collect runs since the last checkup succeeded, 2 running; 18 buses live | arrivals: 861 on Sun Oct 25 (5 lines, first bus 4:06 PM; the Sunday before 731), 3,926 on Mon Oct 26 (92 stations, 13 lines), 2,531 on Oct 27 by 4:51 PM, ~58,100 rows; 0 duplicates (none within 300 s), 0 rows missing stop / bus / route; 10-min prediction (within 300 s) for 83% / 75% / 78% of non-`gps` arrivals Oct 25 / 26 / 27; alerts.csv 13 versions (2 new: Nightride Route Alert, Oct 26 4:13 PM and Oct 27 4:06 PM), last seen 4:46 PM; archive complete through Oct 25, Oct 26 failed (DC-018); data repo synced 21:54Z; weather current | newest arrival 34 min old (merges land at each run's end); gaps only overnight and on Sunday until 4:06 PM (normal); Passio published a new timetable on Oct 26 (valid to Nov 26): Apostolic 10 -> 11 stops, Apostolic/Drexel 11 -> 13, the live site already serves them; DC-017 still open |
| 2026-10-25 11:45 | healthy | 100% since Oct 24 11:42 (collecting 44%, idle with no bus 56%: a weekend); 59 of 59 finished runs since the last checkup succeeded, 1 idle run running; Passio 0 buses, next start Sun 4 PM (collecting from 3:15 PM) | arrivals: 3,940 on Fri Oct 23 (91 stations, 14 lines with South Loop Shuttle), 1,067 on Sat Oct 24 (the 6 weekend lines, first bus 3:39 PM; earlier Saturdays 1,018 / 1,029), 6 on Sun Oct 25 by 12:45 AM, ~52,400 rows; 0 duplicates (none within 300 s), 0 rows missing stop / bus / route; 10-min prediction (within 300 s) for 64% / 84% of arrivals Oct 23 / 24, 73% / 90% without the `gps` rows, no line under 40% on any day; alerts.csv 11 versions (3 new Oct 23 3:34 PM: North, Central, East Route), last seen Sun 5:26 AM; archive complete through Oct 24; weather current; data repo synced the last new arrivals 06:35Z (it runs every 25 min, commits only when arrivals change) | gaps only overnight and on Saturday until 3:39 PM (normal); Sat and Sun a collect run from 4:16 AM logged 0 rows: the timetable starts Friend Center/Metra at 5 AM every day, it runs weekdays only (expected, docs/DATA.md "When the collector runs"); DC-017 still open |
| 2026-10-23 14:20 | healthy | 100% since Oct 22 14:20 (collecting 77%, idle with no bus 23%); the 5 newest finished runs succeeded, 2 collecting (chain + :07 backstop, slots a and b), the :37 backstop queued behind slot b as designed; 10 buses live on 5 lines | arrivals: 3,754 on Thu Oct 22 (00:00 to 23:57, 90 stations, 13 lines), 1,924 on Oct 23 by 1:57 PM, ~47,700 rows; 0 duplicates (none within 300 s), 0 rows missing stop / bus / route; before 2 PM 1,737 / 1,753 / 1,749 non-`gps` arrivals on Oct 21 / 22 / 23, with a 10-min prediction for 74% / 79% / 71%; every live line logged 24 to 37 min ago (merges at each run's end); last run 420 polls, 0 errors, 3 failed fetches, alerts 0 of 14 failed; alerts.csv 8 versions, last seen 1:53 PM; archive complete through Oct 22 (5 files a day); weather (Oct 23) succeeded; data repo synced 18:36Z | nothing new; DC-017 still open |
| 2026-10-22 20:09 | healthy | 100% since Oct 21 20:08 (collecting 75%, idle with no bus 25%); the 6 newest finished runs succeeded, 2 running, chain `done:dispatched`; 15 buses live on 8 lines | arrivals: 3,099 on Oct 22 by 7:41 PM, ~45,200 rows; 0 duplicates (none within 300 s), 0 rows missing stop / bus / route, 90 stations and 13 lines today; every live line has an arrival 29 to 35 min old (merges land at each run's end, about every 40 min); predictions with a 10-min lead for 79% of today's non-`gps` arrivals, 182,790 rows; last run: 420 polls, 0 errors, 0 failed fetches, alerts 0 of 14 polls failed; alerts.csv 8 versions, last seen 7:36 PM; archive (Oct 22 run) and weather (Oct 22) succeeded; data repo synced 00:37Z | nothing new since the 17:15 checkup; DC-017 still open |
| 2026-10-22 17:15 | healthy | 100% since Oct 21 17:14 (collecting 75%, idle with no bus 25%); the 8 newest runs succeeded, 18 buses live | arrivals: 3,704 (Tue Oct 20), 4,123 (Wed Oct 21, the most of any day so far), 2,487 (Oct 22 by 5:09 PM), ~44,500 rows; 0 duplicates, 0 rows missing stop / bus / route, 90 stations and 13 lines on Oct 20 and 21; predictions with a 10-min lead (joined within 300 s as docs/DATA.md says) for 70% (Oct 20), 61% (Oct 21), 78% (Oct 22 so far) of arrivals, 76% / 70% / 82% without the `gps` rows (no prediction by design, DC-003); alerts.csv 8 versions, polled live (two new today 4:05 PM: North Route, Central & East Night Ride route modified); archive complete through Oct 21 (5 files a day); data repo synced 21:40Z; weather current | no arrivals 00:00 to about 5 AM on Oct 21 and 22: normal (0 to 15 a night even while the collector ran all night, Oct 10 to 17); Oct 21's lower prediction share is mostly Passio's (359 of the 497 non-`gps` arrivals without a row had no Passio prediction 5 to 15 min ahead in the raw archive); found DC-016, DC-017 |
| 2026-10-20 19:00 | healthy | 100% since Oct 19 18:57 (collecting 87%, idle with no bus 13%); no run failed; no warning besides GitHub's Node.js 20 notice | arrivals: 4,070 (Mon Oct 19, the most of any day so far), 2,912 (Oct 20 by 6:39 PM), 0 duplicates, 0 rows missing stop / bus / route, 90 stations and 13 lines on weekdays; predictions with a 10-min lead for 68% (Oct 19) and 72% (Oct 20) of arrivals; alerts.csv 5 versions, polled live; archive complete through Oct 19 (5 files a day); data repo synced 23:42Z; weather current | collecting only while buses run works: idle Sun night 1:35 to 4:16 AM and Mon night 1:30 to 4:15 AM, 0 arrivals inside an idle window, the first bus of each morning 31 to 44 min after collecting resumed (DC-014 checked); DC-015: 27% of daytime polls empty on Oct 19, some runs 75 to 87% for an hour, but every 30-s window from 5 AM to midnight had a full answer from some run (no data lost); from this PC 24 of 24 polls were full, with or without a cache-buster |
| 2026-10-19 19:45 | healthy; first full day collecting only while buses run (DC-014) | 100% since Oct 18 14:48 (collecting 80%, idle with no bus 20%) | arrivals.csv ~33,600 rows, newest 81 s old, 16 buses live | idle run took over Sun 10:57 AM, started collecting Sun 3:16 PM (45 min before the 4 PM routes) and Mon 4:16 AM (before the 5 AM first trips); Sun night idle 2:36 to 4:16 AM after the last bus; `status` showed a false 60-min gap for a backstop run that idled (fixed: `monitor.py auto_idle`) |
| 2026-10-16 12:45 | healthy; verified and backfilled (owner: "make any changes or fixes needed. Update all data collected if needed") | 100% since the last checkup (`monitor.py status` HEALTHY) | fixes DC-009 to DC-012 on main; Oct 10 to 15 replayed with today's code (tools/replay_day.py, validated on Oct 15: 3,431 of 3,431 arrivals identical) and applied (tools/apply_replay.py, data `2db4cbc`): arrivals +576 (Oct 10 +122, 11 +109, 12 +250, 13 +95; GPS pass rows), predictions +2,248 missed rows, -558 previous-lap rows (502 of them predicted over 15 min early), 160 replaced by a fresher copy; 0 duplicates; eta-<day> assets of Oct 10 to 15 re-uploaded and their summary rows rebuilt (data `da1782b`) | Oct 8 / 9 cannot be replayed (no polls were kept); see DC-002, DC-008, DC-010, DC-011 |
| 2026-10-16 01:11 | healthy | 100% of 31.6 h of actual logging time since the last checkup (83 runs, all succeeded, no gap over 1 min) | arrivals: 3,637 (Oct 14), 3,419 (Oct 15), 0 duplicates, 0 rows missing stop / bus / route, 89 to 90 stations and 13 lines a day; predictions.csv 73,396 rows, 10-min coverage 67% (Oct 13) -> 71% (Oct 14) -> 76% (Oct 15); alerts.csv 3 rows, polled live (last_seen 23 min old); archive through Oct 14 incl. alerts-2026-10-14.csv.gz, Oct 15 due with today's run; data repo synced 03:28Z; weather current | `monitor.py status` HEALTHY; found DC-012; DC-008 checked (watch); DC-011 unchanged; traffic context ends 2026-04-30 (known: the city stopped the dataset, RouteKnower §3.4) |
| 2026-10-14 17:33 | healthy | 100% of 33.9 h of actual logging time (job start to end), no gaps, 145/145 runs since Oct 11 succeeded | arrivals: 3,469 (Oct 12), 3,640 (Oct 13), 2,473 (Oct 14 so far); predictions.csv 46,386 rows since Oct 12 12:20; no duplicate rows; archive complete through Oct 13 | `monitor.py status` said DEGRADED: DC-004, DC-005 (both false or harmless); the data check found DC-006 to DC-011 |

## Errors

### DC-025 Checkup 2026-11-10: healthy; one archive day lost to a GitHub 503 (fixed); Passio stopped predicting some stops on Oct 27 (open, Passio's side); a Monday morning with four lines missing from the feed (accepted)
Owner (2026-11-10): "Run a data collection check." Times are Chicago (CST). Sat Nov 7 is compared with the Saturdays Oct
17, 24 and 31, Sun Nov 8 with the Sundays Oct 18, 25 and Nov 1, Mon Nov 9 with the Mondays Oct 19, 26 and Nov 2. Tue Nov
10 had no service yet at the checkup (2 to 4 AM). Nov 9's raw polls were rebuilt from the run artifacts on this PC
(read-only; the archive builds them later today). Scripts and downloads stayed off the repo (job folder).

**1. Collector: healthy, no gap since the last checkup (nothing to fix).**
- Runs: all 78 finished collect and idle runs from Sat Nov 7 12:38 PM to Tue Nov 10 12:32 AM succeeded (52 collect runs
  started by the chain, 20 by the cron backstop, 6 idle runs; an idle run is watching now); no hole between runs. The
  pre-flight self-test passed in every one (tag `collector-ok` = `317aca40`). The 65 logging runs had 0 processing errors,
  at most 2 of 420 feed reads failed (Sat 11:01 PM), 0 alert polls failed, and `health run: all clear` in each (no feed
  outage, no schema error). The DC-023 dispatch retries were never needed: no `dispatch failed` in any run; 13 collect
  runs and 6 idle runs stood down as followers when a cron backstop took the lead.
- Gate: Sat idle until 3:17 PM (the idle run started a collect run 43 min before the 4 PM lines; first bus 3:42 PM),
  collecting to Sun 1:33 AM (last bus in the feed 12:48 AM), idle 1:33 to 4:15 AM, a collect run 4:15 to 5:57 AM for
  Friend Center/Metra's 5 AM listing (weekdays only in practice: 0 rows, known since Oct 25), idle 5:57 AM to 3:16 PM
  (the backstops at 10:59 and 11:13 AM found no bus and idled; the one at 3:01 PM took over the watch and started
  collecting at 3:16 PM), collecting Sun 3:16 PM to Mon 12:52 AM (first bus 3:50 PM, last 12:18 AM), idle 12:52 to 4:16
  AM, collecting Mon 4:16 AM to Tue 12:32 AM (first bus 4:52 AM, last 12:01 AM), idle since. No bus was in the feed while only an idle run watched. Coverage 100% since Nov 9 2:23 AM (collecting
  82%, idle with no bus 18%).
- `collector-health` issue #1: closed itself on Sun Nov 8, 5:26 AM (the Nov 5 gap left the 2-day window, as DC-024 said),
  reopened Mon 3:02 PM for item 2, closed again Tue 2:25 AM. The data repo's watchdog issue stayed closed.
- Data repo: 141 sync runs from Nov 7 12 PM to Nov 10 2:26 AM, 139 succeeded, `health.py watchdog` all clear in every
  one, 130 dispatches on the first try (the rest skipped for a waiting run); one run (Mon 12:22 PM, `42673420807`) failed
  without ever starting a job (GitHub's side: no jobs, no log), so the sync chain stopped until the cron backstop
  restarted it at 2:57 PM: the public copy and the watchdog paused 2 h 35 min, no data lost. The secret
  `COLLECT_DISPATCH_TOKEN` is still unset (owner; DC-021).
- Weekly `findings.yml` (data repo): its first scheduled run (cron Mon 11:41 AM) fired at 6:50 PM, 7 hours late like
  every GitHub cron here, and succeeded: 27 new rows in `findings/leave_eval_history.csv` (run `2026-11-10T00:51Z`, data
  Oct 10 to Nov 7, 29 days, test week Nov 1 to 7), the workbook and `findings/csv/` rebuilt (commit `64411737`), no
  signal ready (`ready_signals` empty; the readiness rule needs data to Nov 26 anyway), no readiness issue. Sun Nov 8 was
  not in it because item 2 kept Nov 8 out of the archive until Tue; next week's run has it.
- Weather context daily (Mon 3:28 PM). Timetable `708be9d370e2` unchanged (last used Nov 10 12:32 AM; today's zip has
  the same content, only feed_info's dates roll daily, now Nov 9 to Dec 10). Site data: the daily scheduled deploy on
  Mon (fired 1:49 PM) was cancelled by a push a minute later (the `pages` concurrency group cancels the older run), but
  each later deploy rebuilt web/data from the fresh zip, and the live `timetable.json` and `service.json` (added Nov 9)
  are from Mon 7:58 PM (15 routes, 93 stops, every line). Only the schedule-only places refresh was skipped that day
  (also Nov 5); harmless. One deploy after this checkup's push timed out on GitHub Pages' side ("syncing_files") and was
  rerun.
- Off-GitHub backup verified (`backup.py --check` ok: made Nov 6 4:14 AM, 151 files, 301 MB); not due yet (every week or
  two: next about Nov 13 to 20).

**2. The archive lost Sun Nov 8 to one HTTP 503 (fixed).**
- What: the scheduled archive run Mon 3:01 PM (`42698531311`) failed Nov 8: `gh api .../actions/artifacts/13637265951/zip:
  gh: HTTP 503` on one of that day's artifact downloads, and the whole day was skipped (the other days were already
  archived). `health.py` reopened issue #1 ("The daily archive job could not archive every day"); `health.py archive`
  itself said all clear, because it flags a missing day only after 2 days.
- Impact: none on the data (the artifacts last 90 days); Nov 8's files and summary rows came 11 hours later, and the
  weekly findings run of Mon evening went without Nov 8.
- Fix: archive.yml dispatched by hand Tue 2:24 AM (`42782409229`, success: Nov 8 = 20,617 prediction updates, 15,268
  position reports, 53,138 table rows, 9 bus drops, 1 alert version; 147 summary rows); the issue closed itself. And
  `de1d192f`: `archive_day.gh()` now tries a call GitHub answers with a 5xx or a dropped connection again 10, 30 and 90 s
  later (any other failure, a 404 for instance, is final at once); test `test_archive_gh_retries_server_errors_only`
  (test_eta 21/21, collector_selftest ok, collector-tests green). Nov 9 is archived by today's scheduled run.

**3. Passio stopped publishing times for some stops on Oct 27 (open: Passio's side; facts for the owner).**
- What: the share of non-`gps` arrivals that carry a Passio prediction (`passio_pred_*`) stepped down on Oct 28 and has
  stayed there: weekdays Oct 19 to 27 85 to 93%, since Oct 28 81 to 85% (Mondays Oct 19 / 26 93% / 92%, Nov 2 / 9 85% /
  83%; weekends Oct 17 / 18 / 24 / 25 92 to 98%, since Oct 31 71 to 85%). The 10-min rows of predictions.csv fell alike
  (Mondays 79% / 75%, then 68% / 65%). The Oct 28 checkup saw the drop ("Passio published fewer times") and DC-023 / DC-024
  noted the lower share; this is its cause, in two parts:
  - **Four Downtown Campus Connector stops get no time at all** since Tue Oct 27, about 6:30 PM: Gleacher Center (132963),
    UCHICAGO Medicine - River East (132964), E Randolph St & S Michigan Ave (155006) and S Michigan Ave/Roosevelt Rd
    (132965). Arrivals there with a Passio time: Oct 20 to 26 97 to 99% (Oct 26 155 of 156), Oct 27 98 of 122 (the last at
    6:30 PM), Oct 28 to Nov 9 0 to 6 of 101 to 133 a day. Passio's raw trip updates for those stops: 9,726 on Oct 26, 27
    on Nov 2, 240 on Nov 9. The buses still serve them (Passio's own vehicle feed names them as the bus's stop; the rows
    come from it), and the line's other 10 stops kept their times (73 to 100% a day since Oct 28).
  - **The first stops after a terminal get the time under another trip id:** North stops 1 to 3 (Regenstein Library, Max
    Palevsky, Ellis Garage) 83 to 93% on Oct 26, since Oct 28 7 to 62%; East's stop 1 (Regenstein Library) 100% before,
    0 to 25% since; 53rd Street Express stops 1 and 2 (53rd St & Kenwood, Kimbark Plaza) 88 to 96% before (Oct 20 to 27),
    11 to 37% since; Drexel and South at times (Nov 9: Drexel 67%, South's 63rd & Woodlawn 16%). Of Nov 9's 600 non-`gps` arrivals
    without a Passio time, 233 had one for the same bus and stop under another trip id (Oct 26: 111 of 295); of the 240
    shown 5 min ahead, 166 were more than 3 min earlier than the bus came: the trip update had the bus on the next (or
    previous) timetable trip while its vehicle report kept the other.
- Not the collector: the logger writes every stop time update it gets (`store_predictions`, no stop filter), no collector
  code changed between Oct 27 and Oct 29 2:56 AM (the change before, `e3d8aafc`, only stopped an archive crash), and the
  detector passes over few usable times: only 8 of Nov 9's 600 had a time under their own trip id, first seen 2 to 20
  min before and within 5 min of the arrival (Oct 26: 35 of 295).
- Impact: those arrivals are logged but drop out of the Passio scoring sample (about 130 a weekday at the four downtown
  stops, about 80 more at first stops); for riders, Passio's public feed, which the app reads, has had no live time at
  the four downtown stops since Oct 27 evening.
- Follow-up (owner): tell Passio / UChicago Transportation about the four stops (the feed covers every other stop of the
  line); check what the app's stop pages show there (Gleacher Center, River East, Randolph & Michigan, Michigan &
  Roosevelt). For RouteKnower: at a line's first stops the time riders saw came from the bus's next-trip update; counting
  it as `preds_at` already does for some leads would be a detector change with a replay, the owner's call.

**4. Mon Nov 9, 5 to 7:30 AM: Apostolic, Midway Metra, Friend Center/Metra and Red Line/Arts Block missing from the feed
(accepted: the operator's service or Passio's, not the collection).**
- From 4:52 to 6:15 AM the feed held 2 buses (4319, 4324), from 6:15 more Downtown Campus Connector buses, and no bus and
  no prediction for Apostolic (listed with 3 buses from 5 AM), Midway Metra (2 to 3 from 5:40 AM) and Red Line/Arts Block
  (2 from 6:30 AM) until 7:00 to 7:30 AM; Friend Center/Metra's bus 4319 was relabeled Drexel at 5:30 AM, so that line
  had none until 7:30. First arrivals: Apostolic 7:3x (Oct 19 to Nov 6: 5:00 to 5:40), Midway Metra 7:2x (5:30 to 6:40),
  Red Line 7:3x (6:20 to 7:20). No operator alert. Those morning hours came to about 250 arrivals fewer than on the
  Mondays (Apostolic 149 for the day against 220 to 295, Friend Center/Metra 259 against 302 to 385); the day's total
  stayed in range because Apostolic/Drexel (763 against 580 to 710) and others ran more.
- The collection itself: collecting from 4:16 AM, every 30-s window had an answer, the 2 Drexel buses were logged from
  4:52 AM. Nothing to fix; the rest of Monday came to 3,949 arrivals (Mondays 4,070 / 3,925 / 3,931).

**5. The weekend and Monday in numbers (normal unless said).**
- Sat Nov 7: 756 arrivals (Saturdays 1,027 / 1,065 / 929), 5 lines, 37 stations, 5 buses. The operator ran 1 bus a line
  all evening (on Oct 24 and 31 Central and East had 2 from about 4 to 9 PM, against 1 listed; South is listed with 2
  all evening and had 1 on those Saturdays too): Central 224 (302 to 361), East 206 (281 to 315). South 4315 left the
  feed 9:45 to 10:30 PM (South 10 PM: 4 rows, Saturdays 24 to 26); North 4313 stood at Reynolds Club 9:00 to 9:30 PM.
  No bus count change (no line had 2 buses). Passio time on 82% of non-`gps` arrivals; 2,962 prediction rows.
- Sun Nov 8: 1,017 arrivals, the most of any Sunday (729 / 856 / 776), 4 lines, 35 stations, 8 buses: Central and East
  ran 2 (East 3 at 7 to 9 PM) against 1 listed. 9 bus adds, 5 lasting drops, 4 layovers; Passio 85%; 4,565 prediction
  rows.
- Mon Nov 9: 3,949 arrivals, 13 lines, 92 stations, 21 buses, 350 `gps` rows (Mondays 343 to 347), 16,669 prediction
  rows (Mondays 21,531 / 20,151 / 18,155: item 3), 50 adds, 41 lasting drops, 8 layovers (Nov 2 to 6: 40 to 62 adds, 34
  to 55 lasting drops). Central's bus left the feed at 9:47 PM and no Central bus came back before its listed end
  (11:14 PM); the operator's NightRide notice ("every 30 minutes for the entire evening", 3:25 PM to 12:00:34 AM) was up.
  The NightRide buses left the feed by 12:01 AM.
- Every day: 0 duplicates (same bus and stop within 300 s), 0 rows missing ids, every route id in the timetable, no
  report older than 5 min while its bus stayed in the feed, no two buses at identical coordinates, no poll gap during
  service. After hours: Central 4318 11:30 PM to 12:04 AM on Sat and Sun (the nightly Central pattern of DC-023 item 7,
  on weekends too); Mon: Drexel 4324 10:31 to 11:17 AM and Apostolic 4538 / 4317 / 4322 10:41 to 11:17 AM (item 6),
  Regents Express 12644 at times before its 5:20 PM start and after 9 PM, Midway Metra 12648 7:12 to 7:41 PM (item 6), Red Line 12646 9:31 to 9:43 PM on
  its way to the garage.

**6. Buses on another line than their Passio label (DC-024 item 3, still open; the numbers go on).**
- Same test as DC-024 (moving reports per 10 min against every line's drawn shape). Sat Nov 7 and Sun Nov 8: 0. Mon Nov
  9: 4 episodes, 3.5 bus-hours (weekdays Oct 23 to Nov 6: 0.5 to 7.3; Nov 2 3.3):
  - 4331, labeled Apostolic/Drexel, drove Friend Center/Metra's loop 6:10 to 8:50 PM: the 5 PM handover again (10 of 12
    weekdays now). Friend Center/Metra's own bus 4327 was labeled Apostolic/Drexel from 6 PM. 31 visits of 4331 at the
    shared hospital stops were filed as Apostolic/Drexel, and Friend Center/Metra logged 0 rows 6 to 9 PM (Oct 19 and
    Nov 2: 23 to 25 an hour; Oct 26: 0, the same swap).
  - 4324, labeled Drexel, drove Apostolic/Drexel 10:00 to 11:20 AM (Drexel listed to 10:15): 17 visits filed as Drexel,
    Apostolic/Drexel's first hour (10 AM) 0 rows (Mondays 20 to 35). New in this form; the morning lines' Downtown Campus
    Connector pattern of DC-024 also showed (4317, labeled Apostolic, on the Downtown Campus Connector 10:30 to 11 AM, no
    row).
  - 12648, labeled Midway Metra, drove Red Line/Arts Block 7:10 to 7:40 PM, after Midway Metra's 6:55 PM end (7 of 12
    weekdays now); 1 row.
- Tue Nov 10: no service yet at the checkup; the next checkup counts it.

**Status.** Collector healthy, nothing lost (item 1). Fixed: item 2 (`de1d192f`, Nov 8 archived by hand). Open, Passio's
side: item 3 (four Downtown Campus Connector stops without times since Oct 27, the first stops' times under another trip
id); the owner may tell Passio. Accepted: items 4 and 5. Still open from DC-024: buses on another line than their label
(item 6, the owner's call). Still for the owner: the secret `COLLECT_DISPATCH_TOKEN` in the data repo (DC-021, DC-023).
Recheck next time: Tue Nov 10's day, the Passio share at the four downtown stops, the archive retry in a real run.

### DC-024 Checkup 2026-11-07: healthy; buses on another line than their Passio label (open); the Downtown Campus Connector off its drawn line (facts); a false status warning (fixed)
Owner (2026-11-07): "Run a data collection check." Times are Chicago (CST). Fri Nov 6 is compared with the Fridays Oct
16, 23 and 30 and the weekdays Nov 2 to 5; Sat Nov 7 with the Saturdays Oct 10 to 31. Scripts and downloads stayed off
the repo (job folder).

**1. Collector: healthy, nothing lost since the Nov 5 gap (nothing to fix).**
- Runs: all 62 collect and idle runs from Nov 5 12:39 PM to Nov 7 10:20 AM succeeded; the pre-flight self-test passed
  in every one (tag `collector-ok` = main `30edd298`); the 53 logging runs had 0 processing errors, at most 2 of 420
  feed reads failed, 0 alert polls failed. The DC-023 dispatch retries were never needed: no `dispatch failed` in any
  run, 47 hand-offs on the first try, 15 runs (11 collect, 4 idle) stood down as followers when a cron backstop took
  the lead.
- Gate: collecting Fri 4:15 AM to Sat 1:57 AM (South Loop Shuttle 4328 was the last bus in the feed, to 1:24 AM; last
  arrival 12:53 AM), idle 1:57 to 4:15 AM, a collect run 4:15 to 5:30 AM for Friend Center/Metra's 5 AM listing (it runs
  weekdays only: 0 rows, known since Oct 25), idle since 5:30 AM (the cron backstops at 7:52 and 9:03 AM found no bus
  and idled too). Next: Saturday lines at 4 PM, collecting from 3:15 PM. Coverage 100% since Nov 6 12:58 PM.
- `collector-health` issue #1: only the Nov 5 gap, refreshed 10:37 AM Nov 7; Nov 5 leaves the 2-day data check on
  Nov 8 and the issue closes itself at the next collect run after that.
- Data repo: the sync chain ran every 25 min (46 runs checked, Nov 6 5:03 PM to Nov 7 12:39 PM, all succeeded; each
  dispatch on its first try, 4 times a waiting run made it skip); `health.py watchdog` all clear in every run; the
  secret `COLLECT_DISPATCH_TOKEN` is still unset (owner; DC-021). The weekly `findings.yml` ran once, by hand, Nov 6
  1:32 PM (success): the workbook covers Oct 10 to Nov 5 (27 days, test week Oct 30 to Nov 5, no signal ready); its
  first scheduled run is Mon Nov 9, 11:41 AM.
- Archive complete Nov 1 to 6 (Nov 6 by the schedule at 10:37 AM Nov 7, 6 hours late as usual; nothing to dispatch);
  weather context daily (Nov 7 10:53 AM); timetable 708be9d370e2 unchanged (valid Oct 31 to Dec 1); off-GitHub backup
  verified (made Nov 6 4:14 AM, 151 files; next due about Nov 13 to 20). The only collector-side change since DC-023,
  `f54c536a` (forecast-table transition columns), passed collector-tests.

**2. Fri Nov 6: normal totals; the short line-hours are explained (accepted).**
- 3,987 arrivals (Fridays 3,995 / 3,944 / 4,203), 14 lines, 93 stations, 20 buses, 0 duplicates, 0 rows missing ids,
  17,677 prediction rows (Fri Oct 30 19,440; weekdays Nov 2 to 5 14,253 to 18,161); Passio prediction on 85.3% of
  non-`gps` arrivals (Fridays 84.7 to 92.8%).
- DC-023 item 4 (watch): `gps` rows back to 364 (Fridays 277 to 487; Nov 4 / 5 611 / 552), no bus with hours of
  disagreeing feeds. Red Line/Arts Block 34% `gps` (frozen trips on 4319, 4315, 4331: DC-003's usual case), North 23% (26
  rows of 4327).
- Bus count changes 62 adds and 55 lasting drops (Nov 2 to 5: 40 to 53 and 34 to 50), 9 of the drops a bus moving to
  another line: the most of any day, in step with item 3. Alerts: the NightRide notice ("every 30 minutes for the entire
  evening", 3:15 PM to 12:00:34 AM), as on Nov 2, 3, 5.
- Line-hours under half of the Fridays: Friend Center/Metra 11 AM (0 rows; no Friend Center/Metra bus was in the feed
  from 10:52 to 11:57 AM, between 4319 leaving and 4313 coming: service, not collection), Midway Metra 3 PM (0; Fridays
  29 / 1 / 31), Regents Express 5 PM (0; 1 / 10 / 11), Apostolic/Drexel 6 PM and 11 PM (18 and 28; 50 to 61 and 54 to
  70): all three are buses labeled as another line (item 3). Friend Center/Metra's 35 rows after 9 PM (listed to 8:55
  PM) are Apostolic/Drexel visits filed under it (item 3).
- Feed: no report older than 5 min while its bus stayed in the feed, no two buses at identical coordinates, every route
  id in the timetable. After hours: Central 4326 11:30 PM to 12:08 AM (the nightly Central pattern, DC-023 item 7);
  Apostolic 4325 11:49 AM to 4:27 PM (out of the garage at 11:49, stood at Goldblatt Pavilion from 12:17 to 3:10 PM,
  then drove Midway Metra under the Apostolic label); Drexel 4327 10:31 to 10:53 AM; Regents Express 12648 9:29 to
  10:19 PM (then labeled North); Midway Metra 12646 and Friend Center/Metra 4313 / 4331 in the evening (item 3). The
  NightRide buses left the feed at 12:05 to 12:10 AM like every night; the South Loop Shuttle (listed to 12:55 AM) last.

**3. Buses driving another line than their Passio label, measured over 12 days (DC-003 item 4; open, the owner's call).**
- How: each bus's moving reports (speed 2 m/s or more, or moved 15 m since its last report) per 10 min against every
  line's drawn shape (within about 40 m); a stretch counts when under 30% of the reports lie on the labeled line and 85%
  or more on one other line, for 30 min or more. Archived raw polls of Oct 23 to Nov 6.
- Bus-hours off their label per weekday: Oct 23 2.8, Oct 26 7.3, 27 3.2, 28 3.8, 29 4.7, 30 2.0, Nov 2 3.3, 3 5.3, 4 1.7,
  5 0.5 (2-hour gap), 6 7.2 (10 episodes, the most); the Saturdays and the Sunday 0. Passio relabels most of these buses
  later to the line they were driving (4331 on Nov 6 after 72 min), so the label lags; the path is not unknown.
- Recurring:
  - About 5 PM the Apostolic/Drexel bus takes over Friend Center/Metra's loop and keeps the Apostolic/Drexel label for 40
    to 170 min: 9 of 11 weekdays (4331 on Oct 23, 27, 28, 29, 30, Nov 3, 4, 6; 4315 on Oct 26). At the same time the
    Friend Center/Metra bus drove Apostolic/Drexel's loop under its own label on Oct 29 and 30 (4325) and Nov 6 (4313):
    the two buses swap at the hospital stops.
  - 9:10 to 11:50 AM, buses of the morning lines drive the Downtown Campus Connector's line under their old label
    (Midway Metra 4315 Oct 27 and 28, 4538 Nov 3; Apostolic 4322 Oct 28, 4317 and 4328 Nov 2; Red Line 12648 Oct 28 and
    Nov 3).
  - Around the end of Midway Metra's evening service (6:55 PM) its bus drives Red Line/Arts Block, Apostolic/Drexel or
    Friend Center/Metra for 30 to 50 min under the Midway Metra label: 6 of 11 weekdays (Oct 26, 27, Nov 2, 3, 4, 6).
  - A line's first trips run under the bus's previous label: Regents Express (Nov 6, 12648 labeled Downtown Campus
    Connector 5:20 to 6 PM), East (Oct 23, 12646 labeled 53rd Street Express; Nov 6, 4322 labeled Red Line 4 to 4:30 PM),
    South Loop Shuttle (Nov 6, 4328 labeled 53rd Street Express 7 to 7:30 PM).
- Fri Nov 6 in full: 4331 (Red Line label) on Apostolic/Drexel's loop 3:00 to 4:37 PM; 4325 (Apostolic) on Midway Metra
  3:18 to 4:27 PM; 4322 (Red Line) on East 4:00 to 4:30 PM; 12648 (Downtown Campus Connector) on Regents Express 5:20 to
  6:00 PM; at about 5:55 PM 4331 (Apostolic/Drexel label) and 4313 (Friend Center/Metra) swapped loops, 4331 was
  relabeled at 7:07 PM, 4313 kept its label on Apostolic/Drexel's loop until it left at 12:08 AM; 4328 (53rd Street
  Express) on South Loop Shuttle 7:00 to 7:30 PM; 12646 (Midway Metra) on Red Line 7:10 to 7:50 PM and on
  Apostolic/Drexel 8:40 to 9:20 PM.
- Impact on the rows: a visit is logged under the label's line where both lines have the stop, and missed where only the
  driven line has it. Nov 6: 63 rows of 4313 filed as Friend Center/Metra at the hospital-loop stops (S Drexel Ave &
  57th St, Wyler Pavilion, Bernard Mitchell Hospital, 58th Street & Drexel, Comer Children's Hospital, Goldblatt
  Pavilion) were Apostolic/Drexel visits; 16 rows of 4331 filed as Apostolic/Drexel were Friend Center/Metra visits;
  the short line-hours of item 2. About 2 to 7 bus-hours a weekday, a few percent of the stop visits. For riders such a
  bus is on the map as the wrong line, with that line's times, and the off-route rule (E27b, 250 m) can hide a bus that
  is serving another line.
- The detector's own check (`GPS_WRONG_ROUTE`, off since DC-003): Nov 6 replayed twice from the release files (one pass,
  read-only; the plain replay matched 99.0% of the live rows). With the check on: +29 rows, none removed; 4322 as East
  (7) and 12646 as Red Line/Arts Block (7) are right, 4331 as Friend Center/Metra (15, 3:22 to 4:35 PM) is wrong (it drove
  Apostolic/Drexel: the two lines share the hospital loop under different stop ids), and the other 7 episodes give
  nothing (where the labeled line has most of the stops, Passio's route explains the visits). 2 of 10 found, 1 misfiled:
  it stays off.
- Follow-up (owner's call; nothing changed today): the line-share test above finds these from the GPS alone. It could
  mark the affected rows so scoring leaves them out, refile the visits under the line driven (a replay, only with the
  owner's go-ahead), and give the app the line a bus is really on. For RouteKnower: the 5 PM Apostolic/Drexel to Friend
  Center/Metra handover recurs almost daily.

**4. The Downtown Campus Connector against its drawn line (facts for the app's off-route work, workstream dcc-offroute).**
Owner's report (2026-11-07): the Downtown Campus Connector still shows when it is not on its route. Moving reports of
buses labeled with it, against its drawn line (`web/data/shapes.json`, route 5704). At the time of the report the app
hid a bus more than 250 m off its line (E27b, `BLOCK_M`); the rule that shipped later that day (RouteKnower E27c:
learned driven corridors, 120 m for 2 min near them) was built on the same places:
- Per day (Oct 30, Nov 2 to 6): within 40 m 85 to 90%, 40 to 125 m 4 to 6%, 125 to 250 m 2 to 5%, beyond 250 m 3 to 5%.
  The 40 to 250 m band, which stays on the map, is 1,070 to 2,246 reports a day (6 to 11%), about half downtown and
  half on campus.
- Downtown, every trip, all day: after S (Upper) Wacker Dr & W Adams St the buses turn west on Adams St and south on
  Clinton St, while the drawn line goes on south on Wacker to Van Buren St and west on Van Buren: 125 to 353 m off (Nov 6:
  207 reports from 7 buses; Oct 30: 256 from 8; 6 AM to 9 PM). Only the corner at Clinton and Adams (about 290 to 350
  m) is beyond 250 m, for under a minute.
- Some trips: Columbus Dr instead of Michigan Ave between about Monroe St and Roosevelt Rd (211 to 296 m; Nov 6 9:51 AM
  and 5:44 PM, Oct 30 4:31 PM); Lake Shore Dr (360 to 584 m, already hidden); one bus circling near Gleacher Center and
  River East (125 to 245 m, Oct 30 5:12 to 6:05 PM).
- Campus: buses standing 125 to 250 m from the line with the frequency trip 874028 still attached, so on the map:
  Cottage Grove Ave and 60th St (41.7864, -87.6070, about 160 m off; 12642 Nov 6 12:11 to 12:39 PM, 12643 and 12646 Oct
  30 9:25 to 10:39 AM), near 58th St and Ellis Ave (41.7899, -87.5981; 12646 Oct 30 7:50 to 8:53 PM, 139 to 239 m), and at
  41.7912, -87.6041 (4327 Nov 6 12:25 PM, Oct 30 11:22 AM).
- Its label on a bus driving another line (item 3's test): Nov 6 12648 on Regents Express 5:20 to 6 PM; Nov 5 4315 on
  Apostolic/Drexel 12:50 to 1:20 PM; Oct 26 4331 and 12646 on Red Line/Arts Block (10:30 to 11:30 AM, 2:50 to 4:30 PM)
  and 12648 on Midway Metra (2:40 to 4:10 PM). The reverse, its service under another label, happens most weekday
  mornings (item 3).
- Shared with the dcc-offroute workstream (its progress log; it found the same Union Station and Cottage Grove places
  and proposes redrawing the line downtown); no app code changed here.

**5. Archived position polls can list one bus twice (accepted; documented).**
- 65 of the 12,675 polls in `raw-polls-2026-11-06` hold one bus twice (312 doubled reports; Oct 30: 23 polls, Oct 31:
  none). Both overlapping runs polled in the same second and got snapshots a few seconds apart (12:51:32 PM: 4313 at
  report times 12:51:19 and 12:51:29); `archive_day.merge_raw` keeps every distinct (vehicle, report time), so the merged
  poll lists both, not always in time order. The per-run artifacts have none, and the feed sent none.
- Impact: none on the CSVs or the forecast table (`build_eta_dataset.load_raw` dedupes on vehicle + report time and
  sorts); a reader that takes a poll as one snapshot of the fleet must do the same. docs/DATA.md says so now.

**6. `monitor.py status` warned "no new arrivals merged for 3 h" at each service start (fixed).**
- What: at 4:11 PM Sat the status said DEGRADED, "buses are running but no new arrivals merged for 3 h": the 4 Saturday
  buses (North, South, Central, East) had just started, the newest arrival was last night's (12:53 AM), and the first
  collect run of the stretch (started 3:17 PM by the idle run) merges its rows only at its end (4:27 PM). The same false
  warning shows for about the first 80 min after every idle pause (weekday 5 AM starts, weekend afternoons); the check
  was off from about Nov 4 until DC-023's fix on Nov 6 (item 2 there), which is why no checkup had met it lately.
- Impact: none on the data; a checkup could chase a problem that is not there.
- Fix: `first_merge_due` in tools/monitor.py: while the current stretch of collect runs (back to the last idle run or
  a 10-min hole) is younger than one run plus 15 min, status prints "this stretch's first merge is due by HH:MM"
  instead of the warning; after that, or with no collect run active, the warning stands. Test
  `test_first_merge_due_after_an_idle_pause` (the Saturday start, a chain collecting for hours, a hole before the
  stretch, an idle run only); test_monitor 11/11, collector_selftest ok. The collect runs do not use it.

**7. Sat Nov 7 so far (normal).**
- No Saturday service before 3:45 PM (the Saturday lines start at 4 PM; Friend Center/Metra, listed at 5 AM every day,
  ran no bus). The idle run started a collect run at 3:17 PM, and its merge at 4:27 PM brought 48 arrivals from 3:45 to
  4:25 PM: Central 15, East 13, South 13, North 7; 35 stations, 1 `gps` row, a Passio prediction on 30. Earlier
  Saturdays in the same window: 29 / 54 / 57 / 60 (Oct 10 / 17 / 24 / 31), first bus 3:39 to 3:59 PM.
- One bus per line was in the feed at 4:11 and at 4:46 PM (the Saturday timetable lists 2 for North and South from 4 PM;
  Oct 17 to 31 had 6 or 7 buses by 4:25 PM), and no alert besides the standing route-assistance notice: the operator's
  service, not the collection. Whole Saturdays so far: 929 to 1,065 arrivals on 5 lines; the next checkup compares the
  full day.

**Status.** Collector healthy, nothing lost (item 1). Fixed: item 6 (`0e0699d3`). Open, the owner's call: item 3 (a check
from the GPS that marks or refiles the visits of buses running under another line's label; the detector's own check
stays off). Facts shared: item 4 (dcc-offroute; E27c shipped the same day). Accepted: items 2, 5 (docs/DATA.md says how
to read the archived polls) and 7. Still for the owner: the secret `COLLECT_DISPATCH_TOKEN` in the data repo (DC-021,
DC-023). The `collector-health` issue closes itself on Nov 8.

### DC-023 Checkup 2026-11-06: a 2-hour gap on Nov 5 (GitHub API errors) and the anomalies of Nov 2 to 5 (fixed / open)
Owner (2026-11-06): "Check the data collection status and create a log on any anomalies." Times are Chicago (CST since
Nov 1). Compared with the week before (Oct 26 to 30). Scripts and downloads stayed off the repo (job folder).

**1. Collection gap, Thu Nov 5, 10:39 AM to 12:39 PM (fixed).**
- What: no collect run was active for 2 hours during weekday service (12 buses were live at 12:12 PM). The health
  issue's data check flagged it at 1:50 PM ("No arrival on any route 10:40 AM to 12:40 PM ..."); `monitor.py status`
  shows it as the coverage gap (92%, DEGRADED).
- Cause: run 42055348229 (9:28 to 10:39 AM) tried to start its successor at 10:09 AM; GitHub's workflow-dispatch API
  answered HTTP 502, 500, 500 at 10:09:03, 10:09:56 and 10:10:53, and the chain gave up after its 3 tries
  (`chain done:error: dispatch failed (3/3)`). The `:07` / `:37` cron backstop fired no scheduled run at all from
  5:26 AM to 12:39 PM (GitHub dropped seven hours of them), so nothing restarted the chain until the 12:39 PM
  backstop run (42086383740). The data repo's sync chain failed its single dispatch at 10:15 AM the same way (item 3).
- Impact: lost, not recoverable (no local collector ran): about 310 arrivals (the same window had 282 to 339 on the 8
  weekdays before; 53rd Street Express ~61, Apostolic/Drexel ~80, Downtown Campus Connector ~65, Friend Center/Metra
  ~45, Red Line/Arts Block ~60), about 1,500 prediction rows, ~20 bus count changes, and 2 hours of raw polls and
  prediction updates (the Nov 5 eta table has no rows 10:40 AM to 12:40 PM). Nov 5 totals 3,656 arrivals.
- Fix (`91954826`): a failed dispatch is now tried up to 10 times, 1, 2, 4, then 5 min apart (the last try 77 min into
  a collect run, inside its 85-min deadline), reading the run list again before every try so a run GitHub created
  despite the error is never doubled; idle runs the same. Tests `a_few_minutes_of_github_errors_do_not_stop_the_chain`,
  `sleeper_retries_a_failed_dispatch_with_backoff` (both fail on the old code). An outage of the dispatch API longer
  than about 37 min would still stop the chain; the outside watchdog (item 3) is the net for that, and with the
  owner's `COLLECT_DISPATCH_TOKEN` secret in the data repo it would restart the collector by itself.

**2. `monitor.py status` could not read the data CSV (fixed).**
- What: this checkup's `status` printed `arrivals.csv 0.00 MB, 0 rows` and no newest arrival. GitHub's raw file CDN now
  answers a suffix byte range (`Range: bytes=-65536`, the last 64 KB) with `501 Unsupported client range`; explicit
  ranges (`bytes=N-M`) still work. The 2026-11-04 checkup still read it, so the change came between Nov 4 and 6.
- Impact: none on the data; `status`'s rule "buses are running but no new arrivals merged for 3 h" was silently off,
  and the line looked like an empty data branch. Nothing else reads files that way (the health checks and the
  watchdog read a git checkout).
- Fix (`948734a1`): `fetch_tail` asks for byte 0 (the size comes back in Content-Range), then for the last 64 KB; a read
  error is printed as one instead of zero rows. Test `test_tail_of_the_data_csv_uses_explicit_byte_ranges` (a fake CDN
  that rejects suffix ranges, and a server without range support). Now: `arrivals.csv 19.23 MB, ~93,700 rows`.

**3. The data repo's sync chain and its watchdog stopped in the same window (fixed).**
- What: sync run 42058905057 tried to start the next sync at 10:15 AM Nov 5; its one `gh workflow run` got HTTP 500,
  and no sync ran from 10:15 AM until its cron backstop fired at 12:11 PM. The watchdog lives in that chain, so it
  first saw the collector gap at 12:12 PM ("12 bus(es) are running but no collect run is active and the newest arrival
  is 94 min old"), about 1 h 30 min late, and closed its issue at 1:03 PM.
- Impact: the public data repo was 2 hours stale; the outside net for the collector was down while it was needed.
- Fix (data repo `1ff8349`): the sync chain tries the dispatch up to 6 times, 1, 2, 4, 5 and 5 min apart, with its
  waiting-run check before every try; the job limit went from 45 to 60 min. Checked with a stand-in `gh` failing 0, 3
  and 9 times. Still open for the owner: the watchdog can only report, not restart, until the repository secret
  `COLLECT_DISPATCH_TOKEN` is set in the data repo (DC-021).

**4. Buses whose two Passio feeds disagreed for hours, Nov 4 and 5 (watch: Passio's side).**
- What: `gps` rows (stops found from the GPS track because Passio named none, DC-003) rose to 611 on Wed Nov 4 and 552 on
  Thu Nov 5 (Nov 2 / 3: 241 / 417; the week before 277 to 398), and Passio's prediction share of the other arrivals fell
  to 81% / 82% (Nov 2 / 3: 85%). Three buses explain most of it, each in a different way:
  - **4319, Wed Nov 4, 12:45 to 8:45 PM:** in the vehicle feed its trip and stop froze (Friend Center/Metra trip 499505
    with stop Goldblatt Pavilion all afternoon, then Apostolic/Drexel trip 676394 from 6:15 PM) while Passio's trip
    updates moved on through the timetable's trips (499506 ... 499521, 676395 ... 676405). Friend Center/Metra 23% and
    Apostolic/Drexel 28% `gps` rows that day (normally 0 to 7% and 0 to 2%).
  - **4317, Thu Nov 5, 1:45 to after 8:45 PM:** on Red Line/Arts Block with trip id 672392, which is not in the
    timetable, no stop in any report and not one prediction update all afternoon: all 146 of its arrivals are `gps` rows
    (Red Line/Arts Block 45% that day). Earlier (12:30 to 1:15 PM, on Apostolic/Drexel) its feed trip 675899 and its
    predictions' trip 501459 already differed.
  - **4326, Thu Nov 5, 4 to 9 PM (South):** the vehicle feed advanced through the evening's trips (501625 ... 501643)
    but Passio's predictions stayed on its first two trips (501621, 501625) all evening; 80 of its 126 arrivals are `gps`
    rows (South 43%, normally 1 to 6%).
- Impact: the arrivals themselves were logged through the GPS sweep (4319: 69 + 84 rows, 4317: 146, 4326: 80; daily
  totals of those lines stayed in their usual range), but they carry no Passio prediction, so they drop out of the
  scoring sample; for riders, those buses were on the map with no or stale arrival times (4317 for 7 hours). Nothing in
  the collector to fix; the week before had similar single-bus episodes (South's 4314 / 4320 in the DC-022 watch note),
  so this is Passio's normal noise, larger on these two days.
- Follow-up: recheck the `gps` share at the next checkup; if one bus keeps this up for days, tell the owner (it is the
  case where the app should say "no live times for this bus" rather than show a stale one).

**5. Buses parked at Regenstein Library around 11:50 (owner's report, 2026-11-06; facts from the raw polls).**
The owner saw buses that were not operating, all in front of Regenstein Library, drawn on the map as moving buses, at
about 11:50. What the feed held (positions every 10 s; the owner's point 41.7924, -87.5999):
- **11:50 AM Thu Nov 5: no record.** It falls in the collection gap (item 1). In the polls just before (9:30 to 10:39
  AM) and after (12:39 to 2 PM), and at 11 AM to 1 PM on Nov 2, 3 and 4, no bus stood within 300 m of that point for 4
  minutes or more (the morning lines' buses that lingered after their routes ended stood at Rockefeller Chapel and
  Goldblatt Pavilion, 600 m away).
- **11:50 PM Thu Nov 5: yes, three NightRide buses.** North **4328**, Central **4313** and East **4325** stood still
  together at the **Reynolds Club** stop (57th St and University Ave; their shared terminal, 11 to 61 m from the stop,
  about 200 m from the owner's point and 150 m from the Regenstein Library (N) stop): 4328 from 11:48 to 11:57 PM,
  4313 from 11:51 to 11:57, 4325 from 11:53 to 11:58, so all three from 11:53 to 11:57. Speed 0 to 0.2 m/s (or blank),
  but their reports stayed fresh (2 to 14 s old) and the GPS position moved up to 5 m from poll to poll (4328 within 16
  m of one spot), which an animated map turns into small moves. South **4538** did the same at its own terminal
  (Burton-Judson Courts, 11:46 to 11:57 PM), Apostolic/Drexel **4318** and **12645** at Goldblatt Pavilion.
- Were they operating? The operator's alert that evening said "All evening NightRide routes will be running every 30
  minutes for the entire evening" (4:10 PM to 00:00:34), so the NightRide buses sat 5 to 13 min at Reynolds Club every
  30 min all evening (North 9.0 / 10.4 / 9.2 / 13.0 / 8.7 min at 9:48, 10:16, 10:46, 11:15, 11:48 PM; East and Central
  alike). The listed hours (Thursday timetable): North and East 4:00 PM to 4:29 AM, South to 4:25 AM, Central to
  **11:14 PM**, Apostolic/Drexel to 12:55 AM. So at 11:50 PM North and East were in a scheduled layover, but **Central
  4313 was 36 min past its last listed trip** (501746, 11:00 to 11:14 PM), still carrying that trip; Passio sent no
  prediction for it from 11:51 to 11:57.
- Trip updates: North and East had been given their next timetable trips, both listed 12:00 to 12:29 AM (North 501612,
  East 501707; South 501653, 12:00 to 12:25 AM), and Passio kept predicting them: 212 updates for 4328 and 216 for 4325
  while they stood there; the last ones were made at 11:58 to 11:59 PM for Reynolds Club at 12:16 and 12:22 AM.
- None of those midnight trips ran. Between 11:58 PM and 12:03 AM 4313, 4325, 4328, 4538 and 4318 left campus westbound
  on Garfield Blvd at 10 to 15 m/s with their trips still attached (12645 left the feed at Goldblatt at 12:00:50 AM),
  Passio still showing predictions for them until 12:04 to 12:05 AM, and they dropped out of the feed one after another
  between 12:04:56 and 12:05:46 AM, about 2 km west of campus near Garfield and Wabash.
  The feed stayed empty until collection stopped (12:37 AM), although North, East and South are listed until 4:25 to
  4:29 AM (the known empty overnight feed, ARCHITECTURE "2026-10-10").
- Every night this week: Nov 2 (4317 North, 4325 Central at Reynolds Club / Regenstein Library 11:45 to 11:54 PM),
  Nov 3 (4319 South, 4324 East, 4538 Central, 11:46 PM to midnight), Nov 4 (4327 Central at Ellis Ave & 57th St 11:52 to
  11:58 PM; then 4322 East and 4327 Central stood at 41.8237, -87.6506, near the operator's garage, from 12:15 to 12:33
  AM with fresh reports and Passio still sending predictions for their trips, 194 and 223 updates). A Central bus stayed
  in the feed 36 to 72 min past 11:29 PM (15 min after its last listed trip) every night from Nov 2 to 5.
- Not this checkup's job: the end-of-service analysis (where buses linger before they leave service) and the app
  change are a separate workstream started 2026-11-06 (idle buses); the off-route rule (E27, `core/offroute.js`) does
  not hide these buses because they stand on their own line.
- Follow-up done 2026-11-06 (RouteKnower E28): labeled end-of-trip / end-of-shift episodes in
  `data/labeled/end_of_service/` (one CSV per service day, linger spots, summary by line); the app now hides idle buses
  that are not in service (`core/idle.js` = Kit `Idle.swift`, docs/ARCHITECTURE.md "Idle buses that are not in
  service"): on the Nov 5 polls North 4328 hidden from 11:50 PM, South 4538 11:49, Central 4313 11:54, Apostolic/Drexel
  4318 / 12645 11:53 / 11:58; East 4325 stays (its last bus logs the first stops of the midnight trip). Most affected
  lines: `docs/LINES-MOST-AFFECTED.md`.

**6. The GPS sweep still misses some stops of buses with sparse reports (open, small; detector).**
- Found while checking per-line hours against the week before: Red Line/Arts Block logged 6 and 8 arrivals at 2 and 3 PM
  on Mon Nov 2 (30 and 28 the Monday before) although bus 4322 drove its loop all afternoon. 4322 was on Passio's
  unlisted Red Line trip 672392 (item 4's pattern: no stop, no prediction), so only the GPS sweep could log it, and it
  logged about every other lap: 6 of 17 stops it passed at 2 PM, 4 of 13 at 3 PM.
- Cause, from an instrumented replay of that day (the live rows and a one-pass replay agree, so it is not a run edge):
  (a) Passio sent this bus's position only every 70 to 350 s at times, and the sweep skips any stretch between two
  reports more than `MAX_GAP` (60 s) apart, so the first half of a lap (Institute for the Study of Ancient Cultures,
  Ellis/57th, Smart Museum, Garfield Green Line) went unseen; (b) the second half was then refused by `_fits_rules`:
  its stops were more than half the loop ahead of the bus's last row, which was still inside `MAX_LINK_S` (25 min)
  because a Red Line loop takes about 24 min. Day totals of dropped sweep visits are small (Nov 2: Red Line 13 not
  confirmed + 21 out of order, every other line 0 to 7; Nov 5: 0 to 7 per line), but report gaps over 60 s on moving
  buses are common on the long lines (Nov 2: Downtown Campus Connector 124, Red Line 61, Midway Metra 21).
- Impact: a rough check (a fresh report within 30 m of a stop of the bus's own route, against any row of that bus at that
  stop within 4 min) finds 87 to 100% of stop passes logged per line and day on Nov 2 to 5; the lowest are Red
  Line/Arts Block 87% on Nov 2 (98 to 99% on Nov 3 and 4), South 87 to 91%, Downtown Campus Connector 88 to 93%; by trip,
  Red Line 672392 329 of 407 and the Downtown Campus Connector's frequency trip 874028 1,578 of 1,732. This is the
  residual of DC-003 (91 to 95% after the sweep), not new.
- Follow-up (owner's call, not changed today): a detector change validated by replays, e.g. let the sweep cross a report
  gap of up to about 3 min when both ends lie on the route's line, and ignore a previous-lap row in `_fits_rules` when
  the bus's own GPS visits confirm the new order; then replay a week and count added rows against the raw tracks.
  Rows of past days would change only with the owner's go-ahead (`tools/apply_replay.py`).

**7. Buses reporting on a route outside its listed hours, Nov 2 to 5 (facts; for the idle-buses workstream).**
From every position poll the collector kept (48,242 polls, Nov 2 3:28 AM to Nov 6 12:37 AM; the Nov 5 gap excluded),
a bus counts when its route label is outside the route's listed hours by more than 30 min before the first trip or
15 min after the last (night trips after midnight count for the day before):
- **Central, every night:** one bus 36 to 72 min past 11:29 PM, and it drove one more full loop each night (8 to 14
  arrivals logged 11:30 to 11:51 PM, mostly `gps` rows: the timetable's last Central trip is 11:00 to 11:14 PM), then
  stood at Reynolds Club until midnight (item 5).
- **The morning lines after they end** (Drexel 10:15 AM, Apostolic 10:25 AM): buses kept those labels for 4 to 312
  min. Longest: Tue Nov 3 bus 4328 on Drexel trip 676422 from 10:31 AM to 3:42 PM, frozen on Wyler Pavilion, no
  prediction, driving the hospital loop (Drexel Garage, Goldblatt, Wyler, Bernard Mitchell, 58th & Drexel, Comer)
  about ten times: 58 arrivals logged as Drexel after hours; at 3:45 PM it became Apostolic/Drexel. Same day 4322 (218
  min) and 4317 (92 min) on Apostolic, with 0 and 1 arrivals logged; Mon Nov 2 4313 on Drexel 118 min (11:53 AM to
  1:50 PM, 2 arrivals).
- **Midway Metra after 7:10 PM** (listed to 6:55 PM): 12 to 36 min every evening, 0 to 4 arrivals logged; and 4538
  for 18 min in its midday break (1:17 PM Tue).
- **Single evenings:** Red Line/Arts Block bus 12648 112 min after 9:30 PM on Mon Nov 2 (listed to 9:15 PM), Regents
  Express 12646 43 min to 9:58 PM on Wed (listed to 9 PM), 53rd Street Express 4326 13 min on Wed.
- **Before service:** buses leaving the garage at 4:17 to 6:41 AM with yesterday's or a later route's label (Mon Nov 2
  South Loop Shuttle 4538, a line with no listed service, 64 min from 4:18 AM; NightRide labels 4:41 to 5:33 AM on Thu).
- The evening NightRide ran every 30 minutes all week by the operator's alerts (Nov 2, 3, 5: all NightRide routes,
  4 PM to 00:00:34; Nov 4: North and East, and Central until 6:45 PM), which explains the lower Central and North
  counts in those evenings; in every alert the evening ends at 00:00:34, when the buses leave (item 5).

**8. Everything else checked: normal.**
- Feed: no duplicate vehicle entry in any poll, no two buses at identical coordinates, no report older than 5 min while
  its bus stayed in the feed, every route id in the timetable.
- Runs since Nov 2 (131): all succeeded; 125 logger runs with 0 processing errors, at most 2 of 840 feed reads failed in
  a run, 0 alert polls failed; the 9 runs with under 30 rows all started between 11:59 PM and 1:18 AM or at 3:28 to
  4:15 AM, none while buses were in service. One more dispatch error: an idle run's start of the 4:15 AM collect run
  got HTTP 500 on Wed Nov 4 and went through on its second try two minutes later (the old 3-try limit held that time).
- Data: 0 duplicates, 0 rows missing ids, 13 lines and 92 stations each weekday; per line and hour against the week
  before, the hours under half are the Nov 5 gap, the 30-minute NightRide evenings, single buses that drove away from
  their route (Mon Nov 2 South 10 to 11 PM: its bus 12644 was 4.7 km from the route; Regents Express 9 arrivals that
  day), and item 6; in the other hours checked the stops the buses' tracks passed match the rows logged.
- Bus count changes: 40 to 53 adds and 33 to 50 lasting drops a weekday (Nov 2 to 5), in line with the first week
  (DC-020). Alerts: 6 new versions (the NightRide notices, "Central Night Ride route modified", "Goldblatt Pavilion
  boarding" Nov 5 6:55 AM to 2:15 PM). Timetable 708be9d370e2 unchanged since Nov 1 (the live site rebuilt it Nov 5 1:16 PM).
- Archive: every file for Nov 1 to 4; Nov 5 archived at 3:58 AM Nov 6 by hand (101,849 prediction updates, 76,339
  position reports, 207,478 forecast rows) since the scheduled run fires 6 to 10 h late. Weather context daily. Collector
  tests green on both fix pushes.

**Status.** Fixed: items 1 to 3 (`91954826`, `948734a1`, data repo `1ff8349`). Watch: item 4 (Passio's side; recheck the
`gps` share next time). Open, the owner's call: item 6 (a detector change validated by replays). Facts handed to the
idle-buses workstream: items 5 and 7. For the owner: the repository secret `COLLECT_DISPATCH_TOKEN` in the data repo
would let the watchdog restart the collector by itself (it only reported on Nov 5); nothing lost on Nov 5 can be
recovered. The `collector-health` issue stays open for the Nov 5 gap until about Nov 8 and then closes itself.

### DC-022 Two false alarms on the health alerts' first day (fixed 2026-11-02)
- Found in the 2026-11-02 checkup; both issues had opened and closed by themselves.
- **Data repo watchdog, Sun Nov 1 4:00 to 4:51 PM ("stale"):** the rule "buses running and a collect run active, but no
  arrival merged for 3 h" fires at every service start after a quiet period: Sunday's buses start at 4 PM and the
  newest arrival was from Saturday night, while the first run of the day had not merged yet. Fixed: the rule is gone;
  the watchdog keeps only "buses running but no collect run active and nothing merged for 45 min" (the case only an
  outside observer can see); a run that logs or pushes nothing is reported by the run itself.
- **Main repo, Mon Nov 2 1:23 AM ("buses in the feed for 200 polls but the run logged no arrival", run 41398521566):**
  three buses (4313 North, 4325 Central, 4327 East) stayed in the feed on trips with fresh reports from 00:13 to 00:37
  after the last arrival at 00:06, crawling toward the garage, 3 km from the nearest stop: logging nothing was right.
  The logger counted any poll with a fresh bus. Fixed: `truth_logger.in_service` counts only fresh reports within
  600 m of a stop of their own route (summary `live`, status `bus_polls`); replaying that run's raw polls, 147 polls
  had a fresh bus and 0 a bus in service. Test `only_buses_near_their_own_route_count_as_in_service`; the pre-flight
  self-test caught a stand-in tracker without static data in test_bus_changes before the push (poll() now skips the
  count there).
- Impact: none on the data; two notifications that were not needed. Status: fixed.

### DC-021 Risk review of the collection method: silent failures, one-push breakage, one provider (fixed / mitigated 2026-11-01)
Owner: "Find the greatest constraints and risks in the data collection method and modify the data collection method to
mitigate them." Ranked by how likely each is and how much of the record it would cost:
1. **Silent failure (the biggest).** Every collect run stays green on purpose (rows found so far are always merged),
   and nothing told anyone: problems surfaced only when someone ran monitoring.md. Found while checking it: **Oct 28,
   7:31 to 8:11 PM Chicago, every feed read of both overlapping runs timed out** (runs 40790709084 and 40795139797:
   `TimeoutError: The read operation timed out` from 00:31Z; 320 of 758 reads failed in the first), so no arrival was
   logged for 39 min during service (4 against 145 to 179 in that window on the other weekdays: about 160 lost, no raw
   polls either), and both runs ended green with a warning nobody read; the Oct 28 checkup was before it. Most likely
   Passio's side (two runners, both alerts and vehicles). Not recoverable.
   Fix: `tools/health.py` keeps one GitHub issue (label `collector-health`) in step with automatic checks of the code,
   each run (no status, no polls, the feed unreadable for 15 min or more, the feed in an unexpected shape, buses but no
   rows, a blocked or failed push), the data after each merge (gaps in normally busy hours, thin days, a missing route,
   duplicates, missing ids, missing predictions; paused in breaks and on holidays) and the archive; it opens or
   reopens the issue for a new problem, edits it quietly while problems last and closes it when all is clear. The
   logger's status now reports `bus_polls`, `max_fail_s`, `fail_spans`, `schema_errors`. Replay of Oct 12 to 31: the data
   checks raise exactly one problem, this outage. From outside, the data repo's sync chain runs `health.py watchdog`
   (buses running but no collect run active; a 3-hour "nothing merged" rule was dropped on 2026-11-02, DC-022), which still works if the collector's own chain and
   cron both stop; with a repository secret `COLLECT_DISPATCH_TOKEN` there it also restarts the collector (owner step).
2. **One bad push to main stops collection.** Every run runs main's `tools/` as they are when it starts; a syntax error
   or a broken rule would make every run log nothing while green, and main gets many pushes a week.
   Fix: every run (collect or idle) first runs `tools/collector_selftest.py` (imports, command lines, the offline suites
   of everything a run uses; about 15 s); if main fails, the run uses the code of the git tag `collector-ok`, which
   every healthy collect run on main's code moves to its commit, and the health issue says so.
   `.github/workflows/collector-tests.yml` runs the same tests and the workflow's own merge step against a throwaway
   remote (`tools/test_collect_yml.py`) on every push that touches the collector.
3. **One account, one provider.** The collector, the data branch, the 90-day artifacts and the archive all live on
   GitHub. GitHub's terms allow hosted runners only for activity related to the software project (this data builds the
   app's learned times, so it is, but it is a 24/7 poller), so a suspension, an account problem or a deleted repository
   would stop collection and lose everything at once.
   Mitigation: `tools/backup.py` copies the data branch's files and every release asset off GitHub (first copy on this
   PC: 113 files, 257 MB, `~/StraightBussing-backup`, verified); collection stays light (only while buses run, DC-014);
   `monitor.py local` is the collector that runs without GitHub Actions. Owner option: run `monitor.py local` on an
   always-on machine as a second, independent collector.
4. **A merge could silently lose rows.** Every run rewrites the shared CSVs and the next runs build on them.
   Fix: `tools/check_merge.py` stops the push if rows, alert versions, headers, columns, file ends or archive files would
   be lost or changed (collect.yml and `monitor.py local`); the run's files are kept as the artifact `unmerged-<run>`.
5. **Timetable drift.** `stop_index` depends on the GTFS a run built; nothing recorded which, and the archive stored the
   next morning's zip: `gtfs-2026-10-25.zip` holds Oct 26's stop lists (Apostolic 10 stops, 9 on Oct 25), so a replay
   or forecast table of Oct 25 built from it numbers stops differently from the logged rows.
   Fix: `tools/gtfs_versions.py`: each run records its timetable in `data/ground_truth/gtfs_versions.csv` and keeps the
   zip once per version (`gtfs/gtfs-<version>.zip`); `archive_day.py` archives each day with the version used that day.
   Past days are not rewritten: for day D before 2026-11-01 use the release's `gtfs-<D - 1>.zip` (docs/DATA.md).
6. **Archive window.** The archive caught up 10 days while the raw run artifacts live 90: a longer outage of the archive
   job would have let raw polls expire unarchived. Fix: it catches up 85 days, and the health check lists any finished
   day with missing files and how many days are left.
7. **A feed format change would read as "no buses".** The logger counted entities without the expected fields as
   nothing; the gate would then idle. Fix: `truth_logger.feed_shape` counts such feeds as `schema_errors` (status file,
   health alert); a long outage is now reported too (item 1).
8. **Accepted / watch.** Passio outages (nothing to collect; now reported, not fixable here); feed load (two overlapping
   runs read both feeds every 10 s for 30 of every 40 min; permission granted; kept for redundancy, DC-015); repository
   size (the data branch is about 127 MB on GitHub after 588 commits: years of room); artifact storage (6.7 GB of
   90-day artifacts; GitHub's billing page does not say whether that is free for public repositories; if a quota ever
   bites, uploads fail softly and the archive check reports the missing days).
- Impact: none on existing rows; from now on failures are reported within one run (about 40 min) or one merge, a
  broken push no longer stops collection, and a damaging merge cannot reach the data branch. Status: fixed /
  mitigated (commits 5cc3d2c..b9ab470, then 1ee2af0 and b3ffaf9 for what the first CI runs found).
- Verified live 2026-11-01: collector-tests.yml green (41293406117: self-test, the merge step against a throwaway
  remote, archive / replay / monitor / DST suites; its first run caught a missing PyYAML and a Linux-only zombie
  check in monitor.py, both fixed). A dispatched collect run (41293114859): pre-flight passed in 7 s, logged 30 min
  (no bus, idle stop), recorded timetable 708be9d370e2 (the Oct 26 timetable, feed dates to Dec 1) in
  gtfs_versions.csv with its zip, the guard found no rows lost, health run / data / archive all clear, and the tag
  collector-ok moved from f380dc7 to 1ee2af0. The archive run 41293211039 with the 85-day catch-up and recorded
  timetables succeeded, health clear. The issue path: issue #1 was opened and closed by health.py with a marked test
  problem (label created, comment, close). The data repo's sync run 41293548122 ran the watchdog: feed read, 0 buses,
  1 collecting run seen in the app repo, newest arrival 230 min old: all clear (correct at 4 AM on a Sunday).

### DC-020 Bus count changes (the 2 to 1 bus transitions) were not recorded (added 2026-10-30)
- Owner: "A large propagating timing error I noticed originates from when buses transition from 2 bus to 1 bus
  schedule. When collecting data, flag buses that are during a transition and mark the one that disappears."
- Added: `tools/bus_changes.py`, fed by every poll (`truth_logger.py --changes-out`, replay_day.py too), merged into
  `data/ground_truth/bus_changes.csv` by every collect run and `monitor.py local`. A drop = a bus silent on its route for
  10 min while another bus of the route still reports (timed to its last report); an add = a new bus on a running route
  for 5 min. Feed blips and a route that empties never count. Every merge classifies drops with arrivals.csv: `lasting`
  = 1 if the bus logs no arrival on the route for 30 min, 0 = a layover (`returned_min`, `moved_to_route`). The forecast
  table gains `bus_change_min` / `leaving_bus` (lasting drops); the archive gains `bus-changes-<day>.csv.gz`.
- Why the classification: between trips Passio leaves a bus out of the feed for 10 to 27 min (bus 4322 on Oct 27:
  21 min without a single sighting at Apostolic Lot, back on its next trip), so a 10-min rule alone also finds every
  layover. Returns cluster at 10 to 27 min (layover) and 40 min or more (break, end of peak, moved).
- Week replayed from the raw polls (Oct 20 to 23, 26 to 28; not written to the data branch): 337 drops, 267 lasting
  (91 from 2 to 1; 24 where the timetable itself loses a bus within 30 min), 70 layovers, 49 lasting drops moved to
  another route. Passio 10 to 30 min ahead (one sample per arrival, nearest 15 min), near a lasting drop vs the same
  route's baseline: 2 to 1, staying bus: within 10% 15.5% vs 13.0%, median |err| 5.7 vs 5.4 min, gross 15.1% vs 14.5%;
  2 to 1, leaving bus: 18.2% vs 15.3%, 4.4 vs 4.8 min, gross 7.0% vs 16.1%. By route the staying bus is clearly worse on
  the interlined lines: Apostolic/Drexel 5% vs 14% within 10%, |err| 9.5 vs 6.2 min, gross 48% vs 28%; Apostolic |err|
  14.6 vs 4.4 min (n = 22); Drexel 5.7 vs 2.5 min; not on 53rd Street Express, Midway Metra, Red Line, Central, South.
- Impact: from now on every change is recorded live; past days are not backfilled on the data branch (the archive
  rebuilds `bus-changes-<day>` for each day it archives). Status: added.
- Follow-up 2026-11-06 (RouteKnower E29): every change of Oct 10 to Nov 5 rebuilt from the raw polls and labeled with
  what the bus did (break, shift end, another route, off the map, layover; joins from the garage, a break, another
  route), where it left or joined and where it went, in `data/labeled/transitions/` (main; the data branch is not
  touched). The forecast table gains the transition columns (`transition_min` ... `gone_rule`, docs/DATA.md); the app
  drops the times of a bus gone from the feed for 15 min (`core/transition.js`). The replay agrees with this file on 411
  of 425 events of Oct 30 to Nov 5.

### DC-019 Bug check 2026-10-29: loop-end predictions (DC-017), replay determinism, daylight saving (fixed)
- Loop-end predictions dropped (DC-017's main case): `arrival_detector._candidates` (and `build_eta_dataset.shown`)
  wanted Passio's stop_sequence to equal our index + 1 at a loop's end visit; our merged route order includes stops a
  trip skips (Midway Metra: end at index 15, Passio sequence 15). The end visit now takes the highest sequence Passio
  gives that stop on the trip. Replays against the same code before the fix: Oct 21 +66 prediction rows (11 arrivals),
  Oct 27 +74 (11), 0 removed, no other arrival field changed; added rows median error -86 s / -158 s, 86 to 89% within
  10 min (real predictions for that visit, not another lap). Oct 27's forecast table: 286 of 223,800 rows from "none"
  to "shown", all at that stop.
- Replays were not deterministic: the GPS sweep took the first of a set of (route, index) candidates, so a loop
  terminal's index depended on Python's string hash seed (Apostolic Kenwood & 63rd index 10 one run, 0 the next; the
  live collector too). Now in route order; replays byte-identical across seeds.
- Daylight saving (clocks fall back Sun Nov 1 2026): `raw_fetch.service_day` filed 3 to 4 AM CST polls of Nov 1 under
  Nov 1 (wall clock minus 4 h now, as every other tool); `context_fetch.parse_regions` put local 2 to 6 AM an hour
  early on change days (`chicago_epoch()`; the dataset ended April 2026, so only stored 2022 to 2026 rows were off, 5
  hours per change day); `service_gate`'s fallback clock (used only without zoneinfo, not in CI) read the repeated
  hour as 02:xx. `tools/test_dst.py` pins Nov 1 2026 and Mar 14 2027 across the tools.
- Right after `arrivals.csv` rotates (40 MB), the next runs seeded with no recent visits: collect.yml and
  `monitor.refresh_seed` now seed from the newest archive file. (`predictions.csv`, 38 MB, rotates within days; its
  rotation and the merge after it were simulated and work.)
- Impact: about 11 arrivals and 70 prediction rows a day recovered from now on; past days can be backfilled with
  `tools/replay_day.py` + `tools/apply_replay.py` (owner's go-ahead). Status: fixed (commits b99b1b8, 86c08c9, 635b949).
- Left: the loop-end INDEX choice (`[i for i in idxs if i + 1 in seqs]`): a fix would rewrite 27 (Oct 21) and 13
  (Oct 27) existing arrival rows, so it waits for review; DC-017's index-0 cases.

### DC-018 The daily archive failed for Oct 26: a new timetable added stops (fixed)
- Found 2026-10-27: the archive run of 2026-10-27 stopped on Oct 26 with `IndexError('list index out of range')`
  (`arrivals_lib.dist_between`, called by `build_eta_dataset.build`). Passio published a new GTFS on Oct 26 (feed
  dates 2026-10-26 to 11-26) that adds stops to Apostolic (10 -> 11) and Apostolic/Drexel (11 -> 13). The collector and
  the Pages deploy rebuild the stop lists from the live GTFS on every run, so Oct 26 arrivals carry stop indexes 10 and
  12; `archive.yml` built the forecast table from the committed `web/data`, which still has the old lists.
- Impact: none on arrivals.csv, predictions.csv or alerts.csv (collected as usual), none for riders (the live site
  serves the new stops). The Oct 26 archive files and its summary row were delayed by a day.
- Fixed: `archive.yml` rebuilds `web/data` from the GTFS zip it downloads (as `collect.yml` and `pages.yml` do), and
  `dist_between` answers "unknown" for an index from another timetable version instead of crashing (one bad day must
  never block the others). Checked locally: Oct 26 builds (221,186 table rows); `test_eta.py` 19/19, `test_truth.py`
  54/54. Status: fixed; archive rerun dispatched.

### DC-017 About 40 arrivals a day get no prediction row although Passio showed one for the same trip (fixed in part 2026-10-29, DC-019)
- Found 2026-10-22 comparing Oct 20 / 21 with the raw `pred-updates` archive: 42 (Oct 20) and 39 (Oct 21) non-`gps`
  arrivals (1.2% / 1.1%) have no predictions.csv row and no `passio_pred_*`, yet Passio published a prediction for the
  same bus, stop and trip id 5 to 15 min before, within 5 min of the real arrival.
- Where (Oct 21): 11 at Midway Metra 57th St. & Metra (SB) (stop index 15, Passio stop_sequence 15), 3 at Downtown
  Campus Connector Rockefeller Chapel (index 0, sequence 15), 3 at Red Line Logan Center (index 0, sequence 12), the
  rest 1 or 2 per stop on every line.
- Suspected cause, not confirmed: the loop-stop rule in `arrival_detector._candidates` keeps only a stop_sequence equal
  to index + 1, and these are loop ends where Passio numbers the visit differently; the previous-visit rule (DC-011)
  may take some too.
- Impact: Passio's scores skip these arrivals (about 1%). Repairable: after a fix, replay the days from the raw
  archive (`tools/replay_day.py`, 90 days; applying needs the owner's go-ahead).
- Cause confirmed and fixed for the main case on 2026-10-29 (DC-019): at a loop's end visit our merged route order holds a
  stop the trip skips, so Midway Metra's end is index 15 while Passio numbers it 15, never 16. Left open: visits at
  index 0 whose Passio sequence is the trip's last stop (Downtown Campus Connector Rockefeller Chapel, Red Line Logan
  Center), which are start-or-end ambiguous and need a decision. Status: fixed in part; past days not backfilled.

### DC-016 Central had no Passio predictions on the evening of Oct 20 (accepted: Passio's side)
- Found 2026-10-22: Central's 181 arrivals on Oct 20 (bus 4320, 4 to 11:59 PM) have no prediction row at any lead.
  The raw archive has 3 updates for that bus between 4 PM and midnight; earlier that day it drove Apostolic and the
  Downtown Campus Connector with predictions as usual (3,216). Passio published no times for Central that evening,
  so riders saw none either. Every other line and day since Oct 13 has a row for at least 25% of its arrivals.
- Impact: none on the record (the arrivals are logged; there was nothing to collect). Status: accepted.

### DC-015 Some machines get empty vehicle lists from Passio most of the time (watch; the gate no longer depends on them)
- Found 2026-10-18 while checking why about 1 in 3 polls had no vehicles: on 2026-10-14 16:00 to 16:06 the two
  overlapping CI runs alternated, and one of them got an empty list on 4 of 5 polls while the other always had 11 to
  18 buses. The empty answers carry a fresh feed clock (not a cached copy), so Passio serves them to some clients.
- Impact: none on the data so far (the overlapping run logged the buses). Risk after DC-014: an idle run or a lone
  collect run on such a machine could think no bus runs.
- Fixed: `service_gate.probe` also reads the trip updates when a read has no position (Passio predicts only while
  buses run) and asks with a cache-buster like the app; the logger counts a predicted bus as live
  (`poll(..., pred_count)`, summary `pred=`); scheduled starts still start collecting regardless. Watch whether riders'
  phones see it too (the app would show "No shuttles are reporting live locations" for a poll); since fd369c3 the app
  holds ONE such empty answer (`data/live.js EMPTY_HOLD_S`) and the map keeps a missing bus 45 s while others report.
- Rechecked 2026-10-20 (Oct 19 polls): 27% of daytime polls empty, some runs 75 to 87% for an hour, yet every 30-s window
  from 5 AM to midnight had a full answer from some run, so no data was lost; this PC got 24 of 24 full answers. Status:
  watch (it only costs data if the one run collecting alone, about 10 min of every 40, is such a run).

### DC-014 The collector ran all day and night, even while no bus ran (fixed: only while buses run)
- Found 2026-10-18 (owner: "only run when the bus routes are active ... a buffer for time so that just in case the
  schedule is not exact"). Since DC-001 the chain logged every 10 s around the clock: on Sunday Oct 18 it had run all
  morning while the newest arrival was 10.4 h old; weekend mornings and weekday nights after about 00:40 hold no bus.
- Impact: no rows wrong or missing; wasted runs, feed reads (about 1,400 an hour), raw-poll artifacts and data commits.
- Fixed: `tools/service_gate.py` (collect while a bus reports or did in the last 30 min, or from 45 min before to
  30 min after a scheduled route start, or when the feed can't be read during scheduled service), the logger's
  `--stop-when-idle`, idle runs (`collect.yml` `mode: sleep`, `collect_chain.py sleep`: feed every 2 min with 3 reads,
  alerts every 10 min), `monitor.py` status (idle runs count as covered, `plan` line, new warning when buses report
  while only an idle run is active), the local fallback gated the same way (`--no-gate` = always). Also: a logger that
  ends early (a crash) now hands over at once instead of at minute 40. Tests: test_gate.py (10), test_chain.py (19,
  incl. a week-long simulation: 99.8% of bus time logged, worst gap 5.7 min while buses run). Replay of Oct 10 to 16:
  collects 130 of 168 h (buses 118 h), 1 bus-minute missed.
- Checked 2026-10-19 / 20: the handovers happened as planned (Sun 3:16 PM, Mon 4:16 AM, Tue 4:15 AM), no arrival fell in
  an idle window, and `status` counts idle runs as covered (a backstop run that idled read as a 60-min gap until
  `monitor.py auto_idle`, 2759b8b). Status: fixed.

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

### DC-003 Buses with a frozen or wrong Passio trip assignment (fixed in part 2026-10-17: frozen / lapped / lagging buses; wrong route open)
- Known since 2026-10-13 (RouteKnower E21). The rules follow Passio's "next stop" for each bus, so they miss the
  stops a bus drives past when that stop is wrong: (1) **frozen** (Passio names the same trip and stop for 15 min
  or more while the bus drives: 60 to 77 bus-hours a weekday Oct 12-15, mostly the Downtown Campus Connector and
  the Red Line), (2) **a jump over the end of a loop** (Passio names a stop of the next lap early; South on Oct 15),
  (3) Passio **behind the bus** or naming the passed stop without a time, (4) a bus **filed under another route**.
  Oct 15, the stop visits buses drove past on Passio's route: 3,768, 84.7% with a row; of the 578 missed, 223
  frozen, 174 loop jumps, 124 named but untimed, 41 behind, 16 named stop not on the route.
- Fixed (1 to 3): the **GPS sweep** in `tools/arrival_detector.py` (`Tracker._sweep`, live and in replay): per bus,
  every stop of its route whose 40 m circle the track enters moving the route's direction, in route order with
  the bus's previous GPS visit (or starting a chain that the next visit confirms), timed like the rules
  (`_approach`). It waits GPS_HOLD_S (10 min) and writes a row, `source = gps`, only if no rule logged that bus at
  that stop within 15 min (`SAME_VISIT_S`) and the visit fits the bus's rows before and after it (route order,
  speed under 30 m/s). trip_id is Passio's trip, blank when Passio had been frozen 15 min (its trip is stale);
  no Passio prediction is attached (none for the accuracy scores: the 10 minute shrink is unchanged by them), no
  previous-stop link, no dwell. It only adds rows: `seed()` keeps GPS rows out of the rules' state and a merge
  keeps any rule's row of the same visit over a GPS row (`merge_arrivals.rank`, also inside one run file).
- Replay with the fix (Oct 10-16, `tools/replay_day.py`): every existing arrival row and every predictions row
  identical on Oct 10-15 (Oct 16 against live: identical but the DC-011 change); added `gps` rows 91, 64, 293,
  282, 359, 374, 363 (1,826: Red Line 773, Central 324, Downtown Campus Connector 214, South 183, the rest under
  70 each). Share of the stop visits driven past with a row: Oct 12 87.3% -> 94.8%, Oct 13 88.0% -> 95.3%,
  Oct 14 86.1% -> 95.4%, Oct 15 84.7% -> 94.7%, weekend Oct 10 / 11 83.7% / 83.4% -> 92.5% / 91.4%; Red Line
  55-75% -> 96-97%, Downtown Campus Connector 82-92% -> 93-97%, South Oct 15 35.1% -> 85.9%.
- Precision: 196 sampled `gps` rows (40 a day, every route, Oct 10-15) checked against the raw polls (the bus
  entered the stop's circle moving the route's way within 90 s of the row; route order with the rows around it;
  speed): 191 pass; of the 5 flagged, 4 are real passes the check misread (two stops 1 s apart, a corner turn, a
  report at exactly 40.0 m, a window into the next lap) and 1 a real pass at an unusual point of the route
  (service unclear): about 99%.
- Still open (4): a bus Passio files under another route. Detection exists (`_wrong_route`: 5 visits over 10 min
  in exactly one other route's order, 3 at stops Passio's route lacks, Passio's route explaining at most one; two
  routes tying = a shared corridor, no change) but is **off** (`GPS_WRONG_ROUTE = False`): on Oct 15 it found 6
  episodes and Passio never named the suggested route for that bus, and a Downtown Campus Connector bus crossing
  campus fits another route's stops too. Those buses keep only the rows on Passio's route.
- Backfilled 2026-10-17: Oct 10-16 replayed with the sweep and applied (data `b487487`): +1,789 arrivals (`source =
  gps`: Oct 10 +85, 11 +64, 12 +281, 13 +263, 14 +359, 15 +374, 16 +363), 0 rows replaced, 0 duplicates; Oct 16
  also got its DC-008 / DC-011 prediction backfill (-58 / +50), Oct 12-13 lost 3 previous-lap rows. Forecast
  tables of Oct 10-16 rebuilt, re-uploaded and their summary rows replaced (`088b807`): arrivals to score +9%
  (18,152 -> 19,792 in each bin, Oct 12-16), Passio's scores unchanged within 0.1 point. One known difference: the
  forecast table's previous-lap rule (DC-011) now sees GPS visits as the bus's earlier visit, so about 0.5% of its
  Passio rows turn `previous_lap`, while predictions.csv's detector ignores GPS rows by design (they never change
  the other rules' rows). Oct 8-9 have no polls and stay as logged.

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

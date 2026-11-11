# E32 tables: what the shipped display rules showed riders around transitions

Replay: every archived service day 2026-10-10 to 2026-11-10 (32 days) rebuilt on the app's 10 s poll grid and run through the SHIPPED web code (data/live.js startLive, core/arrivals.js, core/planner.js) in headless Edge; judged against the collector's logged arrivals (data branch arrivals.csv). `new` = the shipped rules (off-route, idle, GONE, bus numbers with holds); `old` = the same polls without them (every operating bus and trip update, numbers in vehicle id order). "after" = the days since the rules shipped (2026-11-06 to 2026-11-10), "before" = the same code on the earlier days (what the rules would have done). Made by `experiments/routeknower/E32-scripts/` (inputs.py, replay.html / replay.py, measure.py, report.py, flags.py); definitions in measure.py's docstring. Unofficial analysis of the public Passio feed.

Golden check: measure.py's own reading of the shown times equals core/arrivals.js arrivalsFor at 182,623 samples (every stop, every 15 min): 0 mismatches; the rule-by-rule reason chain agrees with startLive on every poll (0 mismatches).

## 1. All lines: shipped rules (new) / without them (old)

| Measure | after: new / old | before: new / old |
|---|---:|---:|
| Service hours | 432.5 / 432.5 | 2630.2 / 2630.2 |
| Ghost times, % of bus-minutes with times shown 1 to 30 min ahead | 3.9 / 4.8 | 4.7 / 7.0 |
| Ghost next bus, % of stop-minutes whose first time is a ghost | 2.8 / 3.5 | 3.4 / 5.2 |
| Ghost badges, % of map-badge minutes | 1.9 / 3.3 | 2.4 / 4.8 |
| Leaves (last arrival before 30+ min without one) | 231 / 231 | 1,471 / 1,471 |
| Shown after a leave, average min | 11.8 / 16.7 | 12.0 / 20.0 |
| Leaves still shown 15+ min, % | 29.9 / 39.8 | 27.7 / 47.9 |
| Directions live bus legs on a bus that left first, % | 5.7 / 6.3 | 7.3 / 8.1 |
| ... top option only, % | 7.2 / 7.6 | 9.3 / 9.9 |
| Bus number swaps per 10 service hours | 14.7 / 12.53 | 16.83 / 12.0 |

## 2. Hidden by a rule while the bus was coming to serve (false hides, shipped rules)

A minute a rule kept a bus or its times off the screen and the bus then logged an arrival on its line within 15 min.

| Rule | after: false / hidden min (%) | before: false / hidden min (%) |
|---|---:|---:|
| core/offroute.js (off route) | 373 / 1,530 (24.4) | 2,907 / 15,215 (19.1) |
| core/idle.js (idle) | 77 / 208 (37.0) | 457 / 2,051 (22.3) |
| core/transition.js GONE | 75 / 758 (9.9) | 727 / 4,156 (17.5) |
| all rules | 525 / 2,496 (21.0) | 4,091 / 21,422 (19.1) |

## 3. Other counts (shipped rules)

| Count | after | before |
|---|---:|---:|
| Times back on screen after a hidden bus went silent (bus-minutes) | 174 | 1555 |
| ... per 10 service hours | 4.02 | 5.91 |
| Not judged: sparse reporters (minutes) | 781 | 3425 |
| Not judged: a ghost whose bus sent no report through the span (minutes) | 241 | 1933 |
| Not judged: a risky leg whose bus sent no report after it left | 458 | 1718 |
| Rolling candidate (not shipped): minutes it would pick | 1673 | 10628 |
| ... of them ghosts | 365 | 2635 |

Rolling candidate (a bus within 150 m of where it was 10 min ago whose time at its next stop slid 5+ min): precision 22% / recall 26% after, 25% / 24% before: not a hide rule.

## 4. Per line

before: 2026-10-10 to 2026-11-05 (27 days). new = shipped rules, old = before them.

| Line | service h | ghost times % new / old | ghost next bus % new / old | ghost badges % new / old | leaves | shown after leave, avg min new / old | false hides % (min) | risky plans % new / old (top) | number swaps per 10 h new / old |
|---|---|---|---|---|---|---|---|---|---|
| Downtown Campus Connector | 305.1 | 6.5 / 8.0 | 5.8 / 7.1 | 4.0 / 7.1 | 529 | 14.6 / 21.6 | 12.2 (867 of 7090) | 18.5 / 19.2 (22.2 / 22.6) | 119.18 / 79.55 |
| Friend Center/Metra | 281.8 | 2.0 / 3.2 | 1.3 / 2.0 | 0.4 / 1.2 | 47 | 7.4 / 13.2 | 41.0 (249 of 607) | 4.2 / 4.7 (3.6 / 3.6) | 0.0 / 0.0 |
| Red Line/Arts Block | 274.6 | 6.7 / 11.1 | 5.3 / 8.8 | 4.0 / 7.3 | 176 | 14.8 / 24.6 | 13.6 (344 of 2526) | 7.6 / 9.0 (8.4 / 9.4) | 7.28 / 3.53 |
| Apostolic/Drexel | 266.9 | 5.1 / 8.4 | 4.2 / 6.5 | 1.8 / 5.3 | 140 | 12.9 / 25.8 | 29.6 (1072 of 3617) | 6.3 / 7.2 (7.3 / 8.2) | 8.17 / 8.58 |
| 53rd Street Express | 214.3 | 2.9 / 3.6 | 1.9 / 2.3 | 1.2 / 2.5 | 54 | 11.0 / 17.9 | 20.2 (141 of 697) | 3.9 / 4.1 (3.8 / 4.0) | 0.0 / 0.0 |
| South | 213.4 | 7.2 / 12.3 | 5.2 / 9.0 | 3.8 / 7.9 | 73 | 14.0 / 27.5 | 11.4 (167 of 1463) | 11.1 / 12.6 (12.8 / 13.3) | 0.0 / 0.0 |
| North | 213.1 | 3.0 / 5.4 | 1.6 / 3.4 | 1.4 / 3.2 | 55 | 10.0 / 19.9 | 18.3 (171 of 933) | 5.0 / 5.3 (7.0 / 7.3) | 0.0 / 0.0 |
| East | 210.3 | 2.0 / 5.2 | 1.6 / 4.1 | 0.6 / 3.0 | 55 | 6.3 / 20.6 | 9.1 (128 of 1406) | 4.8 / 5.3 (6.5 / 6.9) | 0.24 / 0.38 |
| Central | 202.2 | 3.8 / 6.6 | 3.2 / 5.8 | 1.6 / 3.1 | 66 | 9.9 / 17.8 | 16.6 (148 of 891) | 6.1 / 7.5 (7.0 / 7.9) | 0.0 / 0.05 |
| Midway Metra | 154.2 | 5.2 / 6.1 | 4.8 / 5.2 | 1.2 / 2.5 | 105 | 8.7 / 12.6 | 14.4 (85 of 592) | 9.3 / 9.3 (8.5 / 8.6) | 0.06 / 0.13 |
| Apostolic | 98.4 | 2.4 / 3.5 | 1.7 / 2.6 | 0.8 / 1.6 | 81 | 6.7 / 11.3 | 52.8 (595 of 1127) | 3.8 / 4.9 (6.6 / 8.5) | 36.48 / 38.61 |
| Drexel | 96.8 | 1.9 / 2.9 | 1.8 / 3.0 | 0.1 / 0.6 | 44 | 5.0 / 9.1 | 10.3 (24 of 232) | 2.8 / 4.1 (1.6 / 2.3) | 0.83 / 1.14 |
| Regents Express | 54.3 | 2.8 / 3.2 | 2.4 / 2.7 | 0.7 / 1.2 | 31 | 5.4 / 6.1 | 52.2 (59 of 113) | 11.9 / 12.1 (11.5 / 11.5) | 0.0 / 0.0 |
| South Loop Shuttle | 44.9 | 1.8 / 2.2 | 1.7 / 1.8 | 1.1 / 1.4 | 15 | 8.3 / 12.3 | 32.0 (41 of 128) | 17.6 / 17.7 (18.7 / 18.7) | 0.0 / 0.0 |
| **all lines** | 2630.2 | 4.7 / 7.0 | 3.4 / 5.2 | 2.4 / 4.8 | 1471 | 12.0 / 20.0 | 19.1 (4091 of 21422) | 7.3 / 8.1 (9.3 / 9.9) | 16.83 / 12.0 |

after: 2026-11-06 to 2026-11-10 (5 days). new = shipped rules, old = before them.

| Line | service h | ghost times % new / old | ghost next bus % new / old | ghost badges % new / old | leaves | shown after leave, avg min new / old | false hides % (min) | risky plans % new / old (top) | number swaps per 10 h new / old |
|---|---|---|---|---|---|---|---|---|---|
| Downtown Campus Connector | 47.2 | 6.0 / 6.1 | 6.1 / 6.2 | 3.0 / 5.3 | 83 | 13.5 / 18.7 | 7.4 (75 of 1015) | 14.7 / 15.1 (20.0 / 20.1) | 120.42 / 104.76 |
| Red Line/Arts Block | 43.5 | 6.5 / 9.5 | 3.9 / 5.9 | 4.2 / 6.6 | 27 | 16.8 / 24.4 | 19.1 (63 of 329) | 6.7 / 7.9 (7.1 / 8.2) | 7.36 / 5.52 |
| Friend Center/Metra | 41.9 | 2.6 / 3.6 | 1.4 / 2.2 | 1.0 / 1.2 | 12 | 8.1 / 11.3 | 66.4 (95 of 143) | 7.5 / 8.4 (6.7 / 6.8) | 0.0 / 0.0 |
| North | 40.4 | 2.7 / 3.6 | 1.8 / 2.7 | 0.3 / 1.5 | 12 | 9.0 / 14.4 | 37.7 (43 of 114) | 2.6 / 2.9 (3.8 / 3.8) | 0.0 / 0.0 |
| Apostolic/Drexel | 39.9 | 3.4 / 4.5 | 4.2 / 4.6 | 1.3 / 2.7 | 16 | 14.6 / 22.5 | 45.6 (141 of 309) | 4.9 / 5.7 (4.8 / 5.4) | 3.01 / 2.25 |
| East | 38.1 | 1.1 / 1.7 | 0.7 / 1.2 | 0.0 / 0.1 | 12 | 4.5 / 7.2 | 6.2 (5 of 80) | 1.3 / 1.5 (1.9 / 1.9) | 0.0 / 0.0 |
| South | 37.5 | 2.6 / 3.5 | 2.6 / 3.0 | 0.5 / 0.6 | 12 | 8.8 / 11.7 | 38.5 (37 of 96) | 9.2 / 9.6 (10.4 / 10.6) | 0.0 / 0.0 |
| Central | 36.2 | 0.6 / 1.3 | 0.6 / 1.5 | 0.0 / 0.4 | 10 | 2.5 / 4.9 | 0.0 (0 of 51) | 1.7 / 2.6 (2.1 / 2.2) | 0.0 / 0.0 |
| 53rd Street Express | 35.3 | 4.6 / 4.9 | 2.9 / 3.1 | 1.7 / 1.8 | 8 | 16.1 / 19.5 | 16.0 (15 of 94) | 2.6 / 2.9 (2.7 / 2.7) | 0.57 / 0.57 |
| Midway Metra | 22.1 | 4.5 / 5.8 | 3.6 / 5.4 | 1.2 / 4.3 | 16 | 9.6 / 13.8 | 14.9 (17 of 114) | 8.3 / 8.6 (10.6 / 10.6) | 0.0 / 0.0 |
| Drexel | 15.6 | 5.9 / 6.0 | 7.6 / 7.7 | 3.0 / 3.3 | 7 | 18.9 / 19.9 | 50.0 (7 of 14) | 8.2 / 8.2 (4.5 / 4.5) | 0.0 / 0.0 |
| South Loop Shuttle | 12.5 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 2 | 0.0 / 3.5 | 0.0 (0 of 11) | 1.6 / 1.6 (3.0 / 3.0) | 0.0 / 0.0 |
| Apostolic | 12.3 | 3.3 / 4.3 | 2.3 / 4.2 | 0.7 / 2.5 | 11 | 9.6 / 16.7 | 18.3 (22 of 120) | 5.7 / 7.4 (9.2 / 11.8) | 17.1 / 9.77 |
| Regents Express | 10.2 | 0.2 / 0.2 | 0.0 / 0.0 | 0.2 / 0.3 | 3 | 0.0 / 0.0 | 83.3 (5 of 6) | 0.0 / 0.0 (0.0 / 0.0) | 0.0 / 0.0 |
| **all lines** | 432.5 | 3.9 / 4.8 | 2.8 / 3.5 | 1.9 / 3.3 | 231 | 11.8 / 16.7 | 21.0 (525 of 2496) | 5.7 / 6.3 (7.2 / 7.6) | 14.7 / 12.53 |

all: 2026-10-10 to 2026-11-10 (32 days). new = shipped rules, old = before them.

| Line | service h | ghost times % new / old | ghost next bus % new / old | ghost badges % new / old | leaves | shown after leave, avg min new / old | false hides % (min) | risky plans % new / old (top) | number swaps per 10 h new / old |
|---|---|---|---|---|---|---|---|---|---|
| Downtown Campus Connector | 352.3 | 6.5 / 7.9 | 5.8 / 6.9 | 3.9 / 6.9 | 612 | 14.4 / 21.2 | 11.6 (942 of 8105) | 17.8 / 18.5 (21.9 / 22.3) | 119.35 / 82.93 |
| Friend Center/Metra | 323.6 | 2.1 / 3.3 | 1.3 / 2.0 | 0.5 / 1.2 | 59 | 7.6 / 12.8 | 45.9 (344 of 750) | 4.6 / 5.2 (4.0 / 4.0) | 0.0 / 0.0 |
| Red Line/Arts Block | 318.0 | 6.6 / 10.9 | 5.1 / 8.4 | 4.1 / 7.2 | 203 | 15.1 / 24.5 | 14.3 (407 of 2855) | 7.5 / 8.9 (8.2 / 9.2) | 7.3 / 3.8 |
| Apostolic/Drexel | 306.8 | 4.8 / 7.9 | 4.2 / 6.2 | 1.7 / 5.0 | 156 | 13.1 / 25.5 | 30.9 (1213 of 3926) | 6.1 / 7.0 (7.0 / 7.8) | 7.5 / 7.76 |
| North | 253.5 | 3.0 / 5.1 | 1.6 / 3.3 | 1.2 / 2.9 | 67 | 9.8 / 18.9 | 20.4 (214 of 1047) | 4.6 / 4.9 (6.5 / 6.8) | 0.0 / 0.0 |
| South | 250.9 | 6.5 / 10.9 | 4.8 / 8.0 | 3.3 / 6.9 | 85 | 13.3 / 25.3 | 13.1 (204 of 1559) | 10.8 / 12.1 (12.4 / 12.9) | 0.0 / 0.0 |
| 53rd Street Express | 249.6 | 3.1 / 3.8 | 2.1 / 2.4 | 1.3 / 2.4 | 62 | 11.7 / 18.1 | 19.7 (156 of 791) | 3.7 / 4.0 (3.6 / 3.8) | 0.08 / 0.08 |
| East | 248.3 | 1.8 / 4.6 | 1.4 / 3.6 | 0.5 / 2.6 | 67 | 6.0 / 18.2 | 9.0 (133 of 1486) | 4.3 / 4.7 (5.7 / 6.1) | 0.2 / 0.32 |
| Central | 238.5 | 3.3 / 5.8 | 2.8 / 5.1 | 1.4 / 2.8 | 76 | 9.0 / 16.1 | 15.7 (148 of 942) | 5.4 / 6.7 (6.2 / 7.0) | 0.0 / 0.04 |
| Midway Metra | 176.3 | 5.1 / 6.1 | 4.6 / 5.2 | 1.2 / 2.8 | 121 | 8.8 / 12.8 | 14.4 (102 of 706) | 9.2 / 9.2 (8.8 / 8.8) | 0.06 / 0.11 |
| Drexel | 112.4 | 2.4 / 3.3 | 2.5 / 3.6 | 0.5 / 1.0 | 51 | 6.9 / 10.6 | 12.6 (31 of 246) | 3.4 / 4.5 (2.0 / 2.6) | 0.71 / 0.98 |
| Apostolic | 110.7 | 2.5 / 3.6 | 1.8 / 2.8 | 0.8 / 1.7 | 92 | 7.0 / 11.9 | 49.5 (617 of 1247) | 4.0 / 5.2 (6.9 / 8.9) | 34.33 / 35.41 |
| Regents Express | 64.5 | 2.4 / 2.7 | 2.0 / 2.3 | 0.6 / 1.1 | 34 | 4.9 / 5.5 | 53.8 (64 of 119) | 10.1 / 10.2 (9.9 / 9.9) | 0.0 / 0.0 |
| South Loop Shuttle | 57.4 | 1.4 / 1.7 | 1.3 / 1.4 | 0.9 / 1.1 | 17 | 7.3 / 11.2 | 29.5 (41 of 139) | 14.5 / 14.6 (15.5 / 15.5) | 0.0 / 0.0 |
| **all lines** | 3062.7 | 4.6 / 6.7 | 3.3 / 5.0 | 2.3 / 4.6 | 1702 | 11.9 / 19.5 | 19.3 (4616 of 23918) | 7.1 / 7.8 (9.0 / 9.6) | 16.53 / 12.07 |

## 5. Real episodes in the browser test (`web/tests/fixtures/display_episodes.json`, `web/tests/data-display.js`)

| Case | Kind | Day | Line | What riders see (shipped code) | Recommended fix (owner decision) |
|---|---|---|---|---|---|
| gone_shift_end | guard | 2026-11-09 | Central | Central 4319 stops reporting at 21:46 while Passio keeps predicting it until 22:16 (the times count down to Now and stay there): its badge goes 5 min after its last report (core/operating.js), its times 15 min after (core/transition.js GONE), so International House no longer shows it from about 22:01. |  |
| offroute_garage | guard | 2026-11-09 | Downtown Campus Connector | Downtown Campus Connector 4322 drives off the line after its last arrival (12:08): hidden with its times (core/offroute.js) and still tracked (store.away). |  |
| idle_parked | guard | 2026-11-06 | Red Line/Arts Block | Red Line/Arts Block 4315 parked after its last arrival (18:40): hidden as idle (core/idle.js IDLE: still 30 min, no Passio time 2 min ahead) from 19:17, shown again at 19:32 when Passio gives it a time ahead. |  |
| number_join | guard | 2026-11-06 | Downtown Campus Connector | A bus joining the Downtown Campus Connector renumbers the line in vehicle id order (core/busnum.js; every phone shows the same numbers). |  |
| offroute_then_silent | gap | 2026-11-06 | Apostolic/Drexel | AP/DX 4317 ends its shift (last arrival 18:13), drives off the line and is hidden with its times at 18:21 (core/offroute.js); its last report is at 18:43, at 18:48 it leaves the operating list (5 min) and its Passio times come back on screen until GONE drops them at 18:58 (15 min). | keep dropping the times of a bus core/offroute.js or core/idle.js hid until it reports again (data/live.js), or let GONE start from the hide; an owner decision since it changes what riders see. |
| gone_comeback | gap | 2026-11-09 | Apostolic | Apostolic 4322 sends no report from 07:55 to 08:13 between morning runs: GONE drops its times at 08:10, it reports again at 08:13 and serves Goldblatt within 15 min. | a longer GONE time for a bus whose next Passio time is a trip start, or keep such times labeled est. |
| offroute_loop | gap | 2026-11-06 | Apostolic/Drexel | AP/DX 4331 runs a 17 min loop off the drawn line (north to 55th Street, east toward Lake Park) on each evening round: hidden with its times while away, shown again at Goldblatt (18:19), where it serves. | learned off-line service runs (the loop as a corridor), or keep the times of a hidden bus that Passio predicts within 10 min. |
| offroute_fcm | gap | 2026-11-06 | Friend Center/Metra | Friend Center/Metra 4313 in the evening: hidden off its line for about 12 min (south of 60th Street, parked 4 min), then serves Wyler Pavilion at 19:46. | the same as offroute_loop. |
| idle_linger_comeback | gap | 2026-11-09 | North | North 4317 waits at Reynolds Club after the learned linger time: hidden (core/idle.js LINGER), then serves again 10 min later. | refresh idle.json (the linger time was learned before Nov 6) or require no Passio time ahead for LINGER. |
| parked_rolling | gap | 2026-11-06 | Downtown Campus Connector | Downtown Campus Connector 12645 parked downtown from 18:30 to 20:49: shown with a time about 20 min ahead at 59th and Ellis that slides forward with the clock; GPS jitter of about 100 m keeps restarting the 80 m still clock, so core/idle.js never hides it. | a wider still radius downtown (about 150 m), or label times that slide 5+ min in 10 min while the bus is still as est. (a hide rule on that alone would be wrong 3 times in 4: only 24% of the minutes it picks were ghosts, E32). |
| parked_now | gap | 2026-11-06 | Apostolic/Drexel | AP/DX 12644 parked at Goldblatt for an hour with Passio saying it reaches Bernard Mitchell in under a minute (it moves again at 19:09); later stops keep a time ahead, so core/idle.js IDLE never applies, and its 90 min PARKED limit is not reached. | IDLE should ignore Passio times that slide with the clock (the next stop's time stays under 2 min while the bus is still). |
| planner_leaving | gap | 2026-11-06 | Downtown Campus Connector | Directions at 17:45 from 59th and Ellis to Gleacher Center: the top option boards Downtown Campus Connector 4318 on its live time (Passio: at 59th and Ellis in about 12 min) while the bus is downtown; it makes its last arrival at 18:00 (Roosevelt Station) and logs no other arrival that day. | none in the rules; a live time far below the timetable's ride time from where the bus is could be shown as est. |
| number_flap | gap | 2026-11-09 | Downtown Campus Connector | Downtown Campus Connector, 6 buses: each time core/offroute.js hides or shows a bus at the edge of the line, the others are renumbered (Bus 3 becomes Bus 2 and back). | keep a hidden bus's number place while it is in store.away (as for a feed gap). |

## 6. The flags (`data/labeled/flags/display_flags.csv`, 22 rows)

| Severity | Flag | Line | Value / all lines | n | Scope |
|---|---|---|---:|---:|---|
| high | false_hide_idle_serving_bus | South | 47.4 / 23.6 | 306 | hours=21-22\|23-24;stops=8631\|8633;note=after the rules shipped (2026-11-06 to 2026-11-10): 96.4 vs all lines 37.0, 27 events |
| high | false_hide_offroute_serving_bus | Friend Center/Metra | 53.1 / 19.6 | 635 | hours=18-21;vehicles=4325\|4313;stops=8612;note=after the rules shipped (2026-11-06 to 2026-11-10): 68.2 vs all lines 24.4, 88 events |
| high | planner_recommends_leaving_bus | Downtown Campus Connector | 17.8 / 7.1 | 14,191 | note=after the rules shipped (2026-11-06 to 2026-11-10): 14.7 vs all lines 5.7, 349 events |
| medium | bus_number_churn | Apostolic | 34.33 / 16.53 | 6,642 | hours=05-10;vehicles=4538;note=after the rules shipped (2026-11-06 to 2026-11-10): 17.1 vs all lines 14.7, 21 events |
| medium | bus_number_churn | Downtown Campus Connector | 119.35 / 16.53 | 21,138 | note=after the rules shipped (2026-11-06 to 2026-11-10): 120.42 vs all lines 14.7, 569 events |
| medium | false_hide_gone_serving_bus | Apostolic | 94.1 / 16.3 | 443 | hours=05-10;vehicles=4322;stops=8612;note=after the rules shipped (2026-11-06 to 2026-11-10): 100.0 vs all lines 9.9, 9 events |
| medium | false_hide_offroute_serving_bus | Apostolic/Drexel | 37.0 / 19.6 | 3,084 | hours=18-21;vehicles=4331;stops=8609;note=after the rules shipped (2026-11-06 to 2026-11-10): 56.6 vs all lines 24.4, 141 events |
| medium | ghost_bus_on_map | Red Line/Arts Block | 4.2 / 1.9 | 4,517 | hours=10-11\|19-21;vehicles=4331\|4315;note=2026-10-10 to 2026-11-10: 4.1 vs all lines 2.3 |
| medium | ghost_times_after_leave | Red Line/Arts Block | 6.5 / 3.9 | 4,052 | hours=10-12\|19-22;vehicles=4331\|4315;note=2026-10-10 to 2026-11-10: 6.6 vs all lines 4.6 |
| medium | ghost_times_after_leave | Drexel | 5.9 / 3.9 | 1,240 | hours=09-11;note=2026-10-10 to 2026-11-10: 2.4 vs all lines 4.6 |
| medium | ghost_times_after_leave | Downtown Campus Connector | 6.0 / 3.9 | 6,580 | note=2026-10-10 to 2026-11-10: 6.5 vs all lines 4.6 |
| medium | planner_recommends_leaving_bus | South | 10.8 / 7.1 | 13,225 | hours=17-24;note=after the rules shipped (2026-11-06 to 2026-11-10): 9.2 vs all lines 5.7, 195 events |
| medium | planner_recommends_leaving_bus | South Loop Shuttle | 14.5 / 7.1 | 979 | hours=00-01\|18-24;vehicles=4324\|4327;note=after the rules shipped (2026-11-06 to 2026-11-10): 1.6 vs all lines 5.7, 3 events |
| low | false_hide_gone_serving_bus | Red Line/Arts Block | 23.6 / 9.9 | 55 | hours=15-18\|21-22;vehicles=12648\|4319;note=2026-10-10 to 2026-11-10: 8.9 vs all lines 16.3 |
| low | false_hide_gone_serving_bus | Midway Metra | 48.0 / 16.3 | 123 | hours=10-11\|18-20;vehicles=12646\|12648;stops=8655;note=after the rules shipped (2026-11-06 to 2026-11-10): 65.4 vs all lines 9.9, 17 events |
| low | false_hide_gone_serving_bus | Regents Express | 89.2 / 16.3 | 37 | hours=20-22;vehicles=12648;stops=8643;note=after the rules shipped (2026-11-06 to 2026-11-10): 100.0 vs all lines 9.9, 5 events |
| low | false_hide_idle_serving_bus | North | 61.6 / 23.6 | 242 | hours=18-19\|23-24;vehicles=4313\|4317;stops=8579;note=after the rules shipped (2026-11-06 to 2026-11-10): 69.4 vs all lines 37.0, 43 events |
| low | false_hide_idle_serving_bus | Central | 36.3 / 23.6 | 168 | hours=20-22;stops=8579;note=after the rules shipped (2026-11-06 to 2026-11-10): None vs all lines 37.0, 0 events |
| low | false_hide_offroute_serving_bus | Regents Express | 37.8 / 19.6 | 82 | hours=18-19\|21-22;vehicles=4322\|12648;stops=8643;note=after the rules shipped (2026-11-06 to 2026-11-10): 0.0 vs all lines 24.4, 0 events |
| low | false_hide_offroute_serving_bus | South Loop Shuttle | 42.7 / 19.6 | 89 | hours=18-23;vehicles=4538;stops=8621;note=after the rules shipped (2026-11-06 to 2026-11-10): 0.0 vs all lines 24.4, 0 events |
| low | ghost_bus_on_map | Drexel | 3.0 / 1.9 | 1,783 | hours=09-11;vehicles=4324;note=2026-10-10 to 2026-11-10: 0.5 vs all lines 2.3 |
| low | ghost_bus_on_map | Downtown Campus Connector | 3.9 / 2.3 | 92,407 | note=after the rules shipped (2026-11-06 to 2026-11-10): 3.0 vs all lines 1.9, 387 events |

## 7. The E32 severity rule (flags.py)

Values are the shipped rules (`new`). Each line is graded on the whole replayed period and on the days since the rules
shipped (Nov 6 on) alone; the row takes the higher grade and that period's numbers (the other period is in `note=`).
- **high**: a measure that misleads riders about a time or a recommendation (ghost_times_after_leave,
  false_hide_*_serving_bus, planner_recommends_leaving_bus) at >= 2 x the all-lines value, n >= 300, >= 30 events on
  >= 3 service days, and still there since Nov 6 (>= 10 events and >= 1.5 x that period's all-lines value);
- **medium**: the same measures at >= 1.5 x with n >= 300 and >= 30 events on >= 3 days (or high's numbers without the
  confirmation since Nov 6); bus_number_churn and ghost_bus_on_map (no wrong time shown) at >= 2 x with >= 100 events
  on >= 3 days (their ceiling);
- **low** (status watch): >= 1.5 x on fewer events (10 to 29) or n < 300, or churn / badges at >= 1.5 x.
Lines under 1.5 x are not flagged.

## 8. Reproduce / refresh (needs headless Edge: not in the data repo's weekly refresh)

```
python experiments/routeknower/E28-scripts/fetch.py --out <dl> --from 2026-10-10 --to <newest day>
python experiments/routeknower/E32-scripts/inputs.py --dl <dl> --alerts <dl>/alerts.csv --days <day> ... --out <work>
python experiments/routeknower/E32-scripts/replay.py --work <work> --results <results> --days <day> ...
python experiments/routeknower/E32-scripts/measure.py --work <work> --results <results> --arrivals <dl>/arrivals.csv \
    --periods before=2026-10-10:2026-11-05 after=2026-11-06:<newest> all=2026-10-10:<newest> <day>=<day>:<day> ... --out <m>
python experiments/routeknower/E32-scripts/report.py --summary <m>/summary.json --json <m>/rates.json > <m>/tables.md
python experiments/routeknower/E32-scripts/flags.py --m <m> --out data/labeled/flags/display_flags.csv
python tools/flag_lines.py --check-inputs     # then python tools/flag_lines.py merges the registry
```
fetch.py takes a day the archive has not reached from the collector's run artifacts (archive_day's own merge) and
borrows the previous day's timetable; inputs.py builds each day's static files with tools/build_gtfs.py (cached by zip
content) plus today's corridors.json and idle.json. The replay takes about 20 s a weekday, measure about 15 min for
32 days with the per-day periods (flags.py counts the days with events from them). The test episodes:
`make_fixtures.py --work <work> --out web/tests/fixtures/display_episodes.json`, then `--expect` (ARCHITECTURE
"Display rules on real episodes").

## 9. E32c (2026-11-11): the owner's decisions, replayed before they shipped

The owner's answers to E32's open questions (RouteKnower E32): (1) "Keep hidden bus times off until it reports again";
(3) "Still show these buses if they are in a transition time to their new route (indicate this on their bus icon (if the
bus is clicked, have it display: Transitioning to new line)"; (5) "use a wider standing still radius"; (6) "keep numbers
steady but indicate that this bus count reported by PassioGo is unreliable"; (7) "Accept." (planner_leaving). Each change
was replayed on Oct 10 to Nov 10 (32 days) with the same inputs as above, through `replay.py --web <copy of the web
folder>` (a constant changed in a scratch copy), and compared with `compare.py` (only the shipped app, `new`). The final
table uses the refreshed web/data/idle.json (main 225cfde8) and web/data/service_seen.json (tools/build_service_seen.py,
RouteKnower E33) in every day's static files, for the shipped code (main 1aa43465) and the new code alike; the choice
tables below were run on the earlier copies (relative effects). In sample: service_seen.json was learned on the same days.

### 9.1 The choices

| Change | Variant | Result (32 days, all lines) | Chosen |
|---|---|---|---|
| 1 held times | a bus core/offroute.js or core/idle.js hid keeps its trip updates dropped after it stops reporting, until it reports again unhidden | times back on screen after a hide 1,729 -> 150 bus-min; 2,843 more hidden minutes, 285 of them a bus that then served | yes |
| 6 number places | RULE_HOLD_S 5 / 15 min | swaps per 10 service hours 16.5 -> 12.1 / 10.8 (DCC 119 -> 85 / 74; flips 838 -> 315 / 256); route-minutes whose numbers have a gap 711 -> 3,316 / 5,807 | 15 min |
| 3 times of a marked bus | windows as listed (transitions leave - 30 to join + 30, shift starts +- 30), times kept / badge only | ghost times 4.5% -> 5.6% / 4.5%; ghost badges 2.3% -> 3.5% either way; 10,019 marked bus-min, 23% then served | badge only |
| 3 who is marked | + heading back toward its line by 100 m (200 m) | marked 3,004 (2,539) bus-min, 37% (40%) then served; ghost badges 2.7% (2.6%) | 100 m |
| 3 windows after a break | only around the join (the drive to the new line) | marked 2,685 bus-min, 39% then served | yes |
| 3 distance | marked only within 1 km of its route | of the marked minutes 1 km or more off 20% then served, 300 m to 1 km 60%, under 300 m 33%: marked 1,670 bus-min, 50% then served (FCM 85%, AP/DX 63%) | 1 km |
| 5 still radius | 120 m everywhere / 150 m / 200 m downtown (north of 41.85) | ghost times -24 / -34 / -35 bus-min, ghost badges -19 / -50 / -73; idle hides +120 / +55 / +149, of them a bus coming to serve +27 / +2 / +19 | 150 m downtown |

### 9.2 Final: shipped rules -> the new rules (refreshed idle.json and service_seen.json)

all: 2026-10-10 to 2026-11-10 (32 days), shipped app, before -> after

| Line | ghost times % | ghost next bus % | ghost badges % | false hides min (% of hidden) | hidden min | risky legs % | number swaps per 10 h | number gaps min | shown after a leave, avg min | times back after a hide, min | transitioning min (coming to serve) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Downtown Campus Connector | 6.5 -> 6.4 | 5.8 | 3.9 | 942 (11.6) -> 810 (9.7) | 8,105 -> 8,326 | 17.8 -> 17.9 | 119.35 -> 73.28 | 375 -> 2,887 | 14.4 -> 14.5 | 410 -> 44 | 0 (0) -> 334 (134) |
| Friend Center/Metra | 2.1 -> 1.7 | 1.3 -> 1.0 | 0.5 | 344 (45.9) -> 394 (40.7) | 750 -> 969 | 4.6 -> 4.1 | 0.0 | 7 -> 77 | 7.6 -> 6.5 | 134 -> 25 | 0 (0) -> 87 (74) |
| Red Line/Arts Block | 6.6 -> 6.3 | 5.1 -> 4.6 | 4.1 -> 4.4 | 407 (14.3) -> 388 (13.2) | 2,855 -> 2,943 | 7.5 -> 7.3 | 7.3 -> 3.74 | 48 -> 853 | 15.1 -> 15.4 | 216 -> 9 | 0 (0) -> 223 (36) |
| Apostolic/Drexel | 4.8 -> 4.6 | 4.2 -> 4.0 | 1.7 -> 2.3 | 1213 (30.9) -> 709 (19.9) | 3,926 -> 3,555 | 6.1 -> 6.2 | 7.5 -> 5.57 | 92 -> 637 | 13.1 -> 14.9 | 263 -> 14 | 0 (0) -> 811 (511) |
| North | 3.0 -> 2.9 | 1.6 | 1.2 | 214 (20.4) -> 217 (18.3) | 1,047 -> 1,184 | 4.6 -> 4.7 | 0.0 | 4 -> 24 | 9.8 -> 9.7 | 106 -> 0 | 0 (0) -> 5 (5) |
| South | 6.1 | 4.5 | 3.3 | 202 (12.5) -> 197 (11.2) | 1,611 -> 1,756 | 10.6 | 0.0 | 14 -> 59 | 12.7 -> 12.6 | 133 -> 13 | 0 (0) -> 16 (5) |
| 53rd Street Express | 3.1 | 2.1 | 1.3 -> 1.4 | 156 (19.7) -> 123 (16.0) | 791 -> 767 | 3.7 | 0.08 | 9 -> 56 | 11.7 -> 12.2 | 41 -> 1 | 0 (0) -> 64 (33) |
| East | 1.8 | 1.4 | 0.5 | 133 (9.0) -> 125 (7.4) | 1,486 -> 1,694 | 4.3 -> 4.1 | 0.2 -> 0.32 | 16 -> 71 | 6.0 | 178 -> 0 | 0 (0) -> 13 (8) |
| Central | 3.3 -> 2.8 | 2.8 -> 2.3 | 1.4 | 148 (15.7) -> 137 (10.7) | 942 -> 1,285 | 5.4 | 0.0 | 6 -> 150 | 9.0 -> 8.0 | 171 -> 11 | 0 (0) -> 22 (22) |
| Midway Metra | 5.1 | 4.6 | 1.2 | 102 (14.4) -> 137 (16.1) | 706 -> 850 | 9.2 -> 9.1 | 0.06 | 16 -> 107 | 8.8 -> 9.0 | 31 -> 0 | 0 (0) -> 20 (1) |
| Drexel | 2.4 | 2.5 | 0.5 -> 0.6 | 31 (12.6) -> 62 (20.1) | 246 -> 308 | 3.4 | 0.71 -> 0.62 | 9 -> 35 | 6.9 -> 7.8 | 6 -> 0 | 0 (0) -> 46 (3) |
| Apostolic | 2.5 | 1.8 | 0.8 | 617 (49.5) -> 624 (49.1) | 1,247 -> 1,272 | 4.0 | 34.33 -> 35.77 | 115 -> 505 | 7.0 | 6 | 0 (0) |
| Regents Express | 2.4 | 2.0 | 0.6 | 64 (53.8) -> 94 (62.7) | 119 -> 150 | 10.1 | 0.0 | 0 | 4.9 | 34 -> 0 | 0 (0) -> 29 (11) |
| South Loop Shuttle | 1.4 | 1.3 | 0.9 | 41 (29.5) -> 41 (29.5) | 139 | 14.5 -> 14.4 | 0.0 | 0 | 7.3 | 0 | 0 (0) |
| **all lines** | 4.6 -> 4.4 | 3.3 -> 3.2 | 2.3 -> 2.4 | 4614 (19.2) -> 4058 (16.1) | 23,970 -> 25,198 | 7.0 | 16.53 -> 10.73 | 711 -> 5,461 | 11.9 -> 12.1 | 1,729 -> 123 | 0 (0) -> 1670 (843) |

after: 2026-11-06 to 2026-11-10 (5 days), shipped app, before -> after

| Line | ghost times % | ghost next bus % | ghost badges % | false hides min (% of hidden) | hidden min | risky legs % | number swaps per 10 h | number gaps min | shown after a leave, avg min | times back after a hide, min | transitioning min (coming to serve) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Downtown Campus Connector | 6.0 | 6.1 | 3.0 -> 3.1 | 75 (7.4) -> 66 (6.1) | 1,015 -> 1,087 | 14.7 | 120.42 -> 85.08 | 63 -> 322 | 13.5 -> 13.7 | 73 -> 7 | 0 (0) -> 26 (9) |
| Red Line/Arts Block | 6.5 -> 6.0 | 3.9 -> 3.4 | 4.2 -> 4.5 | 63 (19.1) -> 69 (19.8) | 329 -> 349 | 6.7 -> 6.6 | 7.36 -> 4.83 | 9 -> 90 | 16.8 -> 16.6 | 42 -> 7 | 0 (0) -> 25 (4) |
| Friend Center/Metra | 2.6 -> 2.5 | 1.4 -> 1.2 | 1.0 | 95 (66.4) -> 137 (63.7) | 143 -> 215 | 7.5 -> 5.6 | 0.0 | 7 -> 48 | 8.1 -> 7.8 | 30 -> 10 | 0 (0) -> 25 (21) |
| North | 2.7 | 1.8 | 0.3 | 43 (37.7) -> 51 (41.8) | 114 -> 122 | 2.6 -> 2.8 | 0.0 | 2 -> 11 | 9.0 | 0 | 0 (0) |
| Apostolic/Drexel | 3.4 | 4.2 | 1.3 | 141 (45.6) -> 76 (28.8) | 309 -> 264 | 4.9 | 3.01 -> 2.25 | 3 -> 64 | 14.6 | 19 -> 0 | 0 (0) -> 65 (65) |
| East | 1.1 | 0.7 | 0.0 | 5 (6.2) -> 5 (6.2) | 80 | 1.3 | 0.0 | 1 -> 14 | 4.5 | 0 | 0 (0) |
| South | 1.8 | 1.9 | 0.5 | 35 (29.7) -> 33 (28.4) | 118 -> 116 | 8.8 -> 8.7 | 0.0 | 4 | 6.8 | 0 | 0 (0) -> 2 (2) |
| Central | 0.6 | 0.6 | 0.0 | 0 (0.0) -> 2 (3.2) | 51 -> 63 | 1.7 | 0.0 | 1 -> 9 | 2.5 | 9 -> 0 | 0 (0) |
| 53rd Street Express | 4.6 | 2.9 | 1.7 | 15 (16.0) -> 13 (14.1) | 94 -> 92 | 2.6 | 0.57 | 1 | 16.1 | 1 | 0 (0) -> 2 (2) |
| Midway Metra | 4.5 | 3.6 | 1.2 -> 1.3 | 17 (14.9) -> 17 (13.7) | 114 -> 124 | 8.3 | 0.0 | 3 -> 8 | 9.6 -> 9.8 | 0 | 0 (0) -> 2 (0) |
| Drexel | 5.9 | 7.6 | 3.0 | 7 (50.0) -> 11 (37.9) | 14 -> 29 | 8.2 | 0.0 | 2 | 18.9 | 0 | 0 (0) |
| South Loop Shuttle | 0.0 | 0.0 | 0.0 | 0 (0.0) -> 0 (0.0) | 11 | 1.6 | 0.0 | 0 | 0.0 | 0 | 0 (0) |
| Apostolic | 3.3 | 2.3 | 0.7 | 22 (18.3) -> 22 (18.0) | 120 -> 122 | 5.7 | 17.1 -> 16.28 | 4 -> 78 | 9.6 | 0 | 0 (0) |
| Regents Express | 0.2 | 0.0 | 0.2 | 5 (83.3) -> 5 (45.5) | 6 -> 11 | 0.0 | 0.0 | 0 | 0.0 | 0 | 0 (0) |
| **all lines** | 3.8 | 2.8 -> 2.7 | 1.9 | 523 (20.8) -> 507 (18.9) | 2,518 -> 2,685 | 5.7 -> 5.5 | 14.7 -> 10.5 | 100 -> 651 | 11.7 | 174 -> 25 | 0 (0) -> 147 (103) |

Totals, all lines, 32 days (shipped -> new): ghost times 12,344 -> 11,940 bus-min (4.6% -> 4.4% of bus-minutes with
times); ghost next bus 50,228 -> 47,958 stop-min; ghost badges 7,325 -> 7,795 (2.3% -> 2.4%: the marked transitioning
badges that did not serve); hidden while coming to serve 4,614 -> 4,058 min (19.2% -> 16.1% of hidden minutes; off-route
3,280 -> 2,437, held 285 new); Directions legs on a bus that left first 11,758 / 167,020 -> 11,606 / 166,686 (7.0%);
number swaps 5,063 -> 3,286 (flips 838 -> 253); times back on screen after a hide 1,729 -> 123; marked "Transitioning to
new line" 1,670 bus-min, 843 of them a bus that then served its line within 15 min. Nov 6 to 10: ghost times 3.8% both,
ghost next bus 2.8% -> 2.7%, false hides 523 -> 507 min, risky legs 5.7% -> 5.5%, swaps per 10 h 14.7 -> 10.5, times
back after a hide 174 -> 25, marked 147 bus-min (103 served).

### 9.3 What did not change

- gone_comeback (owner question 2, sent back): GONE is unchanged.
- parked_rolling and parked_now stay gaps: the wider radius downtown keeps the DCC's still clock from restarting, but IDLE
  needs no Passio time ahead and PARKED 90 min; a time that slides with the clock is still shown (E32's other option, a
  label "est.", is not done).
- idle_linger_comeback (idle.json refreshed by RouteKnower E33, the same cutoff for North at Reynolds Club).
- planner_leaving: accepted by the owner on 2026-11-11 as a known gap.

## 10. Caveats

- The archived raw polls keep a vehicle only when its report changed, so the replay is one poll smoother than the real
  feed (the 45 s number and badge holds and the one odd empty answer are not exercised). Trip updates are rebuilt from
  the logged prediction updates (on display from first seen to last seen + 60 s).
- What a bus did = the collector's logged arrivals: a missed detection counts as not served (an arrival up to 15 min
  after the shown time counts; sparse reporters and buses with no report through the judged span are not judged).
- "before" runs today's rules on the days corridors.json and idle.json were learned from (in-sample for off-route and
  idle); "after" (Nov 6 to 10) is out of sample but 5 days: flags graded on it alone need 10+ events.
- Nov 10 was merged from the collector's run artifacts before the daily archive ran (the same merge the archive uses).
- Dev only: the committed web/data shapes of Apostolic and Apostolic/Drexel lack stops 225833 / 225834 that the deployed
  site (rebuilt from Passio's zip at deploy) has; the replay builds each day's own files, so it matches the deployed site.

Unofficial analysis of the public Passio feed; not a statement by the operator or the University. Official service
information: 773.702.8181.


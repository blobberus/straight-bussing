# Bus count transitions: which buses leave or join a line, where, and what they do (labeled)

Owner, 2026-11-06: "Create a detailed log of bus behavior during transition time in order to find which buses and where
they tend to go on break (or add themselves). Create a sheet log of this behavior and detail which buses go off the map
or route and where (same for if a bus gets added)."

Built by `experiments/routeknower/E29-scripts/transitions.py` (RouteKnower.md E29) from the archived raw position polls
(release assets `raw-polls-<day>`), Passio's prediction updates (`pred-updates-<day>`), each day's timetable
(`gtfs-<day>.zip`) and the logged arrivals (data branch `data/ground_truth/arrivals.csv`), gathered with
`experiments/routeknower/E28-scripts/fetch.py`. 27 service days, Oct 10 to Nov 5, 2026 (Oct 18 had no change). Service
days run 04:00 to 04:00 Chicago time. Every file is plain CSV: open it in Google Sheets (File > Import) or Excel.

**Refreshed 2026-11-11 (E30) through Nov 10:** 32 service days, 2,250 events (Oct 18 and Nov 7 had no change; Nov 10's
polls were merged from the collector's run artifacts by fetch.py, the archive builds the same file later). The 1,926 rows
of Oct 10 to Nov 5 came out identical; the counts below are still those of the first 27 days. All 32 days: leaves break
276, shift_end 241, feed_drop 207, route_switch 191, layover 201; adds from the garage 336, a break 270, another line 166,
a layover 244, unknown 118. `leave_windows.csv` was not re-learned (it feeds the forecast table; the data repo's weekly
findings run re-learns it). The odd-behavior files of E30 are described at the end ("Odd behavior at transition times").

## What one row of `transitions.csv` is

A **transition**: a line's bus count changed. The events are the collector's own bus count changes
(`tools/bus_changes.py`, docs/DATA-COLLECTION-LOG.md DC-020), rebuilt from each day's merged raw polls:
- `leave`: a bus has sent no report on the line for 10 minutes while another bus of the line still reports (timed to
  its last report on the line). A line that empties (end of service) is not a transition.
- `add`: a new bus reports on a line that already has a bus, for 5 minutes (3 reports or more).

For each event the bus's own track (every fresh report it sent, under any route label), its logged arrivals on every
line, Passio's predictions for it and the line's drawn route say where it left (or joined) the line, where it went (or
came from), for how long, and whether Passio kept predicting it. 1,926 events: 955 leaves, 971 adds; on a weekday
about 40 leaves that are not layovers and 39 adds that are not a layover's end.

## Labels (first match wins)

| Kind | Label | Meaning | Rule |
|---|---|---|---|
| leave | `layover_swap` | a normal wait between trips: Passio leaves buses out of the feed for 10 to 27 min | back on the same line within 30 min (bus_changes `lasting` = 0) |
| leave | `route_switch` | moved to another line | its next logged arrival is on another line, within 60 min |
| leave | `feed_drop` | went off the map mid-route | no report at all from it while away, its last report was moving (3 m/s or more) on the line's route, not near the garage; whether it kept driving unseen is unknown |
| leave | `break` | a pause, then service again | it served riders again (any line) 30 min to 3 h later |
| leave | `shift_end` | done for the day (or at least for 3 h) | no logged arrival on any line in the 3 h after |
| leave | `unknown` | not enough data after it | the arrivals log ends before 30 min after the event |
| add | `layover_swap` | the end of a layover | the same bus left this line in the 30 min before (bus_changes `returning` = 1) |
| add | `added_from_route` | came over from another line | its last logged arrival, within 60 min before, was on another line |
| add | `added_from_break` | back from a break | it served riders 30 min to 3 h before, and paused since |
| add | `added_from_garage` | started its service | its first report of the service day, or it was at the operator's garage (within 700 m of 41.8206, -87.6416) in the hour before |
| add | `unknown` | none of the above | e.g. a bus relabeled from a line it never served |

Counts, leaves: break 231, shift_end 205, layover_swap 181, feed_drop 178, route_switch 160. Adds: added_from_garage 289,
added_from_break 226, layover_swap 213, added_from_route 141, unknown 102.

## Columns of `transitions.csv`

| Column | Meaning |
|---|---|
| event_id | `<service day>-<n>`, in time order |
| service_day, dow, local_time, hour, epoch | when (Chicago; a leave is timed to the bus's last report on the line, an add to its first) |
| route_id, route | the line (GTFS route id and name) |
| kind, label | `leave` / `add` and the label above |
| vehicle_id | Passio's bus number |
| buses_before, buses_after | the line's bus count before and after |
| sched_buses_hour, sched_buses_next_hour, timetable_change | the timetable's buses this clock hour and the next; 1 = the timetable also loses (leave) or gains (add) a bus within 30 min |
| trip_id | the bus's trip id at the event |
| spot, spot_lat, spot_lon | leave: the last report of the bus on the line within 40 m of the line's route (the leave point); add: its first report on the line. Named after the nearest stop within 160 m, the operator's garage, a map label within 250 m ("near X"), the nearest stop within 600 m ("N m from X"), else the coordinates |
| spot_stop_m, line_m | metres from the spot to the nearest stop and to the line's drawn route |
| last_stop, last_stop_time | leave: its last logged arrival on the line (within the hour before); add: its last logged arrival on any line before joining (within 3 h) |
| where, where_lat, where_lon | leave: where it went until it served riders again (or for 3 h): `Operator garage`, `parked at X (N min)` (still for 10 min or more), `out of the feed` (no report at all), `drove off (last seen near X)`; add: where it came from (the garage, a parked spot, `from <line> at <stop>`, `first report of the day`) |
| where_route | leave: other route labels it reported under while away; add: the line it last served (within 60 min) or the label it had before |
| away_min | leave: minutes until its next logged arrival on any line (within 3 h); add: minutes since its last logged arrival |
| came_back, back_route, back_stop, back_time | leave: whether it served again within 3 h, and where it rejoined service |
| reports_while_away | how many reports it sent while away (0 = off the map the whole time) |
| moving_at_event | leave: y = its last report was moving (3 m/s, or 150 m in its last 2 min) |
| passio_pred_at_leave | leave: y = Passio still showed a time at least 2 min ahead for it on this line when it left |
| passio_pred_after_min | leave: how long after it left Passio still showed a time for it on this line (until it came back to the line, if it did) |
| phantom_stops | leave, lasting only: stops of this line Passio was predicting for it (in the 45 min after) that it never served |
| replacement_vehicle, replacement_min, replacement_spot | leave: another bus added to the line within 30 min (minutes from the leave, negative = before) and where it joined |
| lasting, returned_min, moved_to_route | bus_changes.py's own classification (DC-020) |
| evidence | the facts behind the label in words |

## The other files

- `transition_spots.csv`: per kind, line and named spot (layover swaps left out): events, distinct days, weekday
  events, counts per label, the clock time (p10 / p50 / p90, service-day clock), where the buses typically went (leave) or
  came from (add), how many different buses, and for leaves how many Passio still predicted.
- `transition_summary.csv`: per line, day type (weekday / weekend) and clock hour: leaves, leaves that are not layovers,
  adds, counts per label, days with a leave, leaves per day, the top leave and add spots, how many leaving buses Passio
  still predicted and the phantom stops.
- `leave_windows.csv`: per line, day type and the bus's last stop, the clock windows (padded 5 min) in which a bus that
  made its last stop there left the line on at least 3 days (`transition_rules.py`), with the in-sample precision
  (leaves / all visits of the line to that stop in the window). The forecast table's `break_window` and
  `leave_spot_dist_m` columns use it (tools/build_eta_dataset.py). Precision is low (median 0.19, best 0.54): a window says when a
  bus of the line usually leaves there, not which bus.

## What it shows (plain words; RouteKnower.md E29 has the numbers)

- **Downtown Campus Connector** has half of all transitions (381 of 774 lasting leaves). Midday breaks 11 AM to 1:45 PM
  at Midway Plaisance & Cottage Grove, 59th & Ellis and Rockefeller Chapel; buses rejoin from breaks at Rockefeller
  Chapel around 11 AM; the evening drop at Gleacher Center around 6:30 PM (often off the map); first buses join at
  Gleacher Center around 6:45 AM from the garage.
- **Apostolic** (morning): bus 4322 leaves for a half-hour break at South Campus Residence Hall at 8:42 to 8:44 AM (6
  days, always a break, back at Goldblatt or Wyler); the peak ends at S Drexel Ave & 57th St at 9:50 to 10:05 AM.
  First buses join at Apostolic Lot about 5:20 AM.
- **Drexel**: buses leave at Burton-Judson Courts or S Drexel Ave & 57th St at about 10:00 AM, mostly to another line.
- **Midway Metra**: a bus leaves at Midway Plaisance & Cottage Grove at about 10:00 AM (the end of the morning trains;
  mostly moved to another line); buses join near 60th & Ellis and the Press Building at about 6:50 AM.
- **Red Line/Arts Block**: bus 4331's break near Garfield & Wabash or Logan Center around 10:20 to 10:35 AM (back about
  55 min later at the Garfield stations) and a 2 PM break at the operator's garage; leaves near Garfield & Wabash in the
  afternoon and evening.
- **Apostolic/Drexel**: the evening step down at Goldblatt Pavilion around 8:50 to 9 PM (and 59th & Ellis); buses join at
  Goldblatt around 6 PM, mostly coming over from another line.
- **NightRide (East, Central, South)**: evening leaves at Ellis Ave & 57th St (9:15 to 10:05 PM), Reynolds Club, and
  South at Burton-Judson around 9 PM, mostly shift ends off the map.
- **Passio kept predicting** 611 of the 774 buses that left for good (79%); after a break for a median 20 min, after a
  shift end 14 min; 4,164 stops were promised by a bus that had already left. The app now drops those times once a bus
  has been off the feed for 15 min (web/js/core/transition.js, Kit Transition.swift).
- **Which bus will leave cannot be told ahead** with the precision the app needs: at best about a third of flagged
  visits were a bus's last stop (E29; E25 found 46%). The same bus doing the same run (4322 above) reached 91% on the
  held-out days but on 11 visits only: not enough yet.

## Caveats

- Labels come from what happened next, which a phone cannot know. The app uses only what it can see at the time.
- Arrivals come from the collector, which misses stops of buses that report rarely (DC-023 item 6; e.g. 12647 reported
  only every 5 to 20 min on Oct 12) and had gaps (Oct 28 7:31 to 8:11 PM, Nov 5 10:39 AM to 12:39 PM). A missed arrival
  can turn a layover into a break, a break into a shift end, or make a bus look like it left (a sparse reporter can
  appear as a leave followed by an add).
- `feed_drop` cannot say what the bus did: Passio stops listing a bus when its tablet stops sending (a driver signing
  off for a break, a dead tablet, or a feed problem).
- Spots are named by the nearest stop: a bus parked on a side street near a stop gets that stop's name.
- The events are rebuilt from the raw polls with today's code (bus_changes.day_changes); the data branch's
  `bus_changes.csv` (live since Oct 30) agrees on 411 of 425 events in its window (run edges, overlapping runs).
- Times are the bus's report times (Passio's clock). Daylight saving ended Nov 1; local times are correct across it.

## Odd behavior at transition times (E30, 2026-11-11)

Owner, 2026-11-11: "The analysis should check for buses that have odd behavior during transition times and lines that
have large prediction misses. Create or indicate wherever appropriate for another agent to analyze and notice and
account for this data. Flag these lines and also tell me."

Built by `experiments/routeknower/E30-scripts/` (RouteKnower.md E30) from the same inputs as above plus Passio's
predictions log (data branch `data/ground_truth/predictions.csv` and its archive) and E28's dwell episodes
(`endofservice.py`). 32 service days, Oct 10 to Nov 10; **before** = Oct 10 to Nov 5 (27 days), **after** = Nov 6 to 10
(5 days: Fri, Sat, Sun, Mon, Tue), from the day the off-route hide (E27b), the 15-min gone rule and the idle hide
shipped. Those rules change what the app shows, not what Passio sends: the "after" rates below are Passio's feed,
measured the same way (what the shipped app showed riders is RouteKnower E32).

**Transition windows**: 30 min on each side of (per line) a bus count change that is not a layover (the rows of
`transitions.csv`), a shift change (a lasting leave and a join on the line within 30 min), the start or the end of a
listed span (the day's timetable), and a clock hour where the timetable's buses per hour change. Every detector looks
at the whole day; each episode is tagged with the window it falls in (blank = outside every window), so a line's rate
inside the windows can be set against its rate outside them and against all lines. Inside the windows, all lines, per
10 bus-hours: buses vanishing mid-route 0.96 (outside 0.41), off their line 3.49 (1.22), lingering not in service 2.53
(1.10), under another line's label 0.30 (0.05), reporting after hours 0.49 (0.26), position jumps 1.24 (0.81): odd
behavior is 1.5 to 7 times as frequent around transitions. `window_own_bus` = y when the only window is the episode's
own bus count change (a bus that vanishes when it leaves makes its own window): 9% of the in-window episodes.

### Files

- `odd_episodes.csv`: one row per episode (5,815).
- `odd_summary.csv`: per line (and `All lines`) and per bus (`scope` = line / vehicle), behavior code and period
  (`all`, `before`, `after`): episodes, days, minutes, `unit`, `rate_in_window` and `rate_outside` (per 10 bus-hours
  inside / outside the windows), or for the codes tied to an event the rate per 100 events, listed spans or timetable
  steps (`rate_in_window` then holds it); `ratio` = inside / outside; `all_lines_rate_in_window`; `share_of_all_lines`;
  the top spot, hour and bus. Per-bus rows carry the bus's own rate per 10 of its bus-hours on the line in
  `rate_outside`.
- `../flags/transition_flags.csv`: the line flags (shared schema, `data/labeled/flags/README.md`), severity rule below.

### Columns of `odd_episodes.csv`

| Column | Meaning |
|---|---|
| episode_id | `<service day>-<n>`, in time order |
| service_day, period, dow, local_time, end_time, hour | when (Chicago); period `before` / `after` (Nov 6) |
| route_id, route | the line (GTFS id); for a wrong label, the line of the LABEL |
| vehicle_id | Passio's bus number (`;`-separated for the staying buses of a drop) |
| code | the behavior (table below) |
| spot, spot_lat, spot_lon | where (named like E29: stop within 160 m, garage, map label, "N m from stop") |
| duration_min | how long (see each code) |
| window_kind, window_ref, window_offset_min, window_own_bus | the transition window (bus_change: E29 event id; handover: both ids; service_start / service_end: the listed time; timetable_step: buses `x->y`), minutes from its centre, whether it is the bus's own event |
| outcome | the code's sub-case (table below) |
| passio_showed | what Passio's feed showed for the bus meanwhile, in words |
| other_route, other_vehicle | the line driven or the label taken / the other bus (twins, bunching, the leaving bus of a drop) |
| max_dist_m, stops_affected, arrivals_during, pred_visible | evidence: metres (off the line, jump, how far it reappeared), stops promised or served, logged arrivals meanwhile, Passio had a time for it (y / n) |
| median_err_min, max_late_min, relabel_min, beyond_gone_min, expected, observed | evidence for some codes: Passio's median error (negative = the bus came later than shown), the worst lateness, minutes until Passio relabeled the bus, minutes of ghost times past the app's 15-min gone rule, the timetable's and the observed bus count |
| event_ref | the E29 event (`transitions.csv` event_id) |
| evidence | the facts in words |

### Behavior codes and rules (each measured on fresh reports, at most 300 s old)

| Code | Rule | Episodes (before / after) | Who and where it concentrates |
|---|---|---|---|
| `feed_drop_mid_route` | no report for 5 min or more while the feed stayed alive (other buses reported, no 2-min pause in the first 5 min; cut where the whole feed went quiet), its last report moving (3 m/s or 150 m in 2 min) on its own line, more than 1.5 km from the garage and 150 m from E28's linger spots. outcome `reappeared_far` (next report 400 m or more away: it drove on unseen) 257, `reappeared_near` 89, `not_back` 41 | 347 / 40 | **bus 4322: 170** (124 near South Campus Residence Hall, Apostolic and Apostolic/Drexel mornings, 6 to 9 AM: it leaves the feed where it waits between trips and reappears driving); without it 217, Downtown Campus Connector 160 |
| `sparse_reporting` | the same gap from a bus whose last two reports were already more than 2 min apart; gaps less than 10 min apart merge | 50 / 11 | **bus 12647 (Downtown Campus Connector): 55 of 61**, on 6 days (Oct 12, 15, 20, 27, Nov 2, 6): positions minutes old for hours (DC-023 item 6) |
| `position_jump` | consecutive reports at most 120 s apart, 500 m or more apart, faster than 35 m/s; jumps of one bus within 5 min merge. outcome `teleport` (it stays where it jumped) 577, `spike` 1 | 524 / 54 | **bus 4322: 250** (Apostolic 98, Apostolic/Drexel 60, East, Central); 4314 62 (Downtown Campus Connector); bursts of up to 8 km when a tablet resumes after a gap (4324 Nov 6 9:29 AM: Hyde Park to River East in 30 s) |
| `frozen_gps` | 5 reports or more over 5 min at identical coordinates while the bus moved (a speed of 3 m/s, or 200 m within 60 s after) | 16 / 0 | Downtown Campus Connector 12647 (9) |
| `stale_position` | listed with a report 90 to 300 s old for 3 min | 0 / 0 | none |
| `twin_buses` | two buses with the same label within 25 m, both moving, for 3 min (or identical coordinates) | 6 / 0 | Downtown Campus Connector (convoys); never identical coordinates |
| `after_hours` | reports under the label more than 15 min after (30 min before) the listed hours, 3 min or more (DC-023 item 7). outcome `served` 103 (it logged arrivals) / `not_serving` 110 | 182 / 31 | Central from 23:30 on 31 of 32 nights (44), Midway Metra after 7:10 PM (32, 12648), Apostolic after 10:25 AM (29, 4322), Regents Express 9 PM (25, 12648) |
| `wrong_line_label` | the checkups' test (DC-024 item 3): 10-min bins of moving reports, under 30% on the labeled line and 85% or more on one other line, 3 bins (merged across 20 min); `relabel_min` = minutes until Passio relabeled it (51 of 99 relabeled) | 83 / 16 (93 bus-hours, 707 arrivals filed under the label) | Apostolic/Drexel label on Friend Center/Metra's loop about 6 PM (18; **4331**), Red Line label on Apostolic/Drexel (11), Midway Metra label on Red Line after 7 PM (10; 12648), Friend Center/Metra label on Apostolic/Drexel (7; 4325, 4313) |
| `label_flipflop` | label A -> B -> A within 10 min | 10 / 4 | Goldblatt Pavilion, 10 AM |
| `linger_not_in_service` | an E28 dwell (still 3 min or more within 80 m) labeled break, end_of_shift, garage_return or parked_never_served, 5 min or more; `pred_visible` = Passio predicted it a quarter of the time or more (862 of 1,028) | 906 / 122 | Reynolds Club 157 (11 PM), Gleacher Center 125 (Downtown Campus Connector), Burton-Judson (South after 8 PM), Logan Center (Red Line, 4331) |
| `off_route_drive` | more than 250 m from its line and its learned corridor (web/data/corridors.json) on 2 reports over 45 s, inside the listed hours +- 30 min. outcome `not_serving` 644, `in_service` 391 (an arrival on the line 15 min before and 20 min after), `garage` 301 | 1,174 / 162 | 4331 166, 4538 96; Apostolic/Drexel near 63rd & Ellis on Oct 26 (53, the day its line was redrawn) |
| `ghost_predictions_after_leave` | a lasting leave (break / shift_end / route_switch / feed_drop) after which Passio kept a time for the bus on the line 5 min or more (`passio_pred_after_min` of E29); 257 of 312 lasted past the app's 15-min gone rule | 253 / 59 | Downtown Campus Connector 170 (12647 60), midday at Midway Plaisance & Cottage Grove |
| `joining_bus_no_predictions` | a join (not a layover) whose bus served 2 stops or more of the line before Passio showed a time for it (the four downtown stops without Passio times since Oct 27, DC-025, left out) | 123 / 13 | Downtown Campus Connector at Rockefeller Chapel about 10 AM; all lines: **27.0% of a joining bus's arrivals in its first 30 min have no Passio time, against 10.1% of the other arrivals** (every line 1.9 to 4.3 times) |
| `staying_bus_late_after_drop` | after a lasting leave that leaves a bus on the line, the staying buses' Passio times 10, 15 and 20 min ahead for arrivals in the next 45 min (predictions.csv): median 3 min or more late, 2 times or more | 463 / 73 | Passio's 10 to 20 min times are 3 min or more late 56% of the time anyway; after a **2-to-1 drop** (DC-020) the staying bus's error is 14.7 min on Apostolic (6.2 at other times, 42 times from 21 drops) and 8.8 on Drexel (5.2); all lines 5.1 (5.3) |
| `bunching_after_add` | after a join, the new bus within 2 min of another bus at the same stop 3 times or more in 30 min | 32 / 4 | Apostolic/Drexel at Goldblatt 5 to 7 PM; all lines 4.6% of a joining bus's arrivals bunched vs 2.0% |
| `unscheduled_leave` | a lasting leave the timetable does not have that leaves the line below its listed count 15 min later, no bus joining within 15 min; duration = until it was back at its listed count (at most 120) | 414 / 61 | Downtown Campus Connector 289 (59th & Ellis most often; bus 12647 58), Apostolic/Drexel 58 |
| `extra_bus_added` | a join the timetable does not have that puts the line above its listed count | 159 / 30 | Red Line/Arts Block 60 (4315, 10 AM to 2 PM), East and Central evenings |
| `timetable_add_missed` | a timetable step up with the line never reaching it in 45 min and no join from 30 min before; duration = until it did (at most 120) | 85 / 12 | **North's second bus at 9 PM: missing on 26 of 32 days** (the operator's NightRide notices); Midway Metra 8 to 10 AM 56 |
| `timetable_drop_missed` | a step down with the line keeping its buses and no lasting leave within 45 min | 7 / 1 | North 5 PM |
| `service_start_late` / `service_start_missing` | first bus under the label more than 15 min after a listed span starts / none in its first 60 min (a bus already there 45 min before counts as on time) | 56 / 6, 20 / 8 | Friend Center/Metra's 5 AM listing on weekends (never runs: known since Oct 25); Midway Metra's 3 PM span; Nov 9's morning lines (DC-025 item 4) |
| `service_end_early` | the line's last bus left more than 15 min before the listed end (spans ending before 01:00) | 88 / 14 | **every weekday**: Downtown Campus Connector listed to 00:25, last bus 22:04 to 23:09; Apostolic/Drexel listed to 00:55, last bus 00:00 (with the NightRide notice's 00:00:34 end); 53rd Street Express listed to 19:25, last bus 17:56 to 19:03 (mostly about 18:10); Midway Metra's morning span (to 11:55, last bus about 10:00) on 20 of 22 weekdays |
| `night_feed_silent` | the same for spans ending after 01:00 | 81 / 15 | NightRide (North, South, East) every night: listed to 04:29, no bus in the feed after about midnight (known since 2026-10-10: the app says "No shuttles are reporting live locations"); not flagged |

### What changed after Nov 6 (all lines; 5 days, 2 of them a weekend: read as a first look)

Per 10 bus-hours inside the windows, before / after: vanishing mid-route 0.98 / 0.83, position jumps 1.31 / 0.83 (bus
4322 226 / 24), off the line 3.52 / 3.28, lingering 2.54 / 2.44, wrong label 0.29 / 0.35, after hours 0.47 / 0.61. Per
100 lasting leaves: ghost times 32.7 / 41.8 (Downtown Campus Connector 34.1 / 50.6; the app now drops them after 15 min
of silence, and 48 of the 59 after Nov 6 lasted longer than that), unscheduled leaves 53.5 / 43.3. Per 100 joins: joining bus
without a time 16.2 / 9.8. Passio's feed behaves as before; nothing here says the shipped rules are wrong or right
(that is E32's replay).

### Flags: the E30 severity rule (it wins over the registry's default)

Per line and code, `value` = the line's rate (per 10 bus-hours inside transition windows; per 100 bus count changes,
listed spans or timetable steps; for `joining_bus_no_predictions` the share of a joining bus's first-30-min arrivals
with no Passio time; for `staying_bus_late_after_drop` the staying bus's mean absolute error after a 2-to-1 drop divided
by the line's at other times), `baseline` = the same metric over all lines, ratio = value / baseline, ep = the line's
episodes (2-to-1 drops; joining-bus arrivals), days = service days with one:
- **high**: ratio >= 2, ep >= 30 (spans and steps, once a day at most: >= 15), on >= 5 days, and riders can be misled
  (a bus shown wrongly, a time that never comes true, a bus listed that does not run);
- **medium**: ratio >= 1.5 with ep >= 30 (15) on >= 3 days, or ratio >= 2 with ep >= 10 (8) on >= 3 days, or a
  would-be high that does not mislead riders (`extra_bus_added`, `timetable_drop_missed`);
- **low** (status `watch`): ratio >= 1.5 with ep >= 10 (8) on >= 3 days;
- not flagged: a ratio under 1.5 (a behavior of every line is a fact of the feed: the ghost times, the joining bus
  without a time, Passio's lateness, stated above) or fewer episodes; `night_feed_silent` (known).
- Scope: `vehicles=` when one bus has half of the line's episodes or more (and 10), `hours=` when 6 consecutive clock
  hours or fewer hold 60%, `days=weekday` at 90%, `stops=` when one named stop holds 40%; the note gives the top spot
  and the rate before / from Nov 6.

First run (2026-11-11): 40 flags, 9 high, 25 medium, 6 low (`../flags/transition_flags.csv`).

### For other agents

- **Models** (RouteKnower, the data repo's `algorithm-test/`): slice every active flag (`flagged_lines.csv`); drop
  `feed_drop_mid_route`, `sparse_reporting`, `frozen_gps` and `wrong_line_label` episodes' arrivals from training labels
  (the bus was unseen, minutes stale or filed under the wrong line), never from test rows; drop a bus's predictions once
  it is gone (the forecast table's `gone_rule`) before scoring; never use `linger_not_in_service` or `after_hours` buses
  as next-bus candidates in training; score the staying bus after a 2-to-1 drop (Apostolic, Drexel) and the 30 min after
  a join as their own slices. Use the facts as known at query time (the forecast table's `transition_min`,
  `bus_leaves_min`, `added_recently`, `absent_s`), never the episode labels (they are built from what happened next).
- **App agents**: E32 replays the shipped display rules on these episodes. Open questions from the numbers: bus 4322
  vanishes and jumps far more than any other bus (a tablet to report to the operator); the listed ends of the Downtown
  Campus Connector, Apostolic/Drexel and 53rd Street Express outlast the service every weekday (the planner and the
  "Scheduled" labels use the listed hours); North's 9 PM second bus rarely runs.
- **Data checkups**: `wrong_line_label` here is the checkups' DC-024 test (Nov 6 10 episodes, Nov 9 4: the same as the
  checkups); recheck bus 4322 and 12647 at the next checkup.

### Reproduce / refresh (about 6 min for 32 days, plus the downloads)

```
python experiments/routeknower/E28-scripts/fetch.py --out <dl> --from 2026-10-10 --to <newest day>
git show origin/data:data/ground_truth/predictions.csv > <dl>/predictions.csv        # + archive/predictions-*.csv
python experiments/routeknower/E29-scripts/transitions.py --dl <dl> --out data/labeled/transitions --cache <e29.pkl>
python experiments/routeknower/E28-scripts/endofservice.py --dl <dl> --out <e28 dir> --cache <e28.pkl>
python experiments/routeknower/E30-scripts/run_odd.py --dl <dl> --e28 <e28 dir> \
    --transitions data/labeled/transitions/transitions.csv --out data/labeled/transitions --work <scratch> --json <e30.json>
python experiments/routeknower/E30-scripts/flags.py --tables data/labeled/transitions --json <e30.json> \
    --out data/labeled/flags/transition_flags.csv
python tools/flag_lines.py --check-inputs
python experiments/routeknower/E30-scripts/test_odd.py
```

### Caveats

- Episodes come from Passio's public feed as the collector saw it; a collector gap is not a feed drop (the feed must
  stay alive), but a bus Passio files under another route is counted under that route's label except in
  `wrong_line_label`.
- Spots are named by the nearest stop of any line: "South Campus Resident Hall" is where bus 4322 vanishes, not an
  Apostolic stop.
- The windows cover most of the Downtown Campus Connector's day (it changes bus count all day): its "outside" rates
  rest on few bus-hours.
- `staying_bus_late_after_drop` episodes alone say little (Passio's 10 to 20 min times are often late); use the 2-to-1
  ratio in the flags.
- Oct 26: the Apostolic/Drexel line was redrawn; its `off_route_drive` episodes near 63rd & Ellis that day come from the
  change.
- Nov 10 was merged from the collector's run artifacts (fetch.py), not the archive.

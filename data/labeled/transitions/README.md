# Bus count transitions: which buses leave or join a line, where, and what they do (labeled)

Owner, 2026-11-06: "Create a detailed log of bus behavior during transition time in order to find which buses and where
they tend to go on break (or add themselves). Create a sheet log of this behavior and detail which buses go off the map
or route and where (same for if a bus gets added)."

Built by `experiments/routeknower/E29-scripts/transitions.py` (RouteKnower.md E29) from the archived raw position polls
(release assets `raw-polls-<day>`), Passio's prediction updates (`pred-updates-<day>`), each day's timetable
(`gtfs-<day>.zip`) and the logged arrivals (data branch `data/ground_truth/arrivals.csv`), gathered with
`experiments/routeknower/E28-scripts/fetch.py`. 27 service days, Oct 10 to Nov 5, 2026 (Oct 18 had no change). Service
days run 04:00 to 04:00 Chicago time. Every file is plain CSV: open it in Google Sheets (File > Import) or Excel.

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

# Where buses linger at the end of a trip or a shift (labeled, one file per service day)

Owner, 2026-11-06: buses parked in front of Regenstein Library at 11:50 PM still showed on the map as moving buses.
"Identify bus activity at the end of their trip and log their behavior on where they tend to linger which may indicate
they are going to end their shift so that the app doesn't suggest these trips. Log this information in a labeled bus
data file."

Built by `experiments/routeknower/E28-scripts/endofservice.py` (RouteKnower.md E28) from the archived raw position polls
(release assets `raw-polls-<day>`), Passio's prediction updates (`pred-updates-<day>`), each day's timetable
(`gtfs-<day>.zip`) and the logged arrivals (data branch `data/ground_truth/arrivals.csv`). Inputs are gathered with
`experiments/routeknower/E28-scripts/fetch.py`. Service days run 04:00 to 04:00 Chicago time, so the night of Nov 5 to 6
is in `2026-11-05.csv`.

## What one row is

A **dwell episode**: one bus (on a route the app knows, with a fresh report) staying within 80 m of where it stopped
for at least 3 minutes, ended by moving more than 80 m away or by 10 minutes without a report. Short stops at a
station are not episodes. Every layover, break and parked spell of at least 3 minutes is here, so the normal ones
(about 85% of the rows) can be compared with the ones that end a shift.

## Labels (first match wins)

| Label | Meaning | How it is assigned |
|---|---|---|
| `garage_return` | at the operator's garage after serving | within 700 m of 41.820, -87.642 and an arrival in the hour before |
| `parked_never_served` | not serving around this time | no arrival in the hour before and none within 30 min after (or at the garage before a shift); also a bus parked well before its shift (next arrival 30 min to 3 h later, none in the 3 h before) |
| `layover` | a normal wait between trips; the bus serves riders again soon | an arrival within 30 min after the episode ends, and the episode is shorter than 30 min |
| `break` | a long pause between services | served again within 3 h, but the episode lasted 30 min or more, or the next arrival came 30 min to 3 h later (with one in the 3 h before) |
| `end_of_shift` | lingering after its last service | an arrival in the hour before, none in the 3 h after |

"Arrival" means a logged arrival of that vehicle (any route) at a stop at least 200 m from the episode's spot, so the
stop the bus is parked at, or one it passes while leaving, does not count as serving.

## Columns of `<day>.csv`

| Column | Meaning |
|---|---|
| vehicle, route_id, route | Passio vehicle id; the route the bus reported at the end of the episode |
| start, end | Chicago time of the first and last report of the episode |
| duration_min | end minus start |
| lat, lon | centre of the bus's reports |
| spot, spot_m | the named linger spot (nearest stop within 160 m of the spot's centre, the garage, or "Unnamed (lat, lon)") and the distance to its centre |
| had_trip_updates | y = Passio predicted a stop for this bus at some minute of the episode |
| pred_share | share of the episode's minutes with such a prediction |
| future_pred_share | share of minutes with a prediction at least 2 min ahead (Passio expected the bus to move later, not "now") |
| in_listed_hours | y = the route was inside its listed hours (timetable) at the start |
| min_after_last_trip | minutes since the route's listed hours ended (negative = minutes still left in them) |
| last_arrival_min_before, last_arrival_stop | the bus's last arrival before the episode (within 3 h) |
| next_arrival_min_after, next_arrival_stop, next_arrival_route | its next arrival after the episode (within 6 h) |
| next | what happened next: `served` (an arrival within 30 min), `garage` (reached the garage within 60 min first), `feed_dropped` (its reports stopped within 30 min and nothing came for 30 min more), `moved_no_service` (drove on, no arrival within 30 min) |
| next_min | minutes until that happened |
| shown_by_app_min | about how long the app before E28 showed the bus during the episode (core/operating.js and core/offroute.js, approximately) |
| label, evidence | the label and the facts behind it in words |

## The other files

- `linger_spots.csv`: every spot with at least 5 episodes: centre, episodes, bus-hours, median and p90 minutes, counts
  per label, the routes that use it, the clock time episodes start (p10 / p50 / p90, service-day clock) and when the
  end-of-shift ones start, and how many non-layover bus-hours the app showed there.
- `summary.csv`: per line: episodes and bus-minutes per label, `shown_idle_bus_min` (non-layover minutes the app
  showed, the problem the owner saw) and its per-day average, and how many end-of-shift episodes still had Passio
  predictions.

## Caveats

- Labels come from what happened next, which a phone cannot know. The app uses only what a phone can see at the time
  (web/js/core/idle.js, Kit Idle.swift); its rule and numbers are in RouteKnower.md E28 and docs/ARCHITECTURE.md
  "Idle buses that are not in service".
- Arrivals come from the collector, which misses some stops (docs/DATA-GUIDE.md coverage) and had gaps (Oct 28
  7:31 to 8:11 PM, Nov 5 10:39 AM to 12:39 PM: no polls, so no episodes then). A missed arrival can turn a layover into
  a break or an end of shift.
- After about 00:05 the feed lists no bus at night, although the night routes are listed until 4:25 to 4:29 AM. A bus
  that leaves the feed is `feed_dropped`; whether service went on without GPS cannot be told.
- Passio keeps predicting buses that are parked for good (they get the next trip), so `had_trip_updates = y` does not
  mean the bus was about to serve.
- `min_after_last_trip` uses the listed hours; Central is listed to 11:14 PM on weekdays but its buses serve until
  about 11:50 PM, Midway Metra and Friend Center/Metra often run past their listed end.

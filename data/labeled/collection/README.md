# Collection issues per line: is the data we collect complete and right for this line? (labeled)

Owner, 2026-11-13: "Run a data collection check recording bus line issues."

Built by `tools/collection_flags.py` (stdlib; tests `tools/test_collection_flags.py`, run by
`.github/workflows/collector-tests.yml`). It measures, per service day (04:00 to 04:00 Chicago time) and per line, how
complete and how right the **collected** data is: the data branch's `data/ground_truth/arrivals.csv` and
`predictions.csv` (with `archive/predictions-*.csv`), the archived raw position polls (release assets
`raw-polls-<day>.jsonl.gz`) and each day's timetable (`gtfs-<day>.zip`). Every measure is set against the same measure
over all lines; a behavior every line shares is a fact of the feed, not a flag. The flags go to
`data/labeled/flags/collection_flags.csv` (category `collection`), which `tools/flag_lines.py` merges into the registry
(`data/labeled/flags/flagged_lines.csv`, `docs/FLAGGED-LINES.md`).

What it is not: how good Passio's times are (RouteKnower E31, category `prediction_miss`), how buses behave at
transition times (E30, `transition`) or what the app showed (E32, `display`). Where a measure overlaps one of those, it
measures the all-day collection side, and the flag's `agent_action` says how the two relate.

**First run (2026-11-13): 35 service days, Oct 8 to Nov 11, 2026** (raw polls 33 days from Oct 10; predictions from Oct
12 noon); 107,275 arrival rows, 2,062,255 fresh position reports, 85,526 stop visits driven past; last 14 days = Oct 29
to Nov 11. **38 flags on 13 lines: 6 high, 20 medium, 12 low** (53rd Street Express has none). The window ends at the
newest raw-polls day in the folder (`--to` to choose; the archive builds a day about noon the next day). Without a
predictions file in the folder `no_passio_time` is skipped.

Unofficial analysis of the public Passio feed; not a statement by the operator or the University. Official service
information: 773.702.8181.

## The measures

| Measure | What is counted (numerator / denominator) | Source | All lines, all days |
|---|---|---|---:|
| `gps_only_rows` | rows the GPS sweep logged alone (`source = gps`: Passio's next stop for the bus was frozen or wrong; no Passio time, previous stop, segment or dwell; `trip_id` blank when frozen) / rows | arrivals | 8.8% |
| `feed_skipped_stops` | rows for stops Passio's feed never named as the next stop (`source = pass`, timed at the closest approach) / rows | arrivals | 7.9% |
| `no_passio_time` | non-gps rows with no row in predictions.csv at any lead (same bus and stop within 60 s), since Oct 12 noon / those rows | arrivals, predictions | 11.9% |
| `trip_not_in_timetable` | non-gps rows whose `trip_id` is not a trip of that line in the day's `trips.txt` / non-gps rows with a trip id | arrivals, gtfs | 0% |
| `double_logged_visits` | rows repeating the bus's previous row at the same stop within 15 min (one visit logged twice; the merge dedupes only within 5 min) / rows | arrivals | 0.06% |
| `rows_outside_hours` | rows more than 15 min after the end or 30 min before the start of the line's listed hours (E30's pads), or on a day it is not listed / rows | arrivals, gtfs | 0.7% |
| `thin_line_days` | listed days with under half the line's median rows for that weekday (median 20 or more; db_audit.py's rule) / listed days | arrivals, gtfs | 1.3% |
| `stops_missed` | stop visits a bus drove past with no row of that bus at that stop within 10 min / visits | raw polls, arrivals | 0.45% |
| `row_time_off_gps` | logged visits whose row is more than 2 min from every point where the GPS track passed the stop / logged visits | raw polls, arrivals | 0.54% |
| `wrong_line_label` | bus-minutes a bus labeled with the line drove another line's route (below) / the line's labeled bus-minutes | raw polls | 1.6% |
| `service_under_other_label` | bus-minutes the line's route was driven by a bus labeled with another line / the line's labeled bus-minutes | raw polls | 1.6% |
| `listed_time_no_bus` | listed 10-min bins with no bus of the line reporting or logged (and its route not driven under another label) / listed bins while the collector polled and the feed had other buses | raw polls, gtfs | 7.8% |
| `report_gaps` | bus-minutes in report gaps over 2 min while the bus drove on (200 m or more) and the feed had other buses / labeled bus-minutes | raw polls | 1.8% |
| `frozen_gps` | bus-minutes in frozen-position runs (E30's rule: 5 or more reports over 5 min or more at identical coordinates while really moving) / labeled bus-minutes | raw polls | 0.27% |
| `stops_rarely_logged` | stops of the line's route order that its buses come within 120 m of (median of each day's closest approach) but that get under a quarter of the line's median rows per stop / the line's stops | raw polls, arrivals, gtfs | 2 of 158 |
| `listed_stops_not_driven` | the same rows test for stops the buses do **not** come within 120 m of on most days / the line's stops | raw polls, arrivals, gtfs | 2 of 158 |

How the raw-poll measures read the polls:
- **Fresh reports** only (the report at most 300 s older than the poll that listed it), deduped on bus and report time;
  a bus's **labeled bus time** is the sum of its report-to-report steps under one label, each up to 10 min.
- **A stop visit driven past** (`stops_missed`, `row_time_off_gps`): two consecutive reports of one bus under the same
  label, at most 60 s apart and at least 15 m apart, whose line comes within 40 m of a stop of that label's route order
  (without a variant's own stops, which count only when Passio names them), moving in the route's direction there, and
  not starting inside the circle (the collector's own pass rule, `arrival_detector._hits`); inside the line's listed
  hours (with E30's pads) and outside the bus's wrong-label episodes. Hits of one bus at one stop within 15 min are one
  visit (every line's lap is longer: the 5th percentile is 16 to 39 min). Logged = a row of that bus at that stop within
  10 min (under any line: `logged_other_line` when only under another).
- **Wrong label** (`wrong_line_label`, `service_under_other_label`): DC-024's test on the whole day (E30 measures it only
  inside transition windows): a bus's moving reports (2 m/s, or 15 m since its last report) per 10-min clock bin against
  every drawn line (within 40 m, `shapes.json`); a bin is off its label with 15 or more moving reports, under 30% of them
  on the label's line and 85% or more on one other line; off bins of one label up to 20 min apart merge; 3 or more bins
  (30 min) make an episode.
- **Closest approach** (the two stop measures): per day the smallest distance between a stop and the line of two
  consecutive reports of the line's buses (up to 500 m), the median over the days the stop was listed.

## Severity rule (collection)

**ratio** = the line's rate / all lines' rate in the same period; **excess** = the line's rate - all lines' (points);
**n** = the measure's denominator; **events** = its numerator in whole events (rows, visits, bins, episodes, gaps, frozen
runs, days); **days over** = service days whose own rate is at least the grade's ratio x the period's all-lines rate (a
day needs 20 rows, 10 visits, 6 bins or 60 bus-minutes of the denominator to count). Each line and measure is graded on
**all collected days** and on the **last 14 service days**; the higher grade wins (`value`, `baseline`, `n`, `data_from`
come from that period; the `note` gives both).

| Grade | ratio | excess (points) | n | events | days over | meaning |
|---|---:|---|---:|---:|---:|---|
| **high** | >= 2 | the measure's high excess | >= 300 | >= 30 | >= 3 | the collected data for this line is wrong or incomplete enough that a model trained on it or a checkup reading it is misled, on 3 or more service days |
| **medium** | >= 1.5 | the medium excess | >= 100 | >= 10 | >= 3 | a real difference a model or checkup must slice |
| **low** (`watch`) | >= 1.25 | the low excess | >= 30 | >= 5 | >= 2 | a small difference to recheck |

Minimum excess (high / medium / low, points), so that a tiny share twice a tinier one is no flag: `gps_only_rows`,
`feed_skipped_stops`, `no_passio_time` 10 / 5 / 2; `trip_not_in_timetable`, `rows_outside_hours` 5 / 2 / 1;
`double_logged_visits` 1 / 0.5 / 0.2; `thin_line_days` 10 / 5 / 3; `stops_missed`, `row_time_off_gps` 5 / 3 / 1.5;
`wrong_line_label`, `service_under_other_label` 2 / 1 / 0.5; `listed_time_no_bus` 10 / 5 / 2; `report_gaps` 2 / 1 /
0.5; `frozen_gps` 1 / 0.5 / 0.25.

Exceptions: `thin_line_days` is at most **medium** (n is the number of listed days; medium on 10 days and 3 thin days,
low on 5 and 2). The two stop measures are whole-period counts, not rates: `stops_rarely_logged` is **high** when a stop
the buses come within 120 m of gets under a tenth of the line's median rows on 7 or more listed days, else **medium**;
`listed_stops_not_driven` is **low** (`watch`: nothing is wrong with the collection, the rows are not expected).
Status: `open` for high and medium, `watch` for low.

The scope says where the events concentrate: `stops` = up to 6 stops whose own rate is at least 1.5 x the line's and 5
points more on 20 or more rows or visits, when together they hold a quarter of the line's events (else the issue is
line-wide); `hours` = the fewest clock hours holding 60% of the events (at most 6); `vehicles` = up to 3 buses holding
60%; `days` = weekday or weekend when 90% fell there; `dates` = the thin days.

## Files

| File | One row per | What for |
|---|---|---|
| `line_days.csv` | service day x line | every measure's numerator and denominator (sum them over any days you like) |
| `line_summary.csv` | period (`all`, `recent`) x line (and `ALL`) x measure | the rates, baseline, ratio, excess, events, days over each grade's ratio and the grade |
| `stop_coverage.csv` | period x line x stop | visits driven past, logged, logged under another line, missed, rows off the GPS pass, rows, the line's median rows per stop, days listed, closest approach, gps / pass rows, rows without a Passio time, `hotspot` (`missed`, `no_passio_time` = 75% or more of 30+ rows, `rarely_logged`, `not_driven`) |
| `wrong_label_episodes.csv` | wrong-label episode | service_day, vehicle_id, label_route_id / label_route (the label Passio gave), driven_route_id / driven_route (the line the GPS drove), start, end (Chicago), minutes, rows_filed_under_label (rows the collector filed under the label meanwhile) |
| `missed_visits.csv.gz` | stop visit with no row | service_day, local_time (the first pass, Chicago), vehicle_id, route_id, route, stop_id, stop |
| `run.txt` | key=value | the window, counts, fleet facts and the number of flags |

`line_days.csv` columns: `service_day, dow, route_id, route`; rows: `rows, gps_rows, pass_rows, pred_target_rows,
nopred_rows, trip_rows, trip_bad_rows, trip_unknown, trip_other_route, double_rows, hours_rows, outside_rows,
listed_day, weekday_median, thin_day`; raw polls: `online_min` (labeled bus-minutes), `visits, visits_logged,
visits_other_line, visits_missed, visits_row_off, wrong_label_min, wl_episodes, wrong_label_rows, other_label_min,
ol_episodes, listed_bins, listed_nobus_bins, listed_other_label_bins` (listed bins whose route was driven under another
label, not counted as no bus), `listed_feed_silent_bins` (listed bins with no bus at all in the feed: Passio's empty
feed, a fleet fact), `gap_min, gaps, frozen_min, frozen_runs`.

## What the first run found (2026-11-13)

Clean, every line (facts, no flag): every non-gps row's trip id is a trip of its line in that day's timetable; no
fresh report had an empty or unknown route id (2,062,255 reports); 99.55% of the stop visits the GPS track drove past
have a row (every line 98.8% or more); visits logged twice 0.06%. The GPS sweep is doing its job: what is left are
stops outside its 40 m radius, buses under the wrong label, and what Passio's feed leaves out.

- **South**: `feed_skipped_stops` **high** (38.0% of its rows are stops Passio never named, all lines 7.9%: the night
  line skips unrequested stops), `stops_rarely_logged` **high** (Logan Center 8589: 20 rows against a median of 437,
  the buses pass 53 m away), `gps_only_rows` medium (15.9%), `listed_stops_not_driven` low (59th St & Metra 8658 and
  Stony Island Parking Lot 8624, 222 and 334 m off the path), `listed_time_no_bus` low (9 to 10 PM, midnight).
- **Regents Express**: `stops_rarely_logged` **high** (Regents Park Apartments 8578: 2 rows against 136, 71 m),
  `feed_skipped_stops` **high** (last 14 days 19.4%, Regenstein Library 8633), `gps_only_rows`, `listed_time_no_bus`
  (5 to 7 PM, its first trips under another label), `rows_outside_hours` (9 to 10 PM) medium; `no_passio_time`,
  `thin_line_days` (Oct 20, Nov 2) low.
- **Red Line/Arts Block**: `gps_only_rows` **high** (26.0%, last 14 days 29.5%; buses 4331 and 4315: frozen trip
  assignments, DC-003), `row_time_off_gps` low (Garfield Red Line Station EB 69624), `wrong_line_label` low.
- **Downtown Campus Connector**: `no_passio_time` **high** (23.8%, last 14 days 36.5%: the four downtown stops with no
  Passio time since Oct 27, DC-025, and 59th & Ellis), `feed_skipped_stops`, `report_gaps` and `frozen_gps` medium (bus 12647: the
  sparse reporter of DC-023 and E30), `listed_time_no_bus` low (10 PM to midnight).
- **Apostolic/Drexel and Friend Center/Metra**: the 5 PM handover (DC-024): Apostolic/Drexel `wrong_line_label` medium
  (3.9%; 4331, 6 to 8 PM; 359 rows filed under it meanwhile) and `service_under_other_label` medium; Friend Center/Metra
  `service_under_other_label` medium (6.6%), `wrong_line_label` low; Friend Center/Metra `listed_time_no_bus` medium
  (weekends 4 to 8 PM: the timetable lists it every day, it runs weekdays only). Apostolic/Drexel `report_gaps` low.
- **Midway Metra**: `wrong_line_label` medium (4.1%: its bus on Red Line, Apostolic/Drexel or the Connector after 6:55 PM
  and mornings), `listed_time_no_bus` medium (10 AM to noon: the listed late morning without a bus).
- **Central**: `gps_only_rows` medium (18.4%), `rows_outside_hours` medium (4.9%, 11 PM to midnight: the nightly
  bus after the listed end), `report_gaps` low (bus 4322).
- **North and East**: `no_passio_time` medium (North 19.1%, last 14 days 31.9%; East last 14 days 26.4%; the first
  stops Regenstein Library, Max Palevsky, Ellis Garage: Passio gives them the next trip's id, DC-025); East
  `report_gaps` and `service_under_other_label` low.
- **Drexel**: `rows_outside_hours` medium (last 14 days 4.3%, 10 AM to 1 PM: the bus after the 10:15 AM end).
- **Apostolic**: `listed_time_no_bus` low (last 14 days, 5 to 6 AM: mornings with no Apostolic bus, DC-025 / DC-026).
- **South Loop Shuttle**: `feed_skipped_stops` and `no_passio_time` medium (small: 275 rows on 10 days).
- Bus **4322** carries the report gaps of three lines (Apostolic/Drexel, Central, East): the gaps follow the bus.

## For other agents

- **Model and scoring agents**: read every active `collection` flag of a line before training on or scoring it. Leave
  the rows of `wrong_label_episodes.csv` out of the label line's training labels (they are visits of the line driven);
  never read a `gps` row's empty Passio time, dwell or previous stop as zero; a line with `no_passio_time` scores Passio
  on fewer, non-random rows (slice by stop); stops in `stops_rarely_logged` have almost no ground truth (the rows are
  missing, not the service). Never drop flagged rows from the **test** rows: riders were there.
- **Checkups** (`monitoring.md`, `docs/DATA-COLLECTION-LOG.md`): a line-day under its median is expected on a flagged
  line and hour (Friend Center/Metra weekends, Midway Metra late mornings, the handover evenings); a new line in a
  flag, or a high flag whose number moves a lot, is worth a DC entry. `stops_rarely_logged` is a detector gap (DC-027):
  a detector change to log those stops is a replay, the owner's call.
- **App agents**: nothing here changes what the app shows; a flag is evidence, the owner decides.

## Refresh

```
python experiments/routeknower/E28-scripts/fetch.py --out <dl> --from 2026-10-10 --to <newest archived day>
git fetch origin data                             # E28 does not copy the predictions: take them from the data branch
git show origin/data:data/ground_truth/predictions.csv > <dl>/predictions.csv
git show origin/data:data/ground_truth/archive/predictions-20261029-2232.csv > <dl>/predictions-20261029-2232.csv
python tools/collection_flags.py --dl <dl>        # about 30 s: writes this folder and data/labeled/flags/collection_flags.csv
python tools/flag_lines.py --check-inputs         # the flag file is valid
python tools/flag_lines.py                        # merge into the registry; commit all of them
```

Every Monday the data repo's `findings.yml` (github.com/blobberus/straight-bussing-data, `findings/run_findings.py`)
reruns it on all archived days with E30 and E31 and publishes `findings/flags/collection_flags.csv` there (adopt it here
as the flags README says).

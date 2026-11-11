# Large prediction misses per line: where Passio's live times are far off, and which way (labeled)

Owner, 2026-11-11: "The analysis should check for buses that have odd behavior during transition times and lines that
have large prediction misses. Create or indicate wherever appropriate for another agent to analyze and notice and
account for this data. Flag these lines and also tell me."

Built by `experiments/routeknower/E31-scripts/misses.py` (RouteKnower.md E31). What it scores is Passio's time on
display, the "arrives in N min" Straight Bussing shows riders today: the data branch's
`data/ground_truth/predictions.csv` (plus its older half, `data/ground_truth/archive/predictions-20261029-2232.csv`), one
row per real arrival and lead, against the logged arrival. Each prediction is joined to what the bus was doing (the
daily forecast tables `eta-<day>.csv.gz`, release assets "Prediction data archive"), to the nearest change in the line's
bus count (`data/labeled/transitions/transitions.csv`, E29, then `bus_changes.csv`), and every arrival the collector
logged from Passio's data is a coverage target (`arrivals.csv`, every source but `gps`). For an arrival with no time 5
min ahead, Passio's raw prediction updates (`pred-updates-<day>`) say what a screen showed under another trip id.

**30 service days, Oct 12 (12:20 PM, the first predictions.csv row) to Nov 10, 2026**; 437,521 Passio times (236,889 at
the goal leads), 83,762 coverage targets. Service days run 04:00 to 04:00 Chicago time. Nov 10 has no forecast table yet
(the archive builds it a day later), so its rows have no trip, timetable or delay features ("unknown"). Unofficial
analysis of the public Passio feed; not a statement by the operator or the University. Official service information:
773.702.8181.

## The rules

**Error** = time shown minus the real arrival. Positive = the bus came **earlier** than shown (`bus_early`): a rider who
trusted the time can miss the bus; this is the goal's "too late" side, the dangerous one. Negative = the bus came
**later** than shown (`bus_late`): the rider waits.

**Leads.** The goal's points in predictions.csv: 5 min ahead (the goal measures under 10 minutes ONCE per arrival, here),
10, 15, 20 and 30 min. "Goal leads pooled" (`lead_min` = `goal`) counts each arrival once per lead it has a time at.
1, 2 and 3 min are diagnostics only (in line_summary.csv; never in a flag).

**Large miss.** Off by MORE than twice the owner's allowed error at that lead (`tools/arrivals_lib.py` `shrink_tol`:
1 min under 20 min ahead, 2 min at 20, 3 min at 30), capped at 5 min:

| Lead | Allowed by the goal | Large miss beyond |
|---|---:|---:|
| 5, 10, 15 min (and the 1 to 3 min diagnostics) | 1 min | 2 min |
| 20 min | 2 min | 4 min |
| 30 min | 3 min | 5 min |

Gross misses (E19: more than 10 min or half the lead off) are large misses too and are **not** set aside here (riders saw
them); `gross` counts them. `pass_shrink_rate` and `band_b_rate` are the goal's own tests (gross misses aside, as in
`data/eta/summary.csv`).

**Periods.** `all` = every day; `recent` = the last 14 service days (Oct 28 to Nov 10: what riders see now); `before` =
the days before them (line_summary.csv only). `trend_early` / `trend_late` on the recent rows: `worse` or `better` when
the rate changed by at least 20% (relative) and 2 points from before to recent, else `same`.

**Coverage.** A target arrival is covered at a lead when predictions.csv has a row for the same bus and stop within 60 s
of it at that lead. No time on display is a miss for a rider too; the scores above only judge the times that existed.

**Screen times under another trip id** (`other_trip.py`, DC-025): for an arrival with no own-trip time 5 min ahead, the
earliest time the same bus showed for that stop under any other trip id at that moment (on display by the collector's
own rule, `SHOW_GRACE_S`; first seen after the bus's previous visit to the stop). The collector does not count these
(its attribution rule is unchanged); they are measured only.

**Ranges.** `*_lo` / `*_hi` are the 95% range of the rate from resampling whole service days (2,000 times; days are the
unit of noise, GOAL-AND-METHOD 2.5).

## Files

| File | One row per | What for |
|---|---|---|
| `line_summary.csv` | period x line x lead (1, 2, 3, 5, 10, 15, 20, 30 min and `goal`), plus `ALL` | the per-line rates, ranges, coverage, trend and the rates in each situation |
| `stop_hotspots.csv` | period (`all`, `recent`) x line x stop | the stops that stand out on their line (`hotspot`) |
| `weekly_trend.csv` | line x week (Monday) | better or worse since Oct 12 |
| `slices.csv` | period x line x dimension x value | by lead, hours, day type, prediction age, trip, timetable, delay, bus count change |
| `large_misses.csv.gz` | large miss at a goal lead (154,106 rows) | for another agent to look up episodes, join them to anything |
| `run.txt` | key=value | the window the files were built from (`recent_from` = the first recent day) |

### line_summary.csv

| Column | Meaning |
|---|---|
| period, route_id, route, lead_min | as above; route_id = GTFS id (web/data/routes.json), `ALL` = all lines |
| days, n | service days and Passio times scored |
| targets, coverage | arrivals logged, and the share with a time at that lead (`goal` rows: 5 min ahead) |
| large, large_rate | large misses either way |
| large_early, large_early_rate, large_early_lo, large_early_hi | the bus came more than the threshold EARLIER than shown, with the day range |
| large_late, large_late_rate, large_late_lo, large_late_hi | ... LATER than shown |
| gross, gross_rate | gross misses (E19) |
| pass_shrink_rate, band_b_rate | the goal (the 10 minute shrink) and band B (allowed error early to 1% of the lead late), gross aside |
| too_late_rate | shown more than 1% of the lead later than the bus came (the goal's too late, reading B), of all |
| median_err_min, p90_abs_err_min | median error (negative = bus later) and the 90th percentile of the size, minutes |
| early_ratio_vs_all, late_ratio_vs_all | the line's rate / all lines' in the same period and lead |
| share_of_all_large_early, share_of_all_large_late | the line's part of all such misses |
| before_large_early_rate, before_large_late_rate, trend_early, trend_late | recent rows: the rates before the last 14 days and the trend |
| n_near_transition, large_rate_near_transition, large_rate_away_from_transition | shown within 30 min of a bus count change on the line (E29 events: a lasting leave or a join that is not a layover's end) or not |
| n_no_timetable, large_rate_no_timetable | trips with no timetable time (forecast table `tt_epoch` blank; the registry's `trips=no_timetable`) |
| n_behind10, large_rate_behind10 | the bus more than 10 min behind the timetable at its last stop (`delay_s` > 600) |
| n_next_trip, large_rate_next_trip, large_rate_current_trip | the stop on the bus's next run vs its current run |
| features_known | share of the rows joined to a forecast-table row (0 on Nov 10) |

### stop_hotspots.csv

`period, route_id, route, stop_id, stop, stop_index` (`|` = a stop the line serves twice), `days, n` (goal-lead times),
`large_rate, large_early_rate, large_late_rate, median_err_min`, `n_5, large_early_rate_5, large_late_rate_5` (5 min
ahead only), `line_large_early_rate, line_large_late_rate, line_coverage_5` (the line's, same period), `targets,
coverage_5, coverage_any` (a time 5 min ahead / at any lead), `no_time_5` (arrivals with no time 5 min ahead),
`screen_other_trip_5, screen_other_trip_early, screen_other_trip_late` (of those, a screen showed another trip id's time,
and how many of those times were large misses each way), `hotspot`: `|`-joined reasons, `large_early` / `large_late`
(rate at least 1.5 x the line's and 2 points more, on 50+ goal-lead times), `no_time` (a time 5 min ahead for under 25%
of 30+ arrivals), `other_trip_times` (for 20%+ of 30+ arrivals the screen's only time was another trip id's).

### weekly_trend.csv

`route_id, route, week` (the Monday), `days, n, large_rate, large_early_rate, large_late_rate, pass_shrink_rate,
median_err_min` (goal leads pooled), `n_5, large_early_rate_5, large_late_rate_5` (5 min ahead), `targets, coverage_5`.

### slices.csv

`period, route_id, route, dimension, value, n, large_rate, large_early_rate, large_late_rate, median_err_min,
line_large_rate`; goal leads pooled. Dimensions: `lead_min`; `hours` (the Chicago hour of the moment the time was shown:
10 PM to 5 AM, 5 to 7 AM, 7 to 10 AM, 10 AM to 3 PM, 3 to 7 PM, 7 to 10 PM); `day_type`; `prediction_age` (how old the
shown prediction was then); `trip` (current / next); `timetable`; `delay`; `bus_count_change` (within 30 min or not).

### large_misses.csv.gz

| Column | Meaning |
|---|---|
| service_day, local_time | the service day and the arrival (Chicago) |
| route_id, route, stop_id, stop, vehicle_id, trip_id | as in predictions.csv |
| lead_min | 5, 10, 15, 20 or 30 |
| predicted, actual | the time shown and the arrival, UTC epoch seconds |
| error_min | predicted minus actual, minutes (positive = the bus came earlier) |
| direction | `bus_early` or `bus_late` |
| near_transition_min | minutes from the nearest bus count change on the line to the moment shown (negative = still to come), blank if none within 60 min; `transition_kind` = leave / add |
| no_timetable, behind_min, next_trip | from the forecast table (blank = unknown, e.g. Nov 10) |
| gross | 1 = also a gross miss (E19) |
| pred_age_s | how old the shown prediction was at that moment |
| shown_at | the moment the time was on display (Chicago) |

## Flags: `data/labeled/flags/prediction_flags.csv`

Written by `experiments/routeknower/E31-scripts/flags.py` from these files, in the shared schema of
`data/labeled/flags/README.md` (category `prediction_miss`; `tools/flag_lines.py` merges it into the registry). Rates
are over the goal leads pooled; "the range" is the line's day-bootstrap 95% range.

**Severity rule (E31).**

| Flag | What | high | medium | low (status `watch`) |
|---|---|---|---|---|
| `large_early_miss` | the bus came more than the threshold EARLIER than shown | (rate >= 1.5 x all lines, or >= all lines + 15 points) and the range's low end above all lines, n >= 300 on >= 5 days | the same with 1.25 x / + 10 points | 1.1 x / + 5 points on n >= 100 and >= 3 days, range not required |
| `large_late_miss` | ... LATER than shown | as above | as above | as above |
| `stops_without_predictions` | stops where under 25% of 30+ arrivals had a time 5 min ahead (last 14 days) | under 10% at the flagged stops together, on >= 100 arrivals | any other | |
| `first_stop_next_trip_times` | stop positions 0 to 3 where, for 20%+ of 30+ arrivals, the screen's only time 5 min ahead was another trip id's (last 14 days); value = share of those times that were large misses | >= 50% and above all lines' large-miss rate 5 min ahead, n >= 100 | above that rate, n >= 30 | otherwise |
| `other_trip_times` | the same at later stops | as above | as above | as above |
| `worse_near_transitions` | large-miss rate within 30 min of a bus count change / the rate otherwise on the same line (all days); above the same ratio over all lines | >= 1.5 on >= 300 near | >= 1.25 on >= 100 | >= 1.15 on >= 100 |
| `worse_when_behind` | the same ratio for buses more than 10 min behind the timetable | as above | as above | as above |

`large_early_miss` and `large_late_miss` are judged on the last 14 days and on all days (each against all lines in the
same days); a row keeps the window with the higher severity (the last 14 days on a tie), and its `data_from` and
`metric` say which. Only lines that pass a rule get a row; `first_flagged` is kept across refreshes.

## Refresh (weekly, or after a feed change)

```
# downloads (any folders; Git Bash: MSYS_NO_PATHCONV=1 before git show)
git show origin/data:data/ground_truth/predictions.csv > <dl>/predictions.csv
git show origin/data:data/ground_truth/archive/predictions-20261029-2232.csv > <dl>/predictions-20261029-2232.csv
git show origin/data:data/ground_truth/arrivals.csv > <dl>/arrivals.csv
git show origin/data:data/ground_truth/bus_changes.csv > <dl>/bus_changes.csv
gh release download data-archive-2026-10 -R blobberus/straight-bussing -p "eta-*.csv.gz" -D <dl>/eta    # and -11
gh release download data-archive-2026-10 -R blobberus/straight-bussing -p "pred-updates-*.jsonl.gz" -D <dl>/pu   # and -11
# tables (about 3 minutes), flags, checks
python experiments/routeknower/E31-scripts/misses.py --predictions <dl>/predictions-20261029-2232.csv \
    <dl>/predictions.csv --arrivals <dl>/arrivals.csv --eta-dir <dl>/eta --pred-updates <dl>/pu \
    --bus-changes <dl>/bus_changes.csv [--to YYYY-MM-DD]
python experiments/routeknower/E31-scripts/flags.py
python tools/flag_lines.py --check-inputs
python experiments/routeknower/E31-scripts/test_misses.py
```

Every archive file of predictions.csv goes first in `--predictions` (oldest first; a later file's row wins where they
overlap). `--to` cuts the window (default: the newest day in predictions.csv). Refresh
`data/labeled/transitions/transitions.csv` first (E29 / E30) so the bus count changes reach the same day.

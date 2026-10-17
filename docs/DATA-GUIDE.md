# The shuttle data, in plain English

This guide explains every data file and column for someone who has never seen them, and what the data collected
so far says. No coding needed: the CSV files open in Excel, Google Sheets or Numbers. Numbers in this guide: data
up to **Tuesday, October 13, 2026, 4:20 PM** (collection started Thursday, October 8, 5 AM).

- **How the data is collected**, in a page: **`docs/HOW-DATA-IS-COLLECTED.md`**.
- **The goal** (since October 17 the "10 minute shrink": within 3 minutes at 30 or more minutes ahead, 2 at 20 or
  more, 1 below; before it the 10% rule), how predictions are scored, where each predictor stands and the plan to optimize the
  algorithm: **`docs/GOAL-AND-METHOD.md`**. This guide only refers to it.
- How arrivals are detected, technically: `docs/DATA.md`. A visual overview: `docs/prediction-explainer.html`.

## What exists, and what each file is for

| File | Where | One row is | Use it for | So far |
|---|---|---|---|---|
| `arrivals.csv` | `data` branch of this repo, `data/ground_truth/` | one bus arriving at one stop | the truth: when buses really came | 13,876 rows, Oct 8 to 13 |
| `predictions.csv` | same folder | one arrival x one "how far ahead" (1 to 30 min) | **checking** predictions against the goal | 23,915 rows, Oct 12 12:20 PM to Oct 13 |
| `eta-<day>.csv.gz` | Releases page, "Prediction data archive" | one minute x one bus x one stop it reaches in the next 45 min | **training** a better algorithm | Oct 10, 11, 12 (Passio from Oct 12) |
| `data/eta/summary.csv` | `data` branch | one day x predictor x lead range x route | the daily scoreboard | Oct 10 to 12 |
| `alerts.csv` | `data` branch, `data/ground_truth/` | one version of one announcement by the operator (detour, reduced service, phone help) | explaining odd days and big misses | from Oct 14 (3 announcements in the feed that evening) |
| per-day / per-route copies, `latest.csv` | [github.com/blobberus/straight-bussing-data](https://github.com/blobberus/straight-bussing-data) | as `arrivals.csv` | browsing in GitHub | synced every 30 min |

**Where it comes from:** the shuttles' public live tracking feed (Passio, the same data the official app uses).
A collector checks it every 10 seconds, around the clock (GitHub, with a backup on the owner's PC), and writes a
row each time a bus reaches a stop. The files update about every 40 minutes (the browsing copies every 30). They hold bus positions and times
only: nothing about riders.

## How much, and is every station and line collected?

**Rows per service day** (a service day runs 4 AM to 4 AM):

| Thu Oct 8 | Fri Oct 9 | Sat Oct 10 | Sun Oct 11 | Mon Oct 12 | Tue Oct 13 (to 4:20 PM) |
|---:|---:|---:|---:|---:|---:|
| 3,558 | 3,256 | 815 | 611 | 3,469 | 2,167 |

Weekends are small because only the evening routes (North, South, East, Central; South Loop Shuttle on
Saturdays) run. On weekdays the busiest hours are 7 to 10 AM and 4 to 7 PM.

**Lines:** 14 of the 15 lines in the official timetable have rows. The 15th, "Move In Charter", has no trips
scheduled this term. Rows per line: Apostolic/Drexel 1,791 · 53rd Street Express 1,662 · Downtown Campus Connector
1,530 · Midway Metra 1,487 · Red Line/Arts Block 1,378 · Friend Center/Metra 1,340 · East 1,102 · Central 965 ·
Apostolic 937 · Drexel 653 · North 502 · South 426 · Regents Express 75 · South Loop Shuttle 28.

**Stations:** all **91** stations in the timetable have rows (23 buses, 419 trip numbers so far).

**But not every visit was logged.** Checked against the buses' raw GPS tracks on Monday, October 12 (a bus "drove
past a stop" when its track came within 40 m of it, moving the route's direction):

| Line | Stops buses drove past | Logged by the old collector | Logged since Oct 13 |
|---|---:|---:|---:|
| 53rd Street Express | 429 | 99% | 99% |
| Apostolic/Drexel | 551 | 97% | 99% |
| North | 90 | 90% | 97% |
| East | 206 | 93% | 97% |
| Drexel | 187 | 91% | 95% |
| Midway Metra | 474 | 93% | 95% (+ its afternoon stop, below) |
| Apostolic | 203 | 92% | 94% |
| Friend Center/Metra | 391 | 91% | 93% |
| South | 161 | **48%** | **88%** |
| Downtown Campus Connector | 449 | 70% | 84% |
| Central | 191 | 76% | 79% |
| Regents Express | 45 | 53% | 67% |
| Red Line/Arts Block | 581 | 57% | 62% |
| **All lines** | **3,958** | **83%** | **88%** |

On Sunday (evening lines only) the same check gives 74% before and 88% after; South 54% to 88%.

What was wrong, and what changed on October 13:
- The collector used to log only the stops Passio's feed named as each bus's "next stop". **Passio skips
  stops** (night lines skip stops nobody requested; on the Red Line one step in five jumps over a stop), renames
  Red Line trips in the middle of a lap, and sometimes moves on 150 m before the bus reaches a stop. Since October
  13 the collector also logs a stop when the **GPS track itself** goes past it (source `pass`, below). Every such
  row is backed by the track, and arrival times of the other rows did not change.
- **Midway Metra's afternoon loop** (from 3:30 PM, 20 of 46 weekday trips) runs through **57th St. & Metra
  (NB)**, which the morning loop does not serve. That stop had no Midway Metra rows at all; its afternoon visits
  were logged at 57th St. & Metra (SB), 27 m across the street. Both are fixed.
- **Still missing:** buses whose feed entry freezes (Passio's "next stop" and trip number stay the same for an
  hour or more while the bus drives), or that Passio lists under the wrong route. About 60 bus-hours of that on
  Monday, mostly the Downtown Campus Connector and the Red Line, which is why the Red Line is still at 62%. This
  needs a matcher that works out from the GPS alone which route a bus is driving. The raw GPS is archived every day,
  so those days can be redone later.

## `arrivals.csv`: the 25 columns

**What one row is:** one bus arriving at one stop. If bus 4315 on the East route reaches Hyde Park Places Apts at
9:15 PM, that is one row. **How accurate:** arrival times are good to about 10 seconds either way (GPS is off by a
few metres and the feed reports every 10 seconds or so).

### When the bus arrived

| Column | What it means | Example |
|---|---|---|
| `epoch` | The arrival time as one number: seconds since January 1, 1970 (a standard computer time). Handy for sorting or subtracting. You can use `local_time` instead. | `1791684942` |
| `ts_utc` | The same moment in UTC (world time; `Z` = UTC). Chicago is 5 hours behind UTC in summer, 6 in winter. | `2026-10-11T02:15:42Z` |
| `local_time` | The same moment on a Chicago clock. **The column most people want.** | `2026-10-10 21:15:42` (9:15:42 PM) |
| `dow` | Day of the week: **0 = Monday** ... 6 = Sunday. | `5` (Saturday) |
| `hour` | Hour on a Chicago clock, 0 to 23. | `21` |
| `minute_of_day` | Minutes since midnight, Chicago time. 720 = noon. | `1275` |

### Which bus

| Column | What it means | Example |
|---|---|---|
| `route_id` | The route's number in the public timetable. Use it to tell routes apart; names can change. | `1077` |
| `route_name` | The route's name, as riders know it. | `East` |
| `trip_id` | The feed's number for one run of the route. Caveats: the feed changes a bus's trip number in the middle of a run (Red Line: up to twice a lap), reuses numbers, sometimes names an earlier scheduled run than the one the bus drives, and gives every Downtown Campus Connector bus the same one (`874028`). Use it together with `vehicle_id`. | `501697` |
| `vehicle_id` | The bus. The same bus keeps its ID all day, even when it switches routes. | `4315` |

### Which stop

| Column | What it means | Example |
|---|---|---|
| `stop_id` | The stop's number in the public timetable. | `140014` |
| `stop_name` | The stop's name, as shown in the apps. | `Hyde Park Places Apts` |
| `stop_address` | Nearest street address (from OpenStreetMap; sometimes just a street). | `South Hyde Park Boulevard` |
| `stop_lat`, `stop_lon` | The stop's map position. Paste `41.7942, -87.58402` into any map app. | `41.7942`, `-87.58402` |
| `stop_index` | Where the stop sits in the route's order, **counting from 0**. On a loop, the last number means "back at the first stop". **Midway Metra from October 13 on:** its afternoon stop 57th St. & Metra (NB) is 14, so the end of its loop (SB) is 15 (it was 14 before). | `9` (the 10th stop) |

### The drive from the previous stop

Blank when there is no trustworthy previous arrival of the same bus on the same run (first stop seen, previous one
more than 25 minutes earlier, or the bus was logged on another run in between): **9% of rows**.

| Column | What it means | In the data so far | Example |
|---|---|---|---|
| `prev_stop_id` | The stop this bus arrived at just before. Usually the previous stop on the route; stops can be skipped. | | `140013` |
| `prev_arrival_epoch` | When it arrived there. | | `1791684926` |
| `dist_prev_m` | Metres driven between the two stops, along the route's streets (divide by 1609 for miles). | median 380 m; 1 in 10 over 1.6 km | `155.8` |
| `segment_s` | **Seconds** from arriving at the previous stop to arriving here, including any wait at the previous stop. | median 97 s; middle 80% from 26 s to 7 min | `16` |
| `speed_mps` | Average driving speed between the two stops, in metres per second, not counting the wait at the previous stop (x 2.237 = mph). Blank if impossibly fast (10% blank). | median 5.0 m/s = **11 mph**; slowest tenth under 5 mph, fastest tenth over 18 mph | `9.74` (22 mph) |

### At the stop

| Column | What it means | In the data so far | Example |
|---|---|---|---|
| `dwell_s` | Seconds the bus stood at this stop. **0 = drove past without stopping.** Blank = unknown (5%). | **61% of visits are 0** (no one waiting or getting off); when a bus does stop, a median 25 s; 5% of visits are a minute or more (layovers, timed stops) | `0` |

**For the goal:** Passio's far predictions assume buses never stop (GOAL-AND-METHOD section 4). These dwell times
are what a better algorithm adds back.

### What the official app predicted (2 minutes ahead)

| Column | What it means | Example |
|---|---|---|
| `passio_pred_epoch` | When the official feed predicted this bus would arrive here, from a prediction made **at least 2 minutes before** it did. Blank if there was none (7% of rows since October 10). | `1791684889` |
| `passio_pred_lead_s` | How many seconds before the arrival that prediction was made: **always 120 or more, on purpose**. See below. | `153` |

#### Reading the prediction lead (`passio_pred_lead_s`)

**What the feed does.** While a bus drives toward a stop, the feed publishes a predicted arrival time and refreshes
it about once a minute. So one arrival has many predictions (6 minutes before, 3 minutes before, 20 seconds
before...).

**Which one this file keeps.** The newest prediction that was **already at least 2 minutes old** when the bus
arrived: about the time it takes to walk to a stop, so it is the one a rider planned with. `passio_pred_lead_s` is
how long before the arrival it was made, so never under 120. Minus 120, it is how old the feed's prediction was at
the 2-minute mark.

**In the data so far** (rows since the collector fixes of October 10, 5:18 AM; 7,062 rows): half of the leads are
under **177 seconds** (the feed's prediction was about a minute old at the 2-minute mark); 52% are under 3 minutes;
**9% are 5 minutes or more**, which means the feed had stopped updating that bus (a feed failure, not a long-range
forecast).

**"The lead is longer than the drive from the previous stop: did the app miss its chance?"** No. In 72% of rows
the lead is longer than `segment_s`. That only means the kept prediction was made while the bus was still 2 or more
stops away. The feed kept updating afterwards; those later, easier predictions are just not stored here, on
purpose. **What a missed chance looks like:** a blank `passio_pred_epoch`, or a lead well over 3 minutes.

**How good it was** (rows since October 10, leads under 5 minutes):

| Lead | Rows | Within 1 minute | Average miss | Bus came later than shown (median) |
|---|---:|---:|---:|---:|
| 120 to 129 s (fresh) | 407 | 73% | 52 s | 37 s |
| 130 to 149 s | 1,048 | 68% | 54 s | 40 s |
| 150 to 179 s | 1,980 | 59% | 68 s | 47 s |
| 180 to 239 s | 2,282 | 46% | 89 s | 63 s |
| 240 to 299 s | 222 | 31% | 175 s | 91 s |

Overall 55% within 1 minute. **The bus came later than shown 88% of the time** (median 51 s later); it came more
than a minute *earlier* than shown only 3% of the time. Weekends were easier than weekdays: within 1 minute 72%
(Sat) and 70% (Sun), but 55% (Mon) and 46% (Tue), with the median "later than shown" growing from 32 s to 63 s.

**For the goal:** this column only covers the 2-minute mark. Predictions 1 to 30 minutes ahead are in
`predictions.csv`.

### How we know

| Column | What it means | Example |
|---|---|---|
| `source` | How the arrival was detected. **`transition`**: the feed's "next stop" for this bus moved past this stop; the time is when the bus actually passed it (69% of rows so far). **`proximity`**: the bus was seen standing within 40 m of the stop (31%). **`pass`** (new, from October 13, about 5 PM): the feed never named this stop, but the bus's GPS track went past it within 40 m in the route's direction; the time is its closest approach. The replay suggests about 7% of weekday rows and 17% of weekend rows will be `pass`. All three are real arrivals. | `transition` |

## `predictions.csv`: what Passio showed 1 to 30 minutes ahead

For each arrival, **one row per "how far ahead"**: what the official feed was showing 1, 2, 3, 5, 10, 15, 20 and 30
minutes before the bus arrived. The arrivals file is unchanged. This is the file that checks the goal (scoring
rules: GOAL-AND-METHOD section 2).

| Column | What it means | In the data so far |
|---|---|---|
| `epoch` ... `stop_index` | The arrival, exactly as in the arrivals file (to find its row: same `vehicle_id` and `stop_id`, `epoch` within a few seconds). | 4,152 arrivals have at least one row: 98% of those logged since Oct 12, 12:20 PM |
| `lead_target_s` | How far ahead this row looks, in seconds: 60, 120, 180, 300, 600, 900, 1200 or 1800. | |
| `pred_epoch` | The time the feed was showing at that moment (its newest prediction then). | |
| `pred_made_epoch` | When the feed made that prediction. | |
| `pred_lead_s` | How long before the arrival it was made. Never under `lead_target_s`; the difference is how old the prediction already was. | at every lead, the shown prediction was a median **67 s old** (the feed refreshes about once a minute) |
| `pred_minus_actual_s` | **Predicted minus real arrival time, in seconds. The number the goal judges.** Positive = the prediction was too late (the bus came early: riders can miss it). Negative = the bus came later than shown (riders wait). | mostly negative: see the table below |
| `pred_seen_epoch` | When our collector first saw that prediction. The feed sometimes changes a predicted time without updating its timestamp; a prediction counts from when it actually appeared. Blank on the first 312 rows (Oct 12 before about 1 PM). | |

**How far ahead the feed shows anything at all** (share of arrivals with a row at that lead): 1 min 87% · 2 min
85% · 3 min 84% · 5 min 81% · 10 min 76% · 15 min 71% · 20 min 60% · **30 min 21%**. The feed predicts the
bus's current trip and its next one, never two ahead, so 30 minutes ahead it usually has nothing yet. **A missing
row is information:** nothing was on display then.

**What the errors look like** (huge errors set aside as GOAL-AND-METHOD 1.3 defines; median error, and the range
of the middle 80%):

| Lead | Rows | Median error | Middle 80% of errors | Bus later than shown | Huge errors set aside |
|---|---:|---:|---|---:|---:|
| 1 min | 3,671 | 41 s later | 102 s later to 3 s early | 88% | 1% |
| 2 min | 3,603 | 58 s later | 150 s later to on time | 90% | 1% |
| 5 min | 3,416 | 1.9 min later | 5 min later to 12 s later | 91% | 2% |
| 10 min | 3,222 | 2.9 min later | 7 min later to on time | 90% | 5% |
| 15 min | 3,012 | 3.0 min later | 7.7 min later to on time | 90% | 11% |
| 20 min | 2,543 | 3.4 min later | 8.4 min later to on time | 90% | 18% |
| 30 min | 902 | 6.4 min later | 12 min later to 2 min later | 97% | 33% |

The same error by line, 10 minutes ahead: North shows times closest to reality (median 30 s later), Friend
Center/Metra 1.5 min, East 2.5 min, 53rd Street Express 2.9 min; Red Line/Arts Block is furthest off (4.9 min
later), with Regents Express (5.8 min, few rows).

**What the huge errors 15 to 30 minutes ahead are** (we looked, as asked): almost all are buses that came **much
later** than shown (of 1,065 set aside at 15 to 30 minutes, 24 were early). Two causes:
1. **The bus left the end of its line or the garage 10 to 25 minutes after the printed departure** Passio
   assumed (driver breaks; most often Apostolic/Drexel at Drexel Garage, the Red Line, the Downtown Campus
   Connector). Real, and riders saw it.
2. **At 30 minutes ahead, about half were a lap mix-up**: the same bus did pass the stop near the predicted time,
   but under another trip number, and the row was matched to the visit a lap later. Since 2026-10-16 the
   collector never pairs a prediction about the bus's previous visit with the next lap, and Oct 12 to 15 were
   rebuilt (558 rows removed, DC-011 in docs/DATA-COLLECTION-LOG.md), so these rows are gone; the far misses left
   are what Passio really showed. The numbers in this section are from before that rebuild.

**Checking a row against the goal in a spreadsheet** (the 10 minute shrink):
`=ABS(pred_minus_actual_s) <= IF(lead_target_s >= 1800, 180, IF(lead_target_s >= 1200, 120, 60))`. The old 10% rule:
`=ABS(pred_minus_actual_s) <= 0.1 * lead_target_s`.

## `alerts.csv`: what the operator announced

The shuttle operator posts announcements in the same live feed ("the North route will run every 30 minutes",
detours, stop closures, a phone number for help). They explain days when buses ran unusually, so a big prediction
miss on those days is not necessarily the algorithm's fault. The collector checks the announcements **every 5
minutes** and keeps **one row per version**: when the wording, the time window or the routes change, a new row
starts; while nothing changes, the same row's "last seen" time just moves on. The text is the operator's, word for
word (including their own names, such as "UGo").

| Column | What it means | Example |
|---|---|---|
| `alert_id` | The feed's number(s) for the announcement, separated by `;`. **The number is only its place in the feed's list**: it changes when an announcement above it ends (so one announcement can show `1;2`), and numbers are reused for unrelated announcements. Use `version` to tell announcements apart. | `1;2` |
| `version` | A short code for this exact wording, time window and route list: one row per version. | `f7acfe751f53` |
| `first_seen`, `last_seen` (+ `_local`) | The first and last time our collector saw this version in the feed (seconds since 1970, and the same on a Chicago clock). Good to about 5 minutes: it was taken down within about 5 minutes after `last_seen`. | `2026-10-14 17:56:24` |
| `active_start`, `active_end` (+ `_local`) | When the operator says it applies. Blank = no limit on that side (or no window given: always). | `2026-10-14 15:55:00` to `2026-10-15 00:00:00` |
| `active_periods` | All the windows, if there are several, as `start/end` separated by `;`. | `1792011300/1792040400` |
| `cause`, `effect` | The operator's category, if it sends one (it has not so far). | blank |
| `agency_ids` | `1068` means the announcement is about the whole shuttle system. | `1068` |
| `route_ids`, `route_names`, `stop_ids` | Which routes or stops it names, separated by `;`. **Careful:** the feed sometimes uses its own route numbers, not the timetable's (the North announcement on October 14 said `38734`; North is `1075` everywhere else), so `route_names` is blank there. | `38734` |
| `header`, `description` | The announcement's title and text, word for word. | `North Route` / `The North route will run every 30 minutes throughout the evening.` |

**Good to know:** an announcement that was up for less than 5 minutes, or while the collector was down, can be
missing. The first rows of October 14 have `first_seen` = when collection began, not when the operator posted them
(`active_start` shows that). The day's announcements are also kept with the daily files on the Releases page
(`alerts-<day>.csv.gz`).

## The training table: `eta-<day>.csv.gz`

On the main repo's Releases page ("Prediction data archive", one release per month), one file per finished day
(about 6 MB zipped for a weekday; open with any unzip tool, or directly in Python or R). **One row = one minute, one
bus, and one stop that bus later reached within the next 45 minutes.** So one arrival appears up to 45 times, once
for each minute before it: exactly what is needed to learn "how good is a prediction 6, 10 or 30 minutes ahead".
October 10 and 11 have the timetable predictors only; the feed's prediction log starts October 12 (from 12:20 PM
that day).

| Column | What it means |
|---|---|
| `query_local` | The minute the question is asked (Chicago clock). |
| `vehicle_id`, `route_name`, `stop_name` | Which bus, route and stop. |
| `lead_s` | How many seconds later the bus actually got there (600 = 10 minutes ahead). |
| `next_trip` | 1 if that arrival is on the bus's **next** run (it first has to finish its loop and usually wait at the end). The hardest case. |
| `stops_away`, `dist_m` | Stops and metres still to go. |
| `standing_s`, `last_age_s` | How long the bus had been standing still; how long since it last reached a stop. |
| `delay_s` | How late the bus was against the timetable at its last stop. |
| `passio_epoch`, `passio_status` | What the feed showed at that minute (`shown`, `none`, or `previous_lap`: it belonged to the earlier lap). |
| `passio_rel` | Its error as a share of the time left: -0.10 = the bus came 10% later than shown. **The 10% rule = between -0.10 and +0.10; band B (the working goal) = between -0.10 and +0.01.** |
| `tt_rel`, `ttd_rel` | The same for the printed timetable, and for the timetable shifted by the bus's current delay. |

**Do not average the rows**: one arrival appears up to 45 times.

## The daily scoreboard: `data/eta/summary.csv`

One row per day, predictor (`passio`, `timetable`, `timetable_delay`), lead range (the goal ranges 0-10, 10-15, 15-20, 20-30, 30-45; under 10 minutes the goal counts each arrival once, at
about 5 minutes ahead, so always showing "1 minute" cannot pass; 0-6 and 6-10 are extra detail
only), route (or `ALL`) and segment (`all`, `current_trip`, `next_trip`). Each arrival counts **once** per
lead range.

| Column | What it means |
|---|---|
| `targets` | Arrivals with a row in that lead range. |
| `n` | Of those, how many the predictor had a time for. `n / targets` = coverage. (October 12's Passio coverage looks low, about 50%, only because its log starts at 12:20 PM.) |
| `pass_shrink`, `early_shrink` | How many were within the allowed error of the goal (the 10 minute shrink), and how many were shown too early by more than that. |
| `pass_10`, `pass_10_floor` | The old goal, kept for comparison: within 10% of the lead; the same with a 1-minute floor. |
| `late_1` | How many were more than 1% of the lead too late (the bus came early). |
| `early_10` | How many were more than 10% too early (the bus came late). |
| `gross`, `gross_early` | Huge errors (set aside), and how many of them were "bus came early". |
| `mae_s`, `median_err_s` | Average size of the error and the median error, without huge errors. |

**Pass rate of a row:** `pass_shrink / (n - gross)` (the old 10% rule: `pass_10 / (n - gross)`). Pooled over days, with uncertainty ranges over days:
`python tools/build_eta_dataset.py report data/eta/summary.csv`. The current standings are in GOAL-AND-METHOD
section 3.

## Reading one row, start to finish

```
1791684942,2026-10-11T02:15:42Z,2026-10-10 21:15:42,5,21,1275,1077,East,501697,4315,140014,Hyde Park Places Apts,
South Hyde Park Boulevard,41.7942,-87.58402,9,140013,155.8,1791684926,16,9.74,0,1791684889,153,transition
```

On **Saturday, October 10, 2026 at 9:15:42 PM**, bus **4315** on the **East** route arrived at **Hyde Park Places
Apts** (the route's 10th stop, on South Hyde Park Boulevard). It had come from S. Hyde Park Blvd/55th Street,
**156 metres** back, in **16 seconds**, averaging about **22 mph**. It **did not stop**. The official feed, 153
seconds earlier, had predicted 9:14:49 PM, so the bus came **53 seconds later than predicted**: within 1 minute,
but outside the 10% rule at that lead (12 to 15 seconds) and, like 88% of rows, later than shown. Detected by the
bus passing the stop (`transition`).

## Good to know

- **A service day runs 4:00 AM to 3:59 AM.** In the data repo's per-day folders, a bus at 1 AM Saturday is filed
  under Friday. `local_time` always shows the real calendar date.
- **Blank cells mean "not known" or "not applicable"**, never zero.
- **Rows are only roughly in time order** (a row is written when the bus leaves the stop). Sort by `epoch` first.
- **Gaps in time** usually mean no buses were running or the feed went quiet (it sends no buses from about
  midnight to 4:30 AM, even while night routes are scheduled). Not bad data.
- **Known quirks in the earliest rows** (before October 10, 2026): the same visit now and then appears twice a few
  minutes apart, and a few percent of "previous stop" links skip stops. `docs/DATA.md` ("Known defects").
- **Rows before October 13, about 5 PM, have no `pass` rows**: stops Passio skipped are simply missing there (see
  "Is every station and line collected?").
- **Unofficial data**, collected by an unofficial student project from the public feed, not from the University.
  For official service information call 773.702.8181.

## Quick recipes (Excel / Google Sheets)

- **`epoch` to a date and time:** `=A2/86400 + DATE(1970,1,1)` gives UTC. Easier: use `local_time`.
- **How late was the official prediction?** `=A2 - W2` (seconds; positive = the bus came later than predicted;
  column A is `epoch`, W is `passio_pred_epoch`).
- **Speed in mph:** `=U2 * 2.237`. **Distance in miles:** `=R2 / 1609`.
- **Wait between buses at a stop:** filter to one `stop_id` and one `route_id`, sort by `epoch`, subtract each
  row's `epoch` from the next; divide by 60 for minutes.

# The arrival data, in plain English

This guide explains the shuttle arrival files for someone who has never seen them before. No coding needed: every
file opens in Excel, Google Sheets or Numbers. (The technical version, with how arrivals are detected, is
`docs/DATA.md`.)

**The big picture** (how the data is collected, how Passio predicts far buses, how our model works and how they
compare under the 10% rule): open `docs/prediction-explainer.html` in a browser.

**Which files this covers:** all of these have the same 25 columns. (The predictions file added on October 12,
2026 is different; it has its own section, "The companion file", below.)
- `data/ground_truth/arrivals.csv` on the `data` branch of this repo (everything, in one file)
- `data/arrivals/<day>/<route>.csv` in the public data repo
  [github.com/blobberus/straight-bussing-data](https://github.com/blobberus/straight-bussing-data) (one file per
  day and route; GitHub shows each one as a table)
- `data/latest.csv` in the same data repo (the newest 200 arrivals)

**What one row is:** one bus arriving at one stop. If bus 4315 on the East route reaches Hyde Park Places Apts at
9:15 PM, that is one row. A route with 12 stops driven 10 times a day gives about 120 rows.

**Where it comes from:** the shuttles' public live tracking feed (Passio, the same data the official app uses).
A collector checks it every 10 seconds, around the clock, and writes a row each time a bus reaches a stop. The
files update about every 30 minutes. They hold bus positions and times only: nothing about riders.

**How accurate:** arrival times are good to about 10 seconds either way. Bus GPS is off by a few meters, and the
feed only reports every 10 seconds or so.

## The columns

### When the bus arrived

| Column | What it means | Example |
|---|---|---|
| `epoch` | The arrival time as one number: seconds since January 1, 1970 (a standard computer time format). Handy for sorting or subtracting two times. You can ignore it and use `local_time` instead. | `1791684942` |
| `ts_utc` | The same moment in UTC (world standard time). The `Z` at the end means UTC. Chicago is 5 hours behind UTC in summer, 6 in winter. | `2026-10-11T02:15:42Z` |
| `local_time` | The same moment on a Chicago clock. **This is the column most people want.** Daylight saving time is already handled. | `2026-10-10 21:15:42` (9:15:42 PM) |
| `dow` | Day of the week, as a number: **0 = Monday**, 1 = Tuesday, 2 = Wednesday, 3 = Thursday, 4 = Friday, 5 = Saturday, 6 = Sunday. | `5` (Saturday) |
| `hour` | The hour on a Chicago clock, 0 to 23 (24-hour time). Good for "how do buses run at 8 AM vs 5 PM". | `21` (the 9 PM hour) |
| `minute_of_day` | Minutes since midnight, Chicago time (hour x 60 + minutes). 0 is midnight, 720 is noon, 1439 is 11:59 PM. | `1275` (21 x 60 + 15) |

### Which bus

| Column | What it means | Example |
|---|---|---|
| `route_id` | The route's number in the public shuttle schedule. Use it to tell routes apart reliably; names can change. | `1077` |
| `route_name` | The route's name, as riders know it. | `East` |
| `trip_id` | The feed's number for one run of the route (one bus driving the route once, from start to end). It is useful to follow one run stop by stop. Caveats: the feed sometimes changes a bus's trip number in the middle of a run, reuses numbers, and on some routes gives every bus the same one (every Downtown Campus Connector bus runs as `874028`), so use it together with `vehicle_id`. | `501697` |
| `vehicle_id` | The bus's ID in the tracking feed. The same bus keeps the same ID all day, even when it switches routes. | `4315` |

### Which stop

| Column | What it means | Example |
|---|---|---|
| `stop_id` | The stop's number in the public schedule. | `140014` |
| `stop_name` | The stop's name, as shown in the apps. | `Hyde Park Places Apts` |
| `stop_address` | The nearest street address to the stop (looked up once from OpenStreetMap; sometimes just a street name). | `South Hyde Park Boulevard` |
| `stop_lat`, `stop_lon` | The stop's map position (latitude, longitude). Paste `41.7942, -87.58402` into any map app to see it. | `41.7942`, `-87.58402` |
| `stop_index` | Where this stop sits in the route's order, **counting from 0**: 0 is the first stop, 9 is the tenth. On a loop route, the last number means "back at the first stop". | `9` (the 10th stop) |

### The drive from the previous stop

These columns compare this arrival with the same bus's previous arrival on the same run. **They are blank** when
there is no trustworthy previous arrival: it is the first stop we saw for that run, the previous one was more
than 25 minutes earlier (a gap in the data), or the bus was logged on a different run in between.

| Column | What it means | Example |
|---|---|---|
| `prev_stop_id` | The stop this bus arrived at just before this one. Usually the previous stop on the route, but stops can be skipped: at night buses pass stops nobody requested, and now and then an arrival is missed. | `140013` (S. Hyde Park Blvd/55th Street) |
| `prev_arrival_epoch` | When the bus arrived at that previous stop (same number format as `epoch`). | `1791684926` |
| `dist_prev_m` | How far the bus drove between the two stops, in **meters**, measured along the route's streets. Divide by 1609 for miles. | `155.8` (about 0.1 mile) |
| `segment_s` | **Seconds** from arriving at the previous stop to arriving here. It includes any time the bus spent waiting at the previous stop. | `16` |
| `speed_mps` | The bus's average driving speed between the two stops, in **meters per second**, not counting time spent waiting at the previous stop. Multiply by 2.237 for miles per hour. Blank if it could not be worked out or came out impossibly fast. Short hops (under a minute) give rough speeds. | `9.74` (about 22 mph) |

### At the stop

| Column | What it means | Example |
|---|---|---|
| `dwell_s` | How many seconds the bus stood at this stop. **0 means it drove past without stopping** (no one waiting, no one getting off). Blank means we could not tell. | `0` |

### What the official app predicted

| Column | What it means | Example |
|---|---|---|
| `passio_pred_epoch` | When the official tracking feed predicted this bus would arrive here, taken from a prediction made at least 2 minutes before the bus arrived (same number format as `epoch`). Compare it with `epoch` to see how far off the official prediction was. Blank if the feed had no prediction. | `1791684889` |
| `passio_pred_lead_s` | How many seconds before the arrival that prediction was made. **Always 120 or more, on purpose** (we keep the prediction a rider would have had 2 minutes ahead); usually 2 to 3 minutes. A lead longer than the drive from the previous stop is normal, not a missed prediction: see "Reading the prediction lead" below. A value of 5 minutes or more usually means the feed had stopped updating that bus, so treat those rows as "the prediction was stuck", not as a good long-range forecast. | `153` (made 2.5 minutes before) |

#### Reading the prediction lead (`passio_pred_lead_s`)

**What the official feed does.** While a bus drives toward a stop, the feed keeps publishing a predicted arrival
time for it and refreshes that prediction now and then (judging by this column, about once a minute). So one
arrival has many predictions: one made 6 minutes before, one made 3 minutes before, one made 20 seconds before, and
so on.

**Which one this file keeps.** Only one per arrival: the newest prediction that was **already at least 2 minutes
old** when the bus arrived. Two minutes is roughly the time it takes to get to a stop, so this is the prediction a
rider would have planned with. A prediction made 15 seconds before the bus pulls up is almost always right and
tells you little. `passio_pred_lead_s` is how long before the arrival that kept prediction was made, so it is never
under 120.

**Why it is rarely exactly 120.** At the 2-minute mark, the feed's newest prediction is usually a little older,
because the feed does not refresh every second. `passio_pred_lead_s` minus 120 is how old the feed's prediction was
at the 2-minute mark. In the first five days of data (October 8 to 12, 2026), half of all leads are under 156
seconds (a prediction 36 seconds old) and 79% are under 3 minutes.

**"The lead is longer than the drive from the previous stop. Did the official app miss its chance to predict the
arrival?"** No. In the example row below, the prediction was made 153 seconds before the bus arrived, while the
drive from the previous stop took only 16 seconds (`segment_s`). That only means the prediction was made before the
bus had even reached the previous stop: it was still at least 2 stops away. This is the normal case. In about 2 of
every 3 rows the lead is longer than the drive from the previous stop, and when the kept prediction was made the bus
still had to reach 1 stop (this one) in about a third of rows, 2 stops in another third, and 3 or more in the rest.
The feed almost certainly kept updating its prediction after that, including while the bus stood at the previous
stop. Those later, easier predictions are simply not stored, on purpose. So this column answers "how good was the
prediction a rider had 2 minutes ahead?", not "did the feed predict at all?".

**What a missed chance does look like:**
- **`passio_pred_epoch` is blank.** The feed had no prediction for this bus at this stop made 2 minutes or more
  before it arrived (about 4% of rows).
- **The lead is well over 3 minutes.** At the 2-minute mark, the feed's newest prediction was more than a minute
  old, so riders were looking at an old number. At **5 minutes or more** (about 8% of rows) the feed had stopped
  updating that bus. Treat those rows as feed failures, not as long-range forecasts.

**Accuracy falls as the lead grows.** How often the bus came within 1 minute of the kept prediction (October 8 to
12, 2026; rows the collector could attribute to the right bus):

| Lead | Rows | Within 1 minute | Average miss |
|---|---:|---:|---:|
| 120 to 129 s (fresh) | 1,044 | 69% | 56 s |
| 130 to 149 s | 2,139 | 65% | 63 s |
| 150 to 179 s | 2,886 | 58% | 72 s |
| 180 to 239 s | 761 | 42% | 110 s |
| 240 to 299 s | 143 | 22% | 179 s |

Part of that drop is simply predicting further ahead; most of it is an old prediction that the bus has since
drifted away from.

**What this column cannot tell you:** how good the official prediction is 5 or 10 minutes ahead, when you might
decide to leave home. A lead of 5 minutes or more here is a stuck prediction, not a fair test. Since October 12,
2026 those longer-range predictions are kept in the companion file `predictions.csv` (section below).

**Where was the bus when the prediction was made?** Filter the file to the same `vehicle_id` and `trip_id`, and look
at its rows whose `epoch` is between this row's `epoch` minus `passio_pred_lead_s` and this row's `epoch`: those are
the stops it still had to reach.

### How we know

| Column | What it means | Example |
|---|---|---|
| `source` | How the arrival was detected. `transition`: the feed's "next stop" for this bus moved past this stop, and the time is when the bus actually passed it. `proximity`: the bus was seen standing within 40 meters of the stop. Both are real arrivals; about 2 in 3 rows are `transition`. | `transition` |

## The companion file: predictions made 1 to 30 minutes ahead (`predictions.csv`)

Since October 12, 2026, a second file sits next to the arrivals file on the `data` branch:
`data/ground_truth/predictions.csv`. The arrivals file is unchanged (same 25 columns). For each arrival, this file
has **one row per "how far ahead"**: what the official feed predicted 1, 2, 3, 5, 10, 15, 20 and 30 minutes before
the bus arrived. It exists to check the project's goal, the **10% rule**: a prediction made 10 minutes ahead should
be right to within 1 minute, one made 30 minutes ahead to within 3 minutes.

| Column | What it means | Example |
|---|---|---|
| `epoch`, `local_time`, `route_id`, `route_name`, `trip_id`, `vehicle_id`, `stop_id`, `stop_name`, `stop_index` | The arrival, exactly as in the arrivals file. To find the matching arrivals row, look for the same `vehicle_id` and `stop_id` with an `epoch` within a few seconds. | `2026-10-12 12:16:49`, Apostolic/Drexel, bus `4538` at Bernard Mitchell Hospital |
| `lead_target_s` | How far ahead this row looks, in seconds: 60, 120, 180, 300, 600, 900, 1200 or 1800 (30 minutes). | `120` (2 minutes ahead) |
| `pred_epoch` | The prediction the feed was showing that far ahead of the arrival (its newest one at that moment). | `1791825335` (12:15:35 PM) |
| `pred_made_epoch` | When the feed made that prediction. | `1791825286` (12:14:46 PM) |
| `pred_lead_s` | How long before the arrival it was made. Never under `lead_target_s`; the difference is how old the prediction already was at that point (see "Reading the prediction lead" above). | `123` |
| `pred_minus_actual_s` | Predicted time minus real arrival time, in seconds. **Positive means the prediction was too late: the bus came earlier than predicted**, which is how riders miss a bus. Negative means the bus came later than predicted (riders wait). | `-74` (the bus came 74 s later than predicted) |
| `pred_seen_epoch` | When our collector first saw that prediction. Usually a few seconds after `pred_made_epoch`. It matters because the feed sometimes changes a predicted time without updating its own timestamp; we count a prediction from the moment it actually appeared, so a last-minute change never passes for a 10-minute-ahead prediction. Blank on the first rows (October 12, 12:20 to about 1 PM), before this column existed. | a few seconds after `pred_made_epoch` |

**A missing row is information too:** if an arrival has a 2-minute row but no 30-minute row, the feed was not
showing any prediction for that bus at that stop 30 minutes ahead (it usually predicts a run only once the bus has
started it, and it sometimes drops a prediction while a bus waits at the end of its route). Only predictions the
feed was actually showing at that moment count.

**Checking the 10% rule in a spreadsheet:** a row passes if `ABS(pred_minus_actual_s) <= 0.1 * lead_target_s`.

## The training table: what every source predicted, every minute (`eta-<day>.csv.gz`)

From the service day of October 12, 2026 on (the first with the feed's prediction log; earlier days have the bus
positions only), each finished day also gets a big table, kept as a download on the main repo's
Releases page ("Prediction data archive", one release per month; files `eta-<day>.csv.gz`, open with any unzip tool
or straight in Python or R). **One row = one minute, one bus, and one stop that bus later reached within the next 45
minutes.** So a single arrival shows up many times: once for every minute before it, which is exactly what you need to
ask "how good was the prediction 6, 10 or 30 minutes ahead?".

The most useful columns:

| Column | What it means |
|---|---|
| `query_local` | The minute the "question" is asked (Chicago clock). |
| `vehicle_id`, `route_name`, `stop_name` | Which bus, which route, which stop it will reach. |
| `lead_s` | How many seconds later the bus actually got there. 600 = 10 minutes ahead. |
| `next_trip` | 1 if that arrival is on the bus's next run (it first has to finish its current loop and usually wait at the end). These are the hardest to predict. |
| `stops_away`, `dist_m` | How many stops and metres the bus still had to go. |
| `standing_s`, `last_age_s` | How long the bus had been standing still, and how long since it last reached a stop. |
| `passio_epoch` | What the official feed was showing at that minute (blank if it showed nothing). |
| `passio_rel` | How far off that was, as a share of the time left: -0.10 means the bus came 10% later than shown. **The goal (the 10% rule) is a value between -0.10 and +0.10.** A positive value means the prediction was too late: the bus came early. |
| `tt_rel`, `ttd_rel` | The same for the printed timetable, and for the timetable shifted by how late the bus was running. |

**Do not average all the rows**: an arrival appears in up to 45 rows. The project's daily summary
(`data/eta/summary.csv` on the `data` branch) already counts each arrival once per "how far ahead" range (0 to 6, 6 to
10, 10 to 15, 15 to 20, 20 to 30, 30 to 45 minutes): in a spreadsheet, the pass rate of a range is
`pass_10 / (n - gross)`. `gross` counts predictions off by more than 10 minutes (or half the time left); they are left
out of the pass rate but still counted, especially the ones where the bus came early.

## Reading one row, start to finish

```
1791684942,2026-10-11T02:15:42Z,2026-10-10 21:15:42,5,21,1275,1077,East,501697,4315,140014,Hyde Park Places Apts,
South Hyde Park Boulevard,41.7942,-87.58402,9,140013,155.8,1791684926,16,9.74,0,1791684889,153,transition
```

On **Saturday, October 10, 2026 at 9:15:42 PM**, bus **4315** on the **East** route arrived at **Hyde Park Places
Apts** (the route's 10th stop, on South Hyde Park Boulevard). It had come from S. Hyde Park Blvd/55th Street,
**156 meters** back, in **16 seconds**, averaging about **22 mph**. It **did not stop** (0 seconds standing). The
official feed, 153 seconds earlier, had predicted 9:14:49 PM, so the bus came **53 seconds later than predicted**
(`1791684942 - 1791684889 = 53`). The arrival was detected by the bus passing the stop (`transition`).

## Good to know

- **A "service day" runs 4:00 AM to 3:59 AM.** In the data repo's per-day folders, a bus at 1 AM Saturday is filed
  under Friday, so late-night trips stay with their evening. `local_time` always shows the real calendar date.
- **Blank cells are normal.** They mean "not known" or "not applicable" (see each column), never zero.
- **Rows are only roughly in time order**, because a row is written when the bus leaves the stop. Sort by `epoch`
  or `local_time` first.
- **Gaps in time** usually mean no buses were running or the feed went quiet (the feed sends no buses from about
  midnight to 4:30 AM, even when night routes are scheduled). They are not bad data.
- **Known quirks in the earliest rows** (before October 10, 2026): now and then the same visit appears twice a few
  minutes apart, and a few percent of the "previous stop" links skip over other stops. Collector fixes stopped new
  rows from getting these; `docs/DATA.md` ("Known defects") has the details.
- **Unofficial data.** Collected by an unofficial student project from the public feed; not from the University.
  For official service information call 773.702.8181.

## Quick recipes (Excel / Google Sheets)

- **Turn `epoch` into a date and time:** `=A2/86400 + DATE(1970,1,1)` gives UTC; format the cell as date + time.
  Easier: use `local_time`.
- **How late was the official prediction?** `=A2 - W2` (seconds; positive = the bus came later than predicted),
  where column A is `epoch` and W is `passio_pred_epoch`.
- **Speed in mph:** `=U2 * 2.237` (U is `speed_mps`). **Distance in miles:** `=R2 / 1609` (R is `dist_prev_m`).
- **Wait between buses at a stop:** filter to one `stop_id` and one `route_id`, sort by `epoch`, and subtract each
  row's `epoch` from the next one; divide by 60 for minutes.

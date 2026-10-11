# The arrival data, in plain English

This guide explains the shuttle arrival files for someone who has never seen them before. No coding needed: every
file opens in Excel, Google Sheets or Numbers. (The technical version, with how arrivals are detected, is
`docs/DATA.md`.)

**Which files this covers:** all of these have the same 25 columns.
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
| `passio_pred_lead_s` | How many seconds before the arrival that prediction was made. Usually 2 to 4 minutes. A value of 5 minutes or more usually means the feed had stopped updating that bus, so treat those rows as "the prediction was stuck", not as a good long-range forecast. | `153` (made 2.5 minutes before) |

### How we know

| Column | What it means | Example |
|---|---|---|
| `source` | How the arrival was detected. `transition`: the feed's "next stop" for this bus moved past this stop, and the time is when the bus actually passed it. `proximity`: the bus was seen standing within 40 meters of the stop. Both are real arrivals; about 2 in 3 rows are `transition`. | `transition` |

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

# RouteKnower on Colab: technical notes (2026-10-16)

Notebook: `routeknower_colab.ipynb` ([Open in Colab](https://colab.research.google.com/github/blobberus/straight-bussing/blob/main/experiments/routeknower/colab/routeknower_colab.ipynb)).
Plain-English version: `PLAIN-ENGLISH.md` / `PLAIN-ENGLISH.ipynb`. Project plan: `RouteKnower.md` (E23).

## Direction, in one paragraph
**Not deep learning yet.** On the data so far (4 service days with Passio predictions, so 2 test days), a small
deep tabular network learned no useful correction: its scores equal Passio's in every lead bin. Gradient-boosted
quantile trees gained 1 to 2 points of band B at 10 to 30 minutes ahead without raising "too late", in seconds on a
CPU. So the notebook's default path is trees plus a per-stop shift table (RouteKnower M2 / M9), with the network as
an optional section that is off by default (`RUN_DEEP = False`). Revisit deep learning at tier T3 (8 to 10 weeks
including Thanksgiving Break and finals, about mid-December) or once a sequence input is used (the bus's recent GPS
trace from the raw polls), because that is where a network can learn something trees cannot.

## Problem framing
- **Rows**: the forecast-snapshot tables `eta-<day>.csv.gz` (docs/DATA.md "Forecast snapshots"): one row per (query
  minute t, bus, one of its arrivals in the next 45 min), with the features known at t and the real arrival.
- **What is learned**: the shift y = actual arrival minus Passio's shown time (seconds). A model predicts a low
  **quantile** of y, and the corrected time is Passio's time plus that shift. Where Passio shows nothing, nothing
  is predicted (the timetable sources stay as reported baselines).
- **Metric** (docs/GOAL-AND-METHOD.md): the owner's 10% rule. The working target is **band B**: the error
  (predicted minus actual) between 10% of the lead too early and 1% of the lead too late, with the "too late" share
  no higher than Passio's (the goal is under 1%). Scored exactly like `tools/build_eta_dataset.py summary()`: one
  row per arrival and lead bin (0-6, 6-10, 10-15, 15-20, 20-30, 30-45 min), never a plain row average. The notebook
  stops if its Passio numbers do not match `data/eta/summary.csv`.
- **Why a quantile**: the cost is one-sided (a time shown too late is a missed bus). The quantile is chosen per lead
  bin on the last learning day, under the constraint "too late no higher than Passio"; where no quantile is safe,
  the model keeps Passio's time.

## Data and leakage rules
- About 200k rows a day, about 125k with a Passio time shown; Oct 12 to 15 give about 500k learning rows, about
  29 MB of compressed files, under 1 GB of memory.
- Features (known at t only): route, stop, hour, weekday, stop index, visit rank, this trip or the next, stops and
  metres to go, terminal crossing, age of the last stop, speed, standing time, delay against the timetable, Passio's
  age, and Passio's / the timetable's times as "minutes from now". The labels and every error column are excluded
  by an assert.
- Splits by **whole service days** (rolling origin: learn on days 1 to k, test on day k + 1); one arrival is never
  in both; every model is scored on the same rows as Passio. This is RouteKnower section 6's protocol.

## Measured results (validation run on this PC, 2026-10-16)
Learn Oct 12 to 13, test Oct 14; learn Oct 12 to 14, test Oct 15. Band B in percent of arrivals; the difference
versus Passio with a 95% range from resampling whole days; "too late" in percent.

| Lead | Passio band B | Trees band B (vs Passio) | Deep | Per-stop shift | Too late: Passio / trees |
|---|---|---|---|---|---|
| 0-6 min | 4.1 | 4.1 (0.0) | 4.1 | 4.2 | 8.9 / 8.8 |
| 6-10 min | 6.9 | 7.0 (+0.1, 0.0 to 0.2) | 6.9 | 6.9 | 9.2 / 8.8 |
| 10-15 min | 11.2 | 12.0 (+0.9, 0.1 to 1.7) | 11.2 | 9.0 | 9.1 / 8.5 |
| 15-20 min | 18.4 | 19.8 (+1.4, 0.1 to 2.7) | 18.4 | 16.2 | 7.9 / 7.2 |
| 20-30 min | 23.6 | 25.7 (+2.1, -1.7 to 5.9) | 23.6 | 25.6 | 6.1 / 4.9 |
| 30-45 min | 12.3 | 10.7 (-1.6, -3.0 to -0.1) | 12.3 | 12.0 | 4.2 / 4.2 |

Verdict against the ship gate (RouteKnower 6.6): no model passes yet; the gate needs at least 10 test days. Trees
are the best first look: better in 4 of the 5 gate bins (2 to 30 min), too late lower everywhere, no route more
than 10% worse. The per-stop shift helps at 20 to 30 min but makes 4 routes more than 10% worse. The deep model
changed nothing. Run time: 40 s for everything on this PC's CPU (deep model included), peak memory 713 MB.

The bigger lesson is in the Passio column: even Passio reaches band B for only 4 to 24% of arrivals, and is too
late 4 to 9% of the time. Gains of 1 to 2 points will not reach the owner's goal on their own.

## Why deep learning is not the direction yet
1. **Too little data for a network.** About 90 stops, 13 routes and 6 lead bins leave a few samples per cell per
   day. Trees are the stronger tool on small tabular data, and train in seconds.
2. **The remaining error is missing information, not missing capacity.** Most large misses are a bus leaving the
   end of its line or the garage 10 to 25 minutes after the departure Passio assumed (driver breaks, layovers;
   GOAL-AND-METHOD). No model can learn that from inputs that do not contain it. The next gains come from inputs:
   the terminal / layover state, the previous bus on the same segment (M5), headways (M11), the fleet congestion
   index (M13).
3. **Shipping.** The app is build-free JavaScript and Swift on the phone. A lookup table or a tree walk is a few
   lines in each; a network needs its weights plus matching inference code in two languages.

**Revisit when** T3 data exists, or a sequence input is added (the last N GPS points of the bus, already in the
archived raw polls): a small recurrent or temporal convolution model can learn layover behavior from the trace.

## Cost and time
- Free Colab is enough: CPU for the trees (a few minutes including the download of about 30 MB). A T4 GPU only for
  the optional deep section. Colab Pro is not needed.
- `MODE = "FAST"` uses a quarter of the arrivals for a quick look; `FULL` uses everything.

## Risks
- **Few test days**: the ranges are wide; the gate needs 10 (tier T2, about Nov 5 to 12).
- **Shifts in behavior**: Thanksgiving Break (Nov 23-27), finals, holiday schedules and Passio feed changes. When
  the collector changes, rebuild past tables with `tools/replay_day.py` and `tools/apply_replay.py` (docs/DATA.md).
- **Per-stop overfitting**: the shift table backs off to route and lead bin when a stop has few samples.

## What data collection must keep doing
- Collect without gaps: every new day is a new test day. The release archive keeps the daily tables, raw polls and
  prediction updates permanently (run artifacts expire after 90 days).
- Nothing new needs logging for now. A future sequence model can use the raw polls already archived every 10 s.

## How a winner would ship
The per-stop shift ships as a JSON lookup next to the schedule data (RouteKnower section 9). Trees ship as the
LightGBM JSON dump the notebook saves, walked by a few lines of JavaScript and Swift. Either way it runs on the
phone, nothing about the rider leaves it, and the time stays labeled as an estimate.

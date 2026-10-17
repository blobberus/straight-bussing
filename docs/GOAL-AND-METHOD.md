# The prediction goal, and how we get there

This file is the **goal** for Straight Bussing's arrival predictions and the **method** for improving the algorithm
until it meets that goal: how every prediction is scored, where each predictor stands today, and the step-by-step
plan. What the data files and their columns mean, with the numbers collected so far, is in the companion file
`docs/DATA-GUIDE.md`. The technical plan and experiment log behind this summary is `RouteKnower.md`; a visual
overview is `docs/prediction-explainer.html`.

Numbers below: data up to Tuesday, October 13, 2026, 4:20 PM.

## 1. The goal

### 1.1 The 10 minute shrink (owner, October 17, 2026)

> "The new rule is the 10 minute shrink: >=30min = 3 min accurate, >=20 min = 2 min accurate, >=10min = 1 min
> accurate."

| How far ahead the prediction was made | Allowed error (either way) |
|---|---|
| 30 minutes or more | **3 minutes** |
| 20 to 30 minutes | **2 minutes** |
| 10 to 20 minutes | **1 minute** |
| under 10 minutes | 1 minute (assumed: the owner named no tighter step, and 0 would be unreachable; owner to confirm) |

It replaced the **10% rule** of October 12 (allowed error = 10% of the lead: 6 s at 1 min, 1.5 min at 15 min, with a
proposed 1-minute floor under 10 min). The new rule is the same at exactly 10, 20 and 30 minutes, stricter between
those steps (at 15 or 25 minutes ahead) and above 30, and the same as the floored 10% rule under 10 minutes. The
daily summary keeps the 10% counts (`pass_10`) next to the new ones (`pass_shrink`), so both can be compared.
Code: `tools/arrivals_lib.py` `shrink_tol`.

**Under 10 minutes, measured once** (owner, October 17): "the under 10 minute accuracy should be measured once ...
avoid the edge case where predictions infinitely go to 1 minute and the model avoids being inaccurate by
precalculating the prediction to 60s (1min) for every minute/second under 10 mins away." With a flat 1-minute
allowance, scoring every minute as the bus comes would reward a model that always shows "1 min away" (it is right
whenever the bus is 2 minutes or less away). So each arrival counts **once** for the whole window under 10 minutes:
the prediction made closest to **5 minutes ahead** (the middle of the window; there a constant "1 min" is 4 minutes
off, and a model cannot aim at that moment because it does not know when the bus will really come). This is the
goal bin `0-10` in the daily summary; the finer `0-6` and `6-10` bins, and `predictions.csv`'s 1, 2 and 3 minute
leads, are diagnostics only, never part of the goal or the ship gate. In `predictions.csv` the goal's under-10 point
is the 5-minute lead (`lead_target_s` 300).

"Error" always means **predicted time minus actual arrival time**:
- **Positive = "too late"**: the prediction said a later time than the bus really came. The bus came early, and a
  rider who trusted the prediction **can miss the bus**. This is the dangerous direction.
- **Negative**: the bus came later than predicted. The rider waits longer than planned: annoying, not dangerous.

### 1.2 The 1% rule: almost never too late

> "Most arrival times should be under 1% too late."

This sentence can be read three ways. All three are measured, but one is adopted until the owner confirms:

| Reading | What it asks | Status |
|---|---|---|
| **B (adopted)** | Each prediction may be up to the allowed error (section 1.1) too early, but at most **1% of L too late** (10 min ahead: at most 6 s too late, at most 60 s too early; 25 min ahead: 15 s late, 2 min early). "Most" predictions should land in that window. | **Working target. Owner to confirm.** |
| A1 | Fewer than 1% of all predictions are too late at all. | Measured. Reaching it means shifting every prediction so much earlier that almost none stays within 10% (E19). |
| A2 | Fewer than 1% of predictions are too late by more than 10% of L. | Measured. Same problem as A1, a little milder. |

So the **single number we optimize** is the share of predictions inside the window **from the allowed error too
early to 1% of L too late** ("band B"), checked separately at each lead time (1, 2, 3, 5, 10, 15, 20, 30 minutes).
The plain rule (the allowed error either way) is reported next to it. Until October 17 the early edge was 10% of L.

### 1.3 Huge errors are set aside, but never hidden

The owner asked to leave huge errors out because they come from different problems. The rule (adopted in E19):
- A **gross miss** is an error larger than **10 minutes or half the lead, whichever is larger** (30 minutes ahead:
  more than 15 minutes off).
- Gross misses are **left out of the pass rates** but **counted and reported**, split by direction. A gross miss
  where the bus came early still counts against the 1% rule.
- What is **never** left out: predictions that were stale, already in the past, or about the wrong run. Riders saw
  those numbers, so they count.
- What **is** left out as a logging mistake, not a prediction: a prediction that belonged to the bus's previous
  lap past the same stop, and arrivals of a bus that was never at the stop.

### 1.4 Open decisions for the owner

1. **Which reading of the 1% rule** (section 1.2). B is assumed.
2. **A floor for short leads.** Settled by the 10 minute shrink (October 17): 1 minute from 10 to 20 minutes ahead.
   Under 10 minutes the 1-minute floor is assumed (the old proposal: at 1 to 3 minutes ahead a 10% rule was only 6 to
   18 seconds, tighter than the arrival detector's own accuracy and finer than the app's whole minutes). Owner to
   confirm.

## 2. How every prediction is scored

These rules make results comparable from one week to the next and between predictors.

1. **One sample per arrival and lead.** For each real arrival and each lead L, take the prediction that was
   **on display** L minutes before the arrival: the newest one our collector had actually seen by then, and that
   was still being shown. Never average over minutes: one arrival would count dozens of times.
2. **What counts as the arrival.** The time the bus reached the stop (`epoch` in the arrivals file). At a route's
   first stop, compare with the **departure** instead (Passio predicts when the bus leaves there).
3. **Only data logged after the collector fixes** (from October 10, 2026, 5:18 AM). Older rows contain logging bugs
   that look like prediction errors (E01, E19).
4. **Gross misses**: set aside and counted (section 1.3).
5. **Days are the unit of noise.** A result is only trusted with at least **10 separate service days** in the test
   period; the uncertainty range comes from resampling whole days (bootstrap, 2,000 times). With fewer days, a
   result is "first look" or "inconclusive".
6. **Same rows for every predictor.** Two methods are compared only on the arrivals both of them predicted.
7. **Coverage is reported too.** A method that only predicts the easy arrivals is not better. Every table shows
   how many arrivals had a prediction at that lead.
8. **Split by what the bus is doing**: arrivals on the trip the bus is driving now ("current trip") vs on its next
   trip (it first has to finish its loop and usually wait at the end). These behave completely differently.
9. **New, from this week's data: the rider's view.** At 30 minutes ahead, half of Passio's gross misses happen
   because the feed's trip number moved on a lap: the same bus did reach the stop near the predicted time, but
   under another trip number. A rider at the stop only cares that *a* bus of the route came. From E20 on, each lead
   is also scored as "the next bus of this route at this stop", next to the per-trip score, and both are reported.
   Update 2026-10-16 (DC-011): most of these were OUR pairing, not Passio: the feed listed the bus's current lap
   under its next trip number and the collector scored that time against the next lap. The collector now never
   scores a prediction about the bus's previous visit against the next one, and the past days were rebuilt
   (558 such rows removed). What is left at 30 minutes (about 28% more than 15 minutes off) is Passio's own error.

## 3. Where we stand

### 3.0 Under the 10 minute shrink (October 12 to 16, 2026; the daily summary)
Passio, one sample per arrival and lead bin, huge misses set aside (`python tools/build_eta_dataset.py report
data/eta/summary.csv`). **A first look: 5 days.**

| Lead | Passio within the allowed error | (old 10% rule) | too late (more than 1% of the lead) |
|---|---|---|---|
| under 10 min (once per arrival, about 5 min ahead) | 22% | 8% | 10% |
| 10 to 15 min | 13% | 16% | 10% |
| 15 to 20 min | 14% | 24% | 8% |
| 20 to 30 min | 26% | 31% | 6% |
| 30 to 45 min | 12% | 13% | 4% |

First learned corrections (Colab notebook, test days Oct 14 to 16, band B, goal bins): trees +0.3 points at 10 to
15 minutes and +1.4 at 20 to 30, but -1.2 at 15 to 20 and no gain under 10, with less "too late"; one route (North)
more than 10% worse; a deep network no real gain (RouteKnower E23c). The tables below are the October 13 look
under the 10% rule.

### 3.1 Under the 10% rule (October 13, 2026)


Share of predictions within the 10% rule. "Band B" = within 10% too early to 1% too late (the working goal).
Passio: `predictions.csv`, Monday 12:20 PM to Tuesday 4:20 PM (1.2 days; 900 to 3,700 arrivals per lead).
Timetable rows: the daily summary, October 10 to 12 (3 days). Our model: E19 (October 8 to 12). **All of this is
a first look: far fewer than 10 days.**

| Lead | Passio, 10% rule | Passio, band B | Passio, gross misses | Bus later than Passio showed | Plain timetable (bin) | Timetable + current delay (bin) | Our model (E19) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 min | 8% (67% with a 1-min floor) | 4% | 1% | 88% | | | |
| 2 min | 9% (49% with the floor) | 6% | 1% | 90% | 6% (0-6 min) | 7% (0-6 min) | |
| 5 min | 9% (21% with the floor) | 6% | 2% | 91% | | | |
| 10 min | 16% | 12% | 5% | 90% | 17% (6-10) | 9% (6-10) | 30% |
| 15 min | 25% | 19% | 11% | 90% | 26% (10-15) | 16% (10-15) | |
| 20 min | 31% | 25% | 18% | 90% | 35% (15-20) | 29% (15-20) | |
| 30 min | 19% | 17% | 33% | 97% | 42% (20-30) | 57% (20-30) | 20% |

What this says:
- **Nobody meets the goal yet**, at any lead. The best single numbers are around 30 to 60%, against a goal of
  "most".
- **Passio is rarely too late** (8 to 11% of predictions are more than 1% of L too late; 2% at 30 minutes ahead),
  so it comes close to the 1% rule. Its problem is the other direction: **buses come later than Passio shows, 9 times out of 10**, by a
  median of 1 minute at 2 minutes ahead, 3 minutes at 10 minutes ahead and 6 minutes at 30 minutes ahead.
- **Far ahead, the printed timetable beats Passio** (42 to 49% vs 19 to 31%; other days and lead bins, so roughly), because Passio's far predictions
  assume buses never stop at stops and leave the end of the line exactly on time (section 4).
- **Huge errors grow with the lead**: 5% of 10-minute predictions, 33% of 30-minute ones. Almost all are "the bus
  came much later" (section 4, last point).

## 4. Why Passio misses far ahead (what we learned about its method)

From Passio's own prediction feed (E20 preliminary, `experiments/routeknower/E20-prelim-*`):
1. **The trip the bus is driving now**: Passio adds up its own drive times between stops from where the bus is,
   with **zero time standing at stops**. Real buses stop, so they arrive later than shown, and the gap grows with
   every stop still to come.
2. **The bus's next trip**: Passio starts it at the **printed departure time** from the end of the line (94% of
   the time exactly), whether or not the bus is running late. A late bus therefore shows up late again, and its
   lateness is never carried forward.
3. **The switch**: when the bus starts its next trip (often while still waiting at the end of the line), Passio
   switches to "leaves now", so the prediction jumps by up to 10 minutes.
4. **Freezes**: some buses' predictions stop updating for minutes or hours (on Monday, about 60 bus-hours in which
   the feed's "next stop" did not move while the bus drove on).
5. **The huge errors 15 to 30 minutes ahead** (this week's data): most are a bus leaving the end of its line or the
   garage 10 to 25 minutes after the printed departure Passio assumed (driver breaks, Apostolic/Drexel at Drexel
   Garage, Red Line/Arts Block). At 30 minutes ahead, about half used to be the lap mix-up from section 2,
   point 9; since 2026-10-16 those rows are gone from the data (DC-011), so the rest is Passio's own error.

The error is **one-sided and structural**, not random noise. That is good news: a correction can learn it.

## 5. The plan for optimizing the algorithm

### 5.1 The algorithm, in three parts (one per situation the bus is in)

| Part | Situation | Prediction | First version |
|---|---|---|---|
| **A. Near** | the target stop is on the trip the bus drives now (Passio predicts it, usually under 8 minutes) | Passio's time **plus a learned correction**: how much later buses come than Passio shows at this stop, at this time of day, this many stops ahead | E18: a per-stop offset took 2-3 minutes ahead from 62% to 87% within 1 minute, but buses more than 1 minute early rose from 3% to 7%; so it must be tuned against the 1% rule, not just accuracy |
| **B. Next trip** | the bus must first reach the end of its line and wait | **when it will leave the end of the line**, learned from history (printed departure, how late the bus arrives there, the shortest break drivers take, route, hour), then the drive time to the stop with **learned stop times** | new; E19 found the end-of-line wait is the biggest error source for our own model (median 5 minutes too early at 30 minutes ahead) |
| **C. Doubtful** | Passio's data for this bus looks frozen, or the bus is running far from its trip's timetable (wrong run) | fall back to the timetable (plus current delay), or show the time as less certain | new; 92 wrong-run predictions in 4.5 days, buses 5 to 35 minutes earlier than shown |

A final **blend per lead** (how much to trust each part 1, 2, 3, 5, 10, 15, 20 and 30 minutes ahead) is learned on
past days only.

### 5.2 What the algorithm learns from

- **Training table**: the daily `eta-<day>.csv.gz` files (one row per minute, per bus, per stop it reaches in the
  next 45 minutes, with everything known at that minute and what really happened). Columns: `docs/DATA-GUIDE.md`.
- **Evaluation**: `predictions.csv` and the daily `data/eta/summary.csv` (one sample per arrival and lead).
- **Features already in the table**: lead, current vs next trip, stops and metres still to go, how long the bus has
  been standing, how old its last stop is, its delay against the timetable, route, hour, weekday or weekend,
  academic calendar period, Passio's age. To add: minutes until the next trip's printed departure (end-of-line
  wait), weather class, and today's congestion measured by the shuttles themselves.

### 5.3 The test protocol (no cheating)

1. **Time order only.** Learn on earlier days, test on later ones. Never shuffle.
2. **Nothing from the future.** A prediction for an arrival L minutes ahead may only use what was known L minutes
   before the arrival. Settings (offsets, blend weights, cut-offs) are fitted on the learning days only.
3. **Rolling weeks.** Learn on weeks 1 to k, test on week k + 1; repeat for every week we have.
4. **Score with section 2** and compare on the same arrivals.
5. **Slices**: a method that wins on average but loses badly on one route, time of day, weekday/weekend or class
   vs break week is not shipped.

### 5.4 When a new version may reach riders (the ship gate)

All of these must hold on at least 10 test days:
1. Better than Passio in **band B** in every goal bin up to 30 minutes (under 10 minutes scored once per arrival,
   at about 5 minutes ahead; then 10-15, 15-20, 20-30), with the day-resampled uncertainty range above zero.
2. **Too late no more often than Passio** (the 1% rule must not get worse; an early bus is a missed bus).
3. No route more than 10% worse than Passio.
4. In the app, every derived time stays labelled "est." with its source, and stale data is still flagged (ship
   checklist in `.claude/rules/project.md`).

A version that fails keeps Passio's time in the app. No exceptions near a deadline.

### 5.5 Timeline

| When | What |
|---|---|
| now to Oct 19 | Collect. Every arrival and every Passio prediction 1 to 30 minutes ahead are logged; since Oct 13 also the stops Passio skips (DATA-GUIDE, "Is every station and line collected?"). |
| **Oct 19** | **E20, first look**: Passio and the timetable at every lead with a week of `predictions.csv`, per-trip and rider's-view scores, the end-of-line wait measured. |
| **~Oct 22 (2 weeks of data)** | First decision on part A (Passio correction), tuned against the 1% rule. First version of part B. |
| Oct 22 to Nov 4 | Weekly re-runs; parts B and C; the blend. |
| **Nov 5 to 12 (4 weeks)** | Ship evaluation against section 5.4. Model freeze Nov 12. |
| **Fri Nov 20** | Ship whatever passed, before Thanksgiving Break (Nov 23 to 27). Keep collecting and improving afterwards. |

### 5.6 What still limits us

- **Days, not rows.** We have 1.2 days of Passio's 1-30 minute predictions and 6 days of arrivals. Most of the
  spread between methods is day-to-day; nothing can be decided before about 10 test days.
- **Short leads vs the detector.** Arrival times are good to about 10 seconds, so the 6 to 18 second windows at 1
  to 3 minutes ahead are at the limit of what we can even measure (hence the floor proposal, 1.4).
- **Buses Passio files wrongly or freezes** are still partly missing from the arrivals (about 12% of the stops
  buses drive past were not logged on Monday, most of them on the Red Line). The raw GPS is archived, so those days
  can be re-processed once a GPS-only matcher exists.
- **Weather and special weeks**: rain has been rare so far; Thanksgiving Break and finals week are their own
  periods and will only be seen once.

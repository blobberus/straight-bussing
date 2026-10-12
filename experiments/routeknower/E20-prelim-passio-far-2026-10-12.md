# How Passio predicts buses 6+ minutes away, and how good it is under the 10% rule

Date 2026-10-12. Data: every Passio prediction update logged by the local collector from 12:18 to 14:14 CDT (about
1.9 h of one weekday afternoon; 8,196 updates, 11 buses; `data/monitor/predlog/*.jsonl`), 60 live snapshots of
both GTFS-RT feeds 30 s apart (13:47 to 14:17 CDT, with the departure fields the log does not keep), arrivals from
`origin/data` (197 arrivals in the window, loop terminals left out), the public GTFS timetable (2026-10-12; times at
timepoints, intermediate stops interpolated by shape distance). Error = predicted - actual: negative = the bus came
later than shown; positive = "too late" in the owner's sense (the bus came earlier than shown). "On display at
A - L" = the newest update first seen by then and still shown then (E19 rules, incl. the previous-lap rule).
**Sample warning: under 2 hours, one afternoon, dominated by Apostolic/Drexel and 53rd Street Express.** Treat
every accuracy number as a first look; the mechanism findings (sections 2 and 3) are structural and solid.
Scripts (kept in the analysis scratch folder, not in the repo): `scratchpad/far/` (`far_lib.py`, `q1_reach.py`, `q2_form.py`, `q2b_speed.py`, `q4_acc.py`, `q4b_check.py`,
`sampler.py`).

## 1. Coverage: how far ahead Passio predicts

| trip in the update | updates | median reach | p90 | max |
|---|---:|---:|---:|---:|
| current trip (the one the bus is driving) | 367 | 8.2 min | 16.3 | 25.2 |
| next trip (the bus is still on the one before) | 493 | 22.7 min | 28.1 | 153.4 |
| Downtown Campus Connector (one frequency trip id) | 465 | 33.8 min | 58.0 | 75.5 |

- Each bus's feed entry carries its current trip and, from somewhere in the second half of it, its **next trip** (1
  trip: 579 refreshes, 2 trips: 390, 3: 2). Never two trips ahead.
- Share of arrivals with a prediction on display L before: 5 min **92%**, 6 min 91%, 10 min 90%, 15 min 88%,
  20 min 88%, **30 min 35%** (n = 180, 179, 175, 161, 154, 131). At 30 min the arrival is usually two trips ahead.

## 2. How the far predictions are formed

1. **Current trip: position + Passio's own run times, no dwell.** Departure = arrival + 1 s at 98% of intermediate
   stops (n = 4,091): Passio assumes buses never stop. Its gaps between consecutive stops are 22 s shorter than
   the timetable's (median; never equal to it: 1%), speed varies by segment (5.2 m/s median, coefficient of
   variation 0.42 within one update), so it uses segment run times of its own, faster than reality. It is NOT
   timetable + current delay (only 2% within 30 s) and not first stop + scheduled run times (4%).
2. **Next trip: anchored on the timetable.** The next trip's first-stop departure equals its scheduled departure
   exactly in **94% of 232 samples**; the predicted terminal arrival before it is separate (median 8 min layover
   implied; p90 31 min). Later stops = that departure + Passio's run times (stop 2 = scheduled departure + 57 s;
   scheduled run 63 s). Only when Passio's own predicted terminal arrival is after the scheduled departure (11 of
   293) does the next trip move (departure = arrival + 1 s).
3. **Lateness is not carried into the next trip.** Next-trip predictions stay at the timetable (-53, -43, -61 s)
   whether the bus is on time (delay -54 s), 1-5 min late (+168 s) or 5+ min late (+431 s): because the predicted
   terminal arrival is itself optimistic (no dwell, fast run times), it rarely passes the scheduled departure.
4. **The switch jump.** When the bus switches to the trip (at the terminal, often still waiting out its layover),
   the prediction flips from the timetable-anchored value to position + run time, as if the bus left now. Example,
   bus 4538 at 57th St & Drexel (NB): 30 to 15 min before the arrival the error is a steady -211 to -219 s; at
   12 min it jumps to **-608 s** (shown 10 min too early), then shrinks -548, -418, -288, -218, -158, -91 as the bus
   approaches. Same pattern at Comer Children's (-197 s, then -535 s at 10 min).

## 3. Refresh and staleness
- Passio refreshes each bus's trip updates every **60 s** (median; p90 72 s, p99 130 s; n = 960); our polls first
  see an update 35 s after its timestamp (median; p90 61 s), so a shown prediction is typically 35 to 95 s old
  (feed header minus trip-update timestamp: median 71 s, p90 111 s, max 227 s).
- Predicted time changed without a new timestamp: 21 of 8,196 consecutive updates (0.3%) over this window (the
  first 10 minutes this morning gave 57 of 651; it is real but rare).
- Refresh gaps of 3+ min: 6 in 1.9 h (12-13 min for buses 4314 and 4324, at the end of a DCC or Apostolic/Drexel
  lap). Stale predictions (120+ s old at the query) pass the 10% rule 11% of the time vs 19-34% for fresh ones.

## 4. Accuracy 5 to 30 minutes ahead (gross misses |err| > max(10 min, 0.5 L) left out: 0, 0, 0, 3, 10, 3)

| lead | n | 10% rule | 10%, 1-min floor | band B | too late at all | median err |
|---|---:|---:|---:|---:|---:|---:|
| 5 min | 165 | **7%** | 15% | 6% | 4% | -121 s |
| 6 min | 162 | **8%** | 19% | 7% | 4% | -142 s |
| 10 min | 157 | **15%** | 15% | 13% | 4% | -156 s |
| 15 min | 139 | **24%** | 24% | 22% | 3% | -197 s |
| 20 min | 126 | **37%** | 37% | 35% | 2% | -179 s |
| 30 min | 43 | **16%** | 16% | 16% | 0% | -286 s |

The collector's own `predictions.csv` gives the same picture (10 min 15%, 20 min 33%, 30 min 16%).
**By what the bus was doing:** current trip 5% (10 min), 0% (15, 20, 30 min; medians -285 to -754 s); next trip
23%, 32%, 43%, 21%. **Same rows, other predictors:** plain timetable 35% / 41% / 51% / 68% at 10 / 15 / 20 / 30 min
(too late 13-15%); timetable + the bus's current delay 16% / 19% / 36% / 78% (too late 40-49%; n = 37 at 30 min).
**E19 (4 days) for comparison:** our model 30% at 10 min, 20% at 30 min; timetable + current delay 63% at 30 min.
So at 6+ min Passio is at or below our model and below the plain timetable; it is almost never too late (2-4%),
because its errors are one-sided: **buses come 2 to 5 minutes later than Passio shows.** The evolution of one
arrival (46 arrivals with a 30-min history): median -290 s at 30 min, -255 at 15, -198 at 10, -130 at 5, -77 at 2.

## 5. What predicts Passio's far-lead error (features for a correction model)
- **Trip phase** (current trip vs next trip vs DCC): the strongest split (current trip 0-5% vs next trip 21-43%).
- **The trip-id switch while the bus waits at the terminal**: produces the 8-10 min too-early jump; a feature
  "seconds until the trip's scheduled departure" (layover remaining) at the query time.
- **Stops / dwells remaining**: Passio models zero dwell, so error grows with the number of stops the bus will
  serve before the target (current trip 1-3 stops: 12% vs 8+ stops 30% pooled over phases; within the current trip
  the error grows with distance).
- **Bus delay vs timetable at the query**: 5+ min late -> 6% (median -304 s); next-trip predictions ignore it.
- **Route**: Friend Center/Metra 49% (its trips run on time), DCC 0% (median -376 s), Apostolic/Drexel 23%, 53rd 24%.
- **Prediction age** (stale 120+ s: 11%) and time of day (not testable in one afternoon).
A correction that is learned per (trip phase, stops remaining, layover remaining, route, hour) on top of Passio, or
a model that starts from the scheduled departure for next trips and adds learned dwells, has a lot of room: the
error is mostly one-sided and structural, not noise.

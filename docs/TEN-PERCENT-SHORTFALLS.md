# Where the live arrival times fall short of the 10% rule (synopsis)

What riders see today as "arrives in N min" in Straight Bussing is Passio's live prediction from the public feed,
unchanged. This synopsis measures those times against the owner's **10% rule** and breaks the misses down to show
where the tracking system is weakest and why. Our two timetable-based estimates are shown next to Passio for
comparison.

- **Data:** Monday, October 12 to Saturday, October 24, 2026 (Passio's predictions are recorded from October 12,
  12:20 PM): **13 service days** (10 weekdays, 3 weekend days), 42,212 arrivals, 123,927 scored Passio
  predictions. Timetable estimates from October 10.
- **This is past the "first look" stage:** the scoring rules trust a result with 10 or more service days
  (`docs/GOAL-AND-METHOD.md` section 2). Each headline rate comes with a 95% range from resampling whole days.
- **Every table:** `experiments/routeknower/E24-ten-percent-shortfalls-tables.md`, made by
  `experiments/routeknower/E24-scripts/shortfalls.py` (how to rerun: last section).
- **The rule today:** on October 17 the owner replaced the 10% rule as the goal with the 10 minute shrink. This
  file scores the 10% rule as asked; section 7 puts both side by side.

## The rule, and how a prediction is scored

- A prediction made L minutes before the bus reached the stop **passes** if it was off by at most **10% of L**:
  30 seconds at 5 minutes ahead, 1.5 minutes at 15 minutes, 3 minutes at 30 minutes.
- **Error = predicted time minus real arrival.** Negative means the bus came *later* than shown (the rider waits).
  Positive means the bus came *earlier* than shown (the rider can miss it): the dangerous direction.
- Scored exactly like the daily scoreboard (`data/eta/summary.csv`): one sample per arrival in each lead range
  (under 10 minutes, the prediction nearest 5 minutes ahead), gross misses (more than 10 minutes or half the lead
  off) left out of the pass rate but counted. The headline below matches the scoreboard to the percent.

## Bottom line

1. **Passio meets the 10% rule for 8% to 32% of predictions**, depending on how far ahead. Nowhere near "most".
2. **The misses go one way.** In 93% of misses the bus came *later* than shown. Typically the bus comes 1.7
   minutes after the time shown 5 minutes ahead, 3.3 minutes after at 10 to 15, 4.1 at 20 to 30, 9.2 at 30 to 45.
3. **The errors are about 3 times the allowance.** At 10 to 15 minutes ahead the rule allows about 1.2 minutes;
   the typical miss is 3.5 minutes, and 1 in 5 predictions (gross misses aside) is off by more than 6.2 minutes.
4. **The worst case is the bus's current run, far ahead:** 11% to 12% pass from 10 to 30 minutes ahead (4% at 30
   to 45), against 24% to 40% when the stop is on the bus's next trip. The current run holds 63% of all misses.
5. **A late bus stays late in Passio's eyes.** For a bus more than 10 minutes behind schedule, 5% to 10% pass at 15
   to 30 minutes ahead, against 34% to 51% for an on-time bus.
6. **The printed timetable, with no live data, does as well as Passio or better** on the same arrivals: ahead in 8
   of 10 cases, behind by under 0.2 points in the other 2. Timetable plus the bus's current delay is far better at
   20 to 30 minutes ahead (58% against 40% on the next trip, 39% against 16% on the current one).
7. **Often there is no time at all.** No Passio time is on display for 15% of arrivals 5 minutes ahead, 45% at 20 to
   30 minutes and 83% at 30 to 45.
8. **Concentrated:** rush hours (7 to 10 AM, 3 to 7 PM) hold 53% of misses; four routes (Downtown Campus Connector,
   53rd Street Express, Apostolic/Drexel, Red Line/Arts Block) hold 53%.
9. **No trend in two weeks:** the second week's weekdays score the same as the first week's; Saturdays score about
   twice as well as weekdays.
10. **A simple correction is not enough.** Shifting every time by a learned amount raises the 10% pass rate to about
    50%, but then 3 to 4 in 10 predictions are shown later than the bus came (about 1 in 10 now). Fixing this needs
    information about each bus (delay, layover, stops), not a constant.

## 1. Headline: each source by how far ahead

| Lead | Passio, 10% rule | 95% range over days | with a 1-minute floor | Printed timetable | Timetable + current delay | Passio median error | Passio: no time on display |
|---|---:|---|---:|---:|---:|---:|---:|
| under 10 min (about 5 min ahead) | **8%** | 8% to 9% | 23% | 10% | 8% | -1.7 min | 15% |
| 10 to 15 min | **17%** | 15% to 20% | 17% | 23% | 19% | -3.3 min | 29% |
| 15 to 20 min | **25%** | 23% to 29% | 25% | 32% | 31% | -3.5 min | 34% |
| 20 to 30 min | **32%** | 29% to 38% | 32% | 38% | 51% | -4.1 min | 45% |
| 30 to 45 min | **15%** | 12% to 19% | 15% | 47% | 39% | -9.2 min | 83% |

Gross misses (left out of the rates above): 3%, 9%, 17%, 18% and 30% of Passio's predictions in the five ranges.
The timetable columns cover more arrivals than Passio (they exist whether or not Passio shows a time); section 5
compares them on the same arrivals.

## 2. The size and direction of the misses

| Lead | Allowed by the rule | Typical miss (median, either way) | 80% of predictions within | Bus came > 10% later than shown | Bus came > 10% earlier than shown |
|---|---:|---:|---:|---:|---:|
| about 5 min | 0.5 min | 1.8 min | 3.4 min | 84% | 8% |
| 10 to 15 min | 1.2 min | 3.5 min | 6.2 min | 77% | 6% |
| 15 to 20 min | 1.8 min | 3.8 min | 6.9 min | 70% | 5% |
| 20 to 30 min | 2.5 min | 4.3 min | 8.8 min | 65% | 3% |
| 30 to 45 min | 3.8 min | 9.3 min | 13.9 min | 84% | 1% |

**Inefficiency: systematic optimism.** Passio's times are early by a steady share of the lead, not scattered
around the truth. On the bus's current run the typical error is about a quarter to a third of the lead: about 3 to
4.5 minutes at 10 to 15 minutes ahead, 7 to 8.6 minutes at 20 to 30 (at the same lead it barely depends on how many
stops are left). This matches what was learned about Passio's method (`docs/GOAL-AND-METHOD.md` section 4): it
counts **no time standing at stops** and its own drive times are short. The good side: the dangerous direction is
rare. 4% to 11% of Passio's times are shown later than the bus came by more than 1% of the lead.

**Exact leads** (`predictions.csv`, one row per arrival and lead): the rule is out of reach under 10 minutes as
written.

| Lead | Allowed | Time on display | 10% rule | with a 1-minute floor |
|---|---:|---:|---:|---:|
| 1 min | 6 s | 89% | 6% | 66% |
| 2 min | 12 s | 88% | 8% | 48% |
| 3 min | 18 s | 86% | 8% | 35% |
| 5 min | 30 s | 83% | 9% | 20% |
| 10 min | 1 min | 77% | 14% | 14% |
| 15 min | 1.5 min | 72% | 22% | 22% |
| 20 min | 2 min | 59% | 29% | 29% |
| 30 min | 3 min | 18% | 18% | 18% |

**Inefficiency: a rule tighter than the measurement.** 6 to 18 seconds at 1 to 3 minutes is finer than the arrival
detector (about 10 seconds) and the app's whole minutes. With the proposed 1-minute floor, two thirds of
1-minute predictions pass.

## 3. What the bus is doing: the biggest levers

| Situation | about 5 min | 10 to 15 | 15 to 20 | 20 to 30 | 30 to 45 | Share of all misses |
|---|---:|---:|---:|---:|---:|---:|
| Stop is on the bus's **current trip** | 7% | 11% | 12% | 11% | 4% | 63% |
| Stop is on its **next trip** | 15% | 24% | 33% | 40% | 21% | 37% |
| Bus **more than 2 min early** | 8% | 24% | 38% | 44% | 32% | 15% |
| Bus **on time** (within 2 min) | 10% | 23% | 34% | 51% | 26% | 19% |
| Bus **2 to 5 min late** | 10% | 17% | 27% | 43% | 9% | 14% |
| Bus **5 to 10 min late** | 8% | 16% | 22% | 21% | 15% | 17% |
| Bus **over 10 min late** | 6% | 9% | 10% | 5% | 8% | 19% |
| **Delay unknown** (mostly the Downtown Campus Connector's frequency trips, which have no timetable) | 10% | 9% | 7% | 6% | 3% | 16% |

The first two rows split all samples one way, the next six another way. Delay = the bus's last stop against the
timetable.

**Inefficiency: lateness is not carried forward.** Passio starts a bus's next trip at the printed departure time
whatever the bus's real state, so a bus running late shows up late again. Buses more than 5 minutes late hold 36%
of all misses.

**Inefficiency: no model for headway trips.** The Downtown Campus Connector has no timetable times, and Passio
scores 1% to 10% on it at every lead (section 4).

**Stale and frozen predictions** are rare but mostly wrong:

| Age of the time a rider saw | Share of samples | Gross misses |
|---|---:|---:|
| under 2 min | 92% | 10% to 11% |
| 2 to 5 min | 5% | 17% |
| 5 to 15 min | 2% | 29% |
| over 15 min | 0.3% | 86% |

Likewise, when the bus has stood still more than 5 minutes (a layover), 27% of predictions are gross misses; when
it has sent no recent position, 56%. **Inefficiency: no "this time is doubtful" signal.** The app shows these as
confidently as fresh ones.

## 4. Where and when

**Routes** (10% rule by lead; share of all misses):

| Route | about 5 min | 10 to 15 | 15 to 20 | 20 to 30 | 30 to 45 | Share of misses | Median error at 10 to 15 min |
|---|---:|---:|---:|---:|---:|---:|---:|
| Downtown Campus Connector | 10% | 9% | 6% | 4% | 1% | 14% | -3.9 min |
| 53rd Street Express | 7% | 10% | 14% | 21% | 6% | 14% | -4.0 min |
| Apostolic/Drexel | 6% | 16% | 25% | 28% | 10% | 13% | -2.9 min |
| Red Line/Arts Block | 3% | 6% | 13% | 15% | 8% | 12% | -6.4 min |
| Midway Metra | 7% | 7% | 12% | 4% | 1% | 9% | -4.0 min |
| Friend Center/Metra | 15% | 34% | 47% | 63% | 43% | 8% | -1.6 min |
| East | 13% | 25% | 35% | 45% | 19% | 7% | -2.9 min |
| Central | 8% | 11% | 19% | 31% | 7% | 7% | -3.2 min |
| Apostolic | 4% | 7% | 13% | 26% | 26% | 6% | -3.1 min |
| North | 16% | 34% | 38% | 49% | 42% | 4% | -1.8 min |
| South | 11% | 45% | 59% | 66% | 36% | 3% | -0.5 min |
| Drexel | 12% | 32% | 53% | 53% | 38% | 3% | -2.0 min |

Regents Express and South Loop Shuttle have too few samples to rank (under 1% of misses together).

**Stops.** At 10 to 15 minutes ahead five stops never passed (0%, median error 5.5 to 8.1 minutes): Stony Island
Parking Lot, 57th St. & Metra (NB) and Lake Park & 55th St. on the 53rd Street Express, Drexel Garage (Drexel) and
Kenwood & 63rd (Apostolic), mostly line ends, garages and lots where the layover Passio ignores happens. Next come
the Red Line/Arts Block stops (Washington Park Arts Incubator, Garfield & Wabash, Garfield Red Line Station, Logan
Center, Midway Plaisance & Cottage Grove: 1% to 2%, median error 6.5 to 9.1 minutes). Misses are spread out: no
single stop holds more than 2% of them.

**Time of day and week:**

| When | about 5 min | 10 to 15 | 15 to 20 | 20 to 30 | Share of misses |
|---|---:|---:|---:|---:|---:|
| 5 to 7 AM | 11% | 22% | 36% | 41% | 5% |
| 7 to 10 AM | 8% | 12% | 20% | 23% | 23% |
| 10 AM to 3 PM | 8% | 18% | 26% | 36% | 20% |
| 3 to 7 PM | 6% | 13% | 20% | 27% | 30% |
| 7 to 10 PM | 10% | 22% | 29% | 37% | 16% |
| 10 PM to 5 AM | 15% | 30% | 42% | 53% | 6% |
| Weekdays (Mon to Fri) | 7% to 8% | 13% to 17% | 20% to 24% | 23% to 32% | 93% |
| Saturday | 16% | 37% | 48% | 60% | 5% |
| Sunday | 12% | 25% | 33% | 47% | 2% |

Rush hours are the weakest; Wednesday is the weakest weekday (13% at 10 to 15 minutes). Weekend and late-night
service runs on fewer, lighter routes and scores about twice as well.

**Day by day** (10% rule at 10 to 15 minutes ahead): weekdays 12% to 17% on both weeks (Oct 12 22% with half a day
of data), Saturdays 36% and 38%. Nothing on Passio's side improved between the two weeks.

## 5. The same arrivals, three ways (10% rule)

| Trip | Lead | Arrivals | Passio | Printed timetable | Timetable + current delay |
|---|---|---:|---:|---:|---:|
| current | about 5 min | 26,680 | 7% | **9%** | 8% |
| current | 10 to 15 | 13,829 | 12% | **15%** | 11% |
| current | 15 to 20 | 8,806 | 15% | 15% | **20%** |
| current | 20 to 30 | 4,048 | 16% | 16% | **39%** |
| current | 30 to 45 | 678 | 17% | 17% | **35%** |
| next | about 5 min | 4,745 | **15%** | 15% | 5% |
| next | 10 to 15 | 12,453 | 24% | **31%** | 30% |
| next | 15 to 20 | 15,765 | 33% | **39%** | 38% |
| next | 20 to 30 | 16,316 | 40% | 41% | **58%** |
| next | 30 to 45 | 3,876 | 21% | **38%** | 26% |

Only arrivals where all three had a time (the timetable has none for headway trips); bold = the best, before
rounding. **Inefficiency: Passio's live times are no better than the printed schedule, and the live information
that does help far ahead (the bus's current delay) is not used.** A timetable estimate beats Passio in 9 of the 10
cases.

## 6. How much is recoverable (headroom)

Passio's own times, shifted by a share of the lead learned on **earlier days only** (per stop and trip type, else
per route), scored on October 14 to 24 (11 days). Each cell: 10% rule / band B (10% early to 1% late) / shown later
than the bus came by more than 1% of the lead (the dangerous direction).

| Lead | Passio as shown | Shift tuned for the 10% rule | Shift tuned for band B |
|---|---|---|---|
| about 5 min | 8% / 6% / 11% | 37% / 21% / 48% | 35% / 21% / 39% |
| 10 to 15 min | 17% / 13% / 11% | 48% / 27% / 41% | 45% / 29% / 30% |
| 15 to 20 min | 25% / 20% / 9% | 52% / 29% / 37% | 48% / 33% / 24% |
| 20 to 30 min | 32% / 26% / 8% | 55% / 32% / 36% | 51% / 39% / 21% |
| 30 to 45 min | 15% / 14% / 4% | 48% / 27% / 33% | 44% / 31% / 21% |

The systematic part is large: centring the errors lifts the 10% pass rate to about 50% from 10 minutes ahead on.
But the spread around the centre is wide, so a constant shift moves many predictions to the wrong side: "shown
later than the bus came" goes from about 1 in 10 to 2 to 5 in 10. That fails the ship gate (never too late more
often than Passio) and the 1% rule. **What would close the gap is narrowing the spread**: knowing which bus is late,
standing at its line end or frozen, which is what parts A, B and C of the plan do (`docs/GOAL-AND-METHOD.md` section
5.1). The first learned model (E23, quantile trees) gained up to 2 points in band B; the breakdowns above point at
the features that matter most: trip type, current delay, layover time and route.

## 7. The same numbers under the current goal (10 minute shrink)

| Lead | 10% rule | 10 minute shrink (allowed error) |
|---|---:|---:|
| about 5 min | 8% (30 s) | 23% (1 min) |
| 10 to 15 min | 17% (1 to 1.5 min) | 14% (1 min) |
| 15 to 20 min | 25% (1.5 to 2 min) | 15% (1 min) |
| 20 to 30 min | 32% (2 to 3 min) | 27% (2 min) |
| 30 to 45 min | 15% (3 to 4.5 min) | 14% (3 min) |

Same samples (the daily scoreboard). Under 10 minutes the shrink is looser; from 10 to 30 minutes it is stricter.
Every breakdown above points the same way under either rule.

## 8. Inefficiencies, ranked by how many misses they explain

The shares overlap (a late bus on its current run at rush hour counts in three rows).

| # | Inefficiency | Evidence | Share of misses | Fix (plan part) |
|---|---|---|---:|---|
| 1 | Times are early by a steady share of the lead (no time at stops, short drive times) | 93% of misses are "bus came later"; current-trip error about 25% to 35% of the lead | nearly all | learned correction per stop, lead and trip type (A) |
| 2 | Current run far ahead is the weakest case | 11% to 12% pass at 10 to 30 min | 63% | A, with learned stop and drive times |
| 3 | Lateness not carried into the next trip | over 10 min late: 5% to 10% pass at 15 to 30 min | 36% (buses over 5 min late) | learned line-end departure from the bus's real state (B) |
| 4 | Rush-hour slowdowns not modelled | 7 to 10 AM and 3 to 7 PM weakest | 53% | time-of-day features (A, B) |
| 5 | No model for headway trips | Downtown Campus Connector 1% to 10% | 14% | B with observed headways |
| 6 | No time shown at all far ahead | 45% blank at 20 to 30 min, 83% at 30 to 45 | (not scored) | fill from timetable + delay, labelled "est." |
| 7 | Doubtful times shown as confident | stale over 5 min: 29% to 86% gross; standing over 5 min: 27% gross | small, but the worst errors | detect and fall back or mark (C) |
| 8 | The 10% rule is unmeasurable under 3 minutes | 6 to 18 s windows; detector about 10 s | (scoring) | 1-minute floor (owner's 1.4 decision; the shrink already has it) |

## Caveats

- The arrival detector is accurate to about 10 seconds; under 3 minutes ahead that is a large share of the
  allowance.
- About 1% of arrivals miss a Passio time that was shown (DC-017, open), and arrivals found only by GPS (`gps`
  rows, DC-003) never carry one. Neither changes the picture.
- At a route's first stop Passio predicts the departure, not the arrival, so part of its error there is the dwell
  (814 samples, 0.7% of the total).
- Only two Saturdays and one Sunday; break weeks and bad weather have not been seen yet.

## Rerun it

```
gh release download data-archive-2026-10 -p "eta-*.csv.gz" -D <folder>
MSYS_NO_PATHCONV=1 git show origin/data:data/ground_truth/predictions.csv > predictions.csv
MSYS_NO_PATHCONV=1 git show origin/data:data/ground_truth/arrivals.csv > arrivals.csv
python experiments/routeknower/E24-scripts/shortfalls.py --eta-dir <folder> --predictions predictions.csv --arrivals arrivals.csv --out tables.md
```

About 40 seconds for 15 days. Later months: add the next `data-archive-YYYY-MM` release to the download.

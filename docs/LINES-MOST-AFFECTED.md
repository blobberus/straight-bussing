# Lines most affected by idle buses, odd hours and off-route time (2026-11-06)

Owner, 2026-11-06: "determine 5 bus lines that are most plagued by the scheduling and routing issue and give them to me
so I can advertise to those riders." Measured on the archived bus reports of Oct 10 to Nov 5, 2026 (RouteKnower.md E28,
labeled data in `data/labeled/end_of_service/`), with E27 (off-route time) and E24 (Passio's prediction misses).

How the lines were ranked (`experiments/routeknower/E28-scripts/lines_rank.py`): six measures, each line ranked 1 (worst) to 14 on each, ranks added (lowest sum = most
affected): idle buses the map showed (parked, on a long break or after the shift, not counting normal layovers), Passio
arrival times given for buses that were not going to serve, minutes far from every route line (E27), bus reports
outside the listed hours, the share of listed hours with no live bus at all, and the share of all Passio prediction
misses (E24). Per day = per day the line runs. The app now hides the idle buses (docs/ARCHITECTURE.md "Idle buses that
are not in service"); the numbers below are what riders saw before.

## The five lines

1. **Downtown Campus Connector.** Before this fix the map showed about 4.8 hours of parked or finished buses on an
   average weekday (288 bus-minutes), and on 113 of 116 shift ends Passio still gave arrival times for a bus that was
   parked for the day. It also misses more arrival times than any other line (14% of all misses) and is listed until
   12:25 AM although its last bus usually serves around 10:05 to 10:35 PM.
2. **Apostolic/Drexel.** About 2 hours a weekday of idle buses on the map (119 bus-minutes), including a nightly wait
   at Goldblatt Pavilion after the last trip (from about 11:50 PM), with Passio still predicting them (56 minutes of
   predictions a day for buses that were not coming). 13% of all prediction misses.
3. **Red Line/Arts Block.** About 2 hours a weekday of idle buses on the map (122 bus-minutes): buses resting up to an
   hour at the Logan Center with no arrival time, shown as if in service. Its arrival times have the largest typical
   error of any line (6.4 minutes at 10 to 15 minutes ahead), and on Nov 5 one bus ran 7 hours on a trip the timetable does
   not list, with no arrival times at all.
4. **East (NightRide).** Listed until 4:29 AM, but no East bus reports a location after about 12:05 AM: 35% of its
   listed hours have no live bus. Its last bus waits at the Reynolds Club stop (57th and University, beside Regenstein)
   until midnight with Passio times for a midnight trip it runs only partly, if at all (twice in 27 nights it went on
   past campus to Hyde Park). It also spends the most NightRide time far from its line (493 bus-minutes).
5. **Midway Metra.** Buses keep the Midway Metra name outside its listed hours (between the morning and afternoon runs,
   and 12 to 36 minutes past the 6:55 PM end): about 75 minutes of bus reports a day outside the listed times, and 19%
   of its listed time had no live bus. 9% of all prediction misses.

Close behind (the same midnight pattern as East): **Central** (listed until 11:14 PM, but a bus drives one more loop and
waits at Reynolds Club until midnight every night: 57 minutes a day outside its listed hours),
**South** (about an hour a day of idle buses, ending each night at Burton-Judson Courts) and **North** (the bus the owner
saw at Reynolds Club at 11:50 PM; like East, 35% of its listed hours have no live bus).

## Numbers behind the ranking

| Line | Rank sum | Idle shown, bus-min/day | Shift ends/day | Passio times for idle buses, min/day | Far from every line, bus-min (E27, 25 days) | Reports outside listed hours, min/day | Listed time with no live bus | Share of all misses (E24) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Downtown Campus Connector | 24 | 288 | 6.1 | 139 | 2,100 | 5 | 11% | 14% |
| Apostolic/Drexel | 28 | 119 | 3.4 | 56 | 605 | 25 | 6% | 13% |
| Red Line/Arts Block | 31 | 122 | 1.3 | 28 | 654 | 24 | 4% | 12% |
| East | 37 | 29 | 1.3 | 13 | 493 | 12 | 35% | 7% |
| Midway Metra | 40 | 34 | 1.0 | 5 | 46 | 75 | 19% | 9% |
| Central | 43 | 34 | 1.7 | 13 | 133 | 57 | 3% | 7% |
| South | 43 | 63 | 1.4 | 24 | 321 | 3 | 35% | 3% |
| North | 43 | 34 | 1.3 | 12 | 339 | 7 | 35% | 4% |

Caveats: the labels come from what each bus did next (data/labeled/end_of_service/README.md); the collector missed
Nov 5 10:39 AM to 12:39 PM and Oct 28 7:31 to 8:11 PM; "no live bus" after midnight may mean the night buses run without
GPS, the data cannot tell. This is an unofficial analysis of public feed data, not a statement by the operator.

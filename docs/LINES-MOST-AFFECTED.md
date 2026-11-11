# Lines most affected by idle buses, odd hours and off-route time (2026-11-06; checked against the flagged lines 2026-11-11)

Owner, 2026-11-06: "determine 5 bus lines that are most plagued by the scheduling and routing issue and give them to me
so I can advertise to those riders." Measured on the archived bus reports of Oct 10 to Nov 5, 2026 (RouteKnower.md E28,
labeled data in `data/labeled/end_of_service/`), with E27 (off-route time) and E24 (Passio's prediction misses).

How the lines were ranked (`experiments/routeknower/E28-scripts/lines_rank.py`): six measures, each line ranked 1 (worst) to 14 on each, ranks added (lowest sum = most
affected): idle buses the map showed (parked, on a long break or after the shift, not counting normal layovers), Passio
arrival times given for buses that were not going to serve, minutes far from every route line (E27), bus reports
outside the listed hours, the share of listed hours with no live bus at all, and the share of all Passio prediction
misses (E24). Per day = per day the line runs. The app now hides the idle buses (docs/ARCHITECTURE.md "Idle buses that
are not in service"); the numbers below are what riders saw before.

## Checked against the flagged lines (2026-11-11)

The flagged-lines registry (`data/labeled/flags/flagged_lines.csv`, per line in `docs/FLAGGED-LINES.md`) measures two
things this ranking did not: odd bus behavior at transition times (RouteKnower E30) and large prediction misses
(E31), on the data through Nov 10, each line's rate against all lines'. Those two gave 77 flags on 14 lines, 27 of
them high. Since Nov 11 it also holds E32's 22 display flags (what the shipped display rules showed riders, replayed
Oct 10 to Nov 10): 99 flags, 30 high. E32's three high flags: **South**, the idle rule hid a still bus that then
served the line within 15 min in 47% of its hidden minutes (all lines 24%; 9 to 10 PM and 11 PM to midnight, 60th St.
& Ellis and Regenstein Library); **Friend Center/Metra**, the off-route rule did the same 53% of the time (all lines
20%; 6 to 9 PM, buses 4325 and 4313, Goldblatt Pavilion); the **Downtown Campus Connector**, 18% of the planner's
live bus legs used a bus that left the line before the rider's stop (all lines 7%). With them the Downtown Campus
Connector and South reach 4 high flags, level with the 53rd Street Express; the table below counts E30 and E31 only.
A flag alone never hides or shows a bus: the display rules change only with the owner's decision.

**All five lines below stay flagged**, with new evidence:
- **Downtown Campus Connector**, 3 high flags: its last bus left more than 15 min before the listed end on 22 of 22
  weekdays (all lines: 28 per 100 listed spans); bus 12647 reports only every few minutes; at seven stops
  (downtown, Lake Park and 55th & University) 2% of the arrivals of the last 14 days had a Passio time 5 min ahead
  (89% before).
- **Apostolic/Drexel**, 3 high: the last bus left early on 21 of 22 weekday nights; at 61st & Kimbark 0.2% of
  arrivals had a time 5 min ahead; at 57th Street & Drexel the screen often showed only the bus's next trip, and 74%
  of those times missed by more than 2 min.
- **Red Line/Arts Block**, 2 high: 80% of Passio's times 5 to 30 min ahead were too early by more than the large-miss
  threshold (the bus came later; all lines 55%), the same as in October; at Midway Plaisance & Cottage Grove 2% of
  arrivals had a time 5 min ahead.
- **East**, 2 high: at night the bus came earlier than shown by more than the threshold 18% of the time 5 to 15 min
  ahead in the last 14 days (3% before; all lines 11%): a rider who trusts the time can miss it; at Regenstein Library,
  Max Palevsky and Ellis Garage 6% of arrivals had a time 5 min ahead.
- **Midway Metra**, 1 high: buses report under its name after its listed hours (twice the all-lines rate, mostly 7
  to 8 PM on the way to the garage); medium: the morning's extra listed bus often does not come, the last morning bus
  leaves early, and buses drive another line's road under its name.

**Lines as affected as these that the ranking left out**, by high flags:
- **53rd Street Express**, 4 high, more than any line: since Oct 27, 22% of Passio's times 5 to 20 min ahead were
  beaten by the bus by more than the threshold (1.4% before); at 53rd St & Kenwood and Kimbark Plaza the screen 5 min
  ahead showed only the bus's next trip, and all 330 of those times were wrong; at three stops 8% of arrivals had a
  time 5 min ahead (87% before); the last bus left early on 19 of 22 weekdays.
- **Central**, 3 high: buses report under its name after its hours 7.5 times as often as all lines (near midnight, to
  the garage); since Oct 27 the bus beat Passio's time by more than the threshold 24% of the time at night (4.5%
  before); 212 of 213 next-trip-only times were wrong (the bus came earlier).
- **South**, 3 high: buses linger on the map not in service three times as often as all lines (Burton-Judson Courts,
  8 PM to midnight), the bus beats Passio's time at night (12% against 7%), and misses grow when a bus runs behind.
- **Apostolic**, 3 high: bus 4322 vanishes from the feed mid-route and jumps position on weekday mornings (South
  Campus Residence Hall, Woodlawn & 61st); at Wyler Pavilion 4% of arrivals had a time 5 min ahead.

**What changed and why.** The Nov 6 ranking weighted what the map showed (idle buses, which the app now hides) and
each line's share of all misses (bigger lines have more of them). The flags compare each line's rate with all lines'
and include the change of Tuesday Oct 27, about 6 PM, after which Passio's times run late (the bus comes earlier than
shown) on the 53rd Street Express, Central, East and the Downtown Campus Connector (E31; docs/DATA-COLLECTION-LOG.md
DC-025, DC-026). By the flags alone (high flags, then medium) the five would be:

| Rank by flags | Line | High | Medium | Low | On the Nov 6 list |
|---:|---|---:|---:|---:|---|
| 1 | 53rd Street Express | 4 | 0 | 0 | no |
| 2 | Apostolic/Drexel | 3 | 5 | 0 | 2nd |
| 3 | Central | 3 | 3 | 0 | close behind |
| 4 | Downtown Campus Connector | 3 | 3 | 0 | 1st |
| 5 | Apostolic | 3 | 2 | 0 | no |
| 6 | South | 3 | 1 | 2 | close behind |
| 7 | East | 2 | 3 | 0 | 4th |
| 8 | Red Line/Arts Block | 2 | 1 | 2 | 3rd |
| 10 | Midway Metra | 1 | 3 | 2 | 5th |

(9th: Drexel, 1 / 3 / 4.) Counting flags is coarse: one flag can matter more to riders than three. The owner decides
whether the advertised five change; for rider safety the lines where the bus now comes earlier than shown (53rd
Street Express, Central, East, Downtown Campus Connector) matter most. Refresh: `python tools/flag_lines.py` after the
producers rerun (data/labeled/flags/README.md).

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

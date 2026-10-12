# Huge prediction errors: what they are, which to ignore, how to stop logging them

Date 2026-10-12. Data: `arrivals.csv` snapshot (data commit `2c7f653`, 9,569 rows, Oct 8 05:00 to Oct 12 11:35 CDT;
9,180 rows carry a stored Passio prediction), raw vehicle-position polls from the CI artifacts (Oct 10 02:51 to
Oct 12 11:36 CDT, 28,441 polls, 59,832 reports, 18 buses; cover 2,646 of the predicted arrivals), the public GTFS zip
(timetable, times at timepoints, intermediate stops interpolated by sequence). Error e = predicted - actual:
**e > 0 = the bus came before the predicted time (dangerous: a rider misses it)**, e < 0 = the bus came late.
"Post-fix" = logged after the 2026-10-10 collector fixes (B1-B4, effective about 05:18 CDT).

## 1. How big is the tail?

|error| percentiles (s), stored prediction, by lead and trust (E01 `clean_dicts` rules):

| set | lead s | n | p50 | p90 | p95 | p99 | > 5 min | > 10 min | > 20 min |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| clean | 120-180 | 5,816 | 48 | 124 | 156 | 482 | 90 | 40 | 4 |
| clean | 180-300 | 881 | 76 | 226 | 279 | 846 | 38 | 21 | 4 |
| untrusted (shared trip / loop start) | 120-180 | 1,541 | 73 | 1,017 | 1,579 | 2,875 | 360 | 253 | 132 |
| untrusted | 180-300 | 169 | 135 | 845 | 1,611 | 3,560 | 35 | 23 | 12 |
| untrusted (stale) | 300-600 | 374 | 183 | 502 | 1,126 | 3,384 | 123 | 24 | 17 |
| untrusted (stale) | 600+ | 399 | 620 | 1,806 | 2,371 | 3,053 | 263 | 206 | 90 |

Counts by |error| band:

| set | n | 0-1 min | 1-2 | 2-3 | 3-5 | 5-10 | 10-20 | 20-40 | 40-60 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| post-fix, lead < 300 s (the honest 2-min horizon) | 2,336 | 1,508 | 607 | 147 | 48 | 15 | 6 | 5 | 0 |
| post-fix, lead >= 300 s (stale) | 310 | 90 | 42 | 36 | 31 | 41 | 49 | 20 | 1 |
| pre-fix, every lead | 6,534 | 3,130 | 1,718 | 597 | 315 | 287 | 253 | 169 | 65 |

**Where "huge" starts.** The core falls by 3 to 4 times per band out to about 5 minutes (signed histogram: -240..-120 s
865 rows, -360..-240 171, -480..-360 62). Beyond about 5 to 6 minutes the counts stop decaying and form a flat plateau
out to the logger's 1-hour cap (30 to 90 rows per 2-minute bin on the positive side, 12 to 60 on the negative). A flat
plateau over a whole headway / loop (20 to 30 min, DCC about 100 min) is the signature of a *different population*:
predictions that belong to another bus, another lap or another trip, or that were never refreshed. So at the
2-minute horizon, **huge = |error| above 5 minutes** (9.9% of all rows, but only **1.1% of post-fix rows at a real
2-minute lead**). The plateau is overwhelmingly positive (bus "early") for the logger bugs and overwhelmingly negative
(bus late) for stale predictions.

## 2. Causes (one per row, assigned in this order; scripts in section 6)

| code | cause | how it was identified |
|---|---|---|
| A1 | **Logger: shared trip id before the B1 fix** | not E01-clean because another bus ran the same trip id within 45 min, logged before 2026-10-10. Downtown Campus Connector runs every bus on trip 874028; the old logger keyed predictions by trip + stop, so buses overwrote each other's predictions |
| A2 | **Logger: loop start before the B1 fix** | stop index 0 before the fix: one update predicts the terminal as stop 1 and as stop N |
| A3 | **Logger: the prediction is this bus's other lap** | the predicted time is within 90 s of this same bus's previous or next visit to this stop (Passio sometimes keeps one trip id for two laps; the stored prediction was made before the bus's previous pass) |
| A4 | **Logger: prediction matches another bus of the same route (pre-fix)** | another bus of the route reached this stop within 60 s of the predicted time, before the fix (hidden trip-id sharing that our own rows did not show) |
| A5 | **Detector: the bus was not at the stop** | the bus's raw track (polyline of its reports, +-90 s) never came within 100 m of the stop |
| R1 | **Stale: bus standing (layover / hold), no fresh prediction** | stored prediction >= 5 min old (no newer update for this bus + trip + stop) and the bus stood still >= 3 min (raw polls) or dwelled >= 3 min |
| R2 | **Stale, other** | stored prediction >= 5 min old, no standing evidence (often no raw coverage) |
| R3 | **Passio: prediction already in the past when it was made** | predicted time more than 60 s before the update's own timestamp: Passio said "already there" for a bus that was still minutes away |
| R4 | **Passio: bus more than 10 min off its trip's timetable** | actual vs the trip's timetable > 10 min: Passio and the bus disagree about which run / slot the bus is on |
| R5 | **Loop start after the fix** | stop index 0, post-fix |
| R6 | **Unexplained real large miss** | none of the above |

**All rows with |error| > 5 min** (n = 909; 9.9% of the 9,180 predicted arrivals):

| cause | rows | share | bus came early (e > 0) | median abs error | top routes |
|---|---:|---:|---:|---:|---|
| A1 shared trip id, pre-fix | 361 | 40% | 99% | 14 min | Downtown Campus Connector 288, 53rd Street Express 26, East 22 |
| A2 loop start, pre-fix | 36 | 4% | 81% | 16 min | Downtown Campus Connector 14, Apostolic/Drexel 8 |
| A3 other lap | 48 | 5% | 8% | 22 min | Apostolic/Drexel 13, East 8, South 8 |
| A4 another bus of the route, pre-fix | 65 | 7% | 14% | 10 min | Downtown Campus Connector 39, Apostolic/Drexel 14 |
| A5 detector | 1 | 0% | 0% | 7 min | Central 1 |
| R1 stale, bus standing | 91 | 10% | 4% | 12 min | Drexel 28, East 26, Apostolic 14 |
| R2 stale, other | 191 | 21% | 22% | 9 min | Downtown Campus Connector 46, Red Line/Arts Block 35, Drexel 24 |
| R3 prediction in the past | 20 | 2% | 0% | 10 min | Apostolic/Drexel 13, Red Line/Arts Block 4 |
| R4 bus off its timetable | 47 | 5% | 98% | 10 min | Apostolic/Drexel 20, South 9, Friend Center/Metra 5 |
| R5 loop start, post-fix | 4 | 0% | 100% | 10 min | South Loop Shuttle 4 |
| R6 unexplained | 45 | 5% | 100% | 9 min | Red Line/Arts Block 12, 53rd Street Express 8, North 5 |

**Post-fix rows with |error| > 5 min** (n = 137; 5.2% of the 2,646 post-fix predicted arrivals, 1.1% at leads under 5 min):

| cause | rows | share | bus came early | median abs error | top routes |
|---|---:|---:|---:|---:|---|
| A3 other lap | 15 | 11% | 0% | 29 min | South 6, East 4, Drexel 3 |
| A5 detector | 1 | 1% | 0% | 7 min | Central 1 |
| R1 stale, bus standing | 70 | 51% | 4% | 12 min | Drexel 25, East 20, South 10 |
| R2 stale, other | 26 | 19% | 4% | 8 min | Central 20 |
| R3 prediction in the past | 3 | 2% | 0% | 12 min | Apostolic 3 |
| R4 bus off its timetable | 12 | 9% | 92% | 9 min | South 9, South Loop Shuttle 2 |
| R5 loop start | 4 | 3% | 100% | 10 min | South Loop Shuttle 4 |
| R6 unexplained | 6 | 4% | 100% | 34 min | North 3 |

The B1 fix removed the biggest class (A1 + A2 + A4 = 51% of all huge errors, all pre-fix). **What is left is mostly
stale predictions around layovers (70% of post-fix huge errors).**

### What each cause is, with evidence

- **A1/A2/A4, pre-fix logger mixing buses (462 huge rows).** Downtown Campus Connector errors cluster at one and two
  headways and run to the 1-hour cap (+3,597 s at 59th & Ellis, bus 12646, Oct 9 11:48). Apostolic/Drexel bus 4322 on
  Oct 8 18:10-18:12 shows the same -514 to -565 s at five consecutive stops while another bus of the route reached
  each stop at the predicted time: the stored predictions were the other bus's. Gone since 2026-10-10 (predictions are
  kept per bus); the remaining risk is a trip update that comes without a vehicle id (the logger then falls back to
  the trip's predictions).
- **A3, another lap of the same bus (48; 15 post-fix).** East bus 4318 at Regenstein Library (N), Oct 11 20:16: the
  stored prediction was made 1,864 s earlier and pointed at 20:16 minus 1,867 s, which is exactly this bus's previous
  pass (1,831 s earlier) and the trip's timetable time (-64 s). The bus stood 589 s at the terminal, did another lap
  under the same trip id, and the logger matched the first pass's prediction to the second pass. Riders were not shown
  that number for the second pass (the trip had passed the stop). 44 of the 48 are caught by one rule: **the
  prediction was made before this bus's previous visit to the stop** (that rule flags 65 rows in total, all with
  |error| > 5 min, median 21 min).
- **A5, detector (1 huge, 4 in all).** With the raw track, only 4 of 2,642 arrivals (0.15%) had a bus that never came
  within 100 m of the stop: Central bus 4322 at 57th St. & Metra (SB), Oct 11 21:32 (track 771 m away; this bus
  normally runs Apostolic and served Central that evening), Reynolds Club and Levi Hall (W) about 200 m, and Midway
  Metra at Bernard Mitchell Hospital (102 m; the Midway Metra variant that skips Bernard Mitchell, E01). A
  single-report check flagged 23 rows, but 19 of those were sparse reports (a bus moves 100-300 m between reports),
  not detector errors. The detector is not a meaningful source of huge errors.
- **R1/R2, stale predictions (282; 96 post-fix): the main remaining cause.** 773 rows have a stored prediction 5 min
  or more old; 84% of them are buses that came *late*, the stop is the 1st to 3rd after a terminal in 60% (index 1:
  193, 2: 144, 3: 130), the trip id changed after the prediction in 57%, and where raw polls exist the bus stood still
  >= 3 min in 51-94% of each error band. Example: East bus 4538, Oct 11 17:29-17:30 at Regenstein Library (N) and Max
  Palevsky: the prediction was made 26-27 min before the arrival and equalled the timetable (+155 to +194 s); the bus
  then stood 1,470 s (24.5 min) at its layover, switched trip id and arrived 25-26 min late. Drexel bus 4324 at
  Goldblatt Pavilion, Oct 12 07:34: prediction 40 min old, bus stood 475 s, arrived 40 min after it. So Passio keeps
  showing the timetable time (or its last estimate) for the next run while the bus sits, and does not move it.
  **This is a rider-facing failure** (the app said "due" while the bus was still on layover), *unless* Passio had
  stopped publishing that prediction (then the rider saw nothing): the logger does not record when a prediction was
  last published, so the two cannot be told apart yet (fix 3 below).
- **R3, prediction in the past (20; 3 post-fix).** Apostolic bus 4322 on Oct 12 06:03-08:12 (Levi Hall (W), Apostolic
  Lot): Passio's prediction equalled the timetable (-21 s) while the bus ran 10-12 min late, and was already in the
  past when published (-389 to -997 s). Rider-facing (the bus shows "now" for minutes), late side.
- **R4 and R6, Passio on the wrong run (92 rows in 46 bus-episodes; 98-100% of them the bus came EARLY).** These come
  in runs: one bus, consecutive stops, a near-constant error. South bus 4315, Oct 11 23:02-23:37 (two laps): the bus
  ran 21-27 min behind its trip's timetable and Passio predicted 33-35 min behind, so the bus came 5 to 12 min before
  the shown time at every stop. North bus 4318, Oct 10 16:16-16:18, its first lap of the day: on time to the
  timetable (-175 s) but Passio showed 32-35 min later (+2,040 to +2,088 s), i.e. the next run. South Loop Shuttle at
  57th St. & Metra (SB): Passio showed the timetable (+211 s) while the bus came 36 min early. 53% of these rows are a
  bus's first lap, last lap of the night, or after 9 PM. **Real and dangerous for riders: never ignore these.**
- **R5, loop start (4 post-fix).** South Loop Shuttle at Reynolds Club (index 0): Passio's "prediction" is exactly the
  scheduled departure (pred - timetable = -1 to 0 s); the bus arrives 7-10 min early and waits (error minus dwell =
  -2 to +52 s). Not a rider failure: compare the origin stop against departure (epoch + dwell_s), not arrival.

## 3. Rule for scoring the "10% rule" (|error| <= 10% of the lead)

1. **Score Passio only on post-fix data** (logged from 2026-10-10 05:18 CDT). The pre-fix logger bugs (A1, A2, A4)
   are not detectable row by row (A4 is hidden sharing), and they are 51% of all huge errors.
2. **Exclude logger attribution mistakes** (these are not what riders saw):
   - the prediction was made before (or within 60 s of) this bus's previous arrival at this stop: removes 65 rows
     overall (0.8%), 28 post-fix (1.1%), all huge;
   - the bus's raw track never came within 100 m of the stop (only where raw polls exist): 4 of 2,642 (0.15%).
3. **Loop-start stops (index 0): score against departure** (epoch + dwell_s) when Passio's origin time is the
   scheduled departure (South Loop Shuttle), or report them as their own slice.
4. **Gross misses: excluded from the accuracy share, never from the report.** Flag |error| > max(10 min, 0.5 x lead)
   (5 times the 10% tolerance, past the decaying core and into the flat plateau). Post-fix this flags 50 of 2,646
   rows (1.9%: 9 bus early, 41 bus late; mostly R1 stale), 10 of 2,336 (0.4%: 8 early, 2 late) at leads under 5 min.
   Report the gross rate per direction next to the 10%-rule score; **gross "bus came early" counts toward the "under
   1% too late" target** (it is the rider-missed-the-bus case) and must not be dropped.
5. **Do not exclude** R1-R4 and R6 as "data mistakes": they are Passio showing a wrong time to riders (stale during
   layovers, already-past times, the wrong run). If the new logging (fix 3) shows a stale prediction was no longer
   published, reclassify it as "no prediction shown" (a separate, also rider-facing, count).
6. Effect at the 2-minute horizon, post-fix, after rules 1-2: |error| > 3 min 3.0%, > 5 min 1.0%, > 10 min 0.4%;
   "bus came more than 5 min early" 0.86%. With stale rows included: > 5 min 4.4%, > 10 min 2.4%.

## 4. Collector fixes for the multi-lead logging

1. **Previous-visit rule (prevents A3):** for each arrival, consider only predictions made after this bus's previous
   arrival at this stop (and whose predicted time is after that arrival plus 60 s). Needed at every lead; at 20 to
   30 min leads it matters most, because a 30-min lead reaches back across a whole loop.
2. **Per bus, always (B1, done):** keep predictions keyed by trip_update.vehicle.id; use the trip-level (no vehicle)
   fallback only when exactly one bus is on that trip id; log which one was used.
3. **Record when each prediction was last published** (`last_seen`: the last poll whose trip update still carried
   that stop time), and pick, for lead L, the prediction **on display at arrival minus L** (made <= arrival - L and
   last_seen >= arrival - L). If none was on display, write "no prediction shown": that separates R1/R2 into
   "Passio showed an old time" vs "Passio showed nothing".
4. **Store the prediction's own trip id and stop_sequence, and the bus's trip id at the time it was made**: makes A3,
   R4 (wrong run) and loop terminals visible without guesswork.
5. **Store first_seen (our poll time) next to Passio's timestamp:** shows whether Passio froze its timestamp while a
   bus stood (the stale cases).
6. **Origin stops: keep the departure time** (epoch + dwell_s is already derivable; Passio predicts departure there).
7. **Keep the raw position polls** (they decided A5 and the standing evidence); a compact tripUpdates snapshot per
   poll as a 90-day artifact would let any lead be re-scored offline.
8. **Route variants** (Midway Metra skipping Bernard Mitchell / 57th St. & Metra (SB); Central served by bus 4322 at
   57th St. & Metra (SB)): resolve the trip's own stop pattern from GTFS (E01 extra finding) so no arrival is logged at
   a stop the trip does not serve.
9. Keep the existing `abs(pred - epoch) < 3600` guard; with the previous-visit rule it no longer has to catch laps.

## 5. Real problems for riders found on the way (not data mistakes)
- Layovers: Passio does not move the next run's times while a bus sits at a terminal (Drexel, East, Apostolic, South,
  Central, Midway Metra early mornings and evenings). The first 1-3 stops after a terminal carry most huge late errors.
- Wrong run: at first laps, last laps and at night, Passio sometimes shows a bus a whole loop (or its timetable) away
  while the bus comes 5 to 35 min earlier. 92 rows, 46 episodes in 4.5 days.

## 6. Reproduce (scratchpad `rk/`, stdlib Python)
```
python tools/raw_fetch.py --out <scratch>/rk/raw          # raw polls (the default data/raw_polls replace step fails on this PC)
python he_tail.py arrivals.csv                             # section 1
python he_classify.py <scratch>/rk/arrivals.csv            # per-row evidence -> he_rows.json
python he_sched2.py                                        # timetable times (downloads the public GTFS zip once)
python he_detector.py                                      # raw-track detector check
python he_final.py                                         # causes, tables, examples -> he_causes.md
```

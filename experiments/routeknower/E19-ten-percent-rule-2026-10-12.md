# E19: The 10% rule, and what the huge errors are
Date: 2026-10-12 · Agent/person: Claude, two parallel analyses (owner request) · Data: `data` branch `2c7f653`,
`arrivals.csv` 9,569 rows, 2026-10-08 04:59 to 2026-10-12 11:35 CDT, sha256 `01854f649381cc08...`; raw position
polls (CI artifacts, Oct 10 02:51 to Oct 12 11:36, 28,441 polls); the public GTFS zip.
Full reports: [`E19-ten-percent-report.md`](E19-ten-percent-report.md) (tables by lead, route, slice, safety
shift), [`E19-huge-errors-report.md`](E19-huge-errors-report.md) (tail, causes, examples, rule, collector fixes).

**The owner's goal ("the 10% rule"):** a prediction made L before the arrival is right to 10% of L: 1 minute at
10 minutes ahead, 3 minutes at 30 minutes ahead. Also: "most arrival times should be under 1% too late (as in the
prediction predicts a time later than the actual arrival time)". Error = predicted - actual; **positive = too
late** (the bus came early: the rider can miss it). The 1% sentence has three readings, all reported:
**A1** fewer than 1% of predictions too late at all; **A2** fewer than 1% too late by more than 10% of L;
**B** each prediction may be up to 10% of L too early but at most 1% of L too late ("most" of them).
Huge errors are left out of the accuracy shares as the owner asked, but every one is classified and counted.

## 1. Where we stand (rolling origin by service day, 4 test days, huge errors left out)

| source | lead | n | 10% rule | 10%, 1-min floor | band B | too late at all (A1) | too late > 10% L (A2) |
|---|---|---:|---:|---:|---:|---:|---:|
| Passio (what riders see) | 2-5 min | 6,912 | 13% | 60% | 9% | 13% | 8% |
| ours (learned run times from the last logged stop) | 10 min | 5,536 | 30% | 30% | 19% | 27% | 15% |
| timetable + the bus's current delay | 10 min | 4,612 | 14% | 14% | 8% | 41% | 34% |
| ours | 30 min | 2,459 | 20% | 20% | 15% | 11% | 6% |
| ours, leaving the terminal at the scheduled start | 30 min | 2,454 | 40% | 40% | 23% | 39% | 20% |
| timetable + the bus's current delay | 30 min | 2,005 | **63%** | 63% | 60% | 12% | 9% |

- **No source meets the 10% rule at any lead yet.** At 2 minutes ahead the literal rule is 12 to 30 seconds,
  below what the app shows (whole minutes) and near the detector's +-10 s; with a 1-minute floor Passio passes 60%.
- **Passio 10 to 30 minutes ahead could not be scored**: the collector kept only its 2-minute prediction (E01 B5).
  Fixed today (section 4); the first honest Passio numbers at 10 and 30 minutes need about a week of the new file.
- **The 1% rule:** reading B (most predictions at most 1% too late) already holds for Passio at 2-5 min (87% are)
  and for ours. A1 and A2 (fewer than 1% too late) do not: shifting predictions earlier until only 1% are too late,
  learned on earlier days, leaves 2% of Passio's predictions within 10% (with the 1-minute floor; ours at 10 min: 5%). With today's
  spread only reading B is reachable; the owner should confirm which one is meant.
- **Biggest long-lead error sources:** layovers at terminals (our model leaves too soon: median -309 s at 30 min);
  trip ids that name an earlier scheduled run than the one the bus drives (10 to 20 min, on most routes; only
  Friend Center/Metra matches its timetable), which also breaks the plain timetable; buses whose last logged stop is
  5 to 25 min old (standing or idle: 9% pass at 30 min).

## 2. What the huge errors are (2-minute predictions, all 9,180 with a stored prediction)

Errors fall off steadily out to about 5 minutes, then flatten into a plateau out to an hour: a different population.
909 rows (9.9%) are off by more than 5 minutes, but only **1.1% of post-fix rows at a real 2-minute lead**.

| cause | rows | share | bus came early | status |
|---|---:|---:|---:|---|
| Logger: buses sharing a trip id overwrote each other's predictions (before the 2026-10-10 fix) | 361 | 40% | 99% | fixed (B1); not what riders saw |
| Logger: loop start, before the fix | 36 | 4% | 81% | fixed (B1) |
| Logger: matched another bus of the route, before the fix | 65 | 7% | 14% | fixed (B1) |
| Logger: the prediction was for the bus's other lap | 48 | 5% | 8% | fixed today (previous-visit rule) |
| Detector: the bus was never at the stop | 1 | 0% | | negligible (4 of 2,642 checked against raw tracks) |
| **Passio stale while the bus stands at a terminal**, then leaves late | 91 | 10% | 4% | **real, riders saw it** |
| Passio stale, other | 191 | 21% | 22% | real |
| Passio's prediction was already in the past when made | 20 | 2% | 0% | real |
| **Passio on the wrong run** (bus more than 10 min off its trip's timetable) | 47 | 5% | 98% | **real and dangerous** |
| Loop start after the fix (Passio predicts the departure there) | 4 | 0% | 100% | score against departure |
| Unexplained | 45 | 5% | 100% | real |

After the fixes, **70% of the remaining huge errors are stale predictions around layovers**. The dangerous
case is the wrong run: 92 rows in 46 episodes in 4.5 days, the bus 5 to 35 minutes *earlier* than shown, mostly on
first or last laps and after 9 PM (examples in the full report).

**Rule for scoring (adopted):** score Passio on rows from 2026-10-10 05:18 CDT on; drop logger attribution mistakes
(prediction made before the bus's previous visit to the stop; bus never near the stop); at a route's first stop
compare with the departure (epoch + dwell_s); flag gross misses, |error| > max(10 min, 0.5 x lead), and leave them
out of the accuracy share **but report them by direction**: a gross "bus came early" still counts against the 1%
rule. Never drop stale, already-past, wrong-run or unexplained misses: riders saw those numbers.

## 3. Significance
4 test days and one weekend: descriptive only (protocol 6.5 needs 10 days). The gaps to the goal (13% to 63% against
"most") are far larger than the day-to-day spread.

## 4. Collection changes made (commits `fd377aa` and the E19 commit)
The arrivals file keeps its 25 columns. New `data/ground_truth/predictions.csv`: Passio's prediction 1, 2, 3, 5, 10,
15, 20 and 30 minutes before every arrival (schema in `docs/DATA.md`), merged by every CI run and the local
collector; every prediction update is also kept as the artifact `pred-updates-<run>` (90 days) for re-scoring.
Attribution rules, from the huge-error causes:
1. **Previous visit:** a prediction made before the bus's previous visit to the stop (or predicting a time within
   120 s of it) belongs to the earlier lap; skipped unless its stop_sequence names this visit (loop terminals).
2. **Per bus:** an update without a vehicle id counts only when no other bus has that trip id.
3. **First seen:** Passio sometimes changes the predicted time and keeps its old timestamp (57 of 651 updates
   today), so a prediction counts from when our poll first saw it, never earlier.
4. **On display:** for lead L, only the prediction Passio was still showing at arrival minus L (a poll saw it within
   90 s); none shown = no row, counted separately from "showed an old time".
Not done yet: storing the bus's own trip id when each prediction was made (makes the wrong run visible directly; the
raw polls plus the update artifact allow it offline), and route variants (Midway Metra's second pattern, E01).

## Decision
**The goal is far off with every source we can score today; Passio's long-lead accuracy is unknown until the new
file has about a week of data.** Next: E20 scores Passio at 1 to 30 minutes from `predictions.csv` (first look Oct 19,
decision at T1 ~Oct 22). Our own model would need a layover model (when does the bus leave the terminal, per
scheduled slot), run matching (which scheduled run the bus is really on) and a standing-bus rule before it can
approach the rule at 10 to 30 minutes. Owner to confirm the reading of the 1% rule.

## Reproduce
```
MSYS_NO_PATHCONV=1 git show 2c7f653:data/ground_truth/arrivals.csv > "$TEMP/rk/arrivals.csv"
curl -o "$TEMP/rk/google_transit.zip" https://passio3.com/chicago/passioTransit/gtfs/google_transit.zip
python tools/rk_ten_percent.py "$TEMP/rk/arrivals.csv" "$TEMP/rk/google_transit.zip" --out "$TEMP/rk/ten.md"
```
The huge-error scripts are kept as run in `E19-scripts/` (see its README).

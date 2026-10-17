# The accuracy goal, in plain English (2026-10-17)

What "a good arrival time" means for Straight Bussing, how it is checked, and where things stand. The full
technical version is `docs/GOAL-AND-METHOD.md`; how the data is collected is `docs/HOW-DATA-IS-COLLECTED.md`.

## 1. The goal: the "10 minute shrink"
A time shown to a rider is good if it is close enough to when the bus really came. How close depends on how far
ahead it was shown:

| How far ahead the time was shown | It must be right within |
|---|---|
| 30 minutes or more | 3 minutes |
| 20 to 30 minutes | 2 minutes |
| 10 to 20 minutes | 1 minute |
| under 10 minutes | 1 minute |

This replaced the first goal, the "10% rule" (right within 10% of the time ahead). The old numbers are kept next
to the new ones so the two can be compared.

## 2. "Too late" is the costly mistake
If the app shows a later time than the bus really comes, a rider can miss the bus. If it shows an earlier time,
the rider just waits a little. So a time may be off a little on the early side, but almost never on the late side.
The aim is fewer than 1% "too late".

## 3. Under 10 minutes, each bus is checked only once
Close to the stop, a model could cheat: by always saying "1 minute away" it would be right whenever the bus is
about to arrive, and useless before that. So under 10 minutes each bus is checked **once**, using the time that was
shown about **5 minutes** before it came. There, a constant "1 minute" is 4 minutes off and fails. A model cannot aim
for that moment either, because it never knows exactly when the bus will come.

## 4. How the checking works
- Every day, for every bus that reached a stop, the collector compares what was shown with when the bus came.
- Each bus counts **once** per range (under 10, 10 to 15, 15 to 20, 20 to 30, 30 to 45 minutes ahead), never once
  per minute, so a long wait does not count more.
- Huge misses (more than 10 minutes off) are counted separately, so one strange bus does not hide everything else.
- A new way of predicting may only be shown to riders after it beats Passio on **at least 10 test days** it never
  learned from, without being too late more often, and without being much worse on any route.

## 5. Where things stand (October 12 to 16)
Share of buses where Passio's time was close enough:

| How far ahead | Passio | Passio too late |
|---|---|---|
| under 10 minutes (checked once) | 22% | 10% |
| 10 to 15 minutes | 13% | 10% |
| 15 to 20 minutes | 14% | 8% |
| 20 to 30 minutes | 26% | 6% |
| 30 to 45 minutes | 12% | 4% |

So Passio is rarely close enough by this goal. The first learned corrections (the Colab notebook,
`experiments/routeknower/colab/`) help a little in some ranges, not yet enough, and a neural network did not help
with the few days of data so far. The big misses mostly come from buses leaving the end of their line late (driver
breaks, long waits), which the data does not show yet; better information will help more than a bigger model.

## 6. Where to look
- The daily scores: `data/eta/summary.csv` on the data branch (`pass_shrink` = close enough by this goal).
- A readable report: `python tools/build_eta_dataset.py report data/eta/summary.csv`.
- The full rules and plan: `docs/GOAL-AND-METHOD.md`.

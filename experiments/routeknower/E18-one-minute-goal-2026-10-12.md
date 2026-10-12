# E18: Can most stops get within 1 minute?
Date: 2026-10-12 · Agent/person: Claude (owner request: "get most stops to be within an error of 1 minute in
predictions") · Data: `data` branch `2c7f653`, `arrivals.csv` 9,569 rows, 2026-10-08 04:59 to 2026-10-12 11:35 CDT
(4 full service days and a Monday morning; one weekend), sha256 `01854f649381cc08...`

**Question:** how often is the arrival time riders see (Passio's ETA) within 1 minute, stop by stop, and could a
correction learned from our ground truth get most stops there?

**Method(s):** M1 (Passio as is); M2 (per-stop offset: the median, or a higher quantile, of each stop's past errors,
shrunk toward its route's with k = 10, the route's toward all; also per stop x daypart); M3 and M10 (our shrunk
hierarchy from the last logged arrival, and blends with corrected Passio) on the same rows.

**What is scored:** the one prediction per arrival that the collector keeps, the newest made at least 2 minutes
before the bus arrived (`passio_pred_lead_s` 120 to 299 s; median 156 s). Error = predicted minus actual: negative =
the bus came later than shown, positive = earlier ("early" counts double for riders, RouteKnower 6.3). Leads of 5
minutes and more cannot be scored yet (E01 B5), so **this is the 2-to-3-minute horizon only.**

**Protocol:** rolling origin by service day (fit on days before d, score day d; 4 test days, Oct 9 to 12). Leakage
checklist 6.2: corrections use only earlier days [x]; no whole-day features [x]; hyperparameters fixed in advance
(k = 10, quantiles 0.5 to 0.8 reported side by side, none picked on the test days) [x]; segments joined by (route,
prev, stop) for M3 [x]; no synthetic rows [x]; duplicates removed (`clean_dicts`) [x]. Rider set = the E01-clean
rows plus rows logged after the 2026-10-10 collector fixes (B1 made shared-trip predictions trustworthy: 72% within
1 minute post-fix, like everyone else). **Below the protocol minimum (10 test days), so no ship decision.**

## Results

**Today (rider set, 6,973 predictions, 119 stops with >= 15):** 60% of predictions are within 1 minute; 36% of the
time the bus comes more than a minute *later* than shown, 4% more than a minute *earlier*. MAE 73 s, bias -40 s.
Only **36 of 119 stops (30%)** have 80% of their predictions within 1 minute; 59 (50%) have an MAE of 60 s or less.
Worst: Red Line/Arts Block at Garfield (median 2.5 to 4 minutes late), Wyler Pavilion and Bernard Mitchell Hospital
(Apostolic/Drexel), Drexel Garage, Kenwood & 63rd, North at Regenstein and Max Palevsky.

**The error is mostly a fixed offset per stop, and it is real:**
- Buses that drove through (dwell 0) and buses that stopped show the same offset (median -45 vs -48 s; per-stop
  correlation 0.92 over 70 stops), so it is not our detector timing the end of a stop.
- Each stop's offset is stable: Thu-Fri vs Sat-Mon correlation 0.89 over 93 stops, median change 10 s.
- Removing each stop's own median (in-sample upper bound) would put 103 of 119 stops (87%) at "80% within 1 min".

**Out of sample (fitted on earlier days, 4,555 test predictions, 114 stops):**

| version | within 1 min | bus > 1 min early | bus > 1 min late | MAE s | stops with >= 80% within 1 min |
|---|---:|---:|---:|---:|---:|
| Passio as is | 62% | 3% | 34% | 67 | 35 of 114 (31%) |
| per-stop offset (median) | **87%** | 7% | 6% | 42 | 97 of 114 (85%) |
| per-stop, quantile 0.6 | 86% | 5% | 9% | 43 | |
| per-stop, quantile 0.7 | 83% | 5% | 13% | 47 | |
| per-stop, quantile 0.8 | 75% | 4% | 21% | 56 | |
| per stop x daypart, quantile 0.8 | 74% | **3%** | 22% | 57 | |

Every test day improved (within 1 minute: 59 -> 86%, 72 -> 84%, 70 -> 88%, 60 -> 91%).

**Our own model adds little at this horizon** (3,389 rows where it can run): Passio 63%, ours 67%, corrected
Passio 88%, 0.75 corrected Passio + 0.25 ours 86%. A blend is not worth building for the 2-minute ETA now; it may
matter at 5 to 10 minutes (needs B5).

## Significance
4 test days, one weekend: below the 10-day minimum (6.5), so no bootstrap claim. The direction is the same on all 4
days, and the size (+25 points within 1 minute) is far beyond the day-to-day spread seen (59 to 72% raw).

## Decision
**Worth pursuing; inconclusive for shipping (needs T1, >= 10 test days).** A per-stop offset is cheap (one number
per stop, a lookup table in `learned.json`) and on this data reaches the owner's goal at the 2-minute horizon:
85% of stops with 80% of predictions within 1 minute, against 31% today. The safety cost is the catch: the plain
median correction makes "bus more than a minute early" 3% -> 7%, which fails ship-gate rule 2 ("early-miss rate no
worse than Passio's"). Shifting less (quantile 0.8 per stop x daypart) keeps early at 3% but gives 74%. Options for
the owner when this ships: show the corrected time but keep "Leave by" and bus alerts on the earlier of the two
times, so the better number never makes anyone leave later.

## Follow-ups
1. **B5 now** (collector, small): also store the newest prediction made >= 5 and >= 10 minutes before each arrival,
   so the horizon riders plan with can be scored. Every day without it is lost data.
2. Re-run E18 weekly; at T1 (~Oct 22) bootstrap over >= 10 test days, with weekday and weekend apart.
3. Look at the worst stops: Garfield (Red Line/Arts Block), Wyler Pavilion, Bernard Mitchell, Drexel Garage look like
   holds or layovers that Passio does not model; an offset fixes the average, a "bus is holding" rule may fix the
   spread.
4. If adopted: lookup per (route, stop) [x daypart] in `learned.json`, applied in the app to Passio ETAs, labeled
   "est.", "Leave by" and alerts kept on the earlier time; RouteKnower section 9 gate.

## Reproduce
```
git fetch -q origin data
MSYS_NO_PATHCONV=1 git show 2c7f653:data/ground_truth/arrivals.csv > "$TEMP/rk/arrivals.csv"
python tools/rk_one_minute.py "$TEMP/rk/arrivals.csv" --out "$TEMP/rk/e18.md"
```

## Appendix: full report (`tools/rk_one_minute.py` output)

Rows with a stored Passio prediction at a 2-5 min lead: 8407 (6697 clean by the E01 rules, 2336 logged after the 2026-10-10 collector fixes); service days 2026-10-08, 2026-10-09, 2026-10-10, 2026-10-11, 2026-10-12.

### 1. Passio today (what riders see), 2-5 min ahead

| set | n | MAE s | median AE s | bias s | within 30 s | within 60 s | within 2 min | bus > 1 min early | bus > 1 min late |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| clean (E01 rules), all days | 6697 | 74 | 51 | -40 | 28% | **59%** | 87% | 4% | 37% |
| post-fix, every row | 2336 | 63 | 46 | -36 | 32% | **66%** | 91% | 4% | 31% |
| post-fix, shared trip id (Downtown Campus Connector etc.) | 264 | 52 | 39 | -42 | 38% | **72%** | 94% | 2% | 27% |
| post-fix, loop start (index 0) | 12 | 190 | 73 | +165 | 42% | **42%** | 67% | 42% | 17% |
| **rider set** (clean, plus post-fix shared/terminal) | 6973 | 73 | 51 | -40 | 29% | **60%** | 87% | 4% | 36% |

#### By lead (rider set)

| set | n | MAE s | median AE s | bias s | within 30 s | within 60 s | within 2 min | bus > 1 min early | bus > 1 min late |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 120-180 s | 6069 | 66 | 48 | -37 | 30% | **63%** | 90% | 4% | 33% |
| 180-240 s | 761 | 110 | 70 | -50 | 19% | **42%** | 73% | 6% | 52% |
| 240-300 s | 143 | 179 | 160 | -130 | 5% | **22%** | 47% | 6% | 72% |

#### By route (rider set)

| set | n | MAE s | median AE s | bias s | within 30 s | within 60 s | within 2 min | bus > 1 min early | bus > 1 min late |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Midway Metra | 968 | 48 | 39 | -37 | 40% | **71%** | 95% | 2% | 27% |
| Apostolic/Drexel | 886 | 107 | 72 | -52 | 16% | **41%** | 81% | 7% | 52% |
| Friend Center/Metra | 821 | 65 | 46 | -31 | 31% | **63%** | 91% | 3% | 34% |
| 53rd Street Express | 715 | 58 | 45 | -32 | 30% | **66%** | 95% | 3% | 31% |
| Central | 707 | 54 | 44 | -29 | 32% | **73%** | 96% | 5% | 22% |
| Red Line/Arts Block | 655 | 117 | 99 | -80 | 18% | **34%** | 55% | 6% | 60% |
| Apostolic | 643 | 77 | 64 | -74 | 13% | **47%** | 84% | 1% | 53% |
| East | 551 | 56 | 46 | -35 | 29% | **70%** | 95% | 3% | 27% |
| North | 296 | 83 | 45 | -3 | 38% | **62%** | 86% | 10% | 28% |
| Drexel | 283 | 59 | 49 | -52 | 29% | **65%** | 86% | 1% | 34% |
| South | 276 | 67 | 33 | +1 | 48% | **73%** | 88% | 10% | 17% |
| Downtown Campus Connector | 113 | 57 | 43 | -33 | 38% | **64%** | 94% | 4% | 32% |
| Regents Express | 33 | 55 | 17 | +13 | 64% | **88%** | 94% | 3% | 9% |

#### By time of day (rider set)

| set | n | MAE s | median AE s | bias s | within 30 s | within 60 s | within 2 min | bus > 1 min early | bus > 1 min late |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| weekday 5-10 AM | 2551 | 65 | 52 | -55 | 27% | **59%** | 86% | 2% | 39% |
| weekday 10 AM-4 PM | 1253 | 70 | 53 | -54 | 26% | **56%** | 88% | 2% | 42% |
| weekday 4-8 PM | 1612 | 85 | 55 | -38 | 28% | **55%** | 85% | 6% | 39% |
| weekday night (8 PM-5 AM) | 417 | 108 | 52 | +17 | 29% | **58%** | 80% | 15% | 27% |
| weekend | 1140 | 65 | 41 | -14 | 36% | **71%** | 93% | 7% | 22% |

#### Is the offset real, or our detector?

- Drive-through vs stopped (dwell 0 vs > 0), 70 stops with >= 8 of each: per-stop median offset correlation 0.92, median difference -2 s. Overall median error: drive-through -45 s, stopped -48 s.
- Stability: per-stop median offset on 2026-10-08, 2026-10-09 vs the later days, 93 stops: correlation 0.89, median change 10 s.

### 2. Stops meeting the 1-minute goal (rider set, stops with n >= 15)

| version | stops | MAE <= 60 s | median error <= 60 s | >= 80% of predictions within 60 s |
|---|---:|---:|---:|---:|
| Passio as is | 119 | 59 (50%) | 79 (66%) | 36 (30%) |
| Passio minus each stop's own median error (in-sample: an upper bound for bias correction) | 119 | 95 (80%) | 117 (98%) | 103 (87%) |

Worst 12 stops (rider set):

| route | stop | n | MAE s | median error s | within 60 s |
|---|---|---:|---:|---:|---:|
| Red Line/Arts Block | Garfield & Wabash (EB) | 48 | 244 | -245 | 0% |
| North | Regenstein Library (N) | 23 | 211 | -115 | 26% |
| North | Max Palevsky Residential Commons (NE Corner) | 23 | 202 | -98 | 9% |
| Red Line/Arts Block | Garfield Red Line Station (WB) | 58 | 200 | -176 | 2% |
| Red Line/Arts Block | Garfield Red Line Station (EB) | 54 | 185 | -156 | 0% |
| Apostolic/Drexel | Wyler Pavilion | 95 | 184 | -105 | 4% |
| East | Regenstein Library (N) | 16 | 168 | -78 | 31% |
| North | Ellis Garage & Ratner Athletic Center (East) | 25 | 162 | -68 | 28% |
| Apostolic/Drexel | Bernard Mitchell Hospital | 98 | 161 | -102 | 2% |
| Red Line/Arts Block | Washington Park Arts Incubator | 67 | 155 | -153 | 0% |
| Drexel | Drexel Garage | 46 | 139 | -136 | 4% |
| Apostolic | Kenwood & 63rd | 60 | 137 | -146 | 5% |

### 3. Out of sample: per-stop bias correction fitted on earlier days (M2)

| test day | n | Passio MAE / within 60 s | corrected MAE / within 60 s |
|---|---:|---:|---:|
| 2026-10-09 | 2219 | 72 s / 59% | 44 s / 86% |
| 2026-10-10 | 661 | 67 s / 72% | 54 s / 84% |
| 2026-10-11 | 480 | 61 s / 70% | 43 s / 88% |
| 2026-10-12 | 1195 | 62 s / 60% | 30 s / 91% |


| set | n | MAE s | median AE s | bias s | within 30 s | within 60 s | within 2 min | bus > 1 min early | bus > 1 min late |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Passio (test days) | 4555 | 67 | 48 | -42 | 30% | **62%** | 89% | 3% | 34% |
| Passio bias-corrected | 4555 | 42 | 22 | +6 | 63% | **87%** | 95% | 7% | 6% |

| version (test days) | stops | MAE <= 60 s | median error <= 60 s | >= 80% within 60 s |
|---|---:|---:|---:|---:|
| Passio | 114 | 65 (57%) | 77 (68%) | 35 (31%) |
| bias-corrected | 114 | 93 (82%) | 112 (98%) | 97 (85%) |

#### Safety tilt: shift by a quantile above the median (less shift, fewer early buses)

| correction (rolling origin) | within 60 s | bus > 1 min early | bus > 1 min late | MAE s |
|---|---:|---:|---:|---:|
| Passio as is | 62% | 3% | 34% | 67 |
| per stop, quantile 0.5 | 87% | 7% | 6% | 42 |
| per stop, quantile 0.6 | 86% | 5% | 9% | 43 |
| per stop, quantile 0.7 | 83% | 5% | 13% | 47 |
| per stop, quantile 0.8 | 75% | 4% | 21% | 56 |
| per stop x daypart, quantile 0.5 | 86% | 7% | 7% | 43 |
| per stop x daypart, quantile 0.6 | 85% | 6% | 10% | 44 |
| per stop x daypart, quantile 0.7 | 81% | 4% | 14% | 49 |
| per stop x daypart, quantile 0.8 | 74% | 3% | 22% | 57 |

### 4. Out of sample: our model and blends, same rows (segment chains with a known start, M10)

| set | n | MAE s | median AE s | bias s | within 30 s | within 60 s | within 2 min | bus > 1 min early | bus > 1 min late |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Passio | 3389 | 60 | 47 | -46 | 31% | **63%** | 90% | 3% | 34% |
| Passio bias-corrected | 3389 | 35 | 22 | +0 | 64% | **88%** | 96% | 6% | 6% |
| ours | 3389 | 58 | 39 | -19 | 41% | **67%** | 86% | 9% | 24% |
| ours+EWMA | 3389 | 59 | 39 | -19 | 40% | **66%** | 86% | 9% | 25% |
| 0.25 x Passio bias-corrected + 0.75 x ours | 3389 | 48 | 33 | -15 | 46% | **73%** | 92% | 8% | 19% |
| 0.5 x Passio bias-corrected + 0.5 x ours | 3389 | 41 | 28 | -10 | 53% | **81%** | 95% | 7% | 13% |
| 0.75 x Passio bias-corrected + 0.25 x ours | 3389 | 35 | 24 | -5 | 61% | **86%** | 96% | 6% | 8% |

Test days: 2026-10-09, 2026-10-10, 2026-10-11, 2026-10-12 (3389 rows).

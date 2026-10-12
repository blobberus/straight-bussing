# The 10% rule on the data we have (2026-10-12)

Data: `arrivals.csv`, service days 2026-10-08, 2026-10-09, 2026-10-10, 2026-10-11, 2026-10-12; rolling origin by service day (test days 2026-10-09, 2026-10-10, 2026-10-11, 2026-10-12). err = predicted - actual: positive = the prediction was later than the bus (the bus came early, a rider could miss it). Columns: **10% rule** |err| <= 0.1 L; **+ floor** |err| <= max(60 s, 0.1 L); **band B** -0.1 L <= err <= +0.01 L; **B + floor** -max(60 s, 0.1 L) <= err <= max(10 s, 0.01 L); **late > 1% L** = fails B on the late side; **A1** err > 0; **A2** err > 0.1 L.

Methods: **Passio** = the one stored prediction per arrival (newest made >= 120 s ahead; only leads 120-299 s can be scored). **ours** = the bus's last logged arrival at or before q = A - L (same vehicle, across trip ids and laps), plus the shrunk-hierarchy segment run times and learned dwells around the loop (all 14 routes are loops in route_stops.json) to the target, clamped to >= q; the terminal layover is the learned median dwell at the terminal (training days only). **ours+sched layover** = the same, but the bus leaves the terminal no earlier than the GTFS start time of the trip the target row is on (block knowledge; slightly optimistic). **schedule segments** = last arrival + GTFS segment seconds (segments.json), no layover. **timetable** = GTFS stop_times time of the target's trip at the stop (non-timepoint stops interpolated by shape distance); **timetable+delay** = timetable + the bus's delay at its last logged stop. A target counts for lead L only if it is the bus's next visit to that stop after q and the bus had a logged arrival on the same route within 25 min before q. Model fit on earlier service days only. Provisional huge-error rule: |err| > max(10 min, L).

## 1. Passio (the ETA riders see), stored lead 2-5 min

Its tolerance uses each row's own lead (120-299 s, so 10% = 12-30 s).

| method | lead | n | 10% rule | 10% + floor | band B | B + floor | late > 1% L | A1 late at all | A2 late > 10% L | MAE s | median err s |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Passio, every stored prediction (any lead, untrusted included) | stored | 9180 | **12%** | 53% | **8%** | 47% | 17% | 18% | 13% | 160 | -46 |
| Passio, rider set (E18: clean or post-fix, lead 120-299 s) | 2-5 min | 6973 | **13%** | 60% | **9%** | 54% | 13% | 14% | 9% | 73 | -46 |
| Passio, rider set without huge errors | 2-5 min | 6912 | **13%** | 60% | **9%** | 54% | 13% | 13% | 8% | 65 | -46 |
| Passio, rider set without huge errors | 120-149 s | 3164 | **13%** | 67% | **9%** | 61% | 13% | 13% | 8% | 55 | -40 |
| Passio, rider set without huge errors | 150-179 s | 2865 | **14%** | 59% | **9%** | 53% | 13% | 14% | 8% | 65 | -47 |
| Passio, rider set without huge errors | 180-299 s | 883 | **10%** | 40% | **7%** | 35% | 11% | 11% | 7% | 100 | -69 |

Huge errors in the rider set: 61 of 6973 (0.9%). Untrusted or lead >= 300 s rows (E01 rules) are 2207 of 9180 stored predictions.


## 2. Ours and the schedule by lead, all rows

| method | lead | n | 10% rule | 10% + floor | band B | B + floor | late > 1% L | A1 late at all | A2 late > 10% L | MAE s | median err s |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ours | 2 min | 5774 | **16%** | 63% | **10%** | 42% | 38% | 39% | 32% | 77 | -15 |
| ours+sched layover | 2 min | 5774 | **16%** | 61% | **9%** | 41% | 46% | 47% | 39% | 97 | -5 |
| schedule segments | 2 min | 5774 | **8%** | 35% | **5%** | 26% | 30% | 31% | 28% | 137 | -51 |
| timetable | 2 min | 5267 | **3%** | 14% | **2%** | 10% | 29% | 29% | 27% | 629 | -176 |
| timetable+delay | 2 min | 5140 | **7%** | 31% | **5%** | 23% | 43% | 44% | 41% | 179 | -18 |
| ours | 5 min | 5696 | **25%** | 44% | **15%** | 29% | 34% | 36% | 24% | 127 | -32 |
| ours+sched layover | 5 min | 5696 | **24%** | 41% | **14%** | 27% | 47% | 48% | 37% | 147 | -4 |
| schedule segments | 5 min | 5696 | **8%** | 16% | **5%** | 11% | 27% | 27% | 24% | 247 | -132 |
| timetable | 5 min | 5193 | **7%** | 14% | **4%** | 10% | 29% | 29% | 26% | 628 | -178 |
| timetable+delay | 5 min | 5074 | **6%** | 13% | **4%** | 8% | 46% | 46% | 43% | 295 | -33 |
| ours | 10 min | 5566 | **30%** | 30% | **19%** | 20% | 26% | 28% | 15% | 189 | -78 |
| ours+sched layover | 10 min | 5566 | **29%** | 29% | **18%** | 19% | 45% | 47% | 34% | 198 | -12 |
| schedule segments | 10 min | 5566 | **9%** | 9% | **6%** | 6% | 16% | 17% | 13% | 388 | -286 |
| timetable | 10 min | 5075 | **14%** | 14% | **9%** | 10% | 28% | 29% | 23% | 634 | -184 |
| timetable+delay | 10 min | 4978 | **13%** | 13% | **8%** | 8% | 45% | 46% | 39% | 352 | -37 |
| ours | 15 min | 5430 | **36%** | 36% | **24%** | 24% | 21% | 23% | 10% | 232 | -109 |
| ours+sched layover | 15 min | 5430 | **35%** | 35% | **21%** | 21% | 46% | 48% | 32% | 236 | -11 |
| schedule segments | 15 min | 5430 | **8%** | 8% | **5%** | 5% | 12% | 13% | 10% | 499 | -364 |
| timetable | 15 min | 4964 | **21%** | 21% | **13%** | 14% | 28% | 29% | 20% | 652 | -186 |
| timetable+delay | 15 min | 4858 | **22%** | 22% | **13%** | 13% | 46% | 48% | 37% | 350 | -17 |
| ours | 20 min | 4753 | **34%** | 34% | **26%** | 26% | 16% | 17% | 8% | 298 | -168 |
| ours+sched layover | 20 min | 4753 | **36%** | 36% | **22%** | 22% | 46% | 49% | 33% | 279 | -8 |
| schedule segments | 20 min | 4753 | **8%** | 8% | **6%** | 6% | 10% | 10% | 8% | 626 | -460 |
| timetable | 20 min | 4308 | **28%** | 28% | **17%** | 17% | 26% | 27% | 15% | 647 | -208 |
| timetable+delay | 20 min | 4252 | **31%** | 31% | **20%** | 20% | 45% | 46% | 34% | 336 | -21 |
| ours | 30 min | 2460 | **20%** | 20% | **15%** | 15% | 11% | 11% | 6% | 560 | -330 |
| ours+sched layover | 30 min | 2460 | **40%** | 40% | **23%** | 23% | 37% | 40% | 21% | 419 | -89 |
| schedule segments | 30 min | 2460 | **1%** | 1% | **0%** | 0% | 12% | 12% | 12% | 976 | -622 |
| timetable | 30 min | 2037 | **35%** | 35% | **22%** | 22% | 21% | 23% | 8% | 659 | -272 |
| timetable+delay | 30 min | 2016 | **63%** | 63% | **60%** | 60% | 12% | 12% | 9% | 331 | -73 |

## 2. Ours and the schedule by lead, without huge errors (|err| > max(10 min, L))

| method | lead | n | 10% rule | 10% + floor | band B | B + floor | late > 1% L | A1 late at all | A2 late > 10% L | MAE s | median err s |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ours | 2 min | 5739 | **17%** | 63% | **10%** | 43% | 38% | 39% | 31% | 61 | -15 |
| ours+sched layover | 2 min | 5703 | **16%** | 62% | **9%** | 42% | 45% | 46% | 38% | 77 | -5 |
| schedule segments | 2 min | 5653 | **8%** | 36% | **5%** | 26% | 29% | 29% | 26% | 86 | -53 |
| timetable | 2 min | 3926 | **4%** | 19% | **2%** | 14% | 33% | 33% | 31% | 222 | -89 |
| timetable+delay | 2 min | 4868 | **7%** | 32% | **5%** | 24% | 40% | 41% | 38% | 126 | -27 |
| ours | 5 min | 5652 | **25%** | 44% | **15%** | 29% | 34% | 35% | 24% | 109 | -32 |
| ours+sched layover | 5 min | 5585 | **24%** | 42% | **14%** | 28% | 46% | 47% | 36% | 121 | -6 |
| schedule segments | 5 min | 5528 | **8%** | 17% | **5%** | 11% | 25% | 25% | 22% | 179 | -140 |
| timetable | 5 min | 3873 | **9%** | 19% | **6%** | 13% | 33% | 33% | 29% | 223 | -89 |
| timetable+delay | 5 min | 4677 | **7%** | 14% | **4%** | 9% | 41% | 42% | 39% | 217 | -62 |
| ours | 10 min | 5536 | **30%** | 30% | **19%** | 20% | 26% | 27% | 15% | 174 | -78 |
| ours+sched layover | 10 min | 5446 | **30%** | 30% | **18%** | 19% | 44% | 46% | 32% | 174 | -16 |
| schedule segments | 10 min | 5377 | **9%** | 9% | **6%** | 6% | 13% | 14% | 10% | 319 | -295 |
| timetable | 10 min | 3774 | **19%** | 19% | **12%** | 13% | 32% | 33% | 25% | 224 | -90 |
| timetable+delay | 10 min | 4612 | **14%** | 14% | **8%** | 9% | 41% | 41% | 34% | 273 | -70 |
| ours | 15 min | 5410 | **36%** | 36% | **24%** | 24% | 21% | 23% | 10% | 222 | -110 |
| ours+sched layover | 15 min | 5376 | **36%** | 36% | **21%** | 22% | 45% | 48% | 31% | 220 | -14 |
| schedule segments | 15 min | 5197 | **8%** | 8% | **6%** | 6% | 8% | 9% | 6% | 423 | -379 |
| timetable | 15 min | 4179 | **25%** | 25% | **16%** | 16% | 30% | 31% | 21% | 283 | -122 |
| timetable+delay | 15 min | 4638 | **23%** | 23% | **13%** | 13% | 44% | 45% | 34% | 295 | -32 |
| ours | 20 min | 4742 | **34%** | 34% | **26%** | 26% | 16% | 17% | 7% | 290 | -168 |
| ours+sched layover | 20 min | 4736 | **36%** | 36% | **22%** | 22% | 46% | 49% | 33% | 270 | -9 |
| schedule segments | 20 min | 4514 | **8%** | 8% | **6%** | 6% | 5% | 6% | 3% | 542 | -490 |
| timetable | 20 min | 3929 | **30%** | 30% | **19%** | 19% | 27% | 28% | 15% | 336 | -168 |
| timetable+delay | 20 min | 4141 | **32%** | 32% | **20%** | 20% | 43% | 45% | 32% | 298 | -27 |
| ours | 30 min | 2459 | **20%** | 20% | **15%** | 15% | 11% | 11% | 6% | 558 | -330 |
| ours+sched layover | 30 min | 2454 | **40%** | 40% | **23%** | 23% | 37% | 39% | 20% | 414 | -89 |
| schedule segments | 30 min | 2303 | **1%** | 1% | **0%** | 0% | 6% | 6% | 6% | 876 | -806 |
| timetable | 30 min | 1961 | **36%** | 36% | **22%** | 22% | 21% | 23% | 8% | 436 | -256 |
| timetable+delay | 30 min | 2005 | **63%** | 63% | **60%** | 60% | 11% | 12% | 9% | 320 | -74 |

### Huge errors excluded (share of that method's rows at that lead)

| lead | ours | ours+sched layover | schedule segments | timetable | timetable+delay |
|---|---:|---:|---:|---:|---:|
| 2 min | 35 (0.6%) | 71 (1.2%) | 121 (2.1%) | 1341 (25.5%) | 272 (5.3%) |
| 5 min | 44 (0.8%) | 111 (1.9%) | 168 (2.9%) | 1320 (25.4%) | 397 (7.8%) |
| 10 min | 30 (0.5%) | 120 (2.2%) | 189 (3.4%) | 1301 (25.6%) | 366 (7.4%) |
| 15 min | 20 (0.4%) | 54 (1.0%) | 233 (4.3%) | 785 (15.8%) | 220 (4.5%) |
| 20 min | 11 (0.2%) | 17 (0.4%) | 239 (5.0%) | 379 (8.8%) | 111 (2.6%) |
| 30 min | 1 (0.0%) | 6 (0.2%) | 157 (6.4%) | 76 (3.7%) | 11 (0.5%) |

### Targets not scored (no live basis for a prediction at that lead)

| lead | scored (ours) | bus on another route at q | no logged arrival of the bus in the 25 min before q | not the bus's next visit to the stop |
|---|---:|---:|---:|---:|
| 2 min | 5774 | 21 | 216 | 0 |
| 5 min | 5696 | 26 | 289 | 0 |
| 10 min | 5566 | 35 | 404 | 6 |
| 15 min | 5430 | 63 | 497 | 21 |
| 20 min | 4753 | 82 | 591 | 585 |
| 30 min | 2460 | 118 | 801 | 2632 |

## 3. By route at 10 min (without huge errors)

| route | method | n | 10% rule | band B | late > 1% L | A1 | MAE s | median err s |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Midway Metra | ours | 636 | 27% | 15% | 25% | 27% | 146 | -91 |
| Midway Metra | ours+sched layover | 629 | 25% | 14% | 34% | 35% | 172 | -67 |
| Midway Metra | timetable+delay | 491 | 29% | 16% | 37% | 38% | 193 | -41 |
| 53rd Street Express | ours | 613 | 42% | 30% | 18% | 19% | 115 | -69 |
| 53rd Street Express | ours+sched layover | 609 | 47% | 33% | 23% | 26% | 103 | -49 |
| 53rd Street Express | timetable+delay | 593 | 17% | 13% | 39% | 39% | 196 | -51 |
| East | ours | 581 | 27% | 18% | 28% | 30% | 168 | -73 |
| East | ours+sched layover | 565 | 26% | 18% | 54% | 55% | 158 | +30 |
| East | timetable+delay | 507 | 2% | 1% | 35% | 35% | 363 | -254 |
| Central | ours | 538 | 31% | 22% | 19% | 22% | 133 | -88 |
| Central | ours+sched layover | 538 | 31% | 21% | 39% | 41% | 116 | -28 |
| Central | timetable+delay | 506 | 2% | 0% | 60% | 60% | 347 | +212 |
| Friend Center/Metra | ours | 493 | 27% | 16% | 28% | 30% | 177 | -83 |
| Friend Center/Metra | ours+sched layover | 492 | 21% | 10% | 58% | 60% | 166 | +53 |
| Friend Center/Metra | timetable+delay | 490 | 21% | 11% | 49% | 50% | 188 | -4 |
| Downtown Campus Connector | ours | 460 | 22% | 12% | 40% | 41% | 227 | -48 |
| Downtown Campus Connector | ours+sched layover | 460 | 22% | 12% | 40% | 41% | 227 | -48 |
| Apostolic | ours | 416 | 21% | 8% | 22% | 24% | 321 | -344 |
| Apostolic | ours+sched layover | 402 | 43% | 20% | 42% | 45% | 182 | -9 |
| Apostolic | timetable+delay | 368 | 17% | 12% | 45% | 46% | 286 | -30 |
| Apostolic/Drexel | ours | 414 | 38% | 25% | 23% | 26% | 137 | -64 |
| Apostolic/Drexel | ours+sched layover | 404 | 26% | 17% | 50% | 51% | 226 | +3 |
| Apostolic/Drexel | timetable+delay | 391 | 6% | 3% | 38% | 38% | 304 | -182 |
| Red Line/Arts Block | ours | 405 | 45% | 28% | 37% | 40% | 119 | -24 |
| Red Line/Arts Block | ours+sched layover | 405 | 37% | 22% | 50% | 51% | 169 | +3 |
| Red Line/Arts Block | timetable+delay | 346 | 14% | 5% | 25% | 26% | 226 | -197 |
| North | ours | 331 | 36% | 20% | 31% | 34% | 102 | -59 |
| North | ours+sched layover | 331 | 24% | 13% | 75% | 77% | 176 | +143 |
| North | timetable+delay | 324 | 2% | 0% | 56% | 56% | 395 | +235 |
| South | ours | 307 | 9% | 7% | 25% | 26% | 301 | -168 |
| South | ours+sched layover | 269 | 12% | 7% | 71% | 72% | 306 | +361 |
| South | timetable+delay | 289 | 4% | 2% | 20% | 20% | 374 | -344 |
| Drexel | ours | 308 | 32% | 26% | 10% | 11% | 189 | -101 |
| Drexel | ours+sched layover | 308 | 42% | 31% | 18% | 19% | 157 | -62 |
| Drexel | timetable+delay | 284 | 49% | 25% | 33% | 37% | 170 | -34 |
| South Loop Shuttle | ours | 20 | 0% | 0% | 0% | 0% | 588 | -600 |
| South Loop Shuttle | ours+sched layover | 20 | 5% | 5% | 0% | 0% | 473 | -600 |

## 3. By route at 30 min (without huge errors)

| route | method | n | 10% rule | band B | late > 1% L | A1 | MAE s | median err s |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Downtown Campus Connector | ours | 421 | 28% | 16% | 35% | 36% | 485 | -169 |
| Downtown Campus Connector | ours+sched layover | 421 | 28% | 16% | 35% | 36% | 485 | -169 |
| East | ours | 313 | 16% | 16% | 0% | 0% | 644 | -362 |
| East | ours+sched layover | 310 | 39% | 18% | 44% | 45% | 467 | -36 |
| East | timetable+delay | 304 | 43% | 42% | 17% | 18% | 454 | -106 |
| 53rd Street Express | ours | 309 | 0% | 0% | 0% | 0% | 377 | -325 |
| 53rd Street Express | ours+sched layover | 309 | 50% | 45% | 7% | 12% | 226 | -173 |
| 53rd Street Express | timetable+delay | 298 | 76% | 76% | 1% | 1% | 193 | -86 |
| Central | ours | 271 | 24% | 24% | 0% | 0% | 486 | -244 |
| Central | ours+sched layover | 271 | 51% | 24% | 28% | 30% | 320 | -169 |
| Central | timetable+delay | 271 | 84% | 81% | 10% | 11% | 149 | -60 |
| Friend Center/Metra | ours | 245 | 10% | 10% | 0% | 0% | 536 | -376 |
| Friend Center/Metra | ours+sched layover | 245 | 66% | 27% | 43% | 49% | 189 | -14 |
| Friend Center/Metra | timetable+delay | 245 | 62% | 61% | 1% | 1% | 254 | -108 |
| Apostolic | ours | 211 | 0% | 0% | 0% | 0% | 862 | -665 |
| Apostolic | ours+sched layover | 211 | 59% | 47% | 12% | 18% | 434 | -99 |
| Apostolic | timetable+delay | 209 | 66% | 63% | 7% | 7% | 367 | -91 |
| North | ours | 168 | 55% | 52% | 3% | 5% | 266 | -174 |
| North | ours+sched layover | 166 | 37% | 2% | 93% | 93% | 296 | +194 |
| North | timetable+delay | 167 | 83% | 78% | 13% | 14% | 180 | -48 |
| South | ours | 166 | 54% | 14% | 65% | 66% | 330 | +93 |
| South | ours+sched layover | 166 | 7% | 1% | 90% | 90% | 560 | +394 |
| South | timetable+delay | 165 | 64% | 59% | 18% | 18% | 449 | -26 |
| Apostolic/Drexel | ours | 156 | 33% | 33% | 0% | 0% | 405 | -217 |
| Apostolic/Drexel | ours+sched layover | 156 | 38% | 36% | 44% | 44% | 359 | -131 |
| Apostolic/Drexel | timetable+delay | 155 | 70% | 68% | 7% | 7% | 239 | -46 |
| Red Line/Arts Block | ours | 83 | 0% | 0% | 0% | 0% | 1073 | -1039 |
| Red Line/Arts Block | ours+sched layover | 83 | 12% | 0% | 19% | 19% | 902 | -736 |
| Red Line/Arts Block | timetable+delay | 81 | 10% | 0% | 41% | 41% | 648 | -435 |
| Midway Metra | ours | 66 | 0% | 0% | 0% | 0% | 1139 | -1054 |
| Midway Metra | ours+sched layover | 66 | 23% | 23% | 11% | 14% | 626 | -527 |
| Midway Metra | timetable+delay | 63 | 10% | 10% | 29% | 29% | 736 | -338 |
| Drexel | ours | 26 | 0% | 0% | 0% | 0% | 1428 | -1420 |
| Drexel | ours+sched layover | 26 | 19% | 12% | 8% | 8% | 989 | -1221 |
| Drexel | timetable+delay | 26 | 58% | 35% | 27% | 35% | 573 | -33 |

## 4. Where the long-lead error comes from (ours, without huge errors)

| lead | slice | n | 10% rule | median err s | MAE s |
|---|---|---:|---:|---:|---:|
| 10 min | path crosses the terminal (layover inside) | 3164 | 28% | -87 | 184 |
| 10 min | no terminal on the path | 2372 | 33% | -69 | 161 |
| 10 min | target is the terminal | 518 | 36% | -28 | 176 |
| 10 min | bus's last logged stop < 2 min before q | 2551 | 40% | -41 | 112 |
| 10 min | last logged stop 5-25 min before q | 1694 | 17% | -190 | 276 |
| 10 min | weekday 6-10 AM | 1899 | 30% | -82 | 191 |
| 10 min | weekday 4-8 PM | 1106 | 31% | -67 | 152 |
| 10 min | night 8 PM-5 AM | 779 | 22% | -97 | 195 |
| 10 min | weekend | 1361 | 25% | -89 | 174 |
| 20 min | path crosses the terminal (layover inside) | 3806 | 36% | -151 | 259 |
| 20 min | no terminal on the path | 936 | 26% | -235 | 414 |
| 20 min | target is the terminal | 452 | 40% | -108 | 253 |
| 20 min | bus's last logged stop < 2 min before q | 2192 | 40% | -132 | 201 |
| 20 min | last logged stop 5-25 min before q | 1327 | 19% | -345 | 474 |
| 20 min | weekday 6-10 AM | 1442 | 23% | -262 | 363 |
| 20 min | weekday 4-8 PM | 929 | 41% | -122 | 275 |
| 20 min | night 8 PM-5 AM | 745 | 34% | -160 | 262 |
| 20 min | weekend | 1315 | 39% | -126 | 231 |
| 30 min | path crosses the terminal (layover inside) | 2016 | 21% | -309 | 461 |
| 30 min | no terminal on the path | 443 | 13% | -903 | 1001 |
| 30 min | target is the terminal | 220 | 22% | -304 | 492 |
| 30 min | bus's last logged stop < 2 min before q | 1615 | 25% | -273 | 381 |
| 30 min | last logged stop 5-25 min before q | 474 | 9% | -1068 | 1073 |
| 30 min | weekday 6-10 AM | 687 | 6% | -576 | 644 |
| 30 min | weekday 4-8 PM | 504 | 32% | -270 | 616 |
| 30 min | night 8 PM-5 AM | 385 | 32% | -231 | 493 |
| 30 min | weekend | 688 | 29% | -224 | 474 |

### Huge errors of ours at 10-30 min, by slice

| lead | slice | huge | of | share | median huge err s |
|---|---|---:|---:|---:|---:|
| 10 min | crosses the terminal | 23 | 3187 | 0.7% | +3903 |
| 10 min | no terminal | 7 | 2379 | 0.3% | +1358 |
| 10 min | night 8 PM-5 AM | 3 | 782 | 0.4% | +895 |
| 30 min | crosses the terminal | 1 | 2017 | 0.0% | +4118 |
| 30 min | no terminal | 0 | 443 | 0% | |
| 30 min | night 8 PM-5 AM | 0 | 385 | 0% | |

## 5. Safety shift: subtract a high quantile of past errors (fewer late predictions), rolling

Shift per (route, lead) from earlier test days (huge errors left out of the fit), shrunk toward the lead's (k = 20); scored on later test days. Passio: per route, fitted on all earlier days.

| method | lead | shift quantile | n | 10% rule | 10% + floor | band B | B + floor | late > 1% L | A1 | A2 | MAE s |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Passio | 2-5 min | none | 4529 | 14% | 63% | 9% | 57% | 12% | 13% | 8% | 61 |
| Passio | 2-5 min | 0.5 | 4529 | 31% | 82% | 16% | 49% | 50% | 52% | 36% | 41 |
| Passio | 2-5 min | 0.75 | 4529 | 26% | 75% | 16% | 62% | 24% | 25% | 14% | 48 |
| Passio | 2-5 min | 0.9 | 4529 | 9% | 50% | 7% | 47% | 8% | 8% | 5% | 72 |
| Passio | 2-5 min | 0.95 | 4529 | 4% | 27% | 3% | 25% | 4% | 4% | 3% | 104 |
| Passio | 2-5 min | 0.99 | 4529 | 0% | 2% | 0% | 1% | 1% | 1% | 1% | 264 |
| ours | 5 min | none | 2620 | 22% | 40% | 13% | 27% | 33% | 34% | 25% | 116 |
| ours | 5 min | 0.5 | 2620 | 24% | 42% | 12% | 24% | 48% | 49% | 37% | 113 |
| ours | 5 min | 0.75 | 2620 | 18% | 37% | 11% | 27% | 25% | 26% | 18% | 128 |
| ours | 5 min | 0.9 | 2620 | 9% | 20% | 6% | 15% | 13% | 13% | 9% | 173 |
| ours | 5 min | 0.95 | 2620 | 7% | 14% | 4% | 10% | 8% | 8% | 5% | 220 |
| ours | 5 min | 0.99 | 2620 | 2% | 6% | 2% | 5% | 2% | 2% | 1% | 320 |
| ours | 10 min | none | 2572 | 26% | 26% | 17% | 18% | 25% | 26% | 15% | 181 |
| ours | 10 min | 0.5 | 2572 | 29% | 29% | 16% | 17% | 48% | 49% | 35% | 162 |
| ours | 10 min | 0.75 | 2572 | 25% | 25% | 17% | 18% | 25% | 26% | 16% | 182 |
| ours | 10 min | 0.9 | 2572 | 14% | 14% | 9% | 10% | 12% | 13% | 8% | 246 |
| ours | 10 min | 0.95 | 2572 | 10% | 10% | 6% | 7% | 8% | 8% | 4% | 301 |
| ours | 10 min | 0.99 | 2572 | 5% | 5% | 4% | 4% | 3% | 3% | 1% | 404 |
| ours | 30 min | none | 1091 | 21% | 21% | 14% | 14% | 14% | 15% | 7% | 530 |
| ours | 30 min | 0.5 | 1091 | 47% | 47% | 32% | 32% | 37% | 46% | 23% | 348 |
| ours | 30 min | 0.75 | 1091 | 51% | 51% | 33% | 33% | 29% | 31% | 12% | 367 |
| ours | 30 min | 0.9 | 1091 | 41% | 41% | 33% | 33% | 16% | 18% | 9% | 406 |
| ours | 30 min | 0.95 | 1091 | 36% | 36% | 27% | 27% | 13% | 13% | 3% | 449 |
| ours | 30 min | 0.99 | 1091 | 20% | 20% | 17% | 17% | 4% | 4% | 1% | 547 |

## 6. Does a bus's trip id match the run it is driving? (timetable error per route, 2-min targets)

If the live trip id named the scheduled run, the timetable error would be small and centred. On most routes it is not: errors cluster at -10 to -20 min (about one headway), so the bus carries the id of an earlier scheduled run. That makes 'timetable' useless as a baseline there and is one source of huge errors.

| route | n | median err s | share > 10 min off |
|---|---:|---:|---:|
| Midway Metra | 666 | -89 | 27% |
| 53rd Street Express | 631 | -216 | 18% |
| East | 594 | -395 | 33% |
| Central | 559 | -551 | 45% |
| Friend Center/Metra | 497 | +3 | 1% |
| Apostolic/Drexel | 438 | -95 | 20% |
| Apostolic | 437 | +129 | 16% |
| Red Line/Arts Block | 433 | -365 | 36% |
| North | 342 | -132 | 11% |
| South | 320 | +43 | 29% |
| Drexel | 317 | -138 | 43% |
| South Loop Shuttle | 19 | +109 | 21% |
| Regents Express | 14 | -2770 | 86% |

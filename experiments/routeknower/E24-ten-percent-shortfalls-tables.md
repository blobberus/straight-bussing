# E24 tables: Passio against the 10% rule (2026-10-12 to 2026-10-24, 13 service days with Passio; timetable sources from 2026-10-10)

### Headline: each source by lead (all days pooled; 95% interval = bootstrap over days)

| source | lead | samples | 10% rule | 95% interval | 10% rule, 1-min floor | band B (10% early to 1% late) | bus came > 10% later | bus came > 10% earlier | gross | median error (min) | mean abs error (min) |
|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| passio | 0-10 | 35,878 | 8% | 8% to 9% | 23% | 6% | 84% | 8% | 3% | -1.7 | 2.3 |
| passio | 10-15 | 30,071 | 17% | 15% to 20% | 17% | 13% | 77% | 6% | 9% | -3.3 | 3.9 |
| passio | 15-20 | 27,770 | 25% | 23% to 29% | 25% | 20% | 70% | 5% | 17% | -3.5 | 4.1 |
| passio | 20-30 | 23,223 | 32% | 29% to 38% | 32% | 26% | 65% | 3% | 18% | -4.1 | 5.0 |
| passio | 30-45 | 6,985 | 15% | 12% to 19% | 15% | 13% | 84% | 1% | 30% | -9.2 | 9.1 |
| timetable | 0-10 | 37,362 | 10% | 9% to 10% | 19% | 6% | 59% | 31% | 33% | -1.4 | 3.7 |
| timetable | 10-15 | 37,362 | 23% | 22% to 25% | 23% | 14% | 51% | 25% | 33% | -1.4 | 3.7 |
| timetable | 15-20 | 37,362 | 32% | 30% to 33% | 32% | 19% | 47% | 22% | 33% | -1.4 | 3.7 |
| timetable | 20-30 | 37,362 | 38% | 36% to 40% | 38% | 23% | 45% | 17% | 26% | -1.8 | 4.5 |
| timetable | 30-45 | 37,362 | 47% | 45% to 49% | 47% | 29% | 42% | 11% | 18% | -2.3 | 5.5 |
| timetable_delay | 0-10 | 36,987 | 8% | 6% to 8% | 16% | 4% | 52% | 41% | 21% | -0.7 | 3.4 |
| timetable_delay | 10-15 | 35,684 | 19% | 16% to 21% | 19% | 11% | 45% | 36% | 26% | -0.6 | 4.1 |
| timetable_delay | 15-20 | 35,360 | 31% | 28% to 33% | 31% | 17% | 37% | 32% | 28% | -0.2 | 3.7 |
| timetable_delay | 20-30 | 35,193 | 51% | 48% to 54% | 51% | 25% | 28% | 21% | 29% | +0.0 | 3.3 |
| timetable_delay | 30-45 | 34,508 | 39% | 36% to 41% | 39% | 25% | 33% | 28% | 21% | -0.9 | 5.8 |

### How far off Passio is, against what the 10% rule allows (non-gross samples)

| lead | allowed (10% of the bin middle) | 10th pct | 25th | median | 75th | 90th | median abs | 80% of predictions within |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0-10 min | 0.5 min | -4.8 | -2.8 | -1.7 | -0.8 | +0.1 | 1.8 | 3.4 |
| 10-15 min | 1.2 min | -7.5 | -5.4 | -3.3 | -1.4 | +0.2 | 3.5 | 6.2 |
| 15-20 min | 1.8 min | -8.1 | -6.2 | -3.5 | -1.4 | +0.1 | 3.8 | 6.9 |
| 20-30 min | 2.5 min | -10.4 | -8.0 | -4.1 | -1.5 | +0.0 | 4.3 | 8.8 |
| 30-45 min | 3.8 min | -15.8 | -13.0 | -9.2 | -4.7 | -2.1 | 9.3 | 13.9 |

Minutes; negative = the bus came later than shown.

### Exact leads (predictions.csv, Oct 12 12:20 on; 36,892 arrivals that can carry a prediction)

| lead | allowed by the 10% rule | arrivals with a time on display | 10% rule | with a 1-min floor | band B | bus came > 10% later | bus came > 10% earlier | gross | median error (min) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 min | 6 s | 89% | 6% | 66% | 4% | 84% | 10% | 1% | -0.7 |
| 2 min | 12 s | 88% | 8% | 48% | 5% | 84% | 8% | 1% | -1.0 |
| 3 min | 18 s | 86% | 8% | 35% | 5% | 84% | 8% | 1% | -1.2 |
| 5 min | 30 s | 83% | 9% | 20% | 6% | 84% | 8% | 2% | -1.8 |
| 10 min | 1.0 min | 77% | 14% | 14% | 10% | 79% | 7% | 6% | -3.0 |
| 15 min | 1.5 min | 72% | 22% | 22% | 17% | 73% | 5% | 13% | -3.4 |
| 20 min | 2.0 min | 59% | 29% | 29% | 23% | 67% | 3% | 21% | -3.6 |
| 30 min | 3.0 min | 18% | 18% | 18% | 16% | 81% | 1% | 28% | -7.4 |

`gps` arrivals (DC-003) never carry a prediction and are left out of the count.

### Coverage: arrivals with any Passio time on display in the lead bin

| group | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min |
|---|---:|---:|---:|---:|---:|
| all arrivals | 85% (42,212) | 71% (42,212) | 66% (42,212) | 55% (42,212) | 17% (42,212) |
| current trip | 89% (33,868) | 74% (23,534) | 63% (18,749) | 47% (13,389) | 28% (10,012) |
| next trip (bus must finish its lap first) | 68% (8,344) | 68% (18,678) | 68% (23,463) | 59% (28,823) | 13% (32,200) |
| Red Line/Arts Block | 78% (5,796) | 61% (5,796) | 53% (5,796) | 41% (5,796) | 3% (5,796) |
| Apostolic/Drexel | 88% (5,686) | 72% (5,686) | 66% (5,686) | 52% (5,686) | 13% (5,686) |
| Downtown Campus Connector | 84% (5,093) | 67% (5,093) | 57% (5,093) | 53% (5,093) | 46% (5,093) |
| Midway Metra | 81% (4,334) | 66% (4,334) | 55% (4,334) | 24% (4,334) | 8% (4,334) |
| 53rd Street Express | 88% (4,250) | 81% (4,250) | 78% (4,250) | 77% (4,250) | 14% (4,250) |
| Friend Center/Metra | 89% (3,414) | 85% (3,414) | 83% (3,414) | 81% (3,414) | 18% (3,414) |
| Central | 75% (2,934) | 61% (2,934) | 58% (2,934) | 57% (2,934) | 14% (2,934) |
| East | 95% (2,542) | 89% (2,542) | 85% (2,542) | 80% (2,542) | 18% (2,542) |
| Apostolic | 85% (2,359) | 71% (2,359) | 70% (2,359) | 66% (2,359) | 22% (2,359) |
| South | 92% (2,147) | 63% (2,147) | 56% (2,147) | 51% (2,147) | 14% (2,147) |
| Drexel | 84% (1,833) | 72% (1,833) | 72% (1,833) | 19% (1,833) | 2% (1,833) |
| North | 93% (1,384) | 86% (1,384) | 85% (1,384) | 83% (1,384) | 25% (1,384) |
| Regents Express | 80% (326) | 57% (326) | 56% (326) | 53% (326) | 11% (326) |
| South Loop Shuttle | 85% (114) | 70% (114) | 70% (114) | 64% (114) | 59% (114) |

### By trip: the one the bus drives now vs its next trip

| group | samples | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min | share of all misses | misses where the bus came later | median error at 10-15 min | gross |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| current trip | 70,533 | 7% (31,131) | 11% (17,535) | 12% (11,932) | 11% (6,857) | 4% (3,078) | 63% | 94% | -3.9 | 12% |
| next trip | 53,394 | 15% (4,747) | 24% (12,536) | 33% (15,838) | 40% (16,366) | 21% (3,907) | 37% | 92% | -2.4 | 11% |

### By route

| group | samples | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min | share of all misses | misses where the bus came later | median error at 10-15 min | gross |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Apostolic/Drexel | 16,590 | 6% (5,010) | 16% (4,081) | 25% (3,775) | 28% (2,960) | 10% (764) | 13% | 90% | -2.9 | 20% |
| Downtown Campus Connector | 15,589 | 10% (4,272) | 9% (3,389) | 6% (2,898) | 4% (2,688) | 1% (2,342) | 14% | 98% | -3.9 | 15% |
| 53rd Street Express | 14,356 | 7% (3,735) | 10% (3,457) | 14% (3,326) | 21% (3,264) | 6% (574) | 14% | 98% | -4.0 | 3% |
| Red Line/Arts Block | 13,698 | 3% (4,510) | 6% (3,527) | 13% (3,085) | 15% (2,378) | 8% (198) | 12% | 94% | -6.4 | 19% |
| Friend Center/Metra | 12,164 | 15% (3,042) | 34% (2,899) | 47% (2,845) | 63% (2,780) | 43% (598) | 8% | 88% | -1.6 | 2% |
| Midway Metra | 10,122 | 7% (3,529) | 7% (2,865) | 12% (2,363) | 4% (1,036) | 1% (329) | 9% | 96% | -4.0 | 10% |
| East | 9,343 | 13% (2,414) | 25% (2,250) | 35% (2,168) | 45% (2,044) | 19% (467) | 7% | 93% | -2.9 | 8% |
| Central | 7,770 | 8% (2,201) | 11% (1,787) | 19% (1,702) | 31% (1,681) | 7% (399) | 7% | 94% | -3.2 | 4% |
| Apostolic | 7,395 | 4% (1,998) | 7% (1,685) | 13% (1,652) | 26% (1,548) | 26% (512) | 6% | 94% | -3.1 | 22% |
| South | 5,939 | 11% (1,978) | 45% (1,349) | 59% (1,203) | 66% (1,099) | 36% (310) | 3% | 69% | -0.5 | 18% |
| North | 5,150 | 16% (1,285) | 34% (1,195) | 38% (1,179) | 49% (1,146) | 42% (345) | 4% | 90% | -1.8 | 6% |
| Drexel | 4,575 | 12% (1,545) | 32% (1,322) | 53% (1,312) | 53% (352) | 38% (44) | 3% | 99% | -2.0 | 11% |
| Regents Express | 839 | 7% (262) | 19% (185) | 24% (182) | 29% (174) | 25% (36) | 1% | 89% | -2.6 | 15% |
| South Loop Shuttle | 397 | 34% (97) | 54% (80) | 27% (80) | 38% (73) | 42% (67) | 0% | 91% | -0.9 | 26% |

### By time of day (Chicago time of the arrival)

| group | samples | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min | share of all misses | misses where the bus came later | median error at 10-15 min | gross |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5-7 AM | 6,642 | 11% (2,236) | 22% (1,636) | 36% (1,483) | 41% (1,029) | 36% (258) | 5% | 94% | -2.5 | 17% |
| 7-10 AM | 27,361 | 8% (7,822) | 12% (6,852) | 20% (6,283) | 23% (4,907) | 13% (1,497) | 23% | 96% | -4.0 | 11% |
| 10 AM-3 PM | 23,839 | 8% (6,592) | 18% (5,676) | 26% (5,289) | 36% (4,973) | 14% (1,309) | 20% | 97% | -3.3 | 9% |
| 3-7 PM | 36,167 | 6% (10,504) | 13% (8,803) | 20% (8,052) | 27% (6,600) | 9% (2,208) | 30% | 95% | -3.7 | 13% |
| 7-10 PM | 21,056 | 10% (6,063) | 22% (5,010) | 29% (4,682) | 37% (4,029) | 17% (1,272) | 16% | 88% | -2.6 | 12% |
| 10 PM-5 AM | 8,862 | 15% (2,661) | 30% (2,094) | 42% (1,981) | 53% (1,685) | 35% (441) | 6% | 77% | -1.4 | 15% |

### By day of the week

| group | samples | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min | share of all misses | misses where the bus came later | median error at 10-15 min | gross |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Mon | 19,649 | 8% (5,724) | 16% (4,798) | 24% (4,454) | 32% (3,575) | 14% (1,098) | 16% | 93% | -3.1 | 12% |
| Tue | 23,283 | 8% (6,704) | 16% (5,687) | 24% (5,257) | 29% (4,295) | 11% (1,340) | 19% | 95% | -3.5 | 12% |
| Wed | 23,637 | 8% (6,972) | 13% (5,730) | 20% (5,235) | 23% (4,290) | 8% (1,410) | 20% | 94% | -3.5 | 14% |
| Thu | 23,648 | 7% (6,845) | 15% (5,723) | 23% (5,319) | 30% (4,437) | 15% (1,324) | 19% | 94% | -3.6 | 12% |
| Fri | 23,775 | 8% (7,014) | 17% (5,743) | 24% (5,211) | 32% (4,426) | 16% (1,381) | 19% | 93% | -3.3 | 13% |
| Sat | 7,201 | 16% (1,904) | 37% (1,740) | 48% (1,668) | 60% (1,600) | 37% (289) | 5% | 86% | -1.4 | 4% |
| Sun | 2,734 | 12% (715) | 25% (650) | 33% (626) | 47% (600) | 37% (143) | 2% | 88% | -2.1 | 4% |

### By stops still to go before the target stop

| group | samples | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min | share of all misses | misses where the bus came later | median error at 10-15 min | gross |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 7,801 | 7% (5,911) | 23% (1,095) | 6% (406) | 53% (200) | 86% (189) | 7% | 95% | -2.8 | 12% |
| 2-3 | 24,588 | 8% (15,003) | 18% (5,057) | 14% (2,964) | 11% (1,217) | 28% (347) | 22% | 95% | -3.3 | 10% |
| 4-6 | 32,555 | 10% (9,877) | 19% (10,447) | 37% (6,261) | 24% (4,075) | 5% (1,895) | 26% | 93% | -3.2 | 12% |
| 7-10 | 32,522 | 13% (1,064) | 15% (9,788) | 25% (12,873) | 38% (7,098) | 13% (1,699) | 24% | 92% | -3.2 | 14% |
| 11+ | 21,535 | 7% (2,072) | 14% (2,545) | 20% (4,534) | 34% (9,953) | 18% (2,431) | 17% | 94% | -3.2 | 10% |
| unknown | 4,926 | 5% (1,951) | 10% (1,139) | 16% (732) | 15% (680) | 15% (424) | 4% | 91% | -3.9 | 23% |

### Current trip only: median error by stops still to go (minutes; negative = bus later than shown)

| group | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min |
|---|---:|---:|---:|---:|---:|
| 1 | -2.0 (5,721) | -2.8 (706) | -4.8 (154) |  |  |
| 2-3 | -1.9 (12,988) | -4.0 (3,202) | -5.2 (1,804) | -8.6 (492) |  |
| 4-6 | -1.6 (7,984) | -4.5 (4,516) | -3.9 (1,698) | -6.9 (1,752) | -13.3 (1,150) |
| 7-10 | -1.0 (795) | -3.9 (4,894) | -6.2 (3,561) | -7.9 (787) | -10.3 (366) |
| 11+ | -2.1 (1,245) | -2.9 (1,179) | -4.8 (1,552) | -8.3 (1,439) | -9.6 (144) |

### By whether the bus must pass the end of its line first

| group | samples | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min | share of all misses | misses where the bus came later | median error at 10-15 min | gross |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| crosses the end of the line | 71,162 | 11% (11,950) | 23% (16,648) | 31% (19,480) | 38% (18,712) | 21% (4,372) | 51% | 93% | -2.6 | 13% |
| same run | 52,765 | 7% (23,928) | 10% (13,423) | 9% (8,290) | 8% (4,511) | 3% (2,613) | 49% | 94% | -4.0 | 11% |

### By the bus's current delay against the timetable (at its last stop)

| group | samples | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min | share of all misses | misses where the bus came later | median error at 10-15 min | gross |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| more than 2 min early | 21,247 | 8% (5,568) | 24% (5,352) | 38% (5,237) | 44% (3,955) | 32% (1,135) | 15% | 86% | -2.3 | 14% |
| on time (within 2 min) | 24,969 | 10% (6,294) | 23% (6,592) | 34% (5,898) | 51% (5,054) | 26% (1,131) | 19% | 90% | -2.3 | 6% |
| 2-5 min late | 17,199 | 10% (5,467) | 17% (3,996) | 27% (3,837) | 43% (3,327) | 9% (572) | 14% | 95% | -3.4 | 5% |
| 5-10 min late | 19,830 | 8% (5,742) | 16% (4,682) | 22% (4,609) | 21% (3,979) | 15% (818) | 17% | 97% | -3.8 | 12% |
| over 10 min late | 22,998 | 6% (7,862) | 9% (5,474) | 10% (4,859) | 5% (3,916) | 8% (887) | 19% | 95% | -4.3 | 19% |
| no timetable (frequency trip) or unknown | 17,684 | 10% (4,945) | 9% (3,975) | 7% (3,330) | 6% (2,992) | 3% (2,442) | 16% | 97% | -3.9 | 15% |

### By how old Passio's prediction was when a rider looked

| group | samples | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min | share of all misses | misses where the bus came later | median error at 10-15 min | gross |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| under 1 min | 46,774 | 8% (13,260) | 16% (11,072) | 24% (10,219) | 32% (9,108) | 17% (3,115) | 39% | 94% | -3.3 | 10% |
| 1-2 min | 67,291 | 8% (19,624) | 17% (16,362) | 25% (15,146) | 33% (12,627) | 13% (3,532) | 55% | 93% | -3.3 | 11% |
| 2-5 min | 6,455 | 10% (1,894) | 22% (1,638) | 27% (1,516) | 28% (1,193) | 4% (214) | 5% | 93% | -3.1 | 17% |
| 5-15 min | 3,031 | 19% (1,031) | 29% (912) | 31% (779) | 23% (203) | 17% (106) | 2% | 85% | -1.9 | 29% |
| over 15 min | 376 | 10% (69) | 12% (87) | 22% (110) | 29% (92) | (18) | 0% | 83% | -3.1 | 86% |

### By what the bus was doing when a rider looked

| group | samples | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min | share of all misses | misses where the bus came later | median error at 10-15 min | gross |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| moving | 86,280 | 9% (25,595) | 16% (20,193) | 26% (18,942) | 34% (16,754) | 13% (4,796) | 72% | 93% | -3.3 | 9% |
| standing under 2 min | 19,368 | 6% (5,256) | 18% (4,815) | 24% (4,338) | 33% (3,662) | 13% (1,297) | 16% | 95% | -3.3 | 13% |
| standing 2-5 min | 9,004 | 5% (2,181) | 21% (2,560) | 24% (2,198) | 27% (1,640) | 37% (425) | 7% | 96% | -3.0 | 17% |
| standing over 5 min | 7,670 | 8% (2,420) | 20% (2,008) | 25% (1,811) | 12% (1,016) | 22% (415) | 5% | 95% | -2.9 | 27% |
| no recent position | 1,605 | 13% (426) | 11% (495) | 8% (481) | 6% (151) | 11% (52) | 1% | 94% | -4.9 | 56% |

### First stop of the route vs the rest

| group | samples | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min | share of all misses | misses where the bus came later | median error at 10-15 min | gross |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| other stops | 123,113 | 8% (35,670) | 17% (29,877) | 25% (27,569) | 32% (23,076) | 15% (6,921) | 100% | 93% | -3.3 | 12% |
| first stop (Passio predicts the departure) | 814 | 16% (208) | 30% (194) | 16% (201) | 11% (147) | 6% (64) | 0% | 82% | -1.4 | 38% |

### Stops: the 12 worst and the 12 with the most misses at 10-15 min ahead (at least 120 samples)

| route | stop | samples | 10% rule | median error (min) | share of all misses at this lead |
|---|---|---:|---:|---:|---:|
| 53rd Street Express | Stony Island Parking Lot | 227 | 0% | -5.6 | 1.0% |
| 53rd Street Express | 57th St. & Metra (NB) | 230 | 0% | -5.6 | 1.0% |
| Drexel | Drexel Garage | 176 | 0% | -8.1 | 0.6% |
| Apostolic | Kenwood & 63rd | 157 | 0% | -6.9 | 0.3% |
| 53rd Street Express | Lake Park & 55th St. (SE Corner) | 228 | 0% | -5.5 | 1.0% |
| Red Line/Arts Block | Washington Park Arts Incubator | 394 | 1% | -9.1 | 0.8% |
| Red Line/Arts Block | Logan Center for Arts | 362 | 1% | -6.5 | 1.5% |
| Downtown Campus Connector | S Lake Park & E 53rd St | 296 | 1% | -4.9 | 1.2% |
| Red Line/Arts Block | Garfield & Wabash (EB) | 395 | 1% | -8.7 | 1.1% |
| Downtown Campus Connector | S Lake Park Ave & E Hyde Park Blvd | 345 | 1% | -4.7 | 1.4% |
| Red Line/Arts Block | Midway Plaisance & Cottage Grove | 400 | 1% | -6.5 | 1.7% |
| Red Line/Arts Block | Garfield Red Line Station (EB) | 374 | 2% | -7.4 | 1.5% |

| route | stop | samples | 10% rule | median error (min) | share of all misses at this lead |
|---|---|---:|---:|---:|---:|
| Apostolic/Drexel | Kenwood & 63rd | 418 | 5% | -3.1 | 1.7% |
| Red Line/Arts Block | Midway Plaisance & Cottage Grove | 400 | 1% | -6.5 | 1.7% |
| Apostolic/Drexel | Goldblatt Pavilion | 441 | 13% | -2.8 | 1.6% |
| Apostolic/Drexel | Apostolic Lot | 391 | 6% | -2.9 | 1.6% |
| Red Line/Arts Block | Logan Center for Arts | 362 | 1% | -6.5 | 1.5% |
| Red Line/Arts Block | Garfield Red Line Station (EB) | 374 | 2% | -7.4 | 1.5% |
| Downtown Campus Connector | Roosevelt Station | 352 | 5% | -3.8 | 1.5% |
| Red Line/Arts Block | Garfield Red Line Station (WB) | 350 | 3% | -6.9 | 1.5% |
| Apostolic/Drexel | Drexel Garage | 379 | 5% | -6.9 | 1.4% |
| Downtown Campus Connector | E Randolph St & S Michigan Ave | 337 | 2% | -5.5 | 1.4% |
| Downtown Campus Connector | S Lake Park Ave & E Hyde Park Blvd | 345 | 1% | -4.7 | 1.4% |
| Downtown Campus Connector | S Michigan Ave/Roosevelt | 353 | 13% | -2.6 | 1.3% |

### Day by day (Passio, 10% rule)

| service day | 0-10 min | 10-15 min | 15-20 min | 20-30 min | 30-45 min | samples |
|---|---:|---:|---:|---:|---:|---:|
| 2026-10-12 Mon | 10% | 22% | 31% | 40% | 15% | 6,932 |
| 2026-10-13 Tue | 8% | 15% | 23% | 28% | 12% | 12,222 |
| 2026-10-14 Wed | 7% | 13% | 21% | 24% | 9% | 12,262 |
| 2026-10-15 Thu | 7% | 16% | 25% | 31% | 17% | 12,029 |
| 2026-10-16 Fri | 8% | 17% | 24% | 32% | 14% | 12,332 |
| 2026-10-17 Sat | 13% | 36% | 47% | 56% | 29% | 3,312 |
| 2026-10-18 Sun | 12% | 25% | 33% | 47% | 37% | 2,722 |
| 2026-10-19 Mon | 7% | 12% | 20% | 27% | 14% | 12,717 |
| 2026-10-20 Tue | 8% | 17% | 25% | 29% | 10% | 11,061 |
| 2026-10-21 Wed | 9% | 13% | 20% | 23% | 7% | 11,375 |
| 2026-10-22 Thu | 8% | 14% | 22% | 29% | 12% | 11,638 |
| 2026-10-23 Fri | 8% | 17% | 25% | 32% | 18% | 11,450 |
| 2026-10-24 Sat | 20% | 38% | 49% | 64% | 46% | 3,875 |

### The same arrivals scored for each source (10% rule)

| trip | lead | arrivals | Passio | printed timetable | timetable + current delay | best of the three per bin |
|---|---|---:|---:|---:|---:|---|
| current trip | 0-10 | 26,680 | 7% | 9% | 8% | timetable |
| current trip | 10-15 | 13,829 | 12% | 15% | 11% | timetable |
| current trip | 15-20 | 8,806 | 15% | 15% | 20% | timetable_delay |
| current trip | 20-30 | 4,048 | 16% | 16% | 39% | timetable_delay |
| current trip | 30-45 | 678 | 17% | 17% | 35% | timetable_delay |
| next trip | 0-10 | 4,745 | 15% | 15% | 5% | passio |
| next trip | 10-15 | 12,453 | 24% | 31% | 30% | timetable |
| next trip | 15-20 | 15,765 | 33% | 39% | 38% | timetable |
| next trip | 20-30 | 16,316 | 40% | 41% | 58% | timetable_delay |
| next trip | 30-45 | 3,876 | 21% | 38% | 26% | timetable |

Timetable rows exist only where the GTFS has a time for the trip (not the Downtown Campus Connector's frequency trips), so these are fewer arrivals than the headline.

### Headroom: the same Passio times with a learned shift (rolling origin: learned on earlier days only)

Scored days: 2026-10-14 to 2026-10-24 (11 service days). Each cell: 10% rule / band B / shown later than the bus came by more than 1% of the lead (the 1% rule, dangerous direction).

| lead | samples | Passio as shown | shift tuned for the 10% rule | shift tuned for band B |
|---|---:|---|---|---|
| 0-10 min | 30,283 | 8% / 6% / 11% | 37% / 21% / 48% | 35% / 21% / 39% |
| 10-15 min | 25,420 | 17% / 13% / 11% | 48% / 27% / 41% | 45% / 29% / 30% |
| 15-20 min | 23,454 | 25% / 20% / 9% | 52% / 29% / 37% | 48% / 33% / 24% |
| 20-30 min | 19,728 | 32% / 26% / 8% | 55% / 32% / 36% | 51% / 39% / 21% |
| 30-45 min | 5,888 | 15% / 14% / 4% | 48% / 27% / 33% | 44% / 31% / 21% |

Shift per stop and trip segment when that group had at least 30 past samples, else per route, else per segment. Gross misses stay out of the pass rates as everywhere; the too-late share counts every sample.

# E31 tables: large prediction misses per line

Data: 2026-10-12 to 2026-11-10 (30 service days), 437,521 Passio times, 83,762 arrivals as coverage targets; "last 14 days" = 2026-10-28 on. Made by `experiments/routeknower/E31-scripts/report.py` from `data/labeled/prediction_misses/` (rules and columns: its README). Large miss = off by more than twice the goal's allowed error (2 min at 5 to 15 min ahead, 4 at 20, 5 at 30). **Bus early** = the bus came earlier than the time shown (a rider can miss it); **bus late** = it came later. Unofficial analysis of the public Passio feed.

## 1. All lines, by lead: before the last 14 days and in them

| Lead | Passio times | Bus early (large) | Bus late (large) | Within the goal | Arrivals with a time | Median error, min |
|---|---:|---:|---:|---:|---:|---:|
| 5 min | 37,256 / 26,551 | 4.9% / **21.3%** | 44.1% / 37.0% | 20% / 21% | 79% / 66% | -1.8 / -1.2 |
| 10 min | 34,625 / 25,019 | 5.1% / **13.1%** | 67.1% / 57.5% | 14% / 16% | 74% / 63% | -3.1 / -2.7 |
| 15 min | 32,014 / 22,698 | 4.5% / **6.6%** | 70.4% / 66.8% | 14% / 16% | 69% / 57% | -3.9 / -3.9 |
| 20 min | 26,218 / 18,256 | 1.7% / **2.1%** | 56.6% / 57.5% | 29% / 29% | 57% / 46% | -4.9 / -5.0 |
| 30 min | 8,172 / 6,080 | 1.4% / **0.5%** | 74.5% / 76.8% | 17% / 20% | 18% / 16% | -9.9 / -11.8 |

## 2. Per line, goal leads pooled

Rates with the day-bootstrap 95% range; x = the line's rate / all lines' in the same days.

| Line | Times (all days) | Bus early, all days | Bus late, all days | Bus early, last 14 days | Bus late, last 14 days | Trend early / late | Gross | Within the goal | Time 5 min ahead, last 14 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 53rd Street Express | 31,309 | 10.4% (6.1% to 14.8%) | 59.1% | 21.7% x2.0 | 47.4% x0.86 | worse / better | 2.9% | 13% | 69% |
| Apostolic | 15,835 | 3.9% (3.3% to 4.5%) | 63.0% | 4.1% x0.4 | 59.0% x1.07 | same / same | 20.6% | 14% | 76% |
| Apostolic/Drexel | 31,459 | 6.1% (5.1% to 7.1%) | 66.0% | 4.4% x0.4 | 66.9% x1.21 | better / same | 19.0% | 18% | 69% |
| Central | 13,789 | 12.3% (8.2% to 17.2%) | 48.2% | 24.1% x2.2 | 38.1% x0.69 | worse / better | 4.7% | 19% | 51% |
| Downtown Campus Connector | 25,948 | 8.0% (5.5% to 10.6%) | 68.9% | 15.6% x1.4 | 67.5% x1.22 | worse / same | 27.8% | 13% | 38% |
| Drexel | 7,339 | 0.1% (0.0% to 0.2%) | 54.1% | 0.1% x0.0 | 62.9% x1.14 | same / worse | 17.4% | 24% | 50% |
| East | 17,803 | 8.3% (5.7% to 11.4%) | 47.1% | 17.9% x1.6 | 41.4% x0.75 | worse / better | 7.6% | 26% | 60% |
| Friend Center/Metra | 24,364 | 5.8% (4.4% to 7.1%) | 34.5% | 8.0% x0.7 | 35.6% x0.64 | worse / same | 2.4% | 34% | 80% |
| Midway Metra | 21,268 | 4.0% (2.7% to 5.3%) | 66.8% | 6.3% x0.6 | 63.4% x1.15 | worse / same | 8.0% | 12% | 79% |
| North | 8,685 | 7.2% (5.3% to 9.5%) | 37.4% | 10.8% x1.0 | 35.8% x0.65 | worse / same | 5.8% | 36% | 58% |
| Red Line/Arts Block | 24,956 | 3.6% (3.0% to 4.2%) | 79.5% | 4.2% x0.4 | 79.6% x1.44 | same / same | 18.0% | 9% | 75% |
| Regents Express | 1,675 | 5.9% (3.3% to 9.2%) | 63.9% | 6.6% x0.6 | 70.5% x1.27 | same / worse | 18.4% | 21% | 63% |
| South | 11,888 | 11.8% (9.3% to 14.3%) | 38.7% | 9.9% x0.9 | 40.2% x0.73 | better / same | 18.1% | 33% | 82% |
| South Loop Shuttle | 571 | 28.7% (21.0% to 39.1%) | 33.6% | 41.8% x3.8 | 21.6% x0.39 | worse / better | 29.2% | 42% | 26% |
| All lines | 236,889 | 6.9% (5.7% to 8.4%) | 58.1% | 11.0% | 55.3% | worse / same | 12.9% | 19% | 66% |

## 3. Per line, 5 min ahead (the goal's under-10 point): before the last 14 days and in them

| Line | Times | Bus early | Bus late | Median error, min | Time 5 min ahead |
|---|---:|---:|---:|---:|---:|
| 53rd Street Express | 4,341 / 3,025 | 1.3% / **53.2%** | 46.2% / 16.0% | -1.9 / +2.5 | 91% / 69% |
| Apostolic | 2,196 / 1,987 | 1.7% / **3.0%** | 53.4% / 40.8% | -2.1 / -1.6 | 83% / 76% |
| Apostolic/Drexel | 5,476 / 4,124 | 7.5% / **7.9%** | 54.2% / 46.9% | -2.2 / -1.7 | 77% / 69% |
| Central | 2,258 / 1,401 | 6.1% / **60.2%** | 29.4% / 14.6% | -1.5 / +3.1 | 75% / 51% |
| Downtown Campus Connector | 4,169 / 1,712 | 2.8% / **36.2%** | 42.1% / 46.1% | -1.8 / -1.6 | 74% / 38% |
| Drexel | 1,461 / 904 | 0.2% / **0.2%** | 43.9% / 52.0% | -1.8 / -2.1 | 71% / 50% |
| East | 2,831 / 1,665 | 5.0% / **47.5%** | 32.9% / 18.3% | -1.5 / +1.8 | 87% / 60% |
| Friend Center/Metra | 3,276 / 2,534 | 4.5% / **9.6%** | 28.9% / 30.0% | -1.3 / -1.1 | 84% / 80% |
| Midway Metra | 3,694 / 3,350 | 2.2% / **14.6%** | 47.7% / 36.9% | -1.9 / -1.5 | 75% / 79% |
| North | 1,205 / 879 | 6.0% / **14.3%** | 30.4% / 33.9% | -1.2 / -0.4 | 69% / 58% |
| Red Line/Arts Block | 4,233 / 3,089 | 3.4% / **4.1%** | 64.5% / 65.0% | -2.9 / -2.8 | 82% / 75% |
| Regents Express | 233 / 204 | 5.1% / **20.6%** | 32.6% / 52.0% | -1.6 / -2.6 | 73% / 63% |
| South | 1,804 / 1,646 | 24.8% / **21.3%** | 21.6% / 24.2% | -0.7 / -0.9 | 80% / 82% |
| South Loop Shuttle | 79 / 31 | 22.8% / **64.5%** | 29.1% / 19.4% | -0.1 / +18.9 | 71% / 26% |
| All lines | 37,256 / 26,551 | 4.9% / **21.3%** | 44.1% / 37.0% | -1.8 / -1.2 | 79% / 66% |

## 4a. Stops where the bus came far EARLIER than shown (last 14 days, 100+ goal-lead times)

| Line | Stop | Position | Times | Bus early, goal leads | Bus early, 5 min ahead | Line's rate |
|---|---:|---:|---:|---:|---:|---:|
| Downtown Campus Connector | N (Upper) Wacker Dr & W Madison St | 10 | 709 | 62% | 99% | 16% |
| Downtown Campus Connector | S (Upper) Wacker Dr & W Adams St | 11 | 953 | 61% | 99% | 16% |
| Central | 55th Street & Blackstone | 10 | 480 | 55% | 97% | 24% |
| Central | Blackstone & 53rd | 11 | 476 | 52% | 92% | 24% |
| 53rd Street Express | Logan Center | 8 | 1053 | 49% | 99% | 22% |
| 53rd Street Express | 60th St. & Ellis (SE Corner) | 9 | 1064 | 46% | 94% | 22% |
| Central | 55th Street & University | 9 | 478 | 42% | 99% | 24% |
| 53rd Street Express | 60th St. & Woodlawn Ave (SE Corner) | 10 | 1060 | 42% | 94% | 22% |
| 53rd Street Express | Goldblatt Pavilion | 7 | 839 | 42% | 99% | 22% |
| South | Levi Hall (W) | 15 | 304 | 39% | 68% | 10% |
| 53rd Street Express | Keller Center EB | 11 | 1075 | 39% | 91% | 22% |
| Midway Metra | 57th St. & Metra (NB) | 14 | 367 | 38% | 100% | 6% |
| Central | 53 & Kimbark (WB) | 12 | 537 | 37% | 67% | 24% |
| East | Regents Park Apartments | 7 | 668 | 37% | 97% | 18% |
| Central | Ellis Garage & Ratner Athletic Center (East) | 8 | 439 | 34% | 97% | 24% |

## 4b. Stops where the bus came far LATER than shown (last 14 days, 100+ goal-lead times)

| Line | Stop | Position | Times | Bus late, goal leads | Bus late, 5 min ahead | Line's rate |
|---|---:|---:|---:|---:|---:|---:|
| Drexel | Drexel Garage | 0|7 | 571 | 100% | 99% | 63% |
| Red Line/Arts Block | Garfield & Wabash (EB) | 8 | 1226 | 98% | 98% | 80% |
| Downtown Campus Connector | Rockefeller Chapel | 0|14 | 1212 | 97% | 97% | 67% |
| Apostolic/Drexel | Goldblatt Pavilion | 0|10|12 | 1365 | 97% | 96% | 67% |
| Downtown Campus Connector | Goldblatt Pavilion | 2 | 1070 | 96% | 93% | 67% |
| Red Line/Arts Block | Garfield Red Line Station (EB) | 7 | 1093 | 95% | 99% | 80% |
| Downtown Campus Connector | 59th & Ellis | 1 | 1387 | 95% | 93% | 67% |
| Apostolic | Kenwood & 63rd | 0|9|10 | 712 | 95% | 86% | 59% |
| Downtown Campus Connector | 55th Street & University | 3 | 817 | 95% | 93% | 67% |
| Downtown Campus Connector | S Lake Park Ave & E Hyde Park Blvd | 5 | 595 | 94% | 0% | 67% |
| Red Line/Arts Block | Washington Park Arts Incubator | 9 | 1187 | 94% | 80% | 80% |
| Downtown Campus Connector | S Lake Park & E 53rd St | 4 | 641 | 94% | 40% | 67% |
| Red Line/Arts Block | Garfield Red Line Station (WB) | 6 | 1118 | 93% | 97% | 80% |
| East | Reynolds Club | 0|13 | 525 | 92% | 91% | 41% |
| Apostolic/Drexel | Wyler Pavilion | 1 | 726 | 91% | 82% | 67% |

## 5. Stops with almost no time 5 min ahead (last 14 days)

| Line | Stop | Position | Arrivals | Time 5 min ahead | Time at any lead | All days, 5 min ahead |
|---|---:|---:|---:|---:|---:|---:|
| 53rd Street Express | 53rd St & Kenwood | 1 | 268 | 6% | 22% | 47% |
| 53rd Street Express | Kimbark Plaza (NE Corner) | 2 | 268 | 9% | 30% | 47% |
| 53rd Street Express | Ellis Ave & 57th St | 5 | 256 | 10% | 91% | 53% |
| Apostolic | Wyler Pavilion | 2|3 | 249 | 4% | 9% | 46% |
| Apostolic/Drexel | 61st & Kimbark | 8 | 471 | 0% | 3% | 12% |
| Central | 57th St. & Metra (SB) | 1 | 81 | 20% | 79% | 41% |
| Central | Keller Center WB | 4 | 151 | 17% | 67% | 46% |
| Central | Burton-Judson Courts (NE Corner) | 5 | 215 | 7% | 71% | 35% |
| Central | Levi Hall (E) | 6 | 221 | 12% | 78% | 39% |
| Downtown Campus Connector | 55th Street & University | 3 | 324 | 12% | 81% | 54% |
| Downtown Campus Connector | S Lake Park & E 53rd St | 4 | 337 | 1% | 79% | 52% |
| Downtown Campus Connector | S Lake Park Ave & E Hyde Park Blvd | 5 | 346 | 1% | 77% | 51% |
| Downtown Campus Connector | S Michigan Ave/Roosevelt | 6 | 356 | 0% | 1% | 50% |
| Downtown Campus Connector | E Randolph St & S Michigan Ave | 7 | 312 | 0% | 1% | 49% |
| Downtown Campus Connector | Gleacher Center | 8 | 328 | 0% | 2% | 43% |
| Downtown Campus Connector | UCHICAGO Medicine - River East | 9 | 209 | 0% | 1% | 52% |
| Drexel | Goldblatt Pavilion | 1 | 241 | 15% | 85% | 45% |
| Drexel | Wyler Pavilion | 2 | 262 | 22% | 86% | 42% |
| East | Regenstein Library (N) | 1 | 210 | 6% | 7% | 44% |
| East | Max Palevsky Residential Commons (NE Corner) | 2 | 192 | 6% | 7% | 43% |
| East | Ellis Garage & Ratner Athletic Center (East) | 3 | 208 | 6% | 9% | 43% |
| North | Regenstein Library (N) | 1 | 215 | 19% | 31% | 43% |
| North | Max Palevsky Residential Commons (NE Corner) | 2 | 207 | 22% | 34% | 39% |
| North | Ellis Garage & Ratner Athletic Center (East) | 3 | 201 | 22% | 34% | 39% |
| Red Line/Arts Block | Midway Plaisance & Cottage Grove | 10 | 354 | 2% | 6% | 53% |
| Regents Express | Law School (N) | 0|7 | 33 | 15% | 36% | 42% |

## 6. Stops whose only time 5 min ahead was another trip id's (last 14 days, DC-025)

| Line | Stop | Position | Arrivals | No own time 5 min ahead | Screen showed another trip's | of those, bus far earlier | bus far later |
|---|---:|---:|---:|---:|---:|---:|---:|
| 53rd Street Express | 53rd St & Kenwood | 1 | 268 | 251 | 207 | 0 | 207 |
| 53rd Street Express | Kimbark Plaza (NE Corner) | 2 | 268 | 244 | 123 | 0 | 123 |
| Apostolic/Drexel | 57th Street & Drexel (NB) | 5 | 539 | 183 | 109 | 6 | 75 |
| Central | Max Palevsky Residential Commons (NE Corner) | 7 | 217 | 147 | 64 | 63 | 0 |
| Central | Ellis Garage & Ratner Athletic Center (East) | 8 | 222 | 129 | 84 | 84 | 0 |
| Central | 55th Street & University | 9 | 229 | 100 | 65 | 65 | 0 |
| Drexel | 57th Street & Drexel (NB) | 6 | 231 | 95 | 50 | 1 | 19 |
| East | Hyde Park Places Apts | 9 | 190 | 43 | 40 | 35 | 0 |
| Friend Center/Metra | Wyler Pavilion | 1 | 254 | 98 | 67 | 38 | 27 |
| Red Line/Arts Block | Institute for Study of Ancient Cultures | 1 | 335 | 119 | 80 | 6 | 25 |
| Red Line/Arts Block | Ellis/57th | 2 | 345 | 121 | 81 | 6 | 36 |
| Red Line/Arts Block | Smart Museum of Arts | 3 | 354 | 127 | 85 | 7 | 51 |
| South | 60th St. & Ellis (SE Corner) | 0|16 | 174 | 60 | 39 | 10 | 12 |

## 7. Week by week, 5 min ahead: bus early (large) and a time on display

| Line | week of 10-12 | week of 10-19 | week of 10-26 | week of 11-02 | week of 11-09 (2 days) |
|---|---:|---:|---:|---:|---:|
| All lines | 4% / 80% | 5% / 80% | 15% / 70% | 21% / 66% | 20% / 65% |
| 53rd Street Express | 1% / 92% | 2% / 91% | 29% / 78% | 54% / 69% | 51% / 69% |
| Apostolic | 1% / 84% | 2% / 82% | 2% / 77% | 3% / 76% | 5% / 78% |
| Apostolic/Drexel | 8% / 78% | 8% / 76% | 8% / 76% | 7% / 67% | 7% / 66% |
| Central | 3% / 79% | 8% / 73% | 47% / 51% | 60% / 53% | 62% / 57% |
| Downtown Campus Connector | 2% / 74% | 3% / 75% | 18% / 53% | 36% / 37% | 37% / 40% |
| Drexel | 0% / 81% | 0% / 69% | 0% / 52% | 0% / 52% | 1% / 49% |
| East | 3% / 86% | 3% / 90% | 38% / 68% | 47% / 60% | 47% / 49% |
| Friend Center/Metra | 3% / 82% | 7% / 88% | 6% / 81% | 10% / 77% | 11% / 79% |
| Midway Metra | 2% / 71% | 1% / 76% | 12% / 77% | 11% / 81% | 20% / 81% |
| North | 7% / 74% | 4% / 64% | 10% / 60% | 15% / 57% | 19% / 64% |
| Red Line/Arts Block | 3% / 81% | 4% / 83% | 4% / 78% | 4% / 75% | 3% / 76% |
| Regents Express | 6% / 79% | 4% / 72% | 11% / 57% | 23% / 71% | 20% / 59% |
| South | 24% / 81% | 28% / 80% | 17% / 82% | 25% / 83% | 14% / 70% |
| South Loop Shuttle | 23% / 56% | 22% / 84% | 80% / 25% | 50% / 27% |  |

## 8. Situations (all days, goal leads): large-miss rate in it / otherwise on the line

| Line | Within 30 min of a bus count change / not (n) | Bus over 10 min behind (n) | No timetable time (n) | Next trip / current trip | Line overall |
|---|---:|---:|---:|---:|---:|
| 53rd Street Express | 72% / 69% (7,090) | 83% (3,059) |  | 61% / 75% | 69% |
| Apostolic | 67% / 67% (4,615) | 68% (682) |  | 64% / 70% | 67% |
| Apostolic/Drexel | 75% / 70% (11,199) | 80% (8,851) |  | 70% / 73% | 72% |
| Central | 58% / 59% (1,584) | 70% (5,610) |  | 54% / 66% | 60% |
| Downtown Campus Connector | 76% / 80% (20,766) | 80% (40) | 77% (24,876) | 100% / 77% | 77% |
| Drexel | 54% / 54% (1,271) | 90% (681) |  | 47% / 65% | 54% |
| East | 52% / 57% (1,939) | 71% (4,328) |  | 46% / 61% | 55% |
| Friend Center/Metra | 48% / 40% (1,242) | 49% (941) |  | 32% / 49% | 40% |
| Midway Metra | 71% / 71% (7,329) | 75% (4,484) |  | 75% / 68% | 71% |
| North | 52% / 45% (698) | 61% (1,334) |  | 32% / 52% | 45% |
| Red Line/Arts Block | 83% / 83% (10,567) | 87% (6,106) |  | 75% / 88% | 83% |
| Regents Express |  / 70% (0) | 75% (259) |  | 75% / 65% | 70% |
| South | 58% / 53% (768) | 71% (2,129) |  | 37% / 53% | 50% |
| South Loop Shuttle |  / 63% (0) | 82% (83) |  | 40% / 74% | 62% |
| All lines | 73% / 62% (69,068) | 76% (38,587) | 77% (24,876) | 57% / 70% | 65% |

## 9. Hours of the day, last 14 days (goal leads): bus early / bus late

| Line | 5 to 7 AM | 7 to 10 AM | 10 AM to 3 PM | 3 to 7 PM | 7 to 10 PM | 10 PM to 5 AM |
|---|---:|---:|---:|---:|---:|---:|
| All lines | 2% / 58% | 8% / 63% | 11% / 53% | 12% / 56% | 15% / 46% | 22% / 40% |
| 53rd Street Express |  | 21% / 48% | 22% / 48% | 22% / 46% |  |  |
| Apostolic | 0% / 57% | 6% / 59% | 0% / 96% |  |  |  |
| Apostolic/Drexel |  |  | 2% / 51% | 2% / 81% | 6% / 71% | 16% / 54% |
| Central |  |  |  | 21% / 49% | 25% / 28% | 35% / 20% |
| Downtown Campus Connector | 14% / 61% | 13% / 72% | 17% / 62% | 14% / 71% | 19% / 64% |  |
| Drexel | 0% / 61% | 0% / 63% |  |  |  |  |
| East |  |  |  | 17% / 48% | 17% / 39% | 23% / 31% |
| Friend Center/Metra | 3% / 39% | 1% / 46% | 6% / 30% | 10% / 33% | 40% / 26% | 5% / 66% |
| Midway Metra | 0% / 74% | 1% / 77% |  | 13% / 47% |  |  |
| North |  |  |  | 8% / 40% | 6% / 34% | 29% / 30% |
| Red Line/Arts Block | 4% / 77% | 8% / 76% | 0% / 85% | 3% / 81% | 1% / 79% |  |
| Regents Express |  |  |  | 4% / 86% | 9% / 58% |  |
| South |  |  |  | 9% / 39% | 8% / 37% | 16% / 48% |
| South Loop Shuttle |  |  |  |  | 42% / 16% | 44% / 23% |

## 10. The flags (`data/labeled/flags/prediction_flags.csv`)

| Severity | Flag | Line | Value | All lines | n | Days | Scope |
|---|---:|---:|---:|---:|---:|---:|---:|
| high | first_stop_next_trip_times | 53rd Street Express | 1.0000 | 0.5822 | 330 | 2026-10-28 to 2026-11-10 | stops=8811, 8628;lead=0-10;note=stop positions 1 2, 330 of 330 times the bus came later than shown |
| high | large_early_miss | 53rd Street Express | 0.2166 | 0.1098 | 13858 | 2026-10-28 to 2026-11-10 | lead=5-20;stops=8589, 8631, 8632, 161844, 8612;note=last 14 days 21.7%, before them 1.4% (worse) |
| high | large_early_miss | Central | 0.2407 | 0.1098 | 5483 | 2026-10-28 to 2026-11-10 | lead=5-20;stops=140016, 141862, 140009, 140012;hours=22-05;note=last 14 days 24.1%, before them 4.5% (worse) |
| high | large_early_miss | East | 0.1788 | 0.1098 | 6453 | 2026-10-28 to 2026-11-10 | lead=5-15;stops=140013, 8578, 140014, 140015;hours=22-05;note=last 14 days 17.9%, before them 2.9% (worse) |
| high | large_early_miss | South | 0.1183 | 0.0694 | 11888 | 2026-10-12 to 2026-11-10 | lead=5-15;stops=8652, 8633, 8630, 8631;hours=22-05;note=last 14 days 9.9%, before them 13.6% (better) |
| high | large_early_miss | South Loop Shuttle | 0.2872 | 0.0694 | 571 | 2026-10-12 to 2026-11-10 | lead=5-45;stops=141882;note=last 14 days 41.8%, before them 21.2% (worse) |
| high | large_late_miss | Red Line/Arts Block | 0.7956 | 0.5529 | 10426 | 2026-10-28 to 2026-11-10 | lead=5-45;note=last 14 days 79.6%, before them 79.5% (same) |
| high | large_late_miss | Regents Express | 0.7048 | 0.5529 | 813 | 2026-10-28 to 2026-11-10 | lead=5-30;note=last 14 days 70.5%, before them 57.7% (worse) |
| high | other_trip_times | Apostolic/Drexel | 0.7431 | 0.5822 | 109 | 2026-10-28 to 2026-11-10 | stops=8609;lead=0-10;note=stop positions 5, 75 of 109 times the bus came later than shown |
| high | other_trip_times | Central | 0.9953 | 0.5822 | 213 | 2026-10-28 to 2026-11-10 | stops=8634, 8635, 140009;lead=0-10;note=stop positions 7 8 9, 212 of 213 times the bus came earlier than shown |
| high | stops_without_predictions | 53rd Street Express | 0.0833 | 0.6594 | 792 | 2026-10-28 to 2026-11-10 | stops=8811, 8628, 138837;lead=0-10;note=a time at any lead 1 to 30 min ahead 47%, before the last 14 days 87% of 843 arrivals had one 5 min ahead |
| high | stops_without_predictions | Apostolic | 0.0442 | 0.6594 | 249 | 2026-10-28 to 2026-11-10 | stops=8613;lead=0-10;note=a time at any lead 1 to 30 min ahead 9%, before the last 14 days 81% of 293 arrivals had one 5 min ahead |
| high | stops_without_predictions | Apostolic/Drexel | 0.0021 | 0.6594 | 471 | 2026-10-28 to 2026-11-10 | stops=225834;lead=0-10;note=a time at any lead 1 to 30 min ahead 3%, before the last 14 days 68% of 97 arrivals had one 5 min ahead |
| high | stops_without_predictions | Downtown Campus Connector | 0.0226 | 0.6594 | 2212 | 2026-10-28 to 2026-11-10 | stops=140009, 151794, 155005, 132965, 155006, 132963, 132964;lead=0-10;note=a time at any lead 1 to 30 min ahead 37%, before the last 14 days 89% of 2722 arrivals had one 5 min ahead |
| high | stops_without_predictions | East | 0.0607 | 0.6594 | 610 | 2026-10-28 to 2026-11-10 | stops=8633, 8634, 8635;lead=0-10;note=a time at any lead 1 to 30 min ahead 8%, before the last 14 days 76% of 698 arrivals had one 5 min ahead |
| high | stops_without_predictions | Red Line/Arts Block | 0.0198 | 0.6594 | 354 | 2026-10-28 to 2026-11-10 | stops=138836;lead=0-10;note=a time at any lead 1 to 30 min ahead 6%, before the last 14 days 92% of 461 arrivals had one 5 min ahead |
| high | worse_when_behind | Drexel | 1.7904 | 1.2148 | 681 | 2026-10-12 to 2026-11-10 | lead=5-30;note=delay_s > 600 in the forecast table |
| high | worse_when_behind | South | 1.5409 | 1.2148 | 2129 | 2026-10-12 to 2026-11-10 | lead=5-30;note=delay_s > 600 in the forecast table |
| medium | first_stop_next_trip_times | Friend Center/Metra | 0.9701 | 0.5822 | 67 | 2026-10-28 to 2026-11-10 | stops=8613;lead=0-10;note=stop positions 1, 38 of 67 times the bus came earlier than shown |
| medium | large_early_miss | Downtown Campus Connector | 0.1555 | 0.1098 | 9981 | 2026-10-28 to 2026-11-10 | lead=5-30;stops=151793, 151792, 132967;note=last 14 days 15.6%, before them 3.2% (worse) |
| medium | large_late_miss | Apostolic/Drexel | 0.6687 | 0.5529 | 12039 | 2026-10-28 to 2026-11-10 | lead=5-45;note=last 14 days 66.9%, before them 65.5% (same) |
| medium | large_late_miss | Downtown Campus Connector | 0.6747 | 0.5529 | 9981 | 2026-10-28 to 2026-11-10 | lead=5-45;note=last 14 days 67.5%, before them 69.8% (same) |
| medium | other_trip_times | East | 0.8750 | 0.5822 | 40 | 2026-10-28 to 2026-11-10 | stops=140014;lead=0-10;note=stop positions 9, 35 of 40 times the bus came earlier than shown |
| medium | stops_without_predictions | Central | 0.1243 | 0.6594 | 668 | 2026-10-28 to 2026-11-10 | stops=141882, 8584, 8644, 8597;lead=0-10;note=a time at any lead 1 to 30 min ahead 73%, before the last 14 days 66% of 708 arrivals had one 5 min ahead |
| medium | stops_without_predictions | Drexel | 0.1849 | 0.6594 | 503 | 2026-10-28 to 2026-11-10 | stops=8612, 8613;lead=0-10;note=a time at any lead 1 to 30 min ahead 85%, before the last 14 days 64% of 597 arrivals had one 5 min ahead |
| medium | stops_without_predictions | North | 0.2087 | 0.6594 | 623 | 2026-10-28 to 2026-11-10 | stops=8633, 8634, 8635;lead=0-10;note=a time at any lead 1 to 30 min ahead 33%, before the last 14 days 58% of 718 arrivals had one 5 min ahead |
| medium | stops_without_predictions | Regents Express | 0.1515 | 0.6594 | 33 | 2026-10-28 to 2026-11-10 | stops=8643;lead=0-10;note=a time at any lead 1 to 30 min ahead 36%, before the last 14 days 67% of 36 arrivals had one 5 min ahead |
| medium | worse_when_behind | Central | 1.3071 | 1.2148 | 5610 | 2026-10-12 to 2026-11-10 | lead=5-30;note=delay_s > 600 in the forecast table |
| medium | worse_when_behind | East | 1.3994 | 1.2148 | 4328 | 2026-10-12 to 2026-11-10 | lead=5-30;note=delay_s > 600 in the forecast table |
| medium | worse_when_behind | North | 1.4803 | 1.2148 | 1334 | 2026-10-12 to 2026-11-10 | lead=5-30;note=delay_s > 600 in the forecast table |
| low | first_stop_next_trip_times | Red Line/Arts Block | 0.5325 | 0.5822 | 246 | 2026-10-28 to 2026-11-10 | stops=67599, 8650, 67600;lead=0-10;note=stop positions 1 2 3, 112 of 246 times the bus came later than shown |
| low | first_stop_next_trip_times | South | 0.5641 | 0.5822 | 39 | 2026-10-28 to 2026-11-10 | stops=8631;lead=0-10;note=stop positions 0 16, 12 of 39 times the bus came later than shown |
| low | large_late_miss | Drexel | 0.6287 | 0.5529 | 2529 | 2026-10-28 to 2026-11-10 | lead=5-45;stops=8611;note=last 14 days 62.9%, before them 49.4% (worse) |
| low | large_late_miss | Midway Metra | 0.6341 | 0.5529 | 10100 | 2026-10-28 to 2026-11-10 | lead=10-45;note=last 14 days 63.4%, before them 69.9% (same) |
| low | other_trip_times | Drexel | 0.4000 | 0.5822 | 50 | 2026-10-28 to 2026-11-10 | stops=8609;lead=0-10;note=stop positions 6, 19 of 50 times the bus came later than shown |
| low | worse_near_transitions | Friend Center/Metra | 1.1971 | 1.1718 | 1242 | 2026-10-12 to 2026-11-10 | lead=5-30;note=transitions = data/labeled/transitions/transitions.csv (E29) |
| low | worse_when_behind | Friend Center/Metra | 1.2317 | 1.2148 | 941 | 2026-10-12 to 2026-11-10 | lead=5-30;note=delay_s > 600 in the forecast table |


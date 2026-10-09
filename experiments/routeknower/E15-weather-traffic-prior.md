# E15: How much do rain and snow slow traffic around the shuttle network?

Date: 2026-10-08 · Agent: Claude (lead session) · Data: `data/context/traffic_regions_hourly.csv` (sha256 97172f2c3daf8951...)
and `data/context/weather_mdw.csv` (sha256 a348adb38cddf4b0...) on the `data` branch; hours 2022-01-01 to 2026-04-30.
Question: is weather a big enough effect to model now, and how many wet / snowy days will we have collected by the ship date?
Method: Chicago Traffic Tracker hourly region speeds (City of Chicago, from CTA bus GPS) for Hyde Park-Kenwood-Woodlawn
(holds 76 of 91 shuttle stops) and the Loop, joined hour by hour with Chicago Midway (MDW) routine METARs.
Relative speed = speed / median of DRY hours in the same region x weekday x hour x season. 95% intervals by
bootstrapping whole days. Pandemic years 2020-21 skipped for the effect sizes (2018-2025 used for day counts).
Protocol: descriptive prior, not a prediction test; no shuttle data involved, so §6 leakage rules do not apply.

## Decision
**Adopt as a prior, keep weather a secondary feature.** Rain and snow slow arterial traffic by only ~2-4.5 %:
on a 10-minute ride that is ~15-30 s, small next to the pilot's ~100 s average error and next to time-of-day
and same-day congestion. So:
- M14 starts from run-time multipliers light rain x1.02, heavy rain x1.04, snow x1.04 (1 / (1 - speed drop)),
  then re-estimates them from shuttle segments once >= 10 wet service days are collected (expected by ~Nov 5).
- Snow cannot be validated before shipping (~5 snow-report days by Nov 30, mostly flurries): ship with the prior
  only, labelled as such, and collect through the winter quarter.
- The same-day fleet congestion index (M13) stays the main "traffic today" signal.

## Caveats (why the real effect on shuttles may differ)
- Region speeds are city-wide-style averages of CTA bus estimates on arterials; campus streets (Ellis, University,
  55th, 59th) are not covered, and averaging dilutes local jams.
- Weather is measured ~10 km away at Midway; misclassified hours bias the effects TOWARD zero, so true effects are
  probably somewhat larger.
- Rain also lengthens DWELL (more riders, slower boarding), which this speed data cannot show; E16 measures it.
- The city stopped updating the Traffic Tracker on 2026-04-30, so this is history, not current traffic.

## Reproduce
```
git fetch origin data
MSYS_NO_PATHCONV=1 git show origin/data:data/context/traffic_regions_hourly.csv > "$TEMP/t.csv"
MSYS_NO_PATHCONV=1 git show origin/data:data/context/weather_mdw.csv > "$TEMP/w.csv"
python tools/rk_weather_traffic.py --traffic "$TEMP/t.csv" --weather "$TEMP/w.csv" --out experiments/routeknower/E15-weather-traffic-prior.md
```
(the script rewrites only the part below the results marker)

## Results
<!-- E15:RESULTS -->
Joined hours: 64551 (2022-01-01 to 2026-04-30), regions: Chicago Loop, Hyde Park-Kenwood-Woodlawn.

## By region
| group | weather (MDW hour) | mean speed vs dry baseline | 95% CI (days bootstrap) | hours | days |
|---|---|---:|---|---:|---:|
| Chicago Loop | dry | +0.1% | -0.1% to +0.3% | 28616 | 1363 |
| Chicago Loop | light rain | -2.2% | -2.7% to -1.7% | 1907 | 422 |
| Chicago Loop | heavy rain | -4.5% | -5.4% to -3.7% | 471 | 193 |
| Chicago Loop | snow | -2.3% | -3.2% to -1.4% | 1582 | 204 |
| Hyde Park-Kenwood-Woodlawn | dry | +0.2% | +0.1% to +0.4% | 28095 | 1363 |
| Hyde Park-Kenwood-Woodlawn | light rain | -2.0% | -2.5% to -1.4% | 1867 | 419 |
| Hyde Park-Kenwood-Woodlawn | heavy rain | -3.5% | -4.0% to -2.9% | 466 | 193 |
| Hyde Park-Kenwood-Woodlawn | snow | -3.5% | -4.4% to -2.6% | 1547 | 203 |

## Hyde Park-Kenwood-Woodlawn by daypart
| group | weather (MDW hour) | mean speed vs dry baseline | 95% CI (days bootstrap) | hours | days |
|---|---|---:|---|---:|---:|
| am peak 7-9 | dry | +0.5% | +0.3% to +0.7% | 3641 | 1275 |
| am peak 7-9 | light rain | -1.8% | -2.9% to -0.6% | 208 | 123 |
| am peak 7-9 | heavy rain | -4.1% | -4.8% to -3.2% | 39 | 26 |
| am peak 7-9 | snow | -3.3% | -5.0% to -1.7% | 186 | 81 |
| evening/night | dry | +0.4% | +0.3% to +0.6% | 13638 | 1353 |
| evening/night | light rain | -2.0% | -2.8% to -1.1% | 935 | 333 |
| evening/night | heavy rain | -4.3% | -4.9% to -3.6% | 246 | 125 |
| evening/night | snow | -4.0% | -4.8% to -3.1% | 857 | 184 |
| midday 10-15 | dry | -0.4% | -0.6% to -0.2% | 7248 | 1308 |
| midday 10-15 | light rain | -1.9% | -2.4% to -1.4% | 465 | 190 |
| midday 10-15 | heavy rain | -2.2% | -3.0% to -1.2% | 121 | 73 |
| midday 10-15 | snow | -3.0% | -4.5% to -1.7% | 326 | 90 |
| pm peak 16-18 | dry | +0.4% | +0.2% to +0.6% | 3568 | 1266 |
| pm peak 16-18 | light rain | -1.9% | -2.6% to -1.1% | 259 | 145 |
| pm peak 16-18 | heavy rain | -2.2% | -3.2% to -1.1% | 60 | 50 |
| pm peak 16-18 | snow | -2.5% | -4.1% to -0.9% | 178 | 78 |

## Hyde Park-Kenwood-Woodlawn by season
| group | weather (MDW hour) | mean speed vs dry baseline | 95% CI (days bootstrap) | hours | days |
|---|---|---:|---|---:|---:|
| warm | dry | +0.2% | +0.1% to +0.4% | 16386 | 759 |
| warm | light rain | -1.9% | -2.6% to -1.0% | 939 | 246 |
| warm | heavy rain | -3.6% | -4.2% to -3.0% | 340 | 138 |
| warm | snow | +1.1% | +0.2% to +2.5% | 50 | 11 |
| winter | dry | +0.2% | -0.0% to +0.4% | 11709 | 604 |
| winter | light rain | -2.0% | -2.7% to -1.2% | 928 | 173 |
| winter | heavy rain | -3.2% | -4.2% to -2.2% | 126 | 55 |
| winter | snow | -3.7% | -4.5% to -2.8% | 1497 | 192 |

## Expected wet / snowy service days, Oct 8 - Nov 30 (MDW, 7 AM - 11 PM, days with >= 12 hourly reports)
| year | service days | days with measurable precip | days with snow reported |
|---|---:|---:|---:|
| 2018 | 54 | 23 | 9 |
| 2019 | 54 | 24 | 4 |
| 2020 | 54 | 20 | 5 |
| 2021 | 54 | 23 | 5 |
| 2022 | 54 | 17 | 6 |
| 2023 | 54 | 21 | 3 |
| 2024 | 54 | 15 | 4 |
| 2025 | 54 | 16 | 6 |
| mean | 54.0 | 19.9 | 5.2 |

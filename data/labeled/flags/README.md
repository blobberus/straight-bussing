# Flagged lines: what every agent must notice and account for

Owner, 2026-11-11: "The analysis should check for buses that have odd behavior during transition times and lines that
have large prediction misses. Create or indicate wherever appropriate for another agent to analyze and notice and
account for this data. Flag these lines and also tell me." And 2026-11-13: "Run a data collection check recording bus
line issues" (category `collection`).

A **flag** says: on this line (and these stops, hours, buses), the data behaves differently enough from the other
lines that a model, a display rule or a data check must treat it on its own. One row per (category, flag, line).
**Read this before you train or score a prediction model, change how the app shows buses or times, or run a data
checkup.**

| File | Written by | What it flags |
|---|---|---|
| `transition_flags.csv` | RouteKnower E30 (`experiments/routeknower/E30-scripts/`) | odd bus behavior at transition times (a line's bus count changing: breaks, shift ends, buses moving lines or vanishing) |
| `prediction_flags.csv` | RouteKnower E31 (`experiments/routeknower/E31-scripts/`) | lines (stops, hours, leads) with large prediction misses |
| `display_flags.csv` | RouteKnower E32 (`experiments/routeknower/E32-scripts/`) | what the shipped display rules (off-route, idle, gone, bus numbers) showed riders around those episodes |
| `collection_flags.csv` | `tools/collection_flags.py` (evidence `data/labeled/collection/`) | lines whose **collected data** is less complete or less right than the others' (rows only the GPS saw, stops Passio never names, rows without a Passio time, buses under another line's label, stops the collector rarely logs, listed hours with no bus, report gaps) |
| **`flagged_lines.csv`** | `tools/flag_lines.py` (never edit by hand) | **all of the above in one registry**: active flags first, then by severity, line and flag |
| `docs/FLAGGED-LINES.md` | `tools/flag_lines.py` (never edit by hand) | the same, per line in plain English |

The newest weekly refresh is also the `flagged_lines` tab of the data repo's findings workbook
(github.com/blobberus/straight-bussing-data, `findings/straight-bussing-findings.xlsx`, CSV copy
`findings/csv/flagged_lines.csv`). This folder is the reviewed copy.

Unofficial analysis of the public Passio feed; not a statement by the operator or the University. Official service
information: 773.702.8181.

## What every agent must do

- **Prediction / ETA / model agents** (RouteKnower, `algorithm-test/` in the data repo, anything that changes what
  time a rider sees):
  1. Score every active flag (`status` open or watch) as **its own slice**: the line's rows, narrowed by the flag's
     `scope` (stops, hours, days, buses, minutes ahead, trips). Report n with every slice. A model that wins on average
     but loses on a flagged slice is **not shipped** (RouteKnower.md 6.4; ship gate 6.6: no line more than 10% worse
     than Passio, never too late more often). The data repo's bench does this for every model:
     `python algorithm-test/run_all.py --only 13` -> `algorithm-test/results/13-flagged-lines.md`.
  2. Keep flagged episodes **out of the training labels** when the flag's `agent_action` says so (the episode lists
     are in `evidence`, e.g. `data/labeled/transitions/`); never drop them from the **test** rows: riders see them.
  3. A flag is not a feature by itself (it is built from the whole period, a leak under RouteKnower 6.2); use the
     facts behind it as known at query time (the forecast table's `transition_min`, `bus_leaves_min`, ...).
- **App agents** (web `web/js/core/`, iOS Kit): read the flags of a line **before changing a display rule** that
  concerns it: off-route (`core/offroute.js`, Kit `OffRoute.swift`), idle (`core/idle.js`), gone / transitions
  (`core/transition.js`), bus numbers (`core/busnum.js`). Replay the flag's episodes (E32's fixtures) and say what
  changes for riders. **Never hide a bus or a time on a flag alone**: a flag is evidence, the owner decides. Rider
  safety first: stale or doubtful data is labeled, not silently removed.
- **Data agents** (checkups, `monitoring.md`, `docs/DATA-COLLECTION-LOG.md`): at every checkup run
  `python tools/flag_lines.py --check`, look at each high flag's line (is its data complete? did the pattern
  change?), and note in the checkup what you saw. A flagged line with missing data is worth a DC entry. The
  `collection` flags say where a line's data is expected to be thin or odd (a line-day under its median on a flagged
  hour is not a new gap); a line newly in one, or a high one whose number moves a lot, is.
- **Everyone:** never write a flag into `flagged_lines.csv` or `docs/FLAGGED-LINES.md` by hand. Fix the producer's
  script (or its file), rerun `python tools/flag_lines.py`, commit all three.

## Columns (every file, in this order)

| Column | Meaning |
|---|---|
| flag_id | `<category>:<flag>:<route_id>`; stable across refreshes (the merge keys on it) |
| route_id | GTFS route id from `web/data/routes.json` (never passiogo.com ids) |
| route | the line's name; the registry rewrites it from routes.json |
| category | `transition` (transition_flags.csv), `prediction_miss` (prediction_flags.csv), `display` (display_flags.csv), `collection` (collection_flags.csv) |
| flag | short snake_case code, e.g. `phantom_times_after_leave` |
| severity | `high`, `medium`, `low` (rules below) |
| scope | where and when, `;`-separated `key=value` parts (grammar below); empty or `all` = the whole line |
| metric | what `value` measures, in words (units included) |
| value, baseline | the line's number and the same number over all lines (dot decimals, no % sign or commas; baseline may be blank) |
| n | the sample size behind `value` (a whole number) |
| data_from, data_to | the service days measured (YYYY-MM-DD) |
| evidence | repo-relative paths and the experiment id (e.g. `data/labeled/transitions/odd_episodes.csv; RouteKnower E30`) |
| agent_action | one sentence: what a model or app agent must do about it |
| first_flagged, last_checked | first day flagged (kept across refreshes) and the day last confirmed; a resolved flag keeps the day it was resolved |
| status | `open` (act on it), `watch` (a pattern to recheck; slice it, change nothing else), `resolved` (a refresh no longer reports it; kept for history) |

### Scope grammar

Parts separated by `;`, each `key=value`, several values joined by `|`. Example:
`stops=8811|20132;hours=23-01;days=weekday;vehicles=4325`.

| Key | Values | Filter on a forecast-table row |
|---|---|---|
| `stops` | GTFS stop ids (`web/data/stops.json`) | `stop_id` |
| `hours` | Chicago clock hours `start-end`, end exclusive; `23-01` wraps past midnight | the query time's hour |
| `days` | `weekday`, `saturday`, `sunday`, `weekend`, `mon` .. `sun` | `day_type` / `dow` |
| `vehicles` | Passio bus numbers | `vehicle_id` |
| `lead` | minutes ahead `lo-hi` (prediction flags) | `lead_s` |
| `trips` | `no_timetable` (trips the timetable does not list), `timetable` | no timetable time (`tt_epoch` blank) |
| `dates` | service days YYYY-MM-DD (single episodes) | `service_day` |
| `note` | free text for people | never a filter |

A part that is not `key=value`, or an unknown key, is kept as text with a warning (no bench or app can filter on it).
A known key with a bad value is a problem (`--check` fails).

## Severity rules

The default, for any producer that states no rule of its own:
- **high**: riders can be misled on this line now (times that never come true, a bus shown that is not coming or is
  about to leave, misses beyond the goal at leads riders rely on), at least twice the all-lines baseline, on n >= 30
  and on 3 or more service days;
- **medium**: at least 1.5 times the baseline on n >= 30, or a high-impact pattern on fewer samples;
- **low**: a real but small difference, or too few samples to act on (often `watch`).

Each producer's own rule (it wins over the default; the full text is in its README):
- **E30 transitions** (`data/labeled/transitions/README.md`, "Flags: the E30 severity rule"): ratio = the line's rate /
  all lines'; high = ratio >= 2 on >= 30 episodes (15 for once-a-day spans and timetable steps) and >= 5 days, and riders
  can be misled; medium = ratio >= 1.5 on 30 (15) episodes and 3 days, or ratio >= 2 on 10 (8), or a would-be high that
  misleads nobody; low (`watch`) = ratio >= 1.5 on 10 (8) episodes and 3 days. A behavior every line shares is a fact
  of the feed, not a flag.
- **E31 prediction misses** (`data/labeled/prediction_misses/README.md`, "Severity rule (E31)"): large early / late
  misses high at >= 1.5 x all lines (or + 15 points) with the interval's low end above all lines on n >= 300 and 5 days,
  medium 1.25 x / + 10 points, low 1.1 x / + 5 points; stops without predictions high under 10% with a time 5 min ahead
  on >= 100 arrivals; next-trip and other-trip times high when >= 50% of them are large misses on n >= 100; worse near
  transitions / when behind high at a ratio >= 1.5 on >= 300 rows.
- **E32 display replay** (`experiments/routeknower/E32-display-replay-tables.md` section 7): high = a measure that
  misleads riders (ghost times, false hides, planner) at >= 2 x all lines, n >= 300, >= 30 events on >= 3 days and still
  >= 1.5 x on >= 10 events since Nov 6; medium = >= 1.5 x on the same n and events (bus number churn and ghost badges at
  most medium: >= 2 x on 100 events); low (`watch`) = >= 1.5 x on 10 to 29 events; graded on all days and on the days
  since Nov 6, the higher grade wins. Before changing a display rule, rerun its episodes in `web/tests/data-display.js`.
- **Collection** (`data/labeled/collection/README.md`, "Severity rule (collection)"): ratio = the line's rate / all
  lines'; high = ratio >= 2 with the measure's minimum excess (e.g. 10 points for shares of rows), n >= 300, >= 30
  events and >= 3 service days over 2 x; medium = 1.5 x on n >= 100, 10 events, 3 days; low (`watch`) = 1.25 x on n >= 30,
  5 events, 2 days; graded on all collected days and on the last 14, the higher grade wins; thin line-days at most
  medium; `stops_rarely_logged` high when a stop the buses come within 120 m of gets under a tenth of the line's median
  rows on 7+ days.

Before acting on a flag, read the producer's "for other agents" notes too (E30's lists which episodes to drop from
training labels: `feed_drop_mid_route`, `sparse_reporting`, `frozen_gps`, `wrong_line_label`; the collection README's
adds the rows of `data/labeled/collection/wrong_label_episodes.csv`, all day; never from test rows).

## Refresh

```
# 1. rerun the producers (their READMEs give the exact commands and the data they need)
# 2. merge, validate, commit
python tools/flag_lines.py                # writes flagged_lines.csv and docs/FLAGGED-LINES.md
python tools/flag_lines.py --check        # exit 1 on a problem or an out-of-date registry
python tools/flag_lines.py --check-inputs # a producer, before committing its *_flags.csv: its rows only
python tools/test_flag_lines.py           # the tool's own tests (also run by .github/workflows/collector-tests.yml)
```

**Weekly, without rerunning anything here:** every Monday the data repo's `findings.yml` (github.com/blobberus/
straight-bussing-data, `findings/run_findings.py`) reruns E30 and E31 on all archived days and publishes their files
in `findings/flags/` there, plus its merged copy (`findings/csv/flagged_lines.csv`, `findings/FLAGGED-LINES.md`).
To adopt a refresh: copy `findings/flags/*_flags.csv` into this folder, run `python tools/flag_lines.py`, read the
diff of `flagged_lines.csv` (new flags, `resolved` ones, changed severity), then commit. E32's `display_flags.csv`
needs a browser, so the data repo never reruns it; refresh it here (E32 tables file section 8).

The merge keeps `first_flagged`, turns a flag that a producer's refreshed file no longer reports into `resolved`
(instead of deleting it), and leaves the flags of a producer whose file is missing as they were (with a warning).

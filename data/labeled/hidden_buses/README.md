# Hidden buses that Passio still had times for

Owner, 2026-11-11, on RouteKnower E32: "Keep hidden bus times off until it reports again. If passio is still
reporting them, add them to a hidden bus file in the data (explain in the file what this file is)."

**`hidden_buses.csv`** has one row per episode. In an episode, one of the app's display rules kept a bus, or its
times, off the screen while Passio's public tripUpdates feed still had arrival times for that bus (0 to 60 min ahead).
**The file explains itself**: its `#` lines at the top say what it is, why it exists, how it was made, every column and
how to refresh it. Skip them when reading:
- pandas: `pd.read_csv(path, comment="#")`
- Python: `experiments/routeknower/E32-scripts/hidden_buses.py` `read_rows()`
- Google Sheets: import it, then delete the comment rows

Made by `experiments/routeknower/E32-scripts/hidden_buses.py` (test `test_hidden_buses.py` beside it). It reads E32's
replay, which runs the app's own `web/js` code on every archived day (`inputs.py`, `replay.py` in headless Edge), and
the collector's `arrivals.csv`.

## Rules

| rule | what the app did |
|---|---|
| `off_route` | `core/offroute.js`: 250 m from its line for 45 s. The bus and its times are dropped. |
| `idle` | `core/idle.js` (`idle_reason`: idle, parked, past, linger). The bus and its times are dropped. |
| `gone` | `core/transition.js` GONE: silent 15 min while the feed is alive. Its times are dropped. |
| `not_operating` | After an off_route or idle hide, the bus stopped reporting. `core/operating.js` drops it after 5 min, so the two rules no longer see it. In the shipped code its Passio times came back until GONE: `times_shown_by_app = y`. This is the KNOWN GAP the owner's rule closes. |
| `held` | `core/transition.js` heldStep, the owner's rule, live since 2026-11-11. A bus a rule hid that then stopped reporting keeps its times off until it reports again. Replay poll field 8. |
| `transitioning` | `core/seen.js`, live since 2026-11-11. An off-route bus on its way to a new line stays on the map, marked "Transitioning to new line", but its Passio times are dropped (`TRANSITION_TIMES` false). Replay poll field 9. It is listed only while a replay drops those times. |

## Current build (2026-11-11, rules on main@d65931ad, replayed on Oct 10 to Nov 10, 32 days)

1,997 episodes. In brackets: came to serve within 15 min, and Passio's bus-minutes of times:
- **off_route** 1,164 (410; 10,208 bus-min).
- **transitioning** 309 (185; 1,321 bus-min): the badge stays, the times are off.
- **gone** 191 (46; 2,743 bus-min).
- **held** 179 (15; 1,928 bus-min held back).
- **idle** 113 (35; 1,172 bus-min).
- **not_operating** 41 (22; 120 bus-min the app still shows).

Share of the first minute's times that came true: off_route 12%, idle 1%, gone 3%, held 4%, transitioning 17%,
not_operating 21%. "Came true" means the bus logged that stop from 1 min before to 15 min after the time. The held
times were ghosts. The transitioning buses mostly came to serve (60%), but most of their times did not come true:
Apostolic/Drexel has 101 of its 122.

Episodes per line and rule (in brackets: came to serve within 15 min):

| line | off_route | idle | gone | held | transitioning | not_operating |
|---|---|---|---|---|---|---|
| Downtown Campus Connector | 354 (113) | 9 (1) | 78 (18) | 30 (0) | 76 (31) | 14 (6) |
| Apostolic/Drexel | 213 (130) | 32 (0) | 19 (3) | 34 (2) | 122 (101) | 6 (5) |
| Red Line/Arts Block | 205 (50) | 4 (1) | 8 (0) | 25 (2) | 60 (18) | 3 (2) |
| Friend Center/Metra | 74 (42) | 2 (1) | 3 (0) | 16 (6) | 19 (16) | 9 (6) |
| South | 54 (7) | 29 (13) | 18 (5) | 11 (0) | 4 (3) | 4 (0) |
| Central | 48 (10) | 7 (2) | 10 (1) | 19 (2) | 5 (5) | 3 (2) |
| East | 38 (3) | 3 (1) | 23 (4) | 20 (0) | 3 (1) | 0 |
| North | 34 (1) | 23 (16) | 7 (0) | 11 (1) | 2 (2) | 0 |
| 53rd Street Express | 44 (21) | 0 | 6 (0) | 4 (0) | 5 (4) | 1 (0) |
| Apostolic | 40 (19) | 0 | 8 (8) | 0 | 0 | 1 (1) |
| Midway Metra | 28 (4) | 0 | 7 (4) | 5 (1) | 4 (1) | 0 |
| Drexel | 17 (2) | 0 | 0 | 2 (0) | 2 (0) | 0 |
| Regents Express | 9 (4) | 0 | 3 (2) | 2 (1) | 7 (3) | 0 |
| South Loop Shuttle | 6 (4) | 4 (0) | 1 (1) | 0 | 0 | 0 |

## Against the shipped rules (the first build, 1,698 episodes)

Episodes, shipped -> new:
- off_route 1,185 -> 1,164.
- idle 104 -> 113. Downtown, the wider 150 m still radius catches more parked buses.
- gone 191 -> 191.
- not_operating 218 -> 41.
- held 0 -> 179.
- transitioning 0 -> 309.

**Times the app now holds back:** the shipped app showed Passio's times again for 1,525 bus-minutes after a hide
(not_operating). The held rule now keeps 1,928 bus-minutes of times off; that is more than 1,525 because a held
bus stays held past GONE's 15 min until it reports again. Only 120 bus-minutes (41 episodes) are still reshown.

The held episodes per line went from 0 to: Apostolic/Drexel 34, Downtown Campus Connector 30, Red Line/Arts Block
25, East 20, Central 19, Friend Center/Metra 16, South 11, North 11.

The not_operating episodes, shipped -> new: Downtown Campus Connector 46 -> 14, Apostolic/Drexel 39 -> 6, Red
Line/Arts Block 27 -> 3, Friend Center/Metra 23 -> 9, Central 20 -> 3, East 20 -> 0, South 15 -> 4, North 10 -> 0.

Off-route hides that the transition marks turned into transitioning: Apostolic/Drexel 228 -> 213 off_route, with 122
transitioning; Downtown Campus Connector 358 -> 354, with 76.

After any display-rule change, rebuild with the commands in the file's REFRESH lines. Label the run with
`--rules main@<commit of web/js>`, and compare the old and new files per rule and line.

Hides with no Passio time at all are not listed. The header's TOTALS line counts them: off_route 261, idle 82, gone 163,
held 86, transitioning 76, not_operating 8.

## For other agents

- **App agents** (the display rules): this file is the check for every hide. A rule change is replayed (E32c), the
  file is rebuilt with `--rules <label>`, and the before and after counts go in RouteKnower E32. `came_to_serve_15 = y`
  with `first_times_came_true > 0` is a hide that cost riders a real bus.
- **Models and scoring**: Passio's times in these episodes were not on the screen (except `not_operating` in the
  shipped code). Score "what riders saw" without them, and score Passio's raw feed with them.
- **Refresh**: in the data repo's weekly `findings.yml`, its replay step writes `findings/hidden_buses/hidden_buses.csv`.
  To adopt that file here, copy it in, check the TOTALS line and commit. By hand, run the commands in the file's
  REFRESH lines. The weekly replay works on GitHub's runner: the first run (43070787938, 2026-11-11) replayed 31 days
  in about 2.5 min with headless Edge 156 (`findings/last_run.json` `hidden_buses`). That replay could carry E32b's
  display flags too, but those need planner samples (`--plan 300`, slower), which this step skips.

## Caveats

- The days before Nov 11 (Nov 6 for the first rules) are what the rules WOULD have hidden: the replay applies main's
  rules to every day.
- Minutes, not seconds: an episode is read at each whole minute, and minutes no more than 2 min apart join.
- `sparse_reporter = y` (bus 12647 on some days) cannot be judged: such a bus may serve unseen.
- `came_to_serve_15` comes from the collector's arrivals, which can miss a stop (DC-023). A `n` is "no logged
  arrival", not proof.

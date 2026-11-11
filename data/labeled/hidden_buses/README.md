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
| `held` | The times are kept off until the bus reports again (the owner's rule). This rule appears once the replayed code has it (poll field 9 of the replay). |

## First build (2026-11-11, rules shipped on Nov 6, replayed on Oct 10 to Nov 10, 32 days)

1,698 episodes:
- **off_route** 1,185: 440 of them came to serve within 15 min; Passio had times for 11,529 bus-minutes.
- **not_operating** 218: 38 came to serve; 1,525 bus-minutes of times that the shipped app showed again.
- **gone** 191: 46 came to serve; 2,743 bus-minutes.
- **idle** 104: 35 came to serve; 1,088 bus-minutes; 77 of them were learned linger spots.

Of the times Passio had at an episode's first minute, 13% came true for off_route, 7% for not_operating, 3% for gone
and 2% for idle. "Came true" means the bus logged that stop from 1 min before to 15 min after the time. Most hidden
times were ghosts. Off-route hides of a bus that then served are the exception: E32's false hides, the evening loops
of Apostolic/Drexel and Friend Center/Metra.

Episodes per line and rule (in brackets: how many came to serve within 15 min):

| line | off_route | idle | gone | not_operating |
|---|---|---|---|---|
| Downtown Campus Connector | 358 (121) | 6 (1) | 78 (18) | 46 (8) |
| Apostolic/Drexel | 228 (146) | 32 (0) | 19 (3) | 39 (7) |
| Red Line/Arts Block | 205 (52) | 4 (1) | 8 (0) | 27 (4) |
| Friend Center/Metra | 74 (43) | 2 (1) | 3 (0) | 23 (10) |
| South | 54 (8) | 23 (13) | 18 (5) | 15 (0) |
| Central | 47 (9) | 7 (2) | 10 (1) | 20 (3) |
| 53rd Street Express | 46 (23) | 0 | 6 (0) | 5 (0) |
| Apostolic | 40 (19) | 0 | 8 (8) | 1 (1) |
| East | 38 (3) | 3 (1) | 23 (4) | 20 (0) |
| North | 35 (2) | 23 (16) | 7 (0) | 10 (0) |
| Midway Metra | 28 (4) | 0 | 7 (4) | 4 (0) |
| Drexel | 17 (2) | 0 | 0 | 2 (0) |
| Regents Express | 9 (4) | 0 | 3 (2) | 6 (5) |
| South Loop Shuttle | 6 (4) | 4 (0) | 1 (1) | 0 |

Hides with no Passio time at all are not listed. The header's TOTALS line counts them: off_route 253, idle 84, gone 163,
not_operating 88.

## For other agents

- **App agents** (the display rules): this file is the check for every hide. A rule change is replayed (E32c), the
  file is rebuilt with `--rules <label>`, and the before and after counts go in RouteKnower E32. `came_to_serve_15 = y`
  with `first_times_came_true > 0` is a hide that cost riders a real bus.
- **Models and scoring**: Passio's times in these episodes were not on the screen (except `not_operating` in the
  shipped code). Score "what riders saw" without them, and score Passio's raw feed with them.
- **Refresh**: in the data repo's weekly `findings.yml`, its replay step writes `findings/hidden_buses/hidden_buses.csv`.
  To adopt that file here, copy it in, check the TOTALS line and commit. By hand, run the commands in the file's
  REFRESH lines.

## Caveats

- The days before Nov 6 are what the rules WOULD have hidden: the rules shipped on Nov 6, and the replay applies them to
  every day.
- Minutes, not seconds: an episode is read at each whole minute, and minutes no more than 2 min apart join.
- `sparse_reporter = y` (bus 12647 on some days) cannot be judged: such a bus may serve unseen.
- `came_to_serve_15` comes from the collector's arrivals, which can miss a stop (DC-023). A `n` is "no logged
  arrival", not proof.

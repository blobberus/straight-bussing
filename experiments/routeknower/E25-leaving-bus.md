# E25: can the app say which bus is about to leave service? (2026-10-30)

Owner: "If you know which specific bus is going to leave its shift soon, specify it on the bus and on the map and on
the route if the user is viewing the route." Rule for shipping (set with the request): a signal must be right at least
90% of the time 15 minutes before, overall and on every route where it would be shown. **Result: no signal comes
close, so nothing was added to the app.**

## Data and method
- Truth: DC-020's **lasting drops** (`tools/bus_changes.py`: a bus silent on its route for 10 min while another bus of
  the route still reports, and no arrival on that route for 30 min after), replayed from the raw polls of 7 weekdays
  (Oct 20 to 23, 26 to 28): **267 lasting drops**, 46,858 bus-minutes on routes running 2 or more buses.
- Each minute, for each bus on such a route, signals known at that moment (archived prediction updates, raw polls,
  the day's GTFS):
  - **a**: Passio's live trip updates for the bus list only its current trip (no next-trip times) while another bus
    of the route has next-trip times.
  - **b**: the timetable says the bus's current trip is the last of its shift while the route keeps running. The GTFS
    has no `block_id`, so shifts were rebuilt by chaining trips (a trip continues the shift of a trip that ended at its
    first stop 0 to 25 min before). **b near**: the same, and that last trip ends within 45 min.
  - **c**: the current trip ends at a garage / lot stop.
- Precision = flagged bus-minutes where the bus really left within H minutes. Recall = lasting drops where the signal
  was on for that bus 30 / 15 / 5 min before (only drops whose bus was on the map then: 180 / 193 / 211 of 267).
- Script: `experiments/routeknower/E25-scripts/leaving_research.py` (read-only, release assets of the data archive).

## Results (7 weekdays)

| Signal | Flagged bus-min | Precision, leaves within 30 / 45 / 60 min | Recall 30 / 15 / 5 min before | Bus-days with a false alarm |
|---|---:|---|---|---:|
| a (no next-trip times) | 2,704 | 18% / 25% / 31% | 20/180, 20/193, 22/211 | 106 |
| b (last trip of a rebuilt shift) | 640 | 25% / 37% / 45% | 6/180, 6/193, 8/211 | 12 |
| **b near** (and it ends within 45 min) | 386 | 33% / **46%** / 53% | 4/180, **4/193**, 6/211 | 7 |
| c (ends at a garage / lot) | 2,676 | 7% / 11% / 14% | 9/180, 8/193, 7/211 | 17 |
| a and b | 300 | 28% / 40% / 49% | 3/180, 2/193, 4/211 | 5 |
| a or b near | 2,790 | 19% / 27% / 32% | 21/180, 22/193, 24/211 | 106 |
| a and c | 134 | 21% / 22% / 25% | 0/180, 1/193, 2/211 | 8 |

Per route, b near (the best): 53rd Street Express 41% (340 flagged min, 3 of 10 drops), Red Line/Arts Block 93% but on
42 flagged minutes and 1 of 26 drops (too few to trust), Midway Metra 0% (4 min); no flags at all on the others.

## Why it fails
- **Most leaving buses are not in the timetable.** Of the 267 lasting drops, 136 are Downtown Campus Connector buses
  (a headway trip: no timed trips, no shifts, Passio predicts every bus under the same frequency trip id), and only 24
  coincide with a bus count drop in the timetable (DC-020). The rest are breaks, buses moved to another route (49 of the
  week's lasting drops moved, e.g. a Midway Metra bus to the Red Line at 9:51), or the end of a peak run.
- **Passio's next-trip times are not a shift marker.** A bus without next-trip times usually just has not reached the
  end of its loop yet (25% precision).
- **Timing recurs, the bus does not.** 117 of 267 lasting drops happen within 15 min of a drop on the same route on 4+
  of the other 6 weekdays (79 of them on the Downtown Campus Connector, where drops are frequent enough to recur by
  chance), so "a bus usually leaves around 11 AM" is learnable, but not which of the running buses it will be.

## What would make it possible
A learned model on more weeks (route, time of day, the bus's position in its loop, how long it has been running, the
interlining pattern of the next route), scored with this script and the same 90% rule; or the operator's run / block
assignments, if Passio or UChicago Transportation can share them. Nothing to port to the iPhone app.

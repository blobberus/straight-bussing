# Issues seen in the public UChicago shuttle feed (for UChicago Transportation and Passio)

Prepared 2026-11-17 from Straight Bussing's ground-truth collection (docs/DATA-COLLECTION-LOG.md, entries DC-024 to
DC-029). Straight Bussing is an unofficial tracker, used with UChicago Transportation's permission. It reads Passio's
public GTFS-realtime feed (`passio3.com/chicago/passioTransit/gtfs/realtime/`) and has logged every bus arrival since
October 2026. The arrival times come from the buses' own GPS. The data is public at
https://github.com/blobberus/straight-bussing-data and the exact rows behind every number below can be shared.
Times are Chicago time.

## Cover note (for the owner to send)

> Hello, I run Straight Bussing, the unofficial UChicago shuttle tracker you gave permission for in October. While
> logging the public feed, we noticed four problems that riders feel, all starting on the evening of Tuesday, October 27.
> The details and numbers are below. The data is public and I can send the rows for any of them. Thank you for running
> the feed.

## 1. Four Downtown Campus Connector stops have had no live times since Oct 27, about 6:30 PM

- **Stops:**
  - Gleacher Center (stop 132963)
  - UCHICAGO Medicine - River East (132964)
  - E Randolph St & S Michigan Ave (155006)
  - S Michigan Ave/Roosevelt Rd (132965)
- **Before:** Oct 20 to 26, 97 to 99% of bus arrivals at these stops had a predicted time in the trip updates (Oct 26:
  155 of 156).
- **Since:** Oct 28, 0 to 10 arrivals a day of 101 to 166 have one. From Mon Nov 9 to Fri Nov 13 it was 1, 10, 1, 0
  and 2 of 141 to 166.
- **The buses still serve these stops:** the vehicle feed names each of them as the bus's next stop. The line's other
  10 stops still get their times.
- **Riders:** any app that reads the feed shows no live time at these four stops.

## 2. Predicted times run later than the bus on four lines since Oct 27, about 6 PM

- **The share of late predictions** went up the same evening on four lines. A prediction counts as late when, 5 minutes
  ahead, the bus came more than 2 minutes earlier than the time shown:

  | Line | Late before Oct 27 | Late since |
  |---|---|---|
  | Central | 6% | 60% |
  | 53rd Street Express | 1% | 53% |
  | East | 5% | 48% |
  | Downtown Campus Connector | 3% | 36% |
  | All lines | 4.8% | about 20% (Nov 9 to 13: 18.4 to 20.6% a day) |

- **At 1 minute ahead,** the median error on 53rd Street Express, Central and East went from about 0.6 min early to
  3.4 to 5.1 min late.
- **Fewer arrivals have a time at all:** a time 5 minutes ahead for 66% of arrivals, down from 79%. For 55th &
  University and both Lake Park stops it is 1 to 12%.
- **It is not our logging:**
  - Arrivals timed purely by the buses' GPS show the same.
  - No collector code changed between Oct 27 and Oct 29.
  - A late log would make the predictions look early, not late.
- **Riders:** these lines show the bus later than it comes, so riders can miss it.

## 3. The first stops after a terminal get their time under the next trip's id

- **Stops:**
  - North's first three stops (Regenstein Library, Max Palevsky, Ellis Garage)
  - East's first stop (Regenstein Library)
  - 53rd Street Express's first two stops (53rd St & Kenwood, Kimbark Plaza)
- **What happens:** the trip update for these stops carries a different trip id than the vehicle report, which keeps
  the trip just finished. An app that matches times to the bus by trip id finds no time, or the time of the next or
  previous timetable trip.
- **Size:**
  - Share with a time: before Oct 27, 83 to 100% at these stops; since Oct 28, 0 to 62%.
  - Nov 9: of 600 arrivals without a time under their own trip id, 233 had one under another trip id.
  - Of the 240 arrivals shown 5 min ahead that day, 166 came more than 3 min earlier than shown.

## 4. Buses shown under one line while they drive another

- **What:** some buses report one route id for 30 minutes or more while driving another line's loop. For example:
  - Fri Nov 13, 3:10 to 8:50 PM: bus 4328, labeled Red Line/Arts Block, drove Friend Center/Metra's loop.
  - The same evening, South's loop was driven under the Downtown Campus Connector's label until 10:15 PM.
- **Size:** 0.5 to 7.3 bus-hours a weekday (Oct 23 to Nov 12), about 1.6% of all bus time. Every episode is listed
  in `findings/collection/wrong_label_episodes.csv` in the data repository.
- **Riders:** the bus appears on the wrong line, so riders waiting for the line actually driven do not see it coming.

## 5. Smaller points

- **Two stops listed in South's timetable that its buses do not drive past:**
  - Stony Island Parking Lot (8624)
  - 59th St & Metra (8658)

  South's buses stay 198 to 275 m from both. Rows exist only for Oct 9 and Oct 30.
- **Two stop points are off the path one line drives:**
  - Regents Park Apartments (8578): Regents Express buses pass it 74 to 90 m away. East passes within 4 m.
  - Logan Center (8589): South's buses pass it 55 to 81 m away. 53rd Street Express and Midway Metra pass close.

  Apps that measure distance to the stop point may never see those buses arrive.

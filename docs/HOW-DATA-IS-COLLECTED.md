# How the data is collected (plain English, 2026-10-17)

Riders' phones are not involved: the app collects nothing from the people who use it. Everything comes from the
shuttle system's public feeds. For every file and column, see `docs/DATA-GUIDE.md`; for the technical details,
`docs/DATA.md` and `monitoring.md`.

## 1. Where the information comes from
Passio, the company behind the shuttle tracking, publishes three public feeds that anyone can read:
- **where every bus is right now** (the bus's GPS),
- **the arrival times it is predicting** for each stop,
- **service alerts** (detours, "buses every 30 minutes tonight", and so on).

## 2. Who reads them
A small program runs on GitHub's computers (not on a phone and not on a home PC) and costs nothing. Every
**10 seconds** it asks Passio "where are the buses and what are you predicting?", and every 5 minutes it checks the
alerts. Each session runs 70 minutes, and before it ends it starts the next one, so they overlap and nothing is
missed. A backup alarm restarts the chain if it ever breaks.

## 3. What it writes down
It watches each bus and notices when it reaches a stop, in one of four ways: Passio's "next stop" changes, the
bus's GPS comes close enough to the stop, the GPS track shows it drove past a stop Passio never mentioned, or (since
October 17) the GPS track alone shows it reached a stop while Passio's information about that bus was "frozen". For
each arrival it notes the bus, the route, the stop, the time and how long the bus waited. It also notes **what
Passio was predicting 1, 2, 3, 5, 10, 15, 20 and 30 minutes before** that arrival. Comparing the two is how the
accuracy goal is measured (the "10 minute shrink": within 3 minutes at 30 or more minutes ahead, 2 at 20 or more,
1 below; see `docs/ACCURACY-GOAL-PLAIN.md`).

## 4. Where it is saved
When a session ends, it adds what it saw to a few shared spreadsheet files on the project's separate "data" branch
on GitHub (`arrivals.csv`, `predictions.csv`, `alerts.csv`). Because sessions overlap, the same arrival can be
seen twice; the duplicates are removed automatically. That is about **3,500 arrivals and about 20,000 predictions a
day**.

## 5. Once a day
- The raw feed snapshots and every prediction Passio showed that day are **archived permanently**.
- A **minute-by-minute table** of what was predicted against what really happened is built. This is what the Colab
  notebook (`experiments/routeknower/colab/`) learns from.
- Passio is **scored against the accuracy goal** for that day.
- A separate job saves the day's **weather**.

## 6. The public copy
A second project, `straight-bussing-data`, copies the data into easy-to-read files by day and by route, about
every 30 minutes.

## 7. Keeping it honest
- A **checkup tool** (`tools/monitor.py`) says whether everything is running.
- Every checkup and every problem found goes into **`docs/DATA-COLLECTION-LOG.md`**, numbered DC-001, DC-002, and
  so on, with what went wrong, what it affected and how it was fixed.
- Because the raw feeds are archived, a fix can be **replayed over past days**, so old data gets the same repair
  (done on 2026-10-16 for Oct 10 to 15).

## 8. The latest fix: buses Passio "freezes" (DC-003, October 17)
Sometimes Passio's information about a bus freezes: its "next stop" and trip stay the same for an hour while the bus
keeps driving. Before this fix those stops were simply missed (the Red Line only had about 60 to 75% of the stops it
drove past). Now the collector also follows each bus's GPS on its own: when the bus drives into a stop on its route
that nothing else recorded, it is written down as an arrival marked `gps`. These rows only ever add missed visits;
they never change anything else. The Red Line now has about 97% of its stops, and all lines together about 95%
(from 84 to 88%). A hand check of 196 of these new rows against the raw GPS found about 99% correct. The saved days
from October 10 on were filled in too (1,789 arrivals added).

Still open: a bus that Passio lists under the **wrong route** entirely. The detection exists, but it stays switched
off until a real case can be confirmed, so it never writes a wrong row.

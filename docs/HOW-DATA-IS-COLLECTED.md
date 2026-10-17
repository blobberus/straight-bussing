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
It watches each bus and notices when it reaches a stop, in one of three ways: Passio's "next stop" changes, the
bus's GPS comes close enough to the stop, or the GPS track shows it drove past a stop Passio never mentioned. For
each arrival it notes the bus, the route, the stop, the time and how long the bus waited. It also notes **what
Passio was predicting 1, 2, 3, 5, 10, 15, 20 and 30 minutes before** that arrival. Comparing the two is how the
accuracy goal is measured (the "10 minute shrink": within 3 minutes at 30 or more
minutes ahead, 2 at 20 or more, 1 below).

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

## 8. Being fixed now
**DC-003**: sometimes Passio "freezes" a bus (its next stop and trip stop changing while the bus drives) or files it
under the wrong route, so some of that bus's stops are missed. The fix works out the real route from the GPS alone,
then fills in the missed stops on past days too.

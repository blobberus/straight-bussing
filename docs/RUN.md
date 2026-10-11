# How to operate Straight Bussing

## Run in a browser (local)
```
cd web
python -m http.server 8000
```
Open http://localhost:8000. The live feed and map load directly from the internet; no server of ours is involved.

## Hosted link
Pushing to `main` deploys `web/` to GitHub Pages via `.github/workflows/pages.yml` (also re-runs daily to refresh schedule data).
One-time setup: repo **Settings -> Pages -> Source: GitHub Actions**.
Link: https://blobberus.github.io/straight-bussing/

## Demo mode (simulated buses, e.g. at night)
Add `?demo=1` to the address: https://blobberus.github.io/straight-bussing/?demo=1 (locally http://localhost:8000/?demo=1).
Only that exact parameter turns it on; nothing else does and nothing is stored, so the normal link is always live.
- Buses are simulated from the published schedule (`web/js/data/demo.js`): the routes scheduled right now, each with its
  scheduled peak (1 to 3 buses) moving along the road shapes on the scheduled segment times; when no route is scheduled
  (early morning) every route runs so the screen is never empty. The real Passio feed is never fetched in a demo session.
- The status pill reads **Simulated buses** on every screen (no banner, no demo service alert, owner decision 2026-10-11).
  Tap it for what this means and **Show live buses** (same page without the parameter).
- Settings changes made in the demo (hidden routes, theme, custom routes) last only until the page is closed; the saved
  settings stay as they were. Bus alerts, the service worker and offline caching are off in demo mode.
- Use it for screenshots, reviews and testing the UI when no shuttle runs. Never for riding.

## Put it on an iPhone (no App Store needed)
Open the link in **Safari** -> Share -> **Add to Home Screen**. It opens full-screen like an app.
The native iPhone app (SwiftUI) lives in `ios/`: build, CI (`ios.yml`) and the App Store checklist are in `ios/README.md`,
submission steps in `docs/APPSTORE-SUBMIT.md`.

## Tests (no Node)
- Browser tests: `python tools/run_browser_tests.py` (serves `web/`, runs every `web/tests/*.test.html` in headless Edge;
  `-v` lists each test, page names select a subset).
- Offline shell: `python tools/test_precache.py` (every file the app loads is in the `web/sw.js` PRECACHE list; also run by
  `pages.yml` before each deploy).
- Data and collector: `python tools/test_truth.py`, `test_merge.py`, `test_models.py`, `test_monitor.py`, `test_chain.py`,
  `test_context.py` (each prints `ok N tests` or a failure).

## Refresh schedule data by hand
`python tools/build_gtfs.py` (rewrites `web/data/`). Icons: `python tools/make_icons.py`.

## Using the app
Map shows shuttle positions (updated every 10 s) and route lines. Tap a stop for predicted arrivals. The search bar on top
plans a trip (walk + shuttle). Bottom bar: **Current trip** (next buses near you, or the trip you started), **Routes**
(show / hide routes, map order, Routes to station) and **My Routes** (custom route sets, favorite stations, About). Service
alerts open from the banner on Current trip; the gear opens Settings (theme, bus alerts). A status pill under the search
bar appears when data is stale, the feed fails or no shuttles report (each state with its own icon and words); do not
rely on the app then. When no bus reports, the screens show the shuttle operator's alert (if the feed has one) and
773.702.8181.

## Arrival data collection
GitHub Actions `collect.yml` logs observed arrivals around the clock: each 70-minute run starts its own successor
(`tools/collect_chain.py`), the :07 / :37 cron only restarts the chain. Health checks and fixes: `monitoring.md`
(`python tools/monitor.py status`); the data: `docs/DATA.md`.

## Before any public launch
Get written permission from UChicago Transportation & Parking (773.702.8181). See `UChicago Bus Tracker Project.md`.

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
- An amber "Demo mode: simulated buses" banner sits on top of every screen with **Exit demo** (same page without the
  parameter); a matching service alert says the buses are not live data.
- Settings changes made in the demo (hidden routes, theme, custom routes) last only until the page is closed; the saved
  settings stay as they were. Bus alerts, the service worker and offline caching are off in demo mode.
- Use it for screenshots, reviews and testing the UI when no shuttle runs. Never for riding.

## Put it on an iPhone (no App Store needed)
Open the link in **Safari** -> Share -> **Add to Home Screen**. It opens full-screen like an app.

## Refresh schedule data by hand
`python tools/build_gtfs.py` (rewrites `web/data/`). Icons: `python tools/make_icons.py`.

## Using the app
Map shows shuttle positions (updated every 10 s) and route lines. Tap a stop for predicted arrivals. Routes tab hides/shows routes. Alerts tab shows service alerts. A status pill under the search bar appears when data is stale, the feed fails or no shuttles report (each state with its own icon and words); do not rely on the app then.

## Before any public launch
Get written permission from UChicago Transportation & Parking (773.702.8181). See `UChicago Bus Tracker Project.md`.

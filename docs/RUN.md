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

## Put it on an iPhone (no App Store needed)
Open the link in **Safari** -> Share -> **Add to Home Screen**. It opens full-screen like an app.

## Refresh schedule data by hand
`python tools/build_gtfs.py` (rewrites `web/data/`). Icons: `python tools/make_icons.py`.

## Using the app
Map shows shuttle positions (updated every 10 s) and route lines. Tap a stop for predicted arrivals. Routes tab hides/shows routes. Alerts tab shows service alerts. A yellow banner appears when data is stale or no shuttles report; do not rely on the app then.

## Before any public launch
Get written permission from UChicago Transportation & Parking (773.702.8181). See `UChicago Bus Tracker Project.md`.

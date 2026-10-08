# CLAUDE.md — project memory (read this first, keep it short)

Project: **Straight Bussing**, a free unofficial live UChicago shuttle tracker. Full brief: `UChicago Bus Tracker Project.md` (read only when needed).
Owner: Nathan. Repo: github.com/blobberus/straight-bussing (main). Work on Windows, Python 3.11 available, **no Node/npm**.

## Key facts (don't re-research)
- Live feeds (no key, CORS `*`): `https://passio3.com/chicago/passioTransit/gtfs/realtime/{vehiclePositions,tripUpdates,serviceAlerts}.json`
- Static GTFS zip `.../gtfs/google_transit.zip` has **NO CORS** -> browser can't fetch it. `tools/build_gtfs.py` converts it to `web/data/*.json`; a GitHub Action refreshes it daily.
- Live `route_id` joins to `routes.txt` route_id (never mix with passiogo.com ids).
- Permission from UChicago Transportation is UNRESOLVED. App must say "unofficial", avoid UChicago names/logos/"UGo", warn when data is stale, link to official app/phone (773.702.8181).

## Architecture
Static site, no build step: `web/` (index.html, app.js, style.css, sw.js, manifest.webmanifest, data/). Leaflet via CDN. Hosted on GitHub Pages. PWA -> installable on iPhone ("Add to Home Screen"). Later: Capacitor wrap (needs a Mac + Xcode), see `docs/IOS.md`.

## Directory map
- `web/` app (deployed as-is)  · `tools/` data scripts  · `.github/workflows/` Pages deploy + daily GTFS refresh  · `docs/` APPSTORE.md (cost/feasibility), IOS.md, RUN.md (how to operate)

## Status (update every session)
- [x] Brief read, CORS checked
- [x] tools/build_gtfs.py + data
- [x] web app (map, buses, arrivals, alerts, stale warning)
- [x] PWA (manifest, service worker, icons)
- [x] GitHub Actions + Pages link
- [x] docs: APPSTORE.md, IOS.md, RUN.md

## Next deliverable
Verify in a real browser, enable Pages (Settings -> Pages -> GitHub Actions), then add: native-feature plan for App Store (location/widget), optional caching proxy, UChicago permission email draft.

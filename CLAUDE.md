# CLAUDE.md — project memory (read this first, keep it short)

Project: **Straight Bussing**, a free unofficial live UChicago shuttle tracker.
**FINAL GOAL:** a polished website (feels like Apple Maps / Citymapper, not Passio GO!) that the owner can later prompt me to turn into an App Store-level app. Plan for that: `conversion to appstore.md`. UI rules: `docs/DESIGN.md` + `.claude/skills/taste-skill/` (third-party, MIT, reference only). Full brief: `UChicago Bus Tracker Project.md` (read only when needed).
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

- [x] UI redesign per docs/DESIGN.md (sheet w/ 3 detents, ETA rows, route/stop detail, OpenFreeMap vector tiles via maplibre-gl-leaflet; CARTO raster tiles now need an API key, don't use)
- [x] Pages live: https://blobberus.github.io/straight-bussing/
- [ ] QA pass on a real iPhone (sheet drag, safe areas, basemap render; headless Edge could not confirm basemap)

## Next deliverable
QA on iPhone Safari; polish from findings. Then wait for owner's App Store conversion prompt (see `conversion to appstore.md`). Local test: `cd web; python -m http.server 8000`; headless shot: msedge --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --timeout=20000 --screenshot=...

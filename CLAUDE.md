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
Static site, no build step: `web/` v2 ES modules (index.html, js/{core,data,map,ui}, css/, sw.js, data/; contract + file ownership in `docs/ARCHITECTURE.md`). v2 is merged to `main` and live on Pages since 2026-10-08 (v1 = tag `v1-final`); `v2-rewrite` is kept level with `main`. Collector: see `monitoring.md`. Learning/prediction experiments: see `RouteKnower.md` (plan, test protocol, data tiers, experiment log). Leaflet via CDN. Hosted on GitHub Pages. PWA -> installable on iPhone ("Add to Home Screen"). Later: Capacitor wrap (needs a Mac + Xcode), see `docs/IOS.md`.

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

## Ship checklist (priorities and deliverables)
Weigh EVERY change against these, in order. A lower item never justifies breaking a higher one. Tick them before shipping.
1. [ ] **Rider safety / stale-data honesty**: stale or failed feeds are always flagged; estimates are labeled as estimates; never imply official status; keep the 773.702.8181 / official-app link.
2. [ ] **Correctness of times**: ETAs come from live tripUpdates; any derived number (ride, wait, total) is marked "est." and states its source (live / schedule / learned). No invented precision.
3. [ ] **Speed to "where is my bus"**: Nearby shows the next bus in one glance, no taps; first paint < 2 s on mobile; never block on optional data (geocoder, learned data).
4. [ ] **Intuitive UI** (Apple Maps / Citymapper): one primary action per screen, sheet detents work, back always works, no dead ends. See `docs/DESIGN.md`.
5. [ ] **Accessibility**: 44px targets, labels on every control, contrast in light and dark, reduced motion, state not by color alone.
6. [ ] **Privacy**: no account, no tracking; location stays on device; only typed destination text goes to photon.komoot.io, and About says so; localStorage wrapped in try/catch.
7. [ ] **App Store portability**: plain static JS, no build step, no browser-only hacks that block a Capacitor wrap (see `conversion to appstore.md`).
Also every ship: bump the cache name in `web/sw.js` when shell files change; escape dynamic text with `esc()`; verify in headless Edge (light + dark).

| Deliverable | Status | Notes |
|---|---|---|
| Live map, buses, arrivals, alerts, stale warning | done | |
| PWA + GitHub Pages + daily GTFS refresh | done | |
| Sheet UI redesign (3 detents), vector basemap | done | `docs/DESIGN.md` |
| Routes to station (picker, filter chip) | done | `web/app.js`; location or search first, nothing highlighted until chosen |
| Hide/show single routes (persisted) | done | map, arrivals, Nearby honor it |
| Directions (walk + shuttle, 1 transfer) | done | `web/planner.js`; Photon geocoding; bus legs drawn as straight stop-to-stop lines |
| Constant ground-truth collection | done | `collect.yml` on main (schedules only run from main): overlapping 70-min runs at :07/:37, `tools/merge_arrivals.py` dedupes into `data` branch `data/ground_truth/arrivals.csv`; `docs/DATA.md` |
| Ride-time learning (`Predict`) | in progress | `RouteKnower.md` is the plan + experiment log (E00, E04, E15 done 2026-10-08; reviewed §13); ship target Fri Nov 20 (Thanksgiving Break is Nov 23-27); live site does NOT deploy `learned.json` yet (§9); ship gate §6.6 |
| Weather / traffic / calendar context | done | `tools/context_fetch.py` + daily `context.yml` -> `data/context/` on the data branch; `tools/context_join.py`; `data/calendar.json`; sources vetted in RouteKnower §3.4 (never scrape Google Maps: terms forbid it) |
| Theme + basemap styling | in progress | `web/theme.js`, `web/mapstyle.js` |
| Directions: trace route shapes, walking path on streets | next | needs shape clipping / routing |
| Learned wait/headway (not just ride time) | next | extend data-learning roadmap |
| v2.1: My Routes tab (custom named route sets, favorite stations), "Make this a custom route", map draw order, direction chevrons + bus rail on route detail, route hours/modified schedules/buses by hour, "only show relevant routes" journeys, alerts moved to Nearby banner | done, live 2026-10-08 | contract: `docs/ARCHITECTURE.md` "v2.1 features"; `core/visibility.js` is the one visibility rule |
| Routes list: Show all / Hide all, drag-to-reorder map order, official contact at list bottom | done 2026-10-08 | `ui/views/routes.js`, `routes-drag.js`, `core/custom.js` (`showAll`/`hideAll`/`moveToIndex`) |
| Monitoring runbook | done | `monitoring.md` + `tools/monitor.py` ("run monitoring.md"); first scheduled collector run had not fired yet on 2026-10-08 |
| Settings (top-right gear): theme, alerts, bus-near alerts (2 / 1 stops, N min; web = only while open) | done | `ui/views/settings.js`, `core/notify.js`, `ui/notifier.js`; Live Activity / lock screen = iPhone app only, see `conversion to appstore.md` |
| iPhone-sized frame on desktop browsers (393x852) | done | `ui/frame.js`, `css/base.css` |
| QA on a real iPhone (sheet drag, safe areas, keyboard) | next | headless Edge can't confirm |
| App Store conversion (Capacitor) | next | wait for owner's prompt |
| v2.2 (2026-10-08): Nearby tab renamed **Plan Trip** (ids stay `nearby`) with "Where to?" + "Routes to station…"; Edit map order first on Routes; favorite stars on the map; Settings = overlay below the tab bar with Done; place search Illinois-only, UChicago-first; planner counts every walk (1600 m end walks when nothing within 800 m) | done | `docs/ARCHITECTURE.md` (updated contracts); sw cache `sb-v2-6` |
| v2.3 (2026-10-08): trip options ranked least walking > earliest arrival > shortest wait > criteria met (`core/rank.js`), small "what it minimizes" line per card, up to 4 options; Settings overlay covers the whole sheet with a scrim; slim 32px context bar (clears the full-detent grab handle) | done | sw cache `sb-v2-7` |

**Data-learning roadmap:** (1) log observed stop-to-stop times from vehiclePositions + tripUpdates (GitHub Action, no server); (2) aggregate to `web/data/segments.json` by route, segment, hour; (3) `Predict.rideMinutes` prefers learned medians when enough samples, else schedule; (4) later: learned headways and delay by time of day.

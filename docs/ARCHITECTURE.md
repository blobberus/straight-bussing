# Straight Bussing v2: architecture contract

Rewrite on branch `v2-rewrite` (v1 is tag `v1-final`). Goal: same product, rebuilt as small ES modules with clear seams, tested, and portable to a Capacitor/SwiftUI app later (`conversion to appstore.md`). **Every agent codes against this file. If you must change a signature, change it here in the same edit and say so in your report.**

## Hard constraints
- Static site, **no build step, no Node**. Native ES modules (`<script type="module">`), relative imports with `.js` extension. Leaflet 1.9.4 (`L`) and maplibre-gl 4.7.1 + `@maplibre/maplibre-gl-leaflet` 0.1.4 are CDN **globals** loaded by classic `<script>` tags before `js/main.js`.
- Plain modern JS (ES2022), no TypeScript, no frameworks. Each file < 400 lines. JSDoc on every export. No `eval`, no inline event handlers, no `innerHTML` with unescaped dynamic text (use `esc()`).
- All times are **unix seconds (number)** unless the name ends `Ms`. Minutes are floats until display. Coordinates `{lat, lon}`; polylines `[[lat, lon], ...]`.
- Privacy: no accounts/tracking. Location stays on device. Only (a) typed place text -> photon.komoot.io, (b) walking-leg endpoints rounded to 4 dp -> routing.openstreetmap.de (fallback valhalla1.openstreetmap.de) leave the device. `About` must say so.
- Safety: stale/failed data always visible; every derived time labeled estimate + source; app never claims to be official; show official phone 773.702.8181 and https://safety-security.uchicago.edu/Transportation in About and in the empty/error states. Avoid UChicago names/logos/"UGo" in branding.
- localStorage always in try/catch via `core/storage.js`.
- Accessibility: 44 px targets, labels, focus-visible, reduced motion, light/dark, high-contrast, state never by color alone.
- Design: follow `docs/DESIGN.md` (Apple Maps / Citymapper feel). `.claude/skills/taste-skill/SKILL.md` is third-party reference only.

## Directory layout and OWNERSHIP (never edit files you do not own; ask via your final report)
```
web/index.html            [D1]
web/sw.js manifest.webmanifest icons/    [B]
web/css/tokens.css base.css sheet.css components.css map.css   [D1]
web/css/views.css         [D2]
web/js/main.js            [D1]  wiring + boot
web/js/state.js           [B]   the app store (shape below)
web/js/core/*.js          [A]   pure logic, no DOM: geo.js time.js esc.js storage.js events.js store.js arrivals.js planner.js walk.js predict.js
web/js/data/static.js live.js geocode.js   [B]
web/js/map/map.js style.js layers.js geometry.js   [C]
web/js/ui/sheet.js router.js actions.js components.js theme.js   [D1]
web/js/ui/views/nearby.js stop.js routes.js route.js alerts.js about.js pick.js directions.js   [D2]
web/tests/*.html + tests/lib.js   [A: core/data tests] [C: map tests] [D1/D2: ui tests]  (each owns own file names)
tools/run_browser_tests.py   [A]
tools/* (python), data/, .github/workflows/collect.yml, docs/DATA.md   [E1]
tools/model_*.py backtest.py estimate_speed.py refresh_model.py docs/ALGORITHMS.md docs/BACKTEST.md   [E2]
docs/ARCHITECTURE.md      [lead only]
```
Existing v1 files (`web/app.js style.css planner.js predict.js walk.js theme.js mapstyle.js`) are **reference code to port from**. They are deleted by the lead after integration; read them for proven logic (alongShape road-following, pick flow, planner, walk router, mapstyle patching, stale pill logic, sheet drag).

## Shared primitives (A owns, everyone imports)
```js
// core/esc.js
export function esc(s): string                 // HTML-escape any value
export function safeColor(c): '#RRGGBB'        // validates, default '#555555'
export function textOn(hex): '#111114'|'#ffffff'   // by luminance
export function lum(hex): number
// core/time.js
export const nowS = () => Date.now()/1000
export function clock(unixS): string           // '4:12 PM' locale
export function minsUntil(unixS, from=nowS()): number   // floor, can be <=0
export function ago(unixS): string             // '8s ago'
// core/geo.js
export function hav(a,b): meters               // {lat,lon} each
export function walkMin(meters): number        // meters/80
export function nearestStops(stops, point, {max, maxM, routeStops?}): [{id,name,lat,lon,d}]
export function bearing(a,b): degrees
// core/storage.js
export function load(key, fallback), save(key, value)   // JSON, try/catch, prefix 'sb:'
// core/events.js
export const bus = { on(name, fn)->off, emit(name, payload) }   // events: 'sheet:inset' {px}, 'toast' {text}
// core/store.js
export function createStore(initial): { get(), set(patch), subscribe(fn)->off }   // shallow merge; subscribers called once per microtask with (state, changedKeys:Set)
```

## App state (state.js, B owns; `export const store`)
```js
{
  // static (data/static.js fills once)
  routes: {rid:{short,long,color,text_color}}, stops:{id:{name,lat,lon}}, shapes:{rid:[polyline,...]},
  routeStops:{rid:[stopId,...]}  /* first==last means loop */, stopRoutes:{stopId:[rid]}, addresses:{stopId:{address}},
  staticLoaded:false,
  // live (data/live.js fills every 10 s)
  buses:[{vehicle:{id,label}, position:{latitude,longitude,bearing,speed}, trip:{trip_id,route_id}, timestamp, stop_id, current_stop_sequence}],
  trips:[{trip:{trip_id,route_id}, vehicle:{id,label}, stop_time_update:[{stop_id, arrival:{time}, departure:{time}}]}],
  alerts:[{header_text, description_text, active_period, informed_entity}],
  feedTs:0, lastOk:0, failed:false, liveLoaded:false,
  // user/prefs (persisted via storage.js where noted)
  user:null /* {lat,lon} */, locState:'unknown' /* unknown|asking|granted|denied */,
  hiddenRoutes:[] /* persisted */, theme:'auto' /* persisted: auto|light|dark */,
  // nav (ui/router.js writes)
  view:'nearby', prevView:null, stopId:null, routeId:null,
  routeFilter:null /* {ids:[rid], label:'Station name'} | null */,
}
```
View-local state (picker query, directions fields) lives in that view module, not the store.

## Data layer (B)
```js
// data/static.js
export async function loadStatic(store): Promise<void>   // fetch data/routes.json stops.json shapes.json route_stops.json (+ stop_addresses.json optional); derive stopRoutes; set staticLoaded
// data/live.js
export function startLive(store, {intervalMs=10000}): {stop(), pollNow()}   // polls the 3 Passio JSON feeds (BASE https://passio3.com/chicago/passioTransit/gtfs/realtime/<name>.json?_=ts, cache:'no-store'), sets live fields; failure keeps last data and sets failed:true; pause when document.hidden, poll on visible
// data/geocode.js
export function searchPlaces(q, {signal}): Promise<{items:[{label, sub, lat, lon}], error?:string}>   // never throws (error: 'aborted'|'timeout'|'network'|'http <status>'|'bad response'); Photon, limit 5, biased lat 41.79 lon -87.60, min 3 chars enforced by caller (<3 -> {items:[]}); 400 ms debounce helper debounce(fn, ms) exported too (.cancel(), .flush())
```
`sw.js`: network-first for same-origin GET with `cache:'no-cache'`, cache only `r.ok && r.status===200`, never cache cross-origin; precache index.html + css + js/main.js + manifest + icons; cache name constant `sb-v2-<n>`; serve offline fallback. Also keep the daily GTFS refresh workflow `pages.yml` working (it copies `web/`).

## Core logic (A)
```js
// core/arrivals.js  (pure, takes state slices)
export function arrivalsFor({trips}, stopId, {routeId, hidden=[], nowS}): [{rid, t, bus, tripId}]   // sorted, t > now-30
export function staleLevel({lastOk, failed, feedTs}, nowS): ''|'late'|'old'|'err'      // err: never ok / >60 s since lastOk / failed; old: feed>300 s; late: >120 s
export function runningCount({buses}, rid): number
export function activeAlerts({alerts}, nowS): alert[]
// core/predict.js
export const predict: { ready: Promise<void>, rideMinutes(rid, fromStopId, toStopId, whenTs?) -> {min:number|null, source:'schedule'|'learned', conf:0..1, p10?, p90?} }   // loads data/segments.json (+ data/learned.json if present, 404 ok); never throws
// core/walk.js
export async function walkRoute(from, to): Promise<{m, min, coords:[[lat,lon]], source:'router'|'estimate'}>   // FOSSGIS OSRM foot primary, Valhalla fallback, 3 s timeout each, straight*1.2 estimate fallback, cache by 4dp, <=6 concurrent
// core/planner.js
export function plan({from, to, now, data:{stops,routes,routeStops,trips,buses}, predict?}): {options:[Option], walkOnly:{m,min}}
export async function refineWalking(option, {walkRoute, now, data, from, to}): Promise<Option>   // replaces walk-leg coords/min with router results, recomputes totals/arrive; if the bus would be missed it re-plans or drops the option
// Option = {key, total:minFloat, totalMin:int, arrive:unixS, legs:[WalkLeg|BusLeg]}
// WalkLeg = {type:'walk', from:{lat,lon,name}, to:{lat,lon,name}, m, min, coords?:[[lat,lon]], source?:'router'|'estimate'}
// BusLeg  = {type:'bus', rid, board:{id,name,lat,lon}, alight:{id,name,lat,lon}, path:[{lat,lon}], stopsPassed, wait, waitLive, ride, source:'live'|'learned'|'schedule'|'estimate', conf, boardT, alightT}
```
Planner rules (port from v1, keep behaviors): walk 80 m/min x1.2 detour estimate, max walk 800 m each end, direct + one transfer (transfer walk <= 150 m), loop routes wrap, ride time prefers same-trip live prediction (tripUpdates at alight stop minus at board stop), then `predict.rideMinutes`, then distance/18 km/h; wait = live next arrival at board stop after you arrive, else headway estimate; discard options absurdly longer than walking; rank by total; max 3 options; every number is an estimate.

## Map layer (C)
```js
// map/map.js
export function createMap(elId): MapApi
// MapApi (all methods idempotent, cheap to call every poll):
setTheme(isDark)                 // swaps OpenFreeMap style via map/style.js (positron/dark patched for legible street names + house numbers; OSM raster fallback if maplibre missing)
setBottomInset(px)               // visible-map padding from the sheet; fits/flies respect it
drawNetwork({routes, shapes, routeStops, stopRoutes, stops, hidden:[], focus:[]|null, dark})  // casing+color route lines (dim non-focused to .25), stops at zoom>=14 with 44px tap halo
drawBuses(buses, {routes, hidden, focus, nowS})   // rounded-square badge in route color, heading triangle, pulse ring, stale (>60 s) dimmed; smooth glide; recreate marker only if route changes
setSelectedStop(stop|null)       // {id,lat,lon}
setUser(pos|null)                // blue dot
highlightStops(items|null, {onPick})   // items [{id,lat,lon}] ring highlights; null clears
drawPlan(option|null, {routes, shapes, routeStops})  // bus legs follow road shapes (geometry.alongShape); walk legs dashed along leg.coords else straight; start/end pins
fitTo(points|bounds, {maxZoom})  flyTo({lat,lon}, zoom)
onStopTap(fn) onBusTap(fn) onUserMove(fn)
// map/geometry.js (pure, unit-tested)
export function alongShape(shapeLines, routeStopsList, board, alight, fallbackLatLngs): latlngs
```
Layer groups must never be rebuilt when nothing changed (diff by a cheap signature) so polling doesn't flicker.

## UI shell (D1) and views (D2)
```js
// ui/router.js
export function registerView(id, def)   // def = { title(state)->string, parent?:viewId, detent?:'peek'|'half'|'full', tab?:'nearby'|'routes'|'alerts', render(state)->htmlString, mount?(rootEl, ctx), unmount?() }
export function navigate(view, params={})   // sets store.view/prevView/stopId/routeId, adjusts detent
export function back()
// ui/actions.js
export function registerAction(name, fn)    // fn(dataset, event, ctx); markup uses data-action="name" data-id="..." (event delegation on the sheet content)
// ctx passed to render/mount/actions: { store, map /*MapApi*/, navigate, back, setDetent(d), toast(text), now: nowS, locate(): Promise<boolean> /* asks geolocation, sets store.user/locState, never throws */ }
// Views import core/* and data/geocode.js directly (planner, walk, predict, arrivals, geocode). Each view file calls registerView(...) and registerAction(...) at import time; main.js imports every view file.
// ui/components.js (pure HTML-string builders, all escape inputs)
export const routeChip(rid, routes), etaBlock(unixS, {stale}), arrivalRow(a, state), stopRow(...), emptyState(title, body), skeleton(n), pill(kind, text), segmented(items), estTag(source)
// ui/sheet.js: createSheet({sheetEl, contentEl, headEl}) -> {setDetent(d), getDetent(), onChange(fn)}  3 detents peek/half/full, pointer-event drag with velocity snap + rubber band, keyboard (arrows/Esc), >=768 px = left panel; emits bus 'sheet:inset' {px} on every settle/drag end
// ui/theme.js: initTheme(store) -> applies data-theme, matchMedia, mount(el) segmented Auto/Light/Dark, onChange(fn(isDark))
```
Rendering loop (D1 `main.js`): on store change -> current view `render(state)` -> set `content.innerHTML` only if string differs from last (preserve scrollTop; never rebuild while a text input inside content has focus: views with inputs use `mount` and update lists in place).

Views (D2) and required behavior (all ported from v1, improved):
- **nearby**: next bus at the nearest stop in one glance; with location -> 3 nearest stops with up to 3 arrivals; without -> "Use my location" + "Arriving soon" list + search stations field + "Type an address or place"; never dead-ends; location denied is a first-class state.
- **stop**: arrivals list (route chip, route name, Live dot, ETA numeral, "Now"), route chips serving it, address line from `addresses`, "Updated Ns ago", Directions-from-here / to-here buttons.
- **routes**: top actions `Routes to station…` and `Directions`; Running / Not running / Hidden groups; per-route eye toggle (persisted `hiddenRoutes`) honored on map, arrivals, Nearby; filter chip "Routes to <station> x".
- **pick** (Routes to station…): dialog asks **Use current location / Select a station / Type an address or place**; NOTHING is highlighted until the user chooses; then nearest stops (<=1.5 km) are highlighted on the map and listed; tapping a station sets `routeFilter` and shows only routes that serve it on list+map; works with no location permission via the other two options.
- **route**: stop timeline with next ETA per stop, buses running, map focus on that route.
- **alerts**: active alerts, count badge on the tab; **about**: unofficial notice, official phone/link, privacy statements (Photon + walking router hosts), theme control, data credits/attribution, version.
- **directions**: Start/Destination fields (station autocomplete + Photon places, "My location" default if granted), swap, up to 3 option cards (total min, arrive clock, summary chips), tap card -> `map.drawPlan`, step list with `Bus arrives at <stop> <clock>`, wait, ride, source tags, walking legs on sidewalks (via `refineWalking`, async, shows "sidewalk route"/"estimate"), note "Bus times are estimates from schedules and live predictions. They will get more accurate as we collect more ride data.", walk-only fallback, no-service empty state.

## Tests
No Node: browser test pages run in headless Edge. `web/tests/lib.js` exports `test(name, fn)`, `eq`, `ok`, `near`, and writes a JSON summary to `<pre id="result">` and `document.title = "TESTS pass=N fail=M"`. `tools/run_browser_tests.py [page...]` serves `web/` on a free port, runs `msedge --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=30000 --dump-dom`, parses the title, exits non-zero on failure. Edge path: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. Screenshots: add `--hide-scrollbars --window-size=500,900 --blink-settings=preferredColorScheme=1|2 --timeout=20000 --screenshot=<abs path OUTSIDE repo>` (headless does not paint vector map tiles; UI and overlays do paint).

## Acceptance checklist (lead verifies at integration)
Boot with no console errors; nearby list populated from live data; stale pill logic; sheet drag/detents; theme Auto/Light/Dark switch updates map style + markers; Routes to station flow (all 3 modes, no location needed); route toggles; directions with sidewalk walking and road-following bus legs and clock times; offline shell; all unit tests green; Lighthouse-style a11y spot checks; no file > 400 lines; no leftover v1 globals.

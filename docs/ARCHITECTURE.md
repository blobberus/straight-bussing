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
web/css/tokens.css base.css sheet.css components.css   [D1]
web/css/map.css           [C]   map overlays only
web/css/views.css         [D2]
web/js/main.js            [D1]  wiring + boot
web/js/state.js           [B]   the app store (shape below)
web/js/core/*.js          [A]   pure logic, no DOM: geo.js time.js esc.js storage.js events.js store.js arrivals.js planner.js walk.js predict.js
web/js/data/static.js live.js geocode.js   [B]
web/js/map/map.js style.js layers.js geometry.js   [C]
web/js/ui/sheet.js router.js actions.js components.js theme.js   [D1]
web/js/ui/views/nearby.js stop.js routes.js route.js alerts.js about.js pick.js directions.js   [D2]
web/tests/*.html + tests/lib.js   [A: core/data tests] [C: map tests] [D1/D2: ui tests] [lead: e2e.*]  (each owns own file names)
tools/run_browser_tests.py   [A]
tools/* (python), data/, .github/workflows/collect.yml, docs/DATA.md   [E1]
tools/model_*.py backtest.py estimate_speed.py refresh_model.py docs/ALGORITHMS.md docs/BACKTEST.md   [E2]
docs/ARCHITECTURE.md      [lead only]
```
The v1 files (`web/app.js style.css planner.js predict.js walk.js theme.js mapstyle.js`) were deleted at integration; read them at tag `v1-final` if you need the original logic.

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
  buses:[{vehicle:{id,label}, position:{latitude,longitude,bearing,speed}, trip:{trip_id,route_id}, timestamp, stop_id, current_stop_sequence}],   // OPERATING vehicles only (core/operating.js, applied in data/live.js)
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
export async function loadStatic(store, {base?, fetch?}?): Promise<{failed:string[]}>   // never rejects   // fetch data/routes.json stops.json shapes.json route_stops.json (+ stop_addresses.json optional); derive stopRoutes; set staticLoaded
// data/live.js
export function startLive(store, {intervalMs=10000, ...}): {stop(), pollNow(), failures(), delay()}   // polls the 3 Passio JSON feeds (BASE https://passio3.com/chicago/passioTransit/gtfs/realtime/<name>.json?_=ts, cache:'no-store'), sets live fields; failure keeps last data and sets failed:true; pause when document.hidden, poll on visible
// data/geocode.js
export function searchPlaces(q, {signal}): Promise<{items:[{label, sub, lat, lon}], error?:string}>   // never throws (error: 'aborted'|'timeout'|'network'|'http <status>'|'bad response'); <3 chars -> {items:[]} with no request; in-memory cache; 400 ms debounce helper debounce(fn, ms) exported too (.cancel(), .flush())
// Photon gets only the typed text + fixed constants (never the user's location): bias lat 41.7886 lon -87.5987 (UChicago), zoom=10, location_bias_scale=0.2, Illinois bbox -91.52,36.97,-87.49,42.51, limit=15, lang=en.
// Client side: keep Illinois only (state Illinois/IL; no state -> point inside the bbox; non-US dropped), re-rank by distance tier from campus (<=3 km, <=20 km, <=80 km, rest of IL) blended with Photon rank, name match and place type; exact city/town name first; merge duplicates; max 5.
// sub = 'street, city, IL' (Chicago townships shown as Chicago). Also exported: inIllinois, rankPlaces, photonUrl, featureToPlace, HOME, IL_BBOX, PHOTON, clearPlaceCache.
// 2026-10-08: searchPlaces asks the LOCAL index first (data/places.js over web/data/places.json: named places within a 30-minute walk of the
// 82 campus stops, from OpenStreetMap via tools/build_places.py, ODbL): punctuation/space-insensitive ("chickfila"), prefixes, 1 typo,
// categories (coffee, grocery, apartments), whole-word name matches first, then nearest stop. Items carry {local:true, walk, stop, score}
// and sub "Kind · address · N min walk to <stop>". Photon is called only when the local index has < 5 matches; mergePlaces() puts local
// first and drops Photon duplicates (within 150 m, one name contains the other); Photon results > 3 km away end with "N km from campus".
// data/places.js: norm(s), scorePlace, searchLocal(q,{limit}), loadPlaces(fetch?) (never throws), setPlaces(data|null) for tests.
```
`sw.js`: network-first for same-origin GET with `cache:'no-cache'`, cache only `r.ok && r.status===200`, never cache cross-origin; precache index.html + css + js/main.js + manifest + icons; cache name constant `sb-v2-<n>`; serve offline fallback. Also keep the daily GTFS refresh workflow `pages.yml` working (it copies `web/`).

## Core logic (A)
```js
// core/operating.js (2026-10-08): owner rule "a bus that is not operating is not displayed" (map, route station list, counts, alerts, planner)
export const STALE_S = 300
export function isOperating(bus, {routes, service, trips, feedTs, nowS, staticLoaded}): boolean   // fresh (<= 5 min older than the FEED), known route, and route scheduled now OR trip has a live prediction >= now-60
export function operatingBuses(buses, ctx): bus[]   // data/live.js filters store.buses with it (opts.now injectable for tests)
```
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
export function plan({from, to, now, data:{stops,routes,routeStops,trips,buses}, predict?, walkMins?}): {options:[Option], walkOnly:{m,min}}   // pass predict explicitly (no implicit fallback)
export async function refineWalking(option, {walkRoute, now, data, from, to, predict?}): Promise<Option|null>   // replaces walk-leg coords/min with router results, recomputes totals/arrive/walkMin/walkM; a router walk is never shorter than the straight line; if the bus would be missed it re-plans (same route, replanned:true) or resolves null (drop it)
// Option = {key, total:minFloat, totalMin:int, arrive:unixS, t0:unixS, walkMin:minFloat, walkM:int, meets:string[], legs:[WalkLeg|BusLeg]}   // total/arrive include every walk (to the boarding stop, transfers, to the destination); walkMin/walkM = sums over the walk legs
// WalkLeg = {type:'walk', from:{lat,lon,name}, to:{lat,lon,name}, m, min, coords?:[[lat,lon]], source?:'router'|'estimate'}
// BusLeg  = {type:'bus', rid, board:{id,name,lat,lon}, alight:{id,name,lat,lon}, path:[{lat,lon}], stopsPassed, wait, waitLive, ride, source:'live'|'learned'|'schedule'|'estimate', conf, boardT, alightT, tripId}   // tripId: live trip update's trip_id, null for a headway guess
```
Planner rules (port from v1, keep behaviors): walk 80 m/min x1.2 detour estimate (WALK_M_PER_MIN, WALK_DETOUR in core/geo.js), max walk 800 m each end, widened to 1600 m (MAX_WALK_FAR) when no option exists within 800 m; every walk costs m/80 min however short (only walks under 1 m get no step); wait counts from when you reach the stop (t0 + walk), and for the second bus from after the transfer walk; direct + one transfer (transfer walk <= 150 m), loop routes wrap, ride time prefers same-trip live prediction (tripUpdates at alight stop minus at board stop), then `predict.rideMinutes`, then distance/18 km/h; wait = live next arrival at board stop after you arrive, else headway estimate; discard options absurdly longer than walking; direct trips contribute, per route, the best (board, alight) pair for EACH criterion below; ranked by `core/rank.js`; max 4 options (`PLANNER.MAX_OPTS`); every number is an estimate.

Ranking (`core/rank.js`, owner rule 2026-10-08): criteria in priority order **1. least walking** (sum of walk-leg minutes), **2. earliest arrival**, **3. shortest wait** (sum of bus-leg waits). An option *meets* a criterion when within a tolerance of the best (walk 0.5 min, arrival 1 min, wait 1 min). Sort: highest-priority criterion met (none = last), then more criteria met, then walk, arrive, wait. Options carry `meets:[ids]`; Directions re-ranks after `refineWalking` and shows `criteriaText(meets)` as a small line on each card ("Least walking · Earliest arrival") when there are 2+ options.
```js
// core/rank.js
export const CRITERIA   // [{id:'walk'|'arrive'|'wait', label, tol}]
export function walkTotals(legs): {walkMin, walkM}
export function optionStats(option): {walk:min, arrive:unixS, wait:min}
export function rankOptions(options): Option[]   // copies with meets, best first
export function criteriaText(meets): string
export function pickOptions(cands, {t0, walkOnlyMin, max=4, xferGainMin=2}): Option[]   // filter + dedupe + rank + cap (used by plan)
```

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
drawFavorites(stops|null)        // [{id,name?,lat,lon}] gold star badges (map/favorites.js), pane z422 (above stops, below highlights/selection/buses), all zooms (smaller <z14), taps -> onStopTap; selected favorite gets a wider unfilled ring; faded while a plan is drawn
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
export function registerView(id, def)   // def = { title(state)->string, parent?:viewId, detent?:'peek'|'half'|'full', tab?:'nearby'|'routes'|'alerts', render(state)->htmlString, mount?(rootEl, ctx), unmount?(), refresh?(), meta?(state)->text, onStopTap?(id, ctx)->bool }
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
Rendering loop (D1 `main.js`): on store change -> current view `render(state)` -> set `content.innerHTML` only if string differs from last (preserve scrollTop; never rebuild while a text input inside content has focus). Views with `mount` render once on entry and then **own their DOM**: they subscribe to the store and patch regions in place; main.js never rebuilds them (that would replace a button between pointerdown and click) and calls `refresh()` every 15 s so countdowns tick.

Views (D2) and required behavior (all ported from v1, improved):
- **Layout (v2.4, Google-Maps-style)**: a floating search bar at the top (`#topbar` > `#searchBar`, action `dir:open` with `data-focus="to"`; hidden in Directions via `#app[data-view="directions"]`) with the Settings gear (`#settingsBtn`) at its right end; under it the map credit, status pill, context chip (`#ctxbar`) and locate button (`--chip-top`); a bottom navigation bar `#tabs.bottomnav` (Current trip / Routes / My Routes, `--nav-h`) with the sheet resting on it (`.sheet { bottom: var(--nav-h) }`). The full detent stops below the search bar and any visible chips (`--v-full` overridden on `#app` with `:has()`); sheet height probes live in `#app` so those overrides apply. The map's bottom inset = visible sheet + navigation height.
- **nearby** (tab label and title **Current trip**; ids stay `nearby`): top region `nearby-trip` = the trip in progress (`tripBarHTML` + "Trip steps" -> directions + "Routes to station…") or a "No trip in progress" hint + "Routes to station…"; destination search is the top search bar, not in the sheet; with a real location each arrival row adds "Leave now / Leave in N min, est." and marks buses you cannot walk to in time (`pt-miss`, text + strike, never color alone); then next bus at the nearest stop in one glance; with location -> 3 nearest stops with up to 3 arrivals; without -> "Use my location" + "Arriving soon" list + search stations field + "Type an address or place"; never dead-ends; location denied is a first-class state.
- **stop**: arrivals list (route chip, route name, Live dot, ETA numeral, "Now"), route chips serving it, address line from `addresses`, "Updated Ns ago", Directions-from-here / to-here buttons.
- **routes**: first control "Edit map order" (`routes:order-edit`); then custom-route / journey bar, filter chip, Show all / Hide all; Running / Not running / Hidden groups; per-route eye toggle (persisted `hiddenRoutes`) honored on map, arrivals, Nearby; filter chip "Routes to <station> x".
- **pick** (Routes to station…, parent/tab `nearby`): dialog asks **Use current location / Select a station / Type an address or place**; NOTHING is highlighted until the user chooses; then nearest stops (<=1.5 km) are highlighted on the map and listed; tapping a station sets `routeFilter` and shows only routes that serve it on list+map; works with no location permission via the other two options.
- **route**: stop timeline with next ETA per stop, buses running, map focus on that route.
- **alerts**: active alerts, count badge on the tab; **about**: unofficial notice, official phone/link, privacy statements (Photon + walking router hosts), theme control, data credits/attribution, version.
- **directions**: Start/Destination fields (station autocomplete + Photon places, "My location" default if granted), swap, up to 3 option cards (total min, arrive clock, summary chips), tap card -> `map.drawPlan`, step list with `Bus arrives at <stop> <clock>`, wait, ride, source tags, walking legs on sidewalks (via `refineWalking`, async, shows "sidewalk route"/"estimate"), note "Bus times are estimates from schedules and live predictions. They will get more accurate as we collect more ride data.", walk-only fallback, no-service empty state.

## Tests
No Node: browser test pages run in headless Edge. `web/tests/e2e.test.html` loads the real `index.html` in an iframe with `e2e-stubs.js` (geolocation, live feed, service worker, history) and `e2e-expose.js` (store, place search, walk router) injected, and drives the main flows. `web/tests/lib.js` exports `test(name, fn)`, `eq`, `ok`, `near`, and writes a JSON summary to `<pre id="result">` and `document.title = "TESTS pass=N fail=M"`. `tools/run_browser_tests.py [page...]` serves `web/` on a free port, runs `msedge --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=30000 --dump-dom`, parses the title, exits non-zero on failure. Edge path: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. Screenshots: add `--hide-scrollbars --window-size=500,900 --blink-settings=preferredColorScheme=1|2 --timeout=20000 --screenshot=<abs path OUTSIDE repo>` (headless does not paint vector map tiles; UI and overlays do paint).

## Acceptance checklist (lead verifies at integration)
Boot with no console errors; nearby list populated from live data; stale pill logic; sheet drag/detents; theme Auto/Light/Dark switch updates map style + markers; Routes to station flow (all 3 modes, no location needed); route toggles; directions with sidewalk walking and road-following bus legs and clock times; offline shell; all unit tests green; Lighthouse-style a11y spot checks; no file > 400 lines; no leftover v1 globals.

## v2.1 features (My Routes, custom routes, journeys, route hours) — contract
Lead already landed: new state fields (state.js), `core/visibility.js`, `core/custom.js`, the
`myroutes` tab id (router TABS = nearby, routes, myroutes; index.html tab button), main.js map sync via
`mapVisibility`, empty per-feature CSS files, stubs (`ui/views/myroutes.js`, `core/schedule.js`,
`data/service.json`) and their sw.js PRECACHE entries (cache `sb-v2-3`). Code against what is below.

### New state (state.js)
```js
service: {}                 // data/service.json, {} when missing (static)
routeOrder: [rid]           // persisted. Map draw priority, first = drawn on top. May be partial/empty.
customRoutes: [{id, name, rids:[rid], highlight:[rid]}]   // persisted. My Routes sets.
activeCustom: id|null       // persisted. Applied custom route (its complement is in hiddenRoutes).
prevHidden: [rid]           // persisted. hiddenRoutes before the custom route was applied.
favStops: [stopId]          // persisted. Favorite stations.
journey: null|{rids:[rid], label:string, kind:'plan'|'station'}   // NOT persisted. "Only show relevant routes".
```

### core/visibility.js (lead; everyone uses it, never re-derive visibility by hand)
```js
effectiveHidden(state): rid[]      // journey ? every route not in journey.rids : hiddenRoutes
isVisible(state, rid): boolean
activeCustomRoute(state): custom|null
mapFocus(state): rid[]|null        // route view [routeId] > (journey: null) > routeFilter.ids > active custom highlight > null
drawOrder(state, focus?): rid[]    // focus first, then routeOrder, then data order; top-most first
mapVisibility(state): {hidden, focus, order}   // main.js passes these to drawNetwork / drawBuses
```
Lists (Nearby, stop, arrivals, route list) MUST pass `effectiveHidden(state)` wherever they used `state.hiddenRoutes`.

### core/custom.js (lead) — every function returns a store PATCH
`createCustom(state,{name,rids})->{patch,id}`, `saveVisibleAsCustom(state,name)->{patch,id}` (applied),
`updateCustom(state,id,{name?,rids?,highlight?})`, `toggleHighlight(state,id,rid)`, `deleteCustom(state,id)`,
`applyCustom(state,id)` (hiddenRoutes := complement, remembers prevHidden, clears routeFilter),
`clearCustom(state)` (restores prevHidden), `matchesCurrent(state,c)`, `visibleRids(state)`, `hiddenFor(state,rids)`,
`moveInOrder(state,rid,-1|1)` (routeOrder), `toggleFav(state,stopId)`, `cleanName(s)`.

### Map (C) additions
`drawNetwork({..., order})`: lines are stacked by `order` (index 0 on top); focused routes always above
unfocused. Include `order` in `networkSig`. When focus has 1-3 routes, draw small direction-of-travel
chevrons along each focused route (GTFS shape point order = travel direction), spaced in screen px,
recomputed on zoom, honoring reduced motion (static), never intercepting taps.

### data/service.json (built by tools/build_gtfs.py) and core/schedule.js
```js
{ generated:'ISO', feed:{start:'YYYY-MM-DD', end:'YYYY-MM-DD'},
  routes: { rid: {
    days: { mon|tue|wed|thu|fri|sat|sun: null | { first:'HH:MM', last:'HH:MM' /* may be >= 24:00 */, trips:int,
            buses:[24 ints] /* scheduled vehicles in service per local hour = max concurrent trips */ } },
    exceptions: [{ date:'YYYY-MM-DD', type:'removed'|'added', days?:dayKey }],   // calendar_dates in feed window
  } } }
```
```js
// core/schedule.js (pure; Chicago local time; never throws; null/[] when no data)
routeService(service, rid): object|null
dayKey(unixS): 'mon'..'sun'                         // America/Chicago
hoursOn(service, rid, unixS): {first, last, label:'7:00 AM – 11:30 PM', exception?:'removed'|'added'}|null   // that date, exceptions applied
weekSummary(service, rid): [{days:'Mon–Fri', label:'7:00 AM – 11:30 PM'}|{days:'Sat', label:'No service'}]   // groups equal days
busesByHour(service, rid, dayKey): [{hour, buses}]  // only hours with service
upcomingChanges(service, rid, unixS, horizonDays=30): [{date, label:'Thu, Nov 26', text:'No service'|'Extra service'}]
isScheduledNow(service, rid, unixS): boolean|null
```

### Ownership for v2.1 (in addition to the table above; never edit files you do not own)
| Agent | Owns |
|---|---|
| SHELL | index.html, main.js, ui/router.js, ui/components.js, ui/sheet.js, ui/actions.js, css/tokens.css base.css sheet.css components.css, ui/views/alerts.js, ui/views/about.js, tests/ui-shell-*, tests/e2e* |
| MAP | map/*.js (incl. map/favorites.js), css/map.css, tests/map-* |
| ROUTE | tools/build_gtfs.py, web/data/service.json, data/static.js, core/schedule.js, ui/views/route.js, css/route.css, tests/data-static.js, tests/route-* + route.test.html |
| ROUTES | ui/views/routes.js, css/routes.css, tests/routes-* + routes.test.html |
| MYROUTES | ui/views/myroutes.js, ui/views/myroutes-swipe.js (swipe-left action tray: Details / Edit / Delete; a full swipe never runs an action), ui/views/stop.js, css/myroutes.css, tests/myroutes-* + myroutes.test.html |
| JOURNEY | ui/views/directions.js, ui/views/pick.js, ui/views/nearby.js, ui/views/tripinfo.js (trip-timing helpers, not a view), css/journey.css, tests/journey-* + journey.test.html |
| MONITOR | monitoring.md, tools/monitor.py |
| lead | state.js, core/visibility.js, core/custom.js, sw.js, docs/ARCHITECTURE.md, css/views.css (frozen: override in your own css file) |
New view files must be added to main.js VIEW_IDS and sw.js PRECACHE: ask the lead in your report.

### Settings + bus-near notifications (v2.1b)
State (state.js, persisted): `notify: {stopId|null, rids:[] /* empty = any visible route */, twoStops, oneStop, minutes /* 0 = off, else alert at <= N min */, liveActivity /* iPhone app only */, inApp}`; `cleanNotify`, `NOTIFY_DEFAULTS`.
```js
// core/notify.js (SETTINGS; pure, shared later by the iPhone app's native layer)
stopsAway(state, stopId, rid?): [{rid, tripId, vehicleId, stopsAway:int, etaS:unixS|null, nextStopId, nextStopName}]  // from buses + trips + routeStops; loops wrap
dueAlerts(state, prevFired:Set<string>, nowS): {alerts:[{key, kind:'twoStops'|'oneStop'|'minutes', title, body}], fired:Set}   // dedup per trip+kind
liveStatus(state, nowS): {title, minutes, nextStop, stopsAway}|null   // what a lock-screen Live Activity would show
```
Web: `ui/notifier.js` (SETTINGS) watches the store while the page is open and shows in-app banners (bus 'toast') and, if the user granted it, a browser Notification; it never claims to work in the background. Settings is a modal overlay (`ui/settings-overlay.js`, SETTINGS) opened and toggled by the top-right gear (action `settings:open`): it lifts the sheet to "full" and covers the WHOLE sheet (grab, title, tabs: owner wants nothing of Plan Trip to look like part of Settings), a scrim (`.sto-scrim`) dims what is still visible behind it and closes Settings on tap, the sheet header and content are inert; "Done" top right; also covers the bottom navigation (`#tabs` inert, `navBottom` in `overlayBox`); closes on Escape / navigation / the sheet leaving full, traps focus and restores the previous detent. View id `settings` is a compatibility shim only.
| SETTINGS | ui/views/settings.js, ui/settings-overlay.js, ui/notifier.js, core/notify.js, css/settings.css, tests/settings-* + settings.test.html |
| IPHONE | `conversion to appstore.md`, docs/IOS.md, docs/APPSTORE.md |

### Custom routes interaction (2026-10-08)
Tap a custom route row = show it on the map / stop showing (`mr:toggle`, no navigation). Swipe left (or the row's "More" button,
`mr:swipe`) = action tray Details (`mr:details`, no apply) / Edit / Delete. Every delete goes through `ui/confirm.js`
`confirmDialog({title, body, confirmLabel, danger})` -> Promise<boolean> (native `<dialog role="alertdialog">`, Cancel focused,
Escape / backdrop cancel; settles from the button itself, not the async close event).

### 2026-10-09: stutter fixes, map credit, self-update
- Sheet geometry: the sheet element is always `--v-max` tall (offset and content padding use `--v-max`); `--v-full` depends only on
  the status pill (`--pill-h`, measured by a ResizeObserver in main.js). The context chip never changes the detent; it fades out at
  the full detent. Selecting / clearing a custom route moves nothing (0 layout shift at half and full).
- Map credit (`js/map/credits.js`, replaces Leaflet's attribution control): "OpenFreeMap · OpenMapTiles · OpenStreetMap" as links,
  no copyright sign; shown at load, collapses after 5 s into an accessible (i) button at the bottom-left above the sheet (positioned by
  `setBottomInset`), hidden at the full detent (OSMF Attribution Guidelines allow both). `fitTo` uses `flyToBounds`.
- My Routes: rows are a fixed 64 px with a fixed-size check circle (`aria-pressed`); `ui/views/myroutes-patch.js` morphs only what
  changed (keyed rows, keeps drag styles, waits while a pointer is down or a tray animates); tap threshold 10 px in the row's own CSS
  px; only the tray's Details button opens 'customroute' (saving a new route returns to the list).
- `ui/update.js`: registers sw.js, checks for a new version when the app returns to the foreground, reloads in the background when a
  new worker takes control (an installed app could otherwise run old code for days).
- `tools/run_browser_tests.py` retries a page once, alone, when headless Edge's virtual-time mode stalls it (runner timeout with no
  results); the output says "(retried once after a runner timeout)". Pages with failing tests are never retried.

### 2026-10-09 (later): search speed + spelling, trip progress, tap outside
- Place search: `searchPlaces(q, {signal, exact, fetch, placesFetch})` -> `{items, error?, assumed?: {from, to, big}}`; Photon gets
  `assumed.to`; `exact` = as typed, Photon always (3+ letters), up to 8 results; cache keyed by query + exact. `localPlaces(q, {exact})`
  (sync, null until loaded). data/places.js: `findLocal(q, {limit, exact})` -> `{items, assumed?}`, `placesReady()`, `preloadPlaces()`;
  data/spell.js (weighted Damerau-Levenshtein corrections); ui/views/placesearch.js: `createPlaceSearch(onChange, {ms=250})` with
  on-device results on every keystroke and only Photon debounced; note "Showing results for X" + "Search for … instead" when the
  correction is big (actions dir:exact / nearby:exact / pick:exact). places.json v2 (p[8] other names); tools/place_aliases.json (72
  campus nicknames keyed by OSM id).
- Trip progress: `planJourney(o, toLabel)` -> `{rids, label, kind:'plan', to, t0, legs}`; core/tripprogress.js `tripProgress(journey,
  state, nowS)` (phases walk-to-stop / waiting / on-bus / arrived, followed vehicle, per-stop state + live ETA, missed-bus detection);
  ui/views/tripprogress.js `tripProgressHTML(state, now, {actionsHTML})`, rendered by nearby.js entryHTML when a trip is active.
- Map: `onMapTap(fn)` fires for taps on empty map (not layers, credits or controls; never after a drag); main.js lowers the sheet to peek.

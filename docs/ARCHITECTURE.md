# Straight Bussing v2: architecture contract

v2 is the live web app on `main` (merged 2026-10-08; v1 is tag `v1-final`; `v2-rewrite` is kept level with `main`): small ES modules with clear seams, tested. The iPhone app is a native SwiftUI port in `ios/` (StraightBussingKit mirrors `core/*`; `ios/README.md` has the web parity matrix) and follows the web wording; `conversion to appstore.md` is the plan. **Every agent codes against this file. If you must change a signature, change it here in the same edit and say so in your report.**

## Hard constraints
- Static site, **no build step, no Node**. Native ES modules (`<script type="module">`), relative imports with `.js` extension. Leaflet 1.9.4 (`L`) and maplibre-gl 4.7.1 + `@maplibre/maplibre-gl-leaflet` 0.1.4 are CDN **globals** loaded by classic `<script>` tags before `js/main.js`.
- Plain modern JS (ES2022), no TypeScript, no frameworks. Each file < 400 lines. JSDoc on every export. No `eval`, no inline event handlers, no `innerHTML` with unescaped dynamic text (use `esc()`).
- All times are **unix seconds (number)** unless the name ends `Ms`. Minutes are floats until display. Coordinates `{lat, lon}`; polylines `[[lat, lon], ...]`.
- Privacy: no accounts/tracking. Location stays on device. Only (a) typed place text (or its spelling fix) -> photon.komoot.io, when the on-device place index has < 5 matches or the user taps "Search for ... instead", (b) walking-leg endpoints rounded to 4 dp -> routing.openstreetmap.de (fallback valhalla1.openstreetmap.de) leave the device (iOS: Apple MapKit; plus its daily schedule check on blobberus.github.io, public files only). Plain requests for public data: the Passio feeds, OpenFreeMap tiles for the area on screen, unpkg.com, GitHub Pages. `About` (ui/views/about.js) and `privacy.html` must say so, in the same words as the iOS About.
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
export function clock(unixS): string           // '4:12 PM' in America/Chicago (device locale's 12/24 h)
export function shortDate(unixS, withYear=false): string   // 'Oct 12' / 'Oct 12, 2026', Chicago calendar
export function sameDay(a, b): boolean         // same Chicago calendar day
export function minsUntil(unixS, from=nowS()): number   // floor, can be <=0
export function ago(unixS): string             // '8s ago'
// core/geo.js
export function hav(a,b): meters               // {lat,lon} each
export function walkMin(meters): number        // meters/80
export function nearestStops(stops, point, {max, maxM, routeStops?}): [{id,name,lat,lon,d}]
export function bearing(a,b): degrees
// core/storage.js
export function load(key, fallback), save(key, value)   // JSON, try/catch, prefix 'sb:'
export function useMemoryOverlay(on), memoryOverlay()   // demo mode (?demo=1): reads see saved prefs, writes/removes stay in memory for the page (nothing stored)
// core/events.js
export const bus = { on(name, fn)->off, emit(name, payload) }   // events: 'sheet:inset' {px, detent}, 'toast' {text}
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
  buses:[{vehicle:{id,label}, position:{latitude,longitude,bearing,speed}, trip:{trip_id,route_id}, timestamp, stop_id, current_stop_sequence}],   // OPERATING vehicles only (core/operating.js), minus buses long off their route (core/offroute.js) and buses idle and not in service (core/idle.js); all applied in data/live.js
  trips:[{trip:{trip_id,route_id}, vehicle:{id,label}, stop_time_update:[{stop_id, arrival:{time}, departure:{time}}]}],   // minus the trip updates of buses core/offroute.js hides
  alerts:[{header_text, description_text, active_period, informed_entity}],
  feedTs:0, lastOk:0, failed:false, liveLoaded:false,
  // user/prefs (persisted via storage.js where noted)
  user:null /* {lat,lon} */, locState:'unknown' /* unknown|asking|granted|denied|off */, locErr:null /* {code: 1 denied | 2 unavailable | 3 timeout, at: ms} of the last failed try; Settings > Location and Current trip show it (core/lochelp.js has the per-device steps) */,
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
export function startLive(store, {intervalMs=10000, fetch?, keepAlive?, ...}): {stop(), pollNow(), failures(), delay()}   // polls the 3 Passio JSON feeds (BASE https://passio3.com/chicago/passioTransit/gtfs/realtime/<name>.json?_=ts, cache:'no-store'), sets live fields; failure keeps last data and sets failed:true; pause when document.hidden (unless keepAlive() is true: bus alerts with notifications allowed), poll on visible; fetch = the demo feed in demo mode
// data/demo.js (demo mode only, 2026-10-10; port of the iOS Kit DemoFeed.swift)
export function demoRoutes(state, nowS): {rids, scheduled}   // routes scheduled now (service.json); none scheduled -> every route (scheduled:false)
export function demoFeeds(state, nowS, {epoch, segments?, cache?}): {vehiclePositions, tripUpdates, serviceAlerts}   // Passio-shaped GTFS-rt JSON: per route its scheduled peak (busCount, 1..3) evenly spaced, moving along the road shape (map/geometry.js alongShape) on segments.json times (else 18 km/h), trip updates for the next 14 stops, no service alerts; deterministic in (nowS - epoch)
export function demoFetch(store, {now?, epoch?, segments?}): fetchLike   // answers the 3 feed URLs from demoFeeds after static data loads; never touches the network (no mixing with live data); other URLs 404
// data/geocode.js
export function searchPlaces(q, {signal}): Promise<{items:[{label, sub, lat, lon}], error?:string}>   // never throws (error: 'aborted'|'timeout'|'network'|'http <status>'|'bad response'); <3 chars -> {items:[]} with no request; in-memory cache; 400 ms debounce helper debounce(fn, ms) exported too (.cancel(), .flush())
// Photon gets only the typed text + fixed constants (never the user's location): bias lat 41.7886 lon -87.5987 (UChicago), zoom=10, location_bias_scale=0.2, Illinois bbox -91.52,36.97,-87.49,42.51, limit=15, lang=en.
// Client side: keep Illinois only (state Illinois/IL; no state -> point inside the bbox; non-US dropped), re-rank by distance tier from campus (<=3 km, <=20 km, <=80 km, rest of IL) blended with Photon rank, name match and place type; exact city/town name first; merge duplicates; max 5.
// sub = 'street, city, IL' (Chicago townships shown as Chicago). Also exported: inIllinois, rankPlaces, photonUrl, featureToPlace, HOME, IL_BBOX, PHOTON, clearPlaceCache.
// 2026-10-08: searchPlaces asks the LOCAL index first (data/places.js over web/data/places.json: named places within a 30-minute walk of the
// 82 campus stops, from OpenStreetMap via tools/build_places.py, ODbL): punctuation/space-insensitive ("chickfila"), prefixes, 1 typo,
// categories (coffee, grocery, apartments), whole-word name matches first, then nearest stop. Items carry {local:true, walk, stop, score}
// and sub "Kind, address · N min walk to <stop>" (one middle dot per line, docs/DESIGN.md "Copy"). Photon is called only when the local index has < 5 matches; mergePlaces() puts local
// first and drops Photon duplicates (within 150 m, one name contains the other); Photon results > 3 km away end with "N km from campus".
// data/places.js: norm(s) (re-exported from core/text.js since 2026-11-04, with near1: one text rule for place, station and route search), scorePlace, searchLocal(q,{limit}), loadPlaces(fetch?) (never throws), setPlaces(data|null) for tests.
```
`sw.js`: network-first for same-origin GET with `cache:'no-cache'`, cache only `r.ok && r.status===200`, never cache cross-origin, never `?demo` requests; precache the whole shell: index.html, privacy.html, support.html, manifest, every file under js/ css/ icons/ data/ (`tools/test_precache.py` walks the import graph from index.html, including the dynamic view imports, and fails on a missing entry; `pages.yml` runs it before deploying); cache name constant `sb-v2-<n>` (bump it whenever a shell file changes); serve offline fallback. Also keep the daily GTFS refresh workflow `pages.yml` working (it copies `web/`).

## Core logic (A)
```js
// core/operating.js (2026-10-08): owner rule "a bus that is not operating is not displayed" (map, route station list, counts, alerts, planner)
export const STALE_S = 300
export function isOperating(bus, {routes, service, trips, feedTs, nowS, staticLoaded}): boolean   // fresh (<= 5 min older than the FEED), known route, and route scheduled now OR trip has a live prediction >= now-60
export function operatingBuses(buses, ctx): bus[]   // data/live.js filters store.buses with it (opts.now injectable for tests)
// 2026-10-10 silent service (rider safety): a fresh feed with no vehicle while routes are scheduled is NOT "no shuttles running"
export function scheduledRoutes(state, nowS, {hidden?, among?}?): rid[]   // scheduled now (service.json; no data = not counted), data order
export function silentService(state, nowS): boolean   // liveLoaded, no operating bus, not liveUnknown, >= 1 route (visible or not) scheduled now
export function scheduledNoLive(state, rid, nowS): boolean   // scheduled now, no operating bus on it (callers check liveUnknown first)
export function noLiveStatus(state, rid, nowS): string|null  // 'Scheduled until 4:29 AM, no live location'
export function silentText(state, rids, nowS, phone?): string   // plain text (escape it): names <= 3 routes + scheduled end, else counts; [] = hidden only
// core/offroute.js (2026-11-04, owner): buses not following their route for a long time are hidden (section "Buses that do not follow their route")
export const OFF_M = 300, HIDE_IN_S = 900, HIDE_OUT_S = 300, HOURS_PAD_S = 1800, FOLLOW_M = 1500, RETURN_M = 1000, GAP_S = 600, DETOUR_RE
export function offRouteStep(tracks, buses, {shapes, service, alerts, routes, nowS, feedTs}): {tracks, hidden: vehicleId[]}   // pure; tracks = {} at start, kept by the caller between polls (data/live.js), never modified
export function dropHidden(buses, trips, hidden): {buses, trips}   // trip updates matched by vehicle id only (shared trip ids)
export function closestOnLine(lines, lat, lon): {d, lat, lon}|null; inListedHours(service, rid, t, padS?): boolean|null; detourAlert(alerts, routes, rid, t): boolean
// core/idle.js (2026-11-06, owner): buses idle and not in service are hidden (section "Idle buses that are not in service")
export const STILL_M = 80, IDLE_S = 1800, PARKED_S = 5400, LINGER_S = 180, PAST_PAD_S = 3600, FUTURE_S = 120, GAP_S = 600, SPOT_R = 120
export function idleStep(tracks, buses, {trips, service, idle, nowS, feedTs}): {tracks, hidden: vehicleId[], why: {id: 'parked'|'idle'|'past'|'linger'}}   // pure; tracks kept by data/live.js
export function lingerAt(idle, service, rid, lat, lon, t): entry|null; predictsAhead(trips, id, t): boolean; serviceClock(t): {min, iso, day, group}; hoursKey(service, rid, iso, day): string|null
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

Ranking (`core/rank.js`, owner rule 2026-10-08): criteria in priority order **1. least walking** (sum of walk-leg minutes), **2. earliest arrival**, **3. shortest wait** (sum of bus-leg waits). An option *meets* a criterion when within a tolerance of the best (walk 0.5 min, arrival 1 min, wait 1 min). Sort: highest-priority criterion met (none = last), then more criteria met, then walk, arrive, wait. Options carry `meets:[ids]`; Directions re-ranks after `refineWalking` and shows `criteriaText(meets)` as a small line on each card ("Least walking, earliest arrival") when there are 2+ options.
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
drawNetwork({routes, shapes, routeStops, stopRoutes, stops, hidden:[], focus:[]|null, dark})  // colored route lines, no outline, LINE_WIDTHS (z13 2 .. z18 6 px, focused + FOCUS_EXTRA 2; 2026-11-04 / glass), network 0.9, focused 1, others .2; stops at zoom>=14 (stopStyle) with 44px tap halo
drawBuses(buses, {routes, shapes, hidden, focus, nowS})   // rounded rectangle in route color (26 tall, short name never truncated, bus number inside after a divider), heading notch (notchRadius), no pulse (glass), stale (>60 s) dimmed, faded with its faded route (busFaded, 2026-11-04); on its route line and moved along it (map/track.js, below); recreate marker only if route changes
setSelectedStop(stop|null)       // {id,lat,lon}
setUser(pos|null)                // blue dot
setHeading(deg|null, spread?)    // heading cone on the dot (2026-10-14): accent wedge, deg clockwise from north, spread = width (default 60, 20..160);
                                 // fed by ui/compass.js straight from main.js (never the store), DOM written only on a change; null hides it
highlightStops(items|null, {onPick})   // items [{id,lat,lon}] ring highlights; null clears
drawFavorites(stops|null)        // [{id,name?,lat,lon}] yellow star badges (map/favorites.js; owner 2026-11-05: --fav-mark #FFCC00 / #FFD60A, dark --fav-ink star, --fav-edge on light), pane z422 (above stops, below highlights/selection/buses), all zooms (smaller <z14), taps -> onStopTap; selected favorite gets a wider unfilled ring; faded while a plan is drawn
drawPlan(option|null, {routes, shapes, routeStops})  // bus legs follow road shapes (geometry.alongShape); walk legs dashed along leg.coords else straight; start/end pins; no outlines; the buses of routes it does not ride fade
fitTo(points|bounds, {maxZoom})  flyTo({lat,lon}, zoom)
onStopTap(fn) onBusTap(fn) onUserMove(fn)
// map/geometry.js (pure, unit-tested)
export function alongShape(shapeLines, routeStopsList, board, alight, fallbackLatLngs): latlngs
// 2026-10-10: a slice > 2.5 x the stop path + 500 m takes the shortest plausible pass pair, else is KEPT (North drives 5 km
// between stops 600 m apart); the straight fallback is only for stops > 200 m off the shape or a backwards ride on a
// non-loop. iOS: Kit Geometry.swift is a faithful port (golden test against this file's output).
```
Layer groups must never be rebuilt when nothing changed (diff by a cheap signature) so polling doesn't flicker.

## UI shell (D1) and views (D2)
```js
// ui/router.js
export function registerView(id, def)   // def = { title(state)->string, parent?:viewId, detent?:'peek'|'half'|'full', tab?:'nearby'|'routes'|'myroutes', render(state)->htmlString, mount?(rootEl, ctx), unmount?(), refresh?(), meta?(state)->text, onStopTap?(id, ctx)->bool, replaceSelf?:bool }
export function navigate(view, params={})   // sets store.view/prevView/stopId/routeId, adjusts detent; a sub view pushes the current location (a view already on the stack pops back to it); a replaceSelf view (the route page) opened from itself replaces the current entry instead (line replaces line, owner 2026-11-02)
export function back()
// ui/actions.js
export function registerAction(name, fn)    // fn(dataset, event, ctx); markup uses data-action="name" data-id="..." (event delegation on the sheet content)
// ctx passed to render/mount/actions: { store, map /*MapApi*/, navigate, back, setDetent(d), toast(text), now: nowS, locate(): Promise<boolean> /* asks geolocation, sets store.user/locState/locErr, never throws */, stopLocation() /* Settings > Stop sharing */ }
// Views import core/* and data/geocode.js directly (planner, walk, predict, arrivals, geocode). Each view file calls registerView(...) and registerAction(...) at import time; main.js imports every view file.
// Held tap (2026-10-10): runAction / navigate on a name or view not registered yet (slow network: the search bar, gear and tabs work before the view modules load) return false and hold that tap (one slot, actions.js holdTap; router.js imports it, never the reverse); registerAction / registerView runs it once, next tick, if under PENDING_MS (20 s) old. Any newer action, navigate or back that runs drops it; a newer held tap replaces it.
// ui/components.js (pure HTML-string builders, all escape inputs)
export const routeChip(rid, routes), etaBlock(unixS, {stale}), arrivalRow(a, state), stopRow(...), emptyState(title, body), skeleton(n), pill(kind, text), segmented(items), estTag(source)
// ui/sheet.js: createSheet({sheetEl, contentEl, headEl}) -> {setDetent(d), getDetent(), onChange(fn)}  TWO resting states (owner 2026-10-12, 'copy Google Maps', no midway stop): peek (grab + title line, --v-peek 76px) and full; while held the sheet follows the finger anywhere, on release the finger's last motion decides (up = full, down = peek; a stopped finger uses its last 2 px move; no move = tap: grab toggles, a collapsed header expands); 'half' requests keep the current state; the whole header strip drags: touch events with a non-passive touchmove (iOS cannot turn it into a page pan), mouse / pen pointer events on the window (no pointer capture, no text selection); grabbing a settling sheet stops it under the finger; settle starts at the finger's speed (settleMs); content inset follows data-rest after the settle; keyboard (arrows/Home/End/Enter), >=768 px = left panel; emits bus 'sheet:inset' {px} on every settle
//   grabber (#grab, a div): role="slider" "Resize panel", aria-valuenow 0..2 + aria-valuetext DETENT_TEXT (Collapsed / Half / Expanded); arrows / Page Up / Page Down step, Home = Collapsed, End = Expanded, Enter / Space cycle (2026-10-10, iOS adjustable action)
// ui/theme.js: initTheme(store) -> applies data-theme, matchMedia, mount(el) segmented Auto/Light/Dark, onChange(fn(isDark))
```
Rendering loop (D1 `main.js`): on store change -> current view `render(state)` -> set `content.innerHTML` only if string differs from last (preserve scrollTop; never rebuild while a text input inside content has focus). Views with `mount` render once on entry and then **own their DOM**: they subscribe to the store and patch regions in place; main.js never rebuilds them (that would replace a button between pointerdown and click) and calls `refresh()` every 15 s so countdowns tick.

Views (D2) and required behavior (all ported from v1, improved):
- **Layout (v2.4, Google-Maps-style)**: a floating search bar at the top (`#topbar` > `#searchBar`, action `dir:open` with `data-focus="to"`; hidden in Directions via `#app[data-view="directions"]`) with the Settings gear (`#settingsBtn`) at its right end; under it the map credit, status pill, context chip (`#ctxbar`) and locate button (`--chip-top`); a bottom navigation bar `#tabs.bottomnav` (Current trip / Routes / My Routes, `--nav-h`) with the sheet resting on it (`.sheet { bottom: var(--nav-h) }`). The full detent stops below the search bar and any visible chips (`--v-full` overridden on `#app` with `:has()`); sheet height probes live in `#app` so those overrides apply. The map's bottom inset = visible sheet + navigation height.
- **nearby** (tab label and title **Current trip**; ids stay `nearby`): order and regions per "2026-10-11 (owner decisions)" below (one-line alert row, trip in progress, the next bus, "Use my location", station search + "Type an address or place" / "Routes to station…", the rest, quiet no-trip hint); destination search is the top search bar, not in the sheet; with a real location each arrival row adds "Leave now / Leave in N min, est." and marks buses you cannot walk to in time (`pt-miss`, text + strike, never color alone); with location -> 3 nearest stops (up to 3 arrivals at the nearest, 1 at the others); without -> "Use my location" + "Arriving soon"; never dead-ends; location denied is a first-class state.
- **stop**: arrivals list (route chip, route name, Live dot, ETA numeral, "Now"), route chips serving it, address line from `addresses`, "Updated Ns ago", Directions-from-here / to-here buttons.
- **routes**: first control "Edit map order" (`routes:order-edit`); then custom-route / journey bar, filter chip, Show all / Show running / Hide all (Show running, owner 2026-10-17: only the routes operating now stay visible, a live bus or scheduled now with no live location, `core/custom.js showRunning`; none operating = nothing changes and the in-page toast "No lines are operating at this time.", or "No lines are reporting a live location right now." when routes are scheduled without a live location, or "Live data is unavailable, so running lines can't be shown." with the feed unknown; aria-disabled when only running routes show); Running / Not running / Hidden groups; per-route eye toggle (persisted `hiddenRoutes`) honored on map, arrivals, Nearby; filter chip "Routes to <station> x".
- **pick** (Routes to station…, parent/tab `nearby`): dialog asks **Use current location / Select a station / Type an address or place**; NOTHING is highlighted until the user chooses; then nearest stops (<=1.5 km) are highlighted on the map and listed; tapping a station sets `routeFilter` and shows only routes that serve it on list+map; works with no location permission via the other two options.
- **route**: stop timeline with next ETA per stop, buses running, map focus on that route.
- **alerts** (sub view of Current trip, no tab since v2.1): active alerts, opened from the Current trip banner or the My Routes row; phone numbers in alert text are call links. When no bus reports (feed down, silent feed, nothing running) Current trip, stop, Routes, route detail and Directions also show the operator's alerts in full (`operatorAlertsHTML`, "From the shuttle operator") next to the official links; **about**: unofficial notice, official phone/link, privacy statements (Photon, walking router hosts, network requests), links to privacy.html and support.html, theme control, data credits/attribution, version.
- **directions**: Start/Destination fields (station autocomplete + Photon places, "My location" default if granted), swap, up to 3 option cards (total min, arrive clock, summary chips), tap card -> `map.drawPlan`, step list with `Bus arrives at <stop> <clock>`, wait, ride, source tags, walking legs on sidewalks (via `refineWalking`, async, shows "sidewalk route"/"estimate"), note "Bus times are estimates from schedules and live predictions. They will get more accurate as we collect more ride data.", walk-only fallback, no-service empty state. Start (2026-10-12, owner; iOS parity) sets the journey and navigates to `nearby` (Current trip) at the half detent, where the trip in progress leads; focus moves to its `.tp-title`, the plan stays drawn, and Directions shows the trip bar when you come back. Like Google Maps (owner 2026-10-12): the search bar itself turns into the Start / Destination card at the top (`#dirbar` in `#topbar`, FLIP from the bar's rect read by `barRects` before the switch); the sheet holds suggestions and options (the Directions view renders the fields in the sheet only in the landscape panel, `useBar()`); `--dirbar-h` (measured) moves `--chip-top` / `--v-max` / `--v-full` below the card in Directions; focusing a field expands the sheet; collapsing it blurs the field (main.js `sheet.onChange`, every view); leaving Directions shrinks the card back into the bar in the same place. Map taps (stop, bus) keep the sheet as it is: collapsed, the header names the stop with its next bus (stop view `meta`).

## Tests
No Node: browser test pages run in headless Edge. `web/tests/e2e.test.html` loads the real `index.html` in an iframe with `e2e-stubs.js` (geolocation, live feed, service worker, history) and `e2e-expose.js` (store, place search, walk router) injected, and drives the main flows. `web/tests/lib.js` exports `test(name, fn)`, `eq`, `ok`, `near`, and writes a JSON summary to `<pre id="result">` and `document.title = "TESTS pass=N fail=M"`. `tools/run_browser_tests.py [page...]` serves `web/` on a free port, runs `msedge --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=30000 --dump-dom`, parses the title, exits non-zero on failure. Edge path: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. Screenshots: add `--hide-scrollbars --window-size=393,852 --virtual-time-budget=12000 --screenshot=<abs path OUTSIDE repo>`; pick the theme with `localStorage['sb:theme'] = '"dark"'` (or Auto + the OS setting) rather than `--blink-settings` (headless does not paint vector map tiles; UI and overlays do paint). Python checks: `tools/test_precache.py` (offline shell) and the data / collector tests `tools/test_*.py`, each `python tools/test_x.py`.

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
landmarks: []               // data/landmarks.json map labels [{name, lat, lon, tier, kind, osm}], [] when missing (static, 2026-10-13)
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
mapFocus(state): rid[]|null        // route view [routeId] > (journey or a trip: null) > routeFilter.ids > active custom highlight > null
drawOrder(state, focus?): rid[]    // focus first, then routeOrder, then data order; top-most first
tripRoutes(state): rid[]|null      // the trip in progress (journey kind 'plan'): its bus legs' routes, [] for a walk
mapHidden(state): rid[]            // on a trip: every route but the trip's (a walk: all); else effectiveHidden (2026-11-04)
busFaded(rid, focus, plan?): bool  // other routes in focus, or a drawn plan that does not ride it (2026-11-04)
mapVisibility(state): {hidden, focus, order}   // hidden = mapHidden; main.js passes these to drawNetwork / drawBuses
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
hoursOn(service, rid, unixS): {first, last, label:'7:00 AM to 11:30 PM', exception?:'removed'|'added'}|null   // that date, exceptions applied
weekSummary(service, rid): [{days:'Mon-Fri', label:'7:00 AM to 11:30 PM'}|{days:'Sat', label:'No service'}]   // no dash characters in visible text   // groups equal days
busesByHour(service, rid, dayKey): [{hour, buses}]  // only hours with service
upcomingChanges(service, rid, unixS, horizonDays=30): [{date, label:'Thu, Nov 26', text:'No service'|'Extra service'}]
serviceHoursAt(service, rid, unixS): {hours, dayKey, yesterday}|null   // the service day's hours (after midnight: yesterday's while in its tail; 2026-10-11)
isScheduledNow(service, rid, unixS): boolean|null
scheduledUntil(service, rid, unixS): 'HH:MM'|null   // end of the window running now (may be >= 24:00; clock12 formats it)
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
dueAlerts(state, fired, nowS, {tripOn, polling})   // 2026-10-13: nothing while tripOn; data down -> ONE {kind:'delayed'} per outage
tripAlerts(p, state, fired, nowS, {polling}): {alerts:[{key, kind:'board2'|'board1'|'boardMin'|'off2'|'off1'|'delayed', title, body}], fired}
tripAlertsOn(p, state): boolean   // a started trip (not arrived) with notify.trip on
```

### Map labels: building and place names (2026-10-13, owner: "the buildings on the maps should also have their names like Google maps. Not every building, but highly trafficked ones and prominent off campus locations relevant to the bus coverage", "UChicago dorm buildings")
Curated in `tools/landmarks.json` (label, tier, kind, optional `until`; order = priority): the buildings the stops are named after, every UChicago dorm, libraries, dining commons, the medical campus, the busiest academic buildings, and the off-campus places the shuttles serve (Harper Court, Hyde Park Shopping Center, the groceries, the Metra and Green Line stations, the Museum of Science and Industry, the Obama Center, Gleacher Center ...). `tools/build_landmarks.py` resolves each to its OpenStreetMap feature (never a typed-in coordinate: the exact OSM name in places.json, or an explicit OSM object) and checks it (within 800 m of a stop, no dashes, no duplicates; `tools/test_landmarks.py`) into `web/data/landmarks.json` (`l = [label, lat, lon, tier, kind, osm, until?]`, ~7 KB, precached). `data/static.js cleanLandmarks` loads it (optional) as `store.landmarks`; `MapApi.setLandmarks` hands it to `map/landmarks.js`.
`map/landmarks.js` draws them in the Leaflet pane `sbLabels` (z 410: above the route lines 390-402, below stops 420, buses and the trip markers; basemap text would sit under every Leaflet overlay, so the colored lines cut through its letters). After each move / zoom and each time the basemap has placed its own names (`basemap.onIdle`), labels are placed greedily in priority order (`placeLabels`, pure): centered on the building, else one of 8 sides at 4 px, else at 14 px (never farther: a name stays by its building); a spot must fit the view and cover no placed label and no stop circle, and preferably no basemap street or place name (`basemap.textAt`, MapLibre queryRenderedFeatures; only tier 1 may settle on basemap text); no spot = left out until you zoom in. Tier 1 from map zoom 14.5 (the app opens at 15), 2 from 16, 3 from 17 (2026-10-14, owner: the detailed names a little closer in); `until` hides a group name ("Max Palevsky Commons") once its buildings' names show. Text only, bold, light #2c4a66 / dark #bcd0e2 with a halo and a faint plate, `aria-hidden`, `pointer-events: none` (taps reach stops), hidden while a zoom animates. The basemap's own campus names (`sb_poi_campus`) now start at map zoom 18 and skip any name a landmark shows. The raster fallback has OSM's own names. iOS: the same file and placement rules in MapScreen (ios/README.md "Map labels").
2026-10-14 (owner): Burton-Judson Courts, International House and Vue53 (kind `housing`, off-campus apartments) are tier 1; Burton-Judson now comes before Granville-Grossman Commons, whose label 100 m away took its spot at zoom 14.5 to 15.5 (it showed in 30 of 55 test views, now 39; Granville-Grossman's name now starts at 15.75 there instead of 15).
Easter eggs (2026-10-14, owner: custom names "that pop up on the map if zoomed in very close"): `easter-eggs.json` at the repo root, `"address": "nickname"` (or `"Place name, address"` when places share one) plus `zoom` (17.5). The build (`tools/build_landmarks.py`, also run by every Pages deploy, keeping the committed file on failure) resolves each address in places.json, gives every label of that place (its OSM name: Max Palevsky's group name and its Central building) the nickname, and adds a tier 3 label for a place that had none (Chipotle on 53rd); output `eggs = [[index in l, nickname]]`, `egg_zoom`. A bad egg is skipped with a warning, never the labels. `cleanLandmarks` attaches `egg` / `eggZ`; `labelText(x, zoom)` draws the nickname from that zoom on, the name below it. Nothing goes into place search (places.json is untouched), so search speed cannot change; the swap is one comparison per label per refresh.
2026-10-15 (owner edits the file on github.com): a bare address shared by several places means the one already labeled (`find_place(..., labeled)`: 1330 E 53rd St = Vue53, not its garage; 1116 E 59th St = Harper Library, not Harper Cafe); with two labeled, the build still asks for "Place name, address". The **Map names** workflow (`.github/workflows/landmarks.yml`, on a push that changes easter-eggs.json, tools/landmarks.json or the build) rebuilds web/data/landmarks.json, commits it to main when a name changed (`build_landmarks.py --differs` ignores the build time; GITHUB_TOKEN, so no other workflow starts) and lists every nickname used and skipped in its summary: the iPhone app bundles the committed copy. Tests no longer fix the count of tier 3 names or nicknames.
Hidden stops (2026-10-15, owner: Aba at 302 N Green St in Fulton Market, the stop "inaccessible and invisible and not searchable in the system"): tools/landmarks.json `hidden_stops` count only for the build's 800 m checks; nothing of them is written (not in stops.json, route_stops.json, places.json or landmarks.json, tested), so the map, search, planner, `core/coverage.js` (Directions still refuses Fulton Market as a destination), iOS and the collector never see them. Aba itself is a curated tier 3 `ref` label (node/6256520187) with an `address`, which `ref_places` adds to the easter-egg places. The build's console output no longer crashes on an emoji nickname on Windows.
Easter-egg places may sit on basemap text (2026-10-15, owner: the Fulton Market nickname "disappears after appearing for a second"): labels are placed on `moveend`, then again when the vector basemap goes `idle` with its street and place names (`textAt`); a tier 2 or 3 name with no spot clear of them was dropped, and in Fulton Market there is none. `placeLabels` now lets a candidate with `textOk` (any label with an `egg`, its own name and its nickname) take the best spot clear of labels and stops, like tier 1; it still prefers a clear one. iOS has no street-name check (MapKit does not say where it draws them), so it never had this.
A nickname for a place inside a labeled building (within 15 m of its label, e.g. a cafe whose address is the building's) goes on that label instead of being skipped (2026-10-15: 5500 S University Avenue, Fairgrounds Coffee's address, nicknames Campus North).

### Settings > Credits (2026-10-16, owner: "At the very bottom of the settings menu, create a button that will expand a list of Credits")
The last item of Settings: a `Credits` row (`.st-credbtn`, `aria-expanded` / `aria-controls`, 44 px, chevron turns
down) expands `#st-credits` in place (`data-st="credits"` in settings.js onClick, focus stays, nothing stored:
collapsed on every open). Content = `CREDITS` in `ui/views/settings.js`, groups App / Maps / Search / Bus data, each
line `[text]` or `[text, url]` parts (text through `esc()`, links `target="_blank" rel="noopener"`, https):
App made by blobberus; OpenFreeMap tiles and style (OpenMapTiles schema); OpenStreetMap contributors (ODbL) for map
data, buildings and place names; the OpenStreetMap tile servers as the backup map; Leaflet (BSD-2-Clause), MapLibre
GL JS (BSD-3-Clause), MapLibre GL Leaflet (ISC); OSRM and Valhalla on FOSSGIS servers for walks; the on-device place
list from OpenStreetMap through the Overpass API (tools/build_places.py); Photon by komoot; Passio's public
GTFS-Realtime feeds and GTFS schedule; the collection (the same feeds every 10 s; "Data research is currently in
progress": no link to the data repo for now, owner 2026-10-16). Never a UChicago, University, UGo or administration name (owner; tested).
Same facts as About's shorter credits. iOS: SettingsView `creditsSection` (a DisclosureGroup in the last section,
its own list: Apple Maps for the map and walks instead of the web map stack).

### Lines by Time (2026-10-18, owner: "Add a clock symbol next to the settings button ... Select a time to check when certain lines will be active")
- Entry: `#timeBtn` (clock, 44 px, `data-action="time:open"`, `aria-expanded` follows the menu) left of the gear in the
  search bar. The menu is the Settings card (`ui/settings-overlay.js`, now with opts `title`, `kind` (data-kind on the
  root), `start` (a head button, here Cancel) and `end` (label + action, here Set time; default Done = close)),
  `overlayKind()` says which menu is open; the gear and the clock swap one for the other. Back / Escape / scrim close it.
- Content `ui/views/timepick.js` (loaded through main.js VIEW_IDS, optional; registers `time:open` only): Date (month +
  day wheels, no year; the day wheel follows the month, February 29 days) above Time (hour, minute, AM / PM), wheels from
  `ui/wheel.js` (spinbuttons: arrows, Page Up / Down, Home / End, a tap on a row, swipe with scroll snap; a column's own
  animation never changes its value). Under the clock the owner's sentence (`TIME_DESC`), then a live result (count +
  chips, `aria-live`), a note when a trip is in progress (Set time ends the journey so the lines can show), the
  disclaimer (`TIME_DISCLAIMER`: timetable estimate, holidays / breaks / events / detours / weather / service changes,
  scheduled night lines that send no bus, unofficial) and last `OFFICIAL_HTML` (phone + official transportation page).
  Defaults: the time already applied, else now (Chicago).
- Logic `core/timeactive.js` (pure): `pickedUnix` (the year = the next time that month / day comes, today included;
  Feb 29 in other years = Feb 28; `chicagoUnix` handles DST), `linesActiveAt(service, routes, at)` =
  `core/schedule.js isScheduledNow` per route (spans, the previous day's after-midnight tail, calendar exceptions), plus
  `outsideFeed` + a note when the date is outside `service.feed` (weekly pattern, no holidays). Kit: `TimeActive`.
- Applying (`core/custom.js applyTimeView`): `store.timeView = {at, name: "Lines active at Sat Oct 24, 9:30 PM", rids,
  before: {hiddenRoutes, activeCustom, prevHidden}}` (never persisted, not in My Routes; state.js saves `before` while it
  is on), `hiddenRoutes` = everything else, `activeCustom` null, journey and station filter ended. The context bar shows
  "Lines active at <time>" + Clear (`time:clear` = `clearTimeView`, which restores `before`, an applied custom route
  included); the Routes list's bar says "Showing <name>" + Clear. Deselecting (or adding) a line: main.js runs
  `settleTimeView` on every hiddenRoutes change, which drops the name and keeps the lines (then "Make this a custom
  route" is offered, as for any hand-made selection). Show all / Hide all / Show running / applying or saving a custom
  route end it. No line scheduled: `TIME_NONE` in the menu and as a toast, nothing changes.
- Tests: `tests/core-timeactive.js` (core.test.html), `tests/timepick.test.html`, e2e "lines by time".

### Beta feedback (2026-10-13, owner)
Web since 2026-11-05 (glass transfer): the map feedback button is a 44 tinted glass circle 8 under the Settings circle
(`#feedbackBtn` inside `#topbar`; solid tint while a chip shows, hidden at the full detent, focus goes to Settings when
it disappears) and its panel is the Settings sheet's shell; behavior, words, memory and ping rules are unchanged (see
"Glass redesign: shell contracts" and docs/redesign/NOTES-glass-web.md). The look described below (under the locate
button) is the iPhone app's and the pre-glass web's.
`ui/feedback.js`: `FEEDBACK_URL` (the only place the Google Form address appears), `feedbackLinkHTML()` (a real `<a target="_blank" rel="noopener">`, never window.open after an await), the words the feedback prompts share, and the given-feedback memory (below). Settings starts with "Beta feedback" (`views/settings.js feedbackHTML`). The map's feedback button (below) is the only prompt; nothing in ui/feedback.js runs at boot.
- Welcome popup: REMOVED 2026-11-04 (owner: "Stop the give feedback sign on every login to pop up. Keep the feedback
  button on the map screen."). It was a native `<dialog>` ("Welcome to the beta version of Straight Bussing!", Cancel /
  Go to Feedback) that main.js opened after the first render: once per browser session from 2026-10-13, at most once a
  week from 2026-11-02, never after feedback. Gone with it: `showWelcome`, `maybeShowWelcome`, `welcomeAfterPaint`,
  `welcomeDue`, `sessionStorage` `sb-welcome-seen` (it was also the tests' seam), the `.v-welcome*` CSS, and every write
  to `localStorage` `sb-welcome-log` (`{shown, feedback}`). That log is now only read: a form opened before 2026-11-02
  (its `feedback` date) still counts as feedback given. privacy.html (effective November 4, 2026) says an old browser may
  still hold those two dates; About no longer mentions a popup. Tests: tests/feedback-app.js (the real app: a first visit
  in live and demo mode, the desktop phone frame, a reload, a visit a week after the old popup last appeared, feedback
  given before 2026-11-02: no popup, and the button appears or stays gone as it should), feedback-shared.js (nothing of
  the popup left in any precached file). sw sb-v2-84.
- 2026-11-02 (owner: "Make the feedback request notification a little more noticable (using different colors etc).
  Emphasize how it would be very helpful. Would it be possible to make this request only occur every once in a while
  and not every time the user reloads the site?" and "In the settings menu, the beta feedback should also be more
  prominent"): one look for the Settings card and the map button's panel (and, until 2026-11-04, the popup): the accent
  tint `--accent-bg` (tokens.css: light #d9e7f8, dark #223042; never the green live color), `FEEDBACK_ICON` (speech
  bubble, white on an `--accent-fill` disc, aria-hidden), the bold ask `FEEDBACK_LEAD` "Your feedback would be very
  helpful.". Settings: "Beta feedback" stays first; a tinted card with the icon + ask, `FEEDBACK_LINE`, Give feedback as
  the card's primary button, the privacy note. Tests: tests/feedback-shared.js (wording, the memory, contrast in light
  and dark, Settings card, privacy wording). sw sb-v2-81.
- The map's feedback button (2026-11-02, owner: "Add a small notification button (still noticable) under the
  navigation arrow button under the right side of the search bar. This notification should ping every once in a
  while. Pressing it should reveal a menu that looks similar to the settings overlay menu which explicity requests the
  user for feedback. Put a notification under it that if the user gives feedback, the notification button will
  disappear. The app should remember if a particular user has already given feedback (or pressed the link).
  Alternatively, underneath the send feedbakc button, there should be a smaller less noticable button which can say: I
  already gave feedback. Which will silence the notification entirely. A silenced notification will entirely remove
  the button from the navigation screen."). `ui/feedback-button.js`, `#feedbackBtn` in index.html (`hidden` until the
  module, imported by main.js after the first render, shows it):
  - Look (css/base.css `.fbfab`): the locate button's 44 px size and `--r-control` shape, 8 px under it, hidden with it
    at the full detent; the accent tint `--accent-bg` (the feedback card's color, never green) with the speech bubble
    in `--accent` (4.3:1 light, 4.7:1 dark, a graphic needs 3:1) and a 10 px `--accent` badge dot ringed in the tint.
    Accessible name "Give feedback", `aria-haspopup="dialog"`, `aria-expanded` follows the panel.
  - Ping: two soft ring pulses on the badge (`PING_MS` 2.6 s, transform + opacity), the first `PING_FIRST_MS` (20 s)
    after start, then every `PING_EVERY_MS` (3 min), at most `PING_MAX` (4) per page load. A due ping waits
    (`PING_RETRY_MS` 15 s) while a trip is in progress, the sheet is at the full detent, the overlay or any dialog is
    open, a text field has focus or the page is hidden (`pingBlocker`, pure; `nextPingIn`, pure). Reduced motion: no
    class is added (and base.css stops the animation): only the static badge.
  - Panel: the Settings overlay shell (`openSettingsOverlay` kind `feedback`, title "Beta feedback", Done; Back,
    Escape, Done or a scrim tap close it (the scrim also covers the button, so tapping it again closes the panel;
    `open()` toggles for keyboard and script callers); focus returns to the button): the tinted card
    with `FEEDBACK_ICON`, `FEEDBACK_LEAD`, `FEEDBACK_BODY`, the primary "Send feedback" (`feedbackLinkHTML`, the form in
    a new tab), under it `FB_GONE` "Once you give feedback, the feedback button on the map disappears.", then outside
    the card the quiet text button "I already gave feedback", then `FEEDBACK_NOTE` + `FEEDBACK_IN_SETTINGS` in fine
    print (2026-11-04: `WELCOME_BODY` / `WELCOME_NOTE` renamed with the popup gone, same words).
  - Memory (`ui/feedback.js`): `localStorage` `sb-feedback-done` = `{how: "gave" | "silenced", at}`. Opening the form
    anywhere (Send feedback, Settings > Give feedback: `noteFeedbackOpened`) records "gave", "I already gave feedback"
    records "silenced" (`markFeedbackDone`; "gave" always wins); a form opened before 2026-11-02 (the old popup log's
    feedback date, read only) counts as "gave". `feedbackDone()` set = the button is removed at once (bus
    `feedback:done`), in other open tabs too (`storage` event) and on every later visit; Settings > Give feedback always
    stays. Storage blocked: remembered for the rest of the page load. A toast confirms ("Thank you for helping. Give
    feedback stays in Settings." / "Feedback button removed. Give feedback stays in Settings."); focus moves to the
    locate button.
  - Shown in live and demo mode. Test seam: `sessionStorage` `sb-feedback-btn-off` = "1" (e2e.js, e2e-demo.js);
    tests/feedback-button.js (rules, schedule, reduced motion, panel, both choices, reloads, other tabs, blocked storage,
    CSS in light / dark, the real app) and feedback-app.js clear it. iOS: the same button (RootView `FeedbackButton`,
    `FeedbackSheet`, UserDefaults `sb.feedbackDone`), ios/README.md. sw sb-v2-82.

### You on the trip map + trip alerts (2026-10-13, owner: "the Current Trip map should show the user's location in the current trip's location (especially for bus routes). Make this sync to the notification center's get off in X stops")
ONE evaluation of the followed trip per data change, `core/tripprogress.js tripNow(state, nowS)` (memo: same journey,
buses, trips, user, stops, routeStops, feed fields and `now` within `TRIP.MEMO_S` 10 s), feeds the Current trip card
and timeline (ui/views/tripprogress.js), the map (ui/tripmap.js) and the alerts (ui/notifier.js): they can never show
different stop counts. One wording, `core/tripyou.js`: `offText(stopsLeft, alight)` "Get off here: X" / "Get off at the
next stop: X" / "Get off in N stops: X" (card, alert title, Settings line), `offShort` for the map label, `legStatus(leg)`
(before boarding "Bus 101 is 2 stops away" / "is approaching X" / "is at X"; on board offText).
```js
// core/tripyou.js (pure; iOS Kit TripYou.swift ports it 1:1)
YOU = {FAR_M:300, GPS_ACC_M:100, NEAR_BUS_STOPS:3}
tripYou(p, state): null | {phase, active, lat, lon /* null = unknown, no marker */, source:'bus'|'gps'|'stop'|null, onBus, far,
  vehicleId, label, busLat, busLon, stopsAway, stopsLeft, board, alight, target:{id, name, lat, lon, role:'board'|'alight'|'dest'}|null,
  frame:[[lat, lon]...], text}
// on the bus: the bus position (onBus), unless your accurate GPS is > FAR_M (+ accuracy) from it: your GPS, far:true
// ("Your location is not near Bus 101. Stop counts follow the bus." on the card); walking: your GPS; waiting: GPS, else
// the boarding stop (source 'stop', drawn dashed "You (est.)"); arrived: GPS; target = boarding / alighting stop /
// journey.dest (planJourney writes it)
```
Map (`MapApi.setTrip(you)`, `MapApi.inView(points)` -> true/false, null when the sheet covers the map): on the bus an
accent ring + "You" pill on the bus marker itself (it glides with the bus) and the GPS dot steps back (`.sb-you-onbus`);
a marker of its own when the bus is not drawn or for the boarding-stop guess; labels "Board here" and the get-off
count `offShort`, under their stops (the destination pin and the You pill sit above their points). `ui/tripmap.js startTripMap(store, map)`: follow camera
on at Start and via the locate button during a trip (`recenter`), off when the rider drags or zooms; frames
`you.frame` on a phase / leg change or when a framed point leaves the view (not within 2 s of the last fit), waits
while the sheet covers the map and frames on the next `sheet:inset`.
Alerts: `notify.trip` (default true, Settings > Bus alerts "Trip alerts"); the 2 stops / 1 stop / minutes / in-app choices
time station and trip alerts alike and show without a station. Keys: board kinds per (trip, leg, followed vehicle),
off kinds per (trip, leg) (a trip id roll never repeats them). Station alerts pause while `tripAlertsOn` (Settings
status "Paused during your trip: alerts follow your trip's bus."). Live data down by the feed's own evidence (a failed
poll, or a fresh poll of a feed older than 5 min; never data that only aged while polling paused): one "Live data delayed" alert per outage (requirement conversion to appstore.md section 7).
System notifications end with " Unofficial."; Start asks for notification permission once (`Notification.permission`
'default', from the tap). Polling stays on in a background tab when a station or a trip with trip alerts is armed and
notifications are allowed (`startNotifier().background()`).
Web: `ui/notifier.js` (SETTINGS) watches the store while the page is open and delivers ONE alert per trip + kind (2026-10-10, `deliveryFor({front, perm, inApp})`): the in-app banner (bus 'toast') while the page is visible and focused, a silent browser Notification (service-worker `showNotification` fallback) while it is in the background and the user allowed them; a notification that cannot show falls back to the banner; the "In-app alerts while open" switch turns the banner off. `startNotifier(...).background()` (station set + permission granted) makes main.js keep polling in a background tab (`startLive` keepAlive). Settings wording follows iOS (permission lines "Alerts show as a banner while you use the app, and as a notification while it is open in the background." / "Notifications are off" + why; footer "Alerts work only while Straight Bussing is open; ..."); it never claims to work once the page is closed. Settings is a modal overlay (`ui/settings-overlay.js`, SETTINGS) opened and toggled by the top-right gear (action `settings:open`): it lifts the sheet to "full" and covers the WHOLE sheet (grab, title, tabs: owner wants nothing of Plan Trip to look like part of Settings), a scrim (`.sto-scrim`) dims what is still visible behind it and closes Settings on tap, the sheet header and content are inert; "Done" top right; also covers the bottom navigation (`#tabs` inert, `navBottom` in `overlayBox`); closes on Escape / navigation / the sheet leaving full, traps focus and restores the previous detent. View id `settings` is a compatibility shim only.
| SETTINGS | ui/views/settings.js, ui/settings-overlay.js, ui/notifier.js, core/notify.js, css/settings.css, tests/settings-* + settings.test.html |
| IPHONE | `conversion to appstore.md`, docs/IOS.md, docs/APPSTORE.md |

### Heading cone on the location dot (2026-10-14, owner: "the tracking dot should have a direction based on the user's heading")
`ui/compass.js createCompass({onHeading})` (main.js owns it; tests `tests/map-compass.js` in map.test.html). Sources, best
first: the compass (iOS Safari `deviceorientation` + `webkitCompassHeading`, Chrome / Android `deviceorientationabsolute`
= 360 - alpha; a relative alpha is ignored), + the screen angle in landscape; else the GPS course (`coords.heading`) while
moving >= 1 m/s; else no cone (the plain dot). iOS 13+ shows the compass only after `DeviceOrientationEvent.requestPermission()`
inside a tap (Safari's "Motion & Orientation Access" prompt). One tap shows at most ONE system prompt (2026-11-02, owner:
"There are two requests for locations when the user decides to press share location/use my location ... If this is not
absolutely needed and can be completed with one notification to the user, do so"): main.js `askCompass()` calls
`compass.request()` synchronously from `locate()` (every tap that asks for the location) and the locate button only
when `mayAskCompass(store.locState)` (location already `granted`, so no location prompt can show in the same tap);
never at launch (`locate({auto: true})`), at most one request in flight, never again once readings come. So the first
share / locate tap shows the location prompt alone; a blocked or switched-off location (Settings > Stop sharing) never
reaches it. Since 2026-11-04 (owner: "The build no longer shows the user heading. Allow the app to display user
heading."; riders rarely tapped the locate button a second time, so the cone never appeared) the FIRST TAP ANYWHERE
once location works asks too: main.js `askCompassOnTap`, a capture-phase document click listener, once per page load
(`compass.request()` resolves granted / denied / error / skipped; an error, i.e. not counted as a tap, lets the next
tap try again). That tap's only system prompt is the motion one; iOS keeps the answer for the session. Without the compass the cone still follows the GPS
course while moving. Android / Chrome need no prompt for the sensors. Test: `tests/e2e-locprompt.js` (e2e.test.html). On while location sharing is on
(`start` after a fix, `stop` in `stopLocation`), listener off while the page is hidden. Readings never enter the store:
coalesced to one per animation frame, passed on only on a turn >= 2 deg or a width change, straight to
`MapApi.setHeading(deg, spread)`. Width = 2 x the compass's stated error, 40..120 deg (60 when the source gives no
accuracy; a negative accuracy means no heading, as in CoreLocation, whose values iOS Safari passes on). The map turns the cone the short way round (`geometry.unwrapDeg`,
0.15 s, none with reduced motion); the cone hides with the dot (on the bus, no location). Nothing is stored or sent
(privacy.html "The way you face"). iOS: ios/README.md "Heading cone".

### Alerts that name a route by Passio's own id (2026-10-16, DC-009, rider safety)
Passio's service alerts can name a route by its internal id, which is the GTFS `shape_id` of that route's trips (the
North alert of 2026-10-14 named 38734; North is route 1075). `tools/build_gtfs.py` `route_aliases` adds each route's
shape ids to `routes.json` as `alias_ids` (left out: a shape two routes share, or one equal to a route id), and
`data/static.js` keeps them as a clean string list. `core/arrivals.js` `alertRouteIds(alert, routes)` is the one mapping
from an alert to routes: an informed route id that is a route, else the one route listing it as an alias (two: neither),
unknown ids dropped. Users: `views/route.js` renderService (Schedule changes), `views/alerts.js` operatorAlerts with a
route (only alerts tied to no known route, so an unmatched one is never lost on route pages) and the Alerts list chips.
iOS: Kit `Route.aliasIds` (StaticLoader decodes `alias_ids` leniently: a bad list never costs the route),
`Arrivals.alertRouteIds`; App RouteDetailView.routeAlerts, AlertsView chips, OperatorAlerts / NoBusHelp `untiedOnly`.

### Destinations farther than 800 m from a stop: a note, then the trips (2026-10-15, owner)
First "If a search query for destination doesn't have a proper stop or address within range, say: Sorry, ...", then
the same day "Change the 800m+ distance restriction to telling the user about the constraint, but still giving a method
to reach the location. Under the notification, state: Straight Bussing recommends changing to another mode of
transportation after arriving at the closest destination. Then proceed to give the trip methods underneath like before."
`core/coverage.js` `covered(state, point)`: a stop, or within `COVER_M` = 800 m (straight line) of a stop some route
serves (`routeStops`); always true before the schedule loads or for a point without coordinates. Directions: search
and planning are as before (every place is suggested; the planner's 1600 m end walk, else walk the whole way). When the
destination (set any way: search, Swap, My location) is not covered, the results start with a `role="status"` note
(`coverNoteHTML`, `.v-note.v-cover`): `COVER_TEXT` ("Sorry, Straight Bussing only covers locations within 800 m of the
campus shuttle routes.", the owner's sentence without "UGo", his choice) and under it `COVER_ADVICE`, then the trip
options (after the trip bar and the stale warning). The start never gets the note. Current trip's and Routes to
station's place searches are unchanged. About a third of places.json (638 of 1,921) is outside. iOS: Kit
`Coverage.swift` (`text`, `advice`), DirectionsView `coverNote`.

### Custom routes interaction (2026-10-08)
Tap a custom route row = show it on the map / stop showing (`mr:toggle`, no navigation). Swipe left (or the row's "More" button,
`mr:swipe`) = action tray Details (`mr:details`, no apply) / Edit / Delete. Every delete goes through `ui/confirm.js`
`confirmDialog({title, body, confirmLabel, danger})` -> Promise<boolean> (native `<dialog role="alertdialog">`, Cancel focused,
Escape / backdrop cancel; settles from the button itself, not the async close event).

Saved routes always listed (2026-10-17, owner: "Hidden routes in the my routes folder should still display if they are
not running"): a custom route's detail lists every saved route (the list never filtered by running or visibility;
checked in the real app with demo buses and a 15-route set, 2 hidden). Each row now says why there is no bus:
`savedRouteStatus` = live buses / Scheduled, no live location / `restingText` ("Not running now · Scheduled from
4:00 PM today" from `core/schedule.js` `nextStartToday`, "No more service today", "Not running today"), plus
"Hidden on map" (or "Not on this trip" in a journey) when hidden; a hidden route shows no arrival time. Never a live
time without a bus. core/visibility.js still keeps hidden routes off the map and the arrivals. Also fixed: "2 buss
running". iOS: Kit `Schedule.nextStartToday` / `Schedule.restingText`, `CustomRouteLine`.

### 2026-10-09: stutter fixes, map credit, self-update
- Sheet geometry: the sheet element is always `--v-max` tall (offset and content padding use `--v-max`); `--v-full` depends only on
  the status pill (`--pill-h`, measured by a ResizeObserver in main.js). The context chip never changes the detent; it fades out at
  the full detent. Selecting / clearing a custom route moves nothing (0 layout shift at half and full).
- Map credit (`js/map/credits.js`, replaces Leaflet's attribution control): "OpenFreeMap · OpenMapTiles · OpenStreetMap" as links,
  no copyright sign; plain small text (no bubble, no (i) button: owner request 2026-10-09) at the bottom-left above the sheet
  (positioned by `setBottomInset`), shown at load and faded out for good after 5 s (held while hovered / focused), hidden at the full
  detent. Settings > About keeps the full credits (OpenStreetMap ODbL, OpenMapTiles, OpenFreeMap) so they stay findable, which the
  OSMF Attribution Guidelines ask for once the on-map credit disappears. `fitTo` uses `flyToBounds`.
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

### 2026-10-09 (evening): map view stays put, scrolling context bar
- Camera rule: only choosing a route moves the map (Routes list / route chips `route` + `route:open` -> `fitTo` its shape; a custom
  route; a trip plan; Routes to station; the locate button; a chosen place). Opening a stop (map tap, list row, `stop:open`) selects
  it without flying; a bus tap opens its route WITHOUT fitting (main.js `openRoute(rid, false)`). iOS `AppModel.push(.stop)` likewise.
- Context bar (`ui/contextbar.js`): text that does not fit scrolls Apple Music style (`startMarquee(el, {reduced})`, Web Animations
  on `.ctx-run`): rests `MARQUEE.restMs` (3.5 s) at the start, glides at `MARQUEE.pxPerS` (32) until an aria-hidden copy sits where
  the text began, loops; re-measured on draw and resize (ResizeObserver); mouse hover pauses; still (ellipsis) with reduced motion.

### 2026-10-10: empty live feed during scheduled service (rider safety)
Collected data showed the Passio feed fresh but empty from about midnight to 4:30 AM while service.json has the night routes
(North / South / East) in service until ~4:29 AM: the buses run without GPS, or service ends early; we cannot tell which. Wording
(web `core/operating.js` + iOS Kit `Operating`, same text):
- **Scheduled, silent** (`silentService`): pill (warn) "No shuttles are reporting live locations"; Current trip / Directions empty state
  "No live locations right now" + `silentText` ("The schedule shows the North and East routes in service until 4:29 AM and the South
  route until 4:25 AM, but no bus is sending its location, so we can't confirm they're running. Call 773.702.8181 before you rely on
  them.") + official link; stop cards "No live times right now"; stop view names only that stop's visible scheduled routes; Routes
  group "Scheduled, no live location" with rows "Scheduled until 4:29 AM, no live location" (also per route while other buses run);
  route detail status the same + one explaining line; My Routes rows and editor group likewise.
- **Nothing scheduled now** (fresh feed, no bus): "No shuttles running right now" (the honest case, unchanged).
- **Feed outage** (`liveUnknown`): unchanged ("Live times unavailable", "Live status unknown"); it wins over the rules above.
Hidden routes still prevent the "no shuttles" claim but are not named ("Some hidden routes are scheduled now, ..."). `renderRoutes`,
`listHTML`, `groupRoutes` (now `{running, scheduled, idle, hidden}`) and `renderEditor` take an optional `now` (tests).

### 2026-10-10: web parity with the iPhone app (ios/README.md "iOS has, web missing")
- **Routes list**: a "Not running" row adds today's scheduled hours (`routes.js idleText`: "Not running · Today 7:00 AM to
  11:30 PM", `hoursOn` label, nothing added on a no-service day), like iOS RouteRow.
- **Retry is the pill's first control** (owner 2026-11-03): `#pillRetry` sits at the pill's LEFT end with a fixed width. During a trip
  the context chip under the pill ends the trip with its right-hand "Show all"; when Retry succeeds the pill hides and the chip
  moves up into its place, so a Retry at the right end put "Show all" under the finger for a second tap. Now a tap at Retry's old
  spot lands on the chip's label, and main.js also ignores context-chip taps for `RETRY_GUARD_MS` (1 s) after a Retry tap
  (capture-phase guard). iOS: the same (`StatusPill` Retry leading, `AppModel.contextBarGuarded`). Test: e2e.js "Retry sits on
  the left". **Web since 2026-11-05 (glass transfer):** the compact banner keeps Retry in a fixed 84 x 44 slot at its leading
  edge and holds still for `RETRY_HOLD_MS` (2.5 s) after the last tap ("Live data is back." with Retry absorbing taps), so
  the trip chip never slides under the finger; that replaces the 1 s context-bar guard on the web ("Glass redesign: shell
  contracts", e2e "Retry tapped again and again during a trip").
- **Status pill** (`ui/pill.js`, out of main.js): `pillState(s, now, {bootS, graceS})` -> `{kind, icon, msg, retry, alert}` with icon
  `feed` (error) / `delay` (late, old) / `silent` (scheduled, no live locations) / `idle` (no shuttles); `createPill(els)`
  renders it into `#pill` (`#pillIcon` slot, aria-hidden) and keeps `--pill-h`. Words unchanged.
- **Bus alerts**: one delivery per alert (Settings section above).
- **Directions**: live updates re-plan through `core/throttle.js` `createThrottle(run, {everyMs, gate, now, later})` at most every
  `DIR_REFRESH_S` (8 s, iOS dirRefreshS) with one trailing run (the newest data is never dropped); skipped while the feed fails,
  deferred while a new-endpoint plan still refines; the picked card is kept by key and the map never moves. `directions.js`
  exports `liveReplan` and `deps.wallMs` / `deps.later` (test clock).
- **Demo mode** (`core/demo.js` DEMO = `?demo=1` exactly; nothing else turns it on, nothing is stored): main.js starts
  `ui/demo.js startDemo(store, startLive)` = `startLive(store, {intervalMs: 5000, fetch: demoFetch(store)})`; no banner since
  2026-10-11 (the status pill says "Simulated buses", see below); no notifier, no service worker registration; sw.js never caches
  `?demo` requests; storage writes stay in memory; Settings says "Bus alerts are off in demo mode: the buses are simulated."
  Tests: `tests/demo.test.html` (real app at index.html?demo=1, no stubs), `tests/data-demo.js`.
- **Accessibility**: the grabber is a slider (ui/sheet.js above); route detail stop buttons carry one label "Name, next bus in
  N min" / ", no prediction" (+ ", a bus is heading here, seen N min ago"), everything else in the row is aria-hidden.
- **Map**: `css/map.css` `--sb-accent` = `var(--accent-fill)` (light) / `var(--accent)` (dark), no separate map blue.

### 2026-10-11: web bug sweep (rider safety, offline shell, flaky tests)
- **No bus reports** (feed down, silent feed, nothing running): Current trip, stop, Routes, route detail (alerts not tied
  to a route) and Directions add `ui/views/alerts.js operatorAlertsHTML(state, now, {rid?, max=2})` ("From the shuttle
  operator", the alert in full, then "All N service alerts") before the official links. The live feed's standing alert
  gives a number to call when buses do not show. `alertBodyHTML(text)`: escaped text with phone numbers as `tel:` links
  (Alerts view too). The status pill offers **See alert** (`#pillAlert`, action `alerts:open`; `pillState().alert`) on
  the silent / no-shuttles pills when an alert is active, like iOS; never on a feed error (Retry).
- **Service day after midnight**: `core/schedule.js serviceHoursAt(service, rid, unixS)` -> `{hours, dayKey, yesterday}`
  (iOS Kit Schedule.serviceHoursAt). Route detail reads "Friday service 6:30 AM to 12:25 AM · Scheduled now" in a
  route's after-midnight tail (never "Today No service · Scheduled now"); the buses-by-hour chart follows that day.
- **Trip following** (`core/tripprogress.js`, ported back from the iOS sweep): the trip id alone never lends another
  vehicle's predictions to the planned vehicle; a planned vehicle on a new trip id past the boarding time (loops roll
  the id) is the bus you ride; the missed-bus note never promises a next bus that is not there and also shows on the
  walk to the stop. A stop's "Directions to here" / "From here" end a started trip (they used to re-target it).
- Routes to station rows: `pick.js walkShort(d)` "2 min walk (119 m) · North, East" (one middle dot).
- Demo mode: Settings shows no "Allow notifications" (alerts are off). A map that cannot load logs `console.warn`.
- Map: `patchStyle` drops the dark style's `fill-pattern: wood-pattern` (missing from the OpenFreeMap sprite; console
  warning, no woods) so the palette's wood color paints.
- Offline shell: PRECACHE gains privacy.html and support.html; `tools/test_precache.py` (also in `pages.yml`) keeps the
  list complete. Verified: with the server down, a profile that ran the app once serves /, privacy.html and
  support.html from the cache and boots the app.
- Tests: `ui/contextbar.js mountContextBar(el, store, {reduced?, frame?, cancelFrame?})` (frame scheduler seam; the
  marquee test measures on a timer because headless Edge can withhold animation frames for seconds); the e2e camera
  check ends earlier glides instead of waiting for them; `tools/run_browser_tests.py` fails tiles.openfreemap.org
  requests at once (PAC proxy; virtual time stands still while a fetch is pending, and slow tiles stalled e2e pages
  until the runner timeout). `map.test.html` keeps the network for its live style check.
- **Chicago time on every device**: `core/time.js clock()` formats in America/Chicago (the locale's 12 / 24 hour
  choice stays), `shortDate` / `sameDay` give the Chicago date and "today" for alert windows (Alerts, Settings) and
  About, so a phone elsewhere never shows "Arrive 4:37 AM" next to "6 AM to 11 PM" (`tests/zone.test.html` runs as a
  Los Angeles device via `zone-sim.js`; iOS Kit `TimeFmt.clock` / `LiveText.alertWindow` same). `map/geometry.js
  alongShape` drops repeated shape points first: a zero-length or one-point shape line never wins the line pick and
  sends a ride to the straight fallback (Kit Geometry.swift same). sw `sb-v2-34`.

### 2026-10-11 (owner decisions): demo pill, the next bus at the half detent, operator phone
Same spec for the iPhone app (another agent ports it to `ios/`). sw `sb-v2-36`.
- **Demo mode without a banner**: `#demobar`, `html.is-demo`, `--demo-h` and `--z-demo` are gone. The status pill is the one
  quiet, honest indicator: `ui/pill.js pillState(s, now, {bootS, graceS, demo})` -> `{..., demo:true, kind:'info', icon:'demo'
  (flask), msg: core/demo.js DEMO_PILL "Simulated buses"}` on every screen (a feed error or delay still wins); `createPill(els,
  {demo})` adds `.pilltap` (`data-action="demo:info"`, info mark; its `::after` makes the whole 44 px pill the target).
  `ui/demo.js` registers `demo:info`: `confirmDialog({title: "Simulated buses", body: DEMO_BODY + " Nothing you change in the
  demo is saved.", confirmLabel: "Show live buses", cancelLabel: "Keep demo"})` (ui/confirm.js gained `cancelLabel`, default
  "Cancel"); yes -> `demoDeps.go(exitDemoHref(location))` (reload without `?demo=1`). The simulated feed has no service
  alerts (owner, 2026-10-11: the pill is the one demo indicator; iOS DemoFeed matches). Demo state is still never stored.
- **Current trip order** (`ui/views/nearby.js`, regions `nearby-alert|trip|next|loc|alt|results`, patched from one table):
  1. the alert row, ONE line (`alerts.js alertBanner`: icon, "Service alert: <first title>" cut with an ellipsis, chevron; the
  full title is in its label); 2. the trip in progress (`entryHTML`: timeline + Trip steps + "Routes to station…", as before),
  '' with no trip; 3. **the next bus** (`nextHTML`): with location or a typed place, the nearest stop (`.pt-next` card: the
  name, never cut, with "N min walk" on its right, then up to 3 arrivals in 52 px rows with the live / schedule labels and
  "Leave in N min, est." as before), followed by why + who to call when no bus reports; without either, the Favorites card;
  4. "Use my location" (the one primary action) only without location; 5. "Search stations" + `altHTML` ("Type an address
  or place" and, with no trip, "Routes to station…", link-style secondary actions); 6. the rest (`bodyHTML`: favorites when
  a nearest stop leads, "Also nearby", the walking-estimate note, or "Arriving soon") and `NO_TRIP_HINT` as a quiet last
  line ("No trip in progress" is no longer a card). Checked in a 393 x 852 phone (`tests/e2e-current.js`): alert row + stop +
  3 arrivals end above the bottom navigation at the half detent; at 320 px the walk drops under the name. The row builders
  moved to `ui/views/nearby-cards.js` (guidedRow, pickArrivals, favoritesHTML, soonest; nearby.js re-exports them).
- **No-bus calls** (`alerts.js`): `operatorPhone(state, now, {rid})` -> `{text, tel}|null`, the first phone number in the
  active alerts (title, then description), exactly as written, never 773.702.8181, never hardcoded. `callsHTML(state, now,
  {rid, primary})`: with a number, "Call bus route help: <number>" (primary style unless the screen already has its one
  primary action: Current trip's "Use my location", a stop's "Directions to here"), then "Safety or urgent: 773.702.8181"
  (secondary) and "Official transportation page"; without one, the usual official line (773.702.8181 stays the call).
  `noBusHelpHTML` = `operatorAlertsHTML` + `callsHTML` replaces `operatorAlertsHTML + OFFICIAL_HTML` on Current trip, stop,
  route detail and Directions; Routes puts the calls with the alert and then drops its bottom official line (since 2026-10-17, owner: Routes keeps
  the alert at the top and moves the calls and the official page to the bottom, under every route, as its one bottom block). The operator's
  text stays verbatim (including "UGo"). `core/operating.js silentText` still names 773.702.8181 (shared with iOS; unchanged).
- Unchanged by decision: walking times carry no "est." label.

## Buses ride their route line (2026-10-18, owner: "the bus location should update smoothly without exiting the borders of the roads and the station lines they follow")
- `map/track.js` (pure, tests `web/tests/map-track.js`): a fix within `ON_M` (40 m) of its route's shape (`store.shapes[rid]`, the
  drawn line) is drawn on the line; `follow(prep, from, at, pt, {bearing, dt})` returns the new place and the way there through
  the line's own points (`walk`). The pass that continues from where the badge is wins (out-and-back streets and loops pass one
  point twice), within `SPEED_MPS` (22 m/s) x the time since the last report + `SLACK_M` (400 m); a step back up to `BACK_M`
  (30 m) is jitter and stays on the line; a new badge takes the closest pass, the one heading the feed's way when two tie (+25 m
  for a pass running the other way). Off the line (a detour, the garage) the fix is drawn as is. On 2026-10-14's polls 87% of
  fixes were within 40 m of their line (median 3.8 m); most of the rest are over 100 m off (buses away from their route).
- `map/layers.js createBusLayer`: no CSS glide on the badge any more; a requestAnimationFrame loop moves it along the path:
  a normal poll at constant speed over `GLIDE_MS` (9 s), a catch-up (over 350 m along the line, or after more than 30 s without a
  report: a reload, a feed gap) eased in 0.9 to 2.6 s (`moveTiming`); off the line a straight glide up to 150 m, longer = a jump.
  The heading triangle turns with the street (`headingAt`, short way round); a new badge with no feed bearing takes the line's
  direction. Frames pause while Leaflet animates a zoom (`zoomstart` / `zoomend`); prefers-reduced-motion moves at once.
  `createBusLayer(map, cb, {clock, frame, reduce})` takes a manual clock and frame queue in tests; `shown(id)` = the drawn spot.
- When bus data drops out: `data/live.js` keeps the last bus list for ONE poll that answers with no bus at all while buses
  reported in the last `EMPTY_HOLD_S` (30 s) (Passio sends odd empty lists, DC-015); the next empty answer is believed, so
  "No shuttles are reporting live locations" is at most one poll late. On the map a bus missing from a poll while others still
  report keeps its badge for `MISSING_S` (45 s) and then continues along its line; a poll with no bus at all clears the map at
  once (the map never shows buses while the pill says none report); a route the rider hides goes at once.
- iOS: Kit `BusTrack.swift` (the same rules and numbers, `BusTrackTests` incl. a golden file the web JS computed on real reports) and App `Model/BusMotion.swift` (steps the badge along the path; `missingS` = MISSING_S); Kit `LiveState.emptyHoldS` = EMPTY_HOLD_S (`LiveHoldTests`); ios/README.md parity matrix.

## Buses that do not follow their route (2026-11-04, owner: "If buses are not following their routes for a long period of time (measure this by the bus operation data and their listed hours), remove them from the map. Do this for both the experimental and nonexperimental build.")
- Measured first (RouteKnower.md E27, `experiments/routeknower/E27-scripts/`): 25 days of archived raw polls (Oct 10 to Nov 3,
  1.54 M fresh reports, 4,355 bus-hours), each day's route lines and listed hours, the logged arrivals and alerts. Inside the
  listed hours buses are within 300 m of their line 95.9% of the time. Buses that really serve riders can be far off it for a
  long time: the Downtown Campus Connector 2.5 km off Lake Shore Drive for up to 32 min (Oct 22, every DCC bus), the
  Apostolic bus on its 8 AM run to the 57th Street Metra station (920 m, 23 to 30 min, every weekday, along another line). The
  buses that do not operate are mostly at the operator's garage (41.82, -87.64; 105 of the 109 runs the rule hides).
- `core/offroute.js` (pure; tests `web/tests/core-offroute.js`): OFF the route = farther than `OFF_M` (300 m) from its route's
  line (store.shapes) AND from every other route's line. The clock starts at the first such report (the bus's own report time,
  never the phone's) and restarts within 300 m of any line, on a route change, or after `GAP_S` (10 min) without a report.
  HIDDEN at `HIDE_IN_S` (15 min) inside the route's listed hours padded `HOURS_PAD_S` (30 min) at both ends (service.json via
  core/schedule.js isScheduledNow; no schedule data counts as inside), at `HIDE_OUT_S` (5 min) outside them. Never hidden
  while the closest points of its line have spread `FOLLOW_M` (1.5 km) since the clock started (following its route on
  another street), while it is `RETURN_M` (1 km) or more closer to its line than its farthest point (heading back: leaving the
  garage), nor inside the listed hours while an operator alert is active that names its route (any text, alias ids too) or
  names no route and matches `DETOUR_RE` (detour, reroute, closed, blocked, construction, ...; the standing "UGo Bus Route
  Assistance" alert does not match). Back within 300 m of a line = shown at the next poll.
- Applied in `data/live.js` after core/operating.js: `offRouteStep` once per vehicle poll on the operating buses (the clocks
  live in the poll loop, `offTracks`), then `dropHidden` takes the hidden buses out of store.buses AND their trip updates out
  of store.trips (by vehicle id), so the map, "Where the buses are", arrivals, counts, bus alerts, the planner and the trip
  view agree; Passio kept predicting the Nov 2 garage-bound buses (DC-022: 830 prediction rows). Silent-service trip updates
  with no bus are untouched. Before static data loads nothing is hidden; after a reload the clocks start again (a missed hide
  for up to 15 min, never a wrong one). Demo buses ride their lines and are never hidden.
- Numbers (25 days): 835 bus-min hidden, 33 a day; 643 of them buses going to the garage after service, 131 never serving,
  21.5 leaving the garage, 39.1 two parked breaks between trips (a Red Line bus at the garage, a DCC bus parked 1 km off at
  Museum Campus); 0.5 bus-min within 2 min of a logged arrival; no moving detour or Metra run hidden. DC-022 (Nov 2): Central
  hidden from 00:11 (its hours had ended), North from 00:23, East from 00:27.
- iOS: Kit `OffRoute.swift` (same rules and numbers), applied in `LiveState.applying` (`offTracks`, `offHidden`), `OffRouteTests`
  incl. the web's answers on real polls (`Fixtures/offroute_golden.json` = `web/tests/fixtures/offroute_golden.json`, made by
  `experiments/routeknower/E27-scripts/make_golden.py`, answers from `web/tests/offroute-golden.html` in headless Edge).
- Experimental build: port `web/js/core/offroute.js` as is, the `data/live.js` lines that call it, `web/tests/core-offroute.js`
  + the fixture; sw cache bump.

## Idle buses that are not in service (2026-11-06, owner: buses parked "in front of Regenstein library" at 11:50 still showed "as traveling buses"; "avoid showing buses that are not active yet are idle", and "the app doesn't suggest these trips")
- Measured first (RouteKnower.md E28, `experiments/routeknower/E28-scripts/`, labeled data `data/labeled/end_of_service/`):
  27 days of archived raw polls (Oct 10 to Nov 5, 7,982 dwell episodes: a bus within 80 m of where it stopped for 3 min
  or more), each labeled from what the bus did next (layover 6,756, break 504, end_of_shift 448, garage_return 94,
  parked_never_served 180). The owner's 11:50 PM buses were the NightRide buses at the Reynolds Club stop on 57th Street
  beside Regenstein (North 4328, East 4325, Central 4313), South at Burton-Judson and two Apostolic/Drexel buses at
  Goldblatt: every night their last layover before midnight looks exactly like the ones every 30 min before it (same
  spot, same Passio predictions for the next trip), then they drive to the garage and the feed drops them at about
  12:05 AM (DC-023 item 5). Passio keeps predicting parked buses (113 of 116 Downtown Campus Connector shift ends), so
  predictions alone cannot tell; normal layovers last up to about 25 min (p99), some without any prediction.
- `core/idle.js` (pure; tests `web/tests/core-idle.js`, real polls `web/tests/fixtures/idle_golden.json` from
  `experiments/routeknower/E28-scripts/make_golden.py`): STILL = the bus's reports stay within `STILL_M` (80 m) of its
  first report there (parked GPS jitter is up to about 16 m); the clock restarts farther away, on a route change, or after
  `GAP_S` (10 min) without a report. A still bus is HIDDEN when: PARKED still `PARKED_S` (90 min) whatever Passio
  predicts; IDLE still `IDLE_S` (30 min) with no Passio prediction `FUTURE_S` (2 min) or more after its report; PAST still
  `LINGER_S` (3 min) and more than `PAST_PAD_S` (60 min) outside its route's listed hours (core/offroute.js
  inListedHours); LINGER still `LINGER_S` at a learned linger spot of its route after that spot's time
  (`web/data/idle.json`, 11 route + spot cutoffs: the latest time a still bus of that route there ever served again, +
  2 min, kept only with at least 3 later shift ends; e.g. North at Reynolds Club from 23:33 on weekdays, Apostolic/
  Drexel at Goldblatt from 23:53), used only while today's listed hours of the route equal the ones it was learned
  under (`hours`) and before `valid_until` (45 days after the last learned day), so a new timetable switches it off.
  Clocks and the time of day run on the buses' own report times. A hidden bus shows again at once when it moves more
  than 80 m (or, for IDLE, gets a time ahead). Nothing in the UI claims a shift ended: the bus is just not shown.
- Applied in `data/live.js` next to core/offroute.js (`idleStep` once per vehicle poll on the operating buses, clocks in
  `idleTracks`), and `dropHidden` takes the hidden buses and their trip updates out of the store, so the map, route
  pages, arrivals, counts, bus alerts, Directions, Nearby and the trip view agree. `data/static.js` loads idle.json
  (optional, cleaned; a missing file only switches LINGER off). Planner (`core/planner.js`, recommendations): the
  headway estimate (cycle / buses / 2, shown "est.") is used only while the route is inside its listed hours when the
  rider reaches the stop (`data.service`); past them a route is offered only for its own live times.
- Numbers (27 days, replayed poll by poll, `idle_rules.py`): 1,799 bus-min hidden (67 a day): breaks 748, end_of_shift
  532, parked_never_served 485, layovers 25 (the still clock spanning two short waits), moving 10. Near-misses: 146.8
  bus-min hidden in the 10 min before the bus served again, all from IDLE (the last minutes of breaks of 30+ min with
  no Passio time); 4.9 bus-min within 2 min of an arrival away from where the bus stood. By part: LINGER 465 bus-min, 0
  near-misses (cutoffs learned on Oct 10 to 28 and tested on Oct 29 to Nov 5: 134 bus-min, 0 near-misses); PAST 83, 0;
  PARKED 553, 6.7; IDLE 698, 140. Nov 5 (real polls through the JavaScript): South 4538 hidden from 23:49:46, North 4328
  from 23:50:16, Apostolic/Drexel 4318 23:53:10, Central 4313 23:53:56, Apostolic/Drexel 12645 23:58:06; their 23:15 to
  23:30 layovers never; East 4325 never: the last East bus leaves Reynolds Club along its route and logs the first
  campus stops of the midnight trip (Max Palevsky, Ratner) before it turns off, and on 2 of 27 nights it went on past
  campus, so a rider could board it and no East weekday cutoff was learned. Shown again from 23:57 as they drove off (moving), until the feed
  dropped them at 12:05 AM.
- iOS: Kit `Idle.swift` (same rules and numbers, `IdleData`), `StaticLoader` loads idle.json (`StaticData.idle`, also
  refreshed by the daily schedule check), `LiveState.applying` (`idleTracks`, `idleHidden`), `PlannerData.service`;
  `IdleTests` incl. the web's answers on the real polls (`Fixtures/idle_golden.json` = `web/tests/fixtures/idle_golden.json`).
- Refresh the learned cutoffs (monthly, or after a timetable change): `fetch.py` then `endofservice.py --cache` then
  `idle_rules.py --write-idle web/data/idle.json` (RouteKnower.md E28 has the commands); sw cache bump.

## Minutes to every station on the Current trip (2026-10-20, owner: "the distance in minutes away is shown on the right side of the station name")
- Passio splits one bus's predictions over its trip updates (the trip it is on, often 1 to 4 stops left, and its next trip), so
  the timeline only had times up to the end of the bus's current trip. `core/tripprogress.js vehicleTimes` merges every update
  that names the followed VEHICLE on the route (never another bus's: trip ids are shared) and `etasAlong` matches them in time order.
- `stopTimes(leg, now, ride)` gives every upcoming stop a time: Passio's live time, else an estimate (`est:true`) scaled between
  the live times around it, added from the last one, counted back from the first, from the bus's position (also while the bus is
  still before the first listed stop: from its next stop; 2026-10-20, Central had no Passio predictions at all), or (no live bus) from
  the plan's boarding time; `ride` = scheduled minutes between stops (`core/predict.js rideMinutes`, data/segments.json), else the
  plan's average per stop, added segment by segment along the list (a loop past the bus's own stop counts the full lap). Never
  earlier than now or the stop before. The view (`ui/views/tripprogress.js`) shows "N min" (live)
  or "~N min est." right of each station name; passed stops say "Passed". iOS: Kit `TripFollow.vehicleTimes` and
  `TripStopTimes.swift` (`TripFollow.stopTimes`), `TripText.stopTimes` / `stopEta` / `stopSay`, App `TripTimelineView`
  (ride minutes from `SchedulePredictor`); tests `TripStopTimesTests`.


## Tap a line on the map; a closed route shows its hours first (2026-10-27, owner: "If a user click on a line that is displayed on the actual map, the uppermost line on the layers ... should open as if the user clicked the specific route", "if a specific route that is running is closed, display the hours and service menu first")
- **Line taps.** Route lines stay non-interactive Leaflet layers (stop halos, buses, favorites and controls keep winning
  their own taps). `map.js`'s map click asks the network layer `lineAt(containerPoint)`: every drawn route polyline is
  projected to container pixels (only those whose bounds come near the tap) and `map/geometry.js lineAt` returns the
  TOPMOST line within `LINE_TAP_PX` (14 px) plus half its width (`lineTapWidth`: the widest line as drawn before 2026-11-04,
  TAP_WIDTHS + its 3 px edge + FOCUS_EXTRA, so the thinner lines keep the same reach), in the network's own draw order
  (`stackOrder`: routeOrder, focused routes above dimmed ones), even where a lower line passes closer. Hidden routes are
  not drawn, so never tapped. A hit fires `MapApi.onLineTap(rid)` instead of `onMapTap`; with no listener, or while a
  trip plan is drawn (the network is a dim backdrop then), the tap stays an empty-map tap.
- `main.js` opens the route like a Routes list tap (`openRoute`: route detail at its detent, map framed on the shape),
  unless `core/visibility.js lineTapOpens(state)` says no: Directions, Routes to station, and the Current trip view while
  a trip is in progress keep a map tap as "lower the sheet". A pointer shortcut only: the Routes list stays the
  accessible path (no hover cursor on desktop).
- **Closed route.** `ui/views/route.js routeClosed(state, rid, now)` = no bus of the route running and the schedule does
  not say it runs now (a scheduled route whose buses send no location is open; so is a bus running outside the
  timetable). Then "Hours & service" renders right after the status line and notes, and the stop timeline follows under
  a visible "Stops" heading (`.r-stops-h`); otherwise the order is unchanged. The render is a pure function of state and
  time, so the order flips once at the service boundary. Tests: `web/tests/map-linetap.js` (map.test.html),
  `route-view.js`. sw `sb-v2-68`.
- 2026-10-29 (owner: on a closed route the operator's route assistance numbers must not come first): closed = status, Today line, Hours & service (week, changes, scheduled buses by hour), then the no-bus help (operator alert, Call bus route help, Safety or urgent 773.702.8181), then Stops. Open routes keep the help right after the status. route.js renderRoute; tests route-view.js; sw sb-v2-70.

## Anonymous usage statistics (2026-10-27, owner: "track when a distinct user logs on (time of day), track how long they use it, track what locations they use it most often from", anonymously; visit start and distinct users "should collect regardless")
Website only; on since 2026-10-29 (`USAGE_URL` in web/js/data/usage.js = the owner's Apps Script web app; empty = off).
Owner steps, columns and privacy rules: **`docs/USAGE-STATS.md`**.
- `data/usage.js` (USAGE): `startUsage(store, {ver})` after the first render (main.js; never in demo mode, from
  automated browsers or off https). Rows: `start` always (Chicago day / weekday / time to the minute, app kind, version,
  first visit), `end` = seconds on screen this visit (store `usage.dur`, default on, off by default with Global
  Privacy Control / Do Not Track), `place` = nearest stop name within 400 m or "Away from stops", once per visit (store
  `usage.zone`, default off). Each row: `id` (random 128-bit, localStorage `sb:usageId`; a new one only when the site's data is cleared: the Settings button
  "Get a new anonymous number" was removed 2026-11-05, owner; `resetId()` stays as the tests' model of cleared data)
  and `sid` (random per visit; a new visit after 30 min in the background). No coordinates, IP, user agent or
  identity. Sender (2026-10-29): `fetch` text/plain POST (no preflight) with `credentials: "omit"` (no cookies, so no
  browser login rides along), redirect followed; Google's reply ("ok" / "dropped" / "error") is readable (the 302 and the
  echo both allow any origin). keepalive for rows sent while the page goes away; one beacon only if fetch throws (result
  "failed"). The start row's outcome: `lastSend()` + bus `usage:sent`, shown in Settings (`usageStatusText`: "This visit was
  counted at ..."). Never throws.
- A reload in the same tab (by hand, or ui/update.js reloading after an update) continues the visit: sessionStorage
  `VISIT_KEY` holds it and `begin()` resumes it when it was active under 30 min ago (no second start row; owner
  2026-10-30: double counted visitors). The receiver also refuses a repeated Visit number and cleans old repeats.
- Two-minute rule (owner 2026-10-30): a start less than `QUICK_REPEAT_S` (120 s) after this browser's last start row
  (localStorage `sb:usageLastStart`, any tab) continues that visit; the receiver also folds a number's start within 2 min
  of its previous one (alias for later rows) and cleans old ones at each summary refresh.
- State: `usage: {dur, zone}` persisted (`cleanUsage`, KEYS.usage).
- Settings > Usage statistics (only when configured): `USAGE_ALWAYS` (what is always counted; "Your identity is never
  collected"), switches `usageDur` / `usageZone` (no new-number button since 2026-11-05). The location note adds
  `LOC_ZONE_NOTE` while the nearest stop is shared. About adds `ABOUT_USAGE` and drops "no tracking". privacy.html
  describes it (always / unless you turn it off / only if you turn it on; the iPhone app collects nothing).
- Receiver `tools/usage/Code.gs` (Apps Script web app, tabs starts / ends / places, format checks, no formulas);
  report `tools/usage_report.py` (+ test_usage_report.py). Tests: tests/usage.test.html. sw cache bumped.

## Bug check 2026-10-29 (owner: "Run a full bug check and optimization on the app and data collection methods")
- data/live.js: `parseTrips` drops non-object `stop_time_update` entries (one null used to drop the whole poll), and any
  error inside a poll sets `failed` + `liveLoaded` and counts as a failed poll (stale-data honesty: never "loading" forever).
- data/usage.js: a page loaded in the background (restored or pre-opened tab) starts its visit when first shown.
- sw.js: offline, a page opened with a query string (About's `support.html?contact=1...`) gets that precached page
  before the app shell; tests/data-pwa.js runs the real fetch handler against a fake cache.
- index.html: `<link rel="modulepreload">` for the 74 first-render modules (main.js as `js/main.js?v=5`), so they load in
  parallel instead of 8 import levels deep (2.97 s -> 2.48 s at 150 ms per request over HTTP/1.1); a test keeps the list
  equal to the real first-render graph: a new static import in the boot path must be added there.
- tests/core-dst.js pins clocks, service days, night tails, Lines by Time and usage times on Nov 1 2026 / Mar 14 2027.
- Collector and tools: docs/DATA-COLLECTION-LOG.md DC-019. sw cache sb-v2-72.
- iOS: `BusMotion.startTicking` no longer runs two animation loops after a quick background and back (a generation
  counter, so each loop clears only its own handle); `LiveActivityController` sends updates and the final end in order
  (a `lastSend` chain), so the Lock Screen never shows older numbers than the app sent last; Kit `DSTTests` pin Nov 1
  2026 / Mar 14 2027 (with tools/test_dst.py and tests/core-dst.js). CI 40840132902.

## Numbered buses; a picked bus's own times (2026-10-30, owner: "if there are multiple buses on a line, name them with a number so that if a user clicks on a particular bus it will show their arrival times at each station instead of the closest one while that bus is clicked")
- core/busnum.js (pure; iOS Kit mirrors it): `busNumbers(store.buses)` names a route's buses 1, 2, ... only when it
  shows 2 or more, in vehicle id order (numeric when both ids are numbers, else text), so names stay put while the same
  buses run; `busKey` (vehicle id, else label), `busName` ("Bus 2" / "Bus <fleet label>" / "This bus"),
  `selectedBus(state)` (store.busId, only on that route's page and while the bus is shown), `busArrival` (one vehicle
  id's own prediction at a stop, never another bus's).
- Map (map/layers.js createBusLayer): a white disc with the number at the top right of the bus badge, updated in place
  (no rebuild, the motion of map/track.js continues); name/aria-label "Bus 2, <route name>"; the picked bus gets the
  `is-picked` ring. main.js passes `selected` with drawBuses (BUS_KEYS has busId).
- A bus tap opens its route with that bus picked (main.js onBusTap -> openRoute + store.busId); in the route page
  "Where the buses are" rows are buttons (`route:bus`, again = unpick, 44 px, aria-pressed). Picked: "Showing Bus 2's
  times" + "Show the next bus at each stop" (`route:allbuses`); every station's time is that bus's own (busArrival), none
  where it has no prediction; pills / rail markers say "Bus 2". main.js clears busId when the route page closes or the
  bus is no longer shown. State: `busId` (nav, not persisted). Tests: core-busnum.js, route-busnum.js, map-layers.js,
  e2e.js (a bus tap picks it, back clears it).
- 2026-10-30 (later): a picked bus left out of a feed poll keeps its pick for `PICK_HOLD_S` (45 s, like the map's badge, MISSING_S); leaving the route page still lets go at once (`busnum.pickCheck`, main.js). sw sb-v2-75.

## Arriving In, trips with no bus, walk first (2026-10-30, owner: "the time that is shown when the menu is minimized ... should show the time until the next bus will arrive at their stop. Call it Arriving In: ... rather show the current walking time or the duration of the next step if the user's trip has no bus", "if the distance is very close, it is ok to just suggest the user to walk on their first travel option")
- Current trip header (main.js shows the view's meta at every detent, so also minimized): while a plan journey is on,
  nearby.js metaNearby / peekNearby return ui/views/tripprogress.js `tripMetaText`, from the same `tripNow` as the card:
  waiting = "Arriving In: 4 min" (bus at your boarding stop), on the bus = to the stop where you get off; "Arriving In:
  Now" under a minute; "~4 min" while live data is delayed (etaText, as the card); a planned time without live data
  = "Arriving In: ~4 min est." (never "Now"); no time = "No live bus time yet"; walking to the stop / after the last bus
  / a trip with no bus = "Walk 6 min" (walking minutes left: from your location to the stop or destination when known,
  else the plan's); off the last bus with no walk = "Arrived". No trip: the nearest stop's next bus, as before.
- Walk first: core/rank.js `walkFirst` (WALK_FIRST_MIN 10), applied by core/planner.js plan and again in Directions
  after the sidewalk refine: with at least one bus option, when walking the whole way takes 10 min or less or arrives
  no later than the best bus, a walk option {key:'walk', walkOnly:true, legs:[walk]} leads (selected first, "Close
  enough to walk", walking time, arrival, distance, its step and Start); bus options keep their ranked order; max 4 in
  all; the "Walking the whole way" footnote is dropped then. No bus option = the no-route screen and its help, unchanged.
- Trips with no bus: planJourney accepts the walk option (rids [], one walk leg, dest); it hides no route; the trip bar
  says "Walking the whole way, no bus"; Current trip shows "Trip to X", "Walk N min to X", "No bus needed: it is close
  enough to walk.", End trip, Trip steps (core/tripprogress.js `walkTrip` / `walkLeft`); no notification prompt.
- Tests: tests/trip-arriving.js (8), core-rank.js walk first (3), views-flows.js walk option. sw sb-v2-74.

## Line replaces line: Back after a line opened from a line (2026-11-02, owner: "Pressing back after selecting a specific line to view should not shift to the previous line but rather go to the previous menu view entirely")
- `ui/router.js navigate`: a view registered with `replaceSelf: true` (only `route`, ui/views/route.js) that is opened
  while the same view shows another id (a map line tap via main.js onLineTap, a bus tap via onBusTap) does not push the
  current entry: the new route page takes its place, so a route page never sits directly on another one in the back
  stack. Back then returns to the menu the first route page came from (My Routes / a custom route with its params and
  detent, the Routes list, a stop, Alerts, Current trip, search results). Route > stop > route keeps every step (the
  stop sits between them); a route already on the stack still pops back to it (no loops). The browser's back, Escape
  and the header Back all call `back()` (main.js keeps one history entry while in a sub view), so they agree.
- iOS: `AppModel.showPage` (used by `push` and `busTapped`) replaces a `.route` on top of the path with the new one.
- Tests: tests/ui-shell-router.js (4: My Routes > Central > 53rd > Back, from any menu, route > stop > route, stop >
  stop still stacks), tests/e2e-backnav.js in e2e.test.html (3, the real app with real map line taps: My Routes >
  Central > 53rd Street Express > Back or browser back = the custom route page, unchanged; Routes list > line > map tap
  on another line > Back = Routes list; a single line > Back and browser back). sw `sb-v2-80`.

## Route search on the Routes list (2026-11-04, owner: "You should be able to search routes from the routes menu which will bring them to the top. Allow keywords and smart search such as allowing 53rdst -> 53rd Street or 53rd St -> 53rd Street etc.")
- Logic `core/routesearch.js` (pure; iOS Kit `RouteSearch.swift` ports it 1:1):
  `buildRouteIndex(items [{id, short, long, stops:[names]}])` / `routeIndexFor(state, ids)`, `searchRoutes(index, q)`
  -> `[{id, score, stop?}]` best first (ties keep the list order), `splitByHits(ids, hits)` -> `{top, rest}`,
  `matchText(n)`, `routeWords(s, typing)`, `canon(w)`, `ordinal(digits)`, `TIER`, `CANON`.
- Text: `core/text.js norm` (the place search's: case, accents, punctuation, "/" and "&"; data/places.js now imports
  `norm` and `near1` from there), then letters split from digits with the ordinal dropped ("53rdst" = "53rd st" =
  "53 st"; the right suffix for the number or a wrong "th" / "nd" / "rd"; a wrong "st" stays a word: "53st" = "53
  street"; while typing, the start of the suffix: "53r"), number words ("fifty third" = 53), "and / the / of / for /
  at / to" ignored, abbreviations both ways (`CANON`: st / str street, ave avenue, blvd, dr, exp / expr express, ctr /
  cntr center, dt downtown, sth / nth, n / s / e / w as whole words, apt(s), hosp, sta / stn, univ, lib, ln line).
  Keywords: the short name (AP, DX, CEN, ...), every long-name word, the names of the route's stops. One typo
  (`near1`) on words of 4+ letters, never on the first letter of a 4 or 5 letter word ("west" is not "east").
- Ranking: exact short / long name 100; start of a name 90; every typed word a name word or its start 80+; the same
  after abbreviations 70+; name words plus the words of ONE stop 60+ (the hit names the stop); a name word with a typo
  50+; a stop word with a typo 45+. In a tier + 3 x the mean word weight (1 exact, 0.85 start, 0.7 typo) - 0.5 per
  long-name word not typed (max 3). Single letters only match the start of a name or a name word (no stop matches).
- View `ui/views/routes.js`: a third region `[data-region="routes-search"]` between the top (Edit map order + custom
  bar, still the first control) and the body: `searchHTML` (label "Search routes", placeholder "Search routes or
  stops", clear button "Clear route search", a visually hidden aria-live count). It is drawn once per mount and never
  rebuilt (patch only toggles `hidden`: map-order mode, no routes yet), so typing keeps focus and caret. Typing sets
  `R.q` (module memory: kept for the session, e.g. route page and Back, never stored) and patches the body:
  `listHTML(state, now, q)` = alerts as before, then "N routes match" with the matches best first (each row as usual:
  status, grayed + eye when hidden, plus "Stops at <stop>" for a stop match) or "No routes match" + Clear search,
  then the divider "Other routes" ("All routes" with no match), Show all / Show running / Hide all (unchanged scope
  and states), and the usual groups without the matches. Within the station filter (`routeIds`). Escape in a field
  with text clears it (consumed; an empty field lets Escape go Back); Enter hides a phone's keyboard; focusing the
  field opens the sheet (`setDetent("full")`). The live count follows 400 ms after typing stops.
- iOS `RoutesView`: the app's `SearchField` (clear label "Clear route search", identifier `routesQuery`) under the
  bar; `AppModel.routeMatches` (index cached per `staticVersion`), the same sections and wording, `RouteRow(stop:)`,
  a VoiceOver announcement of the count; UI test `testRouteSearch`.
- Tests: tests/core-routesearch.js (core.test.html: owner examples, keywords, words, the golden file),
  tests/routes-search.js (routes.test.html: placement, order, stop line, no match, filter, hidden rows, escaping, the
  mounted field keeps focus and caret, x / Escape / Clear search, nothing stored, order mode). Golden
  `web/tests/routesearch-golden.json` (a frozen copy of the route and stop names + every case's answer;
  `python tools/gen_routesearch_golden.py`, cases in tests/routesearch-cases.js) is checked by the web test and by
  Kit `RouteSearchTests` (ios.yml also runs when it changes). sw `sb-v2-86`.
- Active routes first (2026-11-05, owner: "Searching routes in the routes menu should still show results if they are
  inactive (the top results, unless the name is clearly specified, should priortize active routes--make it clearly
  show which ones are active by graying them out in results)"): every route stays findable (all of routes.json, Move
  In Charter included; only the station filter narrows the list, as before). `core/routesearch.js
  rankByActive(hits, active)` (Kit `RouteSearch.rankByActive`): a route the query names (score >= `NAMED_MIN` 88.5:
  exact name or the start of one) stays on top in score order whether or not it runs; then the matches operating
  now, then the rest, each by score. `active` = the Show running rule (`operatingIds` / `AppModel.operatingRoutes`: a
  bus reporting, or scheduled now with no live location); with live status unknown (`liveNotKnown` / `!liveLoaded ||
  liveOutage`) it is null: no reordering and no graying (an outage is never "not running"). `routeMatches(state, q,
  now)` returns `{top, stopOf, active}`. A match that does not operate now is drawn `.v-routerow.is-idle` (gray chip
  via `filter: grayscale(1)`, the name in `--text-2`, both AA in light and dark) and its status says so in words:
  `notRunningText` = myroutes.js `restingText` ("Not running now · Scheduled from 4:00 PM today", "Not running today")
  with "Not running now · " added where it does not start that way ("Not running now · No more service today").
  A hidden route keeps its own look (`.is-off` fade, crossed-out eye, "Hidden from map and times"); hidden and not
  running shows both, the hidden line on its own line (one middle dot per line). iOS `RouteRow(idle:)` the same
  (`.grayscale(1)`, `Schedule.restingText`). Golden file `active` cases (19: "metra" with one Metra line running,
  "53rd" named but not running, "drexel" / "drex" / "drexl", unknown status) replayed by both tests. sw `sb-v2-89`.
- Results first (2026-11-05, owner: "Routes that come up in searching for my routes should appear right under the
  search bar above the phone numbers and other information."): with text in the field `listHTML` starts with "N routes
  match" + the matches (or the "No routes match" card + Clear search); the station filter chip, the feed notice (No
  live locations / No shuttles running / Live bus status unavailable), "From the shuttle operator", the "Other routes"
  divider, the bulk capsules, the groups and the calls / official page follow. Nothing is removed (rider safety: the
  alerts and both numbers stay on the page, below the matches). With a station filter the heading names it ("1 route
  matches at Main") and an empty result says "Only routes to Main are searched. Clear the station filter to search
  every route." Empty field: the old order. iOS `RoutesView` the same (`matchSection(station:)` right after
  `searchSection`). Tests: tests/routes-search.js (the two "matches ... lead" cases).
- Glass web (2026-11-05): Edit map order is the sheet header's action (`routesMetaHTML`), so the search region sits
  between the custom-route bar and the body; the "No routes match" state is an empty-state card; the clear button is
  `circle-x-fill` (css `.rt-search`, `.rt-qx`, `.rt-qdiv`, `.rt-qnone`, `.rt-why`).

### Context bar stays when the sheet is expanded (2026-11-04, owner: "When the menu is expanded, the current trip showing at the top of the screen should still show (same way as the settings button)")
Web since 2026-11-05: the glass trip chip does this ("Glass redesign: shell contracts", "Trip chip at the full detent");
the paragraph below is the pre-glass web and the iPhone app.
The map context bar (#ctxbar: "Only showing routes for: <trip>" + Show all, "My route: <name>" + Clear, "Lines active
at <time>" + Clear) no longer hides at the full detent. Like the status pill it keeps its place under the search bar and
the full detent stops 8 px below it: sheet.css shortens `--v-full` by `--ctx-h` (ui/contextbar.js keeps it = the bar's
real height, so larger text works) when the bar shows, by both heights when the pill shows too. Only the expanded sheet
moves when the bar comes or goes; peek never does (tests ui-shell-layout.js, ui-shell-e2e.js "context chip"). The
locate and feedback buttons still step aside at the full detent. iOS: RootView `ctx` no longer checks `.full`; the bar
is part of `chromeH`, so the expanded sheet stops below it the same way.

## Faded buses, trip-only lines, thinner lines without outlines (2026-11-04, owner: "The buses on faded routes should also be faded. If on a trip, only the lines on the particular trip should be displayed.", "Remove the outlines on each line.", "Make the bus lines slightly thinner from the zoomed out view to not overclutter the map.")
- **One rule, core/visibility.js.** `tripRoutes(state)` = the trip in progress (`journey.kind === 'plan'`): its bus legs'
  routes, `[]` for a walk. `mapHidden(state)` = every route but the trip's while a trip is in progress (a walk draws no
  bus line), else `effectiveHidden`; `mapVisibility().hidden` is `mapHidden`, so main.js gives the network and the buses
  the same answer. A display rule only: nothing saved changes (hiddenRoutes, custom routes), and every line comes back
  when the trip ends or is cancelled. Lists and arrivals keep `effectiveHidden` (a walk still hides no route there).
  `mapFocus` gives no focus during a trip (a walk would otherwise bring back a custom route's highlights), except a
  route page the rider opens: it still draws that route (focused routes are drawn even when hidden), the trip's lines
  dimmed (owner to confirm). The Directions preview before Start is not a trip: every line stays, dimmed under the plan.
- **Faded buses.** `busFaded(rid, focus, plan)`: with routes in focus (route page, station filter, a custom route's
  highlights) a bus off them is faded; with no focus and a plan drawn (Directions, a started trip; map.js passes the
  plan's bus-leg routes as `plan`) a bus on a route the plan does not ride is faded; the bus to catch never is, nor the
  bus you ride. These buses used to be hidden while a focus was set (web) or drawn at full strength (web with a plan,
  iOS with a focus); now they show, faded. Faded (layers.js `dress`, css `.is-faded`): scale .8, opacity .42, under the
  other buses (z offset 300), no pulse, and no tap (`pointer-events: none`: a tap there reaches the map, its stops and
  its lines in focus). Label, heading and number stay; a stale faded bus keeps the gray stale edge at opacity .32.
- **No outlines.** Route lines, planned bus legs and the walking dots are drawn without the white (light) / dark gray
  (dark) casing (`sb-casing`, `sb-plan-casing`, `sb-walk-casing` and their panes are gone; the planned bus leg is
  `sb-plan-bus`). The dashed walk stays legible on both basemaps. Weakest without an edge: the yellow 53rd Street
  Express on the light basemap and the dark blue line on the dark one (for the owner; no edge added back). The dark map's
  dark lines are drawn lighter since 2026-11-06: "Route colors on the dark map" below.
- **Thinner zoomed out.** `layers.js lineWeight(z, focused)`: 30% thinner up to zoom 15 (3.5 px at the campus view, was
  5; 2.8 at z13), 15% at z16, unchanged from z17 (6 / 6.5 px); a focused route keeps the full weight so it reads above the
  rest and its chevrons fit. `lineTapWidth(z)` keeps the line tap reach as it was.
  **Web since 2026-11-05 (glass transfer): thinner at every zoom**, the experimental build's widths (owner there:
  "Remove the outlines for the lines but make the lines themselves thinner"): `LINE_WIDTHS` z13 2, z14 2.25, z15 3, z16 4,
  z17 5, z18 6 px, a focused line + `FOCUS_EXTRA` 2 at full opacity (the rest of the network 0.9, dimmed 0.2),
  `lineWeight(z)` has no focus argument any more. The iPhone app keeps the 30%-zoomed-out rule below.
- iOS: Kit `RouteVisibility.tripRoutes / mapHidden / busFaded` (VisibilityCustomTests), `RouteLineWidth.scale(zoom:)`
  (0.7 to 1 in 0.05 steps); AppModel `mapPlanRids`, `buildLayers` (focused routes drawn even when hidden, every line
  dimmed while a plan is drawn, as the web), MapScreen (faded `BusMarker` without a button, faded buses first, non-focused
  lines `width x MapCameraModel.lineScale` set when a camera move ends). The iPhone never had line outlines.
- Tests: core-custom.js (trip-only lines, walk, busFaded), map-layers.js (no outline, weights, faded buses, taps, plan,
  stale + faded, the bus you ride), map-direction.js, map-trip.js, e2e.js (the Directions preview fades the other buses;
  a started trip draws only its lines and buses; all come back after End trip). sw `sb-v2-88`.

## Route colors on the dark map (2026-11-06, owner: "Outline or change coloring of the dark shuttles to make them more noticable.")
- **One rule, core/routecolor.js.** `darkRouteColor(color)`: a route color with 3:1 against the dark land (`DARK_LAND`
  #202124 = style.js `PALETTE.dark.bg`) is drawn as published; a darker one is lifted by `liftForDark(color, bg, min)`:
  OKLab lightness up in 0.005 steps, hue and chroma kept (chroma only cut where sRGB cannot show it), until it has 3:1
  against the land AND the street fill (`DARK_STREET` #3A3B40 = `PALETTE.dark.minor`) and a badge in it carries AA text
  (`badgeTextOk`, core/esc.js textOn). `mapColor(color, dark)` (cached) = the published color on the light map,
  `darkRouteColor` on the dark one. The light map never changes.
- **What it draws.** map/layers.js: lines (focused ones too), one-route stop rings, chevrons (their color is textOn of the
  drawn line color) and bus badges (`--c`, `--t`; the heading notch follows `--c`); map/map.js renderPlan: planned bus
  legs and their board / alight rings. `MapApi.setTheme` recolors in place (network `setDark`: setStyle on the same paths;
  bus layer `setDark`: the badge's CSS variables; a drawn plan is redrawn), and `createMap(id, {dark})` starts in it.
  The sheet's route chips keep the published colors (they have their own ring rule against the card, spec 4.3).
- **The numbers (dark map, contrast against land / street fill, badge text).** Downtown Campus Connector #0E5700 1.83 /
  1.27 -> #509446 4.34 / 3.01; Regents Express #393B79 1.59 / 1.10 -> #7A80C5 4.39 / 3.04; Apostolic #0000FF 1.87 / 1.30 ->
  #487FFF 4.41 / 3.06; Friend Center/Metra #8C4600 2.29 / 1.59 -> #BE743D 4.41 / 3.06; Move In Charter #843C39 2.06 / 1.43
  -> #BD6F6A 4.33 / 3.00. Their badge text turns from white to #111114 (5.0 to 5.2:1; white would be 3.6:1). The other ten
  are 3.2:1 (Red Line/Arts Block) to 12.9:1 on the land and unchanged.
- **Why not more.** 3:1 against the main roads' lighter fill (#4D4E55, about 1 px each side of a line at zoom 15 to 17)
  needs luminance 0.325: ten of the fifteen colors in one light band (Red Line salmon; Friend Center/Metra 0.047 from
  Apostolic/Drexel in OKLab, closer than the closest published pair, 0.064). The lifted five stay at 0.060 or more from
  every other route (tests). **No edge:** a 1 px light edge on a 3 px line washes it toward gray and brings back the outline
  the owner removed on 2026-11-04.
- **Light map (not changed, for the owner):** under 3:1 against the light land #F5F3EE: 53rd Street Express 1.12, South
  Loop Shuttle 1.77, Central 1.93, East 2.19, Apostolic/Drexel 2.58, Drexel 2.91, North 2.95.
- iOS: Kit `RouteColor` (the same functions, bit for bit: RouteColorTests on the shared golden
  `web/tests/fixtures/routecolor_golden.json`); AppModel `buildLayers` gives each `MapLine` / `MapChevron` a `darkColor`,
  MapScreen picks it by `colorScheme`, planned bus legs and `BusMarker` (fill, heading triangle; text `RouteColor.textOn`
  in dark) use `RouteColor.mapColor`. The bus number chip keeps the published color (it sits on white). MapKit's dark map
  is a neutral dark gray like the web's; the reference colors are the web's.
- Tests: core-routecolor.js (golden, every real route, hue kept, routes kept apart), map-layers.js (lines, stop rings,
  chevrons, badges, plan legs, theme switch in place, dark launch), map-style.js (the palette link). sw `sb-v2-137`.

## Redesign: layout and shell contracts (2026-11-03, docs/DESIGN-SPEC.md; owner brief "Straight Bussing New Version.txt")
The navigation structure is unchanged (search bar with clock and gear, three sections in the bottom bar, sheet with two
resting states, back stack, Settings and Lines by Time overlays); what changed in the shell and the contracts views use:
- **Tokens** (`css/tokens.css`): the spec's token table under its CSS names; the old names stay as aliases. Root = body
  size (`html { font-size: 106.25% }`, `-apple-system-body` on iPhone Safari); every type role is `calc(1rem * n / 17)`.
  `js/ui/frame.js initTextSize` sets `html[data-text]` = `default` (< 20 px root), `large` (20 to 27), `ax` (28+);
  stylesheets stack rows, buttons, option lines and the sheet header's trailing slot at `ax`.
- **Icons**: `js/ui/icons.js` is the one set (`svg(name, size, {cls, stroke})`, `pair(name)` for outline / filled);
  `index.html` inlines the same SVGs for the static chrome; `components.js icon()` maps the old names onto it.
- **Sheet** (`css/sheet.css`, `js/ui/sheet.js`): opaque `bgSheet`, no backdrop blur; `--v-peek` is set on `#app` from the
  measured header height (first measurement without a slide), so the collapsed sheet grows with text; `.is-scrolled`
  shows the header hairline. Header markup: `.titletext` holds `#title` and `#subtitle`; `#titleRight` is the
  trailing slot.
- **View header contract** (main.js `renderHeader`): `def.title(state, o)`, `def.subtitle(state, o)` and
  `def.metaHTML(state, o)` (trusted markup built with esc(); else the plain-text `def.meta`), with `o = {detent}`; the
  header re-renders on every store change, on a sheet state change and on the bus event `sheet:header` (a view's own
  state changed, e.g. Directions selected another option). Header actions (`[data-action]` in `#titleRight`) are bound
  like the content's. Users: nearby (badge + ETA + live dot; during a trip the next step over "Trip to X" with Arriving
  In when collapsed, "Current trip" when expanded), stop (next arrival), route (`routeStatusText`), directions (selected
  total), routes (`routesMetaHTML`: Edit map order), myroutes (`myRoutesMetaHTML`: New).
- **Status** (`js/ui/pill.js`): `#pill[data-form]` = `chip` (simulated buses: 32 pt capsule, whole chip is the button)
  or `banner` (every feed state: full width, opaque warn / danger background, first sentence Semibold via
  `setPillText`). `--pill-h` and the expanded state below the banner work as before; the locate button moves under a
  banner. The banner's action (Retry or See alert, never both) is the FIRST child, a fixed 84 x 44 `.pillslot` on the
  leading edge (owner 2026-11-03, spec 10.3): after a Retry tap `pill.js` keeps the banner's height and content until
  `RETRY_HOLD_MS` (2.5 s) after the last tap; if the feed answers meanwhile it says `BACK_MSG` ("Live data is back.")
  with a check and Retry absorbs taps (`aria-disabled`), so the trip chip (whose Show all ends the trip) never slides
  under a tapping finger. Repeated taps join the running poll (`data/live.js pollNow`). Tests: `ui-shell-pill.js`
  (slot order, the hold) and the e2e "Retry tapped again and again during a trip".
- **Trip chip** (`js/ui/contextbar.js`): badges (up to 3, then "+N"), "Trip to X" / "Routes to X" / the Lines by Time
  name / the custom route's name, Show all / Clear; only the label truncates; no marquee.
- **Toast** (`css/base.css`): 12 above the collapsed sheet, 12 above the bottom bar when expanded, hidden while an
  overlay (Settings, Lines by Time) is open.
- **Map** (`js/map/layers.js`): `lineWeight` by the spec table (thinner since 2026-11-04: `LINE_WIDTHS`), `FOCUS_EXTRA` 2,
  no casing (the 2026-11-03 `CASING_EXTRA` / `casingClass` flip was removed on 2026-11-04), `stopStyle(z)`, `routeLabel` = the badge's chipText (never
  truncated), `notchRadius(w, h, deg)`; dimmed lines are drawn without casing. `js/map/landmarks.js` takes an `avoid()`
  callback (the location dot). `css/map.css` reads `--sb-accent` (tintFill) and `--sb-tint` (tint).
- Performance rules kept: the sheet's `--drag` stays non-inherited, `will-change` only while dragging, content insets
  change after a settle, bus markers update in place on requestAnimationFrame; at most four blurred elements.
Deviations from the spec: `docs/redesign/NOTES-web.md`; screens: `docs/redesign/after/web/`. sw `sb-v2-85`.

## Glass redesign: shell contracts (2026-11-04, docs/DESIGN-SPEC-GLASS.md, a delta on DESIGN-SPEC.md)
Apple Maps' iOS 26 layout in Liquid Glass; functions, words and states unchanged. What moved and the contracts views
and tests rely on:
- **Glass** (`css/tokens.css` glass tokens, `.glass` in `css/base.css`): only the control layer over the map (tab bar,
  search circle, Settings circle, lower-right group, simulated-buses chip, trip chip, the collapsed card's plate, the
  feedback circle as the one tinted glass).
  `#app.is-moving` (ui/sheet.js, while the sheet drags and settles) and `.glass--moves` make moving glass solid;
  `html.glass-lite` (ui/frame.js `initGlassLite`, a slow device) and Increase Contrast / Reduce Transparency make all
  glass solid. Budget: at most 6 blurred surfaces on at most 22% of the screen at rest (e2e "glass budget").
- **Top rows** (fixed, `css/base.css`): `#pill` = Row A (banner form, topmost, Retry / See alert slot leading, 2.5 s
  hold) or Row B leading (chip form); `#topbar` = the Settings circle (Row B trailing); `#ctxbar` beside Settings or
  under the chip. `--banner-h` (from `--pill-h`), `--row-b-top`, `--ctx-top` on `#app`.
- **Bottom row** `#bottomrow`: `<nav id="tabs" class="tabcap">` (the three sections, `.tab-pill` moved by `--tab-i`,
  written by main.js) and `#searchBar` (the search circle, `dir:open` + `data-focus="to"`). `--nav-h` = the space it
  takes from the bottom (`--bottom-inset` + 56). Hidden while a sheet text field has focus on touch screens and under
  Settings / Lines by Time.
- **Sheet** (`css/sheet.css`, `js/ui/sheet.js`): bottom at the screen's bottom, `--v-max` tall; collapsed visible
  height `--v-peek-vis` (card + 8 + the bottom row; the peek probe measures it), expanded `--v-full`. `.sheet-bg`
  holds `.sheet-glass` (the card's plate, header height, inset 12) and `.sheet-solid` (the opaque sheet); while
  dragging, `paintP()` writes opacity / transform on `.sheet-solid`, `#content` and `#mapctl` from the progress p
  (opaque by p .35, the group gone by p .30); at rest css drives them from `data-detent`. `--card-k` (card width /
  sheet width) on `#app`. The sheet element takes no taps while collapsed except its header and `#mapctl`.
- **Lower-right group** `#mapctl` (inside `#sheet`, `bottom: calc(100% + 8px)`): `#timeBtn` over `#locateBtn`; rides
  with the sheet's transform, hidden when expanded. The map's bottom inset adds its height while collapsed
  (`MapApi.setBottomInset(px, controls)`), the credit does not.
- **Directions**: the Start / Destination card is the first child of the view, sticky; `#dirbar`, the search bar morph
  and `barRects` / `useBar` are gone.
- **Settings / Lines by Time** (`ui/settings-overlay.js`): a sheet of its own (top = safe + 10, bottom 0), zooming out
  of its opener (`zoomOrigin`), swipe down on the header closes (`SWIPE_CLOSE_PX`), Done = checkmark named "Done",
  Cancel = cross named "Cancel"; it no longer moves the app's sheet; the app behind is inert.
- **Confirm dialogs** grow out of their button (`ui/confirm.js zoomFrom`). Buttons and segmented controls are capsules.
- **Compact status banner** (owner 2026-11-04: "Reduce the size of the reconnecting notification."; `ui/pill.js`,
  `css/base.css`): one 44 pt line in the footnote role, a CSS grid of [action slot 84 x 44] [icon] [`.pillmore`]. The
  slot keeps the owner's Retry rule (leading, fixed, 2.5 s hold). `pillState().short` is the line ("Live data lost. Times
  may be off.", "No live data. Don't rely on times.", "Last update 1:23 PM. Times approximate."; it always says the times
  can't be relied on), `msg` the full sentence in `#pillText` (always in the live region for screen readers, visually
  hidden until open). `.pillmore` (name "Details", `aria-expanded`, `aria-controls="pillText"`) opens the sentence and
  `.pillcall` "Call 773.702.8181" (`tel:`) under the line; the line never moves, the banner only grows downward (Row B
  follows `--pill-h`), so fast taps on it never land on the trip chip. Open stays open across state changes; a banner
  that comes back starts closed. The demo chip has no Details.
- **Feedback circle** `#feedbackBtn` inside `#topbar` under Settings (see "Beta feedback" above).
- **Trip chip at the full detent** (owner 2026-11-04: "When the menu is expanded, the current trip showing at the top of
  the screen should still show (same way as the settings button)"): `#ctxbar` no longer hides when expanded; beside
  Settings it needs no room; in Row C (with the simulated-buses chip) `--v-full` shrinks by 36 + 8 so the expanded
  sheet starts 8 below it (sheet.css). Peek never moves for it.
- **Current trip with no trip** (owner 2026-11-04: "if a current trip is not selected, don't display nearby routes, rather,
  just show that no current trip is selected. Keep the favorites and search station bar. Also keep the alerts."; spec 18
  D6): `views/nearby.js` renders the alert row, `noTripHTML()` ("No current trip selected", `NO_TRIP_HINT`, a
  Search for a destination button = `dir:open`), the station search with its links, and the favorites; `nextHTML`,
  `locHTML` and the Arriving soon / Also nearby lists run only during a trip (or for a typed place, the search's own
  result); `metaNearby` / `metaNearbyHTML` are empty and the collapsed subtitle is `NO_TRIP_TITLE`. Tests run the nearby
  list with a trip (`views-fixtures.js onTrip`).
- **Basemap roads** (owner 2026-11-04: "Do not make the main streets yellow. The highways being yellow is ok."): only
  motorways (and motorway bridges) are yellow-orange; main streets white / gray (`map/style.js PALETTE`); a test checks
  no other road layer has a yellow or orange hue.
Deviations from the glass spec: `docs/redesign/NOTES-glass-web.md`; screens: `docs/redesign/glass/web/`. sw `sb-v2-93`.

## Glass interface on the live site (2026-11-05, owner: "Transfer the interface of the experimental build to the current main build of straight bussing. Check for bugs and data collcetion for logins that may be messed up during the change.")
The website's interface came over from the experimental repository (github.com/blobberus/straight-bussing-experimental,
main at 682facd; fetched by URL, copied by path, never merged and nothing pushed there). The two sections above
("Redesign: layout and shell contracts", "Glass redesign: shell contracts") are its contracts; docs/DESIGN-SPEC.md,
docs/DESIGN-SPEC-GLASS.md, docs/APPLE-MAPS-STUDY.md, docs/REDESIGN-AUDIT.md and docs/redesign/NOTES-*.md came with it
(screenshots stay in the experimental repository). sw `sb-v2-98` (one above both repos: live sb-v2-89, experimental
sb-v2-97).
- **Came over:** every file in `web/` except the ones below: css, index.html, js (main.js, ui/, map/, `core/esc.js`
  `contrast()`, the new `ui/icons.js`), sw.js, tests. Files with Windows line endings on the experimental side (main.js,
  sw.js, usage.js) were stored with Unix ones.
- **Kept from live:** `web/icons/*` and `tools/make_icons.py` (the experimental icons have a yellow ring that marks the
  test site), `web/data/**` (the daily GTFS refresh), the workflows, README and project notes. `core/` and `data/` were
  already the same in both repos (the experimental build had ported every live change of 2026-11-02 to 11-05: feedback
  button, popup removal, Retry first, off-route buses, route search and active-first ranking, heading cone on the first
  tap, trip chip when expanded, faded buses, trip-only lines, no outlines).
- **Differences decided:** line widths = experimental (thinner at every zoom; live had thinned only zoomed out);
  Retry = experimental's 2.5 s banner hold instead of live's 1 s context-bar guard (the same rule, stronger); Current
  trip with no trip = experimental's "No current trip selected" without nearby buses (the owner's choice there, spec 18
  D6; a departure from ship checklist item 3, to confirm for the live site); the context bar's marquee is gone (the trip
  chip truncates its label, spec 10.5).
- **Usage statistics** (data/usage.js): unchanged rows. The experimental site's path guard came along: it only stops
  counting on /straight-bussing-experimental/ (so a future copy there never mixes test visits into the owner's Sheet);
  /straight-bussing/ counts exactly as before. A test seam `_configureUsage({loc, nav})` stands in for location and
  navigator. Checked: tests/usage-core.js (the live path counts; the experimental path, http and automated browsers
  never; the exact row fields the receiver accepts; home screen vs browser; the version), tests/usage-app.js (the real
  glass app sends nothing in the test suite; Settings > Usage statistics with both labeled 44 px switches that save the
  choice), and a real run of the live path in headless Edge with the receiver stubbed (start, reload, two-minute rule,
  home screen, length off, nearest stop, demo, automated browser, experimental path): every row the same as before the
  transfer, field by field.
- **iPhone app:** keeps its interface; only the two owner changes of 2026-11-05 (yellow favorite stars; route search
  results right under the field) were made there too.

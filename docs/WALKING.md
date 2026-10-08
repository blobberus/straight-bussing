# Walking legs (sidewalk routing)

Walking legs in Directions follow real footpaths via a free, no-key, CORS-enabled router. Code: `web/js/core/walk.js` (`walkRoute`), integration in `web/js/core/planner.js` (`refineWalking`) called from `web/js/ui/views/directions.js`.

## Routers (checked 2026-10, both return `Access-Control-Allow-Origin: *`)
1. Primary: FOSSGIS OSRM foot, `https://routing.openstreetmap.de/routed-foot/route/v1/foot/{lon},{lat};{lon},{lat}?overview=full&geometries=geojson`
2. Fallback: OSM Foundation Valhalla, `https://valhalla1.openstreetmap.de/route?json=...` (costing `pedestrian`, polyline6 shape)
3. If both fail or time out (3 s each, AbortController): straight line x 1.2 detour (the old estimate), labeled "estimate".

These are community servers with fair-use policies; no key, no SLA. Cache is memory only (failed lookups retry after 60 s).

## API
`walkRoute(from, to)` -> `Promise<{m, min, coords:[[lat,lon],...], source:'router'|'estimate'}>` (never rejects). `peekWalk(a,b)` reads the cache synchronously. Minutes are always metres / 80 per min (same pace as the planner), never the router's own duration. Cache key is coordinates rounded to 4 dp; identical in-flight requests are shared; at most 6 requests in flight.

## Flow
`plan()` stays synchronous and uses the estimate. Directions then calls `refineWalking(option, ...)` for the top 3 options: it swaps in router walks, retimes the option (live bus times are fixed, so a longer walk shrinks the wait) and updates total and arrive clock. If the real walk makes the live bus unreachable it re-plans with the router walking times (up to 2x) and returns the same-route option (`replanned:true`), or `null` when that route no longer works (Directions then drops it).

## Privacy
Only the start and end of each walking leg, rounded to 4 dp (~10 m), go to routing.openstreetmap.de (or valhalla1.openstreetmap.de). The About view says so.

## Not covered
Walk-only (no shuttle) result is refined only when no shuttle option exists. Indoor shortcuts/campus-private paths depend on OSM data. Nearby-view walk minutes still use the estimate.

/**
 * @module data/demo
 * Simulated live feed for demo mode (core/demo.js: `?demo=1` only). Port of the iOS Kit DemoFeed.swift, built
 * from the published static data so it can never drift from it:
 * - the routes the published schedule has in service now (service.json) get buses: each its scheduled peak
 *   (most buses at once on any day), 1 to 3, spaced evenly around the route; when NO route is scheduled
 *   (early morning), every route runs instead, so the demo is never empty;
 * - segment times are the schedule's (segments.json), else the stop distance at 18 km/h; buses move with time
 *   from `epoch` (deterministic: the same second always gives the same positions);
 * - positions follow the road shape between stops (map/geometry.js alongShape), heading from the road;
 * - each bus has a trip update predicting its next 14 stops (10 s dwell), with matching trip and vehicle ids;
 * - one service alert "Demo mode: simulated buses" (core/demo.js DEMO_TITLE / DEMO_BODY) is always present.
 * Output is GTFS-realtime JSON in Passio's shape; demoFetch() serves it to data/live.js in place of the network,
 * so the whole app runs unchanged and the real feed is never fetched (simulated and live data never mix).
 */
import { alongShape, pathLength, distM } from "../map/geometry.js";
import { hav, bearing } from "../core/geo.js";
import { routeOrder } from "../core/notify.js";
import { isScheduledNow } from "../core/schedule.js";
import { DEMO_TITLE, DEMO_BODY } from "../core/demo.js";

/** Most simulated buses on one route. */
export const MAX_BUSES = 3;
/** Stops predicted per trip update. */
const AHEAD = 14;
/** Dwell at each stop (s), like the iOS feed. */
const DWELL_S = 10;
/** Distance fallback speed: 18 km/h in m/s. */
const FALLBACK_MS = 18000 / 3600;

/**
 * Seconds to drive segment i of a route's stop order (the last one closes the loop).
 * @param {object} state static slices (stops)
 * @param {object|null} segments data/segments.json ({routes:{rid:{seg:[s]}}})
 * @param {string} rid
 * @param {string[]} order stop ids without a loop's repeated last stop
 * @returns {number[]}
 */
export function segSeconds(state, segments, rid, order) {
  const segs = segments?.routes?.[rid]?.seg || [];
  return order.map((id, i) => {
    const v = Number(segs[i]);
    if (Number.isFinite(v) && v > 0) return Math.max(20, v);
    const a = state.stops?.[id], b = state.stops?.[order[(i + 1) % order.length]];
    return a && b ? Math.max(30, hav(a, b) / FALLBACK_MS) : 60;
  });
}

/**
 * Buses to simulate on a route: the schedule's peak (1 to MAX_BUSES); without schedule data 2 on long
 * routes (10+ stops), else 1 (the iOS rule).
 * @param {object} service store.service
 * @param {string} rid
 * @param {number} nStops
 * @returns {number}
 */
export function busCount(service, rid, nStops) {
  let peak = 0;
  for (const d of Object.values(service?.routes?.[rid]?.days || {})) {
    for (const n of (d && d.buses) || []) peak = Math.max(peak, Number(n) || 0);
  }
  if (!peak) return nStops >= 10 ? 2 : 1;
  return Math.max(1, Math.min(MAX_BUSES, peak));
}

/**
 * Routes to simulate at `now`: those with 3+ stops scheduled now; all of them when none is scheduled.
 * @param {object} state static slices (routes, stops, routeStops, service)
 * @param {number} now unix seconds
 * @returns {{rids:string[], scheduled:boolean}} scheduled: false = the all-routes fallback
 */
export function demoRoutes(state, now) {
  const all = Object.keys(state.routeStops || {}).filter((rid) => state.routes?.[rid]
    && routeOrder(state.routeStops[rid]).order.filter((id) => state.stops?.[id]).length >= 3);
  const on = all.filter((rid) => isScheduledNow(state.service || {}, rid, now) === true);
  return on.length ? { rids: on, scheduled: true } : { rids: all, scheduled: false };
}

/** Road path of every segment of a route, with cumulative lengths (cached per route by the caller). */
function pieces(state, rid, order) {
  const at = (id) => ({ id, lat: state.stops[id].lat, lon: state.stops[id].lon });
  return order.map((id, k) => {
    const a = at(id), b = at(order[(k + 1) % order.length]);
    const line = alongShape(state.shapes?.[rid], state.routeStops?.[rid], a, b, [[a.lat, a.lon], [b.lat, b.lon]]);
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + distM(line[i - 1], line[i]));
    return { line, cum, len: pathLength(line) };
  });
}

/**
 * Point and heading at fraction f (0..1) along a segment's road path.
 * @param {{line:Array<[number,number]>, cum:number[], len:number}} p
 * @param {number} f
 * @returns {{lat:number, lon:number, bearing:number}}
 */
export function pointAlong(p, f) {
  const { line, cum, len } = p;
  if (line.length < 2 || !(len > 0)) { const q = line[0] || [0, 0]; return { lat: q[0], lon: q[1], bearing: 0 }; }
  const d = Math.min(1, Math.max(0, f)) * len;
  let i = 1;
  while (i < line.length - 1 && cum[i] < d) i++;
  const a = line[i - 1], b = line[i], seg = cum[i] - cum[i - 1], t = seg > 0 ? (d - cum[i - 1]) / seg : 0;
  const lat = a[0] + (b[0] - a[0]) * t, lon = a[1] + (b[1] - a[1]) * t;
  return { lat, lon, bearing: Math.round(bearing({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] })) % 360 };
}

const text = (s) => ({ translation: [{ text: s, language: "en" }] });

/**
 * The three simulated feeds at `now`.
 * @param {object} state store state (routes, stops, shapes, routeStops, service)
 * @param {number} now unix seconds
 * @param {{epoch:number, segments?:object|null, cache?:Map}} o epoch: demo start (buses advance with now - epoch);
 *   cache: per-route road paths, reused across polls
 * @returns {{vehiclePositions:object, tripUpdates:object, serviceAlerts:object}}
 */
export function demoFeeds(state, now, { epoch, segments = null, cache = new Map() }) {
  const vehicles = [], updates = [], ts = Math.floor(now - 3), run = new Set(demoRoutes(state, now).rids);
  Object.keys(state.routeStops || {}).forEach((rid, ri) => {   // ri over every route: labels and phases stay put as routes start / stop
    if (!run.has(rid)) return;
    const order = routeOrder(state.routeStops[rid]).order.filter((id) => state.stops?.[id]);
    if (!cache.has(rid)) cache.set(rid, { secs: segSeconds(state, segments, rid, order), paths: pieces(state, rid, order) });
    const { secs, paths } = cache.get(rid), cycle = secs.reduce((x, y) => x + y, 0), n = busCount(state.service, rid, order.length);
    for (let b = 0; b < n; b++) {
      let p = ((0.12 + b / n + (ri % 5) * 0.05 + (now - epoch) / cycle) % 1 + 1) % 1, at = p * cycle, k = 0;
      while (k < secs.length - 1 && at >= secs[k]) { at -= secs[k]; k++; }
      const pos = pointAlong(paths[k], at / secs[k]), next = order[(k + 1) % order.length];
      const vid = `demo-${rid}-${b}`, tid = `demo-trip-${rid}-${b}`, label = String(1600 + ri * 7 + b * 3);
      vehicles.push({ id: vid, vehicle: { vehicle: { id: vid, label }, trip: { trip_id: tid, route_id: rid },
        position: { latitude: pos.lat, longitude: pos.lon, bearing: pos.bearing, speed: 6 }, timestamp: Math.floor(now - 4), stop_id: next } });
      const stu = [];
      let t = now + (secs[k] - at);
      for (let s = 1; s <= Math.min(order.length, AHEAD); s++) {
        const idx = (k + s) % order.length;
        stu.push({ stop_id: order[idx], arrival: { time: Math.round(t) }, departure: { time: Math.round(t) + DWELL_S } });
        t += secs[idx] + DWELL_S;
      }
      updates.push({ id: tid, trip_update: { trip: { trip_id: tid, route_id: rid }, vehicle: { id: vid, label }, stop_time_update: stu } });
    }
  });
  const header = { gtfs_realtime_version: "2.0", timestamp: ts };
  return {
    vehiclePositions: { header, entity: vehicles },
    tripUpdates: { header, entity: updates },
    serviceAlerts: { header, entity: [{ id: "demo", alert: { header_text: text(DEMO_TITLE), description_text: text(DEMO_BODY), active_period: [], informed_entity: [] } }] },
  };
}

/** Resolves when the store's static data has loaded (the feed is built from it). */
function whenStatic(store, signal) {
  if (store.get().staticLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const off = store.subscribe((s) => { if (s.staticLoaded) { off(); resolve(); } });
    signal?.addEventListener?.("abort", () => { off(); reject(new DOMException("demo feed aborted", "AbortError")); }, { once: true });
  });
}

/**
 * A fetch stand-in for data/live.js: answers the three feed URLs with demoFeeds() and NEVER calls the
 * network, so a demo session can't mix in live data. Unknown URLs get a 404.
 * @param {{get():object, subscribe(fn:Function):Function}} store
 * @param {{epoch?:number, now?:() => number, segments?:() => Promise<object|null>}} [o] now: unix seconds;
 *   segments: loader for data/segments.json (default fetches it once; null = distance fallback)
 * @returns {(url:string, init?:{signal?:AbortSignal}) => Promise<{ok:boolean, status:number, json:() => Promise<object>}>}
 */
export function demoFetch(store, o = {}) {
  const now = o.now || (() => Date.now() / 1000), epoch = o.epoch ?? now(), cache = new Map();
  const load = o.segments || (() => globalThis.fetch(new URL("../../data/segments.json", import.meta.url)).then((r) => (r.ok ? r.json() : null)));
  let segP = null, feeds = null, feedsAt = -1;
  return async (url, init = {}) => {
    const name = (/realtime\/(\w+)\.json/.exec(String(url)) || [])[1];
    if (!["vehiclePositions", "tripUpdates", "serviceAlerts"].includes(name)) return { ok: false, status: 404, json: async () => null };
    segP ||= Promise.resolve().then(load).catch(() => null);
    const segments = await segP;
    await whenStatic(store, init.signal);
    const t = Math.floor(now());
    if (t !== feedsAt) { feeds = demoFeeds(store.get(), t, { epoch, segments, cache }); feedsAt = t; }   // one poll = 3 calls, one snapshot
    const body = feeds[name];
    return { ok: true, status: 200, json: async () => body };
  };
}

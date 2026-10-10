// Demo mode data (data.test.html): data/demo.js simulated feed (port of the iOS Kit DemoFeed.swift) on the REAL
// static data, the fetch stand-in that never touches the network, and core/storage.js's demo memory overlay.
import { test, eq, ok } from './lib.js';
import { createStore } from '../js/core/store.js';
import { loadStatic } from '../js/data/static.js';
import { startLive, parseBuses, parseTrips, parseAlerts } from '../js/data/live.js';
import { demoFeeds, demoFetch, demoRoutes, busCount, segSeconds, pointAlong, MAX_BUSES } from '../js/data/demo.js';
import { isScheduledNow } from '../js/core/schedule.js';
import { operatingBuses } from '../js/core/operating.js';
import { routeOrder } from '../js/core/notify.js';
import { load, save, remove, useMemoryOverlay, memoryOverlay } from '../js/core/storage.js';
import { DEMO_TITLE } from '../js/core/demo.js';

const NIGHT = 1791702000;   // Sun 2026-10-11 2:00 AM Chicago: the night routes are scheduled
let real = null;
async function realState() {
  if (real) return real;
  const store = createStore({ routes: {}, stops: {}, shapes: {}, routeStops: {}, stopRoutes: {}, service: {}, staticLoaded: false });
  await loadStatic(store, { base: '../data/' });
  const segments = await (await fetch('../data/segments.json', { cache: 'no-store' })).json();
  real = { state: store.get(), segments };
  return real;
}
/** Shortest distance (m) from p to a polyline, equirectangular (fine at campus scale). */
function offShape(p, lines) {
  const k = Math.cos(p.lat * Math.PI / 180) * 111320, m = 110540;
  let best = Infinity;
  for (const line of lines || []) for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][1] - p.lon) * k, ay = (line[i - 1][0] - p.lat) * m, bx = (line[i][1] - p.lon) * k, by = (line[i][0] - p.lat) * m;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

test('demo feed: the routes scheduled now run their peak (1 to 3 buses), on the road shape, operating, with an honest alert', async () => {
  const { state, segments } = await realState();
  const f = demoFeeds(state, NIGHT, { epoch: NIGHT - 600, segments });
  const buses = parseBuses(f.vehiclePositions), trips = parseTrips(f.tripUpdates), alerts = parseAlerts(f.serviceAlerts);
  const all = Object.keys(state.routeStops).filter((r) => state.routes[r] && routeOrder(state.routeStops[r]).order.length >= 3);
  const rids = all.filter((r) => isScheduledNow(state.service, r, NIGHT) === true);
  ok(rids.length >= 1 && rids.length < all.length, 'night: some routes scheduled (' + rids.length + ' of ' + all.length + ')');
  eq(demoRoutes(state, NIGHT), { rids, scheduled: true });
  eq([...new Set(buses.map((b) => b.trip.route_id))].sort(), rids.slice().sort(), 'buses only on scheduled routes');
  for (const rid of rids) {
    const n = buses.filter((b) => b.trip.route_id === rid).length;
    eq(n, busCount(state.service, rid, routeOrder(state.routeStops[rid]).order.length), rid);
    ok(n >= 1 && n <= MAX_BUSES, rid + ' count ' + n);
  }
  for (const b of buses) {
    const d = offShape({ lat: b.position.latitude, lon: b.position.longitude }, state.shapes[b.trip.route_id]);
    ok(d < 60, `${b.trip.route_id} bus ${b.vehicle.label} on its road shape (${Math.round(d)} m off)`);
    ok(b.position.bearing >= 0 && b.position.bearing < 360 && b.timestamp <= NIGHT, 'heading + fresh timestamp');
    const t = trips.find((x) => x.trip.trip_id === b.trip.trip_id && x.vehicle.id === b.vehicle.id);
    ok(t && t.stop_time_update[0].stop_id === b.stop_id, 'trip update starts at the bus\'s next stop');
    const times = t.stop_time_update.map((u) => u.arrival.time);
    ok(times.every((x, i) => x > NIGHT - 1 && (i === 0 || x > times[i - 1])), 'predictions in the future, in order');
  }
  eq(new Set(buses.map((b) => b.vehicle.id)).size, buses.length, 'unique vehicles');
  const op = operatingBuses(buses, { routes: state.routes, service: state.service, trips, feedTs: f.vehiclePositions.header.timestamp, nowS: NIGHT, staticLoaded: true });
  eq(op.length, buses.length, 'every simulated bus counts as operating (live predictions), also at night');
  eq(alerts.length, 1);
  eq(alerts[0].header_text.translation[0].text, DEMO_TITLE);
  ok(/not live data/.test(alerts[0].description_text.translation[0].text), 'says it is not live');
});

test('demo feed: when no route is scheduled (early morning), every route runs so the demo is never empty', async () => {
  const { state, segments } = await realState();
  const all = Object.keys(state.routeStops).filter((r) => state.routes[r] && routeOrder(state.routeStops[r]).order.length >= 3);
  let quiet = 0;
  for (let t = NIGHT; t < NIGHT + 7 * 86400 && !quiet; t += 900) if (!all.some((r) => isScheduledNow(state.service, r, t) === true)) quiet = t;
  ok(quiet, 'the published schedule has a quiet hour this week');
  eq(demoRoutes(state, quiet), { rids: all, scheduled: false });
  const buses = parseBuses(demoFeeds(state, quiet, { epoch: quiet, segments }).vehiclePositions);
  eq(new Set(buses.map((b) => b.trip.route_id)).size, all.length, 'a bus on every route');
});

test('demo feed: deterministic for a given second; buses move along as time passes', async () => {
  const { state, segments } = await realState();
  const o = { epoch: NIGHT, segments };
  eq(JSON.stringify(demoFeeds(state, NIGHT + 30, o)), JSON.stringify(demoFeeds(state, NIGHT + 30, { epoch: NIGHT, segments })), 'same input, same feed');
  const a = parseBuses(demoFeeds(state, NIGHT + 30, o).vehiclePositions), b = parseBuses(demoFeeds(state, NIGHT + 90, o).vehiclePositions);
  const moved = a.filter((x, i) => Math.abs(x.position.latitude - b[i].position.latitude) + Math.abs(x.position.longitude - b[i].position.longitude) > 1e-5);
  ok(moved.length >= a.length * 0.8, `most buses moved in a minute (${moved.length}/${a.length})`);
});

test('demo feed helpers: schedule segment times (else 18 km/h), peak bus count, point along a path', () => {
  const st = { stops: { A: { lat: 41.79, lon: -87.6 }, B: { lat: 41.799, lon: -87.6 }, C: { lat: 41.799, lon: -87.59 } } };
  eq(segSeconds(st, { routes: { R: { seg: [120, 0, null] } } }, 'R', ['A', 'B', 'C']).map(Math.round), [120, 166, 260], "schedule first, distance at 18 km/h for gaps");
  eq(segSeconds(st, null, 'R', ['A', 'B'])[0] > 30, true);
  const svc = (peak) => ({ routes: { R: { days: { mon: { buses: [0, peak, 1] }, tue: null } } } });
  eq([busCount(svc(6), 'R', 5), busCount(svc(2), 'R', 5), busCount({}, 'R', 12), busCount({}, 'R', 4)], [3, 2, 2, 1]);
  const p = { line: [[41.79, -87.6], [41.8, -87.6]], cum: [0, 1112], len: 1112 };
  const mid = pointAlong(p, 0.5);
  ok(Math.abs(mid.lat - 41.795) < 1e-9 && mid.bearing === 0, 'halfway, heading north');
  eq(pointAlong(p, 2).lat, 41.8, 'clamped');
});

test('demo fetch: answers the three feed URLs without the network, waits for static data, 404 otherwise', async () => {
  const { state, segments } = await realState();
  const store = createStore({ ...state, staticLoaded: false });
  const realFetch = globalThis.fetch, seen = [];
  globalThis.fetch = (...a) => { seen.push(String(a[0])); return realFetch(...a); };
  try {
    const f = demoFetch(store, { now: () => NIGHT, segments: async () => segments });
    const p = f('https://passio3.com/chicago/passioTransit/gtfs/realtime/vehiclePositions.json?_=1', {});
    let done = false;
    p.then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 20));
    ok(!done, 'waits for the static data');
    store.set({ staticLoaded: true });
    const r = await p;
    ok(r.ok && r.status === 200 && (await r.json()).entity.length >= 1, 'vehicles');
    eq((await (await f('https://passio3.com/chicago/passioTransit/gtfs/realtime/serviceAlerts.json?_=2')).json()).entity[0].id, 'demo');
    eq((await f('https://example.com/other.json')).status, 404);
    eq(seen.filter((u) => /passio3|example\.com/.test(u)), [], 'never fetched the network');
  } finally { globalThis.fetch = realFetch; }
});

test('demo fetch + live.js: the app store fills with simulated buses and never mixes in the real feed', async () => {
  const { state, segments } = await realState();
  const store = createStore({ ...state, buses: [], trips: [], alerts: [], feedTs: 0, lastOk: 0, failed: false, liveLoaded: false });
  const calls = [];
  const fake = demoFetch(store, { segments: async () => segments });
  const live = startLive(store, { intervalMs: 100000, fetch: (u, i) => { calls.push(u); return fake(u, i); } });
  try {
    await live.pollNow();
    const s = store.get();
    ok(s.liveLoaded && !s.failed && s.buses.length >= 1 && s.trips.length === s.buses.length, 'buses + trips: ' + s.buses.length);
    ok(s.buses.every((b) => String(b.vehicle.id).startsWith('demo-')), 'only simulated vehicles');
    eq(s.alerts.map((a) => a.header_text.translation[0].text), [DEMO_TITLE]);
    eq(calls.length, 3);
  } finally { live.stop(); }
});

test('storage: demo memory overlay reads saved prefs, keeps every write in memory, never touches localStorage', () => {
  const k = 'demo-overlay-test';
  save(k, { real: 1 });
  ok(!memoryOverlay(), 'off on test pages');
  useMemoryOverlay(true);
  try {
    eq(load(k, null), { real: 1 }, 'reads fall through to the saved value');
    ok(save(k, { demo: 2 }));
    eq(load(k, null), { demo: 2 }, 'the session sees its own change');
    eq(JSON.parse(localStorage.getItem('sb:' + k)), { real: 1 }, 'localStorage unchanged');
    ok(remove(k));
    eq(load(k, 'gone'), 'gone', 'removed in the session');
    eq(JSON.parse(localStorage.getItem('sb:' + k)), { real: 1 }, 'still saved for real');
    const circ = {}; circ.c = circ;
    eq(save('circ', circ), false, 'never throws');
  } finally { useMemoryOverlay(false); }
  eq(load(k, null), { real: 1 }, 'overlay off: the real value again');
  remove(k);
});

import { test, eq, ok } from './lib.js';
import { createStore } from '../js/core/store.js';
import { loadStatic, deriveStopRoutes, cleanSlice } from '../js/data/static.js';
import { res, stubFetch } from './data-helpers.js';

const FILES = {
  'routes.json': { r1: { short: 'A', long: 'Alpha', color: '#ff0000', text_color: '#ffffff' }, r2: { short: 'B', long: 'Beta', color: '#00ff00', text_color: '#000000' } },
  'stops.json': { s1: { name: 'One', lat: 41.79, lon: -87.6 }, s2: { name: 'Two', lat: '41.80', lon: '-87.59' }, bad: { name: 'Bad', lat: 'x', lon: 1 } },
  'shapes.json': { r1: [[[41.79, -87.6], [41.8, -87.59]]], r2: [] },
  'route_stops.json': { r1: ['s1', 's2', 's1'], r2: ['s2'] },
  'stop_addresses.json': { s1: { address: '1 Main St' }, s2: { street: 'no address field' } },
  'service.json': { generated: 'x', feed: { start: '2026-10-07', end: '2026-11-07' }, routes: {
    r1: { days: { mon: { first: '07:00', last: '19:00', trips: 3, buses: [] }, sat: 'bad' }, exceptions: [{ date: '2026-11-26', type: 'removed', hours: null }, 5] },
    r2: 'bad' } },
};
const fileOf = (url) => url.split('/').pop();
const okFetch = (overrides = {}) => stubFetch((url) => {
  const f = fileOf(url);
  if (f in overrides) return overrides[f]();
  return res(FILES[f]);
});

test('static: loads all files, derives stopRoutes, sets staticLoaded in one patch', async () => {
  const store = createStore({ staticLoaded: false });
  let notes = 0;
  store.subscribe(() => notes++);
  const f = okFetch();
  const out = await loadStatic(store, { base: 'data/', fetch: f });
  const s = store.get();
  eq(out.failed, []);
  eq(s.staticLoaded, true);
  eq(Object.keys(s.routes), ['r1', 'r2']);
  eq(Object.keys(s.stops), ['s1', 's2'], 'invalid stop dropped');
  eq(s.stops.s2.lat, 41.8, 'string coords coerced');
  eq(s.routeStops.r1, ['s1', 's2', 's1'], 'loop kept (first==last)');
  eq(s.stopRoutes, { s1: ['r1'], s2: ['r1', 'r2'] });
  eq(s.addresses, { s1: { address: '1 Main St' } });
  eq(Object.keys(s.service.routes), ['r1'], 'bad service route dropped');
  eq(s.service.routes.r1.days.mon.first, '07:00');
  eq([s.service.routes.r1.days.sat, s.service.routes.r1.days.sun], [null, null], 'missing/bad days -> null');
  eq(s.service.routes.r1.exceptions.length, 1, 'bad exception dropped');
  ok(f.calls.every((c) => c.url.startsWith('data/')), 'uses base');
  await new Promise((r) => setTimeout(r, 0));
  eq(notes, 1, 'single store notification');
});

test('static: a required file failing leaves an empty slice, retries once, still loads', async () => {
  const store = createStore({});
  let stopCalls = 0;
  const f = okFetch({ 'stops.json': () => { stopCalls++; return res(null, 500); } });
  const out = await loadStatic(store, { fetch: f });
  const s = store.get();
  eq(stopCalls, 2, 'retried once');
  eq(out.failed, ['stops.json']);
  eq(s.stops, {});
  eq(Object.keys(s.routes).length, 2, 'other files still loaded');
  eq(s.stopRoutes.s2, ['r1', 'r2']);
  eq(s.staticLoaded, true);
});

test('static: optional stop_addresses 404 -> addresses {} without retry', async () => {
  const store = createStore({});
  let n = 0;
  const f = okFetch({ 'stop_addresses.json': () => { n++; return res(null, 404); } });
  const out = await loadStatic(store, { fetch: f });
  eq(n, 1);
  eq(out.failed, ['stop_addresses.json']);
  eq(store.get().addresses, {});
  eq(Object.keys(store.get().stops).length, 2);
});

test('static: optional service.json 404 -> service {} without retry, never blocks', async () => {
  const store = createStore({});
  let n = 0;
  const f = okFetch({ 'service.json': () => { n++; return res(null, 404); } });
  const out = await loadStatic(store, { fetch: f });
  eq(n, 1);
  eq(out.failed, ['service.json']);
  eq(store.get().service, {});
  eq(store.get().staticLoaded, true);
  eq(Object.keys(store.get().routes).length, 2);
});

test('static: bad JSON, thrown fetch and non-object bodies never reject', async () => {
  const store = createStore({});
  const f = okFetch({
    'shapes.json': () => res(() => { throw new SyntaxError('bad json'); }),
    'routes.json': () => { throw new TypeError('Failed to fetch'); },
    'route_stops.json': () => res([1, 2, 3]),
  });
  const out = await loadStatic(store, { fetch: f });
  eq(out.failed.sort(), ['route_stops.json', 'routes.json', 'shapes.json']);
  const s = store.get();
  eq(s.shapes, {}); eq(s.routes, {}); eq(s.routeStops, {}); eq(s.stopRoutes, {});
  eq(Object.keys(s.stops).length, 2);
  eq(s.staticLoaded, true);
});

test('static: everything failing still sets staticLoaded with empty slices', async () => {
  const store = createStore({});
  const out = await loadStatic(store, { fetch: async () => { throw new TypeError('offline'); } });
  eq(out.failed.length, 6);
  const s = store.get();
  eq([s.routes, s.stops, s.shapes, s.routeStops, s.stopRoutes, s.addresses, s.service], [{}, {}, {}, {}, {}, {}, {}]);
  eq(s.staticLoaded, true);
});

test('static: deriveStopRoutes / cleanSlice edge cases', () => {
  eq(deriveStopRoutes({ a: ['1', '2', '1'], b: ['2'], c: null }), { 1: ['a'], 2: ['a', 'b'] });
  eq(deriveStopRoutes(undefined), {});
  eq(cleanSlice('stops', null), {});
  eq(cleanSlice('routeStops', { a: ['1', null, 2] }), { a: ['1', '2'] });
  eq(cleanSlice('routes', { a: { short: 5 } }).a.short, '5');
});

test('static: real web/data files load and cross-reference', async () => {
  const store = createStore({});
  const out = await loadStatic(store, { base: '../data/' });
  const s = store.get();
  eq(out.failed, []);
  ok(Object.keys(s.routes).length > 0, 'routes');
  ok(Object.keys(s.stops).length > 0, 'stops');
  ok(Object.keys(s.stopRoutes).length > 0, 'stopRoutes');
  ok(Object.keys(s.service.routes || {}).length > 0, 'service.json routes');
  for (const rid of Object.keys(s.service.routes)) ok(s.routes[rid], 'service route exists: ' + rid);
  for (const [rid, ids] of Object.entries(s.routeStops)) for (const id of ids) ok(s.stopRoutes[id].includes(rid), 'stopRoutes covers ' + id);
});

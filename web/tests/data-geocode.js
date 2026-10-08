import { test, eq, ok } from './lib.js';
import { searchPlaces, debounce, clearPlaceCache, featureToPlace, PHOTON } from '../js/data/geocode.js';
import { res, hang, stubFetch, sleep } from './data-helpers.js';

const PHOTON_BODY = {
  features: [
    { geometry: { coordinates: [-87.5987, 41.7886] }, properties: { name: 'Regenstein Library', street: 'East 57th Street', housenumber: '1100', city: 'Chicago', state: 'Illinois' } },
    { geometry: { coordinates: [-87.6, 41.79] }, properties: { street: 'South Ellis Avenue', housenumber: '5801', city: 'Chicago' } },
    { geometry: null, properties: { name: 'No coords' } },
  ],
};

test('geocode: maps Photon features, sends only the text with fixed bias, limit 5', async () => {
  clearPlaceCache();
  const f = stubFetch(() => res(PHOTON_BODY));
  const out = await searchPlaces('  regenstein ', { fetch: f });
  eq(out.error, undefined);
  eq(out.items, [
    { label: 'Regenstein Library', sub: '1100 East 57th Street, Chicago, Illinois', lat: 41.7886, lon: -87.5987 },
    { label: '5801 South Ellis Avenue, Chicago', sub: 'Place', lat: 41.79, lon: -87.6 },
  ]);
  eq(f.calls.length, 1);
  const u = new URL(f.calls[0].url);
  eq(u.origin + u.pathname, PHOTON);
  eq(u.searchParams.get('q'), 'regenstein');
  eq(u.searchParams.get('limit'), '5');
  eq([u.searchParams.get('lat'), u.searchParams.get('lon')], ['41.79', '-87.6']);
});

test('geocode: under 3 chars returns no items and no request', async () => {
  const f = stubFetch(() => res(PHOTON_BODY));
  eq(await searchPlaces('ab', { fetch: f }), { items: [] });
  eq(await searchPlaces(null, { fetch: f }), { items: [] });
  eq(f.calls.length, 0);
});

test('geocode: errors are returned, never thrown', async () => {
  clearPlaceCache();
  eq(await searchPlaces('error 500', { fetch: async () => res(null, 500) }), { items: [], error: 'http 500' });
  eq(await searchPlaces('error net', { fetch: async () => { throw new TypeError('Failed to fetch'); } }), { items: [], error: 'network' });
  eq(await searchPlaces('error shape', { fetch: async () => res({ nope: 1 }) }), { items: [], error: 'bad response' });
  eq(await searchPlaces('error json', { fetch: async () => res(() => { throw new SyntaxError('x'); }) }), { items: [], error: 'bad response' });
});

test('geocode: abort via signal resolves {items:[], error:"aborted"}', async () => {
  clearPlaceCache();
  const ctl = new AbortController();
  const f = stubFetch((url, init) => hang(init.signal));
  const p = searchPlaces('slow query', { signal: ctl.signal, fetch: f });
  await sleep(10);
  ctl.abort();
  eq(await p, { items: [], error: 'aborted' });
  ok(f.calls[0].init.signal.aborted, 'inner request aborted');
  const pre = new AbortController();
  pre.abort();
  const g = stubFetch(() => res(PHOTON_BODY));
  eq(await searchPlaces('already aborted', { signal: pre.signal, fetch: g }), { items: [], error: 'aborted' });
  eq(g.calls.length, 0);
});

test('geocode: repeated query is served from memory cache', async () => {
  clearPlaceCache();
  const f = stubFetch(() => res(PHOTON_BODY));
  const a = await searchPlaces('Cached Place', { fetch: f });
  const b = await searchPlaces('cached place', { fetch: f });
  eq(f.calls.length, 1);
  eq(a.items, b.items);
  b.items[0].label = 'mutated';
  eq((await searchPlaces('cached place', { fetch: f })).items[0].label, 'Regenstein Library', 'cache not mutable by callers');
});

test('geocode: featureToPlace rejects bad coordinates', () => {
  eq(featureToPlace({ geometry: { coordinates: ['x', 1] } }, 'q'), null);
  eq(featureToPlace({}, 'q'), null);
  eq(featureToPlace({ geometry: { coordinates: [1, 2] }, properties: {} }, 'q'), { label: 'q', sub: 'Place', lat: 2, lon: 1 });
});

test('debounce: only the last call in a burst runs, after the delay', async () => {
  const seen = [];
  const d = debounce((x) => seen.push(x), 40);
  d(1); d(2); d(3);
  await sleep(15);
  eq(seen, [], 'not yet');
  d(4);
  await sleep(25);
  eq(seen, [], 'timer restarted by the 4th call');
  await sleep(40);
  eq(seen, [4]);
});

test('debounce: cancel drops, flush runs immediately, this is preserved', async () => {
  const seen = [];
  const d = debounce(function (x) { seen.push([this && this.tag, x]); }, 30);
  d(1);
  d.cancel();
  await sleep(50);
  eq(seen, []);
  const obj = { tag: 'o', d };
  obj.d(2);
  obj.d.flush();
  eq(seen, [['o', 2]]);
  await sleep(50);
  eq(seen.length, 1, 'no second run after flush');
  d.flush();
  eq(seen.length, 1, 'flush with nothing pending is a no-op');
});

test('debounce + abort: typing pattern sends one request for the final text', async () => {
  clearPlaceCache();
  const f = stubFetch(() => res(PHOTON_BODY));
  let ctl = null, last = null;
  const run = debounce(async (q) => { ctl?.abort(); ctl = new AbortController(); last = await searchPlaces(q, { signal: ctl.signal, fetch: f }); }, 30);
  for (const q of ['reg', 'rege', 'regen', 'regenstein']) { run(q); await sleep(5); }
  await sleep(80);
  eq(f.calls.length, 1);
  eq(new URL(f.calls[0].url).searchParams.get('q'), 'regenstein');
  eq(last.items.length, 2);
});

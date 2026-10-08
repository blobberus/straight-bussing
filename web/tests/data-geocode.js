import { test, eq, ok } from './lib.js';
import { searchPlaces, debounce, clearPlaceCache, featureToPlace, inIllinois, rankPlaces, PHOTON } from '../js/data/geocode.js';
import { res, hang, stubFetch, sleep } from './data-helpers.js';

const PHOTON_BODY = {
  features: [
    { geometry: { coordinates: [-87.5987, 41.7886] }, properties: { name: 'Regenstein Library', street: 'East 57th Street', housenumber: '1100', city: 'Chicago', state: 'Illinois' } },
    { geometry: { coordinates: [-87.6, 41.79] }, properties: { street: 'South Ellis Avenue', housenumber: '5801', city: 'Chicago' } },
    { geometry: null, properties: { name: 'No coords' } },
  ],
};

/** Photon-like feature. */
const feat = (name, lon, lat, props = {}) => ({ geometry: { coordinates: [lon, lat] }, properties: { name, countrycode: 'US', state: 'Illinois', ...props } });

test('geocode: maps Photon features with a city/state sub line', async () => {
  clearPlaceCache();
  const f = stubFetch(() => res(PHOTON_BODY));
  const out = await searchPlaces('  regenstein ', { fetch: f });
  eq(out.error, undefined);
  eq(out.items, [
    { label: 'Regenstein Library', sub: '1100 East 57th Street, Chicago, IL', lat: 41.7886, lon: -87.5987 },
    { label: '5801 South Ellis Avenue', sub: 'Chicago', lat: 41.79, lon: -87.6 },
  ]);
  eq(f.calls.length, 1);
});

test('geocode: URL sends only the text plus fixed Hyde Park bias and Illinois bbox, asks for 15', async () => {
  clearPlaceCache();
  const f = stubFetch(() => res({ features: [] }));
  eq(await searchPlaces('union station', { fetch: f }), { items: [] });
  const u = new URL(f.calls[0].url);
  eq(u.origin + u.pathname, PHOTON);
  eq(u.searchParams.get('q'), 'union station');
  eq(u.searchParams.get('limit'), '15');
  eq([u.searchParams.get('lat'), u.searchParams.get('lon')], ['41.7886', '-87.5987']);
  eq(u.searchParams.get('bbox'), '-91.52,36.97,-87.49,42.51');
  eq(u.searchParams.get('zoom'), '10');
  eq(u.searchParams.get('location_bias_scale'), '0.2');
  eq(u.searchParams.get('lang'), 'en');
  eq([...u.searchParams.keys()].sort(), ['bbox', 'lang', 'lat', 'limit', 'location_bias_scale', 'lon', 'q', 'zoom']);
});

test('geocode: drops features outside Illinois (other state, other country, no state outside bbox)', async () => {
  clearPlaceCache();
  const body = { features: [
    feat('Springfield', -93.29, 37.21, { state: 'Missouri' }),
    feat('Springfield', -72.59, 42.10, { state: 'Massachusetts' }),
    feat('Regenstein', 10.9, 51.8, { countrycode: 'DE', state: 'Saxony-Anhalt' }),
    feat('Somewhere', -122.68, 45.52, { state: undefined }),
    feat('Lake Spot', -87.7, 41.9, { state: undefined, countrycode: undefined }),
    feat('Springfield', -89.644, 39.799, { osm_key: 'place', osm_value: 'city', county: 'Sangamon' }),
  ] };
  const out = await searchPlaces('springfield', { fetch: async () => res(body) });
  eq(out.items.map((x) => x.label), ['Springfield', 'Lake Spot']);
  eq(out.items[0].sub, 'Sangamon County, IL');
  eq(out.items[0].lat, 39.799);
  ok(inIllinois(feat('x', -87.6, 41.8, { state: 'IL' })), 'IL abbreviation accepted');
  ok(!inIllinois(feat('x', -87.6, 41.8, { state: 'Indiana' })), 'state wins over bbox');
  ok(!inIllinois(feat('x', -87.6, 41.8, { countrycode: undefined, state: undefined, country: 'Canada' })), 'non-US country name');
  eq(await searchPlaces('portland', { fetch: async () => res({ features: [feat('Portland', -122.68, 45.52, { state: 'Oregon' })] }) }), { items: [] });
});

test('geocode: re-ranks by proximity to Hyde Park, max 5 results', () => {
  const far = [];
  for (let i = 0; i < 6; i++) far.push(feat('Target ' + i, -88.2 - i * 0.1, 41.9));   // DuPage etc., 50+ km
  const mid = feat('Target Loop', -87.6555, 41.8771, { street: 'West Jackson Boulevard', housenumber: '1101', city: 'Chicago' });  // ~11 km
  const near = feat('Target Hyde Park', -87.5966, 41.7948, { city: 'Hyde Park Township' });  // < 1 km
  const out = rankPlaces([...far, mid, near], 'target');
  eq(out.length, 5);
  eq(out.slice(0, 3).map((x) => x.label), ['Target Hyde Park', 'Target Loop', 'Target 0']);
  eq(out[0].sub, 'Chicago, IL', 'Chicago township shown as Chicago');
  eq(out[1].sub, '1101 West Jackson Boulevard, Chicago, IL');
  // Photon order still breaks ties inside the same distance tier.
  eq(rankPlaces([feat('A', -87.62, 41.88), feat('B', -87.63, 41.88)], 'x').map((x) => x.label), ['A', 'B']);
});

test('geocode: campus result beats earlier city matches; exact city name is pinned first; dupes merged', () => {
  const zoo = [0, 1, 2].map((i) => feat('Regenstein Zoo House ' + i, -87.633, 41.92 + i * 0.001, { osm_key: 'building', osm_value: 'yes' }));
  const lib = feat('Joseph Regenstein Library', -87.6, 41.7922, { osm_key: 'amenity', osm_value: 'library' });
  eq(rankPlaces([...zoo, lib], 'regenstein')[0].label, 'Joseph Regenstein Library');
  const sp = [feat('Springfield Avenue', -87.719, 41.72), feat('Springfield Avenue', -87.716, 41.65),
    feat('Springfield', -89.644, 39.799, { osm_key: 'place', osm_value: 'city' })];
  eq(rankPlaces(sp, 'Springfield')[0].label, 'Springfield');
  const hamlet = feat('Midway', -87.6, 40.1, { osm_key: 'place', osm_value: 'hamlet' });
  const stop = feat('Midway', -87.738, 41.7867, { osm_key: 'railway', osm_value: 'station' });
  const stop2 = feat('Midway', -87.7383, 41.7869, { osm_key: 'railway', osm_value: 'stop' });
  const park = feat('Midway Plaisance', -87.5939, 41.7876, { osm_key: 'leisure', osm_value: 'park' });
  eq(rankPlaces([hamlet, stop, stop2, park], 'midway').map((x) => x.label + '@' + x.lat), ['Midway Plaisance@41.7876', 'Midway@41.7867', 'Midway@40.1'], 'hamlet not pinned; stops 30 m apart merged');
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
  const first = a.items[0].label;
  b.items[0].label = 'mutated';
  eq((await searchPlaces('cached place', { fetch: f })).items[0].label, first, 'cache not mutable by callers');
});

test('geocode: featureToPlace rejects bad coordinates', () => {
  eq(featureToPlace({ geometry: { coordinates: ['x', 1] } }, 'q'), null);
  eq(featureToPlace({}, 'q'), null);
  eq(featureToPlace({ geometry: { coordinates: [1, 2] }, properties: {} }, 'q'), { label: 'q', sub: 'Place', lat: 2, lon: 1 });
  eq(featureToPlace(feat('Regency Plaza', -87.8, 41.9, { city: 'Leyden Township', district: 'Schiller Park' }), 'q').sub, 'Schiller Park, IL', 'non-Chicago township falls back to district');
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

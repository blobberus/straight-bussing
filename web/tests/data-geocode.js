import { test, eq, ok } from './lib.js';
import { searchPlaces, debounce, clearPlaceCache, featureToPlace, inIllinois, rankPlaces, mergePlaces, PHOTON } from '../js/data/geocode.js';
import { setPlaces, searchLocal, norm, loadPlaces } from '../js/data/places.js';
import { res, hang, stubFetch, sleep } from './data-helpers.js';

// Photon tests run with an empty local index; the local-index tests below use their own fixture.
const NO_PLACES = { stops: [], p: [] };
setPlaces(NO_PLACES);

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
  eq(out.items[0].sub, 'Sangamon County, IL · 280 km from campus', 'far results say how far');
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
  eq(out[0].sub, 'Chicago, IL', 'Chicago township shown as Chicago; near campus: no distance note');
  eq(out[1].sub, '1101 West Jackson Boulevard, Chicago, IL · 11 km from campus');
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

// ---- local index of places within a 30-minute walk of campus stops (data/places.js) ----
const PLACES = { stops: ['Harper Court (NE Corner)', 'Booth School', 'Garfield Red Line Station (EB)'], p: [
  ['Chipotle', 'Fast food', '1522 E 53rd St', 41.7997, -87.588, 0, 1, 'Chipotle mexican fast food'],
  ['Chipotle', 'Fast food', '806 W 63rd St', 41.7799, -87.6463, 2, 29, 'Chipotle mexican fast food'],
  ['Medici on 57th', 'Restaurant', '1327 E 57th St', 41.7912, -87.5937, 1, 4, 'restaurant'],
  ['Medici Bakery', 'Bakery', '1331 E 57th St', 41.7913, -87.5936, 1, 5, 'bakery'],
  ['University of Chicago Medicine Campus', 'Hospital', '5841 S Maryland Ave', 41.7902, -87.6037, 1, 1, 'hospital'],
  ['Chick-fil-A', 'Fast food', '1 Test St', 41.79, -87.6, 1, 6, 'Chick-fil-A chicken fast food'],
  ['Starbucks', 'Cafe', '1530 E 53rd St', 41.7998, -87.5876, 0, 1, 'Starbucks coffee_shop cafe'],
  ['Plein Air Cafe', 'Cafe', '5751 S Woodlawn Ave', 41.7895, -87.5965, 1, 2, 'cafe'],
  ['Vue53 Apartments', 'Apartments', '1330 E 53rd St', 41.7995, -87.5935, 0, 3, 'apartments'],
  ['1121-1133 E 61st St', 'Apartments', '', 41.7843, -87.597, 1, 1, 'apartments'],
] };

test('places: normalization ignores case, accents, punctuation and spaces', () => {
  eq(norm("Chick-fil-A"), 'chick fil a');
  eq(norm("  Café  Ñandú & Co. "), 'cafe nandu and co');
  eq(norm("Harold's"), 'harolds');
});

test('places: Chipotle, chickfila (no hyphens), Medici (whole word beats Medicine), nearest first', () => {
  setPlaces(PLACES);
  const chip = searchLocal('chipotle');
  eq(chip.map((x) => x.sub.split(' · ')[0].split(', ').pop()), ['1522 E 53rd St', '806 W 63rd St'], 'Hyde Park one first (1 min walk)');
  ok(chip.every((x) => x.sub.split(' · ').length <= 2), 'at most one middle dot: "Kind, address · N min walk to stop"');
  ok(chip[0].sub.endsWith('1 min walk to Harper Court (NE Corner)') && chip[0].local, 'walk to the nearest stop');
  eq(searchLocal('chickfila')[0]?.label, 'Chick-fil-A', 'spaces and hyphens ignored');
  eq(searchLocal('chick fil a')[0]?.label, 'Chick-fil-A');
  eq(searchLocal('medici').map((x) => x.label).slice(0, 3), ['Medici on 57th', 'Medici Bakery', 'University of Chicago Medicine Campus']);
  eq(searchLocal('chipolte')[0]?.label, 'Chipotle', 'one swapped letter still finds it');
  eq(searchLocal('medi')[0]?.label, 'Medici on 57th', 'prefix');
  setPlaces(NO_PLACES);
});

test('places: categories and apartments ("coffee", "apartments", "vue")', () => {
  setPlaces(PLACES);
  eq(searchLocal('coffee').map((x) => x.label), ['Starbucks', 'Plein Air Cafe'], 'cafes by walking time');
  eq(searchLocal('apartments').map((x) => x.label), ['Vue53 Apartments', '1121-1133 E 61st St'], 'named complexes first, then address-only buildings');
  eq(searchLocal('vue53')[0]?.label, 'Vue53 Apartments');
  eq(searchLocal('zzqx'), []);
  setPlaces(NO_PLACES);
});

test('places: search merges local first, asks Photon only when the local index has < 5 matches', async () => {
  clearPlaceCache();
  setPlaces(PLACES);
  const far = { features: [feat('Chipotle', -87.62, 41.88, { street: 'South Wabash Avenue', city: 'Chicago' }),
    feat('Chipotle', -87.6463, 41.7799, { street: 'West 63rd Street', city: 'Chicago' })] };      // same as a local one
  const f = stubFetch(() => res(far));
  const out = await searchPlaces('chipotle', { fetch: f });
  eq(f.calls.length, 1, 'only 2 local matches: Photon asked too');
  eq(out.items.map((x) => x.local ? 'local' : 'photon'), ['local', 'local', 'photon'], 'local first; the 63rd St duplicate merged');
  ok(out.items[2].sub.includes('km from campus'), 'far Photon result says how far');
  clearPlaceCache();
  const big = { stops: ['A'], p: Array.from({ length: 6 }, (_, i) => ['Pizza place ' + i, 'Restaurant', '', 41.79, -87.6, 0, i + 1, 'pizza']) };
  setPlaces(big);
  const g = stubFetch(() => res(far));
  const pz = await searchPlaces('pizza', { fetch: g });
  eq([g.calls.length, pz.items.length], [0, 5], 'answered locally: the typed text is not sent to Photon');
  clearPlaceCache();
  setPlaces(PLACES);
  const off = await searchPlaces('medici', { fetch: async () => { throw new TypeError('offline'); } });
  eq(off.items.map((x) => x.label).slice(0, 2), ['Medici on 57th', 'Medici Bakery'], 'offline: local results still come back');
  ok(!off.error, 'no error when local results exist');
  setPlaces(NO_PLACES);
  clearPlaceCache();
});

test('places: mergePlaces treats a contained name within 150 m as the same place', () => {
  const local = [{ label: 'Joseph Regenstein Library', lat: 41.7922, lon: -87.5999, local: true }];
  const remote = [{ label: 'Regenstein Library', lat: 41.7925, lon: -87.6 }, { label: 'Regenstein Library', lat: 41.92, lon: -87.63 }];
  eq(mergePlaces(local, remote).map((x) => x.lat), [41.7922, 41.92]);
});

test('places: the real data/places.json loads and finds the campus examples', async () => {
  setPlaces(null);
  const okLoad = await loadPlaces();
  ok(okLoad, 'data/places.json loaded');
  const chip = searchLocal('Chipotle')[0];
  ok(chip && chip.sub.includes('53rd'), 'Hyde Park Chipotle: ' + JSON.stringify(chip));
  ok(searchLocal('medici').some((x) => x.label === 'Medici on 57th'), 'Medici on 57th');
  setPlaces(NO_PLACES);
});

/** Tests for map/style.js patchStyle (fixture JSON + optional live OpenFreeMap styles). */
import { test, eq, ok } from './lib.js';
import { patchStyle, emptyStyle, PALETTE, LANDMARK_Z, landmarkGeoJSON, campusFilter } from '../js/map/style.js';
import { POSITRON, DARK } from './map-fixtures.js';

const ids = (s) => s.layers.map((l) => l.id);
const byId = (s, id) => s.layers.find((l) => l.id === id);
const lumHex = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
};
const contrast = (a, b) => { const x = lumHex(a), y = lumHex(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('patchStyle: woods are a flat palette fill (the dark style asks for a "wood-pattern" sprite that does not exist)', () => {
  const base = { version: 8, sources: {}, layers: [{ id: 'landcover_wood', type: 'fill', paint: { 'fill-pattern': 'wood-pattern', 'fill-opacity': 0.4 } }] };
  for (const dark of [false, true]) {
    const l = byId(patchStyle(base, dark), 'landcover_wood');
    eq([l.paint['fill-pattern'], l.paint['fill-color'], l.paint['fill-opacity']], [undefined, (dark ? PALETTE.dark : PALETTE.light).wood, 0.4]);
  }
  eq(base.layers[0].paint['fill-pattern'], 'wood-pattern', 'input untouched');
});

test('patchStyle: pure (input untouched, output is a copy)', () => {
  const before = JSON.stringify(POSITRON);
  const out = patchStyle(POSITRON, false);
  eq(JSON.stringify(POSITRON), before);
  ok(out !== POSITRON && out.layers !== POSITRON.layers);
  ok(patchStyle(null, true).layers.length >= 5, 'tolerates null');
});

for (const [name, base, dark] of [['positron', POSITRON, false], ['dark', DARK, true]]) {
  test(`patchStyle(${name}): street names replaced, ordered, legible`, () => {
    const s = patchStyle(base, dark), L = ids(s), P = dark ? PALETTE.dark : PALETTE.light;
    ok(!L.some((id) => /^(highway-name-|highway_name_other$)/.test(id)), 'original street-name layers removed');
    const order = ['sb_housenumber', 'sb_poi_campus', 'sb_name_path', 'sb_name_minor', 'sb_name_major'].map((id) => L.indexOf(id));
    ok(order.every((i) => i >= 0), 'added layers present');
    eq([...order].sort((a, b) => a - b), order, 'house numbers < campus < path < minor < major');
    ok(order[0] > L.indexOf('highway_major_inner'), 'labels above road lines');
    for (const id of ['sb_name_path', 'sb_name_minor', 'sb_name_major']) {
      const l = byId(s, id);
      ok(l.layout['text-transform'] !== 'uppercase', id + ' not uppercase');
      eq(l.paint['text-halo-color'], P.halo, id + ' halo in land color');
      ok(l.paint['text-halo-width'] >= 1.5, id + ' halo width');
      eq(l.layout['symbol-placement'], 'line');
      ok(contrast(l.paint['text-color'], P.halo) >= 7, id + ' text vs halo >= 7:1');
    }
    eq(byId(s, 'sb_name_major').layout['text-font'], ['Noto Sans Bold']);
    eq(byId(s, 'sb_name_minor').minzoom, 14);
    eq(byId(s, 'sb_housenumber').minzoom, 17, 'house numbers from z17');
    eq(byId(s, 'sb_housenumber')['source-layer'], 'housenumber');
    ok(contrast(P.hn, P.halo) >= 4.5, 'house number contrast');
    ok(contrast(P.textMinor, P.minor) >= 4.5, 'minor street text on road fill');
    eq(byId(s, 'background').paint['background-color'], P.bg);
    eq(byId(s, 'sb_poi_campus').layout['icon-image'], undefined, 'campus names are text only');
  });

  test(`patchStyle(${name}): road casing + clutter hidden`, () => {
    const s = patchStyle(base, dark), L = ids(s), P = dark ? PALETTE.dark : PALETTE.light;
    eq(L.indexOf('sb_minor_casing'), L.indexOf('highway_minor') - 1, 'casing directly below minor roads');
    eq(byId(s, 'sb_minor_casing').paint['line-color'], P.minorCase);
    eq(byId(s, 'highway_minor').paint['line-color'], P.minor);
    eq(byId(s, 'highway_major_casing').paint['line-color'], P.majorCase);
    ok(contrast(P.minor, P.minorCase) >= 1.4 || contrast(P.minor, P.bg) >= 1.4, 'roads stand out from land');
    for (const l of s.layers) {
      if (/^(highway-shield|road_shield|road_oneway)/.test(l.id)) eq(l.layout.visibility, 'none', l.id + ' hidden');
    }
    eq(new Set(L).size, L.length, 'unique layer ids');
  });
}

test('patchStyle: landmarks (building and place names, owner 2026-10-13) by tier, above minor streets, no name twice', () => {
  const lm = [{ name: 'Regenstein Library', lat: 41.792, lon: -87.6, tier: 1, kind: 'library', osm: 'Joseph Regenstein Library' },
    { name: 'Max Palevsky East', lat: 41.7928, lon: -87.5987, tier: 1, kind: 'dorm', osm: 'Max Palevsky Commons East' },
    { name: 'Cobb Hall', lat: 41.789, lon: -87.601, tier: 2, kind: 'academic', osm: 'Cobb Hall' },
    { name: 'Swift Hall', lat: 41.7889, lon: -87.6002, tier: 3, kind: 'academic', osm: 'Swift Hall' }, { name: 'bad', lat: 'x', tier: 1 }];
  for (const [base, dark] of [[POSITRON, false], [DARK, true]]) {
    const s = patchStyle(base, dark, lm), L = ids(s), P = dark ? PALETTE.dark : PALETTE.light;
    const src = s.sources.sb_landmarks;
    eq(src.type, 'geojson');
    eq(src.data.features.map((f) => [f.properties.name, f.properties.t, f.properties.r]), [['Regenstein Library', 1, 0], ['Max Palevsky East', 1, 1], ['Cobb Hall', 2, 2], ['Swift Hall', 3, 3]]);
    eq(src.data.features[0].geometry.coordinates, [-87.6, 41.792], 'GeoJSON is lon, lat');
    eq([1, 2, 3].map((t) => byId(s, 'sb_landmarks_' + t).minzoom), [LANDMARK_Z[1], LANDMARK_Z[2], LANDMARK_Z[3]]);
    ok(LANDMARK_Z[1] < 15, 'tier 1 shows at the zoom the app opens at (15)');
    const at = (id) => L.indexOf(id);
    ok(at('sb_name_minor') < at('sb_landmarks_3') && at('sb_landmarks_3') < at('sb_landmarks_2') && at('sb_landmarks_2') < at('sb_landmarks_1') && at('sb_landmarks_1') < at('sb_name_major'),
      'minor streets < tier 3 < tier 2 < tier 1 < major streets (upper layers win collisions)');
    const l1 = byId(s, 'sb_landmarks_1');
    eq(l1.layout['symbol-sort-key'], ['get', 'r'], 'list order = priority');
    eq(l1.layout['icon-image'], undefined, 'text only');
    ok(contrast(l1.paint['text-color'], P.halo) >= 7, 'landmark text vs halo >= 7:1');
    const f = JSON.stringify(byId(s, 'sb_poi_campus').filter);
    ok(f.includes('Joseph Regenstein Library') && f.includes('Cobb Hall'), 'campus names skip what a landmark already shows');
    eq(byId(s, 'sb_poi_campus').minzoom, 16, 'other campus names only from z16');
  }
  eq(patchStyle(POSITRON, false).sources.sb_landmarks.data.features, [], 'before they load: an empty source the map can fill');
  eq(landmarkGeoJSON(null).features, []);
  eq(campusFilter([]).length, 3, 'no landmarks: the plain campus filter');
});

test('patchStyle: dark keeps motorway names, recolors place labels', () => {
  const s = patchStyle(DARK, true);
  ok(byId(s, 'highway_name_motorway'), 'motorway names untouched');
  eq(byId(s, 'highway_name_motorway').paint['text-color'], 'rgb(117, 129, 145)');
  eq(byId(s, 'place_suburb').paint['text-color'], PALETTE.dark.place);
  ok(contrast(PALETTE.dark.place, PALETTE.dark.bg) >= 4.5, 'place labels readable on dark land');
});

test('patchStyle: light and dark differ; emptyStyle matches palette', () => {
  const a = patchStyle(POSITRON, false), b = patchStyle(POSITRON, true);
  ok(byId(a, 'sb_name_major').paint['text-color'] !== byId(b, 'sb_name_major').paint['text-color']);
  eq(emptyStyle(true).layers[0].paint['background-color'], PALETTE.dark.bg);
  eq(emptyStyle(false).layers[0].paint['background-color'], PALETTE.light.bg);
});

test('patchStyle (online): real OpenFreeMap styles patch cleanly', async () => {
  let pos, dk;
  try {
    [pos, dk] = await Promise.all(['positron', 'dark'].map((n) => fetch('https://tiles.openfreemap.org/styles/' + n).then((r) => r.json())));
  } catch (e) { console.warn('offline: skipped live style check'); return; }
  const fonts = new Set(['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic']);
  for (const [base, dark] of [[pos, false], [dk, true]]) {
    const s = patchStyle(base, dark), L = ids(s);
    eq(new Set(L).size, L.length, 'unique ids');
    for (const id of ['sb_minor_casing', 'sb_housenumber', 'sb_poi_campus', 'sb_name_major', 'sb_name_minor', 'sb_name_path']) ok(L.includes(id), id);
    ok(L.indexOf('sb_name_major') > L.indexOf('highway_major_inner'));
    for (const l of s.layers) {
      if (l.source) ok(s.sources[l.source], l.id + ' source exists');
      ok(!l.paint?.['fill-pattern'], l.id + ' needs no sprite pattern (missing images warn in the console)');
      const f = l.layout?.['text-font'];
      if (Array.isArray(f) && typeof f[0] === 'string') ok(f.every((x) => fonts.has(x)), l.id + ' font available: ' + f);
    }
  }
});

test('map.css: the map blue is the UI accent token (no literal #0a84ff; design audit 2026-10-10)', async () => {
  const css = await (await fetch('../css/map.css', { cache: 'no-store' })).text();
  ok(!/#0a84ff/i.test(css), 'no literal #0a84ff left');
  ok(/\.sb-map\{[^}]*--sb-accent:var\(--accent-fill/.test(css.replace(/\s+/g, '')), 'light map: --accent-fill');
  ok(/\.sb-map\.sb-dark\{[^}]*--sb-accent:var\(--accent[,)]/.test(css.replace(/\s+/g, '')), 'dark map: --accent');
});

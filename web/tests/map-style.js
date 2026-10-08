/** Tests for map/style.js patchStyle (fixture JSON + optional live OpenFreeMap styles). */
import { test, eq, ok } from './lib.js';
import { patchStyle, emptyStyle, PALETTE } from '../js/map/style.js';
import { POSITRON, DARK } from './map-fixtures.js';

const ids = (s) => s.layers.map((l) => l.id);
const byId = (s, id) => s.layers.find((l) => l.id === id);
const lumHex = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
};
const contrast = (a, b) => { const x = lumHex(a), y = lumHex(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

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
      const f = l.layout?.['text-font'];
      if (Array.isArray(f) && typeof f[0] === 'string') ok(f.every((x) => fonts.has(x)), l.id + ' font available: ' + f);
    }
  }
});

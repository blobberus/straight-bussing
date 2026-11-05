/** Tests for map/style.js patchStyle (fixture JSON + optional live OpenFreeMap styles). */
import { test, eq, ok } from './lib.js';
import { patchStyle, emptyStyle, PALETTE, campusFilter, symbolIds } from '../js/map/style.js';
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

test('patchStyle: campus names step back for the curated landmarks (map/landmarks.js), never a name twice', () => {
  const lm = [{ name: 'Regenstein Library', lat: 41.792, lon: -87.6, tier: 1, kind: 'library', osm: 'Joseph Regenstein Library' },
    { name: 'Cobb Hall', lat: 41.789, lon: -87.601, tier: 2, kind: 'academic', osm: 'Cobb Hall' }];
  for (const [base, dark] of [[POSITRON, false], [DARK, true]]) {
    const s = patchStyle(base, dark, lm), L = ids(s);
    ok(!L.some((id) => /^sb_landmarks/.test(id)) && !s.sources.sb_landmarks, 'landmarks are not basemap text (route lines would cut them)');
    const f = JSON.stringify(byId(s, 'sb_poi_campus').filter);
    ok(f.includes('Joseph Regenstein Library') && f.includes('Cobb Hall'), 'campus names skip what a landmark already shows');
    eq(byId(s, 'sb_poi_campus').minzoom, 17, 'basemap campus names only at the closest zoom (MapLibre 17 = map 18)');
  }
  eq(campusFilter([]).length, 3, 'no landmarks: the plain campus filter');
  eq(JSON.stringify(patchStyle(POSITRON, false).layers.find((l) => l.id === 'sb_poi_campus').filter), JSON.stringify(campusFilter([])));
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

test('map.css: the map blues are the UI tokens (no literal #0a84ff; DESIGN-SPEC 11.4)', async () => {
  const css = await (await fetch('../css/map.css', { cache: 'no-store' })).text(), flat = css.replace(/\s+/g, '');
  ok(!/#0a84ff/i.test(css), 'no literal #0a84ff left');
  ok(/\.sb-map\{[^}]*--sb-accent:var\(--tint-fill/.test(flat) && /\.sb-map\.sb-dark\{[^}]*--sb-accent:var\(--tint-fill/.test(flat), 'the dot, walking path and callouts: tintFill in both themes');
  ok(/\.sb-map\{[^}]*--sb-tint:var\(--tint[,)]/.test(flat) && /\.sb-map\.sb-dark\{[^}]*--sb-tint:var\(--tint[,)]/.test(flat), 'rings and outlines: tint');
});

/* ---------- the Apple Maps-like palette (owner 2026-11-04: "Change the background map to resemble something closer to
   apple maps", "the current map should make green spaces like parks actually green") ---------- */
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hsl = (hex) => {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
};

test('palette: parks and woods are clearly green, water a clear blue, land warm off-white (light) / neutral dark gray (dark)', () => {
  for (const [theme, P] of [['light', PALETTE.light], ['dark', PALETTE.dark]]) {
    for (const k of ['park', 'wood', 'pitch']) {
      const c = hsl(P[k]);
      ok(c.h >= 85 && c.h <= 150, `${theme} ${k} ${P[k]}: a green hue (${c.h.toFixed(0)})`);
      ok(c.s >= (theme === 'light' ? 0.35 : 0.25), `${theme} ${k}: not desaturated (s ${c.s.toFixed(2)})`);
      ok(contrast(P[k], P.bg) >= 1.2, `${theme} ${k}: stands out from the land (${contrast(P[k], P.bg).toFixed(2)}:1)`);
    }
    ok(hsl(P.wood).l < hsl(P.park).l, `${theme}: woods a step deeper than parks`);
    const w = hsl(P.water);
    ok(w.h >= 195 && w.h <= 220 && w.s >= 0.45, `${theme} water ${P.water}: a clear blue (h ${w.h.toFixed(0)}, s ${w.s.toFixed(2)})`);
    ok(contrast(P.water, P.bg) >= 1.3, `${theme}: water stands out from the land`);
    const [r, , b] = rgbOf(P.bg), land = hsl(P.bg);
    if (theme === 'light') ok(land.l >= 0.92 && r > b && land.s <= 0.4, `light land ${P.bg}: a warm off-white`);
    else ok(land.l <= 0.16 && Math.abs(r - b) <= 8, `dark land ${P.bg}: a neutral dark gray`);
    eq(P.halo, P.bg, `${theme}: label halos in the land color`);
    eq(P.minor, theme === 'light' ? '#ffffff' : P.minor, `${theme}: white streets in light`);
    ok(contrast(P.text, P.halo) >= 7 && contrast(P.textMinor, P.halo) >= 7 && contrast(P.place, P.halo) >= 4.5 && contrast(P.waterText, P.halo) >= 4.5, `${theme}: a quiet but legible label hierarchy`);
  }
  const mot = hsl(PALETTE.light.motorway), dm = hsl(PALETTE.dark.motorway);
  ok(mot.h >= 32 && mot.h <= 50 && mot.s >= 0.6, 'light: motorways yellow-orange (Apple Maps)');
  ok(dm.h >= 30 && dm.h <= 55 && dm.l <= 0.35, 'dark: motorways a muted amber');
  for (const [theme, P] of [['light', PALETTE.light], ['dark', PALETTE.dark]]) {
    for (const k of ['minor', 'minorCase', 'major', 'majorCase', 'path']) ok(hsl(P[k]).s <= 0.15, `${theme} ${k} ${P[k]}: a neutral street color, never yellow`);
  }
});

test('palette: patchStyle adds the green and campus fills just below water (lagoons in a park stay blue)', () => {
  for (const [base, dark] of [[POSITRON, false], [DARK, true]]) {
    const s = patchStyle(base, dark), L = ids(s), P = dark ? PALETTE.dark : PALETTE.light, w = L.indexOf('water');
    const order = ['sb_campus', 'sb_cemetery', 'sb_green', 'sb_pitch'].map((id) => L.indexOf(id));
    ok(order.every((i) => i >= 0 && i < w), 'every added fill sits below water');
    eq([...order].sort((a, b) => a - b), order, 'campus < cemetery < green < pitch');
    const g = byId(s, 'sb_green');
    eq([g['source-layer'], g.paint['fill-color']], ['landcover', P.park]);
    ok(JSON.stringify(g.filter).includes('"grass"'), 'grass covers parks, recreation grounds, lawns, gardens, golf courses');
    eq(byId(s, 'sb_pitch').paint['fill-color'], P.pitch);
    ok(JSON.stringify(byId(s, 'sb_pitch').filter).includes('"pitch"'), 'sports fields');
    eq(byId(s, 'water').paint['fill-color'], P.water);
    ok(byId(s, 'park') ? byId(s, 'park').paint['fill-color'] === P.park : true, 'nature reserves green too');
    eq(new Set(L).size, L.length, 'unique ids');
  }
  const noWater = patchStyle({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] }, false);
  eq(ids(noWater).slice(0, 5), ['background', 'sb_campus', 'sb_cemetery', 'sb_green', 'sb_pitch'], 'no water layer: right above the background');
});

// The route-line edge test (every line keeping a 3:1 edge through its casing or the flipped casing) went with the casing
// (owner 2026-11-04: "Remove the outlines on each line"); the land token check stays.
test('palette: the land token is the basemap land (first paint = map)', async () => {
  const css = await (await fetch('../css/tokens.css', { cache: 'no-store' })).text();
  const vals = (name) => [...css.matchAll(new RegExp(name + ':\s*([^;]+);', 'g'))].map((m) => m[1].trim());
  const [landL, landD] = vals('--map-land');
  eq([landL, landD], [PALETTE.light.bg, PALETTE.dark.bg], 'the land token is the basemap land (first paint = map)');
});

// Owner 2026-11-04: "Do not make the main streets yellow. The highways being yellow is ok. This coloring of roads can
// confuse the user to think it is a bus line." Every road layer of the patched styles except motorways: no yellow or
// orange hue (fixtures, and the live OpenFreeMap styles when online).
test('palette: no road but a motorway is yellow or orange (a street must never look like a bus line)', async () => {
  const probe = document.body.appendChild(document.createElement('i'));
  const rgb = (c) => { probe.style.color = ''; probe.style.color = c; return probe.style.color ? getComputedStyle(probe).color : null; };
  const colorsIn = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(colorsIn) : []).filter((x) => /^(#|rgb|hsl)/.test(x));
  const warm = (c) => {
    const m = String(rgb(c) || '').match(/[\d.]+/g);
    if (!m) return false;
    const [r, g, b, a = 1] = m.map(Number), hex = '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const x = hsl(hex);
    return a > 0.3 && x.s > 0.2 && x.l > 0.12 && x.l < 0.97 && x.h >= 18 && x.h <= 70;
  };
  const styles = [['positron fixture', POSITRON, false], ['dark fixture', DARK, true]];
  try {
    const live = await Promise.all(['positron', 'dark'].map((n) => fetch('https://tiles.openfreemap.org/styles/' + n).then((r) => r.json())));
    styles.push(['positron (live)', live[0], false], ['dark (live)', live[1], true]);
  } catch (e) { console.warn('offline: live styles skipped'); }
  const bad = [];
  let motorways = 0;
  for (const [name, base, dark] of styles) {
    for (const l of patchStyle(base, dark).layers) {
      if (l.type !== 'line' || !/^(highway|road|bridge|tunnel|sb_minor)/.test(l.id)) continue;
      const cols = colorsIn(l.paint && l.paint['line-color']);
      if (/motorway/.test(l.id)) { if (cols.some(warm)) motorways++; continue; }
      for (const c of cols) if (warm(c)) bad.push(`${name} ${l.id}: ${c}`);
    }
  }
  probe.remove();
  eq(bad, [], 'yellow / orange non-motorway roads');
  ok(motorways >= 2, 'the motorways stay yellow-orange (' + motorways + ' layers)');
});

test('basemap text check: the symbol layers are read once per style change, not on every box (2026-11-05 optimization run)', () => {
  let reads = 0;
  const gl = { getStyle: () => { reads++; return { layers: [{ id: 'road', type: 'line' }, { id: 'name', type: 'symbol' }, { id: 'poi', type: 'symbol' }] }; } };
  const cache = {};
  for (let i = 0; i < 50; i++) eq(symbolIds(gl, cache, 3), ['name', 'poi']);
  eq(reads, 1, 'fifty boxes, one style read');
  symbolIds(gl, cache, 4);
  eq(reads, 2, 'a style change (styledata) reads it again');
  const gl2 = { getStyle: () => { reads++; return { layers: [{ id: 'other', type: 'symbol' }] }; } };
  eq(symbolIds(gl2, cache, 4), ['other'], 'a rebuilt map (WebGL context lost) is read again');
  eq(reads, 3);
});

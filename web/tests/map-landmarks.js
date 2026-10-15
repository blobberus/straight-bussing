// map/landmarks.js: building and place names (owner request 2026-10-13), placed above the route lines, around stops,
// each other and the basemap's own street names.
import { test, eq, ok } from './lib.js';
import { createLandmarkLayer, placeLabels, wrapLines, labelSize, labelText, LANDMARK_Z, LABEL } from '../js/map/landmarks.js';
import { cleanLandmarks } from '../js/data/static.js';
import { createMap } from '../js/map/map.js';

const C = (id, x, y, w = 60, h = 14, tier = 1) => ({ id, x, y, w, h, tier });
const view = { w: 400, h: 600 };

test('landmarks: sizes by tier and zoom, word wrap', () => {
  eq([labelSize(1, 14.5), labelSize(1, 18), labelSize(2, 16), labelSize(3, 19)], [11.5, 14.5, 11, 14]);
  ok(labelSize(1, 16) > labelSize(1, 15), 'grows as you zoom in');
  const w = (s) => s.length * 7;
  eq(wrapLines('Regenstein Library', 80, w), ['Regenstein', 'Library']);
  eq(wrapLines('Law School', 80, w), ['Law School']);
  eq(wrapLines('Supercalifragilistic', 30, w), ['Supercalifragilistic'], 'one long word stays whole');
  eq([LANDMARK_Z[1], LANDMARK_Z[2], LANDMARK_Z[3]], [14.5, 16, 17], 'the detailed names a little closer in (owner 2026-10-14)');
  ok(LANDMARK_Z[1] < 15, 'tier 1 shows when the app opens (zoom 15)');
});

test('landmarks: priority order, centered first, a side when blocked, never on a stop or another name', () => {
  let p = placeLabels([C('a', 200, 300), C('b', 205, 302)], [], view);
  eq(p.map((q) => [q.id, q.anchor]), [['a', 'center'], ['b', 'below']], 'the second takes a free side');
  const stop = { x: 195, y: 295, w: 13, h: 13 };
  p = placeLabels([C('a', 200, 300)], [stop], view);
  eq(p[0].anchor === 'center', false, 'a stop under the center: moved off it');
  ok(!p[0].covers, 'covers no stop');
  // boxed in on every side within 14 px: left out (it shows when you zoom in)
  const wall = [];
  for (let x = 0; x < 400; x += 10) for (let y = 250; y < 350; y += 10) wall.push({ x, y, w: 10, h: 10 });
  eq(placeLabels([C('a', 200, 300)], wall, view), []);
  eq(placeLabels([C('a', 395, 300)], [], view)[0].anchor, 'left', 'stays inside the view');
});

test('landmarks: street and place names of the basemap are avoided; only tier 1 may sit on them when nothing is clear', () => {
  const textAt = (b) => b.y < 308 && b.y + b.h > 292;   // a street name band through the point
  let p = placeLabels([C('a', 200, 300)], [], view, textAt);
  ok(p.length === 1 && !p[0].onText, 'a clear spot off the street name');
  const everywhere = () => true;
  p = placeLabels([C('a', 200, 300, 60, 14, 1), C('b', 100, 100, 60, 14, 2)], [], view, everywhere);
  eq(p.map((q) => [q.id, q.onText]), [['a', true]], 'tier 1 still shows (center); tier 2 waits for room');
  eq(LABEL.TEXT_OK, { 1: true });
});

function box(id) {
  const d = document.createElement('div');
  d.id = id;
  d.style.cssText = 'position:absolute;left:-2000px;top:0;width:400px;height:600px';
  document.body.appendChild(d);
  return d;
}

test('landmarks layer: drawn above the route lines, by zoom, escaped, hidden from screen readers, never tappable', () => {
  box('t-lm');
  const m = window.L.map('t-lm', { zoomControl: false, attributionControl: false, zoomSnap: 0.25 }).setView([41.7905, -87.599], 15);
  m.createPane('sbLabels').style.zIndex = '410';
  const layer = createLandmarkLayer(m, { pane: 'sbLabels' });
  const el = m.getContainer();
  layer.setData([
    { name: 'Regenstein Library', lat: 41.7922, lon: -87.5999, tier: 1, kind: 'library' },
    { name: 'Cobb <Hall>', lat: 41.789, lon: -87.6009, tier: 2, kind: 'academic' },
    { name: 'Max Palevsky Commons', lat: 41.7929, lon: -87.5998, tier: 1, kind: 'dorm', until: 16 },
    { name: 'Far Away', lat: 41.9, lon: -87.6, tier: 1, kind: 'shop' },
  ]);
  const names = () => [...el.querySelectorAll('.sb-lm')].map((x) => x.textContent);
  ok(names().includes('RegensteinLibrary') || names().includes('Regenstein Library'), 'tier 1 at zoom 15: ' + names());
  ok(names().some((n) => n.startsWith('Max Palevsky')), 'the group name at zoom 15');
  ok(!names().some((n) => n.includes('Cobb')), 'tier 2 waits for 16');
  m.setZoom(15.5, { animate: false });
  layer.refresh();
  ok(!names().some((n) => n.includes('Cobb')), 'tier 2 still waits at 15.5');
  ok(names().some((n) => n.startsWith('Max Palevsky')), 'the group name still shows at 15.5');
  ok(!names().includes('Far Away'), 'out of view: not placed');
  const lab = el.querySelector('.sb-lm');
  eq(lab.getAttribute('aria-hidden'), 'true');
  eq(lab.closest('.leaflet-pane').style.zIndex, '410', 'in the labels pane (above lines 390-402, below stops 420)');
  eq(getComputedStyle(lab).pointerEvents, 'none');
  m.setZoom(16, { animate: false });
  layer.refresh();
  ok(names().some((n) => n.includes('Cobb')), 'tier 2 at 16');
  ok(!names().some((n) => n === 'Max Palevsky Commons' || n === 'Max PalevskyCommons'), 'the group name hides once its buildings show (until)');
  ok(el.innerHTML.includes('Cobb &lt;Hall&gt;'), 'names are escaped');
  layer.setStops([[41.7922, -87.5999]]);
  ok(layer.count() >= 1, 'still placed with a stop on its point (moved off it)');
  m.remove();
});

test('landmarks: an easter-egg nickname replaces the name only close in (owner 2026-10-14, easter-eggs.json)', () => {
  const reg = { name: 'Regenstein Library', egg: 'The Reg', eggZ: 17.5 };
  eq([labelText(reg, 15), labelText(reg, 17.25), labelText(reg, 17.5), labelText(reg, 18)], ['Regenstein Library', 'Regenstein Library', 'The Reg', 'The Reg']);
  eq(labelText({ name: 'Cobb Hall' }, 18), 'Cobb Hall', 'no nickname: the name at every zoom');
  box('t-lm3');
  const m = window.L.map('t-lm3', { zoomControl: false, attributionControl: false, zoomSnap: 0.25 }).setView([41.7922, -87.5999], 17);
  m.createPane('sbLabels');
  const layer = createLandmarkLayer(m, { pane: 'sbLabels' });
  layer.setData([{ name: 'Regenstein Library', lat: 41.7922, lon: -87.5999, tier: 1, kind: 'library', egg: 'The <Reg>', eggZ: 17.5 }]);
  const text = () => [...m.getContainer().querySelectorAll('.sb-lm')].map((x) => x.textContent).join('|');
  ok(text().startsWith('Regenstein'), 'the normal name at 17: ' + text());
  m.setZoom(17.5, { animate: false }); layer.refresh();
  eq(text(), 'The <Reg>', 'the nickname from its zoom on');
  ok(m.getContainer().innerHTML.includes('The &lt;Reg&gt;'), 'escaped like every name');
  m.setZoom(16, { animate: false }); layer.refresh();
  ok(text().startsWith('Regenstein'), 'back to the name when you zoom out');
  m.remove();
});

test('landmarks: the real easter eggs resolve to labels (easter-eggs.json, the owner edits it)', async () => {
  const list = cleanLandmarks(await (await fetch('../data/landmarks.json')).json());
  const eggs = list.filter((x) => x.egg);
  ok(eggs.every((x) => x.eggZ >= 16 && x.eggZ <= 18 && !/[\u2013\u2014]/.test(x.egg)), 'zoom the map reaches, no dash characters');
  for (const n of ['Burton-Judson Courts', 'International House', 'Vue53']) ok(list.some((x) => x.name === n && x.tier === 1), n + ' at tier 1 (owner 2026-10-14)');
});

test('landmarks: the real file loads into the map through MapApi.setLandmarks', async () => {
  box('t-lm2');
  const api = createMap('t-lm2');
  eq(typeof api.setLandmarks, 'function');
  const d = await (await fetch('../data/landmarks.json')).json();
  const list = d.l.map((r) => ({ name: r[0], lat: r[1], lon: r[2], tier: r[3], kind: r[4], osm: r[5], until: r[6] ?? null }));
  ok(list.length >= 80, list.length + ' labels');
  for (const n of ['Regenstein Library', 'Reynolds Club', 'Campus North', 'Woodlawn Commons', 'Burton-Judson Courts', 'International House',
    'Snell-Hitchcock Halls', 'Granville-Grossman Commons', 'Max Palevsky Commons', 'Max Palevsky East']) ok(list.some((x) => x.name === n), n);
  ok(list.filter((x) => x.kind === 'dorm').length >= 10, 'every UChicago dorm is named');
  ok(list.every((x) => !/[\u2013\u2014]/.test(x.name)), 'no dash characters');
  api.leaflet.setView([41.7905, -87.599], 15, { animate: false });
  api.setLandmarks(list);
  ok(api.leaflet.getContainer().querySelectorAll('.sb-lm').length >= 5, 'names on campus at the default zoom');
  api.leaflet.remove();
});

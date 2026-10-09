/** Tests for the map credit (map/credits.js, map/style.js ATTRIBUTION, MapApi wiring) and the About credits. */
import { test, eq, ok, near } from './lib.js';
import { createCredits, SHOW_MS, FADE_MS, MIN_ROOM } from '../js/map/credits.js';
import { ATTRIBUTION, RASTER_ATTRIBUTION, patchStyle } from '../js/map/style.js';
import { createMap } from '../js/map/map.js';
import { renderAbout } from '../js/ui/views/about.js';
import { P } from './map-fixtures.js';

const COPY = /©|&copy;/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function bare(id) {
  const d = document.createElement('div');
  d.id = id;
  d.className = 'sb-map';
  d.style.cssText = 'position:absolute;left:-2000px;top:0;width:400px;height:600px';
  document.body.appendChild(d);
  return window.L.map(d, { zoomControl: false, attributionControl: false }).setView(P(2, 2), 15);
}
const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

test('credit markup: no copyright sign; OpenFreeMap, OpenMapTiles, OpenStreetMap linked', () => {
  ok(!COPY.test(ATTRIBUTION) && !COPY.test(RASTER_ATTRIBUTION), ATTRIBUTION);
  const links = [...parse(ATTRIBUTION).querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href'), a.rel]);
  eq(links, [['OpenFreeMap', 'https://openfreemap.org', 'noopener'], ['OpenMapTiles', 'https://openmaptiles.org/', 'noopener'],
    ['OpenStreetMap', 'https://www.openstreetmap.org/copyright', 'noopener']]);
  eq(parse(ATTRIBUTION).textContent.replace(/\s+/g, ' ').trim(), 'OpenFreeMap · OpenMapTiles · OpenStreetMap');
  eq(parse(RASTER_ATTRIBUTION).querySelector('a').getAttribute('href'), 'https://www.openstreetmap.org/copyright');
  eq(SHOW_MS, 5000, 'shown for five seconds (OSMF guideline)');
});

test('patchStyle: style source credits lose the copyright sign, keep the names', () => {
  const src = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
  const s = patchStyle({ version: 8, sources: { openmaptiles: { type: 'vector', url: 'x', attribution: src }, other: { type: 'geojson' } }, layers: [] }, false);
  const a = s.sources.openmaptiles.attribution;
  ok(!COPY.test(a), a);
  ok(a.includes('>OpenMapTiles</a>') && a.includes('OpenFreeMap') && a.includes('OpenStreetMap'), a);
  eq(s.sources.other, { type: 'geojson' }, 'sources without credits untouched');
});

test('credits: plain text at load (no bubble, no (i) button), fades out for good after the delay', async () => {
  const m = bare('t-cr1');
  const c = createCredits(m, { html: ATTRIBUTION, showMs: 120 });
  try {
    eq(c.el.getAttribute('aria-label'), 'Map credits');
    ok(!c.el.querySelector('button'), 'no (i) button');
    eq(getComputedStyle(c.el).backgroundColor, 'rgba(0, 0, 0, 0)', 'no bubble background');
    ok(c.isShown() && !c.el.hidden && /OpenStreetMap/.test(c.el.textContent) && !COPY.test(c.el.innerHTML), 'shown at load');
    await sleep(120 + 80);
    ok(!c.isShown() && c.el.classList.contains('is-fading'), 'fading after the delay');
    await sleep(FADE_MS + 100);
    ok(c.el.hidden, 'gone after the fade');
    c.place(100, 600);
    ok(c.el.hidden && !c.el.style.getPropertyValue('--sb-credit-y'), 'stays gone when the sheet moves');
  } finally { c.destroy(); m.remove(); }
});

test('credits: held while a link has keyboard focus or a mouse hovers it; a touch never holds it', async () => {
  const m = bare('t-cr2');
  const c = createCredits(m, { html: ATTRIBUTION, showMs: 80 });
  try {
    const link = c.el.querySelector('a');
    link.focus();
    await sleep(200);
    ok(c.isShown(), 'held while a credit link has focus');
    link.blur();
    await sleep(200);
    ok(!c.isShown(), 'fades once focus leaves');
  } finally { c.destroy(); m.remove(); }
  const m2 = bare('t-cr2b');
  const c2 = createCredits(m2, { html: ATTRIBUTION, showMs: 80 });
  try {
    c2.el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await sleep(200);
    ok(c2.isShown(), 'held while hovered');
    c2.el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await sleep(200);
    ok(!c2.isShown(), 'fades after the mouse leaves');
  } finally { c2.destroy(); m2.remove(); }
  const m3 = bare('t-cr2c');
  const c3 = createCredits(m3, { html: ATTRIBUTION, showMs: 80 });
  try {
    c3.el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    await sleep(200);
    ok(!c3.isShown(), 'a touch never pins it');
  } finally { c3.destroy(); m3.remove(); }
});

test('credits: place() sits above the sheet, hides when almost no map shows', async () => {
  const m = bare('t-cr3');
  const c = createCredits(m, { html: ATTRIBUTION });
  try {
    c.place(300, 600);
    eq(c.el.style.getPropertyValue('--sb-credit-y'), '300px');
    ok(!c.el.classList.contains('is-off'));
    const r = c.el.getBoundingClientRect(), mr = m.getContainer().getBoundingClientRect();
    ok(r.bottom <= mr.bottom - 300 - 8, 'credit clear of the sheet and its grab area: ' + (mr.bottom - 300 - r.bottom));
    c.place(600 - MIN_ROOM + 1, 600);
    ok(c.el.classList.contains('is-off'), 'full detent: hidden');
    eq(getComputedStyle(c.el).visibility, 'hidden', 'not focusable or tappable while hidden');
    c.place(200, 600);
    ok(!c.el.classList.contains('is-off') && c.el.style.getPropertyValue('--sb-credit-y') === '200px', 'back above the sheet');
  } finally { c.destroy(); m.remove(); }
});

test('MapApi: the credit replaces Leaflet attribution (no copyright sign) and follows setBottomInset', () => {
  const d = document.createElement('div');
  d.id = 't-cr4';
  d.style.cssText = 'position:absolute;left:-2000px;top:0;width:400px;height:600px';
  document.body.appendChild(d);
  const api = createMap('t-cr4');
  try {
    const el = api.leaflet.getContainer(), cr = el.querySelector('.sb-credits');
    ok(cr && cr.getAttribute('aria-label') === 'Map credits' && !cr.querySelector('button'), 'plain credit in the map, no (i) button');
    ok(!el.querySelector('.leaflet-control-attribution'), 'no Leaflet attribution control');
    ok(!COPY.test(el.innerHTML), 'no copyright sign anywhere in the map');
    ok(/OpenStreetMap/.test(cr.textContent) && /OpenMapTiles/.test(cr.textContent) && /OpenFreeMap|OpenStreetMap/.test(cr.textContent));
    api.setBottomInset(250);
    eq(cr.style.getPropertyValue('--sb-credit-y'), '250px');
    api.setBottomInset(560);
    ok(cr.classList.contains('is-off'), 'hidden when the sheet covers the map');
  } finally { api.leaflet.remove(); d.remove(); }
});

test('About: credits name OpenStreetMap (ODbL), OpenMapTiles and OpenFreeMap, no copyright sign', () => {
  const h = renderAbout();
  const credits = h.slice(h.indexOf('Credits'));
  ok(!COPY.test(credits), 'no copyright sign');
  ok(/OpenStreetMap<\/a> contributors \(ODbL\)/.test(credits), 'OpenStreetMap contributors (ODbL)');
  ok(credits.includes('>OpenMapTiles</a>') && credits.includes('>OpenFreeMap</a>'));
  ok(credits.includes('Map data and the campus places list'), 'credit wording kept');
});

/** Tests for the map credit (map/credits.js, map/style.js ATTRIBUTION, MapApi wiring) and the About credits. */
import { test, eq, ok, near } from './lib.js';
import { createCredits, COLLAPSE_MS, MIN_ROOM } from '../js/map/credits.js';
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
  eq(COLLAPSE_MS, 5000, 'collapses after five seconds (OSMF guideline)');
});

test('patchStyle: style source credits lose the copyright sign, keep the names', () => {
  const src = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
  const s = patchStyle({ version: 8, sources: { openmaptiles: { type: 'vector', url: 'x', attribution: src }, other: { type: 'geojson' } }, layers: [] }, false);
  const a = s.sources.openmaptiles.attribution;
  ok(!COPY.test(a), a);
  ok(a.includes('>OpenMapTiles</a>') && a.includes('OpenFreeMap') && a.includes('OpenStreetMap'), a);
  eq(s.sources.other, { type: 'geojson' }, 'sources without credits untouched');
});

test('credits: open at load, collapse to a 44px (i) button, tap reopens, second tap closes, auto-collapses again', async () => {
  const m = bare('t-cr1');
  const c = createCredits(m, { html: ATTRIBUTION, collapseMs: 120 });
  try {
    const btn = c.button, text = c.el.querySelector('.sb-credits-text');
    eq(btn.getAttribute('aria-label'), 'Map credits');
    eq(btn.getAttribute('aria-controls'), text.id, 'button controls the credit text');
    ok(c.isOpen() && !text.hidden && btn.getAttribute('aria-expanded') === 'true', 'expanded at load');
    ok(text.textContent.includes('OpenStreetMap') && !COPY.test(c.el.innerHTML));
    const r = btn.getBoundingClientRect();
    ok(r.width >= 44 && r.height >= 44, '44px target: ' + r.width + 'x' + r.height);
    await sleep(200);
    ok(!c.isOpen() && text.hidden && btn.getAttribute('aria-expanded') === 'false', 'collapsed after the delay');
    btn.click();
    ok(c.isOpen() && !text.hidden && btn.getAttribute('aria-expanded') === 'true', 'tap reopens');
    btn.click();
    ok(!c.isOpen() && text.hidden, 'second tap collapses');
    btn.click();
    await sleep(200);
    ok(!c.isOpen(), 'reopened credit collapses again by itself');
  } finally { c.destroy(); m.remove(); }
});

test('credits: never collapse under keyboard focus or a mouse; Escape collapses and focuses (i)', async () => {
  const m = bare('t-cr2');
  const c = createCredits(m, { html: ATTRIBUTION, collapseMs: 80 });
  try {
    const link = c.el.querySelector('.sb-credits-text a');
    link.focus();
    await sleep(200);
    ok(c.isOpen(), 'held open while a credit link has focus');
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(!c.isOpen() && document.activeElement === c.button, 'Escape: collapsed, focus on the (i) button');
    c.expand();
    c.el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await sleep(200);
    ok(c.isOpen(), 'held open while hovered');
    c.el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await sleep(200);
    ok(!c.isOpen(), 'collapses after the mouse leaves');
    c.expand();
    c.el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    await sleep(200);
    ok(!c.isOpen(), 'a touch never pins it open');
  } finally { c.destroy(); m.remove(); }
});

test('credits: place() sits above the sheet, hides when almost no map shows', async () => {
  const m = bare('t-cr3');
  const c = createCredits(m, { html: ATTRIBUTION });
  try {
    c.place(300, 600);
    eq(c.el.style.getPropertyValue('--sb-credit-y'), '300px');
    ok(!c.el.classList.contains('is-off'));
    const r = c.button.getBoundingClientRect(), mr = m.getContainer().getBoundingClientRect();
    ok(r.bottom <= mr.bottom - 300 - 8, 'button clear of the sheet and its grab area: ' + (mr.bottom - 300 - r.bottom));
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
    ok(cr && cr.querySelector('button[aria-label="Map credits"]'), 'credit control in the map');
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

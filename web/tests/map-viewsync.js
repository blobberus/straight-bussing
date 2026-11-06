// Route lines stay on the roads through line-view switches during zooms (owner 2026-11-06: "When switching line views
// while zoomed in, the map sometimes glitches the routes to not be matched to the roads."). A fit's flight cut short by a
// drag used to end with no zoomend, so Leaflet's SVG renderers kept the paths projected at the zoom the flight started
// from; a network redraw in the middle of a flight was projected at that frame's zoom. map/map.js syncView finishes a
// cut flight with zoomend + moveend, and drawNetwork holds a redraw until the zoom ends.
import { test, eq, ok } from './lib.js';
import { createMap, syncView, NET_HOLD_MS } from '../js/map/map.js';
import { createBusLayer } from '../js/map/layers.js';
import { P, squareLoop } from './map-fixtures.js';

const routes = { ra: { short: 'A', long: 'Alpha', color: '#0055AA' }, rb: { short: 'B', long: 'Beta', color: '#AA2200' },
  rc: { short: 'C', long: 'Gamma', color: '#118833' } };
const shapes = { ra: [squareLoop()], rb: [[P(0, -2), P(6, -2)]], rc: [[P(-2, 0), P(-2, 6), P(3, 6)]] };
const routeStops = { ra: ['A', 'B'], rb: ['E', 'F'], rc: ['G', 'H'] };
const stops = { A: { lat: P(0, 0)[0], lon: P(0, 0)[1] }, B: { lat: P(4, 0)[0], lon: P(4, 0)[1] },
  E: { lat: P(0, -2)[0], lon: P(0, -2)[1] }, F: { lat: P(6, -2)[0], lon: P(6, -2)[1] },
  G: { lat: P(-2, 0)[0], lon: P(-2, 0)[1] }, H: { lat: P(-2, 6)[0], lon: P(-2, 6)[1] } };
const stopRoutes = { A: ['ra'], B: ['ra'], E: ['rb'], F: ['rb'], G: ['rc'], H: ['rc'] };
const net = (o = {}) => ({ routes, shapes, routeStops, stopRoutes, stops, hidden: [], focus: null, order: [], ...o });
const bus = (id, x, y) => ({ vehicle: { id, label: 'B' + id }, trip: { route_id: 'rb' },
  position: { latitude: P(x, y)[0], longitude: P(x, y)[1], bearing: 90 }, timestamp: 1000 });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function box(id) {
  const d = document.createElement('div');
  d.id = id;
  d.style.cssText = 'position:absolute;left:-2000px;top:0;width:400px;height:600px';
  document.body.appendChild(d);
  return d;
}

/**
 * Leaflet's flyTo, frame by frame (the real one is driven by requestAnimationFrame, which headless virtual time can
 * starve): it starts with _stop() + _moveStart(true) (zoomstart, movestart), moves each frame with
 * _move(center, zoom, {flyTo: true}) and ends with _move(target, zoom) + _moveEnd(true) (zoomend, moveend).
 * @returns {{at(k:number):void, end():void}}
 */
function flight(m, to, toZoom) {
  const from = m.getCenter(), z0 = m.getZoom(), L = window.L;
  const at = (k) => L.latLng(from.lat + (to[0] - from.lat) * k, from.lng + (to[1] - from.lng) * k);
  m._stop();
  m._moveStart(true, false);
  return { at: (k) => m._move(at(k), z0 + (toZoom - z0) * k, { flyTo: true }), end: () => m._move(at(1), toZoom)._moveEnd(true) };
}

/**
 * Every SVG path on the map (route lines, stops and their tap halos, chevrons): how far (screen px) the path draws its
 * middle point from where Leaflet's projection puts that latlng now (screen), and from its projection at the current
 * zoom (proj).
 */
function offsets(m) {
  const L = window.L, mr = m.getContainer().getBoundingClientRect(), out = [];
  m.eachLayer((l) => {
    if (!(l instanceof L.Path) || !l._path) return;
    let ll = null, pt = null;
    if (l instanceof L.Polyline) {
      const flat = Array.isArray(l._latlngs[0]) ? l._latlngs[0] : l._latlngs, i = flat.length >> 1;
      ll = flat[i]; pt = l._rings && l._rings[0] && l._rings[0][i];
    } else { ll = l._latlng; pt = l._point; }
    if (!ll || !pt) return;
    const svg = l._path.ownerSVGElement;
    if (!svg || !svg.viewBox) { out.push({ cls: 'detached ' + String(l.options.className || ''), screen: Infinity, proj: Infinity }); return; }
    const vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
    const c = m.latLngToContainerPoint(ll), want = m.latLngToLayerPoint(ll);
    const x = r.left + (pt.x - vb.x) * r.width / vb.width, y = r.top + (pt.y - vb.y) * r.height / vb.height;
    out.push({ cls: String(l.options.className || ''), screen: Math.hypot(x - mr.left - c.x, y - mr.top - c.y),
      proj: Math.hypot(pt.x - want.x, pt.y - want.y) });
  });
  return out;
}
const worst = (list, k) => Math.max(0, ...list.map((x) => x[k]));
/** A mouse drag on the map the way Leaflet's drag handler sees a finger: down and a first move (the drag starts, and
    Leaflet stops any flight); the returned function moves on and lets go. No inertia (m.options.inertia = false). */
function drag(m, dx, dy) {
  const c = m.getContainer(), r = c.getBoundingClientRect(), x = r.left + 200, y = r.top + 300;
  const ev = (type, px, py) => new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: px, clientY: py, button: 0, buttons: 1 });
  m.options.inertia = false;
  c.dispatchEvent(ev('mousedown', x, y));
  c.dispatchEvent(ev('mousemove', x + dx / 2, y + dy / 2));   // Leaflet listens on the document; the target is the map
  return () => {
    c.dispatchEvent(ev('mousemove', x + dx, y + dy));
    c.dispatchEvent(ev('mouseup', x + dx, y + dy));
  };
}

test('view sync: a fit cut short by a drag ends with zoomend; lines, stops and chevrons sit on the final projection', () => {
  box('t-vs-cut');
  const api = createMap('t-vs-cut'), m = api.leaflet, el = m.getContainer();
  m.setView(P(2, 2), 17, { animate: false });
  api.drawNetwork(net());
  const log = [];
  for (const t of ['zoomstart', 'zoomend', 'moveend']) m.on(t, () => log.push(t));
  const fly = flight(m, P(0, 0), 13);   // opening a route: the fit flies out from 17
  fly.at(0.2); fly.at(0.45);
  api.drawNetwork(net({ focus: ['rb'] }));   // the line view switches during the flight
  eq(m.getPane('sbFocusLines').querySelectorAll('path').length, 0, 'mid-flight: the switch waits for the zoom to end');
  ok(worst(offsets(m), 'screen') < 1.5, 'mid-flight: the lines drawn before stay where the map is');
  const zCut = m.getZoom();
  const finish = drag(m, 40, 50);   // a finger on the map: Leaflet's drag handler stops the flight
  eq(log.filter((t) => t === 'zoomend').length, 1, 'the cut flight ended with a zoomend');
  ok(log.indexOf('zoomend') < log.lastIndexOf('moveend'), 'then a moveend, the order Leaflet ends a flight with');
  eq(m.getZoom(), zCut, 'where it was cut');
  ok(m.getPane('sbFocusLines').querySelectorAll('path').length > 0, 'the held switch is drawn at that zoomend');
  finish();
  eq(log[log.length - 1], 'moveend', 'the drag ended');
  const offs = offsets(m);
  ok(offs.some((x) => /sb-route/.test(x.cls)) && offs.some((x) => /sb-stop/.test(x.cls)) && offs.some((x) => /sb-chev/.test(x.cls)), 'lines, stops and chevrons measured');
  ok(worst(offs, 'proj') < 0.51, `every path projected at the final zoom (worst ${worst(offs, 'proj').toFixed(1)} px)`);
  ok(worst(offs, 'screen') < 1.5, `every path drawn on the map's projection (worst ${worst(offs, 'screen').toFixed(1)} px)`);
  const gl = Object.values(m._layers).find((l) => typeof l.getMaplibreMap === 'function');
  if (gl) eq(!!gl._zooming, false, 'the basemap layer follows the map again');
  let tapped = null;
  api.onLineTap((rid) => { tapped = rid; });
  const at = m.latLngToContainerPoint(P(3, -2));
  m.fire('click', { latlng: m.containerPointToLatLng(at), containerPoint: at, originalEvent: { target: el } });
  eq(tapped, 'rb', 'a line tap measures the lines as drawn now');
  m.remove();
});

test('view sync: line switches during a fit are drawn once, at the final zoom, never half way', () => {
  box('t-vs-hold');
  const api = createMap('t-vs-hold'), m = api.leaflet;
  m.setView(P(2, 2), 17, { animate: false });
  api.drawNetwork(net());
  const lines = () => m.getPane('sbLines').querySelectorAll('path').length, before = lines();
  const fly = flight(m, P(0, 0), 13);
  fly.at(0.3);
  api.drawNetwork(net({ hidden: ['ra'] }));   // two switches during the flight (Hide a line, then another)
  let worstMid = worst(offsets(m), 'screen');
  fly.at(0.6);
  api.drawNetwork(net({ hidden: ['ra', 'rc'] }));
  for (const k of [0.75, 0.9]) { fly.at(k); worstMid = Math.max(worstMid, worst(offsets(m), 'screen')); }
  eq(lines(), before, 'held: the lines drawn before stay');
  ok(worstMid < 1.5, `through the flight the lines stay on the map (worst ${worstMid.toFixed(1)} px)`);
  fly.end();
  eq(lines(), 1, 'the latest state only, drawn at the end (rb)');
  ok(worst(offsets(m), 'screen') < 1.5 && worst(offsets(m), 'proj') < 0.51, 'and on the final projection');
  api.drawNetwork(net());   // no zoom under way: drawn at once
  eq(lines(), before);
  m.remove();
});

test('view sync: a held redraw is drawn within NET_HOLD_MS even if the zoom never ends (a long pinch)', async () => {
  box('t-vs-cap');
  const api = createMap('t-vs-cap'), m = api.leaflet;
  m.setView(P(2, 2), 16, { animate: false });
  api.drawNetwork(net());
  const fly = flight(m, P(2, 2), 15);   // a pinch: zoomstart, then the view moves and stays
  fly.at(0.5);
  api.drawNetwork(net({ hidden: ['ra', 'rc'] }));
  eq(m.getPane('sbLines').querySelectorAll('path').length, 3, 'held while the pinch moves the view');
  await wait(NET_HOLD_MS + 100);
  eq(m.getPane('sbLines').querySelectorAll('path').length, 1, 'drawn by the cap');
  fly.end();
  m.remove();
});

test('view sync: after a cut flight the buses glide again (their frames pause from zoomstart to zoomend)', () => {
  const m = window.L.map(box('t-vs-bus'), { zoomControl: false, attributionControl: false }).setView(P(2, -2), 17);
  syncView(m);
  let T = 0, queue = [];
  const layer = createBusLayer(m, { onBusTap: () => {} }, { clock: () => T, frame: (fn) => { queue.push(fn); return queue.length; },
    later: (fn) => { fn(); return 0; }, cancel: () => {}, reduce: () => false });
  const step = (ms) => { T += ms; const q = queue; queue = []; q.forEach((f) => f()); };
  layer.draw([bus('5', 1, -2.6)], { routes, shapes: {}, nowS: 1000 });
  const fly = flight(m, P(0, 0), 14);
  fly.at(0.5);
  drag(m, 30, 20)();
  layer.draw([bus('5', 1.5, -2.6)], { routes, shapes: {}, nowS: 1010 });   // 80 m east, off any line: a straight glide
  const a = layer.shown('5');
  for (let i = 0; i < 60; i++) step(16);
  const b = layer.shown('5');
  ok(a && b && Math.abs(b[1] - a[1]) > 0.00003, `the badge moved along its glide (${a} -> ${b})`);
  m.remove();
});

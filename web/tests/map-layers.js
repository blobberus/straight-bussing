/** Tests for map/layers.js signatures + in-place updates, and the MapApi in map/map.js (needs Leaflet). */
import { test, eq, ok, near } from './lib.js';
import { idOf, sig, focusSet, networkSig, busSig, lineWeight, routeLabel, createNetworkLayer, createBusLayer } from '../js/map/layers.js';
import { createMap } from '../js/map/map.js';
import { P, squareLoop, stop } from './map-fixtures.js';

const routes = { r1: { short: 'CEN', long: 'Central', color: '#FF9900' }, r2: { short: '', long: 'North', color: '#0099CC' },
  r3: { short: 'RED', long: 'Red Line/Arts Block', color: '#D62728' } };
const shapes = { r1: [squareLoop()], r2: [[P(0, -2), P(6, -2)]], r3: [[P(-2, 0), P(-2, 6)]] };
const routeStops = { r1: ['A', 'B', 'C', 'D', 'A'], r2: ['E', 'F'], r3: ['G', 'H'] };
const stops = { A: { name: 'A st', lat: P(0, 0)[0], lon: P(0, 0)[1] }, B: { name: 'B st', lat: P(4, 0)[0], lon: P(4, 0)[1] },
  C: { name: 'C st', lat: P(4, 4)[0], lon: P(4, 4)[1] }, D: { name: 'D st', lat: P(0, 4)[0], lon: P(0, 4)[1] },
  E: { name: 'E st', lat: P(0, -2)[0], lon: P(0, -2)[1] }, F: { name: 'F st', lat: P(6, -2)[0], lon: P(6, -2)[1] },
  G: { name: 'G st', lat: P(-2, 0)[0], lon: P(-2, 0)[1] }, H: { name: 'H st', lat: P(-2, 6)[0], lon: P(-2, 6)[1] } };
const stopRoutes = { A: ['r1'], B: ['r1'], C: ['r1'], D: ['r1'], E: ['r2'], F: ['r2'], G: ['r3'], H: ['r3'] };
const net = (extra = {}) => ({ routes, shapes, routeStops, stopRoutes, stops, hidden: [], focus: null, ...extra });
const bus = (id, rid, x, y, extra = {}) => ({ vehicle: { id, label: 'B' + id }, trip: { route_id: rid },
  position: { latitude: P(x, y)[0], longitude: P(x, y)[1], bearing: 90 }, timestamp: 1000, ...extra });

function box(id) {
  const d = document.createElement('div');
  d.id = id;
  d.style.cssText = 'position:absolute;left:-2000px;top:0;width:400px;height:600px';
  document.body.appendChild(d);
  return d;
}
function bareMap(id) {
  const m = window.L.map(box(id), { zoomControl: false, attributionControl: false }).setView(P(2, 2), 15);
  for (const [n, z] of Object.entries({ sbCasing: 380, sbLines: 390, sbFocusCasing: 392, sbFocusLines: 394, sbStops: 420 })) m.createPane(n).style.zIndex = z;
  return m;
}
const paths = (el) => [...el.querySelectorAll('path')];

test('sig helpers: idOf, sig, focusSet', () => {
  const a = {}, b = {};
  eq(idOf(a), idOf(a)); ok(idOf(a) !== idOf(b)); eq(idOf(null), 0); eq(idOf(5), 0);
  eq(sig('a', [1, 2], null, 3), 'a|1,2||3');
  eq(focusSet([]), null); eq(focusSet(null), null); eq([...focusSet(['x', 1])], ['x', '1']);
});

test('networkSig: content-stable, changes only on real changes', () => {
  const s0 = networkSig(net());
  eq(networkSig(net({ hidden: [] })), s0, 'new empty hidden array -> same');
  eq(networkSig(net({ focus: [] })), s0, 'focus [] == null');
  eq(networkSig(net({ hidden: ['r2', 'r1'] })), networkSig(net({ hidden: ['r1', 'r2'] })), 'hidden order irrelevant');
  ok(networkSig(net({ hidden: ['r1'] })) !== s0, 'hidden change');
  ok(networkSig(net({ focus: ['r1'] })) !== s0, 'focus change');
  ok(networkSig(net(), true) !== s0, 'plan dimming change');
  ok(networkSig(net({ shapes: { ...shapes } })) !== s0, 'new shapes object');
});

test('busSig / lineWeight / routeLabel', () => {
  const a = busSig('r1', 41.1, -87.1, 90, false, 'CEN', '#FF9900');
  eq(busSig('r1', 41.1, -87.1, 90.2, false, 'CEN', '#FF9900'), a, 'sub-degree bearing jitter ignored');
  ok(busSig('r1', 41.1001, -87.1, 90, false, 'CEN', '#FF9900') !== a, 'moved');
  ok(busSig('r1', 41.1, -87.1, 90, true, 'CEN', '#FF9900') !== a, 'stale');
  eq(lineWeight(13), 4); eq(lineWeight(15), 5); eq(lineWeight(17), 6); eq(lineWeight(5), 3.5);
  eq(routeLabel('r1', routes), 'CEN'); eq(routeLabel('r2', routes), 'N'); eq(routeLabel('zz', routes), '?');
  eq(routeLabel('x', { x: { short: '', long: 'Friend Center/Metra' } }), 'FCM');
});

test('network layer: polling does not repaint; changes do', () => {
  const m = bareMap('t-net');
  const taps = [];
  const layer = createNetworkLayer(m, { onStopTap: (id) => taps.push(id) });
  ok(layer.draw(net()), 'first draw');
  const el = m.getContainer(), first = paths(el);
  ok(first.length >= 6 + 8, 'casing+line per shape and stop+halo per stop: ' + first.length);
  eq(layer.draw(net({ hidden: [] })), false, 'same inputs -> no redraw');
  ok(paths(el).every((p, i) => p === first[i]), 'same DOM nodes');
  ok(layer.draw(net({ hidden: ['r2'] })), 'hidden change redraws');
  ok(paths(el).length < first.length, 'hidden route gone');
  layer.draw(net({ focus: ['r1'] }));
  const dim = paths(el).filter((p) => p.classList.contains('sb-route') && p.getAttribute('stroke-opacity') === '0.25');
  eq(dim.length, 2, 'two non-focus routes dimmed');
  const front = m.getPane('sbFocusLines').querySelectorAll('path.sb-route');
  eq(front.length, 1, 'focused route drawn in the top pane');
  const halo = el.querySelector('path.sb-halo');
  halo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  eq(taps.length, 1, 'stop tap via 44 px halo');
  m.setZoom(13, { animate: false });
  layer.restyle();
  ok(!m.getPane('sbStops').querySelector('path'), 'stops hidden below z14');
  m.remove();
});

test('bus layer: in-place updates, recreate only on route change, stale + hidden', () => {
  const m = bareMap('t-bus');
  const taps = [];
  const layer = createBusLayer(m, { onBusTap: (b) => taps.push(b) });
  const o = { routes, hidden: [], focus: null, nowS: 1010 };
  eq(layer.draw([bus(1, 'r1', 1, 1), bus(2, 'r2', 3, -2)], o), 2);
  const el1 = m.getContainer().querySelectorAll('.sb-bus')[0];
  eq(el1.querySelector('.sb-bus-tx').textContent, 'CEN');
  eq(layer.draw([bus(1, 'r1', 1, 1), bus(2, 'r2', 3, -2)], o), 0, 'poll with no change touches nothing');
  eq(layer.draw([bus(1, 'r1', 1.5, 1), bus(2, 'r2', 3, -2)], o), 1, 'one moved');
  ok(m.getContainer().querySelectorAll('.sb-bus')[0] === el1, 'marker element reused');
  layer.draw([bus(1, 'r1', 1.5, 1, { timestamp: 900 }), bus(2, 'r2', 3, -2)], o);
  ok(el1.classList.contains('is-stale'), 'stale after 60 s');
  layer.draw([bus(1, 'r3', 1.5, 1), bus(2, 'r2', 3, -2)], o);
  const el1b = m.getContainer().querySelector('.sb-bus');
  ok(el1b !== el1 && !el1.isConnected, 'route change recreates marker');
  eq(layer.draw([bus(1, 'r3', 1.5, 1), bus(2, 'r2', 3, -2)], { ...o, hidden: ['r2'] }), 1, 'hidden route removed');
  eq(m.getContainer().querySelectorAll('.sb-bus').length, 1);
  layer.draw([bus(1, 'r3', 1.5, 1), bus(2, 'r2', 3, -2)], { ...o, focus: ['r2'] });
  eq(m.getContainer().querySelectorAll('.sb-bus').length, 1, 'focus shows focused route only');
  m.getContainer().querySelector('.sb-busicon').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  eq(taps[0]?.rid, 'r2'); eq(taps[0]?.label, 'B2');
  m.remove();
});

test('MapApi: theme, network diff, plan, highlights, flyTo offset by inset', async () => {
  box('t-api');
  const api = createMap('t-api');
  const m = api.leaflet, el = m.getContainer();
  for (const k of ['setTheme', 'setBottomInset', 'drawNetwork', 'drawBuses', 'setSelectedStop', 'setUser', 'highlightStops',
    'drawPlan', 'fitTo', 'flyTo', 'onStopTap', 'onBusTap', 'onUserMove']) eq(typeof api[k], 'function', k);
  api.drawNetwork(net());
  const before = paths(m.getPane('sbLines'));
  api.setTheme(true);
  ok(el.classList.contains('sb-dark'), 'dark class');
  api.drawNetwork(net());
  ok(paths(m.getPane('sbLines')).every((p, i) => p === before[i]), 'theme + re-draw does not rebuild lines');
  ok(api.leaflet === m, 'same map after theme swap');
  api.setTheme(false);

  const option = { key: 'k1', legs: [
    { type: 'walk', from: { lat: P(-1, -1)[0], lon: P(-1, -1)[1], name: 'Start' }, to: { ...stop('A', 0, 0), name: 'A' }, m: 200, min: 3 },
    { type: 'bus', rid: 'r1', board: { ...stop('A', 0, 0), name: 'A' }, alight: { ...stop('C', 4, 4), name: 'C' }, path: [stop('A', 0, 0), stop('C', 4, 4)] },
    { type: 'walk', from: { ...stop('C', 4, 4), name: 'C' }, to: { lat: P(5, 5)[0], lon: P(5, 5)[1], name: 'End' }, coords: [P(4, 4), P(4.5, 4.6), P(5, 5)], m: 150, min: 2 },
  ] };
  const pts = api.drawPlan(option, { routes, shapes, routeStops });
  ok(pts.some((p) => Math.abs(p[0] - P(4, 0)[0]) < 1e-9 && Math.abs(p[1] - P(4, 0)[1]) < 1e-9), 'bus leg follows the loop via B');
  eq(api.drawPlan({ ...option }, { routes, shapes, routeStops }), pts, 'same plan -> cached, no redraw');
  ok(el.querySelector('.sb-pin-end') && el.querySelector('path.sb-pin-start'), 'start/end pins');
  eq(el.querySelectorAll('path.sb-walk').length, 2, 'two walk legs');
  const dimmed = paths(m.getPane('sbLines')).filter((p) => p.getAttribute('stroke-opacity') === '0.25');
  eq(dimmed.length, 3, 'network dims while a plan is shown');
  api.drawPlan(null);
  eq(el.querySelectorAll('path.sb-walk').length, 0, 'plan cleared');

  api.highlightStops([stop('A', 0, 0), stop('B', 4, 0)], { onPick: () => {} });
  const hl = [...el.querySelectorAll('path.sb-hl')];
  eq(hl.length, 2);
  api.highlightStops([stop('A', 0, 0), stop('B', 4, 0)], {});
  ok([...el.querySelectorAll('path.sb-hl')].every((p, i) => p === hl[i]), 'highlights not rebuilt');
  api.highlightStops(null);
  eq(el.querySelectorAll('path.sb-hl').length, 0);

  api.setSelectedStop({ id: 'A', lat: stops.A.lat, lon: stops.A.lon, name: 'A st' });
  ok(el.querySelector('path.sb-sel'), 'selected ring');
  api.setUser({ lat: P(1, 1)[0], lon: P(1, 1)[1], accuracy: 40 });
  ok(el.querySelector('.sb-me') && el.querySelector('path.sb-acc'), 'user dot + accuracy');
  api.setUser(null);
  ok(!el.querySelector('.sb-me'), 'user dot removed');

  api.setBottomInset(300);
  const target = { lat: P(3, 3)[0], lon: P(3, 3)[1] };
  api.flyTo(target, 16, { animate: false });
  const y = m.latLngToContainerPoint([target.lat, target.lon]).y;
  near(y, (600 - 300) / 2, 3, `target centered in the visible area above the sheet (size ${m.getSize()}, zoom ${m.getZoom()})`);
  const box2 = [P(-2, -2), P(6, 6)];
  api.fitTo(box2, { animate: false });
  for (const p of box2) {
    const pt = m.latLngToContainerPoint(p);
    ok(pt.y >= 0 && pt.y <= 600 - 300 + 1 && pt.x >= 0 && pt.x <= 400, 'fitTo keeps points above the sheet: ' + pt);
  }
  const moves = [];
  api.onUserMove((c) => moves.push(c));
  m.fire('dragstart');
  eq(moves.length, 1, 'user drag reported');
  m.remove();
});

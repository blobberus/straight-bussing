/** Tests for v2.1 map features: draw order (stackOrder, networkSig), direction chevrons, bus heading. */
import { test, eq, ok, near } from './lib.js';
import { marksAlong, chevronPx, runsForward } from '../js/map/geometry.js';
import { stackOrder, networkSig, busHeading, HEADING_MIN_M, createNetworkLayer, createBusLayer } from '../js/map/layers.js';
import { orientedLines, chevronSize } from '../js/map/chevrons.js';
import { P, squareLoop, stop } from './map-fixtures.js';

const routes = { r1: { short: 'CEN', color: '#FF9900' }, r2: { short: 'N', color: '#0099CC' },
  r3: { short: 'RED', color: '#D62728' }, r4: { short: 'Y', color: '#F7EB07' } };
const shapes = { r1: [squareLoop()], r2: [[P(0, -2), P(6, -2)]], r3: [[P(-2, 0), P(-2, 6)]], r4: [[P(0, 2), P(6, 2)]] };
const routeStops = { r1: ['A', 'B', 'C', 'D', 'A'], r2: ['E', 'F'], r3: ['G', 'H'], r4: ['I', 'J'] };
const pt = (x, y) => { const [lat, lon] = P(x, y); return { lat, lon }; };
const stops = { A: pt(0, 0), B: pt(4, 0), C: pt(4, 4), D: pt(0, 4), E: pt(0, -2), F: pt(6, -2), G: pt(-2, 0), H: pt(-2, 6), I: pt(0, 2), J: pt(6, 2) };
const stopRoutes = { A: ['r1'], B: ['r1'], C: ['r1'], D: ['r1'], E: ['r2'], F: ['r2'], G: ['r3'], H: ['r3'], I: ['r4'], J: ['r4'] };
const net = (extra = {}) => ({ routes, shapes, routeStops, stopRoutes, stops, hidden: [], focus: null, order: [], ...extra });

function bareMap(id) {
  const d = document.createElement('div');
  d.id = id;
  d.style.cssText = 'position:absolute;left:-2000px;top:0;width:400px;height:600px';
  document.body.appendChild(d);
  const m = window.L.map(d, { zoomControl: false, attributionControl: false }).setView(P(2, 2), 15);
  for (const [n, z] of Object.entries({ sbCasing: 380, sbLines: 390, sbFocusCasing: 392, sbFocusLines: 394, sbStops: 420 })) m.createPane(n).style.zIndex = z;
  return m;
}
const strokes = (pane) => [...pane.querySelectorAll('path.sb-route')].map((p) => p.getAttribute('stroke').toUpperCase());

test('marksAlong: even spacing in px, segment angle, cap, degenerate input', () => {
  const m = marksAlong([[0, 0], [400, 0]], 80);
  eq(m.map((x) => x.x), [40, 120, 200, 280, 360]);
  ok(m.every((x) => x.y === 0 && x.angle === 0), 'east = angle 0');
  const corner = marksAlong([[0, 0], [100, 0], [100, 100]], 80);
  eq(corner.length, 3, '40, 120 (around the corner), 200 (end point)');
  near(corner[1].x, 100, 1e-9); near(corner[1].y, 20, 1e-9); near(corner[1].angle, Math.PI / 2, 1e-9);
  eq(marksAlong([[0, 0], [10000, 0]], 10, { max: 7 }).length, 7, 'max cap');
  eq(marksAlong([[0, 0], [0, 0], [100, 0]], 80).length, 1, 'zero-length segment skipped');
  eq(marksAlong([[0, 0]], 80), []); eq(marksAlong([[0, 0], [100, 0]], 0), []); eq(marksAlong(null, 80), []);
});

test('chevronPx: tip points along the angle, arms trail behind it', () => {
  const [a, tip, b] = chevronPx({ x: 0, y: 0, angle: 0 }, 4);
  ok(tip[0] > 0 && tip[1] === 0, 'tip ahead (east)');
  ok(a[0] < tip[0] && b[0] < tip[0], 'arms behind the tip');
  near(a[1], -b[1], 1e-9, 'symmetric arms');
  const [, tipS] = chevronPx({ x: 10, y: 10, angle: Math.PI / 2 }, 4);
  near(tipS[0], 10, 1e-9); ok(tipS[1] > 10, 'angle pi/2 points +y (south on screen)');
});

test('runsForward / orientedLines: shape order vs stop order', () => {
  const line = [P(0), P(1), P(2), P(3), P(4)], sp = [P(0.1), P(2), P(3.9)];
  ok(runsForward(line, sp), 'same direction');
  ok(!runsForward(line.slice().reverse(), sp), 'reversed shape');
  ok(runsForward(squareLoop(), ['A', 'B', 'C', 'D', 'A'].map((id) => stops[id])), 'loop wrap is one vote');
  ok(runsForward(line, [P(1)]), 'too few stops -> forward');
  const rev = orientedLines([line.slice().reverse(), [P(9)]], ['x', 'y', 'z'], { x: pt(0.1, 0), y: pt(2, 0), z: pt(3.9, 0) });
  eq(rev.length, 1, 'single-point line dropped');
  eq(rev[0][0], P(0), 'reversed to stop order');
  ok(chevronSize(13) < chevronSize(17) && chevronSize(30) <= 4.5, 'size grows with zoom, capped');
});

test('stackOrder: priority list first on top, missing below, focus always above, hidden dropped', () => {
  const ids = ['r1', 'r2', 'r3', 'r4'];
  eq(stackOrder(ids, {}), { back: ['r4', 'r3', 'r2', 'r1'], front: [] }, 'no order: data order, first on top');
  eq(stackOrder(ids, { order: ['r3', 'r1'] }).back, ['r4', 'r2', 'r1', 'r3'], 'r3 top, then r1, unlisted below');
  eq(stackOrder(ids, { order: ['r3', 'zz', 'r3'] }).back.at(-1), 'r3', 'unknown/duplicate ids ignored');
  eq(stackOrder(ids, { order: ['r3', 'r1', 'r2'], focus: ['r2', 'r4'] }), { back: ['r1', 'r3'], front: ['r4', 'r2'] });
  eq(stackOrder(ids, { hidden: ['r2', 'r4'], focus: ['r4'] }), { back: ['r3', 'r1'], front: ['r4'] }, 'hidden but focused stays');
});

test('networkSig: order matters (by content), polling with a new equal array does not', () => {
  const s = networkSig(net({ order: ['r1', 'r2'] }));
  eq(networkSig(net({ order: ['r1', 'r2'] })), s);
  ok(networkSig(net({ order: ['r2', 'r1'] })) !== s, 'reorder redraws');
  ok(networkSig(net({ order: [] })) !== s);
});

test('network layer: lines stack by order, casing right under its own line, focus pane on top', () => {
  const m = bareMap('t-order');
  const layer = createNetworkLayer(m, { onStopTap: () => {} });
  layer.draw(net({ order: ['r3', 'r1', 'r2', 'r4'] }));
  const lines = m.getPane('sbLines');
  eq(strokes(lines), ['#F7EB07', '#0099CC', '#FF9900', '#D62728'], 'bottom -> top: r4, r2, r1, r3');
  const kids = [...lines.querySelectorAll('path')];
  ok(kids[0].classList.contains('sb-casing') && kids[1].classList.contains('sb-route'), 'casing then line per route');
  eq(layer.draw(net({ order: ['r3', 'r1', 'r2', 'r4'] })), false, 'same order -> no repaint');
  ok(layer.draw(net({ order: ['r4', 'r3', 'r1', 'r2'] })), 'new order repaints');
  eq(strokes(lines).at(-1), '#F7EB07', 'r4 now on top');
  layer.draw(net({ order: ['r4', 'r3', 'r1', 'r2'], focus: ['r2'] }));
  eq(strokes(m.getPane('sbFocusLines')), ['#0099CC'], 'focused route in the focus pane, above all');
  m.remove();
});

test('chevrons: only for 1-3 focused routes, not during a plan, non-interactive, rebuilt on zoom', () => {
  const m = bareMap('t-chev');
  const layer = createNetworkLayer(m, { onStopTap: () => {} });
  const pane = () => m.getPane('sbChevrons');
  layer.draw(net());
  eq(layer.chevrons(), 0, 'no focus -> none');
  layer.draw(net({ focus: ['r1'] }));
  const n15 = layer.chevrons();
  ok(n15 >= 5, 'loop gets chevrons: ' + n15);
  eq(pane().querySelectorAll('path.sb-chev').length, 1, 'one path per route');
  eq(pane().style.pointerEvents, 'none', 'pane never takes taps');
  eq(pane().querySelector('path.sb-chev').getAttribute('stroke'), '#111114', 'dark chevron on the orange line');
  layer.draw(net({ focus: ['r1', 'r2', 'r3'] }));
  eq(pane().querySelectorAll('path.sb-chev').length, 3);
  layer.draw(net({ focus: ['r1', 'r2', 'r3', 'r4'] }));
  eq(layer.chevrons(), 0, '4+ focused -> none (too busy)');
  layer.draw(net({ focus: ['r1'] }), true);
  eq(layer.chevrons(), 0, 'plan shown -> none');
  layer.draw(net({ focus: ['r1'] }));
  m.setZoom(17, { animate: false });
  layer.restyle();
  ok(layer.chevrons() > n15 * 2, 'more chevrons when zoomed in (screen spacing)');
  m.setZoom(12, { animate: false });
  layer.restyle();
  eq(layer.chevrons(), 0, 'hidden when zoomed far out');
  m.remove();
});

test('bus heading: feed bearing, else derived from movement, focused arrow class', () => {
  const dist = (a, b) => window.L.latLng(a).distanceTo(window.L.latLng(b));
  eq(busHeading(45, null, P(0), NaN, dist), 45, 'feed wins');
  near(busHeading(NaN, P(0), P(0.5), NaN, dist), 90, 1, 'moved east -> 90');
  ok(dist(P(0), P(0.05)) < HEADING_MIN_M, 'fixture: jitter below threshold');
  eq(busHeading(NaN, P(0), P(0.05), 180, dist), 180, 'jitter keeps last heading');
  ok(Number.isNaN(busHeading(NaN, null, P(0), NaN, dist)), 'unknown');

  const m = bareMap('t-hd');
  const layer = createBusLayer(m, { onBusTap: () => {} });
  const b = (x, brg) => ({ vehicle: { id: 7, label: '7' }, trip: { route_id: 'r1' }, timestamp: 1000,
    position: { latitude: P(x, 0)[0], longitude: P(x, 0)[1], bearing: brg } });
  layer.draw([b(0, null)], { routes, nowS: 1000 });
  const el = m.getContainer().querySelector('.sb-bus');
  ok(el.classList.contains('no-hd'), 'no bearing yet -> no arrow');
  layer.draw([b(0.5, null)], { routes, nowS: 1000 });
  ok(!el.classList.contains('no-hd'), 'arrow from movement');
  near(parseFloat(el.querySelector('.sb-bus-hd').style.transform.replace('rotate(', '')), 90, 1, 'points east');
  ok(!el.classList.contains('is-focus'));
  layer.draw([b(0.5, null)], { routes, focus: ['r1'], nowS: 1000 });
  ok(el.classList.contains('is-focus'), 'focused route -> bigger arrow (class toggles without a move)');
  m.remove();
});

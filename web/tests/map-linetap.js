// A tap on a route line opens the line drawn on top there (owner 2026-10-27): the pure hit test (map/geometry.js
// lineAt), the network layer's lineAt on a real Leaflet map, and MapApi.onLineTap vs onMapTap.
import { test, eq, ok } from './lib.js';
import { lineAt, segDistPx, LINE_TAP_PX } from '../js/map/geometry.js';
import { createNetworkLayer } from '../js/map/layers.js';
import { createMap } from '../js/map/map.js';
import { lineTapOpens } from '../js/core/visibility.js';
import { P } from './map-fixtures.js';

test('segDistPx: perpendicular, beyond the ends, zero-length segment', () => {
  eq(segDistPx([5, 3], [0, 0], [10, 0]), 3);
  eq(segDistPx([13, 4], [0, 0], [10, 0]), 5, 'past the end: distance to the end point');
  eq(segDistPx([3, 4], [0, 0], [0, 0]), 5, 'a point segment');
});

test('lineAt: the topmost line within reach wins, even when a lower one is closer', () => {
  const lines = [
    { rid: 'low', px: [[0, 0], [100, 0]], width: 6 },
    { rid: 'top', px: [[0, 10], [100, 10]], width: 6 },
  ];
  eq(lineAt([50, 1], lines), 'top', '9 px from the top line: within 14 + 3, so it wins over the closer line below');
  eq(lineAt([50, -16], lines), 'low', 'only the lower line is within reach');
  eq(lineAt([50, -40], lines), null, 'nothing near');
  eq(lineAt([50, 10 + LINE_TAP_PX + 3], lines), 'top', 'exactly at the reach: half the width plus the finger');
  eq(lineAt([50, 10 + LINE_TAP_PX + 3.5], lines), null, 'just beyond it');
  eq(lineAt([50, 26], [{ rid: 'w', px: [[0, 10], [100, 10]], width: 6 }], 4), null, 'a custom reach');
});

test('lineAt: bad input never throws', () => {
  eq(lineAt(null, []), null);
  eq(lineAt([0, 0], null), null);
  eq(lineAt([0, 0], [null, { rid: 'x' }, { rid: 'y', px: [] }]), null);
  eq(lineAt([1, 1], [{ rid: 7, px: [[0, 0]] }]), '7', 'a one-point line counts as its point; ids come back as strings');
});

test('lineTapOpens: everywhere but where the map shows a trip', () => {
  eq(lineTapOpens({ view: 'nearby', journey: null }), true);
  eq(lineTapOpens({ view: 'routes' }), true);
  eq(lineTapOpens({ view: 'route', journey: { kind: 'plan' } }), true, 'during a trip, on another screen');
  eq(lineTapOpens({ view: 'directions' }), false, 'Directions keeps a map tap as "lower the sheet"');
  eq(lineTapOpens({ view: 'pick' }), false, 'Routes to station too');
  eq(lineTapOpens({ view: 'nearby', journey: { kind: 'plan' } }), false, 'Current trip with a trip in progress');
  eq(lineTapOpens({ view: 'nearby', journey: { kind: 'filter', rids: ['a'] } }), true, 'a route filter is not a trip');
  eq(lineTapOpens(null), false);
});

function box(id) {
  const d = document.createElement('div');
  d.id = id;
  d.style.cssText = 'position:absolute;left:-2000px;top:0;width:400px;height:600px';
  document.body.appendChild(d);
  return d;
}
function bareMap(id) {
  const m = window.L.map(box(id), { zoomControl: false, attributionControl: false }).setView(P(2, 0), 15);
  for (const [n, z] of Object.entries({ sbCasing: 380, sbLines: 390, sbFocusCasing: 392, sbFocusLines: 394, sbStops: 420 })) m.createPane(n).style.zIndex = z;
  return m;
}
// two routes on the same street (a-b), one more 2 units north; stops off to the side
const routes = { ra: { long: 'Alpha', color: '#0055AA' }, rb: { long: 'Beta', color: '#AA2200' }, rc: { long: 'Gamma', color: '#118833' } };
const shapes = { ra: [[P(0, 0), P(4, 0)]], rb: [[P(0, 0), P(4, 0)]], rc: [[P(0, 2), P(4, 2)]] };
const net = (o = {}) => ({ routes, shapes, routeStops: {}, stopRoutes: {}, stops: {}, hidden: [], focus: null, order: [], ...o });

test('network lineAt: the route drawn on top wins on a shared street; order, focus and hidden decide', () => {
  const m = bareMap('t-lt-net');
  const layer = createNetworkLayer(m, { onStopTap: () => {} });
  const on = m.latLngToContainerPoint(P(2, 0)), near = { x: on.x, y: on.y + 8 }, far = { x: on.x, y: on.y + 60 };
  layer.draw(net({ order: ['rb', 'ra'] }));
  eq(layer.lineAt(near), 'rb', 'order index 0 = drawn on top');
  layer.draw(net({ order: ['ra', 'rb'] }));
  eq(layer.lineAt(near), 'ra');
  layer.draw(net({ order: ['ra', 'rb'], focus: ['rb'] }));
  eq(layer.lineAt(near), 'rb', 'a focused (bright) route sits above the dimmed ones');
  layer.draw(net({ order: ['ra', 'rb'], hidden: ['ra'] }));
  eq(layer.lineAt(near), 'rb', 'a hidden route is not drawn, so it is never tapped');
  eq(layer.lineAt(far), null, 'nothing within reach');
  eq(layer.lineAt(m.latLngToContainerPoint(P(2, 2))), 'rc', 'the other street');
  eq(layer.lineAt(null), null);
  m.remove();
});

test('MapApi.onLineTap: a tap near a line names its route instead of an empty-map tap; plans and stops keep theirs', () => {
  box('t-lt-api');
  const api = createMap('t-lt-api'), m = api.leaflet, el = m.getContainer();
  m.setView(P(2, 0), 15, { animate: false });
  const lines = [], empties = [];
  api.drawNetwork(net({ order: ['rb', 'ra'] }));
  api.onMapTap((p) => empties.push(p));
  const tap = (pt, target = el) => m.fire('click', { latlng: m.containerPointToLatLng(pt), containerPoint: pt, originalEvent: { target } });
  const on = m.latLngToContainerPoint(P(2, 0));
  tap({ x: on.x, y: on.y + 6 });
  eq([lines.length, empties.length], [0, 1], 'no onLineTap listener yet: the tap stays an empty-map tap');
  const off = api.onLineTap((rid) => lines.push(rid));
  empties.length = 0;
  tap({ x: on.x, y: on.y + 6 });
  eq(lines, ['rb'], 'the top route');
  eq(empties.length, 0, 'not also an empty-map tap');
  tap({ x: on.x, y: on.y + 80 });
  eq(empties.length, 1, 'far from every line: empty map');
  const halo = document.createElement('div'); halo.className = 'leaflet-interactive'; el.appendChild(halo);
  tap({ x: on.x, y: on.y + 6 }, halo);
  eq([lines.length, empties.length], [1, 1], 'a stop halo / marker keeps its own tap');
  api.drawPlan({ from: { lat: P(0, 3)[0], lon: P(0, 3)[1] }, to: { lat: P(1, 3)[0], lon: P(1, 3)[1] } }, { routes, shapes, routeStops: {} });
  tap({ x: on.x, y: on.y + 6 });
  eq([lines.length, empties.length], [1, 2], 'while a plan is drawn, lines are a dim backdrop: an empty-map tap');
  api.drawPlan(null);
  off();
  tap({ x: on.x, y: on.y + 6 });
  eq([lines.length, empties.length], [1, 3], 'listener removed: empty-map tap again');
  m.remove();
});

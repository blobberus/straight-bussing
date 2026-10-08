/**
 * Overlay demo for headless screenshots: map.test.html?demo=light|dark[&raster=1][&plan=0][&focus=rid][&order=rid,rid][&fav=0].
 * Draws the real network, fake buses (one stale, one without heading), favorite stations, a selected stop, the user dot,
 * picker highlights and a trip plan above a fake 300 px sheet. Sets document.title to "DEMO ready".
 */
import { createMap } from '../js/map/map.js';

/** Initial bearing a -> b in degrees ([lat, lon] points). */
function bearingDeg(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

const q = new URLSearchParams(location.search);
const dark = q.get('demo') === 'dark';
if (q.has('raster')) { delete window.maplibregl; }
document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
document.body.style.cssText = 'margin:0;height:100vh;overflow:hidden;font-family:system-ui';
document.getElementById('h').remove();
document.getElementById('result').remove();
const host = document.createElement('div');
host.id = 'map';
host.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(host);
const sheet = document.createElement('div');
sheet.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:300px;border-radius:20px 20px 0 0;z-index:1000;
  background:${dark ? 'rgba(28,28,30,.86)' : 'rgba(255,255,255,.88)'};box-shadow:0 -8px 32px rgba(0,0,0,.14);
  color:${dark ? '#f5f5f7' : '#111114'};padding:16px;font:600 17px system-ui`;
sheet.textContent = 'Fake sheet (300 px inset)';
document.body.appendChild(sheet);

const get = (f) => fetch('../data/' + f).then((r) => r.json());
const [routes, stops, shapes, routeStops] = await Promise.all(['routes.json', 'stops.json', 'shapes.json', 'route_stops.json'].map(get));
const stopRoutes = {};
for (const [rid, ids] of Object.entries(routeStops)) for (const id of new Set(ids)) (stopRoutes[id] ||= []).push(rid);

const api = createMap('map');
api.setTheme(dark);
api.setBottomInset(300);
const focus = q.get('focus') ? [q.get('focus')] : null;
const order = q.get('order') ? q.get('order').split(',') : [];   // draw priority, first on top
api.drawNetwork({ routes, shapes, routeStops, stopRoutes, stops, hidden: [], focus, order, dark });

const now = Date.now() / 1000;
const buses = [];
let n = 0;
for (const [rid, lines] of Object.entries(shapes)) {
  const line = lines[0];
  const i = Math.floor(line.length * (0.2 + 0.13 * (n % 5)));
  const a = line[i], b = line[Math.min(line.length - 1, i + 2)];
  buses.push({ vehicle: { id: 'v' + n, label: String(100 + n) }, trip: { route_id: rid },
    position: { latitude: a[0], longitude: a[1], bearing: n === 3 ? undefined : bearingDeg(a, b) },
    timestamp: n === 1 ? now - 200 : now - 5 });
  n++;
}
const rid = '1078', seq = routeStops[rid];
const st = (id) => ({ id, name: stops[id].name, lat: stops[id].lat, lon: stops[id].lon });
if (q.get('plan') === '0') { // a few buses near the selected stop: fresh, stale, no heading, 4-char label
  const c = st(seq[4]);
  const near = (dx, dy, r, id, extra = {}) => ({ vehicle: { id, label: id }, trip: { route_id: r },
    position: { latitude: c.lat + dy, longitude: c.lon + dx, bearing: 75 }, timestamp: now - 5, ...extra });
  buses.push(near(0.0016, 0.0003, '1078', 'n1'), near(-0.0022, -0.0009, '5699', 'n2', { timestamp: now - 300 }),
    near(0.0004, -0.0016, '4346', 'n3'), near(-0.0010, 0.0012, '1075', 'n4', { position: { latitude: c.lat + 0.0012, longitude: c.lon - 0.001 } }));
}
api.drawBuses(buses, { routes, hidden: [], focus, nowS: now });

// favorites: the selected stop (plan=0), a stop near it and one farther away (&fav=0 hides them)
if (q.get('fav') !== '0') api.drawFavorites([st(seq[4]), st(seq[6]), st(seq[Math.min(seq.length - 1, 11)])]);

const board = st(seq[2]), alight = st(seq[7]);
api.setUser({ lat: board.lat - 0.0016, lon: board.lon - 0.0012, accuracy: 35 });
if (q.get('plan') !== '0') {
  const from = { lat: board.lat - 0.0016, lon: board.lon - 0.0012, name: 'Start' };
  const to = { lat: alight.lat + 0.0011, lon: alight.lon + 0.0014, name: 'Destination' };
  const option = { key: 'demo', legs: [
    { type: 'walk', from, to: board, m: 220, min: 3, coords: [[from.lat, from.lon], [from.lat, board.lon], [board.lat, board.lon]] },
    { type: 'bus', rid, board, alight, path: seq.slice(2, 8).map(st) },
    { type: 'walk', from: alight, to, m: 180, min: 2 },
  ] };
  api.drawPlan(option, { routes, shapes, routeStops, fit: true });
} else {
  api.setSelectedStop(st(seq[4]));
  api.highlightStops([st(seq[1]), st(seq[5])], { onPick: () => {} });
  if (focus && shapes[focus[0]]) api.fitTo(shapes[focus[0]].flat(), { maxZoom: 16, animate: false });
  else api.flyTo(st(seq[4]), 16);
}
// diagnostics for headless runs: style layer count + maplibre errors end up in the title
const diag = { layers: 0, errors: [] };
api.leaflet.eachLayer((l) => {
  const gl = l.getMaplibreMap?.();
  if (!gl) return;
  gl.on('styledata', () => { diag.layers = gl.getStyle()?.layers?.length || 0; });
  gl.on('error', (e) => diag.errors.push(String(e?.error?.message || e?.message || e).slice(0, 120)));
});
setTimeout(() => { document.title = `DEMO ready layers=${diag.layers} errors=${diag.errors.length} ${diag.errors.slice(0, 3).join(' / ')}`; }, 4000);

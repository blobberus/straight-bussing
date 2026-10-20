// MapApi.setTrip / inView (owner request 2026-10-13): you on the started trip and the labels on your stops.
import { test, eq, ok } from './lib.js';
import { createMap } from '../js/map/map.js';
import { P } from './map-fixtures.js';

const routes = { r1: { short: 'CEN', long: 'Central', color: '#FF9900' } };
const ll = (x, y) => ({ lat: P(x, y)[0], lon: P(x, y)[1] });
const bus = (id, x, y) => ({ vehicle: { id, label: 'B' + id }, trip: { route_id: 'r1' },
  position: { latitude: P(x, y)[0], longitude: P(x, y)[1], bearing: 90 }, timestamp: 1000 });
const you = (o) => ({ phase: 'on-bus', active: 1, source: 'bus', onBus: true, far: false, vehicleId: '7', label: '7', stopsAway: null, stopsLeft: 2,
  board: { id: 'A', name: 'A st', ...ll(0, 0) }, alight: { id: 'C', name: 'C st', ...ll(4, 4) }, target: null, frame: [], text: 'You are on Bus 7. Get off in 2 stops: C st',
  ...ll(2, 2), ...o });

function box(id) {
  const d = document.createElement('div');
  d.id = id;
  d.style.cssText = 'position:absolute;left:-2000px;top:0;width:400px;height:700px';
  document.body.appendChild(d);
  return d;
}

test('MapApi.setTrip: on the bus = ring + "You" on its marker, GPS dot steps back, get-off count on your stop', () => {
  box('t-trip');
  const api = createMap('t-trip'), el = api.leaflet.getContainer();
  eq([typeof api.setTrip, typeof api.inView], ['function', 'function']);
  api.drawBuses([bus('7', 2, 2), bus('8', 3, 3)], { routes, nowS: 1000 });
  api.setUser(ll(2.1, 2));
  api.setTrip(you());
  const mine = el.querySelectorAll('.sb-bus.is-you');
  eq(mine.length, 1, 'only your bus');
  ok(mine[0].querySelector('.sb-you-ring') && mine[0].querySelector('.sb-you-pill').textContent === 'You');
  ok(el.classList.contains('sb-you-onbus'), 'the GPS dot steps back while you ride');
  eq(getComputedStyle(el.querySelector('.sb-meicon')).display, 'none');
  eq(el.querySelectorAll('.sb-youicon').length, 0, 'no second You marker');
  eq([...el.querySelectorAll('.sb-tlabel')].map((x) => x.textContent), ['Get off in 2 stops']);
  api.setTrip(you({ stopsLeft: 1 }));
  eq([...el.querySelectorAll('.sb-tlabel')].map((x) => x.textContent), ['Get off next stop'], 'the count follows');
  // the bus moves (glides): the ring is part of its marker, so it moves with it; a re-created marker keeps it
  api.drawBuses([bus('7', 2.5, 2.5), bus('8', 3, 3)], { routes, nowS: 1010 });
  eq(el.querySelectorAll('.sb-bus.is-you').length, 1);
  // before boarding: the GPS dot is back, labels "Board here" + "Get off here"
  api.setTrip(you({ phase: 'waiting', source: 'gps', onBus: false, stopsAway: 2, stopsLeft: null, ...ll(0.1, 0), text: 'Your location. Waiting at A st.' }));
  ok(!el.classList.contains('sb-you-onbus') && !el.querySelector('.sb-bus.is-you'));
  eq([...el.querySelectorAll('.sb-tlabel')].map((x) => x.textContent), ['Board here', 'Get off here']);
  // waiting without GPS: a dashed guess at the boarding stop, said as an estimate
  api.setTrip(you({ phase: 'waiting', source: 'stop', onBus: false, stopsAway: 2, stopsLeft: null, ...ll(0, 0), text: 'Waiting at A st.' }));
  const g = el.querySelector('.sb-youicon .sb-you--stop');
  ok(g && g.querySelector('.sb-you-pill').textContent === 'You (est.)');
  // your bus is not drawn (another route in focus): a You marker of its own at the bus position
  api.drawBuses([bus('7', 2.5, 2.5), bus('8', 3, 3)], { routes, focus: ['r9'], nowS: 1020 });
  api.setTrip(you());
  ok(el.querySelector('.sb-youicon .sb-you--bus'), 'standalone You on the bus position');
  api.setTrip(null);
  eq([el.querySelectorAll('.sb-tlabel').length, el.querySelectorAll('.sb-youicon').length], [0, 0], 'cleared');
});

test('MapApi.inView: inside the area above the sheet; null when the sheet covers the map', () => {
  box('t-view');
  const api = createMap('t-view'), m = api.leaflet;
  m.setView(P(2, 2), 15, { animate: false });
  api.setBottomInset(200);
  eq(api.inView([P(2, 2)]), true);
  eq(api.inView([P(2, 2), P(60, 60)]), false, 'one point far away');
  api.setBottomInset(650);
  eq(api.inView([P(2, 2)]), null);
});

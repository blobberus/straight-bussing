/** Tests for map/layers.js signatures + in-place updates, and the MapApi in map/map.js (needs Leaflet). */
import { test, eq, ok, near } from './lib.js';
import { idOf, sig, focusSet, networkSig, busSig, lineWeight, lineTapWidth, FOCUS_EXTRA, routeLabel, createNetworkLayer, createBusLayer, notchRadius } from '../js/map/layers.js';
import { createMap } from '../js/map/map.js';
import { mapColor } from '../js/core/routecolor.js';
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
  ok(busSig('r1', 41.1, -87.1, 90, false, 'CEN', '#FF9900', false, 0, false, true) !== a, 'faded');
  // owner 2026-11-04 "make the lines themselves thinner": z13 2, z14 2.25, z15 3, z16 4, z17 5, z18 6 (spec 11.3 had 3, 3.5,
  // 4.5, 5.5, 6.5, 8: a third thinner zoomed out, a quarter up close), linear between, clamped
  eq([13, 14, 15, 16, 17, 18].map(lineWeight), [2, 2.25, 3, 4, 5, 6]);
  eq(lineWeight(14.5), 2.63); eq(lineWeight(5), 2); eq(lineWeight(20), 6);
  eq(lineTapWidth(15), 4.5 + 3 + FOCUS_EXTRA, 'tap reach as before: a focused line with its old 3 px edge');
  eq(lineTapWidth(17), 6.5 + 3 + FOCUS_EXTRA);
  eq(routeLabel('r1', routes), 'CEN'); eq(routeLabel('r2', routes), 'N'); eq(routeLabel('zz', routes), '?');
  eq(routeLabel('x', { x: { short: '', long: 'Friend Center/Metra' } }), 'F', 'like the iPhone app (Route.chipText)');
  eq(routeLabel('x', { x: { short: 'AP/DX', long: 'Apostolic/Drexel' } }), 'AP/DX', 'never truncated (audit defect 4)');
  eq(notchRadius(32, 26, 0), 13); eq(notchRadius(60, 26, 90), 30); eq(notchRadius(60, 26, 180), 13);
});

test('network layer: polling does not repaint; changes do', () => {
  const m = bareMap('t-net');
  const taps = [];
  const layer = createNetworkLayer(m, { onStopTap: (id) => taps.push(id) });
  ok(layer.draw(net()), 'first draw');
  const el = m.getContainer(), first = paths(el);
  eq(first.length, 3 + 8 * 2, 'one line per shape (no outline) and stop + halo per stop');
  eq(el.querySelectorAll('path.sb-casing').length, 0, 'no outlines (owner 2026-11-04)');
  eq(paths(el).filter((p) => p.classList.contains('sb-route')).map((p) => p.getAttribute('stroke-width')), ['3', '3', '3'], 'thinner: 3 px at z15');
  eq(layer.draw(net({ hidden: [] })), false, 'same inputs -> no redraw');
  ok(paths(el).every((p, i) => p === first[i]), 'same DOM nodes');
  ok(layer.draw(net({ hidden: ['r2'] })), 'hidden change redraws');
  ok(paths(el).length < first.length, 'hidden route gone');
  layer.draw(net({ focus: ['r1'] }));
  const dim = paths(el).filter((p) => p.classList.contains('sb-route') && p.getAttribute('stroke-opacity') === '0.2');
  eq(dim.length, 2, 'two non-focus routes dimmed to 0.2 (spec 11.3)');
  const front = m.getPane('sbFocusLines').querySelectorAll('path.sb-route');
  eq(front.length, 1, 'focused route drawn in the top pane');
  eq(front[0].getAttribute('stroke-width'), String(3 + FOCUS_EXTRA), 'the focused route stands out: 3 + FOCUS_EXTRA');
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
  eq(m.getContainer().querySelectorAll('.sb-bus').length, 2, 'focus: the other route\'s bus stays, faded');
  const icons = [...m.getContainer().querySelectorAll('.sb-busicon')];
  const r2icon = icons.find((e) => e.textContent.includes('N')), r3icon = icons.find((e) => e.textContent.includes('RED'));
  ok(r3icon.classList.contains('is-faded') && r3icon.querySelector('.sb-bus').classList.contains('is-faded'), 'the bus on the faded route is faded');
  ok(!r2icon.classList.contains('is-faded'), 'the focused route\'s bus is not');
  eq(getComputedStyle(r3icon).pointerEvents, 'none', 'a faded bus takes no tap');
  const settle = (el) => { for (const a of el.getAnimations()) a.finish(); return getComputedStyle(el); };   // CSS transitions
  ok(+settle(r3icon.querySelector('.sb-bus')).opacity < 0.5, 'and steps back');
  ok(+r3icon.style.zIndex < +r2icon.style.zIndex, 'under the buses in focus');
  r2icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  eq(taps[0]?.rid, 'r2'); eq(taps[0]?.label, 'B2');
  layer.draw([bus(1, 'r3', 1.5, 1), bus(2, 'r2', 3, -2)], { ...o, focus: ['r2'], hidden: ['r3'] });
  eq(m.getContainer().querySelectorAll('.sb-bus').length, 1, 'a hidden route\'s bus is never drawn');
  layer.draw([bus(1, 'r3', 1.5, 1), bus(2, 'r2', 3, -2)], { ...o, focus: ['r3'], hidden: ['r3'] });
  ok([...m.getContainer().querySelectorAll('.sb-busicon')].some((e) => e.textContent.includes('RED') && !e.classList.contains('is-faded')),
    'a hidden route in focus (its route page) shows its bus');
  // a plan drawn (Directions, a started trip) with no focus: the buses of the routes it rides stay, the rest fade
  layer.draw([bus(1, 'r3', 1.5, 1), bus(2, 'r2', 3, -2)], { ...o, plan: ['r2'] });
  const faded = () => [...m.getContainer().querySelectorAll('.sb-busicon.is-faded')].map((e) => e.textContent.trim());
  eq(faded(), ['RED'], 'plan rides r2: only the r3 bus fades');
  layer.draw([bus(1, 'r3', 1.5, 1, { timestamp: 900 }), bus(2, 'r2', 3, -2)], { ...o, plan: ['r2'] });
  const st = [...m.getContainer().querySelectorAll('.sb-bus.is-faded')][0];
  ok(st.classList.contains('is-stale'), 'stale and faded together');
  ok(+settle(st).opacity < 0.42, 'a stale faded bus is fainter still');
  layer.draw([bus(1, 'r3', 1.5, 1), bus(2, 'r2', 3, -2)], { ...o, plan: [] });
  eq(faded().sort(), ['N', 'RED'], 'a walk plan rides no route: every bus fades');
  layer.draw([bus(1, 'r3', 1.5, 1), bus(2, 'r2', 3, -2)], o);
  eq(faded(), [], 'no focus, no plan: none faded');
  m.remove();
});

test('bus layer: the bus you ride is never faded', () => {
  const m = bareMap('t-busyou');
  const layer = createBusLayer(m, { onBusTap: () => {} });
  const o = { routes, hidden: [], focus: ['r2'], nowS: 1010 };
  layer.draw([bus(1, 'r3', 1.5, 1), bus(2, 'r2', 3, -2)], o);
  const r3 = () => [...m.getContainer().querySelectorAll('.sb-busicon')].find((e) => e.textContent.includes('RED'));
  ok(r3().classList.contains('is-faded'));
  ok(layer.setYou('1'), 'your bus is drawn');
  ok(!r3().classList.contains('is-faded') && r3().querySelector('.sb-bus.is-you'), 'on it: full strength, with the You ring');
  layer.setYou(null);
  ok(r3().classList.contains('is-faded'), 'off it: faded again');
  m.remove();
});

test('bus layer: numbered buses (2 or more on a line), their names, the picked bus (owner 2026-10-30)', () => {
  const m = bareMap('t-busnum');
  const taps = [];
  const layer = createBusLayer(m, { onBusTap: (b) => taps.push(b) });
  const o = { routes, hidden: [], focus: null, nowS: 1010 };
  layer.draw([bus(12, 'r1', 1, 1), bus(4, 'r1', 2, 2), bus(7, 'r2', 3, -2)], o);
  const els = () => [...m.getContainer().querySelectorAll('.sb-busicon')];
  const byName = (t) => els().find((e) => e.getAttribute('aria-label') === t);
  ok(byName('Bus 1, Central') && byName('Bus 2, Central'), 'r1 has two buses: Bus 1 (id 4) and Bus 2 (id 12)');
  eq(byName('Bus 1, Central').querySelector('.sb-bus-num').textContent, '1');
  ok(byName('Route N bus') || els().some((e) => !e.querySelector('.sb-bus-num')), 'the only bus on r2 has no number');
  const el12 = byName('Bus 2, Central');
  layer.draw([bus(12, 'r1', 1, 1), bus(4, 'r1', 2, 2), bus(7, 'r2', 3, -2)], { ...o, selected: '12' });
  ok(el12.querySelector('.sb-bus').classList.contains('is-picked'), 'the picked bus is highlighted');
  ok(el12.isConnected, 'same marker element (no rebuild)');
  layer.draw([bus(12, 'r1', 1, 1), bus(7, 'r2', 3, -2)], o);
  ok(!el12.querySelector('.sb-bus-num') && el12.getAttribute('aria-label') === 'Route CEN bus', 'one bus left: the number goes, in place');
  ok(!el12.querySelector('.sb-bus').classList.contains('is-picked'));
  el12.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  eq(taps[0]?.id, '12', 'the tap carries the bus key');
  m.remove();
});

test('MapApi: theme, network diff, plan, highlights, flyTo offset by inset', async () => {
  box('t-api');
  const api = createMap('t-api');
  const m = api.leaflet, el = m.getContainer();
  for (const k of ['setTheme', 'setBottomInset', 'drawNetwork', 'drawBuses', 'setSelectedStop', 'setUser', 'setHeading', 'highlightStops',
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
  const dimmed = paths(m.getPane('sbLines')).filter((p) => p.getAttribute('stroke-opacity') === '0.2');
  eq(dimmed.length, 3, 'network dims to 0.2 while a plan is shown (spec 11.3)');
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

test('dark map: a dark route is drawn lighter in its own hue (lines, stop rings, buses, plan legs); a theme switch recolors in place (owner 2026-11-06)', () => {
  const RE = '#393B79', lifted = mapColor(RE, true);
  ok(lifted !== RE, 'Regents Express navy is lifted on the dark map');
  const dk = { ...routes, r2: { short: 'RE', long: 'Regents Express', color: RE } };
  const m = bareMap('t-dark');
  const layer = createNetworkLayer(m, { onStopTap: () => {} });
  layer.draw({ ...net(), routes: dk, focus: ['r2'] });
  const el = m.getContainer(), before = paths(el);
  const stroke = (sel) => [...el.querySelectorAll(sel)].map((p) => p.getAttribute('stroke').toUpperCase());
  const reLine = () => m.getPane('sbFocusLines').querySelector('path.sb-route').getAttribute('stroke').toUpperCase();
  eq(reLine(), RE, 'light map: the published color');
  const chev0 = el.querySelector('path.sb-chev')?.getAttribute('stroke');
  layer.setDark(true);
  eq(reLine(), lifted, 'dark map: lifted');
  ok(stroke('path.sb-stop:not(.sb-stop-multi)').includes(lifted), 'its stop rings too');
  ok(stroke('path.sb-route').includes('#FF9900') && stroke('path.sb-route').includes('#D62728'), 'colors already 3:1 on the land stay');
  ok(paths(el).filter((p) => !p.classList.contains('sb-chev')).every((p, i) => p === before.filter((q) => !q.classList.contains('sb-chev'))[i]), 'no rebuild');
  const chev1 = el.querySelector('path.sb-chev')?.getAttribute('stroke');
  ok(chev0 && chev1 && chev1 !== chev0, `chevrons in the lifted line's text color (${chev0} -> ${chev1})`);
  layer.draw({ ...net(), routes: dk, focus: null });
  ok(stroke('path.sb-route').includes(lifted), 'a redraw while dark keeps the dark colors');
  layer.setDark(false);
  ok(stroke('path.sb-route').includes(RE) && !stroke('path.sb-route').includes(lifted), 'back to the published color');

  const buses = createBusLayer(m, { onBusTap: () => {} });
  buses.setDark(true);
  buses.draw([bus(1, 'r2', 1, -2), bus(2, 'r1', 2, 0)], { routes: dk, hidden: [], focus: null, nowS: 1010 });
  const badge = (t) => [...el.querySelectorAll('.sb-bus')].find((b) => b.querySelector('.sb-bus-tx').textContent === t);
  const re = badge('RE');
  eq(re.style.getPropertyValue('--c').toUpperCase(), lifted, 'the bus badge in the lifted color');
  eq(re.style.getPropertyValue('--t'), '#111114', 'its text flips to dark (AA on the lighter fill)');
  eq(badge('CEN').style.getPropertyValue('--c').toUpperCase(), '#FF9900', 'a bright route keeps its badge');
  buses.setDark(false);
  ok(badge('RE') === re, 'theme switch: the same badge');
  eq(re.style.getPropertyValue('--c').toUpperCase(), RE, 'back to navy');
  eq(re.style.getPropertyValue('--t'), '#ffffff', 'white text on navy');
  const poll = () => buses.draw([bus(1, 'r2', 1, -2), bus(2, 'r1', 2, 0)], { routes: dk, hidden: [], focus: null, nowS: 1010 });
  poll();
  ok(badge('RE') === re && re.style.getPropertyValue('--c').toUpperCase() === RE, 'the next poll keeps the badge and its color');
  eq(poll(), 0, 'and the one after touches nothing');
  m.remove();

  box('t-dark-api');
  const api = createMap('t-dark-api', { dark: true });
  const ael = api.leaflet.getContainer();
  api.drawNetwork({ ...net(), routes: dk });
  ok([...ael.querySelectorAll('path.sb-route')].some((p) => p.getAttribute('stroke').toUpperCase() === lifted), 'a dark launch draws the lifted color at once');
  const leg = { type: 'bus', rid: 'r2', board: { ...stop('E', 0, -2), name: 'E' }, alight: { ...stop('F', 6, -2), name: 'F' }, path: [stop('E', 0, -2), stop('F', 6, -2)] };
  api.drawPlan({ key: 'p', legs: [leg] }, { routes: dk, shapes, routeStops });
  const planLeg = () => ael.querySelector('path.sb-plan-bus').getAttribute('stroke').toUpperCase();
  eq(planLeg(), lifted, 'the planned bus leg too');
  ok([...ael.querySelectorAll('path.sb-plan-stop')].every((p) => p.getAttribute('stroke').toUpperCase() === lifted), 'and its board / alight rings');
  api.setTheme(false);
  eq(planLeg(), RE, 'light theme: the plan redraws in the published color');
  ok([...ael.querySelectorAll('path.sb-route')].some((p) => p.getAttribute('stroke').toUpperCase() === RE), 'and the network');
  api.leaflet.remove();
});

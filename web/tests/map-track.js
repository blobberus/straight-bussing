/** Tests for map/track.js (buses stay on their route line) and the bus layer's movement along it (needs Leaflet). */
import { test, eq, ok, near } from './lib.js';
import { prepareShape, pointAt, walk, locate, follow, headingAt, advance, ON_M } from '../js/map/track.js';
import { createBusLayer, moveTiming, GLIDE_MS } from '../js/map/layers.js';
import { distM } from '../js/map/geometry.js';
import { P, squareLoop } from './map-fixtures.js';

/** Meters from a point to the nearest point of a polyline. */
function offLine(line, p) {
  const s = prepareShape([line])[0];
  let best = Infinity;
  for (let x = 0; x <= s.L; x += 1) best = Math.min(best, distM(pointAt(s.line, s.cum, x), p));
  return best;
}
const ell = () => [P(0, 0), P(3, 0), P(3, 3)];                  // east 3 units (~500 m), then north 3 units (~667 m)
const outBack = () => [0, 1, 2, 3, 4].map((x) => P(x, 0)).concat([3, 2, 1, 0].map((x) => P(x, 0.0001)));   // east, then back west on the same street
const nudge = (p, dLat) => [p[0] + dLat, p[1]];                 // a GPS fix a little north of a point

test('track: prepareShape cleans, caches and finds loops', () => {
  const lines = [[P(0, 0), P(0, 0), P(2, 0), ['x', 1]], [P(1, 1)], squareLoop()];
  const prep = prepareShape(lines);
  eq(prep.length, 2, 'repeats, junk and one-point lines dropped');
  eq(prep[0].line.length, 2);
  ok(!prep[0].closed && prep[1].closed, 'open line and loop');
  ok(prepareShape(lines) === prep, 'cached per shapes array');
  eq(prepareShape(null).length, 0);
});

test('track: walk goes through the corner, backwards, and round a loop', () => {
  const s = prepareShape([ell()])[0];
  const corner = s.cum[1];
  const path = walk(s, corner - 100, 200);
  ok(path.some((p) => distM(p, P(3, 0)) < 0.01), 'the corner vertex is on the way');
  near(distM(path[path.length - 1], pointAt(s.line, s.cum, corner + 100)), 0, 0.01);
  const back = walk(s, corner + 50, -100);
  ok(back.some((p) => distM(p, P(3, 0)) < 0.01), 'backwards through the corner too');
  const sq = prepareShape([squareLoop()])[0];
  const wrap = walk(sq, sq.L - 30, 80);
  ok(wrap.some((p) => distM(p, P(0, 0)) < 0.01), 'a loop continues through its start');
  near(advance(sq, sq.L - 30, 80), 50, 1e-6);
  near(advance(s, 10, -50), 0, 1e-6, 'open lines clamp');
});

test('track: off the line stays where it is; near it, it is drawn on it', () => {
  const prep = prepareShape([ell()]);
  const far = nudge(P(1, 0), 100 / 111195);                      // 100 m north of the street
  const r = follow(prep, null, null, far, {});
  ok(r.to === null && !r.along, 'off the line');
  eq(r.path[r.path.length - 1], far);
  const near20 = nudge(P(1, 0), 20 / 111195);
  const r2 = follow(prep, null, null, near20, {});
  ok(r2.to && distM(r2.to.pt, P(1, 0)) < 1, 'projected onto the street');
  ok(locate(prep, nudge(P(1, 0), (ON_M + 5) / 111195)).length === 0, 'just past ON_M is off');
});

test('track: a move round the corner follows the street', () => {
  const prep = prepareShape([ell()]), s = prep[0], corner = s.cum[1];
  const from = { li: 0, pos: corner - 150 }, at = pointAt(s.line, s.cum, from.pos);
  const fix = nudge(pointAt(s.line, s.cum, corner + 200), 0.00008);   // a few meters off, past the corner
  const r = follow(prep, from, at, fix, { dt: 12 });
  ok(r.along, 'along the line');
  near(r.f, 350, 15);
  ok(r.path.some((p) => distM(p, P(3, 0)) < 0.01), 'through the corner, not across the block');
  for (const p of r.path) ok(offLine(ell(), p) < 1.5, 'every point of the way is on the line');
  near(headingAt(s, corner + 200), 0, 1, 'heading north after the corner');
  const j = follow(prep, { li: 0, pos: 300 }, pointAt(s.line, s.cum, 300), pointAt(s.line, s.cum, 290), { dt: 10 });
  ok(j.along && j.f < 0 && j.f > -15, 'GPS jitter back stays on the line');
});

test('track: an out-and-back street keeps the pass the bus is on', () => {
  const prep = prepareShape([outBack()]), s = prep[0];
  const out = follow(prep, { li: 0, pos: 100 }, pointAt(s.line, s.cum, 100), pointAt(s.line, s.cum, 150), { dt: 10 });
  ok(out.along && Math.abs(out.f - 50) < 3, 'outbound continues outbound');
  const half = s.L / 2;
  const back = follow(prep, { li: 0, pos: half + 100 }, pointAt(s.line, s.cum, half + 100), pointAt(s.line, s.cum, half + 150), { dt: 10 });
  ok(back.along && Math.abs(back.f - 50) < 3, 'inbound continues inbound (not 600 m back to the outbound pass)');
  const east = follow(prep, null, null, pointAt(s.line, s.cum, 200), { bearing: 90 });
  const west = follow(prep, null, null, pointAt(s.line, s.cum, 200), { bearing: 270 });
  ok(east.to.pos < half && west.to.pos > half, 'a new badge takes the pass heading the feed\'s way');
});

test('track: after a gap the catch-up is still along the line; an impossible jump is not', () => {
  const sq = prepareShape([squareLoop()]), s = sq[0];
  const from = { li: 0, pos: 50 }, at = pointAt(s.line, s.cum, 50), fix = pointAt(s.line, s.cum, 1700);
  const quick = follow(sq, from, at, fix, { dt: 10 });
  ok(!quick.along, '1.65 km in 10 s is no drive: not along');
  const gap = follow(sq, from, at, fix, { dt: 300 });
  ok(gap.along && Math.abs(gap.f - 1650) < 5, 'after 5 min without data: along the loop');
  ok(gap.path.some((p) => distM(p, P(4, 0)) < 0.01) && gap.path.some((p) => distM(p, P(4, 4)) < 0.01), 'round both corners');
  const wrap = follow(sq, { li: 0, pos: s.L - 40 }, pointAt(s.line, s.cum, s.L - 40), pointAt(s.line, s.cum, 60), { dt: 10 });
  ok(wrap.along && Math.abs(wrap.f - 100) < 3, 'through the loop start');
});

test('track: move timing (glide, catch-up, jump, reduced motion)', () => {
  eq(moveTiming({ along: true }, 120, 10, false), { dur: GLIDE_MS, ease: false }, 'a normal poll glides at constant speed');
  const c = moveTiming({ along: true }, 1500, 300, false);
  ok(c.ease && c.dur >= 900 && c.dur <= 2600, 'a catch-up eases in at most 2.6 s');
  ok(moveTiming({ along: true }, 120, 120, false).ease, 'a short move after a long gap catches up too');
  eq(moveTiming({ along: false }, 80, 10, false).dur, GLIDE_MS, 'off the line: a short straight glide');
  eq(moveTiming({ along: false }, 400, 10, false).dur, 0, 'off the line: a long move jumps');
  eq(moveTiming({ along: true }, 120, 10, true).dur, 0, 'reduced motion: at once');
});

function box(id) {
  const d = document.createElement('div');
  d.id = id;
  d.style.cssText = 'position:absolute;left:-2000px;top:0;width:400px;height:600px';
  document.body.appendChild(d);
  return d;
}

/** A bus layer with a manual clock and frame queue: step(ms) advances time and runs one frame. */
function manualLayer(m, reduce = false) {
  let T = 0, queue = [];
  const layer = createBusLayer(m, { onBusTap: () => {} }, { clock: () => T, frame: (fn) => { queue.push(fn); return queue.length; }, reduce: () => reduce });
  layer.step = (ms) => { T += ms; const q = queue; queue = []; q.forEach((f) => f()); return q.length; };
  return layer;
}

test('bus layer: the badge rides the line round the corner after a gap, never across the block', () => {
  const m = window.L.map(box('t-track'), { zoomControl: false, attributionControl: false }).setView(P(2, 1), 15);
  const layer = manualLayer(m);
  const routes = { r1: { short: 'CEN', color: '#FF9900' } }, shapes = { r1: [ell()] };
  const s = prepareShape(shapes.r1)[0], corner = s.cum[1];
  const pos = (x) => pointAt(s.line, s.cum, x);
  const bus = (p, ts) => ({ vehicle: { id: 7 }, trip: { route_id: 'r1' }, position: { latitude: p[0] + 0.00012, longitude: p[1] }, timestamp: ts });
  layer.draw([bus(pos(corner - 300), 1000)], { routes, shapes, nowS: 1000 });
  ok(offLine(ell(), layer.shown(7)) < 1, 'a new badge is drawn on the line, not 13 m off it');
  layer.draw([bus(pos(corner + 400), 1180)], { routes, shapes, nowS: 1180 });  // 3 min without data, 700 m on
  const seen = [];
  for (let i = 0; i < 200 && layer.step(16); i++) seen.push(layer.shown(7));
  ok(seen.length > 50 && seen.length < 170, `animated over ${seen.length} frames (a 0.9 to 2.6 s catch-up)`);
  for (const p of seen) ok(offLine(ell(), p) < 2, 'on the line at every frame');
  ok(seen.some((p) => distM(p, P(3, 0)) < 40), 'it went round the corner');
  const fix = bus(pos(corner + 400), 0).position, want = follow(prepareShape(shapes.r1), null, null, [fix.latitude, fix.longitude]).to.pt;
  near(distM(layer.shown(7), want), 0, 1, 'ends at the new report projected onto the line');
  m.remove();
});

test('bus layer: a normal poll glides along the line at constant speed; reduced motion moves at once', () => {
  const m = window.L.map(box('t-track2'), { zoomControl: false, attributionControl: false }).setView(P(2, 1), 15);
  const routes = { r1: { short: 'CEN', color: '#FF9900' } }, shapes = { r1: [ell()] };
  const s = prepareShape(shapes.r1)[0], corner = s.cum[1], pos = (x) => pointAt(s.line, s.cum, x);
  const bus = (p, ts) => ({ vehicle: { id: 8 }, trip: { route_id: 'r1' }, position: { latitude: p[0], longitude: p[1] }, timestamp: ts });
  const layer = manualLayer(m);
  layer.draw([bus(pos(corner - 60), 1000)], { routes, shapes, nowS: 1000 });
  layer.draw([bus(pos(corner + 60), 1010)], { routes, shapes, nowS: 1010 });
  layer.step(GLIDE_MS / 2);
  near(distM(layer.shown(8), P(3, 0)), 0, 2, 'half way through a 120 m move it is at the corner (constant speed along the street)');
  layer.step(GLIDE_MS);
  near(distM(layer.shown(8), pos(corner + 60)), 0, 1);
  const r = manualLayer(m, true);
  r.draw([{ ...bus(pos(100), 1000), vehicle: { id: 9 } }], { routes, shapes, nowS: 1000 });
  r.draw([{ ...bus(pos(300), 1010), vehicle: { id: 9 } }], { routes, shapes, nowS: 1010 });
  near(distM(r.shown(9), pos(300)), 0, 1, 'reduced motion: there at once');
  eq(r.step(16), 0, 'and no frames are scheduled');
  m.remove();
});

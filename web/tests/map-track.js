/** Tests for map/track.js (buses stay on their route line) and the bus layer's movement along it (needs Leaflet). */
import { test, eq, ok, near } from './lib.js';
import { prepareShape, pointAt, walk, locate, follow, headingAt, advance, ON_M } from '../js/map/track.js';
import { createBusLayer, moveTiming, nextWakeMs, GLIDE_MS, MISSING_S, STEP_PX, TURN_M } from '../js/map/layers.js';
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

/** A bus layer with a manual clock and frame queue: step(ms) advances time and runs one frame. Its sleeps (opt.later) end
    at once, so every step looks at the badges; wakes() lists the sleeps asked for (ms). */
function manualLayer(m, reduce = false) {
  let T = 0, queue = [];
  const wakes = [];
  const layer = createBusLayer(m, { onBusTap: () => {} }, { clock: () => T, frame: (fn) => { queue.push(fn); return queue.length; },
    later: (fn, ms) => { wakes.push(ms); fn(); return wakes.length; }, cancel: () => {}, reduce: () => reduce });
  layer.step = (ms) => { T += ms; const q = queue; queue = []; q.forEach((f) => f()); return q.length; };
  layer.wakes = wakes;
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

test('bus layer: slow glides are drawn in shared frames, once the fastest badge has moved a pixel (fewer glass redraws)', () => {
  const m = window.L.map(box('t-track-batch'), { zoomControl: false, attributionControl: false }).setView(P(2, 1), 15);
  const routes = { r1: { short: 'CEN', color: '#FF9900' }, r2: { short: 'RED', color: '#C8102E' } }, shapes = { r1: [ell()], r2: [ell()] };
  const s = prepareShape(shapes.r1)[0], pos = (x) => pointAt(s.line, s.cum, x);
  const bus = (id, rid, x, ts) => ({ vehicle: { id }, trip: { route_id: rid }, position: { latitude: pos(x)[0], longitude: pos(x)[1] }, timestamp: ts });
  const layer = manualLayer(m);
  layer.draw([bus(1, 'r1', 100, 1000), bus(2, 'r2', 300, 1000)], { routes, shapes, nowS: 1000 });
  layer.draw([bus(1, 'r1', 220, 1010), bus(2, 'r2', 330, 1010)], { routes, shapes, nowS: 1010 });   // 120 m and 30 m in one poll
  const px = (id) => m.project(layer.shown(id));   // screen px, not rounded
  let frames = 0, drawn = 0, prev = [px(1), px(2)];
  const fastPx = 120 / (40075016.686 * Math.cos(pos(160)[0] * Math.PI / 180) / 2 ** (15 + 8));
  for (let i = 0; i < 2000 && layer.step(16); i++) {
    frames++;
    const now = [px(1), px(2)], moved = now.map((q, k) => q.distanceTo(prev[k]) > 1e-9);
    if (moved[0] || moved[1]) drawn++;
    ok(!moved[1] || moved[0], 'the slow badge never moves in a frame of its own');
    if (moved[0]) ok(now[0].distanceTo(prev[0]) < STEP_PX + 0.5, 'and the fast one moves about a pixel per drawn frame');
    prev = now;
  }
  ok(frames > 500, `the glide still runs every frame (${frames} frames)`);
  ok(drawn <= Math.ceil(fastPx / STEP_PX) + 2 && drawn >= Math.floor(fastPx / STEP_PX) - 2, `${drawn} drawn frames for a ${fastPx.toFixed(1)} px move`);
  near(distM(layer.shown(1), pos(220)), 0, 1, 'both end exactly at their reports');
  near(distM(layer.shown(2), pos(330)), 0, 1);
  m.remove();
});

test('bus layer: between looks the glide sleeps until a badge can next need drawing, not every display frame', () => {
  const glide = { t0: 0, dur: GLIDE_MS, total: 90, ease: false, along: false, f: 0 };   // 90 m in 9 s: 10 m/s
  near(nextWakeMs([glide], 0, 3.5), 350, 1, 'zoom 15 (3.5 m a px): the next pixel in 350 ms');
  near(nextWakeMs([{ ...glide, along: true, f: 50 }], 0, 30), TURN_M * 100, 1, 'along a line: also every TURN_M meters (the notch may turn)');
  near(nextWakeMs([glide], 0, 0.3), 30, 1, 'zoomed in (0.3 m a px): about every other frame');
  eq(nextWakeMs([glide, { ...glide, t0: -9000 }], 0, 3.5), 0, 'an animation due to end: at once');
  near(nextWakeMs([glide], GLIDE_MS - 100, 3.5), 100, 1, 'never past the end of a move');
  eq(nextWakeMs([{ ...glide, total: 0.2 }], 0, 30), 1000, 'a crawl sleeps at most a second');
  near(nextWakeMs([{ ...glide, ease: true }], 0, 3.5), 175, 1, 'an eased catch-up uses its peak speed (twice the average)');
  const m = window.L.map(box('t-track-wake'), { zoomControl: false, attributionControl: false }).setView(P(2, 1), 15);
  const routes = { r1: { short: 'CEN', color: '#FF9900' } }, shapes = { r1: [ell()] };
  const s = prepareShape(shapes.r1)[0], pos = (x) => pointAt(s.line, s.cum, x);
  const bus = (x, ts) => ({ vehicle: { id: 4 }, trip: { route_id: 'r1' }, position: { latitude: pos(x)[0], longitude: pos(x)[1] }, timestamp: ts });
  const layer = manualLayer(m);
  layer.draw([bus(100, 1000)], { routes, shapes, nowS: 1000 });
  layer.draw([bus(190, 1010)], { routes, shapes, nowS: 1010 });
  for (let i = 0; i < 20; i++) layer.step(16);
  ok(layer.wakes.length >= 10 && layer.wakes.every((w) => w > 200), 'a normal glide asks to sleep 200+ ms between looks: ' + layer.wakes.slice(0, 5).map(Math.round));
  m.remove();
});

test('bus layer: zoomed out, the heading notch still turns at a corner while the badge moves under a pixel a frame', () => {
  const m = window.L.map(box('t-track-turn'), { zoomControl: false, attributionControl: false }).setView(P(2, 1), 12);
  const routes = { r1: { short: 'CEN', color: '#FF9900' } }, shapes = { r1: [ell()] };
  const s = prepareShape(shapes.r1)[0], corner = s.cum[1], pos = (x) => pointAt(s.line, s.cum, x);
  const bus = (x, ts) => ({ vehicle: { id: 3 }, trip: { route_id: 'r1' }, position: { latitude: pos(x)[0], longitude: pos(x)[1] }, timestamp: ts });
  const layer = manualLayer(m);
  layer.draw([bus(corner - 60, 1000)], { routes, shapes, nowS: 1000 });
  layer.draw([bus(corner + 60, 1010)], { routes, shapes, nowS: 1010 });   // 120 m in 9 s: about 4 px at zoom 12
  const deg = () => { const t = m.getContainer().querySelector('.sb-bus-hd').style.transform; const d = parseFloat((/rotate\((-?[\d.]+)deg\)/.exec(t) || [])[1]); return ((d % 360) + 360) % 360; };
  let ms = 0;
  while (ms < GLIDE_MS / 2 + 400) { layer.step(16); ms += 16; }   // 400 ms past the corner
  ok(deg() < 15 || deg() > 345, 'heading north (0) soon after the corner: ' + deg());
  m.remove();
});

test('bus layer: a bus missing from a poll keeps its badge for MISSING_S, then continues along the line; no bus at all clears', () => {
  const m = window.L.map(box('t-track3'), { zoomControl: false, attributionControl: false }).setView(P(2, 1), 15);
  const routes = { r1: { short: 'CEN', color: '#FF9900' } }, shapes = { r1: [ell()] };
  const s = prepareShape(shapes.r1)[0], corner = s.cum[1], pos = (x) => pointAt(s.line, s.cum, x);
  const bus = (p, ts, id = 5) => ({ vehicle: { id }, trip: { route_id: 'r1' }, position: { latitude: p[0], longitude: p[1] }, timestamp: ts });
  const other = (ts) => bus(pos(50), ts, 6);
  const layer = manualLayer(m);
  const count = () => m.getContainer().querySelectorAll('.sb-bus').length;
  layer.draw([bus(pos(corner - 100), 1000), other(1000)], { routes, shapes, nowS: 1000 });
  const el = layer.shown(5) && [...m.getContainer().querySelectorAll('.sb-bus')];
  layer.draw([other(1010)], { routes, shapes, nowS: 1010 });
  eq(count(), 2, 'one poll without it (others still report): the badge stays');
  layer.draw([bus(pos(corner + 150), 1040), other(1040)], { routes, shapes, nowS: 1040 });
  ok([...m.getContainer().querySelectorAll('.sb-bus')].every((x) => el.includes(x)), 'the same badges continue');
  for (let i = 0; i < 300 && layer.step(16); i++) ok(offLine(ell(), layer.shown(5)) < 2, 'along the line, round the corner');
  near(distM(layer.shown(5), pos(corner + 150)), 0, 1);
  layer.draw([other(1050)], { routes, shapes, nowS: 1050 });
  layer.draw([other(1050 + MISSING_S + 1)], { routes, shapes, nowS: 1050 + MISSING_S + 1 });
  eq(count(), 1, 'gone for longer than MISSING_S: removed');
  layer.draw([], { routes, shapes, nowS: 1100 });
  eq(count(), 0, 'no bus at all in the poll: the map agrees with the pill at once');
  layer.draw([bus(pos(100), 2000)], { routes, shapes, nowS: 2000 });
  layer.draw([bus(pos(100), 2000)], { routes, shapes, hidden: ['r1'], nowS: 2001 });
  eq(count(), 0, 'a route the rider hides goes at once');
  m.remove();
});

/** Tests for map/geometry.js (alongShape and helpers). */
import { test, eq, ok, near } from './lib.js';
import { alongShape, distM, pathLength, normLatLngs, toLatLng } from '../js/map/geometry.js';
import { P, squareLoop, outAndBack, stop } from './map-fixtures.js';

const has = (path, pt, tol = 3) => path.some((q) => distM(q, pt) < tol);
const U_M = distM(P(0), P(1)); // meters per grid unit along x (longitude)
const V_M = distM(P(0, 0), P(0, 1)); // meters per grid unit along y (latitude)

test('geometry: toLatLng / normLatLngs accept arrays and {lat,lon}', () => {
  eq(toLatLng([1, 2]), [1, 2]);
  eq(toLatLng({ lat: 1, lon: 2 }), [1, 2]);
  eq(toLatLng({ lat: 1, lng: 2 }), [1, 2]);
  eq(toLatLng({ lat: 'x', lon: 2 }), null);
  eq(normLatLngs([[1, 2], null, { lat: 3, lon: 4 }]), [[1, 2], [3, 4]]);
});

test('geometry: distM / pathLength', () => {
  near(distM([41.79, -87.6], [41.8, -87.6]), 1112, 3);
  near(pathLength([P(0), P(1), P(2)]), 2 * U_M, 0.5);
});

test('alongShape: loop forward ride follows the shape', () => {
  const seq = ['A', 'B', 'C', 'D', 'A'];
  const out = alongShape([squareLoop()], seq, stop('A', 0, 0), stop('C', 4, 4), []);
  ok(has(out, P(4, 0)), 'passes corner B');
  ok(!has(out, P(0, 4)), 'does not pass corner D');
  near(pathLength(out), 4 * U_M + 4 * V_M, 5);
});

test('alongShape: loop wraps through the start', () => {
  const seq = ['A', 'B', 'C', 'D', 'A'];
  const out = alongShape([squareLoop()], seq, stop('C', 4, 4), stop('B', 4, 0), []);
  ok(has(out, P(0, 4)), 'passes D');
  ok(has(out, P(0, 0)), 'passes A (wrap)');
  near(pathLength(out), 8 * U_M + 4 * V_M, 5, 'three sides (C-D-A-B)');
  eq(out[0], P(4, 4), 'starts at board stop');
  eq(out[out.length - 1], P(4, 0), 'ends at alight stop');
});

test('alongShape: loop whose shape is not closed at the seam still wraps', () => {
  const shp = squareLoop().slice(0, -1); // ends one unit before A
  const out = alongShape([shp], ['A', 'B', 'C', 'D', 'A'], stop('D', 0, 4), stop('B', 4, 0), []);
  ok(has(out, P(4, 0)) && has(out, P(0, 1)), 'goes D -> A -> B');
  ok(!has(out, P(4, 4)), 'never via C');
});

test('alongShape: out-and-back picks the return pass by stop sequence', () => {
  // outbound O1(1) O2(2) turn T(6), return R2(2) R1(1): R2/O2 share a location, as do R1/O1
  const seq = ['O1', 'O2', 'T', 'R2', 'R1'];
  const shp = outAndBack();
  const ret = alongShape([shp], seq, stop('R2', 2), stop('R1', 1), []);
  near(pathLength(ret), U_M, 5, 'return ride is one unit, not via the turnaround');
  const out = alongShape([shp], seq, stop('O2', 2), stop('R2', 2), []);
  near(pathLength(out), 8 * U_M, 5, 'O2 -> R2 goes out to the turnaround and back');
  ok(has(out, P(6)), 'reaches turnaround');
  const fwd = alongShape([shp], seq, stop('O1', 1), stop('T', 6), []);
  near(pathLength(fwd), 5 * U_M, 5);
});

test('alongShape: a stop id served in both directions uses the nearest forward pair', () => {
  const seq = ['S', 'M', 'T', 'M', 'E']; // M at x=2 on both passes
  const shp = outAndBack();
  near(pathLength(alongShape([shp], seq, stop('T', 6), stop('M', 2), [])), 4 * U_M, 5, 'T -> M (return pass)');
  near(pathLength(alongShape([shp], seq, stop('M', 2), stop('T', 6), [])), 4 * U_M, 5, 'M -> T (outbound pass)');
  near(pathLength(alongShape([shp], seq, stop('M', 2), stop('E', 0), [])), 2 * U_M, 5, 'M -> E uses the second M');
});

test('alongShape: chooses the matching shape line among several', () => {
  const far = [P(0, 30), P(10, 30)];
  const out = alongShape([far, squareLoop()], ['A', 'B', 'C', 'D', 'A'], stop('A', 0, 0), stop('B', 4, 0), []);
  near(pathLength(out), 4 * U_M, 5);
});

test('alongShape: fallbacks', () => {
  const fb = [{ lat: P(0)[0], lon: P(0)[1] }, { lat: P(3)[0], lon: P(3)[1] }];
  const fbN = normLatLngs(fb);
  eq(alongShape([], ['A', 'B'], stop('A', 0), stop('B', 3), fb), fbN, 'no shape');
  eq(alongShape(undefined, undefined, stop('A', 0), stop('B', 3), fb), fbN, 'undefined inputs');
  eq(alongShape([[P(0, 40), P(5, 40)]], ['A', 'B'], stop('A', 0), stop('B', 3), fb), fbN, 'stops far from shape');
  // open (non-loop) line driven one way: riding "backwards" is impossible
  const open = [P(0), P(1), P(2), P(3), P(4), P(5), P(6)];
  eq(alongShape([open], ['A', 'B'], stop('B', 5), stop('A', 1), fb), fbN, 'backwards on open line');
  eq(alongShape([open], ['A', 'B'], stop('A', 1), stop('B', 5), null), [P(1), P(2), P(3), P(4), P(5)], 'forward on open line');
  const straight = alongShape([], [], stop('A', 0), stop('B', 1), null);
  eq(straight, [P(0), P(1)], 'no fallback -> straight board/alight');
  eq(alongShape([open], [], null, stop('B', 1), fb), fbN, 'bad board');
});

test('alongShape: projects onto segments (stop between vertices)', () => {
  const line = [P(0), P(10)];
  const out = alongShape([line], ['A', 'B'], stop('A', 2.5, 0.1), stop('B', 7.5, -0.1), []);
  eq(out.length, 4, 'board, projected board, projected alight, alight');
  near(distM(out[1], P(2.5)), 0, 1);
  near(distM(out[2], P(7.5)), 0, 1);
});

test('alongShape: a wrong pass is replaced by the shortest plausible one', () => {
  // two-stop sequence on an out-and-back street: the index expectation puts the alight on the return
  // pass (9 units), but the 1-unit ride on the outbound pass is the plausible one
  const out = alongShape([outAndBack()], ['A', 'B'], stop('A', 1.5), stop('B', 2.5), [P(1.5), P(2.5)]);
  near(pathLength(out), U_M, 5, 'one unit, outbound');
  ok(has(out, P(2)), 'follows the shape vertex between the stops');
});

test('alongShape: a real detour between close stops keeps the shape (never a straight line)', () => {
  // up 10, across 1, down 10: stops 1 unit apart, 18 units of street between them, one pass each
  const u = [P(0, 0), P(0, 10), P(1, 10), P(1, 0)];
  const out = alongShape([u], ['A', 'B'], stop('A', 0, 1), stop('B', 1, 1), [P(0, 1), P(1, 1)]);
  ok(has(out, P(0, 10)) && has(out, P(1, 10)), 'drives around the top');
  near(pathLength(out), 18 * V_M + U_M, 5);
});

test('alongShape: real data (adjacent stops follow the road, never absurdly long)', async () => {
  const get = (f) => fetch('../data/' + f).then((r) => r.json());
  const [shapes, routeStops, stops] = await Promise.all([get('shapes.json'), get('route_stops.json'), get('stops.json')]);
  let n = 0, good = 0;
  for (const [rid, seq] of Object.entries(routeStops)) {
    for (let i = 0; i + 1 < seq.length; i++) {
      const a = stops[seq[i]], b = stops[seq[i + 1]];
      if (!a || !b || seq[i] === seq[i + 1]) continue;
      const board = { id: seq[i], ...a }, alight = { id: seq[i + 1], ...b };
      const fb = [[a.lat, a.lon], [b.lat, b.lon]];
      const out = alongShape(shapes[rid], seq, board, alight, fb);
      n++;
      ok(out.length >= 2, rid + ' ' + i + ' empty');
      const straight = distM(fb[0], fb[1]);
      if (out.length > 2 && pathLength(out) < 3 * straight + 400) good++;
    }
  }
  ok(n > 50, 'enough pairs: ' + n);
  ok(good / n > 0.85, `road-following for ${good}/${n} adjacent pairs`);
});

test('alongShape: real data (every forward stop pair follows the shape, none straight)', async () => {
  const get = (f) => fetch('../data/' + f).then((r) => r.json());
  const [shapes, routeStops, stops] = await Promise.all([get('shapes.json'), get('route_stops.json'), get('stops.json')]);
  let n = 0;
  const straight = [];
  for (const [rid, raw] of Object.entries(routeStops)) {
    if (!shapes[rid]) continue;
    const loop = raw.length > 2 && raw[0] === raw[raw.length - 1];
    const seq = (loop ? raw.slice(0, -1) : raw).filter((id) => stops[id]);
    for (let i = 0; i < seq.length; i++) {
      for (let j = 0; j < seq.length; j++) {
        if (i === j || (!loop && j < i)) continue;
        const ids = [];
        for (let k = i; ; k = loop ? (k + 1) % seq.length : k + 1) { ids.push(seq[k]); if (k === j) break; }
        const fb = ids.map((id) => [stops[id].lat, stops[id].lon]);
        const out = alongShape(shapes[rid], raw, { id: seq[i], ...stops[seq[i]] }, { id: seq[j], ...stops[seq[j]] }, fb);
        n++;
        if (out.length === fb.length && out.every((p, q) => p[0] === fb[q][0] && p[1] === fb[q][1])) straight.push(rid + ' ' + seq[i] + '>' + seq[j]);
      }
    }
  }
  ok(n > 500, 'enough pairs: ' + n);
  eq(straight, [], 'stop pairs drawn as straight stop-to-stop lines');
});

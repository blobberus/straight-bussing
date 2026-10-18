/**
 * map/track.js: keeps live bus badges on the line they drive (owner 2026-10-18: "the bus location should update
 * smoothly without exiting the borders of the roads and the station lines they follow", especially after a reload
 * or when bus data comes back after a gap). Pure (no DOM, no Leaflet): map/layers.js createBusLayer animates what
 * follow() returns. Tests: web/tests/map-track.js. iOS: Kit BusTrack.swift (same rules and numbers).
 *
 * A report within ON_M of its route's shape (the colored line on the map, drawn on the streets) is shown ON the line:
 * the GPS fix projected onto it. A move along the line is drawn through the line's own points, so the badge turns
 * the corner with the street instead of cutting across a block, after a long gap too. Which pass of the line: a
 * street driven out and back, or a loop, passes one point several times, so the pass that continues from where the
 * badge is now wins, within what a bus can drive since its last report (SPEED_MPS); a short step back (GPS jitter,
 * BACK_M) stays on the line. A badge that is not on the line yet takes the closest pass, the one heading the way the
 * feed says when two are about as close. A report off the line (a detour, the garage) is shown where it is.
 */
import { distM, cumulativeM, passesNear } from './geometry.js';
import { bearing as geoBearing } from '../core/geo.js';

/** A fix this close to the line is on it (GPS error plus the street's width). */
export const ON_M = 40;
/** A step back along the line up to this long is GPS jitter: drawn along the line. */
export const BACK_M = 30;
/** Fastest a shuttle drives (about 50 mph), for "could it have driven that far since its last report". */
export const SPEED_MPS = 22;
/** Extra distance allowed on top of SPEED_MPS x the time between reports. */
export const SLACK_M = 400;
/** Lines whose ends are this close are loops (a bus continues through the start). */
const CLOSED_M = 80;

const prepared = new WeakMap();

function cleanLine(raw) {
  const out = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const lat = Array.isArray(p) ? +p[0] : +p?.lat, lon = Array.isArray(p) ? +p[1] : +(p?.lon ?? p?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - lat) > 1e-7 || Math.abs(q[1] - lon) > 1e-7) out.push([lat, lon]);
  }
  return out;
}

/**
 * A route's shape lines ready for tracking (cached per shapes[rid] array).
 * @param {Array<Array<[number, number]>>} lines shapes[rid]
 * @returns {Array<{line:Array<[number,number]>, cum:number[], L:number, closed:boolean}>}
 */
export function prepareShape(lines) {
  if (!Array.isArray(lines)) return [];
  const hit = prepared.get(lines);
  if (hit) return hit;
  const out = [];
  for (const raw of lines) {
    const line = cleanLine(raw);
    if (line.length < 2) continue;
    const cum = cumulativeM(line), L = cum[cum.length - 1];
    if (L > 0) out.push({ line, cum, L, closed: distM(line[0], line[line.length - 1]) < CLOSED_M });
  }
  prepared.set(lines, out);
  return out;
}

/**
 * Point at a distance along a line (clamped to its ends).
 * @param {Array<[number,number]>} line
 * @param {number[]} cum
 * @param {number} pos meters
 * @returns {[number, number]}
 */
export function pointAt(line, cum, pos) {
  const L = cum[cum.length - 1];
  if (!(pos > 0)) return line[0].slice();
  if (pos >= L) return line[line.length - 1].slice();
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= pos) lo = mid; else hi = mid; }
  const a = line[lo], b = line[hi], seg = cum[hi] - cum[lo], t = seg > 0 ? (pos - cum[lo]) / seg : 0;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

/**
 * The line's points from `pos0`, `f` meters along it (f < 0: backwards), through the start on loops.
 * @param {{line, cum, L, closed}} s
 * @param {number} pos0
 * @param {number} f
 * @returns {Array<[number, number]>}
 */
export function walk(s, pos0, f) {
  const { line, cum, L, closed } = s, out = [pointAt(line, cum, pos0)];
  if (f >= 0) {
    const end = closed ? pos0 + f : Math.min(L, pos0 + f);
    let base = 0, from = pos0;
    for (let lap = 0; lap < 3 && from < end; lap++) {
      for (let i = 0; i < line.length; i++) {
        const at = base + cum[i];
        if (at > from && at < end) out.push(line[i].slice());
      }
      from = base + L;
      base += L;
    }
    out.push(pointAt(line, cum, closed ? ((end % L) + L) % L : end));
  } else {
    const end = Math.max(0, pos0 + f);
    for (let i = line.length - 1; i >= 0; i--) if (cum[i] < pos0 && cum[i] > end) out.push(line[i].slice());
    out.push(pointAt(line, cum, end));
  }
  return dropRepeats(out);
}

function dropRepeats(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push(p);
  }
  return out;
}

/** Direction of travel (deg) of a line at a position. */
export function headingAt(s, pos) {
  const a = pointAt(s.line, s.cum, Math.max(0, pos - 8)), b = pointAt(s.line, s.cum, Math.min(s.L, pos + 8));
  return distM(a, b) > 1 ? geoBearing({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }) : NaN;
}

/**
 * Every pass of the route's lines within ON_M of a fix.
 * @param {ReturnType<typeof prepareShape>} prep
 * @param {[number, number]} pt
 * @returns {Array<{li:number, d:number, pos:number, pt:[number,number]}>}
 */
export function locate(prep, pt) {
  const out = [];
  (prep || []).forEach((s, li) => {
    for (const c of passesNear(s.line, s.cum, pt).cands) if (c.d <= ON_M) out.push({ li, d: c.d, pos: c.pos, pt: c.pt });
  });
  return out;
}

const angleOff = (a, b) => { const d = Math.abs((((a - b) % 360) + 540) % 360 - 180); return d; };

/**
 * Where a new report goes and the way there.
 * @param {ReturnType<typeof prepareShape>} prep the route's lines ([] = none known)
 * @param {{li:number, pos:number}|null} from where the badge is on the line now (null: not on it)
 * @param {[number, number]} at where the badge is drawn now (null for a new badge)
 * @param {[number, number]} pt the new fix
 * @param {{bearing?:number, dt?:number}} [o] the feed's heading (deg, NaN if none); seconds since the last report
 * @returns {{to:{li:number, pos:number, pt:[number,number]}|null, path:Array<[number,number]>, along:boolean, f:number}}
 *   to: the new place on the line (null: off the line, drawn at pt); path: from `at` to the new place, through the
 *   line's points when along; f: meters moved along the line (signed; 0 when not along)
 */
export function follow(prep, from, at, pt, o = {}) {
  const cands = locate(prep, pt);
  const start = at || pt;
  if (!cands.length) return { to: null, path: dropRepeats([start, pt]), along: false, f: 0 };
  if (from && prep[from.li]) {
    const s = prep[from.li];
    const dt = Number.isFinite(o.dt) ? Math.min(1800, Math.max(10, o.dt)) : 10;
    const ahead = SPEED_MPS * dt + SLACK_M;
    let best = null;
    for (const c of cands) {
      if (c.li !== from.li) continue;
      let f = c.pos - from.pos;
      if (s.closed && f < -BACK_M) f += s.L;                     // a loop: forward through the start
      if (f < -BACK_M || f > ahead) continue;
      const score = c.d + 0.1 * Math.abs(f);
      if (!best || score < best.score) best = { c, f, score };
    }
    if (best) {
      return { to: { li: best.c.li, pos: best.c.pos, pt: best.c.pt }, path: walk(s, from.pos, best.f), along: true, f: best.f };
    }
  }
  const brg = Number.isFinite(o.bearing) ? o.bearing : NaN;
  let pick = null;
  for (const c of cands) {
    let score = c.d;
    if (Number.isFinite(brg)) {
      const h = headingAt(prep[c.li], c.pos);
      if (Number.isFinite(h) && angleOff(h, brg) > 90) score += 25;   // that pass runs the other way
    }
    if (!pick || score < pick.score) pick = { c, score };
  }
  return { to: { li: pick.c.li, pos: pick.c.pos, pt: pick.c.pt }, path: dropRepeats([start, pick.c.pt]), along: false, f: 0 };
}

/**
 * Cumulative lengths of a path (for animating along it).
 * @param {Array<[number,number]>} path
 * @returns {number[]}
 */
export function pathCum(path) {
  return cumulativeM(path);
}

/**
 * Position along a line after moving f meters from pos (wrapping on loops, clamped on open lines).
 * @param {{L:number, closed:boolean}} s
 * @param {number} pos
 * @param {number} f
 * @returns {number}
 */
export function advance(s, pos, f) {
  const p = pos + f;
  return s.closed ? ((p % s.L) + s.L) % s.L : Math.max(0, Math.min(s.L, p));
}

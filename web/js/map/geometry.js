/**
 * map/geometry.js: pure geometry helpers for the map layer (no DOM, no Leaflet). Unit-tested in
 * web/tests/map.test.html. Polylines are [[lat, lon], ...]; points may be [lat, lon] or {lat, lon}.
 */

const R = 6371000;
const RAD = Math.PI / 180;
/** Stops farther than this from every shape line are not on the shape: use the fallback. */
const MAX_OFF_M = 200;
/** Shapes whose ends are this close are treated as closed loops. */
const CLOSED_M = 80;

/**
 * Normalize one point to [lat, lon] numbers, or null if invalid.
 * @param {[number, number]|{lat:number, lon:number}} p
 * @returns {[number, number]|null}
 */
export function toLatLng(p) {
  if (!p) return null;
  const lat = Array.isArray(p) ? +p[0] : +p.lat;
  const lon = Array.isArray(p) ? +p[1] : +(p.lon ?? p.lng);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

/**
 * Normalize a list of points to [[lat, lon], ...], dropping invalid ones.
 * @param {Array} list
 * @returns {Array<[number, number]>}
 */
export function normLatLngs(list) {
  const out = [];
  for (const p of list || []) { const q = toLatLng(p); if (q) out.push(q); }
  return out;
}

/**
 * Great-circle distance in meters between two points.
 * @param {[number, number]|{lat, lon}} a
 * @param {[number, number]|{lat, lon}} b
 * @returns {number}
 */
export function distM(a, b) {
  const p = toLatLng(a), q = toLatLng(b);
  if (!p || !q) return Infinity;
  const dLa = (q[0] - p[0]) * RAD, dLo = (q[1] - p[1]) * RAD;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(p[0] * RAD) * Math.cos(q[0] * RAD) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/**
 * Total length of a polyline in meters.
 * @param {Array<[number, number]>} line
 * @returns {number}
 */
export function pathLength(line) {
  let s = 0;
  for (let i = 1; i < (line || []).length; i++) s += distM(line[i - 1], line[i]);
  return s;
}

/** Cumulative distance at each vertex. */
function cumulative(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + distM(line[i - 1], line[i]));
  return cum;
}

/** Closest point on segment a-b to p (local equirectangular frame around p). */
function projSeg(p, a, b) {
  const k = Math.cos(p[0] * RAD) * RAD * R, m = RAD * R;
  const ax = (a[1] - p[1]) * k, ay = (a[0] - p[0]) * m, bx = (b[1] - p[1]) * k, by = (b[0] - p[0]) * m;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
  const x = ax + t * dx, y = ay + t * dy;
  return { t, d: Math.hypot(x, y) };
}

/**
 * Every distinct pass of the line near p: one candidate per run of consecutive segments within
 * max(60 m, best + 25 m). An out-and-back route yields two candidates for a stop on the shared street.
 * @returns {{best:number, cands:Array<{seg:number, t:number, d:number, pos:number, pt:[number,number]}>}}
 */
function candidates(line, cum, p) {
  const segs = [];
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const s = projSeg(p, line[i], line[i + 1]);
    segs.push(s);
    if (s.d < best) best = s.d;
  }
  const thr = Math.max(60, best + 25), cands = [];
  let run = null;
  segs.forEach((s, i) => {
    if (s.d > thr) { run = null; return; }
    if (!run || s.d < run.d) {
      const a = line[i], b = line[i + 1];
      const c = { seg: i, t: s.t, d: s.d, pos: cum[i] + s.t * (cum[i + 1] - cum[i]),
        pt: [a[0] + s.t * (b[0] - a[0]), a[1] + s.t * (b[1] - a[1])] };
      if (!run) cands.push(c); else cands[cands.length - 1] = c;
      run = c;
    }
  });
  return { best, cands };
}

/** Index pair (board, alight) in the stop sequence with the shortest forward gap (wrapping on loops). */
function seqIndices(seq, boardId, alightId, loop) {
  const n = seq.length;
  let best = null;
  for (let i = 0; i < n; i++) {
    if (seq[i] !== boardId) continue;
    for (let k = 1; k < n + (loop ? 0 : -i); k++) {
      const j = loop ? (i + k) % n : i + k;
      if (j >= n) break;
      if (seq[j] === alightId) { if (!best || k < best.gap) best = { ib: i, ia: j, gap: k }; break; }
    }
  }
  return best;
}

/** Pick the candidate nearest an expected along-shape position (circular on closed shapes). */
function nearestTo(cands, expect, L, closed) {
  let best = null, bd = Infinity;
  for (const c of cands) {
    let d = Math.abs(c.pos - expect);
    if (closed) d = Math.min(d, L - d);
    d += c.d * 0.5; // slight preference for the closer pass when expectations tie
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/** Shape slice from candidate a to candidate b, wrapping through the start on closed shapes. */
function slice(line, a, b, closed) {
  if (b.pos > a.pos) return [a.pt, ...line.slice(a.seg + 1, b.seg + 1), b.pt];
  if (!closed) return null;
  const last = line.length - 1;
  const head = distM(line[0], line[last]) < 5 ? line.slice(1, b.seg + 1) : line.slice(0, b.seg + 1);
  return [a.pt, ...line.slice(a.seg + 1), ...head, b.pt];
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-7 || Math.abs(q[1] - p[1]) > 1e-7) out.push(p);
  }
  return out;
}

/**
 * Road-following path for a bus ride: the slice of the route's shape between the boarding and
 * alighting stops. Out-and-back shapes (one street driven both ways) are disambiguated by the stops'
 * positions in the route's stop sequence; loop routes (first stop id == last) wrap through the start.
 * Falls back to `fallbackLatLngs` (normalized) when the stops are not on the shape, the ride would go
 * backwards on a non-loop, or the result is implausibly long; with no usable fallback, a straight
 * board-alight line.
 * @param {Array<Array<[number, number]>>} shapeLines shapes[rid]
 * @param {string[]} routeStopsList routeStops[rid]
 * @param {{id:string, lat:number, lon:number}} board
 * @param {{id:string, lat:number, lon:number}} alight
 * @param {Array<[number, number]|{lat:number, lon:number}>} [fallbackLatLngs]
 * @returns {Array<[number, number]>}
 */
export function alongShape(shapeLines, routeStopsList, board, alight, fallbackLatLngs) {
  const b0 = toLatLng(board), a0 = toLatLng(alight);
  let fb = normLatLngs(fallbackLatLngs);
  const realFb = fb.length >= 2;
  if (!realFb) fb = b0 && a0 ? [b0, a0] : fb;
  try {
    if (!b0 || !a0 || !Array.isArray(shapeLines)) return fb;
    // pick the shape line that passes closest to both stops (longest wins ties)
    let pick = null;
    for (const raw of shapeLines) {
      const line = normLatLngs(raw);
      if (line.length < 2) continue;
      const cum = cumulative(line);
      const cb = candidates(line, cum, b0), ca = candidates(line, cum, a0);
      const score = cb.best + ca.best;
      if (!pick || score < pick.score - 1 || (Math.abs(score - pick.score) <= 1 && line.length > pick.line.length)) {
        pick = { line, cum, cb, ca, score };
      }
    }
    if (!pick || pick.cb.best > MAX_OFF_M || pick.ca.best > MAX_OFF_M) return fb;
    const { line, cum, cb, ca } = pick;
    const L = cum[cum.length - 1];
    if (L <= 0) return fb;

    const seq = (routeStopsList || []).slice();
    const loop = seq.length > 2 && seq[0] === seq[seq.length - 1];
    if (loop) seq.pop();
    const closed = loop || distM(line[0], line[line.length - 1]) < CLOSED_M;
    const idx = board.id != null && alight.id != null ? seqIndices(seq, board.id, alight.id, loop) : null;

    let cB, cA;
    if (idx) {
      const span = loop ? seq.length : Math.max(1, seq.length - 1);
      // expectations are circular only for loop routes; an out-and-back shape may be geometrically
      // closed but its stop order is linear
      cB = nearestTo(cb.cands, (idx.ib / span) * L, L, loop);
      const ahead = ca.cands.filter((c) => c.pos > cB.pos);
      const pool = loop ? ca.cands : ahead.length ? ahead : closed ? ca.cands : [];
      cA = nearestTo(pool, (idx.ia / span) * L, L, loop);
    } else {
      // unknown sequence: closest pass for boarding, then the first pass ahead of it
      cB = cb.cands.reduce((m, c) => (c.d < m.d ? c : m), cb.cands[0]);
      const ahead = ca.cands.filter((c) => c.pos > cB.pos).sort((x, y) => x.pos - y.pos);
      cA = ahead[0] || (closed ? ca.cands.reduce((m, c) => (c.d < m.d ? c : m), ca.cands[0]) : null);
    }
    if (!cB || !cA) return fb;
    const seg = slice(line, cB, cA, closed);
    if (!seg) return fb;
    const out = dedupe([b0, ...seg, a0]);
    if (out.length < 2) return fb;
    // sanity: a wildly longer path than the stop-to-stop fallback means we picked the wrong pass
    if (realFb) {
      const fl = pathLength(fb);
      if (fl > 0 && pathLength(out) > 2.5 * fl + 500) return fb;
    }
    return out;
  } catch (e) {
    return fb;
  }
}

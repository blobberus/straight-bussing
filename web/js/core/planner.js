/**
 * @module core/planner
 * Trip planner: walk + one direct shuttle, or walk + shuttle + short transfer walk + shuttle.
 * Pure logic, no DOM. Every number it produces is an ESTIMATE.
 *
 * Rules (ported from v1, walking always counted):
 *  - walking 80 m/min on straight line x 1.2 (same model as walkOnly and core/walk's estimate);
 *    at most 800 m to the boarding stop and from the alighting stop, widened to 1600 m when no
 *    option exists within 800 m; transfer walk <= 150 m. Every walk costs time, however short;
 *    only walks under 1 m (same point) get no step in the list.
 *  - route_stops lists one representative trip; first == last means a loop that wraps.
 *  - ride time: same-trip live prediction (trip update at alight minus at board), else
 *    predict.rideMinutes, else path distance at 18 km/h.
 *  - wait: next live arrival at the board stop after you WALK there (15 s grace), else headway
 *    estimate = cycle minutes / buses running / 2, clamped to [1, 30]; route skipped if neither.
 *    A transfer's second wait starts after the transfer walk.
 *  - total/arrive = walk + wait + ride (+ transfer walk + wait + ride) + walk to the destination.
 *  - direct trips: per route, the best boarding/alighting pair for EACH ranking criterion (least
 *    walking, earliest arrival, shortest wait) is a candidate; identical pairs are kept once.
 *  - options slower than max(2 x walking, walking + 15 min) are dropped; transfers must beat the
 *    best direct option by 2 min; ranked by core/rank.js (least walking, then earliest arrival,
 *    then shortest wait, then how many of those an option meets); max 4. Options carry `meets`.
 */
import { hav, WALK_M_PER_MIN as WALK_M_MIN, WALK_DETOUR as DETOUR } from "./geo.js";
import { nowS } from "./time.js";
import { pickOptions, walkTotals } from "./rank.js";

const MAX_WALK = 800, MAX_WALK_FAR = 1600, XFER_M = 150, BUS_M_MIN = 18000 / 60;
const MAX_OPTS = 4, MIN_WALK_LEG = 1, GRACE_S = 15, HEADWAY_CAP = 30, XFER_GAIN_MIN = 2;

/** Planner constants (read-only, for UI copy and tests). */
export const PLANNER = Object.freeze({ WALK_M_MIN, DETOUR, MAX_WALK, MAX_WALK_FAR, XFER_M, BUS_KMH: 18, MAX_OPTS, MIN_WALK_LEG, GRACE_S, HEADWAY_CAP });

const okPt = (p) => p && isFinite(p.lat) && isFinite(p.lon);
const walkM = (a, b) => hav(a, b) * DETOUR;

/** Stop sequence of a route; a loop drops its duplicated last stop; stops without coords are skipped. */
function seqOf(list, stops) {
  let ids = (list || []).map(String);
  const loop = ids.length > 2 && ids[0] === ids[ids.length - 1];
  if (loop) ids.pop();
  ids = ids.filter((id) => okPt(stops[id]));
  return { ids, loop: loop && ids.length > 1 };
}

/** Forward index path i -> j inclusive (wrapping on loops) or null. */
function pathIdx(seq, i, j) {
  const n = seq.ids.length;
  if (i === j) return null;
  const out = [i];
  if (seq.loop) {
    for (let k = (i + 1) % n; ; k = (k + 1) % n) {
      out.push(k);
      if (k === j) break;
      if (out.length > n) return null;
    }
  } else {
    if (j < i) return null;
    for (let k = i + 1; k <= j; k++) out.push(k);
  }
  return out;
}

/** Per-plan helpers closed over the data. */
function makeCtx({ data, predict, walkMins }) {
  const D = data || {};
  const stops = D.stops || {};
  const over = walkMins || {};
  const live = new Map(); // "rid|stop" -> [{t, tu}] sorted
  for (const tu of D.trips || []) {
    const rid = tu && tu.trip && tu.trip.route_id != null ? String(tu.trip.route_id) : null;
    if (!rid) continue;
    for (const u of tu.stop_time_update || []) {
      const t = Number((u && u.arrival && u.arrival.time) || (u && u.departure && u.departure.time) || 0);
      if (!t) continue;
      const k = rid + "|" + u.stop_id;
      if (!live.has(k)) live.set(k, []);
      live.get(k).push({ t, tu });
    }
  }
  for (const arr of live.values()) arr.sort((a, b) => a.t - b.t);
  const nBuses = {};
  for (const v of D.buses || []) {
    const r = v && v.trip && v.trip.route_id;
    if (r != null) nBuses[r] = (nBuses[r] || 0) + 1;
  }
  const pt = (id) => ({ id, name: (stops[id] && stops[id].name) || id, lat: stops[id].lat, lon: stops[id].lon });
  const pathM = (seq, path) => {
    let m = 0;
    for (let k = 1; k < path.length; k++) m += hav(stops[seq.ids[path[k - 1]]], stops[seq.ids[path[k]]]);
    return m;
  };
  const cycleMin = (seq) => {
    const n = seq.ids.length;
    const all = [...Array(n).keys()];
    let m = pathM(seq, all);
    if (seq.loop && n > 1) m += hav(stops[seq.ids[n - 1]], stops[seq.ids[0]]);
    return Math.max(5, (seq.loop ? m : 2 * m) / BUS_M_MIN);
  };
  /** Earliest time of `tu` at stopId strictly after `after`. */
  const tripAt = (tu, stopId, after) => {
    let best = null;
    for (const u of tu.stop_time_update || []) {
      if (String(u.stop_id) !== stopId) continue;
      const t = Number((u.arrival && u.arrival.time) || (u.departure && u.departure.time) || 0);
      if (t > after && (best === null || t < best)) best = t;
    }
    return best;
  };
  /** Wait to board rid at stopId when ready at readyT: {min, live, t:boardT, tu} or null. */
  const wait = (rid, seq, stopId, readyT) => {
    const arr = live.get(rid + "|" + stopId);
    if (arr) {
      const L = arr.find((x) => x.t >= readyT - GRACE_S);
      if (L) return { min: Math.max(0, (L.t - readyT) / 60), live: true, t: L.t, tu: L.tu };
    }
    const n = nBuses[rid];
    if (!n) return null;
    const min = Math.min(HEADWAY_CAP, Math.max(1, cycleMin(seq) / n / 2));
    return { min, live: false, t: readyT + min * 60, tu: null };
  };
  const rideCache = new Map();
  /** Ride along path after boarding with w: {min, source, conf, alightT, p10?, p90?}. */
  const ride = (rid, seq, path, w) => {
    const a = seq.ids[path[0]], b = seq.ids[path[path.length - 1]];
    if (w.live && w.tu) {
      const tb = tripAt(w.tu, b, w.t);
      if (tb) return { min: Math.max(1, (tb - w.t) / 60), source: "live", conf: 0.8, alightT: tb };
    }
    const key = rid + "|" + path.join(",");
    let r = rideCache.get(key);
    if (!r) {
      try {
        const p = predict && typeof predict.rideMinutes === "function" ? predict.rideMinutes(rid, a, b, w.t) : null;
        if (p && typeof p.min === "number" && isFinite(p.min) && p.min > 0) {
          r = { min: Math.max(1, p.min), source: p.source === "learned" ? "learned" : "schedule", conf: typeof p.conf === "number" ? p.conf : 0.5 };
          if (isFinite(p.p10) && isFinite(p.p90)) { r.p10 = p.p10; r.p90 = p.p90; }
        }
      } catch (e) { /* fall through to distance */ }
      if (!r) r = { min: Math.max(1, pathM(seq, path) / BUS_M_MIN), source: "estimate", conf: 0.3 };
      rideCache.set(key, r);
    }
    return { ...r, alightT: w.t + r.min * 60 };
  };
  /** Walk candidate {i, m, min} from a point to/from stop index i, with optional router override. */
  const walkTo = (p, id, i, kind, maxM) => {
    const s = stops[id];
    if (!okPt(s)) return null;
    const m = walkM(p, s);
    if (m > maxM) return null;
    const o = over[kind + ":" + id];
    return { i, id, m, min: typeof o === "number" && isFinite(o) && o >= 0 ? o : m / WALK_M_MIN };
  };
  const xferMin = (ida, idb, d) => {
    const o = over["xfer:" + ida + ">" + idb];
    return typeof o === "number" && isFinite(o) && o >= 0 ? o : d / WALK_M_MIN;
  };
  const busLeg = (rid, seq, path, w, r) => {
    const ids = path.map((k) => seq.ids[k]);
    const leg = { type: "bus", rid, board: pt(ids[0]), alight: pt(ids[ids.length - 1]),
      path: ids.map((id) => ({ lat: stops[id].lat, lon: stops[id].lon })), stopsPassed: ids.length - 1,
      wait: w.min, waitLive: w.live, ride: r.min, source: r.source, conf: r.conf, boardT: w.t, alightT: r.alightT,
      tripId: w.tu && w.tu.trip && w.tu.trip.trip_id != null ? String(w.tu.trip.trip_id) : null };
    if (r.p10 != null) { leg.p10 = r.p10; leg.p90 = r.p90; }
    return leg;
  };
  return { stops, pt, wait, ride, walkTo, xferMin, busLeg };
}

function walkLeg(a, b, m, min) {
  return { type: "walk", from: a, to: b, m: Math.round(m), min, source: "estimate" };
}

/** Direct and one-transfer candidates whose end walks are at most maxM meters. */
function candidates(C, seqs, from, to, t0, maxM) {
  const near = {};
  for (const rid of Object.keys(seqs)) {
    const bo = [], al = [];
    seqs[rid].ids.forEach((id, i) => {
      const b = C.walkTo(from, id, i, "start", maxM), a = C.walkTo(to, id, i, "end", maxM);
      if (b) bo.push(b);
      if (a) al.push(a);
    });
    near[rid] = { bo, al };
  }
  const start = { lat: from.lat, lon: from.lon, name: "Start" };
  const dest = { lat: to.lat, lon: to.lon, name: "Destination" };
  // Every walk is already in arr; only same-point walks (< 1 m) get no step.
  const addWalk = (legs, a, b, m, min) => { if (m >= MIN_WALK_LEG) legs.push(walkLeg(a, b, m, min)); };
  const cands = [];

  // Direct: per route, the best (board, alight) pair for each criterion; ties go to the earlier arrival.
  const better = {
    arr: (x, y) => x.arr < y.arr || (x.arr === y.arr && x.wm < y.wm),
    walk: (x, y) => x.wm < y.wm - 1e-9 || (Math.abs(x.wm - y.wm) <= 1e-9 && x.arr < y.arr),
    wait: (x, y) => x.w.min < y.w.min - 1e-9 || (Math.abs(x.w.min - y.w.min) <= 1e-9 && x.arr < y.arr),
  };
  for (const rid of Object.keys(seqs)) {
    const seq = seqs[rid], { bo, al } = near[rid];
    if (!bo.length || !al.length) continue;
    const best = { arr: null, walk: null, wait: null };
    for (const b of bo) {
      const w = C.wait(rid, seq, b.id, t0 + b.min * 60);
      if (!w) continue;
      for (const a of al) {
        const path = pathIdx(seq, b.i, a.i);
        if (!path) continue;
        const r = C.ride(rid, seq, path, w);
        const x = { arr: r.alightT + a.min * 60, wm: b.min + a.min, b, a, path, w, r };
        for (const k in best) if (!best[k] || better[k](x, best[k])) best[k] = x;
      }
    }
    const done = new Set();
    for (const k of ["arr", "walk", "wait"]) {
      const x = best[k], pair = x && x.b.id + ">" + x.a.id;
      if (!x || done.has(pair)) continue;
      done.add(pair);
      const bl = C.busLeg(rid, seq, x.path, x.w, x.r), legs = [];
      addWalk(legs, start, bl.board, x.b.m, x.b.min);
      legs.push(bl);
      addWalk(legs, bl.alight, dest, x.a.m, x.a.min);
      cands.push({ key: k === "arr" ? rid : rid + ":" + pair, legs, arr: x.arr, xfer: false });
    }
  }

  // One transfer: earliest arrival of A at each of its stops, then B from linked stops.
  const rids = Object.keys(seqs);
  for (const A of rids) {
    const sa = seqs[A];
    if (!near[A].bo.length) continue;
    const atK = new Array(sa.ids.length).fill(null);
    for (const b of near[A].bo) {
      const w = C.wait(A, sa, b.id, t0 + b.min * 60);
      if (!w) continue;
      for (let k = 0; k < sa.ids.length; k++) {
        const path = pathIdx(sa, b.i, k);
        if (!path) continue;
        const r = C.ride(A, sa, path, w);
        if (!atK[k] || r.alightT < atK[k].r.alightT) atK[k] = { b, w, r, path };
      }
    }
    for (const B of rids) {
      if (B === A || !near[B].al.length) continue;
      const sb = seqs[B];
      let best = null;
      sa.ids.forEach((ida, k) => {
        const x = atK[k], s = C.stops[ida];
        if (!x || !okPt(s)) return;
        sb.ids.forEach((idb, m) => {
          const o = C.stops[idb];
          if (!okPt(o)) return;
          const d = ida === idb ? 0 : hav(s, o) * DETOUR;
          if (d > XFER_M) return;
          const xm = C.xferMin(ida, idb, d), wb = C.wait(B, sb, idb, x.r.alightT + xm * 60);
          if (!wb) return;
          for (const a of near[B].al) {
            const pb = pathIdx(sb, m, a.i);
            if (!pb) continue;
            const rb = C.ride(B, sb, pb, wb), arr = rb.alightT + a.min * 60;
            if (!best || arr < best.arr) best = { arr, x, d, xm, wb, rb, pb, a };
          }
        });
      });
      if (!best) continue;
      const { x } = best;
      const l1 = C.busLeg(A, sa, x.path, x.w, x.r), l2 = C.busLeg(B, sb, best.pb, best.wb, best.rb), legs = [];
      addWalk(legs, start, l1.board, x.b.m, x.b.min);
      legs.push(l1);
      addWalk(legs, l1.alight, l2.board, best.d, best.xm);
      legs.push(l2);
      addWalk(legs, l2.alight, dest, best.a.m, best.a.min);
      cands.push({ key: A + ">" + B, legs, arr: best.arr, xfer: true });
    }
  }
  return cands;
}

/**
 * Plan trips from `from` to `to`. Totals include every walk: to the boarding stop, between stops
 * on a transfer, and from the alighting stop to the destination.
 * @param {{from:{lat,lon}, to:{lat,lon}, now?:number, data:{stops,routes,routeStops,trips,buses},
 *   predict?:{rideMinutes:Function}, walkMins?:Object<string,number>}} args
 *   walkMins: router minute overrides keyed 'start:<stopId>', 'end:<stopId>', 'xfer:<fromId>><toId>'
 *   (used by refineWalking; normal callers omit it).
 * @returns {{now:number, options:Array<Object>, walkOnly:{m:number, min:number}}}
 *   Option = {key, total, totalMin, arrive, t0, walkMin, walkM, meets, legs:[WalkLeg|BusLeg]} (see docs/ARCHITECTURE.md)
 */
export function plan({ from, to, now, data, predict, walkMins } = {}) {
  const t0 = typeof now === "number" && isFinite(now) ? now : nowS();
  const result = { now: t0, options: [], walkOnly: { m: 0, min: 0 } };
  if (!okPt(from) || !okPt(to)) return result;
  const wm = walkM(from, to);
  result.walkOnly = { m: Math.round(wm), min: wm / WALK_M_MIN };
  const C = makeCtx({ data, predict, walkMins });
  const D = data || {};
  const seqs = {};
  for (const rid of Object.keys(D.routeStops || {})) seqs[rid] = seqOf(D.routeStops[rid], C.stops);
  const sel = { t0, walkOnlyMin: result.walkOnly.min, max: MAX_OPTS, xferGainMin: XFER_GAIN_MIN };
  result.options = pickOptions(candidates(C, seqs, from, to, t0, MAX_WALK), sel);
  // Nothing within 800 m of one end: allow longer end walks (same ranking).
  if (!result.options.length) result.options = pickOptions(candidates(C, seqs, from, to, t0, MAX_WALK_FAR), sel);
  return result;
}

/** Router minute overrides for every walk leg of an option (keys as in plan's walkMins). */
function overridesOf(legs) {
  const out = {};
  legs.forEach((l, i) => {
    if (l.type !== "walk") return;
    const prev = legs[i - 1], next = legs[i + 1];
    if (prev && prev.type === "bus" && next && next.type === "bus") out["xfer:" + prev.alight.id + ">" + next.board.id] = l.min;
    else if (next && next.type === "bus") out["start:" + next.board.id] = l.min;
    else if (prev && prev.type === "bus") out["end:" + prev.alight.id] = l.min;
  });
  return out;
}

/**
 * Replace estimated walk legs with sidewalk routes (never shorter than the straight line), then
 * re-time every leg, including the final walk, and recompute total/arrive/walkMin/walkM. If a live bus would
 * now be missed, re-plan with the router walking times and return the same-route option from
 * that plan (refined again), or null when it no longer exists (drop the card). Never rejects.
 * @param {Object} option a plan() option
 * @param {{walkRoute:Function, now?:number, data?:Object, from?:{lat,lon}, to?:{lat,lon}, predict?:Object}} ctx
 * @returns {Promise<Object|null>} refined option ({...option, refined:true, replanned?:true}) or null
 */
export async function refineWalking(option, { walkRoute, now, data, from, to, predict, _depth = 0 } = {}) {
  if (!option || !Array.isArray(option.legs)) return option || null;
  const t0 = typeof now === "number" && isFinite(now) ? now : typeof option.t0 === "number" ? option.t0 : nowS();
  const legs = option.legs.map((l) => ({ ...l }));
  await Promise.all(legs.map(async (l) => {
    if (l.type !== "walk" || typeof walkRoute !== "function") return;
    try {
      const r = await walkRoute(l.from, l.to);
      if (r && isFinite(r.min) && isFinite(r.m)) {
        // Never shorter than the straight line (the router rounds endpoints to ~11 m).
        const crow = okPt(l.from) && okPt(l.to) ? hav(l.from, l.to) : 0;
        l.m = Math.round(Math.max(r.m, crow)); l.min = Math.max(r.min, crow / WALK_M_MIN);
        l.source = r.source === "router" ? "router" : "estimate";
        if (Array.isArray(r.coords) && r.coords.length) l.coords = r.coords;
      }
    } catch (e) { /* keep the estimate */ }
  }));
  let t = t0, missed = false;
  for (const l of legs) {
    if (l.type === "walk") { t += (Number(l.min) || 0) * 60; continue; }
    if (l.type !== "bus") continue;
    if (l.waitLive) {
      if (t > l.boardT + GRACE_S) { missed = true; break; }
      l.wait = Math.max(0, (l.boardT - t) / 60);
    } else {
      l.boardT = t + l.wait * 60;
    }
    if (!(l.source === "live" && l.alightT > l.boardT)) l.alightT = l.boardT + l.ride * 60;
    t = l.alightT;
  }
  if (missed) {
    if (_depth >= 2) return null;
    const first = legs[0], last = legs[legs.length - 1];
    const f = okPt(from) ? from : first.type === "walk" ? first.from : first.board;
    const d = okPt(to) ? to : last.type === "walk" ? last.to : last.alight;
    if (!okPt(f) || !okPt(d) || !data) return null;
    const again = plan({ from: f, to: d, now: t0, data, predict, walkMins: overridesOf(legs) });
    const same = again.options.find((o) => o.key === option.key);
    if (!same) return null;
    const r = await refineWalking(same, { walkRoute, now: t0, data, from: f, to: d, predict, _depth: _depth + 1 });
    return r ? { ...r, replanned: true } : null;
  }
  const total = (t - t0) / 60;
  return { ...option, legs, total, totalMin: Math.max(1, Math.round(total)), arrive: t, t0, ...walkTotals(legs), refined: true };
}

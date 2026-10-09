/**
 * @module core/tripprogress
 * Follow a started trip against live data (Current trip tab, Google-Maps-transit style). Pure logic,
 * no DOM. Input: store.journey of kind 'plan' with the compact `legs` summary written by
 * ui/views/journey.js planJourney:
 *   walk {type:'walk', min, toName}
 *   bus  {type:'bus', rid, board:{id,name}, alight:{id,name}, tripId, boardT, alightT, source?, waitLive?}
 *
 * For every bus leg it finds the stops from the boarding stop to the alighting stop along
 * routeStops (loops wrap), plus up to TRIP.BEFORE stops before the boarding stop while the bus has not
 * reached it, the vehicle to follow and where it is:
 *  - vehicle: the leg's planned trip (tripId, matched in buses directly or via its trip update's
 *    vehicle); else, when the planned boarding time is past, a bus between the two stops (you are
 *    probably on it); else the next OPERATING bus of the route arriving at the boarding stop
 *    (core/arrivals arrivalsFor; store.buses only holds operating buses, core/operating.js); else the
 *    route bus fewest stops before it. If your location is still at the boarding stop after the
 *    followed bus left, it was missed and the next bus is followed instead (missed:true).
 *  - position: the vehicle's stop_id is the stop it is heading to (index i in leg.stops); it is
 *    between i-1 and i, `frac` 0..1 by distance; within TRIP.AT_STOP_M of stop i it is `at` stop i.
 *    i = -1: it is `behind` stops before the first listed stop; i = stops.length: past the last one.
 *  - ETAs: only from that vehicle's live stop_time_update (monotonic along the stops, so a loop that
 *    lists a stop twice is matched in order). No live time = null; planned board/alight times are
 *    returned separately and flagged (live:false), never presented as live.
 * Phases: 'walk-to-stop' | 'waiting' | 'on-bus' | 'arrived' (off the last bus, final walk). Without a
 * live vehicle the phase follows the plan's clock (byTime:true) and your location when known.
 */
import { arrivalsFor, staleLevel } from "./arrivals.js";
import { hav, WALK_M_PER_MIN, WALK_DETOUR } from "./geo.js";
import { routeOrder } from "./notify.js";

/** Tunables (read-only). */
export const TRIP = Object.freeze({
  BEFORE: 3,         // stops listed before the boarding stop while the bus is still coming
  AT_STOP_M: 35,     // a bus this close to the stop it is heading to is at that stop
  AT_USER_M: 60,     // you are at the stop within this distance
  MISSED_M: 120,     // still this close to the boarding stop after the bus left -> missed it
  BUS_STALE_S: 60,   // a vehicle report older than this is labeled with its age
  GRACE_S: 60,       // a planned time counts as passed this long after it is due
  LATE_DONE_S: 900,  // planned trip gone this long after its planned arrival -> that ride is over
  STOP_S: 90,        // rough seconds per stop when the plan has no ride time (only to skip buses you cannot reach)
});

const num = (x) => (typeof x === "number" && isFinite(x) ? x : null);
const okPt = (p) => !!p && isFinite(p.lat) && isFinite(p.lon);
const timeOf = (u) => { const t = Number((u && u.arrival && u.arrival.time) || (u && u.departure && u.departure.time) || 0); return t && isFinite(t) ? t : 0; };
const same = (a, b) => a != null && b != null && String(a) === String(b);
const walkMinM = (m) => (m * WALK_DETOUR) / WALK_M_PER_MIN;

/** Trip update of a trip id, else of a vehicle id. */
function tripUpdate(trips, tripId, vehicleId) {
  return (trips || []).find((t) => same(t && t.trip && t.trip.trip_id, tripId))
    || (trips || []).find((t) => same(t && t.vehicle && t.vehicle.id, vehicleId)) || null;
}

/** Operating bus running a trip (by its trip id, else by the vehicle named in that trip's update). */
function busForTrip(S, rid, tripId) {
  if (tripId == null) return null;
  const buses = S.buses || [];
  const b = buses.find((v) => same(v && v.trip && v.trip.trip_id, tripId));
  if (b) return b;
  const tu = (S.trips || []).find((t) => same(t && t.trip && t.trip.trip_id, tripId));
  const vid = tu && tu.vehicle && tu.vehicle.id;
  return vid == null ? null : buses.find((v) => same(v && v.vehicle && v.vehicle.id, vid) && same(v.trip && v.trip.route_id, rid)) || null;
}

/** Route-order indexes from board to alight (forward, loops wrap; shortest), or null. */
function legWindow(list, boardId, alightId) {
  const { order, loop } = routeOrder(list);
  const n = order.length;
  let best = null;
  order.forEach((id, i) => {
    if (id !== boardId) return;
    for (let s = 1; s < (loop ? n : n - i); s++) {
      if (order[loop ? (i + s) % n : i + s] === alightId) { if (!best || s < best.len) best = { b: i, len: s }; break; }
    }
  });
  if (!best) return null;
  const path = [];
  for (let s = 0; s <= best.len; s++) path.push(loop ? (best.b + s) % n : best.b + s);
  const before = [], used = new Set(path);
  for (let k = path[0], c = 0; c < TRIP.BEFORE; c++) {
    k = loop ? (k - 1 + n) % n : k - 1;
    if (k < 0 || used.has(k)) break;
    used.add(k); before.unshift(k);
  }
  return { order, loop, n, path, before };
}

/**
 * Where a bus is relative to a window of route-order indexes. preferBehind: the bus is known to be
 * coming to the boarding stop, so on a loop a next stop after the boarding stop means the previous lap.
 * @returns {{idx:number, behind?:number, beyond?:number}|null} idx into w, -1 behind it, w.length past it
 */
function locate(W, w, nextId, preferBehind) {
  const p = w.findIndex((k) => W.order[k] === nextId);
  if (p >= 0 && !(preferBehind && W.loop && p > W.before.length)) return { idx: p };
  let toFirst = Infinity, fromLast = Infinity;
  W.order.forEach((id, k) => {
    if (id !== nextId) return;
    const b = W.loop ? (w[0] - k + W.n) % W.n : w[0] - k;
    const a = W.loop ? (k - w[w.length - 1] + W.n) % W.n : k - w[w.length - 1];
    if (b > 0) toFirst = Math.min(toFirst, b);
    if (a > 0) fromLast = Math.min(fromLast, a);
  });
  if (toFirst === Infinity && fromLast === Infinity) return null;
  if (toFirst < Infinity && (preferBehind || toFirst <= fromLast)) return { idx: -1, behind: toFirst };
  return { idx: w.length, beyond: fromLast };
}

/**
 * Vehicle record for a bus along the window w (null when it is not on this route). tuFor: the trip update
 * whose predictions to use (the trip you will ride; a vehicle can still be finishing an earlier trip),
 * default the vehicle's current trip. The position always comes from the vehicle's current trip.
 */
function vehicleAt(S, W, w, bus, how, now, preferBehind, tuFor) {
  const cur = tripUpdate(S.trips, bus.trip && bus.trip.trip_id, bus.vehicle && bus.vehicle.id), tu = tuFor || cur;
  let nextId = bus.stop_id != null ? String(bus.stop_id) : null;
  if (!nextId || !W.order.includes(nextId)) {
    const up = (((cur || tu) && (cur || tu).stop_time_update) || []).filter((u) => timeOf(u) > now - 30).sort((a, b) => timeOf(a) - timeOf(b))[0];
    nextId = up && up.stop_id != null ? String(up.stop_id) : null;
  }
  const loc = nextId ? locate(W, w, nextId, preferBehind) : null;
  if (!loc) return null;
  const stops = S.stops || {}, here = { lat: Number(bus.position && bus.position.latitude), lon: Number(bus.position && bus.position.longitude) };
  const k = loc.idx >= 0 && loc.idx < w.length ? w[loc.idx] : W.order.indexOf(nextId);
  const pk = W.loop ? (k - 1 + W.n) % W.n : k - 1, prevId = pk >= 0 ? W.order[pk] : null;
  let frac = 0.5, at = false;
  const ns = stops[nextId], ps = prevId != null ? stops[prevId] : null;
  if (okPt(here) && okPt(ns)) {
    const dn = hav(here, ns);
    at = dn <= TRIP.AT_STOP_M;
    if (okPt(ps)) { const dp = hav(ps, here); if (dp + dn > 0) frac = Math.min(0.9, Math.max(0.1, dp / (dp + dn))); }
  }
  const seen = Number(bus.timestamp) || 0;
  return {
    id: bus.vehicle && bus.vehicle.id != null ? String(bus.vehicle.id) : null,
    label: String((bus.vehicle && (bus.vehicle.label ?? bus.vehicle.id)) ?? ""),
    tripId: bus.trip && bus.trip.trip_id != null ? String(bus.trip.trip_id) : null,
    how, idx: loc.idx, behind: loc.behind || 0, beyond: loc.beyond || 0, frac, at,
    pos: loc.idx < 0 ? -1 : loc.idx >= w.length ? w.length : at ? loc.idx : loc.idx - 1 + frac,
    nextId, nextName: (ns && ns.name) || nextId, prevName: (ps && ps.name) || prevId || null,
    lat: okPt(here) ? here.lat : null, lon: okPt(here) ? here.lon : null,
    seen, stale: !!seen && now - seen > TRIP.BUS_STALE_S, tu,
  };
}

/** Live ETAs of a trip update along stop ids, matched in order (null where none). */
function etasAlong(tu, ids, from, now) {
  const ups = ((tu && tu.stop_time_update) || []).map((u) => ({ id: String(u.stop_id), t: timeOf(u), seq: Number(u.stop_sequence) }))
    .filter((u) => u.t && u.t > now - 30);
  if (ups.every((u) => isFinite(u.seq))) ups.sort((a, b) => a.seq - b.seq || a.t - b.t); else ups.sort((a, b) => a.t - b.t);
  const out = ids.map(() => null);
  let j = 0;
  for (let k = Math.max(0, from); k < ids.length; k++) {
    const m = ups.findIndex((u, q) => q >= j && u.id === ids[k]);
    if (m >= 0) { out[k] = ups[m].t; j = m + 1; }
  }
  return out;
}

/** Distance (m) from the user to a stop, or null. */
function userTo(S, id) {
  const s = S.stops && S.stops[id];
  return okPt(S.user) && okPt(s) ? hav(S.user, s) : null;
}

/**
 * Evaluate one bus leg.
 * @param {object} l journey bus leg
 * @param {object} S state
 * @param {number} now
 * @param {{active:boolean, prevWalk:object|null, walkStart:number|null, readyT:number}} ctx
 */
function evalBus(l, S, now, ctx) {
  const rid = String(l.rid), bId = String(l.board && l.board.id), aId = String(l.alight && l.alight.id);
  const nameOf = (id) => (S.stops && S.stops[id] && S.stops[id].name) || (id === bId ? l.board.name : id === aId ? l.alight.name : null) || id;
  const W = legWindow(S.routeStops && S.routeStops[rid], bId, aId);
  const pB = num(l.boardT), pA = num(l.alightT), rideS = pB != null && pA != null && pA > pB ? pA - pB : null;
  const nearBoard = userTo(S, bId);
  const out = { type: "bus", rid, board: { id: bId, name: nameOf(bId) }, alight: { id: aId, name: nameOf(aId) }, planTripId: l.tripId != null ? String(l.tripId) : null,
    source: l.source || null, state: "upcoming", phase: "upcoming", vehicle: null, stops: [], boardIdx: 0, alightIdx: 1, stopsAway: null, stopsLeft: null,
    boardEta: null, boardLive: false, alightEta: null, alightLive: false, rideMin: rideS != null ? rideS / 60 : null, live: false, byTime: false, missed: false,
    canCatch: null, slackMin: null, walkMin: null, doneT: null };
  const ids = W ? [...W.before, ...W.path].map((k) => W.order[k]) : [bId, aId];
  let bpos = W ? W.before.length : 0, apos = ids.length - 1;
  const w = W ? [...W.before, ...W.path] : null;

  // vehicle choice
  let V = null;
  const place = (bus, how, behind, tu) => (W && bus && bus.position ? vehicleAt(S, W, w, bus, how, now, behind, tu) : null);
  const routeBuses = (S.buses || []).filter((b) => same(b && b.trip && b.trip.route_id, rid));
  // Still walking to the boarding stop: a "next" bus that passes it before you can get there is not your
  // bus (it would say "1 stop away" while you are 15 min out). reachT = when you get there (estimate).
  const walking = ctx.active && !!ctx.prevWalk && !(nearBoard != null && nearBoard <= TRIP.AT_USER_M)
    && !(nearBoard == null && ctx.walkStart != null && now >= ctx.walkStart + (Number(ctx.prevWalk.min) || 0) * 60);
  const reachT = !walking ? now : now + 60 * (nearBoard != null ? walkMinM(nearBoard)
    : ctx.walkStart != null ? Math.max(0, (ctx.walkStart - now) / 60 + (Number(ctx.prevWalk.min) || 0)) : Number(ctx.prevWalk.min) || 0);
  // seconds per stop, only to judge whether a bus WITHOUT a prediction gets there first (never displayed)
  const perStopS = rideS != null && W ? rideS / Math.max(1, W.path.length - 1) : TRIP.STOP_S;
  const approaching = (skip) => {
    const minT = ctx.active ? Math.max(now - 30, reachT - TRIP.GRACE_S) : ctx.readyT - 15;
    for (const a of arrivalsFor(S, bId, { routeId: rid, nowS: now })) {
      if (a.t < minT) continue;
      const b = busForTrip(S, rid, a.tripId);
      if (!b || (skip && same(b.vehicle && b.vehicle.id, skip))) continue;
      const v = place(b, "next", true, tripUpdate(S.trips, a.tripId, null));   // that arrival's trip (may be the vehicle's next one)
      if (v && v.idx <= bpos) return v;
    }
    let best = null;
    for (const b of routeBuses) {
      if (skip && same(b.vehicle && b.vehicle.id, skip)) continue;
      const v = place(b, "next", true);
      if (!v || v.idx > bpos) continue;
      const away = v.idx < 0 ? v.behind + bpos : bpos - v.idx;
      if (walking && now + away * perStopS < reachT - TRIP.GRACE_S) continue;   // gone before you get there
      if (!best || away < best.away) best = { v, away };
    }
    return best ? best.v : null;
  };
  const stillAtBoard = nearBoard != null && nearBoard <= TRIP.MISSED_M;
  const nearAlight = userTo(S, aId);
  const planned = busForTrip(S, rid, l.tripId);
  if (planned) {
    // The vehicle may still be finishing an EARLIER trip (your trip is its next one, found via the trip
    // update's vehicle): then it has not started your trip yet, so it is coming (never "past your stop"),
    // and the predictions are those of YOUR trip, not of the one it is on now.
    const onPlanned = same(planned.trip && planned.trip.trip_id, l.tripId);
    const tu = tripUpdate(S.trips, l.tripId, onPlanned && planned.vehicle ? planned.vehicle.id : null);
    // coming to the boarding stop = your trip still predicts it there and you are not past the planned boarding
    const coming = !onPlanned || (!!tu && (tu.stop_time_update || []).some((u) => String(u.stop_id) === bId && timeOf(u) > now - 30));
    V = place(planned, "trip", coming && (!onPlanned || !(ctx.active && pB != null && now > pB + TRIP.GRACE_S && !stillAtBoard)), tu);
    if (V && !onPlanned && V.idx > bpos) V = null;   // line route: where it is on its earlier trip says nothing about yours
  }
  // the planned trip is gone: long past its planned arrival, or you are at the alighting stop -> leg done
  const lateDone = ctx.active && !stillAtBoard && ((nearAlight != null && nearAlight <= TRIP.AT_USER_M)
    || (pA != null && now > pA + TRIP.LATE_DONE_S && !(V && V.idx > bpos)));
  if (!V && !lateDone && ctx.active && pB != null && now > pB + TRIP.GRACE_S && !stillAtBoard) {
    let best = null;
    for (const b of routeBuses) {
      const v = place(b, "onboard", false);
      if (v && v.idx > bpos && v.idx <= apos && (!best || v.idx < best.idx)) best = v;
    }
    V = best;
  }
  if (!V && !lateDone) V = approaching(null);
  const sb = S.stops && S.stops[bId];
  if (V && ctx.active && V.idx > bpos && stillAtBoard && !(V.lat != null && okPt(sb) && hav(V, sb) < TRIP.MISSED_M + 130)) {
    out.missed = true;
    V = approaching(V.id);
  }

  // phase
  const atStop = () => {
    if (!ctx.prevWalk) return true;
    if (nearBoard != null) return nearBoard <= TRIP.AT_USER_M;
    return ctx.walkStart != null && now >= ctx.walkStart + (Number(ctx.prevWalk.min) || 0) * 60;
  };
  let onBus = false, done = false;
  if (lateDone && !(V && V.idx > bpos && V.idx <= apos)) { done = true; out.byTime = !V; V = null; }
  else if (V) {
    if (V.idx > apos) done = !out.missed;
    else if (V.idx > bpos) onBus = true;
  } else if (ctx.active && pB != null && !stillAtBoard) {
    out.byTime = true;
    if (now >= (pA != null ? pA : pB + 600) + TRIP.GRACE_S) done = true;
    else if (now >= pB + TRIP.GRACE_S) onBus = true;
  }
  if (!ctx.active) { out.state = "upcoming"; out.phase = "upcoming"; done = false; onBus = false; }
  else if (done) { out.state = "done"; out.phase = "done"; }
  else { out.state = "active"; out.phase = onBus ? "on-bus" : atStop() ? "waiting" : "walk-to-stop"; }

  // stops before the boarding stop only while a live bus is still coming to it on the active leg
  let list = ids, from = 0;
  if (W && (onBus || done || !ctx.active || !V) && bpos > 0) {
    list = ids.slice(bpos); from = bpos; apos -= bpos; bpos = 0;
    if (V) {
      if (V.idx < 0) V.behind += from; else if (V.idx < from) V.behind = from - V.idx;
      V.idx = V.idx < from ? -1 : V.idx - from;
      V.pos = V.idx < 0 ? -1 : V.pos - from;
    }
  }
  // live ETAs from the followed bus
  const etas = V && V.tu ? etasAlong(V.tu, list, V.idx, now) : list.map(() => null);
  out.stops = list.map((id, k) => {
    let st = "upcoming";
    if (done) st = "passed";
    else if (V && V.idx >= list.length) st = "passed";
    else if (V && V.idx >= 0) st = k < V.idx ? "passed" : k === V.idx ? (V.at ? "current" : "next") : "upcoming";
    else if (!V && onBus && k <= bpos) st = "passed";
    return { id, name: nameOf(id), role: k === bpos ? "board" : k === apos ? "alight" : k < bpos ? "before" : "ride", state: st, eta: st === "passed" ? null : etas[k] };
  });
  out.boardIdx = bpos; out.alightIdx = apos;
  if (V) {
    const { tu, ...pub } = V;
    out.vehicle = pub;
    if (V.idx <= bpos) out.stopsAway = V.idx < 0 ? V.behind + bpos : bpos - V.idx;
    else if (V.idx <= apos) out.stopsLeft = V.at && V.idx === apos ? 0 : apos - V.idx + 1;
  }
  // board / alight times: live from the followed bus, else the plan (flagged)
  const be = out.stops[bpos] && out.stops[bpos].eta, ae = out.stops[apos] && out.stops[apos].eta;
  if (be) { out.boardEta = be; out.boardLive = true; }
  else if (!onBus && !done && !V && pB != null && pB > Math.max(now, ctx.active ? 0 : ctx.readyT) - TRIP.GRACE_S) out.boardEta = pB;
  else if (!onBus && !done && !ctx.active && !V) out.boardEta = Math.max(ctx.readyT, pB || 0);
  if (ae) { out.alightEta = ae; out.alightLive = true; }
  else if (out.boardEta != null && rideS != null) out.alightEta = out.boardEta + rideS;
  else if (pA != null && !done) out.alightEta = Math.max(pA, now);
  else if (done && pA != null) out.alightEta = Math.min(pA, now);
  out.live = !!V || out.boardLive || out.alightLive;
  if (done) out.doneT = out.alightEta != null ? Math.min(out.alightEta, now) : now;

  // walking to the stop: live walking time from your location, leave slack against the bus time
  if (out.phase === "walk-to-stop" && ctx.prevWalk) {
    out.walkMin = nearBoard != null ? walkMinM(nearBoard) : Number(ctx.prevWalk.min) || 0;
    if (out.boardEta != null) { out.slackMin = (out.boardEta - now) / 60 - out.walkMin; out.canCatch = out.slackMin >= 0; }
  }
  return out;
}

/**
 * Progress of a started trip.
 * @param {{kind:'plan', label?:string, to?:string, t0?:number, legs?:Array<object>}|null} journey store.journey
 * @param {object} state store state (stops, routeStops, buses, trips, user, lastOk, failed, feedTs)
 * @param {number} nowS unix seconds
 * @returns {null|{to:string, label:string, phase:'walk-to-stop'|'waiting'|'on-bus'|'arrived', active:number,
 *   arriveT:number|null, arriveLive:boolean, live:boolean, stale:''|'late'|'old'|'err', legs:Array<object>}}
 *   legs[i] walk: {type:'walk', min, minNow, toName, final, state:'done'|'active'|'upcoming'}
 *   legs[i] bus: {type:'bus', rid, board, alight, state:'done'|'active'|'upcoming', phase:'walk-to-stop'|'waiting'|'on-bus'|'done'|'upcoming',
 *     stops:[{id, name, role:'before'|'board'|'ride'|'alight', state:'passed'|'current'|'next'|'upcoming', eta:unixS|null}],
 *     boardIdx, alightIdx, vehicle:{id, label, tripId, how:'trip'|'onboard'|'next', idx, behind, beyond, frac, at, pos, nextId, nextName, prevName, seen, stale}|null,
 *     stopsAway, stopsLeft, boardEta, boardLive, alightEta, alightLive, rideMin, live, byTime, missed, canCatch, slackMin, walkMin, planTripId, source}
 *   null when the journey is not a plan with at least one bus leg.
 */
export function tripProgress(journey, state, nowS) {
  const now = num(nowS) != null ? nowS : Date.now() / 1000;
  const J = journey;
  if (!J || J.kind !== "plan" || !Array.isArray(J.legs) || !J.legs.some((l) => l && l.type === "bus" && l.board && l.alight)) return null;
  const S = state || {};
  const src = J.legs.filter((l) => l && (l.type === "walk" || (l.type === "bus" && l.board && l.alight)));
  const legs = [];
  let allDone = true, readyT = now, walkStart = num(J.t0), active = -1;
  src.forEach((l, i) => {
    if (l.type === "walk") { legs.push({ type: "walk", min: Number(l.min) || 0, minNow: null, toName: l.toName || null, final: i === src.length - 1, state: "upcoming" }); return; }
    const prevWalk = src[i - 1] && src[i - 1].type === "walk" ? src[i - 1] : null;
    if (!allDone) readyT += (prevWalk ? Number(prevWalk.min) || 0 : 0) * 60;
    const r = evalBus(l, S, now, { active: allDone, prevWalk, walkStart, readyT });
    legs.push(r);
    if (r.state === "done") { walkStart = r.doneT; readyT = Math.max(now, r.doneT); return; }
    if (allDone) active = legs.length - 1;
    allDone = false;
    readyT = r.alightEta != null ? r.alightEta : r.boardEta != null ? r.boardEta + (r.rideMin || 0) * 60 : readyT;
  });
  // walk legs follow the bus legs around them
  legs.forEach((l, i) => {
    if (l.type !== "walk") return;
    const next = legs[i + 1];
    if (l.final) {
      if (!l.toName) l.toName = J.to || (J.label || "").replace(/^To /, "") || "destination";
      l.state = allDone ? "active" : "upcoming";
    } else if (next && next.type === "bus") {
      if (!l.toName) l.toName = next.board.name;
      l.state = next.phase === "walk-to-stop" ? "active" : next.state === "upcoming" ? "upcoming" : "done";
      if (next.phase === "walk-to-stop") l.minNow = next.walkMin;
    }
  });
  if (allDone) active = legs.length - 1;
  const cur = legs[active] || null;
  const phase = allDone ? "arrived" : cur.phase;
  const buses = legs.filter((l) => l.type === "bus"), lastBus = buses[buses.length - 1];
  const fin = legs[legs.length - 1] && legs[legs.length - 1].type === "walk" ? legs[legs.length - 1] : null;
  let arriveT = allDone ? (lastBus.doneT != null ? lastBus.doneT : now) : lastBus.alightEta;
  if (arriveT != null && fin) arriveT += fin.min * 60;
  if (arriveT != null && allDone) arriveT = Math.max(arriveT, now);
  return {
    to: J.to || (J.label || "").replace(/^To /, "") || (fin && fin.toName) || "destination",
    label: J.label || "", phase, active, arriveT, arriveLive: !allDone && !!lastBus.alightLive,
    live: !!(cur && cur.type === "bus" ? cur.live : lastBus.live), stale: staleLevel(S, now), legs,
  };
}

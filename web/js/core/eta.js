/**
 * @module core/eta
 * Station times (owner 2026-11-20: "The upcoming arrivals seem to be broken when looking at individual routes ...
 * Shouldn't each station have a predicted arrival time when viewing it?"). Pure, no DOM, never throws. iOS: Kit
 * FillerTimes / StationTimes (the same numbers and words).
 *
 * 1. Passio filler. Most stops of a Passio trip update carry the previous listed stop's time + 2 s (sometimes 3), so a
 *    route page showed the same "10 min" at 14 stops in a row (measured on the pred-updates archive: about 55% of the
 *    rows since Oct 28, shown more than 2 min later than the bus came 2 to 4 times as often as real rows; DC-031). In ONE
 *    trip update, walking stop_time_update in listed order, an entry whose time (arrival, else departure) is 0 to
 *    FILLER_S seconds after the previous listed entry's time is filler, not a forecast; the first entry of a run (the
 *    head) stays a live time. data/live.js parseTrips marks them (markFiller: u.filler = true). Every consumer that
 *    SHOWS a time skips them (core/arrivals.js arrivalsFor, notify.js, planner.js, tripprogress.js); those that only ask
 *    "does this trip go on" (operating.js, idle.js) keep counting them.
 * 2. Every station gets a time, one of three kinds:
 *    - live: a real Passio time of that bus ("3 min").
 *    - est: estimated from where a bus of the route is now and the timetable's travel times between stops
 *      (data/segments.json through core/predict.js rideMinutes, the source core/tripprogress.js stopTimes uses), scaled
 *      to that bus's own live times where it has them; one lap ahead at most. Shown "~5 min" + "est.".
 *    - sched: no bus of the route can give one: the next timetable time at the stop (data/timetable.json), shown as a
 *      clock time + "Scheduled". The views use it only while the route is scheduled now.
 *    An estimate is always labeled (ship checklist 2), never shown as live.
 */
import { arrivalsFor } from "./arrivals.js";
import { routeOrder } from "./notify.js";
import { stopTimes, matchTimes, TRIP } from "./tripprogress.js";
import { hav } from "./geo.js";
import { isScheduledNow } from "./schedule.js";
import { instancesBetween, instAt, AHEAD_S } from "./timetable.js";
import { TRANSITION_TIMES } from "./seen.js";
import { predict } from "./predict.js";
import { minsUntil, clock } from "./time.js";

/** An entry this many seconds (or less, and not earlier) after the previous listed entry of its trip update is filler. */
export const FILLER_S = 3;

/** The words of the three kinds (iOS Kit StationTimes.words; the same strings). */
export const ETA_WORDS = Object.freeze({ est: "est.", sched: "Scheduled", estSay: "estimated", schedSay: "scheduled, not live" });

/** The route page's footer sentences, one per kind shown (plain words, DESIGN.md 1b). */
export const ETA_NOTES = Object.freeze({
  live: "Unmarked times are live predictions. Bus positions are approximate.",
  est: "est. = estimated from where the bus is and the timetable's travel times.",
  sched: "Scheduled = the timetable, not live.",
});

const num = (x) => (typeof x === "number" && isFinite(x) ? x : null);
const same = (a, b) => a != null && b != null && String(a) === String(b);
const timeOf = (u) => { const t = Number((u && u.arrival && u.arrival.time) || (u && u.departure && u.departure.time) || 0); return t && isFinite(t) ? t : 0; };
const okPt = (p) => !!p && isFinite(p.lat) && isFinite(p.lon);

/**
 * Mark Passio's filler entries of one trip update: u.filler = true on an entry whose time is 0 to FILLER_S seconds after
 * the previous listed entry that has a time; any other entry loses the mark. Mutates and returns the same object;
 * idempotent. Entries without a time are never filler and do not break a run.
 * @param {object} tu GTFS-rt TripUpdate (times as numbers or numeric strings)
 * @returns {object} tu
 */
export function markFiller(tu) {
  const ups = tu && Array.isArray(tu.stop_time_update) ? tu.stop_time_update : [];
  let prev = null;
  for (const u of ups) {
    if (!u || typeof u !== "object") continue;
    const t = timeOf(u);
    if (!t) { if ("filler" in u) delete u.filler; continue; }
    if (prev != null && t - prev >= 0 && t - prev <= FILLER_S) u.filler = true;
    else if ("filler" in u) delete u.filler;
    prev = t;
  }
  return tu;
}

/** The default ride: scheduled minutes between two stops of a route (core/predict.js on data/segments.json), or null. */
export function defaultRide(rid, fromId, toId) {
  const r = predict.rideMinutes(rid, fromId, toId);
  return r && r.min != null ? r.min : null;
}

/** This bus's trip updates on its route: every one naming its vehicle (Passio splits a bus over its current and next
 * trip), else the one update of its trip id when that names no vehicle (never another bus's times). */
function busUpdates(trips, bus, rid) {
  const vid = bus && bus.vehicle ? bus.vehicle.id : null, tid = bus && bus.trip ? bus.trip.trip_id : null, T = trips || [];
  const offRoute = (t) => t.trip && t.trip.route_id != null && !same(t.trip.route_id, rid);
  const mine = vid == null ? [] : T.filter((t) => t && t.vehicle && same(t.vehicle.id, vid) && !offRoute(t));
  if (mine.length) return mine;
  const byTrip = tid == null ? [] : T.filter((t) => t && t.trip && same(t.trip.trip_id, tid) && !offRoute(t));
  return byTrip.length === 1 && !(byTrip[0].vehicle && byTrip[0].vehicle.id != null) ? byTrip : [];
}

/** Is this bus shown without its times (core/seen.js: transitioning to a new line, TRANSITION_TIMES off)? */
function timesOff(state, bus) {
  return !TRANSITION_TIMES && (state.transitioning || []).map(String).includes(String(bus && bus.vehicle ? bus.vehicle.id : ""));
}

/** Riding minutes from `ride`, NaN when unknown. */
function rideOr(ride, rid, a, b) {
  if (a == null || b == null) return NaN;
  const x = ride(rid, String(a), String(b));
  return x == null || x === "" || !isFinite(Number(x)) ? NaN : Number(x);
}

let memo = new WeakMap();

/**
 * This bus's next stops in travel order from the stop it is heading to, one lap (a loop wraps; its repeated last stop
 * is dropped), each with a time: its own live Passio time where it has one (filler skipped; the largest set of its
 * times in both travel and time order, core/tripprogress.js matchTimes, so a time listed out of order is not used: a
 * trip's first stop the bus already left, its next lap), else an estimate (core/tripprogress.js stopTimes: scaled
 * between where the bus is now and its live times, else the ride from the last one). Times are never before now or the
 * stop before. Estimates past the end of the last live time are left out once the route is not scheduled at that time
 * (the bus leaves service). [] for a bus off its route's stop list or shown without its times (transitioning).
 * @param {object} state store state (routeStops, stops, trips, service, transitioning)
 * @param {object} bus a vehicle of state.buses
 * @param {number} now unix seconds
 * @param {(rid:string, fromId:string, toId:string)=>number|null} [ride] riding minutes between two stops of a route;
 *   default defaultRide (data/segments.json)
 * @returns {Array<{stopId:string, idx:number, t:number, kind:'live'|'est'}>} idx = index in the route's stop order
 */
export function busTimes(state, bus, now, ride) {
  try {
    const S = state || {}, r = typeof ride === "function" ? ride : defaultRide;
    if (!bus || !bus.trip || bus.trip.route_id == null) return [];
    const m = memo.get(bus);
    if (m && m.now === now && m.ride === r && m.trips === S.trips && m.rs === S.routeStops && m.stops === S.stops && m.svc === S.service && m.tr === S.transitioning) return m.out;
    const out = computeBusTimes(S, bus, now, r);
    memo.set(bus, { now, ride: r, trips: S.trips, rs: S.routeStops, stops: S.stops, svc: S.service, tr: S.transitioning, out });
    return out;
  } catch (e) {
    return [];
  }
}

function computeBusTimes(S, bus, now, ride) {
  const rid = String(bus.trip.route_id);
  if (timesOff(S, bus)) return [];
  const { order, loop } = routeOrder(S.routeStops && S.routeStops[rid]);
  const n = order.length;
  if (!n) return [];
  const list = busUpdates(S.trips, bus, rid), tid = bus.trip.trip_id;
  const hasCur = list.some((tu) => tu.trip && same(tu.trip.trip_id, tid));
  const ups = [];
  for (const tu of list) for (const u of tu.stop_time_update || []) {
    if (!u || u.filler || u.stop_id == null) continue;
    const t = timeOf(u);
    if (t && t > now - 30) ups.push({ id: String(u.stop_id), t, cur: !hasCur || !!(tu.trip && same(tu.trip.trip_id, tid)) });
  }
  let next = bus.stop_id != null && order.includes(String(bus.stop_id)) ? String(bus.stop_id) : null;
  if (!next) { const up = ups.slice().sort((a, b) => a.t - b.t).find((u) => order.includes(u.id)); next = up ? up.id : null; }
  if (!next) return [];
  const i0 = order.indexOf(next);
  const idxs = [];
  for (let s = 0; s < (loop ? n : n - i0); s++) idxs.push(loop ? (i0 + s) % n : i0 + s);
  const ids = idxs.map((k) => order[k]);
  // live times along the stops: the largest set in both travel and time order (core/tripprogress.js matchTimes). Passio's
  // trips start at the loop's first stop, so the bus's current trip times the stops up to it and its next trip only the
  // stops from there on (else the next lap's time at a stop just ahead would pass for this lap's); heading to that stop
  // itself, either may be current.
  // where the bus is between the stop before and its next stop
  const pk = i0 > 0 ? i0 - 1 : loop ? n - 1 : -1, prevId = pk >= 0 ? order[pk] : null;
  const stops = S.stops || {}, here = { lat: Number(bus.position && bus.position.latitude), lon: Number(bus.position && bus.position.longitude) };
  const ns = stops[next], ps = prevId != null ? stops[prevId] : null;
  let frac = 0.5, at = false;
  if (okPt(here) && okPt(ns)) {
    const dn = hav(here, ns);
    at = dn <= TRIP.AT_STOP_M;
    if (okPt(ps)) { const dp = hav(ps, here); if (dp + dn > 0) frac = Math.min(0.9, Math.max(0.1, dp / (dp + dn))); }
  }
  // the timetable's minutes from the bus to each stop: when two of its times disagree, the one closer to it is believed
  const sched = [];
  for (let k = 0, c = at ? 0 : rideOr(ride, rid, prevId, next) * (1 - frac); k < ids.length; k++) {
    if (k > 0) c += rideOr(ride, rid, ids[k - 1], ids[k]);
    sched.push(c);
  }
  const split = loop ? (n - i0) % n : ids.length;
  const live = matchTimes(ids, ups, {
    may: (k, u) => !split || (u.cur ? k <= split : k >= split),
    cost: (k, u) => (isFinite(sched[k]) ? Math.abs(Math.log((u.t - now + 60) / (sched[k] * 60 + 60))) : 0),
  });
  const leg = { stops: ids.map((id, k) => ({ id, state: "upcoming", eta: live[k] })), boardIdx: 0, alightIdx: ids.length - 1,
    vehicle: { idx: 0, at, frac, prevId, nextId: next }, rideMin: null };
  const times = stopTimes(leg, now, (a, b) => ride(rid, a, b));
  let lastLive = -1;
  live.forEach((t, k) => { if (t != null) lastLive = k; });
  const out = [];
  for (let k = 0; k < ids.length; k++) {
    const x = times[k];
    if (!x || num(x.t) == null) continue;
    if (x.est && k > lastLive && isScheduledNow(S.service, rid, x.t) === false) break;   // the bus leaves service
    out.push({ stopId: ids[k], idx: idxs[k], t: x.t, kind: x.est ? "est" : "live" });
  }
  return out;
}

/**
 * Times at a station, sorted by time: the real live rows (arrivalsFor, filler skipped) plus, for each operating bus of a
 * route serving it, its estimate there (busTimes) when that bus has no live row at the stop. A bus's live row that its
 * own travel order contradicts (earlier than busTimes puts it: Passio's time at a stop listed out of order) gives way to
 * busTimes's time; a later live row of the same bus (its next lap) stays.
 * @param {object} state store state
 * @param {string} stopId
 * @param {{routeId?:string|null, hidden?:string[], now?:number, ride?:Function}} [opts] routeId: only this route
 *   (hidden ignored then); hidden: route ids to leave out
 * @returns {Array<{rid:string, t:number, kind:'live'|'est', bus:string|null, vehicleId:string|null, tripId:string|null}>}
 */
export function stationTimes(state, stopId, { routeId = null, hidden = [], now, ride } = {}) {
  try {
    const S = state || {}, t0 = num(now) != null ? now : Date.now() / 1000, want = String(stopId);
    const hid = new Set((hidden || []).map(String));
    const okRid = (rid) => (routeId != null ? rid === String(routeId) : !hid.has(rid));
    const live = arrivalsFor(S, want, { routeId, hidden, nowS: t0 }).map((a) => ({ ...a, kind: "live" }));
    const drop = new Set(), extra = [];
    for (const b of S.buses || []) {
      const rid = b && b.trip && b.trip.route_id != null ? String(b.trip.route_id) : null;
      if (!rid || !okRid(rid) || !(S.routeStops && (S.routeStops[rid] || []).map(String).includes(want))) continue;
      const vid = b.vehicle && b.vehicle.id != null ? String(b.vehicle.id) : null, tid = b.trip.trip_id != null ? String(b.trip.trip_id) : null;
      const mine = live.filter((a) => a.rid === rid && (a.vehicleId != null ? a.vehicleId === vid : vid == null && a.tripId != null && a.tripId === tid));
      if (timesOff(S, b)) { mine.forEach((a) => drop.add(a)); continue; }
      const bt = busTimes(S, b, t0, ride).find((x) => x.stopId === want);
      if (!bt) continue;
      let kept = false;
      for (const a of mine) {
        if (a.t < bt.t - 1) drop.add(a);   // out of its own travel order
        else if (Math.abs(a.t - bt.t) <= 1) kept = true;
      }
      if (!kept) extra.push({ rid, t: bt.t, kind: bt.kind, bus: b.vehicle && b.vehicle.label != null ? String(b.vehicle.label) : null, tripId: tid, vehicleId: vid });
    }
    return live.filter((a) => !drop.has(a)).concat(extra)
      .sort((a, b) => a.t - b.t || (a.kind === b.kind ? 0 : a.kind === "live" ? -1 : 1) || (a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0));
  } catch (e) {
    return [];
  }
}

let ttMemo = null;

/**
 * The next timetable time at a stop on a route (data/timetable.json, cleaned, in state.timetable), within the next
 * AHEAD_S (4 h). Null when the timetable is not loaded or lists none. The views show it only while the route is
 * scheduled now and no bus can give a time there (a closed route keeps its own wording).
 * @param {object} state store state (timetable)
 * @param {string} rid
 * @param {string} stopId
 * @param {number} now unix seconds
 * @returns {{t:number, kind:'sched'}|null}
 */
export function scheduledAt(state, rid, stopId, now) {
  try {
    const tt = state && state.timetable;
    if (!tt || !tt.routes || !tt.routes[String(rid)] || num(now) == null) return null;
    const key = String(rid) + "|" + Math.floor(now / 60);
    if (!ttMemo || ttMemo.tt !== tt || ttMemo.key !== key) ttMemo = { tt, key, inst: instancesBetween(tt, now - 60, now + AHEAD_S, [String(rid)]) };
    let best = null;
    for (const inst of ttMemo.inst) {
      const t = instAt(inst, String(stopId), now - 1);
      if (t != null && t <= now + AHEAD_S && (best == null || t < best)) best = t;
    }
    return best == null ? null : { t: best, kind: "sched" };
  } catch (e) {
    return null;
  }
}

/**
 * What a station time shows and says.
 *   live:  "3 min" / "Now" (stale feed: "~3 min"), no tag; said "in 3 min" / "now" / "in about 3 min"
 *   est:   "~5 min" (at least 1), tag "est."; said "in about 5 min, estimated"
 *   sched: "1:15 PM", tag "Scheduled"; said "scheduled 1:15 PM, not live"
 * @param {{t:number, kind?:'live'|'est'|'sched'}|null} row
 * @param {number} now
 * @param {boolean} [stale] the feed is late, old or failing
 * @returns {{text:string, tag:string, say:string, now:boolean}|null}
 */
export function timeWords(row, now, stale) {
  if (!row || num(row.t) == null) return null;
  if (row.kind === "sched") {
    const c = clock(row.t);
    return { text: c, tag: ETA_WORDS.sched, say: `${ETA_WORDS.sched.toLowerCase()} ${c}, not live`, now: false };
  }
  const m = minsUntil(row.t, now);
  if (row.kind === "est") {
    const e = Math.max(1, m);
    return { text: `~${e} min`, tag: ETA_WORDS.est, say: `in about ${e} min, ${ETA_WORDS.estSay}`, now: false };
  }
  if (m < 1) return { text: "Now", tag: "", say: "now", now: true };
  return { text: `${stale ? "~" : ""}${m} min`, tag: "", say: `in ${stale ? "about " : ""}${m} min`, now: false };
}

/** Tests: forget the memos. */
export function _resetEta() { memo = new WeakMap(); ttMemo = null; }

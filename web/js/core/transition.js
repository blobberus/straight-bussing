/**
 * @module core/transition
 * Buses that have left their route while Passio still predicts them (owner 2026-11-06: "avoid recommending routes on
 * buses that are about to leave their routes"; RouteKnower E29, data/labeled/transitions/). Pure logic, no DOM.
 * data/live.js applies it after core/offroute.js and core/idle.js: the trip updates of a GONE bus are dropped, so
 * arrivals, the planner, Directions, trip options, the Nearby next bus, bus alerts and the trip view never offer a
 * time from it, and the planner falls back to the next live bus or its headway estimate (labeled "est."). The map is
 * not touched: a gone bus is not on it anyway (core/operating.js drops a report older than 5 min). iOS: Kit
 * Transition.swift (same rule and numbers, golden cases from this file).
 *
 * GONE: the bus's latest report (any route; a ghost in the feed counts with its own report time) is at least GONE_S
 * older than the feed, while the feed itself is alive (one of its vehicles reported within FRESH_S of the feed time),
 * and the bus was reporting normally before it fell silent (its last two reports at most SPARSE_S apart: a bus that
 * reports only every few minutes keeps driving unseen between reports, like 12647 on Oct 12, every 5 to 20 min).
 * Measured on the archived polls and prediction updates of Oct 10 to Nov 5: when a bus leaves its route for a break,
 * the end of its shift or another route, Passio usually keeps its predictions (611 of 774 lasting leaves; after a break
 * for a median 20 min, after a shift end 14 min). Of the predictions Passio showed for buses gone by this rule, 98.8%
 * never came true (the bus did not reach that stop by 15 min after the predicted time; 99.2% on the held-out days
 * Oct 29 to Nov 5); with 10 min instead of 15, 91.2%; with 5 min, 75.9% (layovers out of the feed end within 10 to
 * 27 min).
 * Why not "about to leave" (before it goes): no live signal held up out of sample (the line's learned leave spots and
 * times, the trip, Passio's next-trip times, time on the route, a small network): at best about 30% of the flagged
 * visits were a bus's last stop before it left (E29, E25), so the app does not guess which bus will leave.
 *
 * Rider safety: a whole-feed outage or the empty overnight feed (no fresh vehicle at all) drops nothing (the stale and
 * silent-service banners cover those); trip updates without a vehicle id are kept; a vehicle the app has not seen
 * since it started gets its clock at the first poll that lists its prediction (after a reload: a late drop, never an
 * early one). A dropped bus is back the moment it reports again.
 *
 * Contract:
 *   const { seen, gone } = goneStep(prevSeen, vehicles, trips, ctx);   // once per vehicle poll
 * vehicles = the feed's vehicle list as parsed (before core/operating.js, so ghosts count); `seen` is a plain object
 * vehicle id -> {t: latest report time, dt: time between its last two reports} that the caller keeps between polls
 * ({} at start; JSON-safe, never modified); `gone` = vehicle ids whose trip updates to drop, in trip-update order.
 */

/** A bus whose latest report is this much older than the feed has gone (s). */
export const GONE_S = 15 * 60;
/** The feed is alive while one of its vehicles reported within this of the feed time (s; core/operating.js STALE_S). */
export const FRESH_S = 300;
/** A bus whose last two reports came further apart than this reports too rarely to call it gone (s). */
export const SPARSE_S = 120;
/** A vehicle that has not reported for this long and is not predicted now is forgotten (s). */
export const KEEP_S = 6 * 3600;

/**
 * One vehicle poll: carry each vehicle's latest report time forward and say which buses have gone.
 * @param {Object<string, {t:number, dt:number, p?:1}>} prev the previous call's `seen` ({} at start); not modified
 * @param {Array<object>} vehicles the feed's vehicles (GTFS-rt VehiclePosition: vehicle.id, timestamp), ghosts included
 * @param {Array<object>} trips store.trips (GTFS-rt TripUpdate: vehicle.id)
 * @param {{feedTs?:number, nowS?:number}} [ctx] feedTs: the vehicle feed's time (Passio's clock), else nowS
 * @returns {{seen:Object<string, {t:number, dt:number, p?:1}>, gone:string[]}} seen[id]: t = its latest report time
 *   (or, with p, when the app first saw its prediction before any report), dt = the time between its last two reports
 *   (0 = not known yet)
 */
export function goneStep(prev, vehicles, trips, ctx = {}) {
  const ref = Number(ctx.feedTs) || Number(ctx.nowS) || 0;
  const predicted = new Set();
  for (const tu of trips || []) if (tu && tu.vehicle && tu.vehicle.id != null) predicted.add(String(tu.vehicle.id));
  const seen = {};
  for (const [id, e] of Object.entries(prev || {})) {
    if (e && Number.isFinite(e.t) && (ref - e.t <= KEEP_S || predicted.has(id))) seen[id] = e;   // a predicted bus keeps its clock
  }
  let alive = false;
  for (const b of vehicles || []) {
    const id = b && b.vehicle && b.vehicle.id != null ? String(b.vehicle.id) : null;
    const ts = Number(b && b.timestamp) || 0;
    if (!id || !ts) continue;
    const e = seen[id];
    if (!e || e.p) seen[id] = { t: ts, dt: 0 };
    else if (ts > e.t) seen[id] = { t: ts, dt: ts - e.t };
    if (ref - ts <= FRESH_S) alive = true;
  }
  const gone = [];
  if (!ref) return { seen, gone };
  for (const tu of trips || []) {
    const id = tu && tu.vehicle && tu.vehicle.id != null ? String(tu.vehicle.id) : null;
    if (!id) continue;
    const e = seen[id];
    if (!e) { seen[id] = { t: ref, dt: 0, p: 1 }; continue; }   // first sight of its prediction: its clock starts now
    if (alive && ref - e.t >= GONE_S && !(e.dt > SPARSE_S) && !gone.includes(id)) gone.push(id);
  }
  return { seen, gone };
}

/**
 * HELD (owner 2026-11-11: "Keep hidden bus times off until it reports again"; RouteKnower E32 offroute_then_silent): a
 * bus that a display rule hides (core/offroute.js, core/idle.js) and that then stops reporting leaves core/operating.js's
 * list 5 min after its last report, so the rules no longer see it; without this its Passio times came back on screen
 * until GONE (15 min after its last report, never for a sparse reporter): 1,555 bus-minutes Oct 10 to Nov 5, 174 Nov 6
 * to 10, mostly buses already at the garage. Now its trip updates stay dropped until it is operating again (a fresh
 * report) and no rule hides it. data/live.js runs it once per vehicle poll after the rules; iOS Kit Transition.held
 * (same rule).
 * @param {Object<string, {t:number}>} prev the previous call's `held` ({} at start; not modified)
 * @param {Array<object>} buses this poll's operating vehicles (core/operating.js), before any rule drops one
 * @param {Iterable<string>} hidden vehicle ids a display rule hides now
 * @param {Array<object>} trips store.trips (a held bus that is still predicted is never forgotten)
 * @param {{feedTs?:number, nowS?:number}} [ctx]
 * @returns {{held:Object<string, {t:number}>, ids:string[]}} held: every bus a rule hid (t = its report time then);
 *   ids: the held buses no rule hides now (not operating: their trip updates to drop too), in `prev` order
 */
export function heldStep(prev, buses, hidden, trips, ctx = {}) {
  const ref = Number(ctx.feedTs) || Number(ctx.nowS) || 0;
  const H = new Set([...(hidden || [])].map(String));
  const op = new Map();
  for (const b of buses || []) if (b && b.vehicle && b.vehicle.id != null) op.set(String(b.vehicle.id), b);
  const predicted = new Set();
  for (const tu of trips || []) if (tu && tu.vehicle && tu.vehicle.id != null) predicted.add(String(tu.vehicle.id));
  const held = {}, ids = [];
  for (const [id, e] of Object.entries(prev || {})) {
    if (H.has(id) || op.has(id) || !e || !Number.isFinite(e.t)) continue;      // hidden now (below), or reporting unhidden: released
    if (ref - e.t <= KEEP_S || predicted.has(id)) { held[id] = e; ids.push(id); }
  }
  for (const id of H) held[id] = { t: Number(op.get(id) && op.get(id).timestamp) || ref };
  return { held, ids };
}

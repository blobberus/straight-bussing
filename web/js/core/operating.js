/**
 * @module core/operating
 * Which vehicles in the live feed are actually in service. Owner rule (2026-10-08): a bus that is not
 * operating is not shown anywhere: not on the map, not in a route's station list, not in "N buses
 * running" counts, bus-near alerts or planner headways. data/live.js applies it before store.buses.
 * Pure logic, no DOM.
 *
 * A bus is operating when ALL hold:
 *  1. Fresh position: its last report is at most STALE_S older than the feed itself (feed clock, so a
 *     wrong phone clock cannot hide or show buses; a whole-feed outage is flagged by staleLevel instead).
 *     Passio keeps "ghost" vehicles hours after they stop reporting.
 *  2. Known route: its route_id is in the static network (unknown ids are garage moves or test units).
 *  3. In service: its route is scheduled right now (core/schedule.js isScheduledNow), OR its trip still
 *     has a live prediction for a stop it has not reached (finishing a late last trip). A bus on a route
 *     that is out of service with no predictions is heading to the garage or parked.
 * Before static data loads, only rule 1 applies (rules 2-3 need routes and the schedule).
 *
 * Silent service (rider safety, 2026-10-10): the feed can be fresh yet list no vehicle while the schedule
 * has routes in service (night routes after midnight). Either those buses run without sending GPS, or
 * service ended early; we cannot tell which, so views must not say "no shuttles running" / "not running"
 * then (scheduledRoutes, silentService, scheduledNoLive, silentText below).
 */
import { isScheduledNow, scheduledUntil, clock12 } from "./schedule.js";
import { liveUnknown } from "./arrivals.js";

/** Seconds after which a vehicle's last report means it is not operating. */
export const STALE_S = 300;
/** Grace (s) for a prediction that is just in the past (the bus is at that stop now). */
const PRED_GRACE_S = 60;

/**
 * Does the vehicle's trip still have a prediction at or after `ref`?
 * @param {object} bus vehicle (GTFS-rt VehiclePosition)
 * @param {Array<object>} trips store.trips
 * @param {number} ref unix seconds
 * @returns {boolean}
 */
function hasLivePrediction(bus, trips, ref) {
  const id = bus?.trip?.trip_id;
  if (!id) return false;
  for (const t of trips || []) {
    if (String(t?.trip?.trip_id) !== String(id)) continue;
    if (t.vehicle?.id != null && bus.vehicle?.id != null && String(t.vehicle.id) !== String(bus.vehicle.id)) continue;   // shared trip id, other bus
    for (const u of t.stop_time_update || []) {
      const at = Number(u?.arrival?.time || u?.departure?.time || 0);
      if (at && at >= ref - PRED_GRACE_S) return true;
    }
  }
  return false;
}

/**
 * Is this vehicle in service? See the module header for the three rules.
 * @param {object} bus vehicle from data/live.js parseBuses
 * @param {{routes?:object, service?:object, trips?:Array, feedTs?:number, nowS?:number, staticLoaded?:boolean}} ctx
 * @returns {boolean}
 */
export function isOperating(bus, ctx = {}) {
  if (!bus || !bus.position) return false;
  const ref = Number(ctx.feedTs) || Number(ctx.nowS) || 0;
  const ts = Number(bus.timestamp) || 0;
  if (ts && ref && ref - ts > STALE_S) return false;                 // 1. ghost / stopped reporting
  if (!ctx.staticLoaded) return true;
  const rid = bus.trip?.route_id;
  if (rid == null || !ctx.routes || !ctx.routes[rid]) return false;   // 2. not a route we know
  const scheduled = isScheduledNow(ctx.service || {}, String(rid), Number(ctx.nowS) || ref);
  if (scheduled !== false) return true;                               // 3. in service (or no schedule data)
  return hasLivePrediction(bus, ctx.trips, Number(ctx.nowS) || ref);  //    finishing a late trip
}

/**
 * The operating subset of a vehicle list (input order kept).
 * @param {Array<object>} buses
 * @param {Parameters<typeof isOperating>[1]} ctx
 * @returns {Array<object>}
 */
export function operatingBuses(buses, ctx) {
  return (buses || []).filter((b) => isOperating(b, ctx));
}

/**
 * Routes the schedule has in service at nowS, in data order. A route without schedule data does not
 * count (isScheduledNow null). [] before static data loads.
 * @param {{routes?:object, service?:object, staticLoaded?:boolean}} state
 * @param {number} nowS
 * @param {{hidden?:string[], among?:string[]|null}} [opts] drop `hidden`; keep only `among` (e.g. a stop's routes)
 * @returns {string[]}
 */
export function scheduledRoutes(state, nowS, { hidden = [], among = null } = {}) {
  if (!state || !state.staticLoaded) return [];
  const hid = new Set((hidden || []).map(String)), only = among ? new Set(among.map(String)) : null;
  return Object.keys(state.routes || {}).filter((rid) => !hid.has(rid) && (!only || only.has(rid))
    && isScheduledNow(state.service || {}, rid, nowS) === true);
}

/**
 * Silent service: the feed answered (not an outage, see core/arrivals.js liveUnknown) and no bus is
 * operating, yet at least one route (visible or not) is scheduled now. Never say "no shuttles running" then.
 * @param {object} state store state
 * @param {number} nowS
 * @returns {boolean}
 */
export function silentService(state, nowS) {
  return !!(state && state.liveLoaded) && !(state.buses || []).length && !liveUnknown(state, nowS)
    && scheduledRoutes(state, nowS).length > 0;
}

/**
 * Is the route scheduled now with no operating bus? Its status is then "Scheduled, no live location",
 * never "Not running". Callers check liveUnknown first (a feed outage has its own wording).
 * @param {object} state store state
 * @param {string} rid
 * @param {number} nowS
 * @returns {boolean}
 */
export function scheduledNoLive(state, rid, nowS) {
  if (!state || !state.staticLoaded) return false;
  if ((state.buses || []).some((b) => b && b.trip && String(b.trip.route_id) === String(rid))) return false;
  return isScheduledNow(state.service || {}, String(rid), nowS) === true;
}

/**
 * Route status line for a scheduled route with no operating bus, or null when scheduledNoLive is false.
 * @param {object} state store state
 * @param {string} rid
 * @param {number} nowS
 * @returns {string|null} 'Scheduled until 4:29 AM, no live location'
 */
export function noLiveStatus(state, rid, nowS) {
  if (!scheduledNoLive(state, rid, nowS)) return null;
  const end = scheduledUntil(state.service || {}, String(rid), nowS);
  return `Scheduled${end ? " until " + clock12(end) : ""}, no live location`;
}

const MAX_NAMED = 3;
const andList = (xs) => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);

/**
 * Plain-text explanation for silent service (views escape it; emptyState does): which of `rids` the
 * schedule has in service and until when (Chicago time, from service.json), that no bus is sending its
 * location, and the official phone. More than 3 routes are counted, not named; [] means only hidden
 * routes are scheduled.
 * @param {{routes?:object, service?:object}} state
 * @param {string[]} rids scheduled routes to name (the caller applies visibility)
 * @param {number} nowS
 * @param {string} [phone] official phone; omitted = no "Call ..." sentence
 * @returns {string} e.g. "The schedule shows the North and East routes in service until 4:29 AM and the
 *   South route until 4:25 AM, but no bus is sending its location, so we can't confirm they're running.
 *   Call 773.702.8181 before you rely on them."
 */
export function silentText(state, rids, nowS, phone) {
  const list = (rids || []).map(String), one = list.length === 1;
  let what;
  if (!list.length) what = "Some hidden routes are scheduled now";
  else if (list.length > MAX_NAMED) what = `The schedule shows ${list.length} routes in service now`;
  else {
    const groups = [];   // same end time -> one clause, first-seen order
    for (const rid of list) {
      const end = scheduledUntil(state && state.service, rid, nowS), until = end ? clock12(end) : "";
      let g = groups.find((x) => x.until === until);
      if (!g) groups.push((g = { until, names: [] }));
      const r = (state && state.routes && state.routes[rid]) || {};
      g.names.push(r.long || r.short || rid);
    }
    what = "The schedule shows " + andList(groups.map((g, i) => `the ${andList(g.names)} route${g.names.length > 1 ? "s" : ""}`
      + (i === 0 ? " in service" : "") + (g.until ? " until " + g.until : "")));
  }
  return `${what}, but no bus is sending its location, so we can't confirm ${one ? "it's" : "they're"} running.`
    + (phone ? ` Call ${phone} before you rely on ${one ? "it" : "them"}.` : "");
}

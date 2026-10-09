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
 */
import { isScheduledNow } from "./schedule.js";

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

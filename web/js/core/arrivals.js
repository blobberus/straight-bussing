/**
 * @module core/arrivals
 * Pure functions over live-state slices: upcoming arrivals, data staleness, running buses, alerts.
 */
import { nowS as currentS } from "./time.js";

/** Seconds since last successful poll after which data is an error. */
export const ERR_AFTER_S = 60;
/** Feed age (s) after which data counts as delayed. */
export const LATE_AFTER_S = 120;
/** Feed age (s) after which data counts as out of date. */
export const OLD_AFTER_S = 300;

/**
 * Upcoming live arrivals at a stop, sorted by time ascending.
 * Includes arrivals up to 30 s in the past (bus at the stop). A trip that lists the stop twice
 * (loop start/end) yields both times.
 * @param {{trips:Array}} state  state slice with GTFS-rt trip updates
 * @param {string} stopId
 * @param {{routeId?:string|null, hidden?:string[], nowS?:number}} [opts]
 *   routeId: only this route (hidden list is ignored then); hidden: route ids to exclude.
 * @returns {Array<{rid:string, t:number, bus:string|null, tripId:string|null, vehicleId:string|null}>}
 *   tripId alone is not unique: Passio gives several vehicles the same trip id (use tripId + vehicleId).
 */
export function arrivalsFor({ trips } = {}, stopId, { routeId = null, hidden = [], nowS } = {}) {
  const t0 = typeof nowS === "number" ? nowS : currentS();
  const hid = new Set((hidden || []).map(String));
  const want = String(stopId);
  const out = [];
  for (const tu of trips || []) {
    const rid = tu && tu.trip && tu.trip.route_id != null ? String(tu.trip.route_id) : null;
    if (!rid) continue;
    if (routeId != null ? rid !== String(routeId) : hid.has(rid)) continue;
    for (const u of tu.stop_time_update || []) {
      if (!u || String(u.stop_id) !== want) continue;
      const t = Number((u.arrival && u.arrival.time) || (u.departure && u.departure.time) || 0);
      if (t && isFinite(t) && t > t0 - 30) {
        out.push({ rid, t, bus: tu.vehicle && tu.vehicle.label != null ? String(tu.vehicle.label) : null,
          tripId: tu.trip.trip_id != null ? String(tu.trip.trip_id) : null, vehicleId: tu.vehicle && tu.vehicle.id != null ? String(tu.vehicle.id) : null });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t || (a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0));
}

/**
 * Freshness of live data.
 *  'err'  never succeeded, last success > 60 s ago, or the last poll failed
 *  'old'  feed timestamp > 300 s old
 *  'late' feed timestamp > 120 s old
 *  ''     fresh
 * @param {{lastOk:number, failed:boolean, feedTs:number}} state
 * @param {number} [nowS]
 * @returns {''|'late'|'old'|'err'}
 */
export function staleLevel({ lastOk, failed, feedTs } = {}, nowS) {
  const t0 = typeof nowS === "number" ? nowS : currentS();
  if (!lastOk || failed || t0 - lastOk > ERR_AFTER_S) return "err";
  if (feedTs && t0 - feedTs > OLD_AFTER_S) return "old";
  if (feedTs && t0 - feedTs > LATE_AFTER_S) return "late";
  return "";
}

/**
 * Nothing can be said about which shuttles run right now: the live feed is in error (never reached,
 * failing, or no good poll for > 60 s) and there are no last-known vehicles to show. A feed outage is
 * not a service outage, so views must then say the live status is unknown instead of "not running" /
 * "no shuttles running" (rider safety). False while the first poll is still pending (views show loading).
 * @param {{liveLoaded?:boolean, lastOk:number, failed:boolean, feedTs:number, buses?:Array}} state
 * @param {number} [nowS]
 * @returns {boolean}
 */
export function liveUnknown(state = {}, nowS) {
  return !!(state && state.liveLoaded) && !(state.buses || []).length && staleLevel(state, nowS) === "err";
}

/**
 * Number of vehicles currently reporting on a route.
 * @param {{buses:Array}} state
 * @param {string} rid
 * @returns {number}
 */
export function runningCount({ buses } = {}, rid) {
  let n = 0;
  const want = String(rid);
  for (const v of buses || []) if (v && v.trip && String(v.trip.route_id) === want) n++;
  return n;
}

/**
 * Alerts active at `nowS`: no active_period, or any period containing now (open ends allowed).
 * @param {{alerts:Array}} state
 * @param {number} [nowS]
 * @returns {Array} alerts (same objects)
 */
export function activeAlerts({ alerts } = {}, nowS) {
  const t0 = typeof nowS === "number" ? nowS : currentS();
  return (alerts || []).filter((a) => {
    if (!a) return false;
    const ps = a.active_period || [];
    if (!ps.length) return true;
    return ps.some((w) => w && (!w.start || Number(w.start) <= t0) && (!w.end || Number(w.end) >= t0));
  });
}

/**
 * Route ids an alert is about: each informed_entity route_id that is a route, or that exactly one route lists in its
 * alias_ids. Passio names a route in its alerts by its own internal id, which is the GTFS shape id of the route's
 * trips (the North alert of 2026-10-14 named 38734; North is 1075; tools/build_gtfs.py route_aliases; DC-009). An id
 * no route knows is left out, so such an alert counts as tied to no route and shows wherever untied alerts do (the
 * Alerts list shows every alert). Order kept, no repeats. iOS: Kit Arrivals.alertRouteIds.
 * @param {object} a alert (GTFS-rt)
 * @param {Object<string, {alias_ids?:string[]}>} [routes] state.routes
 * @returns {string[]}
 */
export function alertRouteIds(a, routes) {
  const R = routes || {}, own = (k) => Object.prototype.hasOwnProperty.call(R, k), out = [];
  let alias = null;
  for (const e of (a && Array.isArray(a.informed_entity) ? a.informed_entity : [])) {
    if (!e || e.route_id == null || e.route_id === "") continue;
    const id = String(e.route_id);
    let rid = own(id) ? id : null;
    if (!rid) {
      if (!alias) {   // alias -> route; an alias two routes list names neither
        alias = new Map();
        for (const [r, x] of Object.entries(R)) for (const s of Array.isArray(x?.alias_ids) ? x.alias_ids : []) {
          const k = String(s);
          alias.set(k, alias.has(k) && alias.get(k) !== r ? null : r);
        }
      }
      rid = alias.get(id) || null;
    }
    if (rid && !out.includes(rid)) out.push(rid);
  }
  return out;
}

/**
 * Plain text of a GTFS-rt TranslatedString (or a plain string). '' if missing.
 * Prefers English when several translations exist.
 * @param {*} field e.g. alert.header_text
 * @returns {string}
 */
export function alertText(field) {
  if (!field) return "";
  if (typeof field === "string") return field.trim();
  const tr = Array.isArray(field.translation) ? field.translation : [];
  const en = tr.find((x) => x && /^en/i.test(x.language || "")) || tr[0];
  return en && typeof en.text === "string" ? en.text.trim() : "";
}

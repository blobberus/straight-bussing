/**
 * @module core/idle
 * Buses that are idle and not in service (owner 2026-11-06: buses parked in front of Regenstein Library at 11:50 PM
 * still showed as moving buses; "avoid showing buses that are not active yet are idle", and do not suggest them).
 * Pure logic, no DOM. data/live.js applies it next to core/offroute.js (after core/operating.js), so the map, the
 * route pages, arrivals, counts, bus alerts, the planner and the trip view never show or offer such a bus. iOS: Kit
 * Idle.swift (same rules and numbers, golden cases from this file). Measured on 27 days of archived bus reports
 * (Oct 10 to Nov 5, 7,982 dwell episodes labeled in data/labeled/end_of_service/): RouteKnower.md E28 (scripts in
 * experiments/routeknower/E28-scripts), docs/ARCHITECTURE.md "Idle buses that are not in service".
 *
 * STILL: the bus's reports stay within STILL_M of its first report there (its clock starts at that report). The clock
 * restarts when a report is farther than STILL_M from that point, on a route change, or after GAP_S without a report.
 * A bus is HIDDEN while it is still and
 *   PARKED  still PARKED_S, whatever Passio predicts for it (parked for good: no layover or break lasted that long);
 *   IDLE    still IDLE_S and Passio predicts no stop for it at least FUTURE_S after its report (no normal layover lasted
 *           30 min; a predicted departure ahead keeps it shown);
 *   PAST    still LINGER_S and more than PAST_PAD_S outside its route's listed hours (core/operating.js keeps such a bus
 *           only for its live predictions, which Passio keeps giving parked buses);
 *   LINGER  still LINGER_S at a learned linger spot of its route after that spot's time (data/idle.json: a bus of the
 *           route still there after that time never served riders again in the data, e.g. North at Reynolds Club, the
 *           57th Street stop beside Regenstein, from 11:33 PM), only while today's listed hours of the route are the
 *           learned ones and before the file's valid_until.
 * Rider safety: only still buses are hidden; a hidden bus shows again at once when it moves more than STILL_M (or, for
 * IDLE, when Passio gives it a time ahead). Its trip updates are dropped with it (core/offroute.js dropHidden), so no
 * arrival time comes from a bus the map does not show. Nothing here claims a shift ended: the bus is just not shown.
 *
 * Contract:
 *   const { tracks, hidden, why } = idleStep(prevTracks, buses, ctx);   // once per vehicle poll; buses = operating ones
 * `tracks` is a plain object keyed by vehicle id that the caller keeps between polls ({} at start; JSON-safe, never
 * modified). The clocks and the time-of-day checks run on the buses' own report times (Passio's clock), never the
 * phone's; after a reload the clocks start again (a missed hide, never a wrong one).
 */
import { inListedHours } from "./offroute.js";
import { localParts, routeService, DAY_KEYS } from "./schedule.js";

/** A bus within this of where its clock started is still (m). */
export const STILL_M = 80;
/** Still this long with no Passio prediction FUTURE_S ahead = hidden (s). */
export const IDLE_S = 30 * 60;
/** Still this long = hidden, whatever Passio predicts (s). */
export const PARKED_S = 90 * 60;
/** Still this long outside the listed hours + PAST_PAD_S, or at a learned linger spot after its time = hidden (s). */
export const LINGER_S = 3 * 60;
/** Outside the route's listed hours by more than this (s). */
export const PAST_PAD_S = 60 * 60;
/** A prediction at least this far after the bus's report counts as "Passio expects it to move" (s). */
export const FUTURE_S = 120;
/** No report from the bus for longer than this restarts its clock (s). */
export const GAP_S = 600;
/** Radius of a learned linger spot when the file gives none (m). */
export const SPOT_R = 120;

const R = 6371000, RAD = Math.PI / 180;

/** Flat-earth meters between two points (exact within a few km). */
function distM(lat1, lon1, lat2, lon2) {
  const kx = R * RAD * Math.cos(((lat1 + lat2) / 2) * RAD);
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * R * RAD);
}

/** 'HH:MM' (may be >= 24:00) -> minutes, or NaN. */
function hm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? ""));
  return m ? +m[1] * 60 + +m[2] : NaN;
}

/**
 * The service-day clock of a unix time (Chicago; the night after midnight, before 04:00, belongs to the day before).
 * @param {number} t unix seconds
 * @returns {{min:number, iso:string, day:string, group:'weekday'|'sat'|'sun'}} min = minutes since that day's
 *   midnight (00:30 after midnight = 1470); iso = the service day's date; day = its service.json key
 */
export function serviceClock(t) {
  const p = localParts(t);
  const night = p.min < 240;
  const d = night ? localParts(t - 86400) : p;
  const day = DAY_KEYS[d.dow];
  const iso = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  return { min: night ? p.min + 1440 : p.min, iso, day, group: day === "sat" ? "sat" : day === "sun" ? "sun" : "weekday" };
}

/**
 * The route's listed hours on a service day as 'HH:MM-HH:MM' windows joined by ',' (a calendar exception for the
 * date replaces the weekday's hours). null without schedule data for the route.
 * @param {object} service store.service
 * @param {string} rid
 * @param {string} iso service day 'YYYY-MM-DD'
 * @param {string} day its key ('mon'..'sun')
 * @returns {string|null}
 */
export function hoursKey(service, rid, iso, day) {
  const r = routeService(service, String(rid));
  if (!r) return null;
  const exc = (r.exceptions || []).find((e) => e && e.date === iso);
  const d = exc ? exc.hours : r.days[day];
  if (!d || typeof d !== "object") return "";
  const spans = Array.isArray(d.spans) && d.spans.length ? d.spans : d.first && d.last ? [[d.first, d.last]] : [];
  return spans.filter((s) => Array.isArray(s) && s.length >= 2).map((s) => s[0] + "-" + s[1]).join(",");
}

/**
 * The learned linger spot of the route the bus is at, past that spot's time (data/idle.json), or null.
 * @param {{linger?:Array<object>, valid_until?:string}|null|undefined} idle store.idle
 * @param {object} service store.service (today's listed hours must be one of the entry's `hours`)
 * @param {string} rid
 * @param {number} lat
 * @param {number} lon
 * @param {number} t unix seconds (the bus's report time)
 * @returns {object|null} the matching entry
 */
export function lingerAt(idle, service, rid, lat, lon, t) {
  const list = idle && Array.isArray(idle.linger) ? idle.linger : null;
  if (!list || !list.length || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const c = serviceClock(t);
  if (idle.valid_until && c.iso > String(idle.valid_until)) return null;     // learned from an older timetable
  let key;
  for (const e of list) {
    if (!e || String(e.route) !== String(rid) || (e.days !== "daily" && e.days !== c.group)) continue;
    const after = hm(e.after);
    if (!Number.isFinite(after) || c.min < after) continue;
    const r = Number.isFinite(+e.r) && +e.r > 0 ? +e.r : SPOT_R;
    if (!(distM(lat, lon, +e.lat, +e.lon) <= r)) continue;
    if (!Array.isArray(e.hours) || !e.hours.length) continue;               // cannot check the timetable: never
    if (key === undefined) key = hoursKey(service, rid, c.iso, c.day);
    if (key == null || !e.hours.includes(key)) continue;
    return e;
  }
  return null;
}

/**
 * Does Passio predict a stop for this vehicle at least FUTURE_S after `t`? (Any trip update naming the vehicle: Passio
 * splits a bus's predictions over its current and next trip.)
 * @param {Array<object>} trips store.trips (GTFS-rt TripUpdate)
 * @param {string} id vehicle id
 * @param {number} t unix seconds
 * @returns {boolean}
 */
export function predictsAhead(trips, id, t) {
  for (const tu of trips || []) {
    if (!tu || !tu.vehicle || tu.vehicle.id == null || String(tu.vehicle.id) !== String(id)) continue;
    for (const u of tu.stop_time_update || []) {
      const at = Number((u && u.arrival && u.arrival.time) || (u && u.departure && u.departure.time) || 0);
      if (at && at >= t + FUTURE_S) return true;
    }
  }
  return false;
}

/**
 * One vehicle poll: carry each bus's still clock forward and say which buses are hidden.
 * @param {Object<string, {rid:string, lat:number, lon:number, since:number, last:number}>} tracks the previous call's
 *   tracks ({} at start); not modified
 * @param {Array<object>} buses operating vehicles (GTFS-rt VehiclePosition: vehicle.id, trip.route_id, position, timestamp)
 * @param {{trips?:Array, service?:object, idle?:object, nowS?:number, feedTs?:number}} ctx feedTs: the feed's time
 *   (report times fall back to it, then to nowS)
 * @returns {{tracks:object, hidden:string[], why:Object<string, 'parked'|'idle'|'past'|'linger'>}} hidden: vehicle ids
 *   in input order
 */
export function idleStep(tracks, buses, ctx = {}) {
  const prev = tracks || {}, next = {}, hidden = [], why = {}, seen = new Set();
  const ref = Number(ctx.feedTs) || Number(ctx.nowS) || 0;
  for (const b of buses || []) {
    const id = b && b.vehicle && b.vehicle.id != null ? String(b.vehicle.id) : null;
    const rid = b && b.trip && b.trip.route_id != null ? String(b.trip.route_id) : null;
    const lat = Number(b && b.position && b.position.latitude), lon = Number(b && b.position && b.position.longitude);
    if (!id) continue;
    seen.add(id);
    if (!rid || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const t = Number(b.timestamp) || ref;
    const p = prev[id];
    const cont = !!(p && p.rid === rid && t >= p.since && t - p.last <= GAP_S && distM(p.lat, p.lon, lat, lon) <= STILL_M);
    const tr = cont ? { rid, lat: p.lat, lon: p.lon, since: p.since, last: Math.max(p.last, t) } : { rid, lat, lon, since: t, last: t };
    next[id] = tr;
    const still = t - tr.since;
    if (still < LINGER_S) continue;
    let reason = null;
    if (still >= PARKED_S) reason = "parked";
    else if (still >= IDLE_S && !predictsAhead(ctx.trips, id, t)) reason = "idle";
    else if (inListedHours(ctx.service, rid, t, PAST_PAD_S) === false) reason = "past";
    else if (lingerAt(ctx.idle, ctx.service, rid, lat, lon, t)) reason = "linger";
    if (reason) { hidden.push(id); why[id] = reason; }
  }
  for (const [id, p] of Object.entries(prev)) {                                 // a bus missing from this poll keeps its clock
    if (!seen.has(id) && p && ref - p.last <= GAP_S) next[id] = p;
  }
  return { tracks: next, hidden, why };
}

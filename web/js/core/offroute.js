/**
 * @module core/offroute
 * Buses that are not following their route (owner 2026-11-04: "If buses are not following their routes for a long
 * period of time (measure this by the bus operation data and their listed hours), remove them from the map").
 * Pure logic, no DOM. data/live.js applies it after core/operating.js, so the map, the route pages ("Where the buses
 * are"), arrivals, counts, alerts and the planner never show such a bus. iOS: Kit OffRoute.swift (same rules and
 * numbers, golden cases from this file). Measured on 25 days of archived bus reports (Oct 10 to Nov 3, 4,355
 * bus-hours): RouteKnower.md E27 (scripts in experiments/routeknower/E27-scripts), docs/ARCHITECTURE.md "Buses that do not
 * follow their route".
 *
 * OFF the route: the report is farther than OFF_M from its route's line (store.shapes[rid], the drawn line) AND from
 * every other route's line (a bus filling in on another line, like the Apostolic bus on its 8 AM run to the 57th
 * Street Metra station, still follows a route). Its clock starts at the first such report and restarts when it comes
 * within OFF_M of any line, changes route, or sends nothing for GAP_S. The bus is HIDDEN once the clock reaches
 *   HIDE_IN_S  inside its route's listed hours (service.json, padded HOURS_PAD_S at both ends), or
 *   HIDE_OUT_S outside them (core/operating.js already hides those without a live prediction),
 * except (rider safety: a bus that serves riders must never be hidden; a missed hide costs little)
 *   - FOLLOWING: the closest points of its line have spread FOLLOW_M or more since the clock started: it drives along
 *     its route on another street (the Downtown Campus Connector off Lake Shore Drive: 2.5 km away for up to 32 min
 *     with riders on board), not to a garage;
 *   - RETURNING: it is RETURN_M or more closer to its line than its farthest point since the clock started (leaving
 *     the garage to start service, or coming back from a layover off the line);
 *   - DETOUR ALERT: inside the listed hours an operator alert is active that names its route, or names no route and
 *     reads like a detour (DETOUR_RE; the Oct 28 "Goldblatt Pavilion boarding" reroute named no route).
 * A hidden bus shows again at once when it comes within OFF_M of a line or an exception applies. Its trip updates are
 * dropped too (dropHidden): Passio kept predicting the buses that drove to the garage after service on Nov 2 (DC-022),
 * and an arrival time from a bus the map does not show would contradict the map.
 *
 * Contract (the experimental build ports this file as is):
 *   const { tracks, hidden } = offRouteStep(prevTracks, buses, ctx);   // once per vehicle poll; buses = operating ones
 *   const { buses, trips } = dropHidden(buses, trips, hidden);
 * `tracks` is a plain object keyed by vehicle id that the caller keeps between polls ({} at start; JSON-safe, never
 * modified). Before static data loads (no shapes) nothing is hidden. The clock runs on the buses' own report times, so
 * a wrong phone clock cannot hide a bus; after a reload the clock starts again (a missed hide, never a wrong one).
 */
import { isScheduledNow } from "./schedule.js";
import { activeAlerts, alertRouteIds, alertText } from "./arrivals.js";

/** A report farther than this from its route's line (and from every other line) is off the route (m). */
export const OFF_M = 300;
/** Off the route this long inside the listed hours (+ HOURS_PAD_S) = hidden (s). */
export const HIDE_IN_S = 15 * 60;
/** Off the route this long outside the listed hours = hidden (s). */
export const HIDE_OUT_S = 5 * 60;
/** The listed hours are padded this much at both ends (late trips, early pull-outs) (s). */
export const HOURS_PAD_S = 30 * 60;
/** The closest points of the line spread this far since the clock started = driving along the route elsewhere (m). */
export const FOLLOW_M = 1500;
/** This much closer to its line than its farthest point since the clock started = heading back (m). */
export const RETURN_M = 1000;
/** No report from the bus for longer than this restarts its clock (s). */
export const GAP_S = 600;
/** Operator alert text that reads like a detour (for alerts that name no route). */
export const DETOUR_RE = /detour|re-?rout|closed|closure|blocked|construction|bypass|not serv|will not stop|temporar/i;

const R = 6371000, RAD = Math.PI / 180;
const prepared = new WeakMap();

/** A route's lines as clean [lat, lon] arrays (cached per shapes[rid] array); null when none. */
function prep(lines) {
  if (!Array.isArray(lines)) return null;
  const hit = prepared.get(lines);
  if (hit !== undefined) return hit;
  const out = [];
  for (const line of lines) {
    if (!Array.isArray(line)) continue;
    const pts = [];
    for (const p of line) {
      const lat = Array.isArray(p) ? +p[0] : +p?.lat, lon = Array.isArray(p) ? +p[1] : +(p?.lon ?? p?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon]);
    }
    if (pts.length >= 2) out.push(pts);
  }
  const res = out.length ? out : null;
  prepared.set(lines, res);
  return res;
}

/**
 * The closest point of a route's lines to a position (flat-earth meters around the position: exact within a few km).
 * @param {Array<Array<[number, number]>>} lines shapes[rid]
 * @param {number} lat
 * @param {number} lon
 * @returns {{d:number, lat:number, lon:number}|null} null when the route has no line
 */
export function closestOnLine(lines, lat, lon) {
  const L = prep(lines);
  if (!L || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const kx = R * RAD * Math.cos(lat * RAD), ky = R * RAD;
  let best = null;
  for (const line of L) {
    for (let i = 1; i < line.length; i++) {
      const ax = (line[i - 1][1] - lon) * kx, ay = (line[i - 1][0] - lat) * ky;
      const bx = (line[i][1] - lon) * kx, by = (line[i][0] - lat) * ky;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      const qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(qx, qy);
      if (!best || d < best.d) best = { d, lat: lat + qy / ky, lon: lon + qx / kx };
    }
  }
  return best;
}

/**
 * Is the route inside its listed hours at t, padded `padS` at both ends? (service.json windows with calendar
 * exceptions, through core/schedule.js isScheduledNow, checked every 5 min across the padded span.)
 * @param {object} service store.service
 * @param {string} rid
 * @param {number} t unix seconds
 * @param {number} [padS]
 * @returns {boolean|null} null when the route has no schedule data
 */
export function inListedHours(service, rid, t, padS = HOURS_PAD_S) {
  const now = isScheduledNow(service || {}, String(rid), t);
  if (now !== false) return now;
  for (let k = 300; k <= padS; k += 300) {
    if (isScheduledNow(service, String(rid), t - k) || isScheduledNow(service, String(rid), t + k)) return true;
  }
  return false;
}

/**
 * Is an operator alert active at t that names the route (any text), or names no route and reads like a detour?
 * @param {Array<object>} alerts store.alerts (GTFS-rt)
 * @param {object} routes store.routes (alias_ids = Passio's own route ids, DC-009)
 * @param {string} rid
 * @param {number} t unix seconds
 * @returns {boolean}
 */
export function detourAlert(alerts, routes, rid, t) {
  for (const a of activeAlerts({ alerts }, t)) {
    const ids = alertRouteIds(a, routes);
    if (ids.length) { if (ids.includes(String(rid))) return true; continue; }
    if (DETOUR_RE.test(alertText(a.header_text) + " " + alertText(a.description_text))) return true;
  }
  return false;
}

/** Meters across a {s, n, w, e} lat/lon box. */
function spanM(b) {
  const kx = R * RAD * Math.cos(((b.s + b.n) / 2) * RAD);
  return Math.hypot((b.e - b.w) * kx, (b.n - b.s) * R * RAD);
}

/**
 * One vehicle poll: carry each bus's off-route clock forward and say which buses are hidden.
 * @param {Object<string, {rid:string, since:number, last:number, dmax:number, box:{s:number,n:number,w:number,e:number}}>} tracks
 *   the previous call's tracks ({} at start); not modified
 * @param {Array<object>} buses operating vehicles (GTFS-rt VehiclePosition: vehicle.id, trip.route_id, position, timestamp)
 * @param {{shapes?:object, service?:object, alerts?:Array, routes?:object, nowS?:number, feedTs?:number}} ctx
 *   nowS: the clock for listed hours and alerts (like core/operating.js); feedTs: the feed's time (report times fall
 *   back to it)
 * @returns {{tracks:object, hidden:string[]}} tracks: buses off the route now (and ones missing from this poll for up
 *   to GAP_S); hidden: vehicle ids in input order
 */
export function offRouteStep(tracks, buses, ctx = {}) {
  const prev = tracks || {}, next = {}, hidden = [], seen = new Set();
  const shapes = ctx.shapes || {};
  const ref = Number(ctx.feedTs) || Number(ctx.nowS) || 0;
  const now = Number(ctx.nowS) || ref;
  const rids = Object.keys(shapes);
  for (const b of buses || []) {
    const id = b && b.vehicle && b.vehicle.id != null ? String(b.vehicle.id) : null;
    const rid = b && b.trip && b.trip.route_id != null ? String(b.trip.route_id) : null;
    const lat = Number(b && b.position && b.position.latitude), lon = Number(b && b.position && b.position.longitude);
    if (!id) continue;
    seen.add(id);
    if (!rid || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const own = closestOnLine(shapes[rid], lat, lon);
    if (!own || own.d <= OFF_M) continue;                                      // no line known, or on its line
    if (rids.some((r) => r !== rid && (closestOnLine(shapes[r], lat, lon)?.d ?? Infinity) <= OFF_M)) continue;   // on another line
    const t = Number(b.timestamp) || ref;
    const p = prev[id];
    const cont = !!(p && p.rid === rid && t >= p.since && t - p.last <= GAP_S);
    const box = cont ? { s: Math.min(p.box.s, own.lat), n: Math.max(p.box.n, own.lat), w: Math.min(p.box.w, own.lon), e: Math.max(p.box.e, own.lon) }
      : { s: own.lat, n: own.lat, w: own.lon, e: own.lon };
    const tr = { rid, since: cont ? p.since : t, last: cont ? Math.max(p.last, t) : t, dmax: Math.max(cont ? p.dmax : 0, own.d), box };
    next[id] = tr;
    const inside = inListedHours(ctx.service, rid, now) !== false;            // no schedule data counts as inside (safer)
    if (t - tr.since < (inside ? HIDE_IN_S : HIDE_OUT_S)) continue;
    if (spanM(box) >= FOLLOW_M) continue;                                      // following its route on another street
    if (own.d <= tr.dmax - RETURN_M) continue;                                 // heading back to its line
    if (inside && detourAlert(ctx.alerts, ctx.routes, rid, now)) continue;
    hidden.push(id);
  }
  for (const [id, p] of Object.entries(prev)) {                                // a bus missing from this poll keeps its clock
    if (!seen.has(id) && p && ref - p.last <= GAP_S) next[id] = p;
  }
  return { tracks: next, hidden };
}

/**
 * The buses and trip updates without the hidden vehicles (trip updates matched by vehicle id only: Passio shares trip
 * ids between buses).
 * @param {Array<object>} buses
 * @param {Array<object>} trips
 * @param {Iterable<string>} hidden vehicle ids
 * @returns {{buses:Array<object>, trips:Array<object>}}
 */
export function dropHidden(buses, trips, hidden) {
  const h = new Set([...(hidden || [])].map(String));
  if (!h.size) return { buses: buses || [], trips: trips || [] };
  const vid = (x) => (x && x.vehicle && x.vehicle.id != null ? String(x.vehicle.id) : null);
  return { buses: (buses || []).filter((b) => !h.has(vid(b))), trips: (trips || []).filter((t) => !h.has(vid(t))) };
}

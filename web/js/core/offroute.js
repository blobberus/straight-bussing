/**
 * @module core/offroute
 * Buses more than a block off their route (owner 2026-11-06: "If a bus is off it's route for more than a block, make
 * the bus disappear from the map (so it does not confuse viewers of the route) as it is most likely not running
 * anymore--still continue to track the bus"; it replaced the 2026-11-04 rule, 300 m from every line for 15 min).
 * Pure logic, no DOM. data/live.js applies it after core/operating.js: a hidden bus leaves the map, the route pages
 * ("Where the buses are"), arrivals, counts, bus alerts and the planner, but its clock stays here and data/live.js
 * keeps it in store.away (the route page says "1 bus is away from the route and hidden from the map"), so it shows
 * again on its first report back within a block. iOS: Kit OffRoute.swift (same rules and numbers, golden cases from
 * this file). Measured on 27 days of archived bus reports (Oct 10 to Nov 5, 4,809 bus-hours): RouteKnower.md E27b
 * (experiments/routeknower/E27-scripts/block_rule.py), docs/ARCHITECTURE.md "Buses that do not follow their route".
 *
 * MORE THAN A BLOCK OFF: the report is farther than BLOCK_M from its OWN route's line (store.shapes[rid], the drawn
 * line): one Chicago block (1/8 mile, 201 m) plus the drawn line's offset from the lane the bus drives and GPS error
 * (about 50 m; parked jitter is up to about 16 m). A bus one street over stays shown; the Downtown Campus Connector's
 * downtown loop runs 125 to 300 m off its drawn line and would blink hundreds of times a month at 200 m. Its clock
 * starts at the first such report and restarts when a report is within BLOCK_M of its line, on a route change, or
 * after GAP_S without a report. HIDDEN once the clock reaches CONFIRM_S (reports come every 5 to 15 s, so that is at
 * least two reports and usually four or five: one bad GPS fix never hides a bus), except inside its route's listed
 * hours (padded HOURS_PAD_S) while an operator alert is active that names its route (any text, alias ids too) or names
 * no route and reads like a detour (DETOUR_RE; the standing "UGo Bus Route Assistance" alert does not match): an
 * official detour means the bus is serving riders.
 * Its trip updates are dropped with it (dropHidden): Passio keeps predicting buses that drive to the garage (DC-022),
 * and an arrival time from a bus the map does not show would contradict the map (E27b: in 85% of the minutes a hidden
 * bus had a Passio prediction, it logged no arrival in the next 10 min).
 *
 * Contract (the experimental build ports this file as is):
 *   const { tracks, hidden } = offRouteStep(prevTracks, buses, ctx);   // once per vehicle poll; buses = operating ones
 *   const { buses, trips } = dropHidden(buses, trips, hidden);
 *   store.away = awayBuses(buses, hidden);                              // still tracked: the route page counts them
 * `tracks` is a plain object keyed by vehicle id that the caller keeps between polls ({} at start; JSON-safe, never
 * modified). Before static data loads (no shapes) nothing is hidden. The clock runs on the buses' own report times, so
 * a wrong phone clock cannot hide a bus; after a reload the clock starts again (a hide CONFIRM_S late, never a wrong one).
 */
import { isScheduledNow } from "./schedule.js";
import { activeAlerts, alertRouteIds, alertText } from "./arrivals.js";

/** A report farther than this from its own route's line is more than a block off the route (m). */
export const BLOCK_M = 250;
/** More than a block off for this long (from its first such report, on the bus's own report times) = hidden (s). */
export const CONFIRM_S = 45;
/** The listed hours are padded this much at both ends for the detour alert exemption (late trips, early pull-outs) (s). */
export const HOURS_PAD_S = 30 * 60;
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

/**
 * One vehicle poll: carry each bus's clock forward and say which buses are hidden.
 * @param {Object<string, {rid:string, since:number, last:number, n:number}>} tracks the previous call's tracks ({} at
 *   start; not modified). n = the bus's distinct reports more than a block off since the clock started.
 * @param {Array<object>} buses operating vehicles (GTFS-rt VehiclePosition: vehicle.id, trip.route_id, position, timestamp)
 * @param {{shapes?:object, service?:object, alerts?:Array, routes?:object, nowS?:number, feedTs?:number}} ctx
 *   nowS: the clock for listed hours and alerts (like core/operating.js); feedTs: the feed's time (report times fall
 *   back to it)
 * @returns {{tracks:object, hidden:string[]}} tracks: buses more than a block off now (and ones missing from this poll
 *   for up to GAP_S); hidden: vehicle ids in input order
 */
export function offRouteStep(tracks, buses, ctx = {}) {
  const prev = tracks || {}, next = {}, hidden = [], seen = new Set();
  const shapes = ctx.shapes || {};
  const ref = Number(ctx.feedTs) || Number(ctx.nowS) || 0;
  const now = Number(ctx.nowS) || ref;
  for (const b of buses || []) {
    const id = b && b.vehicle && b.vehicle.id != null ? String(b.vehicle.id) : null;
    const rid = b && b.trip && b.trip.route_id != null ? String(b.trip.route_id) : null;
    const lat = Number(b && b.position && b.position.latitude), lon = Number(b && b.position && b.position.longitude);
    if (!id) continue;
    seen.add(id);
    if (!rid || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const own = closestOnLine(shapes[rid], lat, lon);
    if (!own || own.d <= BLOCK_M) continue;                                    // no line known, or within a block of it
    const t = Number(b.timestamp) || ref;
    const p = prev[id];
    const cont = !!(p && p.rid === rid && t >= p.since && t - p.last <= GAP_S);
    const tr = cont ? { rid, since: p.since, last: Math.max(p.last, t), n: (p.n || 1) + (t > p.last ? 1 : 0) } : { rid, since: t, last: t, n: 1 };
    next[id] = tr;
    if (tr.n < 2 || t - tr.since < CONFIRM_S) continue;                       // one bad fix never hides a bus
    if (inListedHours(ctx.service, rid, now) !== false && detourAlert(ctx.alerts, ctx.routes, rid, now)) continue;   // an official detour: serving
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

/**
 * The buses offRouteStep hid, kept for the route page (data/live.js store.away): still tracked, not shown.
 * @param {Array<object>} buses operating vehicles of this poll
 * @param {Iterable<string>} hidden vehicle ids offRouteStep hid
 * @returns {Array<object>} those vehicles, input order
 */
export function awayBuses(buses, hidden) {
  const h = new Set([...(hidden || [])].map(String));
  if (!h.size) return [];
  return (buses || []).filter((b) => b && b.vehicle && b.vehicle.id != null && h.has(String(b.vehicle.id)));
}

/**
 * How many of a route's buses are more than a block off it and hidden (store.away).
 * @param {Array<object>} away store.away
 * @param {string} rid
 * @returns {number}
 */
export function awayCount(away, rid) {
  return (away || []).filter((b) => b && b.trip && String(b.trip.route_id) === String(rid)).length;
}

/**
 * The route page's line for buses hidden here (iOS Kit RouteText.awayText, same words; the view escapes it).
 * @param {number} n awayCount
 * @returns {string} "" for none, "1 bus is away from the route and hidden from the map.", "2 buses are away from ..."
 */
export function awayText(n) {
  if (!(n > 0)) return "";
  return `${n === 1 ? "1 bus is" : `${n} buses are`} away from the route and hidden from the map.`;
}

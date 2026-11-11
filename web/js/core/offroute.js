/**
 * @module core/offroute
 * Buses that do not follow their route (owner 2026-11-06: "If a bus is off it's route for more than a block, make the
 * bus disappear from the map (so it does not confuse viewers of the route) as it is most likely not running
 * anymore--still continue to track the bus"; 2026-11-07: "the buses that are not driving on their designated routes
 * are still showing sometimes (for example, the downtown connector still shows even if its not on its route)").
 * Pure logic, no DOM. data/live.js applies it after core/operating.js: a hidden bus leaves the map, the route pages
 * ("Where the buses are"), arrivals, counts, bus alerts and the planner, but its clock stays here and data/live.js
 * keeps it in store.away (the route page says "1 bus is away from the route and hidden from the map"), so it shows
 * again on its first report back. iOS: Kit OffRoute.swift (same rules and numbers, golden cases from this file).
 * Measured on 28 days of archived bus reports (Oct 10 to Nov 6): RouteKnower.md E27b and E27c
 * (experiments/routeknower/E27-scripts/block_rule.py, corridor.py), docs/ARCHITECTURE.md "Buses that do not follow
 * their route".
 *
 * WHERE THE ROUTE IS: its drawn line (store.shapes[rid]) and, where that line is off, the streets its buses really drive
 * (store.corridors = web/data/corridors.json, E27c): centers of 25 m cells driven in service on most days, 80 to 400 m
 * from the drawn line (the Downtown Campus Connector's line takes Van Buren while every bus takes Adams and Clinton at
 * Union Station, 125 to 340 m off). A route's corridor is used only while its drawn line is the one it was learned
 * against (points and length, corridorFor) and before the file's valid_until; otherwise the route has its drawn line
 * only and no NEAR tier (the E27b rule). The distance of a report = to the line or a corridor point, whichever is nearer.
 * The clocks run on the bus's own report times (never the phone's) and restart on a route change or after GAP_S
 * without a report. A bus is HIDDEN when
 *   FAR   farther than BLOCK_M for CONFIRM_S on at least two distinct reports (E27b; one bad GPS fix never hides it),
 *   FAST  farther than FAST_M on two distinct reports in a row (a bus at the garage after a reload or an app start goes
 *         in 10 to 15 s instead of 45 s; a single far fix still never hides a bus), or
 *   NEAR  (routes with a usable corridor only) farther than NEAR_M for NEAR_S on at least two distinct reports: a street
 *         over for 2 minutes (parked on 60th Street, inside the campus, on a garage road), while a bus cutting through
 *         a block stays shown;
 * except inside its route's listed hours (padded HOURS_PAD_S) while an operator alert is active that names its route
 * (any text, alias ids too) or names no route and reads like a detour (DETOUR_RE; the standing "UGo Bus Route
 * Assistance" alert does not match), and only while the bus is within DETOUR_MAX_M of its route: an official detour
 * means the bus is serving riders, a bus 4 to 11 km away is not (the Oct 28 Goldblatt reroute alert had kept garage
 * runs of five routes shown; the Downtown Campus Connector's Lake Shore Drive detours ran up to 2.5 km off). Back within NEAR_M (BLOCK_M without a corridor) = shown on that report.
 * Its trip updates are dropped with it (dropHidden): Passio keeps predicting buses that drive to the garage (DC-022),
 * and an arrival time from a bus the map does not show would contradict the map (E27b: in 85% of the minutes a hidden
 * bus had a Passio prediction, it logged no arrival in the next 10 min).
 *
 * Contract (the experimental build ports this file as is):
 *   const { tracks, hidden } = offRouteStep(prevTracks, buses, ctx);   // once per vehicle poll; buses = operating ones
 *   const { buses, trips } = dropHidden(buses, trips, hidden);
 *   store.away = awayBuses(buses, hidden);                              // still tracked: the route page counts them
 * `tracks` is a plain object keyed by vehicle id that the caller keeps between polls ({} at start; JSON-safe, never
 * modified). Before static data loads (no shapes) nothing is hidden; without corridors.json every route keeps the
 * E27b rule (plus FAST). After a reload the clocks start again (a hide CONFIRM_S or NEAR_S late, or at the second report
 * beyond FAST_M; never a wrong one).
 */
import { isScheduledNow, localParts } from "./schedule.js";
import { activeAlerts, alertRouteIds, alertText } from "./arrivals.js";
import { transitionAt, TRANSITION_MAX_M, TOWARD_M } from "./seen.js";

/** A report farther than this from its route (line or corridor) is more than a block off (m): the FAR tier. */
export const BLOCK_M = 250;
/** More than a block off for this long (from its first such report, on the bus's own report times) = hidden (s). */
export const CONFIRM_S = 45;
/** Two distinct reports in a row farther than this from the route = hidden at once (m): the FAST tier. */
export const FAST_M = 500;
/** Routes with a usable corridor: farther than this from the line and the corridor ... (m): the NEAR tier. */
export const NEAR_M = 120;
/** ... for this long (on at least two distinct reports) = hidden (s). */
export const NEAR_S = 120;
/** The listed hours are padded this much at both ends for the detour alert exemption (late trips, early pull-outs) (s). */
export const HOURS_PAD_S = 30 * 60;
/** No report from the bus for longer than this restarts its clock (s). */
export const GAP_S = 600;
/** The detour alert exemption holds only this close to the route (m): the Downtown Campus Connector's Lake Shore Drive
 * detours ran up to 2.5 km off; the Oct 28 reroute alert had kept buses 4 to 11 km away (garage runs) shown. */
export const DETOUR_MAX_M = 3000;
/** A route's line matches its corridor's when the point counts are equal and the lengths within this share (or 25 m). */
export const SHAPE_TOL = 0.01;
/** Operator alert text that reads like a detour (for alerts that name no route). */
export const DETOUR_RE = /detour|re-?rout|closed|closure|blocked|construction|bypass|not serv|will not stop|temporar/i;

const R = 6371000, RAD = Math.PI / 180;
const prepared = new WeakMap();
const sigs = new WeakMap();

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
 * The signature of a route's drawn line that corridors.json stores (corridor.py shape_sig): its points (every entry of
 * every line) and its length in meters (haversine, rounded). Cached per shapes[rid] array.
 * @param {Array<Array<[number, number]>>} lines shapes[rid]
 * @returns {{n:number, m:number}}
 */
export function shapeSig(lines) {
  if (!Array.isArray(lines)) return { n: 0, m: 0 };
  const hit = sigs.get(lines);
  if (hit) return hit;
  let n = 0, m = 0;
  for (const line of lines) {
    if (!Array.isArray(line)) continue;
    n += line.length;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const p1 = +a[0] * RAD, p2 = +b[0] * RAD, dl = (+b[1] - +a[1]) * RAD;
      const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
      if (Number.isFinite(h)) m += 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
    }
  }
  const res = { n, m: Math.round(m) };
  sigs.set(lines, res);
  return res;
}

/**
 * The learned corridor points of a route, when they can be used: the file is not past valid_until (the Chicago date of
 * t), it lists the route, and the route's drawn line still matches the one they were learned against.
 * @param {{valid_until?:string, routes?:object}|null|undefined} corridors store.corridors (data/static.js cleans it)
 * @param {object} shapes store.shapes
 * @param {string} rid
 * @param {number} t unix seconds
 * @returns {Array<[number, number]>|null} the points (may be empty: learned, nothing off the line); null = no corridor
 *   (the route keeps its drawn line only and no NEAR tier)
 */
export function corridorFor(corridors, shapes, rid, t) {
  const e = corridors && corridors.routes ? corridors.routes[String(rid)] : null;
  if (!e || !Array.isArray(e.pts) || !e.shape) return null;
  if (corridors.valid_until) {
    const p = localParts(Number(t) || 0);
    const iso = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    if (iso > String(corridors.valid_until)) return null;                     // learned from an older timetable
  }
  const sig = shapeSig(shapes && shapes[String(rid)]);
  const n = Number(e.shape.n), m = Number(e.shape.m);
  if (!sig.n || sig.n !== n || !(Math.abs(sig.m - m) <= Math.max(25, SHAPE_TOL * m))) return null;   // the line changed
  return e.pts;
}

/**
 * Distance to the nearest of a corridor's points (flat-earth meters around the position).
 * @param {Array<[number, number]>|null} pts
 * @param {number} lat
 * @param {number} lon
 * @returns {number} Infinity when there are none
 */
export function nearestPoint(pts, lat, lon) {
  if (!Array.isArray(pts) || !pts.length || !Number.isFinite(lat) || !Number.isFinite(lon)) return Infinity;
  const kx = R * RAD * Math.cos(lat * RAD), ky = R * RAD;
  let best = Infinity;
  for (const p of pts) {
    const dx = (+p[1] - lon) * kx, dy = (+p[0] - lat) * ky, d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * How far a report is from its route: to the drawn line or a corridor point, whichever is nearer.
 * @param {Array<Array<[number, number]>>} lines shapes[rid]
 * @param {Array<[number, number]>|null} pts corridorFor(...)
 * @param {number} lat
 * @param {number} lon
 * @returns {number|null} meters; null when the route has no line
 */
export function offDistance(lines, pts, lat, lon) {
  const own = closestOnLine(lines, lat, lon);
  if (!own) return null;
  return own.d <= NEAR_M ? own.d : Math.min(own.d, nearestPoint(pts, lat, lon));
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
 * One vehicle poll: carry each bus's clocks forward and say which buses are hidden.
 * @param {Object<string, {rid:string, since:number, last:number, n:number, fs:number|null, fn:number, ff:number}>} tracks
 *   the previous call's tracks ({} at start; not modified). since / n = the current stretch off the route (farther
 *   than NEAR_M with a corridor, BLOCK_M without) and its distinct reports; fs / fn = the same for farther than BLOCK_M
 *   (null / 0 when nearer); ff = distinct reports in a row farther than FAST_M; dx = its farthest distance in the stretch
 *   (m; core/seen.js TOWARD_M).
 * @param {Array<object>} buses operating vehicles (GTFS-rt VehiclePosition: vehicle.id, trip.route_id, position, timestamp)
 * @param {{shapes?:object, corridors?:object, service?:object, alerts?:Array, routes?:object, seen?:object, nowS?:number, feedTs?:number}} ctx
 *   nowS: the clock for listed hours, alerts and the corridor file's date (like core/operating.js); feedTs: the feed's
 *   time (report times fall back to it); seen: store.serviceSeen (core/seen.js transition windows)
 * @returns {{tracks:object, hidden:string[], transitioning:string[]}} tracks: buses off their route now (and ones missing
 *   from this poll for up to GAP_S); hidden: vehicle ids in input order; transitioning: the buses the rule would hide that
 *   stay shown because their report time is inside a transition window of their line (owner 2026-11-11), input order
 */
export function offRouteStep(tracks, buses, ctx = {}) {
  const prev = tracks || {}, next = {}, hidden = [], transitioning = [], seen = new Set();
  const shapes = ctx.shapes || {};
  const ref = Number(ctx.feedTs) || Number(ctx.nowS) || 0;
  const now = Number(ctx.nowS) || ref;
  const corr = new Map();                                                      // rid -> corridorFor (once per poll)
  for (const b of buses || []) {
    const id = b && b.vehicle && b.vehicle.id != null ? String(b.vehicle.id) : null;
    const rid = b && b.trip && b.trip.route_id != null ? String(b.trip.route_id) : null;
    const lat = Number(b && b.position && b.position.latitude), lon = Number(b && b.position && b.position.longitude);
    if (!id) continue;
    seen.add(id);
    if (!rid || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!corr.has(rid)) corr.set(rid, corridorFor(ctx.corridors, shapes, rid, now));
    const pts = corr.get(rid);
    const d = offDistance(shapes[rid], pts, lat, lon);
    if (d == null || d <= (pts ? NEAR_M : BLOCK_M)) continue;                 // no line known, or on its route
    const t = Number(b.timestamp) || ref;
    const p = prev[id];
    const cont = !!(p && p.rid === rid && t >= p.since && t - p.last <= GAP_S);
    const fresh = !cont || t > p.last;                                         // a new report (not the same one repeated)
    const far = d > BLOCK_M;
    const tr = cont
      ? { rid, since: p.since, last: Math.max(p.last, t), n: (p.n || 1) + (fresh ? 1 : 0), fs: null, fn: 0, ff: 0, dx: Math.max(p.dx || 0, d) }
      : { rid, since: t, last: t, n: 1, fs: null, fn: 0, ff: 0, dx: d };
    if (far) {
      const fcont = cont && p.fs != null && t >= p.fs;
      tr.fs = fcont ? p.fs : t;
      tr.fn = fcont ? (p.fn || 1) + (fresh ? 1 : 0) : 1;
    }
    if (d > FAST_M) tr.ff = cont ? Math.max(1, (p.ff || 0) + (fresh ? 1 : 0)) : 1;
    next[id] = tr;
    const hide = (tr.fn >= 2 && t - tr.fs >= CONFIRM_S)                        // FAR: one bad fix never hides a bus
      || tr.ff >= 2                                                            // FAST
      || (pts != null && tr.n >= 2 && t - tr.since >= NEAR_S);                 // NEAR
    if (!hide) continue;
    if (d <= DETOUR_MAX_M && inListedHours(ctx.service, rid, now) !== false && detourAlert(ctx.alerts, ctx.routes, rid, now)) continue;   // an official detour: serving
    if (ctx.seen && d <= TRANSITION_MAX_M && (!(TOWARD_M > 0) || d < tr.dx - TOWARD_M) && transitionAt(ctx.seen, ctx.service, rid, t)) {
      transitioning.push(id);                                                  // on its way to a new line: shown, marked
      continue;
    }
    hidden.push(id);
  }
  for (const [id, p] of Object.entries(prev)) {                                // a bus missing from this poll keeps its clock
    if (!seen.has(id) && p && ref - p.last <= GAP_S) next[id] = p;
  }
  return { tracks: next, hidden, transitioning };
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
 * How many of a route's buses are off it and hidden (store.away).
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

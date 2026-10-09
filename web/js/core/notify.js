/**
 * @module core/notify
 * "Notify me when my bus is near <station>": pure logic over store state, no DOM, no timers.
 * Shared by the web notifier (ui/notifier.js) and, later, the iPhone app's native layer (Live
 * Activity + local notifications), so it only reads plain state slices.
 *
 * Stops away = how many route stops the bus still has to reach before your station: 0 = your
 * station is the bus's next stop, 1 = one stop before yours, 2 = two stops before. The bus's next
 * stop is the vehicle's live stop_id, else the first upcoming stop in its trip update. Minutes come
 * only from the live trip update at your station (never invented); every text says "est.".
 */
import { staleLevel } from "./arrivals.js";
import { effectiveHidden } from "./visibility.js";

/** A vehicle report older than this (s) is ignored. */
export const BUS_STALE_S = 180;
const FIRED_MAX = 400;

/**
 * Route order without a loop's repeated last stop.
 * @param {string[]} list
 * @returns {{order:string[], loop:boolean}}
 */
export function routeOrder(list) {
  const l = (list || []).map(String);
  const loop = l.length > 2 && l[0] === l[l.length - 1];
  return { order: loop ? l.slice(0, -1) : l, loop };
}

/** The bus's own trip update: Passio reuses one trip id for several buses, so trip AND vehicle must match. */
function tripFor(trips, bus) {
  const tid = bus?.trip?.trip_id, vid = bus?.vehicle?.id, T = trips || [];
  const isTrip = (t) => tid != null && String(t?.trip?.trip_id) === String(tid), isVeh = (t) => vid != null && String(t?.vehicle?.id) === String(vid);
  const byTrip = T.filter(isTrip);
  return byTrip.find(isVeh) || ((vid == null || byTrip.length === 1) && byTrip[0]) || T.find(isVeh) || null;
}

function timeOf(u) {
  const t = Number((u?.arrival && u.arrival.time) || (u?.departure && u.departure.time) || 0);
  return t && isFinite(t) ? t : 0;
}

/** First upcoming stop in a trip update (earliest time > now-30). */
function nextFromTrip(tu, now) {
  let best = null;
  for (const u of tu?.stop_time_update || []) {
    const t = timeOf(u);
    if (t && t > now - 30 && u.stop_id != null && (!best || t < best.t)) best = { id: String(u.stop_id), t };
  }
  return best ? best.id : null;
}

/** Live predicted arrival at stopId for this trip (earliest upcoming), or null. */
function etaAt(tu, stopId, now) {
  let best = null;
  for (const u of tu?.stop_time_update || []) {
    const t = timeOf(u);
    if (t && t > now - 30 && String(u.stop_id) === stopId && (best === null || t < best)) best = t;
  }
  return best;
}

/**
 * Every live bus heading to `stopId` and how far away it is, nearest first.
 * @param {{buses?:Array, trips?:Array, routeStops?:object, stopRoutes?:object, stops?:object}} state
 * @param {string} stopId
 * @param {string|string[]|null} [rid] only this route (or these routes); default every route serving the stop
 * @param {number} [now] unix seconds (default Date.now)
 * @returns {Array<{rid:string, tripId:string|null, vehicleId:string|null, label:string, stopsAway:number, etaS:number|null, nextStopId:string, nextStopName:string}>}
 */
export function stopsAway(state, stopId, rid = null, now = Date.now() / 1000) {
  const want = String(stopId);
  const only = rid == null ? null : new Set((Array.isArray(rid) ? rid : [rid]).map(String));
  const out = [];
  for (const b of state?.buses || []) {
    const r = b?.trip?.route_id != null ? String(b.trip.route_id) : null;
    if (!r || (only && !only.has(r))) continue;
    if (b.timestamp && now - Number(b.timestamp) > BUS_STALE_S) continue;
    const { order, loop } = routeOrder(state.routeStops?.[r]);
    const j = order.indexOf(want);
    if (j < 0) continue;
    const tu = tripFor(state.trips, b);
    const next = b.stop_id != null && order.includes(String(b.stop_id)) ? String(b.stop_id) : nextFromTrip(tu, now);
    const i = next == null ? -1 : order.indexOf(next);
    if (i < 0) continue;
    let away = j - i;
    if (away < 0) {
      if (!loop) continue;               // already past your station on a one-way route
      away += order.length;
    }
    out.push({ rid: r, tripId: b.trip.trip_id != null ? String(b.trip.trip_id) : null,
      vehicleId: b.vehicle?.id != null ? String(b.vehicle.id) : null, label: String(b.vehicle?.label ?? b.vehicle?.id ?? ""),
      stopsAway: away, etaS: etaAt(tu, want, now), nextStopId: next, nextStopName: state.stops?.[next]?.name || next });
  }
  return out.sort((a, b) => a.stopsAway - b.stopsAway || (a.etaS ?? Infinity) - (b.etaS ?? Infinity));
}

/**
 * Routes the notification watches: the user's chosen ones serving the station, else every visible
 * route serving it.
 * @param {object} state
 * @returns {string[]}
 */
export function watchedRoutes(state) {
  const n = state?.notify, sid = n?.stopId;
  if (!sid) return [];
  const serve = (state.stopRoutes?.[sid] || []).map(String);
  const chosen = (n.rids || []).map(String).filter((r) => serve.includes(r));
  if (chosen.length) return chosen;
  const hidden = new Set(effectiveHidden(state));
  return serve.filter((r) => !hidden.has(r));
}

/**
 * "about 4 min (est.)" / "under a minute (est.)" / '' when there is no live time.
 * @param {number|null} etaS
 * @param {number} now
 * @returns {string}
 */
export function minutesText(etaS, now) {
  if (!etaS) return "";
  const m = Math.floor((etaS - now) / 60);
  return m < 1 ? "under a minute (est.)" : `about ${m} min (est.)`;
}

function routeName(state, rid) {
  const r = state.routes?.[rid] || {};
  return r.long || r.short || "Shuttle";
}

function alertFor(state, it, kind, now, late) {
  const stop = state.stops?.[state.notify.stopId]?.name || "your station";
  const when = minutesText(it.etaS, now);
  const head = kind === "minutes" ? (when ? `arriving in ${when}` : "arriving soon")
    : it.stopsAway === 0 ? "your stop is next" : it.stopsAway === 1 ? "1 stop away" : `${it.stopsAway} stops away`;
  const bus = it.label ? `Bus ${it.label}` : "The bus";
  let body = `${bus} to ${stop}. Next stop: ${it.nextStopName}.`;
  if (kind !== "minutes" && when) body += ` Arrives in ${when}.`;
  if (late) body += " Live data is delayed.";
  return { key: `${state.notify.stopId}|${it.tripId || ""}|${it.vehicleId || ""}|${kind}`, kind,   // trip ids are shared by several buses
    title: `${routeName(state, it.rid)}: ${head}`, body };
}

/**
 * Alerts that should fire now (each trip + kind once). No alerts while live data is down or old.
 * @param {object} state store state (needs notify, buses, trips, routeStops, stopRoutes, stops, routes, feed fields)
 * @param {Set<string>} prevFired keys already fired
 * @param {number} now unix seconds
 * @returns {{alerts:Array<{key:string, kind:'twoStops'|'oneStop'|'minutes', title:string, body:string}>, fired:Set<string>}}
 */
export function dueAlerts(state, prevFired, now) {
  const fired = new Set(prevFired || []);
  const n = state?.notify;
  if (!n || !n.stopId) return { alerts: [], fired };
  const level = staleLevel(state, now);
  if (level === "err" || level === "old") return { alerts: [], fired };
  const rids = watchedRoutes(state);
  if (!rids.length) return { alerts: [], fired };
  const alerts = [];
  for (const it of stopsAway(state, n.stopId, rids, now)) {
    const kinds = [];
    if (n.oneStop && it.stopsAway <= 1) kinds.push("oneStop");
    else if (n.twoStops && it.stopsAway === 2) kinds.push("twoStops");
    if (n.minutes > 0 && it.etaS && it.etaS - now <= n.minutes * 60) kinds.push("minutes");
    for (const k of kinds) {
      const a = alertFor(state, it, k, now, level === "late");
      if (fired.has(a.key)) continue;
      if (k === "twoStops" && fired.has(a.key.replace(/twoStops$/, "oneStop"))) continue;
      fired.add(a.key);
      alerts.push(a);
    }
  }
  if (fired.size > FIRED_MAX) return { alerts, fired: new Set([...fired].slice(-FIRED_MAX)) };
  return { alerts, fired };
}

/**
 * What a lock-screen Live Activity would show for the watched station: the nearest bus.
 * @param {object} state
 * @param {number} now
 * @returns {{title:string, minutes:number|null, nextStop:string, stopsAway:number, rid:string, estimate:true}|null}
 */
export function liveStatus(state, now) {
  const n = state?.notify;
  if (!n || !n.stopId) return null;
  const level = staleLevel(state, now);
  if (level === "err" || level === "old") return null;
  const it = stopsAway(state, n.stopId, watchedRoutes(state), now)[0];
  if (!it) return null;
  const stop = state.stops?.[n.stopId]?.name || "your station";
  return { title: `${routeName(state, it.rid)} to ${stop}`, rid: it.rid, stopsAway: it.stopsAway, nextStop: it.nextStopName,
    minutes: it.etaS ? Math.max(0, Math.floor((it.etaS - now) / 60)) : null, estimate: true };
}

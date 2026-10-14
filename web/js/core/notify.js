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
 *
 * Trip alerts (2026-10-13, owner: in step with the map's "get off in X stops"): while a started trip is on,
 * tripAlerts reads the SAME tripProgress result as the Current trip card and the map (core/tripprogress.js
 * tripNow) and alerts before your bus comes (2 / 1 stops, N min) and before you get off (2 stops, next stop);
 * station alerts pause meanwhile. When live data goes down, ONE "Live data delayed" alert per outage instead of
 * silence (conversion to appstore.md section 7).
 */
import { staleLevel, ERR_AFTER_S } from "./arrivals.js";
import { effectiveHidden } from "./visibility.js";
import { busName, legStatus, offText } from "./tripyou.js";

/** A vehicle report older than this (s) is ignored. */
export const BUS_STALE_S = 180;
const FIRED_MAX = 400;

/** The one alert when live data goes down (old or failing) while alerts are armed. */
export const DELAYED_TITLE = "Live data delayed";
export const TRIP_DELAYED_BODY = "Bus positions and times may be off. Check the official app or call 773.702.8181.";
export const STATION_DELAYED_BODY = "Bus alerts are paused: bus positions may be off. Check the official app or call 773.702.8181.";
const capped = (fired) => (fired.size > FIRED_MAX ? new Set([...fired].slice(-FIRED_MAX)) : fired);

/**
 * Live data is down by the feed's own evidence: a poll failed, or a fresh poll returned an old feed. Not when data
 * merely aged because polling paused (background tab) or the first poll is still pending.
 */
function outage(state, now, level, polling) {
  if ((level !== "err" && level !== "old") || !state.lastOk || polling === false) return false;
  return !!state.failed || (level === "old" && now - state.lastOk <= ERR_AFTER_S);
}

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
 * Station alerts that should fire now (each trip + kind once). While live data is down or old: one 'delayed'
 * alert per outage (a failed poll, or a fresh poll of an old feed; never for data that only aged while polling was
 * paused), nothing else.
 * @param {object} state store state (needs notify, buses, trips, routeStops, stopRoutes, stops, routes, feed fields)
 * @param {Set<string>} prevFired keys already fired
 * @param {number} now unix seconds
 * @param {{tripOn?:boolean, polling?:boolean}} [opts] tripOn: a started trip with trip alerts on is in progress
 *   (station alerts pause: alerts follow the trip); polling false: the live feed is paused (background tab without
 *   notifications), so old data is not an outage
 * @returns {{alerts:Array<{key:string, kind:'twoStops'|'oneStop'|'minutes'|'delayed', title:string, body:string}>, fired:Set<string>}}
 */
export function dueAlerts(state, prevFired, now, opts = {}) {
  const fired = new Set(prevFired || []);
  const n = state?.notify;
  if (!n || !n.stopId || opts.tripOn) return { alerts: [], fired };
  const level = staleLevel(state, now), dk = `${n.stopId}|delayed`;
  if (level === "err" || level === "old") {
    if (!outage(state, now, level, opts.polling) || fired.has(dk)) return { alerts: [], fired };
    fired.add(dk);
    return { alerts: [{ key: dk, kind: "delayed", title: DELAYED_TITLE, body: STATION_DELAYED_BODY }], fired: capped(fired) };
  }
  fired.delete(dk);   // fresh again: a later outage alerts again
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
  return { alerts, fired: capped(fired) };
}

/**
 * Trip alerts that should fire now, from the trip's ONE progress evaluation (tripNow). Before boarding, per
 * followed bus (a different bus after a miss may alert again): 'board2' (2 stops away), 'board1' (1 stop away or
 * your stop is next), 'boardMin' (live arrival within notify.minutes). On board, once per ride (even if the trip id
 * rolls): 'off2' ("Get off in 2 stops: X"), 'off1' ("Get off at the next stop: X" / "Get off here: X"). The
 * notify switches twoStops / oneStop / minutes choose which; notify.trip false turns trip alerts off. Live data
 * down: one 'delayed' alert per outage. Titles are the card's words (legStatus / offText).
 * @param {object|null} p tripNow / tripProgress result
 * @param {object} state store state (notify, journey, routes, feed fields)
 * @param {Set<string>} prevFired keys already fired
 * @param {number} now unix seconds
 * @param {{polling?:boolean}} [opts] polling false: the live feed is paused, old data is not an outage
 * @returns {{alerts:Array<{key:string, kind:'board2'|'board1'|'boardMin'|'off2'|'off1'|'delayed', title:string, body:string}>, fired:Set<string>}}
 */
export function tripAlerts(p, state, prevFired, now, opts = {}) {
  const fired = new Set(prevFired || []);
  const n = state?.notify;
  if (!p || !n || n.trip === false || p.phase === "arrived") return { alerts: [], fired };
  const leg = (p.legs || [])[p.active];
  if (!leg || leg.type !== "bus") return { alerts: [], fired };
  const tk = `trip|${state.journey?.t0 ?? ""}|${p.active}|${leg.rid}:${leg.board.id}>${leg.alight.id}`;
  const level = staleLevel(state, now), alerts = [];
  if (level === "err" || level === "old") {
    const dk = `${tk}|delayed`;
    if (outage(state, now, level, opts.polling) && !fired.has(dk)) {
      fired.add(dk);
      alerts.push({ key: dk, kind: "delayed", title: DELAYED_TITLE, body: TRIP_DELAYED_BODY });
    }
    return { alerts, fired: capped(fired) };
  }
  fired.delete(`${tk}|delayed`);
  const v = leg.vehicle;
  if (leg.state !== "active" || !v) return { alerts, fired };
  const route = routeName(state, leg.rid), late = level === "late" ? " Live data is delayed." : "";
  const bus = v.label ? `${busName(v)}. ` : "";   // a bus without a number is just not named
  const add = (key, kind, title, body) => {
    if (fired.has(key)) return;
    fired.add(key);
    alerts.push({ key, kind, title, body: body + late });
  };
  if ((p.phase === "walk-to-stop" || p.phase === "waiting") && leg.stopsAway != null) {
    const vk = `${tk}|${v.id || v.label || ""}`;
    const when = leg.boardLive && leg.boardEta ? ` Arrives in ${minutesText(leg.boardEta, now)}.` : "";
    const foot = p.phase === "walk-to-stop" && leg.canCatch === false ? " You may not make it on foot." : "";
    const head = `${route}: ${legStatus(leg)}`, body = `Board at ${leg.board.name}.${when}${foot}`;
    if (n.oneStop && leg.stopsAway <= 1) add(`${vk}|board1`, "board1", head, body);
    else if (n.twoStops && leg.stopsAway === 2 && !fired.has(`${vk}|board1`)) add(`${vk}|board2`, "board2", head, body);
    if (n.minutes > 0 && leg.boardLive && leg.boardEta && leg.boardEta - now <= n.minutes * 60) {
      add(`${vk}|boardMin`, "boardMin", `${route}: arriving at ${leg.board.name} in ${minutesText(leg.boardEta, now)}`, `${bus}Next stop: ${v.nextName}.`);
    }
  } else if (p.phase === "on-bus" && leg.stopsLeft != null) {
    const body = (v.label ? `${route}, ${busName(v)}.` : `${route}.`) + (leg.alightLive && leg.alightEta ? ` Your stop in ${minutesText(leg.alightEta, now)}.` : "");
    if (n.oneStop && leg.stopsLeft <= 1) add(`${tk}|off1`, "off1", offText(leg.stopsLeft, leg.alight.name), body);
    else if (n.twoStops && leg.stopsLeft === 2 && !fired.has(`${tk}|off1`)) add(`${tk}|off2`, "off2", offText(2, leg.alight.name), body);
  }
  return { alerts, fired: capped(fired) };
}

/**
 * A started trip with trip alerts on is in progress (station alerts pause meanwhile).
 * @param {object|null} p tripNow / tripProgress result
 * @param {object} state
 * @returns {boolean}
 */
export function tripAlertsOn(p, state) {
  return !!p && p.phase !== "arrived" && state?.notify?.trip !== false;
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

/**
 * @module core/tripyou
 * Where YOU are on a started trip, and the one wording of the stop counts (owner request 2026-10-13: "the
 * Current Trip map should show the user's location in the current trip's location (especially for bus routes).
 * Make this sync to the notification center's get off in X stops"). Pure, no DOM.
 *
 * Everything reads the SAME evaluation of the followed trip (core/tripprogress.js tripNow): the Current trip
 * card and timeline, the map's "You" marker and stop labels (ui/tripmap.js), and the trip alerts
 * (core/notify.js tripAlerts). So the map, the card and the banner / notification always say the same count.
 *
 * Counts (from tripProgress): stopsAway 0 = your boarding stop is the bus's next stop (or it is at it);
 * stopsLeft 0 = the bus is AT your stop, 1 = your stop is its next stop, n = n stops to go counting yours.
 *
 * You are drawn: on the bus (its live position) while riding, unless your accurate GPS is far from it (then
 * your GPS, and `far` says so: you may not be on it); your GPS while walking; your GPS or, without it, the
 * boarding stop while waiting. Never a position nobody knows. iOS Kit TripYou.swift ports this 1:1.
 */
import { hav } from "./geo.js";

/** Tunables (read-only). */
export const YOU = Object.freeze({
  FAR_M: 300,          // on the bus: your accurate GPS farther than this (+ its accuracy) from the bus -> not drawn on it
  GPS_ACC_M: 100,      // a fix this accurate (or without an accuracy) counts against the bus position
  NEAR_BUS_STOPS: 3,   // before boarding, the coming bus joins the map frame from this many stops away
});

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "Bus 101" / "The bus". @param {{label?:string}|null} v */
export function busName(v) { return v && v.label ? `Bus ${v.label}` : "The bus"; }

/**
 * The get-off count in words (card, timeline, map, alerts, Live Activity alike).
 * @param {number} stopsLeft 0 = at your stop, 1 = your stop is next
 * @param {string} alight stop name
 * @returns {string} "Get off here: X" | "Get off at the next stop: X" | "Get off in 3 stops: X"
 */
export function offText(stopsLeft, alight) {
  const n = Math.max(0, Math.round(Number(stopsLeft) || 0));
  return n === 0 ? `Get off here: ${alight}` : n === 1 ? `Get off at the next stop: ${alight}` : `Get off in ${n} stops: ${alight}`;
}

/**
 * Short form for the map label at your stop.
 * @param {number|null} stopsLeft
 * @returns {string} "Get off here" | "Get off next stop" | "Get off in 3 stops"
 */
export function offShort(stopsLeft) {
  if (stopsLeft == null) return "Get off here";
  const n = Math.max(0, Math.round(Number(stopsLeft) || 0));
  return n === 0 ? "Get off here" : n === 1 ? "Get off next stop" : `Get off in ${n} stops`;
}

/**
 * Where the followed bus is relative to your trip, in one line ('' without a followed bus).
 * Before boarding: "Bus 101 is 2 stops away" / "Bus 101 is approaching X" / "Bus 101 is at X"; on board: offText.
 * @param {object} leg bus leg of tripProgress
 * @returns {string}
 */
export function legStatus(leg) {
  const v = leg && leg.vehicle;
  if (!v) return "";
  const who = busName(v);
  if (leg.stopsAway != null) {
    return leg.stopsAway === 0 ? (v.at ? `${who} is at ${leg.board.name}` : `${who} is approaching ${leg.board.name}`) : `${who} is ${plural(leg.stopsAway, "stop")} away`;
  }
  if (leg.stopsLeft != null) return offText(leg.stopsLeft, leg.alight.name);
  return "";
}

/** {lat, lon} of a point-like object, or null (null / '' / NaN / 0,0 are no point). */
export function ptOf(o) {
  if (!o || o.lat == null || o.lon == null || o.lat === "" || o.lon === "") return null;
  const lat = Number(o.lat), lon = Number(o.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0) ? { lat, lon } : null;
}

/**
 * Where you are on the trip and what the map keeps in view.
 * @param {object|null} p tripProgress / tripNow result
 * @param {object} state store state (user {lat, lon, accuracy?}, stops, journey {dest?})
 * @returns {null|{phase:string, active:number, lat:number|null, lon:number|null, source:'bus'|'gps'|'stop'|null,
 *   onBus:boolean, far:boolean, vehicleId:string|null, label:string|null, busLat:number|null, busLon:number|null,
 *   stopsAway:number|null, stopsLeft:number|null, board:object|null, alight:object|null,
 *   target:{id:string|null, name:string, lat:number, lon:number, role:'board'|'alight'|'dest'}|null,
 *   frame:Array<[number, number]>, text:string}}
 */
export function tripYou(p, state) {
  if (!p) return null;
  const S = state || {}, legs = p.legs || [];
  let leg = legs[p.active] && legs[p.active].type === "bus" ? legs[p.active] : null;
  if (!leg && p.phase === "arrived") leg = legs.filter((l) => l && l.type === "bus").pop() || null;
  const v = (leg && leg.vehicle) || null;
  const gps = ptOf(S.user);
  const accN = S.user && S.user.accuracy != null && S.user.accuracy !== "" ? Number(S.user.accuracy) : NaN;
  const acc = Number.isFinite(accN) ? accN : null;
  const accurate = !!gps && (acc == null || acc <= YOU.GPS_ACC_M);
  const busPt = ptOf(v);
  const stopOf = (s) => {
    if (!s) return null;
    const q = ptOf(S.stops && S.stops[s.id]);
    return { id: s.id, name: s.name, lat: q ? q.lat : null, lon: q ? q.lon : null };
  };
  const board = leg ? stopOf(leg.board) : null, alight = leg ? stopOf(leg.alight) : null;
  const tgt = (s, role) => (s && s.lat != null ? { id: s.id, name: s.name, lat: s.lat, lon: s.lon, role } : null);
  const who = busName(v);
  let you = null, source = null, onBus = false, far = false, target = null, text = "";
  if (p.phase === "on-bus" && leg) {
    target = tgt(alight, "alight");
    if (busPt) {
      if (accurate && hav(gps, busPt) > YOU.FAR_M + (acc || 0)) {
        you = gps; source = "gps"; far = true;
        text = `Your location is not near ${who}. Stop counts follow the bus.`;
      } else {
        you = busPt; source = "bus"; onBus = true;
        text = leg.stopsLeft != null ? `You are on ${who}. ${offText(leg.stopsLeft, leg.alight.name)}` : `You are on ${who}.`;
      }
    } else if (gps) { you = gps; source = "gps"; text = `Your location. Riding to ${leg.alight.name}.`; }
  } else if (p.phase === "waiting" && leg) {
    target = tgt(board, "board");
    if (gps) { you = gps; source = "gps"; text = `Your location. Waiting at ${leg.board.name}.`; }
    else if (board && board.lat != null) { you = { lat: board.lat, lon: board.lon }; source = "stop"; text = `Waiting at ${leg.board.name}.`; }
  } else if (p.phase === "walk-to-stop" && leg) {
    target = tgt(board, "board");
    if (gps) { you = gps; source = "gps"; text = `Your location. Walking to ${leg.board.name}.`; }
  } else {
    const d = ptOf(S.journey && S.journey.dest);
    target = d ? { id: null, name: p.to, lat: d.lat, lon: d.lon, role: "dest" } : tgt(alight, "alight");
    if (gps) { you = gps; source = "gps"; text = `Your location. Walking to ${p.to}.`; }
  }
  const frame = [];
  if (you) frame.push([you.lat, you.lon]);
  if (target) frame.push([target.lat, target.lon]);
  if ((p.phase === "walk-to-stop" || p.phase === "waiting") && busPt && leg && leg.stopsAway != null && leg.stopsAway <= YOU.NEAR_BUS_STOPS) {
    frame.push([busPt.lat, busPt.lon]);
  }
  return {
    phase: p.phase, active: p.active, lat: you ? you.lat : null, lon: you ? you.lon : null, source, onBus, far,
    vehicleId: v && v.id != null ? String(v.id) : null, label: v && v.label ? String(v.label) : null,
    busLat: busPt ? busPt.lat : null, busLon: busPt ? busPt.lon : null,
    stopsAway: leg && leg.stopsAway != null ? leg.stopsAway : null, stopsLeft: leg && leg.stopsLeft != null ? leg.stopsLeft : null,
    board, alight, target, frame, text,
  };
}

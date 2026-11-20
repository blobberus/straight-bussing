/**
 * @module core/busmenu
 * The bus menu (owner 2026-11-20: "There should be an ability for the user to click a particular bus on the map which
 * will show its next stop, line, and schedule. In this menu, at the bottom should be report and feedback"). Pure logic
 * and every word the menu shows, in one place, so the iPhone app's BusDetailView is a mechanical port (Kit BusMenu).
 * ui/views/bus.js renders it; main.js opens it on a map bus tap.
 *
 * - Which bus: store.busMenu (the bus key, core/busnum.js busKey: vehicle id, else label) while store.view is "bus".
 *   The router keeps it in the view's params too (navigate("bus", {routeId, bus})), so Back to a bus menu brings its
 *   bus back (menuSync). The menu follows the bus by its key; Passio moving it to another line moves the menu (and the
 *   map's focus, which is the menu's routeId) with it.
 * - A bus missing from the feed keeps its menu PICK_HOLD_S (45 s, as long as the map keeps its badge and the route
 *   page keeps a pick), then "This bus is no longer reporting" (heldBus). A bus more than a block off its route
 *   (store.away) says so at once, as its badge goes at once. Both keep See the whole route.
 * - Times: core/eta.js busTimes (this bus's next stops for one lap, kind live or est, Passio filler never live), in the
 *   station times' words (core/eta.js timeWords): "3 min", "~5 min" + "est.", past EST_MAX_MIN "3 stops away" + "Not
 *   live" (timeText). A transitioning bus (core/seen.js) shows TRANSITION_TEXT and no times, as on the route page.
 * - Line schedule: today's hours in the route page's words (lineHours) + Scheduled now / Not scheduled now.
 */
import { busKey, busName, numberMap, PICK_HOLD_S } from "./busnum.js";
import { serviceHoursAt, isScheduledNow, localParts } from "./schedule.js";
import { ago } from "./time.js";
import { busTimes, timeWords, ETA_NOTES, ETA_WORDS } from "./eta.js";
import { TRANSITION_TEXT } from "./seen.js";

/** Every word of the bus menu (Kit BusMenu.words, the same). The view escapes them. */
export const BUS_MENU = Object.freeze({
  heading: "Heading to",
  nextStops: "Next stops",
  lineSchedule: "Line schedule",
  wholeRoute: "See the whole route",
  today: "Today",
  service: "service",                       // "Friday service": after midnight, the evening's hours (route page)
  reduced: "(reduced schedule)",
  changed: "(schedule change)",
  extra: "(extra service)",
  scheduledNow: "Scheduled now",
  notScheduledNow: "Not scheduled now",
  noSchedule: "No published schedule for this line.",
  seenPrefix: "location from",              // "location from 2 min ago" (a bus report older than STALE_BUS_S)
  goneTitle: "This bus is no longer reporting",
  goneBody: "It may have finished its run. See the whole route for the other buses and the next times.",
  awayTitle: "This bus is away from its route",
  awayBody: "It is hidden from the map until it is back on its route. See the whole route for the other buses and the next times.",
  noTimes: "No times for this bus right now.",
  noStops: "The schedule lists no stops for this line.",
  next: "Next",                              // the first row of Next stops (the stop it is heading to)
  loop: "Loop: continues to",
  live: "Times are live predictions. Bus positions are approximate.",
  liveMixed: ETA_NOTES.live,                // with an estimate on screen: "Unmarked times are live predictions. ..."
  estFoot: ETA_NOTES.est,                   // "est. = estimated from where the bus is and the timetable's travel times."
  stale: "Times and bus positions may be off.",
  report: "Report and feedback",
  reportSoon: "Coming soon: report a problem with this bus or send feedback.",
  reportOn: "Opens a Google Form in a new tab with this line, bus, next stop, time and app version filled in. Nothing is sent until you press Submit there.",
  reportSay: "opens a Google Form in a new tab",
  reportOffSay: "not available yet",
});

/** A bus report older than this (s) is stale: "location from 2 min ago" (the route page's STALE_BUS_S). */
export const STALE_BUS_S = 60;
/** Weekday names for "Friday service" (after midnight; the route page's words). */
const DAY_NAME = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };


/**
 * The bus a key names in store.buses, or null.
 * @param {object} state
 * @param {string|null} key
 * @returns {object|null}
 */
export function busByKey(state, key) {
  if (key == null || key === "") return null;
  return ((state && state.buses) || []).find((b) => busKey(b) === String(key)) || null;
}

/**
 * The menu's bus through a feed gap: the bus itself while it is in the feed; for PICK_HOLD_S after it went missing the
 * last copy seen; then gone. Pure: the view keeps `mem` between renders.
 * @param {{key:string, bus:object|null, since:number}|null} mem the last call's memory
 * @param {object} state
 * @param {string|null} key store.busMenu
 * @param {number} now unix seconds
 * @returns {{bus:object|null, gone:boolean, mem:{key:string, bus:object|null, since:number}}}
 */
export function heldBus(mem, state, key, now) {
  const k = key == null ? "" : String(key), b = busByKey(state, k);
  if (b) return { bus: b, gone: false, mem: { key: k, bus: b, since: 0 } };
  const m = mem && mem.key === k ? mem : null;
  if (!m || !m.bus) return { bus: null, gone: true, mem: { key: k, bus: null, since: m ? m.since || now : now } };
  const since = m.since || now;
  return now - since >= PICK_HOLD_S ? { bus: null, gone: true, mem: { key: k, bus: m.bus, since } }
    : { bus: m.bus, gone: false, mem: { key: k, bus: m.bus, since } };
}

/**
 * Is the menu's bus more than a block off its route (store.away: hidden from the map, still tracked)?
 * @param {object} state
 * @param {string|null} key
 * @returns {boolean}
 */
export function isAway(state, key) {
  return key != null && ((state && state.away) || []).some((b) => busKey(b) === String(key));
}

/**
 * The bus key the map rings: the menu's bus while the bus menu is open, else null (the route page's pick is
 * core/busnum.js selectedBus).
 * @param {object} state
 * @returns {string|null}
 */
export function menuBusKey(state) {
  return state && state.view === "bus" && state.busMenu != null ? String(state.busMenu) : null;
}

/**
 * Keep store.busMenu in step with the router (main.js, every store change): the bus menu's params name its bus (Back to
 * a bus menu restores it); off the bus menu, none. A bus Passio moved to another line takes the menu with it
 * (navigate to the same bus under its new routeId; the bus view replaces itself, so Back is unchanged).
 * @param {object} state
 * @param {string|null|undefined} paramBus currentParams().bus
 * @returns {{patch?:{busMenu:string|null}, nav?:{routeId:string, bus:string}}|null} null = nothing to do
 */
export function menuSync(state, paramBus) {
  const s = state || {};
  if (s.view !== "bus") return s.busMenu != null ? { patch: { busMenu: null } } : null;
  const k = paramBus == null || paramBus === "" ? null : String(paramBus);
  if (k !== (s.busMenu ?? null)) return { patch: { busMenu: k } };
  const b = busByKey(s, k), rid = b && b.trip && b.trip.route_id != null ? String(b.trip.route_id) : "";
  if (rid && rid !== String(s.routeId ?? "") && s.routes && s.routes[rid]) return { nav: { routeId: rid, bus: k } };
  return null;
}

/**
 * Today's hours of a line in the route page's words: {k: "Today" | "Friday service", label: "7:00 AM to 11:00 PM",
 * note: "(reduced schedule)" | "", on: true | false | null (no data for now)}; null when the line has no schedule data.
 * @param {object} service store.service
 * @param {string} rid
 * @param {number} now unix seconds
 * @returns {{k:string, label:string, note:string, on:boolean|null}|null}
 */
export function lineHours(service, rid, now) {
  const sh = serviceHoursAt(service, rid, now), h = sh && sh.hours;
  if (!h) return null;
  const note = h.exception === "removed" ? (h.first ? BUS_MENU.reduced : BUS_MENU.changed) : h.exception === "added" ? BUS_MENU.extra : "";
  return { k: sh.yesterday ? `${DAY_NAME[sh.dayKey] || ""} ${BUS_MENU.service}`.trim() : BUS_MENU.today, label: h.label, note,
    on: isScheduledNow(service, rid, now) };
}

const NO_TIME = Object.freeze({ text: "", tag: "", say: "", now: false, far: false });
/**
 * How a time reads, in the station times' words (core/eta.js timeWords, the route and stop pages' too): live "3 min"
 * ("Now" under a minute; "~3 min" while the feed is stale), est "~5 min" + "est." (never "Now"), an estimate past
 * EST_MAX_MIN "3 stops away" + "Not live" (far). say = the words for screen readers.
 * @param {{t:number|null, kind:'live'|'est', away?:number}|null} row
 * @param {number} now unix seconds
 * @param {boolean} [staleFeed]
 * @returns {{text:string, tag:string, say:string, now:boolean, far:boolean}} text '' when there is no time
 */
export function timeText(row, now, staleFeed = false) {
  const t = row && Number(row.t);
  if (!row || !Number.isFinite(t) || t <= 0) return NO_TIME;
  return timeWords({ ...row, t }, now, !!staleFeed) || NO_TIME;
}

/**
 * Everything the bus menu shows, as plain data (the view turns it into markup; Kit BusMenu.model the same).
 * @param {object} state store state
 * @param {{bus:object|null, gone:boolean}} held heldBus(...)
 * @param {number} now unix seconds
 * @param {{times?:Function, ride?:Function}} [o] times: in place of core/eta.js busTimes (tests); ride: riding minutes
 *   between two stops, (rid, fromId, toId) (default core/eta.js defaultRide, data/segments.json)
 * @returns {object} {key, rid, route, line, name, status:'ok'|'gone'|'away'|'transitioning', seen, stale, next, rows,
 *   anyEst, loopTo, hours}
 */
export function busMenuModel(state, held, now, o = {}) {
  const s = state || {}, key = s.busMenu != null ? String(s.busMenu) : null;
  const bus = held && held.bus;
  const rid = String((bus && bus.trip && bus.trip.route_id) ?? s.routeId ?? "");
  const r = (s.routes && s.routes[rid]) || null;
  const line = r ? r.long || r.short || rid : "Bus";
  const name = bus ? busName(bus, numberMap(s)) : "";
  const hours = r ? lineHours(s.service, rid, now) : null;
  const base = { key, rid, route: r, line, name, hours, seen: 0, stale: false, next: null, rows: [], anyEst: false, loopTo: "" };
  if (isAway(s, key)) return { ...base, status: "away" };
  if (!bus || (held && held.gone)) return { ...base, status: "gone" };
  const seen = Number(bus.timestamp) || 0, stale = !!seen && now - seen > STALE_BUS_S;
  const nameOf = (id) => (s.stops && s.stops[id] && s.stops[id].name) || String(id);
  const tr = ((s.transitioning || []).map(String)).includes(String((bus.vehicle && bus.vehicle.id) ?? ""));
  const nextId = bus.stop_id != null && bus.stop_id !== "" ? String(bus.stop_id) : null;
  if (tr) return { ...base, status: "transitioning", seen, stale, next: nextId ? { stopId: nextId, name: nameOf(nextId), t: null, kind: "live" } : null };
  const fn = typeof o.times === "function" ? o.times : busTimes;
  let rows = [];
  try { rows = (fn(s, bus, now, o.ride) || []).filter((x) => x && x.stopId != null); } catch (e) { rows = []; }
  rows = rows.map((x, i) => ({ stopId: String(x.stopId), idx: x.idx, name: nameOf(x.stopId), t: Number.isFinite(Number(x.t)) && Number(x.t) > 0 ? Number(x.t) : null,
    kind: x.kind === "est" ? "est" : "live", away: Number.isFinite(Number(x.away)) ? Number(x.away) : i }));
  const first = rows[0] && (!nextId || rows[0].stopId === nextId) ? rows[0] : null;
  let next = nextId ? { stopId: nextId, name: nameOf(nextId), t: first ? first.t : null, kind: first ? first.kind : "live", away: 0 } : first;
  if (next && next.t != null && timeText(next, now).far) next = { ...next, t: null };   // an estimate past EST_MAX_MIN: no minutes in the status
  const list = (s.routeStops && s.routeStops[rid]) || [];
  const loop = list.length > 2 && String(list[0]) === String(list[list.length - 1]);
  const loopTo = loop && rows.length ? nameOf(rows[0].stopId) : "";
  return { ...base, status: "ok", seen, stale, next, rows, anyEst: rows.some((x) => x.kind === "est" && timeText(x, now).tag === ETA_WORDS.est), loopTo };
}

/**
 * The screen-reader sentence of the menu's status ("Bus 2, heading to Levi Hall, in 3 minutes, live").
 * @param {object} m busMenuModel
 * @param {number} now
 * @param {{staleFeed?:boolean, liveSay?:string}} [o] liveSay: the live label's words (ui/components.js liveLabel text)
 * @returns {string}
 */
export function statusSay(m, now, o = {}) {
  if (!m) return "";
  if (m.status === "gone") return BUS_MENU.goneTitle;
  if (m.status === "away") return BUS_MENU.awayTitle;
  const who = m.name ? m.name + ", " : "";
  if (m.status === "transitioning") return who + TRANSITION_TEXT;
  if (!m.next) return who + BUS_MENU.noTimes;
  const t = timeText(m.next, now, !!o.staleFeed);
  const live = t.text && m.next.kind !== "est" && o.liveSay ? ", " + o.liveSay : "";
  const seen = m.stale ? `, ${BUS_MENU.seenPrefix} ${ago(m.seen, now)}` : "";
  return `${who}${BUS_MENU.heading.toLowerCase()} ${m.next.name}${t.say ? ", " + t.say : ""}${live}${seen}`;
}

/**
 * The report form's details (owner 2026-11-20): ONLY the line name, the bus number shown, its next stop, the Chicago
 * time rounded to the minute and the app version. Never a location, an identity or a device id.
 * @param {object} m busMenuModel
 * @param {number} now unix seconds
 * @param {string} version the app version (ui/views/about.js APP_VERSION)
 * @returns {{line:string, bus:string, stop:string, time:string, version:string}}
 */
export function reportInfo(m, now, version) {
  const p = localParts(Math.round(Number(now) / 60) * 60), two = (n) => String(n).padStart(2, "0");
  const time = Number.isFinite(Number(now)) && p ? `${p.y}-${two(p.m)}-${two(p.d)} ${two(Math.floor(p.min / 60))}:${two(p.min % 60)}` : "";
  return { line: (m && m.route && (m.route.long || m.route.short)) || (m && m.line) || "", bus: (m && m.name) || "",
    stop: (m && m.next && m.next.name) || "", time, version: String(version || "") };
}

/**
 * @module core/busnum
 * Bus numbers on a line (owner 2026-10-30: "if there are multiple buses on a line, name them with a number so that if
 * a user clicks on a particular bus it will show their arrival times at each station instead of the closest one").
 * Pure; the iOS Kit mirrors it (BusNumbers.swift).
 * - The buses are the ones the app shows (store.buses: operating buses only, data/live.js + core/operating.js).
 * - A route with 2 or more buses names them "Bus 1", "Bus 2", ... in vehicle id order (numeric compare when both
 *   ids are numbers, else text order), so the names stay put while the same buses run. One bus: no number.
 * - selectedBus: the bus picked on the route page (store.busId), only while that route page is open and that bus is
 *   still shown; otherwise null (main.js then clears busId: the page returns to the next bus at each stop).
 * - Arrivals name their bus the same way (owner 2026-11-06: "When showing which bus is about to arrive at station, it
 *   should state which bus number displayed on the route is about to arrive if there is more than 1 bus"): an arrival
 *   is tied to a bus by the vehicle id on its trip update (core/arrivals.js arrivalsFor vehicleId; else the label, as
 *   busKey), and gets that bus's number only when the bus is numbered on the arrival's own route. No vehicle, a
 *   vehicle the app does not show, a schedule-only time: no number (never a guess).
 * - The numbers hold through a feed gap (numberStep, data/live.js -> store.busNums): a bus Passio leaves out of a poll
 *   keeps its place for NUM_HOLD_S (45 s, as long as the map keeps its badge, map/layers.js MISSING_S; iOS numbers
 *   the buses its map draws, the same 45 s), so "Bus 2" does not turn into "Bus 1" or lose its number for a poll.
 *   A bus that leaves for good (gone 45 s, or more than a block off its route: at once, like its badge) or joins
 *   renumbers the line in vehicle id order: every phone shows the same numbers for the same feed, and a line back to
 *   one bus shows no number.
 */

/**
 * A bus's key: its vehicle id, else its label (the map's marker key too). null when it has neither.
 * @param {object} b a store.buses entry
 * @returns {string|null}
 */
export function busKey(b) {
  const v = b && b.vehicle;
  const k = v ? (v.id != null && v.id !== "" ? v.id : v.label) : null;
  return k == null || k === "" ? null : String(k);
}

/**
 * Vehicle id order: numeric when both are numbers, else text order (ties broken by text).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareIds(a, b) {
  const sa = String(a), sb = String(b);
  const na = Number(sa), nb = Number(sb);
  if (sa.trim() !== "" && sb.trim() !== "" && Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Numbers for the buses of routes that show 2 or more buses.
 * @param {object[]} buses store.buses
 * @returns {Map<string, number>} bus key -> 1, 2, ... (keys of single-bus routes are absent)
 */
export function busNumbers(buses) {
  const out = new Map();
  for (const m of Object.values(numberRoutes(pairsOf(buses)))) for (const k of Object.keys(m)) out.set(k, m[k]);
  return out;
}

/** [bus key, route id] of each bus (no key or no route: left out later). */
const pairsOf = (buses) => (buses || []).map((b) => [busKey(b), b && b.trip && b.trip.route_id != null ? String(b.trip.route_id) : ""]);

/**
 * Numbers per route from [bus key, route id] pairs: route id -> bus key -> 1, 2, ... (routes with one bus absent).
 * @param {Iterable<[string|null, string]>} pairs
 * @returns {Object<string, Object<string, number>>}
 */
export function numberRoutes(pairs) {
  const byRoute = new Map();
  for (const [k, rid] of pairs || []) {
    if (k == null || k === "" || !rid) continue;
    if (!byRoute.has(rid)) byRoute.set(rid, new Set());
    byRoute.get(rid).add(String(k));
  }
  const out = {};
  for (const [rid, keys] of byRoute) {
    if (keys.size < 2) continue;
    const m = {};
    [...keys].sort(compareIds).forEach((k, i) => { m[k] = i + 1; });
    out[rid] = m;
  }
  return out;
}

/** A bus left out of a poll keeps its number this long (s): as long as the map keeps its badge (map/layers.js MISSING_S). */
export const NUM_HOLD_S = 45;

/**
 * One poll's bus numbers (data/live.js, every poll with a vehicle list; stored as store.busNums). A bus Passio leaves out
 * of the poll while others report (DC-015) keeps its place for NUM_HOLD_S, so the other buses keep their numbers; a bus
 * more than a block off its route (store.away, core/offroute.js) leaves at once, like its badge; a poll with no bus
 * lets every bus go (data/live.js already keeps the list through ONE odd empty answer). Then vehicle id order, as
 * busNumbers. iOS: the app numbers the buses its map draws (BusMotion keeps a missing bus 45 s), Kit BusNumbers.byRoute.
 * @param {Map<string, {rid:string, gone:number}>|null} seen the last step's memory (bus key -> route, when it went missing; 0 = listed)
 * @param {object[]} buses this poll's store.buses
 * @param {{away?:Array<object|string>, nowS:number}} o away: buses (or keys) more than a block off their route
 * @returns {{seen:Map<string, {rid:string, gone:number}>, routes:Object<string, Object<string, number>>}}
 */
export function numberStep(seen, buses, { away = [], nowS } = {}) {
  const now = Number(nowS) || 0, next = new Map();
  for (const [k, rid] of pairsOf(buses)) if (k != null && rid) next.set(k, { rid, gone: 0 });
  const off = new Set((away || []).map((x) => (x && typeof x === "object" ? busKey(x) : x == null ? null : String(x))));
  if (next.size) {
    for (const [k, v] of seen || []) {
      if (next.has(k) || off.has(k) || !v || !v.rid) continue;
      const gone = v.gone || now;
      if (now - gone <= NUM_HOLD_S) next.set(k, { rid: v.rid, gone });
    }
  }
  return { seen: next, routes: numberRoutes([...next].map(([k, v]) => [k, v.rid])) };
}

const memo = new WeakMap();

/**
 * The numbers the app shows now, per route: store.busNums (this poll's numbers with the 45 s hold) while it belongs to
 * the shown buses, else straight from store.buses (a state built without data/live.js: tests, a fresh store).
 * @param {{buses?:object[], busNums?:{of:object[], routes:object}|null}} state
 * @returns {Object<string, Object<string, number>>} route id -> bus key -> number
 */
export function routeNumbers(state) {
  const S = state || {}, held = S.busNums;
  if (held && held.routes && held.of === S.buses) return held.routes;
  if (!Array.isArray(S.buses)) return {};
  let r = memo.get(S.buses);
  if (!r) { r = numberRoutes(pairsOf(S.buses)); memo.set(S.buses, r); }
  return r;
}

/**
 * routeNumbers as one map, bus key -> number (what busName and the map badges read).
 * @param {object} state
 * @returns {Map<string, number>}
 */
export function numberMap(state) {
  const out = new Map();
  for (const m of Object.values(routeNumbers(state))) for (const k of Object.keys(m)) out.set(k, m[k]);
  return out;
}

/**
 * The number the map shows on bus `key` of route `rid`; 0 when the route has one bus or that bus is not on it.
 * @param {object} state
 * @param {string|null} rid
 * @param {string|null} key bus key (vehicle id, else label)
 * @returns {number}
 */
export function busNumber(state, rid, key) {
  if (rid == null || key == null || key === "") return 0;
  const m = routeNumbers(state)[String(rid)];
  return (m && m[String(key)]) || 0;
}

/**
 * The bus an arrival comes from (core/arrivals.js arrivalsFor): its trip update's vehicle id, else that vehicle's label
 * (the same rule as busKey). null when the trip update names no vehicle.
 * @param {{vehicleId?:string|null, bus?:string|null}} a
 * @returns {string|null}
 */
export function arrivalKey(a) {
  const k = a && a.vehicleId != null && a.vehicleId !== "" ? a.vehicleId : a && a.bus != null && a.bus !== "" ? a.bus : null;
  return k == null ? null : String(k);
}

/** "Bus 2" for a number, '' for none. @param {number} n @returns {string} */
export const numberName = (n) => (n > 0 ? `Bus ${n}` : "");

/**
 * Which numbered bus makes an arrival: "Bus 2" when the arrival's route shows 2 or more buses and its vehicle is one of
 * them (the map badge's number), else '' (one bus on the line, no vehicle on the trip update, a bus the app does not
 * show). Owner 2026-11-06. Kit BusNumbers.arrivalName.
 * @param {object} state store state (buses, busNums)
 * @param {{rid:string, vehicleId?:string|null, bus?:string|null}} a an arrival
 * @returns {string}
 */
export function arrivalBusName(state, a) {
  return a ? numberName(busNumber(state, a.rid, arrivalKey(a))) : "";
}

/**
 * The numbered bus a planned bus leg boards (Directions): only a live boarding time comes from a known vehicle
 * (core/planner.js sets vehicleId from that trip update); a scheduled or estimated time names no bus.
 * @param {object} state
 * @param {{type?:string, rid?:string, vehicleId?:string|null, waitLive?:boolean}} leg
 * @returns {string} "Bus 2" | ''
 */
export function legBusName(state, leg) {
  if (!leg || leg.type !== "bus" || !leg.waitLive || leg.vehicleId == null) return "";
  return numberName(busNumber(state, leg.rid, leg.vehicleId));
}

/**
 * How the app names a bus: "Bus 2" on a route with several buses, else "Bus <fleet label>", else "This bus".
 * @param {object} b
 * @param {Map<string, number>} numbers busNumbers(...)
 * @returns {string}
 */
export function busName(b, numbers) {
  const n = numbers && numbers.get(busKey(b));
  if (n) return `Bus ${n}`;
  const label = b && b.vehicle && (b.vehicle.label ?? b.vehicle.id);
  return label != null && label !== "" ? `Bus ${label}` : "This bus";
}

/**
 * The bus picked on the open route page, or null (another view, another route, or that bus no longer shown).
 * @param {{view?:string, routeId?:string|null, busId?:string|null, buses?:object[]}} state
 * @returns {object|null}
 */
export function selectedBus(state) {
  if (!state || state.view !== "route" || state.busId == null || state.routeId == null) return null;
  const id = String(state.busId), rid = String(state.routeId);
  return (state.buses || []).find((b) => busKey(b) === id && String(b?.trip?.route_id ?? "") === rid) || null;
}

/**
 * One bus's own next live time at a stop: its vehicle id's predictions only, never another bus's.
 * @param {object[]} arrivals arrivalsFor(...) for the stop (sorted by time)
 * @param {string} vehicleId
 * @returns {object|null}
 */
export function busArrival(arrivals, vehicleId) {
  const id = vehicleId == null ? null : String(vehicleId);
  if (id == null) return null;
  return (arrivals || []).find((a) => a && a.vehicleId === id) || null;
}

/** A picked bus missing from the feed keeps its pick this long: as long as the map keeps its badge (map/layers.js MISSING_S). */
export const PICK_HOLD_S = 45;

/**
 * Should the picked bus be let go now? At once when the rider leaves its route page; when it is missing from the feed,
 * only after PICK_HOLD_S (Passio's lists sometimes leave a running bus out for a poll or two, DC-015).
 * @param {object} state store state
 * @param {number} goneSince when the picked bus was first missing (0 = it is shown)
 * @param {number} now unix seconds
 * @returns {{clear:boolean, goneSince:number}}
 */
export function pickCheck(state, goneSince, now) {
  if (!state || state.busId == null) return { clear: false, goneSince: 0 };
  if (state.view !== "route") return { clear: true, goneSince: 0 };
  if (selectedBus(state)) return { clear: false, goneSince: 0 };
  const since = goneSince || now;
  return now - since >= PICK_HOLD_S ? { clear: true, goneSince: 0 } : { clear: false, goneSince: since };
}

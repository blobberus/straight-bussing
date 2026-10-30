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
  const byRoute = new Map();
  for (const b of buses || []) {
    const k = busKey(b), rid = b && b.trip && b.trip.route_id != null ? String(b.trip.route_id) : "";
    if (k == null || !rid) continue;
    if (!byRoute.has(rid)) byRoute.set(rid, new Set());
    byRoute.get(rid).add(k);
  }
  const out = new Map();
  for (const keys of byRoute.values()) {
    if (keys.size < 2) continue;
    [...keys].sort(compareIds).forEach((k, i) => out.set(k, i + 1));
  }
  return out;
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

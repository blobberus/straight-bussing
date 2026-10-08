/**
 * @module core/geo
 * Geographic helpers. Coordinates are {lat, lon}. Pure, no DOM.
 */

const R = 6371000;
const RAD = Math.PI / 180;

/** Walking pace in meters per minute (shared by planner and walk router). */
export const WALK_M_PER_MIN = 80;

/** Straight-line to street-distance factor for walking estimates (shared by planner and walk router). */
export const WALK_DETOUR = 1.2;

/**
 * Great-circle (haversine) distance in meters.
 * @param {{lat:number, lon:number}} a
 * @param {{lat:number, lon:number}} b
 * @returns {number} meters (NaN if inputs are invalid)
 */
export function hav(a, b) {
  const dLa = (b.lat - a.lat) * RAD, dLo = (b.lon - a.lon) * RAD;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/**
 * Walking minutes for a distance (float, meters / 80).
 * @param {number} meters
 * @returns {number}
 */
export function walkMin(meters) {
  return meters / WALK_M_PER_MIN;
}

/**
 * Nearest stops to a point, sorted by straight-line distance.
 * @param {Object<string,{name:string,lat:number,lon:number}>} stops  id -> stop
 * @param {{lat:number, lon:number}} point
 * @param {{max?:number, maxM?:number, routeStops?:Object<string,string[]>}} [opts]
 *   max: result count (default 3); maxM: radius in meters (default Infinity);
 *   routeStops: if given, only stops that appear on at least one route are returned.
 * @returns {Array<{id:string,name:string,lat:number,lon:number,d:number}>}
 */
export function nearestStops(stops, point, { max = 3, maxM = Infinity, routeStops } = {}) {
  if (!stops || !point || !isFinite(point.lat) || !isFinite(point.lon)) return [];
  let served = null;
  if (routeStops) {
    served = new Set();
    for (const list of Object.values(routeStops)) for (const id of list || []) served.add(String(id));
  }
  const out = [];
  for (const [id, s] of Object.entries(stops)) {
    if (!s || !isFinite(s.lat) || !isFinite(s.lon)) continue;
    if (served && !served.has(id)) continue;
    const d = hav(point, s);
    if (d <= maxM) out.push({ id, name: s.name, lat: s.lat, lon: s.lon, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, max);
}

/**
 * Initial bearing from a to b in degrees, 0 = north, clockwise, range [0, 360).
 * @param {{lat:number, lon:number}} a
 * @param {{lat:number, lon:number}} b
 * @returns {number}
 */
export function bearing(a, b) {
  const la1 = a.lat * RAD, la2 = b.lat * RAD, dLo = (b.lon - a.lon) * RAD;
  const y = Math.sin(dLo) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLo);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

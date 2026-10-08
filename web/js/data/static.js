// Static GTFS-derived data (built daily by tools/build_gtfs.py into web/data/).
// Robust to partial failure: each file loads independently; a missing/bad file yields an
// empty slice instead of breaking the app, and staticLoaded is always set at the end.

/** Files loaded into the store: [storeKey, fileName, required]. */
export const STATIC_FILES = Object.freeze([
  ['routes', 'routes.json', true],
  ['stops', 'stops.json', true],
  ['shapes', 'shapes.json', true],
  ['routeStops', 'route_stops.json', true],
  ['addresses', 'stop_addresses.json', false],
  ['service', 'service.json', false],
]);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/**
 * Fetch and parse one JSON file. Retries once on network/HTTP errors (not on 404 for optional files).
 * @param {string} url
 * @param {typeof fetch} fetchFn
 * @param {boolean} retry
 * @returns {Promise<any>} parsed JSON; rejects on failure
 */
async function getFile(url, fetchFn, retry) {
  let lastErr;
  for (let i = 0; i < (retry ? 2 : 1); i++) {
    try {
      const r = await fetchFn(url, { cache: 'no-cache' });
      if (!r || !r.ok) {
        lastErr = new Error(url + ' HTTP ' + (r ? r.status : '?'));
        if (r && r.status === 404) break;
        continue;
      }
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(url + ' failed');
}

/**
 * Sanitize the raw parsed files into the store slices.
 * @param {string} key store key
 * @param {any} v parsed JSON
 * @returns {object} cleaned value (always an object)
 */
export function cleanSlice(key, v) {
  if (!isObj(v)) return {};
  const out = {};
  for (const [id, x] of Object.entries(v)) {
    if (key === 'stops') {
      if (!isObj(x)) continue;
      const lat = num(x.lat), lon = num(x.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out[id] = { ...x, name: x.name != null ? String(x.name) : 'Stop ' + id, lat, lon };
    } else if (key === 'routes') {
      if (!isObj(x)) continue;
      out[id] = { ...x, short: String(x.short ?? ''), long: String(x.long ?? ''), color: x.color || '', text_color: x.text_color || '' };
    } else if (key === 'shapes') {
      if (Array.isArray(x)) out[id] = x.filter((line) => Array.isArray(line) && line.length);
    } else if (key === 'routeStops') {
      if (Array.isArray(x)) out[id] = x.filter((s) => s != null).map(String);
    } else if (key === 'addresses') {
      if (isObj(x) && x.address) out[id] = x;
    } else if (key === 'service') {
      if (id === 'routes') out.routes = cleanServiceRoutes(x);
      else if (id === 'feed' || id === 'generated') out[id] = x;
    } else out[id] = x;
  }
  return out;
}

/**
 * Keep only well-formed route entries of service.json ({days:{mon..sun}, exceptions:[]}).
 * @param {any} v service.routes
 * @returns {object}
 */
function cleanServiceRoutes(v) {
  const out = {};
  if (!isObj(v)) return out;
  for (const [rid, r] of Object.entries(v)) {
    if (!isObj(r) || !isObj(r.days)) continue;
    const days = {};
    for (const k of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) days[k] = isObj(r.days[k]) ? r.days[k] : null;
    out[rid] = { days, exceptions: Array.isArray(r.exceptions) ? r.exceptions.filter(isObj) : [] };
  }
  return out;
}

/**
 * Derive stopId -> [routeId] from routeId -> [stopId] (each route listed once per stop).
 * @param {{[rid:string]: string[]}} routeStops
 * @returns {{[stopId:string]: string[]}}
 */
export function deriveStopRoutes(routeStops) {
  const out = {};
  for (const [rid, ids] of Object.entries(routeStops || {})) {
    for (const id of new Set(ids || [])) (out[id] ||= []).push(rid);
  }
  return out;
}

/**
 * Load routes/stops/shapes/route_stops (+ optional stop_addresses, service) into the store, derive
 * stopRoutes, then set staticLoaded:true in one patch. Never rejects; failed files leave empty slices.
 * @param {{set(patch:object):void}} store
 * @param {{base?:string, fetch?:typeof fetch}} [opts] base URL of the data folder (default 'data/')
 * @returns {Promise<{failed:string[]}>} names of files that could not be loaded (required or optional)
 */
export async function loadStatic(store, opts = {}) {
  const base = opts.base ?? 'data/';
  const fetchFn = opts.fetch || ((...a) => globalThis.fetch(...a));
  const results = await Promise.allSettled(STATIC_FILES.map(([, f, req]) => getFile(base + f, fetchFn, req)));
  const patch = {}, failed = [];
  results.forEach((res, i) => {
    const [key, file, req] = STATIC_FILES[i];
    if (res.status === 'fulfilled' && isObj(res.value)) patch[key] = cleanSlice(key, res.value);
    else {
      patch[key] = {};
      failed.push(file);
      if (req) console.warn('static data failed:', file, res.status === 'rejected' ? res.reason : 'not an object');
    }
  });
  patch.stopRoutes = deriveStopRoutes(patch.routeStops);
  patch.staticLoaded = true;
  store.set(patch);
  return { failed };
}

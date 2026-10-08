// Place search via Photon (photon.komoot.io, OpenStreetMap data).
// Privacy: only the typed text is sent, plus fixed constants (Hyde Park bias point, Illinois bbox),
// never the user's location.
// Results: Illinois only (state check, bbox fallback), re-ranked toward UChicago / Hyde Park.

/** Photon API endpoint. */
export const PHOTON = 'https://photon.komoot.io/api/';
/** UChicago / Hyde Park: Photon bias point and the origin for client-side ranking. */
export const HOME = { lat: 41.7886, lon: -87.5987 };
/** Approximate Illinois bounding box [minLon, minLat, maxLon, maxLat]. */
export const IL_BBOX = [-91.52, 36.97, -87.49, 42.51];
const ZOOM = 10;          // Photon bias radius (lower = wider); 10 ~ metro scale, 14+ floods with local junk
const BIAS_SCALE = 0.2;   // Photon location_bias_scale (0..1, higher = prominence counts more)
const FETCH_LIMIT = 15;   // ask for more than we show so the Illinois filter still leaves results
const LIMIT = 5;
const TIMEOUT_MS = 8000;
const CACHE_MAX = 30;
// Distance tiers from HOME (km): campus / Hyde Park, Chicago city, Chicago metro, rest of Illinois.
const TIERS = [3, 20, 80];
const TIER_STEP = 8;      // score cost per tier; Photon rank adds 0..14, so tiers mostly decide
const KM_PER_POINT = 5;   // within a tier, closer still wins: +1 per 5 km ...
const KM_CAP = 20;        // ... up to 20 km (+4)
const MAX_EXTRA_WORDS = 3;
const SETTLEMENTS = new Set(['city', 'town', 'village']);
// OSM kinds that are usually the thing people mean (-2) or a by-product of it (+3).
const MAJOR = new Set(['railway:station', 'aeroway:aerodrome', 'aeroway:terminal', 'building:train_station',
  'amenity:university', 'amenity:college', 'amenity:library', 'amenity:hospital', 'amenity:bus_station',
  'tourism:museum', 'tourism:zoo', 'tourism:attraction', 'leisure:park', 'leisure:stadium',
  'place:city', 'place:town', 'place:village', 'place:suburb', 'place:neighbourhood']);
const MINOR = new Set(['amenity:parking', 'amenity:parking_entrance', 'amenity:bicycle_rental',
  'highway:bus_stop', 'public_transport:platform', 'public_transport:stop_position', 'railway:stop',
  'railway:platform', 'railway:subway_entrance']);
// Cook County townships that lie inside Chicago; Photon often reports these instead of the city.
const CHICAGO_TOWNSHIPS = new Set(['hyde park township', 'lake township', 'jefferson township',
  'north chicago township', 'west chicago township', 'south chicago township', 'lake view township',
  'rogers park township']);
const STATE_ABBR = { illinois: 'IL' };
const cache = new Map(); // q (lowercased) -> items

/** Distance in km (equirectangular; fine at state scale). */
function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const x = (lon2 - lon1) * r * Math.cos(((lat1 + lat2) / 2) * r);
  return 6371 * Math.hypot(x, (lat2 - lat1) * r);
}

/** Locality for the sub line: city, or "Chicago" for Chicago townships, else district / county. */
function locality(p) {
  const city = String(p.city || '');
  if (city && CHICAGO_TOWNSHIPS.has(city.toLowerCase())) return 'Chicago';
  if (city && !/ township$/i.test(city)) return city;
  if (p.district) return String(p.district);
  if (city) return city;
  if (p.county) return /county$/i.test(p.county) ? String(p.county) : p.county + ' County';
  return '';
}

/**
 * Turn one Photon GeoJSON feature into a suggestion. `sub` shows street, city and state.
 * @param {any} f feature
 * @param {string} q original query (label fallback)
 * @returns {{label:string, sub:string, lat:number, lon:number}|null}
 */
export function featureToPlace(f, q) {
  const c = f?.geometry?.coordinates;
  if (!Array.isArray(c) || !Number.isFinite(Number(c[0])) || !Number.isFinite(Number(c[1]))) return null;
  const p = f.properties || {};
  const street = p.street ? (p.housenumber ? p.housenumber + ' ' : '') + p.street : '';
  const loc = locality(p);
  const state = p.state ? STATE_ABBR[String(p.state).toLowerCase()] || String(p.state) : '';
  const label = String(p.name || street || loc || q);
  const sub = [p.name ? street : '', loc === label ? '' : loc, state].filter(Boolean).join(', ');
  return { label, sub: sub || 'Place', lat: Number(c[1]), lon: Number(c[0]) };
}

/**
 * Illinois-only rule: drop non-US; if a state is given it must be Illinois; otherwise the point must
 * fall inside IL_BBOX.
 * @param {any} f Photon feature (coordinates already validated)
 */
export function inIllinois(f) {
  const p = f.properties || {};
  if (p.countrycode && String(p.countrycode).toUpperCase() !== 'US') return false;
  if (!p.countrycode && p.country && !/^united states/i.test(String(p.country))) return false;
  if (p.state) return /^(illinois|il)$/i.test(String(p.state).trim());
  const [lon, lat] = f.geometry.coordinates.map(Number);
  return lon >= IL_BBOX[0] && lon <= IL_BBOX[2] && lat >= IL_BBOX[1] && lat <= IL_BBOX[3];
}

const words = (s) => String(s || '').toLowerCase().replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Filter to Illinois, dedupe, and re-rank Photon features toward HOME. Lower score is better:
 * Photon rank (0..n) + TIER_STEP per distance tier + 1 per 5 km (max 4) + 1 per name word not in
 * the query (max 3)
 * -2 for major kinds (stations, airports, campus, museums, parks), +3 for by-products (parking,
 * bike docks, stops). An exact-name city/town/village match is pinned first ("Springfield").
 * @param {any[]} features Photon features in Photon's order
 * @param {string} query typed text
 * @returns {{label:string, sub:string, lat:number, lon:number}[]} at most LIMIT items
 */
export function rankPlaces(features, query) {
  const qw = words(query);
  const qn = qw.join(' ');
  const scored = [];
  features.forEach((f, i) => {
    const place = featureToPlace(f, query);
    if (!place || !inIllinois(f)) return;
    const p = f.properties || {};
    const d = km(HOME.lat, HOME.lon, place.lat, place.lon);
    const tier = TIERS.filter((t) => d > t).length;
    const nw = words(p.name);
    const extra = Math.min(MAX_EXTRA_WORDS, nw.filter((w) => !qw.some((x) => w.startsWith(x))).length);
    const kind = p.osm_key + ':' + p.osm_value;
    let score = i + TIER_STEP * tier + Math.min(d, KM_CAP) / KM_PER_POINT + extra
      + (MAJOR.has(kind) ? -2 : MINOR.has(kind) ? 3 : 0);
    if (p.osm_key === 'place' && SETTLEMENTS.has(p.osm_value) && nw.join(' ') === qn) score = -100;
    scored.push({ place, score, d });
  });
  scored.sort((a, b) => a.score - b.score || a.d - b.d);
  const out = [];
  for (const s of scored) {
    // Same name within 300 m (stops, entrances, duplicate OSM objects), or same name and sub line
    // within 2 km (one street split into segments), is the same place: keep the better-ranked one.
    const dup = out.some((o) => o.label === s.place.label
      && km(o.lat, o.lon, s.place.lat, s.place.lon) < (o.sub === s.place.sub ? 2 : 0.3));
    if (!dup) out.push(s.place);
    if (out.length >= LIMIT) break;
  }
  return out;
}

/**
 * Photon request URL for a query: text + fixed bias + Illinois bbox (never the user's location).
 * @param {string} query trimmed text
 */
export function photonUrl(query) {
  return PHOTON + '?q=' + encodeURIComponent(query) + '&limit=' + FETCH_LIMIT + '&lang=en'
    + '&lat=' + HOME.lat + '&lon=' + HOME.lon + '&zoom=' + ZOOM + '&location_bias_scale=' + BIAS_SCALE
    + '&bbox=' + IL_BBOX.join(',');
}

/**
 * Search places by free text. Never throws. Illinois only, nearest-to-UChicago first, max 5.
 * @param {string} q query (caller enforces >= 3 chars; shorter returns no items)
 * @param {{signal?:AbortSignal, fetch?:typeof fetch}} [opts]
 * @returns {Promise<{items:{label:string, sub:string, lat:number, lon:number}[], error?:string}>}
 *   error is one of 'aborted' | 'timeout' | 'network' | 'http <status>' | 'bad response'
 */
export async function searchPlaces(q, opts = {}) {
  const query = String(q ?? '').trim();
  if (query.length < 3) return { items: [] };
  const signal = opts.signal;
  if (signal?.aborted) return { items: [], error: 'aborted' };
  const key = query.toLowerCase();
  if (cache.has(key)) return { items: cache.get(key).map((x) => ({ ...x })) };

  const fetchFn = opts.fetch || ((...a) => globalThis.fetch(...a));
  const ctl = new AbortController();
  let timedOut = false;
  const to = setTimeout(() => { timedOut = true; ctl.abort(); }, TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const r = await fetchFn(photonUrl(query), { signal: ctl.signal });
    if (!r || !r.ok) return { items: [], error: 'http ' + (r ? r.status : '?') };
    let j;
    try { j = await r.json(); } catch { return { items: [], error: ctl.signal.aborted ? (timedOut ? 'timeout' : 'aborted') : 'bad response' }; }
    if (!j || !Array.isArray(j.features)) return { items: [], error: 'bad response' };
    const items = rankPlaces(j.features, query);
    if (signal?.aborted) return { items: [], error: 'aborted' };
    cache.set(key, items);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return { items: items.map((x) => ({ ...x })) };
  } catch {
    if (timedOut) return { items: [], error: 'timeout' };
    if (signal?.aborted || ctl.signal.aborted) return { items: [], error: 'aborted' };
    return { items: [], error: 'network' };
  } finally {
    clearTimeout(to);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Clear the in-memory result cache (tests). */
export function clearPlaceCache() { cache.clear(); }

/**
 * Trailing-edge debounce.
 * @template {(...args:any[]) => any} F
 * @param {F} fn
 * @param {number} [ms=400]
 * @returns {F & {cancel():void, flush():void}} call to (re)schedule; cancel() drops a pending call; flush() runs it now
 */
export function debounce(fn, ms = 400) {
  let t = 0, args = null, self = null;
  const d = function (...a) {
    args = a; self = this;
    clearTimeout(t);
    t = setTimeout(() => { t = 0; const x = args; args = null; fn.apply(self, x); }, ms);
  };
  d.cancel = () => { clearTimeout(t); t = 0; args = null; };
  d.flush = () => { if (!t) return; clearTimeout(t); t = 0; const x = args; args = null; fn.apply(self, x); };
  return d;
}

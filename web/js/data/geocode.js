// Place search via Photon (photon.komoot.io, OpenStreetMap data).
// Privacy: only the typed text is sent (plus a fixed Hyde Park bias point), never the user's location.

/** Photon API endpoint. */
export const PHOTON = 'https://photon.komoot.io/api/';
const BIAS = { lat: 41.79, lon: -87.60 };
const LIMIT = 5;
const TIMEOUT_MS = 8000;
const CACHE_MAX = 30;
const cache = new Map(); // q (lowercased) -> items

/**
 * Turn one Photon GeoJSON feature into a suggestion.
 * @param {any} f feature
 * @param {string} q original query (label fallback)
 * @returns {{label:string, sub:string, lat:number, lon:number}|null}
 */
export function featureToPlace(f, q) {
  const c = f?.geometry?.coordinates;
  if (!Array.isArray(c) || !Number.isFinite(Number(c[0])) || !Number.isFinite(Number(c[1]))) return null;
  const p = f.properties || {};
  const street = p.street ? (p.housenumber ? p.housenumber + ' ' : '') + p.street : '';
  const line = [street, p.city || p.county, p.state].filter(Boolean).join(', ');
  return { label: String(p.name || line || q), sub: p.name ? line : 'Place', lat: Number(c[1]), lon: Number(c[0]) };
}

/**
 * Search places by free text. Never throws.
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
  const url = PHOTON + '?q=' + encodeURIComponent(query) + '&limit=' + LIMIT + '&lat=' + BIAS.lat + '&lon=' + BIAS.lon + '&lang=en';
  try {
    const r = await fetchFn(url, { signal: ctl.signal });
    if (!r || !r.ok) return { items: [], error: 'http ' + (r ? r.status : '?') };
    let j;
    try { j = await r.json(); } catch { return { items: [], error: ctl.signal.aborted ? (timedOut ? 'timeout' : 'aborted') : 'bad response' }; }
    if (!j || !Array.isArray(j.features)) return { items: [], error: 'bad response' };
    const items = j.features.map((f) => featureToPlace(f, query)).filter(Boolean).slice(0, LIMIT);
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

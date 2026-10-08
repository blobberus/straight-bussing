/**
 * @module core/walk
 * Pedestrian routing along sidewalks/footpaths.
 *  Primary:  FOSSGIS OSRM foot  https://routing.openstreetmap.de/routed-foot/route/v1/foot/{lon},{lat};{lon},{lat}
 *  Fallback: OSM DE Valhalla    https://valhalla1.openstreetmap.de/route  (costing 'pedestrian')
 *  Last resort: straight line x 1.2 ('estimate').
 * Privacy: only the two endpoints, rounded to 4 dp (~11 m), are sent. 3 s timeout per server,
 * at most 6 requests in flight, in-memory cache keyed by the rounded endpoints (failures retried
 * after 60 s). Minutes are always meters / 80 (the planner's pace). Never rejects.
 */
import { hav, walkMin, WALK_DETOUR as DETOUR } from "./geo.js";

const TIMEOUT_MS = 3000;
const MAX_PAR = 6;
const FAIL_TTL_MS = 60000;
const OSRM = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";
const VALHALLA = "https://valhalla1.openstreetmap.de/route";

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const norm = (p) => ({ lat: r4(Number(p.lat)), lon: r4(Number(p.lon)) });
const keyOf = (a, b) => `${a.lat},${a.lon}>${b.lat},${b.lon}`;

let fetchImpl = (...args) => fetch(...args);
let timeoutMs = TIMEOUT_MS;
const cache = new Map(); // key -> {res, exp}
const inflight = new Map(); // key -> Promise
const queue = [];
let active = 0;

/**
 * Straight-line x 1.2 walking estimate.
 * @param {{lat:number,lon:number}} a
 * @param {{lat:number,lon:number}} b
 * @returns {{m:number, min:number, coords:Array<[number,number]>, source:'estimate'}}
 */
export function walkEstimate(a, b) {
  const m = hav(a, b) * DETOUR;
  return { m: Math.round(m), min: walkMin(m), coords: [[a.lat, a.lon], [b.lat, b.lon]], source: "estimate" };
}

/** Decode a Valhalla polyline (precision 6) to [[lat, lon], ...]. */
export function decodePolyline6(s) {
  const out = [];
  let i = 0, la = 0, lo = 0;
  while (i < s.length) {
    for (let isLon = 0; isLon < 2; isLon++) {
      let sh = 0, r = 0, c;
      do {
        c = s.charCodeAt(i++) - 63;
        r |= (c & 31) << sh;
        sh += 5;
      } while (c >= 32 && i <= s.length);
      const d = r & 1 ? ~(r >> 1) : r >> 1;
      if (isLon) lo += d;
      else la += d;
    }
    out.push([la / 1e6, lo / 1e6]);
  }
  return out;
}

async function getJSON(url) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => {
      if (ctl) ctl.abort();
      rej(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    const r = await Promise.race([fetchImpl(url, { signal: ctl ? ctl.signal : undefined, cache: "no-store" }), timeout]);
    if (!r || !r.ok) throw new Error("http " + (r && r.status));
    return await Promise.race([r.json(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function viaOSRM(a, b) {
  const j = await getJSON(`${OSRM}${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`);
  const rt = j && j.routes && j.routes[0];
  if (!j || j.code !== "Ok" || !rt || !rt.geometry) throw new Error("no route");
  return { m: Number(rt.distance), coords: rt.geometry.coordinates.map((c) => [c[1], c[0]]) };
}

async function viaValhalla(a, b) {
  const q = { locations: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }], costing: "pedestrian", directions_options: { units: "kilometers" } };
  const j = await getJSON(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(q))}`);
  const t = j && j.trip;
  if (!t || !t.legs || !t.legs[0] || !t.legs[0].shape || !t.summary) throw new Error("no route");
  return { m: Number(t.summary.length) * 1000, coords: decodePolyline6(t.legs[0].shape) };
}

async function fetchRoute(a, b) {
  const straight = hav(a, b);
  for (const via of [viaOSRM, viaValhalla]) {
    try {
      const r = await via(a, b);
      const okShape = Array.isArray(r.coords) && r.coords.length >= 2 && r.coords.every((c) => isFinite(c[0]) && isFinite(c[1]));
      if (!okShape || !isFinite(r.m) || r.m < straight * 0.9 - 5 || r.m > straight * 6 + 200) continue; // implausible
      const coords = [[a.lat, a.lon], ...r.coords, [b.lat, b.lon]];
      return { m: Math.round(r.m), min: walkMin(r.m), coords, source: "router" };
    } catch (e) {
      /* try the next server */
    }
  }
  return null;
}

function pump() {
  while (active < MAX_PAR && queue.length) {
    const job = queue.shift();
    active++;
    fetchRoute(job.a, job.b)
      .then((r) => {
        const res = r || walkEstimate(job.a, job.b);
        cache.set(job.k, { res, exp: r ? Infinity : Date.now() + FAIL_TTL_MS });
        return res;
      })
      .catch(() => walkEstimate(job.a, job.b))
      .then((res) => {
        inflight.delete(job.k);
        job.ok(res);
      })
      .finally(() => {
        active--;
        pump();
      });
  }
}

/**
 * Cached result for a pair if available (no network).
 * @param {{lat:number,lon:number}} from
 * @param {{lat:number,lon:number}} to
 * @returns {{m:number, min:number, coords:Array, source:string}|null}
 */
export function peekWalk(from, to) {
  const k = keyOf(norm(from), norm(to));
  const c = cache.get(k);
  if (!c) return null;
  if (c.exp < Date.now()) {
    cache.delete(k);
    return null;
  }
  return c.res;
}

/**
 * Walking route between two points along sidewalks. Never rejects.
 * @param {{lat:number,lon:number}} from
 * @param {{lat:number,lon:number}} to
 * @returns {Promise<{m:number, min:number, coords:Array<[number,number]>, source:'router'|'estimate'}>}
 */
export function walkRoute(from, to) {
  try {
    const a = norm(from), b = norm(to);
    if (![a.lat, a.lon, b.lat, b.lon].every(isFinite)) {
      return Promise.resolve({ m: 0, min: 0, coords: [], source: "estimate" });
    }
    if (a.lat === b.lat && a.lon === b.lon) return Promise.resolve({ m: 0, min: 0, coords: [[a.lat, a.lon]], source: "estimate" });
    const k = keyOf(a, b);
    const hit = peekWalk(a, b);
    if (hit) return Promise.resolve(hit);
    if (inflight.has(k)) return inflight.get(k);
    const p = new Promise((ok) => queue.push({ k, a, b, ok }));
    inflight.set(k, p);
    pump();
    return p;
  } catch (e) {
    try {
      return Promise.resolve(walkEstimate(from, to));
    } catch (e2) {
      return Promise.resolve({ m: 0, min: 0, coords: [], source: "estimate" });
    }
  }
}

/**
 * Test hook: replace fetch and/or the per-server timeout, and clear the cache.
 * @param {{fetch?:Function, timeoutMs?:number}} [opts] omit to restore defaults
 */
export function configureWalk({ fetch: f, timeoutMs: t } = {}) {
  fetchImpl = typeof f === "function" ? f : (...args) => fetch(...args);
  timeoutMs = typeof t === "number" ? t : TIMEOUT_MS;
  cache.clear();
  inflight.clear();
}

/** @returns {{active:number, queued:number, cached:number}} current router load (tests/debug) */
export function walkStats() {
  return { active, queued: queue.length, cached: cache.size };
}

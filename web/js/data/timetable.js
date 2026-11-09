/**
 * @module data/timetable
 * The published timetable (data/timetable.json, tools/build_gtfs.py build_timetable) for planning a trip at a chosen
 * start time (Directions' "Leave at", owner 2026-11-09). Loaded lazily: only when the rider opens the start time
 * picker or plans at a chosen time, never at boot, so first paint never waits for it (ship checklist 3). One request
 * at a time; a failed load resolves null and the next call tries again. The service worker precaches the file, so it
 * also works offline once the app has been installed.
 *
 * Shape after cleanTimetable (bad entries dropped, never throws):
 *   {v:1, generated, feed:{start, end}, services:{sid:{days:"1111100", start, end}}, dates:{iso:{sid:1|2}},
 *    routes:{rid:[{stops:[id], t:[s], starts:{sid:[s]}}]}}
 */

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fin = (x) => typeof x === "number" && Number.isFinite(x);

let cached = null, pending = null;

/**
 * Keep only well-formed parts of a parsed timetable.json.
 * @param {any} v
 * @returns {object|null} null when nothing usable is left
 */
export function cleanTimetable(v) {
  if (!isObj(v) || !isObj(v.routes) || !isObj(v.services)) return null;
  const services = {};
  for (const [sid, s] of Object.entries(v.services)) {
    if (!isObj(s) || !/^[01]{7}$/.test(String(s.days || ""))) continue;
    services[sid] = { days: String(s.days), start: ISO.test(String(s.start)) ? String(s.start) : null, end: ISO.test(String(s.end)) ? String(s.end) : null };
  }
  const dates = {};
  for (const [iso, m] of Object.entries(isObj(v.dates) ? v.dates : {})) {
    if (!ISO.test(iso) || !isObj(m)) continue;
    const day = {};
    for (const [sid, typ] of Object.entries(m)) if (typ === 1 || typ === 2) day[sid] = typ;
    if (Object.keys(day).length) dates[iso] = day;
  }
  const routes = {};
  for (const [rid, pats] of Object.entries(v.routes)) {
    if (!Array.isArray(pats)) continue;
    const list = [];
    for (const p of pats) {
      if (!isObj(p) || !Array.isArray(p.stops) || !Array.isArray(p.t) || p.stops.length !== p.t.length || p.stops.length < 2) continue;
      if (!p.t.every((x, i) => fin(x) && x >= 0 && (i === 0 || x >= p.t[i - 1]))) continue;
      const starts = {};
      for (const [sid, arr] of Object.entries(isObj(p.starts) ? p.starts : {})) {
        if (!services[sid] || !Array.isArray(arr)) continue;
        const ok = arr.filter((x) => fin(x) && x >= 0 && x < 3 * 86400).sort((a, b) => a - b);
        if (ok.length) starts[sid] = ok;
      }
      if (Object.keys(starts).length) list.push({ stops: p.stops.map(String), t: p.t.slice(), starts });
    }
    if (list.length) routes[String(rid)] = list;
  }
  if (!Object.keys(routes).length) return null;
  const feed = isObj(v.feed) ? { start: ISO.test(String(v.feed.start)) ? String(v.feed.start) : null, end: ISO.test(String(v.feed.end)) ? String(v.feed.end) : null } : { start: null, end: null };
  return { v: 1, generated: v.generated ? String(v.generated) : null, feed, services, dates, routes };
}

/**
 * The timetable, loading it on first use (one fetch in flight; null on failure, retried on the next call).
 * @param {{base?:string, fetch?:typeof fetch}} [opts]
 * @returns {Promise<object|null>}
 */
export function loadTimetable(opts = {}) {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  const base = opts.base ?? "data/";
  const fetchFn = opts.fetch || ((...a) => globalThis.fetch(...a));
  pending = (async () => {
    try {
      const r = await fetchFn(base + "timetable.json", { cache: "no-cache" });
      if (!r || !r.ok) return null;
      cached = cleanTimetable(await r.json());
      return cached;
    } catch (e) {
      return null;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** The timetable if it has loaded, else null (no request). */
export const timetableNow = () => cached;

/** Tests: forget the loaded copy (or put one in place). */
export function _setTimetable(v = null) { cached = v; pending = null; }

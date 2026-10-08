"use strict";
/* Walk.route(from,to) -> Promise<{m, min, coords:[[lat,lon],...], source:'router'|'estimate'}>
   Pedestrian routing along sidewalks/footpaths. Primary: FOSSGIS OSRM foot. Fallback: OSM Foundation Valhalla pedestrian.
   Falls back to straight line x 1.2 on failure/timeout (3 s per server). Only start/end coords (rounded to 4 dp) are sent.
   Minutes always = metres / 80 per min (same pace as the planner). Cache is in memory only. Max 6 requests in flight. */
(function () {
  const PACE = 80, DETOUR = 1.2, TIMEOUT = 3000, MAX_PAR = 6, FAIL_TTL = 60000, rad = Math.PI / 180;
  const OSRM = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/", VALH = "https://valhalla1.openstreetmap.de/route";
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const keyOf = (a, b) => r4(a.lat) + "," + r4(a.lon) + ">" + r4(b.lat) + "," + r4(b.lon);
  const cache = new Map(), inflight = new Map(), queue = []; let active = 0;
  function hav(a, b) {
    const dLa = (b.lat - a.lat) * rad, dLo = (b.lon - a.lon) * rad;
    const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLo / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(x));
  }
  function estimate(a, b) { const m = hav(a, b) * DETOUR; return { m: Math.round(m), min: m / PACE, coords: [[a.lat, a.lon], [b.lat, b.lon]], source: "estimate" }; }
  function decode6(s) { // Valhalla encoded polyline, precision 6
    const out = []; let i = 0, la = 0, lo = 0;
    while (i < s.length) { for (const isLon of [0, 1]) { let sh = 0, r = 0, c; do { c = s.charCodeAt(i++) - 63; r |= (c & 31) << sh; sh += 5; } while (c >= 32); const d = r & 1 ? ~(r >> 1) : r >> 1; if (isLon) lo += d; else la += d; } out.push([la / 1e6, lo / 1e6]); }
    return out;
  }
  async function getJSON(url) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
    try { const r = await fetch(url, { signal: ctl.signal, cache: "no-store" }); if (!r.ok) throw new Error("http " + r.status); return await r.json(); } finally { clearTimeout(t); }
  }
  async function viaOSRM(a, b) {
    const j = await getJSON(OSRM + a.lon + "," + a.lat + ";" + b.lon + "," + b.lat + "?overview=full&geometries=geojson");
    const rt = j.routes && j.routes[0]; if (j.code !== "Ok" || !rt) throw new Error("no route");
    return { m: rt.distance, coords: rt.geometry.coordinates.map((c) => [c[1], c[0]]) };
  }
  async function viaValhalla(a, b) {
    const q = { locations: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }], costing: "pedestrian", directions_options: { units: "kilometers" } };
    const j = await getJSON(VALH + "?json=" + encodeURIComponent(JSON.stringify(q)));
    const t = j.trip; if (!t || !t.legs || !t.legs[0] || !t.legs[0].shape) throw new Error("no route");
    return { m: t.summary.length * 1000, coords: decode6(t.legs[0].shape) };
  }
  async function fetchRoute(a, b) {
    for (const f of [viaOSRM, viaValhalla]) {
      try {
        const r = await f(a, b), straight = hav(a, b);
        if (!(r.coords.length >= 2) || !isFinite(r.m) || r.m < straight * 0.9 - 5 || r.m > straight * 6 + 200) continue; // implausible
        const coords = [[a.lat, a.lon], ...r.coords, [b.lat, b.lon]];
        return { m: Math.round(r.m), min: r.m / PACE, coords, source: "router" };
      } catch (e) { /* try next */ }
    }
    return null;
  }
  function pump() {
    while (active < MAX_PAR && queue.length) {
      const job = queue.shift(); active++;
      fetchRoute(job.a, job.b).then((r) => { const res = r || estimate(job.a, job.b); cache.set(job.k, { res, exp: r ? Infinity : Date.now() + FAIL_TTL }); inflight.delete(job.k); job.ok(res); })
        .catch(() => { const res = estimate(job.a, job.b); inflight.delete(job.k); job.ok(res); })
        .finally(() => { active--; pump(); });
    }
  }
  const norm = (p) => ({ lat: r4(p.lat), lon: r4(p.lon) });
  function peek(from, to) { const c = cache.get(keyOf(from, to)); if (!c) return null; if (c.exp < Date.now()) { cache.delete(keyOf(from, to)); return null; } return c.res; }
  function route(from, to) {
    const k = keyOf(from, to), hit = peek(from, to); if (hit) return Promise.resolve(hit);
    if (inflight.has(k)) return inflight.get(k);
    const a = norm(from), b = norm(to);
    if (a.lat === b.lat && a.lon === b.lon) return Promise.resolve({ m: 0, min: 0, coords: [[a.lat, a.lon]], source: "estimate" });
    const p = new Promise((ok) => { queue.push({ k, a, b, ok }); }); inflight.set(k, p); pump(); return p;
  }
  window.Walk = { route, peek, estimate, _cache: cache };
})();

// Tests for core/walk.js (network stubbed; never hits the real routers)
import { test, eq, ok, near } from "./lib.js";
import { walkRoute, walkEstimate, decodePolyline6, configureWalk, peekWalk, walkStats } from "../js/core/walk.js";
import { hav } from "../js/core/geo.js";

function encode6(pts) {
  let out = "", pla = 0, plo = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  for (const [la, lo] of pts) {
    const a = Math.round(la * 1e6), b = Math.round(lo * 1e6);
    out += enc(a - pla) + enc(b - plo);
    pla = a; plo = b;
  }
  return out;
}
const json = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
const osrmOk = (m, pts) => json({ code: "Ok", routes: [{ distance: m, geometry: { coordinates: pts.map(([la, lo]) => [lo, la]) } }] });
let base = 0;
// Each test uses fresh coordinates so caches never collide.
const pair = () => {
  base += 0.01;
  return [{ lat: 41.7 + base, lon: -87.6 }, { lat: 41.7 + base + 0.0036, lon: -87.6 }]; // ~400 m apart
};

test("decodePolyline6 round-trips", () => {
  const pts = [[41.78912, -87.599712], [41.79, -87.6], [41.8001, -87.5901]];
  const d = decodePolyline6(encode6(pts));
  eq(d.length, 3);
  d.forEach((p, i) => { near(p[0], pts[i][0], 1e-6); near(p[1], pts[i][1], 1e-6); });
});

test("walkEstimate is straight line x 1.2 at 80 m/min", () => {
  const [a, b] = pair();
  const e = walkEstimate(a, b);
  near(e.m, hav(a, b) * 1.2, 1);
  near(e.min, e.m / 80, 0.02);
  eq(e.source, "estimate");
  eq(e.coords.length, 2);
});

test("OSRM primary: router result, 4 dp coords sent, cached afterwards", async () => {
  const urls = [];
  configureWalk({ fetch: (u) => { urls.push(String(u)); return osrmOk(500, [[1, 2], [3, 4]]); } });
  const a = { lat: 41.791234567, lon: -87.601234567 }, b = { lat: 41.794987654, lon: -87.600111111 };
  const r = await walkRoute(a, b);
  eq(r.source, "router");
  eq(r.m, 500);
  near(r.min, 6.25, 1e-9);
  eq(r.coords[0], [41.7912, -87.6012]);
  eq(r.coords[r.coords.length - 1], [41.795, -87.6001]);
  eq(r.coords.length, 4);
  eq(urls.length, 1);
  ok(urls[0].startsWith("https://routing.openstreetmap.de/routed-foot/route/v1/foot/-87.6012,41.7912;-87.6001,41.795?"), urls[0]);
  ok(/overview=full/.test(urls[0]) && /geometries=geojson/.test(urls[0]));
  ok(!/\d\.\d{5,}/.test(urls[0]), "no more than 4 decimals leave the device");
  const again = await walkRoute(a, b);
  eq(urls.length, 1, "served from cache");
  eq(again, r);
  eq(peekWalk(a, b), r);
});

test("Valhalla fallback when OSRM fails", async () => {
  const urls = [];
  const [a, b] = pair();
  const shape = encode6([[a.lat, a.lon], [a.lat + 0.002, a.lon + 0.001], [b.lat, b.lon]]);
  configureWalk({ fetch: (u) => {
    urls.push(String(u));
    if (String(u).includes("routed-foot")) return json({}, 503);
    return json({ trip: { legs: [{ shape }], summary: { length: 0.52 } } });
  } });
  const r = await walkRoute(a, b);
  eq(r.source, "router");
  eq(r.m, 520);
  eq(urls.length, 2);
  ok(urls[1].startsWith("https://valhalla1.openstreetmap.de/route?json="), urls[1]);
  const q = JSON.parse(decodeURIComponent(urls[1].split("json=")[1]));
  eq(q.costing, "pedestrian");
  eq(r.coords.length, 5);
});

test("implausible router distance is rejected", async () => {
  const [a, b] = pair();
  configureWalk({ fetch: (u) => String(u).includes("routed-foot") ? osrmOk(50, [[1, 2], [3, 4]]) : json({ code: "x" }) });
  const r = await walkRoute(a, b);
  eq(r.source, "estimate");
});

test("both routers fail -> estimate (not cached forever)", async () => {
  const [a, b] = pair();
  let n = 0;
  configureWalk({ fetch: () => { n++; return Promise.reject(new TypeError("offline")); } });
  const r = await walkRoute(a, b);
  eq(r.source, "estimate");
  near(r.m, hav(a, b) * 1.2, 1);
  eq(n, 2);
});

test("timeout per server -> estimate quickly", async () => {
  const [a, b] = pair();
  configureWalk({ fetch: () => new Promise(() => {}), timeoutMs: 40 });
  const t0 = performance.now();
  const r = await walkRoute(a, b);
  eq(r.source, "estimate");
  ok(performance.now() - t0 < 2000, "took " + (performance.now() - t0));
});

test("concurrent identical requests share one fetch", async () => {
  const [a, b] = pair();
  let n = 0;
  configureWalk({ fetch: () => { n++; return new Promise((res) => setTimeout(() => res(osrmOk(450, [[0, 0], [0, 0]])), 20)); } });
  const [r1, r2] = await Promise.all([walkRoute(a, b), walkRoute(a, b)]);
  eq(n, 1);
  eq(r1, r2);
});

test("at most 6 requests in flight", async () => {
  let cur = 0, max = 0;
  configureWalk({ fetch: () => {
    cur++; max = Math.max(max, cur);
    return new Promise((res) => setTimeout(() => { cur--; res(osrmOk(450, [[0, 0], [0, 0]])); }, 15));
  } });
  const jobs = [];
  for (let i = 0; i < 15; i++) { const [a, b] = pair(); jobs.push(walkRoute(a, b)); }
  const rs = await Promise.all(jobs);
  ok(max <= 6 && max >= 2, "max in flight " + max);
  ok(rs.every((r) => r.source === "router"));
  eq(walkStats().active, 0);
});

test("same point and invalid input never reject", async () => {
  configureWalk({ fetch: () => { throw new Error("should not fetch"); } });
  const p = { lat: 41.79, lon: -87.6 };
  eq((await walkRoute(p, { lat: 41.790001, lon: -87.600001 })).m, 0);
  eq((await walkRoute({ lat: NaN, lon: 1 }, p)).source, "estimate");
  eq((await walkRoute(null, p)).source, "estimate");
  configureWalk();
});

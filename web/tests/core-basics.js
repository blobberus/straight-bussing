// Tests for core/esc.js, core/time.js, core/geo.js, core/storage.js, core/events.js
import { test, eq, ok, near } from "./lib.js";
import { esc, safeColor, textOn, lum } from "../js/core/esc.js";
import { nowS, clock, minsUntil, ago } from "../js/core/time.js";
import { hav, walkMin, nearestStops, bearing } from "../js/core/geo.js";
import { load, save, remove } from "../js/core/storage.js";
import { bus } from "../js/core/events.js";

/* ---------- esc / colors ---------- */
test("esc escapes HTML specials", () => {
  eq(esc(`<img src=x onerror="alert('1')">&`), "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;");
  eq(esc("`tick`"), "&#96;tick&#96;");
});
test("esc handles null/undefined/numbers/objects", () => {
  eq(esc(null), "");
  eq(esc(undefined), "");
  eq(esc(0), "0");
  eq(esc(12.5), "12.5");
  eq(esc({ toString: () => "<b>" }), "&lt;b&gt;");
});
test("esc output contains no raw angle brackets or quotes", () => {
  const nasty = `"><script>alert(1)</script><a href='javascript:x'>`;
  ok(!/[<>"']/.test(esc(nasty)));
});
test("safeColor accepts valid hex and normalises", () => {
  eq(safeColor("#F7EB07"), "#F7EB07");
  eq(safeColor("#abcdef"), "#ABCDEF");
  eq(safeColor("00ff00"), "#00FF00");
  eq(safeColor(" #123456 "), "#123456");
});
test("safeColor rejects CSS injection and junk", () => {
  for (const bad of ["red", "#fff", "#12345g", "#123456;background:url(x)", "expression(alert(1))",
    "#123456\"><script>", "", null, undefined, 123456, {}, "#1234567"]) {
    eq(safeColor(bad), "#555555", "input " + String(bad));
  }
});
test("lum and textOn", () => {
  near(lum("#000000"), 0, 1e-9);
  near(lum("#FFFFFF"), 1, 1e-9);
  eq(textOn("#FFFFFF"), "#111114");
  eq(textOn("#F7EB07"), "#111114"); // yellow
  eq(textOn("#0000FF"), "#ffffff");
  eq(textOn("#000000"), "#ffffff");
  eq(textOn("garbage"), "#ffffff"); // falls back to #555555
});

/* ---------- time ---------- */
test("nowS is unix seconds", () => {
  near(nowS(), Date.now() / 1000, 2);
});
test("clock formats a local time with minutes", () => {
  const d = new Date(2026, 9, 7, 16, 5, 0); // local 4:05 PM
  const s = clock(d.getTime() / 1000);
  ok(/4:05/.test(s) || /16:05/.test(s), "got " + s);
  const m = clock(new Date(2026, 9, 7, 0, 30).getTime() / 1000);
  ok(/12:30|0?0:30/.test(m), "midnight got " + m);
});
test("clock returns '' for invalid input", () => {
  eq(clock(undefined), "");
  eq(clock(NaN), "");
  eq(clock(0), "");
  eq(clock("x"), "");
});
test("minsUntil floors and can be negative", () => {
  eq(minsUntil(1000 + 299, 1000), 4);
  eq(minsUntil(1000 + 59, 1000), 0);
  eq(minsUntil(1000 - 1, 1000), -1);
  eq(minsUntil(1000 - 120, 1000), -2);
  ok(minsUntil(nowS() + 600) >= 9);
});
test("ago produces short relative strings", () => {
  eq(ago(992, 1000), "8s ago");
  eq(ago(1000, 1000), "just now");
  eq(ago(1000 - 180, 1000), "3 min ago");
  eq(ago(100000 - 7200, 100000), "2 h ago");
  eq(ago(1000000 - 86400 * 3, 1000000), "3 d ago");
  eq(ago(0), "never");
  eq(ago(undefined), "never");
  ok(/ago|just now/.test(ago(nowS() - 5)));
});

/* ---------- geo ---------- */
const A = { lat: 41.7897, lon: -87.5997 };
test("hav: zero, symmetric, known distance", () => {
  near(hav(A, A), 0, 1e-6);
  const B = { lat: 41.7987, lon: -87.5997 }; // 0.009 deg north ~ 1000.8 m
  near(hav(A, B), 1000.8, 2);
  near(hav(A, B), hav(B, A), 1e-6);
  const C = { lat: 41.7897, lon: -87.5876 }; // 0.0121 deg east at 41.79N ~ 1003 m
  near(hav(A, C), 1003, 5);
});
test("walkMin is meters/80", () => {
  eq(walkMin(800), 10);
  eq(walkMin(40), 0.5);
  eq(walkMin(0), 0);
});
test("bearing: cardinal directions", () => {
  near(bearing(A, { lat: A.lat + 0.01, lon: A.lon }), 0, 0.01);
  near(bearing(A, { lat: A.lat, lon: A.lon + 0.01 }), 90, 0.1);
  near(bearing(A, { lat: A.lat - 0.01, lon: A.lon }), 180, 0.01);
  near(bearing(A, { lat: A.lat, lon: A.lon - 0.01 }), 270, 0.1);
});
test("nearestStops sorts, limits, applies radius and routeStops filter", () => {
  const stops = {
    s1: { name: "One", lat: A.lat + 0.001, lon: A.lon }, // ~111 m
    s2: { name: "Two", lat: A.lat + 0.003, lon: A.lon }, // ~333 m
    s3: { name: "Three", lat: A.lat + 0.0005, lon: A.lon }, // ~56 m
    s4: { name: "Far", lat: A.lat + 0.05, lon: A.lon }, // ~5.5 km
    bad: { name: "Bad", lat: NaN, lon: 0 },
  };
  const r = nearestStops(stops, A, { max: 2 });
  eq(r.map((s) => s.id), ["s3", "s1"]);
  near(r[0].d, 55.6, 1);
  eq(r[0].name, "Three");
  eq(nearestStops(stops, A, { max: 10, maxM: 400 }).map((s) => s.id), ["s3", "s1", "s2"]);
  eq(nearestStops(stops, A, { max: 10, routeStops: { r1: ["s2", "s4"] } }).map((s) => s.id), ["s2", "s4"]);
  eq(nearestStops(stops, null), []);
  eq(nearestStops(stops, A).length, 3, "default max 3");
});

/* ---------- storage ---------- */
test("storage round-trips JSON with sb: prefix", () => {
  const k = "test-" + Math.random().toString(36).slice(2);
  ok(save(k, { a: [1, 2], b: "x" }));
  eq(load(k, null), { a: [1, 2], b: "x" });
  eq(localStorage.getItem("sb:" + k), JSON.stringify({ a: [1, 2], b: "x" }));
  remove(k);
  eq(load(k, "fb"), "fb");
});
test("storage returns fallback on corrupt JSON", () => {
  localStorage.setItem("sb:corrupt-test", "{not json");
  eq(load("corrupt-test", [1]), [1]);
  localStorage.removeItem("sb:corrupt-test");
});
test("storage never throws when localStorage fails", () => {
  const proto = Object.getPrototypeOf(localStorage);
  const g = proto.getItem, s = proto.setItem, r = proto.removeItem;
  proto.getItem = () => { throw new Error("SecurityError"); };
  proto.setItem = () => { throw new Error("QuotaExceededError"); };
  proto.removeItem = () => { throw new Error("SecurityError"); };
  try {
    eq(load("x", 42), 42);
    eq(save("x", 1), false);
    eq(remove("x"), false);
    const circ = {}; circ.self = circ;
    proto.setItem = s;
    eq(save("circular", circ), false, "unserialisable value");
  } finally {
    proto.getItem = g; proto.setItem = s; proto.removeItem = r;
  }
});

/* ---------- events ---------- */
test("bus on/emit/off and handler isolation", () => {
  const got = [];
  const off1 = bus.on("t:evt", (p) => got.push(["a", p]));
  const off2 = bus.on("t:evt", () => { throw new Error("boom"); });
  const off3 = bus.on("t:evt", (p) => got.push(["c", p]));
  const origErr = console.error; console.error = () => {};
  try { bus.emit("t:evt", { px: 3 }); } finally { console.error = origErr; }
  eq(got, [["a", { px: 3 }], ["c", { px: 3 }]]);
  off1(); off2(); off3();
  bus.emit("t:evt", 1);
  eq(got.length, 2);
  bus.emit("t:nobody", 1); // no throw
  eq(typeof bus.on("x", null), "function");
});

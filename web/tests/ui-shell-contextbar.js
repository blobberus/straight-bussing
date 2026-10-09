// Tests for ui/contextbar.js (journey / custom-route bar, journey:end, custom:clear) and the Nearby
// alert banner + favorites card (SHELL).
import { test, eq, ok, near } from "./lib.js";
import { createStore } from "../js/core/store.js";
import { contextBarHTML, endJourneyPatch, registerContextActions, mountContextBar, startMarquee, MARQUEE } from "../js/ui/contextbar.js";
import { runAction, hasAction } from "../js/ui/actions.js";
import { alertBanner } from "../js/ui/views/alerts.js";
import { favoritesHTML, FAV_MAX } from "../js/ui/views/nearby.js";

const EVIL = '<img src=x onerror="alert(1)">';
const NOW = 1791400000;
const routes = { A: { short: "A", long: "Alpha", color: "#ff0000" }, B: { short: "B", long: "Beta", color: "#0000ff" }, C: { short: "C", long: "Gamma", color: "#00aa00" } };

function base(extra = {}) {
  return { routes, stops: {}, stopRoutes: {}, trips: [], buses: [], alerts: [], hiddenRoutes: [], customRoutes: [], activeCustom: null,
    prevHidden: [], favStops: [], journey: null, routeFilter: null, liveLoaded: true, lastOk: NOW, feedTs: NOW, failed: false, ...extra };
}

test("contextbar: hidden when nothing narrows the map", () => {
  eq(contextBarHTML(base()), "");
  eq(contextBarHTML(base({ journey: { rids: [], label: "x" } })), "", "empty journey is no journey");
  eq(contextBarHTML(base({ activeCustom: "gone" })), "", "unknown custom id");
});

test("contextbar: journey shows label, route chips and Show all (escaped)", () => {
  const h = contextBarHTML(base({ journey: { rids: ["A", "B", "zzz"], label: EVIL, kind: "plan" } }));
  ok(h.includes("Only showing routes for:"));
  ok(!h.includes("<img"), "label escaped");
  ok(h.includes('data-action="journey:end"') && h.includes("Show all"));
  eq((h.match(/class="chip/g) || []).length, 2, "chips only for known routes");
});

test("contextbar: journey wins over an applied custom route", () => {
  const s = base({ journey: { rids: ["A"], label: "Trip" }, customRoutes: [{ id: "c1", name: "Mine", rids: ["B"], highlight: [] }], activeCustom: "c1" });
  ok(contextBarHTML(s).includes("journey:end") && !contextBarHTML(s).includes("custom:clear"));
});

test("contextbar: custom route shows its name and Clear", () => {
  const h = contextBarHTML(base({ customRoutes: [{ id: "c1", name: EVIL, rids: ["B"], highlight: [] }], activeCustom: "c1" }));
  ok(h.includes("My route:") && h.includes('data-action="custom:clear"'));
  ok(!h.includes("<img"), "name escaped");
});

test("contextbar: endJourneyPatch clears the station filter only for station journeys", () => {
  eq(endJourneyPatch({ journey: { rids: ["A"], kind: "plan" } }), { journey: null });
  eq(endJourneyPatch({ journey: { rids: ["A"], kind: "station" } }), { journey: null, routeFilter: null });
  eq(endJourneyPatch({}), { journey: null });
});

test("contextbar: journey:end and custom:clear actions patch the store", async () => {
  registerContextActions();
  ok(hasAction("journey:end") && hasAction("custom:clear"));
  const store = createStore(base({ journey: { rids: ["A"], label: "S", kind: "station" }, routeFilter: { ids: ["A"], label: "S" } }));
  runAction("journey:end", {}, null, { store });
  eq(store.get().journey, null);
  eq(store.get().routeFilter, null);
  const s2 = createStore(base({ customRoutes: [{ id: "c1", name: "Mine", rids: ["B"], highlight: [] }], activeCustom: "c1",
    hiddenRoutes: ["A", "C"], prevHidden: ["C"] }));
  runAction("custom:clear", {}, null, { store: s2 });
  eq(s2.get().activeCustom, null);
  eq(s2.get().hiddenRoutes, ["C"], "previous hidden list restored");
  runAction("custom:clear", {}, null, { store: s2 }); // nothing applied: no-op, no throw
  eq(s2.get().hiddenRoutes, ["C"]);
});

test("contextbar: mountContextBar shows/hides the element as the store changes", async () => {
  const el = document.createElement("div");
  el.hidden = true;
  const store = createStore(base());
  const off = mountContextBar(el, store);
  ok(el.hidden && el.innerHTML === "");
  store.set({ journey: { rids: ["A"], label: "Trip" } });
  await Promise.resolve(); await Promise.resolve();
  ok(!el.hidden && el.textContent.includes("Trip"));
  store.set({ journey: null });
  await Promise.resolve(); await Promise.resolve();
  ok(el.hidden && el.innerHTML === "");
  off();
});

test("nearby: alert banner shows count + first title, none without alerts", () => {
  const al = (t) => ({ header_text: { translation: [{ text: t, language: "en" }] }, active_period: [{ start: NOW - 60, end: NOW + 3600 }] });
  eq(alertBanner(base(), NOW), "");
  eq(alertBanner(base({ liveLoaded: false, alerts: [al("x")] }), NOW), "", "not before the first poll");
  const one = alertBanner(base({ alerts: [al("Detour " + EVIL)] }), NOW);
  ok(one.includes('data-action="alerts:open"') && one.includes("Service alert") && !one.includes("<img"));
  const two = alertBanner(base({ alerts: [al("First"), al("Second")] }), NOW);
  ok(two.includes("2 service alerts") && two.includes("First") && two.includes("1 more"), two);
  ok(/aria-label="[^"]*Open alerts/.test(two), "spoken label");
});

test("nearby: favorites card lists favorites with next visible arrival", () => {
  const stops = { s1: { name: "One", lat: 41.79, lon: -87.6 }, s2: { name: EVIL, lat: 41.79, lon: -87.6 }, s3: { name: "Three", lat: 0, lon: 0 }, s4: { name: "Four", lat: 0, lon: 0 } };
  const trips = [
    { trip: { trip_id: "t1", route_id: "A" }, stop_time_update: [{ stop_id: "s1", arrival: { time: NOW + 300 } }] },
    { trip: { trip_id: "t2", route_id: "B" }, stop_time_update: [{ stop_id: "s1", arrival: { time: NOW + 120 } }] },
  ];
  eq(favoritesHTML(base({ stops, trips }), NOW), "", "no favorites: nothing");
  const s = base({ stops, trips, favStops: ["s1", "s2", "missing", "s3", "s4"], hiddenRoutes: ["B"] });
  const h = favoritesHTML(s, NOW);
  eq((h.match(/data-action="stop:open"/g) || []).length, FAV_MAX, "max " + FAV_MAX + ", unknown ids skipped");
  ok(!h.includes("<img"), "names escaped");
  ok(h.includes('data-view="myroutes"') && h.includes("All favorites"));
  ok(/Favorite One: route A in 5 minutes/.test(h), "hidden route B skipped, next visible is A: " + h.slice(0, 400));
  const j = favoritesHTML({ ...s, hiddenRoutes: [], journey: { rids: ["B"], label: "x" } }, NOW);
  ok(/Favorite One: route B in 2 minutes/.test(j), "journey decides visibility");
});

/* Marquee: a bar laid out like css/base.css .ctxbar (copied rules, scoped to .t-cb) at a fixed width. */
function bar(state, width = 240) {
  if (!document.getElementById("t-cb-css")) {
    const st = document.createElement("style");
    st.id = "t-cb-css";
    st.textContent = ".t-cb{position:absolute;left:-3000px;top:0;display:flex;align-items:center;gap:6px;font:13px/16px sans-serif}"
      + ".t-cb .ctx-text{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
      + ".t-cb .ctx-run{display:inline-flex;gap:40px}.t-cb .ctx-text:not(.is-marquee) .ctx-run{display:inline}"
      + ".t-cb .ctx-text.is-marquee{text-overflow:clip;margin-left:-6px;padding-left:6px}"
      + ".t-cb .ctx-chips{display:flex;flex:none}.t-cb .ctx-btn{flex:none}.t-cb[hidden]{display:none}";
    document.head.appendChild(st);
  }
  const el = document.createElement("div");
  el.className = "t-cb";
  el.style.width = width + "px";
  el.innerHTML = contextBarHTML(state);
  document.body.appendChild(el);
  return el;
}
const LONG = base({ journey: { rids: ["A", "B"], label: "Regenstein Library to the Smart Museum of Art", kind: "plan" } });
const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });

test("contextbar marquee: long text rests at the start, then glides until its copy sits where it began (seamless loop)", () => {
  const el = bar(LONG);
  try {
    const a = startMarquee(el, { reduced: () => false });
    ok(a, "animates when the text does not fit");
    const box = el.querySelector(".ctx-text"), track = el.querySelector(".ctx-track"), copy = el.querySelector(".ctx-copy");
    ok(box.classList.contains("is-marquee"), "marquee class (no ellipsis)");
    ok(copy && copy.getAttribute("aria-hidden") === "true" && copy.textContent === track.textContent, "aria-hidden copy of the text");
    const kf = a.effect.getKeyframes(), t = a.effect.getTiming();
    const d = copy.getBoundingClientRect().left - track.getBoundingClientRect().left;
    near(d, track.getBoundingClientRect().width + 40, 1, "glide distance = text + 40px gap");
    eq(kf[0].transform, kf[1].transform, "rests at the start first");
    near(kf[1].computedOffset, MARQUEE.restMs / t.duration, 1e-6, "rest share of the loop");
    near(parseFloat(String(kf[2].transform).replace("translate3d(", "")), -d, 0.01, "ends with the copy where the text began: " + kf[2].transform);
    near(t.duration, MARQUEE.restMs + (d / MARQUEE.pxPerS) * 1000, 1, "duration = rest + glide at pxPerS");
    eq(t.iterations, Infinity, "repeats every once in a while");
    ok(/Only showing routes for:/.test(track.textContent) && /Smart Museum/.test(track.textContent), "starts at the start of the title");
    startMarquee(el, { reduced: () => false });
    eq(el.querySelectorAll(".ctx-copy").length, 1, "rebuild keeps one copy");
    eq(el.querySelector(".ctx-run").getAnimations().length, 1, "rebuild keeps one animation");
  } finally { el.remove(); }
});

test("contextbar marquee: text that fits, reduced motion, and a hidden bar stay still", () => {
  const short = bar(base({ customRoutes: [{ id: "c1", name: "Mine", rids: ["B"], highlight: [] }], activeCustom: "c1" }), 360);
  const long = bar(LONG);
  try {
    eq(startMarquee(short, { reduced: () => false }), null, "fits: still");
    ok(!short.querySelector(".ctx-copy") && !short.querySelector(".is-marquee"));
    eq(startMarquee(long, { reduced: () => true }), null, "reduced motion: still");
    ok(!long.querySelector(".ctx-copy") && !long.querySelector(".is-marquee"), "reduced motion: ellipsis kept");
    long.hidden = true;
    eq(startMarquee(long, { reduced: () => false }), null, "hidden bar: still");
    eq(startMarquee(null), null, "no bar: no throw");
  } finally { short.remove(); long.remove(); }
});

test("contextbar marquee: mountContextBar starts it on draw, a mouse hover pauses it, clearing stops it", async () => {
  const el = bar(base());
  el.hidden = true;
  const store = createStore(base());
  const off = mountContextBar(el, store, { reduced: () => false });
  try {
    store.set({ journey: LONG.journey });
    await Promise.resolve(); await Promise.resolve();
    await frames(3);
    const run = el.querySelector(".ctx-run"), [a] = run.getAnimations();
    ok(a && a.playState === "running", "scrolling after the bar is drawn");
    el.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    eq(a.playState, "paused", "mouse hover pauses");
    el.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    eq(a.playState, "running", "resumes when the mouse leaves");
    el.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "touch" }));
    eq(a.playState, "running", "a touch does not pause it");
    store.set({ journey: null });
    await Promise.resolve(); await Promise.resolve();
    ok(el.hidden && a.playState === "idle", "cleared: hidden and stopped");
  } finally { off(); el.remove(); }
});

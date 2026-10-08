// Tests for ui/contextbar.js (journey / custom-route bar, journey:end, custom:clear) and the Nearby
// alert banner + favorites card (SHELL).
import { test, eq, ok } from "./lib.js";
import { createStore } from "../js/core/store.js";
import { contextBarHTML, endJourneyPatch, registerContextActions, mountContextBar } from "../js/ui/contextbar.js";
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

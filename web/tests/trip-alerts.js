// Trip alerts delivered by ui/notifier.js and you on the map (ui/tripmap.js follow camera), owner request
// 2026-10-13: the map, the Current trip card and the alerts read ONE evaluation of the trip (tripNow).
import { test, eq, ok } from "./lib.js";
import { createStore } from "../js/core/store.js";
import { bus as events } from "../js/core/events.js";
import { startNotifier } from "../js/ui/notifier.js";
import { startTripMap } from "../js/ui/tripmap.js";
import { tripProgressHTML, resetTripMotion } from "../js/ui/views/tripprogress.js";
import { tripHTML, statusHTML, TRIP_PAUSED } from "../js/ui/views/settings.js";
import { cleanNotify } from "../js/state.js";
import { NOW, stops, bus, trip, scenes } from "./trip-fixtures.js";

const scene = (id, over = {}) => ({ ...scenes().find((s) => s.id === id).state, notify: cleanNotify(null), ...over });
const tick = () => new Promise((r) => queueMicrotask(r));
const tR1 = (list) => trip("tR1", "R", "v101", "101", list);
const nextStop = { buses: [bus("v101", "101", "R", "tR1", "A6", "A7", 0.3)], trips: [tR1([["A7", 60], ["A8", 160]])] };

test("notifier: on board, 'Get off in 2 stops' then 'Get off at the next stop', once each; unofficial outside the app", async () => {
  const store = createStore(scene("onbus"));
  const toasts = [], sys = [];
  let front = true;
  const n = startNotifier(store, { toast: (t) => toasts.push(t), now: () => NOW, notify: (a) => { sys.push(a); return true; },
    front: () => front, perm: () => "granted", polling: () => true });
  eq(toasts, ["Get off in 2 stops: Medical Center. Red Line, Bus 101. Your stop in about 3 min (est.)."]);
  store.set({ feedTs: NOW - 2 });
  await tick();
  eq(toasts.length, 1, "no repeat");
  front = false;
  store.set(nextStop);
  await tick();
  eq(sys.map((a) => a.title), ["Get off at the next stop: Medical Center"], "in the background: the notification");
  ok(sys[0].body.endsWith(" Unofficial."), "a notification outside the app says unofficial");
  ok(n.background(), "a trip with trip alerts + notifications allowed: keep polling in a background tab");
  store.set({ notify: cleanNotify({ trip: false }) });
  ok(!n.background(), "trip alerts off and no station: no background polling");
  n.stop();
});

test("notifier: the count in the alert is the count on the card (same tripNow)", async () => {
  const store = createStore(scene("onbus"));
  const toasts = [];
  const n = startNotifier(store, { toast: (t) => toasts.push(t), now: () => NOW, front: () => true, perm: () => "default", polling: () => true });
  resetTripMotion();
  const card = tripProgressHTML(store.get(), NOW);
  ok(card.includes("Get off in 2 stops: Medical Center") && toasts[0].startsWith("Get off in 2 stops: Medical Center"));
  n.stop();
});

test("notifier: station alerts pause during a trip with trip alerts on, and resume when it ends", async () => {
  const store = createStore(scene("onbus", { notify: cleanNotify({ stopId: "A7" }) }));
  const toasts = [];
  const n = startNotifier(store, { toast: (t) => toasts.push(t), now: () => NOW, front: () => true, perm: () => "default", polling: () => true });
  eq(toasts.length, 1, "one alert: the trip's");
  ok(toasts[0].startsWith("Get off in 2 stops"));
  ok(statusHTML(store.get(), NOW).includes(TRIP_PAUSED.replace("'", "&#39;")), "Settings says why");
  store.set({ journey: null });
  await tick();
  eq(toasts.length, 2, "trip over: the station alert again");
  ok(toasts[1].startsWith("Red Line: 1 stop away"), toasts[1]);
  n.stop();
});

test("settings: the trip alerts switch and what it follows right now", () => {
  const on = tripHTML(scene("onbus"), NOW);
  ok(on.includes('data-st-in="trip"') && on.includes(" checked"));
  ok(on.includes("During your trip: Get off in 2 stops: Medical Center"), "the card's words");
  const off = tripHTML(scene("onbus", { notify: cleanNotify({ trip: false }) }), NOW);
  ok(!off.includes(" checked") && !off.includes("During your trip"));
  ok(!tripHTML(scene("onbus", { journey: null }), NOW).includes("During your trip"));
  ok(tripHTML(scene("onbus", { failed: true }), NOW).includes("Live data is unavailable"));
});

test("trip card: says so when your location is far from the bus the counts follow", () => {
  resetTripMotion();
  const h = tripProgressHTML(scene("onbus", { user: { lat: stops.A0.lat, lon: stops.A0.lon, accuracy: 10 } }), NOW);
  ok(h.includes("Your location is not near Bus 101. Stop counts follow the bus."));
  resetTripMotion();
  ok(!tripProgressHTML(scene("onbus"), NOW).includes("not near"));
});

/** A MapApi stand-in that records calls. */
function fakeMap() {
  const m = { trips: [], fits: [], view: true, moves: new Set() };
  m.setTrip = (y) => m.trips.push(y);
  m.inView = () => m.view;
  m.fitTo = (pts, o) => m.fits.push({ pts, o });
  m.onUserMove = (fn) => { m.moves.add(fn); return () => m.moves.delete(fn); };
  m.userMoves = () => { for (const fn of m.moves) fn({}); };
  return m;
}

test("tripmap: you drawn from the trip; follow frames on start, on a phase change and when you leave the view", async () => {
  const store = createStore(scene("walk", { journey: null }));
  const map = fakeMap();
  let t = 0;
  const tm = startTripMap(store, map, { now: () => NOW, clock: () => t });
  eq(map.trips.at(-1), null, "no trip: nothing drawn");
  store.set({ journey: scene("walk").journey });
  await tick();
  const y = map.trips.at(-1);
  eq([y.phase, y.source], ["walk-to-stop", "gps"]);
  eq(map.fits.length, 1, "trip started: framed");
  eq(map.fits[0].pts, y.frame);
  ok(tm.following());
  store.set({ feedTs: NOW - 1 });
  await tick();
  eq(map.fits.length, 1, "everything still in view: no re-frame (no jitter)");
  map.view = false; t = 500;
  store.set({ feedTs: NOW - 2 });
  await tick();
  eq(map.fits.length, 1, "out of view right after a fit: waits for the glide");
  t = 5000;
  store.set({ feedTs: NOW - 3 });
  await tick();
  eq(map.fits.length, 2, "out of view: framed again");
  map.view = true; t = 9000;
  store.set({ ...scene("onbus") });
  await tick();
  eq(map.trips.at(-1).onBus, true, "on the bus: drawn on it");
  eq(map.fits.length, 3, "phase change: framed");
  map.userMoves();
  ok(!tm.following(), "the rider moved the map: follow off");
  map.view = false; t = 20000;
  store.set(nextStop);
  await tick();
  eq(map.fits.length, 3, "not following: the map stays where the rider put it");
  eq(map.trips.at(-1).stopsLeft, 1, "you are still drawn, with the new count");
  ok(tm.recenter() && tm.following(), "locate button: follow again");
  eq(map.fits.length, 4);
  store.set({ journey: null });
  await tick();
  eq(map.trips.at(-1), null);
  ok(!tm.recenter(), "no trip: nothing to recenter");
  tm.stop();
});

test("tripmap: while the sheet covers the map it waits, then frames when the sheet goes down", async () => {
  const store = createStore(scene("waiting", { journey: null }));
  const map = fakeMap();
  map.view = null;
  const tm = startTripMap(store, map, { now: () => NOW, clock: () => 0 });
  store.set({ journey: scene("waiting").journey });
  await tick();
  eq(map.fits.length, 0, "covered: no fit");
  map.view = true;
  events.emit("sheet:inset", { px: 300 });
  eq(map.fits.length, 1, "sheet down: framed once");
  events.emit("sheet:inset", { px: 280 });
  eq(map.fits.length, 1, "only once");
  tm.stop();
});

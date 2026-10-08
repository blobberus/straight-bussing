// core/notify.js + ui/notifier.js (settings.test.html)
import { test, eq, ok } from "./lib.js";
import { fixture, NOW } from "./views-fixtures.js";
import { createStore } from "../js/core/store.js";
import { stopsAway, dueAlerts, liveStatus, watchedRoutes, minutesText, routeOrder } from "../js/core/notify.js";
import { startNotifier } from "../js/ui/notifier.js";
import { cleanNotify } from "../js/state.js";

const N = (o = {}) => cleanNotify({ stopId: "S3", ...o });
const st = (over = {}) => fixture({ notify: N(), journey: null, ...over });
const moveBus = (s, i, patch) => ({ ...s, buses: s.buses.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

test("notify: stops away on a one-way route and a loop, nearest first, live eta only", () => {
  const r = stopsAway(st(), "S3", null, NOW);
  eq(r.map((x) => [x.rid, x.stopsAway]), [["R2", 0], ["R1", 2]]);
  eq(r[1].etaS, NOW + 600);
  eq([r[1].nextStopId, r[1].nextStopName, r[1].label], ["S1", "Main & 1st", "101"]);
  eq(routeOrder(["a", "b", "a"]), { order: ["a", "b"], loop: true });
});

test("notify: bus past the stop on a one-way route is skipped; loops wrap", () => {
  eq(stopsAway(moveBus(st(), 0, { stop_id: "S2" }), "S1", "R1", NOW), []);
  const loop = stopsAway(moveBus(st(), 1, { stop_id: "S4" }), "S2", "R2", NOW);
  eq(loop.map((x) => x.stopsAway), [2]);
});

test("notify: stale vehicle ignored; next stop falls back to the trip update", () => {
  eq(stopsAway(moveBus(st(), 0, { timestamp: NOW - 600 }), "S3", "R1", NOW), []);
  const r = stopsAway(moveBus(st(), 0, { stop_id: undefined }), "S3", "R1", NOW);
  eq(r.map((x) => [x.nextStopId, x.stopsAway]), [["S1", 2]]);
});

test("notify: watched routes default to visible routes serving the station; chosen ones win", () => {
  eq(watchedRoutes(st()).sort(), ["R1", "R2", "R3"]);
  eq(watchedRoutes(st({ hiddenRoutes: ["R2"] })).sort(), ["R1", "R3"]);
  eq(watchedRoutes(st({ notify: N({ rids: ["R2", "R9"] }) })), ["R2"]);
  eq(watchedRoutes(st({ notify: N({ stopId: null }) })), []);
});

test("notify: 2 stops then 1 stop fire once each per trip, text says est.", () => {
  let s = st({ notify: N({ rids: ["R1"] }) });
  let r = dueAlerts(s, new Set(), NOW);
  eq(r.alerts.map((a) => a.kind), ["twoStops"]);
  ok(r.alerts[0].title.includes("2 stops away") && r.alerts[0].body.includes("(est.)") && r.alerts[0].body.includes("Main & 1st"));
  eq(dueAlerts(s, r.fired, NOW).alerts, [], "deduped");
  s = moveBus(s, 0, { stop_id: "S2" });
  r = dueAlerts(s, r.fired, NOW);
  eq(r.alerts.map((a) => a.kind), ["oneStop"]);
  ok(r.alerts[0].title.includes("1 stop away"));
});

test("notify: a jump straight to 1 stop never fires a late 2-stops alert; toggles respected", () => {
  let s = moveBus(st({ notify: N({ rids: ["R1"] }) }), 0, { stop_id: "S2" });
  const r = dueAlerts(s, new Set(), NOW);
  eq(r.alerts.map((a) => a.kind), ["oneStop"]);
  eq(dueAlerts(st({ notify: N({ rids: ["R1"], twoStops: false }) }), new Set(), NOW).alerts, []);
  const next = dueAlerts(st({ notify: N({ rids: ["R2"] }) }), new Set(), NOW).alerts[0];
  ok(next.title.includes("your stop is next"));
});

test("notify: minutes alert from the live prediction only", () => {
  const r = dueAlerts(st({ notify: N({ rids: ["R1"], twoStops: false, minutes: 10 }) }), new Set(), NOW);
  eq(r.alerts.map((a) => a.kind), ["minutes"]);
  ok(r.alerts[0].title.includes("about 10 min (est.)"));
  eq(dueAlerts(st({ notify: N({ rids: ["R1"], twoStops: false, minutes: 5 }) }), new Set(), NOW).alerts, []);
  eq(minutesText(NOW + 20, NOW), "under a minute (est.)");
  eq(minutesText(null, NOW), "");
});

test("notify: no alerts or status when live data is down or old; delayed data is labeled", () => {
  eq(dueAlerts(st({ lastOk: 0 }), new Set(), NOW).alerts, []);
  eq(dueAlerts(st({ failed: true }), new Set(), NOW).alerts, []);
  eq(dueAlerts(st({ feedTs: NOW - 400 }), new Set(), NOW).alerts, []);
  eq(liveStatus(st({ feedTs: NOW - 400 }), NOW), null);
  const late = dueAlerts(st({ feedTs: NOW - 150, notify: N({ rids: ["R1"] }) }), new Set(), NOW).alerts[0];
  ok(late.body.includes("Live data is delayed"));
});

test("notify: live status = nearest bus with minutes and next stop", () => {
  const s = liveStatus(st({ notify: N({ rids: ["R1"] }) }), NOW);
  eq([s.title, s.stopsAway, s.minutes, s.nextStop, s.estimate], ["Red Line to Hospital", 2, 10, "Main & 1st", true]);
  eq(liveStatus(st({ notify: N({ stopId: null }) }), NOW), null);
});

test("notifier: toasts + system notify once per trip/kind across store updates; new station resets", async () => {
  const store = createStore(st({ notify: N({ rids: ["R1"] }) }));
  const toasts = [], sys = [];
  const n = startNotifier(store, { toast: (t) => toasts.push(t), now: () => NOW, notify: (a) => sys.push(a.key) });
  eq(toasts.length, 1);
  ok(toasts[0].startsWith("Red Line: 2 stops away"));
  store.set({ feedTs: NOW - 1 });
  await new Promise((r) => queueMicrotask(r));
  eq(toasts.length, 1, "no repeat");
  store.set({ notify: N({ rids: ["R1"], inApp: false }), buses: moveBus(store.get(), 0, { stop_id: "S2" }).buses });
  await new Promise((r) => queueMicrotask(r));
  eq([toasts.length, sys.length], [1, 2], "inApp off -> system only");
  store.set({ notify: N({ stopId: "S2", rids: ["R1"] }) });
  await new Promise((r) => queueMicrotask(r));
  ok(n.fired().size >= 1 && [...n.fired()].every((k) => k.startsWith("S2|")), "fresh set for the new station");
  n.stop();
  store.set({ notify: N({ stopId: "S3", rids: ["R1"] }) });
  await new Promise((r) => queueMicrotask(r));
  eq(sys.length, 3, "stopped: nothing more after stop()");
});

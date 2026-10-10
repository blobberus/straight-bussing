// QA regression (2026-10-09): the self-update reload (ui/update.js) must never wipe a trip in progress.
// store.journey is in memory only, so reloading mid-ride (new deploy + app sent to the background) dropped the
// rider's live trip timeline. The reload now waits until the trip has ended and the app is hidden again.
import { test, eq } from "./lib.js";
import { startUpdates } from "../js/ui/update.js";
import { store } from "../js/state.js";
import { createStore } from "../js/core/store.js";
import { initRouter, registerView, navigate, back, _resetRouter } from "../js/ui/router.js";
import { registerAction, runAction, _resetActions, PENDING_MS } from "../js/ui/actions.js";

test("self-update: reloads in the background, but not while a trip is in progress", async () => {
  const L = {}, fake = { controller: {}, register: async () => ({ update: async () => {} }), addEventListener: (t, fn) => { L[t] = fn; } };
  const realSw = Object.getOwnPropertyDescriptor(navigator, "serviceWorker"), realHidden = Object.getOwnPropertyDescriptor(document, "hidden");
  let hidden = false, reloads = 0;
  Object.defineProperty(navigator, "serviceWorker", { value: fake, configurable: true });
  Object.defineProperty(document, "hidden", { get: () => hidden, configurable: true });
  const prevJourney = store.get().journey;
  try {
    startUpdates({ reload: () => { reloads++; } });
    store.set({ journey: { kind: "plan", rids: ["R1"], label: "To X", legs: [] } });
    L.controllerchange();                                    // new version took control while the app is visible
    hidden = true; document.dispatchEvent(new Event("visibilitychange"));
    eq(reloads, 0, "no reload mid-trip, even in the background");
    hidden = false; document.dispatchEvent(new Event("visibilitychange"));
    store.set({ journey: null });                            // trip ended
    hidden = true; document.dispatchEvent(new Event("visibilitychange"));
    eq(reloads, 1, "reloads the next time the app is hidden after the trip");
    hidden = true; L.controllerchange();
    eq(reloads, 2, "no trip: a takeover while hidden reloads at once");
  } finally {
    if (realSw) Object.defineProperty(navigator, "serviceWorker", realSw); else delete navigator.serviceWorker;
    if (realHidden) Object.defineProperty(document, "hidden", realHidden); else delete document.hidden;
    store.set({ journey: prevJourney });
  }
});

test("boot: stops, routes and the live feed start loading before the view modules are awaited (QA 2026-10-09)", async () => {
  // main.js used to fetch data only after ALL ten view modules (Directions, Settings, My Routes, ...) had
  // downloaded, so on a slow phone network the next bus showed seconds later than needed.
  const src = await fetch("../js/main.js").then((r) => r.text());
  const views = src.indexOf("await Promise.allSettled(VIEW_IDS"), stat = src.indexOf("loadStatic(store)"), live = src.indexOf("startLive(store");
  eq([views > 0, stat > 0 && stat < views, live > 0 && live < views], [true, true, true]);
});

/* Taps made while the view modules are still loading (QA 2026-10-09): on a slow network the search bar, gear and
   tabs are on screen seconds before the view modules register; those taps used to be dead ("unknown action").
   The last one is held and runs once its action / view registers. (Here, after the contextbar tests: an earlier
   timer wait on this page stalls the marquee test's requestAnimationFrame under headless virtual time.) */
const tick = () => new Promise((r) => setTimeout(r, 0));   // the replay is a 0 ms timer, so it runs first
const view = (title) => ({ title: () => title, render: () => "", detent: "half" });
function shell() {
  _resetRouter(); _resetActions();
  const st = createStore({ view: "nearby", prevView: null, stopId: null, routeId: null });
  initRouter({ store: st, setDetent: () => {}, getDetent: () => "half" });
  for (const id of ["nearby", "routes", "stop"]) registerView(id, view(id));
  return st;
}
const reset = () => { _resetRouter(); _resetActions(); };

test("held tap: a tab tapped before its view loaded opens once it registers, only once", async () => {
  const st = shell();
  try {
    eq(navigate("qa-late"), false, "not loaded yet");
    registerView("qa-late", view("Late"));
    await tick();
    eq(st.get().view, "qa-late", "the tap took effect when the view loaded");
    navigate("nearby");
    registerView("qa-late", view("Late"));   // registering again does not replay it
    await tick();
    eq(st.get().view, "nearby");
  } finally { reset(); }
});

test("held tap: an action tapped before it loaded runs once with a snapshot of its data and the ctx", async () => {
  shell();
  try {
    const ran = [], ds = { id: "7" };
    eq(runAction("qa:late", ds, null, { tag: "ctx" }), false, "nothing to run yet");
    ds.id = "8";   // the row re-rendered meanwhile
    registerAction("qa:late", (d, ev, ctx) => ran.push([d.id, ev, ctx.tag]));
    await tick();
    eq(ran, [["7", null, "ctx"]], "ran once, with the data it had when tapped");
    registerAction("qa:late", (d) => ran.push(["again", d.id]));
    await tick();
    eq(ran.length, 1, "not replayed by a second registration");
  } finally { reset(); }
});

test("held tap: a newer tap that runs (action, tab, back) drops it; of two held taps the last wins", async () => {
  const st = shell();
  try {
    const ran = [];
    registerAction("go", () => ran.push("go"));
    runAction("qa:a", {}, null, {});
    navigate("routes");                       // the user moved on before the module arrived
    registerAction("qa:a", () => ran.push("a"));
    navigate("qa-v1");
    runAction("go", {}, null, {});            // another action ran
    registerView("qa-v1", view("V1"));
    navigate("stop", { stopId: "s1" });
    navigate("qa-v2");
    back();                                   // and Back
    registerView("qa-v2", view("V2"));
    runAction("qa:b", {}, null, {});
    navigate("qa-v3");                        // two held taps: only the last one counts
    registerAction("qa:b", () => ran.push("b"));
    await tick();
    eq(ran, ["go"], "no stale action ran");
    eq(st.get().view, "routes", "no stale view opened");
    registerView("qa-v3", view("V3"));
    await tick();
    eq(st.get().view, "qa-v3", "the last tap still runs");
  } finally { reset(); }
});

test("held tap: one older than PENDING_MS is dropped", async () => {
  const st = shell(), realNow = Date.now, ran = [];
  const later = () => { Date.now = () => realNow() + PENDING_MS + 1000; };
  try {
    runAction("qa:old", {}, null, {});
    later();
    registerAction("qa:old", () => ran.push("old"));
    Date.now = realNow;
    navigate("qa-old");
    later();
    registerView("qa-old", view("Old"));
    Date.now = realNow;
    await tick();
    eq(ran, [], "too late for the action");
    eq(st.get().view, "nearby", "too late for the tab");
  } finally { Date.now = realNow; reset(); }
});

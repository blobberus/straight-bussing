// Journey tests: helpers (ui/views/journey.js), Directions Start / trip bar, picker "only these routes".
import { test, eq, ok } from "./lib.js";
import { NOW, makeCtx, tick, root } from "./views-fixtures.js";
import { runAction } from "../js/ui/actions.js";
import { optionRids, planJourney, filterJourney, sameRids, tripBarHTML, stationToggleHTML, watchStation, onlySwitchHTML } from "../js/ui/views/journey.js";
import { D, deps, renderDirections, mountDirections, unmountDirections, swap, DIR_REFRESH_S, liveReplan } from "../js/ui/views/directions.js";
import { PREF, renderPick, mountPick, unmountPick, setMode, resetPick, chooseStation } from "../js/ui/views/pick.js";

const USER = { lat: 41.7899, lon: -87.6001 };
const last = (a) => a[a.length - 1];

function mountWith(ctx, render, mount) {
  const el = root();
  el.innerHTML = render(ctx.store.get());
  mount(el, ctx);
  return el;
}
function resetDir() { Object.assign(D, { from: null, to: null, fromText: "", toText: "", active: null, sugs: [], result: null, sel: 0, selKey: null, refining: false, meDenied: false, missed: false }); }
function stubDeps(planImpl) {
  deps.plan = planImpl;
  deps.refineWalking = async (o) => o;
  deps.walkRoute = async (a, b) => ({ m: 900, min: 11.25, coords: [[a.lat, a.lon], [b.lat, b.lon]], source: "router" });
  deps.predict = null;
}
const B = { id: "S1", name: "Main & 1st", lat: 41.79, lon: -87.6 }, A = { id: "S3", name: "Hospital", lat: 41.795, lon: -87.595 };
const walk = (m, min) => ({ type: "walk", from: { lat: 41.7899, lon: -87.6001, name: "Start" }, to: B, m, min, source: "estimate" });
const busLeg = (rid) => ({ type: "bus", rid, board: B, alight: A, path: [], stopsPassed: 2, wait: 2, waitLive: true, ride: 8, source: "live", conf: 1, boardT: NOW + 120, alightT: NOW + 600 });
function opt(key, total, ...rids) {
  return { key, total, totalMin: Math.round(total), arrive: NOW + total * 60, legs: [walk(20, 0.3), ...rids.map(busLeg)] };
}
/** Directions mounted with from/to set and the given options; returns {ctx, el, detents}. */
async function dirWith(options, over = {}) {
  resetDir();
  stubDeps(() => ({ now: NOW, options: typeof options === "function" ? options() : options, walkOnly: { m: 800, min: 10 } }));
  const ctx = makeCtx({ view: "directions", journey: null, ...over });
  const detents = [];
  ctx.setDetent = (d) => detents.push(d);
  D.from = { lat: 41.79, lon: -87.6, label: "Main & 1st", stop: "S1" };
  D.to = { lat: 41.795, lon: -87.595, label: "Hospital", stop: "S3" };
  const el = mountWith(ctx, renderDirections, mountDirections);
  await tick(10);
  return { ctx, el, detents };
}

/* ---------------- helpers ---------------- */

test("journey: optionRids / planJourney (unique bus routes; walk-only -> null)", () => {
  eq(optionRids(opt("a", 10, "R1", "R2", "R1")), ["R1", "R2"]);
  const j = planJourney({ ...opt("a", 10, "R1"), t0: NOW }, "Hospital");
  eq([j.rids, j.label, j.kind, j.to, j.t0], [["R1"], "To Hospital", "plan", "Hospital", NOW]);
  eq(j.legs, [
    { type: "walk", min: 0.3, toName: "Main & 1st" },
    { type: "bus", rid: "R1", board: { id: "S1", name: "Main & 1st" }, alight: { id: "S3", name: "Hospital" }, tripId: null, vehicleId: null,
      boardT: NOW + 120, alightT: NOW + 600, source: "live", waitLive: true },
  ], "compact legs to follow the trip later");
  const tl = planJourney({ legs: [walk(20, 0.3), { ...busLeg("R2"), tripId: 77 }, { ...walk(90, 1.1), from: A, to: { lat: 0, lon: 0, name: "Destination" } }] }, "Cafe <b>");
  eq(tl.legs[1].tripId, "77", "trip id kept as a string");
  eq(tl.legs[2], { type: "walk", min: 1.1, toName: "Cafe <b>" }, "last walk is named after the destination (escaped at render time)");
  eq(tl.t0, null);
  eq(planJourney({ legs: [walk(500, 6)] }, "X"), null, "walk-only hides nothing");
  eq(planJourney(null), null);
  ok(sameRids(["R1", "R2"], ["R2", "R1"]) && !sameRids(["R1"], ["R1", "R2"]));
});

test("journey: filterJourney uses the user's hidden routes (not the journey), falls back when all hidden", () => {
  const base = makeCtx().store.get();
  const f = { ids: ["R1", "R2"], label: "Library" };
  eq(filterJourney({ ...base, routeFilter: f }), { rids: ["R1", "R2"], label: "Library", kind: "station" });
  eq(filterJourney({ ...base, routeFilter: f, hiddenRoutes: ["R2"] }).rids, ["R1"], "hidden route left out");
  eq(filterJourney({ ...base, routeFilter: f, hiddenRoutes: ["R1", "R2"] }).rids, ["R1", "R2"], "all hidden -> station's routes anyway");
  eq(filterJourney({ ...base, routeFilter: f, journey: { rids: ["R3"], kind: "plan", label: "x" } }).rids, ["R1", "R2"], "active journey ignored");
  eq(filterJourney({ ...base, routeFilter: null }), null);
});

test("journey: trip bar and station toggle escape text and expose state", () => {
  const s = makeCtx().store.get();
  eq(tripBarHTML({ ...s, journey: null }), "");
  const h = tripBarHTML({ ...s, journey: { rids: ["R3"], label: "To <img src=x onerror=alert(1)>", kind: "plan" } });
  ok(!h.includes("<img") && h.includes("&lt;img"), "label escaped");
  ok(h.includes('data-action="journey:end"') && h.includes("End trip"));
  ok(!h.includes("<script>"), "route name escaped");
  eq(stationToggleHTML({ ...s, routeFilter: null }), "");
  ok(stationToggleHTML({ ...s, routeFilter: { ids: ["R1"], label: "L" } }).includes('aria-pressed="false"'));
  ok(stationToggleHTML({ ...s, routeFilter: { ids: ["R1"], label: "L" }, journey: { rids: ["R1"], kind: "station", label: "L" } }).includes('aria-pressed="true"'));
  ok(onlySwitchHTML(true).includes('role="switch"') && onlySwitchHTML(true).includes('aria-checked="true"'));
});

/* ---------------- directions ---------------- */

test("directions: Start sets the journey, keeps the plan drawn, lowers the sheet, shows the trip bar", async () => {
  const { ctx, el, detents } = await dirWith([opt("a", 12, "R1", "R2"), opt("b", 15, "R3")]);
  const res = el.querySelector('[data-region="dir-res"]');
  const start = res.querySelector('[data-action="dir:start"]');
  ok(start && start.closest(".v-opt.is-on"), "Start on the selected option only");
  eq(res.querySelectorAll('[data-action="dir:start"]').length, 1, "one primary action");
  runAction("dir:start", {}, null, ctx);
  await tick();
  const jn = ctx.store.get().journey;
  eq([jn.rids, jn.label, jn.kind, jn.to], [["R1", "R2"], "To Hospital", "plan", "Hospital"]);
  eq(jn.legs.map((l) => l.type + (l.rid || "")), ["walk", "busR1", "busR2"], "compact legs stored for the Current trip timeline");
  eq(last(ctx.calls.drawPlan).key, "a", "plan drawn");
  eq(last(detents), "half", "sheet lowered so the map shows");
  ok(res.querySelector(".j-trip") && res.textContent.includes("End trip"), "trip bar");
  ok(!res.querySelector('[data-action="dir:start"]'), "Start replaced while the trip is on");
  ok(document.activeElement === res.querySelector(".j-title"), "focus moved to the trip bar");
  unmountDirections(); el.remove();
});

test("directions: picking another option during a trip updates journey.rids; live re-plan keeps it", async () => {
  let gen = 0;
  const { ctx, el } = await dirWith(() => (gen++ ? [opt("b", 14, "R3"), opt("a", 13, "R1", "R2")] : [opt("a", 12, "R1", "R2"), opt("b", 15, "R3")]));
  runAction("dir:start", {}, null, ctx);
  const ib = D.result.options.findIndex((o) => o.key === "b");   // cards are ranked (core/rank.js), so find it by key
  ok(ib >= 0, "option b shown");
  runAction("dir:opt", { i: String(ib) }, null, ctx);
  await tick();
  eq(ctx.store.get().journey.rids, ["R3"], "follows the chosen option");
  ctx.store.set({ trips: ctx.store.get().trips.slice() });   // live update -> re-plan (options reorder)
  await tick(20);
  eq(D.selKey, "b", "selection kept by key");
  eq(ctx.store.get().journey.rids, ["R3"], "journey kept");
  unmountDirections(); el.remove();
});

test("directions: picking another card on the SAME route during a trip moves the timeline to its stops (QA 2026-10-09)", async () => {
  const L2 = { id: "S2", name: "Library", lat: 41.792, lon: -87.6 };
  const other = () => { const o = opt("r1:lib", 16, "R1"); o.legs[1] = { ...o.legs[1], board: L2, tripId: "t9" }; return o; };
  const { ctx, el } = await dirWith(() => [opt("a", 12, "R1"), other()]);
  runAction("dir:start", {}, null, ctx);
  eq(ctx.store.get().journey.legs[1].board.id, "S1");
  const i = D.result.options.findIndex((o) => o.key === "r1:lib");
  runAction("dir:opt", { i: String(i) }, null, ctx);
  await tick();
  const j = ctx.store.get().journey;
  eq([j.rids, j.legs[1].board.id, j.legs[1].tripId], [["R1"], "S2", "t9"], "Current trip follows the card shown as selected");
  ctx.store.set({ trips: ctx.store.get().trips.slice() });   // live re-plan never moves the boarding stop by itself
  await tick(20);
  eq(ctx.store.get().journey.legs[1].board.id, "S2");
  unmountDirections(); el.remove();
});

test("directions: changing endpoints ends the trip; ending it elsewhere brings Start back", async () => {
  const { ctx, el } = await dirWith([opt("a", 12, "R1")]);
  runAction("dir:start", {}, null, ctx);
  await tick();
  ok(ctx.store.get().journey);
  ctx.store.set({ journey: null });   // what the shell's journey:end does
  await tick();
  ok(el.querySelector('[data-action="dir:start"]') && !el.querySelector(".j-trip"), "Start back after End trip");
  runAction("dir:start", {}, null, ctx);
  swap();
  await tick(10);
  eq(ctx.store.get().journey, null, "swap = new trip");
  unmountDirections(); el.remove();
});

test("directions: leaving the view keeps the trip on the map until it ends", async () => {
  const { ctx, el } = await dirWith([opt("a", 12, "R1")]);
  runAction("dir:start", {}, null, ctx);
  const n = ctx.calls.drawPlan.length;
  unmountDirections(); el.remove();
  eq(ctx.calls.drawPlan.length, n, "plan not cleared while the trip is on");
  unmountDirections();
  eq(ctx.calls.drawPlan.length, n, "repeated unmount keeps it too");
  ctx.store.set({ journey: null });
  await tick();
  eq(last(ctx.calls.drawPlan), null, "cleared once the trip ends");
});

test("directions: live updates re-plan in the background at most every 8 s, keep the picked card, never move the map (iOS refreshDirections)", async () => {
  const wall = { ms: 1e6 }, timers = [];
  const saved = { wallMs: deps.wallMs, later: deps.later };
  deps.wallMs = () => wall.ms;
  deps.later = (fn, ms) => { timers.push({ fn, at: wall.ms + ms }); return timers.length; };
  let calls = 0;
  try {
    const { ctx, el } = await dirWith(() => (calls++ % 2 ? [opt("b", 14, "R3"), opt("a", 13, "R1")] : [opt("a", 12, "R1"), opt("b", 15, "R3")]));
    eq(DIR_REFRESH_S, 8);
    ok(el.querySelector(".j-starthint")?.textContent.includes("Follow the bus stop by stop in Current trip."), "Start hint (iOS wording, web part)");
    const ib = D.result.options.findIndex((o) => o.key === "b");
    runAction("dir:opt", { i: String(ib) }, null, ctx);   // the rider picks "b"
    await tick();
    const fits = ctx.calls.fitTo.length, planned = calls;
    const live = async () => { ctx.store.set({ trips: ctx.store.get().trips.slice() }); await tick(10); };
    await live();
    eq(calls, planned + 1, "first live update: re-planned at once");
    eq(D.selKey, "b", "picked card kept by key");
    wall.ms += 3000;
    await live();
    await live();
    eq(calls, planned + 1, "inside the 8 s window: no re-plan yet");
    eq(timers.length, 1, "one deferred re-plan scheduled");
    eq(timers[0].at, 1e6 + 8000, "at the end of the window");
    wall.ms = timers[0].at;
    timers.shift().fn();
    await tick(10);
    eq(calls, planned + 2, "the latest data is never dropped: re-planned at 8 s");
    eq(D.selKey, "b", "still the picked card");
    eq(ctx.calls.fitTo.length, fits, "background re-plans never move the map");
    wall.ms += 60000;
    ctx.store.set({ failed: true, trips: ctx.store.get().trips.slice() });
    await tick(10);
    eq([calls, timers.length], [planned + 2, 0], "failing feed: no re-plan on stale data");
    ctx.store.set({ failed: false });
    D.refining = true;   // a new-endpoint plan is still checking sidewalks
    await live();
    ok(liveReplan.pending(), "a retry is pending");
    eq([calls, timers.length], [planned + 2, 1], "deferred while a new plan refines");
    D.refining = false;
    wall.ms += 1000;
    timers.shift().fn();
    await tick(10);
    eq(calls, planned + 3, "runs once the new plan is done");
    await live();
    ok(liveReplan.pending(), "inside the window again");
    unmountDirections(); el.remove();
    ok(!liveReplan.pending(), "nothing pending after leaving");
  } finally { Object.assign(deps, saved); }
});

test("directions: walk-only results offer no Start", async () => {
  const { el } = await dirWith([]);
  ok(el.textContent.includes("Walk the whole way"));
  ok(!el.querySelector('[data-action="dir:start"]'));
  unmountDirections(); el.remove();
});

/* ---------------- picker ---------------- */

test("pick: switch appears only after a mode is chosen and highlights nothing", async () => {
  resetPick(); PREF.only = false;
  const ctx = makeCtx({ view: "routes", journey: null });
  ok(!renderPick(ctx.store.get()).includes("pick:only"), "not on the chooser");
  await setMode("sel", ctx);
  const el = mountWith(ctx, renderPick, mountPick);
  const sw = el.querySelector('[data-action="pick:only"]');
  ok(sw && sw.getAttribute("aria-checked") === "false", "off by default");
  const before = ctx.calls.highlight.filter((c) => c.items).length;
  runAction("pick:only", {}, { target: sw }, ctx);
  eq(sw.getAttribute("aria-checked"), "true");
  eq(ctx.calls.highlight.filter((c) => c.items).length, before, "toggling highlights nothing");
  eq(ctx.store.get().journey, null, "nothing hidden until a station is chosen");
  unmountPick(); el.remove(); resetPick(); PREF.only = false;
});

test("pick: current location + switch on -> choosing starts a station journey of visible routes", async () => {
  resetPick(); PREF.only = true;
  const ctx = makeCtx({ view: "routes", user: USER, locState: "granted", hiddenRoutes: ["R2"], journey: null });
  await setMode("loc", ctx);
  const el = mountWith(ctx, renderPick, mountPick);
  ok(el.querySelector('[data-action="pick:only"]').getAttribute("aria-checked") === "true", "remembered");
  chooseStation("S2", ctx);
  await tick();
  const s = ctx.store.get();
  eq(s.routeFilter.ids.slice().sort(), ["R1", "R2"], "filter unchanged");
  eq(s.journey, { rids: ["R1"], label: "Library", kind: "station" }, "only visible routes");
  eq(s.view, "routes");
  ctx.store.set({ routeFilter: { ids: ["R1", "R3"], label: "Main & 1st" } });   // another station
  await tick();
  eq(ctx.store.get().journey.label, "Main & 1st", "journey follows the filter");
  ctx.store.set({ routeFilter: null });   // Routes' filter chip x
  await tick();
  eq(ctx.store.get().journey, null, "clearing the station ends its journey");
  unmountPick(); el.remove(); resetPick(); PREF.only = false;
});

test("pick: switch off keeps the old behavior; journey:station toggles it afterwards", async () => {
  resetPick(); PREF.only = false;
  const ctx = makeCtx({ view: "routes", journey: null });
  await setMode("sel", ctx);
  chooseStation("S3", ctx);
  await tick();
  eq(ctx.store.get().journey, null, "no journey without the switch");
  runAction("journey:station", {}, null, ctx);
  await tick();
  eq(ctx.store.get().journey.kind, "station");
  eq(ctx.store.get().journey.rids.slice().sort(), ["R1", "R2", "R3"]);
  runAction("journey:station", {}, null, ctx);
  await tick();
  eq(ctx.store.get().journey, null, "toggled off, filter kept");
  ok(ctx.store.get().routeFilter, "filter still set");
  resetPick();
});

test("journey: watchStation leaves plan journeys alone", async () => {
  const ctx = makeCtx({ journey: { rids: ["R1"], label: "To X", kind: "plan" }, routeFilter: { ids: ["R2"], label: "L" } });
  watchStation(ctx.store);
  ctx.store.set({ routeFilter: null });
  await tick();
  eq(ctx.store.get().journey.kind, "plan");
});

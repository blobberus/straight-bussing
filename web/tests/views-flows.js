// State-machine tests: pick flow (3 modes) and directions (fields, plan, refine, live updates).
import { test, eq, ok } from "./lib.js";
import { NOW, makeCtx, tick, root, type } from "./views-fixtures.js";
import { runAction } from "../js/ui/actions.js";
import { P, placeDeps, renderPick, mountPick, unmountPick, setMode, resetPick, openPickDialog } from "../js/ui/views/pick.js";
import { D, deps, renderDirections, mountDirections, unmountDirections, NOTE, computeSugs } from "../js/ui/views/directions.js";
import { plan as realPlan, refineWalking as realRefine } from "../js/core/planner.js";
import { N, renderNearby, mountNearby, unmountNearby } from "../js/ui/views/nearby.js";

const USER = { lat: 41.7899, lon: -87.6001 };
const nonNull = (calls) => calls.highlight.filter((c) => c.items);

/** Mount a view the way main.js does: render into root, then mount. */
function mountWith(ctx, render, mount) {
  const el = root();
  el.innerHTML = render(ctx.store.get());
  mount(el, ctx);
  return el;
}

test("pick: dialog offers 3 choices and highlights nothing until chosen", async () => {
  resetPick();
  const ctx = makeCtx({ view: "routes" });
  const dlg = openPickDialog(ctx, null);
  ok(dlg && dlg.open, "dialog open");
  const labels = [...dlg.querySelectorAll("[data-mode]")].map((b) => b.textContent);
  ok(labels.some((t) => t.includes("Use current location")) && labels.some((t) => t.includes("Select a station")) && labels.some((t) => t.includes("Type an address or place")));
  eq(nonNull(ctx.calls).length, 0, "no highlight yet");
  dlg.close("cancel");
  ok(renderPick(ctx.store.get()).includes("Use current location"), "inline chooser when no mode");
});

test("pick: current location -> nearest stops <=1.5 km highlighted, choose sets routeFilter", async () => {
  resetPick();
  const ctx = makeCtx({ view: "routes", user: USER, locState: "granted" });
  await setMode("loc", ctx);
  eq(ctx.calls.navigate[0][0], "pick");
  await tick();
  const el = mountWith(ctx, renderPick, mountPick);
  const h = nonNull(ctx.calls).pop();
  ok(h, "highlighted after choosing");
  const ids = h.items.map((s) => s.id);
  ok(ids.includes("S1") && ids.includes("S2") && !ids.includes("S4") && !ids.includes("S5"), "within 1.5 km and served: " + ids);
  ok(el.textContent.includes("Main & 1st"));
  el.querySelector('[data-action="pick:choose"][data-id="S2"]').click();
  runAction("pick:choose", { id: "S2" }, null, ctx);
  await tick();
  const f = ctx.store.get().routeFilter;
  eq(f.label, "Library");
  eq(f.ids.slice().sort(), ["R1", "R2"]);
  eq(ctx.store.get().view, "routes");
  eq(ctx.calls.highlight[ctx.calls.highlight.length - 1].items, null, "highlights cleared");
  unmountPick(); el.remove();
});

test("pick: location denied falls back to other modes", async () => {
  resetPick();
  const ctx = makeCtx({ view: "pick" }, { locateResult: false });
  const el = mountWith(ctx, renderPick, mountPick);
  await setMode("loc", ctx);
  await tick();
  ok(el.textContent.includes("Location unavailable"), el.textContent);
  ok(el.querySelector('[data-action="pick:mode"][data-mode="sel"]'), "select a station offered");
  eq(nonNull(ctx.calls).length, 0, "nothing highlighted");
  unmountPick(); el.remove();
});

test("pick: select a station by name works without location", async () => {
  resetPick();
  const ctx = makeCtx({ view: "pick" });
  const el = mountWith(ctx, renderPick, mountPick);
  await setMode("sel", ctx);
  const input = el.querySelector('[data-input="pick-q"]');
  ok(input, "search field");
  type(input, "hosp");
  const list = el.querySelector('[data-region="pick-list"]').textContent;
  ok(list.includes("Hospital") && !list.includes("Library"), list);
  eq(nonNull(ctx.calls).pop().items.map((s) => s.id), ["S3"]);
  ok(document.activeElement === input, "focus kept while typing");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await tick();
  eq(ctx.store.get().routeFilter.label, "Hospital");
  unmountPick(); el.remove();
});

test("pick: type an address -> places -> stops near the place", async () => {
  resetPick();
  const sent = [];
  const realLocal = placeDeps.local;
  placeDeps.local = () => ({ items: [] });     // nothing on the device: Photon (stubbed) answers
  placeDeps.search = async (q) => { sent.push(q); return { items: [{ label: "Regenstein Library", sub: "1100 E 57th St", lat: 41.7921, lon: -87.6 }] }; };
  const ctx = makeCtx({ view: "pick" });
  const el = mountWith(ctx, renderPick, mountPick);
  await setMode("addr", ctx);
  type(el.querySelector('[data-input="pick-q"]'), "Regenstein");
  ok(el.textContent.includes("Searching places"), "busy state");
  await tick(500);
  eq(sent, ["Regenstein"], "only typed text sent");
  ok(el.textContent.includes("Regenstein Library"));
  runAction("pick:place", { i: "0" }, null, ctx);
  ok(el.textContent.includes("Stops within 1.5 km of") && el.textContent.includes("Library"));
  const h = nonNull(ctx.calls).pop();
  ok(h.items.some((s) => s.id === "S2"), "stops near place highlighted");
  unmountPick(); el.remove(); resetPick(); placeDeps.local = realLocal;
});

test("nearby: mounted view updates itself on live data without touching the search field", async () => {
  N.q = ""; N.mode = "station"; N.anchor = null;
  const ctx = makeCtx({ trips: [], buses: [] });
  const el = mountWith(ctx, (s) => renderNearby(s, NOW), mountNearby);
  ok(el.textContent.includes("No shuttles running right now"));
  const full = makeCtx().store.get();
  ctx.store.set({ trips: full.trips, buses: full.buses });
  await tick();
  ok(el.textContent.includes("Arriving soon"), "list refreshed from store");
  const input = el.querySelector('[data-input="nearby-q"]');
  type(input, "lib");
  ok(el.querySelector('[data-region="nearby-results"]').textContent.includes("Library"));
  ctx.store.set({ trips: full.trips.slice(0, 1) });
  await tick();
  ok(document.activeElement === input && input.value === "lib", "focus and text kept");
  ctx.store.set({ user: USER, locState: "granted" });
  type(input, "");
  ok(el.textContent.includes("Also nearby"), "location view after clearing search");
  unmountNearby(); el.remove(); N.q = "";
});

/* ---------------- directions ---------------- */

function resetDir() { Object.assign(D, { from: null, to: null, fromText: "", toText: "", active: null, sugs: [], result: null, sel: 0, selKey: null, refining: false, meDenied: false, missed: false }); }
function stubDeps(planImpl, refineImpl) {
  deps.plan = planImpl;
  deps.refineWalking = refineImpl || (async (o) => ({ ...o, legs: o.legs.map((l) => (l.type === "walk" ? { ...l, source: "router", coords: [[0, 0], [1, 1]] } : l)) }));
  deps.walkRoute = async (a, b) => ({ m: 900, min: 11.25, coords: [[a.lat, a.lon], [b.lat, b.lon]], source: "router" });
  deps.predict = null;
}
const ep = (s) => ({ lat: s.lat, lon: s.lon, name: s.name, id: s.id });
function fakeOption(key, total, rid) {
  const b = { id: "S1", name: "Main & 1st", lat: 41.79, lon: -87.6 }, a = { id: "S3", name: "Hospital", lat: 41.795, lon: -87.595 };
  return { key, total, totalMin: Math.round(total), arrive: NOW + total * 60, legs: [
    { type: "walk", from: { lat: 41.7899, lon: -87.6001, name: "Start" }, to: ep(b), m: 20, min: 0.3, source: "estimate" },
    { type: "bus", rid, board: b, alight: a, path: [], stopsPassed: 2, wait: 2, waitLive: true, ride: 8, source: "live", conf: 1, boardT: NOW + 120, alightT: NOW + 600 },
    { type: "walk", from: ep(a), to: { lat: 41.7952, lon: -87.5951, name: "Destination" }, m: 30, min: 0.4, source: "estimate" },
  ] };
}

test("directions: My location default, station suggestions, plan + sidewalk refine, steps and note", async () => {
  resetDir();
  stubDeps(() => ({ now: NOW, options: [fakeOption("a", 12, "R1"), fakeOption("b", 15, "R3"), fakeOption("c", 20, "R1"), fakeOption("d", 30, "R1")], walkOnly: { m: 800, min: 10 } }));
  const ctx = makeCtx({ view: "directions", user: USER, locState: "granted" });
  const el = mountWith(ctx, renderDirections, mountDirections);
  const from = el.querySelector('[data-input="dir-from"]'), to = el.querySelector('[data-input="dir-to"]');
  eq(from.value, "My location");
  ok(document.activeElement === to, "destination focused");
  type(to, "hosp");
  ok(el.querySelector('[data-region="dir-sug"]').textContent.includes("Hospital"), "station suggestion");
  to.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await tick(10);
  eq(D.to.label, "Hospital");
  const res = el.querySelector('[data-region="dir-res"]');
  eq(res.querySelectorAll(".v-opt").length, 4, "up to 4 cards (one per ranking criterion + one)");
  ok(res.querySelector(".v-opt .j-crit"), "a card says what it minimizes");
  const txt = res.textContent;
  ok(txt.includes("Bus arrives at Main & 1st"), "bus step");
  ok(txt.includes("sidewalk route"), "refined walk tag");
  ok(txt.includes("Arrive"), "arrive clock");
  ok(txt.includes(NOTE), "exact note");
  ok(txt.includes("from live bus prediction"), "source");
  ok(ctx.calls.drawPlan.some((o) => o && o.key === "a"), "drew first option");
  runAction("dir:opt", { i: "1" }, null, ctx);
  eq(ctx.calls.drawPlan[ctx.calls.drawPlan.length - 1].key, "b", "tap card draws it");
  ok(res.querySelector(".v-opt.is-on").textContent.includes("Hospital"));
  unmountDirections(); el.remove();
});

test("directions: live update re-plans without stealing focus", async () => {
  resetDir();
  let calls = 0;
  stubDeps(() => { calls++; return { now: NOW, options: [fakeOption("a", 12 + calls, "R1")], walkOnly: { m: 800, min: 10 } }; });
  const ctx = makeCtx({ view: "directions", user: USER });
  D.to = { lat: 41.7952, lon: -87.5951, label: "Hospital", stop: "S3" };
  const el = mountWith(ctx, renderDirections, mountDirections);
  await tick(10);
  const from = el.querySelector('[data-input="dir-from"]');
  from.focus();
  const before = calls;
  ctx.store.set({ trips: ctx.store.get().trips.slice(0, 2) });
  await tick(10);
  ok(calls > before, "re-planned on live update");
  ok(document.activeElement === from, "focus kept");
  eq(from.value, "My location");
  unmountDirections(); el.remove();
});

test("directions: no service shows walk-only fallback and official contact", async () => {
  resetDir();
  stubDeps(() => ({ now: NOW, options: [], walkOnly: { m: 640, min: 8 } }));
  const ctx = makeCtx({ view: "directions", buses: [], trips: [] });
  D.from = { lat: 41.79, lon: -87.6, label: "Main & 1st", stop: "S1" };
  D.to = { lat: 41.795, lon: -87.595, label: "Hospital", stop: "S3" };
  const el = mountWith(ctx, renderDirections, mountDirections);
  await tick(10);
  const txt = el.textContent;
  ok(txt.includes("No practical shuttle route right now") && txt.includes("Walk the whole way"), txt);
  ok(txt.includes("No shuttles are running") && txt.includes("773.702.8181"));
  ok(txt.includes("sidewalk route"), "walk-only refined via walkRoute");
  const last = ctx.calls.drawPlan[ctx.calls.drawPlan.length - 1];
  ok(last && last.legs.length === 1 && last.legs[0].type === "walk", "walk-only drawn");
  unmountDirections(); el.remove();
});

test("directions: missed bus after refine drops the option", async () => {
  resetDir();
  stubDeps(() => ({ now: NOW, options: [fakeOption("a", 12, "R1")], walkOnly: { m: 800, min: 10 } }), async () => null);
  const ctx = makeCtx({ view: "directions" });
  D.from = { lat: 41.79, lon: -87.6, label: "A" }; D.to = { lat: 41.795, lon: -87.595, label: "B" };
  const el = mountWith(ctx, renderDirections, mountDirections);
  await tick(10);
  ok(el.textContent.includes("The next buses leave before you could reach the stop."));
  unmountDirections(); el.remove();
});

test("directions: swap, to-stop action, escaping, suggestions include My location", async () => {
  resetDir();
  stubDeps(() => ({ now: NOW, options: [], walkOnly: { m: 100, min: 1 } }));
  const ctx = makeCtx({ view: "stop", stopId: "S3", user: USER });
  runAction("dir:to-stop", { id: "S3" }, null, ctx);
  eq(ctx.store.get().view, "directions");
  eq(D.to.label, "Hospital"); eq(D.from.label, "My location");
  const el = mountWith(ctx, renderDirections, mountDirections);
  runAction("dir:swap", {}, null, ctx);
  eq(el.querySelector('[data-input="dir-from"]').value, "Hospital");
  eq(el.querySelector('[data-input="dir-to"]').value, "My location");
  D.from = { lat: 1, lon: 1, label: '"><img src=x onerror=alert(1)>' };
  const h = renderDirections(ctx.store.get(), NOW);
  ok(!h.includes("<img"), "escaped field value");
  eq(computeSugs(ctx.store.get(), "")[0].kind, "me");
  unmountDirections(); el.remove(); resetDir();
});

test("directions: one 'use my location' action per screen, never a suggestion and a button at once (taste audit 7.1)", async () => {
  resetDir();
  stubDeps(() => ({ now: NOW, options: [], walkOnly: { m: 100, min: 1 } }));
  const ctx = makeCtx({ view: "directions" });   // no location yet, no start
  const el = mountWith(ctx, renderDirections, mountDirections);
  const from = el.querySelector('[data-input="dir-from"]'), to = el.querySelector('[data-input="dir-to"]');
  const sug = () => el.querySelector('[data-region="dir-sug"]').textContent, res = () => el.querySelector('[data-region="dir-res"]').textContent;
  const focusIn = (inp) => { inp.focus(); inp.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); };
  focusIn(to);
  ok(!sug().includes("My location") && res().includes("Start from my location"), "destination focused: only the button");
  focusIn(from);
  ok(sug().includes("My location") && !res().includes("Start from my location"), "start focused: only the suggestion");
  from.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok(!sug().includes("My location") && res().includes("Start from my location"), "Escape closes the list: the button is back");
  unmountDirections(); el.remove(); resetDir();
});

test("directions: real planner + refineWalking integrate with the view", async () => {
  resetDir();
  deps.plan = realPlan; deps.refineWalking = realRefine; deps.predict = null;
  deps.walkRoute = async (a, b) => { const m = Math.hypot((a.lat - b.lat) * 111000, (a.lon - b.lon) * 83000) * 1.2; return { m, min: m / 80, coords: [[a.lat, a.lon], [b.lat, b.lon]], source: "estimate" }; };
  const ctx = makeCtx({ view: "directions" });
  ctx.now = () => NOW;
  D.from = { lat: 41.7899, lon: -87.6001, label: "Start here" };
  D.to = { lat: 41.7951, lon: -87.5951, label: "Hospital entrance" };
  const el = mountWith(ctx, renderDirections, mountDirections);
  await tick(20);
  const txt = el.querySelector('[data-region="dir-res"]').textContent;
  ok(txt.includes("min"), "rendered a result: " + txt.slice(0, 200));
  ok(!/NaN|undefined/.test(txt), "no NaN/undefined: " + txt.slice(0, 300));
  unmountDirections(); el.remove(); resetDir();
});

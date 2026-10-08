// My Routes tab, custom route detail/editor, favorites, and the stop view's favorite + visibility.
import { test, eq, ok } from "./lib.js";
import { NOW, fixture, makeCtx, tick, root } from "./views-fixtures.js";
import { runAction } from "../js/ui/actions.js";
import { getView } from "../js/ui/router.js";
import { renderMyRoutes, renderCustom, renderEditor, saveEditor, createPatcher, _ui } from "../js/ui/views/myroutes.js";
import { renderStop } from "../js/ui/views/stop.js";

const noRaw = (h) => !h.includes("<script>") && !h.includes("javascript:") && !h.includes("<img");
const C1 = { id: "c1", name: "Commute <img src=x>", rids: ["R1", "R3"], highlight: [] };
const C2 = { id: "c2", name: "Weekend", rids: ["R2"], highlight: [] };
const reset = () => { _ui.favEdit = false; _ui.confirmDel = null; };

test("myroutes: views registered with the right tab/parents", () => {
  eq(getView("myroutes").tab, "myroutes");
  eq(getView("customroute").parent, "myroutes");
  eq(getView("customedit").parent, "myroutes");
  for (const v of ["myroutes", "customroute", "customedit"]) ok(typeof getView(v).mount === "function", "mount " + v);
});

test("myroutes: empty state offers New custom route, favorite hint, alerts + about rows", () => {
  reset();
  const h = renderMyRoutes(fixture(), NOW);
  ok(h.includes("Save the routes you ride") && h.includes('data-action="mr:new"'));
  ok(h.includes("Open a station on the map and tap Favorite"));
  ok(h.includes('data-action="alerts:open"') && h.includes('data-action="about:open"'));
  ok(h.includes("None right now"));
  const withAlert = renderMyRoutes(fixture({ alerts: [{ header_text: "Detour", active_period: [] }] }), NOW);
  ok(withAlert.includes("1 active alert"), "alert count");
});

test("myroutes: custom route rows escape names and mark the applied one (not by color alone)", () => {
  reset();
  const h = renderMyRoutes(fixture({ customRoutes: [C1, C2], activeCustom: "c1" }), NOW);
  ok(noRaw(h), "escaped");
  ok(h.includes("Commute &lt;img src=x&gt;"));
  eq((h.match(/class="mr-showing"/g) || []).length, 1, "one Showing pill");
  ok(h.includes("showing on the map"), "screen reader label says applied");
  ok(!h.includes("Save the routes you ride"), "no empty state");
});

test("myroutes: favorites show next visible arrival and honor hidden routes", () => {
  reset();
  const h = renderMyRoutes(fixture({ favStops: ["S1", "gone"] }), NOW);
  ok(h.includes("Main &amp; 1st") && h.includes("Red Line"), "next bus R1");
  ok(h.includes('data-action="stop:open" data-id="S1"'));
  ok(!h.includes("gone"), "unknown stop skipped");
  const hid = renderMyRoutes(fixture({ favStops: ["S1"], hiddenRoutes: ["R1"] }), NOW);
  ok(!hid.includes("Red Line") && noRaw(hid), "R1 hidden -> next is R3 (escaped)");
  const j = renderMyRoutes(fixture({ favStops: ["S1"], journey: { rids: ["R1"], label: "x" } }), NOW);
  ok(j.includes("Red Line"), "journey shows only its routes");
});

test("myroutes: favorites edit mode moves and removes", async () => {
  reset();
  const ctx = makeCtx({ favStops: ["S1", "S2", "S3"] });
  runAction("mr:favedit", {}, null, ctx);
  ok(_ui.favEdit);
  const h = renderMyRoutes(ctx.store.get(), NOW);
  ok(h.includes('aria-label="Move Main &amp; 1st up" disabled'), "first can't move up");
  ok(h.includes("Remove Library from favorites"));
  runAction("mr:favmove", { id: "S2", dir: "-1" }, null, ctx);
  eq(ctx.store.get().favStops, ["S2", "S1", "S3"]);
  runAction("mr:favrm", { id: "S1" }, null, ctx);
  eq(ctx.store.get().favStops, ["S2", "S3"]);
  runAction("mr:favedit", {}, null, ctx);
  ok(!_ui.favEdit);
});

test("myroutes: tapping a custom route applies it, fits the map and opens its detail", async () => {
  reset();
  const ctx = makeCtx({ customRoutes: [C1, C2], hiddenRoutes: ["R2"] });
  runAction("mr:open", { id: "c2" }, null, ctx);
  await tick();
  const s = ctx.store.get();
  eq(s.activeCustom, "c2");
  eq([...s.hiddenRoutes].sort(), ["R1", "R3"]);
  eq(s.prevHidden, ["R2"], "remembers previous hidden list");
  eq(ctx.calls.navigate.at(-1), ["customroute", { id: "c2" }]);
  runAction("mr:open", { id: "c1" }, null, ctx);
  eq(ctx.calls.fitTo.length, 1, "fit to R1 shape (R2 has none)");
});

test("customroute: detail shows Stop showing / Show on map, highlight toggles, inline delete", async () => {
  reset();
  const ctx = makeCtx({ customRoutes: [C1, C2], activeCustom: "c1", hiddenRoutes: ["R2"], user: { lat: 41.7899, lon: -87.6001 } });
  let h = renderCustom(ctx.store.get(), "c1", NOW);
  ok(h.includes('data-action="custom:clear"') && h.includes("Showing on the map"));
  ok(h.includes("1 bus running"), "running count");
  ok(/min at Main &amp; 1st/.test(h), "next arrival at nearest stop");
  ok(h.includes('aria-pressed="false"') && noRaw(h));
  runAction("mr:hl", { id: "c1", rid: "R1" }, null, ctx);
  eq(ctx.store.get().customRoutes[0].highlight, ["R1"]);
  ok(renderCustom(ctx.store.get(), "c1", NOW).includes('aria-pressed="true"'));
  ok(renderCustom(ctx.store.get(), "c2", NOW).includes('data-action="mr:apply"'), "not applied -> Show on map");
  runAction("mr:del", { id: "c1" }, null, ctx);
  h = renderCustom(ctx.store.get(), "c1", NOW);
  ok(h.includes("This can’t be undone") && h.includes('data-action="mr:del-yes"'));
  runAction("mr:del-no", {}, null, ctx);
  ok(!renderCustom(ctx.store.get(), "c1", NOW).includes("mr:del-yes"));
  runAction("mr:del", { id: "c1" }, null, ctx);
  runAction("mr:del-yes", { id: "c1" }, null, ctx);
  const s = ctx.store.get();
  eq(s.customRoutes.map((c) => c.id), ["c2"]);
  eq(s.activeCustom, null);
  eq(s.hiddenRoutes, [], "applied one deleted -> previous hidden list restored");
  ok(renderCustom(s, "c1", NOW).includes("Custom route not found"));
});

test("customedit: validates >= 1 route, creates + applies, edits in place", async () => {
  reset();
  const ctx = makeCtx({ customRoutes: [C2], buses: [] });
  const el = root();
  el.innerHTML = renderEditor(ctx.store.get(), null);
  getView("customedit").mount(el, ctx);
  const form = el.querySelector("form");
  eq(el.querySelector("#mr-name").value, "My route 2", "prefilled name");
  ok(el.querySelector('label[for="mr-name"]'), "labelled");
  ok(el.textContent.includes("Not running"), "grouped");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  ok(el.textContent.includes("Choose at least one route."), "inline error");
  eq(ctx.store.get().customRoutes.length, 1, "nothing saved");
  el.querySelector('input[value="R1"]').checked = true;
  el.querySelector('input[value="R3"]').checked = true;
  el.querySelector("#mr-name").value = "  Lab  run ";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  let s = ctx.store.get();
  eq(s.customRoutes.length, 2);
  const made = s.customRoutes[1];
  eq([made.name, made.rids], ["Lab run", ["R1", "R3"]]);
  eq(s.activeCustom, made.id, "applied");
  eq(s.hiddenRoutes, ["R2"]);
  eq(ctx.calls.navigate.at(-1), ["customroute", { id: made.id }]);
  getView("customedit").unmount();
  el.innerHTML = renderEditor(s, made.id);
  ok(el.querySelector('input[value="R1"]').checked && !el.querySelector('input[value="R2"]').checked, "edit prefilled");
  el.querySelector('input[value="R2"]').checked = true;
  saveEditor(el.querySelector("form"), ctx);
  await tick();
  s = ctx.store.get();
  eq(s.customRoutes[1].rids, ["R1", "R2", "R3"]);
  eq(s.hiddenRoutes, [], "active one re-applied after edit");
  el.remove();
});

test("myroutes: patcher holds a patch while a pointer is down (tap never lost)", async () => {
  const el = root();
  let n = 0;
  el.innerHTML = '<button data-action="x">0</button>';
  const p = createPatcher(el, () => `<button data-action="x">${n}</button>`);
  const btn = el.querySelector("button");
  btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  n = 1; p.flush();
  ok(el.querySelector("button") === btn, "not replaced while held");
  btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  await tick(5);
  eq(el.querySelector("button").textContent, "1", "applied after release");
  p.stop(); el.remove();
});

test("stop: favorite toggle, routes at this stop follow visibility", async () => {
  let h = renderStop(fixture({ stopId: "S1" }), NOW);
  ok(h.includes('data-action="stop:fav"') && h.includes('aria-pressed="false"') && h.includes("Add to favorites"));
  ok(h.includes("Routes at this stop") && h.includes("1301 East 53rd Street"));
  const ctx = makeCtx({ stopId: "S1", view: "stop" });
  runAction("stop:fav", { id: "S1" }, null, ctx);
  eq(ctx.store.get().favStops, ["S1"]);
  ok(renderStop(ctx.store.get(), NOW).includes("Remove from favorites"));
  runAction("stop:fav", { id: "S1" }, null, ctx);
  eq(ctx.store.get().favStops, []);
  h = renderStop(fixture({ stopId: "S1", hiddenRoutes: ["R1"] }), NOW);
  ok(h.includes("+1 hidden route also stops here") && h.includes('data-action="stop:unhide"'));
  h = renderStop(fixture({ stopId: "S1", journey: { rids: ["R1"], label: "Trip" } }), NOW);
  ok(h.includes("hidden during your trip") && !h.includes("stop:unhide"), "journey: no Show button");
  ok(h.includes("Red Line"), "journey route shown");
  h = renderStop(fixture({ stopId: "S4", hiddenRoutes: ["R2"] }), NOW);
  ok(h.includes("None of your visible routes stop here"));
  ok(renderStop(fixture({ stopId: "S2" }), NOW).includes("Address not available"));
});

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
const reset = () => { _ui.favEdit = false; _ui.swiped = null; document.querySelectorAll("dialog.v-confirm").forEach((d) => d.remove()); };
const dlg = () => document.querySelector("dialog.v-confirm[open]");
const press = (sel) => { const b = dlg()?.querySelector(sel); ok(b, "popup button " + sel); b.click(); };

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
  eq((h.match(/class="mr-crow is-on"/g) || []).length, 1, "one row marked on (filled check, not color alone)");
  ok(h.includes('data-id="c1" aria-pressed="true"') && h.includes('data-id="c2" aria-pressed="false"'), "screen readers hear on / off");
  ok(!h.includes("mr-showing"), "no Showing pill inserted into the row (it re-flowed the row)");
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

test("myroutes: tapping a custom route shows it on the map and stays on the list; tapping again stops", async () => {
  reset();
  const ctx = makeCtx({ customRoutes: [C1, C2], hiddenRoutes: ["R2"] });
  ok(renderMyRoutes(ctx.store.get(), NOW).includes('data-action="mr:toggle" data-id="c2" aria-pressed="false"'), "row toggles");
  runAction("mr:toggle", { id: "c2" }, null, ctx);
  await tick();
  let s = ctx.store.get();
  eq(s.activeCustom, "c2");
  eq([...s.hiddenRoutes].sort(), ["R1", "R3"]);
  eq(s.prevHidden, ["R2"], "remembers previous hidden list");
  eq(ctx.calls.navigate.length, 0, "does NOT open the detail view");
  ok(renderMyRoutes(s, NOW).includes('data-id="c2" aria-pressed="true"'), "pressed state, not color alone");
  runAction("mr:toggle", { id: "c2" }, null, ctx);
  s = ctx.store.get();
  eq([s.activeCustom, s.hiddenRoutes], [null, ["R2"]], "second tap restores the usual routes");
  runAction("mr:toggle", { id: "c1" }, null, ctx);
  eq(ctx.calls.fitTo.length, 1, "fit to R1 shape (R2 has none)");
  eq(ctx.calls.navigate.length, 0);
});

test("customroute: detail shows Stop showing / Show on map, highlight toggles, delete asks in a popup", async () => {
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
  let backs = 0;
  ctx.back = () => { backs++; };
  runAction("mr:del", { id: "c1", from: "detail" }, null, ctx);
  ok(dlg() && dlg().textContent.includes("This can’t be undone"), "popup");
  ok(document.activeElement === dlg().querySelector('[data-confirm="no"]'), "Cancel focused, Delete is never the default");
  press('[data-confirm="no"]');
  await tick(60);
  eq(ctx.store.get().customRoutes.length, 2, "Cancel keeps it");
  runAction("mr:del", { id: "c1", from: "detail" }, null, ctx);
  press('[data-confirm="yes"]');
  await tick(60);
  eq(backs, 1, "back to the list after deleting from the detail view");
  const s = ctx.store.get();
  eq(s.customRoutes.map((c) => c.id), ["c2"]);
  eq(s.activeCustom, null);
  eq(s.hiddenRoutes, [], "applied one deleted -> previous hidden list restored");
  ok(renderCustom(s, "c1", NOW).includes("Custom route not found"));
});

test("customedit: validates >= 1 route, creates + applies, edits in place", async () => {
  reset();
  const ctx = makeCtx({ customRoutes: [C2], buses: [] });
  let backs = 0;
  ctx.back = () => { backs++; };
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
  eq(backs, 1, "saving a NEW route goes back to the My Routes list");
  ok(!ctx.calls.navigate.some(([v]) => v === "customroute"), "never opens Details after saving (only the Details button does)");
  ok(ctx.calls.toast.at(-1).includes("Lab run") && ctx.calls.toast.at(-1).includes("Showing"), "says it is showing");
  getView("customedit").unmount();
  el.innerHTML = renderEditor(s, made.id);
  ok(el.querySelector('input[value="R1"]').checked && !el.querySelector('input[value="R2"]').checked, "edit prefilled");
  el.querySelector('input[value="R2"]').checked = true;
  saveEditor(el.querySelector("form"), ctx);
  await tick();
  s = ctx.store.get();
  eq(s.customRoutes[1].rids, ["R1", "R2", "R3"]);
  eq(s.hiddenRoutes, [], "active one re-applied after edit");
  eq(backs, 2, "editing goes back to where you came from");
  el.remove();
});

test("myroutes: More button opens the swipe tray (Details / Edit / Delete); Details does not apply", async () => {
  reset();
  const ctx = makeCtx({ customRoutes: [C1, C2] });
  let h = renderMyRoutes(ctx.store.get(), NOW);
  const t = document.createElement("div");
  t.innerHTML = h;
  const row1 = t.querySelector('.mr-swipe[data-swipe-id="c1"]');
  ok(row1 && !row1.classList.contains("is-open") && row1.querySelector(".mr-acts").hasAttribute("inert"), "tray hidden and inert while closed");
  ok(row1.querySelector(".mr-front + .mr-acts"), "tray after the row: Tab goes row, More, then the actions");
  ok(h.includes('aria-label="More actions for Commute &lt;img src=x&gt;"') && noRaw(h), "escaped More button");
  ok(h.indexOf('data-action="mr:details"') < h.indexOf('data-action="mr:edit"') && h.indexOf('data-action="mr:edit"') < h.indexOf('data-action="mr:del"'), "Details, Edit, then Delete at the far end");
  runAction("mr:swipe", { id: "c2" }, null, ctx);
  t.innerHTML = renderMyRoutes(ctx.store.get(), NOW);
  const row2 = t.querySelector('.mr-swipe[data-swipe-id="c2"]');
  ok(row2.classList.contains("is-open") && !row2.querySelector(".mr-acts").hasAttribute("inert") && row2.querySelector('.mr-morebtn[aria-expanded="true"]'), "open, focusable");
  runAction("mr:details", { id: "c2" }, null, ctx);
  eq(ctx.calls.navigate.at(-1), ["customroute", { id: "c2" }]);
  ok(!ctx.store.get().activeCustom, "Details only shows the details");
  runAction("mr:edit", { id: "c1" }, null, ctx);
  eq(ctx.calls.navigate.at(-1), ["customedit", { id: "c1" }]);
  eq(_ui.swiped, null, "tray closes when an action runs");
});

test("myroutes: Delete from a row asks in a popup; Escape / Cancel keep it; Delete removes and stays", async () => {
  reset();
  const ctx = makeCtx({ customRoutes: [C1, C2], activeCustom: "c2", hiddenRoutes: ["R1", "R3"], prevHidden: [] });
  runAction("mr:del", { id: "c2", from: "list" }, null, ctx);
  ok(dlg() && dlg().getAttribute("role") === "alertdialog" && dlg().textContent.includes("Delete “Weekend”?"), "popup names it");
  dlg().dispatchEvent(new Event("cancel", { cancelable: true }));   // what the browser fires on Escape
  await tick(60);
  eq(ctx.store.get().customRoutes.length, 2, "Escape keeps it");
  runAction("mr:del", { id: "c2", from: "list" }, null, ctx);
  press('[data-confirm="yes"]');
  await tick(60);
  ok(!document.querySelector("dialog.v-confirm"), "popup removed");
  const st = ctx.store.get();
  eq(st.customRoutes.map((c) => c.id), ["c1"], "deleted after confirming");
  eq([st.activeCustom, st.hiddenRoutes], [null, []], "it was showing: usual routes are back");
  eq(ctx.calls.navigate.length, 0, "stays in the list");
  ok(ctx.calls.toast.at(-1).includes("Weekend"));
});

test("myroutes: swipe left opens the tray; a full swipe never deletes; the drag's click doesn't toggle", async () => {
  reset();
  const ctx = makeCtx({ customRoutes: [C1, C2] });
  const el = root();
  el.innerHTML = renderMyRoutes(ctx.store.get(), NOW);
  getView("myroutes").mount(el, ctx);
  const pe = (type, target, x, y = 10) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, clientX: x, clientY: y, button: 0, pointerType: "touch" }));
  const front = (id) => el.querySelector(`.mr-swipe[data-swipe-id="${id}"] .mr-front`);
  // a short drag snaps back
  pe("pointerdown", front("c1"), 300); pe("pointermove", front("c1"), 280); pe("pointermove", front("c1"), 260); pe("pointerup", front("c1"), 260);
  await tick(220);
  eq(_ui.swiped, null, "40 px: closes again");
  // a long drag (past the whole tray) only opens it
  let f = front("c1");
  pe("pointerdown", f, 360); pe("pointermove", f, 330); pe("pointermove", f, 100); pe("pointermove", f, -200); pe("pointerup", f, -200);
  f.querySelector(".mr-crow").click();             // the click a browser fires after the drag
  await tick(220);
  eq(_ui.swiped, "c1", "tray open");
  eq(ctx.store.get().customRoutes.length, 2, "full swipe did not delete");
  ok(!dlg(), "no popup either");
  ok(!ctx.store.get().activeCustom, "the click after the drag was swallowed");
  ok(el.querySelector('.mr-swipe[data-swipe-id="c1"]').classList.contains("is-open") && !el.querySelector('[data-swipe-id="c1"] .mr-acts').inert, "re-rendered open");
  // tapping another row only closes the tray
  f = front("c2");
  pe("pointerdown", f, 200); pe("pointerup", f, 200); f.querySelector(".mr-crow").click();
  await tick(220);
  ok(_ui.swiped === null && !ctx.store.get().activeCustom, "closed, nothing toggled");
  getView("myroutes").unmount();
  el.remove();
});

test("customroute: Edit and Delete sit right under Show on map, before the route list", () => {
  reset();
  const h = renderCustom(makeCtx({ customRoutes: [C1] }).store.get(), "c1", NOW);
  const i = h.indexOf('data-action="mr:edit"'), d = h.indexOf('data-action="mr:del"'), list = h.indexOf("mr-rrow");
  ok(i > h.indexOf('data-action="mr:apply"') && i < list && d < list, "actions above the routes");
});

test("customedit: Delete in the editor asks in a popup, keeps typed text on Cancel, then goes to My Routes", async () => {
  reset();
  const ctx = makeCtx({ customRoutes: [C1, C2] });
  const el = root();
  el.innerHTML = renderEditor(ctx.store.get(), "c2");
  getView("customedit").mount(el, ctx);
  ok(!renderEditor(ctx.store.get(), null).includes("mr-editdel"), "no delete when creating");
  el.querySelector("#mr-name").value = "typed but unsaved";
  const btn = el.querySelector('[data-action="mr:del"][data-from="edit"]');
  ok(btn && btn.textContent.includes("Delete custom route"));
  runAction("mr:del", { id: "c2", from: "edit" }, null, ctx);
  press('[data-confirm="no"]');
  await tick(60);
  eq([ctx.store.get().customRoutes.length, el.querySelector("#mr-name").value], [2, "typed but unsaved"], "Cancel: nothing lost");
  runAction("mr:del", { id: "c2", from: "edit" }, null, ctx);
  press('[data-confirm="yes"]');
  await tick(60);
  eq(ctx.store.get().customRoutes.map((c) => c.id), ["c1"]);
  eq(ctx.calls.navigate.at(-1), ["myroutes", {}], "to the list (the detail behind the editor is gone)");
  getView("customedit").unmount();
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

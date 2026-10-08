// Routes list v2.1: custom-route bar, inline naming, journey note, map-order editor (routes.test.html).
import { test, eq, ok } from "./lib.js";
import { fixture, makeCtx, tick, root } from "./views-fixtures.js";
import { bindActions, runAction } from "../js/ui/actions.js";
import { renderRoutes, groupRoutes, topBarHTML, orderHTML, defaultName, mountRoutes, unmountRoutes, _ui } from "../js/ui/views/routes.js";

const noRaw = (h) => !h.includes("<script>") && !h.includes("javascript:");
const C1 = { id: "c1", name: "Work <b>commute</b>", rids: ["R1", "R2"], highlight: [] };
const base = (over = {}) => fixture({ routeOrder: [], customRoutes: [], activeCustom: null, prevHidden: [], favStops: [], journey: null, ...over });

/** Mount like main.js: render, mount, delegate clicks. */
function mounted(over = {}) {
  const ctx = makeCtx({ routeOrder: [], customRoutes: [], activeCustom: null, prevHidden: [], favStops: [], journey: null, ...over });
  const el = root();
  el.innerHTML = renderRoutes(ctx.store.get());
  mountRoutes(el, ctx);
  const off = bindActions(el, () => ctx);
  return { ctx, el, done: () => { off?.(); unmountRoutes(); el.remove(); } };
}
const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

test("routes: no bar when nothing is hidden; make button once a route is hidden", () => {
  eq(topBarHTML(base()), "");
  const h = topBarHTML(base({ hiddenRoutes: ["R3"] }));
  ok(h.includes("Make this a custom route") && h.includes('data-action="routes:custom-new"'));
  eq(topBarHTML(base({ hiddenRoutes: ["R1", "R2", "R3"] })), "", "nothing visible -> nothing to save");
  ok(renderRoutes(base({ hiddenRoutes: ["R3"] })).indexOf("Make this a custom route") < renderRoutes(base({ hiddenRoutes: ["R3"] })).indexOf(">Running<"), "button at the top");
});

test("routes: applied custom route that still matches shows name + Clear", () => {
  const h = topBarHTML(base({ customRoutes: [C1], activeCustom: "c1", hiddenRoutes: ["R3"] }));
  ok(h.includes("Showing") && h.includes('data-action="custom:clear"') && !h.includes("Make this a custom route"));
  ok(h.includes("Work &lt;b&gt;commute&lt;/b&gt;") && !h.includes("<b>"), "name escaped");
});

test("routes: applied but changed offers Update / Save as new", () => {
  const h = topBarHTML(base({ customRoutes: [C1], activeCustom: "c1", hiddenRoutes: ["R2", "R3"] }));
  ok(h.includes('data-action="routes:custom-update"') && h.includes("Save as new") && h.includes('data-action="custom:clear"'));
});

test("routes: journey note with Show all; rows follow effectiveHidden, no eye for trip-only rows", () => {
  const s = base({ journey: { rids: ["R1"], label: "Library <i>", kind: "station" } });
  ok(topBarHTML(s).includes("Only showing routes for Library &lt;i&gt;") && topBarHTML(s).includes('data-action="journey:end"'));
  eq(groupRoutes(s).hidden.sort(), ["R2", "R3"]);
  const h = renderRoutes(s);
  ok(h.includes(">Not on this trip<") && h.includes("Not part of this trip"));
  ok(!h.includes('data-action="routes:toggle" data-id="R2"'), "no eye on journey-hidden row");
  ok(h.includes('data-action="routes:toggle" data-id="R1"'));
  ok(!h.includes("Make this a custom route"), "journey note replaces the custom bar");
});

test("routes: default names skip used ones", () => {
  eq(defaultName(base()), "My route 1");
  eq(defaultName(base({ customRoutes: [{ id: "a", name: "My route 2", rids: [], highlight: [] }] })), "My route 3");
});

test("routes: order editor lists draw order with labelled, end-disabled move buttons", () => {
  const h = orderHTML(base({ routeOrder: ["R2"] }));
  ok(h.includes("Routes higher in this list are drawn on top on the map"));
  const ids = [...h.matchAll(/data-dir="up" aria-label="Move ([^"]*) up"/g)].map((m) => m[1]);
  eq(ids[0], "Blue Loop", "routeOrder first");
  ok(/data-id="R2" data-dir="up" aria-label="Move Blue Loop up" disabled/.test(h), "top up disabled");
  ok(/data-dir="down" aria-label="Move [^"]* down" disabled/.test(h), "last down disabled");
  ok(h.includes("Reset order") && !orderHTML(base()).includes("Reset order"));
  ok(noRaw(h));
  ok(renderRoutes(base()).includes('data-action="routes:order-edit"'), "entry button in list mode");
});

test("routes: mounted naming flow: field focused + prefilled, Enter saves applied, toast, stays", async () => {
  const { ctx, el, done } = mounted({ hiddenRoutes: ["R3"], view: "routes" });
  el.querySelector('[data-action="routes:custom-new"]').click();
  const inp = el.querySelector('[data-input="routes-name"]');
  ok(inp && document.activeElement === inp, "field focused");
  eq(inp.value, "My route 1");
  ok(el.querySelector('label[for="rt-name-in"]'), "labelled");
  // live update while typing must not rebuild the field
  inp.value = "Gym run";
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  ctx.store.set({ feedTs: ctx.store.get().feedTs + 10 });
  await tick();
  ok(el.querySelector('[data-input="routes-name"]') === inp, "field kept across store updates");
  key(inp, "Enter");
  await tick();
  const s = ctx.store.get();
  eq(s.customRoutes.length, 1);
  eq(s.customRoutes[0].name, "Gym run");
  eq(s.customRoutes[0].rids.sort(), ["R1", "R2"]);
  eq(s.activeCustom, s.customRoutes[0].id);
  eq(ctx.calls.toast.pop(), "Saved to My Routes");
  eq(s.view, "routes");
  ok(el.textContent.includes("Showing") && el.textContent.includes("Gym run"));
  done();
});

test("routes: Escape cancels naming without bubbling to back(); Cancel button too", async () => {
  const { ctx, el, done } = mounted({ hiddenRoutes: ["R3"] });
  el.querySelector('[data-action="routes:custom-new"]').click();
  let leaked = false;
  const spy = (e) => { if (e.key === "Escape") leaked = true; };
  document.addEventListener("keydown", spy);
  key(el.querySelector('[data-input="routes-name"]'), "Escape");
  document.removeEventListener("keydown", spy);
  ok(!leaked, "Escape stopped");
  ok(!el.querySelector('[data-input="routes-name"]') && el.querySelector('[data-action="routes:custom-new"]'));
  eq(document.activeElement, el.querySelector('[data-action="routes:custom-new"]'), "focus back on the button");
  el.querySelector('[data-action="routes:custom-new"]').click();
  el.querySelector('[data-action="routes:custom-cancel"]').click();
  eq(ctx.store.get().customRoutes.length, 0);
  done();
});

test("routes: Update rewrites the applied route with what is visible now", async () => {
  const { ctx, el, done } = mounted({ customRoutes: [C1], activeCustom: "c1", hiddenRoutes: ["R2", "R3"] });
  el.querySelector('[data-action="routes:custom-update"]').click();
  await tick();
  eq(ctx.store.get().customRoutes[0].rids, ["R1"]);
  ok(ctx.calls.toast.pop().startsWith("Updated"));
  await tick();
  ok(el.textContent.includes("Showing") && !el.querySelector('[data-action="routes:custom-update"]'));
  done();
});

test("routes: order mode moves routes, keeps focus on the moved button, Done/Reset", async () => {
  const { ctx, el, done } = mounted();
  el.querySelector('[data-action="routes:order-edit"]').click();
  ok(el.querySelector(".rt-order") && !el.querySelector('[data-action="pick:open"]'), "editor replaces list");
  eq(document.activeElement, el.querySelector('[data-action="routes:order-done"]'));
  const first = () => el.querySelector(".rt-orow [data-dir=up]").dataset.id;
  const startTop = first();
  const second = el.querySelectorAll(".rt-orow")[1].querySelector("[data-dir=up]");
  const moved = second.dataset.id;
  second.click();
  await tick();
  eq(first(), moved, "moved to the top");
  eq(ctx.store.get().routeOrder[0], moved);
  const act = document.activeElement;
  ok(act && act.dataset.id === moved && act.dataset.dir === "down", "focus moves to the enabled button of the moved row");
  ok(el.querySelector('[data-action="routes:order-reset"]'));
  el.querySelector('[data-action="routes:order-reset"]').click();
  await tick();
  eq(ctx.store.get().routeOrder, []);
  eq(first(), startTop);
  el.querySelector('[data-action="routes:order-done"]').click();
  ok(el.querySelector('[data-action="pick:open"]') && _ui.mode === "list");
  eq(document.activeElement, el.querySelector('[data-action="routes:order-edit"]'));
  done();
});

test("routes: moveInOrder no-op at the ends", () => {
  const ctx = makeCtx({ routeOrder: [] });
  runAction("routes:move", { id: "R1", dir: "up" }, null, ctx);   // R1 is first in data order
  eq(ctx.store.get().routeOrder, []);
});

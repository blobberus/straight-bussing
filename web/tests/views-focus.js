// QA regression (2026-10-09): keyboard focus survives toggles and live re-renders. Before, Enter on a Routes eye,
// Favorite, Show all / Hide all or End trip, and every live update of the Routes list, the Current trip timeline
// and the stop / route detail threw keyboard and screen-reader users back to <body>.
import { test, eq, ok } from "./lib.js";
import { makeCtx, tick, root } from "./views-fixtures.js";
import { setHTMLKeepFocus, bindActions, registerAction } from "../js/ui/actions.js";
import { mountRoutes, unmountRoutes, renderRoutes } from "../js/ui/views/routes.js";

const btn = (action, id, extra = "") => `<button type="button" data-action="${action}" data-id="${id}"${extra}>${action} ${id}</button>`;

test("focus: setHTMLKeepFocus keeps focus on the same action + id (+ trip), and on a focusable title", () => {
  const el = root();
  el.innerHTML = btn("route:open", "R1", ' data-trip="t1"') + btn("route:open", "R1", ' data-trip="t2"') + btn("stop:open", "S2");
  el.querySelectorAll("button")[1].focus();
  setHTMLKeepFocus(el, btn("stop:open", "S2") + btn("route:open", "R1", ' data-trip="t1"') + btn("route:open", "R1", ' data-trip="t2"'));
  eq([document.activeElement.dataset.id, document.activeElement.dataset.trip], ["R1", "t2"], "same arrival row after the update");
  el.innerHTML = '<span class="v-prim tp-title" tabindex="-1">Trip to X</span><span class="v-prim">other</span>';
  el.querySelector(".tp-title").focus();
  setHTMLKeepFocus(el, '<span class="v-prim">other</span><span class="v-prim tp-title" tabindex="-1">Trip to Y</span>');
  eq(document.activeElement.textContent, "Trip to Y", "the trip title keeps focus");
  el.remove();
});

test("focus: an action that re-renders its own button gives focus to the replacement, else to the sheet title", async () => {
  const el = root(), title = document.getElementById("title") || Object.assign(document.body.appendChild(document.createElement("h1")), { id: "title", tabIndex: -1 });
  registerAction("qa:swap", () => { el.innerHTML = btn("qa:other", "Z") + btn("qa:swap", "A"); });
  registerAction("qa:gone", () => { el.innerHTML = "<p>done</p>"; });
  const off = bindActions(el, () => ({}));
  el.innerHTML = btn("qa:swap", "A");
  el.querySelector("button").focus(); el.querySelector("button").click();
  await tick(5);
  eq([document.activeElement.dataset.action, document.activeElement.dataset.id], ["qa:swap", "A"], "replacement focused");
  el.innerHTML = btn("qa:gone", "B");
  el.querySelector("button").focus(); el.querySelector("button").click();
  await tick(5);
  ok(document.activeElement === title, "falls back to the sheet title, not <body>");
  off(); el.remove();
});

test("focus: Routes eye toggle and a live count change keep focus on that route's eye", async () => {
  const ctx = makeCtx({ view: "routes" });
  const el = root();
  el.innerHTML = renderRoutes(ctx.store.get());
  mountRoutes(el, ctx);
  const off = bindActions(el, () => ctx);
  await tick();
  const eye = el.querySelector('[data-action="routes:toggle"][data-id="R2"]');
  eye.focus(); eye.click();                                // Enter / Space on a button = click
  await tick(10);
  ok(document.activeElement?.matches?.('[data-action="routes:toggle"][data-id="R2"]') && document.activeElement !== eye, "focus followed the eye to the Hidden group");
  ctx.store.set({ buses: ctx.store.get().buses.slice(0, 1) });   // live update: counts change, the list re-renders
  await tick(10);
  ok(document.activeElement?.matches?.('[data-action="routes:toggle"][data-id="R2"]'), "still on the R2 eye after a live update");
  off(); unmountRoutes(); el.remove();
});

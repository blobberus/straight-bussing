// My Routes regressions (owner report 2026-10-09): a row tap only toggles (never opens Details), the
// row never moves or re-flows when selected, live updates never recreate rows, tap vs drag thresholds
// for touch / mouse / pen (also in the scaled desktop frame), tray timing, focus, and the popup.
import { test, eq, ok } from "./lib.js";
import { NOW, makeCtx, tick, root } from "./views-fixtures.js";
import { runAction, bindActions } from "../js/ui/actions.js";
import { getView } from "../js/ui/router.js";
import { _ui, renderCustom, renderMyRoutes } from "../js/ui/views/myroutes.js";
import { morph, createPatcher } from "../js/ui/views/myroutes-patch.js";
import { confirmDialog } from "../js/ui/confirm.js";

const LONG = "A very long custom route name that keeps going on and on and on".slice(0, 60);
const C1 = { id: "c1", name: "Commute", rids: ["R1", "R3"], highlight: [] };
const C2 = { id: "c2", name: "Weekend", rids: ["R2"], highlight: [] };
const many = () => Array.from({ length: 10 }, (_, i) => ({ id: "m" + i, name: i % 3 ? `Set ${i}` : LONG, rids: ["R1", "R2", "R3"].slice(0, (i % 3) + 1), highlight: [] }));
const dlg = () => document.querySelector("dialog.v-confirm[open]");
const clean = () => { _ui.favEdit = false; _ui.swiped = null; document.querySelectorAll("dialog.v-confirm").forEach((d) => d.remove()); };

/** Mount the real My Routes view (+ real action delegation) in a fixed-width root. */
function mountList(over = {}, width = 360) {
  clean();
  const ctx = makeCtx({ view: "myroutes", activeCustom: null, hiddenRoutes: [], ...over });
  const el = root();
  el.style.cssText = `width:${width}px;font-family:system-ui;`;
  el.innerHTML = getView("myroutes").render(ctx.store.get());
  getView("myroutes").mount(el, ctx);
  const unbind = bindActions(el, () => ctx);
  const q = (s) => el.querySelector(s);
  return { ctx, el, q, row: (id) => q(`.mr-swipe[data-swipe-id="${id}"]`), done() { getView("myroutes").unmount(); unbind(); el.remove(); clean(); } };
}

let PID = 40;
/** A pointer press on `el` with relative moves, then (like a browser) the click. */
function gesture(el, { type = "touch", path = [], click = true } = {}) {
  const r = el.getBoundingClientRect(), x0 = r.left + r.width * 0.4, y0 = r.top + r.height / 2, pointerId = ++PID;
  const fire = (t, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId, pointerType: type, isPrimary: true, button: 0, buttons: t === "pointerup" ? 0 : 1, clientX: x, clientY: y }));
  let x = x0, y = y0;
  fire("pointerdown", x, y);
  for (const [dx, dy] of path) { x = x0 + dx; y = y0 + dy; fire("pointermove", x, y); }
  fire("pointerup", x, y);
  if (click) el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: x, clientY: y }));
}
const userClick = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
const rects = (el, sel) => [...el.querySelectorAll(sel)].map((n) => { const r = n.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10); });

test("myroutes gestures: a tap (touch / mouse / pen, jitter < 10 px) toggles, never navigates, never moves the row", async () => {
  const m = mountList({ customRoutes: [C1, C2] });
  for (const type of ["touch", "mouse", "pen"]) {
    const crow = m.q('[data-id="c1"].mr-crow'), front = m.row("c1").querySelector(".mr-front");
    gesture(crow, { type, path: [[3, 2], [6, -3], [-4, 5]] });
    await tick(5);
    eq(m.ctx.store.get().activeCustom, "c1", type + ": shown on the map");
    ok(!front.style.transform && !m.row("c1").classList.contains("is-open"), type + ": the row did not move, no tray");
    gesture(crow, { type });
    await tick(5);
    eq(m.ctx.store.get().activeCustom, null, type + ": tap again stops showing");
  }
  eq(m.ctx.calls.navigate.length, 0, "a row tap NEVER opens the detail view");
  m.done();
});

test("myroutes gestures: past the slop it is a drag (row starts from 0, click swallowed); a short drag never opens the tray", async () => {
  const m = mountList({ customRoutes: [C1, C2] });
  const crow = m.q('[data-id="c1"].mr-crow'), front = m.row("c1").querySelector(".mr-front");
  const r = crow.getBoundingClientRect(), x0 = r.left + 100, y0 = r.top + 20;
  const pe = (t, x, y = y0) => crow.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 77, pointerType: "touch", isPrimary: true, button: 0, clientX: x, clientY: y }));
  pe("pointerdown", x0); pe("pointermove", x0 - 12);
  eq(front.style.transform, "translate3d(0px, 0px, 0px)", "the drag starts where the slop ended: no jump");
  pe("pointermove", x0 - 40);
  eq(front.style.transform, "translate3d(-28px, 0px, 0px)", "then follows the finger 1:1");
  pe("pointerup", x0 - 40); userClick(crow);
  await tick(5);
  ok(!m.row("c1").classList.contains("is-open") && !front.style.transform, "snapped back closed (class + css transition)");
  eq(m.ctx.store.get().activeCustom, null, "the click after a drag does not toggle");
  for (const type of ["mouse", "pen"]) {
    gesture(crow, { type, path: [[0, 14], [2, 30]] });   // vertical: list scroll, not a tap either
    await tick(5);
    ok(!front.style.transform && m.ctx.store.get().activeCustom === null, type + ": vertical move neither moves the row nor toggles");
  }
  gesture(crow, { type: "mouse", path: [[0, 4]] });     // and a real tap right after still works
  await tick(5);
  eq(m.ctx.store.get().activeCustom, "c1", "a real tap is never swallowed");
  m.done();
});

test("myroutes gestures: in the scaled desktop frame the slop is measured in the row's CSS px", async () => {
  const m = mountList({ customRoutes: [C1, C2] });
  m.el.style.transform = "scale(0.5)"; m.el.style.transformOrigin = "0 0";
  const crow = m.q('[data-id="c1"].mr-crow');
  gesture(crow, { type: "mouse", path: [[-6, 0]] });   // 6 screen px = 12 CSS px: a drag
  await tick(5);
  eq(m.ctx.store.get().activeCustom, null, "12 CSS px is a drag");
  gesture(crow, { type: "mouse", path: [[-4, 0]] });   // 4 screen px = 8 CSS px: a tap
  await tick(5);
  eq(m.ctx.store.get().activeCustom, "c1", "8 CSS px is a tap");
  m.done();
});

test("myroutes geometry: selecting / deselecting changes no size or position (60-char names, 10 routes, 320 px)", async () => {
  const m = mountList({ customRoutes: many(), favStops: ["S1"] }, 320);
  const sel = ".mr-swipe, .mr-name, .mr-chips, .mr-tick, .mr-morebtn, .mr-hint, .mr-hrow";
  const before = rects(m.el, sel), rows = [...m.el.querySelectorAll(".mr-swipe")];
  ok(new Set(rects(m.el, ".mr-swipe").map((r) => r[3])).size === 1, "every row has the same height");
  for (const id of ["m0", "m1", "m0", "m0"]) {
    gesture(m.q(`[data-id="${id}"].mr-crow`));
    await tick(5);
    eq(rects(m.el, sel), before, "rects identical after toggling " + id);
  }
  ok(rows.every((r, i) => r === m.el.querySelectorAll(".mr-swipe")[i]), "same row elements (not re-created)");
  const nm = m.q('[data-id="m0"] .mr-name');
  ok(getComputedStyle(nm).whiteSpace === "nowrap" && getComputedStyle(nm).textOverflow === "ellipsis", "long names end in an ellipsis");
  m.done();
});

test("myroutes patching: live updates never recreate or touch custom route rows", async () => {
  const m = mountList({ customRoutes: [C1, C2], favStops: ["S1"] });
  const list = m.q(".mr-clist"), rows = [...list.children];
  let muts = 0;
  const mo = new MutationObserver((r) => { muts += r.length; });
  mo.observe(list, { subtree: true, childList: true, attributes: true, characterData: true });
  const s = m.ctx.store.get();
  m.ctx.store.set({ buses: [...s.buses], feedTs: NOW + 10, trips: [...s.trips] });
  await tick(5);
  m.ctx.store.set({ alerts: [{ header_text: "Detour", active_period: [] }], favStops: ["S1", "S2"] });
  await tick(5);
  getView("myroutes").refresh();
  mo.disconnect();
  eq(muts, 0, "no mutation inside the custom routes list");
  ok(rows.every((r, i) => r === list.children[i]) && list === m.q(".mr-clist"), "same elements");
  ok(m.el.textContent.includes("1 active alert") && m.el.textContent.includes("Library"), "the other sections did update");
  m.done();
});

test("myroutes tray: More opens it in place (animated), focus to Details; Escape closes it back to More", async () => {
  const m = mountList({ customRoutes: [C1, C2] });
  const row = m.row("c2"), front = row.querySelector(".mr-front"), more = row.querySelector(".mr-morebtn");
  ok(row.querySelector(".mr-acts").inert, "closed tray is inert (not focusable, hidden from screen readers)");
  row.querySelector(".mr-act").focus();
  ok(document.activeElement !== row.querySelector(".mr-act"), "cannot focus a closed tray");
  userClick(more);
  ok(row === m.row("c2") && front === row.querySelector(".mr-front"), "same elements: the css transition animates it");
  ok(row.classList.contains("is-open") && !row.querySelector(".mr-acts").inert && more.getAttribute("aria-expanded") === "true", "open + exposed");
  eq(document.activeElement, row.querySelector('[data-action="mr:details"]'), "focus on Details");
  eq(_ui.swiped, "c2");
  const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(esc);
  ok(esc.defaultPrevented && !row.classList.contains("is-open") && row.querySelector(".mr-acts").inert, "Escape closed the tray (and not the sheet)");
  eq(document.activeElement, more, "focus back on More");
  eq(m.ctx.calls.navigate.length, 0);
  m.done();
});

test("myroutes tray: a double tap on More never presses Delete; a deliberate Delete asks first", async () => {
  const m = mountList({ customRoutes: [C1, C2] });
  const row = m.row("c1");
  userClick(row.querySelector(".mr-morebtn"));
  userClick(row.querySelector('[data-action="mr:del"]'));   // the second tap of a double tap lands here
  await tick(20);
  ok(!dlg(), "no popup from the double tap");
  await tick(380);
  userClick(row.querySelector('[data-action="mr:del"]'));
  await tick(5);
  ok(dlg(), "a deliberate tap on Delete asks");
  dlg().querySelector('[data-confirm="no"]').click();
  await tick(20);
  eq(m.ctx.store.get().customRoutes.length, 2);
  m.done();
});

test("myroutes tray: survives live updates; a tap elsewhere only closes it; Details is the only way to the detail view", async () => {
  const m = mountList({ customRoutes: [C1, C2] });
  userClick(m.row("c1").querySelector(".mr-morebtn"));
  const front = m.row("c1").querySelector(".mr-front");
  m.ctx.store.set({ feedTs: NOW + 20, buses: [...m.ctx.store.get().buses] });
  await tick(400);   // after the open animation
  ok(m.row("c1").classList.contains("is-open") && m.row("c1").querySelector(".mr-front") === front, "still open, same row");
  gesture(m.q('[data-id="c2"].mr-crow'));
  await tick(5);
  ok(!m.row("c1").classList.contains("is-open") && m.ctx.store.get().activeCustom === null, "closed; the other row did not toggle");
  gesture(m.q('[data-id="c1"].mr-crow'));
  await tick(5);
  eq(m.ctx.store.get().activeCustom, "c1", "next tap toggles");
  eq(m.ctx.calls.navigate.length, 0, "still no navigation");
  userClick(m.row("c2").querySelector(".mr-morebtn"));
  await tick(400);
  userClick(m.row("c2").querySelector('[data-action="mr:details"]'));
  eq(m.ctx.calls.navigate.at(-1), ["customroute", { id: "c2" }], "Details button opens the detail view");
  // the app unmounts the list for the detail view and mounts it again on Back
  getView("myroutes").unmount();
  m.el.innerHTML = getView("myroutes").render(m.ctx.store.get());
  getView("myroutes").mount(m.el, m.ctx);
  eq(_ui.swiped, null, "tray closed after coming back");
  gesture(m.q('[data-id="c2"].mr-crow'));
  await tick(5);
  eq(m.ctx.store.get().activeCustom, "c2", "after Details + Back a tap still only toggles");
  eq(m.ctx.calls.navigate.length, 1, "...and does not re-open the detail view");
  m.done();
});

test("myroutes delete: from a row asks, then focus continues at the next row", async () => {
  const m = mountList({ customRoutes: [C1, C2] });
  userClick(m.row("c1").querySelector(".mr-morebtn"));
  await tick(380);
  const del = m.row("c1").querySelector('[data-action="mr:del"]');
  del.focus();
  userClick(del);
  await tick(5);
  dlg().querySelector('[data-confirm="yes"]').click();
  await tick(30);
  ok(!m.row("c1") && m.row("c2"), "deleted");
  eq(document.activeElement, m.q('[data-id="c2"].mr-crow'), "focus moved to the next row");
  m.done();
});

test("myroutes favorites: Move up / down keeps keyboard focus in the moved row", async () => {
  const m = mountList({ favStops: ["S1", "S2", "S3"] });
  userClick(m.q('[data-action="mr:favedit"]'));
  const down = m.q('[data-action="mr:favmove"][data-id="S1"][data-dir="1"]');
  down.focus();
  userClick(down);
  await tick(10);
  eq(m.ctx.store.get().favStops, ["S2", "S1", "S3"]);
  eq(document.activeElement?.dataset.id, "S1", "focus stays with S1");
  const up = m.q('[data-action="mr:favmove"][data-id="S1"][data-dir="-1"]');
  up.focus(); userClick(up);
  await tick(10);
  eq(m.ctx.store.get().favStops, ["S1", "S2", "S3"]);
  eq([document.activeElement?.dataset.id, document.activeElement?.disabled], ["S1", false], "at the top: focus moves to an enabled button of S1");
  m.done();
});

test("customroute: Show on map / Stop showing keeps focus on the same button (patched in place)", async () => {
  clean();
  const ctx = makeCtx({ customRoutes: [C1, C2] });
  const el = root();
  el.innerHTML = renderCustom(ctx.store.get(), "c1", NOW);
  const p = createPatcher(el, () => renderCustom(ctx.store.get(), "c1", NOW));
  p.flush();
  const btn = el.querySelector('[data-fkey="primary"]');
  btn.focus();
  runAction("mr:apply", { id: "c1" }, null, ctx);
  p.flush();
  ok(el.querySelector('[data-fkey="primary"]') === btn && btn.textContent === "Stop showing" && document.activeElement === btn, "same focused button, now Stop showing");
  p.stop(); el.remove();
});

test("patcher: a press that ends outside the root (or never ends) does not freeze updates", async () => {
  const el = root();
  let n = 0;
  el.innerHTML = "<button>0</button>";
  const p = createPatcher(el, () => `<button>${n}</button>`);
  const b = el.querySelector("button");
  b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 5 }));
  n = 1; p.flush();
  eq(b.textContent, "0", "held while pressed");
  document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 5 }));
  await tick(5);
  ok(el.querySelector("button") === b && b.textContent === "1", "released by a pointerup outside the root; same element patched");
  p.stop(); el.remove();
});

test("morph: keyed reorder / insert / remove keeps elements; script-set inline style survives", () => {
  const el = root();
  el.innerHTML = '<div data-key="a">A</div><div data-key="b" class="x">B</div><p>t</p>';
  const a = el.children[0], b = el.children[1];
  b.style.transform = "translate3d(-5px, 0, 0)";
  morph(el, '<div data-key="b" class="y">B2</div><div data-key="c">C</div><div data-key="a">A</div><p>u</p>');
  ok(el.children[0] === b && el.children[2] === a, "keyed elements reused and reordered");
  eq([b.className, b.textContent, b.style.transform, el.children[1].textContent, el.lastChild.textContent], ["y", "B2", "translate3d(-5px, 0px, 0px)", "C", "u"]);
  morph(el, '<div data-key="a">A</div>');
  ok(el.children.length === 1 && el.firstChild === a, "removed the rest");
  el.remove();
});

test("confirm popup: taps on its padding don't cancel, ghost taps are ignored, only one at a time", async () => {
  clean();
  const p = confirmDialog({ title: "Delete it?", confirmLabel: "Delete", danger: true });
  const d = dlg();
  let settled = null;
  p.then((v) => { settled = v; });
  eq(await confirmDialog({ title: "again" }), false, "a second popup is refused while one is open");
  userClick(d.querySelector('[data-confirm="yes"]'));   // ghost tap from the press that opened it
  await tick(5);
  ok(settled === null && d.open, "ignored right after opening");
  await tick(380);
  const r = d.getBoundingClientRect();
  d.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: r.left + 4, clientY: r.top + 4 }));
  await tick(5);
  ok(settled === null && d.open, "a tap on the popup's own padding does not cancel");
  d.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: Math.max(0, r.left - 10), clientY: Math.max(0, r.top - 10) }));
  await tick(5);
  eq(settled, false, "a tap outside the popup cancels");
  ok(!dlg(), "removed");
});

test("myroutes: empty states and the markup keep stable keys for in-place patching", () => {
  clean();
  const h = renderMyRoutes(makeCtx({}).store.get(), NOW);
  ok(['data-key="h-custom"', 'data-key="cempty"', 'data-key="h-fav"', 'data-key="fempty"', 'data-key="links"'].every((k) => h.includes(k)), "keyed sections");
  ok(!h.includes('class="v-card mr-more"'), "the alerts/about card no longer shares the More button's class");
});

// ui/settings-overlay.js + the gear action in ui/views/settings.js (settings.test.html)
import { test, eq, ok, near } from "./lib.js";
import { makeCtx, tick } from "./views-fixtures.js";
import { bindActions, registerAction } from "../js/ui/actions.js";
import { getView } from "../js/ui/router.js";
import { overlayBox, isSettingsOpen, closeSettingsOverlay, OVERLAY_ID } from "../js/ui/settings-overlay.js";
import "../js/ui/views/settings.js";
import { cleanNotify } from "../js/state.js";

registerAction("about:open", (ds, ev, ctx) => ctx.navigate("about"), { fallback: true });

/** A minimal app shell: #app, gear, #sheet with #tabs and #content; ctx.setDetent writes data-detent. */
function shell({ detent = "half" } = {}) {
  const ctx = makeCtx({ notify: cleanNotify(null), favStops: [], journey: null });
  const app = document.createElement("div");
  app.id = "app";
  app.innerHTML = '<button id="settingsBtn" type="button" data-action="settings:open" aria-label="Settings" style="width:44px;height:44px">G</button>'
    + `<section id="sheet" data-detent="${detent}" style="position:fixed;left:0;right:0;bottom:0;height:500px">`
    + '<header id="sheetHead"><h1 id="title" tabindex="-1">Nearby</h1><nav id="tabs" style="display:flex;height:40px">'
    + '<button type="button" data-tab="nearby">Nearby</button><button type="button" data-tab="routes">Routes</button></nav></header>'
    + '<div id="content">sheet content</div></section>';
  document.body.appendChild(app);
  const sheet = app.querySelector("#sheet");
  ctx.setDetent = (d) => { sheet.dataset.detent = d; };
  ctx.back = () => ctx.store.set({ view: "nearby" });
  const offs = [bindActions(app.querySelector("#settingsBtn"), () => ctx), bindActions(app.querySelector("#content"), () => ctx)];
  const onTab = (e) => { const b = e.target.closest("button[data-tab]"); if (b) ctx.navigate(b.dataset.tab); };   // like main.js
  app.querySelector("#tabs").addEventListener("click", onTab);
  const ov = () => document.getElementById(OVERLAY_ID);
  return {
    ctx, app, sheet, ov, gear: app.querySelector("#settingsBtn"),
    done: () => { closeSettingsOverlay({ focus: "none" }); offs.forEach((f) => f()); app.remove(); },
  };
}
const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const key = (el, k, o = {}) => { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...o }); el.dispatchEvent(e); return e; };

test("overlay box: exactly over the full-detent sheet, also mid-transition, framed and floating", () => {
  const sheet = { top: 110, left: 0, width: 393, bottom: 852 };
  eq(overlayBox({ sheet, origin: { left: 0, top: 0 }, height: 852 }), { top: 110, left: 0, width: 393, bottom: 0 });
  // sheet still 200 px below its full position: the overlay goes where the sheet will settle
  const mid = overlayBox({ sheet: { ...sheet, top: 310, bottom: 1052 }, origin: { left: 0, top: 0 }, ty: 200, height: 852 });
  eq([mid.top, mid.bottom], [110, 0]);
  // desktop iPhone frame scaled to 0.5 at (100, 50): result is in #app layout px
  const f = overlayBox({ sheet: { top: 50 + 110 * 0.5, left: 100, width: 196.5, bottom: 50 + 852 * 0.5 }, origin: { left: 100, top: 50 }, k: 0.5, height: 852 });
  near(f.top, 110, 1e-9); eq([f.left, f.width, f.bottom], [0, 393, 0]);
  // landscape panel (sheet ends 12 px above the bottom)
  eq(overlayBox({ sheet: { top: 12, left: 12, width: 380, bottom: 380 }, origin: { left: 0, top: 0 }, height: 392 }).bottom, 12);
});

test("gear opens an accessible modal overlay over the whole sheet; sheet goes full; content not in the sheet", async () => {
  const t = shell();
  try {
    click(t.gear);
    const o = t.ov();
    ok(o && t.app.contains(o) && !o.hidden && o.dataset.state === "open" && isSettingsOpen(), "overlay open inside #app");
    eq([o.getAttribute("role"), o.getAttribute("aria-modal")], ["dialog", "true"]);
    eq(document.getElementById(o.getAttribute("aria-labelledby")).textContent, "Settings");
    const doneBtn = o.querySelector(".sto-done"), r = doneBtn.getBoundingClientRect();
    ok(doneBtn.textContent === "Done" && r.width >= 44 && r.height >= 44, "Done is a 44px target: " + r.width + "x" + r.height);
    ok(r.right > o.getBoundingClientRect().right - 60, "Done sits top right");
    eq(t.sheet.dataset.detent, "full");
    ok(o.contains(document.activeElement), "focus moved into the overlay");
    for (const s of ["Appearance", "Service alerts", "Bus alerts", "iPhone app", 'data-action="about:open"']) ok(o.innerHTML.includes(s), s);
    ok(!document.getElementById("content").innerHTML.includes("Bus alerts"), "settings never render in the sheet");
    ok(document.getElementById("content").inert, "sheet content inert behind the modal");
    near(parseFloat(o.style.top), Math.max(0, t.sheet.getBoundingClientRect().top), 1, "top edge at the sheet's top (clamped to the screen): title and tabs covered");
    ok(document.getElementById("sheetHead").inert, "covered sheet header (title, tabs) inert");
    const sc = t.app.querySelector(".sto-scrim");
    ok(sc && !sc.hidden, "scrim dims what is behind");
    eq(t.gear.getAttribute("aria-expanded"), "true");
    ok(o.querySelector('[data-region="theme"] .themeseg'), "theme control mounted");
  } finally { t.done(); }
});

test("Escape closes, restores the detent, returns focus to the gear; main.js Escape not triggered", async () => {
  const t = shell({ detent: "half" });
  let leaked = 0;
  const spy = (e) => { if (e.key === "Escape" && !e.defaultPrevented) leaked++; };
  document.addEventListener("keydown", spy);
  try {
    t.gear.focus();
    click(t.gear);
    key(document.activeElement, "Escape");
    ok(!isSettingsOpen() && t.ov().dataset.state === "closed");
    eq(t.sheet.dataset.detent, "half");
    eq(document.activeElement, t.gear);
    eq(leaked, 0, "event consumed");
    ok(!document.getElementById("content").inert);
    await tick(450);
    ok(t.ov().hidden, "hidden after the slide-down");
  } finally { document.removeEventListener("keydown", spy); t.done(); }
});

test("Done closes; the gear toggles; Tab is trapped inside", async () => {
  const t = shell({ detent: "peek" });
  try {
    click(t.gear);
    const o = t.ov(), doneBtn = o.querySelector(".sto-done");
    const f = [...o.querySelectorAll('button, input, select, [href]')].filter((x) => x.getClientRects().length && !x.disabled);
    const last = f[f.length - 1];
    last.focus();
    key(last, "Tab");
    eq(document.activeElement, doneBtn, "Tab from the last control wraps to Done");
    key(doneBtn, "Tab", { shiftKey: true });
    eq(document.activeElement, last, "Shift+Tab from Done wraps to the last control");
    click(doneBtn);
    ok(!isSettingsOpen());
    eq(t.sheet.dataset.detent, "peek", "previous detent restored");
    click(t.gear);
    ok(isSettingsOpen());
    click(t.gear);
    ok(!isSettingsOpen(), "gear closes it again");
  } finally { t.done(); }
});

test("tapping the dimmed area closes Settings and un-inerts the sheet", async () => {
  const t = shell({ detent: "half" });
  try {
    click(t.gear);
    const sc = t.app.querySelector(".sto-scrim");
    click(sc);
    ok(!isSettingsOpen(), "scrim tap closes");
    eq(t.sheet.dataset.detent, "half", "previous detent restored");
    ok(!document.getElementById("sheetHead").inert && !document.getElementById("content").inert, "sheet usable again");
    eq(document.activeElement, t.gear, "focus back on the gear");
    await tick(450);
    ok(sc.hidden, "scrim hidden after closing");
  } finally { t.done(); }
});

test("navigating (About) or dragging the sheet out of full closes Settings", async () => {
  const t = shell();
  try {
    click(t.gear);
    click(t.ov().querySelector('[data-action="about:open"]'));
    await tick();
    ok(!isSettingsOpen());
    eq(t.ctx.store.get().view, "about");
    eq(document.activeElement, document.getElementById("title"), "focus to the sheet title");
    click(t.gear);
    ok(isSettingsOpen());
    t.sheet.dataset.detent = "half";   // user dragged the sheet down
    await tick();
    ok(!isSettingsOpen());
    eq(t.sheet.dataset.detent, "half", "user's detent kept");
  } finally { t.done(); }
});

test("settings view shim: navigate('settings') goes back and opens the overlay", async () => {
  const t = shell();
  try {
    t.ctx.store.set({ view: "settings" });
    getView("settings").mount(document.getElementById("content"), t.ctx);
    await tick(10);
    eq(t.ctx.store.get().view, "nearby");
    ok(isSettingsOpen() && t.ov().dataset.state === "open");
    await tick();
    ok(isSettingsOpen(), "stays open after the back navigation");
  } finally { t.done(); }
});

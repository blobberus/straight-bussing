// ui/settings-overlay.js + the gear action in ui/views/settings.js (settings.test.html)
import { test, eq, ok, near } from "./lib.js";
import { makeCtx, tick } from "./views-fixtures.js";
import { bindActions, registerAction } from "../js/ui/actions.js";
import { getView } from "../js/ui/router.js";
import { zoomOrigin, isSettingsOpen, closeSettingsOverlay, OVERLAY_ID, SWIPE_CLOSE_PX } from "../js/ui/settings-overlay.js";
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

test("zoom origin (mZoomSheet, glass spec 7): the trigger's center in the sheet's box, also in a scaled frame", () => {
  eq(zoomOrigin({ left: 337, top: 62, width: 44, height: 44 }, { left: 0, top: 64 }), "359px 20px", "the gear, top right");
  eq(zoomOrigin({ left: 100 + 337 * 0.5, top: 50 + 62 * 0.5, width: 22, height: 22 }, { left: 100, top: 50 + 64 * 0.5 }, 0.5), "359px 20px", "the desktop frame at half size: layout px");
  eq(zoomOrigin(null, { left: 0, top: 0 }), null, "no trigger: no origin (the sheet scales from its center)");
  eq(zoomOrigin({ left: 0, top: 0, width: 0, height: 0 }, { left: 0, top: 0 }), null, "a hidden trigger");
});

test("behind the open sheet the map (its credit links) and the status banner (Retry, Details, Call) are inert too: covered, so not reachable by a screen reader; back after closing", async () => {
  const t = shell();
  try {
    t.app.insertAdjacentHTML("afterbegin", '<div id="map" tabindex="0"><a href="#credit">OpenStreetMap</a></div>'
      + '<div id="pill" role="status"><button id="pillRetry" type="button">Retry</button><button class="pillmore" type="button" aria-label="Details">Details</button></div>');
    click(t.gear);
    ok(isSettingsOpen(), "open");
    for (const id of ["map", "pill", "sheetHead", "content", "tabs"]) ok(document.getElementById(id).inert, id + " inert while Settings is open");
    closeSettingsOverlay({ focus: "none" });
    for (const id of ["map", "pill"]) ok(!document.getElementById(id).inert, id + " usable again after closing");
  } finally { t.done(); }
});

test("gear opens an accessible modal sheet of its own (glass spec 9.8); the app's sheet keeps its state; content not in the sheet", async () => {
  const t = shell();
  try {
    click(t.gear);
    const o = t.ov();
    ok(o && t.app.contains(o) && !o.hidden && o.dataset.state === "open" && isSettingsOpen(), "overlay open inside #app");
    eq([o.getAttribute("role"), o.getAttribute("aria-modal")], ["dialog", "true"]);
    eq(document.getElementById(o.getAttribute("aria-labelledby")).textContent, "Settings");
    const doneBtn = o.querySelector(".sto-done"), r = doneBtn.getBoundingClientRect();   // layout size: the sheet may still be zooming in
    ok(doneBtn.getAttribute("aria-label") === "Done" && doneBtn.querySelector("svg") && doneBtn.offsetWidth >= 44 && doneBtn.offsetHeight >= 44, "Done: a 44px checkmark named Done: " + doneBtn.offsetWidth + "x" + doneBtn.offsetHeight);
    ok(r.right > o.getBoundingClientRect().right - 60, "Done sits top right");
    eq(t.sheet.dataset.detent, "half", "the app's sheet is not moved");
    ok(o.contains(document.activeElement), "focus moved into the overlay");
    for (const s of ["Appearance", "Service alerts", "Bus alerts", "iPhone app", 'data-action="about:open"']) ok(o.innerHTML.includes(s), s);
    ok(!document.getElementById("content").innerHTML.includes("Bus alerts"), "settings never render in the sheet");
    ok(document.getElementById("content").inert, "sheet content inert behind the modal");
    eq(getComputedStyle(o).bottom, "0px", "reaches the bottom");
    ok(parseFloat(getComputedStyle(o).borderTopLeftRadius) >= 28, "top corners 28 (rGlass)");
    ok(document.getElementById("sheetHead").inert, "covered sheet header (title, tabs) inert");
    const sc = t.app.querySelector(".sto-scrim");
    ok(sc && !sc.hidden, "scrim dims what is behind");
    eq(t.gear.getAttribute("aria-expanded"), "true");
    ok(o.querySelector('[data-region="theme"] .themeseg'), "theme control mounted");
  } finally { t.done(); }
});

test("a swipe down on the header closes Settings; a short drag springs back", async () => {
  const t = shell();
  try {
    click(t.gear);
    const head = t.ov().querySelector(".sto-head"), at = (y) => ({ clientX: 50, clientY: y, bubbles: true, cancelable: true, button: 0, pointerType: "mouse", pointerId: 1 });
    head.dispatchEvent(new PointerEvent("pointerdown", at(100)));
    window.dispatchEvent(new PointerEvent("pointermove", at(130)));
    ok(/translate3d\(0px, 30px/.test(t.ov().style.transform), "follows the finger: " + t.ov().style.transform);
    await tick(300);   // a slow, short drag (not a flick)
    window.dispatchEvent(new PointerEvent("pointerup", at(130)));
    ok(isSettingsOpen() && !t.ov().style.transform, "a short drag springs back");
    await tick(600);   // slow, so no flick
    head.dispatchEvent(new PointerEvent("pointerdown", at(100)));
    window.dispatchEvent(new PointerEvent("pointermove", at(100 + SWIPE_CLOSE_PX + 5)));
    window.dispatchEvent(new PointerEvent("pointerup", at(100 + SWIPE_CLOSE_PX + 5)));
    ok(!isSettingsOpen(), "a long swipe closes it");
    eq(document.activeElement, t.gear, "focus back on the gear");
  } finally { t.done(); }
});

test("Escape closes, leaves the sheet's detent, returns focus to the gear; main.js Escape not triggered", async () => {
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
    eq(t.sheet.dataset.detent, "peek", "the sheet's detent untouched");
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
    eq(t.sheet.dataset.detent, "half", "the sheet's detent untouched");
    ok(!document.getElementById("sheetHead").inert && !document.getElementById("content").inert, "sheet usable again");
    eq(document.activeElement, t.gear, "focus back on the gear");
    await tick(450);
    ok(sc.hidden, "scrim hidden after closing");
  } finally { t.done(); }
});

test("navigating (About) closes Settings; the app's sheet behind it is never moved by it", async () => {
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
    eq(t.sheet.dataset.detent, "half", "opening left the sheet where it was");
    closeSettingsOverlay();
    eq(t.sheet.dataset.detent, "half", "and so did closing");
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

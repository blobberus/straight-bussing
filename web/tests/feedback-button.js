// The map's feedback button (owner 2026-11-02; ui/feedback-button.js, feedback.test.html): the rules (shown until the
// rider gave feedback or silenced it), the ping schedule and what makes a ping wait, reduced motion, the panel in the
// Settings shell, Send feedback, I already gave feedback, persistence across reloads and tabs, the CSS (the glass layout,
// DESIGN-SPEC-GLASS 4 and 8.5, owner 2026-11-04 Q7: a tinted glass circle under the Settings circle, solid while a chip
// shows, hidden at the full detent) and the real app (also the blur budget with the button on). Since 2026-11-04 it is
// the only feedback prompt (the welcome popup was removed; feedback-app.js checks the real app shows none).
import { test, eq, ok } from "./lib.js";
import { makeCtx, tick } from "./views-fixtures.js";
import { createStore } from "../js/core/store.js";
import {
  PING_FIRST_MS, PING_EVERY_MS, PING_MAX, PING_RETRY_MS, PING_MS, FB_KIND, FB_TITLE, FB_LABEL, FB_SEND, FB_GONE, FB_SILENCE,
  FB_THANKS, FB_SILENCED, FEEDBACK_BTN_OFF_KEY, buttonShown, pingBlocker, nextPingIn, panelHTML, startFeedbackButton,
  feedbackButton, testOff, crowds, CROWD_GAP,
} from "../js/ui/feedback-button.js";
import { A2HS_OFF_KEY } from "../js/ui/install-prompt.js";
// test seam: the Add to Home Screen card (ui/install-prompt.js) never shows by itself in these flows (install.test.html covers it)
try { sessionStorage.setItem(A2HS_OFF_KEY, "1"); } catch (e) { /* blocked storage */ }

test("feedback button: steps aside when it would cover or touch the lower-right group (crowds, 8 pt gap)", () => {
  const box = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  const fb = box(264, 119, 44, 44);   // under Settings at 320 pt
  eq(CROWD_GAP, 8);
  eq(crowds(fb, box(264, 314, 44, 88)), false, "room to spare (320 x 568, default text)");
  eq(crowds(fb, box(264, 171, 44, 88)), false, "exactly 8 apart: fine");
  eq(crowds(fb, box(264, 170, 44, 88)), true, "7 apart: too close");
  eq(crowds(fb, box(264, 138, 44, 88)), true, "overlapping (a tall trip header at 200% text)");
  eq(crowds(fb, box(100, 138, 44, 88)), false, "another column: no clash");
  eq(crowds(fb, box(264, 40, 44, 88)), true, "the group above it (an odd short window) also counts");
  eq(crowds(null, box(264, 138, 44, 88)), false, "no circle");
  eq(crowds(fb, box(264, 138, 0, 0)), false, "a hidden group (zero box)");
});
import {
  FEEDBACK_DONE_KEY, WELCOME_LOG_KEY, FEEDBACK_LEAD, FEEDBACK_BODY, FEEDBACK_IN_SETTINGS, FEEDBACK_NOTE, feedbackDone,
  markFeedbackDone, _resetFeedback,
} from "../js/ui/feedback.js";
import { isSettingsOpen, overlayKind, closeSettingsOverlay, OVERLAY_ID } from "../js/ui/settings-overlay.js";

const FORM = "https://forms.gle/zK4hi2UfYsrXURR97";
const DASH = /[–—]/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 6000) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(15);
  }
}
const userClick = (el) => { const e = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }); el.dispatchEvent(e); return e; };
/** Stop a link's navigation AFTER the app's own handlers ran, and report whether they let it through. */
function catchNav(win = window) {
  const seen = [];
  const on = (e) => { const a = e.target.closest?.("a[href]"); if (a) { seen.push([a.href, e.defaultPrevented]); e.preventDefault(); } };
  win.addEventListener("click", on);
  return { seen, off: () => win.removeEventListener("click", on) };
}
/** A clean slate in this browser: no feedback given, no seam; returns a restore function. */
function clean() {
  const keep = {};
  for (const k of [FEEDBACK_DONE_KEY, WELCOME_LOG_KEY]) { keep[k] = localStorage.getItem(k); localStorage.removeItem(k); }
  const seam = sessionStorage.getItem(FEEDBACK_BTN_OFF_KEY);
  sessionStorage.removeItem(FEEDBACK_BTN_OFF_KEY);
  _resetFeedback();
  return () => {
    for (const [k, v] of Object.entries(keep)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }
    if (seam === null) sessionStorage.removeItem(FEEDBACK_BTN_OFF_KEY); else sessionStorage.setItem(FEEDBACK_BTN_OFF_KEY, seam);
    _resetFeedback();
  };
}
/** A fixture button like index.html's (no CSS needed for the rules). */
function fixtureButton() {
  const b = document.createElement("button");
  b.type = "button";
  b.id = "feedbackBtn";
  b.className = "glass gpress fbfab";
  b.hidden = true;
  b.setAttribute("aria-label", FB_LABEL);
  b.innerHTML = '<span class="fbfab-dot" aria-hidden="true"></span>';
  document.body.appendChild(b);
  return b;
}
/** Record every time the button gets the ping class. */
function pingWatch(b) {
  const log = [];
  const mo = new MutationObserver(() => { const on = b.classList.contains("is-ping"); if (on !== (log[log.length - 1] === "on")) log.push(on ? "on" : "off"); });
  mo.observe(b, { attributes: true, attributeFilter: ["class"] });
  return { log, stop: () => mo.disconnect() };
}
const FAST = { first: 60, every: 90, max: 3, retry: 25, ms: 40 };

test("feedback button: the owner's words, no dashes, a ping schedule that is every once in a while", () => {
  eq([FB_TITLE, FB_LABEL, FB_SEND, FB_SILENCE], ["Beta feedback", "Give feedback", "Send feedback", "I already gave feedback"]);
  ok(/feedback button on the map disappears/.test(FB_GONE), "the note: the button disappears after feedback: " + FB_GONE);
  for (const t of [FB_GONE, FB_THANKS, FB_SILENCED, FB_TITLE, FB_SEND, FB_SILENCE]) {
    ok(!DASH.test(t), "no en / em dash: " + t);
    ok(!/UChicago|UGo|University/.test(t), "no university names: " + t);
  }
  ok(/Settings/.test(FB_THANKS) && /Settings/.test(FB_SILENCED), "both toasts say Give feedback stays in Settings");
  eq([PING_FIRST_MS, PING_EVERY_MS, PING_MAX, PING_RETRY_MS, PING_MS], [20000, 180000, 4, 15000, 2600], "20 s in, then every 3 min, 4 a visit");
  eq(FEEDBACK_BTN_OFF_KEY, "sb-feedback-btn-off");
  // the schedule is pure
  eq(nextPingIn(0, 0), PING_FIRST_MS, "first ping 20 s after start");
  eq(nextPingIn(0, 5000), PING_FIRST_MS - 5000);
  eq(nextPingIn(0, 60000), 0, "started late: at once");
  eq([1, 2, 3].map((n) => nextPingIn(n, 999999)), [PING_EVERY_MS, PING_EVERY_MS, PING_EVERY_MS]);
  eq(nextPingIn(PING_MAX, 0), null, "capped per visit");
  eq(nextPingIn(2, 0, { first: 1, every: 2, max: 2 }), null);
});

test("feedback button: shown until feedback is given or silenced; a ping waits for a trip, the sheet up, a menu, a dialog, typing, a hidden page", () => {
  eq(buttonShown({ done: null, testOff: false }), true);
  eq(buttonShown({ done: "gave" }), false);
  eq(buttonShown({ done: "silenced" }), false);
  eq(buttonShown({ done: null, testOff: true }), false, "test seam");
  const ok0 = { shown: true, pageHidden: false, trip: false, detent: "peek", overlay: false, dialog: false, typing: false };
  eq(pingBlocker(ok0), "", "on the map, nothing open: ping");
  eq(pingBlocker({ ...ok0, detent: "half" }), "", "the half detent leaves the map and the button visible");
  eq(pingBlocker({ ...ok0, shown: false }), "hidden");
  eq(pingBlocker({ ...ok0, pageHidden: true }), "page hidden");
  eq(pingBlocker({ ...ok0, trip: true }), "trip in progress");
  eq(pingBlocker({ ...ok0, detent: "full" }), "sheet expanded");
  eq(pingBlocker({ ...ok0, overlay: true }), "menu open");
  eq(pingBlocker({ ...ok0, dialog: true }), "dialog open");
  eq(pingBlocker({ ...ok0, typing: true }), "typing");
  eq(pingBlocker({ ...ok0, crowded: true }), "no room", "stepped aside for the lower-right group: no ping");
  const s = sessionStorage.getItem(FEEDBACK_BTN_OFF_KEY);
  sessionStorage.setItem(FEEDBACK_BTN_OFF_KEY, "1");
  eq(testOff(), true, "seam read from sessionStorage");
  if (s === null) sessionStorage.removeItem(FEEDBACK_BTN_OFF_KEY); else sessionStorage.setItem(FEEDBACK_BTN_OFF_KEY, s);
  eq(testOff({ getItem() { throw new Error("blocked"); } }), false, "blocked storage: no seam");
});

test("feedback panel: the ask, Send feedback (the form, new tab), the note under it, then the quieter I already gave feedback", () => {
  const box = document.createElement("div");
  box.innerHTML = panelHTML();
  const card = box.querySelector(".st-feedback");
  ok(card, "the Settings card look (accent tint)");
  eq(card.querySelector(".st-fblead").textContent, FEEDBACK_LEAD, "the ask first (as in Settings)");
  ok(card.querySelector(".fb-badge[aria-hidden='true'] svg"), "the speech bubble, decoration only");
  ok(card.textContent.includes(FEEDBACK_BODY), "beta, about a minute, shapes what gets fixed and built next");
  const a = card.querySelector('a[data-fbp="send"]');
  eq([a.getAttribute("href"), a.getAttribute("target"), a.textContent.trim()], [FORM, "_blank", FB_SEND]);
  ok(/\bnoopener\b/.test(a.getAttribute("rel")) && /^Send feedback, .*new tab/.test(a.getAttribute("aria-label")), "rel + spoken label");
  ok(a.classList.contains("v-btn--primary"), "the primary button");
  const gone = card.querySelector(".fbp-gone");
  eq(gone.textContent, FB_GONE);
  ok(a.compareDocumentPosition(gone) & Node.DOCUMENT_POSITION_FOLLOWING, "the note sits under Send feedback");
  const quiet = box.querySelector('button[data-fbp="silence"]');
  eq(quiet.textContent, FB_SILENCE);
  ok(!card.contains(quiet) && (gone.compareDocumentPosition(quiet) & Node.DOCUMENT_POSITION_FOLLOWING), "I already gave feedback under the note, outside the tinted card");
  ok(quiet.classList.contains("v-btn--quiet") && !quiet.classList.contains("v-btn--primary"), "less noticeable: a text button");
  ok(box.querySelector(".fbp-note").textContent.includes(FEEDBACK_NOTE), "what opening the form sends");
  ok(box.querySelector(".fbp-note").textContent.includes(FEEDBACK_IN_SETTINGS), "and that Give feedback is also in Settings");
  eq(box.querySelectorAll(`a[href="${FORM}"]`).length, 1, "one link to the form");
  ok(!DASH.test(box.textContent), "no en / em dash");
});

test("ping schedule: first after a while, then every so often, capped per visit; the class comes and goes", async () => {
  const restore = clean();
  const b = fixtureButton(), w = pingWatch(b), store = createStore({ journey: null });
  let fb = null;
  try {
    fb = startFeedbackButton({ store, ctx: makeCtx(), button: b, schedule: FAST, reducedMotion: () => false });
    ok(fb && fb.shown() && !b.hidden, "shown on a first visit");
    eq(feedbackButton(), fb, "one running button");
    await sleep(FAST.first / 3);
    eq(fb.pings(), 0, "no ping right away");
    await waitFor(() => fb.pings() === 1, "the first ping");
    ok(b.classList.contains("is-ping") || w.log.includes("on"), "the ping class is set");
    await waitFor(() => !b.classList.contains("is-ping"), "the ping class goes after PING_MS");
    await waitFor(() => fb.pings() === 3, "the next pings, every so often");
    await sleep(FAST.every * 2.5);
    eq(fb.pings(), FAST.max, "no more than max pings in a visit");
    eq(w.log.filter((x) => x === "on").length, FAST.max, "one animation per ping");
    eq(b.dataset.pings, String(FAST.max));
  } finally { fb?.stop(); w.stop(); b.remove(); restore(); }
});

test("ping waits while a trip is in progress, the sheet is up, a menu or dialog is open or a field has focus; reduced motion = no movement", async () => {
  const restore = clean();
  const b = fixtureButton(), store = createStore({ journey: { kind: "plan" } });
  const sheet = document.createElement("section");
  sheet.id = "sheet";
  sheet.dataset.detent = "full";
  let fb = null;
  try {
    fb = startFeedbackButton({ store, ctx: makeCtx(), button: b, schedule: FAST, reducedMotion: () => false });
    await sleep(FAST.first + FAST.retry * 3);
    eq(fb.pings(), 0, "a trip in progress: no ping");
    store.set({ journey: null });
    document.body.appendChild(sheet);
    await sleep(FAST.retry * 3);
    eq(fb.pings(), 0, "the sheet expanded: no ping");
    sheet.dataset.detent = "peek";
    const dlg = document.createElement("dialog");
    document.body.appendChild(dlg);
    dlg.show();
    await sleep(FAST.retry * 3);
    eq(fb.pings(), 0, "a dialog open: no ping");
    dlg.close(); dlg.remove();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await sleep(FAST.retry * 3);
    eq(fb.pings(), 0, "typing: no ping");
    input.remove();
    await waitFor(() => fb.pings() === 1, "all clear: the waiting ping runs");
    fb.stop();
    // reduced motion: the ping is counted but nothing moves
    const w = pingWatch(b);
    fb = startFeedbackButton({ store, ctx: makeCtx(), button: b, schedule: FAST, reducedMotion: () => true });
    await waitFor(() => fb.pings() === 2, "two pings under reduced motion");
    eq(w.log, [], "never the ping class: only the static badge");
    ok(!b.hidden && b.querySelector(".fbfab-dot"), "the badge stays");
    w.stop();
  } finally { fb?.stop(); sheet.remove(); b.remove(); restore(); }
});

/** A minimal app shell like tests/settings-overlay.js: #app, #sheet, the Settings circle and the feedback button. */
function shell() {
  const ctx = makeCtx({ journey: null });
  const app = document.createElement("div");
  app.id = "app";
  app.innerHTML = '<button id="settingsBtn" type="button" aria-label="Settings" style="width:44px;height:44px">G</button>'
    + '<section id="sheet" data-detent="half" style="position:fixed;left:0;right:0;bottom:0;height:500px">'
    + '<header id="sheetHead"><h1 id="title" tabindex="-1">Current trip</h1><nav id="tabs"></nav></header><div id="content">sheet</div></section>';
  document.body.appendChild(app);
  const b = fixtureButton();
  app.appendChild(b);
  ctx.setDetent = (d) => { app.querySelector("#sheet").dataset.detent = d; };
  return { ctx, app, b, ov: () => document.getElementById(OVERLAY_ID), done: () => { closeSettingsOverlay({ focus: "none" }); app.remove(); } };
}
const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

test("tap: a panel like the Settings menu (title, Done, scrim); Done and Escape close it and focus returns to the button", async () => {
  const restore = clean();
  const t = shell();
  let fb = null;
  try {
    fb = startFeedbackButton({ store: t.ctx.store, ctx: t.ctx, button: t.b, schedule: FAST });
    ok(!t.b.hidden, "shown");
    t.b.focus();
    userClick(t.b);
    const o = t.ov();
    ok(o && isSettingsOpen() && overlayKind() === FB_KIND && o.dataset.kind === FB_KIND, "the Settings overlay's shell, kind feedback");
    eq([o.getAttribute("role"), o.getAttribute("aria-modal")], ["dialog", "true"]);
    eq(o.querySelector(".sto-title").textContent, FB_TITLE, "title");
    eq(o.querySelector(".sto-done").getAttribute("aria-label"), "Done", "Done on the right, like Settings (a checkmark named Done, glass spec 9.8)");
    ok(o.querySelector(".sto-body .st-feedback a[data-fbp='send']") && o.querySelector(".sto-body [data-fbp='silence']"), "the panel inside");
    eq(t.b.getAttribute("aria-expanded"), "true", "the button says the panel is open");
    eq(t.app.querySelector("#sheet").dataset.detent, "half", "the app's sheet stays where it was, like Settings (glass spec 9.8)");
    ok(o.contains(document.activeElement), "focus moved into the panel");
    o.querySelector(".sto-done").click();
    await tick(5);
    ok(!isSettingsOpen(), "Done closes");
    eq(t.app.querySelector("#sheet").dataset.detent, "half", "the sheet back where it was");
    eq(document.activeElement, t.b, "focus back on the button");
    eq(t.b.getAttribute("aria-expanded"), "false");
    userClick(t.b);
    ok(isSettingsOpen(), "opens again");
    key("Escape");
    await tick(5);
    ok(!isSettingsOpen(), "Escape closes");
    userClick(t.b);
    userClick(t.b);
    ok(!isSettingsOpen(), "the button toggles (a second tap closes the panel)");
    eq(feedbackDone(), null, "opening and closing records nothing");
    ok(!t.b.hidden, "the button stays until feedback is given");
  } finally { fb?.stop(); t.done(); t.b.remove(); restore(); }
});

test("Send feedback: opens the form (the link is never blocked), the button goes at once and for good", async () => {
  const restore = clean();
  const t = shell();
  let fb = null;
  const nav = catchNav();
  try {
    fb = startFeedbackButton({ store: t.ctx.store, ctx: t.ctx, button: t.b, schedule: FAST });
    userClick(t.b);
    const a = t.ov().querySelector('a[data-fbp="send"]');
    userClick(a);
    eq(nav.seen, [[FORM, false]], "the browser opens the form in a new tab");
    eq(feedbackDone(), "gave", "remembered as feedback given");
    eq(JSON.parse(localStorage.getItem(FEEDBACK_DONE_KEY)).how, "gave", "in localStorage " + FEEDBACK_DONE_KEY);
    eq(localStorage.getItem(WELCOME_LOG_KEY), null, "nothing goes in the removed popup's log");
    ok(t.b.hidden && !fb.shown(), "the button is gone at once");
    await tick(5);
    ok(!isSettingsOpen(), "the panel closed");
    eq(document.activeElement, document.getElementById("settingsBtn"), "focus on the neighbor, the Settings circle");
    eq(t.ctx.calls.toast, [FB_THANKS], "a thank-you toast");
    // a later visit: the button never comes back
    fb.stop();
    _resetFeedback();
    fb = startFeedbackButton({ store: t.ctx.store, ctx: t.ctx, button: t.b, schedule: FAST });
    ok(t.b.hidden && !fb.shown(), "a reload: still gone");
    await sleep(FAST.first + 30);
    eq(fb.pings(), 0, "and no pings");
  } finally { nav.off(); fb?.stop(); t.done(); t.b.remove(); restore(); }
});

test("I already gave feedback: silences it for good (no form opened), Settings keeps Give feedback; other tabs follow", async () => {
  const restore = clean();
  const t = shell();
  let fb = null;
  const nav = catchNav();
  try {
    fb = startFeedbackButton({ store: t.ctx.store, ctx: t.ctx, button: t.b, schedule: FAST });
    userClick(t.b);
    userClick(t.ov().querySelector('[data-fbp="silence"]'));
    eq(nav.seen, [], "no form opened");
    eq(feedbackDone(), "silenced");
    eq(JSON.parse(localStorage.getItem(FEEDBACK_DONE_KEY)).how, "silenced");
    eq(localStorage.getItem(WELCOME_LOG_KEY), null, "the form was not opened, the removed popup's log stays unwritten");
    ok(t.b.hidden, "the button is removed from the map");
    await tick(5);
    ok(!isSettingsOpen(), "the panel closed");
    eq(t.ctx.calls.toast, [FB_SILENCED]);
    fb.stop();
    _resetFeedback();
    fb = startFeedbackButton({ store: t.ctx.store, ctx: t.ctx, button: t.b, schedule: FAST });
    ok(t.b.hidden, "a reload: still gone");
    fb.stop();
    // another tab silenced it: this tab's button goes when the storage event arrives
    localStorage.removeItem(FEEDBACK_DONE_KEY);
    fb = startFeedbackButton({ store: t.ctx.store, ctx: t.ctx, button: t.b, schedule: FAST });
    ok(!t.b.hidden, "shown again once the choice is cleared");
    localStorage.setItem(FEEDBACK_DONE_KEY, JSON.stringify({ how: "gave", at: Date.now() }));
    window.dispatchEvent(new StorageEvent("storage", { key: FEEDBACK_DONE_KEY }));
    ok(t.b.hidden, "another tab gave feedback: gone here too");
  } finally { nav.off(); fb?.stop(); t.done(); t.b.remove(); restore(); }
});

test("storage blocked: either choice hides the button for the rest of the visit; the test seam hides it", async () => {
  const restore = clean();
  const b = fixtureButton(), store = createStore({ journey: null });
  let fb = null;
  try {
    fb = startFeedbackButton({ store, ctx: makeCtx(), button: b, schedule: FAST });
    ok(!b.hidden);
    markFeedbackDone("silenced", { storage: null });   // nothing could be stored
    ok(b.hidden, "hidden for this visit");
    eq(localStorage.getItem(FEEDBACK_DONE_KEY), null, "nothing stored");
    fb.stop();
    _resetFeedback();   // a reload
    fb = startFeedbackButton({ store, ctx: makeCtx(), button: b, schedule: FAST });
    ok(!b.hidden, "a new visit asks again (nothing was kept)");
    fb.stop();
    sessionStorage.setItem(FEEDBACK_BTN_OFF_KEY, "1");
    fb = startFeedbackButton({ store, ctx: makeCtx(), button: b, schedule: FAST });
    ok(b.hidden && !fb.shown(), "the tests' seam hides it");
    await sleep(FAST.first + 30);
    eq(fb.pings(), 0, "no pings while hidden");
  } finally { fb?.stop(); b.remove(); restore(); }
});

/* ---------- CSS: the real index.html markup with the real stylesheets ---------- */

/** Relative luminance contrast of two "rgb(...)" colors (opaque). */
function contrast(fg, bg) {
  const ch = (c) => String(c).match(/[\d.]+/g).slice(0, 3).map(Number);
  const L = (c) => { const [r, g, b] = ch(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const a = L(fg), b = L(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const greenish = (c) => { const [r, g, b] = String(c).match(/[\d.]+/g).map(Number); return g > r + 20 && g > b + 20; };

/** A computed color ("rgb(...)", "rgba(...)" or "color(srgb r g b / a)") as [r, g, b, a] with r, g, b in 0..255. */
function rgba(c) {
  const t = String(c), n = t.match(/[\d.]+/g).map(Number);
  if (/^color\(/.test(t)) return [n[0] * 255, n[1] * 255, n[2] * 255, n.length > 3 ? n[3] : 1];
  return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
}
/** A translucent color laid over an opaque backdrop [r, g, b], as "rgb(...)". */
function over(top, back) {
  const [r, g, b, a] = rgba(top);
  return `rgb(${[r, g, b].map((v, i) => Math.round(v * a + back[i] * (1 - a))).join(", ")})`;
}

test("css: a 44 tinted glass circle under Settings (same size and shape, 8 px gap), the accent tint not green, 3:1 over any backdrop with no blur, solid while a chip shows, hidden at the full detent, a ping animates only the badge", async () => {
  const html = await (await fetch("../index.html", { cache: "no-store" })).text();
  const topbar = (html.match(/<div id="topbar"[\s\S]*?<\/div>/) || [])[0];
  const fbb = (html.match(/<button id="feedbackBtn"[\s\S]*?<\/button>/) || [])[0];
  ok(topbar && fbb && topbar.includes(fbb), "the feedback button sits in the top rows, with Settings");
  ok(/aria-label="Give feedback"/.test(fbb) && /aria-haspopup="dialog"/.test(fbb) && /\shidden>/.test(fbb), "labeled, a popup button, hidden until the script decides");
  ok(html.indexOf('id="feedbackBtn"') > html.indexOf('id="settingsBtn"') && html.indexOf('id="feedbackBtn"') < html.indexOf('id="ctxbar"'), "after Settings, before the trip chip (focus order, glass spec 11)");
  const f = document.createElement("iframe");
  f.style.cssText = "position:absolute;left:-10000px;top:0;width:393px;height:852px;border:0";
  const css = ["tokens", "base", "sheet"].map((n) => `<link rel="stylesheet" href="../css/${n}.css">`).join("");
  f.srcdoc = `<!doctype html><html><head><meta name="viewport" content="width=device-width">${css}`
    + "<style>*,*::before,*::after{transition:none!important}</style></head><body><div id=\"app\" class=\"app\">"
    + '<div id="pill" class="statuspill" hidden>Live data delayed</div>'
    + topbar.replace(/(<button id="feedbackBtn"[^>]*?)\shidden>/, "$1>")
    + '<div id="ctxbar" class="ctxbar glass" hidden>Trip</div>'
    + '<section id="sheet" class="sheet" data-detent="peek"><header class="sheet-head"><div class="titleline"><h1 id="title">Current trip</h1></div></header><div class="sheet-content"></div></section>'
    + "</div></body></html>";
  await new Promise((res) => { f.onload = res; document.body.appendChild(f); });
  try {
    const d = f.contentDocument, w = f.contentWindow, $ = (id) => d.getElementById(id), cs = (el) => w.getComputedStyle(el);
    const fab = $("feedbackBtn"), G = $("settingsBtn").getBoundingClientRect(), B = fab.getBoundingClientRect();
    ok(!fab.hidden, "shown in this fixture");
    eq([Math.round(B.width), Math.round(B.height)], [Math.round(G.width), Math.round(G.height)], "the Settings circle's size");
    ok(B.width >= 44 && B.height >= 44, "44 px target");
    eq(Math.round(B.right), Math.round(G.right), "right edges aligned (12 from the screen edge)");
    eq(Math.round(B.top - G.bottom), 8, "8 px under Settings");
    eq(cs(fab).borderTopLeftRadius, cs($("settingsBtn")).borderTopLeftRadius, "the same circle");
    ok((cs(fab).backdropFilter || cs(fab).webkitBackdropFilter || "none") !== "none", "glass: the glass filter");
    const dot = d.querySelector(".fbfab-dot"), D = dot.getBoundingClientRect();
    ok(D.width >= 8 && D.left > B.left + B.width / 2 && D.bottom < B.top + B.height / 2, "a badge dot at the top right");
    // the status banner (Row A) sits above Row B; Settings and the feedback circle move down under it
    $("pill").hidden = false;
    const P = $("pill").getBoundingClientRect(), G2 = $("settingsBtn").getBoundingClientRect();
    ok(P.bottom <= G2.top, "never under the status banner");
    $("pill").hidden = true;
    for (const theme of ["light", "dark"]) {
      d.documentElement.dataset.theme = theme;
      const bg = cs(fab).backgroundColor, probe = d.body.appendChild(d.createElement("div"));
      probe.style.background = "var(--glass-tint-fill)";
      eq(bg, cs(probe).backgroundColor, theme + ": the tinted glass fill (tintBg at 85%)");
      probe.style.background = "var(--tint-bg)";
      const tintBg = cs(probe).backgroundColor;
      probe.remove();
      ok(rgba(bg)[3] < 1 && rgba(bg)[3] >= 0.8, theme + ": translucent, at least 80% (" + bg + ")");
      ok(!greenish(over(bg, [255, 255, 255])) && !greenish(cs(dot).backgroundColor), theme + ": never the green live color");
      // the worst backdrop with no blur at all (glass spec 5.3): black under light glass, white under dark glass
      const back = theme === "light" ? [0, 0, 0] : [255, 255, 255], comp = over(bg, back);
      const icon = contrast(cs(fab).color, comp), badge = contrast(cs(dot).backgroundColor, comp);
      ok(icon >= 3, `${theme}: icon ${icon.toFixed(2)} >= 3:1 over ${comp} (graphic)`);
      ok(badge >= 3, `${theme}: badge ${badge.toFixed(2)} >= 3:1`);
      // a chip on the map: solid tint, no blur (at most 6 blurred surfaces, glass spec 12.1)
      $("ctxbar").hidden = false;
      eq([cs(fab).backgroundColor, cs(fab).backdropFilter || "none"], [tintBg, "none"], theme + ": solid tint while the trip chip shows");
      $("ctxbar").hidden = true;
    }
    delete d.documentElement.dataset.theme;
    eq(cs(dot).animationName, "none", "still between pings");
    fab.classList.add("is-ping");
    eq([cs(dot).animationName, w.getComputedStyle(dot, "::after").animationName], ["fb-dot", "fb-ring"], "a ping pulses the badge");
    eq(cs(fab.querySelector("svg")).animationName, "none", "the icon itself does not move");
    fab.classList.remove("is-ping");
    // reduced motion: the stylesheet stops the ping animation
    const rules = [];
    for (const sh of d.styleSheets) { try { for (const r of sh.cssRules) rules.push(r); } catch (e) { /* */ } }
    const rm = rules.filter((r) => r.media && /prefers-reduced-motion:\s*reduce/.test(r.media.mediaText)).flatMap((r) => [...r.cssRules]);
    const stop = rm.find((r) => r.selectorText && r.selectorText.includes(".fbfab.is-ping .fbfab-dot"));
    ok(stop && stop.style.animationName === "none" && stop.style.getPropertyPriority("animation-name") === "important", "reduced motion: no ping animation (" + (stop && stop.cssText) + ")");
    // the full detent: the expanded sheet starts under Row B, so the circle steps aside (Settings stays)
    $("sheet").dataset.detent = "full";
    eq([cs(fab).visibility, cs($("settingsBtn")).visibility], ["hidden", "visible"], "hidden at the full detent; Settings stays");
    $("sheet").dataset.detent = "peek";
    eq(cs(fab).visibility, "visible", "back when the sheet is collapsed");
  } finally { f.remove(); }
});

/* ---------- the real app ---------- */

/** The real index.html with the e2e stubs, the store and the feedback button module exposed, in a new iframe. */
async function openLive(style = "width:393px;height:852px;border:0;display:block") {
  const html = await (await fetch("../index.html", { cache: "no-store" })).text();
  const base = new URL("../", location.href).href;
  let page = html.replace(/<head>/i, `<head><base href="${base}"><script src="tests/e2e-stubs.js"></script>`);
  page = page.replace(/<script type="module" src="js\/main\.js[^"]*"><\/script>/,
    (m) => `<script type="module">import { store } from "./js/state.js"; import * as fb from "./js/ui/feedback-button.js"; window.__st = store; window.__fbm = fb;</script>${m}`);
  if (!page.includes("window.__fbm")) throw new Error("js/main.js <script> tag not found in index.html");
  const f = document.createElement("iframe");
  f.style.cssText = style;
  document.body.appendChild(f);
  f.contentDocument.open();
  f.contentDocument.write(page);
  f.contentDocument.close();
  const w = f.contentWindow, d = w.document;
  await waitFor(() => w.__st && w.__st.get().staticLoaded && d.getElementById("app").dataset.view === "nearby", "the app rendered", 15000);
  await waitFor(() => w.__fbm && w.__fbm.feedbackButton(), "the feedback button started", 8000);
  return { f, w, d, fab: d.getElementById("feedbackBtn") };
}
test("real app: the circle under Settings on the map; the panel opens like Settings; Send feedback removes it, also after a reload", async () => {
  const restore = clean();
  let v = null;
  try {
    v = await openLive();
    const { w, d, fab } = v;
    ok(!fab.hidden, "shown on the map");
    const G = d.getElementById("settingsBtn").getBoundingClientRect(), B = fab.getBoundingClientRect();
    ok(B.top > G.bottom && B.top - G.bottom <= 12 && Math.abs(B.right - G.right) < 1, "right under the Settings circle");
    eq(d.elementFromPoint(B.left + B.width / 2, B.top + B.height / 2)?.closest("#feedbackBtn"), fab, "nothing covers it");
    eq(fab.getAttribute("aria-label"), "Give feedback");
    fab.click();
    const o = await waitFor(() => { const x = d.getElementById(OVERLAY_ID); return x && x.dataset.state === "open" ? x : null; }, "the panel");
    eq([o.dataset.kind, o.querySelector(".sto-title").textContent], [FB_KIND, FB_TITLE]);
    ok(d.getElementById("tabs").inert && d.getElementById("sheetHead").inert, "like Settings: the sheet under it is inert");
    // the browser's Back closes it (main.js keeps a history entry while the overlay is open)
    w.history.back();
    await waitFor(() => o.dataset.state === "closed", "Back closes the panel");
    ok(!fab.hidden && w.__st.get().view === "nearby", "and leaves the map screen as it was");
    fab.click();
    await waitFor(() => o.dataset.state === "open", "open again");
    const nav = catchNav(w);
    try { o.querySelector('a[data-fbp="send"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })); } finally { nav.off(); }
    eq(nav.seen, [[FORM, false]], "the form opens in a new tab");
    ok(fab.hidden, "the button is gone at once");
    await waitFor(() => o.dataset.state === "closed", "the panel closes");
    eq(JSON.parse(localStorage.getItem(FEEDBACK_DONE_KEY)).how, "gave");
    eq(w.__e2e.errors, [], "no console errors");
    v.f.remove();
    v = await openLive();
    ok(v.fab.hidden, "a new visit: the button stays gone");
    eq(v.w.__fbm.feedbackButton().shown(), false);
    // Settings keeps Give feedback
    v.d.getElementById("settingsBtn").click();
    const so = await waitFor(() => { const x = v.d.getElementById(OVERLAY_ID); return x && x.dataset.state === "open" && x.dataset.kind === "settings" ? x : null; }, "Settings");
    ok(so.querySelector(`a[href="${FORM}"]`), "Settings > Give feedback is still there");
  } finally { v?.f.remove(); restore(); }
});

test("real app: I already gave feedback silences it for good, also a week later; the tests' seam hides the button", async () => {
  const restore = clean();
  let v = null;
  try {
    v = await openLive();
    ok(!v.fab.hidden, "shown");
    v.fab.click();
    const o = await waitFor(() => { const x = v.d.getElementById(OVERLAY_ID); return x && x.dataset.state === "open" ? x : null; }, "the panel");
    o.querySelector('[data-fbp="silence"]').click();
    ok(v.fab.hidden, "removed at once");
    await waitFor(() => o.dataset.state === "closed", "the panel closes");
    eq(JSON.parse(localStorage.getItem(FEEDBACK_DONE_KEY)).how, "silenced");
    v.f.remove();
    // a new visit a week later (the old popup's log too): the button stays gone, nothing asks
    localStorage.setItem(WELCOME_LOG_KEY, JSON.stringify({ shown: Date.now() - 8 * 86400000, feedback: 0 }));
    v = await openLive();
    await sleep(800);
    ok(v.fab.hidden, "the button stays gone");
    eq(v.d.querySelector("dialog[open]"), null, "and no popup asks instead");
    v.f.remove();
    // the tests' seam: a fresh rider, but the button stays hidden
    localStorage.removeItem(FEEDBACK_DONE_KEY);
    sessionStorage.setItem(FEEDBACK_BTN_OFF_KEY, "1");
    v = await openLive();
    ok(v.fab.hidden, "sessionStorage " + FEEDBACK_BTN_OFF_KEY + " hides it");
  } finally { v?.f.remove(); restore(); }
});

/** Blurred surfaces on screen (glass spec 12.1): visible elements with a backdrop-filter, and their share of the screen. */
function blurBudget(w, d) {
  const vw = w.innerWidth, vh = w.innerHeight, found = [];
  for (const e of d.querySelectorAll("body *")) {
    const cs = w.getComputedStyle(e), f = cs.backdropFilter || cs.webkitBackdropFilter;
    if (!f || f === "none" || cs.visibility !== "visible" || parseFloat(cs.opacity) === 0 || !e.getClientRects().length) continue;
    const r = e.getBoundingClientRect(), x = Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left)), y = Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
    if (x * y > 0) found.push({ id: e.id || String(e.className).split(" ")[0], a: x * y });
  }
  return { n: found.length, share: found.reduce((s, v) => s + v.a, 0) / (vw * vh), ids: found.map((v) => v.id) };
}
test("real app: with the feedback circle on the map at most 6 surfaces blur (22% of the screen); with the trip chip the circle turns solid", async () => {
  const restore = clean();
  let v = null;
  try {
    v = await openLive();
    const { w, d, fab } = v;
    ok(!fab.hidden, "shown");
    await waitFor(() => d.getElementById("sheet").dataset.rest === "peek" && !d.getElementById("app").classList.contains("is-moving"), "collapsed and settled");
    let b = blurBudget(w, d);
    ok(b.ids.includes("feedbackBtn") && b.n <= 6 && b.share <= 0.22, `collapsed: ${b.n} blurred (${b.ids.join(", ")}), ${(b.share * 100).toFixed(1)}%`);
    const rid = Object.keys(w.__st.get().routes)[0];
    w.__st.set({ journey: { kind: "plan", rids: [rid], label: "To Test Place", to: "Test Place", t0: Math.floor(Date.now() / 1000), legs: [] } });
    await waitFor(() => !d.getElementById("ctxbar").hidden, "the trip chip");
    for (const a of d.getElementById("ctxbar").getAnimations()) a.finish();
    b = blurBudget(w, d);
    ok(!b.ids.includes("feedbackBtn") && b.ids.includes("ctxbar") && b.n <= 6 && b.share <= 0.22, `with the trip chip: ${b.n} blurred (${b.ids.join(", ")}), ${(b.share * 100).toFixed(1)}%`);
    const C = d.getElementById("ctxbar").getBoundingClientRect(), B = fab.getBoundingClientRect();
    ok(C.right <= B.left || C.bottom <= B.top || C.top >= B.bottom, "the trip chip and the feedback circle never overlap");
    w.__st.set({ journey: null });
  } finally { v?.f.remove(); restore(); }
});

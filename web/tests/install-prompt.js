// ui/install-prompt.js: the Add to Home Screen card on its own (install.test.html; owner 2026-11-07/09): its words and
// steps with the browsers' glyphs, the one-tap button, showing by itself only when due, waiting for trips and menus,
// Close / Don't show again / an install and what each remembers. A fake store and environment; the real app is
// install-app.js.
import { test, eq, ok } from "./lib.js";
import { createStore } from "../js/core/store.js";
import { MEMORY_KEY, RESHOW_MS, _resetInstallMemory } from "../js/core/install.js";
import { INSTALL_TITLE } from "../js/core/installsteps.js";
import {
  A2HS_OFF_KEY, CLOSE_LABEL, NEVER_LABEL, OTHERS_LABEL, BY_HAND_LABEL, TOAST_CLOSED, TOAST_NEVER, TOAST_INSTALLED,
  promptHTML, stepHTML, startInstallPrompt, openInstallPrompt, installPrompt, isInstallPromptOpen, testOff,
} from "../js/ui/install-prompt.js";
import { pingBlocker } from "../js/ui/feedback-button.js";
import { UA } from "./core-install.js";

const MEM = "sb:" + MEMORY_KEY;
const DAY = 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 4000) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(10);
  }
}
const FAST = { showAfterMs: 30, maxWaitMs: 200, retryMs: 40 };
const iphone = { ua: UA.iphone, maxTouchPoints: 5, standalone: false, displayMode: "browser" };
const chrome = { ua: UA.chrome, maxTouchPoints: 0, standalone: false, displayMode: "browser" };
const card = () => document.getElementById("a2hs");
const shown = () => { const c = card(); return c && !c.hidden && c.dataset.state === "open" ? c : null; };
const mem = () => JSON.parse(localStorage.getItem(MEM) || "{}");

/** A clean browser (nothing remembered, no seam) and a fake app around the card; returns {store, ctx, toasts, done()}. */
function setup(state = { liveLoaded: true }) {
  const keep = localStorage.getItem(MEM), seam = sessionStorage.getItem(A2HS_OFF_KEY);
  localStorage.removeItem(MEM);
  sessionStorage.removeItem(A2HS_OFF_KEY);
  _resetInstallMemory();
  const host = document.createElement("div");
  host.innerHTML = '<div id="ctxbar" hidden></div><section id="sheet" data-detent="peek"><h1 id="title" tabindex="-1">Current trip</h1></section><button id="settingsBtn">Settings</button>';
  document.body.appendChild(host);
  const store = createStore(state), toasts = [];
  const ctx = { store, toast: (t) => toasts.push(t) };
  return {
    store, ctx, toasts, host,
    done() {
      installPrompt()?.stop();
      host.remove();
      if (keep === null) localStorage.removeItem(MEM); else localStorage.setItem(MEM, keep);
      if (seam === null) sessionStorage.removeItem(A2HS_OFF_KEY); else sessionStorage.setItem(A2HS_OFF_KEY, seam);
      _resetInstallMemory();
    },
  };
}

test("install card: the heading is the owner's sentence, Close is a 44 button named Close, the why line, Don't show again", () => {
  const d = document.createElement("div");
  d.innerHTML = promptHTML({ platform: "ios-safari" });
  const h = d.querySelector("h2#a2hsTitle");
  eq(h && h.textContent, INSTALL_TITLE);
  eq(INSTALL_TITLE, "Add this website as a home screen app!");
  ok(d.firstElementChild.classList.contains("a2hs-head") && d.firstElementChild.firstElementChild === h, "the heading comes first");
  const x = d.querySelector('button[data-a2hs="close"]');
  eq(x.getAttribute("aria-label"), CLOSE_LABEL);
  eq(CLOSE_LABEL, "Close");
  ok(/iOS 16\.4/.test(d.querySelector("#a2hsWhy").textContent), "iPhone: the honest notifications line");
  eq(d.querySelector('[data-a2hs="never"]').textContent, NEVER_LABEL);
  eq(NEVER_LABEL, "Don't show again");
  ok(!/\{[a-z]+\}/.test(d.textContent), "no raw {icon} tokens left");
});

test("install card: iPhone Safari gets its numbered steps with the Share, More and Add to Home Screen glyphs inline", () => {
  const d = document.createElement("div");
  d.innerHTML = promptHTML({ platform: "ios-safari" });
  eq(d.querySelector(".a2hs-for").textContent, "iPhone or iPad with Safari");
  const own = d.querySelector(".a2hs-for + ol.a2hs-steps");
  eq(own.children.length, 4, "four steps: Share, View More (owner 2026-11-09), Add to Home Screen, Add");
  const glyphs = [...own.querySelectorAll(".a2hs-glyph")].map((g) => g.getAttribute("aria-label"));
  eq(glyphs, ["Share button", "More button", "Add to Home Screen"], "the glyphs, each with alternative text");
  for (const g of own.querySelectorAll(".a2hs-glyph")) {
    eq(g.getAttribute("role"), "img");
    ok(g.querySelector("svg[aria-hidden='true']"), "the drawing itself is hidden from screen readers");
  }
  ok(/^Tap Share/.test(own.children[0].textContent) && /Tap More/.test(own.children[0].textContent), "Share, or More first");
  ok(/View More/.test(own.children[1].textContent), "View More is its own step");
  ok(/Open as Web App/.test(own.children[3].textContent), "Open as Web App stays on");
  eq(d.querySelector('[data-a2hs="install"]'), null, "no button: iPhone has no programmatic install");
  const other = d.querySelector("details.a2hs-other");
  ok(other && !other.open, "the other browsers are folded away");
  eq(other.querySelector("summary").textContent, OTHERS_LABEL);
  ok(!/iPhone or iPad with Safari/.test([...other.querySelectorAll("h3")].map((x) => x.textContent).join("|")), "the fold lists the others, not this one");
  ok(other.querySelectorAll("h3").length >= 6, "phones and computers in the fold");
});

test("install card: the steps escape their text; Chrome on Android and computers name their own menus", () => {
  ok(stepHTML('Tap "Add" <b>').includes("&lt;b&gt;"), "escaped");
  ok(stepHTML("Tap {share}").includes('aria-label="Share button"'), "icon drawn");
  const a = document.createElement("div");
  a.innerHTML = promptHTML({ platform: "android-chrome" });
  ok(/Android with Chrome/.test(a.querySelector(".a2hs-for").textContent));
  eq(a.querySelector(".a2hs-for + ol .a2hs-glyph").getAttribute("aria-label"), "Menu button");
  const c = document.createElement("div");
  c.innerHTML = promptHTML({ platform: "desktop-chrome" });
  eq(c.querySelector(".a2hs-for + ol .a2hs-glyph").getAttribute("aria-label"), "Install button");
  const n = document.createElement("div");
  n.innerHTML = promptHTML({ platform: "none" });
  eq(n.querySelector(".a2hs-for"), null, "no steps of its own: only the fold");
});

test("install card: where the browser offers its own install, ONE button; the steps fold away under Other ways", () => {
  const d = document.createElement("div");
  d.innerHTML = promptHTML({ platform: "android-chrome", canPrompt: true });
  const b = d.querySelectorAll(".v-btn--primary");
  eq(b.length, 1, "one primary action");
  eq(b[0].dataset.a2hs, "install");
  eq(b[0].textContent, "Add to Home Screen");
  eq(d.querySelector(".a2hs-for"), null, "no steps outside the fold");
  const fold = d.querySelector("details.a2hs-other");
  eq(fold.querySelector("summary").textContent, BY_HAND_LABEL);
  eq(fold.querySelector("h3").textContent, "Android with Chrome", "this browser's steps first in the fold");
  const c = document.createElement("div");
  c.innerHTML = promptHTML({ platform: "desktop-edge", canPrompt: true });
  eq(c.querySelector('[data-a2hs="install"]').textContent, "Install app", "computers: Install app");
});

test("install card: never in the installed app (navigator.standalone or an installed display mode)", () => {
  const t = setup();
  try {
    eq(startInstallPrompt({ store: t.store, ctx: t.ctx, env: { ...iphone, standalone: true }, ...FAST }), null, "Home Screen app");
    eq(startInstallPrompt({ store: t.store, ctx: t.ctx, env: { ...chrome, displayMode: "standalone" }, ...FAST }), null, "installed app window");
    eq(startInstallPrompt({ store: t.store, ctx: t.ctx, env: iphone, install: { event: null, installed: true }, ...FAST }), null, "installed in this visit");
    eq(card(), null, "no card in the page");
  } finally { t.done(); }
});

test("install card: shows by itself only after the live feed answered, then SHOW_AFTER_MS; takes no focus; remembers when", async () => {
  const t = setup({ liveLoaded: false });
  try {
    const p = startInstallPrompt({ store: t.store, ctx: t.ctx, env: iphone, ...FAST, maxWaitMs: 5000 });
    eq(p.platform, "ios-safari");
    await sleep(120);
    eq(shown(), null, "not before the live feed answered");
    const before = document.activeElement;
    t.store.set({ liveLoaded: true });
    const c = await waitFor(shown, "the card");
    ok(c.previousElementSibling && c.previousElementSibling.id === "ctxbar", "placed right after the trip chip (focus order: top rows, card, sheet)");
    eq(c.getAttribute("role"), "dialog");
    eq(c.getAttribute("aria-modal"), "false", "non-modal: the map and the sheet stay usable");
    eq(c.getAttribute("aria-labelledby"), "a2hsTitle");
    eq(document.activeElement, before, "no focus taken");
    ok(isInstallPromptOpen(), "isInstallPromptOpen");
    ok(mem().shownAt > Date.now() - 5000, "shownAt remembered");
    eq(t.toasts, []);
  } finally { t.done(); }
});

test("install card: if the feed never answers it still shows, at MAX_WAIT_MS", async () => {
  const t = setup({ liveLoaded: false });
  try {
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: iphone, ...FAST });
    await waitFor(shown, "the card after the longest wait", 2000);
  } finally { t.done(); }
});

test("install card: waits during a trip, with the sheet expanded, Settings or a dialog open, typing, and the feedback ping", async () => {
  const t = setup({ liveLoaded: true, journey: { kind: "plan" } });
  const sheet = () => document.getElementById("sheet");
  const fb = document.createElement("button");
  fb.id = "feedbackBtn";
  document.body.appendChild(fb);
  try {
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: iphone, ...FAST });
    await sleep(150);
    eq(shown(), null, "a trip in progress");
    t.store.set({ journey: null });
    sheet().dataset.detent = "full";
    await sleep(150);
    eq(shown(), null, "the sheet is expanded");
    sheet().dataset.detent = "peek";
    fb.classList.add("is-ping");
    await sleep(150);
    eq(shown(), null, "the feedback button is pinging");
    const input = document.createElement("input");
    document.body.appendChild(input);
    fb.classList.remove("is-ping");
    input.focus();
    await sleep(150);
    eq(shown(), null, "typing");
    input.remove();
    await waitFor(shown, "the card once nothing is in the way");
    t.store.set({ journey: { kind: "plan" } });
    await waitFor(() => !shown(), "a trip that starts while it is up: it steps away");
    eq(t.toasts, [], "quietly");
    eq(mem().closedAt, 0, "not counted as a close");
  } finally { fb.remove(); t.done(); }
});

test("install card: the feedback button never pings while the card is open", () => {
  eq(pingBlocker({ shown: true, installCard: true }), "install card open");
  eq(pingBlocker({ shown: true }), "");
});

test("install card: Close hides it, remembers the close, says where it stays; not again by itself for 14 days", async () => {
  const t = setup();
  try {
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: iphone, ...FAST });
    const c = await waitFor(shown, "the card");
    c.querySelector('[data-a2hs="close"]').focus();
    c.querySelector('[data-a2hs="close"]').click();
    ok(!shown() && c.hidden, "hidden");
    ok(mem().closedAt > Date.now() - 5000, "closedAt remembered");
    eq(t.toasts, [TOAST_CLOSED]);
    eq(TOAST_CLOSED, "Add to Home Screen stays in Settings.");
    eq(document.activeElement, document.getElementById("title"), "focus goes on to the sheet title");
    // a reload the next day: nothing
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: iphone, ...FAST, now: () => Date.now() + DAY });
    await sleep(200);
    eq(shown(), null, "the next day: no");
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: iphone, ...FAST, now: () => Date.now() + 13 * DAY });
    await sleep(200);
    eq(shown(), null, "13 days later: no");
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: iphone, ...FAST, now: () => mem().closedAt + RESHOW_MS + 1000 });
    await waitFor(shown, "14 days after the close: once more");
  } finally { t.done(); }
});

test("install card: Escape inside it closes it (not the screen under it)", async () => {
  const t = setup();
  try {
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: iphone, ...FAST });
    const c = await waitFor(shown, "the card");
    const x = c.querySelector('[data-a2hs="close"]');
    x.focus();
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    x.dispatchEvent(e);
    ok(e.defaultPrevented, "handled here (main.js skips a handled Escape)");
    ok(!shown(), "closed");
    ok(mem().closedAt > 0, "a close");
  } finally { t.done(); }
});

test("install card: Don't show again = never by itself again; Settings can still open it (focus on its heading)", async () => {
  const t = setup();
  try {
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: iphone, ...FAST });
    const c = await waitFor(shown, "the card");
    c.querySelector('[data-a2hs="never"]').click();
    ok(!shown(), "hidden");
    eq(mem().never, true, "remembered");
    eq(t.toasts, [TOAST_NEVER]);
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: iphone, ...FAST, now: () => Date.now() + 400 * DAY });
    await sleep(200);
    eq(shown(), null, "a year later: still no");
    ok(openInstallPrompt({ store: t.store, ctx: t.ctx }), "Settings opens it");
    ok(shown(), "shown");
    eq(document.activeElement, document.getElementById("a2hsTitle"), "focus on its heading");
    shown().querySelector('[data-a2hs="close"]').click();
    eq(document.activeElement, document.getElementById("settingsBtn"), "closing it returns to Settings' circle");
  } finally { t.done(); }
});

test("install card: the tests' seam and demo-like rules keep it from showing by itself; a browser that cannot install shows none", async () => {
  const t = setup();
  try {
    sessionStorage.setItem(A2HS_OFF_KEY, "1");
    ok(testOff(), "seam on");
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: iphone, ...FAST });
    await sleep(200);
    eq(shown(), null, "the seam");
    sessionStorage.removeItem(A2HS_OFF_KEY);
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: { ua: UA.firefox, maxTouchPoints: 0, standalone: false, displayMode: "browser" }, ...FAST });
    await sleep(200);
    eq(shown(), null, "Firefox on a computer");
  } finally { t.done(); }
});

/** A stand-in for Chrome's BeforeInstallPromptEvent. */
function fakeOffer(outcome) {
  const e = { calls: 0 };
  let res;
  e.userChoice = new Promise((r) => { res = r; });
  e.prompt = () => { e.calls++; setTimeout(() => res({ outcome, platform: "web" }), 5); return Promise.resolve(); };
  return e;
}

test("install card: the one-tap button calls the browser's install from the tap; accepted = installed for good", async () => {
  const t = setup();
  try {
    const install = { event: fakeOffer("accepted"), installed: false };
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: chrome, install, ...FAST });
    const c = await waitFor(shown, "the card");
    const b = c.querySelector('[data-a2hs="install"]');
    eq(b.textContent, "Install app");
    const evt = install.event;
    b.click();
    eq(evt.calls, 1, "prompt() called synchronously in the tap");
    eq(install.event, null, "one prompt per offer");
    await waitFor(() => !shown(), "closed after the install");
    ok(mem().installedAt > 0, "installedAt remembered");
    eq(t.toasts, [TOAST_INSTALLED.desktop]);
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: chrome, install: { event: fakeOffer("accepted"), installed: false }, ...FAST });
    await sleep(200);
    eq(shown(), null, "never again in this browser");
  } finally { t.done(); }
});

test("install card: the browser's install dialog dismissed = a close (14 days); an offer that comes late adds the button", async () => {
  const t = setup();
  try {
    const install = { event: null, installed: false };
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: { ua: UA.android, maxTouchPoints: 5, standalone: false, displayMode: "browser" }, install, ...FAST });
    const c = await waitFor(shown, "the card");
    eq(c.querySelector('[data-a2hs="install"]'), null, "steps first (no offer yet)");
    ok(c.querySelector(".a2hs-for"), "Android steps");
    install.event = fakeOffer("dismissed");
    const { bus } = await import("../js/core/events.js");
    bus.emit("install:offer", {});
    const b = await waitFor(() => c.querySelector('[data-a2hs="install"]'), "the button appears");
    eq(b.textContent, "Add to Home Screen");
    b.click();
    await waitFor(() => !shown(), "closed after the dismissal");
    ok(mem().closedAt > 0 && !mem().installedAt, "counted as a close, not an install");
    eq(t.toasts, [], "no toast for the browser's own No");
  } finally { t.done(); }
});

test("install card: appinstalled from the browser's own menu while it is up closes it as installed", async () => {
  const t = setup();
  try {
    startInstallPrompt({ store: t.store, ctx: t.ctx, env: { ua: UA.android, maxTouchPoints: 5, standalone: false, displayMode: "browser" }, ...FAST });
    await waitFor(shown, "the card");
    const { bus } = await import("../js/core/events.js");
    bus.emit("install:done", {});
    ok(!shown(), "closed");
    ok(mem().installedAt > 0, "installed");
    eq(t.toasts, [TOAST_INSTALLED.android]);
  } finally { t.done(); }
});

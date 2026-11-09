/**
 * @module ui/install-prompt
 * The Add to Home Screen popup (owner 2026-11-07/09: "If the app/website is not opened from the home screen, create a
 * popup that clearly shows how the user could add the app to their home screen. This notification should be closable
 * but make the top of the notification clearly say: Add this website as a home screen app!. The instructions should use
 * the actual apple safari or chrome symbols to make it as intuitive as possible. if there is a way that you could do it
 * for the user where they just press a button, do so. If the app is opened from the home screen, do not show this
 * notification.").
 *
 * - Never in the installed app (core/install.js isInstalled: main.js does not even load this module there), never in
 *   demo mode, never under the tests' seam (sessionStorage A2HS_OFF_KEY = "1"), never in a browser that cannot install.
 * - Rider safety first (ship checklist 1, 3): it shows by itself only after the first look at the next bus: SHOW_AFTER_MS
 *   after the live feed first answered (or failed), at the latest MAX_WAIT_MS after start; a due popup waits (RETRY_MS)
 *   while a trip is in progress, the sheet is expanded, Settings or a dialog is open, a text field has focus, the page is
 *   hidden or the feedback button is pinging (core/install.js waitReason; the feedback button in turn never pings while
 *   this card is open). It is a non-modal card on the map: never over the status banner (it sits under Row B, below the
 *   trip chip), never over the collapsed sheet with the next bus (its height stops above it and scrolls), never over the
 *   Settings / feedback circles (it leaves their column free); hidden while the sheet is expanded; no focus is taken.
 * - Look (css/base.css .a2hs): a solid card in the glass family (DESIGN-SPEC-GLASS 5.1: content, dialogs and banners are
 *   solid; 12.1 has no blur budget left for a card this size): --glass-solid with the glass rim, edge and shadow,
 *   radius --r-glass. Heading INSTALL_TITLE in the headline role, the why line, then either ONE primary button (the
 *   browser offered its own install: beforeinstallprompt, kept by main.js; prompt() from the tap) or the numbered steps
 *   for the browser in hand with the browser's own glyphs inline (core/installsteps.js; icons with alternative text),
 *   the other browsers folded away, and the quiet "Don't show again". Close: a 44 circle named "Close" (and Escape).
 * - Memory (core/install.js, localStorage "sb:a2hs"): shown by itself = shownAt; Close = closedAt (it shows by itself at
 *   most once every 14 days, from the later of the two); "Don't show again" = never; an install (accepted prompt or
 *   appinstalled) = installedAt: never again in this browser. Settings > Add to Home Screen (only outside the installed
 *   app) opens it at any time, so a closed popup is never a dead end.
 * Nothing is sent anywhere; the choice is not reported (privacy.html "Your settings").
 */
import { esc } from "../core/esc.js";
import { bus } from "../core/events.js";
import { DEMO } from "../core/demo.js";
import { svg } from "./icons.js";
import { isSettingsOpen } from "./settings-overlay.js";
import { installEnv, isInstalled, installPlatform, autoBlocker, waitReason, loadMemory, rememberInstall } from "../core/install.js";
import {
  INSTALL_TITLE, whyText, installButtonLabel, stepsFor, stepParts, INSTALL_STEPS, INSTALL_ORDER, platformFamily,
} from "../core/installsteps.js";

/** sessionStorage test seam: "1" = never shows by itself in this browser session (Settings can still open it). */
export const A2HS_OFF_KEY = "sb-a2hs-off";
/** After the live feed first answers (the rider has seen the next bus), wait this long. */
export const SHOW_AFTER_MS = 4000;
/** At the latest this long after start, even if the feed never answered. */
export const MAX_WAIT_MS = 12000;
/** A due popup that has to wait tries again this often. */
export const RETRY_MS = 5000;
/** The timings in use (tests shorten them in the app's own module instance, like tests/e2e-expose.js does for views). */
export const installTimings = { showAfterMs: SHOW_AFTER_MS, maxWaitMs: MAX_WAIT_MS, retryMs: RETRY_MS };
export const CLOSE_LABEL = "Close";
export const NEVER_LABEL = "Don't show again";
export const OTHERS_LABEL = "Other phones and browsers";
export const BY_HAND_LABEL = "Other ways to add it";
export const TOAST_CLOSED = "Add to Home Screen stays in Settings.";
export const TOAST_NEVER = "It won't show again. Add to Home Screen stays in Settings.";
export const TOAST_INSTALLED = Object.freeze({
  ios: "Added. Open Straight Bussing from your Home Screen.",
  android: "Added. Open Straight Bussing from your home screen.",
  desktop: "Installed. Open Straight Bussing from your apps.",
  none: "Added. Open Straight Bussing from your home screen.",
});
const ID = "a2hs";

/** One step as HTML: the text escaped, each {icon} drawn inline at text size with its alternative text. */
export function stepHTML(step) {
  return stepParts(step).map((p) => (p.icon
    ? `<span class="a2hs-glyph" role="img" aria-label="${esc(p.label)}">${svg(p.icon, 18)}</span>`
    : esc(p.text))).join("");
}

/** A platform's numbered steps. */
function stepsHTML(k) {
  const st = stepsFor(k);
  return st ? `<ol class="a2hs-steps">${st.steps.map((x) => `<li>${stepHTML(x)}</li>`).join("")}</ol>` : "";
}

/**
 * The popup's content.
 * @param {{platform:string, canPrompt?:boolean}} o canPrompt: the browser offered its own one-tap install
 * @returns {string}
 */
export function promptHTML({ platform, canPrompt = false } = {}) {
  const own = stepsFor(platform) ? platform : null;
  const others = INSTALL_ORDER.filter((k) => k !== own);
  const fold = (summary, keys) => `<details class="a2hs-other"><summary>${esc(summary)}${svg("chevron-down", 18)}</summary>`
    + keys.map((k) => `<h3 class="a2hs-steps-h">${esc(INSTALL_STEPS[k].title)}</h3>${stepsHTML(k)}`).join("") + "</details>";
  let body;
  if (canPrompt) {
    const label = installButtonLabel(platform);
    body = `<button type="button" class="v-btn v-btn--primary v-btn--block a2hs-install" data-a2hs="install">${svg(platformFamily(platform) === "desktop" ? "monitor-down" : "square-plus", 20)}${esc(label)}</button>`
      + fold(BY_HAND_LABEL, own ? [own, ...others] : INSTALL_ORDER);
  } else {
    body = (own ? `<p class="a2hs-for">${esc(INSTALL_STEPS[own].title)}</p>${stepsHTML(own)}` : "") + fold(OTHERS_LABEL, others);
  }
  return `<div class="a2hs-head"><h2 id="a2hsTitle" class="a2hs-title" tabindex="-1">${esc(INSTALL_TITLE)}</h2>`
    + `<button type="button" class="a2hs-close" data-a2hs="close" aria-label="${esc(CLOSE_LABEL)}">${svg("x", 18, { stroke: 2.4 })}</button></div>`
    + `<p id="a2hsWhy" class="a2hs-why">${esc(whyText(platform))}</p>`
    + body
    + `<button type="button" class="v-btn v-btn--quiet a2hs-never" data-a2hs="never">${esc(NEVER_LABEL)}</button>`;
}

function session() {
  try { return window.sessionStorage; } catch (e) { return null; }
}
/** The test seam is set in this browser session. */
export function testOff(storage = session()) {
  try { return !!storage && storage.getItem(A2HS_OFF_KEY) === "1"; } catch (e) { return false; }
}
const isTyping = () => { const a = document.activeElement; return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable); };
const isVisible = (n) => !!n && !n.hidden && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== "hidden";

let current = null;   // the running prompt (one per page)
/** The running prompt's handle, or null (tests). */
export const installPrompt = () => current;
/** Is the popup on screen? (the feedback button reads the DOM instead: data-state="open") */
export const isInstallPromptOpen = () => !!current?.isOpen();

/**
 * Start the prompt: show it by itself once it is due (unless a rule says no), keep the one-tap button in step with the
 * browser's install offer, wire Close / Don't show again / Escape. Never throws.
 * @param {{store:object, ctx?:object, install?:{event:object|null, installed:boolean}, env?:object, now?:()=>number,
 *          showAfterMs?:number, maxWaitMs?:number, retryMs?:number, host?:HTMLElement|null}} o
 *   install: main.js's kept beforeinstallprompt; env: core/install.js installEnv (test seam); host: where the card goes
 * @returns {{open(o?:object):boolean, close(how?:string):void, isOpen():boolean, platform:string, stop():void}|null}
 */
export function startInstallPrompt({ store, ctx, install = { event: null, installed: false }, env, now = () => Date.now(),
  showAfterMs = installTimings.showAfterMs, maxWaitMs = installTimings.maxWaitMs, retryMs = installTimings.retryMs, host } = {}) {
  current?.stop();
  const E = env || installEnv();
  if (isInstalled(E) || install.installed) return null;
  const platform = installPlatform(E);
  let el = null, timer = 0, maxTimer = 0, open = false, manual = false, stopped = false, armed = false;
  const offs = [];

  const momentState = () => {
    const s = store?.get?.() || {};
    const dlg = document.getElementById("dlg");
    return {
      pageHidden: document.hidden, trip: !!(s.journey && s.journey.kind === "plan"),
      sheetFull: document.getElementById("sheet")?.dataset.detent === "full", overlay: isSettingsOpen(),
      dialog: !!document.querySelector("dialog[open]") || !!(dlg && !dlg.hidden), typing: isTyping(),
      feedbackPing: !!document.querySelector("#feedbackBtn.is-ping"),
    };
  };
  const autoWhy = () => autoBlocker({ installed: isInstalled(E) || install.installed, demo: DEMO, testOff: testOff(), platform,
    canPrompt: !!install.event, memory: loadMemory(), now: now() });

  function ensure() {
    if (el && el.isConnected) return el;
    el = document.createElement("section");
    el.id = ID;
    el.className = "a2hs";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "false");
    el.setAttribute("aria-labelledby", "a2hsTitle");
    el.setAttribute("aria-describedby", "a2hsWhy");
    el.dataset.state = "closed";
    el.dataset.platform = platform;
    el.hidden = true;
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();   // main.js: Escape here closes the card, not the screen under it
      close("closed");
    });
    const after = document.getElementById("ctxbar");   // DOM (focus) order: the top rows, then this card, then the sheet
    if (host) host.appendChild(el);
    else if (after?.parentNode) after.after(el);
    else (document.getElementById("app") || document.body).appendChild(el);
    return el;
  }
  function render() {
    if (!el) return;
    el.innerHTML = promptHTML({ platform, canPrompt: !!install.event });
  }

  /**
   * Show the card. auto: by itself (rules checked by the caller; remembers shownAt); else from Settings (always, and
   * focus moves to its heading).
   * @param {{auto?:boolean, focus?:boolean}} [o]
   * @returns {boolean} shown
   */
  function show(o = {}) {
    if (stopped) return false;
    ensure();
    manual = !o.auto;
    render();
    el.hidden = false;
    el.dataset.state = "open";
    el.classList.remove("is-in");
    void el.offsetWidth;   // restart the entrance
    el.classList.add("is-in");
    el.scrollTop = 0;
    open = true;
    if (o.auto) rememberInstall({ shownAt: now() });
    if (o.focus) el.querySelector("#a2hsTitle")?.focus({ preventScroll: true });
    bus.emit("install:prompt", { open: true });
    return true;
  }
  /**
   * Hide the card. how: "closed" (Close, Escape: closedAt + toast), "never" (Don't show again), "installed", "dismissed"
   * (the browser's install dialog was dismissed: counts as a close), "quiet" (a trip started: nothing remembered).
   */
  function close(how = "closed") {
    if (!open || !el) return;
    const wasInside = el.contains(document.activeElement), wasManual = manual;
    open = false;
    el.dataset.state = "closed";
    el.classList.remove("is-in");
    el.hidden = true;
    const t = now();
    if (how === "closed" || how === "dismissed") rememberInstall({ closedAt: t });
    else if (how === "never") rememberInstall({ never: true, closedAt: t });
    else if (how === "installed") rememberInstall({ installedAt: t });
    if (wasInside) {
      const gear = document.getElementById("settingsBtn");
      (wasManual && isVisible(gear) ? gear : document.getElementById("title"))?.focus?.({ preventScroll: true });
    }
    const msg = how === "closed" ? TOAST_CLOSED : how === "never" ? TOAST_NEVER : how === "installed" ? TOAST_INSTALLED[platformFamily(platform)] : "";
    if (msg) ctx?.toast?.(msg);
    bus.emit("install:prompt", { open: false, how });
  }

  function onClick(e) {
    const b = e.target.closest?.("[data-a2hs]");
    if (!b || !el.contains(b)) return;
    const what = b.dataset.a2hs;
    if (what === "close") close("closed");
    else if (what === "never") close("never");
    else if (what === "install") promptInstall();
  }
  /** The browser's own install dialog, from the tap (prompt() needs the user's gesture: no await before it). */
  function promptInstall() {
    const evt = install.event;
    if (!evt || typeof evt.prompt !== "function") { render(); return; }   // the offer is gone: the steps instead
    install.event = null;   // one prompt per offer
    let p;
    try { p = evt.prompt(); } catch (err) { render(); return; }
    Promise.resolve(p).then(() => evt.userChoice).then((c) => {
      if (c && c.outcome === "accepted") { install.installed = true; close("installed"); }
      else if (open) close("dismissed");
    }).catch(() => { if (open) render(); });
  }

  /* ---- showing by itself ---- */
  const plan = (ms) => { clearTimeout(timer); timer = stopped ? 0 : setTimeout(tick, ms); };
  function tick() {
    timer = 0;
    if (stopped || open) return;
    if (autoWhy()) return;               // not on this visit (installed, recently shown, ...)
    if (waitReason(momentState())) return plan(retryMs);
    show({ auto: true });
  }
  function arm() {
    if (armed || stopped) return;
    armed = true;
    clearTimeout(maxTimer);
    plan(showAfterMs);
  }
  const s0 = store?.get?.() || {};
  if (s0.liveLoaded || s0.failed) arm();
  else {
    const off = store?.subscribe?.((s) => { if (s.liveLoaded || s.failed) arm(); });
    if (typeof off === "function") offs.push(off);
    maxTimer = setTimeout(arm, maxWaitMs);
  }
  // a trip that starts while it is up: it steps away for this visit (the trip comes first)
  const offTrip = store?.subscribe?.((s) => { if (open && s.journey && s.journey.kind === "plan") close("quiet"); });
  if (typeof offTrip === "function") offs.push(offTrip);
  // the one-tap button appears (and a browser with no steps of its own may now offer the popup)
  offs.push(bus.on("install:offer", () => { if (open) render(); else if (armed && !timer) plan(retryMs); }));
  offs.push(bus.on("install:done", () => { if (open) close("installed"); else install.installed = true; }));

  function stop() {
    stopped = true;
    clearTimeout(timer); clearTimeout(maxTimer); timer = 0;
    offs.forEach((f) => { try { f(); } catch (e) { /* */ } });
    if (open && el) { open = false; el.hidden = true; el.dataset.state = "closed"; }
    el?.remove();
    if (current === api) current = null;
  }
  const api = { open: (o) => show({ focus: true, ...(o || {}), auto: false }), close, isOpen: () => open, platform, stop, tick };
  current = api;
  return api;
}

/**
 * Settings > Add to Home Screen: open the popup (starting it if this page has none yet). Focus goes to its heading.
 * @param {object} o startInstallPrompt's options (store, ctx, install)
 * @returns {boolean} shown
 */
export function openInstallPrompt(o = {}) {
  const p = current || startInstallPrompt({ ...o, showAfterMs: 1e9, maxWaitMs: 1e9 });
  return p ? p.open() : false;
}

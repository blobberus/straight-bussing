/**
 * @module ui/feedback-button
 * The map's feedback button (owner 2026-11-02: "Add a small notification button (still noticable) under the navigation
 * arrow button under the right side of the search bar. This notification should ping every once in a while. Pressing
 * it should reveal a menu that looks similar to the settings overlay menu which explicity requests the user for
 * feedback. Put a notification under it that if the user gives feedback, the notification button will disappear. The
 * app should remember if a particular user has already given feedback (or pressed the link). Alternatively,
 * underneath the send feedback button, there should be a smaller less noticable button which can say: I already gave
 * feedback. Which will silence the notification entirely. A silenced notification will entirely remove the button
 * from the navigation screen.").
 *
 * - The button (#feedbackBtn in index.html, `hidden` until this module shows it): the locate button's size and shape,
 *   right under it; a speech bubble in the accent color on the accent tint (--accent-bg, the feedback card's color,
 *   never the green live color) with a badge dot. Hidden at the full detent like the locate button (css/base.css).
 * - Ping: two soft ring pulses on the badge (PING_MS), first after the app has been open PING_FIRST_MS, then every
 *   PING_EVERY_MS, at most PING_MAX per visit (page load). A ping that is due waits (PING_RETRY_MS) while a trip is in
 *   progress, the sheet is expanded, the Settings-style overlay or any dialog is open, a text field has focus or the
 *   page is hidden (pingBlocker). Reduced motion: no movement at all, only the static badge.
 * - Tap: a panel in the Settings overlay's shell (ui/settings-overlay.js kind "feedback": same head with Done, card,
 *   scrim; Back, Escape, Done and a scrim tap close it): the feedback card (the popup's ask, WELCOME_BODY), Send
 *   feedback (a real link to the form in a new tab), a note that the button then disappears, and under it the quiet
 *   "I already gave feedback". Send feedback (here, in the welcome popup or in Settings) records "gave", "I already
 *   gave feedback" records "silenced" (ui/feedback.js FEEDBACK_DONE_KEY): either one removes the button at once and on
 *   every later visit (also in other open tabs) and stops the welcome popup; Settings > Give feedback always stays.
 * - Shown like the welcome popup (also in demo mode); test seam: pages that boot the real app set
 *   sessionStorage[FEEDBACK_BTN_OFF_KEY] = "1" first (tests/e2e.js, e2e-demo.js, feedback-app.js) so it never sits in
 *   their flows; tests/feedback-button.js removes it to test the button.
 * Nothing leaves the device: the choice stays in this browser's storage (privacy.html "Your settings").
 */
import { esc } from "../core/esc.js";
import { bus } from "../core/events.js";
import { openSettingsOverlay, closeSettingsOverlay, isSettingsOpen, overlayKind } from "./settings-overlay.js";
import {
  feedbackLinkHTML, feedbackDone, markFeedbackDone, noteFeedbackOpened,
  FEEDBACK_ICON, FEEDBACK_LEAD, FEEDBACK_NOTE, WELCOME_BODY, WELCOME_NOTE, FEEDBACK_DONE_KEY, DONE_SILENCED,
} from "./feedback.js";

/** The ping schedule (owner: "This notification should ping every once in a while"). */
export const PING_FIRST_MS = 20000;     // the first ping once the app has been open 20 s
export const PING_EVERY_MS = 180000;    // then every 3 minutes
export const PING_MAX = 4;              // at most 4 pings per visit (page load)
export const PING_RETRY_MS = 15000;     // a due ping that has to wait (trip, sheet up, menu, dialog, typing, hidden page)
export const PING_MS = 2600;            // one ping: two soft ring pulses on the badge (css/base.css .fbfab.is-ping)
const SCHEDULE = Object.freeze({ first: PING_FIRST_MS, every: PING_EVERY_MS, max: PING_MAX, retry: PING_RETRY_MS, ms: PING_MS });

/** data-kind of the overlay while it shows the feedback panel. */
export const FB_KIND = "feedback";
export const FB_TITLE = "Beta feedback";
/** The button's accessible name. */
export const FB_LABEL = "Give feedback";
export const FB_SEND = "Send feedback";
/** The owner's "notification under it": what happens to the button after feedback. */
export const FB_GONE = "Once you give feedback, the feedback button on the map disappears.";
export const FB_SILENCE = "I already gave feedback";
export const FB_THANKS = "Thank you for helping. Give feedback stays in Settings.";
export const FB_SILENCED = "Feedback button removed. Give feedback stays in Settings.";
/** sessionStorage test seam: "1" keeps the button hidden in this browser session. */
export const FEEDBACK_BTN_OFF_KEY = "sb-feedback-btn-off";

const BUTTON_ID = "feedbackBtn";

/**
 * Is the button on the map? Not after the rider gave feedback or silenced it, not under the test seam. Pure.
 * @param {{done?:string|null, testOff?:boolean}} o
 * @returns {boolean}
 */
export function buttonShown({ done, testOff } = {}) {
  return !done && !testOff;
}

/**
 * Why a due ping has to wait ("" = it may run now). Pure.
 * @param {{shown?:boolean, pageHidden?:boolean, trip?:boolean, detent?:string|null, overlay?:boolean, dialog?:boolean, typing?:boolean}} s
 * @returns {string}
 */
export function pingBlocker(s = {}) {
  if (!s.shown) return "hidden";
  if (s.pageHidden) return "page hidden";
  if (s.trip) return "trip in progress";
  if (s.detent === "full") return "sheet expanded";
  if (s.overlay) return "menu open";
  if (s.dialog) return "dialog open";
  if (s.typing) return "typing";
  return "";
}

/**
 * When to try the next ping: ms from now, or null when this visit has had all its pings. Pure.
 * @param {number} count pings so far in this visit
 * @param {number} sinceStart ms since the button started
 * @param {{first:number, every:number, max:number}} [o]
 * @returns {number|null}
 */
export function nextPingIn(count, sinceStart, o = SCHEDULE) {
  if (count >= o.max) return null;
  if (count === 0) return Math.max(0, o.first - Math.max(0, sinceStart || 0));
  return o.every;
}

/** The panel's content (the Settings overlay's body). */
export function panelHTML() {
  return '<div class="fbp">'
    + `<div class="st-feedback fbp-card"><div class="st-fbhead">${FEEDBACK_ICON}<p class="st-fblead">${esc(FEEDBACK_LEAD)}</p></div>`
    + `<p class="v-sec st-intro">${esc(WELCOME_BODY)}</p>`
    + feedbackLinkHTML(FB_SEND, { cls: "v-btn v-btn--primary v-btn--block st-fbbtn", attrs: 'data-fbp="send"', icon: true })
    + `<p class="v-fine st-fbnote fbp-gone">${esc(FB_GONE)}</p></div>`
    + `<button type="button" class="v-btn v-btn--quiet fbp-silence" data-fbp="silence">${esc(FB_SILENCE)}</button>`
    + `<p class="v-fine fbp-note">${esc(FEEDBACK_NOTE)} ${esc(WELCOME_NOTE)}</p>`
    + "</div>";
}

function session() {
  try { return window.sessionStorage; } catch (e) { return null; }
}
/** The test seam is set in this browser session. */
export function testOff(storage = session()) {
  try { return !!storage && storage.getItem(FEEDBACK_BTN_OFF_KEY) === "1"; } catch (e) { return false; }
}
const reducedMotionNow = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
const isTyping = () => { const a = document.activeElement; return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable); };
const isVisible = (n) => !!n && !n.hidden && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== "hidden";

let current = null;   // the running button (one per page)
/** The running button's handle, or null (tests). */
export const feedbackButton = () => current;

/**
 * Show the button (unless the rider is done), wire the tap, start the ping schedule. Never throws.
 * @param {{store:object, ctx:object, button?:HTMLElement|null, schedule?:object, now?:()=>number,
 *          reducedMotion?:()=>boolean}} o ctx: the app ctx (store, setDetent, toast); schedule: test override of
 *   {first, every, max, retry, ms}; now: ms clock; reducedMotion: test override
 * @returns {{shown():boolean, pings():number, refresh():boolean, open():void, stop():void}|null}
 */
export function startFeedbackButton({ store, ctx, button, schedule, now = () => Date.now(), reducedMotion = reducedMotionNow } = {}) {
  current?.stop();
  const btn = button === undefined ? document.getElementById(BUTTON_ID) : button;
  if (!btn) return null;
  const S = { ...SCHEDULE, ...(schedule || {}) };
  const t0 = now();
  let timer = 0, pingTimer = 0, count = 0, shown = false, stopped = false;
  const offs = [];

  const blocker = () => {
    const s = store?.get?.() || {};
    const dlg = document.getElementById("dlg");
    return pingBlocker({
      shown, pageHidden: document.hidden, trip: !!(s.journey && s.journey.kind === "plan"),
      detent: document.getElementById("sheet")?.dataset.detent || null, overlay: isSettingsOpen(),
      dialog: !!document.querySelector("dialog[open]") || !!(dlg && !dlg.hidden), typing: isTyping(),
    });
  };
  const plan = (ms) => { clearTimeout(timer); timer = ms == null || stopped || !shown ? 0 : setTimeout(tick, ms); };
  function ping() {
    count++;
    btn.dataset.pings = String(count);
    if (reducedMotion()) return;   // no movement: the static badge says it
    clearTimeout(pingTimer);
    btn.classList.remove("is-ping");
    void btn.offsetWidth;          // restart the animation
    btn.classList.add("is-ping");
    pingTimer = setTimeout(() => btn.classList.remove("is-ping"), S.ms);
  }
  function tick() {
    timer = 0;
    if (stopped || !shown) return;
    if (blocker()) return plan(S.retry);
    ping();
    plan(nextPingIn(count, now() - t0, S));
  }
  /** Re-read the rules: show or remove the button. @returns {boolean} shown */
  function refresh() {
    const was = shown;
    shown = !stopped && buttonShown({ done: feedbackDone(), testOff: testOff() });
    if (btn.hidden === shown) btn.hidden = !shown;
    if (!shown) {
      clearTimeout(timer); clearTimeout(pingTimer); timer = 0;
      btn.classList.remove("is-ping");
    } else if (!was && !timer) plan(nextPingIn(count, now() - t0, S));
    return shown;
  }
  function open() {
    if (isSettingsOpen()) {   // the overlay is one shell: close what it shows (a second tap here closes the panel)
      const mine = overlayKind() === FB_KIND;
      closeSettingsOverlay({ focus: "none" });
      if (mine) return;
    }
    openSettingsOverlay(ctx, panelContent(ctx), { trigger: btn, opener: btn, title: FB_TITLE, kind: FB_KIND });
  }
  function stop() {
    stopped = true;
    clearTimeout(timer); clearTimeout(pingTimer); timer = 0;
    btn.classList.remove("is-ping");
    offs.forEach((f) => { try { f(); } catch (e) { /* */ } });
    if (current === api) current = null;
  }
  const onClick = () => open();
  btn.addEventListener("click", onClick);
  offs.push(() => btn.removeEventListener("click", onClick));
  offs.push(bus.on("feedback:done", () => refresh()));   // Send feedback anywhere, I already gave feedback
  const onStorage = (e) => { if (!e || e.key === FEEDBACK_DONE_KEY || e.key === null) refresh(); };   // another tab
  window.addEventListener("storage", onStorage);
  offs.push(() => window.removeEventListener("storage", onStorage));

  const api = { shown: () => shown, pings: () => count, refresh, open, stop };
  current = api;
  try { refresh(); } catch (e) { console.warn("feedback button", e); }
  return api;
}

/** Where focus goes when the panel closes and the button is gone: its neighbor, the locate button, else the sheet title. */
function focusAfterGone() {
  const loc = document.getElementById("locateBtn");
  const to = isVisible(loc) ? loc : document.getElementById("title");
  to?.focus?.({ preventScroll: true });
}

/**
 * The panel as Settings-overlay content: render + the two choices.
 * @param {object} ctx app ctx (toast)
 */
export function panelContent(ctx) {
  let abort = null;
  return {
    render: () => panelHTML(),
    mount(root) {
      abort?.abort();
      abort = new AbortController();
      root.addEventListener("click", (e) => {
        const t = e.target.closest?.("[data-fbp]");
        if (!t || !root.contains(t)) return;
        const what = t.dataset.fbp;
        if (what === "send") noteFeedbackOpened();             // the link itself opens the form in a new tab
        else if (what === "silence") markFeedbackDone(DONE_SILENCED);
        else return;
        // after the link's own default action (the new tab) has run
        setTimeout(() => {
          if (isSettingsOpen() && overlayKind() === FB_KIND) closeSettingsOverlay({ focus: "none" });
          if (document.getElementById(BUTTON_ID)?.hidden !== false) focusAfterGone();
          ctx?.toast?.(what === "send" ? FB_THANKS : FB_SILENCED);
        }, 0);
      }, { signal: abort.signal });
    },
    unmount() { abort?.abort(); abort = null; },
  };
}

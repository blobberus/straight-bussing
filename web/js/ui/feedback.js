/**
 * @module ui/feedback
 * Beta feedback (owner 2026-10-13): the one place for the feedback form's address, the link that opens it, and the
 * welcome popup that asks for feedback every once in a while.
 * - FEEDBACK_URL: a Google Form. It opens in a new tab only when the rider taps "Give feedback" (Settings) or
 *   "Go to Feedback" (the welcome popup); nothing is added to its link. Not the support form (support.html +
 *   web/support-form.js SUPPORT_FORM_URL, a separate, pre-filled form).
 * - Welcome popup (native <dialog>, behaves like ui/confirm.js), more noticeable since 2026-11-02 (owner: "Make the
 *   feedback request notification a little more noticable (using different colors etc). Emphasize how it would be
 *   very helpful. Would it be possible to make this request only occur every once in a while and not every time the
 *   user reloads the site?"): an accent-tinted header band (--accent-bg, never the green live color) with a speech
 *   bubble icon, then "Your feedback would be very helpful." How often (constants below): never twice in one visit
 *   (sessionStorage WELCOME_KEY), at most once every WELCOME_EVERY_DAYS days, and not for WELCOME_AFTER_FEEDBACK_DAYS
 *   days after the rider opened the form (Go to Feedback, or Give feedback in Settings: noteFeedbackOpened), both
 *   remembered in localStorage WELCOME_LOG_KEY (two dates, on the device only, never sent). Storage blocked or
 *   private mode: at most once per browser session, or per page load when even sessionStorage is blocked.
 *   Cancel, Escape and a tap outside close it; "Go to Feedback" is a real link (new tab, never window.open) that
 *   also closes it. main.js opens it after the first real render, so it never delays the first paint or the data.
 *   Test seam: pages that boot the real app set sessionStorage[WELCOME_KEY] = "1" first (tests/e2e.js, e2e-demo.js).
 */
import { esc } from "../core/esc.js";

/** How often the welcome popup may ask (owner 2026-11-02: "only occur every once in a while"). */
export const WELCOME_EVERY_DAYS = 7;            // at most once a week
export const WELCOME_AFTER_FEEDBACK_DAYS = 30;  // after the rider opened the form: a month without asking
const DAY_MS = 86400000;

/** The beta feedback form (owner 2026-10-13). */
export const FEEDBACK_URL = "https://forms.gle/zK4hi2UfYsrXURR97";
/** sessionStorage key: the welcome popup was shown in this browser session (never twice in one visit). */
export const WELCOME_KEY = "sb-welcome-seen";
/** localStorage key: {shown, feedback}, the times (ms) the popup last appeared and the form was last opened. */
export const WELCOME_LOG_KEY = "sb-welcome-log";
/** Owner's title, exactly (2026-10-13). */
export const WELCOME_TITLE = "Welcome to the beta version of Straight Bussing!";
/** The ask, also the first line of Settings > Beta feedback (owner 2026-11-02: "Emphasize how it would be very helpful"). */
export const FEEDBACK_LEAD = "Your feedback would be very helpful.";
export const WELCOME_BODY = "Straight Bussing is still in beta. The form takes about a minute, and every answer directly shapes what gets fixed and built next for everyone who rides the campus shuttles.";
export const WELCOME_NOTE = "You can also find Give feedback in Settings at any time.";
/** What a screen reader adds to a feedback link's visible label. */
export const NEW_TAB = "opens a Google Form in a new tab";
/** Speech bubble on an accent disc (decoration: the words carry the meaning). Popup header and Settings card. */
export const FEEDBACK_ICON = '<span class="fb-badge" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19.5l1.4-4.3A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8.5 10h7M8.5 13.5h4.5"/></svg></span>';

const GUARD_MS = 350;   // like ui/confirm.js: taps in the first moment after opening are ignored (a double tap)
const PAINT_WAIT_MS = 400;   // welcomeAfterPaint: the longest wait for the next frame
let shownThisLoad = false;

/**
 * The feedback link: a real <a> to the form in a new tab (a popup blocker never stops a tap on a link).
 * @param {string} label visible words
 * @param {{cls?:string, attrs?:string, icon?:boolean}} [o] cls: classes; attrs: extra trusted attribute markup;
 *   icon: the "opens elsewhere" arrow after the label
 * @returns {string}
 */
export function feedbackLinkHTML(label, { cls = "v-btn v-btn--secondary", attrs = "", icon = false } = {}) {
  const arrow = icon ? '<svg class="v-ic fb-ext" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>' : "";
  return `<a class="${esc(cls)}" href="${esc(FEEDBACK_URL)}" target="_blank" rel="noopener" aria-label="${esc(`${label}, ${NEW_TAB}`)}"${attrs ? " " + attrs : ""}>${esc(label)}${arrow}</a>`;
}

function session() {
  try { return window.sessionStorage; } catch (e) { return null; }   // the getter itself throws when storage is blocked
}
function local() {
  try { return window.localStorage; } catch (e) { return null; }
}

/**
 * When the popup last appeared and the form was last opened (ms; 0 = never). Never throws.
 * @param {Storage|null} [storage] default: localStorage
 * @returns {{shown:number, feedback:number}}
 */
export function welcomeLog(storage = local()) {
  let v = null;
  try { v = storage ? JSON.parse(storage.getItem(WELCOME_LOG_KEY) || "null") : null; } catch (e) { v = null; }
  const num = (x) => (Number.isFinite(x) && x > 0 ? x : 0);
  return { shown: num(v && v.shown), feedback: num(v && v.feedback) };
}
function writeLog(storage, patch) {
  try { if (storage) storage.setItem(WELCOME_LOG_KEY, JSON.stringify({ ...welcomeLog(storage), ...patch })); } catch (e) { /* private mode / blocked */ }
}

/**
 * May the popup ask again? Not within WELCOME_EVERY_DAYS of the last time it appeared, nor within
 * WELCOME_AFTER_FEEDBACK_DAYS of the rider opening the form. A time in the future (the clock was changed) counts by
 * its distance, so a wrong clock never silences the popup for good. Pure.
 * @param {{shown?:number, feedback?:number}|null} log welcomeLog()
 * @param {number} [now] ms
 * @returns {boolean}
 */
export function welcomeDue(log, now = Date.now()) {
  const away = (t) => (Number.isFinite(t) && t > 0 ? Math.abs(now - t) : Infinity);
  return away(log && log.shown) >= WELCOME_EVERY_DAYS * DAY_MS && away(log && log.feedback) >= WELCOME_AFTER_FEEDBACK_DAYS * DAY_MS;
}

/**
 * The rider opened the form (Go to Feedback, or Give feedback in Settings): the popup waits
 * WELCOME_AFTER_FEEDBACK_DAYS. Never throws.
 * @param {{storage?:Storage|null, now?:number}} [o] storage: default localStorage
 */
export function noteFeedbackOpened({ storage, now } = {}) {
  writeLog(storage === undefined ? local() : storage, { feedback: Number.isFinite(now) ? now : Date.now() });
}

/**
 * Was the welcome popup already shown in this browser session?
 * @param {Storage|null} [storage] default: sessionStorage
 * @returns {boolean}
 */
export function welcomeSeen(storage = session()) {
  try { return !!storage && storage.getItem(WELCOME_KEY) === "1"; } catch (e) { return false; }
}

/**
 * Show the welcome popup when it is due: not yet in this browser session or page load, and welcomeDue (once a week at
 * most; a month after the form was opened). It counts as shown as soon as it opens, so a reload never shows it again.
 * @param {{storage?:Storage|null, log?:Storage|null, now?:number}} [o] storage: default sessionStorage; log: default
 *   localStorage; now: ms (tests pass their own)
 * @returns {Promise<string>|null} the popup's result ("feedback" | "cancel"), null when not shown
 */
export function maybeShowWelcome({ storage, log, now } = {}) {
  if (shownThisLoad) return null;
  const st = storage === undefined ? session() : storage;
  if (welcomeSeen(st)) return null;
  const ls = log === undefined ? local() : log;
  const t = Number.isFinite(now) ? now : Date.now();
  if (!welcomeDue(welcomeLog(ls), t)) return null;
  shownThisLoad = true;
  try { st && st.setItem(WELCOME_KEY, "1"); } catch (e) { /* private mode / blocked storage: once per page load */ }
  writeLog(ls, { shown: t });
  return showWelcome().then((how) => {
    if (how === "feedback") noteFeedbackOpened({ storage: ls });
    return how;
  });
}

/** Tests only: forget that this page load showed the popup. */
export function _resetWelcome() { shownThisLoad = false; }

/**
 * The welcome popup itself. Cancel has focus first (the safe choice: nothing leaves the device by accident).
 * @returns {Promise<string>} "feedback" (Go to Feedback: the form opened in a new tab) | "cancel" | "none" (not shown)
 */
export function showWelcome() {
  if (typeof document === "undefined" || typeof HTMLDialogElement === "undefined") return Promise.resolve("none");
  if (document.querySelector("dialog.v-welcome")) return Promise.resolve("none");   // already open
  const opener = document.activeElement;
  const dlg = document.createElement("dialog");
  dlg.className = "v-dialog v-welcome";
  dlg.setAttribute("aria-labelledby", "v-welcome-t");
  dlg.setAttribute("aria-describedby", "v-welcome-b");
  dlg.innerHTML = `<div class="v-welcome-band">${FEEDBACK_ICON}<h2 class="v-dlg-title" id="v-welcome-t">${esc(WELCOME_TITLE)}</h2></div>`
    + `<div class="v-welcome-main"><div id="v-welcome-b"><p class="v-welcome-lead">${esc(FEEDBACK_LEAD)}</p>`
    + `<p class="v-sec v-welcome-b">${esc(WELCOME_BODY)}</p><p class="v-fine v-welcome-note">${esc(WELCOME_NOTE)}</p></div>`
    + '<div class="v-actions v-welcome-acts"><button type="button" class="v-btn v-btn--secondary" data-welcome="cancel">Cancel</button>'
    + feedbackLinkHTML("Go to Feedback", { cls: "v-btn v-btn--primary", attrs: 'data-welcome="feedback"', icon: true }) + "</div></div>";
  document.body.appendChild(dlg);
  return new Promise((resolve) => {
    let done = false;
    const finish = (how) => {
      if (done) return;
      done = true;
      resolve(how);
      try { if (dlg.open) dlg.close(how); } catch (e) { /* already closed */ }
      setTimeout(() => dlg.remove(), 0);   // after the link's own default action (the new tab) has run
      if (opener && opener !== document.body && opener.isConnected) opener.focus?.({ preventScroll: true });
    };
    const openedAt = performance.now();
    dlg.addEventListener("click", (e) => {
      const early = e.detail !== 0 && performance.now() - openedAt < GUARD_MS;   // keyboard clicks have detail 0
      const b = e.target.closest?.("[data-welcome]");
      if (b) {
        if (early) return void e.preventDefault();   // a ghost tap never opens the form
        return void finish(b.dataset.welcome);       // the link keeps its default action: the form opens in a new tab
      }
      if (early || e.target !== dlg) return;
      // the backdrop also targets the <dialog>; so does its own padding: only a tap outside the box closes it
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) finish("cancel");
    });
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish("cancel"); });   // Escape
    dlg.addEventListener("close", () => finish("cancel"));   // closed by the browser (Escape without a prior tap)
    try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
    dlg.querySelector('[data-welcome="cancel"]').focus();
  });
}

/**
 * Boot hook (main.js, after the first real render): wait for the next paint, and for the page to be visible
 * (a tab opened in the background must not use up the week's one popup unseen), then maybe show it.
 * Never throws; never blocks anything.
 */
export function welcomeAfterPaint() {
  const go = () => { try { maybeShowWelcome(); } catch (e) { console.warn("welcome popup", e); } };
  const whenVisible = () => {
    if (!document.hidden) return go();
    const on = () => { if (document.hidden) return; document.removeEventListener("visibilitychange", on); go(); };
    document.addEventListener("visibilitychange", on);
  };
  let started = false;
  const next = () => { if (!started) { started = true; setTimeout(whenVisible, 0); } };
  if (typeof requestAnimationFrame === "function" && !document.hidden) requestAnimationFrame(next);
  setTimeout(next, PAINT_WAIT_MS);   // a view that never paints a frame (some embedded / headless views) still gets it
}

/**
 * @module ui/feedback
 * Beta feedback (owner 2026-10-13): the one place for the feedback form's address, the link that opens it, and the
 * welcome popup shown once per browser session.
 * - FEEDBACK_URL: a Google Form. It opens in a new tab only when the rider taps "Give feedback" (Settings) or
 *   "Go to Feedback" (the welcome popup); nothing is added to its link. Not the support form (support.html +
 *   web/support-form.js SUPPORT_FORM_URL, a separate, pre-filled form).
 * - Welcome popup (native <dialog>, looks and behaves like ui/confirm.js): the first time the app opens in a
 *   browser session (sessionStorage WELCOME_KEY; storage blocked or private mode = at most once per page load).
 *   Cancel, Escape and a tap outside close it; "Go to Feedback" is a real link (new tab, never window.open) that
 *   also closes it. main.js opens it after the first real render, so it never delays the first paint or the data.
 *   Test seam: pages that boot the real app set sessionStorage[WELCOME_KEY] = "1" first (tests/e2e.js, e2e-demo.js).
 */
import { esc } from "../core/esc.js";

/** The beta feedback form (owner 2026-10-13). */
export const FEEDBACK_URL = "https://forms.gle/zK4hi2UfYsrXURR97";
/** sessionStorage key: the welcome popup was shown in this browser session. */
export const WELCOME_KEY = "sb-welcome-seen";
/** Owner's words, exactly. */
export const WELCOME_TITLE = "Welcome to the beta version of Straight Bussing!";
export const WELCOME_BODY = "Thank you for trying the app out. Please give feedback on your experience (link to feedback also available in the settings menu).";
/** What a screen reader adds to a feedback link's visible label. */
export const NEW_TAB = "opens a Google Form in a new tab";

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

/**
 * Was the welcome popup already shown in this browser session?
 * @param {Storage|null} [storage] default: sessionStorage
 * @returns {boolean}
 */
export function welcomeSeen(storage = session()) {
  try { return !!storage && storage.getItem(WELCOME_KEY) === "1"; } catch (e) { return false; }
}

/**
 * Show the welcome popup if this browser session has not seen it (and this page load has not shown it).
 * It counts as seen as soon as it opens, so a reload in the same session never shows it again.
 * @param {{storage?:Storage|null}} [o] storage: default sessionStorage (tests pass their own)
 * @returns {Promise<string>|null} the popup's result ("feedback" | "cancel"), null when not shown
 */
export function maybeShowWelcome({ storage } = {}) {
  if (shownThisLoad) return null;
  const st = storage === undefined ? session() : storage;
  if (welcomeSeen(st)) return null;
  shownThisLoad = true;
  try { st && st.setItem(WELCOME_KEY, "1"); } catch (e) { /* private mode / blocked storage: once per page load */ }
  return showWelcome();
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
  dlg.innerHTML = `<h2 class="v-dlg-title" id="v-welcome-t">${esc(WELCOME_TITLE)}</h2><p class="v-sec v-welcome-b" id="v-welcome-b">${esc(WELCOME_BODY)}</p>`
    + '<div class="v-actions v-welcome-acts"><button type="button" class="v-btn v-btn--secondary" data-welcome="cancel">Cancel</button>'
    + feedbackLinkHTML("Go to Feedback", { cls: "v-btn v-btn--primary", attrs: 'data-welcome="feedback"' }) + "</div>";
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
 * (a tab opened in the background must not use up the session's one popup unseen), then maybe show it.
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

/**
 * @module ui/feedback
 * Beta feedback (owner 2026-10-13): the one place for the feedback form's address, the link that opens it, the words the
 * feedback prompts share, and the memory of whether the rider already gave feedback.
 * - FEEDBACK_URL: a Google Form. It opens in a new tab only when the rider taps "Send feedback" (the panel of the map's
 *   feedback button, ui/feedback-button.js) or "Give feedback" (Settings); nothing is added to its link. Not the support
 *   form (support.html + web/support-form.js SUPPORT_FORM_URL, a separate, pre-filled form).
 * - No popup: the beta welcome popup (2026-10-13: once per browser session; at most once a week since 2026-11-02) was
 *   removed on 2026-11-04 at the owner's request ("Stop the give feedback sign on every login to pop up. Keep the
 *   feedback button on the map screen."). The map's feedback button is the only prompt; Settings > Give feedback always
 *   stays. Nothing in this module runs at boot.
 * - Given feedback (owner 2026-11-02: "The app should remember if a particular user has already given feedback (or
 *   pressed the link)"): localStorage FEEDBACK_DONE_KEY = {how: "gave" | "silenced", at}. "gave" = the rider opened
 *   the form from anywhere (Send feedback on the map button's panel, Give feedback in Settings: noteFeedbackOpened; a
 *   form opened before 2026-11-02 counts too: the removed popup's log WELCOME_LOG_KEY, now only read, never written);
 *   "silenced" = "I already gave feedback" on the panel. Either one removes the map's feedback button for good;
 *   Settings > Give feedback always stays. Storage blocked: remembered for this page load only. Every change is
 *   announced on the app bus as "feedback:done".
 */
import { esc } from "../core/esc.js";
import { bus } from "../core/events.js";

/** localStorage key: the rider gave feedback or silenced the ask, {how: "gave" | "silenced", at: ms}. */
export const FEEDBACK_DONE_KEY = "sb-feedback-done";
/** The panel's "less noticeable" choice (owner's words) records this; opening the form records "gave". */
export const DONE_GAVE = "gave";
export const DONE_SILENCED = "silenced";
/** localStorage key of the removed welcome popup's log, {shown, feedback} (ms). Read only: its feedback date (the form
 * opened before 2026-11-02) still counts as feedback given; nothing writes it any more. */
export const WELCOME_LOG_KEY = "sb-welcome-log";

/** The beta feedback form (owner 2026-10-13). */
export const FEEDBACK_URL = "https://forms.gle/zK4hi2UfYsrXURR97";
/** The ask, first on the map button's panel and in Settings > Beta feedback (owner 2026-11-02: "Emphasize how it would
 * be very helpful"). */
export const FEEDBACK_LEAD = "Your feedback would be very helpful.";
/** Why it helps (the map button's panel; Settings has its shorter FEEDBACK_LINE). */
export const FEEDBACK_BODY = "Straight Bussing is still in beta. The form takes about a minute, and every answer directly shapes what gets fixed and built next for everyone who rides the campus shuttles.";
/** Where else the form is (fine print on the map button's panel). */
export const FEEDBACK_IN_SETTINGS = "You can also find Give feedback in Settings at any time.";
/** Under every feedback link (Settings card, the map button's panel): what opening the form sends. */
export const FEEDBACK_NOTE = "Opens a Google Form in a new tab. What you type is sent only when you press Submit there.";
/** What a screen reader adds to a feedback link's visible label. */
export const NEW_TAB = "opens a Google Form in a new tab";
/** Speech bubble on an accent disc (decoration: the words carry the meaning). Settings card, the map button's panel. */
export const FEEDBACK_ICON = '<span class="fb-badge" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19.5l1.4-4.3A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8.5 10h7M8.5 13.5h4.5"/></svg></span>';

let doneThisLoad = null;   // feedbackDone when storage could not keep it (private mode, blocked): this page load only

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

function local() {
  try { return window.localStorage; } catch (e) { return null; }   // the getter itself throws when storage is blocked
}

/**
 * When the form was opened before 2026-11-02, from the removed popup's log (ms; 0 = never). Never throws.
 * @param {Storage|null} storage
 * @returns {number}
 */
function legacyFeedbackAt(storage) {
  let v = null;
  try { v = storage ? JSON.parse(storage.getItem(WELCOME_LOG_KEY) || "null") : null; } catch (e) { v = null; }
  const t = v && v.feedback;
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/**
 * Has the rider given feedback (or said so)? "gave" | "silenced" | null. A form opened before 2026-11-02 (only the
 * removed popup's log has its date) counts as "gave"; storage blocked: what this page load recorded. Never throws.
 * @param {Storage|null} [storage] default: localStorage
 * @returns {"gave"|"silenced"|null}
 */
export function feedbackDone(storage = local()) {
  let v = null;
  try { v = storage ? JSON.parse(storage.getItem(FEEDBACK_DONE_KEY) || "null") : null; } catch (e) { v = null; }
  const how = v && (v.how === DONE_GAVE || v.how === DONE_SILENCED) ? v.how : null;
  if (how) return how;
  if (legacyFeedbackAt(storage) > 0) return DONE_GAVE;
  return doneThisLoad;
}

/**
 * Remember that the rider gave feedback ("gave": the form was opened) or silenced the ask ("silenced": "I already
 * gave feedback"). "gave" always wins over "silenced". Kept in localStorage; when that fails, for this page load.
 * Announces "feedback:done" on the app bus (the map button hides at once). Never throws.
 * @param {"gave"|"silenced"} how
 * @param {{storage?:Storage|null, now?:number}} [o] storage: default localStorage
 * @returns {"gave"|"silenced"} what is now remembered
 */
export function markFeedbackDone(how, { storage, now } = {}) {
  const st = storage === undefined ? local() : storage;
  const want = how === DONE_SILENCED ? DONE_SILENCED : DONE_GAVE;
  const next = feedbackDone(st) === DONE_GAVE ? DONE_GAVE : want;
  let kept = false;
  try {
    if (st) {
      st.setItem(FEEDBACK_DONE_KEY, JSON.stringify({ how: next, at: Number.isFinite(now) ? now : Date.now() }));
      kept = feedbackDone(st) === next;
    }
  } catch (e) { kept = false; }   // private mode / blocked
  if (!kept) doneThisLoad = doneThisLoad === DONE_GAVE ? DONE_GAVE : next;
  try { bus.emit("feedback:done", { how: next }); } catch (e) { /* a listener failed: the choice is kept anyway */ }
  return next;
}

/**
 * The rider opened the form (Send feedback on the map button's panel, Give feedback in Settings): they count as having
 * given feedback (markFeedbackDone "gave"), so the map button goes for good. Never throws.
 * @param {{storage?:Storage|null, now?:number}} [o] storage: default localStorage
 */
export function noteFeedbackOpened({ storage, now } = {}) {
  markFeedbackDone(DONE_GAVE, { storage, now });
}

/** Tests only: forget what this page load recorded without storage (as a reload does). */
export function _resetFeedback() { doneThisLoad = null; }

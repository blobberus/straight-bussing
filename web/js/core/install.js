/**
 * @module core/install
 * Add to Home Screen (owner 2026-11-07/09: "If the app/website is not opened from the home screen, create a popup that
 * clearly shows how the user could add the app to their home screen ... If the app is opened from the home screen, do
 * not show this notification."). The one shared answer to "is this page the installed app?" (used by the popup,
 * Settings, core/lochelp.js and the usage statistics) and which install steps fit the browser in hand. Pure; the
 * steps' words are core/installsteps.js, the popup is ui/install-prompt.js.
 *
 * Installed = iPhone / iPad Safari's `navigator.standalone`, or a display mode only an installed web app has
 * (standalone, fullscreen, minimal-ui, window-controls-overlay). A browser tab reports "browser".
 * The user agent is read on the device only to pick the steps; nothing is sent anywhere, the install choice is not
 * reported (data/usage.js keeps sending app = "home-screen" / "browser" as before, from isInstalled).
 *
 * When the popup may show by itself (autoBlocker): never in the installed app, in demo mode, under the tests' seam, in a
 * browser that cannot install (unless it offers its own one-tap install), after an install from this browser or "Don't
 * show again"; otherwise at most once every RESHOW_DAYS (14) days, counted from the later of the last time it showed and
 * the last close, so a rider who leaves it open is not asked again on every reload either. When a due popup waits
 * (waitReason): a trip, the expanded sheet, Settings or a dialog, typing, a hidden page, the feedback button's ping.
 * Memory: localStorage "sb:a2hs" (core/storage.js) = {shownAt, closedAt, never, installedAt} in ms; blocked storage =
 * this page load only. A setting like any other: privacy.html "Your settings".
 */
import { load, save } from "./storage.js";

/** Display modes that only an installed web app reports (a browser tab is "browser"). */
export const INSTALLED_MODES = Object.freeze(["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"]);

/**
 * Is this page the installed / Home Screen app?
 * @param {{standalone?:boolean, displayMode?:string}} [env] standalone: navigator.standalone (iPhone, iPad);
 *   displayMode: the matching CSS display mode ("browser" in a tab)
 * @returns {boolean}
 */
export function isInstalled({ standalone = false, displayMode = "" } = {}) {
  return standalone === true || INSTALLED_MODES.includes(displayMode);
}

/**
 * The current browser's environment for isInstalled / installPlatform (safe outside a browser; never throws).
 * @param {object|null} [nav] navigator (test seam)
 * @param {((q:string)=>{matches:boolean})|null} [mm] matchMedia (test seam)
 * @returns {{ua:string, maxTouchPoints:number, standalone:boolean, displayMode:string}}
 */
export function installEnv(nav = typeof navigator !== "undefined" ? navigator : null, mm = typeof matchMedia === "function" ? matchMedia : null) {
  const env = { ua: "", maxTouchPoints: 0, standalone: false, displayMode: "browser" };
  try {
    if (nav) {
      env.ua = String(nav.userAgent || "");
      env.maxTouchPoints = Number(nav.maxTouchPoints) || 0;
      env.standalone = nav.standalone === true;
    }
  } catch (e) { /* a navigator that throws: a browser tab */ }
  try {
    if (typeof mm === "function") env.displayMode = INSTALLED_MODES.find((m) => { try { return !!mm(`(display-mode: ${m})`)?.matches; } catch (e) { return false; } }) || "browser";
  } catch (e) { /* no media queries */ }
  return env;
}

/** Is this page running as the installed app right now? */
export const installedNow = () => isInstalled(installEnv());

/** Apps that open links in their own built-in browser, which cannot add to the Home Screen. */
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|GSA\/|Line\/|Snapchat|musical_ly|BytedanceWebview|TikTok|Twitter|LinkedInApp|GroupMe|Discord|Pinterest/i;

/**
 * Which install steps fit this browser (the user agent is read only to pick them).
 * @param {{ua?:string, maxTouchPoints?:number}} [env]
 * @returns {'ios-safari'|'ios-chrome'|'ios-other'|'ios-inapp'|'android-chrome'|'android-samsung'|'android-firefox'|'android-inapp'|'desktop-chrome'|'desktop-edge'|'mac-safari'|'none'}
 *   'none' = no way to install from this browser (Firefox on a computer, unknown browsers)
 */
export function installPlatform({ ua = "", maxTouchPoints = 0 } = {}) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);   // iPadOS asks as a Mac
  if (ios) {
    if (IN_APP.test(ua) || !/Safari\//.test(ua)) return "ios-inapp";   // an app's own web view has no "Safari/" token
    if (/CriOS/.test(ua)) return "ios-chrome";
    if (/FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|YaBrowser|Brave/.test(ua)) return "ios-other";
    return "ios-safari";
  }
  if (/Android/.test(ua)) {
    if (IN_APP.test(ua) || /; wv\)/.test(ua)) return "android-inapp";
    if (/SamsungBrowser/.test(ua)) return "android-samsung";
    if (/Firefox\//.test(ua)) return "android-firefox";
    return "android-chrome";   // Chrome, and Edge / Opera / Brave on Android, which fire the one-tap install event too
  }
  if (/Edg\//.test(ua)) return "desktop-edge";
  if (/Firefox\//.test(ua)) return "none";
  if (/Chrome\//.test(ua)) return "desktop-chrome";
  if (/Macintosh/.test(ua) && /Version\/\d+.*Safari\//.test(ua)) return "mac-safari";
  return "none";
}

/* ---------------- when the popup may show by itself ---------------- */

/** After a close it shows by itself again at most once in this many days (owner brief 2026-11-09). */
export const RESHOW_DAYS = 14;
export const RESHOW_MS = RESHOW_DAYS * 86400000;
/** core/storage.js key ("sb:a2hs"): {shownAt, closedAt, never, installedAt} (ms; 0 = never). */
export const MEMORY_KEY = "a2hs";

/**
 * The remembered choices, cleaned (anything unreadable = nothing remembered).
 * @param {unknown} v
 * @returns {{shownAt:number, closedAt:number, never:boolean, installedAt:number}}
 */
export function cleanMemory(v) {
  const o = v && typeof v === "object" ? v : {};
  const t = (x) => (Number.isFinite(x) && x > 0 ? x : 0);
  return { shownAt: t(o.shownAt), closedAt: t(o.closedAt), never: o.never === true, installedAt: t(o.installedAt) };
}

/**
 * Why the popup may not show by itself on this visit ("" = it may). Pure. Settings > Add to Home Screen opens it anyway.
 * @param {{installed?:boolean, demo?:boolean, testOff?:boolean, platform?:string, canPrompt?:boolean,
 *          memory?:object, now?:number}} o
 *   installed: isInstalled now; canPrompt: the browser offered a one-tap install (beforeinstallprompt); memory: cleanMemory
 * @returns {string}
 */
export function autoBlocker({ installed, demo, testOff, platform, canPrompt, memory, now = Date.now() } = {}) {
  const m = cleanMemory(memory);
  if (installed) return "installed";
  if (demo) return "demo";
  if (testOff) return "test";
  if (m.installedAt) return "installed before";
  if (m.never) return "don't show again";
  if (!canPrompt && (!platform || platform === "none")) return "no way to install here";
  const last = Math.max(m.shownAt, m.closedAt);
  if (last && now - last < RESHOW_MS) return "shown recently";
  return "";
}

/**
 * Why a due popup has to wait right now ("" = it may show). Pure. Never at the same moment as the feedback button's
 * ping, never over a trip, the expanded sheet, Settings, a dialog or typing, never on a hidden page.
 * @param {{pageHidden?:boolean, trip?:boolean, sheetFull?:boolean, overlay?:boolean, dialog?:boolean, typing?:boolean, feedbackPing?:boolean}} s
 * @returns {string}
 */
export function waitReason(s = {}) {
  if (s.pageHidden) return "page hidden";
  if (s.trip) return "trip in progress";
  if (s.sheetFull) return "sheet expanded";
  if (s.overlay) return "menu open";
  if (s.dialog) return "dialog open";
  if (s.typing) return "typing";
  if (s.feedbackPing) return "feedback ping";
  return "";
}

let memThisLoad = null;   // when storage cannot keep it (private mode, blocked): remembered for this page load only

/** @returns {{shownAt:number, closedAt:number, never:boolean, installedAt:number}} */
export function loadMemory() {
  return cleanMemory(load(MEMORY_KEY, null) || memThisLoad);
}

/**
 * Remember a change (merged with what is kept). Never throws.
 * @param {{shownAt?:number, closedAt?:number, never?:boolean, installedAt?:number}} patch
 * @returns {{shownAt:number, closedAt:number, never:boolean, installedAt:number}} the new memory
 */
export function rememberInstall(patch) {
  const next = cleanMemory({ ...loadMemory(), ...(patch || {}) });
  memThisLoad = next;
  save(MEMORY_KEY, next);
  return next;
}

/** Tests: forget the page-load fallback. */
export function _resetInstallMemory() {
  memThisLoad = null;
}

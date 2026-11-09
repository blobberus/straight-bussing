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
 */

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

/**
 * @module core/lochelp
 * How to turn location back on, per device and browser (owner 2026-10-12: "the instructions are ambiguous").
 * A browser shows its location popup only while the site's permission is "ask": after a "Don't Allow", or while
 * location is off for websites in the phone's settings, the request fails at once with no popup, and no web page
 * can bring the popup back. So the help names the exact screens for the device in hand (detected from the user
 * agent, only to pick the instructions; nothing is sent anywhere), with the other devices one tap away.
 * Pure data + string functions; rendered by ui/views/settings.js and ui/views/nearby.js. Menu names checked
 * 2026-10-12 against Apple's Location Services guide and current browser menus.
 */

/**
 * Which instructions fit this device.
 * @param {{ua?:string, maxTouchPoints?:number, standalone?:boolean}} [env]
 * @returns {'ios-safari'|'ios-home'|'ios-chrome'|'ios-firefox'|'ios-edge'|'android-chrome'|'android-samsung'|'android-firefox'|'edge'|'chrome'|'firefox'|'mac-safari'|'other'}
 */
export function locPlatform({ ua = "", maxTouchPoints = 0, standalone = false } = {}) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);   // iPadOS asks as a Mac
  if (ios) {
    if (/CriOS/.test(ua)) return "ios-chrome";
    if (/FxiOS/.test(ua)) return "ios-firefox";
    if (/EdgiOS/.test(ua)) return "ios-edge";
    return standalone ? "ios-home" : "ios-safari";
  }
  if (/Android/.test(ua)) return /SamsungBrowser/.test(ua) ? "android-samsung" : /Firefox\//.test(ua) ? "android-firefox" : "android-chrome";
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\//.test(ua)) return "chrome";
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return "mac-safari";
  return "other";
}

/** The current browser's environment for locPlatform (safe outside a browser). */
export function locEnv() {
  if (typeof navigator === "undefined") return {};
  let standalone = navigator.standalone === true;
  try { standalone = standalone || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches); } catch (e) { /* */ }
  return { ua: navigator.userAgent || "", maxTouchPoints: navigator.maxTouchPoints || 0, standalone };
}

const IOS_SYSTEM = [
  'Open the Settings app (the gray gear). Tap "Privacy & Security", then "Location Services". Make sure the "Location Services" switch at the top is on (green).',
];
const iosApp = (app) => [
  ...IOS_SYSTEM,
  `On the same screen, scroll down to the list of apps, tap "${app}" and choose "While Using the App".`,
  `Go back to ${app}, reload this page and tap "Use my location". Allow it if ${app} asks.`,
];

/** Steps per platform: {title, steps[]} (plain text; the views escape and number them). */
export const LOC_STEPS = Object.freeze({
  "ios-safari": { title: "iPhone or iPad with Safari", steps: [
    ...IOS_SYSTEM,
    'On the same screen, scroll down, tap "Safari Websites" and choose "While Using the App". Leave "Precise Location" on, so the nearest stop is right.',
    'Back in Safari, on this page, tap the page menu button at the left end of the address bar (it shows "aA" or a small page icon). Tap "Website Settings", then set "Location" to "Allow".',
    'Reload this page, then tap "Try again" (or "Use my location").',
  ] },
  "ios-home": { title: "iPhone or iPad, Straight Bussing on the Home Screen", steps: [
    ...IOS_SYSTEM,
    'On the same screen, scroll down, tap "Safari Websites" and choose "While Using the App".',
    "A Home Screen app remembers its own answer, and a \"Don't Allow\" sticks. To reset it: touch and hold the Straight Bussing icon, tap \"Remove App\", then \"Delete from Home Screen\". This can also clear the app's saved routes and favorites on this phone.",
    'Open blobberus.github.io/straight-bussing in Safari, tap "Use my location" and allow it. Then add it to the Home Screen again: tap Share, then "Add to Home Screen".',
  ] },
  "ios-chrome": { title: "iPhone or iPad with Chrome", steps: iosApp("Chrome") },
  "ios-firefox": { title: "iPhone or iPad with Firefox", steps: iosApp("Firefox") },
  "ios-edge": { title: "iPhone or iPad with Edge", steps: iosApp("Edge") },
  "android-chrome": { title: "Android with Chrome", steps: [
    'Swipe down from the top of the screen and make sure "Location" is on.',
    'In Chrome, tap the icon at the left end of the address bar (two small sliders or a lock), tap "Permissions", then "Location", and choose "Allow".',
    'Reload this page and tap "Try again" (or "Use my location").',
  ] },
  "android-samsung": { title: "Android with Samsung Internet", steps: [
    'Swipe down from the top of the screen and make sure "Location" is on.',
    'In Samsung Internet, tap the menu (three lines), then "Settings", "Sites and downloads", "Site permissions", "Location". Find blobberus.github.io and allow it.',
    'Reload this page and tap "Try again".',
  ] },
  "android-firefox": { title: "Android with Firefox", steps: [
    'Swipe down from the top of the screen and make sure "Location" is on.',
    'In Firefox, tap the lock at the left end of the address bar, then switch "Location" to allowed.',
    'Reload this page and tap "Try again".',
  ] },
  chrome: { title: "Chrome on a computer", steps: [
    'Click the icon at the left end of the address bar (a lock or two small sliders) and turn "Location" on, or open "Site settings" and set "Location" to "Allow".',
    "Reload this page and click \"Try again\".",
    'Still blocked? On Windows: Settings > Privacy & security > Location, turn on "Location services" and "Let desktop apps access your location". On a Mac: System Settings > Privacy & Security > Location Services, turn on Chrome.',
  ] },
  edge: { title: "Edge on a computer", steps: [
    'Click the icon at the left end of the address bar (a lock or two small sliders), open "Permissions for this site" and set "Location" to "Allow".',
    "Reload this page and click \"Try again\".",
    'Still blocked? On Windows: Settings > Privacy & security > Location, turn on "Location services" and "Let desktop apps access your location".',
  ] },
  firefox: { title: "Firefox on a computer", steps: [
    'Click the icon at the left end of the address bar (a lock, or a crossed-out location pin). Next to "Access your location", click the X to clear the block.',
    'Reload this page, click "Try again" and choose "Allow".',
  ] },
  "mac-safari": { title: "Safari on a Mac", steps: [
    'In the menu bar, choose Safari > Settings, open the "Websites" tab and pick "Location" in the list on the left.',
    'Find blobberus.github.io and set it to "Allow".',
    'If Safari itself is not allowed: System Settings > Privacy & Security > Location Services, turn on Safari. Then reload this page.',
  ] },
  other: { title: "Your browser", steps: [
    "Open your browser's settings for this site (usually the icon at the left end of the address bar) and allow Location.",
    "Make sure location is on for the whole device too, then reload this page.",
  ] },
});

/** Display order of the "different device" list. */
export const LOC_ORDER = Object.freeze(["ios-safari", "ios-home", "ios-chrome", "android-chrome", "android-samsung", "chrome", "edge", "firefox", "mac-safari"]);

/**
 * What the last attempt found, in plain words (GeolocationPositionError codes: 1 denied, 2 unavailable, 3 timeout).
 * @param {{code:number, at:number, n?:number}|null} err n = failed attempts in a row
 * @param {(epochS:number)=>string} clockFn formats a time
 * @returns {string} '' when there was no failed attempt
 */
export function locResultText(err, clockFn) {
  if (!err || !err.at) return "";
  const at = clockFn(Math.round(err.at / 1000)) + (err.n > 1 ? ` (try ${err.n})` : "");
  if (err.code === 1) return `Tried at ${at}: your browser still blocks location for this site, so it did not show a popup. Follow the steps above first, then try again.`;
  if (err.code === 2) return `Tried at ${at}: your device could not find its position. Check that location is on for the whole device, or try again outdoors.`;
  if (err.code === 3) return `Tried at ${at}: finding your position took too long. Try again.`;
  return `Tried at ${at}: your browser could not share your location.`;
}

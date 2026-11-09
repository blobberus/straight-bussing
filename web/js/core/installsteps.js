/**
 * @module core/installsteps
 * The words of the Add to Home Screen popup (owner 2026-11-07/09: "make the top of the notification clearly say: Add
 * this website as a home screen app!. The instructions should use the actual apple safari or chrome symbols to make it
 * as intuitive as possible."): the heading, one honest line on why, and the steps for each browser with the browser's
 * own button glyphs standing in the text ({token} = an icon from ui/icons.js, drawn as a Lucide lookalike because
 * Apple's SF Symbols may not be used on the web). Plain text; ui/install-prompt.js escapes it and draws the icons.
 * Which steps fit the browser in hand: core/install.js installPlatform.
 *
 * Checked 2026-11-09 (sources in docs/ARCHITECTURE.md "Add to Home Screen prompt"): Safari on iOS 26 and later keeps
 * Share behind the More button at the end of the address bar in its default compact layout; its Bottom and Top
 * layouts, and iOS 17 and 18 (bottom toolbar on iPhone, top on iPad), show Share directly. The share sheet may hide
 * "Add to Home Screen" under "View More". iOS 26 adds the "Open as Web App" switch to the last screen, on by default.
 * Chrome on iPhone: Share at the right end of the address bar, then "Add to Home Screen". Chrome on Android: the menu,
 * then "Add to Home screen" or "Install app" (the words differ between versions), then "Install". Samsung Internet: the
 * menu, "Add page to", "Home screen". Chrome on a computer: the install icon at the right end of the address bar, or the
 * menu, "Cast, save, and share", "Install page as app". Edge: "App available" in the address bar, or the menu, "Apps",
 * "Install this site as an app". Safari on a Mac (macOS Sonoma or later): Share or File, "Add to Dock".
 * Where the browser offers its own one-tap install (beforeinstallprompt: Chrome, Edge, Samsung Internet), the popup shows
 * one button instead (installButtonLabel); iPhone and iPad have no such install, so they always get the steps.
 */

/** The popup's heading, exactly the owner's words. */
export const INSTALL_TITLE = "Add this website as a home screen app!";

/** "ios" | "android" | "desktop" | "none" for a core/install.js platform key (the why line, the button, the toast). */
export function platformFamily(platform) {
  const p = String(platform || "");
  if (p.startsWith("ios-")) return "ios";
  if (p.startsWith("android-")) return "android";
  return p.startsWith("desktop-") || p === "mac-safari" ? "desktop" : "none";
}

/** Why add it: one short, honest line per family (notifications only while the app is open or was just used). */
export const INSTALL_WHY = Object.freeze({
  ios: "It opens full screen like an app, one tap from your Home Screen. There, bus alerts can also arrive as notifications (iOS 16.4 or later) while the app is open or was just used.",
  android: "It opens full screen like an app, one tap from your home screen.",
  desktop: "It opens in its own window like an app, one click away.",
  none: "It opens full screen like an app, one tap from your home screen.",
});

/** The why line for a platform key. */
export function whyText(platform) {
  return INSTALL_WHY[platformFamily(platform)] || INSTALL_WHY.none;
}

/** The one-tap button's label (only where the browser offers its own install: Chrome, Edge, Samsung Internet). */
export function installButtonLabel(platform) {
  return platformFamily(platform) === "desktop" ? "Install app" : "Add to Home Screen";
}

/**
 * Icons that stand in the step text, drawn like the browsers' own glyphs. {token} in a step = this icon (a key of
 * ui/icons.js PATHS) with its label as the alternative text.
 */
export const INSTALL_ICONS = Object.freeze({
  share: { icon: "share", label: "Share button" },
  more: { icon: "ellipsis", label: "More button" },
  add: { icon: "square-plus", label: "Add to Home Screen" },
  menu: { icon: "ellipsis-vertical", label: "Menu button" },
  lines: { icon: "menu", label: "Menu button" },
  install: { icon: "monitor-down", label: "Install button" },
  edgeapp: { icon: "apps-plus", label: "App available button" },
});

const WEB_APP_ON = 'If you see "Open as Web App", leave it on. Then tap Add.';

/** Steps per platform: {title, steps[]} (plain text with {icon} tokens). */
export const INSTALL_STEPS = Object.freeze({
  "ios-safari": { title: "iPhone or iPad with Safari", steps: [
    "Tap Share {share}. Don't see it? Tap More {more} next to the address bar first, then Share.",
    'Scroll down and tap Add to Home Screen {add}. Not in the list? Tap "View More" first.',
    WEB_APP_ON,
  ] },
  "ios-chrome": { title: "iPhone or iPad with Chrome", steps: [
    "Tap Share {share} at the right end of the address bar.",
    "Scroll down and tap Add to Home Screen {add}.",
    WEB_APP_ON,
  ] },
  "ios-other": { title: "iPhone or iPad with another browser", steps: [
    "Open the browser's menu and tap Share {share}.",
    "Tap Add to Home Screen {add}, then Add.",
    "Not there? Open this page in Safari and add it from there.",
  ] },
  "ios-inapp": { title: "Inside another app", steps: [
    'This app\'s own browser cannot add pages to the Home Screen. Open its menu (often More {more} or Share {share}) and choose "Open in Safari" or "Open in browser".',
    "In Safari, tap Share {share} (or More {more}, then Share), then Add to Home Screen {add}.",
    WEB_APP_ON,
  ] },
  "android-chrome": { title: "Android with Chrome", steps: [
    "Tap the menu {menu} at the top right.",
    'Tap "Add to Home screen" or "Install app" (the words depend on the Chrome version).',
    'Tap "Install" or "Add".',
  ] },
  "android-samsung": { title: "Android with Samsung Internet", steps: [
    "Tap the menu {lines} at the bottom right.",
    'Tap "Add page to", then "Home screen".',
    'Tap "Add".',
  ] },
  "android-firefox": { title: "Android with Firefox", steps: [
    "Tap the menu {menu}.",
    'Tap "Add to Home screen" or "Add app to Home screen" (look under "More" if you don\'t see it).',
    'Tap "Add".',
  ] },
  "android-inapp": { title: "Inside another app", steps: [
    'This app\'s own browser cannot add pages to the home screen. Open its menu {menu} and choose "Open in Chrome" or "Open in browser".',
    'In Chrome, tap the menu {menu}, then "Add to Home screen" or "Install app".',
  ] },
  "desktop-chrome": { title: "Chrome on a computer", steps: [
    "Click Install {install} at the right end of the address bar.",
    'No icon there? Open the menu {menu}, then "Cast, save, and share", then "Install page as app".',
    'Click "Install".',
  ] },
  "desktop-edge": { title: "Edge on a computer", steps: [
    "Click App available {edgeapp} at the right end of the address bar.",
    'No icon there? Open the menu {more}, then "Apps", then "Install this site as an app".',
    'Click "Install".',
  ] },
  "mac-safari": { title: "Safari on a Mac", steps: [
    'Click Share {share} in the toolbar, then "Add to Dock". Or choose File > Add to Dock (macOS Sonoma or later).',
    'Click "Add".',
  ] },
});

/** Display order of the "different phone or browser" list. */
export const INSTALL_ORDER = Object.freeze(["ios-safari", "ios-chrome", "android-chrome", "android-samsung", "android-firefox", "desktop-chrome", "desktop-edge", "mac-safari"]);

/** The steps for a platform key, or null when there are none (then only the one-tap button can install). */
export function stepsFor(platform) {
  return INSTALL_STEPS[platform] || null;
}

/**
 * A step split into text and icon parts, in order (unknown {tokens} stay text).
 * @param {string} step
 * @returns {Array<{text:string}|{icon:string, label:string}>}
 */
export function stepParts(step) {
  const out = [];
  const re = /\{([a-z]+)\}/g;
  const s = String(step || "");
  let at = 0, m;
  while ((m = re.exec(s))) {
    const ic = INSTALL_ICONS[m[1]];
    if (!ic) continue;
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    out.push({ icon: ic.icon, label: ic.label });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

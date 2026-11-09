// core/installsteps.js: the Add to Home Screen popup's words and steps, with the browsers' own button glyphs in the
// text (owner 2026-11-07/09).
import { test, eq, ok } from "./lib.js";
import {
  INSTALL_TITLE, platformFamily, INSTALL_WHY, whyText, installButtonLabel, INSTALL_ICONS, INSTALL_STEPS, INSTALL_ORDER, stepsFor,
  stepParts,
} from "../js/core/installsteps.js";
import { installPlatform } from "../js/core/install.js";
import { PATHS } from "../js/ui/icons.js";
import { UA } from "./core-install.js";

test("install words: the heading is exactly the owner's words", () => {
  eq(INSTALL_TITLE, "Add this website as a home screen app!");
});

test("install words: family and the honest why line (iPhone: notifications from iOS 16.4, only while open or just used)", () => {
  eq(platformFamily("ios-chrome"), "ios");
  eq(platformFamily("android-samsung"), "android");
  eq(platformFamily("desktop-edge"), "desktop");
  eq(platformFamily("mac-safari"), "desktop");
  eq(platformFamily("none"), "none");
  eq(platformFamily(""), "none");
  eq(platformFamily(), "none");
  ok(/Home Screen/.test(whyText("ios-safari")) && /iOS 16\.4/.test(whyText("ios-safari")), "Home Screen, notifications from iOS 16.4");
  ok(/while the app is open or was just used/.test(INSTALL_WHY.ios), "notifications only while open or just used");
  ok(/full screen like an app/.test(whyText("nothing")), "a fallback line");
  for (const [k, v] of Object.entries(INSTALL_WHY)) {
    ok(!/[–—]/.test(v), k + ": no en or em dash");
    ok(!/UChicago|University|UGo/.test(v), k + ": no university names");
  }
});

test("install words: every {icon} is known, exists in ui/icons.js and has alternative text", () => {
  for (const [k, ic] of Object.entries(INSTALL_ICONS)) {
    ok(PATHS[ic.icon], k + ": icons.js has " + ic.icon);
    ok(ic.label && /button|Home Screen/.test(ic.label), k + ": label " + ic.label);
  }
  eq(INSTALL_ICONS.share, { icon: "share", label: "Share button" });
  eq(INSTALL_ICONS.add.icon, "square-plus");
  eq(INSTALL_ICONS.more.icon, "ellipsis");
  for (const [k, p] of Object.entries(INSTALL_STEPS)) {
    ok(p.title && p.steps.length >= 2, k + ": a title and steps");
    for (const st of p.steps) {
      for (const m of st.matchAll(/\{([a-z]+)\}/g)) ok(INSTALL_ICONS[m[1]], `${k}: {${m[1]}} is a known icon`);
      ok(!/[–—]/.test(st), k + ": no en or em dash: " + st);
      ok(!/•/.test(st) && (st.match(/·/g) || []).length <= 1, k + ": no bullets, at most one middle dot: " + st);
    }
  }
  for (const k of INSTALL_ORDER) ok(INSTALL_STEPS[k], "order lists " + k);
});

test("install words: iPhone Safari steps work on iOS 26 and later (Share behind More) and iOS 17 and 18 (Share in the toolbar)", () => {
  const s = stepsFor("ios-safari").steps.join(" ");
  ok(/^Tap Share \{share\}/.test(s), "Share first, with its icon");
  ok(/Don't see it\? Tap More \{more\} next to the address bar first, then Share/.test(s), "More when Share is hidden (iOS 26 compact layout)");
  ok(/Add to Home Screen \{add\}/.test(s), "Add to Home Screen with the plus-in-a-square icon");
  ok(/View More/.test(s), "View More in the share sheet");
  for (const p of ["ios-safari", "ios-chrome", "ios-other", "ios-inapp"]) {   // owner 2026-11-09: its own step on every iPhone path
    const st = stepsFor(p).steps, i = st.findIndex((x) => /View More/.test(x)), j = st.findIndex((x) => /^Tap Add to Home Screen/.test(x));
    ok(i >= 0 && j === i + 1, `${p}: "View More" is its own step, right before Add to Home Screen`);
  }
  ok(/If you see "Open as Web App", leave it on\. Then tap Add\./.test(s), "Open as Web App stays on, then Add");
  eq(stepsFor("ios-safari").title, "iPhone or iPad with Safari");
  ok(/Share \{share\} at the right end of the address bar/.test(stepsFor("ios-chrome").steps[0]), "Chrome on iPhone: Share in the address bar");
  ok(/Open in Safari/.test(stepsFor("ios-inapp").steps.join(" ")), "inside another app: open it in Safari first");
  ok(/Safari/.test(stepsFor("ios-other").steps.join(" ")), "another iPhone browser: Safari as the way out");
  for (const ua of [UA.iphone, UA.iphone17, UA.ioschrome, UA.iosfirefox, UA.instagram]) ok(stepsFor(installPlatform({ ua })), "steps for " + installPlatform({ ua }));
  eq(stepsFor("nope"), null);
});

test("install words: stepParts splits text and icons in order; unknown tokens stay text", () => {
  eq(stepParts("Tap Share {share}. Then {more}!"), [{ text: "Tap Share " }, { icon: "share", label: "Share button" }, { text: ". Then " }, { icon: "ellipsis", label: "More button" }, { text: "!" }]);
  eq(stepParts("{add}"), [{ icon: "square-plus", label: "Add to Home Screen" }]);
  eq(stepParts("a {nope} b"), [{ text: "a {nope} b" }]);
  eq(stepParts("a {nope} {share}"), [{ text: "a {nope} " }, { icon: "share", label: "Share button" }]);
  eq(stepParts(""), []);
  eq(stepParts(null), []);
});

test("install words: Android and computers: the menu or the install icon, and one button where the browser offers it", () => {
  eq(installButtonLabel("android-chrome"), "Add to Home Screen");
  eq(installButtonLabel("android-samsung"), "Add to Home Screen");
  eq(installButtonLabel("desktop-chrome"), "Install app");
  eq(installButtonLabel("desktop-edge"), "Install app");
  eq(installButtonLabel("none"), "Add to Home Screen");
  ok(/menu \{menu\} at the top right/.test(stepsFor("android-chrome").steps[0]), "Chrome on Android: the upright three dots");
  ok(/Add to Home screen.*Install app/.test(stepsFor("android-chrome").steps[1]), "then Add to Home screen or Install app");
  ok(/menu \{lines\}/.test(stepsFor("android-samsung").steps[0]) && /Add page to.*Home screen/.test(stepsFor("android-samsung").steps[1]), "Samsung Internet");
  ok(/Install \{install\} at the right end of the address bar/.test(stepsFor("desktop-chrome").steps[0]), "desktop Chrome: the install icon");
  ok(/Install page as app/.test(stepsFor("desktop-chrome").steps[1]), "or the menu");
  ok(/App available \{edgeapp\}/.test(stepsFor("desktop-edge").steps[0]) && /Install this site as an app/.test(stepsFor("desktop-edge").steps[1]), "Edge");
  ok(/Add to Dock/.test(stepsFor("mac-safari").steps[0]), "Safari on a Mac: Add to Dock");
  ok(/Open in Chrome/.test(stepsFor("android-inapp").steps[0]), "inside another Android app: open it in Chrome first");
  eq(stepsFor("none"), null, "Firefox on a computer: no steps (it cannot install)");
  for (const k of ["android", "desktop"]) ok(INSTALL_WHY[k] && !/notification/i.test(INSTALL_WHY[k]), k + ": a why line without promises about notifications");
  for (const ua of [UA.android, UA.samsung, UA.androidfirefox, UA.androidwv, UA.chrome, UA.macchrome, UA.edge]) ok(stepsFor(installPlatform({ ua })), "steps for " + installPlatform({ ua }));
  ok(stepsFor(installPlatform({ ua: UA.mac, maxTouchPoints: 0 })), "steps for a Mac");
  eq(INSTALL_ORDER.length, 8, "the fold lists the eight common browsers");
});

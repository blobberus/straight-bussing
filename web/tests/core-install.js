// core/install.js: is this page the installed app, and which install steps fit the browser (owner 2026-11-07/09: the
// Add to Home Screen popup shows only outside the installed app).
import { test, eq, ok } from "./lib.js";
import { INSTALLED_MODES, isInstalled, installEnv, installedNow, installPlatform } from "../js/core/install.js";

export const UA = Object.freeze({
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
  iphone17: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
  ioschrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1",
  iosfirefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15",
  iosedge: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 EdgiOS/141.0 Mobile/15E148 Safari/605.1.15",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0 (iPhone16,2; iOS 26_1; en_US)",
  webview: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  gsa: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/390.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 15; SM-S931U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  androidfirefox: "Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0",
  androidwv: "Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
  macchrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
});

test("install: installed = navigator.standalone or an installed display mode; a browser tab is not", () => {
  ok(isInstalled({ standalone: true }), "iPhone Safari's Home Screen app");
  for (const m of ["standalone", "fullscreen", "minimal-ui"]) ok(isInstalled({ displayMode: m }), m);
  ok(INSTALLED_MODES.includes("window-controls-overlay"), "desktop window controls overlay counts too");
  ok(!isInstalled({ displayMode: "browser" }), "a browser tab");
  ok(!isInstalled({}), "nothing known");
  ok(!isInstalled(), "no argument");
  ok(!isInstalled({ standalone: "true" }), "only the real true counts");
});

test("install: installEnv reads navigator and the display mode, never throws", () => {
  const mm = (mode) => (q) => ({ matches: q === `(display-mode: ${mode})` });
  eq(installEnv({ userAgent: UA.iphone, maxTouchPoints: 5, standalone: true }, mm("browser")),
    { ua: UA.iphone, maxTouchPoints: 5, standalone: true, displayMode: "browser" });
  eq(installEnv({ userAgent: UA.android }, mm("standalone")).displayMode, "standalone");
  eq(installEnv({ userAgent: UA.android }, mm("minimal-ui")).displayMode, "minimal-ui");
  eq(installEnv(null, null), { ua: "", maxTouchPoints: 0, standalone: false, displayMode: "browser" }, "outside a browser");
  eq(installEnv({ get userAgent() { throw new Error("x"); } }, () => { throw new Error("y"); }).displayMode, "browser", "a throwing navigator");
  eq(typeof installEnv().ua, "string", "this browser");
  ok(!isInstalled(installEnv()), "the test page is a browser tab");
  ok(!installedNow(), "installedNow agrees");
});

test("install: steps per browser from the user agent (iPadOS asks as a Mac)", () => {
  eq(installPlatform({ ua: UA.iphone }), "ios-safari");
  eq(installPlatform({ ua: UA.iphone17 }), "ios-safari", "iOS 17");
  eq(installPlatform({ ua: UA.ipad, maxTouchPoints: 5 }), "ios-safari", "iPad");
  eq(installPlatform({ ua: UA.ioschrome }), "ios-chrome");
  eq(installPlatform({ ua: UA.iosfirefox }), "ios-other");
  eq(installPlatform({ ua: UA.iosedge }), "ios-other");
  eq(installPlatform({ ua: UA.instagram }), "ios-inapp", "Instagram's browser");
  eq(installPlatform({ ua: UA.webview }), "ios-inapp", "an app's web view (no Safari token)");
  eq(installPlatform({ ua: UA.gsa }), "ios-inapp", "the Google app");
  eq(installPlatform({ ua: UA.android }), "android-chrome");
  eq(installPlatform({ ua: UA.samsung }), "android-samsung");
  eq(installPlatform({ ua: UA.androidfirefox }), "android-firefox");
  eq(installPlatform({ ua: UA.androidwv }), "android-inapp", "an Android web view");
  eq(installPlatform({ ua: UA.chrome }), "desktop-chrome");
  eq(installPlatform({ ua: UA.macchrome }), "desktop-chrome");
  eq(installPlatform({ ua: UA.edge }), "desktop-edge");
  eq(installPlatform({ ua: UA.mac, maxTouchPoints: 0 }), "mac-safari");
  eq(installPlatform({ ua: UA.firefox }), "none", "Firefox on a computer cannot install");
  eq(installPlatform({ ua: "" }), "none");
  eq(installPlatform(), "none");
});

test("install: the location help and the usage statistics use the same check (one rule for 'installed')", async () => {
  const lochelp = await (await fetch("../js/core/lochelp.js", { cache: "no-store" })).text();
  const usage = await (await fetch("../js/data/usage.js", { cache: "no-store" })).text();
  ok(/from "\.\/install\.js"/.test(lochelp) && /isInstalled\(env\)/.test(lochelp), "core/lochelp.js locEnv uses isInstalled");
  ok(/from "\.\.\/core\/install\.js"/.test(usage) && /isInstalled\(installEnv\(/.test(usage), "data/usage.js appKind uses isInstalled");
  ok(!/display-mode: standalone/.test(lochelp + usage), "no second, narrower display-mode check left");
});

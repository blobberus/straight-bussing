// The Add to Home Screen prompt in the REAL app (install.test.html; owner 2026-11-07/09): index.html + js/main.js in an
// iframe with the e2e stubs (fake live feed, no location), a user agent / Home Screen state of our choosing, and a
// stubbed beforeinstallprompt where a test needs the browser's own one-tap install. Same-origin iframes share this
// page's sessionStorage and localStorage, so the test seam and the remembered choices are set from here.
import { test, eq, ok } from "./lib.js";
import { MEMORY_KEY } from "../js/core/install.js";

export const MEM = "sb:" + MEMORY_KEY;
/** The app's timings, shortened (this runner's page has 30 s of virtual time in all): shows 300 ms after the feed answered. */
const FAST = { showAfterMs: 300, maxWaitMs: 1500, retryMs: 150 };
const PAST_SHOW = 1200;   // well past the moment it would show
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, what, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(25);
  }
}

/**
 * The real app in a new iframe.
 * @param {{ua?:string, standalone?:boolean, displayMode?:string, style?:string, query?:string, before?:string}} [o]
 *   ua: navigator.userAgent; standalone: navigator.standalone; displayMode: the matching display-mode media query;
 *   before: extra classic script run before the app (e.g. a stubbed install event)
 */
export async function openApp(o = {}) {
  const html = await (await fetch("../index.html", { cache: "no-store" })).text();
  const base = new URL("../", location.href).href;
  const env = `<script>(function(){var n=navigator;`
    + (o.ua ? `Object.defineProperty(n,"userAgent",{get:function(){return ${JSON.stringify(o.ua)};},configurable:true});` : "")
    + (o.standalone ? `Object.defineProperty(n,"standalone",{get:function(){return true;},configurable:true});` : "")
    + (o.displayMode ? `var mm=window.matchMedia.bind(window);window.matchMedia=function(q){if(/display-mode/.test(q)){var on=q.indexOf(${JSON.stringify(o.displayMode)})>=0;return{matches:on,media:q,addEventListener:function(){},removeEventListener:function(){},addListener:function(){},removeListener:function(){}};}return mm(q);};` : "")
    + `})();${o.before || ""}</script>`;
  let page = html.replace(/<head>/i, `<head><base href="${base}"><script src="tests/e2e-stubs.js"></script>${env}`);
  page = page.replace(/<script type="module" src="js\/main\.js[^"]*"><\/script>/,
    (m) => `<script type="module">import { store } from "./js/state.js"; import { bus } from "./js/core/events.js"; import { installTimings } from "./js/ui/install-prompt.js";`
      + ` window.__st = store; window.__bus = bus; Object.assign(installTimings, ${JSON.stringify(FAST)});</script>${m}`);
  if (!page.includes("window.__st")) throw new Error("js/main.js <script> tag not found in index.html");
  const f = document.createElement("iframe");
  f.style.cssText = o.style || "width:393px;height:852px;border:0;display:block";
  document.body.appendChild(f);
  f.contentDocument.open();
  f.contentDocument.write(page);
  f.contentDocument.close();
  const w = f.contentWindow, d = w.document;
  await waitFor(() => w.__st && w.__st.get().staticLoaded && d.getElementById("app").dataset.view === "nearby", "the app rendered");
  return { f, w, d };
}

/** A stand-in for Chrome's BeforeInstallPromptEvent: prompt() resolves userChoice with `outcome`. */
export const FAKE_BIP = (outcome) => `window.__bipCalls=0;window.__fireBip=function(){var e=new Event("beforeinstallprompt",{cancelable:true});`
  + `var res;e.userChoice=new Promise(function(r){res=r;});e.prompt=function(){window.__bipCalls++;setTimeout(function(){res({outcome:${JSON.stringify(outcome)},platform:"web"});},10);return Promise.resolve();};`
  + `window.__bip=e;window.dispatchEvent(e);return e;};`;

test("real app: the browser's install offer is kept for the popup (no mini-infobar), an install is remembered for good", async () => {
  const saved = localStorage.getItem(MEM);
  localStorage.removeItem(MEM);
  let v = null;
  try {
    v = await openApp({ before: FAKE_BIP("accepted") });
    const { w } = v;
    let offers = 0, dones = 0;
    w.__bus.on("install:offer", () => offers++);
    w.__bus.on("install:done", () => dones++);
    const e = w.__fireBip();
    ok(e.defaultPrevented, "beforeinstallprompt: preventDefault (the app shows its own button)");
    eq(offers, 1, "announced on the app bus");
    eq(localStorage.getItem(MEM), null, "an offer alone stores nothing");
    w.dispatchEvent(new w.Event("appinstalled"));
    eq(dones, 1, "appinstalled announced");
    const mem = JSON.parse(localStorage.getItem(MEM) || "{}");
    ok(mem.installedAt > Date.now() - 60000, "installed: remembered in sb:a2hs (the popup never shows again in this browser)");
    eq(w.__e2e.errors, [], "no console errors");
  } finally {
    v?.f.remove();
    if (saved === null) localStorage.removeItem(MEM); else localStorage.setItem(MEM, saved);
  }
});

test("real app, ?demo=1: the browser's install offer is left alone (no popup in demo mode)", async () => {
  const f = document.createElement("iframe");
  f.style.cssText = "width:393px;height:852px;border:0;display:block";
  f.src = "../index.html?demo=1";
  document.body.appendChild(f);
  try {
    const w = f.contentWindow;
    await waitFor(() => w.document && w.document.getElementById("app")?.dataset.view === "nearby", "the demo app rendered");
    await sleep(300);
    const e = new w.Event("beforeinstallprompt", { cancelable: true });
    w.dispatchEvent(e);
    ok(!e.defaultPrevented, "not prevented in demo mode");
  } finally { f.remove(); }
});

test("Settings > Add to Home Screen: a quiet row outside the installed app (never in it, never in demo mode)", async () => {
  const { a2hsRowHTML, A2HS_ROW, renderSettings } = await import("../js/ui/views/settings.js");
  const d = document.createElement("div");
  d.innerHTML = a2hsRowHTML(false);
  const row = d.querySelector('button.v-row[data-action="install:open"]');
  ok(row, "a row button that runs install:open");
  eq(row.querySelector(".v-prim").textContent, A2HS_ROW);
  eq(A2HS_ROW, "Add to Home Screen");
  eq(row.getAttribute("aria-haspopup"), "dialog");
  eq(a2hsRowHTML(true), "", "installed app: no row");
  const s = document.createElement("div");
  s.innerHTML = renderSettings({ notify: {}, stops: {}, routes: {}, alerts: [] });
  const rows = [...s.querySelectorAll(".v-card > .v-row")].map((b) => b.dataset.action || b.dataset.st);
  ok(rows.indexOf("install:open") >= 0 && rows.indexOf("install:open") === rows.indexOf("about:open") - 1, "in Settings, right above About: " + rows.join(","));
});

test("real app: Settings > Add to Home Screen closes Settings and opens the popup (focus on its heading); Close goes back to Settings' circle", async () => {
  sessionStorage.setItem("sb-a2hs-off", "1");   // the seam: it never shows by itself here, Settings opens it anyway
  let v = null;
  try {
    v = await openApp({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1" });
    const { w, d } = v;
    d.getElementById("settingsBtn").click();
    const row = await waitFor(() => d.querySelector('#settingsOverlay[data-state="open"] [data-action="install:open"]'), "the Settings row");
    row.click();
    const card = await waitFor(() => d.querySelector('#a2hs[data-state="open"]'), "the popup");
    await waitFor(() => d.getElementById("settingsOverlay").dataset.state === "closed", "Settings closed");
    eq(d.activeElement && d.activeElement.id, "a2hsTitle", "focus on its heading");
    eq(card.dataset.platform, "ios-safari", "iPhone Safari steps for this user agent");
    card.querySelector('[data-a2hs="close"]').click();
    ok(card.hidden, "closed");
    eq(d.activeElement && d.activeElement.id, "settingsBtn", "focus back on Settings' circle");
    eq(w.__e2e.errors, [], "no console errors");
  } finally {
    v?.f.remove();
    localStorage.removeItem(MEM);
  }
});

test("real app opened from the home screen: no popup and no Settings row", async () => {
  sessionStorage.removeItem("sb-a2hs-off");
  localStorage.removeItem(MEM);
  let v = null;
  try {
    v = await openApp({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1", standalone: true });
    const { w, d } = v;
    await waitFor(() => w.__st.get().liveLoaded, "live data");
    await sleep(PAST_SHOW);   // past SHOW_AFTER_MS
    eq(d.getElementById("a2hs"), null, "no popup in the Home Screen app");
    d.getElementById("settingsBtn").click();
    await waitFor(() => d.querySelector('#settingsOverlay[data-state="open"] [data-action="about:open"]'), "Settings");
    eq(d.querySelector('#settingsOverlay [data-action="install:open"]'), null, "no Add to Home Screen row");
    eq(localStorage.getItem(MEM), null, "nothing stored");
  } finally { v?.f.remove(); sessionStorage.setItem("sb-a2hs-off", "1"); }
});

/* ---------- the popup in the real app ---------- */
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const DAY = 86400000;
/** A first visit in this browser: nothing remembered, the seam off. */
function fresh() {
  localStorage.removeItem(MEM);
  sessionStorage.removeItem("sb-a2hs-off");
}
const openCard = (d) => d.querySelector('#a2hs[data-state="open"]');
/** WCAG contrast of two CSS colors (rgb / rgba over the second). */
function contrast(fg, bg) {
  const p = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const [a, b] = [lum(p(fg)), lum(p(bg))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("real app, iPhone Safari, first visit: the popup shows after the live feed answered, with the Safari steps, where it covers nothing", async () => {
  fresh();
  let v = null;
  try {
    v = await openApp({ ua: IPHONE });
    const { w, d } = v, $ = (id) => d.getElementById(id);
    await waitFor(() => w.__st.get().liveLoaded, "live data");
    eq(openCard(d), null, "not at once: the next bus comes first");
    const card = await waitFor(() => openCard(d), "the popup", 4000);
    eq(card.querySelector("h2").textContent, "Add this website as a home screen app!");
    eq(card.dataset.platform, "ios-safari");
    eq([...card.querySelectorAll(".a2hs-for + ol .a2hs-glyph")].map((g) => g.getAttribute("aria-label")), ["Share button", "More button", "Add to Home Screen"]);
    eq(card.querySelector('[data-a2hs="install"]'), null, "no button on iPhone");
    eq(card.querySelector('[data-a2hs="close"]').getAttribute("aria-label"), "Close");
    card.style.animation = "none";   // its resting place (the entrance moves it 8 px; this runner draws no animation frames)
    const C = card.getBoundingClientRect(), G = $("settingsBtn").getBoundingClientRect(), F = $("feedbackBtn").getBoundingClientRect();
    const S = $("sheet").querySelector(".sheet-bg").getBoundingClientRect(), A = $("app").getBoundingClientRect();
    ok(C.right + 8 <= G.left + 0.5, "leaves the Settings / feedback column free");
    ok(C.top >= G.top - 0.5, "starts at Row B (under the status banner's row)");
    ok(C.bottom + 8 <= S.top + 0.5, `stops above the collapsed sheet with the next bus (${Math.round(C.bottom)} vs ${Math.round(S.top)})`);
    ok(C.left >= A.left + 11, "12 from the edge");
    eq(d.elementFromPoint(G.left + G.width / 2, G.top + G.height / 2)?.closest("#settingsBtn"), $("settingsBtn"), "Settings stays tappable");
    if (!$("feedbackBtn").hidden) eq(d.elementFromPoint(F.left + F.width / 2, F.top + F.height / 2)?.closest("#feedbackBtn"), $("feedbackBtn"), "the feedback circle too");
    const cs = w.getComputedStyle(card);
    eq(cs.backdropFilter === "none" || !cs.backdropFilter, true, "solid: no blur (glass spec 12.1 budget)");
    for (const el of [card.querySelector("h2"), card.querySelector(".a2hs-why"), card.querySelector(".a2hs-steps li"), card.querySelector('[data-a2hs="never"]')]) {
      const r = contrast(w.getComputedStyle(el).color, cs.backgroundColor);
      ok(r >= 4.5, `${el.className || el.tagName}: contrast ${r.toFixed(2)} >= 4.5`);
    }
    const x = card.querySelector('[data-a2hs="close"]').getBoundingClientRect();
    ok(x.width >= 44 && x.height >= 44, "Close is a 44 target");
    ok(d.activeElement === d.body || !card.contains(d.activeElement), "no focus taken");
    ok(JSON.parse(localStorage.getItem(MEM)).shownAt > Date.now() - 60000, "shownAt remembered");
    eq(w.__e2e.errors, [], "no console errors");
  } finally { v?.f.remove(); }
});

test("real app: a stale-feed banner pushes the popup down with Row B (never covered); the expanded sheet hides it", async () => {
  fresh();
  let v = null;
  try {
    v = await openApp({ ua: IPHONE });
    const { w, d } = v, $ = (id) => d.getElementById(id);
    const card = await waitFor(() => openCard(d), "the popup", 4000);
    w.__e2e.feedFail = true;
    w.dispatchEvent(new w.Event("online"));
    await waitFor(() => !$("pill").hidden && $("pill").dataset.form !== "chip", "the status banner", 4000);
    $("app").style.setProperty("--pill-h", $("pill").offsetHeight + "px");   // pill.js measures it (no ResizeObserver notes under virtual time)
    card.style.animation = "none";
    await sleep(100);
    ok(card.getBoundingClientRect().top >= $("pill").getBoundingClientRect().bottom - 0.5, "under the banner: a stale feed stays visible");
    w.__e2e.feedFail = false;
    $("sheet").dataset.detent = "full";
    card.style.transition = "none";
    eq(w.getComputedStyle(card).visibility, "hidden", "hidden while the sheet is expanded");
    $("sheet").dataset.detent = "peek";
    eq(w.getComputedStyle(card).visibility, "visible", "back when it comes down");
  } finally { if (v) { v.w.__e2e.feedFail = false; v.f.remove(); } }
});

test("real app: Close, then a reload the same day and 13 days later show nothing; 15 days later it asks once more", async () => {
  fresh();
  let v = null;
  try {
    v = await openApp({ ua: IPHONE });
    let card = await waitFor(() => openCard(v.d), "the popup", 4000);
    card.querySelector('[data-a2hs="close"]').click();
    ok(card.hidden, "closed");
    await waitFor(() => !v.d.getElementById("toast").classList.contains("hide") && /stays in Settings/.test(v.d.getElementById("toast").textContent), "the toast says where it stays");
    v.f.remove();
    v = await openApp({ ua: IPHONE });
    await waitFor(() => v.w.__st.get().liveLoaded, "live data");
    await sleep(PAST_SHOW);
    eq(openCard(v.d), null, "a reload: nothing");
    v.f.remove();
    const m = JSON.parse(localStorage.getItem(MEM));
    localStorage.setItem(MEM, JSON.stringify({ ...m, shownAt: Date.now() - 13 * DAY, closedAt: Date.now() - 13 * DAY }));
    v = await openApp({ ua: IPHONE });
    await waitFor(() => v.w.__st.get().liveLoaded, "live data");
    await sleep(PAST_SHOW);
    eq(openCard(v.d), null, "13 days later: nothing");
    v.f.remove();
    localStorage.setItem(MEM, JSON.stringify({ ...m, shownAt: Date.now() - 15 * DAY, closedAt: Date.now() - 15 * DAY }));
    v = await openApp({ ua: IPHONE });
    card = await waitFor(() => openCard(v.d), "15 days after the close: the popup once more", 4000);
  } finally { v?.f.remove(); }
});

test("real app: Don't show again, then no popup on any later visit", async () => {
  fresh();
  let v = null;
  try {
    v = await openApp({ ua: IPHONE });
    const card = await waitFor(() => openCard(v.d), "the popup", 4000);
    card.querySelector('[data-a2hs="never"]').click();
    ok(card.hidden, "closed");
    eq(JSON.parse(localStorage.getItem(MEM)).never, true, "remembered");
    v.f.remove();
    localStorage.setItem(MEM, JSON.stringify({ ...JSON.parse(localStorage.getItem(MEM)), shownAt: Date.now() - 400 * DAY, closedAt: Date.now() - 400 * DAY }));
    v = await openApp({ ua: IPHONE });
    await waitFor(() => v.w.__st.get().liveLoaded, "live data");
    await sleep(PAST_SHOW);
    eq(openCard(v.d), null, "a year later: still nothing");
  } finally { v?.f.remove(); }
});

test("real app, Chrome on a computer: the browser's install offer becomes ONE button; accepted = installed, never again", async () => {
  fresh();
  let v = null;
  try {
    v = await openApp({ ua: CHROME, before: FAKE_BIP("accepted") });
    v.w.__fireBip();
    const card = await waitFor(() => openCard(v.d), "the popup", 4000);
    eq(card.dataset.platform, "desktop-chrome");
    const b = card.querySelector('[data-a2hs="install"]');
    ok(b, "the one-tap button");
    eq(b.textContent, "Install app");
    eq(card.querySelectorAll(".v-btn--primary").length, 1, "one primary action");
    eq(card.querySelector(".a2hs-for"), null, "the steps are folded away");
    b.click();
    eq(v.w.__bipCalls, 1, "the browser's own install dialog, from the tap");
    await waitFor(() => !openCard(v.d), "closed after the install");
    v.w.dispatchEvent(new v.w.Event("appinstalled"));
    ok(JSON.parse(localStorage.getItem(MEM)).installedAt > 0, "installed: remembered");
    v.f.remove();
    v = await openApp({ ua: CHROME, before: FAKE_BIP("accepted") });
    v.w.__fireBip();
    await waitFor(() => v.w.__st.get().liveLoaded, "live data");
    await sleep(PAST_SHOW);
    eq(openCard(v.d), null, "never again in this browser");
  } finally { v?.f.remove(); }
});

test("real app: never during a trip, never in demo mode, never under the tests' seam", async () => {
  fresh();
  let v = null, f = null;
  try {
    v = await openApp({ ua: IPHONE });
    v.w.__st.set({ journey: { kind: "plan", plan: null } });
    await waitFor(() => v.w.__st.get().liveLoaded, "live data");
    await sleep(PAST_SHOW);
    eq(openCard(v.d), null, "a trip in progress: it waits");
    eq(localStorage.getItem(MEM), null, "nothing remembered while it waits");
    v.f.remove(); v = null;
    sessionStorage.setItem("sb-a2hs-off", "1");
    v = await openApp({ ua: IPHONE });
    await waitFor(() => v.w.__st.get().liveLoaded, "live data");
    await sleep(PAST_SHOW);
    eq(openCard(v.d), null, "the tests' seam");
    v.f.remove(); v = null;
    fresh();
    f = document.createElement("iframe");
    f.style.cssText = "width:393px;height:852px;border:0;display:block";
    f.src = "../index.html?demo=1";
    document.body.appendChild(f);
    await waitFor(() => f.contentWindow.document?.getElementById("app")?.dataset.view === "nearby", "the demo app");
    await sleep(PAST_SHOW);
    eq(f.contentWindow.document.getElementById("a2hs"), null, "demo mode: never");
  } finally { v?.f.remove(); f?.remove(); sessionStorage.setItem("sb-a2hs-off", "1"); localStorage.removeItem(MEM); }
});

test("privacy: privacy.html lists the popup's memory as a setting kept on the device, and says nothing about it is sent", async () => {
  const page = (await (await fetch("../privacy.html", { cache: "no-store" })).text()).replace(/\s+/g, " ");
  ok(page.includes("on the web also when the &ldquo;Add this website as a home screen app!&rdquo; popup last appeared, when you closed it, and whether you chose &ldquo;Don&rsquo;t show again&rdquo; or installed the app from this browser"), "the memory, in Your settings");
  ok(page.includes("reads which browser and device this is, on your device only; that and your install choice are never sent"), "the user agent stays on the device");
  ok(/Effective November (9|[12]\d|30), 2026\./.test(page), "an effective date on or after the change");
});

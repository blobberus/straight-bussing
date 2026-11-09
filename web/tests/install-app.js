// The Add to Home Screen prompt in the REAL app (install.test.html; owner 2026-11-07/09): index.html + js/main.js in an
// iframe with the e2e stubs (fake live feed, no location), a user agent / Home Screen state of our choosing, and a
// stubbed beforeinstallprompt where a test needs the browser's own one-tap install. Same-origin iframes share this
// page's sessionStorage and localStorage, so the test seam and the remembered choices are set from here.
import { test, eq, ok } from "./lib.js";
import { MEMORY_KEY } from "../js/core/install.js";

export const MEM = "sb:" + MEMORY_KEY;
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
    (m) => `<script type="module">import { store } from "./js/state.js"; import { bus } from "./js/core/events.js"; window.__st = store; window.__bus = bus;</script>${m}`);
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

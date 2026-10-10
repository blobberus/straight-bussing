/*
 * Demo mode end to end (demo.test.html): the REAL app at index.html?demo=1 in an iframe, no stubs. Checks the
 * persistent banner on every screen, simulated buses everywhere, that the live Passio feed is never fetched,
 * that nothing is stored (localStorage untouched) and that bus alerts are off. Tests share one app instance.
 */
import { test, eq, ok, holdRun, run } from "./lib.js";

holdRun();
let F = null, W = null, D = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 6000) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(25);
  }
}
const $ = (s) => D.querySelector(s);
const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
const store = () => W.__demoStore;
const title = () => txt($("#title"));
const tab = (id) => $(`#tabs button[data-tab="${id}"]`).click();
/** The banner is visible, on top of whatever is at its center, and the search bar / pill sit below it. */
function bannerOnTop(where) {
  const b = $("#demobar"), r = b.getBoundingClientRect();
  ok(r.height >= 30 && r.width > 300 && W.getComputedStyle(b).visibility === "visible", where + ": banner visible");
  const hit = D.elementFromPoint(r.left + 40, r.top + r.height / 2);
  ok(hit && b.contains(hit), where + ": banner on top (" + (hit && hit.className) + ")");
  ok(txt(b).includes("Demo mode: simulated buses"), where + ": banner words");
}
const passioRequests = () => W.performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /passio3\.com/.test(u));

async function boot() {
  localStorage.setItem("sb:hiddenRoutes", JSON.stringify([]));
  F = document.createElement("iframe");
  F.style.cssText = "width:500px;height:900px;border:0";
  F.src = "../index.html?demo=1";
  document.body.appendChild(F);
  await new Promise((r) => F.addEventListener("load", r, { once: true }));
  W = F.contentWindow; D = W.document;
  const s = D.createElement("script");   // the app's own store instance (same module URL as main.js imports)
  s.type = "module";
  s.textContent = 'import { store } from "./js/state.js"; window.__demoStore = store;';
  D.head.appendChild(s);
  await waitFor(() => store() && store().get().staticLoaded && store().get().buses.length > 0, "simulated buses in the store", 20000);
}

test("demo: banner first in #app, words, Exit demo link drops only ?demo=1", () => {
  const b = $("#demobar");
  ok(b && $("#app").firstElementChild === b, "first in the document order");
  eq([b.getAttribute("role"), b.getAttribute("aria-label")], ["region", "Demo mode"]);
  const a = b.querySelector("a.demobar-exit");
  ok(a && /Exit demo/.test(txt(a)), "exit link");
  const u = new URL(a.href);
  ok(!u.searchParams.has("demo") && u.pathname === W.location.pathname, "exit link goes to the same page, live: " + a.href);
  ok(D.documentElement.classList.contains("is-demo"), "layout offset on");
  ok($("#topbar").getBoundingClientRect().top >= b.getBoundingClientRect().bottom, "search bar below the banner");
  bannerOnTop("Current trip");
});

test("demo: simulated buses everywhere, the live feed is never fetched, no stale pill", async () => {
  const s = store().get();
  ok(s.buses.length >= 1 && s.buses.every((b) => String(b.vehicle.id).startsWith("demo-")), "only simulated vehicles: " + s.buses.length);
  ok(s.liveLoaded && !s.failed && s.lastOk > 0, "feed state like a healthy live feed");
  eq(passioRequests(), [], "no request to passio3.com");
  ok($("#pill").hidden, "fresh simulated feed: no status pill");
  await waitFor(() => $("#map .sb-busicon"), "bus markers on the map");
  const tok = (el, k) => W.getComputedStyle(el).getPropertyValue(k).trim().toLowerCase();
  const dark = $("#map").classList.contains("sb-dark");
  eq(tok($("#map"), "--sb-accent"), tok(D.documentElement, dark ? "--accent" : "--accent-fill"), "map blue = the UI accent token (" + (dark ? "dark" : "light") + ")");
  const al = await waitFor(() => $('#content [data-region="nearby-alert"]') && txt($('#content [data-region="nearby-alert"]')).includes("Demo mode") && $('#content [data-region="nearby-alert"]'), "demo service alert on Current trip");
  ok(txt(al).includes("Demo mode: simulated buses"), txt(al));
});

test("demo: banner stays on Routes (buses running), route detail, My Routes and over Settings", async () => {
  tab("routes");
  await waitFor(() => title() === "Routes" && /bus(es)? running/.test(txt($("#content"))), "Routes with running buses");
  bannerOnTop("Routes");
  $('#content [data-action="route:open"]').click();
  await waitFor(() => store().get().view === "route" && $("#content .v-tl"), "route detail");
  bannerOnTop("Route detail");
  tab("myroutes");
  await waitFor(() => title() === "My Routes", "My Routes");
  bannerOnTop("My Routes");
  $("#settingsBtn").click();
  const o = await waitFor(() => { const x = $("#settingsOverlay"); return x && !x.hidden && x.dataset.state === "open" ? x : null; }, "Settings open");
  bannerOnTop("Settings");
  ok(txt(o).includes("Bus alerts are off in demo mode"), "Settings says bus alerts are off");
  o.querySelector(".sto-done").click();
  await waitFor(() => o.dataset.state === "closed", "Settings closed");
});

test("demo: nothing is stored (a route hidden in the demo is not saved), and nothing breaks", async () => {
  tab("routes");
  const eye = await waitFor(() => $('#content [data-action="routes:toggle"]'), "eye toggle");
  const rid = eye.dataset.id;
  eye.click();
  await waitFor(() => store().get().hiddenRoutes.includes(rid), "hidden in the session");
  await sleep(50);
  eq(localStorage.getItem("sb:hiddenRoutes"), "[]", "localStorage untouched");
  eq(passioRequests(), [], "still no live feed request");
});

boot().then(() => run(), (e) => {
  test("demo boot", () => { throw e; });
  run();
});

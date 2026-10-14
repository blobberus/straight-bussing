/*
 * Demo mode end to end (demo.test.html): the REAL app at index.html?demo=1 in an iframe, no stubs. Owner decision
 * 2026-10-11: no banner; the status pill reads "Simulated buses" on every screen and tapping it explains, with a
 * way back to live buses (reload without ?demo=1). Also checks simulated buses everywhere, that the live Passio
 * feed is never fetched, that nothing is stored (localStorage untouched) and that bus alerts are off.
 * Tests share one app instance.
 */
import { test, eq, ok, holdRun, run } from "./lib.js";
import { WELCOME_KEY } from "../js/ui/feedback.js";

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
/** The demo pill is visible with its words, and it (not the map) takes a tap at its middle. */
function pillOn(where) {
  const p = $("#pill"), r = p.getBoundingClientRect();
  ok(!p.hidden && r.height >= 44 && r.width > 200 && W.getComputedStyle(p).visibility === "visible", where + ": pill visible");
  eq(txt($("#pillText")), "Simulated buses", where + ": pill words");
  const hit = D.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  ok(hit && hit.closest('[data-action="demo:info"]'), where + ": the whole pill is the button (" + (hit && hit.className) + ")");
}
const passioRequests = () => W.performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /passio3\.com/.test(u));
const dialog = () => D.querySelector("dialog.v-confirm[open]");

async function boot() {
  localStorage.setItem("sb:hiddenRoutes", JSON.stringify([]));
  sessionStorage.setItem(WELCOME_KEY, "1");   // test seam: the beta welcome popup counts as seen (feedback.test.html covers it)
  F = document.createElement("iframe");
  F.style.cssText = "width:500px;height:900px;border:0";
  F.src = "../index.html?demo=1";
  document.body.appendChild(F);
  await new Promise((r) => F.addEventListener("load", r, { once: true }));
  W = F.contentWindow; D = W.document;
  const s = D.createElement("script");   // the app's own module instances (same URLs as main.js imports)
  s.type = "module";
  s.textContent = 'import { store } from "./js/state.js"; import * as demo from "./js/ui/demo.js"; window.__demoStore = store; window.__demoUI = demo;';
  D.head.appendChild(s);
  await waitFor(() => store() && store().get().staticLoaded && store().get().buses.length > 0 && W.__demoUI, "simulated buses in the store", 20000);
}

test("demo: no banner; the status pill says 'Simulated buses' (the one indicator) on Current trip", async () => {
  ok(!$("#demobar") && !$(".demobar"), "no demo banner");
  ok(!D.documentElement.classList.contains("is-demo"), "no layout offset class");
  ok($("#topbar").getBoundingClientRect().top < 30, "search bar at the top, not pushed down");
  await waitFor(() => !$("#pill").hidden, "pill shown");
  pillOn("Current trip");
  ok(!/Demo mode/.test(txt($("#topbar")) + txt($("#pill"))), "no banner words in the chrome");
});

test("demo: simulated buses everywhere, the live feed is never fetched", async () => {
  const s = store().get();
  ok(s.buses.length >= 1 && s.buses.every((b) => String(b.vehicle.id).startsWith("demo-")), "only simulated vehicles: " + s.buses.length);
  ok(s.liveLoaded && !s.failed && s.lastOk > 0, "feed state like a healthy live feed");
  eq(passioRequests(), [], "no request to passio3.com");
  ok($("#pill").classList.contains("info") && $("#pillRetry").hidden && $("#pillAlert").hidden, "quiet info pill, no Retry / See alert");
  await waitFor(() => $("#map .sb-busicon"), "bus markers on the map");
  const tok = (el, k) => W.getComputedStyle(el).getPropertyValue(k).trim().toLowerCase();
  const dark = $("#map").classList.contains("sb-dark");
  eq(tok($("#map"), "--sb-accent"), tok(D.documentElement, dark ? "--accent" : "--accent-fill"), "map blue = the UI accent token (" + (dark ? "dark" : "light") + ")");
  ok(!txt($("#content")).includes("Demo mode"), "no demo banner or demo service alert on Current trip");
});

test("demo: tapping the pill explains; Keep demo stays, Show live buses reloads without ?demo=1", async () => {
  $('#pill [data-action="demo:info"]').click();
  const d = await waitFor(dialog, "demo explanation dialog");
  ok(/Simulated buses/.test(txt(d.querySelector("h2"))) && /simulated from the published schedule/.test(txt(d)) && /not live data/.test(txt(d)), "explains: " + txt(d));
  ok(/Nothing you change in the demo is saved/.test(txt(d)), "says nothing is stored");
  eq([txt(d.querySelector('[data-confirm="no"]')), txt(d.querySelector('[data-confirm="yes"]'))], ["Keep demo", "Show live buses"]);
  ok(D.activeElement === d.querySelector('[data-confirm="no"]'), "Keep demo focused (the safe choice)");
  await sleep(400);   // past the confirm dialog's double-tap guard
  d.querySelector('[data-confirm="no"]').click();
  await waitFor(() => !dialog(), "dialog closed");
  ok(W.location.search.includes("demo=1"), "still in the demo");
  let went = null;
  const go = W.__demoUI.demoDeps.go;
  W.__demoUI.demoDeps.go = (href) => { went = href; };
  try {
    $('#pill [data-action="demo:info"]').click();
    const d2 = await waitFor(dialog, "dialog again");
    await sleep(400);
    d2.querySelector('[data-confirm="yes"]').click();
    await waitFor(() => went, "Show live buses leaves the demo");
    const u = new URL(went, W.location.href);
    ok(!u.searchParams.has("demo") && u.pathname === W.location.pathname, "same page, live: " + went);
  } finally {
    W.__demoUI.demoDeps.go = go;
  }
});

test("demo: the pill stays on Routes (buses running), route detail and My Routes; Settings says alerts are off", async () => {
  tab("routes");
  await waitFor(() => title() === "Routes" && /bus(es)? running/.test(txt($("#content"))), "Routes with running buses");
  pillOn("Routes");
  $('#content [data-action="route:open"]').click();
  await waitFor(() => store().get().view === "route" && $("#content .v-tl"), "route detail");
  pillOn("Route detail");
  tab("myroutes");
  await waitFor(() => title() === "My Routes", "My Routes");
  pillOn("My Routes");
  $("#settingsBtn").click();
  const o = await waitFor(() => { const x = $("#settingsOverlay"); return x && !x.hidden && x.dataset.state === "open" ? x : null; }, "Settings open");
  ok(txt(o).includes("Bus alerts are off in demo mode"), "Settings says bus alerts are off");
  ok(!o.querySelector('[data-st="perm"]'), "no Allow notifications button: alerts are off and the demo asks for nothing");
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

/*
 * End-to-end flows against the real app (web/index.html + js/main.js) in an iframe.
 * The iframe document is the real index.html with two injections (see e2e-stubs.js / e2e-expose.js):
 * stubbed geolocation (denied), stubbed live feed, stubbed place search and walking router.
 * Tests run in order and share the one app instance, like a user session.
 */
import { test, eq, ok, holdRun, run } from "./lib.js";

holdRun();

let FRAME = null, W = null, D = null, T = null, SB = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 6000) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) {
      const where = SB ? ` (view=${state().view}, title="${title()}", content="${txt(content()).slice(0, 160)}", log=${T.log.join(",")}, sameDoc=${FRAME && FRAME.contentDocument === D}, url=${FRAME && FRAME.contentWindow.location.href})` : "";
      throw new Error("timed out waiting for " + what + where);
    }
    await sleep(25);
  }
}
const $ = (sel) => D.querySelector(sel);
const $$ = (sel) => [...D.querySelectorAll(sel)];
const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
const content = () => D.getElementById("content");
const title = () => txt(D.getElementById("title"));
const state = () => SB.store.get();
function click(el, what) {
  ok(el, "missing element: " + what);
  el.click();
}
function type(input, value, what) {
  ok(input, "missing input: " + what);
  input.focus();
  input.value = value;
  input.dispatchEvent(new W.Event("input", { bubbles: true }));
}
const tab = (id) => click($(`#tabs button[data-tab="${id}"]`), "tab " + id);
const highlights = () => $$("#map .sb-hl").length;
const stopName = (id) => state().stops[id].name;

async function boot() {
  const html = await (await fetch("../index.html", { cache: "no-store" })).text();
  const base = new URL("../", location.href).href;
  let page = html.replace(/<head>/i, `<head><base href="${base}"><script src="tests/e2e-stubs.js"></script>`);
  page = page.replace(/<script type="module" src="js\/main\.js[^"]*"><\/script>/,
    (m) => `<script type="module" src="tests/e2e-expose.js"></script>${m}`);
  if (!page.includes("e2e-expose.js")) throw new Error("js/main.js <script> tag not found in index.html");
  const frame = document.createElement("iframe");
  frame.title = "app under test";
  document.body.appendChild(frame);
  FRAME = frame;
  const d = frame.contentDocument;
  d.open();
  d.write(page);
  d.close();
  W = frame.contentWindow;
  D = W.document;
  await waitFor(() => W.__sb && W.__e2e, "app modules", 15000);
  T = W.__e2e;
  SB = W.__sb;
  await waitFor(() => state().staticLoaded && state().liveLoaded && state().lastOk, "static + live data", 15000);
}

test("boot: Nearby fills from the live feed, no status pill", async () => {
  const rows = await waitFor(() => {
    const r = $$('#content [data-region="nearby-results"] [data-action="stop:open"]');
    return r.length ? r : null;
  }, "Arriving soon rows");
  ok(rows.length >= 3, "expected several arrival rows, got " + rows.length);
  eq(title(), "Nearby");
  ok($("#pill").hidden, "status pill should be hidden with fresh data: " + txt($("#pill")));
  ok(txt(content()).includes("Use my location"), "location prompt shown without permission");
});

test("tabs: Routes / Alerts / Nearby switch title, aria-current and alert badge", async () => {
  tab("routes");
  await waitFor(() => title() === "Routes" && $(".v-routerow"), "Routes view");
  eq($('#tabs button[data-tab="routes"]').getAttribute("aria-current"), "page");
  tab("alerts");
  await waitFor(() => title() === "Alerts" && txt(content()).includes("E2E detour"), "Alerts view with the alert");
  eq(txt($("#alertBadge")), "1");
  ok(!$("#alertBadge").hidden, "badge visible");
  tab("nearby");
  await waitFor(() => title() === "Nearby" && $('[data-region="nearby-results"] [data-action="stop:open"]'), "Nearby again");
  ok($("#back").hidden, "no Back button on a tab");
});

test("stop view: arrivals, directions buttons, back returns to Nearby", async () => {
  const row = $('[data-region="nearby-results"] [data-action="stop:open"]');
  const id = row.dataset.id;
  click(row, "arrival row");
  await waitFor(() => state().view === "stop" && title() === stopName(id), "stop view");
  await waitFor(() => $("#content .row.arr"), "arrival rows on the stop");
  ok($('#content [data-action="dir:to-stop"]'), "Directions to here");
  ok(/Updated/.test(txt(content())), "freshness footer");
  ok(!$("#back").hidden, "Back visible in a sub view");
  click($("#back"), "back");
  await waitFor(() => state().view === "nearby" && title() === "Nearby", "back to Nearby");
});

test("nearby search: a result tapped after the field loses focus still opens (no rebuild under the finger)", async () => {
  const input = $('#content [data-input="nearby-q"]');
  type(input, stopName(T.S), "nearby search");
  const row = await waitFor(() => $(`#content [data-region="nearby-results"] [data-action="stop:open"][data-id="${T.S}"]`), "search result");
  SB.store.set({ alerts: [...state().alerts] }); // a live update arrives while typing
  await sleep(60);
  input.blur(); // a real tap blurs the field on pointerdown, before click
  await sleep(60);
  ok(row.isConnected, "result row was replaced after blur");
  click(row, "search result");
  await waitFor(() => state().view === "stop" && state().stopId === T.S, "stop opened");
  click($("#back"), "back");
  await waitFor(() => state().view === "nearby", "back to Nearby");
  type($('#content [data-input="nearby-q"]'), "", "clear search");
  await waitFor(() => $('[data-region="nearby-results"] h3'), "Arriving soon again");
});

test("routes: eye toggle hides a route (persisted) and shows it again", async () => {
  tab("routes");
  const rid = T.R;
  await waitFor(() => $(`.v-eye[data-id="${rid}"]`), "eye button");
  click($(`.v-eye[data-id="${rid}"]`), "eye");
  await waitFor(() => state().hiddenRoutes.includes(rid) && $(`.v-routerow.is-off .v-eye[data-id="${rid}"]`), "route hidden");
  ok(String(W.localStorage.getItem("sb:hiddenRoutes")).includes(rid), "hiddenRoutes persisted");
  eq($(`.v-eye[data-id="${rid}"]`).getAttribute("aria-pressed"), "false");
  click($(`.v-eye[data-id="${rid}"]`), "eye again");
  await waitFor(() => !state().hiddenRoutes.includes(rid) && !$(`.v-routerow.is-off .v-eye[data-id="${rid}"]`), "route shown");
});

test("routes to station: dialog offers 3 choices and highlights nothing", async () => {
  click($('#content [data-action="pick:open"]'), "Routes to station button");
  const dlg = await waitFor(() => $("dialog.v-dialog[open]"), "pick dialog");
  eq(dlg.querySelectorAll("[data-mode]").length, 3);
  ok(/current location/i.test(txt(dlg)) && /select a station/i.test(txt(dlg)) && /address or place/i.test(txt(dlg)), "the three choices");
  eq(highlights(), 0, "no map highlights before choosing");
});

test("routes to station: 'Use current location' with location denied falls back", async () => {
  click($('dialog.v-dialog[open] [data-mode="loc"]'), "loc mode");
  await waitFor(() => state().view === "pick" && /Location unavailable/.test(txt(content())), "location unavailable state");
  eq(state().locState, "denied");
  eq(highlights(), 0, "still nothing highlighted");
  ok($('#content [data-action="pick:mode"][data-mode="sel"]'), "offers Select a station");
});

test("routes to station: 'Select a station' filters routes to that station", async () => {
  click($('#content [data-action="pick:mode"][data-mode="sel"]'), "sel mode");
  const input = await waitFor(() => $('#content [data-input="pick-q"]'), "station field");
  type(input, stopName(T.S), "station field");
  const row = await waitFor(() => $(`#content [data-action="pick:choose"][data-id="${T.S}"]`), "station row");
  await waitFor(() => highlights() > 0, "map highlights after typing");
  click(row, "station row");
  await waitFor(() => state().view === "routes" && state().routeFilter && $(".v-fchip"), "routes view with filter chip");
  ok(txt($(".v-fchip")).includes("Routes to " + stopName(T.S)), "filter chip: " + txt($(".v-fchip")));
  const serving = state().stopRoutes[T.S];
  const shown = $$("#content .v-eye").map((b) => b.dataset.id);
  ok(shown.length > 0 && shown.every((r) => serving.includes(r)), "only routes serving the station: " + shown);
  eq(highlights(), 0, "highlights cleared");
});

test("routes to station: 'Type an address or place' lists stops near the place", async () => {
  click($('#content [data-action="routes:clear-filter"]'), "clear filter");
  await waitFor(() => !state().routeFilter && !$(".v-fchip"), "filter cleared");
  click($('#content [data-action="pick:open"]'), "Routes to station button");
  click(await waitFor(() => $('dialog.v-dialog[open] [data-mode="addr"]'), "addr choice"), "addr mode");
  const input = await waitFor(() => state().view === "pick" && $('#content [data-input="pick-q"]'), "place field");
  type(input, "e2e place", "place field");
  click(await waitFor(() => $('#content [data-action="pick:place"]'), "place result"), "place result");
  ok(T.placeCalls > 0, "place search called");
  const first = await waitFor(() => $('#content [data-action="pick:choose"]'), "stations near the place");
  ok(/E2E Anchor Place/.test(txt(content())), "anchor label shown");
  await waitFor(() => highlights() > 0, "map highlights near the place");
  click(first, "nearest station");
  await waitFor(() => state().view === "routes" && state().routeFilter && $(".v-fchip"), "filtered routes");
  click($('#content [data-action="routes:clear-filter"]'), "clear filter");
  await waitFor(() => !state().routeFilter, "filter cleared");
});

test("directions: place + station, stubbed sidewalk walking, option drawn on the map", async () => {
  click($('#content [data-action="dir:open"]'), "Directions button");
  const from = await waitFor(() => state().view === "directions" && $('#content [data-input="dir-from"]'), "start field");
  from.focus();
  type(from, "e2e start", "start field");
  const placeSug = await waitFor(() => $$('#content [data-action="dir:sug"]').find((b) => /E2E Start Place/.test(txt(b))), "place suggestion");
  click(placeSug, "place suggestion");
  const to = $('#content [data-input="dir-to"]');
  to.focus();
  type(to, stopName(T.Dst), "destination field");
  const stopSug = await waitFor(() => $$('#content [data-action="dir:sug"]').find((b) => txt(b).startsWith(stopName(T.Dst))), "stop suggestion");
  click(stopSug, "stop suggestion");
  await waitFor(() => $("#content .v-opt [data-action='dir:opt']") && !/Checking sidewalk/.test(txt(content())), "refined options");
  ok(T.walkCalls > 0, "walkRoute stub used");
  const opts = $$("#content [data-action='dir:opt']");
  ok(opts.length >= 1 && opts.length <= 3, "1..3 option cards, got " + opts.length);
  click(opts[0], "first option");
  await waitFor(() => $("#content .v-opt.is-on .v-steps"), "steps of the selected option");
  const steps = txt($("#content .v-opt.is-on .v-steps"));
  ok(/Bus arrives at .+ \d{1,2}:\d{2}/.test(steps), "bus step with clock: " + steps);
  ok(/sidewalk route/.test(steps), "walking leg labeled sidewalk route: " + steps);
  ok(txt(content()).includes("Bus times are estimates from schedules and live predictions."), "estimate note");
  await waitFor(() => $$("#map path.sb-walk").length > 0 && $$("#map .sb-plan-casing").length > 0, "plan drawn on the map (walk + bus legs)");
});

test("theme: About's Auto / Light / Dark updates the page and the map", async () => {
  tab("alerts");
  click(await waitFor(() => $('#content [data-action="about:open"]'), "About row"), "About row");
  const seg = await waitFor(() => $("#content .themeseg"), "theme control");
  click(seg.querySelector('[data-mode="dark"]'), "Dark");
  await waitFor(() => D.documentElement.dataset.theme === "dark" && $("#map").classList.contains("sb-dark"), "dark theme");
  eq(state().theme, "dark");
  ok(String(W.localStorage.getItem("sb:theme")).includes("dark"), "theme persisted");
  click(seg.querySelector('[data-mode="light"]'), "Light");
  await waitFor(() => D.documentElement.dataset.theme === "light" && !$("#map").classList.contains("sb-dark"), "light theme");
  click(seg.querySelector('[data-mode="auto"]'), "Auto");
  await waitFor(() => !D.documentElement.dataset.theme && state().theme === "auto", "auto theme");
  eq(seg.querySelector('[data-mode="auto"]').getAttribute("aria-checked"), "true");
});

test("status pill: failing feed shows the error pill with Retry; recovery hides it", async () => {
  T.feedFail = true;
  W.dispatchEvent(new W.Event("online")); // live.js polls immediately when back online
  await waitFor(() => !$("#pill").hidden && $("#pill").classList.contains("err"), "error pill");
  ok(/Can't reach the shuttle feed/.test(txt($("#pillText"))), "pill text: " + txt($("#pillText")));
  ok(!$("#pillRetry").hidden, "Retry visible");
  eq(state().failed, true);
  T.feedFail = false;
  click($("#pillRetry"), "Retry");
  await waitFor(() => $("#pill").hidden && !state().failed, "pill hidden after recovery");
});

test("no console errors or uncaught exceptions in the app", () => {
  eq(T.errors, []);
});

boot().then(() => run(), (e) => {
  test("boot", () => { throw e; });
  run();
});

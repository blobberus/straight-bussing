/*
 * End-to-end flows against the real app (web/index.html + js/main.js) in an iframe.
 * The iframe document is the real index.html with two injections (see e2e-stubs.js / e2e-expose.js):
 * stubbed geolocation (denied), stubbed live feed, stubbed place search and walking router.
 * Tests run in order and share the one app instance, like a user session.
 */
import { test, eq, ok, near, holdRun, run } from "./lib.js";
import { shellE2E } from "./ui-shell-e2e.js";

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

/** The real index.html with the stubs injected. */
async function pageHTML() {
  const html = await (await fetch("../index.html", { cache: "no-store" })).text();
  const base = new URL("../", location.href).href;
  let page = html.replace(/<head>/i, `<head><base href="${base}"><script src="tests/e2e-stubs.js"></script>`);
  page = page.replace(/<script type="module" src="js\/main\.js[^"]*"><\/script>/,
    (m) => `<script type="module" src="tests/e2e-expose.js"></script>${m}`);
  if (!page.includes("e2e-expose.js")) throw new Error("js/main.js <script> tag not found in index.html");
  return page;
}
/** Load the app into a new iframe (optionally sized, e.g. a desktop window). */
async function openApp(style) {
  const frame = document.createElement("iframe");
  frame.title = "app under test";
  if (style) frame.style.cssText = style;
  document.body.appendChild(frame);
  const d = frame.contentDocument;
  d.open();
  d.write(await pageHTML());
  d.close();
  return frame;
}

async function boot() {
  const frame = await openApp();
  FRAME = frame;
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
  eq(title(), "Current trip");
  ok($("#pill").hidden, "status pill should be hidden with fresh data: " + txt($("#pill")));
  ok(txt(content()).includes("Use my location"), "location prompt shown without permission");
});

test("tabs: Nearby / Routes / My Routes switch title and aria-current; no Alerts tab", async () => {
  eq($$("#tabs button[data-tab]").map((b) => b.dataset.tab), ["nearby", "routes", "myroutes"]);
  ok(!$("#alertBadge") && !$('#tabs [data-tab="alerts"]'), "alerts tab and badge are gone");
  tab("routes");
  await waitFor(() => title() === "Routes" && $(".v-routerow"), "Routes view");
  eq($('#tabs button[data-tab="routes"]').getAttribute("aria-current"), "page");
  tab("myroutes");
  await waitFor(() => title() === "My Routes" && state().view === "myroutes", "My Routes view");
  eq($('#tabs button[data-tab="myroutes"]').getAttribute("aria-current"), "page");
  ok($("#back").hidden, "no Back button on a tab");
  tab("nearby");
  await waitFor(() => title() === "Current trip" && $('[data-region="nearby-results"] [data-action="stop:open"]'), "Nearby again");
  ok($("#back").hidden, "no Back button on a tab");
});

test("alerts: Nearby banner shows the active alert and opens the Alerts sub view; back returns", async () => {
  const banner = await waitFor(() => $('#content [data-region="nearby-alert"] [data-action="alerts:open"]'), "alert banner");
  ok(/Service alert/.test(txt(banner)) && txt(banner).includes("E2E detour"), "banner text: " + txt(banner));
  click(banner, "alert banner");
  await waitFor(() => title() === "Alerts" && txt(content()).includes("E2E detour"), "Alerts view with the alert");
  eq($('#tabs button[data-tab="nearby"]').getAttribute("aria-current"), "page", "alerts belong to Nearby");
  ok(!$("#back").hidden, "Back visible in the Alerts sub view");
  click($("#back"), "back");
  await waitFor(() => state().view === "nearby" && title() === "Current trip", "back to Nearby");
});

test("favorites: a favorite station shows on Nearby with its next bus and opens the stop", async () => {
  SB.store.set({ favStops: [T.S] });
  const row = await waitFor(() => $(`#content .v-favs [data-action="stop:open"][data-id="${T.S}"]`), "favorite row");
  ok(/Favorite /.test(row.getAttribute("aria-label")), "spoken label");
  ok($('#content [data-action="nav"][data-view="myroutes"]'), "All favorites link");
  click(row, "favorite row");
  await waitFor(() => state().view === "stop" && state().stopId === T.S, "stop opened from favorites");
  click($("#back"), "back");
  await waitFor(() => state().view === "nearby", "back to Nearby");
  SB.store.set({ favStops: [] });
  await waitFor(() => !$("#content .v-favs"), "favorites card gone");
});

test("context bar: journey shows 'Only showing routes for' and Show all ends it", async () => {
  ok($("#ctxbar").hidden, "hidden by default");
  SB.store.set({ journey: { rids: [T.R], label: "E2E trip", kind: "plan" } });
  await waitFor(() => !$("#ctxbar").hidden && txt($("#ctxbar")).includes("E2E trip"), "journey bar");
  ok(/Only showing routes for/.test(txt($("#ctxbar"))));
  click($('#ctxbar [data-action="journey:end"]'), "Show all");
  await waitFor(() => state().journey === null && $("#ctxbar").hidden, "journey ended");
});

test("context bar: an applied custom route shows its name and Clear restores the hidden list", async () => {
  const rids = Object.keys(state().routes);
  SB.store.set({ customRoutes: [{ id: "e2e", name: "E2E mine", rids: [T.R], highlight: [] }], activeCustom: "e2e",
    prevHidden: [], hiddenRoutes: rids.filter((r) => r !== T.R) });
  await waitFor(() => !$("#ctxbar").hidden && txt($("#ctxbar")).includes("E2E mine"), "custom route bar");
  click($('#ctxbar [data-action="custom:clear"]'), "Clear");
  await waitFor(() => state().activeCustom === null && state().hiddenRoutes.length === 0 && $("#ctxbar").hidden, "custom route cleared");
  SB.store.set({ customRoutes: [] });
});

const shellHelpers = { test, ok, eq, waitFor, $, txt, click, tab, W: () => W, store: () => SB.store };
shellE2E(shellHelpers, "chip");

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
  await waitFor(() => state().view === "nearby" && title() === "Current trip", "back to Nearby");
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

test("layout: search bar on top opens Directions; bottom navigation; Edit map order first on Routes", async () => {
  const sb = $("#searchBar"), nav = $("#tabs");
  ok(sb && sb.dataset.action === "dir:open" && sb.dataset.focus === "to" && /destination/i.test(sb.getAttribute("aria-label")), "search bar");
  ok(nav.getBoundingClientRect().bottom >= W.innerHeight - 1 && !$("#sheetHead #tabs"), "navigation at the bottom, not in the sheet");
  ok(sb.getBoundingClientRect().bottom <= $("#sheet").getBoundingClientRect().top, "search bar above the sheet");
  tab("routes");
  const top = await waitFor(() => $('#content [data-region="routes-top"]'), "routes top region");
  eq(top.querySelector("button")?.dataset.action, "routes:order-edit", "first control on Routes");
  ok(!$('#content [data-action="pick:open"]') && !$('#content [data-action="dir:open"]'), "no Routes to station / Directions on Routes");
  tab("nearby");
  await waitFor(() => title() === "Current trip" && $("#content .pt-notrip"), "Current trip view with the no-trip hint");
  eq($$('#content [data-action="dir:open"]').length, 0, "destination search lives in the top bar");
  eq($$('#content [data-action="pick:open"]').length, 1, "one Routes to station entry");
});

test("favorites: favorite stations get star badges on the map", async () => {
  SB.store.set({ favStops: [T.S] });
  await waitFor(() => $$("#map .sb-fav").length === 1, "one favorite badge on the map");
  SB.store.set({ favStops: [] });
  await waitFor(() => $$("#map .sb-fav").length === 0, "badge removed");
});

test("routes to station: dialog offers 3 choices and highlights nothing", async () => {
  tab("nearby");
  click(await waitFor(() => $('#content [data-action="pick:open"]'), "Routes to station on Current trip"), "Routes to station button");
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
  tab("nearby");
  click(await waitFor(() => $('#content [data-action="pick:open"]'), "Routes to station on Current trip"), "Routes to station button");
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
  tab("nearby");
  click($("#searchBar"), "search bar");
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
  ok(opts.length >= 1 && opts.length <= 4, "1..4 option cards, got " + opts.length);
  if (opts.length > 1) ok(/Least walking|Earliest arrival|Shortest wait/.test(txt($("#content .v-opt .j-crit"))), "first card says what it minimizes");
  click(opts[0], "first option");
  await waitFor(() => $("#content .v-opt.is-on .v-steps"), "steps of the selected option");
  const steps = txt($("#content .v-opt.is-on .v-steps"));
  ok(/Bus arrives at .+ \d{1,2}:\d{2}/.test(steps), "bus step with clock: " + steps);
  ok(/sidewalk route/.test(steps), "walking leg labeled sidewalk route: " + steps);
  ok(txt(content()).includes("Bus times are estimates from schedules and live predictions."), "estimate note");
  await waitFor(() => $$("#map path.sb-walk").length > 0 && $$("#map .sb-plan-casing").length > 0, "plan drawn on the map (walk + bus legs)");
  // the bus leg follows the route's road shape (map/geometry.js alongShape), never straight stop-to-stop links
  const bus = [];
  SB.map.eachLayer((l) => { if (l instanceof W.L.Polyline && l.options.pane === "sbPlan" && !/sb-walk/.test(l.options.className || "")) bus.push(l.getLatLngs()); });
  ok(bus.length >= 1, "bus leg drawn");
  const shapePts = Object.values(state().shapes).flat(2);
  for (const ll of bus) {
    const inner = ll.slice(1, -1), onShape = inner.filter((p) => shapePts.some((s) => Math.abs(s[0] - p.lat) < 1e-6 && Math.abs(s[1] - p.lng) < 1e-6));
    ok(inner.length >= 3 && onShape.length >= inner.length - 2, `bus leg along the road shape: ${onShape.length}/${inner.length} inner points are shape vertices`);
  }
});

test("theme: About's Auto / Light / Dark updates the page and the map", async () => {
  tab("nearby");
  click(await waitFor(() => $('#content [data-action="alerts:open"]'), "alert banner"), "alert banner");
  click(await waitFor(() => state().view === "alerts" && $('#content [data-action="about:open"]'), "About row"), "About row");
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

// Rider safety (2026-10-10): a fresh feed with no vehicles while a route is scheduled is not "no shuttles running".
test("status pill: an empty feed while a route is scheduled says no bus reports a location, never 'no shuttles running'", async () => {
  const svc = state().service, feed = T.feed, rid = T.R;
  const days = (d) => ({ days: { mon: d, tue: d, wed: d, thu: d, fri: d, sat: d, sun: d }, exceptions: [] });
  const poll = () => W.dispatchEvent(new W.Event("online"));
  T.feed = (name) => (name === "serviceAlerts" ? feed(name) : { header: { gtfs_realtime_version: "2.0", timestamp: Math.floor(Date.now() / 1000) }, entity: [] });
  try {
    SB.store.set({ service: { routes: { [rid]: days({ first: "00:00", last: "24:00", trips: 1, buses: Array(24).fill(1) }) } } });   // scheduled all day
    poll();
    await waitFor(() => !$("#pill").hidden && txt($("#pillText")) === "No shuttles are reporting live locations", "silent-service pill");
    tab("routes");
    await waitFor(() => /Scheduled, no live location/.test(txt(content())) && /No live locations right now/.test(txt(content())), "Routes: scheduled group + banner");
    ok(!/No shuttles running/.test(txt(content())), "Routes never claims no service: " + txt(content()).slice(0, 200));
    SB.store.set({ service: { routes: { [rid]: days(null) } } });   // nothing scheduled now: the honest case
    await waitFor(() => txt($("#pillText")) === "No shuttles running right now", "no-service pill");
  } finally {
    T.feed = feed;
    SB.store.set({ service: svc });
    poll();
    tab("nearby");
  }
  await waitFor(() => $("#pill").hidden && state().buses.length, "live buses back, pill hidden");
});

test("settings gear: top-right, labeled, 44px target, clear of the locate button", async () => {
  const g = $("#settingsBtn"), loc = $("#locateBtn");
  ok(g && g.getAttribute("aria-label") === "Settings" && g.dataset.action === "settings:open", "gear button");
  const r = g.getBoundingClientRect(), l = loc.getBoundingClientRect();
  ok(r.width >= 44 && r.height >= 44, "44px target: " + r.width + "x" + r.height);
  ok(r.bottom <= l.top, "gear sits above the locate button");
  ok(W.innerWidth - r.right <= 16, "right edge");
  click(g, "gear");
  const o = await waitFor(() => { const x = $("#settingsOverlay"); return x && !x.hidden && x.dataset.state === "open" ? x : null; }, "Settings overlay opened from the gear");
  eq([o.getAttribute("role"), o.getAttribute("aria-modal")], ["dialog", "true"], "modal dialog");
  ok(o.contains(D.activeElement), "focus moved into Settings");
  // layout boxes, not transforms: headless test frames do not run CSS transitions, so the sheet may sit mid-slide.
  // The overlay's top edge must be where the sheet's top settles at the full detent (rect top minus its translateY).
  const ot = () => parseFloat(W.getComputedStyle(o).top);
  const sheetTopFull = () => { const sh = $("#sheet"), t = W.getComputedStyle(sh).transform; return sh.getBoundingClientRect().top - (t && t !== "none" ? new W.DOMMatrixReadOnly(t).m42 : 0); };
  await waitFor(() => $("#sheet").dataset.detent === "full" && Math.abs(ot() - sheetTopFull()) <= 1 || null, "overlay placed over the full sheet");
  ok(ot() <= $("#title").getBoundingClientRect().top - (W.getComputedStyle($("#sheet")).transform !== "none" ? new W.DOMMatrixReadOnly(W.getComputedStyle($("#sheet")).transform).m42 : 0), "overlay covers the sheet title");
  ok($("#sheetHead").inert && $("#tabs").inert && !$(".sto-scrim").hidden, "covered header and navigation inert, background dimmed");
  eq(W.getComputedStyle(o).bottom, "0px", "overlay reaches the screen bottom, covering the bottom navigation");
  const done = o.querySelector(".sto-done"), dr = done.getBoundingClientRect(), orr = o.getBoundingClientRect();
  ok(/Done/.test(txt(done)) && dr.right > orr.left + orr.width * 0.7 && dr.top < orr.top + 60, "Done button in the top-right corner");
  click(done, "Done");
  await waitFor(() => o.dataset.state === "closed", "Done closes Settings");
});

shellE2E(shellHelpers, "credit");

test("tap outside the sheet: empty map collapses it to peek; stops and buses still open", async () => {
  tab("nearby");
  await waitFor(() => title() === "Current trip", "Current trip");
  const sh = $("#sheet");
  const det = () => sh.dataset.detent;
  // drive the Leaflet map the way a real tap does: a click on the map pane, not on a layer
  const tapMap = () => { const mp = $("#map .leaflet-map-pane") || $("#map"); mp.dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 200, clientY: 200 })); };
  click($("#grab"), "grab");                                  // open it up first if it was low
  await sleep(50);
  if (det() === "peek") { $("#grab").dispatchEvent(new W.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); await sleep(50); }
  ok(det() !== "peek", "sheet open before the tap: " + det());
  tapMap();
  await waitFor(() => det() === "peek" || null, "collapsed to peek after a tap on empty map");
  // stop / bus taps keep the map view (owner 2026-10-09): no camera call, and the camera stays put
  const halo = $("#map .sb-halo"), lm = SB.map, moves = [];
  const cam = () => [lm.getCenter().lat.toFixed(7), lm.getCenter().lng.toFixed(7), lm.getZoom()].join();
  const still = async () => { for (let i = 0; i < 100 && lm.__moving; i++) await sleep(100); await sleep(100); return cam(); };
  if (lm) for (const k of ["flyTo", "flyToBounds", "fitBounds", "setView"]) { const f = lm[k].bind(lm); lm[k] = (...a) => { moves.push(k); return f(...a); }; }
  if (halo && lm) {
    const before = await still();   // let any earlier glide finish first (virtual time slows Leaflet animations)
    moves.length = 0;
    halo.dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => state().view === "stop" || null, "a stop tap still opens the stop");
    ok(det() !== "peek", "the stop tap did not collapse the sheet");
    eq(moves, [], "a stop tap moves no camera");
    eq(await still(), before, "a stop tap keeps the map view");
    click($("#back"), "back");
    await waitFor(() => state().view === "nearby", "back to Current trip");
  }
  const bus = $("#map .sb-busicon");
  if (bus && lm) {
    const before = await still();
    moves.length = 0;
    bus.dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => state().view === "route" || null, "a bus tap opens its route");
    eq(moves, [], "a bus tap moves no camera");
    eq(await still(), before, "a bus tap keeps the map view");
    click($("#back"), "back");
    await waitFor(() => state().view !== "route" || null, "back from the route");
    tab("nearby");
    await waitFor(() => state().view === "nearby" || null, "back to Current trip");
  }
});

test("no console errors or uncaught exceptions in the app", () => {
  eq(T.errors, []);
});

test("desktop window: the app runs in a 393x852 phone frame with the phone layout", async () => {
  const f = await openApp("width:1280px;height:800px");
  const w = f.contentWindow;
  await waitFor(() => w.__sb && w.__sb.store.get().staticLoaded && w.document.querySelector(".leaflet-container"), "framed app booted", 15000);
  const d = w.document, app = d.getElementById("app"), cs = w.getComputedStyle(app);
  eq([cs.width, cs.height], ["393px", "852px"], "frame layout size");
  const r = app.getBoundingClientRect();
  near(r.height, 800 - 56, 3, "scaled to fit the window height");
  ok(Math.abs((r.left + r.right) / 2 - 640) < 2 && Math.abs((r.top + r.bottom) / 2 - 400) < 2, "centered: " + JSON.stringify([r.top, r.bottom]));
  eq(w.getComputedStyle(d.documentElement).getPropertyValue("--safe-t").trim(), "54px", "emulated status bar");
  const map = d.getElementById("map");
  eq([map.clientWidth, map.clientHeight], [393, 852], "Leaflet container fills the frame");
  const sh = d.getElementById("sheet"), sr = sh.getBoundingClientRect();
  near(sr.width, r.width, 2, "bottom sheet spans the frame (not the >=768px left panel)");
  ok(sr.top > r.top + r.height * 0.3 && sr.top < r.bottom, "sheet at half detent inside the frame");
  const g = d.getElementById("settingsBtn").getBoundingClientRect();
  ok(g.right <= r.right && g.top >= r.top + 54 * (r.height / 852) - 1, "gear inside the frame, below the status bar");
  eq(w.__e2e.errors, [], "no console errors in the framed app");
  f.remove();
});

boot().then(() => run(), (e) => {
  test("boot", () => { throw e; });
  run();
});

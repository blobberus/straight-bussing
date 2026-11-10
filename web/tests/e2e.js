/*
 * End-to-end flows against the real app (web/index.html + js/main.js) in an iframe.
 * The iframe document is the real index.html with two injections (see e2e-stubs.js / e2e-expose.js):
 * stubbed geolocation (denied), stubbed live feed, stubbed place search and walking router.
 * Tests run in order and share the one app instance, like a user session.
 */
import { test, eq, ok, near, holdRun, run } from "./lib.js";
import { shellE2E } from "./ui-shell-e2e.js";
import { currentTripE2E } from "./e2e-current.js";
import { locPromptE2E } from "./e2e-locprompt.js";
import { backNavE2E } from "./e2e-backnav.js";
import { tripStartE2E } from "./e2e-tripstart.js";
import { hourlyE2E } from "./e2e-hourly.js";
import { FEEDBACK_BTN_OFF_KEY } from "../js/ui/feedback-button.js";
import { localParts } from "../js/core/schedule.js";
import { A2HS_OFF_KEY } from "../js/ui/install-prompt.js";
// test seam: the Add to Home Screen card (ui/install-prompt.js) never shows by itself in these flows (install.test.html covers it)
try { sessionStorage.setItem(A2HS_OFF_KEY, "1"); } catch (e) { /* blocked storage */ }

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
  // test seam: the map's feedback button (ui/feedback-button.js) stays hidden in this session (same-origin iframes
  // share sessionStorage with this page), so it never sits in the flows; feedback.test.html covers it
  try { sessionStorage.setItem(FEEDBACK_BTN_OFF_KEY, "1"); } catch (e) { /* blocked storage: it would show */ }
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

test("boot: Current trip says no trip is selected (no nearby buses, owner 2026-11-04), the live feed loads, no status pill", async () => {
  const card = await waitFor(() => $("#content .pt-notrip"), "the no-trip card");
  ok(/No current trip selected/.test(txt(card)), "No current trip selected");
  ok(state().liveLoaded && state().buses.length >= 3, "the live feed loaded: " + state().buses.length + " buses");
  eq(title(), "Current trip");
  ok($("#pill").hidden, "status pill should be hidden with fresh data: " + txt($("#pill")));
  ok(!txt(content()).includes("Use my location") && !$('#content [data-region="nearby-results"] [data-action="stop:open"]'), "no location prompt and no nearby rows without a trip");
  eq(W.document.documentElement.dataset.text, "default", "text-size class set in the first frames (ui/frame.js), default browser text");
  ok(parseFloat(W.document.getElementById("app").style.getPropertyValue("--v-peek")) > 40, "collapsed height measured from the header after boot");
});

/** Blurred surfaces now (glass spec 12.1, 16): visible elements with a backdrop-filter, and the share of the screen they cover. */
function blurBudget() {
  const vw = W.innerWidth, vh = W.innerHeight, found = [];
  for (const e of D.querySelectorAll("body *")) {
    const cs = W.getComputedStyle(e), f = cs.backdropFilter || cs.webkitBackdropFilter;
    if (!f || f === "none" || cs.visibility !== "visible" || parseFloat(cs.opacity) === 0 || !e.getClientRects().length) continue;
    const r = e.getBoundingClientRect(), w = Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left)), h = Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
    if (w * h > 0) found.push({ id: e.id || e.className, a: w * h });
  }
  return { n: found.length, share: found.reduce((x, y) => x + y.a, 0) / (vw * vh), names: found.map((x) => String(x.id).split(" ")[0]).join(", ") };
}
/** Text on glass (glass spec 5.3): only label or labelGlass2; route badges and controls with their own fill are exempt. */
function glassTextOffenders() {
  const root = W.getComputedStyle(D.documentElement), probe = D.createElement("span");
  D.body.appendChild(probe);
  const rgb = (v) => { probe.style.color = v; return W.getComputedStyle(probe).color; };
  const allowed = new Set([rgb(root.getPropertyValue("--label")), rgb(root.getPropertyValue("--label-glass-2"))]);
  probe.remove();
  const bad = [], hosts = [...D.querySelectorAll(".glass")];
  if ($("#sheet").dataset.rest === "peek") hosts.push($("#sheetHead"));
  for (const host of hosts) {
    if (W.getComputedStyle(host).visibility !== "visible") continue;
    for (const e of host.querySelectorAll("*")) {
      if (e.closest(".chip, .ctx-btn, .pillslot, svg") || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = W.getComputedStyle(e);
      if (cs.visibility !== "visible" || !e.getClientRects().length || e.closest(".sr, .sr-only")) continue;
      if (!allowed.has(cs.color)) bad.push(`${e.className || e.tagName}: "${e.textContent.trim().slice(0, 24)}" in ${cs.color}`);
    }
  }
  return bad;
}

test("glass budget: at rest at most 6 blurred surfaces on at most 22% of the screen; text on glass is label or labelGlass2 only (glass spec 5.3, 12.1)", async () => {
  tab("nearby");
  $("#grab").dispatchEvent(new W.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
  // settled = the sheet rests collapsed and #app.is-moving (solid glass while it moves, 12.1 rule 2) is gone
  await waitFor(() => $("#sheet").dataset.rest === "peek" && !$("#app").classList.contains("is-moving") || null, "collapsed and settled");
  let b = blurBudget();
  ok(b.n >= 4 && b.n <= 6 && b.share <= 0.22, `collapsed: ${b.n} blurred (${b.names}), ${(b.share * 100).toFixed(1)}% of the screen`);
  eq(glassTextOffenders(), [], "collapsed: text on glass");
  SB.store.set({ journey: { kind: "plan", rids: [T.R], label: "To E2E Place", to: "E2E Place", t0: Math.floor(Date.now() / 1000), legs: [] } });
  await waitFor(() => !$("#ctxbar").hidden, "the trip chip");
  for (const a of $("#ctxbar").getAnimations()) a.finish();
  b = blurBudget();
  ok(b.n <= 6 && b.share <= 0.22, `with the trip chip: ${b.n} blurred (${b.names}), ${(b.share * 100).toFixed(1)}%`);
  const chip = W.getComputedStyle($("#ctxbar"));
  ok(/ctxbar/.test(b.names) && chip.backgroundColor !== "rgba(0, 0, 0, 0)", "the trip chip is a glass capsule (spec 8.3), not bare text on the map: " + chip.backgroundColor);
  eq(glassTextOffenders(), [], "with the trip chip: text on glass");
  SB.store.set({ journey: null });
  $("#grab").dispatchEvent(new W.KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
  await waitFor(() => $("#sheet").dataset.rest === "full" && !$("#app").classList.contains("is-moving") || null, "expanded and settled");
  b = blurBudget();
  ok(b.n <= 4, `expanded: the card's plate and the group stop blurring: ${b.n} (${b.names})`);
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
  await waitFor(() => title() === "Current trip" && $("#content .pt-notrip"), "Current trip again");
  ok($("#back").hidden, "no Back button on a tab");
});

// Glass spec 8.9 (Q3, default yes; the iPhone app does the same): the tab bar shrinks to a circle while the expanded
// list scrolls down, and comes back on scrolling up, at the top, on a tap on the circle, on a new page and on collapse.
test("tab bar minimize: scrolling the expanded list down leaves a circle with the section's glyph; up, a tap on it, a new page or a collapse bring the bar back", async () => {
  const finish = () => { for (const e of [$("#tabs"), ...$$("#tabs > *")]) for (const a of e.getAnimations({ subtree: true })) a.finish(); };
  const min = () => $("#app").classList.contains("tabs-min");
  const scrollTo = async (y) => { content().scrollTop = y; content().dispatchEvent(new W.Event("scroll")); await sleep(30); };
  tab("routes");
  await waitFor(() => title() === "Routes" && $$(".v-routerow").length > 3, "Routes view");
  $("#grab").dispatchEvent(new W.KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
  await waitFor(() => $("#sheet").dataset.detent === "full" || null, "expanded");
  ok(content().scrollHeight - content().clientHeight > 120, "a list long enough to scroll");
  await scrollTo(0);
  ok(!min(), "at the top: the full bar");
  await scrollTo(20);
  ok(!min(), "not before 24 px");
  await scrollTo(90);
  ok(min(), "scrolled down: minimized");
  finish();
  const tabs = $("#tabs").getBoundingClientRect(), sel = $('#tabs button[aria-current="page"]'), sr = sel.getBoundingClientRect();
  const k = parseFloat(W.getComputedStyle(D.documentElement).getPropertyValue("--frame-k")) || 1;
  near(sr.left + sr.width / 2, tabs.left + 28 * k, 1.5, "the selected glyph sits in the circle at the leading end");
  ok($$('#tabs button[data-tab]:not([aria-current="page"])').every((b) => W.getComputedStyle(b).visibility === "hidden"), "the other sections fade out");
  ok(/Routes, show all sections/.test(sel.getAttribute("aria-label")), "the circle says what it does: " + sel.getAttribute("aria-label"));
  const search = $("#searchBar");
  ok(W.getComputedStyle(search).visibility === "visible" && search.getBoundingClientRect().width >= 56 * k - 1, "the search circle stays");
  const hit = D.elementFromPoint(tabs.left + tabs.width * 0.75, tabs.top + tabs.height / 2);
  ok(!hit || !hit.closest("#tabs"), "the empty capsule area takes no taps");
  await scrollTo(content().scrollTop - 30);
  ok(!min(), "scrolling back up 16 px: the bar is back");
  await scrollTo(content().scrollTop + 60);
  ok(min(), "down again: minimized");
  click(sel, "the circle");
  await sleep(30);
  ok(!min() && title() === "Routes" && $("#sheet").dataset.detent === "full", "a tap on the circle brings the bar back, same section, still expanded");
  await scrollTo(content().scrollTop + 60);
  ok(min(), "minimized once more");
  $("#grab").dispatchEvent(new W.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
  await waitFor(() => !min() || null, "a collapse brings the bar back");
  $("#grab").dispatchEvent(new W.KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
  await waitFor(() => $("#sheet").dataset.detent === "full" || null, "expanded again");
  await scrollTo(content().scrollTop + 120);
  ok(min(), "minimized");
  tab("myroutes");   // a script (or assistive tech) tapping another section while minimized still switches
  await waitFor(() => title() === "My Routes" || null, "My Routes");
  ok(!min(), "a new page brings the bar back");
  tab("nearby");
  await waitFor(() => title() === "Current trip" || null, "Current trip");
  $("#grab").dispatchEvent(new W.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
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
  SB.store.set({ favStops: [T.S] });   // a stop row on Current trip (no trip: the favorites, owner 2026-11-04)
  const row = await waitFor(() => $('[data-region="nearby-results"] [data-action="stop:open"]'), "a favorite stop row");
  const id = row.dataset.id;
  click(row, "arrival row");
  await waitFor(() => state().view === "stop" && title() === stopName(id), "stop view");
  await waitFor(() => $("#content .row.arr"), "arrival rows on the stop");
  ok($('#content [data-action="dir:to-stop"]'), "Directions to here");
  ok(/Updated/.test(txt(content())), "freshness footer");
  ok(!$("#back").hidden, "Back visible in a sub view");
  click($("#back"), "back");
  await waitFor(() => state().view === "nearby" && title() === "Current trip", "back to Nearby");
  SB.store.set({ favStops: [] });
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
  await waitFor(() => !$('#content [data-region="nearby-results"] [data-action="stop:open"]') || null, "the search results gone again (no nearby list without a trip)");
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

test("layout: the search circle beside the tab bar opens Directions; floating tab bar; Edit map order first on Routes", async () => {
  // glass spec 3, 8.6, 8.7: the tab bar and the search circle float at the bottom, the collapsed card above them
  const sb = $("#searchBar"), nav = $("#tabs"), frameK = parseFloat(W.getComputedStyle(D.documentElement).getPropertyValue("--frame-k")) || 1;
  ok(sb && sb.dataset.action === "dir:open" && sb.dataset.focus === "to" && /destination/i.test(sb.getAttribute("aria-label")), "search circle");
  const nb = nav.getBoundingClientRect(), sbr = sb.getBoundingClientRect(), app = $("#app").getBoundingClientRect(), bottom = app.height > 100 ? app.bottom : W.innerHeight;
  ok(!$("#sheetHead #tabs") && nb.bottom <= bottom && nb.bottom >= bottom - 40 * frameK, "tab bar floats at the bottom, not in the sheet");
  ok(Math.abs(sbr.top - nb.top) < 1 && sbr.left > nb.right && Math.abs(sbr.width - sbr.height) < 1, "search circle at the tab bar's trailing end");
  ok(sbr.top >= $("#sheet").getBoundingClientRect().top + 30 * frameK, "the collapsed card sits above the bottom row");
  tab("routes");
  await waitFor(() => $('#content [data-region="routes-top"]'), "routes top region");
  // DESIGN-SPEC 10.6: Edit map order is the header's trailing action, before every list control
  const edit = await waitFor(() => $('#titleRight [data-action="routes:order-edit"]'), "Edit map order in the sheet header");
  ok(edit.getBoundingClientRect().height >= 44 * (parseFloat(W.getComputedStyle(D.documentElement).getPropertyValue("--frame-k")) || 1) - 0.5, "44 pt target (in the scaled phone frame): " + edit.getBoundingClientRect().height);
  ok(!$('#content [data-action="pick:open"]') && !$('#content [data-action="dir:open"]'), "no Routes to station / Directions on Routes");
  tab("nearby");
  await waitFor(() => title() === "Current trip" && $("#content .pt-notrip"), "Current trip with 'No current trip selected' (owner 2026-11-04)");
  eq($$('#content [data-action="dir:open"]').length, 1, "besides the search circle, one Search for a destination in the no-trip card");
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

test("sheet: the grab bar is never covered, and a drag from it that leaves the header at once moves the sheet", async () => {
  tab("nearby");
  const grab = $("#grab"), sheet = $("#sheet");
  const key = (k) => grab.dispatchEvent(new W.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const settle = async () => { await sleep(30); for (const an of sheet.getAnimations()) an.finish(); await sleep(30); };
  for (const [k, d] of [["Home", "peek"], ["End", "full"]]) {
    key(k);
    await settle();
    eq(sheet.dataset.detent, d);
    const r = grab.getBoundingClientRect();
    for (const fx of [0.2, 0.5, 0.8]) {
      const hit = D.elementFromPoint(r.left + r.width * fx, r.top + r.height / 2);
      ok(hit && (hit === grab || grab.contains(hit)), `${d}: the grab bar is on top at ${fx * 100}% (got ${hit && (hit.id || hit.className)})`);
    }
  }
  key("Home");   // collapsed
  await settle();
  const r = grab.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const pe = (el, type, yy) => el.dispatchEvent(new W.PointerEvent(type, { pointerId: 21, clientX: x, clientY: yy, bubbles: true, cancelable: true, pointerType: "touch", isPrimary: true }));
  pe(grab, "pointerdown", y);
  const map = $("#map");
  pe(map, "pointermove", y - 30);          // the finger is over the map from the first move on
  pe(map, "pointermove", y - 160);
  await sleep(40);
  ok(sheet.classList.contains("dragging"), "the sheet follows the finger");
  pe(map, "pointerup", y - 170);
  eq(sheet.dataset.detent, "full", "a short pull up expands it (no midway stop)");
  await settle();
  // the title line drags too (owner 2026-10-12: "any part where it includes the title")
  const tr = $("#title").getBoundingClientRect(), ty = tr.top + tr.height / 2;
  const pt = (el, type, yy) => el.dispatchEvent(new W.PointerEvent(type, { pointerId: 22, clientX: tr.left + 10, clientY: yy, bubbles: true, cancelable: true, pointerType: "touch", isPrimary: true }));
  pt($("#title"), "pointerdown", ty);
  pt(map, "pointermove", ty + 40);
  pt(map, "pointermove", ty + 120);
  pt(map, "pointerup", ty + 130);
  eq(sheet.dataset.detent, "peek", "dragged down by the title: collapsed");
  await settle();
});

test("directions: place + station, stubbed sidewalk walking, option drawn on the map", async () => {
  tab("nearby");
  // like Apple Maps (glass spec 2.2, 9.2): the search circle opens the expanded sheet with the Start / Destination card at
  // its top, Destination focused; the bottom row steps aside while the keyboard is up (touch screens)
  click($("#searchBar"), "search circle");
  const card = await waitFor(() => { const c = $("#content .v-dirbox"); return c && c.querySelector('[data-input="dir-to"]') ? c : null; }, "the card with the fields in the sheet");
  await waitFor(() => D.activeElement === card.querySelector('[data-input="dir-to"]'), "keyboard on Destination");
  eq($("#sheet").dataset.detent, "full", "the sheet expands with the fields and the suggestions");
  ok(card === $("#content .v-dir").firstElementChild, "the card is the first thing in the sheet");
  eq(W.getComputedStyle(card).position, "sticky", "pinned while the results scroll");
  ok(!$("#dirbar"), "no card over the map any more");
  // collapsing puts the keyboard away; the card is part of the sheet, so the collapsed card shows only the header
  $("#grab").dispatchEvent(new W.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
  await waitFor(() => $("#sheet").dataset.detent === "peek" || null, "collapsed");
  ok(!/^(INPUT|TEXTAREA)$/.test(D.activeElement?.tagName || ""), "keyboard put away when collapsed");
  eq(title(), "Directions", "the collapsed card says Directions");
  const from = await waitFor(() => state().view === "directions" && $('#content [data-input="dir-from"]'), "start field");
  $("#grab").dispatchEvent(new W.KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
  await waitFor(() => $("#sheet").dataset.detent === "full" || null, "expanded again");
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
  // the first card says what it minimizes; a walk card (core/rank.js walkPlace) leads at some hours of the suite run and says
  // why instead ("Close enough to walk" / "Faster to walk")
  if (opts.length > 1) ok(/Least walking|Earliest arrival|Shortest wait|Close enough to walk|Faster to walk/.test(txt($("#content .v-opt .j-crit"))), "first card says what it minimizes: " + txt($("#content .v-opt .j-crit")));
  click(opts.find((o) => !o.closest(".v-opt--walk")) || opts[0], "first bus option");   // the walk card has no bus leg
  await waitFor(() => $("#content .v-opt.is-on .v-steps"), "steps of the selected option");
  const steps = txt($("#content .v-opt.is-on .v-steps"));
  ok(/Bus arrives at .+ \d{1,2}:\d{2}/.test(steps), "bus step with clock: " + steps);
  ok(/sidewalk route/i.test(steps), "walking leg says Sidewalk route: " + steps);
  ok(txt(content()).includes("Bus times are estimates from schedules and live predictions."), "estimate note");
  await waitFor(() => $$("#map path.sb-walk").length > 0 && $$("#map .sb-plan-bus").length > 0, "plan drawn on the map (walk + bus legs)");
  eq($$("#map .sb-plan-casing, #map .sb-walk-casing, #map .sb-casing").length, 0, "no outlines on the plan or the lines (owner 2026-11-04)");
  // the bus leg follows the route's road shape (map/geometry.js alongShape), never straight stop-to-stop links
  const bus = [];
  SB.map.eachLayer((l) => { if (l instanceof W.L.Polyline && l.options.pane === "sbPlan" && !/sb-walk/.test(l.options.className || "")) bus.push(l.getLatLngs()); });
  ok(bus.length >= 1, "bus leg drawn");
  const shapePts = Object.values(state().shapes).flat(2);
  for (const ll of bus) {
    const inner = ll.slice(1, -1), onShape = inner.filter((p) => shapePts.some((s) => Math.abs(s[0] - p.lat) < 1e-6 && Math.abs(s[1] - p.lng) < 1e-6));
    ok(inner.length >= 3 && onShape.length >= inner.length - 2, `bus leg along the road shape: ${onShape.length}/${inner.length} inner points are shape vertices`);
  }
  // the plan drawn: every line dims and the buses of the routes it does not ride fade with them (owner 2026-11-04)
  const busIcons = () => $$("#map .sb-busicon"), fadedIcons = () => $$("#map .sb-busicon.is-faded");
  await waitFor(() => busIcons().length === T.routes.length || null, "every stub bus drawn");
  const fullBefore = busIcons().length - fadedIcons().length;
  ok(fullBefore >= 1 && fadedIcons().length >= 1, `preview: the plan's buses full (${fullBefore}), the others faded (${fadedIcons().length})`);
  ok(fadedIcons().every((e) => W.getComputedStyle(e).pointerEvents === "none"), "a faded bus takes no tap");
  // Start switches the sheet to Current trip with the trip in progress first (owner, 2026-10-12; iOS parity)
  click(await waitFor(() => $('#content .v-opt.is-on [data-action="dir:start"]'), "Start on the selected option"), "Start");
  const tt = await waitFor(() => state().view === "nearby" && $("#content .tp-title"), "Current trip with the trip in progress");
  eq(state().journey && state().journey.kind, "plan", "trip started");
  eq(title(), "Current trip", "sheet title, expanded (the next-step card says the step; collapsed: trip-arriving.js)");
  eq($('#tabs button[data-tab="nearby"]').getAttribute("aria-current"), "page", "Current trip tab selected");
  eq($("#sheet").dataset.detent, "full", "expanded: the trip progress");
  ok(!$("#content .v-dirbox"), "leaving Directions: the card goes with its view");
  ok($("#content [data-region='nearby-trip'] .tp-title"), "the trip in progress leads, above the next bus");
  await waitFor(() => D.activeElement === tt, "focus on the trip title");
  ok($$("#map .sb-plan-bus").length > 0, "the trip stays on the map");
  // on a trip only the trip's lines and their buses are drawn (owner 2026-11-04); they all come back when it ends
  const drawnLines = () => { let n = 0; SB.map.eachLayer((l) => { if (l instanceof W.L.Polyline && l.options.className === "sb-route") n++; }); return n; };
  const linesOf = (rids) => rids.reduce((n, rid) => n + (state().shapes[rid] || []).filter((p) => p && p.length >= 2).length, 0);
  const tripRids = state().journey.rids.slice();
  ok(tripRids.length >= 1, "a bus trip");
  await waitFor(() => drawnLines() === linesOf(tripRids) || null, `only the trip's lines drawn (${drawnLines()} of ${linesOf(Object.keys(state().shapes))})`);
  const tripBuses = T.routes.filter((r) => tripRids.includes(r.rid)).length;
  await waitFor(() => busIcons().length === tripBuses || null, "only the trip's buses drawn");
  eq(busIcons().length, fullBefore, "the same buses the preview kept at full strength");
  eq(fadedIcons().length, 0, "and none faded");
  // owner 2026-11-04: "When the sliding menu is lifted the current trip progress still disappears. Fix this so that the
  // current trip progress still shows." With a real trip in progress and the sheet expanded, the trip chip stays shown
  // and tappable above the sheet, on Current trip and on the other tabs (the Settings circle's rule)
  for (const tb of ["nearby", "routes", "myroutes", "nearby"]) {
    if (state().view !== tb) tab(tb);
    if ($("#sheet").dataset.detent !== "full") $("#grab").dispatchEvent(new W.KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    await waitFor(() => $("#sheet").dataset.detent === "full" && $("#tabs button[aria-current=\"page\"]")?.dataset.tab === tb && !$("#ctxbar").hidden || null, "expanded " + tb + " with the trip chip");
    for (const a of $("#ctxbar").getAnimations()) a.finish();
    const chip = $("#ctxbar"), c = chip.getBoundingClientRect(), sh = $("#sheet").getBoundingClientRect();
    eq(W.getComputedStyle(chip).visibility, "visible", tb + ": the trip chip shows over the expanded sheet");
    ok(/Trip to /.test(txt(chip)) && c.bottom <= sh.top - 4, `${tb}: the trip's name, above the sheet (chip ${Math.round(c.bottom)} / sheet ${Math.round(sh.top)})`);
    const btn = chip.querySelector('[data-action="journey:end"]'), b = btn.getBoundingClientRect(), hit = D.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    ok(hit && hit.closest('[data-action="journey:end"]') === btn, `${tb}: its Show all takes the tap (${hit && (hit.id || hit.className)})`);
  }
  click($('#content [data-action="journey:end"]'), "End trip");
  await waitFor(() => !state().journey && !$("#content .tp-title"), "trip ended");
  await waitFor(() => $$("#map .sb-plan-bus").length === 0, "plan cleared from the map");
  const shown = Object.keys(state().shapes).filter((rid) => !(state().hiddenRoutes || []).includes(String(rid)));
  await waitFor(() => drawnLines() === linesOf(shown) || null, "every line back after the trip");
  await waitFor(() => busIcons().length === T.routes.length && fadedIcons().length === 0 || null, "every bus back, none faded");
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

// Owner 2026-11-03: "When the connection/bus location is not updated and the error shows up, move the retry button to the left
// side of the notification so if the user spams it while on a route, it doesn't shift and accidentally cancel their current trip."
test("status banner: Retry tapped again and again during a trip, also as the feed comes back, never moves and never ends the trip", async () => {
  const rid = T.R, r = state().routes[rid];
  SB.store.set({ journey: { kind: "plan", rids: [rid], label: "To E2E Place", to: "E2E Place", t0: Math.floor(Date.now() / 1000), legs: [] } });
  await waitFor(() => !$("#ctxbar").hidden, "the trip chip");
  T.feedFail = true;
  W.dispatchEvent(new W.Event("online"));
  try {
    await waitFor(() => !$("#pill").hidden && $("#pill").classList.contains("err") && !$("#pillRetry").hidden, "error banner with Retry");
    const btn = $("#pillRetry"), pill = $("#pill"), at = () => { const b = btn.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10).join(","); };
    const first = at(), txtR = pill.querySelector(".pillmore").getBoundingClientRect(), b0 = btn.getBoundingClientRect();
    ok(b0.right <= txtR.left + 1 && b0.left - pill.getBoundingClientRect().left < 16, "Retry on the leading edge, before the text");
    const endTrip = [...D.querySelectorAll('[data-action="journey:end"]')].filter((e) => e.getClientRects().length);
    for (const e of endTrip) { const er = e.getBoundingClientRect(); ok(er.left >= b0.right || er.top >= b0.bottom + 8, "no trip-ending control under the Retry spot: " + e.textContent); }
    for (let i = 0; i < 8; i++) {
      if (i === 4) T.feedFail = false;   // the feed comes back in the middle of the taps
      const b = btn.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
      const hit = D.elementFromPoint(x, y);
      ok(hit && hit.closest("#pillRetry"), `tap ${i + 1} lands on Retry (${hit && (hit.id || hit.className)})`);
      hit.click();
      await sleep(i === 4 ? 400 : 60);
      eq(at(), first, `Retry did not move after tap ${i + 1}`);
      eq(state().journey && state().journey.kind, "plan", `the trip is still running after tap ${i + 1}`);
    }
    ok(/Live data is back/.test(txt($("#pillText"))) && $("#pillRetry").getAttribute("aria-disabled") === "true", "held after recovery: \"Live data is back.\", taps absorbed (DESIGN-SPEC 10.3)");
  } finally {
    T.feedFail = false;
    await waitFor(() => $("#pill").hidden && !state().failed, "banner gone once the hold is over and the feed is back", 8000);
    SB.store.set({ journey: null });
  }
  ok(r, "route " + rid);
});

// Owner 2026-11-04: "Reduce the size of the reconnecting notification." The compact banner opens its details (the full
// sentence, Call 773.702.8181) under its one line; tapping the line again and again during a trip never ends the trip
// (the line never moves, so no tap lands on the trip chip's Show all) and never moves Retry.
test("status banner: compact, one line; its details open and close under the line; fast taps on it during a trip never end the trip", async () => {
  const rid = T.R;
  SB.store.set({ journey: { kind: "plan", rids: [rid], label: "To E2E Place", to: "E2E Place", t0: Math.floor(Date.now() / 1000), legs: [] } });
  await waitFor(() => !$("#ctxbar").hidden, "the trip chip");
  T.feedFail = true;
  W.dispatchEvent(new W.Event("online"));
  try {
    await waitFor(() => !$("#pill").hidden && $("#pill").classList.contains("err") && !$("#pillRetry").hidden, "error banner with Retry");
    const pill = $("#pill"), more = pill.querySelector(".pillmore"), k = parseFloat(W.getComputedStyle(D.documentElement).getPropertyValue("--frame-k")) || 1;
    ok(pill.getBoundingClientRect().height <= 46 * k, "one 44 pt line: " + pill.getBoundingClientRect().height);
    ok(/rely|off/.test(txt(more)) && /Can't reach the shuttle feed/.test(txt($("#pillText"))), "the line still warns; screen readers get the full sentence");
    const retry0 = $("#pillRetry").getBoundingClientRect(), m0 = more.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      const b = more.getBoundingClientRect(), x = b.right - 30 * k, y = b.top + b.height / 2;   // the trailing end, over the trip chip's column
      const hit = D.elementFromPoint(x, y);
      ok(hit && hit.closest(".pillmore"), `tap ${i + 1} lands on the banner's line (${hit && (hit.id || hit.className)})`);
      hit.click();
      await sleep(40);
      eq(state().journey && state().journey.kind, "plan", `the trip is still running after tap ${i + 1}`);
      const r = $("#pillRetry").getBoundingClientRect(), m = more.getBoundingClientRect();
      eq([Math.round(r.left), Math.round(r.top), Math.round(m.top)], [Math.round(retry0.left), Math.round(retry0.top), Math.round(m0.top)], `Retry and the line stay put after tap ${i + 1}`);
    }
    eq(more.getAttribute("aria-expanded"), "false", "an even number of taps: closed again");
    click(more, "Details");
    const call = pill.querySelector(".pillcall");
    ok(!call.hidden && call.getAttribute("href") === "tel:+17737028181" && /773\.702\.8181/.test(txt(call)), "open: Call 773.702.8181");
    ok(pill.getBoundingClientRect().height > 80 * k && Math.round(more.getBoundingClientRect().top) === Math.round(m0.top), "open: the banner grows downward, the line stays (Row B follows --pill-h: tests/ui-shell-layout.js)");
    click(more, "Details");
  } finally {
    T.feedFail = false;
    W.dispatchEvent(new W.Event("online"));   // live.js polls at once when back online
    await waitFor(() => $("#pill").hidden && !state().failed, "banner gone once the feed is back", 15000);
    SB.store.set({ journey: null });
  }
});

// 2026-11-05 QA: the banner appearing or going moves the trip chip by its height; a tap aimed at what used to be there
// must not land on Show all (it ends the trip at once). A tap on the chip within ROW_GUARD_MS of the move is absorbed.
test("trip chip: a tap that lands on Show all right after the status banner appears or goes never ends the trip", async () => {
  const { ROW_GUARD_MS } = await import("../js/ui/pill.js");
  const rid = T.R;
  SB.store.set({ journey: { kind: "plan", rids: [rid], label: "To E2E Place", to: "E2E Place", t0: Math.floor(Date.now() / 1000), legs: [] } });
  await waitFor(() => !$("#ctxbar").hidden && $("#pill").hidden, "the trip chip, no banner");
  const showAll = () => $('#ctxbar [data-action="journey:end"]');
  const tap = (el) => el.dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));   // a finger, not the keyboard
  try {
    const y0 = showAll().getBoundingClientRect().top;
    T.feedFail = true;
    W.dispatchEvent(new W.Event("online"));
    await waitFor(() => !$("#pill").hidden, "the banner appears");
    ok(showAll().getBoundingClientRect().top > y0 + 20, "the chip moved down under it");
    tap(showAll());   // a tap that was aimed at the map just under the old chip
    eq(state().journey && state().journey.kind, "plan", "absorbed: the trip is still on");
    T.feedFail = false;
    W.dispatchEvent(new W.Event("online"));
    await waitFor(() => $("#pill").hidden, "the banner goes");
    tap(showAll());   // a tap that was aimed at the banner
    eq(state().journey && state().journey.kind, "plan", "absorbed again: the trip is still on");
    T.feedFail = true;
    W.dispatchEvent(new W.Event("online"));
    await waitFor(() => !$("#pill").hidden, "the banner again");
    showAll().click();   // keyboard / switch activation (detail 0): aimed at the focused button, never absorbed
    eq(state().journey, null, "a keyboard activation is not a misplaced tap: it ends the trip");
    SB.store.set({ journey: { kind: "plan", rids: [rid], label: "To E2E Place", to: "E2E Place", t0: Math.floor(Date.now() / 1000), legs: [] } });
    T.feedFail = false;
    W.dispatchEvent(new W.Event("online"));
    await waitFor(() => $("#pill").hidden && !$("#ctxbar").hidden, "the banner gone, the trip back");
    T.feedFail = true;
    W.dispatchEvent(new W.Event("online"));
    await waitFor(() => !$("#pill").hidden, "the banner once more");
    await new Promise((r) => setTimeout(r, ROW_GUARD_MS + 100));
    const more = $("#pill .pillmore");
    more.click();   // details open: the banner grows, the chip moves down
    await new Promise((r) => setTimeout(r, ROW_GUARD_MS + 100));
    more.click();   // details close: the chip moves up into where the details were
    tap(showAll());   // a tap that was aimed at the details' Call link
    eq(state().journey && state().journey.kind, "plan", "absorbed after the details close too");
    T.feedFail = false;
    W.dispatchEvent(new W.Event("online"));
    await waitFor(() => $("#pill").hidden, "the banner gone for good");
    await new Promise((r) => setTimeout(r, ROW_GUARD_MS + 100));
    tap(showAll());
    eq(state().journey, null, "a deliberate tap once the chip has settled still ends the trip");
  } finally {
    T.feedFail = false;
    SB.store.set({ journey: null });
  }
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
    // the first empty answer after buses is held for one poll (data/live.js EMPTY_HOLD_S: Passio sends odd empty lists); the next is believed
    await new Promise((r) => setTimeout(r, 300));
    poll();
    await waitFor(() => !$("#pill").hidden && txt($("#pillText")) === "No shuttles are reporting live locations", "silent-service pill");
    tab("routes");
    await waitFor(() => /Scheduled, no live location/.test(txt(content())) && /No live locations right now/.test(txt(content())), "Routes: scheduled group + banner");
    ok(!/No shuttles running/.test(txt(content())), "Routes never claims no service: " + txt(content()).slice(0, 200));
    ok(/From the shuttle operator/.test(txt(content())) && /E2E detour/.test(txt(content())), "the operator's alert in full next to the official links");
    const see = $("#pillAlert");
    ok(see && !see.hidden && $("#pillRetry").hidden, "pill offers See alert (an alert is up)");
    click(see, "See alert");
    await waitFor(() => state().view === "alerts" && /E2E detour/.test(txt(content())), "See alert opens Alerts");
    click($("#back"), "back");
    await waitFor(() => state().view === "routes", "back returns to Routes");
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

/** Collapse the sheet (the lower-right group rides on the collapsed card and hides when it is expanded). */
async function collapseSheet() {
  $("#grab").dispatchEvent(new W.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
  await waitFor(() => $("#sheet").dataset.detent === "peek" || null, "sheet collapsed");
}

test("settings gear: a glass circle top right (Row B), labeled, 44px target, clear of the lower-right group", async () => {
  await collapseSheet();
  $("#sheet").style.transition = "none";   // headless test frames do not run CSS transitions: read the settled card
  const g = $("#settingsBtn"), loc = $("#locateBtn"), k = parseFloat(W.getComputedStyle(D.documentElement).getPropertyValue("--frame-k")) || 1;
  ok(g && g.getAttribute("aria-label") === "Settings" && g.dataset.action === "settings:open", "gear button");
  const r = g.getBoundingClientRect(), l = loc.getBoundingClientRect(), app = $("#app").getBoundingClientRect(), right = app.width > 100 ? app.right : W.innerWidth;
  ok(r.width >= 44 * k - 0.5 && r.height >= 44 * k - 0.5, "44px target: " + r.width + "x" + r.height);
  ok(r.bottom <= l.top, "Settings at the top, Locate low on the right (glass spec 4)");
  ok(right - r.right <= 16 * k, "right edge");
  $("#sheet").style.removeProperty("transition");
  click(g, "gear");
  const o = await waitFor(() => { const x = $("#settingsOverlay"); return x && !x.hidden && x.dataset.state === "open" ? x : null; }, "Settings overlay opened from the gear");
  eq([o.getAttribute("role"), o.getAttribute("aria-modal")], ["dialog", "true"], "modal dialog");
  ok(o.contains(D.activeElement), "focus moved into Settings");
  // glass spec 9.8: an iOS sheet of its own from 10 below the safe area to the bottom, over a scrim; the app's sheet keeps
  // its state; it zooms out of the gear (transform-origin at the gear's center)
  const safeT = parseFloat(W.getComputedStyle(D.documentElement).getPropertyValue("--safe-t")) || 0;
  near(parseFloat(W.getComputedStyle(o).top), safeT + 10, 1, "top edge 10 below the safe area");
  eq(W.getComputedStyle(o).bottom, "0px", "reaches the screen bottom, covering the bottom row");
  eq($("#sheet").dataset.detent, "peek", "the app's own sheet is left as it was");
  ok(o.style.transformOrigin && o.style.transformOrigin !== "50% 50%", "zooms out of the gear: " + o.style.transformOrigin);
  ok($("#sheetHead").inert && $("#tabs").inert && $("#bottomrow").inert && $("#mapctl").inert && !$(".sto-scrim").hidden, "the app behind inert, dimmed");
  const done = o.querySelector(".sto-done"), dr = done.getBoundingClientRect(), orr = o.getBoundingClientRect();
  eq(done.getAttribute("aria-label"), "Done", "Done is a checkmark named Done (iOS 26)");
  ok(done.querySelector("svg") && Math.abs(dr.width - dr.height) < 1 && dr.right > orr.left + orr.width * 0.7 && dr.top < orr.top + 70, "a round button in the top-right corner");
  click(done, "Done");
  await waitFor(() => o.dataset.state === "closed", "Done closes Settings");
});

test("lines by time: the clock over Locate in the lower-right group opens the menu; Set time shows only those lines; deselecting one drops the name", async () => {
  await collapseSheet();
  $("#sheet").style.transition = "none";
  const c = $("#timeBtn"), l = $("#locateBtn"), k = parseFloat(W.getComputedStyle(D.documentElement).getPropertyValue("--frame-k")) || 1;
  ok(c && c.getAttribute("aria-label") === "Lines by Time" && c.dataset.action === "time:open", "clock button");
  const r = c.getBoundingClientRect(), lr = l.getBoundingClientRect();
  ok(r.width >= 44 * k - 0.5 && r.height >= 44 * k - 0.5, "44px target: " + r.width + "x" + r.height);
  ok(c.closest("#mapctl") && Math.abs(r.left - lr.left) < 1 && r.bottom <= lr.top + 1, "the top slot of the lower-right group, Locate under it (Map Modes' place in Apple Maps)");
  ok(r.bottom <= $("#sheet").getBoundingClientRect().top, "riding above the collapsed card");
  $("#sheet").style.removeProperty("transition");
  click(c, "clock");
  const o = await waitFor(() => { const x = $("#settingsOverlay"); return x && !x.hidden && x.dataset.state === "open" && x.dataset.kind === "time" ? x : null; }, "Lines by Time open");
  eq(txt($("#stoTitle")), "Lines by Time");
  let wed = null;                                          // next Wednesday (Chicago), 5:00 PM: weekday service
  for (let i = 1; i <= 7 && !wed; i++) { const p = localParts(Date.now() / 1000 + i * 86400); if (p.dow === 2) wed = p; }
  const key = (el, k, n = 1) => { for (let i = 0; i < n; i++) el.dispatchEvent(new W.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); };
  const col = (id) => o.querySelector("#" + id);
  key(col("tpMonth"), "Home"); key(col("tpMonth"), "ArrowDown", wed.m - 1);
  key(col("tpDay"), "Home"); key(col("tpDay"), "ArrowDown", wed.d - 1);
  key(col("tpHour"), "Home"); key(col("tpHour"), "ArrowDown", 4);
  key(col("tpMinute"), "Home"); key(col("tpAmpm"), "End");
  click(o.querySelector('[data-sto="done"]'), "Set time");
  await waitFor(() => state().timeView && o.dataset.state === "closed", "applied, menu closed");
  const tv = state().timeView;
  ok(tv.rids.length > 0 && tv.name.startsWith("Lines active at Wed "), tv.name);
  await waitFor(() => !$("#ctxbar").hidden && /Lines active at/.test(txt($("#ctxbar"))), "the context bar names it");
  eq(state().hiddenRoutes.slice().sort(), Object.keys(state().routes).filter((x) => !tv.rids.includes(x)).sort(), "only its lines shown");
  tab("routes");
  const rid = tv.rids[0];
  await waitFor(() => $(`.v-eye[data-id="${rid}"]`), "eye of one of its lines");
  click($(`.v-eye[data-id="${rid}"]`), "eye");
  await waitFor(() => state().timeView === null && $("#ctxbar").hidden, "the name is gone");
  ok(state().hiddenRoutes.includes(rid) && tv.rids.slice(1).every((x) => !state().hiddenRoutes.includes(x)), "the other lines are still shown");
  SB.store.set({ hiddenRoutes: [], timeView: null });
  tab("nearby");
});

shellE2E(shellHelpers, "credit");

test("tap outside the sheet: empty map collapses it to peek; stops and buses still open", async () => {
  tab("nearby");
  await waitFor(() => title() === "Current trip", "Current trip");
  const sh = $("#sheet");
  const det = () => sh.dataset.detent;
  // drive the Leaflet map the way a real tap does: a click on the map pane, not on a layer, at a spot 40 px clear of every
  // route line (a tap on a line opens that route, owner 2026-10-27; where the lines fall depends on the camera)
  const emptySpot = () => {
    const lm0 = SB.map, segs = Object.values(state().shapes || {}).flat().map((ln) => ln.map((q) => lm0.latLngToContainerPoint([q[0], q[1]])));
    const d = (x, y, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy || 1, k = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / L)); return Math.hypot(x - a.x - k * vx, y - a.y - k * vy); };
    for (let y = 140; y < 520; y += 30) for (let x = 40; x < 360; x += 30) if (segs.every((pts) => pts.every((q, i) => i === 0 || d(x, y, pts[i - 1], q) > 40))) return [x, y];
    return [200, 200];
  };
  const tapMap = () => { const [x, y] = emptySpot(), mp = $("#map .leaflet-map-pane") || $("#map"); mp.dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y })); };
  click($("#grab"), "grab");                                  // open it up first if it was low
  await sleep(50);
  if (det() === "peek") { $("#grab").dispatchEvent(new W.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); await sleep(50); }
  ok(det() !== "peek", "sheet open before the tap: " + det());
  tapMap();
  await waitFor(() => det() === "peek" || null, "collapsed to peek after a tap on empty map");
  // stop / bus taps keep the map view (owner 2026-10-09): no camera call, and the camera stays put
  const halo = $("#map .sb-halo"), lm = SB.map, moves = [];
  const cam = () => [lm.getCenter().lat.toFixed(7), lm.getCenter().lng.toFixed(7), lm.getZoom()].join();
  // Earlier tests start camera glides (route fit, plan fit). Under headless virtual time a glide's animation frames can
  // stall for longer than this test's timeout, so never wait for one: jump to its current view (Leaflet setView without
  // animation stops the glide and ends the move). The check is only about what the TAP does to the camera.
  const setView = lm && lm.setView.bind(lm);
  const settle = async () => { if (lm.__moving) setView(lm.getCenter(), lm.getZoom(), { animate: false }); await sleep(100); return cam(); };
  const after = async () => { await sleep(150); return cam(); };   // a tap that moved the camera shows within a frame or two
  if (lm) for (const k of ["flyTo", "flyToBounds", "fitBounds", "setView"]) { const f = lm[k].bind(lm); lm[k] = (...a) => { moves.push(k); return f(...a); }; }
  if (halo && lm) {
    const before = await settle();
    ok(!lm.__moving, "camera still before the tap");
    moves.length = 0;
    halo.dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => state().view === "stop" || null, "a stop tap still opens the stop");
    eq(det(), "peek", "a stop tap keeps the sheet collapsed: the map stays in view (no midway stop)");
    await waitFor(() => title() === state().stops[state().stopId].name || null, "the collapsed header names the stop");
    eq(moves, [], "a stop tap moves no camera");
    eq(await after(), before, "a stop tap keeps the map view");
    click($("#back"), "back");
    await waitFor(() => state().view === "nearby", "back to Current trip");
  }
  const bus = $("#map .sb-busicon");
  if (bus && lm) {
    const before = await settle();
    moves.length = 0;
    bus.dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => state().view === "route" || null, "a bus tap opens its route");
    eq(moves, [], "a bus tap moves no camera");
    eq(await after(), before, "a bus tap keeps the map view");
    // owner 2026-10-30: the tapped bus is picked; the route page then shows its own times
    await waitFor(() => state().busId != null || null, "the tapped bus is picked");
    await waitFor(() => $("#content .r-busnote") || null, "Showing its times note");
    click($("#back"), "back");
    await waitFor(() => state().view !== "route" || null, "back from the route");
    eq(state().busId, null, "leaving the route page clears the picked bus");
    tab("nearby");
    await waitFor(() => state().view === "nearby" || null, "back to Current trip");
  }
});

backNavE2E({ test, ok, eq, waitFor, $, $$, txt, click, tab, W: () => W, sb: () => SB });   // line replaces line (owner 2026-11-02)
tripStartE2E({ test, ok, eq, waitFor, $, $$, txt, click, type, tab, W: () => W, sb: () => SB, stopName, dst: () => T.Dst });   // trip start time (owner 2026-11-09)
hourlyE2E({ test, ok, eq, waitFor, $, $$, txt, click, tab, sb: () => SB });   // Schedule by hour, all times (owner 2026-11-09)

test("no console errors or uncaught exceptions in the app", () => {
  eq(T.errors, []);
});

currentTripE2E({ test, ok, eq, waitFor, openApp });   // the next bus at the half detent (owner decisions 2026-10-11)
locPromptE2E({ test, ok, eq, waitFor, openApp });   // one system prompt per location tap (owner 2026-11-02)

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

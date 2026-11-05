// Routes list search (owner 2026-11-04: "search routes from the routes menu which will bring them to the top"):
// the field, matches first, the rest below, clear / Escape, focus kept while typing, nothing stored (routes.test.html).
import { test, eq, ok } from "./lib.js";
import { fixture, makeCtx, tick, root, NOW } from "./views-fixtures.js";
import { bindActions, runAction } from "../js/ui/actions.js";
import { renderRoutes, listHTML, routeMatches, mountRoutes, unmountRoutes, _ui, notRunningText } from "../js/ui/views/routes.js";

const base = (over = {}) => fixture({ routeOrder: [], customRoutes: [], activeCustom: null, prevHidden: [], favStops: [], journey: null, ...over });
/** Route ids of the rows, top to bottom. */
const rowIds = (h) => [...h.matchAll(/data-action="route:open" data-id="([^"]+)"/g)].map((m) => m[1]);
const reset = () => { _ui.q = ""; _ui.mode = "list"; };

function mounted(over = {}) {
  reset();
  const ctx = makeCtx({ routeOrder: [], customRoutes: [], activeCustom: null, prevHidden: [], favStops: [], journey: null, view: "routes", ...over });
  const detents = [];
  ctx.setDetent = (d) => detents.push(d);
  const el = root();
  el.innerHTML = renderRoutes(ctx.store.get(), NOW);
  mountRoutes(el, ctx);
  const off = bindActions(el, () => ctx);
  return { ctx, el, detents, input: () => el.querySelector('[data-input="routes-q"]'), done: () => { off?.(); unmountRoutes(); el.remove(); reset(); } };
}
const typeIn = (inp, text, caret = text.length) => {
  inp.focus();
  inp.value = text;
  inp.setSelectionRange(caret, caret);
  inp.dispatchEvent(new Event("input", { bubbles: true }));
};
const key = (el, k) => { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e; };

test("routes search: a labelled field, the list's first control (Edit map order is the header's); not before the routes load", () => {
  reset();
  const h = renderRoutes(base(), NOW);
  const at = h.indexOf('data-input="routes-q"');
  ok(at > 0 && at < h.indexOf(">Running<") && h.match(/<(button|input|a)\s[^>]*>/)?.[0].includes('data-input="routes-q"'), "first control, before the groups");
  ok(renderRoutes(base({ hiddenRoutes: ["R3"] }), NOW).indexOf("Make this a custom route") < renderRoutes(base({ hiddenRoutes: ["R3"] }), NOW).indexOf('data-input="routes-q"'), "under the custom-route bar");
  ok(/<label class="v-search rt-q">[\s\S]*?<span class="v-sr">Search routes<\/span><input type="search"/.test(h), "label + type=search");
  ok(/class="rt-qx" data-action="routes:search-clear" aria-label="Clear route search" hidden/.test(h), "clear button labelled, hidden while empty");
  ok(/data-live="routes-q" aria-live="polite"/.test(h), "live count");
  ok(/<div class="rt-search" role="search" hidden>/.test(renderRoutes(base({ staticLoaded: false }), NOW)), "hidden before load");
});

test("routes search: matches first, best first, then the other routes under a quiet divider", () => {
  const s = base();
  ok(!listHTML(s, NOW, "").includes("rt-qdiv") && !listHTML(s, NOW, "   ").includes("rt-qdiv"), "no query: the usual list");
  const h = listHTML(s, NOW, "blue");
  eq(rowIds(h)[0], "R2", "Blue Loop first");
  ok(h.indexOf("1 route matches") < h.indexOf('data-id="R2"'), "a heading with the count");
  ok(/class="rt-qdiv" role="separator" aria-label="Other routes"/.test(h) && h.indexOf("Other routes") > h.indexOf('data-id="R2"'), "divider after the matches");
  eq(rowIds(h).length, 3, "nothing hidden by the search");
  eq(new Set(rowIds(h)).size, 3, "each route once");
  ok(h.indexOf("rt-bulk") > h.indexOf("rt-qdiv"), "Show all / Show running / Hide all with the other routes");
});

test("routes search: a stop name finds the lines that stop there and says which stop", () => {
  const h = listHTML(base(), NOW, "library");
  eq(rowIds(h).slice(0, 2), ["R2", "R1"], "both lines that stop at Library, in list order (short names B, R1)");
  eq((h.match(/Stops at Library/g) || []).length, 2, "the stop that matched, on each");
  ok(h.includes("2 routes match"));
  eq(routeMatches(base(), "hospitl").top.slice().sort(), ["R1", "R2", "R3"], "one typo in a stop name");
});

test("routes search: no match says so with Clear search; every route still listed", () => {
  const h = listHTML(base(), NOW, "zzzz");
  ok(h.includes("No routes match") && /data-action="routes:search-clear">Clear search</.test(h));
  ok(h.includes('aria-label="All routes"'), "divider names all routes");
  eq(rowIds(h).length, 3);
});

test("routes search: within the station filter; hidden routes stay grayed with their eye", () => {
  const f = listHTML(base({ routeFilter: { ids: ["R1", "R3"], label: "Main" } }), NOW, "library");
  eq(rowIds(f)[0], "R1");
  ok(!rowIds(f).includes("R2"), "a route outside the filter is not listed");
  const hid = listHTML(base({ hiddenRoutes: ["R2"] }), NOW, "blue");
  ok(/<div class="v-routerow is-off"><button type="button" class="v-row v-rowmain" data-action="route:open" data-id="R2">/.test(hid), "hidden match grayed");
  ok(hid.indexOf('data-action="routes:toggle" data-id="R2"') < hid.indexOf("Other routes"), "with its eye in the matches");
});

test("routes search: dynamic text escaped (query and names)", () => {
  reset();
  _ui.q = '"><img src=x onerror=alert(1)>';
  const h = renderRoutes(base(), NOW);
  ok(!h.includes("<img") && h.includes("&quot;&gt;&lt;img"), "query escaped in the field");
  const m = listHTML(base(), NOW, "alert");
  eq(rowIds(m)[0], "R3");
  ok(!m.includes("<script>") && m.includes("&lt;script&gt;"), "name escaped in a match");
  reset();
});

test("routes search: typing keeps the field, focus and caret; x, live count, Escape, clear; nothing stored", async () => {
  const { ctx, el, detents, input, done } = mounted({ hiddenRoutes: ["R3"], routeOrder: ["R2"] });
  const before = JSON.stringify([ctx.store.get().hiddenRoutes, ctx.store.get().routeOrder, ctx.store.get().routeFilter]);
  const inp = input();
  inp.focus();
  eq(detents, ["full"], "focus opens the sheet");
  typeIn(inp, "blu", 2);
  await tick();
  ok(input() === inp && document.activeElement === inp, "same field, still focused");
  eq([inp.selectionStart, inp.value], [2, "blu"], "caret kept");
  eq(rowIds(el.innerHTML)[0], "R2", "match on top");
  ok(!el.querySelector(".rt-qx").hidden, "x shown");
  ctx.store.set({ feedTs: NOW + 10 });   // a live poll while typing
  await tick();
  ok(input() === inp && document.activeElement === inp && inp.value === "blu", "a live update keeps the field");
  await tick(450);
  eq(el.querySelector('[data-live="routes-q"]').textContent, "1 route matches", "count announced");
  ok(key(inp, "Escape").defaultPrevented, "Escape with text is consumed");
  await tick();
  eq([inp.value, _ui.q, document.activeElement === inp, el.querySelector(".rt-qx").hidden], ["", "", true, true], "Escape cleared, focus stays");
  ok(!el.innerHTML.includes("rt-qdiv"), "usual list back");
  ok(!key(inp, "Escape").defaultPrevented, "Escape on an empty field goes on to Back");
  typeIn(inp, "zzzz");
  await tick();
  el.querySelector('.rt-qnone [data-action="routes:search-clear"]').click();
  await tick();
  eq([inp.value, document.activeElement === inp], ["", true], "Clear search empties and focuses the field");
  typeIn(inp, "library");
  await tick();
  el.querySelector(".rt-qx").click();
  await tick();
  eq(inp.value, "", "x clears");
  eq(JSON.stringify([ctx.store.get().hiddenRoutes, ctx.store.get().routeOrder, ctx.store.get().routeFilter]), before, "nothing stored changed");
  done();
});

test("routes search: hidden in map-order mode, back with the query after Done; bulk buttons unchanged", async () => {
  const { ctx, el, input, done } = mounted();
  typeIn(input(), "blue");
  await tick();
  runAction("routes:order-edit", {}, null, ctx);   // the header's Edit map order
  await tick();
  ok(el.querySelector(".rt-search").hidden, "no search while ordering");
  el.querySelector('[data-action="routes:order-done"]').click();
  await tick();
  ok(!el.querySelector(".rt-search").hidden && input().value === "blue" && rowIds(el.innerHTML)[0] === "R2", "query kept");
  el.querySelector('[data-action="routes:hide-all"]').click();
  await tick();
  eq(ctx.store.get().hiddenRoutes.slice().sort(), ["R1", "R2", "R3"], "Hide all still acts on every route");
  done();
});

// ---- owner 2026-11-05: inactive routes stay in the results, grayed and said in words; active ones first ----
const onlyR1 = (over = {}) => { const s = base(over); return { ...s, buses: s.buses.filter((b) => b.trip.route_id === "R1"), trips: s.trips.filter((t) => t.trip.route_id === "R1"), ...over }; };
const rowHTML = (h, id) => { const a = h.indexOf(`<div class="v-routerow`, h.lastIndexOf(`<div class="v-routerow`, h.indexOf(`data-id="${id}"`))); return h.slice(a, h.indexOf("</div>", h.indexOf(`data-id="${id}"`)) + 6); };

test("routes search: matches that run come first; the rest stay listed, grayed and saying so", () => {
  const s = onlyR1(), h = listHTML(s, NOW, "library");   // both lines stop at Library; only R1 runs
  eq(rowIds(h).slice(0, 2), ["R1", "R2"], "the running line first (list order alone would put B first)");
  const r2 = rowHTML(h, "R2"), r1 = rowHTML(h, "R1");
  ok(/class="v-routerow is-idle"/.test(r2) && !/is-idle/.test(r1), "only the one that does not run is grayed");
  ok(r2.includes("Not running") && !r1.includes("Not running"), "and it says so in words");
  eq(notRunningText(s, "R2", NOW).startsWith("Not running"), true);
  ok(r2.includes('data-action="routes:toggle" data-id="R2"') && r2.includes('aria-label="Hide route B Blue Loop"'), "still has its eye");
  const btn = (() => { const d = document.createElement("div"); d.innerHTML = h; return d.querySelector('[data-action="route:open"][data-id="R2"]'); })();
  ok(/Blue Loop.*Not running/.test(btn.textContent), "the row's accessible name says it does not run");
});

test("routes search: a route the query names stays first even when it does not run", () => {
  const h = listHTML(onlyR1(), NOW, "blue");
  eq(rowIds(h)[0], "R2", "Blue Loop first");
  ok(/class="v-routerow is-idle"/.test(rowHTML(h, "R2")), "grayed, though first");
});

test("routes search: hidden and not running says both (one middle dot per line); hidden alone keeps its own look", () => {
  const h = listHTML(onlyR1({ hiddenRoutes: ["R2"] }), NOW, "library"), r2 = rowHTML(h, "R2");
  ok(/class="v-routerow is-off is-idle"/.test(r2), "both looks");
  ok(r2.includes('<span class="v-sec">Hidden from map and times</span>') && r2.includes("Not running"), "both said, on two lines");
  ok(r2.includes('aria-label="Show route B Blue Loop"'), "the crossed-out eye of a hidden route");
  for (const line of r2.match(/<span class="v-sec[^"]*">[^<]*<\/span>/g) || []) ok((line.match(/·/g) || []).length <= 1, "one middle dot per line: " + line);
  const hid = listHTML(base({ hiddenRoutes: ["R1"] }), NOW, "library"), r1 = rowHTML(hid, "R1");
  ok(/class="v-routerow is-off"/.test(r1) && !/is-idle/.test(r1) && r1.includes("1 bus running · Hidden from map and times"), "hidden but running: not grayed as not running");
});

test("routes search: live status unknown grays nothing and keeps the score order (never 'Not running' in an outage)", () => {
  const h = listHTML(onlyR1({ liveLoaded: false }), NOW, "library");
  ok(!h.includes("is-idle") && !h.includes("Not running now"), "nothing grayed");
  eq(rowIds(h).slice(0, 2), ["R2", "R1"], "score order (ties: list order)");
  eq(routeMatches(onlyR1({ liveLoaded: false }), "library", NOW).active, null);
  ok(routeMatches(onlyR1(), "library", NOW).active.has("R1"), "the Show running rule's set otherwise");
});

// Owner 2026-11-05: "Routes that come up in searching for my routes should appear right under the search bar above the
// phone numbers and other information." While searching, the matches lead the body; the feed notice, the operator's
// alerts, both numbers, the bulk buttons and the station filter chip all stay on the page below them (rider safety).
test("routes search: the matches come right under the field, above the notices, the operator's alerts and the numbers; none removed", () => {
  const night = base({ buses: [], trips: [], alerts: [{ header_text: "Night service: call 773.555.0100 for route help", active_period: [] }] });
  const plain = listHTML(night, NOW, "");
  const note = (h) => Math.max(h.indexOf("No shuttles running right now"), h.indexOf("No live locations right now"));
  ok(note(plain) >= 0 && plain.includes("From the shuttle operator") && plain.includes("Call bus route help:"), "fixture: no bus reports, an operator alert with its number");
  ok(note(plain) < plain.indexOf("From the shuttle operator") && plain.indexOf("From the shuttle operator") < plain.indexOf('data-action="route:open"'), "empty field: the list exactly as before (notice, alerts, then the routes)");
  const h = listHTML(night, NOW, "blue");
  const first = h.indexOf("rt-qhead"), row = h.indexOf('data-id="R2"');
  ok(h.startsWith('<h3 class="v-h rt-qhead">'), "the match heading is the body's first element");
  ok(row > first && row < note(h), "the matching route before the notice");
  ok(note(h) < h.indexOf("From the shuttle operator"), "then the notice, then the operator's alerts");
  ok(h.indexOf("From the shuttle operator") < h.indexOf("rt-qdiv") && h.indexOf("rt-qdiv") < h.indexOf("rt-bulk"), "then Other routes and the bulk buttons");
  ok(h.indexOf("Call bus route help:") > h.indexOf("rt-bulk") && h.includes("773.555.0100") && h.includes("773.702.8181") && h.includes("Official transportation page"), "both numbers and the official page still at the bottom");
  const none = listHTML(night, NOW, "zzzz");
  ok(none.startsWith('<div class="rt-qnone">') && none.indexOf("Clear search") < note(none) && none.includes("Call bus route help:"), "no match: the empty card + Clear search first, the rest below");
  const out = listHTML(base({ buses: [], trips: [], lastOk: NOW - 3600, feedTs: NOW - 3600, failed: true, alerts: night.alerts }), NOW, "blue");
  ok(out.startsWith('<h3 class="v-h rt-qhead">') && out.indexOf("Live bus status unavailable") > out.indexOf('data-id="R2"'), "feed unreachable: matches first, the outage notice right below");
});

test("routes search: with a station filter the matches still lead and their heading names the station; the chip follows", () => {
  const s = base({ routeFilter: { ids: ["R1", "R3"], label: "Main" } });
  const h = listHTML(s, NOW, "library");
  ok(h.startsWith('<h3 class="v-h rt-qhead">') && h.includes("1 route matches at Main"), "heading first, names the scope");
  ok(h.indexOf('class="v-fchip"') > h.indexOf('data-id="R1"') && h.includes('data-action="routes:clear-filter"'), "the filter chip and its clear button below the match");
  const none = listHTML(s, NOW, "blue");
  ok(none.includes("Only routes to Main are searched. Clear the station filter to search every route.") && none.indexOf('class="v-fchip"') > none.indexOf("Clear search"), "no match inside the filter says why");
  ok(listHTML(s, NOW, "").startsWith('<div class="v-fchip"'), "empty field: the chip leads as before");
});

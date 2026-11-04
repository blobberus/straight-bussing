// Routes list search (owner 2026-11-04: "search routes from the routes menu which will bring them to the top"):
// the field, matches first, the rest below, clear / Escape, focus kept while typing, nothing stored (routes.test.html).
import { test, eq, ok } from "./lib.js";
import { fixture, makeCtx, tick, root, NOW } from "./views-fixtures.js";
import { bindActions } from "../js/ui/actions.js";
import { renderRoutes, listHTML, routeMatches, mountRoutes, unmountRoutes, _ui } from "../js/ui/views/routes.js";

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

test("routes search: a labelled field after Edit map order, above the list; not before the routes load", () => {
  reset();
  const h = renderRoutes(base(), NOW);
  const at = h.indexOf('data-input="routes-q"');
  ok(at > h.indexOf('data-action="routes:order-edit"') && at < h.indexOf(">Running<"), "after Edit map order, before the groups");
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
  el.querySelector('[data-action="routes:order-edit"]').click();
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

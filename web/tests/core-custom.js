// Tests for core/visibility.js and core/custom.js (My Routes, journeys, draw order)
import { test, eq, ok } from "./lib.js";
import { effectiveHidden, isVisible, mapFocus, drawOrder, mapVisibility, activeCustomRoute } from "../js/core/visibility.js";
import * as C from "../js/core/custom.js";
import { cleanCustom } from "../js/state.js";

const routes = { a: {}, b: {}, c: {}, d: {} };
const base = (over = {}) => ({ routes, hiddenRoutes: [], routeOrder: [], customRoutes: [], activeCustom: null,
  prevHidden: [], favStops: [], journey: null, routeFilter: null, view: "routes", routeId: null, ...over });
/** apply a patch like store.set would */
const apply = (s, p) => ({ ...s, ...p });

test("visibility: hidden list, journey wins, isVisible", () => {
  eq(effectiveHidden(base({ hiddenRoutes: ["b"] })), ["b"]);
  eq(effectiveHidden(base({ hiddenRoutes: ["b"], journey: { rids: ["b", "c"], label: "x" } })), ["a", "d"]);
  eq(effectiveHidden(base({ hiddenRoutes: ["b"], journey: { rids: [], label: "walk" } })), ["b"], "empty journey hides nothing extra");
  ok(!isVisible(base({ hiddenRoutes: ["b"] }), "b") && isVisible(base(), "b"));
});

test("visibility: focus precedence route view > journey > station filter > custom highlight", () => {
  const cr = [{ id: "x", name: "X", rids: ["a", "b"], highlight: ["b"] }];
  eq(mapFocus(base({ customRoutes: cr, activeCustom: "x" })), ["b"]);
  eq(mapFocus(base({ customRoutes: cr, activeCustom: "x", routeFilter: { ids: ["c"] } })), ["c"]);
  eq(mapFocus(base({ routeFilter: { ids: ["c"] }, journey: { rids: ["c"] } })), null);
  eq(mapFocus(base({ view: "route", routeId: "d", routeFilter: { ids: ["c"] } })), ["d"]);
  eq(mapFocus(base()), null);
  eq(activeCustomRoute(base({ customRoutes: cr, activeCustom: "gone" })), null);
});

test("visibility: draw order = focus, then routeOrder, then data order; unknown ids dropped", () => {
  eq(drawOrder(base({ routeOrder: ["c", "zz", "a"] })), ["c", "a", "b", "d"]);
  eq(drawOrder(base({ routeOrder: ["c", "a"] }), ["d"]), ["d", "c", "a", "b"]);
  eq(mapVisibility(base({ view: "route", routeId: "b" })).order[0], "b");
});

test("custom: save visible set, apply/clear restores previous hidden list", () => {
  let s = base({ hiddenRoutes: ["c", "d"] });
  const { patch, id } = C.saveVisibleAsCustom(s, "  Morning   commute ");
  s = apply(s, patch);
  eq(s.customRoutes[0].name, "Morning commute");
  eq(s.customRoutes[0].rids, ["a", "b"]);
  eq(s.activeCustom, id);
  ok(C.matchesCurrent(s, s.customRoutes[0]));
  s = apply(s, C.clearCustom(s));
  eq([s.activeCustom, s.hiddenRoutes], [null, []]);

  s = apply(base({ hiddenRoutes: ["a"] }), {});
  const made = C.createCustom(s, { name: "", rids: ["c"] });
  s = apply(s, made.patch);
  eq(s.customRoutes[0].name, "My route");
  s = apply(s, C.applyCustom(s, made.id));
  eq(s.hiddenRoutes, ["a", "b", "d"]);
  eq(s.prevHidden, ["a"]);
  s = apply(s, C.clearCustom(s));
  eq(s.hiddenRoutes, ["a"], "restores what the user had");
});

test("custom: switching between custom routes keeps the original prevHidden", () => {
  let s = base({ hiddenRoutes: ["d"] });
  const one = C.createCustom(s, { name: "1", rids: ["a"] }); s = apply(s, one.patch);
  const two = C.createCustom(s, { name: "2", rids: ["b"] }); s = apply(s, two.patch);
  s = apply(s, C.applyCustom(s, one.id));
  s = apply(s, C.applyCustom(s, two.id));
  eq(s.prevHidden, ["d"]);
  s = apply(s, C.clearCustom(s));
  eq(s.hiddenRoutes, ["d"]);
});

test("custom: update re-applies when active, highlight stays a subset, delete clears", () => {
  let s = base();
  const m = C.createCustom(s, { name: "M", rids: ["a", "b"] }); s = apply(s, m.patch);
  s = apply(s, C.applyCustom(s, m.id));
  s = apply(s, C.toggleHighlight(s, m.id, "b"));
  eq(s.customRoutes[0].highlight, ["b"]);
  s = apply(s, C.updateCustom(s, m.id, { rids: ["a", "c"], name: "N" }));
  eq(s.customRoutes[0].highlight, [], "highlight pruned to rids");
  eq(s.hiddenRoutes, ["b", "d"], "active route re-applied");
  ok(!C.matchesCurrent(apply(s, { hiddenRoutes: ["d"] }), s.customRoutes[0]), "detects user changes");
  s = apply(s, C.deleteCustom(s, m.id));
  eq([s.customRoutes.length, s.activeCustom, s.hiddenRoutes], [0, null, []]);
  eq(C.updateCustom(s, "nope", { name: "x" }), {});
});

test("custom: moveInOrder fills missing routes and stops at the ends; favorites toggle", () => {
  const s = base({ routeOrder: ["c"] });
  eq(C.moveInOrder(s, "a", -1).routeOrder, ["a", "c", "b", "d"]);
  eq(C.moveInOrder(s, "c", -1), {});
  eq(C.moveInOrder(s, "d", 1), {});
  let f = base();
  f = apply(f, C.toggleFav(f, "s1"));
  f = apply(f, C.toggleFav(f, 7));
  eq(f.favStops, ["s1", "7"]);
  eq(C.toggleFav(f, "s1").favStops, ["7"]);
});

test("state: cleanCustom drops bad entries, dedupes ids, prunes highlight", () => {
  eq(cleanCustom([null, { id: "a", name: " A ", rids: ["1", 1, "2"], highlight: ["2", "9"] }, { id: "a", name: "dup", rids: [] },
    { id: "", name: "x" }, { id: "b", name: "  " }, "junk"]), [{ id: "a", name: "A", rids: ["1", "2"], highlight: ["2"] }]);
  eq(cleanCustom("nope"), []);
});

test("custom: moveToIndex clamps and fills; showAll/hideAll scope + drop custom route", () => {
  const s = base({ routeOrder: ["c"] });
  eq(C.moveToIndex(s, "d", 0).routeOrder, ["d", "c", "a", "b"]);
  eq(C.moveToIndex(s, "c", 99).routeOrder, ["a", "b", "d", "c"]);
  eq(C.moveToIndex(s, "c", 0), {});
  eq(C.moveToIndex(s, "zz", 1), {});
  const h = base({ hiddenRoutes: ["a", "b"], activeCustom: "x", prevHidden: ["d"] });
  eq(C.showAll(h), { activeCustom: null, prevHidden: [], hiddenRoutes: [] });
  eq(C.showAll(h, ["a"]).hiddenRoutes, ["b"]);
  eq(C.hideAll(h).hiddenRoutes.sort(), ["a", "b", "c", "d"]);
  eq(C.hideAll(base({ hiddenRoutes: ["a"] }), ["a", "c"]).hiddenRoutes, ["a", "c"]);
});

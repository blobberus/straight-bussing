// core/routesearch.js (owner 2026-11-04: search routes from the Routes menu, "53rdst -> 53rd Street or 53rd St -> 53rd
// Street"). The golden file (routesearch-golden.json, tools/gen_routesearch_golden.py) is also checked by the iOS Kit.
import { test, eq, ok } from "./lib.js";
import { buildRouteIndex, routeIndexFor, searchRoutes, routeWords, canon, ordinal, splitByHits, matchText, TIER, NAMED_MIN, rankByActive } from "../js/core/routesearch.js";
import { norm as textNorm, near1 } from "../js/core/text.js";
import { norm as placesNorm } from "../js/data/places.js";
import { CASES, WORD_CASES, ACTIVE_CASES } from "./routesearch-cases.js";

const golden = fetch(new URL("./routesearch-golden.json", import.meta.url), { cache: "no-store" }).then((r) => r.json());
const r4 = (x) => Math.round(x * 10000) / 10000;

/** Names of the matches, best first, on the golden's frozen routes. */
async function names(q) {
  const g = await golden, byId = Object.fromEntries(g.routes.map((r) => [r.id, r.long || r.short]));
  return searchRoutes(buildRouteIndex(g.routes), q).map((h) => byId[h.id]);
}

test("routesearch: the owner's examples rank 53rd Street Express first", async () => {
  for (const q of ["53rdst", "53rd st", "53 st", "53rd street", "53", "53rd St.", "53RDST", "fifty third", "53r"]) {
    eq((await names(q))[0], "53rd Street Express", q);
  }
});

test("routesearch: keywords, abbreviations and stop names", async () => {
  const m = await names("metra");
  ok(m.includes("Midway Metra") && m.includes("Friend Center/Metra"), "metra: both Metra lines");
  eq(m.slice(0, 2), ["Midway Metra", "Friend Center/Metra"], "metra: the names before the lines that only stop at a Metra station");
  eq((await names("red line"))[0], "Red Line/Arts Block");
  eq((await names("arts"))[0], "Red Line/Arts Block");
  eq((await names("ap/dx"))[0], "Apostolic/Drexel");
  eq((await names("apostolic drexel"))[0], "Apostolic/Drexel");
  eq((await names("dcc"))[0], "Downtown Campus Connector");
  eq((await names("downtown"))[0], "Downtown Campus Connector");
  eq((await names("sth loop"))[0], "South Loop Shuttle");
  eq((await names("south loop"))[0], "South Loop Shuttle");
  eq((await names("drexl"))[0], "Drexel", "one typo");
  eq((await names("dt"))[0], "Downtown Campus Connector", "dt = downtown");
  eq((await names("friend ctr"))[0], "Friend Center/Metra", "ctr = center");
  eq((await names("ratner")).length, 5, "a stop name finds the lines that stop there");
  eq(await names("xyz"), [], "nothing");
  eq(await names("   "), [], "blank");
});

test("routesearch: stop matches say which stop; name matches do not", async () => {
  const g = await golden, idx = buildRouteIndex(g.routes);
  const hit = searchRoutes(idx, "lab school")[0];
  ok(hit && /Lab School/.test(hit.stop), "the stop that matched");
  ok(!("stop" in searchRoutes(idx, "53rd st")[0]), "a name match names no stop");
  ok(searchRoutes(idx, "ratner").every((h) => h.score >= TIER.STOP && h.score < TIER.EXPAND), "stop tier");
});

test("routesearch: letters split from digits, ordinals, number words, abbreviations", () => {
  eq(routeWords("53rdst", true), ["53", "st"]);
  eq(routeWords("53rd St."), ["53", "st"]);
  eq(routeWords("53st"), ["53", "st"], "a wrong 'st' after a number is a street");
  eq(routeWords("53r", true), ["53"], "typing: the start of the suffix");
  eq(routeWords("53r"), ["53", "r"], "not typing: kept");
  eq(routeWords("Fifty-Third"), ["53"]);
  eq(routeWords("AP/DX"), ["ap", "dx"]);
  eq(routeWords("Friend Center & Metra"), ["friend", "center", "metra"], "and is ignored");
  eq(routeWords("the"), ["the"], "a query of only ignored words keeps them");
  eq(["st", "ave", "ctr", "dt", "sth", "n", "e", "drexel"].map(canon), ["street", "avenue", "center", "downtown", "south", "north", "east", "drexel"]);
  eq(["1", "2", "3", "4", "11", "12", "13", "21", "53", "111", "112"].map(ordinal), ["st", "nd", "rd", "th", "th", "th", "th", "st", "rd", "th", "th"]);
  eq(routeWords("constructor toString"), ["constructor", "tostring"], "plain words (no prototype lookups)");
});

test("routesearch: one text rule with the place search", () => {
  eq(placesNorm, textNorm, "data/places.js re-exports core/text.js norm");
  ok(near1("drexl", "drexel") && near1("nroth", "north") && !near1("drexel", "dexl"), "near1");
});

test("routesearch: golden cases (the iOS Kit checks the same file)", async () => {
  const g = await golden, idx = buildRouteIndex(g.routes);
  eq(g.cases.map((c) => c.q), CASES, "golden is up to date with routesearch-cases.js (run tools/gen_routesearch_golden.py)");
  eq(g.words.map((w) => [w.s, w.typing]), WORD_CASES, "word cases up to date");
  for (const w of g.words) {
    eq(routeWords(w.s, w.typing), w.words, `words ${JSON.stringify(w.s)}`);
    eq(routeWords(w.s, w.typing).map(canon), w.canon, `canon ${JSON.stringify(w.s)}`);
  }
  for (const c of g.cases) eq(searchRoutes(idx, c.q).map((h) => [h.id, r4(h.score), h.stop ?? null]), c.hits, `query ${JSON.stringify(c.q)}`);
});

test("routesearch: index from the store; split keeps the rest in list order", () => {
  const state = {
    routes: { A: { short: "53RD", long: "53rd Street Express" }, B: { short: "", long: "East" }, C: { short: "DX", long: "Drexel" } },
    stops: { s1: { name: "53 & Kimbark" }, s2: { name: "Drexel Garage" } },
    routeStops: { A: ["s1"], B: ["s1", "s2", "s1"], C: ["s2"] },
  };
  const idx = routeIndexFor(state, ["A", "B", "C"]);
  eq(idx.map((e) => e.stops.length), [1, 2, 1], "stop names deduplicated (loops repeat the first stop)");
  const hits = searchRoutes(idx, "kimbark");
  eq(hits.map((h) => h.id), ["A", "B"], "ties keep the list order");
  eq(splitByHits(["C", "B", "A"], searchRoutes(idx, "drexel")), { top: ["C", "B"], rest: ["A"] });
  eq(splitByHits(["A"], [{ id: "Z" }]), { top: [], rest: ["A"] }, "a hit outside the list (station filter) is ignored");
  eq([0, 1, 2].map(matchText), ["No routes match", "1 route matches", "2 routes match"]);
  eq(searchRoutes([], "x"), []);
  eq(searchRoutes(routeIndexFor({}), "53"), []);
});

// ---- owner 2026-11-05: inactive routes stay findable; active ones first unless the query names a route ----

/** Route ids by long or short name on the golden's frozen routes. */
async function idsOf(...names) {
  const g = await golden;
  return names.map((n) => g.routes.find((r) => r.long === n || r.short === n).id);
}
async function ranked(q, ...activeNames) {
  const g = await golden, byId = Object.fromEntries(g.routes.map((r) => [r.id, r.long || r.short]));
  return rankByActive(searchRoutes(buildRouteIndex(g.routes), q), await idsOf(...activeNames)).map((h) => byId[h.id]);
}

test("routesearch: every route is findable, running or not (Move In Charter, no stops, no trips today)", async () => {
  const g = await golden, idx = buildRouteIndex(g.routes);
  for (const r of g.routes) {
    eq(searchRoutes(idx, r.long)[0]?.id, r.id, `long name ${r.long}`);
    if (r.short) ok(searchRoutes(idx, r.short).some((h) => h.id === r.id), `short name ${r.short}`);
    eq(rankByActive(searchRoutes(idx, r.long), new Set())[0]?.id, r.id, `${r.long} first even when nothing runs`);
  }
  ok(g.routes.some((r) => !r.stops.length), "the frozen copy has a route with no stops (Move In Charter)");
});

test("routesearch: active routes first unless the query names a route", async () => {
  eq((await ranked("metra", "Friend Center/Metra")).slice(0, 2), ["Friend Center/Metra", "Midway Metra"], "the running Metra line first");
  eq((await ranked("53rd"))[0], "53rd Street Express", "named: first even when it does not run");
  eq((await ranked("53rd", "Central", "North")).slice(0, 3), ["53rd Street Express", "Central", "North"], "then the running lines");
  eq((await ranked("drexel", "Apostolic/Drexel")).slice(0, 2), ["Drexel", "Apostolic/Drexel"], "exact name stays first");
  eq((await ranked("drex", "Apostolic/Drexel")).slice(0, 2), ["Drexel", "Apostolic/Drexel"], "the start of a name stays first");
  eq((await ranked("drexl", "Apostolic/Drexel")).slice(0, 2), ["Apostolic/Drexel", "Drexel"], "a typo match does not name a route");
  eq((await ranked("ratner", "East"))[0], "East");
  const g = await golden, idx = buildRouteIndex(g.routes), hits = searchRoutes(idx, "metra");
  eq(rankByActive(hits, null), hits, "live status unknown: order unchanged");
  ok(rankByActive(hits, null) !== hits, "a new array");
  eq(rankByActive(hits, ["5700"]).map((h) => h.id)[0], "5700", "an array works like a Set");
  eq(rankByActive([], new Set(["x"])), []);
  eq(NAMED_MIN, 88.5);
});

test("routesearch: golden active-first cases (the iOS Kit checks the same file)", async () => {
  const g = await golden, idx = buildRouteIndex(g.routes);
  eq(g.active.map((c) => c.q), ACTIVE_CASES.map((c) => c[0]), "golden is up to date (run tools/gen_routesearch_golden.py)");
  for (const c of g.active) eq(rankByActive(searchRoutes(idx, c.q), c.active == null ? null : new Set(c.active)).map((h) => h.id), c.hits, `"${c.q}" with ${JSON.stringify(c.active)}`);
});

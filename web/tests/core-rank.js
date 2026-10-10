// Tests for core/rank.js (trip option ranking: least walking, then earliest arrival, then shortest
// wait, then how many criteria an option meets) and its use by core/planner.js.
import { test, eq, ok } from "./lib.js";
import { CRITERIA, optionStats, rankOptions, criteriaText, pickOptions, walkTotals } from "../js/core/rank.js";
import { plan } from "../js/core/planner.js";

const T = 1_800_000_000;
const walk = (min) => ({ type: "walk", m: Math.round(min * 80), min });
const bus = (rid, wait, extra = {}) => ({ type: "bus", rid, wait, board: { id: rid + "b" }, alight: { id: rid + "a" }, boardT: T + wait * 60, ...extra });
/** Option with total walking `w` min (split over two legs), arrival `arr` min after T, and waits. */
const opt = (key, w, arr, ...waits) => ({ key, arrive: T + arr * 60, legs: [walk(w / 2), ...waits.map((x, i) => bus(key + i, x)), walk(w / 2)] });
const keys = (list) => list.map((o) => o.key);

test("rank: criteria are walking, arrival, wait in that priority", () => {
  eq(CRITERIA.map((c) => c.id), ["walk", "arrive", "wait"]);
  eq(criteriaText(["wait", "walk"]), "Least walking, shortest wait", "labels follow priority order, one sentence (no stacked dots)");
  eq(criteriaText([]), "");
});

test("rank: optionStats sums every walk leg and every wait (transfers too)", () => {
  const o = { arrive: T + 900, legs: [walk(2), bus("A", 3), walk(1.5), bus("B", 4), walk(0.5)] };
  eq(optionStats(o), { walk: 4, arrive: T + 900, wait: 7 });
  eq(walkTotals(o.legs), { walkMin: 4, walkM: 320 });
});

test("rank: least walking first, then earliest arrival, then shortest wait", () => {
  const W = opt("W", 1, 30, 9);    // least walking only
  const A = opt("A", 8, 10, 6);    // earliest arrival only
  const S = opt("S", 6, 20, 1);    // shortest wait only
  const r = rankOptions([S, A, W]);
  eq(keys(r), ["W", "A", "S"]);
  eq(r.map((o) => o.meets), [["walk"], ["arrive"], ["wait"]]);
});

test("rank: within the same top criterion, more criteria met come first", () => {
  const W1 = opt("W1", 2, 30, 9);          // walk
  const W2 = opt("W2", 2.3, 31, 1);        // walk (within 0.5 min) + wait
  const A = opt("A", 9, 12, 5);            // arrive
  const r = rankOptions([W1, A, W2]);
  eq(keys(r), ["W2", "W1", "A"]);
  eq(r[0].meets, ["walk", "wait"]);
});

test("rank: near-ties count (tolerance) but real gaps do not; options meeting nothing go last", () => {
  const a = opt("a", 4, 10, 2), b = opt("b", 4.4, 10.8, 2.9), c = opt("c", 9, 25, 8);
  const r = rankOptions([c, b, a]);
  eq(keys(r), ["a", "b", "c"]);
  eq(r[1].meets, ["walk", "arrive", "wait"], "0.4 min more walking, 0.8 min later, 0.9 min more wait still tie");
  eq(r[2].meets, [], "c is not best at anything");
});

test("rank: does not mutate input; empty and junk input are safe", () => {
  const list = [opt("x", 3, 10, 2)];
  const r = rankOptions(list);
  ok(!("meets" in list[0]) && r[0] !== list[0], "copies");
  eq(rankOptions(null), []);
  eq(rankOptions([null, { key: "no legs" }]), []);
});

test("pickOptions: drops absurd options and non-gaining transfers, merges duplicates, ranks, caps", () => {
  const leg = (rid, boardT) => ({ type: "bus", rid, wait: 2, board: { id: "s" }, alight: { id: "t" }, boardT });
  const c = (key, arrMin, legs, xfer = false) => ({ key, arr: T + arrMin * 60, legs, xfer });
  const out = pickOptions([
    c("A", 12, [walk(3), leg("A", T + 300), walk(1)]),
    c("A:dup", 12, [walk(3), leg("A", T + 300), walk(1)]),              // same bus legs as A
    c("B", 15, [walk(0.5), leg("B", T + 120), walk(0.2)]),
    c("SLOW", 200, [walk(1), leg("S", T + 60)]),                          // absurdly slower than walking
    c("A>B", 11.5, [walk(1), leg("A", T + 60), walk(1), leg("B", T + 400)], true), // gains < 2 min on A
  ], { t0: T, walkOnlyMin: 40, max: 4 });
  eq(keys(out), ["B", "A"], "B walks least; duplicate, slow and weak transfer dropped");
  eq(out[0].meets, ["walk", "wait"]);
  eq(out[1].meets, ["arrive", "wait"], "equal 2-min waits: both count as shortest");
  eq(pickOptions([c("A", 12, [leg("A", T)]), c("B", 13, [leg("B", T + 1)]), c("C", 14, [leg("C", T + 2)])], { t0: T, walkOnlyMin: 40, max: 2 }).length, 2, "cap");
});

test("planner: the least-walking stop pair is its own option and ranks first", () => {
  // Line Q: Q0 (start) -> Q1 (500 m north of the destination, reached fast) -> Q2 (at the destination, 25 min ride)
  const stops = {
    Q0: { name: "Q0", lat: 41.7, lon: -87.6 },
    Q1: { name: "Q1", lat: 41.7045, lon: -87.56 },
    Q2: { name: "Q2", lat: 41.7, lon: -87.5601 },
  };
  const from = { lat: 41.7001, lon: -87.6 }, to = { lat: 41.7, lon: -87.56 };
  const r = plan({ from, to, now: T,
    data: { stops, routes: {}, routeStops: { Q: ["Q0", "Q1", "Q2"] }, trips: [], buses: [{ vehicle: { id: "q" }, trip: { route_id: "Q" } }] },
    predict: { rideMinutes: (rid, a, b) => ({ min: b === "Q2" ? 25 : 5, source: "schedule", conf: 0.4 }) } });
  const alight = (o) => o.legs.find((l) => l.type === "bus").alight.id;
  eq(r.options.map(alight), ["Q2", "Q1"], "least walking (get off at the destination) first, then the faster drop-off 500 m away");
  ok(r.options[0].meets.includes("walk") && !r.options[0].meets.includes("arrive"));
  ok(r.options[1].meets.includes("arrive") && !r.options[1].meets.includes("walk"));
  ok(r.options[0].walkMin < r.options[1].walkMin && r.options[0].arrive > r.options[1].arrive, "a real trade-off");
  eq(new Set(r.options.map((o) => o.key)).size, r.options.length, "unique keys");
});

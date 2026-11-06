// Tests for core/rank.js (trip option ranking: least walking, then earliest arrival, then shortest
// wait, then how many criteria an option meets) and its use by core/planner.js.
import { test, eq, ok } from "./lib.js";
import { CRITERIA, optionStats, rankOptions, criteriaText, pickOptions, walkTotals, walkFirst, WALK_FIRST_MIN, besideWalk, uniqueOptions,
  LONG_WAY, savesWalking, walkPlace, criteriaLine, WALK_CAPTION, SLOWER_NOTE } from "../js/core/rank.js";
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

// Walk first (owner 2026-10-30: "if the distance is very close, it is ok to just suggest the user to walk on their first travel option")
const T0 = 1_800_000_000, FROM = { lat: 41.79, lon: -87.6 }, TO = { lat: 41.795, lon: -87.6 };
const busOpt = (key, arriveMin) => ({ key, arrive: T0 + arriveMin * 60, total: arriveMin, totalMin: arriveMin, legs: [{ type: "bus", rid: "R", wait: 1 }] });

test("walk first: 10 min or less puts a walk option first, bus options keep their order", () => {
  eq(WALK_FIRST_MIN, 10);
  const r = walkFirst([busOpt("a", 6), busOpt("b", 8)], { m: 800, min: 10, source: "router", coords: [[0, 0]] }, { from: FROM, to: TO, t0: T0 });
  eq(r.map((o) => o.key), ["walk", "a", "b"], "exactly 10 min counts as close");
  const w = r[0];
  ok(w.walkOnly && w.legs.length === 1 && w.legs[0].type === "walk" && w.legs[0].from === FROM && w.legs[0].to === TO);
  eq([w.walkMin, w.walkM, w.totalMin, w.arrive, w.legs[0].source], [10, 800, 10, T0 + 600, "router"]);
  ok(Array.isArray(w.legs[0].coords), "the sidewalk route is drawn");
});

test("walk first: longer walks lead only when they arrive no later than the best bus", () => {
  const walk = { m: 1000, min: 12.5 };
  // the bus walks 9 of the 12.5 min (saves 3.5 min: not "saves walking", LONG_WAY), so walking leads when it is no slower
  const busW = (key, arriveMin) => ({ ...busOpt(key, arriveMin), legs: [{ type: "walk", min: 9 }, { type: "bus", rid: "R", wait: 1 }] });
  eq(walkFirst([busW("a", 12)], walk, { from: FROM, to: TO, t0: T0 }).map((o) => o.key), ["a"], "12.5 min walk vs a 12 min bus: bus only");
  eq(walkFirst([busW("a", 13)], walk, { from: FROM, to: TO, t0: T0 }).map((o) => o.key), ["walk", "a"], "walking arrives first");
  eq(walkFirst([busW("a", 12.5)], walk, { from: FROM, to: TO, t0: T0 }).map((o) => o.key), ["walk", "a"], "a tie: walk first");
  eq(walkFirst([busW("a", 13)], walk, { from: FROM, to: TO, t0: T0 })[0].why, "close", "half a minute sooner: not called faster");
  eq(walkFirst([busW("a", 20)], walk, { from: FROM, to: TO, t0: T0 })[0].why, "faster", "7.5 min sooner: Faster to walk");
});

test("walk first: never without a bus option (the no-route screen keeps its help), capped, one walk option", () => {
  eq(walkFirst([], { m: 100, min: 1 }, { from: FROM, to: TO, t0: T0 }), [], "no bus options: unchanged (empty)");
  eq(walkFirst([busOpt("a", 9)], null, { from: FROM, to: TO, t0: T0 }).map((o) => o.key), ["a"]);
  const four = ["a", "b", "c", "d"].map((k, i) => busOpt(k, 5 + i));
  eq(walkFirst(four, { m: 400, min: 5 }, { from: FROM, to: TO, t0: T0 }).map((o) => o.key), ["walk", "a", "b", "c"], "walk + 3 bus = max 4");
  const again = walkFirst(walkFirst([busOpt("a", 9)], { m: 400, min: 5 }, { from: FROM, to: TO, t0: T0 }), { m: 480, min: 6 }, { from: FROM, to: TO, t0: T0 });
  eq(again.map((o) => o.key), ["walk", "a"], "an earlier walk option is replaced, never doubled");
  eq(again[0].walkMin, 6);
});

test("walk first: a bus option never claims what the walk above it disproves (QA 2026-11-05)", () => {
  // seen live: walk 7 min (arrive 6:56) first, then a bus trip walking 12 min to ride one stop back, arriving 7:03, said
  // "Least walking, earliest arrival, shortest wait"
  const bus = (key, arriveMin, walk, wait) => ({ key, arrive: T0 + arriveMin * 60, total: arriveMin, totalMin: arriveMin,
    legs: [{ type: "walk", min: walk }, { type: "bus", rid: "R", wait }] });
  const ranked = rankOptions([bus("back", 14, 12, 2), bus("dcc", 24, 15, 8)]);
  eq(criteriaText(ranked[0].meets), "Least walking, earliest arrival, shortest wait", "among the buses alone");
  const r = walkFirst(ranked, { m: 586, min: 7 }, { from: FROM, to: TO, t0: T0 });
  eq(r.map((o) => o.key), ["walk", "back", "dcc"], "the order stays");
  eq(r[1].meets, [], "walks more, arrives later, waits 2 min: claims nothing next to the walk");
  eq(r[2].meets, [], "the other bus neither");
  // a bus that really walks less and arrives sooner keeps those; a 1 min wait still counts as no wait (tolerance)
  const good = walkFirst(rankOptions([bus("near", 6, 2, 1)]), { m: 640, min: 8 }, { from: FROM, to: TO, t0: T0 });
  eq(criteriaText(good[1].meets), "Least walking, earliest arrival, shortest wait");
  const slow = besideWalk({ ...bus("x", 10, 3, 4), meets: ["walk", "arrive", "wait"] }, 8, T0 + 8 * 60);
  eq(slow.meets, ["walk"], "less walking than the walk, but later and with a 4 min wait");
  const same = { ...bus("y", 5, 1, 0), meets: ["walk"] };
  ok(besideWalk(same, 8, T0 + 8 * 60) === same, "unchanged options are not copied");
});

/* ---------- the long way around (owner 2026-11-06) ---------- */
// "Fix the route recommendation to approve of taking the long way around routes to reach a location given that it is the
// least amount of walking and long wait is ok. For instance, ... taking 53rd from regenstein to vue53"

test("long way: savesWalking = at least 5 min less AND at most half of the walking", () => {
  eq([LONG_WAY.SAVE_MIN, LONG_WAY.SAVE_FRAC, LONG_WAY.MAX_MIN], [5, 0.5, 60]);
  ok(savesWalking(3.6, 15), "Regenstein to Vue53: 3.6 of 15 min");
  ok(savesWalking(5, 10), "exactly 5 min and exactly half");
  ok(!savesWalking(10, 15), "5 min less but two thirds of the walk");
  ok(!savesWalking(2, 6.5), "half, but only 4.5 min less");
  ok(!savesWalking(0, 0) && !savesWalking(NaN, 15) && !savesWalking(3, null), "bad input: no");
});

test("long way: pickOptions keeps the least-walking option slower than walking, up to 60 min door to door", () => {
  const leg = (rid, boardT) => ({ type: "bus", rid, wait: 9, board: { id: rid + "b" }, alight: { id: rid + "a" }, boardT });
  const c = (key, arrMin, w, xfer = false) => ({ key, arr: T + arrMin * 60, legs: [walk(w / 2), leg(key, T + arrMin), walk(w / 2)], xfer });
  // walking the whole way: 15 min -> the usual limit max(2 x 15, 15 + 15) = 30 min
  const out = pickOptions([
    c("53RD", 32, 3.6),     // 12 stops around the loop: slower than the limit, walks least -> kept
    c("FCM", 25, 13.6),     // within the limit
    c("53RD:b", 35, 6),     // saves walking too, but 2.4 min more than the least -> dropped
    c("SLOW", 61, 0.5),     // over an hour door to door -> dropped
  ], { t0: T, walkOnlyMin: 15 });
  eq(keys(out), ["53RD", "FCM"], "the long way around first (least walking), the usual option after it");
  ok(out[0].meets.includes("walk") && !out[0].meets.includes("arrive"), "it says Least walking, not Earliest arrival: " + out[0].meets);
  ok(out[0].total > Math.max(2 * 15, 15 + 15), "slower than the old limit (it was dropped before 2026-11-06)");
  // a long wait is fine: 3.6 walk + 36 wait + 19 ride = 58.6 min
  eq(keys(pickOptions([c("53RD", 58.6, 3.6)], { t0: T, walkOnlyMin: 15 })), ["53RD"], "58.6 min with a long wait: kept");
  eq(keys(pickOptions([c("53RD", 60.5, 3.6)], { t0: T, walkOnlyMin: 15 })), [], "60.5 min: too long");
  // DCC-like: the slow option walks 4 min less than a usual option that already walks little -> not worth 22 more minutes
  eq(keys(pickOptions([c("DCC", 47, 0.7), c("53RD", 25, 4.7)], { t0: T, walkOnlyMin: 22 })), ["53RD"], "saves under 5 min over the usual options: dropped");
  // a slow option that only saves a little over walking the whole way stays dropped (the old rule)
  eq(keys(pickOptions([c("X", 31, 11)], { t0: T, walkOnlyMin: 15 })), [], "walks 11 of 15 min: no long way");
  // a transfer that is not worth it does not count as the least walking
  const x = { key: "A>B", arr: T + 40 * 60, legs: [walk(0.3), leg("A", T + 60), walk(0.1), leg("B", T + 600), walk(0.2)], xfer: true };
  eq(keys(pickOptions([c("53RD", 32, 3.6), c("FCM", 25, 13.6), x], { t0: T, walkOnlyMin: 15 })), ["53RD", "FCM"], "the dropped transfer walks less, the 53rd is still kept");
});

test("long way: walkPlace puts walking second under a bus option that saves walking, first when it is short", () => {
  const o = (key, arriveMin, w) => ({ key, arrive: T0 + arriveMin * 60, legs: [{ type: "walk", min: w }, { type: "bus", rid: "R", wait: 9 }] });
  const long = o("53RD", 32, 3.6), usual = o("FCM", 25, 13.6);
  eq(walkPlace([long, usual], { min: 15 }, T0), { at: 1, why: "faster" }, "15 min walk, the 53rd walks 3.6: bus first, walking second");
  eq(walkPlace([long], { min: 8 }, T0), { at: 0, why: "close" }, "8 min walk: walking first however much the bus saves");
  eq(walkPlace([o("53RD", 15.5, 3.6)], { min: 15 }, T0), null, "the bus is about as fast and walks much less: no walk card");
  eq(walkPlace([usual], { min: 15 }, T0), { at: 0, why: "faster" }, "no bus saves walking: walking first");
  eq(walkPlace([o("A", 14, 3)], { min: 15 }, T0), null, "a bus arrives first: no walk card");
  eq(walkPlace([], { min: 15 }, T0), null);
  eq(walkPlace([long], null, T0), null);
});

test("long way: walkFirst lists the 53rd, then Faster to walk, then the rest; each claims only what it beats", () => {
  const o = (key, arriveMin, w, wait) => ({ key, arrive: T0 + arriveMin * 60, total: arriveMin, totalMin: arriveMin, legs: [{ type: "walk", min: w }, { type: "bus", rid: "R", wait }] });
  const ranked = rankOptions([o("53RD", 32, 3.6, 9), o("FCM", 25, 13.6, 0.5)]);
  const r = walkFirst(ranked, { m: 1197, min: 15 }, { from: FROM, to: TO, t0: T0 });
  eq(r.map((x) => x.key), ["53RD", "walk", "FCM"]);
  eq(r[1].why, "faster");
  eq(WALK_CAPTION[r[1].why], "Faster to walk");
  eq(r[0].meets, ["walk"], "least walking; not the earliest arrival (walking is) nor the shortest wait");
  eq(r[2].meets, ["wait"], "the half-minute wait still counts as no wait next to the walk");
  eq(walkFirst(ranked, { m: 640, min: 8 }, { from: FROM, to: TO, t0: T0 }).map((x) => x.key), ["walk", "53RD", "FCM"], "a short walk still leads");
  eq(walkFirst(walkFirst(ranked, { m: 1197, min: 15 }, { from: FROM, to: TO, t0: T0 }), { m: 1197, min: 15 }, { from: FROM, to: TO, t0: T0 }).filter((x) => x.walkOnly).length, 1, "never doubled");
});

test("long way: criteriaLine states the trade-off on the least-walking option slower than walking", () => {
  const walkArrive = T0 + 15 * 60;
  eq(SLOWER_NOTE, "walking is faster");
  eq(criteriaLine({ meets: ["walk"], arrive: T0 + 32 * 60 }, walkArrive), "Least walking \u00b7 walking is faster");
  eq(criteriaLine({ meets: ["walk", "wait"], arrive: T0 + 32 * 60 }, walkArrive), "Least walking, shortest wait \u00b7 walking is faster", "one middle dot");
  eq(criteriaLine({ meets: ["walk"], arrive: T0 + 15.9 * 60 }, walkArrive), "Least walking", "within the 1 min arrival tolerance");
  eq(criteriaLine({ meets: ["wait"], arrive: T0 + 32 * 60 }, walkArrive), "Shortest wait", "only next to a least-walking claim");
  eq(criteriaLine({ meets: ["walk"], arrive: T0 + 32 * 60 }), "Least walking", "no walk to compare with");
  eq(criteriaLine({ meets: [], arrive: T0 + 32 * 60 }, walkArrive), "");
  ok(!/[\u2013\u2014]/.test(criteriaLine({ meets: ["walk"], arrive: T0 + 32 * 60 }, walkArrive)), "no dash characters");
});

test("uniqueOptions: two options refined onto the same bus are listed once, the first kept (QA 2026-11-05)", () => {
  const legs = (boardT) => [{ type: "walk", min: 0.1 }, { type: "bus", rid: "AP", board: { id: "8609" }, alight: { id: "8630" }, boardT }, { type: "walk", min: 0.4 }];
  const a = { key: "AP:8609>8630", legs: legs(T0 + 300) }, b = { key: "AP", legs: legs(T0 + 300.4) }, c = { key: "RED", legs: [{ type: "bus", rid: "RED", board: { id: "1" }, alight: { id: "2" }, boardT: T0 + 200 }] };
  eq(uniqueOptions([a, b, c]).map((o) => o.key), ["AP:8609>8630", "RED"], "same route, stops and boarding minute: one card");
  eq(uniqueOptions([a, { key: "later", legs: legs(T0 + 900) }]).length, 2, "the next bus on the same route is another option");
  const w = { key: "walk", walkOnly: true, legs: [{ type: "walk", min: 5 }] };
  eq(uniqueOptions([w, w]).length, 2, "no bus leg: left alone");
  eq(uniqueOptions(null), []);
});

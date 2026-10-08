// Tests for core/planner.js (synthetic network, no network access)
import { test, eq, ok, near } from "./lib.js";
import { plan, refineWalking, PLANNER } from "../js/core/planner.js";
import { hav } from "../js/core/geo.js";
import { walkEstimate } from "../js/core/walk.js";

const T = 1_800_000_000;
// Loop LOOP: L0 -> L1 -> L2 -> L3 -> L0 (rectangle ~830 m x 1110 m).
// Line A: A0 -> A1 -> A2 (west-east), line B: B0 -> B1 (north-south), B0 ~55 m from A2.
// Parallel lines P1..P4: X -> Y (3.3 km).
const stops = {
  L0: { name: "L0", lat: 41.79, lon: -87.6 }, L1: { name: "L1", lat: 41.79, lon: -87.59 },
  L2: { name: "L2", lat: 41.8, lon: -87.59 }, L3: { name: "L3", lat: 41.8, lon: -87.6 },
  A0: { name: "A0", lat: 41.78, lon: -87.62 }, A1: { name: "A1", lat: 41.78, lon: -87.61 }, A2: { name: "A2", lat: 41.78, lon: -87.6 },
  B0: { name: "B0", lat: 41.7795, lon: -87.6 }, B1: { name: "B1", lat: 41.77, lon: -87.6 },
  X: { name: "X", lat: 41.75, lon: -87.6 }, Y: { name: "Y", lat: 41.75, lon: -87.56 },
};
const routeStops = { LOOP: ["L0", "L1", "L2", "L3", "L0"], A: ["A0", "A1", "A2"], B: ["B0", "B1"] };
const bus = (rid) => ({ vehicle: { id: rid + "v" }, trip: { route_id: rid } });
const near_ = (id, dLat = 0.0001) => ({ lat: stops[id].lat + dLat, lon: stops[id].lon });
const trip = (id, rid, ups) => ({ trip: { trip_id: id, route_id: rid }, vehicle: { id: id + "v", label: id },
  stop_time_update: ups.map(([s, t]) => ({ stop_id: s, arrival: { time: t } })) });
const data = (extra = {}) => ({ stops, routes: {}, routeStops, trips: [], buses: [bus("LOOP"), bus("A"), bus("B")], ...extra });
const busLegs = (o) => o.legs.filter((l) => l.type === "bus");

test("loop route wraps (L3 -> L0 -> L1) with headway estimate", () => {
  const r = plan({ from: near_("L3"), to: near_("L1"), now: T, data: data() });
  ok(r.options.length >= 1, "has option");
  const o = r.options[0];
  eq(o.key, "LOOP");
  const [b] = busLegs(o);
  eq(b.board.id, "L3"); eq(b.alight.id, "L1"); eq(b.stopsPassed, 2);
  eq(b.waitLive, false);
  eq(b.source, "estimate");
  const cycle = (2 * hav(stops.L0, stops.L1) + 2 * hav(stops.L1, stops.L2)) / 300;
  near(b.wait, cycle / 2, 0.01, "cycle / 1 bus / 2");
  near(b.ride, (hav(stops.L3, stops.L0) + hav(stops.L0, stops.L1)) / 300, 0.01, "distance at 18 km/h");
  eq(b.path.length, 3);
  const w0 = o.legs[0];
  eq(w0.type, "walk", "13 m start walk kept as a step");
  near(w0.min, hav(near_("L3"), stops.L3) * 1.2 / 80, 1e-6, "short walk still costs time");
  near(b.boardT, T + w0.min * 60 + b.wait * 60, 1, "wait starts when you reach the stop");
  near(b.alightT, b.boardT + b.ride * 60, 1);
  near(o.arrive, T + o.total * 60, 0.01);
  eq(o.totalMin, Math.round(o.total));
  ok(r.walkOnly.m > 1500 && Math.abs(r.walkOnly.min - r.walkOnly.m / 80) < 0.02);
});

test("headway wait capped at 30 min and divided by buses running", () => {
  const two = plan({ from: near_("L3"), to: near_("L1"), now: T, data: data({ buses: [bus("LOOP"), bus("LOOP")] }) });
  const one = plan({ from: near_("L3"), to: near_("L1"), now: T, data: data() });
  near(busLegs(two.options[0])[0].wait, busLegs(one.options[0])[0].wait / 2, 0.01);
  ok(PLANNER.HEADWAY_CAP === 30);
});

test("one transfer within 150 m (A -> walk -> B)", () => {
  const r = plan({ from: near_("A0"), to: near_("B1", -0.0001), now: T, data: data() });
  const o = r.options.find((x) => x.key === "A>B");
  ok(o, "transfer option: " + JSON.stringify(r.options.map((x) => x.key)));
  eq(o.legs.map((l) => l.type), ["walk", "bus", "walk", "bus", "walk"]);
  const [b1, b2] = busLegs(o);
  eq(b1.board.id, "A0"); eq(b1.alight.id, "A2"); eq(b2.board.id, "B0"); eq(b2.alight.id, "B1");
  const xw = o.legs[2];
  ok(xw.m <= 150 && xw.m > 25, "transfer walk " + xw.m);
  ok(b2.boardT >= b1.alightT + xw.min * 60 - 1, "second bus after transfer walk");
  eq(r.options.length, 1);
});

test("no transfer when stops are > 150 m apart", () => {
  const far = { ...stops, B0: { name: "B0", lat: 41.778, lon: -87.6 } }; // ~222 m from A2
  const r = plan({ from: near_("A0"), to: near_("B1", -0.0001), now: T, data: data({ stops: far }) });
  ok(!r.options.some((o) => o.key === "A>B"), "no A>B: " + JSON.stringify(r.options.map((o) => o.key)));
  // Only A + a long (> 800 m) walk from A2 remains, and only because it beats walking.
  for (const o of r.options) {
    eq(o.key, "A");
    ok(o.legs[o.legs.length - 1].m > 800 && o.total < r.walkOnly.min, "long end walk counted, still faster");
  }
});

test("live: wait from next arrival, ride from same-trip prediction", () => {
  const trips = [trip("t1", "LOOP", [["L3", T + 300], ["L0", T + 500], ["L1", T + 700]])];
  const r = plan({ from: near_("L3"), to: near_("L1"), now: T, data: data({ trips }) });
  const [b] = busLegs(r.options[0]);
  eq(b.waitLive, true);
  near(b.wait, 5 - r.options[0].legs[0].min, 1e-6, "wait counted from when you reach the stop");
  eq(b.boardT, T + 300);
  eq(b.alightT, T + 700);
  near(b.ride, 400 / 60, 0.01);
  eq(b.source, "live");
  eq(b.tripId, "t1");
});

test("live arrival before you reach the stop is skipped for the next one", () => {
  const trips = [trip("t1", "LOOP", [["L3", T + 5]]), trip("t2", "LOOP", [["L3", T + 900]])];
  const from = { lat: stops.L3.lat + 0.002, lon: stops.L3.lon }; // ~222 m -> 3.3 min walk
  const r = plan({ from, to: near_("L1"), now: T, data: data({ trips }) });
  const [b] = busLegs(r.options[0]);
  eq(b.boardT, T + 900);
  eq(r.options[0].legs[0].type, "walk");
});

test("predict.rideMinutes used when no live same-trip time", () => {
  const predict = { rideMinutes: (rid, a, b, when) => ({ min: 3, source: "learned", conf: 0.7, p10: 2, p90: 5, _w: when }) };
  const r = plan({ from: near_("L3"), to: near_("L1"), now: T, data: data(), predict });
  const [b] = busLegs(r.options[0]);
  eq(b.ride, 3); eq(b.source, "learned"); eq(b.conf, 0.7); eq(b.p10, 2); eq(b.p90, 5);
  const bad = { rideMinutes: () => { throw new Error("x"); } };
  eq(busLegs(plan({ from: near_("L3"), to: near_("L1"), now: T, data: data(), predict: bad }).options[0])[0].source, "estimate");
});

test("absurdly slow bus options are dropped (vs walking)", () => {
  const args = { from: near_("L1"), to: near_("L0"), now: T, data: data() };
  ok(plan(args).options.length === 1, "long way round still reasonable without predict");
  const slow = plan({ ...args, predict: { rideMinutes: () => ({ min: 60, source: "schedule", conf: 0.4 }) } });
  eq(slow.options.length, 0);
  ok(slow.walkOnly.min > 10);
});

test("same walking for all: earliest arrival decides the order; max 4 options; meets labels", () => {
  const rs = { P1: ["X", "Y"], P2: ["X", "Y"], P3: ["X", "Y"], P4: ["X", "Y"] };
  const mins = { P1: 9, P2: 3, P3: 6, P4: 12 };
  const r = plan({ from: near_("X"), to: near_("Y"), now: T,
    data: { stops, routeStops: rs, trips: [], buses: ["P1", "P2", "P3", "P4"].map(bus) },
    predict: { rideMinutes: (rid) => ({ min: mins[rid], source: "schedule", conf: 0.4 }) } });
  eq(r.options.map((o) => o.key), ["P2", "P3", "P1", "P4"]);
  ok(r.options.every((o) => o.meets.includes("walk")), "equal walking: every option meets 'least walking'");
  ok(r.options[0].meets.includes("arrive") && !r.options[1].meets.includes("arrive"), "only the 3-min ride is earliest");
});

test("nothing running -> no options but walkOnly; bad input safe", () => {
  const r = plan({ from: near_("L3"), to: near_("L1"), now: T, data: data({ buses: [] }) });
  eq(r.options, []);
  ok(r.walkOnly.m > 0);
  eq(plan({ from: null, to: near_("L1"), now: T, data: data() }).options, []);
  eq(plan({ from: near_("L3"), to: near_("L1"), now: T }).options, []);
  eq(plan().options, []);
  const holes = plan({ from: near_("L3"), to: near_("L1"), now: T, data: data({ routeStops: { LOOP: ["L0", "GONE", "L1", "L2", "L3", "L0"] } }) });
  eq(busLegs(holes.options[0])[0].alight.id, "L1", "unknown stop ids skipped");
});

test("far from any stop -> no options", () => {
  const r = plan({ from: { lat: 41.9, lon: -87.7 }, to: near_("L1"), now: T, data: data() });
  eq(r.options, []);
});

/* ---------- walking always counted ---------- */
const sumLegs = (o) => o.legs.reduce((s, l) => s + (l.type === "walk" ? l.min : l.wait + l.ride), 0);
const walkSum = (o) => o.legs.reduce((s, l) => s + (l.type === "walk" ? l.min : 0), 0);

test("destination 1.2 km from the nearest stop still gets a bus option, walk included", () => {
  const to = { lat: stops.Y.lat + 0.0108, lon: stops.Y.lon }; // ~1.2 km north of Y
  ok(hav(to, stops.Y) > 1150 && hav(to, stops.Y) * 1.2 > PLANNER.MAX_WALK, "beyond the 800 m walk limit");
  const r = plan({ from: near_("X"), to, now: T, data: { stops, routeStops: { P: ["X", "Y"] }, trips: [], buses: [bus("P")] } });
  eq(r.options.length, 1, "bus + long walk beats walking");
  const o = r.options[0], last = o.legs[o.legs.length - 1];
  eq(o.key, "P");
  eq(last.type, "walk"); eq(last.to.name, "Destination");
  near(last.m, hav(stops.Y, to) * 1.2, 1);
  near(last.min, hav(stops.Y, to) * 1.2 / 80, 1e-6);
  near(o.arrive, busLegs(o)[0].alightT + last.min * 60, 1e-6, "arrive includes the final walk");
  near(o.total, sumLegs(o), 1e-6, "total == walk + wait + ride + walk");
  near(o.walkMin, walkSum(o), 1e-9); ok(o.walkM > 1400, "walkM " + o.walkM);
  ok(o.total < r.walkOnly.min, "ranked honestly vs walking");
  ok(PLANNER.MAX_WALK_FAR >= 1600);
});

test("long end walks only when nothing is within 800 m", () => {
  const r = plan({ from: near_("X"), to: near_("Y"), now: T, data: { stops, routeStops: { P: ["X", "Y"] }, trips: [], buses: [bus("P")] } });
  ok(r.options[0].legs.every((l) => l.type !== "walk" || l.m <= 800));
});

test("total == walk + wait + ride + walk; wait starts after the walk to the stop", () => {
  const from = { lat: stops.L3.lat + 0.004, lon: stops.L3.lon }; // ~445 m
  const to = { lat: stops.L1.lat - 0.003, lon: stops.L1.lon };
  const r = plan({ from, to, now: T, data: data() });
  const o = r.options[0], [b] = busLegs(o), w0 = o.legs[0];
  near(w0.min, hav(from, stops.L3) * 1.2 / 80, 1e-6);
  near(b.boardT, T + (w0.min + b.wait) * 60, 1e-6);
  near(o.total, sumLegs(o), 1e-6);
  near(o.arrive, T + o.total * 60, 1e-6);
  near(o.walkMin, walkSum(o), 1e-9);
  eq(o.walkM, o.legs.filter((l) => l.type === "walk").reduce((s, l) => s + l.m, 0));
});

test("walk-only and walk legs use the same model as core/walk's estimate", () => {
  const from = { lat: stops.L3.lat + 0.004, lon: stops.L3.lon }, to = { lat: stops.L1.lat - 0.003, lon: stops.L1.lon };
  const r = plan({ from, to, now: T, data: data() });
  near(r.walkOnly.min, walkEstimate(from, to).min, 1e-6);
  for (const l of r.options[0].legs) if (l.type === "walk") near(l.min, walkEstimate(l.from, l.to).min, 1e-6);
  eq(PLANNER.DETOUR, 1.2); eq(PLANNER.WALK_M_MIN, 80);
});

const xferTrips = () => [
  trip("ta", "A", [["A0", T + 60], ["A1", T + 180], ["A2", T + 300]]),
  trip("tb1", "B", [["B0", T + 320], ["B1", T + 620]]), // leaves before you can walk over
  trip("tb2", "B", [["B0", T + 600], ["B1", T + 900]]),
];

test("transfer: second wait starts after the transfer walk", () => {
  const r = plan({ from: near_("A0"), to: near_("B1", -0.0001), now: T, data: data({ trips: xferTrips() }) });
  const o = r.options.find((x) => x.key === "A>B");
  ok(o, "transfer option: " + JSON.stringify(r.options.map((x) => x.key)));
  const [b1, b2] = busLegs(o), xw = o.legs[2];
  eq(xw.type, "walk");
  eq(b1.boardT, T + 60); eq(b1.alightT, T + 300);
  ok(b1.alightT + xw.min * 60 > T + 320 + PLANNER.GRACE_S, "tb1 is not catchable");
  eq(b2.tripId, "tb2"); eq(b2.boardT, T + 600); eq(b2.alightT, T + 900);
  near(b2.wait, (600 - 300 - xw.min * 60) / 60, 1e-6);
  near(o.total, sumLegs(o), 1e-6, "total == walk + wait + ride + transfer walk + wait + ride + walk");
  near(o.arrive, T + 900 + o.legs[4].min * 60, 1e-6);
});

/* ---------- refineWalking ---------- */
const fakeWalk = (minByLeg) => async (a, b) => {
  const m = hav(a, b) * 1.3;
  const min = minByLeg ? minByLeg(a, b, m) : m / 80;
  return { m, min, coords: [[a.lat, a.lon], [(a.lat + b.lat) / 2, a.lon], [b.lat, b.lon]], source: "router" };
};

test("refineWalking replaces walk legs and recomputes totals", async () => {
  const from = { lat: stops.L3.lat + 0.002, lon: stops.L3.lon };
  const to = { lat: stops.L1.lat - 0.002, lon: stops.L1.lon };
  const d = data();
  const o = plan({ from, to, now: T, data: d }).options[0];
  const r = await refineWalking(o, { walkRoute: fakeWalk(), now: T, data: d, from, to });
  const walks = r.legs.filter((l) => l.type === "walk");
  eq(walks.length, 2);
  ok(walks.every((w) => w.source === "router" && w.coords.length === 3));
  near(walks[0].m, hav(from, stops.L3) * 1.3, 1);
  const b = busLegs(r)[0];
  near(b.boardT, T + walks[0].min * 60 + b.wait * 60, 1, "headway bus re-timed after longer walk");
  near(r.arrive, b.alightT + walks[1].min * 60, 1);
  near(r.total, (r.arrive - T) / 60, 1e-6);
  near(r.total, sumLegs(r), 1e-6, "every refined leg counted");
  near(r.walkMin, walks[0].min + walks[1].min, 1e-9, "walkMin recomputed");
  ok(r.total > o.total, "router walk is longer");
  eq(r.refined, true);
  eq(o.legs[0].source, "estimate", "input option not mutated");
});

test("refineWalking: missed live bus -> re-plan catches the next one", async () => {
  const from = { lat: stops.L3.lat + 0.0009, lon: stops.L3.lon }; // ~100 m: estimate 1.5 min
  const to = near_("L1", 0); // at the stop: no end walk
  const trips = [
    trip("t1", "LOOP", [["L3", T + 120], ["L1", T + 520]]),
    trip("t2", "LOOP", [["L3", T + 900], ["L1", T + 1300]]),
  ];
  const d = data({ trips });
  const o = plan({ from, to, now: T, data: d }).options[0];
  eq(busLegs(o)[0].boardT, T + 120, "estimate catches t1");
  const r = await refineWalking(o, { walkRoute: fakeWalk(() => 5), now: T, data: d, from, to });
  ok(r, "re-planned option");
  const b = busLegs(r)[0];
  eq(b.boardT, T + 900);
  eq(b.tripId, "t2");
  eq(r.legs[0].min, 5);
  eq(r.legs[0].source, "router");
  near(b.wait, (900 - 300) / 60, 0.01);
  eq(r.arrive, T + 1300);
  eq(r.replanned, true);
});

test("refineWalking: missed bus and nothing later -> null (drop)", async () => {
  const from = { lat: stops.L3.lat + 0.0009, lon: stops.L3.lon };
  const to = near_("L1", -0.0001);
  const d = data({ trips: [trip("t1", "LOOP", [["L3", T + 120], ["L1", T + 520]])], buses: [] });
  const o = plan({ from, to, now: T, data: d }).options[0];
  ok(o, "planned with live trip");
  const r = await refineWalking(o, { walkRoute: fakeWalk(() => 5), now: T, data: d, from, to });
  eq(r, null);
});

test("refineWalking: router walk is never shorter than the straight line", async () => {
  const d = data(), from = near_("L3"), to = { lat: stops.L1.lat - 0.002, lon: stops.L1.lon };
  const o = plan({ from, to, now: T, data: d }).options[0];
  const r = await refineWalking(o, { walkRoute: async () => ({ m: 0, min: 0, coords: [], source: "router" }), now: T, data: d, from, to });
  const w0 = r.legs[0];
  near(w0.min, hav(from, stops.L3) / 80, 1e-6, "13 m start walk floored at crow-flies");
  ok(r.total > busLegs(r)[0].wait + busLegs(r)[0].ride, "walking still in the total");
});

test("refineWalking: longer transfer walk misses the live 2nd bus -> re-planned after the walk", async () => {
  const from = near_("A0"), to = near_("B1", -0.0001), d = data({ trips: xferTrips() });
  const o = plan({ from, to, now: T, data: d }).options.find((x) => x.key === "A>B");
  const xfer = (a) => Math.abs(a.lat - stops.A2.lat) < 1e-9 && Math.abs(a.lon - stops.A2.lon) < 1e-9;
  const r = await refineWalking(o, { walkRoute: fakeWalk((a, b, m) => (xfer(a) ? 6 : m / 80)), now: T, data: d, from, to });
  ok(r, "re-planned transfer");
  eq(r.replanned, true);
  const [b1, b2] = busLegs(r);
  eq(r.legs[2].min, 6);
  ok(b2.boardT >= b1.alightT + 6 * 60 - 1, "2nd bus after the 6 min transfer walk");
  near(r.total, sumLegs(r), 1e-6);
});

test("refineWalking survives a throwing walkRoute and bad input", async () => {
  const d = data();
  const from = { lat: stops.L3.lat + 0.002, lon: stops.L3.lon };
  const o = plan({ from, to: near_("L1"), now: T, data: d }).options[0];
  const r = await refineWalking(o, { walkRoute: () => Promise.reject(new Error("x")), now: T, data: d });
  eq(r.legs[0].source, "estimate");
  near(r.total, o.total, 0.01);
  eq(await refineWalking(null, {}), null);
});

test("real network data: plans quickly and returns sane options", async () => {
  const [st, rs] = await Promise.all(["stops", "route_stops"].map((n) => fetch("../data/" + n + ".json").then((r) => r.json())));
  const rid = Object.keys(rs).sort((a, b) => rs[b].length - rs[a].length)[0];
  const list = rs[rid].filter((id) => st[id]);
  const from = { lat: st[list[0]].lat + 0.0003, lon: st[list[0]].lon };
  const to = { lat: st[list[Math.min(6, list.length - 2)]].lat - 0.0003, lon: st[list[Math.min(6, list.length - 2)]].lon };
  const d = { stops: st, routeStops: rs, trips: [], buses: Object.keys(rs).map(bus) };
  const t0 = performance.now();
  const r = plan({ from, to, now: T, data: d });
  const ms = performance.now() - t0;
  ok(ms < 1500, "plan took " + Math.round(ms) + " ms");
  ok(r.options.length >= 1 && r.options.length <= 4, "options " + r.options.length);
  for (const o of r.options) {
    ok(isFinite(o.total) && o.total > 0 && o.arrive > T);
    for (const l of busLegs(o)) ok(l.boardT >= T && l.alightT > l.boardT && l.path.length === l.stopsPassed + 1);
  }
});

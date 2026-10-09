// Tests for core/tripprogress.js (pure; fixtures in trip-fixtures.js).
import { test, eq, ok, near } from "./lib.js";
import { tripProgress, TRIP } from "../js/core/tripprogress.js";
import { NOW, stops, routes, routeStops, baseState, bus, trip, journeyR, journeyXfer, scenes } from "./trip-fixtures.js";

const scene = (id) => scenes().find((s) => s.id === id).state;
const prog = (st, now = NOW) => tripProgress(st.journey, st, now);
const busLeg = (p, n = 0) => p.legs.filter((l) => l.type === "bus")[n];
const ids = (leg) => leg.stops.map((s) => s.id);

test("tripProgress: null unless a plan journey with a bus leg", () => {
  const s = baseState();
  eq(tripProgress(null, s, NOW), null);
  eq(tripProgress({ kind: "station", rids: ["R"], label: "x" }, s, NOW), null);
  eq(tripProgress({ kind: "plan", rids: ["R"], label: "To X" }, s, NOW), null, "older journey without legs");
  eq(tripProgress({ kind: "plan", rids: [], label: "To X", legs: [{ type: "walk", min: 5, toName: "X" }] }, s, NOW), null, "walk only");
  ok(tripProgress(journeyR(), {}, NOW), "empty state does not throw");
});

test("walk-to-stop: window = 3 stops before + board..alight, bus followed by trip id, 3 stops away", () => {
  const p = prog(scene("walk")), b = busLeg(p);
  eq(p.phase, "walk-to-stop"); eq(p.to, "Medical Center Cafe");
  eq(ids(b), ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]);
  eq(b.stops.map((s) => s.role), ["before", "before", "before", "board", "ride", "ride", "alight"]);
  eq([b.boardIdx, b.alightIdx], [3, 6]);
  eq(b.vehicle.how, "trip"); eq(b.vehicle.label, "101");
  eq([b.vehicle.idx, b.vehicle.at], [0, false], "heading to the first listed stop");
  near(b.vehicle.pos, -0.5, 0.05, "between the stop before (not listed) and A1");
  eq(b.vehicle.prevName, "55th & Ellis");
  eq(b.stopsAway, 3);
  eq([b.boardEta, b.boardLive, b.alightEta, b.alightLive], [NOW + 420, true, NOW + 720, true]);
  eq(b.stops.map((s) => s.state), ["next", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
  eq(b.stops[3].eta, NOW + 420, "live ETA per stop");
  near(b.walkMin, 4.2, 0.15, "walking time from your location");
  near(b.slackMin, 7 - b.walkMin, 1e-6); eq(b.canCatch, true);
  eq(p.legs[0].state, "active"); near(p.legs[0].minNow, b.walkMin, 1e-9);
  eq(p.arriveT, NOW + 720 + 180, "live alight + final walk"); eq(p.arriveLive, true);
  eq(p.stale, ""); eq(p.live, true);
});

test("waiting: at the stop (location), bus between stops by distance", () => {
  const p = prog(scene("waiting")), b = busLeg(p);
  eq(p.phase, "waiting"); eq(p.legs[0].state, "done");
  eq(b.vehicle.idx, 1); near(b.vehicle.frac, 0.6, 0.02); near(b.vehicle.pos, 0.6, 0.02);
  eq(b.stopsAway, 2);
  eq(b.stops.map((s) => s.state).slice(0, 3), ["passed", "next", "upcoming"]);
  eq(b.stops[0].eta, null, "passed stops have no ETA");
  eq(b.boardEta, NOW + 240);
});

test("on-bus: stops before the boarding stop dropped, passed stops, stops left", () => {
  const p = prog(scene("onbus")), b = busLeg(p);
  eq(p.phase, "on-bus");
  eq(ids(b), ["A4", "A5", "A6", "A7"]);
  eq([b.boardIdx, b.alightIdx], [0, 3]);
  eq(b.vehicle.idx, 2); near(b.vehicle.pos, 1.4, 0.02);
  eq(b.stops.map((s) => s.state), ["passed", "passed", "next", "upcoming"]);
  eq([b.stopsLeft, b.stopsAway], [2, null]);
  eq(b.alightEta, NOW + 200); eq(b.alightLive, true);
});

test("on-bus: bus at a stop (within 35 m) is 'current'; at the alighting stop -> 0 stops left", () => {
  const s = scene("onbus");
  s.buses = [bus("v101", "101", "R", "tR1", "A6", "A7", 0.995)];
  s.trips = [trip("tR1", "R", "v101", "101", [["A7", 10], ["A8", 120]])];
  const b = busLeg(prog(s));
  eq([b.vehicle.idx, b.vehicle.at, b.vehicle.pos], [3, true, 3]);
  eq(b.stops[3].state, "current"); eq(b.stopsLeft, 0);
  ok(TRIP.AT_STOP_M >= 20 && TRIP.AT_STOP_M <= 60);
});

test("arrived: bus past the alighting stop -> leg done, final walk active, arrival = alight + walk", () => {
  const p = prog(scene("arrived"));
  eq(p.phase, "arrived"); eq(busLeg(p).state, "done");
  eq(busLeg(p).stops.every((s) => s.state === "passed"), true);
  const fin = p.legs[p.legs.length - 1];
  eq([fin.state, fin.final, fin.toName], ["active", true, "Medical Center Cafe"]);
  eq(p.active, p.legs.length - 1);
  eq(p.arriveT, NOW - 60 + 180);
});

test("no live data: phase from the plan's clock (byTime), planned times flagged not live", () => {
  const st = scene("schedule");
  let b = busLeg(prog(st));
  eq(prog(st).phase, "waiting", "t0 + 4 min walk is past");
  eq(ids(b), ["A4", "A5", "A6", "A7"], "no stops before the boarding stop without a live bus");
  eq([b.vehicle, b.live, b.byTime, b.boardEta, b.boardLive], [null, false, true, NOW + 120, false]);
  eq(b.alightEta, NOW + 480, "board + planned ride"); eq(b.alightLive, false);
  eq(prog({ ...st, journey: journeyR({ t0: NOW - 60, tripId: null, boardT: NOW + 120, alightT: NOW + 480 }) }).phase, "walk-to-stop");
  eq(prog(st, NOW + 300).phase, "on-bus", "after the planned boarding time");
  eq(busLeg(prog(st, NOW + 300)).stops[0].state, "passed");
  eq(prog(st, NOW + 600).phase, "arrived", "after the planned arrival");
  eq(prog({ ...st, user: { lat: stops.A4.lat, lon: stops.A4.lon } }, NOW + 300).phase, "waiting", "your location says you are still at the stop");
});

test("no trip id: follows the next OPERATING bus arriving at the boarding stop (arrivalsFor)", () => {
  const s = baseState({ journey: journeyR({ tripId: null }), user: { lat: stops.A4.lat, lon: stops.A4.lon },
    buses: [bus("v7", "7", "R", "t7", "A2", "A3", 0.5)],
    trips: [trip("t6", "R", "v6", "6", [["A4", 60]]), trip("t7", "R", "v7", "7", [["A3", 50], ["A4", 200], ["A7", 500]])] });
  const b = busLeg(prog(s));
  eq(b.vehicle.how, "next"); eq(b.vehicle.label, "7", "t6 has no operating bus: skipped");
  eq([b.stopsAway, b.boardEta, b.alightEta], [1, NOW + 200, NOW + 500]);
  s.trips = [];
  const n = busLeg(prog(s));
  eq([n.vehicle.label, n.vehicle.how, n.stopsAway, n.boardEta], ["7", "next", 1, null], "no predictions: nearest bus before the stop, no invented time");
});

test("walking to the stop: a bus that passes it before you can get there is not followed (QA 2026-10-09)", () => {
  // you are ~1.2 km (about 18 min) from the boarding stop A4; the planned bus is a schedule estimate in 25 min
  const far = { lat: stops.A4.lat - 0.0108, lon: stops.A4.lon };
  const j = journeyR({ t0: NOW - 30, tripId: null, boardT: NOW + 1500, alightT: NOW + 1800, walk: 18 });
  // no predictions at all: the bus 1 stop away would be gone long before you arrive
  const s = baseState({ journey: j, user: far, buses: [bus("v7", "7", "R", "t7", "A2", "A3", 0.5)], trips: [] });
  let b = busLeg(prog(s));
  eq(prog(s).phase, "walk-to-stop");
  eq([b.vehicle, b.byTime, b.boardEta, b.boardLive], [null, true, NOW + 1500, false], "the plan's (estimated) time, not a bus you cannot reach");
  // live predictions: skip the one arriving in 2 min, follow the one you can catch
  s.buses = [bus("v7", "7", "R", "t7", "A2", "A3", 0.5), bus("v8", "8", "R", "t8", "A0", "A1", 0.2)];
  s.trips = [trip("t7", "R", "v7", "7", [["A3", 40], ["A4", 120]]), trip("t8", "R", "v8", "8", [["A1", 700], ["A4", 1300], ["A7", 1700]])];
  b = busLeg(prog(s));
  eq([b.vehicle.label, b.boardEta, b.boardLive], ["8", NOW + 1300, true]);
  eq(b.canCatch, true, "the followed bus is catchable on foot");
  // at the stop you can take the bus that is 1 stop away (unchanged)
  const at = busLeg(prog({ ...s, user: { lat: stops.A4.lat, lon: stops.A4.lon } }));
  eq(at.vehicle.label, "7");
});

test("planned trip is the vehicle's NEXT trip: it is coming, not 'past your stop' (no instant 'arrived', QA 2026-10-09)", () => {
  // loop L = A0..A8 -> A0; you ride A4 -> A6 on trip next1; vehicle v9 is still on trip prev1, heading to A7
  const L = ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A0"];
  const j = { kind: "plan", rids: ["L"], label: "To X", to: "X", t0: NOW - 30, legs: [
    { type: "walk", min: 1, toName: "Ratner Center" },
    { type: "bus", rid: "L", board: { id: "A4", name: "Ratner Center" }, alight: { id: "A6", name: "59th & Ellis" }, tripId: "next1", boardT: NOW + 500, alightT: NOW + 620, source: "live", waitLive: true },
    { type: "walk", min: 2, toName: "X" }] };
  const s = baseState({ journey: j, routes: { ...baseState().routes, L: { short: "L", long: "Loop", color: "#0A84FF" } }, routeStops: { ...baseState().routeStops, L },
    user: { lat: stops.A4.lat, lon: stops.A4.lon }, buses: [bus("v9", "9", "L", "prev1", "A6", "A7", 0.5)],
    trips: [trip("prev1", "L", "v9", "9", [["A7", 30], ["A8", 90]]), trip("next1", "L", "v9", "9", [["A0", 200], ["A1", 260], ["A2", 330], ["A3", 400], ["A4", 500], ["A5", 560], ["A6", 620]])] });
  const p = prog(s), b = busLeg(p);
  eq(p.phase, "waiting", "not arrived the moment the trip starts");
  eq([b.vehicle.label, b.vehicle.how, b.vehicle.idx], ["9", "trip", -1], "coming round the loop");
  eq([b.boardEta, b.boardLive, b.alightEta], [NOW + 500, true, NOW + 620], "ETAs from YOUR trip's predictions");
});

test("missed: you are still at the stop after the planned bus left -> next bus followed", () => {
  const p = prog(scene("missed")), b = busLeg(p);
  eq(p.phase, "waiting"); eq(b.missed, true);
  eq([b.vehicle.label, b.vehicle.how, b.stopsAway], ["102", "next", 3]);
  eq(b.boardEta, NOW + 450);
  // without your location the planned bus is assumed to carry you
  const q = prog({ ...scene("missed"), user: null });
  eq([q.phase, busLeg(q).vehicle.label, busLeg(q).missed], ["on-bus", "101", false]);
});

test("transfer: first leg on-bus, second upcoming with its live times; loop previous lap = behind", () => {
  const p = prog(scene("transfer")), [b1, b2] = p.legs.filter((l) => l.type === "bus");
  eq(p.phase, "on-bus"); eq(p.active, 1);
  eq(ids(b1), ["A1", "A2", "A3", "A4"]); eq(b1.stopsLeft, 2);
  eq([b2.state, b2.phase], ["upcoming", "upcoming"]);
  eq(ids(b2), ["B0", "B1", "B2", "B3"]);
  eq([b2.vehicle.idx, b2.vehicle.behind], [-1, 1], "bus heading to B3 on its previous lap is 1 stop before B0");
  eq(b2.stopsAway, 1);
  eq(b2.stops.map((s) => s.eta), [NOW + 400, NOW + 520, NOW + 640, NOW + 860], "ETAs matched in order (first B3 skipped)");
  eq(p.legs[2].state, "upcoming"); eq(p.legs[2].toName, "Ratner East");
  eq(p.arriveT, NOW + 860 + 300);
});

test("loop: board..alight wraps past the loop start; before-stops wrap too", () => {
  const j = { kind: "plan", rids: ["G"], label: "To X", to: "X", t0: NOW, legs: [
    { type: "bus", rid: "G", board: { id: "B2", name: "Harper Court" }, alight: { id: "B0", name: "Ratner East" }, tripId: null, boardT: NOW + 300, alightT: NOW + 700 }] };
  const live = baseState({ buses: [bus("vg", "5", "G", "tg", "B0", "B1", 0.5)], trips: [trip("tg", "G", "vg", "5", [["B1", 60], ["B2", 200], ["B3", 400], ["B0", 600]])] });
  const b = busLeg(tripProgress(j, live, NOW));
  eq(ids(b), ["B1", "B2", "B3", "B0"], "1 stop before (B0 is in the path), then B2 -> B3 -> B0");
  eq(b.stops.map((s) => s.role), ["before", "board", "ride", "alight"]);
  eq([b.vehicle.how, b.vehicle.idx, b.stopsAway, b.boardEta, b.alightEta], ["next", 0, 1, NOW + 200, NOW + 600]);
  eq(tripProgress(j, live, NOW).phase, "waiting", "no walk before the first bus");
  eq(ids(busLeg(tripProgress(j, baseState(), NOW))), ["B2", "B3", "B0"], "no live bus: board..alight only");
});

test("stale feed and old vehicle report are flagged", () => {
  const p = prog(scene("stale")), b = busLeg(p);
  eq(p.stale, "old");
  eq(b.vehicle.stale, true); eq(b.vehicle.seen, NOW - 130);
  ok(TRIP.BUS_STALE_S === 60);
});

test("planned trip gone long after its arrival time -> that ride counts as done", () => {
  const s = baseState({ journey: journeyR({ t0: NOW - 3600, boardT: NOW - 2400, alightT: NOW - 1800 }), buses: [], trips: [] });
  eq(prog(s).phase, "arrived");
  const later = baseState({ journey: journeyR({ t0: NOW - 3600, tripId: "gone", boardT: NOW - 2400, alightT: NOW - 1800 }),
    buses: [bus("v9", "9", "R", "t9", "A5", "A6", 0.5)], trips: [] });
  eq(prog(later).phase, "arrived", "another bus between the stops is not mistaken for yours");
});

test("journey transfer fixture keeps walk names and order", () => {
  const p = tripProgress(journeyXfer(), baseState(), NOW);
  eq(p.legs.map((l) => l.type), ["walk", "bus", "walk", "bus", "walk"]);
  eq(p.legs[4].final, true);
});

test("shared trip id: Passio gives several buses one trip_id; the planned VEHICLE is followed (QA 2026-10-09)", async () => {
  // live data showed five DCC buses on trip 874028; following by trip id alone picked whichever came first
  const { plan } = await import("../js/core/planner.js");
  const j = journeyR({ tripId: "tS", boardT: NOW + 420, alightT: NOW + 720 });
  j.legs[1].vehicleId = "v102";
  const s = baseState({ journey: j, user: { lat: stops.A4.lat - 0.0025, lon: stops.A4.lon },
    buses: [bus("v101", "101", "R", "tS", "A6", "A7", 0.5), bus("v102", "102", "R", "tS", "A0", "A1", 0.5)],
    trips: [trip("tS", "R", "v101", "101", [["A7", 60], ["A8", 160]]), trip("tS", "R", "v102", "102", [["A1", 90], ["A4", 420], ["A7", 720]])] });
  const b = busLeg(prog(s));
  eq([b.vehicle.label, b.boardEta, b.alightEta, prog(s).phase], ["102", NOW + 420, NOW + 720, "walk-to-stop"], "bus 102 and ITS predictions, not bus 101 past the stop");
  // the planner records which vehicle's prediction it used
  const r = plan({ from: { lat: stops.A4.lat, lon: stops.A4.lon }, to: { lat: stops.A7.lat, lon: stops.A7.lon + 0.0005 }, now: NOW,
    data: { stops, routes, routeStops: { R: routeStops.R }, trips: s.trips, buses: s.buses } });
  const leg = r.options.flatMap((o) => o.legs).find((l) => l.type === "bus" && l.tripId === "tS");
  ok(leg && leg.vehicleId === "v102", "bus leg carries vehicleId: " + JSON.stringify(r.options.map((o) => o.legs.map((l) => l.type === "bus" ? [l.rid, l.board.id, l.alight.id, l.tripId, l.vehicleId, l.waitLive] : ["walk", Math.round(l.m)]))) + " walkOnly " + JSON.stringify(r.walkOnly));
});

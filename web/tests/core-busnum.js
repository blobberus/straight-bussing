// core/busnum.js (core.test.html): bus numbers on a line, the picked bus, its own times (owner 2026-10-30).
import { test, eq, ok } from "./lib.js";
import { busKey, compareIds, busNumbers, busName, selectedBus, busArrival, pickCheck, PICK_HOLD_S,
  numberRoutes, numberStep, NUM_HOLD_S, RULE_HOLD_S, routeNumbers, numberMap, busNumber, arrivalKey, arrivalBusName, legBusName } from "../js/core/busnum.js";

const bus = (id, rid, label) => ({ vehicle: { id, label }, trip: { route_id: rid }, position: { latitude: 41.79, longitude: -87.6 } });

test("busnum: a route with 2 or more buses numbers them in vehicle id order; one bus gets no number", () => {
  const n = busNumbers([bus("4325", "A", "4325"), bus("4320", "A", "4320"), bus("12644", "A", "12644"), bus("9", "B", "9")]);
  eq([n.get("4320"), n.get("4325"), n.get("12644")], [1, 2, 3], "numeric order: 4320 < 4325 < 12644 (not text order)");
  eq(n.has("9"), false, "the only bus on B has no number");
});

test("busnum: names stay put while the same buses run, whatever order the feed lists them", () => {
  const a = busNumbers([bus("7", "A"), bus("3", "A")]), b = busNumbers([bus("3", "A"), bus("7", "A")]);
  eq([...a.entries()].sort(), [...b.entries()].sort());
  eq(a.get("3"), 1);
});

test("busnum: text ids sort as text, mixed ids too; duplicates and buses without id or route are ignored", () => {
  eq(compareIds("10", "9") > 0, true, "numbers compare as numbers");
  eq(compareIds("bus-b", "bus-a") > 0, true);
  const n = busNumbers([bus("b2", "A"), bus("a1", "A"), bus("a1", "A"), { vehicle: {}, trip: { route_id: "A" } }, bus("x", null)]);
  eq([n.get("a1"), n.get("b2"), n.size], [1, 2, 2]);
});

test("busnum: busKey takes the vehicle id, else its label", () => {
  eq(busKey(bus("v1", "A", "101")), "v1");
  eq(busKey({ vehicle: { label: "101" } }), "101");
  eq(busKey({ vehicle: {} }), null);
  eq(busKey(null), null);
});

test("busnum: names: Bus 2 on a busy line, else the fleet label, else This bus", () => {
  const list = [bus("v2", "A", "202"), bus("v1", "A", "101"), bus("v9", "B", "909")], n = busNumbers(list);
  eq(busName(list[0], n), "Bus 2");
  eq(busName(list[2], n), "Bus 909");
  eq(busName({ vehicle: {} }, n), "This bus");
});

test("busnum: the picked bus only on its own route page and only while it is shown", () => {
  const buses = [bus("v1", "A", "101"), bus("v2", "A", "202")];
  const s = { view: "route", routeId: "A", busId: "v2", buses };
  eq(busKey(selectedBus(s)), "v2");
  eq(selectedBus({ ...s, view: "nearby" }), null, "another view");
  eq(selectedBus({ ...s, routeId: "B" }), null, "another route");
  eq(selectedBus({ ...s, buses: [buses[0]] }), null, "no longer shown");
  eq(selectedBus({ ...s, busId: null }), null);
});

test("busnum: a bus's own time at a stop, never another bus's", () => {
  const arr = [{ t: 100, vehicleId: "v1" }, { t: 200, vehicleId: "v2" }, { t: 300, vehicleId: "v2" }];
  eq(busArrival(arr, "v2").t, 200);
  eq(busArrival(arr, "v3"), null, "no prediction for that bus: no time");
  eq(busArrival(arr, null), null);
});

test("busnum: a picked bus left out of a poll keeps its pick for PICK_HOLD_S; leaving the route page lets go at once", () => {
  const bus = { id: "4320", vehicle: { id: "4320" }, trip: { route_id: "R1" } };
  const on = { view: "route", routeId: "R1", busId: "4320", buses: [bus] };
  const gone = { ...on, buses: [] };
  eq(pickCheck(on, 0, 1000), { clear: false, goneSince: 0 });
  let r = pickCheck(gone, 0, 1000);
  eq(r, { clear: false, goneSince: 1000 }, "first poll without it: keep, start the clock");
  r = pickCheck(gone, r.goneSince, 1000 + PICK_HOLD_S - 1);
  eq(r.clear, false, "still within the hold");
  eq(pickCheck(on, r.goneSince, 1000 + 20), { clear: false, goneSince: 0 }, "back again: the clock resets");
  eq(pickCheck(gone, 1000, 1000 + PICK_HOLD_S).clear, true, "missing for the whole hold: let go");
  eq(pickCheck({ ...on, view: "nearby" }, 0, 1000).clear, true, "left the route page: let go at once");
  eq(pickCheck({ view: "route", busId: null }, 0, 1000), { clear: false, goneSince: 0 });
});

// ---- arrivals name their bus (owner 2026-11-06: "it should state which bus number displayed on the route is about to
// arrive if there is more than 1 bus") and the numbers hold through a feed gap

test("busnum: numberRoutes groups by route; a route with one bus gets none", () => {
  eq(numberRoutes([["4325", "A"], ["4320", "A"], ["9", "B"], [null, "A"], ["x", ""]]), { A: { 4320: 1, 4325: 2 } });
  eq(numberRoutes([]), {});
});

test("busnum: numberStep keeps a bus left out of a poll in its place for NUM_HOLD_S, then renumbers", () => {
  const all = [bus("4320", "A"), bus("4325", "A"), bus("4330", "A")];
  let r = numberStep(null, all, { nowS: 1000 });
  eq(r.routes, { A: { 4320: 1, 4325: 2, 4330: 3 } });
  r = numberStep(r.seen, all.slice(1), { nowS: 1010 });
  eq(r.routes.A, { 4320: 1, 4325: 2, 4330: 3 }, "4320 missing from one poll: everyone keeps their number");
  r = numberStep(r.seen, all.slice(1), { nowS: 1010 + NUM_HOLD_S });
  eq(r.routes.A["4325"], 2, "still within the hold (counted from the first poll without it)");
  r = numberStep(r.seen, all.slice(1), { nowS: 1011 + NUM_HOLD_S });
  eq(r.routes.A, { 4325: 1, 4330: 2 }, "gone longer: the line renumbers in vehicle id order");
  r = numberStep(r.seen, all, { nowS: 1100 });
  eq(r.routes.A, { 4320: 1, 4325: 2, 4330: 3 }, "it joins again: vehicle id order, the same numbers on every phone");
});

test("busnum: numberStep lets a bus more than a block off its route go at once; an empty poll lets every bus go", () => {
  const two = [bus("1", "A"), bus("2", "A")];
  let r = numberStep(null, two, { nowS: 0 });
  eq(numberStep(r.seen, two.slice(1), { nowS: 10, away: [two[0]] }).routes, {}, "away (core/offroute.js): no hold, one bus left = no number");
  eq(numberStep(r.seen, two.slice(1), { nowS: 10, away: ["1"] }).routes, {}, "away as keys too");
  eq(numberStep(r.seen, [], { nowS: 10 }).routes, {}, "no bus at all: nothing held");
  r = numberStep(r.seen, two.slice(1), { nowS: 10 });
  eq(r.routes, { A: { 1: 1, 2: 2 } }, "a plain drop-out is held");
  eq(numberStep(r.seen, [bus("1", "B"), bus("2", "A")], { nowS: 20 }).routes, {}, "back on another route: it counts there, not twice");
});

test("busnum: a bus a rule hides keeps its number place RULE_HOLD_S, so a blink off and on renumbers nobody (owner 2026-11-11)", () => {
  eq(RULE_HOLD_S, 900, "15 min (RouteKnower E32c)");
  const three = [bus("4320", "A"), bus("4325", "A"), bus("4330", "A")];
  let r = numberStep(null, three, { nowS: 0 });
  const blink = [three[1]];                                       // 4325 off its route: store.away and held
  r = numberStep(r.seen, [three[0], three[2]], { nowS: 10, away: blink, held: blink });
  eq(r.routes.A, { 4320: 1, 4325: 2, 4330: 3 }, "hidden: 4330 stays Bus 3 (it was Bus 2 at once before)");
  r = numberStep(r.seen, [three[0], three[2]], { nowS: 10 + RULE_HOLD_S, away: blink, held: blink });
  eq(r.routes.A["4330"], 3, "still within the hold (counted from the hide)");
  const back = numberStep(r.seen, three, { nowS: 20 + RULE_HOLD_S });
  eq(back.routes.A, { 4320: 1, 4325: 2, 4330: 3 }, "shown again: the same numbers");
  r = numberStep(r.seen, [three[0], three[2]], { nowS: 11 + RULE_HOLD_S, away: blink, held: blink });
  eq(r.routes.A, { 4320: 1, 4330: 2 }, "hidden longer: the line renumbers without it, at once");
  r = numberStep(r.seen, [three[0], three[2]], { nowS: 30 + RULE_HOLD_S, away: blink, held: blink });
  eq(r.routes.A, { 4320: 1, 4330: 2 }, "still hidden: its place is not given back (no flip)");
  r = numberStep(r.seen, [three[0], three[2]], { nowS: 40 + RULE_HOLD_S });
  eq(r.routes.A, { 4320: 1, 4330: 2 }, "then silent: no 45 s drop-out place either");
  const idle = [bus("1", "A"), bus("2", "A")];
  r = numberStep(null, idle, { nowS: 0 });
  r = numberStep(r.seen, idle.slice(1), { nowS: 600, held: idle.slice(0, 1) });
  eq(r.routes, { A: { 1: 1, 2: 2 } }, "idle (core/idle.js, not away): held too; the one shown bus keeps 'Bus 2'");
  r = numberStep(r.seen, idle.slice(1), { nowS: 610 });
  eq(r.routes, { A: { 1: 1, 2: 2 } }, "a held bus that stops reporting: the usual 45 s drop-out hold");
  eq(numberStep(r.seen, idle.slice(1), { nowS: 611 + NUM_HOLD_S }).routes, {}, "then it goes");
  const fresh = numberStep(null, idle.slice(1), { nowS: 0, held: idle.slice(0, 1) });
  eq(fresh.routes, { A: { 1: 1, 2: 2 } }, "after a reload a hidden bus gets its place from the first poll");
  eq(numberStep(fresh.seen, [], { nowS: 10, held: idle.slice(0, 1) }).routes, {}, "no bus shown at all: nothing held");
  eq(numberStep(null, [bus("2", "A")], { nowS: 0, held: [bus("1", "B")] }).routes, {}, "a place counts on the hidden bus's own route only");
});

test("busnum: routeNumbers reads store.busNums while it belongs to the shown buses, else numbers store.buses", () => {
  const buses = [bus("v1", "A"), bus("v2", "A")];
  const held = { of: buses, routes: { A: { v0: 1, v1: 2, v2: 3 } } };
  eq(routeNumbers({ buses, busNums: held }), held.routes, "data/live.js numbers (with a held bus)");
  eq(routeNumbers({ buses: buses.slice(), busNums: held }), { A: { v1: 1, v2: 2 } }, "a list built elsewhere: numbered from it");
  eq(routeNumbers({ buses }), { A: { v1: 1, v2: 2 } });
  eq(routeNumbers(null), {});
  eq([...numberMap({ buses, busNums: held })].sort(), [["v0", 1], ["v1", 2], ["v2", 3]]);
  eq([busNumber({ buses }, "A", "v2"), busNumber({ buses }, "B", "v2"), busNumber({ buses }, "A", null)], [2, 0, 0], "the number is the route's own");
});

test("busnum: an arrival names the numbered bus that makes it, else nothing (never a guess)", () => {
  const S = { buses: [bus("v1", "A", "101"), bus("v2", "A", "202"), bus("v9", "B", "909")] };
  eq(arrivalBusName(S, { rid: "A", vehicleId: "v2", bus: "202" }), "Bus 2");
  eq(arrivalBusName(S, { rid: "A", vehicleId: "v1", bus: "101" }), "Bus 1");
  eq(arrivalBusName(S, { rid: "B", vehicleId: "v9", bus: "909" }), "", "one bus on the line: no number");
  eq(arrivalBusName(S, { rid: "A", vehicleId: null, bus: null }), "", "no vehicle on the trip update");
  eq(arrivalBusName(S, { rid: "A", vehicleId: "v7", bus: "707" }), "", "a vehicle the app does not show");
  eq(arrivalBusName(S, { rid: "B", vehicleId: "v2", bus: "202" }), "", "Bus 2 of route A predicted on route B: not this route's number");
  eq(arrivalBusName({ buses: [{ vehicle: { label: "L1" }, trip: { route_id: "A" } }, { vehicle: { label: "L2" }, trip: { route_id: "A" } }] },
    { rid: "A", vehicleId: null, bus: "L2" }), "Bus 2", "no vehicle ids anywhere: the label is the key, as on the map");
  eq([arrivalKey({ vehicleId: "v1", bus: "101" }), arrivalKey({ vehicleId: "", bus: "101" }), arrivalKey({})], ["v1", "101", null]);
  eq(arrivalBusName(S, null), "");
});

test("busnum: a planned bus leg names its bus only with a live boarding time", () => {
  const S = { buses: [bus("v1", "A"), bus("v2", "A")] };
  eq(legBusName(S, { type: "bus", rid: "A", vehicleId: "v2", waitLive: true }), "Bus 2");
  eq(legBusName(S, { type: "bus", rid: "A", vehicleId: "v2", waitLive: false }), "", "schedule time: no bus");
  eq(legBusName(S, { type: "bus", rid: "A", vehicleId: null, waitLive: true }), "");
  eq(legBusName(S, { type: "walk" }), "");
});

// core/busnum.js (core.test.html): bus numbers on a line, the picked bus, its own times (owner 2026-10-30).
import { test, eq, ok } from "./lib.js";
import { busKey, compareIds, busNumbers, busName, selectedBus, busArrival, pickCheck, PICK_HOLD_S } from "../js/core/busnum.js";

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

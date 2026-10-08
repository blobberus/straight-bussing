// Tests for core/arrivals.js
import { test, eq, ok } from "./lib.js";
import { arrivalsFor, staleLevel, runningCount, activeAlerts, alertText } from "../js/core/arrivals.js";

const T = 1_800_000_000;
const trips = [
  { trip: { trip_id: "t1", route_id: "R1" }, vehicle: { id: "v1", label: "101" },
    stop_time_update: [{ stop_id: "S", arrival: { time: T + 600 } }, { stop_id: "X", arrival: { time: T + 700 } }] },
  { trip: { trip_id: "t2", route_id: "R2" }, vehicle: { id: "v2", label: "202" },
    stop_time_update: [{ stop_id: "S", arrival: { time: T + 120 } }] },
  { trip: { trip_id: "t3", route_id: "R1" }, vehicle: { id: "v3" },
    stop_time_update: [{ stop_id: "S", departure: { time: T - 20 } }, { stop_id: "S", arrival: { time: T + 1800 } }] },
  { trip: { trip_id: "t4", route_id: "R3" }, vehicle: { id: "v4", label: "4" },
    stop_time_update: [{ stop_id: "S", arrival: { time: T - 31 } }, { stop_id: "S", arrival: {} }] },
  { trip: { trip_id: "t5" }, stop_time_update: [{ stop_id: "S", arrival: { time: T + 5 } }] }, // no route id
];

test("arrivalsFor sorts ascending and keeps recent past (> now-30)", () => {
  const r = arrivalsFor({ trips }, "S", { nowS: T });
  eq(r.map((a) => a.t - T), [-20, 120, 600, 1800]);
  eq(r[1], { rid: "R2", t: T + 120, bus: "202", tripId: "t2" });
  eq(r[0].bus, null, "missing label -> null");
  eq(r[0].tripId, "t3");
});
test("arrivalsFor excludes hidden routes", () => {
  const r = arrivalsFor({ trips }, "S", { nowS: T, hidden: ["R1"] });
  eq(r.map((a) => a.rid), ["R2"]);
});
test("arrivalsFor with routeId ignores hidden and filters route", () => {
  const r = arrivalsFor({ trips }, "S", { nowS: T, routeId: "R1", hidden: ["R1"] });
  eq(r.map((a) => a.t - T), [-20, 600, 1800]);
});
test("arrivalsFor numeric ids and empty inputs", () => {
  eq(arrivalsFor({ trips: [{ trip: { route_id: 7, trip_id: 9 }, stop_time_update: [{ stop_id: 55, arrival: { time: T + 60 } }] }] }, "55", { nowS: T }),
    [{ rid: "7", t: T + 60, bus: null, tripId: "9" }]);
  eq(arrivalsFor({ trips: [] }, "S", { nowS: T }), []);
  eq(arrivalsFor({}, "S", { nowS: T }), []);
  eq(arrivalsFor({ trips: null }, "S"), []);
});

test("staleLevel levels", () => {
  eq(staleLevel({ lastOk: 0, failed: false, feedTs: 0 }, T), "err", "never ok");
  eq(staleLevel({ lastOk: T - 5, failed: true, feedTs: T - 5 }, T), "err", "failed");
  eq(staleLevel({ lastOk: T - 61, failed: false, feedTs: T - 61 }, T), "err", ">60 s since ok");
  eq(staleLevel({ lastOk: T - 60, failed: false, feedTs: T - 10 }, T), "", "exactly 60 s ok");
  eq(staleLevel({ lastOk: T - 5, failed: false, feedTs: T - 301 }, T), "old");
  eq(staleLevel({ lastOk: T - 5, failed: false, feedTs: T - 300 }, T), "late");
  eq(staleLevel({ lastOk: T - 5, failed: false, feedTs: T - 121 }, T), "late");
  eq(staleLevel({ lastOk: T - 5, failed: false, feedTs: T - 120 }, T), "");
  eq(staleLevel({ lastOk: T - 5, failed: false, feedTs: 0 }, T), "", "no feed ts");
  eq(staleLevel({}, T), "err");
});

test("runningCount", () => {
  const buses = [{ trip: { route_id: "R1" } }, { trip: { route_id: "R1" } }, { trip: { route_id: "R2" } }, { trip: null }, null];
  eq(runningCount({ buses }, "R1"), 2);
  eq(runningCount({ buses }, "R9"), 0);
  eq(runningCount({}, "R1"), 0);
});

test("activeAlerts periods", () => {
  const alerts = [
    { id: "always" },
    { id: "now", active_period: [{ start: T - 10, end: T + 10 }] },
    { id: "past", active_period: [{ start: T - 100, end: T - 1 }] },
    { id: "future", active_period: [{ start: T + 1 }] },
    { id: "openEnd", active_period: [{ start: T - 1 }] },
    { id: "multi", active_period: [{ start: T - 100, end: T - 50 }, { end: T + 5 }] },
    null,
  ];
  eq(activeAlerts({ alerts }, T).map((a) => a.id), ["always", "now", "openEnd", "multi"]);
  eq(activeAlerts({}, T), []);
});

test("alertText", () => {
  eq(alertText({ translation: [{ text: " Detour " }] }), "Detour");
  eq(alertText({ translation: [{ language: "es", text: "Desvio" }, { language: "en", text: "Detour" }] }), "Detour");
  eq(alertText("plain"), "plain");
  eq(alertText(null), "");
  eq(alertText({}), "");
  ok(true);
});

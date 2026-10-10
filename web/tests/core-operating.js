// Tests for core/operating.js (which live vehicles are in service) and its use in data/live.js.
import { test, eq, ok } from "./lib.js";
import { isOperating, operatingBuses, STALE_S, scheduledRoutes, silentService, scheduledNoLive, noLiveStatus, silentText } from "../js/core/operating.js";
import { startLive } from "../js/data/live.js";
import { createStore } from "../js/core/store.js";

// Thu 2026-10-08 00:20 Chicago (CDT) = 05:20Z: the NIGHT route's after-midnight tail, DAY ended at 21:00
const NOW = 1791427200 + 2 * 3600 + 40 * 60;
const routes = { DAY: { short: "D" }, NIGHT: { short: "N" }, X: { short: "X" } };
const day = (first, last) => ({ first, last, trips: 10, buses: Array(24).fill(1) });
const week = (d) => ({ mon: d, tue: d, wed: d, thu: d, fri: d, sat: d, sun: d });
const service = { routes: {
  DAY: { days: week(day("07:00", "21:00")), exceptions: [] },      // ended at 21:00
  NIGHT: { days: week(day("16:00", "28:29")), exceptions: [] },    // runs past midnight
} };
const bus = (id, rid, ts, trip = "t-" + id) => ({ vehicle: { id }, trip: { trip_id: trip, route_id: rid }, position: { latitude: 41.79, longitude: -87.6 }, timestamp: ts });
const ctx = (over = {}) => ({ routes, service, trips: [], feedTs: NOW, nowS: NOW, staticLoaded: true, ...over });

test("operating: a vehicle that stopped reporting is a ghost (feed clock, not the phone's)", () => {
  ok(isOperating(bus("a", "NIGHT", NOW - 30), ctx()));
  ok(isOperating(bus("a", "NIGHT", NOW - STALE_S), ctx()), "exactly 5 min old still shown");
  ok(!isOperating(bus("a", "NIGHT", NOW - 30919), ctx()), "8.6 h old ghost hidden");
  ok(isOperating(bus("a", "NIGHT", NOW - 30), ctx({ nowS: NOW + 3 * 3600 })), "phone clock 3 h ahead: judged by the feed time");
});

test("operating: unknown routes are not shown", () => {
  ok(!isOperating(bus("a", "GARAGE", NOW), ctx()));
  ok(!isOperating({ ...bus("a", "NIGHT", NOW), trip: {} }, ctx()), "no route at all");
});

test("operating: out-of-service route hidden unless its trip still has live predictions", () => {
  ok(isOperating(bus("n", "NIGHT", NOW), ctx()), "night route scheduled after midnight span");
  ok(!isOperating(bus("d", "DAY", NOW), ctx()), "day route ended at 21:00, no predictions: deadheading");
  const trips = [{ trip: { trip_id: "late" }, stop_time_update: [{ stop_id: "S", arrival: { time: NOW + 240 } }] }];
  ok(isOperating(bus("d", "DAY", NOW, "late"), ctx({ trips })), "finishing a late last trip");
  const old = [{ trip: { trip_id: "late" }, stop_time_update: [{ stop_id: "S", arrival: { time: NOW - 600 } }] }];
  ok(!isOperating(bus("d", "DAY", NOW, "late"), ctx({ trips: old })), "only past predictions: not operating");
  ok(isOperating(bus("x", "X", NOW), ctx()), "route without schedule data is not hidden");
});

test("operating: before static data loads only freshness counts; list keeps order", () => {
  ok(isOperating(bus("a", "GARAGE", NOW), ctx({ staticLoaded: false })));
  ok(!isOperating(bus("a", "GARAGE", NOW - 9999), ctx({ staticLoaded: false })));
  const list = [bus("1", "NIGHT", NOW), bus("2", "DAY", NOW), bus("3", "NIGHT", NOW - 99999), bus("4", "NIGHT", NOW - 5)];
  eq(operatingBuses(list, ctx()).map((b) => b.vehicle.id), ["1", "4"]);
  eq(operatingBuses(null, ctx()), []);
});

// Silent service (2026-10-10): fresh feed, no vehicles, routes scheduled -> never "no shuttles running".
const st = (over = {}, at = NOW) => ({ routes, service, staticLoaded: true, liveLoaded: true, buses: [], trips: [], lastOk: at - 5, failed: false, feedTs: at - 5, ...over });

test("silent service: an empty fresh feed while a route is scheduled is not 'no service'", () => {
  eq(scheduledRoutes(st(), NOW), ["NIGHT"], "DAY ended at 21:00; X has no schedule data");
  eq(scheduledRoutes(st(), NOW, { hidden: ["NIGHT"] }), []);
  eq(scheduledRoutes(st(), NOW, { among: ["DAY", "NIGHT"] }), ["NIGHT"]);
  eq(scheduledRoutes(st({ staticLoaded: false }), NOW), [], "before static data");
  ok(silentService(st(), NOW), "night route scheduled, nothing reporting");
  ok(silentService(st({ hiddenRoutes: ["NIGHT"] }), NOW), "hidden routes still count");
  ok(!silentService(st({ buses: [bus("n", "NIGHT", NOW)] }), NOW), "a bus is reporting");
  ok(!silentService(st({ lastOk: 0, failed: true }), NOW), "feed outage: liveUnknown wording instead");
  ok(!silentService(st({ liveLoaded: false }), NOW), "first poll pending");
  const dawn = NOW + 5 * 3600;   // Thu 5:20 AM: night service over, day service not started
  ok(!silentService(st({}, dawn), dawn), "nothing scheduled: honestly no service");
});

test("silent service: per-route status", () => {
  ok(scheduledNoLive(st(), "NIGHT", NOW));
  ok(!scheduledNoLive(st({ buses: [bus("n", "NIGHT", NOW)] }), "NIGHT", NOW), "has a bus");
  ok(!scheduledNoLive(st(), "DAY", NOW), "not scheduled now");
  ok(!scheduledNoLive(st(), "X", NOW), "no schedule data");
  ok(!scheduledNoLive(st({ staticLoaded: false }), "NIGHT", NOW), "no static data yet");
  eq(noLiveStatus(st(), "NIGHT", NOW), "Scheduled until 4:29 AM, no live location");
  eq(noLiveStatus(st(), "DAY", NOW), null);
});

test("silent service: silentText names the routes, their scheduled end and the official phone", () => {
  const nightTo = (last) => ({ days: week(day("16:00", last)), exceptions: [] });
  const s = { routes: { N1: { long: "North" }, S1: { long: "South" }, E1: { long: "East" }, M: { short: "M" } },
    service: { routes: { N1: nightTo("28:29"), S1: nightTo("28:25"), E1: nightTo("28:29"), M: nightTo("28:29") } } };
  eq(silentText(s, ["N1"], NOW, "773.702.8181"), "The schedule shows the North route in service until 4:29 AM, but no bus is sending its location, so we can't confirm it's running. Call 773.702.8181 before you rely on it.");
  eq(silentText(s, ["N1", "S1", "E1"], NOW, "773.702.8181"), "The schedule shows the North and East routes in service until 4:29 AM and the South route until 4:25 AM, but no bus is sending its location, so we can't confirm they're running. Call 773.702.8181 before you rely on them.");
  eq(silentText(s, ["N1", "S1", "E1", "M"], NOW), "The schedule shows 4 routes in service now, but no bus is sending its location, so we can't confirm they're running.");
  eq(silentText(s, [], NOW), "Some hidden routes are scheduled now, but no bus is sending its location, so we can't confirm they're running.");
  ok(!/No shuttles (are )?running|Not running/.test(silentText(s, ["N1"], NOW)), "never claims no service");
});

test("live: store.buses holds only operating vehicles", async () => {
  const feeds = {
    vehiclePositions: { header: { timestamp: NOW }, entity: [
      { vehicle: bus("ok", "NIGHT", NOW - 6) }, { vehicle: bus("ghost", "NIGHT", NOW - 30919) },
      { vehicle: bus("deadhead", "DAY", NOW - 5) }] },
    tripUpdates: { header: { timestamp: NOW }, entity: [] },
    serviceAlerts: { header: { timestamp: NOW }, entity: [] },
  };
  const fetch = async (url) => {
    const name = Object.keys(feeds).find((k) => url.includes(k));
    return { ok: true, status: 200, json: async () => feeds[name] };
  };
  const store = createStore({ routes, service, staticLoaded: true, buses: [], trips: [], alerts: [], feedTs: 0 });
  const live = startLive(store, { fetch, intervalMs: 600000, now: () => NOW });
  await live.pollNow();
  live.stop();
  eq(store.get().buses.map((b) => b.vehicle.id), ["ok"]);
});

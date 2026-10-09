// QA regression (2026-10-09): a feed outage is not a service outage. With the live feed unreachable and no
// last-known buses, no view may claim "No shuttles running" / "Not running"; it says live status is unknown.
import { test, eq, ok } from "./lib.js";
import { NOW, fixture } from "./views-fixtures.js";
import { liveUnknown } from "../js/core/arrivals.js";
import { renderNearby, N } from "../js/ui/views/nearby.js";
import { renderStop } from "../js/ui/views/stop.js";
import { renderRoutes } from "../js/ui/views/routes.js";
import { renderRoute } from "../js/ui/views/route.js";
import { D, resHTML } from "../js/ui/views/directions.js";
import { renderCustom } from "../js/ui/views/myroutes.js";

const DOWN = { buses: [], trips: [], lastOk: 0, failed: true, feedTs: 0, liveLoaded: true };   // never reached the feed
const FAILING = { buses: [], trips: [], lastOk: NOW - 90, failed: true, feedTs: NOW - 90 };    // was fine, now failing, last data empty
const QUIET = { buses: [], trips: [] };                                                         // fresh feed, nothing running
const claimsNoService = (h) => /No shuttles (are )?running|Not running/.test(h);

test("outage: liveUnknown only when the feed is in error and no last-known buses exist", () => {
  eq(liveUnknown(fixture(DOWN), NOW), true, "never reached");
  eq(liveUnknown(fixture(FAILING), NOW), true, "failing, last data had no buses");
  eq(liveUnknown(fixture(QUIET), NOW), false, "fresh empty feed = really nothing running");
  eq(liveUnknown(fixture({ failed: true, lastOk: NOW - 90 }), NOW), false, "last-known buses are still shown (labeled last known)");
  eq(liveUnknown(fixture({ ...DOWN, liveLoaded: false }), NOW), false, "first poll pending: loading, not unknown");
});

test("outage: Current trip, stop, routes, route, directions and My Routes never say 'not running'", () => {
  for (const [name, over] of [["down", DOWN], ["failing", FAILING]]) {
    N.q = ""; N.mode = "station"; N.anchor = null;
    const near = renderNearby(fixture(over), NOW);
    ok(!claimsNoService(near) && near.includes("Live times unavailable") && near.includes("773.702.8181"), name + ": Current trip");
    const stop = renderStop(fixture({ ...over, stopId: "S1" }), NOW);
    ok(!claimsNoService(stop) && stop.includes("Live times unavailable") && stop.includes("773.702.8181"), name + ": stop");
    const routes = renderRoutes(fixture(over));
    ok(!claimsNoService(routes) && routes.includes("Live bus status unavailable") && routes.includes("Live status unknown"), name + ": routes list");
    const route = renderRoute(fixture({ ...over, routeId: "R1" }), NOW);
    ok(!claimsNoService(route) && route.includes("Live status unavailable"), name + ": route detail");
    Object.assign(D, { from: { lat: 41.79, lon: -87.6, label: "A" }, to: { lat: 41.795, lon: -87.595, label: "B" }, result: { options: [], walkOnly: { m: 700, min: 9 } }, missed: false });
    const dir = resHTML(fixture(over), NOW);
    ok(!claimsNoService(dir) && dir.includes("plan shuttle trips right now"), name + ": directions");
    ok(dir.includes("773.702.8181"), name + ": directions official contact");
    const mr = renderCustom(fixture({ ...over, customRoutes: [{ id: "c1", name: "Commute", rids: ["R1"], highlight: [] }] }), "c1", NOW);
    ok(!claimsNoService(mr) && mr.includes("Live status unavailable"), name + ": custom route detail");
  }
  D.from = D.to = D.result = null;
});

test("outage: a fresh feed with no buses still says nothing is running", () => {
  N.q = ""; N.mode = "station"; N.anchor = null;
  ok(renderNearby(fixture(QUIET), NOW).includes("No shuttles running right now"));
  ok(renderRoutes(fixture(QUIET)).includes("No shuttles running right now"));
  ok(renderRoute(fixture({ ...QUIET, routeId: "R1" }), NOW).includes("Not running right now"));
  ok(renderStop(fixture({ ...QUIET, stopId: "S1" }), NOW).includes("No shuttles are running right now"));
});

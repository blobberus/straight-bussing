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
import { renderCustom, renderEditor } from "../js/ui/views/myroutes.js";

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

// Rider safety (2026-10-10): the feed is fresh but lists no vehicle from about midnight to 4:30 AM while the
// schedule has the night routes in service until ~4:29 AM. Buses may run without GPS or service may have
// ended early; no view may claim "No shuttles running" / "Not running" then. NOW is Fri 2:00 AM Chicago.
const night = (last) => ({ first: "16:00", last, trips: 30, buses: Array(24).fill(1) });
const every = (d) => ({ days: { mon: d, tue: d, wed: d, thu: d, fri: d, sat: d, sun: d }, exceptions: [] });
const SCHED = { routes: { R1: every(night("28:29")), R2: every(night("28:25")), R3: every({ first: "07:00", last: "19:25", trips: 9, buses: Array(24).fill(1) }) } };
const SILENT = { buses: [], trips: [], service: SCHED };
const noRawTag = (h) => !h.includes("<script>");

test("silent feed: Current trip, stop, routes, route, directions and My Routes say no live location, not 'not running'", () => {
  N.q = ""; N.mode = "station"; N.anchor = null;
  const near = renderNearby(fixture(SILENT), NOW);
  ok(!claimsNoService(near) && near.includes("No live locations right now"), "Current trip: " + near.slice(0, 200));
  ok(near.includes("the Red Line route in service until 4:29 AM and the Blue Loop route until 4:25 AM") && near.includes("no bus is sending its location"), "names visible scheduled routes + end times");
  ok(near.includes("Call 773.702.8181 before you rely on them") && near.includes("v-official"), "official phone + link");
  const located = renderNearby(fixture({ ...SILENT, user: { lat: 41.79, lon: -87.6 }, locState: "granted" }), NOW);
  ok(!claimsNoService(located) && located.includes("No live times right now") && located.includes("No live locations right now"), "with location: cards + why");
  ok(!located.includes("No upcoming arrivals"), "stop cards do not read as 'no bus coming'");
  const stop = renderStop(fixture({ ...SILENT, stopId: "S1" }), NOW);
  ok(!claimsNoService(stop) && stop.includes("No live times right now") && stop.includes("the Red Line route in service until 4:29 AM") && !stop.includes("Blue Loop route"), "stop: only its scheduled routes");
  ok(stop.includes("773.702.8181"), "stop official contact");
  const routes = renderRoutes(fixture(SILENT), NOW);
  ok(!/No shuttles (are )?running/.test(routes) && routes.includes("No live locations right now") && routes.includes(">Scheduled, no live location<"), "routes list: banner + group");
  ok(routes.includes("Scheduled until 4:29 AM, no live location") && routes.includes("Scheduled until 4:25 AM, no live location"), "routes rows");
  const notRunning = routes.slice(routes.indexOf(">Not running<"));
  ok(routes.indexOf(">Scheduled, no live location<") < routes.indexOf(">Not running<") && !notRunning.includes("Red Line") && !notRunning.includes("Blue Loop"), "only R3 (day route) is honestly not running, listed after");
  const route = renderRoute(fixture({ ...SILENT, routeId: "R1" }), NOW);
  ok(!claimsNoService(route) && route.includes("Scheduled until 4:29 AM, no live location") && route.includes("No bus on this route is sending its location"), "route detail");
  ok(renderRoute(fixture({ ...SILENT, routeId: "R3" }), NOW).includes("Not running right now"), "day route at 2 AM: not running");
  Object.assign(D, { from: { lat: 41.79, lon: -87.6, label: "A" }, to: { lat: 41.795, lon: -87.595, label: "B" }, result: { options: [], walkOnly: { m: 700, min: 9 } }, missed: false });
  const dir = resHTML(fixture(SILENT), NOW);
  ok(!claimsNoService(dir) && dir.includes("no bus is sending its location") && dir.includes("773.702.8181"), "directions");
  D.from = D.to = D.result = null;
  const st = fixture({ ...SILENT, customRoutes: [{ id: "c1", name: "Commute", rids: ["R1"], highlight: [] }] });
  ok(renderCustom(st, "c1", NOW).includes("Scheduled until 4:29 AM, no live location") && !claimsNoService(renderCustom(st, "c1", NOW)), "custom route detail");
  const ed = renderEditor(st, null, NOW);
  ok(ed.includes("Scheduled, no live location") && ed.indexOf("Scheduled, no live location") < ed.indexOf("Not running"), "editor groups");
});

test("silent feed: hidden routes, partial service, escaping, and the honest 'nothing scheduled' case", () => {
  N.q = ""; N.mode = "station"; N.anchor = null;
  const hid = renderNearby(fixture({ ...SILENT, hiddenRoutes: ["R1", "R2"] }), NOW);
  ok(!claimsNoService(hid) && hid.includes("Some hidden routes are scheduled now"), "only hidden routes scheduled: still no 'no shuttles' claim");
  ok(!hid.includes("Red Line route"), "hidden routes are not named");
  const all3 = { routes: { ...SCHED.routes, R3: every(night("28:29")) } };
  const esc3 = renderNearby(fixture({ ...SILENT, service: all3 }), NOW);
  ok(noRawTag(esc3) && esc3.includes("&lt;script&gt;"), "route names are escaped");
  const partial = fixture({ service: SCHED, buses: fixture().buses.slice(0, 1) });   // R1 reports, R2 is silent
  const rh = renderRoutes(partial, NOW);
  ok(rh.includes(">Running<") && rh.includes(">Scheduled, no live location<") && !rh.includes("No live locations right now") && !rh.includes("No shuttles running"), "partial: no banner");
  const later = NOW + 3 * 3600;   // 5 AM: night service over, day service not started
  const done = { ...SILENT, lastOk: later - 5, feedTs: later - 5 };
  ok(renderNearby(fixture(done), later).includes("No shuttles running right now"), "nothing scheduled: honest no service");
  const rl = renderRoutes(fixture(done), later);
  ok(rl.includes("No shuttles running right now") && !rl.includes("Scheduled, no live location"), "routes: nothing scheduled");
  ok(renderStop(fixture({ ...done, stopId: "S1" }), later).includes("No shuttles are running right now"), "stop: nothing scheduled");
});

test("silent feed: a feed outage keeps its own wording even while routes are scheduled", () => {
  N.q = ""; N.mode = "station"; N.anchor = null;
  const near = renderNearby(fixture({ ...DOWN, service: SCHED }), NOW);
  ok(near.includes("Live times unavailable") && !near.includes("No live locations right now"), "Current trip");
  const routes = renderRoutes(fixture({ ...DOWN, service: SCHED }), NOW);
  ok(routes.includes("Live bus status unavailable") && routes.includes(">Live status unknown<") && !routes.includes(">Scheduled, no live location<"), "routes list");
  ok(renderRoute(fixture({ ...DOWN, service: SCHED, routeId: "R1" }), NOW).includes("Live status unavailable"), "route detail");
});

// Rider safety (sweep 2026-10-11): when no bus reports (feed down, silent feed, nothing running), the operator's
// own alert is shown in full next to our official links. The live feed carries one that gives a phone number to
// call "if you do not see arrival times or buses on route in the app"; the Nearby banner only had its title.
const OP = { header_text: { translation: [{ text: "Bus Route Assistance <b>", language: "en" }] },
  description_text: { translation: [{ text: "If you do not see buses, please contact 773-655-9934 for assistance.", language: "en" }] },
  active_period: [{ start: NOW - 3600, end: NOW + 86400 }], informed_entity: [{ agency_id: "1068" }] };
const ROUTE_ONLY = { header_text: "Red Line detour", active_period: [], informed_entity: [{ route_id: "R1" }] };

test("no bus reports: the operator's alert (title, text, call link) sits with the official links on every screen", () => {
  const shows = (h) => h.includes("From the shuttle operator") && h.includes("Bus Route Assistance &lt;b&gt;") && !h.includes("<b>Bus")
    && h.includes('<a href="tel:+17736559934">773-655-9934</a>') && h.includes("773.702.8181");
  for (const [name, over] of [["down", { ...DOWN, alerts: [OP] }], ["silent", { ...SILENT, alerts: [OP] }], ["quiet", { ...QUIET, alerts: [OP] }]]) {
    N.q = ""; N.mode = "station"; N.anchor = null;
    ok(shows(renderNearby(fixture(over), NOW)), name + ": Current trip");
    ok(shows(renderStop(fixture({ ...over, stopId: "S1" }), NOW)), name + ": stop");
    ok(shows(renderRoutes(fixture(over), NOW)), name + ": routes list");
    Object.assign(D, { from: { lat: 41.79, lon: -87.6, label: "A" }, to: { lat: 41.795, lon: -87.595, label: "B" }, result: { options: [], walkOnly: { m: 700, min: 9 } }, missed: false });
    ok(shows(resHTML(fixture(over), NOW)), name + ": directions");
  }
  const rd = renderRoute(fixture({ ...QUIET, alerts: [OP, ROUTE_ONLY], routeId: "R1" }), NOW);
  ok(rd.includes("From the shuttle operator") && rd.includes("Bus Route Assistance") && (rd.match(/Red Line detour/g) || []).length === 1, "route detail: agency alert added, its own route alert listed once");
  N.q = ""; N.mode = "station"; N.anchor = null;
  const busy = renderNearby(fixture({ alerts: [OP] }), NOW);
  ok(!busy.includes("From the shuttle operator") && busy.includes("v-alertbanner"), "buses reporting: only the banner");
  ok(!renderNearby(fixture(QUIET), NOW).includes("From the shuttle operator"), "no alert: nothing added");
  const many = renderNearby(fixture({ ...QUIET, alerts: [OP, ROUTE_ONLY, { ...ROUTE_ONLY, header_text: "Third" }] }), NOW);
  ok(many.includes('data-action="alerts:open"') && many.includes("All 3 service alerts") && !many.includes(">Third<"), "at most 2 inline, then a link to all");
  D.from = D.to = D.result = null;
});

// Render tests for nearby / stop / routes / route / alerts / about with fixture state.
import { test, eq, ok } from "./lib.js";
import { NOW, fixture, makeCtx, tick, root } from "./views-fixtures.js";
import { getView } from "../js/ui/router.js";
import { runAction } from "../js/ui/actions.js";
import { renderNearby, resultsHTML, metaNearby, N, guidedRow, pickArrivals } from "../js/ui/views/nearby.js";
import { catchNote, stopWalkMin } from "../js/ui/views/tripinfo.js";
import { rootOf } from "../js/ui/router.js";
import { renderStop, openStop } from "../js/ui/views/stop.js";
import { renderRoutes, groupRoutes } from "../js/ui/views/routes.js";
import { renderRoute, stopOrder } from "../js/ui/views/route.js";
import { renderAlerts } from "../js/ui/views/alerts.js";
import { renderAbout, mountAbout } from "../js/ui/views/about.js";
import "../js/ui/views/pick.js";
import "../js/ui/views/directions.js";

const noRaw = (h) => !h.includes("<script>") && !h.includes("javascript:");
const USER = { lat: 41.7899, lon: -87.6001 };
function resetNearby() { N.q = ""; N.mode = "station"; N.anchor = null; }

test("every view and action is registered", () => {
  for (const v of ["nearby", "stop", "routes", "route", "alerts", "about", "pick", "directions"]) ok(getView(v), "view " + v);
  for (const v of ["nearby", "stop", "routes", "route", "alerts", "about", "pick", "directions"]) ok(typeof getView(v).title(fixture()) === "string", "title " + v);
  ok(typeof getView("pick").mount === "function" && typeof getView("directions").mount === "function" && typeof getView("nearby").mount === "function", "input views mount");
});

test("current trip: title, no-trip hint or the trip in progress, one Routes to station entry, no Directions entry", () => {
  resetNearby();
  eq(getView("nearby").title(fixture()), "Current trip");
  eq(getView("nearby").tab, "nearby");
  for (const st of [fixture(), fixture({ user: USER, locState: "granted" }), fixture({ locState: "denied" })]) {
    const h = renderNearby(st, NOW);
    eq((h.match(/data-action="dir:open"/g) || []).length, 0, "destination search is the top search bar, not in the sheet");
    eq((h.match(/data-action="pick:open"/g) || []).length, 1, "one Routes to station entry");
    ok(h.includes("No trip in progress") && h.includes("Search for a destination above"), "no-trip hint");
    ok(h.indexOf('data-region="nearby-trip"') < h.indexOf('data-input="nearby-q"'), "trip region above the station search");
  }
  const rid = Object.keys(fixture().routes)[0];
  const trip = renderNearby(fixture({ journey: { rids: [rid], label: "To Hospital", kind: "plan" } }), NOW);
  ok(trip.includes("j-trip") && trip.includes("Trip to Hospital"), "trip in progress card");
  ok(trip.includes('data-action="journey:end"') && trip.includes('data-action="nav" data-view="directions"'), "End trip + Trip steps");
  ok(!trip.includes("No trip in progress"));
  resetNearby();
});

test("current trip: Directions and Routes to station belong to the Current trip tab", () => {
  for (const v of ["directions", "pick"]) {
    eq(getView(v).parent, "nearby", v + " parent");
    eq(getView(v).tab, "nearby", v + " tab");
    eq(rootOf(v), "nearby", v + " root");
  }
});

test("plan trip: catchNote from walking estimate (miss / leave now / leave in N)", () => {
  eq(catchNote(NOW + 120, 4, NOW).kind, "miss");
  ok(catchNote(NOW + 120, 4, NOW).text.includes("before you can walk there") && catchNote(NOW + 120, 4, NOW).text.includes("est."));
  eq(catchNote(NOW + 150, 2, NOW).kind, "now");
  eq(catchNote(NOW + 150, 2, NOW).text, "Leave now, est.");
  const c = catchNote(NOW + 600, 4, NOW);
  eq(c.kind, "later"); eq(c.text, "Leave in 6 min, est.");
  ok(c.aria.includes("estimate"));
  ok(Math.abs(stopWalkMin(400) - 6) < 1e-9, "400 m x1.2 / 80 = 6 min");
});

test("plan trip: arrivals you cannot walk to in time are marked (text + class + aria), catchable say when to leave", () => {
  resetNearby();
  const st = fixture();
  const miss = guidedRow({ rid: "R1", t: NOW + 120, bus: "101", tripId: "t1" }, st, NOW, 5);
  ok(miss.includes("pt-miss") && miss.includes("Leaves before you can walk there"), miss);
  ok(/aria-label="[^"]*leaves before you can walk there, estimate/.test(miss), "aria says it");
  const ok1 = guidedRow({ rid: "R1", t: NOW + 600, bus: "101", tripId: "t1" }, st, NOW, 2);
  ok(ok1.includes("pt-later") && ok1.includes("Leave in 8 min"), ok1);
  ok(ok1.includes('data-action="route:open"'), "row still opens the route");
  const all = [{ t: NOW + 60 }, { t: NOW + 120 }, { t: NOW + 900 }];
  eq(pickArrivals(all, 1, 5, NOW).length, 2, "one more when the first cannot be caught");
  eq(pickArrivals(all, 1, null, NOW).length, 1, "no guidance -> plain slice");
  eq(pickArrivals(all, 1, 0.1, NOW).length, 1);
  // located ~400 m from Main & 1st: the 2-min R1 cannot be reached on foot
  const far = { lat: 41.7864, lon: -87.6001 };
  const h = renderNearby(fixture({ user: far, locState: "granted" }), NOW);
  ok(h.includes("pt-miss") && h.includes("Leaves before you can walk there"), "far user sees miss");
  ok(h.includes("walking estimate"), "guidance labeled as an estimate");
  const near = renderNearby(fixture({ user: USER, locState: "granted" }), NOW);
  const hero = near.split("Also nearby")[0];
  ok(hero.includes("Leave in 1 min, est.") && !hero.includes("pt-miss"), "near user can catch the 2-min bus");
  // a typed place is not where you are: no leave guidance
  N.anchor = { label: "Somewhere", lat: 41.7864, lon: -87.6001 };
  ok(!renderNearby(fixture(), NOW).includes("pt-arr"), "no guidance for a typed place");
  resetNearby();
});

test("nearby: skeleton before static data", () => {
  resetNearby();
  ok(renderNearby(fixture({ staticLoaded: false }), NOW).includes("skel"));
});

test("nearby: with location shows nearest stop card, arrivals and Also nearby", () => {
  resetNearby();
  const h = renderNearby(fixture({ user: USER, locState: "granted" }), NOW);
  ok(h.includes("Main &amp; 1st"), "nearest stop name escaped");
  ok(h.indexOf("Main &amp; 1st") < h.indexOf("Also nearby"), "hero first");
  ok(h.includes("Red Line"), "arrival route");
  ok(!h.includes("Use my location"), "no location CTA when located");
  ok(!h.includes("Orphan"), "stop without routes is skipped");
  ok(noRaw(h), "escaped");
  eq(metaNearby(fixture({ user: USER }), NOW), "R1 · 2 min");
});

test("nearby: hidden routes are not shown", () => {
  resetNearby();
  const h = renderNearby(fixture({ user: USER, hiddenRoutes: ["R1"] }), NOW);
  ok(!h.includes("Red Line"), "hidden route arrivals removed");
});

test("nearby: no location -> Use my location, search, address option, Arriving soon", () => {
  resetNearby();
  const h = renderNearby(fixture(), NOW);
  ok(h.includes("Use my location"));
  ok(h.includes('data-input="nearby-q"'), "station search");
  ok(h.includes("Type an address or place"));
  ok(h.includes("Arriving soon"));
  ok(h.indexOf("Hospital") < h.indexOf("Main &amp; 1st"), "sorted by soonest");
});

test("nearby: denied location is first-class and still usable", () => {
  resetNearby();
  const h = renderNearby(fixture({ locState: "denied" }), NOW);
  ok(h.includes("Location is off"));
  ok(h.includes("Arriving soon") && h.includes('data-input="nearby-q"'), "still usable");
  ok(!h.includes("Use my location<"), "primary CTA swapped for retry");
  ok(h.includes("Try location again"));
});

test("nearby: no service state links official service", () => {
  resetNearby();
  const h = renderNearby(fixture({ trips: [], buses: [] }), NOW);
  ok(h.includes("No shuttles running right now"));
  ok(h.includes("773.702.8181"));
});

test("nearby: stale feed marks ETAs with ~", () => {
  resetNearby();
  const h = renderNearby(fixture({ user: USER, lastOk: NOW - 200, feedTs: NOW - 200 }), NOW);
  ok(h.includes("~"), "tilde on stale");
});

test("nearby: station search and place anchor", () => {
  resetNearby();
  N.q = "lib";
  const r = resultsHTML(fixture());
  ok(r.includes("Library") && !r.includes("Hospital"));
  N.q = "zzz";
  ok(resultsHTML(fixture()).includes("No matching stations"));
  resetNearby();
  N.anchor = { label: "Regenstein <Library>", lat: 41.792, lon: -87.6 };
  const h = renderNearby(fixture(), NOW);
  ok(h.includes("Showing stops near") && h.includes("Regenstein &lt;Library&gt;"));
  resetNearby();
});

test("stop: arrivals, chips, address, updated, directions buttons", () => {
  const h = renderStop(fixture({ stopId: "S1" }), NOW);
  ok(h.includes("1301 East 53rd Street"), "address");
  ok(h.includes("Updated 5s ago"), "updated");
  ok(h.includes('data-action="dir:to-stop"') && h.includes('data-action="dir:from-stop"'));
  ok(h.includes("Red Line"));
  ok(noRaw(h));
  eq(getView("stop").title(fixture({ stopId: "S1" })), "Main & 1st");
});

test("stop: stale, empty, hidden, missing", () => {
  ok(renderStop(fixture({ stopId: "S1", lastOk: NOW - 400, feedTs: NOW - 400 }), NOW).includes("Last live update"));
  ok(renderStop(fixture({ stopId: "S1", trips: [] }), NOW).includes("No upcoming arrivals"));
  const hid = renderStop(fixture({ stopId: "S1", hiddenRoutes: ["R1"] }), NOW);
  ok(hid.includes("1 hidden route") && !hid.includes("Red Line"));
  ok(renderStop(fixture({ stopId: "nope" }), NOW).includes("Stop not found"));
});

test("routes: actions, groups, eye toggles", () => {
  const s = fixture({ hiddenRoutes: ["R3"], buses: fixture().buses.slice(0, 1) });
  const g = groupRoutes(s);
  eq(g, { running: ["R1"], scheduled: [], idle: ["R2"], hidden: ["R3"] });
  const h = renderRoutes(s);
  ok(!h.includes('data-action="pick:open"') && !h.includes('data-action="dir:open"'), "Routes to station / Directions are not on Routes");
  ok(h.indexOf(">Running<") < h.indexOf(">Not running<") && h.indexOf(">Not running<") < h.indexOf(">Hidden<"));
  ok(h.includes('aria-pressed="false"') && h.includes('aria-pressed="true"'));
  ok(noRaw(h));
});

test("routes: filter chip limits list", () => {
  const h = renderRoutes(fixture({ routeFilter: { ids: ["R1"], label: "Library" } }));
  ok(h.includes("Routes to Library"));
  ok(h.includes("Red Line") && !h.includes("Blue Loop"));
});

test("routes: toggle and clear-filter actions write the store", async () => {
  const ctx = makeCtx({ routeFilter: { ids: ["R1"], label: "Library" } });
  runAction("routes:toggle", { id: "R2" }, null, ctx);
  eq(ctx.store.get().hiddenRoutes, ["R2"]);
  runAction("routes:toggle", { id: "R2" }, null, ctx);
  eq(ctx.store.get().hiddenRoutes, []);
  runAction("routes:clear-filter", {}, null, ctx);
  eq(ctx.store.get().routeFilter, null);
  await tick();
});

test("route: timeline with ETA per stop and inline bus", () => {
  eq(stopOrder(["a", "b", "c", "a"]), ["a", "b", "c"]);
  const h = renderRoute(fixture({ routeId: "R1" }), NOW);
  ok(h.includes("1 bus running"));
  ok(h.indexOf("Main &amp; 1st") < h.indexOf("Library") && h.indexOf("Library") < h.indexOf("Hospital"), "order");
  ok(h.includes(">2 min<") && h.includes(">5 min<"), "per-stop ETA");
  ok(h.includes("Bus 101 heading here"));
  const loop = renderRoute(fixture({ routeId: "R2" }), NOW);
  eq((loop.match(/class="v-tlstop/g) || []).length, 3, "loop deduped");
  ok(renderRoute(fixture({ routeId: "zz" }), NOW).includes("Route not found"));
});

test("alerts: list, empty state and About link", () => {
  const a = { header_text: { translation: [{ text: "Detour on <53rd>", language: "en" }] }, description_text: { translation: [{ text: "Use Kimbark" }] }, active_period: [{ start: NOW - 60, end: NOW + 3600 }], informed_entity: [{ route_id: "R1" }] };
  const h = renderAlerts(fixture({ alerts: [a, { header_text: "Old", active_period: [{ start: 1, end: 2 }] }] }), NOW);
  ok(h.includes("Detour on &lt;53rd&gt;") && h.includes("Use Kimbark"));
  ok(!h.includes(">Old<"), "expired hidden");
  ok(h.includes('data-action="about:open"'));
  ok(renderAlerts(fixture(), NOW).includes("No active alerts"));
});

test("about: unofficial, official contact, privacy hosts, version, theme control", async () => {
  const h = renderAbout();
  for (const s of ["unofficial", "773.702.8181", "safety-security.uchicago.edu/Transportation", "photon.komoot.io", "routing.openstreetmap.de", "valhalla1.openstreetmap.de", "Version", "OpenStreetMap"]) ok(h.includes(s), s);
  const el = root();
  el.innerHTML = h;
  mountAbout(el, makeCtx());
  ok(el.querySelector('[data-region="theme"]').childElementCount > 0, "theme control mounted");
  el.remove();
});

test("map view: opening a stop selects it without moving the map; choosing a route frames it (owner 2026-10-09)", () => {
  const ctx = makeCtx();
  let sel = null;
  ctx.map.setSelectedStop = (st) => { sel = st; };
  openStop("S1", ctx);
  eq(ctx.store.get().view, "stop");
  eq(sel && sel.id, "S1", "stop selected on the map");
  eq(ctx.calls.flyTo.length + ctx.calls.fitTo.length, 0, "no fly / fit for a stop");
  runAction("stop:open", { id: "S1" }, null, ctx);
  eq(ctx.calls.flyTo.length + ctx.calls.fitTo.length, 0, "stop:open action: no camera move");
  runAction("route:open", { id: "R1" }, null, ctx);
  eq(ctx.store.get().view, "route");
  eq(ctx.calls.fitTo.length, 1, "choosing a route frames it");
});

// Render tests for nearby / stop / routes / route / alerts / about with fixture state.
import { test, eq, ok } from "./lib.js";
import { NOW, fixture, makeCtx, tick, root } from "./views-fixtures.js";
import { getView } from "../js/ui/router.js";
import { runAction } from "../js/ui/actions.js";
import { renderNearby, resultsHTML, metaNearby, N } from "../js/ui/views/nearby.js";
import { renderStop } from "../js/ui/views/stop.js";
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
  eq(g, { running: ["R1"], idle: ["R2"], hidden: ["R3"] });
  const h = renderRoutes(s);
  ok(h.includes("Routes to station&hellip;") && h.includes('data-action="dir:open"'));
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

// ui/views/route.js render tests (bus rail, hours & service).
import { test, eq, ok } from "./lib.js";
import { renderRoute, renderService, busPositions } from "../js/ui/views/route.js";
import { fixture, NOW } from "./views-fixtures.js";
import { serviceFixture } from "./route-fixtures.js";

const D = "to";   // clock ranges: "7:00 AM to 7:25 PM" (no dash characters, docs/DESIGN.md "Copy")
const svcState = (over = {}) => fixture({ routeId: "R1", service: serviceFixture(), ...over });

test("route rail: bus approaching the first stop of a line route", () => {
  const p = busPositions(fixture({ routeId: "R1" }), "R1", NOW);
  eq(p.length, 1);
  eq([p[0].next, p[0].prev, p[0].stale], [0, null, false]);
  eq(p[0].text, "Bus 101 approaching Main & 1st");
});

test("route rail: bus between two stops, fraction by distance, stale labeled", () => {
  const s = fixture({ routeId: "R1" });
  s.buses = [{ vehicle: { id: "v9", label: "12" }, position: { latitude: 41.7915, longitude: -87.6 }, trip: { trip_id: "t1", route_id: "R1" }, timestamp: NOW - 300, stop_id: "S2" }];
  const [b] = busPositions(s, "R1", NOW);
  eq([b.prev, b.next], [0, 1]);
  ok(b.frac > 0.6 && b.frac < 0.9, "closer to Library: " + b.frac);
  ok(b.stale && b.text.startsWith("Bus 12 between Main & 1st and Library, heading to Library, location from"), b.text);
  const h = renderRoute(s, NOW);
  ok(h.includes('class="r-bus is-stale"'), "stale marker");
  ok(h.includes("Bus 12 heading here &middot; seen"), "stale pill says when it was seen");
  ok(h.includes("between Main &amp; 1st and Library"), "bus list text escaped");
});

test("route rail: loop routes wrap (first stop's previous is the last stop)", () => {
  const s = fixture({ routeId: "R2" });
  const [b] = busPositions(s, "R2", NOW);
  eq([b.next, b.prev], [0, 2]);
  ok(b.text.includes("between Far Stop and Hospital"), b.text);
  const h = renderRoute(s, NOW);
  ok(h.includes("Loop: continues to Hospital"));
  ok(h.includes("is-loopend"));
  eq((h.match(/class="r-seg"/g) || []).length, 3, "loop: a rail segment after every stop");
  eq((renderRoute(fixture({ routeId: "R1" }), NOW).match(/class="r-seg"/g) || []).length, 2, "line: none after the last stop");
});

test("route: hours & service section from schedule data", () => {
  const h = renderRoute(svcState(), NOW);                     // NOW = Fri 2:00 AM CST
  ok(h.includes("Hours &amp; service"));
  ok(h.includes("Mon-Fri") && h.includes("Sat-Sun") && h.includes("No service"));
  ok(!/[–—]/.test(h), "no en / em dash in the route view");
  ok(h.includes("Not scheduled now"), "2 AM is outside 7 AM - 7:25 PM");
  ok(h.includes(`<span class="r-k">Today</span> 7:00 AM ${D} 7:25 PM`));
  ok(h.includes("Scheduled buses by hour, today"));
  ok(h.includes("<li>8 AM to 11 AM: 3 buses</li>"), "accessible text for the bars, one group per line");
  ok(h.includes("official published schedule"), "labeled as schedule data");
  ok(h.includes("No schedule changes in the next 30 days."));
});

test("route: route alerts listed under schedule changes, escaped", () => {
  const alerts = [{ header_text: { translation: [{ text: "Detour on <53rd>", language: "en" }] }, active_period: [{ start: NOW - 60, end: NOW + 3600 }], informed_entity: [{ route_id: "R1" }] },
    { header_text: "Other route", informed_entity: [{ route_id: "R2" }] }];
  const h = renderService(svcState({ alerts }), "R1", NOW);
  ok(h.includes("Service alert</span> Detour on &lt;53rd&gt;"));
  ok(!h.includes("Other route"));
  ok(renderService(fixture({ alerts }), "R1", NOW).includes("Detour"), "alerts shown even without schedule data");
  eq(renderService(fixture({}), "R1", NOW), "", "no schedule + no alerts = no section");
});

test("route: hidden note honors journeys; hostile names escaped", () => {
  ok(renderRoute(fixture({ routeId: "R1", hiddenRoutes: ["R1"] }), NOW).includes("hidden from the map"));
  const j = renderRoute(fixture({ routeId: "R1", journey: { rids: ["R2"], label: "x", kind: "plan" } }), NOW);
  ok(j.includes("not part of the current journey") && !j.includes('data-action="routes:toggle"'));
  const x = renderRoute(fixture({ routeId: "R3" }), NOW);
  ok(!x.includes("<script>") && !x.includes("javascript:"), "escaped");
});

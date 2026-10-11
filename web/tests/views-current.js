// Current trip at the half detent (owner decisions 2026-10-11, Ship checklist 3: the next bus in one glance, no taps).
// Order: one-line alert row, the trip in progress, THE NEXT BUS (nearest stop + up to 3 arrivals, or favorites),
// "Use my location" only without location, the station search, its secondary actions ("Type an address or place",
// "Routes to station…"), the rest, and the quiet "No trip in progress" hint last (no card). The pixel check (the
// next bus fully visible at the half detent in a 393 x 852 phone) is in tests/e2e-current.js.
import { test, eq, ok } from "./lib.js";
import { NOW, fixture } from "./views-fixtures.js";
import { renderNearby, nextHTML, altHTML, N, NO_TRIP_HINT } from "../js/ui/views/nearby.js";
import { alertBanner } from "../js/ui/views/alerts.js";

const USER = { lat: 41.7899, lon: -87.6001 };   // ~10 m from Main & 1st (S1: R1 in 2 min, R3 in 6 min, R1 in 25 min)
const AL = { header_text: { translation: [{ text: "Bus Route Assistance", language: "en" }] }, active_period: [{ start: NOW - 60, end: NOW + 3600 }] };
function reset() { N.q = ""; N.mode = "station"; N.anchor = null; }
const at = (h, needle) => { const i = h.indexOf(needle); ok(i >= 0, "missing " + needle); return i; };
const count = (h, re) => (h.match(re) || []).length;

test("current trip, located: alert row, then the next bus (nearest stop + 3 arrivals) first, then search and secondary actions", () => {
  reset();
  const h = renderNearby(fixture({ user: USER, locState: "granted", alerts: [AL] }), NOW);
  const alert = at(h, 'data-region="nearby-alert"'), next = at(h, 'class="v-card v-hero pt-next"'), search = at(h, 'data-input="nearby-q"');
  const pick = at(h, 'data-action="pick:open"'), addr = at(h, 'data-mode="place"'), also = at(h, "Also nearby"), hint = at(h, NO_TRIP_HINT);
  ok(alert < next && next < search && search < addr && addr < pick && pick < also && also < hint, "order: " + [alert, next, search, addr, pick, also, hint]);
  const hero = h.slice(next, h.indexOf("</section>", next));
  ok(hero.includes("Main &amp; 1st") && hero.includes("min walk") && hero.includes('data-action="stop:open"'), "stop name + walk, opens the stop");
  eq(count(hero, /class="row arr/g), 3, "up to 3 arrivals in the next-bus block");
  ok(hero.includes("Live") && hero.includes("Leave in") && hero.includes("est."), "live label and the estimate label as before");
  ok(!h.includes("pt-notrip") && !h.includes("Use my location"), "no hint card, no location button once located");
  eq(count(h, /data-action="pick:open"/g), 1, "one Routes to station entry");
  eq(count(h, /v-btn--primary/g), 0, "nothing else claims the primary style");
  ok(!/<section[^>]*pt-next[\s\S]*<section[^>]*pt-next/.test(h), "one next-bus block, no card stack");
});

test("current trip, no location: 'Use my location' is the one primary action right under the title, 'Search stations' next", () => {
  reset();
  const h = renderNearby(fixture({ alerts: [AL] }), NOW);
  eq(nextHTML(fixture(), NOW), "", "no nearest stop without a location");
  const loc = at(h, 'data-action="nearby:locate"'), search = at(h, 'data-input="nearby-q"'), pick = at(h, 'data-action="pick:open"');
  ok(at(h, 'data-region="nearby-alert"') < loc && loc < search && search < pick && pick < at(h, "Arriving soon") && at(h, "Arriving soon") < at(h, NO_TRIP_HINT), "order");
  eq(count(h, /v-btn--primary/g), 1, "one primary action");
  ok(!/v-btn|v-card|v-search/.test(h.slice(0, h.lastIndexOf("<button", loc))), "nothing above it but the alert row");
  const den = renderNearby(fixture({ locState: "denied" }), NOW);
  ok(den.indexOf("Location is off") < den.indexOf('data-input="nearby-q"') && den.includes("Try location again"), "denied: still first, still usable");
});

test("current trip, a favorite stop and no location: the favorites' next buses lead, then 'Use my location'", () => {
  reset();
  const h = renderNearby(fixture({ favStops: ["S2"] }), NOW);
  const fav = at(h, 'aria-label="Favorite stations"'), loc = at(h, 'data-action="nearby:locate"');
  ok(fav < loc && loc < at(h, 'data-input="nearby-q"'), "favorites first");
  eq(count(h, /aria-label="Favorite stations"/g), 1, "listed once");
  const located = renderNearby(fixture({ favStops: ["S2"], user: USER, locState: "granted" }), NOW);
  ok(at(located, "pt-next") < at(located, 'data-input="nearby-q"') && at(located, 'data-input="nearby-q"') < at(located, 'aria-label="Favorite stations"'), "with location the nearest stop leads, favorites follow the search");
});

test("current trip, a typed place: its nearest stop is the next-bus block (no walking guidance), Clear on top", () => {
  reset();
  N.anchor = { label: "Regenstein <Library>", lat: 41.792, lon: -87.6 };
  const h = renderNearby(fixture(), NOW);
  const anchor = at(h, "Showing stops near"), next = at(h, "pt-next");
  ok(anchor < next && next < at(h, 'data-action="nearby:locate"'), "place, its stop, then Use my location");
  ok(h.includes("Regenstein &lt;Library&gt;") && !h.slice(next, h.indexOf("</section>", next)).includes("pt-arr"), "escaped; no leave guidance for a typed place");
  reset();
});

test("current trip, trip in progress: the trip comes first, no hint, Routes to station stays in the trip actions", () => {
  reset();
  const rid = Object.keys(fixture().routes)[0];
  const h = renderNearby(fixture({ user: USER, journey: { rids: [rid], label: "To Hospital", kind: "plan" }, alerts: [AL] }), NOW);
  ok(at(h, 'data-region="nearby-alert"') < at(h, "Trip to Hospital") && at(h, "Trip to Hospital") < at(h, "pt-next"), "alert row, trip, then the next bus");
  ok(!h.includes(NO_TRIP_HINT), "no 'No trip in progress'");
  eq(count(h, /data-action="pick:open"/g), 1, "one Routes to station entry (in the trip actions)");
  ok(!altHTML(fixture({ journey: { rids: [rid], label: "x", kind: "plan" } })).includes("pick:open"), "not again under the search");
});

test("current trip: the alert row is one line, labeled, and never color alone", () => {
  const one = alertBanner(fixture({ alerts: [AL] }), NOW);
  ok(one.includes('class="v-grow v-alertline"') && !one.includes("v-sec v-alertfirst"), "one line, not a title + 2-line body");
  ok(/<b>Service alert:<\/b> <span class="v-alertfirst">Bus Route Assistance<\/span>/.test(one), one);
  ok(/aria-label="Service alert: Bus Route Assistance. Open alerts"/.test(one), "spoken label keeps the full title");
  ok(one.includes("<svg"), "warning icon with the words");
});

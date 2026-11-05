// Current trip. No trip in progress (owner 2026-11-04: "In the current trip menu, if a current trip is not selected,
// don't display nearby routes, rather, just show that no current trip is selected. Keep the favorites and search station
// bar. Also keep the alerts."): the one-line alert row, "No current trip selected" with how to start one, the station
// search and its links, the favorites; no nearby buses and no location prompt. During a trip (owner decisions
// 2026-10-11): the alert row, the trip, THE NEXT BUS (nearest stop + up to 3 arrivals, or favorites), "Use my location"
// only without location, the station search, the rest. The pixel checks are in tests/e2e-current.js.
import { test, eq, ok } from "./lib.js";
import { NOW, fixture, onTrip } from "./views-fixtures.js";
import { renderNearby, nextHTML, altHTML, N, NO_TRIP_TITLE, NO_TRIP_HINT, triedText } from "../js/ui/views/nearby.js";
import { alertBanner } from "../js/ui/views/alerts.js";

const USER = { lat: 41.7899, lon: -87.6001 };   // ~10 m from Main & 1st (S1: R1 in 2 min, R3 in 6 min, R1 in 25 min)
const AL = { header_text: { translation: [{ text: "Bus Route Assistance", language: "en" }] }, active_period: [{ start: NOW - 60, end: NOW + 3600 }] };
function reset() { N.q = ""; N.mode = "station"; N.anchor = null; }
const at = (h, needle) => { const i = h.indexOf(needle); ok(i >= 0, "missing " + needle); return i; };
const count = (h, re) => (h.match(re) || []).length;

test("current trip, no trip (owner 2026-11-04): alert row, 'No current trip selected', the search and its links, the favorites; nothing nearby", () => {
  reset();
  for (const [name, st] of [["located", fixture({ user: USER, locState: "granted", alerts: [AL], favStops: ["S2"] })],
    ["no location", fixture({ alerts: [AL], favStops: ["S2"] })], ["blocked", fixture({ locState: "denied", alerts: [AL], favStops: ["S2"] })]]) {
    const h = renderNearby(st, NOW);
    const alert = at(h, 'data-region="nearby-alert"'), none = at(h, NO_TRIP_TITLE), search = at(h, 'data-input="nearby-q"');
    const addr = at(h, 'data-mode="place"'), pick = at(h, 'data-action="pick:open"'), fav = at(h, 'aria-label="Favorite stations"');
    ok(h.includes("Bus Route Assistance"), name + ": the alert row stays");
    ok(alert < none && none < search && search < addr && addr < pick && pick < fav, `${name}: order ` + [alert, none, search, addr, pick, fav]);
    ok(h.includes(NO_TRIP_HINT) && h.includes('class="v-btn v-btn--primary v-btn--block pt-notrip-go" data-action="dir:open" data-focus="to"'), name + ": how to start one, one way to start");
    eq(count(h, /v-btn--primary/g), 1, name + ": one primary action");
    ok(!/pt-next|Arriving soon|Also nearby|nearby:locate|v-locoff|Use my location/.test(h), name + ": no nearby buses, no location prompt");
    ok(h.includes("Library"), name + ": the favorite with its next bus");
  }
});

test("current trip, during a trip, located: alert row, the trip, then the next bus (nearest stop + 3 arrivals), then the search", () => {
  reset();
  const h = renderNearby(onTrip({ user: USER, locState: "granted", alerts: [AL] }), NOW);
  const alert = at(h, 'data-region="nearby-alert"'), trip = at(h, "Trip to Test Place"), next = at(h, 'class="v-card v-hero pt-next"'), search = at(h, 'data-input="nearby-q"');
  const addr = at(h, 'data-mode="place"'), also = at(h, "Also nearby");
  ok(alert < trip && trip < next && next < search && search < addr && addr < also, "order: " + [alert, trip, next, search, addr, also]);
  const hero = h.slice(next, h.indexOf("</section>", next));
  ok(hero.includes("Main &amp; 1st") && hero.includes("min walk") && hero.includes('data-action="stop:open"'), "stop name + walk, opens the stop");
  eq(count(hero, /class="row arr/g), 3, "up to 3 arrivals in the next-bus block");
  ok(hero.includes("Live") && hero.includes("Leave in") && hero.includes("est."), "live label and the estimate label as before");
  ok(!h.includes("pt-notrip") && !h.includes("Use my location"), "no no-trip card, no location button once located");
  ok(!/<section[^>]*pt-next[\s\S]*<section[^>]*pt-next/.test(h), "one next-bus block, no card stack");
});

test("current trip, during a trip, no location: 'Use my location' under the trip, 'Search stations' next", () => {
  reset();
  const h = renderNearby(onTrip({ alerts: [AL] }), NOW);
  eq(nextHTML(onTrip(), NOW), "", "no nearest stop without a location");
  eq(nextHTML(fixture({ user: USER }), NOW), "", "no trip: no nearest stop even with a location (owner 2026-11-04)");
  const loc = at(h, 'data-action="nearby:locate"'), search = at(h, 'data-input="nearby-q"');
  ok(at(h, 'data-region="nearby-alert"') < at(h, "Trip to Test Place") && at(h, "Trip to Test Place") < loc && loc < search && search < at(h, "Arriving soon"), "order");
  const den = renderNearby(onTrip({ locState: "denied" }), NOW);
  ok(den.indexOf("Location is off") < den.indexOf('data-input="nearby-q"') && den.includes("Try location again"), "denied: still before the search, still usable");
});

test("current trip, during a trip, a favorite stop and no location: the favorites' next buses lead, then 'Use my location'", () => {
  reset();
  const h = renderNearby(onTrip({ favStops: ["S2"] }), NOW);
  const fav = at(h, 'aria-label="Favorite stations"'), loc = at(h, 'data-action="nearby:locate"');
  ok(fav < loc && loc < at(h, 'data-input="nearby-q"'), "favorites first");
  eq(count(h, /aria-label="Favorite stations"/g), 1, "listed once");
  const located = renderNearby(onTrip({ favStops: ["S2"], user: USER, locState: "granted" }), NOW);
  ok(at(located, "pt-next") < at(located, 'data-input="nearby-q"') && at(located, 'data-input="nearby-q"') < at(located, 'aria-label="Favorite stations"'), "with location the nearest stop leads, favorites follow the search");
});

test("current trip, a typed place: its nearest stop is the search's result (no walking guidance), Clear on top, also with no trip", () => {
  reset();
  N.anchor = { label: "Regenstein <Library>", lat: 41.792, lon: -87.6 };
  const h = renderNearby(fixture(), NOW);
  const anchor = at(h, "Showing stops near"), next = at(h, "pt-next");
  ok(at(h, NO_TRIP_TITLE) < anchor && anchor < next && next < at(h, 'data-input="nearby-q"'), "no trip: the card, the place, its stop, then the search");
  ok(!h.includes('data-action="nearby:locate"'), "no location prompt without a trip");
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

test("blocked location (DESIGN-SPEC 13.3): one card first, the last try said inside it, then the search", () => {
  N.q = ""; N.mode = "station"; N.anchor = null;
  const at = NOW * 1000;
  eq(triedText(null), "");
  ok(/^Tried at .+ \(try 2\): still blocked, so no popup\. Tap "How to allow location" for the steps\.$/.test(triedText({ code: 1, at, n: 2 })), triedText({ code: 1, at, n: 2 }));
  ok(/^Tried at .+: finding your position took too long/.test(triedText({ code: 3, at, n: 1 })), "other failures keep the Settings wording");
  const h = renderNearby(onTrip({ user: null, locState: "denied", locErr: { code: 1, at, n: 1 } }), NOW);
  const card = h.indexOf("v-locoff--card"), tried = h.indexOf("v-loctried"), help = h.indexOf("How to allow location"), search = h.indexOf('data-input="nearby-q"');
  ok(card >= 0 && tried > card && help > tried && search > help, "card, the try inside it, the help, then the search");
});

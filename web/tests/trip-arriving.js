// Owner 2026-10-30: the Current trip header ("Arriving In: 4 min", else the walking time) and trips with no bus
// (ui/views/tripprogress.js tripMetaText + the walk-only card, core/tripprogress.js walkTrip, Directions' walk option).
import { test, eq, ok } from "./lib.js";
import { tripMetaText, tripProgressHTML, etaText, resetTripMotion } from "../js/ui/views/tripprogress.js";
import { walkTrip } from "../js/core/tripprogress.js";
import { metaNearby, peekNearby } from "../js/ui/views/nearby.js";
import { planJourney, tripBarHTML } from "../js/ui/views/journey.js";
import { NOW, stops, baseState, bus, trip, journeyR, scenes } from "./trip-fixtures.js";

const scene = (id) => scenes().find((s) => s.id === id).state;
const DASH = /[–—]/;
const walkJourney = (over = {}) => ({ kind: "plan", rids: [], label: "To Corner Cafe", to: "Corner Cafe", t0: NOW - 60,
  legs: [{ type: "walk", min: 6, toName: "Corner Cafe" }], dest: { lat: stops.A5.lat, lon: stops.A5.lon }, ...over });

test("arriving in: waiting at the stop counts down to the bus at your boarding stop", () => {
  eq(tripMetaText(scene("waiting"), NOW), `Arriving In: ${etaText(NOW + 240, NOW, false)}`);
  eq(tripMetaText(scene("waiting"), NOW), "Arriving In: 4 min");
});

test("arriving in: on the bus it counts down to the stop where you get off", () => {
  eq(tripMetaText(scene("onbus"), NOW), "Arriving In: 3 min", "A7 (Medical Center) in 200 s");
});

test("arriving in: under a minute says Now; delayed data gets the card's ~", () => {
  eq(tripMetaText(scene("waiting"), NOW + 200), "Arriving In: Now");
  eq(tripMetaText(scene("stale"), NOW), "Arriving In: ~4 min", "feed 7 min old: like the card's ~ time");
});

test("arriving in: no live prediction shows the plan's time as an estimate, never a live number", () => {
  const t = tripMetaText(scene("schedule"), NOW);
  ok(/^Arriving In: ~\d+ min est\.$/.test(t), t);
  const none = baseState({ journey: journeyR({ tripId: null, boardT: null, alightT: null, t0: NOW - 900 }) });
  const u = tripMetaText(none, NOW);
  ok(u === "No live bus time yet" || /^Walk /.test(u), u);
});

test("arriving in: walking legs show the walking time instead", () => {
  const w = tripMetaText(scene("walk"), NOW);
  ok(/^Walk \d+ min$/.test(w), w);
  eq(tripMetaText(scene("arrived"), NOW), "Walk 3 min", "after the last bus: the final walk");
  const j = journeyR({ t0: NOW - 1200, boardT: NOW - 600, alightT: NOW - 60 });
  const done = baseState({ journey: { ...j, legs: j.legs.slice(0, 2) },
    buses: [bus("v101", "101", "R", "tR1", "A7", "A8", 0.5)], trips: [trip("tR1", "R", "v101", "101", [["A8", 60]])] });
  eq(tripMetaText(done, NOW), "Arrived", "off the last bus, no walk left");
});

test("arriving in: a trip with no bus shows the walking time left (from your location when known)", () => {
  eq(tripMetaText(baseState({ journey: walkJourney() }), NOW), "Walk 6 min", "no location: the plan's minutes");
  const near = tripMetaText(baseState({ journey: walkJourney(), user: { lat: stops.A4.lat, lon: stops.A4.lon } }), NOW);
  ok(/^Walk [1-5] min$/.test(near), "222 m away: fewer minutes than planned: " + near);
  const w = walkTrip(walkJourney(), baseState(), NOW);
  eq([w.to, w.min, w.minNow, w.arriveT], ["Corner Cafe", 6, 6, NOW + 360]);
  eq(walkTrip(journeyR(), baseState(), NOW), null, "a trip with a bus is not a walk trip");
});

test("arriving in: the Current trip header uses it while a trip is on (all detents), the nearest stop otherwise", () => {
  const s = scene("waiting");
  eq(metaNearby(s, NOW), "Arriving In: 4 min");
  eq(peekNearby(s, NOW), "Arriving In: 4 min");
  eq(metaNearby(baseState({ journey: walkJourney() }), NOW), "Walk 6 min");
  eq(tripMetaText(baseState(), NOW), "", "no trip: nothing");
  for (const id of ["walk", "waiting", "onbus", "arrived", "schedule", "stale", "missed", "transfer"]) {
    ok(!DASH.test(tripMetaText(scene(id), NOW)), "no dash characters: " + id);
  }
});

test("walk trip: Current trip card, trip bar and journey for Directions' walk option", () => {
  resetTripMotion();
  const h = tripProgressHTML(baseState({ journey: walkJourney() }), NOW);
  ok(h.includes("Trip to Corner Cafe") && h.includes("Walk 6 min to Corner Cafe") && h.includes("No bus needed: it is close enough to walk."), h);
  ok(h.includes('data-action="journey:end"') && h.includes('data-view="directions"'), "End trip and Trip steps");
  ok(tripBarHTML(baseState({ journey: walkJourney() })).includes("Walking the whole way, no bus"));
  const opt = { key: "walk", walkOnly: true, t0: NOW, legs: [{ type: "walk", from: { lat: 1, lon: 2 }, to: { lat: stops.A5.lat, lon: stops.A5.lon, name: "Cafe" }, m: 480, min: 6 }] };
  const j = planJourney(opt, "Corner Cafe");
  ok(j && j.kind === "plan" && j.rids.length === 0 && j.legs.length === 1 && j.legs[0].type === "walk" && j.legs[0].toName === "Corner Cafe" && j.dest, JSON.stringify(j));
  eq(planJourney({ key: "x", legs: [{ type: "walk", min: 3 }] }), null, "other walk-only shapes still start nothing");
});

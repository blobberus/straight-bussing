// Arrivals name the numbered bus (views.test.html; owner 2026-11-06: "When showing which bus is about to arrive at
// station, it should state which bus number displayed on the route is about to arrive if there is more than 1 bus").
// R1 runs two buses here, v1 (label 101) = Bus 1 and v3 (label 103) = Bus 2, with trip updates naming the same vehicle ids
// as Passio's feeds do; R2 runs one bus (v2, label 202): no number, the fleet label as before.
import { test, eq, ok } from "./lib.js";
import { fixture, onTrip, NOW } from "./views-fixtures.js";
import { arrivalRow } from "../js/ui/components.js";
import { renderStop, metaStop, metaStopHTML } from "../js/ui/views/stop.js";
import { favoritesHTML, guidedRow } from "../js/ui/views/nearby-cards.js";
import { nextHTML, bodyHTML } from "../js/ui/views/nearby.js";
import { renderMyRoutes } from "../js/ui/views/myroutes.js";
import { optionLines, stepsHTML } from "../js/ui/views/tripinfo.js";
import { dueAlerts, tripAlerts } from "../js/core/notify.js";
import { tripProgress } from "../js/core/tripprogress.js";
import { tripYou, legStatus } from "../js/core/tripyou.js";
import { cleanNotify } from "../js/state.js";
import { scenes, bus as tbus, trip as ttrip } from "./trip-fixtures.js";
import { arrivalsFor } from "../js/core/arrivals.js";

const tu = (id, rid, vid, label, list) => ({ trip: { trip_id: id, route_id: rid }, vehicle: { id: vid, label }, stop_time_update: list.map(([s, dt]) => ({ stop_id: s, arrival: { time: NOW + dt } })) });
const v3 = { vehicle: { id: "v3", label: "103" }, position: { latitude: 41.7935, longitude: -87.597, bearing: 0, speed: 5 }, trip: { trip_id: "t3", route_id: "R1" }, timestamp: NOW - 5, stop_id: "S3", current_stop_sequence: 3 };
/** R1 with Bus 1 (v1: S1 +2 min, S2 +5, S3 +10) and Bus 2 (v3: S1 +25 min); R2 with one bus (v2: S3 +30 s). */
function two(over = {}, base = fixture) {
  const f = base(over);
  f.buses = [...f.buses, v3];
  f.trips = [tu("t1", "R1", "v1", "101", [["S1", 120], ["S2", 300], ["S3", 600]]), tu("t3", "R1", "v3", "103", [["S1", 1500]]),
    tu("t2", "R2", "v2", "202", [["S3", 30], ["S2", 240]])];
  return f;
}
const text = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d.textContent.replace(/\s+/g, " "); };

test("arrive busnum: an arrival row names Bus 2 in its text and its spoken label; one bus keeps the fleet label", () => {
  const s = two(), [first, second] = arrivalsFor(s, "S1", { nowS: NOW });
  const h1 = arrivalRow(first, s, { now: NOW }), h2 = arrivalRow(second, s, { now: NOW });
  ok(text(h1).includes("Live · Bus 1") && text(h2).includes("Live · Bus 2"), text(h1) + " | " + text(h2));
  ok(h2.includes('aria-label="Route R1, Red Line, Bus 2, arrives in 25 minutes, live"'), h2);
  ok(!text(h2).includes("103"), "the map number replaces the fleet label");
  const one = arrivalRow(arrivalsFor(s, "S3", { nowS: NOW, routeId: "R2" })[0], s, { now: NOW });
  ok(text(one).includes("Live · Bus 202"), "one bus on the line: the fleet label, unchanged");
  ok(one.includes('aria-label="Route B, Blue Loop, arriving now, live"'), one);
  // walking guidance: the number stays, the guidance follows after a comma (one middle dot per line)
  const g = guidedRow(second, s, NOW, 3);
  ok(text(g).includes("Live · Bus 2, leave in 22 min, est."), text(g));
  ok(/aria-label="Route R1, Red Line, Bus 2, arrives in 25 minutes, live, leave in 22 minutes to catch it/.test(g), g);
  ok(!text(guidedRow(arrivalsFor(s, "S3", { nowS: NOW, routeId: "R2" })[0], s, NOW, 3)).includes("Bus"), "one bus + guidance: as before");
});

test("arrive busnum: never a guess: no vehicle, an unknown vehicle, a schedule time name no bus", () => {
  const s = two();
  s.trips = s.trips.map((t) => (t.trip.trip_id === "t3" ? { ...t, vehicle: undefined } : t));
  const a = arrivalsFor(s, "S1", { nowS: NOW })[1];
  const h = arrivalRow(a, s, { now: NOW });
  ok(!text(h).includes("Bus") && h.includes('aria-label="Route R1, Red Line, arrives in 25 minutes, live"'), h);
  s.trips = s.trips.map((t) => (t.trip.trip_id === "t3" ? { ...t, vehicle: { id: "v99", label: "999" } } : t));
  ok(!text(arrivalRow(arrivalsFor(s, "S1", { nowS: NOW })[1], s, { now: NOW })).includes("Bus 2"), "a vehicle the map does not show");
});

test("arrive busnum: the stop page lists Bus 1 and Bus 2; its collapsed header names the next one", () => {
  const s = two({ view: "stop", stopId: "S1" });
  const t = text(renderStop(s, NOW));
  ok(t.includes("Live · Bus 1") && t.includes("Live · Bus 2"), t);
  eq(metaStop(s, NOW), "R1, Bus 1 · 2 min");
  const m = metaStopHTML(s, NOW);
  ok(m.includes('aria-label="Next bus: Red Line, Bus 1, in 2 minutes"') && m.includes('<span class="hm-bus">Bus 1</span>'), m);
  const one = fixture({ view: "stop", stopId: "S1" });
  ok(!metaStopHTML(one, NOW).includes("hm-bus") && !/Bus \d/.test(metaStop(one, NOW)), "one bus: no number");
});

test("arrive busnum: Current trip: the next-bus card, Favorites and Arriving soon name the bus", () => {
  const s = two({ user: { lat: 41.7901, lon: -87.6001 } }, onTrip);
  const nx = text(nextHTML(s, NOW));
  ok(nx.includes("Bus 1, ") && nx.includes("Bus 2, "), "the next-bus card: " + nx);
  const fav = favoritesHTML(two({ favStops: ["S1"] }), NOW);
  ok(text(fav).includes("Red Line · Bus 1") && fav.includes("route R1, Bus 1, in 2 minutes"), fav);
  const soon = text(bodyHTML(two({}, onTrip), NOW));
  ok(soon.includes("Arriving soon") && soon.includes("Red Line · Bus 1"), soon);
  ok(soon.includes("Blue Loop") && !soon.includes("Blue Loop · Bus"), "one bus on Blue Loop: no number");
});

test("arrive busnum: My Routes: favorite stations and a custom route's next bus name it", () => {
  const s = two({ favStops: ["S1"] });
  const h = renderMyRoutes(s, NOW);
  ok(text(h).includes("Red Line · Bus 1") && h.includes("next bus Red Line, Bus 1, in 2 min"), text(h));
});

test("arrive busnum: Directions: a live first bus of a line with several buses is named; steps too", () => {
  const s = two();
  const leg = { type: "bus", rid: "R1", board: { id: "S1", name: "Main & 1st" }, alight: { id: "S3", name: "Hospital" }, wait: 25, ride: 5,
    boardT: NOW + 1500, alightT: NOW + 1800, waitLive: true, vehicleId: "v3", source: "live", stopsPassed: 2 };
  const o = { t0: NOW, totalMin: 32, arrive: NOW + 1920, legs: [{ type: "walk", min: 2, m: 160 }, leg, { type: "walk", min: 2, m: 160 }] };
  const l = optionLines(o, NOW, "", s);
  ok(/^Leave in 23 min for Bus 2, .+ at Main & 1st$/.test(l.text), l.text);
  ok(/^Leave in 23 min, bus .+ at Main & 1st$/.test(optionLines(o, NOW, "").text), "without the state: as before");
  const st = stepsHTML(o, NOW, s);
  ok(text(st).includes("Bus 2 arrives at Main & 1st") && text(st).includes("to catch Bus 2 at"), text(st));
  const sched = { ...o, legs: [o.legs[0], { ...leg, waitLive: false }, o.legs[2]] };
  ok(/^Bus about .+ at Main & 1st, est\.$/.test(optionLines(sched, NOW, "", s).text), "a schedule time names no bus");
  ok(text(stepsHTML(sched, NOW, s)).includes("Bus arrives at Main & 1st"));
  const one = { ...o, legs: [o.legs[0], { ...leg, rid: "R2", vehicleId: "v2" }, o.legs[2]] };
  ok(/, bus .+ at Main & 1st$/.test(optionLines(one, NOW, "", s).text), "one bus on the line: as before");
});

test("arrive busnum: station alerts say Bus 2 on a line with several buses, the fleet label with one", () => {
  const s = two({ notify: cleanNotify({ stopId: "S2", oneStop: true, twoStops: true }) });
  const r = dueAlerts(s, new Set(), NOW);
  ok(r.alerts.some((a) => a.title === "Red Line: 1 stop away" && a.body.startsWith("Bus 1 to Library.")), JSON.stringify(r.alerts));
  ok(r.alerts.some((a) => a.body.startsWith("Bus 202 to Library.")), "Blue Loop has one bus: its fleet label");
  const one = fixture({ notify: cleanNotify({ stopId: "S2", oneStop: true, twoStops: true }) });
  const r1 = dueAlerts(one, new Set(), NOW);
  ok(r1.alerts.some((a) => a.body.startsWith("Bus 101 to Library.")), JSON.stringify(r1.alerts));
});

test("arrive busnum: a trip's bus is named as on the map: card status, map label, trip alerts", () => {
  const sc = (id) => scenes().find((x) => x.id === id).state;
  const other = tbus("v105", "105", "R", "tR5", "A7", "A8", 0.5);
  const st = { ...sc("waiting"), notify: cleanNotify(null) };
  st.buses = [...st.buses, other];
  st.trips = [...st.trips, ttrip("tR5", "R", "v105", "105", [["A8", 60]])];
  const p = tripProgress(st.journey, st, NOW), leg = p.legs[p.active];
  eq(leg.vehicle.num, 1);
  eq(legStatus(leg), "Bus 1 is 2 stops away");
  const r = tripAlerts(p, st, new Set(), NOW);
  eq(r.alerts[0].title, "Red Line: Bus 1 is 2 stops away");
  const ob = { ...sc("onbus"), notify: cleanNotify(null) };
  ob.buses = [...ob.buses, tbus("v100", "100", "R", "tR0", "A0", "A1", 0.5)];
  const po = tripProgress(ob.journey, ob, NOW);
  eq(tripYou(po, ob).text.startsWith("You are on Bus 2."), true, tripYou(po, ob).text);
  const ro = tripAlerts(po, ob, new Set(), NOW);
  ok(ro.alerts[0].body.startsWith("Red Line, Bus 2."), ro.alerts[0].body);
  // one bus on the line: the fleet label, as before
  const solo = { ...sc("waiting"), notify: cleanNotify(null) };
  eq(tripAlerts(tripProgress(solo.journey, solo, NOW), solo, new Set(), NOW).alerts[0].title, "Red Line: Bus 101 is 2 stops away");
});

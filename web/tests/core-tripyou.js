// Tests for core/tripyou.js (you on the trip map) and core/notify.js tripAlerts (alerts in step with it):
// owner request 2026-10-13. Fixtures: trip-fixtures.js (line R A0..A8 ~222 m apart).
import { test, eq, ok, near } from "./lib.js";
import { tripProgress, tripNow, TRIP } from "../js/core/tripprogress.js";
import { tripYou, offText, offShort, legStatus, busName, ptOf, YOU } from "../js/core/tripyou.js";
import { tripAlerts, tripAlertsOn, dueAlerts, DELAYED_TITLE, TRIP_DELAYED_BODY } from "../js/core/notify.js";
import { cleanNotify } from "../js/state.js";
import { NOW, stops, bus, trip, journeyR, scenes } from "./trip-fixtures.js";

const scene = (id, over = {}) => ({ ...scenes().find((s) => s.id === id).state, notify: cleanNotify(null), ...over });
const prog = (st, now = NOW) => tripProgress(st.journey, st, now);
const you = (st, now = NOW) => tripYou(prog(st, now), st);
const tR1 = (list) => trip("tR1", "R", "v101", "101", list);
const at = (id, dLat = 0, accuracy) => ({ lat: stops[id].lat + dLat, lon: stops[id].lon, ...(accuracy != null ? { accuracy } : {}) });
const kinds = (r) => r.alerts.map((a) => a.kind);

test("offText / offShort / legStatus: one wording for the counts", () => {
  eq(offText(0, "X"), "Get off here: X");
  eq(offText(1, "X"), "Get off at the next stop: X");
  eq(offText(3, "X"), "Get off in 3 stops: X");
  eq([offShort(0), offShort(1), offShort(2), offShort(null)], ["Get off here", "Get off next stop", "Get off in 2 stops", "Get off here"]);
  eq(busName({ label: "101" }), "Bus 101"); eq(busName(null), "The bus");
  const p = prog(scene("onbus")), leg = p.legs[p.active];
  eq(legStatus(leg), "Get off in 2 stops: Medical Center", "the card, the map and the alert say the same");
  const w = prog(scene("waiting"));
  eq(legStatus(w.legs[w.active]), "Bus 101 is 2 stops away");
  eq(ptOf({ lat: null, lon: 1 }), null); eq(ptOf({ lat: 0, lon: 0 }), null); eq(ptOf({ lat: "41.8", lon: "-87.6" }), { lat: 41.8, lon: -87.6 });
});

test("tripYou on the bus: drawn at the bus, with the get-off count the card shows", () => {
  const st = scene("onbus"), p = prog(st), y = tripYou(p, st), leg = p.legs[p.active];
  eq([y.phase, y.source, y.onBus, y.far], ["on-bus", "bus", true, false]);
  eq([y.lat, y.lon], [leg.vehicle.lat, leg.vehicle.lon]);
  eq([y.stopsLeft, y.vehicleId, y.label], [2, "v101", "101"]);
  eq(y.text, "You are on Bus 101. Get off in 2 stops: Medical Center");
  eq([y.target.id, y.target.role], ["A7", "alight"]);
  eq(y.frame, [[y.lat, y.lon], [stops.A7.lat, stops.A7.lon]]);
  // GPS on the bus (40 m off): still drawn at the bus; a poor fix far away also does not move you off it
  eq(you({ ...st, user: { lat: leg.vehicle.lat + 0.00036, lon: leg.vehicle.lon, accuracy: 20 } }).source, "bus");
  eq(you({ ...st, user: { ...at("A0"), accuracy: 900 } }).source, "bus", "inaccurate fix");
});

test("a bus without a number: 'the bus' inside a sentence, and alerts do not name it", () => {
  const nolabel = (s) => ({ ...s, buses: s.buses.map((b) => ({ ...b, vehicle: { id: b.vehicle.id, label: "" } })), trips: s.trips.map((t) => ({ ...t, vehicle: { id: t.vehicle.id, label: "" } })) });   // an empty label (a missing one falls back to the vehicle id)
  const st = nolabel(scene("onbus"));
  eq(you(st).text, "You are on the bus. Get off in 2 stops: Medical Center");
  eq(you({ ...st, user: at("A0", 0, 10) }).text, "Your location is not near the bus. Stop counts follow the bus.");
  const r = tripAlerts(prog(st), st, new Set(), NOW);
  eq(r.alerts[0].body, "Red Line. Your stop in about 3 min (est.).");
  const w = nolabel(scene("walk", { notify: cleanNotify({ minutes: 10 }) }));
  eq(tripAlerts(prog(w), w, new Set(), NOW).alerts[0].body, "Next stop: 56th & Ellis.");
  eq(legStatus(prog(nolabel(scene("waiting"))).legs[1]), "The bus is 2 stops away", "a sentence start stays capitalized");
});

test("tripYou on the bus but your accurate GPS is far from it: your GPS, and it says so", () => {
  const st = scene("onbus", { user: at("A0", 0, 15) }), y = you(st);
  eq([y.source, y.onBus, y.far], ["gps", false, true]);
  eq([y.lat, y.lon], [stops.A0.lat, stops.A0.lon]);
  eq(y.text, "Your location is not near Bus 101. Stop counts follow the bus.");
  eq(y.stopsLeft, 2, "the count still follows the bus");
  // missing accuracy counts as accurate; the limit grows with the accuracy
  eq(you(scene("onbus", { user: at("A0") })).far, true);
  const p = prog(scene("onbus")), v = p.legs[p.active].vehicle;
  const d = (YOU.FAR_M + 50) / (111320 * Math.cos((v.lat * Math.PI) / 180));   // 350 m east of the bus (off the line)
  eq(you(scene("onbus", { user: { lat: v.lat, lon: v.lon + d, accuracy: 30 } })).far, true);
  eq(you(scene("onbus", { user: { lat: v.lat, lon: v.lon + d, accuracy: 80 } })).far, false, "350 m < 300 + 80");
});

test("tripYou walking, waiting, arrived: your GPS, else the boarding stop while waiting, else nothing", () => {
  const w = you(scene("walk"));
  eq([w.phase, w.source, w.onBus], ["walk-to-stop", "gps", false]);
  eq(w.text, "Your location. Walking to Ratner Center.");
  eq([w.target.id, w.target.role, w.stopsAway], ["A4", "board", 3]);
  eq(w.frame.length, 3, "you, the boarding stop and the bus 3 stops away");
  const far = scene("walk", { buses: [bus("v101", "101", "R", "tR1", "A0", "A1", 0.1)], trips: [tR1([["A0", 30], ["A1", 120], ["A4", 600], ["A7", 900]])],
    journey: journeyR({ boardT: NOW + 600, alightT: NOW + 900 }) });
  const routeStopsBefore = you(far);
  ok(routeStopsBefore.frame.length <= 3);
  const g = you(scene("waiting"));
  eq([g.phase, g.source, g.text], ["waiting", "gps", "Your location. Waiting at Ratner Center."]);
  eq(g.frame.length, 3, "the bus 2 stops away joins the frame");
  // waiting without location: at the boarding stop (the walk's time is up), said without "Your location"
  const s = you(scene("schedule"));
  eq([s.phase, s.source, s.lat, s.lon, s.text], ["waiting", "stop", stops.A4.lat, stops.A4.lon, "Waiting at Ratner Center."]);
  // walking without location: no marker (never a guessed position)
  const nw = you(scene("walk", { user: null }));
  eq([nw.phase, nw.source, nw.lat, nw.text], ["walk-to-stop", null, null, ""]);
  eq(nw.frame, [[stops.A4.lat, stops.A4.lon], [nw.busLat, nw.busLon]]);
  const a = you(scene("arrived"));
  eq([a.phase, a.source, a.lat, a.target.id, a.target.role], ["arrived", null, null, "A7", "alight"]);
  const ad = you(scene("arrived", { user: at("A8"), journey: { ...journeyR({ t0: NOW - 1200, boardT: NOW - 600, alightT: NOW - 60 }), dest: { lat: 41.81, lon: -87.6 } } }));
  eq([ad.source, ad.target.role, ad.target.name, ad.target.lat], ["gps", "dest", "Medical Center Cafe", 41.81]);
  eq(ad.text, "Your location. Walking to Medical Center Cafe.");
  eq(tripYou(null, scene("walk")), null);
});

test("tripNow: one evaluation per data change, shared by the card, the map and the alerts", () => {
  const st = scene("onbus");
  const a = tripNow(st, NOW), b = tripNow(st, NOW + 3);
  ok(a === b, "same data, a few seconds later: the same object");
  ok(tripNow(st, NOW + TRIP.MEMO_S + 1) !== a, "later: evaluated again");
  const moved = { ...st, buses: [bus("v101", "101", "R", "tR1", "A6", "A7", 0.3)], trips: [tR1([["A7", 60], ["A8", 160]])] };
  const c = tripNow(moved, NOW + TRIP.MEMO_S + 2);
  eq(c.legs[c.active].stopsLeft, 1, "a new bus position is a new evaluation");
  eq(tripNow({ ...moved, journey: null }, NOW), null);
});

test("tripAlerts on board: 'Get off in 2 stops', then 'Get off at the next stop', once each", () => {
  const st = scene("onbus");
  let r = tripAlerts(prog(st), st, new Set(), NOW);
  eq(kinds(r), ["off2"]);
  eq(r.alerts[0].title, "Get off in 2 stops: Medical Center");
  eq(r.alerts[0].body, "Red Line, Bus 101. Your stop in about 3 min (est.).");
  eq(tripAlerts(prog(st), st, r.fired, NOW + 5).alerts, [], "once per ride");
  const next = { ...st, buses: [bus("v101", "101", "R", "tR1", "A6", "A7", 0.3)], trips: [tR1([["A7", 60], ["A8", 160]])] };
  const p2 = prog(next, NOW + 20);
  r = tripAlerts(p2, next, r.fired, NOW + 20);
  eq(kinds(r), ["off1"]);
  eq(r.alerts[0].title, "Get off at the next stop: Medical Center");
  eq(r.alerts[0].title, p2.legs[p2.active].stopsLeft === 1 ? offText(1, "Medical Center") : "", "same count as the card");
  // the trip id rolls mid-ride: no repeat
  const rolled = { ...next, buses: [bus("v101", "101", "R", "tR9", "A6", "A7", 0.5)], trips: [trip("tR9", "R", "v101", "101", [["A7", 40]])] };
  eq(tripAlerts(prog(rolled, NOW + 30), rolled, r.fired, NOW + 30).alerts, []);
});

test("tripAlerts: a jump to the next stop never fires a late 2-stops alert; switches respected", () => {
  const next = scene("onbus", { buses: [bus("v101", "101", "R", "tR1", "A6", "A7", 0.3)], trips: [tR1([["A7", 60], ["A8", 160]])] });
  let r = tripAlerts(prog(next), next, new Set(), NOW);
  eq(kinds(r), ["off1"]);
  const back = scene("onbus");
  eq(tripAlerts(prog(back), back, r.fired, NOW).alerts, [], "off1 already fired: no off2 after it");
  const off = scene("onbus", { notify: cleanNotify({ trip: false }) });
  eq(tripAlerts(prog(off), off, new Set(), NOW).alerts, [], "trip alerts off");
  const two = scene("onbus", { notify: cleanNotify({ twoStops: false }) });
  eq(tripAlerts(prog(two), two, new Set(), NOW).alerts, [], "2 stops switched off");
  eq(tripAlerts(null, back, new Set(), NOW).alerts, []);
  const arr = scene("arrived");
  eq(tripAlerts(prog(arr), arr, new Set(), NOW).alerts, [], "nothing once off the last bus");
});

test("tripAlerts before boarding: 2 stops, then 1 stop / next, per followed bus; minutes from live times only", () => {
  const st = scene("waiting");
  let r = tripAlerts(prog(st), st, new Set(), NOW);
  eq(kinds(r), ["board2"]);
  eq(r.alerts[0].title, "Red Line: Bus 101 is 2 stops away");
  eq(r.alerts[0].body, "Board at Ratner Center. Arrives in about 4 min (est.).");
  const near = { ...st, buses: [bus("v101", "101", "R", "tR1", "A3", "A4", 0.4)], trips: [tR1([["A4", 50], ["A5", 140], ["A7", 300]])] };
  r = tripAlerts(prog(near), near, r.fired, NOW);
  eq(kinds(r), ["board1"]);
  eq(r.alerts[0].title, "Red Line: Bus 101 is approaching Ratner Center");
  const walk = scene("walk", { notify: cleanNotify({ minutes: 10 }) });
  r = tripAlerts(prog(walk), walk, new Set(), NOW);
  eq(kinds(r), ["boardMin"], "3 stops away: only the minutes alert");
  eq(r.alerts[0].title, "Red Line: arriving at Ratner Center in about 7 min (est.)");
  eq(r.alerts[0].body, "Bus 101. Next stop: 56th & Ellis.");
  const sched = scene("schedule", { notify: cleanNotify({ minutes: 10 }) });
  eq(tripAlerts(prog(sched), sched, new Set(), NOW).alerts, [], "no live bus: no alert");
});

test("tripAlerts: live data down = ONE 'Live data delayed' alert per outage, never while the feed is paused", () => {
  const down = scene("onbus", { failed: true });
  let r = tripAlerts(prog(down), down, new Set(), NOW);
  eq(kinds(r), ["delayed"]);
  eq([r.alerts[0].title, r.alerts[0].body], [DELAYED_TITLE, TRIP_DELAYED_BODY]);
  ok(r.alerts[0].body.includes("773.702.8181"));
  eq(tripAlerts(prog(down), down, r.fired, NOW + 30).alerts, [], "once per outage");
  const fresh = scene("onbus");
  r = tripAlerts(prog(fresh), fresh, r.fired, NOW + 40);
  eq(kinds(r), ["off2"], "fresh again: the normal alerts");
  eq(kinds(tripAlerts(prog(down), down, r.fired, NOW + 60)), ["delayed"], "a new outage alerts again");
  eq(tripAlerts(prog(down), down, new Set(), NOW, { polling: false }).alerts, [], "paused background tab: not an outage");
  const aged = scene("onbus", { lastOk: NOW - 400, feedTs: NOW - 400 });
  eq(tripAlerts(prog(aged), aged, new Set(), NOW).alerts, [], "data only aged (polling paused, back from the background): no alert");
  const never = scene("onbus", { lastOk: 0 });
  eq(tripAlerts(prog(never), never, new Set(), NOW).alerts, [], "before the first good poll: nothing");
  const old = scene("stale");
  eq(kinds(tripAlerts(prog(old), old, new Set(), NOW)), ["delayed"], "feed 7 min old");
});

test("station alerts pause during a trip with trip alerts on; their outage alert is one too", () => {
  const st = scene("onbus");
  const p = prog(st);
  eq(tripAlertsOn(p, st), true);
  eq(tripAlertsOn(p, { ...st, notify: cleanNotify({ trip: false }) }), false);
  eq(tripAlertsOn(prog(scene("arrived")), st), false);
  eq(tripAlertsOn(null, st), false);
  const station = { ...st, notify: cleanNotify({ stopId: "A7" }) };
  ok(dueAlerts(station, new Set(), NOW).alerts.length > 0, "the bus is 1 stop from A7: a station alert without a trip");
  eq(dueAlerts(station, new Set(), NOW, { tripOn: true }).alerts, [], "paused while the trip's alerts run");
  const down = { ...station, failed: true };
  const r = dueAlerts(down, new Set(), NOW);
  eq(kinds(r), ["delayed"]);
  eq(dueAlerts(down, r.fired, NOW + 10).alerts, []);
  eq(dueAlerts(down, new Set(), NOW, { polling: false }).alerts, []);
});

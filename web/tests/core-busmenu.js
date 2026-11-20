// core/busmenu.js (bus.test.html): the bus menu's model, words, 45 s hold and times (owner 2026-11-20).
import { test, eq, ok } from "./lib.js";
import { BUS_MENU, STALE_BUS_S, busByKey, heldBus, isAway, menuBusKey, menuSync, lineHours, timeText,
  busMenuModel, statusSay, reportInfo } from "../js/core/busmenu.js";
import { ETA_WORDS, ETA_NOTES, EST_MAX_MIN, markFiller, _resetEta } from "../js/core/eta.js";
import { PICK_HOLD_S } from "../js/core/busnum.js";
import { TRANSITION_TEXT } from "../js/core/seen.js";
import { fixture, NOW } from "./views-fixtures.js";
import { serviceFixture, utc } from "./route-fixtures.js";

const DASH = /[‒–—―]/;
/** R1 (Main & 1st > Library > Hospital) with bus v1 heading to S2; R2 is a loop S3 > S2 > S4 > S3 with bus v2 heading to S2. */
const state = (over = {}) => {
  const s = fixture({ view: "bus", routeId: "R1", busMenu: "v1", ...over });
  s.buses = s.buses.map((b) => (b.vehicle.id === "v1" ? { ...b, stop_id: "S2" } : b.vehicle.id === "v2" ? { ...b, stop_id: "S2" } : b));
  // trip updates carry the same vehicle ids as the positions (as Passio's feeds do)
  const tu = (id, rid, vid, label, list) => ({ trip: { trip_id: id, route_id: rid }, vehicle: { id: vid, label }, stop_time_update: list.map(([st, dt]) => ({ stop_id: st, arrival: { time: NOW + dt } })) });
  s.trips = [tu("t1", "R1", "v1", "101", [["S1", 120], ["S2", 300], ["S3", 600]]), tu("t2", "R2", "v2", "202", [["S3", 30], ["S2", 240], ["S4", 900]]),
    tu("t3", "R1", "v3", "103", [["S1", 1500]]), tu("t4", "R3", "v4", "303", [["S1", 400], ["S3", 700]])];
  return { ...s, ...over };
};

test("busmenu: the rows come from core/eta.js busTimes: this bus's own live times, an estimate where it has none", () => {
  _resetEta();
  const s = state(), ride = () => 3;   // 3 min between stops
  const m = busMenuModel(s, heldBus(null, s, "v1", NOW), NOW, { ride });
  eq(m.rows.map((r) => [r.stopId, r.kind, r.t]), [["S2", "live", NOW + 300], ["S3", "live", NOW + 600]], "R1 from its next stop: v1's own times");
  eq(m.rows.map((r) => r.away), [0, 1], "stops before each");
  // v3 on R1 has a live time at S1 only (its trip t3): the stops after it are estimates, never another bus's times
  const s3 = state();
  s3.buses = [...s3.buses, { vehicle: { id: "v3", label: "103" }, position: { latitude: 41.79, longitude: -87.6 }, trip: { trip_id: "t3", route_id: "R1" }, timestamp: NOW - 5, stop_id: "S1", current_stop_sequence: 1 }];
  const m3 = busMenuModel({ ...s3, busMenu: "v3" }, heldBus(null, s3, "v3", NOW), NOW, { ride });
  eq(m3.rows.map((r) => r.stopId), ["S1", "S2", "S3"]);
  eq(m3.rows[0].kind, "live");
  ok(m3.rows.slice(1).every((r) => r.kind === "est" && r.t > NOW + 1500), "after its live time: estimates from it, not v1's times");
  // a loop wraps once from the next stop, its repeated last stop dropped
  const lp = state({ busMenu: "v2", routeId: "R2" });
  eq(busMenuModel(lp, heldBus(null, lp, "v2", NOW), NOW, { ride }).rows.map((r) => r.stopId), ["S2", "S4", "S3"]);
  // Passio filler (+2 s after the stop before) is never a live time (core/eta.js markFiller, data/live.js)
  const fl = state();
  fl.trips = fl.trips.map((t) => (t.trip.trip_id === "t1" ? markFiller({ ...t, stop_time_update: [{ stop_id: "S2", arrival: { time: NOW + 300 } }, { stop_id: "S3", arrival: { time: NOW + 302 } }] }) : t));
  const mf = busMenuModel(fl, heldBus(null, fl, "v1", NOW), NOW, { ride });
  eq(mf.rows.map((r) => r.kind), ["live", "est"], "the filler stop gets an estimate instead");
  ok(mf.anyEst, "an estimate is on screen");
});

test("busmenu: heldBus keeps a missing bus 45 s (PICK_HOLD_S, the map badge's hold), then it is gone", () => {
  const s = state();
  let h = heldBus(null, s, "v1", NOW);
  ok(h.bus && !h.gone && h.bus.vehicle.id === "v1", "in the feed");
  const missing = { ...s, buses: s.buses.filter((b) => b.vehicle.id !== "v1") };
  h = heldBus(h.mem, missing, "v1", NOW + 10);
  ok(h.bus && !h.gone, "missing for one poll: the last copy");
  h = heldBus(h.mem, missing, "v1", NOW + 10 + PICK_HOLD_S - 1);
  ok(h.bus && !h.gone, "still within the hold");
  h = heldBus(h.mem, missing, "v1", NOW + 10 + PICK_HOLD_S);
  ok(!h.bus && h.gone, "after 45 s: gone");
  ok(h.mem.bus && h.mem.bus.vehicle.id === "v1", "its last copy is kept (the menu can still name it)");
  h = heldBus(h.mem, s, "v1", NOW + 100);
  ok(h.bus && !h.gone && h.mem.since === 0, "back in the feed: shown again");
  eq(heldBus(h.mem, s, "v9", NOW).gone, true, "another key never inherits a held bus");
  eq(heldBus(null, s, null, NOW).gone, true, "no key: gone");
  eq(PICK_HOLD_S, 45);
});

test("busmenu: menuBusKey rings the menu's bus on the map only while the bus menu is open; isAway reads store.away", () => {
  eq(menuBusKey(state()), "v1");
  eq(menuBusKey(state({ view: "route" })), null);
  eq(menuBusKey(state({ busMenu: null })), null);
  const s = state();
  ok(!isAway(s, "v1"));
  ok(isAway({ ...s, away: [{ vehicle: { id: "v1" }, trip: { route_id: "R1" } }] }, "v1"), "more than a block off its route");
});

test("busmenu: menuSync keeps store.busMenu in step with the router; a bus moved to another line takes the menu along", () => {
  eq(menuSync(state(), "v1"), null, "in step: nothing to do");
  eq(menuSync(state({ busMenu: null }), "v1"), { patch: { busMenu: "v1" } }, "Back to a bus menu: its bus from the params");
  eq(menuSync(state(), "v2"), { patch: { busMenu: "v2" } }, "another bus's menu");
  eq(menuSync(state({ view: "route" }), undefined), { patch: { busMenu: null } }, "off the menu: none");
  eq(menuSync(state({ view: "route", busMenu: null }), undefined), null);
  const moved = state();
  moved.buses = moved.buses.map((b) => (b.vehicle.id === "v1" ? { ...b, trip: { ...b.trip, route_id: "R2" } } : b));
  eq(menuSync(moved, "v1"), { nav: { routeId: "R2", bus: "v1" } }, "Passio filed it under R2: the menu follows");
  const unknown = state();
  unknown.buses = unknown.buses.map((b) => (b.vehicle.id === "v1" ? { ...b, trip: { ...b.trip, route_id: "ZZ" } } : b));
  eq(menuSync(unknown, "v1"), null, "an unknown line: stay");
});

test("busmenu: lineHours says today's hours in the route page's words, Scheduled now or not", () => {
  const svc = serviceFixture();
  const noon = utc("2026-11-20T18:00:00Z");   // Friday 12:00 PM Chicago
  eq(lineHours(svc, "D", noon), { k: "Today", label: "7:00 AM to 7:25 PM", note: "", on: true });
  eq(lineHours(svc, "D", utc("2026-11-20T08:00:00Z")).on, false, "2 AM: not scheduled now");
  const sat = lineHours(svc, "D", utc("2026-11-21T18:00:00Z"));
  eq([sat.k, sat.label, sat.on], ["Today", "No service", false], "Saturday: no service");
  const late = lineHours(svc, "N", utc("2026-11-21T07:00:00Z"));   // Saturday 1:00 AM: Friday's night service
  eq([late.k, late.on], ["Friday service", true], "after midnight: the evening's hours");
  eq(lineHours(svc, "D", utc("2026-11-26T18:00:00Z")).note, BUS_MENU.changed, "Thanksgiving removed");
  eq(lineHours(svc, "nope", noon), null, "no schedule data");
});

test("busmenu: timeText says times in the station times' words (core/eta.js timeWords): live, est., far estimates", () => {
  eq(timeText({ t: NOW + 200, kind: "live" }, NOW), { text: "3 min", tag: "", say: "in 3 min", now: false, far: false });
  eq(timeText({ t: NOW + 30, kind: "live" }, NOW), { text: "Now", tag: "", say: "now", now: true, far: false });
  eq(timeText({ t: NOW + 200, kind: "live" }, NOW, true).text, "~3 min", "stale feed");
  eq(timeText({ t: NOW + 300, kind: "est" }, NOW), { text: "~5 min", tag: "est.", say: "in about 5 min, estimated", now: false, far: false });
  eq(timeText({ t: NOW + 10, kind: "est" }, NOW).text, "~1 min", "an estimate is never 'Now'");
  const far = timeText({ t: NOW + (EST_MAX_MIN + 5) * 60, kind: "est", away: 3 }, NOW);
  eq([far.text, far.tag, far.far], ["3 stops away", ETA_WORDS.notLive, true], "past EST_MAX_MIN: stops away, not live");
  eq(timeText({ t: null, kind: "live" }, NOW).text, "", "no time");
  eq([ETA_WORDS.est, ETA_WORDS.estSay], ["est.", "estimated"], "the contract's words");
  eq(BUS_MENU.estFoot, ETA_NOTES.est, "the route page's est. note");
});

test("busmenu: the model of a live bus: its line, Bus name, next stop with its time, one lap of rows", () => {
  const s = state(), h = heldBus(null, s, "v1", NOW);
  const m = busMenuModel(s, h, NOW);
  eq([m.status, m.rid, m.line, m.name], ["ok", "R1", "Red Line", "Bus 101"], "one bus on R1: its fleet label");
  eq(m.next, { stopId: "S2", name: "Library", t: NOW + 300, kind: "live", away: 0 });
  eq(m.rows.map((r) => r.name), ["Library", "Hospital"]);
  eq([m.anyEst, m.loopTo, m.stale], [false, "", false]);
  eq(statusSay(m, NOW, { liveSay: "live" }), "Bus 101, heading to Library, in 5 min, live");
  // two buses on R1: numbered like the map badges
  const two = state();
  two.buses = [...two.buses, { vehicle: { id: "v3", label: "103" }, position: { latitude: 41.79, longitude: -87.6 }, trip: { trip_id: "t3", route_id: "R1" }, timestamp: NOW - 5, stop_id: "S1" }];
  eq(busMenuModel(two, heldBus(null, two, "v1", NOW), NOW).name, "Bus 1");
  // a stale report
  const old = state();
  old.buses = old.buses.map((b) => (b.vehicle.id === "v1" ? { ...b, timestamp: NOW - STALE_BUS_S - 60 } : b));
  const mo = busMenuModel(old, heldBus(null, old, "v1", NOW), NOW);
  ok(mo.stale, "older than 60 s");
  ok(/location from 2 min ago$/.test(statusSay(mo, NOW)), statusSay(mo, NOW));
  // a loop says where it continues; est rows (from core/eta.js) flag anyEst
  const lp = state({ busMenu: "v2", routeId: "R2" });
  const ml = busMenuModel(lp, heldBus(null, lp, "v2", NOW), NOW, { times: () => [{ stopId: "S2", idx: 1, t: NOW + 240, kind: "live" }, { stopId: "S4", idx: 2, t: NOW + 600, kind: "est" }] });
  eq([ml.loopTo, ml.anyEst, ml.rows[1].kind], ["Library", true, "est"]);
  // an estimate past EST_MAX_MIN for the next stop: the status gives no minutes (its row says "Heading here, Not live")
  const mfar = busMenuModel(s, heldBus(null, s, "v1", NOW), NOW, { times: () => [{ stopId: "S2", idx: 1, t: NOW + (EST_MAX_MIN + 8) * 60, kind: "est", away: 0 }] });
  eq([mfar.next.t, mfar.rows[0].t > 0, mfar.anyEst], [null, true, false]);
  eq(statusSay(mfar, NOW), "Bus 101, heading to Library");
});

test("busmenu: a transitioning bus shows no times; an away bus and a gone bus say so", () => {
  const tr = state({ transitioning: ["v1"] });
  const mt = busMenuModel(tr, heldBus(null, tr, "v1", NOW), NOW);
  eq([mt.status, mt.rows.length], ["transitioning", 0]);
  eq(statusSay(mt, NOW), `Bus 101, ${TRANSITION_TEXT}`);
  const aw = state({ away: [{ vehicle: { id: "v1" }, trip: { route_id: "R1" } }] });
  eq(busMenuModel(aw, heldBus(null, aw, "v1", NOW), NOW).status, "away");
  const gone = state();
  gone.buses = gone.buses.filter((b) => b.vehicle.id !== "v1");
  const mg = busMenuModel(gone, { bus: null, gone: true }, NOW);
  eq([mg.status, mg.rid, mg.line, mg.name], ["gone", "R1", "Red Line", ""], "the line it was on stays");
  eq(statusSay(mg, NOW), BUS_MENU.goneTitle);
  ok(mg.hours === null, "no service data in the fixture: no hours");
});

test("busmenu: reportInfo carries ONLY the line, bus, next stop, Chicago time to the minute and the app version", () => {
  const s = state(), m = busMenuModel(s, heldBus(null, s, "v1", NOW), NOW);
  const t = utc("2026-11-20T19:15:31Z");   // 1:15:31 PM Chicago -> 13:16 (rounded to the minute)
  const r = reportInfo(m, t, "2.0.0");
  eq(r, { line: "Red Line", bus: "Bus 101", stop: "Library", time: "2026-11-20 13:16", version: "2.0.0" });
  eq(Object.keys(r), ["line", "bus", "stop", "time", "version"]);
  ok(!/41\.|87\.|lat|lon/i.test(JSON.stringify(r)), "never a location");
  eq(reportInfo(m, utc("2026-07-04T17:00:00Z"), "2.0.0").time, "2026-07-04 12:00", "daylight time (CDT) too");
});

test("busmenu: every word is plain: no dash characters, at most one middle dot, no university names of its own", () => {
  for (const [k, w] of Object.entries(BUS_MENU)) {
    ok(!DASH.test(w), `no en / em dash: ${k}`);
    ok((w.match(/·/g) || []).length <= 1, `one middle dot at most: ${k}`);
    ok(!/UChicago|UGo|University/.test(w), `no university names: ${k}`);
  }
  eq(BUS_MENU.report, "Report and feedback");
  eq(BUS_MENU.reportSoon, "Coming soon: report a problem with this bus or send feedback.");
  eq(BUS_MENU.goneTitle, "This bus is no longer reporting");
  eq(BUS_MENU.wholeRoute, "See the whole route");
  eq([BUS_MENU.scheduledNow, BUS_MENU.notScheduledNow], ["Scheduled now", "Not scheduled now"], "the route page's words");
});

// core/busmenu.js (bus.test.html): the bus menu's model, words, 45 s hold and times (owner 2026-11-20).
import { test, eq, ok } from "./lib.js";
import { BUS_MENU, ETA_WORDS, STALE_BUS_S, busTimes, busByKey, heldBus, isAway, menuBusKey, menuSync, lineHours, timeText,
  busMenuModel, statusSay, reportInfo } from "../js/core/busmenu.js";
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

test("busmenu: busTimes (stand-in) lists this bus's next stops from its next stop, one lap, with its own live times only", () => {
  const s = state(), v1 = busByKey(s, "v1");
  const rows = busTimes(s, v1, NOW);
  eq(rows.map((r) => r.stopId), ["S2", "S3"], "R1 is not a loop: from the next stop to the end");
  eq(rows.map((r) => [r.kind, r.t]), [["live", NOW + 300], ["live", NOW + 600]], "v1's own trip update times");
  const v2 = busByKey(s, "v2"), loop = busTimes(s, v2, NOW);
  eq(loop.map((r) => r.stopId), ["S2", "S4", "S3"], "R2 is a loop: wraps once, its repeated last stop dropped");
  eq(loop.slice(0, 2).map((r) => r.t), [NOW + 240, NOW + 900], "times from v2's own trip");
  // another bus's time is never this bus's (trip t3 of v3 predicts S1 on R1)
  const s3 = state();
  s3.buses = [...s3.buses, { vehicle: { id: "v3", label: "103" }, position: { latitude: 41.79, longitude: -87.6 }, trip: { trip_id: "t3", route_id: "R1" }, timestamp: NOW - 5, stop_id: "S1" }];
  const r3 = busTimes(s3, busByKey(s3, "v3"), NOW);
  eq(r3.map((r) => [r.stopId, r.t]), [["S1", NOW + 1500], ["S2", null], ["S3", null]], "v3: only its own S1 time; no time where it has none");
  eq(busTimes(s, { ...v1, stop_id: "nowhere" }, NOW), [], "next stop not on the line: nothing");
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

test("busmenu: timeText: live '3 min' / 'Now', '~' while the feed is stale; est '~5 min' with est., never 'Now'", () => {
  eq(timeText({ t: NOW + 200, kind: "live" }, NOW), { text: "3 min", tag: "", say: "in 3 minutes", now: false });
  eq(timeText({ t: NOW + 30, kind: "live" }, NOW), { text: "Now", tag: "", say: "now", now: true });
  eq(timeText({ t: NOW + 200, kind: "live" }, NOW, true).text, "~3 min", "stale feed");
  eq(timeText({ t: NOW + 300, kind: "est" }, NOW), { text: "~5 min", tag: "est.", say: "in about 5 minutes, estimated", now: false });
  eq(timeText({ t: NOW + 10, kind: "est" }, NOW).text, "~1 min", "an estimate is never 'Now'");
  eq(timeText({ t: null, kind: "live" }, NOW).text, "", "no time");
  eq(ETA_WORDS, { est: "est.", sched: "Scheduled", estSay: "estimated", schedSay: "scheduled, not live" }, "the contract's words");
});

test("busmenu: the model of a live bus: its line, Bus name, next stop with its time, one lap of rows", () => {
  const s = state(), h = heldBus(null, s, "v1", NOW);
  const m = busMenuModel(s, h, NOW);
  eq([m.status, m.rid, m.line, m.name], ["ok", "R1", "Red Line", "Bus 101"], "one bus on R1: its fleet label");
  eq(m.next, { stopId: "S2", name: "Library", t: NOW + 300, kind: "live" });
  eq(m.rows.map((r) => r.name), ["Library", "Hospital"]);
  eq([m.anyEst, m.loopTo, m.stale], [false, "", false]);
  eq(statusSay(m, NOW, { liveSay: "live" }), "Bus 101, heading to Library, in 5 minutes, live");
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

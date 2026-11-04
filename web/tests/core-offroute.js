// Tests for core/offroute.js (buses not following their route for a long time are hidden) and its use in data/live.js.
// Synthetic lines plus real bus reports from the archived raw polls (fixtures/offroute_golden.json, made by
// experiments/routeknower/E27-scripts/make_golden.py; the iOS Kit OffRouteTests replays the same file).
import { test, eq, ok } from "./lib.js";
import { OFF_M, HIDE_IN_S, HIDE_OUT_S, HOURS_PAD_S, FOLLOW_M, RETURN_M, GAP_S, closestOnLine, inListedHours, detourAlert,
  offRouteStep, dropHidden } from "../js/core/offroute.js";
import { startLive } from "../js/data/live.js";
import { createStore } from "../js/core/store.js";

const NOON = 1791997200;              // Wed 2026-10-14 12:00 Chicago (CDT)
const NIGHT = 1792033200;             // Wed 22:00: route A ended at 21:00, past the 30 min pad
const day = (first, last) => ({ first, last, trips: 10, buses: Array(24).fill(1) });
const week = (d) => ({ mon: d, tue: d, wed: d, thu: d, fri: d, sat: d, sun: d });
// A runs east-west along 41.79, B along 41.80 (about 1.1 km north); both 07:00 to 21:00
const shapes = {
  A: [[[41.79, -87.62], [41.79, -87.60], [41.79, -87.58]]],
  B: [[[41.80, -87.62], [41.80, -87.58]]],
};
const service = { routes: { A: { days: week(day("07:00", "21:00")), exceptions: [] }, B: { days: week(day("07:00", "21:00")), exceptions: [] } } };
const routes = { A: { short: "A", alias_ids: ["38734"] }, B: { short: "B" } };
const GARAGE = [41.82, -87.64];      // about 3.6 km from A, 2.8 km from B
const bus = (id, rid, [lat, lon], ts) => ({ vehicle: { id }, trip: { trip_id: "t-" + id, route_id: rid }, position: { latitude: lat, longitude: lon }, timestamp: ts });
const ctx = (now, over = {}) => ({ shapes, service, routes, alerts: [], nowS: now, feedTs: now, ...over });

/** Feed the same bus every `every` s from t0 to t1 (positions from pos(t)); returns [t, hidden] per poll. */
function drive(id, rid, pos, t0, t1, every = 30, c = {}) {
  let tracks = {};
  const out = [];
  for (let t = t0; t <= t1; t += every) {
    const r = offRouteStep(tracks, [bus(id, rid, pos(t), t)], ctx(t, c));
    tracks = r.tracks;
    out.push([t, r.hidden.includes(id)]);
  }
  return out;
}
const firstHidden = (rows) => { const r = rows.find((x) => x[1]); return r ? r[0] : null; };

test("offroute: constants are the measured rule (RouteKnower E27)", () => {
  eq([OFF_M, HIDE_IN_S, HIDE_OUT_S, HOURS_PAD_S, FOLLOW_M, RETURN_M, GAP_S], [300, 900, 300, 1800, 1500, 1000, 600]);
});

test("offroute: closest point on a route's lines", () => {
  const on = closestOnLine(shapes.A, 41.79, -87.61);
  ok(on.d < 0.5, "on the line");
  const n = closestOnLine(shapes.A, 41.7945, -87.61);   // 0.0045 deg north = about 500 m
  ok(Math.abs(n.d - 500) < 5, "about 500 m north: " + n.d);
  ok(Math.abs(n.lat - 41.79) < 1e-6 && Math.abs(n.lon + 87.61) < 1e-6, "the closest point is straight south");
  const end = closestOnLine(shapes.A, 41.79, -87.57);
  ok(Math.abs(end.lon + 87.58) < 1e-9, "past the end: the end point");
  eq(closestOnLine(undefined, 41.79, -87.6), null, "no line");
  eq(closestOnLine([[[41.79, -87.6]]], 41.79, -87.6), null, "a one-point line is no line");
  ok(closestOnLine([[{ lat: 41.79, lon: -87.62 }, { lat: 41.79, lng: -87.58 }]], 41.79, -87.6).d < 0.5, "object points");
});

test("offroute: listed hours with the 30 min pad", () => {
  eq(inListedHours(service, "A", NOON), true);
  eq(inListedHours(service, "A", NOON + 9 * 3600 + 20 * 60), true, "21:20: within 30 min of the end");
  eq(inListedHours(service, "A", NOON + 9 * 3600 + 40 * 60), false, "21:40");
  eq(inListedHours(service, "A", NOON - 5 * 3600 - 20 * 60), true, "06:40: 20 min before the start");
  eq(inListedHours(service, "A", NIGHT), false);
  eq(inListedHours(service, "X", NOON), null, "no schedule data");
});

test("offroute: detour alerts (named route, or no route and detour words)", () => {
  const al = (text, ids = [], period) => ({ header_text: text, description_text: "", informed_entity: ids.length ? ids.map((r) => ({ route_id: r })) : [{ agency_id: "1068" }], active_period: period || [] });
  ok(detourAlert([al("North Route", ["38734"])], routes, "A", NOON), "Passio's own id names A (any text)");
  ok(!detourAlert([al("North Route", ["38734"])], routes, "B", NOON), "names another route");
  ok(!detourAlert([al("UGo Bus Route Assistance")], routes, "A", NOON), "the standing assistance alert is no detour");
  ok(detourAlert([al("Goldblatt Pavilion boarding: the shuttles will be rerouted as follows")], routes, "A", NOON), "no route, reads like a detour");
  ok(!detourAlert([al("Shuttles rerouted", [], [{ start: NOON + 3600, end: NOON + 7200 }])], routes, "A", NOON), "not active yet");
  ok(!detourAlert([], routes, "A", NOON) && !detourAlert(undefined, routes, "A", NOON));
});

test("offroute: a bus parked 3 km from every line inside the hours is hidden after 15 min, shown when back", () => {
  const rows = drive("g", "A", () => GARAGE, NOON, NOON + 1800);
  eq(firstHidden(rows), NOON + HIDE_IN_S, "hidden at exactly 15 min");
  ok(rows.filter((r) => r[0] < NOON + HIDE_IN_S).every((r) => !r[1]), "shown before");
  let tracks = {};
  for (let t = NOON; t <= NOON + 1200; t += 30) tracks = offRouteStep(tracks, [bus("g", "A", GARAGE, t)], ctx(t)).tracks;
  const back = offRouteStep(tracks, [bus("g", "A", [41.7905, -87.61], NOON + 1230)], ctx(NOON + 1230));
  eq(back.hidden, [], "back on its line: shown at once");
  eq(Object.keys(back.tracks), [], "its clock is gone");
  const again = offRouteStep(back.tracks, [bus("g", "A", GARAGE, NOON + 1260)], ctx(NOON + 1260));
  eq(again.hidden, [], "off again: a new clock");
});

test("offroute: outside the listed hours 5 min is enough", () => {
  eq(firstHidden(drive("g", "A", () => GARAGE, NIGHT, NIGHT + 900)), NIGHT + HIDE_OUT_S);
});

test("offroute: never hidden near another route's line, or within 300 m of its own", () => {
  eq(firstHidden(drive("x", "A", () => [41.8005, -87.60], NOON, NOON + 3600)), null, "on B's line, filed under A");
  eq(firstHidden(drive("y", "A", () => [41.7925, -87.60], NOON, NOON + 3600)), null, "280 m from its line");
  eq(firstHidden(drive("z", "A", () => [41.7935, -87.61], NOON, NOON + 3600)), NOON + HIDE_IN_S, "390 m from A, 720 m from B");
});

test("offroute: a bus driving along its route on another street is never hidden (Lake Shore Drive detour)", () => {
  // 1.7 km south of A, moving east 4 km in 25 min: the closest points of A spread past FOLLOW_M
  const pos = (t) => [41.775, -87.62 + 0.04 * Math.min(1, (t - NOON) / 1500)];
  eq(firstHidden(drive("d", "A", pos, NOON, NOON + 2400)), null);
  // the same distance, parked: hidden
  eq(firstHidden(drive("p", "A", () => [41.775, -87.60], NOON, NOON + 2400)), NOON + HIDE_IN_S);
});

test("offroute: a bus heading back to its line is shown (pull-out from the garage)", () => {
  // parked 3.6 km away for 20 min, then drives toward A: shown once 1 km closer than its farthest point
  const pos = (t) => (t < NOON + 1200 ? GARAGE : [GARAGE[0] - 0.001 * ((t - NOON - 1200) / 30), GARAGE[1] + 0.001 * ((t - NOON - 1200) / 30)]);
  const rows = drive("o", "A", pos, NOON, NOON + 1800);
  ok(rows.some((r) => r[1]), "hidden while parked");
  const last = rows.filter((r) => r[1]).pop()[0];
  const d0 = closestOnLine(shapes.A, ...GARAGE).d, dAt = closestOnLine(shapes.A, ...pos(last + 30)).d;
  ok(d0 - dAt >= RETURN_M - 10 && d0 - dAt < RETURN_M + 300, "shown again about 1 km closer: " + Math.round(d0 - dAt));
  ok(rows.filter((r) => r[0] > last).every((r) => !r[1]), "stays shown while it heads back");
});

test("offroute: an operator detour alert keeps it shown inside the hours only", () => {
  const alerts = [{ header_text: "Detour", description_text: "Shuttles are on a detour around 59th St", informed_entity: [{ agency_id: "1068" }], active_period: [] }];
  eq(firstHidden(drive("a", "A", () => GARAGE, NOON, NOON + 1800, 30, { alerts })), null, "inside the hours: shown");
  eq(firstHidden(drive("a", "A", () => GARAGE, NIGHT, NIGHT + 900, 30, { alerts })), NIGHT + HIDE_OUT_S, "outside: hidden");
});

test("offroute: report gaps, route changes, missing polls and the phone clock", () => {
  let tr = offRouteStep({}, [bus("g", "A", GARAGE, NOON)], ctx(NOON)).tracks;
  tr = offRouteStep(tr, [bus("g", "A", GARAGE, NOON + 600)], ctx(NOON + 600)).tracks;
  eq(tr.g.since, NOON, "a 10 min gap continues");
  tr = offRouteStep(tr, [bus("g", "A", GARAGE, NOON + 1201)], ctx(NOON + 1201)).tracks;
  eq(tr.g.since, NOON + 1201, "more than 10 min without a report: a new clock");
  tr = offRouteStep(tr, [bus("g", "B", GARAGE, NOON + 1231)], ctx(NOON + 1231)).tracks;
  eq(tr.g.since, NOON + 1231, "a route change: a new clock");
  const missing = offRouteStep(tr, [], ctx(NOON + 1500));
  eq(missing.tracks.g.since, NOON + 1231, "missing from one poll: the clock is kept");
  eq(offRouteStep(tr, [], ctx(NOON + 1231 + GAP_S + 1)).tracks, {}, "dropped after GAP_S");
  // the clock runs on report times: a phone clock 3 h ahead changes nothing
  let t2 = {};
  for (let t = NOON; t <= NOON + 840; t += 60) t2 = offRouteStep(t2, [bus("g", "A", GARAGE, t)], ctx(t, { nowS: t + 3 * 3600 })).tracks;
  eq(offRouteStep(t2, [bus("g", "A", GARAGE, NOON + 870)], ctx(NOON + 870, { nowS: NOON + 870 + 3 * 3600 })).hidden, [], "14.5 min of reports: still shown");
  const before = JSON.stringify(t2);
  offRouteStep(t2, [bus("g", "A", GARAGE, NOON + 999)], ctx(NOON + 999));
  eq(JSON.stringify(t2), before, "the tracks passed in are not modified");
});

test("offroute: nothing hidden before static data, without a line or a vehicle id", () => {
  let tr = {};
  for (let t = NOON; t <= NOON + 1800; t += 60) {
    const r = offRouteStep(tr, [bus("g", "A", GARAGE, t), bus("q", "Q", GARAGE, t), { ...bus(null, "A", GARAGE, t), vehicle: {} }], ctx(t, { shapes: t < NOON + 1700 ? {} : { Q: [] } }));
    tr = r.tracks;
    eq(r.hidden, []);
  }
});

test("offroute: dropHidden removes the bus and its own trip updates only", () => {
  const buses = [bus("1", "A", GARAGE, NOON), bus("2", "A", [41.79, -87.6], NOON)];
  const trips = [{ trip: { trip_id: "shared" }, vehicle: { id: "1" } }, { trip: { trip_id: "shared" }, vehicle: { id: "2" } }, { trip: { trip_id: "x" } }];
  const d = dropHidden(buses, trips, ["1"]);
  eq(d.buses.map((b) => b.vehicle.id), ["2"]);
  eq(d.trips.map((t) => t.vehicle && t.vehicle.id), ["2", undefined], "shared trip id kept for the other bus; no vehicle id kept");
  ok(dropHidden(buses, trips, []).buses === buses, "nothing hidden: the same arrays");
});

test("offroute real: DC-022 garage runs hidden, the Downtown Campus Connector detour and the Metra run never", async () => {
  const fx = await (await fetch("fixtures/offroute_golden.json", { cache: "no-store" })).json();
  const bad = [];
  const hiddenFrom = {};
  for (const c of fx.cases) {
    let tracks = {};
    c.polls.forEach((p, i) => {
      const buses = p.v.map(([veh, rid, lat, lon, vt]) => ({ vehicle: { id: veh }, trip: { route_id: rid }, position: { latitude: lat, longitude: lon }, timestamp: vt }));
      const r = offRouteStep(tracks, buses, { shapes: fx.shapes, service: fx.service, routes: fx.routes, alerts: [], nowS: p.h, feedTs: p.h });
      tracks = r.tracks;
      if (JSON.stringify(r.hidden) !== JSON.stringify(c.expect[i])) bad.push(`${c.name} poll ${i}: ${r.hidden} vs ${c.expect[i]}`);
      for (const v of r.hidden) hiddenFrom[c.name + ":" + v] = hiddenFrom[c.name + ":" + v] || p.h;
    });
  }
  eq(bad.slice(0, 5), [], bad.length + " polls differ from the stored answers");
  const at = (k) => hiddenFrom[k] && new Date(hiddenFrom[k] * 1000).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hourCycle: "h23" });
  ok(/^00:1[12]/.test(at("dc022:4325")), "Central (its hours ended 23:14) hidden 5 min after it left every line: " + at("dc022:4325"));
  ok(/^00:2[34]/.test(at("dc022:4313")), "North hidden 15 min after it left every line: " + at("dc022:4313"));
  ok(/^00:2[78]/.test(at("dc022:4327")), "East: " + at("dc022:4327"));
  ok(!Object.keys(hiddenFrom).some((k) => k.startsWith("dcc:") || k.startsWith("apostolic:")), "riders on board: never hidden");
  ok(/^13:2[23]/.test(at("garage:4324")), "parked at the garage inside its hours: " + at("garage:4324"));
});

test("live: an off-route bus leaves store.buses and its trip updates leave store.trips", async () => {
  let now = NOON, pos = GARAGE;
  const feeds = () => ({
    vehiclePositions: { header: { timestamp: now }, entity: [{ vehicle: bus("g", "A", pos, now) }, { vehicle: bus("ok", "A", [41.79, -87.61], now) }] },
    tripUpdates: { header: { timestamp: now }, entity: [
      { trip_update: { trip: { trip_id: "t", route_id: "A" }, vehicle: { id: "g" }, stop_time_update: [{ stop_id: "S", arrival: { time: now + 300 } }] } },
      { trip_update: { trip: { trip_id: "t", route_id: "A" }, vehicle: { id: "ok" }, stop_time_update: [{ stop_id: "S", arrival: { time: now + 600 } }] } }] },
    serviceAlerts: { header: { timestamp: now }, entity: [] },
  });
  const fetch = async (url) => {
    const f = feeds(), name = Object.keys(f).find((k) => url.includes(k));
    return { ok: true, status: 200, json: async () => f[name] };
  };
  const store = createStore({ routes, service, shapes, staticLoaded: true, buses: [], trips: [], alerts: [], feedTs: 0 });
  const live = startLive(store, { fetch, intervalMs: 600000, now: () => now });
  const ids = () => store.get().buses.map((b) => b.vehicle.id);
  const tripVehs = () => store.get().trips.map((t) => t.vehicle.id);
  for (; now < NOON + HIDE_IN_S; now += 60) await live.pollNow();
  eq(ids(), ["g", "ok"], "14 min off its route: still shown");
  await live.pollNow();
  eq(ids(), ["ok"], "15 min: hidden");
  eq(tripVehs(), ["ok"], "its arrival times go with it");
  pos = [41.7902, -87.605];
  now += 10;
  await live.pollNow();
  live.stop();
  eq(ids(), ["g", "ok"], "back on its line: shown at once");
  eq(tripVehs(), ["g", "ok"]);
});

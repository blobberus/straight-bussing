// Tests for core/offroute.js (buses more than a block off their route are hidden, still tracked) and its use in
// data/live.js. Synthetic lines plus real bus reports from the archived raw polls (fixtures/offroute_golden.json, made by
// experiments/routeknower/E27-scripts/make_golden.py; the iOS Kit OffRouteTests replays the same file).
import { test, eq, ok } from "./lib.js";
import { BLOCK_M, CONFIRM_S, HOURS_PAD_S, GAP_S, closestOnLine, inListedHours, detourAlert, offRouteStep, dropHidden,
  awayBuses, awayCount, awayText } from "../js/core/offroute.js";
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
const ON_A = [41.7902, -87.61];       // 22 m north of A
const bus = (id, rid, [lat, lon], ts) => ({ vehicle: { id }, trip: { trip_id: "t-" + id, route_id: rid }, position: { latitude: lat, longitude: lon }, timestamp: ts });
const ctx = (now, over = {}) => ({ shapes, service, routes, alerts: [], nowS: now, feedTs: now, ...over });

/** Feed the same bus a new report every `every` s from t0 to t1 (positions from pos(t)); returns [t, hidden] per poll. */
function drive(id, rid, pos, t0, t1, every = 15, c = {}) {
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
/** A real case's operator alerts as feed alerts (offroute-golden.html builds them the same way). */
const feedAlerts = (c) => (c.alerts || []).map((a) => ({ header_text: a.header, description_text: a.description,
  informed_entity: a.routes.length ? a.routes.map((r) => ({ route_id: r })) : [{ agency_id: "1068" }], active_period: [{ start: a.start, end: a.end }] }));

test("offroute: constants are the measured rule (RouteKnower E27b: more than a block = 250 m for 45 s)", () => {
  eq([BLOCK_M, CONFIRM_S, HOURS_PAD_S, GAP_S], [250, 45, 1800, 600]);
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

test("offroute: a garage-bound bus is hidden 45 s after it is more than a block off, shown at once when back", () => {
  const rows = drive("g", "A", () => GARAGE, NOON, NOON + 600);
  eq(firstHidden(rows), NOON + CONFIRM_S, "hidden at 45 s (reports every 15 s: the fourth report)");
  ok(rows.filter((r) => r[0] >= NOON + CONFIRM_S).every((r) => r[1]), "and stays hidden");
  eq(firstHidden(drive("g", "A", () => GARAGE, NIGHT, NIGHT + 600)), NIGHT + CONFIRM_S, "outside the listed hours: the same 45 s");
  let tracks = {};
  for (let t = NOON; t <= NOON + 300; t += 15) tracks = offRouteStep(tracks, [bus("g", "A", GARAGE, t)], ctx(t)).tracks;
  ok(tracks.g && tracks.g.since === NOON && tracks.g.n === 21, "still tracked while hidden: " + JSON.stringify(tracks.g));
  const back = offRouteStep(tracks, [bus("g", "A", ON_A, NOON + 310)], ctx(NOON + 310));
  eq(back.hidden, [], "back within a block: shown on that report");
  eq(Object.keys(back.tracks), [], "its clock is gone");
  const again = offRouteStep(back.tracks, [bus("g", "A", GARAGE, NOON + 320)], ctx(NOON + 320));
  eq(again.hidden, [], "off again: a new 45 s clock");
});

test("offroute: a block is measured from the bus's OWN line only", () => {
  eq(firstHidden(drive("y", "A", () => [41.7920, -87.60], NOON, NOON + 3600)), null, "222 m from its line (one street over): never hidden");
  eq(firstHidden(drive("z", "A", () => [41.7925, -87.61], NOON, NOON + 600)), NOON + CONFIRM_S, "278 m from its line: hidden");
  eq(firstHidden(drive("x", "A", () => [41.8005, -87.60], NOON, NOON + 600)), NOON + CONFIRM_S, "on B's line but filed under A: hidden (the old other-line exemption is gone)");
  eq(firstHidden(drive("b", "B", () => [41.8005, -87.60], NOON, NOON + 3600)), null, "the same spot on its own line B: never");
});

test("offroute: one bad GPS fix (or two within 45 s) never hides a bus", () => {
  // on the line, one fix 500 m off, back on the line: never hidden
  const one = (t) => (t === NOON + 100 ? [41.7945, -87.61] : ON_A);
  eq(firstHidden(drive("s", "A", one, NOON, NOON + 400, 10)), null, "a single spike");
  const four = (t) => (t >= NOON + 100 && t <= NOON + 130 ? [41.7945, -87.61] : ON_A);
  eq(firstHidden(drive("s", "A", four, NOON, NOON + 400, 10)), null, "four far fixes in a row over 30 s");
  // the same report repeated by later polls (no new report time) is one report: it never hides the bus
  let tr = {};
  for (let h = NOON; h <= NOON + 300; h += 10) {
    const r = offRouteStep(tr, [bus("r", "A", GARAGE, NOON)], ctx(h));
    tr = r.tracks;
    eq(r.hidden, [], "the same report at " + (h - NOON) + " s");
  }
  eq(tr.r.n, 1, "counted once");
});

test("offroute: a bus following its route on another street is hidden now; an operator detour alert keeps it shown inside the hours", () => {
  // 1.7 km south of A, moving east 4 km in 25 min (the Downtown Campus Connector off Lake Shore Drive): hidden at 45 s
  const pos = (t) => [41.775, -87.62 + 0.04 * Math.min(1, (t - NOON) / 1500)];
  eq(firstHidden(drive("d", "A", pos, NOON, NOON + 2400)), NOON + CONFIRM_S, "no alert: hidden (the old following exemption is gone)");
  const detour = [{ header_text: "Detour", description_text: "Shuttles are on a detour around 59th St", informed_entity: [{ agency_id: "1068" }], active_period: [] }];
  eq(firstHidden(drive("d", "A", pos, NOON, NOON + 2400, 15, { alerts: detour })), null, "a detour alert (no route named): shown");
  const named = [{ header_text: "North Route", description_text: "", informed_entity: [{ route_id: "38734" }], active_period: [] }];
  eq(firstHidden(drive("d", "A", pos, NOON, NOON + 2400, 15, { alerts: named })), null, "an alert naming A by Passio's id: shown");
  eq(firstHidden(drive("d", "B", pos, NOON, NOON + 2400, 15, { alerts: named })), NOON + CONFIRM_S, "an alert naming another route: hidden");
  eq(firstHidden(drive("a", "A", () => GARAGE, NIGHT, NIGHT + 600, 15, { alerts: detour })), NIGHT + CONFIRM_S, "outside the listed hours the alert does not count");
});

test("offroute: report gaps, route changes, missing polls and the phone clock", () => {
  let tr = offRouteStep({}, [bus("g", "A", GARAGE, NOON)], ctx(NOON)).tracks;
  tr = offRouteStep(tr, [bus("g", "A", GARAGE, NOON + 600)], ctx(NOON + 600)).tracks;
  eq([tr.g.since, tr.g.n], [NOON, 2], "a 10 min gap continues");
  tr = offRouteStep(tr, [bus("g", "A", GARAGE, NOON + 1201)], ctx(NOON + 1201)).tracks;
  eq([tr.g.since, tr.g.n], [NOON + 1201, 1], "more than 10 min without a report: a new clock");
  tr = offRouteStep(tr, [bus("g", "B", GARAGE, NOON + 1231)], ctx(NOON + 1231)).tracks;
  eq(tr.g.since, NOON + 1231, "a route change: a new clock");
  const missing = offRouteStep(tr, [], ctx(NOON + 1500));
  eq(missing.tracks.g.since, NOON + 1231, "missing from one poll: the clock is kept");
  eq(missing.hidden, [], "a bus missing from the poll is not listed");
  eq(offRouteStep(tr, [], ctx(NOON + 1231 + GAP_S + 1)).tracks, {}, "dropped after GAP_S");
  // the clock runs on report times: a phone clock 3 h ahead changes nothing
  let t2 = {};
  for (let t = NOON; t <= NOON + 30; t += 15) t2 = offRouteStep(t2, [bus("g", "A", GARAGE, t)], ctx(t, { nowS: t + 3 * 3600 })).tracks;
  eq(offRouteStep(t2, [bus("g", "A", GARAGE, NOON + 40)], ctx(NOON + 40, { nowS: NOON + 3 * 3600 + 900 })).hidden, [], "40 s of reports: still shown");
  const before = JSON.stringify(t2);
  offRouteStep(t2, [bus("g", "A", GARAGE, NOON + 99)], ctx(NOON + 99));
  eq(JSON.stringify(t2), before, "the tracks passed in are not modified");
});

test("offroute: nothing hidden before static data, without a line or a vehicle id", () => {
  let tr = {};
  for (let t = NOON; t <= NOON + 600; t += 15) {
    const r = offRouteStep(tr, [bus("g", "A", GARAGE, t), bus("q", "Q", GARAGE, t), { ...bus(null, "A", GARAGE, t), vehicle: {} }], ctx(t, { shapes: t < NOON + 500 ? {} : { Q: [] } }));
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

test("offroute: away buses, their count per route and the route page's words", () => {
  const buses = [bus("1", "A", GARAGE, NOON), bus("2", "A", ON_A, NOON), bus("3", "B", GARAGE, NOON), bus("4", "A", GARAGE, NOON)];
  eq(awayBuses(buses, ["4", "1"]).map((b) => b.vehicle.id), ["1", "4"], "input order");
  eq(awayBuses(buses, []), []);
  const away = awayBuses(buses, ["1", "3", "4"]);
  eq([awayCount(away, "A"), awayCount(away, "B"), awayCount(away, "C"), awayCount(undefined, "A")], [2, 1, 0, 0]);
  eq(awayText(0), "");
  eq(awayText(1), "1 bus is away from the route and hidden from the map.");
  eq(awayText(2), "2 buses are away from the route and hidden from the map.");
});

test("offroute real: garage runs hidden within a minute, buses on their line and a GPS spike never, a named-route alert keeps one shown", async () => {
  const fx = await (await fetch("fixtures/offroute_golden.json", { cache: "no-store" })).json();
  const bad = [];
  const hiddenFrom = {};
  for (const c of fx.cases) {
    let tracks = {};
    const alerts = feedAlerts(c);
    c.polls.forEach((p, i) => {
      const buses = p.v.map(([veh, rid, lat, lon, vt]) => ({ vehicle: { id: veh }, trip: { route_id: rid }, position: { latitude: lat, longitude: lon }, timestamp: vt }));
      const r = offRouteStep(tracks, buses, { shapes: fx.shapes, service: fx.service, routes: fx.routes, alerts, nowS: p.h, feedTs: p.h });
      tracks = r.tracks;
      if (JSON.stringify(r.hidden) !== JSON.stringify(c.expect[i])) bad.push(`${c.name} poll ${i}: ${r.hidden} vs ${c.expect[i]}`);
      for (const v of r.hidden) hiddenFrom[c.name + ":" + v] = hiddenFrom[c.name + ":" + v] || p.h;
    });
  }
  eq(bad.slice(0, 5), [], bad.length + " polls differ from the stored answers");
  const at = (k) => hiddenFrom[k] && new Date(hiddenFrom[k] * 1000).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hourCycle: "h23" });
  ok(/^00:01/.test(at("dc022:4325")), "Central to the garage after service (DC-022; the old rule: 00:11): " + at("dc022:4325"));
  ok(/^00:02/.test(at("dc022:4313")), "North (old: 00:23): " + at("dc022:4313"));
  ok(/^00:09/.test(at("dc022:4327")), "East (old: 00:27): " + at("dc022:4327"));
  ok(/^13:08/.test(at("garage:4324")), "parked at the garage inside its hours, 54 s after its first report (old: 13:22): " + at("garage:4324"));
  ok(!Object.keys(hiddenFrom).some((k) => /^(online|spike|north_alert):/.test(k)), "never: buses on their line, the GPS spike, the alert");
  ok(hiddenFrom["apostolic:4328"] && Object.keys(hiddenFrom).filter((k) => k.startsWith("dcc:")).length === 5,
    "the trade-off the owner chose: the 8 AM Metra run and the Lake Shore Drive detour (no alert) are hidden now");
  // the same North bus without its route's alert: hidden
  const north = fx.cases.find((c) => c.name === "north_alert");
  let tr = {}, hid = false;
  for (const p of north.polls) {
    const buses = p.v.map(([veh, rid, lat, lon, vt]) => ({ vehicle: { id: veh }, trip: { route_id: rid }, position: { latitude: lat, longitude: lon }, timestamp: vt }));
    const r = offRouteStep(tr, buses, { shapes: fx.shapes, service: fx.service, routes: fx.routes, alerts: [], nowS: p.h, feedTs: p.h });
    tr = r.tracks;
    hid = hid || r.hidden.length > 0;
  }
  ok(hid, "north_alert without the alert: hidden");
});

test("live: a bus more than a block off leaves store.buses and its trip updates, stays in store.away, comes back at once", async () => {
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
  const store = createStore({ routes, service, shapes, staticLoaded: true, buses: [], trips: [], alerts: [], away: [], feedTs: 0 });
  const live = startLive(store, { fetch, intervalMs: 600000, now: () => now });
  const ids = () => store.get().buses.map((b) => b.vehicle.id);
  const tripVehs = () => store.get().trips.map((t) => t.vehicle.id);
  const awayIds = () => store.get().away.map((b) => b.vehicle.id);
  const emptyAway = store.get().away;
  for (; now < NOON + CONFIRM_S; now += 10) await live.pollNow();
  eq(ids(), ["g", "ok"], "40 s more than a block off: still shown");
  ok(store.get().away === emptyAway, "nothing away yet: store.away untouched (no change to report)");
  await live.pollNow();
  eq(ids(), ["ok"], "45 s: hidden");
  eq(tripVehs(), ["ok"], "its arrival times go with it");
  eq(awayIds(), ["g"], "still tracked in store.away");
  now += 10;
  await live.pollNow();
  eq([ids(), awayIds()], [["ok"], ["g"]], "next poll: still hidden");
  pos = [41.7902, -87.605];
  now += 10;
  await live.pollNow();
  live.stop();
  eq(ids(), ["g", "ok"], "back within a block: shown at once");
  eq(tripVehs(), ["g", "ok"]);
  eq(awayIds(), [], "no longer away");
});

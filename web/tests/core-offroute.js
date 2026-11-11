// Tests for core/offroute.js (buses off their route are hidden, still tracked: E27b, and E27c with the streets the buses
// really drive, web/data/corridors.json) and its use in data/live.js. Synthetic lines plus real bus reports from the
// archived raw polls (fixtures/offroute_golden.json, made by experiments/routeknower/E27-scripts/make_golden.py; the iOS
// Kit OffRouteTests replays the same file).
import { test, eq, ok } from "./lib.js";
import { BLOCK_M, CONFIRM_S, FAST_M, NEAR_M, NEAR_S, HOURS_PAD_S, GAP_S, DETOUR_MAX_M, SHAPE_TOL, closestOnLine, shapeSig,
  corridorFor, nearestPoint, offDistance, inListedHours, detourAlert, offRouteStep, dropHidden, awayBuses, awayCount,
  awayText } from "../js/core/offroute.js";
import { startLive } from "../js/data/live.js";
import { createStore } from "../js/core/store.js";
import { TRANSITION_PAD_S, START_MIN_DAYS, TRANSITION_TEXT, TOWARD_M, TRANSITION_TIMES, TRANSITION_MAX_M, seenEntry, transitionAt } from "../js/core/seen.js";
import { cleanSeen } from "../js/data/static.js";

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
const OFF300 = [41.7927, -87.61];     // 300 m north of A (FAR, not FAST)
// corridors.json for A: learned against A's line as drawn above; points 300 m north of A at -87.61 (the Union Station
// case: buses drive there every lap, the drawn line is off)
const corridorsA = { valid_until: "2026-12-21", routes: { A: { shape: shapeSig(shapes.A), pts: [[41.7927, -87.61], [41.7927, -87.6097]] } } };
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

test("offroute: constants are the measured rule (E27b: 250 m for 45 s; E27c: 500 m twice, 120 m for 2 min, detours within 3 km)", () => {
  eq([BLOCK_M, CONFIRM_S, FAST_M, NEAR_M, NEAR_S, HOURS_PAD_S, GAP_S, DETOUR_MAX_M, SHAPE_TOL], [250, 45, 500, 120, 120, 1800, 600, 3000, 0.01]);
});

// service_seen.json (tools/build_service_seen.py) as the app cleans it: A's weekday buses start 07:05 and 16:00, a bus
// usually leaves A for B at 17:57 and starts B at 18:03 (owner 2026-11-11: show such buses, marked)
const SEEN = cleanSeen({ valid_until: "2026-12-25", lines: {
  A: { days: [{ type: "weekday", dows: ["mon", "tue", "wed", "thu", "fri"], listed: { spans: [["07:00", "21:00"]] },
    buses: [{ bus: 1, days: 22, first_stop: { p50: "07:05" } }, { bus: 2, days: 9, first_stop: { p50: "16:00" } }, { bus: 3, days: 2, first_stop: { p50: "12:00" } }] },
  { type: "sat", dows: ["sat"], listed: { spans: [["09:00", "17:00"]] }, buses: [] }] },
  B: { days: [{ type: "weekday", dows: ["mon", "tue", "wed", "thu", "fri"], listed: { spans: [["07:00", "21:00"]] }, buses: [] }] } },
  transitions: [{ from: "A", to: "B", day_type: "weekday", kind: "direct", leave: { p50: "17:57" }, join: { p50: "18:03" } },
    { from: "B", to: "A", day_type: "weekday", kind: "after_break", leave: { p50: "08:30" }, join: { p50: "10:00" } }] });
const AT = (h, m = 0) => NOON + (h - 12) * 3600 + m * 60;

test("seen: transition windows of a line (owner 2026-11-11), only on the learned timetable and before valid_until", () => {
  eq([TRANSITION_PAD_S, START_MIN_DAYS, TRANSITION_TEXT, TOWARD_M, TRANSITION_TIMES, TRANSITION_MAX_M], [1800, 3, "Transitioning to new line", 100, false, 1000],
    "RouteKnower E32c: windows of 30 min, heading back 100 m, within 1 km, its badge without its times");
  eq(transitionAt(SEEN, service, "A", AT(17, 30)), { kind: "transition", from: "A", to: "B", a: 1047, b: 1113 }, "30 min before the leave");
  eq(transitionAt(SEEN, service, "B", AT(18, 33))?.kind, "transition", "the new line too, to 30 min after the join");
  eq(transitionAt(SEEN, service, "A", AT(18, 34)), null, "past it");
  eq(transitionAt(SEEN, service, "A", AT(16, 20)), { kind: "start", a: 930, b: 990 }, "a usual shift start (seen 9 days)");
  eq(transitionAt(SEEN, service, "A", AT(12, 10)), null, "a bus slot seen on 2 days only: no window");
  eq(transitionAt(SEEN, service, "A", AT(12)), null, "midday: none (a garage run then is hidden as before)");
  const changed = { routes: { ...service.routes, A: { days: week(day("08:00", "21:00")), exceptions: [] } } };
  eq(transitionAt(SEEN, changed, "A", AT(17, 30)), null, "today's listed hours differ from the learned ones: off");
  eq(transitionAt({ ...SEEN, valid_until: "2026-10-13" }, service, "A", AT(17, 30)), null, "past valid_until: off");
  eq(transitionAt(SEEN, service, "A", AT(17, 30) + 3 * 86400), null, "Saturday: its own entry, no windows");
  eq(seenEntry(null, service, "A", NOON), null, "no file: off");
  eq(transitionAt(SEEN, service, "B", AT(9)), null, "after a break: not while the bus goes on its break");
  eq(transitionAt(SEEN, service, "A", AT(9, 45)), { kind: "transition", from: "B", to: "A", a: 570, b: 630 }, "only around the join");
});

test("offroute: a bus off its route heading back to it inside a transition window stays shown, marked; else hidden as before", () => {
  // 1.2 km north of A heading back to it (about 280 m nearer every 15 s, then 390 m off), or parked there
  const OUT = [41.801, -87.61];
  const toward = (t0) => (t) => [OUT[0] - 0.0025 * Math.min(3, (t - t0) / 15), OUT[1]];
  const run = (t0, c, pos = () => OUT) => { let tr = {}, r; for (let t = t0; t <= t0 + 90; t += 15) { r = offRouteStep(tr, [bus("x", "A", pos(t), t)], ctx(t, c)); tr = r.tracks; } return r; };
  const at = run(AT(17, 40), { seen: SEEN }, toward(AT(17, 40)));
  eq([at.hidden, at.transitioning], [[], ["x"]], "17:40, on its way back toward its line in its usual transition window: shown, marked");
  const parked = run(AT(17, 40), { seen: SEEN });
  eq([parked.hidden, parked.transitioning], [["x"], []], "parked off its line in the window: not on its way (TOWARD_M), hidden");
  const far = run(AT(17, 40), { seen: SEEN }, (t) => [GARAGE[0] - 0.0025 * Math.min(3, (t - AT(17, 40)) / 15), GARAGE[1]]);
  eq([far.hidden, far.transitioning], [["x"], []], "heading back but over 1 km off (TRANSITION_MAX_M): hidden");
  const noon = run(AT(12), { seen: SEEN }, toward(AT(12)));
  eq([noon.hidden, noon.transitioning], [["x"], []], "noon: hidden");
  eq(run(AT(17, 40), {}, toward(AT(17, 40))).hidden, ["x"], "without the file: hidden (the E27b rule)");
});

test("offroute: a route's corridor is used only while its line is the learned one and before valid_until", () => {
  const sig = shapeSig(shapes.A);
  eq(sig.n, 3, "every point of every line");
  ok(Math.abs(sig.m - 3313) < 5, "length in meters (haversine): " + sig.m);
  eq(shapeSig(undefined), { n: 0, m: 0 });
  eq(corridorFor(corridorsA, shapes, "A", NOON), corridorsA.routes.A.pts, "valid");
  eq(corridorFor(corridorsA, shapes, "B", NOON), null, "a route not in the file: no corridor (E27b rule)");
  eq(corridorFor(null, shapes, "A", NOON), null, "no file");
  eq(corridorFor({ ...corridorsA, valid_until: "2026-10-13" }, shapes, "A", NOON), null, "past valid_until (the Chicago date)");
  eq(corridorFor({ ...corridorsA, valid_until: "2026-10-14" }, shapes, "A", NOON), corridorsA.routes.A.pts, "on its last day: still valid");
  const moved = { A: [[[41.79, -87.62], [41.79, -87.60], [41.80, -87.58]]] };
  eq(corridorFor(corridorsA, moved, "A", NOON), null, "the line changed (longer): no corridor");
  const more = { A: [[[41.79, -87.62], [41.79, -87.61], [41.79, -87.60], [41.79, -87.58]]] };
  eq(corridorFor(corridorsA, more, "A", NOON), null, "the line was redrawn (other point count): no corridor");
  const empty = { routes: { A: { shape: sig, pts: [] } } };
  eq(corridorFor(empty, shapes, "A", NOON), [], "learned, nothing off the line: the NEAR tier applies");
});

test("offroute: distance to the route = to its line or a corridor point, whichever is nearer", () => {
  const pts = corridorsA.routes.A.pts;
  ok(nearestPoint(pts, 41.7927, -87.61) < 0.5, "on a corridor point");
  eq(nearestPoint([], 41.79, -87.6), Infinity);
  eq(nearestPoint(null, 41.79, -87.6), Infinity);
  ok(Math.abs(offDistance(shapes.A, null, ...OFF300) - 300) < 3, "no corridor: the line, 300 m");
  ok(offDistance(shapes.A, pts, ...OFF300) < 1, "with the corridor: 0 m");
  ok(offDistance(shapes.A, pts, ...ON_A) < 25, "on the line");
  eq(offDistance(undefined, pts, ...ON_A), null, "no line: nothing to measure");
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

test("offroute: a bus more than a block off is hidden after 45 s, shown at once when back", () => {
  const rows = drive("g", "A", () => OFF300, NOON, NOON + 600);
  eq(firstHidden(rows), NOON + CONFIRM_S, "300 m off: hidden at 45 s (reports every 15 s: the fourth report)");
  ok(rows.filter((r) => r[0] >= NOON + CONFIRM_S).every((r) => r[1]), "and stays hidden");
  eq(firstHidden(drive("g", "A", () => OFF300, NIGHT, NIGHT + 600)), NIGHT + CONFIRM_S, "outside the listed hours: the same 45 s");
  let tracks = {};
  for (let t = NOON; t <= NOON + 300; t += 15) tracks = offRouteStep(tracks, [bus("g", "A", OFF300, t)], ctx(t)).tracks;
  ok(tracks.g && tracks.g.since === NOON && tracks.g.n === 21 && tracks.g.fs === NOON && tracks.g.fn === 21 && tracks.g.ff === 0,
    "still tracked while hidden: " + JSON.stringify(tracks.g));
  const back = offRouteStep(tracks, [bus("g", "A", ON_A, NOON + 310)], ctx(NOON + 310));
  eq(back.hidden, [], "back within a block: shown on that report");
  eq(Object.keys(back.tracks), [], "its clock is gone");
  const again = offRouteStep(back.tracks, [bus("g", "A", OFF300, NOON + 320)], ctx(NOON + 320));
  eq(again.hidden, [], "off again: a new 45 s clock");
});

test("offroute: FAST: two reports in a row more than 500 m off hide a bus at once (after a reload or an app start)", () => {
  const rows = drive("g", "A", () => GARAGE, NOON, NOON + 600);
  eq(firstHidden(rows), NOON + 15, "the garage: hidden at its second report, not after 45 s");
  ok(rows.slice(1).every((r) => r[1]), "and stays hidden");
  eq(firstHidden(drive("g", "A", () => GARAGE, NIGHT, NIGHT + 600)), NIGHT + 15, "outside the listed hours too");
  const r1 = offRouteStep({}, [bus("g", "A", GARAGE, NOON)], ctx(NOON));
  eq(r1.hidden, [], "one report is never enough (the first poll after a reload)");
  const same = offRouteStep(r1.tracks, [bus("g", "A", GARAGE, NOON)], ctx(NOON + 10));
  eq(same.hidden, [], "the same report repeated by the next poll counts once");
  // 600 m, 300 m, 600 m: the run of far reports restarts
  const zig = (t) => ((t - NOON) / 15 % 2 ? OFF300 : [41.7954, -87.61]);
  const z = drive("z", "A", zig, NOON, NOON + 30);
  eq(z.map((x) => x[1]), [false, false, false], "not two in a row beyond 500 m (and under 45 s more than a block off)");
});

test("offroute: distances are measured from the bus's OWN route only", () => {
  eq(firstHidden(drive("y", "A", () => [41.7920, -87.60], NOON, NOON + 3600)), null, "222 m from its line, no corridors.json: never hidden (E27b)");
  eq(firstHidden(drive("z", "A", () => [41.7925, -87.61], NOON, NOON + 600)), NOON + CONFIRM_S, "278 m from its line: hidden");
  eq(firstHidden(drive("x", "A", () => [41.8005, -87.60], NOON, NOON + 600)), NOON + 15, "on B's line but filed under A, 1.2 km off: hidden (FAST)");
  eq(firstHidden(drive("b", "B", () => [41.8005, -87.60], NOON, NOON + 3600)), null, "the same spot on its own line B: never");
});

test("offroute: NEAR (routes with a corridor): a street over for 2 minutes is hidden; the corridor keeps its own streets shown", () => {
  const c = { corridors: corridorsA };
  eq(firstHidden(drive("y", "A", () => [41.7920, -87.60], NOON, NOON + 600, 15, c)), NOON + NEAR_S, "222 m from its line: hidden at 2 min");
  eq(firstHidden(drive("y", "A", () => [41.7915, -87.60], NOON, NOON + 600, 15, c)), NOON + NEAR_S, "167 m: hidden at 2 min");
  eq(firstHidden(drive("y", "A", () => [41.7900, -87.60], NOON, NOON + 3600, 15, c)), null, "111 m: never (within NEAR_M)");
  const cut = (t) => (t >= NOON + 60 && t < NOON + 150 ? [41.7915, -87.60] : ON_A);
  eq(firstHidden(drive("y", "A", cut, NOON, NOON + 600, 15, c)), null, "a 90 s excursion one street over: never hidden");
  eq(firstHidden(drive("u", "A", () => OFF300, NOON, NOON + 3600, 15, c)), null, "300 m from the drawn line on a corridor point (Union Station): never");
  eq(firstHidden(drive("u", "A", () => [41.7930, -87.60], NOON, NOON + 600, 15, c)), NOON + CONFIRM_S, "333 m off and 840 m from the corridor points: FAR, 45 s");
  const old = { corridors: { ...corridorsA, valid_until: "2026-10-01" } };
  eq(firstHidden(drive("y", "A", () => [41.7920, -87.60], NOON, NOON + 3600, 15, old)), null, "an expired file: the E27b rule (222 m never)");
  eq(firstHidden(drive("u", "A", () => OFF300, NOON, NOON + 600, 15, old)), NOON + CONFIRM_S, "an expired file: the corridor is gone too");
  let tr = {};
  for (let t = NOON; t <= NOON + 60; t += 15) tr = offRouteStep(tr, [bus("y", "A", [41.7920, -87.60], t)], ctx(t, c)).tracks;
  eq([tr.y.since, tr.y.n, tr.y.fs, tr.y.fn], [NOON, 5, null, 0], "the NEAR clock runs, the FAR one does not");
});

test("offroute: one bad GPS fix never hides a bus; two in a row 500 m off do (28 days of real reports: one such jump)", () => {
  // on the line, one fix 2 km off, back on the line: never hidden (with a corridor too)
  const one = (t) => (t === NOON + 100 ? [41.808, -87.61] : ON_A);
  eq(firstHidden(drive("s", "A", one, NOON, NOON + 400, 10)), null, "a single spike");
  eq(firstHidden(drive("s", "A", one, NOON, NOON + 400, 10, { corridors: corridorsA })), null, "a single spike, corridor route");
  const four = (t) => (t >= NOON + 100 && t <= NOON + 130 ? OFF300 : ON_A);
  eq(firstHidden(drive("s", "A", four, NOON, NOON + 400, 10)), null, "four fixes 300 m off over 30 s: never");
  const two = (t) => (t >= NOON + 100 && t <= NOON + 110 ? [41.808, -87.61] : ON_A);
  const rows = drive("s", "A", two, NOON, NOON + 400, 10);
  eq(rows.filter((r) => r[1]).map((r) => r[0]), [NOON + 110], "two fixes 2 km off in a row: hidden for that poll only");
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
  eq(firstHidden(drive("d", "A", pos, NOON, NOON + 2400)), NOON + 15, "no alert: hidden (the old following exemption is gone; 1.7 km off: FAST)");
  const detour = [{ header_text: "Detour", description_text: "Shuttles are on a detour around 59th St", informed_entity: [{ agency_id: "1068" }], active_period: [] }];
  eq(firstHidden(drive("d", "A", pos, NOON, NOON + 2400, 15, { alerts: detour })), null, "a detour alert (no route named): shown");
  const named = [{ header_text: "North Route", description_text: "", informed_entity: [{ route_id: "38734" }], active_period: [] }];
  eq(firstHidden(drive("d", "A", pos, NOON, NOON + 2400, 15, { alerts: named })), null, "an alert naming A by Passio's id: shown");
  eq(firstHidden(drive("d", "B", pos, NOON, NOON + 2400, 15, { alerts: named })), NOON + 15, "an alert naming another route: hidden");
  eq(firstHidden(drive("a", "A", () => OFF300, NIGHT, NIGHT + 600, 15, { alerts: detour })), NIGHT + CONFIRM_S, "outside the listed hours the alert does not count");
  // the exemption holds only within DETOUR_MAX_M of the route (the Lake Shore Drive detours ran up to 2.5 km off); GARAGE is 3.6 km away
  eq(firstHidden(drive("a", "A", () => [41.8125, -87.61], NOON, NOON + 600, 15, { alerts: detour })), null, "2.5 km off during a detour alert: shown");
  eq(firstHidden(drive("a", "A", () => GARAGE, NOON, NOON + 600, 15, { alerts: detour })), NOON + 15, "the garage during a detour alert: hidden");
  eq(firstHidden(drive("a", "A", () => GARAGE, NOON, NOON + 600, 15, { alerts: named })), NOON + 15, "the garage during an alert naming its route: hidden");
});

test("offroute: report gaps, route changes, missing polls and the phone clock", () => {
  let tr = offRouteStep({}, [bus("g", "A", GARAGE, NOON)], ctx(NOON)).tracks;
  tr = offRouteStep(tr, [bus("g", "A", GARAGE, NOON + 600)], ctx(NOON + 600)).tracks;
  eq([tr.g.since, tr.g.n, tr.g.ff], [NOON, 2, 2], "a 10 min gap continues");
  tr = offRouteStep(tr, [bus("g", "A", GARAGE, NOON + 1201)], ctx(NOON + 1201)).tracks;
  eq([tr.g.since, tr.g.n, tr.g.ff], [NOON + 1201, 1, 1], "more than 10 min without a report: a new clock");
  tr = offRouteStep(tr, [bus("g", "B", GARAGE, NOON + 1231)], ctx(NOON + 1231)).tracks;
  eq([tr.g.since, tr.g.ff], [NOON + 1231, 1], "a route change: a new clock");
  const missing = offRouteStep(tr, [], ctx(NOON + 1500));
  eq(missing.tracks.g.since, NOON + 1231, "missing from one poll: the clock is kept");
  eq(missing.hidden, [], "a bus missing from the poll is not listed");
  eq(offRouteStep(tr, [], ctx(NOON + 1231 + GAP_S + 1)).tracks, {}, "dropped after GAP_S");
  // the clock runs on report times: a phone clock 3 h ahead changes nothing
  let t2 = {};
  for (let t = NOON; t <= NOON + 30; t += 15) t2 = offRouteStep(t2, [bus("g", "A", OFF300, t)], ctx(t, { nowS: t + 3 * 3600 })).tracks;
  eq(offRouteStep(t2, [bus("g", "A", OFF300, NOON + 40)], ctx(NOON + 40, { nowS: NOON + 3 * 3600 + 900 })).hidden, [], "40 s of reports: still shown");
  const before = JSON.stringify(t2);
  offRouteStep(t2, [bus("g", "A", OFF300, NOON + 99)], ctx(NOON + 99));
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

test("offroute real: garage runs hidden within a minute, buses on their routes and a GPS spike never, a named-route alert keeps one shown", async () => {
  const fx = await (await fetch("fixtures/offroute_golden.json", { cache: "no-store" })).json();
  const bad = [];
  const hiddenFrom = {};
  for (const c of fx.cases) {
    let tracks = {};
    const alerts = feedAlerts(c);
    c.polls.forEach((p, i) => {
      const buses = p.v.map(([veh, rid, lat, lon, vt]) => ({ vehicle: { id: veh }, trip: { route_id: rid }, position: { latitude: lat, longitude: lon }, timestamp: vt }));
      const r = offRouteStep(tracks, buses, { shapes: fx.shapes, corridors: fx.corridors, service: fx.service, routes: fx.routes, alerts, nowS: p.h, feedTs: p.h });
      tracks = r.tracks;
      if (JSON.stringify(r.hidden) !== JSON.stringify(c.expect[i])) bad.push(`${c.name} poll ${i}: ${r.hidden} vs ${c.expect[i]}`);
      for (const v of r.hidden) hiddenFrom[c.name + ":" + v] = hiddenFrom[c.name + ":" + v] || p.h;
    });
  }
  eq(bad.slice(0, 5), [], bad.length + " polls differ from the stored answers");
  const at = (k) => hiddenFrom[k] && new Date(hiddenFrom[k] * 1000).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hourCycle: "h23" });
  ok(/^00:01/.test(at("dc022:4325")), "Central to the garage after service (DC-022; the old rule: 00:11): " + at("dc022:4325"));
  ok(/^00:02/.test(at("dc022:4313")), "North (old: 00:23): " + at("dc022:4313"));
  ok(/^00:08/.test(at("dc022:4327")), "East (E27b: 00:09; the 2026-11-04 rule: 00:27): " + at("dc022:4327"));
  ok(/^13:07:4/.test(at("garage:4324")), "parked at the garage inside its hours, at its second report (E27b: 13:08; the 2026-11-04 rule: 13:22): " + at("garage:4324"));
  ok(!Object.keys(hiddenFrom).some((k) => /^(online|spike|north_alert|union):/.test(k)),
    "never: buses on their line, the GPS spike, the alert, the Downtown Campus Connector at Union Station (E27b hid it)");
  ok(hiddenFrom["apostolic:4328"] && Object.keys(hiddenFrom).filter((k) => k.startsWith("dcc:")).length === 6,
    "the trade-off the owner chose: the 8 AM Metra run and the Lake Shore Drive detour (no alert) are hidden");
  ok(/^12:13/.test(at("hp_stray:12642")), "the Downtown Campus Connector on a break at Cottage Grove and 60th (Nov 6): hidden 2 min after it stopped there (E27b: never): " + at("hp_stray:12642"));
  ok(/^20:10/.test(at("campus:4325")), "parked inside the campus, 200 m off (Nov 4): hidden (E27b: never): " + at("campus:4325"));
  ok(/^10:29/.test(at("alert_far:4315")), "11 km off during the Oct 28 reroute alert: hidden (E27b kept it shown): " + at("alert_far:4315"));
  // the same North bus without its route's alert: hidden
  const north = fx.cases.find((c) => c.name === "north_alert");
  let tr = {}, hid = false;
  for (const p of north.polls) {
    const buses = p.v.map(([veh, rid, lat, lon, vt]) => ({ vehicle: { id: veh }, trip: { route_id: rid }, position: { latitude: lat, longitude: lon }, timestamp: vt }));
    const r = offRouteStep(tr, buses, { shapes: fx.shapes, corridors: fx.corridors, service: fx.service, routes: fx.routes, alerts: [], nowS: p.h, feedTs: p.h });
    tr = r.tracks;
    hid = hid || r.hidden.length > 0;
  }
  ok(hid, "north_alert without the alert: hidden");
});

test("live: a bus more than a block off leaves store.buses and its trip updates, stays in store.away, comes back at once", async () => {
  let now = NOON, pos = OFF300;
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

test("live: store.corridors reaches the rule (a bus on its learned street stays shown, a street over goes after 2 min)", async () => {
  let now = NOON, pos = OFF300;
  const feeds = () => ({
    vehiclePositions: { header: { timestamp: now }, entity: [{ vehicle: bus("u", "A", pos, now) }] },
    tripUpdates: { header: { timestamp: now }, entity: [] },
    serviceAlerts: { header: { timestamp: now }, entity: [] },
  });
  const fetch = async (url) => {
    const f = feeds(), name = Object.keys(f).find((k) => url.includes(k));
    return { ok: true, status: 200, json: async () => f[name] };
  };
  const store = createStore({ routes, service, shapes, corridors: corridorsA, staticLoaded: true, buses: [], trips: [], alerts: [], away: [], feedTs: 0 });
  const live = startLive(store, { fetch, intervalMs: 600000, now: () => now });
  const ids = () => store.get().buses.map((b) => b.vehicle.id);
  for (; now <= NOON + 300; now += 10) await live.pollNow();
  eq(ids(), ["u"], "5 min 300 m off its drawn line, on its corridor: shown");
  pos = [41.7920, -87.60];
  for (; now < NOON + 300 + NEAR_S; now += 10) await live.pollNow();
  eq(ids(), ["u"], "a street over (222 m), under 2 min: shown");
  now += 10;
  await live.pollNow();
  live.stop();
  eq([ids(), store.get().away.map((b) => b.vehicle.id)], [[], ["u"]], "2 min: hidden, still tracked");
});

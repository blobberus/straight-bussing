// Tests for core/idle.js (idle buses that are not in service are hidden) and its use in data/live.js. Synthetic
// cases plus real bus reports from the archived raw polls (fixtures/idle_golden.json, made by
// experiments/routeknower/E28-scripts/make_golden.py; the iOS Kit IdleTests replays the same file).
import { test, eq, ok } from "./lib.js";
import { STILL_DOWNTOWN_M, DOWNTOWN_LAT, stillRadius, idleStep as idleStepD } from "../js/core/idle.js";
import { STILL_M, IDLE_S, PARKED_S, LINGER_S, PAST_PAD_S, FUTURE_S, GAP_S, SPOT_R, serviceClock, hoursKey, lingerAt,
  predictsAhead, idleStep } from "../js/core/idle.js";
import { startLive } from "../js/data/live.js";
import { createStore } from "../js/core/store.js";

const NOON = 1791997200;               // Wed 2026-10-14 12:00 Chicago (CDT)
const AT = (h, m = 0) => NOON + (h - 12) * 3600 + m * 60;   // Wed h:m (h may pass 24)
const day = (first, last) => ({ first, last, trips: 10, buses: Array(24).fill(1) });
const week = (d) => ({ mon: d, tue: d, wed: d, thu: d, fri: d, sat: d, sun: d });
// A: 07:00 to 21:00 every day; N: the night route 16:00 to 04:29
const service = { routes: { A: { days: week(day("07:00", "21:00")), exceptions: [] }, N: { days: week(day("16:00", "28:29")), exceptions: [] } } };
const SPOT = [41.79112, -87.59809];   // Reynolds Club, the 57th Street stop beside Regenstein Library
const idle = { from: "2026-10-10", to: "2026-11-05", valid_until: "2026-12-20",
  linger: [{ route: "N", spot: "Reynolds Club", lat: SPOT[0], lon: SPOT[1], r: 120, after: "23:33", days: "weekday", hours: ["16:00-28:29"], seen: 14 }] };
const bus = (id, rid, [lat, lon], ts) => ({ vehicle: { id }, trip: { trip_id: "t-" + id, route_id: rid }, position: { latitude: lat, longitude: lon }, timestamp: ts });
const tu = (id, times) => ({ trip: { trip_id: "t-" + id }, vehicle: { id }, stop_time_update: times.map((t) => ({ stop_id: "S", arrival: { time: t } })) });
const ctx = (now, over = {}) => ({ trips: [], service, idle, nowS: now, feedTs: now, ...over });
const OFF = [41.7860, -87.6012];      // a stop on A, 600 m from the spot

/** Feed the same bus every `every` s from t0 to t1 (positions from pos(t), trips from trips(t)); [t, hidden, why]. */
function drive(id, rid, pos, t0, t1, { every = 30, trips = () => [], over = {} } = {}) {
  let tracks = {};
  const out = [];
  for (let t = t0; t <= t1; t += every) {
    const r = idleStep(tracks, [bus(id, rid, pos(t), t)], ctx(t, { trips: trips(t), ...over }));
    tracks = r.tracks;
    out.push([t, r.hidden.includes(id), r.why[id] || null]);
  }
  return out;
}
const firstHidden = (rows) => { const r = rows.find((x) => x[1]); return r ? r[0] : null; };
const reasonAt = (rows) => (rows.find((x) => x[1]) || [])[2] || null;

test("idle: constants are the measured rule (RouteKnower E28)", () => {
  eq([STILL_M, IDLE_S, PARKED_S, LINGER_S, PAST_PAD_S, FUTURE_S, GAP_S, SPOT_R], [80, 1800, 5400, 180, 3600, 120, 600, 120]);
});

test("idle: a wider still radius downtown (owner 2026-11-11; RouteKnower E32c: 150 m north of Cermak Road)", () => {
  eq([STILL_DOWNTOWN_M, DOWNTOWN_LAT, stillRadius(41.88), stillRadius(41.79)], [150, 41.85, 150, 80]);
  // a bus parked at Union Station whose fixes wander up to 120 m (downtown GPS) stays one still stretch; on campus it restarts
  const T = 1792000000;
  const run = (lat0) => {
    let tr = {};
    for (let k = 0; k <= 12; k++) {
      const lat = lat0 + (k % 2 ? 0.0011 : 0);   // 122 m north every other report
      tr = idleStepD(tr, [{ vehicle: { id: "p" }, trip: { route_id: "R" }, position: { latitude: lat, longitude: -87.64 }, timestamp: T + 60 * k }], { nowS: T + 60 * k }).tracks;
    }
    return tr.p.since;
  };
  eq(run(41.8787), T, "downtown: still since the first report");
  ok(run(41.79) > T, "campus (80 m): the clock restarted");
});

test("idle: the service-day clock (the night after midnight belongs to the day before)", () => {
  eq(serviceClock(AT(23, 50)), { min: 1430, iso: "2026-10-14", day: "wed", group: "weekday" });
  eq(serviceClock(AT(24, 30)), { min: 1470, iso: "2026-10-14", day: "wed", group: "weekday" }, "00:30 Thursday = Wednesday 24:30");
  eq(serviceClock(AT(28, 30)).iso, "2026-10-15", "04:30 is the next service day");
  eq(serviceClock(AT(12) + 3 * 86400).group, "sat");
  eq(serviceClock(AT(24, 30) + 4 * 86400), { min: 1470, iso: "2026-10-18", day: "sun", group: "sun" }, "Monday 00:30 = Sunday night");
});

test("idle: listed hours as text, calendar exceptions first", () => {
  eq(hoursKey(service, "N", "2026-10-14", "wed"), "16:00-28:29");
  const sv = { routes: { M: { days: week({ first: "05:40", last: "18:55", spans: [["05:40", "11:55"], ["15:30", "18:55"]] }),
    exceptions: [{ date: "2026-11-26", type: "removed", hours: null }, { date: "2026-11-27", type: "added", hours: { first: "08:00", last: "12:00" } }] } } };
  eq(hoursKey(sv, "M", "2026-10-14", "wed"), "05:40-11:55,15:30-18:55", "two windows");
  eq(hoursKey(sv, "M", "2026-11-26", "thu"), "", "removed that day");
  eq(hoursKey(sv, "M", "2026-11-27", "fri"), "08:00-12:00", "changed hours that day");
  eq(hoursKey(sv, "X", "2026-10-14", "wed"), null, "no schedule data");
  eq(hoursKey(undefined, "N", "2026-10-14", "wed"), null);
});

test("idle: learned linger spots match the route, the spot, the time, the day and the listed hours", () => {
  ok(lingerAt(idle, service, "N", ...SPOT, AT(23, 40)), "North at Reynolds Club at 23:40");
  ok(lingerAt(idle, service, "N", ...SPOT, AT(24, 20)), "and after midnight (24:20)");
  ok(!lingerAt(idle, service, "N", ...SPOT, AT(23, 20)), "23:20: before the learned time (the 23:30 trip still leaves)");
  ok(!lingerAt(idle, service, "A", ...SPOT, AT(23, 40)), "another route");
  ok(!lingerAt(idle, service, "N", 41.7926, -87.5981, AT(23, 40)), "160 m away");
  ok(lingerAt(idle, service, "N", 41.7920, -87.5981, AT(23, 40)), "100 m away: inside the 120 m spot");
  ok(!lingerAt(idle, service, "N", ...SPOT, AT(23, 40) + 3 * 86400), "a Saturday: the weekday entry does not apply");
  const sv2 = { routes: { N: { days: week(day("16:00", "26:00")), exceptions: [] } } };
  ok(!lingerAt(idle, sv2, "N", ...SPOT, AT(23, 40)), "a new timetable for the route: the learned time is not used");
  ok(!lingerAt(idle, {}, "N", ...SPOT, AT(23, 40)), "no schedule data: not used");
  ok(!lingerAt({ ...idle, valid_until: "2026-10-13" }, service, "N", ...SPOT, AT(23, 40)), "past valid_until");
  ok(!lingerAt({ ...idle, linger: [{ ...idle.linger[0], hours: [] }] }, service, "N", ...SPOT, AT(23, 40)), "no hours to check: never");
  ok(lingerAt({ ...idle, linger: [{ ...idle.linger[0], days: "daily" }] }, service, "N", ...SPOT, AT(23, 40) + 3 * 86400), "daily");
  ok(!lingerAt(null, service, "N", ...SPOT, AT(23, 40)) && !lingerAt({}, service, "N", ...SPOT, AT(23, 40)), "no file");
});

test("idle: Passio predicting a stop at least 2 min ahead (this bus only)", () => {
  const t = AT(12);
  ok(predictsAhead([tu("1", [t + FUTURE_S])], "1", t), "2 min ahead");
  ok(!predictsAhead([tu("1", [t + 60, t - 30])], "1", t), "only 'due now' times");
  ok(!predictsAhead([tu("2", [t + 900])], "1", t), "another bus (trip ids are shared)");
  ok(predictsAhead([{ vehicle: { id: "1" }, stop_time_update: [{ departure: { time: t + 600 } }] }], "1", t), "a departure time");
  ok(!predictsAhead(undefined, "1", t) && !predictsAhead([{ trip: {} }], "1", t));
});

test("idle: a bus still with no prediction ahead is hidden at 30 min; a time ahead keeps it until 90 min", () => {
  const none = drive("a", "A", () => OFF, AT(12), AT(13, 40));
  eq(firstHidden(none), AT(12) + IDLE_S, "no prediction: hidden at exactly 30 min");
  eq(reasonAt(none), "idle");
  const ahead = drive("a", "A", () => OFF, AT(12), AT(13, 40), { trips: (t) => [tu("a", [t + 600])] });
  eq(firstHidden(ahead), AT(12) + PARKED_S, "Passio expects it to move: shown until 90 min");
  eq(reasonAt(ahead), "parked");
  const now = drive("a", "A", () => OFF, AT(12), AT(12, 40), { trips: (t) => [tu("a", [t + 30])] });
  eq(firstHidden(now), AT(12) + IDLE_S, "a time pinned to 'now' does not count");
});

test("idle: past the listed hours by more than an hour, 3 min still is enough", () => {
  eq(firstHidden(drive("a", "A", () => OFF, AT(22, 5), AT(22, 30))), AT(22, 5) + LINGER_S, "22:05 (65 min after 21:00)");
  const ahead = (t) => [tu("a", [t + 600])];
  eq(firstHidden(drive("a", "A", () => OFF, AT(21, 20), AT(21, 55), { trips: ahead })), null, "21:20 to 21:55: within the hour");
  eq(reasonAt(drive("a", "A", () => OFF, AT(22, 5), AT(22, 30))), "past");
  eq(firstHidden(drive("a", "A", () => OFF, AT(6, 10), AT(6, 50), { trips: ahead })), null, "06:10 to 06:50: within an hour before the 07:00 start");
  eq(firstHidden(drive("a", "A", () => OFF, AT(5, 40), AT(5, 50))), AT(5, 43), "05:40: 80 min before the start");
});

test("idle: at a learned linger spot after its time, 3 min still is enough; before it, never", () => {
  const late = drive("n", "N", () => SPOT, AT(23, 46), AT(24, 0), { trips: (t) => [tu("n", [AT(24, 0), AT(24, 29)])] });
  eq(firstHidden(late), AT(23, 46) + LINGER_S, "23:46 to 00:00: hidden from 23:49 although Passio predicts its 00:00 trip");
  eq(reasonAt(late), "linger");
  const lay = drive("n", "N", () => SPOT, AT(23, 15), AT(23, 29), { trips: (t) => [tu("n", [AT(23, 30)])] });
  eq(firstHidden(lay), null, "the 23:15 to 23:29 layover (it serves the 23:30 trip): never");
});

test("idle: moving shows the bus at once; GPS jitter within 80 m keeps the clock", () => {
  let tr = {};
  for (let t = AT(12); t <= AT(12, 31); t += 60) tr = idleStep(tr, [bus("a", "A", OFF, t)], ctx(t)).tracks;
  eq(idleStep(tr, [bus("a", "A", OFF, AT(12, 32))], ctx(AT(12, 32))).hidden, ["a"], "still 32 min: hidden");
  const jit = idleStep(tr, [bus("a", "A", [OFF[0] + 0.0006, OFF[1]], AT(12, 32))], ctx(AT(12, 32)));
  eq(jit.hidden, ["a"], "67 m off its first report: still the same place");
  const moved = idleStep(tr, [bus("a", "A", [OFF[0] + 0.0009, OFF[1]], AT(12, 32))], ctx(AT(12, 32)));
  eq(moved.hidden, [], "100 m: it moved, shown at once");
  eq(moved.tracks.a.since, AT(12, 32), "a new clock");
});

test("idle: report gaps, route changes, missing polls and the phone clock", () => {
  let tr = idleStep({}, [bus("a", "A", OFF, AT(12))], ctx(AT(12))).tracks;
  tr = idleStep(tr, [bus("a", "A", OFF, AT(12, 10))], ctx(AT(12, 10))).tracks;
  eq(tr.a.since, AT(12), "a 10 min gap continues");
  tr = idleStep(tr, [bus("a", "A", OFF, AT(12, 20) + 1)], ctx(AT(12, 20) + 1)).tracks;
  eq(tr.a.since, AT(12, 20) + 1, "more than 10 min without a report: a new clock");
  tr = idleStep(tr, [bus("a", "N", OFF, AT(12, 21))], ctx(AT(12, 21))).tracks;
  eq(tr.a.since, AT(12, 21), "a route change: a new clock");
  const missing = idleStep(tr, [], ctx(AT(12, 25)));
  eq(missing.tracks.a.since, AT(12, 21), "missing from one poll: the clock is kept");
  eq(idleStep(tr, [], ctx(AT(12, 21) + GAP_S + 1)).tracks, {}, "dropped after GAP_S");
  // the clock and the time of day run on report times: a phone clock 3 h ahead changes nothing
  let t2 = {};
  for (let t = AT(23, 46); t <= AT(23, 48); t += 30) t2 = idleStep(t2, [bus("n", "N", SPOT, t)], ctx(t, { nowS: t + 3 * 3600 })).tracks;
  eq(idleStep(t2, [bus("n", "N", SPOT, AT(23, 48) + 30)], ctx(AT(23, 48) + 30, { nowS: AT(23, 48) + 30 + 3 * 3600 })).hidden, [], "2.5 min: still shown");
  const before = JSON.stringify(t2);
  idleStep(t2, [bus("n", "N", SPOT, AT(23, 59))], ctx(AT(23, 59)));
  eq(JSON.stringify(t2), before, "the tracks passed in are not modified");
});

test("idle: nothing hidden without a vehicle id, a route or a position; no static data hides only by time", () => {
  let tr = {};
  for (let t = AT(12); t <= AT(12, 40); t += 60) {
    const r = idleStep(tr, [{ ...bus(null, "A", OFF, t), vehicle: {} }, { ...bus("q", null, OFF, t), trip: {} }, { vehicle: { id: "p" }, trip: { route_id: "A" }, timestamp: t }],
      ctx(t, { service: {}, idle: null }));
    tr = r.tracks;
    eq(r.hidden, []);
  }
  const rows = drive("a", "A", () => OFF, AT(22, 5), AT(22, 40), { over: { service: {}, idle: null } });
  eq(firstHidden(rows), AT(22, 5) + IDLE_S, "before static data: no listed hours, only the 30 min rule");
});

test("idle real: the Nov 5 buses beside Regenstein hidden from 11:49 PM, their layovers and the bus that served never", async () => {
  const fx = await (await fetch("fixtures/idle_golden.json", { cache: "no-store" })).json();
  const bad = [], hiddenFrom = {}, shownAfter = {};
  for (const c of fx.cases) {
    let tracks = {};
    c.polls.forEach((p, i) => {
      const buses = p.v.map(([veh, rid, lat, lon, vt]) => ({ vehicle: { id: veh }, trip: { route_id: rid }, position: { latitude: lat, longitude: lon }, timestamp: vt }));
      const trips = p.p.filter((x) => x[1]).map(([veh, t]) => ({ trip: { trip_id: "t" + veh }, vehicle: { id: veh }, stop_time_update: [{ stop_id: "s", arrival: { time: t } }] }));
      const r = idleStep(tracks, buses, { trips, service: fx.service, idle: fx.idle, nowS: p.h, feedTs: p.h });
      tracks = r.tracks;
      if (JSON.stringify(r.hidden) !== JSON.stringify(c.expect[i])) bad.push(`${c.name} poll ${i}: ${r.hidden} vs ${c.expect[i]}`);
      for (const v of r.hidden) hiddenFrom[c.name + ":" + v] = hiddenFrom[c.name + ":" + v] || p.h;
      for (const [v] of p.v) if (hiddenFrom[c.name + ":" + v] && !r.hidden.includes(v)) shownAfter[c.name + ":" + v] = shownAfter[c.name + ":" + v] || p.h;
    });
  }
  eq(bad.slice(0, 5), [], bad.length + " polls differ from the stored answers");
  const at = (k) => hiddenFrom[k] && new Date(hiddenFrom[k] * 1000).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hourCycle: "h23" });
  ok(/^23:(49|50)/.test(at("regenstein:4328")), "North at Reynolds Club (the owner's 11:50 PM bus): " + at("regenstein:4328"));
  ok(/^23:(49|50)/.test(at("regenstein:4538")), "South at Burton-Judson: " + at("regenstein:4538"));
  ok(/^23:5[34]/.test(at("regenstein:4313")), "Central at Reynolds Club, 40 min after its listed hours: " + at("regenstein:4313"));
  ok(/^23:5[34]/.test(at("regenstein:4318")) && /^23:5[89]/.test(at("regenstein:12645")), "Apostolic/Drexel at Goldblatt");
  ok(!hiddenFrom["regenstein:4325"], "East: it served stops after its last layover, never hidden");
  ok(Object.entries(hiddenFrom).filter(([k]) => k.startsWith("regenstein:")).every(([, t]) => t >= 1793944140), "nothing hidden before 23:49 (the 23:15 to 23:30 layovers)");
  const back = new Date(shownAfter["regenstein:4328"] * 1000).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hourCycle: "h23" });
  ok(/^(23:5[789]|00:0)/.test(back), "shown again once it drove off: " + back);
  ok(/^13:4[67]/.test(at("parked:12647")), "parked 90 min: " + at("parked:12647"));
  ok(/^19:2[56]/.test(at("idle:4317")), "still 30 min with no prediction: " + at("idle:4317"));
  ok(/^22:1[12]/.test(at("past:4325")), "70 min past its listed hours: " + at("past:4325"));
  ok(!Object.keys(hiddenFrom).some((k) => k.startsWith("nopred:")), "a 27 min wait with no prediction that then served: never");
});

test("live: an idle bus leaves store.buses and its trip updates leave store.trips", async () => {
  let now = AT(23, 40), pos = SPOT;
  const feeds = () => ({
    vehiclePositions: { header: { timestamp: now }, entity: [{ vehicle: bus("n", "N", pos, now) }, { vehicle: bus("ok", "N", OFF, now) }] },
    tripUpdates: { header: { timestamp: now }, entity: [{ trip_update: { ...tu("n", [AT(24, 0)]), trip: { trip_id: "t", route_id: "N" } } },
      { trip_update: { ...tu("ok", [now + 600]), trip: { trip_id: "t", route_id: "N" } } }] },
    serviceAlerts: { header: { timestamp: now }, entity: [] },
  });
  const fetch = async (url) => {
    const f = feeds(), name = Object.keys(f).find((k) => url.includes(k));
    return { ok: true, status: 200, json: async () => f[name] };
  };
  const store = createStore({ routes: { N: { short: "N" } }, service, idle, shapes: {}, staticLoaded: true, buses: [], trips: [], alerts: [], feedTs: 0 });
  const live = startLive(store, { fetch, intervalMs: 600000, now: () => now });
  const ids = () => store.get().buses.map((b) => b.vehicle.id);
  const tripVehs = () => store.get().trips.map((t) => t.vehicle.id);
  for (let k = 0; k < 6; k++) { await live.pollNow(); now += 30; }
  eq(ids(), ["n", "ok"], "2.5 min still at the spot: shown");
  now += 30;
  await live.pollNow();
  eq(ids(), ["ok"], "3 min: hidden");
  eq(tripVehs(), ["ok"], "its arrival times go with it");
  pos = [SPOT[0] + 0.002, SPOT[1]];
  now += 10;
  await live.pollNow();
  live.stop();
  eq(ids(), ["n", "ok"], "it moved: shown at once");
  eq(tripVehs(), ["n", "ok"]);
});

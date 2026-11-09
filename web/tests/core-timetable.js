// Tests for core/timetable.js and the planner's timetable mode (owner 2026-11-09: "when deciding a destination, the user
// should have an optional trip start time. This trip start time should schedule the arrivals based on the scheduled
// arrival time")
import { test, eq, ok, near } from "./lib.js";
import { plan, refineWalking } from "../js/core/planner.js";
import { chicagoUnix } from "../js/core/timeactive.js";
import { clock } from "../js/core/time.js";
import { cleanTimetable } from "../js/data/timetable.js";
import {
  LIVE_SOON_MIN, LEAVE_NOW, TT_DISCLAIMER, startMode, isoOf, isoAdd, servicesOn, serviceUnix, outsideTimetable,
  instancesBetween, departureIndex, instAt, nextInstance, reachAt, leaveLabel, leaveDays, leaveValues, leaveUnix, leaveDefault,
} from "../js/core/timetable.js";

const at = (y, m, d, h, min) => chicagoUnix(y, m, d, h, min);
const H = 3600, M = 60;
// A loop S0 -> S1 -> S2 -> S3 -> S0 (830 m x 1110 m), 4 min between stops, every 20 min 7:00 AM to 6:40 PM on weekdays.
const stops = {
  S0: { name: "S0", lat: 41.79, lon: -87.6 }, S1: { name: "S1", lat: 41.79, lon: -87.59 },
  S2: { name: "S2", lat: 41.8, lon: -87.59 }, S3: { name: "S3", lat: 41.8, lon: -87.6 },
};
const LOOP = ["S0", "S1", "S2", "S3", "S0"];
const every = (from, to, step) => { const out = []; for (let s = from; s <= to; s += step) out.push(s); return out; };
const TT = (routes, dates = {}) => cleanTimetable({
  v: 1, feed: { start: "2026-11-08", end: "2026-12-09" },
  services: { WK: { days: "1111100", start: "2025-01-01", end: "2027-12-31" }, ALL: { days: "1111111", start: "2025-01-01", end: "2027-12-31" } },
  dates, routes,
});
const RT = { stops: LOOP, t: [0, 240, 480, 720, 960], starts: { WK: every(7 * H, 18 * H + 40 * M, 20 * M) } };
const tt1 = TT({ R: [RT] }, { "2026-11-26": { WK: 2 }, "2026-11-28": { WK: 1 } });
const near_ = (id, dLat = 0.0001) => ({ lat: stops[id].lat + dLat, lon: stops[id].lon });
const data = (extra = {}) => ({ stops, routes: {}, routeStops: { R: LOOP }, trips: [], buses: [], ...extra });
const busLegs = (o) => o.legs.filter((l) => l.type === "bus");
const TUE = (h, m) => at(2026, 11, 10, h, m);

test("timetable: startMode: none or past = now, under 10 min = live times from then, later = the timetable", () => {
  const now = TUE(12, 0);
  eq(startMode(null, now), "now");
  eq(startMode(now - 60, now), "now", "a start time already past");
  eq(startMode(now, now), "now");
  eq(startMode(now + (LIVE_SOON_MIN * 60 - 1), now), "live");
  eq(startMode(now + LIVE_SOON_MIN * 60, now), "timetable");
  eq(startMode(now + 86400, now), "timetable");
});

test("timetable: service days, calendar dates and the service-day clock", () => {
  eq([...servicesOn(tt1, "2026-11-10")].sort(), ["ALL", "WK"], "a Tuesday");
  eq([...servicesOn(tt1, "2026-11-14")], ["ALL"], "a Saturday");
  eq([...servicesOn(tt1, "2026-11-26")], ["ALL"], "Thanksgiving: WK removed");
  eq([...servicesOn(tt1, "2026-11-28")].sort(), ["ALL", "WK"], "an added Saturday");
  const before = cleanTimetable({ ...tt1, services: { WK: { days: "1111111", start: "2026-12-01", end: null } } });
  eq([...servicesOn(before, "2026-11-10")], [], "before its start date");
  eq(isoOf(TUE(23, 59)), "2026-11-10");
  eq(isoAdd("2026-11-30", 1), "2026-12-01");
  eq(serviceUnix("2026-11-10", 17 * H + 40 * M), TUE(17, 40));
  eq(serviceUnix("2026-11-10", 24 * H + 30 * M), at(2026, 11, 11, 0, 30), "past 24:00 = the next date's clock");
  // the clock change night (Nov 1, 2026): 25:30 on Oct 31's service is 1:30 AM, the first one
  eq(serviceUnix("2026-10-31", 25 * H + 30 * M), at(2026, 11, 1, 1, 30));
  eq(serviceUnix("2026-11-01", 12 * H), at(2026, 11, 1, 12, 0));
  ok(!outsideTimetable(tt1, TUE(12, 0)));
  ok(outsideTimetable(tt1, at(2026, 12, 20, 12, 0)), "after the timetable's dates");
});

test("timetable: trip instances, departures, the time a trip reaches a stop, the loop going on", () => {
  const inst = instancesBetween(tt1, TUE(8, 5), TUE(9, 0), ["R"]);
  eq(inst.map((x) => x.start), [TUE(8, 0), TUE(8, 20), TUE(8, 40), TUE(9, 0)], "running at 8:05 (the 7:40 ended at 7:56) or starting by 9:00");
  eq(inst[0].times, [0, 4, 8, 12, 16].map((m) => TUE(8, m)));
  ok(inst[0].id.startsWith("R:2026-11-10:"), inst[0].id);
  const idx = departureIndex(inst);
  eq(idx.get("R|S0").map((x) => x.t), [TUE(8, 0), TUE(8, 20), TUE(8, 40), TUE(9, 0)], "the end of a loop is not a boarding time");
  eq(instAt(inst[0], "S0", TUE(8, 0)), TUE(8, 16), "the loop's end, after boarding at its start");
  eq(instAt(inst[0], "S1", TUE(8, 5)), null, "already past");
  eq(nextInstance(inst, inst[0]), inst[1], "the trip that starts where it ends");
  eq(reachAt(inst, inst[0], "S1", TUE(8, 8)), TUE(8, 24), "round the loop onto the next trip");
  eq(instancesBetween(tt1, TUE(2, 0), TUE(3, 0), ["R"]), [], "no service at 2 AM");
  eq(instancesBetween(null, 0, 1), []);
});

test("timetable plan: a weekday time waits for the scheduled bus and rides to its scheduled arrival; live data ignored", () => {
  const t0 = TUE(8, 17);
  const liveTrip = { trip: { trip_id: "x", route_id: "R" }, vehicle: { id: "v1" }, stop_time_update: [{ stop_id: "S0", arrival: { time: TUE(8, 18) } }, { stop_id: "S2", arrival: { time: TUE(8, 25) } }] };
  const r = plan({ from: near_("S0"), to: near_("S2"), now: t0, data: data({ trips: [liveTrip], buses: [{ vehicle: { id: "v1" }, trip: { route_id: "R" } }] }), timetable: tt1 });
  eq(r.timetable, true);
  const o = r.options.find((x) => !x.walkOnly), [b] = busLegs(o);
  eq([b.board.id, b.alight.id], ["S0", "S2"]);
  eq(b.boardT, TUE(8, 20), "the 8:20 departure, not the live bus at 8:18");
  eq(b.alightT, TUE(8, 28), "the scheduled arrival");
  eq([b.source, b.waitLive, b.waitSched, b.vehicleId], ["timetable", false, true, null]);
  near(b.ride, 8, 1e-9, "scheduled arrival minus scheduled departure");
  near(b.wait, (TUE(8, 20) - t0) / 60 - o.legs[0].min, 1e-6, "scheduled departure minus your arrival at the stop");
  ok(b.tripId.startsWith("R:2026-11-10:"), b.tripId);
  eq(o.t0, t0);
  near(o.arrive, TUE(8, 28) + (o.legs[2] ? o.legs[2].min * 60 : 0), 1e-6);
  // without the timetable the same data plans live (unchanged)
  const live = plan({ from: near_("S0"), to: near_("S2"), now: t0, data: data({ trips: [liveTrip], buses: [{ vehicle: { id: "v1" }, trip: { route_id: "R" } }] }) });
  eq(busLegs(live.options.find((x) => !x.walkOnly))[0].boardT, TUE(8, 18), "live mode boards the live bus");
  eq(live.timetable, undefined);
});

test("timetable plan: a time outside service has no bus option", () => {
  const r = plan({ from: near_("S0"), to: near_("S2"), now: TUE(3, 0), data: data(), timetable: tt1 });
  eq(r.options.filter((o) => !o.walkOnly), [], "nothing runs at 3 AM");
  const late = plan({ from: near_("S0"), to: near_("S2"), now: TUE(18, 50), data: data(), timetable: tt1 });
  eq(late.options.filter((o) => !o.walkOnly), [], "the last trip left at 6:40 PM");
});

test("timetable plan: a night route after midnight rides the previous service day's last trips", () => {
  const night = TT({ N: [{ stops: LOOP, t: [0, 240, 480, 720, 960], starts: { ALL: every(16 * H, 24 * H + 40 * M, 20 * M) } }] });
  const r = plan({ from: near_("S0"), to: near_("S2"), now: at(2026, 11, 11, 0, 15), data: { ...data(), routeStops: { N: LOOP } }, timetable: night });
  const [b] = busLegs(r.options.find((o) => !o.walkOnly));
  eq(b.boardT, at(2026, 11, 11, 0, 20), "Tuesday's 24:20 trip at 12:20 AM Wednesday");
  ok(b.tripId.startsWith("N:2026-11-10:"), "Tuesday's service: " + b.tripId);
  const after = plan({ from: near_("S0"), to: near_("S2"), now: at(2026, 11, 11, 0, 45), data: { ...data(), routeStops: { N: LOOP } }, timetable: night });
  eq(after.options.filter((o) => !o.walkOnly), [], "after the last trip (12:40 AM) nothing until 4 PM");
});

test("timetable plan: calendar exceptions remove and add service", () => {
  const go = (d) => plan({ from: near_("S0"), to: near_("S2"), now: at(2026, 11, d, 8, 17), data: data(), timetable: tt1 }).options.filter((o) => !o.walkOnly);
  eq(go(26), [], "Thanksgiving (Thu Nov 26): removed");
  eq(go(21), [], "a regular Saturday: no weekday service");
  eq(busLegs(go(28)[0])[0].boardT, at(2026, 11, 28, 8, 20), "Sat Nov 28: added");
  eq(busLegs(go(25)[0])[0].boardT, at(2026, 11, 25, 8, 20), "the day before: regular");
});

test("timetable plan: a later departure that arrives first wins; a trip that does not go there is skipped", () => {
  const slow = { stops: LOOP, t: [0, 1200, 2400, 2700, 3000], starts: { WK: [8 * H + 20 * M] } };
  const fast = { stops: LOOP, t: [0, 240, 480, 720, 960], starts: { WK: [8 * H + 25 * M] } };
  const r = plan({ from: near_("S0"), to: near_("S2"), now: TUE(8, 17), data: data(), timetable: TT({ R: [slow, fast] }) });
  const [b] = busLegs(r.options.find((o) => !o.walkOnly));
  eq([b.boardT, b.alightT], [TUE(8, 25), TUE(8, 33)], "the 8:25 gets to S2 before the 8:20");
  near(b.wait, (TUE(8, 25) - TUE(8, 17)) / 60 - r.options.find((o) => !o.walkOnly).legs[0].min, 1e-6, "the wait follows the bus taken");
  const short = { stops: ["S0", "S1"], t: [0, 240], starts: { WK: [8 * H + 20 * M] } };
  const full = { stops: LOOP, t: [0, 240, 480, 720, 960], starts: { WK: [8 * H + 40 * M] } };
  const r2 = plan({ from: near_("S0"), to: near_("S2"), now: TUE(8, 17), data: data(), timetable: TT({ R: [short, full] }) });
  eq(busLegs(r2.options.find((o) => !o.walkOnly))[0].boardT, TUE(8, 40), "the 8:20 short trip ends at S1");
});

test("timetable plan: a loop ride the long way around goes on with the next trip from the loop's end", () => {
  const r = plan({ from: near_("S2"), to: near_("S1"), now: TUE(8, 25), data: data(), timetable: tt1 });
  const o = r.options.find((x) => !x.walkOnly), [b] = busLegs(o);
  eq([b.board.id, b.alight.id, b.stopsPassed], ["S2", "S1", 3]);
  eq([b.boardT, b.alightT], [TUE(8, 28), TUE(8, 44)], "S3 8:32, S0 8:36 (end), the 8:40 trip, S1 8:44");
});

test("timetable plan: a longer sidewalk walk that misses the scheduled bus takes the next one", async () => {
  const d = data();
  const o = plan({ from: near_("S0", 0.001), to: near_("S2"), now: TUE(8, 17), data: d, timetable: tt1 }).options.find((x) => !x.walkOnly);
  eq(busLegs(o)[0].boardT, TUE(8, 20));
  const walkRoute = async (a, b) => ({ m: 600, min: 6, coords: [[a.lat, a.lon], [b.lat, b.lon]], source: "router" });
  const r = await refineWalking(o, { walkRoute, now: TUE(8, 17), data: d, from: near_("S0", 0.001), to: near_("S2"), timetable: tt1 });
  eq(r.replanned, true);
  eq(busLegs(r)[0].boardT, TUE(8, 40), "6 min on foot misses the 8:20: the 8:40");
  eq(busLegs(r)[0].source, "timetable");
});

const REG = { lat: 41.79216, lon: -87.59994 }, VUE53 = { lat: 41.79981, lon: -87.59366 };   // places.json: Regenstein, Vue53 Apartments
const real = (() => {
  let p = null;
  return () => p || (p = Promise.all(["stops", "route_stops", "routes", "timetable"].map((n) => fetch("../data/" + n + ".json").then((r) => r.json())))
    .then(([st, rs, routes, tt]) => ({ data: { stops: st, routeStops: rs, routes, trips: [], buses: [] }, tt: cleanTimetable(tt) })));
})();

test("timetable plan: Regenstein to Vue53 on the 53rd's timetable (Tue noon): the long way around, scheduled times", async () => {
  const { data: d, tt } = await real();
  const t0 = TUE(12, 0);
  const r = plan({ from: REG, to: VUE53, now: t0, data: d, timetable: tt });
  const o = r.options[0], [b] = busLegs(o);
  ok(o.key.startsWith("4346"), "the 53rd Street Express first (least walking): " + o.key);
  eq([b.board.id, b.alight.id], ["138837", "8811"], "Ellis Ave & 57th St to 53rd St & Kenwood");
  eq([b.boardT, b.alightT], [TUE(12, 7), TUE(12, 31)], "the 12:00 PM trip at 12:07, round the loop (12:30 PM trip) to 12:31");
  eq([b.source, b.waitSched, b.waitLive], ["timetable", true, false]);
  ok(o.walkMin < 5 && o.total < 40, `walks ${o.walkMin.toFixed(1)} min, ${o.total.toFixed(1)} min door to door`);
  ok(r.options.some((x) => x.walkOnly), "walking the whole way is listed too");
});

test("timetable plan: Regenstein to Vue53 at 5:40 PM tomorrow (the planner's own answer, every bus time scheduled)", async () => {
  const { data: d, tt } = await real();
  const t0 = TUE(17, 40);
  const r = plan({ from: REG, to: VUE53, now: t0, data: d, timetable: tt });
  ok(r.options.length >= 1, "something to show (walking at least)");
  for (const o of r.options) {
    ok(o.arrive > t0 && o.total <= 60, `${o.key}: ${o.total.toFixed(1)} min`);
    for (const l of busLegs(o)) {
      eq([l.source, l.waitSched, l.waitLive], ["timetable", true, false], o.key);
      ok(l.boardT >= t0 && l.alightT > l.boardT);
    }
  }
});

test("timetable: the control's words, its days and its values", () => {
  const now = TUE(12, 0);
  eq(leaveLabel(null, now), LEAVE_NOW);
  eq(leaveLabel(now - 60, now), LEAVE_NOW, "a time already past reads Leave now");
  eq(leaveLabel(TUE(17, 40), now), "Leave at " + clock(TUE(17, 40)));
  eq(leaveLabel(TUE(12, 5), now), "Leave at " + clock(TUE(12, 5)), "live times from then, still the chosen time");
  eq(leaveLabel(at(2026, 11, 11, 17, 40), now), "Leave tomorrow at " + clock(at(2026, 11, 11, 17, 40)));
  eq(leaveLabel(at(2026, 11, 12, 17, 40), now), "Leave Thu Nov 12 at " + clock(at(2026, 11, 12, 17, 40)));
  const days = leaveDays(now, tt1);
  eq(days.slice(0, 3).map((x) => x.text), ["Today", "Tomorrow", "Thu Nov 12"]);
  eq(days[0].say, "Today, Tuesday, November 10");
  eq(days[days.length - 1].iso, "2026-12-09", "through the timetable's last date");
  eq(leaveDays(now, null).length, 7, "a week without a timetable");
  eq(leaveDays(at(2026, 12, 8, 12, 0), tt1).length, 7, "at least a week");
  const v = leaveValues(TUE(17, 40));
  eq(v, { iso: "2026-11-10", hour12: 5, minute: 40, pm: true });
  eq(leaveUnix(v), TUE(17, 40));
  eq(leaveUnix({ iso: "2026-11-11", hour12: 12, minute: 5, pm: false }), at(2026, 11, 11, 0, 5), "12 AM");
  eq(leaveDefault(null, TUE(12, 1)), TUE(12, 5), "now, rounded up to 5 minutes");
  eq(leaveDefault(null, TUE(12, 5)), TUE(12, 10));
  eq(leaveDefault(TUE(17, 40), now), TUE(17, 40), "the chosen time");
  ok(TT_DISCLAIMER.includes("Most buses run later than scheduled") && !/UGo/.test(TT_DISCLAIMER), "the app's own words never say UGo");
});

// The shared golden file (web/tests/tripstart-golden.html wrote it; the iOS Kit TimetableTests read a copy): the planner's
// timetable-mode answers and the timetable helpers, replayed on the inputs stored in it
test("timetable: the shared golden file (iOS Kit parity)", async () => {
  const fx = await (await fetch("fixtures/tripstart_golden.json", { cache: "no-store" })).json();
  const d = { stops: fx.inputs.stops, routeStops: fx.inputs.routeStops, trips: [], buses: [] }, tt = cleanTimetable(fx.inputs.timetable);   // its own inputs
  ok(fx.cases.length >= 40, "cases");
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const leg = (l) => l.type === "walk" ? { type: "walk", m: l.m, min: r6(l.min) }
    : { type: "bus", rid: l.rid, board: l.board.id, alight: l.alight.id, stopsPassed: l.stopsPassed, boardT: l.boardT, alightT: l.alightT,
        wait: r6(l.wait), ride: r6(l.ride), source: l.source, waitSched: !!l.waitSched, tripId: l.tripId };
  for (const c of fx.cases) {
    const r = plan({ from: c.from, to: c.to, now: c.t0, data: d, timetable: tt });
    eq(r.options.some((o) => o.walkOnly), c.walkListed, c.name + " walk listed");
    eq(r.options.filter((o) => !o.walkOnly).map((o) => ({ key: o.key, total: r6(o.total), totalMin: o.totalMin, arrive: r6(o.arrive),
      walkMin: r6(o.walkMin), walkM: o.walkM, meets: o.meets, legs: o.legs.map(leg) })), c.options, c.name);
  }
  const h = fx.helpers, inst = instancesBetween(tt, h.t0, h.t0 + 3600, ["4346", "1077"]);
  eq(inst.map((x) => ({ rid: x.rid, id: x.id, start: x.start, end: x.end })), h.instances, "instances");
  const idx = departureIndex(inst);
  for (const [k, v] of Object.entries(h.departures)) eq((idx.get(k) || []).map((x) => x.t), v, k);
  for (const m of h.modes) eq(startMode(m.at, m.now), m.mode, JSON.stringify(m));
  eq(leaveDays(h.t0, tt).map((x) => [x.iso, x.text, x.say]), h.days, "days");
});

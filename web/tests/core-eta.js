// Tests for core/eta.js (station times, owner 2026-11-20). Real feed pattern in eta-fixtures.js.
import { test, eq, ok, near } from "./lib.js";
import { markFiller, busTimes, stationTimes, scheduledAt, timeWords, FILLER_S, ETA_WORDS, ETA_NOTES, _resetEta } from "../js/core/eta.js";
import { clock } from "../js/core/time.js";
import { T0, routeStops, stops, tripUpdates, vehicles, ride } from "./eta-fixtures.js";

const NOW = T0 + 5;
const real = (extra = {}) => ({ routeStops, stops, trips: tripUpdates().map(markFiller), buses: vehicles(), service: {}, transitioning: [], ...extra });
const busOf = (S, vid) => S.buses.find((b) => b.vehicle.id === vid);
const fl = (tu) => tu.stop_time_update.map((u) => !!u.filler);
const at = (S, stop, opts = {}) => stationTimes(S, stop, { now: NOW, ride, ...opts });

test("markFiller: 0 to 3 s after the previous listed time is filler, the head of a run is not", () => {
  eq(FILLER_S, 3);
  const T = 1_800_000_000, a = (id, t) => ({ stop_id: id, arrival: { time: t } });
  const tu = { stop_time_update: [a("a", T + 100), a("b", T + 102), a("c", T + 105), a("d", T + 109), { stop_id: "e" },
    { stop_id: "f", departure: { time: T + 109 } }, a("g", T + 90), a("h", String(T + 92)), null, a("i", T + 300)] };
  eq(markFiller(tu), tu, "the same object back");
  eq(tu.stop_time_update.map((u) => (u ? !!u.filler : null)), [false, true, true, false, false, true, false, true, null, false],
    "+2 and +3 s filler; +4 s, earlier, untimed and later entries not; an untimed entry does not break the run");
  markFiller(tu);
  eq(tu.stop_time_update.map((u) => (u ? !!u.filler : null)), [false, true, true, false, false, true, false, true, null, false], "idempotent");
  const stale = { stop_time_update: [{ ...a("x", T), filler: true }, a("y", T + 60)] };
  eq(fl(markFiller(stale)), [false, false], "a stale mark on a real time is cleared");
  for (const bad of [null, undefined, {}, { stop_time_update: null }, { stop_time_update: [1, "x"] }]) markFiller(bad);
  ok(true, "no throw on bad input");
});

test("markFiller on the real feed: 53rd Street Express trip 681004 is one head and 13 filler entries", () => {
  const [prev, cur, b2, t53, t53n] = tripUpdates().map(markFiller);
  eq(fl(t53), [false, ...Array(13).fill(true)]);
  eq(fl(t53n), [false], "a one-entry trip update is its own head");
  eq(fl(cur), [false, true, false, true, false, false, false, false, false, false, true], "Apostolic/Drexel: real times with filler between");
  eq(fl(b2), [false, true, true, true, true, true, true, true, true, false, true, true], "two heads, the rest filler");
  eq(fl(prev), [false]);
});

test("busTimes: 53rd Street Express, one lap from the stop the bus heads to; live at the heads, est. between, never back in time", () => {
  _resetEta();
  const S = real(), b = busOf(S, "4326"), out = busTimes(S, b, NOW, ride);
  eq(out.map((x) => x.stopId), ["8629", "138837", "8630", "8612", "8589", "8631", "8632", "161844", "8594", "8624", "8599", "8626", "8596", "8811", "8628", "8595"],
    "from Ellis Garage (its next stop) round the loop, each stop once");
  eq(out.map((x) => x.idx), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3], "index in the route's stop order");
  eq(out.filter((x) => x.kind === "live").map((x) => [x.stopId, x.t - T0]), [["8596", 752], ["8595", 1586]], "only the two heads are live");
  ok(out.every((x, k) => x.t >= NOW && (k === 0 || x.t >= out[k - 1].t)), "never before now or the stop before");
  // the first live time is 12 stops ahead: the stops before it are scaled between the bus (now) and it, not all "now"
  const mins = out.slice(0, 12).map((x) => Math.floor((x.t - NOW) / 60));
  ok(new Set(mins).size >= 9, "the 12 stops before Harper Court get different minutes: " + mins);
  ok(out[0].t - NOW < 60, "Ellis Garage (about 100 m ahead) in under a minute");
  near((out[11].t - NOW) / (752 - 5), (0.4 + 15) / 19.4, 0.03, "Lake Park & 55th: scaled by the scheduled ride to Harper Court's live time");
  ok(out[13].t > T0 + 752 && out[13].t < T0 + 1586, "between the two heads: scaled between them");
  eq(busTimes(S, b, NOW, ride), out, "same inputs: the same answer");
});

test("busTimes: a time listed out of travel order is not used (Apostolic/Drexel bus 4318)", () => {
  _resetEta();
  const S = real(), out = busTimes(S, busOf(S, "4318"), NOW, ride);
  eq(out.map((x) => x.stopId), ["8611", "8614", "133007", "8612", "8613", "8615", "8616", "8617", "8609", "8630"]);
  eq(out.filter((x) => x.kind === "live").map((x) => [x.stopId, x.t - T0]), [["133007", 457]], "Kenwood & 63rd is live");
  const g = out.find((x) => x.stopId === "8612");
  eq(g.kind, "est", "Goldblatt's +3 min (the trip's first stop, behind the bus) is not this lap's time");
  ok(g.t > T0 + 457, "after Kenwood & 63rd: " + (g.t - T0));
  near(g.t - T0, 457 + 463, 2, "Kenwood & 63rd's live time + the scheduled ride");
  ok(out.every((x, k) => k === 0 || x.t >= out[k - 1].t), "in order");
});

test("busTimes: Apostolic/Drexel bus 4317, its current and next trip merged; filler stops estimated between real times", () => {
  _resetEta();
  const S = real(), out = busTimes(S, busOf(S, "4317"), NOW, ride), by = Object.fromEntries(out.map((x) => [x.stopId, x]));
  eq(out.filter((x) => x.kind === "live").map((x) => [x.stopId, x.t - T0]),
    [["8612", 24], ["8615", 636], ["8617", 668], ["8609", 704], ["8630", 778], ["8611", 909], ["8614", 1044], ["133007", 1324]]);
  eq([by["8613"].kind, by["8616"].kind], ["est", "est"]);
  ok(by["8613"].t > T0 + 24 && by["8613"].t < T0 + 636, "Wyler between Goldblatt and Bernard Mitchell");
  ok(by["8616"].t > T0 + 636 && by["8616"].t < T0 + 668);
  ok(by["8613"].t - T0 !== 26, "never the filler +2 s");
});

test("busTimes: a line with no trip update at all (Red Line/Arts Block) gets estimates from where the bus is", () => {
  _resetEta();
  const S = real(), out = busTimes(S, busOf(S, "4325"), NOW, ride);
  eq(out.length, 11, "every stop of the loop once");
  eq(out[0].stopId, "67598");
  ok(out.every((x) => x.kind === "est"), "all estimates");
  ok(out.every((x, k) => k === 0 || x.t > out[k - 1].t), "increasing");
  near(out[out.length - 1].t - out[0].t, 900 - 33, 10, "a lap minus the last segment, by the scheduled segments");
  eq(busTimes(S, busOf(S, "4325"), NOW, () => null), [], "no ride data: nothing invented");
});

test("busTimes: a line route lists only the stops ahead; off-list, transitioning and bad buses give []", () => {
  _resetEta();
  const S = { routeStops: { L: ["a", "b", "c", "d"] }, stops: {}, trips: [], buses: [], service: {} };
  const b = { vehicle: { id: "v" }, trip: { trip_id: "t", route_id: "L" }, stop_id: "c", position: {} };
  const r1 = (rid, x, y) => ({ a: 0, b: 1, c: 2, d: 3 }[y] - { a: 0, b: 1, c: 2, d: 3 }[x]);
  eq(busTimes(S, b, NOW, r1).map((x) => [x.stopId, x.idx]), [["c", 2], ["d", 3]]);
  eq(busTimes(S, { ...b, stop_id: "zz" }, NOW, r1), [], "heading to a stop not on its route, no trip update");
  eq(busTimes(S, null, NOW, r1), []);
  eq(busTimes({}, b, NOW, r1), []);
  _resetEta();
  const R = real({ transitioning: ["4326"] });
  eq(busTimes(R, busOf(R, "4326"), NOW, ride), [], "transitioning to a new line: shown without its times");
});

test("busTimes: estimates past the last live time stop once the route is not scheduled then", () => {
  _resetEta();
  // Fri Nov 20 12:37 PM; Apostolic/Drexel listed until 12:44 PM only
  const svc = { routes: { "6126": { days: { fri: { first: "10:00", last: "12:44" } }, exceptions: [] } } };
  const S = real({ service: svc }), out = busTimes(S, busOf(S, "4318"), NOW, ride);
  const end = T0 + (12 * 60 + 44) * 60 - (12 * 3600 + 37 * 60 + 17);
  eq(out.map((x) => x.stopId), ["8611", "8614", "133007"], "the tail after Kenwood & 63rd's live time (12:44 PM) is left out");
  ok(out.every((x) => x.kind === "live" || x.t < end || out.indexOf(x) <= 2), "no estimate after the end past the last live time");
  eq(out.find((x) => x.stopId === "133007").kind, "live", "the live time stays");
});

test("stationTimes: live rows, an est. row for each bus without one; a time out of travel order gives way", () => {
  _resetEta();
  const S = real();
  const g = at(S, "8612", { routeId: "6126" });
  eq(g.map((x) => [x.vehicleId, x.kind]), [["4317", "live"], ["4318", "est"]], "Goldblatt: Bus 4317 live, 4318 estimated (its +3 min was out of order)");
  eq(g[0].t, T0 + 24);
  eq(Object.keys(g[0]).sort(), ["bus", "kind", "rid", "t", "tripId", "vehicleId"]);
  const w = at(S, "8613", { routeId: "6126" });
  eq(w.map((x) => x.kind), ["est", "est"], "Wyler had only filler times: two estimates");
  ok(w[0].t < w[1].t && w[0].vehicleId === "4317");
  eq(at(S, "8596", { routeId: "4346" }).map((x) => [x.kind, x.t - T0]), [["live", 752]], "Harper Court: the live head, no extra est. row");
  eq(at(S, "8811", { routeId: "4346" }).map((x) => x.kind), ["est"], "53rd & Kenwood: filler before, an estimate now");
  eq(at(S, "8612", { hidden: ["6126"] }).map((x) => x.rid), ["4346"], "hidden routes left out");
  eq(at(S, "8612").map((x) => x.rid).sort(), ["4346", "6126", "6126"], "every route at the stop");
  eq(at(S, "nope"), []);
  eq(stationTimes(null, "8612", { now: NOW }), []);
});

test("busTimes + stationTimes: the next trip's time at a stop just ahead is its next lap, not this one", () => {
  _resetEta();
  const T = NOW, r1 = () => 1;
  // loop a > b > c > a; the bus is on trip t1 heading to b; its next trip t2 (from a) lists c in 30 min
  const S = { routeStops: { R: ["a", "b", "c", "a"] }, stops: {}, service: {},
    buses: [{ vehicle: { id: "v", label: "7" }, trip: { trip_id: "t1", route_id: "R" }, stop_id: "b", position: {} }],
    trips: [{ trip: { trip_id: "t1", route_id: "R" }, vehicle: { id: "v", label: "7" }, stop_time_update: [{ stop_id: "b", arrival: { time: T + 60 } }] },
      { trip: { trip_id: "t2", route_id: "R" }, vehicle: { id: "v", label: "7" }, stop_time_update: [{ stop_id: "c", arrival: { time: T + 1800 } }] }] };
  eq(busTimes(S, S.buses[0], T, r1).map((x) => [x.stopId, x.kind, x.t - T]), [["b", "live", 60], ["c", "est", 120], ["a", "est", 180]],
    "c this lap is an estimate after b");
  eq(stationTimes(S, "c", { now: T, ride: r1 }).map((x) => [x.kind, x.t - T]), [["est", 120], ["live", 1800]], "the next lap's live row stays after it");
  // the next trip's own first stops are this lap's
  S.trips[1].stop_time_update.unshift({ stop_id: "a", arrival: { time: T + 300 } });
  _resetEta();
  eq(busTimes(S, S.buses[0], T, r1).map((x) => [x.stopId, x.kind, x.t - T]), [["b", "live", 60], ["c", "est", 180], ["a", "live", 300]]);
  // no update of its current trip: every entry may be this lap's
  S.trips.shift();
  S.trips[0].stop_time_update = [{ stop_id: "c", arrival: { time: T + 240 } }];
  _resetEta();
  eq(busTimes(S, S.buses[0], T, r1).find((x) => x.stopId === "c"), { stopId: "c", idx: 2, t: T + 240, kind: "live" });
});

test("busTimes: the real 4318 pattern of 1 PM, a next-lap time at its very next stop does not hide its six real times", () => {
  _resetEta();
  const T = NOW, u = (seq, id, dt) => ({ stop_sequence: seq, stop_id: id, arrival: { time: T + dt } });
  const S = real({ buses: [{ ...busOf(real(), "4318"), stop_id: "8613", trip: { trip_id: "501470", route_id: "6126" } }],
    trips: [{ trip: { trip_id: "501470", route_id: "6126" }, vehicle: { id: "4318", label: "1652" },
      stop_time_update: [u(3, "8615", 9), u(4, "8616", 36), u(5, "8617", 46), u(7, "8630", 148), u(8, "8611", 297), u(11, "133007", 601)] },
    { trip: { trip_id: "501471", route_id: "6126" }, vehicle: { id: "4318", label: "1652" }, stop_time_update: [u(2, "8613", 1835)] }].map(markFiller) });
  const out = busTimes(S, S.buses[0], T, ride);
  eq(out.filter((x) => x.kind === "live").map((x) => x.stopId), ["8615", "8616", "8617", "8630", "8611", "133007"]);
  eq(out[0].stopId, "8613"); eq(out[0].kind, "est");
  ok(out[0].t <= T + 9, "Wyler before Bernard Mitchell");
});

test("stationTimes: a transitioning bus has no time at all", () => {
  _resetEta();
  const S = real({ transitioning: ["4317"] });
  eq(at(S, "8612", { routeId: "6126" }).map((x) => x.vehicleId), ["4318"]);
});

test("scheduledAt: the next timetable time at the stop, null without a timetable", () => {
  _resetEta();
  const mid = T0 - (12 * 3600 + 37 * 60 + 17);   // Chicago midnight of Fri Nov 20
  const tt = { v: 1, feed: { start: "2026-11-08", end: "2026-12-09" }, services: { S: { days: "1111111", start: "2026-01-01", end: "2027-12-31" } }, dates: {},
    routes: { "5699": [{ stops: routeStops["5699"], t: [0, 79, 103, 143, 351, 407, 485, 528, 608, 665, 867, 900], starts: { S: [45000, 46800] } }] } };
  const S = { timetable: tt };
  eq(scheduledAt(S, "5699", "138836", T0), { t: mid + 45000 + 867, kind: "sched" }, "the 12:30 trip at Midway Plaisance, 12:44 PM");
  eq(scheduledAt(S, "5699", "67600", T0), { t: mid + 46800 + 143, kind: "sched" }, "the 12:30 trip passed it: the 1:00 trip");
  eq(scheduledAt(S, "5699", "67598", T0).t, mid + 45000 + 900, "the loop's end stop: the 12:30 trip arriving back");
  eq(scheduledAt({}, "5699", "67600", T0), null, "not loaded");
  eq(scheduledAt(S, "1075", "67600", T0), null, "route not in it");
  eq(scheduledAt(S, "5699", "zzz", T0), null, "stop not on it");
  eq(scheduledAt(S, "5699", "67600", mid + 86400 * 400), null, "nothing in the next 4 hours past the timetable's services");
});

test("timeWords: live, est. and Scheduled words, the screen reader sentence and one place for the words", () => {
  eq(ETA_WORDS, { est: "est.", sched: "Scheduled", estSay: "estimated", schedSay: "scheduled, not live" });
  ok(ETA_NOTES.est.startsWith("est. = ") && ETA_NOTES.sched.startsWith("Scheduled = "));
  ok(Object.values(ETA_NOTES).every((s) => !/[–—]|·.*·/.test(s)), "no dash characters, no stacked dots");
  const T = 1_800_000_000;
  eq(timeWords({ t: T + 190, kind: "live" }, T), { text: "3 min", tag: "", say: "in 3 min", now: false });
  eq(timeWords({ t: T + 20, kind: "live" }, T), { text: "Now", tag: "", say: "now", now: true });
  eq(timeWords({ t: T + 190, kind: "live" }, T, true), { text: "~3 min", tag: "", say: "in about 3 min", now: false });
  eq(timeWords({ t: T + 310 }, T).text, "5 min", "no kind = live");
  eq(timeWords({ t: T + 310, kind: "est" }, T), { text: "~5 min", tag: "est.", say: "in about 5 min, estimated", now: false });
  eq(timeWords({ t: T + 10, kind: "est" }, T).text, "~1 min", "an estimate never says Now");
  eq(timeWords({ t: T + 3600, kind: "sched" }, T), { text: clock(T + 3600), tag: "Scheduled", say: `scheduled ${clock(T + 3600)}, not live`, now: false });
  eq(timeWords(null, T), null);
  eq(timeWords({ t: NaN }, T), null);
});

test("real feed: every station of the three lines gets a time; 53rd Street Express no longer shows one minute at many stops", () => {
  _resetEta();
  const S = real();
  for (const rid of ["4346", "6126", "5699"]) {
    const ids = [...new Set(routeStops[rid])];
    const rows = ids.map((id) => at(S, id, { routeId: rid })[0]);
    ok(rows.every(Boolean), rid + ": a time at every station");
  }
  const ids = [...new Set(routeStops["4346"])], mins = ids.map((id) => Math.floor((at(S, id, { routeId: "4346" })[0].t - NOW) / 60));
  const most = Math.max(...[...new Set(mins)].map((m) => mins.filter((x) => x === m).length));
  ok(most <= 2, "at most two stations share a minute (was 14 at one): " + mins);
});

// Tests for core/transition.js (the trip updates of buses that left the feed while Passio still predicts them are
// dropped) and its use in data/live.js. Synthetic cases plus real feed polls from the archive
// (fixtures/transition_golden.json, made by experiments/routeknower/E29-scripts/make_golden.py; the iOS Kit
// TransitionTests replays the same file).
import { test, eq, ok } from "./lib.js";
import { GONE_S, FRESH_S, SPARSE_S, KEEP_S, goneStep, heldStep } from "../js/core/transition.js";
import { startLive } from "../js/data/live.js";
import { createStore } from "../js/core/store.js";

const T0 = 1791997200;               // Wed 2026-10-14 12:00 Chicago (CDT)
const veh = (id, ts) => ({ vehicle: { id }, trip: { trip_id: "t-" + id, route_id: "A" }, position: { latitude: 41.79, longitude: -87.6 }, timestamp: ts });
const tu = (id, t) => ({ trip: { trip_id: "t-" + id, route_id: "A" }, vehicle: { id }, stop_time_update: [{ stop_id: "S", arrival: { time: t } }] });

/** Poll every `every` s from t0 to t1: vehicles(t) and trips(t) -> [t, gone ids]. */
function run(t0, t1, vehicles, trips, { every = 10, seen = {} } = {}) {
  const out = [];
  for (let t = t0; t <= t1; t += every) {
    const r = goneStep(seen, vehicles(t), trips(t), { feedTs: t, nowS: t });
    seen = r.seen;
    out.push([t, r.gone]);
  }
  return out;
}
const firstGone = (rows, id) => { const r = rows.find((x) => x[1].includes(id)); return r ? r[0] : null; };

test("transition: constants are the measured rule (RouteKnower E29)", () => {
  eq([GONE_S, FRESH_S, SPARSE_S, KEEP_S], [900, 300, 120, 21600]);
});

test("transition: a bus silent for 15 min while Passio predicts it is gone; back the moment it reports", () => {
  const left = T0 + 600;                                   // "x" stops reporting at 12:10, "y" keeps reporting
  const rows = run(T0, T0 + 3600, (t) => [veh("y", t), ...(t <= left ? [veh("x", t)] : [])], (t) => [tu("x", t + 300), tu("y", t + 120)]);
  eq(firstGone(rows, "x"), left + GONE_S, "gone exactly 15 min after its last report");
  ok(rows.every(([, g]) => !g.includes("y")), "the reporting bus never");
  const back = run(T0, T0 + 3600, (t) => [veh("y", t), ...(t <= left || t >= T0 + 2400 ? [veh("x", t)] : [])], (t) => [tu("x", t + 300), tu("y", t + 120)]);
  eq(back.find(([t]) => t === T0 + 2400)[1], [], "it reported again: not gone");
  eq(back.find(([t]) => t === T0 + 2390)[1], ["x"]);
});

test("transition: a whole-feed silence (outage, the empty overnight feed) drops nothing", () => {
  const rows = run(T0, T0 + 3600, (t) => (t <= T0 + 600 ? [veh("x", t), veh("y", t)] : []), (t) => [tu("x", t + 300), tu("y", t + 300)]);
  ok(rows.every(([, g]) => g.length === 0), "no fresh vehicle at all: nothing dropped");
  const ghosts = run(T0, T0 + 3600, (t) => [veh("x", Math.min(t, T0 + 600)), veh("y", Math.min(t, T0 + 600))], (t) => [tu("x", t + 300)]);
  ok(ghosts.every(([, g]) => g.length === 0), "only ghosts (old report times): the feed is not alive");
});

test("transition: a bus that reports only every few minutes is never called gone (it drives on unseen)", () => {
  const every5 = (t) => T0 + Math.floor((t - T0) / 300) * 300;      // reports every 5 min ...
  const rows = run(T0, T0 + 3600, (t) => [veh("y", t), veh("s", t < T0 + 1200 ? every5(t) : T0 + 900)],   // ... then 45 min silent
    (t) => [tu("s", t + 300)]);
  ok(rows.every(([, g]) => !g.includes("s")), "last two reports 5 min apart: never");
  const fast = run(T0, T0 + 3600, (t) => [veh("y", t), veh("s", Math.min(t, T0 + 900))], (t) => [tu("s", t + 300)]);
  eq(firstGone(fast, "s"), T0 + 900 + GONE_S, "the same silence after reports every 10 s: gone");
});

test("transition: a prediction for a bus the app never saw starts its clock (late drop, never early)", () => {
  const rows = run(T0, T0 + 2400, (t) => [veh("y", t)], (t) => [tu("ghost", t + 300)]);
  eq(firstGone(rows, "ghost"), T0 + GONE_S, "15 min after the app first saw its prediction");
  const r = goneStep({}, [veh("y", T0), veh("old", T0 - 1200)], [tu("old", T0 + 300)], { feedTs: T0 });
  eq(r.gone, ["old"], "a ghost in the feed counts with its own report time: gone at once");
  eq(goneStep({}, [veh("y", T0)], [{ trip: { trip_id: "q" }, stop_time_update: [] }], { feedTs: T0 }).gone, [], "no vehicle id: kept");
});

test("transition: seen is carried, pruned after KEEP_S unless still predicted, and the input is not modified", () => {
  const prev = Object.freeze({ a: Object.freeze({ t: T0 - KEEP_S - 1, dt: 10 }), b: Object.freeze({ t: T0 - KEEP_S - 1, dt: 10 }) });
  const r = goneStep(prev, [veh("y", T0)], [tu("b", T0 + 60)], { feedTs: T0 });
  ok(!("a" in r.seen) && "b" in r.seen, "a forgotten, b (predicted) kept");
  eq(r.gone, ["b"]);
  eq(goneStep({ x: { t: T0 - 20, dt: 10 } }, [veh("x", T0)], [], { feedTs: T0 }).seen.x, { t: T0, dt: 20 }, "dt = time between its last two reports");
  eq(goneStep({ x: { t: T0 - 999, dt: 0, p: 1 } }, [veh("x", T0)], [], { feedTs: T0 }).seen.x, { t: T0, dt: 0 }, "a predicted-only clock gives way to its first report");
  eq(goneStep(null, null, null, {}).gone, []);
});

test("transition: HELD keeps a hidden bus's times off after it stops reporting, until it reports unhidden (owner 2026-11-11)", () => {
  const b = (id, ts) => veh(id, ts);
  let r = heldStep({}, [b("x", T0), b("y", T0)], ["x"], [tu("x", T0 + 300)], { feedTs: T0 });
  eq(r.ids, [], "hidden now: the rule drops it, held has nothing more to drop");
  eq(r.held, { x: { t: T0 } }, "held from its report time");
  r = heldStep(r.held, [b("y", T0 + 400)], [], [tu("x", T0 + 700)], { feedTs: T0 + 400 });
  eq(r.ids, ["x"], "silent 6 min: no longer operating, no rule sees it: its times stay off");
  r = heldStep(r.held, [b("y", T0 + 2000)], [], [tu("x", T0 + 2300)], { feedTs: T0 + 2000 });
  eq(r.ids, ["x"], "past GONE too (a sparse reporter is never gone): still off");
  const again = heldStep(r.held, [b("x", T0 + 2010), b("y", T0 + 2010)], ["x"], [tu("x", T0 + 2300)], { feedTs: T0 + 2010 });
  eq([again.ids, Object.keys(again.held)], [[], ["x"]], "reports again but a rule still hides it: hidden, held");
  const free = heldStep(r.held, [b("x", T0 + 2010), b("y", T0 + 2010)], [], [tu("x", T0 + 2300)], { feedTs: T0 + 2010 });
  eq([free.ids, free.held], [[], {}], "reports again and no rule hides it: its times are back");
  const prev = Object.freeze({ old: Object.freeze({ t: T0 - KEEP_S - 1 }), kept: Object.freeze({ t: T0 - KEEP_S - 1 }) });
  r = heldStep(prev, [b("y", T0)], [], [tu("kept", T0 + 60)], { feedTs: T0 });
  eq(r.ids, ["kept"], "forgotten after KEEP_S unless still predicted; the input is not modified");
  eq(heldStep(null, null, null, null, {}), { held: {}, ids: [] });
});

test("live: a bus hidden off its route that goes silent keeps its times off (E32 offroute_then_silent)", async () => {
  let now = T0;
  const quiet = T0 + 60;                                    // x drives off its line at T0, reports last at T0 + 60
  const on = { latitude: 41.79, longitude: -87.6 }, off = { latitude: 41.79, longitude: -87.58 };   // 1.66 km east
  const vx = () => ({ vehicle: { id: "x" }, trip: { trip_id: "t-x", route_id: "A" }, position: off, timestamp: Math.min(now, quiet) });
  const feeds = () => ({
    vehiclePositions: { header: { timestamp: now }, entity: [{ vehicle: { ...veh("y", now), position: on } }, ...(now - quiet <= 400 ? [{ vehicle: vx() }] : [])] },
    tripUpdates: { header: { timestamp: now }, entity: [{ trip_update: tu("x", now + 300) }, { trip_update: tu("y", now + 120) }] },
    serviceAlerts: { header: { timestamp: now }, entity: [] },
  });
  const fetch = async (url) => {
    const f = feeds(), name = Object.keys(f).find((k) => url.includes(k));
    return { ok: true, status: 200, json: async () => f[name] };
  };
  const shapes = { A: [[[41.79, -87.61], [41.79, -87.59]]] };
  const store = createStore({ routes: { A: { short: "A" } }, service: {}, shapes, staticLoaded: true, buses: [], trips: [], alerts: [], feedTs: 0 });
  const live = startLive(store, { fetch, intervalMs: 600000, now: () => now });
  const tripVehs = () => store.get().trips.map((t) => t.vehicle.id);
  try {
    for (const t of [T0, T0 + 10, T0 + 60]) { now = t; await live.pollNow(); }
    eq(tripVehs(), ["y"], "hidden off its route (FAST): its times are off");
    now = quiet + 360;                                        // no longer operating (5 min), GONE not yet (15 min)
    await live.pollNow();
    eq(tripVehs(), ["y"], "silent 6 min: its times stay off (they came back here before)");
    now = quiet + 1200;
    await live.pollNow();
    eq(tripVehs(), ["y"], "silent 20 min: off");
  } finally { live.stop(); }
});

test("transition real: the shift end and the break dropped 15 min after the bus left; layovers and a sparse bus never", async () => {
  const fx = await (await fetch("fixtures/transition_golden.json", { cache: "no-store" })).json();
  const bad = [], from = {};
  for (const c of fx.cases) {
    let seen = {};
    c.polls.forEach((p, i) => {
      const vehicles = p.v.map(([v, vt]) => ({ vehicle: { id: v }, timestamp: vt }));
      const trips = p.p.map((v) => ({ trip: { trip_id: "t" + v }, vehicle: { id: v }, stop_time_update: [] }));
      const r = goneStep(seen, vehicles, trips, { feedTs: p.h, nowS: p.h });
      seen = r.seen;
      if (JSON.stringify(r.gone) !== JSON.stringify(c.expect[i])) bad.push(`${c.name} poll ${i}: ${r.gone} vs ${c.expect[i]}`);
      for (const v of r.gone) from[c.name + ":" + v] = from[c.name + ":" + v] || p.h;
    });
  }
  eq(bad.slice(0, 5), [], bad.length + " polls differ from the stored answers");
  const at = (k) => from[k] && new Date(from[k] * 1000).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hourCycle: "h23" });
  ok(/^22:3[67]/.test(at("shift_end:4317")), "Central 4317 left at 22:21, Passio kept predicting it 47 min: dropped " + at("shift_end:4317"));
  ok(/^18:1[67]/.test(at("break:12643")), "Downtown Campus Connector 12643 left at 18:01: dropped " + at("break:12643"));
  ok(!Object.keys(from).some((k) => k.startsWith("layover:")), "North 4322's 10 min layover out of the feed: never");
  ok(!from["long_layover:4314"] && !from["long_layover:12647"], "a 15 min layover and a bus reporting every 5 to 20 min: never");
});

test("live: a gone bus's trip updates leave store.trips; the map's buses are untouched", async () => {
  let now = T0;
  const left = T0 + 60;
  const feeds = () => ({
    vehiclePositions: { header: { timestamp: now }, entity: [{ vehicle: veh("y", now) }, { vehicle: veh("x", Math.min(now, left)) }] },
    tripUpdates: { header: { timestamp: now }, entity: [{ trip_update: tu("x", now + 300) }, { trip_update: tu("y", now + 120) }] },
    serviceAlerts: { header: { timestamp: now }, entity: [] },
  });
  const fetch = async (url) => {
    const f = feeds(), name = Object.keys(f).find((k) => url.includes(k));
    return { ok: true, status: 200, json: async () => f[name] };
  };
  const store = createStore({ routes: { A: { short: "A" } }, service: {}, shapes: {}, staticLoaded: true, buses: [], trips: [], alerts: [], feedTs: 0 });
  const live = startLive(store, { fetch, intervalMs: 600000, now: () => now });
  const tripVehs = () => store.get().trips.map((t) => t.vehicle.id);
  await live.pollNow();
  eq(tripVehs(), ["x", "y"]);
  now = left + GONE_S - 10;
  await live.pollNow();
  eq(tripVehs(), ["x", "y"], "silent 14 min 50 s: kept");
  eq(store.get().buses.map((b) => b.vehicle.id), ["y"], "(not on the map: core/operating.js, report > 5 min old)");
  now = left + GONE_S;
  await live.pollNow();
  live.stop();
  eq(tripVehs(), ["y"], "silent 15 min: its arrival times are gone");
});

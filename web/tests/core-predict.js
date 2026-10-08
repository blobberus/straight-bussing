// Tests for core/predict.js
import { test, eq, ok, near } from "./lib.js";
import { createPredict, howBucket, predict } from "../js/core/predict.js";

const segments = { v: 1, routes: { R: { seg: [60, 120, 180], dwell: 10 }, LP: { seg: [60, 60, 60] } } };
const routeStops = { R: ["a", "b", "c", "d"], LP: ["x", "y", "z", "x"] };
const MON_10 = Date.UTC(2026, 9, 5, 15, 0, 0) / 1000; // Monday 10:00 America/Chicago (CDT)

test("howBucket: Monday=0, America/Chicago, seconds or ms", () => {
  eq(howBucket(MON_10), 10);
  eq(howBucket(MON_10 * 1000), 10);
  eq(howBucket(Date.UTC(2026, 9, 12, 4, 30) / 1000), 167, "Sunday 23:30 CDT");
  eq(howBucket(Date.UTC(2026, 11, 7, 6, 0) / 1000), 0, "Monday 00:00 CST (winter offset)");
});

test("schedule: sums segments plus dwell at intermediate stops", () => {
  const P = createPredict({ segments, routeStops });
  const r = P.rideMinutes("R", "a", "c", MON_10);
  near(r.min, 190 / 60, 0.01);
  eq(r.source, "schedule");
  eq(r.conf, 0.4);
  ok(!("p10" in r), "no quantiles without a learned model");
  near(P.rideMinutes("R", "b", "d").min, 310 / 60, 0.01);
});

test("schedule: non-loop backwards, same stop, unknowns -> min null", () => {
  const P = createPredict({ segments, routeStops });
  eq(P.rideMinutes("R", "c", "a").min, null);
  eq(P.rideMinutes("R", "a", "a").min, null);
  eq(P.rideMinutes("NOPE", "a", "b").min, null);
  eq(P.rideMinutes("R", "zz", "b").min, null);
  eq(P.rideMinutes("LP", "x", "x").min, null);
});

test("loop routes wrap", () => {
  const P = createPredict({ segments, routeStops });
  near(P.rideMinutes("LP", "z", "y").min, 2, 0.01, "z->x->y");
  near(P.rideMinutes("LP", "y", "x").min, 2, 0.01, "y->z->x");
  near(P.rideMinutes("LP", "x", "z").min, 2, 0.01);
});

const learnedV2 = {
  v: 2, k: 5, sigma: 0.25,
  routes: { R: { s: { 0: { a: [120, 45, 90, 160, 0.2], h: { 10: [240, 10] } } }, dw: 20 } },
};

test("learned v2: all-hours median shrunk toward schedule, quantiles scaled", () => {
  const P = createPredict({ segments, routeStops, learned: learnedV2 });
  const r = P.rideMinutes("R", "a", "b", MON_10 + 86400); // Tuesday 10:00 -> bucket 34 absent
  near(r.min, 114 / 60, 0.01); // 0.9*120 + 0.1*60
  eq(r.source, "learned");
  near(r.conf, 0.9, 0.001);
  near(r.p10, (90 * 114 / 120) / 60, 0.01);
  near(r.p90, (160 * 114 / 120) / 60, 0.01);
  ok(r.p10 <= r.min && r.min <= r.p90);
});

test("learned v2: hour-of-week bucket used when present", () => {
  const P = createPredict({ segments, routeStops, learned: learnedV2 });
  const r = P.rideMinutes("R", "a", "b", MON_10);
  near(r.min, (0.9 * 240 + 0.1 * 60) / 60, 0.01);
});

test("learned: mixed learned+schedule segments, learned dwell after learned segment", () => {
  const P = createPredict({ segments, routeStops, learned: learnedV2 });
  const r = P.rideMinutes("R", "a", "c", MON_10 + 86400);
  near(r.min, (114 + 20 + 120) / 60, 0.01);
  eq(r.source, "learned");
  ok(r.p10 < r.min && r.p90 > r.min, "quantiles span the estimate");
  near(r.conf, 0.45 + 0.5 * (0.9 / 2), 0.006);
});

test("learned v1 format ([med, n] only) uses global sigma for quantiles", () => {
  const P = createPredict({ segments, routeStops, learned: { v: 1, routes: { R: { s: { 0: { a: [120, 5] } } } } } });
  const r = P.rideMinutes("R", "a", "b", MON_10);
  near(r.min, 90 / 60, 0.01); // w = 0.5
  ok(r.p10 < r.min && r.p90 > r.min);
  near(r.p90, (90 * Math.exp(1.2816 * 0.3)) / 60, 0.02);
});

test("never throws on garbage", () => {
  const P = createPredict({ segments: "x", routeStops: 5, learned: { routes: null } });
  eq(P.rideMinutes("R", "a", "b").min, null);
  const Q = createPredict({ segments: { routes: { R: { seg: ["bad", null] } } }, routeStops: { R: ["a", "b", "c"] }, learned: { routes: { R: { s: { 0: { a: "junk" } } } } } });
  eq(Q.rideMinutes("R", "a", "c").min, null);
  eq(Q.rideMinutes(null, undefined, {}).min, null);
  const E = createPredict();
  eq(E.rideMinutes("R", "a", "b").min, null);
  eq(E.etaAdjust("R", "a", 5).min, 5);
});

test("etaAdjust applies bias only with n >= 30", () => {
  const P = createPredict({ segments, routeStops, learned: { routes: {}, bias: { R: { m: 1.5, a: 60, n: 100 }, S: { m: 2, n: 5 } } } });
  const r = P.etaAdjust("R", "a", 4);
  near(r.min, 7, 0.001);
  eq(r.source, "learned");
  eq(P.etaAdjust("S", "a", 4), { min: 4, source: "schedule", conf: 0.3 });
  eq(P.etaAdjust("R", "a", "4").min, "4");
});

test("shared predict loads web/data and answers for a real route", async () => {
  await predict.ready;
  const r0 = await fetch("../data/route_stops.json").then((r) => r.json());
  const rid = Object.keys(r0).find((k) => r0[k].length > 3);
  const r = predict.rideMinutes(rid, r0[rid][0], r0[rid][2]);
  ok(typeof r.min === "number" && r.min > 0, "got " + JSON.stringify(r));
  ok(r.source === "schedule" || r.source === "learned");
});

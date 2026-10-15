// core/coverage.js: the shuttle area, 800 m from a stop a route serves (owner 2026-10-15).
import { test, eq, ok } from "./lib.js";
import { covered, COVER_M, COVER_TEXT, COVER_ADVICE } from "../js/core/coverage.js";

// A served at 41.79 N; O 0.01 deg (about 1.1 km) north and served by no route
const state = { stops: { A: { name: "A", lat: 41.79, lon: -87.6 }, O: { name: "O", lat: 41.8, lon: -87.6 } }, routeStops: { R: ["A"] } };
const north = (m) => ({ lat: 41.79 + m / 111195, lon: -87.6 });

test("coverage: within 800 m of a served stop, a stop itself always", () => {
  eq(COVER_M, 800);
  ok(covered(state, north(0)), "at the stop");
  ok(covered(state, north(500)), "500 m");
  ok(covered(state, north(790)), "790 m");
  ok(!covered(state, north(900)), "900 m");
  ok(covered(state, { lat: 50, lon: 50, stop: "X" }), "a stop endpoint is never refused");
});

test("coverage: only stops some route serves count; no route list = every stop", () => {
  ok(!covered(state, { lat: 41.8, lon: -87.6 }), "next to an unserved stop, 1.1 km from A");
  ok(covered({ ...state, routeStops: {} }, { lat: 41.8, lon: -87.6 }), "no route list: O counts");
});

test("coverage: never blocks on missing data or a point without coordinates", () => {
  ok(covered({}, north(5000)), "schedule not loaded");
  ok(covered({ stops: {} }, north(5000)), "no stops");
  ok(covered(state, null), "no endpoint");
  ok(covered(state, { lat: NaN, lon: -87.6 }), "bad coordinates");
});

test("coverage: the owner's sentences, plain (800 m, no UGo, no en or em dash)", () => {
  eq(COVER_TEXT, "Sorry, Straight Bussing only covers locations within 800 m of the campus shuttle routes.");
  eq(COVER_ADVICE, "Straight Bussing recommends changing to another mode of transportation after arriving at the closest destination.");
  for (const s of [COVER_TEXT, COVER_ADVICE]) ok(!/[\u2013\u2014]/.test(s) && !/UGo/i.test(s), s);
});

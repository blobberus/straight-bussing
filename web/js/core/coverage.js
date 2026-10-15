/**
 * @module core/coverage
 * The area the shuttles cover (owner 2026-10-15): within COVER_M, straight line, of a stop that a route serves. A
 * destination outside it is still searched and planned as usual (the planner's 1600 m end walk, else walk the whole
 * way), with COVER_TEXT and COVER_ADVICE above the trip options (ui/views/directions.js; owner, later the same day:
 * "Change the 800m+ distance restriction to telling the user about the constraint, but still giving a method to reach
 * the location"). Only destinations: a start far away gets no note. Pure, no DOM.
 * iOS: Kit Coverage.swift.
 */
import { nearestStops } from "./geo.js";

/** Meters from the nearest served stop (the planner's MAX_WALK, the map names' COVER_M). */
export const COVER_M = 800;

/** Owner's wording, without "UGo" (the app uses no UChicago or UGo names of its own). */
export const COVER_TEXT = "Sorry, Straight Bussing only covers locations within 800 m of the campus shuttle routes.";

/** Under COVER_TEXT, then the trip options (owner's words). */
export const COVER_ADVICE = "Straight Bussing recommends changing to another mode of transportation after arriving at the closest destination.";

/**
 * Whether a destination is in the covered area. A stop always is; so is anything before the schedule has loaded
 * (never block on missing data) or a point without valid coordinates (nothing to judge).
 * @param {{stops?:Object, routeStops?:Object}} state
 * @param {{lat:number, lon:number, stop?:string|null}|null} p
 * @returns {boolean}
 */
export function covered(state, p) {
  if (!p || p.stop || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return true;
  const stops = state?.stops;
  if (!stops || !Object.keys(stops).length) return true;
  const rs = state.routeStops && Object.keys(state.routeStops).length ? state.routeStops : undefined;
  return nearestStops(stops, p, { max: 1, maxM: COVER_M, routeStops: rs }).length > 0;
}

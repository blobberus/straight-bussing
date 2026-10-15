/**
 * @module core/coverage
 * The area Straight Bussing plans trips to (owner 2026-10-15: "If a search query for destination doesn't have a
 * proper stop or address within range, say: Sorry, ..."): within COVER_M, straight line, of a stop that a route
 * serves. A destination outside it gets COVER_TEXT instead of place suggestions or trip options (ui/views/directions.js).
 * Only destinations: a start far away still plans (the planner's 1600 m end walk). Pure, no DOM.
 * iOS: Kit Coverage.swift.
 */
import { nearestStops } from "./geo.js";

/** Meters from the nearest served stop (the planner's MAX_WALK, the map names' COVER_M). */
export const COVER_M = 800;

/** Owner's wording, without "UGo" (the app uses no UChicago or UGo names of its own). */
export const COVER_TEXT = "Sorry, Straight Bussing only covers locations within 800 m of the campus shuttle routes.";

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

/**
 * @module ui/views/route
 * Route detail: status line (buses running), stop timeline in route order with the next ETA per stop
 * and inline bus markers where a bus is heading. The map focuses on the route (main.js passes
 * store.routeId as focus to drawNetwork); route:open also fits the map to the route shape.
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc, safeColor, textOn } from "../../core/esc.js";
import { nowS, minsUntil } from "../../core/time.js";
import { arrivalsFor, staleLevel, runningCount } from "../../core/arrivals.js";
import { emptyState, skeleton } from "../components.js";
import { OFFICIAL_HTML } from "./pick.js";

/**
 * Ordered unique stop ids of a route (a loop's repeated last stop is dropped).
 * @param {string[]} list routeStops[rid]
 * @returns {string[]}
 */
export function stopOrder(list) {
  const out = [];
  for (const id of list || []) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * ETA label for the timeline.
 * @param {number|undefined} t unix seconds
 * @param {number} now
 * @param {boolean} stale
 * @returns {string}
 */
export function etaLabel(t, now, stale) {
  if (!t) return "";
  const m = minsUntil(t, now);
  return m < 1 ? "Now" : (stale ? "~" : "") + m + " min";
}

/**
 * Render the route view.
 * @param {object} state store state (routeId selects the route)
 * @param {number} [now] unix seconds
 * @returns {string}
 */
export function renderRoute(state, now = nowS()) {
  if (!state.staticLoaded) return skeleton(6);
  const rid = state.routeId, r = state.routes?.[rid];
  if (!r) return emptyState("Route not found", "This route is not in the current schedule.") + '<button type="button" class="v-btn v-btn--secondary v-btn--block" data-action="route:all">See all routes</button>';
  const color = safeColor(r.color), n = runningCount(state, rid), hidden = (state.hiddenRoutes || []).includes(rid);
  const stale = staleLevel(state, now) !== "";
  const ids = stopOrder(state.routeStops?.[rid]);
  const busAt = new Map();
  for (const b of state.buses || []) {
    if (b?.trip?.route_id !== rid || !b.stop_id) continue;
    if (!busAt.has(b.stop_id)) busAt.set(b.stop_id, []);
    busAt.get(b.stop_id).push(b.vehicle?.label || b.vehicle?.id || "");
  }
  let h = '<div class="v-route">';
  h += `<p class="v-status">${n ? '<span class="v-livedot" aria-hidden="true"></span>' : ""}${n ? `${n} bus${n > 1 ? "es" : ""} running` : "Not running right now"}${r.short && r.long ? ` &middot; <span class="v-sec">${esc(r.short)}</span>` : ""}</p>`;
  if (hidden) h += `<div class="v-note"><span class="v-grow v-sec">This route is hidden from the map and arrival times.</span><button type="button" class="v-btn v-btn--quiet" data-action="routes:toggle" data-id="${esc(rid)}">Show</button></div>`;
  if (!n && state.liveLoaded && !(state.buses || []).length) h += OFFICIAL_HTML;
  if (!ids.length) return h + emptyState("No stops listed", "The schedule has no stops for this route.") + "</div>";
  const fg = textOn(color);
  h += `<ol class="v-tl" style="--rc:${color}" aria-label="Stops on ${esc(r.long || r.short || "route")}">`;
  for (const sid of ids) {
    const a = state.liveLoaded ? arrivalsFor(state, sid, { routeId: rid, nowS: now })[0] : null;
    const eta = etaLabel(a?.t, now, stale), name = state.stops?.[sid]?.name || sid;
    const buses = busAt.get(sid) || [];
    const busHtml = buses.length ? `<span class="v-tlbus" style="background:${color};color:${fg}">Bus ${esc(buses.join(", "))} heading here</span>` : "";
    const label = `${name}${eta ? ", next bus " + (eta === "Now" ? "now" : "in " + eta.replace("~", "about ")) : ", no prediction"}${buses.length ? ", a bus is heading here" : ""}`;
    h += `<li class="v-tlstop${buses.length ? " has-bus" : ""}"><button type="button" class="v-tlbtn" data-action="stop:open" data-id="${esc(sid)}" aria-label="${esc(label)}"><span class="v-grow"><span class="v-prim">${esc(name)}</span>${busHtml}</span><span class="v-tleta${eta === "Now" ? " is-now" : ""}">${esc(eta)}</span></button></li>`;
  }
  h += "</ol>";
  if (state.liveLoaded) h += `<p class="v-foot">${stale ? "Live data delayed. Times may be off." : "Times are live predictions."}</p>`;
  return h + "</div>";
}

registerView("route", {
  title: (state) => state.routes?.[state.routeId]?.long || state.routes?.[state.routeId]?.short || "Route",
  parent: "routes",
  detent: "half",
  tab: "routes",
  render: (state) => renderRoute(state),
});

registerAction("route:open", (ds, ev, ctx) => {
  const s = ctx.store.get();
  if (!s.routes?.[ds.id]) return;
  ctx.navigate("route", { routeId: ds.id });
  const pts = (s.shapes?.[ds.id] || []).flat();
  if (pts.length) try { ctx.map?.fitTo?.(pts, { maxZoom: 16 }); } catch (e) { /* map optional */ }
});
registerAction("route:all", (ds, ev, ctx) => ctx.navigate("routes"));

/**
 * @module ui/views/routes
 * Routes list: top actions "Routes to station..." (primary) and "Directions"; optional filter chip
 * "Routes to <station> x"; Running / Not running / Hidden groups; per-route eye toggle that writes
 * store.hiddenRoutes (persisted by state.js; honored by map, arrivals and Nearby).
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { runningCount } from "../../core/arrivals.js";
import { routeChip, emptyState, skeleton } from "../components.js";
import { OFFICIAL_HTML } from "./pick.js";

const EYE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYEOFF = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" opacity=".45"/><circle cx="12" cy="12" r="3" opacity=".45"/><path d="M3 3l18 18"/></svg>';

/**
 * Route ids sorted by short name (numeric aware), restricted to the active station filter.
 * @param {object} state
 * @returns {string[]}
 */
export function routeIds(state) {
  const R = state.routes || {};
  let ids = Object.keys(R).sort((a, b) => String(R[a].short || R[a].long || a).localeCompare(String(R[b].short || R[b].long || b), undefined, { numeric: true }));
  const f = state.routeFilter;
  if (f && Array.isArray(f.ids)) ids = ids.filter((i) => f.ids.includes(i));
  return ids;
}

/**
 * Group routes into running / not running / hidden.
 * @param {object} state
 * @returns {{running:string[], idle:string[], hidden:string[]}}
 */
export function groupRoutes(state) {
  const hiddenSet = new Set(state.hiddenRoutes || []), out = { running: [], idle: [], hidden: [] };
  for (const id of routeIds(state)) {
    if (hiddenSet.has(id)) out.hidden.push(id);
    else if (runningCount(state, id) > 0) out.running.push(id);
    else out.idle.push(id);
  }
  return out;
}

/**
 * The "Routes to <station> x" chip, or '' when no filter is active.
 * @param {object} state
 * @returns {string}
 */
export function filterChipHTML(state) {
  const f = state.routeFilter;
  if (!f) return "";
  return `<div class="v-fchip" role="status"><span class="v-fchip-t">Routes to ${esc(f.label || "station")}</span><button type="button" class="v-fchip-x" data-action="routes:clear-filter" aria-label="Clear station filter, show all routes"><span aria-hidden="true">&times;</span></button></div>`;
}

function row(state, id, hidden) {
  const r = state.routes[id] || {}, n = runningCount(state, id), name = r.long || r.short || id;
  const status = hidden ? "Hidden from map and times" : n ? `${n} bus${n > 1 ? "es" : ""} running` : "Not running";
  return `<div class="v-routerow${hidden ? " is-off" : ""}"><button type="button" class="v-row v-rowmain" data-action="route:open" data-id="${esc(id)}">${routeChip(id, state.routes)}<span class="v-grow"><span class="v-prim">${esc(name)}</span><span class="v-sec">${n && !hidden ? '<span class="v-livedot" aria-hidden="true"></span>' : ""}${esc(status)}</span></span></button>`
    + `<button type="button" class="v-eye" data-action="routes:toggle" data-id="${esc(id)}" aria-pressed="${hidden ? "false" : "true"}" aria-label="${hidden ? "Show" : "Hide"} route ${esc(r.short || "")} ${esc(name)}">${hidden ? EYEOFF : EYE}</button></div>`;
}

/**
 * Render the routes list.
 * @param {object} state
 * @returns {string}
 */
export function renderRoutes(state) {
  const top = '<div class="v-actions"><button type="button" class="v-btn v-btn--primary" data-action="pick:open">Routes to station&hellip;</button><button type="button" class="v-btn v-btn--secondary" data-action="dir:open">Directions</button></div>';
  if (!state.staticLoaded) return top + skeleton(5);
  const g = groupRoutes(state);
  let h = top + filterChipHTML(state);
  const total = g.running.length + g.idle.length + g.hidden.length;
  if (!total) {
    return h + (state.routeFilter ? emptyState("No routes at this station", "Clear the filter to see every route.") : emptyState("No routes", "The schedule data did not load. Reload the app.") + OFFICIAL_HTML);
  }
  if (state.liveLoaded && !(state.buses || []).length && !state.routeFilter) h += emptyState("No shuttles running right now", "Routes are listed below for reference.") + OFFICIAL_HTML;
  const group = (title, ids, hidden, cls) => (ids.length ? `<h3 class="v-h">${title}</h3><div class="v-list${cls ? " " + cls : ""}">${ids.map((i) => row(state, i, hidden)).join("")}</div>` : "");
  h += group("Running", g.running, false, "");
  h += group("Not running", g.idle, false, state.liveLoaded && !(state.buses || []).length ? "is-dim" : "");
  h += group("Hidden", g.hidden, true, "");
  return h;
}

/**
 * Toggle a route's visibility (store.hiddenRoutes; persisted by state.js).
 * @param {object} store
 * @param {string} rid
 * @returns {boolean} true if the route is now hidden
 */
export function toggleRoute(store, rid) {
  const cur = store.get().hiddenRoutes || [];
  const hide = !cur.includes(rid);
  store.set({ hiddenRoutes: hide ? [...cur, rid] : cur.filter((r) => r !== rid) });
  return hide;
}

registerView("routes", {
  title: () => "Routes",
  detent: "half",
  tab: "routes",
  render: (state) => renderRoutes(state),
});

registerAction("routes:toggle", (ds, ev, ctx) => {
  const name = ctx.store.get().routes?.[ds.id]?.long || "Route";
  const hid = toggleRoute(ctx.store, ds.id);
  ctx.toast?.(hid ? `${name} hidden` : `${name} shown`);
});
registerAction("routes:clear-filter", (ds, ev, ctx) => ctx.store.set({ routeFilter: null }));

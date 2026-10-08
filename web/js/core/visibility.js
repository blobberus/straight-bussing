/**
 * @module core/visibility
 * One answer to "which routes does the user see right now", shared by the map, arrivals, Nearby,
 * stop and route lists. Pure functions of store state, no DOM.
 *
 * Precedence: a journey ("only show relevant routes" from Directions / Routes to station) shows only
 * its routes; otherwise store.hiddenRoutes applies (applying a custom route rewrites hiddenRoutes, see
 * core/custom.js). Focus (others dimmed, not hidden) comes from the route detail view, then the
 * journey, then the station filter, then the applied custom route's highlight list.
 */

/**
 * Route ids hidden right now (journey wins over the user's hidden list).
 * @param {{routes?:object, hiddenRoutes?:string[], journey?:{rids:string[]}|null}} state
 * @returns {string[]}
 */
export function effectiveHidden(state) {
  const j = state && state.journey;
  if (j && Array.isArray(j.rids) && j.rids.length) {
    const keep = new Set(j.rids.map(String));
    return Object.keys(state.routes || {}).filter((rid) => !keep.has(rid));
  }
  return (state && state.hiddenRoutes ? state.hiddenRoutes : []).map(String);
}

/**
 * Is this route shown (map, arrivals, lists)?
 * @param {object} state
 * @param {string} rid
 * @returns {boolean}
 */
export function isVisible(state, rid) {
  return !effectiveHidden(state).includes(String(rid));
}

/**
 * The applied custom route object, or null.
 * @param {{customRoutes?:Array, activeCustom?:string|null}} state
 * @returns {{id:string, name:string, rids:string[], highlight:string[]}|null}
 */
export function activeCustomRoute(state) {
  const id = state && state.activeCustom;
  if (!id) return null;
  return (state.customRoutes || []).find((c) => c.id === id) || null;
}

/**
 * Routes to emphasize on the map (others are dimmed), or null for no focus.
 * @param {object} state
 * @returns {string[]|null}
 */
export function mapFocus(state) {
  if (!state) return null;
  if (state.view === 'route' && state.routeId) return [String(state.routeId)];
  if (state.journey && state.journey.rids && state.journey.rids.length) return null;   // already hidden down to these
  const f = state.routeFilter && state.routeFilter.ids;
  if (f && f.length) return f.map(String);
  const c = activeCustomRoute(state);
  return c && c.highlight && c.highlight.length ? c.highlight.slice() : null;
}

/**
 * Draw order for route lines, top-most first: focused routes, then the user's priority list
 * (store.routeOrder), then every other route in data order. Unknown ids are dropped.
 * @param {{routes?:object, routeOrder?:string[]}} state
 * @param {string[]|null} [focus]
 * @returns {string[]}
 */
export function drawOrder(state, focus = null) {
  const all = Object.keys((state && state.routes) || {});
  const known = new Set(all), out = [];
  const add = (rid) => { rid = String(rid); if (known.has(rid) && !out.includes(rid)) out.push(rid); };
  (focus || []).forEach(add);
  ((state && state.routeOrder) || []).forEach(add);
  all.forEach(add);
  return out;
}

/**
 * Everything the map needs to know about visibility, in one call.
 * @param {object} state
 * @returns {{hidden:string[], focus:string[]|null, order:string[]}}
 */
export function mapVisibility(state) {
  const focus = mapFocus(state);
  return { hidden: effectiveHidden(state), focus, order: drawOrder(state, focus) };
}

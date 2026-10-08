/**
 * @module core/custom
 * Custom routes ("My Routes"): named sets of shuttle routes. Every function takes the current store
 * state and returns a PATCH for store.set(...) (or a value); nothing here touches the DOM or storage
 * (state.js persists customRoutes / activeCustom / prevHidden).
 *
 * Applying a custom route rewrites hiddenRoutes to "everything not in the set" and remembers the
 * previous hiddenRoutes in prevHidden, so clearing it restores what the user had. Only one custom
 * route is applied at a time.
 */

const MAX_NAME = 60;

/** @returns {string} a short unique id */
export function newId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Trimmed, length-limited display name (falls back to "My route").
 * @param {unknown} name
 * @returns {string}
 */
export function cleanName(name) {
  const s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return s || 'My route';
}

/**
 * Route ids currently visible from the user's hidden list (data order).
 * @param {{routes?:object, hiddenRoutes?:string[]}} state
 * @returns {string[]}
 */
export function visibleRids(state) {
  const hidden = new Set((state.hiddenRoutes || []).map(String));
  return Object.keys(state.routes || {}).filter((r) => !hidden.has(r));
}

/**
 * Hidden list that shows exactly `rids`.
 * @param {object} state
 * @param {string[]} rids
 * @returns {string[]}
 */
export function hiddenFor(state, rids) {
  const keep = new Set((rids || []).map(String));
  return Object.keys(state.routes || {}).filter((r) => !keep.has(r));
}

/**
 * Does the current hiddenRoutes show exactly this custom route's set?
 * @param {object} state
 * @param {{rids:string[]}} c
 * @returns {boolean}
 */
export function matchesCurrent(state, c) {
  const a = new Set(visibleRids(state)), b = new Set((c.rids || []).filter((r) => (state.routes || {})[r]));
  return a.size === b.size && [...a].every((r) => b.has(r));
}

/**
 * Create a custom route (not applied).
 * @param {object} state
 * @param {{name:string, rids:string[]}} spec
 * @returns {{patch:object, id:string}}
 */
export function createCustom(state, { name, rids }) {
  const id = newId();
  const c = { id, name: cleanName(name), rids: [...new Set((rids || []).map(String))], highlight: [] };
  return { id, patch: { customRoutes: [...(state.customRoutes || []), c] } };
}

/**
 * Create a custom route from what is visible now and mark it applied (the map already shows it).
 * @param {object} state
 * @param {string} name
 * @returns {{patch:object, id:string}}
 */
export function saveVisibleAsCustom(state, name) {
  const { id, patch } = createCustom(state, { name, rids: visibleRids(state) });
  return { id, patch: { ...patch, activeCustom: id, prevHidden: [] } };
}

/**
 * Update fields of a custom route (name, rids, highlight). Re-applies it if it is the active one.
 * @param {object} state
 * @param {string} id
 * @param {{name?:string, rids?:string[], highlight?:string[]}} changes
 * @returns {object} patch ({} if not found)
 */
export function updateCustom(state, id, changes) {
  const list = state.customRoutes || [];
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return {};
  const c = { ...list[i] };
  if (changes.name !== undefined) c.name = cleanName(changes.name);
  if (changes.rids) c.rids = [...new Set(changes.rids.map(String))];
  if (changes.highlight) c.highlight = [...new Set(changes.highlight.map(String))];
  c.highlight = (c.highlight || []).filter((r) => c.rids.includes(r));
  const next = list.slice();
  next[i] = c;
  const patch = { customRoutes: next };
  if (state.activeCustom === id) patch.hiddenRoutes = hiddenFor(state, c.rids);
  return patch;
}

/**
 * Toggle one route in a custom route's highlight list.
 * @param {object} state
 * @param {string} id
 * @param {string} rid
 * @returns {object} patch
 */
export function toggleHighlight(state, id, rid) {
  const c = (state.customRoutes || []).find((x) => x.id === id);
  if (!c) return {};
  const h = c.highlight || [];
  return updateCustom(state, id, { highlight: h.includes(rid) ? h.filter((r) => r !== rid) : [...h, rid] });
}

/**
 * Delete a custom route (clears it first if applied).
 * @param {object} state
 * @param {string} id
 * @returns {object} patch
 */
export function deleteCustom(state, id) {
  const patch = state.activeCustom === id ? clearCustom(state) : {};
  return { ...patch, customRoutes: (state.customRoutes || []).filter((c) => c.id !== id) };
}

/**
 * Apply a custom route: show only its routes, remember the previous hidden list.
 * @param {object} state
 * @param {string} id
 * @returns {object} patch ({} if not found)
 */
export function applyCustom(state, id) {
  const c = (state.customRoutes || []).find((x) => x.id === id);
  if (!c) return {};
  const prev = state.activeCustom ? state.prevHidden || [] : state.hiddenRoutes || [];
  return { activeCustom: id, prevHidden: prev.slice(), hiddenRoutes: hiddenFor(state, c.rids), routeFilter: null };
}

/**
 * Stop applying the custom route and restore the hidden list from before.
 * @param {object} state
 * @returns {object} patch
 */
export function clearCustom(state) {
  if (!state.activeCustom) return {};
  return { activeCustom: null, hiddenRoutes: (state.prevHidden || []).slice(), prevHidden: [] };
}

/**
 * Move a route within the draw-priority list (store.routeOrder). Missing routes are appended in data
 * order first, so the list always holds every route.
 * @param {object} state
 * @param {string} rid
 * @param {-1|1} delta -1 = up (drawn above more routes), 1 = down
 * @returns {object} patch
 */
export function moveInOrder(state, rid, delta) {
  const all = Object.keys(state.routes || {});
  const order = (state.routeOrder || []).filter((r) => all.includes(r));
  for (const r of all) if (!order.includes(r)) order.push(r);
  const i = order.indexOf(String(rid)), j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return {};
  [order[i], order[j]] = [order[j], order[i]];
  return { routeOrder: order };
}

/**
 * Move a route to an absolute position in the draw-priority list (drag and drop). Missing routes are
 * appended in data order first, so the list always holds every route.
 * @param {object} state
 * @param {string} rid
 * @param {number} index target position, clamped to the list (0 = drawn on top)
 * @returns {object} patch ({} if unknown or unchanged)
 */
export function moveToIndex(state, rid, index) {
  const all = Object.keys(state.routes || {});
  const order = (state.routeOrder || []).filter((r) => all.includes(r));
  for (const r of all) if (!order.includes(r)) order.push(r);
  const i = order.indexOf(String(rid));
  const j = Math.max(0, Math.min(order.length - 1, Math.round(Number(index) || 0)));
  if (i < 0 || i === j) return {};
  order.splice(i, 1);
  order.splice(j, 0, String(rid));
  return { routeOrder: order };
}

/**
 * Show every route (optionally only `rids`), dropping an applied custom route.
 * @param {object} state
 * @param {string[]|null} [rids] limit to these routes (e.g. the station filter); null = all
 * @returns {object} patch
 */
export function showAll(state, rids = null) {
  const only = rids ? new Set(rids.map(String)) : null;
  const hidden = only ? (state.hiddenRoutes || []).filter((r) => !only.has(r)) : [];
  return { activeCustom: null, prevHidden: [], hiddenRoutes: hidden };
}

/**
 * Hide every route (optionally only `rids`), dropping an applied custom route.
 * @param {object} state
 * @param {string[]|null} [rids] limit to these routes; null = all
 * @returns {object} patch
 */
export function hideAll(state, rids = null) {
  const add = rids ? rids.map(String) : Object.keys(state.routes || {});
  return { activeCustom: null, prevHidden: [], hiddenRoutes: [...new Set([...(state.hiddenRoutes || []), ...add])] };
}

/**
 * Toggle a favorite station.
 * @param {{favStops?:string[]}} state
 * @param {string} stopId
 * @returns {{favStops:string[]}}
 */
export function toggleFav(state, stopId) {
  const f = state.favStops || [], id = String(stopId);
  return { favStops: f.includes(id) ? f.filter((x) => x !== id) : [...f, id] };
}

/**
 * @module core/custom
 * Custom routes ("My Routes"): named sets of shuttle routes. Every function takes the current store
 * state and returns a PATCH for store.set(...) (or a value); nothing here touches the DOM or storage
 * (state.js persists customRoutes / activeCustom / prevHidden).
 *
 * Applying a custom route rewrites hiddenRoutes to "everything not in the set" and remembers the
 * previous hiddenRoutes in prevHidden, so clearing it restores what the user had. Only one custom
 * route is applied at a time.
 *
 * Lines by Time (owner 2026-10-18) applies a temporary one, store.timeView (never saved, not in My Routes):
 * {at, name: "Lines active at <time>", rids, before: {hiddenRoutes, activeCustom, prevHidden}}. It shows only rids and
 * keeps everything from before (an applied custom route too) to put back on Clear. The moment the shown set changes
 * (a line deselected, or one added) it is no longer "Lines active at": settleTimeView drops the name and the routes
 * stay as they are, like an edited custom route. state.js saves `before` while it is on, so a reload shows the
 * rider's own routes. iOS: Kit Custom.applyTimeView / clearTimeView / settleTimeView.
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
  return { id, patch: { ...patch, activeCustom: id, prevHidden: [], timeView: null } };
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
  const src = state.timeView && state.timeView.before ? state.timeView.before : state;   // Lines by Time on: what was there before it
  const prev = src.activeCustom ? src.prevHidden || [] : src.hiddenRoutes || [];
  return { activeCustom: id, prevHidden: prev.slice(), hiddenRoutes: hiddenFor(state, c.rids), routeFilter: null, timeView: null };
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
  return { activeCustom: null, prevHidden: [], hiddenRoutes: hidden, timeView: null };
}

/**
 * Hide every route (optionally only `rids`), dropping an applied custom route.
 * @param {object} state
 * @param {string[]|null} [rids] limit to these routes; null = all
 * @returns {object} patch
 */
export function hideAll(state, rids = null) {
  const add = rids ? rids.map(String) : Object.keys(state.routes || {});
  return { activeCustom: null, prevHidden: [], hiddenRoutes: [...new Set([...(state.hiddenRoutes || []), ...add])], timeView: null };
}

/**
 * Show only the routes operating now (owner 2026-10-17, "Show running"): `operating` stays visible (the caller passes
 * the routes with a live bus and those scheduled now with no live location: hiding one could hide a bus that is out
 * there), every other route of the scope is hidden, dropping an applied custom route. Hidden routes outside the
 * scope stay as they are. iOS: Kit Custom.showRunning.
 * @param {object} state
 * @param {string[]} operating route ids operating now
 * @param {string[]|null} [rids] limit to these routes (the station filter); null = all
 * @returns {object} patch
 */
export function showRunning(state, operating, rids = null) {
  const scope = rids ? rids.map(String) : Object.keys(state.routes || {});
  const inScope = new Set(scope), keep = new Set((operating || []).map(String));
  const outside = (state.hiddenRoutes || []).map(String).filter((r) => !inScope.has(r));
  return { activeCustom: null, prevHidden: [], hiddenRoutes: [...new Set([...outside, ...scope.filter((r) => !keep.has(r))])], timeView: null };
}

/**
 * What a timeView keeps to restore: the visibility before Lines by Time (the one already kept if it is on).
 * @param {object} state
 * @returns {{hiddenRoutes:string[], activeCustom:string|null, prevHidden:string[]}}
 */
function beforeTime(state) {
  const b = state.timeView && state.timeView.before;
  if (b) return b;
  return { hiddenRoutes: (state.hiddenRoutes || []).map(String), activeCustom: state.activeCustom || null, prevHidden: (state.prevHidden || []).map(String) };
}

/**
 * Apply Lines by Time's temporary custom route: show only the lines active at the chosen time, keep what was shown
 * before for Clear. Ends a journey (a started trip, "Routes to station"): the menu says so before Set time, since a
 * journey decides the map over hiddenRoutes (core/visibility.js) and the lines would not show.
 * @param {object} state
 * @param {{at:number, name:string, rids:string[]}} spec name: "Lines active at <time>"
 * @returns {object} patch ({} when no known route is in rids: the map does not change)
 */
export function applyTimeView(state, { at, name, rids }) {
  const keep = [...new Set((rids || []).map(String))].filter((r) => (state.routes || {})[r]);
  if (!keep.length) return {};
  const label = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 80) || 'Lines active';
  return {
    timeView: { at: Number(at) || 0, name: label, rids: keep, before: beforeTime(state) },
    hiddenRoutes: hiddenFor(state, keep), activeCustom: null, prevHidden: [], routeFilter: null, journey: null,
  };
}

/**
 * Clear Lines by Time: put back what was shown before it (an applied custom route stays applied; one deleted
 * meanwhile falls back to the routes from before it).
 * @param {object} state
 * @returns {object} patch ({} if it is not on)
 */
export function clearTimeView(state) {
  const tv = state.timeView;
  if (!tv) return {};
  const b = tv.before || {};
  if (b.activeCustom && !(state.customRoutes || []).some((c) => c.id === b.activeCustom)) {
    return { timeView: null, activeCustom: null, hiddenRoutes: (b.prevHidden || []).slice(), prevHidden: [] };
  }
  return { timeView: null, hiddenRoutes: (b.hiddenRoutes || []).slice(), activeCustom: b.activeCustom || null, prevHidden: (b.prevHidden || []).slice() };
}

/**
 * The shown set no longer equals the time's lines (a line deselected or added): drop the name, keep the routes.
 * @param {object} state
 * @returns {object} patch ({} while it still matches, or when it is not on)
 */
export function settleTimeView(state) {
  const tv = state.timeView;
  if (!tv) return {};
  return matchesCurrent(state, tv) ? {} : { timeView: null };
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

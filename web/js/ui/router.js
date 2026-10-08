/**
 * @module ui/router
 * View registry + navigation. Writes store.view / prevView / stopId / routeId and keeps an
 * in-memory back stack (with the sheet detent of each entry, so closing returns to it).
 *
 * Root views are the three tabs: 'nearby', 'routes', 'myroutes'. Every other view is a sub view
 * with a Back button. Navigating to a view already on the back stack pops back to it (no loops).
 *
 * Call initRouter({store, setDetent, getDetent}) once at boot (main.js). Views call
 * registerView(...) at import time and navigate()/back() from actions.
 */

/** Root (tab) view ids. */
export const TABS = Object.freeze(["nearby", "routes", "myroutes"]);
const MAX_DEPTH = 20;

const views = new Map();
let store = null;
let setDetentFn = null;
let getDetentFn = null;
let stack = [];
let params = {};

/**
 * Wire the router to the app store and the sheet.
 * @param {{store:Object, setDetent?:(d:string)=>void, getDetent?:()=>string}} deps
 */
export function initRouter(deps) {
  store = deps.store;
  setDetentFn = deps.setDetent || null;
  getDetentFn = deps.getDetent || null;
}

/**
 * Register a view.
 * @param {string} id
 * @param {{title:(state:Object)=>string, parent?:string, detent?:'peek'|'half'|'full', tab?:'nearby'|'routes'|'myroutes',
 *          render?:(state:Object)=>string, mount?:(rootEl:HTMLElement, ctx:Object)=>void, unmount?:()=>void,
 *          meta?:(state:Object)=>string, onStopTap?:(stopId:string, ctx:Object)=>boolean, refresh?:()=>void}} def
 *   Views with mount() own their DOM after mounting: main.js never rebuilds them; it calls
 *   refresh() (optional) every 15 s so countdowns tick between polls.
 *   meta (optional, D1 extension): plain text for the right side of the sheet title line.
 *   onStopTap (optional, D1 extension): return true to handle a map stop tap instead of opening the stop view.
 */
export function registerView(id, def) {
  if (!id || !def || typeof def !== "object") throw new Error("registerView: bad arguments for " + id);
  if (views.has(id)) console.warn("registerView: replacing view", id);
  views.set(id, def);
}

/**
 * Look up a registered view definition.
 * @param {string} id
 * @returns {Object|undefined}
 */
export function getView(id) {
  return views.get(id);
}

/**
 * Ids of all registered views.
 * @returns {string[]}
 */
export function viewIds() {
  return [...views.keys()];
}

/**
 * Parameters passed to the most recent navigate() (or restored by back()). Views can read extra
 * params here, e.g. navigate('directions', {fromStopId}).
 * @returns {Object}
 */
export function currentParams() {
  return params;
}

/**
 * Whether Back has somewhere to go (true in any sub view).
 * @returns {boolean}
 */
export function canGoBack() {
  if (stack.length) return true;
  return !!store && !TABS.includes(store.get().view);
}

/**
 * The root tab a view belongs to (follows def.tab, then the parent chain), default 'nearby'.
 * @param {string} id
 * @returns {'nearby'|'routes'|'myroutes'}
 */
export function rootOf(id) {
  const seen = new Set();
  let cur = id;
  while (cur && !seen.has(cur)) {
    if (TABS.includes(cur)) return cur;
    seen.add(cur);
    const d = views.get(cur);
    if (!d) break;
    if (d.tab && TABS.includes(d.tab)) return d.tab;
    cur = d.parent;
  }
  return "nearby";
}

/**
 * The tab to highlight for the current state.
 * @param {Object} [state] defaults to store.get()
 * @returns {'nearby'|'routes'|'myroutes'}
 */
export function activeTab(state) {
  const s = state || (store && store.get()) || {};
  const v = s.view || "nearby";
  if (TABS.includes(v)) return v;
  const d = views.get(v);
  if (d && d.tab && TABS.includes(d.tab)) return d.tab;
  const root = stack.find((e) => TABS.includes(e.view));
  return root ? root.view : rootOf(v);
}

function detentNow() {
  try {
    return getDetentFn ? getDetentFn() : null;
  } catch (e) {
    return null;
  }
}

function applyDetent(d) {
  if (d && setDetentFn) {
    try {
      setDetentFn(d);
    } catch (e) {
      console.error("router setDetent", e);
    }
  }
}

/**
 * Go to a view. Root views reset the back stack; sub views push the current location.
 * @param {string} view registered view id
 * @param {{stopId?:string, routeId?:string, detent?:'peek'|'half'|'full'}&Object} [p] extra keys are kept in currentParams()
 * @returns {boolean} false if the view is unknown or the router is not initialised
 */
export function navigate(view, p = {}) {
  const def = views.get(view);
  if (!store || !def) {
    console.warn("navigate: unknown view or router not initialised:", view);
    return false;
  }
  p = p || {};
  const s = store.get();
  const stopId = p.stopId != null ? String(p.stopId) : null;
  const routeId = p.routeId != null ? String(p.routeId) : null;
  if (TABS.includes(view)) {
    stack = [];
  } else if (s.view === view && s.stopId === stopId && s.routeId === routeId) {
    // same place: just refresh params/detent
  } else {
    const i = stack.findIndex((e) => e.view === view && e.stopId === stopId && e.routeId === routeId);
    if (i >= 0) stack = stack.slice(0, i);
    else {
      stack.push({ view: s.view, stopId: s.stopId, routeId: s.routeId, detent: detentNow(), params });
      if (stack.length > MAX_DEPTH) stack.splice(1, stack.length - MAX_DEPTH);
    }
  }
  params = { ...p };
  store.set({ view, prevView: s.view === view ? s.prevView : s.view, stopId, routeId });
  // switching tabs keeps the user's detent (only lifts the sheet out of peek); sub views use their own
  const nowD = detentNow();
  const keep = TABS.includes(view) && nowD && nowD !== "peek";
  applyDetent(p.detent || (keep ? null : def.detent));
  return true;
}

/**
 * Go back one step: pop the stack (restoring the previous detent), else go to the parent / root tab.
 * @returns {boolean} true if something changed (false at a root view with an empty stack)
 */
export function back() {
  if (!store) return false;
  const s = store.get();
  if (stack.length) {
    const e = stack.pop();
    params = e.params || {};
    store.set({ view: e.view, prevView: s.view, stopId: e.stopId ?? null, routeId: e.routeId ?? null });
    applyDetent(e.detent);
    return true;
  }
  if (TABS.includes(s.view)) return false;
  const def = views.get(s.view) || {};
  let target = def.parent && views.has(def.parent) ? def.parent : rootOf(s.view);
  if (!TABS.includes(target)) stack = [{ view: rootOf(target), stopId: null, routeId: null, detent: null, params: {} }];
  params = {};
  store.set({ view: target, prevView: s.view, stopId: null, routeId: null });
  return true;
}

/** Test helper: forget all views and history. */
export function _resetRouter() {
  views.clear();
  stack = [];
  params = {};
  store = null;
  setDetentFn = getDetentFn = null;
}

/**
 * Test/debug helper: a copy of the back stack.
 * @returns {Array<{view:string, stopId:?string, routeId:?string, detent:?string}>}
 */
export function _stack() {
  return stack.map((e) => ({ view: e.view, stopId: e.stopId, routeId: e.routeId, detent: e.detent }));
}

// The app store. One shared instance; everything else reads/writes through it.
// Shape is the contract in docs/ARCHITECTURE.md ("App state").
import { createStore } from './core/store.js';
import { load, save } from './core/storage.js';

/** Storage keys (core/storage.js adds the 'sb:' prefix). */
export const KEYS = Object.freeze({ hiddenRoutes: 'hiddenRoutes', theme: 'theme' });

const THEMES = ['auto', 'light', 'dark'];

/**
 * Validate a persisted hidden-routes value.
 * @param {unknown} v
 * @returns {string[]} unique route ids as strings
 */
export function cleanHidden(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    if ((typeof x === 'string' || typeof x === 'number') && String(x) && !out.includes(String(x))) out.push(String(x));
  }
  return out;
}

/**
 * Validate a persisted theme value.
 * @param {unknown} v
 * @returns {'auto'|'light'|'dark'}
 */
export function cleanTheme(v) {
  return THEMES.includes(v) ? /** @type {'auto'|'light'|'dark'} */ (v) : 'auto';
}

/**
 * Build a fresh initial state object (exact contract shape), with persisted prefs loaded.
 * @returns {object}
 */
export function initialState() {
  return {
    // static (data/static.js fills once)
    routes: {}, stops: {}, shapes: {},
    routeStops: {}, stopRoutes: {}, addresses: {},
    staticLoaded: false,
    // live (data/live.js fills every 10 s)
    buses: [], trips: [], alerts: [],
    feedTs: 0, lastOk: 0, failed: false, liveLoaded: false,
    // user/prefs
    user: null, locState: 'unknown',
    hiddenRoutes: cleanHidden(load(KEYS.hiddenRoutes, [])),
    theme: cleanTheme(load(KEYS.theme, 'auto')),
    // nav (ui/router.js writes)
    view: 'nearby', prevView: null, stopId: null, routeId: null,
    routeFilter: null,
  };
}

/**
 * Persist hiddenRoutes/theme whenever they change on the given store.
 * @param {{get():object, subscribe(fn:(state:object, changed:Set<string>)=>void):()=>void}} s
 * @returns {() => void} unsubscribe
 */
export function persistPrefs(s) {
  return s.subscribe((state, changed) => {
    if (!changed || changed.has('hiddenRoutes')) save(KEYS.hiddenRoutes, cleanHidden(state.hiddenRoutes));
    if (!changed || changed.has('theme')) save(KEYS.theme, cleanTheme(state.theme));
  });
}

/**
 * The single app store. `store.get()` returns the state above; `store.set(patch)` shallow-merges;
 * `store.subscribe(fn)` is called once per microtask with (state, changedKeys).
 * hiddenRoutes and theme are loaded from and saved to localStorage via core/storage.js.
 */
export const store = createStore(initialState());
persistPrefs(store);

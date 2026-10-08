// The app store. One shared instance; everything else reads/writes through it.
// Shape is the contract in docs/ARCHITECTURE.md ("App state").
import { createStore } from './core/store.js';
import { load, save } from './core/storage.js';

/** Storage keys (core/storage.js adds the 'sb:' prefix). */
export const KEYS = Object.freeze({ hiddenRoutes: 'hiddenRoutes', theme: 'theme', routeOrder: 'routeOrder',
  customRoutes: 'customRoutes', activeCustom: 'activeCustom', prevHidden: 'prevHidden', favStops: 'favStops', notify: 'notify' });

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
 * Validate persisted custom routes: [{id, name, rids, highlight}] with string ids, trimmed names,
 * unique ids, highlight a subset of rids. Bad entries are dropped.
 * @param {unknown} v
 * @returns {{id:string, name:string, rids:string[], highlight:string[]}[]}
 */
export function cleanCustom(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const c of v) {
    if (!c || typeof c !== 'object') continue;
    const id = String(c.id || ''), name = String(c.name || '').trim().slice(0, 60);
    const rids = cleanHidden(c.rids);
    if (!id || !name || out.some((x) => x.id === id)) continue;
    out.push({ id, name, rids, highlight: cleanHidden(c.highlight).filter((r) => rids.includes(r)) });
  }
  return out;
}

/**
 * Validate a persisted id-or-null value.
 * @param {unknown} v
 * @returns {string|null}
 */
export function cleanId(v) {
  return (typeof v === 'string' || typeof v === 'number') && String(v) ? String(v) : null;
}

/** Default bus-arrival notification settings (see docs/ARCHITECTURE.md "Settings"). */
export const NOTIFY_DEFAULTS = Object.freeze({ stopId: null, rids: [], twoStops: true, oneStop: true, minutes: 0,
  liveActivity: true, inApp: true });

/**
 * Validate persisted notification settings (unknown keys dropped, bad values -> defaults).
 * @param {unknown} v
 * @returns {{stopId:string|null, rids:string[], twoStops:boolean, oneStop:boolean, minutes:number, liveActivity:boolean, inApp:boolean}}
 */
export function cleanNotify(v) {
  const o = v && typeof v === 'object' ? v : {};
  const b = (k) => (typeof o[k] === 'boolean' ? o[k] : NOTIFY_DEFAULTS[k]);
  const m = Number(o.minutes);
  return { stopId: cleanId(o.stopId), rids: cleanHidden(o.rids), twoStops: b('twoStops'), oneStop: b('oneStop'),
    minutes: Number.isFinite(m) && m >= 0 && m <= 30 ? Math.round(m) : 0, liveActivity: b('liveActivity'), inApp: b('inApp') };
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
    service: {},                                               // data/service.json (schedule summary), {} if missing
    staticLoaded: false,
    // live (data/live.js fills every 10 s)
    buses: [], trips: [], alerts: [],
    feedTs: 0, lastOk: 0, failed: false, liveLoaded: false,
    // user/prefs
    user: null, locState: 'unknown',
    hiddenRoutes: cleanHidden(load(KEYS.hiddenRoutes, [])),
    theme: cleanTheme(load(KEYS.theme, 'auto')),
    routeOrder: cleanHidden(load(KEYS.routeOrder, [])),        // map draw priority, first = drawn on top
    customRoutes: cleanCustom(load(KEYS.customRoutes, [])),    // My Routes: named route sets
    activeCustom: cleanId(load(KEYS.activeCustom, null)),      // id of the applied custom route, or null
    prevHidden: cleanHidden(load(KEYS.prevHidden, [])),        // hiddenRoutes before a custom route was applied
    favStops: cleanHidden(load(KEYS.favStops, [])),            // favorite station ids
    notify: cleanNotify(load(KEYS.notify, null)),              // "bus nearing my station" settings
    journey: null,                                             // {rids, label} while "only show relevant routes" is on (not persisted)
    // nav (ui/router.js writes)
    view: 'nearby', prevView: null, stopId: null, routeId: null,
    routeFilter: null,
  };
}

/**
 * Persist the prefs whenever they change on the given store.
 * @param {{get():object, subscribe(fn:(state:object, changed:Set<string>)=>void):()=>void}} s
 * @returns {() => void} unsubscribe
 */
export function persistPrefs(s) {
  return s.subscribe((state, changed) => {
    if (!changed || changed.has('hiddenRoutes')) save(KEYS.hiddenRoutes, cleanHidden(state.hiddenRoutes));
    if (!changed || changed.has('theme')) save(KEYS.theme, cleanTheme(state.theme));
    if (!changed || changed.has('routeOrder')) save(KEYS.routeOrder, cleanHidden(state.routeOrder));
    if (!changed || changed.has('customRoutes')) save(KEYS.customRoutes, cleanCustom(state.customRoutes));
    if (!changed || changed.has('activeCustom')) save(KEYS.activeCustom, cleanId(state.activeCustom));
    if (!changed || changed.has('prevHidden')) save(KEYS.prevHidden, cleanHidden(state.prevHidden));
    if (!changed || changed.has('favStops')) save(KEYS.favStops, cleanHidden(state.favStops));
    if (!changed || changed.has('notify')) save(KEYS.notify, cleanNotify(state.notify));
  });
}

/**
 * The single app store. `store.get()` returns the state above; `store.set(patch)` shallow-merges;
 * `store.subscribe(fn)` is called once per microtask with (state, changedKeys).
 * Prefs (hiddenRoutes, theme, routeOrder, customRoutes, activeCustom, prevHidden, favStops, notify) are loaded from
 * and saved to localStorage via core/storage.js.
 */
export const store = createStore(initialState());
persistPrefs(store);

import { test, eq, ok } from './lib.js';
import { load, save, remove } from '../js/core/storage.js';
import { createStore } from '../js/core/store.js';
import { initialState, persistPrefs, cleanHidden, cleanTheme, KEYS } from '../js/state.js';
import { tick } from './data-helpers.js';

const CONTRACT_KEYS = ['routes', 'stops', 'shapes', 'routeStops', 'stopRoutes', 'addresses', 'staticLoaded',
  'buses', 'trips', 'alerts', 'feedTs', 'lastOk', 'failed', 'liveLoaded',
  'user', 'locState', 'hiddenRoutes', 'theme', 'service',
  'routeOrder', 'customRoutes', 'activeCustom', 'prevHidden', 'favStops', 'journey',
  'view', 'prevView', 'stopId', 'routeId', 'routeFilter'];

/** Run fn with the persisted prefs saved/restored around it. */
async function withPrefs(fn) {
  const saved = { h: load(KEYS.hiddenRoutes, undefined), t: load(KEYS.theme, undefined) };
  try { await fn(); } finally {
    if (saved.h === undefined) remove(KEYS.hiddenRoutes); else save(KEYS.hiddenRoutes, saved.h);
    if (saved.t === undefined) remove(KEYS.theme); else save(KEYS.theme, saved.t);
  }
}

test('state: initial shape matches the contract exactly', async () => {
  await withPrefs(async () => {
    remove(KEYS.hiddenRoutes); remove(KEYS.theme);
    const s = initialState();
    eq(Object.keys(s).sort(), [...CONTRACT_KEYS].sort());
    eq([s.staticLoaded, s.liveLoaded, s.failed, s.feedTs, s.lastOk], [false, false, false, 0, 0]);
    eq([s.user, s.locState, s.view, s.prevView, s.stopId, s.routeId, s.routeFilter], [null, 'unknown', 'nearby', null, null, null, null]);
    eq([s.hiddenRoutes, s.theme], [[], 'auto']);
    eq([s.buses, s.trips, s.alerts], [[], [], []]);
  });
});

test('state: exported store loads persisted hiddenRoutes + theme at import', async () => {
  await withPrefs(async () => {
    save(KEYS.hiddenRoutes, ['r1', 'r2']);
    save(KEYS.theme, 'dark');
    const mod = await import('../js/state.js?fresh=' + Date.now());
    eq(mod.store.get().hiddenRoutes, ['r1', 'r2']);
    eq(mod.store.get().theme, 'dark');
    ok(typeof mod.store.subscribe === 'function' && typeof mod.store.set === 'function');
  });
});

test('state: changes to hiddenRoutes/theme are saved via storage.js', async () => {
  await withPrefs(async () => {
    remove(KEYS.hiddenRoutes); remove(KEYS.theme);
    const mod = await import('../js/state.js?fresh2=' + Date.now());
    mod.store.set({ hiddenRoutes: ['x'] });
    await tick();
    eq(load(KEYS.hiddenRoutes, null), ['x']);
    mod.store.set({ theme: 'light' });
    await tick();
    eq(load(KEYS.theme, null), 'light');
    mod.store.set({ view: 'routes' }); // unrelated change does not clobber
    save(KEYS.theme, 'dark');
    await tick();
    eq(load(KEYS.theme, null), 'dark', 'theme only written when theme changes');
  });
});

test('state: corrupt persisted values fall back safely', async () => {
  await withPrefs(async () => {
    save(KEYS.hiddenRoutes, 'not-an-array');
    save(KEYS.theme, 'neon');
    const s = initialState();
    eq([s.hiddenRoutes, s.theme], [[], 'auto']);
    try { localStorage.setItem('sb:' + KEYS.theme, '{broken'); } catch { /* storage off */ }
    eq(initialState().theme, 'auto');
  });
});

test('state: cleanHidden / cleanTheme / persistPrefs on a custom store', async () => {
  eq(cleanHidden(['a', 'a', 5, null, '', {}]), ['a', '5']);
  eq(cleanTheme('light'), 'light');
  eq(cleanTheme(undefined), 'auto');
  await withPrefs(async () => {
    const st = createStore({ hiddenRoutes: [], theme: 'auto' });
    const off = persistPrefs(st);
    st.set({ hiddenRoutes: ['q', 'q'] });
    await tick();
    eq(load(KEYS.hiddenRoutes, null), ['q'], 'deduped when saved');
    off();
    st.set({ hiddenRoutes: ['z'] });
    await tick();
    eq(load(KEYS.hiddenRoutes, null), ['q'], 'unsubscribed');
  });
});

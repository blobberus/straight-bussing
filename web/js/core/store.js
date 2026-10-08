/**
 * @module core/store
 * Minimal observable store: shallow-merge `set`, subscribers batched once per microtask.
 */

/**
 * Create a store.
 * @param {Object} initial initial state (shallow-copied)
 * @returns {{get():Object, set(patch:Object|((s:Object)=>Object)):void, subscribe(fn:(state:Object, changed:Set<string>)=>void):()=>void}}
 */
export function createStore(initial) {
  let state = { ...(initial || {}) };
  const subs = new Set();
  let pending = null; // Set of changed keys awaiting flush

  function flush() {
    const changed = pending;
    pending = null;
    if (!changed || !changed.size) return;
    for (const fn of [...subs]) {
      try {
        fn(state, changed);
      } catch (e) {
        if (typeof console !== "undefined") console.error("store subscriber", e);
      }
    }
  }

  return {
    /** Current state object (treat as read-only). */
    get() {
      return state;
    },
    /**
     * Shallow-merge a patch. Keys whose value is identical (Object.is) are not reported as changed.
     * Accepts a function (state) -> patch.
     */
    set(patch) {
      if (typeof patch === "function") patch = patch(state);
      if (!patch || typeof patch !== "object") return;
      let next = null;
      for (const k of Object.keys(patch)) {
        if (Object.is(state[k], patch[k])) continue;
        if (!next) next = { ...state };
        next[k] = patch[k];
        if (!pending) {
          pending = new Set();
          queueMicrotask(flush);
        }
        pending.add(k);
      }
      if (next) state = next;
    },
    /**
     * Subscribe to changes. Called at most once per microtask with (state, changedKeys).
     * @returns {() => void} unsubscribe
     */
    subscribe(fn) {
      if (typeof fn !== "function") return () => {};
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

/**
 * @module core/events
 * Tiny app-wide event bus. Known events: 'sheet:inset' {px}, 'toast' {text}.
 */

const handlers = new Map();

/**
 * Global event bus.
 * @type {{on(name:string, fn:(payload:any)=>void):()=>void, emit(name:string, payload?:any):void}}
 */
export const bus = {
  /**
   * Subscribe. Returns an unsubscribe function.
   * @param {string} name
   * @param {(payload:any)=>void} fn
   * @returns {() => void}
   */
  on(name, fn) {
    if (typeof fn !== "function") return () => {};
    let set = handlers.get(name);
    if (!set) handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  },
  /**
   * Emit synchronously to current subscribers. A throwing handler does not stop the others.
   * @param {string} name
   * @param {*} [payload]
   */
  emit(name, payload) {
    const set = handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (e) {
        if (typeof console !== "undefined") console.error("bus handler for", name, e);
      }
    }
  },
};

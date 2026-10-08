/**
 * @module ui/actions
 * Named actions + event delegation. Markup uses data-action="name" data-id="..." (any other
 * data-* attributes arrive in the dataset). main.js binds delegation on the sheet content, the
 * status pill and the dialog container, so views never attach inline handlers.
 *
 * Handlers: fn(dataset, event, ctx). Errors are caught and logged; a toast is shown via ctx.toast.
 */

const actions = new Map();

/**
 * Register an action handler. A later registration replaces an earlier one, unless
 * opts.fallback is set (then it only fills the name if nobody registered it).
 * @param {string} name
 * @param {(dataset:DOMStringMap|Object, event:Event|null, ctx:Object)=>any} fn
 * @param {{fallback?:boolean}} [opts]
 * @returns {boolean} whether the handler was installed
 */
export function registerAction(name, fn, opts = {}) {
  if (!name || typeof fn !== "function") throw new Error("registerAction: bad arguments for " + name);
  if (actions.has(name)) {
    if (opts.fallback) return false;
    console.warn("registerAction: replacing action", name);
  }
  actions.set(name, fn);
  return true;
}

/**
 * Whether an action name is registered.
 * @param {string} name
 * @returns {boolean}
 */
export function hasAction(name) {
  return actions.has(name);
}

/**
 * Run a named action directly (also used by the delegation handler and by tests).
 * @param {string} name
 * @param {Object} dataset
 * @param {Event|null} event
 * @param {Object} ctx
 * @returns {boolean} true if a handler ran (even if it threw)
 */
export function runAction(name, dataset, event, ctx) {
  const fn = actions.get(name);
  if (!fn) {
    console.warn("unknown action", name);
    return false;
  }
  try {
    const r = fn(dataset || {}, event || null, ctx);
    if (r && typeof r.catch === "function") {
      r.catch((e) => {
        console.error("action " + name, e);
        if (ctx && ctx.toast) ctx.toast("Something went wrong. Please try again.");
      });
    }
  } catch (e) {
    console.error("action " + name, e);
    if (ctx && ctx.toast) ctx.toast("Something went wrong. Please try again.");
  }
  return true;
}

function isDisabled(el) {
  return el.disabled || el.getAttribute("aria-disabled") === "true";
}

/**
 * Delegate clicks (and Enter/Space on non-button elements with role="button") on `root` to actions.
 * Inputs/selects with data-action fire on 'change'.
 * @param {HTMLElement} root
 * @param {() => Object} getCtx returns the ctx object at event time
 * @returns {() => void} unbind
 */
export function bindActions(root, getCtx) {
  if (!root) return () => {};
  const pick = (e) => {
    const el = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
    return el && root.contains(el) && !isDisabled(el) ? el : null;
  };
  const onClick = (e) => {
    const el = pick(e);
    if (!el || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    if (el.tagName === "A" && el.getAttribute("href") && !el.dataset.actionPrevent) return void runAction(el.dataset.action, el.dataset, e, getCtx());
    e.preventDefault();
    runAction(el.dataset.action, el.dataset, e, getCtx());
  };
  const onChange = (e) => {
    const el = pick(e);
    if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    runAction(el.dataset.action, { ...el.dataset, value: el.type === "checkbox" ? String(el.checked) : el.value }, e, getCtx());
  };
  const onKey = (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = pick(e);
    if (!el || el.tagName === "BUTTON" || el.tagName === "A" || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    if (el.getAttribute("role") !== "button") return;
    e.preventDefault();
    runAction(el.dataset.action, el.dataset, e, getCtx());
  };
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("keydown", onKey);
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
    root.removeEventListener("keydown", onKey);
  };
}

/** Test helper: forget all actions. */
export function _resetActions() {
  actions.clear();
}

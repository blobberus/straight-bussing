/**
 * @module ui/actions
 * Named actions + event delegation. Markup uses data-action="name" data-id="..." (any other
 * data-* attributes arrive in the dataset). main.js binds delegation on the sheet content, the
 * status pill and the dialog container, so views never attach inline handlers.
 *
 * Handlers: fn(dataset, event, ctx). Errors are caught and logged; a toast is shown via ctx.toast.
 */

const actions = new Map();
/** How long a tap made before its action / view module loaded stays worth running (slow networks). */
export const PENDING_MS = 20000;
// The search bar, gear and tabs are on screen before the view modules load. The LAST such tap (action or
// view, one slot shared with ui/router.js) runs once when it registers; any newer tap that runs drops it.
let held = null;   // { key: 'action:<name>' | 'view:<id>', run, until }

/**
 * Hold a tap whose action or view has not registered yet (replaces any earlier held tap).
 * @param {string} key 'action:<name>' or 'view:<id>'
 * @param {() => void} run
 */
export function holdTap(key, run) {
  held = { key, run, until: Date.now() + PENDING_MS };
}

/** A newer tap took effect: the held one no longer means anything. */
export function dropHeldTap() {
  held = null;
}

/**
 * `key` just registered: run its held tap once (next tick) if it is still fresh.
 * @param {string} key
 */
export function releaseHeldTap(key) {
  if (!held || held.key !== key) return;
  const h = held;
  held = null;
  if (Date.now() <= h.until) setTimeout(h.run, 0);
}

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
  releaseHeldTap("action:" + name);   // the user already tapped it while the app was still loading
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
 * @returns {boolean} true if a handler ran (even if it threw); false = not registered yet, held (see holdTap)
 */
export function runAction(name, dataset, event, ctx) {
  const fn = actions.get(name);
  if (!fn) {
    const ds = { ...(dataset || {}) };   // a snapshot: the element may be re-rendered before it runs
    holdTap("action:" + name, () => { const f = actions.get(name); if (f) call(name, f, ds, null, ctx); });
    console.warn("action not loaded yet (runs once it is):", name);
    return false;
  }
  dropHeldTap();   // this tap wins over an older one still waiting for its module
  call(name, fn, dataset, event, ctx);
  return true;
}

function call(name, fn, dataset, event, ctx) {
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
}

function isDisabled(el) {
  return el.disabled || el.getAttribute("aria-disabled") === "true";
}

/**
 * Replace a region's markup without dropping keyboard focus: if focus was on an element inside it, focus
 * its counterpart in the new markup (same data-action + id / i / trip / exact; or, for a focusable heading
 * like the trip title, the same classes). Live updates re-render regions every few seconds; without this a
 * keyboard or screen-reader user is thrown back to the top of the page.
 * @param {Element} el
 * @param {string} html
 */
export function setHTMLKeepFocus(el, html) {
  const a = typeof document !== "undefined" ? document.activeElement : null;
  const inside = !!a && a !== el && el.contains(a);
  const key = (b) => [b.getAttribute("data-action"), b.dataset.id, b.dataset.i, b.dataset.trip, b.dataset.exact].join("|");
  const was = inside && a.hasAttribute?.("data-action") ? key(a) : null;
  const cls = inside && !was && a.getAttribute?.("tabindex") === "-1" && a.classList?.length ? "." + [...a.classList].map((c) => CSS.escape(c)).join(".") : null;
  const assume = inside && a.closest?.("[data-assume]");
  el.innerHTML = html;
  if (!was && !cls) return;
  const b = was ? [...el.querySelectorAll("[data-action]")].find((x) => key(x) === was) || (assume && el.querySelector("[data-assume] button")) : el.querySelector(cls);
  b?.focus({ preventScroll: true });
}

/**
 * Keyboard users must not lose their place: if the focused button that ran an action was re-rendered
 * away (eye toggle, Favorite, End trip, ...) and focus fell back to <body>, focus its replacement (same
 * action + id, else same id, e.g. Show on map -> Stop showing), else the sheet title. Runs after the
 * store flush and re-render; does nothing when the action moved focus itself.
 * @param {HTMLElement} el the trigger (it had focus)
 * @param {HTMLElement} root delegation root
 */
function keepFocus(el, root) {
  const { action, id } = el.dataset;
  setTimeout(() => {
    const a = document.activeElement;
    if (el.isConnected || (a && a !== document.body && a !== document.documentElement)) return;
    const q = (sel) => [...root.querySelectorAll(sel), ...document.querySelectorAll(sel)].find((x) => !isDisabled(x) && x.getClientRects().length && !x.closest("[inert], [hidden]"));
    const esc = (v) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, "\\$&"));
    const next = (id != null && (q(`[data-action="${esc(action)}"][data-id="${esc(id)}"]`) || q(`button[data-id="${esc(id)}"]`)))
      || document.getElementById("title");
    next?.focus?.({ preventScroll: true });
  }, 0);
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
    const focused = document.activeElement === el;
    runAction(el.dataset.action, el.dataset, e, getCtx());
    if (focused) keepFocus(el, root);
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
    const focused = document.activeElement === el;
    runAction(el.dataset.action, el.dataset, e, getCtx());
    if (focused) keepFocus(el, root);
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
  held = null;
}

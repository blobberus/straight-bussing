/**
 * @module ui/contextbar
 * Map context bar (SHELL): a small floating bar under the status pill that says why the map shows
 * fewer routes than usual, with a one-tap way out.
 *   journey set          -> "Only showing routes for: <label>" + route chips + "Show all" (journey:end)
 *   custom route applied -> "My route: <name>" + "Clear" (custom:clear)
 * Registers the global actions `journey:end` and `custom:clear`; they work from any button in the
 * app (sheet content, dialogs, this bar) because actions are looked up by name at tap time.
 */
import { registerAction } from "./actions.js";
import { esc } from "../core/esc.js";
import { activeCustomRoute } from "../core/visibility.js";
import { clearCustom } from "../core/custom.js";
import { routeChip } from "./components.js";

const MAX_CHIPS = 4;

/**
 * Inner HTML of the context bar for a state ('' = hide the bar).
 * @param {object} state store state
 * @returns {string}
 */
export function contextBarHTML(state) {
  const j = state && state.journey;
  if (j && Array.isArray(j.rids) && j.rids.length) {
    const rids = j.rids.filter((r) => state.routes && state.routes[r]);
    const chips = rids.slice(0, MAX_CHIPS).map((r) => routeChip(r, state.routes, { small: true })).join("")
      + (rids.length > MAX_CHIPS ? `<span class="ctx-more">+${rids.length - MAX_CHIPS}</span>` : "");
    return `<span class="ctx-text"><span class="ctx-k">Only showing routes for:</span> <span class="ctx-v">${esc(j.label || "your trip")}</span></span>`
      + (chips ? `<span class="ctx-chips">${chips}</span>` : "")
      + '<button type="button" class="ctx-btn" data-action="journey:end">Show all</button>';
  }
  const c = activeCustomRoute(state || {});
  if (c) {
    return `<span class="ctx-text"><span class="ctx-k">My route:</span> <span class="ctx-v">${esc(c.name)}</span></span>`
      + `<button type="button" class="ctx-btn" data-action="custom:clear" aria-label="Clear my route ${esc(c.name)}">Clear</button>`;
  }
  return "";
}

/**
 * Store patch that ends a journey (station journeys also drop their station filter).
 * @param {object} state
 * @returns {object}
 */
export function endJourneyPatch(state) {
  const j = state && state.journey;
  const patch = { journey: null };
  if (j && j.kind === "station") patch.routeFilter = null;
  return patch;
}

/**
 * Register journey:end / custom:clear. Safe to call more than once (later call replaces).
 * @returns {void}
 */
export function registerContextActions() {
  registerAction("journey:end", (ds, ev, ctx) => {
    ctx.store.set(endJourneyPatch(ctx.store.get()));
  });
  registerAction("custom:clear", (ds, ev, ctx) => {
    const p = clearCustom(ctx.store.get());
    if (Object.keys(p).length) ctx.store.set(p);
  });
}

/**
 * Keep the bar element in sync with the store (patch only when the markup changes).
 * @param {HTMLElement|null} el
 * @param {{get():object, subscribe(fn):()=>void}} store
 * @returns {() => void} unsubscribe
 */
export function mountContextBar(el, store) {
  if (!el || !store) return () => {};
  let last = null;
  const draw = (s) => {
    const html = contextBarHTML(s);
    if (html === last) return;
    last = html;
    el.innerHTML = html;
    el.hidden = !html;
  };
  draw(store.get());
  return store.subscribe((s, changed) => {
    if (!changed || ["journey", "activeCustom", "customRoutes", "routes"].some((k) => changed.has(k))) draw(s);
  });
}

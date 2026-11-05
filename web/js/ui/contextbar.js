/**
 * @module ui/contextbar
 * The trip and filter chip under the search bar (docs/DESIGN-SPEC.md 10.5; was the "context bar"): says why the map shows
 * fewer routes than usual, with a one-tap way out. A 36 pt capsule: up to 3 route badges (then "+2"), the label, and a
 * 44 pt text button. Only the label truncates (an ellipsis); the badges and the action never clip (audit defect 2). The
 * same labels as the iPhone app's TripChip:
 *   journey (Directions trip) -> "Trip to <destination>"       + "Show all" (journey:end)
 *   journey (Routes to station) -> "Routes to <station>"       + "Show all"
 *   Lines by Time on          -> "Lines active at <time>"     + "Clear" (time:clear; core/custom.js clearTimeView)
 *   custom route applied      -> "<custom route name>"        + "Clear" (custom:clear)
 * Screen readers hear the full sentence ("Only showing routes for Trip to X", "Showing Lines active at 4:00 PM", "My
 * route: Morning commute"). Registers the global actions journey:end, custom:clear and time:clear; they work from any
 * button in the app (sheet content, dialogs, this chip) because actions are looked up by name at tap time.
 */
import { registerAction } from "./actions.js";
import { esc } from "../core/esc.js";
import { activeCustomRoute } from "../core/visibility.js";
import { clearCustom, clearTimeView } from "../core/custom.js";
import { routeChip } from "./components.js";

/** Route badges shown before "+N" (iOS TripChip.maxBadges). */
export const MAX_CHIPS = 3;

function chip(state, rids, label, spoken, btn) {
  const known = (rids || []).filter((r) => state.routes && state.routes[r]);
  const badges = known.slice(0, MAX_CHIPS).map((r) => routeChip(r, state.routes, { small: true })).join("")
    + (known.length > MAX_CHIPS ? `<span class="ctx-more">+${known.length - MAX_CHIPS}</span>` : "");
  return (badges ? `<span class="ctx-chips" aria-hidden="true">${badges}</span>` : "")
    + `<span class="ctx-text"><span class="sr">${esc(spoken)}</span><span class="ctx-v" aria-hidden="true">${esc(label)}</span></span>` + btn;
}

/**
 * Inner HTML of the chip for a state ('' = hide it).
 * @param {object} state store state
 * @returns {string}
 */
export function contextBarHTML(state) {
  const j = state && state.journey;
  if (j && Array.isArray(j.rids) && j.rids.length) {
    const label = j.kind === "plan" ? `Trip to ${j.to || String(j.label || "your destination").replace(/^To /, "")}` : `Routes to ${j.label || "station"}`;
    return chip(state, j.rids, label, `Only showing routes for ${label}`,
      '<button type="button" class="ctx-btn" data-action="journey:end" aria-label="Show all, every route on the map again">Show all</button>');
  }
  const tv = state && state.timeView;
  if (tv && tv.name) {
    return chip(state, tv.rids, tv.name, `Showing ${tv.name}`,
      `<button type="button" class="ctx-btn" data-action="time:clear" aria-label="Clear ${esc(tv.name)}, show your usual routes">Clear</button>`);
  }
  const c = activeCustomRoute(state || {});
  if (c) {
    return chip(state, c.rids, c.name, `My route: ${c.name}`,
      `<button type="button" class="ctx-btn" data-action="custom:clear" aria-label="Clear my route ${esc(c.name)}">Clear</button>`);
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
 * Register journey:end / custom:clear / time:clear. Safe to call more than once (later call replaces).
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
  registerAction("time:clear", (ds, ev, ctx) => {
    const p = clearTimeView(ctx.store.get());
    if (Object.keys(p).length) ctx.store.set(p);
  });
}

/**
 * Keep the chip element in sync with the store (patch only when the markup changes).
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
    if (!changed || ["journey", "activeCustom", "customRoutes", "routes", "timeView"].some((k) => changed.has(k))) draw(s);
  });
}

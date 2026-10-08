/**
 * @module ui/views/routes
 * Routes list: top actions "Routes to station..." (primary) and "Directions"; optional filter chip
 * "Routes to <station> x"; Running / Not running / Hidden groups; per-route eye toggle that writes
 * store.hiddenRoutes (persisted by state.js; honored by map, arrivals and Nearby).
 *
 * v2.1: a custom-route bar ("Make this a custom route" with an inline name field, or "Showing <name>"
 * with Clear / Update / Save as new), a journey note ("Only showing routes for <label>"), and an
 * "Edit map order" mode with Move up / Move down per route (store.routeOrder, drawn top-first).
 *
 * The view mounts and owns its DOM: two regions are patched in place on store changes
 * ([data-region="routes-top"], [data-region="routes-body"]); the top region is never touched while
 * its name field has focus, so typing is never interrupted by live updates.
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { runningCount } from "../../core/arrivals.js";
import { effectiveHidden, activeCustomRoute, drawOrder } from "../../core/visibility.js";
import { saveVisibleAsCustom, updateCustom, matchesCurrent, visibleRids, moveInOrder, cleanName } from "../../core/custom.js";
import { routeChip, emptyState, skeleton } from "../components.js";
import { OFFICIAL_HTML } from "./pick.js";

const EYE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYEOFF = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" opacity=".45"/><circle cx="12" cy="12" r="3" opacity=".45"/><path d="M3 3l18 18"/></svg>';
const UP = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
const DOWN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

/** View-local UI state (not in the store). mode: 'list' | 'order'. */
const R = { mode: "list", naming: false, draft: "" };
let rootRef = null, ctxRef = null, offStore = null, lastTop = null, lastBody = null, pendingFocus = null;

/**
 * Route ids sorted by short name (numeric aware), restricted to the active station filter.
 * @param {object} state
 * @returns {string[]}
 */
export function routeIds(state) {
  const Rt = state.routes || {};
  let ids = Object.keys(Rt).sort((a, b) => String(Rt[a].short || Rt[a].long || a).localeCompare(String(Rt[b].short || Rt[b].long || b), undefined, { numeric: true }));
  const f = state.routeFilter;
  if (f && Array.isArray(f.ids)) ids = ids.filter((i) => f.ids.includes(i));
  return ids;
}

/**
 * Group routes into running / not running / hidden (hidden = effectiveHidden: journey or user list).
 * @param {object} state
 * @returns {{running:string[], idle:string[], hidden:string[]}}
 */
export function groupRoutes(state) {
  const hiddenSet = new Set(effectiveHidden(state)), out = { running: [], idle: [], hidden: [] };
  for (const id of routeIds(state)) {
    if (hiddenSet.has(id)) out.hidden.push(id);
    else if (runningCount(state, id) > 0) out.running.push(id);
    else out.idle.push(id);
  }
  return out;
}

/**
 * The "Routes to <station> x" chip, or '' when no filter is active.
 * @param {object} state
 * @returns {string}
 */
export function filterChipHTML(state) {
  const f = state.routeFilter;
  if (!f) return "";
  return `<div class="v-fchip" role="status"><span class="v-fchip-t">Routes to ${esc(f.label || "station")}</span><button type="button" class="v-fchip-x" data-action="routes:clear-filter" aria-label="Clear station filter, show all routes"><span aria-hidden="true">&times;</span></button></div>`;
}

const nameOf = (state, id) => { const r = state.routes?.[id] || {}; return r.long || r.short || id; };

function row(state, id, hidden) {
  const r = state.routes[id] || {}, n = runningCount(state, id), name = nameOf(state, id);
  const tripOff = hidden && !!state.journey && !(state.hiddenRoutes || []).includes(id);   // hidden only by the journey
  const status = tripOff ? "Not part of this trip" : hidden ? "Hidden from map and times" : n ? `${n} bus${n > 1 ? "es" : ""} running` : "Not running";
  const eye = tripOff ? "" : `<button type="button" class="v-eye" data-action="routes:toggle" data-id="${esc(id)}" aria-pressed="${hidden ? "false" : "true"}" aria-label="${hidden ? "Show" : "Hide"} route ${esc(r.short || "")} ${esc(name)}">${hidden ? EYEOFF : EYE}</button>`;
  return `<div class="v-routerow${hidden ? " is-off" : ""}"><button type="button" class="v-row v-rowmain" data-action="route:open" data-id="${esc(id)}">${routeChip(id, state.routes)}<span class="v-grow"><span class="v-prim">${esc(name)}</span><span class="v-sec">${n && !hidden ? '<span class="v-livedot" aria-hidden="true"></span>' : ""}${esc(status)}</span></span></button>${eye}</div>`;
}

/**
 * Default name for a new custom route: "My route N" not already used.
 * @param {object} state
 * @returns {string}
 */
export function defaultName(state) {
  const used = new Set((state.customRoutes || []).map((c) => c.name));
  let n = (state.customRoutes || []).length + 1;
  while (used.has(`My route ${n}`)) n++;
  return `My route ${n}`;
}

/**
 * Custom-route / journey bar above the list ('' when there is nothing to offer).
 * @param {object} state
 * @param {{naming?:boolean, draft?:string}} [ui] view-local state
 * @returns {string}
 */
export function topBarHTML(state, ui = R) {
  if (!state.staticLoaded) return "";
  if (state.journey) {
    return `<div class="v-note rt-bar" role="status"><span class="v-grow">Only showing routes for ${esc(state.journey.label || "this trip")}</span><button type="button" class="v-btn v-btn--quiet" data-action="journey:end">Show all</button></div>`;
  }
  if (ui.naming) {
    return `<div class="rt-name"><label class="rt-namelab" for="rt-name-in">Name this custom route</label>`
      + `<input id="rt-name-in" type="text" data-input="routes-name" maxlength="60" enterkeyhint="done" autocomplete="off" value="${esc(ui.draft || defaultName(state))}">`
      + `<div class="v-actions rt-nameact"><button type="button" class="v-btn v-btn--secondary" data-action="routes:custom-cancel">Cancel</button><button type="button" class="v-btn v-btn--primary" data-action="routes:custom-save">Save</button></div></div>`;
  }
  const c = activeCustomRoute(state);
  if (c && matchesCurrent(state, c)) {
    return `<div class="v-note rt-bar" role="status"><span class="v-grow">Showing <strong class="rt-cname">${esc(c.name)}</strong></span><button type="button" class="v-btn v-btn--quiet" data-action="custom:clear" aria-label="Clear ${esc(c.name)}, show your usual routes">Clear</button></div>`;
  }
  if (c) {
    return `<div class="v-note rt-bar rt-bar--changed" role="status"><span class="v-grow"><strong class="rt-cname">${esc(c.name)}</strong> &middot; edited</span><button type="button" class="v-btn v-btn--quiet" data-action="custom:clear" aria-label="Clear ${esc(c.name)}, show your usual routes">Clear</button></div>`
      + `<div class="v-actions rt-cact"><button type="button" class="v-btn v-btn--secondary" data-action="routes:custom-update">Update<span class="v-sr"> ${esc(c.name)}</span></button><button type="button" class="v-btn v-btn--secondary" data-action="routes:custom-new">Save as new</button></div>`;
  }
  if ((state.hiddenRoutes || []).length && visibleRids(state).length) {
    return `<button type="button" class="v-btn v-btn--secondary v-btn--block rt-make" data-action="routes:custom-new">Make this a custom route</button>`;
  }
  return "";
}

/**
 * Map-order editor body.
 * @param {object} state
 * @returns {string}
 */
export function orderHTML(state) {
  const ids = drawOrder(state, null), last = ids.length - 1;
  let h = `<h3 class="v-h rt-ordertitle">Map order</h3><div class="rt-orderhead"><p class="v-sec rt-orderhelp">Routes higher in this list are drawn on top on the map.</p><button type="button" class="v-btn v-btn--primary rt-done" data-action="routes:order-done">Done</button></div>`;
  h += `<ol class="v-list rt-order" aria-label="Map drawing order, top first">`;
  ids.forEach((id, i) => {
    const name = esc(nameOf(state, id));
    h += `<li class="rt-orow">${routeChip(id, state.routes)}<span class="v-grow v-prim">${name}</span>`
      + `<button type="button" class="rt-move" data-action="routes:move" data-id="${esc(id)}" data-dir="up" aria-label="Move ${name} up"${i === 0 ? " disabled" : ""}>${UP}</button>`
      + `<button type="button" class="rt-move" data-action="routes:move" data-id="${esc(id)}" data-dir="down" aria-label="Move ${name} down"${i === last ? " disabled" : ""}>${DOWN}</button></li>`;
  });
  h += "</ol>";
  if ((state.routeOrder || []).length) h += `<button type="button" class="v-btn v-btn--quiet rt-reset" data-action="routes:order-reset">Reset order</button>`;
  return h;
}

/**
 * The list body (normal mode).
 * @param {object} state
 * @returns {string}
 */
export function listHTML(state) {
  const top = '<div class="v-actions"><button type="button" class="v-btn v-btn--primary" data-action="pick:open">Routes to station&hellip;</button><button type="button" class="v-btn v-btn--secondary" data-action="dir:open">Directions</button></div>';
  if (!state.staticLoaded) return top + skeleton(5);
  const g = groupRoutes(state);
  let h = top + filterChipHTML(state);
  const total = g.running.length + g.idle.length + g.hidden.length;
  if (!total) {
    return h + (state.routeFilter ? emptyState("No routes at this station", "Clear the filter to see every route.") : emptyState("No routes", "The schedule data did not load. Reload the app.") + OFFICIAL_HTML);
  }
  if (state.liveLoaded && !(state.buses || []).length && !state.routeFilter) h += emptyState("No shuttles running right now", "Routes are listed below for reference.") + OFFICIAL_HTML;
  const group = (title, ids, hidden, cls) => (ids.length ? `<h3 class="v-h">${title}</h3><div class="v-list${cls ? " " + cls : ""}">${ids.map((i) => row(state, i, hidden)).join("")}</div>` : "");
  h += group("Running", g.running, false, "");
  h += group("Not running", g.idle, false, state.liveLoaded && !(state.buses || []).length ? "is-dim" : "");
  h += group(state.journey ? "Not on this trip" : "Hidden", g.hidden, true, "");
  h += `<div class="rt-tools"><button type="button" class="v-btn v-btn--quiet" data-action="routes:order-edit">Edit map order</button></div>`;
  return h;
}

function topRegion(state) { return R.mode === "order" ? "" : topBarHTML(state); }
function bodyRegion(state) { return R.mode === "order" && state.staticLoaded ? orderHTML(state) : listHTML(state); }

/**
 * Render the routes view (both regions).
 * @param {object} state
 * @returns {string}
 */
export function renderRoutes(state) {
  return `<div data-region="routes-top">${topRegion(state)}</div><div data-region="routes-body">${bodyRegion(state)}</div>`;
}

/**
 * Toggle a route's visibility (store.hiddenRoutes; persisted by state.js).
 * @param {object} store
 * @param {string} rid
 * @returns {boolean} true if the route is now hidden
 */
export function toggleRoute(store, rid) {
  const cur = store.get().hiddenRoutes || [];
  const hide = !cur.includes(rid);
  store.set({ hiddenRoutes: hide ? [...cur, rid] : cur.filter((r) => r !== rid) });
  return hide;
}

/* ---------------- mounted DOM ---------------- */
const curState = () => ctxRef?.store?.get?.() || {};
const nameInput = () => rootRef?.querySelector?.('[data-input="routes-name"]') || null;

/** Patch both regions in place (the top is skipped while its field has focus, unless forced). */
function patch(force = false) {
  if (!rootRef) return;
  const s = curState();
  const top = rootRef.querySelector('[data-region="routes-top"]'), body = rootRef.querySelector('[data-region="routes-body"]');
  if (!top || !body) { rootRef.innerHTML = renderRoutes(s); lastTop = lastBody = null; return; }
  const inp = nameInput();
  if (force || !(inp && document.activeElement === inp)) {
    const th = topRegion(s);
    if (force || th !== lastTop) { top.innerHTML = th; lastTop = th; }
  }
  const bh = bodyRegion(s);
  if (force || bh !== lastBody) { body.innerHTML = bh; lastBody = bh; }
  if (pendingFocus) {
    const { sel, alt } = pendingFocus;
    pendingFocus = null;
    const b = rootRef.querySelector(sel), a = alt && rootRef.querySelector(alt);
    const t = b && !b.disabled ? b : a && !a.disabled ? a : b;
    t?.focus?.({ preventScroll: false });
  }
}

function onInput(e) {
  if (e.target?.matches?.('[data-input="routes-name"]')) R.draft = e.target.value;
}

function onKey(e) {
  if (!e.target?.matches?.('[data-input="routes-name"]')) return;
  if (e.key === "Enter") { e.preventDefault(); saveName(ctxRef); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelName(); }
}

function startNaming(ctx) {
  ctxRef = ctx || ctxRef;
  R.naming = true;
  R.draft = defaultName(curState());
  pendingFocus = null;
  patch(true);
  const inp = nameInput();
  if (inp) { inp.focus({ preventScroll: false }); inp.select?.(); }
}

function cancelName() {
  R.naming = false; R.draft = "";
  pendingFocus = { sel: '[data-action="routes:custom-new"]' };
  patch(true);
}

/**
 * Save what is visible now as a named custom route (applied), toast, stay here.
 * @param {object} ctx
 * @returns {string|null} new id
 */
export function saveName(ctx) {
  ctxRef = ctx || ctxRef;
  const store = ctxRef?.store;
  if (!store) return null;
  const inp = nameInput();
  const name = cleanName(inp ? inp.value : R.draft);
  const { id, patch: p } = saveVisibleAsCustom(store.get(), name);
  R.naming = false; R.draft = "";
  inp?.blur?.();
  store.set(p);
  ctxRef?.toast?.("Saved to My Routes");
  patch(true);
  return id;
}

/** Mount: listeners for the name field + a store subscription patching the two regions. */
export function mountRoutes(root, ctx) {
  unmountRoutes();
  rootRef = root; ctxRef = ctx; lastTop = lastBody = null;
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKey);
  offStore = ctx?.store?.subscribe?.(() => patch()) || null;
  patch();
}

/** Unmount: drop listeners; leave edit/naming modes. */
export function unmountRoutes() {
  if (rootRef) { rootRef.removeEventListener("input", onInput); rootRef.removeEventListener("keydown", onKey); }
  offStore?.(); offStore = null;
  rootRef = null;
  R.mode = "list"; R.naming = false; R.draft = "";
}

/** Test hook: view-local state. */
export const _ui = R;

registerView("routes", {
  title: () => "Routes",
  detent: "half",
  tab: "routes",
  render: (state) => renderRoutes(state),
  mount: (root, ctx) => mountRoutes(root, ctx),
  unmount: () => unmountRoutes(),
  refresh: () => patch(),
});

registerAction("routes:toggle", (ds, ev, ctx) => {
  const name = ctx.store.get().routes?.[ds.id]?.long || "Route";
  const hid = toggleRoute(ctx.store, ds.id);
  ctx.toast?.(hid ? `${name} hidden` : `${name} shown`);
});
registerAction("routes:clear-filter", (ds, ev, ctx) => ctx.store.set({ routeFilter: null }));
registerAction("routes:order-edit", (ds, ev, ctx) => {
  ctxRef = ctx || ctxRef; R.mode = "order"; R.naming = false;
  pendingFocus = { sel: '[data-action="routes:order-done"]' };
  patch(true);
});
registerAction("routes:order-done", (ds, ev, ctx) => {
  ctxRef = ctx || ctxRef; R.mode = "list";
  pendingFocus = { sel: '[data-action="routes:order-edit"]' };
  patch(true);
});
registerAction("routes:move", (ds, ev, ctx) => {
  ctxRef = ctx || ctxRef;
  const dir = ds.dir === "up" ? -1 : 1;
  const p = moveInOrder(ctx.store.get(), ds.id, dir);
  if (!p.routeOrder) return;
  const id = CSS.escape(ds.id);
  pendingFocus = { sel: `[data-action="routes:move"][data-id="${id}"][data-dir="${ds.dir}"]`, alt: `[data-action="routes:move"][data-id="${id}"][data-dir="${dir < 0 ? "down" : "up"}"]` };
  ctx.store.set(p);
  patch();
});
registerAction("routes:order-reset", (ds, ev, ctx) => {
  ctxRef = ctx || ctxRef;
  pendingFocus = { sel: '[data-action="routes:order-done"]' };
  ctx.store.set({ routeOrder: [] });
  ctx.toast?.("Map order reset");
  patch();
});
registerAction("routes:custom-new", (ds, ev, ctx) => startNaming(ctx));
registerAction("routes:custom-cancel", () => cancelName());
registerAction("routes:custom-save", (ds, ev, ctx) => { saveName(ctx); });
registerAction("routes:custom-update", (ds, ev, ctx) => {
  ctxRef = ctx || ctxRef;
  const s = ctx.store.get(), c = activeCustomRoute(s);
  if (!c) return;
  ctx.store.set(updateCustom(s, c.id, { rids: visibleRids(s) }));
  ctx.toast?.(`Updated ${c.name}`);
  pendingFocus = { sel: '[data-action="custom:clear"]' };
  patch();
});

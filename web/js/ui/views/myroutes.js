/**
 * @module ui/views/myroutes
 * My Routes tab: custom routes (named sets of shuttle routes, core/custom.js), favorite stations,
 * and the Service alerts / About rows. Tapping a custom route row shows it on the map (tap again to
 * stop) and stays on the list. Swiping a row left (Apple-Music style, ./myroutes-swipe.js) or its
 * "More" button reveals Details, Edit and Delete. Delete always asks in a popup (ui/confirm.js), from
 * the row, the detail view or the editor. Sub views: 'customroute' (detail of one custom route: show
 * on map, highlight routes, edit, delete) and 'customedit' (create / edit form).
 *
 * All three views mount() and own their DOM. Live updates are patched in through a small patcher
 * that waits while a finger is down (so a tap is never lost) and restores keyboard focus. The
 * editor renders once and never re-renders while it is open (typed text and checks are safe).
 */
import { registerView, currentParams } from "../router.js";
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { nowS } from "../../core/time.js";
import { hav } from "../../core/geo.js";
import { arrivalsFor, staleLevel, runningCount, activeAlerts } from "../../core/arrivals.js";
import { effectiveHidden } from "../../core/visibility.js";
import { createCustom, applyCustom, clearCustom, updateCustom, deleteCustom, toggleHighlight } from "../../core/custom.js";
import { routeChip, etaBlock, icon, emptyState, skeleton } from "../components.js";
import { confirmDialog } from "../confirm.js";
import { attachSwipe } from "./myroutes-swipe.js";

const SVG = (body, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const CHECK = SVG('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 16);
const STAR = SVG('<path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83-5.38 2.83 1.03-6L3.3 9.6l6-.9z"/>', 28);
const UP = SVG('<path d="M6 15l6-6 6 6"/>'), DOWN = SVG('<path d="M6 9l6 6 6-6"/>');
const PLUS = SVG('<path d="M12 5v14M5 12h14"/>');
const PENCIL = SVG('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>');
const TRASH = SVG('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>');
const INFO = SVG('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>');
const MORE = SVG('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>', 20);

/** View-local UI state (not in the store). swiped: id of the custom route whose action tray is open. */
const ui = { favEdit: false, swiped: null, err: "" };
let active = null;   // the mounted view's patcher

const longName = (rid, routes) => routes?.[rid]?.long || routes?.[rid]?.short || rid;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Patch a mounted view's root from a build function. Waits while a pointer is down, keeps focus.
 * @param {HTMLElement} root
 * @param {() => string} build
 * @returns {{flush():void, stop():void}}
 */
export function createPatcher(root, build) {
  let held = false, pending = false, last = root.innerHTML;
  const flush = () => {
    if (held) { pending = true; return; }
    pending = false;
    const h = build();
    if (h === last) return;
    const a = document.activeElement, had = a && root.contains(a) && a !== root;
    const sel = had && a.dataset?.action ? ["action", "id", "rid", "dir"].filter((k) => a.dataset[k] != null)
      .map((k) => `[data-${k}="${CSS.escape(a.dataset[k])}"]`).join("") : null;
    root.innerHTML = h;
    last = h;
    if (sel) root.querySelector(sel)?.focus({ preventScroll: true });
  };
  const down = () => { held = true; };
  const up = () => setTimeout(() => { held = false; if (pending) flush(); }, 0);
  root.addEventListener("pointerdown", down, true);
  root.addEventListener("pointerup", up, true);
  root.addEventListener("pointercancel", up, true);
  return {
    flush,
    stop() { root.removeEventListener("pointerdown", down, true); root.removeEventListener("pointerup", up, true); root.removeEventListener("pointercancel", up, true); },
  };
}

/** Mount a self-patching view; returns the def fields mount/unmount/refresh. */
function selfPatching(build) {
  let off = null;
  return {
    mount(root, ctx) {
      unmountActive();
      const p = createPatcher(root, () => build(ctx.store.get(), nowS()));
      off = ctx.store.subscribe(() => p.flush());
      active = { ...p, off: () => { off?.(); off = null; } };
      p.flush();
    },
    unmount: unmountActive,
    refresh: () => active?.flush(),
  };
}
function unmountActive() { if (active) { active.stop(); active.off(); active = null; } }

/* ---------------- My Routes (tab root) ---------------- */

function customRow(c, state) {
  const on = state.activeCustom === c.id, open = ui.swiped === c.id, id = esc(c.id), name = esc(c.name);
  const rids = c.rids.filter((r) => state.routes?.[r]);
  const chips = rids.slice(0, 6).map((r) => routeChip(r, state.routes, { small: true })).join("")
    + (rids.length > 6 ? `<span class="v-sec">+${rids.length - 6}</span>` : "");
  const label = `${c.name}, ${plural(rids.length, "route")}, ${on ? "showing on the map. Tap to stop showing" : "tap to show on the map"}`;
  // action tray behind the row; inert (not focusable, hidden from screen readers) until opened
  return `<div class="mr-swipe${open ? " is-open" : ""}" data-swipe-id="${id}" data-nodrag><div class="mr-acts"${open ? "" : " inert"}>`
    + `<button type="button" class="mr-act mr-act--info" data-action="mr:details" data-id="${id}" aria-label="Details for ${name}">${INFO}<span>Details</span></button>`
    + `<button type="button" class="mr-act mr-act--edit" data-action="mr:edit" data-id="${id}" aria-label="Edit ${name}">${PENCIL}<span>Edit</span></button>`
    + `<button type="button" class="mr-act mr-act--del" data-action="mr:del" data-id="${id}" data-from="list" aria-label="Delete ${name}">${TRASH}<span>Delete</span></button></div>`
    + `<div class="mr-front"><button type="button" class="v-row mr-crow${on ? " is-on" : ""}" data-action="mr:toggle" data-id="${id}" aria-pressed="${on}" aria-label="${esc(label)}">`
    + `<span class="v-grow"><span class="v-prim">${name}</span><span class="v-chips mr-chips" aria-hidden="true">${chips || '<span class="v-sec">No routes</span>'}</span></span>`
    + (on ? `<span class="mr-showing" aria-hidden="true">${CHECK}Showing</span>` : "") + "</button>"
    + `<button type="button" class="mr-ibtn mr-more" data-action="mr:swipe" data-id="${id}" aria-expanded="${open}" aria-label="More actions for ${name}">${MORE}</button></div></div>`;
}

function favRow(id, i, n, state, now, hidden, stale) {
  const st = state.stops?.[id];
  if (!st) return "";
  const name = esc(st.name || id);
  if (ui.favEdit) {
    return `<div class="v-row mr-favrow is-edit"><span class="v-grow"><span class="v-prim">${name}</span></span>`
      + `<button type="button" class="mr-ibtn" data-action="mr:favmove" data-id="${esc(id)}" data-dir="-1" aria-label="Move ${name} up"${i === 0 ? " disabled" : ""}>${UP}</button>`
      + `<button type="button" class="mr-ibtn" data-action="mr:favmove" data-id="${esc(id)}" data-dir="1" aria-label="Move ${name} down"${i === n - 1 ? " disabled" : ""}>${DOWN}</button>`
      + `<button type="button" class="v-btn v-btn--quiet mr-rm" data-action="mr:favrm" data-id="${esc(id)}" aria-label="Remove ${name} from favorites">Remove</button></div>`;
  }
  const a = state.liveLoaded ? arrivalsFor(state, id, { hidden, nowS: now })[0] : null;
  const sub = a ? longName(a.rid, state.routes) : state.liveLoaded ? "No upcoming buses on your visible routes" : "Waiting for live data";
  const when = a ? `, next bus ${longName(a.rid, state.routes)} in ${Math.max(0, Math.floor((a.t - now) / 60))} min` : "";
  return `<button type="button" class="v-row mr-favrow" data-action="stop:open" data-id="${esc(id)}" aria-label="${esc((st.name || id) + when)}">`
    + `<span class="v-grow" aria-hidden="true"><span class="v-prim">${name}</span><span class="v-sec">${a ? routeChip(a.rid, state.routes, { small: true }) + " " : ""}${esc(sub)}</span></span>`
    + (a ? `<span aria-hidden="true">${etaBlock(a.t, { stale, now })}</span>` : "") + "</button>";
}

/**
 * Render the My Routes tab.
 * @param {object} state
 * @param {number} [now]
 * @returns {string}
 */
export function renderMyRoutes(state, now = nowS()) {
  if (!state.staticLoaded) return skeleton(4);
  const customs = state.customRoutes || [];
  let h = '<div class="mr">';
  if (!customs.some((c) => c.id === ui.swiped)) ui.swiped = null;
  h += `<div class="mr-hrow"><h2 class="mr-h">Custom routes</h2>${customs.length ? `<button type="button" class="v-btn v-btn--quiet" data-action="mr:new">${PLUS}New</button>` : ""}</div>`;
  if (customs.length) h += '<div class="v-card mr-clist">' + customs.map((c) => customRow(c, state)).join("") + "</div>"
    + '<p class="v-foot mr-hint">Tap a custom route to show it on the map. Swipe left for details, edit or delete.</p>';
  else h += '<div class="mr-empty"><p class="v-prim">Save the routes you ride</p><p class="v-sec">Group routes into a named set, like your commute, and show just those on the map with one tap.</p>'
    + `<button type="button" class="v-btn v-btn--primary v-btn--block" data-action="mr:new">${PLUS}New custom route</button></div>`;

  const favs = (state.favStops || []).filter((id) => state.stops?.[id]);
  if (!favs.length) ui.favEdit = false;
  h += `<div class="mr-hrow"><h2 class="mr-h">Favorite stations</h2>${favs.length ? `<button type="button" class="v-btn v-btn--quiet" data-action="mr:favedit" data-id="fav" aria-pressed="${ui.favEdit}">${ui.favEdit ? "Done" : "Edit"}</button>` : ""}</div>`;
  if (favs.length) {
    const hidden = effectiveHidden(state), stale = staleLevel(state, now) !== "";
    h += '<div class="v-card">' + favs.map((id, i) => favRow(id, i, favs.length, state, now, hidden, stale)).join("") + "</div>";
  } else h += `<div class="mr-empty mr-empty--fav"><span class="mr-star" aria-hidden="true">${STAR}</span><p class="v-sec">Open a station on the map and tap Favorite. It will show up here with its next bus.</p></div>`;

  const n = activeAlerts(state, now).length;
  h += '<div class="v-card mr-more">'
    + `<button type="button" class="v-row" data-action="alerts:open" aria-label="Service alerts, ${n ? n + " active" : "none right now"}"><span class="v-ic" aria-hidden="true">${icon("alert")}</span><span class="v-grow" aria-hidden="true"><span class="v-prim">Service alerts</span><span class="v-sec">${n ? plural(n, "active alert") : "None right now"}</span></span>${n ? `<span class="badge mr-badge" aria-hidden="true">${n}</span>` : ""}<span class="mr-chev" aria-hidden="true">${icon("chevron", 18)}</span></button>`
    + `<button type="button" class="v-row" data-action="about:open"><span class="v-ic" aria-hidden="true">${icon("info")}</span><span class="v-grow"><span class="v-prim">About this app</span><span class="v-sec">Unofficial. Privacy, theme, official contact</span></span><span class="mr-chev" aria-hidden="true">${icon("chevron", 18)}</span></button></div>`;
  return h + "</div>";
}

/* ---------------- custom route detail ---------------- */

function findCustom(state, id) { return (state.customRoutes || []).find((c) => c.id === id) || null; }

/** Next arrival of a route at its stop nearest the user (null without location). */
function nearestNext(state, rid, now) {
  const u = state.user;
  if (!u || !state.liveLoaded) return null;
  let best = null;
  for (const sid of new Set(state.routeStops?.[rid] || [])) {
    const s = state.stops?.[sid];
    if (!s) continue;
    const d = hav(u, s);
    if (!best || d < best.d) best = { sid, d };
  }
  if (!best || best.d > 1500) return null;
  const a = arrivalsFor(state, best.sid, { routeId: rid, nowS: now })[0];
  return a ? { t: a.t, stop: state.stops[best.sid].name || best.sid } : null;
}

/**
 * Render a custom route's detail.
 * @param {object} state
 * @param {string} id custom route id
 * @param {number} [now]
 * @returns {string}
 */
export function renderCustom(state, id, now = nowS()) {
  if (!state.staticLoaded) return skeleton(4);
  const c = findCustom(state, id);
  if (!c) return emptyState("Custom route not found", "It may have been deleted.") + '<button type="button" class="v-btn v-btn--secondary v-btn--block" data-action="mr:home">Back to My Routes</button>';
  const on = state.activeCustom === c.id, rids = c.rids.filter((r) => state.routes?.[r]);
  const stale = staleLevel(state, now) !== "";
  let h = `<div class="mr mr-detail"><p class="v-status mr-status">${on ? `<span class="mr-showing">${CHECK}Showing on the map</span>` : "Not showing on the map"} &middot; ${plural(rids.length, "route")}</p>`;
  h += on ? '<button type="button" class="v-btn v-btn--primary v-btn--block" data-action="custom:clear">Stop showing</button>'
    : `<button type="button" class="v-btn v-btn--primary v-btn--block" data-action="mr:apply" data-id="${esc(c.id)}">Show on map</button>`;
  h += `<div class="v-actions mr-dacts"><button type="button" class="v-btn v-btn--secondary" data-action="mr:edit" data-id="${esc(c.id)}">${PENCIL}Edit</button>`
    + `<button type="button" class="v-btn v-btn--secondary mr-danger" data-action="mr:del" data-id="${esc(c.id)}" data-from="detail">${TRASH}Delete</button></div>`;
  h += '<div class="v-card">';
  for (const rid of rids) {
    const n = runningCount(state, rid), hl = (c.highlight || []).includes(rid), nx = nearestNext(state, rid, now);
    const run = n ? `${plural(n, "bus")} running` : "Not running right now";
    const next = nx ? ` · ${stale ? "~" : ""}${Math.max(0, Math.floor((nx.t - now) / 60))} min at ${nx.stop}` : "";
    h += `<div class="mr-rrow"><button type="button" class="v-row mr-rmain" data-action="route:open" data-id="${esc(rid)}">${routeChip(rid, state.routes)}<span class="v-grow"><span class="v-prim">${esc(longName(rid, state.routes))}</span><span class="v-sec">${n ? '<span class="v-livedot" aria-hidden="true"></span>' : ""}${esc(run + next)}</span></span></button>`
      + `<button type="button" class="mr-hl${hl ? " is-on" : ""}" data-action="mr:hl" data-id="${esc(c.id)}" data-rid="${esc(rid)}" aria-pressed="${hl}" aria-label="Highlight ${esc(longName(rid, state.routes))}">${hl ? CHECK : ""}Highlight</button></div>`;
  }
  if (!rids.length) h += '<p class="v-sec mr-pad">None of these routes are in the current schedule. Edit to choose others.</p>';
  h += "</div>";
  if (rids.length > 1) h += `<p class="v-foot">${on ? "Highlight dims the other routes in this set on the map." : "Highlights apply while this custom route is showing."}</p>`;
  return h + "</div>";
}

/* ---------------- editor ---------------- */

function checkRow(rid, state, on) {
  return `<label class="v-row mr-check"><input type="checkbox" name="rid" value="${esc(rid)}"${on ? " checked" : ""}>${routeChip(rid, state.routes)}<span class="v-grow"><span class="v-prim">${esc(longName(rid, state.routes))}</span></span></label>`;
}

/**
 * Render the create/edit form.
 * @param {object} state
 * @param {string|null} id custom route id, null to create
 * @returns {string}
 */
export function renderEditor(state, id) {
  if (!state.staticLoaded) return skeleton(4);
  const c = id ? findCustom(state, id) : null;
  if (id && !c) return emptyState("Custom route not found", "It may have been deleted.") + '<button type="button" class="v-btn v-btn--secondary v-btn--block" data-action="mr:home">Back to My Routes</button>';
  const name = c ? c.name : `My route ${(state.customRoutes || []).length + 1}`;
  const sel = new Set(c ? c.rids : []);
  const all = Object.keys(state.routes || {});
  const running = all.filter((r) => runningCount(state, r) > 0), idle = all.filter((r) => !running.includes(r));
  const group = (title, list) => list.length ? `<fieldset class="mr-fs"><legend class="mr-label">${title}</legend><div class="v-card">${list.map((r) => checkRow(r, state, sel.has(r))).join("")}</div></fieldset>` : "";
  return `<form class="mr mr-edit" data-form="mr-edit" data-id="${esc(c ? c.id : "")}" novalidate>`
    + `<label class="mr-label" for="mr-name">Name</label><input id="mr-name" class="mr-input" type="text" name="name" maxlength="60" autocomplete="off" enterkeyhint="done" value="${esc(name)}">`
    + `<p class="mr-label mr-routesq">Routes</p>${group("Running now", running)}${group("Not running", idle)}`
    + '<p class="mr-err" role="alert" data-region="mr-err"></p>'
    + '<div class="v-actions"><button type="button" class="v-btn v-btn--secondary" data-action="mr:cancel">Cancel</button><button type="submit" class="v-btn v-btn--primary">Save</button></div>'
    + (c ? `<button type="button" class="v-btn v-btn--quiet v-btn--block mr-danger mr-editdel" data-action="mr:del" data-id="${esc(c.id)}" data-from="edit">${TRASH}Delete custom route</button>` : "") + "</form>";
}

/** Fit the map to a set of routes' shapes. */
function fitRoutes(ctx, rids) {
  const s = ctx.store.get(), pts = [];
  for (const r of rids) for (const line of s.shapes?.[r] || []) pts.push(...line);
  if (pts.length) try { ctx.map?.fitTo?.(pts, { maxZoom: 16 }); } catch (e) { /* map optional */ }
}

/**
 * Save the editor form (create + apply, or update). Shows an inline error when no route is checked.
 * @param {HTMLFormElement} form
 * @param {object} ctx
 * @returns {string|null} saved id, or null when invalid
 */
export function saveEditor(form, ctx) {
  const rids = [...form.querySelectorAll('input[name="rid"]:checked')].map((i) => i.value);
  const name = form.querySelector('input[name="name"]')?.value || "";
  const err = form.querySelector('[data-region="mr-err"]');
  if (!rids.length) {
    if (err) err.textContent = "Choose at least one route.";
    form.querySelector('input[name="rid"]')?.focus();
    return null;
  }
  const s = ctx.store.get(), id = form.dataset.id;
  if (id && findCustom(s, id)) {
    ctx.store.set(updateCustom(s, id, { name, rids }));
    ctx.back();
    if (s.activeCustom === id) fitRoutes(ctx, rids);
    return id;
  }
  const made = createCustom(s, { name, rids });
  ctx.store.set({ ...made.patch, ...applyCustom({ ...s, ...made.patch }, made.id) });
  ctx.back();
  ctx.navigate("customroute", { id: made.id });
  fitRoutes(ctx, rids);
  ctx.toast?.("Saved to My Routes");
  return made.id;
}

let editRoot = null, editCtx = null;
function onSubmit(e) { e.preventDefault(); if (editCtx) saveEditor(e.target, editCtx); }
function onEditInput(e) {
  if (e.target?.name !== "rid") return;
  const err = editRoot?.querySelector('[data-region="mr-err"]');
  if (err && err.textContent) err.textContent = "";
}
function unmountEditor() {
  if (editRoot) { editRoot.removeEventListener("submit", onSubmit); editRoot.removeEventListener("change", onEditInput); }
  editRoot = editCtx = null;
  unmountActive();
}

/* ---------------- registration ---------------- */

const listView = selfPatching((state, now) => renderMyRoutes(state, now));
let swipeOff = null;
registerView("myroutes", {
  title: () => "My Routes",
  detent: "half",
  tab: "myroutes",
  render: (state) => renderMyRoutes(state),
  ...listView,
  mount(root, ctx) {
    listView.mount(root, ctx);
    swipeOff?.();
    swipeOff = attachSwipe(root, { getOpen: () => ui.swiped, setOpen: (id) => { ui.swiped = id; active?.flush(); } });
  },
  unmount() { swipeOff?.(); swipeOff = null; ui.swiped = null; listView.unmount(); },
});

registerView("customroute", {
  title: (state) => findCustom(state, currentParams().id)?.name || "Custom route",
  parent: "myroutes",
  detent: "half",
  tab: "myroutes",
  render: (state) => renderCustom(state, currentParams().id),
  ...selfPatching((state, now) => renderCustom(state, currentParams().id, now)),
});

registerView("customedit", {
  title: () => (currentParams().id ? "Edit custom route" : "New custom route"),
  parent: "myroutes",
  detent: "full",
  tab: "myroutes",
  render: (state) => renderEditor(state, currentParams().id || null),
  mount(root, ctx) {
    unmountActive();
    editRoot = root; editCtx = ctx;
    root.addEventListener("submit", onSubmit);
    root.addEventListener("change", onEditInput);
    // render once; only re-render if static data arrives after mounting (form not yet shown)
    let off = null;
    if (!ctx.store.get().staticLoaded) off = ctx.store.subscribe((s) => { if (s.staticLoaded && editRoot === root) { root.innerHTML = renderEditor(s, currentParams().id || null); off?.(); off = null; } });
    active = { flush() {}, stop() {}, off: () => { off?.(); off = null; } };
  },
  unmount: unmountEditor,
});

registerAction("mr:new", (ds, ev, ctx) => ctx.navigate("customedit", {}));
registerAction("mr:edit", (ds, ev, ctx) => { ui.swiped = null; ctx.navigate("customedit", { id: ds.id }); });
registerAction("mr:cancel", (ds, ev, ctx) => ctx.back());
registerAction("mr:home", (ds, ev, ctx) => ctx.navigate("myroutes"));
/** Row tap: show the custom route on the map (or stop showing it); stays on the list. */
registerAction("mr:toggle", (ds, ev, ctx) => {
  const s = ctx.store.get(), c = findCustom(s, ds.id);
  if (!c) return;
  if (s.activeCustom === c.id) { ctx.store.set(clearCustom(s)); ctx.toast?.("Showing your usual routes"); return; }
  ctx.store.set(applyCustom(s, c.id));
  fitRoutes(ctx, c.rids);
});
/** "More" button: the keyboard / screen-reader / mouse equivalent of swiping a row. */
registerAction("mr:swipe", (ds, ev, ctx) => {
  ui.swiped = ui.swiped === ds.id ? null : ds.id;
  active?.flush();
  if (ui.swiped) document.querySelector(`.mr-swipe[data-swipe-id="${CSS.escape(ds.id)}"] .mr-act`)?.focus({ preventScroll: true });
});
registerAction("mr:details", (ds, ev, ctx) => { ui.swiped = null; ctx.navigate("customroute", { id: ds.id }); });
registerAction("mr:apply", (ds, ev, ctx) => {
  const s = ctx.store.get(), c = findCustom(s, ds.id);
  if (!c) return;
  ctx.store.set(applyCustom(s, c.id));
  fitRoutes(ctx, c.rids);
});
registerAction("mr:hl", (ds, ev, ctx) => ctx.store.set(toggleHighlight(ctx.store.get(), ds.id, ds.rid)));
/**
 * Delete, only after the confirmation popup (Cancel is focused; Escape / outside tap cancel).
 * `from` (list | detail | edit) decides where you land afterwards. Returns whether it deleted.
 */
export async function deleteWithConfirm(ds, ctx) {
  const c = findCustom(ctx.store.get(), ds.id);
  if (!c) return false;
  const yes = await confirmDialog({ title: `Delete “${c.name}”?`, body: "This custom route will be removed from My Routes. This can’t be undone.", confirmLabel: "Delete", danger: true });
  const s = ctx.store.get();
  if (!yes || !findCustom(s, c.id)) return false;
  ctx.store.set(deleteCustom(s, c.id));   // if it was showing, the usual routes come back (core/custom.js)
  ui.swiped = null;
  ctx.toast?.(`Deleted “${c.name}”`);
  if (ds.from === "detail") ctx.back();
  else if (ds.from === "edit") ctx.navigate("myroutes");   // the detail behind the editor is gone too
  else active?.flush();
  return true;
}
registerAction("mr:del", (ds, ev, ctx) => { deleteWithConfirm(ds, ctx); });
registerAction("mr:favedit", () => { ui.favEdit = !ui.favEdit; active?.flush(); });
registerAction("mr:favrm", (ds, ev, ctx) => ctx.store.set({ favStops: (ctx.store.get().favStops || []).filter((x) => x !== ds.id) }));
registerAction("mr:favmove", (ds, ev, ctx) => {
  const f = (ctx.store.get().favStops || []).slice(), i = f.indexOf(ds.id), j = i + (Number(ds.dir) < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= f.length) return;
  [f[i], f[j]] = [f[j], f[i]];
  ctx.store.set({ favStops: f });
});

/** Test hook: view-local UI state. */
export const _ui = ui;

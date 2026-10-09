/**
 * @module ui/views/pick
 * "Routes to station..." flow. A dialog asks how to find the station (current location, select a
 * station by name, or type an address/place). Nothing is highlighted until the user chooses.
 * Then nearby stops (<= 1.5 km) are listed and ring-highlighted on the map; choosing one sets
 * store.routeFilter {ids, label} and goes to the Routes view. Works without location permission.
 * The picker belongs to the Plan Trip tab (view id 'nearby'; opened by its "Routes to station…" button).
 * Once a mode is chosen, a switch "Only show the chosen station's routes" (off by default, remembered
 * for the session) also starts a station journey (store.journey, see ./journey.js) on choosing.
 * Also exports small helpers shared by the other D2 views (station matching, place search, official links).
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { hav, walkMin } from "../../core/geo.js";
import { searchPlaces, debounce } from "../../data/geocode.js";
import { officialLinks } from "../components.js";
import { onlySwitchHTML, filterJourney, watchStation } from "./journey.js";

/** Radius for "stops near here" in the picker (meters). */
export const PICK_RADIUS_M = 1500;
const SVG = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
/** Inline SVG icons used by the D2 views. */
export const ICONS = {
  loc: SVG('<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
  stop: SVG('<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 21l1-3M16 21l-1-3"/>'),
  place: SVG('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  search: SVG('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  chev: SVG('<path d="M9 6l6 6-6 6"/>'),
};

/** Official service links (shown in empty/error states). */
export const OFFICIAL_HTML = '<p class="v-official">' + officialLinks() + "</p>";

/**
 * "4 min walk · 320 m" for a distance in meters.
 * @param {number} d meters (straight line)
 * @returns {string} plain text (escape before use if mixed with user text)
 */
export function walkText(d) {
  return Math.max(1, Math.round(walkMin(d * 1.2))) + " min walk · " + Math.round(d) + " m";
}

/**
 * Stops served by at least one route within maxM of a point, nearest first.
 * @param {object} state store state (stops, stopRoutes)
 * @param {{lat:number, lon:number}} point
 * @param {{maxM?:number, max?:number, hidden?:string[]}} [opts] hidden: routes that do not count as serving
 * @returns {{id:string,name:string,lat:number,lon:number,d:number}[]}
 */
export function stopsNear(state, point, { maxM = PICK_RADIUS_M, max = 5, hidden = [] } = {}) {
  if (!point || !isFinite(point.lat) || !isFinite(point.lon)) return [];
  const out = [];
  for (const [id, s] of Object.entries(state.stops || {})) {
    const rs = (state.stopRoutes?.[id] || []).filter((r) => !hidden.includes(r));
    if (!rs.length || !s || !isFinite(s.lat)) continue;
    const d = hav(point, s);
    if (d <= maxM) out.push({ id, name: s.name, lat: s.lat, lon: s.lon, d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max);
}

/**
 * Stations whose name contains the query (prefix/word matches first, then alphabetical).
 * Empty query returns every served station alphabetically.
 * @param {object} state
 * @param {string} q
 * @param {number} [max=40]
 * @returns {{id:string,name:string,lat:number,lon:number}[]}
 */
export function matchStations(state, q, max = 40) {
  const needle = String(q || "").trim().toLowerCase();
  const rank = (n) => (!needle ? 0 : n.startsWith(needle) ? 0 : n.includes(" " + needle) ? 1 : 2);
  return Object.entries(state.stops || {})
    .filter(([id, s]) => s && (state.stopRoutes?.[id] || []).length && (!needle || s.name.toLowerCase().includes(needle)))
    .map(([id, s]) => ({ id, name: s.name, lat: s.lat, lon: s.lon, r: rank(s.name.toLowerCase()) }))
    .sort((a, b) => a.r - b.r || a.name.localeCompare(b.name, undefined, { numeric: true }))
    .slice(0, max);
}

/** Injectable place-search backend shared by the picker, Nearby and Directions (tests stub it). */
export const placeDeps = { search: searchPlaces };

/**
 * Debounced Photon place search with abort + status. Only the typed text leaves the device.
 * @param {(s:{q:string, items:object[], status:''|'busy'|'err'})=>void} onChange called when results arrive
 * @param {{search?:Function, ms?:number}} [opts] search defaults to placeDeps.search (data/geocode.js searchPlaces)
 * @returns {{state:{q:string, items:object[], status:string}, query(q:string):void, cancel():void}}
 */
export function createPlaceSearch(onChange, { search = (q, o) => placeDeps.search(q, o), ms = 400 } = {}) {
  const st = { q: "", items: [], status: "" };
  let ctl = null;
  const run = debounce(async (q) => {
    ctl?.abort();
    const mine = (ctl = new AbortController());
    let r;
    try { r = await search(q, { signal: mine.signal }); } catch (e) { r = { items: [], error: "network" }; }
    if (mine.signal.aborted || st.q !== q) return;
    const items = Array.isArray(r) ? r : r?.items || [];
    const err = !Array.isArray(r) && r?.error && r.error !== "aborted";
    st.items = items; st.status = err ? "err" : "";
    onChange(st);
  }, ms);
  return {
    state: st,
    query(q) {
      q = String(q || "").trim();
      if (q === st.q && st.status !== "err") return;
      st.q = q;
      if (q.length < 3) { run.cancel(); ctl?.abort(); st.items = []; st.status = ""; return; }
      st.status = "busy"; run(q);
    },
    cancel() { run.cancel(); ctl?.abort(); },
  };
}

/** Rows for a list of places; each button carries data-action + data-i. */
export function placeRows(items, action) {
  return '<div class="v-card">' + items.map((p, i) => `<button type="button" class="v-row" data-action="${action}" data-i="${i}"><span class="v-ic" aria-hidden="true">${ICONS.place}</span><span class="v-grow"><span class="v-prim">${esc(p.label)}</span><span class="v-sec">${esc(p.sub || "")}</span></span></button>`).join("") + "</div>";
}

/* ---------------- picker state machine ---------------- */

/** @type {{mode:null|'loc'|'sel'|'addr', q:string, anchor:null|{label:string,lat:number,lon:number}, locWait:boolean}} */
export const P = { mode: null, q: "", anchor: null, locWait: false };
/** Session preference (survives resetPick): choosing a station also hides every other route. */
export const PREF = { only: false };
let ctxRef = null, rootRef = null, offStore = null, dlg = null;
const places = createPlaceSearch(() => patchList());

/** Reset the picker to "nothing chosen". */
export function resetPick() {
  P.mode = null; P.q = ""; P.anchor = null; P.locWait = false; places.cancel();
  places.state.q = ""; places.state.items = []; places.state.status = "";
}

/** Items to list/highlight for the current mode. */
export function pickItems(state) {
  if (P.mode === "loc") return state.user ? stopsNear(state, state.user) : [];
  if (P.mode === "addr") return P.anchor ? stopsNear(state, P.anchor) : [];
  if (P.mode === "sel") return matchStations(state, P.q, 40).map((s) => ({ ...s, d: state.user ? hav(state.user, s) : null }));
  return [];
}

function rname(state, r) { return state.routes?.[r]?.short || state.routes?.[r]?.long || r; }

function stationRows(state, items) {
  return '<div class="v-card">' + items.map((s) => `<button type="button" class="v-row" data-action="pick:choose" data-id="${esc(s.id)}"><span class="v-grow"><span class="v-prim">${esc(s.name)}</span><span class="v-sec">${s.d != null ? esc(walkText(s.d)) + " &middot; " : ""}${esc((state.stopRoutes?.[s.id] || []).map((r) => rname(state, r)).join(", "))}</span></span><span class="v-chev" aria-hidden="true">${ICONS.chev}</span></button>`).join("") + "</div>";
}

function modeButton(mode, primary) {
  const t = { loc: ["Use current location", "Stops within 1.5 km of you", ICONS.loc], sel: ["Select a station", "Search by station name", ICONS.stop], addr: ["Type an address or place", "Find stops near a building or street", ICONS.place] }[mode];
  return `<button type="button" class="v-row v-choice${primary ? " v-choice--primary" : ""}" data-action="pick:mode" data-mode="${mode}"><span class="v-ic" aria-hidden="true">${t[2]}</span><span class="v-grow"><span class="v-prim">${t[0]}</span><span class="v-sec">${t[1]}</span></span></button>`;
}

/** Markup for the three-way chooser (used inline and inside the dialog). */
export function chooserHTML() {
  return `<div class="v-card v-choices">${modeButton("loc")}${modeButton("sel")}${modeButton("addr")}</div>`;
}

function otherModes(cur) {
  const others = ["loc", "sel", "addr"].filter((m) => m !== cur);
  const label = { loc: "Use my location", sel: "Select a station", addr: "Type an address" };
  return `<div class="v-alt">${others.map((m) => `<button type="button" class="v-link" data-action="pick:mode" data-mode="${m}">${label[m]}</button>`).join("")}</div>`;
}

/** List region for the current mode (also used for in-place updates). */
export function pickListHTML(state) {
  const items = pickItems(state);
  if (P.mode === "addr" && !P.anchor) {
    const s = places.state, q = P.q.trim();
    if (q.length < 3) return '<p class="v-hint">Type at least 3 letters of an address, building or place.</p>';
    if (s.status === "busy") return '<p class="v-hint" role="status">Searching places&hellip;</p>';
    if (s.status === "err") return '<div class="v-empty"><b>Could not search places right now</b><span>Check your connection, or select a station by name.</span></div>' + modeButton("sel", true);
    if (!s.items.length) return '<div class="v-empty"><b>No places found</b><span>Check the spelling or try a nearby landmark.</span></div>';
    return placeRows(s.items, "pick:place");
  }
  if (P.mode === "loc" && !state.user) {
    if (P.locWait || state.locState === "asking") return '<p class="v-hint" role="status">Finding your location&hellip;</p>';
    return '<div class="v-empty"><b>Location unavailable</b><span>You can still find a station without sharing your location.</span></div>' + modeButton("sel", true) + modeButton("addr");
  }
  if (!items.length) {
    if (P.mode === "sel") return '<div class="v-empty"><b>No matching stations</b><span>Check the spelling, or type an address instead.</span></div>' + modeButton("addr");
    const where = P.mode === "addr" ? esc(P.anchor.label) : "you";
    return `<div class="v-empty"><b>No stops within 1.5 km of ${where}</b><span>Try another place or select a station by name.</span></div>` + modeButton("sel", true);
  }
  return stationRows(state, items);
}

function field(placeholder, label) {
  return `<label class="v-search"><span class="v-ic" aria-hidden="true">${ICONS.search}</span><span class="v-sr">${label}</span><input type="search" data-input="pick-q" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${placeholder}" value="${esc(P.q)}"></label>`;
}

/**
 * Render the picker for the current mode.
 * @param {object} state
 * @returns {string}
 */
export function renderPick(state) {
  if (!P.mode) return '<div class="v-pick"><p class="v-lead">Find the station first. Nothing is shared until you choose.</p>' + chooserHTML() + "</div>";
  let head = "";
  if (P.mode === "sel") head = field("Search station name", "Search station name");
  else if (P.mode === "addr" && P.anchor) head = `<div class="v-anchor"><span class="v-grow"><span class="v-sec">Stops within 1.5 km of</span><span class="v-prim">${esc(P.anchor.label)}</span></span><button type="button" class="v-btn v-btn--quiet" data-action="pick:change-place">Change</button></div>`;
  else if (P.mode === "addr") head = field("Address, building or place", "Address or place") + '<p class="v-fine">Places near campus are searched on your device; otherwise only the text you type is sent to photon.komoot.io.</p>';
  else head = '<p class="v-lead">Nearest stops within 1.5 km of you. Tap one to see its routes.</p>';
  return `<div class="v-pick" data-mode="${P.mode}">${head}${onlySwitchHTML(PREF.only)}<div class="v-list" data-region="pick-list">${pickListHTML(state)}</div>${otherModes(P.mode)}</div>`;
}

function curState() { return ctxRef?.store?.get?.() || {}; }

let lastList = null;
function patchList() {
  const el = rootRef?.querySelector?.('[data-region="pick-list"]');
  const html = pickListHTML(curState());
  if (el && html !== lastList) { el.innerHTML = html; lastList = html; }
  highlight();
}

function rerender(focus) {
  if (!rootRef) return;
  lastList = null;
  rootRef.innerHTML = renderPick(curState());
  highlight(true);
  if (focus) rootRef.querySelector('[data-input="pick-q"]')?.focus({ preventScroll: true });
}

/** Ring-highlight the listed stops on the map (none until a mode is chosen). */
export function highlight(fit) {
  const map = ctxRef?.map, state = curState();
  if (!map?.highlightStops) return;
  const show = P.mode === "loc" || (P.mode === "addr" && P.anchor) || (P.mode === "sel" && P.q.trim());
  const items = show ? pickItems(state).slice(0, 12) : [];
  if (!items.length) { map.highlightStops(null); return; }
  map.highlightStops(items.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon })), { onPick: (id) => chooseStation(id, ctxRef) });
  if (fit && map.fitTo) {
    const pts = items.map((s) => [s.lat, s.lon]);
    const anchor = P.mode === "addr" ? P.anchor : P.mode === "loc" ? state.user : null;
    if (anchor) pts.push([anchor.lat, anchor.lon]);
    try { map.fitTo(pts, { maxZoom: 17 }); } catch (e) { /* map optional */ }
  }
}

/**
 * Choose a picker mode (from the dialog or inline). Navigates to the picker if needed.
 * @param {'loc'|'sel'|'addr'} mode
 * @param {object} ctx
 */
export async function setMode(mode, ctx) {
  if (!["loc", "sel", "addr"].includes(mode)) return;
  ctxRef = ctx || ctxRef;
  resetPick(); P.mode = mode;
  const state = curState();
  if (state.view !== "pick") ctxRef?.navigate?.("pick");
  else rerender(mode !== "loc");
  if (mode === "loc" && !state.user && ctxRef?.locate) {
    P.locWait = true; patchList();
    let okLoc = false;
    try { okLoc = await ctxRef.locate(); } catch (e) { okLoc = false; }
    if (P.mode !== "loc") return;
    P.locWait = false;
    if (rootRef) { patchList(); if (okLoc) highlight(true); }
  }
}

/**
 * Pick a station: filter routes to the ones serving it and go to Routes.
 * @param {string} id stop id
 * @param {object} ctx
 * @returns {boolean} false if the stop serves no routes
 */
export function chooseStation(id, ctx) {
  ctx = ctx || ctxRef;
  const state = ctx?.store?.get?.() || {};
  const ids = [...new Set(state.stopRoutes?.[id] || [])];
  if (!ids.length) return false;
  const routeFilter = { ids, label: state.stops?.[id]?.name || "station" }, patch = { routeFilter };
  if (PREF.only) { const j = filterJourney({ ...state, routeFilter }); if (j) patch.journey = j; }
  watchStation(ctx.store);   // a station journey follows the filter (cleared filter ends it)
  ctx.store.set(patch);
  try { ctx.map?.highlightStops?.(null); } catch (e) { /* map optional */ }
  resetPick();
  ctx.navigate?.("routes");
  const pts = ids.flatMap((r) => (state.shapes?.[r] || []).flat());
  if (pts.length) try { ctx.map?.fitTo?.(pts, { maxZoom: 16 }); } catch (e) { /* map optional */ }
  return true;
}

/**
 * Open the "Routes to station" dialog. Falls back to the inline chooser if <dialog> is unavailable.
 * @param {object} ctx
 * @param {Element} [opener] element to refocus on cancel
 * @returns {HTMLDialogElement|null}
 */
export function openPickDialog(ctx, opener) {
  ctxRef = ctx || ctxRef;
  if (typeof document === "undefined" || typeof HTMLDialogElement === "undefined") { resetPick(); ctxRef?.navigate?.("pick"); return null; }
  if (!dlg || !dlg.isConnected) {
    dlg = document.createElement("dialog");
    dlg.className = "v-dialog";
    dlg.setAttribute("aria-labelledby", "v-dlg-title");
    dlg.innerHTML = '<h2 class="v-dlg-title" id="v-dlg-title" tabindex="-1" autofocus>Routes to station</h2><p class="v-sec v-dlg-sub">How do you want to find the station?</p>' + chooserHTML() + '<button type="button" class="v-btn v-btn--quiet v-dlg-cancel" data-dlg-cancel>Cancel</button>';
    dlg.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-mode],[data-dlg-cancel]");
      if (e.target === dlg || b?.hasAttribute("data-dlg-cancel")) { dlg.close("cancel"); return; }
      if (b?.dataset.mode) { dlg.close(b.dataset.mode); setMode(b.dataset.mode, ctxRef); }
    });
    dlg.addEventListener("close", () => { if (dlg.returnValue === "cancel" || !dlg.returnValue) dlg._opener?.focus?.(); });
    document.body.appendChild(dlg);
  }
  dlg._opener = opener || document.activeElement;
  dlg.returnValue = "";
  try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
  // focus the title, not the first choice: no option should look pre-selected
  dlg.querySelector("#v-dlg-title")?.focus();
  return dlg;
}

function onInput(e) {
  const t = e.target;
  if (!t?.matches?.('[data-input="pick-q"]')) return;
  P.q = t.value;
  if (P.mode === "addr") places.query(P.q);
  patchList();
}

function onKey(e) {
  if (e.key !== "Enter" || !e.target?.matches?.('[data-input="pick-q"]')) return;
  e.preventDefault();
  if (P.mode === "sel") { const first = pickItems(curState())[0]; if (first) chooseStation(first.id, ctxRef); }
  else if (P.mode === "addr" && places.state.items[0]) { P.anchor = places.state.items[0]; rerender(false); }
}

/** Mount: delegated input handling, store subscription, map highlight. */
export function mountPick(root, ctx) {
  unmountPick();
  rootRef = root; ctxRef = ctx; lastList = null;
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKey);
  offStore = ctx?.store?.subscribe?.((s, changed) => {
    if (changed.has("user") || changed.has("locState") || changed.has("staticLoaded")) patchList();
  }) || null;
  highlight(true);
  if (P.mode === "sel" || (P.mode === "addr" && !P.anchor)) root.querySelector('[data-input="pick-q"]')?.focus({ preventScroll: true });
}

/** Unmount: clear highlights and listeners. */
export function unmountPick() {
  if (rootRef) { rootRef.removeEventListener("input", onInput); rootRef.removeEventListener("keydown", onKey); }
  offStore?.(); offStore = null;
  try { ctxRef?.map?.highlightStops?.(null); } catch (e) { /* map optional */ }
  rootRef = null;
}

registerView("pick", {
  title: () => "Routes to station",
  parent: "nearby",
  detent: "half",
  tab: "nearby",
  render: (state) => renderPick(state),
  mount: (root, ctx) => mountPick(root, ctx),
  unmount: () => unmountPick(),
  onStopTap: (id, ctx) => chooseStation(id, ctx),
});

registerAction("pick:open", (ds, ev, ctx) => openPickDialog(ctx, ev?.target?.closest?.("button")));
registerAction("pick:mode", (ds, ev, ctx) => setMode(ds.mode, ctx));
registerAction("pick:choose", (ds, ev, ctx) => chooseStation(ds.id, ctx));
registerAction("pick:place", (ds, ev, ctx) => {
  ctxRef = ctx || ctxRef;
  const p = places.state.items[+ds.i];
  if (p) { P.anchor = p; rerender(false); }
});
registerAction("pick:only", (ds, ev, ctx) => {
  PREF.only = !PREF.only;
  const b = ev?.target?.closest?.('[data-action="pick:only"]') || rootRef?.querySelector?.('[data-action="pick:only"]');
  b?.setAttribute("aria-checked", String(PREF.only));
});
registerAction("pick:change-place", (ds, ev, ctx) => { ctxRef = ctx || ctxRef; P.anchor = null; rerender(true); });

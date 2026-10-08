/**
 * @module ui/views/nearby
 * Home screen. One glance: the next bus at the nearest stop. With location: the 3 nearest stops
 * (up to 3 arrivals at the nearest, 1 at the others). Without location (unknown, asking, denied):
 * "Use my location", a station search, "Type an address or place" (stops near that place),
 * and an "Arriving soon" list. Never a dead end; denied location is a first-class state.
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { nowS, minsUntil } from "../../core/time.js";
import { arrivalsFor, staleLevel } from "../../core/arrivals.js";
import { routeChip, etaBlock, arrivalRow, emptyState, skeleton } from "../components.js";
import { stopsNear, matchStations, createPlaceSearch, placeRows, walkText, OFFICIAL_HTML, ICONS } from "./pick.js";

/** Farthest stop still called "nearby" (meters). */
export const NEARBY_MAX_M = 5000;

/** View-local state: search text, search mode, chosen place (stands in for location). */
export const N = { q: "", mode: "station", anchor: null };
let rootRef = null, ctxRef = null, offStore = null, lastRegion = null;
const places = createPlaceSearch(() => patchResults());

const isStale = (state, now) => staleLevel(state, now) !== "";
const nameOf = (state, rid) => state.routes?.[rid]?.short || state.routes?.[rid]?.long || rid;

function soonest(state, now) {
  const hidden = state.hiddenRoutes || [], out = [];
  for (const id of Object.keys(state.stops || {})) {
    if (!(state.stopRoutes?.[id] || []).length) continue;
    const a = arrivalsFor(state, id, { hidden, nowS: now })[0];
    if (a) out.push({ id, a });
  }
  return out.sort((x, y) => x.a.t - y.a.t).slice(0, 6);
}

function noService(state) {
  return emptyState("No shuttles running right now", "Check the official schedule for service hours.") + OFFICIAL_HTML;
}

function stopCard(state, s, now, max, hero) {
  const hidden = state.hiddenRoutes || [];
  const arr = state.liveLoaded ? arrivalsFor(state, s.id, { hidden, nowS: now }).slice(0, max) : null;
  const rs = (state.stopRoutes?.[s.id] || []).filter((r) => !hidden.includes(r));
  const head = `<button type="button" class="v-row v-cardhead" data-action="stop:open" data-id="${esc(s.id)}"><span class="v-grow"><span class="${hero ? "v-title" : "v-prim"}">${esc(s.name)}</span><span class="v-sec">${esc(walkText(s.d))}</span></span><span class="v-chev" aria-hidden="true">${ICONS.chev}</span></button>`;
  let body;
  if (!arr) body = skeleton(1);
  else if (arr.length) body = arr.map((a) => arrivalRow(a, state, { now, action: "route:open" })).join("");
  else body = `<div class="v-none"><span class="v-sec">No upcoming arrivals</span><span class="v-chips">${rs.map((r) => routeChip(r, state.routes)).join("")}</span></div>`;
  return `<section class="v-card${hero ? " v-hero" : ""}">${head}${body}</section>`;
}

function nearList(state, point, now) {
  const near = stopsNear(state, point, { maxM: NEARBY_MAX_M, max: 3, hidden: state.hiddenRoutes || [] });
  if (!near.length) return null;
  let h = stopCard(state, near[0], now, 3, true);
  if (near.length > 1) h += '<h3 class="v-h">Also nearby</h3>' + near.slice(1).map((s) => stopCard(state, s, now, 1, false)).join("");
  return h;
}

function soonList(state, now) {
  if (!state.liveLoaded) return '<h3 class="v-h">Arriving soon</h3>' + skeleton(3);
  const soon = soonest(state, now), stale = isStale(state, now);
  if (!soon.length) return noService(state);
  return '<h3 class="v-h">Arriving soon</h3><div class="v-card">' + soon.map(({ id, a }) => {
    const m = Math.max(0, minsUntil(a.t, now));
    const label = `Route ${nameOf(state, a.rid)} at ${state.stops[id]?.name || id}, ${m < 1 ? "arriving now" : "in " + m + " minutes"}${stale ? ", estimate" : ""}`;
    return `<button type="button" class="v-row" data-action="stop:open" data-id="${esc(id)}" aria-label="${esc(label)}">${routeChip(a.rid, state.routes)}<span class="v-grow"><span class="v-prim">${esc(state.stops[id]?.name || id)}</span><span class="v-sec">${esc(state.routes?.[a.rid]?.long || "")}</span></span>${etaBlock(a.t, { stale, now })}</button>`;
  }).join("") + "</div>";
}

function locBlock(state) {
  if (state.locState === "asking") return '<p class="v-hint" role="status">Finding your location&hellip;</p>';
  if (state.locState === "denied") {
    return '<div class="v-locoff" role="status"><span class="v-ic" aria-hidden="true">' + ICONS.loc + '</span><span class="v-grow"><b>Location is off.</b> To see stops near you, allow location for this site in your browser settings. You can still search below.</span></div>'
      + '<button type="button" class="v-btn v-btn--secondary v-btn--block" data-action="nearby:locate">Try location again</button>';
  }
  return '<button type="button" class="v-btn v-btn--primary v-btn--block" data-action="nearby:locate"><span class="v-ic" aria-hidden="true">' + ICONS.loc + "</span>Use my location</button>";
}

/** Body below the search field when nothing is typed. */
export function bodyHTML(state, now = nowS()) {
  if (state.user) {
    const h = nearList(state, state.user, now);
    if (h) return h;
    return '<div class="v-empty"><b>No stops near you</b><span>You seem to be more than 5 km from the shuttle network. Search a station or place above.</span></div>' + soonList(state, now);
  }
  let h = "";
  if (N.anchor) {
    const list = nearList(state, N.anchor, now);
    h += `<div class="v-anchor"><span class="v-grow"><span class="v-sec">Showing stops near</span><span class="v-prim">${esc(N.anchor.label)}</span></span><button type="button" class="v-btn v-btn--quiet" data-action="nearby:clear-place" aria-label="Clear place ${esc(N.anchor.label)}">Clear</button></div>`;
    return h + (list || '<div class="v-empty"><b>No stops within 5 km of this place</b><span>Try another place or search a station.</span></div>');
  }
  return h + soonList(state, now);
}

/** Results region while the user is typing. */
export function resultsHTML(state) {
  const q = N.q.trim();
  if (N.mode === "place") {
    const s = places.state;
    if (q.length < 3) return '<p class="v-hint">Type at least 3 letters of an address, building or place.</p>';
    if (s.status === "busy") return '<p class="v-hint" role="status">Searching places&hellip;</p>';
    if (s.status === "err") return '<div class="v-empty"><b>Could not search places right now</b><span>Check your connection, or search a station by name.</span></div>';
    if (!s.items.length) return '<div class="v-empty"><b>No places found</b><span>Check the spelling or try a nearby landmark.</span></div>';
    return placeRows(s.items, "nearby:place");
  }
  const m = matchStations(state, q, 8);
  if (!m.length) return '<div class="v-empty"><b>No matching stations</b><span>Check the spelling, or type an address instead.</span></div><button type="button" class="v-btn v-btn--secondary v-btn--block" data-action="nearby:mode" data-mode="place">Search addresses and places</button>';
  return '<div class="v-card">' + m.map((s) => `<button type="button" class="v-row" data-action="stop:open" data-id="${esc(s.id)}"><span class="v-ic" aria-hidden="true">${ICONS.stop}</span><span class="v-grow"><span class="v-prim">${esc(s.name)}</span><span class="v-sec">${esc((state.stopRoutes?.[s.id] || []).map((r) => nameOf(state, r)).join(", "))}</span></span></button>`).join("") + "</div>";
}

/** Location prompt above the search field (empty once located). */
function locHTML(state) {
  return state.user ? "" : locBlock(state);
}

function regionHTML(state, now) {
  return N.q.trim() ? resultsHTML(state) : bodyHTML(state, now);
}

/**
 * Render the Nearby view.
 * @param {object} state store state
 * @param {number} [now] unix seconds
 * @returns {string}
 */
export function renderNearby(state, now = nowS()) {
  if (!state.staticLoaded) return '<div class="v-nearby">' + skeleton(3) + "</div>";
  const place = N.mode === "place";
  const search = `<label class="v-search"><span class="v-ic" aria-hidden="true">${ICONS.search}</span><span class="v-sr">${place ? "Address or place" : "Search stations"}</span><input type="search" data-input="nearby-q" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${place ? "Address, building or place" : "Search stations"}" value="${esc(N.q)}"></label>`;
  const toggle = place
    ? '<div class="v-alt"><button type="button" class="v-link" data-action="nearby:mode" data-mode="station">Search stations instead</button></div><p class="v-fine">Only the text you type is sent to photon.komoot.io to find the place.</p>'
    : '<div class="v-alt"><button type="button" class="v-link" data-action="nearby:mode" data-mode="place">Type an address or place</button><button type="button" class="v-link" data-action="dir:open">Directions</button></div>';
  return `<div class="v-nearby"><div data-region="nearby-loc">${locHTML(state)}</div>${search}${toggle}<div data-region="nearby-results">${regionHTML(state, now)}</div></div>`;
}

/**
 * Right side of the sheet title line at Nearby (router def.meta), e.g. "53RD · 4 min".
 * @param {object} state
 * @param {number} [now]
 * @returns {string} plain text ('' when unknown)
 */
export function metaNearby(state, now = nowS()) {
  const point = state.user || N.anchor;
  if (!point || !state.staticLoaded || !state.liveLoaded) return "";
  const hidden = state.hiddenRoutes || [];
  const s = stopsNear(state, point, { maxM: NEARBY_MAX_M, max: 1, hidden })[0];
  const a = s && arrivalsFor(state, s.id, { hidden, nowS: now })[0];
  if (!a) return "";
  const m = minsUntil(a.t, now);
  return nameOf(state, a.rid) + " · " + (m < 1 ? "Now" : (isStale(state, now) ? "~" : "") + m + " min");
}

/**
 * One-line summary for the peek detent, e.g. "53 & Kimbark · 53RD 4 min".
 * @param {object} state
 * @param {number} [now]
 * @returns {string} plain text ('' when unknown)
 */
export function peekNearby(state, now = nowS()) {
  const point = state.user || N.anchor;
  if (!point || !state.staticLoaded) return "";
  const s = stopsNear(state, point, { maxM: NEARBY_MAX_M, max: 1, hidden: state.hiddenRoutes || [] })[0];
  if (!s) return "";
  const a = state.liveLoaded && arrivalsFor(state, s.id, { hidden: state.hiddenRoutes || [], nowS: now })[0];
  if (!a) return s.name;
  const m = minsUntil(a.t, now);
  return `${s.name} · ${nameOf(state, a.rid)} ${m < 1 ? "now" : (isStale(state, now) ? "~" : "") + m + " min"}`;
}

function curState() { return ctxRef?.store?.get?.() || {}; }

let lastLoc = null;
function patchResults() {
  const loc = rootRef?.querySelector?.('[data-region="nearby-loc"]'), lh = locHTML(curState());
  if (loc && lh !== lastLoc) { loc.innerHTML = lh; lastLoc = lh; }
  const el = rootRef?.querySelector?.('[data-region="nearby-results"]');
  if (!el) return;
  const html = regionHTML(curState(), ctxRef?.now ? ctxRef.now() : nowS());
  if (html !== lastRegion) { el.innerHTML = html; lastRegion = html; }
}

function rerender(focus) {
  if (!rootRef) return;
  lastRegion = null; lastLoc = null;
  rootRef.innerHTML = renderNearby(curState(), ctxRef?.now ? ctxRef.now() : nowS());
  if (focus) rootRef.querySelector('[data-input="nearby-q"]')?.focus({ preventScroll: true });
}

function onInput(e) {
  if (!e.target?.matches?.('[data-input="nearby-q"]')) return;
  N.q = e.target.value;
  if (N.mode === "place") places.query(N.q);
  patchResults();
}

function onKey(e) {
  if (!e.target?.matches?.('[data-input="nearby-q"]')) return;
  if (e.key === "Escape" && N.q) { e.preventDefault(); e.stopPropagation(); N.q = ""; e.target.value = ""; patchResults(); return; }
  if (e.key !== "Enter") return;
  e.preventDefault();
  if (N.mode === "place") { if (places.state.items[0]) choosePlace(0); return; }
  const first = matchStations(curState(), N.q, 1)[0];
  if (first) ctxRef?.navigate?.("stop", { stopId: first.id });
}

/** Use a found place as the stand-in for location. */
export function choosePlace(i) {
  const p = places.state.items[i];
  if (!p) return false;
  N.anchor = { label: p.label, lat: p.lat, lon: p.lon };
  N.q = ""; N.mode = "station";
  rerender(false);
  try { ctxRef?.map?.flyTo?.({ lat: p.lat, lon: p.lon }, 16); } catch (e) { /* map optional */ }
  return true;
}

/**
 * Mount: delegated listeners for the search field, and a store subscription that keeps the list
 * current (main.js does not re-render views that mount). Only the results region is patched, so
 * the search field and its focus are never touched by live updates.
 */
export function mountNearby(root, ctx) {
  unmountNearby();
  rootRef = root; ctxRef = ctx; lastRegion = null; lastLoc = null;
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKey);
  offStore = ctx?.store?.subscribe?.((s, ch) => {
    if (ch.has("staticLoaded") || !rootRef.querySelector('[data-region="nearby-results"]')) rerender(false);
    else patchResults();
  }) || null;
}

/** Unmount: drop listeners (the typed text is kept for when the user comes back). */
export function unmountNearby() {
  if (rootRef) { rootRef.removeEventListener("input", onInput); rootRef.removeEventListener("keydown", onKey); }
  offStore?.(); offStore = null;
  places.cancel();
  rootRef = null;
}

/** Test hook: inject the place-search state. */
export const _places = places;

registerView("nearby", {
  title: () => "Nearby",
  detent: "half",
  tab: "nearby",
  render: (state) => renderNearby(state),
  meta: (state) => metaNearby(state),
  peek: (state) => peekNearby(state),
  mount: (root, ctx) => mountNearby(root, ctx),
  unmount: () => unmountNearby(),
  refresh: () => patchResults(),
});

registerAction("nearby:locate", async (ds, ev, ctx) => {
  ctxRef = ctx || ctxRef;
  let ok = false;
  try { ok = await ctx.locate(); } catch (e) { ok = false; }
  const u = ctx.store.get().user;
  if (ok && u) { N.anchor = null; try { ctx.map?.flyTo?.(u, 16); } catch (e) { /* map optional */ } }
  else ctx.toast?.("Location is off. You can still search stations or places.");
});
registerAction("nearby:mode", (ds, ev, ctx) => {
  ctxRef = ctx || ctxRef;
  N.mode = ds.mode === "place" ? "place" : "station";
  places.cancel(); places.state.q = ""; places.state.items = []; places.state.status = "";
  if (N.mode === "place" && N.q) places.query(N.q);
  rerender(true);
});
registerAction("nearby:place", (ds, ev, ctx) => { ctxRef = ctx || ctxRef; choosePlace(+ds.i); });
registerAction("nearby:clear-place", (ds, ev, ctx) => { ctxRef = ctx || ctxRef; N.anchor = null; rerender(false); });

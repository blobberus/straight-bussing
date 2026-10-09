/**
 * @module ui/views/nearby
 * Current trip tab (view id stays 'nearby'; routing, tests and persisted state use it). Destination
 * search lives in the floating search bar at the top of the screen (index.html #searchBar, dir:open).
 * Top of this view: the trip in progress (journey kind 'plan': routes, End trip, Trip steps) or a
 * "No trip in progress" hint, plus "Routes to station…" (pick:open). Below it, one glance: the next bus at the nearest stop. With location: the 3 nearest stops
 * (up to 3 arrivals at the nearest, 1 at the others). Without location (unknown, asking, denied):
 * "Use my location", a station search, "Type an address or place" (stops near that place),
 * and an "Arriving soon" list. Never a dead end; denied location is a first-class state.
 * Above everything: the service-alert banner (alerts are a sub view, not a tab). Above the nearby
 * stops: a Favorites card (state.favStops, next visible arrival each). Visibility follows
 * core/visibility.js effectiveHidden (journey > hidden routes / applied custom route).
 * With real location, each arrival says "Leave now" / "Leave in N min" or that it leaves before you
 * could walk to the stop (walking estimate, ./tripinfo.js catchNote; labeled est.).
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { nowS, minsUntil } from "../../core/time.js";
import { arrivalsFor, staleLevel, liveUnknown } from "../../core/arrivals.js";
import { routeChip, etaBlock, arrivalRow, emptyState, skeleton } from "../components.js";
import { stopsNear, matchStations, walkText, OFFICIAL_HTML, ICONS } from "./pick.js";
import { createPlaceSearch, placeListHTML, setHTMLKeepFocus, focusNote } from "./placesearch.js";
import { effectiveHidden } from "../../core/visibility.js";
import { alertBanner } from "./alerts.js";
import { catchNote, stopWalkMin } from "./tripinfo.js";
import { isPlanJourney } from "./journey.js";
import { tripProgressHTML } from "./tripprogress.js";

/** Favorites shown on Nearby (the rest are in My Routes). */
export const FAV_MAX = 3;

/** Farthest stop still called "nearby" (meters). */
export const NEARBY_MAX_M = 5000;

/** View-local state: search text, search mode, chosen place (stands in for location). */
export const N = { q: "", mode: "station", anchor: null };
let rootRef = null, ctxRef = null, offStore = null, lastRegion = null;
const places = createPlaceSearch(() => patchResults());

const isStale = (state, now) => staleLevel(state, now) !== "";
const nameOf = (state, rid) => state.routes?.[rid]?.short || state.routes?.[rid]?.long || rid;

function soonest(state, now) {
  const hidden = effectiveHidden(state), out = [];
  for (const id of Object.keys(state.stops || {})) {
    if (!(state.stopRoutes?.[id] || []).length) continue;
    const a = arrivalsFor(state, id, { hidden, nowS: now })[0];
    if (a) out.push({ id, a });
  }
  return out.sort((x, y) => x.a.t - y.a.t).slice(0, 6);
}

const NO_LIVE = "Live times unavailable";
function noService(state, now) {
  // a feed outage is not a service outage: never claim "no shuttles" without live data
  if (liveUnknown(state, now)) return emptyState(NO_LIVE, "Can't reach the shuttle feed, so we can't tell which shuttles are running. Check with the official service.") + OFFICIAL_HTML;
  return emptyState("No shuttles running right now", "Check the official schedule for service hours.") + OFFICIAL_HTML;
}

/**
 * Arrival row with walking guidance: catchable rows say when to leave, uncatchable ones are marked
 * (class pt-miss + text + aria, never color alone). The note goes into the row's aria-label too.
 * @param {object} a arrival {rid, t, bus, tripId}
 * @param {object} state
 * @param {number} now
 * @param {number} walkM walking minutes to the stop (estimate)
 * @returns {string}
 */
export function guidedRow(a, state, now, walkM) {
  const c = catchNote(a.t, walkM, now);
  return arrivalRow(a, state, { now, action: "route:open", sub: c.text })
    .replace('class="row arr"', `class="row arr pt-arr pt-${c.kind}"`)
    .replace(/aria-label="([^"]*)"/, (m0, l) => `aria-label="${l}, ${esc(c.aria)}"`);
}

/**
 * Arrivals to list at a stop: the first `max`, plus one more when none of those can be caught on foot.
 * @param {object[]} all sorted arrivals
 * @param {number} max
 * @param {number|null} walkM walking minutes (null: no guidance)
 * @param {number} now
 * @returns {object[]}
 */
export function pickArrivals(all, max, walkM, now) {
  const list = all.slice(0, max);
  if (walkM != null && list.length && all.length > max && list.every((a) => catchNote(a.t, walkM, now).kind === "miss")) list.push(all[max]);
  return list;
}

function stopCard(state, s, now, max, hero, guide) {
  const hidden = effectiveHidden(state);
  const walkM = guide ? stopWalkMin(s.d) : null;
  const arr = state.liveLoaded ? pickArrivals(arrivalsFor(state, s.id, { hidden, nowS: now }), max, walkM, now) : null;
  const rs = (state.stopRoutes?.[s.id] || []).filter((r) => !hidden.includes(r));
  const head = `<button type="button" class="v-row v-cardhead" data-action="stop:open" data-id="${esc(s.id)}"><span class="v-grow"><span class="${hero ? "v-title" : "v-prim"}">${esc(s.name)}</span><span class="v-sec">${esc(walkText(s.d))}</span></span><span class="v-chev" aria-hidden="true">${ICONS.chev}</span></button>`;
  let body;
  if (!arr) body = skeleton(1);
  else if (arr.length) body = arr.map((a) => (guide ? guidedRow(a, state, now, walkM) : arrivalRow(a, state, { now, action: "route:open" }))).join("");
  else body = `<div class="v-none"><span class="v-sec">${liveUnknown(state, now) ? NO_LIVE : "No upcoming arrivals"}</span><span class="v-chips">${rs.map((r) => routeChip(r, state.routes)).join("")}</span></div>`;
  return `<section class="v-card${hero ? " v-hero" : ""}">${head}${body}</section>`;
}

/**
 * Favorites card: up to FAV_MAX favorite stations with their next visible arrival; '' if none.
 * @param {object} state
 * @param {number} [now]
 * @returns {string}
 */
export function favoritesHTML(state, now = nowS()) {
  const ids = (state.favStops || []).filter((id) => state.stops?.[id]);
  if (!ids.length) return "";
  const hidden = effectiveHidden(state), stale = isStale(state, now), unknown = liveUnknown(state, now);
  const rows = ids.slice(0, FAV_MAX).map((id) => {
    const name = state.stops[id].name || id;
    const a = state.liveLoaded ? arrivalsFor(state, id, { hidden, nowS: now })[0] : null;
    const m = a ? Math.max(0, minsUntil(a.t, now)) : null;
    const label = a ? `Favorite ${name}: route ${nameOf(state, a.rid)} ${m < 1 ? "arriving now" : "in " + m + " minutes"}${stale ? ", estimate" : ""}`
      : `Favorite ${name}: ${unknown ? "live times unavailable" : state.liveLoaded ? "no upcoming arrivals" : "loading"}`;
    const right = a ? etaBlock(a.t, { stale, now }) : `<span class="v-sec">${unknown ? "No live times" : state.liveLoaded ? "No buses soon" : ""}</span>`;
    return `<button type="button" class="v-row" data-action="stop:open" data-id="${esc(id)}" aria-label="${esc(label)}">${a ? routeChip(a.rid, state.routes) : `<span class="v-ic v-favic" aria-hidden="true">&#9733;</span>`}<span class="v-grow"><span class="v-prim">${esc(name)}</span>${a ? `<span class="v-sec">${esc(state.routes?.[a.rid]?.long || "")}</span>` : ""}</span>${right}</button>`;
  }).join("");
  const more = '<button type="button" class="v-link v-favmore" data-action="nav" data-view="myroutes">All favorites</button>';
  return `<div class="v-favhead"><h3 class="v-h">Favorites</h3>${more}</div><section class="v-card v-favs" aria-label="Favorite stations">${rows}</section>`;
}

function nearList(state, point, now, guide) {
  const near = stopsNear(state, point, { maxM: NEARBY_MAX_M, max: 3, hidden: effectiveHidden(state) });
  if (!near.length) return null;
  let h = stopCard(state, near[0], now, 3, true, guide);
  if (near.length > 1) h += '<h3 class="v-h">Also nearby</h3>' + near.slice(1).map((s) => stopCard(state, s, now, 1, false, guide)).join("");
  if (guide) h += '<p class="v-fine pt-walknote">Leave times use a walking estimate (80 m a minute) and live bus times. Allow extra time.</p>';
  return h;
}

function soonList(state, now) {
  if (!state.liveLoaded) return '<h3 class="v-h">Arriving soon</h3>' + skeleton(3);
  const soon = soonest(state, now), stale = isStale(state, now);
  if (!soon.length) return noService(state, now);
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
  return favoritesHTML(state, now) + placesHTML(state, now);
}

function placesHTML(state, now) {
  if (state.user) {
    const h = nearList(state, state.user, now, true);
    if (h) return h;
    return '<div class="v-empty"><b>No stops near you</b><span>You seem to be more than 5 km from the shuttle network. Search a station or place above.</span></div>' + soonList(state, now);
  }
  let h = "";
  if (N.anchor) {
    const list = nearList(state, N.anchor, now, false);
    h += `<div class="v-anchor"><span class="v-grow"><span class="v-sec">Showing stops near</span><span class="v-prim">${esc(N.anchor.label)}</span></span><button type="button" class="v-btn v-btn--quiet" data-action="nearby:clear-place" aria-label="Clear place ${esc(N.anchor.label)}">Clear</button></div>`;
    return h + (list || '<div class="v-empty"><b>No stops within 5 km of this place</b><span>Try another place or search a station.</span></div>');
  }
  return h + soonList(state, now);
}

/** Results region while the user is typing. */
export function resultsHTML(state) {
  const q = N.q.trim();
  if (N.mode === "place") {
    const err = '<div class="v-empty"><b>Could not search places right now</b><span>Check your connection, or search a station by name.</span></div>';
    return placeListHTML(places.state, q, "nearby:place", "nearby:exact", err);
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
 * Top of the Current trip view: the trip in progress (routes, End trip, Trip steps) or a hint that
 * none is running, and "Routes to station…". Directions itself opens from the top search bar.
 * @param {object} state
 * @returns {string}
 */
export function entryHTML(state, now = nowS()) {
  const pick = '<button type="button" class="v-btn v-btn--secondary v-btn--block pt-pick" data-action="pick:open">Routes to station&hellip;</button>';
  // a started trip: the live Google-Maps-style progress timeline (ui/views/tripprogress.js)
  if (isPlanJourney(state)) return tripProgressHTML(state, now, { actionsHTML: pick });
  return '<div class="pt-notrip"><span class="v-prim">No trip in progress</span>'
    + '<span class="v-sec">Search for a destination above, choose a route and tap Start.</span></div>'
    + `<div class="pt-top">${pick}</div>`;
}

/**
 * Render the Plan Trip (id 'nearby') view.
 * @param {object} state store state
 * @param {number} [now] unix seconds
 * @returns {string}
 */
export function renderNearby(state, now = nowS()) {
  if (!state.staticLoaded) return '<div class="v-nearby">' + skeleton(3) + "</div>";
  const place = N.mode === "place";
  const search = `<label class="v-search"><span class="v-ic" aria-hidden="true">${ICONS.search}</span><span class="v-sr">${place ? "Address or place" : "Search stations"}</span><input type="search" data-input="nearby-q" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${place ? "Address, building or place" : "Search stations"}" value="${esc(N.q)}"></label>`;
  const toggle = place
    ? '<div class="v-alt"><button type="button" class="v-link" data-action="nearby:mode" data-mode="station">Search stations instead</button></div><p class="v-fine">Places near campus are searched on your device; otherwise only the text you type (or its spelling fix) is sent to photon.komoot.io.</p>'
    : '<div class="v-alt"><button type="button" class="v-link" data-action="nearby:mode" data-mode="place">Type an address or place</button></div>';
  return `<div class="v-nearby"><div data-region="nearby-alert">${alertBanner(state, now)}</div><div data-region="nearby-trip">${entryHTML(state, now)}</div><div data-region="nearby-loc">${locHTML(state)}</div>${search}${toggle}<div data-region="nearby-results">${regionHTML(state, now)}</div></div>`;
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
  const hidden = effectiveHidden(state);
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
  const s = stopsNear(state, point, { maxM: NEARBY_MAX_M, max: 1, hidden: effectiveHidden(state) })[0];
  if (!s) return "";
  const a = state.liveLoaded && arrivalsFor(state, s.id, { hidden: effectiveHidden(state), nowS: now })[0];
  if (!a) return s.name;
  const m = minsUntil(a.t, now);
  return `${s.name} · ${nameOf(state, a.rid)} ${m < 1 ? "now" : (isStale(state, now) ? "~" : "") + m + " min"}`;
}

function curState() { return ctxRef?.store?.get?.() || {}; }

let lastLoc = null, lastAlert = null, lastTrip = null;
function patchResults() {
  const al = rootRef?.querySelector?.('[data-region="nearby-alert"]'), ah = alertBanner(curState(), ctxRef?.now ? ctxRef.now() : nowS());
  if (al && ah !== lastAlert) { setHTMLKeepFocus(al, ah); lastAlert = ah; }
  const tr = rootRef?.querySelector?.('[data-region="nearby-trip"]'), th = entryHTML(curState(), ctxRef?.now ? ctxRef.now() : nowS());
  if (tr && th !== lastTrip) { setHTMLKeepFocus(tr, th); lastTrip = th; }   // live trip timeline: keep keyboard focus
  const loc = rootRef?.querySelector?.('[data-region="nearby-loc"]'), lh = locHTML(curState());
  if (loc && lh !== lastLoc) { setHTMLKeepFocus(loc, lh); lastLoc = lh; }
  const el = rootRef?.querySelector?.('[data-region="nearby-results"]');
  if (!el) return;
  const html = regionHTML(curState(), ctxRef?.now ? ctxRef.now() : nowS());
  if (html !== lastRegion) { setHTMLKeepFocus(el, html); lastRegion = html; }
}

function rerender(focus) {
  if (!rootRef) return;
  lastRegion = null; lastLoc = null; lastAlert = null; lastTrip = null;
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
  rootRef = root; ctxRef = ctx; lastRegion = null; lastLoc = null; lastAlert = null; lastTrip = null;
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
  title: () => "Current trip",
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
registerAction("nearby:exact", (ds, ev, ctx) => {
  ctxRef = ctx || ctxRef;
  places.exact(ds.exact !== "0");
  patchResults();
  focusNote(rootRef?.querySelector?.('[data-region="nearby-results"]'));
});
registerAction("nearby:clear-place", (ds, ev, ctx) => { ctxRef = ctx || ctxRef; N.anchor = null; rerender(false); });

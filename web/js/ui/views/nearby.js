/**
 * @module ui/views/nearby
 * Current trip tab (view id stays 'nearby'; routing, tests and persisted state use it). Destination
 * search lives in the floating search bar at the top of the screen (index.html #searchBar, dir:open).
 * Order (owner decision 2026-10-11, Ship checklist 3: the next bus in one glance at the half detent, no taps):
 * the one-line service-alert row (alerts are a sub view, not a tab); the trip in progress (journey kind 'plan':
 * timeline, End trip, Trip steps, "Routes to station…") when there is one; then THE NEXT BUS: the nearest stop
 * with up to 3 arrivals (with location, or a typed place), else the Favorites card (state.favStops, next visible
 * arrival each); "Use my location" (the one primary action) when there is no location; the station search with
 * "Type an address or place" and "Routes to station…" (pick:open) under it; then favorites (when a nearest stop
 * leads), "Also nearby" (1 arrival each) or "Arriving soon", and the quiet "No trip in progress" hint last.
 * Never a dead end; denied location is a first-class state. Visibility follows core/visibility.js
 * effectiveHidden (journey > hidden routes / applied custom route).
 * No trip in progress (owner 2026-11-04: "In the current trip menu, if a current trip is not selected, don't display
 * nearby routes, rather, just show that no current trip is selected. Keep the favorites and search station bar. Also
 * keep the alerts."; glass spec 18 D6, a deliberate departure from the next-bus-in-one-glance rule): the alert row,
 * "No current trip selected" with how to start one (Search for a destination), the station search with its links, and
 * the favorites. No nearest stop, no Arriving soon / Also nearby, no "Use my location" (location still works from
 * the locate button and Settings); the collapsed header says "No current trip selected" instead of the next bus. A place
 * typed in the search ("Type an address or place") still lists the stops near it: that is the search's own result.
 * With real location, each arrival says "Leave now" / "Leave in N min" or that it leaves before you
 * could walk to the stop (walking estimate, ./tripinfo.js catchNote; labeled est.).
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { nowS, minsUntil, clock } from "../../core/time.js";
import { locResultText } from "../../core/lochelp.js";
import { arrivalsFor, liveUnknown } from "../../core/arrivals.js";
import { routeChip, etaBlock, arrivalRow, emptyState, skeleton, OFFICIAL_PHONE } from "../components.js";
import { svg } from "../icons.js";
import { silentService, scheduledRoutes, silentText } from "../../core/operating.js";
import { stopsNear, matchStations, walkText, OFFICIAL_HTML, ICONS } from "./pick.js";
import { createPlaceSearch, placeListHTML, setHTMLKeepFocus, focusNote } from "./placesearch.js";
import { effectiveHidden } from "../../core/visibility.js";
import { alertBanner, noBusHelpHTML } from "./alerts.js";
import { stopWalkMin } from "./tripinfo.js";
import { FAV_MAX, isStale, nameOf, guidedRow, pickArrivals, favoritesHTML, soonest } from "./nearby-cards.js";
import { isPlanJourney } from "./journey.js";
import { tripProgressHTML, tripMetaText, tripMetaHTML, tripHeader } from "./tripprogress.js";

export { FAV_MAX, guidedRow, pickArrivals, favoritesHTML };   // their home is ./nearby-cards.js (tests import them from here)

/** Farthest stop still called "nearby" (meters). */
export const NEARBY_MAX_M = 5000;

/** View-local state: search text, search mode, chosen place (stands in for location). */
export const N = { q: "", mode: "station", anchor: null };
let rootRef = null, ctxRef = null, offStore = null;
const places = createPlaceSearch(() => patchResults());

const NO_LIVE = "Live times unavailable";
function noService(state, now) {
  // the operator's alert + who to call; the call is the primary button unless "Use my location" already is
  const help = noBusHelpHTML(state, now, { primary: !locPrimary(state) });
  // a feed outage is not a service outage: never claim "no shuttles" without live data
  if (liveUnknown(state, now)) return emptyState(NO_LIVE, "Can't reach the shuttle feed, so we can't tell which shuttles are running. Check with the official service.", { icon: "wifi-off" }) + help;
  if ((state.buses || []).length) return emptyState("No upcoming arrivals", "No bus on your visible routes has a predicted arrival right now.", { icon: "bus-front" }) + OFFICIAL_HTML;
  // fresh but empty feed while routes are scheduled: GPS off or service ended early, we can't tell (rider safety)
  if (silentService(state, now)) return emptyState("No live locations right now", silentText(state, scheduledRoutes(state, now, { hidden: effectiveHidden(state) }), now, OFFICIAL_PHONE), { icon: "antenna-off" }) + help;
  return emptyState("No shuttles running right now", "Check the official schedule for service hours.", { icon: "bus-front" }) + help;
}

function stopCard(state, s, now, max, hero, guide) {
  const hidden = effectiveHidden(state);
  const walkM = guide ? stopWalkMin(s.d) : null;
  const arr = state.liveLoaded ? pickArrivals(arrivalsFor(state, s.id, { hidden, nowS: now }), max, walkM, now) : null;
  const rs = (state.stopRoutes?.[s.id] || []).filter((r) => !hidden.includes(r));
  const chev = `<span class="v-chev" aria-hidden="true">${ICONS.chev}</span>`;
  // hero (the next bus, owner decision 2026-10-11): the name (2 lines at 393 px) with the walk on its right, so name + 3
  // arrivals fit the half detent under the one-line alert row; the distance stays in the spoken name
  const head = hero
    ? `<button type="button" class="v-row v-cardhead pt-nexthead" data-action="stop:open" data-id="${esc(s.id)}"><span class="v-grow v-prim">${esc(s.name)}</span><span class="v-sec pt-nextwalk">${esc(walkText(s.d).split(" · ")[0])}<span class="v-sr">, ${Math.round(s.d)} m</span></span>${chev}</button>`
    : `<button type="button" class="v-row v-cardhead" data-action="stop:open" data-id="${esc(s.id)}"><span class="v-grow"><span class="v-prim">${esc(s.name)}</span><span class="v-sec">${esc(walkText(s.d))}</span></span>${chev}</button>`;
  let body;
  if (!arr) body = skeleton(hero ? 3 : 1);
  else if (arr.length) body = arr.map((a) => (guide ? guidedRow(a, state, now, walkM) : arrivalRow(a, state, { now, action: "route:open" }))).join("");
  else body = `<div class="v-none"><span class="v-sec">${liveUnknown(state, now) ? NO_LIVE : silentService(state, now) ? "No live times right now" : "No upcoming arrivals"}</span><span class="v-chips">${rs.map((r) => routeChip(r, state.routes)).join("")}</span></div>`;
  return hero ? `<section class="v-card v-hero pt-next" aria-label="${esc("Next buses at " + s.name)}">${head}${body}</section>`
    : `<section class="v-card">${head}${body}</section>`;
}

/** The point the nearest stop is measured from: your location, else a typed place (N.anchor). */
const pointOf = (state) => state.user || N.anchor;
const nearest = (state, point, max) => stopsNear(state, point, { maxM: NEARBY_MAX_M, max, hidden: effectiveHidden(state) });

/** Below the hero: the other nearby stops (1 arrival each) and the walking-estimate note. */
function nearList(state, point, now, guide) {
  const near = nearest(state, point, 3);
  if (!near.length) return null;
  let h = near.length > 1 ? '<h3 class="v-h">Also nearby</h3>' + near.slice(1).map((s) => stopCard(state, s, now, 1, false, guide)).join("") : "";
  if (guide) h += '<p class="v-fine pt-walknote">Leave times use a walking estimate (80 m a minute) and live bus times. Allow extra time.</p>';
  return h;
}

/** No bus reports (feed down, or a fresh feed with no vehicle): the stop cards cannot show times. */
const noBusReports = (state, now) => liveUnknown(state, now) || (state.liveLoaded && !(state.buses || []).length);

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

/**
 * What the last location try did, for the blocked-location card (spec 13.3): "Tried at 4:06 PM (try 2): still blocked, so
 * no popup. Tap "How to allow location" for the steps." ('' before any try).
 * @param {{code:number, at:number, n:number}|null} err store.locErr
 * @returns {string}
 */
export function triedText(err) {
  if (!err || !err.at) return "";
  if (err.code !== 1) return locResultText(err, (t) => clock(t));
  return `Tried at ${clock(Math.round(err.at / 1000))}${err.n > 1 ? ` (try ${err.n})` : ""}: still blocked, so no popup. Tap "How to allow location" for the steps.`;
}

/** "Use my location" is the screen's one primary action (no location yet, not asking, not denied). */
const locPrimary = (state) => !state.user && state.locState !== "asking" && state.locState !== "denied";

function locBlock(state) {
  if (state.locState === "asking") return '<p class="v-hint" role="status">Finding your location&hellip;</p>';
  if (state.locState === "denied") {
    // spec 13.3: one card first, the help and the retry inside it, and what the last try did in view (not a toast over
    // the title, audit defect 3); then "Search stations" so the app stays usable
    const tried = triedText(state.locErr);
    return '<div class="v-locoff v-locoff--card" role="status"><span class="v-ic" aria-hidden="true">' + ICONS.loc + '</span><span class="v-grow"><b>Location is blocked for this site.</b> Your browser will not ask again by itself; it has to be allowed in your settings. You can still search below.'
      + (tried ? `<span class="v-loctried">${esc(tried)}</span>` : "") + "</span></div>"
      + '<button type="button" class="v-btn v-btn--secondary v-btn--block" data-action="settings:open" data-section="loc">How to allow location</button>'
      + '<button type="button" class="v-btn v-btn--quiet v-btn--block" data-action="nearby:locate">Try location again</button>';
  }
  return '<button type="button" class="v-btn v-btn--primary v-btn--block" data-action="nearby:locate"><span class="v-ic" aria-hidden="true">' + ICONS.loc + "</span>Use my location</button>";
}

/** No trip in progress (owner 2026-11-04): what the view and the collapsed header say, and how to start one. */
export const NO_TRIP_TITLE = "No current trip selected";
export const NO_TRIP_HINT = "Search for a destination, choose a route and tap Start.";
/** The no-trip card at the top (under the alert row): the state in words, how to start, one way to start. */
export function noTripHTML() {
  return `<div class="empty pt-notrip" role="status"><span class="empty-ic" aria-hidden="true">${svg("route", 28)}</span><b>${esc(NO_TRIP_TITLE)}</b><span>${esc(NO_TRIP_HINT)}</span>`
    + '<button type="button" class="v-btn v-btn--primary v-btn--block pt-notrip-go" data-action="dir:open" data-focus="to">Search for a destination</button></div>';
}
/** Nearby buses only while a trip is in progress (owner 2026-11-04); a typed place still lists the stops near it. */
const tripOn = (state) => isPlanJourney(state);

/**
 * The next bus, first under the title (owner decision 2026-10-11; region nearby-next): with location (or a typed
 * place) the nearest stop and up to 3 arrivals; without, the favorites' next buses; else '' ("Use my location"
 * then leads).
 * @param {object} state
 * @param {number} [now]
 * @returns {string}
 */
export function nextHTML(state, now = nowS()) {
  if (!tripOn(state) && !N.anchor) return "";   // no trip: no nearby buses (owner 2026-11-04)
  const point = tripOn(state) ? pointOf(state) : N.anchor;
  if (!point) return favoritesHTML(state, now);
  const anchor = !state.user && N.anchor ? `<div class="v-anchor"><span class="v-grow"><span class="v-sec">Showing stops near</span><span class="v-prim">${esc(N.anchor.label)}</span></span><button type="button" class="v-btn v-btn--quiet" data-action="nearby:clear-place" aria-label="Clear place ${esc(N.anchor.label)}">Clear</button></div>` : "";
  const s = nearest(state, point, 1)[0];
  // no bus reports: why the card has no times and who to call, right under it (rider safety)
  const guide = tripOn(state) && !!state.user;
  return anchor + (s ? stopCard(state, s, now, 3, true, guide) + (noBusReports(state, now) ? noService(state, now) : "") : "");
}

/** Body below the search field when nothing is typed: favorites (when the hero is a nearest stop), the rest. */
export function bodyHTML(state, now = nowS()) {
  if (!tripOn(state)) {   // owner 2026-11-04: the favorites, and a typed place's stops; nothing nearby by location
    const place = N.anchor ? (nearList(state, N.anchor, now, false) ?? '<div class="v-empty"><b>No stops within 5 km of this place</b><span>Try another place or search a station.</span></div>') : "";
    return favoritesHTML(state, now) + place;
  }
  return (pointOf(state) ? favoritesHTML(state, now) : "") + placesHTML(state, now);
}

function placesHTML(state, now) {
  if (state.user) {
    const h = nearList(state, state.user, now, true);
    if (h != null) return h;
    return '<div class="v-empty"><b>No stops near you</b><span>You seem to be more than 5 km from the shuttle network. Search a station or place above.</span></div>' + soonList(state, now);
  }
  if (N.anchor) return nearList(state, N.anchor, now, false) ?? '<div class="v-empty"><b>No stops within 5 km of this place</b><span>Try another place or search a station.</span></div>';
  return soonList(state, now);
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
  return state.user || !tripOn(state) ? "" : locBlock(state);   // no trip: nothing nearby to locate for (owner 2026-11-04)
}

function regionHTML(state, now) {
  return N.q.trim() ? resultsHTML(state) : bodyHTML(state, now);
}

const PICK_LINK = '<button type="button" class="v-link pt-pick" data-action="pick:open">Routes to station&hellip;</button>';

/**
 * Under the station search: the place / station switch and, with no trip running, "Routes to station…" (secondary
 * actions below the next bus; a trip in progress keeps it in its own actions). Region nearby-alt.
 * @param {object} state
 * @returns {string}
 */
export function altHTML(state) {
  const pick = isPlanJourney(state) ? "" : PICK_LINK;
  return N.mode === "place"
    ? `<div class="v-alt"><button type="button" class="v-link" data-action="nearby:mode" data-mode="station">Search stations instead</button>${pick}</div><p class="v-fine">Places near campus are searched on your device; otherwise only the text you type (or its spelling fix) is sent to photon.komoot.io.</p>`
    : `<div class="v-alt"><button type="button" class="v-link" data-action="nearby:mode" data-mode="place">Type an address or place</button>${pick}</div>`;
}

/**
 * The trip in progress (live timeline with End trip, Trip steps, "Routes to station…"), first under the title as
 * before; '' with no trip (the next bus leads then). Directions itself opens from the top search bar.
 * @param {object} state
 * @returns {string}
 */
export function entryHTML(state, now = nowS()) {
  if (!isPlanJourney(state)) return noTripHTML();
  return tripProgressHTML(state, now, { actionsHTML: '<button type="button" class="v-btn v-btn--secondary v-btn--block pt-pick" data-action="pick:open">Routes to station&hellip;</button>' });
}

/**
 * Render the Current trip (id 'nearby') view. Order (owner decision 2026-10-11): one-line alert row, the trip in
 * progress, the next bus (nearest stop / typed place / favorites), "Use my location" when there is no location,
 * the station search with its secondary actions, then the rest (favorites, Also nearby, Arriving soon, hint).
 * @param {object} state store state
 * @param {number} [now] unix seconds
 * @returns {string}
 */
export function renderNearby(state, now = nowS()) {
  if (!state.staticLoaded) return '<div class="v-nearby">' + skeleton(3) + "</div>";
  const place = N.mode === "place";
  const search = `<label class="v-search"><span class="v-ic" aria-hidden="true">${ICONS.search}</span><span class="v-sr">${place ? "Address or place" : "Search stations"}</span><input type="search" data-input="nearby-q" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${place ? "Address, building or place" : "Search stations"}" value="${esc(N.q)}"></label>`;
  return `<div class="v-nearby"><div data-region="nearby-alert">${alertBanner(state, now)}</div><div data-region="nearby-trip">${entryHTML(state, now)}</div>`
    + `<div data-region="nearby-next">${nextHTML(state, now)}</div><div data-region="nearby-loc">${locHTML(state)}</div>${search}`
    + `<div data-region="nearby-alt">${altHTML(state)}</div><div data-region="nearby-results">${regionHTML(state, now)}</div></div>`;
}

/**
 * Right side of the sheet title line at Current trip (router def.meta) while a trip is in progress: the trip's own line
 * (ui/views/tripprogress.js tripMetaText: "Arriving In: 4 min", "Walk 6 min"); '' with no trip (owner 2026-11-04: no
 * nearby bus without a trip; the subtitle says "No current trip selected").
 * @param {object} state
 * @param {number} [now]
 * @returns {string} plain text ('' when unknown)
 */
export function metaNearby(state, now = nowS()) {
  if (isPlanJourney(state)) return tripMetaText(state, now);   // a trip in progress: "Arriving In: 4 min" / "Walk 6 min" (owner 2026-10-30)
  return "";
}

/**
 * One-line summary for the peek detent: the trip's line, or "No current trip selected" (owner 2026-11-04).
 * @param {object} state
 * @param {number} [now]
 * @returns {string} plain text ('' when unknown)
 */
export function peekNearby(state, now = nowS()) {
  if (isPlanJourney(state)) return tripMetaText(state, now);
  return NO_TRIP_TITLE;   // owner 2026-11-04
}

/**
 * The collapsed header's trailing slot at Current trip (docs/DESIGN-SPEC.md 10.6): during a trip, "Arriving In" over the
 * ETA (tripMetaHTML); with no trip nothing (owner 2026-11-04: the next bus at the nearest stop is no longer shown there).
 * @param {object} state
 * @param {number} [now]
 * @returns {string}
 */
export function metaNearbyHTML(state, now = nowS()) {
  if (isPlanJourney(state)) return tripMetaHTML(state, now);
  return "";
}

function curState() { return ctxRef?.store?.get?.() || {}; }

/** Last HTML per patched region (data-region="nearby-<key>"), so a live update touches only what changed. */
let last = {};
const REGIONS = Object.freeze({
  alert: (s, now) => alertBanner(s, now), trip: (s, now) => entryHTML(s, now),   // live trip timeline: keeps keyboard focus
  next: (s, now) => nextHTML(s, now), loc: (s) => locHTML(s), alt: (s) => altHTML(s),
  results: (s, now) => regionHTML(s, now),
});
function patchResults() {
  const s = curState(), now = ctxRef?.now ? ctxRef.now() : nowS();
  for (const [key, html] of Object.entries(REGIONS)) {
    const el = rootRef?.querySelector?.(`[data-region="nearby-${key}"]`);
    if (!el) continue;
    const h = html(s, now);
    if (h !== last[key]) { setHTMLKeepFocus(el, h); last[key] = h; }
  }
}

function rerender(focus) {
  if (!rootRef) return;
  last = {};
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
  rootRef = root; ctxRef = ctx; last = {};
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
  // a trip in progress, collapsed (spec 10.6, O3): the next step is the title, the trip under it, Arriving In on the
  // right; expanded, "Current trip" (the next-step card right under it says the same, in the hero size; iOS parity)
  title: (state, o) => (o && o.detent === "full" ? "" : tripHeader(state)?.title) || "Current trip",
  subtitle: (state, o) => (o && o.detent === "full" ? "" : tripHeader(state)?.sub || (isPlanJourney(state) ? "" : NO_TRIP_TITLE)) || "",
  detent: "half",
  tab: "nearby",
  render: (state) => renderNearby(state),
  meta: (state) => metaNearby(state),
  metaHTML: (state, o) => (o && o.detent === "full" && isPlanJourney(state) ? "" : metaNearbyHTML(state)),
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
  else if (ctx.store.get().locErr?.code === 1) { /* the blocked-location card says it (triedText), in view */ }
  else ctx.toast?.("Couldn't get your location. You can still search stations or places.");
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

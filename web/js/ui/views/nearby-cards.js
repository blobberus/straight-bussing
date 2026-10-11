/**
 * @module ui/views/nearby-cards
 * Row and card builders for the Current trip view (ui/views/nearby.js re-exports them; split out 2026-10-11 to keep
 * each file under 400 lines): arrival rows with walking guidance, the arrivals to list at a stop, the Favorites card
 * and the soonest arrivals anywhere. Pure HTML strings, every dynamic text escaped.
 */
import { esc } from "../../core/esc.js";
import { nowS, minsUntil } from "../../core/time.js";
import { arrivalsFor, staleLevel, liveUnknown } from "../../core/arrivals.js";
import { routeChip, etaBlock, arrivalRow } from "../components.js";
import { silentService } from "../../core/operating.js";
import { effectiveHidden } from "../../core/visibility.js";
import { ICONS } from "./pick.js";
import { catchNote } from "./tripinfo.js";

/** Favorites shown on Current trip (the rest are in My Routes). */
export const FAV_MAX = 3;

/** @returns {boolean} live data is late, old or failing (ETAs get "~" and the muted color) */
export const isStale = (state, now) => staleLevel(state, now) !== "";
/** @returns {string} a route's short name for text ("R1"), else its long name, else its id */
export const nameOf = (state, rid) => state.routes?.[rid]?.short || state.routes?.[rid]?.long || rid;

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

/**
 * Favorites card: up to FAV_MAX favorite stations with their next visible arrival; '' if none.
 * @param {object} state
 * @param {number} [now]
 * @returns {string}
 */
export function favoritesHTML(state, now = nowS()) {
  const ids = (state.favStops || []).filter((id) => state.stops?.[id]);
  if (!ids.length) return "";
  const hidden = effectiveHidden(state), stale = isStale(state, now), unknown = liveUnknown(state, now) || silentService(state, now);
  const rows = ids.slice(0, FAV_MAX).map((id) => {
    const name = state.stops[id].name || id;
    const a = state.liveLoaded ? arrivalsFor(state, id, { hidden, nowS: now })[0] : null;
    const m = a ? Math.max(0, minsUntil(a.t, now)) : null;
    const label = a ? `Favorite ${name}: route ${nameOf(state, a.rid)} ${m < 1 ? "arriving now" : "in " + m + " minutes"}${stale ? ", estimate" : ""}`
      : `Favorite ${name}: ${unknown ? "live times unavailable" : state.liveLoaded ? "no upcoming arrivals" : "loading"}`;
    const right = a ? etaBlock(a.t, { stale, now }) : `<span class="v-sec">${unknown ? "No live times" : state.liveLoaded ? "No buses soon" : ""}</span>`;
    return `<button type="button" class="v-row" data-action="stop:open" data-id="${esc(id)}" aria-label="${esc(label)}">${a ? routeChip(a.rid, state.routes) : `<span class="v-ic v-favic" aria-hidden="true">${ICONS.star}</span>`}<span class="v-grow"><span class="v-prim">${esc(name)}</span>${a ? `<span class="v-sec">${esc(state.routes?.[a.rid]?.long || "")}</span>` : ""}</span>${right}</button>`;
  }).join("");
  const more = '<button type="button" class="v-link v-favmore" data-action="nav" data-view="myroutes">All favorites</button>';
  return `<div class="v-favhead"><h3 class="v-h">Favorites</h3>${more}</div><section class="v-card v-favs" aria-label="Favorite stations">${rows}</section>`;
}

/**
 * The next visible arrival at every stop, soonest first (the "Arriving soon" list without location).
 * @param {object} state
 * @param {number} now
 * @returns {{id:string, a:object}[]} at most 6
 */
export function soonest(state, now) {
  const hidden = effectiveHidden(state), out = [];
  for (const id of Object.keys(state.stops || {})) {
    if (!(state.stopRoutes?.[id] || []).length) continue;
    const a = arrivalsFor(state, id, { hidden, nowS: now })[0];
    if (a) out.push({ id, a });
  }
  return out.sort((x, y) => x.a.t - y.a.t).slice(0, 6);
}

/**
 * @module ui/views/stop
 * Stop detail: Favorite toggle, address line, "Routes at this stop" chips, live arrivals (route chip,
 * route name, Live dot, ETA numeral, "Now"), "Updated Ns ago", and Directions to/from here.
 * Routes and arrivals follow core/visibility.effectiveHidden, so they match what the user set
 * visible (Routes menu, applied custom route, or a journey); hidden ones are counted in a note.
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { nowS, ago, clock } from "../../core/time.js";
import { arrivalsFor, staleLevel } from "../../core/arrivals.js";
import { effectiveHidden } from "../../core/visibility.js";
import { toggleFav } from "../../core/custom.js";
import { routeChip, arrivalRow, emptyState, skeleton } from "../components.js";
import { OFFICIAL_HTML } from "./pick.js";

/** Max arrivals listed on the stop screen. */
export const MAX_ARRIVALS = 10;

/**
 * Freshness footer text.
 * @param {object} state
 * @param {number} now
 * @returns {string} plain text
 */
export function updatedText(state, now) {
  if (!state.lastOk) return state.failed ? "Can't reach the shuttle feed. Retrying." : "Waiting for live data";
  const level = staleLevel(state, now);
  if (level === "err") return "Last live update " + clock(state.lastOk) + ". Retrying.";
  return "Updated " + ago(state.lastOk, now);
}

const STAR = '<svg class="ic" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83-5.38 2.83 1.03-6L3.3 9.6l6-.9z" fill="var(--star-fill, none)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

/**
 * Favorite toggle button for a stop (state shown by icon fill AND label/aria-pressed).
 * @param {string} id stop id
 * @param {boolean} on
 * @returns {string}
 */
export function favButton(id, on) {
  const label = on ? "Remove from favorites" : "Add to favorites";
  return `<button type="button" class="mr-fav${on ? " is-on" : ""}" data-action="stop:fav" data-id="${esc(id)}" aria-pressed="${on}" aria-label="${label}">${STAR}<span class="mr-favtxt">${on ? "Favorited" : "Favorite"}</span></button>`;
}

/**
 * Render the stop view.
 * @param {object} state store state (stopId selects the stop)
 * @param {number} [now] unix seconds
 * @returns {string}
 */
export function renderStop(state, now = nowS()) {
  if (!state.staticLoaded) return skeleton(4);
  const id = state.stopId, st = state.stops?.[id];
  if (!st) return emptyState("Stop not found", "This stop is not in the current schedule.") + '<button type="button" class="v-btn v-btn--secondary v-btn--block" data-action="stop:home">Back to Nearby</button>';
  const hidden = effectiveHidden(state);
  const all = [...new Set(state.stopRoutes?.[id] || [])];
  const shown = all.filter((r) => !hidden.includes(r)), hid = all.filter((r) => hidden.includes(r));
  const addr = state.addresses?.[id]?.address;
  const fav = (state.favStops || []).includes(id);
  let h = '<div class="v-stop">';
  h += `<div class="v-stophead mr-stophead"><div class="mr-stoptop"><p class="v-sec v-addr">${addr ? esc(addr) : "Address not available"}</p>${favButton(id, fav)}</div>`;
  h += `<p class="mr-label" id="mr-rts">Routes at this stop</p>`;
  h += shown.length
    ? `<span class="v-chips" role="list" aria-labelledby="mr-rts">${shown.map((r) => `<span role="listitem"><button type="button" class="v-chipbtn" data-action="route:open" data-id="${esc(r)}" aria-label="Route ${esc(state.routes?.[r]?.long || r)}">${routeChip(r, state.routes)}</button></span>`).join("")}</span>`
    : `<p class="v-sec">${all.length ? "None of your visible routes stop here." : "No routes listed for this stop."}</p>`;
  h += "</div>";
  h += `<div class="v-actions"><button type="button" class="v-btn v-btn--primary" data-action="dir:to-stop" data-id="${esc(id)}">Directions to here</button><button type="button" class="v-btn v-btn--secondary" data-action="dir:from-stop" data-id="${esc(id)}">From here</button></div>`;
  if (!state.liveLoaded) h += skeleton(3);
  else {
    const arr = arrivalsFor(state, id, { hidden, nowS: now }).slice(0, MAX_ARRIVALS);
    if (arr.length) h += '<div class="v-arrivals">' + arr.map((a) => arrivalRow(a, state, { now, action: "route:open" })).join("") + "</div>";
    else {
      const running = (state.buses || []).length > 0;
      h += emptyState("No upcoming arrivals", running ? "Nothing is predicted at this stop right now." : "No shuttles are running right now.");
      if (!running) h += OFFICIAL_HTML;
    }
  }
  if (hid.length) {
    const n = `+${hid.length} hidden route${hid.length > 1 ? "s" : ""} also stop${hid.length > 1 ? "" : "s"} here`;
    h += state.journey
      ? `<div class="v-note"><span class="v-grow v-sec">${n} (hidden during your trip).</span></div>`
      : `<div class="v-note"><span class="v-grow v-sec">${n}.</span><button type="button" class="v-btn v-btn--quiet" data-action="stop:unhide" data-id="${esc(id)}" aria-label="Show the hidden routes that stop here">Show</button></div>`;
  }
  const level = staleLevel(state, now);
  h += `<p class="v-foot${level === "err" ? " v-foot--warn" : ""}">${esc(updatedText(state, now))}</p>`;
  return h + "</div>";
}

/**
 * Open a stop: navigate, select it on the map and fly there.
 * @param {string} id
 * @param {object} ctx
 */
export function openStop(id, ctx) {
  const st = ctx?.store?.get?.().stops?.[id];
  if (!st) return;
  ctx.navigate("stop", { stopId: id });
  try { ctx.map?.setSelectedStop?.({ id, lat: st.lat, lon: st.lon }); ctx.map?.flyTo?.({ lat: st.lat, lon: st.lon }, 16); } catch (e) { /* map optional */ }
}

registerView("stop", {
  title: (state) => state.stops?.[state.stopId]?.name || "Stop",
  detent: "half",
  render: (state) => renderStop(state),
  unmount: () => {},
});

registerAction("stop:open", (ds, ev, ctx) => openStop(ds.id, ctx));
registerAction("stop:home", (ds, ev, ctx) => ctx.navigate("nearby"));
registerAction("stop:fav", (ds, ev, ctx) => {
  const s = ctx.store.get();
  if (!s.stops?.[ds.id]) return;
  const patch = toggleFav(s, ds.id);
  ctx.store.set(patch);
  ctx.toast?.(patch.favStops.includes(ds.id) ? "Added to favorites in My Routes" : "Removed from favorites");
});
registerAction("stop:unhide", (ds, ev, ctx) => {
  const s = ctx.store.get(), serve = s.stopRoutes?.[ds.id] || [];
  ctx.store.set({ hiddenRoutes: (s.hiddenRoutes || []).filter((r) => !serve.includes(r)) });
});

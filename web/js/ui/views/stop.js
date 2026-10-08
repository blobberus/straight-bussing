/**
 * @module ui/views/stop
 * Stop detail: route chips serving the stop, address line, live arrivals (route chip, route name,
 * Live dot, ETA numeral, "Now"), "Updated Ns ago", and Directions to/from here.
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { nowS, ago, clock } from "../../core/time.js";
import { arrivalsFor, staleLevel } from "../../core/arrivals.js";
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
  const hidden = state.hiddenRoutes || [];
  const all = [...new Set(state.stopRoutes?.[id] || [])];
  const shown = all.filter((r) => !hidden.includes(r)), hid = all.filter((r) => hidden.includes(r));
  const addr = state.addresses?.[id]?.address;
  let h = '<div class="v-stop">';
  h += `<div class="v-stophead"><span class="v-chips">${shown.map((r) => `<button type="button" class="v-chipbtn" data-action="route:open" data-id="${esc(r)}" aria-label="Route ${esc(state.routes?.[r]?.long || r)}">${routeChip(r, state.routes)}</button>`).join("")}</span>`;
  if (addr) h += `<p class="v-sec v-addr">${esc(addr)}</p>`;
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
    h += `<div class="v-note"><span class="v-grow v-sec">${hid.length} hidden route${hid.length > 1 ? "s" : ""} not shown here.</span><button type="button" class="v-btn v-btn--quiet" data-action="stop:unhide" data-id="${esc(id)}">Show</button></div>`;
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
registerAction("stop:unhide", (ds, ev, ctx) => {
  const s = ctx.store.get(), serve = s.stopRoutes?.[ds.id] || [];
  ctx.store.set({ hiddenRoutes: (s.hiddenRoutes || []).filter((r) => !serve.includes(r)) });
});

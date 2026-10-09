/**
 * @module ui/views/journey
 * "Only show relevant routes" (store.journey) helpers shared by Directions and Routes to station.
 * Not a view (no registerView). Builds journey objects, the in-sheet trip bar, the station toggle,
 * and a watcher that keeps a station journey in step with store.routeFilter (cleared filter ends it,
 * a new station updates it). `journey:end` itself is registered by the shell (ui/contextbar.js).
 */
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { effectiveHidden } from "../../core/visibility.js";
import { routeChip } from "../components.js";

/**
 * Unique route ids of an option's bus legs, in ride order.
 * @param {{legs?:Array<{type:string, rid?:string}>}|null} o planner Option
 * @returns {string[]}
 */
export function optionRids(o) {
  const out = [];
  for (const l of (o && o.legs) || []) if (l.type === "bus" && l.rid != null && !out.includes(String(l.rid))) out.push(String(l.rid));
  return out;
}

const numOr = (x) => (typeof x === "number" && isFinite(x) ? x : null);

/**
 * Compact legs of an option, enough to follow the trip later without the Directions view
 * (core/tripprogress.js): walk {type, min, toName}, bus {type, rid, board:{id,name}, alight:{id,name},
 * tripId, vehicleId, boardT, alightT, source, waitLive}. The last walk is named after the destination.
 * @param {object|null} o planner Option
 * @param {string} [toLabel] destination name
 * @returns {Array<object>}
 */
export function journeyLegs(o, toLabel) {
  const legs = (o && o.legs) || [], out = [];
  legs.forEach((l, i) => {
    if (!l) return;
    if (l.type === "walk") {
      const next = legs[i + 1];
      const toName = i === legs.length - 1 ? toLabel || "destination" : next && next.type === "bus" && next.board ? next.board.name : l.to && l.to.name;
      out.push({ type: "walk", min: Number(l.min) || 0, toName: toName != null ? String(toName) : null });
    } else if (l.type === "bus" && l.board && l.alight && l.rid != null) {
      out.push({ type: "bus", rid: String(l.rid), board: { id: String(l.board.id), name: String(l.board.name ?? l.board.id) },
        alight: { id: String(l.alight.id), name: String(l.alight.name ?? l.alight.id) }, tripId: l.tripId != null ? String(l.tripId) : null,
        vehicleId: l.vehicleId != null ? String(l.vehicleId) : null,
        boardT: numOr(l.boardT), alightT: numOr(l.alightT), source: l.source || null, waitLive: !!l.waitLive });
    }
  });
  return out;
}

/**
 * Journey for a directions option, or null when it has no bus legs (walk-only trips hide nothing).
 * Besides {rids, label, kind} it carries what the Current trip timeline needs to follow the trip
 * (ui/views/tripprogress.js): `to` (destination name), `t0` (when the plan was made, unix s) and
 * `legs` (journeyLegs). Not persisted.
 * @param {object|null} o planner Option
 * @param {string} [toLabel] destination name
 * @returns {{rids:string[], label:string, kind:'plan', to:string, t0:number|null, legs:Array<object>}|null}
 */
export function planJourney(o, toLabel) {
  const rids = optionRids(o);
  if (!rids.length) return null;
  const to = toLabel || "destination";
  return { rids, label: "To " + to, kind: "plan", to, t0: numOr(o && o.t0), legs: journeyLegs(o, to) };
}

/**
 * Same set of route ids (order ignored)?
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
export function sameRids(a, b) {
  const x = new Set((a || []).map(String)), y = new Set((b || []).map(String));
  return x.size === y.size && [...x].every((r) => y.has(r));
}

/**
 * Routes the user has hidden themselves (the journey itself does not count).
 * @param {object} state
 * @returns {string[]}
 */
export function userHidden(state) {
  return effectiveHidden({ ...state, journey: null });
}

/**
 * Journey for the current station filter: its routes that the user has not hidden (all of them if
 * every one is hidden, since the user asked for this station explicitly). Null without a filter.
 * @param {object} state needs routeFilter {ids, label}
 * @returns {{rids:string[], label:string, kind:'station'}|null}
 */
export function filterJourney(state) {
  const f = state && state.routeFilter;
  const ids = [...new Set(((f && f.ids) || []).map(String))];
  if (!ids.length) return null;
  const hidden = new Set(userHidden(state));
  const vis = ids.filter((r) => !hidden.has(r));
  return { rids: vis.length ? vis : ids, label: (f && f.label) || "station", kind: "station" };
}

/** @param {object} state @returns {boolean} a Directions trip is shown */
export const isPlanJourney = (state) => !!(state && state.journey && state.journey.kind === "plan");
/** @param {object} state @returns {boolean} a station journey is on */
export const isStationJourney = (state) => !!(state && state.journey && state.journey.kind === "station");

/**
 * Compact trip bar shown at the top of the Directions results while a trip is started.
 * @param {object} state
 * @returns {string} '' when no plan journey
 */
export function tripBarHTML(state) {
  if (!isPlanJourney(state)) return "";
  const j = state.journey;
  const chips = j.rids.map((r) => routeChip(r, state.routes)).join("");
  return `<div class="j-trip" role="region" aria-label="Trip in progress"><span class="j-dot" aria-hidden="true"></span>`
    + `<span class="v-grow"><span class="v-prim j-title" tabindex="-1">Trip ${esc(j.label.replace(/^To /, "to "))}</span>`
    + `<span class="v-sec j-sub">Map shows only ${j.rids.length > 1 ? "these routes" : "this route"} <span class="j-chips">${chips}</span></span></span>`
    + `<button type="button" class="v-btn v-btn--secondary j-end" data-action="journey:end">End trip</button></div>`;
}

/**
 * "Only show these routes" toggle for an active station filter (Routes view can render it next to the
 * filter chip; the action is registered here). '' without a filter.
 * @param {object} state
 * @returns {string}
 */
export function stationToggleHTML(state) {
  if (!(state && state.routeFilter && (state.routeFilter.ids || []).length)) return "";
  const on = isStationJourney(state);
  return `<button type="button" class="v-btn v-btn--quiet j-stoggle" data-action="journey:station" aria-pressed="${on}">${on ? "Show all routes" : "Only show these routes"}</button>`;
}

/**
 * Pre-choice switch in the picker: when on, choosing a station also hides every other route.
 * Purely a preference: it highlights nothing.
 * @param {boolean} on
 * @returns {string}
 */
export function onlySwitchHTML(on) {
  return `<button type="button" class="v-row j-only" role="switch" aria-checked="${!!on}" data-action="pick:only">`
    + `<span class="v-grow"><span class="v-prim">Only show the chosen station's routes</span><span class="v-sec">Hides other routes on the map until you clear the station</span></span>`
    + `<span class="j-sw" aria-hidden="true"><span class="j-knob"></span></span></button>`;
}

const watched = new WeakSet();

/**
 * Keep a station journey in step with routeFilter: cleared filter -> journey ends; another station ->
 * journey follows it. Installed once per store; cheap.
 * @param {{get():object, set(p:object):void, subscribe(fn:(s:object, ch:Set<string>)=>void):()=>void}} store
 * @returns {void}
 */
export function watchStation(store) {
  if (!store || typeof store.subscribe !== "function" || watched.has(store)) return;
  watched.add(store);
  store.subscribe((s, ch) => {
    if (!ch || !ch.has("routeFilter") || !isStationJourney(s)) return;
    const j = filterJourney(s);
    if (!j) store.set({ journey: null });
    else if (!sameRids(j.rids, s.journey.rids) || j.label !== s.journey.label) store.set({ journey: j });
  });
}

/**
 * Turn the station journey on/off for the current filter.
 * @param {object} ctx view ctx (store)
 * @returns {boolean} true when now on
 */
export function toggleStationJourney(ctx) {
  const s = ctx.store.get();
  watchStation(ctx.store);
  if (isStationJourney(s)) { ctx.store.set({ journey: null }); return false; }
  const j = filterJourney(s);
  if (j) ctx.store.set({ journey: j });
  return !!j;
}

registerAction("journey:station", (ds, ev, ctx) => { toggleStationJourney(ctx); });

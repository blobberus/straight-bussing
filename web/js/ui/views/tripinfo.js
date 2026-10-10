/**
 * @module ui/views/tripinfo
 * Trip timing helpers shared by Plan Trip (nearby.js) and Directions (directions.js). Not a view.
 * Makes walking visible: the walk to the first stop and from the last stop are always named in the
 * option card and step list (or "no walk needed" when the planner dropped a leg under 25 m), totals say they
 * include walking, and "Leave now / Leave in N min" guidance is derived from the walking estimate.
 * Every derived time here is an estimate and is labeled so.
 */
import { esc } from "../../core/esc.js";
import { clock } from "../../core/time.js";
import { walkMin } from "../../core/geo.js";
import { routeChip } from "../components.js";

/** Ride-time source wording for bus steps. */
export const SRC = { live: "from live bus prediction", learned: "learned from past rides", schedule: "from schedule", estimate: "distance estimate" };
/** Walking person icon (decorative). */
export const WALK_IC = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13" cy="4" r="2"/><path d="M10 22l2-7-3-3 1-5 4 3 3 1M9 12l-3 2v3"/></svg>';

/** @param {string} t @returns {string} small "est."-style tag */
export const tag = (t) => `<span class="v-est">${esc(t)}</span>`;
/** @param {number} m minutes @returns {number} whole minutes, at least 1 */
export const mins = (m) => Math.max(1, Math.round(m || 0));
/** @param {number} m walking minutes @returns {string} "<1" under half a minute, else whole minutes */
export const walkMins = (m) => ((m || 0) < 0.5 ? "<1" : String(Math.round(m)));

/**
 * Walking minutes to a stop from a straight-line distance (x1.2 detour, same as walkText). Estimate.
 * @param {number} d meters
 * @returns {number} float minutes
 */
export function stopWalkMin(d) {
  return walkMin((d || 0) * 1.2);
}

/**
 * Guidance for catching a bus on foot.
 * @param {number} etaS bus arrival (unix s)
 * @param {number} walkM walking minutes to the stop (float, estimate)
 * @param {number} now unix s
 * @returns {{kind:'miss'|'now'|'later', text:string, aria:string, slack:number}}
 */
export function catchNote(etaS, walkM, now) {
  const slack = (etaS - now) / 60 - (walkM || 0);
  if (slack < 0) return { kind: "miss", slack, text: "Leaves before you can walk there, est.", aria: "leaves before you can walk there, estimate from walking time" };
  if (slack < 1) return { kind: "now", slack, text: "Leave now, est.", aria: "leave now to catch it, estimate from walking time" };
  const n = Math.floor(slack);
  return { kind: "later", slack, text: `Leave in ${n} min, est.`, aria: `leave in ${n} minute${n === 1 ? "" : "s"} to catch it, estimate from walking time` };
}

/**
 * Board / alight clock per leg (null for walk legs), walking forward from the option's start.
 * @param {object} o Option
 * @param {number} now unix s (used when the option has no t0)
 * @returns {Array<{b:number,a:number}|null>}
 */
export function legsTimes(o, now) {
  let t = typeof o.t0 === "number" && isFinite(o.t0) ? o.t0 : now;
  return o.legs.map((l) => {
    if (l.type === "walk") { t += (l.min || 0) * 60; return null; }
    const b = l.boardT || t + (l.wait || 0) * 60, a = l.alightT || b + (l.ride || 0) * 60;
    t = a; return { b, a };
  });
}

/** @param {object} o Option @returns {number} total walking minutes (float) */
export function walkTotal(o) {
  return (o.legs || []).reduce((s, l) => s + (l.type === "walk" ? l.min || 0 : 0), 0);
}

/**
 * When to leave for the first bus. Only for a live first bus (a headway guess is not a departure time).
 * @param {object} o Option
 * @param {number} now unix s
 * @returns {{kind:'now'|'later', text:string, by:number, slack:number}|null}
 */
export function leaveInfo(o, now) {
  const fb = (o.legs || []).findIndex((l) => l.type === "bus");
  const bus = fb >= 0 ? o.legs[fb] : null;
  if (!bus || !bus.waitLive || !bus.boardT) return null;
  const walkBefore = o.legs.slice(0, fb).reduce((s, l) => s + (l.type === "walk" ? l.min || 0 : 0), 0);
  const by = bus.boardT - walkBefore * 60, slack = (by - now) / 60;
  if (slack < 1) return { kind: "now", text: "Leave now", by, slack };
  return { kind: "later", text: `Leave in ${Math.floor(slack)} min (by ${clock(by)})`, by, slack };
}

/**
 * Card lines under an option's chips: first walk + first bus, then leave guidance + walking total.
 * @param {object} o Option
 * @param {number} now
 * @returns {{html:string, text:string}} html for the card, text for its aria-label
 */
export function optionLines(o, now) {
  const times = legsTimes(o, now), fb = o.legs.findIndex((l) => l.type === "bus");
  if (fb < 0) return { html: "", text: "" };
  const bus = o.legs[fb], first = o.legs[0], board = bus.board?.name || "the stop";
  const busAt = clock(times[fb].b);
  const l1 = first.type === "walk"
    ? `Walk ${walkMins(first.min)} min to ${board} · bus ${busAt}`
    : `Board at ${board}, no walk · bus ${busAt}`;
  const wt = walkTotal(o), leave = leaveInfo(o, now);
  const incl = wt > 0 ? `includes ${walkMins(wt)} min walking` : "no walking";
  const l2 = (leave ? leave.text + " · " : "") + (leave ? incl : incl.charAt(0).toUpperCase() + incl.slice(1));
  return {
    html: `<span class="v-sec j-oline">${esc(l1)}</span><span class="v-sec j-oline${leave?.kind === "now" ? " j-now" : ""}">${esc(l2)}</span>`,
    text: `${l1}. ${l2}`,
  };
}

/**
 * Step list for an option: the walk to the first stop and to the destination are always shown.
 * @param {object} o Option
 * @param {number} now
 * @param {object} state store state (routes)
 * @param {{fromLabel?:string, toLabel?:string}} [labels]
 * @returns {string}
 */
export function stepsHTML(o, now, state, { fromLabel, toLabel } = {}) {
  const times = legsTimes(o, now), legs = o.legs, n = legs.length;
  const dest = toLabel || "destination";
  const li = (ic, h, cls) => `<li${cls ? ` class="${cls}"` : ""}><span class="v-si" aria-hidden="true">${ic}</span><span class="v-stept">${h}</span></li>`;
  const sub = (h) => `<span class="v-sec v-stepsub">${h}</span>`;
  const steps = [];
  if (legs[0]?.type === "bus") {
    steps.push(li(WALK_IC, `Start at <b>${esc(legs[0].board?.name || fromLabel || "the stop")}</b>, no walk needed` + (fromLabel && fromLabel !== legs[0].board?.name ? sub(`${esc(fromLabel)} is right by the stop`) : ""), "j-walk"));
  }
  legs.forEach((l, i) => {
    if (l.type === "walk") {
      const next = legs[i + 1], prev = legs[i - 1];
      const to = i === n - 1 ? dest : next?.type === "bus" ? next.board?.name : l.to?.name;
      const change = prev?.type === "bus" && next?.type === "bus" ? " to change" : "";
      let h = `Walk ${esc(walkMins(l.min))} min (${Math.round(l.m || 0)} m) to <b>${esc(to || "the stop")}</b>${change} ${tag(l.source === "router" ? "sidewalk route" : "estimate")}`;
      if (i === 0 && next?.type === "bus") {
        const lv = leaveInfo(o, now);
        if (lv) h += sub(`${lv.kind === "now" ? "Leave now" : "Leave by " + esc(clock(lv.by))} to catch the ${esc(clock(times[1].b))} bus ${tag("est.")}`);
      }
      steps.push(li(WALK_IC, h, "j-walk"));
      return;
    }
    const t = times[i], w = Math.round(l.wait || 0), r = mins(l.ride);
    steps.push(li(routeChip(l.rid, state.routes), `Bus arrives at <b>${esc(l.board?.name || "")}</b> <b class="v-clock">${esc(clock(t.b))}</b> ${tag(l.waitLive ? "live" : "est.")}`
      + sub(`Wait ~${w < 1 ? "&lt;1" : w} min, then ride ~${r} min (${l.stopsPassed || 1} stop${(l.stopsPassed || 1) > 1 ? "s" : ""}) to ${esc(l.alight?.name || "")}, ${esc(clock(t.a))} &middot; ${esc(SRC[l.source] || "estimate")} ${tag("est.")}`)));
  });
  if (legs[n - 1]?.type === "bus") {
    const al = legs[n - 1].alight?.name || "the stop";
    steps.push(li(WALK_IC, `Get off at <b>${esc(al)}</b>, no walk needed` + (dest !== al ? sub(`${esc(dest)} is right there`) : ""), "j-walk"));
  }
  const wt = walkTotal(o);
  steps.push(li('<span class="v-pin v-pin--b"></span>', `Arrive at <b>${esc(dest)}</b> about <b class="v-clock">${esc(clock(o.arrive))}</b>`
    + sub(`About ${o.totalMin} min in total, ${wt > 0 ? "including " + esc(walkMins(wt)) + " min walking" : "no walking"} ${tag("est.")}`)));
  return '<ol class="v-steps">' + steps.join("") + "</ol>";
}

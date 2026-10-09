/**
 * @module ui/views/tripprogress
 * Current trip timeline, Google-Maps-transit style (not a view: nearby.js renders it in its
 * 'nearby-trip' region while a Directions trip is on). One call, self-contained, re-rendered on every
 * store change and the 15 s refresh: tripProgressHTML(state, now).
 *
 * Top: "Trip to <destination>", arrive ~clock est., End trip; a one-glance status card for the phase
 * (walk to the stop + when to leave / bus N stops away / N stops to your stop / walk to the
 * destination). Then a vertical timeline: walk rows on a dotted line, each bus leg drawn like the
 * route detail stop timeline (4 px line in the route color, 14 px stop dots, "Board here" / "Get off
 * here", next ETA per stop) with the followed bus as a chip ON the line between the right stops;
 * passed stops are dimmed AND say "Passed"; the bus position is also written out (leg head line and
 * row labels), never color alone. A move of the bus slides the chip once (CSS, transform only; none
 * under reduced motion). Then the destination, "Trip steps" (Directions) and an honesty footnote.
 * Data: core/tripprogress.js. Styles: css/trip.css (tp-), on top of views.css primitives.
 */
import { esc, safeColor, textOn } from "../../core/esc.js";
import { nowS, clock, minsUntil, ago } from "../../core/time.js";
import { tripProgress } from "../../core/tripprogress.js";
import { routeChip, etaBlock, officialLinks } from "../components.js";
import { isPlanJourney, tripBarHTML } from "./journey.js";
import { WALK_IC, tag, walkMins, catchNote } from "./tripinfo.js";

const CHEV = '<svg class="tp-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7"/></svg>';
const PIN = '<span class="tp-pin" aria-hidden="true"></span>';
const SLIDE_S = 3;

/** Last chip position per leg + vehicle, so a move slides once instead of on every re-render. */
const motion = new Map();
function slideFrom(key, top, now) {
  const m = motion.get(key);
  if (!m) { motion.set(key, { top, from: null, t: 0 }); if (motion.size > 24) motion.delete(motion.keys().next().value); return null; }
  if (m.top !== top) { m.from = m.top; m.top = top; m.t = now; }
  return m.from != null && now - m.t < SLIDE_S ? m.from : null;
}
/** Test hook: forget remembered bus positions. */
export function resetTripMotion() { motion.clear(); }

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const busName = (v) => (v && v.label ? `Bus ${v.label}` : "The bus");
/** "4 min" / "Now" (with "~" while live data is delayed), like the route detail timeline. */
export function etaText(t, now, late) {
  if (!t) return "";
  const m = minsUntil(t, now);
  return m < 1 ? "Now" : (late ? "~" : "") + m + " min";
}
const inMin = (t, now) => { const m = minsUntil(t, now); return m < 1 ? "now" : `in ${plural(m, "minute")}`; };

/**
 * Where the followed bus is, in words ("Bus 101 is 3 stops away", "Bus 101 is between A and B").
 * @param {object} leg bus leg from tripProgress
 * @param {number} now unix seconds (for the age of a stale position)
 * @returns {{status:string, where:string}}
 */
export function busWords(leg, now) {
  const v = leg.vehicle;
  if (!v) return { status: "", where: "" };
  const who = busName(v), b = leg.board.name, a = leg.alight.name;
  let status = "";
  if (leg.stopsAway != null) status = leg.stopsAway === 0 ? (v.at ? `${who} is at ${b}` : `${who} is approaching ${b}`) : `${who} is ${plural(leg.stopsAway, "stop")} away`;
  else if (leg.stopsLeft != null) status = leg.stopsLeft === 0 ? `Get off here: ${a}` : leg.stopsLeft === 1 ? `Get off at the next stop: ${a}` : `${plural(leg.stopsLeft, "stop")} to ${a}`;
  let where = v.at ? `${who} is at ${v.nextName}` : v.prevName ? `${who} is between ${v.prevName} and ${v.nextName}` : `${who} is heading to ${v.nextName}`;
  if (v.stale && v.seen) where += `, location from ${ago(v.seen, now)}`;
  return { status, where };
}

/** One-glance status card for the current phase. */
function nowCard(p, state, now) {
  const leg = p.legs[p.active], late = !!p.stale;
  let ic = "", prim = "", sec = [], right = "";
  if (p.phase === "arrived") {
    const fin = leg && leg.type === "walk" ? leg : null;
    ic = PIN;
    prim = fin ? `Walk ${walkMins(fin.min)} min to ${p.to}` : `You have arrived at ${p.to}`;
    if (p.arriveT) sec.push(`Arrive about ${clock(p.arriveT)}, est.`);
  } else {
    const w = busWords(leg, now), route = (state.routes && state.routes[leg.rid]) || {};
    ic = routeChip(leg.rid, state.routes);
    if (p.phase === "walk-to-stop") {
      ic = `<span class="tp-wic" aria-hidden="true">${WALK_IC}</span>`;
      prim = `Walk ${walkMins(leg.walkMin)} min to ${leg.board.name}`;
      if (leg.boardEta) sec.push(catchNote(leg.boardEta, leg.walkMin || 0, now).text);
      sec.push(w.status || (leg.boardEta ? `${route.short || "Bus"} ${leg.boardLive ? "arrives" : "planned"} ${inMin(leg.boardEta, now)}${leg.boardLive ? "" : ", est."}` : "No live bus time yet"));
    } else if (p.phase === "waiting") {
      prim = w.status || (leg.boardEta ? (leg.boardLive ? "Next bus" : `Bus planned for ${clock(leg.boardEta)}`) : "Waiting for the bus");
      sec.push(`Board at ${leg.board.name}${leg.boardEta ? " " + inMin(leg.boardEta, now) : ""}${leg.boardLive ? "" : leg.boardEta ? ", est." : ""}`);
      if (leg.missed) sec.push("Your planned bus has left. Showing the next one.");
    } else {
      prim = w.status || `Riding to ${leg.alight.name}`;
      sec.push(`Get off at ${leg.alight.name}${leg.alightEta ? ` about ${clock(leg.alightEta)}${leg.alightLive ? "" : ", est."}` : ""}`);
    }
    if (!leg.live) sec.push(leg.byTime ? "No live bus data: following the plan's times (estimate)." : "No live bus position right now.");
    const t = p.phase === "on-bus" ? leg.alightEta : leg.boardEta;
    const live = p.phase === "on-bus" ? leg.alightLive : leg.boardLive;
    if (t) right = etaBlock(t, { stale: late || !live, now });
  }
  return `<div class="tp-now tp-now--${esc(p.phase)}">${ic}<span class="v-grow"><span class="v-prim tp-nowprim">${esc(prim)}</span>`
    + sec.map((s) => `<span class="v-sec">${esc(s)}</span>`).join("") + `</span>${right}</div>`;
}

/** Walk row. */
function walkHTML(l, legs, i, now) {
  const next = legs[i + 1], prev = legs[i - 1];
  const change = prev && prev.type === "bus" && next && next.type === "bus";
  const m = l.state === "active" && l.minNow != null ? l.minNow : l.min;
  const head = l.state === "done" ? `Walked to ${l.toName}` : `Walk ${walkMins(m)} min to ${l.toName}${change ? " to change" : ""}`;
  let sub = "";
  if (l.state === "active" && next && next.type === "bus" && next.boardEta) sub = catchNote(next.boardEta, m, now).text;
  else if (l.state !== "done") sub = "Walking time, est.";
  const first = i === 0 ? " is-start" : "";
  return `<li class="tp-step tp-walk is-${l.state}${first}"><span class="tp-wic" aria-hidden="true">${WALK_IC}</span><span class="v-grow"><span class="tp-wt">${esc(head)}${l.state === "active" ? '<span class="v-sr"> (now)</span>' : ""}</span>${sub ? `<span class="v-sec">${esc(sub)}</span>` : ""}</span></li>`;
}

/** Bus leg: head (route, stops, where the bus is) + stop timeline with the bus chip on the line. */
function busHTML(leg, li, p, state, now) {
  const r = (state.routes && state.routes[leg.rid]) || {}, color = safeColor(r.color), fg = textOn(color);
  const late = !!p.stale, done = leg.state === "done", active = leg.state === "active";
  let stops = leg.stops, bIdx = leg.boardIdx, aIdx = leg.alightIdx;
  if (done && stops.length > 2) { stops = [stops[bIdx], stops[aIdx]]; bIdx = 0; aIdx = 1; }
  const v = active ? leg.vehicle : null, showV = !!v && v.idx < stops.length;
  const lead = showV && (v.idx < 0 || (v.idx === 0 && !v.at));
  const n = stops.length + (lead ? 1 : 0), w = busWords(leg, now);
  const nStops = Math.max(1, leg.alightIdx - leg.boardIdx);
  const meta = [plural(nStops, "stop")];
  if (leg.rideMin) meta.push(`~${Math.max(1, Math.round(leg.rideMin))} min ride, est.`);
  const whereLine = active ? (v ? w.where : leg.live ? "" : "No live position for this bus")
    : leg.state === "upcoming" && leg.boardEta ? `Next bus ${leg.boardLive ? "at" : "planned"} ${clock(leg.boardEta)}${leg.boardLive ? "" : ", est."}` : "";
  const name = r.long || r.short || "Route";
  let h = `<li class="tp-step tp-bus is-${leg.state}" style="--rc:${color}">`
    + `<button type="button" class="tp-bushead" data-action="route:open" data-id="${esc(leg.rid)}" aria-label="${esc(`${name}: ${meta.join(", ")}${whereLine ? ". " + whereLine : ""}. Open route details`)}">`
    + `${routeChip(leg.rid, state.routes)}<span class="v-grow"><span class="v-prim">${esc(name)}</span><span class="v-sec">${esc(meta.join(" · "))}</span>`
    + (whereLine ? `<span class="v-sec tp-where${v && v.stale ? " is-stale" : ""}">${esc(whereLine)}</span>` : "") + `</span>${CHEV}</button>`;
  h += `<div class="tp-seg"><ol class="tp-stops" style="--n:${n}" aria-label="${esc(`Stops from ${leg.board.name} to ${leg.alight.name}`)}">`;
  if (lead && v.idx === 0 && v.prevName) {
    // the stop the bus just left, as a passed stop (not tappable: it is outside your trip)
    h += `<li class="tp-stop tp-lead is-before is-passed"><span class="tp-leadrow"><span class="tp-sname">${esc(v.prevName)}</span><span class="tp-eta is-passed">Passed</span></span></li>`;
  } else if (lead) {
    const t = v.idx < 0 ? `${plural(v.behind, "more stop")} before ${stops[0].name}` : `${busName(v)} is starting its trip`;
    h += `<li class="tp-stop tp-lead is-more"><span class="tp-leadt">${esc(t)}</span></li>`;
  }
  const dimSeg = (j) => j + 1 <= bIdx || (stops[j + 1] && (stops[j + 1].state === "passed" || stops[j + 1].state === "current"));
  stops.forEach((s, k) => {
    const cls = [`is-${s.state}`, `is-${s.role}`];
    if (k === 0 && !lead) cls.push("is-first");
    if (k === stops.length - 1) cls.push("is-last");
    if ((k > 0 && dimSeg(k - 1)) || (k === 0 && lead)) cls.push("dim-top");
    if (k < stops.length - 1 && dimSeg(k)) cls.push("dim-bot");
    const live = !!s.eta, passed = s.state === "passed";
    let eta = passed ? "Passed" : live ? etaText(s.eta, now, late) : "", est = "";
    if (!passed && !live && s.role === "board" && leg.boardEta && !leg.boardLive) { eta = "~" + clock(leg.boardEta); est = tag("est."); }
    if (!passed && !live && s.role === "alight" && leg.alightEta && !leg.alightLive) { eta = "~" + clock(leg.alightEta); est = tag("est."); }
    const tags = [];
    if (s.role === "board") tags.push(`<span class="tp-tag tp-tag--board">Board here</span>`);
    if (s.role === "alight") tags.push(`<span class="tp-tag tp-tag--alight">Get off here</span>`);
    if (showV && (s.state === "current" || s.state === "next") && v.idx === k) {
      tags.push(`<span class="v-tlbus tp-buspill${v.stale ? " is-stale" : ""}" style="background:${color};color:${fg}">${esc(busName(v))} ${s.state === "current" ? "is here" : "heading here"}</span>`);
    }
    const say = [s.name, s.role === "board" ? "board here" : s.role === "alight" ? "get off here" : "",
      passed ? "the bus has passed this stop" : s.state === "current" && showV ? "the bus is at this stop" : s.state === "next" && showV ? "the bus is heading here" : "",
      live && !passed ? `bus ${inMin(s.eta, now)}${late ? ", data delayed" : ""}` : est ? `planned about ${clock(s.role === "board" ? leg.boardEta : leg.alightEta)}, estimate` : ""].filter(Boolean).join(", ");
    h += `<li class="tp-stop ${cls.join(" ")}"><button type="button" class="tp-sbtn" data-action="stop:open" data-id="${esc(s.id)}" aria-label="${esc(say)}">`
      + `<span class="v-grow"><span class="tp-sname">${esc(s.name)}</span>${tags.length ? `<span class="tp-tags">${tags.join("")}</span>` : ""}</span>`
      + `<span class="tp-eta${eta === "Now" ? " is-now" : ""}${passed ? " is-passed" : ""}">${esc(eta)}${est}</span></button></li>`;
  });
  h += "</ol>";
  if (showV) {
    // fifths of a segment: the chip still moves with live data, but the HTML (which the Current trip
    // region re-patches when it changes, dropping focus) does not change on every 10 s poll
    const vpos = Math.round((lead ? (v.idx < 0 ? 0 : v.pos + 1) : v.pos) * 5) / 5;
    const top = `${(((vpos + 0.5) / n) * 100).toFixed(2)}%`;
    const from = slideFrom(`${li}|${leg.rid}|${leg.board.id}>${leg.alight.id}|${v.id || v.label}`, top, now);
    const label = String(v.label || "Bus");
    h += `<span class="tp-track${from ? " is-moving" : ""}" style="--to:${top}${from ? `;--from:${from}` : ""}" aria-hidden="true">`
      + `<span class="tp-veh${v.stale ? " is-stale" : ""}" style="--vc:${color};background:${color};color:${fg}">${esc(label.length > 5 ? label.slice(-5) : label)}</span></span>`;
  }
  return h + "</div></li>";
}

/**
 * The Current trip block for a started Directions trip ('' when no trip). Journeys without the
 * compact legs (older shape) fall back to the plain trip bar.
 * @param {object} state store state (journey, routes, stops, routeStops, buses, trips, user, feed fields)
 * @param {number} [now] unix seconds
 * @param {{actionsHTML?:string}} [opts] actionsHTML: trusted markup (e.g. the "Routes to station…"
 *   button) appended to the action row next to "Trip steps"
 * @returns {string} HTML (all dynamic text escaped)
 */
export function tripProgressHTML(state, now = nowS(), opts = {}) {
  if (!isPlanJourney(state)) return "";
  const steps = '<button type="button" class="v-btn v-btn--secondary tp-steps-btn" data-action="nav" data-view="directions">Trip steps</button>'
    + (typeof opts.actionsHTML === "string" ? opts.actionsHTML : "");
  const p = tripProgress(state.journey, state, now);
  if (!p) return tripBarHTML(state) + `<div class="tp-acts">${steps}</div>`;
  const left = p.arriveT ? Math.max(0, Math.round((p.arriveT - now) / 60)) : null;
  const arrive = p.arriveT ? `Arrive about ${esc(clock(p.arriveT))}${left != null && p.phase !== "arrived" ? ` · ${left < 1 ? "under a minute" : left + " min"}` : ""} ${tag("est.")}` : "Arrival time unknown";
  let h = `<section class="tp" aria-label="Trip in progress">`
    + `<div class="tp-head"><span class="v-grow"><span class="tp-title" tabindex="-1">${esc("Trip to " + p.to)}</span><span class="v-sec tp-arrive">${arrive}</span></span>`
    + `<button type="button" class="v-btn v-btn--secondary tp-end" data-action="journey:end">End trip</button></div>`;
  if (p.stale === "old" || p.stale === "err") h += '<p class="v-stale" role="status">Live data delayed. Bus position and times may be off.</p>';
  h += nowCard(p, state, now);
  h += '<ol class="tp-steps" aria-label="Trip timeline">';
  p.legs.forEach((l, i) => { h += l.type === "walk" ? walkHTML(l, p.legs, i, now) : busHTML(l, i, p, state, now); });
  h += `<li class="tp-step tp-dest${p.phase === "arrived" ? " is-active" : ""}">${PIN}<span class="v-grow"><span class="tp-wt">${esc(p.to)}</span>`
    + `<span class="v-sec">${p.arriveT ? `Arrive about ${esc(clock(p.arriveT))} ${tag("est.")}` : "Destination"}</span></span></li></ol>`;
  h += `<div class="tp-acts">${steps}</div>`;
  const cur = p.legs[p.active];
  const live = cur && cur.type === "bus" ? cur.live : p.live;
  h += `<p class="v-foot tp-foot">${live ? "Bus position and stop times are live predictions and can change." : "No live data for this bus right now: times come from the trip plan."} Every time here is an estimate.</p>`;
  if (p.stale === "err") h += `<p class="v-foot">${officialLinks()}</p>`;
  return h + "</section>";
}

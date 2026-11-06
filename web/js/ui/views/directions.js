/**
 * @module ui/views/directions
 * Directions: Start / Destination fields (station autocomplete + Photon places, "My location" default when
 * granted), swap, plan via core/planner plan(), then refineWalking() async with core/walk walkRoute (sidewalk
 * routes). Up to 4 option cards ranked by core/rank.js (least walking, earliest arrival, shortest wait, how many
 * it meets), each with what it minimizes, total, arrive clock, chip summary and est tags; tapping a card draws it
 * on the map. Steps say "Bus arrives at <stop> <clock>" with wait / ride / source. Walk-only fallback and
 * no-service state. Live updates re-plan in the background at most every DIR_REFRESH_S (iOS refreshDirections:
 * deferred while a new plan refines, skipped while the feed fails), keep the selected card by key, never move
 * the map, and patch only the results region, so typing focus is never stolen.
 * Start (selected option with a bus) begins a trip: store.journey {rids, label, kind:'plan'} so the map shows only
 * that trip's routes, the plan stays drawn (also after leaving the view), and the sheet switches to Current trip
 * with the trip in progress first. Back here, a trip bar with "End trip" (journey:end, registered by the shell)
 * heads the results. Picking another option updates the journey; changing an endpoint ends it. Opened from the
 * search circle (dir:open, data-focus="to"); parent view 'nearby' (Current trip). Like Apple Maps (glass spec 2.2, 9.2):
 * the Start / Destination card is the first thing in the expanded sheet, pinned while the results scroll, Destination
 * focused; collapsing the sheet puts the keyboard away and shows the selected option on the map (the card shows
 * again when the sheet expands). Focusing a field expands the sheet.
 * Walking is always visible: card + step markup in ./tripinfo.js.
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { nowS, clock } from "../../core/time.js";
import { hav } from "../../core/geo.js";
import { staleLevel, staleNote, liveUnknown } from "../../core/arrivals.js";
import { silentService, scheduledRoutes, silentText } from "../../core/operating.js";
import { effectiveHidden } from "../../core/visibility.js";
import { plan, refineWalking, PLANNER } from "../../core/planner.js";
import { rankOptions, criteriaLine, walkFirst, uniqueOptions, WALK_CAPTION } from "../../core/rank.js";
import { walkRoute } from "../../core/walk.js";
import { createThrottle } from "../../core/throttle.js";
import { predict } from "../../core/predict.js";
import { routeChip, emptyState, skeleton, OFFICIAL_PHONE } from "../components.js";
import { matchStations, ICONS } from "./pick.js";
import { noBusHelpHTML } from "./alerts.js";   // the operator's own words + who to call when no bus reports (rider safety)
import { createPlaceSearch, assumeNoteHTML, setHTMLKeepFocus, focusNote } from "./placesearch.js";
import { covered, COVER_TEXT, COVER_ADVICE } from "../../core/coverage.js";
import { planJourney, sameRids, isPlanJourney, tripBarHTML } from "./journey.js";
import { notificationSupport, requestPermission } from "../notifier.js";
import { DEMO } from "../../core/demo.js";
import { bus } from "../../core/events.js";
import { WALK_IC, tag, mins, walkMins, walkTotal, optionLines, stepsHTML as stepsFor } from "./tripinfo.js";
import { svg } from "../icons.js";

/** The required estimate note under the options. */
export const NOTE = "Bus times are estimates from schedules and live predictions. They will get more accurate as we collect more ride data.";
/** Under the options when a live re-plan dropped the selected one (spec 13.8, O8). */
export const OPTS_CHANGED = "Options updated with live times.";
const SWAP_IC = svg("arrow-up-down", 20);
const CLEAR_IC = svg("circle-x-fill", 17);
const CHEV_IC = svg("chevron-right", 11, { stroke: 2.5 });

/** View-local state. Endpoints are {lat, lon, label, stop?, me?}. */
export const D = { from: null, to: null, fromText: "", toText: "", active: null, sugs: [], result: null, sel: 0, selKey: null, refining: false, meDenied: false, token: 0, missed: false, focusTo: false, optsChanged: false };
/** Minimum seconds between background re-plans on live updates (iOS AppModel.dirRefreshS). */
export const DIR_REFRESH_S = 8;
/** Injectable dependencies (tests replace them; wallMs / later = the re-plan throttle's clock and timer). */
export const deps = { plan, refineWalking, walkRoute, predict, wallMs: () => Date.now(), later: (f, ms) => setTimeout(f, ms) };
let rootRef = null, ctxRef = null, offStore = null, lastUser = null, offPlanWatch = null, offInset = null, lastRest = null;
const photon = createPlaceSearch(() => patchSug());
/** Background re-plan on live updates: .poke() per change, at most every DIR_REFRESH_S (gate: nothing open / failing feed = skip, a new plan still refining = defer). */
export const liveReplan = createThrottle(() => replan(), { everyMs: DIR_REFRESH_S * 1000, now: () => deps.wallMs(), later: (f, ms) => deps.later(f, ms),
  gate: () => (!rootRef || !D.from || !D.to || !D.result || cur().failed ? "skip" : D.refining ? "defer" : "go") });

const cur = () => ctxRef?.store?.get?.() || {};
const nowFn = () => (ctxRef?.now ? ctxRef.now() : nowS());
const me = (u) => ({ lat: u.lat, lon: u.lon, label: "My location", me: true });

/**
 * Endpoint for a stop id.
 * @param {object} state
 * @param {string} id
 * @returns {{lat:number,lon:number,label:string,stop:string}|null}
 */
export function stopEndpoint(state, id) {
  const s = state.stops?.[id];
  return s ? { lat: s.lat, lon: s.lon, label: s.name, stop: id } : null;
}
/** Lowercase words without accents or punctuation ("Ellis & 53rd St." -> ["ellis", "53rd", "st"]). */
const wordsOf = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['\u2019.]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Suggestions for a field's text: My location, matching stations, places (on-device results from the first
 * keystroke, Photon merged in when it answers). When the place search assumed a spelling correction, stations
 * are matched with the corrected text too.
 * @param {object} state
 * @param {string} text
 * @returns {object[]}
 */
export function computeSugs(state, text) {
  const q = String(text || "").trim(), out = [], ps = photon.state, mine = q.length >= 2 && ps.q === q;
  if (!q || "my location".startsWith(q.toLowerCase())) out.push({ kind: "me", label: "My location", sub: state.user ? "Use current location" : "Allow location access" });
  // Order: stops whose name has the whole typed word(s), then strong nearby places (local index, whole-word
  // name match), then stops that only partly match ("medici" in "Medicine"), then other places.
  const qw = wordsOf(q);
  let found = q ? matchStations(state, q, 5) : [];
  if (!found.length && mine && ps.assumed) found = matchStations(state, ps.assumed.to, 5);
  const stops = found.map((s) => ({ kind: "stop", id: s.id, lat: s.lat, lon: s.lon, label: s.name,
    sub: "Shuttle stop · " + (state.stopRoutes?.[s.id] || []).map((r) => state.routes?.[r]?.short || state.routes?.[r]?.long || r).join(", "),
    whole: qw.every((w) => wordsOf(s.name).includes(w)) }));
  const places = mine ? ps.items.map((p) => ({ kind: "place", lat: p.lat, lon: p.lon, label: p.label, sub: p.sub || "Place", strong: !!p.local && p.score >= 85 })) : [];
  out.push(...stops.filter((s) => s.whole), ...places.filter((p) => p.strong), ...stops.filter((s) => !s.whole), ...places.filter((p) => !p.strong));
  return out;
}

function sugHTML() {
  const key = D.active;
  if (!key) return "";
  const text = key === "from" ? D.fromText : D.toText, q = text.trim(), ps = photon.state, mine = q.length >= 2 && ps.q === q;
  let h = mine ? assumeNoteHTML(ps, "dir:exact") : "";
  if (D.sugs.length) h += `<div class="v-card v-sugs" role="listbox" aria-label="Suggestions for ${key === "from" ? "start" : "destination"}">` + D.sugs.map((s, i) => `<button type="button" class="v-row" role="option" data-action="dir:sug" data-i="${i}"><span class="v-ic" aria-hidden="true">${s.kind === "me" ? ICONS.loc : s.kind === "stop" ? ICONS.stop : ICONS.place}</span><span class="v-grow"><span class="v-prim">${esc(s.label)}</span><span class="v-sec">${esc(s.sub || "")}</span></span></button>`).join("") + "</div>";
  if (mine && ps.status === "busy") h += D.sugs.some((s) => s.kind === "place") ? '<p class="v-fine v-more" role="status">Searching more places&hellip;</p>' : '<p class="v-hint" role="status">Searching places&hellip;</p>';
  if (mine && ps.status === "err") h += '<p class="v-hint">Couldn&rsquo;t search places right now. Station names still work.</p>';
  // nothing at all once every search has answered (spec J2): the empty state in a card, in the words the place picker
  // and the iPhone app use; before, the list simply stayed blank
  else if (mine && !ps.status && !D.sugs.length && q.length >= 3) h += `<div class="v-card">${emptyState("No places found", "Check the spelling or try a nearby landmark.", { icon: "search" })}</div>`;
  if (D.meDenied) h += '<p class="v-hint">Location is off. Allow it in your browser settings, or type a start.</p>';
  if (q.length >= 2) h += '<p class="v-fine">Places near campus are searched on your device; otherwise only the text you type (or its spelling fix) is sent to photon.komoot.io.</p>';
  return h;
}

/**
 * Step list for an option (walk to the first stop and to the destination always shown; see ./tripinfo.js).
 * @param {object} o Option
 * @param {number} now
 * @param {object} state
 * @returns {string}
 */
export function stepsHTML(o, now, state) {
  return stepsFor(o, now, state, { fromLabel: D.from?.label, toLabel: D.to?.label });
}

/** The leg strip (spec 10.15 line 3): walk icon + minutes, a chevron, the route badge (20), ... */
function legStrip(o, state) {
  return o.legs.map((l) => (l.type === "walk" ? `<span class="v-wk">${WALK_IC}${esc(walkMins(l.min))}</span>` : routeChip(l.rid, state.routes, { small: true })))
    .join(`<span class="v-arr" aria-hidden="true">${CHEV_IC}</span>`);
}

/** Minutes in words for screen readers: "under 1 minute", "1 minute", "7 minutes" (n as walkMins / totalMin give it). */
const minutesWords = (n) => (String(n) === "<1" ? "under 1 minute" : String(n) === "1" ? "1 minute" : `${n} minutes`);

function optionHTML(o, i, now, state) {
  const on = i === D.sel;
  const lines = optionLines(o, now, staleLevel(state, now), state), wt = walkTotal(o);
  // what this option minimizes (core/rank.js), only when there is something to compare against; the least walking the long
  // way around also says that walking the whole way is faster (criteriaLine, owner 2026-11-06)
  const wo = D.result?.walkOnly?.min, walkArrive = wo > 0 ? (typeof o.t0 === "number" ? o.t0 : now) + wo * 60 : 0;
  const crit = (D.result?.options?.length || 0) > 1 ? criteriaLine(o, walkArrive) : "";
  const critHTML = crit ? `<span class="j-crit">${esc(crit)}</span>` : "";
  const routesTxt = o.legs.filter((l) => l.type === "bus").map((l) => state.routes?.[l.rid]?.short || l.rid).join(" then ");
  const aria = `Option ${i + 1}${crit ? " (" + crit + ")" : ""}: about ${minutesWords(o.totalMin)} including ${wt > 0 ? minutesWords(walkMins(wt)) + " walking" : "no walking"}, arrive ${clock(o.arrive)}${routesTxt ? ", take " + routesTxt : ""}. ${lines.text} Estimate.`.replace(/<1 min/g, "under 1 min");
  const start = on && !isPlanJourney(state) && planJourney(o) ? '<button type="button" class="v-btn v-btn--primary v-btn--block j-start" data-action="dir:start">Start</button><p class="v-fine j-starthint">Shows only this trip&rsquo;s routes on the map. Follow the bus stop by stop in Current trip.</p>' : "";
  // the total and its "est." stay together (no "~" in front of an est. number: spec O4); the arrival clock on the right
  return `<div class="v-opt${on ? " is-on" : ""}"><button type="button" class="v-optmain" data-action="dir:opt" data-i="${i}" aria-pressed="${on}" aria-label="${esc(aria)}">${critHTML}<span class="v-otop"><span class="v-otot">${o.totalMin}<small> min</small>${tag("est.")}</span><span class="v-oarr">Arrive ${esc(clock(o.arrive))}</span></span><span class="v-osum">${legStrip(o, state)}</span>${lines.html}</button>${on ? stepsHTML(o, now, state) + start : ""}</div>`;
}

/**
 * The walk option (core/rank.js walkFirst, owner 2026-10-30: very close = walk first; spec 10.15): the walk icon in a
 * tinted circle, the walking time, the arrival, the distance, and when selected the step and Start (a trip with no bus).
 * Its line on top: "Close enough to walk" (10 min or less) or "Faster to walk" (WALK_CAPTION; second under a bus option
 * that walks much less, the long way around, owner 2026-11-06).
 */
function walkOptionHTML(o, i, now, state) {
  const on = i === D.sel, l = o.legs[0] || {}, cap = WALK_CAPTION[o.why] || WALK_CAPTION.close;
  const aria = `Option ${i + 1}: walk the whole way, ${minutesWords(walkMins(o.walkMin))}, ${Math.round(o.walkM || 0)} meters, arrive ${clock(o.arrive)}. ${cap}.`;
  const start = on && !isPlanJourney(state) && planJourney(o) ? '<button type="button" class="v-btn v-btn--primary v-btn--block j-start" data-action="dir:start">Start</button><p class="v-fine j-starthint">Follow your walk in Current trip.</p>' : "";
  return `<div class="v-opt v-opt--walk${on ? " is-on" : ""}"><button type="button" class="v-optmain" data-action="dir:opt" data-i="${i}" aria-pressed="${on}" aria-label="${esc(aria)}">`
    + `<span class="j-crit">${esc(cap)}</span><span class="v-otop"><span class="j-walkic" aria-hidden="true">${svg("walk", 20)}</span><span class="v-otot">${esc(walkMins(o.walkMin))}<small> min walk</small></span><span class="v-oarr">Arrive ${esc(clock(o.arrive))}</span></span>`
    + `<span class="v-sec j-oline">${esc(walkDetail(o.walkM, l.source))}</span></button>${on ? stepsHTML(o, now, state) + start : ""}</div>`;
}

/** "605 m on sidewalks" (a routed walk) or "605 m, walking estimate" (straight line); the iPhone app's WalkOptionCard. */
const walkDetail = (m, source) => `${Math.round(m || 0)} m${source === "router" ? " on sidewalks" : ", walking estimate"}`;

/**
 * The destination's place details (spec 10.14, "Destination"): a compact card above the options, so the place details
 * step costs no extra tap: the pin in a tinted circle, the name (2 lines at most), what it is and its address, the walk
 * from the stop where the selected option gets off. A destination outside the shuttle area carries the coverage note
 * (owner's wording) inside it.
 * @param {object} state
 * @returns {string}
 */
export function placeCardHTML(state) {
  if (!D.to) return "";
  const cov = state.staticLoaded && !covered(state, D.to);
  const o = D.result?.options?.[D.sel];
  const legs = (o && !o.walkOnly && o.legs) || [], last = legs[legs.length - 1], lastBus = [...legs].reverse().find((l) => l.type === "bus");
  const sub = D.to.sub || (D.to.stop ? "Shuttle stop" : D.to.me ? "Your location" : "");
  // the walk from the stop where the selected option gets off, unless the place's own line already names a walk
  const walk = last && last.type === "walk" && lastBus && !/min walk/.test(sub) ? `${walkMins(last.min)} min walk to ${lastBus.alight?.name || "the stop"}` : "";
  return `<section class="j-place" aria-label="${esc("Destination: " + D.to.label)}"><span class="j-placeic" aria-hidden="true">${svg(D.to.stop ? "bus-front" : "map-pin", 17)}</span>`
    + `<span class="v-grow"><span class="j-placename">${esc(D.to.label)}</span>${sub ? `<span class="v-sec">${esc(sub)}</span>` : ""}${walk ? `<span class="v-sec">${esc(walk)}</span>` : ""}`
    + (cov ? coverNoteHTML() : "") + "</span></section>";
}

/**
 * Results region (hint, loading, options, walk-only, no service). A destination outside the shuttle area
 * (core/coverage.js) gets the coverage note first, then the trip options as usual.
 * @param {object} state
 * @param {number} [now]
 * @returns {string}
 */
export function resHTML(state, now = nowS()) {
  const cov = placeCardHTML(state);   // the destination's place details, with the coverage note when it is far (set any way: search, Swap, My location)
  if (!D.from || !D.to) {   // one "use my location" action per screen (DESIGN-AUDIT 7.1): the button hides while the start's list offers it
    let h = cov + '<p class="v-hint">Choose a start and a destination. Type a station name, a place, or an address.</p>';
    if (!D.from && !state.user && !(D.active === "from" && D.sugs.some((s) => s.kind === "me"))) h +='<button type="button" class="v-btn v-btn--secondary v-btn--block" data-action="dir:me" data-key="from">Start from my location</button>';
    return h;
  }
  if (!state.staticLoaded || !D.result) return cov + skeleton(2);
  const r = D.result, w = r.walkOnly || { m: 0, min: 0 }, level = staleLevel(state, now);
  let h = tripBarHTML(state) + (level ? `<p class="v-stale" role="status">${esc(staleNote(level, "Bus times may be off."))}</p>` : "") + cov;
  if (!r.options.length) {
    const running = (state.buses || []).length > 0;
    h += liveUnknown(state, now) ? emptyState("Can't plan shuttle trips right now", "The live shuttle feed can't be reached, so we can't tell which buses are running.", { icon: "wifi-off" })   // feed outage != no service
      : emptyState("No practical shuttle route right now", D.missed ? "The next buses leave before you could reach the stop." : running ? "Nothing runs close enough to both places."
        : silentService(state, now) ? silentText(state, scheduledRoutes(state, now, { hidden: effectiveHidden(state) }), now, OFFICIAL_PHONE) : "No shuttles are running right now.", { icon: "route" });   // empty feed, routes scheduled
    h += `<div class="v-opt v-opt--walk is-on"><div class="v-optmain"><span class="v-otop"><span class="j-walkic" aria-hidden="true">${svg("walk", 20)}</span><span class="v-otot">${mins(w.min)}<small> min walk</small></span><span class="v-oarr">Arrive ${esc(clock(now + (w.min || 0) * 60))}</span></span><span class="v-sec j-oline">${esc(walkDetail(w.m, w.source))}</span></div></div>`;
    return h + (running ? "" : noBusHelpHTML(state, now));
  }
  h += r.options.slice(0, PLANNER.MAX_OPTS).map((o, i) => (o.walkOnly ? walkOptionHTML(o, i, now, state) : optionHTML(o, i, now, state))).join("");
  if (D.optsChanged) h += `<p class="v-foot" role="status">${esc(OPTS_CHANGED)}</p>`;   // the selected option went away in a live re-plan (spec 13.8)
  if (!r.options.some((o) => o.walkOnly)) h += `<p class="v-foot">Walking the whole way: ${mins(w.min)} min (${Math.round(w.m || 0)} m), ${w.source === "router" ? "sidewalk route" : "estimate"}</p>`;
  if (D.refining) h += '<p class="v-foot" role="status">Checking sidewalk routes&hellip;</p>';
  return h + `<p class="v-foot v-estnote">${esc(NOTE)}</p>`;
}

/** The destination is outside the shuttle area (core/coverage.js, owner's wording): the note, then the options. */
const coverNoteHTML = () => `<div class="v-cover" role="status">${svg("triangle-alert-fill", 17)}<span class="v-grow"><b>${esc(COVER_TEXT)}</b><span>${esc(COVER_ADVICE)}</span></span></div>`;

function field(key) {
  const ep = D[key], val = ep ? ep.label : key === "from" ? D.fromText : D.toText;
  const lab = key === "from" ? "Start" : "Destination";
  return `<div class="v-dfield"><span class="v-pin v-pin--${key === "from" ? "a" : "b"}" aria-hidden="true"></span><input type="text" data-input="dir-${key}" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${lab}" aria-label="${lab}: station or place" value="${esc(val)}">`
    + `<button type="button" class="v-dclear" data-action="dir:clear" data-key="${key}" aria-label="Clear ${lab.toLowerCase()}">${CLEAR_IC}</button></div>`;
}

/**
 * Render the directions view.
 * @param {object} state
 * @param {number} [now]
 * @returns {string}
 */
export function renderDirections(state, now = nowS()) {
  return `<div class="v-dir">${dirboxHTML()}<div data-region="dir-sug">${sugHTML()}</div><div data-region="dir-res">${resHTML(state, now)}</div></div>`;
}
/** The Start / Destination fields with the swap button (in the top card, or in the panel). */
function dirboxHTML() {
  return `<div class="v-dirbox">${field("from")}${field("to")}<button type="button" class="v-dswap" data-action="dir:swap" aria-label="Swap start and destination">${SWAP_IC}</button></div>`;
}

const lastHtml = {};
function patch(region, html) { const el = rootRef?.querySelector?.(`[data-region="${region}"]`); if (el && lastHtml[region] !== html) { setHTMLKeepFocus(el, html); lastHtml[region] = html; } }
function patchSug() { if (D.active) { D.sugs = computeSugs(cur(), D.active === "from" ? D.fromText : D.toText); if (D.active === "to" && !D.from && !cur().user) D.sugs = D.sugs.filter((s) => s.kind !== "me"); } patch("dir-sug", sugHTML()); }   // no start yet: the results' "Start from my location" is the one location action
function patchRes() { patch("dir-res", resHTML(cur(), nowFn())); try { bus.emit("sheet:header", {}); } catch (e) { /* header optional */ } }
function setInput(key) { const el = fq(`[data-input="dir-${key}"]`); if (el) el.value = D[key]?.label || (key === "from" ? D.fromText : D.toText); }

/** Draw the selected option (or the walk-only line) on the map; optionally fit to it. */
export function drawSel(fit) {
  const map = ctxRef?.map, s = cur();
  if (!map?.drawPlan) return;
  const r = D.result;
  let o = r?.options?.[D.sel] || null;
  if (!o && r && D.from && D.to) o = { key: "walk", total: r.walkOnly?.min || 0, totalMin: mins(r.walkOnly?.min), arrive: 0, legs: [{ type: "walk", from: D.from, to: D.to, m: r.walkOnly?.m || 0, min: r.walkOnly?.min || 0, coords: r.walkOnly?.coords, source: r.walkOnly?.source }] };
  try {
    map.drawPlan(o, { routes: s.routes, shapes: s.shapes, routeStops: s.routeStops });
    if (fit && o && map.fitTo) {
      const pts = [[D.from.lat, D.from.lon], [D.to.lat, D.to.lon]];
      for (const l of o.legs) if (l.type === "bus") pts.push([l.board.lat, l.board.lon], [l.alight.lat, l.alight.lon]);
      map.fitTo(pts, { maxZoom: 17 });
    }
  } catch (e) { /* map optional */ }
}

function pickSel(fresh) {
  const opts = D.result?.options || [];
  let k = fresh && !isPlanJourney(cur()) ? 0 : opts.findIndex((x) => x.key === D.selKey);
  D.optsChanged = !fresh && k < 0 && D.selKey != null && opts.length > 0;   // a live re-plan dropped the selected option
  if (k < 0) k = 0;
  D.sel = opts.length ? k : -1; D.selKey = opts[k]?.key ?? null;
}

/**
 * Plan (sync) then refine walking legs (async). Stale async results are ignored via a token.
 * @param {{fresh?:boolean}} [opts] fresh: new endpoints (select first option, fit the map)
 * @returns {Promise<void>}
 */
export async function replan({ fresh = false } = {}) {
  const state = cur(), token = ++D.token;
  if (!D.from || !D.to || !state.staticLoaded) { D.result = null; D.refining = false; patchRes(); try { ctxRef?.map?.drawPlan?.(null); } catch (e) { /* */ } return; }
  const now = nowFn(), from = D.from, to = D.to;
  const data = { stops: state.stops, routes: state.routes, routeStops: state.routeStops, trips: state.trips || [], buses: state.buses || [], service: state.service };
  let r;
  try { r = deps.plan({ from, to, now, data, predict: deps.predict }); } catch (e) { r = null; }
  if (!r || !Array.isArray(r.options)) { const m = hav(from, to) * 1.2; r = { options: [], walkOnly: { m, min: m / 80 } }; }
  if (fresh || !D.result) { D.result = r; D.missed = false; D.refining = true; pickSel(fresh); patchRes(); drawSel(fresh); }
  const top = r.options.filter((o) => !o.walkOnly).slice(0, PLANNER.MAX_OPTS);   // the walk option is rebuilt below
  const [settled, walk] = await Promise.all([
    Promise.allSettled(top.map((o) => deps.refineWalking(o, { walkRoute: deps.walkRoute, now, data, from, to, predict: deps.predict }))),
    Promise.resolve().then(() => deps.walkRoute(from, to)).catch(() => null),
  ]);
  if (token !== D.token) return;
  const opts = settled.map((s, i) => (s.status === "fulfilled" ? s.value : top[i])).filter((o) => o && Array.isArray(o.legs));
  const walkOnly = walk ? { m: walk.m, min: walk.min, coords: walk.coords, source: walk.source } : r.walkOnly;
  // sidewalk times can change who walks least; very close = walk first (core/rank.js walkFirst, owner 2026-10-30)
  const ranked = walkFirst(rankOptions(uniqueOptions(opts)), walkOnly, { from, to, t0: now, max: PLANNER.MAX_OPTS });   // two options can land on the same bus
  D.missed = top.length > 0 && !ranked.length;
  D.result = { ...r, options: ranked, walkOnly };
  D.refining = false; pickSel(fresh); syncJourney(); patchRes(); drawSel(fresh);
}

/**
 * Start a trip with the selected option: only its routes stay on the map, and the sheet switches to Current trip
 * (half detent), where the trip in progress leads (owner, 2026-10-12; iOS AppModel.startTrip sets tab = .current).
 * The plan stays drawn: unmountDirections keeps it while the trip is on. Focus goes to the trip's title.
 * @returns {boolean}
 */
export function startTrip() {
  const j = planJourney(D.result?.options?.[D.sel], D.to?.label);
  if (!j || !ctxRef?.store) return false;
  ctxRef.store.set({ journey: j });
  // trip alerts (2026-10-13): Start is when to ask (conversion to appstore.md section 7), only if never answered,
  // straight from the tap (browsers ask only for a user gesture); without it alerts are an in-app banner
  if (!DEMO && j.rids.length && ctxRef.store.get().notify?.trip !== false && notificationSupport() === "default") requestPermission().catch(() => {});   // a walk has no bus to alert about
  drawSel(true);
  let moved = false;
  try { moved = ctxRef.navigate?.("nearby", { detent: "full" }) === true; } catch (e) { moved = false; }
  if (moved) {
    // the view renders after the store flush (main.js scheduleRender): focus its trip title once it is there
    setTimeout(() => { if (isPlanJourney(cur())) document.querySelector?.(".tp-title")?.focus({ preventScroll: true }); }, 0);
    return true;
  }
  try { ctxRef.setDetent?.("half"); } catch (e) { /* sheet optional */ }
  patchRes();
  const t = rootRef?.querySelector?.(".j-title");
  if (t) { t.focus({ preventScroll: true }); t.scrollIntoView?.({ block: "nearest" }); }
  return true;
}

/** Bus legs of a journey as "rid:board>alight" (what the Current trip timeline follows). */
const legSig = (j) => ((j && j.legs) || []).filter((l) => l.type === "bus").map((l) => `${l.rid}:${l.board?.id}>${l.alight?.id}`).join("|");

/**
 * While a trip is on, keep journey.rids equal to the selected option's routes. A card the user picks
 * (picked=true) also replaces the stops and bus to follow, even on the same route; a live re-plan never
 * moves the boarding stop of a started trip.
 */
function syncJourney(picked = false) {
  const s = cur();
  if (!isPlanJourney(s) || !rootRef) return;
  const j = planJourney(D.result?.options?.[D.sel], D.to?.label);
  if (j && (!sameRids(j.rids, s.journey.rids) || j.label !== s.journey.label || (picked && legSig(j) !== legSig(s.journey)))) ctxRef.store.set({ journey: j });
}

/** New endpoints mean a new trip: end a started one. */
function endPlanJourney() {
  if (isPlanJourney(cur())) ctxRef.store.set({ journey: null });
}

function focusField(key) { fq(`[data-input="dir-${key}"]`)?.focus({ preventScroll: true }); }
function afterSet() {
  D.active = null; D.sugs = []; patch("dir-sug", "");
  replan({ fresh: true });
  const a = document.activeElement, lost = !a || a === document.body;   // a keyboard pick removed the focused suggestion
  if (!D.to) focusField("to"); else if (!D.from) focusField("from");
  else if (lost) rootRef?.querySelector?.('[data-region="dir-res"] .v-opt.is-on .v-optmain, [data-region="dir-res"] .v-optmain')?.focus({ preventScroll: true });
  else if (inFields(a)) a.blur?.();   // a tap while typing: drop the keyboard
}

/** Set an endpoint ('from'|'to') and re-plan. */
export function setEndpoint(key, ep) {
  endPlanJourney();
  D[key] = ep; if (ep) D[key + "Text"] = ep.label;
  setInput(key); afterSet();
}

/** Use the current location for a field (asks permission if needed). */
export async function useMyLocation(key) {
  let u = cur().user;
  if (!u && ctxRef?.locate) { let ok = false; try { ok = await ctxRef.locate(); } catch (e) { ok = false; } u = ok ? cur().user : null; }
  if (u) { D.meDenied = false; setEndpoint(key, me(u)); } else { D.meDenied = true; D.active = key; patchSug(); }
}

/** Apply suggestion i to the active field. */
export function applySug(i) {
  const s = D.sugs[i], key = D.active || (D.from ? "to" : "from");
  if (!s) return false;
  if (s.kind === "me") { useMyLocation(key); return true; }
  setEndpoint(key, { lat: s.lat, lon: s.lon, label: s.label, stop: s.kind === "stop" ? s.id : null, sub: s.kind === "stop" ? "Shuttle stop" : s.sub || "" });
  return true;
}

/** Swap start and destination. */
export function swap() {
  endPlanJourney();
  [D.from, D.to] = [D.to, D.from]; [D.fromText, D.toText] = [D.toText, D.fromText];
  setInput("from"); setInput("to"); D.active = null; D.sugs = []; patch("dir-sug", ""); replan({ fresh: true });
}

const keyOf = (t) => (t?.matches?.('[data-input="dir-from"]') ? "from" : t?.matches?.('[data-input="dir-to"]') ? "to" : null);
function onFocus(e) {
  const k = keyOf(e.target); if (!k) return;
  D.active = k; e.target.select?.(); patchSug(); patchRes();
  try { ctxRef?.setDetent?.("full"); } catch (err) { /* sheet optional */ }   // typing: the suggestions need the sheet up
}
function onInput(e) {
  const k = keyOf(e.target); if (!k) return;
  endPlanJourney();
  D.active = k; D[k] = null; D[k + "Text"] = e.target.value; D.result = null; D.token++; D.meDenied = false;
  photon.query(e.target.value); patchSug(); patchRes();
  try { ctxRef?.map?.drawPlan?.(null); } catch (err) { /* */ }
}
function onKey(e) {
  const k = keyOf(e.target); if (!k) return;
  if (e.key === "Enter") { e.preventDefault(); if (D.sugs.length) applySug(0); }
  else if (e.key === "Escape" && D.active) { e.preventDefault(); e.stopPropagation(); D.active = null; D.sugs = []; patch("dir-sug", ""); patchRes(); }
  else if (e.key === "ArrowDown") { const b = rootRef?.querySelector?.('[data-action="dir:sug"]'); if (b) { e.preventDefault(); b.focus(); } }
}

/** Mount: default start = My location (if available), listeners, live re-plan subscription. */
export function mountDirections(root, ctx) {
  unmountDirections();
  offPlanWatch?.(); offPlanWatch = null;
  rootRef = root; ctxRef = ctx; lastHtml["dir-sug"] = lastHtml["dir-res"] = undefined; liveReplan.reset();
  const state = cur();
  if (!D.from && !D.fromText && state.user) { D.from = me(state.user); setInput("from"); }
  lastUser = state.user;
  root.addEventListener("focusin", onFocus);
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKey);
  lastRest = "full";   // Directions opens expanded (detent: "full" below)
  offInset = bus.on("sheet:inset", onSheetRest);
  offStore = ctx?.store?.subscribe?.((s, ch) => {
    if (ch.has("user") && s.user && D.from?.me && (!lastUser || hav(lastUser, s.user) > 50)) { D.from = me(s.user); lastUser = s.user; replan(); return; }
    if (ch.has("staticLoaded")) { replan({ fresh: true }); return; }
    if (ch.has("journey")) patchRes();
    if ((ch.has("trips") || ch.has("buses")) && D.from && D.to) liveReplan.poke();
    else if (ch.has("lastOk") || ch.has("failed") || ch.has("user")) patchRes();
  }) || null;
  if (!D.from && !state.user && state.locState !== "denied" && typeof navigator !== "undefined" && navigator.permissions?.query) {
    navigator.permissions.query({ name: "geolocation" }).then((p) => { if (p.state === "granted" && rootRef && !D.from) useMyLocation("from"); }).catch(() => {});
  }
  replan({ fresh: true });
  Promise.resolve(deps.predict?.ready).then(() => { if (rootRef && D.from && D.to) replan(); }).catch(() => {});
  if (D.focusTo) { D.focusTo = false; focusField("to"); }
  else if (D.from && !D.to) focusField("to"); else if (!D.from && D.to) focusField("from");
}

/**
 * The sheet came to rest (bus 'sheet:inset' {px, detent}): on the change to collapsed, frame the selected option again
 * (spec J3, the iPhone app does the same). It was framed into the small strip of map above the expanded sheet, so after
 * a collapse the plan sat near the top, behind the field card, its destination pin under the locate button. Only on
 * that change (a taller header while collapsed never moves the map), never in the landscape panel (px 0) and never while
 * a started trip owns the map.
 * @param {{px?:number, detent?:string}} [p]
 * @returns {boolean} whether it framed the option
 */
export function onSheetRest(p) {
  const was = lastRest, d = p && p.detent;
  if (d) lastRest = d;
  if (d !== "peek" || was === "peek" || !(p && p.px > 0) || !rootRef || !D.from || !D.to || !D.result) return false;
  if (isPlanJourney(cur())) return false;
  drawSel(true);
  return true;
}

/** Unmount: clear the plan from the map (kept while a trip is on, until it ends), stop async updates (endpoints are kept). */
/** Look a selector up in the view (the Start / Destination card is part of it). */
const fq = (sel) => rootRef?.querySelector?.(sel) || null;
const inFields = (el) => !!el && !!rootRef?.contains?.(el);

export function unmountDirections() {
  if (rootRef) { rootRef.removeEventListener("focusin", onFocus); rootRef.removeEventListener("input", onInput); rootRef.removeEventListener("keydown", onKey); }
  offStore?.(); offStore = null; offInset?.(); offInset = null; photon.cancel(); liveReplan.reset(); D.token++; D.active = null; D.sugs = [];
  const st = ctxRef?.store, keep = !!st && isPlanJourney(st.get());
  if (keep && rootRef) {
    offPlanWatch?.();
    offPlanWatch = st.subscribe((s, ch) => {
      if (!ch.has("journey") || isPlanJourney(s)) return;
      offPlanWatch?.(); offPlanWatch = null;
      if (!rootRef) try { ctxRef?.map?.drawPlan?.(null); } catch (e) { /* */ }
    });
  } else if (!keep) {
    try { ctxRef?.map?.drawPlan?.(null); } catch (e) { /* */ }
  }
  rootRef = null;
}

/** Test hook: the place-search state. */
export const _photon = photon;
/**
 * The collapsed header's trailing slot in Directions (spec 10.6): the selected option's total and "est.", so the answer
 * reads with the map visible ("29 min est."). Trusted HTML.
 * @returns {string}
 */
export function metaDirectionsHTML() {
  const o = D.from && D.to ? D.result?.options?.[D.sel] : null;
  if (!o) return "";
  const m = o.walkOnly ? walkMins(o.walkMin) : String(o.totalMin);
  return `<span class="hm" role="text" aria-label="${esc(`${o.walkOnly ? "Walk" : "Trip"} about ${minutesWords(m)}, estimate`)}"><span class="eta" aria-hidden="true"><span class="num">${esc(m)}</span> <span class="unit">min</span>${tag("est.")}</span></span>`;
}

registerView("directions", {
  title: () => "Directions",
  metaHTML: () => metaDirectionsHTML(),
  parent: "nearby",
  tab: "nearby",
  detent: "full",
  render: (state) => renderDirections(state),
  mount: (root, ctx) => mountDirections(root, ctx),
  unmount: () => unmountDirections(),
  refresh: () => patchRes(),
  onStopTap: (id, ctx) => { ctxRef = ctx || ctxRef; const ep = stopEndpoint(cur(), id); if (!ep) return false; setEndpoint(D.active || (D.from ? "to" : "from"), ep); return true; },
});

/** dir:open from Plan Trip's "Where to?" (data-focus="to") focuses the destination field on mount. */
registerAction("dir:open", (ds, ev, ctx) => {
  if (ds?.focus === "to") D.focusTo = true;
  ctx.navigate("directions");
});
const endTrip = (ctx, yes) => { if (yes && isPlanJourney(ctx.store.get())) ctx.store.set({ journey: null }); };   // a stop's new endpoints end a started trip, never re-target it (iOS parity)
registerAction("dir:from-stop", (ds, ev, ctx) => { const ep = stopEndpoint(ctx.store.get(), ds.id); if (!ep) return; endTrip(ctx, true); D.from = ep; D.to = null; D.toText = ""; D.result = null; ctx.navigate("directions"); });
registerAction("dir:to-stop", (ds, ev, ctx) => {
  const s = ctx.store.get(), ep = stopEndpoint(s, ds.id); if (!ep) return;
  endTrip(ctx, D.to?.stop !== ep.stop); D.to = ep; if (!D.from || D.from.stop === ds.id) { D.from = s.user ? me(s.user) : null; D.fromText = ""; }
  D.result = null; ctx.navigate("directions");
});
registerAction("dir:sug", (ds, ev, ctx) => { ctxRef = ctx || ctxRef; applySug(+ds.i); });
registerAction("dir:exact", (ds, ev, ctx) => { ctxRef = ctx || ctxRef; photon.exact(ds.exact !== "0"); patchSug(); focusNote(rootRef?.querySelector?.('[data-region="dir-sug"]')); });
registerAction("dir:swap", (ds, ev, ctx) => { ctxRef = ctx || ctxRef; swap(); });
registerAction("dir:me", (ds, ev, ctx) => { ctxRef = ctx || ctxRef; useMyLocation(ds.key === "to" ? "to" : "from"); });
registerAction("dir:opt", (ds, ev, ctx) => {
  ctxRef = ctx || ctxRef; const o = D.result?.options?.[+ds.i]; if (!o) return;
  D.sel = +ds.i; D.selKey = o.key; D.optsChanged = false; syncJourney(true); patchRes(); drawSel(true);
});
/** The clear button in a focused field (spec 10.2): empties it like deleting the text, and keeps it focused. */
registerAction("dir:clear", (ds, ev, ctx) => {
  ctxRef = ctx || ctxRef;
  const el = fq(`[data-input="dir-${ds.key === "from" ? "from" : "to"}"]`);
  if (!el) return;
  el.value = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus({ preventScroll: true });
});
registerAction("dir:start", (ds, ev, ctx) => { ctxRef = ctx || ctxRef; startTrip(); });

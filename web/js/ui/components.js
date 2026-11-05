/**
 * @module ui/components
 * Pure HTML-string builders shared by every view. Every dynamic value is escaped with esc();
 * colors go through safeColor(). No DOM access, so these are unit-tested as plain functions.
 *
 * Class names used here are styled in css/components.css (D1). Interactive builders emit
 * `data-action` + `data-id` so ui/actions.js event delegation can route taps.
 */
import { esc, safeColor, textOn, contrast } from "../core/esc.js";
import { minsUntil, nowS, clock } from "../core/time.js";
import { svg } from "./icons.js";
import { staleLevel } from "../core/arrivals.js";

/** Official service phone (display form). */
export const OFFICIAL_PHONE = "773.702.8181";
/** Official phone as a tel: URI. */
export const OFFICIAL_TEL = "tel:+17737028181";
/** Official transportation page. */
export const OFFICIAL_URL = "https://safety-security.uchicago.edu/Transportation";

const SOURCE_LABEL = { live: "live", schedule: "schedule", learned: "learned", estimate: "estimate" };
const SOURCE_DESC = {
  live: "From a live bus prediction",
  schedule: "Estimated from the schedule",
  learned: "Learned from past rides",
  estimate: "Rough distance-based estimate",
};

/** Old icon names (views, tests) mapped onto the one set in ./icons.js. */
const ICON_ALIAS = {
  back: "chevron-left", chevron: "chevron-right", close: "x", locate: "navigation", eye: "eye", eyeOff: "eye-off",
  alert: "triangle-alert", info: "info", swap: "arrow-up-down", walk: "walk", bus: "bus-front", search: "search",
  retry: "rotate-cw", clock: "clock",
};

/**
 * Inline SVG icon (decorative, aria-hidden). Unknown names return ''. Old names (back, chevron, locate...) and every
 * ./icons.js name are accepted.
 * @param {string} name
 * @param {number} [size=20]
 * @returns {string}
 */
export function icon(name, size = 20) {
  return svg(ICON_ALIAS[name] || name, size);
}

/**
 * Display name of a route (short name, else long name, else '?').
 * @param {string} rid
 * @param {Object} routes store.routes
 * @returns {string} plain text (not escaped)
 */
export function routeName(rid, routes) {
  const r = (routes && routes[rid]) || {};
  return String(r.short || r.long || "?");
}

/**
 * The text on a route badge (iOS Route.chipText, docs/DESIGN-SPEC.md 10.9): the published short name, else the first
 * letter of the long name ("E" for East), else '?'. Never truncated.
 * @param {string} rid
 * @param {Object} routes store.routes
 * @returns {string} plain text (not escaped)
 */
export function chipText(rid, routes) {
  const r = (routes && routes[rid]) || {};
  const s = String(r.short || "").trim();
  if (s) return s;
  const l = String(r.long || "").trim();
  return l ? l.charAt(0).toUpperCase() : "?";
}

/**
 * Format minutes for display: '<1' under one minute, else a rounded integer string.
 * @param {number} min
 * @returns {string}
 */
export function fmtMin(min) {
  if (typeof min !== "number" || !isFinite(min)) return "?";
  return min < 1 ? "<1" : String(Math.round(min));
}

/**
 * Format a distance in meters: '80 m' (rounded to 10 m) or '1.2 km'.
 * @param {number} m
 * @returns {string}
 */
export function fmtDist(m) {
  if (typeof m !== "number" || !isFinite(m)) return "";
  return m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + " m" : (m / 1000).toFixed(1) + " km";
}

/**
 * Route color badge (spec 10.9): the badge text (chipText) in whichever of near-black / white reads better on the route
 * color; a color under 3:1 against the card gets a ring (class lt for light mode, dk for dark mode; CSS decides which
 * applies); names over 5 characters get the smaller size (class long). The full route name stays the badge's label.
 * @param {string} rid
 * @param {Object} routes store.routes
 * @param {{small?:boolean}} [opts]
 * @returns {string}
 */
export function routeChip(rid, routes, opts = {}) {
  const r = (routes && routes[rid]) || {};
  const c = safeColor(r.color), name = chipText(rid, routes);
  const cls = "chip" + ringClass(c) + (opts.small ? " sm" : "") + (name.length > 5 ? " long" : "");
  return `<span class="${cls}" style="background:${c};color:${textOn(c)}">${esc(name)}</span>`;
}

/** The card surfaces a badge sits on (tokens.css --bg-card, light / dark). */
export const BADGE_SURFACE = Object.freeze({ light: "#FCFCFD", dark: "#2C2C2E" });
/**
 * Ring classes for a route color (spec 4.3): " lt" when under 3:1 against the light card (ring shows in light mode),
 * " dk" when under 3:1 against the dark card (ring shows in dark mode). Same shape either way.
 * @param {string} color '#RRGGBB'
 * @returns {string}
 */
export function ringClass(color) {
  return (contrast(color, BADGE_SURFACE.light) < 3 ? " lt" : "") + (contrast(color, BADGE_SURFACE.dark) < 3 ? " dk" : "");
}

/**
 * Big ETA numeral with unit. Under one minute shows 'Now' (live color unless stale).
 * When stale, the numeral gets a '~' and the muted color.
 * @param {number} unixS arrival time
 * @param {{stale?:boolean, now?:number}} [opts]
 * @returns {string}
 */
export function etaBlock(unixS, opts = {}) {
  const stale = !!opts.stale;
  const n = typeof opts.now === "number" ? opts.now : nowS();
  const t = typeof unixS === "number" && isFinite(unixS) ? unixS : n;
  const m = minsUntil(t, n);
  const tilde = stale ? "~" : "";
  const sc = (stale ? " stale" : "") + (opts.hero ? " hero" : "");
  if (m < 1) return `<span class="eta now${sc}"><span class="num">${tilde}Now</span></span>`;
  // an hour or more away: the clock time reads better than "73 min" (spec 10.10)
  if (m >= 60) return `<span class="eta clock${sc}"><span class="num">${tilde}${esc(clock(t))}</span></span>`;
  return `<span class="eta${sc}"><span class="num">${tilde}${m}</span> <span class="unit">min</span></span>`;
}

/**
 * Live-status label for arrivals at a given feed stale level.
 * @param {''|'late'|'old'|'err'} level
 * @returns {{html:string, text:string}}
 */
export function liveLabel(level) {
  if (!level) return { html: '<span class="dot-live" aria-hidden="true"></span><span class="src-live">Live</span>', text: "live" };
  if (level === "late") return { html: '<span class="dot-live late" aria-hidden="true"></span><span class="src-stale">Live, delayed</span>', text: "live, data delayed" };
  return { html: '<span class="dot-off" aria-hidden="true"></span><span class="src-stale">Last known</span>', text: "last known prediction, may be out of date" };
}

/**
 * The mark before a route's bus count (decorative; the words say the same): the green live dot only while the feed is
 * fresh, the amber dot while it is late, the hollow ring for a last known count (DESIGN-SPEC 10.10; iOS LiveDot(level:)).
 * @param {''|'late'|'old'|'err'} level staleLevel
 * @returns {string}
 */
export function liveDotHTML(level) {
  if (!level) return '<span class="v-livedot" aria-hidden="true"></span>';
  return level === "late" ? '<span class="dot-live late" aria-hidden="true"></span>' : '<span class="dot-off" aria-hidden="true"></span>';
}

/**
 * One arrival row: route chip, route name, live label (+ bus label), ETA.
 * Screen readers get a single sentence, e.g. "Route 6, Campus North, arrives in 4 minutes, live".
 * @param {{rid:string, t:number, bus?:string, tripId?:string}} a  from core/arrivals.arrivalsFor
 * @param {Object} state store state (routes, lastOk, failed, feedTs)
 * @param {{action?:string, now?:number, sub?:string}} [opts] action -> render as a button with data-action/data-id(rid)/data-trip
 * @returns {string}
 */
export function arrivalRow(a, state, opts = {}) {
  const n = typeof opts.now === "number" ? opts.now : nowS();
  const st = state || {};
  const level = staleLevel({ lastOk: st.lastOk || 0, failed: !!st.failed, feedTs: st.feedTs || 0 }, n);
  const r = (st.routes && st.routes[a.rid]) || {};
  const short = routeName(a.rid, st.routes);
  const long = r.long || short;
  const m = minsUntil(a.t, n);
  const lbl = liveLabel(level);
  const when = m < 1 ? "arriving now" : `arrives in ${m} minute${m === 1 ? "" : "s"}`;
  const label = `Route ${short}, ${long}, ${when}, ${lbl.text}`;
  const extra = opts.sub ? " · " + esc(opts.sub) : a.bus ? " · Bus " + esc(a.bus) : "";
  const vis = `${routeChip(a.rid, st.routes)}<span class="grow"><span class="prim">${esc(long)}</span>`
    + `<span class="sec">${lbl.html}${extra}</span></span>${etaBlock(a.t, { stale: !!level, now: n })}`;
  if (opts.action) {
    return `<button type="button" class="row arr" data-action="${esc(opts.action)}" data-id="${esc(a.rid)}" data-trip="${esc(a.tripId || "")}" aria-label="${esc(label)}">${vis}</button>`;
  }
  return `<div class="row arr" role="group" aria-label="${esc(label)}"><span class="rowvis" aria-hidden="true">${vis}</span></div>`;
}

/**
 * Stop row (tappable). Secondary line defaults to walking time + distance when stop.d is known.
 * @param {{id:string, name:string, d?:number}} stop
 * @param {{action?:string, sub?:string, right?:string, rightHtml?:string, chips?:string[], routes?:Object}} [opts]
 *   right: plain text on the right; rightHtml: trusted HTML from another builder (e.g. etaBlock);
 *   chips: route ids to show as small chips (needs routes)
 * @returns {string}
 */
export function stopRow(stop, opts = {}) {
  const s = stop || {};
  const action = opts.action || "stop";
  let sub = opts.sub;
  if (sub == null && typeof s.d === "number") sub = `${Math.max(1, Math.round(s.d / 80))} min walk · ${fmtDist(s.d)}`;
  const chips = (opts.chips || []).length
    ? `<span class="chips">${opts.chips.map((rid) => routeChip(rid, opts.routes, { small: true })).join("")}</span>` : "";
  const right = opts.rightHtml || (opts.right ? `<span class="right">${esc(opts.right)}</span>` : "");
  return `<button type="button" class="row stoprow" data-action="${esc(action)}" data-id="${esc(s.id)}">`
    + `<span class="grow"><span class="prim">${esc(s.name || s.id || "Stop")}</span>`
    + (sub ? `<span class="sec">${esc(sub)}</span>` : "") + chips + `</span>${right}</button>`;
}

/**
 * Official contact line (phone + website). Shown in About and in empty/error states.
 * @returns {string}
 */
export function officialLinks() {
  return `<span class="official">Official service: <a href="${OFFICIAL_TEL}">${OFFICIAL_PHONE}</a> · `
    + `<a href="${OFFICIAL_URL}" target="_blank" rel="noopener">official transportation page</a></span>`;
}

/**
 * Empty / error state block.
 * @param {string} title
 * @param {string} [body]
 * @param {{official?:boolean, kind?:'empty'|'error', icon?:string}} [opts] official -> append the official phone/link;
 *   icon -> a 28 px ./icons.js glyph in label3 above the title (spec 10.20)
 * @returns {string}
 */
export function emptyState(title, body, opts = {}) {
  const kind = opts.kind === "error" ? " error" : "";
  const ic = opts.icon ? `<span class="empty-ic" aria-hidden="true">${svg(opts.icon, 28)}</span>` : "";
  return `<div class="empty${kind}">${ic}<b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ""}`
    + (opts.official ? officialLinks() : "") + "</div>";
}

/** One placeholder row shaped like an arrival row: route badge, two text lines, ETA (index.html boots with the same markup). */
export const SKELETON_ROW = '<div class="skel" aria-hidden="true"><span class="skel-chip"></span><span class="skel-lines"><span></span><span></span></span><span class="skel-eta"></span></div>';

/**
 * Loading placeholder rows (no spinners), shaped like the rows that replace them.
 * @param {number} [n=3]
 * @returns {string}
 */
export function skeleton(n = 3) {
  const k = Math.max(1, Math.min(12, Math.floor(Number(n) || 3)));
  return '<div class="skels" aria-busy="true"><span class="sr">Loading</span>' + SKELETON_ROW.repeat(k) + "</div>";
}

/**
 * Small status pill. kind: live|warn|err|info|muted (anything else -> info).
 * @param {string} kind
 * @param {string} text
 * @returns {string}
 */
export function pill(kind, text) {
  const k = ["live", "warn", "err", "info", "muted"].includes(kind) ? kind : "info";
  const dot = k === "live" ? '<span class="dot-live" aria-hidden="true"></span>' : "";
  return `<span class="pill pill-${k}">${dot}${esc(text)}</span>`;
}

/**
 * Segmented control (buttons with aria-pressed). Taps route through ui/actions.js.
 * @param {Array<{id:string, label:string, on?:boolean, badge?:number|string, action?:string}>} items
 * @param {{label?:string, action?:string}} [opts] label -> aria-label of the group; action -> default data-action
 * @returns {string}
 */
export function segmented(items, opts = {}) {
  const act = opts.action || "seg";
  const btns = (items || []).map((it) => {
    const badge = it.badge ? ` <span class="badge">${esc(it.badge)}</span>` : "";
    return `<button type="button" class="${it.on ? "on" : ""}" aria-pressed="${it.on ? "true" : "false"}"`
      + ` data-action="${esc(it.action || act)}" data-id="${esc(it.id)}">${esc(it.label)}${badge}</button>`;
  }).join("");
  return `<div class="seg" role="group"${opts.label ? ` aria-label="${esc(opts.label)}"` : ""}>${btns}</div>`;
}

/**
 * Source tag for derived numbers: 'live' | 'schedule' | 'learned' | 'estimate' (anything else).
 * @param {string} source
 * @returns {string}
 */
export function estTag(source) {
  const k = Object.prototype.hasOwnProperty.call(SOURCE_LABEL, source) ? source : "estimate";
  return `<span class="est est-${k}" title="${esc(SOURCE_DESC[k])}">${SOURCE_LABEL[k]}</span>`;
}

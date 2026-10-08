/**
 * @module ui/components
 * Pure HTML-string builders shared by every view. Every dynamic value is escaped with esc();
 * colors go through safeColor(). No DOM access, so these are unit-tested as plain functions.
 *
 * Class names used here are styled in css/components.css (D1). Interactive builders emit
 * `data-action` + `data-id` so ui/actions.js event delegation can route taps.
 */
import { esc, safeColor, textOn, lum } from "../core/esc.js";
import { minsUntil, nowS } from "../core/time.js";
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

const P = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  back: '<path d="M15 4l-8 8 8 8"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  locate: '<path d="M3 11l18-8-8 18-2-8-8-2z"/>',
  eye: '<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" opacity=".45"/><circle cx="12" cy="12" r="3" opacity=".45"/><path d="M3 3l18 18"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5v.5"/>',
  swap: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="M10 21l2-6 3 3v3M8 12l2-4 4 1 2 3 3 1M10 8l-1 5"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21v-3M16 21v-3M8 14.5h.01M16 14.5h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  retry: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3 2"/>',
};

/**
 * Inline SVG icon (decorative, aria-hidden). Unknown names return ''.
 * @param {keyof ICONS|string} name back|chevron|close|locate|eye|eyeOff|alert|info|swap|walk|bus|search|retry|clock
 * @param {number} [size=20]
 * @returns {string}
 */
export function icon(name, size = 20) {
  const body = ICONS[name];
  if (!body) return "";
  const s = Math.max(8, Math.min(64, Number(size) || 20));
  return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" ${P} aria-hidden="true" focusable="false">${body}</svg>`;
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
 * Route color badge. Text color is chosen by luminance; colors with weak contrast against the
 * sheet get a ring (class lt for light-theme, dk for dark-theme; CSS decides which applies).
 * @param {string} rid
 * @param {Object} routes store.routes
 * @param {{small?:boolean}} [opts]
 * @returns {string}
 */
export function routeChip(rid, routes, opts = {}) {
  const r = (routes && routes[rid]) || {};
  const c = safeColor(r.color);
  const L = lum(c);
  const cls = "chip" + (L > 0.3 ? " lt" : "") + (L < 0.136 ? " dk" : "") + (opts.small ? " sm" : "");
  return `<span class="${cls}" style="background:${c};color:${textOn(c)}">${esc(routeName(rid, routes))}</span>`;
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
  const sc = stale ? " stale" : "";
  if (m < 1) return `<span class="eta now${sc}"><span class="num">${tilde}Now</span></span>`;
  return `<span class="eta${sc}"><span class="num">${tilde}${m}</span><span class="unit">min</span></span>`;
}

/**
 * Live-status label for arrivals at a given feed stale level.
 * @param {''|'late'|'old'|'err'} level
 * @returns {{html:string, text:string}}
 */
export function liveLabel(level) {
  if (!level) return { html: '<span class="dot-live" aria-hidden="true"></span>Live', text: "live" };
  if (level === "late") return { html: '<span class="dot-live late" aria-hidden="true"></span>Live, delayed', text: "live, data delayed" };
  return { html: '<span class="dot-off" aria-hidden="true"></span>Last known', text: "last known prediction, may be out of date" };
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
 * @param {{official?:boolean, kind?:'empty'|'error'}} [opts] official -> append the official phone/link
 * @returns {string}
 */
export function emptyState(title, body, opts = {}) {
  const kind = opts.kind === "error" ? " error" : "";
  return `<div class="empty${kind}"><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ""}`
    + (opts.official ? officialLinks() : "") + "</div>";
}

/**
 * Loading placeholder rows (no spinners).
 * @param {number} [n=3]
 * @returns {string}
 */
export function skeleton(n = 3) {
  const k = Math.max(1, Math.min(12, Math.floor(Number(n) || 3)));
  return '<div class="skels" aria-busy="true"><span class="sr">Loading</span>'
    + '<div class="skel" aria-hidden="true"></div>'.repeat(k) + "</div>";
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

/**
 * @module ui/views/alerts
 * Active service alerts (severity icon, title, body, affected route chips, time window) and the
 * link to About at the bottom. Not a tab any more: a sub view of Nearby, opened from the Nearby alert
 * banner (alertBanner below) or the "Service alerts" row in My Routes (action `alerts:open`).
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { nowS, clock, shortDate, sameDay } from "../../core/time.js";
import { activeAlerts } from "../../core/arrivals.js";
import { routeChip, emptyState, skeleton, officialLinks, OFFICIAL_PHONE, OFFICIAL_TEL, OFFICIAL_URL } from "../components.js";

const WARN = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>';
const INFO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>';

/**
 * Plain text of a GTFS-RT TranslatedString (or a bare string).
 * @param {*} v
 * @returns {string}
 */
export function alertText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  const tr = Array.isArray(v.translation) ? v.translation : [];
  const en = tr.find((t) => /^en/i.test(t?.language || "")) || tr[0];
  return String(en?.text || "").trim();
}

function windowText(a, now) {
  const p = (a.active_period || []).find((w) => (!w.start || w.start <= now) && (!w.end || w.end >= now));
  if (!p) return "";
  // Chicago days and times (core/time.js), like the route hours
  if (p.end && sameDay(p.end, now)) return "Until " + clock(p.end);
  if (p.start && sameDay(p.start, now)) return "Since " + clock(p.start);
  if (p.end) return "Until " + shortDate(p.end);
  return "";
}

/** A US phone number as alerts write it ("773-655-9934", "(773) 655-9934", "773.655.9934"); group 2 = the number. */
const PHONE_RE = /(^|[^\d])(\(?\d{3}\)?[ .-]?\d{3}[.-]\d{4})(?!\d)/g;

/**
 * Escaped alert text with its phone numbers as call links ("773-655-9934" -> tel:+17736559934), so a rider
 * can call the number an operator alert gives in one tap.
 * @param {string} text plain text
 * @returns {string} HTML
 */
export function alertBodyHTML(text) {
  return esc(text).replace(PHONE_RE, (m, pre, num) => `${pre}<a href="tel:+1${num.replace(/\D/g, "")}">${num}</a>`);
}

/** Active alerts for the no-bus screens (route detail: only the ones not tied to a route; it lists its own). */
function operatorAlerts(state, now, rid) {
  const act = activeAlerts(state, now);
  return rid ? act.filter((a) => !(a.informed_entity || []).some((e) => e && e.route_id)) : act;
}

/**
 * The operator's phone number from the live feed (owner decision 2026-10-11): the first number in the active alerts
 * (title, then description, in feed order), exactly as written, never our own 773.702.8181 and never hardcoded.
 * @param {object} state
 * @param {number} [now]
 * @param {{rid?:string|null}} [o] rid: as operatorAlertsHTML (route detail)
 * @returns {{text:string, tel:string}|null} text as the alert writes it; tel "tel:+1XXXXXXXXXX"
 */
export function operatorPhone(state, now = nowS(), { rid = null } = {}) {
  const own = OFFICIAL_TEL.replace(/\D/g, "");
  for (const a of operatorAlerts(state, now, rid)) {
    for (const t of [alertText(a.header_text), alertText(a.description_text)]) {
      for (const m of t.matchAll(PHONE_RE)) {
        const d = "1" + m[2].replace(/\D/g, "");
        if (d !== own) return { text: m[2], tel: "tel:+" + d };
      }
    }
  }
  return null;
}

const PHONE_IC = '<svg class="v-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>';   // Lucide phone

/**
 * Who to call when no bus reports. With an operator number in the live alerts: "Call bus route help: <number as
 * written>" is the main call and "Safety or urgent: 773.702.8181" the second; then the official page. Without one,
 * the usual official line (773.702.8181 stays the call). Labels stack, never wrap mid-phrase (at 320 px too).
 * @param {object} state
 * @param {number} [now]
 * @param {{rid?:string|null, primary?:boolean}} [o] primary: false when the screen already has its one primary action
 *   (Current trip's "Use my location", a stop's "Directions to here"): the main call then takes the secondary style
 * @returns {string}
 */
export function callsHTML(state, now = nowS(), { rid = null, primary = true } = {}) {
  const op = operatorPhone(state, now, { rid });
  if (!op) return '<p class="v-official">' + officialLinks() + "</p>";
  const two = (a, b) => `<span class="v-calltxt"><span>${a}</span> <span class="v-callnum">${b}</span></span>`;
  return `<div class="v-calls" role="group" aria-label="Call for help">`
    + `<a class="v-btn ${primary ? "v-btn--primary" : "v-btn--secondary"} v-btn--block v-call" href="${esc(op.tel)}">${PHONE_IC}${two("Call bus route help:", esc(op.text))}</a>`
    + `<a class="v-btn v-btn--secondary v-btn--block v-call v-call--safety" href="${OFFICIAL_TEL}">${two("Safety or urgent:", OFFICIAL_PHONE)}</a>`
    + `<p class="v-official"><a href="${OFFICIAL_URL}" target="_blank" rel="noopener">Official transportation page</a></p></div>`;
}

/**
 * Everything a no-bus screen adds after its empty state: the operator's alerts in full, then who to call.
 * @param {object} state
 * @param {number} [now]
 * @param {{rid?:string|null, max?:number, primary?:boolean}} [o]
 * @returns {string}
 */
export function noBusHelpHTML(state, now = nowS(), o = {}) {
  return operatorAlertsHTML(state, now, o) + callsHTML(state, now, o);
}

/** One alert as a list item (Alerts view and operatorAlertsHTML). */
function alertItem(a, state, now) {
  const title = alertText(a.header_text) || "Service alert", body = alertText(a.description_text);
  const rids = [...new Set((a.informed_entity || []).map((e) => e?.route_id).filter((r) => r && state.routes?.[r]))];
  const severe = /SEVERE|WARNING/i.test(String(a.severity_level || "")) || /detour|cancel|suspend|closed/i.test(title);
  const when = windowText(a, now);
  return `<li class="v-alert${severe ? " is-severe" : ""}"><span class="v-alertic">${severe ? WARN : INFO}</span><div class="v-grow"><p class="v-prim">${severe ? '<span class="v-sr">Important: </span>' : ""}${esc(title)}</p>${body ? `<p class="v-sec v-alertbody">${alertBodyHTML(body)}</p>` : ""}${rids.length || when ? `<p class="v-alertmeta">${rids.map((r) => routeChip(r, state.routes)).join("")}${when ? `<span class="v-sec">${esc(when)}</span>` : ""}</p>` : ""}</div></li>`;
}

/**
 * The operator's active alerts in full, for the screens that say no bus is reporting (feed down, empty feed while
 * routes are scheduled, no shuttles running): the operator posts what to do then (for example a number to call
 * when buses do not show), so it sits next to our official-service links. '' when there is none.
 * @param {object} state
 * @param {number} [now]
 * @param {{rid?:string, max?:number}} [o] rid: route detail (only alerts not tied to a route; its own are listed there)
 * @returns {string}
 */
export function operatorAlertsHTML(state, now = nowS(), { rid = null, max = 2 } = {}) {
  const act = operatorAlerts(state, now, rid);
  if (!act.length) return "";
  const more = act.length > max ? `<button type="button" class="v-link v-opmore" data-action="alerts:open">All ${act.length} service alerts</button>` : "";
  return `<section class="v-opalerts" aria-label="Service alerts from the shuttle operator"><h3 class="v-h">From the shuttle operator</h3><ul class="v-alertlist">${act.slice(0, max).map((a) => alertItem(a, state, now)).join("")}</ul>${more}</section>`;
}

/**
 * Render the alerts view.
 * @param {object} state
 * @param {number} [now] unix seconds
 * @returns {string}
 */
export function renderAlerts(state, now = nowS()) {
  let h = '<div class="v-alerts">';
  if (!state.liveLoaded) h += skeleton(2);
  else {
    const act = activeAlerts(state, now);
    if (!act.length) h += emptyState("No active alerts", "Service changes will show up here.");
    else h += '<ul class="v-alertlist">' + act.map((a) => alertItem(a, state, now)).join("") + "</ul>";
    if (state.failed) h += '<p class="v-foot v-foot--warn">Alerts may be out of date: the shuttle feed is not responding.</p>';
  }
  h += '<button type="button" class="v-row v-aboutrow" data-action="about:open"><span class="v-ic" aria-hidden="true">' + INFO + '</span><span class="v-grow"><span class="v-prim">About this app</span><span class="v-sec">Unofficial. Privacy, theme, official contact</span></span></button>';
  return h + "</div>";
}

/**
 * Current trip's alert row: ONE line (owner decision 2026-10-11, so the next bus fits the half detent), count + first
 * alert title, cut with an ellipsis; the full text is in its label and in Alerts. '' when nothing is active. Not
 * color alone: the warning icon and the words "Service alert(s)" carry the state.
 * @param {object} state
 * @param {number} [now]
 * @returns {string}
 */
export function alertBanner(state, now = nowS()) {
  if (!state.liveLoaded) return "";
  const act = activeAlerts(state, now);
  if (!act.length) return "";
  const first = alertText(act[0].header_text) || "Service change";
  const n = act.length;
  const head = n === 1 ? "Service alert" : `${n} service alerts`;
  const more = n > 1 ? ` and ${n - 1} more` : "";
  return `<button type="button" class="v-row v-alertbanner" data-action="alerts:open" aria-label="${esc(`${head}: ${first}${more}. Open alerts`)}"><span class="v-alertic" aria-hidden="true">${WARN}</span><span class="v-grow v-alertline"><b>${esc(head)}:</b> <span class="v-alertfirst">${esc(first)}${esc(more)}</span></span><span class="v-chev" aria-hidden="true"><svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l6 6-6 6"/></svg></span></button>`;
}

registerView("alerts", {
  title: () => "Alerts",
  parent: "nearby",
  detent: "half",
  tab: "nearby",
  render: (state) => renderAlerts(state),
});

registerAction("about:open", (ds, ev, ctx) => ctx.navigate("about"));
registerAction("alerts:open", (ds, ev, ctx) => ctx.navigate("alerts"));

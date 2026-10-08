/**
 * @module ui/views/alerts
 * Active service alerts (severity icon, title, body, affected route chips, time window) and the
 * link to About at the bottom. The tab badge count is drawn by the shell (D1) from activeAlerts().
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { nowS, clock } from "../../core/time.js";
import { activeAlerts } from "../../core/arrivals.js";
import { routeChip, emptyState, skeleton } from "../components.js";

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
  const sameDay = (t) => new Date(t * 1000).toDateString() === new Date(now * 1000).toDateString();
  if (p.end && sameDay(p.end)) return "Until " + clock(p.end);
  if (p.start && sameDay(p.start)) return "Since " + clock(p.start);
  if (p.end) return "Until " + new Date(p.end * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return "";
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
    else {
      h += '<ul class="v-alertlist">' + act.map((a) => {
        const title = alertText(a.header_text) || "Service alert", body = alertText(a.description_text);
        const rids = [...new Set((a.informed_entity || []).map((e) => e?.route_id).filter((r) => r && state.routes?.[r]))];
        const severe = /SEVERE|WARNING/i.test(String(a.severity_level || "")) || /detour|cancel|suspend|closed/i.test(title);
        const when = windowText(a, now);
        return `<li class="v-alert${severe ? " is-severe" : ""}"><span class="v-alertic">${severe ? WARN : INFO}</span><div class="v-grow"><p class="v-prim">${severe ? '<span class="v-sr">Important: </span>' : ""}${esc(title)}</p>${body ? `<p class="v-sec v-alertbody">${esc(body)}</p>` : ""}${rids.length || when ? `<p class="v-alertmeta">${rids.map((r) => routeChip(r, state.routes)).join("")}${when ? `<span class="v-sec">${esc(when)}</span>` : ""}</p>` : ""}</div></li>`;
      }).join("") + "</ul>";
    }
    if (state.failed) h += '<p class="v-foot v-foot--warn">Alerts may be out of date: the shuttle feed is not responding.</p>';
  }
  h += '<button type="button" class="v-row v-aboutrow" data-action="about:open"><span class="v-ic" aria-hidden="true">' + INFO + '</span><span class="v-grow"><span class="v-prim">About this app</span><span class="v-sec">Unofficial. Privacy, theme, official contact</span></span></button>';
  return h + "</div>";
}

registerView("alerts", {
  title: () => "Alerts",
  detent: "half",
  tab: "alerts",
  render: (state) => renderAlerts(state),
});

registerAction("about:open", (ds, ev, ctx) => ctx.navigate("about"));

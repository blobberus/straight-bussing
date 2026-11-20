/**
 * @module ui/views/bus
 * The bus menu (owner 2026-11-20: "There should be an ability for the user to click a particular bus on the map which
 * will show its next stop, line, and schedule. In this menu, at the bottom should be report and feedback: this button
 * should eventually link to a google form ... but for now gray this button out"). A bus tap on the map opens it
 * (main.js openBus: navigate("bus", {routeId, bus}) + store.busMenu); the map keeps its view and focuses the bus's line,
 * the bus gets the picked ring. Logic and words: core/busmenu.js (the iPhone app's BusDetailView ports it).
 *
 * In order: the sheet header names the line, with its badge and "Bus 2" on the right (collapsed: also where it heads and
 * when); a status card "Heading to <stop>" with its time (live, or "~5 min" with "est."), "location from 2 min ago" when
 * the report is old, "Transitioning to new line" (then no times); "Next stops" for one lap with times, each row opens
 * its stop; "Line schedule" (today's hours, Scheduled now / Not scheduled now, the route page's words); "See the whole
 * route" (the route page with this bus picked, as a bus tap did before); "Report and feedback" at the very bottom,
 * grayed out (aria-disabled, still read by screen readers) with "Coming soon" until ui/feedback.js BUS_REPORT_URL is set
 * (docs/BUS-REPORT.md). A bus gone from the feed for 45 s: "This bus is no longer reporting" with See the whole route.
 * A bus menu opened from a bus menu takes its place in the back stack (replaceSelf), so Back returns where the rider was.
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc, safeColor } from "../../core/esc.js";
import { nowS, ago } from "../../core/time.js";
import { staleLevel, staleNote } from "../../core/arrivals.js";
import { TRANSITION_TEXT } from "../../core/seen.js";
import { BUS_MENU, busMenuModel, heldBus, timeText, statusSay, reportInfo, busByKey } from "../../core/busmenu.js";
import { ETA_WORDS } from "../../core/eta.js";
import { routeChip, liveLabel, emptyState, skeleton } from "../components.js";
import { svg } from "../icons.js";
import { busReportLink } from "../feedback.js";
import { APP_VERSION } from "./about.js";

let mem = null;                       // core/busmenu.js heldBus memory: a bus missing from a poll keeps its menu 45 s
let memo = { s: null, t: 0, m: null };   // one model per store state and second (title, header and content share it)

/**
 * The bus menu's model for this state (cached per state object and second).
 * @param {object} state
 * @param {number} now
 * @param {{times?:Function}} [o] tests: a busTimes replacement (not cached)
 * @returns {object} core/busmenu.js busMenuModel plus level (staleLevel of the feed)
 */
export function busModel(state, now = nowS(), o = {}) {
  if (!o.times && memo.s === state && Math.abs(memo.t - now) < 1) return memo.m;
  const h = heldBus(mem, state, state.busMenu, now);
  mem = h.mem;
  const level = state.liveLoaded ? staleLevel(state, now) : "";
  const m = { ...busMenuModel(state, h, now, { times: o.times }), level, last: h.mem.bus };   // est. times: core/eta.js defaultRide
  if (!m.name && m.last && m.status !== "ok") m.name = busByKeyName(state, m.last);
  memo = o.times ? { s: null, t: 0, m: null } : { s: state, t: now, m };
  return m;
}
/** The name a gone bus had ("Bus 2" is no longer known once it left: its fleet label, else none). */
function busByKeyName(state, last) {
  const label = last?.vehicle?.label ?? last?.vehicle?.id;
  return label != null && label !== "" ? `Bus ${label}` : "";
}

/** One time on the screen: "3 min" / "Now" / "~5 min" + "est." under it (rows) or beside it (status). */
function etaHTML(row, now, staleFeed, cls) {
  const t = timeText(row, now, staleFeed);
  if (!t.text) return `<span class="${cls}" aria-hidden="true"></span>`;
  return `<span class="${cls}${t.now ? " is-now" : ""}" aria-hidden="true">${esc(t.text)}${t.tag ? `<span class="v-tlwho bm-kind">${esc(t.tag)}</span>` : ""}</span>`;
}

/** The status card: where the bus heads and when (or that it is transitioning / has no time). */
function statusHTML(m, now) {
  const staleFeed = !!m.level, lbl = liveLabel(m.level);
  if (m.status === "transitioning") {
    return `<div class="v-card bm-now" role="group" aria-label="${esc(statusSay(m, now))}"><span class="bm-nowtext" aria-hidden="true">`
      + `<span class="bm-trans">${esc(TRANSITION_TEXT)}</span>${m.stale ? `<span class="bm-src">${esc(`${cap(BUS_MENU.seenPrefix)} ${ago(m.seen, now)}`)}</span>` : ""}</span></div>`;
  }
  if (!m.next) return `<div class="v-card bm-now"><span class="bm-nowtext"><span class="bm-stop">${esc(BUS_MENU.noTimes)}</span></span></div>`;
  const t = timeText(m.next, now, staleFeed);
  const src = !t.text ? "" : m.next.kind === "est" ? `<span class="v-est">${esc(ETA_WORDS.est)}</span>` : lbl.html;
  const seen = m.stale ? `<span class="bm-seen">${esc(`${src ? ", " : ""}${BUS_MENU.seenPrefix} ${ago(m.seen, now)}`)}</span>` : "";
  const say = statusSay(m, now, { staleFeed, liveSay: lbl.text });
  return `<div class="v-card bm-now" role="group" aria-label="${esc(say)}"><span class="bm-nowtext" aria-hidden="true">`
    + `<span class="bm-k">${esc(BUS_MENU.heading)}</span><span class="bm-stop">${esc(m.next.name)}</span>`
    + (src || seen ? `<span class="bm-src">${src}${seen}</span>` : "") + `</span>${etaHTML(m.next, now, staleFeed, "bm-eta")}</div>`;
}
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/** "Next stops": one lap in travel order, each row opens its stop; the first is where the bus heads now. */
function stopsHTML(m, now) {
  if (!m.rows.length) return "";
  const color = safeColor(m.route?.color), staleFeed = !!m.level, lbl = liveLabel(m.level);
  let h = `<h2 class="v-h bm-h" id="bm-stops-h">${esc(BUS_MENU.nextStops)}</h2>`
    + `<ol class="v-tl bm-tl" style="--rc:${color}" aria-labelledby="bm-stops-h">`;
  m.rows.forEach((r, i) => {
    const t = timeText(r, now, staleFeed);
    const say = `${r.name}${i === 0 ? ", " + BUS_MENU.next.toLowerCase() : ""}, ${t.say ? t.say + (r.kind === "est" ? "" : ", " + lbl.text) : "no time yet"}`;
    h += `<li class="v-tlstop${i === 0 ? " has-bus" : ""}"><button type="button" class="v-tlbtn" data-action="stop:open" data-id="${esc(r.stopId)}" aria-label="${esc(say)}">`
      + `<span class="v-grow"><span class="v-prim">${esc(r.name)}</span>${i === 0 ? `<span class="bm-nexttag" aria-hidden="true">${esc(BUS_MENU.next)}</span>` : ""}</span>`
      + `${etaHTML(r, now, staleFeed, "v-tleta")}</button></li>`;
  });
  h += "</ol>";
  if (m.loopTo) h += `<p class="v-sec bm-loop"><span aria-hidden="true">↻ </span>${esc(`${BUS_MENU.loop} ${m.loopTo}`)}</p>`;
  return h;
}

/** "Line schedule": today's hours in the route page's words + Scheduled now / Not scheduled now. */
function scheduleHTML(m) {
  let h = `<h2 class="v-h bm-h" id="bm-sched-h">${esc(BUS_MENU.lineSchedule)}</h2><div class="v-card bm-sched" role="group" aria-labelledby="bm-sched-h">`;
  const x = m.hours;
  if (!x) return h + `<p class="bm-hours v-sec">${esc(BUS_MENU.noSchedule)}</p></div>`;
  h += `<p class="bm-hours"><span class="r-k">${esc(x.k)}</span> ${esc(x.label)}${x.note ? " " + esc(x.note) : ""}</p>`;
  if (x.on !== null) h += `<p class="bm-hours"><span class="r-sched${x.on ? " is-on" : ""}">${esc(x.on ? BUS_MENU.scheduledNow : BUS_MENU.notScheduledNow)}</span></p>`;
  return h + "</div>";
}

/**
 * "Report and feedback" (the very bottom): a link to the Google Form with only the line, bus, next stop, Chicago time
 * and app version filled in, once ui/feedback.js BUS_REPORT_URL is set; until then a grayed-out button
 * (aria-disabled="true": focusable and read, does nothing) with "Coming soon" under it.
 * @param {object} m busModel
 * @param {number} now
 * @param {{url?:string, entries?:object}} [o] tests: a form address and entry ids
 * @returns {string}
 */
export function reportHTML(m, now, o) {
  const link = busReportLink(reportInfo(m, now, APP_VERSION), o);
  const ic = svg("message-square", 17);
  if (!link) {
    return `<div class="bm-report"><button type="button" class="v-btn v-btn--secondary v-btn--block bm-reportbtn" aria-disabled="true" aria-describedby="bm-report-note">${ic}${esc(BUS_MENU.report)}<span class="v-sr">, ${esc(BUS_MENU.reportOffSay)}</span></button>`
      + `<p class="bm-reportnote" id="bm-report-note">${esc(BUS_MENU.reportSoon)}</p></div>`;
  }
  return `<div class="bm-report"><a class="v-btn v-btn--secondary v-btn--block bm-reportbtn" href="${esc(link)}" target="_blank" rel="noopener" aria-label="${esc(`${BUS_MENU.report}, ${BUS_MENU.reportSay}`)}" aria-describedby="bm-report-note">${ic}${esc(BUS_MENU.report)}</a>`
    + `<p class="bm-reportnote" id="bm-report-note">${esc(BUS_MENU.reportOn)}</p></div>`;
}

/** See the whole route: the route page, with this bus picked while it is still in the feed. */
function wholeHTML(m) {
  if (!m.route) return "";
  const live = m.status === "ok" || m.status === "transitioning";
  return `<button type="button" class="v-btn v-btn--secondary v-btn--block bm-whole" data-action="bus:route" data-id="${esc(m.rid)}"${live && m.key != null ? ` data-bus="${esc(m.key)}"` : ""}>${svg("map", 17)}${esc(BUS_MENU.wholeRoute)}</button>`;
}

/**
 * Render the bus menu.
 * @param {object} state store state (busMenu = the bus key, routeId = its line)
 * @param {number} [now] unix seconds
 * @param {{report?:{url?:string, entries?:object}, times?:Function}} [o] tests: a report form, a busTimes replacement
 * @returns {string}
 */
export function renderBus(state, now = nowS(), o = {}) {
  if (!state.staticLoaded) return skeleton(4);
  const m = busModel(state, now, o);
  let h = '<div class="v-bus">';
  if (m.status === "gone" || m.status === "away") {
    const away = m.status === "away";
    h += emptyState(away ? BUS_MENU.awayTitle : BUS_MENU.goneTitle, away ? BUS_MENU.awayBody : BUS_MENU.goneBody, { icon: "bus-front" });
    h += wholeHTML(m) + scheduleHTML(m);
    return h + reportHTML(m, now, o.report) + "</div>";
  }
  h += statusHTML(m, now);
  if (m.status === "ok") {
    h += stopsHTML(m, now);
    const foot = m.level ? staleNote(m.level, BUS_MENU.stale) : BUS_MENU.live;
    h += `<p class="v-foot">${esc(m.anyEst && !m.level ? BUS_MENU.liveMixed : foot)}${m.anyEst ? `<br>${esc(BUS_MENU.estFoot)}` : ""}</p>`;
  }
  h += scheduleHTML(m) + wholeHTML(m);
  return h + reportHTML(m, now, o.report) + "</div>";
}

/** The collapsed header's second line: where the bus heads (or what happened to it). Only while collapsed. */
export function busSubtitle(state, o, now = nowS()) {
  if (!state.staticLoaded || (o && o.detent && o.detent !== "peek")) return "";
  const m = busModel(state, now);
  if (m.status === "gone") return BUS_MENU.goneTitle;
  if (m.status === "away") return BUS_MENU.awayTitle;
  if (m.status === "transitioning") return TRANSITION_TEXT;
  return m.next ? `${BUS_MENU.heading} ${m.next.name}` : "";
}

/**
 * The header's trailing slot: the line's badge and "Bus 2"; collapsed, also the next stop's time. Trusted HTML.
 * @param {object} state
 * @param {{detent?:string}} [o]
 * @param {number} [now]
 * @returns {string}
 */
export function busMetaHTML(state, o, now = nowS()) {
  if (!state.staticLoaded) return "";
  const m = busModel(state, now);
  if (!m.route) return "";
  const peek = !o || !o.detent || o.detent === "peek";
  const t = peek && m.status === "ok" && m.next ? timeText(m.next, now, !!m.level) : null;
  const say = [m.route.long || m.route.short || "", m.name, t && t.text ? `${m.next.name} ${t.say}` : ""].filter(Boolean).join(", ");
  return `<span class="hm" role="text" aria-label="${esc(say)}"><span class="hm-row" aria-hidden="true">${routeChip(m.rid, state.routes, { small: true })}`
    + (m.name ? `<span class="hm-bus">${esc(m.name)}</span>` : "")
    + (t && t.text ? `<span class="bm-hmeta${t.now ? " is-now" : ""}">${esc(t.text)}</span>` : "") + "</span></span>";
}

/** The line's name (the sheet title). */
export function busTitle(state) {
  const b = busByKey(state, state.busMenu), rid = String(b?.trip?.route_id ?? state.routeId ?? "");
  const r = state.routes?.[rid];
  return r ? r.long || r.short || "Bus" : "Bus";
}

registerView("bus", {
  title: (state) => busTitle(state),
  subtitle: (state, o) => busSubtitle(state, o),
  metaHTML: (state, o) => busMetaHTML(state, o),
  detent: "half",       // = keep the sheet as it is (ui/sheet.js): a bus tap on a collapsed sheet leaves it collapsed
  replaceSelf: true,    // a bus menu opened from a bus menu takes its place: Back returns where the rider was
  render: (state) => renderBus(state),
});

// See the whole route: the route page with this bus picked (its own time at each station), the map framed on the line
registerAction("bus:route", (ds, ev, ctx) => {
  const s = ctx.store.get(), rid = ds.id != null ? String(ds.id) : null;
  if (!rid || !s.routes?.[rid] || !ctx.navigate("route", { routeId: rid })) return;
  if (ds.bus) ctx.store.set({ busId: String(ds.bus) });   // main.js pickCheck keeps it while the bus is shown on this page
  const pts = (s.shapes?.[rid] || []).flat();
  if (pts.length) try { ctx.map?.fitTo?.(pts, { maxZoom: 16 }); } catch (e) { /* map optional */ }
});

/** Tests only: forget the 45 s hold and the cached model. */
export function _resetBusMenu() { mem = null; memo = { s: null, t: 0, m: null }; }

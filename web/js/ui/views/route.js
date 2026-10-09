/**
 * @module ui/views/route
 * Route detail: status line + today's scheduled hours, stop timeline in route order with the next ETA
 * per stop, a parallel "bus rail" showing where each bus is between stops and which way it flows
 * (route order = travel direction, loops wrap), then "Hours & service" from the official schedule
 * (week, calendar changes, route alerts, scheduled buses by hour). The map focuses on the route
 * (core/visibility.js mapFocus); route:open also fits the map to the route shape.
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import { esc, safeColor, textOn } from "../../core/esc.js";
import { nowS, minsUntil, ago } from "../../core/time.js";
import { hav } from "../../core/geo.js";
import { arrivalsFor, staleLevel, runningCount, activeAlerts, alertText, liveUnknown } from "../../core/arrivals.js";
import { effectiveHidden } from "../../core/visibility.js";
import { hoursOn, isScheduledNow, weekSummary, upcomingChanges, busesByHour, groupHours, hourLabel, dayKey, routeService } from "../../core/schedule.js";
import { emptyState, skeleton } from "../components.js";
import { OFFICIAL_HTML } from "./pick.js";

const STALE_BUS_S = 60;
const DAY_NAME = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const CHEVRON = '<svg class="r-chev" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true" focusable="false"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Ordered unique stop ids of a route (a loop's repeated last stop is dropped).
 * @param {string[]} list routeStops[rid]
 * @returns {string[]}
 */
export function stopOrder(list) {
  const out = [];
  for (const id of list || []) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * ETA label for the timeline.
 * @param {number|undefined} t unix seconds
 * @param {number} now
 * @param {boolean} stale
 * @returns {string}
 */
export function etaLabel(t, now, stale) {
  if (!t) return "";
  const m = minsUntil(t, now);
  return m < 1 ? "Now" : (stale ? "~" : "") + m + " min";
}

/**
 * Where each live bus of a route is along the stop order.
 * @param {object} state
 * @param {string} rid
 * @param {number} now
 * @returns {{label:string, next:number, prev:number|null, frac:number, stale:boolean, seen:number, text:string}[]}
 *   next/prev are indexes into stopOrder(routeStops[rid]); frac 0..1 from prev toward next (by distance)
 */
export function busPositions(state, rid, now) {
  const list = state.routeStops?.[rid] || [], ids = stopOrder(list);
  const loop = list.length > 2 && list[0] === list[list.length - 1];
  const name = (i) => state.stops?.[ids[i]]?.name || ids[i];
  const out = [];
  for (const b of state.buses || []) {
    if (b?.trip?.route_id !== rid || !b.stop_id) continue;
    const next = ids.indexOf(b.stop_id);
    if (next < 0) continue;
    const prev = next > 0 ? next - 1 : loop && ids.length > 1 ? ids.length - 1 : null;
    const p = b.position || {}, here = { lat: Number(p.latitude), lon: Number(p.longitude) };
    let frac = 0.5;
    const a = prev === null ? null : state.stops?.[ids[prev]], n = state.stops?.[ids[next]];
    if (a && n && Number.isFinite(here.lat) && Number.isFinite(here.lon)) {
      const dp = hav(a, here), dn = hav(here, n);
      if (dp + dn > 0) frac = Math.min(0.9, Math.max(0.1, dp / (dp + dn)));
    }
    const seen = Number(b.timestamp) || 0, stale = !!seen && now - seen > STALE_BUS_S;
    const label = String(b.vehicle?.label || b.vehicle?.id || "");
    let text = `Bus ${label} ` + (prev === null ? `approaching ${name(next)}` : `between ${name(prev)} and ${name(next)}, heading to ${name(next)}`);
    if (stale) text += `, location from ${ago(seen)}`;
    out.push({ label, next, prev, frac, stale, seen, text });
  }
  return out;
}

/** One rail marker (decorative: the bus list above the timeline carries the same text). */
function busMarker(b, color, fg, top) {
  return `<span class="r-bus${b.stale ? " is-stale" : ""}" style="top:${top};background:${color};color:${fg}" aria-hidden="true">${esc(b.label || "Bus")}</span>`;
}

/**
 * "Hours & service" section (schedule data only).
 * @param {object} state
 * @param {string} rid
 * @param {number} now
 * @returns {string}
 */
export function renderService(state, rid, now) {
  const svc = state.service, alerts = activeAlerts(state, now).filter((a) => (a.informed_entity || []).some((e) => e && String(e.route_id) === rid));
  if (!routeService(svc, rid) && !alerts.length) return "";
  let h = '<section class="r-svc" aria-labelledby="r-svc-h"><h2 class="r-h" id="r-svc-h">Hours &amp; service</h2>';
  const week = weekSummary(svc, rid);
  if (week.length) {
    h += '<dl class="v-card r-week">';
    for (const w of week) h += `<div class="r-wrow"><dt>${esc(w.days)}</dt><dd>${esc(w.label)}</dd></div>`;
    h += "</dl>";
  }
  const changes = upcomingChanges(svc, rid, now);
  if (changes.length || alerts.length) {
    h += '<h3 class="r-h3">Schedule changes</h3><ul class="v-card r-changes">';
    for (const a of alerts) h += `<li><span class="r-tag">Service alert</span> ${esc(alertText(a.header_text) || alertText(a.description_text) || "Service alert")}</li>`;
    for (const c of changes) h += `<li><span class="r-k">${esc(c.label)}</span> ${esc(c.text)}</li>`;
    h += "</ul>";
  } else if (routeService(svc, rid)) h += '<p class="v-sec r-nochange">No schedule changes in the next 30 days.</p>';
  h += renderBuses(svc, rid, now);
  if (routeService(svc, rid)) h += '<p class="v-foot">Hours and bus counts come from the official published schedule. Live service may differ.</p>';
  return h + "</section>";
}

/** Scheduled buses by hour for today (or the first day with service): bars + text. */
function renderBuses(svc, rid, now) {
  let key = dayKey(now), list = busesByHour(svc, rid, key);
  if (!list.length) for (const k of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) if ((list = busesByHour(svc, rid, k)).length) { key = k; break; }
  if (!list.length) return "";
  const max = Math.max(...list.map((x) => x.buses));
  if (max <= 1 && list.every((x) => x.buses === list[0].buses)) return "";
  const span = (list[list.length - 1].hour - list[0].hour + 24) % 24 + 1, by = new Map(list.map((x) => [x.hour, x.buses]));
  const bars = Array.from({ length: span }, (_, i) => { const hr = (list[0].hour + i) % 24; return { hour: hr, buses: by.get(hr) || 0 }; });
  const when = key === dayKey(now) ? "today" : DAY_NAME[key] + "s";
  const groups = groupHours(list).map((g) => `${hourLabel(g.from)}–${hourLabel(g.to)}: ${g.buses} bus${g.buses > 1 ? "es" : ""}`);
  let h = `<h3 class="r-h3">Scheduled buses by hour, ${esc(when)}</h3><div class="v-card r-hours"><div class="r-bars${bars.length > 14 ? " is-dense" : ""}" aria-hidden="true">`;
  for (const x of bars) h += `<span class="r-bar"><span class="r-barn">${x.buses || ""}</span><span class="r-barfill${x.buses ? "" : " is-zero"}" style="height:${Math.round((x.buses / max) * 70)}%"></span><span class="r-barh">${x.hour % 3 === 0 ? esc(hourLabel(x.hour).replace(" ", "")) : ""}</span></span>`;
  return h + `</div><p class="v-sec r-bartext">${esc(groups.join(" · "))}</p></div>`;
}

/** Status line under the title: buses running + today's scheduled hours. */
function statusHtml(state, rid, r, n, now) {
  const idle = liveUnknown(state, now) ? "Live status unavailable" : "Not running right now";   // a feed outage is not "not running"
  let h = `<p class="v-status">${n ? '<span class="v-livedot" aria-hidden="true"></span>' : ""}${n ? `${n} bus${n > 1 ? "es" : ""} running` : idle}${r.short && r.long ? ` &middot; <span class="v-sec">${esc(r.short)}</span>` : ""}</p>`;
  const today = hoursOn(state.service, rid, now);
  if (today) {
    const on = isScheduledNow(state.service, rid, now);
    const note = today.exception === "removed" ? (today.first ? " (reduced schedule)" : " (schedule change)") : today.exception === "added" ? " (extra service)" : "";
    h += `<p class="v-sec r-today"><span class="r-k">Today</span> ${esc(today.label)}${esc(note)}${on === null ? "" : ` &middot; <span class="r-sched${on ? " is-on" : ""}">${on ? "Scheduled now" : "Not scheduled now"}</span>`}</p>`;
  }
  return h;
}

/**
 * Render the route view.
 * @param {object} state store state (routeId selects the route)
 * @param {number} [now] unix seconds
 * @returns {string}
 */
export function renderRoute(state, now = nowS()) {
  if (!state.staticLoaded) return skeleton(6);
  const rid = state.routeId, r = state.routes?.[rid];
  if (!r) return emptyState("Route not found", "This route is not in the current schedule.") + '<button type="button" class="v-btn v-btn--secondary v-btn--block" data-action="route:all">See all routes</button>';
  const color = safeColor(r.color), fg = textOn(color), n = runningCount(state, rid);
  const hidden = effectiveHidden(state).includes(rid), stale = staleLevel(state, now) !== "";
  const list = state.routeStops?.[rid] || [], ids = stopOrder(list);
  const loop = list.length > 2 && list[0] === list[list.length - 1];
  let h = '<div class="v-route">' + statusHtml(state, rid, r, n, now);
  if (hidden) h += state.journey
    ? '<div class="v-note"><span class="v-grow v-sec">This route is not part of the current journey, so it is hidden on the map.</span></div>'
    : `<div class="v-note"><span class="v-grow v-sec">This route is hidden from the map and arrival times.</span><button type="button" class="v-btn v-btn--quiet" data-action="routes:toggle" data-id="${esc(rid)}">Show</button></div>`;
  if (!n && state.liveLoaded && !(state.buses || []).length) h += OFFICIAL_HTML;
  if (!ids.length) return h + emptyState("No stops listed", "The schedule has no stops for this route.") + renderService(state, rid, now) + "</div>";
  const pos = state.liveLoaded ? busPositions(state, rid, now) : [];
  const busAt = new Map(), railAt = new Map();
  for (const b of pos) {
    if (!busAt.has(b.next)) busAt.set(b.next, []);
    busAt.get(b.next).push(b);
    const host = b.prev === null ? b.next : b.prev;   // marker lives in the row it is leaving
    if (!railAt.has(host)) railAt.set(host, []);
    railAt.get(host).push(b);
  }
  if (pos.length) h += `<ul class="r-buslist" aria-label="Where the buses are">${pos.map((b) => `<li${b.stale ? ' class="is-stale"' : ""}><span class="r-dot" style="background:${color}" aria-hidden="true"></span>${esc(b.text)}</li>`).join("")}</ul>`;
  h += `<ol class="v-tl r-tl" style="--rc:${color}" aria-label="Stops on ${esc(r.long || r.short || "route")}, in travel order">`;
  ids.forEach((sid, i) => {
    const a = state.liveLoaded ? arrivalsFor(state, sid, { routeId: rid, nowS: now })[0] : null;
    const eta = etaLabel(a?.t, now, stale), name = state.stops?.[sid]?.name || sid;
    const here = busAt.get(i) || [];
    const pill = here.map((b) => `<span class="v-tlbus${b.stale ? " is-stale" : ""}" style="background:${color};color:${fg}">Bus ${esc(b.label)} heading here${b.stale ? ` &middot; seen ${esc(ago(b.seen))}` : ""}</span>`).join("");
    const label = `${name}${eta ? ", next bus " + (eta === "Now" ? "now" : "in " + eta.replace("~", "about ")) : ", no prediction"}${here.length ? ", a bus is heading here" : ""}`;
    const last = i === ids.length - 1;
    let rail = last && !loop ? "" : `<span class="r-seg" aria-hidden="true">${CHEVRON}</span>`;
    for (const b of railAt.get(i) || []) {
      const top = b.prev === null ? "18%" : last ? `calc(50% + ${Math.round(b.frac * 50)}%)` : `calc(50% + ${Math.round(b.frac * 100)}%)`;
      rail += busMarker(b, color, fg, top);
    }
    h += `<li class="v-tlstop${here.length ? " has-bus" : ""}${last && loop ? " is-loopend" : ""}">${rail}<button type="button" class="v-tlbtn" data-action="stop:open" data-id="${esc(sid)}" aria-label="${esc(label)}"><span class="v-grow"><span class="v-prim">${esc(name)}</span>${pill}</span><span class="v-tleta${eta === "Now" ? " is-now" : ""}">${esc(eta)}</span></button></li>`;
  });
  h += "</ol>";
  if (loop) h += `<p class="v-sec r-loop"><span aria-hidden="true">↻ </span>Loop: continues to ${esc(state.stops?.[ids[0]]?.name || ids[0])}</p>`;
  if (state.liveLoaded) h += `<p class="v-foot">${stale ? "Live data delayed. Times and bus positions may be off." : "Times are live predictions. Bus positions are approximate."}</p>`;
  return h + renderService(state, rid, now) + "</div>";
}

registerView("route", {
  title: (state) => state.routes?.[state.routeId]?.long || state.routes?.[state.routeId]?.short || "Route",
  parent: "routes",
  detent: "half",
  tab: "routes",
  render: (state) => renderRoute(state),
});

registerAction("route:open", (ds, ev, ctx) => {
  const s = ctx.store.get();
  if (!s.routes?.[ds.id]) return;
  ctx.navigate("route", { routeId: ds.id });
  const pts = (s.shapes?.[ds.id] || []).flat();
  if (pts.length) try { ctx.map?.fitTo?.(pts, { maxZoom: 16 }); } catch (e) { /* map optional */ }
});
registerAction("route:all", (ds, ev, ctx) => ctx.navigate("routes"));

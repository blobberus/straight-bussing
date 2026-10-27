/**
 * @module ui/views/settings
 * Settings content, shown in its own modal overlay (ui/settings-overlay.js), NOT in the sheet. The
 * top-right gear runs action `settings:open`, which opens (or closes) the overlay:
 * Beta feedback first (a link to the form, ui/feedback.js), appearance (ui/theme.js mount), location, usage statistics
 * (only once a receiver is set, data/usage.js), service alerts inline,
 * bus alerts ("notify me when my bus is near
 * <station>": station, routes, 2 stops / 1 stop / N min; ONE alert each, a banner while the app is in front or a
 * system notification in the background when allowed, ui/notifier.js deliveryFor; wording as iOS SettingsView),
 * trip alerts (2026-10-13: during a started trip, before the bus comes and before you get off, with the count
 * the Current trip card and the map show; the 2 stops / 1 stop / minutes choices apply to both),
 * the iPhone-only Live Activity preference, About, and last a Credits button that expands the credits list
 * (owner 2026-10-16; collapsed on every open, nothing stored). Owns its DOM after mount (regions patched in
 * place, focus kept) so the station search field and checkboxes never lose a tap or keystroke.
 * The router view id "settings" is kept only as a compatibility shim: navigating to it goes back and
 * opens the overlay instead (main.js VIEW_IDS still imports this file under that id).
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import * as theme from "../theme.js";
import { esc } from "../../core/esc.js";
import { nowS, clock, shortDate, sameDay } from "../../core/time.js";
import { nearestStops } from "../../core/geo.js";
import { activeAlerts, alertText, staleLevel } from "../../core/arrivals.js";
import { effectiveHidden } from "../../core/visibility.js";
import { liveStatus, watchedRoutes, minutesText, stopsAway, tripAlertsOn } from "../../core/notify.js";
import { tripNow } from "../../core/tripprogress.js";
import { legStatus } from "../../core/tripyou.js";
import { cleanNotify } from "../../state.js";
import { DEMO } from "../../core/demo.js";
import { routeChip, officialLinks, icon } from "../components.js";
import { alertBodyHTML } from "./alerts.js";
import { notificationSupport, requestPermission } from "../notifier.js";
import { openSettingsOverlay, closeSettingsOverlay, isSettingsOpen, overlayKind } from "../settings-overlay.js";
import { locPlatform, locEnv, LOC_STEPS, LOC_ORDER, locResultText } from "../../core/lochelp.js";
import { feedbackLinkHTML } from "../feedback.js";
import { usageConfigured, resetId, cleanUsage } from "../../data/usage.js";

/** Settings > Beta feedback, first in Settings (the welcome popup says the link is in the settings menu). */
export const FEEDBACK_LINE = "This is a beta. Tell us what works and what does not.";
export const FEEDBACK_NOTE = "Opens a Google Form in a new tab. What you type is sent only when you press Submit there.";
/** @returns {string} */
export function feedbackHTML() {
  return `<h3 class="v-h">Beta feedback</h3><div class="st-feedback"><p class="v-sec st-intro">${esc(FEEDBACK_LINE)}</p>`
    + feedbackLinkHTML("Give feedback", { cls: "v-btn v-btn--secondary v-btn--block st-fbbtn", attrs: 'data-key="feedback"', icon: true })
    + `<p class="v-fine">${esc(FEEDBACK_NOTE)}</p></div>`;
}

/** The location promise in Settings (owner 2026-10-12: "no user location data will be collected"); matches privacy.html. */
export const LOC_DISCLAIMER = "Straight Bussing does not collect your location. It stays on your device to find the stops and buses near you; for walking directions only a rounded start and end point goes to a routing service (OSRM or Valhalla), and nothing is stored.";

const stepsHTML = (k) => `<ol class="st-steps">${LOC_STEPS[k].steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`;

/**
 * Exact steps for this device first, the others one tap away (core/lochelp.js).
 * @param {string} [platform] locPlatform() key (default: this browser)
 * @returns {string}
 */
export function locStepsHTML(platform = locPlatform(locEnv())) {
  const k = LOC_STEPS[platform] ? platform : "other";
  const others = LOC_ORDER.filter((x) => x !== k).map((x) => `<h4 class="st-steps-h">${esc(LOC_STEPS[x].title)}</h4>${stepsHTML(x)}`).join("");
  return `<h4 class="st-steps-h">${esc(LOC_STEPS[k].title)}</h4>${stepsHTML(k)}`
    + `<details class="st-other"><summary>Using a different phone or browser?</summary>${others}</details>`;
}

/** Settings > Location: share / stop sharing, the blocked state with how to fix it, the disclaimer. */
export function locHTML(state, platform) {
  const ls = state.locState;
  const tried = locResultText(state.locErr, (t) => clock(t));
  const triedHTML = tried ? `<p class="v-sec st-tried" role="status">${esc(tried)}</p>` : "";
  let body;
  if (state.user) {
    body = `<div class="st-row"><span class="v-grow"><span class="v-prim">${OK} Sharing your location</span><span class="v-sec">Used on this device for nearby stops and walking times.</span></span></div>`
      + '<button type="button" class="v-btn v-btn--secondary v-btn--block" data-st="loc-off" data-key="loc-off">Stop sharing my location</button>';
  } else if (ls === "asking") {
    body = '<p class="v-hint" role="status">Asking for your location&hellip;</p>';
  } else if (ls === "denied") {
    body = '<div class="v-locoff"><span class="v-grow"><b>Location is blocked for this site.</b> Your browser shows its location popup only once. After a "Don\'t Allow", or while location is off for websites, it blocks the request straight away and shows nothing, so it has to be switched back on in your settings:</span></div>'
      + locStepsHTML(platform)
      + '<button type="button" class="v-btn v-btn--secondary v-btn--block" data-st="loc-on" data-key="loc-on">Try again</button>' + triedHTML;
  } else {
    body = '<button type="button" class="v-btn v-btn--primary v-btn--block" data-st="loc-on" data-key="loc-on">Share my location</button>'
      + '<p class="v-sec st-note">Shows the stops and buses near you. Your browser asks for permission first.</p>' + triedHTML;
  }
  return `<div class="v-card st-loc">${body}<p class="v-sec st-note st-disclaimer">${esc(locNote(state))}</p></div>`;
}

/** Added to the location note while the rider includes the nearest stop in the usage statistics. */
export const LOC_ZONE_NOTE = "You turned on Include my nearest stop: once per visit, the name of the stop nearest you (within 400 m) is sent with the anonymous usage statistics. Your coordinates are never sent.";

/** The location note: always LOC_DISCLAIMER, plus LOC_ZONE_NOTE while the nearest stop is shared. */
export function locNote(state) {
  return usageConfigured() && cleanUsage(state.usage).zone ? `${LOC_DISCLAIMER} ${LOC_ZONE_NOTE}` : LOC_DISCLAIMER;
}

/** Settings > Usage statistics (owner 2026-10-27; data/usage.js). Shown only when a receiver is set. */
export const USAGE_ALWAYS = "Always counted, anonymously: when each visit starts, with a random number made in this browser so that repeat visits count once. Your identity is never collected: no name, account, email, IP address, device details or location coordinates. Website only; the iPhone app collects nothing.";
export const USAGE_DUR_SUB = "The length of each visit, to the nearest 5 seconds.";
export const USAGE_ZONE_SUB = "Once per visit, only the name of the stop nearest you (within 400 m), never your location. Needs location to be on.";
export const USAGE_RESET = "Get a new anonymous number";
export function usageHTML(state) {
  const u = cleanUsage(state.usage);
  return `<div class="v-card st-usage"><p class="v-sec st-intro">${esc(USAGE_ALWAYS)}</p>`
    + sw("usageDur", "Share how long I use the app", USAGE_DUR_SUB, u.dur)
    + sw("usageZone", "Include my nearest stop", USAGE_ZONE_SUB, u.zone)
    + `<button type="button" class="v-btn v-btn--secondary v-btn--block" data-st="usage-reset" data-key="usage-reset">${esc(USAGE_RESET)}</button></div>`;
}

const MINUTES = [0, 2, 5, 10];
const MAX_RESULTS = 6;
const ui = { picking: false, query: "" };
const OK = '<svg class="st-ok" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
let offStore = null, abort = null, live = null;

/** Current notify settings, validated. */
const N = (state) => cleanNotify(state.notify);

function sw(key, label, sub, on, extra = "") {
  return `<label class="st-sw"><span class="v-grow"><span class="v-prim">${esc(label)}</span>${sub ? `<span class="v-sec">${esc(sub)}</span>` : ""}</span>`
    + `<input type="checkbox" role="switch" data-st-in="${esc(key)}" data-key="in-${esc(key)}"${on ? " checked" : ""}${extra}><span class="st-knob" aria-hidden="true"></span></label>`;
}

function period(a, now) {
  const p = (a.active_period || []).find((w) => (!w.start || w.start <= now) && (!w.end || w.end >= now));
  if (!p || (!p.start && !p.end)) return "";
  // Chicago days and times (core/time.js), like the route hours
  const f = (t) => (sameDay(t, now) ? clock(t) : `${shortDate(t)} ${clock(t)}`);
  if (p.start && p.end) return `${f(p.start)} to ${f(p.end)}`;
  return p.end ? `Until ${f(p.end)}` : `Since ${f(p.start)}`;
}

/**
 * Service alerts block (inline list, or empty state with the official contact).
 * @param {object} state
 * @param {number} now
 * @returns {string}
 */
export function alertsHTML(state, now) {
  if (!state.liveLoaded) return '<p class="v-sec st-pad">Checking for service alerts…</p>';
  const act = activeAlerts(state, now);
  let h = "";
  if (!act.length) h += `<div class="v-card st-empty"><p class="v-prim">No active alerts</p><p class="v-sec">${officialLinks()}</p></div>`;
  else h += '<ul class="v-card st-alerts">' + act.map((a) => {
    const title = alertText(a.header_text) || "Service alert", body = alertText(a.description_text), when = period(a, now);
    return `<li class="st-alert"><span class="st-alertic" aria-hidden="true">!</span><div class="v-grow"><p class="v-prim">${esc(title)}</p>${body ? `<p class="v-sec v-alertbody">${alertBodyHTML(body)}</p>` : ""}${when ? `<p class="v-sec st-when">${esc(when)}</p>` : ""}</div></li>`;
  }).join("") + "</ul>";
  if (state.failed) h += '<p class="v-foot v-foot--warn">Alerts may be out of date: the shuttle feed is not responding.</p>';
  return h;
}

/**
 * Stations matching a typed query (case-insensitive, word-start first), served by at least one route.
 * @param {object} state
 * @param {string} q
 * @returns {Array<{id:string, name:string}>}
 */
export function searchStations(state, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return [];
  const out = [];
  for (const [id, st] of Object.entries(state.stops || {})) {
    const name = String(st?.name || "");
    const i = name.toLowerCase().indexOf(s);
    if (i < 0 || !(state.stopRoutes?.[id] || []).length) continue;
    out.push({ id, name, rank: i === 0 || /\W/.test(name[i - 1] || "") ? 0 : 1 });
  }
  return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).slice(0, MAX_RESULTS).map(({ id, name }) => ({ id, name }));
}

function pickRow(state, id, sub) {
  const st = state.stops?.[id];
  if (!st) return "";
  const chips = (state.stopRoutes?.[id] || []).map((r) => routeChip(r, state.routes, { small: true })).join("");
  return `<button type="button" class="v-row st-pick" data-st="pick" data-id="${esc(id)}" data-key="pick-${esc(id)}"><span class="v-grow"><span class="v-prim">${esc(st.name)}</span>${sub ? `<span class="v-sec">${esc(sub)}</span>` : ""}<span class="st-chips">${chips}</span></span></button>`;
}

/**
 * Search results list for the station picker.
 * @param {object} state
 * @param {string} q
 * @returns {string}
 */
export function resultsHTML(state, q) {
  if (!String(q || "").trim()) return "";
  const r = searchStations(state, q);
  if (!r.length) return '<p class="v-sec st-pad" role="status">No stations match.</p>';
  return `<div class="v-card" role="list" aria-label="Matching stations">${r.map((x) => pickRow(state, x.id, "")).join("")}</div>`;
}

/**
 * Station region: the chosen station with Change / Turn off, or the picker.
 * @param {object} state
 * @param {{picking:boolean, query:string}} [u]
 * @returns {string}
 */
export function stationHTML(state, u = ui) {
  const n = N(state), st = n.stopId && state.stops?.[n.stopId];
  if (st && !u.picking) {
    const addr = state.addresses?.[n.stopId]?.address;
    return `<div class="v-card st-station"><div class="st-stationrow"><span class="v-grow"><span class="v-sec">Station</span><span class="v-prim">${esc(st.name)}</span>${addr ? `<span class="v-sec">${esc(addr)}</span>` : ""}</span>`
      + `<button type="button" class="v-btn v-btn--quiet" data-st="change" data-key="change">Change</button></div>`
      + `<button type="button" class="v-btn v-btn--quiet st-off" data-st="off" data-key="off">Turn off bus alerts</button></div>`;
  }
  let h = '<div class="st-picker">';
  const favs = (state.favStops || []).filter((id) => state.stops?.[id]);
  if (favs.length) h += `<p class="v-sec st-label">Favorites</p><div class="v-card">${favs.map((id) => pickRow(state, id, "")).join("")}</div>`;
  if (state.user && state.stops) {
    const near = nearestStops(state.stops, state.user, { max: 1, maxM: 1500, routeStops: state.routeStops })[0];
    if (near) h += `<div class="v-card">${pickRow(state, near.id, `Nearest station · ${Math.max(1, Math.round(near.d / 80))} min walk`)}</div>`;
  }
  h += `<label class="st-label" for="st-q">Search stations</label><div class="st-search"><input id="st-q" type="search" autocomplete="off" enterkeyhint="search" placeholder="Station name" data-st-in="q" data-key="q" value="${esc(u.query)}"></div>`;
  h += `<div data-region="results" aria-live="polite">${resultsHTML(state, u.query)}</div>`;
  if (st) h += '<button type="button" class="v-btn v-btn--quiet" data-st="cancel" data-key="cancel">Cancel</button>';
  return h + "</div>";
}

/**
 * Routes + alert-kind options for the chosen station ('' when no station).
 * @param {object} state
 * @returns {string}
 */
export function optsHTML(state) {
  const n = N(state);
  if (!n.stopId || !state.stops?.[n.stopId]) return kindsHTML(n);   // trip alerts use the same choices
  const serve = (state.stopRoutes?.[n.stopId] || []).map(String);
  const hidden = new Set(effectiveHidden(state)), watched = new Set(watchedRoutes(state));
  let h = `<fieldset class="v-card st-routes"><legend class="v-sec st-label">Routes${n.rids.length ? "" : " (any visible route)"}</legend>`;
  h += serve.map((r) => `<label class="st-check"><input type="checkbox" data-st-in="rid" data-id="${esc(r)}" data-key="rid-${esc(r)}"${watched.has(r) ? " checked" : ""}>${routeChip(r, state.routes)}<span class="v-grow v-prim">${esc(state.routes?.[r]?.long || state.routes?.[r]?.short || r)}</span>${hidden.has(r) ? '<span class="v-sec">hidden</span>' : ""}</label>`).join("");
  if (n.rids.length) h += '<button type="button" class="v-btn v-btn--quiet" data-st="anyroute" data-key="anyroute">Use any visible route</button>';
  h += "</fieldset>";
  return h + kindsHTML(n);
}

/** When to alert (station and trip alerts alike). @param {object} n notify settings */
function kindsHTML(n) {
  let h = '<div class="v-card st-kinds">' + sw("twoStops", "2 stops away", TWO_SUB, n.twoStops) + sw("oneStop", "1 stop away", ONE_SUB, n.oneStop);
  h += `<label class="st-sel"><span class="v-grow v-prim">When the bus is</span><select data-st-in="minutes" data-key="in-minutes">${MINUTES.map((m) => `<option value="${m}"${n.minutes === m ? " selected" : ""}>${m ? `${m} min away` : "Off"}</option>`).join("")}</select></label>`;
  return h + sw("inApp", "In-app alerts while open", "A banner at the top of the app", n.inApp) + "</div>";
}

/** Switch sub-lines: the same choices time the trip alerts (iOS SettingsView uses the same words). */
export const TWO_SUB = "On a trip, also 2 stops before you get off";
export const ONE_SUB = "Also when your stop is next. On a trip, also 1 stop before you get off";
export const TRIP_SUB = "Before your bus comes and before you get off, while a trip is in progress.";
export const TRIP_PAUSED = "Paused during your trip: alerts follow your trip's bus.";

/**
 * Trip alerts switch and, during a trip, what they follow right now (the Current trip card's words).
 * @param {object} state
 * @param {number} now
 * @returns {string}
 */
export function tripHTML(state, now) {
  const n = N(state);
  let h = `<div class="v-card st-trip">${sw("trip", "Trip alerts", TRIP_SUB, n.trip)}`;
  const p = state.journey && state.journey.kind === "plan" ? tripNow(state, now) : null;
  if (n.trip && tripAlertsOn(p, state)) {
    const leg = p.legs[p.active], level = staleLevel(state, now);
    const what = level === "err" || level === "old" ? "Live data is unavailable, so trip alerts wait for it."
      : (leg && leg.type === "bus" && legStatus(leg)) || "Waiting for a live position of your bus.";
    h += `<p class="v-sec st-pad st-tripnow" role="status">During your trip: ${esc(what)}</p>`;
  }
  return h + "</div>";
}

/**
 * One-glance status of the nearest bus for the chosen station (estimates, live data).
 * @param {object} state
 * @param {number} now
 * @returns {string}
 */
export function statusHTML(state, now) {
  const n = N(state);
  if (!n.stopId || !state.stops?.[n.stopId]) return "";
  const p = state.journey && state.journey.kind === "plan" ? tripNow(state, now) : null;
  if (tripAlertsOn(p, state)) return `<p class="v-sec st-pad" role="status">${esc(TRIP_PAUSED)}</p>`;
  const level = staleLevel(state, now);
  if (level === "err" || level === "old") return '<p class="v-foot v-foot--warn" role="status">Live data is unavailable, so bus alerts are paused.</p>';
  const s = liveStatus(state, now);
  if (!s) return '<p class="v-sec st-pad" role="status">No bus is heading there right now.</p>';
  const it = stopsAway(state, n.stopId, s.rid, now)[0];
  const away = s.stopsAway === 0 ? "Your stop is next" : `${s.stopsAway} stop${s.stopsAway === 1 ? "" : "s"} away`;
  const when = it ? minutesText(it.etaS, now) : "";
  return `<div class="v-card st-status" role="status">${routeChip(s.rid, state.routes)}<span class="v-grow"><span class="v-prim">${esc(away)}${when ? ` · ${esc(when)}` : ""}</span><span class="v-sec">Next stop: ${esc(s.nextStop)}. From live predictions.</span></span></div>`;
}

/** Footer under the bus alerts (iOS SettingsView footer, adapted to a browser). */
export const ALERTS_NOTE = "Alerts work only while Straight Bussing is open; in a background tab they can arrive late. Lock-screen alerts and a live trip counter come with the iPhone app.";

/**
 * Notification permission row (iOS SettingsView permissionRow, adapted): how alerts will arrive.
 * @param {string} [perm] notificationSupport() value
 * @returns {string}
 */
export function permHTML(perm = notificationSupport()) {
  if (perm === "granted") return `<p class="v-sec st-pad">${OK} Alerts show as a banner while you use the app, and as a notification while it is open in the background.</p>`;
  const why = perm === "denied" ? "Notifications for Straight Bussing are blocked in your browser settings"
    : perm === "unsupported" ? "This browser can&rsquo;t show notifications" : "";
  if (why) return `<div class="st-pad"><p class="v-prim">Notifications are off</p><p class="v-sec">${why}, so alerts show as a banner inside the app while it is open.</p></div>`;
  return '<button type="button" class="v-btn v-btn--secondary v-btn--block" data-st="perm" data-key="perm" aria-describedby="st-permhint">Allow notifications</button>'
    + '<p class="v-fine" id="st-permhint">Without notifications, alerts show as a banner inside the app.</p>';
}

/**
 * Whole settings view (regions are patched in place after mount).
 * @param {object} state
 * @param {number} [now]
 * @returns {string}
 */
export function renderSettings(state, now = nowS()) {
  const n = N(state), nAlerts = state.liveLoaded ? activeAlerts(state, now).length : 0;
  return `<div class="st">
${feedbackHTML()}
<h3 class="v-h">Appearance</h3><div class="st-theme" data-region="theme"></div>
<h3 class="v-h">Location</h3><div data-region="loc">${locHTML(state)}</div>
${usageConfigured() ? `<h3 class="v-h">Usage statistics</h3><div data-region="usage">${usageHTML(state)}</div>` : ""}
<h3 class="v-h">Service alerts${nAlerts ? ` <span class="st-count">${nAlerts} active</span>` : ""}</h3><div data-region="alerts">${alertsHTML(state, now)}</div>
<h3 class="v-h">Bus alerts</h3><p class="v-sec st-intro">Notify me when my bus is near a station, and on a trip before my bus comes and before I get off. Times are estimates from live predictions.</p>${DEMO ? '<p class="v-foot v-foot--warn" role="note">Bus alerts are off in demo mode: the buses are simulated.</p>' : ""}
<div data-region="trip">${tripHTML(state, now)}</div>
<div data-region="station">${stationHTML(state)}</div><div data-region="opts">${optsHTML(state)}</div><div data-region="status">${statusHTML(state, now)}</div>
<div data-region="perm">${DEMO ? "" : permHTML()}</div>
<p class="v-sec st-note">${esc(ALERTS_NOTE)}</p>
<h3 class="v-h">iPhone app</h3><div class="v-card st-ios">${sw("liveActivity", "Trip status on lock screen", "Live Activity with a minute counter and next stop. Coming to the iPhone app; your choice is saved for later.", n.liveActivity)}</div>
<div class="v-card"><button type="button" class="v-row" data-action="about:open"><span class="v-grow"><span class="v-prim">About this app</span><span class="v-sec">Unofficial. Privacy, official contact</span></span></button></div>
${creditsHTML(false)}
</div>`;
}

/**
 * Settings > Credits (owner 2026-10-16: "At the very bottom of the settings menu, create a button that will expand a
 * list of Credits ... App made by blobberus; any APIs used or data sources used for the maps and the search function;
 * bus data collection source. Do not credit UChicago or the administration here."). Only what the web app really
 * uses (index.html, map/style.js, data/geocode.js, core/walk.js, tools/build_places.py, tools/build_gtfs.py); the
 * same facts as About's credits. iOS: SettingsView creditsSection. Each part: [text] or [text, url].
 */
export const CREDITS = Object.freeze([
  { group: "App", items: [[["App made by "], ["blobberus", "https://github.com/blobberus"], ["."]]] },
  { group: "Maps", items: [
    [["Map tiles and style: "], ["OpenFreeMap", "https://openfreemap.org"], [", in the "], ["OpenMapTiles", "https://openmaptiles.org/"], [" schema."]],
    [["Map data, streets, buildings and place names: "], ["OpenStreetMap", "https://www.openstreetmap.org/copyright"], [" contributors, ODbL."]],
    [["Backup map tiles, when the main map cannot load: "], ["OpenStreetMap", "https://www.openstreetmap.org/copyright"], [" tile servers."]],
    [["Map code: "], ["Leaflet", "https://leafletjs.com"], [" (BSD-2-Clause), "], ["MapLibre GL JS", "https://maplibre.org"], [" (BSD-3-Clause) and "],
      ["MapLibre GL Leaflet", "https://github.com/maplibre/maplibre-gl-leaflet"], [" (ISC)."]],
    [["Walking routes: "], ["OSRM", "https://project-osrm.org"], [" and "], ["Valhalla", "https://github.com/valhalla/valhalla"],
      [" servers run by "], ["FOSSGIS", "https://www.fossgis.de"], [", on OpenStreetMap data."]],
  ] },
  { group: "Search", items: [
    [["Places searched on your device: a list built from OpenStreetMap data with the "], ["Overpass API", "https://overpass-api.de"], ["."]],
    [["More places: "], ["Photon", "https://photon.komoot.io"], [" by komoot, on OpenStreetMap data."]],
  ] },
  { group: "Bus data", items: [
    [["Live bus positions, arrival predictions and service alerts: Passio's public GTFS-Realtime feeds."]],
    [["Routes, stops and timetables: Passio's public GTFS schedule."]],
    [["Data collection: the same public feeds, read every 10 seconds. Data research is currently in progress."]],   // owner 2026-10-16: no data repo link for now
  ] },
]);

/** One credit line: text through esc(), links in a new tab. */
const creditLine = (parts) => parts.map(([t, url]) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t))).join("");

/**
 * The last part of Settings: the Credits button and its list (collapsed unless open).
 * @param {boolean} [open]
 * @returns {string}
 */
export function creditsHTML(open = false) {
  const list = CREDITS.map((g) => `<p class="v-sec st-credh">${esc(g.group)}</p><ul class="v-plain v-sec st-credlist">${g.items.map((it) => `<li>${creditLine(it)}</li>`).join("")}</ul>`).join("");
  return `<div class="v-card st-credits"><button type="button" class="v-row st-credbtn" data-st="credits" aria-expanded="${open}" aria-controls="st-credits">`
    + `<span class="v-grow"><span class="v-prim">Credits</span><span class="v-sec">Maps, search and bus data sources</span></span><span class="v-chev st-credchev" aria-hidden="true">${icon("chevron", 18)}</span></button>`
    + `<div id="st-credits" class="st-credbody"${open ? "" : " hidden"}>${list}</div></div>`;
}

/* ---------------- mounted behavior ---------------- */

function patch(root, name, html) {
  const el = root.querySelector(`[data-region="${name}"]`);
  if (!el || el.innerHTML === html) return;
  const a = document.activeElement, key = el.contains(a) ? a?.dataset?.key : null;
  el.innerHTML = html;
  if (key) {
    const f = el.querySelector(`[data-key="${CSS.escape(key)}"]`) || root.querySelector('[data-region="station"] button, [data-region="station"] input');
    f?.focus({ preventScroll: true });
  }
}

function setNotify(ctx, change) {
  const s = ctx.store.get();
  ctx.store.set({ notify: cleanNotify({ ...N(s), ...change }) });
}

function onClick(e, root, ctx) {
  const b = e.target.closest?.("[data-st]");
  if (!b || !root.contains(b)) return;
  const s = ctx.store.get(), what = b.dataset.st;
  if (what === "pick") {
    ui.picking = false; ui.query = "";
    setNotify(ctx, { stopId: b.dataset.id, rids: [] });
    patch(root, "station", stationHTML({ ...s, notify: { ...N(s), stopId: b.dataset.id } }));
    root.querySelector('[data-key="change"]')?.focus({ preventScroll: true });
  } else if (what === "change") {
    ui.picking = true;
    patch(root, "station", stationHTML(s));
    root.querySelector("#st-q")?.focus({ preventScroll: true });
  } else if (what === "cancel") {
    ui.picking = false; ui.query = "";
    patch(root, "station", stationHTML(s));
    root.querySelector('[data-key="change"]')?.focus({ preventScroll: true });
  } else if (what === "off") {
    ui.picking = false;
    setNotify(ctx, { stopId: null, rids: [] });
    ctx.toast?.("Bus alerts turned off");
  } else if (what === "anyroute") setNotify(ctx, { rids: [] });
  else if (what === "loc-on") {
    // straight from the tap (iOS shows its permission prompt only for a user gesture)
    Promise.resolve(ctx.locate?.()).then((okv) => {
      patch(root, "loc", locHTML(ctx.store.get()));
      if (okv) ctx.toast?.("Sharing your location");
      else root.querySelector(".st-tried")?.scrollIntoView?.({ block: "nearest" });   // the result sits under the button, often off screen
    });
    patch(root, "loc", locHTML(ctx.store.get()));
  } else if (what === "loc-off") {
    ctx.stopLocation?.();
    patch(root, "loc", locHTML(ctx.store.get()));
    ctx.toast?.("Location sharing turned off");
  } else if (what === "credits") {   // expand / collapse in place: focus stays on the button, nothing stored
    const open = b.getAttribute("aria-expanded") !== "true", body = root.querySelector("#st-credits");
    b.setAttribute("aria-expanded", String(open));
    if (body) body.hidden = !open;
    if (open) body?.scrollIntoView?.({ block: "nearest" });
  } else if (what === "perm") {
    requestPermission().then((p) => { patch(root, "perm", permHTML(p)); if (p === "granted") ctx.toast?.("Notifications allowed"); });
  } else if (what === "usage-reset") {
    resetId();
    ctx.toast?.("Done. Your next visit uses a new random number.");
  }
}

function onChange(e, root, ctx) {
  const t = e.target, k = t?.dataset?.stIn;
  if (!k || k === "q") return;
  const s = ctx.store.get(), n = N(s);
  if (k === "rid") {
    const cur = new Set(watchedRoutes(s));
    if (t.checked) cur.add(t.dataset.id); else cur.delete(t.dataset.id);
    if (!cur.size) { t.checked = true; ctx.toast?.("Keep at least one route"); return; }
    setNotify(ctx, { rids: [...cur] });
  } else if (k === "minutes") setNotify(ctx, { minutes: Number(t.value) || 0 });
  else if (k === "usageDur" || k === "usageZone") ctx.store.set({ usage: cleanUsage({ ...cleanUsage(s.usage), [k === "usageDur" ? "dur" : "zone"]: !!t.checked }) });
  else if (k in n) setNotify(ctx, { [k]: !!t.checked });
}

/**
 * Mount: theme control, delegated listeners, store subscription that patches regions.
 * @param {Element} root
 * @param {object} ctx
 */
export function mountSettings(root, ctx) {
  ui.picking = !N(ctx.store.get()).stopId; ui.query = "";
  patch(root, "station", stationHTML(ctx.store.get()));
  const t = root.querySelector('[data-region="theme"]');
  try { if (t && !t.childElementCount) theme.mount(t); } catch (e) { /* theme optional */ }
  abort?.abort();
  abort = new AbortController();
  const sig = { signal: abort.signal };
  live = { root, ctx };
  root.addEventListener("click", (e) => onClick(e, root, ctx), sig);
  root.addEventListener("change", (e) => onChange(e, root, ctx), sig);
  root.addEventListener("input", (e) => {
    if (e.target?.dataset?.stIn !== "q") return;
    ui.query = e.target.value;
    patch(root, "results", resultsHTML(ctx.store.get(), ui.query));
  }, sig);
  offStore?.();
  offStore = ctx.store.subscribe((s, ch) => {
    const now = typeof ctx.now === "function" ? ctx.now() : nowS();
    const has = (...k) => !ch || k.some((x) => ch.has(x));
    if (has("alerts", "liveLoaded", "failed")) patch(root, "alerts", alertsHTML(s, now));
    if (has("user", "locState", "locErr", "usage")) patch(root, "loc", locHTML(s));
    if (has("usage")) patch(root, "usage", usageHTML(s));
    const typing = document.activeElement?.id === "st-q" && root.contains(document.activeElement);
    if (has("notify", "favStops", "user", "stops", "stopRoutes", "addresses") && !typing) patch(root, "station", stationHTML(s));
    if (has("notify", "stopRoutes", "routes", "hiddenRoutes", "journey")) patch(root, "opts", optsHTML(s));
    if (has("notify", "buses", "trips", "feedTs", "lastOk", "failed", "hiddenRoutes", "journey", "user")) patch(root, "status", statusHTML(s, now));
    if (has("notify", "buses", "trips", "feedTs", "lastOk", "failed", "journey", "user")) patch(root, "trip", tripHTML(s, now));
  });
}

/** Re-render the time-dependent regions (main.js calls refresh every 15 s so countdowns tick). */
export function refreshSettings() {
  if (!live || !live.root.isConnected) return;
  const s = live.ctx.store.get(), now = typeof live.ctx.now === "function" ? live.ctx.now() : nowS();
  patch(live.root, "status", statusHTML(s, now));
  patch(live.root, "trip", tripHTML(s, now));
  patch(live.root, "alerts", alertsHTML(s, now));
}

/** Stop the store subscription and listeners of the mounted settings content. */
export function unmountSettings() {
  offStore?.(); offStore = null; abort?.abort(); abort = null; live = null;
}

/** Content adapter for ui/settings-overlay.js. */
export const SETTINGS_CONTENT = Object.freeze({
  render: (state) => renderSettings(state),
  mount: (root, ctx) => mountSettings(root, ctx),
  unmount: () => unmountSettings(),
  refresh: () => refreshSettings(),
});

/**
 * Open the Settings overlay.
 * @param {object} ctx app ctx
 * @param {HTMLElement} [trigger] gets focus back on close (default: the gear)
 * @returns {HTMLElement} overlay root
 */
export function openSettings(ctx, trigger) {
  return openSettingsOverlay(ctx, SETTINGS_CONTENT, { trigger, title: "Settings", kind: "settings" });
}

// Compatibility shim: Settings is no longer a sheet view. Anything that still navigates to
// "settings" gets sent back where it came from and sees the overlay instead.
registerView("settings", {
  title: () => "Settings",
  parent: "nearby",
  render: () => "",
  mount: (root, ctx) => {
    setTimeout(() => {
      if (ctx.store.get().view === "settings") ctx.back();
      openSettings(ctx);
    }, 0);
  },
});

// The gear toggles the overlay.
registerAction("settings:open", (ds, ev, ctx) => {
  if (isSettingsOpen() && overlayKind() !== "settings") closeSettingsOverlay({ focus: "none" });   // Lines by Time: swap
  if (isSettingsOpen() && !ds?.section) return void closeSettingsOverlay();
  const o = isSettingsOpen() ? document.getElementById("settingsOverlay") : openSettings(ctx, ev?.target?.closest?.("[data-action]") || undefined);
  if (ds?.section) {   // e.g. Current trip's "How to allow location": open Settings at that section
    document.getElementById("toast")?.classList.add("hide");   // the "Still blocked" toast would cover the steps
    setTimeout(() => {
      const sec = o?.querySelector?.(`[data-region="${CSS.escape(ds.section)}"]`);
      sec?.scrollIntoView?.({ block: "start" });
      sec?.querySelector?.("button, summary")?.focus?.({ preventScroll: true });
    }, 60);
  }
});

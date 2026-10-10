/**
 * @module ui/views/settings
 * Settings content, shown in its own modal overlay (ui/settings-overlay.js), NOT in the sheet. The
 * top-right gear runs action `settings:open`, which opens (or closes) the overlay:
 * appearance (ui/theme.js mount), service alerts inline, bus alerts ("notify me when my bus is near
 * <station>": station, routes, 2 stops / 1 stop / N min; ONE alert each, a banner while the app is in front or a
 * system notification in the background when allowed, ui/notifier.js deliveryFor; wording as iOS SettingsView),
 * the iPhone-only Live Activity preference, and About. Owns its DOM after mount (regions patched in
 * place, focus kept) so the station search field and checkboxes never lose a tap or keystroke.
 * The router view id "settings" is kept only as a compatibility shim: navigating to it goes back and
 * opens the overlay instead (main.js VIEW_IDS still imports this file under that id).
 */
import { registerView } from "../router.js";
import { registerAction } from "../actions.js";
import * as theme from "../theme.js";
import { esc } from "../../core/esc.js";
import { nowS, clock } from "../../core/time.js";
import { nearestStops } from "../../core/geo.js";
import { activeAlerts, alertText, staleLevel } from "../../core/arrivals.js";
import { effectiveHidden } from "../../core/visibility.js";
import { liveStatus, watchedRoutes, minutesText, stopsAway } from "../../core/notify.js";
import { cleanNotify } from "../../state.js";
import { DEMO } from "../../core/demo.js";
import { routeChip, officialLinks } from "../components.js";
import { notificationSupport, requestPermission } from "../notifier.js";
import { openSettingsOverlay, closeSettingsOverlay, isSettingsOpen } from "../settings-overlay.js";

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
  const d = (t) => new Date(t * 1000);
  const day = (t) => d(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const same = (t) => d(t).toDateString() === d(now).toDateString();
  const f = (t) => (same(t) ? clock(t) : `${day(t)} ${clock(t)}`);
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
    return `<li class="st-alert"><span class="st-alertic" aria-hidden="true">!</span><div class="v-grow"><p class="v-prim">${esc(title)}</p>${body ? `<p class="v-sec">${esc(body)}</p>` : ""}${when ? `<p class="v-sec st-when">${esc(when)}</p>` : ""}</div></li>`;
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
  if (!n.stopId || !state.stops?.[n.stopId]) return "";
  const serve = (state.stopRoutes?.[n.stopId] || []).map(String);
  const hidden = new Set(effectiveHidden(state)), watched = new Set(watchedRoutes(state));
  let h = `<fieldset class="v-card st-routes"><legend class="v-sec st-label">Routes${n.rids.length ? "" : " (any visible route)"}</legend>`;
  h += serve.map((r) => `<label class="st-check"><input type="checkbox" data-st-in="rid" data-id="${esc(r)}" data-key="rid-${esc(r)}"${watched.has(r) ? " checked" : ""}>${routeChip(r, state.routes)}<span class="v-grow v-prim">${esc(state.routes?.[r]?.long || state.routes?.[r]?.short || r)}</span>${hidden.has(r) ? '<span class="v-sec">hidden</span>' : ""}</label>`).join("");
  if (n.rids.length) h += '<button type="button" class="v-btn v-btn--quiet" data-st="anyroute" data-key="anyroute">Use any visible route</button>';
  h += "</fieldset>";
  h += '<div class="v-card st-kinds">' + sw("twoStops", "2 stops away", "", n.twoStops) + sw("oneStop", "1 stop away", "Also when your stop is next", n.oneStop);
  h += `<label class="st-sel"><span class="v-grow v-prim">When the bus is</span><select data-st-in="minutes" data-key="in-minutes">${MINUTES.map((m) => `<option value="${m}"${n.minutes === m ? " selected" : ""}>${m ? `${m} min away` : "Off"}</option>`).join("")}</select></label>`;
  h += sw("inApp", "In-app alerts while open", "A banner at the top of the app", n.inApp) + "</div>";
  return h;
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
<h3 class="v-h">Appearance</h3><div class="st-theme" data-region="theme"></div>
<h3 class="v-h">Service alerts${nAlerts ? ` <span class="st-count">${nAlerts} active</span>` : ""}</h3><div data-region="alerts">${alertsHTML(state, now)}</div>
<h3 class="v-h">Bus alerts</h3><p class="v-sec st-intro">Notify me when my bus is near a station. Times are estimates from live predictions.</p>${DEMO ? '<p class="v-foot v-foot--warn" role="note">Bus alerts are off in demo mode: the buses are simulated.</p>' : ""}
<div data-region="station">${stationHTML(state)}</div><div data-region="opts">${optsHTML(state)}</div><div data-region="status">${statusHTML(state, now)}</div>
<div data-region="perm">${permHTML()}</div>
<p class="v-sec st-note">${esc(ALERTS_NOTE)}</p>
<h3 class="v-h">iPhone app</h3><div class="v-card st-ios">${sw("liveActivity", "Trip status on lock screen", "Live Activity with a minute counter and next stop. Coming to the iPhone app; your choice is saved for later.", n.liveActivity)}</div>
<div class="v-card"><button type="button" class="v-row" data-action="about:open"><span class="v-grow"><span class="v-prim">About this app</span><span class="v-sec">Unofficial. Privacy, official contact</span></span></button></div>
</div>`;
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
  else if (what === "perm") {
    requestPermission().then((p) => { patch(root, "perm", permHTML(p)); if (p === "granted") ctx.toast?.("Notifications allowed"); });
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
    const typing = document.activeElement?.id === "st-q" && root.contains(document.activeElement);
    if (has("notify", "favStops", "user", "stops", "stopRoutes", "addresses") && !typing) patch(root, "station", stationHTML(s));
    if (has("notify", "stopRoutes", "routes", "hiddenRoutes", "journey")) patch(root, "opts", optsHTML(s));
    if (has("notify", "buses", "trips", "feedTs", "lastOk", "failed", "hiddenRoutes", "journey")) patch(root, "status", statusHTML(s, now));
  });
}

/** Re-render the time-dependent regions (main.js calls refresh every 15 s so countdowns tick). */
export function refreshSettings() {
  if (!live || !live.root.isConnected) return;
  const s = live.ctx.store.get(), now = typeof live.ctx.now === "function" ? live.ctx.now() : nowS();
  patch(live.root, "status", statusHTML(s, now));
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
  return openSettingsOverlay(ctx, SETTINGS_CONTENT, { trigger });
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
  if (isSettingsOpen()) return void closeSettingsOverlay();
  openSettings(ctx, ev?.target?.closest?.("[data-action]") || undefined);
});

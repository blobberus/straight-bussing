/**
 * @module main
 * Wiring + boot (D1). Order: theme -> map -> sheet -> router/actions -> views -> loadStatic -> startLive.
 * Owns the render loop (header, status pill via ui/pill.js, content), the map context bar, map sync on store
 * changes, geolocation (ctx.locate) + the heading cone (ui/compass.js), Escape/back + browser history, toasts and the
 * global error handler.
 * Demo mode (core/demo.js, `?demo=1` only): the simulated feed replaces the live one (ui/demo.js startDemo); the
 * status pill says "Simulated buses" (no banner, 2026-10-11); no service worker, no bus alerts, nothing stored.
 */
import { store } from "./state.js";
import { bus } from "./core/events.js";
import { nowS } from "./core/time.js";
import { hav } from "./core/geo.js";
import { DEMO } from "./core/demo.js";
import { mapVisibility, lineTapOpens } from "./core/visibility.js";
import { settleTimeView } from "./core/custom.js";
import { busKey, selectedBus, pickCheck } from "./core/busnum.js";
import { createMap } from "./map/map.js";
import { loadStatic } from "./data/static.js";
import { startLive } from "./data/live.js";
import { createSheet } from "./ui/sheet.js";
import { initRouter, navigate, back, getView, activeTab, canGoBack, TABS, depth } from "./ui/router.js";
import { registerAction, bindActions, setHTMLKeepFocus } from "./ui/actions.js";
import { initTheme, isDark, onChange as onThemeChange } from "./ui/theme.js";
import { emptyState } from "./ui/components.js";
import { createPill } from "./ui/pill.js";
import { registerContextActions, mountContextBar } from "./ui/contextbar.js";
import { initFrame, initTextSize, initGlassLite } from "./ui/frame.js";
import { isSettingsOpen, closeSettingsOverlay } from "./ui/settings-overlay.js";
import { startTripMap } from "./ui/tripmap.js";
import { createCompass, mayAskCompass } from "./ui/compass.js";

/** Every view module; each calls registerView() at import time ("timepick" only registers its actions: Lines by Time is an overlay). */
export const VIEW_IDS = Object.freeze(["nearby", "stop", "routes", "route", "alerts", "about", "pick", "directions", "myroutes", "settings", "timepick"]);
/** Views that may not be deployed yet: a failed import is a warning, not an error. */
const OPTIONAL_VIEWS = new Set(["settings", "timepick"]);
const RENDER_TICK_MS = 15000;
const MAP_METHODS = ["setTheme", "setBottomInset", "drawNetwork", "drawBuses", "setSelectedStop", "setUser", "setHeading",
  "highlightStops", "drawPlan", "drawFavorites", "setTrip", "inView", "setLandmarks", "fitTo", "flyTo", "onStopTap", "onBusTap", "onLineTap", "onUserMove", "onMapTap"];
const VIS_KEYS = ["hiddenRoutes", "routeFilter", "view", "routeId", "routeOrder", "journey", "activeCustom", "customRoutes"];
const NET_KEYS = ["routes", "shapes", "routeStops", "stopRoutes", "stops", "theme", ...VIS_KEYS];
const BUS_KEYS = ["buses", "feedTs", "routes", "busId", ...VIS_KEYS];

const $ = (id) => document.getElementById(id);
const el = {
  sheet: $("sheet"), head: $("sheetHead"), grab: $("grab"), content: $("content"), title: $("title"), sub: $("subtitle"),
  right: $("titleRight"), back: $("back"), tabs: $("tabs"), ctxbar: $("ctxbar"), gear: $("settingsBtn"), topbar: $("topbar"), app: $("app"),
  pill: $("pill"), pillText: $("pillText"), pillRetry: $("pillRetry"), dlg: $("dlg"), toast: $("toast"), locate: $("locateBtn"),
  bottomrow: $("bottomrow"), mapctl: $("mapctl"),
};
const bootS = nowS();
let map = null, sheet = null, live = null, ctx = null, notifier = null, tripMap = null;
const pill = createPill({ pill: el.pill, text: el.pillText, retry: el.pillRetry, app: el.app }, { bootS, demo: DEMO });

/* ---------------- toast + global errors ---------------- */
let toastTimer = 0;
/** Show a short non-blocking message. @param {string} text */
function toast(text) {
  if (!text) return;
  el.toast.textContent = String(text);
  el.toast.classList.remove("hide");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add("hide"), 3000);   // spec 10.19: 3 s (no web toast carries an action)
}
let lastErrToast = 0;
function reportError(err) {
  if (!err) return;
  const msg = String(err.message || err);
  if (err.name === "AbortError" || /ResizeObserver loop|aborted/i.test(msg)) return;
  console.error("[app]", err);
  if (Date.now() - lastErrToast < 10000) return;
  lastErrToast = Date.now();
  toast("Something went wrong. The app keeps running; reload if it looks stuck.");
}
window.addEventListener("error", (e) => {
  if (e.target && e.target !== window) return; // failed <img>/<link> loads are not app errors
  reportError(e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => reportError(e.reason));

/* ---------------- map (with a no-op fallback) ---------------- */
function nullMap() {
  const m = {};
  for (const k of MAP_METHODS) m[k] = k.startsWith("on") ? () => () => {} : () => {};
  return m;
}
function mapCall(name, ...args) {
  try { return map && typeof map[name] === "function" ? map[name](...args) : undefined; } catch (e) { console.error("map." + name, e); }
}
function syncMap(s, changed) {
  const has = (k) => !changed || changed.has(k);
  const { hidden, focus, order } = mapVisibility(s);   // journey > custom route / hidden list; see core/visibility.js
  if (NET_KEYS.some(has)) mapCall("drawNetwork", { routes: s.routes, shapes: s.shapes, routeStops: s.routeStops,
    stopRoutes: s.stopRoutes, stops: s.stops, hidden, focus, order, dark: isDark() });
  if (BUS_KEYS.some(has)) mapCall("drawBuses", s.buses || [], { routes: s.routes, shapes: s.shapes, hidden, focus, nowS: nowS(),
    selected: busKey(selectedBus(s)) });   // the bus picked on the route page is highlighted
  if (has("view") || has("stopId") || has("stops")) {
    const st = s.view === "stop" && s.stopId && s.stops ? s.stops[s.stopId] : null;
    mapCall("setSelectedStop", st ? { id: s.stopId, lat: st.lat, lon: st.lon } : null);
  }
  if (has("favStops") || has("stops")) mapCall("drawFavorites",
    (s.favStops || []).map((id) => (s.stops && s.stops[id] ? { id: String(id), ...s.stops[id] } : null)).filter(Boolean));
  if (has("user")) mapCall("setUser", s.user || null);
  if (has("landmarks")) mapCall("setLandmarks", s.landmarks || []);
}

/* ---------------- geolocation ---------------- */
let locating = null, watchId = null;
// the way the rider faces, straight to the map (never the store: up to 60 readings a second); on while sharing is on
const compass = createCompass({ onHeading: (deg, spread) => mapCall("setHeading", deg, spread) });
/**
 * Ask for the compass (iOS Safari's "Motion & Orientation Access" prompt) from a tap, only when it can be the tap's
 * ONE system prompt (owner 2026-11-02: "two requests for locations ... can be completed with one notification to the
 * user, do so"): location is already granted and working, so no location prompt can show in the same tap
 * (ui/compass.js mayAskCompass). The first share / locate tap shows the location prompt alone; a later locate tap may
 * show the motion prompt alone.
 * Decided from the store, synchronously, before any await: iOS accepts requestPermission() only inside the tap.
 */
function askCompass() {
  if (mayAskCompass(store.get().locState)) compass.request();
}
/**
 * The first tap anywhere in the app once location works also asks (owner 2026-11-04: "The build no longer shows the
 * user heading. Allow the app to display user heading."): since 2026-11-02 the location tap itself never asks, and
 * riders rarely tap the locate button a second time, so the cone never appeared. That tap's only system prompt is the
 * motion one (location already works). Once per page load; a request that failed (not counted as a tap) lets the next
 * tap try again. iOS keeps the answer for the session, so a later load usually asks without a prompt.
 */
let compassTapAsked = false;
function askCompassOnTap() {
  if (compassTapAsked || !mayAskCompass(store.get().locState)) return;
  compassTapAsked = true;
  compass.request().then((r) => { if (r === "error") compassTapAsked = false; });
}
const LOC_OFF = "sb-loc-off";   // the rider chose Stop sharing in Settings: no automatic location at the next launch
const locOptOut = () => { try { return localStorage.getItem(LOC_OFF) === "1"; } catch (e) { return false; } };
/** Settings > Stop sharing: forget the position, stop watching, remember the choice. */
function stopLocation() {
  try { if (watchId !== null) navigator.geolocation.clearWatch(watchId); } catch (e) { /* */ }
  watchId = null;
  compass.stop();
  try { localStorage.setItem(LOC_OFF, "1"); } catch (e) { /* private mode */ }
  store.set({ user: null, locState: "off" });
}
function startWatch() {
  if (watchId !== null || !navigator.geolocation || !navigator.geolocation.watchPosition) return;
  try {
    watchId = navigator.geolocation.watchPosition((p) => {
      compass.course(p.coords);   // the GPS course, when no compass reads (walking or riding)
      const u = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
      const cur = store.get().user;
      if (!cur || hav(cur, u) > 15) store.set({ user: u, locState: "granted" });
    }, () => {}, { enableHighAccuracy: true, maximumAge: 20000 });
  } catch (e) { watchId = null; }
}
/**
 * Ask for the device location. Sets store.user / store.locState. Never throws. A tap (every caller but the launch,
 * which passes {auto: true}) also asks for the compass, but only when location already works (askCompass: never two
 * system prompts from one tap; iOS shows the compass only after a permission asked inside a tap).
 * @param {{auto?:boolean}} [opts]
 * @returns {Promise<boolean>} true when a position was obtained
 */
function locate(opts) {
  if (!(opts && opts.auto)) askCompass();   // reads locState before this call changes it to "asking"
  if (locating) return locating;
  locating = new Promise((resolve) => {
    const prev = store.get().locState;
    let done = false;
    // a failed attempt: code + time + how many failed in a row, so two taps in the same minute still read differently
    const failed = (code) => ({ code, at: Date.now(), n: ((store.get().locErr && store.get().locErr.n) || 0) + 1 });
    const finish = (okv, patch) => {
      if (done) return;
      done = true;
      if (patch) store.set(patch);
      locating = null;
      resolve(okv);
    };
    if (!navigator.geolocation) return finish(false, { locState: "denied", locErr: failed(1) });
    try { localStorage.removeItem(LOC_OFF); } catch (e) { /* private mode */ }   // asked for again: sharing is on
    store.set({ locState: "asking" });
    const guard = setTimeout(() => finish(false, { locState: prev === "asking" ? "unknown" : prev, locErr: failed(3) }), 15000);
    try {
      navigator.geolocation.getCurrentPosition((p) => {
        clearTimeout(guard);
        finish(true, { user: { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }, locState: "granted", locErr: null });
        compass.start();
        compass.course(p.coords);
        startWatch();
      }, (err) => {
        clearTimeout(guard);
        const denied = err && err.code === 1;
        if (!denied) toast("Couldn't get your location. You can still pick a station.");
        // every attempt leaves a visible result (Settings > Location, Current trip): a blocked site fails at once, no popup
        finish(false, { locState: denied ? "denied" : prev === "granted" ? "granted" : "unknown", locErr: failed((err && err.code) || 0) });
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
    } catch (e) { clearTimeout(guard); finish(false, { locState: "unknown", locErr: failed(0) }); }
  });
  return locating;
}
async function onLocateFab() {
  askCompass();   // inside the tap, before any await (a trip with a known position never calls locate)
  if (tripMap?.active?.()) {   // during a trip: show you in the trip again (follow), asking for the location if unknown
    tripMap.recenter();
    const s = store.get();
    if (!s.user && s.locState !== "denied") { el.locate.setAttribute("aria-busy", "true"); const okv = await locate(); el.locate.removeAttribute("aria-busy"); if (okv) tripMap.recenter(); }
    return;
  }
  el.locate.setAttribute("aria-busy", "true");
  const okv = await locate();
  el.locate.removeAttribute("aria-busy");
  const s = store.get();
  if (okv && s.user) mapCall("flyTo", s.user, 16);
  else if (s.locState === "denied") toast("Location is off. Turn it on in your browser or phone settings to see stops near you.");
}

/* ---------------- header ---------------- */
function safe(fn, fallback) {
  try { return fn() ?? fallback; } catch (e) { console.error(e); return fallback; }
}
let rightHTML = null;
function renderHeader(s, id, def) {
  const o = { detent: sheet && sheet.getDetent ? sheet.getDetent() : "peek" };   // the header may differ collapsed / expanded
  const title = def ? String(safe(() => def.title(s, o), "")) : "Current trip";
  if (el.title.textContent !== title) el.title.textContent = title;
  // a second line under the title (a trip in progress: the current step is the title, the trip under it; spec 10.6, O3)
  const sub = def && def.subtitle ? String(safe(() => def.subtitle(s, o), "")) : "";
  if (el.sub && el.sub.textContent !== sub) el.sub.textContent = sub;
  el.title.classList.toggle("is-step", !!sub);
  if (el.app && el.app.dataset.view !== id) el.app.dataset.view = id || "";   // css: hide the search bar in Directions
  el.title.classList.toggle("sm", !TABS.includes(id));
  if (el.back.hidden !== !canGoBack()) el.back.hidden = !canGoBack();   // render() runs on every store change: write only changes
  // trailing slot: one summary or one action (spec 10.6). metaHTML = trusted markup built with esc() (badge + ETA + live
  // dot, Arriving In, an action button); else the plain-text meta
  if (def && def.metaHTML) {
    const h = String(safe(() => def.metaHTML(s, o), ""));
    if (h !== rightHTML) { rightHTML = h; el.right.innerHTML = h; }
  } else {
    rightHTML = null;
    const metaFn = def && (def.meta || def.peek);
    const right = metaFn ? String(safe(() => metaFn(s), "")) : "";
    if (el.right.textContent !== right || el.right.children.length) el.right.textContent = right;
  }
  const tab = activeTab(s);
  const tabBtns = [...el.tabs.querySelectorAll("button[data-tab]")], ti = tabBtns.findIndex((b) => b.dataset.tab === tab);
  // the selection capsule (glass spec 8.6) slides to the selected item: transform only (css/base.css .tab-pill)
  if (ti >= 0 && el.tabs.style.getPropertyValue("--tab-i") !== String(ti)) el.tabs.style.setProperty("--tab-i", String(ti));
  for (const b of tabBtns) {
    const on = b.dataset.tab === tab;
    if (on === (b.getAttribute("aria-current") === "page") && on === b.classList.contains("on")) continue;
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    b.classList.toggle("on", on);
  }
}

/* ---------------- content render loop ---------------- */
let cur = { def: null, id: null, key: "", html: null };
let dirty = false;
const inputFocused = () => {
  const a = document.activeElement;
  return !!a && el.content.contains(a) && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
};
function renderView(def, s) {
  if (typeof def.render !== "function") return "";
  try { return String(def.render(s) ?? ""); } catch (e) {
    console.error("render " + cur.id, e);
    return emptyState("Couldn't show this screen", "Try going back. Live times may still be available on other tabs.", { official: true, kind: "error" });
  }
}
/**
 * The content's transition on a view switch (DESIGN-SPEC 9, mStandard): a push slides the new view in 16 pt from the
 * trailing edge with a fade, Back reverses it, a section switch crossfades; reduced motion = a 150 ms crossfade. Transform
 * and opacity only, on the content scroller, never during a drag.
 */
let lastDepth = 0;
function animateSwitch(prevDef) {
  const d = depth(), dir = !prevDef ? "" : d > lastDepth ? "push" : d < lastDepth ? "pop" : "swap";
  lastDepth = d;
  if (!dir || typeof el.content.animate !== "function" || el.sheet.classList.contains("dragging")) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const x = reduce || dir === "swap" ? 0 : dir === "push" ? 16 : -16;
  try {
    el.content.animate([{ opacity: 0, transform: `translateX(${x}px)` }, { opacity: 1, transform: "none" }],
      { duration: reduce || dir === "swap" ? 150 : 250, easing: "cubic-bezier(.2, 0, 0, 1)" });
  } catch (e) { /* animation optional */ }
}
function switchView(id, def, key, s) {
  const prev = cur.def;
  animateSwitch(prev);
  const focusWasInside = el.content.contains(document.activeElement) || document.activeElement === document.body;
  if (prev && typeof prev.unmount === "function") safe(() => prev.unmount(), null);
  cur = { def, id, key, html: null };
  dirty = false;
  const html = renderView(def, s);
  el.content.innerHTML = html;
  cur.html = html;
  el.content.scrollTop = 0;
  setTabsMin(false);   // a new page starts at its top: the tab bar comes back (glass spec 8.9)
  if (typeof def.mount === "function") {
    try { def.mount(el.content, ctx); } catch (e) {
      console.error("mount " + id, e);
      el.content.innerHTML = emptyState("Couldn't show this screen", "Try going back.", { official: true, kind: "error" });
    }
  }
  if (prev && focusWasInside && !el.content.contains(document.activeElement)) el.title.focus({ preventScroll: true });
}
let renderQueued = false;
/* Render after the current store flush, so views unmounted by a view switch never get a late callback. */
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => { renderQueued = false; render(); });
}
/** Re-render only the sheet header (a view's own state changed, e.g. Directions picked another option). */
function refreshHeader() {
  const s = store.get();
  let id = s.view, def = getView(id);
  if (!def && getView("nearby")) def = getView((id = "nearby"));
  renderHeader(s, id, def);
}
/** The locate button shows the filled glyph while it means "following you" (spec 10.4): during a trip while the camera
 * follows you, otherwise once your location is known (iOS LocateButton). */
function renderLocate(s) {
  const on = tripMap?.active?.() ? !!tripMap.following?.() : !!s.user;
  if (el.locate && el.locate.classList.contains("is-on") !== on) el.locate.classList.toggle("is-on", on);
}
/** Render header, pill and content for the current state. Cheap; safe to call often. */
function render() {
  const s = store.get();
  const now = nowS();
  let id = s.view, def = getView(id);
  if (!def && getView("nearby")) def = getView((id = "nearby"));
  renderHeader(s, id, def);
  pill.render(s, now);
  renderLocate(s);
  if (!def) return;
  const key = id + "|" + (s.stopId || "") + "|" + (s.routeId || "");
  if (def !== cur.def || (def.mount && key !== cur.key)) return switchView(id, def, key, s);
  // Views with mount() own their DOM (store subscription + patches): a rebuild here would replace a button mid-tap.
  if (def.mount) return;
  if ((dirty = inputFocused())) return;
  const html = renderView(def, s);
  const keyChanged = key !== cur.key;
  cur.key = key;
  if (html === cur.html) return;
  const top = el.content.scrollTop;
  setHTMLKeepFocus(el.content, html);   // live re-render (stop, route detail): keyboard focus stays on its button
  cur.html = html;
  el.content.scrollTop = keyChanged ? 0 : top;
}

/* ---------------- browser back (one history entry while in a sub view or while Settings is open) ---------------- */
let pushed = false, ignorePop = false;
function syncHistory() {
  const sub = canGoBack() || isSettingsOpen();
  try {
    if (sub && !pushed) { history.pushState({ sb: 1 }, ""); pushed = true; }
    else if (!sub && pushed) { pushed = false; ignorePop = true; history.back(); }
  } catch (e) { /* history unavailable (sandboxed iframe) */ }
}
window.addEventListener("popstate", () => {
  if (ignorePop) return void (ignorePop = false);
  pushed = false;
  if (isSettingsOpen()) { closeSettingsOverlay(); syncHistory(); return; }   // back closes Settings, not the screen under it
  if (canGoBack()) back();
});

/* ---------------- input wiring ---------------- */
function wireUI() {
  el.back.addEventListener("click", () => back());
  el.tabs.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    if (el.app.classList.contains("tabs-min")) {   // minimized: the circle brings the capsule back (glass spec 8.9)
      setTabsMin(false);
      if (b.getAttribute("aria-current") === "page") return;
    }
    navigate(b.dataset.tab);
  });
  // a keyboard user who tabs into the bar gets every section back
  el.tabs.addEventListener("focusin", (e) => { try { if (e.target.matches(":focus-visible")) setTabsMin(false); } catch (err) { /* old browser */ } });
  el.content.addEventListener("scroll", onContentScroll, { passive: true });
  el.locate.addEventListener("click", onLocateFab);
  document.addEventListener("click", askCompassOnTap, true);   // capture: before any handler, synchronously in the tap
  for (const root of [el.content, el.pill, el.dlg, el.ctxbar, el.topbar || el.gear, el.right, el.bottomrow, el.mapctl]) if (root) bindActions(root, () => ctx);
  el.dlg.addEventListener("click", (e) => { if (e.target === el.dlg) closeDlg(); });
  el.content.addEventListener("focusout", () => setTimeout(() => { if (dirty && !inputFocused()) render(); }, 0));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (!el.dlg.hidden) return void (closeDlg(), e.preventDefault());
    if (document.querySelector("dialog[open]")) return; // native dialogs close themselves
    const a = document.activeElement;
    // a search field with text clears first (its view or the browser does that); a plain text field never clears on
    // Escape, so there Escape goes on to Back (QA 2026-11-05: in Directions a typed destination kept Escape from leaving)
    if (a && a.tagName === "INPUT" && a.type === "search" && a.value) return;
    if (back() || sheet.stepDown()) e.preventDefault();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
}
/* ---------------- tab bar minimize (glass spec 8.9, Q3; the iPhone app's SheetScroll, same numbers) ----------------
   While the expanded sheet's content scrolls down past 24 px, the tab capsule shrinks to a 56 glass circle with the
   selected section's glyph at the leading side; scrolling back up 16 px, reaching the top, a tap on the circle, a new
   page or tab, a collapse, or keyboard focus on the bar brings it back. The offset is clamped to the content's end, so
   the bounce at the bottom is not a turn. css/base.css #app.tabs-min draws it (transform and opacity only). */
let minTurn = 0;
function onContentScroll() {
  const c = el.content, end = Math.max(0, c.scrollHeight - c.clientHeight), y = Math.min(Math.max(0, c.scrollTop), end);
  const on = el.app.classList.contains("tabs-min");
  if (y <= 24 || !sheet || sheet.isPanel() || sheet.getDetent() !== "full") { minTurn = y; if (on) setTabsMin(false); return; }
  if (on) {
    minTurn = Math.max(minTurn, y);
    if (y < minTurn - 16) { setTabsMin(false); minTurn = y; }
  } else {
    minTurn = Math.min(minTurn, y);
    if (y > minTurn + 16) { setTabsMin(true); minTurn = y; }
  }
}
/** The tab bar's minimized circle on or off; the names stay in the accessible names either way. */
function setTabsMin(on) {
  if (!el.app || el.app.classList.contains("tabs-min") === !!on) return;
  el.app.classList.toggle("tabs-min", !!on);
  for (const b of el.tabs.querySelectorAll("button[data-tab]")) {
    const sel = b.getAttribute("aria-current") === "page";
    if (on && sel) b.setAttribute("aria-label", (b.querySelector(".bn-label")?.textContent || "") + ", show all sections");
    else b.removeAttribute("aria-label");
  }
}
function closeDlg() {
  el.dlg.hidden = true;
  bus.emit("dialog:close", {});
}

/* Generic actions (views may override any of these by registering the same name). */
function registerCoreActions() {
  const fb = { fallback: true };
  registerAction("stop", (ds) => openStop(ds.id), fb);
  registerAction("route", (ds) => openRoute(ds.id), fb);
  registerAction("nav", (ds) => navigate(ds.view, { stopId: ds.stopId, routeId: ds.routeId, detent: ds.detent }), fb);
  registerAction("back", () => back(), fb);
  registerAction("locate", () => locate(), fb);
  registerAction("retry", () => (live ? live.pollNow() : undefined), fb);
  registerAction("detent", (ds) => sheet.setDetent(ds.id), fb);
}
/* Open a stop / route (the sheet goes to the view's detent). Only choosing a route frames the map: stop and
   bus taps keep the user's map view (owner request 2026-10-09). */
function openStop(id) {
  if (id && store.get().stops[id]) navigate("stop", { stopId: String(id) });
}
function openRoute(rid, fit = true) {
  const s = store.get();
  if (!rid || !s.routes[rid] || !navigate("route", { routeId: String(rid) })) return;
  const pts = fit ? (s.shapes[rid] || []).flat() : [];
  if (pts.length) mapCall("fitTo", pts, { maxZoom: 16 });
}

/* ---------------- boot ---------------- */
async function boot() {
  initTheme(store);
  initFrame();
  initTextSize();
  initGlassLite({ targets: [document.getElementById("map"), el.head] });   // glass spec 12.4: solid glass on a slow device
  try {
    if (!window.L) throw new Error("Leaflet not loaded");
    map = createMap("map", { dark: isDark() });   // the theme from the start: a dark launch loads only the dark basemap
  } catch (e) {
    console.warn("map unavailable", e);   // handled: lists and times work, the toast says so
    map = nullMap();
    document.documentElement.classList.add("nomap");
    setTimeout(() => toast("Couldn't load the map. Lists and times still work."), 0);
  }
  mapCall("setTheme", isDark());
  // the map is visible above the collapsed card (its px already counts the floating bottom row, glass spec 3); while it
  // is collapsed, fits and the follow camera also keep clear of the lower-right group riding on it (44 x 88 + 8)
  bus.on("sheet:inset", (p) => mapCall("setBottomInset", (p && p.px) || 0, p && p.px && p.detent === "peek" && el.mapctl ? el.mapctl.offsetHeight + 8 : 0));
  bus.on("toast", (p) => toast(p && p.text));
  bus.on("sheet:header", () => refreshHeader());
  bus.on("settings:toggle", () => syncHistory());   // Settings overlay opened / closed (ui/settings-overlay.js)
  sheet = createSheet({ sheetEl: el.sheet, contentEl: el.content, headEl: el.head, grabEl: el.grab });
  // collapsing the sheet puts the keyboard away (owner 2026-10-12): blur a focused field in the app
  sheet.onChange((d) => {
    refreshHeader();
    if (d !== "full") setTabsMin(false);   // a collapsed sheet has no scrolled list: the tab bar comes back
    const a = document.activeElement;
    if (d === "peek" && a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && el.app?.contains?.(a)) a.blur();
  });
  initRouter({ store, setDetent: sheet.setDetent, getDetent: sheet.getDetent });
  ctx = { store, map, navigate, back, setDetent: (d) => sheet.setDetent(d), toast, now: nowS, locate, stopLocation };
  wireUI();

  mapCall("onStopTap", (x) => {
    const id = x && typeof x === "object" ? x.id : x;
    const def = getView(store.get().view);
    if (def && typeof def.onStopTap === "function" && safe(() => def.onStopTap(String(id), ctx), false)) return;
    openStop(id);
  });
  // a bus tap opens its route with THAT bus picked: the route page shows its own time at each station (owner 2026-10-30)
  mapCall("onBusTap", (x) => {
    const rid = x && typeof x === "object" ? x.rid || x.routeId || (x.trip && x.trip.route_id) : x;
    openRoute(rid, false);
    if (x && typeof x === "object" && x.id != null && store.get().view === "route") store.set({ busId: String(x.id) });
  });
  const lowerSheet = () => { if (!sheet.isPanel() && sheet.getDetent() !== "peek") sheet.setDetent("peek"); };
  mapCall("onMapTap", lowerSheet);   // tap outside the sheet: back to the map
  // a tap on a route line opens the line drawn on top, as choosing it in the Routes list does (owner 2026-10-27);
  // a pointer shortcut only (the Routes list stays the accessible way); off where the map shows a trip
  mapCall("onLineTap", (rid) => (lineTapOpens(store.get()) ? openRoute(String(rid)) : lowerSheet()));
  onThemeChange((d) => { mapCall("setTheme", d); syncMap(store.get(), null); });

  // data first: stops, routes and the live feed load while the view modules download (slow 4G: next bus ~3 s sooner)
  loadStatic(store).catch((e) => { console.error("static data", e); toast("Couldn't load stops and routes. Check your connection."); });
  if (DEMO) {   // simulated buses only: the live feed is never fetched in a demo session
    import("./ui/demo.js").then((m) => { live = m.startDemo(store, startLive); }).catch(reportError);   // + action demo:info (the pill)
  } else live = startLive(store, { intervalMs: 10000, keepAlive: () => !!notifier?.background?.() });   // bus alerts: also in a background tab
  const results = await Promise.allSettled(VIEW_IDS.map((v) => import(`./ui/views/${v}.js`)));
  results.forEach((r, i) => r.status === "rejected" && (OPTIONAL_VIEWS.has(VIEW_IDS[i]) ? console.warn : console.error)("view " + VIEW_IDS[i] + " failed to load", r.reason));
  registerCoreActions();
  registerContextActions();
  mountContextBar(el.ctxbar, store);

  store.subscribe((s, changed) => { syncMap(s, changed); scheduleRender(); syncHistory(); });
  // the picked bus goes when the rider leaves its route page, or when it has been missing from the feed for PICK_HOLD_S
  // (a bus left out of one or two polls keeps its pick, as the map keeps its badge); then back to the next bus at each stop
  let pickGone = 0;
  store.subscribe((s) => { const r = pickCheck(s, pickGone, nowS()); pickGone = r.goneSince; if (r.clear) store.set({ busId: null }); });
  // Lines by Time: the moment the shown lines change (one deselected or added), the "Lines active at" name goes and the lines stay
  store.subscribe((s, changed) => { if (s.timeView && (!changed || changed.has("hiddenRoutes") || changed.has("routes"))) { const p = settleTimeView(s); if (Object.keys(p).length) store.set(p); } });
  render();
  syncMap(store.get(), null);
  tripMap = startTripMap(store, map);   // you in the started trip + follow camera (same evaluation as the card and alerts)
  // the feedback circle under Settings, until the rider gives feedback or silences it (owner 2026-11-02; glass spec Q7,
  // owner 2026-11-04); the only feedback prompt since the beta welcome popup was removed (owner 2026-11-04)
  import("./ui/feedback-button.js").then((m) => m.startFeedbackButton({ store, ctx })).catch((e) => console.warn("feedback button", e));
  // anonymous usage statistics (owner 2026-10-27; data/usage.js): nothing at all until a receiver is set, never in demo mode
  if (!DEMO) import("./data/usage.js").then((m) => m.usageConfigured() && import("./ui/views/about.js").then((a) => m.startUsage(store, { ver: a.APP_VERSION })))
    .catch((e) => console.warn("usage statistics", e));
  if (!DEMO) import("./ui/notifier.js").then((m) => { notifier = m.startNotifier?.(store, { toast }) || null; }).catch(() => {});   // bus-near alerts while the page is open

  setInterval(() => {
    if (document.hidden) return;
    render();
    if (cur.def && cur.def.mount && typeof cur.def.refresh === "function") safe(() => cur.def.refresh(), null);
    syncMap(store.get(), new Set(["buses"]));
    tripMap?.sync();
  }, RENDER_TICK_MS);

  try {
    if (navigator.permissions && navigator.permissions.query) {
      const p = await navigator.permissions.query({ name: "geolocation" });
      if (p.state === "granted" && !locOptOut()) locate({ auto: true });
      else if (p.state === "denied") store.set({ locState: "denied" });
    }
  } catch (e) { /* permissions API unsupported */ }

  if (!DEMO && "serviceWorker" in navigator && (location.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
    import("./ui/update.js").then((m) => m.startUpdates()).catch((e) => console.warn("service worker", e));   // register + update on foreground
  }
}

boot().catch(reportError);

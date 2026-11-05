/**
 * @module ui/settings-overlay
 * The Settings overlay (SETTINGS): an iOS sheet that is separate from the sheet router (docs/DESIGN-SPEC-GLASS.md 9.8):
 * a card from 10 below the safe area to the screen's bottom, top corners 28, bgSheet, over a scrim that dims everything
 * behind it (map, the app's own sheet, the glass controls, the bottom row); the app's sheet keeps its state and, with
 * the rest of the app, is inert while it is open. It zooms out of the button that opened it (mZoomSheet: scale from
 * .6 with the button's center as the origin) and shrinks back into it. Closes on Done (a tinted checkmark circle named
 * "Done"), Escape, a tap on the scrim, a swipe down on its header (HIG: Done needs an alternative), the gear
 * (programmatic toggle), any navigation (e.g. About) and the browser's back (main.js keeps a history entry while it is
 * open; bus 'settings:toggle'). Accessible modal: role="dialog" aria-modal="true", focus moves to the heading, Tab is
 * trapped inside, focus returns to the opener (the gear) on close.
 *
 * The DOM is created from JS and appended to #app, so on desktop it lives inside the scaled iPhone frame (ui/frame.js).
 * Content is supplied by the caller (ui/views/settings.js): {render(state), mount(root, ctx), unmount(), refresh()}.
 * The same shell hosts Lines by Time (ui/views/timepick.js, owner 2026-10-18: "a separate menu that looks like the
 * settings menu"): openSettingsOverlay's opts give it its own title, a start button (Cancel) and the end button's
 * label and action (Set time); without them the head is Settings' (title "Settings", Done on the right).
 */
import { bindActions } from "./actions.js";
import { bus } from "../core/events.js";

/** Id of the overlay root element. */
export const OVERLAY_ID = "settingsOverlay";
const REFRESH_MS = 15000;
const HIDE_MS = 380;
/** A swipe down on the header this long (px) closes the sheet (or a quick flick, SWIPE_V px/ms). */
export const SWIPE_CLOSE_PX = 90;
const SWIPE_V = 0.6;
/** The checkmark of Done and the cross of Cancel (Lucide check / x), drawn at 20 px. */
const CHECK_SVG = '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';
const X_SVG = '<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let el = null, body = null, heading = null, scrim = null, startSide = null, endBtn = null, endAction = null;
let sess = null;      // open session
let hideTimer = 0;
let ctxRef = null;

const $ = (id) => document.getElementById(id);
const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
const navKey = (s) => `${s?.view || ""}|${s?.stopId || ""}|${s?.routeId || ""}`;

/**
 * The zoom origin (mZoomSheet): the trigger's center in the sheet's own box, as a CSS transform-origin (pure; tested).
 * Both rects are screen px; k = frame scale (screen px per layout px). Null when there is no trigger to grow from.
 * @param {{left:number, top:number, width:number, height:number}|null} trigger
 * @param {{left:number, top:number}} sheet
 * @param {number} [k]
 * @returns {string|null}
 */
export function zoomOrigin(trigger, sheet, k = 1) {
  if (!trigger || !(trigger.width > 0) || !sheet) return null;
  const s = k > 0 ? k : 1;
  const x = (trigger.left + trigger.width / 2 - sheet.left) / s, y = (trigger.top + trigger.height / 2 - sheet.top) / s;
  return `${Math.round(x)}px ${Math.round(y)}px`;
}

/** Point the zoom at the trigger (the gear, the clock) so the sheet grows out of it and shrinks back into it. */
function aimAt(trigger) {
  if (!el) return;
  try {
    const app = $("app"), framed = app && getComputedStyle(app).transform !== "none";
    const k = framed && app.offsetWidth ? app.getBoundingClientRect().width / app.offsetWidth : 1;
    const o = zoomOrigin(trigger && trigger.isConnected ? trigger.getBoundingClientRect() : null, el.getBoundingClientRect(), k);
    if (o) el.style.transformOrigin = o; else el.style.removeProperty("transform-origin");
  } catch (e) { /* layout unavailable */ }
}

/** Kept for callers of the first redesign (the sheet no longer positions it: css/settings.css does). */
export function placeOverlay() {}

function ensure() {
  if (el && el.isConnected) return el;
  el = document.createElement("div");
  el.id = OVERLAY_ID;
  el.className = "sto";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "stoTitle");
  el.dataset.state = "closed";
  el.hidden = true;
  el.innerHTML = '<div class="sto-head"><span class="sto-grab" aria-hidden="true"></span><span class="sto-side" data-sto="start" aria-hidden="true"></span>'
    + '<h2 id="stoTitle" class="sto-title" tabindex="-1">Settings</h2>'
    + '<span class="sto-side sto-side--end"><button type="button" class="sto-done" data-sto="done" aria-label="Done"></button></span></div>'
    + '<div class="sto-body" data-sto="body"></div>';
  body = el.querySelector('[data-sto="body"]');
  heading = el.querySelector("#stoTitle");
  startSide = el.querySelector('[data-sto="start"]');
  endBtn = el.querySelector('[data-sto="done"]');
  endBtn.addEventListener("click", () => { if (endAction) endAction(); else closeSettingsOverlay(); });
  bindActions(el, () => ctxRef);   // data-action rows inside (About)
  swipeToClose(el.querySelector(".sto-head"));
  scrim = document.createElement("div");
  scrim.className = "sto-scrim";
  scrim.hidden = true;
  scrim.setAttribute("aria-hidden", "true");
  scrim.addEventListener("click", () => closeSettingsOverlay());
  const host = $("app") || document.body;
  host.appendChild(scrim);
  host.appendChild(el);
  return el;
}

/** The head for this open: title, optional start button (e.g. Cancel), end button label and action (default Done = close). */
function setHead(opts) {
  heading.textContent = opts.title || "Settings";
  el.dataset.kind = opts.kind || "settings";
  startSide.textContent = "";
  startSide.setAttribute("aria-hidden", "true");
  if (opts.start && opts.start.label) {   // Cancel: a 44 fill circle with a cross, named by its label (glass spec 9.9)
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sto-done sto-start";
    b.dataset.sto = "start-btn";
    b.setAttribute("aria-label", opts.start.label);
    b.innerHTML = X_SVG;
    b.addEventListener("click", () => { if (opts.start.onClick) opts.start.onClick(); else closeSettingsOverlay(); });
    startSide.appendChild(b);
    startSide.removeAttribute("aria-hidden");
  }
  // the end button: Done = a tinted checkmark circle named "Done" (iOS 26); any other label (Set time) = a tinted capsule
  // with its words, because no symbol says it (glass spec 9.8, 9.9, 9.10)
  const label = (opts.end && opts.end.label) || "Done", isDone = label === "Done";
  endBtn.classList.toggle("is-check", isDone);
  endBtn.setAttribute("aria-label", label);
  if (isDone) endBtn.innerHTML = CHECK_SVG; else endBtn.textContent = label;
  endAction = (opts.end && opts.end.onClick) || null;
}

/** A swipe down on the header closes the sheet (it follows the finger by transform; a short drag springs back). */
function swipeToClose(head) {
  let st = null;
  const y = (e) => (e.touches ? e.touches[0].clientY : e.clientY);
  const down = (e) => {
    if (!sess || e.target.closest("button, a, input")) return;
    if (e.type === "pointerdown" && (e.pointerType === "touch" && "ontouchstart" in window || e.button !== 0)) return;
    st = { y0: y(e), t0: performance.now(), dy: 0 };
    el.classList.add("is-dragging");
  };
  const move = (e) => {
    if (!st) return;
    st.dy = Math.max(0, y(e) - st.y0);
    el.style.transform = `translate3d(0, ${st.dy}px, 0)`;
    if (e.cancelable && e.type === "touchmove") e.preventDefault();
  };
  const up = () => {
    if (!st) return;
    const { dy, t0 } = st, v = dy / Math.max(1, performance.now() - t0);
    st = null;
    el.classList.remove("is-dragging");
    el.style.removeProperty("transform");
    if (dy >= SWIPE_CLOSE_PX || (dy > 24 && v > SWIPE_V)) closeSettingsOverlay();
  };
  head.addEventListener("touchstart", down, { passive: true });
  head.addEventListener("touchmove", move, { passive: false });
  head.addEventListener("touchend", up);
  head.addEventListener("touchcancel", up);
  head.addEventListener("pointerdown", down);
  window.addEventListener("pointermove", (e) => { if (st && e.pointerType !== "touch") move(e); });
  window.addEventListener("pointerup", (e) => { if (st && e.pointerType !== "touch") up(); });
}

function focusables() {
  return [...el.querySelectorAll(FOCUSABLE)].filter((x) => x.getClientRects().length && !x.closest("[hidden], [inert]"));
}

function onKey(e) {
  if (!sess) return;
  if (e.key === "Escape") {
    const a = document.activeElement;
    if (a && el.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.value) return;   // let the field clear first
    e.preventDefault();
    e.stopPropagation();
    closeSettingsOverlay();
  } else if (e.key === "Tab") {
    const f = focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (!el.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && (a === first || a === heading)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }
}

function pickTrigger(t) {
  if (t && t.isConnected && typeof t.focus === "function" && t !== document.body) return t;
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected && !(el && el.contains(a))) return a;
  return $("settingsBtn");
}

function on(target, type, fn, opt) {
  if (!target) return;
  target.addEventListener(type, fn, opt);
  sess.offs.push(() => target.removeEventListener(type, fn, opt));
}

/**
 * Is the overlay open?
 * @returns {boolean}
 */
export function isSettingsOpen() {
  return !!sess;
}

/**
 * Which menu is open: "settings", "time" (Lines by Time), or null when closed.
 * @returns {string|null}
 */
export function overlayKind() {
  return sess && el ? el.dataset.kind || "settings" : null;
}

/**
 * Open the overlay (no-op if already open).
 * @param {object} ctx app ctx ({store, setDetent, navigate, toast, now, ...})
 * @param {{render:(state:object)=>string, mount?:(root:Element, ctx:object)=>void, unmount?:()=>void, refresh?:()=>void}} content
 * @param {{trigger?:HTMLElement, opener?:HTMLElement|null, title?:string, kind?:string,
 *          start?:{label:string, onClick?:()=>void}, end?:{label:string, onClick?:()=>void}}} [opts]
 *   trigger: gets focus back on close (default: the gear); opener: the button whose aria-expanded follows the overlay
 *   (default the gear); title (default "Settings"); kind: data-kind on the root (CSS); start / end: head buttons
 *   (no start = none; no end = Done, which closes)
 * @returns {HTMLElement} the overlay root
 */
export function openSettingsOverlay(ctx, content, opts = {}) {
  ensure();
  if (sess) return el;
  clearTimeout(hideTimer);
  const sheet = $("sheet"), gear = opts.opener === undefined ? $("settingsBtn") : opts.opener;
  sess = { ctx, content, trigger: pickTrigger(opts.trigger), prev: sheet?.dataset.detent || null, key: navKey(ctx.store.get()), offs: [], inerted: [], opener: gear };
  ctxRef = ctx;
  setHead(opts);
  try {
    body.innerHTML = String(content.render(ctx.store.get()) ?? "");
    content.mount?.(body, ctx);
  } catch (e) {
    console.error("settings overlay", e);
    body.innerHTML = `<p class="v-sec">Couldn't show ${opts.title || "Settings"}. Official service: 773.702.8181.</p>`;
  }
  el.removeAttribute("inert");
  scrim.hidden = false;
  el.hidden = false;
  el.dataset.state = "open";
  aimAt(opts.opener === undefined ? sess.trigger : opts.opener || sess.trigger);   // forces style: the start of the zoom
  body.scrollTop = 0;
  el.classList.add("is-in");
  void scrim.offsetWidth;          // start the scrim fade from 0
  scrim.classList.add("is-in");
  // the app behind (its sheet, the glass controls, the bottom row) must not be reachable while Settings is on top
  for (const id of ["sheetHead", "content", "tabs", "mapctl", "bottomrow", "topbar", "ctxbar"]) {
    const n = $(id);
    if (n && !n.inert) { n.inert = true; sess.inerted.push(n); }
  }
  gear?.setAttribute("aria-haspopup", "dialog");
  gear?.setAttribute("aria-expanded", "true");

  on(document, "keydown", onKey, true);
  const offStore = ctx.store.subscribe?.((s) => { if (sess && navKey(s) !== sess.key) closeSettingsOverlay({ restore: false, focus: "title" }); });
  if (typeof offStore === "function") sess.offs.push(offStore);
  const timer = setInterval(() => { if (!document.hidden) { try { content.refresh?.(); } catch (e) { console.error(e); } } }, REFRESH_MS);
  sess.offs.push(() => clearInterval(timer));

  heading.focus({ preventScroll: true });
  bus.emit("settings:toggle", { open: true });   // main.js: one history entry, so browser back closes Settings
  return el;
}

/**
 * Close the overlay.
 * @param {{restore?:boolean|string, focus?:'trigger'|'title'|'none'}} [opts]
 *   restore: a detent name to put the app's sheet in (default: leave it as it is; Settings no longer moves it);
 *   focus: where focus goes ('trigger' = the gear, default; 'title' = the sheet title, only if focus was inside)
 * @returns {boolean} false if it was not open
 */
export function closeSettingsOverlay(opts = {}) {
  if (!sess) return false;
  const s = sess, restore = opts.restore ?? false, focus = opts.focus || "trigger";
  sess = null;
  const wasInside = el.contains(document.activeElement);
  s.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
  try { s.content.unmount?.(); } catch (e) { console.error(e); }
  s.inerted.forEach((n) => { n.inert = false; });
  scrim.classList.remove("is-in");
  s.opener?.setAttribute("aria-expanded", "false");
  el.dataset.state = "closed";
  el.setAttribute("inert", "");
  const target = restore === true ? s.prev : restore || null;
  aimAt(s.opener || s.trigger);   // shrink back into the button it came from
  el.classList.remove("is-in");
  if (target && $("sheet")?.dataset.detent !== target) { try { s.ctx.setDetent?.(target); } catch (e) { /* no sheet */ } }
  if (focus === "trigger" && s.trigger?.isConnected) s.trigger.focus({ preventScroll: true });
  else if (focus === "title" && wasInside) $("title")?.focus({ preventScroll: true });
  else if (wasInside) document.activeElement?.blur?.();
  clearTimeout(hideTimer);
  const hide = () => { if (sess) return; el.hidden = true; scrim.hidden = true; body.innerHTML = ""; };
  if (reducedMotion()) hide(); else hideTimer = setTimeout(hide, HIDE_MS);
  bus.emit("settings:toggle", { open: false });
  return true;
}

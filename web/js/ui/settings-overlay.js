/**
 * @module ui/settings-overlay
 * The Settings overlay (SETTINGS): an iOS-style modal panel that is separate from the sheet router.
 * Opening it lifts the sheet to its "full" detent and covers the WHOLE sheet, including its grab
 * handle, title and tabs (owner: the Plan Trip title/tabs must not look like part of Settings); a
 * scrim dims whatever is still visible behind it (map strip, floating buttons, context bar), and
 * the covered sheet header and content are inert. Closing restores the previous detent.
 * Closes on Done, Escape, a tap on the scrim, the gear (programmatic toggle), any navigation (e.g.
 * About) and if the sheet leaves "full". Accessible modal: role="dialog" aria-modal="true", focus
 * moves to the heading, Tab is trapped inside, focus returns to the opener (the gear) on close.
 *
 * The DOM is created from JS and appended to #app, so on desktop it lives inside the scaled iPhone
 * frame (ui/frame.js); positions are measured in #app's layout px (screen px / scale).
 * Content is supplied by the caller (ui/views/settings.js): {render(state), mount(root, ctx), unmount(), refresh()}.
 */
import { bindActions } from "./actions.js";

/** Id of the overlay root element. */
export const OVERLAY_ID = "settingsOverlay";
const REFRESH_MS = 15000;
const HIDE_MS = 380;
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let el = null, body = null, heading = null, scrim = null;
let sess = null;      // open session
let hideTimer = 0;
let ctxRef = null;

const $ = (id) => document.getElementById(id);
const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
const navKey = (s) => `${s?.view || ""}|${s?.stopId || ""}|${s?.routeId || ""}`;

/**
 * Where the overlay goes, in the containing block's layout px (pure; unit-tested): exactly over the
 * sheet at its "full" detent. The sheet may be mid-transition: subtracting its current translateY
 * gives its top edge at "full" (translateY 0), so the overlay lands where the sheet will settle.
 * @param {{sheet:{top:number, left:number, width:number, bottom:number}, origin:{left:number, top:number},
 *          k?:number, ty?:number, height:number}} g
 *   sheet: bounding rect (screen px); origin: containing block's top-left (screen px);
 *   k: frame scale (screen px per layout px); ty: sheet's current translateY (layout px); height: containing block height (layout px)
 * @returns {{top:number, left:number, width:number, bottom:number}}
 */
export function overlayBox({ sheet, origin, k = 1, ty = 0, height }) {
  const s = k > 0 ? k : 1;
  const top = (sheet.top - origin.top) / s - ty;
  const sheetBottom = (sheet.bottom - origin.top) / s - ty;
  return {
    top: Math.max(0, top),
    left: (sheet.left - origin.left) / s,
    width: sheet.width / s,
    bottom: Math.max(0, Math.round(height - sheetBottom)),
  };
}

/** The sheet's current (possibly mid-transition) translateY in layout px; 0 without a transform. */
function sheetTy() {
  const sheet = $("sheet");
  try {
    const t = sheet && getComputedStyle(sheet).transform;
    return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 || 0 : 0;
  } catch (e) { return 0; }
}

/** Measure the live DOM (#app, #sheet) and return the overlay box, or null. */
function measure() {
  const app = $("app") || document.body, sheet = $("sheet");
  if (!sheet) return null;
  const framed = app !== document.body && getComputedStyle(app).transform !== "none";
  const ar = app.getBoundingClientRect();
  const ty = sheetTy();
  return overlayBox({
    sheet: sheet.getBoundingClientRect(),
    origin: framed ? { left: ar.left, top: ar.top } : { left: 0, top: 0 },
    k: framed && app.offsetWidth ? ar.width / app.offsetWidth : 1,
    ty, height: framed ? app.offsetHeight : document.documentElement.clientHeight || innerHeight,
  });
}

/** Re-measure and position the overlay (open, resize, orientation change). */
export function placeOverlay() {
  if (!el) return;
  const b = measure();
  if (!b) { el.style.cssText = ""; return; }
  el.style.top = b.top + "px";
  el.style.left = b.left + "px";
  el.style.width = b.width + "px";
  el.style.bottom = b.bottom + "px";
  el.classList.toggle("sto--float", b.bottom > 0);
}

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
  el.innerHTML = '<div class="sto-head"><span class="sto-side" aria-hidden="true"></span>'
    + '<h2 id="stoTitle" class="sto-title" tabindex="-1">Settings</h2>'
    + '<span class="sto-side sto-side--end"><button type="button" class="sto-done" data-sto="done">Done</button></span></div>'
    + '<div class="sto-body" data-sto="body"></div>';
  body = el.querySelector('[data-sto="body"]');
  heading = el.querySelector("#stoTitle");
  el.querySelector('[data-sto="done"]').addEventListener("click", () => closeSettingsOverlay());
  bindActions(el, () => ctxRef);   // data-action rows inside (About)
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
 * Open the overlay (no-op if already open).
 * @param {object} ctx app ctx ({store, setDetent, navigate, toast, now, ...})
 * @param {{render:(state:object)=>string, mount?:(root:Element, ctx:object)=>void, unmount?:()=>void, refresh?:()=>void}} content
 * @param {{trigger?:HTMLElement}} [opts] element that gets focus back on close (default: the gear)
 * @returns {HTMLElement} the overlay root
 */
export function openSettingsOverlay(ctx, content, opts = {}) {
  ensure();
  if (sess) return el;
  clearTimeout(hideTimer);
  const sheet = $("sheet"), gear = $("settingsBtn");
  sess = { ctx, content, trigger: pickTrigger(opts.trigger), prev: sheet?.dataset.detent || null, key: navKey(ctx.store.get()), offs: [], inerted: [] };
  ctxRef = ctx;
  const tyBefore = sheetTy();     // read before the detent change: computed style jumps to the end value
  try { ctx.setDetent?.("full"); } catch (e) { /* no sheet */ }
  try {
    body.innerHTML = String(content.render(ctx.store.get()) ?? "");
    content.mount?.(body, ctx);
  } catch (e) {
    console.error("settings overlay", e);
    body.innerHTML = '<p class="v-sec">Couldn\'t show Settings. Official service: 773.702.8181.</p>';
  }
  // Slide up together with the sheet: start as far below as the sheet still has to travel
  // (it was just told to go "full", where its translateY is 0), or from off-screen when it does not move.
  // Set before un-hiding, so the first computed style is already the start position.
  sess.from = tyBefore > 24 ? tyBefore : 0;
  el.style.setProperty("--sto-from", sess.from ? sess.from + "px" : "100%");
  el.removeAttribute("inert");
  scrim.hidden = false;
  el.hidden = false;
  el.dataset.state = "open";
  placeOverlay();                 // forces style: the before-change style for the slide
  body.scrollTop = 0;
  el.classList.add("is-in");
  void scrim.offsetWidth;          // start the scrim fade from 0
  scrim.classList.add("is-in");
  // the covered sheet (title, tabs, content) must not be reachable while Settings is on top
  for (const id of ["sheetHead", "content"]) {
    const n = $(id);
    if (n && !n.inert) { n.inert = true; sess.inerted.push(n); }
  }
  gear?.setAttribute("aria-haspopup", "dialog");
  gear?.setAttribute("aria-expanded", "true");

  on(document, "keydown", onKey, true);
  let raf = 0;
  const relayout = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(placeOverlay); };
  on(window, "resize", relayout);
  on(window, "orientationchange", relayout);
  if (sheet && typeof MutationObserver === "function") {
    const mo = new MutationObserver(() => { if (sess && sheet.dataset.detent !== "full") closeSettingsOverlay({ restore: false, focus: "title" }); });
    mo.observe(sheet, { attributes: true, attributeFilter: ["data-detent"] });
    sess.offs.push(() => mo.disconnect());
  }
  const offStore = ctx.store.subscribe?.((s) => { if (sess && navKey(s) !== sess.key) closeSettingsOverlay({ restore: false, focus: "title" }); });
  if (typeof offStore === "function") sess.offs.push(offStore);
  const timer = setInterval(() => { if (!document.hidden) { try { content.refresh?.(); } catch (e) { console.error(e); } } }, REFRESH_MS);
  sess.offs.push(() => clearInterval(timer));

  heading.focus({ preventScroll: true });
  return el;
}

/**
 * Close the overlay.
 * @param {{restore?:boolean|string, focus?:'trigger'|'title'|'none'}} [opts]
 *   restore: true = previous sheet detent (default), a detent name, or false = leave the sheet alone;
 *   focus: where focus goes ('trigger' = the gear, default; 'title' = the sheet title, only if focus was inside)
 * @returns {boolean} false if it was not open
 */
export function closeSettingsOverlay(opts = {}) {
  if (!sess) return false;
  const s = sess, restore = opts.restore ?? true, focus = opts.focus || "trigger";
  sess = null;
  const wasInside = el.contains(document.activeElement);
  s.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
  try { s.content.unmount?.(); } catch (e) { console.error(e); }
  s.inerted.forEach((n) => { n.inert = false; });
  scrim.classList.remove("is-in");
  $("settingsBtn")?.setAttribute("aria-expanded", "false");
  el.dataset.state = "closed";
  el.setAttribute("inert", "");
  const target = restore === true ? s.prev : restore || null;
  // going back to the detent it opened from: move down with the sheet while fading; else slide off
  el.style.setProperty("--sto-from", s.from && target === s.prev ? s.from + "px" : "100%");
  el.classList.remove("is-in");
  if (target && $("sheet")?.dataset.detent !== target) { try { s.ctx.setDetent?.(target); } catch (e) { /* no sheet */ } }
  if (focus === "trigger" && s.trigger?.isConnected) s.trigger.focus({ preventScroll: true });
  else if (focus === "title" && wasInside) $("title")?.focus({ preventScroll: true });
  else if (wasInside) document.activeElement?.blur?.();
  clearTimeout(hideTimer);
  const hide = () => { if (sess) return; el.hidden = true; scrim.hidden = true; body.innerHTML = ""; };
  if (reducedMotion()) hide(); else hideTimer = setTimeout(hide, HIDE_MS);
  return true;
}

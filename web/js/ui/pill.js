/**
 * @module ui/pill
 * The floating status chip / banner under the search bar (DESIGN-SPEC 10.3; moved out of main.js 2026-10-10): stale / failed feed and
 * empty-feed states, each with its own icon so the state never rests on color alone (iOS RootView
 * StatusPill): feed error = wifi off, delayed / out of date = clock with an alert mark, no live locations
 * while routes are scheduled = antenna off, no shuttles running = bus. Same words as before (and as the
 * iOS Kit LiveText.pill). Writes the DOM only when the state changes; --pill-h follows its real height.
 * A fresh feed with no bus while a service alert is up also offers "See alert" (action alerts:open): the operator's
 * alert may say why no bus shows, or which number to call (iOS "See alert", 2026-10-11).
 * Demo mode (`?demo=1`, owner decision 2026-10-11: no banner): the pill is the one quiet, honest indicator. It reads
 * "Simulated buses" (flask icon) and the whole pill is a button (action demo:info, ui/demo.js) that explains the
 * demo and offers the way back to live buses. Feed errors and delays still win over it.
 * Compact banner (owner 2026-11-04: "Reduce the size of the reconnecting notification."): one 44 pt line in the footnote
 * role, a short line that still says the times can't be relied on ("Live data lost. Times may be off."); its trailing
 * part is a Details button that opens the full sentence and the official number (Call 773.702.8181) under that line.
 * The line itself never moves when it opens or closes (the banner only grows downward), so a double tap on it never
 * lands on the trip chip; screen readers always hear the full sentence (#pillText, visually hidden while closed).
 */
import { clock, nowS } from "../core/time.js";
import { staleLevel, activeAlerts } from "../core/arrivals.js";
import { silentService } from "../core/operating.js";
import { DEMO_PILL } from "../core/demo.js";
import { OFFICIAL_PHONE, OFFICIAL_TEL } from "./components.js";
import { PATHS, svg } from "./icons.js";

/** Seconds after boot before "never polled" counts as a feed error. */
export const FIRST_POLL_GRACE_S = 20;
/**
 * After the last Retry tap the banner keeps its height and place this long (ms) (owner 2026-11-03: "if the user spams it
 * while on a route, it doesn't shift and accidentally cancel their current trip"; DESIGN-SPEC 10.3, the same rule as the
 * iPhone app's Kit RetryHold): Retry stays in its slot; if the feed comes back meanwhile the banner says "Live data is
 * back." with a check mark and absorbs taps, so the trip chip (whose Show all ends the trip) and the sheet never slide up
 * under the finger; then it shows the current state.
 */
export const RETRY_HOLD_MS = 2500;
/** What the held banner says once the feed answers again (spec 10.3). */
export const BACK_MSG = "Live data is back.";
/** The compact banner's call link (in its details, owner 2026-11-04: the official number stays one tap away). */
export const CALL_TEXT = `Call ${OFFICIAL_PHONE}`;
/** The Details button's accessible name (its visible part is the short line, aria-hidden: #pillText says it in full). */
export const MORE_LABEL = "Details";

/** Status icons (ui/icons.js, Lucide + drawn), keyed by pillState().icon: one glyph per state (spec 5). */
export const PILL_ICONS = Object.freeze({
  feed: PATHS["wifi-off"], delay: PATHS["clock-alert"], silent: PATHS["antenna-off"], idle: PATHS["bus-front"], demo: PATHS["flask-conical"],
});
/** The demo chip's tap mark (info): it says the chip can be tapped for more. */
const INFO_SVG = svg("info", 15);

/**
 * What the pill shows (pure).
 * @param {object} s store state
 * @param {number} now unix seconds
 * @param {{bootS?:number, graceS?:number, demo?:boolean}} [o] bootS: app start (before the first poll, an error only
 *   after graceS); demo: the page runs the simulated feed (`?demo=1`)
 * @returns {{kind:''|'err'|'warn'|'info', icon:''|'feed'|'delay'|'silent'|'idle'|'demo', msg:string, short:string, retry:boolean, alert:boolean, demo:boolean}}
 *   msg: the full sentence (screen readers, the open details); short: the compact banner's one line, which still says
 *   the times can't be relied on (owner 2026-11-04); alert: offer "See alert" (fresh empty feed and at least one active
 *   service alert); demo: "Simulated buses", tap to explain
 */
export function pillState(s, now, { bootS = now, graceS = FIRST_POLL_GRACE_S, demo = false } = {}) {
  const polled = s.liveLoaded || s.failed;
  const lvl = polled ? staleLevel(s, now) : now - bootS > graceS ? "err" : "";
  const out = (kind, icon, msg, more) => ({ kind, icon, msg, short: msg, retry: false, alert: false, demo: false, ...more });
  if (lvl === "err") {
    return s.lastOk ? out("err", "feed", "Can't reach the shuttle feed. Retrying. Showing last known data.", { retry: true, short: "Live data lost. Times may be off." })
      : out("err", "feed", `Can't reach the shuttle feed. Don't rely on these times; call ${OFFICIAL_PHONE}.`, { retry: true, short: "No live data. Don't rely on times." });
  }
  if (lvl === "old") {
    return out("warn", "delay", `Live data is out of date${s.feedTs ? " (last update " + clock(s.feedTs) + ")" : ""}. Times are approximate.`,
      { short: s.feedTs ? `Last update ${clock(s.feedTs)}. Times approximate.` : "Live data out of date. Times approximate." });
  }
  if (lvl === "late") return out("warn", "delay", "Live data delayed. Times may be off.");
  if (demo) return out("info", "demo", DEMO_PILL, { demo: true });   // simulated feed: always say so (never stored, ?demo=1 only)
  if (s.liveLoaded && !(s.buses || []).length) {   // fresh, empty feed: "no shuttles" only if the schedule agrees
    const alert = activeAlerts(s, now).length > 0;
    return silentService(s, now) ? out("warn", "silent", "No shuttles are reporting live locations", { alert, short: "No shuttles reporting locations" })
      : out("info", "idle", "No shuttles running right now", { alert });
  }
  return out("", "", "");
}

/**
 * Inline SVG for a pill icon ('' for none). Decorative: the text says the same.
 * @param {string} name PILL_ICONS key
 * @returns {string}
 */
export function pillIconSVG(name, size = 17) {
  const key = { feed: "wifi-off", delay: "clock-alert", silent: "antenna-off", idle: "bus-front", demo: "flask-conical" }[name];
  return key ? svg(key, size) : "";
}

/**
 * The banner's words with the first sentence in Semibold (spec 10.3), as DOM nodes (the text is never parsed as HTML).
 * @param {HTMLElement} el
 * @param {string} msg
 */
export function setPillText(el, msg) {
  const m = /^(.+?[.!?])\s+(.+)$/.exec(String(msg || ""));
  const b = document.createElement("b");
  b.textContent = m ? m[1] : String(msg || "");
  if (m) el.replaceChildren(b, document.createTextNode(" " + m[2]));
  else el.replaceChildren(b);
}

/**
 * Pill controller over the #pill element (creates the icon slot, the "See alert" button and the demo tap button when
 * the markup has none). The banner's action (Retry or See alert, never both) sits in one fixed slot on the leading edge
 * (owner 2026-11-03, spec 10.3): the icon and the words follow it, so a state or text change never moves it; after a
 * Retry tap the banner holds still for RETRY_HOLD_MS after the last tap (see there).
 * @param {{pill:HTMLElement, text:HTMLElement, retry:HTMLElement, app?:HTMLElement|null}} els
 * @param {{bootS?:number, graceS?:number, demo?:boolean}} [o]
 * @returns {{render(s:object, now:number):void}}
 */
export function createPill(els, o = {}) {
  let ic = els.pill.querySelector(".pillicon");
  if (!ic) {
    ic = document.createElement("span");
    ic.className = "pillicon";
    ic.setAttribute("aria-hidden", "true");
    els.pill.prepend(ic);
  }
  let see = els.pill.querySelector('[data-action="alerts:open"]');
  if (!see) {
    see = document.createElement("button");
    Object.assign(see, { type: "button", className: "pillbtn", textContent: "See alert", hidden: true });
    see.dataset.action = "alerts:open";
    see.setAttribute("aria-label", "Read the service alert");
    els.pill.appendChild(see);
  }
  // the leading slot: Retry, then See alert (only one shows), before the icon and the words
  els.pill.prepend(see);
  if (els.retry && els.retry.parentNode === els.pill) els.pill.prepend(els.retry);
  els.retry?.classList?.add("pillslot");
  see.classList.add("pillslot");
  // the compact banner (owner 2026-11-04): Details = the short line + a chevron; the full sentence (#pillText) and the call
  // link follow it and show only while open (the sentence is always there for screen readers)
  let more = els.pill.querySelector(".pillmore");
  if (!more) {
    more = document.createElement("button");
    Object.assign(more, { type: "button", className: "pillmore", innerHTML: '<span class="pillshort" aria-hidden="true"></span>' + svg("chevron-down", 15, { cls: "pillchev" }) });
    more.setAttribute("aria-label", MORE_LABEL);
    more.setAttribute("aria-expanded", "false");
  }
  ic.after(more);
  const short = more.querySelector(".pillshort");
  more.after(els.text);
  let call = els.pill.querySelector(".pillcall");
  if (!call) {
    call = document.createElement("a");
    Object.assign(call, { className: "pillcall", href: OFFICIAL_TEL, textContent: CALL_TEXT, hidden: true });
  }
  els.text.after(call);
  if (els.text.id) more.setAttribute("aria-controls", els.text.id);
  const setOpen = (on) => {
    const v = on ? "true" : "false";
    if (more.getAttribute("aria-expanded") !== v) more.setAttribute("aria-expanded", v);
    els.pill.classList.toggle("is-open", !!on);
    call.hidden = !on;
  };
  more.addEventListener("click", () => setOpen(more.getAttribute("aria-expanded") !== "true"));
  let tap = els.pill.querySelector('[data-action="demo:info"]');
  if (!tap) {
    tap = document.createElement("button");
    Object.assign(tap, { type: "button", className: "pilltap", innerHTML: INFO_SVG, hidden: true });
    tap.dataset.action = "demo:info";
    tap.setAttribute("aria-label", "Simulated buses: what this means, and how to see live buses");
    els.pill.appendChild(tap);
  }
  let sig = "", holdUntil = 0, holdTimer = 0, latest = null, back = false;
  const api = {};
  const release = () => {
    holdUntil = 0; back = false; sig = "";
    els.retry.removeAttribute("aria-busy");
    els.retry.removeAttribute("aria-disabled");
    els.pill.style.removeProperty("min-height");
    els.pill.classList.remove("is-back");
    if (latest) api.render(latest, nowS());
  };
  // a Retry tap: keep the banner's height and place until RETRY_HOLD_MS after the last tap (spec 10.3), then the real state
  els.retry?.addEventListener?.("click", () => {
    if (els.retry.hidden) return;
    if (!holdUntil) els.pill.style.minHeight = els.pill.offsetHeight + "px";   // its height now: nothing below it moves
    holdUntil = Date.now() + RETRY_HOLD_MS;
    if (!back) els.retry.setAttribute("aria-busy", "true");   // the poll runs (repeated taps join it: data/live.js pollNow)
    clearTimeout(holdTimer);
    holdTimer = setTimeout(release, RETRY_HOLD_MS);
  });
  /** The feed answered during the hold: "Live data is back." with a check, Retry kept in its slot but absorbing taps. */
  const showBack = () => {
    if (back) return;
    back = true;
    els.pill.classList.add("is-back");
    els.pill.dataset.icon = "back";
    ic.innerHTML = svg("check", 15, { stroke: 2.5 });
    setPillText(els.text, BACK_MSG);
    setPillText(short, BACK_MSG);
    els.retry.removeAttribute("aria-busy");
    els.retry.setAttribute("aria-disabled", "true");
  };
  if (els.app && typeof ResizeObserver === "function") {
    // --pill-h on #app = the pill's real height (text can wrap); the full detent and the chip sit below it (sheet.css, base.css)
    new ResizeObserver(() => {
      const v = els.pill.offsetHeight + "px";
      if (v !== "0px" && els.app.style.getPropertyValue("--pill-h") !== v) els.app.style.setProperty("--pill-h", v);
    }).observe(els.pill);
  }
  api.render = (s, now) => {
    latest = s;
    const p = pillState(s, now, o);
    if (Date.now() < holdUntil && !els.retry.hidden) {   // Retry was just tapped: nothing moves under the finger
      if (!p.retry) showBack();
      return;
    }
    const next = [p.kind, p.icon, p.msg, p.short, p.retry, p.alert, p.demo].join("|");
    if (next === sig) return;
    sig = next;
    const open = els.pill.classList.contains("is-open") && !!p.msg && !p.demo;   // details stay open across state changes
    els.pill.hidden = !p.msg;
    els.pill.className = "statuspill" + (p.kind ? " " + p.kind : "");
    els.pill.dataset.icon = p.icon;
    els.pill.dataset.form = p.demo ? "chip" : "banner";   // spec 10.3: simulated buses = a small chip, every other state = a banner
    ic.innerHTML = pillIconSVG(p.icon, 15);
    if (p.demo) els.text.textContent = p.msg;
    else { setPillText(els.text, p.msg); setPillText(short, p.short || p.msg); }
    more.hidden = p.demo;
    setOpen(open);
    els.retry.hidden = !p.retry;
    see.hidden = !p.alert;
    tap.hidden = !p.demo;
  };
  return api;
}

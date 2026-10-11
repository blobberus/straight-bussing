/**
 * @module ui/pill
 * The floating status pill under the search bar (moved out of main.js 2026-10-10): stale / failed feed and
 * empty-feed states, each with its own icon so the state never rests on color alone (iOS RootView
 * StatusPill): feed error = wifi off, delayed / out of date = clock with an alert mark, no live locations
 * while routes are scheduled = antenna off, no shuttles running = bus. Same words as before (and as the
 * iOS Kit LiveText.pill). Writes the DOM only when the state changes; --pill-h follows its real height.
 * A fresh feed with no bus while a service alert is up also offers "See alert" (action alerts:open): the operator's
 * alert may say why no bus shows, or which number to call (iOS "See alert", 2026-10-11).
 * Demo mode (`?demo=1`, owner decision 2026-10-11: no banner): the pill is the one quiet, honest indicator. It reads
 * "Simulated buses" (flask icon) and the whole pill is a button (action demo:info, ui/demo.js) that explains the
 * demo and offers the way back to live buses. Feed errors and delays still win over it.
 */
import { clock } from "../core/time.js";
import { staleLevel, activeAlerts } from "../core/arrivals.js";
import { silentService } from "../core/operating.js";
import { DEMO_PILL } from "../core/demo.js";
import { OFFICIAL_PHONE } from "./components.js";

/** Seconds after boot before "never polled" counts as a feed error. */
export const FIRST_POLL_GRACE_S = 20;

const P = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
/** Lucide-style outline icons (one family with the rest of the app), keyed by pillState().icon. */
export const PILL_ICONS = Object.freeze({
  feed: '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/><path d="M19 12.86a10 10 0 0 0-2-1.52"/><path d="M2 8.82a15 15 0 0 1 4.18-2.64"/><path d="M22 8.82a15 15 0 0 0-11.29-3.76"/><path d="M2 2l20 20"/>',
  delay: '<path d="M12 6v6l4 2"/><path d="M16 21.16a10 10 0 1 1 5-13.52"/><path d="M20 11.5v6"/><path d="M20 21.5h.01"/>',
  silent: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/><path d="M2 2l20 20"/>',
  idle: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21v-3M16 21v-3M8 14.5h.01M16 14.5h.01"/>',
  demo: '<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/>',
});
/** The demo pill's tap mark (Lucide info): it says the pill can be tapped for more. */
const INFO_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" ${P} aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`;

/**
 * What the pill shows (pure).
 * @param {object} s store state
 * @param {number} now unix seconds
 * @param {{bootS?:number, graceS?:number, demo?:boolean}} [o] bootS: app start (before the first poll, an error only
 *   after graceS); demo: the page runs the simulated feed (`?demo=1`)
 * @returns {{kind:''|'err'|'warn'|'info', icon:''|'feed'|'delay'|'silent'|'idle'|'demo', msg:string, retry:boolean, alert:boolean, demo:boolean}}
 *   alert: offer "See alert" (fresh empty feed and at least one active service alert); demo: "Simulated buses", tap to explain
 */
export function pillState(s, now, { bootS = now, graceS = FIRST_POLL_GRACE_S, demo = false } = {}) {
  const polled = s.liveLoaded || s.failed;
  const lvl = polled ? staleLevel(s, now) : now - bootS > graceS ? "err" : "";
  const out = (kind, icon, msg, more) => ({ kind, icon, msg, retry: false, alert: false, demo: false, ...more });
  if (lvl === "err") {
    return out("err", "feed", s.lastOk ? "Can't reach the shuttle feed. Retrying. Showing last known data."
      : `Can't reach the shuttle feed. Don't rely on these times; call ${OFFICIAL_PHONE}.`, { retry: true });
  }
  if (lvl === "old") return out("warn", "delay", `Live data is out of date${s.feedTs ? " (last update " + clock(s.feedTs) + ")" : ""}. Times are approximate.`);
  if (lvl === "late") return out("warn", "delay", "Live data delayed. Times may be off.");
  if (demo) return out("info", "demo", DEMO_PILL, { demo: true });   // simulated feed: always say so (never stored, ?demo=1 only)
  if (s.liveLoaded && !(s.buses || []).length) {   // fresh, empty feed: "no shuttles" only if the schedule agrees
    const alert = activeAlerts(s, now).length > 0;
    return silentService(s, now) ? out("warn", "silent", "No shuttles are reporting live locations", { alert })
      : out("info", "idle", "No shuttles running right now", { alert });
  }
  return out("", "", "");
}

/**
 * Inline SVG for a pill icon ('' for none). Decorative: the text says the same.
 * @param {string} name PILL_ICONS key
 * @returns {string}
 */
export function pillIconSVG(name) {
  const body = PILL_ICONS[name];
  return body ? `<svg width="18" height="18" viewBox="0 0 24 24" ${P} aria-hidden="true" focusable="false">${body}</svg>` : "";
}

/**
 * Pill controller over the #pill element (creates the icon slot, the "See alert" button and the demo tap button when
 * the markup has none).
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
    Object.assign(see, { type: "button", className: els.retry.className || "pillbtn", textContent: "See alert", hidden: true });
    see.dataset.action = "alerts:open";
    see.setAttribute("aria-label", "Read the service alert");
    els.pill.appendChild(see);
  }
  let tap = els.pill.querySelector('[data-action="demo:info"]');
  if (!tap) {
    tap = document.createElement("button");
    Object.assign(tap, { type: "button", className: "pilltap", innerHTML: INFO_SVG, hidden: true });
    tap.dataset.action = "demo:info";
    tap.setAttribute("aria-label", "Simulated buses: what this means, and how to see live buses");
    els.pill.appendChild(tap);
  }
  let sig = "";
  if (els.app && typeof ResizeObserver === "function") {
    // --pill-h on #app = the pill's real height (text can wrap); the full detent and the chip sit below it (sheet.css, base.css)
    new ResizeObserver(() => {
      const v = els.pill.offsetHeight + "px";
      if (v !== "0px" && els.app.style.getPropertyValue("--pill-h") !== v) els.app.style.setProperty("--pill-h", v);
    }).observe(els.pill);
  }
  return {
    render(s, now) {
      const p = pillState(s, now, o), next = [p.kind, p.icon, p.msg, p.retry, p.alert, p.demo].join("|");
      if (next === sig) return;
      sig = next;
      els.pill.hidden = !p.msg;
      els.pill.className = "statuspill" + (p.kind ? " " + p.kind : "");
      els.pill.dataset.icon = p.icon;
      ic.innerHTML = pillIconSVG(p.icon);
      els.text.textContent = p.msg;
      els.retry.hidden = !p.retry;
      see.hidden = !p.alert;
      tap.hidden = !p.demo;
    },
  };
}

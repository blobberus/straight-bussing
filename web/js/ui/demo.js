/**
 * @module ui/demo
 * The demo-mode banner (core/demo.js, `?demo=1`): a persistent strip at the top of the app on every screen
 * (above the search bar, the Settings overlay and dialogs; css/base.css .demobar, --demo-h / --z-demo in
 * tokens.css), saying "Demo mode: simulated buses" with an "Exit demo" link to the same page without the
 * parameter. It is first in the document order so a screen reader meets it before anything else.
 * startDemo() (main.js, demo mode only) shows it and starts data/live.js on the simulated feed (data/demo.js).
 */
import { esc } from "../core/esc.js";
import { DEMO_TITLE, exitDemoHref } from "../core/demo.js";
import { demoFetch } from "../data/demo.js";

/** Demo poll interval (the iOS demo polls every 5 s too). */
export const DEMO_POLL_MS = 5000;

const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/></svg>';   // Lucide flask-conical

/**
 * Banner markup.
 * @param {{pathname:string, search:string, hash:string}} loc page location (for the exit link)
 * @returns {string}
 */
export function demoBannerHTML(loc) {
  return `<span class="demobar-ic">${ICON}</span><span class="demobar-text">${esc(DEMO_TITLE)}</span>`
    + `<a class="demobar-exit" href="${esc(exitDemoHref(loc))}">Exit demo<span class="sr"> and show live buses</span></a>`;
}

/**
 * Show the banner (idempotent) and switch the layout offset on (html.is-demo).
 * @param {HTMLElement} host #app
 * @param {{pathname:string, search:string, hash:string}} [loc]
 * @returns {HTMLElement} the banner
 */
export function mountDemoBanner(host, loc = location) {
  let el = host.querySelector(".demobar");
  if (!el) {
    el = document.createElement("div");
    el.className = "demobar";
    el.id = "demobar";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Demo mode");
    host.prepend(el);
  }
  el.innerHTML = demoBannerHTML(loc);
  document.documentElement.classList.add("is-demo");
  return el;
}

/**
 * Demo mode boot: the banner, then the live-feed poller on the simulated feed (never the network).
 * @param {object} store the app store
 * @param {HTMLElement} host #app
 * @param {(store:object, opts:object) => object} startLive data/live.js startLive (passed in: one module instance)
 * @returns {{stop():void, pollNow():Promise<void>, failures():number, delay():number}}
 */
export function startDemo(store, host, startLive) {
  mountDemoBanner(host);
  return startLive(store, { intervalMs: DEMO_POLL_MS, fetch: demoFetch(store) });
}

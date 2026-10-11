/**
 * @module ui/demo
 * Demo mode (core/demo.js, `?demo=1`). Owner decision 2026-10-11: no banner. The one quiet, honest indicator is the
 * status pill (ui/pill.js, "Simulated buses" on every screen); the whole pill is a button (action `demo:info`)
 * that opens a short explanation with "Show live buses", which reloads the same page without the parameter
 * (core/demo.js exitDemoHref). Nothing is stored, so leaving the URL leaves demo mode.
 * startDemo() (main.js, demo mode only) starts data/live.js on the simulated feed (data/demo.js).
 */
import { DEMO_BODY, DEMO_PILL, exitDemoHref } from "../core/demo.js";
import { demoFetch } from "../data/demo.js";
import { registerAction } from "./actions.js";
import { confirmDialog } from "./confirm.js";

/** Demo poll interval (the iOS demo polls every 5 s too). */
export const DEMO_POLL_MS = 5000;

/** The explanation behind the demo pill (plain text; confirmDialog escapes it). */
export const DEMO_INFO = Object.freeze({
  title: DEMO_PILL,
  body: DEMO_BODY + " Nothing you change in the demo is saved.",
  confirmLabel: "Show live buses",
  cancelLabel: "Keep demo",
});

/** Test seams: the dialog and the page load (tests answer the dialog and record the address instead of leaving). */
export const demoDeps = {
  confirm: confirmDialog,
  go: (href) => location.assign(href),
};

/**
 * Explain demo mode; on "Show live buses" reload without `?demo=1`.
 * @param {{pathname:string, search:string, hash:string}} [loc]
 * @returns {Promise<boolean>} true when the page is leaving the demo
 */
export async function demoInfo(loc = location) {
  const yes = await demoDeps.confirm({ ...DEMO_INFO });
  if (yes) demoDeps.go(exitDemoHref(loc));
  return !!yes;
}

registerAction("demo:info", () => { demoInfo().catch(() => {}); });

/**
 * Demo mode boot: the live-feed poller on the simulated feed (never the network).
 * @param {object} store the app store
 * @param {(store:object, opts:object) => object} startLive data/live.js startLive (passed in: one module instance)
 * @returns {{stop():void, pollNow():Promise<void>, failures():number, delay():number}}
 */
export function startDemo(store, startLive) {
  return startLive(store, { intervalMs: DEMO_POLL_MS, fetch: demoFetch(store) });
}

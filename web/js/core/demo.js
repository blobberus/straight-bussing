/**
 * @module core/demo
 * Demo mode: simulated buses so reviewers and the owner can see the app when no shuttle runs (at night,
 * on Windows without the iOS Simulator). ONLY the page URL turns it on: `?demo=1` (exactly "1"); nothing
 * is ever stored (no localStorage flag, core/storage.js keeps a demo session's writes in memory), so
 * leaving the URL leaves demo mode. The simulated feed is data/demo.js; the status pill says "Simulated buses"
 * (ui/pill.js) and tapping it explains and offers live buses (ui/demo.js; owner decision 2026-10-11: no banner).
 * Port of the iOS `-demo` launch argument (ios/App/Sources/Model/LaunchConfig.swift, Kit DemoFeed.swift).
 */

/** Demo service alert title (same words as the iOS DemoFeed.alertHeader). */
export const DEMO_TITLE = "Demo mode: simulated buses";
/** Status pill words while the demo runs (the one indicator on every screen, 2026-10-11). */
export const DEMO_PILL = "Simulated buses";
/** Service alert body (iOS DemoFeed.alertBody, adapted: the web simulates from the published schedule). */
export const DEMO_BODY = "These buses are simulated from the published schedule for testing and screenshots. They are not live data.";

/**
 * Whether a query string turns demo mode on (`demo=1`, nothing else).
 * @param {string} search location.search ("?demo=1&x=y")
 * @returns {boolean}
 */
export function isDemoSearch(search) {
  try {
    return new URLSearchParams(String(search || "")).get("demo") === "1";
  } catch (e) {
    return false;
  }
}

/** True when this page was opened with `?demo=1` (read once, never stored). */
export const DEMO = typeof location !== "undefined" && isDemoSearch(location.search);

/**
 * The same page without the demo parameter (the demo pill's "Show live buses", ui/demo.js).
 * @param {{pathname:string, search:string, hash:string}} loc
 * @returns {string} path + remaining query + hash, e.g. "/straight-bussing/" or "/app/?x=1#y"
 */
export function exitDemoHref(loc) {
  const q = new URLSearchParams(String(loc?.search || ""));
  q.delete("demo");
  const s = q.toString();
  return String(loc?.pathname || "./") + (s ? "?" + s : "") + String(loc?.hash || "");
}

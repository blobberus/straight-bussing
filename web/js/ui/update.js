/**
 * @module ui/update
 * Keep the installed app current. A home-screen app or a browser tab kept in memory can run old code for
 * days: sw.js activates a new version at once (skipWaiting + clients.claim), but the page in memory keeps
 * its old modules. So: register sw.js, check for a new version every time the app comes back to the
 * foreground, and when a new worker takes control, reload while the app is in the background (never under
 * the user's finger); if that happens while it is visible, reload the next time it is hidden.
 */

/**
 * Register the service worker and start update checks. Never throws.
 * @param {{swUrl?:string}} [o]
 * @returns {void}
 */
export function startUpdates({ swUrl = "sw.js" } = {}) {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  let reg = null, pending = false, hadController = !!sw.controller;
  Promise.resolve().then(() => sw.register(swUrl)).then((r) => { reg = r; }).catch((e) => console.warn("service worker", e));
  sw.addEventListener?.("controllerchange", () => {
    if (!hadController) { hadController = true; return; }   // first install: no old code is running
    if (document.hidden) location.reload();
    else pending = true;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (pending) location.reload(); return; }
    try { reg?.update()?.catch?.(() => {}); } catch (e) { /* offline or unsupported */ }
  });
}

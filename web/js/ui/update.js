/**
 * @module ui/update
 * Keep the installed app current. A home-screen app or a browser tab kept in memory can run old code for
 * days: sw.js activates a new version at once (skipWaiting + clients.claim), but the page in memory keeps
 * its old modules. So: register sw.js, check for a new version every time the app comes back to the
 * foreground, and when a new worker takes control, reload while the app is in the background (never under
 * the user's finger); if that happens while it is visible, reload the next time it is hidden.
 * Never while a trip is in progress: store.journey is not persisted, so a reload would wipe the rider's
 * live trip timeline mid-ride (the reload waits until the trip has ended and the app is hidden again).
 */
import { store } from "../state.js";

/** A started Directions trip is on (its timeline lives only in memory). */
function tripOn() {
  try { const j = store.get().journey; return !!(j && j.kind === "plan"); } catch (e) { return false; }
}

/**
 * Register the service worker and start update checks. Never throws.
 * @param {{swUrl?:string, reload?:() => void, canReload?:() => boolean}} [o] reload / canReload: test seams
 *   (default location.reload, and "no trip in progress")
 * @returns {void}
 */
export function startUpdates({ swUrl = "sw.js", reload = () => location.reload(), canReload = () => !tripOn() } = {}) {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  let reg = null, pending = false, hadController = !!sw.controller;
  const reloadIfIdle = () => { if (canReload()) reload(); else pending = true; };
  Promise.resolve().then(() => sw.register(swUrl)).then((r) => { reg = r; }).catch((e) => console.warn("service worker", e));
  sw.addEventListener?.("controllerchange", () => {
    if (!hadController) { hadController = true; return; }   // first install: no old code is running
    if (document.hidden) reloadIfIdle();
    else pending = true;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (pending) reloadIfIdle(); return; }
    try { reg?.update()?.catch?.(() => {}); } catch (e) { /* offline or unsupported */ }
  });
}

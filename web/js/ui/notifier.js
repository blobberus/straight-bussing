/**
 * @module ui/notifier
 * Web side of "notify me when my bus is near": while the page is open it watches the store and, once per
 * trip + kind (core/notify.js dueAlerts), delivers ONE alert (deliveryFor, 2026-10-10; iOS BusAlerts delivers
 * one too): the in-app banner (toast) while the app is in front, a silent system Notification while it is in
 * the background and the user allowed them; whichever is not possible falls back to the other. With bus
 * alerts on and notifications allowed, main.js keeps the live feed polling in a background tab
 * (data/live.js keepAlive, background()), so the notification can actually come; browsers may throttle it.
 * Nothing runs once the page is closed (iOS Safari has no Notification API outside installed web apps); the
 * iPhone app does lock-screen alerts and a Live Activity with the same core/notify.js logic.
 */
import { bus } from "../core/events.js";
import { nowS } from "../core/time.js";
import { dueAlerts } from "../core/notify.js";

const WATCH = ["buses", "trips", "feedTs", "lastOk", "failed", "notify", "hiddenRoutes", "journey", "staticLoaded"];

/**
 * Browser notification support: 'unsupported' | 'default' | 'granted' | 'denied'.
 * @returns {string}
 */
export function notificationSupport() {
  try {
    return typeof Notification === "function" ? String(Notification.permission || "default") : "unsupported";
  } catch (e) { return "unsupported"; }
}

/**
 * Ask for system notification permission (call only from a user tap). Never throws.
 * @returns {Promise<string>} resulting permission ('unsupported' if unavailable)
 */
export async function requestPermission() {
  if (notificationSupport() === "unsupported") return "unsupported";
  try {
    const r = Notification.requestPermission();
    return String((r && typeof r.then === "function" ? await r : r) || Notification.permission);
  } catch (e) { return notificationSupport(); }
}

/**
 * The one channel for a due alert.
 * @param {{front:boolean, perm:string, inApp:boolean}} o front: the page is visible AND focused;
 *   perm: notificationSupport(); inApp: the "In-app alerts while open" setting
 * @returns {'toast'|'system'|'none'}
 */
export function deliveryFor({ front, perm, inApp }) {
  const sys = perm === "granted";
  if (front) return inApp ? "toast" : sys ? "system" : "none";   // where the rider is looking
  return sys ? "system" : inApp ? "toast" : "none";              // a banner in a background tab goes unseen
}

/** The page is visible and has focus (a toast there is seen). */
export function inFront() {
  try {
    return document.visibilityState === "visible" && (typeof document.hasFocus !== "function" || document.hasFocus());
  } catch (e) { return true; }
}

function systemNotify(a) {
  if (notificationSupport() !== "granted") return false;
  // silent: no sound; tag replaces an older alert of the same kind for the same trip
  const o = { body: a.body, tag: a.key, silent: true };
  try {
    new Notification(a.title, o);
    return true;
  } catch (e) {   // Chrome Android and installed iPhone web apps only show notifications through the service worker
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : null;
    if (!sw || !sw.controller || !sw.ready) return false;
    sw.ready.then((r) => r.showNotification(a.title, o)).catch(() => {});
    return true;
  }
}

/**
 * Start watching. Fires alerts for the station in store.notify while the page is open.
 * @param {{get():object, subscribe(fn:(s:object, changed:Set<string>)=>void):()=>void}} store
 * @param {{toast?:(text:string)=>void, now?:()=>number, notify?:(a:object)=>boolean, front?:()=>boolean, perm?:()=>string}} [opts]
 *   toast defaults to the app bus 'toast' event; now / notify (returns false when it could not show) / front /
 *   perm (notificationSupport) are test seams
 * @returns {{stop():void, check():Array, fired():Set<string>, background():boolean}} background(): an alert
 *   station is set and system notifications are allowed (main.js keeps polling in a background tab then)
 */
export function startNotifier(store, opts = {}) {
  const toast = typeof opts.toast === "function" ? opts.toast : (text) => bus.emit("toast", { text });
  const now = typeof opts.now === "function" ? opts.now : nowS;
  const sys = typeof opts.notify === "function" ? opts.notify : systemNotify;
  const front = typeof opts.front === "function" ? opts.front : inFront;
  const perm = typeof opts.perm === "function" ? opts.perm : notificationSupport;
  let fired = new Set(), station = null;

  function check() {
    const s = store.get();
    const sid = s.notify && s.notify.stopId;
    if (sid !== station) { station = sid; fired = new Set(); }   // new station: start fresh
    if (!sid || !s.staticLoaded) return [];
    let res;
    try { res = dueAlerts(s, fired, now()); } catch (e) { console.error("notifier", e); return []; }
    fired = res.fired;
    const inApp = s.notify.inApp !== false;
    for (const a of res.alerts) {
      const how = deliveryFor({ front: front(), perm: perm(), inApp });
      if (how === "system" && sys(a)) continue;                      // shown by the system: no banner too
      if (how !== "none" && inApp) toast(`${a.title}. ${a.body}`);   // the banner, or the fallback when the system one failed
    }
    return res.alerts;
  }

  const off = store.subscribe((s, changed) => {
    if (!changed || WATCH.some((k) => changed.has(k))) check();
  });
  check();
  return { stop: () => off && off(), check, fired: () => new Set(fired),
    background: () => !!store.get().notify?.stopId && perm() === "granted" };
}

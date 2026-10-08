/**
 * @module ui/notifier
 * Web side of "notify me when my bus is near": while the page is open it watches the store and,
 * once per trip + kind (core/notify.js dueAlerts), shows an in-app toast and, if the user allowed
 * it, a silent system Notification. It never claims to work in the background (iOS Safari has no
 * Notification API outside installed web apps, and nothing runs once the page is closed); the iPhone
 * app will do lock-screen alerts and a Live Activity with the same core/notify.js logic.
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

function systemNotify(a) {
  if (notificationSupport() !== "granted") return false;
  try {
    // silent: no sound; tag replaces an older alert of the same kind for the same trip
    new Notification(a.title, { body: a.body, tag: a.key, silent: true });
    return true;
  } catch (e) { return false; }         // e.g. Chrome Android requires a service worker registration
}

/**
 * Start watching. Fires alerts for the station in store.notify while the page is open.
 * @param {{get():object, subscribe(fn:(s:object, changed:Set<string>)=>void):()=>void}} store
 * @param {{toast?:(text:string)=>void, now?:()=>number, notify?:(a:object)=>boolean}} [opts]
 *   toast defaults to the app bus 'toast' event; now/notify are test seams
 * @returns {{stop():void, check():Array, fired():Set<string>}}
 */
export function startNotifier(store, opts = {}) {
  const toast = typeof opts.toast === "function" ? opts.toast : (text) => bus.emit("toast", { text });
  const now = typeof opts.now === "function" ? opts.now : nowS;
  const sys = typeof opts.notify === "function" ? opts.notify : systemNotify;
  let fired = new Set(), station = null;

  function check() {
    const s = store.get();
    const sid = s.notify && s.notify.stopId;
    if (sid !== station) { station = sid; fired = new Set(); }   // new station: start fresh
    if (!sid || !s.staticLoaded) return [];
    let res;
    try { res = dueAlerts(s, fired, now()); } catch (e) { console.error("notifier", e); return []; }
    fired = res.fired;
    for (const a of res.alerts) {
      if (s.notify.inApp !== false) toast(`${a.title}. ${a.body}`);
      sys(a);
    }
    return res.alerts;
  }

  const off = store.subscribe((s, changed) => {
    if (!changed || WATCH.some((k) => changed.has(k))) check();
  });
  check();
  return { stop: () => off && off(), check, fired: () => new Set(fired) };
}

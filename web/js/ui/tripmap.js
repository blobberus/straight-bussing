/**
 * @module ui/tripmap
 * The started trip on the map (owner request 2026-10-13): where YOU are in the trip (on the bus while riding,
 * core/tripyou.js) with the labels on your stops, from the SAME evaluation of the trip as the Current trip card
 * and the trip alerts (core/tripprogress.js tripNow), so the map never shows another stop count than the banner.
 *
 * Follow camera (like a navigation app): on when a trip starts and when the locate button is tapped during a
 * trip (recenter); off as soon as the rider drags or zooms the map. While on, it frames tripYou.frame (you, the
 * next stop that matters, the coming bus when it is near) when the phase or leg changes or a framed point leaves
 * the visible map; never on a poll where everything is still in view (no jitter). While the sheet covers the
 * map it waits, and frames once the sheet goes down.
 */
import { bus } from "../core/events.js";
import { nowS } from "../core/time.js";
import { tripNow } from "../core/tripprogress.js";
import { tripYou } from "../core/tripyou.js";

const WATCH = ["journey", "buses", "trips", "user", "stops", "routeStops", "feedTs", "lastOk", "failed", "staticLoaded"];
/** No re-frame for this long after one (a fly animation is still running). */
const SETTLE_MS = 2000;

const isPlan = (s) => !!(s && s.journey && s.journey.kind === "plan");

/**
 * Start drawing the trip on the map.
 * @param {{get():object, subscribe(fn:(s:object, changed:Set<string>)=>void):()=>void}} store
 * @param {{setTrip?:Function, inView?:Function, fitTo?:Function, onUserMove?:Function}} map MapApi
 * @param {{now?:()=>number, clock?:()=>number}} [opts] test seams (unix seconds; ms clock)
 * @returns {{sync(force?:boolean):object|null, recenter():boolean, following():boolean, active():boolean, stop():void}}
 */
export function startTripMap(store, map, opts = {}) {
  const now = typeof opts.now === "function" ? opts.now : nowS;
  const clock = typeof opts.clock === "function" ? opts.clock : () => Date.now();
  let follow = false, wasOn = false, lastKey = "", pending = false, lastFit = -Infinity;
  const call = (name, ...a) => { try { return map && typeof map[name] === "function" ? map[name](...a) : undefined; } catch (e) { console.error("tripmap " + name, e); return undefined; } };

  function frame(y, force) {
    const pts = y.frame || [];
    if (!pts.length) return;
    const key = `${y.phase}|${y.active}`, changed = key !== lastKey;
    const seen = call("inView", pts);
    if (seen === null) { pending = true; return; }   // the sheet covers the map: frame once it goes down
    if (!force && !changed && !pending && (seen !== false || clock() - lastFit < SETTLE_MS)) return;
    lastKey = key; pending = false; lastFit = clock();
    call("fitTo", pts, { maxZoom: pts.length > 1 ? 17 : 16 });
  }

  /** Redraw you on the map (and frame it while following). @returns {object|null} the tripYou drawn */
  function sync(force = false) {
    const s = store.get();
    const on = isPlan(s);
    if (on && !wasOn) { follow = true; lastKey = ""; pending = false; }   // a trip started: follow it
    if (!on) follow = false;
    wasOn = on;
    let y = null;
    try { y = on && s.staticLoaded !== false ? tripYou(tripNow(s, now()), s) : null; } catch (e) { console.error("tripmap", e); y = null; }
    call("setTrip", y);
    if (y && follow) frame(y, force);
    return y;
  }

  const offStore = store.subscribe((s, changed) => { if (!changed || WATCH.some((k) => changed.has(k))) sync(); });
  const offMove = call("onUserMove", () => { if (follow) { follow = false; pending = false; } });
  const offInset = bus.on ? bus.on("sheet:inset", () => { if (follow && pending) sync(); }) : null;
  sync();
  return {
    sync,
    /** Locate button during a trip: follow again and frame now. @returns {boolean} a trip is on */
    recenter() {
      if (!isPlan(store.get())) return false;
      follow = true; lastKey = ""; lastFit = -Infinity;
      sync(true);
      return true;
    },
    following: () => follow,
    active: () => isPlan(store.get()),
    stop() {
      try { offStore && offStore(); } catch (e) { /* */ }
      try { typeof offMove === "function" && offMove(); } catch (e) { /* */ }
      try { typeof offInset === "function" && offInset(); } catch (e) { /* */ }
      call("setTrip", null);
    },
  };
}

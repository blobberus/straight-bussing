// Live Passio GTFS-realtime JSON feeds. Never cached (stale bus data is unsafe).
// Failure keeps the last good data and sets failed:true so the UI can show it.
// store.buses holds only vehicles that are operating (core/operating.js): ghosts that stopped
// reporting, unknown routes and buses on out-of-service routes without predictions are dropped here,
// so the map, route detail, counts, alerts and planner never show them. Buses that have not followed their
// route for a long time (core/offroute.js: garage runs, parked off the line) and buses that are idle and not in
// service (core/idle.js: parked for a long time, past their listed hours, lingering at the end of a shift) are dropped
// too, with their trip updates, so no arrival time comes from a bus the map does not show. Trip updates of buses that
// left the feed 15 min ago or more while Passio still predicts them (core/transition.js: a break, a shift end, another
// route) are dropped too, so nothing recommends a bus that has left its route.
import { operatingBuses } from '../core/operating.js';
import { offRouteStep, dropHidden } from '../core/offroute.js';
import { idleStep } from '../core/idle.js';
import { goneStep } from '../core/transition.js';

/** Passio feed base URL. */
export const BASE = 'https://passio3.com/chicago/passioTransit/gtfs/realtime/';
/** Feed names fetched each poll. */
export const FEEDS = Object.freeze(['vehiclePositions', 'tripUpdates', 'serviceAlerts']);
/**
 * ONE poll that answers with no bus at all, while buses reported at most this long ago (s), keeps the last list:
 * Passio sometimes sends an empty vehicle list for a poll in the middle of service (DC-015,
 * docs/DATA-COLLECTION-LOG.md), which would make every bus vanish and jump back 10 s later. The next empty answer is
 * believed (rider safety: "No shuttles are reporting live locations" is at most one poll late). Each bus keeps its own
 * report time, so stale dimming and core/operating.js work as before.
 */
export const EMPTY_HOLD_S = 30;

const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const timeObj = (o) => (o && o.time != null ? { ...o, time: toNum(o.time) } : o);

/**
 * Normalize a vehiclePositions feed into store.buses.
 * @param {any} j parsed feed
 * @returns {object[]} vehicles that have a position
 */
export function parseBuses(j) {
  return (Array.isArray(j?.entity) ? j.entity : []).map((e) => e && e.vehicle).filter((v) => v && v.position)
    .map((v) => ({ ...v, timestamp: toNum(v.timestamp) }));
}

/**
 * Normalize a tripUpdates feed into store.trips (times coerced to numbers).
 * @param {any} j parsed feed
 * @returns {object[]}
 */
export function parseTrips(j) {
  return (Array.isArray(j?.entity) ? j.entity : []).map((e) => e && e.trip_update).filter(Boolean)
    .map((t) => ({ ...t, stop_time_update: (Array.isArray(t.stop_time_update) ? t.stop_time_update : [])
      .filter((u) => u && typeof u === 'object')   // one malformed entry must not drop the whole poll
      .map((u) => ({ ...u, arrival: timeObj(u.arrival), departure: timeObj(u.departure) })) }));
}

/**
 * Normalize a serviceAlerts feed into store.alerts.
 * @param {any} j parsed feed
 * @returns {object[]}
 */
export function parseAlerts(j) {
  return (Array.isArray(j?.entity) ? j.entity : []).map((e) => e && e.alert).filter(Boolean);
}

/**
 * Start polling the live feeds into the store.
 * - The 3 feeds are fetched in parallel, cache:'no-store', ?_=<ms> cache-buster, one shared
 *   timeout (default 8 s, AbortController).
 * - Success (vehiclePositions + tripUpdates OK): sets buses/trips/feedTs/lastOk, failed:false.
 *   serviceAlerts failing alone is tolerated (keeps previous alerts).
 * - Failure: keeps the last good data, sets failed:true. Each feed that did succeed is still applied.
 * - liveLoaded:true after the first attempt either way.
 * - Never overlaps polls; pauses while document.hidden (unless keepAlive() says a bus alert needs it) and polls
 *   immediately on visible/online.
 * - After `maxFailures` consecutive failures the interval backs off to `backoffMs`; recovers on success.
 * @param {{get():object, set(patch:object):void}} store
 * @param {{intervalMs?:number, backoffMs?:number, timeoutMs?:number, maxFailures?:number, base?:string, fetch?:typeof fetch, now?:() => number, keepAlive?:() => boolean}} [opts]
 *   now: unix-seconds clock for the in-service check (tests); fetch: also the demo feed (data/demo.js demoFetch);
 *   keepAlive: true = keep polling while the page is hidden (bus alerts with system notifications, ui/notifier.js)
 * @returns {{stop():void, pollNow():Promise<void>, failures():number, delay():number}}
 */
export function startLive(store, opts = {}) {
  const intervalMs = opts.intervalMs ?? 10000;
  const backoffMs = opts.backoffMs ?? 30000;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxFailures = opts.maxFailures ?? 3;
  const base = opts.base ?? BASE;
  const fetchFn = opts.fetch || ((...a) => globalThis.fetch(...a));
  const nowFn = opts.now || (() => Date.now() / 1000);
  const keepAlive = () => { try { return typeof opts.keepAlive === 'function' && !!opts.keepAlive(); } catch (e) { return false; } };
  const doc = typeof document !== 'undefined' ? document : null;
  let timer = 0, inflight = null, ctl = null, fails = 0, stopped = false;
  let lastBuses = [], lastBusesAt = 0;    // the last poll that had buses (EMPTY_HOLD_S); [] once an empty is believed
  let offTracks = {}, offHidden = [];      // core/offroute.js clocks between polls; the vehicles it hides now
  let idleTracks = {}, idleHidden = [];    // core/idle.js still clocks between polls; the vehicles it hides now
  let goneSeen = {}, goneIds = [];         // core/transition.js latest report times; the gone buses whose trip updates drop

  /** Paused: the page is hidden and nothing needs data in the background. */
  const hidden = () => !!(doc && doc.hidden) && !keepAlive();
  const delay = () => (fails >= maxFailures ? Math.max(backoffMs, intervalMs) : intervalMs);

  async function getFeed(name, signal) {
    const r = await fetchFn(base + name + '.json?_=' + Date.now(), { cache: 'no-store', signal });
    if (!r || !r.ok) throw new Error(name + ' HTTP ' + (r ? r.status : '?'));
    const j = await r.json();
    if (!j || typeof j !== 'object') throw new Error(name + ' bad JSON');
    return j;
  }

  function schedule() {
    clearTimeout(timer);
    timer = 0;
    if (stopped || hidden()) return;
    timer = setTimeout(() => { timer = 0; if (!hidden()) pollNow(); }, delay());
  }

  async function run() {
    ctl = new AbortController();
    const c = ctl;
    const to = setTimeout(() => c.abort(), timeoutMs);
    let res;
    try {
      res = await Promise.allSettled(FEEDS.map((f) => getFeed(f, c.signal)));
    } finally { clearTimeout(to); }
    if (stopped) return;
    const [vp, tu, sa] = res;
    const patch = { liveLoaded: true };
    if (vp.status === 'fulfilled') {
      let list = parseBuses(vp.value);
      const t = nowFn();
      if (list.length) { lastBuses = list; lastBusesAt = t; }
      else if (lastBuses.length && t - lastBusesAt <= EMPTY_HOLD_S) { list = lastBuses; lastBuses = []; }   // one odd empty answer
      else lastBuses = [];
      patch.buses = list;
      patch.feedTs = toNum(vp.value.header?.timestamp) || store.get().feedTs || 0;
    }
    if (tu.status === 'fulfilled') {
      patch.trips = parseTrips(tu.value);
      if (vp.status !== 'fulfilled' && tu.value.header?.timestamp) patch.feedTs = toNum(tu.value.header.timestamp);
    }
    if (sa.status === 'fulfilled') patch.alerts = parseAlerts(sa.value);
    if (patch.buses) {
      const s = store.get();
      const g = goneStep(goneSeen, patch.buses, patch.trips || s.trips, { feedTs: patch.feedTs, nowS: nowFn() });
      goneSeen = g.seen;
      goneIds = g.gone;
      patch.buses = operatingBuses(patch.buses, { routes: s.routes, service: s.service, trips: patch.trips || s.trips,
        feedTs: patch.feedTs, nowS: nowFn(), staticLoaded: s.staticLoaded });
      const off = offRouteStep(offTracks, patch.buses, { shapes: s.shapes, service: s.service, alerts: patch.alerts || s.alerts,
        routes: s.routes, nowS: nowFn(), feedTs: patch.feedTs });
      offTracks = off.tracks;
      offHidden = off.hidden;
      const idle = idleStep(idleTracks, patch.buses, { trips: patch.trips || s.trips, service: s.service, idle: s.idle,
        nowS: nowFn(), feedTs: patch.feedTs });
      idleTracks = idle.tracks;
      idleHidden = idle.hidden;
      if ((offHidden.length || idleHidden.length || goneIds.length) && !patch.trips) patch.trips = s.trips;   // the store's trips still list a newly hidden bus
    }
    const hiddenNow = offHidden.concat(idleHidden, goneIds);
    if (hiddenNow.length && (patch.buses || patch.trips)) {
      const d = dropHidden(patch.buses, patch.trips, hiddenNow);
      if (patch.buses) patch.buses = d.buses;
      if (patch.trips) patch.trips = d.trips;
    }
    const ok = vp.status === 'fulfilled' && tu.status === 'fulfilled';
    if (ok) { fails = 0; patch.lastOk = Date.now() / 1000; patch.failed = false; }
    else {
      fails++;
      patch.failed = true;
      console.warn('live poll failed', (vp.reason || tu.reason)?.message || '');
    }
    store.set(patch);
  }

  /**
   * Poll now (joins the in-flight poll instead of overlapping), then reschedule.
   * @returns {Promise<void>}
   */
  function pollNow() {
    if (stopped) return Promise.resolve();
    if (inflight) return inflight;
    clearTimeout(timer);
    timer = 0;
    inflight = run().catch((e) => {
      console.warn('live poll error', e);
      if (!stopped) { fails++; store.set({ liveLoaded: true, failed: true }); }   // an unreadable poll is a failed one: never "loading" forever
    })
      .finally(() => { inflight = null; ctl = null; schedule(); });
    return inflight;
  }

  const onVis = () => {
    if (stopped) return;
    if (doc?.hidden) { if (hidden()) { clearTimeout(timer); timer = 0; } } else pollNow();   // hidden + keepAlive: keep the schedule
  };
  const onOnline = () => { if (!stopped && !hidden()) pollNow(); };
  doc?.addEventListener('visibilitychange', onVis);
  globalThis.addEventListener?.('online', onOnline);

  if (!hidden()) pollNow(); // started hidden: first poll happens on visibilitychange

  return {
    /** Stop polling, abort any in-flight request, remove listeners. */
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = 0;
      ctl?.abort();
      doc?.removeEventListener('visibilitychange', onVis);
      globalThis.removeEventListener?.('online', onOnline);
    },
    pollNow,
    /** @returns {number} consecutive failed polls */
    failures: () => fails,
    /** @returns {number} current poll interval in ms */
    delay,
  };
}

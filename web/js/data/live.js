// Live Passio GTFS-realtime JSON feeds. Never cached (stale bus data is unsafe).
// Failure keeps the last good data and sets failed:true so the UI can show it.
// store.buses holds only vehicles that are operating (core/operating.js): ghosts that stopped
// reporting, unknown routes and buses on out-of-service routes without predictions are dropped here,
// so the map, route detail, counts, alerts and planner never show them.
import { operatingBuses } from '../core/operating.js';

/** Passio feed base URL. */
export const BASE = 'https://passio3.com/chicago/passioTransit/gtfs/realtime/';
/** Feed names fetched each poll. */
export const FEEDS = Object.freeze(['vehiclePositions', 'tripUpdates', 'serviceAlerts']);

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
      patch.buses = parseBuses(vp.value);
      patch.feedTs = toNum(vp.value.header?.timestamp) || store.get().feedTs || 0;
    }
    if (tu.status === 'fulfilled') {
      patch.trips = parseTrips(tu.value);
      if (vp.status !== 'fulfilled' && tu.value.header?.timestamp) patch.feedTs = toNum(tu.value.header.timestamp);
    }
    if (sa.status === 'fulfilled') patch.alerts = parseAlerts(sa.value);
    if (patch.buses) {
      const s = store.get();
      patch.buses = operatingBuses(patch.buses, { routes: s.routes, service: s.service, trips: patch.trips || s.trips,
        feedTs: patch.feedTs, nowS: nowFn(), staticLoaded: s.staticLoaded });
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
    inflight = run().catch((e) => { console.warn('live poll error', e); })
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

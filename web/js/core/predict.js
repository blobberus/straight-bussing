/**
 * @module core/predict
 * Ride-time estimates: scheduled seconds per segment (data/segments.json), refined by learned
 * medians (data/learned.json, optional, 404 tolerated). No DOM. Never throws.
 *
 * predict.ready                                   Promise<void>, always resolves (even offline)
 * predict.rideMinutes(rid, fromStopId, toStopId, whenTs?)
 *   -> {min:number|null, source:'schedule'|'learned', conf:0..1, p10?:number, p90?:number}
 *   whenTs: unix seconds or ms (default now). min is a float ESTIMATE; min:null when unknown.
 *   p10/p90 (minutes) only when a learned model is loaded.
 * predict.etaAdjust(rid, stopId, passioMin, whenTs?) -> {min, source, conf}
 *   optional correction of Passio's own ETA with the learned per-route bias (needs n >= 30).
 * createPredict({segments, routeStops, learned}) builds the same API from in-memory data (tests).
 *
 * Inputs
 *   segments.json  {v:1, routes:{rid:{seg:[sec per consecutive stop pair], dwell?:sec, hw?:headwayMin}}}
 *   route_stops.json {rid:[stopId,...]}  first == last means a loop (wraps)
 *   learned.json   written by tools/learn.py (v1) or tools/model_segments.py export_learned (v2):
 *     {v:1|2, k:shrinkage (default 5), sigma?:global log-sd, kind?, generated?,
 *      routes:{rid:{
 *        s:{"<segIdx>":{
 *            a:[medianRunSec, n, p10Sec?, p90Sec?, sigma?],   // all-hours; v1 has only [med, n]
 *            h?:{"<howBucket>":[medianRunSec, n]},             // hour-of-week bucket (v2: already shrunk
 *                                                               //  toward the segment's all-hours median)
 *            d?:meters, v?:m/s}},
 *        dw?:medianDwellSec}},
 *      bias?:{rid:{m:multiplier, a:addSec, n:count}}}
 *     segIdx i is the segment route_stops[rid][i] -> route_stops[rid][i+1].
 *     howBucket = dow*24 + hour in America/Chicago, Monday = 0 (0..167).
 * Blending per segment: e = h[how] if present else a; w = n/(n+k) with n = a.n (or bucket n in v1);
 *   sec = w*e + (1-w)*schedule  (e alone if no schedule). Quantiles scale with sec/aMedian; missing
 *   quantiles use the global sigma (lognormal, z = 1.2816). Segment spreads combine halfway between
 *   independent (root-sum-square) and fully correlated (sum).
 */

const K_DEFAULT = 5;
const Z80 = 1.2816;
const DEFAULT_SIGMA = 0.3;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
let howFmt = null;

/**
 * Hour-of-week bucket in America/Chicago, Monday 00:00 = 0. null if unavailable.
 * @param {number} ts unix seconds or ms
 * @returns {number|null}
 */
export function howBucket(ts) {
  try {
    const d = new Date(ts < 1e12 ? ts * 1000 : ts);
    if (!howFmt) howFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", hour12: false });
    let wd = "", h = 0;
    for (const p of howFmt.formatToParts(d)) {
      if (p.type === "weekday") wd = p.value;
      if (p.type === "hour") h = parseInt(p.value, 10) % 24;
    }
    const dow = DAYS.indexOf(wd);
    return dow < 0 ? null : dow * 24 + h;
  } catch (e) {
    return null;
  }
}

/** Segment indices along route order from -> to (shortest forward path, loops wrap), or null. */
function segPath(order, from, to) {
  const n = order.length;
  if (n < 2 || from === to) return null;
  const loop = n > 2 && order[0] === order[n - 1];
  const nSeg = n - 1;
  let best = null;
  for (let i = 0; i < nSeg; i++) {
    if (order[i] !== from) continue;
    let steps = -1;
    for (let s = 1; s <= nSeg; s++) {
      const k = i + s;
      if (!loop && k > nSeg) break;
      if (order[loop ? k % nSeg : k] === to) { steps = s; break; }
    }
    if (steps > 0 && (!best || steps < best.length)) {
      best = [];
      for (let s = 0; s < steps; s++) best.push((i + s) % nSeg);
    }
  }
  return best;
}

/**
 * Build a predictor from in-memory data. Never throws.
 * @param {{segments?:Object, routeStops?:Object, learned?:Object}} data
 * @returns {{rideMinutes:Function, etaAdjust:Function}}
 */
export function createPredict({ segments, routeStops, learned } = {}) {
  const seg = segments && segments.routes ? segments.routes : null;
  const order = routeStops || null;
  const L = learned && learned.routes ? learned : null;
  const k = (L && Number(L.k) > 0 ? Number(L.k) : K_DEFAULT);
  const gSigma = L && Number(L.sigma) > 0 ? Number(L.sigma) : DEFAULT_SIGMA;

  function segment(rid, idx, how) {
    const sched = seg && seg[rid] && Array.isArray(seg[rid].seg) ? seg[rid].seg[idx] : undefined;
    const s = typeof sched === "number" && isFinite(sched) && sched >= 0 ? sched : null;
    const ent = L && L.routes[rid] && L.routes[rid].s ? L.routes[rid].s[idx] ?? L.routes[rid].s[String(idx)] : null;
    if (ent) {
      const a = Array.isArray(ent.a) ? ent.a : null;
      const hb = how != null && ent.h ? ent.h[how] ?? ent.h[String(how)] : null;
      const e = Array.isArray(hb) && hb[1] > 0 ? hb : a;
      if (e && e[0] > 0 && e[1] > 0) {
        const n = a && a[1] > 0 && e !== a && (L.v || 1) >= 2 ? a[1] : e[1];
        const w = n / (n + k);
        const sec = s === null ? e[0] : w * e[0] + (1 - w) * s;
        let lo, hi;
        if (a && a[2] > 0 && a[3] > 0 && a[0] > 0) {
          const r = sec / a[0];
          lo = a[2] * r; hi = a[3] * r;
        } else {
          const sg = a && a[4] > 0 ? a[4] : gSigma;
          lo = sec * Math.exp(-Z80 * sg); hi = sec * Math.exp(Z80 * sg);
        }
        return { sec, w, learned: true, lo: Math.min(lo, sec), hi: Math.max(hi, sec) };
      }
    }
    if (s === null) return null;
    return { sec: s, w: 0, learned: false, lo: s * Math.exp(-Z80 * gSigma), hi: s * Math.exp(Z80 * gSigma) };
  }

  /**
   * Estimated riding minutes between two stops of a route.
   * @param {string} rid
   * @param {string} fromStopId
   * @param {string} toStopId
   * @param {number} [whenTs] unix s or ms
   * @returns {{min:number|null, source:'schedule'|'learned', conf:number, p10?:number, p90?:number}}
   */
  function rideMinutes(rid, fromStopId, toStopId, whenTs) {
    const none = { min: null, source: "schedule", conf: 0 };
    try {
      rid = String(rid);
      const o = order && Array.isArray(order[rid]) ? order[rid].map(String) : null;
      if (!o || !seg || !seg[rid]) return none;
      const idxs = segPath(o, String(fromStopId), String(toStopId));
      if (!idxs) return none;
      const how = howBucket(whenTs == null ? Date.now() : Number(whenTs));
      const schedDwell = Number(seg[rid].dwell) || 0;
      const lDwell = L && L.routes[rid] && Number(L.routes[rid].dw) >= 0 ? Number(L.routes[rid].dw) : null;
      let total = 0, wsum = 0, anyL = false, dn = 0, up = 0, dn2 = 0, up2 = 0;
      for (let t = 0; t < idxs.length; t++) {
        const r = segment(rid, idxs[t], how);
        if (!r) return none;
        total += r.sec; wsum += r.w; anyL = anyL || r.learned;
        const d = r.sec - r.lo, u = r.hi - r.sec;
        dn += d; up += u; dn2 += d * d; up2 += u * u;
        if (t < idxs.length - 1) total += r.learned && lDwell !== null ? lDwell : schedDwell;
      }
      if (!(total >= 0) || !isFinite(total)) return none;
      const conf = anyL ? 0.45 + 0.5 * (wsum / idxs.length) : 0.4;
      const out = { min: Math.round(Math.max(0.5, total / 60) * 100) / 100, source: anyL ? "learned" : "schedule",
        conf: Math.round(conf * 100) / 100 };
      if (L) {
        const down = (Math.sqrt(dn2) + dn) / 2, upS = (Math.sqrt(up2) + up) / 2;
        out.p10 = Math.round(Math.max(0.25, (total - down) / 60) * 100) / 100;
        out.p90 = Math.round(Math.max(out.min, (total + upS) / 60) * 100) / 100;
        if (out.p10 > out.min) out.p10 = out.min;
      }
      return out;
    } catch (e) {
      return none;
    }
  }

  /**
   * Correct Passio's ETA (minutes) with the learned per-route bias, if well supported.
   * @param {string} rid
   * @param {string} stopId (unused today; kept for per-stop models)
   * @param {number} passioMin
   * @param {number} [whenTs]
   * @returns {{min:number, source:'schedule'|'learned', conf:number}}
   */
  function etaAdjust(rid, stopId, passioMin, whenTs) {
    try {
      const b = L && L.bias && L.bias[String(rid)];
      if (typeof passioMin !== "number" || !b || !(b.n >= 30)) return { min: passioMin, source: "schedule", conf: 0.3 };
      const m = Math.max(0, (b.m || 1) * passioMin + (b.a || 0) / 60);
      return { min: Math.round(m * 100) / 100, source: "learned", conf: Math.min(0.9, 0.4 + b.n / 2000) };
    } catch (e) {
      return { min: passioMin, source: "schedule", conf: 0 };
    }
  }

  return { rideMinutes, etaAdjust };
}

async function getJSON(rel) {
  try {
    const r = await fetch(new URL(rel, import.meta.url), { cache: "no-cache" });
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

let impl = createPredict({});
let readyP = null;

function start() {
  if (!readyP) {
    readyP = Promise.all([getJSON("../../data/segments.json"), getJSON("../../data/route_stops.json"), getJSON("../../data/learned.json")])
      .then(([segments, routeStops, learned]) => {
        impl = createPredict({ segments, routeStops, learned });
      })
      .catch(() => {});
  }
  return readyP;
}

/**
 * Shared predictor. Data loads on first import (web/data/*.json relative to this module).
 * Before `ready` resolves, rideMinutes returns {min:null}.
 */
export const predict = {
  /** @type {Promise<void>} */
  get ready() {
    return start();
  },
  /** @see createPredict rideMinutes */
  rideMinutes(rid, fromStopId, toStopId, whenTs) {
    return impl.rideMinutes(rid, fromStopId, toStopId, whenTs);
  },
  /** @see createPredict etaAdjust */
  etaAdjust(rid, stopId, passioMin, whenTs) {
    return impl.etaAdjust(rid, stopId, passioMin, whenTs);
  },
  /**
   * Replace the data (tests, or a future in-app refresh). Never throws.
   * @param {{segments?:Object, routeStops?:Object, learned?:Object}} data
   */
  setData(data) {
    impl = createPredict(data || {});
  },
};

start();

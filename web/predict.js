/* Predict: ride-time estimates from schedule (data/segments.json) refined by
 * learned medians (data/learned.json, optional). Plain script, no deps, never throws.
 *
 * Predict.ready                      Promise (always resolves)
 * Predict.rideMinutes(route, from, to, whenTs?) -> {min:number|null, source:'schedule'|'learned', conf:0..1}
 *     whenTs = epoch ms or s (default now). min is an ESTIMATE; label it as such in the UI.
 * Predict.etaAdjust(route, stopId, passioMin, whenTs?) -> {min, source, conf}
 *     optional correction of Passio's own ETA using learned per-route bias.
 *
 * learned.json schema (written by tools/learn.py):
 *   {v:1, generated, k:5, routes:{rid:{s:{"<segIdx>":{a:[medSec,n], h:{"<howBucket>":[medSec,n]}}}}},
 *    bias:{rid:{m:mult, a:addSec, n:count}}}
 * howBucket = dow*24 + hour in America/Chicago, dow Monday=0.
 */
(function () {
  "use strict";
  var K_DEFAULT = 5;            // shrinkage strength: weight = n / (n + K)
  var seg = null, learned = null, order = null;

  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  var ready = Promise.all([
    getJSON("data/segments.json"), getJSON("data/route_stops.json"), getJSON("data/learned.json")
  ]).then(function (a) {
    seg = a[0] && a[0].routes ? a[0].routes : null;
    order = a[1];
    learned = a[2] && a[2].routes ? a[2] : null;
  }).catch(function () {});

  var fmt = null;
  function howBucket(ts) {
    try {
      var d = new Date(ts < 1e12 ? ts * 1000 : ts);
      if (!fmt) fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", hour12: false });
      var parts = fmt.formatToParts(d), wd = "", h = 0;
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === "weekday") wd = parts[i].value;
        if (parts[i].type === "hour") h = parseInt(parts[i].value, 10) % 24;
      }
      var dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd);
      return dow < 0 ? null : dow * 24 + h;
    } catch (e) { return null; }
  }

  // Seconds + weight for segment idx of a route. Learned overrides schedule via shrinkage.
  function segSeconds(rid, idx, how) {
    var s = seg[rid] && seg[rid].seg ? seg[rid].seg[idx] : null;
    var L = learned && learned.routes && learned.routes[rid] && learned.routes[rid].s ? learned.routes[rid].s[idx] : null;
    if (L) {
      var k = learned.k || K_DEFAULT;
      var e = (how != null && L.h && L.h[how]) || L.a;   // hour-of-week bucket, else all-hours median
      if (e && e[1] > 0) {
        if (typeof s !== "number") return { sec: e[0], w: e[1] / (e[1] + k), learned: true };
        var w = e[1] / (e[1] + k);
        // an hour bucket is itself shrunk toward the route/segment all-hours median when sparse
        return { sec: w * e[0] + (1 - w) * s, w: w, learned: true };
      }
    }
    return typeof s === "number" ? { sec: s, w: 0, learned: false } : null;
  }

  function rideMinutes(rid, from, to, whenTs) {
    var none = { min: null, source: "schedule", conf: 0 };
    try {
      rid = String(rid); from = String(from); to = String(to);
      var o = order && order[rid];
      if (!o || !seg || !seg[rid]) return none;
      var n = o.length, i = o.indexOf(from);
      if (i < 0 || from === to) return none;
      var loop = n > 2 && o[0] === o[n - 1];
      var j = -1, t;
      for (t = i + 1; t < n; t++) if (o[t] === to) { j = t; break; }
      var idxs = [], d;
      if (j >= 0) { for (d = i; d < j; d++) idxs.push(d); }
      else if (loop) {                       // wrap around the loop
        j = o.indexOf(to);
        if (j < 0) return none;
        for (d = i; d < n - 1; d++) idxs.push(d);
        for (d = 0; d < j; d++) idxs.push(d);
      } else return none;
      var ts = whenTs == null ? Date.now() : whenTs, how = howBucket(ts);
      var total = 0, wsum = 0, anyL = false;
      for (t = 0; t < idxs.length; t++) {
        var r = segSeconds(rid, idxs[t], how);
        if (!r) return none;
        total += r.sec; wsum += r.w; anyL = anyL || r.learned;
      }
      var dwell = seg[rid].dwell || 0;
      total += dwell * Math.max(0, idxs.length - 1);
      var conf = anyL ? 0.45 + 0.5 * (wsum / idxs.length) : 0.4;
      return { min: Math.max(1, Math.round(total / 60)), source: anyL ? "learned" : "schedule", conf: Math.round(conf * 100) / 100 };
    } catch (e) { return none; }
  }

  function etaAdjust(rid, stopId, passioMin, whenTs) {
    try {
      var b = learned && learned.bias && learned.bias[String(rid)];
      if (typeof passioMin !== "number" || !b || !(b.n >= 30)) return { min: passioMin, source: "schedule", conf: 0.3 };
      var m = Math.max(0, (b.m || 1) * passioMin + (b.a || 0) / 60);
      return { min: Math.round(m), source: "learned", conf: Math.min(0.9, 0.4 + b.n / 2000) };
    } catch (e) { return { min: passioMin, source: "schedule", conf: 0 }; }
  }

  window.Predict = { ready: ready, rideMinutes: rideMinutes, etaAdjust: etaAdjust };
})();

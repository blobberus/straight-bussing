"use strict";
/* Trip planner: walk + direct shuttle or one transfer. Pure logic, no DOM.
   Planner.plan({from:{lat,lon}, to:{lat,lon}, now:<unix s>, data:{stops,routes,routeStops,trips,buses}}) */
(function () {
  const WALK_M_MIN = 80, DETOUR = 1.2, MAX_WALK = 800, XFER_M = 150, SPEED_M_MIN = 18000 / 60, MAX_OPTS = 3;
  const rad = Math.PI / 180;
  function hav(a, b) {
    const dLa = (b.lat - a.lat) * rad, dLo = (b.lon - a.lon) * rad;
    const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLo / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(x));
  }
  const walkM = (a, b) => hav(a, b) * DETOUR;
  const walkMin = (m) => m / WALK_M_MIN;

  // Stop order of a representative trip. If first == last it is a loop and wraps.
  function seqOf(list) {
    const ids = (list || []).slice();
    const loop = ids.length > 2 && ids[0] === ids[ids.length - 1];
    if (loop) ids.pop();
    return { ids, loop };
  }
  // Forward index path i -> j (inclusive) or null.
  function pathIdx(seq, i, j) {
    const n = seq.ids.length; if (i === j) return null;
    const out = [i];
    if (seq.loop) { for (let k = (i + 1) % n; ; k = (k + 1) % n) { out.push(k); if (k === j) break; if (out.length > n) return null; } }
    else { if (j < i) return null; for (let k = i + 1; k <= j; k++) out.push(k); }
    return out;
  }

  function plan(opts) {
    const { from, to } = opts, t0 = opts.now || Date.now() / 1000, D = opts.data || {};
    const stops = D.stops || {}, trips = D.trips || [], buses = D.buses || [];
    const P = (typeof window !== "undefined" && window.Predict) || null;
    const pt = (id) => ({ id, name: stops[id]?.name || id, lat: stops[id].lat, lon: stops[id].lon });
    const walkOnlyM = walkM(from, to);
    const result = { options: [], walkOnly: { m: Math.round(walkOnlyM), min: Math.max(1, Math.round(walkMin(walkOnlyM))) } };

    const cache = new Map();
    function ride(rid, seq, path) { // minutes for stop index path
      const a = seq.ids[path[0]], b = seq.ids[path[path.length - 1]], key = rid + "|" + a + "|" + b;
      if (cache.has(key)) return cache.get(key);
      let r = null;
      try { const p = P && P.rideMinutes && P.rideMinutes(rid, a, b); if (p && typeof p.min === "number" && isFinite(p.min)) r = { min: Math.max(1, p.min), source: p.source || "schedule", conf: p.conf ?? 0.5 }; } catch (e) { /* fall through */ }
      if (!r) { let m = 0; for (let k = 1; k < path.length; k++) m += hav(stops[seq.ids[path[k - 1]]], stops[seq.ids[path[k]]]); r = { min: Math.max(1, m / SPEED_M_MIN), source: "estimate", conf: 0.3 }; }
      cache.set(key, r); return r;
    }
    const nBuses = {}; for (const v of buses) { const r = v.trip?.route_id; if (r) nBuses[r] = (nBuses[r] || 0) + 1; }
    function cycleMin(rid, seq) { const n = seq.ids.length; let m = 0; for (let k = 1; k < n; k++) m += hav(stops[seq.ids[k - 1]], stops[seq.ids[k]]); if (seq.loop && n > 1) m += hav(stops[seq.ids[n - 1]], stops[seq.ids[0]]); return Math.max(5, (seq.loop ? m : 2 * m) / SPEED_M_MIN); }
    function liveAt(rid, stopId, after) {
      let best = null;
      for (const tu of trips) { if (tu.trip?.route_id !== rid) continue;
        for (const u of tu.stop_time_update || []) { if (u.stop_id !== stopId) continue; const t = u.arrival?.time || u.departure?.time; if (t && t >= after - 20 && (best === null || t < best)) best = t; } }
      return best;
    }
    // wait in minutes before boarding at stopId when ready at time readyT, or null if route doesn't look to be running
    function wait(rid, seq, stopId, readyT) {
      const t = liveAt(rid, stopId, readyT);
      if (t !== null) return { min: Math.max(0, (t - readyT) / 60), live: true };
      const n = nBuses[rid]; if (!n) return null;
      return { min: Math.min(30, Math.max(1, cycleMin(rid, seq) / n / 2)), live: false };
    }

    const seqs = {}, near = {};
    for (const rid of Object.keys(D.routeStops || {})) {
      const seq = seqs[rid] = seqOf(D.routeStops[rid]); const bo = [], al = [];
      seq.ids.forEach((id, i) => { const s = stops[id]; if (!s) return;
        const d1 = walkM(from, s), d2 = walkM(to, s); if (d1 <= MAX_WALK) bo.push({ i, d: d1 }); if (d2 <= MAX_WALK) al.push({ i, d: d2 }); });
      near[rid] = { bo, al };
    }

    const cands = [];
    const legWalk = (a, b, m, label) => ({ type: "walk", from: a, to: b, m: Math.round(m), min: walkMin(m), label });
    const label = (p, name) => ({ lat: p.lat, lon: p.lon, name });
    function busLeg(rid, seq, path, w, r) {
      const ids = path.map((k) => seq.ids[k]);
      return { type: "bus", rid, board: pt(ids[0]), alight: pt(ids[ids.length - 1]), path: ids.map((id) => ({ lat: stops[id].lat, lon: stops[id].lon })), stopsPassed: ids.length - 1,
        wait: w.min, waitLive: w.live, ride: r.min, source: r.source, conf: r.conf };
    }

    for (const rid of Object.keys(seqs)) {
      const seq = seqs[rid], { bo, al } = near[rid]; if (!bo.length || !al.length) continue;
      let best = null;
      for (const b of bo) {
        const w1 = walkMin(b.d), ready = t0 + w1 * 60, w = wait(rid, seq, seq.ids[b.i], ready); if (!w) continue;
        for (const a of al) {
          const path = pathIdx(seq, b.i, a.i); if (!path) continue;
          const r = ride(rid, seq, path), total = w1 + w.min + r.min + walkMin(a.d);
          if (!best || total < best.total) best = { total, b, a, path, w, r };
        }
      }
      if (best) {
        const bl = busLeg(rid, seq, best.path, best.w, best.r), legs = [];
        if (best.b.d >= 25) legs.push(legWalk(label(from, "Start"), bl.board, best.b.d));
        legs.push(bl);
        if (best.a.d >= 25) legs.push(legWalk(bl.alight, label(to, "Destination"), best.a.d));
        cands.push({ legs, total: best.total, key: rid });
      }
    }

    // one transfer
    const rids = Object.keys(seqs);
    for (const A of rids) {
      const sa = seqs[A]; if (!near[A].bo.length) continue;
      for (const B of rids) {
        if (B === A || !near[B].al.length) continue;
        const sb = seqs[B]; let best = null;
        // transfer points: stops of B close to a stop of A
        const links = [];
        sa.ids.forEach((ida, k) => { const s = stops[ida]; if (!s) return; sb.ids.forEach((idb, m) => { const o = stops[idb]; if (!o) return; const d = ida === idb ? 0 : hav(s, o) * DETOUR; if (d <= XFER_M) links.push({ k, m, d }); }); });
        if (!links.length) continue;
        for (const b of near[A].bo) {
          const w1 = walkMin(b.d), ready = t0 + w1 * 60, wa = wait(A, sa, sa.ids[b.i], ready); if (!wa) continue;
          for (const L of links) {
            const pa = pathIdx(sa, b.i, L.k); if (!pa) continue;
            const ra = ride(A, sa, pa), tArr = ready + (wa.min + ra.min) * 60, ready2 = tArr + walkMin(L.d) * 60, wb = wait(B, sb, sb.ids[L.m], ready2); if (!wb) continue;
            for (const a of near[B].al) {
              const pb = pathIdx(sb, L.m, a.i); if (!pb) continue;
              const rb = ride(B, sb, pb), total = w1 + wa.min + ra.min + walkMin(L.d) + wb.min + rb.min + walkMin(a.d);
              if (!best || total < best.total) best = { total, b, a, L, pa, pb, wa, ra, wb, rb };
            }
          }
        }
        if (best) {
          const l1 = busLeg(A, sa, best.pa, best.wa, best.ra), l2 = busLeg(B, sb, best.pb, best.wb, best.rb), legs = [];
          if (best.b.d >= 25) legs.push(legWalk(label(from, "Start"), l1.board, best.b.d));
          legs.push(l1);
          if (best.L.d > 0) legs.push(legWalk(l1.alight, l2.board, best.L.d));
          legs.push(l2);
          if (best.a.d >= 25) legs.push(legWalk(l2.alight, label(to, "Destination"), best.a.d));
          cands.push({ legs, total: best.total, key: A + ">" + B });
        }
      }
    }

    cands.sort((x, y) => x.total - y.total);
    for (const c of cands) {
      if (result.options.length >= MAX_OPTS) break;
      if (c.total > result.walkOnly.min + 45) continue; // absurdly longer than walking
      c.arrive = t0 + c.total * 60; c.totalMin = Math.max(1, Math.round(c.total)); result.options.push(c);
    }
    return result;
  }
  window.Planner = { plan, hav };
})();

/**
 * RouteKnower E32: runs one real episode of fixtures/display_episodes.json through the SHIPPED live pipeline
 * (data/live.js startLive with a stub fetch: core/operating.js, core/transition.js, core/offroute.js, core/idle.js,
 * core/busnum.js) on the episode's own static slices, poll by poll on the feed's clock, and says what a rider saw.
 * Shared by the test (data-display.js) and display-golden.html (experiments/routeknower/E32-scripts/make_fixtures.py
 * --expect stores its answers). Not a test page.
 */
import { startLive } from "../js/data/live.js";
import { cleanSlice, deriveStopRoutes } from "../js/data/static.js";
import { arrivalsFor } from "../js/core/arrivals.js";
import { busKey } from "../js/core/busnum.js";
import { plan } from "../js/core/planner.js";

const hms0 = (t) => new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hourCycle: "h23" });

/** Spans [from, to] (clock times) of the polls where pred(i) holds; a span ends at the last poll that held. */
function spans(polls, pred, hms) {
  const out = [];
  let open = null;
  polls.forEach((p, i) => {
    if (pred(i)) { if (!open) out.push((open = [hms(p.h), hms(p.h)])); else open[1] = hms(p.h); }
    else open = null;
  });
  return out;
}

/**
 * @param {object} fx the fixture file (routes, idle and static shared by every case)
 * @param {object} c one case: {name, bus, routes, stop, t0, snaps, alerts, polls:[{h, v:[[id, trip, rid, lat, lon,
 *   report time]], u:[snap index], a:[alert index]}], plan?}; every time is seconds after t0 (fx.static: the app's
 *   static slices that day, shared by the cases)
 * @returns {Promise<{polls:Array, story:object}>} polls[i] = [shown ids on the case's routes, ids whose times are kept,
 *   ids away (off route), {id: number} on the case's routes, vehicle of the next time at c.stop on c.routes[0]]
 */
export async function runCase(fx, c) {
  const st = fx.static || {}, T = Number(c.t0) || 0;   // every time in a case is seconds after its t0
  const state = {
    routes: cleanSlice("routes", fx.routes), idle: cleanSlice("idle", fx.idle), shapes: cleanSlice("shapes", st.shapes || {}),
    corridors: cleanSlice("corridors", st.corridors || {}), service: cleanSlice("service", st.service || {}),
    stops: cleanSlice("stops", st.stops || {}), routeStops: cleanSlice("routeStops", st.routeStops || {}),
  };
  state.stopRoutes = deriveStopRoutes(state.routeStops);
  state.staticLoaded = true;
  const store = { get: () => state, set: (p) => { Object.assign(state, p); } };
  let cur = c.polls[0];
  const feeds = {
    vehiclePositions: (p) => ({ header: { timestamp: T + p.h }, entity: p.v.map(([id, trip, rid, lat, lon, vt]) => ({ vehicle: {
      vehicle: { id }, trip: { trip_id: trip, route_id: rid }, position: { latitude: lat, longitude: lon }, timestamp: T + vt } })) }),
    tripUpdates: (p) => ({ header: { timestamp: T + p.h }, entity: p.u.map((i) => { const [veh, trip, rid, stops] = c.snaps[i]; return { trip_update: {
      trip: { trip_id: trip, route_id: rid }, vehicle: { id: veh }, stop_time_update: stops.map(([s, t]) => ({ stop_id: s, arrival: { time: T + t } })) } }; }) }),
    serviceAlerts: (p) => ({ header: { timestamp: T + p.h }, entity: (p.a || []).map((i) => ({ alert: c.alerts[i] })) }),
  };
  const fetch = async (url) => {
    const body = feeds[String(url).replace(/^stub\//, "").split(".json")[0]](cur);
    return { ok: true, status: 200, json: async () => body };
  };
  const routes = new Set(c.routes.map(String));
  const live = startLive(store, { fetch, base: "stub/", intervalMs: 2e9, now: () => T + cur.h });
  const polls = [];
  let planned = null;
  try {
    await live.pollNow();
    for (let i = 0; i < c.polls.length; i++) {
      cur = c.polls[i];
      if (i > 0) await live.pollNow();
      const shown = (state.buses || []).filter((b) => routes.has(String(b.trip.route_id))).map(busKey).sort();
      const kept = [...new Set((state.trips || []).map((t) => t.vehicle && t.vehicle.id).filter((v) => v != null).map(String))].sort();
      const away = (state.away || []).map(busKey).sort();
      const nums = {};
      for (const r of routes) Object.assign(nums, (state.busNums && state.busNums.routes && state.busNums.routes[r]) || {});
      const next = c.stop ? arrivalsFor(state, c.stop, { routeId: c.routes[0], nowS: T + cur.h })[0] : null;
      polls.push([shown, kept, away, nums, next ? next.vehicleId : null]);
      if (c.plan && cur.h === c.plan.at) {
        const from = state.stops[c.plan.from], to = state.stops[c.plan.to];
        const res = plan({ from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon }, now: T + cur.h,
          data: { stops: state.stops, routes: state.routes, routeStops: state.routeStops, trips: state.trips, buses: state.buses, service: state.service } });
        planned = res.options.map((o) => o.legs.filter((l) => l.type === "bus").map((l) => [String(l.rid), l.vehicleId == null ? null : String(l.vehicleId),
          String(l.board.id), String(l.alight.id), l.waitLive ? "live" : "est", Math.round((l.boardT - T - cur.h) / 60), Math.round((l.alightT - T - cur.h) / 60)]));
      }
    }
  } finally {
    live.stop();
  }
  const B = String(c.bus);
  const hms = (t) => hms0(T + t);
  const numCh = [];
  polls.forEach((p, i) => { const n = p[3][B] || 0; if (!numCh.length || numCh[numCh.length - 1][1] !== n) numCh.push([hms(c.polls[i].h), n]); });
  let swaps = 0;
  for (let i = 1; i < polls.length; i++) {
    for (const [k, n] of Object.entries(polls[i][3])) if (polls[i - 1][3][k] && n && polls[i - 1][3][k] !== n && polls[i - 1][0].includes(k) && polls[i][0].includes(k)) swaps++;
  }
  const story = {
    shown: spans(c.polls, (i) => polls[i][0].includes(B), hms),
    times: spans(c.polls, (i) => polls[i][1].includes(B), hms),
    away: spans(c.polls, (i) => polls[i][2].includes(B), hms),
    next_at_stop: c.stop ? spans(c.polls, (i) => polls[i][4] === B, hms) : [],
    number: numCh,
    swaps,
    ...(c.plan ? { plan: planned } : {}),
  };
  return { polls, story };
}

// Fixture state + stub ctx for the D2 view tests (views.test.html).
import { createStore } from "../js/core/store.js";

export const NOW = 1_800_000_000;

/** A tiny network: 3 routes (one with hostile strings), 5 stops, live trips/buses. */
export function fixture(over = {}) {
  const routes = {
    R1: { short: "R1", long: "Red Line", color: "#C4291C", text_color: "#FFFFFF" },
    R2: { short: "B", long: "Blue Loop", color: "#0A84FF", text_color: "#FFFFFF" },
    R3: { short: "<X>", long: "<script>alert(1)</script>", color: "javascript:alert(1)", text_color: "" },
  };
  const stops = {
    S1: { name: "Main & 1st", lat: 41.79, lon: -87.6 },
    S2: { name: "Library", lat: 41.792, lon: -87.6 },
    S3: { name: "Hospital", lat: 41.795, lon: -87.595 },
    S4: { name: "Far Stop", lat: 41.9, lon: -87.6 },
    S5: { name: "Orphan", lat: 41.7905, lon: -87.6005 },
  };
  const routeStops = { R1: ["S1", "S2", "S3"], R2: ["S3", "S2", "S4", "S3"], R3: ["S1", "S3"] };
  const stopRoutes = {};
  for (const [rid, ids] of Object.entries(routeStops)) for (const id of new Set(ids)) (stopRoutes[id] ||= []).push(rid);
  const trip = (id, rid, label, list) => ({ trip: { trip_id: id, route_id: rid }, vehicle: { id: "v" + id, label }, stop_time_update: list.map(([s, dt]) => ({ stop_id: s, arrival: { time: NOW + dt } })) });
  const trips = [
    trip("t1", "R1", "101", [["S1", 120], ["S2", 300], ["S3", 600]]),
    trip("t2", "R2", "202", [["S3", 30], ["S2", 240], ["S4", 900]]),
    trip("t3", "R1", "103", [["S1", 1500]]),
    trip("t4", "R3", "303", [["S1", 400], ["S3", 700]]),
  ];
  const buses = [
    { vehicle: { id: "v1", label: "101" }, position: { latitude: 41.789, longitude: -87.6, bearing: 0, speed: 5 }, trip: { trip_id: "t1", route_id: "R1" }, timestamp: NOW - 5, stop_id: "S1", current_stop_sequence: 1 },
    { vehicle: { id: "v2", label: "202" }, position: { latitude: 41.796, longitude: -87.595, bearing: 0, speed: 5 }, trip: { trip_id: "t2", route_id: "R2" }, timestamp: NOW - 5, stop_id: "S3", current_stop_sequence: 1 },
  ];
  return {
    routes, stops, shapes: { R1: [[[41.79, -87.6], [41.795, -87.595]]] }, routeStops, stopRoutes,
    addresses: { S1: { address: "1301 East 53rd Street" } },
    staticLoaded: true,
    buses, trips,
    alerts: [],
    feedTs: NOW - 5, lastOk: NOW - 5, failed: false, liveLoaded: true,
    user: null, locState: "unknown", hiddenRoutes: [], theme: "auto",
    view: "nearby", prevView: null, stopId: null, routeId: null, routeFilter: null,
    ...over,
  };
}

/** Stub ctx: real store, recording map, navigate that writes store.view. */
export function makeCtx(over = {}, opts = {}) {
  const store = createStore(fixture(over));
  const calls = { highlight: [], drawPlan: [], fitTo: [], flyTo: [], navigate: [], toast: [], locate: 0 };
  const map = {
    highlightStops: (items, o) => calls.highlight.push({ items, o }),
    drawPlan: (o, d) => calls.drawPlan.push(o),
    fitTo: (p, o) => calls.fitTo.push(p),
    flyTo: (p, z) => calls.flyTo.push(p),
    setSelectedStop: () => {},
  };
  const ctx = {
    store, map, calls,
    now: () => NOW,
    navigate: (view, p = {}) => { calls.navigate.push([view, p]); store.set({ view, stopId: p.stopId ?? null, routeId: p.routeId ?? null }); return true; },
    back: () => {},
    setDetent: () => {},
    toast: (t) => calls.toast.push(t),
    locate: async () => {
      calls.locate++;
      const res = opts.locateResult ?? false;
      store.set(res ? { user: res, locState: "granted" } : { locState: "denied" });
      return !!res;
    },
  };
  return ctx;
}

/** Wait for the store microtask flush + pending promise callbacks. */
export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A fresh attached root element. */
export function root() {
  const el = document.createElement("div");
  el.className = "testroot";
  document.body.appendChild(el);
  return el;
}

/** Type into an input and fire an input event. */
export function type(el, text) {
  el.focus();
  el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

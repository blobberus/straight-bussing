// Fixtures for the Current trip timeline (core/tripprogress.js + ui/views/tripprogress.js):
// a straight north-south line R (A0..A8, ~222 m apart), a loop G (B0..B3) for transfers and wraps,
// and one scene per trip phase. Used by core-tripprogress.js, trip-view.js and the demo in trip.test.html.

export const NOW = 1_800_000_000;
const LAT0 = 41.79, DLAT = 0.002, LON = -87.6;
const NAMES = ["55th & Ellis", "56th & Ellis", "57th & Ellis", "Regenstein Library", "Ratner Center", "58th & Ellis", "59th & Ellis", "Medical Center", "60th & Ellis"];

export const stops = {};
NAMES.forEach((name, i) => { stops["A" + i] = { name, lat: LAT0 + i * DLAT, lon: LON }; });
// loop G: B0 next to Ratner Center (A4), then east and back
Object.assign(stops, {
  B0: { name: "Ratner East", lat: LAT0 + 4 * DLAT, lon: LON + 0.0005 },
  B1: { name: "Kimbark & 57th", lat: LAT0 + 4 * DLAT, lon: LON + 0.006 },
  B2: { name: "Harper Court", lat: LAT0 + 3 * DLAT, lon: LON + 0.012 },
  B3: { name: "Lake Park & 53rd <b>", lat: LAT0 + 2 * DLAT, lon: LON + 0.006 },
});
export const routes = {
  R: { short: "RL", long: "Red Line", color: "#C4291C", text_color: "#FFFFFF" },
  G: { short: "GL", long: "Green Loop", color: "#1E7F3C", text_color: "#FFFFFF" },
  X: { short: "<X>", long: "<script>alert(1)</script>", color: "javascript:alert(1)", text_color: "" },
};
export const routeStops = {
  R: ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"],
  G: ["B0", "B1", "B2", "B3", "B0"],
  X: ["A0", "A4", "A7"],
};
const stopRoutes = {};
for (const [rid, ids] of Object.entries(routeStops)) for (const id of new Set(ids)) (stopRoutes[id] ||= []).push(rid);

/** Store-shaped state with fresh live data and no buses. */
export function baseState(over = {}) {
  return {
    routes, stops, routeStops, stopRoutes, shapes: {}, addresses: {}, staticLoaded: true,
    buses: [], trips: [], alerts: [], feedTs: NOW - 5, lastOk: NOW - 5, failed: false, liveLoaded: true,
    user: null, locState: "unknown", hiddenRoutes: [], theme: "auto", journey: null, routeFilter: null,
    view: "nearby", prevView: null, stopId: null, routeId: null, ...over,
  };
}

/** A vehicle heading to `next`, `frac` of the way from `prev` (0..1). */
export function bus(vid, label, rid, tripId, prev, next, frac = 0.5, over = {}) {
  const a = stops[prev], b = stops[next];
  return { vehicle: { id: vid, label }, trip: { trip_id: tripId, route_id: rid }, stop_id: next, timestamp: NOW - 5,
    position: { latitude: a.lat + (b.lat - a.lat) * frac, longitude: a.lon + (b.lon - a.lon) * frac, bearing: 0, speed: 5 }, ...over };
}

/** Trip update: [[stopId, seconds from NOW], ...] in stop order (stop_sequence 1..n). */
export function trip(tripId, rid, vid, label, list) {
  return { trip: { trip_id: tripId, route_id: rid }, vehicle: { id: vid, label },
    stop_time_update: list.map(([s, dt], i) => ({ stop_id: s, stop_sequence: i + 1, arrival: { time: NOW + dt }, departure: { time: NOW + dt + 1 } })) };
}

/** Journey: walk to Ratner Center, Red Line to Medical Center, walk to the cafe. */
export function journeyR({ t0 = NOW - 120, tripId = "tR1", boardT = NOW + 420, alightT = NOW + 720, to = "Medical Center Cafe", walk = 4 } = {}) {
  return { kind: "plan", rids: ["R"], label: "To " + to, to, t0, legs: [
    { type: "walk", min: walk, toName: "Ratner Center" },
    { type: "bus", rid: "R", board: { id: "A4", name: "Ratner Center" }, alight: { id: "A7", name: "Medical Center" }, tripId, boardT, alightT, source: tripId ? "live" : "schedule", waitLive: !!tripId },
    { type: "walk", min: 3, toName: to },
  ] };
}

/** Journey with a transfer: Red Line A1 -> A4, walk to B0, Green Loop B0 -> B3. */
export function journeyXfer({ t0 = NOW - 600 } = {}) {
  return { kind: "plan", rids: ["R", "G"], label: "To Lake Park Apartments", to: "Lake Park Apartments", t0, legs: [
    { type: "walk", min: 2, toName: "56th & Ellis" },
    { type: "bus", rid: "R", board: { id: "A1", name: "56th & Ellis" }, alight: { id: "A4", name: "Ratner Center" }, tripId: "tR1", boardT: NOW - 240, alightT: NOW + 180, source: "live", waitLive: true },
    { type: "walk", min: 1, toName: "Ratner East" },
    { type: "bus", rid: "G", board: { id: "B0", name: "Ratner East" }, alight: { id: "B3", name: "Lake Park & 53rd <b>" }, tripId: "tG1", boardT: NOW + 420, alightT: NOW + 900, source: "live", waitLive: true },
    { type: "walk", min: 5, toName: "Lake Park Apartments" },
  ] };
}

const userNear = (id, dLat = 0) => ({ lat: stops[id].lat + dLat, lon: stops[id].lon - 0.0001 });

/** One scene per phase (state + what it shows). */
export function scenes() {
  const tR1 = (list) => trip("tR1", "R", "v101", "101", list);
  return [
    { id: "walk", title: "Walking to the stop (bus 3 stops away, location on)", state: baseState({
      user: userNear("A4", -0.0025), journey: journeyR(),
      buses: [bus("v101", "101", "R", "tR1", "A0", "A1", 0.5)],
      trips: [tR1([["A1", 90], ["A2", 200], ["A3", 300], ["A4", 420], ["A5", 520], ["A6", 600], ["A7", 720], ["A8", 800]])] }) },
    { id: "waiting", title: "At the stop, bus 2 stops away", state: baseState({
      user: userNear("A4", 0.00005), journey: journeyR({ boardT: NOW + 240, alightT: NOW + 500 }),
      buses: [bus("v101", "101", "R", "tR1", "A1", "A2", 0.6)],
      trips: [tR1([["A2", 60], ["A3", 150], ["A4", 240], ["A5", 330], ["A6", 400], ["A7", 500], ["A8", 580]])] }) },
    { id: "onbus", title: "On the bus, 2 stops to go", state: baseState({
      journey: journeyR({ t0: NOW - 900, boardT: NOW - 240, alightT: NOW + 200 }),
      buses: [bus("v101", "101", "R", "tR1", "A5", "A6", 0.4)],
      trips: [tR1([["A6", 70], ["A7", 200], ["A8", 300]])] }) },
    { id: "arrived", title: "Off the bus, walking to the destination", state: baseState({
      journey: journeyR({ t0: NOW - 1200, boardT: NOW - 600, alightT: NOW - 60 }),
      buses: [bus("v101", "101", "R", "tR1", "A7", "A8", 0.5)],
      trips: [tR1([["A8", 60]])] }) },
    { id: "schedule", title: "No live data (times from the plan)", state: baseState({
      journey: journeyR({ t0: NOW - 300, tripId: null, boardT: NOW + 120, alightT: NOW + 480 }) }) },
    { id: "transfer", title: "Transfer trip, on the first bus", state: baseState({
      journey: journeyXfer(),
      buses: [bus("v101", "101", "R", "tR1", "A2", "A3", 0.5), bus("v301", "301", "G", "tG1", "B2", "B3", 0.5)],
      trips: [tR1([["A3", 60], ["A4", 180], ["A5", 260]]), trip("tG1", "G", "v301", "301", [["B3", 60], ["B0", 400], ["B1", 520], ["B2", 640], ["B3", 860]])] }) },
    { id: "missed", title: "Planned bus left without you: next bus followed", state: baseState({
      user: userNear("A4", 0.00005), journey: journeyR({ boardT: NOW - 120, alightT: NOW + 300 }),
      buses: [bus("v101", "101", "R", "tR1", "A5", "A6", 0.7), bus("v102", "102", "R", "tR2", "A0", "A1", 0.3)],
      trips: [tR1([["A6", 40], ["A7", 160]]), trip("tR2", "R", "v102", "102", [["A1", 100], ["A2", 220], ["A3", 330], ["A4", 450], ["A5", 540], ["A6", 620], ["A7", 740]])] }) },
    { id: "stale", title: "Live data delayed (feed 7 min old, bus seen 2 min ago)", state: baseState({
      feedTs: NOW - 420, user: userNear("A4", 0.00005), journey: journeyR({ boardT: NOW + 240, alightT: NOW + 500 }),
      buses: [bus("v101", "101", "R", "tR1", "A2", "A3", 0.3, { timestamp: NOW - 130 })],
      trips: [tR1([["A3", 60], ["A4", 240], ["A5", 330], ["A6", 400], ["A7", 500]])] }) },
  ];
}

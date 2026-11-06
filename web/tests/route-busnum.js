// Route page with numbered buses (route.test.html): pick a bus, its own time at each station, back to the next bus.
import { test, eq, ok } from "./lib.js";
import { renderRoute, busPositions } from "../js/ui/views/route.js";
import { fixture, makeCtx, NOW, root, tick } from "./views-fixtures.js";
import { bindActions } from "../js/ui/actions.js";

// R1 with two buses: v1 (label 101, trip t1) and v3 (label 103, trip t3, only predicts S1 at +25 min)
const two = (over = {}) => {
  const f = fixture({ routeId: "R1", view: "route", ...over });
  f.buses = [...f.buses, { vehicle: { id: "v3", label: "103" }, position: { latitude: 41.7935, longitude: -87.597, bearing: 0, speed: 5 },
    trip: { trip_id: "t3", route_id: "R1" }, timestamp: NOW - 5, stop_id: "S3", current_stop_sequence: 3 }];
  // trip updates carry the same vehicle ids as the positions (as Passio's feeds do)
  const tu = (id, vid, label, list) => ({ trip: { trip_id: id, route_id: "R1" }, vehicle: { id: vid, label }, stop_time_update: list.map(([s, dt]) => ({ stop_id: s, arrival: { time: NOW + dt } })) });
  f.trips = [tu("t1", "v1", "101", [["S1", 120], ["S2", 300], ["S3", 600]]), tu("t3", "v3", "103", [["S1", 1500]]), ...f.trips.filter((t) => t.trip.route_id !== "R1")];
  return { ...f, ...over };
};
const etaOf = (h, name) => {
  const d = document.createElement("div"); d.innerHTML = h;
  const btn = [...d.querySelectorAll(".v-tlbtn")].find((b) => b.querySelector(".v-prim").textContent === name);
  if (!btn) return null;
  const e = btn.querySelector(".v-tleta").cloneNode(true);
  e.querySelector(".v-tlwho")?.remove();
  return e.textContent;
};
/** The bus named under a station's time ("Bus 2"), '' for none. */
const whoOf = (h, name) => {
  const d = document.createElement("div"); d.innerHTML = h;
  const btn = [...d.querySelectorAll(".v-tlbtn")].find((b) => b.querySelector(".v-prim").textContent === name);
  return btn ? btn.querySelector(".v-tlwho")?.textContent || "" : null;
};
const labelOf = (h, name) => {
  const d = document.createElement("div"); d.innerHTML = h;
  const btn = [...d.querySelectorAll(".v-tlbtn")].find((b) => b.querySelector(".v-prim").textContent === name);
  return btn ? btn.getAttribute("aria-label") : null;
};

test("route busnum: two buses on a line are Bus 1 and Bus 2; each row is a 44 px button", () => {
  const s = two(), p = busPositions(s, "R1", NOW);
  eq(p.map((b) => b.name).sort(), ["Bus 1", "Bus 2"]);
  ok(p.find((b) => b.key === "v1").text.startsWith("Bus 1 "), "v1 sorts first");
  const h = renderRoute(s, NOW);
  ok(h.includes('data-action="route:bus" data-id="v1"') && h.includes('data-action="route:bus" data-id="v3"'));
  ok(h.includes('aria-pressed="false"') && !h.includes("Showing Bus"), "nothing picked yet");
  ok(h.includes("Bus 2 heading here") || h.includes("Bus 1 heading here"), "pills use the numbers");
});

test("route busnum: one bus on a line keeps its fleet label, no number", () => {
  const p = busPositions(fixture({ routeId: "R1" }), "R1", NOW);
  eq(p[0].name, "Bus 101");
  ok(p[0].text.startsWith("Bus 101 approaching"), p[0].text);
});

test("route busnum: a picked bus shows its own time at each station, none where it has no prediction", () => {
  const plain = renderRoute(two(), NOW);
  eq([etaOf(plain, "Main & 1st"), etaOf(plain, "Library"), etaOf(plain, "Hospital")], ["2 min", "5 min", "10 min"], "next bus at each stop");
  // owner 2026-11-06: which bus comes next, as numbered on the map (v1 = Bus 1 makes every first arrival here)
  eq([whoOf(plain, "Main & 1st"), whoOf(plain, "Library"), whoOf(plain, "Hospital")], ["Bus 1", "Bus 1", "Bus 1"], "each time names its bus");
  eq(labelOf(plain, "Main & 1st").startsWith("Main & 1st, Bus 1 in 2 min"), true, labelOf(plain, "Main & 1st"));
  const h = renderRoute(two({ busId: "v3" }), NOW);
  ok(h.includes("Showing Bus 2&#39;s times") || h.includes("Showing Bus 2's times"), "the note names the bus");
  ok(h.includes('data-action="route:allbuses"') && h.includes("Show the next bus at each stop"));
  eq([etaOf(h, "Main & 1st"), etaOf(h, "Library"), etaOf(h, "Hospital")], ["25 min", "", ""], "Bus 2 (v3) predicts only Main & 1st, at +25 min");
  eq([whoOf(h, "Main & 1st"), whoOf(h, "Library")], ["", ""], "picked: the note names the bus, the rows do not repeat it");
  ok(h.includes('data-id="v3" aria-pressed="true"'), "its row is pressed");
  ok(h.includes("no prediction for Bus 2"), "screen reader: no prediction for that bus");
  const h1 = renderRoute(two({ busId: "v1" }), NOW);
  eq([etaOf(h1, "Main & 1st"), etaOf(h1, "Library")], ["2 min", "5 min"], "Bus 1's own times");
  ok(!/[–—]/.test(h.replace(/<[^>]*>/g, "")), "no dash characters");
});

test("route busnum: rows pick and unpick a bus; the note's button clears it", async () => {
  const ctx = makeCtx(two());
  const el = root();
  const off = bindActions(el, () => ctx);
  try {
    el.innerHTML = renderRoute(ctx.store.get(), NOW);
    el.querySelector('[data-action="route:bus"][data-id="v3"]').click();
    await tick();
    eq(ctx.store.get().busId, "v3");
    el.innerHTML = renderRoute(ctx.store.get(), NOW);
    el.querySelector('[data-action="route:bus"][data-id="v3"]').click();
    await tick();
    eq(ctx.store.get().busId, null, "again: back to the next bus at each stop");
    ctx.store.set({ busId: "v1" });
    await tick();
    el.innerHTML = renderRoute(ctx.store.get(), NOW);
    el.querySelector('[data-action="route:allbuses"]').click();
    await tick();
    eq(ctx.store.get().busId, null);
  } finally { off?.(); el.remove(); }
});

test("route busnum: a picked bus that is no longer shown quietly gives the next bus at each stop", () => {
  const s = two({ busId: "v3" });
  s.buses = s.buses.filter((b) => b.vehicle.id !== "v3");
  const h = renderRoute(s, NOW);
  ok(!h.includes("Showing Bus"), "no note");
  eq(etaOf(h, "Main & 1st"), "2 min");
  eq(whoOf(h, "Main & 1st"), "", "one bus left on the line: no number");
});

test("route busnum: the next time at a station names the bus that makes it, never a guess", () => {
  const s = two();
  // v3 now predicts Main & 1st first (+1 min): that row names Bus 2, the others stay Bus 1
  s.trips = s.trips.map((t) => (t.vehicle?.id === "v3" ? { ...t, stop_time_update: [{ stop_id: "S1", arrival: { time: NOW + 60 } }] } : t));
  const h = renderRoute(s, NOW);
  eq([whoOf(h, "Main & 1st"), whoOf(h, "Library")], ["Bus 2", "Bus 1"]);
  // a trip update naming no vehicle: its time shows, with no bus named
  s.trips = s.trips.map((t) => (t.vehicle?.id === "v3" ? { ...t, vehicle: undefined } : t));
  const h2 = renderRoute(s, NOW);
  eq([etaOf(h2, "Main & 1st"), whoOf(h2, "Main & 1st")], ["1 min", ""], "no vehicle on the prediction: no number");
  // a vehicle the app does not show (not in store.buses): no number
  s.trips = s.trips.map((t) => (t.trip.trip_id === "t3" ? { ...t, vehicle: { id: "v9", label: "109" } } : t));
  eq(whoOf(renderRoute(s, NOW), "Main & 1st"), "", "unknown vehicle: no number");
});

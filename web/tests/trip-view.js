// ui/views/tripprogress.js render tests (strings + real layout in this page's CSS).
import { test, eq, ok } from "./lib.js";
import { tripProgressHTML, resetTripMotion, etaText } from "../js/ui/views/tripprogress.js";
import { NOW, stops, baseState, bus, trip, journeyR, scenes } from "./trip-fixtures.js";

const scene = (id) => scenes().find((s) => s.id === id).state;
// scenes share legs and vehicles, so forget remembered bus positions before each render
const html = (id, now = NOW) => { resetTripMotion(); return tripProgressHTML(scene(id), now); };
const count = (h, s) => h.split(s).length - 1;

function mount(h) {
  const el = document.createElement("div");
  el.className = "demo-sheet sheet-content";
  el.style.cssText = "width:393px;position:absolute;left:-2000px;top:0";
  el.innerHTML = h;
  document.body.appendChild(el);
  return el;
}
const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };

test("trip view: nothing without a Directions trip; older journeys fall back to the trip bar", () => {
  eq(tripProgressHTML(baseState(), NOW), "");
  eq(tripProgressHTML(baseState({ journey: { kind: "station", rids: ["R"], label: "Lib" } }), NOW), "");
  const h = tripProgressHTML(baseState({ journey: { rids: ["R"], label: "To Hospital", kind: "plan" } }), NOW);
  ok(h.includes("j-trip") && h.includes("Trip to Hospital"), "trip bar");
  ok(h.includes('data-action="journey:end"') && h.includes('data-action="nav" data-view="directions"'), "End trip + Trip steps");
});

test("trip view: every phase has the header, End trip, Trip steps, list semantics, est. labels", () => {
  for (const s of scenes()) {
    const h = tripProgressHTML(s.state, NOW);
    ok(h.startsWith('<section class="tp" aria-label="Trip in progress">'), s.id);
    eq(count(h, 'data-action="journey:end"'), 1, s.id + " one End trip");
    eq(count(h, 'data-action="nav" data-view="directions"'), 1, s.id + " Trip steps");
    ok(h.includes('<ol class="tp-steps" aria-label="Trip timeline">') && h.includes('<ol class="tp-stops"'), s.id + " lists");
    ok(h.includes("Board here") && h.includes("Get off here"), s.id + " board / get off markers");
    ok(h.includes("est."), s.id + " estimates labeled");
    ok(!/\son[a-z]+=/i.test(h) && !h.includes("<script"), s.id + " no inline handlers / scripts");
  }
});

test("trip view: walking to the stop (leave guidance, bus 3 stops away, bus coming from earlier stops)", () => {
  const h = html("walk");
  ok(h.includes("Trip to Medical Center Cafe"));
  ok(h.includes("Walk 4 min to Ratner Center"), "walk row from your location");
  ok(h.includes("Leave in 2 min, est."), "leave guidance");
  ok(h.includes("Bus 101 is 3 stops away"), "status in words");
  ok(/tp-lead is-before is-passed"><span class="tp-leadrow"><span class="tp-sname">55th &amp; Ellis<\/span><span class="tp-eta is-passed">Passed/.test(h), "the stop the bus just left, passed");
  resetTripMotion();
  const far = { ...scene("walk"), buses: [bus("v101", "101", "R", "tR1", "A0", "A1", 0.1)] };
  far.buses[0].stop_id = "A0";
  far.buses[0].position = { latitude: stops.A0.lat - 0.001, longitude: stops.A0.lon };
  const fh = tripProgressHTML(far, NOW);
  ok(fh.includes("tp-lead is-more") && fh.includes("1 more stop before 56th &amp; Ellis"), "bus further back");
  ok(fh.includes("Bus 101 is 4 stops away"));
  ok(h.includes('class="tp-track" style="--to:') && h.includes('aria-hidden="true"><span class="tp-veh"'), "decorative chip");
  ok(h.includes("Arrive about") && h.includes("15 min"), "arrival + minutes left");
});

test("trip view: waiting (2 stops away, passed stop says so, bus pill heading to the next stop)", () => {
  const h = html("waiting");
  ok(h.includes("Bus 101 is 2 stops away"));
  ok(h.includes("Board at Ratner Center in 4 minutes"), "board time in words");
  ok(h.includes(">Passed<"), "passed stop labeled, not color alone");
  ok(h.includes("Bus 101 heading here"), "route-detail style pill");
  ok(h.includes("the bus has passed this stop") && h.includes("the bus is heading here"), "row labels");
  ok(h.includes("Bus 101 is between 56th &amp; Ellis and 57th &amp; Ellis"), "leg head says where the bus is");
});

test("trip view: on the bus (stops left, before-stops gone), arrived (final walk), no live data", () => {
  const on = html("onbus");
  ok(on.includes("2 stops to Medical Center"));
  ok(!on.includes("Regenstein Library"), "stops before the boarding stop dropped once on board");
  ok(on.includes("Get off at Medical Center about"));
  const ar = html("arrived");
  ok(ar.includes("Walk 3 min to Medical Center Cafe") && ar.includes("tp-dest is-active"));
  ok(ar.includes("Walked to Ratner Center"), "first walk done");
  ok(!ar.includes("tp-track"), "no bus chip once off the bus");
  const sc = html("schedule");
  ok(sc.includes("No live bus data: following the plan&#39;s times (estimate)."));
  ok(sc.includes("Bus planned for"), "planned, not live");
  ok(/~\d{1,2}:\d{2}.*?<span class="v-est">est\.<\/span>/.test(sc), "planned clock + est. tag on the board row");
  ok(sc.includes("No live data for this bus right now"), "footnote honest");
  ok(!sc.includes("tp-track"), "no chip without a live bus");
});

test("trip view: stale feed banner, stale chip and its age; missed bus note", () => {
  const st = html("stale");
  ok(st.includes('class="v-stale" role="status"'), "delayed banner");
  ok(st.includes("tp-veh is-stale") && st.includes("location from 2 min ago"));
  ok(/>~\d+ min</.test(st), "ETAs get ~ while delayed");
  const mi = html("missed");
  ok(mi.includes("Your planned bus has left. Showing the next one.") && mi.includes("Bus 102 is 3 stops away"));
});

test("trip view: transfer shows both legs, the change walk and escapes stop names", () => {
  const h = html("transfer");
  ok(h.includes("Red Line") && h.includes("Green Loop"));
  ok(h.includes("Walk 1 min to Ratner East to change"));
  ok(h.includes("Lake Park &amp; 53rd &lt;b&gt;") && !h.includes("53rd <b>"), "escaped");
  ok(h.includes("Next bus at"), "upcoming leg: live next bus time");
  eq(count(h, "tp-track"), 1, "only the bus you are on gets a chip");
});

test("trip view: hostile route and destination text is escaped", () => {
  const j = { kind: "plan", rids: ["X"], label: "To <img src=x onerror=alert(1)>", to: "<img src=x onerror=alert(1)>", t0: NOW - 60, legs: [
    { type: "walk", min: 2, toName: "<i>x</i>" },
    { type: "bus", rid: "X", board: { id: "A0", name: "A0" }, alight: { id: "A7", name: "A7" }, tripId: null, boardT: NOW + 300, alightT: NOW + 900 },
    { type: "walk", min: 1, toName: "<img src=x onerror=alert(1)>" }] };
  const h = tripProgressHTML(baseState({ journey: j }), NOW);
  ok(!h.includes("<img") && !h.includes("<i>") && !h.includes("<script>"), "no raw markup");
  ok(h.includes("&lt;img src=x onerror=alert(1)&gt;") && h.includes("&lt;script&gt;"), "shown as text");
  ok(h.includes("--rc:#555555"), "bad route color replaced");
});

test("trip view layout: chip sits between the right stops; equal rows; 44px targets", () => {
  resetTripMotion();
  const el = mount(html("waiting"));
  try {
    const rows = [...el.querySelectorAll(".tp-stops > li")];
    const hs = rows.map((r) => Math.round(r.getBoundingClientRect().height));
    ok(hs.every((x) => x === hs[0]) && hs[0] >= 52, "equal rows " + hs.join(","));
    const y = mid(el.querySelector(".tp-veh")), a = mid(rows[0]), b = mid(rows[1]);
    ok(y > a && y < b, `chip between 56th & Ellis and 57th & Ellis (${a} < ${y} < ${b})`);
    ok(Math.abs((y - a) / (b - a) - 0.6) < 0.08, "60% of the way, by distance");
    const veh = el.querySelector(".tp-veh").getBoundingClientRect(), dot = rows[0].getBoundingClientRect();
    ok(Math.abs(veh.left + veh.width / 2 - (dot.left + 16)) < 1.5, "chip centered on the line");
    for (const btn of el.querySelectorAll("button")) ok(btn.getBoundingClientRect().height >= 44, "44px: " + btn.textContent.trim().slice(0, 30));
    ok(getComputedStyle(el.querySelector(".tp-stop.is-board"), "::after").width === "20px", "big dot at the boarding stop");
  } finally { el.remove(); }
});

test("trip view: a moved bus slides once (transform keyframes), then renders still", () => {
  resetTripMotion();
  const st = scene("waiting");
  const a = tripProgressHTML(st, NOW);
  ok(!a.includes("is-moving"), "first render: no slide");
  const moved = { ...st, buses: [bus("v101", "101", "R", "tR1", "A2", "A3", 0.3)],
    trips: [trip("tR1", "R", "v101", "101", [["A3", 90], ["A4", 180], ["A7", 440]])] };
  const b = tripProgressHTML(moved, NOW + 10);
  ok(b.includes("tp-track is-moving") && b.includes(";--from:"), "slides from the previous spot");
  eq(tripProgressHTML(moved, NOW + 11), b, "stable string while sliding (no re-patch)");
  ok(!tripProgressHTML(moved, NOW + 20).includes("is-moving"), "still afterwards");
  const el = mount(b);
  try { eq(getComputedStyle(el.querySelector(".tp-track")).animationName, "tp-slide"); } finally { el.remove(); }
});

test("trip view: a small GPS move does not change the HTML (no re-patch every poll); extra actions slot", () => {
  resetTripMotion();
  const st = scene("waiting"), nudged = { ...st, buses: [bus("v101", "101", "R", "tR1", "A1", "A2", 0.63)] };
  eq(tripProgressHTML(nudged, NOW), tripProgressHTML(st, NOW), "0.60 -> 0.63 of a segment renders the same");
  const pick = '<button type="button" class="v-btn v-btn--secondary pt-pick" data-action="pick:open">Routes to station&hellip;</button>';
  const h = tripProgressHTML(st, NOW, { actionsHTML: pick });
  ok(/<div class="tp-acts"><button[^>]*data-view="directions">Trip steps<\/button><button[^>]*data-action="pick:open"/.test(h), "next to Trip steps");
  ok(tripProgressHTML(baseState({ journey: { rids: ["R"], label: "To X", kind: "plan" } }), NOW, { actionsHTML: pick }).includes("pick:open"), "fallback too");
});

test("trip view: reduced motion and high contrast rules exist in css/trip.css", async () => {
  const css = await fetch("../css/trip.css").then((r) => r.text());
  ok(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.tp-track\.is-moving\s*\{\s*animation:\s*none/.test(css), "no slide under reduced motion");
  ok(css.includes("prefers-contrast: more") && css.includes("forced-colors: active"));
  ok(!/\.tp-[\w-]+[^{]*\{[^}]*transition:\s*top/.test(css), "only transform is animated");
});

test("trip view: etaText like the route detail timeline", () => {
  eq(etaText(NOW + 20, NOW, false), "Now");
  eq(etaText(NOW + 300, NOW, false), "5 min");
  eq(etaText(NOW + 300, NOW, true), "~5 min");
  eq(etaText(null, NOW, false), "");
});

test("trip view: journey from the fixture without a trip id still renders (planned bus)", () => {
  const h = tripProgressHTML(baseState({ journey: journeyR({ tripId: null }) }), NOW);
  ok(h.includes("Walk 4 min to Ratner Center") && h.includes("No live"));
});

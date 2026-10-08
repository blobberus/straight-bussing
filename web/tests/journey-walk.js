// Walking in trip times (JOURNEY): option cards + step lists name the walk to the first stop and to the
// destination, totals say they include walking, leave guidance; Plan Trip "Where to?" focuses Destination.
import { test, eq, ok } from "./lib.js";
import { NOW, makeCtx, tick, root } from "./views-fixtures.js";
import { runAction } from "../js/ui/actions.js";
import { clock } from "../js/core/time.js";
import { D, deps, renderDirections, mountDirections, unmountDirections } from "../js/ui/views/directions.js";
import { optionLines, leaveInfo, walkTotal, legsTimes, walkMins } from "../js/ui/views/tripinfo.js";

const B = { id: "S1", name: "Main & 1st", lat: 41.79, lon: -87.6 }, A = { id: "S3", name: "Hospital", lat: 41.795, lon: -87.595 };
const START = { lat: 41.7879, lon: -87.6001, name: "Start" }, DEST = { lat: 41.7962, lon: -87.5951, name: "Destination" };
const wk = (from, to, m, min) => ({ type: "walk", from, to, m, min, source: "estimate" });
const bus = (over = {}) => ({ type: "bus", rid: "R1", board: B, alight: A, path: [], stopsPassed: 2, wait: 4, waitLive: true, ride: 8, source: "live", conf: 1, boardT: NOW + 600, alightT: NOW + 1080, ...over });
function option(legs, arrive) { const total = (arrive - NOW) / 60; return { key: "k", total, totalMin: Math.round(total), arrive, t0: NOW, legs }; }
/** walk 3 min (240 m) -> R1 boards at +10 min (live) -> rides to +18 -> walk 2 min (160 m). */
const FULL = () => option([wk(START, B, 240, 3), bus(), wk(A, DEST, 160, 2)], NOW + 1200);

function resetDir() { Object.assign(D, { from: null, to: null, fromText: "", toText: "", active: null, sugs: [], result: null, sel: 0, selKey: null, refining: false, meDenied: false, missed: false, focusTo: false }); }
async function dirWith(options, over = {}) {
  resetDir();
  deps.plan = () => ({ now: NOW, options, walkOnly: { m: 1500, min: 18.75 } });
  deps.refineWalking = async (o) => o;
  deps.walkRoute = async (a, b) => ({ m: 1500, min: 18.75, coords: [[a.lat, a.lon], [b.lat, b.lon]], source: "estimate" });
  deps.predict = null;
  const ctx = makeCtx({ view: "directions", journey: null, ...over });
  D.from = { lat: START.lat, lon: START.lon, label: "Home" };
  D.to = { lat: DEST.lat, lon: DEST.lon, label: "Hospital entrance" };
  const el = root();
  el.innerHTML = renderDirections(ctx.store.get());
  mountDirections(el, ctx);
  await tick(10);
  return { ctx, el, res: el.querySelector('[data-region="dir-res"]') };
}

test("tripinfo: walking total, leg clocks from t0, leave guidance only for a live first bus", () => {
  const o = FULL();
  eq(walkTotal(o), 5);
  eq(legsTimes(o, NOW + 999)[1], { b: NOW + 600, a: NOW + 1080 }, "uses the option's own times");
  const lv = leaveInfo(o, NOW);
  eq(lv.kind, "later"); eq(lv.by, NOW + 420, "board time minus the walk to the stop");
  ok(lv.text.startsWith("Leave in 7 min (by "), lv.text);
  eq(leaveInfo(o, NOW + 400).kind, "now", "under a minute of slack -> Leave now");
  eq(leaveInfo(option([wk(START, B, 240, 3), bus({ waitLive: false }), wk(A, DEST, 160, 2)], NOW + 1200), NOW), null, "headway guess: no leave time");
  eq(walkMins(0.3), "<1"); eq(walkMins(2.6), "3");
  const l = optionLines(o, NOW);
  ok(l.text.includes("Walk 3 min to Main & 1st · bus " + clock(NOW + 600)), l.text);
  ok(l.text.includes("includes 5 min walking"), l.text);
});

test("directions: card and steps show the walk to the first stop and to the destination; totals include it", async () => {
  const { el, res } = await dirWith([FULL()]);
  const card = res.querySelector(".v-opt.is-on .v-optmain");
  const ct = card.textContent;
  ok(ct.includes("~20") && ct.includes("Arrive " + clock(NOW + 1200)), "total and arrive include both walks: " + ct);
  ok(ct.includes("Walk 3 min to Main & 1st"), "first walk named on the card");
  ok(ct.includes("Leave in 7 min (by " + clock(NOW + 420) + ")") && ct.includes("includes 5 min walking"), ct);
  ok(card.getAttribute("aria-label").includes("including 5 minutes walking"), card.getAttribute("aria-label"));
  eq(card.querySelectorAll(".v-wk").length, 2, "both walks in the chip summary");
  const steps = [...res.querySelectorAll(".v-steps li")].map((li) => li.textContent);
  ok(steps[0].includes("Walk 3 min (240 m) to Main & 1st"), steps[0]);
  ok(steps[0].includes("Leave by " + clock(NOW + 420) + " to catch the " + clock(NOW + 600) + " bus"), steps[0]);
  ok(steps[1].includes("Bus arrives at Main & 1st"), steps[1]);
  ok(steps[2].includes("Walk 2 min (160 m) to Hospital entrance"), "last walk goes to the destination: " + steps[2]);
  ok(steps[3].includes("Arrive at Hospital entrance about " + clock(NOW + 1200)) && steps[3].includes("including 5 min walking"), steps[3]);
  unmountDirections(); el.remove(); resetDir();
});

test("directions: short walks are still mentioned (<1 min), no-walk ends are said explicitly", async () => {
  const short = option([wk(START, B, 30, 0.4), bus(), wk(A, DEST, 26, 0.3)], NOW + 1100);
  let { el, res } = await dirWith([short]);
  let txt = res.textContent;
  ok(txt.includes("Walk <1 min (30 m) to Main & 1st") && txt.includes("Walk <1 min (26 m) to Hospital entrance"), txt);
  ok(txt.includes("Walk <1 min to Main & 1st"), "card mentions it too");
  unmountDirections(); el.remove();
  ({ el, res } = await dirWith([option([bus({ waitLive: false })], NOW + 1080)]));
  txt = res.textContent;
  ok(txt.includes("No walk: board at Main & 1st") && txt.includes("No walking"), "card: " + txt);
  ok(txt.includes("No walk: start at Main & 1st") && txt.includes("No walk: get off at Hospital, Hospital entrance is right there"), txt);
  ok(!txt.includes("Leave"), "no leave time without a live bus");
  unmountDirections(); el.remove(); resetDir();
});

test("plan trip: Where to? opens Directions with the destination focused (even without a start)", async () => {
  resetDir();
  deps.plan = () => ({ now: NOW, options: [], walkOnly: { m: 0, min: 0 } });
  const ctx = makeCtx({ view: "nearby" });
  runAction("dir:open", { focus: "to" }, null, ctx);
  eq(ctx.store.get().view, "directions");
  const el = root();
  el.innerHTML = renderDirections(ctx.store.get());
  mountDirections(el, ctx);
  ok(document.activeElement === el.querySelector('[data-input="dir-to"]'), "destination focused");
  eq(D.focusTo, false, "one-shot");
  unmountDirections(); el.remove(); resetDir();
});

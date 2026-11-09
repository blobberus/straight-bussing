// Directions' trip start time (owner 2026-11-09: "when deciding a destination, the user should have an optional trip start
// time. This trip start time should schedule the arrivals based on the scheduled arrival time (this should have a larger
// disclaimer ...)"): the control, the wheels, the disclaimer, back to Leave now, nothing stored.
import { test, eq, ok } from "./lib.js";
import { NOW, makeCtx, tick, root } from "./views-fixtures.js";
import { runAction } from "../js/ui/actions.js";
import { D, deps, renderDirections, mountDirections, unmountDirections, setStartTime, replan } from "../js/ui/views/directions.js";
import { leavePickState } from "../js/ui/views/leavepick.js";
import { closeSettingsOverlay, isSettingsOpen, overlayKind } from "../js/ui/settings-overlay.js";
import { plan as realPlan, refineWalking as realRefine } from "../js/core/planner.js";
import { cleanTimetable, _setTimetable } from "../js/data/timetable.js";
import { chicagoUnix } from "../js/core/timeactive.js";
import { clock } from "../js/core/time.js";
import { leaveLabel, TT_TITLE, TT_DISCLAIMER, TT_SOON, TT_START_LATER, TT_FAILED, LEAVE_NOW } from "../js/core/timetable.js";

// NOW (views-fixtures) = Fri Jan 15, 2027 2:00 AM in Chicago; the fixture's route R1 runs Main & 1st (S1) -> Library (S2)
// -> Hospital (S3)
const AT = chicagoUnix(2027, 1, 15, 9, 0);   // 9:00 AM the same day: 7 hours ahead = the timetable
const TT = cleanTimetable({
  v: 1, feed: { start: "2027-01-01", end: "2027-02-14" },
  services: { WK: { days: "1111100", start: "2026-01-01", end: "2027-12-31" } }, dates: {},
  routes: { R1: [{ stops: ["S1", "S2", "S3"], t: [0, 180, 360], starts: { WK: Array.from({ length: 49 }, (_, i) => 7 * 3600 + i * 900) } }] },
});
const FROM = { lat: 41.7901, lon: -87.6001, label: "Start here" }, TO = { lat: 41.7951, lon: -87.5951, label: "Hospital entrance" };

function reset() {
  Object.assign(D, { from: null, to: null, fromText: "", toText: "", active: null, sugs: [], result: null, sel: 0, selKey: null, refining: false, meDenied: false, missed: false, at: null, tt: "" });
  deps.plan = realPlan; deps.refineWalking = realRefine; deps.predict = null;
  deps.walkRoute = async (a, b) => { const m = Math.hypot((a.lat - b.lat) * 111000, (a.lon - b.lon) * 83000) * 1.2; return { m, min: m / 80, coords: [[a.lat, a.lon], [b.lat, b.lon]], source: "estimate" }; };
  deps.loadTimetable = async () => TT;
  _setTimetable(TT);
}
/** Mount Directions with both ends set; records every plan() call's arguments. */
async function mounted(over = {}) {
  const ctx = makeCtx({ view: "directions", ...over });
  const calls = [];
  const inner = deps.plan;
  deps.plan = (args) => { calls.push(args); return inner(args); };
  D.from = FROM; D.to = TO;
  const el = root();
  el.innerHTML = renderDirections(ctx.store.get(), NOW);
  mountDirections(el, ctx);
  await tick(30);
  return { ctx, el, calls, res: () => el.querySelector('[data-region="dir-res"]'), when: () => el.querySelector('[data-region="dir-when"]') };
}
const done = (el) => { closeSettingsOverlay({ focus: "none" }); unmountDirections(); el.remove(); reset(); _setTimetable(null); };

test("trip start: the control under the fields reads Leave now and plans live from now", async () => {
  reset();
  const { el, calls, when } = await mounted();
  const btn = when().querySelector('[data-action="dir:when"]');
  ok(btn && el.querySelector(".v-dirbox").contains(btn), "in the Start / Destination card");
  eq(btn.textContent.trim(), LEAVE_NOW);
  eq(btn.getAttribute("aria-label"), "Trip start time: Leave now. Choose a later time");
  eq(btn.getAttribute("aria-haspopup"), "dialog");
  ok(!when().querySelector('[data-action="dir:when-clear"]'), "nothing to clear");
  const last = calls[calls.length - 1];
  eq([last.now, "timetable" in last], [NOW, false], "live, from now");
  eq(D.result.mode, "now");
  done(el);
});

test("trip start: a later time plans from the timetable under the larger disclaimer, every time scheduled, no Start", async () => {
  reset();
  const { el, calls, res, when } = await mounted();
  setStartTime(AT);
  await tick(30);
  const last = calls[calls.length - 1];
  eq([last.now, last.timetable === TT], [AT, true], "planned at 9:00 AM from the timetable");
  eq(D.result.mode, "timetable");
  // the control: the chosen time and a clear button
  eq(when().querySelector(".v-dwhentxt").textContent, leaveLabel(AT, NOW));
  eq(when().querySelector(".v-dwhentxt").textContent, "Leave at " + clock(AT));
  ok(when().querySelector('[data-action="dir:when-clear"]').getAttribute("aria-label").includes("leave now"));
  // the disclaimer: above the options, the owner's meaning, unofficial + the official number
  const note = res().querySelector(".v-ttnote"), first = res().querySelector(".v-opt");
  ok(note && first, "a disclaimer and an option");
  ok(note.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING, "the disclaimer comes before the options");
  ok(note.textContent.includes(TT_TITLE) && note.textContent.includes(TT_DISCLAIMER), "its words");
  ok(/Most buses run later than scheduled/.test(note.textContent) && !/UGo/.test(note.textContent));
  ok(note.textContent.includes("Unofficial") && note.textContent.includes("773.702.8181"), "unofficial, the official contact");
  ok(note.querySelector("#ttNoteH") && note.getAttribute("aria-labelledby") === "ttNoteH", "a named region");
  // every time scheduled: the step, the card line, the source; never live
  const txt = res().textContent;
  ok(txt.includes("Scheduled bus at Main & 1st"), "the step: " + txt.slice(0, 300));
  ok(/Scheduled bus \S+ \S* ?at Main & 1st, est\./.test(txt), "the card line");
  ok(txt.includes("from the timetable"), "the source");
  ok(!res().querySelector(".v-livedot, .dot-live, .src-live"), "no live dot or Live label");
  ok(!res().querySelector(".j-start"), "no Start for a plan for later");
  ok(res().querySelector(".v-opt.is-on .j-later").textContent === TT_START_LATER, "when Start comes instead");
  ok(!res().querySelector(".v-stale"), "the per-plan stale note is not for timetable times");
  done(el);
});

test("trip start: clearing goes back to Leave now and live planning; the control keeps focus", async () => {
  reset();
  const { ctx, el, calls, res, when } = await mounted();
  setStartTime(AT);
  await tick(30);
  runAction("dir:when-clear", {}, null, ctx);
  await tick(30);
  eq(D.at, null);
  eq(when().querySelector(".v-dwhentxt").textContent, LEAVE_NOW);
  ok(!when().querySelector('[data-action="dir:when-clear"]'), "the clear button goes with the time");
  ok(document.activeElement === when().querySelector('[data-action="dir:when"]'), "focus on the control");
  const last = calls[calls.length - 1];
  eq([last.now, "timetable" in last], [NOW, false]);
  ok(!res().querySelector(".v-ttnote"), "no disclaimer for live times");
  done(el);
});

test("trip start: under 10 minutes away plans with live times from then (no disclaimer, Start stays)", async () => {
  reset();
  const { el, calls, res } = await mounted();
  setStartTime(NOW + 300);
  await tick(30);
  const last = calls[calls.length - 1];
  eq([last.now, "timetable" in last], [NOW + 300, false], "live data, from 2:05 AM");
  eq(D.result.mode, "live");
  ok(res().textContent.includes(TT_SOON), "says the times are live from then");
  ok(!res().querySelector(".v-ttnote"));
  done(el);
});

test("trip start: the wheels open from the control; Set applies, Leave now resets, Cancel keeps", async () => {
  reset();
  const { ctx, el, when } = await mounted();
  runAction("dir:when", {}, null, ctx);
  await tick(10);
  ok(isSettingsOpen() && overlayKind() === "leave", "the sheet is open");
  const sheet = document.getElementById("settingsOverlay");
  eq(sheet.querySelector("#stoTitle").textContent, "Trip start time");
  const [day, hour, minute, ampm] = ["lpDay", "lpHour", "lpMinute", "lpAmpm"].map((id) => sheet.querySelector("#" + id));
  ok(day && hour && minute && ampm, "day, hour, minute, AM / PM wheels");
  eq([day, hour, minute, ampm].map((w) => w.getAttribute("role")), ["spinbutton", "spinbutton", "spinbutton", "spinbutton"]);
  eq([day, hour, minute, ampm].map((w) => w.getAttribute("aria-label")), ["Day", "Hour", "Minute", "AM or PM"]);
  eq(day.getAttribute("aria-valuetext"), "Today, Friday, January 15", "starts today");
  eq(leavePickState().days.slice(-1)[0], "2027-02-14", "through the timetable's last date");
  eq([leavePickState().hour12, leavePickState().minute, leavePickState().pm], [2, 5, false], "now rounded up to 5 minutes");
  ok(sheet.querySelector('[data-region="lp-result"]').textContent.includes("less than 10 minutes away".replace("less", "Less")), "live times close to now");
  // seven hours later on the hour wheel: the timetable
  hour.focus();
  for (let i = 0; i < 7; i++) hour.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  ok(sheet.querySelector('[data-region="lp-result"]').textContent.includes("Bus times will come from the timetable"), "says what Set does");
  sheet.querySelector('[data-sto="done"]').click();
  await tick(30);
  ok(!isSettingsOpen(), "Set closes it");
  eq(D.at, chicagoUnix(2027, 1, 15, 9, 5), "9:05 AM");
  eq(D.result.mode, "timetable");
  ok(document.activeElement === when().querySelector('[data-action="dir:when"]'), "focus back on the control");
  // Cancel keeps the time
  runAction("dir:when", {}, null, ctx);
  await tick(10);
  eq([leavePickState().hour12, leavePickState().minute], [9, 5], "opens at the chosen time");
  sheet.querySelector('[data-sto="start-btn"]').click();
  await tick(10);
  eq(D.at, chicagoUnix(2027, 1, 15, 9, 5), "Cancel changes nothing");
  // Leave now inside the sheet resets
  runAction("dir:when", {}, null, ctx);
  await tick(10);
  sheet.querySelector('[data-lp="now"]').click();
  await tick(30);
  eq([D.at, isSettingsOpen()], [null, false]);
  eq(when().querySelector(".v-dwhentxt").textContent, LEAVE_NOW);
  done(el);
});

test("trip start: a time already past is Leave now, on Set and when its time comes", async () => {
  reset();
  const { ctx, el, when } = await mounted();
  eq(setStartTime(NOW - 600), null, "a past time is not kept");
  setStartTime(NOW + 3 * 3600);
  await tick(30);
  ctx.now = () => NOW + 4 * 3600;   // the time came and went while Directions stayed open
  await replan();
  await tick(10);
  eq(D.at, null);
  eq(when().querySelector(".v-dwhentxt").textContent, LEAVE_NOW);
  done(el);
});

test("trip start: a timetable that cannot load says so and offers Leave now", async () => {
  reset();
  _setTimetable(null);
  deps.loadTimetable = async () => null;
  const { el, res } = await mounted();
  setStartTime(AT);
  await tick(40);
  eq(D.tt, "failed");
  ok(res().textContent.includes(TT_FAILED), res().textContent.slice(0, 200));
  ok(res().querySelector('[data-action="dir:when-clear"]'), "a Leave now button");
  done(el);
});

test("trip start: nothing is stored (not in the store, localStorage or sessionStorage)", async () => {
  reset();
  const snap = () => {
    const all = (s) => { const o = {}; try { for (let i = 0; i < s.length; i++) o[s.key(i)] = s.getItem(s.key(i)); } catch (e) { /* none */ } return o; };
    return JSON.stringify([all(localStorage), all(sessionStorage)]);
  };
  const before = snap();
  const { ctx, el } = await mounted();
  runAction("dir:when", {}, null, ctx);
  await tick(10);
  document.querySelector("#lpDay").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));   // tomorrow
  document.querySelector('#settingsOverlay [data-sto="done"]').click();
  await tick(30);
  ok(D.at > NOW, "a time was chosen");
  eq(snap(), before, "no storage written");
  ok(!Object.values(ctx.store.get()).includes(D.at) && !("at" in ctx.store.get()), "not in the app state");
  runAction("dir:when-clear", {}, null, ctx);
  await tick(20);
  eq(snap(), before);
  done(el);
});

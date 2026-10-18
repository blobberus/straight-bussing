// Tests for core/timeactive.js (Lines by Time, owner 2026-10-18) and its temporary custom route in core/custom.js
import { test, eq, ok } from "./lib.js";
import {
  chicagoUnix, nextOccurrence, pickedUnix, pickerValues, pickerDays, daysIn, linesActiveAt, timeLabel, timeName,
  TIME_PREFIX, TIME_DESC, TIME_DISCLAIMER, TIME_NONE,
} from "../js/core/timeactive.js";
import * as C from "../js/core/custom.js";
import { persistPrefs } from "../js/state.js";
import { createStore } from "../js/core/store.js";
import { load } from "../js/core/storage.js";

const utc = (iso) => Date.parse(iso) / 1000;
const day = (spans) => ({ first: spans[0][0], last: spans[spans.length - 1][1], trips: 9, buses: Array(24).fill(1), spans });
const every = (spans) => ({ mon: day(spans), tue: day(spans), wed: day(spans), thu: day(spans), fri: day(spans), sat: day(spans), sun: day(spans) });
const weekdays = (spans) => ({ mon: day(spans), tue: day(spans), wed: day(spans), thu: day(spans), fri: day(spans), sat: null, sun: null });
/** N: every night 4:00 PM to 4:29 AM; D: weekdays 7:00 AM to 7:25 PM, removed on Fri Oct 23; X: no timetable. */
const SERVICE = {
  feed: { start: "2026-10-07", end: "2026-11-07" },
  routes: {
    N: { days: every([["16:00", "28:29"]]), exceptions: [] },
    D: { days: weekdays([["07:00", "19:25"]]), exceptions: [{ date: "2026-10-23", type: "removed", days: "fri", hours: null }] },
  },
};
const ROUTES = { N: {}, D: {}, X: {} };
const at = (y, m, d, h, min) => chicagoUnix(y, m, d, h, min);

test("chicagoUnix: Chicago wall clock to unix, in daylight and standard time, and on the repeated hour", () => {
  eq(at(2026, 10, 24, 21, 30), utc("2026-10-25T02:30:00Z"), "CDT is UTC-5");
  eq(at(2026, 12, 1, 9, 0), utc("2026-12-01T15:00:00Z"), "CST is UTC-6");
  eq(at(2026, 11, 1, 1, 30), utc("2026-11-01T06:30:00Z"), "1:30 AM on Nov 1 happens twice: the first one (CDT)");
  eq(at(2027, 3, 14, 3, 0), utc("2027-03-14T08:00:00Z"), "right after the spring change");
  eq(at(2027, 3, 14, 2, 30), utc("2027-03-14T08:30:00Z"), "2:30 AM does not exist that night: 3:30 AM");
});

test("nextOccurrence: no year picked = the next time that date comes, today included; Feb 29 in other years", () => {
  const now = at(2026, 10, 18, 12, 0);
  eq(nextOccurrence(10, 18, now), { y: 2026, m: 10, d: 18 }, "today");
  eq(nextOccurrence(10, 17, now), { y: 2027, m: 10, d: 17 }, "yesterday = next year");
  eq(nextOccurrence(12, 31, now), { y: 2026, m: 12, d: 31 });
  eq(nextOccurrence(2, 29, now), { y: 2027, m: 2, d: 28 }, "2027 has no Feb 29");
  eq(nextOccurrence(2, 29, at(2027, 10, 1, 9, 0)), { y: 2028, m: 2, d: 29 }, "2028 does");
  eq([daysIn(2, 2028), daysIn(2, 2027), daysIn(4, 2026), pickerDays(2), pickerDays(4), pickerDays(12)], [29, 28, 30, 29, 30, 31]);
});

test("picker values: 12-hour clock with AM / PM both ways, midnight and noon", () => {
  const now = at(2026, 10, 18, 12, 0);
  eq(pickerValues(at(2026, 10, 24, 21, 30)), { month: 10, day: 24, hour12: 9, minute: 30, pm: true });
  eq(pickerValues(at(2026, 10, 24, 0, 5)), { month: 10, day: 24, hour12: 12, minute: 5, pm: false }, "12:05 AM");
  eq(pickerValues(at(2026, 10, 24, 12, 0)), { month: 10, day: 24, hour12: 12, minute: 0, pm: true }, "noon");
  eq(pickedUnix({ month: 10, day: 24, hour12: 9, minute: 30, pm: true }, now), at(2026, 10, 24, 21, 30));
  eq(pickedUnix({ month: 10, day: 24, hour12: 12, minute: 5, pm: false }, now), at(2026, 10, 24, 0, 5));
  eq(pickedUnix({ month: 1, day: 2, hour12: 12, minute: 0, pm: true }, now), at(2027, 1, 2, 12, 0), "January is next year");
});

test("linesActiveAt: day spans, the night tail after midnight, calendar exceptions, routes order", () => {
  eq(linesActiveAt(SERVICE, ROUTES, at(2026, 10, 22, 10, 0)).rids, ["D"], "Thu 10 AM");
  eq(linesActiveAt(SERVICE, ROUTES, at(2026, 10, 22, 17, 0)).rids, ["N", "D"], "Thu 5 PM, in routes order");
  eq(linesActiveAt(SERVICE, ROUTES, at(2026, 10, 24, 1, 0)).rids, ["N"], "Sat 1 AM is Friday's night service");
  eq(linesActiveAt(SERVICE, ROUTES, at(2026, 10, 24, 4, 29)).rids, [], "the tail ends at 4:29 AM");
  eq(linesActiveAt(SERVICE, ROUTES, at(2026, 10, 23, 10, 0)).rids, [], "Fri Oct 23: D removed by the calendar");
  eq(linesActiveAt(SERVICE, ROUTES, at(2026, 10, 25, 10, 0)).rids, [], "Sunday morning: nothing");
  const r = linesActiveAt(SERVICE, ROUTES, at(2026, 10, 22, 10, 0));
  ok(r.known && !r.outsideFeed && r.note === "", "inside the timetable's dates");
});

test("linesActiveAt: past the timetable's dates the weekly pattern is used and said; no timetable = unknown", () => {
  const r = linesActiveAt(SERVICE, ROUTES, at(2026, 11, 26, 10, 0));
  eq(r.rids, ["D"], "Thanksgiving Thursday, regular pattern");
  ok(r.outsideFeed && /outside the published timetable/.test(r.note) && /Holidays/.test(r.note), r.note);
  eq(linesActiveAt({}, ROUTES, at(2026, 10, 22, 10, 0)), { rids: [], known: false, outsideFeed: false, note: "" });
  eq(linesActiveAt(null, ROUTES, NaN).known, false);
});

test("labels and copy: 'Lines active at Sat Oct 24, 9:30 PM', the owner's sentence, no dash characters", () => {
  const t = at(2026, 10, 24, 21, 30), l = timeLabel(t);
  ok(/^Sat Oct 24, /.test(l) && /9:30|21:30/.test(l), l);
  eq(timeName(t), `${TIME_PREFIX} ${l}`);
  eq(TIME_DESC, "Select a time to check when certain lines will be active. Lines that are active will be made visible on the current map.");
  ok(/holidays/.test(TIME_DISCLAIMER) && /unofficial/.test(TIME_DISCLAIMER) && /not from live/.test(TIME_DISCLAIMER), "disclaimer");
  for (const s of [TIME_DESC, TIME_DISCLAIMER, TIME_NONE, l]) ok(!/[\u2013\u2014]/.test(s), "no en / em dash: " + s);
});

// ---- the temporary custom route (core/custom.js)
const routes = { a: {}, b: {}, c: {}, d: {} };
const base = (over = {}) => ({ routes, hiddenRoutes: [], routeOrder: [], customRoutes: [], activeCustom: null,
  prevHidden: [], favStops: [], journey: null, routeFilter: null, timeView: null, view: "routes", routeId: null, ...over });
const apply = (s, p) => ({ ...s, ...p });

test("applyTimeView: shows only the time's lines, keeps what was before, ends a journey; nothing known = no change", () => {
  const s0 = base({ hiddenRoutes: ["d"], journey: { rids: ["a"], kind: "plan" }, routeFilter: { ids: ["a"] } });
  const p = C.applyTimeView(s0, { at: 123, name: "Lines active at Sat Oct 24, 9:30 PM", rids: ["b", "c", "zz"] });
  eq(p.hiddenRoutes, ["a", "d"]);
  eq([p.timeView.name, p.timeView.rids, p.timeView.at], ["Lines active at Sat Oct 24, 9:30 PM", ["b", "c"], 123]);
  eq(p.timeView.before, { hiddenRoutes: ["d"], activeCustom: null, prevHidden: [] });
  eq([p.activeCustom, p.journey, p.routeFilter], [null, null, null]);
  eq(C.applyTimeView(s0, { at: 1, name: "x", rids: ["zz"] }), {}, "no known line: the map does not change");
  eq(C.applyTimeView(s0, { at: 1, name: "x", rids: [] }), {});
  // a second time keeps the first "before"
  const s1 = apply(s0, p), p2 = C.applyTimeView(s1, { at: 9, name: "Lines active at later", rids: ["a"] });
  eq(p2.timeView.before, { hiddenRoutes: ["d"], activeCustom: null, prevHidden: [] });
});

test("clearTimeView: puts back the routes and an applied custom route from before", () => {
  const cr = [{ id: "x", name: "X", rids: ["a"], highlight: [] }];
  const s0 = base({ customRoutes: cr, activeCustom: "x", hiddenRoutes: ["b", "c", "d"], prevHidden: ["d"] });
  const s1 = apply(s0, C.applyTimeView(s0, { at: 1, name: "Lines active at 1", rids: ["b"] }));
  eq([s1.activeCustom, s1.hiddenRoutes], [null, ["a", "c", "d"]]);
  const s2 = apply(s1, C.clearTimeView(s1));
  eq([s2.timeView, s2.activeCustom, s2.hiddenRoutes, s2.prevHidden], [null, "x", ["b", "c", "d"], ["d"]]);
  // the custom route was deleted meanwhile: back to the routes from before it
  const s3 = apply(s1, { customRoutes: [] }), s4 = apply(s3, C.clearTimeView(s3));
  eq([s4.activeCustom, s4.hiddenRoutes, s4.prevHidden], [null, ["d"], []]);
  eq(C.clearTimeView(base()), {}, "not on: nothing");
});

test("settleTimeView: a line deselected (or added) drops the name and keeps the shown lines", () => {
  const s0 = base();
  const s1 = apply(s0, C.applyTimeView(s0, { at: 1, name: "Lines active at 1", rids: ["a", "b"] }));
  eq(C.settleTimeView(s1), {}, "still the time's lines");
  const s2 = apply(s1, { hiddenRoutes: [...s1.hiddenRoutes, "b"] });   // the eye on b
  eq(C.settleTimeView(s2), { timeView: null });
  const s3 = apply(s2, C.settleTimeView(s2));
  eq([s3.timeView, s3.hiddenRoutes, s3.activeCustom], [null, ["c", "d", "b"], null], "the remaining selection stays");
  const s4 = apply(s1, { hiddenRoutes: ["d"] });                        // c shown as well
  eq(C.settleTimeView(s4), { timeView: null });
  eq(C.settleTimeView(base()), {});
});

test("other visibility actions end Lines by Time; applying a custom route keeps the routes from before it", () => {
  const s0 = base({ hiddenRoutes: ["d"] });
  const s1 = apply(s0, C.applyTimeView(s0, { at: 1, name: "Lines active at 1", rids: ["a"] }));
  for (const p of [C.showAll(s1), C.hideAll(s1), C.showRunning(s1, ["a"]), C.saveVisibleAsCustom(s1, "Mine").patch]) eq(p.timeView, null);
  const s2 = apply(s1, { customRoutes: [{ id: "y", name: "Y", rids: ["b"], highlight: [] }] });
  const p = C.applyCustom(s2, "y");
  eq([p.timeView, p.activeCustom, p.prevHidden], [null, "y", ["d"]], "clearing Y later gives the routes from before the time");
});

test("state.js: while Lines by Time is on, the routes from before it are what gets saved", async () => {
  const s = createStore({ ...base({ hiddenRoutes: ["d"] }), theme: "auto", notify: null });
  const off = persistPrefs(s);
  try {
    s.set(C.applyTimeView(s.get(), { at: 1, name: "Lines active at 1", rids: ["a"] }));
    await Promise.resolve(); await new Promise((r) => setTimeout(r, 0));
    eq([load("hiddenRoutes", null), load("activeCustom", "unset"), load("prevHidden", null)], [["d"], null, []], "before, not the time's");
    s.set(C.settleTimeView({ ...s.get(), hiddenRoutes: ["b", "c", "d", "a"] }));
    s.set({ hiddenRoutes: ["b", "c", "d"] });
    await new Promise((r) => setTimeout(r, 0));
    eq(s.get().timeView, null);
    eq(load("hiddenRoutes", null), ["b", "c", "d"], "once the name is gone, the rider's own selection is saved");
  } finally {
    off();
    s.set({ hiddenRoutes: [], timeView: null, activeCustom: null, prevHidden: [] });
    await new Promise((r) => setTimeout(r, 0));
  }
});

// core/schedule.js unit tests.
import { test, eq, ok } from "./lib.js";
import { localParts, clock12, dayKey, hoursOn, serviceHoursAt, weekSummary, busesByHour, upcomingChanges, isScheduledNow, scheduledUntil, groupHours, hourLabel, routeService } from "../js/core/schedule.js";
import { serviceFixture, utc } from "./route-fixtures.js";

const S = serviceFixture();
const D = "to";   // clock ranges: "7:00 AM to 7:25 PM" (no dash characters, docs/DESIGN.md "Copy")

test("schedule: Chicago local parts across DST", () => {
  const a = localParts(utc("2026-10-08T07:00:00Z"));            // 02:00 CDT Thursday
  eq([a.y, a.m, a.d, a.dow, a.min], [2026, 10, 8, 3, 120]);
  const b = localParts(utc("2026-12-01T12:30:00Z"));            // 06:30 CST Tuesday
  eq([b.d, b.dow, b.min], [1, 1, 390]);
  const c = localParts(utc("2026-10-09T04:59:00Z"));            // 23:59 Thursday local
  eq([c.d, c.dow, c.min], [8, 3, 1439]);
  eq(dayKey(utc("2026-10-11T17:00:00Z")), "sun");
});

test("schedule: clock12 handles after-midnight times", () => {
  eq(clock12("28:29"), "4:29 AM");
  eq(clock12("00:00"), "12:00 AM");
  eq(clock12("12:05"), "12:05 PM");
  eq(clock12("24:25"), "12:25 AM");
  eq(clock12("bad"), "");
  eq([hourLabel(0), hourLabel(13), hourLabel(24)], ["12 AM", "1 PM", "12 AM"]);
});

test("schedule: hoursOn applies calendar exceptions", () => {
  eq(hoursOn(S, "D", utc("2026-10-08T15:00:00Z")).label, `7:00 AM ${D} 7:25 PM`);
  const sat = hoursOn(S, "D", utc("2026-10-10T15:00:00Z"));
  eq([sat.label, sat.exception], [`10:00 AM ${D} 2:00 PM`, "added"]);
  const hol = hoursOn(S, "D", utc("2026-11-26T15:00:00Z"));
  eq([hol.label, hol.exception, hol.first], ["No service", "removed", null]);
  eq(hoursOn(S, "D", utc("2026-10-11T15:00:00Z")).label, "No service", "regular Sunday");
  eq(hoursOn(S, "N", utc("2026-10-08T15:00:00Z")).label, `4:00 PM ${D} 4:29 AM`);
  eq(hoursOn(S, "zz", utc("2026-10-08T15:00:00Z")), null);
  eq(hoursOn(null, "D", 0), null);
  eq(hoursOn({ routes: { D: "x" } }, "D", 0), null);
});

test("schedule: weekSummary groups equal days", () => {
  eq(weekSummary(S, "D"), [{ days: "Mon-Fri", label: `7:00 AM ${D} 7:25 PM` }, { days: "Sat-Sun", label: "No service" }]);
  eq(weekSummary(S, "N"), [{ days: "Every day", label: `4:00 PM ${D} 4:29 AM` }]);
  eq(weekSummary(S, "zz"), []);
});

test("schedule: isScheduledNow includes the after-midnight tail of yesterday", () => {
  eq(isScheduledNow(S, "N", utc("2026-10-08T07:00:00Z")), true, "2 AM Thu = Wed night service");
  eq(isScheduledNow(S, "N", utc("2026-10-08T15:00:00Z")), false, "10 AM");
  eq(isScheduledNow(S, "N", utc("2026-10-08T22:00:00Z")), true, "5 PM");
  eq(isScheduledNow(S, "D", utc("2026-10-08T15:00:00Z")), true);
  eq(isScheduledNow(S, "D", utc("2026-11-26T16:00:00Z")), false, "holiday removed");
  eq(isScheduledNow(S, "zz", 0), null);
});

// After midnight a night route belongs to yesterday's service: never "Today No service · Scheduled now"
// (same cases as the iOS Kit ScheduleTests.testServiceHoursAfterMidnightBelongToYesterday).
test("schedule: serviceHoursAt = the service day's hours (after midnight: yesterday's)", () => {
  const night = { first: "06:30", last: "24:25", trips: 9, buses: Array(24).fill(1), spans: [["06:30", "24:25"]] };
  const svc = { routes: { ...S.routes, F: { days: { fri: night }, exceptions: [] } } };
  const t = utc("2026-10-10T05:10:00Z");   // Sat 12:10 AM CDT
  eq(hoursOn(svc, "F", t).label, "No service", "the calendar date alone");
  eq(isScheduledNow(svc, "F", t), true);
  const s = serviceHoursAt(svc, "F", t);
  eq([s.dayKey, s.hours.label, s.yesterday], ["fri", `6:30 AM ${D} 12:25 AM`, true]);
  const n = serviceHoursAt(svc, "N", utc("2026-10-08T07:00:00Z"));   // 2 AM Thu
  eq([n.dayKey, n.hours.label, n.yesterday], ["wed", `4:00 PM ${D} 4:29 AM`, true]);
  const day = serviceHoursAt(svc, "F", utc("2026-10-10T15:00:00Z"));   // Sat 10 AM
  eq([day.dayKey, day.hours.label, day.yesterday], ["sat", "No service", false]);
  eq(serviceHoursAt(svc, "N", utc("2026-10-08T22:00:00Z")).yesterday, false, "5 PM: today's own window");
  eq(serviceHoursAt(svc, "D", utc("2026-11-26T16:00:00Z")).hours.exception, "removed");
  eq(serviceHoursAt(svc, "zz", t), null);
});

test("schedule: scheduledUntil = end of the window running now (after-midnight tail too)", () => {
  eq(scheduledUntil(S, "N", utc("2026-10-08T07:00:00Z")), "28:29", "2 AM Thu: Wed night service until 4:29 AM");
  eq(clock12(scheduledUntil(S, "N", utc("2026-10-08T22:00:00Z"))), "4:29 AM", "5 PM: tonight's window");
  eq(scheduledUntil(S, "D", utc("2026-10-08T15:00:00Z")), "19:25");
  eq(scheduledUntil(S, "D", utc("2026-10-10T16:00:00Z")), "14:00", "added Saturday service");
  eq(scheduledUntil(S, "N", utc("2026-10-08T15:00:00Z")), null, "10 AM: not scheduled");
  eq(scheduledUntil(S, "D", utc("2026-11-26T16:00:00Z")), null, "holiday removed");
  eq(scheduledUntil(S, "zz", 0), null, "no schedule data");
});

test("schedule: busesByHour in service-day order + groupHours", () => {
  const n = busesByHour(S, "N", "mon");
  eq(n[0], { hour: 16, buses: 2 });
  eq(n[n.length - 1], { hour: 4, buses: 1 });
  eq(n.length, 13);
  eq(groupHours(n), [{ from: 16, to: 24, buses: 2 }, { from: 0, to: 5, buses: 1 }]);
  eq(busesByHour(S, "D", "sat"), []);
  eq(groupHours(busesByHour(S, "D", "tue")).map((g) => g.buses), [1, 3, 1]);
});

test("schedule: upcomingChanges within the horizon, sorted, labeled", () => {
  const now = utc("2026-10-08T15:00:00Z");
  eq(upcomingChanges(S, "D", now), [{ date: "2026-10-10", label: "Sat, Oct 10", text: `Extra service: 10:00 AM ${D} 2:00 PM` }]);
  const far = upcomingChanges(S, "D", now, 60);
  eq(far.map((c) => c.text), [`Extra service: 10:00 AM ${D} 2:00 PM`, "No service"]);
  eq(far[1].label, "Thu, Nov 26");
  eq(upcomingChanges(S, "D", utc("2026-11-27T15:00:00Z")), [], "past changes dropped");
  eq(upcomingChanges(S, "N", now), []);
});

test("schedule: real data/service.json is well formed", async () => {
  const svc = await (await fetch("../data/service.json", { cache: "no-store" })).json();
  const ids = Object.keys(svc.routes || {});
  ok(ids.length > 0, "routes present");
  ok(/^\d{4}-\d{2}-\d{2}$/.test(svc.feed.start) && /^\d{4}-\d{2}-\d{2}$/.test(svc.feed.end), "feed window");
  for (const rid of ids) {
    ok(routeService(svc, rid), "entry " + rid);
    for (const w of weekSummary(svc, rid)) ok(w.label === "No service" || /\d:\d\d [AP]M to \d/.test(w.label), rid + " label " + w.label);
    for (const d of Object.values(svc.routes[rid].days)) if (d) eq(d.buses.length, 24, rid + " buses[24]");
  }
});

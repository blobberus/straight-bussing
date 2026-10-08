// core/schedule.js unit tests.
import { test, eq, ok } from "./lib.js";
import { localParts, clock12, dayKey, hoursOn, weekSummary, busesByHour, upcomingChanges, isScheduledNow, groupHours, hourLabel, routeService } from "../js/core/schedule.js";
import { serviceFixture, utc } from "./route-fixtures.js";

const S = serviceFixture();
const D = "\u2013";

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
  eq(weekSummary(S, "D"), [{ days: `Mon${D}Fri`, label: `7:00 AM ${D} 7:25 PM` }, { days: `Sat${D}Sun`, label: "No service" }]);
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
    for (const w of weekSummary(svc, rid)) ok(w.label === "No service" || /\d:\d\d [AP]M \u2013 \d/.test(w.label), rid + " label " + w.label);
    for (const d of Object.values(svc.routes[rid].days)) if (d) eq(d.buses.length, 24, rid + " buses[24]");
  }
});

// core/schedule.js unit tests.
import { test, eq, ok } from "./lib.js";
import { localParts, clock12, dayKey, hoursOn, serviceHoursAt, weekSummary, busesByHour, upcomingChanges, isScheduledNow, scheduledUntil, nextStartToday, groupHours, hourLabel, routeService,
  hourBuses, scheduleDay, departures, hourlyHeadways, headwayLine, clockMin, HEADWAY_BREAK_MIN } from "../js/core/schedule.js";
import { clockOfDay } from "../js/core/time.js";
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

// My Routes (owner 2026-10-17): a saved route that is not running says when it starts later today (iOS Kit
// ScheduleTests.testNextStartToday, the same cases)
test("schedule: nextStartToday = the next window starting later today, else null", () => {
  eq(nextStartToday(S, "N", utc("2026-10-08T15:00:00Z")), "16:00", "10 AM: the night route starts at 4 PM");
  eq(nextStartToday(S, "N", utc("2026-10-08T22:00:00Z")), null, "5 PM: running already, nothing later today");
  eq(nextStartToday(S, "D", utc("2026-10-08T11:00:00Z")), "07:00", "6 AM: the day route starts at 7");
  eq(nextStartToday(S, "D", utc("2026-10-08T15:00:00Z")), null, "10 AM: started at 7");
  eq(nextStartToday(S, "D", utc("2026-10-11T15:00:00Z")), null, "Sunday: no service");
  eq(nextStartToday(S, "D", utc("2026-11-26T12:00:00Z")), null, "holiday removed");
  eq(nextStartToday(S, "zz", 0), null);
  eq(nextStartToday(null, "D", 0), null);
});

// ---- Schedule by hour (owner 2026-11-09: "Every 30 minutes between x times"; iOS Kit HeadwayTests, the same cases) ----
const lines = (deps, fmt) => hourlyHeadways(deps).map((s) => { const l = headwayLine(s, fmt); return `${l.text}, ${l.when}`; });
const every = (from, gap, n) => Array.from({ length: n }, (_, i) => from + gap * i);   // n departures
const north0 = () => departures(S.routes.N.days.mon);

test("headways: a constant timetable is one line, first to last bus", () => {
  eq(hourlyHeadways(every(420, 30, 7)), [{ kind: "every", min: 30, from: 420, to: 600 }]);
  eq(lines(every(420, 30, 7)), ["Every 30 min, 7:00 to 10:00 AM"]);
  eq(lines(every(390, 25, 38)), ["Every 25 min, 6:30 AM to 9:55 PM"], "the Downtown Campus Connector's frequency trip");
  eq(lines(every(1080, 60, 7)), ["Every 60 min, 6:00 PM to 12:00 AM"], "hourly is not a break");
});

test("headways: a change of pace starts a new line at the bus where it changes", () => {
  const apdx = [...every(600, 15, 20), ...every(900, 10, 58)];   // Apostolic/Drexel: 15 min, then 10 min to 12:30 AM
  eq(lines(apdx), ["Every 15 min, 10:00 AM to 3:00 PM", "Every 10 min, 3:00 PM to 12:30 AM"]);
  const x53 = departures({ dep: [420, 30, 30, ...Array(10).fill(15), ...Array(15).fill(30), 60] });   // 53rd Street Express
  eq(lines(x53), ["Every 30 min, 7:00 to 8:00 AM", "Every 15 min, 8:00 to 10:30 AM", "Every 30 min, 10:30 AM to 6:00 PM", "1 trip, 7:00 PM"]);
  // a lone odd gap between two steady runs is the hand-over: no line of its own, the next line starts at its bus
  eq(lines([...every(420, 15, 5), 502, ...every(532, 30, 4)]), ["Every 15 min, 7:00 to 8:00 AM", "Every 30 min, 8:22 to 10:22 AM"]);
  // within a minute of a neighbour's pace it belongs to it
  eq(lines([...every(420, 10, 6), 481, ...every(511, 30, 4)]), ["Every 10 min, 7:00 to 8:01 AM", "Every 30 min, 8:01 to 10:01 AM"]);
  // timetable rounding (9 / 10 then 10 / 11 min) stays one line
  eq(lines([420, 429, 439, 448, 458, 468, 479, 489, 500]), ["Every 10 min, 7:00 to 8:20 AM"]);
});

test("headways: uneven gaps read 'About every N min', hour by hour, equal hours merged", () => {
  // Red Line/Arts Block mornings: two patterns 4 and 16 min apart = a bus about every 10 min
  const red = [390, 397];
  for (let t = 413; t <= 657; t += 20) red.push(t, t + 4);
  eq(lines(red), ["About every 10 min, 6:30 to 10:57 AM"]);
  eq(hourlyHeadways(red)[0].kind, "about");
  // Midway Metra mornings: two patterns drifting through each other (10, 11, 8, 12 ... min)
  const mid = departures({ dep: [341, 10, 11, 9, 12, 8, 13, 7, 14, 6, 15, 5, 16, 4, 18, 2, 19, 1, 20, 20, 1, 19, 2, 18, 3] });
  eq(lines(mid), ["About every 10 min, 5:41 to 9:54 AM"]);
  eq(lines([600, 610, 610, 620, 630]), ["Every 10 min, 10:00 to 10:30 AM"], "two trips at the same minute count once");
  // the average rounds to 5 min from 7.5 up, else to the minute; a slower hour gets its own line
  eq(lines([600, 612, 632, 652]), ["About every 15 min, 10:00 to 10:52 AM"], "17.3 min average");
  eq(lines([600, 612, 632, 652, 664, 684, 704]), ["About every 15 min, 10:00 to 11:04 AM", "About every 20 min, 11:04 to 11:44 AM"], "hour by hour");
  eq(lines([600, 603, 609, 612, 618, 621, 627]), ["About every 5 min, 10:00 to 10:27 AM"], "4.5 min average");
  eq(lines([600, 602, 606, 608, 612, 614, 618]), ["About every 3 min, 10:00 to 10:18 AM"], "3 min average");
  eq(lines([600, 604, 620, 624, 640, 644, 660, 690, 722, 750, 782]), ["About every 10 min, 10:00 to 11:00 AM", "About every 30 min, 11:00 AM to 1:02 PM"]);
});

test("headways: single trips, two trips, and breaks in service", () => {
  eq(lines([1380]), ["1 trip, 11:00 PM"]);
  eq(lines([1380, 1420]), ["2 trips, 11:00 and 11:40 PM"]);
  eq(lines([690, 760]), ["2 trips, 11:30 AM and 12:40 PM"]);
  eq(lines([1380, 1410, 1440]), ["Every 30 min, 11:00 PM to 12:00 AM"], "three buses evenly spaced");
  eq(lines([1380, 1420, 1445]), ["About every 35 min, 11:00 PM to 12:05 AM"], "32.5 min rounds up");
  // Midway Metra: morning and afternoon service with nothing between (a gap of 90 min or more)
  eq(lines([...every(341, 10, 26), ...every(941, 10, 19)]), ["Every 10 min, 5:41 to 9:51 AM", "No service, 9:51 AM to 3:41 PM", "Every 10 min, 3:41 to 6:41 PM"]);
  eq(HEADWAY_BREAK_MIN, 90);
  eq(lines([600, 689]).length, 1, "89 min apart: the same stretch");
  eq(lines([600, 690]), ["1 trip, 10:00 AM", "No service, 10:00 to 11:30 AM", "1 trip, 11:30 AM"]);
  eq(lines([360, ...every(397, 20, 6)]), ["1 trip, 6:00 AM", "Every 20 min, 6:37 to 8:17 AM"], "a lone first bus");
});

test("headways: after midnight the night route's service day keeps going (24:00 and on)", () => {
  const north = north0();
  eq(north[0], 960);
  eq(north[north.length - 1], 1680, "4:00 AM = 28:00 on the service day");
  eq(lines(north), ["Every 15 min, 4:00 to 11:00 PM", "Every 30 min, 11:00 PM to 4:00 AM"]);
  eq(lines(every(1410, 30, 4)), ["Every 30 min, 11:30 PM to 1:00 AM"]);
  eq([clockMin(1470), clockMin(0), clockMin(720), clockMin(-30)], ["12:30 AM", "12:00 AM", "12:00 PM", "11:30 PM"]);
});

test("headways: departures() decodes service.json dep and refuses junk; junk departures are skipped", () => {
  eq(departures({ dep: [420, 30, 30] }), [420, 450, 480]);
  eq(departures({ dep: [0, 15] }), [0, 15]);
  for (const bad of [{ dep: [420, -5] }, { dep: [420, "30"] }, { dep: [420, 2.5] }, { dep: [420, 9999] }, { dep: "420" }, {}, null]) eq(departures(bad), [], JSON.stringify(bad));
  eq(hourlyHeadways([450, 420, NaN, "x", 480, 480, -3, 510.5, 510]), hourlyHeadways([420, 450, 480, 510]), "sorted, deduped, junk out");
  eq(hourlyHeadways([]), []);
  eq(hourlyHeadways(null), []);
  eq(hourlyHeadways(undefined), []);
});

test("headways: words for screen readers and the 12 / 24 hour clock", () => {
  const seg = { kind: "every", min: 30, from: 420, to: 600 };
  eq(headwayLine(seg), { text: "Every 30 min", when: "7:00 to 10:00 AM", say: "Every 30 minutes, 7:00 to 10:00 AM" });
  eq(headwayLine({ kind: "about", min: 1, from: 600, to: 610 }).say, "About every 1 minute, 10:00 to 10:10 AM");
  eq(headwayLine({ kind: "trips", n: 1, from: 1380, to: 1380 }), { text: "1 trip", when: "11:00 PM", say: "1 trip, 11:00 PM" });
  eq(headwayLine({ kind: "none", from: 594, to: 941 }).say, "No service, 9:54 AM to 3:41 PM");
  const h24 = (m) => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  eq(headwayLine(seg, h24).when, "07:00 to 10:00", "24-hour clocks have no AM / PM to share");
  const nnbsp = (m) => clockMin(m).replace(" ", " ");   // newer Intl output: a narrow no-break space before AM / PM
  eq(headwayLine(seg, nnbsp).when, "7:00 to 10:00 AM");
  // the app's clock: the device's own 12 / 24 hour style, never shifted by a time zone or daylight saving
  const t = clockOfDay(420);
  ok(/^0?7:00/.test(t) && !/PM/.test(t), t);
  eq(clockOfDay(1470), clockOfDay(30), "after midnight wraps");
  ok(!/[–—]/.test(lines(north0()).join(" ")), "no dash characters (docs/DESIGN.md Copy)");
});

test("scheduleDay: the bars' and the list's day = the service day, calendar changes applied", () => {
  const wed10 = scheduleDay(S, "D", utc("2026-10-07T15:00:00Z"));   // Wed 10 AM
  eq([wed10.key, wed10.today, wed10.yesterday, wed10.exception], ["wed", true, false, undefined]);
  const night = scheduleDay(S, "N", utc("2026-10-08T07:00:00Z"));   // Thu 2 AM = Wednesday's night service
  eq([night.key, night.today, night.yesterday], ["wed", true, true]);
  // an extra Saturday (calendar change "added"): its own timetable, every 20 min
  const extra = scheduleDay(S, "D", utc("2026-10-10T15:00:00Z"));
  eq([extra.key, extra.today, extra.exception], ["sat", true, "added"]);
  eq(lines(departures(extra.day)), ["Every 20 min, 10:00 AM to 2:00 PM"]);
  eq(hourBuses(extra.day), [], "an old calendar change without bus counts: no bars, never the regular Saturday's");
  // Thanksgiving off: that weekday's regular timetable (not "today")
  const hol = scheduleDay(S, "D", utc("2026-11-26T16:00:00Z"));
  eq([hol.key, hol.today, hol.exception], ["thu", false, undefined]);
  // a regular Sunday without service: the first weekday with service
  const sun = scheduleDay(S, "D", utc("2026-10-11T15:00:00Z"));
  eq([sun.key, sun.today], ["mon", false]);
  eq(hourBuses(sun.day), busesByHour(S, "D", "mon"));
  eq(scheduleDay(S, "zz", 0), null);
  eq(scheduleDay({ routes: { E: { days: { mon: null }, exceptions: [] } } }, "E", 0), null, "no service on any day");
});

test("schedule: real data/service.json departures make sense (dep + at)", async () => {
  const svc = await (await fetch("../data/service.json", { cache: "no-store" })).json();
  const stops = await (await fetch("../data/stops.json", { cache: "no-store" })).json();
  let n = 0;
  for (const [rid, r] of Object.entries(svc.routes)) {
    if (r.at) ok(stops[r.at], rid + " reference stop " + r.at + " is a known stop");
    for (const d of Object.values(r.days)) {
      if (!d || !d.dep) continue;
      const deps = departures(d);
      ok(deps.length > 0, rid + " dep decodes");
      const [h, m] = d.spans[0][0].split(":").map(Number);
      ok(deps[0] >= h * 60 + m && deps[deps.length - 1] < 2880, rid + " departures inside the service day");
      for (const l of hourlyHeadways(deps)) ok(headwayLine(l).text, rid);
      n++;
    }
  }
  ok(n > 0, "some days carry departures");
});

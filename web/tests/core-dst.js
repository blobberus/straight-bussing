// Daylight saving in Chicago (bug check 2026-10-29): Sunday Nov 1 2026 2:00 AM CDT -> 1:00 AM CST (1 AM repeats),
// Sunday Mar 14 2027 2:00 AM CST -> 3:00 AM CDT (2 AM skipped). Every time and schedule rule is Chicago wall-clock time:
// route hours, the after-midnight tail of yesterday's service, Lines by Time, the usage rows, the learned hour bucket.
import { test, eq, ok } from "./lib.js";
import { clock, shortDate, sameDay } from "../js/core/time.js";
import { localParts, isScheduledNow, serviceHoursAt, scheduledUntil, nextStartToday, hoursOn } from "../js/core/schedule.js";
import { chicagoUnix, pickedUnix, pickerValues, linesActiveAt, timeLabel } from "../js/core/timeactive.js";
import { chicagoParts } from "../js/data/usage.js";
import { howBucket } from "../js/core/predict.js";
import { scheduledRoutes, isOperating } from "../js/core/operating.js";

const FALL = { a0030: 1793511000, a0130cdt: 1793514600, a0130cst: 1793518200, a0230: 1793521800, a0428: 1793528880, a0430: 1793529000 };
const FALL_EVE = 1793505600;   // Sat Oct 31 2026 11:00 PM CDT
const SPRING = { a0030: 1805005800, a0130: 1805009400, a0330: 1805013000, a0428: 1805016480 };
const night = { first: "16:00", last: "28:29", trips: 20, buses: Array(24).fill(1), spans: [["16:00", "28:29"]] };
const day = { first: "05:00", last: "20:55", trips: 30, buses: Array(24).fill(1), spans: [["05:00", "20:55"]] };
const SERVICE = { feed: { start: "2026-10-26", end: "2027-06-30" }, routes: {
  N: { days: { mon: night, tue: night, wed: night, thu: night, fri: night, sat: night, sun: night }, exceptions: [] },
  D: { days: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }, exceptions: [] },
} };
const ROUTES = { N: { short: "N", long: "North" }, D: { short: "D", long: "Day" } };
const plain = (s) => String(s).replace(/\s/g, " ");

test("dst: local parts and clock on the night the 1 AM hour repeats", () => {
  const mins = Object.values(FALL).map((t) => localParts(t).min);
  eq(mins, [30, 90, 90, 150, 268, 270], "wall-clock minutes; both 1:30 AMs read 1:30");
  for (const t of Object.values(FALL)) eq([localParts(t).y, localParts(t).m, localParts(t).d, localParts(t).dow], [2026, 11, 1, 6], "Sunday Nov 1");
  eq([FALL.a0030, FALL.a0130cdt, FALL.a0130cst, FALL.a0230].map((t) => plain(clock(t))), ["12:30 AM", "1:30 AM", "1:30 AM", "2:30 AM"]);
  eq(shortDate(FALL.a0130cst), "Nov 1");
  ok(sameDay(FALL.a0030, FALL.a0430) && !sameDay(FALL_EVE, FALL.a0030), "one Chicago day from midnight; 11 PM Saturday is the day before");
});

test("dst: a night route's after-midnight tail holds through both 1 AMs and ends at its wall-clock time", () => {
  for (const k of ["a0030", "a0130cdt", "a0130cst", "a0230", "a0428"]) {
    eq(isScheduledNow(SERVICE, "N", FALL[k]), true, k);
    const sh = serviceHoursAt(SERVICE, "N", FALL[k]);
    eq([sh.yesterday, sh.dayKey], [true, "sat"], k + ": Saturday's service");
    eq(scheduledUntil(SERVICE, "N", FALL[k]), "28:29", k);
  }
  eq(isScheduledNow(SERVICE, "N", FALL.a0430), false, "4:30 AM: Saturday's service ended at 4:29");
  eq(serviceHoursAt(SERVICE, "N", FALL.a0430).yesterday, false);
  eq(nextStartToday(SERVICE, "N", FALL.a0230), "16:00");
  eq(isScheduledNow(SERVICE, "D", FALL.a0428), false);
  eq(nextStartToday(SERVICE, "D", FALL.a0428), "05:00");
  eq(hoursOn(SERVICE, "D", FALL.a0130cst).label, "5:00 AM to 8:55 PM");
  eq(scheduledRoutes({ staticLoaded: true, routes: ROUTES, service: SERVICE }, FALL.a0130cst), ["N"]);
});

test("dst: the spring night (2 AM skipped) keeps the same wall-clock rules", () => {
  eq(Object.values(SPRING).map((t) => localParts(t).min), [30, 90, 210, 268]);
  for (const k of ["a0030", "a0130", "a0330", "a0428"]) eq(isScheduledNow(SERVICE, "N", SPRING[k]), true, k);
  eq(isScheduledNow(SERVICE, "N", SPRING.a0428 + 120), false, "4:30 AM CDT");
  eq(plain(clock(SPRING.a0330)), "3:30 AM");
});

test("dst: Lines by Time picks the first 1:30 AM in November and moves a skipped 2:30 AM to 3:30", () => {
  eq(chicagoUnix(2026, 11, 1, 1, 30), FALL.a0130cdt);
  eq(chicagoUnix(2026, 11, 1, 2, 30), FALL.a0230);
  eq(chicagoUnix(2026, 11, 1, 0, 30), FALL.a0030);
  eq(chicagoUnix(2027, 3, 14, 2, 30), SPRING.a0330, "skipped: an hour later on the clock");
  eq(chicagoUnix(2027, 3, 14, 3, 30), SPRING.a0330);
  eq(chicagoUnix(2027, 3, 14, 1, 30), SPRING.a0130);
  eq(pickerValues(FALL.a0130cst), { month: 11, day: 1, hour12: 1, minute: 30, pm: false }, "the second 1:30 AM shows as 1:30 AM");
  eq(pickedUnix({ month: 11, day: 1, hour12: 1, minute: 30, pm: false }, FALL_EVE), FALL.a0130cdt);
  ok(plain(timeLabel(FALL.a0130cst)).startsWith("Sun Nov 1, 1:30"), timeLabel(FALL.a0130cst));
  eq(linesActiveAt(SERVICE, ROUTES, FALL.a0130cst).rids, ["N"]);
});

test("dst: usage rows and the learned hour-of-week bucket use the wall clock", () => {
  eq(chicagoParts(FALL.a0130cdt), { day: "2026-11-01", dow: 0, time: "01:30" });
  eq(chicagoParts(FALL.a0130cst), { day: "2026-11-01", dow: 0, time: "01:30" });
  eq(chicagoParts(FALL.a0230).time, "02:30");
  eq(chicagoParts(SPRING.a0330), { day: "2027-03-14", dow: 0, time: "03:30" });
  eq([howBucket(FALL.a0130cdt), howBucket(FALL.a0130cst), howBucket(FALL.a0230)], [6 * 24 + 1, 6 * 24 + 1, 6 * 24 + 2], "Sunday 1 AM (twice), 2 AM");
});

test("dst: a bus finishing Saturday's night route at 1:30 AM CST still counts as operating", () => {
  const bus = { position: { latitude: 41.79, longitude: -87.6 }, timestamp: FALL.a0130cst - 10, trip: { route_id: "N", trip_id: "t1" }, vehicle: { id: "v1" } };
  ok(isOperating(bus, { routes: ROUTES, service: SERVICE, trips: [], feedTs: FALL.a0130cst, nowS: FALL.a0130cst, staticLoaded: true }));
});

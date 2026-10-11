// Clock times on a device outside Chicago (zone.test.html loads zone-sim.js first: this page is "in Los Angeles").
// Every wall-clock time and date a rider sees is America/Chicago, the zone of the route hours and service days.
import { test, eq, ok } from "./lib.js";
import { clock, shortDate, sameDay } from "../js/core/time.js";
import { localParts, dayKey } from "../js/core/schedule.js";
import { renderAlerts } from "../js/ui/views/alerts.js";
import { alertsHTML } from "../js/ui/views/settings.js";

// 1.8e9 = Fri 2027-01-15 08:00 UTC = 2:00 AM in Chicago (CST) = 12:00 AM in Los Angeles (PST)
const T = 1_800_000_000;
// one hour earlier: 1:00 AM Fri Jan 15 in Chicago, still 11:00 PM Thu Jan 14 in Los Angeles
const NOW = T - 3600;
// Wed 2026-10-07 9:40 PM in Chicago (CDT) = 2026-10-08T02:40:00Z = 7:40 PM in Los Angeles (PDT)
const CDT = 1791427200;
const plain = (s) => String(s).replace(/[\u202f\u00a0]/g, " ");
const alert = (end, start) => ({ header_text: "Detour on 55th", active_period: [{ ...(start ? { start } : {}), end }] });
const state = (alerts) => ({ liveLoaded: true, failed: false, alerts, routes: {}, stops: {} });

test("zone: this page simulates a device in Los Angeles", () => {
  eq(window.SIMULATED_ZONE, "America/Los_Angeles");
  eq(new Intl.DateTimeFormat().resolvedOptions().timeZone, "America/Los_Angeles", "Intl default zone");
  eq(new Date(T * 1000).getHours(), 0, "Date getters read Los Angeles wall time");
  eq(new Date(T * 1000).getTimezoneOffset(), 480);
  eq(new Date(NOW * 1000).toDateString(), "Thu Jan 14 2027");
});

test("zone: clock() shows Chicago wall time, not the device's", () => {
  const s = plain(clock(T));
  ok(/^(2:00 AM|0?2:00)$/.test(s), "2:00 AM in Chicago, got " + s);
  const c = plain(clock(CDT));
  ok(/^(9:40 PM|21:40)$/.test(c), "9:40 PM in Chicago (daylight time), got " + c);
  const la = plain(new Date(T * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
  ok(la !== s, "the device would have said " + la);
});

test("zone: dates and 'today' are the Chicago calendar day", () => {
  ok(/Jan 15/.test(shortDate(NOW)), "Jan 15 in Chicago (Jan 14 on the device), got " + shortDate(NOW));
  ok(/Jan 15/.test(shortDate(T, true)) && /2027/.test(shortDate(T, true)), shortDate(T, true));
  ok(sameDay(NOW, T), "1 AM and 2 AM Fri in Chicago: the same day");
  ok(!sameDay(T - 3 * 3600, T), "11 PM Thu and 2 AM Fri in Chicago: not the same day");
  eq(shortDate(0), "");
  eq(sameDay(NaN, T), false);
});

test("zone: schedule parts and service day stay Chicago", () => {
  const p = localParts(NOW);
  eq([p.y, p.m, p.d, p.dow, p.min], [2027, 1, 15, 4, 60], "Fri Jan 15, 1:00 AM (Monday = 0)");
  eq(dayKey(NOW), "fri");
});

test("zone: Alerts screen windows use Chicago days and times", () => {
  const until = (h) => (/Until ([^<]+)</.exec(h) || [])[1];
  const soon = until(renderAlerts(state([alert(T, T - 7200)]), NOW));
  eq(plain(soon), plain(clock(T)), "ends later this Chicago day: a time");
  // 11 PM Fri in Chicago is 9 PM Fri in Los Angeles, the device's tomorrow
  const tonight = until(renderAlerts(state([alert(T + 75600)]), NOW));
  ok(/^(11:00 PM|23:00)$/.test(plain(tonight)), "still today in Chicago, got " + tonight);
  // 1 AM Sun Jan 17 in Chicago is 11 PM Sat Jan 16 in Los Angeles
  const sunday = until(renderAlerts(state([alert(T + 2 * 86400 - 3600)]), NOW));
  ok(/Jan 17/.test(sunday), "the Chicago date, got " + sunday);
});

test("zone: Settings alert periods use Chicago days and times", () => {
  const h = plain(alertsHTML(state([alert(T + 3600, T - 7200)]), NOW));
  ok(h.includes(plain(`${clock(T - 7200)} to ${clock(T + 3600)}`)), "12:00 AM to 3:00 AM, both today in Chicago");
  ok(!/Jan 1[45]/.test(h), "no date for a same-day period");
  const later = plain(alertsHTML(state([alert(T + 2 * 86400 - 3600, T - 7200)]), NOW));
  ok(/to Jan 17 /.test(later), "a later Chicago date with its time, got " + later.slice(0, 400));
});

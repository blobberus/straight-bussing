/**
 * @module core/timeactive
 * "Lines by Time" (owner 2026-10-18): which lines the published timetable (data/service.json) has running at a
 * chosen Chicago date and time. Pure, no DOM, never throws. This is SCHEDULE data, never live: the menu says so
 * (holidays, breaks, detours, weather, service changes; night routes often send no bus after midnight).
 *
 * The rider picks a month, a day and a clock time, no year: the year is the next time that date comes, counted
 * from today in Chicago (today itself counts, so an earlier time today is today's). A route runs at a time when the
 * time falls in one of its spans that day, or in the after-midnight tail of the previous day's spans (core/schedule.js
 * isScheduledNow: 1:00 AM Saturday checks Friday's spans past 24:00), with calendar exceptions applied. A date
 * outside the timetable's own dates (service.feed start / end) has no holiday data: the regular weekday pattern is
 * used and the result says so. Same rules as the iOS Kit TimeActive.
 */

import { localParts, isScheduledNow } from "./schedule.js";
import { clock } from "./time.js";

export const MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
export const MONTHS_LONG = Object.freeze(["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"]);
const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Menu title, the text under the clock (owner's words), the result name prefix and the disclaimer. */
export const TIME_TITLE = "Lines by Time";
export const TIME_DESC = "Select a time to check when certain lines will be active. Lines that are active will be made visible on the current map.";
export const TIME_PREFIX = "Lines active at";
export const TIME_DISCLAIMER = "This is an estimate from the published timetable, not from live bus locations. It can be wrong on "
  + "holidays, breaks and special events, during detours or bad weather, and when the operator changes service. A line can "
  + "be scheduled and still not run: late at night the live map often shows no buses while the timetable lists night routes. "
  + "Straight Bussing is unofficial, so check with the official service before you rely on it.";
/** No line scheduled at the chosen time (on-screen, like Show running's "No lines are operating at this time."). */
export const TIME_NONE = "No lines are scheduled at this time.";

/**
 * Days in a month of a year (Feb 29 only in leap years).
 * @param {number} m 1-12
 * @param {number} y
 * @returns {number}
 */
export function daysIn(m, y) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Unix seconds of a Chicago wall-clock time (DST handled by asking the zone's own clock; a time skipped by the
 * spring change lands an hour later, a repeated one on its first occurrence).
 * @param {number} y
 * @param {number} m 1-12
 * @param {number} d
 * @param {number} h 0-23
 * @param {number} min 0-59
 * @returns {number}
 */
export function chicagoUnix(y, m, d, h, min) {
  const want = Date.UTC(y, m - 1, d, h, min) / 1000;
  for (const off of [5, 6]) {                 // Chicago is UTC-5 (CDT) or UTC-6 (CST): CDT first = the first 1:30 AM in November
    const p = localParts(want + off * 3600);
    if (Date.UTC(p.y, p.m - 1, p.d, Math.floor(p.min / 60), p.min % 60) / 1000 === want) return want + off * 3600;
  }
  return want + 6 * 3600;                     // skipped by the March change: an hour later on the clock
}

/**
 * The next time a month/day comes, from `now` (Chicago), today included. Feb 29 in a year without one is Feb 28.
 * @param {number} m 1-12
 * @param {number} d 1-31
 * @param {number} now unix seconds
 * @returns {{y:number, m:number, d:number}}
 */
export function nextOccurrence(m, d, now) {
  const p = localParts(now);
  let y = p.y;
  if (m < p.m || (m === p.m && d < p.d)) y += 1;
  return { y, m, d: Math.min(d, daysIn(m, y)) };
}

/**
 * The chosen moment from the picker's values.
 * @param {{month:number, day:number, hour12:number, minute:number, pm:boolean}} v month 1-12, hour12 1-12
 * @param {number} now unix seconds
 * @returns {number} unix seconds
 */
export function pickedUnix(v, now) {
  const { y, m, d } = nextOccurrence(v.month, v.day, now);
  const h = (v.hour12 % 12) + (v.pm ? 12 : 0);
  return chicagoUnix(y, m, d, h, v.minute);
}

/**
 * Picker values for a moment (the defaults: now, Chicago).
 * @param {number} unixS
 * @returns {{month:number, day:number, hour12:number, minute:number, pm:boolean}}
 */
export function pickerValues(unixS) {
  const p = localParts(unixS), h = Math.floor(p.min / 60);
  return { month: p.m, day: p.d, hour12: (h + 11) % 12 + 1, minute: p.min % 60, pm: h >= 12 };
}

/**
 * Days the day wheel offers for a month: 29 for February (Feb 29 becomes Feb 28 in other years, nextOccurrence),
 * else the month's own length.
 * @param {number} m 1-12
 * @returns {number}
 */
export function pickerDays(m) {
  return m === 2 ? 29 : daysIn(m, 2025);
}

/**
 * "Sat Oct 24, 9:30 PM" (Chicago; the clock keeps the device's 12 / 24 h preference like every time in the app).
 * @param {number} unixS
 * @returns {string}
 */
export function timeLabel(unixS) {
  const p = localParts(unixS);
  return `${DOW_SHORT[p.dow]} ${MONTHS[p.m - 1]} ${p.d}, ${clock(unixS)}`;
}

/**
 * The temporary custom route's name.
 * @param {number} unixS
 * @returns {string} "Lines active at Sat Oct 24, 9:30 PM"
 */
export function timeName(unixS) {
  return `${TIME_PREFIX} ${timeLabel(unixS)}`;
}

/** 'YYYY-MM-DD' (Chicago) of a unix time. */
function isoOf(unixS) {
  const p = localParts(unixS);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/**
 * Lines the timetable has running at `at`.
 * @param {object} service store.service (data/service.json)
 * @param {object} routes store.routes (only these ids count, in their order)
 * @param {number} at unix seconds
 * @returns {{rids:string[], known:boolean, outsideFeed:boolean, note:string}}
 *   known: false when there is no timetable at all (nothing can be said); outsideFeed: the date is outside the
 *   timetable's own dates, so its holiday changes are unknown (note says so); note: '' or one plain sentence
 */
export function linesActiveAt(service, routes, at) {
  const ids = Object.keys(routes || {});
  const known = !!(service && service.routes && Object.keys(service.routes).length);
  if (!known || !Number.isFinite(at)) return { rids: [], known: false, outsideFeed: false, note: "" };
  const rids = ids.filter((rid) => isScheduledNow(service, rid, at) === true);
  const f = service.feed || {}, iso = isoOf(at);
  const outsideFeed = !!((f.start && iso < f.start) || (f.end && iso > f.end));
  const note = outsideFeed ? "This date is outside the published timetable, so the regular weekly pattern is used. Holidays and breaks are not included." : "";
  return { rids, known: true, outsideFeed, note };
}

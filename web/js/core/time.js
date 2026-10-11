/**
 * @module core/time
 * Time helpers. All times are unix seconds (number). Pure, no DOM.
 * Every clock time and date a rider sees is America/Chicago, whatever zone the device is in: route hours and
 * service days are Chicago time (core/schedule.js), so a phone elsewhere must never mix the two.
 */

import { localParts } from "./schedule.js";

/** The service's time zone. */
export const ZONE = "America/Chicago";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Current time in unix seconds (float).
 * @returns {number}
 */
export const nowS = () => Date.now() / 1000;

let clockFmt = null;
const dateFmts = {};

const valid = (t) => typeof t === "number" && isFinite(t) && t > 0;

/**
 * Format a unix time as a short Chicago clock string, e.g. '4:12 PM' (or '16:12': the device locale's
 * 12 / 24 hour preference stays). Returns '' for missing/invalid input.
 * @param {number} unixS
 * @returns {string}
 */
export function clock(unixS) {
  if (!valid(unixS)) return "";
  try {
    if (!clockFmt) clockFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: ZONE });
    return clockFmt.format(new Date(unixS * 1000));
  } catch (e) {
    const t = localParts(unixS).min, h = Math.floor(t / 60), m = t % 60;
    return ((h + 11) % 12 + 1) + ":" + String(m).padStart(2, "0") + (h < 12 ? " AM" : " PM");
  }
}

/**
 * Chicago calendar date of a unix time: 'Oct 12', or 'Oct 12, 2026' with the year. '' for invalid input.
 * @param {number} unixS
 * @param {boolean} [withYear=false]
 * @returns {string}
 */
export function shortDate(unixS, withYear = false) {
  if (!valid(unixS)) return "";
  const k = withYear ? "y" : "d";
  try {
    if (!dateFmts[k]) dateFmts[k] = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: ZONE });
    return dateFmts[k].format(new Date(unixS * 1000));
  } catch (e) {
    const p = localParts(unixS);
    return MONTHS[p.m - 1] + " " + p.d + (withYear ? ", " + p.y : "");
  }
}

/**
 * Do two unix times fall on the same Chicago calendar day ("today" for alert windows)?
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
export function sameDay(a, b) {
  if (!valid(a) || !valid(b)) return false;
  const p = localParts(a), q = localParts(b);
  return p.y === q.y && p.m === q.m && p.d === q.d;
}

/**
 * Whole minutes from `from` until `unixS`, floored. Can be zero or negative.
 * @param {number} unixS
 * @param {number} [from=nowS()]
 * @returns {number}
 */
export function minsUntil(unixS, from = nowS()) {
  return Math.floor((unixS - from) / 60);
}

/**
 * Human relative age: '8s ago', '3 min ago', '2 h ago', '3 d ago'. Future/now -> 'just now'.
 * Missing/invalid input -> 'never'.
 * @param {number} unixS
 * @param {number} [from=nowS()] reference time (for tests)
 * @returns {string}
 */
export function ago(unixS, from = nowS()) {
  if (typeof unixS !== "number" || !isFinite(unixS) || unixS <= 0) return "never";
  const s = Math.floor(from - unixS);
  if (s < 1) return "just now";
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return Math.floor(s / 86400) + " d ago";
}

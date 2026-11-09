/**
 * @module core/timetable
 * A trip at a chosen start time (owner 2026-11-09: "when deciding a destination, the user should have an optional trip
 * start time. This trip start time should schedule the arrivals based on the scheduled arrival time"). Pure, no DOM,
 * never throws. Reads data/timetable.json as cleaned by data/timetable.js (tools/build_gtfs.py build_timetable).
 *
 * - Which mode (startMode): no start time, or one already past = "now" (live, as always); a start time less than
 *   LIVE_SOON_MIN minutes away = "live" (live predictions planned from that time: they beat the timetable this close, and
 *   Start stays available); later = "timetable" (scheduled times only; no live bus, no live prediction, no headway
 *   guess; the larger disclaimer). Same rule as the iOS Kit TripStart.
 * - Service days: a service runs on a date when its calendar weekday and date range say so, then calendar_dates add or
 *   remove it. Trip times are wall-clock Chicago times on the service date; a time past 24:00 (a night route's
 *   after-midnight trips, as tools/build_gtfs.py writes them) is that clock time on the next date, the reading
 *   core/schedule.js uses for listed hours. A date outside the timetable's own dates has no holiday data: the weekly
 *   pattern is used and the plan says so (outsideTimetable), as Lines by Time does.
 * - Trip instances: every scheduled trip of the service dates around the start time, with the clock time at each stop
 *   (instancesBetween); departures by "route|stop" (departureIndex: the last stop of a trip is not a boarding point);
 *   the time a trip reaches a stop after boarding (instAt), across the end of a loop onto the trip that starts there
 *   within LAYOVER_MAX_S (nextInstance: a loop ride may go the long way around).
 */

import { localParts } from "./schedule.js";
import { chicagoUnix, MONTHS } from "./timeactive.js";
import { clock } from "./time.js";

/** A start time closer than this (minutes) plans with live times from that time. */
export const LIVE_SOON_MIN = 10;
/** A loop ride continues on the route's next trip from the loop's end stop when it starts within this many seconds. */
export const LAYOVER_MAX_S = 1800;
/** How far ahead of the start time trips are considered (seconds). */
export const AHEAD_S = 4 * 3600;

/* ---------- copy (DESIGN.md "Copy": no dash characters, at most one middle dot per line) ---------- */
export const LEAVE_NOW = "Leave now";
/** The larger disclaimer over a timetable plan (owner: "most buses tend to run late on schedule and currently the
 *  ... shuttles don't have a way of adjusting to this issue"; the app's own words never say "UGo"). */
export const TT_TITLE = "Scheduled times, not live";
export const TT_DISCLAIMER = "Planned from the timetable. Most buses run later than scheduled, and the campus shuttles "
  + "currently have no way to adjust these times for that, so leave extra time. For live times, plan with Leave now.";
/** A start time under LIVE_SOON_MIN away. */
export const TT_SOON = `Your start time is less than ${LIVE_SOON_MIN} minutes away, so these are live times from then.`;
/** Under the selected option of a timetable plan instead of Start. */
export const TT_START_LATER = `Start appears ${LIVE_SOON_MIN} minutes before your start time, when live times take over.`;
export const TT_NONE_TITLE = "No scheduled shuttle trip";
export const TT_OUTSIDE = "This date is outside the published timetable, so the regular weekly pattern is used. Holidays and breaks are not included.";
export const TT_LOADING = "Loading the timetable…";
export const TT_FAILED = "The timetable could not be loaded. Check your connection, or plan with Leave now.";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOW_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Which planning mode a start time means.
 * @param {number|null} at chosen start (unix s) or null
 * @param {number} now unix s
 * @returns {'now'|'live'|'timetable'}
 */
export function startMode(at, now) {
  if (!Number.isFinite(at) || at <= now) return "now";
  return at - now < LIVE_SOON_MIN * 60 ? "live" : "timetable";
}

/** 'YYYY-MM-DD' of a Chicago date. */
export function isoOf(unixS) {
  const p = localParts(unixS);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** An ISO date moved by n days. */
export function isoAdd(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Monday = 0 weekday of an ISO date. */
const dowOf = (iso) => { const [y, m, d] = iso.split("-").map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; };

/**
 * Service ids running on a service date (calendar weekday and date range, then calendar_dates).
 * @param {object} tt cleaned timetable
 * @param {string} iso
 * @returns {Set<string>}
 */
export function servicesOn(tt, iso) {
  const on = new Set(), k = dowOf(iso);
  for (const [sid, s] of Object.entries((tt && tt.services) || {})) {
    if (s.days[k] === "1" && (!s.start || s.start <= iso) && (!s.end || iso <= s.end)) on.add(sid);
  }
  const ex = tt && tt.dates && tt.dates[iso];
  if (ex) for (const [sid, typ] of Object.entries(ex)) { if (typ === 1) on.add(sid); else on.delete(sid); }
  return on;
}

/**
 * Unix time of a service-day time: the Chicago clock time `sec` after midnight of the service date (past 24:00 = that
 * clock time on the next date).
 * @param {string} iso service date
 * @param {number} sec seconds after the service day's midnight (may be >= 86400)
 * @returns {number}
 */
export function serviceUnix(iso, sec) {
  const days = Math.floor(sec / 86400), r = sec - days * 86400;
  const [y, m, d] = isoAdd(iso, days).split("-").map(Number);
  return chicagoUnix(y, m, d, Math.floor(r / 3600), Math.floor((r % 3600) / 60)) + (r % 60);
}

/**
 * The timetable's dates do not cover this time (holidays unknown there: weekly pattern).
 * @param {object} tt
 * @param {number} at
 * @returns {boolean}
 */
export function outsideTimetable(tt, at) {
  const f = (tt && tt.feed) || {}, iso = isoOf(at);
  return !!((f.start && iso < f.start) || (f.end && iso > f.end));
}

/**
 * Scheduled trips running between `from` and `to` (a trip counts while it is between its first and last stop).
 * @param {object} tt cleaned timetable
 * @param {number} from unix s
 * @param {number} to unix s
 * @param {string[]} [rids] only these routes
 * @returns {Array<{rid:string, id:string, stops:string[], times:number[], start:number, end:number}>} by start time
 */
export function instancesBetween(tt, from, to, rids) {
  const out = [];
  if (!tt || !tt.routes || !Number.isFinite(from) || !Number.isFinite(to)) return out;
  const want = rids ? new Set(rids.map(String)) : null;
  const first = isoAdd(isoOf(from), -1), last = isoOf(to);
  const mid = new Map();   // iso -> unix of its midnight and the next two (fast path when no clock change)
  const base = (iso) => {
    if (!mid.has(iso)) mid.set(iso, [0, 1, 2].map((n) => serviceUnix(iso, n * 86400)));
    return mid.get(iso);
  };
  for (let iso = first; iso <= last; iso = isoAdd(iso, 1)) {
    const on = servicesOn(tt, iso);
    if (!on.size) continue;
    const b = base(iso);
    const at = (sec) => {
      const n = Math.floor(sec / 86400);
      return n < 2 && b[n + 1] - b[n] === 86400 ? b[n] + (sec - n * 86400) : serviceUnix(iso, sec);
    };
    for (const [rid, pats] of Object.entries(tt.routes)) {
      if (want && !want.has(rid)) continue;
      pats.forEach((p, pi) => {
        const dur = p.t[p.t.length - 1];
        for (const sid of on) {
          for (const s of p.starts[sid] || []) {
            const t0 = at(s);
            if (t0 + dur < from || t0 > to) continue;
            out.push({ rid, id: `${rid}:${iso}:${pi}:${s}`, stops: p.stops, times: p.t.map((o) => t0 + o), start: t0, end: t0 + dur });
          }
        }
      });
    }
  }
  return out.sort((x, y) => x.start - y.start || (x.id < y.id ? -1 : 1));
}

/**
 * Boarding times by "rid|stopId", earliest first (a trip's last stop is where it ends, not a boarding point).
 * @param {ReturnType<typeof instancesBetween>} instances
 * @returns {Map<string, Array<{t:number, inst:object}>>}
 */
export function departureIndex(instances) {
  const idx = new Map();
  for (const inst of instances) {
    for (let k = 0; k < inst.stops.length - 1; k++) {
      const key = inst.rid + "|" + inst.stops[k];
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push({ t: inst.times[k], inst });
    }
  }
  for (const arr of idx.values()) arr.sort((a, b) => a.t - b.t);
  return idx;
}

/**
 * When a trip reaches a stop strictly after `after`, or null.
 * @param {{stops:string[], times:number[]}} inst
 * @param {string} stopId
 * @param {number} after
 * @returns {number|null}
 */
export function instAt(inst, stopId, after) {
  for (let k = 0; k < inst.stops.length; k++) if (inst.stops[k] === stopId && inst.times[k] > after) return inst.times[k];
  return null;
}

/**
 * The route's trip that starts where `inst` ends, within LAYOVER_MAX_S of its end (the bus going round the loop again).
 * @param {Array<object>} instances by start time
 * @param {object} inst
 * @returns {object|null}
 */
export function nextInstance(instances, inst) {
  const endStop = inst.stops[inst.stops.length - 1];
  for (const x of instances) {
    if (x === inst || x.rid !== inst.rid || x.stops[0] !== endStop) continue;
    if (x.start >= inst.end && x.start <= inst.end + LAYOVER_MAX_S) return x;
  }
  return null;
}

/**
 * When the bus that leaves on `inst` at `depT` reaches `stopId`: on this trip, else on the trip that continues from the
 * end of the loop. Null when neither gets there.
 * @param {Array<object>} instances
 * @param {object} inst
 * @param {string} stopId
 * @param {number} depT
 * @returns {number|null}
 */
export function reachAt(instances, inst, stopId, depT) {
  const t = instAt(inst, stopId, depT);
  if (t != null) return t;
  const next = nextInstance(instances, inst);
  return next ? instAt(next, stopId, depT) : null;
}

/* ---------- the start time control (labels, day list, picker values) ---------- */

/**
 * The control's words: "Leave now", "Leave at 5:40 PM" (today), "Leave tomorrow at 5:40 PM", "Leave Wed Nov 11 at 5:40 PM".
 * @param {number|null} at
 * @param {number} now
 * @returns {string}
 */
export function leaveLabel(at, now) {
  if (startMode(at, now) === "now") return LEAVE_NOW;
  const day = dayWord(at, now);
  return day === "today" ? `Leave at ${clock(at)}` : day === "tomorrow" ? `Leave tomorrow at ${clock(at)}` : `Leave ${day} at ${clock(at)}`;
}

/** "today", "tomorrow" or "Wed Nov 11". */
function dayWord(at, now) {
  const a = isoOf(at), n = isoOf(now);
  if (a === n) return "today";
  if (a === isoAdd(n, 1)) return "tomorrow";
  const p = localParts(at);
  return `${DOW[p.dow]} ${MONTHS[p.m - 1]} ${p.d}`;
}

/**
 * Days the picker offers: today, tomorrow, then the dates through the timetable's last date (at least a week, at most 31).
 * @param {number} now
 * @param {object|null} tt
 * @returns {Array<{iso:string, text:string, say:string}>}
 */
export function leaveDays(now, tt) {
  const today = isoOf(now), end = tt && tt.feed && tt.feed.end;
  let n = 7;
  if (end && end >= today) n = Math.min(31, Math.max(7, Math.round((Date.parse(end) - Date.parse(today)) / 864e5) + 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const iso = isoAdd(today, i), [, m, d] = iso.split("-").map(Number), w = dowOf(iso);
    const text = i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${DOW[w]} ${MONTHS[m - 1]} ${d}`;
    out.push({ iso, text, say: i < 2 ? `${text}, ${DOW_LONG[w]}, ${MONTHS_LONG[m - 1]} ${d}` : `${DOW_LONG[w]}, ${MONTHS_LONG[m - 1]} ${d}` });
  }
  return out;
}

/**
 * Picker values for a moment: {iso, hour12, minute, pm}.
 * @param {number} unixS
 * @returns {{iso:string, hour12:number, minute:number, pm:boolean}}
 */
export function leaveValues(unixS) {
  const p = localParts(unixS), h = Math.floor(p.min / 60);
  return { iso: isoOf(unixS), hour12: (h + 11) % 12 + 1, minute: p.min % 60, pm: h >= 12 };
}

/**
 * The moment the picker's values name.
 * @param {{iso:string, hour12:number, minute:number, pm:boolean}} v
 * @returns {number} unix s
 */
export function leaveUnix(v) {
  const [y, m, d] = v.iso.split("-").map(Number);
  return chicagoUnix(y, m, d, (v.hour12 % 12) + (v.pm ? 12 : 0), v.minute);
}

/**
 * The picker's starting point: the chosen time, else now rounded up to the next 5 minutes.
 * @param {number|null} at
 * @param {number} now
 * @returns {number}
 */
export function leaveDefault(at, now) {
  if (Number.isFinite(at) && at > now) return at;
  return Math.ceil((now + 1) / 300) * 300;
}

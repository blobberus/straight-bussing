/**
 * @module core/seen
 * Transition windows from the seen service windows (web/data/service_seen.json, tools/build_service_seen.py: when each
 * line's buses are really seen starting and ending service, and when a bus leaves one line to start another). Owner
 * 2026-11-11: "Still show these buses if they are in a transition time to their new route (indicate this on their bus
 * icon (if the bus is clicked, have it display: Transitioning to new line)." core/offroute.js asks transitionAt before it
 * hides a bus off its route: inside a window the bus stays on the map, marked (data/live.js store.transitioning).
 * Measured on the E32 replay (RouteKnower E32c). Pure logic, no DOM; iOS Kit Seen.swift (same rule and numbers).
 *
 * A WINDOW of line L on a service day (the entry of lines[L].days whose dows include the day, used only while that
 * day's listed hours of L equal the entry's `listed.spans` and the file is not past valid_until):
 *   transition  a usual line-to-line transition from or to L (transitions[], on that day type): from TRANSITION_PAD_S
 *               before the median leave (its last stop on the old line) to TRANSITION_PAD_S after the median join (its
 *               first stop on the new line); for a transition after a break (kind after_break: the bus rests 30 min to
 *               3 h between the lines) only TRANSITION_PAD_S around the join, the drive to the new line (a bus going on
 *               its break is not on its way). A bus heading to its new line mostly still carries its old line's label.
 *   start       a usual shift start of L (lines[L] buses[k], seen on START_MIN_DAYS days or more): TRANSITION_PAD_S
 *               around the median first stop (the bus driving out of the garage to start service).
 * A shift END is not a window: a bus leaving its line for the garage is what the off-route rule hides (E27b).
 * The times are learned, never shown as a schedule.
 *
 * The store keeps the cleaned file (data/static.js cleanSeen): {valid_until, lines: {rid: [{dows, spans, starts}]},
 * transitions: [{from, to, dows, leave, join, brk}]} (minutes on the service-day clock, 00:30 after midnight = 1470;
 * brk = after a break). Inside a window a bus is marked only while it heads back toward its line (TOWARD_M, core/offroute.js).
 */
import { serviceClock, hoursKey } from "./schedule.js";

/** A window runs this long before and after its learned times (s; RouteKnower E30's transition windows). */
export const TRANSITION_PAD_S = 30 * 60;
/** A shift start counts when that bus slot was seen on at least this many days. */
export const START_MIN_DAYS = 3;
/**
 * Only this close to its route (m) is an off-route bus kept on the map as transitioning (RouteKnower E32c: of the marked
 * minutes 1 km or more off, 20% were a bus that then served, 300 m to 1 km 60%).
 */
export const TRANSITION_MAX_M = 1000;
/** A transitioning bus's Passio times stay on screen (true) or only its marked badge does (false; RouteKnower E32c). */
export const TRANSITION_TIMES = false;
/**
 * Heading toward its line (m): inside a window a bus is marked only once it is this much nearer its route than at its
 * farthest point of the stretch off it (a bus coming back to serve; a bus driving away or parked off its line is not
 * on its way). 0 = any bus in a window.
 */
export const TOWARD_M = 100;

/**
 * The entry of a line for the service day of t, when it may be used (listed hours as learned, file not stale).
 * @param {object|null|undefined} seen store.serviceSeen (cleaned)
 * @param {object} service store.service
 * @param {string} rid
 * @param {number} t unix seconds
 * @returns {{entry:object, min:number, day:string}|null}
 */
export function seenEntry(seen, service, rid, t) {
  const days = seen && seen.lines ? seen.lines[String(rid)] : null;
  if (!Array.isArray(days) || !days.length || !Number.isFinite(Number(t))) return null;
  const c = serviceClock(Number(t));
  if (seen.valid_until && c.iso > String(seen.valid_until)) return null;      // learned too long ago: refresh the file
  const entry = days.find((d) => d && Array.isArray(d.dows) && d.dows.includes(c.day));
  if (!entry) return null;
  const key = hoursKey(service, String(rid), c.iso, c.day);
  if (key == null || key !== entry.spans) return null;                        // another timetable today: not learned
  return { entry, min: c.min, day: c.day };
}

/**
 * The transition window of line `rid` that t is in, or null.
 * @param {object|null|undefined} seen store.serviceSeen (cleaned)
 * @param {object} service store.service
 * @param {string} rid the line the bus is filed under
 * @param {number} t unix seconds (the bus's report time)
 * @param {number} [padS]
 * @returns {{kind:'transition'|'start', from?:string, to?:string, a:number, b:number}|null} a / b = the window in
 *   service-day minutes
 */
export function transitionAt(seen, service, rid, t, padS = TRANSITION_PAD_S) {
  const e = seenEntry(seen, service, rid, t);
  if (!e) return null;
  const pad = padS / 60, R = String(rid);
  for (const x of seen.transitions || []) {
    if (!x || (x.from !== R && x.to !== R) || !Array.isArray(x.dows) || !x.dows.includes(e.day)) continue;
    const a = (x.brk ? x.join : Math.min(x.leave, x.join)) - pad, b = (x.brk ? x.join : Math.max(x.leave, x.join)) + pad;
    if (e.min >= a && e.min <= b) return { kind: "transition", from: x.from, to: x.to, a, b };
  }
  for (const s of e.entry.starts || []) {
    if (e.min >= s - pad && e.min <= s + pad) return { kind: "start", a: s - pad, b: s + pad };
  }
  return null;
}

/** The words for a marked bus (owner 2026-11-11, exactly): map badge tap, route page; Kit Seen.transitionText. */
export const TRANSITION_TEXT = "Transitioning to new line";

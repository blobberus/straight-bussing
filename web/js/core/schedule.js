/**
 * @module core/schedule
 * Route hours and scheduled-service summaries from data/service.json (built by tools/build_gtfs.py
 * from the official GTFS: calendar, calendar_dates, trips, stop_times, frequencies). Pure, no DOM,
 * never throws. All dates/times are America/Chicago. This is SCHEDULE data: live service may differ.
 *
 * service.json day entry: {first:'HH:MM', last:'HH:MM' (may be >= 24:00, after midnight), trips,
 * buses:[24] scheduled vehicles per local hour, spans?:[['HH:MM','HH:MM']] service windows,
 * dep?:[first, gap, ...] departures at the route's reference stop (route entry "at"), delta-coded service-day minutes}.
 */

export const DAY_KEYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const DAY_SHORT = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* Ranges, no dash characters (docs/DESIGN.md "Copy"): clock times "7:00 AM to 11:30 PM", day spans "Mon-Fri". */
const TO = " to ";
const DAY_RANGE = "-";

let fmt = null;

/** US DST rule fallback (2nd Sun Mar 2:00 -> 1st Sun Nov 2:00): Chicago UTC offset in hours. */
function ruleOffset(unixS) {
  const y = new Date(unixS * 1000).getUTCFullYear();
  const sunday = (m, n) => { const d = new Date(Date.UTC(y, m, 1)); return 1 + ((7 - d.getUTCDay()) % 7) + 7 * (n - 1); };
  const start = Date.UTC(y, 2, sunday(2, 2), 8) / 1000, end = Date.UTC(y, 10, sunday(10, 1), 7) / 1000;
  return unixS >= start && unixS < end ? -5 : -6;
}

/**
 * Local (America/Chicago) calendar parts of a unix time.
 * @param {number} unixS
 * @returns {{y:number, m:number, d:number, dow:number, min:number}} m 1-12, dow 0 = Monday, min of day
 */
export function localParts(unixS) {
  try {
    if (!fmt) fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false });
    const p = {};
    for (const x of fmt.formatToParts(new Date(unixS * 1000))) p[x.type] = x.value;
    const y = +p.year, m = +p.month, d = +p.day;
    if (y && m && d) return { y, m, d, dow: (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7, min: (+p.hour % 24) * 60 + +p.minute };
  } catch (e) { /* fall through to the DST rule */ }
  const t = new Date((unixS + ruleOffset(unixS) * 3600) * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: (t.getUTCDay() + 6) % 7, min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

/** 'YYYY-MM-DD' for local parts shifted by `days`. */
function isoDate(p, days = 0) {
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return t.toISOString().slice(0, 10);
}

/** Day key for an ISO date. */
function keyOfIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return DAY_KEYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

/** 'HH:MM' (may be >= 24) -> minutes, or NaN. */
function mins(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  return m ? +m[1] * 60 + +m[2] : NaN;
}

/**
 * 'HH:MM' (24 h, may be >= 24:00) -> '4:29 AM'.
 * @param {string} hhmm
 * @returns {string}
 */
export function clock12(hhmm) {
  const t = mins(hhmm);
  if (!Number.isFinite(t)) return "";
  const h = Math.floor(t / 60) % 24, m = t % 60;
  return ((h + 11) % 12 + 1) + ":" + String(m).padStart(2, "0") + (h < 12 ? " AM" : " PM");
}

/** Service windows of a day entry: spans, else [first, last]. */
function spansOf(day) {
  if (!day) return [];
  const s = Array.isArray(day.spans) && day.spans.length ? day.spans : day.first && day.last ? [[day.first, day.last]] : [];
  return s.filter((x) => Array.isArray(x) && Number.isFinite(mins(x[0])) && Number.isFinite(mins(x[1])));
}

/** '7:00 AM to 11:30 PM' (windows joined with ', '), or 'No service'. */
function spanLabel(day) {
  const s = spansOf(day);
  return s.length ? s.map(([a, b]) => clock12(a) + TO + clock12(b)).join(", ") : "No service";
}

/**
 * The service entry for a route.
 * @param {object} service store.service
 * @param {string} rid
 * @returns {{days:object, exceptions:Array}|null}
 */
export function routeService(service, rid) {
  const r = service && service.routes && service.routes[rid];
  return r && typeof r === "object" && r.days ? r : null;
}

/**
 * Local weekday key.
 * @param {number} unixS
 * @returns {'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun'}
 */
export function dayKey(unixS) {
  return DAY_KEYS[localParts(unixS).dow];
}

/** Day entry for an ISO date with calendar_dates applied -> {day, exception}. */
function dayFor(r, iso) {
  const e = (r.exceptions || []).find((x) => x && x.date === iso);
  if (e) return { day: e.hours || null, exception: e.type === "added" ? "added" : "removed" };
  return { day: r.days[keyOfIso(iso)] || null, exception: undefined };
}

/**
 * Scheduled hours on the local date of unixS (calendar exceptions applied).
 * @param {object} service
 * @param {string} rid
 * @param {number} unixS
 * @returns {{first:string|null, last:string|null, label:string, exception?:'removed'|'added'}|null}
 *   null only when there is no schedule data for the route; a no-service day has label 'No service'.
 */
export function hoursOn(service, rid, unixS) {
  const r = routeService(service, rid);
  if (!r) return null;
  const { day, exception } = dayFor(r, isoDate(localParts(unixS)));
  const out = { first: day ? day.first || null : null, last: day ? day.last || null : null, label: spanLabel(day) };
  if (exception) out.exception = exception;
  return out;
}

/**
 * Hours of the service day unixS belongs to: the calendar date, unless unixS is in the after-midnight tail of
 * yesterday's service and today has no window at this minute (12:10 AM Saturday on a route running Friday 6:30 AM
 * to 12:25 AM is Friday's service). hoursOn alone says "No service" while the route is scheduled now.
 * Same rule as the iOS Kit Schedule.serviceHoursAt.
 * @param {object} service
 * @param {string} rid
 * @param {number} unixS
 * @returns {{hours:{first:string|null, last:string|null, label:string, exception?:'removed'|'added'}, dayKey:string, yesterday:boolean}|null}
 *   yesterday: the hours are the previous day's; null only when there is no schedule data for the route
 */
export function serviceHoursAt(service, rid, unixS) {
  const r = routeService(service, rid);
  if (!r) return null;
  const p = localParts(unixS), today = isoDate(p), prev = isoDate(p, -1);
  const has = (day, m) => spansOf(day).some(([a, b]) => m >= mins(a) && m < mins(b));
  const tail = !has(dayFor(r, today).day, p.min) && has(dayFor(r, prev).day, p.min + 1440);
  const iso = tail ? prev : today, { day, exception } = dayFor(r, iso);
  const hours = { first: day ? day.first || null : null, last: day ? day.last || null : null, label: spanLabel(day) };
  if (exception) hours.exception = exception;
  return { hours, dayKey: keyOfIso(iso), yesterday: tail };
}

/**
 * Regular week, consecutive days with the same hours grouped ('Mon-Fri', 'Every day').
 * @param {object} service
 * @param {string} rid
 * @returns {{days:string, label:string}[]}
 */
export function weekSummary(service, rid) {
  const r = routeService(service, rid);
  if (!r) return [];
  const labels = DAY_KEYS.map((k) => spanLabel(r.days[k]));
  if (labels.every((l) => l === labels[0])) return [{ days: "Every day", label: labels[0] }];
  const out = [];
  for (let i = 0; i < 7;) {
    let j = i;
    while (j + 1 < 7 && labels[j + 1] === labels[i]) j++;
    out.push({ days: DAY_SHORT[DAY_KEYS[i]] + (j > i ? DAY_RANGE + DAY_SHORT[DAY_KEYS[j]] : ""), label: labels[i] });
    i = j + 1;
  }
  return out;
}

/**
 * Scheduled buses per local hour on a weekday, in service-day order (a night route lists 16..23 then 0..4).
 * @param {object} service
 * @param {string} rid
 * @param {string} key day key
 * @returns {{hour:number, buses:number}[]} hours with service only
 */
export function busesByHour(service, rid, key) {
  const r = routeService(service, rid);
  return hourBuses(r && r.days[key]);
}

/**
 * Scheduled buses per local hour of one day entry (a weekday's or a calendar change's), in service-day order.
 * @param {object|null} day service.json day entry
 * @returns {{hour:number, buses:number}[]} hours with service only
 */
export function hourBuses(day) {
  if (!day || !Array.isArray(day.buses)) return [];
  const start = Math.floor((mins(spansOf(day)[0]?.[0]) || 0) / 60) % 24;
  const out = [];
  for (let i = 0; i < 24; i++) {
    const h = (start + i) % 24, n = Number(day.buses[h]) || 0;
    if (n > 0) out.push({ hour: h, buses: n });
  }
  return out;
}

/**
 * Calendar changes (holidays, extra service) from today through horizonDays.
 * @param {object} service
 * @param {string} rid
 * @param {number} unixS
 * @param {number} [horizonDays]
 * @returns {{date:string, label:string, text:string}[]} text 'No service' | 'Reduced service: …' | 'Extra service: …'
 */
export function upcomingChanges(service, rid, unixS, horizonDays = 30) {
  const r = routeService(service, rid);
  if (!r) return [];
  const p = localParts(unixS), from = isoDate(p), to = isoDate(p, horizonDays);
  return (r.exceptions || []).filter((e) => e && e.date >= from && e.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => {
    const [, m, d] = e.date.split("-").map(Number);
    const label = DAY_SHORT[keyOfIso(e.date)] + ", " + MONTHS[m - 1] + " " + d;
    const text = !e.hours ? "No service" : (e.type === "added" ? "Extra service: " : "Reduced service: ") + spanLabel(e.hours);
    return { date: e.date, label, text };
  });
}

/** The service window [from, to] containing unixS: today's, else yesterday's after-midnight tail; or null. */
function windowAt(r, unixS) {
  const p = localParts(unixS);
  const find = (day, t) => spansOf(day).find(([a, b]) => t >= mins(a) && t < mins(b)) || null;
  return find(dayFor(r, isoDate(p)).day, p.min) || find(dayFor(r, isoDate(p, -1)).day, p.min + 1440);
}

/**
 * Is the route scheduled to run at unixS? Checks today's windows and yesterday's after-midnight tail.
 * @param {object} service
 * @param {string} rid
 * @param {number} unixS
 * @returns {boolean|null} null when there is no schedule data
 */
export function isScheduledNow(service, rid, unixS) {
  const r = routeService(service, rid);
  return r ? !!windowAt(r, unixS) : null;
}

/**
 * End of the scheduled service window the route is in at unixS (format it with clock12).
 * @param {object} service
 * @param {string} rid
 * @param {number} unixS
 * @returns {string|null} 'HH:MM' (may be >= 24:00, after midnight); null when not scheduled now or no data
 */
export function scheduledUntil(service, rid, unixS) {
  const r = routeService(service, rid), w = r && windowAt(r, unixS);
  return w ? w[1] : null;
}

/**
 * Start of the next scheduled service window later today (the local date of unixS, calendar exceptions applied), for
 * a route that is not running now (My Routes: "Scheduled from 4:00 PM today"). Same as the iOS Kit
 * Schedule.nextStartToday.
 * @param {object} service
 * @param {string} rid
 * @param {number} unixS
 * @returns {string|null} 'HH:MM'; null when no window starts later today, or no schedule data
 */
export function nextStartToday(service, rid, unixS) {
  const r = routeService(service, rid);
  if (!r) return null;
  const p = localParts(unixS);
  const s = spansOf(dayFor(r, isoDate(p)).day).find(([a]) => mins(a) > p.min);
  return s ? s[0] : null;
}

/**
 * Hours grouped by equal scheduled bus counts, for an accessible text summary.
 * @param {{hour:number, buses:number}[]} list busesByHour output
 * @returns {{from:number, to:number, buses:number}[]} to = exclusive end hour (may wrap)
 */
export function groupHours(list) {
  const out = [];
  for (const x of list || []) {
    const last = out[out.length - 1];
    if (last && last.buses === x.buses && last.to % 24 === x.hour) last.to = last.to + 1;
    else out.push({ from: x.hour, to: x.hour + 1, buses: x.buses });
  }
  return out;
}

/**
 * '7 AM' style hour label (0-23, wraps).
 * @param {number} h
 * @returns {string}
 */
export function hourLabel(h) {
  h = ((h % 24) + 24) % 24;
  return h === 0 ? "12 AM" : h === 12 ? "12 PM" : (h % 12) + (h < 12 ? " AM" : " PM");
}

/**
 * The day the route page's "Scheduled buses by hour" and "Schedule by hour" show: the current service day (after
 * midnight a night route is still on yesterday's; calendar changes applied, so a holiday or extra service shows its own
 * timetable), else that weekday's regular timetable (a calendar change with no service), else the first weekday with
 * service. Same rule as the iOS Kit Schedule.scheduleDay.
 * @param {object} service
 * @param {string} rid
 * @param {number} unixS
 * @returns {{day:object, key:string, today:boolean, yesterday:boolean, exception?:'removed'|'added'}|null}
 *   today: the service day of unixS (else a weekday's regular timetable); null = no service on any day or no data
 */
export function scheduleDay(service, rid, unixS) {
  const r = routeService(service, rid);
  if (!r) return null;
  const p = localParts(unixS), today = isoDate(p), prev = isoDate(p, -1);
  const has = (day, m) => spansOf(day).some(([a, b]) => m >= mins(a) && m < mins(b));
  const tail = !has(dayFor(r, today).day, p.min) && has(dayFor(r, prev).day, p.min + 1440);
  const iso = tail ? prev : today, key = keyOfIso(iso), { day, exception } = dayFor(r, iso);
  if (spansOf(day).length) return { day, key, today: true, yesterday: tail, ...(exception ? { exception } : {}) };
  for (const k of [key, ...DAY_KEYS]) if (spansOf(r.days[k]).length) return { day: r.days[k], key: k, today: false, yesterday: false };
  return null;
}

/* Schedule by hour (owner 2026-11-09: "Every 30 minutes between x times"): how often the timetable sends a bus, from a
   day's departures at the route's reference stop. Timetable only: buses often don't keep to it (the route page says so). */

/** A gap this long (minutes) or longer between two departures is a break in service ("No service" between). */
export const HEADWAY_BREAK_MIN = 90;
/** Gaps (all within a minute of each other) that make a steady run: "Every N min". */
const STEADY_GAPS = 3;

/**
 * Departures of a day entry: service.json "dep" (delta coded) -> sorted service-day minutes (>= 1440 after midnight).
 * @param {object|null} day
 * @returns {number[]} [] when missing or malformed
 */
export function departures(day) {
  const d = day && Array.isArray(day.dep) ? day.dep : [], out = [];
  let t = 0;
  for (const x of d) {
    if (!Number.isInteger(x) || x < 0 || x > 2880) return [];
    out.push((t += x));
  }
  return out;
}

const spread = (g, a, b) => { let lo = Infinity, hi = -Infinity; for (let i = a; i < b; i++) { lo = Math.min(lo, g[i]); hi = Math.max(hi, g[i]); } return hi - lo; };
const total = (g, a, b) => { let s = 0; for (let i = a; i < b; i++) s += g[i]; return s; };
/** t / c in whole minutes, half up (integers only, so every platform agrees). */
const roundDiv = (t, c) => Math.floor((2 * t + c) / (2 * c));
/** An uneven stretch's average gap: to the minute (at least 1), to 5 minutes from 17.5 up ("About every 25 min"). */
const aboutMin = (t, c) => (2 * t >= 35 * c ? 5 * Math.floor((2 * t + 5 * c) / (10 * c)) : Math.max(1, roundDiv(t, c)));

/** One stretch of service (no gap of HEADWAY_BREAK_MIN or more) -> segments. */
function stretchHeadways(d) {
  const n = d.length;
  if (n === 1) return [{ kind: "trips", n: 1, from: d[0], to: d[0] }];
  if (n === 2) return [{ kind: "trips", n: 2, from: d[0], to: d[1] }];
  const g = [];
  for (let i = 1; i < n; i++) g.push(d[i] - d[i - 1]);
  // runs of gaps within a minute of each other (greedy): 3 or more = steady, shorter = loose; loose neighbours join,
  // and so do steady neighbours one minute apart (9 to 10 then 10 to 11: timetable rounding)
  const runs = [];
  for (let i = 0; i < g.length;) {
    let j = i + 1;
    while (j < g.length && spread(g, i, j + 1) <= 1) j++;
    const steady = j - i >= STEADY_GAPS, last = runs[runs.length - 1];
    if (last && last.steady === steady && (!steady || spread(g, last.a, j) <= 2)) last.b = j;
    else runs.push({ a: i, b: j, steady });
    i = j;
  }
  // a lone loose gap: part of a steady neighbour within a minute of its headway (the one before first), else a transition
  const head = (q) => roundDiv(total(g, q.a, q.b), q.b - q.a);
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    if (r.steady || r.b - r.a !== 1) continue;
    const prev = runs[k - 1], next = runs[k + 1];
    if (prev && prev.steady && Math.abs(g[r.a] - head(prev)) <= 1) { prev.b = r.b; runs.splice(k--, 1); }
    else if (next && next.steady && Math.abs(g[r.a] - head(next)) <= 1) { next.a = r.a; runs.splice(k--, 1); }
    else r.drop = true;
  }
  const out = [];
  if (runs[0].drop) out.push({ kind: "trips", n: 1, from: d[0], to: d[0] });   // a lone first bus before a steady run
  for (const r of runs) {
    if (r.drop) continue;
    if (r.steady || spread(g, r.a, r.b) <= 1) { out.push({ kind: "every", min: head(r), from: d[r.a], to: d[r.b], g: r.b - r.a }); continue; }
    // uneven: "About every N min" hour by hour (a one-gap hour joins the hour before, else after), equal neighbours merged
    const hrs = [];
    for (let i = r.a; i < r.b; i++) {
      const h = Math.floor(d[i] / 60), last = hrs[hrs.length - 1];
      if (last && last.h === h) last.b = i + 1;
      else hrs.push({ h, a: i, b: i + 1 });
    }
    for (let k = 0; k < hrs.length && hrs.length > 1; k++) {
      if (hrs[k].b - hrs[k].a > 1) continue;
      if (k > 0) hrs[k - 1].b = hrs[k].b; else hrs[k + 1].a = hrs[k].a;
      hrs.splice(k--, 1);
    }
    for (const x of hrs) out.push({ kind: "about", min: aboutMin(total(g, x.a, x.b), x.b - x.a), from: d[x.a], to: d[x.b], g: x.b - x.a });
  }
  if (runs.length > 1 && runs[runs.length - 1].drop) out.push({ kind: "trips", n: 1, from: d[n - 1], to: d[n - 1] });   // a lone last bus
  tidy(out);
  for (const s of out) delete s.g;
  return out;
}

/** A range shorter than this (minutes) joins a neighbour (a short burst of extra buses is not a schedule of its own). */
const FRAGMENT_MIN = 30;
/** At most this many "Every" / "About every" lines per stretch of service; closest paces merge first. */
const MAX_RANGES = 6;
const paced = (s) => !!s && (s.kind === "every" || s.kind === "about");
/** How different two ranges' paces are, as a fraction >= 1 [num, den] (integers, so every platform agrees). */
const paceRatio = (a, b) => { const x = (a.to - a.from) * b.g, y = (b.to - b.from) * a.g; return x >= y ? [x, y] : [y, x]; };
const below = (p, q) => p[0] * q[1] < q[0] * p[1];
/** Neighbours that read as one pace: a minute apart, two when either is an average ("About"). */
const samePace = (a, b) => Math.abs(a.min - b.min) <= (a.kind === "about" || b.kind === "about" ? 2 : 1);
/** Two neighbouring ranges as one: "Every N" when both are and only an odd gap under 2 N sits between, else "About every". */
function joinRanges(a, b) {
  const hole = a.to < b.from ? b.from - a.to : 0, g = a.g + b.g + (hole ? 1 : 0);
  if (a.kind === "every" && b.kind === "every" && a.min === b.min && hole < 2 * a.min) return { kind: "every", min: a.min, from: a.from, to: b.to, g };
  return { kind: "about", min: aboutMin(b.to - a.from, g), from: a.from, to: b.to, g };
}

/**
 * Keep a stretch's list short and readable (in place), merging neighbours: first ones of the same pace (samePace: "About
 * every 10" next to "Every 10", "Every 15" next to "Every 16", "About every 11" next to "About every 9"), then the
 * shortest range under FRAGMENT_MIN
 * into its neighbour of closer pace, then, while more than MAX_RANGES remain, the two neighbours of closest pace. Lone
 * "1 trip" lines stay. A merged range's number is its own average, so it never claims more precision than the timetable.
 */
function tidy(out) {
  for (;;) {
    let at = -1;   // merge out[at] and out[at + 1]
    for (let i = 0; i + 1 < out.length && at < 0; i++) if (paced(out[i]) && paced(out[i + 1]) && samePace(out[i], out[i + 1])) at = i;
    if (at < 0) {
      let f = -1;
      for (let i = 0; i < out.length; i++) {
        const s = out[i], len = s.to - s.from;
        if (paced(s) && len < FRAGMENT_MIN && (paced(out[i - 1]) || paced(out[i + 1])) && (f < 0 || len < out[f].to - out[f].from)) f = i;
      }
      if (f >= 0) at = !paced(out[f - 1]) ? f : !paced(out[f + 1]) ? f - 1 : below(paceRatio(out[f], out[f + 1]), paceRatio(out[f - 1], out[f])) ? f : f - 1;
    }
    if (at < 0 && out.filter(paced).length > MAX_RANGES) {
      let best = null;
      for (let i = 0; i + 1 < out.length; i++) {
        if (!paced(out[i]) || !paced(out[i + 1])) continue;
        const q = paceRatio(out[i], out[i + 1]);
        if (!best || below(q, best)) { best = q; at = i; }
      }
    }
    if (at < 0) return;
    out.splice(at, 2, joinRanges(out[at], out[at + 1]));
  }
}

/**
 * How often the timetable sends a bus over one service day, as ranges (owner 2026-11-09). Steady stretches (4 or more
 * buses, gaps within a minute) read "Every N min" from the first to the last of those buses; uneven ones "About every
 * N min" (the average gap, to the minute, to 5 minutes from 17.5 up), hour by hour; a lone bus "1 trip" (two alone: "2 trips"); a gap
 * of HEADWAY_BREAK_MIN or more is "No service" between two stretches. Then each stretch is tidied (tidy: neighbours of
 * the same pace, bursts under 30 min and lists over 6 lines merge, CTA timetables need it). Same as the iOS Kit
 * Schedule.hourlyHeadways (both test the shared golden file web/tests/fixtures/headways_golden.json).
 * @param {number[]} deps departures, service-day minutes (departures(day)); duplicates and junk ignored
 * @returns {{kind:'every'|'about'|'trips'|'none', from:number, to:number, min?:number, n?:number}[]}
 *   from / to service-day minutes (headwayLine words them); min = minutes between buses; n = trips
 */
export function hourlyHeadways(deps) {
  const d = [...new Set((Array.isArray(deps) ? deps : []).filter((x) => Number.isInteger(x) && x >= 0))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < d.length;) {
    let j = i + 1;
    while (j < d.length && d[j] - d[j - 1] < HEADWAY_BREAK_MIN) j++;
    if (i > 0) out.push({ kind: "none", from: d[i - 1], to: d[i] });
    out.push(...stretchHeadways(d.slice(i, j)));
    i = j;
  }
  return out;
}

/**
 * Minute of a day as a 12-hour clock: 1470 -> '12:30 AM' (headwayLine's default; the app passes core/time.js clockOfDay).
 * @param {number} min service-day minutes, may be >= 1440 (after midnight)
 * @returns {string}
 */
export function clockMin(min) {
  const t = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(t / 60);
  return ((h + 11) % 12 + 1) + ":" + String(t % 60).padStart(2, "0") + (h < 12 ? " AM" : " PM");
}

const PERIOD = /[   ](AM|PM)$/;
/** '7:00 to 10:00 AM' / '10:00 AM to 3:00 PM': the first AM / PM is dropped when both are the same. */
function clockPair(a, b, fmt, join) {
  const x = fmt(a), y = fmt(b), px = PERIOD.exec(x), py = PERIOD.exec(y);
  return (px && py && px[1] === py[1] ? x.slice(0, px.index) : x) + join + y;
}

/**
 * Words for one hourlyHeadways segment: text "Every 30 min" | "About every 20 min" | "1 trip" | "2 trips" | "No service";
 * when "7:00 to 10:00 AM" | "11:00 PM" | "6:00 and 7:00 PM"; say = what a screen reader hears ("Every 30 minutes, 7:00
 * to 10:00 AM"). Same words as the iOS Kit Schedule.headwayLine.
 * @param {{kind:string, from:number, to:number, min?:number, n?:number}} seg
 * @param {(min:number) => string} [fmt] service-day minutes -> clock text (default clockMin, 12-hour)
 * @returns {{text:string, when:string, say:string}}
 */
export function headwayLine(seg, fmt = clockMin) {
  const minutes = (m) => `${m} minute${m === 1 ? "" : "s"}`;
  let text, say, when;
  if (seg.kind === "every" || seg.kind === "about") {
    const lead = seg.kind === "about" ? "About every" : "Every";
    text = `${lead} ${seg.min} min`;
    say = `${lead} ${minutes(seg.min)}`;
    when = clockPair(seg.from, seg.to, fmt, " to ");
  } else if (seg.kind === "trips") {
    text = say = seg.n === 1 ? "1 trip" : `${seg.n} trips`;
    when = seg.n === 1 ? fmt(seg.from) : clockPair(seg.from, seg.to, fmt, " and ");
  } else {
    text = say = "No service";
    when = clockPair(seg.from, seg.to, fmt, " to ");
  }
  return { text, when, say: `${say}, ${when}` };
}

/* All times by hour (owner 2026-11-09: "expandable to show exactly what time of day the bus can be expected. The table
   should highlight the current time. It can break it down between the weekday and weekend."). */

const DAY_LONG = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

/** Two day entries with the same timetable: the same departures, else (no departures listed) the same hours. */
function sameTimetable(a, b) {
  const da = departures(a), db = departures(b);
  if (da.length || db.length) return da.length === db.length && da.every((x, i) => x === db[i]);
  return spanLabel(a) === spanLabel(b);
}

/** A day with any service (hours or departures). */
const hasService = (day) => spansOf(day).length > 0 || departures(day).length > 0;

/**
 * The next date with service after `iso` (calendar changes applied), within a week, as a day key; null if none.
 * @param {object} r route entry
 * @param {string} iso 'YYYY-MM-DD'
 */
function nextServiceKey(r, iso) {
  const [y, m, d] = iso.split("-").map(Number);
  for (let i = 1; i <= 7; i++) {
    const next = isoDate({ y, m, d }, i);
    if (hasService(dayFor(r, next).day)) return keyOfIso(next);
  }
  return null;
}

/**
 * Day tabs for the route page's "Schedule by hour" table: consecutive days with the same timetable grouped in week order
 * and named by the data: "Every day", "Weekday" (Monday to Friday), "Weekend" (Saturday and Sunday), "Saturday",
 * "Sunday", else short ranges ("Mon-Thu", "Fri"). The tab holding today's service day (after midnight a night route is
 * still on yesterday's) is today's: it carries today's real timetable (calendar changes applied, like the bars) and a
 * note when that differs from the regular one ("Holiday schedule today", "Extra service today"). A tab with no service
 * says which day has service next (`next`, a day key). Same as the iOS Kit Schedule.scheduleTabs.
 * @param {object} service
 * @param {string} rid
 * @param {number} unixS
 * @returns {{tabs:{id:string, label:string, keys:string[], day:object|null, today:boolean, yesterday:boolean,
 *   note:string, next:string|null}[], selected:string}|null} null = no schedule data for the route
 */
export function scheduleTabs(service, rid, unixS) {
  const r = routeService(service, rid);
  if (!r) return null;
  const p = localParts(unixS), todayIso = isoDate(p), prev = isoDate(p, -1);
  const has = (day, m) => spansOf(day).some(([a, b]) => m >= mins(a) && m < mins(b));
  const tail = !has(dayFor(r, todayIso).day, p.min) && has(dayFor(r, prev).day, p.min + 1440);
  const iso = tail ? prev : todayIso, key = keyOfIso(iso), real = dayFor(r, iso);
  const groups = [];
  for (const k of DAY_KEYS) {
    const last = groups[groups.length - 1];
    if (last && sameTimetable(r.days[last[last.length - 1]], r.days[k])) last.push(k);
    else groups.push([k]);
  }
  const many = groups.length > 3, keysOf = (g) => g.join(",");
  const tabs = groups.map((g) => {
    const s = keysOf(g);
    const label = g.length === 7 ? "Every day" : s === "mon,tue,wed,thu,fri" ? "Weekday" : s === "sat,sun" ? "Weekend"
      : g.length === 1 ? (many ? DAY_SHORT[g[0]] : DAY_LONG[g[0]]) : DAY_SHORT[g[0]] + DAY_RANGE + DAY_SHORT[g[g.length - 1]];
    const today = g.includes(key), day = today ? real.day : r.days[g[0]] || null;
    let note = "", next = null;
    if (today && real.exception) note = real.exception === "added" ? "Extra service today" : hasService(real.day) ? "Holiday schedule today" : "Holiday schedule today: no service";
    if (!hasService(day)) {
      if (today) next = nextServiceKey(r, iso);
      else for (let i = 1; i <= 7 && !next; i++) { const k = DAY_KEYS[(DAY_KEYS.indexOf(g[g.length - 1]) + i) % 7]; if (hasService(r.days[k])) next = k; }
    }
    return { id: g[0] + (g.length > 1 ? "-" + g[g.length - 1] : ""), label, keys: g, day, today, yesterday: today && tail, note, next };
  });
  return { tabs, selected: tabs.find((t) => t.today).id };
}

/**
 * Departures grouped by hour of the service day, in order (a night route's after-midnight hours come after its evening
 * ones: 24 = 12 AM). Hours without a departure are left out.
 * @param {number[]} deps service-day minutes (departures(day))
 * @returns {{h:number, times:number[]}[]}
 */
export function hourRows(deps) {
  const d = [...new Set((Array.isArray(deps) ? deps : []).filter((x) => Number.isInteger(x) && x >= 0))].sort((a, b) => a - b);
  const out = [];
  for (const m of d) {
    const h = Math.floor(m / 60), last = out[out.length - 1];
    if (last && last.h === h) last.times.push(m);
    else out.push({ h, times: [m] });
  }
  return out;
}

/**
 * "Now" on a service day's clock: minutes since its midnight, + 24 h in yesterday's after-midnight tail. A 24 hour
 * route's list is one daily cycle that starts at its quietest minute (build_gtfs service_spans, e.g. 11:51 PM), so a
 * minute before its first departure is read on the late side of that cycle.
 * @param {number[]} deps the day's departures (service-day minutes)
 * @param {number} localMin minute of the Chicago clock day (localParts(unixS).min)
 * @param {boolean} yesterday unixS is in yesterday's after-midnight tail (scheduleTabs tab.yesterday)
 * @param {boolean} [allDay] the day runs all day (allDay(day): hours "00:00" to "24:00")
 * @returns {number}
 */
export function nowMinute(deps, localMin, yesterday, allDay = false) {
  const base = localMin + (yesterday ? 1440 : 0), d = Array.isArray(deps) ? deps : [];
  return allDay && !yesterday && d.length && base < d[0] ? base + 1440 : base;
}

/**
 * Does the day run all day (one service window "00:00" to "24:00", CTA's 24 hour routes)?
 * @param {object|null} day
 * @returns {boolean}
 */
export function allDay(day) {
  const s = spansOf(day);
  return s.length === 1 && mins(s[0][0]) === 0 && mins(s[0][1]) === 1440;
}

/**
 * The next scheduled departure at or after `now` (service-day minutes), or null when none is left that day.
 * @param {number[]} deps
 * @param {number} now nowMinute(...)
 * @returns {number|null}
 */
export function nextDeparture(deps, now) {
  for (const m of hourRows(deps).flatMap((r) => r.times)) if (m >= now) return m;
  return null;
}

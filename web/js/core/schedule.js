/**
 * @module core/schedule
 * Route hours and scheduled-service summaries from data/service.json (built by tools/build_gtfs.py
 * from the official GTFS: calendar, calendar_dates, trips, stop_times, frequencies). Pure, no DOM,
 * never throws. All dates/times are America/Chicago. This is SCHEDULE data: live service may differ.
 *
 * service.json day entry: {first:'HH:MM', last:'HH:MM' (may be >= 24:00, after midnight), trips,
 * buses:[24] scheduled vehicles per local hour, spans?:[['HH:MM','HH:MM']] service windows}.
 */

export const DAY_KEYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const DAY_SHORT = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DASH = "–";

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

/** '7:00 AM – 11:30 PM' (windows joined with ', '), or 'No service'. */
function spanLabel(day) {
  const s = spansOf(day);
  return s.length ? s.map(([a, b]) => clock12(a) + " " + DASH + " " + clock12(b)).join(", ") : "No service";
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
 * Regular week, consecutive days with the same hours grouped ('Mon–Fri', 'Every day').
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
    out.push({ days: DAY_SHORT[DAY_KEYS[i]] + (j > i ? DASH + DAY_SHORT[DAY_KEYS[j]] : ""), label: labels[i] });
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
  const r = routeService(service, rid), day = r && r.days[key];
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

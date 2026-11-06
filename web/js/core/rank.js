/**
 * @module core/rank
 * Which trip options to show and in what order (owner rule, 2026-10-08). Pure logic, no DOM.
 *
 * Three criteria, in priority order:
 *   1. walk    least total walking (minutes over every walk leg: to the stop, transfers, to the destination)
 *   2. arrive  earliest arrival at the destination
 *   3. wait    shortest total wait at stops (all bus legs)
 * An option "meets" a criterion when it is within a small tolerance of the best option on it (every
 * number is an estimate, so near-ties count as ties). Order:
 *   a. by the highest-priority criterion the option meets (walking, then arrival, then wait;
 *      options meeting none come last),
 *   b. then options meeting more criteria first,
 *   c. then fewer walking minutes, earlier arrival, shorter wait.
 * Every ranked option carries `meets` (criterion ids, priority order) so the UI can say what it minimizes.
 * The long way around (owner 2026-11-06, LONG_WAY): the least-walking option may be slower than walking; pickOptions
 * keeps it, walkPlace puts walking the whole way under it ("Faster to walk") and criteriaLine states the trade-off.
 */

/** The ranking criteria in priority order. tol = minutes within the best that still count as best. */
export const CRITERIA = Object.freeze([
  Object.freeze({ id: "walk", label: "Least walking", tol: 0.5 }),
  Object.freeze({ id: "arrive", label: "Earliest arrival", tol: 1 }),
  Object.freeze({ id: "wait", label: "Shortest wait", tol: 1 }),
]);

const EPS = 1e-9;

/**
 * Total walking over an option's legs.
 * @param {Array<{type:string, min?:number, m?:number}>} legs
 * @returns {{walkMin:number, walkM:number}} float minutes, whole meters
 */
export function walkTotals(legs) {
  let min = 0, m = 0;
  for (const l of legs || []) if (l.type === "walk") { min += Number(l.min) || 0; m += Number(l.m) || 0; }
  return { walkMin: min, walkM: Math.round(m) };
}

/**
 * The three numbers an option is ranked on, computed from its legs (so they stay right after
 * refineWalking re-times walks).
 * @param {{arrive?:number, legs?:Array<Object>}} o planner Option
 * @returns {{walk:number, arrive:number, wait:number}} walk/wait in minutes, arrive in unix s
 */
export function optionStats(o) {
  let walk = 0, wait = 0;
  for (const l of (o && o.legs) || []) {
    if (l.type === "walk") walk += Number(l.min) || 0;
    else if (l.type === "bus") wait += Number(l.wait) || 0;
  }
  return { walk, arrive: Number(o && o.arrive) || 0, wait };
}

/**
 * Criterion ids an option meets, given the best value of each criterion.
 * @param {{walk:number, arrive:number, wait:number}} s optionStats of the option
 * @param {{walk:number, arrive:number, wait:number}} best
 * @returns {string[]}
 */
function meetsOf(s, best) {
  return CRITERIA.filter((c) => (c.id === "arrive"
    ? s.arrive <= best.arrive + c.tol * 60 + EPS
    : s[c.id] <= best[c.id] + c.tol + EPS)).map((c) => c.id);
}

/**
 * Rank options by the owner's rule (see the module header). Does not mutate its input.
 * @param {Array<Object>} options planner Options
 * @returns {Array<Object>} new array of {...option, meets:string[]}, best first
 */
export function rankOptions(options) {
  const list = (options || []).filter((o) => o && Array.isArray(o.legs));
  if (!list.length) return [];
  const st = list.map(optionStats);
  const best = {
    walk: Math.min(...st.map((s) => s.walk)),
    arrive: Math.min(...st.map((s) => s.arrive)),
    wait: Math.min(...st.map((s) => s.wait)),
  };
  const rows = list.map((o, i) => ({ o, s: st[i], meets: meetsOf(st[i], best) }));
  const prio = (r) => {
    const k = CRITERIA.findIndex((c) => r.meets.includes(c.id));
    return k < 0 ? CRITERIA.length : k;
  };
  rows.sort((a, b) => prio(a) - prio(b) || b.meets.length - a.meets.length
    || a.s.walk - b.s.walk || a.s.arrive - b.s.arrive || a.s.wait - b.s.wait);
  return rows.map((r) => ({ ...r.o, meets: r.meets }));
}

/**
 * Short label of what an option minimizes, e.g. "Least walking, earliest arrival" ('' for none).
 * @param {string[]} meets criterion ids
 * @returns {string}
 */
export function criteriaText(meets) {
  return CRITERIA.filter((c) => (meets || []).includes(c.id)).map((c, i) => (i ? c.label.charAt(0).toLowerCase() + c.label.slice(1) : c.label)).join(", ");
}

/** Identity of an option's bus legs (route, stops, boarding time): the same trip found twice. */
function legSig(legs) {
  return (legs || []).filter((l) => l.type === "bus")
    .map((l) => `${l.rid}:${l.board && l.board.id}>${l.alight && l.alight.id}@${Math.round(l.boardT || 0)}`).join("|");
}

/**
 * Options that became the same trip (route, stops and boarding time of every bus leg) listed once, the first kept: the
 * sidewalk refinement re-times walks and re-plans a missed bus, so two options can end up on the same bus (QA
 * 2026-11-05: two identical "AP, 8 min, bus 7:16 at 57th Street & Drexel (NB)" cards). Options with no bus leg are
 * kept as they are. Pure; Kit Rank.uniqueOptions.
 * @param {Array<Object>} options
 * @returns {Array<Object>}
 */
export function uniqueOptions(options) {
  const seen = new Set();
  return (options || []).filter((o) => {
    if (!o || !Array.isArray(o.legs)) return false;
    const sig = legSig(o.legs);
    if (!sig) return true;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

/**
 * The long way around (owner 2026-11-06: "approve of taking the long way around routes to reach a location given that it
 * is the least amount of walking and long wait is ok"; Regenstein to Vue53 on the 53rd Street Express rides 12 stops
 * around the loop). SAVE_MIN / SAVE_FRAC: an option "saves walking" when it walks at least 5 min less than walking the
 * whole way AND at most half of it. pickOptions keeps an option slower than the usual limit (max(2 x walking, walking +
 * 15 min)) when it walks least of all candidates (0.5 min tolerance), saves walking compared with the least walking
 * within the usual limit (or walking the whole way, if less), and takes at most MAX_MIN (60 min) door to door, a long
 * wait included. A ride never goes a full loop (core/planner.js pathIdx stops before the boarding stop comes round).
 */
export const LONG_WAY = Object.freeze({ SAVE_MIN: 5, SAVE_FRAC: 0.5, MAX_MIN: 60 });

/**
 * Whether walking walkMin minutes (a bus option's walk legs) saves enough over walking walkOnlyMin (LONG_WAY): at least
 * 5 min less and at most half. Pure; Kit Rank.savesWalking.
 * @param {number} walkMin the option's walking, minutes
 * @param {number} walkOnlyMin the walking to beat (walking the whole way, or the least walking of the usual options)
 * @returns {boolean}
 */
export function savesWalking(walkMin, walkOnlyMin) {
  const w = Number(walkMin), all = Number(walkOnlyMin);
  if (!Number.isFinite(w) || !Number.isFinite(all) || all <= 0) return false;
  return all - w >= LONG_WAY.SAVE_MIN - EPS && w <= all * (1 - LONG_WAY.SAVE_FRAC) + EPS;
}

/**
 * Turn planner candidates into ranked options: drop ones absurdly slower than walking (unless they save walking:
 * LONG_WAY) and transfers that do not beat the best direct trip, merge duplicates, rank, cap.
 * @param {Array<{key:string, legs:Array<Object>, arr:number, xfer:boolean}>} cands
 * @param {{t0:number, walkOnlyMin:number, max?:number, xferGainMin?:number}} opts
 * @returns {Array<Object>} Options {key, total, totalMin, arrive, t0, walkMin, walkM, legs, meets}
 */
export function pickOptions(cands, { t0, walkOnlyMin, max = 4, xferGainMin = 2 }) {
  const limit = Math.max(2 * walkOnlyMin, walkOnlyMin + 15);
  const longLimit = Math.max(limit, LONG_WAY.MAX_MIN);   // the long way around: slower is fine when it walks least
  const bestDirect = Math.min(Infinity, ...cands.filter((c) => !c.xfer).map((c) => c.arr));
  const viable = cands.filter((c) => !(c.xfer && c.arr > bestDirect - xferGainMin * 60)); // transfer not worth it
  const totalOf = (c) => (c.arr - t0) / 60;
  const walkOf = (c) => walkTotals(c.legs).walkMin;
  // the walking to beat: walking the whole way or the least-walking option within the usual limit
  const usualWalk = Math.min(walkOnlyMin, ...viable.filter((c) => totalOf(c) <= limit).map(walkOf));
  const leastWalk = Math.min(Infinity, ...viable.filter((c) => totalOf(c) <= longLimit).map(walkOf));
  const seen = new Set(), out = [];
  for (const c of [...viable].sort((x, y) => x.arr - y.arr || x.legs.length - y.legs.length)) {
    const total = totalOf(c), wt = walkTotals(c.legs);
    const longWay = total <= longLimit && savesWalking(wt.walkMin, usualWalk) && wt.walkMin <= leastWalk + CRITERIA[0].tol + EPS;
    if (total > limit && !longWay) continue; // absurdly longer than walking, and not the least-walking long way around
    const sig = legSig(c.legs);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ key: c.key, total, totalMin: Math.max(1, Math.round(total)), arrive: c.arr, t0, ...wt, legs: c.legs });
  }
  return rankOptions(out).slice(0, max);
}

/** Walk first: walking the whole way this many minutes or less puts the walk option first (owner 2026-10-30). */
export const WALK_FIRST_MIN = 10;

/** The walk option's line on top: very close (WALK_FIRST_MIN or less, the owner's words) or faster than every bus. */
export const WALK_CAPTION = Object.freeze({ close: "Close enough to walk", faster: "Faster to walk" });

/** Added to the line of an option that walks least but arrives later than walking the whole way (LONG_WAY). */
export const SLOWER_NOTE = "walking is faster";

/**
 * Where the walk option goes among ranked bus options (owner 2026-10-30 walk first; 2026-11-06 the long way around):
 *  - walking takes WALK_FIRST_MIN minutes or less: first, "close";
 *  - else a bus arrives before walking would: not listed (Directions keeps the "Walking the whole way" footnote);
 *  - else the top bus option (least walking) saves walking (savesWalking): second, "faster", when walking arrives more
 *    than the arrival tolerance (1 min) earlier; about as fast: not listed;
 *  - else first ("faster" when more than 1 min earlier, else "close").
 * Pure; Kit Rank.walkPlace.
 * @param {Array<Object>} options ranked bus options (best first; walk options ignored)
 * @param {{min:number}|null} walk walking the whole way
 * @param {number} t0 plan time, unix s
 * @returns {{at:0|1, why:'close'|'faster'}|null}
 */
export function walkPlace(options, walk, t0) {
  const list = (options || []).filter((o) => o && Array.isArray(o.legs) && !o.walkOnly);
  const min = Number(walk && walk.min);
  if (!list.length || !(min > 0)) return null;
  if (min <= WALK_FIRST_MIN + EPS) return { at: 0, why: "close" };
  const arrive = t0 + min * 60;
  const bestBus = Math.min(...list.map((o) => (Number.isFinite(Number(o.arrive)) ? Number(o.arrive) : Infinity)));
  if (arrive > bestBus + EPS) return null;
  const faster = arrive < bestBus - CRITERIA[1].tol * 60 - EPS;
  if (savesWalking(optionStats(list[0]).walk, min)) return faster ? { at: 1, why: "faster" } : null;
  return { at: 0, why: faster ? "faster" : "close" };
}

/**
 * Walk first (owner 2026-10-30: "if the distance is very close, it is ok to just suggest the user to walk on their first
 * travel option"; 2026-11-06: the long way around is fine when it walks least): a walk option (key "walk", walkOnly
 * true, one walk leg, `why` for its caption) goes where walkPlace says, first or second; the bus options keep their
 * ranked order and, with the walk option listed, claim only what they beat (besideWalk). Otherwise the bus options
 * unchanged. Capped at max. Pure.
 * @param {Array<Object>} options ranked bus options (a walk option already in the list is replaced)
 * @param {{m:number, min:number, coords?:Array, source?:string}|null} walk walking the whole way (planner walkOnly)
 * @param {{from:{lat:number, lon:number}, to:{lat:number, lon:number}, t0:number, max?:number}} ctx
 * @returns {Array<Object>}
 */
export function walkFirst(options, walk, { from, to, t0, max = 4 } = {}) {
  const list = (options || []).filter((o) => o && Array.isArray(o.legs) && !o.walkOnly);
  const place = walkPlace(list, walk, t0);
  if (!place) return list.slice(0, max);
  const min = Number(walk.min), arrive = t0 + min * 60;
  const m = Math.round(Number(walk.m) || 0);
  const leg = { type: "walk", from, to, m, min, source: walk.source === "router" ? "router" : "estimate" };
  if (walk.coords) leg.coords = walk.coords;
  const w = { key: "walk", walkOnly: true, why: place.why, total: min, totalMin: Math.max(1, Math.round(min)), arrive, t0, walkMin: min, walkM: m, meets: [], legs: [leg] };
  const bus = list.map((o) => besideWalk(o, min, arrive));
  return [...bus.slice(0, place.at), w, ...bus.slice(place.at)].slice(0, max);
}

/**
 * The small "what it minimizes" line of a bus option: criteriaText, plus " · walking is faster" when it walks least but
 * arrives more than the arrival tolerance (1 min) after walking the whole way would (the long way around, LONG_WAY), so
 * the trade-off sits next to the claim. '' when it claims nothing. Pure; Kit Rank.criteriaLine.
 * @param {{meets?:string[], arrive?:number}} o ranked option
 * @param {number} [walkArrive] arrival of walking the whole way, unix s (omitted: no note)
 * @returns {string}
 */
export function criteriaLine(o, walkArrive) {
  const t = criteriaText(o && o.meets);
  if (!t || !(o.meets || []).includes("walk") || !(Number(walkArrive) > 0)) return t;
  return Number(o.arrive) > Number(walkArrive) + CRITERIA[1].tol * 60 + EPS ? `${t} · ${SLOWER_NOTE}` : t;
}

/**
 * A bus option's criteria once walking the whole way is listed above it (walkFirst): it keeps "Least walking",
 * "Earliest arrival" or "Shortest wait" only if it also beats the walk (walkMin minutes, arriving at walkArrive, no wait)
 * within the same tolerance, so the list never claims what the option right above disproves (QA 2026-11-05: a trip
 * that walked 12 min and arrived 7 min after a 7 min walk said "Least walking, earliest arrival, shortest wait").
 * The order is unchanged; only `meets` (what the card says it minimizes) can lose criteria. Pure.
 * @param {Object} o ranked bus option (with meets)
 * @param {number} walkMin walking the whole way, minutes
 * @param {number} walkArrive its arrival, unix s
 * @returns {Object} o itself, or a copy with fewer meets
 */
export function besideWalk(o, walkMin, walkArrive) {
  const s = optionStats(o), was = Array.isArray(o.meets) ? o.meets : [];
  const meets = was.filter((id) => {
    const c = CRITERIA.find((x) => x.id === id);
    if (!c) return true;
    if (id === "arrive") return s.arrive <= walkArrive + c.tol * 60 + EPS;
    return s[id] <= (id === "walk" ? walkMin : 0) + c.tol + EPS;
  });
  return meets.length === was.length ? o : { ...o, meets };
}

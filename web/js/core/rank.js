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
 * Short label of what an option minimizes, e.g. "Least walking · Earliest arrival" ('' for none).
 * @param {string[]} meets criterion ids
 * @returns {string}
 */
export function criteriaText(meets) {
  return CRITERIA.filter((c) => (meets || []).includes(c.id)).map((c) => c.label).join(" · ");
}

/** Identity of an option's bus legs (route, stops, boarding time): the same trip found twice. */
function legSig(legs) {
  return (legs || []).filter((l) => l.type === "bus")
    .map((l) => `${l.rid}:${l.board && l.board.id}>${l.alight && l.alight.id}@${Math.round(l.boardT || 0)}`).join("|");
}

/**
 * Turn planner candidates into ranked options: drop ones absurdly slower than walking and
 * transfers that do not beat the best direct trip, merge duplicates, rank, cap.
 * @param {Array<{key:string, legs:Array<Object>, arr:number, xfer:boolean}>} cands
 * @param {{t0:number, walkOnlyMin:number, max?:number, xferGainMin?:number}} opts
 * @returns {Array<Object>} Options {key, total, totalMin, arrive, t0, walkMin, walkM, legs, meets}
 */
export function pickOptions(cands, { t0, walkOnlyMin, max = 4, xferGainMin = 2 }) {
  const limit = Math.max(2 * walkOnlyMin, walkOnlyMin + 15);
  const bestDirect = Math.min(Infinity, ...cands.filter((c) => !c.xfer).map((c) => c.arr));
  const seen = new Set(), out = [];
  for (const c of [...cands].sort((x, y) => x.arr - y.arr || x.legs.length - y.legs.length)) {
    const total = (c.arr - t0) / 60;
    if (total > limit) continue; // absurdly longer than walking
    if (c.xfer && c.arr > bestDirect - xferGainMin * 60) continue; // transfer not worth it
    const sig = legSig(c.legs);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ key: c.key, total, totalMin: Math.max(1, Math.round(total)), arrive: c.arr, t0, ...walkTotals(c.legs), legs: c.legs });
  }
  return rankOptions(out).slice(0, max);
}

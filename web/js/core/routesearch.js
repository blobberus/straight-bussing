/**
 * @module core/routesearch
 * Route search for the Routes list (owner 2026-11-04: "You should be able to search routes from the routes menu which
 * will bring them to the top. Allow keywords and smart search such as allowing 53rdst -> 53rd Street or 53rd St ->
 * 53rd Street etc."). Pure, no DOM; the iOS Kit ports it 1:1 (RouteSearch.swift). Both check the same golden cases
 * (web/tests/routesearch-golden.json: a frozen copy of the route names and their stop names, every query's answer).
 *
 * Text rule: core/text.js `norm` (case, accents, punctuation, "/" and "&"), then
 * - letters split from digits and an ordinal dropped: "53rdst" = "53rd st" = "53 st", "57th" = "57" (the right suffix
 *   for the number, or a wrong "th" / "nd" / "rd"; a wrong "st" stays a word: "53st" = "53 street"); while typing,
 *   the start of the suffix too ("53r");
 * - number words: "fifty third" = "53";
 * - "and", "the", "of", "for", "at", "to" are ignored (unless the query is nothing else);
 * - abbreviations both ways (`CANON`, applied to the query and to the names): st / str = street, ave = avenue,
 *   exp / expr = express, ctr / cntr = center, dt = downtown, sth = south, n / s / e / w = north / south / east /
 *   west (whole words only), and a few more.
 * Keywords per route: its short name (AP, DX, CEN, ...), every word of its long name, and the names of its stops.
 * Typos: one edit (core/text.js `near1`) on words of 4+ letters, never on the first letter of a 4 or 5 letter word.
 *
 * Ranking, best first (`TIER`; ties keep the list order):
 *   EXACT 100      the short or long name ("dcc", "Apostolic/Drexel", "ap/dx")
 *   PREFIX 90      the start of a name ("53rdst", "south lo"), minus 0.5 per name word not typed (max 3)
 *   WORDS 80+      every typed word is a name word or its start ("drexel" finds Apostolic/Drexel, "arts")
 *   EXPAND 70+     the same after abbreviations ("sth loop", "ctr", "dt")
 *   STOP 60+       name words plus the words of ONE of its stops ("ratner", "metra", "57th drexel"): `stop` names it
 *   TYPO 50+       a name word with one typo ("drexl")
 *   STOP_TYPO 45+  a stop word with one typo ("ratnr")
 * Within a word tier: + 3 x the mean word weight (1 exact, 0.85 start of a word, 0.7 one typo) - the name words
 * not typed as above.
 *
 * Active routes first (owner 2026-11-05: "Searching routes in the routes menu should still show results if they are
 * inactive (the top results, unless the name is clearly specified, should priortize active routes ..."): `rankByActive`
 * keeps the routes the query names (exact name or the start of one, score >= `NAMED_MIN`) on top in score order, then
 * the other matches that operate now, then the ones that do not (each by score). Every route stays findable.
 */
import { norm, near1 } from "./text.js";

/** Base score of each match kind (see the module comment). */
export const TIER = Object.freeze({ EXACT: 100, PREFIX: 90, WORDS: 80, EXPAND: 70, STOP: 60, TYPO: 50, STOP_TYPO: 45 });

/** Abbreviation -> the word it stands for (both the query and the names are mapped, so it works both ways). */
export const CANON = new Map(Object.entries({
  st: "street", str: "street", ave: "avenue", av: "avenue", blvd: "boulevard", dr: "drive",
  exp: "express", expr: "express", ctr: "center", cntr: "center", centre: "center",
  dt: "downtown", dtwn: "downtown", n: "north", s: "south", e: "east", w: "west", nth: "north", sth: "south",
  apt: "apartments", apts: "apartments", hosp: "hospital", sta: "station", stn: "station", univ: "university",
  lib: "library", shtl: "shuttle", ln: "line",
}));

const STOPWORDS = new Set(["and", "the", "of", "for", "at", "to"]);
const UNITS = new Map(Object.entries({ one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9 }));
const TEENS = new Map(Object.entries({ ten: 10, tenth: 10, eleven: 11, eleventh: 11, twelve: 12, twelfth: 12, thirteen: 13, thirteenth: 13, fourteen: 14, fourteenth: 14, fifteen: 15, fifteenth: 15, sixteen: 16, sixteenth: 16, seventeen: 17, seventeenth: 17, eighteen: 18, eighteenth: 18, nineteen: 19, nineteenth: 19 }));
const TENS = new Map(Object.entries({ twenty: 20, twentieth: 20, thirty: 30, thirtieth: 30, forty: 40, fortieth: 40, fifty: 50, fiftieth: 50, sixty: 60, sixtieth: 60, seventy: 70, seventieth: 70, eighty: 80, eightieth: 80, ninety: 90, ninetieth: 90 }));
const UNMATCHED = 0.5;   // per name word the query does not mention (max 3)
/** Lowest score of a match that names the route (exact name 100, the start of a name 90 down to 88.5). */
export const NAMED_MIN = TIER.PREFIX - UNMATCHED * 3;

/**
 * English ordinal suffix of a number written in digits ("1" -> "st", "53" -> "rd", "11" -> "th").
 * @param {string} digits
 * @returns {string}
 */
export function ordinal(digits) {
  const t = Number(String(digits).slice(-2)) || 0;
  if (t >= 11 && t <= 13) return "th";
  return ["th", "st", "nd", "rd"][t % 10] || "th";
}

/**
 * Words of a route name, stop name or query under the rules above (no abbreviations: see `canon`).
 * @param {string} s
 * @param {boolean} [typing=false] a query being typed: a started ordinal suffix at the very end is dropped ("53r")
 * @returns {string[]}
 */
export function routeWords(s, typing = false) {
  const raw = norm(s).split(" ").filter(Boolean), out = [];
  raw.forEach((w, wi) => {
    const parts = w.match(/[0-9]+|[a-z]+/g) || [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      if (p[0] >= "0" && p[0] <= "9") {
        const num = p.replace(/^0+(?=\d)/, "");
        out.push(num);
        const next = parts[i + 1];
        if (next) {
          const suf = ordinal(num), end = typing && wi === raw.length - 1 && i + 1 === parts.length - 1;
          if (next.startsWith(suf)) parts[i + 1] = next.slice(suf.length);
          else if (next === "th" || next === "nd" || next === "rd" || (end && suf.startsWith(next))) parts[i + 1] = "";
        }
      } else out.push(p);
    }
  });
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    if (TENS.has(w)) {
      const u = UNITS.get(out[i + 1]);
      if (u) { res.push(String(TENS.get(w) + u)); i++; } else res.push(String(TENS.get(w)));
    } else if (TEENS.has(w)) res.push(String(TEENS.get(w)));
    else if (UNITS.has(w)) res.push(String(UNITS.get(w)));
    else res.push(w);
  }
  const kept = res.filter((w) => !STOPWORDS.has(w));
  return kept.length ? kept : res;
}

/**
 * The word an abbreviation stands for ("st" -> "street"); any other word unchanged.
 * @param {string} w
 * @returns {string}
 */
export function canon(w) {
  return CANON.get(w) || w;
}

/**
 * Search index over the routes (build once per data load).
 * @param {{id:string, short?:string, long?:string, stops?:string[]}[]} items in list order (ties keep it)
 * @returns {object[]} entries
 */
export function buildRouteIndex(items) {
  return (items || []).map((it, order) => {
    const short = routeWords(it.short || ""), long = routeWords(it.long || "");
    const names = [...short, ...long], seen = new Set(), stops = [];
    for (const name of it.stops || []) {
      const k = String(name ?? "");
      if (!k || seen.has(k)) continue;
      seen.add(k);
      stops.push({ name: k, words: routeWords(k).map(canon) });
    }
    const main = long.length ? long : short;
    return { id: String(it.id), order, sqShort: short.join(""), sqLong: long.join(""), names, namesC: names.map(canon), mainC: main.map(canon), stops };
  });
}

/**
 * Index for the store's routes: names, and stop names from routeStops (in `ids` order, else the routes' key order).
 * @param {{routes?:object, routeStops?:object, stops?:object}} state
 * @param {string[]} [ids]
 * @returns {object[]}
 */
export function routeIndexFor(state, ids) {
  const R = state?.routes || {}, S = state?.stops || {}, RS = state?.routeStops || {};
  return buildRouteIndex((ids || Object.keys(R)).map((id) => ({
    id, short: R[id]?.short, long: R[id]?.long, stops: (RS[id] || []).map((sid) => S[sid]?.name).filter(Boolean),
  })));
}

/** Weight of one query word against words: 1 exact, 0.85 start of a word, 0.7 one typo, 0 none. */
function wordW(q, words, short, typo) {
  let best = 0;
  for (const w of words) {
    if (w === q) return 1;
    if ((q.length >= 2 || short) && w.startsWith(q)) best = 0.85;
    else if (typo && best < 0.7 && q.length >= 4 && w.length >= 4 && (q.length > 5 || q[0] === w[0]) && !/[0-9]/.test(q) && near1(q, w)) best = 0.7;
  }
  return best;
}

const mean = (ws) => ws.reduce((a, b) => a + b, 0) / ws.length;

/** Name words the query does not mention, x 0.5 (max 3 words). */
function unmatched(e, qc) {
  let n = 0;
  for (const w of e.mainC) if (!qc.some((q) => w === q || w.startsWith(q) || (q.length >= 4 && w.length >= 4 && near1(q, w)))) n++;
  return UNMATCHED * Math.min(3, n);
}

/** All words weigh more than 0: the mean, else 0. */
function allMean(ws) {
  return ws.every((w) => w > 0) ? mean(ws) : 0;
}

/**
 * Score one route (0 = no match) and the stop that matched (stop tiers only).
 * @param {object} e index entry
 * @param {string[]} qw query words (routeWords(q, true))
 * @returns {{score:number, stop?:string}}
 */
export function scoreRoute(e, qw) {
  const qsq = qw.join(""), last = qw.length - 1, qc = qw.map(canon);
  if (!qsq) return { score: 0 };
  if (qsq === e.sqShort || qsq === e.sqLong) return { score: TIER.EXACT };
  if ((e.sqLong && e.sqLong.startsWith(qsq)) || (e.sqShort && e.sqShort.startsWith(qsq))) return { score: TIER.PREFIX - unmatched(e, qc) };
  let m = allMean(qw.map((q, i) => wordW(q, e.names, i === last, false)));
  if (m) return { score: TIER.WORDS + 3 * m - unmatched(e, qc) };
  m = allMean(qc.map((q, i) => wordW(q, e.namesC, i === last, false)));
  if (m) return { score: TIER.EXPAND + 3 * m - unmatched(e, qc) };
  if (qsq.length < 2) return { score: 0 };
  const viaStops = (typo, base) => {
    let best = 0, stop = null;
    for (const s of e.stops) {
      const v = allMean(qc.map((q, i) => Math.max(wordW(q, e.namesC, i === last, typo), wordW(q, s.words, false, typo))));
      if (v > best) { best = v; stop = s.name; }
    }
    return best ? { score: base + 3 * best, stop } : null;
  };
  const st = viaStops(false, TIER.STOP);
  if (st) return st;
  m = allMean(qc.map((q, i) => wordW(q, e.namesC, i === last, true)));
  if (m) return { score: TIER.TYPO + 3 * m - unmatched(e, qc) };
  return viaStops(true, TIER.STOP_TYPO) || { score: 0 };
}

/**
 * Routes matching a query, best first (ties keep the index order). Empty query: [].
 * @param {object[]} index buildRouteIndex / routeIndexFor
 * @param {string} q
 * @returns {{id:string, score:number, stop?:string}[]} stop: the stop name that matched (stop tiers)
 */
export function searchRoutes(index, q) {
  const qw = routeWords(q, true);
  if (!qw.length) return [];
  const hits = [];
  for (const e of index || []) {
    const r = scoreRoute(e, qw);
    if (r.score > 0) hits.push({ id: e.id, score: r.score, order: e.order, ...(r.stop ? { stop: r.stop } : {}) });
  }
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.map(({ order, ...h }) => h);
}

/**
 * Split a list (display order) into the matches, best first, and the rest in their usual order. Never changes
 * anything stored: the Routes list only draws them in this order.
 * @param {string[]} ids
 * @param {{id:string}[]} hits searchRoutes
 * @returns {{top:string[], rest:string[]}}
 */
export function splitByHits(ids, hits) {
  const inList = new Set((ids || []).map(String)), top = [];
  for (const h of hits || []) if (inList.has(h.id) && !top.includes(h.id)) top.push(h.id);
  const got = new Set(top);
  return { top, rest: (ids || []).map(String).filter((id) => !got.has(id)) };
}

/**
 * "3 routes match" / "1 route matches" / "No routes match" (the Routes list's live count).
 * @param {number} n
 * @returns {string}
 */
export function matchText(n) {
  return n === 0 ? "No routes match" : n === 1 ? "1 route matches" : `${n} routes match`;
}

/**
 * Order matches for the Routes list (owner 2026-11-05): the routes the query names (score >= NAMED_MIN) stay on top
 * whether or not they run, then the matches operating now, then the rest; each part keeps the score order (ties keep
 * the list order). `active` = the Show running rule (routes.js operatingIds: a bus reporting, or scheduled now with no
 * live location). null = live status unknown (feed not loaded or failing): the order is unchanged.
 * @param {{id:string, score:number, stop?:string}[]} hits searchRoutes (best first)
 * @param {Set<string>|string[]|null} active route ids operating now
 * @returns {{id:string, score:number, stop?:string}[]} a new array
 */
export function rankByActive(hits, active) {
  const list = hits || [];
  if (active == null) return list.slice();
  const on = active instanceof Set ? active : new Set([...active].map(String));
  const named = [], run = [], rest = [];
  for (const h of list) (h.score >= NAMED_MIN ? named : on.has(h.id) ? run : rest).push(h);
  return [...named, ...run, ...rest];
}

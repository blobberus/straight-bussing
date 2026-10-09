// Spelling correction for the place search ("did you mean", Google style). Pure functions, no I/O.
// The vocabulary is every word of the local place names, nicknames and campus stop names (data/places.js builds
// it once when data/places.json loads). Distance = Damerau-Levenshtein (optimal string alignment) with typing-
// friendly weights: neighbouring keys, vowel mix-ups, swapped letters and doubled letters cost less than other
// edits. Limits: words under 4 letters are never corrected, 1 edit for 4-5 letters, 2 edits for longer words.
// Also handles a missing space ("maxpalevsky") and an extra one ("regen stein").

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const POS = {};
ROWS.forEach((r, y) => [...r].forEach((c, x) => { POS[c] = [x + y * 0.5, y]; }));
const VOWELS = new Set('aeiouy');
const SWAP = 0.6;          // two neighbouring letters swapped ("palvesky")
const NEAR_KEY = 0.6;      // a key next to the right one ("regenstwin")
const VOWEL = 0.7;         // one vowel for another ("regensteen")
const DOUBLE = 0.5;        // a doubled letter added or dropped ("mansuetto", "crear")
const JOIN = 0.8;          // a space added or dropped
const PREFIX = 0.3;        // matched only the start of a longer word (still typing)
const FAR = Object.freeze({ cost: Infinity, edits: Infinity });

/** Keys next to each other on a QWERTY keyboard. */
export function adjacent(a, b) {
  const p = POS[a], q = POS[b];
  return !!p && !!q && a !== b && Math.abs(p[0] - q[0]) <= 1 && Math.abs(p[1] - q[1]) <= 1;
}

/** Most edits allowed for a typed word of this length (0 = never corrected). */
export function maxEdits(len) {
  return len < 4 ? 0 : len <= 5 ? 1 : 2;
}

function sub(x, y) {
  if (x === y) return 0;
  if (adjacent(x, y)) return NEAR_KEY;
  if (VOWELS.has(x) && VOWELS.has(y)) return VOWEL;
  return /\d/.test(x) || /\d/.test(y) ? 1.5 : 1;
}
const indel = (s, k) => ((k > 0 && s[k] === s[k - 1]) || (k + 1 < s.length && s[k] === s[k + 1]) ? DOUBLE : 1);

/**
 * Weighted optimal-string-alignment distance between a typed word and a vocabulary word.
 * @param {string} a typed
 * @param {string} b candidate
 * @param {number} [limit=2] give up (cost/edits Infinity) once more edits than this are certain
 * @returns {{cost:number, edits:number}} edits = plain edit count along the cheapest alignment
 */
export function distance(a, b, limit = 2) {
  const n = a.length, m = b.length, w = m + 1;
  if (Math.abs(n - m) > limit) return FAR;
  if (lowerBound(a, b) > limit) return FAR;
  if ((n + 1) * w > C.length) { C = new Float64Array((n + 1) * w * 2); E = new Uint8Array(C.length); }
  C[0] = 0; E[0] = 0;
  for (let j = 1; j <= m; j++) { C[j] = C[j - 1] + indel(b, j - 1); E[j] = j; }
  for (let i = 1; i <= n; i++) {
    const r = i * w, up = r - w, x = a[i - 1];
    C[r] = C[up] + indel(a, i - 1); E[r] = i;
    let rowMin = E[r];
    for (let j = 1; j <= m; j++) {
      const y = b[j - 1];
      let best = C[up + j - 1] + sub(x, y), ed = E[up + j - 1] + (x === y ? 0 : 1);
      const del = C[up + j] + indel(a, i - 1);
      if (del < best) { best = del; ed = E[up + j] + 1; }
      const ins = C[r + j - 1] + indel(b, j - 1);
      if (ins < best) { best = ins; ed = E[r + j - 1] + 1; }
      if (i > 1 && j > 1 && x !== y && x === b[j - 2] && a[i - 2] === y) {
        const t = C[up - w + j - 2] + SWAP;
        if (t < best) { best = t; ed = E[up - w + j - 2] + 1; }
      }
      C[r + j] = best; E[r + j] = ed;
      if (ed < rowMin) rowMin = ed;
    }
    if (rowMin > limit) return FAR;   // edits only grow along any alignment
  }
  return { cost: C[n * w + m], edits: E[n * w + m] };
}
let C = new Float64Array(1024), E = new Uint8Array(1024);   // reused DP tables (no allocation per call)
const HIST = new Int16Array(128);

/** Fewest edits two words can be apart judging by their letters alone (cheap filter before the full distance). */
function lowerBound(a, b) {
  for (let i = 0; i < a.length; i++) HIST[a.charCodeAt(i) & 127]++;
  let common = 0;
  for (let i = 0; i < b.length; i++) { const k = b.charCodeAt(i) & 127; if (HIST[k] > 0) { HIST[k]--; common++; } }
  for (let i = 0; i < a.length; i++) HIST[a.charCodeAt(i) & 127] = 0;
  return Math.max(a.length, b.length) - common;
}

/**
 * Vocabulary from normalized texts (lowercase words separated by single spaces).
 * @param {Iterable<string>} texts
 * @returns {{count:Map<string,number>, sorted:string[], byLen:Map<number,string[]>}}
 */
export function buildVocab(texts) {
  const count = new Map();
  for (const t of texts) for (const w of String(t).split(' ')) if (w) count.set(w, (count.get(w) || 0) + 1);
  const sorted = [...count.keys()].sort();
  const byLen = new Map();
  for (const w of sorted) {
    if (!byLen.has(w.length)) byLen.set(w.length, []);
    byLen.get(w.length).push(w);
  }
  return { count, sorted, byLen };
}

/** A vocabulary word, or the start of one ("regens"). */
export function known(v, w) {
  if (v.count.has(w)) return true;
  let lo = 0, hi = v.sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (v.sorted[mid] < w) lo = mid + 1; else hi = mid; }
  return lo < v.sorted.length && v.sorted[lo].startsWith(w);
}

/**
 * Closest vocabulary words for one typed word, cheapest first (ties: the more common word).
 * @param {object} v vocabulary
 * @param {string} w typed word (normalized)
 * @param {{last?:boolean, max?:number}} [o] last: the word may be unfinished, so word beginnings count too (1 edit)
 * @returns {{word:string, cost:number, edits:number}[]}
 */
export function wordCandidates(v, w, { last = false, max = 3 } = {}) {
  const lim = maxEdits(w.length);
  if (!lim || /\d/.test(w)) return [];
  const found = new Map();
  const add = (word, d, extra) => {
    const cost = d.cost + extra, old = found.get(word);
    if (!old || cost < old.cost) found.set(word, { word, cost, edits: d.edits });
  };
  for (let L = w.length - lim; L <= w.length + lim; L++) {
    for (const c of v.byLen.get(L) || []) { const d = distance(w, c, lim); if (d.edits <= lim) add(c, d, 0); }
  }
  if (last) {
    for (const c of v.sorted) {
      if (c.length <= w.length + 1) continue;
      const d = distance(w, c.slice(0, w.length), 1);
      if (d.edits <= 1) add(c, d, PREFIX);
    }
  }
  return [...found.values()].sort((a, b) => a.cost - b.cost || (v.count.get(b.word) || 0) - (v.count.get(a.word) || 0) || a.word.localeCompare(b.word)).slice(0, max);
}

/**
 * Candidate corrections for a query, cheapest first. Only words that are neither a vocabulary word nor the start
 * of one are changed (numbers never). Each candidate: {words, cost, big, risky} where big = a long stretch worth
 * telling the user about (2+ edits in a word, more than one word changed, or a space added / removed) and risky =
 * a short word (4-5 letters) changed by a plain edit ("loop" -> "coop"), which needs a whole-name match to count.
 * @param {object} v vocabulary
 * @param {string[]} qw typed words (normalized)
 * @param {{max?:number}} [o]
 * @returns {{words:string[], cost:number, big:boolean, risky:boolean}[]}
 */
export function corrections(v, qw, { max = 10 } = {}) {
  const lastI = qw.length - 1;
  const opts = qw.map((w, i) => {
    if (/\d/.test(w) || known(v, w)) return [{ word: w, cost: 0, edits: 0 }];
    // short words: a plain edit is risky, and never on the first letter ("loop" is not "coop")
    const c = wordCandidates(v, w, { last: i === lastI }).filter((x) => w.length > 5 || x.cost < 1 || x.word[0] === w[0])
      .map((x) => ({ ...x, risky: w.length <= 5 && x.cost >= 1 }));
    return c.length ? c : [{ word: w, cost: 0, edits: 0 }];
  });
  let combos = [{ words: [], cost: 0, changed: 0, most: 0, risky: false }];
  for (const o of opts) {
    combos = combos.flatMap((c) => o.map((x) => ({ words: [...c.words, x.word], cost: c.cost + x.cost,
      changed: c.changed + (x.edits ? 1 : 0), most: Math.max(c.most, x.edits), risky: c.risky || !!x.risky })));
    combos.sort((a, b) => a.cost - b.cost);
    combos.length = Math.min(combos.length, max);
  }
  const out = combos.filter((c) => c.changed).map((c) => ({ words: c.words, cost: c.cost, big: c.most >= 2 || c.changed > 1, risky: c.risky }));
  // an extra space: two typed words that make one vocabulary word ("regen stein", "max palev sky")
  for (let i = 0; i < lastI; i++) {
    const m = qw[i] + qw[i + 1], end = i + 1 === lastI;
    const fix = v.count.has(m) || (end && known(v, m)) ? [{ word: m, cost: 0 }] : wordCandidates(v, m, { last: end, max: 1 });
    for (const x of fix) out.push({ words: [...qw.slice(0, i), x.word, ...qw.slice(i + 2)], cost: JOIN + x.cost, big: true, risky: false });
  }
  // a missing space: one typed word that is two vocabulary words ("harpermemorial")
  qw.forEach((w, i) => {
    if (w.length < 5 || /\d/.test(w) || v.count.has(w)) return;
    for (let k = 2; k <= w.length - 2; k++) {
      const a = w.slice(0, k), b = w.slice(k);
      if (v.count.has(a) && (v.count.has(b) || (i === lastI && known(v, b)))) {
        out.push({ words: [...qw.slice(0, i), a, b, ...qw.slice(i + 1)], cost: JOIN, big: true, risky: false });
      }
    }
  });
  return out.sort((a, b) => a.cost - b.cost).slice(0, max);
}

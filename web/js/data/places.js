// Local place search: named places within a 30-minute walk of the campus shuttle stops (data/places.json,
// built from OpenStreetMap by tools/build_places.py; ODbL, (c) OpenStreetMap contributors).
// Instant, works offline and sends nothing anywhere. Forgiving: punctuation and spaces are ignored
// ("chickfila" = "Chick-fil-A"), word prefixes match ("medi" finds Medici), one typo is allowed in longer
// words, nicknames count as names ("Reg", "Max P", "I-House"; p[8] = other names) and categories work
// ("coffee", "grocery", "apartments"). Ranked by match quality, then by the walk to the nearest stop.
// When nothing matches well, the query is spell-corrected against the words of the place names, nicknames
// and stop names (./spell.js) and the result says what it assumed: {from, to, big}.
// data/geocode.js merges these with Photon results. The index is built once when the file loads;
// preloadPlaces() fetches it in idle time after start so the first search is instant.
import { buildVocab, corrections } from './spell.js';

const URL_PLACES = new URL('../../data/places.json', import.meta.url);
const LIMIT = 5;
const MIN_SCORE = 50;
const STRONG = 88;        // a typed query this good is never corrected
const NAME_LEVEL = 75;    // a correction must match every word of a name (not only categories / addresses)
const MARGIN = 4;         // ... and beat what was typed by this much
const ALIAS = 0.5;        // a nickname match ranks just below the same exact / prefix match on the real name
const WHOLE = 92;         // the query is a whole name or the start of one (a risky correction needs this)
const UNMATCHED = 0.5;    // per name word the query does not mention (max 3): "univ of chicago" -> the campus
/** Query words that mean a kind of place (matched against OSM tag values kept in the search terms). */
const SYNONYMS = {
  coffee: ['cafe', 'coffee'], cafe: ['cafe', 'coffee'], grocery: ['supermarket', 'greengrocer', 'grocery'], groceries: ['supermarket', 'greengrocer', 'grocery'],
  food: ['restaurant', 'fast', 'cafe', 'dining'], restaurant: ['restaurant'], restaurants: ['restaurant'], apartment: ['apartments'], apartments: ['apartments'],
  apt: ['apartments'], apts: ['apartments'], dorm: ['dormitory', 'dorm'], dorms: ['dormitory', 'dorm'], drugstore: ['pharmacy', 'chemist'],
  pharmacy: ['pharmacy', 'chemist'], gas: ['fuel'], gym: ['fitness', 'gym', 'sports'], bar: ['bar', 'pub'], bars: ['bar', 'pub'], pizza: ['pizza'],
  burger: ['burger'], burgers: ['burger'], library: ['library'], church: ['worship', 'church'], bank: ['bank'], hotel: ['hotel'],
  train: ['station', 'train'], parking: ['parking'], garage: ['parking'], dining: ['dining'],
};

let data = null, loading = null, index = null, vocab = null, display = null, gen = 0;

/**
 * Lowercase, strip accents and punctuation, "&" -> "and", words separated by single spaces.
 * @param {string} s
 * @returns {string}
 */
export function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/['\u2019`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Edit distance <= 1 (insert, delete, substitute or swap two neighbours). */
function near1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** Best weight of one query word against a list of words: 1 exact, .85 prefix, .7 one typo (fuzzy only), 0 none. */
function wordWeight(q, words, fuzzy) {
  let best = 0;
  for (const w of words) {
    if (w === q) return 1;
    if (q.length >= 2 && w.startsWith(q)) best = Math.max(best, 0.85);
    else if (fuzzy && q.length >= 5 && w.length >= 4 && near1(q, w)) best = Math.max(best, 0.7);
  }
  return best;
}

function buildIndex(d) {
  return (d?.p || []).map((p) => {
    const seen = new Set(), forms = [];
    for (const text of [p[0], ...(Array.isArray(p[8]) ? p[8] : [])]) {
      const n = norm(text);
      if (n && !seen.has(n)) { seen.add(n); forms.push({ words: n.split(' '), sq: n.replace(/ /g, ''), text }); }
    }
    const extra = norm([p[1], p[2], p[7]].join(' ')).split(' ');
    return { p, forms, all: forms.flatMap((f) => f.words).concat(extra) };
  });
}

/** Spelling vocabulary + display forms ("dangelo" -> "D'Angelo") from names, nicknames, kinds and stop names. */
function buildWords(d, idx) {
  const texts = [], show = new Map();
  const learn = (orig) => {
    for (const t of String(orig).split(/[\s\-\u2013/,()&]+/)) {
      const k = norm(t);
      if (!k || k.includes(' ')) continue;
      const clean = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      const old = show.get(k);
      if (!old || (old === old.toLowerCase() && clean !== clean.toLowerCase())) show.set(k, clean);
    }
  };
  for (const e of idx) {
    for (const f of e.forms) texts.push(f.words.join(' '));
    texts.push(norm(e.p[1]));
    learn(e.p[0]);
    if (Array.isArray(e.p[8])) e.p[8].forEach(learn);
  }
  for (const s of d.stops || []) { texts.push(norm(s)); learn(s); }
  texts.push(Object.keys(SYNONYMS).join(' '));
  return [buildVocab(texts), show];
}

/**
 * Score one place for a query (0 = no match). Name and nickname matches beat category / address matches.
 * @param {{forms:{words:string[], sq:string, text:string}[], all:string[]}} e all = name, nickname, kind, address and tag words
 * @param {string[]} qw query words
 * @param {string} qsq query without spaces
 * @param {boolean} [fuzzy=true] allow one typo per word
 * @param {boolean} [names=false] names and nicknames only (no category / address matches)
 * @returns {number}
 */
export function scorePlace(e, qw, qsq, fuzzy = true, names = false) {
  let best = 0;
  e.forms.forEach((f, k) => {
    let s = 0;
    if (f.sq === qsq) s = 100 - (k ? ALIAS : 0);
    else if (qsq.length >= 3 && f.sq.startsWith(qsq)) s = WHOLE - (k ? ALIAS : 0);
    else {
      const ws = qw.map((q) => wordWeight(q, f.words, fuzzy));
      if (ws.every((w) => w > 0)) {
        const rest = f.words.filter((w) => !qw.some((q) => w.startsWith(q))).length;
        s = 60 + 25 * (ws.reduce((a, b) => a + b, 0) / ws.length) + (ws[0] === 1 && f.words[0] === qw[0] ? 3 : 0) - UNMATCHED * Math.min(3, rest);
      } else if (qsq.length >= 4 && f.sq.includes(qsq)) s = 70;
    }
    if (s > best) best = s;
  });
  if (best || names) return best;
  const xs = qw.map((q) => Math.max(wordWeight(q, e.all, fuzzy), ...(SYNONYMS[q] || []).map((s) => wordWeight(s, e.all, false))));
  if (xs.every((w) => w > 0)) return 45 + 20 * (xs.reduce((a, b) => a + b, 0) / xs.length);
  return 0;
}

function rank(qw, fuzzy, names = false) {
  const qsq = qw.join(''), hits = [];
  for (const e of index) {
    const s = scorePlace(e, qw, qsq, fuzzy, names);
    if (s >= MIN_SCORE) hits.push([s, e]);
  }
  return hits.sort((a, b) => b[0] - a[0] || a[1].p[6] - b[1].p[6] || a[1].p[0].localeCompare(b[1].p[0]));
}

function toItem([s, { p }]) {
  const stop = data.stops?.[p[5]] || '';
  const walk = `${p[6]} min walk to ${stop || 'a shuttle stop'}`;
  return { label: p[0], sub: [p[1] !== 'Place' ? p[1] : '', p[2], walk].filter(Boolean).join(' · '), lat: p[3], lon: p[4], walk: p[6], stop, score: Math.round(s), local: true };
}

/** Best spelling correction that finds a name-level match clearly better than the typed text (or null). */
function correct(qw, top) {
  if (!vocab) [vocab, display] = buildWords(data, index);
  let best = null;
  for (const c of corrections(vocab, qw)) {
    const hits = rank(c.words, false, true), s = hits[0]?.[0] || 0;
    if (s < NAME_LEVEL || s <= top + MARGIN || (c.risky && s < WHOLE - ALIAS)) continue;
    const value = s - 3 * c.cost;
    if (!best || value > best.value) best = { value, hits, c };
  }
  if (!best) return null;
  const { c, hits } = best, sq = c.words.join(''), f = hits[0][1].forms.find((x) => x.sq === sq);
  // the corrected letters spell a whole name with other spacing ("regen stien" -> "Regenstein"): show that name
  if (f && f.words.length !== c.words.length) return { hits, to: f.text, big: true };
  return { hits, to: c.words.map((w) => display.get(w) || w).join(' '), big: c.big };
}

/**
 * Search the loaded places (pure; call loadPlaces() first, or setPlaces() in tests). When the typed text has
 * no strong match, a spelling correction is tried and, if it finds better matches, used: `assumed` says so.
 * @param {string} q
 * @param {{limit?:number, exact?:boolean}} [o] exact: as typed (no correction, no typo tolerance)
 * @returns {{items:Array<{label:string, sub:string, lat:number, lon:number, walk:number, stop:string, score:number, local:true}>,
 *   assumed?:{from:string, to:string, big:boolean}}} big: a long stretch (2+ edits in a word, 2+ words, or a space added / removed)
 */
export function findLocal(q, { limit = LIMIT, exact = false } = {}) {
  const n = norm(q);
  if (!index || n.length < 2) return { items: [] };
  const qw = n.split(' ');
  let hits = rank(qw, !exact), assumed = null;
  const top = hits[0]?.[0] || 0;
  if (!exact && top < STRONG) {
    const c = correct(qw, top);
    if (c) { hits = c.hits; assumed = { from: String(q).trim(), to: c.to, big: c.big }; }
  }
  const items = hits.slice(0, limit).map(toItem);
  return assumed ? { items, assumed } : { items };
}

/**
 * Items only (see findLocal).
 * @param {string} q
 * @param {{limit?:number, exact?:boolean}} [o]
 */
export function searchLocal(q, o) {
  return findLocal(q, o).items;
}

/** Whether the place index is loaded (searches answer synchronously). */
export function placesReady() { return !!index; }

/**
 * Load data/places.json once (never throws; a missing file just means no local results).
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<boolean>} whether places are available
 */
export function loadPlaces(fetchFn) {
  if (index) return Promise.resolve(true);
  if (!loading) {
    const f = fetchFn || ((...a) => globalThis.fetch(...a)), mine = gen;
    loading = Promise.resolve().then(() => f(URL_PLACES, { cache: 'no-cache' }))
      .then((r) => (r && r.ok ? r.json() : null)).then((j) => { if (mine === gen && j && Array.isArray(j.p)) setPlaces(j); return !!index; })
      .catch(() => false).finally(() => { if (!index) loading = null; });
  }
  return loading;
}

/**
 * Fetch and index the places in idle time (after the page has loaded), so the first search is instant.
 * @param {{fetch?:typeof fetch, delay?:number}} [o] delay: fallback wait (ms) where requestIdleCallback is missing
 * @returns {void}
 */
export function preloadPlaces({ fetch: fetchFn, delay = 1200 } = {}) {
  if (index || loading || typeof window === 'undefined') return;
  const go = () => { loadPlaces(fetchFn).then((okLoad) => { if (okLoad && vocab === null) [vocab, display] = buildWords(data, index); }); };
  const idle = () => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(go, { timeout: 3000 }) : setTimeout(go, delay));
  if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle, { once: true });
}

/**
 * Replace the place data (tests, or a pre-fetched copy). A load already in flight will not overwrite it.
 * @param {{stops:string[], p:Array}|null} d
 * @returns {void}
 */
export function setPlaces(d) {
  gen++;
  data = d || null;
  index = d ? buildIndex(d) : null;
  vocab = display = null;
  loading = null;
}

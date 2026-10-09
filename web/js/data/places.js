// Local place search: named places within a 30-minute walk of the campus shuttle stops (data/places.json,
// built from OpenStreetMap by tools/build_places.py; ODbL, (c) OpenStreetMap contributors).
// Instant, works offline and sends nothing anywhere. Forgiving: punctuation and spaces are ignored
// ("chickfila" = "Chick-fil-A"), word prefixes match ("medi" finds Medici), one typo is allowed in longer
// words, and categories work ("coffee", "grocery", "apartments"). Ranked by match quality, then by the
// walk to the nearest stop. data/geocode.js merges these with Photon results.

const URL_PLACES = new URL('../../data/places.json', import.meta.url);
const LIMIT = 5;
const MIN_SCORE = 50;
/** Query words that mean a kind of place (matched against OSM tag values kept in the search terms). */
const SYNONYMS = {
  coffee: ['cafe', 'coffee'], cafe: ['cafe', 'coffee'], grocery: ['supermarket', 'greengrocer', 'grocery'], groceries: ['supermarket', 'greengrocer', 'grocery'],
  food: ['restaurant', 'fast', 'cafe'], restaurant: ['restaurant'], restaurants: ['restaurant'], apartment: ['apartments'], apartments: ['apartments'],
  apt: ['apartments'], apts: ['apartments'], dorm: ['dormitory', 'dorm'], dorms: ['dormitory', 'dorm'], drugstore: ['pharmacy', 'chemist'],
  pharmacy: ['pharmacy', 'chemist'], gas: ['fuel'], gym: ['fitness', 'gym'], bar: ['bar', 'pub'], bars: ['bar', 'pub'], pizza: ['pizza'],
  burger: ['burger'], burgers: ['burger'], library: ['library'], church: ['worship', 'church'], bank: ['bank'], hotel: ['hotel'],
};

let data = null, loading = null, index = null;

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

/** Best weight of one query word against a list of words: 1 exact, .85 prefix, .7 one typo, 0 none. */
function wordWeight(q, words) {
  let best = 0;
  for (const w of words) {
    if (w === q) return 1;
    if (q.length >= 2 && w.startsWith(q)) best = Math.max(best, 0.85);
    else if (q.length >= 5 && w.length >= 4 && near1(q, w)) best = Math.max(best, 0.7);
  }
  return best;
}

function buildIndex(d) {
  return (d?.p || []).map((p) => {
    const n = norm(p[0]);
    return { p, words: n.split(' '), sq: n.replace(/ /g, ''), extra: norm([p[1], p[2], p[7]].join(' ')).split(' ') };
  });
}

/**
 * Score one place for a query (0 = no match). Name matches beat category / address matches.
 * @param {{words:string[], sq:string, extra:string[]}} e
 * @param {string[]} qw query words
 * @param {string} qsq query without spaces
 * @returns {number}
 */
export function scorePlace(e, qw, qsq) {
  if (e.sq === qsq) return 100;
  if (qsq.length >= 3 && e.sq.startsWith(qsq)) return 92;
  const ws = qw.map((q) => wordWeight(q, e.words));
  if (ws.every((w) => w > 0)) return 60 + 25 * (ws.reduce((a, b) => a + b, 0) / ws.length) + (ws[0] === 1 && e.words[0] === qw[0] ? 3 : 0);
  if (qsq.length >= 4 && e.sq.includes(qsq)) return 70;
  const all = e.words.concat(e.extra);
  const xs = qw.map((q) => Math.max(wordWeight(q, all), ...(SYNONYMS[q] || []).map((s) => wordWeight(s, all))));
  if (xs.every((w) => w > 0)) return 45 + 20 * (xs.reduce((a, b) => a + b, 0) / xs.length);
  return 0;
}

/**
 * Search the loaded places (pure; call loadPlaces() first, or setPlaces() in tests).
 * @param {string} q
 * @param {{limit?:number}} [o]
 * @returns {Array<{label:string, sub:string, lat:number, lon:number, walk:number, stop:string, score:number, local:true}>}
 */
export function searchLocal(q, { limit = LIMIT } = {}) {
  const n = norm(q);
  if (!index || n.length < 2) return [];
  const qw = n.split(' '), qsq = n.replace(/ /g, '');
  const hits = [];
  for (const e of index) {
    const s = scorePlace(e, qw, qsq);
    if (s >= MIN_SCORE) hits.push([s, e]);
  }
  hits.sort((a, b) => b[0] - a[0] || a[1].p[6] - b[1].p[6] || a[1].p[0].localeCompare(b[1].p[0]));
  return hits.slice(0, limit).map(([s, { p }]) => {
    const stop = data.stops?.[p[5]] || '';
    const walk = `${p[6]} min walk to ${stop || 'a shuttle stop'}`;
    return { label: p[0], sub: [p[1] !== 'Place' ? p[1] : '', p[2], walk].filter(Boolean).join(' · '), lat: p[3], lon: p[4], walk: p[6], stop, score: Math.round(s), local: true };
  });
}

/**
 * Load data/places.json once (never throws; a missing file just means no local results).
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<boolean>} whether places are available
 */
export function loadPlaces(fetchFn) {
  if (index) return Promise.resolve(true);
  if (!loading) {
    const f = fetchFn || ((...a) => globalThis.fetch(...a));
    loading = Promise.resolve().then(() => f(URL_PLACES, { cache: 'no-cache' }))
      .then((r) => (r && r.ok ? r.json() : null)).then((j) => { if (j && Array.isArray(j.p)) setPlaces(j); return !!index; })
      .catch(() => false).finally(() => { if (!index) loading = null; });
  }
  return loading;
}

/**
 * Replace the place data (tests, or a pre-fetched copy).
 * @param {{stops:string[], p:Array}|null} d
 * @returns {void}
 */
export function setPlaces(d) {
  data = d || null;
  index = d ? buildIndex(d) : null;
  loading = null;
}

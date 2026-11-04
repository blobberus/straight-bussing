/**
 * @module core/text
 * The one text-matching rule shared by the searches (pure, no DOM): place search (data/places.js), station search
 * (views import `norm` through data/places.js) and route search (core/routesearch.js). The iOS Kit has the same two
 * functions as `PlaceIndex.norm` / `PlaceIndex.near1` (Places.swift), which RouteSearch.swift reuses.
 */

/**
 * Lowercase, strip accents and punctuation, "&" -> "and", words separated by single spaces.
 * @param {string} s
 * @returns {string}
 */
export function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/['’`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Edit distance <= 1 (insert, delete, substitute or swap two neighbours).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function near1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

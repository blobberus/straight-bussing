/**
 * @module core/time
 * Time helpers. All times are unix seconds (number). Pure, no DOM.
 */

/**
 * Current time in unix seconds (float).
 * @returns {number}
 */
export const nowS = () => Date.now() / 1000;

let clockFmt = null;

/**
 * Format a unix time as a short local clock string, e.g. '4:12 PM'.
 * Returns '' for missing/invalid input.
 * @param {number} unixS
 * @returns {string}
 */
export function clock(unixS) {
  if (typeof unixS !== "number" || !isFinite(unixS) || unixS <= 0) return "";
  try {
    if (!clockFmt) clockFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
    return clockFmt.format(new Date(unixS * 1000));
  } catch (e) {
    const d = new Date(unixS * 1000);
    const h = d.getHours(), m = d.getMinutes();
    return ((h + 11) % 12 + 1) + ":" + String(m).padStart(2, "0") + (h < 12 ? " AM" : " PM");
  }
}

/**
 * Whole minutes from `from` until `unixS`, floored. Can be zero or negative.
 * @param {number} unixS
 * @param {number} [from=nowS()]
 * @returns {number}
 */
export function minsUntil(unixS, from = nowS()) {
  return Math.floor((unixS - from) / 60);
}

/**
 * Human relative age: '8s ago', '3 min ago', '2 h ago', '3 d ago'. Future/now -> 'just now'.
 * Missing/invalid input -> 'never'.
 * @param {number} unixS
 * @param {number} [from=nowS()] reference time (for tests)
 * @returns {string}
 */
export function ago(unixS, from = nowS()) {
  if (typeof unixS !== "number" || !isFinite(unixS) || unixS <= 0) return "never";
  const s = Math.floor(from - unixS);
  if (s < 1) return "just now";
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return Math.floor(s / 86400) + " d ago";
}

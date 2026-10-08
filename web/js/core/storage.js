/**
 * @module core/storage
 * JSON localStorage wrapper. Every access is in try/catch (private mode, quota, disabled storage).
 * Keys are prefixed with 'sb:'.
 */

const PREFIX = "sb:";

function ls() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (e) {
    return null;
  }
}

/**
 * Load a JSON value. Returns `fallback` when missing, unreadable, or unparsable.
 * @template T
 * @param {string} key  (without prefix)
 * @param {T} fallback
 * @returns {T|*}
 */
export function load(key, fallback) {
  try {
    const s = ls();
    if (!s) return fallback;
    const raw = s.getItem(PREFIX + key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

/**
 * Save a JSON-serialisable value. Never throws.
 * @param {string} key  (without prefix)
 * @param {*} value
 * @returns {boolean} true if written
 */
export function save(key, value) {
  try {
    const s = ls();
    if (!s) return false;
    s.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Remove a key. Never throws.
 * @param {string} key  (without prefix)
 * @returns {boolean}
 */
export function remove(key) {
  try {
    const s = ls();
    if (!s) return false;
    s.removeItem(PREFIX + key);
    return true;
  } catch (e) {
    return false;
  }
}

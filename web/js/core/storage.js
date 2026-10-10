/**
 * @module core/storage
 * JSON localStorage wrapper. Every access is in try/catch (private mode, quota, disabled storage).
 * Keys are prefixed with 'sb:'.
 * Demo mode (core/demo.js, `?demo=1`): reads still see the saved prefs, but writes and removals stay in an
 * in-memory overlay for this page only, so a demo session never changes or stores anything.
 */
import { DEMO } from "./demo.js";

const PREFIX = "sb:";
/** Demo overlay: prefixed key -> JSON string, or null for "removed". null = normal mode. */
let mem = DEMO ? new Map() : null;

/**
 * Switch the in-memory overlay on (fresh, empty) or off. On in demo mode; a test seam otherwise.
 * @param {boolean} on
 * @returns {void}
 */
export function useMemoryOverlay(on) {
  mem = on ? new Map() : null;
}

/** @returns {boolean} true while writes go to memory only (demo mode) */
export function memoryOverlay() {
  return !!mem;
}

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
    if (mem && mem.has(PREFIX + key)) {
      const v = mem.get(PREFIX + key);
      return v === null ? fallback : JSON.parse(v);
    }
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
    if (mem) {
      const v = JSON.stringify(value);
      if (v === undefined) return false;
      mem.set(PREFIX + key, v);
      return true;
    }
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
    if (mem) { mem.set(PREFIX + key, null); return true; }
    const s = ls();
    if (!s) return false;
    s.removeItem(PREFIX + key);
    return true;
  } catch (e) {
    return false;
  }
}

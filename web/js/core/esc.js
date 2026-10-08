/**
 * @module core/esc
 * HTML escaping and safe color helpers. Pure, no DOM.
 */

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

/**
 * HTML-escape any value for safe interpolation into element text or quoted attributes.
 * null/undefined become ''.
 * @param {*} s
 * @returns {string}
 */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"'`]/g, (c) => ESC_MAP[c]);
}

/**
 * Validate a color as '#RRGGBB' (a bare 'RRGGBB' GTFS value is accepted and normalised).
 * Anything else (including CSS injection attempts) returns the default '#555555'.
 * @param {*} c
 * @returns {string} '#RRGGBB'
 */
export function safeColor(c) {
  if (typeof c !== "string") return "#555555";
  const s = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return "#" + s.toUpperCase();
  return "#555555";
}

/**
 * WCAG relative luminance of a color (0 = black, 1 = white). Invalid input is treated as '#555555'.
 * @param {string} hex
 * @returns {number}
 */
export function lum(hex) {
  const n = parseInt(safeColor(hex).slice(1), 16);
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}

/**
 * Readable text color on a background color, chosen by luminance.
 * @param {string} hex background
 * @returns {'#111114'|'#ffffff'}
 */
export function textOn(hex) {
  return lum(hex) > 0.45 ? "#111114" : "#ffffff";
}

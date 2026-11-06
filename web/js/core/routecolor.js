/**
 * @module core/routecolor
 * Route colors on the dark map (owner 2026-11-06: "Outline or change coloring of the dark shuttles to make them more
 * noticable"). Five of Passio's route colors (Downtown Campus Connector #0E5700, Regents Express #393B79, Apostolic
 * #0000FF, Friend Center/Metra #8C4600, Move In Charter #843C39) are under 2.4:1 against the dark map's land and nearly
 * vanish there. On the dark map a route color under LINE_MIN_CONTRAST against the land is drawn lighter in its own hue
 * (darkRouteColor): up to 3:1 against the land AND the street fill the lines run along, and a badge in it keeps AA
 * text. Every other color, and every color on the light map, is drawn as published. Lightness only, no outline: the
 * owner removed the line outlines on 2026-11-04, and a light edge on a 3 px line washes it toward gray.
 * The iPhone app has the same functions (Kit RouteColor); both check their answers against
 * tests/fixtures/routecolor_golden.json. Pure, no DOM.
 */
import { safeColor, contrast, textOn } from "./esc.js";

/** The least contrast a route line keeps against the map land (WCAG 1.4.11, graphical objects). */
export const LINE_MIN_CONTRAST = 3;
/** The least contrast of the text on a bus badge in a lifted color (WCAG 1.4.3 AA: the badge text is small). */
export const BADGE_TEXT_MIN = 4.5;
/** The dark map's land (map/style.js PALETTE.dark.bg; tests/map-style.js keeps them equal). */
export const DARK_LAND = "#202124";
/** The dark map's street fill (map/style.js PALETTE.dark.minor), the gray most lines run along. */
export const DARK_STREET = "#3A3B40";
/** Lightness step (OKLab L, 0..1) of the search: an answer is at most this much lighter than it needs to be. */
const STEP = 0.005;

const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/**
 * OKLab of a color (Ottosson 2020): L lightness 0..1, a / b the hue plane.
 * @param {string} hex '#RRGGBB' (anything else is treated as '#555555')
 * @returns {[number, number, number]} [L, a, b]
 */
export function oklab(hex) {
  const n = parseInt(safeColor(hex).slice(1), 16);
  const r = toLin((n >> 16) / 255), g = toLin(((n >> 8) & 255) / 255), b = toLin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** Linear sRGB of an OKLab color (may fall outside 0..1). Cubes by multiplication: the same bits in Swift. */
function linRgb(L, a, b) {
  const l1 = L + 0.3963377774 * a + 0.2158037573 * b, m1 = L - 0.1055613458 * a - 0.0638541728 * b;
  const s1 = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l1 * l1 * l1, m = m1 * m1 * m1, s = s1 * s1 * s1;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const inGamut = (rgb) => rgb.every((v) => v >= -1e-7 && v <= 1 + 1e-7);

/**
 * '#RRGGBB' at OKLab lightness L in the hue of (a, b): the full chroma when sRGB can show it, else the most chroma that
 * fits (same hue, found by halving).
 */
function hexAt(L, a, b) {
  let rgb = linRgb(L, a, b);
  if (!inGamut(rgb)) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) {
      const k = (lo + hi) / 2;
      if (inGamut(linRgb(L, a * k, b * k))) lo = k; else hi = k;
    }
    rgb = linRgb(L, a * lo, b * lo);
  }
  const ch = (v) => Math.round(toSrgb(Math.min(1, Math.max(0, v))) * 255);
  return "#" + rgb.map((v) => ch(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Whether a badge in this color carries AA text in its text color (core/esc.js textOn: near-black or white).
 * @param {string} hex
 * @returns {boolean}
 */
export function badgeTextOk(hex) {
  return contrast(hex, textOn(hex)) >= BADGE_TEXT_MIN;
}

/**
 * Lift a color for a dark background: the color itself when it already has `min` contrast against every background,
 * else the same hue made lighter (OKLab lightness up in STEP steps, chroma kept while sRGB can show it) until it has it
 * and a badge in it still carries AA text. White when nothing lighter reaches it.
 * @param {string} color '#RRGGBB' (anything else is treated as '#555555')
 * @param {string|string[]} [bg] background(s) to stand out from (default the dark map's land)
 * @param {number} [min] least contrast ratio (default LINE_MIN_CONTRAST)
 * @returns {string} '#RRGGBB'
 */
export function liftForDark(color, bg = DARK_LAND, min = LINE_MIN_CONTRAST) {
  const c = safeColor(color), bgs = (Array.isArray(bg) ? bg : [bg]).map(safeColor);
  const enough = (x) => bgs.every((g) => contrast(x, g) >= min);
  if (enough(c)) return c;
  const [L0, a, b] = oklab(c);
  for (let i = 1; L0 + i * STEP < 1; i++) {
    const x = hexAt(L0 + i * STEP, a, b);
    if (enough(x) && badgeTextOk(x)) return x;
  }
  return "#FFFFFF";
}

/**
 * A route color on the dark map: as published when it has 3:1 against the land; a darker one is lifted until it also
 * has 3:1 against the street fill (DARK_STREET), so it does not sink into the gray street it runs along either. Not to
 * 3:1 against the main roads' lighter fill (#4D4E55, about 1 px beside a line at campus zooms): that would push the five
 * into the same light band as the oranges and blues (Friend Center/Metra 0.047 from Apostolic/Drexel in OKLab, closer
 * than any two routes are today, 0.064).
 * @param {string} color route color
 * @returns {string} '#RRGGBB'
 */
export function darkRouteColor(color) {
  const c = safeColor(color);
  return contrast(c, DARK_LAND) >= LINE_MIN_CONTRAST ? c : liftForDark(c, [DARK_LAND, DARK_STREET]);
}

const memo = new Map();

/**
 * The color the map draws a route in: as published on the light map, darkRouteColor on the dark one (cached). Lines,
 * focused lines, stop rings, chevrons (through their text color), bus badges and planned bus legs all use it.
 * @param {string} color route color
 * @param {boolean} dark the dark map
 * @returns {string} '#RRGGBB'
 */
export function mapColor(color, dark) {
  const c = safeColor(color);
  if (!dark) return c;
  let x = memo.get(c);
  if (!x) { x = darkRouteColor(c); if (memo.size > 256) memo.clear(); memo.set(c, x); }
  return x;
}

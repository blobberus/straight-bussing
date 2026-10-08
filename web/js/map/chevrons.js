/**
 * map/chevrons.js: direction-of-travel chevrons along focused routes (route detail, highlighted
 * custom route, station filter with 1-3 routes). One multi-part SVG path per route, spaced in screen
 * pixels and rebuilt on zoom only (world-pixel projection, so panning never recomputes). Static (no
 * animation), non-interactive: the pane ignores pointer events so stop halos and buses keep every tap.
 * Chevron color is the route's text color (black on light lines, white on dark ones) for contrast.
 */
import { safeColor, textOn } from '../core/esc.js';
import { marksAlong, chevronPx, runsForward, normLatLngs } from './geometry.js';

const PANE = 'sbChevrons';
const Z_INDEX = 396;          // above route lines (390/394), below plans (400) and stops (420)
const SPACING_PX = 80;
const MIN_ZOOM = 13;
const MAX_PER_LINE = 600;

/**
 * Chevron size in px for a zoom level (arm length), matching map/layers.js lineWeight.
 * @param {number} z
 * @returns {number}
 */
export function chevronSize(z) {
  return Math.max(3, Math.min(4.5, 3 + (z - 13) * 0.4));
}

/**
 * Lines of one route oriented in travel direction (reversed when the shape runs against stop order).
 * @param {Array<Array<[number, number]>>} lines shapes[rid]
 * @param {string[]} order routeStops[rid]
 * @param {object} stops stop id -> {lat, lon}
 * @returns {Array<Array<[number, number]>>}
 */
export function orientedLines(lines, order, stops) {
  const sp = (order || []).map((id) => stops?.[id]).filter(Boolean);
  return (lines || []).map(normLatLngs).filter((l) => l.length > 1)
    .map((l) => (runsForward(l, sp) ? l : l.slice().reverse()));
}

/**
 * @param {L.Map} map
 * @returns {{set(list:Array<{rid:string, color:string, lines:Array}>):void, redraw():void, count():number}}
 */
export function createChevronLayer(map) {
  const L = window.L;
  const pane = map.getPane(PANE) || map.createPane(PANE);
  pane.style.zIndex = String(Z_INDEX);
  pane.style.pointerEvents = 'none';
  const group = L.layerGroup().addTo(map);
  let items = [], marks = 0;

  function redraw() {
    group.clearLayers();
    marks = 0;
    const z = map.getZoom();
    if (!items.length || z < MIN_ZOOM) return;
    const size = chevronSize(z);
    for (const it of items) {
      const parts = [];
      for (const line of it.lines) {
        const px = line.map((ll) => { const p = map.project(ll, z); return [p.x, p.y]; });
        for (const m of marksAlong(px, SPACING_PX, { max: MAX_PER_LINE })) {
          parts.push(chevronPx(m, size).map((p) => map.unproject(L.point(p[0], p[1]), z)));
        }
      }
      if (!parts.length) continue;
      marks += parts.length;
      L.polyline(parts, { pane: PANE, className: 'sb-chev', color: textOn(safeColor(it.color)), weight: 2, opacity: 0.95,
        lineCap: 'round', lineJoin: 'round', interactive: false, smoothFactor: 0 }).addTo(group);
    }
  }

  return {
    /** Replace the chevron routes ([] clears). Callers gate on their own signature. */
    set(list) { items = Array.isArray(list) ? list : []; redraw(); },
    /** Rebuild for the current zoom (call on zoomend). */
    redraw,
    /** Number of chevrons currently drawn (diagnostics/tests). */
    count: () => marks,
  };
}

/**
 * map/landmarks.js: building and place names on the map (owner request 2026-10-13: "the buildings on the maps should
 * also have their names like Google maps. Not every building, but highly trafficked ones and prominent off campus
 * locations relevant to the bus coverage", and "UChicago dorm buildings"). Data: web/data/landmarks.json
 * (tools/build_landmarks.py, OpenStreetMap coordinates) via store.landmarks -> MapApi.setLandmarks.
 *
 * Drawn in a Leaflet pane ABOVE the route lines and below stops, buses and the trip markers (the vector basemap's own
 * text sits under every Leaflet overlay, so the colored route lines would cut through the letters). After every move
 * or zoom (not during one), labels are placed greedily in priority order (tier, then list order): each takes the
 * first of center / below / above / right / left where its text box (measured with the label font, wrapped at
 * ~8.5 em) overlaps no label already placed and no stop circle; a label with no free spot is left out. Tier 1 shows
 * from map zoom 14.5 (the app opens at 15), tier 2 from 15.5, tier 3 from 16.5; a group name with `until` (Max
 * Palevsky Commons) hides from that zoom on, when its buildings' own names show. Text only, never interactive,
 * hidden from screen readers (stops and buses keep their own labels). iOS MapScreen places them the same way.
 */
import { esc } from '../core/esc.js';

/** First map zoom of each tier. */
export const LANDMARK_Z = Object.freeze({ 1: 14.5, 2: 15.5, 3: 16.5 });
/** Box padding (px) around a label and a stop circle's radius as an obstacle. */
export const LABEL = Object.freeze({ PAD: 2, STOP_R: 6.5, MAX_EM: 8.5, LINE: 1.12, GAPS: [4, 14], STOP_OK: { 1: 0, 2: 0, 3: 0 }, TEXT_OK: { 1: true } });   // a stop circle never cuts a name; only tier 1 may sit on street text
const SIDES = ['below', 'above', 'right', 'left', 'below-right', 'below-left', 'above-right', 'above-left'];

/**
 * Font size (px) of a tier at a map zoom (Google-like: grows a little as you zoom in).
 * @param {number} tier
 * @param {number} zoom
 * @returns {number}
 */
export function labelSize(tier, zoom) {
  const [z0, s0, z1, s1] = tier === 1 ? [14.5, 11.5, 18, 14.5] : [LANDMARK_Z[tier] || 15.5, 11, 19, 14];
  const k = Math.min(1, Math.max(0, (zoom - z0) / (z1 - z0)));
  return Math.round((s0 + (s1 - s0) * k) * 2) / 2;
}

/**
 * Greedy word wrap.
 * @param {string} text
 * @param {number} maxPx
 * @param {(s:string)=>number} width text width in px
 * @returns {string[]}
 */
export function wrapLines(text, maxPx, width) {
  const words = String(text).split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (!cur || width(t) <= maxPx) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Place labels: priority order; each takes the first position (centered on its point, then 8 sides at 4 px, then at
 * 14 px, never farther: a name must stay by its building) that covers no label already placed, no stop circle and
 * no basemap text (street and place names: `textAt`); without a spot clear of basemap text, the first one clear of
 * labels and stops (tier 1 only: LABEL.TEXT_OK); with neither, it is left out (it shows once you zoom in).
 * Pure (textAt is the caller's lookup).
 * @param {Array<{id:any, x:number, y:number, w:number, h:number, tier?:number}>} cands screen point + text box size, in priority order
 * @param {Array<{x:number, y:number, w:number, h:number}>} obstacles boxes nothing may cover (stop circles)
 * @param {{w:number, h:number}} view visible size (labels must fit inside)
 * @param {(box:{x, y, w, h})=>boolean} [textAt] basemap text drawn in this box (screen px)
 * @returns {Array<{id:any, anchor:string, box:{x, y, w, h}, covers:number, onText:boolean}>} covers: stop circles under
 *   the text; onText: it overlaps basemap text (no clear spot)
 */
export function placeLabels(cands, obstacles, view, textAt = null) {
  const placed = [], taken = [];
  const P = LABEL.PAD;
  const boxAt = (c, a, G, w, h) => {
    const cx = c.x - w / 2, cy = c.y - h / 2;
    switch (a) {
      case 'center': return { x: cx, y: cy, w, h };
      case 'below': return { x: cx, y: c.y + G, w, h };
      case 'above': return { x: cx, y: c.y - G - h, w, h };
      case 'right': return { x: c.x + G, y: cy, w, h };
      case 'left': return { x: c.x - G - w, y: cy, w, h };
      case 'below-right': return { x: c.x + G, y: c.y + G, w, h };
      case 'below-left': return { x: c.x - G - w, y: c.y + G, w, h };
      case 'above-right': return { x: c.x + G, y: c.y - G - h, w, h };
      default: return { x: c.x - G - w, y: c.y - G - h, w, h };
    }
  };
  for (const c of cands) {
    const w = c.w + 2 * P, h = c.h + 2 * P, ok = LABEL.STOP_OK[c.tier] || 0;
    const tries = [['center', 0], ...LABEL.GAPS.flatMap((G) => SIDES.map((a) => [a, G]))];
    let best = null, clear = null;
    for (const [a, G] of tries) {
      const box = boxAt(c, a, G, w, h);
      if (box.x < 0 || box.y < 0 || box.x + box.w > view.w || box.y + box.h > view.h) continue;
      if (taken.some((t) => hit(box, t))) continue;
      const covers = obstacles.reduce((n, o) => n + (hit(box, o) ? 1 : 0), 0);
      if (covers === 0) {
        const onText = !!(textAt && textAt(box));
        if (!onText) { clear = { a, box, covers, onText }; break; }
        if (!best || best.covers) best = { a, box, covers, onText };
      } else if (covers <= ok && !best) best = { a, box, covers, onText: !!(textAt && textAt(box)) };
    }
    const pick = clear || (best && (!best.onText || LABEL.TEXT_OK[c.tier]) ? best : null);
    if (!pick) continue;
    taken.push(pick.box);
    placed.push({ id: c.id, anchor: pick.a, box: pick.box, covers: pick.covers, onText: pick.onText });
  }
  return placed;
}

let ctx2d = null;
function measurer(font) {
  try {
    ctx2d = ctx2d || document.createElement('canvas').getContext('2d');
    ctx2d.font = font;
    return (s) => ctx2d.measureText(s).width;
  } catch (e) { const px = parseFloat(/(\d+(\.\d+)?)px/.exec(font)?.[1] || '12'); return (s) => s.length * px * 0.58; }
}
const FONT = (px) => `700 ${px}px -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif`;

/**
 * The label layer.
 * @param {L.Map} map
 * @param {{pane?:string, textAt?:(box:{x, y, w, h})=>boolean}} [o] textAt: basemap text in a box of the map's
 *   container (the vector basemap answers it from its own placed labels)
 * @returns {{setData(list:Array<object>):void, setStops(points:Array<[number, number]>):void, refresh():void, count():number}}
 */
export function createLandmarkLayer(map, o = {}) {
  const L = window.L;
  const pane = o.pane || 'sbLabels';
  const group = L.layerGroup().addTo(map);
  let list = [], stops = [], shown = 0, sig = '';

  function refresh() {
    const z = map.getZoom(), size = map.getSize(), b = map.getBounds().pad(0.15);
    const cands = [];
    list.forEach((x, r) => {
      if (z < (LANDMARK_Z[x.tier] ?? 99) || (x.until != null && z >= x.until) || !b.contains([x.lat, x.lon])) return;
      const px = labelSize(x.tier, z), width = measurer(FONT(px));
      const lines = wrapLines(x.name, px * LABEL.MAX_EM, width);
      const p = map.latLngToContainerPoint([x.lat, x.lon]);
      cands.push({ id: r, tier: x.tier, x: p.x, y: p.y, w: Math.ceil(Math.max(...lines.map(width))), h: Math.ceil(lines.length * px * LABEL.LINE), px, lines });
    });
    const R = LABEL.STOP_R, obstacles = [];
    if (z >= 14) for (const s of stops) { const p = map.latLngToContainerPoint(s); if (p.x > -R && p.y > -R && p.x < size.x + R && p.y < size.y + R) obstacles.push({ x: p.x - R, y: p.y - R, w: 2 * R, h: 2 * R }); }
    const placed = placeLabels(cands, obstacles, { w: size.x, h: size.y }, typeof o.textAt === 'function' ? o.textAt : null);
    const s = placed.map((q) => `${q.id}:${Math.round(q.box.x)},${Math.round(q.box.y)}`).join(';') + '|' + z;
    if (s === sig) return;
    sig = s;
    group.clearLayers();
    const byId = new Map(cands.map((c) => [c.id, c]));
    for (const q of placed) {
      const c = byId.get(q.id), x = list[q.id];
      // the marker sits at the box's top-left corner (container point -> latlng), so the box is exactly what was checked
      const ll = map.containerPointToLatLng([q.box.x + LABEL.PAD, q.box.y + LABEL.PAD]);
      const html = `<span class="sb-lm sb-lm--t${x.tier} sb-lm--${esc(x.kind || 'place')}" aria-hidden="true" style="font-size:${c.px}px;width:${c.w + 2}px">${c.lines.map(esc).join('<br>')}</span>`;
      L.marker(ll, { pane, interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'sb-lmicon', html, iconSize: [0, 0], iconAnchor: [0, 0] }) }).addTo(group);
    }
    shown = placed.length;
  }

  map.on('moveend zoomend resize', refresh);
  return {
    /** @param {Array<{name, lat, lon, tier, kind}>} l store.landmarks */
    setData(l) { list = (Array.isArray(l) ? l : []).filter((x) => x && x.name && Number.isFinite(x.lat) && Number.isFinite(x.lon)); sig = ''; refresh(); },
    /** Stop circles the labels must leave free. @param {Array<[number, number]>} pts */
    setStops(pts) { stops = Array.isArray(pts) ? pts : []; sig = ''; refresh(); },
    refresh,
    count: () => shown,
  };
}

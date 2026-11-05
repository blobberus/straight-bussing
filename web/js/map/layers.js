/**
 * map/layers.js: route network (colored lines, no outline since 2026-11-04; stops with 44 px tap halos) and live bus
 * markers. Every redraw is gated by a cheap signature so 10 s polling never repaints static layers;
 * bus markers are updated in place (setLatLng + class toggles) and recreated only when a bus changes
 * route. The pure helpers (idOf, sig, networkSig, busSig, lineWeight, lineTapWidth, routeLabel, focusSet) do not touch
 * Leaflet, so this module can be imported without `L` for unit tests.
 * Lines stack by `order` (index 0 on top); focused routes always above unfocused ones. A bus is faded exactly when its
 * route is (core/visibility.js busFaded, owner 2026-11-04).
 */
import { safeColor, textOn } from '../core/esc.js';
import { bearing as geoBearing } from '../core/geo.js';
import { createChevronLayer, orientedLines } from './chevrons.js';
import { lineAt as pickLine, LINE_TAP_PX } from './geometry.js';
import { unwrapDeg } from './geometry.js';
import { prepareShape, follow, pathCum, pointAt, advance, headingAt } from './track.js';
import { busKey, busNumbers } from '../core/busnum.js';
import { busFaded } from '../core/visibility.js';

const ids = new WeakMap();
let nextId = 1;

/**
 * Small integer that is stable for an object's identity (0 for null/primitives).
 * @param {*} o
 * @returns {number}
 */
export function idOf(o) {
  if (!o || typeof o !== 'object') return 0;
  let i = ids.get(o);
  if (!i) { i = nextId++; ids.set(o, i); }
  return i;
}

/**
 * Join parts into a signature string (arrays joined by ',').
 * @param {...*} parts
 * @returns {string}
 */
export function sig(...parts) {
  return parts.map((p) => (Array.isArray(p) ? p.join(',') : String(p ?? ''))).join('|');
}

/**
 * Normalize a focus argument: null/undefined/[] mean "no focus".
 * @param {string[]|null|undefined} focus
 * @returns {Set<string>|null}
 */
export function focusSet(focus) {
  return Array.isArray(focus) && focus.length ? new Set(focus.map(String)) : null;
}

const size = (o) => (o && typeof o === 'object' ? Object.keys(o).length : 0);

/**
 * Draw lists for the network, bottom to top: `back` (unfocused routes) then `front` (focused,
 * always above). `order` is top-most first; routes missing from it sit below every listed route,
 * in data order. Hidden routes are dropped unless focused.
 * @param {string[]} ids route ids that have shapes (data order)
 * @param {{hidden?:string[], focus?:string[]|null, order?:string[]}} o
 * @returns {{back:string[], front:string[]}}
 */
export function stackOrder(ids, o = {}) {
  const hidden = new Set((o.hidden || []).map(String)), focus = focusSet(o.focus);
  const vis = (ids || []).map(String).filter((r) => !hidden.has(r) || focus?.has(r));
  const set = new Set(vis), top = [];
  for (const r of (o.order || []).map(String)) if (set.has(r) && !top.includes(r)) top.push(r);
  for (const r of vis) if (!top.includes(r)) top.push(r);
  const bottomUp = top.reverse();
  return { back: bottomUp.filter((r) => !focus?.has(r)), front: bottomUp.filter((r) => !!focus?.has(r)) };
}

/**
 * Signature of everything drawNetwork depends on (identity + sizes of static data, hidden, focus,
 * draw order, dim).
 * @param {{routes, shapes, routeStops, stopRoutes, stops, hidden?:string[], focus?:string[]|null, order?:string[]}} o
 * @param {boolean} [dimAll] true while a trip plan is shown
 * @returns {string}
 */
export function networkSig(o, dimAll = false) {
  const f = focusSet(o.focus);
  return sig(idOf(o.routes), size(o.routes), idOf(o.shapes), size(o.shapes), idOf(o.stopRoutes), size(o.stopRoutes),
    idOf(o.stops), size(o.stops), [...(o.hidden || [])].map(String).sort(), f ? [...f].sort() : '', dimAll ? 1 : 0,
    (o.order || []).map(String));
}

/**
 * Per-marker signature for a bus (position, heading, stale, label, color, focused, number, picked, faded).
 * @returns {string}
 */
export function busSig(rid, lat, lon, bearing, stale, label, color, focused = false, num = 0, selected = false, faded = false) {
  return sig(rid, lat.toFixed(6), lon.toFixed(6), Number.isFinite(bearing) ? Math.round(bearing) : '', stale ? 1 : 0, label, color,
    focused ? 1 : 0, num || 0, selected ? 1 : 0, faded ? 1 : 0);
}

/** A bus must move this far before its heading is derived from movement (no feed bearing). */
export const HEADING_MIN_M = 15;

/**
 * Heading to show for a bus: the feed bearing when present, else the direction from its previous
 * position when it moved at least HEADING_MIN_M, else the last known heading (NaN if none).
 * @param {number} feedBearing degrees or NaN
 * @param {[number, number]|null} prev previous [lat, lon]
 * @param {[number, number]} cur current [lat, lon]
 * @param {number} last last shown heading or NaN
 * @param {(a:[number,number], b:[number,number])=>number} distFn meters between two points
 * @returns {number}
 */
export function busHeading(feedBearing, prev, cur, last, distFn) {
  if (Number.isFinite(feedBearing)) return feedBearing;
  if (prev && distFn(prev, cur) >= HEADING_MIN_M) {
    return geoBearing({ lat: prev[0], lon: prev[1] }, { lat: cur[0], lon: cur[1] });
  }
  return Number.isFinite(last) ? last : NaN;
}

/**
 * Route line width by map zoom: z13 2, z14 2.25, z15 3, z16 4, z17 5, z18 6 (owner 2026-11-04: "Remove the outlines for the
 * lines but make the lines themselves thinner": about a third thinner zoomed out, a quarter up close; DESIGN-SPEC 11.3
 * had 3, 3.5, 4.5, 5.5, 6.5, 8).
 */
export const LINE_WIDTHS = Object.freeze([[13, 2], [14, 2.25], [15, 3], [16, 4], [17, 5], [18, 6]]);
/** The widths before 2026-11-04 (spec 11.3): the line tap still measures from them, so a thinner line is as easy to tap. */
const TAP_WIDTHS = Object.freeze([[13, 3], [14, 3.5], [15, 4.5], [16, 5.5], [17, 6.5], [18, 8]]);

/** A width table at a zoom, linear between the stops, clamped at both ends. */
function widthAt(t, z) {
  const n = Number.isFinite(z) ? z : 15;
  if (n <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (n <= t[i][0]) { const [z0, w0] = t[i - 1], [z1, w1] = t[i]; return Math.round((w0 + ((n - z0) / (z1 - z0)) * (w1 - w0)) * 100) / 100; }
  }
  return t[t.length - 1][1];
}

/**
 * Route line weight in px for a zoom level (LINE_WIDTHS). A focused line adds FOCUS_EXTRA. No casing (owner 2026-11-04).
 * @param {number} z
 * @returns {number}
 */
export function lineWeight(z) {
  return widthAt(LINE_WIDTHS, z);
}
/** Focused lines are this much wider (spec 11.3): 5 against 3 at z15, plus full opacity while the rest dim to 0.2. */
export const FOCUS_EXTRA = 2;

/**
 * Width (px) a tap on a route line is measured from (lineAt: LINE_TAP_PX beyond half of it): the widest line as drawn
 * before 2026-11-04 (a focused one with its 3 px casing), so the thinner, edgeless lines keep the same finger-sized reach.
 * @param {number} z
 * @returns {number}
 */
export function lineTapWidth(z) {
  return widthAt(TAP_WIDTHS, z) + 3 + FOCUS_EXTRA;
}

/**
 * Stop circle size by zoom (spec 11.4): hidden below z14, radius 4 / stroke 2 at z14 to 15, radius 5 / stroke 2.5 from z16.
 * @param {number} z
 * @returns {{radius:number, weight:number}}
 */
export function stopStyle(z) {
  return z >= 16 ? { radius: 5, weight: 2.5 } : { radius: 4, weight: 2 };
}

/**
 * The text on a bus marker (docs/DESIGN-SPEC.md 11.4): the same as the route badge in the sheet and on the iPhone app
 * (Route.chipText): the published short name, never truncated ("AP/DX", was cut to "AP/D"), else the first letter of the
 * long name ("N" for North).
 * @param {string} rid
 * @param {object} routes
 * @returns {string}
 */
export function routeLabel(rid, routes) {
  const r = routes?.[rid] || {};
  const s = String(r.short || '').trim();
  if (s) return s;
  const l = String(r.long || '').trim();
  return l ? l.charAt(0).toUpperCase() : '?';
}

/**
 * Network layer: route lines in two panes (unfocused, focused above), the colored line only (no outline, 2026-11-04),
 * right under its own lines in stack order so a higher-priority route covers lower ones where they
 * overlap; stops in their own group shown at zoom >= 14; chevrons along 1-3 focused routes.
 * @param {L.Map} map
 * @param {{onStopTap:(id:string)=>void}} cb
 * lineAt(containerPoint) names the route line under a tap: the topmost one drawn (map/geometry.js lineAt).
 * @returns {{draw(o:object, dimAll?:boolean):boolean, restyle():void, chevrons():number, stopPoints():Array, lineAt(p:{x:number, y:number}):string|null}}
 */
export function createNetworkLayer(map, cb) {
  const L = window.L;
  const lines = L.layerGroup().addTo(map);
  const stopsG = L.layerGroup();
  const chev = createChevronLayer(map);
  let last = '', polys = [], stopPts = [], hits = [], stopMks = [];   // hits: drawn route lines, bottom to top: {rid, ll, bounds}
  const showStops = () => {
    const on = map.getZoom() >= 14;
    if (on && !map.hasLayer(stopsG)) stopsG.addTo(map);
    else if (!on && map.hasLayer(stopsG)) map.removeLayer(stopsG);
  };

  function draw(o, dimAll = false) {
    const s = networkSig(o, dimAll);
    if (s === last) return false;
    last = s;
    lines.clearLayers(); stopsG.clearLayers(); polys = []; stopPts = []; hits = []; stopMks = [];
    const routes = o.routes || {}, shapes = o.shapes || {}, hidden = new Set((o.hidden || []).map(String));
    const focus = focusSet(o.focus);
    const w = lineWeight(map.getZoom());
    const { back, front: fronts } = stackOrder(Object.keys(shapes), o);
    for (const rid of [...back, ...fronts]) {
      // network state: every line at 0.9; focused state: focused lines 2 px wider at full opacity, the others at 0.2
      // (spec 11.3); no outlines (owner 2026-11-04)
      const front = !!focus?.has(rid), dim = dimAll || (focus && !front), bonus = front && !dimAll ? FOCUS_EXTRA : 0;
      const color = safeColor(routes[rid]?.color), pane = front ? 'sbFocusLines' : 'sbLines';
      const segs = (shapes[rid] || []).filter((pts) => pts && pts.length >= 2);
      for (const pts of segs) {
        const line = L.polyline(pts, { pane, className: 'sb-route', color, weight: w + bonus,
          opacity: dim ? 0.2 : front ? 1 : 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(lines);
        polys.push({ line, bonus });
        hits.push({ rid, ll: pts, bounds: L.latLngBounds(pts), bonus });
      }
    }
    const chevRoutes = !dimAll && fronts.length && fronts.length <= 3 ? fronts : [];
    chev.set(chevRoutes.map((rid) => ({ rid, color: routes[rid]?.color,
      lines: orientedLines(shapes[rid], o.routeStops?.[rid], o.stops) })));
    // stops: served by a visible route (only focus routes when focused)
    for (const [id, st] of Object.entries(o.stops || {})) {
      const rs = (o.stopRoutes?.[id] || []).map(String).filter((r) => (focus ? focus.has(r) : !hidden.has(r)));
      if (!rs.length || !Number.isFinite(st?.lat) || !Number.isFinite(st?.lon)) continue;
      const single = new Set(rs).size === 1;
      const ll = [st.lat, st.lon];
      stopPts.push(ll);
      // a circle in the card color with a route-color stroke; a stop of several routes gets the neutral label2 stroke
      stopMks.push(L.circleMarker(ll, { pane: 'sbStops', ...stopStyle(map.getZoom()), color: single ? safeColor(routes[rs[0]]?.color) : '#5c5c63',
        className: single ? 'sb-stop' : 'sb-stop sb-stop-multi', opacity: dimAll ? 0.4 : 1, fillOpacity: dimAll ? 0.4 : 1, interactive: false }).addTo(stopsG));
      L.circleMarker(ll, { pane: 'sbStops', radius: 22, stroke: false, fillOpacity: 0, className: 'sb-halo', bubblingMouseEvents: false })
        .on('click', () => cb.onStopTap(id)).addTo(stopsG);
    }
    showStops();
    return true;
  }

  function restyle() {
    const z = map.getZoom(), w = lineWeight(z), ss = stopStyle(z);
    for (const p of polys) p.line.setStyle({ weight: w + p.bonus });
    for (const m of stopMks) if (m.options.radius !== ss.radius) m.setStyle(ss).setRadius(ss.radius);
    showStops();
    chev.redraw();
  }
  /**
   * The route line under a point of the map container (px), the one drawn on top when several are near; null when
   * none is within reach. Only lines drawn now count (hidden routes are not drawn).
   * @param {{x:number, y:number}} p
   * @returns {string|null}
   */
  function lineAt(p) {
    if (!hits.length || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const width = lineTapWidth(map.getZoom()), reach = LINE_TAP_PX + width;   // the reach of a finger, not the thinner drawn line
    const near = L.latLngBounds(map.containerPointToLatLng([p.x - reach, p.y + reach]), map.containerPointToLatLng([p.x + reach, p.y - reach]));
    const toPx = (ll) => { const c = map.latLngToContainerPoint(ll); return [c.x, c.y]; };
    const lines = hits.filter((h) => h.bounds.intersects(near)).map((h) => ({ rid: h.rid, px: h.ll.map(toPx), width }));
    return pickLine([p.x, p.y], lines);
  }
  return { draw, restyle, chevrons: () => chev.count(), stopPoints: () => stopPts, lineAt };
}

const STALE_S = 60;

/**
 * A bus marker (spec 11.4): a 26 pt rounded rectangle in the route color with a 2 pt ring, the short name in mapBadge (10 pt
 * over five characters), the bus number inside it after a thin divider when the line has 2 or more buses, and the heading
 * notch in the route color on the ring.
 */
function busIcon(color, label, num = 0) {
  const root = document.createElement('div');
  root.className = 'sb-bus';
  root.style.setProperty('--c', color);
  root.style.setProperty('--t', textOn(color));
  const hd = document.createElement('span'); hd.className = 'sb-bus-hd'; hd.setAttribute('aria-hidden', 'true');
  const tx = document.createElement('span'); tx.className = 'sb-bus-tx'; tx.textContent = label;
  if (label.length > 5) tx.classList.add('sb-bus-tx-sm');
  root.append(hd, tx);
  setNum(root, num);
  return window.L.divIcon({ className: 'sb-busicon', html: root, iconSize: [32, 26], iconAnchor: [16, 13] });
}

/** The bus number (core/busnum.js: routes with 2 or more buses) inside the marker after a divider; 0 removes it. */
function setNum(root, num) {
  let b = root.querySelector('.sb-bus-num');
  if (!num) { if (b) { b.remove(); root.dataset.w = ''; } return; }
  if (!b) { b = document.createElement('span'); b.className = 'sb-bus-num'; b.setAttribute('aria-hidden', 'true'); root.append(b); root.dataset.w = ''; }
  if (b.textContent !== String(num)) b.textContent = String(num);
}

/**
 * Where the heading notch sits from the marker's center (px): half the height pointing north or south, growing toward
 * half the width pointing east or west, so the notch never hides under a wide marker ("AP/DX | 2"; iOS does the same).
 * @param {number} w marker width
 * @param {number} h marker height
 * @param {number} deg heading
 * @returns {number}
 */
export function notchRadius(w, h, deg) {
  const a = (Number(deg) || 0) * Math.PI / 180;
  return Math.round((h / 2 + Math.max(0, w / 2 - h / 2) * Math.abs(Math.sin(a))) * 10) / 10;
}

/** A normal poll's glide (ms): about one poll interval, at constant speed, so the badge keeps moving. */
export const GLIDE_MS = 9000;
/** Bus frames are drawn once some badge has moved this far on screen (CSS px; Leaflet places badges at whole px). */
export const STEP_PX = 1;
/** A gliding badge is looked at again after travelling this far along its line (m), so its notch turns with the street. */
export const TURN_M = 4;
/** Longest sleep between two looks while buses glide (ms); waits shorter than WAKE_RAF_MS just take the next frame. */
const MAX_WAKE_MS = 1000, WAKE_RAF_MS = 40, FRAME_MS = 16;

/**
 * How long (ms) after time t the glide loop can sleep before some badge may need drawing again: the fastest badge's time
 * to move STEP_PX on screen, a badge's time to travel TURN_M along its line (its notch may turn), or the end of an
 * animation; at most MAX_WAKE_MS. Pure (2026-11-05 optimization run: the loop used to run on every display frame while
 * any bus glided, all day during service).
 * @param {Array<{t0:number, dur:number, total:number, ease:boolean, along:boolean, f:number}>} anims running moves
 * @param {number} t now (ms, the layer's clock)
 * @param {number} mPerPx meters per CSS px at the current zoom
 * @returns {number}
 */
export function nextWakeMs(anims, t, mPerPx) {
  let w = MAX_WAKE_MS;
  for (const a of anims) {
    const left = a.t0 + a.dur - t;
    if (!(left > 0)) return 0;
    w = Math.min(w, left);
    const v = (a.total / a.dur) * (a.ease ? 2 : 1);   // m per ms; an eased catch-up peaks at twice its average
    if (!(v > 0)) continue;
    if (mPerPx > 0) w = Math.min(w, (STEP_PX * mPerPx) / v);
    if (a.along && a.f > 2) w = Math.min(w, TURN_M / v);
  }
  return Math.max(0, w);
}
/** A move along the line longer than this (m), or after a gap of more than GLIDE_GAP_S, catches up quickly. */
const NORMAL_M = 350, GLIDE_GAP_S = 30;
/** Off the line, a move longer than this (m) is drawn as a jump: a straight glide would cross the blocks. */
const STRAIGHT_M = 150;
/**
 * A bus missing from a poll while other buses still report keeps its badge this long (s), so a poll that drops it does
 * not make it blink. A poll with no bus at all clears the map at once (data/live.js already held one odd empty answer),
 * so the map never shows buses while the status pill says none report.
 */
export const MISSING_S = 45;

/**
 * How long a move takes (ms) and whether it eases (a catch-up) or runs at constant speed (a normal poll).
 * @param {{along:boolean}} r map/track.js follow() result
 * @param {number} len path length (m)
 * @param {number} dt seconds since the bus's last report
 * @param {boolean} reduce prefers-reduced-motion
 * @returns {{dur:number, ease:boolean}} dur 0 = drawn there at once
 */
export function moveTiming(r, len, dt, reduce) {
  if (reduce || !(len > 0.5)) return { dur: 0, ease: false };
  if (r.along) {
    if (len <= NORMAL_M && !(dt > GLIDE_GAP_S)) return { dur: GLIDE_MS, ease: false };
    return { dur: Math.round(Math.min(2600, Math.max(900, 700 + len * 0.8))), ease: true };
  }
  return len <= STRAIGHT_M ? { dur: GLIDE_MS, ease: false } : { dur: 0, ease: false };
}

const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

/**
 * Bus layer: rounded-square badges in route color with a heading triangle, one-shot pulse on each
 * moved position, dimmed when stale (> 60 s). Heading = feed bearing, else derived from movement (busHeading);
 * focused routes get a larger arrow. Hidden routes' buses are never shown (unless that route is in focus). A bus on a
 * faded route is faded too (owner 2026-11-04; core/visibility.js busFaded: other routes in focus, or a drawn plan
 * that does not ride it; o.plan = the plan's route ids): smaller, see-through, under the other buses, and it takes no
 * tap (a tap there reaches the map, the stops and the lines in focus). The bus you ride is never faded.
 * Movement (2026-10-18, owner: smooth, never off the roads and the route lines): a report near its route's line is
 * drawn on the line and each move is animated along it (map/track.js follow; o.shapes), at constant speed over one
 * poll, or eased in about 1 to 2.5 s when it catches up after a reload or a gap in the feed; the heading turns with
 * the street. Off the line: a short straight glide, a long move jumps. Frames come from requestAnimationFrame
 * (no CSS transition on the badge), paused while Leaflet animates a zoom; prefers-reduced-motion moves at once.
 * @param {L.Map} map
 * @param {{onBusTap:(info:{id:string, rid:string, label:string})=>void}} cb
 * @param {{clock?:()=>number, frame?:(fn:Function)=>any, later?:(fn:Function, ms:number)=>any, cancel?:(id:any)=>void,
 *   reduce?:()=>boolean}} [opt] tests: a manual clock (ms), frame scheduler, timer and reduced-motion switch (defaults:
 *   performance.now, requestAnimationFrame, setTimeout / clearTimeout, the media query)
 * @returns {{draw(buses:Array, o:object):number, setYou(id):boolean, shown(id):[number,number]|null}}
 *   draw returns how many markers changed; shown = where a bus's badge is drawn now (tests)
 */
export function createBusLayer(map, cb, opt = {}) {
  const L = window.L;
  const group = L.layerGroup().addTo(map);
  const markers = new Map(); // vehicle id -> {rid, color, label, mk, s, ll, disp, to, anim, vt, seen, rot}
  let youId = null;          // the bus you ride (Current trip): ring + "You" pill on its marker
  let zooming = false, raf = 0, timer = 0;
  const clock = opt.clock || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const schedule = opt.frame || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
  const later = opt.later || ((fn, ms) => setTimeout(fn, ms)), cancel = opt.cancel || ((id) => clearTimeout(id));
  const reduce = opt.reduce || (() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  map.on('zoomstart', () => { zooming = true; });
  map.on('zoomend viewreset', () => { zooming = false; for (const m of markers.values()) m.px = null; kick(); });   // new zoom: new layer px

  /** Rotate the heading notch the short way round (unwrapDeg: never a spin across north), at its distance for the angle. */
  function turn(m, deg) {
    if (!Number.isFinite(deg)) return;
    const rot = unwrapDeg(m.rot, deg);
    if (Number.isFinite(m.rot) && Math.abs(rot - m.rot) < 2) return;
    m.rot = rot;
    const el = m.mk.getElement()?.firstElementChild, hd = el?.querySelector('.sb-bus-hd');
    if (!hd) return;
    if (!el.dataset.w) el.dataset.w = String(el.offsetWidth || 32);   // measured once per label / number change
    hd.style.transform = `rotate(${rot}deg)`;
    hd.style.setProperty('--sb-hr', notchRadius(+el.dataset.w, 26, rot) + 'px');
  }

  /** Fraction (0..1, eased) of a move done at time t. */
  function done(a, t) {
    const k = a.dur > 0 ? Math.min(1, Math.max(0, (t - a.t0) / a.dur)) : 1;
    return a.ease ? easeInOut(k) : k;
  }

  /** Where the badge is on its line now ({li, pos}), or null when it is not on the line. */
  function onLine(m, t) {
    const a = m.anim;
    if (a) return a.along ? { li: a.li, pos: advance(a.s, a.pos0, a.f * done(a, t)) } : null;
    return m.to ? { li: m.to.li, pos: m.to.pos } : null;
  }

  /* Frames are batched (2026-11-05 optimization run): a frame moves the badges only once some badge has moved at least
     STEP_PX on screen since the last drawn frame (or an animation ends), and then it moves all of them. Leaflet draws a
     badge at whole CSS px anyway, so nothing looks different, but a normal glide (2 to 4 px a second at the default zoom)
     no longer gives every bus its own redraw: one redraw per pixel of the fastest bus instead of one per pixel of each
     bus. Every redraw repaints the blurred glass over the map, so this is most of the idle GPU work. Between looks the
     loop sleeps until a badge can next need drawing (nextWakeMs) instead of running on every display frame. */
  function frame() {
    raf = 0;
    const t = clock();
    let more = false, due = false;
    const moves = [];
    for (const m of markers.values()) {
      const a = m.anim;
      if (!a) continue;
      if (zooming) { more = true; continue; }
      const e = done(a, t);
      const p = pointAt(a.path, a.cum, e * a.total);
      const hd = a.along && a.f > 2 ? headingAt(a.s, advance(a.s, a.pos0, a.f * e)) : NaN;
      moves.push([m, a, e, p, hd]);
      // due: an animation ends, a badge moved a pixel, or its heading notch has to turn (a corner seen zoomed out)
      if (!due) due = e >= 1 || movedPx(m, p) >= STEP_PX || (Number.isFinite(hd) && Number.isFinite(m.rot) && Math.abs(unwrapDeg(m.rot, hd) - m.rot) >= 2);
    }
    if (due) {
      for (const [m, a, e, p, hd] of moves) {
        m.mk.setLatLng(p);
        m.disp = p;
        m.px = layerPx(p);
        if (Number.isFinite(hd)) turn(m, hd);
        if (e >= 1) { m.anim = null; if (Number.isFinite(a.endHd)) turn(m, a.endHd); } else more = true;
      }
    } else if (moves.length) more = true;
    if (more) wake(zooming ? 0 : nextWakeMs([...markers.values()].map((m) => m.anim).filter(Boolean), t, mPerPx()));
  }
  /** The next look at the gliding badges: the next frame, or a timer and then a frame. */
  function wake(ms) {
    if (!schedule) return;
    if (ms <= WAKE_RAF_MS) { raf = schedule(frame) || 1; return; }
    raf = 0;
    timer = later(() => { timer = 0; if (!raf) raf = schedule(frame) || 1; }, ms - FRAME_MS) || 1;
  }
  /** Meters per CSS px at the map's zoom and latitude (0 when the map cannot say). */
  function mPerPx() {
    try { return 40075016.686 * Math.cos(map.getCenter().lat * Math.PI / 180) / 2 ** (map.getZoom() + 8); } catch (e) { return 0; }
  }
  /** The badge's screen position (px at the current zoom, not rounded: latLngToLayerPoint rounds) for a lat/lon; null when
      the map cannot say. */
  function layerPx(p) {
    try { const q = map.project(p); return Number.isFinite(q.x) && Number.isFinite(q.y) ? q : null; } catch (e) { return null; }
  }
  /** How far (px) a badge would move from where the last frame drew it; Infinity when unknown (draw it). */
  function movedPx(m, p) {
    const q = m.px && layerPx(p);
    return q ? Math.max(Math.abs(q.x - m.px.x), Math.abs(q.y - m.px.y)) : Infinity;
  }

  function kick() {
    if (timer) { cancel(timer); timer = 0; }   // a new move or a new zoom: look now, not after the sleep
    if (raf || !schedule) return;
    for (const m of markers.values()) if (m.anim) { raf = schedule(frame) || 1; return; }
  }

  /**
   * Move a badge to a new report: on its line when near it, along the line when it continues there.
   * @returns {[number, number]} where it will be drawn
   */
  function moveTo(m, prep, pt, feedBrg, brg, dt) {
    const t = clock(), from = onLine(m, t);
    const r = follow(prep, from, m.disp || m.ll, pt, { bearing: feedBrg, dt });
    const target = r.to ? r.to.pt : pt;
    const cum = pathCum(r.path), total = cum[cum.length - 1] || 0;
    const { dur, ease } = moveTiming(r, total, dt, reduce());
    const endHd = r.along && r.f > 2 ? headingAt(prep[r.to.li], r.to.pos) : brg;
    m.to = r.to;
    m.px = null;   // the next frame draws it (a new move starts from where it is)
    if (!dur) {
      m.anim = null;
      m.mk.setLatLng(target);
      m.disp = target;
      turn(m, endHd);
      return target;
    }
    m.anim = { path: r.path, cum, total, t0: t, dur, ease, along: r.along, f: r.f, endHd,
      li: r.to ? r.to.li : -1, s: r.to ? prep[r.to.li] : null, pos0: r.along && from ? from.pos : 0 };
    if (!r.along) turn(m, endHd);
    kick();
    return target;
  }

  /** Faded (busFaded, never the bus you ride): its look, no taps, under the other buses. */
  function dress(m) {
    const faded = !!m.faded && m.key !== youId;
    m.mk.setZIndexOffset(m.sel ? 650 : m.key === youId ? 700 : faded ? 300 : 500);
    const icon = m.mk.getElement();
    if (icon) { icon.classList.toggle('is-faded', faded); icon.firstElementChild?.classList.toggle('is-faded', faded); }
  }

  /** Mark (or unmark) a bus marker as the one you are on: it moves with the bus, glide included. */
  function markYou(m, on) {
    const el = m.mk.getElement()?.firstElementChild;
    dress(m);
    if (!el) return;
    el.classList.toggle('is-you', on);
    const ring = el.querySelector('.sb-you-ring');
    if (on && !ring) {
      const r = document.createElement('span'); r.className = 'sb-you-ring'; r.setAttribute('aria-hidden', 'true');
      const t = document.createElement('span'); t.className = 'sb-you-pill'; t.textContent = 'You';
      el.append(r, t);
    } else if (!on && ring) { ring.remove(); el.querySelector('.sb-you-pill')?.remove(); }
    nameMarker(m);
  }

  /** The marker's name: "Bus 2, Red Line/Arts Block" when its route shows several buses, else "Route RED bus". */
  function nameMarker(m) {
    const base = m.num ? `Bus ${m.num}, ${m.name}` : `Route ${m.label} bus`;
    const text = m.key === youId ? `You are on this bus: ${base}` : base;
    const el = m.mk.getElement();
    if (el) { el.setAttribute('title', text); el.setAttribute('aria-label', text); }
  }

  /** The bus you are on (vehicle id) or null. @returns {boolean} that bus is drawn */
  function setYou(id) {
    const k = id == null ? null : String(id);
    if (k !== youId) {
      const old = youId != null ? markers.get(youId) : null;
      youId = k;   // first: the old marker's name and fade read it
      if (old) markYou(old, false);
      const m = k != null ? markers.get(k) : null;
      if (m) markYou(m, true);
    }
    return k != null && markers.has(k);
  }

  function draw(buses, o = {}) {
    const now = o.nowS ?? Date.now() / 1000;
    const hidden = new Set((o.hidden || []).map(String)), focus = focusSet(o.focus);
    const plan = Array.isArray(o.plan) ? o.plan : null;
    const nums = busNumbers(buses), sel = o.selected != null ? String(o.selected) : null;
    const seen = new Set(), listed = new Set();
    let changed = 0;
    for (const v of buses || []) {
      const id = busKey(v);
      const rid = String(v?.trip?.route_id ?? '');
      const lat = +v?.position?.latitude, lon = +v?.position?.longitude;
      if (id == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      listed.add(String(id));
      if (hidden.has(rid) && !focus?.has(rid)) continue;   // never a hidden route's bus; other routes in focus: faded
      const key = String(id);
      seen.add(key);
      const color = safeColor(o.routes?.[rid]?.color), label = routeLabel(rid, o.routes);
      let m = markers.get(key);
      const feed = v.position.bearing == null || v.position.bearing === '' ? NaN : +v.position.bearing;
      const brg = busHeading(feed, m && m.rid === rid ? m.ll : null, [lat, lon], m ? m.brg : NaN, (a, b) => map.distance(a, b));
      const stale = v.timestamp ? now - v.timestamp > STALE_S : false;
      const focused = !!focus?.has(rid), faded = busFaded(rid, o.focus, plan);
      const num = nums.get(key) || 0, picked = key === sel;
      const name = o.routes?.[rid]?.long || o.routes?.[rid]?.short || label;
      const s = busSig(rid, lat, lon, brg, stale, label, color, focused, num, picked, faded);
      if (m && m.s === s) continue;
      changed++;
      const prep = prepareShape(o.shapes?.[rid]);
      const vt = Number.isFinite(+v.timestamp) && +v.timestamp > 0 ? +v.timestamp : NaN;
      let moved = false;
      if (!m || m.rid !== rid || m.color !== color || m.label !== label) {
        if (m) group.removeLayer(m.mk);
        const r0 = follow(prep, null, null, [lat, lon], { bearing: feed });   // a new badge starts on its line
        const start = r0.to ? r0.to.pt : [lat, lon];
        const mk = L.marker(start, { icon: busIcon(color, label, num), zIndexOffset: 500, keyboard: false,
          title: num ? `Bus ${num}, ${name}` : `Route ${label} bus`, riseOnHover: true });
        const info = { id: key, rid, label: v.vehicle?.label != null ? String(v.vehicle.label) : '' };
        mk.on('click', () => cb.onBusTap(info));
        mk.addTo(group);
        m = { key, rid, color, label, name, num, sel: false, faded: false, mk, s: '', ll: [lat, lon], brg: NaN, disp: start, to: r0.to, anim: null, vt, seen: now, rot: NaN };
        markers.set(key, m);
        if (key === youId) markYou(m, true);
        nameMarker(m);
        // no feed heading: the line's own direction (shapes run the way the buses drive)
        turn(m, Number.isFinite(brg) ? brg : r0.to ? headingAt(prep[r0.to.li], r0.to.pos) : NaN);
        moved = true;
      } else if (m.ll[0] !== lat || m.ll[1] !== lon) {
        const dt = Number.isFinite(vt) && Number.isFinite(m.vt) ? vt - m.vt : now - (m.seen ?? now);
        moveTo(m, prep, [lat, lon], feed, brg, dt);
        moved = true;
      } else if (!m.anim) {
        turn(m, brg);
      }
      m.ll = [lat, lon]; m.s = s; m.brg = brg; m.seen = now;
      if (Number.isFinite(vt)) m.vt = vt;
      const el = m.mk.getElement()?.firstElementChild;
      if (m.num !== num || m.name !== name) { m.num = num; m.name = name; if (el) { setNum(el, num); const r = m.rot; m.rot = NaN; turn(m, r); } nameMarker(m); }
      if (m.sel !== picked || m.faded !== faded) { m.sel = picked; m.faded = faded; dress(m); }
      if (el) {
        el.classList.toggle('is-picked', picked);
        el.classList.toggle('is-stale', stale);
        el.classList.toggle('no-hd', !Number.isFinite(m.rot));
        el.classList.toggle('is-focus', focused);
      }
    }
    for (const [key, m] of markers) {
      if (seen.has(key)) { m.gone = null; continue; }
      // not in this poll while others are (not hidden by the rider): keep it where it is for MISSING_S, then remove it
      if (!listed.has(key) && listed.size) {
        if (m.gone == null) m.gone = now;
        if (now - m.gone <= MISSING_S) continue;
      }
      group.removeLayer(m.mk); markers.delete(key); changed++;
    }
    return changed;
  }

  /** Where a bus's badge is drawn now (vehicle id), or null. */
  function shown(id) {
    const m = markers.get(String(id));
    if (!m) return null;
    const p = m.mk.getLatLng();
    return [p.lat, p.lng];
  }
  return { draw, setYou, shown };
}

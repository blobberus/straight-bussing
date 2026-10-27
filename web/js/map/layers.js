/**
 * map/layers.js: route network (casing + colored lines, stops with 44 px tap halos) and live bus
 * markers. Every redraw is gated by a cheap signature so 10 s polling never repaints static layers;
 * bus markers are updated in place (setLatLng + class toggles) and recreated only when a bus changes
 * route. The pure helpers (idOf, sig, networkSig, busSig, lineWeight, routeLabel, focusSet) do not touch
 * Leaflet, so this module can be imported without `L` for unit tests.
 * Lines stack by `order` (index 0 on top); focused routes always above unfocused ones.
 */
import { safeColor, textOn } from '../core/esc.js';
import { bearing as geoBearing } from '../core/geo.js';
import { createChevronLayer, orientedLines } from './chevrons.js';
import { lineAt as pickLine, LINE_TAP_PX } from './geometry.js';
import { unwrapDeg } from './geometry.js';
import { prepareShape, follow, pathCum, pointAt, advance, headingAt } from './track.js';

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
 * Per-marker signature for a bus (position, heading, stale, label, color, focused).
 * @returns {string}
 */
export function busSig(rid, lat, lon, bearing, stale, label, color, focused = false) {
  return sig(rid, lat.toFixed(6), lon.toFixed(6), Number.isFinite(bearing) ? Math.round(bearing) : '', stale ? 1 : 0, label, color,
    focused ? 1 : 0);
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
 * Route line weight in px for a zoom level (4 at z13, 5 at z15, 6 at z17).
 * @param {number} z
 * @returns {number}
 */
export function lineWeight(z) {
  return Math.max(3.5, Math.min(6.5, 4 + (z - 13) * 0.5));
}

/**
 * Short badge label for a route: GTFS short name, else initials of the long name (max 3 chars).
 * @param {string} rid
 * @param {object} routes
 * @returns {string}
 */
export function routeLabel(rid, routes) {
  const r = routes?.[rid] || {};
  const s = String(r.short || '').trim();
  if (s) return s.slice(0, 4);
  const words = String(r.long || '').split(/[\s/&-]+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0][0] : words.map((w) => w[0]).join('')).toUpperCase().slice(0, 3);
}

/**
 * Network layer: route lines in two panes (unfocused, focused above), each route's casings drawn
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
  let last = '', polys = [], stopPts = [], hits = [];   // hits: drawn route lines, bottom to top: {rid, ll, bounds}
  const showStops = () => {
    const on = map.getZoom() >= 14;
    if (on && !map.hasLayer(stopsG)) stopsG.addTo(map);
    else if (!on && map.hasLayer(stopsG)) map.removeLayer(stopsG);
  };

  function draw(o, dimAll = false) {
    const s = networkSig(o, dimAll);
    if (s === last) return false;
    last = s;
    lines.clearLayers(); stopsG.clearLayers(); polys = []; stopPts = []; hits = [];
    const routes = o.routes || {}, shapes = o.shapes || {}, hidden = new Set((o.hidden || []).map(String));
    const focus = focusSet(o.focus);
    const w = lineWeight(map.getZoom());
    const { back, front: fronts } = stackOrder(Object.keys(shapes), o);
    for (const rid of [...back, ...fronts]) {
      const front = !!focus?.has(rid), dim = dimAll || (focus && !front);
      const color = safeColor(routes[rid]?.color), pane = front ? 'sbFocusLines' : 'sbLines';
      const segs = (shapes[rid] || []).filter((pts) => pts && pts.length >= 2);
      // all of a route's casings, then its lines: its own segments never cut each other, and it
      // covers every route below it in the same pane
      const casings = segs.map((pts) => L.polyline(pts, { pane, className: 'sb-casing', weight: w + 3,
        opacity: dim ? 0.2 : 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(lines));
      segs.forEach((pts, i) => {
        const line = L.polyline(pts, { pane, className: 'sb-route', color, weight: w,
          opacity: dim ? 0.25 : 0.92, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(lines);
        polys.push({ casing: casings[i], line, extra: 3 });
        hits.push({ rid, ll: pts, bounds: L.latLngBounds(pts) });
      });
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
      L.circleMarker(ll, { pane: 'sbStops', radius: 5, weight: 2.5, color: single ? safeColor(routes[rs[0]]?.color) : '#5c5c63',
        className: single ? 'sb-stop' : 'sb-stop sb-stop-multi', opacity: dimAll ? 0.4 : 1, fillOpacity: dimAll ? 0.4 : 1, interactive: false }).addTo(stopsG);
      L.circleMarker(ll, { pane: 'sbStops', radius: 22, stroke: false, fillOpacity: 0, className: 'sb-halo', bubblingMouseEvents: false })
        .on('click', () => cb.onStopTap(id)).addTo(stopsG);
    }
    showStops();
    return true;
  }

  function restyle() {
    const w = lineWeight(map.getZoom());
    for (const p of polys) { p.line.setStyle({ weight: w }); p.casing.setStyle({ weight: w + p.extra }); }
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
    const width = lineWeight(map.getZoom()) + 3, reach = LINE_TAP_PX + width;   // drawn width = the casing
    const near = L.latLngBounds(map.containerPointToLatLng([p.x - reach, p.y + reach]), map.containerPointToLatLng([p.x + reach, p.y - reach]));
    const toPx = (ll) => { const c = map.latLngToContainerPoint(ll); return [c.x, c.y]; };
    const lines = hits.filter((h) => h.bounds.intersects(near)).map((h) => ({ rid: h.rid, px: h.ll.map(toPx), width }));
    return pickLine([p.x, p.y], lines);
  }
  return { draw, restyle, chevrons: () => chev.count(), stopPoints: () => stopPts, lineAt };
}

const STALE_S = 60;

function busIcon(color, label) {
  const root = document.createElement('div');
  root.className = 'sb-bus';
  root.style.setProperty('--c', color);
  root.style.setProperty('--t', textOn(color));
  const hd = document.createElement('span'); hd.className = 'sb-bus-hd'; hd.setAttribute('aria-hidden', 'true');
  const tx = document.createElement('span'); tx.className = 'sb-bus-tx'; tx.textContent = label;
  if (label.length > 3) tx.classList.add('sb-bus-tx-sm');
  root.append(hd, tx);
  return window.L.divIcon({ className: 'sb-busicon', html: root, iconSize: [28, 28], iconAnchor: [14, 14] });
}

/** Restart the one-shot pulse ring (CSS animation) on a fresh position. */
function pulse(el) {
  el.classList.remove('sb-pulse');
  void el.offsetWidth; // reflow so the animation restarts
  el.classList.add('sb-pulse');
}

/** A normal poll's glide (ms): about one poll interval, at constant speed, so the badge keeps moving. */
export const GLIDE_MS = 9000;
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
 * focused routes get a larger arrow. Non-focused routes' buses are not shown while a focus is set; hidden routes
 * never are.
 * Movement (2026-10-18, owner: smooth, never off the roads and the route lines): a report near its route's line is
 * drawn on the line and each move is animated along it (map/track.js follow; o.shapes), at constant speed over one
 * poll, or eased in about 1 to 2.5 s when it catches up after a reload or a gap in the feed; the heading turns with
 * the street. Off the line: a short straight glide, a long move jumps. Frames come from requestAnimationFrame
 * (no CSS transition on the badge), paused while Leaflet animates a zoom; prefers-reduced-motion moves at once.
 * @param {L.Map} map
 * @param {{onBusTap:(info:{id:string, rid:string, label:string})=>void}} cb
 * @param {{clock?:()=>number, frame?:(fn:Function)=>any, reduce?:()=>boolean}} [opt] tests: a manual clock (ms),
 *   frame scheduler and reduced-motion switch (defaults: performance.now, requestAnimationFrame, the media query)
 * @returns {{draw(buses:Array, o:object):number, setYou(id):boolean, shown(id):[number,number]|null}}
 *   draw returns how many markers changed; shown = where a bus's badge is drawn now (tests)
 */
export function createBusLayer(map, cb, opt = {}) {
  const L = window.L;
  const group = L.layerGroup().addTo(map);
  const markers = new Map(); // vehicle id -> {rid, color, label, mk, s, ll, disp, to, anim, vt, seen, rot}
  let youId = null;          // the bus you ride (Current trip): ring + "You" pill on its marker
  let zooming = false, raf = 0;
  const clock = opt.clock || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const schedule = opt.frame || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
  const reduce = opt.reduce || (() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  map.on('zoomstart', () => { zooming = true; });
  map.on('zoomend', () => { zooming = false; kick(); });

  /** Rotate the heading triangle the short way round (unwrapDeg: never a spin across north). */
  function turn(m, deg) {
    if (!Number.isFinite(deg)) return;
    const rot = unwrapDeg(m.rot, deg);
    if (Number.isFinite(m.rot) && Math.abs(rot - m.rot) < 2) return;
    m.rot = rot;
    const hd = m.mk.getElement()?.querySelector('.sb-bus-hd');
    if (hd) hd.style.transform = `rotate(${rot}deg)`;
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

  function frame() {
    raf = 0;
    const t = clock();
    let more = false;
    for (const m of markers.values()) {
      const a = m.anim;
      if (!a) continue;
      const e = done(a, t);
      if (!zooming) {
        const p = pointAt(a.path, a.cum, e * a.total);
        m.mk.setLatLng(p);
        m.disp = p;
        if (a.along && a.f > 2) turn(m, headingAt(a.s, advance(a.s, a.pos0, a.f * e)));
      }
      if (e >= 1 && !zooming) { m.anim = null; if (Number.isFinite(a.endHd)) turn(m, a.endHd); } else more = true;
    }
    if (more) raf = schedule(frame) || 1;
  }

  function kick() {
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

  /** Mark (or unmark) a bus marker as the one you are on: it moves with the bus, glide included. */
  function markYou(m, on) {
    const el = m.mk.getElement()?.firstElementChild;
    m.mk.setZIndexOffset(on ? 700 : 500);
    if (!el) return;
    el.classList.toggle('is-you', on);
    const ring = el.querySelector('.sb-you-ring');
    if (on && !ring) {
      const r = document.createElement('span'); r.className = 'sb-you-ring'; r.setAttribute('aria-hidden', 'true');
      const t = document.createElement('span'); t.className = 'sb-you-pill'; t.textContent = 'You';
      el.append(r, t);
    } else if (!on && ring) { ring.remove(); el.querySelector('.sb-you-pill')?.remove(); }
    m.mk.getElement()?.setAttribute('title', on ? `You are on this Route ${m.label} bus` : `Route ${m.label} bus`);
  }

  /** The bus you are on (vehicle id) or null. @returns {boolean} that bus is drawn */
  function setYou(id) {
    const k = id == null ? null : String(id);
    if (k !== youId) {
      const old = youId != null ? markers.get(youId) : null;
      if (old) markYou(old, false);
      youId = k;
      const m = k != null ? markers.get(k) : null;
      if (m) markYou(m, true);
    }
    return k != null && markers.has(k);
  }

  function draw(buses, o = {}) {
    const now = o.nowS ?? Date.now() / 1000;
    const hidden = new Set((o.hidden || []).map(String)), focus = focusSet(o.focus);
    const seen = new Set(), listed = new Set();
    let changed = 0;
    for (const v of buses || []) {
      const id = v?.vehicle?.id ?? v?.vehicle?.label;
      const rid = String(v?.trip?.route_id ?? '');
      const lat = +v?.position?.latitude, lon = +v?.position?.longitude;
      if (id == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      listed.add(String(id));
      if (focus ? !focus.has(rid) : hidden.has(rid)) continue;
      const key = String(id);
      seen.add(key);
      const color = safeColor(o.routes?.[rid]?.color), label = routeLabel(rid, o.routes);
      let m = markers.get(key);
      const feed = v.position.bearing == null || v.position.bearing === '' ? NaN : +v.position.bearing;
      const brg = busHeading(feed, m && m.rid === rid ? m.ll : null, [lat, lon], m ? m.brg : NaN, (a, b) => map.distance(a, b));
      const stale = v.timestamp ? now - v.timestamp > STALE_S : false;
      const focused = !!focus?.has(rid);
      const s = busSig(rid, lat, lon, brg, stale, label, color, focused);
      if (m && m.s === s) continue;
      changed++;
      const prep = prepareShape(o.shapes?.[rid]);
      const vt = Number.isFinite(+v.timestamp) && +v.timestamp > 0 ? +v.timestamp : NaN;
      let moved = false;
      if (!m || m.rid !== rid || m.color !== color || m.label !== label) {
        if (m) group.removeLayer(m.mk);
        const r0 = follow(prep, null, null, [lat, lon], { bearing: feed });   // a new badge starts on its line
        const start = r0.to ? r0.to.pt : [lat, lon];
        const mk = L.marker(start, { icon: busIcon(color, label), zIndexOffset: 500, keyboard: false,
          title: `Route ${label} bus`, riseOnHover: true });
        const info = { id: key, rid, label: v.vehicle?.label != null ? String(v.vehicle.label) : '' };
        mk.on('click', () => cb.onBusTap(info));
        mk.addTo(group);
        m = { rid, color, label, mk, s: '', ll: [lat, lon], brg: NaN, disp: start, to: r0.to, anim: null, vt, seen: now, rot: NaN };
        markers.set(key, m);
        if (key === youId) markYou(m, true);
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
      if (el) {
        el.classList.toggle('is-stale', stale);
        el.classList.toggle('no-hd', !Number.isFinite(m.rot));
        el.classList.toggle('is-focus', focused);
        if (moved && !stale) pulse(el);
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

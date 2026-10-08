/**
 * map/layers.js: route network (casing + colored lines, stops with 44 px tap halos) and live bus
 * markers. Every redraw is gated by a cheap signature so 10 s polling never repaints static layers;
 * bus markers are updated in place (setLatLng + class toggles) and recreated only when a bus changes
 * route. The pure helpers (idOf, sig, networkSig, busSig, lineWeight, routeLabel, focusSet) do not touch
 * Leaflet, so this module can be imported without `L` for unit tests.
 */
import { safeColor, textOn } from '../core/esc.js';

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
 * Signature of everything drawNetwork depends on (identity + sizes of static data, hidden, focus, dim).
 * @param {{routes, shapes, routeStops, stopRoutes, stops, hidden?:string[], focus?:string[]|null}} o
 * @param {boolean} [dimAll] true while a trip plan is shown
 * @returns {string}
 */
export function networkSig(o, dimAll = false) {
  const f = focusSet(o.focus);
  return sig(idOf(o.routes), size(o.routes), idOf(o.shapes), size(o.shapes), idOf(o.stopRoutes), size(o.stopRoutes),
    idOf(o.stops), size(o.stops), [...(o.hidden || [])].map(String).sort(), f ? [...f].sort() : '', dimAll ? 1 : 0);
}

/**
 * Per-marker signature for a bus (position, heading, stale, label, color).
 * @returns {string}
 */
export function busSig(rid, lat, lon, bearing, stale, label, color) {
  return sig(rid, lat.toFixed(6), lon.toFixed(6), Number.isFinite(bearing) ? Math.round(bearing) : '', stale ? 1 : 0, label, color);
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
 * Network layer: route lines in four panes (casing/lines, focus casing/focus lines so the focused
 * route draws last), stops in their own group shown at zoom >= 14.
 * @param {L.Map} map
 * @param {{onStopTap:(id:string)=>void}} cb
 * @returns {{draw(o:object, dimAll?:boolean):boolean, restyle():void}}
 */
export function createNetworkLayer(map, cb) {
  const L = window.L;
  const lines = L.layerGroup().addTo(map);
  const stopsG = L.layerGroup();
  let last = '', polys = [];
  const showStops = () => {
    const on = map.getZoom() >= 14;
    if (on && !map.hasLayer(stopsG)) stopsG.addTo(map);
    else if (!on && map.hasLayer(stopsG)) map.removeLayer(stopsG);
  };

  function draw(o, dimAll = false) {
    const s = networkSig(o, dimAll);
    if (s === last) return false;
    last = s;
    lines.clearLayers(); stopsG.clearLayers(); polys = [];
    const routes = o.routes || {}, shapes = o.shapes || {}, hidden = new Set((o.hidden || []).map(String));
    const focus = focusSet(o.focus);
    const w = lineWeight(map.getZoom());
    const order = Object.keys(shapes).filter((rid) => !hidden.has(rid) || focus?.has(rid))
      .sort((a, b) => (focus ? (focus.has(a) ? 1 : 0) - (focus.has(b) ? 1 : 0) : 0));
    for (const rid of order) {
      const front = !!focus?.has(rid), dim = dimAll || (focus && !front);
      const color = safeColor(routes[rid]?.color);
      for (const pts of shapes[rid] || []) {
        if (!pts || pts.length < 2) continue;
        const casing = L.polyline(pts, { pane: front ? 'sbFocusCasing' : 'sbCasing', className: 'sb-casing', weight: w + 3,
          opacity: dim ? 0.2 : 1, lineCap: 'round', lineJoin: 'round', interactive: false });
        const line = L.polyline(pts, { pane: front ? 'sbFocusLines' : 'sbLines', className: 'sb-route', color, weight: w,
          opacity: dim ? 0.25 : 0.92, lineCap: 'round', lineJoin: 'round', interactive: false });
        casing.addTo(lines); line.addTo(lines);
        polys.push({ casing, line, extra: 3 });
      }
    }
    // stops: served by a visible route (only focus routes when focused)
    for (const [id, st] of Object.entries(o.stops || {})) {
      const rs = (o.stopRoutes?.[id] || []).map(String).filter((r) => (focus ? focus.has(r) : !hidden.has(r)));
      if (!rs.length || !Number.isFinite(st?.lat) || !Number.isFinite(st?.lon)) continue;
      const single = new Set(rs).size === 1;
      const ll = [st.lat, st.lon];
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
  }
  return { draw, restyle };
}

const STALE_S = 60;
const SNAP_M = 800;

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

/**
 * Bus layer: rounded-square badges in route color with a heading triangle, one-shot pulse on each
 * moved position, dimmed when stale (> 60 s). Glide is CSS (map.css) and disabled while zooming.
 * Non-focused routes' buses are not shown while a focus is set; hidden routes never are.
 * @param {L.Map} map
 * @param {{onBusTap:(info:{id:string, rid:string, label:string})=>void}} cb
 * @returns {{draw(buses:Array, o:object):number}} draw returns how many markers changed
 */
export function createBusLayer(map, cb) {
  const L = window.L;
  const group = L.layerGroup().addTo(map);
  const markers = new Map(); // vehicle id -> {rid, color, label, mk, s, ll}

  function draw(buses, o = {}) {
    const now = o.nowS ?? Date.now() / 1000;
    const hidden = new Set((o.hidden || []).map(String)), focus = focusSet(o.focus);
    const seen = new Set();
    let changed = 0;
    for (const v of buses || []) {
      const id = v?.vehicle?.id ?? v?.vehicle?.label;
      const rid = String(v?.trip?.route_id ?? '');
      const lat = +v?.position?.latitude, lon = +v?.position?.longitude;
      if (id == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (focus ? !focus.has(rid) : hidden.has(rid)) continue;
      const key = String(id);
      seen.add(key);
      const color = safeColor(o.routes?.[rid]?.color), label = routeLabel(rid, o.routes);
      const brg = v.position.bearing == null ? NaN : +v.position.bearing;
      const stale = v.timestamp ? now - v.timestamp > STALE_S : false;
      const s = busSig(rid, lat, lon, brg, stale, label, color);
      let m = markers.get(key);
      if (m && m.s === s) continue;
      changed++;
      if (!m || m.rid !== rid || m.color !== color || m.label !== label) {
        if (m) group.removeLayer(m.mk);
        const mk = L.marker([lat, lon], { icon: busIcon(color, label), zIndexOffset: 500, keyboard: false,
          title: `Route ${label} bus`, riseOnHover: true });
        const info = { id: key, rid, label: v.vehicle?.label != null ? String(v.vehicle.label) : '' };
        mk.on('click', () => cb.onBusTap(info));
        mk.addTo(group);
        m = { rid, color, label, mk, s: '', ll: [lat, lon] };
        markers.set(key, m);
      } else if (m.ll[0] !== lat || m.ll[1] !== lon) {
        const icon = m.mk.getElement();
        const jump = map.distance(m.ll, [lat, lon]) > SNAP_M;
        if (jump && icon) icon.classList.add('sb-snap');
        m.mk.setLatLng([lat, lon]);
        if (jump && icon) requestAnimationFrame(() => requestAnimationFrame(() => icon.classList.remove('sb-snap')));
      }
      const moved = m.ll[0] !== lat || m.ll[1] !== lon || !m.s;
      m.ll = [lat, lon]; m.s = s;
      const el = m.mk.getElement()?.firstElementChild;
      if (el) {
        el.classList.toggle('is-stale', stale);
        el.classList.toggle('no-hd', !Number.isFinite(brg));
        const hd = el.querySelector('.sb-bus-hd');
        if (hd && Number.isFinite(brg)) hd.style.transform = `rotate(${brg}deg)`;
        if (moved && !stale) pulse(el);
      }
    }
    for (const [key, m] of markers) {
      if (!seen.has(key)) { group.removeLayer(m.mk); markers.delete(key); changed++; }
    }
    return changed;
  }
  return { draw };
}

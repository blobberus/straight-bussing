/**
 * map/map.js: the MapApi (see docs/ARCHITECTURE.md "Map layer"). Leaflet map with a patched
 * OpenFreeMap basemap (map/style.js), route network + buses (map/layers.js), favorite stations
 * (map/favorites.js), selected stop, user dot,
 * stop highlights and trip plans. Every method is idempotent and cheap to call on each poll: layers
 * redraw only when their signature changes. Theme colors for overlays come from CSS (css/map.css)
 * keyed on the `.sb-dark` class this module toggles on the map element.
 */
import { createBasemap } from './style.js';
import { createNetworkLayer, createBusLayer, sig } from './layers.js';
import { createFavoritesLayer } from './favorites.js';
import { alongShape, normLatLngs, toLatLng } from './geometry.js';
import { safeColor } from '../core/esc.js';

const CAMPUS = [41.7897, -87.5997];
const PAD = 24;           // side padding for fits
const TOP_PAD = 132;      // clears the floating search bar, the attribution line and the locate button / chips
const PANES = { sbCasing: 380, sbLines: 390, sbFocusCasing: 392, sbFocusLines: 394, sbPlanCasing: 400, sbPlan: 402,
  sbStops: 420, sbPlanStops: 425, sbHighlight: 430, sbSel: 440 };
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function hub() {
  const fns = new Set();
  return { on(fn) { if (typeof fn === 'function') fns.add(fn); return () => fns.delete(fn); },
    emit(x) { for (const fn of fns) { try { fn(x); } catch (e) { console.error(e); } } } };
}

/** Signature of a plan option (legs, ids, geometry sizes). */
function planSig(o) {
  if (!o) return '';
  const legs = (o.legs || []).map((l) => (l.type === 'bus'
    ? sig('b', l.rid, l.board?.id, l.alight?.id, (l.path || []).length)
    : sig('w', l.from?.lat, l.from?.lon, l.to?.lat, l.to?.lon, (l.coords || []).length, l.coords?.[1]?.[0])));
  return sig(o.key, legs.join(';'), o.from?.lat, o.from?.lon, o.to?.lat, o.to?.lon, (o.coords || []).length);
}

/**
 * Create the map inside element `elId`.
 * @param {string} elId
 * @returns {object} MapApi: setTheme, setBottomInset, drawNetwork, drawBuses, setSelectedStop, drawFavorites,
 *   setUser, highlightStops, drawPlan, fitTo, flyTo, onStopTap, onBusTap, onUserMove (+ `leaflet` escape hatch)
 */
export function createMap(elId) {
  const L = window.L;
  const el = document.getElementById(elId);
  el.classList.add('sb-map');
  const map = L.map(el, { zoomControl: false, attributionControl: false, minZoom: 11, maxZoom: 18, zoomSnap: 0.25,
    zoomDelta: 0.5, wheelPxPerZoomLevel: 90, tapTolerance: 15 }).setView(CAMPUS, 15);
  map.attributionControl = L.control.attribution({ position: 'topleft', prefix: false }).addTo(map);
  for (const [name, z] of Object.entries(PANES)) map.createPane(name).style.zIndex = String(z);

  let dark = false, inset = 0, progUntil = 0, lastNet = null, planActive = false;
  const stopTap = hub(), busTap = hub(), userMove = hub();
  const basemap = createBasemap(map, dark);
  const network = createNetworkLayer(map, { onStopTap: (id) => stopTap.emit(id) });
  const buses = createBusLayer(map, { onBusTap: (info) => busTap.emit(info) });
  const favs = createFavoritesLayer(map, { onStopTap: (id) => stopTap.emit(id) });
  const selG = L.layerGroup().addTo(map), hlG = L.layerGroup().addTo(map), planG = L.layerGroup().addTo(map);
  let selSig = '', selStop = null, hlSig = '', planS = null, planPts = [], hlPick = null, me = null, meAcc = null;

  /** (Re)draw the selection ring; a favorite gets a wider, unfilled ring around its star badge. */
  function renderSel() {
    const stop = selStop, ll = toLatLng(stop);
    const fav = !!ll && favs.has(stop.id);
    const s = ll ? sig(stop.id, ll[0], ll[1], stop.name, fav ? 1 : 0) : '';
    favs.setSelected(ll ? stop.id : null);
    if (s === selSig) return;
    selSig = s;
    selG.clearLayers();
    if (!ll) return;
    const m = L.circleMarker(ll, { pane: 'sbSel', radius: fav ? 15 : 8, weight: 3, className: fav ? 'sb-sel sb-sel-fav' : 'sb-sel',
      fillOpacity: fav ? 0 : 1, interactive: false });
    if (stop.name) m.bindTooltip(String(stop.name), { permanent: true, direction: 'top', offset: [0, fav ? -17 : -10], className: 'sb-sel-label' });
    m.addTo(selG);
  }

  // glide off while zooming (and two frames after, so the zoom jump never transitions)
  map.on('zoomstart', () => {
    el.classList.add('sb-zooming');
    if (performance.now() > progUntil) userMove.emit(center());
  });
  map.on('zoomend', () => {
    network.restyle();
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('sb-zooming')));
  });
  map.on('dragstart', () => userMove.emit(center()));

  function center() { const c = map.getCenter(); return { lat: c.lat, lon: c.lng, zoom: map.getZoom() }; }
  const visibleH = () => Math.max(120, map.getSize().y - inset);

  const api = {
    /** Leaflet map (escape hatch; prefer the API). */
    leaflet: map,

    /** Swap basemap style + overlay colors. Never recreates the map. @param {boolean} isDark */
    setTheme(isDark) {
      const d = !!isDark;
      el.classList.toggle('sb-dark', d);
      if (d === dark) return;
      dark = d;
      basemap.setDark(d);
    },

    /** Height in px of the sheet covering the bottom of the map; fits/flies keep targets above it. @param {number} px */
    setBottomInset(px) {
      const v = Math.max(0, Math.round(+px || 0));
      inset = Math.min(v, Math.max(0, map.getSize().y - 160));
    },

    /**
     * Route lines + stops. Redraws only when inputs change (identity/size of static data, hidden, focus).
     * focus null/[] = no focus; [rid...] = those routes drawn last at full strength, others at .25, with
     * direction-of-travel chevrons when 1-3 routes are focused. order = draw priority, index 0 on top
     * (core/visibility.js drawOrder); focused routes always stack above unfocused ones.
     * `dark` (optional) is forwarded to setTheme. While a plan is drawn every route dims to .25.
     * @param {{routes, shapes, routeStops, stopRoutes, stops, hidden?:string[], focus?:string[]|null, order?:string[], dark?:boolean}} o
     */
    drawNetwork(o) {
      if (!o) return;
      if (typeof o.dark === 'boolean') api.setTheme(o.dark); // same as calling setTheme(dark)
      lastNet = o;
      network.draw(o, planActive);
    },

    /**
     * Live buses, updated in place.
     * @param {Array} list store.buses
     * @param {{routes, hidden?:string[], focus?:string[]|null, nowS?:number}} o
     */
    drawBuses(list, o = {}) { buses.draw(list, o); },

    /**
     * Accent ring (+ name label when given) on the selected stop. On a favorite the ring widens to
     * circle the star badge. @param {{id, lat, lon, name?}|null} stop
     */
    setSelectedStop(stop) {
      selStop = toLatLng(stop) ? { id: String(stop.id), lat: stop.lat, lon: stop.lon, name: stop.name } : null;
      renderSel();
    },

    /**
     * Favorite stations: compact gold star badges above route lines and stops, below buses; visible at
     * every zoom (smaller below z14); name on hover/focus only; taps go to onStopTap(id). Rebuilt only
     * when the list's content changes, so it is cheap to call on every store change.
     * @param {Array<{id, name?, lat, lon}>|null} stops null/[] clears
     */
    drawFavorites(stops) {
      if (favs.draw(stops)) renderSel();
    },

    /** Blue location dot (+ accuracy circle when pos.accuracy is given). @param {{lat, lon, accuracy?}|null} pos */
    setUser(pos) {
      const ll = toLatLng(pos);
      if (!ll) { me?.remove(); meAcc?.remove(); me = meAcc = null; return; }
      if (!me) {
        me = L.marker(ll, { icon: L.divIcon({ className: 'sb-meicon', html: '<div class="sb-me"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
          interactive: false, keyboard: false, zIndexOffset: 400 }).addTo(map);
      } else if (!me.getLatLng().equals(ll)) me.setLatLng(ll);
      const acc = +pos.accuracy;
      if (Number.isFinite(acc) && acc > 15 && acc < 2000) {
        if (!meAcc) meAcc = L.circle(ll, { radius: acc, pane: 'sbStops', className: 'sb-acc', weight: 1, interactive: false }).addTo(map);
        else { meAcc.setLatLng(ll); meAcc.setRadius(acc); }
      } else { meAcc?.remove(); meAcc = null; }
    },

    /**
     * Ring highlights for candidate stops (picker). null clears. Taps go to onPick(id) (else onStopTap).
     * @param {Array<{id, lat, lon}>|null} items
     * @param {{onPick?:(id:string)=>void}} [opts]
     */
    highlightStops(items, opts = {}) {
      hlPick = opts.onPick || null;
      const list = (items || []).filter((s) => toLatLng(s));
      const s = list.map((x) => sig(x.id, x.lat, x.lon)).join(';');
      if (s === hlSig) return;
      hlSig = s;
      hlG.clearLayers();
      for (const it of list) {
        const ll = toLatLng(it);
        L.circleMarker(ll, { pane: 'sbHighlight', radius: 11, weight: 3, className: 'sb-hl', interactive: false }).addTo(hlG);
        L.circleMarker(ll, { pane: 'sbHighlight', radius: 22, stroke: false, fillOpacity: 0, className: 'sb-halo', bubblingMouseEvents: false })
          .on('click', () => (hlPick ? hlPick(String(it.id)) : stopTap.emit(String(it.id)))).addTo(hlG);
      }
    },

    /**
     * Draw a trip option: bus legs along road shapes, walk legs dotted along leg.coords (else straight),
     * board/alight dots, start/end pins. The network dims while a plan is shown. Returns the drawn points.
     * Option may also be a bare walk {from, to, coords?}. Pass fit:true to frame it when it changes.
     * @param {object|null} option planner Option
     * @param {{routes, shapes, routeStops, fit?:boolean}} [ctx]
     * @returns {Array<[number, number]>}
     */
    drawPlan(option, ctx = {}) {
      const s = option ? planSig(option) + '|' + sig(!!ctx.shapes, !!ctx.routes) : '';
      if (s === planS) return planPts;
      planS = s;
      planG.clearLayers();
      planPts = option ? renderPlan(L, planG, option, ctx) : [];
      const active = !!option;
      if (active !== planActive) { planActive = active; favs.setDim(active); if (lastNet) network.draw(lastNet, planActive); }
      if (ctx.fit && planPts.length > 1) api.fitTo(planPts, { maxZoom: 17 });
      return planPts;
    },

    /**
     * Frame points or bounds in the visible area above the sheet.
     * @param {Array|L.LatLngBounds|{lat, lon}} target
     * @param {{maxZoom?:number, animate?:boolean}} [o]
     */
    fitTo(target, o = {}) {
      let b;
      if (target instanceof L.LatLngBounds) b = target;
      else {
        const pts = flatPoints(target);
        if (!pts.length) return;
        b = L.latLngBounds(pts);
      }
      if (!b.isValid()) return;
      const maxZoom = o.maxZoom ?? 17;
      if (b.getNorthEast().equals(b.getSouthWest())) { api.flyTo({ lat: b.getCenter().lat, lon: b.getCenter().lng }, maxZoom); return; }
      progUntil = performance.now() + 1500;
      // sheet (nearly) full: almost no map shows, so frame for the half detent the user will drag back to
      const size = map.getSize().y, bottom = size - inset - TOP_PAD < 200 ? Math.round(size * 0.5) : inset;
      map.fitBounds(b, { paddingTopLeft: [PAD, TOP_PAD], paddingBottomRight: [PAD, bottom + PAD], maxZoom,
        animate: o.animate ?? !reducedMotion() });
    },

    /**
     * Fly so the point sits in the middle of the visible area above the sheet (offset via project/unproject).
     * @param {{lat:number, lon:number}} pt
     * @param {number} [zoom] default max(current, 16)
     * @param {{animate?:boolean}} [o] animate defaults to true unless prefers-reduced-motion
     */
    flyTo(pt, zoom, o = {}) {
      const ll = toLatLng(pt);
      if (!ll) return;
      const z = Math.min(18, zoom ?? Math.max(map.getZoom(), 16));
      const shift = (map.getSize().y - visibleH()) / 2; // half the sheet: target lands mid visible area
      const c = map.unproject(map.project(ll, z).add([0, shift]), z);
      progUntil = performance.now() + 1500;
      if (o.animate === false || reducedMotion()) map.setView(c, z, { animate: false });
      else map.flyTo(c, z, { duration: 0.6 });
    },

    /** @param {(stopId:string)=>void} fn @returns {()=>void} off */
    onStopTap: (fn) => stopTap.on(fn),
    /** @param {(bus:{id:string, rid:string, label:string})=>void} fn @returns {()=>void} off */
    onBusTap: (fn) => busTap.on(fn),
    /** Fired when the user drags or zooms the map (not for API fits/flies). @param {(c:{lat, lon, zoom})=>void} fn @returns {()=>void} off */
    onUserMove: (fn) => userMove.on(fn),
  };
  return api;
}

/** Points from [[lat,lon]], [{lat,lon}], a list of polylines, or one {lat,lon}. */
function flatPoints(t) {
  if (!Array.isArray(t)) return normLatLngs([t]);
  const nested = t.length && Array.isArray(t[0]) && Array.isArray(t[0][0]);
  return normLatLngs(nested ? t.flat() : t);
}

/** Draw plan geometry into group g; returns all points (for fitting). */
function renderPlan(L, g, o, ctx) {
  const pts = [];
  const walk = (coords) => {
    const ll = normLatLngs(coords);
    if (ll.length < 2) return;
    pts.push(...ll);
    L.polyline(ll, { pane: 'sbPlanCasing', className: 'sb-walk-casing', weight: 8, dashArray: '0.1 11', lineCap: 'round', interactive: false }).addTo(g);
    L.polyline(ll, { pane: 'sbPlan', className: 'sb-walk', weight: 5, dashArray: '0.1 11', lineCap: 'round', interactive: false }).addTo(g);
  };
  const legs = Array.isArray(o.legs) ? o.legs : [];
  if (!legs.length && o.from && o.to) walk(o.coords?.length > 1 ? o.coords : [o.from, o.to]);
  for (const l of legs) {
    if (l.type === 'walk') { walk(l.coords?.length > 1 ? l.coords : [l.from, l.to]); continue; }
    if (l.type !== 'bus') continue;
    const fb = normLatLngs(l.path?.length ? l.path : [l.board, l.alight]);
    const ll = alongShape(ctx.shapes?.[l.rid], ctx.routeStops?.[l.rid], l.board, l.alight, fb);
    if (ll.length < 2) continue;
    pts.push(...ll);
    const color = safeColor(ctx.routes?.[l.rid]?.color);
    L.polyline(ll, { pane: 'sbPlanCasing', className: 'sb-plan-casing', weight: 11, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
    L.polyline(ll, { pane: 'sbPlan', color, weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
    for (const p of [l.board, l.alight]) {
      const q = toLatLng(p);
      if (q) L.circleMarker(q, { pane: 'sbPlanStops', radius: 6, weight: 3, color, className: 'sb-plan-stop', fillOpacity: 1, interactive: false }).addTo(g);
    }
  }
  const first = legs[0], lastL = legs[legs.length - 1];
  const start = toLatLng(first ? (first.type === 'walk' ? first.from : first.board) : o.from);
  const end = toLatLng(lastL ? (lastL.type === 'walk' ? lastL.to : lastL.alight) : o.to);
  if (start) {
    pts.push(start);
    L.circleMarker(start, { pane: 'sbPlanStops', radius: 8, weight: 3, className: 'sb-pin-start', fillOpacity: 1, interactive: false }).addTo(g);
  }
  if (end) {
    pts.push(end);
    L.marker(end, { icon: L.divIcon({ className: 'sb-pinicon', html: '<div class="sb-pin-end"></div>', iconSize: [26, 34], iconAnchor: [13, 32] }),
      interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(g);
  }
  return pts;
}

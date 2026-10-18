/**
 * map/map.js: the MapApi (see docs/ARCHITECTURE.md "Map layer"). Leaflet map with a patched
 * OpenFreeMap basemap (map/style.js), route network + buses (map/layers.js), favorite stations
 * (map/favorites.js), the brief map credit (map/credits.js: plain text at load, gone after 5 s; kept just
 * above the sheet by setBottomInset while shown), selected stop, user dot,
 * stop highlights and trip plans. Every method is idempotent and cheap to call on each poll: layers
 * redraw only when their signature changes. Theme colors for overlays come from CSS (css/map.css)
 * keyed on the `.sb-dark` class this module toggles on the map element.
 */
import { createBasemap } from './style.js';
import { createNetworkLayer, createBusLayer, sig } from './layers.js';
import { createFavoritesLayer } from './favorites.js';
import { createCredits } from './credits.js';
import { createLandmarkLayer } from './landmarks.js';
import { alongShape, normLatLngs, toLatLng, unwrapDeg } from './geometry.js';
import { safeColor, esc } from '../core/esc.js';
import { offShort } from '../core/tripyou.js';

const CAMPUS = [41.7897, -87.5997];
const PAD = 24;           // side padding for fits
const TOP_PAD = 132;      // clears the floating search bar and the locate button / chips
const FIT_S = 0.6;        // fitTo glide (s). flyToBounds, not fitBounds: Leaflet's CSS zoom animation scales the
                          // vector basemap canvas down on zoom-out, leaving blank margins for ~250 ms
const PANES = { sbCasing: 380, sbLines: 390, sbFocusCasing: 392, sbFocusLines: 394, sbPlanCasing: 400, sbPlan: 402,
  sbLabels: 410, sbStops: 420, sbPlanStops: 425, sbHighlight: 430, sbSel: 440 };   // sbLabels: building names above the lines
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
 *   setUser, setHeading, highlightStops, drawPlan, setTrip, inView, setLandmarks, fitTo, flyTo, onStopTap, onBusTap, onUserMove, onMapTap
 *   (+ `leaflet` escape hatch)
 */
export function createMap(elId) {
  const L = window.L;
  const el = document.getElementById(elId);
  el.classList.add('sb-map');
  // no Leaflet attribution control: map/credits.js shows the credit at load, then fades it out (no bubble, no (i))
  const map = L.map(el, { zoomControl: false, attributionControl: false, minZoom: 11, maxZoom: 18, zoomSnap: 0.25,
    zoomDelta: 0.5, wheelPxPerZoomLevel: 90, tapTolerance: 15 }).setView(CAMPUS, 15);
  for (const [name, z] of Object.entries(PANES)) map.createPane(name).style.zIndex = String(z);

  let dark = false, inset = 0, progUntil = 0, lastNet = null, planActive = false;
  const stopTap = hub(), busTap = hub(), userMove = hub(), mapTap = hub();
  const basemap = createBasemap(map, dark);
  const credits = createCredits(map, { html: basemap.attribution });
  const network = createNetworkLayer(map, { onStopTap: (id) => stopTap.emit(id) });
  const buses = createBusLayer(map, { onBusTap: (info) => busTap.emit(info) });
  const favs = createFavoritesLayer(map, { onStopTap: (id) => stopTap.emit(id) });
  const landmarks = createLandmarkLayer(map, { pane: 'sbLabels', textAt: (box) => !!basemap.textAt?.(box) });
  basemap.onIdle?.(() => landmarks.refresh());   // the basemap placed its own names: keep building names off them
  const selG = L.layerGroup().addTo(map), hlG = L.layerGroup().addTo(map), planG = L.layerGroup().addTo(map);
  const labG = L.layerGroup().addTo(map);
  let selSig = '', selStop = null, hlSig = '', planS = null, planPts = [], hlPick = null, me = null, meAcc = null;
  let you = null, youMk = null, youS = '', labS = '';
  let head = null, headTurn = NaN, headS = '';   // heading cone: {deg, spread}; the rotation shown (unwrapped); last written

  /**
   * You on the trip (setTrip): on the bus = ring + "You" on its marker (the GPS dot steps back: same place, or
   * worse); a bus not drawn (another route in focus) or the boarding stop as a guess = a marker of its own; GPS =
   * the normal dot. Labels on your stops: "Board here" before boarding, the get-off count on board.
   */
  function renderYou() {
    const y = you, ll = y ? toLatLng(y) : null;
    const onBus = !!(y && y.onBus && ll);
    const busDrawn = buses.setYou(onBus ? y.vehicleId : null);
    el.classList.toggle('sb-you-onbus', onBus);
    const kind = !ll || y.source === 'gps' || (onBus && busDrawn) ? '' : y.source === 'stop' ? 'stop' : 'bus';
    const s = kind ? sig(kind, ll[0], ll[1], y.text) : '';
    if (s !== youS) {
      youS = s;
      youMk?.remove(); youMk = null;
      if (kind) {
        const pill = kind === 'stop' ? 'You (est.)' : 'You';
        youMk = L.marker(ll, { icon: L.divIcon({ className: 'sb-youicon', iconSize: [20, 20], iconAnchor: [10, 10],
          html: `<div class="sb-you sb-you--${kind}" title="${esc(y.text)}"><span class="sb-you-dot"></span><span class="sb-you-pill">${esc(pill)}</span></div>` }),
        interactive: false, keyboard: false, zIndexOffset: 650 }).addTo(map);
      }
    }
    const labs = [];
    const before = y && (y.phase === 'walk-to-stop' || y.phase === 'waiting');
    if (before && y.board && y.board.lat != null) labs.push({ p: y.board, t: 'Board here', k: 'board' });
    if (y && y.phase !== 'arrived' && y.alight && y.alight.lat != null) labs.push({ p: y.alight, t: y.phase === 'on-bus' ? offShort(y.stopsLeft) : 'Get off here', k: 'off' });
    const ls = labs.map((x) => sig(x.k, x.p.lat, x.p.lon, x.t)).join(';');
    if (ls === labS) return;
    labS = ls;
    labG.clearLayers();
    for (const x of labs) {
      L.marker([x.p.lat, x.p.lon], { icon: L.divIcon({ className: 'sb-tlabelicon', iconSize: [0, 0], iconAnchor: [0, 0],
        html: `<span class="sb-tlabel sb-tlabel--${x.k}">${esc(x.t)}</span>` }), interactive: false, keyboard: false, zIndexOffset: 300 }).addTo(labG);
    }
  }

  /** Show / turn / hide the heading cone inside the location dot's marker (setHeading). */
  function renderHeading() {
    const icon = me && me.getElement ? me.getElement() : null;
    if (!icon) return;
    if (head) headTurn = unwrapDeg(headTurn, head.deg);
    const s = head ? sig(Math.round(headTurn), head.spread) : '';
    if (s === headS) return;
    headS = s;
    icon.classList.toggle('sb-me-head', !!head);
    const cone = icon.querySelector('.sb-mecone');
    if (!cone || !head) return;
    cone.style.setProperty('--sb-head', Math.round(headTurn) + 'deg');
    cone.style.setProperty('--sb-spread', Math.round(head.spread) + 'deg');
  }

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
  // A tap on empty map (not a stop, bus, highlight, plan pin or control; Leaflet sends no click after a drag)
  map.on('click', (e) => {
    const t = e.originalEvent && e.originalEvent.target;
    if (t && t.closest && t.closest('.leaflet-interactive, .leaflet-marker-icon, .leaflet-control, .sb-credits, button, a')) return;
    mapTap.emit({ lat: e.latlng.lat, lon: e.latlng.lng });
  });

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

    /**
     * Height in px of the sheet covering the bottom of the map; fits/flies keep targets above it and the
     * map credit (while shown) sits just above it (hidden when almost no map shows). @param {number} px
     */
    setBottomInset(px) {
      const v = Math.max(0, Math.round(+px || 0)), h = map.getSize().y;
      inset = Math.min(v, Math.max(0, h - 160));
      credits.place(v, h);
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
      if (network.draw(o, planActive)) landmarks.setStops(network.stopPoints());
    },

    /**
     * Live buses, updated in place, drawn on their route line and moved along it (map/track.js).
     * @param {Array} list store.buses
     * @param {{routes, shapes?, hidden?:string[], focus?:string[]|null, nowS?:number}} o shapes: store.shapes
     */
    drawBuses(list, o = {}) { buses.draw(list, o); if (you) renderYou(); },

    /**
     * You on the started trip (core/tripyou.js tripYou; null clears): the "You" marker and the labels on your
     * boarding / alighting stops, with the same stop count as the Current trip card and the trip alerts.
     * Cheap to call on every store change (redraws only what changed).
     * @param {object|null} y tripYou result
     */
    setTrip(y) {
      you = y && typeof y === 'object' ? y : null;
      renderYou();
    },

    /**
     * Are all these points inside the visible map (above the sheet, inside the padding fits use)?
     * @param {Array} points [[lat, lon]] or [{lat, lon}]
     * @returns {boolean|null} null when the sheet covers almost all of the map (nothing to keep in view)
     */
    inView(points) {
      const pts = flatPoints(points), size = map.getSize();
      if (size.y - inset - TOP_PAD < 200) return null;
      const maxX = size.x - PAD, maxY = size.y - inset - PAD;
      return pts.every((p) => { const c = map.latLngToContainerPoint(p); return c.x >= PAD && c.x <= maxX && c.y >= TOP_PAD && c.y <= maxY; });
    },

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

    /**
     * Building and place names shown by default (web/data/landmarks.json via store.landmarks; owner 2026-10-13):
     * map/landmarks.js, above the route lines, placed around stops and each other; tier 1 from zoom 14.5.
     * @param {Array<object>} list
     */
    setLandmarks(list) { landmarks.setData(list); basemap.setLandmarks?.(list); },

    /** Blue location dot (+ accuracy circle when pos.accuracy is given). @param {{lat, lon, accuracy?}|null} pos */
    setUser(pos) {
      const ll = toLatLng(pos);
      if (!ll) { me?.remove(); meAcc?.remove(); me = meAcc = null; headTurn = NaN; headS = ''; return; }
      if (!me) {
        me = L.marker(ll, { icon: L.divIcon({ className: 'sb-meicon', html: '<div class="sb-mecone"></div><div class="sb-me"></div>',
          iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false, keyboard: false, zIndexOffset: 400 }).addTo(map);
        renderHeading();
      } else if (!me.getLatLng().equals(ll)) me.setLatLng(ll);
      const acc = +pos.accuracy;
      if (Number.isFinite(acc) && acc > 15 && acc < 2000) {
        if (!meAcc) meAcc = L.circle(ll, { radius: acc, pane: 'sbStops', className: 'sb-acc', weight: 1, interactive: false }).addTo(map);
        else { meAcc.setLatLng(ll); meAcc.setRadius(acc); }
      } else { meAcc?.remove(); meAcc = null; }
    },

    /**
     * Heading cone on the location dot (ui/compass.js; owner 2026-10-14): an accent wedge fading outward, pointing
     * where the phone faces, `spread` degrees wide (wider = the compass is less sure). null hides it. Cheap to call
     * per sensor reading: the DOM is written only when the rounded rotation or the width changes; the turn
     * continues the shortest way round (unwrapDeg). Kept across setUser(null) and a new dot.
     * @param {number|null} deg compass heading, degrees clockwise from north
     * @param {number} [spread] cone width in degrees (default 60, clamped 20..160)
     */
    setHeading(deg, spread) {
      const d = deg === null || deg === undefined ? NaN : +deg, w = +spread;
      head = Number.isFinite(d) ? { deg: d, spread: Number.isFinite(w) ? Math.max(20, Math.min(160, w)) : 60 } : null;
      renderHeading();
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
      const pad = { paddingTopLeft: [PAD, TOP_PAD], paddingBottomRight: [PAD, bottom + PAD], maxZoom };
      if (o.animate ?? !reducedMotion()) map.flyToBounds(b, { ...pad, duration: FIT_S });
      else map.fitBounds(b, { ...pad, animate: false });
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
    /** Fired for a tap on empty map (main.js collapses the sheet). @param {(p:{lat, lon})=>void} fn @returns {()=>void} off */
    onMapTap: (fn) => mapTap.on(fn),
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

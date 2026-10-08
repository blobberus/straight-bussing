/**
 * map/favorites.js: favorite-station markers (state.favStops). A compact gold disc with a dark star
 * and a white casing (reads on light and dark basemaps; the star shape carries the meaning, not the
 * color). Lives in its own pane above route lines, chevrons and normal stops but below plan stops,
 * picker highlights, the selected-stop ring and every bus marker (markerPane), so it never takes a
 * tap a bus would get. Shown at every zoom; below z14 (where normal stops hide) it shrinks. No
 * permanent labels: the name appears only on hover / keyboard focus. Static (no animation).
 * Rebuilt only when the favorite list's signature changes; zoom, selection and plan dimming are
 * class toggles on existing nodes.
 */
import { sig } from './layers.js';

const PANE = 'sbFav';
const Z_INDEX = 422;          // stops 420 < favorites < plan stops 425, highlights 430, selection 440, buses 600
/** Below this zoom favorites use the small badge (normal stops are hidden there). */
export const FAV_SMALL_BELOW = 14;
const HIT_PX = 44;
const STAR = 'M12 2.8l2.85 5.78 6.38.93-4.62 4.5 1.09 6.35L12 17.36l-5.7 3 1.09-6.35-4.62-4.5 6.38-.93z';
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Normalize drawFavorites input: drop entries without an id or finite coordinates, dedupe by id.
 * @param {Array<{id, name?, lat, lon}>|null|undefined} stops
 * @returns {Array<{id:string, name:string, lat:number, lon:number}>}
 */
export function favList(stops) {
  const out = [], seen = new Set();
  for (const s of Array.isArray(stops) ? stops : []) {
    const id = s?.id == null ? '' : String(s.id), lat = +s?.lat, lon = +s?.lon;
    if (!id || seen.has(id) || s?.lat == null || s?.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    seen.add(id);
    out.push({ id, name: s.name == null ? '' : String(s.name), lat, lon });
  }
  return out;
}

/**
 * Content signature of a favorite list (order-insensitive; '' for none).
 * @param {Array<{id, name?, lat, lon}>|null} stops
 * @returns {string}
 */
export function favSig(stops) {
  return favList(stops).map((s) => sig(s.id, s.lat.toFixed(6), s.lon.toFixed(6), s.name)).sort().join(';');
}

function starIcon(name) {
  const wrap = document.createElement('div');
  wrap.className = 'sb-fav-wrap';
  const hit = document.createElement('span'); hit.className = 'sb-fav-hit';
  const badge = document.createElement('span'); badge.className = 'sb-fav';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'sb-fav-star');
  const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', STAR);
  svg.appendChild(path); badge.appendChild(svg);
  wrap.append(hit, badge);
  if (name) {
    const label = document.createElement('span'); label.className = 'sb-fav-name'; label.textContent = name;
    wrap.appendChild(label);
  }
  return window.L.divIcon({ className: 'sb-favicon', html: wrap, iconSize: [HIT_PX, HIT_PX], iconAnchor: [HIT_PX / 2, HIT_PX / 2] });
}

/**
 * Favorites layer.
 * @param {L.Map} map
 * @param {{onStopTap:(id:string)=>void}} cb
 * @returns {{draw(stops:Array|null):boolean, setSelected(id:string|null):void, setDim(on:boolean):void,
 *   restyle():void, has(id:string):boolean, count():number}}
 */
export function createFavoritesLayer(map, cb) {
  const L = window.L;
  const pane = map.getPane(PANE) || map.createPane(PANE);
  pane.style.zIndex = String(Z_INDEX);
  pane.classList.add('sb-fav-pane');
  const group = L.layerGroup().addTo(map);
  const markers = new Map(); // id -> marker
  let last = '', selId = null;

  function restyle() { pane.classList.toggle('sb-fav-sm', map.getZoom() < FAV_SMALL_BELOW); }
  map.on('zoomend', restyle);
  restyle();

  function markSel() {
    for (const [id, mk] of markers) mk.getElement()?.classList.toggle('is-sel', id === selId);
  }

  function draw(stops) {
    const s = favSig(stops);
    if (s === last) return false;
    last = s;
    group.clearLayers(); markers.clear();
    for (const f of favList(stops)) {
      const mk = L.marker([f.lat, f.lon], { pane: PANE, icon: starIcon(f.name), keyboard: true, riseOnHover: true,
        bubblingMouseEvents: false });
      mk.on('click', () => cb.onStopTap(f.id));
      mk.addTo(group);
      const el = mk.getElement();
      if (el) {
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', f.name ? `Favorite stop: ${f.name}` : 'Favorite stop');
        el.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault(); e.stopPropagation();
          cb.onStopTap(f.id);
        });
      }
      markers.set(f.id, mk);
    }
    markSel();
    restyle();
    return true;
  }

  return {
    /** Replace the favorites (null/[] clears). Returns true when it redrew. */
    draw,
    /** Mark the selected stop's badge (selection ring itself is drawn by map.js). */
    setSelected(id) { const v = id == null ? null : String(id); if (v !== selId) { selId = v; markSel(); } },
    /** Fade favorites while a trip plan is shown. */
    setDim(on) { pane.classList.toggle('is-dim', !!on); },
    restyle,
    has: (id) => markers.has(String(id)),
    count: () => markers.size,
  };
}

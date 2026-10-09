/**
 * map/credits.js: the brief map credit ("OpenFreeMap · OpenMapTiles · OpenStreetMap", each a link; no
 * copyright sign). Owner request 2026-10-09: no info bubble and no "(i)" button on the map.
 *
 * Plain small text (no bubble) shown when the map loads, faded out after SHOW_MS and then gone for the
 * session. The OSMF attribution guidelines allow the on-map credit to disappear after five seconds when
 * the credits stay findable elsewhere: Settings > About lists OpenStreetMap (ODbL), OpenMapTiles and
 * OpenFreeMap. It stays while keyboard focus is on one of its links or a mouse hovers it. While shown it
 * sits at the bottom-left of the VISIBLE map, just above the sheet (place(), called from
 * MapApi.setBottomInset), and hides when the sheet leaves almost no map. Colors: css/map.css (.sb-credits).
 */

/** How long the credit shows after the map loads (ms). */
export const SHOW_MS = 5000;
/** Fade-out length (ms, matches css/map.css .sb-credits.is-fading). */
export const FADE_MS = 400;
/** Below this much visible map height (px, between the top of the map and the sheet) the credit hides. */
export const MIN_ROOM = 176;

/**
 * Create the credit inside the Leaflet map's container.
 * @param {L.Map} map
 * @param {{html?:string, showMs?:number, minRoom?:number}} [opts]
 *   html: trusted attribution markup (constants from map/style.js, never user text)
 * @returns {{el:HTMLElement, isShown():boolean, dismiss():void, setHTML(html:string):void,
 *            place(bottomPx:number, mapHeight:number):void, destroy():void}}
 */
export function createCredits(map, { html = '', showMs = SHOW_MS, minRoom = MIN_ROOM } = {}) {
  const L = window.L;
  const root = document.createElement('div');
  root.className = 'sb-credits';
  root.setAttribute('role', 'note');
  root.setAttribute('aria-label', 'Map credits');
  root.innerHTML = html;
  map.getContainer().appendChild(root);
  if (L?.DomEvent) { L.DomEvent.disableClickPropagation(root); L.DomEvent.disableScrollPropagation(root); }

  let shown = true, timer = 0, hover = false, placed = false, off = false;
  const holding = () => hover || root.contains(document.activeElement);
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(function tick() {
      if (holding()) { timer = setTimeout(tick, showMs); return; }
      api.dismiss();
    }, showMs);
  };
  const onEnter = (e) => { if (e.pointerType === 'mouse') hover = true; };
  const onLeave = (e) => { if (e.pointerType === 'mouse') { hover = false; if (shown) arm(); } };
  const onFocusOut = () => setTimeout(() => { if (shown && !holding()) arm(); }, 0);
  root.addEventListener('pointerenter', onEnter);
  root.addEventListener('pointerleave', onLeave);
  root.addEventListener('focusout', onFocusOut);

  const api = {
    el: root,
    /** @returns {boolean} credit still on the map */
    isShown: () => shown,
    /** Fade the credit out for good (no way back on the map; Settings > About keeps the credits). */
    dismiss() {
      if (!shown) return;
      clearTimeout(timer);
      shown = false;
      if (root.contains(document.activeElement)) document.activeElement.blur();
      root.classList.add('is-fading');
      timer = setTimeout(() => { root.hidden = true; }, FADE_MS);
    },
    /** Replace the credit markup (trusted constants only). @param {string} h */
    setHTML(h) { root.innerHTML = String(h || ''); },
    /**
     * Sit just above the sheet: bottomPx = sheet + navigation height over the map (0 = map bottom).
     * Hidden when less than minRoom px of map stay visible. The first placement and a placement after
     * being hidden jump; later ones glide (css transition, same timing as the sheet).
     * @param {number} bottomPx
     * @param {number} mapHeight
     */
    place(bottomPx, mapHeight) {
      if (!shown) return;
      const b = Math.max(0, Math.round(+bottomPx || 0)), h = +mapHeight || 0;
      const hide = h > 0 && h - b < minRoom;
      root.classList.toggle('is-off', hide);
      if (hide) { off = true; return; }
      const jump = !placed || off;
      placed = true; off = false;
      if (jump) root.classList.add('no-anim');
      root.style.setProperty('--sb-credit-y', b + 'px');
      if (jump) { void root.offsetWidth; root.classList.remove('no-anim'); }
    },
    /** Remove the credit and its timer. */
    destroy() {
      clearTimeout(timer);
      root.removeEventListener('pointerenter', onEnter);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('focusout', onFocusOut);
      root.remove();
    },
  };
  arm();
  return api;
}

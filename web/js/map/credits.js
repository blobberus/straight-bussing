/**
 * map/credits.js: the map credit ("OpenFreeMap / OpenMapTiles / OpenStreetMap", each a link; no
 * copyright sign: the OSMF attribution guidelines only require crediting "OpenStreetMap" and allow collapsing
 * the credit after five seconds as long as an "(i)" button brings it back).
 *
 * Shown expanded when the map loads; collapses after COLLAPSE_MS into a small "(i)" button
 * (44 px target, aria-label "Map credits", aria-expanded, aria-controls) that re-opens it; a second
 * tap, Escape, or another COLLAPSE_MS collapses it again. It never collapses while keyboard focus is
 * on one of its links or a mouse hovers it. It sits at the bottom-left of the VISIBLE map, just above
 * the sheet (place(), called from MapApi.setBottomInset, glides it with the sheet), so it is always
 * clear of the floating search bar, chips and locate button; it hides when the sheet leaves almost no
 * map (full detent). Colors come from css/map.css (.sb-credits, theme via .sb-dark on the map).
 */

/** Auto-collapse delay (ms). */
export const COLLAPSE_MS = 5000;
/** Below this much visible map height (px, between the top of the map and the sheet) the credit hides. */
export const MIN_ROOM = 176;

const INFO_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">'
  + '<circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.8"/>'
  + '<circle cx="12" cy="7.6" r="1.35" fill="currentColor"/>'
  + '<path d="M12 10.8v6.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
let uid = 0;

/**
 * Create the credit control inside the Leaflet map's container.
 * @param {L.Map} map
 * @param {{html?:string, collapseMs?:number, minRoom?:number}} [opts]
 *   html: trusted attribution markup (constants from map/style.js, never user text)
 * @returns {{el:HTMLElement, button:HTMLButtonElement, isOpen():boolean, expand(auto?:boolean):void, collapse(focusButton?:boolean):void,
 *            toggle():void, setHTML(html:string):void, place(bottomPx:number, mapHeight:number):void, destroy():void}}
 */
export function createCredits(map, { html = '', collapseMs = COLLAPSE_MS, minRoom = MIN_ROOM } = {}) {
  const L = window.L;
  const id = 'sbCredits' + (++uid);
  const root = document.createElement('div');
  root.className = 'sb-credits is-open';
  root.innerHTML = `<button type="button" class="sb-credits-btn" aria-label="Map credits" aria-expanded="true" aria-controls="${id}">`
    + `<span class="sb-credits-ic">${INFO_SVG}</span></button><span class="sb-credits-text" id="${id}"></span>`;
  const btn = root.firstElementChild, text = root.lastElementChild;
  text.innerHTML = html;
  map.getContainer().appendChild(root);
  if (L?.DomEvent) { L.DomEvent.disableClickPropagation(root); L.DomEvent.disableScrollPropagation(root); }

  let open = true, timer = 0, hover = false, placed = false, off = false;
  const holding = () => hover || text.contains(document.activeElement);
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(function tick() {
      if (!open) return;
      if (holding()) { timer = setTimeout(tick, collapseMs); return; }
      api.collapse(false);
    }, collapseMs);
  };
  const paint = () => {
    root.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    text.hidden = !open;
  };

  const onClick = (e) => { e.preventDefault(); api.toggle(); };
  const onKey = (e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); api.collapse(true); } };
  const onEnter = (e) => { if (e.pointerType === 'mouse') { hover = true; } };
  const onLeave = (e) => { if (e.pointerType === 'mouse') { hover = false; if (open) arm(); } };
  const onFocusOut = () => setTimeout(() => { if (open && !holding()) arm(); }, 0);
  btn.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  root.addEventListener('pointerenter', onEnter);
  root.addEventListener('pointerleave', onLeave);
  root.addEventListener('focusout', onFocusOut);

  const api = {
    el: root,
    button: btn,
    /** @returns {boolean} credit text showing */
    isOpen: () => open,
    /** Show the credit text; it collapses again after collapseMs. */
    expand() { open = true; paint(); arm(); },
    /** Collapse to the (i) button. @param {boolean} [focusButton] move focus to the button (Escape, or focus was on a link) */
    collapse(focusButton) {
      clearTimeout(timer);
      const had = text.contains(document.activeElement);
      open = false;
      paint();
      if (focusButton || had) btn.focus({ preventScroll: true });
    },
    /** Tap on (i): open, or close when open. */
    toggle() { if (open) api.collapse(false); else api.expand(); },
    /** Replace the credit markup (trusted constants only). @param {string} h */
    setHTML(h) { text.innerHTML = String(h || ''); },
    /**
     * Sit just above the sheet: bottomPx = sheet + navigation height over the map (0 = map bottom).
     * Hidden when less than minRoom px of map stay visible. The first placement and a placement after
     * being hidden jump; later ones glide (css transition, same timing as the sheet).
     * @param {number} bottomPx
     * @param {number} mapHeight
     */
    place(bottomPx, mapHeight) {
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
    /** Remove the control and its timer. */
    destroy() {
      clearTimeout(timer);
      btn.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('pointerenter', onEnter);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('focusout', onFocusOut);
      root.remove();
    },
  };
  paint();
  arm();
  return api;
}

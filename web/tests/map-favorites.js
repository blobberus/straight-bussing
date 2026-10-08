/** Tests for map/favorites.js (favorite-station markers) and MapApi.drawFavorites / selection interplay. */
import { test, eq, ok } from './lib.js';
import { favList, favSig, FAV_SMALL_BELOW, createFavoritesLayer } from '../js/map/favorites.js';
import { createMap } from '../js/map/map.js';
import { P } from './map-fixtures.js';

const fav = (id, x, y, name = id + ' st') => { const [lat, lon] = P(x, y); return { id, name, lat, lon }; };

function box(id) {
  const d = document.createElement('div');
  d.id = id;
  d.style.cssText = 'position:absolute;left:-2000px;top:0;width:400px;height:600px';
  document.body.appendChild(d);
  return d;
}
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

test('favList / favSig: normalized, content-stable, order-insensitive', () => {
  eq(favList(null), []); eq(favSig(null), ''); eq(favSig([]), '');
  const l = favList([fav('A', 0, 0), { id: 'B', lat: NaN, lon: 1 }, { id: 'C', lat: null, lon: null }, { lat: 41, lon: -87 }, fav('A', 1, 1)]);
  eq(l.map((s) => s.id), ['A'], 'invalid coords, missing ids and duplicates dropped');
  eq(typeof l[0].lat, 'number');
  const s = favSig([fav('A', 0, 0), fav('B', 1, 0)]);
  eq(favSig([fav('B', 1, 0), fav('A', 0, 0)]), s, 'order irrelevant');
  eq(favSig([fav('A', 0, 0), fav('B', 1, 0)]), s, 'new arrays, same content -> same');
  ok(favSig([fav('A', 0, 0), fav('B', 1, 0, 'Renamed')]) !== s, 'name change');
  ok(favSig([fav('A', 0, 0)]) !== s, 'removal');
  eq(favSig([{ id: 7, lat: '41.79', lon: '-87.6' }]), favSig([{ id: '7', lat: 41.79, lon: -87.6 }]), 'string ids/coords coerced');
});

test('favorites layer: pane order, no repaint on same input, taps, zoom size, dim', () => {
  const host = box('t-fav');
  host.classList.add('sb-map'); // map.css scopes overlay rules to .sb-map (createMap adds it)
  const m = window.L.map(host, { zoomControl: false, attributionControl: false }).setView(P(2, 2), 15);
  const taps = [];
  const layer = createFavoritesLayer(m, { onStopTap: (id) => taps.push(id) });
  const pane = m.getPane('sbFav');
  ok(pane, 'own pane');
  const z = +pane.style.zIndex;
  ok(z > 396 && z > 420 && z < 440 && z < +getComputedStyle(m.getPane('markerPane')).zIndex,
    `above lines/chevrons/stops, below selection and bus markers (z ${z})`);
  ok(layer.draw([fav('A', 0, 0), fav('B', 4, 0)]), 'first draw');
  const els = [...pane.querySelectorAll('.sb-favicon')];
  eq(els.length, 2, 'one badge per favorite');
  ok(els.every((e) => e.querySelector('svg.sb-fav-star path')), 'star glyph');
  eq(els[0].getAttribute('aria-label'), 'Favorite stop: A st');
  eq(els[0].getAttribute('role'), 'button');
  eq(layer.draw([fav('B', 4, 0), fav('A', 0, 0)]), false, 'same content -> no redraw');
  ok([...pane.querySelectorAll('.sb-favicon')].every((e, i) => e === els[i]), 'same DOM nodes');
  click(els[1].querySelector('.sb-fav-hit'));
  eq(taps, ['B'], 'tap on the hit area -> onStopTap(id)');
  els[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  eq(taps, ['B', 'A'], 'Enter on a focused badge -> onStopTap(id)');
  const hit = getComputedStyle(els[0].querySelector('.sb-fav-hit'));
  eq(hit.width, '44px', '44 px hit area at z15');
  eq(getComputedStyle(els[0]).pointerEvents, 'none', 'outer box ignores pointers (only the round hit area taps)');
  eq(getComputedStyle(els[0].querySelector('.sb-fav')).animationName, 'none', 'static badge, no pulse');
  ok(!pane.classList.contains('sb-fav-sm'), 'normal size at z15');
  m.setZoom(FAV_SMALL_BELOW - 1.5, { animate: false });
  ok(pane.classList.contains('sb-fav-sm'), 'small below z14');
  eq(pane.querySelectorAll('.sb-favicon').length, 2, 'still shown below z14 (normal stops hidden there)');
  ok(pane.querySelector('.sb-favicon') === els[0], 'zoom does not rebuild');
  eq(getComputedStyle(els[0].querySelector('.sb-fav')).width, '16px', 'smaller badge');
  m.setZoom(16, { animate: false });
  ok(!pane.classList.contains('sb-fav-sm'), 'normal again at z16');
  layer.setDim(true); ok(pane.classList.contains('is-dim'));
  layer.setDim(false); ok(!pane.classList.contains('is-dim'));
  layer.setSelected('A');
  ok(els[0].classList.contains('is-sel') && !els[1].classList.contains('is-sel'), 'selected badge marked');
  ok(layer.draw([fav('A', 0, 0)]), 'removal redraws');
  eq(layer.count(), 1); ok(layer.has('A') && !layer.has('B'));
  ok(pane.querySelector('.sb-favicon').classList.contains('is-sel'), 'selection survives a rebuild');
  layer.draw(null);
  eq(pane.querySelectorAll('.sb-favicon').length, 0, 'null clears');
  m.remove();
});

test('MapApi.drawFavorites: taps via onStopTap, ring around a selected favorite, dims with a plan', () => {
  box('t-favapi');
  const api = createMap('t-favapi');
  const m = api.leaflet, el = m.getContainer();
  eq(typeof api.drawFavorites, 'function');
  const taps = [];
  api.onStopTap((id) => taps.push(id));
  api.drawFavorites([fav('A', 0, 0), fav('C', 4, 4)]);
  eq(el.querySelectorAll('.sb-favicon').length, 2);
  click(el.querySelector('.sb-fav-hit'));
  eq(taps.length, 1, 'favorite tap goes through the stop-tap path');
  ok(['A', 'C'].includes(taps[0]));

  const [lat, lon] = P(0, 0);
  api.setSelectedStop({ id: 'A', lat, lon });
  const ring = el.querySelector('path.sb-sel');
  ok(ring.classList.contains('sb-sel-fav'), 'selected favorite gets the favorite ring');
  eq(getComputedStyle(ring).fill, 'none', 'ring is unfilled so the star stays visible');
  const favA = [...el.querySelectorAll('.sb-favicon')].find((e) => e.getAttribute('aria-label') === 'Favorite stop: A st');
  ok(favA.classList.contains('is-sel'), 'badge marked selected');
  api.drawFavorites([fav('C', 4, 4)]);
  const ring2 = el.querySelector('path.sb-sel');
  ok(ring2 && !ring2.classList.contains('sb-sel-fav'), 'unfavorited -> normal selection ring');
  api.drawFavorites([fav('C', 4, 4), fav('A', 0, 0)]);
  ok(el.querySelector('path.sb-sel').classList.contains('sb-sel-fav'), 're-favorited -> favorite ring');
  const nodes = [...el.querySelectorAll('.sb-favicon')];
  api.drawFavorites([fav('A', 0, 0), fav('C', 4, 4)]);
  ok([...el.querySelectorAll('.sb-favicon')].every((e, i) => e === nodes[i]), 'same favorites -> no rebuild');
  api.setSelectedStop(null);
  ok(!el.querySelector('path.sb-sel') && !el.querySelector('.sb-favicon.is-sel'), 'selection cleared');

  api.drawPlan({ from: { lat, lon }, to: { lat: P(2, 2)[0], lon: P(2, 2)[1] } }, {});
  ok(m.getPane('sbFav').classList.contains('is-dim'), 'favorites fade while a plan is shown');
  api.drawPlan(null);
  ok(!m.getPane('sbFav').classList.contains('is-dim'), 'and come back after');
  api.drawFavorites(null);
  eq(el.querySelectorAll('.sb-favicon').length, 0, 'null clears');
  m.remove();
});

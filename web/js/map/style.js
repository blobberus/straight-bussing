/**
 * map/style.js: basemap. OpenFreeMap vector styles (positron = light, dark = dark) patched at runtime
 * by the pure `patchStyle(styleJson, isDark)` for legible street names and house numbers, then shown
 * through L.maplibreGL. Theme changes call gl.setStyle on the SAME layer (the Leaflet map is never
 * recreated). Without maplibre/WebGL it falls back to OSM raster tiles (CSS-inverted in dark).
 *
 * Layer ids patched by patchStyle (OpenMapTiles schema; ids from positron and dark as of 2026-10):
 *   recolored:  background, water, park (positron), landuse_park (dark), landuse_residential,
 *               landcover_wood, building (+ outline, opacity ramp), waterway
 *   added fills (just below `water`, so lagoons inside a park stay blue; owner 2026-11-04: "the current map should make
 *               green spaces like parks actually green"): sb_green (landcover class grass: parks, recreation grounds,
 *               lawns, gardens, golf courses, grassland; neither OpenFreeMap style draws them), sb_pitch (landuse
 *               pitch / playground), sb_cemetery (landuse cemetery), sb_campus (landuse university / college / school,
 *               a faint warm tint like Apple Maps' campuses)
 *   roads:      highway_path, highway_minor (wider, round caps), highway_major_casing,
 *               highway_major_inner, highway_motorway_casing, highway_motorway_inner
 *   hidden:     highway-shield-non-us, highway-shield-us-interstate, road_shield_us,
 *               road_oneway, road_oneway_opposite (POI-style clutter)
 *   replaced:   highway-name-path, highway-name-minor, highway-name-major (positron) and
 *               highway_name_other (dark) are removed and replaced by sb_name_* below
 *   labels:     label_* (positron) and place_* (dark) place names, water_name* / waterway_line_label
 *               recolored with a land-colored halo
 *   untouched:  motorway names (highway_name_motorway), railways, aeroways, boundaries
 *   added:      sb_minor_casing (below highway_minor: road/land contrast),
 *               sb_housenumber (source-layer housenumber, z>=17),
 *               sb_poi_campus (source-layer poi, z>=17 = map zoom 18 since 2026-10-13, when map/landmarks.js names the
 *               busy buildings from 14.5: college/school/library/hospital/museum/... names
 *               only, no icons; every other POI stays hidden; a name the landmarks below already show is skipped),
 *               sb_name_path (z>=16), sb_name_minor (z>=14), sb_name_major (z>=12.5): street names,
 *               no uppercase, 1.5 px halo in the land color, majors bold (DESIGN-SPEC 11.2). Added symbol layers sit in that
 *               order where the first original street-name layer was, so street names (on top) win label
 *               collisions over campus names, which win over house numbers. The curated building and place
 *               names (web/data/landmarks.json) are NOT basemap text: map/landmarks.js draws them above the route
 *               lines; patchStyle only keeps sb_poi_campus from repeating one of them.
 * Zooms: every minzoom / stop above is a MapLibre zoom, ONE LESS than the Leaflet map zoom the app uses (the
 * maplibre-gl-leaflet layer draws 512 px tiles at Leaflet zoom - 1): z14 street names show at map zoom 15.
 */

const BASE = 'https://tiles.openfreemap.org/styles/';
const link = (href, name) => `<a href="${href}" target="_blank" rel="noopener">${name}</a>`;
const DOT = ' <span aria-hidden="true">\u00b7</span> ';
/**
 * Map credit markup (map/credits.js shows it briefly at load; Settings > About keeps the full credits). No copyright sign: the OSMF attribution guidelines only
 * require crediting "OpenStreetMap" (linked to its copyright page); OpenMapTiles asks for a visible
 * "OpenMapTiles" credit; OpenFreeMap serves the tiles.
 */
export const ATTRIBUTION = link('https://openfreemap.org', 'OpenFreeMap') + DOT + link('https://openmaptiles.org/', 'OpenMapTiles')
  + DOT + link('https://www.openstreetmap.org/copyright', 'OpenStreetMap');
/** Credit for the OSM raster fallback. */
export const RASTER_ATTRIBUTION = link('https://www.openstreetmap.org/copyright', 'OpenStreetMap');
const COPY = /(&copy;|\u00a9)\s*/g;

/**
 * Basemap palettes, closer to Apple Maps (owner 2026-11-04: "Change the background map to resemble something closer to
 * apple maps"; DESIGN-SPEC-GLASS 18.1). Light: a warm off-white land, parks a fresh mid green (woods a step deeper),
 * water a clear blue, white streets with soft gray casing (main streets too, a step wider and a darker edge), only
 * motorways in Apple's yellow-orange (owner 2026-11-04: "Do not make the main streets yellow. The highways being yellow
 * is ok. This coloring of roads can confuse the user to think it is a bus line."), light warm gray buildings, labels
 * in a quiet gray hierarchy. Dark: a neutral dark gray land, deep muted greens that still read as green, a clear dark
 * blue, neutral gray streets with muted amber motorways. tests/map-style.js checks that no road but a motorway has a
 * yellow or orange hue. Street text vs its land-colored halo: light 7.3:1 (minor) / 12.6:1 (major), dark 9.6:1 / 12.8:1;
 * minor text on a road fill >= 6.6:1. Route lines have no casing since 2026-11-04 (owner: "Remove the outlines on each
 * line"), so a few route colors sit under 3:1 on the land (53RD yellow on the light map, RE navy on the dark one).
 */
export const PALETTE = {
  light: { bg: '#f5f3ee', park: '#c2e5ae', wood: '#aed79b', pitch: '#b5dda0', cemetery: '#d4e6c8', campus: '#efe9dc',
    resid: '#f2f0ea', water: '#a3d0f2', waterText: '#2b6596',
    bldg: '#e8e4dc', bldgLine: '#d6d0c5', path: '#d9d5cc', minor: '#ffffff', minorCase: '#d9d5cc', major: '#ffffff',
    majorCase: '#c9c4ba', motorway: '#f8c967', motorwayCase: '#d9a23a', text: '#2c2c2e', textMinor: '#4f4f54',
    halo: '#f5f3ee', hn: '#6a6a70', poi: '#545458', place: '#646469' },
  dark: { bg: '#202124', park: '#1f3c28', wood: '#1b3523', pitch: '#234430', cemetery: '#25332a', campus: '#28272b',
    resid: '#222326', water: '#1b3a5a', waterText: '#8fb8dc',
    bldg: '#2b2c30', bldgLine: '#36373c', path: '#3d3e43', minor: '#3a3b40', minorCase: '#141416', major: '#4d4e55',
    majorCase: '#141416', motorway: '#6a5a36', motorwayCase: '#141416', text: '#e5e5ea', textMinor: '#c7c7cc',
    halo: '#202124', hn: '#a1a1a6', poi: '#b6b9c0', place: '#a8a8ad' },
};

/** The green and campus fills patchStyle adds just below `water` (bottom to top). */
function addedFills(P) {
  const fill = (id, sourceLayer, classes, color, opacity) => ({
    id, type: 'fill', source: 'openmaptiles', 'source-layer': sourceLayer,
    filter: ['all', ['match', ['geometry-type'], ['MultiPolygon', 'Polygon'], true, false], ['match', ['get', 'class'], classes, true, false]],
    paint: { 'fill-color': color, 'fill-opacity': opacity, 'fill-antialias': true },
  });
  return [
    fill('sb_campus', 'landuse', ['university', 'college', 'school'], P.campus, 1),
    fill('sb_cemetery', 'landuse', ['cemetery'], P.cemetery, 1),
    fill('sb_green', 'landcover', ['grass'], P.park, zoomed([10, 0.6, 13, 1])),
    fill('sb_pitch', 'landuse', ['pitch', 'playground'], P.pitch, 1),
  ];
}

const NAME = ['coalesce', ['get', 'name_en'], ['get', 'name']];
const LINES = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const MAJOR = ['primary', 'secondary', 'tertiary', 'trunk'];
const CAMPUS_POI = ['college', 'school', 'library', 'hospital', 'museum', 'theatre', 'stadium'];
const STREET_NAME_IDS = /^(highway-name-(path|minor|major)|highway_name_other)$/;

/** The campus-name filter, skipping the OSM names a landmark label already shows (no name twice). */
export function campusFilter(list) {
  const names = [...new Set((Array.isArray(list) ? list : []).map((x) => x && x.osm).filter(Boolean).map(String))];
  const base = ['all', ['has', 'name'], ['match', ['get', 'class'], CAMPUS_POI, true, false]];
  return names.length ? [...base, ['!', ['in', ['get', 'name'], ['literal', names]]]] : base;
}

const zoomed = (stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
const widen = (stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops];
const paint = (l, o) => { l.paint = Object.assign(l.paint || {}, o); };
const layout = (l, o) => { l.layout = Object.assign(l.layout || {}, o); };

function nameLayer(id, P, { filter, minzoom, sizes, bold, color }) {
  return {
    id, type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', minzoom, filter,
    layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': [bold ? 'Noto Sans Bold' : 'Noto Sans Regular'],
      'text-size': zoomed(sizes), 'text-letter-spacing': 0.02, 'symbol-spacing': 280, 'text-padding': 3,
      'text-max-angle': 30, 'text-rotation-alignment': 'map', 'text-pitch-alignment': 'viewport' },
    paint: { 'text-color': color, 'text-halo-color': P.halo, 'text-halo-width': 1.5, 'text-halo-blur': 0.25 },   // spec 11.2: 1.5 px halo
  };
}

/** Symbol layers we add, in bottom-to-top order (top wins label collisions). */
function addedSymbols(P, landmarks) {
  return [
    { id: 'sb_housenumber', type: 'symbol', source: 'openmaptiles', 'source-layer': 'housenumber', minzoom: 17,
      layout: { 'text-field': ['get', 'housenumber'], 'text-font': ['Noto Sans Regular'],
        'text-size': zoomed([17, 10.5, 18, 12, 20, 14]), 'text-padding': 2, 'text-max-width': 5 },
      paint: { 'text-color': P.hn, 'text-halo-color': P.halo, 'text-halo-width': 1.6, 'text-halo-blur': 0.25 } },
    { id: 'sb_poi_campus', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 17,
      filter: campusFilter(landmarks),
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Bold'], 'text-size': zoomed([15, 11, 17, 12.5, 19, 14]),
        'text-max-width': 7, 'text-padding': 4, 'text-optional': true, 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99] },
      paint: { 'text-color': P.poi, 'text-halo-color': P.halo, 'text-halo-width': 1.5, 'text-halo-blur': 0.25 } },
    nameLayer('sb_name_path', P, { minzoom: 16, filter: ['==', ['get', 'class'], 'path'], sizes: [16, 10.5, 18, 12.5, 20, 14], color: P.textMinor }),
    nameLayer('sb_name_minor', P, { minzoom: 14, filter: ['all', LINES, ['match', ['get', 'class'], ['minor', 'service', 'track'], true, false]],
      sizes: [14, 10.5, 16, 12.5, 18, 14.5, 20, 16], color: P.textMinor }),
    nameLayer('sb_name_major', P, { minzoom: 12.5, filter: ['match', ['get', 'class'], MAJOR, true, false],
      sizes: [12.5, 11, 15, 12.5, 17, 14.5, 19, 16.5], bold: true, color: P.text }),
  ];
}

/**
 * Patch an OpenFreeMap positron/dark style for legible streets, house numbers and campus names.
 * Pure: never mutates the input. See the header comment for every layer id touched.
 * @param {object} styleJson MapLibre style (version 8)
 * @param {boolean} isDark
 * @param {Array<object>} [landmarks] store.landmarks: their OSM names are left out of sb_poi_campus (no name twice)
 * @returns {object} patched deep copy
 */
export function patchStyle(styleJson, isDark, landmarks = []) {
  const s = JSON.parse(JSON.stringify(styleJson || { version: 8, sources: {}, layers: [] }));
  const P = isDark ? PALETTE.dark : PALETTE.light;
  const out = [];
  let namesAt = -1, fillsIn = false;
  for (const l of s.layers || []) {
    const id = l.id;
    if (STREET_NAME_IDS.test(id)) { if (namesAt < 0) namesAt = out.length; continue; }
    if (id === 'water' && !fillsIn) { out.push(...addedFills(P)); fillsIn = true; }   // parks below water: lagoons stay blue
    if (id === 'background') paint(l, { 'background-color': P.bg });
    else if (id === 'water') paint(l, { 'fill-color': P.water });
    else if (id === 'waterway') paint(l, { 'line-color': P.water });
    else if (id === 'park' || id === 'landuse_park') paint(l, { 'fill-color': P.park });
    else if (id === 'landcover_wood') { paint(l, { 'fill-color': P.wood }); delete l.paint['fill-pattern']; }   // dark: "wood-pattern" is not in the OpenFreeMap sprite (console warning, no fill)
    else if (id === 'landuse_residential') paint(l, { 'fill-color': P.resid });
    else if (id === 'building') {
      paint(l, { 'fill-color': P.bldg, 'fill-outline-color': P.bldgLine, 'fill-opacity': zoomed([13, 0.5, 15, 0.9, 16, 1]) });
    } else if (id === 'highway_path') {
      paint(l, { 'line-color': P.path, 'line-opacity': 1, 'line-width': zoomed([14, 0.8, 16, 1.6, 18, 3, 20, 6]) });
    } else if (id === 'highway_minor') {
      const c = JSON.parse(JSON.stringify(l));
      c.id = 'sb_minor_casing';
      c.minzoom = Math.max(13, c.minzoom || 0);
      paint(c, { 'line-color': P.minorCase, 'line-opacity': 1, 'line-width': widen([13, 2.4, 16, 6.8, 18, 14.5, 20, 25]) });
      layout(c, { 'line-cap': 'round', 'line-join': 'round' });
      out.push(c);
      paint(l, { 'line-color': P.minor, 'line-opacity': 1, 'line-width': widen([13, 1.4, 16, 4.8, 18, 12, 20, 22]) });
      layout(l, { 'line-cap': 'round', 'line-join': 'round' });
    } else if (id === 'highway_major_casing') {
      paint(l, { 'line-color': P.majorCase, 'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 10, 3.2, 16, 9.5, 20, 27] });
      layout(l, { 'line-cap': 'round', 'line-join': 'round' });
    } else if (id === 'highway_major_inner') {
      paint(l, { 'line-color': P.major, 'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 10, 2, 16, 7.4, 20, 23] });
    } else if (id === 'highway_motorway_casing' || id === 'highway_motorway_bridge_casing') paint(l, { 'line-color': P.motorwayCase });
    else if (id === 'highway_motorway_inner' || id === 'highway_motorway_bridge_inner') paint(l, { 'line-color': P.motorway });
    else if (/^(highway-shield|road_shield|road_oneway)/.test(id)) layout(l, { visibility: 'none' });
    else if (/^(label_|place_)/.test(id) && l.type === 'symbol') {
      paint(l, { 'text-color': P.place, 'text-halo-color': P.halo, 'text-halo-width': 1.4, 'text-halo-blur': 0.3 });
    } else if (/^water(way)?_(name|line)/.test(id) && l.type === 'symbol') {
      paint(l, { 'text-color': P.waterText, 'text-halo-color': P.halo, 'text-halo-width': 1.2 });
    }
    out.push(l);
  }
  out.splice(namesAt < 0 ? out.length : namesAt, 0, ...addedSymbols(P, landmarks));
  if (!fillsIn) {   // a style without a water layer: the fills go right above the background
    const at = out.findIndex((l) => l.type === 'background');
    out.splice(at + 1, 0, ...addedFills(P));
  }
  s.layers = out;
  // source credits carry "&copy;" too; nothing shows them today (the GL map has no attribution
  // control), but keep them sign-free so no copyright sign can surface
  for (const src of Object.values(s.sources || {})) {
    if (src && typeof src.attribution === 'string') src.attribution = src.attribution.replace(COPY, '').replace(/\s{2,}/g, ' ').trim();
  }
  return s;
}

/**
 * Background-only placeholder style shown until the real style loads (or if it never does).
 * @param {boolean} isDark
 * @returns {object}
 */
export function emptyStyle(isDark) {
  const P = isDark ? PALETTE.dark : PALETTE.light;
  return { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': P.bg } }] };
}

const cache = new Map();
function loadBase(name) {
  if (!cache.has(name)) {
    cache.set(name, fetch(BASE + name).then((r) => { if (!r.ok) throw new Error('style ' + r.status); return r.json(); })
      .catch((e) => { cache.delete(name); throw e; }));
  }
  return cache.get(name);
}

/**
 * The basemap's text (symbol) layer ids, read once per style change (2026-11-05 optimization run). getStyle() serializes
 * the whole style (every layer, deep copied), and map/landmarks.js asks textAt() for every box it tries, after every move
 * and every time the basemap goes idle: that was tens of full style copies per label pass on the main thread.
 * @param {object} gl a MapLibre map
 * @param {{gl?:object, rev?:number, ids?:string[]}} cache kept by the caller
 * @param {number} rev the caller's style revision (bumped on every 'styledata')
 * @returns {string[]}
 */
export function symbolIds(gl, cache, rev) {
  if (cache.ids && cache.gl === gl && cache.rev === rev) return cache.ids;
  const ids = (gl.getStyle()?.layers || []).filter((l) => l.type === 'symbol').map((l) => l.id);
  Object.assign(cache, { gl, rev, ids });
  return ids;
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch (e) { return false; }
}

/**
 * Create and add the basemap layer to a Leaflet map.
 * @param {L.Map} map
 * @param {boolean} isDark
 * @returns {{kind:'vector'|'raster', layer:L.Layer, attribution:string, setDark(isDark:boolean):void,
 *   setLandmarks(list:Array<object>):void, textAt(box):boolean}} attribution: credit markup; setLandmarks: the OSM
 *   names the campus-name layer must not repeat (map/landmarks.js draws them); textAt: a street or place name is drawn
 *   in this box of the Leaflet container (map/landmarks.js keeps building names off them)
 */
export function createBasemap(map, isDark) {
  const L = window.L;
  let dark = !!isDark, marks = [];
  if (window.maplibregl && L.maplibreGL && hasWebGL()) {
    try {
      // the plugin reads attribution from options.attributionControl.customAttribution (getAttribution())
      const make = () => {
        const l = L.maplibreGL({ style: emptyStyle(dark), attributionControl: { customAttribution: ATTRIBUTION }, interactive: false });
        l.addTo(map);
        return l;
      };
      let layer = make(), token = 0, tries = 0, retry = 0, lostAt = 0, loaded = false;
      const RETRY_S = [2, 5, 10, 20, 40, 60];
      const apply = () => {
        const my = ++token, want = dark;
        clearTimeout(retry);
        loadBase(want ? 'dark' : 'positron').then((base) => {
          const gl = layer.getMaplibreMap?.();
          if (my === token && gl) { gl.setStyle(patchStyle(base, want, marks)); tries = 0; loaded = true; }
        }).catch(() => {   // a failed download used to leave a blank map until the next 'online' event: retry
          if (my === token && tries < RETRY_S.length) retry = setTimeout(apply, RETRY_S[tries++] * 1000);
        });
      };
      // phones drop WebGL contexts (memory pressure, the app in the background): rebuild the layer if it does not
      // come back by itself, so the streets never stay blank until a reload
      // landmarks that arrive while a style is still loading: update its campus-name filter once it is in
      let filtered = null, textLayers = {}, styleRev = 0;
      const syncMarks = () => {
        const gl = layer.getMaplibreMap?.();
        try {
          if (!gl?.getLayer?.('sb_poi_campus') || filtered === gl.getLayer('sb_poi_campus') && gl.sbMarks === marks) return;
          gl.setFilter('sb_poi_campus', campusFilter(marks));
          filtered = gl.getLayer('sb_poi_campus'); gl.sbMarks = marks;
        } catch (e) { /* style mid-swap: styledata fires again */ }
      };
      const idleFns = new Set();
      const watchGl = () => {
        const gl = layer.getMaplibreMap?.();
        if (!gl?.on) return;
        gl.on('styledata', () => { styleRev++; syncMarks(); });   // textAt reads the symbol layers again (symbolIds)
        gl.on('idle', () => { for (const fn of idleFns) { try { fn(); } catch (e) { console.error(e); } } });   // labels placed: textAt is current
        gl.on('webglcontextlost', () => { lostAt = Date.now(); setTimeout(checkGl, 2500); });
        gl.on('webglcontextrestored', () => { lostAt = 0; });
      };
      const contextLost = () => {
        try { const c = layer.getMaplibreMap?.()?.getCanvas?.(); const ctx = c && (c.getContext('webgl2') || c.getContext('webgl')); return !!ctx?.isContextLost?.(); } catch (e) { return false; }
      };
      const checkGl = () => {
        if (!(lostAt && Date.now() - lostAt >= 2000) && !contextLost()) return;
        lostAt = 0;
        try { map.removeLayer(layer); } catch (e) { /* already gone */ }
        layer = make();
        watchGl();
        apply();
      };
      watchGl();
      apply();
      window.addEventListener('online', apply);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        if (contextLost()) checkGl(); else if (!loaded) { tries = 0; apply(); }
      });
      return { kind: 'vector', get layer() { return layer; }, attribution: ATTRIBUTION,
        setDark(d) { if (!!d === dark) return; dark = !!d; tries = 0; apply(); },
        setLandmarks(list) { marks = Array.isArray(list) ? list : []; syncMarks(); },   // style not in yet: apply() / styledata
        /** Called each time the basemap has drawn and placed its labels (after a move, tiles, a style). @returns {()=>void} off */
        onIdle(fn) { if (typeof fn === 'function') idleFns.add(fn); return () => idleFns.delete(fn); },
        textAt(box) {
          const gl = layer.getMaplibreMap?.();
          try {
            if (!gl?.isStyleLoaded?.()) return false;
            const ids = symbolIds(gl, textLayers, styleRev);
            // the GL canvas is larger than the Leaflet container and offset: map both through the same latlng
            const o = gl.project(map.containerPointToLatLng([0, 0]));
            return gl.queryRenderedFeatures([[box.x + o.x, box.y + o.y], [box.x + box.w + o.x, box.y + box.h + o.y]], { layers: ids }).length > 0;
          } catch (e) { return false; }
        } };
    } catch (e) { /* fall through to raster */ }
  }
  const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: RASTER_ATTRIBUTION, className: 'sb-raster' });
  layer.addTo(map);
  return { kind: 'raster', layer, attribution: RASTER_ATTRIBUTION, setDark(d) { dark = !!d; /* .sb-dark .sb-raster in map.css inverts */ },
    setLandmarks() { /* the raster tiles' own names are pixels: nothing to filter */ }, textAt: () => false, onIdle: () => () => {} };
}

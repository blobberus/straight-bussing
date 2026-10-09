/**
 * map/style.js: basemap. OpenFreeMap vector styles (positron = light, dark = dark) patched at runtime
 * by the pure `patchStyle(styleJson, isDark)` for legible street names and house numbers, then shown
 * through L.maplibreGL. Theme changes call gl.setStyle on the SAME layer (the Leaflet map is never
 * recreated). Without maplibre/WebGL it falls back to OSM raster tiles (CSS-inverted in dark).
 *
 * Layer ids patched by patchStyle (OpenMapTiles schema; ids from positron and dark as of 2026-10):
 *   recolored:  background, water, park (positron), landuse_park (dark), landuse_residential,
 *               landcover_wood, building (+ outline, opacity ramp), waterway
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
 *               sb_poi_campus (source-layer poi, z>=15: college/school/library/hospital/museum/... names
 *               only, no icons; every other POI stays hidden),
 *               sb_name_path (z>=16), sb_name_minor (z>=14), sb_name_major (z>=12.5): street names,
 *               no uppercase, 2 px halo in the land color, majors bold. Added symbol layers sit in that
 *               order where the first original street-name layer was, so street names (on top) win
 *               label collisions over campus names, which win over house numbers.
 */

const BASE = 'https://tiles.openfreemap.org/styles/';
const link = (href, name) => `<a href="${href}" target="_blank" rel="noopener">${name}</a>`;
const DOT = ' <span aria-hidden="true">\u00b7</span> ';
/**
 * Map credit markup (map/credits.js shows it). No copyright sign: the OSMF attribution guidelines only
 * require crediting "OpenStreetMap" (linked to its copyright page); OpenMapTiles asks for a visible
 * "OpenMapTiles" credit; OpenFreeMap serves the tiles.
 */
export const ATTRIBUTION = link('https://openfreemap.org', 'OpenFreeMap') + DOT + link('https://openmaptiles.org/', 'OpenMapTiles')
  + DOT + link('https://www.openstreetmap.org/copyright', 'OpenStreetMap');
/** Credit for the OSM raster fallback. */
export const RASTER_ATTRIBUTION = link('https://www.openstreetmap.org/copyright', 'OpenStreetMap');
const COPY = /(&copy;|\u00a9)\s*/g;

/** Basemap palettes. Street text vs road fill: light 12.9:1, dark 9.6:1. */
export const PALETTE = {
  light: { bg: '#eeefeb', park: '#d8e7d0', wood: '#dfe9d8', resid: '#eaeae5', water: '#aecde3', waterText: '#3f6a8c',
    bldg: '#e1e0da', bldgLine: '#c6c4bc', path: '#d3cfc2', minor: '#ffffff', minorCase: '#cdd0ca', major: '#ffffff',
    majorCase: '#adb1aa', motorway: '#fbe3a6', motorwayCase: '#d8b878', text: '#26272c', textMinor: '#3e3f46',
    halo: '#ffffff', hn: '#62656d', poi: '#2c4a66', place: '#696b72' },
  dark: { bg: '#18181b', park: '#1b2620', wood: '#1a221d', resid: '#1a1a1d', water: '#0f2232', waterText: '#86a9c6',
    bldg: '#25252a', bldgLine: '#37373f', path: '#404048', minor: '#37373e', minorCase: '#0b0b0d', major: '#4b4b54',
    majorCase: '#0b0b0d', motorway: '#5d5547', motorwayCase: '#0b0b0d', text: '#efeff4', textMinor: '#d6d6de',
    halo: '#18181b', hn: '#adadb8', poi: '#bcd0e2', place: '#a0a0aa' },
};

const NAME = ['coalesce', ['get', 'name_en'], ['get', 'name']];
const LINES = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const MAJOR = ['primary', 'secondary', 'tertiary', 'trunk'];
const CAMPUS_POI = ['college', 'school', 'library', 'hospital', 'museum', 'theatre', 'stadium'];
const STREET_NAME_IDS = /^(highway-name-(path|minor|major)|highway_name_other)$/;

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
    paint: { 'text-color': color, 'text-halo-color': P.halo, 'text-halo-width': 2, 'text-halo-blur': 0.25 },
  };
}

/** Symbol layers we add, in bottom-to-top order (top wins label collisions). */
function addedSymbols(P) {
  return [
    { id: 'sb_housenumber', type: 'symbol', source: 'openmaptiles', 'source-layer': 'housenumber', minzoom: 17,
      layout: { 'text-field': ['get', 'housenumber'], 'text-font': ['Noto Sans Regular'],
        'text-size': zoomed([17, 10.5, 18, 12, 20, 14]), 'text-padding': 2, 'text-max-width': 5 },
      paint: { 'text-color': P.hn, 'text-halo-color': P.halo, 'text-halo-width': 1.6, 'text-halo-blur': 0.25 } },
    { id: 'sb_poi_campus', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 15,
      filter: ['all', ['has', 'name'], ['match', ['get', 'class'], CAMPUS_POI, true, false]],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Bold'], 'text-size': zoomed([15, 11, 17, 12.5, 19, 14]),
        'text-max-width': 7, 'text-padding': 4, 'text-optional': true, 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99] },
      paint: { 'text-color': P.poi, 'text-halo-color': P.halo, 'text-halo-width': 1.8, 'text-halo-blur': 0.25 } },
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
 * @returns {object} patched deep copy
 */
export function patchStyle(styleJson, isDark) {
  const s = JSON.parse(JSON.stringify(styleJson || { version: 8, sources: {}, layers: [] }));
  const P = isDark ? PALETTE.dark : PALETTE.light;
  const out = [];
  let namesAt = -1;
  for (const l of s.layers || []) {
    const id = l.id;
    if (STREET_NAME_IDS.test(id)) { if (namesAt < 0) namesAt = out.length; continue; }
    if (id === 'background') paint(l, { 'background-color': P.bg });
    else if (id === 'water') paint(l, { 'fill-color': P.water });
    else if (id === 'waterway') paint(l, { 'line-color': P.water });
    else if (id === 'park' || id === 'landuse_park') paint(l, { 'fill-color': P.park });
    else if (id === 'landcover_wood') paint(l, { 'fill-color': P.wood });
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
    } else if (id === 'highway_motorway_casing') paint(l, { 'line-color': P.motorwayCase });
    else if (id === 'highway_motorway_inner') paint(l, { 'line-color': P.motorway });
    else if (/^(highway-shield|road_shield|road_oneway)/.test(id)) layout(l, { visibility: 'none' });
    else if (/^(label_|place_)/.test(id) && l.type === 'symbol') {
      paint(l, { 'text-color': P.place, 'text-halo-color': P.halo, 'text-halo-width': 1.4, 'text-halo-blur': 0.3 });
    } else if (/^water(way)?_(name|line)/.test(id) && l.type === 'symbol') {
      paint(l, { 'text-color': P.waterText, 'text-halo-color': P.halo, 'text-halo-width': 1.2 });
    }
    out.push(l);
  }
  out.splice(namesAt < 0 ? out.length : namesAt, 0, ...addedSymbols(P));
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
 * @returns {{kind:'vector'|'raster', layer:L.Layer, attribution:string, setDark(isDark:boolean):void}} attribution: credit markup
 */
export function createBasemap(map, isDark) {
  const L = window.L;
  let dark = !!isDark;
  if (window.maplibregl && L.maplibreGL && hasWebGL()) {
    try {
      // the plugin reads attribution from options.attributionControl.customAttribution (getAttribution())
      const layer = L.maplibreGL({ style: emptyStyle(dark), attributionControl: { customAttribution: ATTRIBUTION }, interactive: false });
      layer.addTo(map);
      let token = 0;
      const apply = () => {
        const my = ++token, want = dark;
        loadBase(want ? 'dark' : 'positron').then((base) => {
          const gl = layer.getMaplibreMap?.();
          if (my === token && gl) gl.setStyle(patchStyle(base, want));
        }).catch(() => { /* offline: keep the background; overlays still work */ });
      };
      apply();
      window.addEventListener('online', apply);
      return { kind: 'vector', layer, attribution: ATTRIBUTION, setDark(d) { if (!!d === dark) return; dark = !!d; apply(); } };
    } catch (e) { /* fall through to raster */ }
  }
  const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: RASTER_ATTRIBUTION, className: 'sb-raster' });
  layer.addTo(map);
  return { kind: 'raster', layer, attribution: RASTER_ATTRIBUTION, setDark(d) { dark = !!d; /* .sb-dark .sb-raster in map.css inverts */ } };
}

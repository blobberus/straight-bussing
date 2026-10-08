/**
 * Fixtures for map tests: trimmed OpenFreeMap positron/dark styles (real layer ids, minimal bodies)
 * and small synthetic route geometries. Coordinates near campus (41.79, -87.60).
 */

const src = { source: 'openmaptiles' };
const LINES = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const nameField = ['coalesce', ['get', 'name_en'], ['get', 'name']];

/** Trimmed positron style. */
export const POSITRON = {
  version: 8, name: 'Positron', glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': 'rgb(242,243,240)' } },
    { id: 'park', type: 'fill', ...src, 'source-layer': 'park', paint: { 'fill-color': 'rgb(230, 233, 229)' } },
    { id: 'water', type: 'fill', ...src, 'source-layer': 'water', paint: { 'fill-color': 'rgb(194, 200, 202)' } },
    { id: 'landuse_residential', type: 'fill', ...src, 'source-layer': 'landuse', paint: { 'fill-color': 'rgb(234, 234, 230)' } },
    { id: 'building', type: 'fill', ...src, 'source-layer': 'building', minzoom: 12, paint: { 'fill-color': 'rgb(234, 234, 229)' } },
    { id: 'highway_path', type: 'line', ...src, 'source-layer': 'transportation', paint: { 'line-color': 'rgb(234, 234, 234)' } },
    { id: 'highway_minor', type: 'line', ...src, 'source-layer': 'transportation', minzoom: 8, filter: ['all', LINES],
      layout: { 'line-cap': 'round' }, paint: { 'line-color': 'hsl(0,0%,88%)', 'line-width': 2 } },
    { id: 'highway_major_casing', type: 'line', ...src, 'source-layer': 'transportation', minzoom: 11, paint: { 'line-color': 'rgb(213, 213, 213)' } },
    { id: 'highway_major_inner', type: 'line', ...src, 'source-layer': 'transportation', minzoom: 11, paint: { 'line-color': '#fff' } },
    { id: 'highway-name-path', type: 'symbol', ...src, 'source-layer': 'transportation_name', minzoom: 15.5,
      layout: { 'text-field': nameField, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': 'hsl(30,0%,62%)' } },
    { id: 'highway-name-minor', type: 'symbol', ...src, 'source-layer': 'transportation_name', minzoom: 15,
      layout: { 'text-field': nameField, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#666' } },
    { id: 'highway-name-major', type: 'symbol', ...src, 'source-layer': 'transportation_name', minzoom: 12.2,
      layout: { 'text-field': nameField, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#666' } },
    { id: 'highway-shield-non-us', type: 'symbol', ...src, 'source-layer': 'transportation_name', layout: {} },
    { id: 'road_shield_us', type: 'symbol', ...src, 'source-layer': 'transportation_name', layout: {} },
    { id: 'label_other', type: 'symbol', ...src, 'source-layer': 'place',
      layout: { 'text-field': nameField, 'text-font': ['Noto Sans Italic'], 'text-transform': 'uppercase' }, paint: { 'text-color': '#333' } },
  ],
};

/** Trimmed dark style. */
export const DARK = {
  version: 8, name: 'Dark', glyphs: POSITRON.glyphs, sources: POSITRON.sources,
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': 'rgb(12,12,12)' } },
    { id: 'water', type: 'fill', ...src, 'source-layer': 'water', paint: { 'fill-color': 'rgb(27 ,27 ,29)' } },
    { id: 'landuse_park', type: 'fill', ...src, 'source-layer': 'landuse', paint: { 'fill-color': 'rgb(32,32,32)' } },
    { id: 'building', type: 'fill', ...src, 'source-layer': 'building', minzoom: 12, paint: { 'fill-color': 'rgb(10,10,10)' } },
    { id: 'highway_minor', type: 'line', ...src, 'source-layer': 'transportation', minzoom: 8, paint: { 'line-color': '#181818' } },
    { id: 'highway_major_casing', type: 'line', ...src, 'source-layer': 'transportation', paint: { 'line-color': 'rgba(60,60,60,0.8)' } },
    { id: 'highway_major_inner', type: 'line', ...src, 'source-layer': 'transportation', paint: { 'line-color': 'hsl(0,0%,7%)' } },
    { id: 'road_oneway', type: 'symbol', ...src, 'source-layer': 'transportation', minzoom: 15, layout: { 'icon-image': 'oneway' } },
    { id: 'road_oneway_opposite', type: 'symbol', ...src, 'source-layer': 'transportation', minzoom: 15, layout: { 'icon-image': 'oneway' } },
    { id: 'highway_name_other', type: 'symbol', ...src, 'source-layer': 'transportation_name',
      layout: { 'text-field': nameField, 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-transform': 'uppercase' },
      paint: { 'text-color': 'rgba(80, 78, 78, 1)' } },
    { id: 'highway_name_motorway', type: 'symbol', ...src, 'source-layer': 'transportation_name',
      layout: { 'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': 'rgb(117, 129, 145)' } },
    { id: 'place_suburb', type: 'symbol', ...src, 'source-layer': 'place',
      layout: { 'text-field': nameField, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': 'rgb(101,101,101)' } },
  ],
};

const U = 0.002; // ~166 m of longitude here
const lat0 = 41.79, lon0 = -87.6;
/** Point on a synthetic grid: x,y in units of U degrees from (lat0, lon0). */
export const P = (x, y = 0) => [lat0 + y * U, lon0 + x * U];

/** Square loop A(0,0) -> B(4,0) -> C(4,4) -> D(0,4) -> A, densified every unit. */
export function squareLoop() {
  const pts = [];
  for (let i = 0; i < 4; i++) pts.push(P(i, 0));
  for (let i = 0; i < 4; i++) pts.push(P(4, i));
  for (let i = 4; i > 0; i--) pts.push(P(i, 4));
  for (let i = 4; i >= 0; i--) pts.push(P(0, i));
  return pts;
}

/** Out-and-back along y=0: x 0 -> 6 then back to 0 on the same street (exactly the same coordinates). */
export function outAndBack() {
  const pts = [];
  for (let i = 0; i <= 6; i++) pts.push(P(i, 0));
  for (let i = 5; i >= 0; i--) pts.push(P(i, 0));
  return pts;
}

/** Stop object from grid coords. */
export const stop = (id, x, y = 0) => { const [lat, lon] = P(x, y); return { id, lat, lon }; };

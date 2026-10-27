/** Entry for map.test.html: runs the map unit tests, or (?demo=light|dark) renders the overlay demo. */
const q = new URLSearchParams(location.search);
if (q.has('demo')) {
  import('./map-demo.js');
} else {
  const lib = await import('./lib.js');
  lib.holdRun();
  try {
    await import('./map-geometry.js');
    await import('./map-style.js');
    await import('./map-layers.js');
    await import('./map-track.js');
    await import('./map-direction.js');
    await import('./map-favorites.js');
    await import('./map-credits.js');
    await import('./map-trip.js');
    await import('./map-landmarks.js');
    await import('./map-compass.js');
    await import('./map-linetap.js');
  } catch (e) {
    lib.test('import map test modules', () => { throw e; });
  }
  lib.run();
}

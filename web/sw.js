// Service worker: offline app shell. Network-first so deploys show up immediately.
// Live feeds and map tiles are cross-origin and never touched (stale bus data is unsafe).
const CACHE = 'sb-v2-25';
// PRECACHE:BEGIN (generated list; keep one path per line)
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/base.css',
  'css/components.css',
  'css/map.css',
  'css/sheet.css',
  'css/tokens.css',
  'css/views.css',
  'css/routes.css',
  'css/route.css',
  'css/myroutes.css',
  'css/journey.css',
  'css/trip.css',
  'css/settings.css',
  'js/main.js',
  'js/state.js',
  'js/core/arrivals.js',
  'js/core/custom.js',
  'js/core/esc.js',
  'js/core/events.js',
  'js/core/geo.js',
  'js/core/notify.js',
  'js/core/operating.js',
  'js/core/planner.js',
  'js/core/predict.js',
  'js/core/rank.js',
  'js/core/schedule.js',
  'js/core/storage.js',
  'js/core/store.js',
  'js/core/time.js',
  'js/core/tripprogress.js',
  'js/core/visibility.js',
  'js/core/walk.js',
  'js/data/geocode.js',
  'js/data/live.js',
  'js/data/places.js',
  'js/data/spell.js',
  'js/data/static.js',
  'js/map/chevrons.js',
  'js/map/credits.js',
  'js/map/favorites.js',
  'js/map/geometry.js',
  'js/map/layers.js',
  'js/map/map.js',
  'js/map/style.js',
  'js/ui/actions.js',
  'js/ui/components.js',
  'js/ui/confirm.js',
  'js/ui/contextbar.js',
  'js/ui/frame.js',
  'js/ui/notifier.js',
  'js/ui/router.js',
  'js/ui/settings-overlay.js',
  'js/ui/sheet.js',
  'js/ui/theme.js',
  'js/ui/update.js',
  'js/ui/views/about.js',
  'js/ui/views/alerts.js',
  'js/ui/views/directions.js',
  'js/ui/views/journey.js',
  'js/ui/views/myroutes-patch.js',
  'js/ui/views/myroutes-swipe.js',
  'js/ui/views/myroutes.js',
  'js/ui/views/nearby.js',
  'js/ui/views/pick.js',
  'js/ui/views/placesearch.js',
  'js/ui/views/route.js',
  'js/ui/views/routes-drag.js',
  'js/ui/views/routes.js',
  'js/ui/views/settings.js',
  'js/ui/views/stop.js',
  'js/ui/views/tripprogress.js',
  'js/ui/views/tripinfo.js',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'data/routes.json',
  'data/stops.json',
  'data/shapes.json',
  'data/route_stops.json',
  'data/stop_addresses.json',
  'data/segments.json',
  'data/meta.json',
  'data/places.json',
  'data/service.json',
];
// PRECACHE:END

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // add individually so one missing file never breaks install
      .then((c) => Promise.allSettled(PRECACHE.map((u) => fetch(u, { cache: 'no-cache' })
        .then((r) => (r.ok && r.status === 200 ? c.put(u, r) : null)))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return; // cross-origin: straight to network, never cached
  if (u.pathname.includes('/tests/') || req.headers.has('range')) return;
  const nav = req.mode === 'navigate';
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((r) => {
        if (r.ok && r.status === 200 && r.type === 'basic') {
          const copy = r.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
        }
        return r;
      })
      .catch(async () => {
        const hit = await caches.match(req, { cacheName: CACHE }) || (nav ? null : await caches.match(req, { cacheName: CACHE, ignoreSearch: true }));
        if (hit) return hit;
        if (nav) {
          const shell = await caches.match('index.html', { cacheName: CACHE }) || await caches.match('./', { cacheName: CACHE });
          if (shell) return shell;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
      }),
  );
});

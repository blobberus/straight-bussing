// Cache the app shell only. Live feeds are never cached (stale bus data is unsafe).
const CACHE = "sb-shell-v10";
const SHELL = ["./", "index.html", "style.css", "app.js", "planner.js", "walk.js", "predict.js", "theme.js", "mapstyle.js", "manifest.webmanifest", "icons/icon.svg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return; // live feeds + map tiles go straight to network
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { if (r.ok && r.status === 200) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
});

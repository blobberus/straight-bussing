import { test, eq, ok } from './lib.js';

const ROOT = new URL('../', location.href);

test('pwa: every sw.js PRECACHE entry exists (no stale shell list)', async () => {
  const src = await (await fetch(new URL('sw.js', ROOT), { cache: 'no-store' })).text();
  ok(/const CACHE = 'sb-v2-\d+'/.test(src), 'cache name sb-v2-<n>');
  const m = src.match(/const PRECACHE = \[([\s\S]*?)\];/);
  ok(m, 'PRECACHE list found');
  const entries = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  ok(entries.includes('index.html') && entries.includes('./'), 'shell entries');
  ok(!entries.some((e) => e.includes('tests/')), 'tests never precached');
  const missing = [];
  for (const e of entries) {
    const r = await fetch(new URL(e, ROOT), { cache: 'no-store' });
    if (r.status !== 200) missing.push(e + ' ' + r.status);
  }
  eq(missing, []);
});

/** Recursively list files under a served directory (stdlib http.server directory listing). */
async function listDir(url, out = []) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok || !(r.headers.get('content-type') || '').includes('html')) return null;
  const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('?') || href.startsWith('/') || href.startsWith('..')) continue;
    const u = new URL(href, url);
    if (href.endsWith('/')) { if (!(await listDir(u.href, out))) return null; } else out.push(u.href);
  }
  return out;
}

test('pwa: every web/css and web/js file is in the sw.js PRECACHE list (offline shell complete)', async () => {
  const src = await (await fetch(new URL('sw.js', ROOT), { cache: 'no-store' })).text();
  const entries = new Set([...src.match(/const PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  const files = [];
  for (const d of ['css/', 'js/']) {
    const got = await listDir(new URL(d, ROOT).href);
    if (!got) return; // server without directory listings: nothing to compare
    files.push(...got.map((u) => u.slice(ROOT.href.length)).filter((p) => /\.(css|js)$/.test(p)));
  }
  eq(files.filter((p) => !entries.has(p)), [], 'files missing from PRECACHE (add them to sw.js)');
});

// Service-worker install cannot be exercised here: headless --virtual-time-budget stalls SW
// installation. It was verified manually (real-time headless Edge: installs, precaches the list,
// serves cached index.html for navigations when the server is down). Static policy checks instead:
test('pwa: sw.js keeps the caching policy (network-first, same-origin, 200-only, claim)', async () => {
  const src = await (await fetch(new URL('sw.js', ROOT), { cache: 'no-store' })).text();
  for (const needle of ["cache: 'no-cache'", 'r.ok && r.status === 200', 'self.location.origin', 'skipWaiting()',
    'clients.claim()', "req.method !== 'GET'", "mode === 'navigate'", 'caches.delete(k)', "'/tests/'"]) {
    ok(src.includes(needle), 'sw.js contains ' + needle);
  }
});

// index.html preloads every module of the first render (main.js, its static imports, and the views main.js imports at
// boot), so the browser fetches them in parallel instead of one import level at a time (8 levels deep).
test('pwa: index.html preloads exactly the first-render modules, and main.js under the same URL as its script', async () => {
  const html = await (await fetch(new URL('index.html', ROOT), { cache: 'no-store' })).text();
  const pre = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
  const script = (html.match(/<script type="module" src="([^"]+)"><\/script>/) || [])[1];
  ok(script && pre.includes(script), 'main.js is preloaded under its <script> URL (' + script + '), so it is fetched once');
  const imports = (src, from) => [...src.matchAll(/^\s*import\s[^;]*?from\s+["'](\.[^"']+)["']|^\s*import\s+["'](\.[^"']+)["']/gm)]
    .map((m) => new URL(m[1] || m[2], new URL(from, ROOT)).href.slice(new URL('.', ROOT).href.length));
  const graph = new Set(), queue = ['js/main.js'];
  const mainSrc = await (await fetch(new URL('js/main.js', ROOT), { cache: 'no-store' })).text();
  const views = JSON.parse(mainSrc.match(/VIEW_IDS = Object\.freeze\((\[[^\]]*\])\)/)[1]);
  queue.push(...views.map((v) => `js/ui/views/${v}.js`));
  while (queue.length) {
    const p = queue.shift();
    if (graph.has(p)) continue;
    graph.add(p);
    const r = await fetch(new URL(p, ROOT), { cache: 'no-store' });
    eq(r.status, 200, p);
    queue.push(...imports(await r.text(), p));
  }
  const listed = new Set(pre.map((h) => h.split('?')[0]));
  eq([...graph].filter((p) => !listed.has(p)), [], 'first-render modules missing from the modulepreload list in index.html');
  eq([...listed].filter((p) => !graph.has(p)), [], 'preloaded but not part of the first render (remove from index.html)');
  eq(pre.length, listed.size, 'no module preloaded twice');
});

/** Run sw.js's fetch handler offline (fetch always fails) against a fake cache: what does a request get? */
async function offlineFetch(src, cached, url, mode) {
  const base = 'https://x.test/app/', listeners = {};
  const fakeSelf = { addEventListener: (t, fn) => { listeners[t] = fn; }, location: { origin: 'https://x.test' },
    skipWaiting: () => {}, clients: { claim: () => {} } };
  const fakeCaches = {
    async match(req, o = {}) {
      const u = new URL(typeof req === 'string' ? req : req.url, base);
      for (const [k, v] of cached) {
        const c = new URL(k, base);
        if (c.pathname === u.pathname && (o.ignoreSearch || c.search === u.search)) return v;
      }
      return undefined;
    },
    open: async () => ({ put: async () => {} }), keys: async () => [],
  };
  new Function('self', 'caches', 'fetch', 'Response', src)(fakeSelf, fakeCaches, () => Promise.reject(new TypeError('offline')), Response);
  let out = null;
  listeners.fetch({ request: { method: 'GET', url: base + url, mode, headers: new Headers() }, respondWith: (p) => { out = p; }, waitUntil: () => {} });
  const r = await out;
  return typeof r === 'string' ? r : r && r.status;
}

test('pwa: offline, a page opened with a query string gets that page, not the app (Contact support)', async () => {
  const src = await (await fetch(new URL('sw.js', ROOT), { cache: 'no-store' })).text();
  const cached = [['support.html', 'SUPPORT'], ['privacy.html', 'PRIVACY'], ['index.html', 'SHELL'], ['./', 'SHELL'], ['js/main.js', 'MAIN']];
  eq(await offlineFetch(src, cached, 'support.html?contact=1&app=web&v=2.0.0', 'navigate'), 'SUPPORT', "About's Contact support link");
  eq(await offlineFetch(src, cached, 'privacy.html', 'navigate'), 'PRIVACY');
  eq(await offlineFetch(src, cached, '?from=homescreen', 'navigate'), 'SHELL', 'the app with a query is still the app');
  eq(await offlineFetch(src, cached, 'no-such-page.html', 'navigate'), 'SHELL', 'unknown page: the app shell');
  eq(await offlineFetch(src, cached, 'js/main.js?v=3', 'cors'), 'MAIN', 'a file with a query: the cached file');
  eq(await offlineFetch(src, cached, 'data/missing.json', 'cors'), 503, 'nothing cached: offline 503, never the shell');
});

test('pwa: manifest is valid with standalone scope and a maskable 512 icon', async () => {
  const r = await fetch(new URL('manifest.webmanifest', ROOT), { cache: 'no-store' });
  const man = await r.json();
  eq([man.name, man.display, man.scope, man.start_url], ['Straight Bussing', 'standalone', './', './']);
  ok(/^#[0-9A-Fa-f]{6}$/.test(man.theme_color) && /^#[0-9A-Fa-f]{6}$/.test(man.background_color), 'colors');
  const mask = man.icons.find((i) => i.purpose === 'maskable');
  ok(mask && mask.sizes === '512x512', 'maskable 512');
  for (const icon of man.icons) {
    const ir = await fetch(new URL(icon.src, ROOT), { cache: 'no-store' });
    eq(ir.status, 200, icon.src);
    if (icon.type === 'image/png') {
      const dv = new DataView(await ir.arrayBuffer()); // PNG IHDR: width @16, height @20
      eq(dv.getUint32(0), 0x89504e47, icon.src + ' is PNG');
      eq(dv.getUint32(16) + 'x' + dv.getUint32(20), icon.sizes, icon.src + ' size');
    }
  }
});

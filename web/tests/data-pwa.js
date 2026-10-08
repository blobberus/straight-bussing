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

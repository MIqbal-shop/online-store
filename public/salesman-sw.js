/* Service worker for the Salesman/Manager app: lets it open with no internet.
 * Only the app's own files are cached (never the store site or the admin panel),
 * and data is NOT cached here: the app keeps its own saved copy of the data. */
const V = 'sm-v1';
const SHELL = ['/salesman.html', '/salesman-export.js', '/salesman.webmanifest', '/salesman-192.png', '/salesman-512.png', '/salesman-maskable-512.png',
  '/vendor/jspdf.umd.min.js', '/vendor/jspdf.plugin.autotable.min.js', '/vendor/html2canvas.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('sm-') && k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !SHELL.includes(u.pathname)) return;
  const page = u.pathname === '/salesman.html';
  e.respondWith((async () => {
    const c = await caches.open(V), hit = await c.match(u.pathname);
    const net = fetch(e.request).then((r) => { if (r && r.ok) c.put(u.pathname, r.clone()); return r; }).catch(() => null);
    // The page itself: use the fresh copy when online (so updates show up at once), fall back to the saved one.
    if (page) return (await Promise.race([net, new Promise((ok) => setTimeout(() => ok(null), 3000))])) || hit || (await net) || new Response('Offline', { status: 503 });
    return hit || (await net) || new Response('Offline', { status: 503 });
  })());
});

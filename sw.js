// Ballot Match service worker: offline app shell, fresh data.
// Bump VERSION whenever you change app files so phones pick up the update.
const VERSION = 'bm-v2';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './icons.js',
  './config.js',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './questions.json',
  './stances.json',
  './demo-ballot.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache ballot lookups (they include the voter's address).
  if (url.hostname === 'www.googleapis.com') return;

  // Fonts: cache after first use.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(VERSION + '-fonts').then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // Data files: network first so stance updates show up right away.
  if (url.pathname.endsWith('.json') || url.pathname.endsWith('/config.js')) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Everything else: cache first, then network.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match('./index.html'))));
});

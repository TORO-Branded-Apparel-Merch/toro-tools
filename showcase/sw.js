/* Brandabulls Live! Showcase service worker.
   Caches the app shell so the page loads even with no signal.
   Firebase/Firestore calls are always network-first (never cached),
   so data is always live when online and queued on-device when not. */

const CACHE = 'bl-app-v1';
const SHELL = [
  './',
  './index.html',
  './favicon.png?v=2',
  './apple-touch-icon.png?v=2',
  // Firebase SDK modules — required for the app to boot; cache them so it works offline.
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
];

// Install: pre-cache the shell.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// Activate: drop old caches.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - Navigations (loading the page): serve cached index.html when offline.
// - Same-origin static assets: cache-first, fall back to network.
// - Everything else (Firebase, CDNs, EmailJS): network-only, so live data
//   is never stale and writes hit the server when there's a connection.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Only handle GETs; POST/PUT (Firebase writes) must go straight to network.
  if (req.method !== 'GET') return;

  // App navigation → serve the cached shell if the network fails.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Same-origin static files → cache-first.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        // opportunistically cache new same-origin GETs
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // Firebase SDK *files* (the .js modules) → cache-first so the app can boot offline.
  // Firestore *data* requests go to firestore.googleapis.com, which is NOT matched here
  // and stays network-only, so live data is never served stale.
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Other cross-origin (CDNs for QR/scanner/zip) → network, fall back to cache if present.
  e.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

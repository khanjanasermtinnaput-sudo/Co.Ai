// Self-destroying service worker.
// The old GitHub Pages build registered a cache-first SW that pinned the stale
// app shell. This replacement clears every cache, unregisters itself, and
// reloads open tabs so returning visitors land on the redirect page instead of
// the cached app. Browsers re-fetch sw.js on navigation (bypassing HTTP cache),
// so this picks up automatically on the next visit.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate(c.url));
  })());
});

// Pass everything straight to the network — never serve from cache.
self.addEventListener('fetch', () => {});

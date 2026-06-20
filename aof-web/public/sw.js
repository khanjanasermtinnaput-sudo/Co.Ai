// Aof PWA service worker — offline shell + safe runtime caching.
// IMPORTANT: API and streaming endpoints (/api/*, /v1/*) are NEVER cached, so the
// AI provider error handling (live status, no fake answers) is never masked by a
// stale cache.
const CACHE = "aof-cache-v1";
const SHELL = ["/", "/manifest.webmanifest", "/aof-logo.png", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live endpoints must always hit the network — never serve a cached AI response.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/")) return;

  // Page navigations: network-first, fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(request)
            .then((cached) => cached || caches.match("/"))
            .then((shell) => shell || new Response("Offline", { status: 503, statusText: "Service Unavailable" }))
        ),
    );
    return;
  }

  // Static assets (incl. /_next/static immutable chunks): cache-first, then network.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => new Response("Network error", { status: 503, statusText: "Service Unavailable" }));
    }),
  );
});

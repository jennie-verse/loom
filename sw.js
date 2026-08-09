const CACHE_NAME = "loom-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/app.css",
  "./assets/fonts/lexend-400.woff2",
  "./assets/fonts/lexend-700.woff2",
  "./src/app.js",
  "./src/model.js",
  "./src/store.js",
  "./src/day-view.js",
  "./src/agenda-view.js",
  "./src/block-sheet.js",
  "./src/calendar-sheet.js",
  "./src/templates.js",
  "./src/backup.js",
  "./src/settings.js",
  "./src/ui.js",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("loom-") && key !== CACHE_NAME).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// Cache-first, single strategy. Network is never used — the app is fully offline.
// If a request is not in the cache, it fails; nothing is fetched over the network.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      if (request.mode === "navigate") {
        return caches.match("./index.html").then((shell) => shell || Response.error());
      }
      return Response.error();
    }),
  );
});

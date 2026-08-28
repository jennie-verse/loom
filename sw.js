// Keep VERSION in step with APP_BUILD in ./src/version.js.
// The Settings screen shows APP_BUILD so a stale cached build is visible at a
// glance — "deployed" and "running on the device" are not the same thing.
const VERSION = "2026.08.27-iconpalette1";
const CACHE_NAME = `loom-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/app.css",
  "./assets/fonts/lexend-400.woff2",
  "./assets/fonts/lexend-700.woff2",
  "./src/app.js",
  "./src/version.js",
  "./src/model.js",
  "./src/store.js",
  "./src/sync.js",
  "./src/sync-runner.js",
  "./src/journal.js",
  "./src/journal-record.js",
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

// Shared sync module. It lives in another repository but on the same origin, so
// it can be cached. Added one by one rather than with addAll: a single failure
// there must not stop the whole app from installing.
const OPTIONAL_ASSETS = [
  "../shared/v1/sync.js",
  "../shared/v2/journal.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await Promise.all(OPTIONAL_ASSETS.map(async (path) => {
      try {
        await cache.add(new URL(path, self.registration.scope));
      } catch {
        // The fetch handler caches it on a later run.
      }
    }));
    await self.skipWaiting();
  })());
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // Cross-origin requests are left entirely alone. Sync talks to
  // https://api.github.com; if this handler answered those requests from the
  // cache, every GET (read) would fail while PUT/DELETE (write) still went
  // through — an upload would then see "no remote file", merge against nothing
  // and overwrite real records with an empty list.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    // Not in the cache: try the network once, then fall back to the shell.
    // The app still works fully offline — this only covers same-origin files
    // that are not part of the shell (e.g. ../shared/v1/sync.js on first run).
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") cache.put(request, response.clone());
      return response;
    } catch {
      if (request.mode === "navigate") {
        return (await cache.match("./index.html")) || Response.error();
      }
      return Response.error();
    }
  })());
});

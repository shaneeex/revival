const CACHE_NAME = "revival-signage-v30";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./admin.html",
  "./admin.css",
  "./admin.css?v=20260314g",
  "./admin.js",
  "./admin.js?v=20260314g",
  "./runtime-config.json",
  "./styles.css",
  "./styles.css?v=20260314g",
  "./script.js",
  "./script.js?v=20260314g",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((hit) => hit || caches.match("./index.html")))
  );
});

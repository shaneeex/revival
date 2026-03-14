const CACHE_NAME = "revival-signage-v40";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./admin.html",
  "./admin-login.html",
  "./admin-login.js",
  "./admin-login.js?v=20260314j",
  "./admin.css",
  "./admin.css?v=20260314p",
  "./admin.js",
  "./admin.js?v=20260314r",
  "./runtime-config.json",
  "./styles.css",
  "./styles.css?v=20260315a",
  "./script.js",
  "./script.js?v=20260315a",
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

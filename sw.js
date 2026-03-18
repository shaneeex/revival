const CACHE_NAME = "revival-signage-v78";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./admin.html",
  "./admin-login.html",
  "./admin-login.js",
  "./admin-login.js?v=20260314j",
  "./admin.css",
  "./admin.css?v=20260318a",
  "./admin.css?v=20260317b",
  "./admin.css?v=20260316a",
  "./admin.js",
  "./admin.js?v=20260318a",
  "./admin.js?v=20260317c",
  "./admin.js?v=20260316b",
  "./admin.js?v=20260316a",
  "./admin.js?v=20260315d",
  "./admin.js?v=20260315b",
  "./runtime-config.json",
  "./styles.css",
  "./styles.css?v=20260317t",
  "./styles.css?v=20260317s",
  "./styles.css?v=20260317r",
  "./styles.css?v=20260317q",
  "./styles.css?v=20260317p",
  "./styles.css?v=20260317o",
  "./styles.css?v=20260317n",
  "./styles.css?v=20260317m",
  "./styles.css?v=20260317l",
  "./styles.css?v=20260317k",
  "./styles.css?v=20260317j",
  "./styles.css?v=20260317i",
  "./styles.css?v=20260317h",
  "./styles.css?v=20260317g",
  "./styles.css?v=20260317f",
  "./styles.css?v=20260317e",
  "./styles.css?v=20260317d",
  "./styles.css?v=20260317c",
  "./styles.css?v=20260317b",
  "./styles.css?v=20260317a",
  "./styles.css?v=20260316h",
  "./styles.css?v=20260316g",
  "./styles.css?v=20260316f",
  "./styles.css?v=20260316e",
  "./styles.css?v=20260316d",
  "./styles.css?v=20260315e",
  "./script.js",
  "./script.js?v=20260318a",
  "./script.js?v=20260317i",
  "./script.js?v=20260317h",
  "./script.js?v=20260317g",
  "./script.js?v=20260317f",
  "./script.js?v=20260317e",
  "./script.js?v=20260316d",
  "./script.js?v=20260316c",
  "./script.js?v=20260316b",
  "./manifest.webmanifest",
  "./logos/revival.png",
  "./logos/mib.jpg",
  "./logos/icon-web.svg",
  "./logos/icon-instagram.svg"
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

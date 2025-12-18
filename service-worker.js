/* eslint-disable no-restricted-globals */
const CACHE_VERSION = "jp-vocab-v1";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./data/decks.json",
  "./data/vocab_master.csv",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isNav = req.mode === "navigate";

  // Navigation: network-first so updates arrive promptly, fallback to cached shell.
  if (isNav) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  // Assets/data: stale-while-revalidate for good offline + quick updates.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchAndUpdate = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => null);

      if (cached) {
        // Update in background.
        event.waitUntil(fetchAndUpdate);
        return cached;
      }

      return fetchAndUpdate.then((res) => res || cached);
    }),
  );
});

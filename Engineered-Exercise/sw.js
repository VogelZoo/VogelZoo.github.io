// Engineered Exercise — Service Worker
// Bump CACHE_VERSION whenever app.js/index.html/styles.css change so clients
// pick up the new files instead of serving stale cached ones.
const CACHE_VERSION = "ee-v9";
const APP_SHELL = [
    "./",
    "./index.html",
    "./styles.css",
    "./app.js",
    "./backup.js",
    "./oauth-callback.html",
    "./manifest.json",
    "./icon-192.png",
    "./icon-512.png",
    "./icon-192-maskable.png",
    "./icon-512-maskable.png",
    "./apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;

    // Navigation requests (loading the app shell): network-first so users get
    // the latest version when online, falling back to cache when offline.
    if (event.request.mode === "navigate") {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, response.clone()));
                    return response;
                })
                .catch(() => caches.match("./index.html"))
        );
        return;
    }

    // Static assets: cache-first for speed, refreshing the cache in the background.
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const networkFetch = fetch(event.request)
                .then((response) => {
                    if (response && response.status === 200) {
                        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, response.clone()));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || networkFetch;
        })
    );
});

/*
 * Service worker of the app. Deliberately small and safe:
 *  - the pages and data are NEVER cached (they are per user and must always be live);
 *  - the build files (/_next/static, hashed, immutable), the barcode decoder (/wasm) and the icons are cached,
 *    so the app opens fast and the scanner starts without downloading the decoder again;
 *  - if the network is down when a page is opened, a clear offline page is shown instead of the browser's error.
 * A new version waits until the app is closed and reopened: it never reloads a screen in the middle of counting.
 */
const VERSION = "v1";
const STATIC = `static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/wasm/zxing_reader.wasm", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const cacheable = (url) => url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/wasm/") || url.pathname.startsWith("/icons/"));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // server actions and every write go straight to the network
  const url = new URL(req.url);

  if (cacheable(url)) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

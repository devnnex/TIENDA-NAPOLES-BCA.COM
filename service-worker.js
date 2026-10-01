const PWA_BRAND_CACHE = "tienda-napoles-pwa-brand-v1";
const DYNAMIC_PWA_ASSETS = new Set([
  "pwa-manifest.webmanifest",
  "pwa-icon-192.png",
  "pwa-icon-512.png"
]);

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && event.request.mode === "navigate") {
    url.searchParams.set("__fresh", Date.now().toString(36));
    event.respondWith(fetch(url.href, { cache: "no-store", credentials: "same-origin" }));
    return;
  }
  const isCurrentAppAsset = url.origin === self.location.origin
    && ["script", "style"].includes(event.request.destination);
  if (isCurrentAppAsset) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }
  const assetName = url.pathname.split("/").pop();
  if (!DYNAMIC_PWA_ASSETS.has(assetName)) return;
  event.respondWith((async () => {
    const cache = await caches.open(PWA_BRAND_CACHE);
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    return fetch(assetName === "pwa-manifest.webmanifest" ? "./manifest.webmanifest" : "./pwa-icon.svg");
  })());
});

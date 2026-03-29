// sw.js - cache simples para PWA (estático)
// Ajuste a lista de arquivos conforme você for adicionando novas páginas/ícones.
const CACHE_NAME = "cp-static-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/favicon.png",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Só GET
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      // Cache-first para assets
      if (cached) return cached;

      return fetch(req).then((res) => {
        // Guarda em cache respostas ok e same-origin
        const url = new URL(req.url);
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

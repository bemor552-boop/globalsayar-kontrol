// Uygulama kabuğunu önbellekler (telefonda hızlı açılış, çevrimdışında son görünüm). Veriler hep ağdan gelir.
const SURUM = "gs-kontrol-571b7e1";
const KABUK = ["./", "index.html", "app.js", "manifest.webmanifest", "ikon-192.png", "ikon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(SURUM).then(c => c.addAll(KABUK))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== SURUM).map(x => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return; // GitHub API: önbelleğe alma
  // Önce ağ (güncel sürüm), ağ yoksa önbellek
  e.respondWith(fetch(e.request).then(r => { const k = r.clone(); caches.open(SURUM).then(c => c.put(e.request, k)); return r; })
    .catch(() => caches.match(e.request)));
});

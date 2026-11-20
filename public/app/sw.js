// Service worker mínimo: permite instalar la app. Los datos siempre vienen en directo
// del servidor (red primero); solo se guarda la portada por si no hay conexión.
const CACHE = 'planta-app-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.add('/app/')).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).pathname === '/ws') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then((r) => r || caches.match('/app/'))));
});

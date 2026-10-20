const CACHE = 'my-doas-v17-assabile-adhan';
const SHELL = ['/', '/index.html', '/subscribe.html', '/manifest.webmanifest', '/mosque-icon.png', '/favicon.png', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/mosque.jpg', '/international-qr.png', '/gpay-qr.png', '/athan-full.mp3'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('/index.html'))));
});

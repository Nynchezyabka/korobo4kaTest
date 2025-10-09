// sw.js
const CACHE_VERSION = 'v6';
const STATIC_CACHE = `korobochka-static-${CACHE_VERSION}`;
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/db.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function isApiRequest(req) {
  try { return new URL(req.url).pathname.startsWith('/api/'); } catch (_) { return false; }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // bypass non-GET

  if (isApiRequest(req)) {
    // Network First for API
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        return net;
      } catch (_) {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Fallback 503 JSON
        return new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // Navigation requests -> serve cached index.html when offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(req); } catch (_) { return caches.match('/index.html'); }
    })());
    return;
  }

  // Cache First for static assets (same-origin)
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const net = await fetch(req);
      const cache = await caches.open(STATIC_CACHE);
      cache.put(req, net.clone()).catch(() => {});
      return net;
    } catch (_) {
      // last resort: if requesting index parts, return index
      if (req.destination === 'document') return caches.match('/index.html');
      return new Response('', { status: 504 });
    }
  })());
});

self.addEventListener('push', function(event) {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = {};
    }
    const options = {
        body: data.body || 'Время вышло! Задача завершена.',
        icon: data.icon || '/icon-192.png',
        badge: data.badge || '/icon-192.png',
        vibrate: data.vibrate || [500, 300, 500],
        tag: data.tag || 'timer-notification',
        renotify: true,
        requireInteraction: true,
        data: data.data || { url: '/' }
    };

    event.waitUntil(
        self.registration.showNotification(data.title || '🎁 КОРОБОЧКА', options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil((async () => {
        const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
            try {
                if ('navigate' in client) await client.navigate(targetUrl);
                if ('focus' in client) return client.focus();
            } catch (e) {}
        }
        if (clients.openWindow) {
            return clients.openWindow(targetUrl);
        }
    })());
});

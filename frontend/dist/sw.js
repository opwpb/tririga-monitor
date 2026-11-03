// TRIRIGA Log & License Analyzer - Progressive Web App Service Worker
// Version: 1.0.30
const CACHE_NAME = 'tririga-monitor-v39';

// Core shell assets to precache on install relative to SW location
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// Install Event: Precache app shell and activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
});

// Activate Event: Purge ALL previous caches completely and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[PWA SW] Purging outdated cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch Event: Network-first caching strategy
self.addEventListener('fetch', (event) => {
  const reqUrl = event.request.url;
  // Only process standard HTTP and HTTPS requests
  if (!reqUrl.startsWith('http://') && !reqUrl.startsWith('https://')) {
    return;
  }

  const url = new URL(reqUrl);

  // 1. NEVER cache live backend API requests or sw.js
  if (
    event.request.method !== 'GET' || 
    url.pathname.includes('/api/') ||
    url.pathname.endsWith('sw.js')
  ) {
    return; // Standard network fetch
  }

  // 2. Navigation requests: Network-First, fallback to Cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match('./index.html').then((cachedIndex) => {
            return cachedIndex || caches.match(event.request);
          });
        })
    );
    return;
  }

  // 3. Static assets (JS, CSS, images): Network-First to guarantee fresh builds, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Message Event: Allow manual skip waiting from UI update prompts
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

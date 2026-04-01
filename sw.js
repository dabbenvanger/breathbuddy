const CACHE_NAME = 'breath-buddy-v1';
const ASSETS_TO_CACHE = [
  '/breathbuddy/',
  '/breathbuddy/index.html',
  '/breathbuddy/styles.css',
  '/breathbuddy/app.js',
  '/breathbuddy/manifest.json',
  '/breathbuddy/favicon.ico',
  '/breathbuddy/assets/images/android-chrome-192x192.png',
  '/breathbuddy/assets/images/android-chrome-512x512.png',
  '/breathbuddy/assets/images/apple-touch-icon.png',
  '/breathbuddy/assets/images/favicon-32x32.png',
  '/breathbuddy/assets/images/favicon-16x16.png',
  '/breathbuddy/assets/images/breathbuddy-og.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Google Fonts: network-first so updates propagate, fall back to cache
  if (event.request.url.includes('fonts.googleapis.com') ||
      event.request.url.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return fetch(event.request)
          .then((response) => {
            cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => cache.match(event.request));
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        });
      })
  );
});

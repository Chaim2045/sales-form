// Service Worker — TOFES OFFICE PWA
// Network-first strategy: always try network, fallback to cache

var CACHE_NAME = 'tofes-office-v11';
var STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/variables.css',
    '/css/layout.css',
    '/css/components.css',
    '/css/modals.css',
    '/css/sales-form.css',
    '/css/billing.css',
    '/css/mobile.css',
    '/assets/logo.png'
];

// Install — cache static assets
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.filter(function(name) {
                    return name !== CACHE_NAME;
                }).map(function(name) {
                    return caches.delete(name);
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch — network first, then cache (only for same-origin requests)
self.addEventListener('fetch', function(event) {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Only handle same-origin requests — let all external requests go directly to network
    var url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request).then(function(response) {
            // Cache successful responses for offline fallback
            if (response.status === 200) {
                var responseClone = response.clone();
                caches.open(CACHE_NAME).then(function(cache) {
                    cache.put(event.request, responseClone);
                });
            }
            return response;
        }).catch(function() {
            // Network failed — try cache
            return caches.match(event.request);
        })
    );
});

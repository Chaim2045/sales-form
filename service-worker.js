// Service Worker — TOFES OFFICE PWA
// Network-first strategy: always try network, fallback to cache

var CACHE_NAME = 'tofes-office-v1';
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

// Fetch — network first, then cache
self.addEventListener('fetch', function(event) {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip Firebase/external API calls — always go to network
    var url = event.request.url;
    if (url.includes('firebaseio.com') ||
        url.includes('googleapis.com') ||
        url.includes('firestore.googleapis.com') ||
        url.includes('firebasestorage.app') ||
        url.includes('identitytoolkit')) {
        return;
    }

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

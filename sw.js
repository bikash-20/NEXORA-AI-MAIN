// ============================================================
//  Nexora Service Worker v4.0
//
//  Strategy:
//  - HTML / JS / CSS  → Network-first, 2.5s timeout, cache fallback
//  - Images / icons   → Cache-first, background revalidate
//  - Google Fonts     → Cache-first (immutable CDN)
//  - API calls        → Network-only, offline stub
//
//  Auto-update (no hard refresh needed):
//  1. skipWaiting()   → new SW activates immediately on install
//  2. clients.claim() → new SW takes over ALL open tabs on activate
//  3. controllerchange in index.html → page reloads itself once
// ============================================================

const CACHE_VERSION = '20260503-1';
const CACHE_NAME    = `nexora-v${CACHE_VERSION}`;
const FONT_CACHE    = 'nexora-fonts-v1';
const IMAGE_CACHE   = 'nexora-images-v1';

const APP_SHELL_PATHS = new Set([
  '/',
  '/index.html',
  '/style.css',
  '/pwa-install.css',
  '/pwa-install.js',
  '/nexora-data.js',
  '/nexora-orb.js',
  '/nexora-core.js',
  '/nexora-ai.js',
  '/nexora-study.js',
  '/nexora-study-worker.js',
  '/manifest.json',
  '/sw.js',
  '/icon.svg',
]);

const IMAGE_EXTS = /\.(png|jpg|jpeg|webp|gif|svg|ico)$/i;

const NETWORK_ONLY_HOSTS = new Set([
  'openrouter.ai',
  'api.open-meteo.com',
  'geocoding-api.open-meteo.com',
  'api.duckduckgo.com',
  'itunes.apple.com',
  'v2.jokeapi.dev',
  'api.mymemory.translated.net',
  'en.wikipedia.org',
  'v6.exchangerate-api.com',
]);

function fetchWithTimeout(request, ms) {
  ms = ms || 2500;
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() { reject(new Error('timeout')); }, ms);
    fetch(request).then(
      function(r) { clearTimeout(timer); resolve(r); },
      function(e) { clearTimeout(timer); reject(e); }
    );
  });
}

function putInCache(cacheName, request, response) {
  if (response && response.ok) {
    caches.open(cacheName).then(function(cache) { cache.put(request, response.clone()); });
  }
}

// Install: pre-cache app shell, activate immediately
self.addEventListener('install', function(event) {
  console.log('[SW] Installing ' + CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.allSettled(
        Array.from(APP_SHELL_PATHS).map(function(path) {
          return cache.add(path).catch(function(err) {
            console.warn('[SW] Pre-cache miss:', path, err.message);
          });
        })
      );
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Activate: wipe old caches, claim all open tabs instantly
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating ' + CACHE_NAME);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== CACHE_NAME && k !== FONT_CACHE && k !== IMAGE_CACHE; })
          .map(function(k) { console.log('[SW] Deleting:', k); return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch routing
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  var isSameOrigin = url.origin === self.location.origin;

  // Network-only: APIs
  if (NETWORK_ONLY_HOSTS.has(url.hostname)) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Cache-first: Google Fonts
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(r) {
          putInCache(FONT_CACHE, event.request, r);
          return r;
        }).catch(function() { return new Response('', { status: 503 }); });
      })
    );
    return;
  }

  // Network-first: App shell (HTML, JS, CSS)
  if (isSameOrigin && (event.request.mode === 'navigate' || APP_SHELL_PATHS.has(url.pathname))) {
    event.respondWith(
      fetchWithTimeout(event.request, 2500)
        .then(function(response) {
          putInCache(CACHE_NAME, event.request, response);
          return response;
        })
        .catch(function() {
          return caches.match(event.request).then(function(cached) {
            if (cached) return cached;
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html').then(function(shell) {
                return shell || new Response('Offline', { status: 503 });
              });
            }
            return new Response('Offline', { status: 503 });
          });
        })
    );
    return;
  }

  // Cache-first: Images (revalidate in background)
  if (isSameOrigin && IMAGE_EXTS.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        var fresh = fetch(event.request).then(function(r) {
          putInCache(IMAGE_CACHE, event.request, r);
          return r;
        });
        return cached || fresh;
      })
    );
    return;
  }

  // Stale-while-revalidate: everything else
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var fresh = fetch(event.request).then(function(r) {
        putInCache(CACHE_NAME, event.request, r);
        return r;
      }).catch(function() { return cached; });
      return cached || fresh;
    })
  );
});

// Messages
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

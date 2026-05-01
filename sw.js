// ============================================================
//  Nexora Service Worker — PWA Offline Support
//  Cache-first strategy for static assets
//  Network-first for API calls
//
//  CACHE_VERSION: bump this string on every deploy to force
//  all clients to fetch fresh assets immediately.
// ============================================================

// ── Change this on every deploy (ISO date + deploy counter) ──────
const CACHE_VERSION = '20260502-3';
const CACHE_NAME = `nexora-v${CACHE_VERSION}`;

// Core files to cache on install
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './pwa-install.css',
  './pwa-install.js',
  './nexora-data.js',
  './nexora-study-worker.js',
  './app.js',
  './manifest.json',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon.svg'
];

// Optional assets — cache them when available, but don't fail install if any are missing
const OPTIONAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap'
];

const APP_SHELL_PATHS = new Set([
  '/',
  '/index.html',
  '/nexora-data.js',
  '/nexora-study-worker.js',
  '/app.js',
  '/style.css',
  '/pwa-install.css',
  '/pwa-install.js',
  '/manifest.json',
  '/sw.js',
]);

// API hostnames — always go to network (never cache)
const NETWORK_ONLY_HOSTS = [
  'openrouter.ai',
  'api.open-meteo.com',
  'geocoding-api.open-meteo.com',
  'api.duckduckgo.com',
  'itunes.apple.com',
  'v2.jokeapi.dev',
  'api.mymemory.translated.net',
  'en.wikipedia.org',
  'v6.exchangerate-api.com'
];

// ── Install: cache all static assets ──
self.addEventListener('install', event => {
  console.log(`[SW] Installing cache: ${CACHE_NAME}`);
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const toCache = [...CORE_ASSETS, ...OPTIONAL_ASSETS];
      await Promise.allSettled(
        toCache.map(async asset => {
          try {
            await cache.add(asset);
          } catch (err) {
            console.warn('[SW] Failed to cache asset:', asset, err?.message || err);
          }
        })
      );
    }).then(() => {
      console.log(`[SW] Cache ${CACHE_NAME} ready. Skipping waiting.`);
      return self.skipWaiting();
    })
  );
});

// ── Activate: clean up old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: smart routing ──
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const pathname = url.pathname;

  // Always use network for API calls
  if (NETWORK_ONLY_HOSTS.includes(url.hostname)) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // For Google Fonts — cache then network
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached || new Response('', { status: 503 }));
      })
    );
    return;
  }

  // App shell files should prefer network so new deploys replace old broken JS/CSS quickly.
  if (isSameOrigin && (event.request.mode === 'navigate' || APP_SHELL_PATHS.has(pathname))) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() =>
        caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('./index.html');
          return new Response('Offline', { status: 503 });
        })
      )
    );
    return;
  }

  // Cache-first for all other static assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Cache successful GET responses
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback — return cached index.html for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// ── Push notification support (future use) ──
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

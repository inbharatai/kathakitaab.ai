// ============================================================
// KathaKitaab — minimal service worker
//
// Purpose: pass Chrome's PWA install + Lighthouse criteria so the
// app qualifies as a Progressive Web App (prerequisite for the
// Bubblewrap → Trusted Web Activity → Play Store wrap).
//
// Strategy is intentionally conservative — we do NOT aggressively
// cache app HTML or API responses, because the app is highly
// dynamic (live AI generation, signed-in state, fresh manifests).
// Wrong-caching here is far worse than the modest perf win.
//
//   • install  : pre-cache an offline shell (icons + offline page)
//   • activate : nuke old caches
//   • fetch    : network-first for navigation, cache-first only for
//                /icons/ and /images/style-samples/ (genuinely
//                immutable). Everything else passes straight through
//                to the network so signed-in users always see fresh.
//
// Bump SW_VERSION on every deploy that changes the offline shell to
// force a clean activate.
// ============================================================

const SW_VERSION = 'kk-v1-2026-05-13';
const CACHE_NAME = `kk-shell-${SW_VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/apple-touch-icon.png',
  '/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {
        // Pre-cache failing isn't fatal — runtime fetches will still
        // work, we just lose the offline fallback for those assets.
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never touch API, auth, or third-party requests — they need to
  // hit the network with fresh cookies every time. Same for the
  // Next.js _next/data and _next/image endpoints, which serve
  // version-pinned responses already.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_next/data/')) return;
  if (url.pathname.startsWith('/auth/')) return;

  // Cache-first for genuinely immutable assets — icons + style
  // sample images. These never change without a deploy and bumping
  // SW_VERSION purges the cache.
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/images/style-samples/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/apple-touch-icon.png' ||
    url.pathname === '/logo.png'
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((hit) =>
          hit || fetch(req).then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
        )
      )
    );
    return;
  }

  // Navigation requests — network-first with cache fallback. If the
  // user is offline and we have a cached version of the page, serve
  // it; otherwise the browser shows its default offline screen.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.open(CACHE_NAME).then((cache) =>
          cache.match(req).then((hit) => hit || cache.match('/'))
        )
      )
    );
    return;
  }

  // Everything else falls through to the network (no caching here —
  // we don't know which Next.js chunks are safe to cache vs which
  // depend on signed-in state).
});

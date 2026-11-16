/*
 * Service worker: offline fallback, caching of static files, push notifications.
 * Booking data and availability are never cached: only same-origin static files are handled
 * here, and the API lives on another origin.
 */

const VERSION = 'v2';
const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const SHELL_FILES = [
  OFFLINE_URL,
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon.png',
];

/**
 * Fetches a file for the cache. Some hosts answer "/offline.html" with a redirect to
 * "/offline"; browsers refuse to use a redirected response for a page load, so the body is
 * copied into a fresh response first.
 */
async function fetchForCache(url) {
  const response = await fetch(url, { cache: 'reload' });
  if (!response.ok) throw new Error(`Cannot cache ${url}: ${response.status}`);
  if (!response.redirected) return response;
  // Only the content type is carried over: the body is already decoded, so headers such as
  // Content-Encoding from the original response would no longer be true.
  return new Response(await response.blob(), {
    status: 200,
    headers: { 'Content-Type': response.headers.get('Content-Type') || 'text/html; charset=utf-8' },
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(SHELL_FILES.map(async (url) => cache.put(url, await fetchForCache(url))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL_CACHE, ASSET_CACHE];
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !keep.includes(name)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Build output with content hashes in the file names: safe to keep forever. */
const isHashedAsset = (url) => url.pathname.startsWith('/_expo/static/');
const isShellFile = (url) =>
  SHELL_FILES.includes(url.pathname) || url.pathname.startsWith('/icons/');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // API calls go straight to the network

  // Page loads: always try the network, show the offline page when it is unreachable.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached || Response.error();
      }),
    );
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  if (isShellFile(url)) {
    // Serve from cache, refresh in the background.
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(request);
        const fresh = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached || Response.error());
        return cached || fresh;
      })(),
    );
  }
});

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    // Not JSON: fall through to the generic notification below.
  }
  // A push must always show a notification, otherwise browsers revoke the permission.
  event.waitUntil(
    self.registration.showNotification(message.title || 'Programare', {
      body: message.body || '',
      tag: message.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: message.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => client.url === target);
      if (open) return open.focus();
      return self.clients.openWindow(target);
    })(),
  );
});

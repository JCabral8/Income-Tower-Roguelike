// Kill-switch service worker.
// The previous game registered an offline-caching service worker at this URL.
// Browsers re-check this file on navigation, so shipping this replaces the old
// worker, wipes its caches, unregisters itself, and reloads open tabs so
// devices that played the old game pick up the new one.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.navigate(client.url);
  })());
});

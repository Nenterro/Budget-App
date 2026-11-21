// Push handling, loaded into the generated service worker (see vite.config.js).
// The home server's push hub sends these; src/utils/push.js subscribes.

// Every push must show a notification: iOS withdraws the subscription from an
// app that receives pushes silently.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || 'Budget', {
        body: data.body || '',
        tag: data.tag,
        icon: '/pwa-192x192.png',
        data: { url: data.url || '/' }
      });
      if (typeof data.badge === 'number' && self.navigator.setAppBadge) {
        await self.navigator.setAppBadge(data.badge).catch(() => {});
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});

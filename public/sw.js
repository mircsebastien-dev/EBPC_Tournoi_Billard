// Service worker PWA : reçoit les push et affiche la notification, clic -> ouvre le match
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Pink City Billard', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'Pink City Billard';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'pcb',
    renotify: true,
    data: { url: data.url || '/' },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes(self.location.origin) && 'focus' in c) { c.focus(); if (c.navigate) c.navigate(url); return; }
      }
      return self.clients.openWindow(url);
    })
  );
});

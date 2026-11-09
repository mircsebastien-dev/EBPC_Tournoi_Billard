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
  // URL absolue de la card du match (payload.url = /match.html?id=...)
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // d'abord: onglet déjà ouvert sur le site -> on le navigue vers le match puis focus
    for (const c of wins) {
      if (c.url.startsWith(self.location.origin)) {
        try { if (c.navigate) await c.navigate(url); } catch (err) {}
        try { await c.focus(); } catch (err) {}
        return;
      }
    }
    // sinon: ouvre directement la card du match (fallback: accueil si openWindow échoue, ex. iOS)
    try { await self.clients.openWindow(url); }
    catch (err) { try { await self.clients.openWindow(self.location.origin + '/'); } catch (e2) {} }
  })());
});

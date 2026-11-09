/* Push PWA côté client : enregistre le service worker, demande la permission, abonne le compte */
async function pushInit() {
  // manifest + icônes (injectés dynamiquement pour toutes les pages)
  if (!document.querySelector('link[rel="manifest"]')) {
    const l = document.createElement('link'); l.rel = 'manifest'; l.href = '/manifest.webmanifest'; document.head.appendChild(l);
  }
  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const a = document.createElement('link'); a.rel = 'apple-touch-icon'; a.href = '/apple-touch-icon.png'; document.head.appendChild(a);
  }
  const m = document.createElement('meta'); m.name = 'theme-color'; m.content = '#ff2e88'; document.head.appendChild(m);
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('/sw.js'); } catch (e) { console.warn('SW:', e.message); }
}

async function pushActiver() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Push non supporté sur ce navigateur');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permission refusée');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await (await fetch('/api/push/vapid-public')).json();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
  return sub;
}

async function pushDesactiver() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  }
}

async function pushEstActif() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!(sub && Notification.permission === 'granted');
  } catch { return false; }
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function estPWA() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function estIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent); }

pushInit();

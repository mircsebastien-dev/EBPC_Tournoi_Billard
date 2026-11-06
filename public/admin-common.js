/* Commun à toutes les pages admin : PIN, appels API, état global, SSE */
let adminPin = String(localStorage.getItem('ebpc_admin_pin') || '');
let adminState = null;

function adminHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', ...(adminPin ? { 'X-Admin-Pin': adminPin } : {}), ...extra };
}

async function adminApi(path, opts = {}) {
  const res = await fetch(path, { headers: adminHeaders(), ...opts });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { adminPin = ''; localStorage.removeItem('ebpc_admin_pin'); throw new Error('PIN invalide'); }
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

async function adminInit(onUpdate) {
  adminState = await api('/api/etat');
  if (!adminPin) return false;
  connecterSSE((s) => { adminState = s; if (onUpdate) onUpdate(s); });
  return true;
}

function renderAdminLogin(main) {
  main.innerHTML = '';
  const input = el('input', { type: 'password', id: 'pin', placeholder: 'Code PIN', inputmode: 'numeric', maxlength: 8 });
  const entrer = async () => {
    adminPin = input.value.trim();
    if (!adminPin) return;
    // vérifier le PIN côté serveur AVANT d'entrer (sinon n'importe quel code "passe" visuellement)
    try {
      const r = await fetch('/api/admin/audit', { headers: { 'X-Admin-Pin': adminPin } });
      if (r.status === 401) { alert('❌ PIN invalide'); adminPin = ''; input.value = ''; input.focus(); return; }
    } catch (e) { alert('❌ PIN invalide'); return; }
    localStorage.setItem('ebpc_admin_pin', adminPin);
    location.reload();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') entrer(); });
  main.append(el('div', { class: 'panel', style: 'max-width:380px;margin:60px auto' },
    el('div', { class: 'hero-title', style: 'text-align:center' }, '🔐 Table de marque'),
    el('label', {}, 'Code PIN'), input,
    el('div', { style: 'margin-top:14px' }, el('button', { onclick: entrer, style: 'width:100%' }, 'Se connecter'))));
  input.focus();
}

function adminNav(active) {
  return nav(active === 'admin-home' ? 'admin' : active);
}

function adminTournoiActif() { return adminState && adminState.actif; }

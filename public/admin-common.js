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

// Modale admin "Corriger le match": liste des events avec suppression (recalcule le score)
async function openMatchEditor(m, onChange) {
  const overlay = el('div', { style: 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999' });
  const box = el('div', { class: 'panel', style: 'max-width:520px;width:92%;max-height:85vh;overflow:auto' },
    el('h3', {}, `⚙️ Match #${m.position} — ${m.joueur1 ? m.joueur1.pseudo : '…'} vs ${m.joueur2 ? m.joueur2.pseudo : '…'}`),
    el('p', { class: 'muted small' }, `Score ${m.score1} - ${m.score2} · ${m.etat} · race to ${m.manches}`),
    el('div', { id: 'ev-list' }, 'Chargement…'));
  overlay.append(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  async function chargerEvents() {
    const list = box.querySelector('#ev-list');
    try {
      const { events } = await adminApi(`/api/admin/match/${m.id}/events`);
      list.innerHTML = '';
      if (!events.length) { list.append(el('p', { class: 'muted' }, 'Aucun événement.')); return; }
      for (const ev of events) {
        const typeLabel = { manche: '➕ manche', runout: '🎱 run-out', correction: '✏️ correction', bande: '🎲 tirage à la bande' }[ev.type] || ev.type;
        const d = ev.detail ? JSON.parse(ev.detail) : {};
        list.append(el('div', { class: 'row', style: 'justify-content:space-between;border-top:1px solid var(--line);padding:6px 0' },
          el('span', { class: 'small' }, `${typeLabel} — ${ev.pseudo || '?'}${d.kind ? ' (' + d.kind + ')' : ''} · ${(ev.created_at || '').slice(11, 16)}`),
          ev.type === 'bande' ? null : el('button', { class: 'danger', style: 'padding:3px 8px;font-size:12px', onclick: async () => {
            if (!confirm('Supprimer cet événement ? Le score sera recalculé.')) return;
            try { await adminApi(`/api/admin/match/${m.id}/event/${ev.id}`, { method: 'DELETE' }); await chargerEvents(); if (onChange) onChange(); }
            catch (e) { alert(e.message); }
          } }, '🗑')));
      }
    } catch (e) { list.innerHTML = ''; list.append(el('p', { class: 'muted' }, e.message)); }
  }
  await chargerEvents();
  box.append(el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:10px' },
    el('button', { class: 'secondary', onclick: () => overlay.remove() }, 'Fermer')));
}

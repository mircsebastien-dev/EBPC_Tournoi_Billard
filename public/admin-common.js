/* Commun à toutes les pages admin : PIN, appels API, état global, SSE */
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000; // session table de marque: 8h, puis re-saisie du code PIN
let adminPin = String(localStorage.getItem('ebpc_admin_pin') || '');
let adminPinSince = Number(localStorage.getItem('ebpc_admin_pin_since') || 0);
if (adminPin && adminPinSince && Date.now() - adminPinSince > ADMIN_SESSION_MS) {
  // session expirée: on efface le PIN mémorisé (il faudra le ressaisir)
  adminPin = '';
  localStorage.removeItem('ebpc_admin_pin');
  localStorage.removeItem('ebpc_admin_pin_since');
}
let adminState = null;

function verrouillerAdmin() {
  adminPin = '';
  localStorage.removeItem('ebpc_admin_pin');
  localStorage.removeItem('ebpc_admin_pin_since');
  location.reload();
}

function adminHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', ...(adminPin ? { 'X-Admin-Pin': adminPin } : {}), ...extra };
}

async function adminApi(path, opts = {}) {
  const res = await fetch(path, { headers: adminHeaders(), ...opts });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { adminPin = ''; localStorage.removeItem('ebpc_admin_pin'); localStorage.removeItem('ebpc_admin_pin_since'); throw new Error('PIN invalide'); }
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
    localStorage.setItem('ebpc_admin_pin_since', String(Date.now()));
    location.reload();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') entrer(); });
  main.append(el('div', { class: 'panel', style: 'max-width:380px;margin:60px auto' },
    el('div', { class: 'hero-title', style: 'text-align:center' }, '🔐 Table de marque'),
    el('label', {}, 'Code PIN'), input,
    el('div', { style: 'margin-top:14px' }, el('button', { onclick: entrer, style: 'width:100%' }, 'Se connecter'))));
  input.focus();
}

// Geste admin destructif : exige le code re-saisi à la volée (pas seulement la session mémorisée)
// Modale avec champ password -> caractères masqués
function demanderPin(label) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'password', placeholder: 'Code PIN', inputmode: 'numeric', maxlength: 8, autocomplete: 'off' });
    const fermer = (v) => { overlay.remove(); resolve(v); };
    const overlay = el('div', { style: 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999' });
    overlay.append(el('div', { class: 'panel', style: 'max-width:360px;width:92%' },
      el('h3', {}, '🔐 Confirmation requise'),
      el('p', { class: 'muted small' }, label),
      input,
      el('div', { class: 'row', style: 'margin-top:12px;justify-content:flex-end' },
        el('button', { class: 'secondary', onclick: () => fermer(null) }, 'Annuler'),
        el('button', { style: 'margin-left:8px', onclick: () => fermer(input.value.trim() || null) }, 'Confirmer'))));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fermer(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') fermer(input.value.trim() || null); });
    document.body.append(overlay);
    input.focus();
  });
}
async function adminApiDestructif(path, opts, label) {
  const pin = await demanderPin(label || 'cette suppression');
  if (!pin) throw new Error('Annulé : code non saisi');
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  body.confirm_pin = pin;
  return adminApi(path, { ...(opts || {}), body: JSON.stringify(body) });
}

function adminNav(active) {
  const n = nav(active === 'admin-home' ? 'admin' : active);
  // verrouillage manuel de la table de marque (efface le PIN mémorisé)
  n.append(el('button', {
    class: 'secondary', type: 'button', style: 'padding:4px 10px;font-size:12px;margin-left:8px',
    title: 'Effacer le code mémorisé (sera redemandé à la prochaine action admin)',
    onclick: () => { if (confirm('Verrouiller la table de marque ? Le code PIN sera redemandé.')) verrouillerAdmin(); },
  }, '🔒 Verrouiller'));
  return n;
}

function adminTournoiActif() { return adminState && adminState.actif; }

// Modale admin "Gérer le match" (clic sur une card avec le PIN): table, score, rouvrir/forfait
async function openMatchEditor(m, onChange, opts) { opts = opts || {};
  let joueurs = opts.joueurs || (typeof state !== 'undefined' && state && state.actif && state.actif.joueurs) || null;
  let tables = opts.tables || (typeof state !== 'undefined' && state && state.actif && state.actif.tables) || null;
  if ((!tables || !joueurs) && !opts.joueurs) { try { const s = await api('/api/etat'); tables = tables || (s && s.actif && s.actif.tables) || []; joueurs = joueurs || (s && s.actif && s.actif.joueurs) || []; } catch { tables = tables || []; joueurs = joueurs || []; } }
  const overlay = el('div', { style: 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999' });
  const box = el('div', { class: 'panel', style: 'max-width:440px;width:92%' },
    el('h3', {}, `⚙️ Match #${m.position}`),
    el('p', { class: 'muted small' }, `${m.joueur1 ? m.joueur1.pseudo : '…'} vs ${m.joueur2 ? m.joueur2.pseudo : '…'} · ${m.etat} · score ${m.score1} - ${m.score2} · race to ${m.manches}`),
    // joueurs
    el('div', { style: 'margin:10px 0' },
      el('label', { class: 'small muted' }, '👥 Joueurs du match'),
      el('div', { class: 'row', style: 'margin-top:4px' },
        el('select', { id: 'adm-j1', style: 'flex:1 1 auto' },
          el('option', { value: '' }, '— blanc —'),
          ...joueurs.map(j => el('option', { value: String(j.id), selected: m.joueur1 && m.joueur1.id === j.id ? true : null }, j.pseudo))),
        el('span', {}, ' vs '),
        el('select', { id: 'adm-j2', style: 'flex:1 1 auto' },
          el('option', { value: '' }, '— blanc —'),
          ...joueurs.map(j => el('option', { value: String(j.id), selected: m.joueur2 && m.joueur2.id === j.id ? true : null }, j.pseudo))),
        el('button', { class: 'secondary', style: 'margin-left:8px', onclick: async () => {
          try {
            await adminApi(`/api/admin/match/${m.id}/joueurs`, { method: 'POST', body: JSON.stringify({ joueur1_id: box.querySelector('#adm-j1').value, joueur2_id: box.querySelector('#adm-j2').value }) });
            if (onChange) onChange(); overlay.remove();
          } catch (e) { alert(e.message); }
        } }, 'Appliquer'))),
    // table
    el('div', { style: 'margin:10px 0' },
      el('label', { class: 'small muted' }, '🎱 Table'),
      el('div', { class: 'row', style: 'margin-top:4px' },
        el('select', { id: 'adm-table', style: 'flex:1 1 auto' },
          el('option', { value: '' }, '— aucune —'),
          ...tables.map(tb => el('option', { value: String(tb.id), selected: m.table === tb.numero ? true : null }, `Table ${tb.numero}`))),
        el('button', { class: 'secondary', style: 'margin-left:8px', onclick: async () => {
          const v = box.querySelector('#adm-table').value;
          try { await adminApi(`/api/admin/match/${m.id}/table`, { method: 'POST', body: JSON.stringify({ table_id: v === '' ? null : Number(v) }) }); if (onChange) onChange(); overlay.remove(); }
          catch (e) { alert(e.message); }
        } }, 'Appliquer'))),
    // score
    el('div', { style: 'margin:10px 0' },
      el('label', { class: 'small muted' }, '✏️ Score (correction)'),
      el('div', { class: 'row', style: 'margin-top:4px;align-items:center' },
        el('input', { id: 'adm-s1', type: 'number', min: 0, value: String(m.score1), style: 'width:64px' }),
        el('span', {}, ' - '),
        el('input', { id: 'adm-s2', type: 'number', min: 0, value: String(m.score2), style: 'width:64px' }),
        el('button', { class: 'secondary', style: 'margin-left:8px', onclick: async () => {
          try {
            await adminApi(`/api/admin/match/${m.id}/correction`, { method: 'POST', body: JSON.stringify({ score1: Number(box.querySelector('#adm-s1').value) || 0, score2: Number(box.querySelector('#adm-s2').value) || 0, manches: m.manches, motif: 'correction admin' }) });
            if (onChange) onChange(); overlay.remove();
          } catch (e) { alert(e.message); }
        } }, 'Enregistrer'))),
    // rouvrir / forfait
    el('div', { class: 'row', style: 'margin-top:10px;justify-content:space-between' },
      m.etat === 'termine' || m.etat === 'forfait'
        ? el('button', { class: 'secondary', onclick: async () => { try { await adminApi(`/api/admin/match/${m.id}/rouvrir`, { method: 'POST' }); if (onChange) onChange(); overlay.remove(); } catch (e) { alert(e.message); } } }, '🔓 Rouvrir le match')
        : el('button', { class: 'danger', onclick: async () => { const j = prompt('Forfait: id du joueur perdant (1=' + (m.joueur1 ? m.joueur1.pseudo : '?') + ', 2=' + (m.joueur2 ? m.joueur2.pseudo : '?') + ')'); const jid = j === '1' ? m.joueur1 && m.joueur1.id : j === '2' ? m.joueur2 && m.joueur2.id : null; if (!jid) return; try { await adminApi(`/api/admin/match/${m.id}/forfait`, { method: 'POST', body: JSON.stringify({ joueur_id: jid }) }); if (onChange) onChange(); overlay.remove(); } catch (e) { alert(e.message); } } }, '🚫 Forfait'),
      el('button', { class: 'secondary', onclick: () => overlay.remove() }, 'Fermer')));
  overlay.append(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}

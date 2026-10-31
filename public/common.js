const API = '';

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

function badgeEtat(etat) {
  const labels = { prevu: 'Prévu', pret: 'Prêt', en_cours: 'En cours', termine: 'Terminé', forfait: 'Forfait' };
  return el('span', { class: `badge ${etat}` }, labels[etat] || etat);
}

function fmtDuree(s) {
  if (s == null) return null;
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m} min ${String(sec).padStart(2, '0')} s` : `${sec} s`;
}

function matchCard(m, opts = {}) {
  const j1g = m.gagnant_id && m.joueur1 && m.gagnant_id === m.joueur1.id;
  const j2g = m.gagnant_id && m.joueur2 && m.gagnant_id === m.joueur2.id;
  const card = el('div', { class: 'match-card', 'data-match-id': m.id },
    el('div', { class: 'joueurs' },
      el('div', { class: `j ${j1g ? 'gagnant' : ''}` },
        el('span', {}, m.joueur1 ? m.joueur1.pseudo : '—'),
        el('span', { class: 'score' }, String(m.score1))),
      el('div', { class: `j ${j2g ? 'gagnant' : ''}` },
        el('span', {}, m.joueur2 ? m.joueur2.pseudo : '—'),
        el('span', { class: 'score' }, String(m.score2)))),
    el('div', { class: 'meta' },
      badgeEtat(m.etat),
      m.etat === 'en_cours' ? el('span', { class: 'live-dot' }, '● LIVE') : null,
      m.table != null ? el('span', {}, `Table ${m.table}`) : null,
      el('span', {}, `race to ${m.manches}`),
      m.started_at ? el('span', {}, `⏱ début ${m.started_at.slice(11, 16)}`) : null,
      m.duree_s != null ? el('span', {}, `⏳ ${fmtDuree(m.duree_s)}`) : null,
      m.gagnant ? el('span', { style: 'color:var(--green);font-weight:700' }, `🏆 ${m.gagnant}`) : null));
  if (opts.onClick) { card.addEventListener('click', () => opts.onClick(m)); card.style.cursor = 'pointer'; }
  return card;
}

function grouperParRound(matchs, rounds) {
  const byKey = {};
  for (const m of matchs) {
    const k = `${m.bracket}${m.tour}`;
    (byKey[k] = byKey[k] || []).push(m);
  }
  return rounds
    .map(r => ({ round: r, matchs: (byKey[r.key] || []).sort((a, b) => a.position - b.position) }))
    .filter(g => g.matchs.length > 0);
}

function connecterSSE(onUpdate) {
  const src = new EventSource('/api/events');
  src.addEventListener('update', (e) => { try { onUpdate(JSON.parse(e.data)); } catch {} });
  src.onerror = () => {};
  return src;
}

function confirmer(msg) { return window.confirm(msg); }

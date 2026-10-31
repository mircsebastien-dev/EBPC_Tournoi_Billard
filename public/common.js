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
    if (Array.isArray(c)) { for (const cc of c) e.append(cc.nodeType ? cc : document.createTextNode(cc)); continue; }
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

function nav(active) {
  return el('nav', {},
    el('a', { href: '/', class: active === 'home' ? 'active' : null }, 'Tournoi'),
    el('a', { href: '/tv.html', class: active === 'tv' ? 'active' : null }, '📺 TV'),
    el('a', { href: '/suivi.html', class: active === 'joueur' ? 'active' : null }, 'Joueur'),
    el('a', { href: '/stats.html', class: active === 'stats' ? 'active' : null }, '📊 Stats'),
    el('a', { href: '/historique.html', class: active === 'hist' ? 'active' : null }, '🗂 Historique'),
    el('a', { href: '/admin.html', class: active === 'admin' ? 'active' : null }, 'Table de marque'));
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

function renderStatsPanel(stats, titre = '📊 Statistiques', topN = 10) {
  if (!stats) return null;
  const r = stats.resume;
  const panels = [];
  panels.push(el('div', { class: 'panel' },
    el('h2', {}, titre),
    el('div', { class: 'row' },
      el('span', { class: 'chip' }, `${r.joues}/${r.total} matchs joués`),
      r.restants > 0 ? el('span', { class: 'chip' }, `${r.restants} restants`) : null,
      r.duree_moyenne_s != null ? el('span', { class: 'chip' }, `⏱ durée moyenne ${fmtDuree(r.duree_moyenne_s)}`) : null,
      r.plus_rapide ? el('span', { class: 'chip' }, `⚡ plus rapide ${fmtDuree(r.plus_rapide.d)} (${r.plus_rapide.gagnant})`) : null,
      r.plus_long ? el('span', { class: 'chip' }, `🐢 plus long ${fmtDuree(r.plus_long.d)} (${r.plus_long.gagnant})`) : null,
      r.dernier_gagnant ? el('span', { class: 'chip' }, `🔥 dernier vainqueur : ${r.dernier_gagnant}`) : null)));
  const top = stats.classement.filter(p => p.joues > 0).slice(0, topN);
  if (top.length > 0) {
    panels.push(el('div', { class: 'panel' },
      el('h2', {}, '🏅 Classement'),
      el('table', { class: 'audit' },
        el('tr', {}, el('th', {}, '#'), el('th', {}, 'Joueur'), el('th', {}, 'Joués'), el('th', {}, 'Gagnés'), el('th', {}, 'Perdus'), el('th', {}, '%'), el('th', {}, 'Série')),
        ...top.map((p, i) => el('tr', {},
          el('td', {}, String(i + 1)),
          el('td', { style: 'font-weight:700' }, p.pseudo),
          el('td', {}, String(p.joues)), el('td', {}, String(p.gagnes)), el('td', {}, String(p.perdus)),
          el('td', {}, `${p.pct} %`),
          el('td', {}, p.serie > 0 ? `🔥 ${p.serie}V` : p.serie < 0 ? `${-p.serie}D` : '—'))))));
  }
  return panels;
}

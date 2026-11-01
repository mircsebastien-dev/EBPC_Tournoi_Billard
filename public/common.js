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
    el('a', { href: '/tableau.html', class: active === 'tableau' ? 'active' : null }, '🗺 Tableau'),
    el('a', { href: '/tv.html', class: active === 'tv' ? 'active' : null }, '📺 TV'),
    el('a', { href: '/suivi.html', class: active === 'joueur' ? 'active' : null }, 'Joueur'),
    el('a', { href: '/stats.html', class: active === 'stats' ? 'active' : null }, '📊 Stats'),
    el('a', { href: '/historique.html', class: active === 'hist' ? 'active' : null }, '🗂 Historique'),
    el('a', { href: '/admin.html', class: active === 'admin' ? 'active' : null }, 'Table de marque'));
}

function matchCard(m, opts = {}) {
  const j1g = m.gagnant_id && m.joueur1 && m.gagnant_id === m.joueur1.id;
  const j2g = m.gagnant_id && m.joueur2 && m.gagnant_id === m.joueur2.id;
  const card = el('div', { class: 'match-card' + (m.etat === 'prevu' ? ' attente' : ''), 'data-match-id': m.id },
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
      m.table != null ? el('span', { class: 'table-badge' }, `🎱 Table ${m.table}`) : null,
      el('span', {}, `race to ${m.manches}`),
      m.started_at ? el('span', {}, `⏱ début ${m.started_at.slice(11, 16)}`) : null,
      m.duree_s != null ? el('span', {}, `⏳ ${fmtDuree(m.duree_s)}`) : null,
      m.gagnant ? el('span', { style: 'color:var(--green);font-weight:700' }, `🏆 ${m.gagnant}`) : null),
      opts.extra || null);
  card.addEventListener('click', () => {
    if (opts.onClick) { opts.onClick(m); return; }
    if (typeof hasAdminPin === 'function' && hasAdminPin() && typeof openMatchEditor === 'function') {
      openMatchEditor(m, () => { if (opts.onAdminChange) opts.onAdminChange(); });
    } else {
      location.href = `/match.html?id=${m.id}`;
    }
  });
  card.style.cursor = 'pointer';
  if (typeof hasAdminPin === 'function' && hasAdminPin()) card.title = 'Clic = éditer (admin)';
  return card;
}

function grouperParRound(matchs, rounds) {
  const byKey = {};
  for (const m of matchs) {
    const k = `${m.bracket}${m.tour}`.toLowerCase(); // clés de rounds en minuscules (wb1, lb2, f1...)
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

/* ===== Bracket visuel partagé (tableau.html actif + tournoi.html archivé) ===== */
function renderBracket(container, t, opts = {}) {
  const rounds = t.rounds;
  const byKey = {};
  for (const m of t.matchs) {
    const k = m.bracket + m.tour;
    (byKey[k] = byKey[k] || []).push(m);
  }
  for (const k in byKey) byKey[k].sort((a, b) => a.position - b.position);
  // Loser bracket en miroir : le tour 1 est collé au WB (lecture du LB de droite à gauche)
  const ordered = [
    ...rounds.filter(r => r.bracket === 'LB').reverse(),
    ...rounds.filter(r => r.bracket === 'WB'),
    ...rounds.filter(r => r.bracket === 'F'),
  ];
  const groups = ordered.map(r => ({ round: r, matchs: byKey[r.bracket + r.tour] || [] })).filter(g => g.matchs.length > 0);

  const wrap = el('div', { class: 'bracket-scroll' });
  const bracket = el('div', { class: 'bracket', id: 'bracket' });
  const svg = el('svg', { id: 'bracket-svg' });
  bracket.append(svg);
  const NODE_H = 80; // hauteur d'un nœud de match
  const GAP = 16;
  const SLOT_H = NODE_H + GAP; // 96 : hauteur d'un slot de base
  // Le WB tour 1 (au centre) est la référence resserrée (level 0) ; l'escalier s'ouvre
  // vers la droite (WB2, WB3, F...) et vers la gauche en miroir (LB1, LB2...).
  const k = t.tournoi.format === 'double' ? t.tournoi.dko_tours : 0;
  const levelOf = (r) => r.bracket === 'WB' ? r.tour - 1
    : r.bracket === 'LB' ? r.tour
    : k + r.tour - 1;
  for (const g of groups) {
    const colCls = g.round.bracket === 'LB' ? 'lb' : g.round.bracket === 'F' ? 'finale' : 'wb';
    const col = el('div', { class: `bracket-col ${colCls}` }, el('h3', {}, g.round.label + ' · race to ' + g.round.manches));
    const step = Math.pow(2, levelOf(g.round));
    const lastTop = 40 + (g.matchs.length - 1) * step * SLOT_H + (step - 1) * SLOT_H / 2;
    col.style.height = (lastTop + NODE_H + 24) + 'px';
    col.style.justifyContent = 'flex-start';
    for (const m of g.matchs) {
      // escalier : le match #p est centré verticalement entre ses 2 parents (#2p-1 et #2p du niveau -1)
      const top = 40 + (m.position - 1) * step * SLOT_H + (step - 1) * SLOT_H / 2;
      const win1 = m.gagnant_id && m.joueur1 && m.gagnant_id === m.joueur1.id;
      const win2 = m.gagnant_id && m.joueur2 && m.gagnant_id === m.joueur2.id;
      const enAttente = m.etat === 'prevu';
      const node = el('div', {
        class: 'node' + (m.etat === 'en_cours' ? ' live' : '') + ((m.etat === 'termine' || m.etat === 'forfait') ? ' done' : '') + (enAttente ? ' attente' : ''),
        'data-id': m.id,
      },
        el('div', { class: 'nj' + (win1 ? ' win' : '') + (!m.joueur1 ? ' attente-j' : '') },
          el('span', {}, m.joueur1 ? m.joueur1.pseudo : '…'), el('span', { class: 'sc' }, String(m.score1))),
        el('div', { class: 'nj' + (win2 ? ' win' : '') + (!m.joueur2 ? ' attente-j' : '') },
          el('span', {}, m.joueur2 ? m.joueur2.pseudo : '…'), el('span', { class: 'sc' }, String(m.score2))),
        el('div', { class: 'meta' },
          enAttente ? el('span', { class: 'attente-tag' }, '⏳ match attendu') : null,
          m.etat === 'en_cours' ? el('span', { class: 'live-dot' }, '● LIVE') : null,
          (m.etat === 'termine' || m.etat === 'forfait') ? badgeEtat(m.etat) : null,
          m.table != null ? el('span', { class: 'table-badge' }, '🎱 Table ' + m.table) : null,
          m.duree_s != null ? el('span', {}, '⏳ ' + fmtDuree(m.duree_s)) : null));
      if (!opts.readonly) {
        node.addEventListener('click', () => {
          if (typeof hasAdminPin === 'function' && hasAdminPin() && typeof openMatchEditor === 'function') {
            openMatchEditor(m, () => { if (opts.onAdminChange) opts.onAdminChange(); });
          } else {
            location.href = `/match.html?id=${m.id}`;
          }
        });
        node.style.cursor = 'pointer';
        if (typeof hasAdminPin === 'function' && hasAdminPin()) node.title = 'Clic = éditer (admin)';
      }
      node.style.position = 'absolute';
      node.style.top = top + 'px';
      node.style.left = '0';
      node.style.right = '0';
      col.append(node);
    }
    bracket.append(col);
  }
  wrap.append(bracket);
  container.append(wrap);
  if (opts.drawLinks !== false) {
    // redraws robustes (iOS charge lentement, layout tardif)
    const redraw = () => drawBracketLinks(t);
    requestAnimationFrame(redraw);
    [60, 300, 800, 1500].forEach(ms => setTimeout(redraw, ms));
    window.addEventListener('load', redraw, { once: true });
    const sc = container.querySelector('.bracket-scroll') || container;
    sc.addEventListener('scroll', redraw, { passive: true });
  }
}

function drawBracketLinks(t) {
  const bracket = document.getElementById('bracket');
  const svg = document.getElementById('bracket-svg');
  if (!bracket || !svg || !t) return;
  const rect = bracket.getBoundingClientRect();
  // Pas de viewBox : 1 unité SVG = 1 px CSS, pour que les liens collent exactement aux nœuds
  svg.setAttribute('width', Math.ceil(rect.width));
  svg.setAttribute('height', Math.ceil(rect.height));
  svg.removeAttribute('viewBox');
  svg.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  for (const m of t.matchs) {
    for (const targetId of [m.suivant_id, m.perdant_id]) {
      if (!targetId) continue;
      const a = bracket.querySelector(`[data-id="${m.id}"]`);
      const b = bracket.querySelector(`[data-id="${targetId}"]`);
      if (!a || !b) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const x1 = ra.right - rect.left, y1 = ra.top + ra.height / 2 - rect.top;
      const x2 = rb.left - rect.left, y2 = rb.top + rb.height / 2 - rect.top;
      const mx = (x1 + x2) / 2;
      const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      let cls = '';
      if (m.etat === 'en_cours') cls = 'live';
      else if (m.etat === 'termine' || m.etat === 'forfait') cls = 'done';
      else if (m.etat === 'prevu') cls = 'attente';
      // halo (gros trait translucide) + trait fin coloré, pour être visible sur fond sombre
      const halo = document.createElementNS(ns, 'path');
      halo.setAttribute('d', d);
      if (cls) halo.setAttribute('class', cls + ' halo');
      else halo.setAttribute('class', 'halo');
      svg.append(halo);
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      if (cls) p.setAttribute('class', cls);
      svg.append(p);
    }
  }
}

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

function fmtDateHeure(dh) {
  if (!dh) return '';
  const d = new Date(dh.replace(' ', 'T') + 'Z');
  const p = n => String(n).padStart(2, '0');
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  return `${jours[d.getDay()]} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}h${p(d.getMinutes())}`;
}

/* ===== Édition admin inline d'un match (depuis le tableau quand le PIN est mémorisé) ===== */
function hasAdminPin() {
  return !!(localStorage.getItem('ebpc_admin_pin') || '');
}

async function adminCall(path, opts = {}) {
  const pin = localStorage.getItem('ebpc_admin_pin') || '';
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(pin ? { 'X-Admin-Pin': pin } : {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { localStorage.removeItem('ebpc_admin_pin'); throw new Error('PIN invalide — reconnecte-toi dans l\'admin'); }
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function openMatchEditor(m, onDone) {
  closeMatchEditor();
  const overlay = el('div', { id: 'match-editor', style: 'position:fixed;inset:0;z-index:100;background:rgba(5,5,8,.8);display:flex;align-items:center;justify-content:center;padding:16px' });
  const j1 = m.joueur1 ? m.joueur1.pseudo : '—';
  const j2 = m.joueur2 ? m.joueur2.pseudo : '—';
  const s1 = el('input', { type: 'number', min: 0, max: m.manches, value: m.score1, style: 'width:70px;text-align:center;font-size:22px;font-weight:800' });
  const s2 = el('input', { type: 'number', min: 0, max: m.manches, value: m.score2, style: 'width:70px;text-align:center;font-size:22px;font-weight:800' });
  const man = el('select', { style: 'width:auto' }, [3, 5, 7].map(n => el('option', { value: n, ...(n === m.manches ? { selected: '' } : {}) }, `race to ${n}`)));
  const motif = el('input', { placeholder: 'Motif (optionnel)', maxlength: 80, style: 'width:100%' });
  const msg = el('div', { class: 'msg err', style: 'display:none' });

  const btn = (label, cls, fn) => el('button', { class: cls, onclick: async () => {
    msg.style.display = 'none';
    try { await fn(); closeMatchEditor(); if (onDone) onDone(); }
    catch (e) { msg.textContent = e.message; msg.style.display = 'block'; }
  } }, label);

  const actions = [];
  if (m.etat === 'pret' || m.etat === 'prevu') {
    actions.push(btn('▶ Lancer', '', () => adminCall(`/api/admin/match/${m.id}/lancer`, { method: 'POST', body: '{}' })));
  }
  actions.push(btn('💾 Enregistrer le score', '', () => adminCall(`/api/admin/match/${m.id}/correction`, {
    method: 'POST', body: JSON.stringify({ score1: Number(s1.value), score2: Number(s2.value), manches: Number(man.value), motif: motif.value })
  })));
  if (m.etat === 'termine' || m.etat === 'forfait') {
    actions.push(btn('🔓 Rouvrir', 'secondary', () => adminCall(`/api/admin/match/${m.id}/rouvrir`, { method: 'POST', body: '{}' })));
  } else if (m.joueur1 && m.joueur2) {
    actions.push(btn(`${j1} forfait`, 'danger', () => adminCall(`/api/admin/match/${m.id}/forfait`, { method: 'POST', body: JSON.stringify({ joueur_id: m.joueur1.id }) })));
    actions.push(btn(`${j2} forfait`, 'danger', () => adminCall(`/api/admin/match/${m.id}/forfait`, { method: 'POST', body: JSON.stringify({ joueur_id: m.joueur2.id }) })));
  }

  overlay.append(el('div', { class: 'panel', style: 'max-width:460px;width:100%' },
    el('h2', {}, `✏️ Match #${m.position}`),
    el('p', { class: 'muted small' }, `${j1}  vs  ${j2} · ${badgeEtat(m.etat)}${m.table != null ? ' · 🎱 Table ' + m.table : ''}`),
    el('div', { style: 'display:flex;align-items:center;justify-content:center;gap:12px;margin:14px 0' },
      el('div', { style: 'font-weight:800;font-size:18px;max-width:130px;overflow:hidden;text-overflow:ellipsis' }, j1), s1,
      el('span', { class: 'muted', style: 'font-weight:800' }, '–'), s2,
      el('div', { style: 'font-weight:800;font-size:18px;max-width:130px;overflow:hidden;text-overflow:ellipsis' }, j2)),
    el('div', { class: 'row', style: 'justify-content:center' }, man, motif),
    msg,
    el('div', { class: 'actions', style: 'display:flex;flex-direction:column;gap:8px;margin-top:12px' }, ...actions),
    el('div', { style: 'margin-top:10px' }, el('button', { class: 'secondary', style: 'width:100%', onclick: closeMatchEditor }, 'Fermer'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMatchEditor(); });
  document.body.append(overlay);
}

function closeMatchEditor() {
  const e = document.getElementById('match-editor');
  if (e) e.remove();
}

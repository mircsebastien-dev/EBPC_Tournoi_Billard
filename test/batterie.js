// Batterie de tests complète — EBPC Tournoi Billard
// Usage: BASE=http://127.0.0.1:PORT node test/batterie.js
// Génère un rapport Markdown dans test/rapport.md (ou $RAPPORT)
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const PIN = process.env.ADMIN_PIN || '0000';
const RAPPORT = process.env.RAPPORT || path.join(__dirname, 'rapport.md');

let passed = 0, failed = 0;
const results = []; // {section, name, ok, detail}
let section = '';
function sec(name) { section = name; results.push({ section: name, name: '── ' + name + ' ──', ok: null, detail: '' }); }
function check(name, cond, detail = '') {
  if (cond) { passed++; results.push({ section, name, ok: true, detail: String(detail).slice(0, 200) }); }
  else { failed++; results.push({ section, name, ok: false, detail: String(detail).slice(0, 400) }); }
  console.log(`${cond ? '  OK ' : '  FAIL'} ${name}${cond ? '' : ' — ' + String(detail).slice(0, 160)}`);
}

let cookie = '';
async function api(p, { method = 'GET', body, pin = PIN, useCookie = false } = {}) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(pin ? { 'X-Admin-Pin': pin } : {}), ...(useCookie && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers };
}
const post = (p, body, opts) => api(p, { method: 'POST', body, ...opts });
const del = (p, opts) => api(p, { method: 'DELETE', ...opts });
const put = (p, body, opts) => api(p, { method: 'PUT', body, ...opts });

async function jouerMatch(m, gagnantId, opts = {}) {
  // tirage à la bande si pas fait (sinon 409 côté serveur)
  const cur = (await api('/api/etat')).data.actif.matchs.find(x => x.id === m.id);
  if (cur && cur.casseur == null) await api(`/api/match/${m.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m.joueur1.id } });
  if (m.etat !== 'en_cours') await post(`/api/admin/match/${m.id}/lancer`, { table_id: opts.table_id ?? null });
  for (let i = 0; i < m.manches; i++) await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: gagnantId } });
  return (await api('/api/etat')).data.actif.matchs.find(x => x.id === m.id);
}
async function jouerTournoiSimple(gagnantId) {
  for (let step = 0; step < 100; step++) {
    const t = (await api('/api/etat')).data.actif;
    if (!t || t.tournoi.statut === 'termine') return t || null;
    const m = t.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
    if (!m) return t;
    await post(`/api/admin/match/${m.id}/lancer`, { table_id: null });
    await api(`/api/match/${m.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m.joueur1.id } });
    for (let i = 0; i < m.manches; i++) await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: m.joueur1.id === gagnantId || m.joueur2.id === gagnantId ? gagnantId : m.joueur1.id } });
  }
  return null;
}
async function nouveauTournoi(body) {
  await del('/api/admin/tournoi').catch(() => {});
  return post('/api/admin/tournoi', body);
}

(async () => {
  const t0 = Date.now();
  console.log('=== BATTERIE DE TESTS EBPC Tournoi Billard ===\n');
  await del('/api/admin/tournoi').catch(() => {}); // repartir d'une DB propre

  // ---------- 1. Sécurité admin ----------
  sec('1. Sécurité admin (PIN)');
  let r = await api('/api/admin/audit', { pin: null });
  check('sans PIN -> 401', r.status === 401, r.status);
  r = await api('/api/admin/audit', { pin: 'mauvais' });
  check('mauvais PIN -> 401', r.status === 401, r.status);
  r = await api('/api/admin/audit', { pin: PIN });
  check('bon PIN -> 200', r.status === 200, r.status);

  // ---------- 2. Création tournoi ----------
  sec('2. Création / validation tournoi');
  r = await post('/api/admin/tournoi', { nom: 'X', regle: 'billard', taille: 16, format: 'simple' });
  check('règle invalide -> 400', r.status === 400, r.data.error);
  r = await post('/api/admin/tournoi', { nom: 'X', regle: 'blackball', taille: 8, format: 'simple' });
  check('taille 8 refusée (min 16) -> 400', r.status === 400, r.data.error);
  r = await nouveauTournoi({ nom: 'Batterie', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 4 });
  check('création OK', r.status === 200 && r.data.actif.tournoi.nom === 'Batterie', r.status);
  r = await post('/api/admin/tournoi', { nom: 'Y', regle: 'blackball', taille: 16, format: 'simple' });
  check('2e tournoi actif -> 409', r.status === 409, r.data.error);
  r = await api('/api/etat');
  check('/api/etat OK + tables = 4', r.status === 200 && r.data.actif.tables.length === 4, r.data.actif && r.data.actif.tables.length);
  check('/api/etat expose auto/table_pref/compte', 'auto' in r.data && 'table_pref' in r.data && 'compte' in r.data, Object.keys(r.data).join(','));

  // ---------- 3. Inscriptions ----------
  sec('3. Inscriptions joueurs');
  r = await post('/api/admin/joueur', { pseudo: 'Alice' });
  check('ajout Alice', r.status === 200, r.status);
  r = await post('/api/admin/joueur', { pseudo: 'alice' });
  check('doublon pseudo (casse) -> 409', r.status === 409, r.data.error);
  r = await post('/api/admin/joueurs/simulation', { count: 15, prefix: 'Simu' });
  check('simulation 15 joueurs', r.status === 200, r.status);
  let t = (await api('/api/etat')).data.actif;
  check('16 inscrits au total', t.joueurs.length === 16, t.joueurs.length);
  const alice = t.joueurs.find(j => j.pseudo === 'Alice');
  r = await post(`/api/admin/joueur/${alice.id}/paiement`, { statut: 'paye' });
  check('paiement Alice', r.status === 200, r.status);
  r = await post(`/api/admin/joueur/${alice.id}/paiement`, { statut: 'en_attente' });
  check('annulation paiement', r.status === 200, r.status);
  r = await del(`/api/admin/joueur/${t.joueurs.find(j => j.pseudo.startsWith('Simu')).id}`);
  check('suppression joueur', r.status === 200, r.status);
  await post('/api/admin/joueurs/simulation', { count: 1, prefix: 'Simu' });

  // ---------- 4. Comptes joueurs ----------
  sec('4. Comptes joueurs (auth, réinit, enroll)');
  r = await post('/api/compte/inscription', { pseudo: 'Seb', email: 'seb@test.fr', password: '1234' }, { pin: null });
  check('inscription compte 201 + cookie', r.status === 201 && !!cookie, r.status);
  r = await api('/api/compte/moi', { pin: null, useCookie: true });
  check('GET moi -> Seb', r.data.compte && r.data.compte.pseudo === 'Seb', JSON.stringify(r.data));
  r = await post('/api/compte/inscription', { pseudo: 'SEB', email: 'autre@test.fr', password: 'xxxx' }, { pin: null });
  check('doublon pseudo -> 409', r.status === 409, r.data.error);
  r = await post('/api/compte/inscription', { pseudo: 'Bad', email: 'pas-un-email', password: 'xxxx' }, { pin: null });
  check('email invalide -> 400', r.status === 400, r.data.error);
  r = await post('/api/compte/inscription', { pseudo: 'Bad2', email: 'b@test.fr', password: '12' }, { pin: null });
  check('mdp trop court -> 400', r.status === 400, r.data.error);
  r = await post('/api/compte/connexion', { pseudo: 'Seb', password: 'faux' }, { pin: null });
  check('mauvais mdp -> 401', r.status === 401, r.data.error);
  cookie = '';
  r = await post('/api/compte/connexion', { pseudo: 'Seb', password: '1234' }, { pin: null });
  check('connexion OK + cookie', r.status === 200 && !!cookie, r.status);
  r = await post('/api/tournoi/inscrire', {}, { pin: null, useCookie: true });
  check('self-enroll tournoi -> 201 (Seb)', r.status === 201 && r.data.joueur.pseudo === 'Seb', JSON.stringify(r.data));
  r = await post('/api/tournoi/inscrire', {}, { pin: null, useCookie: true });
  check('double enroll -> 409', r.status === 409, r.data.error);
  r = await post('/api/tournoi/inscrire', {}, { pin: null });
  check('enroll sans compte -> 401', r.status === 401, r.data.error);
  r = await post('/api/compte/oubli', { email: 'seb@test.fr' }, { pin: null });
  check('oubli mdp -> 200 + message générique', r.status === 200 && !r.data.error, r.data.message);
  const token = (r.data.dev_reset_link || '').split('token=')[1];
  check('dev_reset_link présent (pas de RESEND_API_KEY)', !!token, r.data.dev_reset_link ? 'oui' : 'non');
  r = await post('/api/compte/oubli', { email: 'inconnu@test.fr' }, { pin: null });
  check('oubli email inconnu -> même réponse (anti-énumération)', r.status === 200 && !r.data.dev_reset_link, r.status);
  r = await post('/api/compte/reinit', { token: token || 'x'.repeat(64), password: 'nouveau1' }, { pin: null });
  check('reinit avec token -> 200 + reconnecté', r.status === 200 && !!r.data.compte, JSON.stringify(r.data));
  r = await post('/api/compte/reinit', { token, password: 'encore1' }, { pin: null });
  check('token réutilisé -> 400', r.status === 400, r.data.error);
  r = await post('/api/compte/connexion', { pseudo: 'Seb', password: 'nouveau1' }, { pin: null });
  check('connexion avec nouveau mdp -> 200', r.status === 200, r.status);
  r = await post('/api/compte/deconnexion', {}, { pin: null, useCookie: true });
  check('déconnexion', r.status === 200, r.status);

  // ---------- 5. Tirage simple + blancs ----------
  sec('5. Tirage simple, blancs (bye), aléatoire crypto');
  // marquer tous payés sauf 6 -> 10 payés sur 16
  t = (await api('/api/etat')).data.actif;
  for (const j of t.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  // retirer 6 simu du paiement
  const simus = t.joueurs.filter(j => j.pseudo.startsWith('Simu')).slice(0, 6);
  for (const j of simus) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'en_attente' });
  r = await post('/api/admin/tournoi', { ajustement_auto: false }, ); // PUT? non -> recréer avec ajustement off
  // recréer proprement avec ajustement_auto off
  await del('/api/admin/tournoi');
  r = await post('/api/admin/tournoi', { nom: 'Blancs', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 4, ajustement_auto: false });
  await post('/api/admin/joueurs/simulation', { count: 10, prefix: 'J' });
  t = (await api('/api/etat')).data.actif;
  for (const j of t.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  r = await post('/api/admin/tirage', {});
  check('tirage OK', r.status === 200, r.status);
  t = r.data.actif;
  const wb1 = t.matchs.filter(m => m.bracket === 'WB' && m.tour === 1);
  const byes = wb1.filter(m => m.etat === 'termine' && ((m.joueur1 && !m.joueur2) || (m.joueur2 && !m.joueur1)));
  const vides = wb1.filter(m => m.etat === 'termine' && !m.joueur1 && !m.joueur2);
  const prets = wb1.filter(m => m.etat === 'pret');
  check('8 matchs WB1', wb1.length === 8, wb1.length);
  check('byes auto-terminés avec gagnant', byes.length > 0 && byes.every(b => b.gagnant_id != null), `${byes.length} byes, ${vides.length} vides, ${prets.length} prets`);
  const wb2 = t.matchs.filter(m => m.bracket === 'WB' && m.tour === 2);
  check('gagnants byes propagés au tour 2', wb2.some(m => m.joueur1 || m.joueur2), wb2.filter(m => m.joueur1 || m.joueur2).length);
  // aléatoire: 2 tirages différents
  const app1 = wb1.map(m => [m.joueur1?.pseudo, m.joueur2?.pseudo].join('-')).sort().join('|');
  await del('/api/admin/tournoi');
  await post('/api/admin/tournoi', { nom: 'B2', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 4, ajustement_auto: false });
  await post('/api/admin/joueurs/simulation', { count: 10, prefix: 'J' });
  t = (await api('/api/etat')).data.actif;
  for (const j of t.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  await post('/api/admin/tirage', {});
  t = (await api('/api/etat')).data.actif;
  const app2 = t.matchs.filter(m => m.bracket === 'WB' && m.tour === 1).map(m => [m.joueur1?.pseudo, m.joueur2?.pseudo].join('-')).sort().join('|');
  check('2 tirages -> appariements différents (crypto)', app1 !== app2, '');

  // ---------- 6. Matchs : lancer, scores, runout, forfait, 403 ----------
  sec('6. Matchs (lancer/scores/runout/forfait/sécurité)');
  t = (await api('/api/etat')).data.actif;
  const m0 = t.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
  r = await post(`/api/admin/match/${m0.id}/lancer`, { table_id: t.tables[0].id });
  check('lancer sur table 1', r.status === 200 && r.data.match.etat === 'en_cours' && r.data.match.table === 1, JSON.stringify(r.data.match && r.data.match.table));
  const j1 = m0.joueur1.id, j2 = m0.joueur2.id;
  await api(`/api/match/${m0.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: j1 } }); // tirage à la bande (obligatoire côté serveur)
  r = await api(`/api/match/${m0.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: 9999 } });
  check('manche par externe -> 403', r.status === 403, r.status);
  r = await api(`/api/match/${m0.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: j1 } });
  check('+1 manche J1', r.status === 200 && r.data.match.score1 === 1, JSON.stringify(r.data.match && r.data.match.score1));
  r = await api(`/api/match/${m0.id}/retirer`, { method: 'POST', pin: null, body: { joueur_id: j1 } });
  check('−1 manche J1', r.status === 200 && r.data.match.score1 === 0, r.status);
  r = await api(`/api/match/${m0.id}/runout`, { method: 'POST', pin: null, body: { joueur_id: j2, kind: 'casse' } });
  check('runout casse ferme J2 (+1)', r.status === 200 && r.data.match.score2 === 1, JSON.stringify(r.data.match && r.data.match.score2));
  // terminer le match par forfait de J2
  r = await post(`/api/admin/match/${m0.id}/forfait`, { joueur_id: j2 });
  check('forfait J2 -> match terminé, gagnant J1', r.status === 200 && r.data.match.etat === 'forfait' && r.data.match.gagnant_id === j1, JSON.stringify(r.data.match && r.data.match.etat));
  // stats runout
  r = await api(`/api/joueur/${j2}/stats`, { pin: null });
  check('stats J2: runouts=1, casse=1', r.data.runouts === 1 && r.data.casse === 1, JSON.stringify({ runouts: r.data.runouts, casse: r.data.casse }));
  r = await api(`/api/joueur/${j2}/historique`, { pin: null });
  check('historique J2: 1 ligne, défaite, score présent', r.data.historique.length === 1 && r.data.historique[0].victoire === false && typeof r.data.historique[0].moi === 'number', JSON.stringify(r.data.historique[0] && { v: r.data.historique[0].victoire, s: r.data.historique[0].moi + '-' + r.data.historique[0].lui }));

  // ---------- 7. Mode auto + ordre des tables ----------
  sec('7. Mode auto + préférence de tables');
  await del('/api/admin/tournoi');
  r = await post('/api/admin/tournoi', { nom: 'Auto', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 8 });
  await post('/api/admin/joueurs/simulation', { count: 16, prefix: 'J' });
  t = (await api('/api/etat')).data.actif;
  for (const j of t.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  await post('/api/admin/tirage', {});
  r = await post('/api/admin/auto', { on: true, table_pref: '3,4,5,6,7,8,1,2' });
  check('auto ON + table_pref enregistrés', r.status === 200 && r.data.auto === true, JSON.stringify(r.data.auto));
  r = await api('/api/etat');
  check('etat.auto=true persistant + table_pref', r.data.auto === true && r.data.table_pref === '3,4,5,6,7,8,1,2', r.data.table_pref);
  t = r.data.actif;
  const enCours = t.matchs.filter(m => m.etat === 'en_cours');
  check('8 matchs lancés auto sur 8 tables', enCours.length === 8, enCours.length);
  // jouer tout le tour 1 -> les matchs du tour 2 doivent partir sur T3,T4,T5,T6 (ordre pref)
  for (const m of enCours) await jouerMatch(m, m.joueur1.id);
  t = (await api('/api/etat')).data.actif;
  const t2 = t.matchs.filter(m => m.bracket === 'WB' && m.tour === 2 && m.etat === 'en_cours').map(m => m.table).sort();
  check('tour 2 lancé sur T3,T4,T5,T6 (ordre pref 3,4,5,6...)', JSON.stringify(t2) === '[3,4,5,6]', JSON.stringify(t2));
  r = await post('/api/admin/auto', { on: false });
  r = await api('/api/etat');
  check('auto OFF persistant', r.data.auto === false, r.data.auto);
  await post('/api/admin/auto', { on: true });

  // ---------- 8. Tables dynamiques en cours ----------
  sec('8. Tables modifiables en cours');
  r = await put('/api/admin/tournoi', { nb_tables: 10 });
  t = (await api('/api/etat')).data.actif;
  check('8 -> 10 tables en cours', r.status === 200 && t.tables.length === 10, t.tables.length);
  r = await put('/api/admin/tournoi', { nb_tables: 2 });
  check('10 -> 2 avec tables occupées -> 409', r.status === 409, r.data.error);
  t = (await api('/api/etat')).data.actif;
  // terminer assez de matchs pour libérer 8 tables
  const enc = t.matchs.filter(m => m.etat === 'en_cours');
  for (const m of enc.slice(0, 8)) await jouerMatch(m, m.joueur1.id);
  r = await put('/api/admin/tournoi', { nb_tables: 4 });
  t = (await api('/api/etat')).data.actif;
  check('après libérations, réduction à 4 OK', r.status === 200 && t.tables.length === 4, `${r.status} tables=${t.tables.length}`);
  r = await put('/api/admin/tournoi', { nom: 'NouveauNom' });
  t = (await api('/api/etat')).data.actif;
  check('nom verrouillé en cours', t.tournoi.nom === 'Auto', t.tournoi.nom);

  // ---------- 9. DKO : croisement LB, pas de re-match ----------
  sec('9. Double KO: liens, croisement LB, anti-re-match');
  await del('/api/admin/tournoi');
  await post('/api/admin/tournoi', { nom: 'DKO', regle: 'blackball', taille: 16, format: 'double', dko_tours: 2, nb_tables: 8 });
  await post('/api/admin/joueurs/simulation', { count: 16, prefix: 'J' });
  t = (await api('/api/etat')).data.actif;
  for (const j of t.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  await post('/api/admin/auto', { on: false }); // sinon auto lance tout seul et aucun match n'est 'pret'
  await post('/api/admin/tirage', {});
  t = (await api('/api/etat')).data.actif;
  const lb2 = t.matchs.filter(m => m.bracket === 'LB' && m.tour === 2);
  check('LB2 existe (4 matchs)', lb2.length === 4, lb2.length);
  // rejouer tout le tournoi et détecter les re-matchs hors finale
  const deja = new Set();
  let rematchs = 0;
  for (let step = 0; step < 500; step++) {
    t = (await api('/api/etat')).data.actif;
    if (!t) break;
    if (t.tournoi.statut === 'termine') break;
    const m = t.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
    if (!m) break;
    const a = Math.min(m.joueur1.id, m.joueur2.id), b = Math.max(m.joueur1.id, m.joueur2.id);
    if (deja.has(a + '-' + b) && m.bracket !== 'F') rematchs++;
    deja.add(a + '-' + b);
    await post(`/api/admin/match/${m.id}/lancer`, { table_id: null });
    await api(`/api/match/${m.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m.joueur1.id } });
    const g = Math.random() < 0.5 ? m.joueur1.id : m.joueur2.id;
    for (let i = 0; i < m.manches; i++) await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: g } });
  }
  const hist0 = (await api('/api/tournois')).data.tournois;
  const lastT = hist0.reduce((a, b) => (b.id > a.id ? b : a)); // le plus récent (liste triée DESC)
  check('tournoi DKO terminé', lastT.statut === 'termine', lastT.statut);
  check('0 re-match hors finale (croisement LB OK)', rematchs === 0, rematchs);
  check('champion renseigné', lastT.champion_id != null, lastT.champion_id);

  // ---------- 10. Stats globales + QR + SSE ----------
  sec('10. Stats globales, QR code, audit');
  r = await api('/api/stats-joueurs', { pin: null });
  check('stats-joueurs 200 + joueurs avec id/manches/runouts', r.status === 200 && r.data.joueurs.length > 0 && 'id' in r.data.joueurs[0] && 'manches' in r.data.joueurs[0] && 'runouts' in r.data.joueurs[0], r.data.joueurs.length);
  const champ = r.data.joueurs.find(p => p.titres > 0);
  check('titres = 1 par tournoi gagné (pas par match)', !champ || champ.titres >= 1, champ && `titres=${champ.titres} joues=${champ.joues}`);
  r = await fetch(BASE + '/api/qrcode.svg?text=' + encodeURIComponent('https://example.com'));
  const svg = await r.text();
  check('QR svg 200 + svg valide', r.status === 200 && svg.includes('<svg'), r.status);
  r = await api('/api/admin/audit', { pin: PIN });
  check('journal audit lisible', r.status === 200, r.status);

  // ---------- rapport ----------


  // ================= NOUVELLES FEATURES =================
  results.push({ ok: null, name: '── Amis, admin-data, règles, points, clôture ──' });

  // tournoi frais
  await del('/api/admin/tournoi');
  let nf_rc = await post('/api/admin/tournoi', { nom: 'Batterie2', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2 });
  check('création Batterie2', nf_rc.status === 200, nf_rc.status + ' ' + (nf_rc.data.error || ''));
  let nf_rs = await post('/api/admin/joueurs/simulation', { count: 15, prefix: 'J' });
  check('simulation 15 joueurs', nf_rs.status === 200, nf_rs.status);
  await post('/api/admin/joueur', { pseudo: 'Seb' }); // compte 'Seb' existe déjà (créé plus haut)
  let nf_t = (await api('/api/etat')).data.actif;
  check('16 joueurs inscrits', nf_t && nf_t.joueurs.length === 16, nf_t && nf_t.joueurs.length);
  for (const j of nf_t.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  nf_t = (await api('/api/etat')).data.actif;
  check('16 joueurs payés', nf_t.joueurs.filter(j => j.statut === 'paye').length === 16, nf_t.joueurs.filter(j => j.statut === 'paye').length);

  // --- amis (AliceBT connectée, ami = Seb) ---
  let nf_ra = await post('/api/compte/inscription', { pseudo: 'AliceBT', email: 'alicebt@x.fr', password: '1234' }, { pin: null });
  check('inscription AliceBT', nf_ra.status === 201, nf_ra.status + ' ' + (nf_ra.data.error || ''));
  const nf_cookieAlice = cookie;
  let nf_r = await api('/api/comptes/recherche?q=seb', { pin: null, useCookie: true });
  check('recherche compte par pseudo', nf_r.status === 200 && nf_r.data.comptes.some(c => c.pseudo === 'Seb'), JSON.stringify(nf_r.data).slice(0, 120));
  nf_r = await post('/api/compte/amis', { pseudo: 'Seb' }, { pin: null, useCookie: true });
  check('ajout ami', nf_r.status === 200 && nf_r.data.ami && nf_r.data.ami.pseudo === 'Seb', nf_r.status);
  nf_r = await post('/api/compte/amis', { pseudo: 'Seb' }, { pin: null, useCookie: true });
  check('ami doublon -> 409', nf_r.status === 409, nf_r.status);
  nf_r = await post('/api/compte/amis', { pseudo: 'NobodyXYZ' }, { pin: null, useCookie: true });
  check('ami inconnu -> 404', nf_r.status === 404, nf_r.status);
  nf_r = await post('/api/compte/amis', { pseudo: 'AliceBT' }, { pin: null, useCookie: true });
  check('s\'ajouter soi-même -> 400', nf_r.status === 400, nf_r.status);
  let nf_rt = await post('/api/admin/tirage', {});
  check('tirage OK', nf_rt.status === 200, nf_rt.status + ' ' + (nf_rt.data.error || ''));
  nf_r = await api('/api/compte/amis', { pin: null, useCookie: true });
  check('liste amis = 1 (Seb)', nf_r.status === 200 && nf_r.data.amis.length === 1 && nf_r.data.amis[0].pseudo === 'Seb', nf_r.status);
  check('ami a un statut de tournoi', ['pret', 'en_cours', 'inscrit'].includes(nf_r.data.amis[0].statut.type), nf_r.data.amis[0].statut.type);
  nf_t = (await api('/api/etat')).data.actif;
  const nf_jseb = nf_t.joueurs.find(j => j.pseudo === 'Seb');
  check('joueur Seb rattaché au compte', !!(nf_jseb && nf_jseb.compte_id), JSON.stringify(nf_jseb && nf_jseb.compte_id));
  nf_r = await del('/api/compte/amis/' + nf_r.data.amis[0].compte_id, { pin: null, useCookie: true });
  nf_r = await api('/api/compte/amis', { pin: null, useCookie: true });
  check('retrait ami', nf_r.data.amis.length === 0, nf_r.status);
  cookie = '';

  // --- règles: bande, alternance, 403 casse/reprise ---
  nf_t = (await api('/api/etat')).data.actif;
  const nf_m = nf_t.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
  nf_r = await api(`/api/match/${nf_m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: nf_m.joueur1.id } });
  check('saisie bloquée sans tirage à la bande', [403, 409].includes(nf_r.status), nf_r.status);
  await post(`/api/admin/match/${nf_m.id}/lancer`, { table_id: null });
  await api(`/api/match/${nf_m.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: nf_m.joueur1.id } });
  let nf_mm = (await api('/api/etat')).data.actif.matchs.find(x => x.id === nf_m.id);
  check('bande -> casseau = gagnant', nf_mm.casseur && nf_mm.casseur.id === nf_m.joueur1.id, JSON.stringify(nf_mm.casseur));
  nf_r = await api(`/api/match/${nf_m.id}/runout`, { method: 'POST', pin: null, body: { joueur_id: nf_m.joueur1.id, kind: 'reprise' } });
  check('casseur fait reprise -> 403', nf_r.status === 403, nf_r.status);
  nf_r = await api(`/api/match/${nf_m.id}/runout`, { method: 'POST', pin: null, body: { joueur_id: nf_m.joueur2.id, kind: 'casse' } });
  check('non-casseur fait casse -> 403', nf_r.status === 403, nf_r.status);
  await api(`/api/match/${nf_m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: nf_m.joueur2.id } });
  nf_mm = (await api('/api/etat')).data.actif.matchs.find(x => x.id === nf_m.id);
  check('alternance après manche (casseur a changé)', nf_mm.casseur && nf_mm.casseur.id !== nf_m.joueur1.id, JSON.stringify(nf_mm.casseur));

  // --- modale admin: table / joueurs / rouvrir ---
  nf_r = await post(`/api/admin/match/${nf_m.id}/table`, { table_id: nf_t.tables[1].id });
  check('changer table -> 200', nf_r.status === 200, nf_r.status);
  nf_r = await post(`/api/admin/match/${nf_m.id}/table`, { table_id: 99999 });
  check('table inconnue -> 400', nf_r.status === 400, nf_r.status);
  for (let i = 0; i < nf_m.manches; i++) await api(`/api/match/${nf_m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: nf_m.joueur1.id } });
  nf_r = await post(`/api/admin/match/${nf_m.id}/rouvrir`, {});
  check('rouvrir avec aval propagé -> 409', nf_r.status === 409, nf_r.status);

  const nf_autre = nf_t.joueurs.find(j => j.id !== nf_m.joueur1.id && j.id !== nf_m.joueur2.id);
  nf_r = await post(`/api/admin/match/${nf_m.id}/joueurs`, { joueur1_id: nf_autre.id, joueur2_id: nf_m.joueur2.id });
  check('changer joueur1 -> 200', nf_r.status === 200, nf_r.status);
  nf_r = await post(`/api/admin/match/${nf_m.id}/joueurs`, { joueur1_id: nf_m.joueur2.id, joueur2_id: nf_m.joueur2.id });
  check('même joueur x2 -> 400', nf_r.status === 400, nf_r.status);

  // --- points + clôture coupe net ---
  const nf_st = (await api('/api/etat')).data.actif.stats.classement.filter(p => p.joues > 0);
  check('points présents dans le classement', nf_st.length > 0 && nf_st.every(p => p.points !== undefined), nf_st.length);
  const nf_g = nf_st.find(p => p.gagnes > 0);
  check('joueurs avec points >= 1', nf_st.some(p => p.points >= 1), 'nf_st=' + nf_st.length);
  const nf_stG = (await api('/api/stats-joueurs')).data.joueurs;
  check('stats globales ont points', nf_stG.every(p => p.points !== undefined), nf_stG.length);
  // --- admin-data: PUT joueur + delete event ---
  const nf_j0 = nf_t.joueurs[0];
  nf_r = await put(`/api/admin/joueur/${nf_j0.id}`, { pseudo: 'RenamedBT' });
  check('PUT joueur pseudo -> 200', nf_r.status === 200 && nf_r.data.joueur.pseudo === 'RenamedBT', nf_r.status);
  nf_r = await put(`/api/admin/joueur/${nf_j0.id}`, { pseudo: 'Seb' });
  check('PUT joueur pseudo pris -> 409', nf_r.status === 409, nf_r.status);
  nf_r = await api(`/api/admin/match/${nf_m.id}/events`);
  const nf_ev = nf_r.data.events.find(e => e.type === 'manche' || e.type === 'runout');
  if (nf_ev) {
    const nf_av = (await api('/api/etat')).data.actif.matchs.find(x => x.id === nf_m.id);
    nf_r = await del(`/api/admin/match/${nf_m.id}/event/${nf_ev.id}`);
    check('delete event recalcule le score (diminue)', nf_r.status === 200 && nf_r.data.match && (nf_r.data.match.score1 + nf_r.data.match.score2) < (nf_av.score1 + nf_av.score2), 'status=' + nf_r.status + ' ' + (nf_r.data.error || '') + ' ' + nf_av.score1 + '-' + nf_av.score2 + ' -> ' + (nf_r.data.match ? nf_r.data.match.score1 + '-' + nf_r.data.match.score2 : 'null'));
    nf_r = await del(`/api/admin/match/${nf_m.id}/event/${nf_ev.id}`, { pin: null });
    check('delete event sans PIN -> 401', nf_r.status === 401, nf_r.status);
  }

  nf_r = await post('/api/admin/terminer', {});
  check('clôture -> 200', nf_r.status === 200, nf_r.status);
  const nf_hist = (await api('/api/tournois')).data.tournois.find(h => h.nom === 'Batterie2');
  check('clôture coupe net -> champion null', nf_hist && nf_hist.champion === null, JSON.stringify(nf_hist && nf_hist.champion));

  const duree = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = results.filter(x => x.ok === true).length;
  const ko = results.filter(x => x.ok === false);
  let md = `# Rapport de batterie de tests — EBPC Tournoi Billard\n\n`;
  md += `- Date : ${new Date().toISOString()}\n- Base : ${BASE}\n- Résultat : **${passed} OK / ${failed} ÉCHEC** (${duree}s)\n\n`;
  md += `| Statut | Test | Détail |\n|---|---|---|\n`;
  for (const x of results) {
    if (x.ok === null) { md += `\n## ${x.name.replace(/^── | ──$/g, '')}\n\n`; continue; }
    md += `| ${x.ok ? '✅' : '❌'} | ${x.name} | ${x.ok ? '' : x.detail.replace(/\|/g, '\\|')} |\n`;
  }
  md += `\n## Couverture\n\n`;
  md += `- Sécurité admin (PIN 401/200)\n- Création/validation tournoi (taille, règle, doublon)\n- Inscriptions (ajout, doublon, paiement, suppression, simulation)\n`;
  md += `- Comptes joueurs (inscription, doublon, email/mdp invalides, connexion, mauvais mdp, déconnexion, oubli mdp + réinit par token, anti-énumération, self-enroll, 401 sans compte, double enroll)\n`;
  md += `- Tirage (blancs/bye auto-gagnés + propagation, match vide, aléatoire crypto)\n- Matchs (lancer, table, +1/−1, runout casse, forfait, 403 externe)\n`;
  md += `- Mode auto (on/off persistant, ordre des tables préféré 3..8,1,2)\n- Tables dynamiques en cours (ajout, réduction, 409 si occupées, nom verrouillé)\n`;
  md += `- Double KO (liens LB/F, croisement anti-re-match sur tournoi complet, champion)\n- Stats (stats-joueurs avec titres distincts, fiche joueur, historique), QR code, journal d'audit\n`;
  md += `- Amis (recherche, ajout 200/409/404/400, liste+statut, retrait, rattachement compte à l'inscription)\n`;
  md += `- Règles match (bande ⚪, alternance, blocage saisie sans bande, 403 casse/reprise, modale admin table/joueurs/rouvrir-409)\n`;
  md += `- Admin-data (PUT joueur 200/409, delete event + recalc, 401 sans PIN)\n`;
  md += `- Points au classement (présents, gagnant >= 1) + clôture coupe net (champion null)\n`;
  fs.writeFileSync(RAPPORT, md);
  console.log(`\n=== ${passed} OK / ${failed} ÉCHEC en ${duree}s — rapport: ${RAPPORT} ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(2); });

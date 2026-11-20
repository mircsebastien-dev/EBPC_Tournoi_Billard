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
async function api(p, { method = 'GET', body, pin = PIN, useCookie = false, club = null } = {}) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(pin ? { 'X-Admin-Pin': pin } : {}), ...(useCookie && cookie ? { Cookie: cookie } : {}), ...(club ? { 'X-Club': club } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers };
}
const post = (p, body, opts) => api(p, { method: 'POST', body, ...opts });
const del = (p, opts = {}) => { const o = { method: 'DELETE', ...opts }; if (p.startsWith('/api/admin') && !o.body) o.body = { confirm_pin: PIN }; return api(p, o); };
const put = (p, body, opts) => api(p, { method: 'PUT', body, ...opts });

async function jouerMatch(m, gagnantId, opts = {}) {
  // tirage à la bande si pas fait (sinon 409 côté serveur)
  const cur = (await api('/api/etat')).data.actif.matchs.find(x => x.id === m.id);
  if (cur && cur.casseur == null) await api(`/api/match/${m.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m.joueur1.id } });
  if (m.etat !== 'en_cours') await post(`/api/admin/match/${m.id}/lancer`, { table_id: opts.table_id ?? null });
  for (let i = 0; i < m.manches; i++) await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: gagnantId } });
  // le tournoi peut se terminer automatiquement sur ce dernier match (actif -> null)
  const apres = (await api('/api/etat')).data.actif;
  return apres ? apres.matchs.find(x => x.id === m.id) : null;
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
  // rappel push inscriptions ouvertes : réservé admin, phase inscription uniquement
  r = await api('/api/admin/tournoi/rappel-inscriptions', { method: 'POST', body: {}, pin: null });
  check('rappel inscriptions sans PIN -> 401', r.status === 401, r.status);
  r = await post('/api/admin/tournoi/rappel-inscriptions', {});
  check('rappel inscriptions en phase inscription -> 200 + envoyes=0 (aucun abonné en CI)', r.status === 200 && r.data.ok === true && r.data.envoyes === 0, JSON.stringify(r.data));
  r = await api('/api/etat');
  check('/api/etat OK + tables = 4', r.status === 200 && r.data.actif.tables.length === 4, r.data.actif && r.data.actif.tables.length);
  check('/api/etat expose auto/table_pref/compte', 'auto' in r.data && 'table_pref' in r.data && 'compte' in r.data, Object.keys(r.data).join(','));
  // bracket virtuel avant tirage (16 joueurs simple) : structure complète exposée, matchs marqués virtuels
  const virt = r.data.actif.matchs;
  check('bracket virtuel avant tirage : 15 matchs (16j simple)', virt.length === 15 && virt.every(m => m.virtuel === true), virt.length);
  const vWb1 = virt.find(m => m.bracket === 'WB' && m.tour === 1 && m.position === 1);
  const vCible = virt.find(m => m.id === vWb1.suivant_id);
  check('virtuel : wb1-001 -> wb2-001 slot 1', vWb1.suivant_slot === 1 && vCible.bracket === 'WB' && vCible.tour === 2 && vCible.position === 1, JSON.stringify(vWb1.suivant_id));
  check('virtuel : aucun joueur, tout prevu, ids v*, pas de perdant (simple)', virt.every(m => !m.joueur1 && !m.joueur2 && m.etat === 'prevu' && /^v\d+$/.test(m.id) && !m.perdant_id), '');

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
  // --- self-désinscription (compte connecté, phase inscription, pas encore payé) ---
  r = await del('/api/tournoi/desinscrire', { pin: null });
  check('self-désinscription sans compte -> 401', r.status === 401, r.data.error);
  // déjà payé -> refus (la self-désinscription ne concerne que les inscrits non payés)
  let sebJ = (await api('/api/etat')).data.actif.joueurs.find(j => j.pseudo === 'Seb');
  r = await post(`/api/admin/joueur/${sebJ.id}/paiement`, { statut: 'paye' });
  check('Seb marqué payé (setup)', r.status === 200, r.status);
  r = await del('/api/tournoi/desinscrire', { pin: null, useCookie: true });
  check('self-désinscription déjà payé -> 409 (deja_paye)', r.status === 409 && r.data.deja_paye === true, r.status + ' ' + (r.data.error || ''));
  r = await post(`/api/admin/joueur/${sebJ.id}/paiement`, { statut: 'en_attente' });
  check('paiement Seb annulé (setup)', r.status === 200, r.status);
  r = await del('/api/tournoi/desinscrire', { pin: null, useCookie: true });
  check('self-désinscription -> 200 (Seb)', r.status === 200 && r.data.pseudo === 'Seb', JSON.stringify(r.data));
  t = (await api('/api/etat')).data.actif;
  check('désinscrit : Seb absent du tournoi', !t.joueurs.some(j => j.pseudo === 'Seb'), t.joueurs.length + ' joueurs');
  r = await del('/api/tournoi/desinscrire', { pin: null, useCookie: true });
  check('double désinscription -> 404', r.status === 404, r.data.error);
  r = await post('/api/tournoi/inscrire', {}, { pin: null, useCookie: true });
  check('ré-inscription après désinscription -> 201', r.status === 201, r.status + ' ' + (r.data.error || ''));
  r = await post('/api/joueur', { pseudo: 'InviteSeb' }, { pin: null, useCookie: true });
  check('inscription anonyme avec compte connecté -> 409 (compte_connecte)', r.status === 409 && r.data.compte_connecte === true, r.status + ' ' + (r.data.error || ''));
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
  check('byes/vides auto-terminés : 6 blancs répartis, byes avec gagnant, vides sans gagnant', byes.every(b => b.gagnant_id != null) && vides.every(v => v.gagnant_id == null) && byes.length + 2 * vides.length === 6 && 2 * prets.length + byes.length === 10, `${byes.length} byes, ${vides.length} vides, ${prets.length} prets`);
  const wb2 = t.matchs.filter(m => m.bracket === 'WB' && m.tour === 2);
  const joueursWb2 = wb2.flatMap(m => [m.joueur1?.id, m.joueur2?.id]).filter(x => x != null);
  check('gagnants byes propagés au tour 2', joueursWb2.length === byes.length && byes.every(b => joueursWb2.includes(b.gagnant_id)), `${joueursWb2.length} joueurs en WB2 pour ${byes.length} byes`);
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
  // après le −1, le ⚪ est revenu à J1 -> J2 ne peut faire qu'une reprise ferme
  r = await api(`/api/match/${m0.id}/runout`, { method: 'POST', pin: null, body: { joueur_id: j2, kind: 'reprise' } });
  check('runout reprise ferme J2 (+1)', r.status === 200 && r.data.match.score2 === 1, JSON.stringify(r.data.match && r.data.match.score2));
  // terminer le match par forfait de J2
  r = await post(`/api/admin/match/${m0.id}/forfait`, { joueur_id: j2 });
  check('forfait J2 -> match terminé, gagnant J1', r.status === 200 && r.data.match.etat === 'forfait' && r.data.match.gagnant_id === j1, JSON.stringify(r.data.match && r.data.match.etat));
  r = await post(`/api/admin/match/${m0.id}/forfait`, { joueur_id: 9999 });
  check('forfait joueur hors match -> 400 (pas de 500 FK)', r.status === 400, r.status + ' ' + JSON.stringify(r.data.error));
  r = await post(`/api/admin/match/${m0.id}/forfait`, {});
  check('forfait sans joueur_id -> 400', r.status === 400, r.status);
  // stats runout
  r = await api(`/api/joueur/${j2}/stats`, { pin: null });
  check('stats J2: runouts=1, reprise=1, casse=0', r.data.runouts === 1 && r.data.reprise === 1 && r.data.casse === 0, JSON.stringify({ runouts: r.data.runouts, casse: r.data.casse, reprise: r.data.reprise }));
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
  // régression "req is not defined": finir un match du tour 2 déclenche un auto-lancement (tour 3) logué dans majEtBroadcast -> la requête doit rester 200
  const mT2 = t.matchs.find(m => m.bracket === 'WB' && m.tour === 2 && m.etat === 'en_cours');
  await api(`/api/match/${mT2.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: mT2.joueur1.id } });
  let lastSt = null;
  for (let i = 0; i < mT2.manches; i++) { const rr = await api(`/api/match/${mT2.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: mT2.joueur1.id } }); lastSt = rr.status; }
  check('manche provoquant un auto-lancement -> 200 (régression req is not defined)', lastSt === 200, 'dernier status=' + lastSt);
  r = await api('/api/admin/audit?q=auto_lancement');
  check('auto_lancement bien logué (avec club_id)', r.data.audit.length > 0 && r.data.audit.every(a => a.club_id != null), 'nb=' + r.data.audit.length);
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
  await post('/api/admin/tournoi', { nom: 'DKO32', regle: 'blackball', taille: 32, format: 'double', dko_tours: 2, nb_tables: 8 });
  // bracket virtuel avant tirage (32 joueurs double k=2) : 55 matchs de structure, câblage identique au futur tirage
  let tv = (await api('/api/etat')).data.actif;
  check('virtuel DKO32: 55 matchs, tous virtuels prevu sans joueur', tv.matchs.length === 55 && tv.matchs.every(m => m.virtuel === true && m.etat === 'prevu' && !m.joueur1 && !m.joueur2), tv.matchs.length);
  const vLB2 = tv.matchs.find(m => m.bracket === 'LB' && m.tour === 2 && m.position === 1);
  const vF1c = tv.matchs.find(m => m.id === vLB2.suivant_id);
  check('virtuel DKO32: lb2-001 -> f1-005 slot 2 (croisement demi-moitié)', vLB2.suivant_slot === 2 && vF1c.bracket === 'F' && vF1c.tour === 1 && vF1c.position === 5, JSON.stringify(vLB2.suivant_id));
  const vWB1 = tv.matchs.find(m => m.bracket === 'WB' && m.tour === 1 && m.position === 1);
  const vLB1c = tv.matchs.find(m => m.id === vWB1.perdant_id);
  check('virtuel DKO32: perdant wb1-001 -> lb1-001 slot 1', vWB1.perdant_slot === 1 && vLB1c.bracket === 'LB' && vLB1c.tour === 1 && vLB1c.position === 1, '');
  await post('/api/admin/joueurs/simulation', { count: 32, prefix: 'J' });
  t = (await api('/api/etat')).data.actif;
  for (const j of t.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  await post('/api/admin/auto', { on: false }); // sinon auto lance tout seul et aucun match n'est 'pret'
  await post('/api/admin/tirage', {});
  t = (await api('/api/etat')).data.actif;
  // structure DKO 32 / k=2 : WB1=16 matchs, WB2=8, LB1=8, LB2=4, F1=4 (1/8), F2=2 (quarts), F3=1 (demi)?? -> F: 8->4->2->1
  const count = (b, tt) => t.matchs.filter(m => m.bracket === b && (tt == null || m.tour === tt)).length;
  check('DKO32: WB1=16, WB2=8, LB1=8, LB2=8, F=15 (8+4+2+1)', count('WB', 1) === 16 && count('WB', 2) === 8 && count('LB', 1) === 8 && count('LB', 2) === 8 && count('F') === 15, `WB1=${count('WB',1)} WB2=${count('WB',2)} LB1=${count('LB',1)} LB2=${count('LB',2)} F=${count('F')}`);
  check('DKO32: 32 joueurs inscrits', t.joueurs.length === 32, t.joueurs.length);
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
  const fullT = (await api('/api/tournois/' + lastT.id)).data.tournoi;
  const stDKO = fullT.stats ? fullT.stats.classement : null;
  if (stDKO) {
    const maxPts = Math.max(...stDKO.map(p => p.points || 0));
    check('DKO32: max points = 6 (finale F4, k=2)', maxPts === 6, maxPts);
    const finalistes = stDKO.filter(p => p.points === 6).length;
    check('DKO32: 2 finalistes à 6 pts (ex-aequo)', finalistes === 2, finalistes);
  }

  // ---------- 10. Stats globales + QR + SSE ----------
  sec('10. Stats globales, QR code, audit');
  r = await api('/api/stats-joueurs', { pin: null });
  check('stats-joueurs 200 + joueurs avec id/manches/runouts', r.status === 200 && r.data.joueurs.length > 0 && 'id' in r.data.joueurs[0] && 'manches' in r.data.joueurs[0] && 'runouts' in r.data.joueurs[0], r.data.joueurs.length);
  const champ = r.data.joueurs.find(p => p.titres > 0);
  check('titres = 1 par tournoi gagné (pas par match)', !champ || champ.titres >= 1, champ && `titres=${champ.titres} joues=${champ.joues}`);
  // head-to-head : bilan V/D par adversaire sur la fiche joueur
  const jH2H = r.data.joueurs.find(p => p.joues > 0) || r.data.joueurs[0];
  r = await api(`/api/joueur/${jH2H.id}/historique`);
  const hh = r.data.h2h || [];
  const histH2H = r.data.historique || [];
  check('fiche joueur: h2h par adversaire (joues = victoires + defaites, dernier renseigné)', hh.length > 0 && hh.every(x => x.adversaire_id && x.adversaire && x.joues === x.victoires + x.defaites && typeof x.dernier_victoire === 'boolean'), `${hh.length} adversaires, ${histH2H.length} matchs`);
  check('fiche joueur: totaux h2h = totaux historique (matchs decides et victoires)', hh.reduce((a, x) => a + x.joues, 0) === histH2H.filter(x => x.gagnant).length && hh.reduce((a, x) => a + x.victoires, 0) === histH2H.filter(x => x.victoire).length, `${hh.reduce((a, x) => a + x.joues, 0)} joues h2h / ${histH2H.length} historique`);
  r = await fetch(BASE + '/api/qrcode.svg?text=' + encodeURIComponent('https://example.com'));
  const svg = await r.text();
  check('QR svg 200 + svg valide', r.status === 200 && svg.includes('<svg'), r.status);
  r = await api('/api/admin/audit', { pin: PIN });
  check('journal audit lisible', r.status === 200, r.status);

  // ---------- 11. Rollback (snapshots) + confirm_pin + slots + byes classement ----------
  sec('11. Rollback point-in-time, confirm_pin sur suppressions, snapshots audit');
  await del('/api/admin/tournoi').catch(() => {});
  r = await post('/api/admin/tournoi', { nom: 'RB', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  check('création tournoi RB (notif_push=false accepté)', r.status === 200, r.data && r.data.error);
  await post('/api/admin/joueurs/simulation', { count: 16, prefix: 'P' });
  r = await post('/api/admin/tirage', {});
  check('tirage RB', r.status === 200, r.status);
  r = await post('/api/admin/tournoi/rappel-inscriptions', {});
  check('rappel inscriptions après tirage -> 409', r.status === 409, r.status + ' ' + (r.data.error || ''));
  let t11 = (await api('/api/etat')).data.actif;
  const prevu = t11.matchs.find(m => m.etat === 'prevu');
  const feeder = prevu && t11.matchs.find(x => x.suivant_id === prevu.id || x.perdant_id === prevu.id);
  check('slots exposés dans /api/etat (suivant_slot/perdant_slot)', !!feeder && (feeder.suivant_slot === 1 || feeder.suivant_slot === 2 || feeder.perdant_slot === 1 || feeder.perdant_slot === 2), feeder && JSON.stringify({ s: feeder.suivant_slot, p: feeder.perdant_slot }));
  check('classement: byes exclus (joues=0 juste après tirage)', t11.stats.resume.joues === 0, t11.stats.resume.joues);
  const m11 = t11.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
  await post(`/api/admin/match/${m11.id}/lancer`, { table_id: null });
  await api(`/api/match/${m11.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m11.joueur1.id } });
  for (let i = 0; i < m11.manches; i++) await api(`/api/match/${m11.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: m11.joueur1.id } });
  t11 = (await api('/api/etat')).data.actif;
  check('match joué 3-0 avant rollback', t11.matchs.find(x => x.id === m11.id).etat === 'termine', t11.matchs.find(x => x.id === m11.id).etat);
  // anti-rematch sur changement manuel de joueurs (hors finale -> 409)
  const prevuWB = t11.matchs.find(m => m.etat === 'prevu' && m.bracket !== 'F');
  if (prevuWB) {
    r = await post(`/api/admin/match/${prevuWB.id}/joueurs`, { joueur1_id: m11.joueur1.id, joueur2_id: m11.joueur2.id });
    check('changer joueurs vers paire déjà jouée -> 409 rematch (hors finale)', r.status === 409 && /rematch/i.test(r.data.error || ''), r.status + ' ' + (r.data.error || ''));
    // paire inédite: joueur qui n'apparaît dans aucun match avec m11.joueur1 (ni joué ni prévu)
    const autre = t11.joueurs.find(j => j.id !== m11.joueur1.id && j.id !== m11.joueur2.id &&
      !t11.matchs.some(m => (m.joueur1 && m.joueur2) && ((m.joueur1.id === m11.joueur1.id && m.joueur2.id === j.id) || (m.joueur1.id === j.id && m.joueur2.id === m11.joueur1.id))));
    r = await post(`/api/admin/match/${prevuWB.id}/joueurs`, { joueur1_id: m11.joueur1.id, joueur2_id: autre.id });
    check('changer joueurs vers paire inédite -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  }
  let audit = (await api('/api/admin/audit')).data.audit;
  const evTirage = audit.find(a => a.action === 'tirage');
  check('audit: événement tirage a un snapshot (has_snapshot)', !!evTirage && evTirage.has_snapshot === 1, evTirage && evTirage.has_snapshot);
  const evLancement = audit.find(a => a.action === 'lancement_match');
  check('audit: lancement lisible (code match + "vs")', !!evLancement && /vs/.test(evLancement.cible || ''), evLancement && evLancement.cible);
  r = await api('/api/admin/tournoi', { method: 'DELETE', body: {} });
  check('DELETE tournoi sans confirm_pin -> 401', r.status === 401, r.status);
  r = await api('/api/admin/tournoi', { method: 'DELETE', body: { confirm_pin: 'mauvais' } });
  check('DELETE tournoi mauvais code -> 401', r.status === 401, r.status);
  r = await post('/api/admin/tournoi/rollback', { audit_id: evTirage.id });
  check('rollback sans confirm_pin -> 401', r.status === 401, r.status);
  r = await post('/api/admin/tournoi/rollback', { audit_id: 99999999, confirm_pin: PIN });
  check('rollback audit_id inconnu -> 404', r.status === 404, r.status);
  r = await post('/api/admin/tournoi/rollback', { audit_id: evTirage.id, confirm_pin: PIN });
  check('rollback avec bon code -> 200', r.status === 200, r.data && r.data.error);
  t11 = (await api('/api/etat')).data.actif;
  const mRet = t11.matchs.find(x => x.id === m11.id);
  check('après rollback: match revenu à pret 0-0', mRet.etat === 'pret' && mRet.score1 === 0 && mRet.score2 === 0, `${mRet.etat} ${mRet.score1}-${mRet.score2}`);
  audit = (await api('/api/admin/audit')).data.audit;
  check('rollback logué dans l\'audit', audit.some(a => a.action === 'rollback'));
  // rollback avec un match EN COURS (lancé + 1 manche + table assignée)
  await post(`/api/admin/match/${m11.id}/lancer`, { table_id: t11.tables[0].id });
  await api(`/api/match/${m11.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m11.joueur1.id } });
  await api(`/api/match/${m11.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: m11.joueur1.id } });
  t11 = (await api('/api/etat')).data.actif;
  const mEC = t11.matchs.find(x => x.id === m11.id);
  check('match en cours 1-0 sur table avant rollback', mEC.etat === 'en_cours' && mEC.score1 === 1 && mEC.score2 === 0 && !!mEC.table, `${mEC.etat} ${mEC.score1}-${mEC.score2} table=${mEC.table}`);
  r = await post('/api/admin/tournoi/rollback', { audit_id: evTirage.id, confirm_pin: PIN });
  check('rollback avec match en cours -> 200', r.status === 200, r.data && r.data.error);
  t11 = (await api('/api/etat')).data.actif;
  const mRet2 = t11.matchs.find(x => x.id === m11.id);
  check('après rollback (match en cours): pret 0-0, table libérée', mRet2.etat === 'pret' && mRet2.score1 === 0 && mRet2.score2 === 0 && !mRet2.table, `${mRet2.etat} ${mRet2.score1}-${mRet2.score2} table=${mRet2.table}`);
  r = await api('/api/admin/tournoi', { method: 'DELETE', body: { confirm_pin: PIN } });
  check('DELETE tournoi avec bon code -> 200', r.status === 200, r.status);
  await post('/api/admin/tournoi', { nom: 'RB2', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2 });
  await post('/api/admin/joueur', { pseudo: 'Temp' });
  t11 = (await api('/api/etat')).data.actif;
  const jt = t11.joueurs.find(x => x.pseudo === 'Temp');
  r = await api(`/api/admin/joueur/${jt.id}`, { method: 'DELETE', body: {} });
  check('désinscription joueur SANS confirm_pin -> 200 (exempté)', r.status === 200, r.status);
  await del('/api/admin/tournoi').catch(() => {});

  // ---------- 12. Anti brute-force PIN admin (uniquement si TEST_BRUTEFORCE=1 ; lancer le serveur avec
  // PIN_MAX_ESSAIS / PIN_FENETRE_MS / PIN_BLOCAGE_MS petits, ex. PIN_MAX_ESSAIS=4 PIN_FENETRE_MS=1500 PIN_BLOCAGE_MS=2000) ----------
  if (process.env.TEST_BRUTEFORCE === '1') {
    sec('12. Anti brute-force PIN admin (429 après N échecs, lockout même pour le bon code, déblocage après délai)');
    const maxEssais = Number(process.env.PIN_MAX_ESSAIS || 10);
    const blocageMs = Number(process.env.PIN_BLOCAGE_MS || 600000);
    let got429 = null, tries = 0;
    while (tries < maxEssais + 5 && !got429) {
      tries++;
      const rr = await api('/api/admin/audit', { pin: 'faux-' + Date.now() + '-' + tries });
      if (rr.status === 429) got429 = rr;
    }
    check('après plusieurs mauvais PIN -> 429', !!got429, `tries=${tries}`);
    check('message 429 avec délai restant', !!got429 && /réessaie|s/i.test(got429.data.error || ''), got429 && got429.data.error);
    r = await api('/api/admin/audit', { pin: PIN });
    check('pendant le lockout, même le bon PIN -> 429', r.status === 429, r.status);
    await new Promise(res => setTimeout(res, blocageMs + 1200));
    r = await api('/api/admin/audit', { pin: PIN });
    check('après le délai, le bon PIN repasse -> 200', r.status === 200, r.status);
    r = await api('/api/admin/audit', { pin: 'faux-apres-' + Date.now() });
    check('nouvel échec après déblocage -> 401 (compteur remis à zéro par le succès)', r.status === 401, r.status);
  }

  // ---------- 13. Robustesse (erreurs JSON, validation entrées, concurrence, health) ----------
  sec('13. Robustesse: health, 404/400/413 JSON, validation entrées, concurrence manches');
  await del('/api/admin/tournoi').catch(() => {});
  r = await post('/api/admin/tournoi', { nom: 'Robust', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  check('création tournoi Robust', r.status === 200, r.status + ' ' + (r.data.error || ''));
  await post('/api/admin/joueurs/simulation', { count: 12, prefix: 'R' }); // 12 pour laisser de la place aux tests de pseudo
  // tests d'entrées en phase inscription (avant le tirage)
  r = await api('/api/health', { pin: null });
  check('/api/health -> 200 ok + db ok', r.status === 200 && r.data.ok === true && r.data.db === 'ok', JSON.stringify(r.data));
  r = await api('/api/rien-du-tout', { pin: null });
  check('route API inconnue -> 404 JSON', r.status === 404 && !!r.data.error, r.status);
  let rr = await fetch(BASE + '/api/admin/joueur', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': PIN }, body: '{oops' });
  const rrJson = await rr.json().catch(() => ({}));
  check('JSON malformé -> 400 JSON (pas HTML)', rr.status === 400 && !!rrJson.error, rr.status + ' ' + JSON.stringify(rrJson).slice(0, 80));
  r = await api('/api/admin/match/abc/events');
  check('id non numérique -> pas de 500', r.status !== 500, r.status);
  r = await post('/api/admin/joueur', { pseudo: 'X'.repeat(500) });
  let t13 = (await api('/api/etat')).data.actif;
  let j13 = t13.joueurs.find(j => j.id === r.data.id);
  check('pseudo 500 chars -> tronqué à 40', r.status === 200 && !!(j13 && j13.pseudo.length === 40), r.status + ' len=' + (j13 && j13.pseudo.length));
  r = await post('/api/admin/joueur', { pseudo: "'; DROP TABLE joueur;--" });
  check('pseudo injection SQL -> 200 (paramétré), pas d\'erreur', r.status === 200, r.status + ' ' + (r.data.error || ''));
  t13 = (await api('/api/etat')).data.actif;
  check('table joueur intacte après tentative d\'injection', !!(t13 && t13.joueurs.length >= 12), t13 && t13.joueurs.length);
  r = await post('/api/admin/joueur', { pseudo: 'A\nB\tC' });
  j13 = (await api('/api/etat')).data.actif.joueurs.find(j => j.id === r.data.id);
  check('pseudo avec caractères de contrôle -> nettoyé', r.status === 200 && !!(j13 && !/[\x00-\x1f\x7f]/.test(j13.pseudo)), JSON.stringify(j13 && j13.pseudo));
  rr = await fetch(BASE + '/api/admin/joueur', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': PIN }, body: JSON.stringify({ pseudo: 'Y'.repeat(300 * 1024) }) });
  check('body > 256ko -> 413 JSON', rr.status === 413, rr.status);
  await post('/api/admin/tirage', {});
  // concurrence: 20 manches en parallèle sur le même match -> aucune 500, score cohérent
  t13 = (await api('/api/etat')).data.actif;
  const m13 = t13.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
  await post(`/api/admin/match/${m13.id}/lancer`, { table_id: null });
  await api(`/api/match/${m13.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m13.joueur1.id } });
  const resps = await Promise.all(Array.from({ length: 20 }, () => api(`/api/match/${m13.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: m13.joueur1.id } })));
  check('20 manches en parallèle -> aucune 500', resps.every(x => x.status !== 500), resps.map(x => x.status).join(','));
  const cur13 = (await api('/api/etat')).data.actif.matchs.find(x => x.id === m13.id);
  const ev13 = (await api(`/api/admin/match/${m13.id}/events`)).data.events.filter(e => e.type === 'manche' || e.type === 'runout');
  check('concurrence: score == nb events manche (pas de double comptage)', cur13.score1 + cur13.score2 === ev13.length, `${cur13.score1}-${cur13.score2} vs ${ev13.length} events`);
  check('concurrence: match terminé proprement à la distance', cur13.etat === 'termine' && cur13.score1 === m13.manches, `${cur13.etat} ${cur13.score1}-${cur13.score2} manches=${m13.manches}`);
  await del('/api/admin/tournoi').catch(() => {});

  // ---------- 14. Lot sécurité 1: rate-limit comptes via x-forwarded-for + session admin limitée ----------
  sec('14. Rate-limit comptes keyé sur X-Forwarded-For + session admin 8h (front)');
  // 10 mauvaises connexions depuis une IP "proxy" fictive -> la 11e doit être 429
  let statuts = [];
  for (let i = 0; i < 11; i++) {
    const rr2 = await fetch(BASE + '/api/compte/connexion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '9.9.9.9' },
      body: JSON.stringify({ pseudo: 'Seb', password: 'faux-' + i }),
    });
    statuts.push(rr2.status);
  }
  check('10 mauvaises connexions XFF 9.9.9.9 -> 401, la 11e -> 429', statuts.slice(0, 10).every(s => s === 401) && statuts[10] === 429, statuts.join(','));
  const rr3 = await fetch(BASE + '/api/compte/connexion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudo: 'Seb', password: 'faux-sans-xff' }),
  });
  check('sans XFF (IP réelle 127.0.0.1) -> pas locké par le bucket 9.9.9.9 (401)', rr3.status === 401, rr3.status);
  // session admin: expiration 8h + bouton verrouiller dans admin-common.js
  const acjs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-common.js'), 'utf8');
  check('front: expiration session admin 8h (ADMIN_SESSION_MS + ebpc_admin_pin_since)', acjs.includes('ADMIN_SESSION_MS') && acjs.includes('ebpc_admin_pin_since'), '');
  check('front: bouton Verrouiller + effacement du PIN mémorisé', acjs.includes('Verrouiller') && acjs.includes('verrouillerAdmin'), '');

  // ---------- 15. Lot fiabilité admin: export/import JSON, diff avant rollback, filtre audit ----------
  sec('15. Export/import JSON tournoi, diff avant rollback, filtre du journal');
  await del('/api/admin/tournoi').catch(() => {});
  r = await post('/api/admin/tournoi', { nom: 'ExpImp', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  check('création tournoi ExpImp', r.status === 200, r.status + ' ' + (r.data.error || ''));
  await post('/api/admin/joueurs/simulation', { count: 16, prefix: 'E' });
  r = await post('/api/admin/tirage', {});
  check('tirage ExpImp', r.status === 200, r.status);
  let t15 = (await api('/api/etat')).data.actif;
  const m15 = t15.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
  await post(`/api/admin/match/${m15.id}/lancer`, { table_id: null });
  await api(`/api/match/${m15.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m15.joueur1.id } });
  await api(`/api/match/${m15.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: m15.joueur1.id } });
  // export
  r = await api('/api/admin/tournoi/export');
  check('export -> 200, payload complet (tournoi+16 joueurs+matchs+events)', r.status === 200 && r.data.tournoi && r.data.tournoi.nom === 'ExpImp' && r.data.joueurs.length === 16 && r.data.matchs.length > 0 && Array.isArray(r.data.events), r.status);
  const exportPayload = r.data;
  // diff avant rollback (événement tirage)
  const audit15 = (await api('/api/admin/audit')).data.audit;
  const evTirage15 = audit15.find(a => a.action === 'tirage');
  r = await api(`/api/admin/tournoi/rollback/diff?audit_id=${evTirage15.id}`);
  check('diff rollback -> 200 avec resume', r.status === 200 && !!(r.data.resume && r.data.resume.matchs_modifies >= 1), r.status + ' ' + JSON.stringify(r.data.resume || r.data.error));
  check('diff: le match joué apparaît modifié', r.status === 200 && r.data.modifies.some(m => m.id === m15.id), '');
  // filtres audit
  r = await api('/api/admin/audit?action=tirage');
  check('audit?action=tirage -> uniquement des tirages', r.status === 200 && r.data.audit.length >= 1 && r.data.audit.every(a => a.action === 'tirage'), r.status);
  r = await api('/api/admin/audit?q=ExpImp');
  check('audit?q=ExpImp -> au moins la création, tout filtré côté serveur', r.status === 200 && r.data.audit.length >= 1, r.status + ' n=' + (r.data.audit || []).length);
  // import
  await del('/api/admin/tournoi').catch(() => {});
  r = await post('/api/admin/tournoi/import', { payload: exportPayload, replace: true });
  check('import sans confirm_pin -> 401', r.status === 401, r.status);
  r = await post('/api/admin/tournoi/import', { payload: exportPayload, replace: true, confirm_pin: 'mauvais' });
  check('import mauvais confirm_pin -> 401', r.status === 401, r.status);
  r = await post('/api/admin/tournoi/import', { payload: { foo: 1 }, replace: true, confirm_pin: PIN });
  check('import JSON invalide -> 400', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await post('/api/admin/tournoi/import', { payload: exportPayload, replace: true, confirm_pin: PIN });
  check('import valide -> 200, tournoi recréé (FK remappées, validées au COMMIT)', r.status === 200 && r.data.actif && r.data.actif.tournoi.nom === 'ExpImp', r.status + ' ' + (r.data.error || ''));
  if (r.status === 200) {
    const t15b = (await api('/api/etat')).data.actif;
    check('import: 16 joueurs et tous les matchs présents', t15b.joueurs.length === 16 && t15b.matchs.length === exportPayload.matchs.length, `${t15b.joueurs.length}j ${t15b.matchs.length}m vs ${exportPayload.matchs.length}m`);
    const m15b = t15b.matchs.find(m => m.etat === 'en_cours' && m.joueur1 && m.joueur2);
    check('import: match en cours conservé (score 1-0)', !!(m15b && m15b.score1 + m15b.score2 === 1), m15b && `${m15b.score1}-${m15b.score2}`);
    check('import: lien suivant_id valide', !m15b.suivant_id || !!t15b.matchs.find(x => x.id === m15b.suivant_id), '');
    // import avec tournoi actif et SANS replace -> 409
    r = await post('/api/admin/tournoi/import', { payload: exportPayload, confirm_pin: PIN });
    check('import avec actif sans replace -> 409', r.status === 409, r.status);
    // export par id (même tournoi)
    r = await api(`/api/admin/tournoi/export?id=${r.data.tournoi_id || t15b.tournoi.id}`);
    check('export?id= -> 200', r.status === 200 && r.data.tournoi.nom === 'ExpImp', r.status);
  }
  await del('/api/admin/tournoi').catch(() => {});


  // ---------- rapport ----------


  // ================= NOUVELLES FEATURES =================
  results.push({ ok: null, name: '── Amis, admin-data, règles, points, clôture ──' });

  // tournoi frais
  await del('/api/admin/tournoi');
  let nf_rc = await post('/api/admin/tournoi', { nom: 'Batterie2', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2 });
  check('création Batterie2', nf_rc.status === 200, nf_rc.status + ' ' + (nf_rc.data.error || ''));
  let nf_rs = await post('/api/admin/joueurs/simulation', { count: 15, prefix: 'J' });
  check('simulation 15 joueurs', nf_rs.status === 200, nf_rs.status);
  // anonyme avec pseudo libre d'abord (une fois Seb ajouté, le tableau serait plein à 16/16)
  let nf_pr = await post('/api/joueur', { pseudo: 'InviteBT' }, { pin: null });
  check('inscription anonyme avec pseudo libre -> 200', nf_pr.status === 200, nf_pr.status + ' ' + (nf_pr.data.error || ''));
  nf_pr = await del(`/api/admin/joueur/${(await api('/api/etat')).data.actif.joueurs.find(j => j.pseudo === 'InviteBT').id}`);
  check('suppression du joueur anonyme InviteBT', nf_pr.status === 200, nf_pr.status);
  // pseudos réservés: un compte 'Seb' existe (créé plus haut) -> anonyme refusé, admin OK après confirmation
  nf_pr = await post('/api/joueur', { pseudo: 'Seb' }, { pin: null });
  check('inscription anonyme avec pseudo d\'un compte -> 409 (réservé)', nf_pr.status === 409 && nf_pr.data.compte_pseudo === true, nf_pr.status + ' ' + (nf_pr.data.error || ''));
  nf_pr = await post('/api/admin/joueur', { pseudo: 'Seb' });
  check('ajout admin pseudo d\'un compte sans confirmation -> 409', nf_pr.status === 409 && nf_pr.data.compte_pseudo === true, nf_pr.status + ' ' + (nf_pr.data.error || ''));
  nf_pr = await post('/api/admin/joueur', { pseudo: 'Seb', confirme: true });
  check('ajout admin avec confirmation -> 200', nf_pr.status === 200, nf_pr.status + ' ' + (nf_pr.data.error || ''));
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
  nf_r = await del('/api/tournoi/desinscrire', { pin: null, useCookie: true });
  check('self-désinscription tournoi lancé -> 409', nf_r.status === 409, nf_r.status + ' ' + (nf_r.data.error || ''));
  nf_r = await api('/api/compte/amis', { pin: null, useCookie: true });
  check('liste amis = 1 (Seb)', nf_r.status === 200 && nf_r.data.amis.length === 1 && nf_r.data.amis[0].pseudo === 'Seb', nf_r.status);
  check('ami a un statut de tournoi', ['pret', 'en_cours', 'inscrit'].includes(nf_r.data.amis[0].statut.type), nf_r.data.amis[0].statut.type);
  check('ami inscrit expose joueur_id (lien fiche joueur)', typeof nf_r.data.amis[0].joueur_id === 'number', JSON.stringify(nf_r.data.amis[0].joueur_id));
  // affiche du prochain tournoi (poster auto-généré, phase inscription)
  const idxHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  check('front: panneau amis page tournoi -> clic nom renvoie /joueur.html?id=', idxHtml.includes('/joueur.html?id=${a.joueur_id}'), '');
  nf_t = (await api('/api/etat')).data.actif;
  const nf_jseb = nf_t.joueurs.find(j => j.pseudo === 'Seb');
  check('joueur Seb rattaché au compte', !!(nf_jseb && nf_jseb.compte_id), JSON.stringify(nf_jseb && nf_jseb.compte_id));
  nf_r = await del('/api/compte/amis/' + nf_r.data.amis[0].compte_id, { pin: null, useCookie: true });
  nf_r = await api('/api/compte/amis', { pin: null, useCookie: true });
  check('retrait ami', nf_r.data.amis.length === 0, nf_r.status);
  // --- amis sans compte: suivi par pseudo ---
  nf_r = await post('/api/compte/amis-pseudo', { pseudo: 'Ghost' }, { pin: null, useCookie: true });
  check('suivi pseudo sans compte -> 200', nf_r.status === 200 && nf_r.data.ami && nf_r.data.ami.pseudo === 'Ghost' && nf_r.data.ami.sans_compte === true, nf_r.status + ' ' + (nf_r.data.error || ''));
  nf_r = await post('/api/compte/amis-pseudo', { pseudo: 'ghoSt' }, { pin: null, useCookie: true });
  check('suivi pseudo doublon (casse ignorée) -> 409', nf_r.status === 409, nf_r.status);
  nf_r = await post('/api/compte/amis-pseudo', { pseudo: 'Seb' }, { pin: null, useCookie: true });
  check('suivi du pseudo d\'un compte -> 409', nf_r.status === 409, nf_r.status);
  nf_r = await post('/api/compte/amis-pseudo', { pseudo: 'AliceBT' }, { pin: null, useCookie: true });
  check('suivre son propre pseudo -> 400', nf_r.status === 400, nf_r.status);
  nf_r = await post('/api/compte/amis-pseudo', { pseudo: '   ' }, { pin: null, useCookie: true });
  check('suivi pseudo vide -> 400', nf_r.status === 400, nf_r.status);
  nf_r = await api('/api/compte/amis', { pin: null, useCookie: true });
  check('liste amis = 1 suivi pseudo (Ghost)', nf_r.data.amis.length === 1 && nf_r.data.amis[0].pseudo === 'Ghost' && nf_r.data.amis[0].sans_compte === true, JSON.stringify(nf_r.data.amis.map(a => a.pseudo)));
  check('suivi pseudo jamais inscrit -> hors_tournoi + joueur_id null', nf_r.data.amis[0].statut.type === 'hors_tournoi' && nf_r.data.amis[0].joueur_id === null, JSON.stringify(nf_r.data.amis[0]));
  const nf_ghostId = nf_r.data.amis[0].id;
  // admin voit les amis et pseudos suivis de chaque compte (/api/admin/comptes)
  nf_r = await post('/api/compte/amis', { pseudo: 'Seb' }, { pin: null, useCookie: true });
  check('re-ajout ami Seb (pour test admin)', nf_r.status === 200, nf_r.status);
  // push: abonnement du compte, visible par l'admin (colonne Push de admin-comptes)
  nf_r = await api('/api/push/subscribe', { method: 'POST', pin: null, useCookie: true, body: { subscription: { endpoint: 'https://push.example/batterie-ep1', keys: { p256dh: 'k', auth: 'a' } } } });
  check('push: abonnement enregistré (session compte)', nf_r.status === 200, nf_r.status);
  const nf_sebId = (await api('/api/comptes/recherche?q=seb', { pin: null, useCookie: true })).data.comptes.find(c => c.pseudo === 'Seb').id;
  const nf_adminL = (await api('/api/admin/comptes')).data.comptes.find(c => c.pseudo === 'AliceBT');
  check('admin comptes: amis_comptes (Seb) + amis_pseudos (Ghost) exposés', !!(nf_adminL && (nf_adminL.amis_comptes || '').includes('Seb') && (nf_adminL.amis_pseudos || '').includes('Ghost')), JSON.stringify({ a: nf_adminL && nf_adminL.amis_comptes, p: nf_adminL && nf_adminL.amis_pseudos }));
  check('admin comptes: push_abonnements exposé (1 appareil pour le compte abonné)', !!(nf_adminL && nf_adminL.push_abonnements === 1), JSON.stringify(nf_adminL && nf_adminL.push_abonnements));
  const admHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-comptes.html'), 'utf8');
  check('front: colonne Amis dans admin-comptes (comptes + sans compte)', admHtml.includes('amis_comptes') && admHtml.includes('amis_pseudos') && admHtml.includes('sans compte'), '');
  check('front: colonne Push (abonnements notifs) + total notifiables dans admin-comptes', admHtml.includes('push_abonnements') && admHtml.includes('🔔') && admHtml.includes('notifs push activées'), '');
  const cptHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'compte-vues.js'), 'utf8');
  check('front: bouton « Me désinscrire » (accueil + page mes matchs)', idxHtml.includes('Me désinscrire') && cptHtml.includes('Me désinscrire') && (idxHtml + cptHtml).includes('/api/tournoi/desinscrire'), '');
  check('front: self-désinscription masquée si déjà payé', idxHtml.includes('la désinscription se fait auprès de la table de marque') && cptHtml.includes('la désinscription se fait auprès de la table de marque'), '');
  // face-à-face (head-to-head) sur la fiche joueur
  const joHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'joueur.html'), 'utf8');
  check('front: panneau Face-à-face (h2h) sur la fiche joueur, tableau plié à 5 + bouton Tout voir, adversaire cliquable', joHtml.includes('Face-à-face') && joHtml.includes('H2H_MAX = 5') && joHtml.includes('Tout voir') && joHtml.includes('/joueur.html?id=${x.adversaire_id}'), '');
  // rappel inscriptions ouvertes : bouton admin (phase inscription)
  const atHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-tournoi.html'), 'utf8');
  check('front: bouton Rappel inscriptions ouvertes (admin-tournoi, phase inscription)', atHtml.includes('rappel-inscriptions') && atHtml.includes('Rappel inscriptions ouvertes') && atHtml.includes('rappelInscriptions'), '');
  // affiche du prochain tournoi (poster auto-généré, phase inscription)
  check('front: affiche tournoi à venir (poster) : eyebrow + jauge inscrits, sans QR ni emojis', idxHtml.includes('poster-eyebrow') && idxHtml.includes('poster-bar') && idxHtml.includes('restantes') && idxHtml.includes('Inscriptions ouvertes') && !idxHtml.includes('/api/qrcode.svg') && !idxHtml.includes('📅') && !idxHtml.includes('📍'), '');
  // re-sync SSE robuste : re-fetch à la reconnexion du flux et au retour visible sur la page
  const cjsCommon = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
  check('front: SSE re-sync au retour sur la page (visibilitychange) et à la reconnexion (open)', cjsCommon.includes('visibilitychange') && cjsCommon.includes("addEventListener('open'") && cjsCommon.includes('!document.hidden'), '');
  const styCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  check('front: styles poster accueil (or/sombre + boule 8 filigrane)', styCss.includes('.poster-eyebrow') && styCss.includes('.poster-bar') && styCss.includes('.poster-ball-num'), '');
  nf_r = await del('/api/compte/amis/' + nf_sebId, { pin: null, useCookie: true });
  nf_r = await del('/api/compte/amis-pseudo/' + nf_ghostId, { pin: null, useCookie: true });
  nf_r = await api('/api/compte/amis', { pin: null, useCookie: true });
  check('retrait suivi pseudo', nf_r.data.amis.length === 0, nf_r.status);
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
  nf_r = await api(`/api/match/${nf_m.id}/retirer`, { method: 'POST', pin: null, body: { joueur_id: nf_m.joueur2.id } });
  nf_mm = (await api('/api/etat')).data.actif.matchs.find(x => x.id === nf_m.id);
  check('retirer une manche -> ⚪ casseur revient à l\'état précédent', nf_r.status === 200 && nf_mm.casseur && nf_mm.casseur.id === nf_m.joueur1.id, JSON.stringify(nf_mm.casseur));

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
  nf_r = await put(`/api/admin/joueur/${nf_j0.id}`, { pseudo: 'AliceBT' });
  check('PUT pseudo d\'un compte (sans joueur homonyme) -> 409 (réservé)', nf_r.status === 409 && nf_r.data.compte_pseudo === true, nf_r.status + ' ' + (nf_r.data.error || ''));
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


  // ---------- 16. Rôles: session compte admin (role) vs fallback PIN ----------
  sec('16. Rôles: compte admin = session suffit (requireAdmin + confirm_pin), PIN sinon');
  const login = async (pseudo, password) => {
    const rr2 = await fetch(BASE + '/api/compte/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pseudo, password }) });
    const sc = rr2.headers.get('set-cookie');
    return { status: rr2.status, cookie: sc ? sc.split(';')[0] : '' };
  };
  const apiC = (p, cookie, opts = {}) => fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opts.pin ? { 'X-Admin-Pin': opts.pin } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async r2 => ({ status: r2.status, data: await r2.json().catch(() => ({})) }));
  // compte user (Seb, créé section 4, mdp 'nouveau1' après le test réinit): session user -> PAS admin
  const lSeb = await login('Seb', 'nouveau1');
  check('login Seb (user) -> 200 + cookie', lSeb.status === 200 && !!lSeb.cookie, lSeb.status);
  r = await apiC('/api/admin/audit', lSeb.cookie);
  check('session user sans PIN -> 401 sur /api/admin/*', r.status === 401, r.status);
  // promouvoir AliceBT (créée section NF, mdp '1234') en admin via PIN
  const listeComptes = (await api('/api/admin/comptes')).data.comptes;
  const aliceC = listeComptes.find(c => c.pseudo === 'AliceBT');
  check('compte AliceBT retrouvé (role=user)', !!aliceC && (aliceC.role === 'user' || !aliceC.role), JSON.stringify(aliceC && aliceC.role));
  const lAlice0 = await login('AliceBT', '1234');
  r = await apiC('/api/admin/audit', lAlice0.cookie);
  check('session AliceBT (role=user) -> 401', r.status === 401, r.status);
  r = await post(`/api/admin/compte/${aliceC.id}/role`, { role: 'admin' });
  check('POST role=admin (PIN) -> 200', r.status === 200 && r.data.role === 'admin', r.status + ' ' + (r.data.error || ''));
  r = await post(`/api/admin/compte/${aliceC.id}/role`, { role: 'superadmin' });
  check('role invalide -> 400', r.status === 400, r.status);
  const lBoss = await login('AliceBT', '1234');
  r = await apiC('/api/admin/audit', lBoss.cookie);
  check('session AliceBT (role=admin) sans PIN -> 200', r.status === 200, r.status + ' ' + JSON.stringify(r.data).slice(0, 60));
  // action destructive: session admin -> PAS de confirm_pin nécessaire
  r = await post('/api/admin/tournoi', { nom: 'RoleT', regle: 'blackball', taille: 16, format: 'simple', notif_push: false });
  check('création RoleT (PIN)', r.status === 200, r.status);
  r = await apiC('/api/admin/tournoi', lBoss.cookie, { method: 'DELETE', body: {} });
  check('DELETE tournoi avec session admin, SANS confirm_pin -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  // sans session admin: PIN seul ne suffit plus pour une action destructive -> confirm_pin requis
  r = await post('/api/admin/tournoi', { nom: 'RoleT2', regle: 'blackball', taille: 16, format: 'simple', notif_push: false });
  r = await api('/api/admin/tournoi', { method: 'DELETE', body: {} }); // header PIN mais pas de confirm_pin
  check('DELETE tournoi avec PIN seul (pas de confirm_pin, pas de session admin) -> 401', r.status === 401, r.status);
  // session user + confirm_pin mais SANS PIN -> 401 (requireAdmin exige PIN ou session admin)
  r = await apiC('/api/admin/tournoi', lSeb.cookie, { method: 'DELETE', body: { confirm_pin: PIN } });
  check('session user + confirm_pin sans PIN -> 401 (PIN ou session admin requis)', r.status === 401, r.status);
  // session user + PIN + confirm_pin correct -> 200
  r = await apiC('/api/admin/tournoi', lSeb.cookie, { method: 'DELETE', body: { confirm_pin: PIN }, pin: PIN });
  check('DELETE tournoi avec PIN + confirm_pin correct -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  const acjs16 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-common.js'), 'utf8');
  check('front: modale confirmation par mot court (SUPPRIMER) pour session admin sur actions destructives', acjs16.includes('demanderConfirmationTexte') && acjs16.includes("MOT_CONFIRMATION = 'SUPPRIMER'"), '');
  await del('/api/admin/tournoi').catch(() => {});

  // ---------- 17. Multi-club: req.club (X-Club/?club=), backfill, isolation ----------
  sec('17. Multi-club: club par défaut, création club, isolation par X-Club/?club=');
  r = await api('/api/clubs', { pin: null });
  check('GET /api/clubs -> club par défaut ebpc', r.status === 200 && r.data.clubs.some(c => c.slug === 'ebpc'), JSON.stringify(r.data.clubs));
  r = await api('/api/etat', { pin: null });
  check('etat expose le club courant', r.status === 200 && r.data.club && r.data.club.slug === 'ebpc', JSON.stringify(r.data.club));
  r = await post('/api/admin/tournoi', { nom: 'ClubA', regle: 'blackball', taille: 16, format: 'simple', notif_push: false });
  check('création tournoi ClubA (club défaut)', r.status === 200, r.status + ' ' + (r.data.error || ''));
  const idA = r.data.actif && r.data.actif.tournoi.id;
  check('tournoi ClubA rattaché au club par défaut (club_id=1)', r.data.actif && r.data.actif.tournoi.club_id === 1, String(r.data.actif && r.data.actif.tournoi.club_id));
  r = await post('/api/admin/club', { slug: 'clubb', nom: 'Club B' });
  check('POST /api/admin/club clubb -> 200', r.status === 200 && r.data.club && r.data.club.slug === 'clubb', r.status + ' ' + (r.data.error || ''));
  const clubBId = r.data.club && r.data.club.id;
  r = await post('/api/admin/club', { slug: 'clubb', nom: 'X' });
  check('club slug doublon -> 409', r.status === 409, r.status);
  r = await post('/api/admin/club', { slug: '!!', nom: 'X' });
  check('club slug invalide -> 400', r.status === 400, r.status);
  r = await api('/api/etat', { pin: null, club: 'inconnu' });
  check('club inconnu (X-Club) -> 404', r.status === 404, r.status);
  r = await api('/api/etat?club=inconnu2', { pin: null });
  check('club inconnu (?club=) -> 404', r.status === 404, r.status);
  r = await post('/api/admin/tournoi', { nom: 'ClubB-T', regle: 'blackball', taille: 16, format: 'simple', notif_push: false }, { club: 'clubb' });
  check('création tournoi ClubB-T dans clubb (X-Club)', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/etat', { pin: null, club: 'clubb' });
  check('etat clubb: actif = ClubB-T, club.slug=clubb', !!(r.data.actif && r.data.actif.tournoi.nom === 'ClubB-T' && r.data.club.slug === 'clubb'), JSON.stringify(r.data.club));
  r = await api('/api/etat', { pin: null });
  check('etat club défaut: actif reste ClubA (pas ClubB-T)', !!(r.data.actif && r.data.actif.tournoi.nom === 'ClubA'), r.data.actif && r.data.actif.tournoi.nom);
  r = await api(`/api/tournois/${idA}`, { pin: null, club: 'clubb' });
  check('tournoi du club A invisible depuis clubb -> 404', r.status === 404, r.status);
  r = await api(`/api/admin/tournoi/${idA}`, { method: 'DELETE', club: 'clubb', body: { confirm_pin: PIN } });
  check('suppression tournoi club A depuis clubb -> 404', r.status === 404, r.status);
  r = await api(`/api/tournois/${idA}`, { pin: null });
  check('tournoi A existe toujours après la tentative cross-club', r.status === 200, r.status);
  // isolation sur un match: tirage dans ClubA, puis events du match vus depuis clubb
  await post('/api/admin/joueurs/simulation', { count: 16, prefix: 'A' });
  r = await post('/api/admin/tirage', {});
  check('tirage ClubA', r.status === 200, r.status);
  const mA = (await api('/api/etat')).data.actif.matchs.find(m => m.joueur1 && m.joueur2);
  r = await api(`/api/admin/match/${mA.id}/events`);
  check('events match A depuis club défaut -> 200', r.status === 200, r.status);
  r = await api(`/api/admin/match/${mA.id}/events`, { club: 'clubb' });
  check('events match A depuis clubb -> 404 (isolation)', r.status === 404, r.status);
  r = await api(`/api/match/${mA.id}/manche`, { method: 'POST', pin: null, club: 'clubb', body: { joueur_id: mA.joueur1.id } });
  check('saisie manche match A depuis clubb -> 404 (isolation)', r.status === 404, r.status);
  // isolation des JOUEURS entre clubs: un homonyme inscrit dans clubb ne doit voir
  // ni les matchs, ni l historique, ni le face-à-face du joueur du même pseudo du club par défaut
  r = await post('/api/admin/joueur', { pseudo: mA.joueur1.pseudo }, { club: 'clubb' });
  check('homonyme du joueur A inscrit dans clubb (ClubB-T) -> 200 (+id)', r.status === 200 && !!r.data.id, r.status + ' ' + (r.data.error || ''));
  const idHomoB = r.data && r.data.id;
  await jouerMatch(mA, mA.joueur1.id); // le joueur du club par défaut a désormais un match joué (et gagné)
  r = await api(`/api/joueur/${idHomoB}/stats`, { pin: null, club: 'clubb' });
  check('fiche de l homonyme vue depuis clubb: 0 match joué (le club par défaut ne fuit pas)', r.status === 200 && r.data.joues === 0, JSON.stringify(r.data.joues != null ? { j: r.data.joues } : r.data));
  r = await api(`/api/joueur/${idHomoB}/matchs`, { pin: null, club: 'clubb' });
  check('matchs de l homonyme depuis clubb: aucune ligne du club par défaut', r.status === 200 && r.data.matchs.length === 0, 'nb=' + (r.data.matchs || []).length);
  r = await api(`/api/joueur/${idHomoB}/historique`, { pin: null, club: 'clubb' });
  check('historique de l homonyme depuis clubb: vide, face-à-face vide aussi', r.status === 200 && r.data.historique.length === 0 && r.data.h2h.length === 0, 'h=' + (r.data.historique || []).length + ' h2h=' + (r.data.h2h || []).length);
  r = await api(`/api/joueur/${mA.joueur1.id}/stats`, { pin: null });
  check('fiche du joueur du club par défaut: son match ClubA reste compté (1 joué / 1 gagné)', r.status === 200 && r.data.joues === 1 && r.data.gagnes === 1, JSON.stringify({ j: r.data.joues, g: r.data.gagnes }));
  // audit scopé par club
  r = await api('/api/admin/audit', { club: 'clubb' });
  check('audit clubb: toutes les entrées appartiennent à clubb', r.data.audit.length > 0 && r.data.audit.every(a => a.club_id === clubBId), 'nb=' + r.data.audit.length);
  r = await api('/api/admin/audit', {});
  check('audit club défaut: toutes les entrées club_id=1', r.data.audit.every(a => a.club_id === 1), 'nb=' + r.data.audit.length);
  // nettoyage
  await del('/api/admin/tournoi', { club: 'clubb' }).catch(() => {});
  await del('/api/admin/tournoi').catch(() => {});

  // ---------- 17b. Multi-club: PIN par club, réglages (nom/pin/actif), garde super-admin ----------
  sec('17b. Multi-club: PIN par club + réglages du club + garde super-admin');
  r = await post('/api/admin/club', { slug: 'clubc', nom: 'Club C', pin: '1357' }, { pin: PIN });
  check('clubc créé avec son PIN propre -> 200', r.status === 200 && r.data.club && r.data.club.slug === 'clubc', r.status + ' ' + (r.data.error || ''));
  const clubCId = r.data.club && r.data.club.id;
  r = await post('/api/admin/tournoi', { nom: 'ClubC-T', regle: 'blackball', taille: 16, format: 'simple', notif_push: false }, { club: 'clubc', pin: '1357' });
  const rC = await api('/api/etat', { pin: null, club: 'clubc' });
  check('tournoi ClubC-T créé dans clubc via son PIN seul, club bien clubc', r.status === 200 && rC.data.actif && rC.data.actif.tournoi.nom === 'ClubC-T' && rC.data.club.id === clubCId, r.status + ' ' + (rC.data.club && rC.data.club.slug));
  r = await api('/api/admin/audit', { pin: '1357' });
  check('PIN de clubc refusé sur le club par défaut -> 401', r.status === 401, r.status);
  r = await api('/api/admin/audit', { pin: PIN, club: 'clubc' });
  check('PIN global ouvre les routes admin de clubc (super-admin) -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await put('/api/admin/club', { nom: 'Club C2' }, { club: 'clubc', pin: '1357' });
  check('PUT club: renommage par l admin du club, sans re-confirmation -> 200', r.status === 200 && r.data.club && r.data.club.nom === 'Club C2', r.status + ' ' + (r.data.error || ''));
  r = await put('/api/admin/club', { pin: '12' }, { club: 'clubc', pin: '1357' });
  check('PUT club: pin trop court -> 400', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await put('/api/admin/club', { pin: '2468' }, { club: 'clubc', pin: '1357' });
  check('PUT club: nouveau PIN sans confirm_pin -> 401', r.status === 401, r.status);
  r = await put('/api/admin/club', { pin: '2468', confirm_pin: '1357' }, { club: 'clubc', pin: '1357' });
  check('PUT club: nouveau PIN confirmé par le code actuel -> 200 + pin_propre', r.status === 200 && r.data.club && r.data.club.pin_propre === true, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/audit', { pin: '2468', club: 'clubc' });
  check('le nouveau PIN de clubc ouvre les routes admin -> 200', r.status === 200, r.status);
  r = await api('/api/admin/audit', { pin: '1357', club: 'clubc' });
  check('ancien PIN de clubc révoqué -> 401', r.status === 401, r.status);
  r = await put('/api/admin/club', { slug: 'ebpc', nom: 'Pirate' }, { club: 'clubc', pin: '2468' });
  check('admin de clubc ne peut pas modifier le club par défaut -> 403', r.status === 403, r.status + ' ' + (r.data.error || ''));
  r = await put('/api/admin/club', { slug: 'clubc', pin: '9753', actif: false, confirm_pin: PIN });
  check('super-admin (code global): change le PIN et désactive clubc à distance -> 200', r.status === 200 && r.data.club && r.data.club.actif === false && r.data.club.pin_propre === true, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/clubs', { pin: null });
  check('club désactivé absent de la liste publique des clubs actifs', r.status === 200 && !r.data.clubs.some(c => c.slug === 'clubc'), JSON.stringify(r.data.clubs.map(c => c.slug)));
  r = await api('/api/etat', { pin: null, club: 'clubc' });
  check('club désactivé -> 404 à la résolution (X-Club)', r.status === 404, r.status);
  r = await put('/api/admin/club', { slug: 'clubc', actif: true, confirm_pin: PIN });
  check('réactivation de clubc à distance par le super-admin -> 200', r.status === 200 && r.data.club && r.data.club.actif === true, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/clubs', { pin: null });
  check('clubc de retour dans la liste publique des clubs actifs', r.data.clubs.some(c => c.slug === 'clubc'), JSON.stringify(r.data.clubs.map(c => c.slug)));
  r = await api('/api/admin/clubs', {});
  check('GET /api/admin/clubs: clubc pin_propre+actif, défaut pin_propre=false', r.status === 200 && r.data.clubs.some(c => c.slug === 'clubc' && c.pin_propre === true && c.actif === true) && r.data.clubs.some(c => c.slug === 'ebpc' && c.pin_propre === false), JSON.stringify(r.data.clubs));
  r = await put('/api/admin/club', { actif: false, confirm_pin: PIN });
  check('le club par défaut ne peut pas être désactivé -> 400', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await put('/api/admin/club', { slug: 'zzzz', nom: 'X' });
  check('PUT club slug inconnu -> 404', r.status === 404, r.status);
  r = await api('/api/admin/audit', {});
  check('audit (club défaut): club_cree et club_modifie journalisés', r.data.audit.some(a => a.action === 'club_cree') && r.data.audit.some(a => a.action === 'club_modifie'), 'nb=' + r.data.audit.length);
  await del('/api/admin/tournoi', { club: 'clubc' }).catch(() => {});

  // ---------- 17c. Multi-club: rôles des comptes sur un club (compte_club: admin / operateur) ----------
  sec('17c. Multi-club: rôles des comptes par club (admin de club / operateur)');
  // N.B. pas de nouvelle inscription ici: le rate limit /api/compte/inscription (5 essais/10min/IP) est déjà consommé par les sections précédentes.
  // On réutilise le compte Seb (role=user, mdp nouveau1), le rôle club lui est retiré à la fin.
  const cookieAvant17c = cookie;
  // appels avec le cookie précis d'une session (pas la variable globale partagée)
  const xhrC = (p, cookieX, opts = {}) => fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(cookieX ? { Cookie: cookieX } : {}), ...(opts.club ? { 'X-Club': opts.club } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async r2 => ({ status: r2.status, data: await r2.json().catch(() => ({})) }));
  const lSeb17c = await login('Seb', 'nouveau1');
  check('login Seb (17c): session fraîche -> 200 + cookie', lSeb17c.status === 200 && !!lSeb17c.cookie, lSeb17c.status);
  // super-admin attribue le rôle admin de clubc à Seb
  r = await put('/api/admin/club/compte', { pseudo: 'Seb', role: 'admin' }, { pin: PIN, club: 'clubc' });
  check('attribution du rôle admin de clubc à Seb par le code global -> 200', r.status === 200 && r.data.role === 'admin', r.status + ' ' + (r.data.error || ''));
  const sebId17c = r.data ? r.data.compte_id : undefined;
  r = await put('/api/admin/club/compte', { pseudo: 'Seb', role: 'chef' }, { pin: PIN, club: 'clubc' });
  check('rôle inconnu (chef) -> 400', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/club/comptes', { pin: PIN, club: 'clubc' });
  check('GET rôles du club: Seb listé admin (pseudo + role, jamais de hash)', r.status === 200 && r.data.comptes.some(c => c.pseudo === 'Seb' && c.role === 'admin'), JSON.stringify(r.data.comptes));
  // la session de Seb = admin de clubc, SANS aucun code PIN
  r = await xhrC('/api/admin/audit', lSeb17c.cookie, { club: 'clubc' });
  check('session Seb (admin de clubc) ouvre les routes admin de clubc sans PIN -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await xhrC('/api/admin/audit', lSeb17c.cookie);
  check('session Seb sans rôle sur le club par défaut -> 401', r.status === 401, r.status);
  r = await xhrC('/api/admin/tournoi', lSeb17c.cookie, { method: 'POST', club: 'clubc', body: { nom: 'ClubC-T2', regle: 'blackball', taille: 16, format: 'simple', notif_push: false } });
  check('Seb crée un tournoi dans clubc par sa session (session_club) -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await xhrC('/api/admin/club', lSeb17c.cookie, { method: 'PUT', club: 'clubc', body: { nom: 'Club C4' } });
  check('Seb renomme clubc par session, sans confirm_pin -> 200', r.status === 200 && r.data.club && r.data.club.nom === 'Club C4', r.status + ' ' + (r.data.error || ''));
  r = await xhrC('/api/admin/club', lSeb17c.cookie, { method: 'PUT', club: 'clubc', body: { pin: '2468' } });
  check('Seb (admin de club) change le PIN de clubc sans confirm_pin -> 200', r.status === 200 && r.data.club && r.data.club.pin_propre === true, r.status + ' ' + (r.data.error || ''));
  r = await xhrC('/api/admin/club', lSeb17c.cookie, { method: 'PUT', club: 'clubc', body: { slug: 'ebpc', nom: 'Pirate' } });
  check('Seb ne peut pas modifier le club par défaut (garde super-admin) -> 403', r.status === 403, r.status + ' ' + (r.data.error || ''));
  // cloisonnement de la gestion des comptes: une session de club ne voit et ne gère que les comptes
  // de SON club; le rôle global (user/admin) est un réglage super-admin
  const cidAlice17c = (await api('/api/admin/comptes', {})).data.comptes.find(c => c.pseudo === 'AliceBT');
  r = await xhrC('/api/admin/comptes', lSeb17c.cookie, { club: 'clubc' });
  check('admin de club: liste des comptes limitée à son club (Seb présent, AliceBT absente)', r.status === 200 && !!r.data.comptes.some(c => c.pseudo === 'Seb') && !r.data.comptes.some(c => c.pseudo === 'AliceBT'), 'n=' + r.data.comptes.length + ' ' + JSON.stringify(r.data.comptes.map(c => c.pseudo)));
  r = await xhrC(`/api/admin/compte/${cidAlice17c.id}/role`, lSeb17c.cookie, { method: 'POST', club: 'clubc', body: { role: 'admin' } });
  check('admin de club: promotion au rôle GLOBAL refusée (super-admin uniquement) -> 403', r.status === 403, r.status + ' ' + (r.data.error || ''));
  r = await xhrC(`/api/admin/compte/${cidAlice17c.id}/pseudo`, lSeb17c.cookie, { method: 'POST', club: 'clubc', body: { pseudo: 'Pirate17c' } });
  check('admin de club: renommage d un compte hors de son club -> 404', r.status === 404, r.status + ' ' + (r.data.error || ''));
  r = await xhrC(`/api/admin/compte/${cidAlice17c.id}/password`, lSeb17c.cookie, { method: 'POST', club: 'clubc', body: { password: 'hijack1' } });
  check('admin de club: reset du mot de passe d un compte hors de son club -> 404', r.status === 404, r.status + ' ' + (r.data.error || ''));
  r = await xhrC(`/api/admin/compte/${cidAlice17c.id}`, lSeb17c.cookie, { method: 'DELETE', club: 'clubc' });
  check('admin de club: suppression d un compte hors de son club -> 404', r.status === 404, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/comptes', {});
  check('super-admin dans le club par défaut: SES comptes visibles (AliceBT et Seb), la liste reste scopée au club du contexte (17h)', r.status === 200 && !!r.data.comptes.some(c => c.pseudo === 'AliceBT') && !!r.data.comptes.some(c => c.pseudo === 'Seb'), 'n=' + r.data.comptes.length);
  // gestion des clubs (liste complète, création) = super-admin uniquement: refus pour un compte de club
  r = await xhrC('/api/admin/clubs', lSeb17c.cookie, { club: 'clubc' });
  check('admin de club: liste des clubs interdite (super-admin uniquement) -> 403', r.status === 403, r.status + ' ' + (r.data.error || ''));
  r = await xhrC('/api/admin/club', lSeb17c.cookie, { method: 'POST', club: 'clubc', body: { slug: 'pirate17', nom: 'Club Pirate' } });
  check('admin de club: création d un club interdite -> 403', r.status === 403, r.status + ' ' + (r.data.error || ''));
  r = await xhrC('/api/admin/super', lSeb17c.cookie, { club: 'clubc' });
  check('GET /api/admin/super: session de club -> super_admin false (menu Clubs masqué)', r.status === 200 && r.data.super_admin === false, r.status + ' ' + JSON.stringify(r.data));
  r = await api('/api/admin/super', { pin: PIN });
  check('GET /api/admin/super: code global -> super_admin true', r.status === 200 && r.data.super_admin === true, r.status + ' ' + JSON.stringify(r.data));
  r = await api('/api/admin/super', { club: 'clubc', pin: '2468' });
  check('GET /api/admin/super: code PIN du club -> super_admin false', r.status === 200 && r.data.super_admin === false, r.status + ' ' + JSON.stringify(r.data));
  // downgrade en operateur: routes ouvertes, mais confirmations destructives et gestion des rôles refusées
  r = await put('/api/admin/club/compte', { pseudo: 'Seb', role: 'operateur' }, { pin: PIN, club: 'clubc' });
  check('downgrade de Seb en operateur de clubc -> 200', r.status === 200 && r.data.role === 'operateur', r.status + ' ' + (r.data.error || ''));
  r = await xhrC('/api/admin/audit', lSeb17c.cookie, { club: 'clubc' });
  check('session operateur ouvre toujours les routes admin de clubc -> 200', r.status === 200, r.status);
  r = await xhrC('/api/admin/tournoi', lSeb17c.cookie, { method: 'DELETE', club: 'clubc' });
  check('operateur: suppression du tournoi refusée sans code (confirm non levée) -> 401', r.status === 401, r.status + ' ' + (r.data.error || ''));
  r = await xhrC('/api/admin/club/comptes', lSeb17c.cookie, { club: 'clubc' });
  check('operateur: gestion des rôles du club interdite -> 403', r.status === 403, r.status + ' ' + (r.data.error || ''));
  // retrait du rôle par le super-admin, puis session révoquée
  r = await api('/api/admin/club/compte', { method: 'DELETE', pin: PIN, club: 'clubc', body: { compte_id: sebId17c, confirm_pin: PIN } });
  check('retrait du rôle de Seb (super-admin + confirm_pin) -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await xhrC('/api/admin/audit', lSeb17c.cookie, { club: 'clubc' });
  check('session Seb révoquée: plus aucune route admin de clubc -> 401', r.status === 401, r.status);
  r = await api('/api/admin/clubs', {});
  check('(admin) liste des clubs: nb_comptes retombe à 0 pour clubc après le retrait', r.status === 200 && r.data.clubs.some(c => c.slug === 'clubc' && c.nb_comptes === 0), JSON.stringify(r.data.clubs.map(c => c.slug + ':' + (c.nb_comptes || 0))));
  r = await api('/api/admin/audit', { pin: PIN, club: 'clubc' });
  check('audit de clubc: club_role et club_role_retire journalisés', r.data.audit.some(a => a.action === 'club_role') && r.data.audit.some(a => a.action === 'club_role_retire'), 'nb=' + r.data.audit.length);
  const consHtml17c = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.html'), 'utf8');
  const admHtml17c = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const admCpt17c = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-comptes.html'), 'utf8');
  check('front: console super-admin (création, réglages club par slug cible, X-Club par appel, table-wrap, rôles admin/operateur) + lien Console depuis l accueil admin (17i)', consHtml17c.includes("clubApi('/api/admin/club/comptes', slug") && consHtml17c.includes("'/api/super/club', { method: 'PUT', body: JSON.stringify({ slug: c.slug") && consHtml17c.includes('table-wrap') && admHtml17c.includes("href: '/console.html'"), '');
  check('front: menu Console réservé au super-admin (/api/admin/super conditionne le bouton, console affiche un message si 403)', admHtml17c.includes("/api/admin/super") && admHtml17c.includes("superAdminMenu ? [") && consHtml17c.includes('Console réservée au super-admin de la plateforme'), '');
  check('front: bouton 👑 (rôle global) masqué aux sessions de club sur la page Comptes joueurs', admCpt17c.includes("/api/admin/super") && admCpt17c.includes("superAdminComptes ? ["), '');
  // suppression d un club: super-admin uniquement, défaut protégé, refus si des tournois sont rattachés
  r = await api('/api/admin/club', { method: 'DELETE', pin: PIN, club: 'clubc', body: { slug: 'clubc', confirm_pin: PIN } });
  check('suppression clubc refusée: un tournoi est encore rattaché -> 409', r.status === 409, r.status + ' ' + (r.data.error || ''));
  await del('/api/admin/tournoi', { club: 'clubc' }).catch(() => {});
  r = await api('/api/admin/club', { method: 'DELETE', pin: PIN, club: 'clubc', body: { slug: 'clubc' } });
  check('suppression clubc sans confirm_pin -> 401', r.status === 401, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/club', { method: 'DELETE', pin: PIN, body: { slug: 'ebpc', confirm_pin: PIN } });
  check('le club par défaut ne peut pas être supprimé -> 400', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/club', { method: 'DELETE', pin: PIN, body: { slug: 'zzzz', confirm_pin: PIN } });
  check('suppression d un club inconnu -> 404', r.status === 404, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/club', { method: 'DELETE', pin: PIN, club: 'clubc', body: { slug: 'clubc', confirm_pin: PIN } });
  check('suppression du clubc par le super-admin (confirm_pin) -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/clubs', {});
  check('clubc absent de la liste des clubs après suppression', r.status === 200 && !r.data.clubs.some(c => c.slug === 'clubc'), JSON.stringify(r.data.clubs.map(c => c.slug)));
  r = await put('/api/admin/club/compte', { pseudo: 'Seb', role: 'admin' }, { pin: PIN, club: 'clubb' });
  check('rôle admin de Seb sur clubb (la suppression du club devra purger ce rattachement)', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/club', { method: 'DELETE', pin: PIN, club: 'clubb', body: { slug: 'clubb', confirm_pin: PIN } });
  check('suppression de clubb avec un compte rattaché -> 200 (rôles purgés)', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/clubs', {});
  check('clubb absent de la liste des clubs après suppression', r.status === 200 && !r.data.clubs.some(c => c.slug === 'clubb'), JSON.stringify(r.data.clubs.map(c => c.slug)));
  r = await api('/api/admin/audit', { pin: PIN });
  check('audit: club_supprime journalisé (clubc et clubb)', r.data.audit.filter(a => a.action === 'club_supprime').length >= 2, 'nb=' + r.data.audit.length);
  check('front: bouton Supprimer sur chaque ligne sauf le club par défaut (confirmation destructive, routes super 17i)', consHtml17c.includes("adminApiDestructif('/api/super/club', { method: 'DELETE'") && consHtml17c.includes('rowClub(c, i === 0)'), '');
  cookie = cookieAvant17c; // restaurer la session du fil principal

  // ---------- 17d. Sauvegarde complète de la base (export/import JSON, réservé au code global) ----------
  sec('17d. Sauvegarde complète de la base (export/import JSON, réservé au code global)');
  r = await api('/api/admin/base/export');
  const E = r.data;
  check('export base: 200 + format complet (marqueur ebpc-tournoi-billard, genere_le, tables)', r.status === 200 && E && E.sauvegarde === 'ebpc-tournoi-billard' && !!E.genere_le && E.tables && typeof E.tables === 'object' && !Array.isArray(E.tables), r.status + ' ' + JSON.stringify(E && Object.keys(E)).slice(0, 120));
  check('export base: toutes les tables du schéma présentes (16, compte_club inclus)', ['settings', 'club', 'compte_club', 'tournoi', 'distance_round', 'joueur', 'compte', 'ami', 'ami_pseudo', 'session', 'push_subscription', 'table_billard', 'match', 'match_event', 'audit_log', 'audit_snapshot'].every(t => Array.isArray(E.tables && E.tables[t])), Object.keys((E && E.tables) || {}).join(','));
  check('export base: téléchargeable (Content-Disposition attachment)', /^attachment/.test(r.headers.get('content-disposition') || ''), r.headers.get('content-disposition') || 'absent');
  const attendu17d = E.tables.audit_log.filter(a => a.club_id === 1).length;
  check('export base: contenu non vide (clubs, tournois, joueurs, audit)', E.tables.club.length >= 1 && E.tables.tournoi.length >= 1 && E.tables.joueur.length >= 1 && E.tables.audit_log.length >= 1 && attendu17d >= 1, JSON.stringify({ club: E.tables.club.length, tournoi: E.tables.tournoi.length, joueur: E.tables.joueur.length, audit: E.tables.audit_log.length }));
  check('export base: fk_violations expose les orphelins hérités (clubs supprimés en 17c -> journal orphelin déclaré, clé fk_violations)', Array.isArray(E.fk_violations) && E.fk_violations.every(v => /^\w+#\d+->\w+$/.test(v)) && E.fk_violations.length >= 1, 'fk=' + (E.fk_violations || []).length);
  // casse volontairement la base (vidage du journal) puis restaure par l'import complet
  r = await del('/api/admin/audit');
  check('vidage du journal du club défaut (confirm_pin) -> 200, supprimées >= 1', r.status === 200 && r.data.ok === true && r.data.supprimes >= 1, r.status + ' ' + JSON.stringify(r.data));
  r = await api('/api/admin/audit');
  check('journal vidé: il ne reste que le log du vidage (audit_purge)', r.status === 200 && r.data.audit.length === 1 && r.data.audit[0].action === 'audit_purge', 'nb=' + r.data.audit.length);
  r = await post('/api/admin/base/import', { payload: E, confirm_pin: PIN });
  check('import base: 200 + ok (base restaurée)', r.status === 200 && r.data.ok === true, r.status + ' ' + (r.data.error || ''));
  const apres17d = (r.data && r.data.tables) || {};
  check('import base: chaque table retrouve exactement ses lignes (identique à l export)', Object.keys(E.tables).every(t => apres17d[t] === E.tables[t].length), JSON.stringify(Object.keys(E.tables).map(t => t + ':' + E.tables[t].length + '->' + (apres17d[t] !== undefined ? apres17d[t] : '?'))).slice(0, 240));
  r = await api('/api/clubs');
  const ebpc17d = r.data.clubs.find(c => c.slug === 'ebpc');
  check('import base: les ids sont préservés (club ebpc garde son id)', !!ebpc17d && ebpc17d.id === E.tables.club.find(c => c.slug === 'ebpc').id, JSON.stringify({ ebpc: ebpc17d && ebpc17d.id }));
  r = await api('/api/admin/audit');
  check('import base: journal du club défaut restauré (entrées de retour)', r.status === 200 && r.data.audit.length >= attendu17d, 'nb=' + r.data.audit.length + ' attendu>=' + attendu17d);
  // un code de CLUB administre son club: il n'a pas accès à la base entière (403)
  await post('/api/admin/club', { slug: 'clubsb', nom: 'Club SB', pin: '4321' });
  r = await api('/api/admin/base/export', { club: 'clubsb', pin: '4321' });
  check('export base avec un code de club -> 403 (réservé au super-admin)', r.status === 403, r.status + ' ' + (r.data.error || ''));
  r = await post('/api/admin/base/import', { payload: E, confirm_pin: '4321' }, { club: 'clubsb', pin: '4321' });
  check('import base avec un code de club -> 403 (aucune écriture)', r.status === 403, r.status + ' ' + (r.data.error || ''));
  r = await post('/api/admin/base/import', { payload: { format: 'poubelle' }, confirm_pin: PIN });
  check('import base: payload sans marqueur de sauvegarde -> 400 (aucune écriture)', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await post('/api/admin/base/import', { payload: { sauvegarde: 'ebpc-tournoi-billard', tables: { poubelle: [{ id: 1 }] } }, confirm_pin: PIN });
  check('import base: table inconnue -> 400 (aucune écriture)', r.status === 400, r.status + ' ' + (r.data.error || ''));
  // falsification: une référence cassée NON déclarée par l'export doit être refusée (400, aucun écritage)
  const E2 = JSON.parse(JSON.stringify(E));
  E2.tables.joueur.push({ id: 900001, tournoi_id: 999999, pseudo: 'OrphelinFx', statut: 'en_attente', created_at: '2026-01-01 00:00:00' });
  r = await post('/api/admin/base/import', { payload: E2, confirm_pin: PIN });
  check('import base: référence cassée NON déclarée -> 400 (falsification refusée, aucun écriture)', r.status === 400, r.status + ' ' + (r.data.error || ''));
  const consHtml17d = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.html'), 'utf8');
  check('front: panneau 💾 sauvegarde base dans la console super-admin (export téléchargeant, import fichier avec confirmation destructible, 17i)', consHtml17d.includes('/api/super/base/export') && consHtml17d.includes('/api/super/base/import') && consHtml17d.includes('Télécharger la sauvegarde (JSON)') && consHtml17d.includes('Restaurer depuis un fichier') && consHtml17d.includes('adminApiDestructif'), '');
  const spec17d = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  const ga17d = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_ADMIN.md'), 'utf8');
  const srv17d = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  check("doc: SPEC 17d + GUIDE_ADMIN dédié + serveur (requireSuperAdmin sur export/import, limite 25mb sur l'import UNIQUEMENT)", spec17d.includes('17d. Sauvegarde complète de la base') && spec17d.includes('494 checks') && ga17d.includes('Sauvegarde / restauration de la base') && srv17d.includes("app.use('/api/admin/base/import', express.json({ limit: '25mb' }))") && srv17d.includes("app.get('/api/admin/base/export', requireAdmin, requireSuperAdmin") && srv17d.includes("app.post('/api/admin/base/import', requireAdmin, requireConfirmPin, requireSuperAdmin"), '');

  // ---------- 17e. Sauvegarde des données du club (export/import ciblés: un code de club administre SON club) ----------
  sec('17e. Sauvegarde des données du club (export/import ciblés, code de club)');
  r = await api('/api/admin/base/export-club');
  const C = r.data;
  check('export club: 200 + format club (marqueur ebpc-tournoi-billard-club, club ebpc, genere_le, tables)', r.status === 200 && C && C.sauvegarde === 'ebpc-tournoi-billard-club' && C.club && C.club.slug === 'ebpc' && !!C.genere_le && C.tables && typeof C.tables === 'object' && !Array.isArray(C.tables), r.status + ' ' + JSON.stringify(C && Object.keys(C)).slice(0, 120));
  check('export club: périmètre club uniquement (8 tables de données, JAMAIS compte/session/email/club)', ['tournoi', 'distance_round', 'joueur', 'table_billard', 'match', 'match_event', 'audit_log', 'audit_snapshot'].every(t => Array.isArray(C.tables && C.tables[t])) && ['settings', 'club', 'compte_club', 'compte', 'ami', 'ami_pseudo', 'session', 'push_subscription'].every(t => !C.tables || C.tables[t] === undefined), Object.keys((C && C.tables) || {}).join(','));
  check('export club: téléchargeable (Content-Disposition attachment, nom club-ebpc…)', /^attachment/.test(r.headers.get('content-disposition') || '') && /club-ebpc/.test(r.headers.get('content-disposition') || ''), r.headers.get('content-disposition') || 'absent');
  const attendu17e = (C.tables.audit_log || []).length;
  check('export club: contenu du club uniquement (tournois/joueurs/matchs du club, aucune ligne d un autre club)', C.tables.tournoi.length >= 1 && C.tables.joueur.length >= 1 && C.tables.match.length >= 1 && attendu17e >= 1 && C.tables.tournoi.every(t => t.club_id === 1) && C.tables.audit_log.every(a => a.club_id === 1) && C.tables.match.every(m => C.tables.tournoi.some(t => t.id === m.tournoi_id)), JSON.stringify({ tournoi: C.tables.tournoi.length, joueur: C.tables.joueur.length, match: C.tables.match.length, audit: attendu17e }));
  // un code de CLUB administre SON club: l export ciblé marche avec SON code (PAS de 403 ici)
  r = await api('/api/admin/base/export-club', { club: 'clubsb', pin: '4321' });
  check('export club avec un code de club -> 200 (le club sauvegarde SES données: club clubsb vide)', r.status === 200 && r.data.club && r.data.club.slug === 'clubsb' && ['tournoi', 'joueur', 'match', 'audit_log'].every(t => Array.isArray(r.data.tables[t]) && r.data.tables[t].length === 0), r.status + ' ' + JSON.stringify(r.data.club || {}));
  r = await api('/api/admin/base/export-club', { pin: null });
  check('export club sans code admin -> 401', r.status === 401, r.status + ' ' + (r.data.error || ''));
  // casse volontairement les données du club (vidage du journal) puis restaure par l import ciblé du club
  r = await del('/api/admin/audit');
  check('vidage du journal du club (confirm_pin) -> 200, supprimées >= 1', r.status === 200 && r.data.supprimes >= 1, r.status + ' ' + JSON.stringify(r.data));
  r = await post('/api/admin/base/import-club', { payload: C, confirm_pin: PIN });
  check('import club: 200 + ok (données du club restaurées)', r.status === 200 && r.data.ok === true, r.status + ' ' + (r.data.error || ''));
  const apres17e = (r.data && r.data.tables) || {};
  check('import club: chaque table du club retrouve exactement ses lignes (identique à l export)', Object.keys(C.tables).every(t => apres17e[t] === C.tables[t].length), JSON.stringify(Object.keys(C.tables).map(t => t + ':' + C.tables[t].length + '->' + (apres17e[t] !== undefined ? apres17e[t] : '?'))).slice(0, 200));
  r = await api('/api/tournois');
  check('import club: ids préservés (le 1er tournoi du club garde son id)', C.tables.tournoi.length >= 1 && (r.data.tournois || []).some(x => x.id === C.tables.tournoi[0].id), 'id 1er tournoi=' + (C.tables.tournoi[0] && C.tables.tournoi[0].id));
  r = await api('/api/admin/audit');
  check('import club: journal du club restauré (entrées de retour)', r.status === 200 && r.data.audit.length >= attendu17e, 'nb=' + r.data.audit.length + ' attendu>=' + attendu17e);
  r = await api('/api/etat');
  check('import club: état du club cohérent après restauration (actif null ou tableau de matchs)', r.status === 200 && (r.data.actif === null || Array.isArray(r.data.actif.matchs)), r.status);
  // sécurité: la restauration d un club ne doit JAMAIS toucher aux autres
  r = await post('/api/admin/base/import-club', { payload: C }, { club: 'clubsb', pin: '4321' });
  check('import club sans confirm_pin (code de club) -> 401 (confirmation destructive exigée)', r.status === 401, r.status + ' ' + (r.data.error || ''));
  r = await post('/api/admin/base/import-club', { payload: C, confirm_pin: '4321' }, { club: 'clubsb', pin: '4321' });
  check('import club: sauvegarde d un AUTRE club -> 400 (clubsb ne peut pas importer le fichier d ebpc)', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await post('/api/admin/base/import-club', { payload: { format: 'poubelle' }, confirm_pin: PIN });
  check('import club: marqueur de sauvegarde absent -> 400 (aucune écriture)', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await post('/api/admin/base/import-club', { payload: { sauvegarde: 'ebpc-tournoi-billard-club', club: { id: 1, slug: 'ebpc', nom: 'EBPC' }, tables: { compte: [{ id: 1 }] } }, confirm_pin: PIN });
  check('import club: table hors périmètre club (compte) -> 400 (emails/mots de passe jamais importables par un club)', r.status === 400, r.status + ' ' + (r.data.error || ''));
  const C2 = JSON.parse(JSON.stringify(C));
  C2.tables.tournoi.push({ id: 900001, club_id: 999, nom: 'Vol', regle: 'blackball', taille: 8, format: 'simple', dko_tours: 0, tetes_de_serie: 0, nb_tables: 4, ajustement_auto: 1, seuil_distance: 'jamais', distance_speciale: 3, statut: 'inscription', created_at: '2026-01-01 00:00:00' });
  r = await post('/api/admin/base/import-club', { payload: C2, confirm_pin: PIN });
  check('import club: ligne d un autre club (tournoi club_id 999) -> 400 (aucune écriture)', r.status === 400, r.status + ' ' + (r.data.error || ''));
  const C3 = JSON.parse(JSON.stringify(C));
  C3.tables.match_event.push({ id: 900002, match_id: 999999, joueur_id: null, type: 'manche', detail: null, created_at: '2026-01-01 00:00:00' });
  r = await post('/api/admin/base/import-club', { payload: C3, confirm_pin: PIN });
  check('import club: référence interne cassée (match_event.match_id 999999) -> 400 (falsification refusée)', r.status === 400, r.status + ' ' + (r.data.error || ''));
  const adH17e = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-data.html'), 'utf8');
  check('front: panneau 💾 données du club dans admin-data.html (export club téléchargeant + import fichier avec confirmation destructible)', adH17e.includes('/api/admin/base/export-club') && adH17e.includes('/api/admin/base/import-club') && adH17e.includes('Télécharger la sauvegarde du club') && adH17e.includes('adminApiDestructif'), '');
  const spec17e = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  const ga17e = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_ADMIN.md'), 'utf8');
  const srv17e = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  check('doc: SPEC 17e + GUIDE_ADMIN club + serveur (export-club/import-club SANS requireSuperAdmin: un code de club sauvegarde/restaure SON club, limite 25mb)', spec17e.includes('17e. Sauvegarde des données du club') && spec17e.includes('494 checks') && ga17e.includes('Données du club : sauvegarde / restauration') && srv17e.includes("app.get('/api/admin/base/export-club', requireAdmin") && srv17e.includes("app.post('/api/admin/base/import-club', requireAdmin, requireConfirmPin") && srv17e.includes("app.use('/api/admin/base/import-club', express.json({ limit: '25mb' }))"), '');

  // ---------- 17f. Comptes cloisonnés par club (isolation stricte: pseudo et email PAR club) ----------
  sec('17f. Comptes cloisonnés par club (pseudo et email par club, creation seule lie le club)');
  r = await post('/api/admin/club', { slug: 'clubvm', nom: 'Club VM', pin: '5678' });
  check('clubvm créé avec son PIN (2e club avec PIN pour tester l isolation des comptes)', r.status === 200 && r.data.club && r.data.club.slug === 'clubvm', r.status + ' ' + (r.data.error || ''));
  const xhr17f = (p17f, xff, opts = {}) => fetch(BASE + p17f, {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff, ...(opts.club ? { 'X-Club': opts.club } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async r17 => ({ status: r17.status, data: await r17.json().catch(() => ({})), cookie: r17.headers.get('set-cookie') }));
  let r17f = await xhr17f('/api/compte/inscription', '203.0.113.101', { club: 'clubsb', body: { pseudo: 'MembreSb', email: 'membre.sb@clubsb.test', password: '1234' } });
  check('compte créé DEPUIS le contexte du club clubsb -> 201 (lié au club au moment de la création)', r17f.status === 201 && r17f.data.compte && r17f.data.compte.pseudo === 'MembreSb', r17f.status + ' ' + (r17f.data.error || ''));
  r = await api('/api/admin/comptes', { club: 'clubsb', pin: '4321' });
  check('le compte est VISIBLE dans la liste des comptes de SON club (table de marque, code PIN du club)', r.status === 200 && r.data.comptes.some(c => c.pseudo === 'MembreSb'), 'n=' + r.data.comptes.length);
  r = await api('/api/admin/comptes', { club: 'clubvm', pin: '5678' });
  check('le compte est INVISIBLE dans la liste d un autre club (code PIN de clubvm)', r.status === 200 && !r.data.comptes.some(c => c.pseudo === 'MembreSb'), 'n=' + r.data.comptes.length);
  r = await api('/api/admin/comptes?tous=1', {});
  check('super-admin (code global): vue tous clubs EXPLICITE (?tous=1) -> MembreSb (clubsb) visible', r.status === 200 && r.data.comptes.some(c => c.pseudo === 'MembreSb'), '');
  r17f = await xhr17f('/api/compte/inscription', '203.0.113.102', { club: 'clubvm', body: { pseudo: 'MembreSb', email: 'membre.sb@clubvm.test', password: '1234' } });
  check('même pseudo accepté dans un AUTRE club (unicité PAR club, plus globale) -> 201', r17f.status === 201, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/inscription', '203.0.113.103', { club: 'clubvm', body: { pseudo: 'MembreSb', email: 'x1@clubvm.test', password: '1234' } });
  check('pseudo déjà pris DANS le même club -> 409', r17f.status === 409, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/inscription', '203.0.113.104', { club: 'clubvm', body: { pseudo: 'AutreVm', email: 'membre.sb@clubvm.test', password: '1234' } });
  check('email déjà pris dans le même club -> 409', r17f.status === 409, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/inscription', '203.0.113.105', { club: 'clubsb', body: { pseudo: 'AutreSb', email: 'membre.sb@clubvm.test', password: '1234' } });
  check('même email accepté dans un autre club (unicité email PAR club) -> 201', r17f.status === 201, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/connexion', '203.0.113.106', { club: 'clubsb', body: { pseudo: 'MembreSb', password: '1234' } });
  const cookieMembreSb = (r17f.cookie || '').split(';')[0];
  check('connexion depuis SON club -> 200 + session', r17f.status === 200 && !!cookieMembreSb, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/connexion', '203.0.113.107', { club: 'clubvm', body: { pseudo: 'AutreSb', password: '1234' } });
  check('connexion depuis clubvm du compte AutreSb (existant UNIQUEMENT dans clubsb) -> 401 (le pseudo MembreSb lui répond 200 car le jumeau de clubvm est un autre compte)', r17f.status === 401, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/connexion', '203.0.113.114', { club: 'clubvm', body: { pseudo: 'MembreSb', password: '1234' } });
  check('connexion du jumeau MembreSb depuis clubvm -> 200 + session distincte de celle de clubsb (deux comptes indépendants)', r17f.status === 200 && (r17f.cookie || '') !== cookieMembreSb, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/oubli', '203.0.113.112', { club: 'clubsb', body: { email: 'membre.sb@clubsb.test' } });
  check('oubli depuis le bon club -> compte trouvé (dev_reset_link en dev)', r17f.status === 200 && !!r17f.data.dev_reset_link, JSON.stringify({ status: r17f.status, lien: !!r17f.data.dev_reset_link }));
  r17f = await xhr17f('/api/compte/oubli', '203.0.113.113', { club: 'clubvm', body: { email: 'membre.sb@clubsb.test' } });
  check('oubli depuis un autre club: ce email n a pas de compte ici -> réponse générique sans lien (anti-énumération)', r17f.status === 200 && !r17f.data.dev_reset_link, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/connexion', '203.0.113.108', { club: 'clubvm', body: { pseudo: 'Seb', password: 'nouveau1' } });
  check('connexion d un compte du club défaut depuis clubvm -> 401 (le compte n existe pas dans CE club)', r17f.status === 401, r17f.status + ' ' + (r17f.data.error || ''));
  r = await api('/api/admin/comptes', { club: 'clubvm', pin: '5678' });
  check('aucune liaison implicite: Seb reste absent de clubvm (seule la création fige le club)', !r.data.comptes.some(c => c.pseudo === 'Seb'), '');
  r = await post('/api/admin/tournoi', { nom: 'ClubVM-T', regle: 'blackball', taille: 16, format: 'simple', notif_push: false }, { club: 'clubvm', pin: '5678' });
  check('tournoi ClubVM-T créé dans clubvm (pour la garde d isolation des inscriptions)', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r17f = await xhr17f('/api/tournoi/inscrire', '203.0.113.109', { club: 'clubvm', cookie: cookieMembreSb, body: {} });
  check('inscription au tournoi d un autre club avec sa session -> 409 (compte cloisonné)', r17f.status === 409 && String(r17f.data.error || '').includes('appartient à un autre club'), r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/joueur', '203.0.113.110', { club: 'clubvm', body: { pseudo: 'AutreSb' } });
  check('pseudo d un compte d un autre club utilisable anonymement dans ce club (réservation cloisonnée) -> 200', r17f.status === 200, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/joueur', '203.0.113.111', { club: 'clubvm', body: { pseudo: 'MembreSb' } });
  check('pseudo d un compte de CE club toujours réservé (409 compte_pseudo, inscription anonyme refusée)', r17f.status === 409 && r17f.data.compte_pseudo === true, r17f.status + ' ' + (r17f.data.error || ''));
  await del('/api/admin/tournoi', { club: 'clubvm' }).catch(() => {});
  const spec17f = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  const ga17f = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_ADMIN.md'), 'utf8');
  const db17f = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
  const srv17f = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const cpt17f = fs.readFileSync(path.join(__dirname, '..', 'src', 'comptes.js'), 'utf8');
  check('doc: SPEC 17f + GUIDE_ADMIN + schema db (club_id NOT NULL + unicite PAR club) + serveur/comptes scopés PAR club', spec17f.includes('17f. Comptes cloisonnés par club') && spec17f.includes('494 checks') && ga17f.includes('comptes cloisonnés par club') && db17f.includes('UNIQUE (club_id, pseudo)') && db17f.includes('UNIQUE (club_id, email)') && srv17f.includes('compteAvecPseudo(pseudo, clubId)') && cpt17f.includes('AND club_id = ?'), '');

  // ---------- 17g. Promotion admin du club depuis la table de marque (le PIN du club suffit) ----------
  sec('17g. Promotion admin du club depuis la table de marque (le PIN du club suffit)');
  let r17g = await xhr17f('/api/compte/inscription', '203.0.113.115', { club: 'clubvm', body: { pseudo: 'ChefVm', email: 'chef.vm@clubvm.test', password: '1234' } });
  check('compte ChefVm créé dans clubvm (future cible de la promotion) -> 201', r17g.status === 201, r17g.status + ' ' + (r17g.data.error || ''));
  r = await put('/api/admin/club/compte', { pseudo: 'ChefVm', role: 'admin' }, { pin: '5678', club: 'clubvm' });
  const chefId17g = r.data ? r.data.compte_id : undefined;
  check('LE PIN DU CLUB promeut ChefVm en admin de clubvm -> 200 (autonomie du club: plus besoin du code global)', r.status === 200 && r.data.role === 'admin' && r.data.pseudo === 'ChefVm', r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/comptes', { pin: '5678', club: 'clubvm' });
  const chefListe17g = r.data.comptes ? r.data.comptes.find(c => c.pseudo === 'ChefVm') : null;
  check('table de marque clubvm (PIN du club): ChefVm listé avec role_club admin + peut_gerer_roles true + club.slug (sélecteur du front)', r.status === 200 && chefListe17g && chefListe17g.role_club === 'admin' && r.data.peut_gerer_roles === true && r.data.club && r.data.club.slug === 'clubvm', JSON.stringify({ role_club: chefListe17g && chefListe17g.role_club, gerer: r.data.peut_gerer_roles }));
  r = await put('/api/admin/club/compte', { pseudo: 'ChefVm', role: 'chef' }, { pin: '5678', club: 'clubvm' });
  check('rôle inconnu (chef) refusé via le PIN du club -> 400', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/club/comptes', { pin: '5678', club: 'clubvm' });
  check('GET rôles du club ouvert au PIN du club: ChefVm listé admin', r.status === 200 && r.data.comptes.some(c => c.pseudo === 'ChefVm' && c.role === 'admin'), JSON.stringify(r.data.comptes));
  r = await put('/api/admin/club/compte', { pseudo: 'AutreSb', role: 'admin' }, { pin: '5678', club: 'clubvm' });
  check('isolation 17f étendue: le PIN de clubvm ne promeut qu un compte DU club (AutreSb n existe QUE dans clubsb) -> 404 introuvable dans ce club', r.status === 404 && String(r.data.error || '').includes('dans ce club'), r.status + ' ' + (r.data.error || ''));
  r17g = await xhr17f('/api/compte/inscription', '203.0.113.116', { club: 'clubvm', body: { pseudo: 'DeuxVm', email: 'deux.vm@clubvm.test', password: '1234' } });
  check('compte DeuxVm créé dans clubvm -> 201', r17g.status === 201, r17g.status + ' ' + (r17g.data.error || ''));
  r17g = await xhr17f('/api/compte/connexion', '203.0.113.117', { club: 'clubvm', body: { pseudo: 'ChefVm', password: '1234' } });
  const cookieChef17g = (r17g.cookie || '').split(';')[0];
  check('connexion de ChefVm depuis SON club -> 200 + session', r17g.status === 200 && !!cookieChef17g, r17g.status + ' ' + (r17g.data.error || ''));
  r17g = await xhr17f('/api/admin/club/compte', '203.0.113.118', { method: 'PUT', club: 'clubvm', cookie: cookieChef17g, body: { pseudo: 'DeuxVm', role: 'admin' } });
  const deuxId17g = r17g.data ? r17g.data.compte_id : undefined;
  check('la SESSION de ChefVm (admin de clubvm, sans aucun PIN) promeut DeuxVm -> 200', r17g.status === 200 && r17g.data.role === 'admin', r17g.status + ' ' + (r17g.data.error || ''));
  r = await put('/api/admin/club/compte', { pseudo: 'DeuxVm', role: 'operateur' }, { pin: '5678', club: 'clubvm' });
  check('changement de rôle: DeuxVm passé en OPERATEUR via le PIN du club -> 200', r.status === 200 && r.data.role === 'operateur', r.status + ' ' + (r.data.error || ''));
  r17g = await xhr17f('/api/compte/connexion', '203.0.113.119', { club: 'clubvm', body: { pseudo: 'DeuxVm', password: '1234' } });
  const cookieDeux17g = (r17g.cookie || '').split(';')[0];
  check('connexion de DeuxVm (operateur) -> 200 + session', r17g.status === 200 && !!cookieDeux17g, r17g.status + ' ' + (r17g.data.error || ''));
  r17g = await xhr17f('/api/admin/club/comptes', '203.0.113.120', { method: 'GET', club: 'clubvm', cookie: cookieDeux17g });
  check('session OPERATEUR: gestion des rôles toujours interdite -> 403', r17g.status === 403, r17g.status + ' ' + (r17g.data.error || ''));
  r17g = await xhr17f('/api/admin/club/compte', '203.0.113.121', { method: 'DELETE', club: 'clubvm', cookie: cookieChef17g, body: { compte_id: deuxId17g } });
  check('retrait du rôle par une session ADMIN du club, sans confirm_pin (exemption confirm) -> 200', r17g.status === 200, r17g.status + ' ' + (r17g.data.error || ''));
  r = await put('/api/admin/club/compte', { pseudo: 'DeuxVm', role: 'admin' }, { pin: '5678', club: 'clubvm' });
  check('re-promotion de DeuxVm en admin via le PIN du club -> 200 (pour tester le retrait par code)', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/club/compte', { method: 'DELETE', pin: '5678', club: 'clubvm', body: { compte_id: deuxId17g, confirm_pin: '5678' } });
  check('retrait du rôle DEPUIS le PIN du club avec confirm_pin = le code du club -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/comptes', { pin: '5678', club: 'clubvm' });
  check('table de marque clubvm: DeuxVm sans rôle club, ChefVm toujours admin', r.status === 200 && r.data.comptes.some(c => c.pseudo === 'DeuxVm' && !c.role_club) && r.data.comptes.some(c => c.pseudo === 'ChefVm' && c.role_club === 'admin'), JSON.stringify((r.data.comptes || []).map(c => c.pseudo + ':' + (c.role_club || '-'))));
  r = await put('/api/admin/club/compte', { pseudo: 'Seb', role: 'admin' }, { pin: PIN, club: 'clubvm' });
  const sebRole17g = r.data ? r.data.compte_id : undefined;
  check('super-admin: attachement cross-club conservé (Seb, compte du club par défaut, promu admin de clubvm) -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/club/compte', { method: 'DELETE', pin: PIN, club: 'clubvm', body: { compte_id: sebRole17g, confirm_pin: PIN } });
  check('retrait du rôle cross-club par le super-admin + confirm_pin global -> 200 (nettoyage)', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/club/compte', { method: 'DELETE', pin: PIN, club: 'clubvm', body: { compte_id: chefId17g, confirm_pin: PIN } });
  check('nettoyage: retrait du rôle de ChefVm par le super-admin -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/club/comptes', { pin: '5678', club: 'clubvm' });
  check('clubvm sans aucun rôle résiduel -> liste vide (état propre pour les sections suivantes)', r.status === 200 && r.data.comptes.length === 0, 'n=' + r.data.comptes.length);
  const spec17g = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  const ga17g = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_ADMIN.md'), 'utf8');
  const srv17g = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const adm17g = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-comptes.html'), 'utf8');
  check('doc: SPEC 17g + GUIDE_ADMIN + serveur (PIN du club suffit: adminViaPin club, cible DU club, peut_gerer_roles) + front (chips + sélecteur rôle club)', spec17g.includes('17g. Promotion admin du club') && spec17g.includes('494 checks') && ga17g.includes('👑 Rôle club') && srv17g.includes("req.adminViaPin === 'club'") && srv17g.includes('introuvable dans ce club') && srv17g.includes('peut_gerer_roles') && adm17g.includes('👑 Club : admin') && adm17g.includes('role_club'), '');

  // ---------- 17h. Tenant principal: liste des comptes TOUJOURS scopée au club du contexte ----------
  sec('17h. Tenant principal cloisonné: la table de marque ne montre jamais les comptes des autres clubs, même au super-admin');
  r = await api('/api/admin/comptes', {});
  check('17h: super-admin (code global) dans le tenant principal -> MembreSb (compte de clubsb) ABSENT', r.status === 200 && !r.data.comptes.some(c => c.pseudo === 'MembreSb'), 'n=' + r.data.comptes.length);
  check('17h: ChefVm et DeuxVm (comptes de clubvm) absents du tenant principal', !r.data.comptes.some(c => c.pseudo === 'ChefVm') && !r.data.comptes.some(c => c.pseudo === 'DeuxVm'), 'n=' + r.data.comptes.length);
  check('17h: le tenant principal garde SES comptes (Seb, club par défaut, visible)', r.status === 200 && !!r.data.comptes.some(c => c.pseudo === 'Seb'), 'n=' + r.data.comptes.length);
  check('17h: réponse avec tous=false (vue cloisonnée par défaut)', r.data.tous === false, JSON.stringify({ tous: r.data.tous }));
  r = await api('/api/admin/comptes?tous=1', {});
  const mb17h = r.data.comptes.find(c => c.pseudo === 'MembreSb' && c.club_slug === 'clubsb');
  check('?tous=1 (super-admin): restriction levée -> MembreSb (clubsb), ChefVm (clubvm) ET Seb visibles', r.status === 200 && !!mb17h && r.data.comptes.some(c => c.pseudo === 'ChefVm') && r.data.comptes.some(c => c.pseudo === 'Seb') && r.data.tous === true, 'n=' + r.data.comptes.length);
  check('?tous=1: club_slug dévoile le club d origine de chaque compte (MembreSb -> clubsb)', !!mb17h && mb17h.club_slug === 'clubsb', JSON.stringify(mb17h || {}));
  check('?tous=1: compte sans aucun rôle club -> roles_clubs vide', !!mb17h && !mb17h.roles_clubs, JSON.stringify({ roles: mb17h && mb17h.roles_clubs }));
  r = await put('/api/admin/club/compte', { pseudo: 'Seb', role: 'admin' }, { pin: PIN, club: 'clubvm' });
  const sebTous17h = r.data ? r.data.compte_id : undefined;
  check('setup: Seb staff admin de clubvm (cross-club par le super-admin) -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/comptes?tous=1', {});
  check('?tous=1: rôles club agrégés -> Seb porte « clubvm:admin » dans roles_clubs', (r.data.comptes.find(c => c.pseudo === 'Seb') || {}).roles_clubs === 'clubvm:admin', JSON.stringify((r.data.comptes.find(c => c.pseudo === 'Seb') || {}).roles_clubs));
  r = await api('/api/admin/club/compte', { method: 'DELETE', pin: PIN, club: 'clubvm', body: { compte_id: sebTous17h, confirm_pin: PIN } });
  check('nettoyage: retrait du rôle staff de Seb sur clubvm -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/comptes?tous=1', { pin: '5678', club: 'clubvm' });
  check('un code de club NE PEUT PAS forcer la vue tous-clubs (?tous=1 ignoré): liste = clubvm uniquement (DeuxVm présent, AliceBT (club par défaut) absente)', r.status === 200 && r.data.tous === false && r.data.comptes.some(c => c.pseudo === 'DeuxVm') && !r.data.comptes.some(c => c.pseudo === 'AliceBT'), JSON.stringify(r.data.comptes.map(c => c.pseudo)));
  const spec17h = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  const srv17h = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const cons17h = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.html'), 'utf8');
  check('doc: SPEC 17h + serveur (scoping inconditionnel + ?tous=1 super-admin) + front (panneau tous comptes de la plateforme dans la console, 17i)', spec17h.includes('17h. Tenant principal cloisonné') && spec17h.includes('494 checks') && srv17h.includes('tous = superAdminSoumis(req) && String(req.query.tous') && cons17h.includes('/api/super/comptes') && cons17h.includes('Comptes de la plateforme'), '');

  // ---------- 17i. Console super-admin décorrelée des clubs (zone /api/super/*) ----------
  sec('17i. Console super-admin décorrelée: zone /api/super/* + rôle super_admin dédié (aucun club)');
  const xhrSuper = (p17i, xff17i, opts = {}) => fetch(BASE + p17i, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff17i, ...(opts.club ? { 'X-Club': opts.club } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.pin ? { 'X-Admin-Pin': opts.pin } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async r17i2 => ({ status: r17i2.status, data: await r17i2.json().catch(() => ({})) }));
  r = await api('/api/super/scan', {});
  check('17i: GET /api/super/scan avec le code global -> 200, super_admin via global', r.status === 200 && r.data.super_admin === true && r.data.via === 'global', r.status + ' ' + JSON.stringify(r.data));
  let r17i = await xhrSuper('/api/super/scan', '203.0.113.122', { club: 'clubvm', pin: '5678' });
  check('17i: le PIN de clubvm sur /api/super/scan -> 401 (un code de club n ouvre JAMAIS la zone super)', r17i.status === 401, r17i.status + ' ' + JSON.stringify(r17i.data));
  // setup: ChefVm re-promu admin de clubvm pour tester qu une SESSION de club n accède pas non plus à la zone super
  await put('/api/admin/club/compte', { pseudo: 'ChefVm', role: 'admin' }, { pin: '5678', club: 'clubvm' });
  r17i = await xhr17f('/api/compte/connexion', '203.0.113.124', { club: 'clubvm', body: { pseudo: 'ChefVm', password: '1234' } });
  const cookieChef17i = (r17i.cookie || '').split(';')[0];
  r17i = await xhr17f('/api/super/scan', '203.0.113.125', { method: 'GET', club: 'clubvm', cookie: cookieChef17i });
  check('17i: la SESSION admin du club (ChefVm, sans PIN) sur /api/super/scan -> 403', r17i.status === 403, r17i.status + ' ' + JSON.stringify(r17i.data));
  r = await api('/api/admin/club/compte', { method: 'DELETE', pin: '5678', club: 'clubvm', body: { compte_id: (await api('/api/admin/club/comptes', { pin: '5678', club: 'clubvm' })).data.comptes.find(c => c.pseudo === 'ChefVm').compte_id, confirm_pin: '5678' } });
  r = await api('/api/super/clubs', {});
  check('17i: GET /api/super/clubs (code global) -> 200, tous les clubs (ebpc, clubvm, clubsb) sans contexte de club', r.status === 200 && r.data.clubs.some(c => c.slug === 'ebpc') && r.data.clubs.some(c => c.slug === 'clubvm') && r.data.clubs.some(c => c.slug === 'clubsb'), r.status + ' ' + JSON.stringify((r.data.clubs || []).map(c => c.slug)));
  r = await api('/api/super/comptes', {});
  const mb17i = r.data.comptes ? r.data.comptes.find(c => c.pseudo === 'MembreSb') : null;
  check('17i: GET /api/super/comptes -> 200, vue plateforme: MembreSb (club_slug clubsb) et Seb visibles, tous=true', r.status === 200 && r.data.tous === true && !!mb17i && mb17i.club_slug === 'clubsb' && r.data.comptes.some(c => c.pseudo === 'Seb'), 'n=' + (r.data.comptes || []).length);
  r = await api('/api/super/base/export', {});
  check('17i: GET /api/super/base/export (code global) -> 200, payload complet (table club + comptes multi-clubs)', r.status === 200 && r.data.sauvegarde === 'ebpc-tournoi-billard' && !!(r.data.tables && r.data.tables.club) && r.data.tables.compte.some(c => c.pseudo === 'MembreSb'), r.status + ' ' + Object.keys(r.data.tables || {}).length + ' tables');
  r = await post('/api/super/club', { slug: 'clubsi', nom: 'Console 17i', pin: '2468' });
  check('17i: POST /api/super/club crée clubsi depuis la zone super -> 200', r.status === 200 && r.data.club && r.data.club.slug === 'clubsi', r.status + ' ' + (r.data.error || ''));
  r = await put('/api/super/club', { slug: 'clubsi', actif: false, confirm_pin: PIN });
  check('17i: PUT /api/super/club désactive clubsi avec confirm_pin (code global) -> 200 actif=false', r.status === 200 && r.data.club && r.data.club.actif === false, r.status + ' ' + JSON.stringify(r.data.club || r.data.error || {}));
  r = await put('/api/super/club', { slug: 'clubsi', actif: true });
  check('17i: PUT /api/super/club SANS confirm_pin -> 401 (geste sensible: code global exigé)', r.status === 401, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/super/club', { method: 'DELETE', body: { slug: 'clubsi', confirm_pin: PIN } });
  check('17i: DELETE /api/super/club supprime clubsi (confirm_pin global) -> 200', r.status === 200 && r.data.ok === true, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/super/clubs', {});
  check('17i: clubsi bien absent de la liste après suppression (état propre)', r.status === 200 && !r.data.clubs.some(c => c.slug === 'clubsi'), JSON.stringify((r.data.clubs || []).map(c => c.slug)));
  r = await api('/api/super/comptes', {});
  const alice17i = r.data.comptes ? r.data.comptes.find(c => c.pseudo === 'AliceBT') : null;
  check('17i: setup AliceBT retrouvée dans la vue plateforme (rôle admin hérité)', !!alice17i, JSON.stringify(alice17i && alice17i.role));
  r = await post(`/api/super/compte/${alice17i.id}/role`, { role: 'super_admin' });
  check('17i: promotion du rôle plateforme super_admin via /api/super (code global) -> 200', r.status === 200 && r.data.role === 'super_admin', r.status + ' ' + JSON.stringify(r.data));
  const lAlice17i = await login('AliceBT', '1234');
  r = await apiC('/api/super/scan', lAlice17i.cookie);
  check('17i: la SESSION du compte super_admin ouvre la zone super (via session) -> 200', r.status === 200 && r.data.super_admin === true && r.data.via === 'session', r.status + ' ' + JSON.stringify(r.data));
  r = await xhr17f('/api/admin/comptes', '203.0.113.126', { method: 'GET', club: 'clubvm', cookie: lAlice17i.cookie });
  check('17i: accès support conservé: la session super_admin ouvre l admin D un autre club (X-Club clubvm -> comptes de clubvm, DeuxVm visible, tous=false)', r.status === 200 && r.data.tous === false && r.data.comptes.some(c => c.pseudo === 'DeuxVm'), r.status + ' n=' + (r.data.comptes || []).length);
  r = await post(`/api/super/compte/${alice17i.id}/role`, { role: 'user' });
  const rDemote17i = await apiC('/api/super/scan', lAlice17i.cookie);
  check('17i: démotion en user -> 200 puis la même session est immédiatement refusée (scan 403)', r.status === 200 && rDemote17i.status === 403, JSON.stringify({ demote: r.status, scan: rDemote17i.status }));
  await post(`/api/super/compte/${alice17i.id}/role`, { role: 'admin' }); // nettoyage: AliceBT retrouve son rôle admin d avant 17i
  r17i = await xhrSuper(`/api/super/compte/${alice17i.id}/role`, '203.0.113.127', { method: 'POST', club: 'clubvm', pin: '5678', body: { role: 'user' } });
  check('17i: le PIN de club ne promeut ni ne rétrograde en zone super -> 401', r17i.status === 401, r17i.status + ' ' + JSON.stringify(r17i.data));
  const spec17i = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  const srv17i = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const cons17i = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.html'), 'utf8');
  const clubsHtml17i = fs.readFileSync(path.join(__dirname, '..', 'public', 'clubs.html'), 'utf8');
  const adm17i = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const adH17i = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-data.html'), 'utf8');
  const ga17i = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_ADMIN.md'), 'utf8');
  check('doc: SPEC 17i + serveur (zone /api/super/* sans club, rôle super_admin) + console.html (panneaux clubs/comptes/base) + clubs.html redirigé + menus (Console) + admin-data épuré (base partie dans la console) + GUIDE', spec17i.includes('17i. Console super-admin') && spec17i.includes('494 checks') && srv17i.includes('requireSuperZone') && srv17i.includes("'super_admin'") && cons17i.includes('/api/super/comptes') && cons17i.includes('Comptes de la plateforme') && clubsHtml17i.includes('/console.html') && adm17i.includes("href: '/console.html'") && !adH17i.includes('panelSauvegardeBase') && adH17i.includes('panelSauvegardeClub') && adH17i.includes('Console super-admin') && ga17i.includes('Console super-admin'), '');

  // ---------- 18. Rattachement des anciens joueurs anonymes à leur compte ----------
  sec('18. Rattachement compte <-> anciens joueurs anonymes (même pseudo, tournois passés)');
  r = await nouveauTournoi({ nom: 'Retro1', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  check('création tournoi Retro1', r.status === 200, r.status + ' ' + (r.data.error || ''));
  await post('/api/admin/joueur', { pseudo: 'Legende' });
  await post('/api/admin/joueur', { pseudo: 'Adverse' });
  let t18 = (await api('/api/etat')).data.actif;
  for (const p of ['Legende', 'Adverse']) await post(`/api/admin/joueur/${t18.joueurs.find(j => j.pseudo === p).id}/paiement`, { statut: 'paye' });
  r = await post('/api/admin/tirage', {});
  check('tirage Retro1', r.status === 200, r.status);
  t18 = (await api('/api/etat')).data.actif;
  const legende = t18.joueurs.find(j => j.pseudo === 'Legende');
  const m18 = t18.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
  await jouerMatch(m18, legende.id);
  r = await api('/api/etat');
  check('Retro1 terminé automatiquement (Legende champion), plus de tournoi actif', !r.data.actif, r.data.actif && r.data.actif.tournoi.statut);
  // création du compte APRÈS le tournoi (sans tournoi actif): le rattachement doit
  // fonctionner même hors tournoi actif et couvrir les tournois passés
  // (X-Forwarded-For distinct: la limite de création de comptes est keyée par IP)
  const rIns18 = await fetch(BASE + '/api/compte/inscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.77' },
    body: JSON.stringify({ pseudo: 'Legende', email: 'legende@test.fr', password: 'test1234' }),
  });
  const dIns18 = await rIns18.json().catch(() => ({}));
  check('compte Legende créé après le tournoi (sans tournoi actif)', rIns18.status === 201, rIns18.status + ' ' + (dIns18.error || ''));
  r = await api('/api/admin/comptes');
  const c18 = r.data.comptes.find(c => c.pseudo === 'Legende');
  check('joueur anonyme du tournoi archivé rattaché au compte (joueurs=1)', !!(c18 && c18.joueurs === 1), JSON.stringify(c18 && c18.joueurs));
  r = await api(`/api/joueur/${legende.id}/stats`);
  check('fiche joueur: stats du tournoi passé comptées via le compte (1 joué, 1 gagné)', r.status === 200 && r.data.joues === 1 && r.data.gagnes === 1, JSON.stringify({ j: r.data.joues, g: r.data.gagnes }));
  r = await api('/api/stats-joueurs', { pin: null });
  const s18 = r.data.joueurs.find(p => p.pseudo === 'Legende');
  check('classement: Legende garde ses stats après rattachement (1 joué, 1 titre)', !!(s18 && s18.joues === 1 && s18.titres === 1), JSON.stringify(s18));

  // ---------- 19. Front: retour contextuel de la card match ----------
  sec('19. Front: card match avec retour contextuel (?retour=/referrer) + menu nav');
  const mhtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'match.html'), 'utf8');
  check('match.html: lien retour dynamique (?retour= > referrer > /suivi.html) + menu nav()', mhtml.includes('lien-retour') && mhtml.includes('document.referrer') && mhtml.includes("nav('')"), '');
  const cjs18 = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
  check('common.js: matchUrl propage ?retour= depuis les cards', cjs18.includes('function matchUrl') && cjs18.includes('&retour=') && cjs18.includes('location.href = matchUrl(m)'), '');
  check('common.js: garde-fou onglet dans drawBracketLinks (fix lignes parasites du bracket complet apres resize)', cjs18.includes('bracketLinksOnlyTab') && cjs18.includes('opts.linksOnlyTab') && cjs18.includes('bracketTab !== bracketLinksOnlyTab'), '');
  const css19 = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  check('style.css: theme clair (variables + header + liens bracket + score adaptes)', css19.includes('html[data-theme="light"]') && css19.includes('path.to-wb') && css19.includes('.scoreboard .s') && css19.includes('header.top'), '');
  const cpte19 = fs.readFileSync(path.join(__dirname, '..', 'public', 'compte.html'), 'utf8');
  const cv19 = fs.readFileSync(path.join(__dirname, '..', 'public', 'compte-vues.js'), 'utf8');
  const p19 = fs.readFileSync(path.join(__dirname, '..', 'public', 'parametres.html'), 'utf8');
  const am19 = fs.readFileSync(path.join(__dirname, '..', 'public', 'amis.html'), 'utf8');
  const mm19 = fs.readFileSync(path.join(__dirname, '..', 'public', 'mes-matchs.html'), 'utf8');
  check('parametres: interrupteurs 0-1 alignes dans le panneau Parametres (page dediee parametres.html + vue partagee compte-vues.js, basculerTheme + .pref-row + sous-sections, sans texte d aide)', p19.includes('vueParametres') && p19.includes("nav('compte')") && cv19.includes('basculerTheme') && cv19.includes('toggle-mini') && cv19.includes('Paramètres') && cv19.includes('pref-row') && cv19.includes('Préférences') && !cv19.includes('0 = sombre (défaut)') && cjs18.includes('function basculerTheme') && cjs18.includes('function themeActuel') && css19.includes('button.toggle-mini') && css19.includes('.pref-row'), '');
  const pages19 = fs.readdirSync(path.join(__dirname, '..', 'public')).filter(f => f.endsWith('.html') && f !== 'tv.html');
  const sansSnippet = pages19.filter(f => !fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8').includes("localStorage.getItem('ebpc_theme')"));
  check('script anti-flash theme present sur toutes les pages sauf TV', sansSnippet.length === 0, 'manquantes: ' + sansSnippet.join(', '));
  // i18n fr/en/es/it/de : erreurs API traduites avec X-Lang (en/es/it/de), defaut fr inchange, dictionnaires front 5 langues + selecteur 5 entrees
  const rrLang = await fetch(BASE + '/api/rien-du-tout', { headers: { 'Content-Type': 'application/json', 'X-Lang': 'en' } });
  const dLang = await rrLang.json().catch(() => ({}));
  check('i18n: erreur API traduite avec X-Lang: en (Route inconnue -> Unknown route)', rrLang.status === 404 && dLang.error === 'Unknown route', JSON.stringify(dLang));
  const rrFr = await fetch(BASE + '/api/rien-du-tout', { headers: { 'Content-Type': 'application/json' } });
  const dFr = await rrFr.json().catch(() => ({}));
  check('i18n: sans X-Lang, erreur API en francais (defaut inchange)', rrFr.status === 404 && dFr.error === 'Route inconnue', JSON.stringify(dFr));
  const rrEs = await fetch(BASE + '/api/rien-du-tout', { headers: { 'Content-Type': 'application/json', 'X-Lang': 'es' } });
  const dEs = await rrEs.json().catch(() => ({}));
  const rrIt = await fetch(BASE + '/api/rien-du-tout', { headers: { 'Content-Type': 'application/json', 'X-Lang': 'it' } });
  const dIt = await rrIt.json().catch(() => ({}));
  const rrDe = await fetch(BASE + '/api/rien-du-tout', { headers: { 'Content-Type': 'application/json', 'X-Lang': 'de' } });
  const dDe = await rrDe.json().catch(() => ({}));
  check('i18n: erreurs API traduites avec X-Lang es/it/de (Route inconnue -> Ruta desconocida / Percorso sconosciuto / Unbekannte Route)', rrEs.status === 404 && dEs.error === 'Ruta desconocida' && rrIt.status === 404 && dIt.error === 'Percorso sconosciuto' && rrDe.status === 404 && dDe.error === 'Unbekannte Route', JSON.stringify([dEs.error, dIt.error, dDe.error]));
  check('i18n: serveur traduit les erreurs (src/i18n.js + middleware X-Lang dans server.js)', fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.js'), 'utf8').includes('traduireErreur') && fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8').includes('X-Lang: en/es/it/de -> traduit'), '');
  check('i18n: front traduit (LANG + t() + X-Lang + dictionnaire common.js, selecteur de langue FR/EN dans le bandeau)', cjs18.includes('const LANG') && cjs18.includes('function t(') && cjs18.includes('X-Lang') && cjs18.includes('ebpc_lang') && cjs18.includes('traduireDomStatique') && cjs18.includes('function choisirLangue') && cjs18.includes('nav-lang'), '');
  check('front: selecteur de langue dans le bandeau (liste deroulante FR/EN avec drapeaux via menuDeroulant, entree active marquee, bouton = langue courante, ancienne rangee Langue retiree du panneau Parametres)', cjs18.includes('btnLang') && cjs18.includes('Français') && cjs18.includes('English') && cjs18.includes("class: 'nav-lang'") && !cv19.includes('choisirLang') && !cv19.includes('swLang') && css19.includes('.nav-lang'), '');
  check('front: selecteur langue colle a l extremite droite du bandeau (burgers groupes a gauche: #nav flex, justify-content flex-start, margin-left auto) + entree menu principal Tournoi renommee Accueil (traduite Home en EN)', css19.includes('#nav { flex: 1 1 auto') && css19.includes('justify-content: flex-start') && css19.includes('margin-left: auto') && cjs18.includes("'Accueil'") && !cjs18.includes("'home', 'Tournoi'"), '');
  check('front: selecteur langue detache au bord droit de l ecran aussi sur mobile (<=560px: #nav pleine largeur en colonne, sinon le bouton reste colle au burger Compte) + liste deroulante alignee sur le bord droit du bouton (largeur reelle mesuree via offsetWidth)', css19.includes('#nav { width: 100%; }') && cjs18.includes('Math.max(drop.offsetWidth, 220)') && cjs18.includes('Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))'), '');
  // push traduits par destinataire: colonne compte.lang persistee par le selecteur, payloads bilingues fr/en dans push.js
  const push19 = fs.readFileSync(path.join(__dirname, '..', 'src', 'push.js'), 'utf8');
  const srv19 = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const cpts19 = fs.readFileSync(path.join(__dirname, '..', 'src', 'comptes.js'), 'utf8');
  const db19 = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
  const unit19 = fs.readFileSync(path.join(__dirname, '..', 'test', 'push-unit.js'), 'utf8');
  check('push: notifications traduites par destinataire (compte.lang persiste par le selecteur, payloads fr/en: match lance, ami, inscription, test, creation/rappel tournoi; repli hint X-Lang pour le test manuel; position du selecteur a l extremite opposee du menu principal)', db19.includes('ADD COLUMN lang') && cpts19.includes("['fr', 'en', 'es', 'it', 'de'].includes(req.body.lang)") && cjs18.includes('JSON.stringify({ lang: l })') && push19.includes("You're up!") && push19.includes("A friend's match") && push19.includes('Notification test') && srv19.includes('New tournament — registration open') && srv19.includes('Reminder — registration open') && unit19.includes('i18n par destinataire') && cjs18.includes('wrap, btnCompte, btnLang'), '');
  check('i18n: push etendus es/it/de + dictionnaires 5 langues (payloads Te toca jugar / Notifica di prova / Testbenachrichtigung / Spiel eines Freundes läuft, creation tournoi traduite, STATIQUES_ES serveur, I18N_ES front, test unitaire i18n etendu)', push19.includes('Te toca jugar') && push19.includes('Notifica di prova') && push19.includes('Testbenachrichtigung') && push19.includes('Spiel eines Freundes läuft') && srv19.includes('Nuevo torneo — inscripciones abiertas') && srv19.includes('Nuovo torneo — iscrizioni aperte') && srv19.includes('Neues Turnier — Anmeldung offen') && fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.js'), 'utf8').includes('STATIQUES_ES') && cjs18.includes('const I18N_ES') && cjs18.includes('const I18N_IT') && cjs18.includes('const I18N_DE') && cjs18.includes('const REPS_DYN_ES') && unit19.includes('i18n étendu'), '');
  check('front: selecteur de langue 5 entrees dans le bandeau (FR/EN/ES/IT/DE data-driven via LANGUES, drapeaux + libelles natifs, bouton = code langue courante)', cjs18.includes('const LANGUES') && cjs18.includes("['fr','🇫🇷','Français']") && cjs18.includes('Español') && cjs18.includes('Italiano') && cjs18.includes('Deutsch') && cjs18.includes("['en','es','it','de'].includes(v)"), '');
  check('i18n: couverture complete (~490 entrees + regles dynamiques dans common.js)', (cjs18.match(/": "/g) || []).length >= 450 && cjs18.includes('const I18N_DYN') && (cjs18.match(/\[\//g) || []).length >= 60, '');
  check('i18n: appels admin traduits aussi (X-Lang dans adminHeaders de admin-common.js + adminCall)', fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-common.js'), 'utf8').includes('X-Lang') && cjs18.includes('X-Lang'), '');
  const at19 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-tournoi.html'), 'utf8');
  check('front: burger compte a entrees dynamiques vers des pages dediees (login/register/parametres hors connexion, parametres/amis/mes matchs/ma fiche/deconnexion connecte, table de marque seule si role admin) + checkboxes toggle-mini + append filtre null', cjs18.includes('menuDeroulant') && cjs18.includes('nav-login') && cjs18.includes('/compte.html#connexion') && cjs18.includes('/compte.html#creer') && cjs18.includes('/parametres.html') && cjs18.includes('/amis.html') && cjs18.includes('/mes-matchs.html') && cjs18.includes('compteNav.role') && !cjs18.includes("href: '/admin-comptes.html'") && !cjs18.includes("href: '/admin-journal.html'") && cpte19.includes("id: 'connexion'") && cpte19.includes("id: 'creer'") && cv19.includes('].filter(Boolean));') && css19.includes('input[type="checkbox"].toggle-mini') && (cv19.split("type: 'checkbox', class: 'toggle-mini'").length - 1) >= 2 && (at19.split("type: 'checkbox', class: 'toggle-mini'").length - 1) === 3, '');
  check('front: pages dediees parametres/amis/mes matchs (vues partagees compte-vues.js, garde connexion vers compte.html#connexion sur amis et mes matchs, push-client sur parametres, titres traduits)', cv19.includes('async function vueParametres') && cv19.includes('async function vueAmis') && cv19.includes('async function vueMesMatchs') && am19.includes('vueAmis') && mm19.includes('vueMesMatchs') && p19.includes('push-client.js') && (cv19.split("location.replace('/compte.html#connexion')").length - 1) === 2 && cjs18.includes('Paramètres — Pink City Billard') && cjs18.includes('Amis — Pink City Billard') && cjs18.includes('Mes matchs — Pink City Billard'), '');
  // ---------- 20. Fil du tournoi (accueil) : payload dérivé de l'état + front 5 langues ----------
  sec('20. Fil du tournoi (accueil: faits + belle + champion, 3 lignes + étendre, i18n 5 langues)');
  await del('/api/admin/tournoi').catch(() => {});
  r = await post('/api/admin/tournoi', { nom: 'FilT', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  check('fil: création tournoi FilT', r.status === 200, r.status + ' ' + (r.data.error || ''));
  await post('/api/admin/joueurs/simulation', { count: 4, prefix: 'F' });
  let t20 = (await api('/api/etat')).data.actif;
  for (const j of t20.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  await post('/api/admin/tirage', {});
  t20 = (await api('/api/etat')).data.actif;
  const m20 = t20.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
  await post(`/api/admin/match/${m20.id}/lancer`, { table_id: t20.tables[0].id });
  await api(`/api/match/${m20.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m20.joueur1.id } });
  for (let i = 0; i < m20.manches; i++) await api(`/api/match/${m20.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: m20.joueur1.id } });
  // le fil est dérivé de l'état côté client : ce que /api/tournois/:id (public) expose suffit à écrire chaque ligne
  r = await api(`/api/tournois/${t20.tournoi.id}`, { pin: null });
  const fini20 = (r.data.tournoi || {}).matchs.find(m => m.etat === 'termine' && m.gagnant_id != null && m.joueur1 && m.joueur2);
  check('fil: /api/tournois/:id public expose gagnant + perdant + scores + table + ended_at (contrat du fil)', r.status === 200 && !!(fini20 && fini20.gagnant && fini20.joueur1.pseudo && fini20.joueur2.pseudo && fini20.ended_at && fini20.table === 1 && typeof fini20.score1 === 'number'), JSON.stringify(fini20 && { g: fini20.gagnant, e: fini20.ended_at, t: fini20.table }));
  const m20b = (await api('/api/etat')).data.actif.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
  r = await post(`/api/admin/match/${m20b.id}/forfait`, { joueur_id: m20b.joueur2.id });
  check('fil: forfait exposé (etat forfait + gagnant + ended_at pour la ligne dédiée)', r.status === 200 && r.data.match.etat === 'forfait' && r.data.match.gagnant_id === m20b.joueur1.id && !!r.data.match.ended_at, r.status + ' ' + JSON.stringify(r.data.match && r.data.match.etat));
  await del('/api/admin/tournoi').catch(() => {});
  // front : le panneau, les phrases, l'élimination DKO, l'horodatage, le dernier tournoi sans actif
  const idx20 = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  check('fil: front accueil (lignesFil + panneauFil + 3 lignes + Voir tout/Replier + chargerFilDernier)', idx20.includes('function lignesFil') && idx20.includes('function panneauFil') && idx20.includes('function filAgo') && idx20.includes('chargerFilDernier') && idx20.includes('Fil du tournoi') && idx20.includes('Voir tout') && idx20.includes('Replier') && idx20.includes('lignes.slice(0, 3)'), '');
  check('fil: phrases des lignes (victoire + table + forfait + champion + belle)', idx20.includes(' bat ') && idx20.includes('· table ${m.table}') && idx20.includes('déclare forfait, ') && idx20.includes('remporte le tournoi !') && idx20.includes('sont à la belle'), '');
  check('fil: élimination définitive uniquement en double KO (LB/F), fusionnée dans la ligne de victoire', idx20.includes("tv.tournoi.format === 'double' && (m.bracket === 'LB' || m.bracket === 'F')") && idx20.includes('· tournoi terminé pour ${p.pseudo}'), '');
  check('fil: horodatage relatif (à l\'instant / il y a N min/h/j) + tri par ended_at décroissant', idx20.includes('function filAgo') && idx20.includes("il y a ") && idx20.includes("localeCompare"), '');
  check('fil: sans tournoi actif, fil du dernier tournoi terminé via /api/tournois/:id (public, champion visible)', idx20.includes('chargerFilDernier') && idx20.includes('/api/tournois/'), '');
  // i18n : règles dynamiques fil ajoutées et alignées dans les 4 langues cibles
  const cjs20 = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
  check('fil: i18n EN — règles dyn du fil dans I18N_DYN (beats / table / tournament over / forfeits / wins the tournament / one frame from victory / ago)', cjs20.includes('$1 beats $2 $3-$4') && cjs20.includes('· table $1') && cjs20.includes('· tournament over for $1') && cjs20.includes('$1 forfeits, $2 moves on to the next round') && cjs20.includes('🏆 $1 wins the tournament!') && cjs20.includes('one frame from victory at table $3') && cjs20.includes('$1 min ago'), '');
  const sliceArr = (src, a, b) => { const i = src.indexOf(a); return i === -1 ? '' : src.slice(i, src.indexOf(b, i) >= 0 ? src.indexOf(b, i) : src.length); };
  const cDyn = (s) => (s.match(/\n\s*\[\//g) || []).length;   // règles [/..
  const cReps = (s) => (s.match(/\n\s*"/g) || []).length;      // remplacements "..."
  const dynSrc = sliceArr(cjs20, 'const I18N_DYN = [', 'const I18N_ES');
  const repsES = sliceArr(cjs20, 'const REPS_DYN_ES = [', 'const I18N_IT');
  const repsIT = sliceArr(cjs20, 'const REPS_DYN_IT = [', 'const I18N_DE');
  const repsDE = sliceArr(cjs20, 'const REPS_DYN_DE = [', 'const DICTS');
  check('fil: i18n ES/IT/DE — remplacements du fil présents (vence/batte/schlägt + champion + hace/fa/vor)', repsES.includes('$1 vence a $2 $3-$4') && repsIT.includes('$1 batte $2 $3-$4') && repsDE.includes('$1 schlägt $2 $3-$4') && repsES.includes('hace $1 min') && repsIT.includes('$1 min fa') && repsDE.includes('vor $1 Min.'), '');
  check('fil: i18n — 4 tableaux dynamiques alignés (I18N_DYN = REPS_DYN_ES = REPS_DYN_IT = REPS_DYN_DE)', cDyn(dynSrc) === cReps(repsES) && cReps(repsES) === cReps(repsIT) && cReps(repsIT) === cReps(repsDE) && cDyn(dynSrc) >= 77, `${cDyn(dynSrc)} / ${cReps(repsES)} / ${cReps(repsIT)} / ${cReps(repsDE)}`);
  const fEn = sliceArr(cjs20, 'const I18N = {', 'const I18N_DYN');
  const fEs = sliceArr(cjs20, 'const I18N_ES = {', 'const REPS_DYN_ES');
  const fIt = sliceArr(cjs20, 'const I18N_IT = {', 'const REPS_DYN_IT');
  const fDe = sliceArr(cjs20, 'const I18N_DE = {', 'const REPS_DYN_DE');
  check('fil: i18n — clés statiques du fil dans les 4 dictionnaires (Fil du tournoi + Replier + en direct)', fEn.includes('"Fil du tournoi": "Tournament feed"') && fEs.includes('"Fil du tournoi": "Crónica del torneo"') && fIt.includes('"Fil du tournoi": "Cronaca del torneo"') && fDe.includes('"Fil du tournoi": "Turnier-Feed"') && fEn.includes('"Replier": "Show less"') && fEs.includes('"Replier": "Ver menos"') && fIt.includes('"Replier": "Mostra meno"') && fDe.includes('"Replier": "Weniger anzeigen"') && fEn.includes('"en direct": "live"') && fEs.includes('"en direct": "en directo"') && fIt.includes('"en direct": "in diretta"') && fDe.includes('"en direct": "live"'), '');
  const css20 = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  check('fil: styles du panneau (.fil-ligne, live en rose, colonne sur mobile)', css20.includes('.fil-ligne') && css20.includes('.fil-live') && css20.includes('.fil-txt') && css20.includes('.fil-temps'), '');

  // ---------- 21. Fil : variantes + durées + revanche (confrontations passées du club) ----------
  sec('21. Fil : variantes de phrases + durées des matchs finis + revanche (confrontations passées, i18n 5 langues)');
  await del('/api/admin/tournoi').catch(() => {});
  r = await post('/api/admin/tournoi', { nom: 'RevA', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  check('revanche: création RevA (2 joueurs, duel garanti dans le tableau)', r.status === 200, r.status + ' ' + (r.data.error || ''));
  await post('/api/admin/joueurs/simulation', { count: 2, prefix: 'R' });
  let t21 = (await api('/api/etat')).data.actif;
  for (const j of t21.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  await post('/api/admin/tirage', {});
  t21 = (await api('/api/etat')).data.actif;
  const m21 = t21.matchs.find(m => !m.virtuel && m.etat === 'pret' && m.joueur1 && m.joueur2);
  check('revanche: /api/etat expose actif.h2h pour les matchs pas terminés (première rencontre: n=0, v1=v2=0, dernier null)', !!m21 && !!t21.h2h && !!t21.h2h[m21.id] && t21.h2h[m21.id].n === 0 && t21.h2h[m21.id].v1 === 0 && t21.h2h[m21.id].v2 === 0 && t21.h2h[m21.id].dernier === null, JSON.stringify((t21.h2h || {})[m21 && m21.id]));
  await post(`/api/admin/match/${m21.id}/lancer`, { table_id: t21.tables[0].id });
  await api(`/api/match/${m21.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m21.joueur1.id } });
  for (let i = 0; i < m21.manches; i++) await api(`/api/match/${m21.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: m21.joueur1.id } });
  // R1 remporte le duel -> tournoi terminé (2 joueurs: ce match était la finale), archivé avec sa durée
  const gA = m21.joueur1.pseudo;
  r = await api(`/api/tournois/${t21.tournoi.id}`, { pin: null });
  const duA = (((r.data || {}).tournoi || {}).matchs || []).find(m => !m.virtuel && m.gagnant_id != null && m.joueur1 && m.joueur2);
  check('revanche: duel de RevA archivé avec sa durée (gagnant + duree_s numérique dans /api/tournois/:id) + h2h du duel FINI exposé dans le payload (première rencontre du club : n=0, v1=v2=0, le match lui-même exclu)', !!duA && duA.gagnant === gA && typeof duA.duree_s === 'number' && duA.duree_s >= 0 && !!(r.data.tournoi.h2h && r.data.tournoi.h2h[duA.id] && r.data.tournoi.h2h[duA.id].n === 0 && r.data.tournoi.h2h[duA.id].v1 === 0 && r.data.tournoi.h2h[duA.id].v2 === 0), JSON.stringify(duA && { g: duA.gagnant, d: duA.duree_s }));
  await del('/api/admin/tournoi').catch(() => {});
  r = await post('/api/admin/tournoi', { nom: 'RevB', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  check('revanche: création RevB (mêmes pseudos, autre tournoi du même club)', r.status === 200, r.status + ' ' + (r.data.error || ''));
  await post('/api/admin/joueurs/simulation', { count: 2, prefix: 'R' });
  let t21b = (await api('/api/etat')).data.actif;
  for (const j of t21b.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  await post('/api/admin/tirage', {});
  t21b = (await api('/api/etat')).data.actif;
  const m21b = t21b.matchs.find(m => !m.virtuel && m.etat === 'pret' && m.joueur1 && m.joueur2);
  const h21 = (t21b.h2h || {})[m21b && m21b.id];
  check('revanche: RevB retrouve la paire dans l historique du club (n=1, victoire du bon côté, dernier = gagnant + score + tournoi RevA)',
    !!m21b && !!h21 && h21.n === 1 && ((h21.v1 === 1 && h21.v2 === 0 && m21b.joueur1.pseudo === gA) || (h21.v2 === 1 && h21.v1 === 0 && m21b.joueur2.pseudo === gA)) && !!h21.dernier && h21.dernier.gagnant === gA && /^\d+-\d+$/.test(String(h21.dernier.score)) && h21.dernier.tournoi === 'RevA',
    JSON.stringify(h21));
  await del('/api/admin/tournoi').catch(() => {});
  // front : variantes déterministes, durées, lignes revanche (i18n 5 langues)
  const idx21 = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  check('fil: variantes déterministes (filHash/filPick) - victoires, forfaits, champion, belles avec table/sans table 7/4, revanches underdog 7, égalités 6 (complément : +2 par catégorie)', idx21.includes('function filHash') && idx21.includes('function filPick')
    && idx21.includes("s'impose face à ${p.pseudo} ${gs}-${ps}") && idx21.includes("vient à bout de ${p.pseudo} ${gs}-${ps}")
    && idx21.includes("${g.pseudo} domine ${p.pseudo} ${gs}-${ps}") && idx21.includes("${g.pseudo} écarte ${p.pseudo} ${gs}-${ps}")
    && idx21.includes("${p.pseudo} abandonne, ${g.pseudo} passe au tour suivant") && idx21.includes("forfait de ${p.pseudo}, ${g.pseudo} passe au tour suivant")
    && idx21.includes("jette l'éponge, ${g.pseudo} passe au tour suivant") && idx21.includes("forfait de ${p.pseudo}, ${g.pseudo} avance sans jouer")
    && idx21.includes(`soulève le trophée !`) && idx21.includes(`décroche le titre !`) && idx21.includes(`remporte le tournoi !`)
    && idx21.includes("Fin du suspense : ${tv.champion.pseudo} est champion !") && idx21.includes("a eu le dernier mot : le titre est à lui !")
    && idx21.includes("La belle ! ${m.joueur1.pseudo} et ${m.joueur2.pseudo} à la table ${m.table}") && idx21.includes("Ça se joue à la belle entre ${m.joueur1.pseudo} et ${m.joueur2.pseudo} (table ${m.table})") && idx21.includes(`sont à la belle à la table`)
    && idx21.includes("Manche décisive entre ${m.joueur1.pseudo} et ${m.joueur2.pseudo} (table ${m.table}) !") && idx21.includes("Tous debout : ${m.joueur1.pseudo} et ${m.joueur2.pseudo} disputent la belle à la table ${m.table} !")
    && idx21.includes("La belle entre ${m.joueur1.pseudo} et ${m.joueur2.pseudo} !") &&
    idx21.includes("surclasse ${p.pseudo} ${gs}-${ps}") &&
    idx21.includes("fait la loi face à ${p.pseudo} ${gs}-${ps}") &&
    idx21.includes("${p.pseudo} ne se présente pas, ${g.pseudo} passe au tour suivant") &&
    idx21.includes("forfait de ${p.pseudo} : ${g.pseudo} file au tour suivant") &&
    idx21.includes(`entre au palmarès du club !`) &&
    idx21.includes(`règne sur le tournoi !`) &&
    idx21.includes("Le tournoi se joue maintenant : ${m.joueur1.pseudo} et ${m.joueur2.pseudo} à la belle à la table ${m.table} !") &&
    idx21.includes("Dernière manche pour ${m.joueur1.pseudo} et ${m.joueur2.pseudo} à la table ${m.table} !") &&
    idx21.includes("Ça se joue à la belle entre ${m.joueur1.pseudo} et ${m.joueur2.pseudo} !") &&
    idx21.includes("Manche décisive entre ${m.joueur1.pseudo} et ${m.joueur2.pseudo} !"), '');
  check('fil: durées des matchs finis composées dans les lignes (dureeFil + duree_s du payload)', idx21.includes('function dureeFil') && idx21.includes('dureeFil(m.duree_s)') && idx21.includes('Math.round(d / 60)') && idx21.includes("padStart(2, '0')") && idx21.includes("· durée ${min} min") && idx21.includes("· durée ${Math.floor(min / 60)} h"), '');
  check('fil: lignes revanche (déjà rencontrés via actif.h2h, underdog « une revanche à prendre », égalité, mène X-Y, pas de double si à la belle)',
    idx21.includes('tv.h2h || {}') && idx21.includes("🔥 Revanche : ${dom.pseudo} joue contre ${adv.pseudo}, une revanche à prendre !")
    && idx21.includes("🔥 ${dom.pseudo} joue sa revanche contre ${adv.pseudo} !") && idx21.includes("🔥 ${dom.pseudo} retente sa chance contre ${adv.pseudo} !")
    && idx21.includes("🔥 ${dom.pseudo} veut renverser la vapeur contre ${adv.pseudo} !") && idx21.includes("🔥 À ${dom.pseudo} de trouver la faille face à ${adv.pseudo} !")
    && idx21.includes(`se retrouvent à égalité !`) && idx21.includes("🔥 Fierté en jeu : ${m.joueur1.pseudo} et ${m.joueur2.pseudo} se retrouvent !")
    && idx21.includes("🔥 ${m.joueur1.pseudo} et ${m.joueur2.pseudo} se retrouvent, bilan parfaitement équilibré !") && idx21.includes("🔥 Égalité parfaite avant ce round : ${m.joueur1.pseudo} vs ${m.joueur2.pseudo} !")
    && idx21.includes("${adv.pseudo} mène ${Math.max(h.v1, h.v2)}-${Math.min(h.v1, h.v2)}") && idx21.includes('belles.has(String(m.id))') && idx21.includes(`h.n < 1`) &&
    idx21.includes("🔥 Un compte à régler pour ${dom.pseudo} face à ${adv.pseudo} !") &&
    idx21.includes("🔥 Ce match sent la revanche : ${dom.pseudo} défie ${adv.pseudo} !") &&
    idx21.includes("🔥 Vieilles connaissances dos à dos : ${m.joueur1.pseudo} et ${m.joueur2.pseudo} se retrouvent !") &&
    idx21.includes("🔥 Rien à départager : ${m.joueur1.pseudo} et ${m.joueur2.pseudo} rejouent leur histoire !"), '');
  check('fil: i18n EN - les 43 règles du fil (variantes victoire/forfait/champion/belle, revanche, mène, durée)', cjs20.includes(`$1 gets the better of $2 $3-$4`) && cjs20.includes(`$1 overcomes $2 $3-$4`) && cjs20.includes(`$1 dominates $2 $3-$4`) && cjs20.includes(`$1 brushes $2 aside $3-$4`) && cjs20.includes(`$1 withdraws, $2 moves on to the next round`) && cjs20.includes(`forfeit by $1, $2 moves on to the next round`) && cjs20.includes(`$1 throws in the towel, $2 moves on to the next round`) && cjs20.includes(`$2 advances without playing`) && cjs20.includes(`$1 lifts the trophy!`) && cjs20.includes(`$1 takes the title!`) && cjs20.includes(`End of the suspense: $1 is the champion!`) && cjs20.includes(`$1 had the last word: the title is his!`) && cjs20.includes(`The decider! $1 and $2 at table $3`) && cjs20.includes(`the decider between $1 and $2 (table $3)`) && cjs20.includes(`Deciding frame between $1 and $2 (table $3)!`) && cjs20.includes(`On your feet: $1 and $2 play the decider at table $3!`) && cjs20.includes(`The decider between $1 and $2!`) && cjs20.includes(`🔥 Revenge match: $1 plays $2, a revenge to take!`) && cjs20.includes(`$1 plays his revenge match against $2!`) && cjs20.includes(`$1 tries his luck again against $2!`) && cjs20.includes(`$1 wants to turn the tide against $2!`) && cjs20.includes(`Up to $1 to find a way past $2!`) && cjs20.includes(`dead even!`) && cjs20.includes(`🔥 Pride at stake: $1 and $2 meet again!`) && cjs20.includes(`record perfectly balanced!`) && cjs20.includes(`Perfect tie before this round: $1 vs $2!`) && cjs20.includes(`$1 leads $2-$3`) && cjs20.includes(`· duration $1 min`) && cjs20.includes(`· duration $1 h $2`) &&
    cjs20.includes(`$1 outclasses $2 $3-$4`) &&
    cjs20.includes(`$1 lays down the law against $2 $3-$4`) &&
    cjs20.includes(`$1 doesn't show up, $2 moves on to the next round`) &&
    cjs20.includes(`forfeit by $1: $2 races into the next round`) &&
    cjs20.includes(`🏆 $1 enters the club's roll of honour!`) &&
    cjs20.includes(`🏆 $1 rules the tournament!`) &&
    cjs20.includes(`The tournament is decided now: $1 and $2 in the decider at table $3!`) &&
    cjs20.includes(`Last frame for $1 and $2 at table $3!`) &&
    cjs20.includes(`It all comes down to the decider between $1 and $2!`) &&
    cjs20.includes(`Deciding frame between $1 and $2!`) &&
    cjs20.includes(`🔥 A score to settle for $1 against $2!`) &&
    cjs20.includes(`🔥 This one smells like revenge: $1 takes on $2!`) &&
    cjs20.includes(`🔥 Old rivals dead even: $1 and $2 meet again!`) &&
    cjs20.includes(`🔥 Nothing to split them: $1 and $2 write a new chapter!`), '');
  check('fil: i18n ES/IT/DE - variantes et revanche traduites (se impone/ha la meglio/setzt sich durch, domine/tira la toalla/getta la spugna/wirft das Handtuch, revanche adoucie, durées, conduce/führt)', repsES.includes(`$1 se impone a $2 $3-$4`) && repsIT.includes(`$1 ha la meglio su $2 $3-$4`) && repsDE.includes(`$1 setzt sich mit $3-$4 gegen $2 durch`) && repsES.includes(`$1 domina a $2 $3-$4`) && repsIT.includes(`$1 domina $2 $3-$4`) && repsDE.includes(`$1 dominiert $2 mit $3-$4`) && repsES.includes(`$1 tira la toalla, $2 pasa a la ronda siguiente`) && repsIT.includes(`$1 getta la spugna, $2 passa al turno successivo`) && repsDE.includes(`$1 wirft das Handtuch, $2 kommt in die nächste Runde`) && repsES.includes(`forfait de $1, $2 avanza sin jugar`) && repsIT.includes(`forfait di $1, $2 avanza senza giocare`) && repsDE.includes(`Forfait von $1, $2 kommt ohne Spielen weiter`) && repsES.includes(`con una revancha por delante`) && repsIT.includes(`una rivincita da prendere`) && repsDE.includes(`eine Revanche zu holen`) && repsES.includes(`Fin del suspenso: ¡$1 es campeón!`) && repsIT.includes(`Fine del suspense: $1 è il campione!`) && repsDE.includes(`Ende der Spannung: $1 ist Champion!`) && repsES.includes(`forfait de $1, $2 pasa a la ronda siguiente`) && repsIT.includes(`$1 conduce $2-$3`) && repsDE.includes(`$1 führt $2-$3`) && repsES.includes(`· duración $1 min`) && repsIT.includes(`· durata $1 min`) && repsDE.includes(`· Dauer $1 Min.`) &&
    repsES.includes(`$1 supera con autoridad a $2 $3-$4`) &&
    repsES.includes(`$1 no se presenta, $2 pasa a la ronda siguiente`) &&
    repsES.includes(`🏆 ¡$1 entra al palmarés del club!`) &&
    repsES.includes(`¡Última manga para $1 y $2 en la mesa $3!`) &&
    repsES.includes(`🔥 ¡$1 tiene cuentas pendientes con $2!`) &&
    repsES.includes(`🔥 Nada que los separe: ¡$1 y $2 escriben un nuevo capítulo!`) &&
    repsIT.includes(`$1 surclassa $2 $3-$4`) &&
    repsIT.includes(`$1 non si presenta, $2 passa al turno successivo`) &&
    repsIT.includes(`🏆 $1 entra nell'albo d'oro del club!`) &&
    repsIT.includes(`Ultima manche per $1 e $2 al tavolo $3!`) &&
    repsIT.includes(`🔥 $1 ha un conto in sospeso con $2!`) &&
    repsIT.includes(`🔥 Vecchi rivali a pari merito: $1 e $2 si ritrovano!`) &&
    repsDE.includes(`$1 übertrumpft $2 mit $3-$4`) &&
    repsDE.includes(`$1 erscheint nicht, $2 kommt in die nächste Runde`) &&
    repsDE.includes(`🏆 $1 geht in die Siegerliste des Clubs ein!`) &&
    repsDE.includes(`Letzter Frame für $1 und $2 am Tisch $3!`) &&
    repsDE.includes(`🔥 $1 hat mit $2 noch eine Rechnung offen!`) &&
    repsDE.includes(`🔥 Alte Bekannte auf Augenhöhe: $1 und $2 treffen erneut aufeinander!`), '');
  check('fil: i18n - 4 tableaux toujours alignés après les 43 règles du fil (cDyn = 120)', cDyn(dynSrc) === cReps(repsES) && cReps(repsES) === cReps(repsIT) && cReps(repsIT) === cReps(repsDE) && cDyn(dynSrc) === 120, `${cDyn(dynSrc)} / ${cReps(repsES)} / ${cReps(repsIT)} / ${cReps(repsDE)}`);
  const srv21 = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  check('fil: traces après fin : h2h aussi pour les matchs terminés/forfaits (rencontres STRICTEMENT antérieures, jamais le match lui-même ni un duel postérieur) + h2h servi sur le payload public /api/tournois/:id (fil du dernier tournoi terminé) + suffixes « · après la belle » (score manches-(manches-1)) et « · revanche prise ! » / « · revanche manquée » selon le vainqueur (h2h avant le match), traduits dans les 4 langues', srv21.includes("m.etat !== 'pret' && m.etat !== 'en_cours' && m.etat !== 'termine' && m.etat !== 'forfait'") && srv21.includes('.filter(r => r.id < m.id)') && srv21.includes('v.h2h = h2hPourMatchs(req.club.id, v.matchs)') && idx21.includes("if (ps === m.manches - 1) parties.push('· après la belle')") && idx21.includes("((hF.v1 < hF.v2 ? m.joueur1 : m.joueur2).id === g.id ? '· revanche prise !' : '· revanche manquée')") && idx21.includes('hF.n >= 1') && cjs20.includes('"· après la belle": "· after the decider"') && cjs20.includes('"· après la belle": "· tras la bella"') && cjs20.includes('"· après la belle": "· dopo la bella"') && cjs20.includes('"· après la belle": "· nach der Belle"') && cjs20.includes('"· revanche prise !": "· revenge taken!"') && cjs20.includes('"· revanche manquée": "· revenge missed"'), '');

  // ---------- 22. Menu principal : liens tournoi masqués sans tournoi ouvert + suivi renommé ----------
  sec('22. Menu principal : liens Tableau/TV/« Mon tournoi » masqués sans tournoi ouvert');
  check('menu: liens Tableau/TV/Mon tournoi marqués « tournoi seul », retirés du burger tant qu aucun tournoi actif (ré-évalué à chaque ouverture, affichés par défaut avant réponse)', cjs20.includes("['/tableau.html', 'tableau', 'Tableau', true]") && cjs20.includes("['/tv.html', 'tv', 'TV', true]") && cjs20.includes("['/suivi.html', 'joueur', 'Mon tournoi', true]") && cjs20.includes('tournoiOuvert = !!(s && s.actif)') && cjs20.includes('tournoiSeul && tournoiOuvert === false') && cjs20.includes('catch(() => { tournoiOuvert = true; })'), '');
  check('menu: lien suivi.html renommé « Mon tournoi » (ex-« Joueur ») et traduit dans les 4 langues cibles (« Joueur » conservé pour l en-tête stats)', cjs20.includes('"Mon tournoi": "My tournament"') && cjs20.includes('"Mon tournoi": "Mi torneo"') && cjs20.includes('"Mon tournoi": "Il mio torneo"') && cjs20.includes('"Mon tournoi": "Mein Turnier"') && cjs20.includes('"Joueur": "Player"'), '');

  // ---------- 23. Audit : auteur des actions (pseudo admin) + préférences du compte non loggées ----------
  sec('23. Journal d\'audit : auteur (pseudo admin des modifications), préférences du compte non loggées, burger Compte sans emojis');
  // compte dédié au test, promu admin : ses modifications doivent être attribuées dans le journal (colonne auteur)
  // (X-Forwarded-For distinct : la limite de 5 créations de comptes / 10 min est keyée par IP, déjà consommée par Seb/Bad/AliceBT)
  const rIns23 = await fetch(BASE + '/api/compte/inscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.88' },
    body: JSON.stringify({ pseudo: 'JRNaudit', email: 'jrn@test.fr', password: '1234' }),
  });
  r = { status: rIns23.status, data: await rIns23.json().catch(() => ({})) };
  check('audit: création du compte de test JRNaudit (201)', r.status === 201, r.status + ' ' + (r.data.error || ''));
  const cJ23 = (await api('/api/admin/comptes')).data.comptes.find(x => x.pseudo === 'JRNaudit');
  r = await post(`/api/admin/compte/${cJ23.id}/role`, { role: 'admin' });
  check('audit: JRNaudit promu admin (PIN)', r.status === 200 && r.data.role === 'admin', r.status + ' ' + (r.data.error || ''));
  const login23 = async (pseudo, password) => {
    const rr23 = await fetch(BASE + '/api/compte/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pseudo, password }) });
    const sc = rr23.headers.get('set-cookie');
    return { status: rr23.status, cookie: sc ? sc.split(';')[0] : '' };
  };
  const lJ23 = await login23('JRNaudit', '1234');
  check('audit: connexion JRNaudit (session admin)', lJ23.status === 200 && !!lJ23.cookie, lJ23.status);
  const apiC23 = (p, cookie, opts = {}) => fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opts.pin ? { 'X-Admin-Pin': opts.pin } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async rr23 => ({ status: rr23.status, data: await rr23.json().catch(() => ({})) }));
  // modification faites en session admin -> auteur = pseudo dans le journal
  r = await apiC23('/api/admin/tournoi', lJ23.cookie, { method: 'POST', body: { nom: 'JourA', regle: 'blackball', taille: 16, format: 'simple', notif_push: false } });
  check('audit: création du tournoi JourA en session admin -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/audit?action=creation_tournoi');
  const evJ23 = r.data.audit.find(a => (a.apres || '').includes('JourA'));
  check('audit: auteur = JRNaudit dans le journal (colonne auteur sur creation_tournoi en session admin)', !!evJ23 && evJ23.auteur === 'JRNaudit', JSON.stringify(evJ23 && { action: evJ23.action, auteur: evJ23.auteur }));
  // même action via code PIN -> pas de pseudo (auteur null)
  await del('/api/admin/tournoi');
  r = await post('/api/admin/tournoi', { nom: 'JourB', regle: 'blackball', taille: 16, format: 'simple', notif_push: false });
  check('audit: création du tournoi JourB via code PIN -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/audit?action=creation_tournoi');
  const evP23 = r.data.audit.find(a => (a.apres || '').includes('JourB'));
  check('audit: auteur null quand l action vient du code PIN (aucun pseudo)', !!evP23 && evP23.auteur == null, JSON.stringify(evP23 && { action: evP23.action, auteur: evP23.auteur }));
  await del('/api/admin/tournoi');
  // préférences du compte : modifiables mais PLUS loggées dans l'audit
  r = await apiC23('/api/compte/preferences', lJ23.cookie, { method: 'POST', body: { notif_amis_match: false, lang: 'en' } });
  check('audit: préférences du compte modifiables (lang + notif amis -> 200)', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r = await api('/api/admin/audit?q=compte_preferences');
  check('audit: les modifications de préférences du compte ne sont plus loggées (0 entrée)', r.status === 200 && r.data.audit.length === 0, 'nb=' + r.data.audit.length);
  // sources : colonne « Par » dans le journal, auteur porté par les corrections/forfaits, colonne auteur en base, clé plate pour le burger sans emojis
  const aj23 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-journal.html'), 'utf8');
  const srv23 = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const msrc23 = fs.readFileSync(path.join(__dirname, '..', 'src', 'matchs.js'), 'utf8');
  const db23 = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
  const cpts23 = fs.readFileSync(path.join(__dirname, '..', 'src', 'comptes.js'), 'utf8');
  const idx23 = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  check('audit: sources cohérentes (colonne « Par » dans admin-journal.html, auteurAdmin(req) sur les routes et corrections/forfaits, colonne auteur en base, aucune trace compte_preferences, burger Compte sans emojis traduit)', aj23.includes("'Par'") && aj23.includes('a.auteur ||') && srv23.includes('function auteurAdmin(req)') && srv23.includes("motif || '', auteurAdmin(req))") && srv23.includes('M.declarerForfait(mid, jid, auteurAdmin(req))') && msrc23.includes('function corrigerScore(matchId, score1, score2, manches, motif, auteur)') && msrc23.includes('function declarerForfait(matchId, forfaitJoueurId, auteur)') && db23.includes('ALTER TABLE audit_log ADD COLUMN auteur TEXT') && !cpts23.includes('compte_preferences') && cjs20.includes("}, 'Compte');") && cjs20.includes("}, 'Connexion'));") && cjs20.includes("}, 'Mes matchs'));") && cjs20.includes('"Mes matchs": "My matches"') && cjs20.includes('"Connexion": "Log in"') && !cjs20.includes("'👤 Compte'") && idx23.includes('Aucun ami — ajoute-en depuis le menu Compte.'), '');

  // ---------- 24. Tableaux responsive : enveloppe .table-wrap (scroll horizontal dans le panneau) ----------
  sec('24. Tableaux responsive : enveloppe .table-wrap, bordures du panneau complètes sur petit écran');
  const css24 = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const stH24 = fs.readFileSync(path.join(__dirname, '..', 'public', 'stats.html'), 'utf8');
  const jrH24 = fs.readFileSync(path.join(__dirname, '..', 'public', 'joueur.html'), 'utf8');
  const acH24 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-comptes.html'), 'utf8');
  check('tableaux: règle .table-wrap dans style.css (overflow-x: auto, défilement fluide mobile) + table des stats enveloppée', css24.includes('.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }') && stH24.includes("el('div', { class: 'table-wrap' }, el('table', { class: 'audit' }"), '');
  check("tableaux: fiche joueur (face-à-face + historique), journal d'audit, classement du compte et comptes admin tous enveloppés .table-wrap", jrH24.includes("el('div', { class: 'table-wrap' }, tblH2H)") && jrH24.includes("el('div', { class: 'table-wrap' }, el('table', { class: 'audit' }") && aj23.includes("el('div', { class: 'table-wrap' }, el('table', { class: 'audit' }") && cjs20.includes("el('div', { class: 'table-wrap' }, el('table', { class: 'audit' }") && acH24.includes("el('div', { class: 'table-wrap' }, el('table', { style: 'width:100%;border-collapse:collapse' }"), '');

  // ---------- 25. i18n compléments : menu, stats, table de marque, tournoi admin ----------
  sec('25. i18n compléments : menu Confidentialité, en-têtes stats, boutons admin, prompts (4 langues)');
  const adm25 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const at25 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-tournoi.html'), 'utf8');
  check('i18n: menu principal — label « Confidentialitè » corrigé en « Confidentialité » et les nouveaux clés ☰ Menu / Menu traduites dans les 4 langues', !cjs20.includes("'Confidentialit\u00e8'") && cjs20.includes("'/confidentialite.html', '', 'Confidentialit\u00e9']") && cjs20.includes('"☰ Menu": "☰ Men\u00fa"') && cjs20.includes('"☰ Menu": "☰ Men\u00fc"') && cjs20.includes('"Menu": "Men\u00fa"'), '');
  check('i18n: en-têtes des stats traduits (Perdus, % victoires, 🏆 Titres, ⭐ Pts, 💥 Run-outs ×4) + table de marque (Guide admin, Historique public, 🔗 Liens publics ×4, bouton Historique (N) segmenté)', cjs20.includes('"Perdus": "Lost"') && cjs20.includes('"Perdus": "Perdidos"') && cjs20.includes('"Perdus": "Persi"') && cjs20.includes('"Perdus": "Verloren"') && cjs20.includes('"% victoires": "% wins"') && cjs20.includes('"% victoires": "% Siege"') && cjs20.includes('"🏆 Titres": "🏆 Titles"') && cjs20.includes('"⭐ Pts": "⭐ Pkt."') && cjs20.includes('"💥 Run-outs": "💥 Run-outs"') && cjs20.includes('"Guide admin": "Admin guide"') && cjs20.includes('"Guide admin": "Guía de administración"') && cjs20.includes('"Historique public": "Public history"') && cjs20.includes('"Historique public": "Historial público"') && cjs20.includes('"🔗 Liens publics": "🔗 Public links"') && adm25.includes("['Historique', ` (${adminState.historique.length})`]"), '');
  check("i18n: tournoi admin (Sauvegarde, 📍 Lieu, historique dédié, Inscrire, Corriger, Jamais (3 partout), Tableau final, Tour, Mode auto ACTIF/inactif ×4) + segmentations + window.prompt patché (Distance, Motif, correction table de marque)", at25.includes("['🗂 ', 'Historique', ` (${adminState.historique.length}) — `, 'géré dans sa page dédiée']") && at25.includes("['🏆 Champion : ', t.champion.pseudo]") && at25.includes("[m.bracket === 'WB' ? 'Tour' : m.bracket === 'LB' ? 'Loser bracket' : 'Tableau final',") && at25.includes("['Mode auto : ', autoOn ? 'ACTIF ' : 'inactif']") && at25.includes("t('🤖 Mode auto : ')") && cjs20.includes('"💾 Sauvegarde (export / import JSON)": "💾 Backup (JSON export / import)"') && cjs20.includes('"📍 Lieu": "📍 Venue"') && cjs20.includes('"📍 Lieu": "📍 Lugar"') && cjs20.includes('"📍 Lieu": "📍 Ort"') && cjs20.includes('"géré dans sa page dédiée": "managed in its dedicated page"') && cjs20.includes('"Inscrire": "Register"') && cjs20.includes('"Corriger": "Correct"') && cjs20.includes('"Jamais (3 partout)": "Never (3 everywhere)"') && cjs20.includes('"Tableau final": "Final bracket"') && cjs20.includes('"Tour": "Round"') && cjs20.includes('"🤖 Mode auto :": "🤖 Auto mode:"') && cjs20.includes('"ACTIF": "ACTIVE"') && cjs20.includes('"inactif": "inactive"') && cjs20.includes('window.prompt = (m, d) => _prompt(typeof m === \'string\' ? t(m) : m, typeof d === \'string\' ? t(d) : d)') && cjs20.includes('"Distance (3/5/7) :": "Distance (3/5/7):"') && cjs20.includes('"Motif :": "Reason:"') && cjs20.includes('"correction table de marque": "scoreboard correction"'), '');

  const histP25 = fs.readFileSync(path.join(__dirname, '..', 'public', 'historique.html'), 'utf8');
  const ahist25 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-historique.html'), 'utf8');
  check('i18n: boutons « 🗑 Supprimer » segmentés (historique public, historique de la table de marque, comptes admin) pour matcher la clé « Supprimer » ×4 langues + alerte du journal « 🗑 N entrées supprimées » traduite via t()', histP25.includes("['🗑 ', 'Supprimer']") && ahist25.includes("['🗑 ', 'Supprimer']") && acH24.includes("['🗑 ', 'Supprimer']") && !histP25.includes("'🗑 Supprimer'") && !ahist25.includes("'🗑 Supprimer'") && !acH24.includes("'🗑 Supprimer'") && aj23.includes("alert('🗑 ' + t(r.supprimes + ' entrées supprimées'))") && cjs20.includes('"Supprimer": "Delete"') && cjs20.includes('"Supprimer": "Eliminar"') && cjs20.includes('"Supprimer": "Elimina"') && cjs20.includes('"Supprimer": "Löschen"'), '');

  const duree = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = results.filter(x => x.ok === true).length;
  const ko = results.filter(x => x.ok === false);
  // ---------- 26. Infra CI/CD : app de test auto sur main, prod uniquement à la demande ----------
  const flt26 = fs.readFileSync(path.join(__dirname, '..', 'fly.test.toml'), 'utf8');
  const tw26 = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'tests.yml'), 'utf8');
  const dp26 = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy-prod.yml'), 'utf8');
  const gd26 = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_DEPLOY.md'), 'utf8');
  const rm26 = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ROADMAP.md'), 'utf8');
  const spec26 = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  check('infra: app de test ebpc-tournoi-billard-test déployée automatiquement sur la branche staging après CI verte (job deploy-test, fly.test.toml, volume tournoi_data séparé, notice et saut si FLY_TEST_TOKEN absent) + prod déployée automatiquement sur push main (intégration GitHub Fly conservée) + workflow « Déployer prod » conservé en plan B (confirmation PROD, FLY_PROD_TOKEN) + GUIDE_DEPLOY.md + SPEC/ROADMAP à jour', flt26.includes("app = 'ebpc-tournoi-billard-test'") && flt26.includes("source = 'tournoi_data'") && flt26.includes("DB_PATH = '/data/tournoi.db'") && tw26.includes('deploy-test:') && tw26.includes('fly.test.toml') && tw26.includes('refs/heads/staging') && tw26.includes('branches: [main, staging]') && tw26.includes('FLY_TEST_TOKEN') && tw26.includes('needs: tests') && dp26.includes('workflow_dispatch:') && dp26.includes('!= "PROD"') && dp26.includes('FLY_PROD_TOKEN') && dp26.includes('flyctl deploy') && gd26.includes('fly tokens create deploy -a ebpc-tournoi-billard-test') && gd26.includes('fly volumes create tournoi_data') && rm26.includes('ebpc-tournoi-billard-test') && spec26.includes('494 checks'), '');

  // ---------- 27. Roadmap : cap produit plateforme documente (centralise, separation logique) ----------
  const rm27 = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ROADMAP.md'), 'utf8');
  const spec27 = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  check('roadmap: cap produit plateforme confirme dans l en-tete + nouveaux chantiers documentes : vidéo live (embed externe puis WebRTC/HLS) + chat live modéré (modération admin, anti-flood, distinct du chat par match) + disciplines paramétrables par club (vocabulaire, format de score, règles activables) + super admin plateforme (gestion clubs, KPI globaux) + KPI enrichis santé d usage + ordre conseillé axe plateforme (20 -> 37 -> 19 -> 31 -> 36)', rm27.includes('tout centralisé, séparation logique') && rm27.includes('**Vidéo live du tournoi**') && rm27.includes('**Chat live modéré**') && rm27.includes('**Disciplines paramétrables par club**') && rm27.includes('**Super admin plateforme**') && rm27.includes("santé d'usage") && rm27.includes('cap plateforme confirmé : multi-club (20)') && spec27.includes('494 checks'), '');

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
  md += `- Rollback point-in-time (snapshots audit: has_snapshot, rollback 200/401/404, état restauré, logué, rollback avec match en cours -> pret 0-0 + table libérée) + confirm_pin requis sur suppressions admin (401 sans/mauvais code) sauf désinscription joueur + slots suivant/perdant exposés + byes exclus du classement + lancements lisibles dans l'audit\n`;
  md += `- Anti brute-force PIN admin (section 12, si TEST_BRUTEFORCE=1: 429 après N échecs par IP, lockout même pour le bon code, déblocage après délai, compteur remis à zéro au succès)\n`;
  md += `- Anti-rematch: changement manuel de joueurs vers une paire déjà jouée -> 409 hors finale (section 11) ; simu complète randomisée avec invariant anti-rematch après chaque mutation: test/simu-invariants.js\n`;
  md += `- Robustesse (section 13): /api/health, 404 JSON routes inconnues, 400 JSON malformé, 413 body >256ko, id NaN -> 404, pseudo tronqué/nettoyé, injection SQL sans effet, 20 manches en parallèle sans 500 ni double comptage\n`;
  md += `- Lot sécurité 1 (section 14): rate-limit comptes keyé sur x-forwarded-for (429 après 10 échecs sur une IP proxy, IP réelle non lockée) + session admin 8h avec bouton Verrouiller (front)\n`;
  md += `- Lot fiabilité admin (section 15): export JSON du tournoi, import avec remap des ids + FK validées au COMMIT (401 sans/bon confirm_pin, 400 invalide, 409 si actif sans replace), diff avant rollback (resume + matchs modifiés), filtre du journal ?q=/?action=\n`;
  md += `- Rôles (section 16): compte role=admin -> session suffit pour requireAdmin ET confirm_pin (destructif); sinon PIN requis (401 sans), confirm_pin requis sur destructifs; POST /api/admin/compte/:id/role (admin/user, 400 invalide)\n`;
  md += `- Multi-club (section 17): table club + backfill club_id au boot, req.club via X-Club/?club= (404 si slug inconnu, défaut sinon), GET /api/clubs, POST /api/admin/club (200/409/400), tournoi créé dans le club courant, etat/historique/audit/match/joueur scopés par club, isolation cross-club (404: lecture, suppression, saisie) — mono-club = comportement inchangé\n`;
  md += `- Multi-club PIN et réglages (section 17b): PUT /api/admin/club (nom sans confirm / pin 4-8 chiffres avec confirm_pin / actif), club inactif exclu de /api/clubs et 404 à la résolution, réactivation à distance (super-admin: PIN global ou session admin, 403 pour un simple admin de club), GET /api/admin/clubs (pin_propre/actif, jamais de hash), audit club_modifié\n`;
  md += `- Multi-club comptes et rôles (section 17c): table compte_club, rôles admin (gestion complète du club par session, confirmations levées) et operateur (routes admin ouvertes, confirmations et rôles refusés), attribution/changement/retrait par le super-admin (PUT/DELETE /api/admin/club/compte), GET /api/admin/club/comptes, /api/compte/moi expose role_club, nb_comptes dans GET /api/admin/clubs, console super-admin /console.html (création, réglages, rôles, 17i)\n`;
  md += `- Rattachement compte/joueurs anonymes (section 18): compte créé après un tournoi archivé (sans tournoi actif) rattache quand même les lignes anonymes du même pseudo (tournois passés inclus), fiche joueur + classement conservent les stats\n`;
  md += `- Fil du tournoi (section 20): chronique du tournoi dérivée de l'état (aucun stockage -> cohérente avec les tableaux, rollback et corrections inclus), lignes victoire/forfait/champion/belle, élimination définitive mentionnée uniquement en double KO (LB/F) et fusionnée dans la ligne, 3 dernières lignes + « Voir tout » sur l'accueil, horodatage relatif, dernier tournoi terminé consultable sans tournoi actif (/api/tournois/:id public), phrases i18n dans les 5 langues (clés statiques + règles dynamiques alignées I18N_DYN/REPS_DYN_*)\n`;
  md += `- Variantes, durées et revanche (section 21): phrases variées par hachage déterministe (7 variantes victoires/forfaits/champion/belles, 4 belles sans table, 6 égalités, 7 revanches underdog), durée des matchs finis dans les lignes (· durée 42 min), lignes « revanche » en direct pour les paires déjà croisées (actif.h2h, historique du club complet, underdog « une revanche à prendre », « mène X-Y », égalité), pas de double ligne si à la belle ; traces après fin (suffixes « · après la belle » et « · revanche prise ! / manquée » via h2h antérieur sur les résultats, servies aussi sur /api/tournois/:id sans tournoi actif) ; 43 règles i18n du fil alignées dans les 5 langues (cDyn = 120)\n`;
  md += `- Menu principal (section 22): liens Tableau / TV / « Mon tournoi » masqués tant qu'aucun tournoi n'est actif (ré-évalué à chaque ouverture du burger, affichés par défaut avant la réponse), lien suivi.html renommé « Mon tournoi » (ex-« Joueur »), traduit dans les 5 langues\n`;
  md += `- Journal d'audit (section 23): colonne « Par » = pseudo du compte admin à l'origine de chaque modification (null si code PIN ou action automatique, migration incluse), corrections de score et forfaits porteurs de l'auteur ; les modifications de préférences du compte (langue des push, notifs amis) ne sont plus loggées ; burger Compte sans emojis, labels traduits dans les 4 langues\n`;
  md += `- Tableaux responsive (section 24): enveloppe .table-wrap (overflow-x: auto) autour de chaque table de données (stats joueurs, fiche joueur face-à-face/historique, journal d'audit admin, classement du compte, comptes admin) : sur petit écran la table défile horizontalement à l'intérieur du panneau, les bordures du panneau englobent toujours toute la table\n`;
  md += `- i18n compléments (section 25): label « Confidentialité » du menu corrigé (traduit dans les 4 langues, ex-label fautif « Confidentialitè » impossible), burger « ☰ Menu » + aria-label traduits, en-têtes du tableau des stats (Perdus, % victoires, Titres, Pts, Run-outs), boutons de la table de marque (Guide admin, Historique public, Liens publics, Historique (N) segmenté), Sauvegarde / 📍 Lieu / « géré dans sa page dédiée » du tournoi admin, champion et zone WB/LB (Tour, Tableau final) segmentés, Mode auto ACTIF/inactif traduits, window.prompt patché (Distance, Motif, correction table de marque), boutons « 🗑 Supprimer » segmentés (historique public/admin, comptes), alerte du journal « entrées supprimées » traduite\n`;
  md += `- Infra CI/CD (section 26): flux à deux branches — staging → app de test ebpc-tournoi-billard-test auto-déployée après CI verte (job deploy-test, fly.test.toml, volume tournoi_data séparé, notice et saut si FLY_TEST_TOKEN absent) ; main → prod automatique (intégration GitHub Fly conservée), mise en prod = fusion staging vers main ; workflow « Déployer prod » en plan B (confirmation PROD, FLY_PROD_TOKEN) ; docs/GUIDE_DEPLOY.md (tokens Fly par app, restauration snapshot prod vers test)\n`;
  md += `- Roadmap cap produit (section 27): plateforme centralisée, séparation logique par club/discipline/tournoi ; nouveaux chantiers : vidéo live (34), chat live modéré (35), disciplines paramétrables par club (36), super admin plateforme (37), KPI enrichis santé d'usage (31) ; axe conseillé : 20 -> 37 -> 19 -> 31 -> 36\n`;
  md += `- i18n FR/EN/ES/IT/DE (section 19): header X-Lang (en/es/it/de) -> erreurs API traduites (Route inconnue -> Unknown route / Ruta desconocida / Percorso sconosciuto / Unbekannte Route), defaut fr inchange, couverture front complete dans common.js (~490 entrees x 4 langues cibles + ~66 regles dynamiques x 4 via I18N_ES/IT/DE + REPS_DYN, LANG multi-valeurs, t(), traduireDomStatique, X-Lang sur api() ET les appels admin, alert/confirm natifs traduits, titre de page traduit, attributs placeholder/title/aria-label/alt), selecteur de langue 5 entrees dans le bandeau (FR/EN/ES/IT/DE data-driven via LANGUES, drapeaux + libelles natifs, ancienne rangee Langue retiree de parametres.html ; interrupteurs theme alignes .pref-row, sous-sections Preferences et Notifications, sans texte d aide; checkboxes de reglages habillees en interrupteurs toggle-mini, burger compte a entrees dynamiques vers des pages dediees (login/register, parametres, amis, mes matchs, ma fiche, deconnexion, table de marque seule si role admin), append filtre les null; selecteur langue colle a l extremite droite de l ecran, sur desktop comme sur mobile <=560px (#nav flex + margin-left auto, #nav pleine largeur en colonne mobile ; listes deroulantes du bandeau alignees sur le bord droit de leur bouton ; entree Accueil ex-Tournoi du menu principal, traduite Home en EN) ; push traduits par destinataire en 5 langues (compte.lang, repli X-Lang pour le test manuel, payloads par langue dans push.js + envoyerTous versions {en,es,it,de}) ; limite restante: payload SSE restent en francais)\n`;
  fs.writeFileSync(RAPPORT, md);
  console.log(`\n=== ${passed} OK / ${failed} ÉCHEC en ${duree}s — rapport: ${RAPPORT} ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(2); });

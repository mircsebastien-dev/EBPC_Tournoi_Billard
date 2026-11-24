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
  check('2e tournoi actif désormais permis (19c) -> 200', r.status === 200 && r.data.actif && r.data.actif.tournoi.nom === 'Y', r.status); // 19c : le verrou un seul actif est retiré
  await del('/api/admin/tournoi', { body: { confirm_pin: PIN, tournoi_id: r.data.actif ? r.data.actif.tournoi.id : 0 } }); // nettoyage : Y supprimé, la suite reste mono-tournoi
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
  check('rappel inscriptions après tirage -> 404, plus d inscriptions ouvertes (19c)', r.status === 404, r.status + ' ' + (r.data.error || ''));
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
  const idxHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') // NB: pas de concat common.js ici (assertions negatives: pas de QR/emojis dans index.html);
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
  check('front: panneau Face-à-face (h2h) sur la fiche joueur, tableau plié à 5 + bouton Tout voir, adversaire cliquable + historique des matchs REPLIÉ aux 5 derniers (17m) puis paginé par pages de 20 en mode déplié (Tout voir (N) / Réduire, Précédent / Suivant, Page X / Y, bornes boutons désactivés)', joHtml.includes('Face-à-face') && joHtml.includes('H2H_MAX = 5') && joHtml.includes('Tout voir') && joHtml.includes('/joueur.html?id=${x.adversaire_id}') && joHtml.includes('HIST_MAX = 5') && joHtml.includes('HIST_PAGE = 20') && joHtml.includes('Page ${pageHist} / ${nbPagesHist}') && joHtml.includes('‹ Précédent') && joHtml.includes('Suivant ›') && joHtml.includes('btnPrevHist.disabled = pageHist <= 1') && joHtml.includes('btnNextHist.disabled = pageHist >= nbPagesHist'), '');
  // rappel inscriptions ouvertes : bouton admin (phase inscription)
  const atHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-tournoi.html'), 'utf8');
  check('front: bouton Rappel inscriptions ouvertes (admin-tournoi, phase inscription)', atHtml.includes('rappel-inscriptions') && atHtml.includes('Rappel inscriptions ouvertes') && atHtml.includes('rappelInscriptions'), '');
  // affiche du prochain tournoi (poster auto-généré, phase inscription)
  check('front: affiche tournoi à venir (poster) : eyebrow + jauge inscrits, sans QR ni emojis', idxHtml.includes('poster-eyebrow') && idxHtml.includes('poster-bar') && idxHtml.includes('restantes') && idxHtml.includes('Inscriptions ouvertes') && !idxHtml.includes('/api/qrcode.svg') && !idxHtml.includes('📅') && !idxHtml.includes('📍') && idxHtml.includes('urlEtat19a()'), '');
  // re-sync SSE robuste : re-fetch à la reconnexion du flux et au retour visible sur la page
  const cjsCommon = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
  check('front: SSE re-sync au retour sur la page (visibilitychange) et à la reconnexion (open) + 19a sélecteur de tournoi du bandeau (urlEtat19a, bouton si plusieurs actifs)', cjsCommon.includes('visibilitychange') && cjsCommon.includes("addEventListener('open'") && cjsCommon.includes('!document.hidden') && cjsCommon.includes('btnTournoi19a') && cjsCommon.includes('urlEtat19a') && cjsCommon.includes('tournoisNav19a'), '');
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
  const scl17c = fs.readFileSync(path.join(__dirname, '..', 'public', 'super-clubs.html'), 'utf8'); // 17i v3: page dédiée Clubs de la plateforme
  const spec17z = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8'); // 17z: modale fiche staff console
  const ga17z = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_ADMIN.md'), 'utf8'); // 17z
  const rm17z = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ROADMAP.md'), 'utf8'); // 17z
  const admHtml17c = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const admCpt17c = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-comptes.html'), 'utf8');
  check('front: pages dédiées de la console (17i v3): /super-clubs.html (création, réglages club par slug cible, X-Club par appel, table-wrap, rôles admin/operateur) + hub console vers les pages + lien Console depuis l accueil admin (17i)', scl17c.includes("clubApi('/api/admin/club/comptes', slug") && scl17c.includes("'/api/super/club', { method: 'PUT', body: JSON.stringify({ slug: c.slug") && scl17c.includes('table-wrap') && consHtml17c.includes('/super-clubs.html') && consHtml17c.includes('/super-base.html') && admHtml17c.includes("href: '/console.html'")
    // 17z: modale « Fiche » du staff du panneau Rôles du club (changement de rôle en un geste, retrait, fiche plateforme)
    && scl17c.includes('openFicheCompteConsole') && scl17c.includes('👤 Fiche')
    && spec17z.includes('17z. Modale fiche compte dans la console super-admin')
    && ga17z.includes('Modale « Fiche » du staff (17z)')
    && rm17z.includes('| 63 |') && rm17z.includes('Modale fiche compte (17z)'), '');
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
  check('front: bouton Supprimer sur chaque ligne sauf le club par défaut (confirmation destructive, routes super 17i)', scl17c.includes("adminApiDestructif('/api/super/club', { method: 'DELETE'") && scl17c.includes('rowClub(c, i === 0)'), '');
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
  const importE17d = { status: r.status, data: r.data }; // résultat du premier import: chaque table retrouve exactement ses lignes
  // 17d v2: régression sauvegarde ANCIENNE (générée avant 17f) = lignes de compte SANS club_id -> l import les
  // rattache au club par défaut de la sauvegarde (MIN des ids, règle de la migration 17f), comme une prod ancienne
  // (une vraie sauvegarde ancienne contient TOUTES les tables, réglages inclus: on garde settings sinon le hash du code est éphémèrement absent)
  const Eanc17d = { sauvegarde: E.sauvegarde, tables: { club: E.tables.club, settings: E.tables.settings, compte: E.tables.compte.map((c) => { const s = JSON.parse(JSON.stringify(c)); delete s.club_id; return s; }) } };
  const vusAnc17d = new Set();
  Eanc17d.tables.compte = Eanc17d.tables.compte.filter((c) => { const k = String(c.pseudo || '').toLowerCase() + '|' + String(c.email || '').toLowerCase(); if (vusAnc17d.has(k)) return false; vusAnc17d.add(k); return true; }); // UNIQUE (club_id, pseudo/email) du club par défaut
  r = await post('/api/admin/base/import', { payload: Eanc17d, confirm_pin: PIN });
  const ancienne17d = { status: r.status, err: (r.data && r.data.error) || '', nb: r.data && r.data.tables && r.data.tables.compte };
  r = await post('/api/admin/base/import', { payload: E, confirm_pin: PIN }); // retour exact à l instantané: la suite continue à l identique
  check('import base: 200 + ok (base restaurée) + sauvegarde ANCIENNE (avant 17f, comptes sans club_id) acceptée pareil', importE17d.status === 200 && importE17d.data && importE17d.data.ok === true && r.status === 200 && r.data.ok === true && ancienne17d.status === 200 && ancienne17d.nb === Eanc17d.tables.compte.length && Eanc17d.tables.compte.length > 0, r.status + ' ' + (r.data.error || '') + ' ancienne:' + ancienne17d.status + ' ' + ancienne17d.err);
  const apres17d = (importE17d.data && importE17d.data.tables) || {};
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
  const sb17d = fs.readFileSync(path.join(__dirname, '..', 'public', 'super-base.html'), 'utf8'); // 17i v3: page dédiée Base de la plateforme
  check('front: 💾 sauvegarde base dans la page dédiée /super-base.html (17i v3: export téléchargeant, import fichier avec confirmation destructible, 17i) + lien depuis le hub console', sb17d.includes('/api/super/base/export') && sb17d.includes('/api/super/base/import') && sb17d.includes('Télécharger la sauvegarde (JSON)') && sb17d.includes('Restaurer depuis un fichier') && sb17d.includes('adminApiDestructif') && consHtml17d.includes('/super-base.html'), '');
  const spec17d = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  const ga17d = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_ADMIN.md'), 'utf8');
  const srv17d = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  check("doc: SPEC 17d + GUIDE_ADMIN dédié + serveur (requireSuperAdmin sur export/import, limite 25mb sur l import UNIQUEMENT) + compat sauvegardes anciennes pre-17f", spec17d.includes('17d. Sauvegarde complète de la base') && spec17d.includes('564 checks') && spec17d.includes('rattachées au club par défaut de la sauvegarde') && srv17d.includes('même règle que la migration 17f au boot') && ga17d.includes('Sauvegarde / restauration de la base') && srv17d.includes("app.use('/api/admin/base/import', express.json({ limit: '25mb' }))") && srv17d.includes("app.get('/api/admin/base/export', requireAdmin, requireSuperAdmin") && srv17d.includes("app.post('/api/admin/base/import', requireAdmin, requireConfirmPin, requireSuperAdmin"), '');

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
  check('doc: SPEC 17e + GUIDE_ADMIN club + serveur (export-club/import-club SANS requireSuperAdmin: un code de club sauvegarde/restaure SON club, limite 25mb)', spec17e.includes('17e. Sauvegarde des données du club') && spec17e.includes('564 checks') && ga17e.includes('Données du club : sauvegarde / restauration') && srv17e.includes("app.get('/api/admin/base/export-club', requireAdmin") && srv17e.includes("app.post('/api/admin/base/import-club', requireAdmin, requireConfirmPin") && srv17e.includes("app.use('/api/admin/base/import-club', express.json({ limit: '25mb' }))"), '');

  // ---------- 17f/17u. Compte plateforme (pseudo et email uniques sur TOUTE la plateforme, club d origine a la creation) ----------
  sec('17f/17u. Compte plateforme (pseudo et email uniques TOUTE la plateforme, club d origine conservé, le compte sert dans tous les clubs)');
  r = await post('/api/admin/club', { slug: 'clubvm', nom: 'Club VM', pin: '5678' });
  check('clubvm créé avec son PIN (2e club avec PIN pour tester le compte plateforme)', r.status === 200 && r.data.club && r.data.club.slug === 'clubvm', r.status + ' ' + (r.data.error || ''));
  const xhr17f = (p17f, xff, opts = {}) => fetch(BASE + p17f, {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff, ...(opts.club ? { 'X-Club': opts.club } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async r17 => ({ status: r17.status, data: await r17.json().catch(() => ({})), cookie: r17.headers.get('set-cookie') }));
  let r17f = await xhr17f('/api/compte/inscription', '203.0.113.101', { club: 'clubsb', body: { pseudo: 'MembreSb', email: 'membre.sb@clubsb.test', password: '1234' } });
  check('compte créé DEPUIS le contexte du club clubsb -> 201 (club d origine figé a la creation)', r17f.status === 201 && r17f.data.compte && r17f.data.compte.pseudo === 'MembreSb', r17f.status + ' ' + (r17f.data.error || ''));
  r = await api('/api/admin/comptes', { club: 'clubsb', pin: '4321' });
  check('le compte est VISIBLE dans la liste des comptes de SON club d origine (table de marque, code PIN du club)', r.status === 200 && r.data.comptes.some(c => c.pseudo === 'MembreSb'), 'n=' + r.data.comptes.length);
  r = await api('/api/admin/comptes', { club: 'clubvm', pin: '5678' });
  check('le compte reste INVISIBLE dans la liste d un autre club (club d origine conservé, aucune liaison implicite)', r.status === 200 && !r.data.comptes.some(c => c.pseudo === 'MembreSb'), 'n=' + r.data.comptes.length);
  r = await api('/api/admin/comptes?tous=1', {});
  check('super-admin (code global): vue tous clubs EXPLICITE (?tous=1) -> MembreSb (clubsb) visible', r.status === 200 && r.data.comptes.some(c => c.pseudo === 'MembreSb'), '');
  r17f = await xhr17f('/api/compte/inscription', '203.0.113.102', { club: 'clubvm', body: { pseudo: 'MembreSb', email: 'membre.sb@clubvm.test', password: '1234' } });
  check('inscription du même pseudo depuis un AUTRE club -> 409 « déjà utilisé sur la plateforme » (pseudo réservé TOUTE la plateforme)', r17f.status === 409 && String(r17f.data.error || '').includes('déjà utilisé sur la plateforme'), r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/inscription', '203.0.113.103', { club: 'clubvm', body: { pseudo: 'AutreVm', email: 'membre.sb@clubsb.test', password: '1234' } });
  check('inscription avec l email d un compte d un autre club -> 409 (email réservé TOUTE la plateforme)', r17f.status === 409, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/inscription', '203.0.113.104', { club: 'clubvm', body: { pseudo: 'AutreSb', email: 'autre.sb@clubvm.test', password: '1234' } });
  check('inscription depuis clubvm avec pseudo + email inedits -> 201 (nouveau compte, club d origine = clubvm)', r17f.status === 201 && r17f.data.compte && r17f.data.compte.pseudo === 'AutreSb', r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/connexion', '203.0.113.105', { club: 'clubsb', body: { pseudo: 'MembreSb', password: '1234' } });
  const cookieMembreSb = (r17f.cookie || '').split(';')[0];
  check('connexion depuis SON club d origine -> 200 + session', r17f.status === 200 && !!cookieMembreSb, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/connexion', '203.0.113.106', { club: 'clubvm', body: { pseudo: 'MembreSb', password: '1234' } });
  const cookieMembreSbVm = (r17f.cookie || '').split(';')[0];
  check('connexion du MÊME compte depuis un AUTRE club -> 200 + session distincte (compte plateforme, plus de jumeaux par club)', r17f.status === 200 && !!cookieMembreSbVm && cookieMembreSbVm !== cookieMembreSb, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/oubli', '203.0.113.107', { club: 'clubvm', body: { email: 'membre.sb@clubsb.test' } });
  check('oubli DEPUIS un autre club que le club d origine -> compte trouvé (recherche GLOBALE via email, dev_reset_link en dev)', r17f.status === 200 && !!r17f.data.dev_reset_link, JSON.stringify({ status: r17f.status, lien: !!r17f.data.dev_reset_link }));
  r17f = await xhr17f('/api/compte/oubli', '203.0.113.108', { club: 'clubvm', body: { email: 'personne@nulle-part.test' } });
  check('oubli pour un email SANS compte -> réponse générique sans lien (anti-énumération conservée)', r17f.status === 200 && !r17f.data.dev_reset_link, r17f.status + ' ' + (r17f.data.error || ''));
  r17f = await xhr17f('/api/compte/connexion', '203.0.113.109', { club: 'clubvm', body: { pseudo: 'Seb', password: 'nouveau1' } });
  check('connexion d un compte du club défaut depuis clubvm -> 200 (compte plateforme utilisable depuis tous les clubs)', r17f.status === 200 && r17f.data.compte && r17f.data.compte.pseudo === 'Seb', r17f.status + ' ' + (r17f.data.error || ''));
  r = await api('/api/admin/comptes', { club: 'clubvm', pin: '5678' });
  check('aucune liaison implicite: Seb reste absent de la marque de clubvm (club d origine inchangé)', !r.data.comptes.some(c => c.pseudo === 'Seb'), '');
  r = await post('/api/admin/tournoi', { nom: 'ClubVM-T', regle: 'blackball', taille: 16, format: 'simple', notif_push: false }, { club: 'clubvm', pin: '5678' });
  check('tournoi ClubVM-T créé dans clubvm (pour l inscription cross-club au tournoi)', r.status === 200, r.status + ' ' + (r.data.error || ''));
  r17f = await xhr17f('/api/tournoi/inscrire', '203.0.113.110', { club: 'clubvm', cookie: cookieMembreSb, body: {} });
  const moiVm17x = await xhr17f('/api/compte/moi', '203.0.113.132', { method: 'GET', club: 'clubvm', cookie: cookieMembreSb });
  const moiSb17x = await xhr17f('/api/compte/moi', '203.0.113.133', { method: 'GET', club: 'clubsb', cookie: cookieMembreSb });
  // 19b: privilèges et visibilité scopés au club organisateur
  const marqueVm19b = await api('/api/admin/comptes', { club: 'clubvm', pin: '5678' });
  const mbVm19b = marqueVm19b.data && Array.isArray(marqueVm19b.data.comptes) ? marqueVm19b.data.comptes.find(c => c.pseudo === 'MembreSb') : null;
  const promoMb19b = await put('/api/admin/club/compte', { pseudo: 'MembreSb', role: 'operateur' }, { pin: '5678', club: 'clubvm' });
  const retireMb19b = await api('/api/admin/club/compte', { method: 'DELETE', pin: '5678', club: 'clubvm', body: { compte_id: promoMb19b.data ? promoMb19b.data.compte_id : 0, confirm_pin: '5678' } });
  const connAlice19b = await xhr17f('/api/compte/connexion', '203.0.113.134', { club: 'clubvm', body: { pseudo: 'AliceBT', password: '1234' } });
  const admVm19b = await xhr17f('/api/admin/comptes', '203.0.113.135', { method: 'GET', club: 'clubvm', cookie: (connAlice19b.cookie || '').split(';')[0] });
  check('inscription au tournoi d un AUTRE club avec sa session (MembreSb, origine clubsb) -> 201 (compte plateforme, plus de refus club d origine) + 17x joueur_id de moi scopé au club OUVERT (clubvm -> le joueur inscrit au tournoi ClubVM-T, clubsb sans joueur du compte -> null, plus de joueur d un autre club pointé) + 19b: le club organisateur voit son inscrit (table de marque clubvm) et lui accorde un rôle local (promotion opérateur par le code du club puis retrait 200) + session d un compte admin GLOBAL (AliceBT, club d origine défaut) sur les routes admin de clubvm -> 401 (privilèges scopés au club)', r17f.status === 201 && r17f.data.joueur && r17f.data.joueur.pseudo === 'MembreSb' && moiVm17x.status === 200 && moiVm17x.data.joueur_id === r17f.data.joueur.id && moiSb17x.status === 200 && moiSb17x.data.joueur_id === null && marqueVm19b.status === 200 && !!mbVm19b && promoMb19b.status === 200 && promoMb19b.data.role === 'operateur' && retireMb19b.status === 200 && admVm19b.status === 401, r17f.status + ' 19b marque=' + marqueVm19b.status + ' vm=' + !!mbVm19b + ' promo=' + promoMb19b.status + ' retrait=' + retireMb19b.status + ' adminVm=' + admVm19b.status + ' ' + JSON.stringify({ moiVm17x: moiVm17x.data.joueur_id, moiSb17x: moiSb17x.data.joueur_id }));
  r17f = await xhr17f('/api/joueur', '203.0.113.111', { club: 'clubvm', body: { pseudo: 'MembreSb' } });
  check('pseudo MembreSb réservé en anonyme depuis clubvm -> 409 compte_pseudo (réservation GLOBALE)', r17f.status === 409 && r17f.data.compte_pseudo === true, r17f.status + ' ' + (r17f.data.error || ''));
  await post('/api/admin/tournoi', { nom: 'Sb-Open', regle: 'blackball', taille: 16, format: 'simple', notif_push: false }, { club: 'clubsb', pin: '4321' });
  // 19a: lecture multi-tournois : ?tournoi_id= replié au club OUVERT + actifs du club seul (sélecteur du bandeau)
  const tvm19a = (await api('/api/tournois', { club: 'clubvm', pin: null })).data.tournois.find(t => t.nom === 'ClubVM-T');
  const tsb19a = (await api('/api/tournois', { club: 'clubsb', pin: null })).data.tournois.find(t => t.nom === 'Sb-Open');
  const etatVm19a = await api('/api/etat?tournoi_id=' + (tsb19a && tsb19a.id), { club: 'clubvm', pin: null });
  r17f = await xhr17f('/api/joueur', '203.0.113.112', { club: 'clubsb', body: { pseudo: 'AutreSb' } });
  check('pseudo AutreSb (compte d origine clubvm) réservé en anonyme depuis clubsb -> 409 compte_pseudo (réservation GLOBALE, plus d anonyme cross-club) + 19a /api/etat?tournoi_id= scopé au club OUVERT (tournoi de clubsb ciblé depuis clubvm -> repli sur le tournoi actif de clubvm, actifs du club seul, aucune fuite d un autre club)', r17f.status === 409 && r17f.data.compte_pseudo === true && !!tvm19a && !!tsb19a && etatVm19a.status === 200 && !!etatVm19a.data.actif && etatVm19a.data.actif.tournoi.id === tvm19a.id && Array.isArray(etatVm19a.data.actifs) && etatVm19a.data.actifs.length === 1 && etatVm19a.data.actifs[0].id === tvm19a.id, r17f.status + ' ' + (r17f.data.error || '') + ' actif=' + (etatVm19a.data.actif && etatVm19a.data.actif.tournoi.id) + ' actifs=' + (etatVm19a.data.actifs || []).map(a => a.id).join(','));
  await del('/api/admin/tournoi', { club: 'clubvm' }).catch(() => {});
  await del('/api/admin/tournoi', { club: 'clubsb' }).catch(() => {});
  const spec17f = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  const ga17f = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_ADMIN.md'), 'utf8');
  const gu17u = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_UTILISATEUR.md'), 'utf8');
  const rm17u = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ROADMAP.md'), 'utf8');
  const db17f = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
  const srv17f = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const cpt17f = fs.readFileSync(path.join(__dirname, '..', 'src', 'comptes.js'), 'utf8');
  check('doc: SPEC 17u (bullet compte plateforme + entrée tests 17f/17u) + GUIDE_ADMIN 9.1 + GUIDE UTILISATEUR + ROADMAP (un seul compte partout)', spec17f.includes('17u. Compte plateforme (un compte pour tous les clubs)') && spec17f.includes('564 checks') && spec17f.includes('comptes et compte plateforme (sections 17f/17u') && ga17f.includes('Compte plateforme (multi-club, 17u)') && ga17f.includes('Un seul compte pour toute la plateforme') && gu17u.includes('un seul compte') && rm17u.includes('Compte plateforme (17u)')
    && spec17f.includes('17x. Fiche joueur du compte scopée au club ouvert')
    && spec17f.includes('19a. Sélecteur de tournoi dans le bandeau')
    && rm17u.includes('| 58 |')
    && rm17u.includes('| 59 |')
    && spec17f.includes('19b. Privilèges et visibilité des comptes scopés au club')
    && rm17u.includes('| 60 |'), '');
  check('doc: db compte plateforme (index uniques pseudo/email sur TOUTE la plateforme + fusion automatique des jumeaux)', db17f.includes('idx17u_pseudo') && db17f.includes('idx17u_email') && db17f.includes('reparerComptes17u') && db17f.includes('fusion des comptes jumeaux'), '');
  check('doc: serveur + comptes plateforme (compteAvecPseudo global, inscription/connexion/oubli globaux, inscription tournoi cross-club)', srv17f.includes('compteAvecPseudo(pseudo)') && srv17f.includes('reparerComptes17u') && cpt17f.includes('déjà utilisé sur la plateforme') && cpt17f.includes('SELECT id FROM compte WHERE pseudo = ? COLLATE NOCASE OR email = ? COLLATE NOCASE') && cpt17f.includes('SELECT * FROM compte WHERE pseudo = ? COLLATE NOCASE') && !cpt17f.includes('compte introuvable dans ce club') && !cpt17f.includes('appartient à un autre club')
    && cpt17f.includes('17x')
    && cpt17f.includes('SELECT j.id FROM joueur j JOIN tournoi t ON t.id = j.tournoi_id')
    && srv17f.includes('cible19a')
    && srv17f.includes('tournoi WHERE id = ? AND club_id = ? AND statut IN'), '');

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
  r = await put('/api/admin/club/compte', { pseudo: 'MembreSb', role: 'admin' }, { pin: '5678', club: 'clubvm' });
  check('isolation 17f étendue: le PIN de clubvm ne promeut qu un compte DU club (MembreSb est d origine clubsb, pas clubvm) -> 404 introuvable dans ce club', r.status === 404 && String(r.data.error || '').includes('dans ce club'), r.status + ' ' + (r.data.error || ''));
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
  const rm17y = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ROADMAP.md'), 'utf8'); // 17y: modales de gestion, docs
  const at17y = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-tournoi.html'), 'utf8'); // 17y: modale fiche joueur des inscriptions
  check('doc: SPEC 17g + GUIDE_ADMIN + serveur (PIN du club suffit: adminViaPin club, cible DU club, peut_gerer_roles) + front (chips + sélecteur rôle club + 19b: badge plateforme explicite, sélecteur étendu aux comptes présents)', spec17g.includes('17g. Promotion admin du club') && spec17g.includes('564 checks') && ga17g.includes('👑 Rôle club') && srv17g.includes("req.adminViaPin === 'club'") && srv17g.includes('introuvable dans ce club') && srv17g.includes('peut_gerer_roles') && adm17g.includes('👑 Club : admin') && adm17g.includes('role_club')
    && adm17g.includes('admin plateforme') // 19b: badge et bouton plateforme explicites, ne se confondent plus avec un rôle club
    && !adm17g.includes('c.club_id === clubCtx.id') // 19b: sélecteur de rôle proposé pour tous les comptes présents du club (la liste est déjà scopée par le serveur)
    && ga17g.includes('tous les comptes PRÉSENTS')
    // 17y: modales de gestion (fiche joueur des inscriptions, fiche compte du club), actions regroupées hors du tableau, serveur inchangé
    && spec17g.includes('17y. Modales de gestion (fiche joueur, fiche compte du club)')
    && ga17g.includes('Modales de gestion joueurs / comptes (17y)')
    && rm17y.includes('| 62 |') && rm17y.includes('Modales de gestion (17y)')
    && adm17g.includes('openFicheCompte') && adm17g.includes('👤 Fiche')
    && at17y.includes('openFicheJoueur') && at17y.includes('marquer payé') && at17y.includes('payé annuler') && at17y.includes('Retirer du tournoi'), '');

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
  const supc17h = fs.readFileSync(path.join(__dirname, '..', 'public', 'super-comptes.html'), 'utf8'); // 17i v2: page dédiée de la vue tous comptes
  const rm17h = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ROADMAP.md'), 'utf8');
  check('doc: SPEC 17h + serveur (scoping inconditionnel + ?tous=1 super-admin) + front (panneau tous comptes de la plateforme dans la console, 17i + page dédiée /super-comptes.html 17i v2 : filtres club d attachement / rôle / recherche + fiche complète)', spec17h.includes('17h. Tenant principal cloisonné') && spec17h.includes('564 checks') && srv17h.includes('tous = superAdminSoumis(req) && String(req.query.tous') && cons17h.includes('/api/super/comptes') && cons17h.includes('Comptes de la plateforme')
    && cons17h.includes('/super-comptes.html') // 17i v2: accès rapide de la console vers la page dédiée + décompte par club d attachement
    && spec17h.includes('super-comptes.html') // 17i v2: la SPEC 17i documente la page dédiée
    && supc17h.includes("Club d'attachement") && supc17h.includes('/api/super/comptes') // 17i v2: liste filtrable par club d attachement, même vue plateforme
    && supc17h.includes('/api/super/compte/') && supc17h.includes('/api/admin/club/compte') // 17i v2: fiche complète (rôle plateforme + rôles club attribués/retirés)
    && rm17h.includes('| 61 |')
    && supc17h.includes('openFicheModal') && !supc17h.includes('zone-fiche') // 17i v3: la fiche s ouvre en modale, plus en pied de page
    && spec17h.includes('17i v3. Console en pages dédiées') // 17i v3: la SPEC documente l éclatement de la console
    && rm17h.includes('| 64 |'), '');

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
  const mb17i = r.data.comptes ? r.data.comptes.find(c => c.pseudo === 'MembreSb' && c.club_slug === 'clubsb') : null; // 17f: le pseudo MembreSb existe dans 2 clubs, qualifier par club_slug
  const chef17i = r.data.comptes ? r.data.comptes.find(c => c.pseudo === 'ChefVm' && c.club_slug === 'clubvm') : null;
  check('17i: GET /api/super/comptes -> 200, vue plateforme: MembreSb (clubsb) ET ChefVm (clubvm) d origines distinctes + Seb, tous=true', r.status === 200 && r.data.tous === true && !!mb17i && !!chef17i && r.data.comptes.some(c => c.pseudo === 'Seb'), 'n=' + (r.data.comptes || []).length);
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
  check('doc: SPEC 17i + serveur (zone /api/super/* sans club, rôle super_admin) + console.html (panneaux clubs/comptes/base) + clubs.html redirigé + menus (Console) + admin-data épuré (base partie dans la console) + GUIDE', spec17i.includes('17i. Console super-admin') && spec17i.includes('564 checks') && srv17i.includes('requireSuperZone') && srv17i.includes("'super_admin'") && cons17i.includes('/api/super/comptes') && cons17i.includes('Comptes de la plateforme') && clubsHtml17i.includes('/console.html') && adm17i.includes("href: '/console.html'") && !adH17i.includes('panelSauvegardeBase') && adH17i.includes('panelSauvegardeClub') && adH17i.includes('Console super-admin') && ga17i.includes('Console super-admin'), '');

  // ---------- 17j. Personnalisation du club : accent + défauts de tournoi ----------
  sec('17j. Personnalisation du club: accent visible par tous + défauts tournoi (nom/jour/heure), panneau admin + console');
  r = await api('/api/admin/club/prefs', { pin: '5678', club: 'clubvm' });
  check('17j: GET /api/admin/club/prefs (PIN du club) -> 200, réglages par défaut jamais configurés', r.status === 200 && r.data.prefs && r.data.prefs.accent === '#d6336c' && r.data.prefs.defaut_nom === '' && r.data.prefs.defaut_jour === null && r.data.prefs.defaut_heure === '20:00', r.status + ' ' + JSON.stringify(r.data));
  r = await put('/api/admin/club/prefs', { accent: '#zzzzzz' }, { pin: '5678', club: 'clubvm' });
  check('17j: PUT prefs couleur non hexadécimale -> 400 (format #rrggbb exigé)', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await put('/api/admin/club/prefs', { defaut_jour: 7 }, { pin: '5678', club: 'clubvm' });
  const r17jH = await put('/api/admin/club/prefs', { defaut_heure: '25:00' }, { pin: '5678', club: 'clubvm' });
  check('17j: PUT prefs jour/heure hors bornes -> 400 (jour 7, heure 25:00, jamais écrits)', r.status === 400 && r17jH.status === 400, JSON.stringify([r.status, r17jH.status]));
  r = await put('/api/admin/club/prefs', { accent: '#e63946', defaut_nom: 'Open du Mercredi', defaut_jour: 2, defaut_heure: '20:30' }, { pin: '5678', club: 'clubvm' });
  check('17j: PUT prefs SANS confirm_pin (geste non sensible) -> 200: accent + nom + jour + heure enregistrés', r.status === 200 && r.data.prefs && r.data.prefs.accent === '#e63946' && r.data.prefs.defaut_nom === 'Open du Mercredi' && r.data.prefs.defaut_jour === 2 && r.data.prefs.defaut_heure === '20:30', r.status + ' ' + JSON.stringify(r.data));
  r17f = await xhr17f('/api/club-theme', '203.0.113.128', { method: 'GET', club: 'clubvm' });
  check('17j: GET /api/club-theme public (visiteur sans aucun code) -> 200, accent du club servi à tous', r17f.status === 200 && r17f.data.slug === 'clubvm' && r17f.data.accent === '#e63946', r17f.status + ' ' + JSON.stringify(r17f.data));
  r = await api('/api/etat', { pin: null, club: 'clubvm' });
  check('17j: /api/etat expose club.accent (publique, contexte club résolu sans code)', r.status === 200 && r.data.club && r.data.club.accent === '#e63946' && r.data.club.slug === 'clubvm', JSON.stringify(r.data.club || {}));
  r = await api('/api/etat', { pin: null });
  check('17j: isolation: le tenant principal garde l accent d origine (clubvm ne fuit pas sur ebpc)', r.status === 200 && r.data.club && r.data.club.slug === 'ebpc' && r.data.club.accent === '#d6336c', JSON.stringify(r.data.club || {}));
  r = await put('/api/admin/club/prefs', { accent: '#2a9d8f', slug: 'clubsb' }, { pin: '5678', club: 'clubvm' });
  check('17j: le PIN de clubvm ne peut pas modifier la personnalisation d un AUTRE club (body.slug clubsb) -> 403', r.status === 403, r.status + ' ' + (r.data.error || ''));
  r = await put('/api/admin/club/prefs', { accent: '#2a9d8f', defaut_nom: 'Open du Samedi', defaut_jour: 6, defaut_heure: '19:00', slug: 'clubsb' }, { pin: PIN });
  check('17j: le super-admin règle la personnalisation d un autre club à distance (body.slug, code global) -> 200', r.status === 200 && r.data.slug === 'clubsb' && r.data.prefs && r.data.prefs.accent === '#2a9d8f' && r.data.prefs.defaut_jour === 6, r.status + ' ' + JSON.stringify(r.data));
  r17f = await xhr17f('/api/club-theme', '203.0.113.129', { method: 'GET', club: 'clubsb' });
  check('17j: GET /api/club-theme clubsb -> accent personnalisé servi publiquement (chaque club a le sien)', r17f.status === 200 && r17f.data.accent === '#2a9d8f', r17f.status + ' ' + JSON.stringify(r17f.data));
  await put('/api/admin/club/compte', { pseudo: 'ChefVm', role: 'admin' }, { pin: '5678', club: 'clubvm' });
  r17f = await xhr17f('/api/compte/connexion', '203.0.113.130', { club: 'clubvm', body: { pseudo: 'ChefVm', password: '1234' } });
  const cookieChef17j = (r17f.cookie || '').split(';')[0];
  r17f = await xhr17f('/api/admin/club/prefs', '203.0.113.130', { method: 'GET', club: 'clubvm', cookie: cookieChef17j });
  check('17j: la SESSION admin du club (ChefVm, sans PIN) lit la personnalisation -> 200 (panneau Apparence de l accueil admin)', r17f.status === 200 && r17f.data.prefs && r17f.data.prefs.accent === '#e63946', r17f.status + ' ' + JSON.stringify(r17f.data));
  r17f = await xhr17f('/api/admin/club/prefs', '203.0.113.130', { method: 'PUT', club: 'clubvm', cookie: cookieChef17j, body: { accent: '#ffb703' } });
  check('17j: PUT prefs par la SESSION admin du club -> 200 (accent changé sans code, défauts conservés)', r17f.status === 200 && r17f.data.prefs && r17f.data.prefs.accent === '#ffb703' && r17f.data.prefs.defaut_nom === 'Open du Mercredi', r17f.status + ' ' + JSON.stringify(r17f.data));
  r = await put('/api/admin/club/prefs', { accent: '#d6336c', defaut_nom: '', defaut_jour: null, defaut_heure: '20:00' }, { pin: '5678', club: 'clubvm' });
  r17f = await xhr17f('/api/club-theme', '203.0.113.131', { method: 'GET', club: 'clubvm' });
  check('17j: réinitialisation clubvm -> 200, /api/club-theme redescendu au rose d origine (état propre)', r.status === 200 && r17f.status === 200 && r17f.data.accent === '#d6336c', JSON.stringify([r.status, r17f.data]));
  const r17jRz = await put('/api/admin/club/prefs', { accent: '#d6336c', defaut_nom: '', defaut_jour: null, defaut_heure: '20:00', slug: 'clubsb' }, { pin: PIN });
  const chefId17j = (await api('/api/admin/club/comptes', { pin: '5678', club: 'clubvm' })).data.comptes.find(c => c.pseudo === 'ChefVm');
  r = await api('/api/admin/club/compte', { method: 'DELETE', pin: '5678', club: 'clubvm', body: { compte_id: chefId17j.compte_id, confirm_pin: '5678' } });
  check('17j: réinitialisation clubsb par le super-admin -> 200 + retrait du rôle de ChefVm (nettoyage)', r17jRz.status === 200 && r.status === 200, JSON.stringify([r17jRz.status, r.status]));
  const cjs17j = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
  const adm17j = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const at17j = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-tournoi.html'), 'utf8');
  const cons17j = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.html'), 'utf8');
  const scl17j = fs.readFileSync(path.join(__dirname, '..', 'public', 'super-clubs.html'), 'utf8'); // 17i v3: la personnalisation club de la console vit ici
  check('17j: front — common.js applique l accent du club aux variables CSS (--pink/-fort/soft/glow, --pink-soft recalculée en HSL LISIBLE quel que soit l accent et le thème, --pink-fort (fonds de boutons à texte blanc) plafonnée à 45 % de luminosité sinon un accent blanc rend les libellés invisibles: scores/liens/boutons jamais invisibles), cache anti-flash ebpc_accent_club, rafraîchi par /api/club-theme APPELÉ après const LANG (régression TDZ: LANG inaccessible sinon), page TV exclue', cjs17j.includes('appliquerAccentClub') && cjs17j.includes('accentVersHsl') && cjs17j.includes("'--pink'") && cjs17j.includes("'--pink-fort'") && cjs17j.includes('Math.min(l, 0.45)') && cjs17j.includes('ebpc_accent_club') && cjs17j.includes('/api/club-theme') && cjs17j.includes("location.pathname.startsWith('/tv.html')") && cjs17j.indexOf('rafraichirThemeClub();') > cjs17j.indexOf('const LANG ='), '');
  const apa17l = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-apparence.html'), 'utf8'); // 17l: page dédiée Apparence (l accueil admin ne porte plus le panneau)
  check('17j/17l: front — 🎨 Apparence du club dans SA PAGE DÉDIÉE /admin-apparence.html (color picker + nom + jour + heure + adresse, adminApi sans confirmation, même écran de code que les pages admin), bouton d accès conservé sur l accueil admin', adm17j.includes('Apparence du club') && adm17j.includes("href: '/admin-apparence.html'") && !adm17j.includes('panel-apparence') && apa17l.includes('Apparence du club') && apa17l.includes("id: 'pref-accent'") && apa17l.includes("type: 'color'") && apa17l.includes('pref-nom') && apa17l.includes('pref-jour') && apa17l.includes('pref-heure') && apa17l.includes('pref-adresse') && apa17l.includes('/api/admin/club/prefs') && apa17l.includes('chargerPrefsApparence') && apa17l.includes('enregPrefsApparence') && apa17l.includes("href: '/admin.html'") && apa17l.includes("t('← Table de marque')") && !/\bconst t = /.test(apa17l) && !/\bconst t = /.test(adm17j) && /\bconst tn = adminTournoiActif\(\)/.test(adm17j), '');
  check('17j: front — création de tournoi prérenseignée par les réglages du club (nom/jour/heure via /api/admin/club/prefs, replis d origine)', at17j.includes('/api/admin/club/prefs') && at17j.includes('defaut_nom') && at17j.includes('defaut_jour') && at17j.includes('defaut_heure'), '');
  check('17j: front — page dédiée 🏛️ Clubs de la plateforme (17i v3): panneau 🎨 Personnalisation avec sélecteur de club (réglage à distance body.slug)', scl17j.includes('Personnalisation du club') && scl17j.includes('/api/admin/club/prefs') && scl17j.includes("type: 'color'"), '');
  check('17j: i18n — panneau Apparence et jours traduits dans les 4 langues (EN/ES/IT/DE)', cjs17j.includes('"🎨 Apparence du club": "🎨 Club appearance"') && cjs17j.includes('"🎨 Apparence du club": "🎨 Apariencia del club"') && cjs17j.includes('"🎨 Apparence du club": "🎨 Aspetto del club"') && cjs17j.includes('"🎨 Apparence du club": "🎨 Darstellung des Clubs"') && cjs17j.includes('"Mercredi": "Wednesday"') && cjs17j.includes('"Mercredi": "Miércoles"') && cjs17j.includes('"Mercredi": "Mercoledì"') && cjs17j.includes('"Mercredi": "Mittwoch"'), '');
  const spec17j = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  const ga17j = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_ADMIN.md'), 'utf8');
  const rm17j = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ROADMAP.md'), 'utf8');
  check('doc: SPEC 17j + GUIDE_ADMIN (Apparence du club + prérenseignement de tournoi) + ROADMAP #44', spec17j.includes('17j. Personnalisation du club') && spec17j.includes('564 checks') && ga17j.includes('Apparence du club') && rm17j.includes('Personnalisation du club (17j)'), '');

  // ---------- 17k. Logo du club : bibliothèque prédéfinie + import, filigrane et logo d en-tête ----------
  sec('17k. Logo du club: prédéfini (whitelist /logos) ou importé (data:image png/jpeg/svg), filigrane discret + en-tête, toutes pages hors TV');
  r = await put('/api/admin/club/prefs', { logo: '/logos/bille-8.svg' }, { pin: '5678', club: 'clubvm' });
  let r17k = await api('/api/club-theme', { pin: null, club: 'clubvm' });
  check('17k: PUT prefs logo prédéfini (whitelist) -> 200 et /api/club-theme sert le logo à TOUS les visiteurs', r.status === 200 && r.data.prefs && r.data.prefs.logo === '/logos/bille-8.svg' && r17k.status === 200 && r17k.data.logo === '/logos/bille-8.svg', JSON.stringify([r.status, r.data, r17k.data]));
  const sv17k = await fetch(BASE + '/logos/bille-8.svg');
  check('17k: bibliothèque statique publique /logos/bille-8.svg -> 200 image/svg+xml (prédéfinis servis à tous)', sv17k.status === 200 && String(sv17k.headers.get('content-type') || '').includes('image/svg+xml'), sv17k.status + ' ' + sv17k.headers.get('content-type'));
  r = await put('/api/admin/club/prefs', { logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }, { pin: '5678', club: 'clubvm' });
  check('17k: PUT prefs logo importé data:image/png;base64 -> 200 (petit logo accepté, stocké dans theme_json)', r.status === 200 && r.data.prefs && r.data.prefs.logo.startsWith('data:image/png;base64,'), r.status + ' ' + JSON.stringify(r.data));
  r = await put('/api/admin/club/prefs', { logo: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#9aa0a8"/></svg>').toString('base64') }, { pin: '5678', club: 'clubvm' });
  check('17k: PUT prefs logo importé data:image/svg+xml;base64 -> 200 (logo vectoriel accepté)', r.status === 200 && r.data.prefs && r.data.prefs.logo.startsWith('data:image/svg+xml;base64,'), r.status + ' ' + JSON.stringify(r.data));
  const rK1 = await put('/api/admin/club/prefs', { logo: '/logos/intrus.svg' }, { pin: '5678', club: 'clubvm' });
  const rK2 = await put('/api/admin/club/prefs', { logo: 'data:text/html;base64,PHN2Zz4=' }, { pin: '5678', club: 'clubvm' });
  const rK3 = await put('/api/admin/club/prefs', { logo: 'https://exemple.fr/logo.png' }, { pin: '5678', club: 'clubvm' });
  check('17k: PUT logo hors whitelist (/logos/intrus.svg), data:text/html et https:// -> 400 (seuls prédéfinis + data:image png/jpeg/svg)', rK1.status === 400 && rK2.status === 400 && rK3.status === 400, JSON.stringify([rK1.status, rK2.status, rK3.status]));
  r = await put('/api/admin/club/prefs', { logo: 'data:image/png;base64,' + 'A'.repeat(200001) }, { pin: '5678', club: 'clubvm' });
  check('17k: PUT logo data:image trop volumineux (> 200 000 caractères) -> 400 (garde-fou stockage)', r.status === 400, r.status + '');
  const rKs = await put('/api/admin/club/prefs', { slug: 'clubsb', logo: '/logos/couronne.svg' }, { pin: PIN });
  const rKi = await put('/api/admin/club/prefs', { slug: 'clubsb', logo: '/logos/etoile.svg' }, { pin: '5678', club: 'clubvm' });
  r17k = await api('/api/club-theme', { pin: null, club: 'clubsb' });
  check('17k: super-admin règle le logo d un autre club (body.slug) -> 200, PIN du club refusé (403), isolation par club', rKs.status === 200 && rKs.data.prefs && rKs.data.prefs.logo === '/logos/couronne.svg' && r17k.data.logo === '/logos/couronne.svg' && rKi.status === 403, JSON.stringify([rKs.status, rKs.data, r17k.data, rKi.status]));
  r = await put('/api/admin/club/prefs', { logo_mode: 'partout' }, { pin: '5678', club: 'clubvm' });
  check('17k: PUT prefs logo_mode invalide -> 400 (switch: entete / filigrane / les-deux)', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await put('/api/admin/club/prefs', { logo_mode: 'filigrane' }, { pin: '5678', club: 'clubvm' });
  r17k = await api('/api/club-theme', { pin: null, club: 'clubvm' });
  check('17k: PUT prefs logo_mode filigrane -> 200 (switch logo d en-tête / filigrane / les deux) et /api/club-theme sert le mode', r.status === 200 && r.data.prefs && r.data.prefs.logo_mode === 'filigrane' && r17k.data.logo_mode === 'filigrane', JSON.stringify([r.status, r.data, r17k.data]));
  // ---------- 17n. Identité visuelle: favicon (logo), bannière accueil, page Le club, fond TV (gardes pliées dans le check 17k réinitialisation, 564 checks conservés) ----------
  const png17n = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const rB1 = await put('/api/admin/club/prefs', { banniere: png17n }, { pin: '5678', club: 'clubvm' });
  const rB2 = await put('/api/admin/club/prefs', { tv_fond: png17n }, { pin: '5678', club: 'clubvm' });
  const rB3 = await put('/api/admin/club/prefs', { description: '  ' + 'D'.repeat(600), contact: 'C'.repeat(300) }, { pin: '5678', club: 'clubvm' });
  const rB4 = await put('/api/admin/club/prefs', { banniere: 'data:text/html;base64,PHN2Zz4=' }, { pin: '5678', club: 'clubvm' });
  const rB5 = await put('/api/admin/club/prefs', { banniere: 'data:image/png;base64,' + 'A'.repeat(400001) }, { pin: '5678', club: 'clubvm' });
  const rB6 = await put('/api/admin/club/prefs', { banniere: 'https://exemple.fr/b.png' }, { pin: '5678', club: 'clubvm' });
  const rB7 = await put('/api/admin/club/prefs', { slug: 'clubsb', banniere: png17n }, { pin: '5678', club: 'clubvm' });
  const svB1 = await fetch(BASE + '/api/club-banniere?club=clubvm');
  const svB2 = await fetch(BASE + '/api/club-tv-fond?club=clubvm');
  const svB3 = await fetch(BASE + '/api/club-banniere?club=clubsb'); // aucune bannière sur clubsb -> 204
  const svB4 = await fetch(BASE + '/api/club-banniere'); // club par défaut (ebpc) sans bannière -> 204
  const ctB1 = String(svB1.headers.get('content-type') || '');
  const thB = await api('/api/club-theme', { pin: null, club: 'clubvm' }); // textes publics Le club servis, JAMAIS les images lourdes
  // ---------- 17o. Icône du club sur l écran du téléphone : manifeste dynamique + /api/club-icone (gardes pliées dans le check 17k réinitialisation, 564 checks conservés) ----------
  const mfo17o = await fetch(BASE + '/manifest.webmanifest?club=clubvm'); // clubvm sans icône PNG (logo svg) -> icône générique dans le manifeste
  const ct17o = String(mfo17o.headers.get('content-type') || '');
  const mfB17o = await (await fetch(BASE + '/manifest.webmanifest?club=clubvm')).json().catch(() => null);
  const mfZ17o = await (await fetch(BASE + '/manifest.webmanifest')).json().catch(() => null); // club par défaut -> start_url /
  const icR17o = await fetch(BASE + '/api/club-icone?club=clubvm'); // aucune icône (SVG ignoré) -> redirection 302 vers l icône générique
  const icZ17o = await (await fetch(BASE + '/api/club-icone?club=clubvm')).arrayBuffer().then((b) => b.byteLength).catch(() => -1);
  const ri17o1 = await put('/api/admin/club/prefs', { icone: png17n }, { pin: '5678', club: 'clubvm' });
  const icP17o = await fetch(BASE + '/api/club-icone?club=clubvm'); // PNG stocké -> 200 image/png sans redirection
  const mfI17o = await (await fetch(BASE + '/manifest.webmanifest?club=clubvm')).json().catch(() => null);
  // ---------- 17q. Splash screen du club : route PNG maison (fond accent + icône), gardes pliées dans le check 17k ----------
  const sp17q = await fetch(BASE + '/api/club-splash?club=clubvm&w=750&h=1334'); // icône PNG posée par ri17o1 -> splash complet
  const ct17q = String(sp17q.headers.get('content-type') || '');
  const spBuf17q = Buffer.from(await sp17q.arrayBuffer());
  const sig17q = spBuf17q.length > 8 && spBuf17q[0] === 0x89 && spBuf17q[1] === 0x50 && spBuf17q[2] === 0x4e && spBuf17q[3] === 0x47;
  const spZ17q = await (await fetch(BASE + '/api/club-splash?w=640&h=1136')).arrayBuffer().then((b) => b.byteLength).catch(() => -1); // club par défaut sans icône PNG -> fond accent seul
  const spB17q = await fetch(BASE + '/api/club-splash?club=clubvm&w=9999&h=1334'); // dimensions hors bornes -> 400
  // ---------- 17t. Chemins du club pour l installation iOS : Safari RETIRE la query des liens d installation, gardes pliées dans le check 17k ----------
  const mpB17t = await fetch(BASE + '/manifest-clubvm.webmanifest'); // manifeste par CHEMIN : même contenu que ?club=clubvm (icône PNG posée par ri17o1)
  const mpC17t = String(mpB17t.headers.get('content-type') || '');
  const mpT17t = await (await fetch(BASE + '/manifest-clubvm.webmanifest')).json().catch(() => null);
  const mpZ17t = await (await fetch(BASE + '/manifest-inconnu17t.webmanifest')).json().catch(() => null); // slug inconnu -> club par défaut, jamais 404
  const icP17t = await fetch(BASE + '/icone-clubvm.png'); // PNG stocké -> 200 image/png sans redirection
  const icR17t = await fetch(BASE + '/icone-inconnu17t.png'); // slug inconnu -> repli 302 vers l icône générique
  const spT17t = await fetch(BASE + '/splash/clubvm/750x1334.png'); // splash par CHEMIN : PNG maison fond accent + icône
  const spTCt17t = String(spT17t.headers.get('content-type') || '');
  const spTB17t = await fetch(BASE + '/splash/clubvm/9999x1334.png'); // 17t: dimensions hors bornes -> 400
  const ri17o2 = await put('/api/admin/club/prefs', { icone: 'data:text/html;base64,PHN2Zz4=' }, { pin: '5678', club: 'clubvm' });
  const ri17o3 = await put('/api/admin/club/prefs', { icone: 'data:image/png;base64,' + 'A'.repeat(200001) }, { pin: '5678', club: 'clubvm' });
  const ri17o4 = await put('/api/admin/club/prefs', { slug: 'clubsb', icone: png17n }, { pin: '5678', club: 'clubvm' });
  r = await put('/api/admin/club/prefs', { logo: '', logo_mode: 'les-deux', banniere: '', tv_fond: '', description: '', contact: '', icone: '' }, { pin: '5678', club: 'clubvm' });
  const rKz = await put('/api/admin/club/prefs', { slug: 'clubsb', logo: '', logo_mode: 'les-deux' }, { pin: PIN });
  r17k = await api('/api/club-theme', { pin: null, club: 'clubvm' });
  const cjs17k = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
  const adm17k = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const cons17k = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.html'), 'utf8');
  const scl17k = fs.readFileSync(path.join(__dirname, '..', 'public', 'super-clubs.html'), 'utf8'); // 17i v3: import/galerie logo du panneau personnalisation déplacés ici
  const at17k = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-tournoi.html'), 'utf8');
  const adc17k = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-common.js'), 'utf8');
  const spec17k = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  const ga17k = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_ADMIN.md'), 'utf8');
  const rm17k = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ROADMAP.md'), 'utf8');
  const srv17k = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const lc17n = fs.readFileSync(path.join(__dirname, '..', 'public', 'leclub.html'), 'utf8'); // 17n: page publique Le club
  const tv17n = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  const sty21a = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8'); // 21a: cartes TV adaptatives
  const idx17n = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8') // 86: helpers du fil dans common.js;
  const mch17p = fs.readFileSync(path.join(__dirname, '..', 'src', 'matchs.js'), 'utf8'); // 17p: notification du prochain match
  const psh17p = fs.readFileSync(path.join(__dirname, '..', 'src', 'push.js'), 'utf8');
  const gu17p = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_UTILISATEUR.md'), 'utf8');
  const swj17s = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'); // 17s: service worker club-safe
  const cpt17v = fs.readFileSync(path.join(__dirname, '..', 'public', 'compte.html'), 'utf8'); // 17v: mention compte plateforme sur la page connexion
  const jp20a = fs.readFileSync(path.join(__dirname, '..', 'public', 'joueurs.html'), 'utf8'); // 20a: page joueur de la plateforme (recherche publique)
  const dbf31 = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8'); // 31: KPI d usage (tables usage_page / usage_api, sans FK, purge 90 jours)
  const aju31 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-journal.html'), 'utf8'); // 31: panneau rapport d usage en tête du journal d audit
  const clf26a = fs.readFileSync(path.join(__dirname, '..', 'public', 'classement.html'), 'utf8'); // 26a: page publique du classement saison
  const acl27a = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-actu.html'), 'utf8'); // 27a: page admin des news du club
  const db27a = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8'); // 27a: table actu du portail
  const cpt19c = fs.readFileSync(path.join(__dirname, '..', 'src', 'comptes.js'), 'utf8'); // 19c: courses d inscription ciblées par tournoi
  // 17w: tournois en parallèle (un tournoi par club) -> les matchs des DEUX clubs sont pret et lançables en même temps
  await del('/api/admin/tournoi', { club: 'clubvm' }).catch(() => {});
  await del('/api/admin/tournoi', { club: 'clubsb' }).catch(() => {});
  const tirer17w = async (club17w, pin17w, noms17w) => {
    await post('/api/admin/tournoi', { nom: 'T17w-' + club17w, regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false }, { club: club17w, pin: pin17w });
    for (const p17w of noms17w) await post('/api/admin/joueur', { pseudo: p17w }, { club: club17w, pin: pin17w });
    const e17w = await api('/api/etat', { club: club17w, pin: pin17w });
    for (const p17w of noms17w) {
      const j17w = e17w.data.actif && e17w.data.actif.joueurs.find(j => j.pseudo === p17w);
      await post(`/api/admin/joueur/${j17w ? j17w.id : -1}/paiement`, { statut: 'paye' }, { club: club17w, pin: pin17w });
    }
    return post('/api/admin/tirage', {}, { club: club17w, pin: pin17w });
  };
  const tirVm17w = await tirer17w('clubvm', '5678', ['VmA17w', 'VmB17w']);
  const tirSb17w = await tirer17w('clubsb', '4321', ['SbA17w', 'SbB17w']);
  // 20a. Hub plateforme : accueil global et recherche joueur publique (aucun code PIN requis, données déjà publiques par club)
  const pl20a = await fetch(BASE + '/api/plateforme');
  const plD20a = await pl20a.json().catch(() => null);
  const pj20a = await fetch(BASE + '/api/plateforme/joueurs?q=VmA17w');
  const pjD20a = await pj20a.json().catch(() => null);
  const ph20b = await fetch(BASE + '/?hub=1'); // 20b: le serveur sert la page hub sur / (front 20a, ?hub=1 forcé)
  const phT20b = await ph20b.text().catch(() => '');
  // 23a. Swap player: remplacer un joueur APRÈS le tirage (place, paiement et tête de série conservés, bracket inchangé)
  const et23a = (await api('/api/etat', { club: 'clubvm', pin: '5678' })).data.actif;
  const j23a = et23a ? et23a.joueurs.find((j) => j.pseudo === 'VmA17w') : null;
  const remp23a = await post(`/api/admin/joueur/${j23a ? j23a.id : -1}/remplace`, { pseudo: 'VmZ23a' }, { club: 'clubvm', pin: '5678' });
  const pris23a = await post(`/api/admin/joueur/${j23a ? j23a.id : -1}/remplace`, { pseudo: 'VmB17w' }, { club: 'clubvm', pin: '5678' });
  const autre23a = await post(`/api/admin/joueur/${j23a ? j23a.id : -1}/remplace`, { pseudo: 'VmA17w' }, { club: 'clubsb', pin: '4321' });
  const etVm17w = (await api('/api/etat', { club: 'clubvm', pin: '5678' })).data.actif;
  const etSb17w = (await api('/api/etat', { club: 'clubsb', pin: '4321' })).data.actif;
  const pretVm17w = etVm17w ? etVm17w.matchs.filter(m17w => m17w.etat === 'pret' && m17w.joueur1 && m17w.joueur2) : [];
  const pretSb17w = etSb17w ? etSb17w.matchs.filter(m17w => m17w.etat === 'pret' && m17w.joueur1 && m17w.joueur2) : [];
  const lanVm17w = pretVm17w.length ? await post(`/api/admin/match/${pretVm17w[0].id}/lancer`, {}, { club: 'clubvm', pin: '5678' }) : { status: 0 };
  const lanSb17w = pretSb17w.length ? await post(`/api/admin/match/${pretSb17w[0].id}/lancer`, {}, { club: 'clubsb', pin: '4321' }) : { status: 0 };
  const rempApres23a = j23a ? await post(`/api/admin/joueur/${j23a.id}/remplace`, { pseudo: 'VmX23a' }, { club: 'clubvm', pin: '5678' }) : { status: 0 }; // 23a: joueur devenu en match, remplacement refusé
  // 23b. Suspension du match lancé à 0-0: repasse pret (table libérée), relançable plus tard, joueur remplaçable de nouveau
  const susp23b = pretVm17w.length ? await post(`/api/admin/match/${pretVm17w[0].id}/suspendre`, {}, { club: 'clubvm', pin: '5678' }) : { status: 0 };
  const rempSusp23b = j23a ? await post(`/api/admin/joueur/${j23a.id}/remplace`, { pseudo: 'VmX23a' }, { club: 'clubvm', pin: '5678' }) : { status: 0 };
  const rela23b = susp23b.status === 200 && pretVm17w.length ? await post(`/api/admin/match/${pretVm17w[0].id}/lancer`, {}, { club: 'clubvm', pin: '5678' }) : { status: 0 }; // relancé plus tard
  const et23b = (await api('/api/etat', { club: 'clubvm', pin: '5678' })).data.actif;
  // 24a. Lien public par match: la page /match.html?id=<id>&club=<slug> est servie (même URL que les notifs push)
  const lien24a = await fetch(BASE + '/match.html?id=' + (pretVm17w.length ? pretVm17w[0].id : -1) + '&club=clubvm');
  const lien24aOk = lien24a.status === 200;
  // 24b. Le lien partagé doit être consultable par tout le monde: le visiteur qui ouvre le lien n a NI session NI PIN,
  // son navigateur n envoie que le header X-Club du club de l URL -> état du club et match partagé lus sans authentification
  const lien24bR = await fetch(BASE + '/api/etat', { headers: { 'X-Club': 'clubvm' } });
  let lien24bOk = lien24bR.status === 200 && pretVm17w.length > 0;
  try { const d24b = await lien24bR.json(); lien24bOk = lien24bOk && !!(d24b && d24b.actif && Array.isArray(d24b.actif.matchs) && d24b.actif.matchs.some(m24b => m24b.id === pretVm17w[0].id)); } catch (e24b) { lien24bOk = false; }
  // 31. KPI d usage par tournoi : le beacon public POST /api/usage (envoyé par le front à chaque
  // chargement de page, sans cookie ni tracker) crée un relevé côté serveur ; le rapport admin
  // GET /api/admin/tournoi/usage agrège pages consultées, adoption, persistance, réactivité, santé
  const u31 = await fetch(BASE + '/api/usage', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Club': 'clubvm' }, body: JSON.stringify({ page: 'tableau' }) });
  const u31b = await fetch(BASE + '/api/usage', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Club': 'clubvm' }, body: JSON.stringify({ page: 'suivi' }) });
  const u31d = (await api('/api/admin/tournoi/usage', { club: 'clubvm', pin: '5678' })).data;
  const u31r401 = await api('/api/admin/tournoi/usage', { club: 'clubvm', pin: null });
  const u31i = etVm17w && etVm17w.tournoi ? await api('/api/admin/tournoi/usage?tournoi_id=' + etVm17w.tournoi.id, { club: 'clubsb', pin: '4321' }) : { status: 0 }; // isolation: le tournoi de clubvm jamais lu depuis clubsb
  // 26a. Classement saison du club : un tournoi de 2 joueurs joué jusqu au bout (club par défaut)
  // alimente les points cumulés (profondeur atteinte) ; page publique /classement.html + route
  // GET /api/classement-saison ; le tournoi est ensuite supprimé pour ne rien laisser derrière
  await del('/api/admin/tournoi').catch(() => {});
  const cr26a = await post('/api/admin/tournoi', { nom: 'T26a', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  const etat26a = (await api('/api/etat')).data.actif;
  for (const p26a of ['J26a', 'K26b']) await post('/api/admin/joueur', { pseudo: p26a });
  const ej26a = (await api('/api/etat')).data.actif;
  for (const j26a of (ej26a ? ej26a.joueurs : [])) await post(`/api/admin/joueur/${j26a.id}/paiement`, { statut: 'paye' });
  await post('/api/admin/tirage', {});
  const cham26a = ej26a ? ej26a.joueurs.find((j26b) => j26b.pseudo === 'J26a') : null;
  await jouerTournoiSimple(cham26a ? cham26a.id : -1);
  const csa26a = await api('/api/classement-saison', { pin: null }); // publique, club par défaut
  // 26b. Saisons du club paramétrables : le classement ne découpe plus à l année civile mais aux
  // saisons du club (préf admin saison_debut MM-JJ, défaut 09-01). T26a vient de finir AUJOURD HUI :
  // avec un début de saison au 31/12 il glisse dans la saison de l an dernier, avec 01-01 il
  // retrouve l année civile ; la préf est ensuite rétablie au défaut 09-01.
  const sd26bNul = await put('/api/admin/club/prefs', { saison_debut: '13-13' }, { pin: PIN }); // format refusé
  const sd26bFev = await put('/api/admin/club/prefs', { saison_debut: '02-30' }, { pin: PIN }); // 30 février refusé
  const sd26bFev29 = await put('/api/admin/club/prefs', { saison_debut: '02-29' }, { pin: PIN }); // 29 février accepté (année bissextile)
  const sd26b3112 = await put('/api/admin/club/prefs', { saison_debut: '12-31' }, { pin: PIN });
  const sdb31 = await api('/api/admin/club/prefs', { pin: PIN }); // la préf enregistrée se relit
  const csa26b = await api('/api/classement-saison', { pin: null }); // publique : T26a est dans la saison de l an dernier
  const auj26b = new Date(Date.now());
  const annee26bd = (auj26b.getUTCMonth() === 11 && auj26b.getUTCDate() === 31) ? auj26b.getUTCFullYear() : auj26b.getUTCFullYear() - 1; // début de saison au 31/12 : T26a appartient à cette saison-là
  const csa26c = await api('/api/classement-saison?annee=' + annee26bd, { pin: null }); // la saison de T26a contient bien le classement
  const csa26d = await api('/api/classement-saison?annee=' + (annee26bd + 1), { pin: null }); // la saison suivante est vide
  const sd26b0101 = await put('/api/admin/club/prefs', { saison_debut: '01-01' }, { pin: PIN }); // retour à l année civile
  const csa26e = await api('/api/classement-saison', { pin: null }); // libellé réduit à l année seule
  const annee26civil = auj26b.getUTCFullYear();
  const sd26bRetab = await put('/api/admin/club/prefs', { saison_debut: '09-01' }, { pin: PIN }); // rétablissement du défaut
  // 27a. Portail du club : les news du club (route publique GET /api/club-actu, rédigées depuis la
  // page dédiée /admin-actu.html de la table de marque) et le calendrier des tournois (GET
  // /api/club-calendrier : T26a vient de finir, il est encore dans les passés avec son champion,
  // avant sa suppression quelques lignes plus bas). Les actus sont supprimées à la fin : la base
  // de test ne laisse rien derrière elle.
  const na27a = await post('/api/admin/club/actu', { texte: 'Actualité trop longue 27a. '.repeat(32) }); // 704 caractères -> refusée
  const na27p = await post('/api/admin/club/actu', { texte: '   ' }); // que des espaces -> refusée
  const n27a = await post('/api/admin/club/actu', { texte: 'Bienvenue au club pour la saison 2026-2027' });
  const n27b = await post('/api/admin/club/actu', { texte: 'Assemblée générale du club le mois prochain', epingle: true });
  const l27a = await api('/api/club-actu', { pin: null }); // publique, club par défaut
  const l27i = await api('/api/club-actu', { pin: null, club: 'clubvm' }); // isolation : rien du club par défaut vu côté clubvm
  const u27a = await put('/api/admin/club/actu/' + (n27a.data && n27a.data.actu ? n27a.data.actu.id : 0), { texte: 'Texte modifié 27a' });
  const u27x = await put('/api/admin/club/actu/' + (n27a.data && n27a.data.actu ? n27a.data.actu.id : 0), { texte: 'Vol 27a' }, { club: 'clubvm', pin: '5678' }); // autre club -> 404, jamais éditable
  const k27a = await api('/api/club-calendrier', { pin: null }); // publique : T26a dans les passés avec J26a champion
  const d27x = await del('/api/admin/club/actu/9999999'); // inconnue -> 404
  const d27b = await del('/api/admin/club/actu/' + (n27b.data && n27b.data.actu ? n27b.data.actu.id : 0));
  const d27a = await del('/api/admin/club/actu/' + (n27a.data && n27a.data.actu ? n27a.data.actu.id : 0));
  const l27apres = await api('/api/club-actu', { pin: null }); // tout est nettoyé
  const hist26a = (await api('/api/etat')).data.historique || [];
  const t26aRow = hist26a.find((ht26) => ht26.nom === 'T26a');
  if (t26aRow) await del('/api/admin/tournoi/' + t26aRow.id).catch(() => {}); // nettoyage : jamais laissé dans l historique
  const hist26b = (await api('/api/etat')).data.historique || [];
  await del('/api/admin/tournoi', { club: 'clubvm' }).catch(() => {});
  await del('/api/admin/tournoi', { club: 'clubsb' }).catch(() => {});
  // 19c. Écriture multi-tournois dans LE MÊME club : deux tournois créés et actifs en même temps
  // (T19c1 pendant T19c2 en inscriptions, puis les deux tirés), actions ciblées par tournoi_id
  // (sans cible : un seul actif = comportement d origine, plusieurs = 409 explicite), tables
  // partagées (le numéro de billard pris par le tournoi voisin n est jamais réattribué) et
  // auto-lancement sur TOUS les actifs du club. Tout est supprimé à la fin.
  const cr19c1 = await post('/api/admin/tournoi', { nom: 'T19c1', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  const nr19c1 = cr19c1.data && cr19c1.data.actif && cr19c1.data.actif.tournoi ? cr19c1.data.actif.tournoi.id : 0;
  const cr19c2 = await post('/api/admin/tournoi', { nom: 'T19c2', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false }); // création PENDANT un tournoi actif
  const nr19c2 = cr19c2.data && cr19c2.data.actif && cr19c2.data.actif.tournoi ? cr19c2.data.actif.tournoi.id : 0;
  const ins19c409 = await post('/api/admin/joueur', { pseudo: 'A19c' }); // deux inscriptions ouvertes, pas de cible -> 409
  const insA19c = await post('/api/admin/joueur', { pseudo: 'A19c', tournoi_id: nr19c1 });
  const insB19c = await post('/api/admin/joueur', { pseudo: 'B19c', tournoi_id: nr19c1 });
  const insC19c = await post('/api/admin/joueur', { pseudo: 'C19c', tournoi_id: nr19c2 });
  const insD19c = await post('/api/admin/joueur', { pseudo: 'D19c', tournoi_id: nr19c2 });
  const insX19c = await post('/api/admin/joueur', { pseudo: 'Z19c', tournoi_id: 999999 }); // cible inconnue -> 404
  for (const j19c of ((await api('/api/etat?tournoi_id=' + nr19c1)).data.actif || { joueurs: [] }).joueurs) await post('/api/admin/joueur/' + j19c.id + '/paiement', { statut: 'paye' }); // paiement résolu depuis le joueur
  for (const j19c of ((await api('/api/etat?tournoi_id=' + nr19c2)).data.actif || { joueurs: [] }).joueurs) await post('/api/admin/joueur/' + j19c.id + '/paiement', { statut: 'paye' });
  const tirSans19c = await post('/api/admin/tirage', {}); // deux actifs sans cible -> 409
  const tirT1 = await post('/api/admin/tirage', { tournoi_id: nr19c1 }); // T19c1 tiré sous les yeux de T19c2
  const tirX19c = await post('/api/admin/tirage', { tournoi_id: 999999 }); // cible inconnue -> 404
  const tirRe19c = await post('/api/admin/tirage', { tournoi_id: nr19c1 }); // déjà tiré -> 409
  const tirT2 = await post('/api/admin/tirage', { tournoi_id: nr19c2 });
  const et19c1 = (await api('/api/etat?tournoi_id=' + nr19c1)).data.actif;
  const et19c2 = (await api('/api/etat?tournoi_id=' + nr19c2)).data.actif;
  const m19c1 = et19c1 && et19c1.matchs ? et19c1.matchs.find((mm) => mm.etat === 'pret' && !mm.virtuel) : null;
  const m19c2 = et19c2 && et19c2.matchs ? et19c2.matchs.find((mm) => mm.etat === 'pret' && !mm.virtuel) : null;
  const tb19c1 = et19c1 && et19c1.tables ? et19c1.tables.find((tb) => tb.numero === 1) : null; // billard n°1 vu du tournoi 1
  const tb19c2 = et19c2 && et19c2.tables ? et19c2.tables.find((tb) => tb.numero === 1) : null; // le MÊME billard n°1 vu du tournoi 2
  const lanT1 = await post('/api/admin/match/' + (m19c1 ? m19c1.id : 0) + '/lancer', { table_id: tb19c1 ? tb19c1.id : null }); // T19c1 s installe sur le billard n°1
  const lanVoisin = await post('/api/admin/match/' + (m19c2 ? m19c2.id : 0) + '/lancer', { table_id: tb19c2 ? tb19c2.id : null }); // le n°1 est pris par le voisin -> 409
  const lanT2 = await post('/api/admin/match/' + (m19c2 ? m19c2.id : 0) + '/lancer', {}); // attribution auto -> saute le n°1 pris, prend le n°2
  const delSans19c = await del('/api/admin/tournoi'); // suppression sans cible avec deux actifs -> 409
  const cr19c3 = await post('/api/admin/tournoi', { nom: 'T19c3', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false }); // troisième actif
  const nr19c3 = cr19c3.data && cr19c3.data.actif && cr19c3.data.actif.tournoi ? cr19c3.data.actif.tournoi.id : 0;
  const delT3 = await del('/api/admin/tournoi', { body: { confirm_pin: PIN, tournoi_id: nr19c3 } }); // suppression ciblée du SEUL tournoi désigné
  const termSans = await post('/api/admin/terminer', {}); // deux actifs restants sans cible -> 409
  const termT1 = await post('/api/admin/terminer', { tournoi_id: nr19c1 }); // SEUL T19c1 s arrête, T19c2 continue
  const etT2apres = (await api('/api/etat?tournoi_id=' + nr19c2)).data.actif; // le voisin est TOUJOURS en cours
  const termT2 = await post('/api/admin/terminer', {}); // comportement d origine: T19c2 est l unique actif restant
  for (const nom19c of ['T19c1', 'T19c2']) {
    const h19c = (await api('/api/etat')).data.historique || [];
    const row19c = h19c.find((tt) => tt.nom === nom19c);
    if (row19c) await del('/api/admin/tournoi/' + row19c.id).catch(() => {}); // nettoyage : rien dans l historique
  }
  const apres19c = (await api('/api/etat')).data;
  // 19d. Zone de tables par tournoi (mode multi-tournois) : l Open sur les tables 1-2, la consolande
  // sur 3-4 : le champ à la création (normalisé 1,2), l attribution automatique ET le choix manuel
  // ne prennent QUE les tables de la zone, refus 400 explicite hors zone (lancer, déplacement, création,
  // édition), zone retirée = toutes les tables (comportement d origine). Tout est supprimé à la fin.
  const dbZ19d = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
  const crZ1 = await post('/api/admin/tournoi', { nom: 'T19dA', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 4, zone_tables: '1 - 2', notif_push: false }); // normalisé en 1,2 malgré les espaces
  const crZ2 = await post('/api/admin/tournoi', { nom: 'T19dB', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 4, zone_tables: '3-4', notif_push: false }); // créé PENDANT l actif, sa zone est indépendante
  const actifsZ19d = (crZ2.data && Array.isArray(crZ2.data.actifs)) ? crZ2.data.actifs : [];
  const nrZ1 = ((actifsZ19d.find((tt) => tt.nom === 'T19dA') || {}).id) || (crZ1.data && crZ1.data.actif && crZ1.data.actif.tournoi ? crZ1.data.actif.tournoi.id : 0);
  const nrZ2 = ((actifsZ19d.find((tt) => tt.nom === 'T19dB') || {}).id) || (crZ2.data && crZ2.data.actif && crZ2.data.actif.tournoi ? crZ2.data.actif.tournoi.id : 0);
  const crZInv = await post('/api/admin/tournoi', { nom: 'T19dInv', regle: 'blackball', taille: 16, format: 'simple', zone_tables: 'abc', notif_push: false }); // zone illisible -> 400
  const crZHors = await post('/api/admin/tournoi', { nom: 'T19dH', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 4, zone_tables: '1-9', notif_push: false }); // zone hors des 4 tables -> 400
  await post('/api/admin/joueur', { pseudo: 'A19d', tournoi_id: nrZ1 });
  await post('/api/admin/joueur', { pseudo: 'B19d', tournoi_id: nrZ1 });
  for (const jZ19d of ((await api('/api/etat?tournoi_id=' + nrZ1)).data.actif || { joueurs: [] }).joueurs) await post('/api/admin/joueur/' + jZ19d.id + '/paiement', { statut: 'paye' });
  await post('/api/admin/joueur', { pseudo: 'C19d', tournoi_id: nrZ2 });
  await post('/api/admin/joueur', { pseudo: 'D19d', tournoi_id: nrZ2 });
  await post('/api/admin/joueur', { pseudo: 'E19d', tournoi_id: nrZ2 });
  await post('/api/admin/joueur', { pseudo: 'F19d', tournoi_id: nrZ2 });
  for (const jZ19d of ((await api('/api/etat?tournoi_id=' + nrZ2)).data.actif || { joueurs: [] }).joueurs) await post('/api/admin/joueur/' + jZ19d.id + '/paiement', { statut: 'paye' });
  const tirZ1 = await post('/api/admin/tirage', { tournoi_id: nrZ1 });
  const tirZ2 = await post('/api/admin/tirage', { tournoi_id: nrZ2 });
  const etZ1 = (await api('/api/etat?tournoi_id=' + nrZ1)).data.actif;
  const etZ2 = (await api('/api/etat?tournoi_id=' + nrZ2)).data.actif;
  const mmZ1 = etZ1 && etZ1.matchs ? etZ1.matchs.find((mm) => mm.etat === 'pret' && !mm.virtuel) : null;
  const mmZ2a = etZ2 && etZ2.matchs ? etZ2.matchs.filter((mm) => mm.etat === 'pret' && !mm.virtuel) : [];
  const tbZ2_1 = etZ2 && etZ2.tables ? etZ2.tables.find((tb) => tb.numero === 1) : null; // hors zone de la consolande
  const tbZ2_2 = etZ2 && etZ2.tables ? etZ2.tables.find((tb) => tb.numero === 2) : null; // libre MAIS hors zone
  const lanZ1 = await post('/api/admin/match/' + (mmZ1 ? mmZ1.id : 0) + '/lancer', {}); // attribution auto -> dans 1-2
  const numZ1 = lanZ1.data && lanZ1.data.match ? lanZ1.data.match.table : 0;
  const lanZ2 = await post('/api/admin/match/' + (mmZ2a[0] ? mmZ2a[0].id : 0) + '/lancer', {}); // attribution auto -> dans 3-4
  const numZ2 = lanZ2.data && lanZ2.data.match ? lanZ2.data.match.table : 0;
  const lanHorsZone = await post('/api/admin/match/' + (mmZ2a[1] ? mmZ2a[1].id : 0) + '/lancer', { table_id: tbZ2_1 ? tbZ2_1.id : null }); // la table 1 est refusée à la consolande -> 400
  const setHorsZone = await post('/api/admin/match/' + (mmZ2a[0] ? mmZ2a[0].id : 0) + '/table', { table_id: tbZ2_2 ? tbZ2_2.id : null }); // déplacement hors zone -> 400
  const upZInv = await put('/api/admin/tournoi', { tournoi_id: nrZ2, zone_tables: 'abc' }); // édition invalide -> 400
  const upZok = await put('/api/admin/tournoi', { tournoi_id: nrZ2, zone_tables: '4' }); // la consolande se réduit à la table 4
  const etZ2b = (await api('/api/etat?tournoi_id=' + nrZ2)).data.actif; // zone 4 lue en base
  const upZvide = await put('/api/admin/tournoi', { tournoi_id: nrZ2, zone_tables: '' }); // zone retirée : toutes les tables
  const etZ2c = (await api('/api/etat?tournoi_id=' + nrZ2)).data.actif; // zone null lue en base
  const termZ1 = await post('/api/admin/terminer', { tournoi_id: nrZ1 });
  const termZ2 = await post('/api/admin/terminer', { tournoi_id: nrZ2 });
  for (const nomZ19d of ['T19dA', 'T19dB']) {
    const hZ19d = (await api('/api/etat')).data.historique || [];
    const rowZ19d = hZ19d.find((tt) => tt.nom === nomZ19d);
    if (rowZ19d) await del('/api/admin/tournoi/' + rowZ19d.id).catch(() => {}); // nettoyage : rien dans l historique
  }
  check('17k: réinitialisation (logo vide, mode les-deux -> défaut, état propre) + front (filigrane filigrane-logo AU-DESSUS du contenu + logo d en-tête + switch logo_mode entete/filigrane/les-deux + cache ebpc_logo_club + galerie page dédiée /admin-apparence.html (17l) + import tolérant 17k v4 (8 Mo, HEIC iPhone et MIME absent acceptés, repli JPEG si PNG trop lourd) + refus explicite 17k v5 (fichier reçu vs attendu + cause probable, cause réelle dans le 400 serveur) + CSP img-src blob: 17k v6 corrigeant le refus de TOUT import via URL.createObjectURL + aperçu 17k v7 du logo retenu avant Enregistrer + vignette importée sélectionnable 17k v8 dans la galerie + repli api() sur club par défaut 17h v2 si le club mémorisé a disparu (404 Club inconnu effacé et appel rejoué, ex: restauration d une base) + regex front base64 corrigée 17k v9 (le + manquait : un logo importé en contenant un n apparaissait ni en filigrane ni en en-tête) + adresse par défaut du club 17j v2 (prérenseigne le lieu de création de tournoi) + console) + docs (SPEC 17k, GUIDE, ROADMAP #45 + #46 page dédiée 17l, 564 checks) + identité visuelle 17n (favicon de l onglet = logo du club, bannière de l accueil (1600 px) + page publique « Le club » (description 500/contact 200, lien du menu), photo de fond TV (1280 px) assombrie, images décodées servies par /api/club-banniere|/api/club-tv-fond avec ?club= (jamais dans le payload club-theme), plafond photo 400 000 caractères, répondants 204 sans image, isolation PIN autre club 403) + icône du club sur l écran du téléphone 17o (manifeste dynamique GET /manifest.webmanifest?club= : nom du club, couleur d accent, start_url conservant le club, Content-Type application/manifest+json ; GET /api/club-icone?club= : préférence au champ icone, repli logo raster, sinon redirection 302 vers /icon-192.png ; champ pref icone png/jpeg base64 plafonné 200 000 caractères, SVG refusé (Android n affiche pas le vectoriel), refus 400 cause réelle, isolation 403 autre club ; conversion AUTOMATIQUE du logo en PNG 192 px côté front à l Enregistrement (canvas, fond couleur d accent, échec -> repli) ; liens manifest et apple-touch-icon + meta theme-color par club côté front) + notification du prochain match 17p (push aux 2 joueurs d un match devenu pret : adversaire + code du match + table si attribuée, 5 langues serveur, fire-and-forget jamais bloquant) + splash screen 17q (manifeste background_color accent pour Android + route /api/club-splash?club=&w=&h= : PNG maison codec serveur sans dépendance, fond accent + icône centrée, 400 dimensions hors bornes + apple-touch-startup-image par taille d écran iPhone côté front) + étanchéité 17r du contexte du club (bannière « Club inconnu ici, tu regardes le club par défaut » sur repli club par défaut : plus jamais de bascule silencieuse, front public ET pages admin, i18n 4 langues + badge du club courant dans le bandeau hors TV/console) + urls du club 17s (payloads push avec ?club=<slug> : match, prochain match, ami, tournoi, rappel, test, repli silencieux si club introuvable ; service worker ne navigue QUE la fenêtre du club du payload, jamais celle d un autre club en multi-PWA ; tous les liens internes portent le club dans l URL (interception au clic, matchUrl comprise) ; sélecteur de la console explicite /admin.html?club=) + chemins du club 17t (Safari/iOS RETIRE la query string des liens d installation et ne lit que le PREMIER manifeste posé sur la page : manifeste, icône et splash servis par CHEMIN par club, /manifest-<slug>.webmanifest, /icone-<slug>.png et /splash/<slug>/<w>x<h>.png, mêmes contenus et mêmes replis que les routes ?club= conservées, slug inconnu -> club par défaut) + accueil multi-clubs 17v (sélecteur discret du club dans le bandeau si PLUSIEURS clubs actifs : nom du club courant, menu des clubs actifs, sélection mémorisée puis rechargement dans le contexte du club, masqués en mono-club et sur la console ; cartes de suggestion des clubs au premier écran de l accueil pour un visiteur sans club mémorisé, masquées en mono-club ; page compte : un seul compte pour toute la plateforme) + tournois en parallèle 17w (création et tirage simultanés un club chacun : les matchs des DEUX clubs sont pret et lançables en MÊME temps, le passage prevu -> pret ne se limite plus à un seul tournoi global au plus grand id) + hub plateforme 20a (accueil global sans ?club= : clubs + tournois en cours/à venir tous clubs + recherche joueur plateforme + pages neutres + manifestes toujours /?club=<slug>, même le club par défaut) + retour au hub 20b (bouton « 🏠 Plateforme » du bandeau des pages de club vers /?hub=1, lien jamais retouché par l intercepteur 17s, hub prioritaire sur le club mémorisé + ouvrir un club retire le retour hub (20b v2: ouvrirClub17v supprime ?hub de l URL, jamais de ?hub=1&club= coincé sur le hub) + TV adaptative 21a (jusqu à 12 matchs par page, cartes redimensionnées selon leur nombre, au moins 20 s entre chaque défilement + 21a v2: textes réellement agrandis et centrés dans les grandes cartes, plus de gros vide à droite) + bandeau allégé 22a (sélecteur de club retiré du bandeau : le hub liste les clubs et le badge du club courant suffit ; gros bouton « Plateforme » remplacé par un petit logo bille 8 en haut à gauche du bandeau vers /?hub=1, visible partout sauf console super-admin ; sélecteur de tournoi 19a inchangé) + swap player post-tirage 23a (remplacement d un joueur après le tirage : le remplaçant prend la place dans le tableau, paiement et tête de série conservés, refus si match réel joué (byes exclus), isolation club 404, pseudo d un compte avec confirmation, fiche joueur et panneau Joueurs affichés pendant le tournoi dans admin-tournoi) + suspension de match 23b (un match lancé à 0 manche jouée repasse pret, table libérée, relançable plus tard, et le remplacement du joueur absent redevient possible) + matchs par modale 24a (les boutons de gestion des matchs quittent les panneaux de la table de marque : un seul bouton ⚙️ Gérer par match ouvre la modale d actions, table et Lancer pour un prêt, Corriger, Suspendre et forfaits pour un en cours) + bouton 🔗 Partager copiant le lien public du match /match.html?id=..&club=.. consultable par tout le monde sans session ni compte, vérifié par un état du club lu en anonyme (header X-Club seul, 24b) + bandeau club côte à côte 24b (titre du bandeau restauré : le dégradé linear-gradient(90deg, var(--pink), var(--pink-soft)) peint par background-clip: text avait été perdu dans la réécriture cosmétique du 13/11, texte color: transparent sans fond et titre invisible sur toutes les pages + badge du club courant (17r) posé DANS le titre en fin de ligne, côte à côte du logo (icône à gauche, nom du club à droite), jamais empilé dessous en colonne mobile, ellipse si trop long) + club à la place de la marque 24c (les pages au titre générique « Pink City Billard » affichent le NOM DU CLUB comme titre du bandeau, icône en haut à gauche et nom du club sur la même ligne, badge retiré car il ne doublerait que le titre, logo du club conservé dans le titre ; pages au titre descriptif, hub de la plateforme et console super-admin inchangés + rapport d usage du tournoi 31 (beacon public POST /api/usage envoyé par le front à chaque chargement de page, sans cookie ni tracker, anti-flood 30 s en mémoire ; relevé serveur agrégé par tournoi dans usage_page et usage_api SANS clés étrangères : un tournoi supprimé n est jamais bloqué, purge 90 jours au boot ; rapport admin GET /api/admin/tournoi/usage (?tournoi_id= isolé au club sinon 404, 401 sans PIN) : adoption des inscrits (comptes ayant consulté), répartition des pages consultées (top 10), persistance après élimination (dernier match perdu), réactivité post-saisie (délai médian manche -> prochaine consultation), santé des API (échantillon 1/10 + toutes les erreurs, latence médiane ms), panneau illustré en tête du journal d audit + classement saison du club 26a (page publique /classement.html au menu après Stats, route GET /api/classement-saison : points de profondeur cumulés sur les tournois TERMINÉS du club, identité par compte sinon pseudo, ?annee= et liste des années disponibles, rang par points puis titres puis tournois, podium, lien vers la fiche joueur, i18n 4 langues) + saisons du club paramétrables 26b (le classement saison ne découpe plus à l année civile : préf admin saison_debut MM-JJ, défaut 09-01, 01-01 = année civile ; la saison 2026-2027 court du 1er septembre 2026 au 31 août 2027, les tournois de juillet et d août comptent dans la saison d avant ; réponse /api/classement-saison avec saisons {annee, label} et sélecteur « Saison 2026-2027 ») + portail du club 27a (news du club rédigées depuis la page dédiée /admin-actu.html de la table de marque + calendrier des tournois à venir et passés avec champion, routes publiques GET /api/club-actu et GET /api/club-calendrier, isolation par club, actualité de 1 à 500 caractères épinglable en tête) + écriture multi-tournois 19c (création permise pendant un tournoi actif via le bouton ➕ Nouveau tournoi de la table de marque, actions de la table de marque ciblées par tournoi_id via le sélecteur du bandeau, sans cible 409 explicite jamais le plus grand id par accident, désinscription paiement et remplacement résolus depuis le joueur, tables partagées, un numéro occupé par un autre tournoi du club n est jamais réattribué, auto-lancement sur tous les tournois actifs du club, suppression ciblée avec confirm_pin, courses d inscription des comptes ciblées + zone de tables par tournoi 19d (champ 🎯 Zone de tables à la création, dans la modale ➕ Nouveau tournoi et dans le panneau des infos du tournoi, ex 1-4 pour l Open et 5-8 pour la consolande : attribution automatique ET choix manuel ne proposant QUE les tables de la zone, refus 400 explicite hors zone, zone normalisée 1,2,3,4 à l enregistrement, vide = toutes les tables + saisie rapide des scores 28a (champ UNIQUE prérempli 3-2 et distance dans la modale 24a remplaçant les prompts de score et de distance, ENTRÉE ou ✔ Valider, motif conservé, i18n 4 langues + statuts du sélecteur de tournoi 28b (Inscriptions ou En cours traduits à côté du nom de chaque tournoi actif du menu 19a) + wiring accessibilité 28c (labels cliquables via for=, Échap ferme les 3 modales, autofocus sur le premier champ, la langue de la page suit la langue choisie))))', r.status === 200 && rKz.status === 200 && r17k.data.logo === '' && r17k.data.logo_mode === 'les-deux' && r17k.data.description === '' && rB1.status === 200 && rB2.status === 200 && rB3.status === 200 && rB3.data.prefs && rB3.data.prefs.description.length === 500 && rB3.data.prefs.contact.length === 200 && rB4.status === 400 && rB5.status === 400 && rB6.status === 400 && rB7.status === 403 && svB1.status === 200 && ctB1.includes('image/png') && svB2.status === 200 && svB3.status === 204 && svB4.status === 204 && thB.status === 200 && thB.data.description.length === 500 && !('banniere' in thB.data) && !('tv_fond' in thB.data) && r.data.prefs && r.data.prefs.banniere === '' && r.data.prefs.tv_fond === '' && r.data.prefs.description === '' && r.data.prefs.contact === '' && cjs17k.includes('Favicon du club') && cjs17k.includes("fav17n.href = '/favicon.svg'") && cjs17k.includes('qsClub17n') && cjs17k.includes("'/leclub.html', 'club', 'Le club'") && lc17n.includes('club-panneau-17n') && lc17n.includes('/api/club-banniere') && lc17n.includes('club-desc-17n') && lc17n.includes('club-contact-17n') && lc17n.includes("nav('club')") && tv17n.includes('/api/club-tv-fond') && tv17n.includes('fond17n') && idx17n.includes('/api/club-banniere') && apa17l.includes('pref-banniere-import') && apa17l.includes('pref-fond-tv-import') && apa17l.includes('pref-desc-club') && apa17l.includes('pref-contact-club') && apa17l.includes('importerPhoto17n') && apa17l.includes('1600') && apa17l.includes('1280') && srv17k.includes("app.get('/api/club-banniere'") && srv17k.includes("app.get('/api/club-tv-fond'") && srv17k.includes('PHOTO_TAILLE_MAX') && srv17k.includes('res.status(204).end()') && srv17k.includes("app.use('/api/admin/club/prefs', express.json({ limit: '2mb' }))") && cjs17k.includes('"Le club": "The club"') && cjs17k.includes('"Le club": "El club"') && cjs17k.includes('"Le club": "Il club"') && cjs17k.includes('"Le club": "Der Club"') && cjs17k.includes('"Photo de fond de la TV": "TV background photo"') && cjs17k.includes('"Bannière de l accueil": "Home banner"') && spec17k.includes('17n. Identité visuelle du club') && ga17k.includes('Bannière de l accueil') && rm17k.includes('Identité visuelle du club (17n)') && cjs17k.includes('appliquerLogoClub') && cjs17k.includes('filigrane-logo') && cjs17k.includes('opacity:.1') && cjs17k.includes('ebpc_logo_club') && cjs17k.includes('logo-entete-club') && cjs17k.includes('logoModeValide') && apa17l.includes("id: 'pref-logo-import'") && apa17l.includes("id: 'pref-logo-mode'") && apa17l.includes('LOGOS_PRESETS') && apa17l.includes('8 * 1024 * 1024') && apa17l.includes('190000') && apa17l.includes('type MIME') && scl17k.includes('pref-logo-import-console') && scl17k.includes('8 * 1024 * 1024') && scl17k.includes('190000') && scl17k.includes('type MIME') && cjs17k.includes('"Logo refusé":') && scl17k.includes("logo: logo17k") && scl17k.includes("logo_mode: mode17k") && spec17k.includes('17k. Logo du club') && spec17k.includes('564 checks') && ga17k.includes('Logo du club') && rm17k.includes('Logo du club (17k)') && srv17k.includes("img-src 'self' data: blob:") && apa17l.includes('photo jusqu à 8 Mo') && apa17l.includes("id: 'pref-logo-img'") && scl17k.includes('pref-logo-img-console') && cjs17k.includes('Aperçu du logo retenu') && apa17l.includes('pref-logo-importe') && apa17l.includes('logoImporte17k') && scl17k.includes('logoImporte17kC') && cjs17k.includes('"Logo importé":') && cjs17k.includes('17k v9') && cjs17k.includes('repli club par défaut') && cjs17k.includes('Club inconnu') && adc17k.includes('Club inconnu') && srv17k.includes("'adresse' in req.body") && srv17k.includes('th17j.adresse') && apa17l.includes('pref-adresse') && apa17l.includes("t('Adresse par défaut du club')") && scl17k.includes('adresseI') && at17k.includes('prefs.adresse') && cjs17k.includes('"Adresse par défaut du club":') && adm17k.includes("href: '/admin-apparence.html'") && !adm17k.includes('panel-apparence') && spec17k.includes('admin-apparence.html') && ga17k.includes('admin-apparence.html') && rm17k.includes('Page Apparence dédiée (17l)') && r.data.prefs.icone === '' && !('icone' in thB.data) && mfo17o.status === 200 && ct17o.includes('application/manifest+json') && mfB17o && mfB17o.name === 'Club VM — Tournois' && mfB17o.start_url === '/?club=clubvm' && mfB17o.icons[0].src === '/icon-192.png' && mfZ17o && typeof mfZ17o.name === 'string' && mfZ17o.start_url === '/?club=ebpc' && icR17o.status === 200 && icR17o.redirected && icR17o.url.endsWith('/icon-192.png') && icZ17o > 0 && ri17o1.status === 200 && ri17o1.data.prefs.icone === png17n && icP17o.status === 200 && !icP17o.redirected && String(icP17o.headers.get('content-type') || '').includes('image/png') && mfI17o && mfI17o.icons[0].src === '/icone-clubvm.png' && ri17o2.status === 400 && ri17o3.status === 400 && ri17o4.status === 403 && srv17k.includes("app.get('/manifest.webmanifest'") && srv17k.includes("app.get('/api/club-icone'") && srv17k.includes('ICONE_DATA_RE') && srv17k.includes('application/manifest+json') && cjs17k.includes("mf17o.href = mfHref17t") && cjs17k.includes("at17o.href = atHref17t") && cjs17k.includes('"Icône du téléphone": "Phone icon"') && cjs17k.includes('"Icône du téléphone": "Icono del teléfono"') && cjs17k.includes('"Icône du téléphone": "Icona del telefono"') && cjs17k.includes('"Icône du téléphone": "Telefonsymbol"') && apa17l.includes('genererIconeClub17o') && apa17l.includes('icone: icone17o') && apa17l.includes("t('Icône du téléphone')") && spec17k.includes('Icône du club sur l écran du téléphone') && ga17k.includes('Icône du téléphone') && rm17k.includes('Icône du club sur l écran du téléphone (17o)') && mch17p.includes("const push = require('./push')") && mch17p.includes('autreConnu17p') && mch17p.includes('notifierProchainMatch17p(s.id)') && psh17p.includes('async function notifierProchainMatch17p') && psh17p.includes('Ton prochain match arrive') && psh17p.includes("tag: 'prochain-' + m.id") && psh17p.includes('corps17p') && psh17p.includes('notifierProchainMatch17p, notifierInscriptionAmi') && spec17k.includes('Notification du prochain match (17p') && rm17k.includes('Notification du prochain match (17p)') && rm17k.includes('| 50 |') && gu17p.includes('Ton prochain match arrive') && srv17k.includes("app.get('/api/club-splash'") && srv17k.includes('encoderPng17q') && srv17k.includes('decoderPng17q') && srv17k.includes('background_color: th17o.accent') && cjs17k.includes('apple-touch-startup-image') && cjs17k.includes('TAILLES_SPLASH_17Q') && sp17q.status === 200 && ct17q.includes('image/png') && sig17q === true && spZ17q > 300 && spB17q.status === 400 && typeof mfZ17o.background_color === 'string' && (mfZ17o.background_color || '')[0] === '#' && spec17k.includes('17q. écran de lancement') && rm17k.includes('| 51 |') && gu17p.includes('splash') && cjs17k.includes('aviserClubInconnu17r') && cjs17k.includes('club-badge-17r') && cjs17k.includes('Club inconnu ici, tu regardes le club par défaut') && adc17k.includes('slugPerdu17r') && spec17k.includes('17r. Étanchéité du contexte du club') && rm17k.includes('| 52 |') && gu17p.includes('badge du club')
    && psh17p.includes('urlClub17s')
    && psh17p.includes('clubIdDeJoueur17s')
    && psh17p.includes('payloadClub17s')
    && cjs17k.includes('clubParam17s')
    && cjs17k.includes('portent le club dans l URL')
    && cjs17k.includes("e.target.closest('a[href]')")
    && swj17s.includes('searchParams.get')
    && swj17s.includes('club du payload')
    && cons17k.includes("'/admin.html?club=' + encodeURIComponent")
    && spec17k.includes('17s. URLs du club')
    && rm17k.includes('| 53 |')
    && gu17p.includes('le bon club')
    && mpB17t.status === 200
    && mpC17t.includes('application/manifest+json')
    && mpT17t && mpT17t.name === 'Club VM — Tournois' && mpT17t.start_url === '/?club=clubvm' && mpT17t.icons[0].src === '/icone-clubvm.png'
    && mpZ17t && typeof mpZ17t.name === 'string' && mpZ17t.start_url === '/?club=ebpc'
    && icP17t.status === 200 && !icP17t.redirected && String(icP17t.headers.get('content-type') || '').includes('image/png')
    && icR17t.status === 200 && icR17t.redirected && icR17t.url.endsWith('/icon-192.png')
    && spT17t.status === 200 && spTCt17t.includes('image/png')
    && spTB17t.status === 400
    && srv17k.includes("app.get('/manifest-:slug17t.webmanifest'")
    && srv17k.includes("app.get('/icone-:slug17t.png'")
    && srv17k.includes("app.get('/splash/:slug17t/:dim17t'")
    && cjs17k.includes("'/splash/' + p17t + '/'")
    && cjs17k.includes('mfHref17t')
    && cjs17k.includes('atHref17t')
    && spec17k.includes('17t. Chemins du club')
    && rm17k.includes('| 54 |')
    && gu17p.includes('recrée-la depuis la page du club')
    && cjs17k.includes('ouvrirClub17v')
    && !cjs17k.includes('btnClub17v')
    && cjs17k.includes('club-selecteur-17v')
    && cjs17k.includes("u17v.searchParams.set('club', slug)")
    && !cjs17k.includes("'Choisir le club'")
    && !cjs17k.includes('"Choisir le club"')
    && cjs17k.includes('"Choisis ton club": "Pick your club"')
    && cjs17k.includes('"Choisis ton club": "Elige tu club"')
    && cjs17k.includes('"Choisis ton club": "Scegli il tuo club"')
    && cjs17k.includes('"Choisis ton club": "Wähle deinen Club"')
    && cjs17k.includes('"Un seul compte pour toute la plateforme : le même login dans tous les clubs.": "One account for the whole platform: the same login in every club."')
    && idx17n.includes('clubs-17v')
    && idx17n.includes("'Choisis ton club'")
    && idx17n.includes('ouvrirClub17v(c.slug)')
    && idx17n.includes("encodeURIComponent(c.slug)")
    && cpt17v.includes('Un seul compte pour toute la plateforme : le même login dans tous les clubs.')
    && spec17k.includes('17v. Accueil multi-clubs')
    && rm17k.includes('| 56 |')
    && gu17p.includes('sélecteur')
    && !cjs17k.includes("api('/api/clubs')")
    && mch17p.includes('17w')
    && spec17k.includes('17w. Tournois en parallèle (plus de verrou global sur le passage pret)')
    && rm17k.includes('| 57 |')
    && tirVm17w.status === 200 && tirSb17w.status === 200
    && pretVm17w.length >= 1 && pretSb17w.length >= 1
    && lanVm17w.status === 200 && lanSb17w.status === 200
    && plD20a && Array.isArray(plD20a.clubs) && plD20a.clubs.length >= 2 && Array.isArray(plD20a.tournois) && plD20a.tournois.length >= 2 && plD20a.tournois.every((tt) => tt.club_slug && tt.club_nom)
    && pjD20a && Array.isArray(pjD20a.joueurs) && pjD20a.joueurs.length === 1 && pjD20a.joueurs[0].pseudo === 'VmA17w' && pjD20a.joueurs[0].clubs.length === 1 && pjD20a.joueurs[0].clubs[0].slug === 'clubvm'
    && srv17k.includes("app.get('/api/plateforme', (req, res)") && srv17k.includes("app.get('/api/plateforme/joueurs', (req, res)") && srv17k.includes("start_url: '/?club=' + encodeURIComponent(club17o.slug)") && srv17k.includes("start_url: '/?club=' + encodeURIComponent(club17t.slug)")
    && cjs17k.includes('pageSansClub20a') && idx17n.includes('initHub20a') && idx17n.includes('/api/plateforme') && jp20a.includes('/api/plateforme/joueurs') && jp20a.includes("nav('')") && jp20a.includes('/joueur.html?id=')
    && spec17k.includes('20a. Hub plateforme') && rm17k.includes('| 65 |') && gu17p.includes('hub de la plateforme')
    && phT20b.includes('initHub20a') && phT20b.includes('CLUB_EXPLICITE_20A')
    && cjs17k.includes("location.href = '/?hub=1'") && cjs17k.includes('[?&]hub=') && cjs17k.includes('btnPlateforme20b') && cjs17k.includes('"Hub de la plateforme": "Platform hub"')
    && idx17n.includes("&& !p20b.get('hub')")
    && spec17k.includes('20b. Retour au hub') && rm17k.includes('| 66 |') && gu17p.includes('logo bille 8 en haut à gauche du bandeau')
    && cjs17k.includes("searchParams.delete('hub')") && spec17k.includes('20b v2') && rm17k.includes('20b v2') && gu17p.includes('retire le retour hub')
    && tv17n.includes('LIVE_PAR_PAGE = 12') && tv17n.includes('SLIDE_MS = 20000') && tv17n.includes('dataset.cols') && tv17n.includes("'--tvs'")
    && sty21a.includes('.tv-live-grid[data-cols="1"]') && sty21a.includes('.tv-live-grid[data-cols="2"]') && sty21a.includes('.tv-live-grid[data-cols="3"]') && sty21a.includes('var(--tvs, 1)') && sty21a.includes('.tv-live-grid[data-cols] { grid-template-columns: repeat(2, 1fr); max-width: none; }')
    && spec17k.includes('21a. TV adaptative') && rm17k.includes('| 67 |') && gu17p.includes('12 matchs')
    && tv17n.includes("nb21a <= 2 ? '2' : nb21a <= 4 ? '1.6'") && sty21a.includes('.tv-live-grid[data-cols="1"] .tv-live-cell, .tv-live-grid[data-cols="2"] .tv-live-cell { text-align: center; padding: 18px 28px; }') && sty21a.includes('.tv-live-grid[data-cols="1"] .tv-live-cell .cell-code, .tv-live-grid[data-cols="2"] .tv-live-cell .cell-code { justify-content: center; gap: 18px; }') && spec17k.includes('réellement agrandis') && rm17k.includes('v2: grandes cartes') && gu17p.includes('textes agrandis et centrés')
    && cjs17k.includes('logo-plateforme-22a') && !cjs17k.includes('clubsNav17v') && sty21a.includes('.logo-plateforme-22a')
    && spec17k.includes('22a. Bandeau allégé') && rm17k.includes('| 68 |') && gu17p.includes("le bandeau n'affiche plus de sélecteur de club")
    && remp23a.status === 200 && etVm17w.joueurs.some((j) => j.pseudo === 'VmZ23a') && !etVm17w.joueurs.some((j) => j.pseudo === 'VmA17w')
    && etVm17w.matchs.some((m) => (m.joueur1 ? m.joueur1.pseudo : '') === 'VmZ23a' || (m.joueur2 ? m.joueur2.pseudo : '') === 'VmZ23a')
    && !etVm17w.matchs.some((m) => (m.joueur1 ? m.joueur1.pseudo : '') === 'VmA17w' || (m.joueur2 ? m.joueur2.pseudo : '') === 'VmA17w')
    && pris23a.status === 409 && autre23a.status === 404 && rempApres23a.status === 409
    && srv17k.includes("'/api/admin/joueur/:id/remplace'")
    && at17k.includes('/remplace') && at17k.includes('👥 Joueurs')
    && spec17k.includes('23a. Remplacement d un joueur après le tirage') && rm17k.includes('| 69 |') && ga17k.includes('Remplacer un joueur après le tirage')
    && susp23b.status === 200 && rempSusp23b.status === 200 && rela23b.status === 200
    && et23b && et23b.matchs.some((m) => m.etat === 'en_cours' && ((m.joueur1 ? m.joueur1.pseudo : '') === 'VmX23a' || (m.joueur2 ? m.joueur2.pseudo : '') === 'VmX23a'))
    && srv17k.includes("'/api/admin/match/:id/suspendre'") && mch17p.includes('suspendreMatch')
    && at17k.includes('⏸ Suspendre')
    && spec17k.includes('23b. Suspension d un match lancé à 0 manche jouée') && rm17k.includes('| 70 |') && ga17k.includes('Suspendre un match 0-0')
    && at17k.includes('openGestion24a') && at17k.includes('⚙️ Gérer') && at17k.includes('Partager le match') && at17k.includes('match.html?id=')
    && !at17k.includes("class: 'actions' }, sel, el('button'") && !at17k.includes('onclick: () => corriger(m)') && !at17k.includes('onclick: () => forfait(m, m.joueur1.id)') && !at17k.includes('onclick: () => suspendre(m)')
    && lien24aOk
    && lien24bOk
    && sty21a.includes('background: linear-gradient(90deg, var(--pink), var(--pink-soft))') && !sty21a.includes('color: var(--pink-soft);\n  -webkit-background-clip: text; background-clip: text; color: transparent;') && cjs17k.includes('h1b17r.append(bd17r)') && cjs17k.includes('max-width:58vw') && cjs17k.includes('24b')
    && spec17k.includes('24b. Bandeau club côte à côte') && rm17k.includes('| 72 |') && ga17k.includes('consultable par tout le monde')
    && cjs17k.includes('24c') && cjs17k.includes("'🎱 Pink City Billard'") && cjs17k.includes('bd24c.remove()') && spec17k.includes('24c. Le club remplace la marque du bandeau') && rm17k.includes('| 73 |') && gu17p.includes('nom du club comme titre du bandeau')
    && u31.status === 204 && u31b.status === 204
    && u31d && u31d.usage && u31d.usage.tournoi && typeof u31d.usage.tournoi.nom === 'string'
    && u31d.usage.pages && u31d.usage.pages.total >= 2
    && Array.isArray(u31d.usage.par_page) && u31d.usage.par_page.some((p) => p.page === 'tableau')
    && u31d.usage.adoption && typeof u31d.usage.adoption.inscrits === 'number'
    && u31d.usage.persistance && u31d.usage.reactivite && u31d.usage.sante
    && u31d.usage.sante.requetes >= 1
    && u31r401.status === 401 && u31i.status === 404
    && srv17k.includes("app.post('/api/usage'")
    && srv17k.includes("app.get('/api/admin/tournoi/usage'")
    && srv17k.includes('usageApi31')
    && dbf31.includes('CREATE TABLE IF NOT EXISTS usage_page')
    && dbf31.includes('CREATE TABLE IF NOT EXISTS usage_api')
    && dbf31.includes('purge usage')
    && cjs17k.includes('envoyerUsage31')
    && aju31.includes('Rapport d usage du tournoi')
    && aju31.includes('/api/admin/tournoi/usage')
    && spec17k.includes('31. Rapport d usage par tournoi (KPI)')
    && rm17k.includes('| 31 |') && rm17k.includes('✅ fait (beacon sans cookie')
    && ga17k.includes('Rapport d usage du tournoi (31)')
    && cr26a.status === 200 && csa26a.status === 200
    && csa26a.data && Array.isArray(csa26a.data.classement) && csa26a.data.classement.length >= 2
    && csa26a.data.classement[0].rang === 1 && csa26a.data.classement[0].points > 0
    && csa26a.data.classement.some((c26) => c26.titres >= 1)
    && Array.isArray(csa26a.data.annees) && csa26a.data.annees.length >= 1
    && !hist26b.some((ht26) => ht26.nom === 'T26a')
    && srv17k.includes("app.get('/api/classement-saison'") && srv17k.includes('function classementSaison')
    && cjs17k.includes("'/classement.html', 'classement', 'Classement saison'")
    && cjs17k.includes('"Classement saison": "Season ranking"') && cjs17k.includes('"Classement saison": "Clasificación de temporada"') && cjs17k.includes('"Classement saison": "Classifica di stagione"') && cjs17k.includes('"Classement saison": "Saisonrangliste"')
    && clf26a.includes('/api/classement-saison') && clf26a.includes("nav('classement')") && clf26a.includes('table-wrap')
    && spec17k.includes('26a. Classement saison du club')
    && rm17k.includes('| 74 |')
    && gu17p.includes('Classement saison')
    && sd26bNul.status === 400 && sd26bFev.status === 400
    && sd26bFev29.status === 200 && sd26b3112.status === 200 && sd26b0101.status === 200 && sd26bRetab.status === 200
    && sdb31.status === 200 && sdb31.data && sdb31.data.prefs && sdb31.data.prefs.saison_debut === '12-31'
    && csa26b.status === 200 && Array.isArray(csa26b.data.saisons) && csa26b.data.saisons.length >= 1
    && csa26b.data.saisons[0].annee === String(annee26bd) && csa26b.data.saisons[0].label === annee26bd + '-' + (annee26bd + 1)
    && String(csa26c.status) === '200' && Array.isArray(csa26c.data.classement) && csa26c.data.classement.length >= 2
    && csa26d.status === 200 && Array.isArray(csa26d.data.classement) && csa26d.data.classement.length === 0
    && csa26e.status === 200 && csa26e.data.saisons[0].label === String(annee26civil)
    && srv17k.includes('saison_debut') && srv17k.includes('anneeDebutSaison26b') && srv17k.includes('saisonDebutValide26b')
    && clf26a.includes('Toutes les saisons') && clf26a.includes('s.label')
    && apa17l.includes('pref-saison-debut') && apa17l.includes("t('Début de saison du classement')")
    && cjs17k.includes('"Début de saison du classement": "Ranking season start"') && cjs17k.includes('"Début de saison du classement": "Inicio de temporada del ranking"') && cjs17k.includes('"Début de saison du classement": "Inizio stagione del ranking"') && cjs17k.includes('"Début de saison du classement": "Saisonbeginn des Rankings"')
    && spec17k.includes('26b. Saisons du club paramétrables')
    && rm17k.includes('| 75 |')
    && ga17k.includes('Début de saison du classement')
    // 27a. Portail du club : news rédigées depuis la page dédiée + calendrier des tournois
    && na27a.status === 400 && na27p.status === 400
    && n27a.status === 200 && n27a.data && n27a.data.actu && n27a.data.actu.id > 0
    && n27b.status === 200 && n27b.data && n27b.data.actu && n27b.data.actu.epingle === 1
    && l27a.status === 200 && l27a.data && Array.isArray(l27a.data.actus) && l27a.data.actus.length >= 2
    && l27a.data.actus[0].epingle === 1 && l27a.data.actus.some((a27g) => (a27g.texte || '').includes('Bienvenue au club'))
    && l27i.status === 200 && l27i.data && Array.isArray(l27i.data.actus) && l27i.data.actus.length === 0
    && u27a.status === 200 && u27x.status === 404
    && k27a.status === 200 && k27a.data && Array.isArray(k27a.data.passes) && k27a.data.passes.some((t27g) => t27g.nom === 'T26a' && t27g.champion === 'J26a')
    && d27x.status === 404 && d27b.status === 200 && d27a.status === 200
    && l27apres.status === 200 && l27apres.data && Array.isArray(l27apres.data.actus) && l27apres.data.actus.length === 0
    && srv17k.includes("app.get('/api/club-actu'") && srv17k.includes("app.get('/api/club-calendrier'")
    && srv17k.includes("app.post('/api/admin/club/actu'") && srv17k.includes("app.put('/api/admin/club/actu/:id'") && srv17k.includes("app.delete('/api/admin/club/actu/:id'")
    && db27a.includes('CREATE TABLE IF NOT EXISTS actu')
    && lc17n.includes('club-actus-27a') && lc17n.includes('club-calendrier-27a')
    && acl27a.includes("api('/api/club-actu')") && acl27a.includes('actu-texte-27a') && acl27a.includes('renderAdminLogin')
    && adm17k.includes('/admin-actu.html')
    && spec17k.includes('27a. Portail du club')
    && rm17k.includes('| 76 |')
    && ga17k.includes('News du club')
    && gu17p.includes('news du club')
    // 19c. Écriture multi-tournois dans le même club : statuts du runtime + gardes de code et docs
    && cr19c1.status === 200 && cr19c2.status === 200 && cr19c3.status === 200 && nr19c1 > 0 && nr19c2 > 0 && nr19c3 > 0
    && ins19c409.status === 409 && insA19c.status === 200 && insB19c.status === 200 && insC19c.status === 200 && insD19c.status === 200 && insX19c.status === 404
    && tirSans19c.status === 409 && tirT1.status === 200 && tirX19c.status === 404 && tirRe19c.status === 409 && tirT2.status === 200
    && lanT1.status === 200 && lanVoisin.status === 409 && lanT2.status === 200 && lanT2.data && lanT2.data.match && lanT2.data.match.table === 2
    && delSans19c.status === 409 && delT3.status === 200
    && termSans.status === 409 && termT1.status === 200 && etT2apres && etT2apres.tournoi && etT2apres.tournoi.statut === 'en_cours' && termT2.status === 200
    && apres19c && apres19c.actif === null && !(apres19c.historique || []).some((tt) => tt.nom === 'T19c1' || tt.nom === 'T19c2' || tt.nom === 'T19c3')
    && srv17k.includes('tournoiCibleOuErreur19c') && srv17k.includes('tournoisActifs19c') && srv17k.includes('tournoiInscription19c')
    && srv17k.includes('PLUS DE VERROU') && !srv17k.includes('Un tournoi est encore actif')
    && mch17p.includes('numerosOccupesClub19c') && mch17p.includes('clubIdDuTournoi19c') && mch17p.includes('tournoi voisin')
    && cpt19c.includes('tournoiInscription19c') && cpt19c.includes('Plusieurs tournois sont ouverts aux inscriptions')
    && cjs17k.includes('avecTournoiCible19c')
    && adc17k.includes('api(urlEtat19a())') // 19c: la table de marque ouvre le tournoi choisi
    && idx17n.includes('avecTournoiCible19c') && idx17n.includes('inscrire')
    && at17k.includes('avecTournoiCible19c') && at17k.includes('CE tournoi et tout son contenu') && at17k.includes('ouvrirCreation19c')
    && spec17k.includes('19c. Écriture multi-tournois')
    && rm17k.includes('| 77 |')
    && ga17k.includes('Plusieurs tournois actifs')
    && gu17p.includes('plusieurs tournois')
    && spec17k.includes('24a. Gestion des matchs par modale') && rm17k.includes('| 71 |') && ga17k.includes('Partager un match')
    && srv17k.includes('zone_tables') && srv17k.includes('Zone hors des') && srv17k.includes('Zone de tables invalide')
    && mch17p.includes('parserZone19d') && mch17p.includes('zoneTables19d') && mch17p.includes('Table hors zone de ce tournoi')
    && dbZ19d.includes('zone_tables TEXT')
    && at17k.includes('zoneTablesFront19d') && at17k.includes('Zone de tables') && at17k.includes('edit-zone') && at17k.includes("id: 'zone'")
    && spec17k.includes('19d. Zone de tables par tournoi') && rm17k.includes('| 78 |') && rm17k.includes('Zone de tables par tournoi (19d)')
    && crZ1.status === 200 && crZ2.status === 200 && nrZ1 > 0 && nrZ2 > 0 && crZInv.status === 400 && crZHors.status === 400
    && etZ1 && etZ1.tournoi && etZ1.tournoi.zone_tables === '1,2' && etZ2 && etZ2.tournoi && etZ2.tournoi.zone_tables === '3,4'
    && tirZ1.status === 200 && tirZ2.status === 200 && lanZ1.status === 200 && (numZ1 === 1 || numZ1 === 2) && lanZ2.status === 200 && (numZ2 === 3 || numZ2 === 4)
    && lanHorsZone.status === 400 && setHorsZone.status === 400 && upZInv.status === 400
    && upZok.status === 200 && etZ2b && etZ2b.tournoi && etZ2b.tournoi.zone_tables === '4'
    && upZvide.status === 200 && etZ2c && etZ2c.tournoi && etZ2c.tournoi.zone_tables === null
    && ga17k.includes('Zone de tables')
    && termZ1.status === 200 && termZ2.status === 200
    && at17k.includes('id: `score-') && at17k.includes("'✔ Valider'") && at17k.includes("val('distance-' + m.id)") && at17k.includes('28a: le champ UNIQUE')
    && cjs17k.includes('"⚖️ Correction du score": "⚖️ Score correction"') && cjs17k.includes('"Score (ex : 3-2)": "Score (e.g. 3-2)"')
    && spec17k.includes('28a. Saisie rapide des scores') && rm17k.includes('| 79 |') && ga17k.includes('saisie rapide du score')
    && cjs17k.includes("t(tn.statut === 'inscription' ? 'Inscriptions' : 'En cours')") && cjs17k.includes('for (const tn of tournoisNav19a)')
    && spec17k.includes('28b. Statuts dans le sélecteur de tournoi du bandeau') && rm17k.includes('| 80 |') && ga17k.includes('depuis 28b')
    && at17k.includes("if (e.key === 'Escape') fermer();") && at17k.includes("for: 'champion'") && at17k.includes("document.getElementById('nom').focus(); // 28c")
    && at17k.includes("removeEventListener('keydown', surEchap)") && at17k.includes("(estEnCours ? document.getElementById('score-' + m.id) : sel).focus()") && cpt17v.includes("for: 'c-pseudo'")
    && cjs17k.includes('document.documentElement.lang') && spec17k.includes('28c. Wiring accessibilité') && rm17k.includes('| 85 |') && ga17k.includes('la touche Échap ferme')
    , JSON.stringify([r.status, rKz.status, r17k.data, tirVm17w.status, tirSb17w.status, lanVm17w.status, lanSb17w.status, remp23a.status, pris23a.status, autre23a.status, rempApres23a.status, susp23b.status, rempSusp23b.status, rela23b.status, lien24aOk, lien24bOk, nrZ1, nrZ2, numZ1, numZ2, crZInv.status, crZHors.status, lanHorsZone.status, setHorsZone.status, upZInv.status, upZok.status, etZ2b && etZ2b.tournoi ? etZ2b.tournoi.zone_tables : 'x', etZ2c && etZ2c.tournoi ? etZ2c.tournoi.zone_tables : 'x']));

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
  check('style.css: theme clair (variables + header + liens bracket) + gros score lisible des 2 themes (17j v4: degrade ancre sur var(--text), JAMAIS d override shorthand background: seul sur .scoreboard .s: il reset background-clip -> zone bleue sans chiffres en theme clair)', css19.includes('html[data-theme="light"]') && css19.includes('path.to-wb') && css19.includes('.scoreboard .s') && css19.includes('header.top') && css19.includes('--pink-fort') && css19.includes('linear-gradient(180deg, var(--text), var(--pink-soft))') && !css19.includes('data-theme="light"] .scoreboard .s { background:'), '');
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
  check('push: notifications traduites par destinataire (compte.lang persiste par le selecteur, payloads fr/en: match lance, ami, inscription, test, creation/rappel tournoi; repli hint X-Lang pour le test manuel; position du selecteur a l extremite opposee du menu principal)', db19.includes('ADD COLUMN lang') && cpts19.includes("['fr', 'en', 'es', 'it', 'de'].includes(req.body.lang)") && cjs18.includes('JSON.stringify({ lang: l })') && push19.includes("You're up!") && push19.includes("A friend's match") && push19.includes('Notification test') && srv19.includes('New tournament — registration open') && srv19.includes('Reminder — registration open') && unit19.includes('i18n par destinataire') && cjs18.includes('wrap, btnCompte, btnLang, btnTournoi19a'), '');
  check('i18n: push etendus es/it/de + dictionnaires 5 langues (payloads Te toca jugar / Notifica di prova / Testbenachrichtigung / Spiel eines Freundes läuft, creation tournoi traduite, STATIQUES_ES serveur, I18N_ES front, test unitaire i18n etendu)', push19.includes('Te toca jugar') && push19.includes('Notifica di prova') && push19.includes('Testbenachrichtigung') && push19.includes('Spiel eines Freundes läuft') && srv19.includes('Nuevo torneo — inscripciones abiertas') && srv19.includes('Nuovo torneo — iscrizioni aperte') && srv19.includes('Neues Turnier — Anmeldung offen') && fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.js'), 'utf8').includes('STATIQUES_ES') && cjs18.includes('const I18N_ES') && cjs18.includes('const I18N_IT') && cjs18.includes('const I18N_DE') && cjs18.includes('const REPS_DYN_ES') && unit19.includes('i18n étendu'), '');
  check('front: selecteur de langue 5 entrees dans le bandeau (FR/EN/ES/IT/DE data-driven via LANGUES, drapeaux + libelles natifs, bouton = code langue courante)', cjs18.includes('const LANGUES') && cjs18.includes("['fr','🇫🇷','Français']") && cjs18.includes('Español') && cjs18.includes('Italiano') && cjs18.includes('Deutsch') && cjs18.includes("['en','es','it','de'].includes(v)"), '');
  check('i18n: couverture complete (~490 entrees + regles dynamiques dans common.js)', (cjs18.match(/": "/g) || []).length >= 450 && cjs18.includes('const I18N_DYN') && (cjs18.match(/\[\//g) || []).length >= 60, '');
  check('i18n: appels admin traduits aussi (X-Lang dans adminHeaders de admin-common.js + adminCall)', fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-common.js'), 'utf8').includes('X-Lang') && cjs18.includes('X-Lang'), '');
  const at19 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-tournoi.html'), 'utf8');
  check('front: burger compte a entrees dynamiques vers des pages dediees (login/register/parametres hors connexion, parametres/amis/mes matchs/ma fiche/deconnexion connecte, table de marque seule si role admin) + checkboxes toggle-mini + append filtre null', cjs18.includes('menuDeroulant') && cjs18.includes('nav-login') && cjs18.includes('/compte.html#connexion') && cjs18.includes('/compte.html#creer') && cjs18.includes('/parametres.html') && cjs18.includes('/amis.html') && cjs18.includes('/mes-matchs.html') && cjs18.includes('compteNav.role') && !cjs18.includes("href: '/admin-comptes.html'") && !cjs18.includes("href: '/admin-journal.html'") && cpte19.includes("id: 'connexion'") && cpte19.includes("id: 'creer'") && cv19.includes('].filter(Boolean));') && css19.includes('input[type="checkbox"].toggle-mini') && (cv19.split("type: 'checkbox', class: 'toggle-mini'").length - 1) >= 2 && (at19.split("type: 'checkbox', class: 'toggle-mini'").length - 1) === 9, ''); // 81: +2 cases consolante, 82: +1 case alertes -> 9 toggle-mini
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
  const idx20 = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8') // 86: helpers du fil dans common.js;
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
  const idx21 = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8') // 86: helpers du fil dans common.js;
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
  check('fil: i18n - 4 tableaux toujours alignés après les 47 règles du fil (dont 4 séries 83) + règle Reçu du refus logo 17k v5 (cDyn = 125)', cDyn(dynSrc) === cReps(repsES) && cReps(repsES) === cReps(repsIT) && cReps(repsIT) === cReps(repsDE) && cDyn(dynSrc) === 125, `${cDyn(dynSrc)} / ${cReps(repsES)} / ${cReps(repsIT)} / ${cReps(repsDE)}`);
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
  const idx23 = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8') // 86: helpers du fil dans common.js;
  check('audit: sources cohérentes (colonne « Par » dans admin-journal.html, auteurAdmin(req) sur les routes et corrections/forfaits, colonne auteur en base, aucune trace compte_preferences, burger Compte sans emojis traduit)', aj23.includes("'Par'") && aj23.includes('a.auteur ||') && srv23.includes('function auteurAdmin(req)') && srv23.includes("motif || '', auteurAdmin(req))") && srv23.includes('M.declarerForfait(mid, jid, auteurAdmin(req))') && msrc23.includes('function corrigerScore(matchId, score1, score2, manches, motif, auteur)') && msrc23.includes('function declarerForfait(matchId, forfaitJoueurId, auteur)') && db23.includes('ALTER TABLE audit_log ADD COLUMN auteur TEXT') && !cpts23.includes('compte_preferences') && cjs20.includes("}, 'Compte');") && cjs20.includes("}, 'Connexion'));") && cjs20.includes("}, 'Mes matchs'));") && cjs20.includes('"Mes matchs": "My matches"') && cjs20.includes('"Connexion": "Log in"') && !cjs20.includes("'👤 Compte'") && idx23.includes('Aucun ami — ajoute-en depuis le menu Compte.'), '');

  // ---------- 24. Tableaux responsive : enveloppe .table-wrap (scroll horizontal dans le panneau) ----------
  sec('24. Tableaux responsive : enveloppe .table-wrap, bordures du panneau complètes sur petit écran');
  const css24 = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const stH24 = fs.readFileSync(path.join(__dirname, '..', 'public', 'stats.html'), 'utf8');
  const jrH24 = fs.readFileSync(path.join(__dirname, '..', 'public', 'joueur.html'), 'utf8');
  const acH24 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-comptes.html'), 'utf8');
  check('tableaux: règle .table-wrap dans style.css (overflow-x: auto, défilement fluide mobile) + table des stats enveloppée', css24.includes('.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }') && stH24.includes("el('div', { class: 'table-wrap' }, el('table', { class: 'audit' }"), '');
  check("tableaux: fiche joueur (face-à-face + historique), journal d'audit, classement du compte et comptes admin tous enveloppés .table-wrap", jrH24.includes("el('div', { class: 'table-wrap' }, tblH2H)") && (jrH24.includes("el('div', { class: 'table-wrap' }, el('table', { class: 'audit' }") || jrH24.includes("el('div', { class: 'table-wrap' }, tblHist)")) && jrH24.includes("el('div', { class: 'table-wrap' }, tblH2H)") && aj23.includes("el('div', { class: 'table-wrap' }, el('table', { class: 'audit' }") && cjs20.includes("el('div', { class: 'table-wrap' }, el('table', { class: 'audit' }") && acH24.includes("el('div', { class: 'table-wrap' }, el('table', { style: 'width:100%;border-collapse:collapse' }"), '');

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
  // ---------- 81. Tournoi consolante automatique ----------
  sec('81. Consolante automatique (case a la creation, N tours, tirage auto, perdants cables LB, fin propre, suppression en cascade)');
  await del('/api/admin/tournoi').catch(() => {});
  r = await post('/api/admin/tournoi', { nom: 'ConsD', regle: 'blackball', taille: 16, format: 'double', consolante: true, consolante_tours: 2 });
  check('81: consolante refusee en double KO -> 400', r.status === 400 && /simple/.test(r.data.error || ''), r.status + ' ' + (r.data.error || ''));
  r = await post('/api/admin/tournoi', { nom: 'ConsX', regle: 'blackball', taille: 16, format: 'simple', consolante: true, consolante_tours: 9 });
  check('81: consolante_tours hors 1..3 -> 400', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await post('/api/admin/tournoi', { nom: 'ConsA', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 4, consolante: true, consolante_tours: 2, notif_push: false });
  check('81: creation avec consolante 2 tours -> 200, consolante_tours=2 stocke', r.status === 200 && r.data.actif.tournoi.consolante_tours === 2, r.status + ' ' + (r.data.error || ''));
  const main81id = r.data.actif.tournoi.id;
  r = await put('/api/admin/tournoi', { tournoi_id: main81id, consolante_tours: 1 });
  check('81: PUT consolante_tours=1 en phase inscription -> 200', r.status === 200 && r.data.actif.tournoi.consolante_tours === 1, r.status + ' ' + (r.data.error || ''));
  r = await put('/api/admin/tournoi', { tournoi_id: main81id, consolante_tours: 7 });
  check('81: PUT consolante_tours=7 -> 400', r.status === 400, r.status);
  await post('/api/admin/joueurs/simulation', { tournoi_id: main81id, count: 8, prefix: 'C' });
  let t81 = (await api('/api/etat')).data.actif;
  for (const j of t81.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  r = await post('/api/admin/tirage', { tournoi_id: main81id });
  check('81: tirage du principal -> 200', r.status === 200, r.status + ' ' + (r.data.error || ''));
  const etat81 = (await api('/api/etat')).data;
  const main81 = etat81.actif.tournoi; // actif par defaut = le principal, pas la consolante
  check('81: actif par defaut = principal (est_consolante=0), consolante liee', main81.id === main81id && main81.est_consolante === 0 && main81.consolante_id != null, JSON.stringify({ id: main81.id, cid: main81.consolante_id }));
  check('81: 2 tournois actifs listes (principal + consolante)', etat81.actifs.length === 2 && etat81.actifs.some(a => a.nom.includes('Consolante')), JSON.stringify(etat81.actifs));
  const cons81 = (await api(`/api/etat?tournoi_id=${main81.consolante_id}`)).data.actif;
  check('81: consolante creee au tirage (en_cours, est_consolante=1, LB+F sans WB)', cons81.tournoi.est_consolante === 1 && cons81.tournoi.statut === 'en_cours' && cons81.matchs.length > 0 && cons81.matchs.every(m => m.bracket !== 'WB') && cons81.matchs.some(m => m.bracket === 'LB') && cons81.matchs.some(m => m.bracket === 'F'), JSON.stringify(cons81.matchs.map(m => m.bracket + m.tour)));
  const mainMatchs81 = (await api(`/api/etat?tournoi_id=${main81id}`)).data.actif.matchs;
  const wb1_81 = mainMatchs81.filter(m => m.bracket === 'WB' && m.tour === 1);
  check('81: perdants WB1 du principal cables vers la consolante (perdant_id renseigne)', wb1_81.length > 0 && wb1_81.every(m => m.perdant_id != null), wb1_81.length + ' matchs');
  const m81 = wb1_81.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
  const perdant81 = m81.joueur2.id;
  await post(`/api/admin/match/${m81.id}/lancer`, { table_id: null });
  await api(`/api/match/${m81.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m81.joueur1.id } });
  for (let i = 0; i < m81.manches; i++) await api(`/api/match/${m81.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: m81.joueur1.id } });
  const consApres81 = (await api(`/api/etat?tournoi_id=${main81.consolante_id}`)).data.actif;
  const lb1_81 = consApres81.matchs.filter(m => m.bracket === 'LB' && m.tour === 1);
  check('81: perdant du WB1 propage dans un slot LB1 de la consolante', lb1_81.some(m => (m.joueur1 && m.joueur1.id === perdant81) || (m.joueur2 && m.joueur2.id === perdant81)), JSON.stringify(lb1_81.map(m => [m.joueur1 && m.joueur1.id, m.joueur2 && m.joueur2.id])));
  for (const tid of [main81id, main81.consolante_id]) { await post('/api/admin/simuler', { tournoi_id: tid }).catch(() => {}); }
  for (const tid of [main81id, main81.consolante_id]) { await post('/api/admin/simuler', { tournoi_id: tid }).catch(() => {}); }
  const hist81 = (await api('/api/etat')).data.historique;
  const hMain81 = hist81.find(h => h.id === main81id), hCons81 = hist81.find(h => h.id === main81.consolante_id);
  check('81: principal et consolante termines, chacun avec son champion', !!(hMain81 && hCons81 && hMain81.statut === 'termine' && hCons81.statut === 'termine' && hMain81.champion && hCons81.champion && hCons81.est_consolante === 1), JSON.stringify(hist81.map(h => [h.id, h.statut, h.champion])));
  r = await del(`/api/admin/tournoi/${main81id}`);
  const histApres81 = (await api('/api/etat')).data.historique;
  check('81: suppression du principal -> consolante supprimee aussi (cascade)', r.status === 200 && !histApres81.some(h => h.id === main81id || h.id === main81.consolante_id), r.status + ' ' + JSON.stringify(histApres81.map(h => h.id)));
  const at81 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-tournoi.html'), 'utf8');
  const srv81 = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const br81 = fs.readFileSync(path.join(__dirname, '..', 'src', 'bracket.js'), 'utf8');
  check('81: front (case consolante + champ tours dans les 2 formulaires + chip liee) + serveur (validation 400, tirage auto, cascade) + bracket (structureConsolante LB+F redimensionne)', at81.includes("id: 'consolante'") && at81.includes("id: 'consolante-tours'") && (at81.match(/consolante: document\.getElementById/g) || []).length === 2 && srv81.includes('consolante_creee') && srv81.includes('genererBracketConsolante') && br81.includes('function structureConsolante') && br81.includes('function genererBracketConsolante') && srv81.includes('est_consolante'), '');

  // ---------- 82. Alertes table de marque (push aux admins du club) ----------
  sec('82. Alertes table de marque (seuils regles, alerte match long + table libre, une fois, audit sans snapshot, 401 sans PIN)');
  await del('/api/admin/tournoi').catch(() => {});
  r = await api('/api/admin/alertes', { method: 'POST', pin: null, body: { on: true, match_min: 60, table_min: 30 } });
  check('82: POST /api/admin/alertes sans PIN -> 401', r.status === 401, r.status);
  let e82 = (await api('/api/etat')).data;
  check('82: etat expose alertes par defaut (on, 60/30)', !!(e82.alertes && e82.alertes.on === true && e82.alertes.match_min === 60 && e82.alertes.table_min === 30), JSON.stringify(e82.alertes));
  r = await post('/api/admin/alertes', { on: 'x', match_min: 60, table_min: 30 });
  check('82: on invalide -> 400', r.status === 400, r.status);
  r = await post('/api/admin/alertes', { on: true, match_min: 999, table_min: 30 });
  check('82: match_min > 240 -> 400', r.status === 400, r.status);
  r = await post('/api/admin/alertes', { on: true, match_min: 0, table_min: 0 }); // seuils 0 = alerte immediate (test)
  check('82: POST alertes {on:true, 0, 0} -> 200 + etat relu + audit alerte_modifiee', r.status === 200 && r.data.alertes && r.data.alertes.match_min === 0 && r.data.alertes.table_min === 0, r.status + ' ' + JSON.stringify(r.data.alertes));
  r = await post('/api/admin/tournoi', { nom: 'AlA', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  const t82id = r.data.actif.tournoi.id;
  await post('/api/admin/joueurs/simulation', { tournoi_id: t82id, count: 4, prefix: 'A' });
  let t82 = (await api('/api/etat')).data.actif;
  for (const j of t82.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  await post('/api/admin/tirage', { tournoi_id: t82id });
  t82 = (await api(`/api/etat?tournoi_id=${t82id}`)).data.actif;
  const m82 = t82.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
  await post(`/api/admin/match/${m82.id}/lancer`, { table_id: t82.tables[0].id }); // broadcast: match_min=0 -> alerte match long
  let a82 = (await api('/api/admin/audit?action=alerte_match_long')).data.audit || [];
  check('82: match en cours + seuil 0 -> alerte_match_long auditee (cible wb1, match_id, SANS snapshot)', a82.length >= 1 && a82.some(x => x.cible.includes('wb1') && x.has_snapshot === 0 && JSON.parse(x.apres || '{}').match_id === m82.id), JSON.stringify(a82.map(x => [x.action, x.cible, x.has_snapshot])));
  await api(`/api/match/${m82.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m82.joueur1.id } }); // broadcast 2: table 2 libre + en attente
  await api(`/api/match/${m82.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: m82.joueur1.id } }); // broadcast 3
  const a82b = (await api('/api/admin/audit?action=alerte_match_long')).data.audit || [];
  const a82t = (await api('/api/admin/audit?action=alerte_table_libre')).data.audit || [];
  check('82: pas de doublon alerte_match_long apres plusieurs broadcasts (une fois par match)', a82b.filter(x => JSON.parse(x.apres || '{}').match_id === m82.id).length === 1, 'n=' + a82b.length);
  check('82: table libre avec match en attente -> alerte_table_libre (table 2, en_attente >= 1)', a82t.length >= 1 && a82t.some(x => JSON.parse(x.apres || '{}').table === 2 && (JSON.parse(x.apres || '{}').en_attente || 0) >= 1), JSON.stringify(a82t.map(x => x.cible)));
  // retour aux seuils par defaut -> plus aucune alerte
  await post('/api/admin/alertes', { on: true, match_min: 60, table_min: 30 });
  await post('/api/admin/terminer', { tournoi_id: t82id });
  r = await post('/api/admin/tournoi', { nom: 'AlB', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  const t82b = r.data.actif.tournoi.id;
  await post('/api/admin/joueurs/simulation', { tournoi_id: t82b, count: 4, prefix: 'B' });
  let t82c = (await api('/api/etat')).data.actif;
  for (const j of t82c.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  await post('/api/admin/tirage', { tournoi_id: t82b });
  t82c = (await api(`/api/etat?tournoi_id=${t82b}`)).data.actif;
  const m82b = t82c.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
  await post(`/api/admin/match/${m82b.id}/lancer`, { table_id: null });
  await api(`/api/match/${m82b.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m82b.joueur1.id } });
  await api(`/api/match/${m82b.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: m82b.joueur1.id } });
  const a82c = (await api('/api/admin/audit?action=alerte_match_long')).data.audit || [];
  const a82t2 = (await api('/api/admin/audit?action=alerte_table_libre')).data.audit || [];
  check('82: seuils revenus a 60/30 -> aucune nouvelle alerte malgre match en cours + table libre', a82c.length === a82b.length && a82t2.length === a82t.length, `match_long ${a82b.length}->${a82c.length}, table ${a82t.length}->${a82t2.length}`);
  await del(`/api/admin/tournoi/${t82b}`).catch(() => {});
  const srv82 = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const push82 = fs.readFileSync(path.join(__dirname, '..', 'src', 'push.js'), 'utf8');
  const at82 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-tournoi.html'), 'utf8');
  check('82: serveur (route alertes 400/200, verifierAlertes82 hook majEtBroadcast + interval 60s, etat.alertes, audit sans snapshot, nettoyage a la terminaison) + push (envoyerAdminsClub cible admins du club) + front (panneau al-on/al-match/al-table)', srv82.includes("app.post('/api/admin/alertes'") && srv82.includes('verifierAlertes82()') && srv82.includes('alerte_match_long') && srv82.includes('alerte_table_libre') && srv82.includes('alerte82_t') && push82.includes('function envoyerAdminsClub') && push82.includes("cc.role = 'admin'") && at82.includes("id: 'al-on'") && at82.includes("id: 'al-match'") && at82.includes("id: 'al-table'") && at82.includes('renderPanneauAlertes'), '');

  // ---------- 83. Séries en cours sur le fil du tournoi ----------
  sec('83. Séries en cours sur le fil (streak >= 2 victoires consecutives, lignes live i18n 5 langues)');
  await del('/api/admin/tournoi').catch(() => {});
  r = await post('/api/admin/tournoi', { nom: 'SerA', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  const t83id = r.data.actif.tournoi.id;
  await post('/api/admin/joueurs/simulation', { tournoi_id: t83id, count: 4, prefix: 'S' });
  let t83 = (await api('/api/etat')).data.actif;
  for (const j of t83.joueurs) await post(`/api/admin/joueur/${j.id}/paiement`, { statut: 'paye' });
  await post('/api/admin/tirage', { tournoi_id: t83id });
  t83 = (await api(`/api/etat?tournoi_id=${t83id}`)).data.actif;
  // jouer les 2 matchs WB1 puis la finale : le vainqueur de la finale a une série de 2
  const gFinal = [];
  for (let step = 0; step < 10; step++) {
    const t = (await api(`/api/etat?tournoi_id=${t83id}`)).data.actif;
    if (!t || t.tournoi.statut === 'termine') break;
    const m = t.matchs.find(m => m.etat === 'pret' && m.joueur1 && m.joueur2);
    if (!m) break;
    await post(`/api/admin/match/${m.id}/lancer`, { table_id: null });
    await api(`/api/match/${m.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m.joueur1.id } });
    for (let i = 0; i < m.manches; i++) await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: m.joueur1.id } });
    gFinal.push(m.joueur1.id);
  }
  const t83fin = (await api('/api/tournois/' + t83id)).data.tournoi;
  const finis83 = t83fin.matchs.filter(m => (m.etat === 'termine' || m.etat === 'forfait') && m.gagnant_id != null && m.joueur1 && m.joueur2);
  // calcul serveur du streak attendu (meme logique que le front) pour vérifier le contrat du payload
  const serie = new Map(), dernier = new Map();
  for (const m of finis83.sort((a, b) => String(a.ended_at || '').localeCompare(String(b.ended_at || '')))) {
    const g = m.gagnant_id === m.joueur1.id ? m.joueur1 : m.joueur2;
    const p = m.gagnant_id === m.joueur1.id ? m.joueur2 : m.joueur1;
    const cur = serie.get(g.id) || { pseudo: g.pseudo, n: 0 };
    cur.n = (dernier.get(g.id) === 'W' ? cur.n : 0) + 1;
    serie.set(g.id, cur); dernier.set(g.id, 'W');
    serie.set(p.id, { pseudo: p.pseudo, n: 0 }); dernier.set(p.id, 'L');
  }
  const maxSerie = Math.max(0, ...[...serie.values()].map(x => x.n));
  check('83: tournoi joué -> au moins un joueur en série >= 2 (contrat du fil: matchs finis avec gagnant/ended_at)', finis83.length >= 3 && maxSerie >= 2, `finis=${finis83.length} maxSerie=${maxSerie}`);
  const idx83 = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8') // 86: helpers du fil dans common.js;
  const cjs83 = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
  check('83: front lignesFil calcule les séries (serie83, dernier83, n >= 2, ligne live filPick s83)', idx83.includes('serie83') && idx83.includes('dernier83') && idx83.includes('n >= 2') && idx83.includes("filPick('s83-'") && idx83.includes('victoires de suite'), '');
  check('83: i18n — 4 variantes de ligne série dans I18N_DYN + REPS_DYN_ES/IT/DE (cDyn 125 alignés)', cjs83.includes('victoires de suite$/, "') && cjs83.includes('on a roll: $2 straight wins') && cjs83.includes('en racha: $2 victorias seguidas') && cjs83.includes('in serie: $2 vittorie di fila') && cjs83.includes('auf Serie: $2 Siege in Folge') && cjs83.includes('unstoppable: $2 straight wins') && cjs83.includes('imparable: $2 victorias seguidas') && cjs83.includes('imbattibile: $2 vittorie di fila') && cjs83.includes('unaufhaltsam: $2 Siege in Folge'), '');
  await del(`/api/admin/tournoi/${t83id}`).catch(() => {});

  // ---------- 84. Mode démo par club (bac à sable) ----------
  sec('84. Mode démo par club (flag super-admin 400/403, demo exposé, reset 401/409/200 avec confirm_pin, comptes conservés, badge front)');
  let clubs84 = (await api('/api/clubs')).data.clubs;
  check('84: /api/clubs expose demo (defaut false)', clubs84.length >= 1 && !clubs84[0].demo, JSON.stringify(clubs84.map(c => [c.slug, c.demo])));
  r = await put('/api/admin/club', { demo: 'x' });
  check('84: PUT demo invalide -> 400', r.status === 400, r.status + ' ' + (r.data.error || ''));
  r = await put('/api/admin/club', { demo: 1 });
  check('84: PUT demo=1 (code global = super-admin) -> 200 + club.demo=true', r.status === 200 && r.data.club && r.data.club.demo === true, r.status + ' ' + JSON.stringify(r.data.club));
  clubs84 = (await api('/api/clubs')).data.clubs;
  const th84 = (await api('/api/club-theme')).data;
  const e84 = (await api('/api/etat')).data;
  check('84: demo exposé partout (/api/clubs, /api/club-theme, etat.club)', clubs84[0].demo === true && th84.demo === true && !!(e84.club && e84.club.demo === true), JSON.stringify([clubs84[0].demo, th84.demo, e84.club && e84.club.demo]));
  r = await api('/api/admin/club/demo/reset', { method: 'POST', body: {}, pin: PIN }); // sans confirm_pin
  check('84: reset sans confirm_pin -> 401', r.status === 401, r.status);
  await post('/api/admin/tournoi', { nom: 'DemoA', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, notif_push: false });
  await post('/api/admin/joueurs/simulation', { count: 3, prefix: 'D' });
  await post('/api/admin/club/actu', { texte: 'news démo jetable' });
  r = await post('/api/admin/club/demo/reset', { confirm_pin: PIN });
  const apres84 = (await api('/api/etat')).data;
  check('84: reset demo (confirm_pin) -> 200, tournoi parti, aucun actif, historique vide', r.status === 200 && r.data.supprimes >= 1 && !apres84.actif && apres84.historique.length === 0, r.status + ' supprimes=' + (r.data.supprimes) + ' actif=' + !!apres84.actif);
  const a84 = (await api('/api/admin/audit?action=demo_reset')).data.audit || [];
  const c84 = (await api('/api/admin/comptes')).data;
  check('84: reset audité (demo_reset, club vidé puis relogué) et comptes plateforme conservés', a84.length === 1 && Array.isArray(c84.comptes) && c84.comptes.length >= 1, JSON.stringify(a84.map(x => x.action)) + ' comptes=' + (c84.comptes ? c84.comptes.length : '?'));
  clubs84 = (await api('/api/clubs')).data.clubs;
  check('84: le club démo reste listé après le reset', clubs84.some(c => c.demo === true), JSON.stringify(clubs84.map(c => [c.slug, c.demo])));
  r = await put('/api/admin/club', { demo: 0 });
  const r409 = await post('/api/admin/club/demo/reset', { confirm_pin: PIN });
  check('84: demo remis à 0 -> reset refusé 409 (réservé aux clubs démo)', r.status === 200 && r409.status === 409, r.status + '/' + r409.status + ' ' + (r409.data.error || ''));
  const cjs84 = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
  const sc84 = fs.readFileSync(path.join(__dirname, '..', 'public', 'super-clubs.html'), 'utf8');
  const ad84 = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const idx84 = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8') // 86: helpers du fil dans common.js;
  const srv84 = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  check('84: serveur (PUT demo 400 + super-admin, POST demo/reset 401/409/200, demo exposé clubs/theme/etat) + front (badge demo-badge-84 + i18n 4 langues, toggle+reset super-clubs, bannière admin.html, 🧪 hub)', srv84.includes("app.post('/api/admin/club/demo/reset'") && srv84.includes("demo invalide (0/1)") && srv84.includes('demo_reset') && cjs84.includes('demo-badge-84') && cjs84.includes('Demo mode') && cjs84.includes('Modo demo') && cjs84.includes('Modalità demo') && cjs84.includes('Demo-Modus') && sc84.includes('demo/reset') && sc84.includes('demo: !c.demo') && ad84.includes('adminState.club.demo') && ad84.includes('demo/reset') && idx84.includes('c.demo'), '');

  // ---------- 86. TV : bandeau breaking news (fil du tournoi en bas des cards, aligne avec le QR, blanc sur rouge) ----------
  sec('86. TV breaking news : fil du tournoi en bandeau rouge en bas des cards, aligne avec le QR code');
  const tv86 = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  const cjs86 = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
  check('86: helpers du fil partages dans common.js (lignesFil/filHash/filPick/dureeFil) et plus redefinis dans index.html', cjs86.includes('function lignesFil') && cjs86.includes('function filHash') && cjs86.includes('function filPick') && cjs86.includes('function dureeFil') && !fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').includes('function lignesFil'), '');
  check('86: TV — markup tv-flash + CSS fond rouge #c1121f / texte blanc color: #fff, positionne en bas (bottom: 44px) a cote du QR (right: 352px), label ⚡ FLASH, piste defilante @keyframes tvflash, classe .on si lignes ; render() alimente via lignesFil(state.actif) + t()', tv86.includes('id="tv-flash"') && tv86.includes('.tv-flash') && tv86.includes('#c1121f') && tv86.includes('color: #fff') && tv86.includes('.tv-bottom') && tv86.includes('.tv-bottom .tv-qr { position: static;') && tv86.includes('bottom: 44px') && tv86.includes('padding: 0 0 108px') && !tv86.includes('right: 352px') && tv86.includes('FLASH') && tv86.includes('@keyframes tvflash') && tv86.includes('lignesFil(state.actif)') && tv86.includes('lignes86[0]') && tv86.includes('globalThis.t(') && tv86.includes('.tv-flash-track.scroll') && tv86.includes("classList.add('scroll')") && tv86.includes('animationDuration') && !tv86.includes('animation: tvflash 24s') && tv86.includes("classList.add('on')"), '');

  // ---------- 26. Infra CI/CD : app de test auto sur main, prod uniquement à la demande ----------
  const flt26 = fs.readFileSync(path.join(__dirname, '..', 'fly.test.toml'), 'utf8');
  const tw26 = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'tests.yml'), 'utf8');
  const dp26 = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy-prod.yml'), 'utf8');
  const gd26 = fs.readFileSync(path.join(__dirname, '..', 'docs', 'GUIDE_DEPLOY.md'), 'utf8');
  const rm26 = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ROADMAP.md'), 'utf8');
  const spec26 = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  check('infra: app de test ebpc-tournoi-billard-test déployée automatiquement sur la branche staging après CI verte (job deploy-test, fly.test.toml, volume tournoi_data séparé, notice et saut si FLY_TEST_TOKEN absent) + prod déployée automatiquement sur push main (intégration GitHub Fly conservée) + workflow « Déployer prod » conservé en plan B (confirmation PROD, FLY_PROD_TOKEN) + GUIDE_DEPLOY.md + SPEC/ROADMAP à jour', flt26.includes("app = 'ebpc-tournoi-billard-test'") && flt26.includes("source = 'tournoi_data'") && flt26.includes("DB_PATH = '/data/tournoi.db'") && tw26.includes('deploy-test:') && tw26.includes('fly.test.toml') && tw26.includes('refs/heads/staging') && tw26.includes('branches: [main, staging]') && tw26.includes('FLY_TEST_TOKEN') && tw26.includes('needs: tests') && dp26.includes('workflow_dispatch:') && dp26.includes('!= "PROD"') && dp26.includes('FLY_PROD_TOKEN') && dp26.includes('flyctl deploy') && gd26.includes('fly tokens create deploy -a ebpc-tournoi-billard-test') && gd26.includes('fly volumes create tournoi_data') && rm26.includes('ebpc-tournoi-billard-test') && spec26.includes('564 checks'), '');

  // ---------- 27. Roadmap : cap produit plateforme documente (centralise, separation logique) ----------
  const rm27 = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ROADMAP.md'), 'utf8');
  const spec27 = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SPEC_FONCTIONNELLE.md'), 'utf8');
  check('roadmap: cap produit plateforme confirme dans l en-tete + nouveaux chantiers documentes : vidéo live (embed externe puis WebRTC/HLS) + chat live modéré (modération admin, anti-flood, distinct du chat par match) + disciplines paramétrables par club (vocabulaire, format de score, règles activables) + super admin plateforme (gestion clubs, KPI globaux) + KPI enrichis santé d usage + ordre conseillé axe plateforme (20 -> 37 -> 19 -> 31 -> 36)', rm27.includes('tout centralisé, séparation logique') && rm27.includes('**Vidéo live du tournoi**') && rm27.includes('**Chat live modéré**') && rm27.includes('**Disciplines paramétrables par club**') && rm27.includes('**Super admin plateforme**') && rm27.includes("santé d'usage") && rm27.includes('cap plateforme confirmé : multi-club (20)') && spec27.includes('564 checks'), '');

  // ---------- Garde syntaxe front : chaque bloc <script> inline de public/*.html doit compiler ----------
  // (regression 81: parenthese en trop dans admin-tournoi.html -> script inline illisible -> page morte)
  const vmG = require('vm');
  const koInline = [];
  for (const fG of fs.readdirSync(path.join(__dirname, '..', 'public')).filter(f => f.endsWith('.html'))) {
    const htmlG = fs.readFileSync(path.join(__dirname, '..', 'public', fG), 'utf8');
    const reG = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let mG, iG = 0;
    while ((mG = reG.exec(htmlG))) {
      try { new vmG.Script(mG[1], { filename: fG + '#' + iG }); } catch (e) { koInline.push(fG + '#' + iG + ': ' + e.message); }
      iG++;
    }
  }
  check('garde syntaxe: tous les blocs <script> inline de public/*.html compilent (vm.Script) — une page dont le script ne parse plus est morte', koInline.length === 0, koInline.join(' | '));

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
  md += `- Garde syntaxe front : scripts inline de toutes les pages public/*.html compilent (vm.Script)\n`;
  md += `- Rôles (section 16): compte role=admin -> session suffit pour requireAdmin ET confirm_pin (destructif); sinon PIN requis (401 sans), confirm_pin requis sur destructifs; POST /api/admin/compte/:id/role (admin/user, 400 invalide)\n`;
  md += `- Multi-club (section 17): table club + backfill club_id au boot, req.club via X-Club/?club= (404 si slug inconnu, défaut sinon), GET /api/clubs, POST /api/admin/club (200/409/400), tournoi créé dans le club courant, etat/historique/audit/match/joueur scopés par club, isolation cross-club (404: lecture, suppression, saisie) — mono-club = comportement inchangé\n`;
  md += `- Multi-club PIN et réglages (section 17b): PUT /api/admin/club (nom sans confirm / pin 4-8 chiffres avec confirm_pin / actif), club inactif exclu de /api/clubs et 404 à la résolution, réactivation à distance (super-admin: PIN global ou session admin, 403 pour un simple admin de club), GET /api/admin/clubs (pin_propre/actif, jamais de hash), audit club_modifié\n`;
  md += `- Multi-club comptes et rôles (section 17c): table compte_club, rôles admin (gestion complète du club par session, confirmations levées) et operateur (routes admin ouvertes, confirmations et rôles refusés), attribution/changement/retrait par le super-admin (PUT/DELETE /api/admin/club/compte), GET /api/admin/club/comptes, /api/compte/moi expose role_club, nb_comptes dans GET /api/admin/clubs, console super-admin /console.html (création, réglages, rôles, 17i)\n`;
  md += `- Rattachement compte/joueurs anonymes (section 18): compte créé après un tournoi archivé (sans tournoi actif) rattache quand même les lignes anonymes du même pseudo (tournois passés inclus), fiche joueur + classement conservent les stats\n`;
  md += `- Fil du tournoi (section 20): chronique du tournoi dérivée de l'état (aucun stockage -> cohérente avec les tableaux, rollback et corrections inclus), lignes victoire/forfait/champion/belle, élimination définitive mentionnée uniquement en double KO (LB/F) et fusionnée dans la ligne, 3 dernières lignes + « Voir tout » sur l'accueil, horodatage relatif, dernier tournoi terminé consultable sans tournoi actif (/api/tournois/:id public), phrases i18n dans les 5 langues (clés statiques + règles dynamiques alignées I18N_DYN/REPS_DYN_*)\n`;
  md += `- Variantes, durées et revanche (section 21): phrases variées par hachage déterministe (7 variantes victoires/forfaits/champion/belles, 4 belles sans table, 6 égalités, 7 revanches underdog), durée des matchs finis dans les lignes (· durée 42 min), lignes « revanche » en direct pour les paires déjà croisées (actif.h2h, historique du club complet, underdog « une revanche à prendre », « mène X-Y », égalité), pas de double ligne si à la belle ; traces après fin (suffixes « · après la belle » et « · revanche prise ! / manquée » via h2h antérieur sur les résultats, servies aussi sur /api/tournois/:id sans tournoi actif) ; 47 règles i18n du fil (dont 4 séries 83) + règle Reçu du refus logo (17k v5) alignées dans les 5 langues (cDyn = 125)\n`;
  md += `- Menu principal (section 22): liens Tableau / TV / « Mon tournoi » masqués tant qu'aucun tournoi n'est actif (ré-évalué à chaque ouverture du burger, affichés par défaut avant la réponse), lien suivi.html renommé « Mon tournoi » (ex-« Joueur »), traduit dans les 5 langues\n`;
  md += `- Journal d'audit (section 23): colonne « Par » = pseudo du compte admin à l'origine de chaque modification (null si code PIN ou action automatique, migration incluse), corrections de score et forfaits porteurs de l'auteur ; les modifications de préférences du compte (langue des push, notifs amis) ne sont plus loggées ; burger Compte sans emojis, labels traduits dans les 4 langues\n`;
  md += `- Tableaux responsive (section 24): enveloppe .table-wrap (overflow-x: auto) autour de chaque table de données (stats joueurs, fiche joueur face-à-face/historique, journal d'audit admin, classement du compte, comptes admin) : sur petit écran la table défile horizontalement à l'intérieur du panneau, les bordures du panneau englobent toujours toute la table\n`;
  md += `- i18n compléments (section 25): label « Confidentialité » du menu corrigé (traduit dans les 4 langues, ex-label fautif « Confidentialitè » impossible), burger « ☰ Menu » + aria-label traduits, en-têtes du tableau des stats (Perdus, % victoires, Titres, Pts, Run-outs), boutons de la table de marque (Guide admin, Historique public, Liens publics, Historique (N) segmenté), Sauvegarde / 📍 Lieu / « géré dans sa page dédiée » du tournoi admin, champion et zone WB/LB (Tour, Tableau final) segmentés, Mode auto ACTIF/inactif traduits, window.prompt patché (Distance, Motif, correction table de marque), boutons « 🗑 Supprimer » segmentés (historique public/admin, comptes), alerte du journal « entrées supprimées » traduite\n`;
  md += `- Infra CI/CD (section 26): flux à deux branches — staging → app de test ebpc-tournoi-billard-test auto-déployée après CI verte (job deploy-test, fly.test.toml, volume tournoi_data séparé, notice et saut si FLY_TEST_TOKEN absent) ; main → prod automatique (intégration GitHub Fly conservée), mise en prod = fusion staging vers main ; workflow « Déployer prod » en plan B (confirmation PROD, FLY_PROD_TOKEN) ; docs/GUIDE_DEPLOY.md (tokens Fly par app, restauration snapshot prod vers test)\n`;
  md += `- Roadmap cap produit (section 27): plateforme centralisée, séparation logique par club/discipline/tournoi ; nouveaux chantiers : vidéo live (34), chat live modéré (35), disciplines paramétrables par club (36), super admin plateforme (37), KPI enrichis santé d'usage (31) ; axe conseillé : 20 -> 37 -> 19 -> 31 -> 36\n`;
  md += `- Consolante automatique (section 81): case a la creation + nb de tours (1-3, uniquement en epreuve simple), tournoi consolante auto-cree au tirage (LB + finale F redimensionnee, perdants des WB 1..k cables en perdant_id inter-tournois), actif par defaut = le principal, fin propre avec champion, suppression en cascade\n`;
  md += `- Alertes table de marque (section 82): seuils match long / table libre en minutes (defaut 60/30, 0-240, 400 sinon), scan a chaque broadcast + intervalle 60s, push envoyerAdminsClub aux admins du club (role admin/super_admin ou compte_club admin), une alerte par match et par periode libre, etat par tournoi dans settings nettoye a la terminaison, audit alerte_match_long/alerte_table_libre SANS snapshot\n`;
  md += `- Séries en cours sur le fil (section 83): lignes live 🔥 « X en série : N victoires de suite » dérivées des matchs finis du tournoi (ordre chrono, une défaite casse la série), seuil N >= 2, 4 variantes i18n x 5 langues (cDyn = 125)\n`;
  md += `- Mode démo par club (section 84): flag demo réservé au super-admin (PUT /api/admin/club, 400/403), exposé (/api/clubs, /api/club-theme, /api/etat), badge 🧪 dans le bandeau + hub, reset POST /api/admin/club/demo/reset réservé demo=1 + confirm_pin (401/409), purge tournois/actus/usage/audit du club (comptes conservés, cascade consolante 81), bannière + bouton dans la table de marque, toggle + reset dans la console super-admin\n`;
  md += `- Identité visuelle du club (section 17n): favicon de l onglet = logo du club (repli favicon.svg), bannière de l accueil + photo de fond TV importées (PNG/JPG/SVG, 8 Mo, réduites à 1600/1280 px, plafond 400 000 caractères) servies par /api/club-banniere et /api/club-tv-fond (?club=, 204 sans image, jamais dans le payload club-theme), page publique « Le club » (leclub.html, lien du menu : bannière + nom + adresse + présentation 500 + contact 200) avec fond TV assombri par dégradé pour garder les scores lisibles, gardes pliées dans le check 17k réinitialisation (564 checks conservés)\n`;
  md += `- i18n FR/EN/ES/IT/DE (section 19): header X-Lang (en/es/it/de) -> erreurs API traduites (Route inconnue -> Unknown route / Ruta desconocida / Percorso sconosciuto / Unbekannte Route), defaut fr inchange, couverture front complete dans common.js (~490 entrees x 4 langues cibles + ~66 regles dynamiques x 4 via I18N_ES/IT/DE + REPS_DYN, LANG multi-valeurs, t(), traduireDomStatique, X-Lang sur api() ET les appels admin, alert/confirm natifs traduits, titre de page traduit, attributs placeholder/title/aria-label/alt), selecteur de langue 5 entrees dans le bandeau (FR/EN/ES/IT/DE data-driven via LANGUES, drapeaux + libelles natifs, ancienne rangee Langue retiree de parametres.html ; interrupteurs theme alignes .pref-row, sous-sections Preferences et Notifications, sans texte d aide; checkboxes de reglages habillees en interrupteurs toggle-mini, burger compte a entrees dynamiques vers des pages dediees (login/register, parametres, amis, mes matchs, ma fiche, deconnexion, table de marque seule si role admin), append filtre les null; selecteur langue colle a l extremite droite de l ecran, sur desktop comme sur mobile <=560px (#nav flex + margin-left auto, #nav pleine largeur en colonne mobile ; listes deroulantes du bandeau alignees sur le bord droit de leur bouton ; entree Accueil ex-Tournoi du menu principal, traduite Home en EN) ; push traduits par destinataire en 5 langues (compte.lang, repli X-Lang pour le test manuel, payloads par langue dans push.js + envoyerTous versions {en,es,it,de}) ; limite restante: payload SSE restent en francais)\n`;
  fs.writeFileSync(RAPPORT, md);
  console.log(`\n=== ${passed} OK / ${failed} ÉCHEC en ${duree}s — rapport: ${RAPPORT} ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(2); });

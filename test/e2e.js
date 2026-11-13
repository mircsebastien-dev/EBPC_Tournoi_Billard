const BASE = process.env.BASE || 'http://127.0.0.1:3457';
const PIN = '0000';

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  OK  ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? ' — ' + JSON.stringify(extra) : ''}`); }
}

async function api(path, { method = 'GET', body, pin = PIN } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(pin ? { 'X-Admin-Pin': pin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function bandeSiBesoin(matchId, joueurId) {
  const t = (await api('/api/etat')).data.actif;
  const cur = t && t.matchs.find(x => x.id === matchId);
  if (cur && cur.casseur == null) await api(`/api/match/${matchId}/bande`, { method: 'POST', pin: null, body: { joueur_id: joueurId } });
}

async function main() {
  console.log('== 1. Création tournoi (double KO 2 tours, 16 joueurs) ==');
  let r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'Test Cup', regle: 'blackball', taille: 16, format: 'double', dko_tours: 2, nb_tables: 4 } });
  check('création 200', r.status === 200, r.data);
  check('statut inscription', r.data.actif.tournoi.statut === 'inscription');

  console.log('== 1b. Date/heure + lieu du tournoi (défaut mardi prochain 20h, lieu Le 147) ==');
  const t1 = r.data.actif.tournoi;
  check('date_heure renseignée par défaut', !!t1.date_heure && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t1.date_heure), t1.date_heure);
  check('c\'est un mardi à 20h00', new Date(t1.date_heure.replace(' ', 'T') + 'Z').getUTCDay() === 2 && t1.date_heure.endsWith('20:00'), t1.date_heure);
  check('lieu par défaut = Le 147 Toulouse', t1.lieu === 'Le 147, 12 Rue des Amidonniers 31000 Toulouse', t1.lieu);
  r = await api('/api/admin/tournoi', { method: 'DELETE' });
  r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'AvecDate', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, date_heure: '2026-12-25 21:30', lieu: 'Salle test' } });
  check('date/lieu personnalisés retenus', r.data.actif.tournoi.date_heure === '2026-12-25 21:30' && r.data.actif.tournoi.lieu === 'Salle test', r.data.actif.tournoi);
  await api('/api/admin/tournoi', { method: 'DELETE' });
  await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'Test Cup', regle: 'blackball', taille: 16, format: 'double', dko_tours: 2, nb_tables: 4 } });

  r = await api('/api/admin/tournoi', { method: 'PUT', body: { nom: 'Test Cup', date_heure: '2026-12-31 19:45', lieu: 'Chez Marco' } });
  check('PUT modifie date/lieu', r.status === 200 && r.data.actif.tournoi.date_heure === '2026-12-31 19:45' && r.data.actif.tournoi.lieu === 'Chez Marco', r.data.actif.tournoi);

  console.log('== 2. PIN requis ==');
  r = await api('/api/admin/joueur', { method: 'POST', pin: '9999', body: { pseudo: 'X' } });
  check('mauvais PIN -> 401', r.status === 401);

  console.log('== 3. Inscriptions (10 joueurs, 9 seront payés -> 1 bye) ==');
  for (let i = 1; i <= 10; i++) {
    r = await api('/api/admin/joueur', { method: 'POST', body: { pseudo: `J${i}` } });
    check(`inscription J${i}`, r.status === 200, r.data);
  }
  r = await api('/api/etat');
  check('10 joueurs inscrits', r.data.actif.joueurs.length === 10);
  check('tous en_attente par défaut', r.data.actif.joueurs.every(j => j.statut === 'en_attente'));

  console.log('== 3b. Paiement : tirage refusé sans joueurs payés ==');
  r = await api('/api/admin/tirage', { method: 'POST', body: {} });
  check('tirage refusé (0 payé)', r.status === 400, r.data);
  const ids = (await api('/api/etat')).data.actif.joueurs.map(j => j.id);
  for (let i = 0; i < 9; i++) {
    r = await api(`/api/admin/joueur/${ids[i]}/paiement`, { method: 'POST', body: { statut: 'paye' } });
    check(`paiement joueur ${ids[i]}`, r.status === 200, r.data);
  }
  r = await api('/api/admin/joueur/9999/paiement', { method: 'POST', body: { statut: 'paye' } });
  check('paiement joueur inexistant -> 404', r.status === 404);
  r = await api('/api/etat');
  check('9 payés / 1 en attente', r.data.actif.joueurs.filter(j => j.statut === 'paye').length === 9);

  console.log('== 4. Tirage (9 payés -> 9 joueurs dans le tableau, J10 exclu) ==');
  r = await api('/api/admin/tirage', { method: 'POST', body: {} });
  check('tirage 200', r.status === 200, r.data);
  const nonPaye = (await api('/api/etat')).data.actif.joueurs.find(j => j.statut !== 'paye');
  check('un seul joueur non payé', !!nonPaye);
  const dansTableau = r.data.actif.matchs.some(m => (m.joueur1 && m.joueur1.id === nonPaye.id) || (m.joueur2 && m.joueur2.id === nonPaye.id));
  check(`joueur non payé (${nonPaye && nonPaye.pseudo}) exclu du tirage`, !dansTableau);
  const t = r.data.actif;
  check('statut en_cours', t.tournoi.statut === 'en_cours');
  const wb1 = t.matchs.filter(m => m.bracket === 'WB' && m.tour === 1);
  const lb1 = t.matchs.filter(m => m.bracket === 'LB' && m.tour === 1);
  const lb2 = t.matchs.filter(m => m.bracket === 'LB' && m.tour === 2);
  const f1 = t.matchs.filter(m => m.bracket === 'F' && m.tour === 1);
  console.log(`   matchs: WB1=${wb1.length} LB1=${lb1.length} LB2=${lb2.length} F1=${f1.length} total=${t.matchs.length}`);
  check('WB tour1 = 8 matchs', wb1.length === 8);
  check('LB tour1 = 4 matchs', lb1.length === 4);
  check('LB tour2 = 4 matchs', lb2.length === 4);
  check('F tour1 = 4 matchs (8 finalistes: 4 WB + 4 LB)', f1.length === 4, f1.length);
  const withBoth = wb1.filter(m => m.joueur1 && m.joueur2);
  const byes = wb1.filter(m => (m.joueur1 && !m.joueur2) || (!m.joueur1 && m.joueur2));
  const vides = wb1.filter(m => !m.joueur1 && !m.joueur2);
  // 9 payés / 16 -> 7 blancs mélangés au hasard : tout match avec 1 seul joueur est un bye auto-terminé
  check('tour1 = 8 matchs tous classés (complet/bye/vide)', withBoth.length + byes.length + vides.length === 8, { withBoth: withBoth.length, byes: byes.length, vides: vides.length });
  check('byes auto-terminés avec gagnant', byes.every(b => b.etat === 'termine' && b.gagnant_id != null), byes.length);
  check('matchs vides auto-terminés sans gagnant', vides.every(v => v.etat === 'termine' && v.gagnant_id == null), vides.length);
  const wb2 = t.matchs.filter(m => m.bracket === 'WB' && m.tour === 2);
  check('gagnants des byes propagés au tour 2', wb2.filter(m => m.joueur1 || m.joueur2).length >= 1, wb2.filter(m => m.joueur1 || m.joueur2).length);

  console.log('== 5. Lancer un match complet et jouer ==');
  let m = withBoth.find(mm => mm.etat === 'pret') || withBoth[0];
  r = await api(`/api/admin/match/${m.id}/lancer`, { method: 'POST', body: { table_id: null } });
  check('lancement 200', r.status === 200, r.data);
  check('état en_cours', r.data.match.etat === 'en_cours');
  const j1 = m.joueur1.id, j2 = m.joueur2.id;
  await bandeSiBesoin(m.id, j1);
  check('m a bien 2 joueurs', !!m.joueur1 && !!m.joueur2, m);
  r = await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: j1 } });
  check('manche J1', r.status === 200 && r.data.match.score1 === 1, r.data);
  r = await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: 9999 } });
  check('joueur externe -> 403', r.status === 403, r.data);
  // --- nouveau : gestion complète du score par le joueur (ajouter/retirer, soi + adversaire) sur un 2e match ---
  console.log('== 5c. Gestion du score par le joueur (+/- soi et adversaire) ==');
  let mC = withBoth.find(mm => mm.id !== m.id && mm.etat === 'pret') || null;
  if (!mC) {
    // avec peu de matchs complets au tour 1, on rejoue le même match après l'avoir roul à nouveau:
    // plus simple -> on lance un 2e match du tour 2 si dispo, sinon on saute proprement
    const tNow = (await api('/api/etat')).data.actif;
    mC = tNow.matchs.find(mm => mm.etat === 'pret' && mm.joueur1 && mm.joueur2) || null;
  }
  if (mC) {
    await api(`/api/admin/match/${mC.id}/lancer`, { method: 'POST', body: { table_id: null } });
    const a1 = mC.joueur1.id, a2 = mC.joueur2.id;
    await bandeSiBesoin(mC.id, a1);
    r = await api(`/api/match/${mC.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: a1 } });
    check('manche pour soi', r.status === 200 && r.data.match.score1 === 1, r.data);
    r = await api(`/api/match/${mC.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: a2 } });
    check('manche pour l\'adversaire acceptée', r.status === 200 && r.data.match.score2 === 1, r.data);
    r = await api(`/api/match/${mC.id}/retirer`, { method: 'POST', pin: null, body: { joueur_id: a2 } });
    check('retirer une manche à l\'adversaire', r.status === 200 && r.data.match.score2 === 0, r.data.match);
    r = await api(`/api/match/${mC.id}/retirer`, { method: 'POST', pin: null, body: { joueur_id: a1 } });
    check('retirer une manche à soi', r.status === 200 && r.data.match.score1 === 0, r.data.match);
    r = await api(`/api/match/${mC.id}/retirer`, { method: 'POST', pin: null, body: { joueur_id: a1 } });
    check('retirer à 0 reste bloqué à 0', r.status === 200 && r.data.match.score1 === 0, r.data.match);
    r = await api(`/api/match/${mC.id}/retirer`, { method: 'POST', pin: null, body: { joueur_id: 9999 } });
    check('retirer pour un joueur externe -> 403', r.status === 403, r.status);
    for (let i = 0; i < mC.manches; i++) await api(`/api/match/${mC.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: a1 } });
  } else {
    check('2e match disponible pour les tests +/- (skip: pas de 2e match pret)', true);
  }
  for (let i = 0; i < 2; i++) await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: j1 } });
  for (let i = 0; i < 3; i++) await api('/api/match/' + m.id + '/manche', { method: 'POST', pin: null, body: { joueur_id: j1 } });
  r = await api('/api/etat');
  const m2 = r.data.actif.matchs.find(mm => mm.id === m.id);
  check('match terminé 3-0, gagnant J1', m2.etat === 'termine' && m2.score1 === 3 && m2.gagnant_id === j1, m2);
  r = await api('/api/match/' + m.id + '/retirer', { method: 'POST', pin: null, body: { joueur_id: j1 } });
  check('retirer sur match terminé -> 409', r.status === 409, r.status);
  check('started_at renseigné au lancement', !!m2.started_at, m2.started_at);
  check('ended_at + durée renseignés à la fin', !!m2.ended_at && typeof m2.duree_s === 'number' && m2.duree_s >= 0, { ended: m2.ended_at, duree: m2.duree_s });
  const st = (await api('/api/etat')).data.actif.stats;
  check('stats présentes avec classement', !!st && Array.isArray(st.classement) && st.resume.joues >= 1);
  const j1stats = st.classement.find(p => p.id === j1);
  check('stats J1 : tous ses matchs gagnés (bye inclus)', j1stats && j1stats.joues >= 1 && j1stats.gagnes === j1stats.joues && j1stats.pct === 100, j1stats);
  const etatA = (await api('/api/etat')).data.actif;
  const suivant = etatA.matchs.find(mm => mm.id === m2.suivant_id);
  check('gagnant propagé au match suivant', suivant && (suivant.joueur1?.id === j1 || suivant.joueur2?.id === j1), suivant);
  const lbMatch = etatA.matchs.find(mm => mm.id === m2.perdant_id);
  check('perdant envoyé en LB', lbMatch && (lbMatch.joueur1?.id === j2 || lbMatch.joueur2?.id === j2), lbMatch);

  console.log('== 5b. Assignation auto des tables ==');
  const prets5 = (await api('/api/etat')).data.actif.matchs.filter(mm => (mm.etat === 'pret') && mm.joueur1 && mm.joueur2);
  const mA = prets5[0];
  r = await api(`/api/admin/match/${mA.id}/lancer`, { method: 'POST', body: { table_id: null } });
  check('lancer sans table -> auto assignée', r.status === 200 && r.data.match.table != null, r.data.match);
  const tableA = r.data.match.table;
  const mB = prets5.find(mm => mm.id !== mA.id);
  if (mB) {
    r = await api(`/api/admin/match/${mB.id}/lancer`, { method: 'POST', body: { table_id: null } });
    check('2e match auto -> table différente', r.status === 200 && r.data.match.table != null && r.data.match.table !== tableA, { tableA, tableB: r.data.match.table });
    const tableB = r.data.match.table;
    const mC = prets5.find(mm => mm.id !== mA.id && mm.id !== mB.id);
    if (mC) {
      const tableOccupee = (await api('/api/etat')).data.actif.tables.find(tb => tb.numero === tableA);
      r = await api(`/api/admin/match/${mC.id}/lancer`, { method: 'POST', body: { table_id: tableOccupee.id } });
      check('table déjà occupée -> 409', r.status === 409, r.status);
    }
  }

  console.log('== 6. Correction admin (match terminé : score + rouvrir + cascade) ==');
  r = await api(`/api/admin/match/${m.id}/correction`, { method: 'POST', body: { score1: 1, score2: 3, manches: 3, motif: 'test' } });
  check('correction 200', r.status === 200, r.data);
  check('score corrigé 1-3', r.data.match.score1 === 1 && r.data.match.score2 === 3, r.data.match);
  const mApres = r.data.match;
  check('match reste terminé avec nouveau gagnant', mApres.etat === 'termine' && mApres.gagnant_id === j2, mApres);
  const suivantA = (await api('/api/etat')).data.actif.matchs.find(mm => mm.id === mApres.suivant_id);
  check('match suivant vidé du gagnant annulé', suivantA && ![suivantA.joueur1?.id, suivantA.joueur2?.id].includes(j1), suivantA);
  // règle métier (0481e69) : réouverture interdite si un match aval a reçu un joueur -> 409
  r = await api(`/api/admin/match/${m.id}/rouvrir`, { method: 'POST', body: {} });
  check('rouvrir avec aval propagé -> 409', r.status === 409, r.data);
  r = await api(`/api/admin/match/${m.id}/rouvrir`, { method: 'POST', pin: '9999', body: {} });
  check('rouvrir protégé PIN (401)', r.status === 401, r.status);
  // retour au score d'origine via correction (pas de rejoue possible sans rouvrir)
  await api(`/api/admin/match/${m.id}/correction`, { method: 'POST', body: { score1: 3, score2: 0, manches: 3, motif: 'retour 3-0' } });
  const mRe = (await api('/api/etat')).data.actif.matchs.find(mm => mm.id === m.id);
  check('match corrigé 3-0, gagnant J1', mRe.etat === 'termine' && mRe.score1 === 3 && mRe.gagnant_id === j1, mRe);

  console.log('== 7. Forfait ==');
  const pret = (await api('/api/etat')).data.actif.matchs.find(mm => mm.etat === 'pret' && mm.joueur1 && mm.joueur2);
  if (pret) {
    r = await api(`/api/admin/match/${pret.id}/forfait`, { method: 'POST', body: { joueur_id: pret.joueur1.id } });
    check('forfait 200', r.status === 200, r.data);
    check('forfait -> gagnant = J2', r.data.match.gagnant_id === pret.joueur2.id, r.data.match);
  }

  console.log('== 8. Tournoi simple 16 (vérif structure) ==');
  r = await api('/api/admin/tournoi', { method: 'DELETE' });
  check('suppression', r.status === 200);
  r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'Simple', regle: 'ultimate', taille: 16, format: 'simple', nb_tables: 2 } });
  for (let i = 1; i <= 16; i++) await api('/api/admin/joueur', { method: 'POST', body: { pseudo: `P${i}` } });
  for (const j of (await api('/api/etat')).data.actif.joueurs) {
    await api(`/api/admin/joueur/${j.id}/paiement`, { method: 'POST', body: { statut: 'paye' } });
  }
  r = await api('/api/admin/tirage', { method: 'POST', body: {} });
  const ts = r.data.actif;
  const tours = [1, 2, 3, 4].map(tn => ts.matchs.filter(m => m.tour === tn).length);
  check('simple KO 16: 8/4/2/1 matchs', JSON.stringify(tours) === '[8,4,2,1]', tours);
  check('aucun LB en simple', ts.matchs.every(m => m.bracket === 'WB'));

  console.log('== 8b. Ajustement auto : 5 payés sur max 128 -> tableau de 8 ==');
  await api('/api/admin/tournoi', { method: 'DELETE' });
  r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'Auto', regle: 'blackball', taille: 128, format: 'simple', nb_tables: 2, ajustement_auto: true } });
  for (let i = 1; i <= 5; i++) await api('/api/admin/joueur', { method: 'POST', body: { pseudo: `A${i}` } });
  for (const j of (await api('/api/etat')).data.actif.joueurs) {
    await api(`/api/admin/joueur/${j.id}/paiement`, { method: 'POST', body: { statut: 'paye' } });
  }
  r = await api('/api/admin/tirage', { method: 'POST', body: {} });
  check('tirage 200', r.status === 200, r.data);
  check('taille ajustée à 8', r.data.actif.tournoi.taille === 8, r.data.actif.tournoi.taille);
  const wb1b = r.data.actif.matchs.filter(m => m.tour === 1);
  check('WB tour1 = 4 matchs (8 joueurs)', wb1b.length === 4, wb1b.length);
  check('tous les matchs en race to 3 par défaut', r.data.actif.matchs.every(m => m.manches === 3));
  await api('/api/admin/tournoi', { method: 'DELETE' });
  r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'Fixe', regle: 'blackball', taille: 32, format: 'simple', nb_tables: 2, ajustement_auto: false } });
  for (let i = 1; i <= 5; i++) await api('/api/admin/joueur', { method: 'POST', body: { pseudo: `B${i}` } });
  for (const j of (await api('/api/etat')).data.actif.joueurs) {
    await api(`/api/admin/joueur/${j.id}/paiement`, { method: 'POST', body: { statut: 'paye' } });
  }
  r = await api('/api/admin/tirage', { method: 'POST', body: {} });
  check('sans ajustement auto, taille reste 32 (byes)', r.data.actif.tournoi.taille === 32, r.data.actif.tournoi.taille);

  console.log('== 9a. Seuil de distance (demis -> 5) + maj à chaud + terminer manuellement ==');
  await api('/api/admin/tournoi', { method: 'DELETE' });
  r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'Seuils', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2, seuil_distance: 'demis', distance_speciale: 5 } });
  for (let i = 1; i <= 16; i++) await api('/api/admin/joueur', { method: 'POST', body: { pseudo: `S${i}` } });
  for (const j of (await api('/api/etat')).data.actif.joueurs) {
    await api(`/api/admin/joueur/${j.id}/paiement`, { method: 'POST', body: { statut: 'paye' } });
  }
  r = await api('/api/admin/tirage', { method: 'POST', body: {} });
  const manByTour = {};
  for (const m of r.data.actif.matchs) manByTour[m.tour] = m.manches;
  check('tours 1-2 en race to 3', manByTour[1] === 3 && manByTour[2] === 3, manByTour);
  check('demis+finale en race to 5', manByTour[3] === 5 && manByTour[4] === 5, manByTour);
  r = await api('/api/admin/distances', { method: 'PUT', body: { distances: { wb1: 7 } } });
  check('maj distance à chaud 200', r.status === 200, r.data);
  const t9 = (await api('/api/etat')).data.actif;
  check('wb1 passé à 7 (matchs non joués)', t9.matchs.filter(m => m.tour === 1).every(m => m.manches === 7));
  check('autres tours inchangés', t9.matchs.filter(m => m.tour === 3).every(m => m.manches === 5));
  const m9 = t9.matchs.find(mm => mm.etat === 'pret' && mm.joueur1 && mm.joueur2);
  if (m9) {
    await api(`/api/admin/match/${m9.id}/lancer`, { method: 'POST', body: { table_id: null } });
    await bandeSiBesoin(m9.id, m9.joueur1.id);
    for (let i = 0; i < m9.manches; i++) await api(`/api/match/${m9.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: m9.joueur1.id } });
  }
  check('1 match joué avant clôture manuelle', !!m9);
  const champId = t9.joueurs[0].id;
  r = await api('/api/admin/terminer', { method: 'POST', body: { champion_id: champId } });
  check('terminer manuellement 200', r.status === 200, r.data);
  const histA = r.data.historique.find(h => h.statut === 'termine');
  check('tournoi archivé avec champion choisi', !!histA && histA.champion_id === champId, histA);
  r = await api(`/api/tournois/${histA.id}`);
  check('matchs non joués clôturés', r.data.tournoi.matchs.every(m => m.etat === 'termine' || m.etat === 'forfait'));
  const apres = await api('/api/etat');
  check('tableau archivé dans l\'historique', !!apres.data.historique && apres.data.historique.length === 1 && apres.data.historique[0].statut === 'termine');

  console.log('== 9b. Historique multi-tournois + stats all-time + suppression ==');
  let histL = (await api('/api/etat')).data.historique;
  check('1 tournoi dans l\'historique après clôture', histL.length === 1, histL.length);
  const histId = histL[0].id;
  r = await api(`/api/tournois/${histId}`);
  check('consultation d\'un tournoi archivé', r.status === 200 && r.data.tournoi.matchs.length > 0);
  r = await api('/api/stats-joueurs');
  check('stats all-time présentes', r.status === 200 && r.data.joueurs.length > 0, r.data.joueurs && r.data.joueurs.length);
  const avecMatchs = r.data.joueurs.find(j => j.joues > 0);
  check('joueur avec matchs a gagnes+perdus cohérents', avecMatchs && avecMatchs.gagnes + avecMatchs.perdus === avecMatchs.joues, avecMatchs);
  r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'Deuxième', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2 } });
  check('nouveau tournoi créé après clôture (200)', r.status === 200, r.data);
  for (let i = 1; i <= 4; i++) await api('/api/admin/joueur', { method: 'POST', body: { pseudo: `D${i}` } });
  for (const j of (await api('/api/etat')).data.actif.joueurs) {
    await api(`/api/admin/joueur/${j.id}/paiement`, { method: 'POST', body: { statut: 'paye' } });
  }
  await api('/api/admin/tirage', { method: 'POST', body: {} });
  await api('/api/admin/terminer', { method: 'POST', body: {} });
  histL = (await api('/api/etat')).data.historique;
  check('2 tournois dans l\'historique', histL.length === 2, histL.length);
  r = await api('/api/stats-joueurs');
  const d1 = r.data.joueurs.find(j => j.pseudo === 'D1');
  check('stats all-time agrègent les 2 tournois', !!d1 && d1.tournois >= 1, d1);
  r = await api(`/api/admin/tournoi/${histId}`, { method: 'DELETE' });
  check('suppression d\'un tournoi de l\'historique', r.status === 200, r.data);
  histL = (await api('/api/etat')).data.historique;
  check('historique passé à 1', histL.length === 1, histL.length);
  r = await api(`/api/tournois/${histId}`);
  check('tournoi supprimé -> 404', r.status === 404);

  console.log('== 9c. Inscriptions liées à un seul tournoi (cycle terminé -> nouveau) ==');
  r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'Cycle A', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2 } });
  const idA = r.data.actif.tournoi.id;
  r = await api('/api/joueur', { method: 'POST', pin: null, body: { pseudo: 'CycleA1' } });
  check('inscription ouverte en phase inscription', r.status === 200, r.data);
  for (const j of (await api('/api/etat')).data.actif.joueurs) {
    await api(`/api/admin/joueur/${j.id}/paiement`, { method: 'POST', body: { statut: 'paye' } });
  }
  await api('/api/admin/joueur', { method: 'POST', body: { pseudo: 'CycleA2' } });
  await api(`/api/admin/joueur/${(await api('/api/etat')).data.actif.joueurs.find(j => j.pseudo === 'CycleA2').id}/paiement`, { method: 'POST', body: { statut: 'paye' } });
  await api('/api/admin/tirage', { method: 'POST', body: {} });
  r = await api('/api/joueur', { method: 'POST', pin: null, body: { pseudo: 'TropTard' } });
  check('inscription refusée (409) tant que le tournoi est en cours', r.status === 409, r.data);
  r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'Trop tot', regle: 'blackball', taille: 16, format: 'simple' } });
  check('création d\'un nouveau tournoi refusée (409) tant que A est en cours', r.status === 409, r.data);
  await api('/api/admin/terminer', { method: 'POST', body: {} });
  r = await api('/api/joueur', { method: 'POST', pin: null, body: { pseudo: 'TropTard2' } });
  check('inscription refusée (404) après fin tant qu\'aucun nouveau tournoi', r.status === 404, r.data);
  r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'Cycle B', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2 } });
  check('nouveau tournoi créé une fois A terminé', r.status === 200, r.data);
  const idB = r.data.actif.tournoi.id;
  check('nouveau tournoi = id différent', idB !== idA, { idA, idB });
  r = await api('/api/joueur', { method: 'POST', pin: null, body: { pseudo: 'CycleB1' } });
  check('inscription ouverte sur le nouveau tournoi', r.status === 200, r.data);
  const etat = await api('/api/etat');
  const jb = etat.data.actif.joueurs.find(j => j.pseudo === 'CycleB1');
  const ja = (await api(`/api/tournois/${idA}`)).data.tournoi.joueurs.map(j => j.pseudo);
  check('inscrit rattaché au tournoi B', !!jb);
  check('les inscrits du tournoi A ne sont pas dans B', !ja.includes('CycleB1') && !etat.data.actif.joueurs.some(j => j.pseudo === 'CycleA1'), { ja });

  console.log('== 9d. Mode simulation : joueurs fictifs en masse, payés ==');
  await api('/api/admin/tournoi', { method: 'DELETE' });
  r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'Simu Test', regle: 'blackball', taille: 16, format: 'simple', nb_tables: 2 } });
  r = await api('/api/admin/joueurs/simulation', { method: 'POST', body: { count: 16, prefix: 'Bot' } });
  check('simulation 200', r.status === 200, r.data);
  check('16 fictifs créés', r.data.crees === 16, r.data.crees);
  const js = (await api('/api/etat')).data.actif.joueurs;
  check('tous payés directement', js.length === 16 && js.every(j => j.statut === 'paye'));
  check('pseudos préfixés Bot01..Bot16', js[0].pseudo === 'Bot01' && js[15].pseudo === 'Bot16', js.map(j => j.pseudo).slice(0, 3));
  r = await api('/api/admin/joueurs/simulation', { method: 'POST', body: { count: 10, prefix: 'Bot' } });
  check('2e appel : tableau plein -> 409 ou partiel', r.status === 409 || r.data.crees === 0, r.status === 409 ? '409' : r.data.crees);
  r = await api('/api/admin/joueurs/simulation', { method: 'POST', pin: '9999', body: { count: 5 } });
  check('endpoint protégé (401 mauvais PIN)', r.status === 401, r.status);
  r = await api('/api/admin/joueurs/simulation', { method: 'POST', pin: null, body: { count: 5 } });
  check('endpoint protégé (401 sans PIN)', r.status === 401, r.status);
  r = await api('/api/admin/tirage', { method: 'POST', body: {} });
  check('tirage OK avec 16 simulés', r.status === 200 && r.data.actif.matchs.filter(m => m.tour === 1).length === 8);

  console.log('== 9e. Simuler tout le tournoi (jusqu\'au champion) ==');
  r = await api('/api/admin/tournoi', { method: 'DELETE' });
  r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'SimuTotale', regle: 'blackball', taille: 16, format: 'double', dko_tours: 2, nb_tables: 2 } });
  r = await api('/api/admin/joueurs/simulation', { method: 'POST', body: { count: 16, prefix: 'Bot' } });
  await api('/api/admin/tirage', { method: 'POST', body: {} });
  r = await api('/api/admin/simuler', { method: 'POST', body: {} });
  check('simulation 200', r.status === 200, r.data);
  const hist9e = (await api('/api/etat')).data.historique.find(h => h.nom === 'SimuTotale');
  const detail9e = await api(`/api/tournois/${hist9e.id}`);
  const ms9e = detail9e.data.tournoi.matchs;
  const total9e = ms9e.length;
  const joues9e = ms9e.filter(x => x.etat === 'termine' || x.etat === 'forfait').length;
  check(`tous les matchs du tournoi joués (${joues9e}/${total9e})`, joues9e === total9e, { joues: joues9e, total: total9e });
  check('tournoi terminé avec champion', r.data.statut === 'termine' && !!r.data.champion, r.data);
  const hist = (await api('/api/etat')).data.historique;
  check('archivé dans l\'historique', hist.some(h => h.nom === 'SimuTotale' && h.statut === 'termine'));
  const stE = await api('/api/stats-joueurs');
  check('stats all-time remplies (16 joueurs du tournoi simulé présents)', stE.data.joueurs.filter(j => j.pseudo.startsWith('Bot')).length === 16, stE.data.joueurs.filter(j => j.pseudo.startsWith('Bot')).length);
  r = await api('/api/admin/simuler', { method: 'POST', pin: '9999', body: {} });
  check('simuler protégé par PIN (401)', r.status === 401, r.status);

  console.log('== 9f. Câblage DKO : le dernier tour du loser bracket réintègre le tableau final ==');
  for (const [taille, k] of [[16, 1], [16, 2], [16, 3], [32, 2], [32, 3]]) {
    await api('/api/admin/tournoi', { method: 'DELETE' }).catch(() => {});
    await api('/api/admin/tournoi', { method: 'POST', body: { nom: `DKO${taille}k${k}`, regle: 'blackball', taille, format: 'double', dko_tours: k, nb_tables: 4 } });
    await api('/api/admin/joueurs/simulation', { method: 'POST', body: { count: taille, prefix: 'P' } });
    await api('/api/admin/tirage', { method: 'POST', body: {} });
    const t = (await api('/api/etat')).data.actif;
    const maxLB = Math.max(...t.matchs.filter(m => m.bracket === 'LB').map(m => m.tour), 0);
    const lbLast = t.matchs.filter(m => m.bracket === 'LB' && m.tour === maxLB);
    const f1ids = new Set(t.matchs.filter(m => m.bracket === 'F' && m.tour === 1).map(m => m.id));
    check(`DKO ${taille} k=${k} : dernier LB (tour ${maxLB}) -> F tour 1`, lbLast.every(m => m.suivant_id && f1ids.has(m.suivant_id)));
    const r = await api('/api/admin/simuler', { method: 'POST', body: {} });
    check(`DKO ${taille} k=${k} : simulé jusqu'au bout (${r.data.statut}, champion ${r.data.champion})`, r.data.statut === 'termine' && !!r.data.champion);
    // rotation d'une demi-moitié (bb9e78a) : LB dernier tour p -> F1 position ((p-1+demi)%nbF1)+1,
    // chaque F1 reçoit exactement 1 WBk (slot 1) + 1 dernier-LB (slot 2), sans conflit
    const nbF1 = f1ids.size;
    const demi = Math.floor(nbF1 / 2) || 1;
    const wbk = t.matchs.filter(m => m.bracket === 'WB' && m.tour === k);
    const wbkTargets = new Set(wbk.map(m => m.suivant_id));
    const lbTargets = lbLast.map(m => m.suivant_id);
    const rotationOK = lbLast.every((m, i) => {
      const posCible = t.matchs.find(x => x.id === m.suivant_id)?.position;
      return posCible === ((i + demi) % nbF1) + 1;
    });
    check(`DKO ${taille} k=${k} : LB entre dans le tableau final en rotation de demi-moitié (pos ((p-1+${demi})%${nbF1})+1)`, rotationOK, { lbTargets, nbF1 });
    const distinctOK = new Set(lbTargets).size === lbTargets.length && lbTargets.every(id => f1ids.has(id));
    check(`DKO ${taille} k=${k} : chaque dernier-LB cible un F1 distinct (slot 2), chaque WBk un F1 distinct (slot 1)`, distinctOK && new Set(wbkTargets).size === wbk.length && [...wbkTargets].every(id => f1ids.has(id)), { lbTargets, wbkTargets: [...wbkTargets] });
  }

  console.log('== 9g. LB en race to 2 par défaut ==');
  await api('/api/admin/tournoi', { method: 'DELETE' });
  r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'LB2', regle: 'blackball', taille: 16, format: 'double', dko_tours: 2, nb_tables: 4 } });
  await api('/api/admin/joueurs/simulation', { method: 'POST', body: { count: 16, prefix: 'P' } });
  await api('/api/admin/tirage', { method: 'POST', body: {} });
  const t9g = (await api('/api/etat')).data.actif;
  const lb = t9g.matchs.filter(m => m.bracket === 'LB');
  const wb = t9g.matchs.filter(m => m.bracket === 'WB');
  const f = t9g.matchs.filter(m => m.bracket === 'F');
  check('tous les matchs LB en race to 2', lb.length > 0 && lb.every(m => m.manches === 2), lb.map(m => m.manches));
  check('WB et F restent en race to 3', wb.every(m => m.manches === 3) && f.every(m => m.manches === 3));
  r = await api('/api/admin/distances', { method: 'PUT', body: { distances: { lb1: 2, lb2: 3 } } });
  check('distance LB modifiable (2 acceptée)', r.status === 200, r.data);
  r = await api('/api/admin/distances', { method: 'PUT', body: { distances: { wb1: 9 } } });
  check('distance invalide 9 -> 400', r.status === 400, r.status);

  console.log('== 9. SSE accessible ==');
  const ctrl = new AbortController();
  const res = await fetch(BASE + '/api/events', { signal: ctrl.signal });
  check('SSE 200 + content-type', res.status === 200 && (res.headers.get('content-type') || '').includes('text/event-stream'));
  ctrl.abort();

  console.log(failures === 0 ? '\nTOUS LES TESTS PASSENT' : `\n${failures} ÉCHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('ERREUR', e); process.exit(1); });

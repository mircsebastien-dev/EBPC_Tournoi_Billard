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

async function main() {
  console.log('== 1. Création tournoi (double KO 2 tours, 16 joueurs) ==');
  let r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: 'Test Cup', regle: 'blackball', taille: 16, format: 'double', dko_tours: 2, nb_tables: 4 } });
  check('création 200', r.status === 200, r.data);
  check('statut inscription', r.data.tournoi.tournoi.statut === 'inscription');

  console.log('== 2. PIN requis ==');
  r = await api('/api/admin/joueur', { method: 'POST', pin: '9999', body: { pseudo: 'X' } });
  check('mauvais PIN -> 401', r.status === 401);

  console.log('== 3. Inscriptions (10 joueurs, 9 seront payés -> 1 bye) ==');
  for (let i = 1; i <= 10; i++) {
    r = await api('/api/admin/joueur', { method: 'POST', body: { pseudo: `J${i}` } });
    check(`inscription J${i}`, r.status === 200, r.data);
  }
  r = await api('/api/etat');
  check('10 joueurs inscrits', r.data.tournoi.joueurs.length === 10);
  check('tous en_attente par défaut', r.data.tournoi.joueurs.every(j => j.statut === 'en_attente'));

  console.log('== 3b. Paiement : tirage refusé sans joueurs payés ==');
  r = await api('/api/admin/tirage', { method: 'POST', body: {} });
  check('tirage refusé (0 payé)', r.status === 400, r.data);
  const ids = (await api('/api/etat')).data.tournoi.joueurs.map(j => j.id);
  for (let i = 0; i < 9; i++) {
    r = await api(`/api/admin/joueur/${ids[i]}/paiement`, { method: 'POST', body: { statut: 'paye' } });
    check(`paiement joueur ${ids[i]}`, r.status === 200, r.data);
  }
  r = await api('/api/admin/joueur/9999/paiement', { method: 'POST', body: { statut: 'paye' } });
  check('paiement joueur inexistant -> 404', r.status === 404);
  r = await api('/api/etat');
  check('9 payés / 1 en attente', r.data.tournoi.joueurs.filter(j => j.statut === 'paye').length === 9);

  console.log('== 4. Tirage (9 payés -> 9 joueurs dans le tableau, J10 exclu) ==');
  r = await api('/api/admin/tirage', { method: 'POST', body: {} });
  check('tirage 200', r.status === 200, r.data);
  const nonPaye = (await api('/api/etat')).data.tournoi.joueurs.find(j => j.statut !== 'paye');
  check('un seul joueur non payé', !!nonPaye);
  const dansTableau = r.data.tournoi.matchs.some(m => (m.joueur1 && m.joueur1.id === nonPaye.id) || (m.joueur2 && m.joueur2.id === nonPaye.id));
  check(`joueur non payé (${nonPaye && nonPaye.pseudo}) exclu du tirage`, !dansTableau);
  const t = r.data.tournoi;
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
  check('4 matchs WB1 complets (9 joueurs payés)', withBoth.length === 4, withBoth.length);
  const byes = wb1.filter(m => (m.joueur1 && !m.joueur2) || (!m.joueur1 && m.joueur2));
  check('1 bye au tour 1', byes.length === 1, byes.length);
  check('bye terminé automatiquement + gagnant propagé', byes.length === 1 && byes[0].etat === 'termine' && byes[0].gagnant_id != null, byes);

  console.log('== 5. Lancer un match complet et jouer ==');
  const m = withBoth.find(mm => mm.etat === 'pret') || withBoth[0];
  r = await api(`/api/admin/match/${m.id}/lancer`, { method: 'POST', body: { table_id: null } });
  check('lancement 200', r.status === 200, r.data);
  check('état en_cours', r.data.match.etat === 'en_cours');
  const j1 = m.joueur1.id, j2 = m.joueur2.id;
  r = await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: j1 } });
  check('manche J1', r.status === 200 && r.data.match.score1 === 1, r.data);
  r = await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: 9999 } });
  check('joueur externe -> 403', r.status === 403, r.data);
  for (let i = 0; i < 2; i++) await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: j1 } });
  r = await api('/api/etat');
  const m2 = r.data.tournoi.matchs.find(mm => mm.id === m.id);
  check('match terminé 3-0, gagnant J1', m2.etat === 'termine' && m2.score1 === 3 && m2.gagnant_id === j1, m2);
  const suivant = r.data.tournoi.matchs.find(mm => mm.id === m2.suivant_id);
  check('gagnant propagé au match suivant', suivant && (suivant.joueur1?.id === j1 || suivant.joueur2?.id === j1), suivant);
  const lbMatch = r.data.tournoi.matchs.find(mm => mm.id === m2.perdant_id);
  check('perdant envoyé en LB', lbMatch && (lbMatch.joueur1?.id === j2 || lbMatch.joueur2?.id === j2), lbMatch);

  console.log('== 6. Correction admin ==');
  r = await api(`/api/admin/match/${m.id}/correction`, { method: 'POST', body: { score1: 1, score2: 3, manches: 3, motif: 'test' } });
  check('correction 200', r.status === 200, r.data);
  check('score corrigé 1-3', r.data.match.score1 === 1 && r.data.match.score2 === 3, r.data.match);

  console.log('== 7. Forfait ==');
  const pret = (await api('/api/etat')).data.tournoi.matchs.find(mm => mm.etat === 'pret' && mm.joueur1 && mm.joueur2);
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
  for (const j of (await api('/api/etat')).data.tournoi.joueurs) {
    await api(`/api/admin/joueur/${j.id}/paiement`, { method: 'POST', body: { statut: 'paye' } });
  }
  r = await api('/api/admin/tirage', { method: 'POST', body: {} });
  const ts = r.data.tournoi;
  const tours = [1, 2, 3, 4].map(tn => ts.matchs.filter(m => m.tour === tn).length);
  check('simple KO 16: 8/4/2/1 matchs', JSON.stringify(tours) === '[8,4,2,1]', tours);
  check('aucun LB en simple', ts.matchs.every(m => m.bracket === 'WB'));

  console.log('== 9. SSE accessible ==');
  const ctrl = new AbortController();
  const res = await fetch(BASE + '/api/events', { signal: ctrl.signal });
  check('SSE 200 + content-type', res.status === 200 && (res.headers.get('content-type') || '').includes('text/event-stream'));
  ctrl.abort();

  console.log(failures === 0 ? '\nTOUS LES TESTS PASSENT' : `\n${failures} ÉCHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('ERREUR', e); process.exit(1); });

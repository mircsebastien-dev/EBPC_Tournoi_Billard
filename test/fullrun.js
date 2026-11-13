const BASE = process.env.BASE || 'http://127.0.0.1:3458';
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
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function jouerMatchComplet(m) {
  await api(`/api/admin/match/${m.id}/lancer`, { method: 'POST', body: { table_id: null } });
  // tirage à la bande obligatoire avant toute saisie (409 sinon)
  const cur = (await api('/api/etat')).data.actif.matchs.find(x => x.id === m.id);
  if (cur && cur.casseur == null) await api(`/api/match/${m.id}/bande`, { method: 'POST', pin: null, body: { joueur_id: m.joueur1.id } });
  const target = m.manches;
  const j1 = m.joueur1.id;
  for (let i = 0; i < target; i++) {
    await api(`/api/match/${m.id}/manche`, { method: 'POST', pin: null, body: { joueur_id: j1 } });
  }
}

async function main() {
  for (const [taille, format, k] of [[16, 'double', 2], [16, 'simple', 0], [32, 'double', 1], [32, 'double', 3]]) {
    console.log(`== Tournoi ${taille} joueurs, format=${format}${format === 'double' ? ` k=${k}` : ''} ==`);
    if ((await api('/api/etat')).data.actif) await api('/api/admin/tournoi', { method: 'DELETE' });
    let r = await api('/api/admin/tournoi', { method: 'POST', body: { nom: `T${taille}${format}${k}`, regle: 'blackball', taille, format, dko_tours: k, nb_tables: 4 } });
    check('création', r.status === 200, r.data);
    for (let i = 1; i <= taille; i++) await api('/api/admin/joueur', { method: 'POST', body: { pseudo: `P${i}` } });
    for (const j of (await api('/api/etat')).data.actif.joueurs) {
      await api(`/api/admin/joueur/${j.id}/paiement`, { method: 'POST', body: { statut: 'paye' } });
    }
    r = await api('/api/admin/tirage', { method: 'POST', body: {} });
    check('tirage', r.status === 200);

    const idCree = r.data.actif.tournoi.id;
    let guard = 0, done = false;
    while (guard++ < 500 && !done) {
      const etat = await api('/api/etat');
      const t = etat.data.actif;
      if (!t || t.tournoi.id !== idCree) { done = true; break; }
      const aJouer = t.matchs.filter(m => (m.etat === 'pret' || m.etat === 'prevu') && m.joueur1 && m.joueur2);
      if (aJouer.length === 0) { await new Promise(r2 => setTimeout(r2, 50)); continue; }
      await jouerMatchComplet(aJouer[0]);
    }
    const detail = await api(`/api/tournois/${idCree}`);
    const t = detail.data.tournoi;
    check(`tournoi terminé avec champion (${t.champion ? t.champion.pseudo : 'personne'})`, t.tournoi.statut === 'termine' && t.champion != null, { statut: t.tournoi.statut });
    const total = t.matchs.length;
    const joues = t.matchs.filter(m => m.etat === 'termine' || m.etat === 'forfait').length;
    check(`tous les matchs joués (${joues}/${total})`, joues === total, { joues, total });
    console.log(`   -> ${t.matchs.length} matchs, champion = ${t.champion && t.champion.pseudo}`);
  }
  console.log(failures === 0 ? '\nSIMULATION COMPLÈTE OK' : `\n${failures} ÉCHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error('ERREUR', e); process.exit(1); });

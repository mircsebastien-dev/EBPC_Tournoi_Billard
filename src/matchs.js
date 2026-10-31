const { db, logAudit } = require('./db');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function matchById(id) {
  return db.prepare('SELECT * FROM match WHERE id = ?').get(id);
}

function joueurById(id) {
  return id == null ? null : db.prepare('SELECT * FROM joueur WHERE id = ?').get(id);
}

function pseudo(id) {
  const j = joueurById(id);
  return j ? j.pseudo : null;
}

function tableNumero(tableId) {
  const t = db.prepare('SELECT numero FROM table_billard WHERE id = ?').get(tableId);
  return t ? t.numero : null;
}

function insererEvent(matchId, joueurId, type, detail) {
  db.prepare('INSERT INTO match_event (match_id, joueur_id, type, detail) VALUES (?, ?, ?, ?)')
    .run(matchId, joueurId, type, detail ? JSON.stringify(detail) : null);
}

function setJoueurDansSuivant(m, champ, toId, slot, joueurId) {
  const s = matchById(toId);
  if (!s) return;
  const col = slot === 1 ? 'joueur1_id' : 'joueur2_id';
  const autre = slot === 1 ? 'joueur2_id' : 'joueur1_id';
  db.prepare(`UPDATE match SET ${col} = ?, etat = CASE WHEN ${autre} IS NOT NULL AND etat = 'prevu' THEN 'pret' ELSE etat END, updated_at = datetime('now') WHERE id = ?`)
    .run(joueurId, s.id);
  appliquerBye(s.id);
}

function feederTermine(m, slot) {
  const feeder = db.prepare('SELECT etat FROM match WHERE suivant_id = ? AND suivant_slot = ?').get(m.id, slot)
    || db.prepare('SELECT etat FROM match WHERE perdant_id = ? AND perdant_slot = ?').get(m.id, slot);
  return !feeder || feeder.etat === 'termine' || feeder.etat === 'forfait';
}

function appliquerBye(matchId) {
  const m = matchById(matchId);
  if (!m || m.etat === 'termine' || m.etat === 'forfait' || m.etat === 'en_cours') return;
  let gagnant = null;
  let raison = null;
  if (m.joueur1_id != null && m.joueur2_id == null && feederTermine(m, 2)) {
    gagnant = m.joueur1_id;
    raison = 'adversaire absent (bye)';
  } else if (m.joueur2_id != null && m.joueur1_id == null && feederTermine(m, 1)) {
    gagnant = m.joueur2_id;
    raison = 'adversaire absent (bye)';
  } else if (m.joueur1_id == null && m.joueur2_id == null && feederTermine(m, 1) && feederTermine(m, 2)) {
    raison = 'match vide (aucun joueur des deux côtés)';
  } else return;
  db.prepare(`UPDATE match SET gagnant_id = ?, etat = 'termine', ended_at = COALESCE(ended_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`)
    .run(gagnant, matchId);
  insererEvent(matchId, gagnant, 'bye', { raison });
  if (gagnant != null) propagerGagnant(matchId, gagnant);
  verifierFinTournoi(matchById(matchId));
}

function propagerGagnant(matchId, gagnantId) {
  const m = matchById(matchId);
  if (m.suivant_id) setJoueurDansSuivant(m, 'suivant', m.suivant_id, m.suivant_slot, gagnantId);
}

function propagerPerdant(matchId, perdantId) {
  if (perdantId == null) return;
  const m = matchById(matchId);
  if (m.perdant_id) setJoueurDansSuivant(m, 'perdant', m.perdant_id, m.perdant_slot, perdantId);
}

function verifierFinTournoi(m) {
  const dernier = db.prepare(`
    SELECT id, gagnant_id FROM match WHERE tournoi_id = ?
    ORDER BY CASE bracket WHEN 'F' THEN 2 WHEN 'WB' THEN 1 ELSE 0 END DESC, tour DESC, position ASC LIMIT 1
  `).get(m.tournoi_id);
  if (dernier && dernier.id === m.id && dernier.gagnant_id != null) {
    db.prepare(`UPDATE tournoi SET statut = 'termine', champion_id = ? WHERE id = ?`).run(dernier.gagnant_id, m.tournoi_id);
    logAudit('tournoi_termine', `tournoi ${m.tournoi_id}`, null, { champion: pseudo(dernier.gagnant_id) });
  }
}

function terminerMatch(matchId, gagnantId, perdantId, raison) {
  const m = matchById(matchId);
  db.prepare(`UPDATE match SET gagnant_id = ?, etat = 'termine', ended_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(gagnantId, matchId);
  insererEvent(matchId, gagnantId, raison === 'forfait' ? 'forfait' : 'manche', { detail: raison || 'distance atteinte' });
  propagerGagnant(matchId, gagnantId);
  propagerPerdant(matchId, perdantId);
  verifierFinTournoi(matchById(matchId));
}

function declarerManche(matchId, joueurId) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  if (m.etat !== 'en_cours' && m.etat !== 'pret') throw httpError(409, 'Le match n\'est pas en cours');
  if (m.joueur1_id !== joueurId && m.joueur2_id !== joueurId) throw httpError(403, 'Vous ne jouez pas ce match');
  const s1 = m.joueur1_id === joueurId ? m.score1 + 1 : m.score1;
  const s2 = m.joueur2_id === joueurId ? m.score2 + 1 : m.score2;
  db.prepare(`UPDATE match SET score1 = ?, score2 = ?, etat = 'en_cours', updated_at = datetime('now') WHERE id = ?`)
    .run(s1, s2, matchId);
  insererEvent(matchId, joueurId, 'manche', { score1: s1, score2: s2 });
  const cur = matchById(matchId);
  if (s1 >= cur.manches || s2 >= cur.manches) {
    const gagnant = s1 > s2 ? cur.joueur1_id : cur.joueur2_id;
    const perdant = s1 > s2 ? cur.joueur2_id : cur.joueur1_id;
    terminerMatch(matchId, gagnant, perdant, 'distance atteinte');
  }
  return matchById(matchId);
}

function lancerMatch(matchId, tableId) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  if (m.joueur1_id == null || m.joueur2_id == null) throw httpError(409, 'Match incomplet (joueur manquant)');
  if (m.etat !== 'pret' && m.etat !== 'prevu') throw httpError(409, 'Match non lançable dans cet état');
  db.prepare(`UPDATE match SET etat = 'en_cours', table_id = ?, started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`).run(tableId, matchId);
  insererEvent(matchId, null, 'lancement', { table: tableId != null ? tableNumero(tableId) : null });
  return matchById(matchId);
}

function corrigerScore(matchId, score1, score2, manches, motif) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  const avant = { score1: m.score1, score2: m.score2, manches: m.manches, etat: m.etat, gagnant_id: m.gagnant_id };
  const s1 = Math.max(0, Math.min(score1, manches));
  const s2 = Math.max(0, Math.min(score2, manches));
  let etat = m.etat;
  let gagnant = m.gagnant_id;
  if (m.etat !== 'termine' && (s1 >= manches || s2 >= manches)) {
    etat = 'termine';
    gagnant = s1 > s2 ? m.joueur1_id : m.joueur2_id;
  }
  db.prepare(`UPDATE match SET score1 = ?, score2 = ?, manches = ?, etat = ?, gagnant_id = ?, ended_at = CASE WHEN ? = 'termine' THEN COALESCE(ended_at, datetime('now')) ELSE ended_at END, updated_at = datetime('now') WHERE id = ?`)
    .run(s1, s2, manches, etat, gagnant, etat, matchId);
  insererEvent(matchId, null, 'correction', { avant, apres: { score1: s1, score2: s2, manches, etat, gagnant_id: gagnant }, motif });
  logAudit('correction_score', `match ${matchId}`, avant, { score1: s1, score2: s2, manches, etat, gagnant_id: gagnant });
  if (etat === 'termine' && gagnant != null && avant.etat !== 'termine') {
    const perdant = gagnant === m.joueur1_id ? m.joueur2_id : m.joueur1_id;
    propagerGagnant(matchId, gagnant);
    propagerPerdant(matchId, perdant);
    verifierFinTournoi(matchById(matchId));
  }
  return matchById(matchId);
}

function declarerForfait(matchId, forfaitJoueurId) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  if (m.etat === 'termine') throw httpError(409, 'Match déjà terminé');
  const autre = forfaitJoueurId === m.joueur1_id ? m.joueur2_id : m.joueur1_id;
  db.prepare(`UPDATE match SET etat = 'forfait', gagnant_id = ?, ended_at = COALESCE(ended_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`).run(autre, matchId);
  insererEvent(matchId, forfaitJoueurId, 'forfait', { perdant: pseudo(forfaitJoueurId), gagnant: pseudo(autre) });
  logAudit('forfait', `match ${matchId}`, { etat: m.etat }, { forfait: pseudo(forfaitJoueurId), gagnant: pseudo(autre) });
  propagerGagnant(matchId, autre);
  propagerPerdant(matchId, forfaitJoueurId);
  verifierFinTournoi(matchById(matchId));
  return matchById(matchId);
}

function rafraichirPrets() {
  const actif = db.prepare(`SELECT id FROM tournoi WHERE statut IN ('inscription', 'en_cours') ORDER BY id DESC LIMIT 1`).get();
  if (!actif) return;
  const complets = db.prepare(`
    SELECT id FROM match
    WHERE tournoi_id = ? AND etat = 'prevu' AND joueur1_id IS NOT NULL AND joueur2_id IS NOT NULL
  `).all(actif.id);
  for (const r of complets) {
    db.prepare(`UPDATE match SET etat = 'pret', updated_at = datetime('now') WHERE id = ?`).run(r.id);
  }
  for (const r of db.prepare(`SELECT id FROM match WHERE tournoi_id = ? AND etat = 'prevu'`).all(actif.id)) appliquerBye(r.id);
}

module.exports = {
  httpError,
  matchById,
  joueurById,
  pseudo,
  tableNumero,
  insererEvent,
  appliquerBye,
  propagerGagnant,
  propagerPerdant,
  terminerMatch,
  declarerManche,
  lancerMatch,
  corrigerScore,
  declarerForfait,
  rafraichirPrets,
};

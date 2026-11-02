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

function tableLibre(tournoiId, exclureMatchId) {
  const occupees = db.prepare(`
    SELECT table_id FROM match WHERE tournoi_id = ? AND etat = 'en_cours' AND table_id IS NOT NULL
  `).all(tournoiId).map(r => r.table_id);
  const t = db.prepare(`
    SELECT id, numero FROM table_billard WHERE tournoi_id = ? ORDER BY numero
  `).all(tournoiId).find(tb => !occupees.includes(tb.id));
  return t || null;
}

function retirerManche(matchId, joueurId) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  if (m.etat !== 'en_cours' && m.etat !== 'pret') throw httpError(409, 'Le match n\'est pas en cours');
  if (m.joueur1_id !== joueurId && m.joueur2_id !== joueurId) throw httpError(403, 'Vous ne jouez pas ce match');
  const s1 = m.joueur1_id === joueurId ? Math.max(0, m.score1 - 1) : m.score1;
  const s2 = m.joueur2_id === joueurId ? Math.max(0, m.score2 - 1) : m.score2;
  db.prepare(`UPDATE match SET score1 = ?, score2 = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(s1, s2, matchId);
  insererEvent(matchId, joueurId, 'correction', { action: 'retirer_manche', score1: s1, score2: s2 });
  return matchById(matchId);
}

function lancerMatch(matchId, tableId) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  if (m.joueur1_id == null || m.joueur2_id == null) throw httpError(409, 'Match incomplet (joueur manquant)');
  if (m.etat !== 'pret' && m.etat !== 'prevu') throw httpError(409, 'Match non lançable dans cet état');
  if (tableId == null) {
    const libre = tableLibre(m.tournoi_id, matchId);
    tableId = libre ? libre.id : null;
  } else {
    const existe = db.prepare('SELECT id FROM table_billard WHERE id = ? AND tournoi_id = ?').get(tableId, m.tournoi_id);
    if (!existe) throw httpError(400, 'Table inconnue');
    const prise = db.prepare(`SELECT id FROM match WHERE tournoi_id = ? AND etat = 'en_cours' AND table_id = ? AND id != ?`).get(m.tournoi_id, tableId, matchId);
    if (prise) throw httpError(409, 'Cette table est déjà occupée par un match en cours');
  }
  db.prepare(`UPDATE match SET etat = 'en_cours', table_id = ?, started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`).run(tableId, matchId);
  insererEvent(matchId, null, 'lancement', { table: tableId != null ? tableNumero(tableId) : null });
  return matchById(matchId);
}

function retirerJoueurDuCible(m, champ, slot, joueurId) {
  const cibleId = champ === 'suivant' ? m.suivant_id : m.perdant_id;
  if (!cibleId) return;
  const s = matchById(cibleId);
  if (!s) return;
  const col = slot === 1 ? 'joueur1_id' : 'joueur2_id';
  const val = slot === 1 ? s.joueur1_id : s.joueur2_id;
  if (val !== joueurId) return;
  db.prepare(`UPDATE match SET ${col} = NULL, updated_at = datetime('now') WHERE id = ?`).run(s.id);
  const cur = matchById(s.id);
  if ((cur.joueur1_id == null || cur.joueur2_id == null) && cur.etat !== 'termine' && cur.etat !== 'forfait') {
    db.prepare(`UPDATE match SET etat = 'prevu', score1 = 0, score2 = 0, gagnant_id = NULL, updated_at = datetime('now') WHERE id = ?`).run(s.id);
  }
}

function annulerEnAval(matchId) {
  const m = matchById(matchId);
  if (!m) return;
  // retire le gagnant/perdant de ce match des matchs suivants, en cascade
  if (m.gagnant_id != null && m.suivant_id) {
    retirerJoueurDuCible(m, 'suivant', m.suivant_slot, m.gagnant_id);
    const s = matchById(m.suivant_id);
    if (s && (s.etat === 'termine' || s.etat === 'forfait' || s.etat === 'en_cours')) annulerEnAval(s.id);
  }
  if (m.gagnant_id != null && m.perdant_id) {
    retirerJoueurDuCible(m, 'perdant', m.perdant_slot, m.gagnant_id);
    const s = matchById(m.perdant_id);
    if (s && (s.etat === 'termine' || s.etat === 'forfait' || s.etat === 'en_cours')) annulerEnAval(s.id);
  }
  // le perdant de ce match venait peut-être d'ailleurs: on annule aussi son ancien perdant si le match était joué
  // (le perdant de m reste, il est toujours valide; seul le gagnant change potentiellement)
}

function rouvrirMatch(matchId) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  if (m.etat !== 'termine' && m.etat !== 'forfait') throw httpError(409, 'Seul un match terminé peut être rouvert');
  if (m.joueur1_id == null || m.joueur2_id == null) throw httpError(409, 'Match sans 2 joueurs');
  annulerEnAval(matchId);
  db.prepare(`UPDATE match SET etat = 'en_cours', gagnant_id = NULL, ended_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(matchId);
  insererEvent(matchId, null, 'correction', { action: 'rouvrir' });
  return matchById(matchId);
}

function corrigerScore(matchId, score1, score2, manches, motif) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  const avant = { score1: m.score1, score2: m.score2, manches: m.manches, etat: m.etat, gagnant_id: m.gagnant_id };
  if (avant.etat === 'termine' || avant.etat === 'forfait') annulerEnAval(matchId);
  const s1 = Math.max(0, Math.min(score1, manches));
  const s2 = Math.max(0, Math.min(score2, manches));
  let etat = m.etat;
  let gagnant = m.gagnant_id;
  if (s1 >= manches || s2 >= manches) {
    etat = 'termine';
    gagnant = s1 > s2 ? m.joueur1_id : m.joueur2_id;
  }
  db.prepare(`UPDATE match SET score1 = ?, score2 = ?, manches = ?, etat = ?, gagnant_id = ?, ended_at = CASE WHEN ? = 'termine' THEN COALESCE(ended_at, datetime('now')) ELSE ended_at END, updated_at = datetime('now') WHERE id = ?`)
    .run(s1, s2, manches, etat, gagnant, etat, matchId);
  insererEvent(matchId, null, 'correction', { avant, apres: { score1: s1, score2: s2, manches, etat, gagnant_id: gagnant }, motif });
  logAudit('correction_score', `match ${matchId}`, avant, { score1: s1, score2: s2, manches, etat, gagnant_id: gagnant });
  if (etat === 'termine' && gagnant != null) {
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

// Ordre de priorité demandé : round 1 d'abord, puis LB1#1, WB2#1, LB2#1... 
// => tri par (niveau, WB avant LB, position). Niveau: WB tour t -> t, LB tour t -> t, F tour t -> k+t
function niveauMatch(m, k) {
  if (m.bracket === 'WB') return m.tour;
  if (m.bracket === 'LB') return m.tour;
  return k + m.tour;
}

function prochainMatchAuto(tournoiId) {
  const t = db.prepare('SELECT dko_tours FROM tournoi WHERE id = ?').get(tournoiId);
  const k = t ? t.dko_tours : 0;
  const rows = db.prepare(`
    SELECT * FROM match WHERE tournoi_id = ? AND etat = 'pret'
      AND joueur1_id IS NOT NULL AND joueur2_id IS NOT NULL
  `).all(tournoiId);
  rows.sort((a, b) => {
    const na = niveauMatch(a, k), nb = niveauMatch(b, k);
    if (na !== nb) return na - nb;
    if (a.bracket !== b.bracket) return a.bracket === 'WB' ? -1 : 1; // WB avant LB
    return a.position - b.position;
  });
  return rows[0] || null;
}

// Table libre en respectant l'ordre préférentiel (setting table_pref, ex "3,4,5,6,7,8,1,2")
function tableLibrePref(tournoiId, exclureMatchId) {
  const { getSetting } = require('./db');
  const occupees = db.prepare(`
    SELECT table_id FROM match WHERE tournoi_id = ? AND etat = 'en_cours' AND table_id IS NOT NULL
  `).all(tournoiId).map(r => r.table_id);
  const toutes = db.prepare(`SELECT id, numero FROM table_billard WHERE tournoi_id = ? ORDER BY numero`).all(tournoiId);
  const libres = toutes.filter(tb => !occupees.includes(tb.id));
  const pref = (getSetting('table_pref') || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);
  if (pref.length === 0) return libres[0] || null;
  libres.sort((a, b) => {
    const ia = pref.indexOf(a.numero), ib = pref.indexOf(b.numero);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.numero - b.numero;
  });
  return libres[0] || null;
}

function autoLancer(tournoiId) {
  const { getSetting } = require('./db');
  if (getSetting('auto_on') !== '1') return 0;
  let lances = 0;
  for (let i = 0; i < 64; i++) {
    const m = prochainMatchAuto(tournoiId);
    if (!m) break;
    const libre = tableLibrePref(tournoiId, m.id);
    if (!libre) break; // plus de table libre -> on attend
    lancerMatch(m.id, libre.id);
    lances++;
  }
  return lances;
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
  retirerManche,
  lancerMatch,
  corrigerScore,
  declarerForfait,
  rafraichirPrets,
  tableLibre,
  rouvrirMatch,
  annulerEnAval,
  autoLancer,
  prochainMatchAuto,
  tableLibrePref,
};

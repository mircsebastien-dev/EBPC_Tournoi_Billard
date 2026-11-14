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
  if (s[autre] === joueurId) return; // ne jamais créer un match avec le même joueur des 2 côtés
  db.prepare(`UPDATE match SET ${col} = ?, etat = CASE WHEN ${autre} IS NOT NULL AND etat = 'prevu' THEN 'pret' ELSE etat END, updated_at = datetime('now') WHERE id = ?`)
    .run(joueurId, s.id);
  if (s.bracket) {
    // sweep anti-rematch sur tout le tour (WB/LB/F): un swap peut devenir possible quand les autres matchs du tour se remplissent
    let garde = 0, swapped = true;
    while (swapped && garde++ < 10) {
      swapped = false;
      const tous = db.prepare(`SELECT id FROM match WHERE tournoi_id = ? AND bracket = ? AND tour = ? AND etat IN ('prevu','pret') AND joueur1_id IS NOT NULL AND joueur2_id IS NOT NULL ORDER BY position`)
        .all(s.tournoi_id, s.bracket, s.tour);
      for (const f of tous) { if (eviterRematch(f.id)) { swapped = true; break; } }
    }
  }
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
    // garde-fou: on ne termine le tournoi que s'il ne reste plus aucun match jouable
    const reste = db.prepare(`SELECT COUNT(*) c FROM match WHERE tournoi_id = ?
      AND (etat IN ('pret', 'en_cours') OR (etat = 'prevu' AND (joueur1_id IS NOT NULL OR joueur2_id IS NOT NULL)))`)
      .get(m.tournoi_id).c;
    if (reste > 0) return;
    db.prepare(`UPDATE tournoi SET statut = 'termine', champion_id = ? WHERE id = ?`).run(dernier.gagnant_id, m.tournoi_id);
    logAudit('tournoi_termine', `tournoi ${m.tournoi_id}`, null, { champion: pseudo(dernier.gagnant_id) });
  }
}

function terminerMatch(matchId, gagnantId, perdantId, raison) {
  const m = matchById(matchId);
  db.prepare(`UPDATE match SET gagnant_id = ?, etat = 'termine', ended_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(gagnantId, matchId);
  // ne PAS re-loguer la manche gagnante si elle vient d'être loguée (runout/manche) -> sinon double comptage dans les stats
  const dernier = db.prepare(`SELECT type, joueur_id FROM match_event WHERE match_id = ? ORDER BY id DESC LIMIT 1`).get(matchId);
  if (!(dernier && (dernier.type === 'manche' || dernier.type === 'runout') && dernier.joueur_id === gagnantId)) {
    insererEvent(matchId, gagnantId, raison === 'forfait' ? 'forfait' : 'manche', { detail: raison || 'distance atteinte' });
  }
  propagerGagnant(matchId, gagnantId);
  propagerPerdant(matchId, perdantId);
  verifierFinTournoi(matchById(matchId));
}

// Tirage à la bande: déclare qui casse en premier
function setBande(matchId, joueurId) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  if (m.joueur1_id !== joueurId && m.joueur2_id !== joueurId) throw httpError(403, 'Vous ne jouez pas ce match');

  db.prepare("UPDATE match SET casseur_id = ?, updated_at = datetime('now') WHERE id = ?").run(joueurId, matchId);
  insererEvent(matchId, joueurId, 'bande', { gagnant_bande: pseudo(joueurId) });
  return matchById(matchId);
}

function declarerManche(matchId, joueurId) {
  const m0 = matchById(matchId);
  if (m0 && m0.casseur_id == null && (m0.etat === 'en_cours' || m0.etat === 'pret')) throw httpError(409, 'Tirage à la bande non fait');
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  if (m.etat !== 'en_cours' && m.etat !== 'pret') throw httpError(409, 'Le match n\'est pas en cours');
  if (m.joueur1_id !== joueurId && m.joueur2_id !== joueurId) throw httpError(403, 'Vous ne jouez pas ce match');
  const s1 = m.joueur1_id === joueurId ? m.score1 + 1 : m.score1;
  const s2 = m.joueur2_id === joueurId ? m.score2 + 1 : m.score2;
  db.prepare(`UPDATE match SET score1 = ?, score2 = ?, etat = 'en_cours', updated_at = datetime('now') WHERE id = ?`)
    .run(s1, s2, matchId);
  insererEvent(matchId, joueurId, 'manche', { score1: s1, score2: s2 });
  // règle tournoi: le gagnant d'une manche casse la suivante
  const adversaire = (m.casseur_id || joueurId) === m.joueur1_id ? m.joueur2_id : m.joueur1_id; // alternance: on inverse le casseur actuel
  db.prepare('UPDATE match SET casseur_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(adversaire, matchId);
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

function declarerRunout(matchId, joueurId, kind = 'reprise') {
  const m0 = matchById(matchId);
  if (m0 && m0.casseur_id == null && (m0.etat === 'en_cours' || m0.etat === 'pret')) throw httpError(409, 'Tirage à la bande non fait');
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  if (m.etat !== 'en_cours' && m.etat !== 'pret') throw httpError(409, 'Le match n\'est pas en cours');
  if (m.joueur1_id !== joueurId && m.joueur2_id !== joueurId) throw httpError(403, 'Vous ne jouez pas ce match');
  const k = kind === 'casse' ? 'casse' : 'reprise';
  // règle: seul le casseur (⚪) peut faire une casse ferme; l'autre fait des reprises
  if (m.casseur_id != null) {
    if (k === 'casse' && m.casseur_id !== joueurId) throw httpError(403, 'Seul le joueur qui a la casse peut faire une casse ferme');
    if (k === 'reprise' && m.casseur_id === joueurId) throw httpError(403, 'Le joueur qui a la casse ne peut pas faire de reprise ferme');
  }
  const s1 = m.joueur1_id === joueurId ? m.score1 + 1 : m.score1;
  const s2 = m.joueur2_id === joueurId ? m.score2 + 1 : m.score2;
  db.prepare(`UPDATE match SET score1 = ?, score2 = ?, etat = 'en_cours', updated_at = datetime('now') WHERE id = ?`)
    .run(s1, s2, matchId);
  insererEvent(matchId, joueurId, 'runout', { kind: k, score1: s1, score2: s2 });
  const adversaire = (m.casseur_id || joueurId) === m.joueur1_id ? m.joueur2_id : m.joueur1_id; // alternance: on inverse le casseur actuel
  db.prepare('UPDATE match SET casseur_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(adversaire, matchId);
  const cur = matchById(matchId);
  if (s1 >= cur.manches || s2 >= cur.manches) {
    const gagnant = s1 > s2 ? cur.joueur1_id : cur.joueur2_id;
    const perdant = s1 > s2 ? cur.joueur2_id : cur.joueur1_id;
    terminerMatch(matchId, gagnant, perdant, k === 'casse' ? 'casse ferme (8 à la casse)' : 'reprise ferme (run out)');
  }
  return matchById(matchId);
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
  // on inverse l'alternance du ⚪: le casseur redevient l'adversaire du casseur actuel
  if (m.casseur_id != null) {
    const precedent = m.casseur_id === m.joueur1_id ? m.joueur2_id : m.joueur1_id;
    db.prepare("UPDATE match SET casseur_id = ?, updated_at = datetime('now') WHERE id = ?").run(precedent, matchId);
  }
  insererEvent(matchId, joueurId, 'correction', { action: 'retirer_manche', score1: s1, score2: s2 });
  return matchById(matchId);
}

// Garantie anti-rematch: aucun match ne peut démarrer (ou finir par forfait/correction) avec une paire
// de joueurs déjà appariée ailleurs, hors finale (dernier tour F à 1 match) et cas forcé (dernier tour LB à 1 match).
function assertPasDeRematch(m) {
  if (!m.joueur1_id || !m.joueur2_id) return;
  const maxT = dernierTourB(m.tournoi_id, m.bracket);
  const nbDernier = db.prepare('SELECT COUNT(*) c FROM match WHERE tournoi_id = ? AND bracket = ? AND tour = ?').get(m.tournoi_id, m.bracket, maxT).c;
  if (m.tour >= maxT && nbDernier <= 1) return; // finale / dernier tour à 1 match: rematch autorisé
  { // sweep du tour au cas où un swap est possible
    let garde = 0, swapped = true;
    while (swapped && garde++ < 10) {
      swapped = false;
      const tous = db.prepare(`SELECT id FROM match WHERE tournoi_id = ? AND bracket = ? AND tour = ? AND etat IN ('prevu','pret') AND joueur1_id IS NOT NULL AND joueur2_id IS NOT NULL ORDER BY position`)
        .all(m.tournoi_id, m.bracket, m.tour);
      for (const f of tous) { if (eviterRematch(f.id)) { swapped = true; break; } }
    }
  }
  const m2 = matchById(m.id);
  if (paireExiste(m2.tournoi_id, m2.joueur1_id, m2.joueur2_id, [m2.id]))
    throw httpError(409, 'Rematch interdit hors finale : ces deux joueurs sont déjà appariés dans un autre match');
}

function lancerMatch(matchId, tableId) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  if (m.joueur1_id == null || m.joueur2_id == null) throw httpError(409, 'Match incomplet (joueur manquant)');
  if (m.etat !== 'pret' && m.etat !== 'prevu') throw httpError(409, 'Match non lançable dans cet état');
  assertPasDeRematch(m);
  if (tableId == null) {
    const libre = tableLibrePref(m.tournoi_id, matchId); // pref + tables réservées en phase finale
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
  // réouverture interdite si l'aval a déjà commencé/joué (corriger manuellement les matchs suivants à la place)
  for (const toId of [m.suivant_id, m.perdant_id]) {
    if (!toId) continue;
    const s = matchById(toId);
    if (s && (s.etat === 'en_cours' || s.etat === 'termine' || s.etat === 'forfait' || s.joueur1_id != null || s.joueur2_id != null)) {
      throw httpError(409, `Réouverture interdite : le match aval #${s.position} (${s.bracket}${s.tour}) a déjà commencé. Corrige les joueurs/scores à la main sur ce match.`);
    }
  }
  annulerEnAval(matchId);
  db.prepare(`UPDATE match SET etat = 'en_cours', gagnant_id = NULL, ended_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(matchId);
  insererEvent(matchId, null, 'correction', { action: 'rouvrir' });
  return matchById(matchId);
}

function corrigerScore(matchId, score1, score2, manches, motif) {
  let m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  const avant = { score1: m.score1, score2: m.score2, manches: m.manches, etat: m.etat, gagnant_id: m.gagnant_id };
  if (avant.etat === 'termine' || avant.etat === 'forfait') annulerEnAval(matchId);
  const s1 = Math.max(0, Math.min(score1, manches));
  const s2 = Math.max(0, Math.min(score2, manches));
  if (s1 >= manches || s2 >= manches) { assertPasDeRematch(matchById(matchId)); m = matchById(matchId); }
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
  assertPasDeRematch(m);
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

// Tables réservées (setting tables_reservees, ex "1,2") à partir d'un tour (défaut: quarts = log2(taille)-2).
// Ex 16 joueurs: quarts = tour 2 -> à partir de ce tour T1/T2 ne sont plus utilisées (sauf si plus assez de tables ailleurs)
function tablesReserveesAuTour(tournoiId, m) {
  const { getSetting } = require('./db');
  const nums = (getSetting('tables_reservees') || '').split(',').map(x => parseInt(x.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);
  if (!nums.length || !m) return [];
  const t = db.prepare('SELECT taille FROM tournoi WHERE id = ?').get(tournoiId);
  const quarts = Math.max(1, Math.round(Math.log2(t.taille)) - 2);
  const seuil = parseInt(getSetting('reservees_tour') || '', 10) || quarts;
  const phaseFinale = m.bracket === 'F' || m.tour >= seuil;
  return phaseFinale ? nums : [];
}

// Table libre en respectant l'ordre préférentiel (setting table_pref, ex "3,4,5,6,7,8,1,2")
function tableLibrePref(tournoiId, matchId) {
  const { getSetting } = require('./db');
  const m = matchId ? db.prepare('SELECT bracket, tour FROM match WHERE id = ?').get(matchId) : null;
  const reservees = tablesReserveesAuTour(tournoiId, m);
  const occupees = db.prepare(`
    SELECT table_id FROM match WHERE tournoi_id = ? AND etat = 'en_cours' AND table_id IS NOT NULL
  `).all(tournoiId).map(r => r.table_id);
  const toutes = db.prepare(`SELECT id, numero FROM table_billard WHERE tournoi_id = ? ORDER BY numero`).all(tournoiId);
  const libres = toutes.filter(tb => !occupees.includes(tb.id) && !reservees.includes(tb.numero));
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


// Admin: déplacer un match sur une autre table (vérifie que la table existe et n'est pas occupée)
function setTableAdmin(matchId, tableId) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  if (tableId == null) { // libérer la table
    db.prepare('UPDATE match SET table_id = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(matchId);
    return matchById(matchId);
  }
  const t = db.prepare('SELECT id FROM table_billard WHERE id = ? AND tournoi_id = ?').get(tableId, m.tournoi_id);
  if (!t) throw httpError(400, 'Table inconnue pour ce tournoi');
  const prise = db.prepare(`SELECT id FROM match WHERE tournoi_id = ? AND etat = 'en_cours' AND table_id = ? AND id != ?`).get(m.tournoi_id, tableId, matchId);
  if (prise) throw httpError(409, `Table déjà occupée par le match #${prise}`);
  db.prepare('UPDATE match SET table_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(tableId, matchId);
  return matchById(matchId);
}


// Admin: changer les joueurs d'un match (joueur1_id / joueur2_id, null autorisé pour un blanc)
function setJoueursAdmin(matchId, j1, j2) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  if (j1 != null && j1 === j2) throw httpError(400, 'Les deux joueurs doivent être différents');
  for (const j of [j1, j2]) {
    if (j != null && !db.prepare('SELECT id FROM joueur WHERE id = ? AND tournoi_id = ?').get(j, m.tournoi_id))
      throw httpError(400, 'Joueur inconnu dans ce tournoi');
  }
  // rematch interdit hors finale : on refuse un changement manuel qui remettrait ensemble 2 joueurs
  // déjà appariés (joués OU prévus) dans un autre match — sauf si l'un des deux matchs est la vraie finale
  if (j1 != null && j2 != null) {
    const existe = paireExiste(m.tournoi_id, j1, j2, [m.id]);
    if (existe) {
      const estFinale = (x) => x.bracket === 'F' && x.tour === dernierTourF(m.tournoi_id);
      if (!estFinale(m) && !estFinale(existe))
        throw httpError(409, `Rematch interdit hors finale : cette paire est déjà au match #${existe.id}`);
    }
  }
  db.prepare('UPDATE match SET joueur1_id = ?, joueur2_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(j1, j2, matchId);
  // si un côté devient null et l'autre non -> bye auto (uniquement si le feeder du côté null est terminé)
  appliquerBye(matchId);
  return matchById(matchId);
}


// ---- Anti-rematch strict jusqu'à la vraie finale (dernier tour F) ----
function dejaJoues(tournoiId, a, b, saufIds = []) {
  if (!a || !b || a === b) return false;
  let sql = `
    SELECT 1 FROM match WHERE tournoi_id = ? AND etat IN ('termine','forfait','en_cours')
      AND ((joueur1_id = ? AND joueur2_id = ?) OR (joueur1_id = ? AND joueur2_id = ?))`;
  const params = [tournoiId, a, b, b, a];
  if (saufIds.length) { sql += ` AND id NOT IN (${saufIds.map(() => '?').join(',')})`; params.push(...saufIds); }
  return !!db.prepare(sql + ' LIMIT 1').get(...params);
}

// paire présente dans un match quel que soit son état (prevu/pret/joué) — anti-rematch strict
function paireExiste(tournoiId, a, b, saufIds = []) {
  if (!a || !b || a === b) return null;
  let sql = `SELECT id, bracket, tour FROM match WHERE tournoi_id = ? AND ((joueur1_id = ? AND joueur2_id = ?) OR (joueur1_id = ? AND joueur2_id = ?))`;
  const params = [tournoiId, a, b, b, a];
  if (saufIds.length) { sql += ` AND id NOT IN (${saufIds.map(() => '?').join(',')})`; params.push(...saufIds); }
  return db.prepare(sql + ' LIMIT 1').get(...params) || null;
}

function dernierTourF(tournoiId) {
  const r = db.prepare("SELECT MAX(tour) t FROM match WHERE tournoi_id = ? AND bracket = 'F'").get(tournoiId);
  return r ? r.t : 0;
}
function dernierTourB(tournoiId, bracket) {
  const r = db.prepare('SELECT MAX(tour) t FROM match WHERE tournoi_id = ? AND bracket = ?').get(tournoiId, bracket);
  return r ? r.t : 0;
}

// Si un match F ou LB (hors dernier tour du bracket = finale) a ses 2 joueurs déjà appariés ailleurs,
// on essaie de swap un seul joueur avec un autre match du même tour pour casser le rematch.
function eviterRematch(fMatchId) {
  const f = matchById(fMatchId);
  if (!f || !f.bracket || (f.etat !== 'prevu' && f.etat !== 'pret')) return false; // on ne swappe que des matchs non démarrés
  const maxT = dernierTourB(f.tournoi_id, f.bracket);
  const nbDernier = db.prepare('SELECT COUNT(*) c FROM match WHERE tournoi_id = ? AND bracket = ? AND tour = ?').get(f.tournoi_id, f.bracket, maxT).c;
  if (f.tour >= maxT && nbDernier <= 1) return false; // finale (dernier tour à 1 match): rematch autorisé (forcé)
  if (!f.joueur1_id || !f.joueur2_id) return false;
  if (!paireExiste(f.tournoi_id, f.joueur1_id, f.joueur2_id, [f.id])) return false;
  // partenaires: tout match du même bracket+tour avec AU MOINS un joueur (l'autre slot peut être encore vide)
  const autres = db.prepare(`SELECT * FROM match WHERE tournoi_id = ? AND bracket = ? AND tour = ? AND id != ?
    AND etat IN ('prevu','pret') AND (joueur1_id IS NOT NULL OR joueur2_id IS NOT NULL)`).all(f.tournoi_id, f.bracket, f.tour, f.id);
  // f=(a,b) est un rematch; on essaie de séparer a et b en échangeant UN SEUL joueur avec g
  // (4 orientations: on échange le slot de f avec un slot rempli de g)
  for (const g of autres) {
    const F = { j1: f.joueur1_id, j2: f.joueur2_id };
    const G = { j1: g.joueur1_id, j2: g.joueur2_id };
    for (const fs of ['j1', 'j2']) {
      for (const gs of ['j1', 'j2']) {
        if (G[gs] == null) continue;
        const newF = { ...F, [fs]: G[gs] };
        const newG = { ...G, [gs]: F[fs] };
        if (newF.j1 === newF.j2) continue; // ne jamais créer j1 === j2
        if (newG.j1 != null && newG.j2 != null && newG.j1 === newG.j2) continue;
        if (paireExiste(f.tournoi_id, newF.j1, newF.j2, [f.id, g.id])) continue;
        if (newG.j1 != null && newG.j2 != null && paireExiste(f.tournoi_id, newG.j1, newG.j2, [f.id, g.id])) continue;
        const fCol = fs === 'j1' ? 'joueur1_id' : 'joueur2_id';
        const gCol = gs === 'j1' ? 'joueur1_id' : 'joueur2_id';
        db.prepare(`UPDATE match SET ${fCol} = ? WHERE id = ?`).run(G[gs], f.id);
        db.prepare(`UPDATE match SET ${gCol} = ? WHERE id = ?`).run(F[fs], g.id);
        try { db.prepare('INSERT INTO audit_log (action, cible, avant, apres) VALUES (?, ?, ?, ?)').run(`rematch_swap_${f.bracket.toLowerCase()}`, `swap ${f.bracket}${f.tour} #${f.position}<->#${g.position}`, JSON.stringify({ f: F, g: G }), JSON.stringify({ f: newF, g: newG })); } catch {}
        return true;
      }
    }
  }
  return false;
}
const eviterRematchF = eviterRematch; // alias (rétro-compat)


// Admin: events d'un match + suppression avec recalcul des scores
function listerEvents(matchId) {
  return db.prepare(`SELECT e.id, e.type, e.detail, e.created_at, j.pseudo FROM match_event e LEFT JOIN joueur j ON j.id = e.joueur_id WHERE e.match_id = ? ORDER BY e.id`).all(matchId);
}
function supprimerEventAdmin(matchId, eventId) {
  const m = matchById(matchId);
  if (!m) throw httpError(404, 'Match introuvable');
  const ev = db.prepare('SELECT * FROM match_event WHERE id = ? AND match_id = ?').get(eventId, matchId);
  if (!ev) throw httpError(404, 'Événement introuvable');
  if (ev.type === 'bande') throw httpError(400, 'Impossible de supprimer le tirage à la bande');
  db.prepare('DELETE FROM match_event WHERE id = ?').run(eventId);
  const evs = db.prepare("SELECT joueur_id, type FROM match_event WHERE match_id = ? AND type IN ('manche','runout')").all(matchId);
  const s1 = evs.filter(e => e.joueur_id === m.joueur1_id).length;
  const s2 = evs.filter(e => e.joueur_id === m.joueur2_id).length;
  db.prepare(`UPDATE match SET score1 = ?, score2 = ?, updated_at = datetime('now') WHERE id = ?`).run(s1, s2, matchId);
  let cur = matchById(matchId);
  if (cur.etat === 'termine' && s1 < cur.manches && s2 < cur.manches) {
    db.prepare(`UPDATE match SET etat = 'en_cours', gagnant_id = NULL, perdant_id = NULL, ended_at = NULL WHERE id = ?`).run(matchId);
  } else if (cur.etat !== 'termine' && (s1 >= cur.manches || s2 >= cur.manches)) {
    const g = s1 > s2 ? cur.joueur1_id : cur.joueur2_id;
    const p = s1 > s2 ? cur.joueur2_id : cur.joueur1_id;
    terminerMatch(matchId, g, p, 'correction admin');
  }
  return matchById(matchId);
}

module.exports = { listerEvents, supprimerEventAdmin, eviterRematchF, eviterRematch, dejaJoues, paireExiste, setTableAdmin, setJoueursAdmin,
  httpError,
  matchById,
  setBande,
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
  declarerRunout,
  rafraichirPrets,
  tableLibre,
  rouvrirMatch,
  annulerEnAval,
  autoLancer,
  prochainMatchAuto,
  tableLibrePref,
};

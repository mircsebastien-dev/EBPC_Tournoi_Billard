const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { db, setSetting, getSetting, logAudit } = require('./db');
const bracket = require('./bracket');
const M = require('./matchs');
const comptes = require('./comptes');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '0000';
setSetting('admin_pin_hash', crypto.createHash('sha256').update(ADMIN_PIN).digest('hex'));

const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
app.use(comptes.middlewareSession);

const clients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

function requireAdmin(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.query.pin || (req.body && req.body.pin);
  const hash = crypto.createHash('sha256').update(String(pin || '')).digest('hex');
  if (hash !== getSetting('admin_pin_hash')) {
    return res.status(401).json({ error: 'PIN administrateur invalide' });
  }
  next();
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    // HTML/JS/CSS toujours revalidés (évite le vieux common.js en cache sur mobile)
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

function tournoiActif() {
  return db.prepare(`SELECT * FROM tournoi WHERE statut IN ('inscription', 'en_cours') ORDER BY id DESC LIMIT 1`).get()
    || null;
}

function distancesMap(tournoiId) {
  const rows = db.prepare('SELECT round, manches FROM distance_round WHERE tournoi_id = ?').all(tournoiId);
  const map = {};
  for (const r of rows) map[r.round] = r.manches;
  return map;
}

// Tous les ids joueur d'un même joueur (même pseudo, ou même compte) -> agrège tous les tournois
function idsMemeJoueur(id) {
  const j = db.prepare('SELECT pseudo, compte_id FROM joueur WHERE id = ?').get(id);
  if (!j) return { pseudo: null, ids: [] };
  let ids;
  if (j.compte_id) ids = db.prepare('SELECT id FROM joueur WHERE compte_id = ?').all(j.compte_id).map(r => r.id);
  else ids = db.prepare('SELECT id FROM joueur WHERE LOWER(pseudo) = LOWER(?)').all(j.pseudo).map(r => r.id);
  if (!ids.includes(id)) ids.push(id);
  return { pseudo: j.pseudo, ids };
}

function vueMatch(m) {
  const cids = m.joueur1_id ? db.prepare('SELECT compte_id FROM joueur WHERE id = ?').get(m.joueur1_id) : null;
  const cids2 = m.joueur2_id ? db.prepare('SELECT compte_id FROM joueur WHERE id = ?').get(m.joueur2_id) : null;
  m.joueur1_compte_id = cids ? cids.compte_id : null;
  m.joueur2_compte_id = cids2 ? cids2.compte_id : null;
  return {
    id: m.id,
    tournoi_id: m.tournoi_id,
    bracket: m.bracket,
    tour: m.tour,
    position: m.position,
    joueur1: m.joueur1_id ? { id: m.joueur1_id, pseudo: M.pseudo(m.joueur1_id), compte_id: m.joueur1_compte_id ?? null } : null,
    joueur2: m.joueur2_id ? { id: m.joueur2_id, pseudo: M.pseudo(m.joueur2_id), compte_id: m.joueur2_compte_id ?? null } : null,
    score1: m.score1,
    score2: m.score2,
    manches: m.manches,
    gagnant_id: m.gagnant_id,
    gagnant: m.gagnant_id ? M.pseudo(m.gagnant_id) : null,
    etat: m.etat,
    table: m.table_id ? M.tableNumero(m.table_id) : null,
    suivant_id: m.suivant_id,
    perdant_id: m.perdant_id,
    started_at: m.started_at,
    ended_at: m.ended_at,
    duree_s: (m.started_at && m.ended_at)
      ? Math.max(0, Math.round((new Date(m.ended_at.replace(' ', 'T') + 'Z') - new Date(m.started_at.replace(' ', 'T') + 'Z')) / 1000))
      : null,
  };
}

function calculerStats(tournoiId) {
  const rows = db.prepare(`
    SELECT joueur1_id j1, joueur2_id j2, gagnant_id, etat, started_at, ended_at
    FROM match WHERE tournoi_id = ? AND etat IN ('termine', 'forfait') AND gagnant_id IS NOT NULL
  `).all(tournoiId);
  const parJoueur = {};
  for (const j of db.prepare('SELECT id, pseudo FROM joueur WHERE tournoi_id = ?').all(tournoiId)) {
    parJoueur[j.id] = { id: j.id, pseudo: j.pseudo, joues: 0, gagnes: 0, perdus: 0, pct: 0, serie: 0 };
  }
  let dureeTot = 0, nbDurees = 0, plusRapide = null, plusLong = null, dernierGagnant = null, dernierFin = null;
  for (const r of rows) {
    for (const jid of [r.j1, r.j2]) {
      if (jid == null || !parJoueur[jid]) continue;
      const p = parJoueur[jid];
      p.joues++;
      if (r.gagnant_id === jid) { p.gagnes++; p.serie = p.serie >= 0 ? p.serie + 1 : 1; }
      else { p.perdus++; p.serie = p.serie <= 0 ? p.serie - 1 : -1; }
    }
    if (r.started_at && r.ended_at) {
      const d = Math.max(0, Math.round((new Date(r.ended_at.replace(' ', 'T') + 'Z') - new Date(r.started_at.replace(' ', 'T') + 'Z')) / 1000));
      dureeTot += d; nbDurees++;
      if (!plusRapide || d < plusRapide.d) plusRapide = { d, gagnant: M.pseudo(r.gagnant_id) };
      if (!plusLong || d > plusLong.d) plusLong = { d, gagnant: M.pseudo(r.gagnant_id) };
    }
    if (!dernierFin || (r.ended_at && r.ended_at > dernierFin)) { dernierFin = r.ended_at; dernierGagnant = M.pseudo(r.gagnant_id); }
  }
  for (const p of Object.values(parJoueur)) p.pct = p.joues ? Math.round((p.gagnes / p.joues) * 100) : 0;
  const classement = Object.values(parJoueur).sort((a, b) => b.gagnes - a.gagnes || b.pct - a.pct || a.pseudo.localeCompare(b.pseudo));
  const total = db.prepare('SELECT COUNT(*) c FROM match WHERE tournoi_id = ?').get(tournoiId).c;
  return {
    classement,
    resume: {
      joues: rows.length,
      total,
      restants: total - rows.length,
      duree_moyenne_s: nbDurees ? Math.round(dureeTot / nbDurees) : null,
      plus_rapide: plusRapide,
      plus_long: plusLong,
      dernier_gagnant: dernierGagnant,
    },
  };
}

function vueTournoiComplet(t) {
  if (!t) return null;
  const joueurs = db.prepare('SELECT id, pseudo, tete_de_serie, statut, compte_id FROM joueur WHERE tournoi_id = ? ORDER BY pseudo').all(t.id);
  const matchs = db.prepare(`SELECT * FROM match WHERE tournoi_id = ? ORDER BY CASE bracket WHEN 'WB' THEN 1 WHEN 'LB' THEN 2 ELSE 3 END, tour, position`).all(t.id);
  const rounds = bracket.listeRounds(t.taille, t.format, t.dko_tours).map(r => ({
    ...r,
    label: bracket.labelRound(r.key, t.taille, t.format, t.dko_tours),
    manches: distancesMap(t.id)[r.key] || 3,
  }));
  const tables = db.prepare('SELECT * FROM table_billard WHERE tournoi_id = ? ORDER BY numero').all(t.id);
  const champion = t.champion_id ? { id: t.champion_id, pseudo: M.pseudo(t.champion_id) } : null;
  return {
    tournoi: t,
    joueurs,
    matchs: matchs.map(vueMatch),
    rounds,
    tables,
    champion,
    stats: calculerStats(t.id),
  };
}

function vueTournoiListe() {
  const rows = db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM match WHERE tournoi_id = t.id) nb_matchs,
           (SELECT COUNT(*) FROM joueur WHERE tournoi_id = t.id) nb_joueurs
    FROM tournoi t ORDER BY t.id DESC
  `).all();
  return rows.map(t => ({
    ...t,
    champion: t.champion_id ? M.pseudo(t.champion_id) : null,
  }));
}

function etatGlobal(req) {
  return {
    actif: vueTournoiComplet(tournoiActif()),
    historique: vueTournoiListe().filter(t => t.statut === 'termine'),
    auto: getSetting('auto_on') === '1',
    table_pref: getSetting('table_pref') || '',
    compte: req && req.compte ? { id: req.compte.id, pseudo: req.compte.pseudo } : null,
  };
}

app.get('/api/etat', (req, res) => {
  const tournoiId = req.query.tournoi_id ? Number(req.query.tournoi_id) : null;
  if (tournoiId) {
    const t = db.prepare('SELECT * FROM tournoi WHERE id = ?').get(tournoiId);
    return res.json({ tournoi: vueTournoiComplet(t), historique: vueTournoiListe().filter(x => x.statut === 'termine'), compte: req.compte ? { id: req.compte.id, pseudo: req.compte.pseudo } : null });
  }
  res.json(etatGlobal(req));
});

app.get('/api/tournois', (req, res) => res.json({ tournois: vueTournoiListe() }));

app.get('/api/tournois/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tournoi WHERE id = ?').get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });
  res.json({ tournoi: vueTournoiComplet(t) });
});

app.get('/api/stats-joueurs', (req, res) => {
  const rows = db.prepare(`
    SELECT MIN(j.id) id, j.pseudo,
           COUNT(DISTINCT m.id) joues,
           SUM(CASE WHEN m.gagnant_id IS NOT NULL AND (m.joueur1_id = j.id OR m.joueur2_id = j.id) AND m.gagnant_id = j.id THEN 1 ELSE 0 END) gagnes,
           COUNT(DISTINCT t.id) tournois,
           COUNT(DISTINCT CASE WHEN t.champion_id = j.id THEN t.id END) titres
    FROM joueur j
    LEFT JOIN match m ON m.tournoi_id = j.tournoi_id AND (m.joueur1_id = j.id OR m.joueur2_id = j.id) AND m.etat IN ('termine', 'forfait')
    LEFT JOIN tournoi t ON t.id = j.tournoi_id
    GROUP BY LOWER(j.pseudo)
    ORDER BY gagnes DESC, joues DESC
  `).all();
  const evAgg = db.prepare(`
    SELECT e.joueur_id,
           SUM(CASE WHEN e.type IN ('manche','runout') THEN 1 ELSE 0 END) manches,
           SUM(CASE WHEN e.type = 'runout' THEN 1 ELSE 0 END) runouts
    FROM match_event e GROUP BY e.joueur_id
  `).all().reduce((a, r) => (a[r.joueur_id] = r, a), {});
  res.json({ joueurs: rows.map(r => ({
    id: r.id,
    pseudo: r.pseudo,
    manches: evAgg[r.id] ? evAgg[r.id].manches : 0,
    runouts: evAgg[r.id] ? evAgg[r.id].runouts : 0,
    joues: r.joues,
    gagnes: r.gagnes || 0,
    perdus: r.joues - (r.gagnes || 0),
    pct: r.joues ? Math.round(((r.gagnes || 0) / r.joues) * 100) : 0,
    tournois: r.tournois || 0,
    titres: r.titres || 0,
  })) });
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('event: hello\ndata: {}\n\n');
  clients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

function majEtBroadcast() {
  M.rafraichirPrets();
  const t = tournoiActif();
  if (t && t.statut === 'en_cours') {
    const lances = M.autoLancer(t.id);
    if (lances > 0) logAudit('auto_lancement', `tournoi ${t.id}`, null, { lances });
  }
  broadcast('update', etatGlobal(null));
}

app.post('/api/admin/auto', requireAdmin, (req, res) => {
  const on = req.body.on === true || req.body.on === '1' || req.body.on === 1;
  setSetting('auto_on', on ? '1' : '0');
  if (typeof req.body.table_pref === 'string') {
    // ex: "3,4,5,6,7,8,1,2" -> on ne garde que les numéros valides, séparés par des virgules
    const nums = req.body.table_pref.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);
    setSetting('table_pref', [...new Set(nums)].join(','));
  }
  logAudit('auto_toggle', 'tournoi', null, { on });
  if (on) {
    const t = tournoiActif();
    if (t && t.statut === 'en_cours') {
      const lances = M.autoLancer(t.id);
      if (lances > 0) logAudit('auto_lancement', `tournoi ${t.id}`, null, { lances, declencheur: 'activation' });
    }
  }
  majEtBroadcast();
  res.json({ ok: true, auto: on });
});

app.post('/api/admin/tournoi', requireAdmin, (req, res) => {
  const { nom, regle, taille, format, dko_tours, tetes_de_serie, nb_tables, ajustement_auto, seuil_distance, distance_speciale, date_heure, lieu } = req.body;
  const actif = tournoiActif();
  if (actif) return res.status(409).json({ error: `Un tournoi est encore actif (${actif.nom}). Terminez-le ou supprimez-le d'abord.`, actif_id: actif.id });
  if (!['blackball', 'ultimate'].includes(regle)) return res.status(400).json({ error: 'Règle invalide' });
  if (![16, 32, 64, 128].includes(Number(taille))) return res.status(400).json({ error: 'Taille invalide (max)'});
  if (!['simple', 'double'].includes(format)) return res.status(400).json({ error: 'Format invalide' });
  const k = format === 'double' ? Math.min(3, Math.max(1, Number(dko_tours) || 1)) : 0;
  const seuil = ['jamais', 'quarts', 'demis', 'finale'].includes(seuil_distance) ? seuil_distance : 'jamais';
  const distSpe = [3, 5, 7].includes(Number(distance_speciale)) ? Number(distance_speciale) : 3;
  const dateH = (typeof date_heure === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(date_heure)) ? date_heure.replace('T', ' ').slice(0, 16) : bracket.prochainMardi20h();
  const lieuT = (typeof lieu === 'string' && lieu.trim()) ? lieu.trim().slice(0, 200) : 'Le 147, 12 Rue des Amidonniers 31000 Toulouse';
  const info = db.prepare(`
    INSERT INTO tournoi (nom, regle, taille, format, dko_tours, tetes_de_serie, nb_tables, ajustement_auto, seuil_distance, distance_speciale, date_heure, lieu, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inscription')
  `).run(nom || 'Tournoi', regle, Number(taille), format, k, tetes_de_serie ? 1 : 0, Math.max(1, Number(nb_tables) || 8), ajustement_auto === false ? 0 : 1, seuil, distSpe, dateH, lieuT);
  const t = db.prepare('SELECT * FROM tournoi WHERE id = ?').get(Number(info.lastInsertRowid));
  for (let i = 1; i <= t.nb_tables; i++) {
    db.prepare('INSERT INTO table_billard (tournoi_id, numero) VALUES (?, ?)').run(t.id, i);
  }
  const rounds = bracket.listeRounds(t.taille, t.format, t.dko_tours);
  const def = bracket.manchesDefaut(rounds, t.seuil_distance, t.distance_speciale);
  const ins = db.prepare('INSERT INTO distance_round (tournoi_id, round, manches) VALUES (?, ?, ?)');
  for (const r of rounds) ins.run(t.id, r.key, def[r.key]);
  logAudit('creation_tournoi', `tournoi ${t.id}`, null, req.body);
  majEtBroadcast();
  res.json({ ok: true, ...etatGlobal(req) });
});

app.delete('/api/admin/tournoi', requireAdmin, (req, res) => {
  const id = (tournoiActif() || {}).id;
  if (!id) return res.status(404).json({ error: 'Aucun tournoi' });
  const t = db.prepare('SELECT * FROM tournoi WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });
  db.prepare('UPDATE tournoi SET champion_id = NULL WHERE id = ?').run(id);
  db.prepare('DELETE FROM match_event WHERE match_id IN (SELECT id FROM match WHERE tournoi_id = ?)').run(id);
  db.prepare('DELETE FROM match WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM joueur WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM table_billard WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM distance_round WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM tournoi WHERE id = ?').run(id);
  logAudit('suppression_tournoi', `tournoi ${id}`, { nom: t.nom, statut: t.statut }, null);
  majEtBroadcast();
  res.json({ ok: true });
});

app.delete('/api/admin/tournoi/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM tournoi WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });
  db.prepare('UPDATE tournoi SET champion_id = NULL WHERE id = ?').run(id);
  db.prepare('DELETE FROM match_event WHERE match_id IN (SELECT id FROM match WHERE tournoi_id = ?)').run(id);
  db.prepare('DELETE FROM match WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM joueur WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM table_billard WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM distance_round WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM tournoi WHERE id = ?').run(id);
  logAudit('suppression_tournoi', `tournoi ${id}`, { nom: t.nom, statut: t.statut }, null);
  majEtBroadcast();
  res.json({ ok: true });
});

app.put('/api/admin/tournoi', requireAdmin, (req, res) => {
  const t = tournoiActif();
  if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
  const enCours = t.statut === 'en_cours';
  if (t.statut !== 'inscription' && !enCours) return res.status(409).json({ error: 'Tournoi terminé, config verrouillée' });
  const { nom, tetes_de_serie, nb_tables, ajustement_auto, date_heure, lieu } = req.body;
  const setDate = (typeof date_heure === 'string' && date_heure.trim()) ? date_heure.trim().slice(0, 16) : t.date_heure;
  const setLieu = (typeof lieu === 'string') ? (lieu.trim() ? lieu.trim().slice(0, 200) : t.lieu) : t.lieu;
  // En cours : nom/têtes/ajustement verrouillés, mais nb_tables modifiable (ajout ou retrait de tables LIBRES)
  const nbCible = Math.max(1, Math.min(20, Number(nb_tables) || t.nb_tables));
  if (enCours && nbCible !== t.nb_tables) {
    const rows = db.prepare('SELECT id, numero FROM table_billard WHERE tournoi_id = ? ORDER BY numero').all(t.id);
    const occupees = new Set(db.prepare(`SELECT table_id FROM match WHERE tournoi_id = ? AND etat = 'en_cours' AND table_id IS NOT NULL`).all(t.id).map(r => r.table_id));
    let nbActuel = rows.length;
    if (nbCible < nbActuel) {
      // garder en priorité les tables OCCUPÉES (les matchs en cours y restent), retirer les libres de numéro décroissant
      const aRetirer = rows.filter(tb => !occupees.has(tb.id)).sort((a, b) => b.numero - a.numero).slice(0, nbActuel - nbCible);
      if (aRetirer.length < nbActuel - nbCible) {
        return res.status(409).json({ error: `Impossible de descendre à ${nbCible} table(s) : ${nbActuel - aRetirer.length - nbCible + aRetirer.length} table(s) occupée(s) par un match en cours` });
      }
      for (const tb of aRetirer) {
        // les matchs terminés sur cette table perdent juste l'info de table (FK), le match reste
        db.prepare(`UPDATE match SET table_id = NULL WHERE table_id = ? AND etat != 'en_cours'`).run(tb.id);
        db.prepare('DELETE FROM table_billard WHERE id = ?').run(tb.id);
      }
    } else {
      const existants = new Set(rows.map(r => r.numero));
      for (let i = 1; i <= nbCible; i++) {
        if (!existants.has(i)) db.prepare('INSERT INTO table_billard (tournoi_id, numero) VALUES (?, ?)').run(t.id, i);
      }
    }
  }
  db.prepare('UPDATE tournoi SET nom = ?, tetes_de_serie = ?, nb_tables = ?, ajustement_auto = ?, date_heure = ?, lieu = ? WHERE id = ?')
    .run(enCours ? t.nom : (nom || t.nom), enCours ? t.tetes_de_serie : (tetes_de_serie ? 1 : 0), nbCible, enCours ? t.ajustement_auto : (ajustement_auto === false ? 0 : 1), setDate, setLieu, t.id);
  const t2 = db.prepare('SELECT * FROM tournoi WHERE id = ?').get(t.id);
  const existantes2 = db.prepare('SELECT numero FROM table_billard WHERE tournoi_id = ?').all(t.id).map(r => r.numero);
  // ne recréer des tables que si on a AUGMENTÉ (en phase inscriptions ou ajout en cours) — jamais après une réduction
  if (t2.nb_tables > existantes2.length) {
    for (let i = 1; i <= t2.nb_tables; i++) {
      if (!existantes2.includes(i)) db.prepare('INSERT INTO table_billard (tournoi_id, numero) VALUES (?, ?)').run(t.id, i);
    }
  }
  logAudit('maj_tournoi', `tournoi ${t.id}`, null, req.body);
  majEtBroadcast();
  res.json({ ok: true, ...etatGlobal(req) });
});

app.put('/api/admin/distances', requireAdmin, (req, res) => {
  const t = tournoiActif();
  if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
  const { distances } = req.body;
  if (!distances || typeof distances !== 'object') return res.status(400).json({ error: 'distances requis' });
  const ins = db.prepare(`INSERT INTO distance_round (tournoi_id, round, manches) VALUES (?, ?, ?)
    ON CONFLICT(tournoi_id, round) DO UPDATE SET manches = excluded.manches`);
  for (const [round, manches] of Object.entries(distances)) {
    if (![2, 3, 5, 7].includes(Number(manches))) return res.status(400).json({ error: `Distance invalide pour ${round}` });
    ins.run(t.id, round, Number(manches));
  }
  if (t.statut === 'en_cours') {
    const upd = db.prepare(`UPDATE match SET manches = ? WHERE tournoi_id = ? AND etat NOT IN ('termine', 'forfait') AND LOWER(bracket) || tour = ?`);
    for (const [round, manches] of Object.entries(distances)) upd.run(Number(manches), t.id, round);
  }
  logAudit('maj_distances', `tournoi ${t.id}`, { statut: t.statut }, distances);
  majEtBroadcast();
  res.json({ ok: true });
});

app.post('/api/admin/joueur', requireAdmin, (req, res) => {
  const t = tournoiActif();
  if (!t) return res.status(404).json({ error: 'Aucun tournoi ouvert aux inscriptions (le précédent doit être terminé et le prochain créé)' });
  if (t.statut !== 'inscription') return res.status(409).json({ error: 'Inscriptions closes : le tournoi en cours n\'est pas terminé' });
  const pseudo = String(req.body.pseudo || '').trim().slice(0, 40);
  if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' });
  const count = db.prepare('SELECT COUNT(*) c FROM joueur WHERE tournoi_id = ?').get(t.id).c;
  if (count >= t.taille) return res.status(409).json({ error: `Tableau complet (${t.taille} joueurs max)` });
  let tds = null;
  if (t.tetes_de_serie && req.body.tete_de_serie != null && req.body.tete_de_serie !== '') {
    tds = Number(req.body.tete_de_serie);
  }
  try {
    const info = db.prepare('INSERT INTO joueur (tournoi_id, pseudo, tete_de_serie) VALUES (?, ?, ?)').run(t.id, pseudo, tds);
    logAudit('inscription', `joueur ${info.lastInsertRowid}`, null, { pseudo, tds });
    majEtBroadcast();
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Pseudo déjà pris' });
    throw e;
  }
});

app.post('/api/admin/joueurs/simulation', requireAdmin, (req, res) => {
  const t = tournoiActif();
  if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
  if (t.statut !== 'inscription') return res.status(409).json({ error: 'Inscriptions closes' });
  const count = Math.max(1, Math.min(128, Number(req.body.count) || 8));
  const prefix = String(req.body.prefix || 'Simu').replace(/[^\w\-]/g, '').slice(0, 20) || 'Simu';
  const deja = db.prepare('SELECT COUNT(*) c FROM joueur WHERE tournoi_id = ?').get(t.id).c;
  const places = t.taille - deja;
  if (places <= 0) return res.status(409).json({ error: 'Tableau déjà plein' });
  const n = Math.min(count, places);
  const ins = db.prepare('INSERT INTO joueur (tournoi_id, pseudo, statut) VALUES (?, ?, ?)');
  const crees = [];
  let k = 1;
  const existe = db.prepare('SELECT 1 FROM joueur WHERE tournoi_id = ? AND pseudo = ?');
  while (crees.length < n) {
    const pseudo = `${prefix}${String(k).padStart(2, '0')}`;
    if (!existe.get(t.id, pseudo)) {
      const info = ins.run(t.id, pseudo, 'paye');
      crees.push({ id: Number(info.lastInsertRowid), pseudo });
    }
    k++;
    if (k > 999) break;
  }
  logAudit('simulation_joueurs', `tournoi ${t.id}`, null, { prefix, demandes: count, crees: crees.length, statut: 'paye' });
  majEtBroadcast();
  res.json({ ok: true, crees: crees.length, joueurs: crees });
});

app.post('/api/joueur', (req, res) => {
  const t = tournoiActif();
  if (!t) return res.status(404).json({ error: 'Aucun tournoi ouvert aux inscriptions — attendez que le tournoi en cours soit terminé et que le prochain soit créé' });
  if (t.statut !== 'inscription') return res.status(409).json({ error: 'Inscriptions closes : le tournoi en cours n\'est pas terminé' });
  const pseudo = String(req.body.pseudo || '').trim().slice(0, 40);
  if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' });
  const count = db.prepare('SELECT COUNT(*) c FROM joueur WHERE tournoi_id = ?').get(t.id).c;
  if (count >= t.taille) return res.status(409).json({ error: `Tableau complet (${t.taille} joueurs max)` });
  try {
    const info = db.prepare('INSERT INTO joueur (tournoi_id, pseudo) VALUES (?, ?)').run(t.id, pseudo);
    logAudit('inscription_publique', `joueur ${info.lastInsertRowid}`, null, { pseudo });
    majEtBroadcast();
    res.json({ ok: true, id: Number(info.lastInsertRowid), pseudo });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Pseudo déjà pris' });
    throw e;
  }
});

app.delete('/api/admin/joueur/:id', requireAdmin, (req, res) => {
  const t = tournoiActif();
  if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
  if (t.statut !== 'inscription') return res.status(409).json({ error: 'Tournoi lancé' });
  const j = M.joueurById(Number(req.params.id));
  if (!j || j.tournoi_id !== t.id) return res.status(404).json({ error: 'Joueur introuvable' });
  db.prepare('DELETE FROM joueur WHERE id = ?').run(j.id);
  logAudit('desinscription', `joueur ${j.id}`, { pseudo: j.pseudo }, null);
  majEtBroadcast();
  res.json({ ok: true });
});

app.post('/api/admin/joueur/:id/paiement', requireAdmin, (req, res) => {
  const t = tournoiActif();
  if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
  if (t.statut !== 'inscription') return res.status(409).json({ error: 'Tournoi lancé' });
  const j = M.joueurById(Number(req.params.id));
  if (!j || j.tournoi_id !== t.id) return res.status(404).json({ error: 'Joueur introuvable' });
  const nouveau = req.body.statut === 'paye' ? 'paye' : 'en_attente';
  db.prepare('UPDATE joueur SET statut = ? WHERE id = ?').run(nouveau, j.id);
  logAudit('paiement', `joueur ${j.id}`, { statut: j.statut }, { statut: nouveau, pseudo: j.pseudo });
  majEtBroadcast();
  res.json({ ok: true });
});

app.post('/api/admin/tirage', requireAdmin, (req, res) => {
  const t = tournoiActif();
  if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
  if (t.statut !== 'inscription') return res.status(409).json({ error: 'Tirage déjà effectué' });
  const joueurs = db.prepare(`SELECT * FROM joueur WHERE tournoi_id = ? AND statut = 'paye' ORDER BY id`).all(t.id);
  if (joueurs.length < 2) return res.status(400).json({ error: `Au moins 2 joueurs payés requis (actuellement ${joueurs.length})` });
  if (t.ajustement_auto) {
    const tailleEff = bracket.tailleAuto(joueurs.length, t.taille);
    if (tailleEff !== t.taille) {
      db.prepare('UPDATE tournoi SET taille = ? WHERE id = ?').run(tailleEff, t.id);
      db.prepare('DELETE FROM distance_round WHERE tournoi_id = ?').run(t.id);
      const rounds = bracket.listeRounds(tailleEff, t.format, t.dko_tours);
      const def = bracket.manchesDefaut(rounds, t.seuil_distance, t.distance_speciale);
      const ins = db.prepare('INSERT INTO distance_round (tournoi_id, round, manches) VALUES (?, ?, ?)');
      for (const rr of rounds) ins.run(t.id, rr.key, def[rr.key]);
      logAudit('ajustement_taille', `tournoi ${t.id}`, { taille_max: t.taille }, { taille_effective: tailleEff, nb_payes: joueurs.length });
      Object.assign(t, { taille: tailleEff });
    }
  }
  const manchesMap = distancesMap(t.id);
  // Tirage VRAIMENT aléatoire (crypto), pas Math.random prévisible
  const rngCrypto = () => crypto.randomInt(0, 2 ** 31) / 2 ** 31;
  bracket.genererBracket(t, joueurs, manchesMap, rngCrypto);
  db.prepare(`UPDATE tournoi SET statut = 'en_cours' WHERE id = ?`).run(t.id);
  logAudit('tirage', `tournoi ${t.id}`, { nb_joueurs: joueurs.length }, null);
  majEtBroadcast();
  res.json({ ok: true, ...etatGlobal(req) });
});

app.post('/api/admin/match/:id/lancer', requireAdmin, (req, res) => {
  const tableId = req.body.table_id != null ? Number(req.body.table_id) : null;
  const m = M.lancerMatch(Number(req.params.id), tableId);
  logAudit('lancement_match', `match ${m.id}`, null, { table: m.table_id ? M.tableNumero(m.table_id) : null });
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.post('/api/admin/match/:id/correction', requireAdmin, (req, res) => {
  const { score1, score2, manches, motif } = req.body;
  const m = M.corrigerScore(Number(req.params.id), Number(score1) || 0, Number(score2) || 0, Number(manches) || 3, motif || '');
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.post('/api/admin/match/:id/rouvrir', requireAdmin, (req, res) => {
  const m = M.rouvrirMatch(Number(req.params.id));
  logAudit('rouvrir_match', `match ${m.id}`, null, { etat: 'en_cours' });
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.post('/api/admin/match/:id/forfait', requireAdmin, (req, res) => {
  const m = M.declarerForfait(Number(req.params.id), Number(req.body.joueur_id));
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.post('/api/admin/terminer', requireAdmin, (req, res) => {
  const t = tournoiActif();
  if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
  if (t.statut === 'termine') return res.status(409).json({ error: 'Tournoi déjà terminé' });
  let championId = req.body.champion_id ? Number(req.body.champion_id) : null;
  if (!championId) {
    const dernierJoue = db.prepare(`
      SELECT gagnant_id FROM match WHERE tournoi_id = ? AND gagnant_id IS NOT NULL
      ORDER BY CASE bracket WHEN 'F' THEN 2 WHEN 'WB' THEN 1 ELSE 0 END DESC, tour DESC LIMIT 1
    `).get(t.id);
    championId = dernierJoue ? dernierJoue.gagnant_id : null;
  }
  db.prepare(`UPDATE tournoi SET statut = 'termine', champion_id = ? WHERE id = ?`).run(championId, t.id);
  db.prepare(`UPDATE match SET etat = 'termine', ended_at = COALESCE(ended_at, datetime('now')), updated_at = datetime('now') WHERE tournoi_id = ? AND etat IN ('prevu', 'pret', 'en_cours')`).run(t.id);
  logAudit('tournoi_termine_manuellement', `tournoi ${t.id}`, { statut: t.statut }, { champion_id: championId });
  majEtBroadcast();
  res.json({ ok: true, ...etatGlobal(req) });
});

app.post('/api/admin/simuler', requireAdmin, (req, res) => {
  const t = tournoiActif();
  if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
  if (t.statut !== 'en_cours') return res.status(409).json({ error: 'Le tournoi doit être en cours (faites le tirage d\'abord)' });
  M.rafraichirPrets();
  let joues = 0;
  let guard = 0;
  while (guard++ < 2000) {
    const cur = db.prepare('SELECT * FROM tournoi WHERE id = ?').get(t.id);
    if (cur.statut === 'termine') break;
    const m = db.prepare(`
      SELECT * FROM match WHERE tournoi_id = ? AND etat IN ('prevu', 'pret')
        AND joueur1_id IS NOT NULL AND joueur2_id IS NOT NULL
      ORDER BY CASE bracket WHEN 'WB' THEN 1 WHEN 'LB' THEN 2 ELSE 3 END, tour, position LIMIT 1
    `).get(t.id);
    if (!m) break;
    M.lancerMatch(m.id, null);
    const gagnant = Math.random() < 0.5 ? m.joueur1_id : m.joueur2_id;
    for (let i = 0; i < m.manches; i++) M.declarerManche(m.id, gagnant);
    joues++;
  }
  const final = db.prepare('SELECT * FROM tournoi WHERE id = ?').get(t.id);
  logAudit('simulation_tournoi', `tournoi ${t.id}`, null, { matchs_joues: joues, statut: final.statut, champion_id: final.champion_id });
  majEtBroadcast();
  res.json({ ok: true, matchs_joues: joues, statut: final.statut, champion: final.champion_id ? M.pseudo(final.champion_id) : null });
});

app.get('/api/admin/audit', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all();
  res.json({ audit: rows });
});

app.post('/api/match/:id/manche', (req, res) => {
  const joueurId = Number(req.body.joueur_id);
  if (!joueurId) return res.status(400).json({ error: 'joueur_id requis (gagnant de la manche)' });
  const m = M.declarerManche(Number(req.params.id), joueurId);
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.post('/api/match/:id/runout', (req, res) => {
  const joueurId = Number(req.body.joueur_id);
  if (!joueurId) return res.status(400).json({ error: 'joueur_id requis' });
  const kind = req.body.kind === 'casse' ? 'casse' : 'reprise';
  const m = M.declarerRunout(Number(req.params.id), joueurId, kind);
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.get('/api/joueur/:id/stats', (req, res) => {
  const id = Number(req.params.id);
  const j = db.prepare('SELECT id, pseudo FROM joueur WHERE id = ?').get(id);
  if (!j) return res.status(404).json({ error: 'Joueur introuvable' });
  const { ids } = idsMemeJoueur(id);
  const ph = ids.map(() => '?').join(',');
  const matchs = db.prepare(`SELECT * FROM match WHERE (joueur1_id IN (${ph}) OR joueur2_id IN (${ph})) AND etat IN ('termine', 'forfait', 'en_cours')`).all(...ids, ...ids);
  const evs = db.prepare(`SELECT e.type, e.detail, e.match_id, m.tournoi_id FROM match_event e JOIN match m ON m.id = e.match_id WHERE e.joueur_id IN (${ph})`).all(...ids);
  const manches = evs.filter(e => e.type === 'manche' || e.type === 'runout').length;
  const runouts = evs.filter(e => e.type === 'runout');
  const casse = runouts.filter(e => { try { return JSON.parse(e.detail || '{}').kind === 'casse'; } catch { return false; } }).length;
  const reprise = runouts.length - casse;
  const gagnes = matchs.filter(m => ids.includes(m.gagnant_id)).length;
  const joues = matchs.length;
  const parTournoi = {};
  const statutsT = {};
  for (const tr of db.prepare('SELECT id, nom, statut, champion_id FROM tournoi').all()) statutsT[tr.id] = tr;
  for (const m of matchs) {
    const t = parTournoi[m.tournoi_id] = parTournoi[m.tournoi_id] || { joues: 0, gagnes: 0, enCours: 0 };
    t.joues++; if (m.gagnant_id === id) t.gagnes++; if (m.etat === 'en_cours') t.enCours++;
  }
  for (const tid of Object.keys(parTournoi)) {
    const tr = statutsT[tid];
    if (tr) { parTournoi[tid].nom = tr.nom; parTournoi[tid].statut = tr.statut; parTournoi[tid].champion = tr.champion_id === id; }
  }
  res.json({ joueur: j, joues, gagnes, perdus: joues - gagnes, manches, runouts: runouts.length, casse, reprise, winrate: joues ? Math.round(100 * gagnes / joues) : 0, parTournoi });
});

app.post('/api/match/:id/retirer', (req, res) => {
  const joueurId = Number(req.body.joueur_id);
  if (!joueurId) return res.status(400).json({ error: 'joueur_id requis (à qui retirer la manche)' });
  const m = M.retirerManche(Number(req.params.id), joueurId);
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.get('/api/joueur/:id/matchs', (req, res) => {
  const id = Number(req.params.id);
  const { ids: idsM } = idsMemeJoueur(id);
  const phM = idsM.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT * FROM match WHERE joueur1_id IN (${phM}) OR joueur2_id IN (${phM})
    ORDER BY tournoi_id DESC, CASE bracket WHEN 'WB' THEN 1 WHEN 'LB' THEN 2 ELSE 3 END, tour, position
  `).all(...idsM, ...idsM);
  res.json({ matchs: rows.map(vueMatch) });
});

app.get('/api/joueur/:id/historique', (req, res) => {
  const id = Number(req.params.id);
  const j = db.prepare('SELECT id, pseudo FROM joueur WHERE id = ?').get(id);
  if (!j) return res.status(404).json({ error: 'Joueur introuvable' });
  const { ids: idsH } = idsMemeJoueur(id);
  const phH = idsH.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT m.*, t.nom AS tournoi_nom, t.date_heure AS tournoi_date, t.statut AS tournoi_statut,
           j1.pseudo AS j1_pseudo, j2.pseudo AS j2_pseudo,
           gw.pseudo AS gagnant_pseudo
    FROM match m
    JOIN tournoi t ON t.id = m.tournoi_id
    LEFT JOIN joueur j1 ON j1.id = m.joueur1_id
    LEFT JOIN joueur j2 ON j2.id = m.joueur2_id
    LEFT JOIN joueur gw ON gw.id = m.gagnant_id
    WHERE (m.joueur1_id IN (${phH}) OR m.joueur2_id IN (${phH})) AND m.etat IN ('termine', 'forfait')
    ORDER BY m.ended_at DESC, m.id DESC
  `).all(...idsH, ...idsH);
  res.json({
    joueur: j,
    historique: rows.map(m => ({
      id: m.id,
      code: `${m.bracket.toLowerCase()}${m.tour}-${String(m.position).padStart(3, '0')}`,
      tournoi: m.tournoi_nom,
      tournoi_date: m.tournoi_date,
      tournoi_statut: m.tournoi_statut,
      date: m.ended_at || m.started_at,
      adversaire: idsH.includes(m.joueur1_id) ? m.j2_pseudo : m.j1_pseudo,
      adversaire_id: idsH.includes(m.joueur1_id) ? m.joueur2_id : m.joueur1_id,
      moi: idsH.includes(m.joueur1_id) ? m.score1 : m.score2,
      lui: idsH.includes(m.joueur1_id) ? m.score2 : m.score1,
      victoire: idsH.includes(m.gagnant_id),
      forfait: m.etat === 'forfait',
      gagnant: m.gagnant_pseudo,
      manches: m.manches,
    })),
  });
});

comptes.registerCompteRoutes(app, { baseUrl: BASE_URL, tournoiActif, majEtBroadcast, vueMatch });

app.get('/api/qrcode.svg', async (req, res) => {
  const text = String(req.query.text || BASE_URL).slice(0, 500);
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#0b0b10', light: '#ffffff' } });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  } catch (e) { res.status(500).json({ error: 'QR invalide' }); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'Erreur serveur' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`EBPC Tournoi Billard démarré sur le port ${PORT}`);
    // JAMAIS de log du PIN en clair (fuite dans les logs Fly/Render)
    console.log(process.env.ADMIN_PIN ? 'PIN admin: défini via ADMIN_PIN (secret)' : 'PIN admin: non défini, valeur par défaut active -> définis ADMIN_PIN !');
  });
}

module.exports = { app, broadcast };

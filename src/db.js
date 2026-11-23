const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'tournoi.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL'); // durabilité max: aucune perte même en cas de crash OS (coût négligeable ici)
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- multi-club: un club = un client (son PIN, son thème, ses tournois). Le 1er club (slug par défaut) reprend tout l'existant.
CREATE TABLE IF NOT EXISTS club (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nom TEXT NOT NULL,
  pin_hash TEXT,
  theme_json TEXT,
  actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- multi-club: rattachement d'un compte à un club avec un rôle
-- role 'admin' : gestion complète du club par session (confirmations destructives levées)
-- role 'operateur' : ouvre les routes admin du club par session, MAIS confirmations (PIN) et gestion des rôles refusées
CREATE TABLE IF NOT EXISTS compte_club (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compte_id INTEGER NOT NULL REFERENCES compte(id) ON DELETE CASCADE,
  club_id INTEGER NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'operateur')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (compte_id, club_id)
);
CREATE INDEX IF NOT EXISTS idx_compte_club_club ON compte_club(club_id);

CREATE TABLE IF NOT EXISTS tournoi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER REFERENCES club(id),
  nom TEXT NOT NULL,
  regle TEXT NOT NULL CHECK (regle IN ('blackball', 'ultimate')),
  taille INTEGER NOT NULL CHECK (taille IN (4, 8, 16, 32, 64, 128)),
  format TEXT NOT NULL CHECK (format IN ('simple', 'double')),
  dko_tours INTEGER NOT NULL DEFAULT 0 CHECK (dko_tours BETWEEN 0 AND 3),
  tetes_de_serie INTEGER NOT NULL DEFAULT 0,
  nb_tables INTEGER NOT NULL DEFAULT 4,
  ajustement_auto INTEGER NOT NULL DEFAULT 1,
  seuil_distance TEXT NOT NULL DEFAULT 'jamais' CHECK (seuil_distance IN ('jamais', 'quarts', 'demis', 'finale')),
  distance_speciale INTEGER NOT NULL DEFAULT 3 CHECK (distance_speciale IN (2, 3, 5, 7)),
  date_heure TEXT,
  lieu TEXT,
  statut TEXT NOT NULL DEFAULT 'inscription' CHECK (statut IN ('inscription', 'en_cours', 'termine')),
  champion_id INTEGER REFERENCES joueur(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS distance_round (
  tournoi_id INTEGER NOT NULL REFERENCES tournoi(id),
  round TEXT NOT NULL,
  manches INTEGER NOT NULL CHECK (manches IN (2, 3, 5, 7)),
  PRIMARY KEY (tournoi_id, round)
);

CREATE TABLE IF NOT EXISTS joueur (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournoi_id INTEGER NOT NULL REFERENCES tournoi(id),
  pseudo TEXT NOT NULL,
  tete_de_serie INTEGER,
  statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'paye')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tournoi_id, pseudo)
);

-- multi-club (17u): le compte est un compte PLATEFORME (un compte pour tous les clubs) :
-- pseudo et email uniques sur TOUTE la plateforme ; club_id = club d ORIGINE (figé à la création, portée des listes de marque, de l audit et des amis).
CREATE TABLE IF NOT EXISTS compte (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL REFERENCES club(id),
  pseudo TEXT NOT NULL COLLATE NOCASE,
  email TEXT NOT NULL COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  reset_token_hash TEXT,
  reset_expires TEXT,
  last_login_at TEXT,
  notif_amis_inscription INTEGER NOT NULL DEFAULT 1, -- pref "notification inscription amis" (désactivable depuis la page Compte)
  notif_amis_match INTEGER NOT NULL DEFAULT 1, -- pref "notification match d'un ami" (désactivable depuis la page Compte)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ami (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compte_id INTEGER NOT NULL REFERENCES compte(id) ON DELETE CASCADE,
  ami_compte_id INTEGER NOT NULL REFERENCES compte(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(compte_id, ami_compte_id)
);

-- suivi d'un pseudo SANS compte (ami "anonyme"): notifs et statut live par pseudo
CREATE TABLE IF NOT EXISTS ami_pseudo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compte_id INTEGER NOT NULL REFERENCES compte(id) ON DELETE CASCADE,
  pseudo TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(compte_id, pseudo)
);

CREATE TABLE IF NOT EXISTS session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  compte_id INTEGER NOT NULL REFERENCES compte(id),
  expires TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_session_compte ON session(compte_id);

CREATE TABLE IF NOT EXISTS push_subscription (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compte_id INTEGER NOT NULL REFERENCES compte(id),
  club_id INTEGER REFERENCES club(id),
  endpoint TEXT NOT NULL UNIQUE,
  keys_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS table_billard (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournoi_id INTEGER NOT NULL REFERENCES tournoi(id),
  numero INTEGER NOT NULL,
  UNIQUE (tournoi_id, numero)
);

CREATE TABLE IF NOT EXISTS match (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournoi_id INTEGER NOT NULL REFERENCES tournoi(id),
  bracket TEXT NOT NULL CHECK (bracket IN ('WB', 'LB', 'F')),
  tour INTEGER NOT NULL,
  position INTEGER NOT NULL,
  joueur1_id INTEGER REFERENCES joueur(id),
  joueur2_id INTEGER REFERENCES joueur(id),
  score1 INTEGER NOT NULL DEFAULT 0,
  score2 INTEGER NOT NULL DEFAULT 0,
  manches INTEGER NOT NULL DEFAULT 3,
  gagnant_id INTEGER REFERENCES joueur(id),
  etat TEXT NOT NULL DEFAULT 'prevu' CHECK (etat IN ('prevu', 'pret', 'en_cours', 'termine', 'forfait')),
  table_id INTEGER REFERENCES table_billard(id),
  suivant_id INTEGER REFERENCES match(id),
  suivant_slot INTEGER,
  perdant_id INTEGER REFERENCES match(id),
  perdant_slot INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tournoi_id, bracket, tour, position)
);

CREATE INDEX IF NOT EXISTS idx_match_suivant ON match (suivant_id);
CREATE INDEX IF NOT EXISTS idx_match_perdant ON match (perdant_id);

CREATE TABLE IF NOT EXISTS match_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES match(id),
  joueur_id INTEGER REFERENCES joueur(id),
  type TEXT NOT NULL CHECK (type IN ('manche', 'runout', 'correction', 'forfait', 'lancement', 'bye', 'tirage', 'bande')),
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER REFERENCES club(id),
  action TEXT NOT NULL,
  cible TEXT,
  avant TEXT,
  apres TEXT,
  auteur TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- snapshots du tournoi actif, un par événement d'audit (rollback point-in-time)
CREATE TABLE IF NOT EXISTS audit_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL REFERENCES audit_log(id) ON DELETE CASCADE,
  tournoi_id INTEGER NOT NULL,
  club_id INTEGER REFERENCES club(id),
  taken_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_snapshot_audit ON audit_snapshot(audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_snapshot_tournoi ON audit_snapshot(tournoi_id);

-- 31. KPI d usage par tournoi : mesure SERVEUR agrégée, sans cookie ni tracker.
-- usage_page = un relevé par chargement de page (beacon POST /api/usage, club + tournoi actif
-- repérés côté serveur, compte seulement si une session existe déjà, NULL sinon = anonyme).
-- usage_api = santé des API (route normalisée, code réponse, latence ms ; échantillon 1 sur 10
-- des réponses normales + TOUTES les erreurs, jamais le flux SSE).
-- AUCUNE clé étrangère volontairement : un tournoi supprimé ou un club supprimé ne peut JAMAIS
-- être bloqué par ses relevés d usage ; la purge 90 jours (comme audit_log) nettoie tout.
CREATE TABLE IF NOT EXISTS usage_page (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL,
  tournoi_id INTEGER,
  page TEXT NOT NULL,
  compte_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_page_tournoi ON usage_page(tournoi_id);
CREATE INDEX IF NOT EXISTS idx_usage_page_club ON usage_page(club_id);

CREATE TABLE IF NOT EXISTS usage_api (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER,
  tournoi_id INTEGER,
  route TEXT NOT NULL,
  code INTEGER NOT NULL,
  ms INTEGER,
  echantillon INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_api_tournoi ON usage_api(tournoi_id);
CREATE INDEX IF NOT EXISTS idx_usage_api_club ON usage_api(club_id);
`);

// migration : colonne auteur du journal d'audit (pseudo du compte admin à l'origine de l'action ;
// null pour les actions au code PIN ou automatiques). Inoffensive si la colonne existe déjà.
try {
  const auditCols = db.prepare('PRAGMA table_info(audit_log)').all().map(c => c.name);
  if (auditCols.length > 0 && !auditCols.includes('auteur')) db.exec('ALTER TABLE audit_log ADD COLUMN auteur TEXT');
} catch (e) { console.error('migration audit_log.auteur:', e.message); }

// purge auto du journal d'audit > 90 jours (après création du schéma) + snapshots idem
try {
  db.prepare("DELETE FROM audit_log WHERE created_at < datetime('now', '-90 days')").run();
  db.prepare("DELETE FROM audit_snapshot WHERE taken_at < datetime('now', '-90 days')").run();
} catch (e) { console.error('purge audit:', e.message); }

// 31. purge des relevés d usage (pages vues + santé API) > 90 jours, même fenêtre que le journal d audit
try {
  db.prepare("DELETE FROM usage_page WHERE created_at < datetime('now', '-90 days')").run();
  db.prepare("DELETE FROM usage_api WHERE created_at < datetime('now', '-90 days')").run();
} catch (e) { console.error('purge usage:', e.message); }

const joueurCols = db.prepare('PRAGMA table_info(joueur)').all().map(c => c.name);
if (!joueurCols.includes('statut')) {
  db.exec("ALTER TABLE joueur ADD COLUMN statut TEXT NOT NULL DEFAULT 'en_attente'");
}
const tournoiCols = db.prepare('PRAGMA table_info(tournoi)').all().map(c => c.name);
const tournoiPkCheck = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tournoi'`).get();
const idFixe = tournoiPkCheck && /CHECK\s*\(\s*id\s*=\s*1\s*\)/i.test(tournoiPkCheck.sql || '');
const manquantes = ['tetes_de_serie', 'nb_tables', 'ajustement_auto', 'seuil_distance', 'distance_speciale', 'champion_id', 'date_heure', 'lieu']
  .filter(c => !tournoiCols.includes(c));
if (tournoiCols.length > 0 && (manquantes.length > 0 || idFixe)) {
  db.pragma('foreign_keys = OFF');
  db.exec('BEGIN');
  db.exec([
    "CREATE TABLE tournoi_mig (",
    "  id INTEGER PRIMARY KEY AUTOINCREMENT",
    "  nom TEXT NOT NULL,",
    "  regle TEXT NOT NULL CHECK (regle IN ('blackball', 'ultimate')),",
    "  taille INTEGER NOT NULL CHECK (taille IN (4, 8, 16, 32, 64, 128)),",
    "  format TEXT NOT NULL CHECK (format IN ('simple', 'double')),",
    "  dko_tours INTEGER NOT NULL DEFAULT 0 CHECK (dko_tours BETWEEN 0 AND 3),",
    "  tetes_de_serie INTEGER NOT NULL DEFAULT 0,",
    "  nb_tables INTEGER NOT NULL DEFAULT 4,",
    "  ajustement_auto INTEGER NOT NULL DEFAULT 1,",
    "  seuil_distance TEXT NOT NULL DEFAULT 'jamais' CHECK (seuil_distance IN ('jamais', 'quarts', 'demis', 'finale')),",
    "  distance_speciale INTEGER NOT NULL DEFAULT 3 CHECK (distance_speciale IN (2, 3, 5, 7)),",
    "  date_heure TEXT,",
    "  lieu TEXT,",
    "  statut TEXT NOT NULL DEFAULT 'inscription' CHECK (statut IN ('inscription', 'en_cours', 'termine')),",
    "  champion_id INTEGER,",
    "  created_at TEXT NOT NULL DEFAULT (datetime('now'))",
    ");"
  ].join('\n'));
  const aColonne = (n) => tournoiCols.includes(n);
  const selectCols = ['id', 'nom', 'regle', 'taille', 'format', 'dko_tours',
    aColonne('tetes_de_serie') ? 'tetes_de_serie' : '0',
    aColonne('nb_tables') ? 'nb_tables' : '4',
    aColonne('ajustement_auto') ? 'ajustement_auto' : '1',
    aColonne('seuil_distance') ? 'seuil_distance' : "'jamais'",
    aColonne('distance_speciale') ? 'distance_speciale' : '3',
      aColonne('date_heure') ? 'date_heure' : 'NULL',
      aColonne('lieu') ? 'lieu' : 'NULL',
    'statut',
    aColonne('champion_id') ? 'champion_id' : 'NULL',
    'created_at'].join(', ');
  db.exec('INSERT INTO tournoi_mig SELECT ' + selectCols + ' FROM tournoi');
  db.exec('DROP TABLE tournoi');
  db.exec('ALTER TABLE tournoi_mig RENAME TO tournoi');
  db.exec('COMMIT');
  db.pragma('foreign_keys = ON');
}

const matchCols = db.prepare('PRAGMA table_info(match)').all().map(c => c.name);
if (matchCols.length > 0) {
  if (!matchCols.includes('started_at')) db.exec('ALTER TABLE match ADD COLUMN started_at TEXT');
  if (!matchCols.includes('ended_at')) db.exec('ALTER TABLE match ADD COLUMN ended_at TEXT');
  const joueurCols = db.prepare("PRAGMA table_info(joueur)").all().map(c => c.name);
  if (!joueurCols.includes('compte_id')) db.exec('ALTER TABLE joueur ADD COLUMN compte_id INTEGER REFERENCES compte(id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_joueur_tournoi_pseudo_nocase ON joueur(tournoi_id, pseudo COLLATE NOCASE)');
  // migration match_event: ajouter 'bande' à la CHECK (SQLite -> recréer la table)
  const evSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='match_event'").get();
  if (evSql && !evSql.sql.includes("'bande'")) {
    db.exec(`
      CREATE TABLE match_event_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL REFERENCES match(id),
        joueur_id INTEGER REFERENCES joueur(id),
        type TEXT NOT NULL CHECK (type IN ('manche', 'runout', 'correction', 'forfait', 'lancement', 'bye', 'tirage', 'bande')),
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO match_event_new SELECT * FROM match_event;
      DROP TABLE match_event;
      ALTER TABLE match_event_new RENAME TO match_event;
    `);
  }
  // migration: renommer l'ancienne colonne fautive 'casseur_id' si présente
  if (db.prepare("PRAGMA table_info(match)").all().some(c => c.name === 'casseur_id')) {
    try { db.exec('ALTER TABLE match RENAME COLUMN casseur_id TO casseur_id'); } catch (e) { console.error('migration casseur:', e.message); }
  }
  if (!db.prepare("PRAGMA table_info(compte)").all().some(c => c.name === 'last_login_at'))
    db.exec('ALTER TABLE compte ADD COLUMN last_login_at TEXT');
  if (!db.prepare("PRAGMA table_info(compte)").all().some(c => c.name === 'role'))
    db.exec("ALTER TABLE compte ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"); // 'user' | 'admin' — session admin acceptée par requireAdmin (le PIN reste le fallback)
  if (!db.prepare("PRAGMA table_info(compte)").all().some(c => c.name === 'notif_amis_inscription'))
    db.exec('ALTER TABLE compte ADD COLUMN notif_amis_inscription INTEGER NOT NULL DEFAULT 1'); // pref "notification inscription amis"
  if (!db.prepare("PRAGMA table_info(compte)").all().some(c => c.name === 'notif_amis_match'))
    db.exec('ALTER TABLE compte ADD COLUMN notif_amis_match INTEGER NOT NULL DEFAULT 1'); // pref "notification match d'un ami"
  if (!db.prepare("PRAGMA table_info(compte)").all().some(c => c.name === 'lang'))
    db.exec('ALTER TABLE compte ADD COLUMN lang TEXT'); // langue des notifications push (null = fr), persistée par le sélecteur du bandeau
// migration 17f: comptes cloisonnés par club. Les comptes existants sont rattachés au club par défaut.
// Reconstruction de la table (l unicité pseudo/email globale laisse place à l unicité PAR club), FK coupées le temps de l'opération.
try {
  const compteCols17f = db.prepare('PRAGMA table_info(compte)').all().map(c => c.name);
  if (compteCols17f.length > 0 && !compteCols17f.includes('club_id')) {
    const hasLang17f = compteCols17f.includes('lang');
    db.pragma('foreign_keys = OFF');
    db.exec('DROP TABLE IF EXISTS compte_17f');
    db.exec(`
      CREATE TABLE compte_17f (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id INTEGER NOT NULL REFERENCES club(id),
        pseudo TEXT NOT NULL COLLATE NOCASE,
        email TEXT NOT NULL COLLATE NOCASE,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        reset_token_hash TEXT,
        reset_expires TEXT,
        last_login_at TEXT,
        notif_amis_inscription INTEGER NOT NULL DEFAULT 1,
        notif_amis_match INTEGER NOT NULL DEFAULT 1,
        ${hasLang17f ? 'lang TEXT,' : ''}
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (club_id, pseudo),
        UNIQUE (club_id, email)
      )`);
    db.prepare(`INSERT INTO compte_17f (id, club_id, pseudo, email, pass_hash, salt, reset_token_hash, reset_expires, last_login_at, notif_amis_inscription, notif_amis_match${hasLang17f ? ', lang' : ''}, created_at)
                SELECT id, (SELECT MIN(id) FROM club), pseudo, email, pass_hash, salt, reset_token_hash, reset_expires, last_login_at, notif_amis_inscription, notif_amis_match${hasLang17f ? ', lang' : ''}, created_at FROM compte`).run();
    db.exec('DROP TABLE compte');
    db.exec('ALTER TABLE compte_17f RENAME TO compte');
    db.pragma('foreign_keys = ON');
    console.log('[MIGRATION] comptes cloisonnés par club (club_id sur chaque compte, unicité pseudo/email PAR club)');
  }
} catch (e) { console.error('migration compte.club_id:', e.message); }
  if (!db.prepare("PRAGMA table_info(match)").all().some(c => c.name === 'casseur_id'))
    db.exec('ALTER TABLE match ADD COLUMN casseur_id INTEGER REFERENCES joueur(id)');
}

// ---------- multi-club: migrations club_id + club par défaut + backfill ----------
const CLUB_DEFAULT_SLUG = String(process.env.CLUB_DEFAULT_SLUG || 'ebpc').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'ebpc';
const CLUB_DEFAULT_NAME = String(process.env.CLUB_DEFAULT_NAME || 'EBPC — Pink City Billard').slice(0, 80);
function clubParDefaut() {
  let c = db.prepare('SELECT * FROM club ORDER BY id LIMIT 1').get();
  if (!c) {
    const info = db.prepare('INSERT INTO club (slug, nom) VALUES (?, ?)').run(CLUB_DEFAULT_SLUG, CLUB_DEFAULT_NAME);
    c = db.prepare('SELECT * FROM club WHERE id = ?').get(Number(info.lastInsertRowid));
  }
  return c;
}
function clubParSlug(slug) {
  // club inactif = hors résolution publique (X-Club/?club= -> 404) ; réactivation admin par slug direct
  return db.prepare('SELECT * FROM club WHERE slug = ? COLLATE NOCASE AND actif = 1').get(String(slug || '').trim().toLowerCase()) || null;
}
if (!db.prepare("PRAGMA table_info(tournoi)").all().some(c => c.name === 'club_id'))
  db.exec('ALTER TABLE tournoi ADD COLUMN club_id INTEGER REFERENCES club(id)');
if (!db.prepare("PRAGMA table_info(audit_log)").all().some(c => c.name === 'club_id'))
  db.exec('ALTER TABLE audit_log ADD COLUMN club_id INTEGER REFERENCES club(id)');
if (!db.prepare("PRAGMA table_info(audit_snapshot)").all().some(c => c.name === 'club_id'))
  db.exec('ALTER TABLE audit_snapshot ADD COLUMN club_id INTEGER REFERENCES club(id)');
if (!db.prepare("PRAGMA table_info(push_subscription)").all().some(c => c.name === 'club_id'))
  db.exec('ALTER TABLE push_subscription ADD COLUMN club_id INTEGER REFERENCES club(id)');
{
  const defId = clubParDefaut().id;
  db.prepare('UPDATE tournoi SET club_id = ? WHERE club_id IS NULL').run(defId);
  db.prepare('UPDATE audit_log SET club_id = ? WHERE club_id IS NULL').run(defId);
  db.prepare('UPDATE audit_snapshot SET club_id = COALESCE((SELECT t.club_id FROM tournoi t WHERE t.id = audit_snapshot.tournoi_id), ?) WHERE club_id IS NULL').run(defId);
  db.prepare('UPDATE push_subscription SET club_id = ? WHERE club_id IS NULL').run(defId);
}
// rattrapage des comptes créés avant le rattachement étendu aux tournois passés:
// rattache au boot chaque joueur anonyme au compte portant le même pseudo (idempotent)
db.exec(`
  UPDATE joueur SET compte_id = (SELECT c.id FROM compte c WHERE c.pseudo = joueur.pseudo COLLATE NOCASE LIMIT 1)
  WHERE compte_id IS NULL
    AND EXISTS (SELECT 1 FROM compte c WHERE c.pseudo = joueur.pseudo COLLATE NOCASE)
`);

// ---------- 17u. Compte plateforme : fusion des comptes jumeaux + unicité pseudo/email sur TOUTE la plateforme ----------
// Le cloisonnement 17f laissait le même pseudo ou le même email exister dans plusieurs clubs.
// reparerComptes17u (idempotent, appelé au boot et après un import complet de base) :
//   1) fusion des comptes jumeaux (MÊME email) : le plus ancien garde tout (sessions, push, amis des deux côtés, rôles club, joueurs) ;
//   2) renommage des doublons de pseudo restants en « pseudo-slug-du-club » (admin puis connexion la plus récente gagnent le pseudo nu) ;
//   3) deux index uniques plateforme (idx17u_pseudo, idx17u_email) verrouillent l unicité pour tous les clubs.
function reparerComptes17u() {
  const res17u = { fusionnes: 0, renommes: 0 };
  try {
    // 1) fusion des jumeaux par email : le plus petit id gagne, l autre disparaît
    const jumeaux17u = db.prepare('SELECT c1.id garde_id, c2.id perdant_id FROM compte c1 JOIN compte c2 ON c2.email = c1.email COLLATE NOCASE AND c2.id > c1.id ORDER BY c1.id, c2.id').all();
    for (const j of jumeaux17u) {
      if (!db.prepare('SELECT id FROM compte WHERE id = ?').get(j.perdant_id)) continue; // déjà fusionné (jumeaux en chaîne)
      db.prepare('UPDATE OR IGNORE session SET compte_id = ? WHERE compte_id = ?').run(j.garde_id, j.perdant_id);
      db.prepare('UPDATE OR IGNORE push_subscription SET compte_id = ? WHERE compte_id = ?').run(j.garde_id, j.perdant_id);
      db.prepare('INSERT OR IGNORE INTO ami (compte_id, ami_compte_id, created_at) SELECT ?, ami_compte_id, created_at FROM ami WHERE compte_id = ?').run(j.garde_id, j.perdant_id);
      db.prepare('INSERT OR IGNORE INTO ami (compte_id, ami_compte_id, created_at) SELECT compte_id, ?, created_at FROM ami WHERE ami_compte_id = ?').run(j.garde_id, j.perdant_id);
      db.prepare('DELETE FROM ami WHERE compte_id = ? OR ami_compte_id = ? OR compte_id = ami_compte_id').run(j.perdant_id, j.perdant_id);
      db.prepare('UPDATE OR IGNORE ami_pseudo SET compte_id = ? WHERE compte_id = ?').run(j.garde_id, j.perdant_id);
      db.prepare('INSERT OR IGNORE INTO compte_club (compte_id, club_id, role, created_at) SELECT ?, club_id, role, created_at FROM compte_club WHERE compte_id = ?').run(j.garde_id, j.perdant_id);
      db.prepare('DELETE FROM compte_club WHERE compte_id = ?').run(j.perdant_id);
      db.prepare('UPDATE OR IGNORE joueur SET compte_id = ? WHERE compte_id = ?').run(j.garde_id, j.perdant_id);
      db.prepare('DELETE FROM session WHERE compte_id = ?').run(j.perdant_id);
      db.prepare('DELETE FROM push_subscription WHERE compte_id = ?').run(j.perdant_id);
      db.prepare('DELETE FROM compte WHERE id = ?').run(j.perdant_id);
      res17u.fusionnes++;
    }
    // 2) doublons de pseudo restants : le gagnant garde le pseudo nu, les autres prennent pseudo-slug-du-club
    const groupes17u = {};
    for (const c of db.prepare('SELECT id, pseudo, club_id, role, last_login_at FROM compte').all()) {
      const cle17u = String(c.pseudo).toLowerCase();
      if (!groupes17u[cle17u]) groupes17u[cle17u] = [];
      groupes17u[cle17u].push(c);
    }
    for (const cle17u of Object.keys(groupes17u)) {
      if (groupes17u[cle17u].length < 2) continue;
      groupes17u[cle17u].sort((a, b) =>
        ((b.role === 'admin') - (a.role === 'admin')) ||
        String(b.last_login_at || '').localeCompare(String(a.last_login_at || '')) ||
        (a.id - b.id));
      for (const c of groupes17u[cle17u].slice(1)) {
        const slug17u = String((db.prepare('SELECT slug FROM club WHERE id = ?').get(c.club_id) || {}).slug || 'club').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'club';
        let nouveau17u = String(c.pseudo).slice(0, 24) + '-' + slug17u;
        if (db.prepare('SELECT id FROM compte WHERE pseudo = ? COLLATE NOCASE').get(nouveau17u)) {
          let n17u = 2;
          while (db.prepare('SELECT id FROM compte WHERE pseudo = ? COLLATE NOCASE').get(nouveau17u + '-' + n17u)) n17u++;
          nouveau17u = nouveau17u + '-' + n17u;
        }
        db.prepare('UPDATE compte SET pseudo = ? WHERE id = ?').run(nouveau17u, c.id);
        res17u.renommes++;
      }
    }
    // 3) verrou plateforme : unicité pseudo/email sur TOUTE la plateforme
    db.exec('DROP INDEX IF EXISTS idx17u_pseudo');
    db.exec('DROP INDEX IF EXISTS idx17u_email');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx17u_pseudo ON compte(pseudo)');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx17u_email ON compte(email)');
  } catch (e) { console.error('[MIGRATION] compte plateforme (17u):', e.message); }
  return res17u;
}

try {
  const res17u = reparerComptes17u();
  if (res17u.fusionnes || res17u.renommes) console.log('[MIGRATION] compte plateforme (17u): ' + res17u.fusionnes + ' fusion(s) email, ' + res17u.renommes + ' renommage(s) pseudo');
} catch (e) { console.error('boot reparerComptes17u:', e.message); }

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

// snapshot de l'état complet du tournoi actif, indexé sur l'événement d'audit
function snapshotTournoiActif(auditId, clubId) {
  try {
    const t = clubId != null
      ? db.prepare("SELECT * FROM tournoi WHERE club_id = ? AND statut IN ('inscription', 'en_cours') ORDER BY id DESC LIMIT 1").get(clubId)
      : db.prepare("SELECT * FROM tournoi WHERE statut IN ('inscription', 'en_cours') ORDER BY id DESC LIMIT 1").get();
    if (!t) return;
    const payload = JSON.stringify({
      tournoi: t,
      joueurs: db.prepare('SELECT * FROM joueur WHERE tournoi_id = ? ORDER BY id').all(t.id),
      matchs: db.prepare('SELECT * FROM match WHERE tournoi_id = ? ORDER BY id').all(t.id),
      events: db.prepare('SELECT * FROM match_event WHERE match_id IN (SELECT id FROM match WHERE tournoi_id = ?) ORDER BY id').all(t.id),
      distances: db.prepare('SELECT * FROM distance_round WHERE tournoi_id = ? ORDER BY round').all(t.id),
      tables: db.prepare('SELECT * FROM table_billard WHERE tournoi_id = ? ORDER BY numero').all(t.id),
    });
    db.prepare('INSERT INTO audit_snapshot (audit_id, tournoi_id, club_id, payload) VALUES (?, ?, ?, ?)').run(auditId, t.id, t.club_id != null ? t.club_id : clubParDefaut().id, payload);
    // on garde seulement les 200 derniers snapshots du tournoi (évite que la BDD grossisse sans fin)
    db.prepare('DELETE FROM audit_snapshot WHERE tournoi_id = ? AND id NOT IN (SELECT id FROM audit_snapshot WHERE tournoi_id = ? ORDER BY id DESC LIMIT 200)').run(t.id, t.id);
  } catch (e) { console.error('snapshot:', e.message); }
}

function logAudit(action, cible, avant, apres, clubId, auteur) {
  if (clubId == null) clubId = clubParDefaut().id;
  const info = db.prepare('INSERT INTO audit_log (action, cible, avant, apres, club_id, auteur) VALUES (?, ?, ?, ?, ?, ?)')
    .run(action, cible != null ? String(cible) : null,
      avant != null ? JSON.stringify(avant) : null,
      apres != null ? JSON.stringify(apres) : null,
      clubId,
      auteur != null ? String(auteur) : null);
  snapshotTournoiActif(Number(info.lastInsertRowid), clubId);
}

module.exports = { db, setSetting, getSetting, logAudit, clubParDefaut, clubParSlug, reparerComptes17u };

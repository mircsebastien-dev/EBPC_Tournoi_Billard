const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'tournoi.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournoi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

CREATE TABLE IF NOT EXISTS compte (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pseudo TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  reset_token_hash TEXT,
  reset_expires TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  action TEXT NOT NULL,
  cible TEXT,
  avant TEXT,
  apres TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

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
  if (!db.prepare("PRAGMA table_info(match)").all().some(c => c.name === 'casseur_id'))
    db.exec('ALTER TABLE match ADD COLUMN casseur_id INTEGER REFERENCES joueur(id)');
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function logAudit(action, cible, avant, apres) {
  db.prepare('INSERT INTO audit_log (action, cible, avant, apres) VALUES (?, ?, ?, ?)')
    .run(action, cible != null ? String(cible) : null,
      avant != null ? JSON.stringify(avant) : null,
      apres != null ? JSON.stringify(apres) : null);
}

module.exports = { db, setSetting, getSetting, logAudit };

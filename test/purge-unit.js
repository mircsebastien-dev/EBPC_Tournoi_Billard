// Test unitaire de la purge auto au boot: audit_log et audit_snapshot > 90 jours.
// Le purge tourne au require() de src/db.js -> 2 phases dans 2 processus:
//   phase 1: crée le schéma, insère des lignes vieilles/récentes, puis relance phase 2
//   phase 2: require() src/db.js (purge au boot) puis vérifie ce qui a été supprimé
// Usage: node test/purge-unit.js
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const PHASE = process.env.PHASE || '1';
// en phase 2, on reprend le DB_PATH transmis par la phase 1 (sinon pid différent = autre fichier)
const DB_PATH = PHASE === '2' ? process.env.DB_PATH : path.join(os.tmpdir(), `purge-unit-${process.pid}.db`);
process.env.DB_PATH = DB_PATH;

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++; else failed++;
  console.log(`${cond ? '  OK ' : '  FAIL'} ${name}${cond ? '' : ' — ' + String(detail).slice(0, 200)}`);
}

if (PHASE === '2') {
  // ---------- PHASE 2: boot -> purge, puis vérifications ----------
  console.log('=== TEST UNIT PURGE >90j (phase 2: vérifications après boot) ===\n');
  const { db } = require('../src/db');
  const auditOld = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE cible = 'vieille-action'").get().c;
  const auditNew = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE cible = 'action-recente'").get().c;
  check('audit_log > 90j supprimé au boot', auditOld === 0, `restants=${auditOld}`);
  check('audit_log récent conservé', auditNew === 1, `restants=${auditNew}`);
  const snapOldTaken = db.prepare("SELECT COUNT(*) c FROM audit_snapshot WHERE payload = 'old-taken'").get().c;
  const snapOldAudit = db.prepare("SELECT COUNT(*) c FROM audit_snapshot WHERE payload = 'old-audit'").get().c;
  const snapNew = db.prepare("SELECT COUNT(*) c FROM audit_snapshot WHERE payload = 'recent'").get().c;
  check('snapshot taken_at > 90j supprimé (même sur audit récent)', snapOldTaken === 0, `restants=${snapOldTaken}`);
  check('snapshot d\'un audit > 90j supprimé (cascade)', snapOldAudit === 0, `restants=${snapOldAudit}`);
  check('snapshot récent conservé', snapNew === 1, `restants=${snapNew}`);
  db.close();
  console.log(`\n=== ${passed} OK / ${failed} ÉCHEC ===`);
  process.exit(failed ? 1 : 0);
}

// ---------- PHASE 1: préparation puis relance en phase 2 ----------
console.log('=== TEST UNIT PURGE >90j (phase 1: remplissage, puis boot frais en phase 2) ===\n');
const { db } = require('../src/db'); // schéma + purge (rien à purger ici)
const oldAudit = db.prepare("INSERT INTO audit_log (action, cible, created_at) VALUES ('test', 'vieille-action', datetime('now', '-91 days'))").run();
const newAudit = db.prepare("INSERT INTO audit_log (action, cible) VALUES ('test', 'action-recente')").run();
// snapshot vieux (taken_at > 90j) rattaché à l'audit RÉCENT -> seule la règle taken_at peut le supprimer
db.prepare("INSERT INTO audit_snapshot (audit_id, tournoi_id, taken_at, payload) VALUES (?, 1, datetime('now', '-95 days'), 'old-taken')").run(newAudit.lastInsertRowid);
// snapshot récent rattaché à l'audit VIEUX -> supprimé par cascade quand l'audit part
db.prepare("INSERT INTO audit_snapshot (audit_id, tournoi_id, payload) VALUES (?, 1, 'old-audit')").run(oldAudit.lastInsertRowid);
// snapshot récent sur audit récent -> conservé
db.prepare("INSERT INTO audit_snapshot (audit_id, tournoi_id, payload) VALUES (?, 1, 'recent')").run(newAudit.lastInsertRowid);
check('phase 1: 2 audits + 3 snapshots insérés', db.prepare('SELECT COUNT(*) c FROM audit_log').get().c === 2 && db.prepare('SELECT COUNT(*) c FROM audit_snapshot').get().c === 3, '');
db.close();

const r = spawnSync(process.execPath, [__filename], {
  env: { ...process.env, PHASE: '2', DB_PATH },
  stdio: 'inherit',
});
for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_PATH + ext); } catch (e) {} }
process.exit(r.status != null ? r.status : 1);

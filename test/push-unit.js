// Test unitaire du push "inscriptions ouvertes" (envoyerTous) + "inscription d'un ami" avec web-push mocké.
// Usage: node test/push-unit.js  (aucun serveur requis, DB temporaire)
const os = require('os');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(os.tmpdir(), `push-unit-${process.pid}.db`);
process.env.DB_PATH = DB_PATH;

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed++; else failed++;
  console.log(`${cond ? '  OK ' : '  FAIL'} ${name}${cond ? '' : ' — ' + String(detail).slice(0, 200)}`);
}

// --- mock de web-push AVANT de charger src/push ---
// (les exports de web-push sont scellés: on injecte un faux module dans require.cache)
let comportement = 'ok'; // 'ok' | '410' | '404' | '500'
const envois = [];
const webpushPath = require.resolve('web-push');
require.cache[webpushPath] = {
  id: webpushPath, filename: webpushPath, loaded: true, children: [], paths: [],
  exports: {
    setVapidDetails: () => {},
    generateVAPIDKeys: () => ({ publicKey: 'dev-pub', privateKey: 'dev-priv' }),
    sendNotification: async (sub, payload) => {
      if (comportement === 'ok') { envois.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); return {}; }
      const err = new Error('gone'); err.statusCode = Number(comportement); throw err;
    },
  },
};

const { db } = require('../src/db');
const push = require('../src/push');

(async () => {
  console.log('=== TEST UNIT PUSH (envoyerTous + notifierInscriptionAmi, mock web-push) ===\n');

  // 2 comptes abonnés (compte_id est NOT NULL dans le schéma: pas de subscription anonyme possible)
  const c1 = db.prepare("INSERT INTO compte (pseudo, email, pass_hash, salt) VALUES ('Testeur1', 't1@x.fr', 'h', 's')").run();
  const c2 = db.prepare("INSERT INTO compte (pseudo, email, pass_hash, salt) VALUES ('Testeur2', 't2@x.fr', 'h', 's')").run();
  db.prepare("INSERT INTO push_subscription (compte_id, endpoint, keys_json) VALUES (?, 'https://push.example/ep1', '{\"p256dh\":\"k\",\"auth\":\"a\"}')").run(c1.lastInsertRowid);
  db.prepare("INSERT INTO push_subscription (compte_id, endpoint, keys_json) VALUES (?, 'https://push.example/ep2', '{\"p256dh\":\"k\",\"auth\":\"a\"}')").run(c2.lastInsertRowid);

  // --- envoi "inscriptions ouvertes" ---
  const n = await push.envoyerTous({
    title: '🎱 Nouveau tournoi — inscriptions ouvertes',
    body: 'Le tournoi « RB » est créé, les inscriptions sont ouvertes !',
    url: '/tournoi.html',
    tag: 'tournoi-1',
  });
  check('envoyerTous renvoie le nb d\'envois (2 abonnés)', n === 2, `n=${n}`);
  check('2 notifications envoyées avec le bon payload', envois.length === 2 && envois.every(e => e.payload.title.includes('inscriptions ouvertes') && e.payload.url === '/tournoi.html'), JSON.stringify(envois.map(e => e.payload.title)));
  check('payload contient le tag', envois.every(e => e.payload.tag === 'tournoi-1'), '');
  const endpoints = envois.map(e => e.endpoint).sort();
  check('envoyé aux 2 bons endpoints', endpoints.join(',') === 'https://push.example/ep1,https://push.example/ep2', endpoints.join(','));

  // --- endpoint mort (410) -> subscription supprimée ---
  comportement = '410';
  const n2 = await push.envoyerTous({ title: 'x', body: 'y', url: '/', tag: 't' });
  const restants = db.prepare('SELECT endpoint FROM push_subscription ORDER BY endpoint').all().map(r => r.endpoint);
  check('410 -> 0 envoi et subscriptions mortes supprimées', n2 === 0 && restants.length === 0, `n=${n2} restants=${restants}`);

  // --- erreur 500 -> PAS de suppression ---
  db.prepare("INSERT INTO push_subscription (compte_id, endpoint, keys_json) VALUES (?, 'https://push.example/ep3', '{\"p256dh\":\"k\",\"auth\":\"a\"}')").run(c1.lastInsertRowid);
  comportement = '500';
  const n3 = await push.envoyerTous({ title: 'x', body: 'y', url: '/', tag: 't' });
  check('500 -> subscription conservée (pas 404/410)', n3 === 0 && db.prepare("SELECT COUNT(*) c FROM push_subscription WHERE endpoint = 'https://push.example/ep3'").get().c === 1, `n=${n3}`);

  // --- 404 -> suppression aussi ---
  comportement = '404';
  await push.envoyerTous({ title: 'x', body: 'y', url: '/', tag: 't' });
  check('404 -> subscription supprimée', db.prepare("SELECT COUNT(*) c FROM push_subscription WHERE endpoint = 'https://push.example/ep3'").get().c === 0, '');

  // --- aucune subscription -> 0, pas d'erreur ---
  db.prepare('DELETE FROM push_subscription').run();
  comportement = 'ok';
  const n4 = await push.envoyerTous({ title: 'x', body: 'y', url: '/', tag: 't' });
  check('sans aucune subscription -> 0 sans crash', n4 === 0, `n=${n4}`);

  // --- notifierInscriptionAmi: pref "notification inscription amis" + relation ami ---
  console.log('\n--- notifierInscriptionAmi ---');
  const c3 = db.prepare("INSERT INTO compte (pseudo, email, pass_hash, salt) VALUES ('Testeur3', 't3@x.fr', 'h', 's')").run(); // ami de c1, pref active
  const c4 = db.prepare("INSERT INTO compte (pseudo, email, pass_hash, salt) VALUES ('Testeur4', 't4@x.fr', 'h', 's')").run(); // ami de c1, pref désactivée
  const c5 = db.prepare("INSERT INTO compte (pseudo, email, pass_hash, salt) VALUES ('Testeur5', 't5@x.fr', 'h', 's')").run(); // pas ami de c1
  db.prepare('UPDATE compte SET notif_amis_inscription = 0 WHERE id = ?').run(c4.lastInsertRowid);
  db.prepare('INSERT INTO ami (compte_id, ami_compte_id) VALUES (?, ?)').run(c3.lastInsertRowid, c1.lastInsertRowid);
  db.prepare('INSERT INTO ami (compte_id, ami_compte_id) VALUES (?, ?)').run(c4.lastInsertRowid, c1.lastInsertRowid);
  db.prepare('INSERT INTO ami (compte_id, ami_compte_id) VALUES (?, ?)').run(c5.lastInsertRowid, c2.lastInsertRowid); // ami de c2, pas de c1
  db.prepare("INSERT INTO push_subscription (compte_id, endpoint, keys_json) VALUES (?, 'https://push.example/epA', '{\"p256dh\":\"k\",\"auth\":\"a\"}')").run(c3.lastInsertRowid);
  db.prepare("INSERT INTO push_subscription (compte_id, endpoint, keys_json) VALUES (?, 'https://push.example/epB', '{\"p256dh\":\"k\",\"auth\":\"a\"}')").run(c4.lastInsertRowid);
  db.prepare("INSERT INTO push_subscription (compte_id, endpoint, keys_json) VALUES (?, 'https://push.example/epC', '{\"p256dh\":\"k\",\"auth\":\"a\"}')").run(c5.lastInsertRowid);
  envois.length = 0;
  const nAmi = await push.notifierInscriptionAmi(c1.lastInsertRowid, 'Testeur1', 'Tournoi RB');
  check('inscription ami: envoyé seulement à l\'ami avec la pref active', nAmi === 1 && envois.length === 1 && envois[0].endpoint === 'https://push.example/epA', `n=${nAmi} endpoints=${envois.map(e => e.endpoint).join(',')}`);
  check('payload inscription ami correct', envois[0] && envois[0].payload.title.includes('ami') && envois[0].payload.body.includes('Testeur1') && envois[0].payload.body.includes('Tournoi RB') && envois[0].payload.url === '/tournoi.html', JSON.stringify(envois[0] && envois[0].payload));
  // pref réactivée -> les 2 amis de c1 notifiés (c5 toujours exclu: pas ami de c1)
  db.prepare('UPDATE compte SET notif_amis_inscription = 1 WHERE id = ?').run(c4.lastInsertRowid);
  envois.length = 0;
  const nAmi2 = await push.notifierInscriptionAmi(c1.lastInsertRowid, 'Testeur1', 'Tournoi RB');
  check('pref réactivée -> les 2 amis notifiés, le non-ami exclu', nAmi2 === 2 && envois.every(e => e.endpoint !== 'https://push.example/epC'), `n=${nAmi2}`);
  // personne ne m'a en ami -> 0 envoi sans crash
  envois.length = 0;
  const nAmi3 = await push.notifierInscriptionAmi(c5.lastInsertRowid, 'Testeur5', 'Tournoi RB');
  check('aucun ami -> 0 envoi sans crash', nAmi3 === 0 && envois.length === 0, `n=${nAmi3}`);

  db.close();
  for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_PATH + ext); } catch (e) {} }
  console.log(`\n=== ${passed} OK / ${failed} ÉCHEC ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(2); });

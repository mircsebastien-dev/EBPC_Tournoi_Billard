// Test unitaire du push "inscriptions ouvertes" (envoyerTous) + "inscription d'un ami" + "match d'un ami" (prefs) avec web-push mocké.
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
  console.log('=== TEST UNIT PUSH (envoyerTous + notifierInscriptionAmi + notifierMatchLance, mock web-push) ===\n');

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

  // --- notifierMatchLance: joueurs + amis, pref "notification match d'un ami" ---
  console.log('\n--- notifierMatchLance ---');
  const tr = db.prepare("INSERT INTO tournoi (nom, regle, taille, format) VALUES ('Tournoi Test', 'blackball', 8, 'simple')").run();
  const cA = db.prepare("INSERT INTO compte (pseudo, email, pass_hash, salt) VALUES ('JoueurA', 'ja@x.fr', 'h', 's')").run();
  const cB = db.prepare("INSERT INTO compte (pseudo, email, pass_hash, salt) VALUES ('JoueurB', 'jb@x.fr', 'h', 's')").run();
  const c6 = db.prepare("INSERT INTO compte (pseudo, email, pass_hash, salt) VALUES ('AmiMatch1', 'am1@x.fr', 'h', 's')").run(); // ami de JoueurA, pref match active
  const c7 = db.prepare("INSERT INTO compte (pseudo, email, pass_hash, salt) VALUES ('AmiMatch2', 'am2@x.fr', 'h', 's')").run(); // ami de JoueurA, pref match désactivée
  db.prepare('UPDATE compte SET notif_amis_match = 0 WHERE id = ?').run(c7.lastInsertRowid);
  const jA = db.prepare("INSERT INTO joueur (tournoi_id, pseudo, compte_id) VALUES (?, 'JoueurA', ?)").run(tr.lastInsertRowid, cA.lastInsertRowid);
  const jB = db.prepare("INSERT INTO joueur (tournoi_id, pseudo, compte_id) VALUES (?, 'JoueurB', ?)").run(tr.lastInsertRowid, cB.lastInsertRowid);
  db.prepare('INSERT INTO ami (compte_id, ami_compte_id) VALUES (?, ?)').run(c6.lastInsertRowid, cA.lastInsertRowid);
  db.prepare('INSERT INTO ami (compte_id, ami_compte_id) VALUES (?, ?)').run(c7.lastInsertRowid, cA.lastInsertRowid);
  db.prepare("INSERT INTO push_subscription (compte_id, endpoint, keys_json) VALUES (?, 'https://push.example/epJA', '{\"p256dh\":\"k\",\"auth\":\"a\"}')").run(cA.lastInsertRowid);
  db.prepare("INSERT INTO push_subscription (compte_id, endpoint, keys_json) VALUES (?, 'https://push.example/epJB', '{\"p256dh\":\"k\",\"auth\":\"a\"}')").run(cB.lastInsertRowid);
  db.prepare("INSERT INTO push_subscription (compte_id, endpoint, keys_json) VALUES (?, 'https://push.example/epM1', '{\"p256dh\":\"k\",\"auth\":\"a\"}')").run(c6.lastInsertRowid);
  db.prepare("INSERT INTO push_subscription (compte_id, endpoint, keys_json) VALUES (?, 'https://push.example/epM2', '{\"p256dh\":\"k\",\"auth\":\"a\"}')").run(c7.lastInsertRowid);
  envois.length = 0;
  const mTest = { id: 999, joueur1_id: jA.lastInsertRowid, joueur2_id: jB.lastInsertRowid };
  await push.notifierMatchLance(mTest, 'JoueurA', 'JoueurB', 2, 'wb1-001');
  check('match lancé: 3 envois (2 joueurs + ami pref active)', envois.length === 3, `envois=${envois.map(e => e.endpoint).join(',')}`);
  check('joueurs: payload « À toi de jouer »', envois.filter(e => ['https://push.example/epJA', 'https://push.example/epJB'].includes(e.endpoint)).every(e => e.payload.title.includes('À toi de jouer')), JSON.stringify(envois.map(e => e.payload.title)));
  const envoiAmi = envois.find(e => e.endpoint === 'https://push.example/epM1');
  check('ami pref active: payload « Match d\'un ami en cours » + lien match', envoiAmi && envoiAmi.payload.title.includes("Match d'un ami") && envoiAmi.payload.url === '/match.html?id=999', JSON.stringify(envoiAmi && envoiAmi.payload));
  check('ami pref match désactivée: exclu', envois.every(e => e.endpoint !== 'https://push.example/epM2'), envois.map(e => e.endpoint).join(','));
  // pref réactivée -> l'ami est notifié aussi
  db.prepare('UPDATE compte SET notif_amis_match = 1 WHERE id = ?').run(c7.lastInsertRowid);
  envois.length = 0;
  await push.notifierMatchLance(mTest, 'JoueurA', 'JoueurB', 2, 'wb1-001');
  check('pref match réactivée -> 4 envois (ami inclus)', envois.length === 4 && envois.some(e => e.endpoint === 'https://push.example/epM2'), `envois=${envois.length}`);

  // --- suivi par pseudo (ami sans compte): match + inscription + dédoublonnage + fix NOT IN NULL ---
  console.log('\n--- suivi par pseudo (ami sans compte) ---');
  const cF = db.prepare("INSERT INTO compte (pseudo, email, pass_hash, salt) VALUES ('SuiveurP', 'sp@x.fr', 'h', 's')").run();
  db.prepare("INSERT INTO push_subscription (compte_id, endpoint, keys_json) VALUES (?, 'https://push.example/epF', '{\"p256dh\":\"k\",\"auth\":\"a\"}')").run(cF.lastInsertRowid);
  db.prepare("INSERT INTO ami_pseudo (compte_id, pseudo) VALUES (?, 'GhostAnon')").run(cF.lastInsertRowid);
  const jG = db.prepare("INSERT INTO joueur (tournoi_id, pseudo) VALUES (?, 'GhostAnon')").run(tr.lastInsertRowid); // joueur anonyme: aucun compte
  envois.length = 0;
  await push.notifierMatchLance({ id: 1000, joueur1_id: jA.lastInsertRowid, joueur2_id: jG.lastInsertRowid }, 'JoueurA', 'GhostAnon', 3, 'wb1-002');
  // joueurs: epJA (GhostAnon anonyme, pas d'abonnement) ; amis: epM1+epM2 (compte de JoueurA) + epF (suit le pseudo)
  // NB: avant le fix NOT EXISTS, un adversaire anonyme annulait TOUTES les notifs amis (NOT IN empoisonné par NULL)
  check('adversaire anonyme: joueur + 2 amis par compte + suiveur du pseudo notifiés (4)', envois.length === 4, `envois=${envois.map(e => e.endpoint).join(',')}`);
  const envoiF = envois.find(e => e.endpoint === 'https://push.example/epF');
  check('suiveur du pseudo: payload « Match d\'un ami en cours » + lien match', envoiF && envoiF.payload.title.includes("Match d'un ami") && envoiF.payload.url === '/match.html?id=1000', JSON.stringify(envoiF && envoiF.payload));
  // c6 est ami du compte JoueurA ET suit le pseudo GhostAnon -> un seul envoi (dédoublonné)
  db.prepare("INSERT INTO ami_pseudo (compte_id, pseudo) VALUES (?, 'GhostAnon')").run(c6.lastInsertRowid);
  envois.length = 0;
  await push.notifierMatchLance({ id: 1001, joueur1_id: jA.lastInsertRowid, joueur2_id: jG.lastInsertRowid }, 'JoueurA', 'GhostAnon', 3, 'wb1-003');
  check('compte ami ET suiveur du même pseudo -> 1 seul envoi (dédup)', envois.length === 4, `envois=${envois.length}`);
  db.prepare("DELETE FROM ami_pseudo WHERE compte_id = ? AND pseudo = 'GhostAnon'").run(c6.lastInsertRowid);
  // inscription d'un joueur anonyme sous un pseudo suivi
  envois.length = 0;
  const nInsP = await push.notifierInscriptionAmi(null, 'GhostAnon', 'Tournoi Test');
  check('inscription anonyme sous pseudo suivi -> 1 envoi (compteId null)', nInsP === 1 && envois[0].endpoint === 'https://push.example/epF', `n=${nInsP} endpoints=${envois.map(e => e.endpoint).join(',')}`);
  check('payload inscription pseudo correct (tag p-)', envois[0] && envois[0].payload.body.includes('GhostAnon') && envois[0].payload.url === '/tournoi.html' && envois[0].payload.tag.startsWith('ami-inscription-p-'), JSON.stringify(envois[0] && envois[0].payload));
  // pref inscription désactivée -> 0 envoi
  db.prepare('UPDATE compte SET notif_amis_inscription = 0 WHERE id = ?').run(cF.lastInsertRowid);
  envois.length = 0;
  const nInsP2 = await push.notifierInscriptionAmi(null, 'GhostAnon', 'Tournoi Test');
  check('pref inscription désactivée -> 0 envoi', nInsP2 === 0, `n=${nInsP2}`);
  db.prepare('UPDATE compte SET notif_amis_inscription = 1 WHERE id = ?').run(cF.lastInsertRowid);

  db.close();
  for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_PATH + ext); } catch (e) {} }
  console.log(`\n=== ${passed} OK / ${failed} ÉCHEC ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(2); });

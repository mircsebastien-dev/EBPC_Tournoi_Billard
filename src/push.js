// Web Push (PWA) : VAPID + envoi "à toi de jouer" quand un match d'un joueur abonné est lancé
const webpush = require('web-push');
const crypto = require('crypto');
const { db, getSetting, setSetting } = require('./db');

let vapidKeys = null;
function getVapid() {
  if (vapidKeys) return vapidKeys;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    vapidKeys = { publicKey: pub, privateKey: priv };
  } else {
    // pas de secrets VAPID: paire générée PUIS PERSISTÉE en base (table settings, sur le volume en prod).
    // Sans ça, chaque redémarrage/redéploiement régénère les clés et casse silencieusement
    // tous les abonnements push existants (le service de push refuse les anciennes clés).
    const storedPub = getSetting('vapid_public_key'), storedPriv = getSetting('vapid_private_key');
    if (storedPub && storedPriv) {
      vapidKeys = { publicKey: storedPub, privateKey: storedPriv };
    } else {
      vapidKeys = webpush.generateVAPIDKeys();
      setSetting('vapid_public_key', vapidKeys.publicKey);
      setSetting('vapid_private_key', vapidKeys.privateKey);
      console.log('[PUSH] VAPID générée et persistée en base:', vapidKeys.publicKey, '(les abonnements existants doivent être réactivés une fois)');
    }
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@ebpc-tournoi.fly.dev',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
  return vapidKeys;
}

function publicKey() { return getVapid().publicKey; }

function subscribe(compteId, subscription, clubId) {
  if (!subscription || !subscription.endpoint || !subscription.keys) throw new Error('Subscription invalide');
  db.prepare(`INSERT INTO push_subscription (compte_id, club_id, endpoint, keys_json) VALUES (?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET compte_id = excluded.compte_id, club_id = excluded.club_id, keys_json = excluded.keys_json`)
    .run(compteId, clubId != null ? clubId : null, subscription.endpoint, JSON.stringify(subscription.keys));
}

function unsubscribe(compteId, endpoint) {
  db.prepare('DELETE FROM push_subscription WHERE compte_id = ? AND endpoint = ?').run(compteId, endpoint);
}

// Notifie les 2 joueurs d'un match lancé (s'ils ont un compte + une subscription push)
async function notifierMatchLance(m, pseudo1, pseudo2, tableNumero, codeMatch) {
  try {
    getVapid();
    const subs = db.prepare(`
      SELECT s.endpoint, s.keys_json FROM push_subscription s
      JOIN joueur j ON j.compte_id = s.compte_id
      WHERE j.id IN (?, ?) AND s.compte_id IS NOT NULL
    `).all(m.joueur1_id, m.joueur2_id);
    // + les comptes qui ont un des 2 joueurs en ami (préférence "notification match d'un ami", désactivable depuis /compte.html)
    const subsAmis = db.prepare(`
      SELECT s.endpoint, s.keys_json, c.pseudo ami_de FROM push_subscription s
      JOIN ami a ON a.compte_id = s.compte_id
      JOIN joueur j ON j.compte_id = a.ami_compte_id
      JOIN compte c ON c.id = j.compte_id
      JOIN compte rc ON rc.id = a.compte_id
      WHERE j.id IN (?, ?) AND s.compte_id IS NOT NULL
        AND COALESCE(rc.notif_amis_match, 1) = 1
        AND s.compte_id NOT IN (SELECT compte_id FROM joueur WHERE id IN (?, ?))
    `).all(m.joueur1_id, m.joueur2_id, m.joueur1_id, m.joueur2_id);
    const payload = JSON.stringify({
      title: '🎱 À toi de jouer !',
      body: `${pseudo1} vs ${pseudo2} — Table ${tableNumero}${codeMatch ? ' · ' + codeMatch : ''}`,
      url: `/match.html?id=${m.id}`,
      tag: 'match-' + m.id,
    });
    const payloadAmi = JSON.stringify({
      title: '👥 Match d\'un ami en cours',
      body: `${pseudo1} vs ${pseudo2} — Table ${tableNumero}`,
      url: `/match.html?id=${m.id}`,
      tag: 'ami-match-' + m.id,
    });
    for (const s of subsAmis) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payloadAmi);
      } catch (e) {}
    }
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payload);
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          db.prepare('DELETE FROM push_subscription WHERE endpoint = ?').run(s.endpoint); // abonnement mort
        } else {
          console.error('[PUSH] erreur envoi:', e.statusCode || e.message);
        }
      }
    }
  } catch (e) { console.error('[PUSH] notifierMatchLance:', e.message); }
}

// Notifie l'inscription d'un compte à un tournoi aux comptes qui l'ont en ami
// et qui ont activé la préférence "notification inscription amis" (désactivable depuis /compte.html).
// clubId optionnel : seuls les abonnements du club visé reçoivent le push (multi-club).
async function notifierInscriptionAmi(compteId, pseudoAmi, tournoiNom, clubId) {
  try {
    getVapid();
    const subs = db.prepare(`
      SELECT s.endpoint, s.keys_json
      FROM push_subscription s
      JOIN ami a ON a.compte_id = s.compte_id
      JOIN compte c ON c.id = a.compte_id
      WHERE a.ami_compte_id = ?
        AND COALESCE(c.notif_amis_inscription, 1) = 1
        AND s.compte_id IS NOT NULL
        AND (s.club_id IS NULL OR s.club_id = ?)
    `).all(compteId, clubId != null ? clubId : -1);
    const payload = JSON.stringify({
      title: '👥 Un ami s\'est inscrit',
      body: `${pseudoAmi} vient de s'inscrire au tournoi « ${tournoiNom} »`,
      url: '/tournoi.html',
      tag: 'ami-inscription-' + compteId,
    });
    let n = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payload);
        n++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          db.prepare('DELETE FROM push_subscription WHERE endpoint = ?').run(s.endpoint); // abonnement mort
        }
      }
    }
    return n;
  } catch (e) { console.error('[PUSH] notifierInscriptionAmi:', e.message); return 0; }
}

// Notifie les comptes abonnés (ex: nouveau tournoi -> inscriptions ouvertes).
// clubId optionnel: si fourni, seuls les abonnements du club visé reçoivent le push (multi-club).
async function envoyerTous(payloadObj, clubId) {
  try {
    getVapid();
    const subs = clubId != null
      ? db.prepare('SELECT endpoint, keys_json FROM push_subscription WHERE compte_id IS NOT NULL AND club_id = ?').all(clubId)
      : db.prepare('SELECT endpoint, keys_json FROM push_subscription WHERE compte_id IS NOT NULL').all();
    const payload = JSON.stringify(payloadObj);
    let n = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payload);
        n++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          db.prepare('DELETE FROM push_subscription WHERE endpoint = ?').run(s.endpoint); // abonnement mort
        }
      }
    }
    return n;
  } catch (e) { console.error('[PUSH] envoyerTous:', e.message); return 0; }
}

function registerPushRoutes(app, { vueMatch }) {
  app.get('/api/push/vapid-public', (req, res) => res.json({ publicKey: publicKey() }));
  app.post('/api/push/subscribe', (req, res) => {
    if (!req.compte) return res.status(401).json({ error: 'Non connecté' });
    try { subscribe(req.compte.id, req.body.subscription, req.club ? req.club.id : null); } catch (e) { return res.status(400).json({ error: e.message }); }
    res.json({ ok: true });
  });
  app.post('/api/push/unsubscribe', (req, res) => {
    if (!req.compte) return res.status(401).json({ error: 'Non connecté' });
    unsubscribe(req.compte.id, String(req.body.endpoint || ''));
    res.json({ ok: true });
  });
}

// --- tests manuels de push (sans tournoi) ---
async function envoyerTest(compteId) {
  getVapid();
  const subs = db.prepare('SELECT endpoint, keys_json FROM push_subscription WHERE compte_id = ?').all(compteId);
  const payload = JSON.stringify({ title: '🔔 Test de notification', body: 'Si tu vois ça, le push marche !', url: '/compte.html', tag: 'test-' + Date.now() });
  let n = 0;
  for (const s of subs) { try { await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payload); n++; } catch (e) { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subscription WHERE endpoint = ?').run(s.endpoint); } }
  return { envoyes: n, subs: subs.length };
}
// simule le push "match d'un ami" pour un joueur donné (envoie à tous les comptes qui l'ont en ami)
async function envoyerTestAmi(joueurId) {
  getVapid();
  const j = db.prepare('SELECT id, pseudo FROM joueur WHERE id = ?').get(joueurId);
  if (!j) return { error: 'joueur introuvable' };
  const subs = db.prepare(`
    SELECT s.endpoint, s.keys_json FROM push_subscription s
    JOIN ami a ON a.compte_id = s.compte_id
    JOIN joueur j ON j.compte_id = a.ami_compte_id
    WHERE j.id = ? AND s.compte_id IS NOT NULL
  `).all(joueurId);
  const payload = JSON.stringify({ title: "👥 Match d'un ami en cours (TEST)", body: `${j.pseudo} est en match — ceci est une notification de test`, url: '/', tag: 'test-ami-' + Date.now() });
  let n = 0;
  for (const s of subs) { try { await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payload); n++; } catch (e) { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subscription WHERE endpoint = ?').run(s.endpoint); } }
  return { envoyes: n, ami_de: j.pseudo };
}

module.exports = { registerPushRoutes, notifierMatchLance, notifierInscriptionAmi, publicKey, envoyerTest, envoyerTestAmi, envoyerTous };

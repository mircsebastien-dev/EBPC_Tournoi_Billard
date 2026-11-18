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
      SELECT s.endpoint, s.keys_json, COALESCE(c.lang, 'fr') AS lang FROM push_subscription s
      JOIN joueur j ON j.compte_id = s.compte_id
      JOIN compte c ON c.id = s.compte_id
      WHERE j.id IN (?, ?) AND s.compte_id IS NOT NULL
    `).all(m.joueur1_id, m.joueur2_id);
    // + les comptes qui ont un des 2 joueurs en ami (par compte, ou par pseudo suivi sans compte)
    // (préférence "notification match d'un ami", désactivable depuis /compte.html)
    // NOT EXISTS (et pas NOT IN): un joueur anonyme a compte_id NULL, qui empoisonnerait le NOT IN
    const subsAmis = db.prepare(`
      SELECT s.endpoint, s.keys_json, COALESCE(rc.lang, 'fr') AS lang FROM push_subscription s
      JOIN ami a ON a.compte_id = s.compte_id
      JOIN compte rc ON rc.id = a.compte_id
      JOIN joueur j ON j.compte_id = a.ami_compte_id
      WHERE j.id IN (?, ?) AND s.compte_id IS NOT NULL
        AND COALESCE(rc.notif_amis_match, 1) = 1
        AND NOT EXISTS (SELECT 1 FROM joueur pj WHERE pj.id IN (?, ?) AND pj.compte_id = s.compte_id)
      GROUP BY s.endpoint
      UNION
      SELECT s.endpoint, s.keys_json, COALESCE(rc.lang, 'fr') AS lang FROM push_subscription s
      JOIN ami_pseudo ap ON ap.compte_id = s.compte_id
      JOIN compte rc ON rc.id = ap.compte_id
      JOIN joueur j ON j.pseudo = ap.pseudo COLLATE NOCASE
      WHERE j.id IN (?, ?) AND s.compte_id IS NOT NULL
        AND COALESCE(rc.notif_amis_match, 1) = 1
        AND NOT EXISTS (SELECT 1 FROM joueur pj WHERE pj.id IN (?, ?) AND pj.compte_id = s.compte_id)
      GROUP BY s.endpoint
    `).all(m.joueur1_id, m.joueur2_id, m.joueur1_id, m.joueur2_id, m.joueur1_id, m.joueur2_id, m.joueur1_id, m.joueur2_id);
    // payloads par langue du destinataire (compte.lang, defaut fr) : "Table" est identique fr/en
    const payloadMatch = {
      fr: JSON.stringify({
        title: '🎱 À toi de jouer !',
        body: `${pseudo1} vs ${pseudo2} — Table ${tableNumero}${codeMatch ? ' · ' + codeMatch : ''}`,
        url: `/match.html?id=${m.id}`,
        tag: 'match-' + m.id,
      }),
      en: JSON.stringify({
        title: "🎱 You're up!",
        body: `${pseudo1} vs ${pseudo2} — Table ${tableNumero}${codeMatch ? ' · ' + codeMatch : ''}`,
        url: `/match.html?id=${m.id}`,
        tag: 'match-' + m.id,
      }),
      es: JSON.stringify({
        title: '🎱 ¡Te toca jugar!',
        body: `${pseudo1} vs ${pseudo2} — Mesa ${tableNumero}${codeMatch ? ' · ' + codeMatch : ''}`,
        url: `/match.html?id=${m.id}`,
        tag: 'match-' + m.id,
      }),
      it: JSON.stringify({
        title: '🎱 Tocca a te!',
        body: `${pseudo1} vs ${pseudo2} — Tavolo ${tableNumero}${codeMatch ? ' · ' + codeMatch : ''}`,
        url: `/match.html?id=${m.id}`,
        tag: 'match-' + m.id,
      }),
      de: JSON.stringify({
        title: '🎱 Du bist dran!',
        body: `${pseudo1} vs ${pseudo2} — Tisch ${tableNumero}${codeMatch ? ' · ' + codeMatch : ''}`,
        url: `/match.html?id=${m.id}`,
        tag: 'match-' + m.id,
      }),
    };
    const payloadAmi = {
      fr: JSON.stringify({
        title: '👥 Match d\'un ami en cours',
        body: `${pseudo1} vs ${pseudo2} — Table ${tableNumero}`,
        url: `/match.html?id=${m.id}`,
        tag: 'ami-match-' + m.id,
      }),
      en: JSON.stringify({
        title: "👥 A friend's match is live",
        body: `${pseudo1} vs ${pseudo2} — Table ${tableNumero}`,
        url: `/match.html?id=${m.id}`,
        tag: 'ami-match-' + m.id,
      }),
      es: JSON.stringify({
        title: '👥 Partido de un amigo en curso',
        body: `${pseudo1} vs ${pseudo2} — Mesa ${tableNumero}`,
        url: `/match.html?id=${m.id}`,
        tag: 'ami-match-' + m.id,
      }),
      it: JSON.stringify({
        title: '👥 Partita di un amico in corso',
        body: `${pseudo1} vs ${pseudo2} — Tavolo ${tableNumero}`,
        url: `/match.html?id=${m.id}`,
        tag: 'ami-match-' + m.id,
      }),
      de: JSON.stringify({
        title: '👥 Spiel eines Freundes läuft',
        body: `${pseudo1} vs ${pseudo2} — Tisch ${tableNumero}`,
        url: `/match.html?id=${m.id}`,
        tag: 'ami-match-' + m.id,
      }),
    };
    for (const s of subsAmis) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payloadAmi[s.lang] || payloadAmi.fr);
      } catch (e) {}
    }
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payloadMatch[s.lang] || payloadMatch.fr);
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

// Notifie l'inscription d'un compte à un tournoi aux comptes qui l'ont en ami (par compte)
// OU qui suivent son pseudo (ami_pseudo, sans compte) — compteId null = inscription anonyme par pseudo.
// et qui ont activé la préférence "notification inscription amis" (désactivable depuis /compte.html).
// clubId optionnel : seuls les abonnements du club visé reçoivent le push (multi-club).
async function notifierInscriptionAmi(compteId, pseudoAmi, tournoiNom, clubId) {
  try {
    getVapid();
    const club = clubId != null ? clubId : -1;
    const subsMap = new Map(); // dédoublonné par endpoint (un compte peut être ami ET suiveur du pseudo)
    if (compteId != null) {
      for (const s of db.prepare(`
        SELECT s.endpoint, s.keys_json, COALESCE(c.lang, 'fr') AS lang
        FROM push_subscription s
        JOIN ami a ON a.compte_id = s.compte_id
        JOIN compte c ON c.id = a.compte_id
        WHERE a.ami_compte_id = ?
          AND COALESCE(c.notif_amis_inscription, 1) = 1
          AND s.compte_id IS NOT NULL
          AND (s.club_id IS NULL OR s.club_id = ?)
      `).all(compteId, club)) subsMap.set(s.endpoint, s);
    }
    for (const s of db.prepare(`
      SELECT s.endpoint, s.keys_json, COALESCE(c.lang, 'fr') AS lang
      FROM push_subscription s
      JOIN ami_pseudo ap ON ap.compte_id = s.compte_id
      JOIN compte c ON c.id = ap.compte_id
      WHERE ap.pseudo = ? COLLATE NOCASE
        AND COALESCE(c.notif_amis_inscription, 1) = 1
        AND s.compte_id IS NOT NULL
        AND (s.club_id IS NULL OR s.club_id = ?)
    `).all(pseudoAmi, club)) subsMap.set(s.endpoint, s);
    const subs = [...subsMap.values()];
    // payloads bilingues selon la langue du compte destinataire (compte.lang, defaut fr)
    const payloads = {
      fr: JSON.stringify({
        title: '👥 Un ami s\'est inscrit',
        body: `${pseudoAmi} vient de s'inscrire au tournoi « ${tournoiNom} »`,
        url: '/tournoi.html',
        tag: 'ami-inscription-' + (compteId != null ? compteId : 'p-' + String(pseudoAmi).toLowerCase()),
      }),
      en: JSON.stringify({
        title: '👥 A friend signed up',
        body: `${pseudoAmi} just signed up for the tournament "${tournoiNom}"`,
        url: '/tournoi.html',
        tag: 'ami-inscription-' + (compteId != null ? compteId : 'p-' + String(pseudoAmi).toLowerCase()),
      }),
      es: JSON.stringify({
        title: '👥 Un amigo se ha inscrito',
        body: `${pseudoAmi} acaba de inscribirse en el torneo « ${tournoiNom} »`,
        url: '/tournoi.html',
        tag: 'ami-inscription-' + (compteId != null ? compteId : 'p-' + String(pseudoAmi).toLowerCase()),
      }),
      it: JSON.stringify({
        title: '👥 Un amico si è iscritto',
        body: `${pseudoAmi} si è appena iscritto al torneo « ${tournoiNom} »`,
        url: '/tournoi.html',
        tag: 'ami-inscription-' + (compteId != null ? compteId : 'p-' + String(pseudoAmi).toLowerCase()),
      }),
      de: JSON.stringify({
        title: '👥 Ein Freund hat sich eingeschrieben',
        body: `${pseudoAmi} hat sich gerade für das Turnier « ${tournoiNom} » eingeschrieben`,
        url: '/tournoi.html',
        tag: 'ami-inscription-' + (compteId != null ? compteId : 'p-' + String(pseudoAmi).toLowerCase()),
      }),
    };
    let n = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payloads[s.lang] || payloads.fr);
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
async function envoyerTous(payloadObj, clubId, autres) {
  try {
    getVapid();
    const subs = clubId != null
      ? db.prepare('SELECT s.endpoint, s.keys_json, COALESCE(c.lang, ?) AS lang FROM push_subscription s LEFT JOIN compte c ON c.id = s.compte_id WHERE s.compte_id IS NOT NULL AND s.club_id = ?').all('fr', clubId)
      : db.prepare('SELECT s.endpoint, s.keys_json, COALESCE(c.lang, ?) AS lang FROM push_subscription s LEFT JOIN compte c ON c.id = s.compte_id WHERE s.compte_id IS NOT NULL').all('fr');
    const payload = JSON.stringify(payloadObj);
    // versions traduites par langue du destinataire (compte.lang) ; autres = { en: {...}, es: {...}, ... }
    // (compat: un 3e arg payload simple avec .title = version "en" seule, comme avant)
    const traduits = {};
    if (autres) {
      if (autres.title != null) traduits.en = JSON.stringify(autres);
      else for (const l of ['en', 'es', 'it', 'de']) if (autres[l]) traduits[l] = JSON.stringify(autres[l]);
    }
    let n = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, traduits[s.lang] || payload);
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
async function envoyerTest(compteId, langHint) {
  getVapid();
  const subs = db.prepare('SELECT endpoint, keys_json FROM push_subscription WHERE compte_id = ?').all(compteId);
  // langue stockee sur le compte prioritaire, repli sur l en-tete X-Lang de la requete
  const c = db.prepare('SELECT COALESCE(lang, ?) AS lang FROM compte WHERE id = ?').get(['en', 'es', 'it', 'de'].includes(langHint) ? langHint : 'fr', compteId);
  const payloadsTest = {
    fr: { title: '🔔 Test de notification', body: 'Si tu vois ça, le push marche !', url: '/parametres.html', tag: 'test-' + Date.now() },
    en: { title: '🔔 Notification test', body: 'If you can see this, push works!', url: '/parametres.html', tag: 'test-' + Date.now() },
    es: { title: '🔔 Notificación de prueba', body: 'Si ves esto, ¡el push funciona!', url: '/parametres.html', tag: 'test-' + Date.now() },
    it: { title: '🔔 Notifica di prova', body: 'Se vedi questo, il push funziona!', url: '/parametres.html', tag: 'test-' + Date.now() },
    de: { title: '🔔 Testbenachrichtigung', body: 'Wenn du das siehst, funktioniert Push!', url: '/parametres.html', tag: 'test-' + Date.now() },
  };
  const payload = JSON.stringify(payloadsTest[c.lang] || payloadsTest.fr);
  let n = 0;
  for (const s of subs) { try { await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payload); n++; } catch (e) { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subscription WHERE endpoint = ?').run(s.endpoint); } }
  return { envoyes: n, subs: subs.length };
}
// simule le push "match d'un ami" pour un joueur donné (envoie à tous les comptes qui l'ont en ami ou suivent son pseudo)
async function envoyerTestAmi(joueurId) {
  getVapid();
  const j = db.prepare('SELECT id, pseudo FROM joueur WHERE id = ?').get(joueurId);
  if (!j) return { error: 'joueur introuvable' };
  const subs = db.prepare(`
    SELECT s.endpoint, s.keys_json, COALESCE(c.lang, 'fr') AS lang FROM push_subscription s
    JOIN ami a ON a.compte_id = s.compte_id
    JOIN compte c ON c.id = s.compte_id
    JOIN joueur j ON j.compte_id = a.ami_compte_id
    WHERE j.id = ? AND s.compte_id IS NOT NULL
    UNION
    SELECT s.endpoint, s.keys_json, COALESCE(c.lang, 'fr') AS lang FROM push_subscription s
    JOIN ami_pseudo ap ON ap.compte_id = s.compte_id
    JOIN compte c ON c.id = s.compte_id
    JOIN joueur j ON j.pseudo = ap.pseudo COLLATE NOCASE
    WHERE j.id = ? AND s.compte_id IS NOT NULL
  `).all(joueurId, joueurId);
  // payloads bilingues selon la langue du destinataire (compte.lang, defaut fr)
  const payloadsAmiTest = {
    fr: JSON.stringify({ title: "👥 Match d'un ami en cours (TEST)", body: `${j.pseudo} est en match — ceci est une notification de test`, url: '/', tag: 'test-ami-' + Date.now() }),
    en: JSON.stringify({ title: "👥 A friend's match is live (TEST)", body: `${j.pseudo} is playing — this is a test notification`, url: '/', tag: 'test-ami-' + Date.now() }),
    es: JSON.stringify({ title: "👥 Partido de un amigo en curso (TEST)", body: `${j.pseudo} está jugando — esto es una notificación de prueba`, url: '/', tag: 'test-ami-' + Date.now() }),
    it: JSON.stringify({ title: "👥 Partita di un amico in corso (TEST)", body: `${j.pseudo} sta giocando — questa è una notifica di prova`, url: '/', tag: 'test-ami-' + Date.now() }),
    de: JSON.stringify({ title: "👥 Spiel eines Freundes läuft (TEST)", body: `${j.pseudo} spielt gerade — dies ist eine Testbenachrichtigung`, url: '/', tag: 'test-ami-' + Date.now() }),
  };
  let n = 0;
  for (const s of subs) { try { await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payloadsAmiTest[s.lang] || payloadsAmiTest.fr); n++; } catch (e) { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subscription WHERE endpoint = ?').run(s.endpoint); } }
  return { envoyes: n, ami_de: j.pseudo };
}

module.exports = { registerPushRoutes, notifierMatchLance, notifierInscriptionAmi, publicKey, envoyerTest, envoyerTestAmi, envoyerTous };

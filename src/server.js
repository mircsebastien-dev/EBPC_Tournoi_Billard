const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { db, setSetting, getSetting, logAudit, clubParDefaut, clubParSlug } = require('./db');
const bracket = require('./bracket');
const M = require('./matchs');
const comptes = require('./comptes');
const QRCode = require('qrcode');
const push = require('./push');
const { traduireErreur } = require('./i18n');

// robustesse process: on logue sans crasher (écritures SQLite synchrones + WAL = état toujours cohérent)
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

const app = express();
// headers de sécurité
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // 17k v6: blob: requis dans img-src pour l import de logo (URL.createObjectURL) : sans lui, la CSP bloquait le chargement de l image choisie -> refus de TOUT import, tous navigateurs
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
  next();
});
// limite élargie UNIQUEMENT pour la restauration de TOUTE la base (une sauvegarde complète peut dépasser 256ko)
app.use('/api/admin/base/import', express.json({ limit: '25mb' }));
app.use('/api/admin/base/import-club', express.json({ limit: '25mb' })); // périmètre club: même limite (journal + snapshots volumineux)
app.use('/api/super/base/import', express.json({ limit: '25mb' })); // 17i: import de base depuis la zone super (même limite, monté AVANT le parseur global 256kb)
app.use('/api/admin/club/prefs', express.json({ limit: '2mb' })); // 17n: bannière + photo de fond TV importées ensemble dépassent 256ko (même mécanique que les import de base, route PIN/session admin)
app.use(express.json({ limit: '256kb' })); // body > 256ko -> 413 (géré par le middleware d'erreur)
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// i18n API : X-Lang: en/es/it/de -> traduit les champs error/message des reponses JSON (defaut fr, repli francais)
app.use((req, res, next) => {
  const l = String(req.headers['x-lang'] || '');
  req.lang = ['en', 'es', 'it', 'de'].includes(l) ? l : 'fr';
  const jsonOrig = res.json.bind(res);
  res.json = (data) => {
    if (req.lang !== 'fr' && data && typeof data === 'object' && !Array.isArray(data)) {
      let modifie = false;
      if (typeof data.error === 'string') { const tr = traduireErreur(data.error, req.lang); if (tr !== data.error) { data = { ...data, error: tr }; modifie = true; } }
      if (typeof data.message === 'string') { const tr = traduireErreur(data.message, req.lang); if (tr !== data.message) { data = { ...data, message: tr }; modifie = true; } }
    }
    return jsonOrig(data);
  };
  next();
});

// nettoie un pseudo: retire les caractères de contrôle, trim, tronque
function cleanPseudo(v, max = 40) {
  return String(v || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);
}

// pseudo d'un compte = réservé: aucune inscription anonyme ne peut le prendre (anti-usurpation d'identité)
function compteAvecPseudo(pseudo, clubId) { // 17f: réservation de pseudo cloisonnée au club courant (les comptes des autres clubs ne bloquent plus)
  return (clubId
    ? db.prepare('SELECT id, pseudo FROM compte WHERE pseudo = ? COLLATE NOCASE AND club_id = ?').get(String(pseudo || ''), clubId)
    : db.prepare('SELECT id, pseudo FROM compte WHERE pseudo = ? COLLATE NOCASE').get(String(pseudo || ''))) || null;
}

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '0000';
setSetting('admin_pin_hash', crypto.createHash('sha256').update(ADMIN_PIN).digest('hex'));
// compte admin bootstrap (optionnel): ADMIN_EMAIL + ADMIN_PASSWORD -> compte role=admin au boot
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  try { comptes.ensureAdminCompte(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD); } catch (e) { console.error('[ADMIN] bootstrap:', e.message); }
}

const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
app.use(comptes.middlewareSession);

const clients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

// ---------- anti brute-force sur le code PIN admin ----------
// fenêtre glissante d'échecs par IP + lockout temporaire (même le bon code est refusé pendant le lockout)
const pinAttempts = new Map(); // ip -> { echecs: number[], bloqueJusqua: number }
const PIN_MAX_ESSAIS = Number(process.env.PIN_MAX_ESSAIS || 10);
const PIN_FENETRE_MS = Number(process.env.PIN_FENETRE_MS || 10 * 60 * 1000);
const PIN_BLOCAGE_MS = Number(process.env.PIN_BLOCAGE_MS || 10 * 60 * 1000);
function ipClient(req) {
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0].trim() : '') || req.ip || 'local';
}
function pinBloque(ip) {
  const now = Date.now();
  const e = pinAttempts.get(ip);
  if (!e) return null;
  if (e.bloqueJusqua > now) return `Trop de tentatives de code admin, réessaie dans ${Math.ceil((e.bloqueJusqua - now) / 1000)}s`;
  return null;
}
function pinEchec(ip) {
  const now = Date.now();
  const e = pinAttempts.get(ip) || { echecs: [], bloqueJusqua: 0 };
  e.echecs = e.echecs.filter(t => now - t < PIN_FENETRE_MS);
  e.echecs.push(now);
  if (e.echecs.length >= PIN_MAX_ESSAIS) {
    e.bloqueJusqua = now + PIN_BLOCAGE_MS;
    console.warn(`[SECU] lockout PIN admin pour ${ip} (${PIN_MAX_ESSAIS} échecs) pendant ${PIN_BLOCAGE_MS / 1000}s`);
  }
  if (pinAttempts.size > 10000) pinAttempts.clear(); // garde-fou mémoire
  pinAttempts.set(ip, e);
}
function verifierPinAdmin(req, pin) {
  const ip = ipClient(req);
  const bloque = pinBloque(ip);
  if (bloque) return { bloque: true, message: bloque };
  const hash = crypto.createHash('sha256').update(String(pin || '')).digest('hex');
  // PIN global (super-admin) OU pin_hash du club courant (multi-club)
  const clubHash = req.club && req.club.pin_hash;
  if (hash === getSetting('admin_pin_hash')) { pinAttempts.delete(ip); return { ok: true, via: 'global' }; }
  if (clubHash && hash === clubHash) { pinAttempts.delete(ip); return { ok: true, via: 'club' }; } // PIN du CLUB courant (17g: suffit pour gérer les rôles de SON club)
  pinEchec(ip);
  return { ok: false };
}

// Auth admin à deux niveaux: session d'un compte role=admin (méthode produit),
// sinon fallback par code PIN (anti brute-force). Le PIN n'est exigé QUE si pas de session admin.
function estAdminSession(req) { return !!(req.compte && (req.compte.role === 'admin' || req.compte.role === 'super_admin')); } // 17i: comptes plateforme (super_admin dedie ou admin legacy), DISTINCTS des admins de club (compte_club)

// multi-club: rôle du compte (via sa session) sur le club courant, null sinon.
// 'admin' = gestion complète du club par session ; 'operateur' = routes admin du club ouvertes, confirmations et rôles refusés.
function roleClubSession(req) {
  if (!req.compte || !req.club) return null;
  const rc = db.prepare('SELECT role FROM compte_club WHERE compte_id = ? AND club_id = ?').get(req.compte.id, req.club.id);
  return rc ? rc.role : null;
}

function requireAdmin(req, res, next) {
  if (estAdminSession(req)) { req.adminVia = 'session'; return next(); }
  if (roleClubSession(req)) { req.adminVia = 'session_club'; return next(); } // session d un compte rattaché au club
  // PAS de req.query.pin: le PIN dans l'URL fuirait dans les logs des proxies
  const pin = req.headers['x-admin-pin'] || (req.body && req.body.pin);
  const r = verifierPinAdmin(req, pin);
  if (r.bloque) return res.status(429).json({ error: r.message });
  if (!r.ok) return res.status(401).json({ error: 'PIN administrateur invalide (ou connectez-vous avec un compte admin)' });
  req.adminVia = 'pin';
  req.adminViaPin = r.via || null; // 17g: 'club' = code du club courant, 'global' = code plateforme
  next();
}

// geste admin destructif : exige le code re-saisi dans le body (confirm_pin), pas juste la session PIN —
// sauf si session d'un compte admin (déjà authentifié fortement par mdp + session)
function requireConfirmPin(req, res, next) {
  if (estAdminSession(req) || roleClubSession(req) === 'admin') return next(); // admin global ou admin du club (auth forte par mdp + session)
  const pin = req.body && req.body.confirm_pin;
  const r = verifierPinAdmin(req, pin);
  if (r.bloque) return res.status(429).json({ error: r.message });
  if (!r.ok) return res.status(401).json({ error: 'Code administrateur requis pour confirmer cette suppression' });
  next();
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// ---------- 17q. Codec PNG maison (SANS dépendance) pour l écran de lancement du club ----------
// Encodeur + décodeur PNG (types couleur 0/2/4/6, profondeur 8, filtres 0-4, non entrelacé).
// Uniquement pour le splash : les images servies viennent du champ icone 17o (canvas -> PNG).
const zlib17q = require('zlib');
let CRC_TABLE_17q = null;
function crcTable17q() {
  if (CRC_TABLE_17q) return CRC_TABLE_17q;
  CRC_TABLE_17q = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE_17q[n] = c;
  }
  return CRC_TABLE_17q;
}
function crc32_17q(buf) {
  const t = crcTable17q();
  let c = 0 ^ 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ t[(c ^ buf[i]) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
}
function tramePng17q(type, donnees) {
  const b = Buffer.alloc(8 + donnees.length + 4);
  b.writeUInt32BE(donnees.length, 0);
  b.write(type, 4, 'ascii');
  donnees.copy(b, 8);
  b.writeUInt32BE(crc32_17q(Buffer.concat([Buffer.from(type, 'ascii'), donnees])), 8 + donnees.length);
  return b;
}
const PNG_SIG_17q = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function encoderPng17q(w, h, rgba) { // RGBA 8 bits -> PNG (filtre None), sans savoir dessiner autre chose que du pixel brut
  const ligne = w * 4;
  const brut = Buffer.alloc((ligne + 1) * h);
  for (let y = 0; y < h; y++) {
    brut[y * (ligne + 1)] = 0;
    rgba.copy(brut, y * (ligne + 1) + 1, y * ligne, (y + 1) * ligne);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([PNG_SIG_17q, tramePng17q('IHDR', ihdr), tramePng17q('IDAT', zlib17q.deflateSync(brut, { level: 6 })), tramePng17q('IEND', Buffer.alloc(0))]);
}
function decoderPng17q(buf) { // PNG -> { w, h, rgba }, null si non décodable (entrelacé, 16 bits, palette...)
  try {
    if (!buf || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG_17q)) return null;
    let pos = 8, w = 0, h = 0, prof = 0, couleur = 0, entrelace = 0;
    const trames = [];
    while (pos + 8 <= buf.length) {
      const lg = buf.readUInt32BE(pos);
      const type = buf.toString('ascii', pos + 4, pos + 8);
      if (pos + 12 + lg > buf.length) return null;
      const donnees = buf.subarray(pos + 8, pos + 8 + lg);
      if (type === 'IHDR') { w = donnees.readUInt32BE(0); h = donnees.readUInt32BE(4); prof = donnees[8]; couleur = donnees[9]; entrelace = donnees[12]; }
      else if (type === 'IDAT') trames.push(donnees);
      else if (type === 'IEND') break;
      pos += 12 + lg;
    }
    if (prof !== 8 || entrelace !== 0 || ![0, 2, 4, 6].includes(couleur) || w <= 0 || h <= 0 || w > 2000 || h > 2000) return null;
    const canaux = couleur === 6 ? 4 : couleur === 2 ? 3 : couleur === 4 ? 2 : 1;
    const ligne = w * canaux;
    const filtres = zlib17q.inflateSync(Buffer.concat(trames));
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      const f = filtres[y * (ligne + 1)];
      const off = y * (ligne + 1) + 1;
      for (let x = 0; x < ligne; x++) {
        const courant = filtres[off + x];
        const gauche = x >= canaux ? filtres[off + x - canaux] : 0;
        const haut = y > 0 ? filtres[off - (ligne + 1) + x] : 0;
        const diag = y > 0 && x >= canaux ? filtres[off - (ligne + 1) + x - canaux] : 0;
        let v;
        if (f === 0) v = courant;
        else if (f === 1) v = courant + gauche;
        else if (f === 2) v = courant + haut;
        else if (f === 3) v = courant + ((gauche + haut) >> 1);
        else if (f === 4) { const p = gauche + haut - diag; const pa = Math.abs(p - gauche), pb = Math.abs(p - haut), pc = Math.abs(p - diag); v = courant + (pa <= pb && pa <= pc ? gauche : pb <= pc ? haut : diag); }
        else return null;
        filtres[off + x] = v & 0xff;
      }
      for (let x = 0; x < w; x++) {
        const s = off + x * canaux, d = (y * w + x) * 4;
        if (couleur === 6) { rgba[d] = filtres[s]; rgba[d + 1] = filtres[s + 1]; rgba[d + 2] = filtres[s + 2]; rgba[d + 3] = filtres[s + 3]; }
        else if (couleur === 2) { rgba[d] = filtres[s]; rgba[d + 1] = filtres[s + 1]; rgba[d + 2] = filtres[s + 2]; rgba[d + 3] = 255; }
        else if (couleur === 4) { const g = filtres[s]; rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = filtres[s + 1]; }
        else { const g = filtres[s]; rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = 255; }
      }
    }
    return { w, h, rgba };
  } catch (e) { return null; }
}

// 17o. Manifeste PWA dynamique : « Ajouter à l écran d accueil » installe l app avec le nom, la couleur et l icône
// du club courant (?club= posé par le front : le navigateur n envoie ni X-Club ni session à la requête du manifeste).
// Monté AVANT express.static (sinon public/manifest.webmanifest masquerait la route) ; club résolu à la main car le
// middleware multi-club vient après. Slug inconnu -> club par défaut (jamais 404 : l installabilité est préservée).
app.get('/manifest.webmanifest', (req, res) => {
  const slug17o = String(req.query.club || '').trim();
  const club17o = slug17o ? (clubParSlug(slug17o) || clubParDefaut()) : clubParDefaut();
  const th17o = themeDuClub(club17o);
  const ic17o = iconeClub17o(club17o); // 17o: icône PNG du club, sinon icône générique de l app
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'no-store'); // fraîche au moment de l installation (changement de logo vite répercuté)
  res.send(JSON.stringify({
    name: club17o.nom + ' — Tournois',
    short_name: club17o.nom.slice(0, 12),
    description: th17o.description ? th17o.description.slice(0, 200) : 'Tournois de billard — tableaux, scores en direct, notifications',
    start_url: club17o.id === clubParDefaut().id ? '/' : '/?club=' + encodeURIComponent(club17o.slug),
    scope: '/',
    display: 'standalone',
    background_color: th17o.accent, // 17q: écran de lancement Android aux couleurs du club (Chrome compose le splash depuis le manifeste)
    theme_color: th17o.accent, // 17o: barre d état du téléphone aux couleurs du club
    icons: [
      { src: ic17o ? '/api/club-icone?club=' + encodeURIComponent(club17o.slug) + '&taille=192' : '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  }));
});
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    // HTML/JS/CSS toujours revalidés (évite le vieux common.js en cache sur mobile)
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-store, must-revalidate');
  },
}));

// ---------- multi-club: résolution du club courant ----------
// Header X-Club ou ?club=<slug> ; rien -> club par défaut (mono-club: comportement inchangé).
app.use((req, res, next) => {
  const slug = String(req.headers['x-club'] || req.query.club || '').trim();
  let club = null;
  if (slug) {
    club = clubParSlug(slug);
    if (!club) return res.status(404).json({ error: `Club inconnu « ${slug} »` });
  }
  req.club = club || clubParDefaut();
  next();
});

function tournoiActif(clubId) {
  if (clubId != null) {
    return db.prepare(`SELECT * FROM tournoi WHERE club_id = ? AND statut IN ('inscription', 'en_cours') ORDER BY id DESC LIMIT 1`).get(clubId) || null;
  }
  return db.prepare(`SELECT * FROM tournoi WHERE statut IN ('inscription', 'en_cours') ORDER BY id DESC LIMIT 1`).get()
    || null;
}

// helpers d'isolation: une entité n'existe que si son tournoi appartient au club courant
function clubIdOf(t) { return t && t.club_id != null ? t.club_id : clubParDefaut().id; }
function tournoiDuClub(req, id) { const t = db.prepare('SELECT * FROM tournoi WHERE id = ?').get(Number(id)); return (t && clubIdOf(t) === req.club.id) ? t : null; }
function matchDuClub(req, id) { return db.prepare('SELECT m.* FROM match m JOIN tournoi t ON t.id = m.tournoi_id WHERE m.id = ? AND t.club_id = ?').get(Number(id), req.club.id) || null; }
function joueurDuClub(req, id) { return db.prepare('SELECT j.* FROM joueur j JOIN tournoi t ON t.id = j.tournoi_id WHERE j.id = ? AND t.club_id = ?').get(Number(id), req.club.id) || null; }
// audit toujours rattaché au club de la requête
// pseudo du compte admin à l'origine d'une action (session admin), null si auth par code PIN ou action auto
function auteurAdmin(req) { return (req && req.compte && (estAdminSession(req) || roleClubSession(req))) ? req.compte.pseudo : null; }
function logAuditReq(req, action, cible, avant, apres) { logAudit(action, cible, avant, apres, req && req.superZone ? null : (req && req.club ? req.club.id : undefined), auteurAdmin(req)); } // 17i: en zone super (/api/super/*), l audit n est rattache a aucun club

function distancesMap(tournoiId) {
  const rows = db.prepare('SELECT round, manches FROM distance_round WHERE tournoi_id = ?').all(tournoiId);
  const map = {};
  for (const r of rows) map[r.round] = r.manches;
  return map;
}

// Tous les ids joueur d'un même joueur (même pseudo, ou même compte) -> agrège tous les tournois
function idsMemeJoueur(id, clubId) {
  const j = db.prepare('SELECT pseudo, compte_id FROM joueur WHERE id = ?').get(id);
  if (!j) return { pseudo: null, ids: [] };
  let ids;
  if (j.compte_id) {
    ids = clubId != null
      ? db.prepare('SELECT j.id FROM joueur j JOIN tournoi t ON t.id = j.tournoi_id WHERE j.compte_id = ? AND t.club_id = ?').all(j.compte_id, clubId).map(r => r.id)
      : db.prepare('SELECT id FROM joueur WHERE compte_id = ?').all(j.compte_id).map(r => r.id);
  } else {
    ids = clubId != null
      ? db.prepare('SELECT j.id FROM joueur j JOIN tournoi t ON t.id = j.tournoi_id WHERE LOWER(j.pseudo) = LOWER(?) AND t.club_id = ?').all(j.pseudo, clubId).map(r => r.id)
      : db.prepare('SELECT id FROM joueur WHERE LOWER(pseudo) = LOWER(?)').all(j.pseudo).map(r => r.id);
  }
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
    casseur: m.casseur_id ? { id: m.casseur_id, pseudo: M.pseudo(m.casseur_id) } : null,
    score1: m.score1,
    score2: m.score2,
    manches: m.manches,
    gagnant_id: m.gagnant_id,
    gagnant: m.gagnant_id ? M.pseudo(m.gagnant_id) : null,
    etat: m.etat,
    table: m.table_id ? M.tableNumero(m.table_id) : null,
    suivant_id: m.suivant_id,
    suivant_slot: m.suivant_slot,
    perdant_id: m.perdant_id,
    perdant_slot: m.perdant_slot,
    started_at: m.started_at,
    ended_at: m.ended_at,
    duree_s: (m.started_at && m.ended_at)
      ? Math.max(0, Math.round((new Date(m.ended_at.replace(' ', 'T') + 'Z') - new Date(m.started_at.replace(' ', 'T') + 'Z')) / 1000))
      : null,
  };
}

// points par joueur pour un tournoi: dernier tour WB/F atteint + 1 si passé par le LB
function pointsParTournoi(tournoiId) {
  // points = profondeur max atteinte dans le tableau principal (WB: tour, F: k+tour), sans bonus LB
  // => tous les demi-finalistes ont le même score ; perd 2 premiers matchs = 1 ; gagne 1 perd 2 = 2 ; rentre en F (k=2) = 3 min
  const t = db.prepare('SELECT format, dko_tours FROM tournoi WHERE id = ?').get(tournoiId);
  const k = (t && t.format === 'double') ? (t.dko_tours || 1) : 0;
  const matchs = db.prepare(`SELECT joueur1_id j1, joueur2_id j2, bracket, tour FROM match WHERE tournoi_id = ? AND (joueur1_id IS NOT NULL OR joueur2_id IS NOT NULL) AND etat != 'annule'`).all(tournoiId); // un seul côté peuplé = qualifié pour ce tour
  const out = {};
  for (const j of db.prepare('SELECT id FROM joueur WHERE tournoi_id = ?').all(tournoiId)) {
    let nivMax = 0;
    for (const m of matchs) {
      if (m.j1 !== j.id && m.j2 !== j.id) continue;
      const niv = m.bracket === 'WB' ? m.tour : m.bracket === 'F' ? k + m.tour : 0;
      if (niv > nivMax) nivMax = niv;
    }
    out[j.id] = nivMax;
  }
  return out;
}

function calculerStats(tournoiId) {
  // un match contre blanc (bye: un côté NULL) ne compte ni comme joué, ni gagné, ni perdu
  const rows = db.prepare(`
    SELECT joueur1_id j1, joueur2_id j2, gagnant_id, etat, started_at, ended_at, bracket, tour
    FROM match WHERE tournoi_id = ? AND etat IN ('termine', 'forfait') AND gagnant_id IS NOT NULL
      AND joueur1_id IS NOT NULL AND joueur2_id IS NOT NULL
  `).all(tournoiId);
  // matchs avec 2 joueurs (pour le calcul des points: dernier tour WB/F + passage en LB)
  const matchsJoues = db.prepare(`SELECT joueur1_id j1, joueur2_id j2, bracket, tour FROM match WHERE tournoi_id = ? AND joueur1_id IS NOT NULL AND joueur2_id IS NOT NULL AND etat != 'annule'`).all(tournoiId);
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
  for (const p of Object.values(parJoueur)) p.pct = p.joues ? Math.round((p.gagnes / p.joues || 0) * 100) : 0;
  const pts = pointsParTournoi(tournoiId);
  for (const p of Object.values(parJoueur)) p.points = pts[p.id] || 0;
  const classement = Object.values(parJoueur).sort((a, b) => (b.points - a.points) || (b.gagnes - a.gagnes) || (b.pct - a.pct) || a.pseudo.localeCompare(b.pseudo));
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
  let matchs = db.prepare(`SELECT * FROM match WHERE tournoi_id = ? ORDER BY CASE bracket WHEN 'WB' THEN 1 WHEN 'LB' THEN 2 ELSE 3 END, tour, position`).all(t.id);
  const distances = distancesMap(t.id);
  const rounds = bracket.listeRounds(t.taille, t.format, t.dko_tours).map(r => ({
    ...r,
    label: bracket.labelRound(r.key, t.taille, t.format, t.dko_tours),
    manches: distances[r.key] || 3,
  }));
  const tables = db.prepare('SELECT * FROM table_billard WHERE tournoi_id = ? ORDER BY numero').all(t.id);
  const champion = t.champion_id ? { id: t.champion_id, pseudo: M.pseudo(t.champion_id) } : null;
  // Tableau « à vide » avant le tirage : la structure complète (câblage identique au futur
  // tirage) est exposée sous forme de matchs VIRTUELS (ids "v1".."vN", virtuel: true),
  // sans aucun joueur et non cliquables côté client. Le tour 1 WB est affiché j1..jN
  // par le front ; le vrai tirage remplace tout ça par les matchs réels.
  let matchsVirtuels = false;
  if (t.statut === 'inscription' && matchs.length === 0) {
    matchsVirtuels = true;
    const structure = bracket.structureBracket(t, distances);
    const idDe = (i) => `v${i + 1}`;
    matchs = structure.map((sm, i) => ({
      id: idDe(i),
      virtuel: true,
      tournoi_id: t.id,
      bracket: sm.bracket,
      tour: sm.tour,
      position: sm.position,
      joueur1: null,
      joueur2: null,
      casseur: null,
      score1: 0,
      score2: 0,
      manches: sm.manches,
      gagnant_id: null,
      gagnant: null,
      etat: 'prevu',
      table: null,
      suivant_id: sm.suivant ? idDe(sm.suivant.vers) : null,
      suivant_slot: sm.suivant ? sm.suivant.slot : null,
      perdant_id: sm.perdant ? idDe(sm.perdant.vers) : null,
      perdant_slot: sm.perdant ? sm.perdant.slot : null,
      started_at: null,
      ended_at: null,
      duree_s: null,
    }));
  }
  return {
    tournoi: t,
    joueurs,
    matchs: matchsVirtuels ? matchs : matchs.map(vueMatch),
    rounds,
    tables,
    champion,
    stats: calculerStats(t.id),
  };
}

function vueTournoiListe(clubId) {
  const sql = `
    SELECT t.*, (SELECT COUNT(*) FROM match WHERE tournoi_id = t.id) nb_matchs,
           (SELECT COUNT(*) FROM joueur WHERE tournoi_id = t.id) nb_joueurs
    FROM tournoi t ${clubId != null ? 'WHERE t.club_id = ?' : ''} ORDER BY t.id DESC
  `;
  const rows = clubId != null ? db.prepare(sql).all(clubId) : db.prepare(sql).all();
  return rows.map(t => ({
    ...t,
    champion: t.champion_id ? M.pseudo(t.champion_id) : null,
  }));
}


// notifie les matchs passés en_cours depuis `avant` (lancement auto)
function notifierAutoLances(tournoiId, avant) {
  const rows = db.prepare("SELECT * FROM match WHERE tournoi_id = ? AND etat = 'en_cours'").all(tournoiId);
  for (const r of rows) {
    if (avant.has(r.id)) continue;
    const m = vueMatch(r);
    if (!m.joueur1 && !m.joueur2) continue;
    push.notifierMatchLance(
      { id: m.id, joueur1_id: m.joueur1 ? m.joueur1.id : null, joueur2_id: m.joueur2 ? m.joueur2.id : null },
      m.joueur1 ? m.joueur1.pseudo : '—', m.joueur2 ? m.joueur2.pseudo : '—', m.table,
      `${m.bracket ? m.bracket.toLowerCase() : ''}${m.tour}-${String(m.position).padStart(3, '0')}`
    );
  }
}

// « revanche » du fil d'accueil : pour chaque paire de joueurs d'un match pas encore terminé,
// + traces « revanche prise / manquée » des matchs TERMINÉS ;
// bilan des confrontations STRICTEMENT antérieures au match, de TOUT l'historique du club (tournoi en cours compris) :
// nombre de duels, victoires de chaque côté, dernière rencontre. Identité historique = pseudo
// (le rattachement compte/inscriptions se fait déjà par pseudo).
function h2hPourMatchs(clubId, matchs) {
  const paires = new Map();
  for (const m of matchs) {
    if (m.virtuel || (m.etat !== 'pret' && m.etat !== 'en_cours' && m.etat !== 'termine' && m.etat !== 'forfait') || !m.joueur1 || !m.joueur2) continue;
    const ps = [m.joueur1.pseudo, m.joueur2.pseudo].sort();
    paires.set(ps[0] + '\u0001' + ps[1], ps);
  }
  const bilans = new Map();
  for (const [k, ps] of paires) {
    bilans.set(k, db.prepare(`
      SELECT m.id, m.joueur1_id, m.joueur2_id, m.gagnant_id, m.score1, m.score2, m.etat, m.ended_at,
             j1.pseudo p1, j2.pseudo p2, t.nom AS duel_tournoi
      FROM match m
      JOIN tournoi t ON t.id = m.tournoi_id
      JOIN joueur j1 ON j1.id = m.joueur1_id
      JOIN joueur j2 ON j2.id = m.joueur2_id
      WHERE (? IS NULL OR t.club_id = ?)
        AND ((j1.pseudo = ? AND j2.pseudo = ?) OR (j1.pseudo = ? AND j2.pseudo = ?))
        AND m.gagnant_id IS NOT NULL
      ORDER BY m.id DESC
    `).all(clubId ?? null, clubId ?? null, ps[0], ps[1], ps[1], ps[0]));
  }
  const gagnantPseudo = (r) => (r.gagnant_id === r.joueur1_id ? r.p1 : r.p2);
  const out = {};
  for (const m of matchs) {
    if (m.virtuel || (m.etat !== 'pret' && m.etat !== 'en_cours' && m.etat !== 'termine' && m.etat !== 'forfait') || !m.joueur1 || !m.joueur2) continue;
    const ps = [m.joueur1.pseudo, m.joueur2.pseudo].sort();
    const rows = (bilans.get(ps[0] + '\u0001' + ps[1]) || []).filter(r => r.id < m.id);   // rencontres STRICTEMENT antérieures : jamais le match lui-même ni un duel postérieur
    const v1 = rows.filter(r => gagnantPseudo(r) === m.joueur1.pseudo).length;
    const d = rows[0];   // ORDER BY m.id DESC : la dernière rencontre d'abord
    out[m.id] = { n: rows.length, v1, v2: rows.length - v1, dernier: d ? {
      gagnant: gagnantPseudo(d),
      score: d.etat === 'forfait' ? 'forfait' : (d.gagnant_id === d.joueur1_id ? `${d.score1}-${d.score2}` : `${d.score2}-${d.score1}`),
      quand: d.ended_at,
      tournoi: d.duel_tournoi,
    } : null };
  }
  return out;
}

// 17j. Personnalisation du club : couleur d accent de l interface + défauts de tournoi (nom, jour récurrent, heure)
// stockés dans club.theme_json (jamais de secret) ; relus et validés à chaque accès (repli sur les valeurs d origine)
// 17k. Logo du club : bibliothèque de prédéfinis servie statiquement (/public/logos, whitelist stricte)
// ou logo importé en data:image (png/jpeg/svg+xml;base64), plafonné côté serveur (garde-fou stockage club.theme_json)
const LOGOS_PRESETS = ['bille-noire', 'bille-8', 'queue', 'triangle', 'table', 'etoile', 'bouclier', 'couronne', 'flamme', 'cercle'];
const LOGO_DATA_RE = /^data:image\/(?:png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/; // jamais text/html ni aucun autre type
const LOGO_TAILLE_MAX = 200000; // caractères (~150 Ko) : un petit logo réduit à 256 px passe très largement
const LOGO_MODES = ['entete', 'filigrane', 'les-deux']; // 17k: où afficher le logo (switch du panneau Apparence)
function logoModeValide(m) { return LOGO_MODES.includes(m); }
// 17n. Identité visuelle du club : bannière de l accueil (réduite à 1600 px) et photo de fond de la page TV (1280 px),
// importées depuis le panneau Apparence, stockées en data:image dans club.theme_json (jamais de secret, aucun prédéfini)
const PHOTO_TAILLE_MAX = 400000; // caractères (~300 Ko) : largement au-dessus d une photo JPEG réduite à 1600/1280 px
const PHOTO_DATA_RE = LOGO_DATA_RE; // mêmes types que le logo (png/jpeg/svg+xml), jamais text/html ni les autres
function photoClubValide(v) { // '' = aucune photo
  if (typeof v !== 'string') return false;
  return v === '' || (v.length <= PHOTO_TAILLE_MAX && PHOTO_DATA_RE.test(v));
}

// 17o. Icône du club sur l écran d accueil du téléphone : PNG (ou JPEG) 192 px généré par le front depuis le logo
// (le SVG y est refusé : Android n affiche pas les icônes vectorielles d un manifeste), stocké dans club.theme_json
const ICONE_TAILLE_MAX = 200000; // caractères : largement au-dessus d un PNG 192 px sur fond uni
const ICONE_DATA_RE = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/; // jamais SVG ni aucun autre type
function iconeClubValide17o(v) { // '' = aucune icône (repli logo raster puis icône générique de l app)
  if (typeof v !== 'string') return false;
  return v === '' || (v.length <= ICONE_TAILLE_MAX && ICONE_DATA_RE.test(v));
}
function logoClubValide(logo) {
  if (typeof logo !== 'string') return false;
  if (logo === '') return true; // aucun logo
  if (logo.startsWith('/logos/')) return logo.endsWith('.svg') && LOGOS_PRESETS.includes(logo.slice('/logos/'.length, -'.svg'.length)); // whitelist stricte
  return logo.length <= LOGO_TAILLE_MAX && LOGO_DATA_RE.test(logo);
}

function themeDuClub(cible) {
  let p = {};
  try { p = cible && cible.theme_json ? (JSON.parse(cible.theme_json) || {}) : {}; } catch (e) { p = {}; }
  if (typeof p !== 'object' || !p) p = {};
  const jour = Number.isInteger(p.defaut_jour) ? p.defaut_jour : null;
  return {
    accent: (typeof p.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.accent)) ? p.accent : '#d6336c',
    defaut_nom: typeof p.defaut_nom === 'string' ? p.defaut_nom : '',
    defaut_jour: (jour !== null && jour >= 0 && jour <= 6) ? jour : null, // 0 = dimanche (convention JS getDay)
    defaut_heure: (typeof p.defaut_heure === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.defaut_heure)) ? p.defaut_heure : '20:00',
    adresse: (typeof p.adresse === 'string') ? p.adresse.trim().slice(0, 200) : '', // 17j v2: adresse par défaut du club (prérenseigne le lieu de création de tournoi)
    logo: (typeof p.logo === 'string' && logoClubValide(p.logo)) ? p.logo : '', // 17k: '' = aucun logo
    logo_mode: logoModeValide(p.logo_mode) ? p.logo_mode : 'les-deux', // 17k: entete / filigrane / les-deux
    banniere: (typeof p.banniere === 'string' && photoClubValide(p.banniere)) ? p.banniere : '', // 17n: bannière de l accueil ('' = aucune)
    tv_fond: (typeof p.tv_fond === 'string' && photoClubValide(p.tv_fond)) ? p.tv_fond : '', // 17n: photo de fond de la TV ('' = décor noir d origine)
    icone: (typeof p.icone === 'string' && iconeClubValide17o(p.icone)) ? p.icone : '', // 17o: PNG 192 px de l app installée sur l écran du téléphone ('' = repli)
    description: (typeof p.description === 'string') ? p.description.trim().slice(0, 500) : '', // 17n: présentation de la page Le club
    contact: (typeof p.contact === 'string') ? p.contact.trim().slice(0, 200) : '', // 17n: contact affiché sur la page Le club
  };
}

function etatGlobal(req) {
  const clubId = req && req.club ? req.club.id : undefined;
  const actif = vueTournoiComplet(tournoiActif(clubId));
  // fil du tournoi (accueil) : confrontations passées des matchs pas terminés (lignes « revanche »)
  if (actif && Array.isArray(actif.matchs)) actif.h2h = h2hPourMatchs(clubId, actif.matchs);
  return {
    actif,
    historique: vueTournoiListe(clubId).filter(t => t.statut === 'termine'),
    club: req && req.club ? { id: req.club.id, slug: req.club.slug, nom: req.club.nom, accent: themeDuClub(req.club).accent } : null,
    auto: getSetting('auto_on') === '1',
    table_pref: getSetting('table_pref') || '',
    tables_reservees: getSetting('tables_reservees') || '',
    reservees_tour: getSetting('reservees_tour') || '',
    compte: req && req.compte ? { id: req.compte.id, pseudo: req.compte.pseudo, role: req.compte.role || 'user' } : null,
  };
}

app.get('/api/etat', (req, res) => {
  const tournoiId = req.query.tournoi_id ? Number(req.query.tournoi_id) : null;
  if (tournoiId) {
    const t = tournoiDuClub(req, tournoiId);
    if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });
    return res.json({ tournoi: vueTournoiComplet(t), historique: vueTournoiListe(req.club.id).filter(x => x.statut === 'termine'), compte: req.compte ? { id: req.compte.id, pseudo: req.compte.pseudo, role: req.compte.role || 'user' } : null });
  }
  res.json(etatGlobal(req));
});

// liste publique des clubs actifs (slug pour ?club= / X-Club)
app.get('/api/clubs', (req, res) => {
  res.json({ clubs: db.prepare('SELECT id, slug, nom FROM club WHERE actif = 1 ORDER BY id').all() });
});

// 17j. personnalisation publique : l accent de l interface du club résolu (léger, sans authentification, pour TOUS les visiteurs)
app.get('/api/club-theme', (req, res) => {
  const th17k = themeDuClub(req.club);
  // 17n: textes courts de la page Le club servis ici (adresse/description/contact) ; les images lourdes (bannière, fond TV)
  // ne passent JAMAIS dans ce payload appelé à chaque page : routes dédiées ci-dessous avec cache navigateur
  res.json({ slug: req.club.slug, nom: req.club.nom, accent: th17k.accent, logo: th17k.logo, logo_mode: th17k.logo_mode, adresse: th17k.adresse, description: th17k.description, contact: th17k.contact }); // 17k: logo public comme l accent, avec son mode d affichage
});

// 17n. Images du club décodées du theme_json et servies en image avec cache navigateur :
// /api/club-banniere (tête de l accueil + page Le club) et /api/club-tv-fond (écran TV), ?club= pris en charge (les <img> ne portent pas X-Club),
// aucune image configurée -> 204 (le front reste sur son décor d origine, pas d erreur visible côté visiteur)
function servirImageClub17n(req, res, champ) {
  const m17n = /^data:image\/(png|jpeg|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/.exec(themeDuClub(req.club)[champ] || '');
  if (!m17n) return res.status(204).end();
  res.setHeader('Content-Type', 'image/' + m17n[1]);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(Buffer.from(m17n[2], 'base64'));
}
app.get('/api/club-banniere', (req, res) => servirImageClub17n(req, res, 'banniere')); // 17n: bannière du club
app.get('/api/club-tv-fond', (req, res) => servirImageClub17n(req, res, 'tv_fond')); // 17n: photo de fond de l écran TV

// 17o. Icône PNG du club pour l écran du téléphone (manifeste dynamique + apple-touch-icon pointent ici) :
// préférence au champ icone (généré par le front à l Enregistrement), repli sur le logo s il est raster
// (data:image png/jpeg : un SVG ne peut pas servir d icône de manifeste), sinon redirection 302 vers l icône générique.
function iconeClub17o(cible) {
  const th17o = themeDuClub(cible);
  const logo17o = typeof th17o.logo === 'string' ? th17o.logo : '';
  const brut17o = (th17o.icone && ICONE_DATA_RE.test(th17o.icone)) ? th17o.icone : ((logo17o.startsWith('data:image/png') || logo17o.startsWith('data:image/jpeg')) ? logo17o : '');
  const m17o = brut17o ? /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(brut17o) : null;
  return m17o ? { type: 'image/' + m17o[1], donnees: Buffer.from(m17o[2], 'base64') } : null;
}
app.get('/api/club-icone', (req, res) => { // 17o: ?club= pris en charge (la requête d un manifeste n envoie pas X-Club)
  const ic17o = iconeClub17o(req.club);
  if (!ic17o) return res.redirect(302, '/icon-192.png'); // pas d icône -> générique de l app (jamais 204 : iOS et Android n aiment pas)
  res.setHeader('Content-Type', ic17o.type);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(ic17o.donnees);
});

// 17q. Écran de lancement (splash) du club : PNG généré à la demande, SANS dépendance (codec maison ci-dessus).
// Fond de la couleur d accent + icône 17o (PNG) centrée à 45 % de la largeur (fusion alpha), repli fond uni.
// Android compose son écran depuis le manifeste (background_color accent), iOS consomme ces images via
// <link rel=apple-touch-startup-image> posés par taille d écran (voir common.js), une seule requête par appareil.
app.get('/api/club-splash', (req, res) => {
  const slug17q = String(req.query.club || '').trim();
  const club17q = slug17q ? (clubParSlug(slug17q) || clubParDefaut()) : clubParDefaut(); // slug inconnu -> club par défaut
  const w17q = Number(req.query.w), h17q = Number(req.query.h);
  if (!Number.isInteger(w17q) || !Number.isInteger(h17q) || w17q < 320 || w17q > 3000 || h17q < 480 || h17q > 3500)
    return res.status(400).json({ error: 'Dimensions invalides (attendu : w entre 320 et 3000, h entre 480 et 3500)' });
  const th17q = themeDuClub(club17q);
  const hex17q = /^#([0-9a-fA-F]{6})$/.exec(String(th17q.accent || ''));
  const fond17q = hex17q ? [parseInt(hex17q[1].slice(0, 2), 16), parseInt(hex17q[1].slice(2, 4), 16), parseInt(hex17q[1].slice(4, 6), 16)] : [230, 59, 122];
  const ic17q = iconeClub17o(club17q);
  const pngSrc17q = ic17q && ic17q.type === 'image/png' ? decoderPng17q(ic17q.donnees) : null; // JPEG : pas de décodeur -> fond seul
  const rgba17q = Buffer.alloc(w17q * h17q * 4);
  for (let i = 0; i < w17q * h17q; i++) { rgba17q[i * 4] = fond17q[0]; rgba17q[i * 4 + 1] = fond17q[1]; rgba17q[i * 4 + 2] = fond17q[2]; rgba17q[i * 4 + 3] = 255; }
  if (pngSrc17q) {
    const cible17q = Math.round(w17q * 0.45);
    const x017q = Math.round((w17q - cible17q) / 2), y017q = Math.round((h17q - cible17q) / 2);
    for (let dy17q = 0; dy17q < cible17q; dy17q++) for (let dx17q = 0; dx17q < cible17q; dx17q++) {
      const sx17q = Math.min(pngSrc17q.w - 1, Math.floor(dx17q * pngSrc17q.w / cible17q));
      const sy17q = Math.min(pngSrc17q.h - 1, Math.floor(dy17q * pngSrc17q.h / cible17q));
      const s17q = (sy17q * pngSrc17q.w + sx17q) * 4;
      const al17q = pngSrc17q.rgba[s17q + 3] / 255;
      const d17q = ((y017q + dy17q) * w17q + x017q + dx17q) * 4;
      rgba17q[d17q] = Math.round(pngSrc17q.rgba[s17q] * al17q + fond17q[0] * (1 - al17q));
      rgba17q[d17q + 1] = Math.round(pngSrc17q.rgba[s17q + 1] * al17q + fond17q[1] * (1 - al17q));
      rgba17q[d17q + 2] = Math.round(pngSrc17q.rgba[s17q + 2] * al17q + fond17q[2] * (1 - al17q));
    }
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(encoderPng17q(w17q, h17q, rgba17q));
});

app.get('/api/tournois', (req, res) => res.json({ tournois: vueTournoiListe(req.club.id) }));

app.get('/api/tournois/:id', (req, res) => {
  const t = tournoiDuClub(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });
  const v = vueTournoiComplet(t);
  v.h2h = h2hPourMatchs(req.club.id, v.matchs);   // fil sans tournoi actif : traces « belle / revanche » aussi sur les matchs terminés
  res.json({ tournoi: v });
});

app.get('/api/stats-joueurs', (req, res) => {
  const rows = db.prepare(`
    SELECT MIN(j.id) id, j.pseudo,
           COUNT(DISTINCT m.id) joues,
           SUM(CASE WHEN m.gagnant_id IS NOT NULL AND (m.joueur1_id = j.id OR m.joueur2_id = j.id) AND m.gagnant_id = j.id THEN 1 ELSE 0 END) gagnes,
           COUNT(DISTINCT t.id) tournois,
           COUNT(DISTINCT CASE WHEN t.champion_id = j.id THEN t.id END) titres
    FROM joueur j
    JOIN tournoi t ON t.id = j.tournoi_id AND t.club_id = ?
    LEFT JOIN match m ON m.tournoi_id = j.tournoi_id AND (m.joueur1_id = j.id OR m.joueur2_id = j.id) AND m.joueur1_id IS NOT NULL AND m.joueur2_id IS NOT NULL AND m.etat IN ('termine', 'forfait') AND m.gagnant_id IS NOT NULL
    GROUP BY LOWER(j.pseudo)
    ORDER BY gagnes DESC, joues DESC
  `).all(req.club.id);
  // points totaux = somme sur tous les tournois (passés inclus)
  const ptsAgg = {}; // par pseudo (un joueur = plusieurs ids, un par tournoi)
  for (const j of db.prepare('SELECT j.id, LOWER(j.pseudo) p FROM joueur j JOIN tournoi t ON t.id = j.tournoi_id AND t.club_id = ?').all(req.club.id)) {
    for (const t of db.prepare('SELECT id FROM tournoi WHERE club_id = ?').all(req.club.id)) {
      const pts = pointsParTournoi(t.id);
      if (pts[j.id]) ptsAgg[j.p] = (ptsAgg[j.p] || 0) + pts[j.id];
    }
  }
  const evAgg = db.prepare(`
    SELECT e.joueur_id,
           SUM(CASE WHEN e.type = 'runout' THEN 1 ELSE 0 END) runouts
    FROM match_event e JOIN match m ON m.id = e.match_id JOIN tournoi t ON t.id = m.tournoi_id AND t.club_id = ?
    GROUP BY e.joueur_id
  `).all(req.club.id).reduce((a, r) => (a[r.joueur_id] = r, a), {});
  // manches gagnées par joueur = somme de ses scores dans ses matchs (évite le double comptage runout+manche)
  const manchesAgg = db.prepare(`
    SELECT m.joueur1_id jid, SUM(m.score1) s FROM match m JOIN tournoi t ON t.id = m.tournoi_id AND t.club_id = ? WHERE m.joueur1_id IS NOT NULL AND m.joueur2_id IS NOT NULL AND m.etat != 'prevu' GROUP BY m.joueur1_id
    UNION ALL
    SELECT m.joueur2_id jid, SUM(m.score2) s FROM match m JOIN tournoi t ON t.id = m.tournoi_id AND t.club_id = ? WHERE m.joueur1_id IS NOT NULL AND m.joueur2_id IS NOT NULL AND m.etat != 'prevu' GROUP BY m.joueur2_id
  `).all(req.club.id, req.club.id).reduce((a, r) => (a[r.jid] = (a[r.jid] || 0) + (r.s || 0), a), {});
  res.json({ joueurs: rows.map(r => ({
    id: r.id,
    pseudo: r.pseudo,
    points: ptsAgg[r.pseudo.toLowerCase()] || 0,
    manches: manchesAgg[r.id] || 0,
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

function codeMatchRow(r) {
  return `${String(r.bracket || '').toLowerCase()}${r.tour}-${String(r.position).padStart(3, '0')}`;
}
function codesLances(tid, avant) {
  return db.prepare("SELECT id, bracket, tour, position FROM match WHERE tournoi_id = ? AND etat = 'en_cours'").all(tid)
    .filter(r => !avant.has(r.id)).map(codeMatchRow);
}

function majEtBroadcast() {
  M.rafraichirPrets();
  for (const c of db.prepare('SELECT id FROM club ORDER BY id').all()) { // auto-lancement par club
    const t = tournoiActif(c.id);
    if (t && t.statut === 'en_cours') {
      const avant = new Set(db.prepare("SELECT id FROM match WHERE tournoi_id = ? AND etat = 'en_cours'").all(t.id).map(r => r.id));
      const lances = M.autoLancer(t.id);
      notifierAutoLances(t.id, avant);
      if (lances > 0) logAudit('auto_lancement', `tournoi ${t.id}`, null, { lances, matchs: codesLances(t.id, avant) }, c.id); // pas de req ici: logAudit direct avec le club
    }
  }
  broadcast('update', { changed: true, at: Date.now() }); // payload léger: le client re-fetch /api/etat
}

app.post('/api/admin/auto', requireAdmin, (req, res) => {
  const on = req.body.on === true || req.body.on === '1' || req.body.on === 1;
  setSetting('auto_on', on ? '1' : '0');
  if (typeof req.body.table_pref === 'string') {
    // ex: "3,4,5,6,7,8,1,2" -> on ne garde que les numéros valides, séparés par des virgules
    const nums = req.body.table_pref.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);
    setSetting('table_pref', [...new Set(nums)].join(','));
  }
  if (typeof req.body.tables_reservees === 'string') {
    const nums = req.body.tables_reservees.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);
    setSetting('tables_reservees', [...new Set(nums)].join(','));
  }
  if (req.body.reservees_tour !== undefined) {
    const n = parseInt(req.body.reservees_tour, 10);
    setSetting('reservees_tour', Number.isInteger(n) && n > 0 ? String(n) : '');
  }
  logAuditReq(req, 'auto_toggle', 'tournoi', null, { on });
  if (on) {
    const t = tournoiActif(req.club.id);
    if (t && t.statut === 'en_cours') {
      const avant = new Set(db.prepare("SELECT id FROM match WHERE tournoi_id = ? AND etat = 'en_cours'").all(t.id).map(r => r.id));
    const lances = M.autoLancer(t.id);
    notifierAutoLances(t.id, avant);
      if (lances > 0) logAuditReq(req, 'auto_lancement', `tournoi ${t.id}`, null, { lances, declencheur: 'activation', matchs: codesLances(t.id, avant) });
    }
  }
  majEtBroadcast();
  res.json({ ok: true, auto: on });
});

app.post('/api/admin/tournoi', requireAdmin, (req, res) => {
  const { nom, regle, taille, format, dko_tours, tetes_de_serie, nb_tables, ajustement_auto, seuil_distance, distance_speciale, date_heure, lieu } = req.body;
  const actif = tournoiActif(req.club.id);
  if (actif) return res.status(409).json({ error: `Un tournoi est encore actif (${actif.nom}). Terminez-le ou supprimez-le d'abord.`, actif_id: actif.id });
  if (!['blackball', 'ultimate'].includes(regle)) return res.status(400).json({ error: 'Règle invalide' });
  if (![16, 32, 64, 128].includes(Number(taille))) return res.status(400).json({ error: 'Taille invalide (max)'});
  if (!['simple', 'double'].includes(format)) return res.status(400).json({ error: 'Format invalide' });
  const k = format === 'double' ? Math.min(3, Math.max(1, Number(dko_tours) || 1)) : 0;
  const seuil = ['jamais', 'quarts', 'demis', 'finale'].includes(seuil_distance) ? seuil_distance : 'jamais';
  const distSpe = [3, 5, 7].includes(Number(distance_speciale)) ? Number(distance_speciale) : 3;
  const dateH = (typeof date_heure === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(date_heure)) ? date_heure.replace('T', ' ').slice(0, 16) : bracket.prochainMardi20h();
  const th17j = themeDuClub(req.club); // 17j v2: repli sur l adresse par défaut du club si définie, sinon Le 147 (comportement d origine)
  const lieuT = (typeof lieu === 'string' && lieu.trim()) ? lieu.trim().slice(0, 200) : (th17j.adresse || 'Le 147, 12 Rue des Amidonniers 31000 Toulouse');
  const info = db.prepare(`
    INSERT INTO tournoi (club_id, nom, regle, taille, format, dko_tours, tetes_de_serie, nb_tables, ajustement_auto, seuil_distance, distance_speciale, date_heure, lieu, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inscription')
  `).run(req.club.id, nom || 'Tournoi', regle, Number(taille), format, k, tetes_de_serie ? 1 : 0, Math.max(1, Number(nb_tables) || 8), ajustement_auto === false ? 0 : 1, seuil, distSpe, dateH, lieuT);
  const t = db.prepare('SELECT * FROM tournoi WHERE id = ?').get(Number(info.lastInsertRowid));
  for (let i = 1; i <= t.nb_tables; i++) {
    db.prepare('INSERT INTO table_billard (tournoi_id, numero) VALUES (?, ?)').run(t.id, i);
  }
  const rounds = bracket.listeRounds(t.taille, t.format, t.dko_tours);
  const def = bracket.manchesDefaut(rounds, t.seuil_distance, t.distance_speciale);
  const ins = db.prepare('INSERT INTO distance_round (tournoi_id, round, manches) VALUES (?, ?, ?)');
  for (const r of rounds) ins.run(t.id, r.key, def[r.key]);
  logAuditReq(req, 'creation_tournoi', `tournoi ${t.id}`, null, req.body);
  // notif push à tous les abonnés : inscriptions ouvertes (switch de la table de marque, actif par défaut)
  if (req.body.notif_push !== false) {
    try {
      push.envoyerTous({
        title: '🎱 Nouveau tournoi — inscriptions ouvertes',
        body: `« ${t.nom} » · ${t.regle === 'blackball' ? 'Blackball' : 'Ultimate'} · ${t.taille} joueurs · ${dateH}`,
        url: '/',
        tag: 'tournoi-' + t.id,
      }, req.club.id, { // versions traduites pour les comptes selon leur langue (compte.lang)
        en: {
          title: '🎱 New tournament — registration open',
          body: `"${t.nom}" · ${t.regle === 'blackball' ? 'Blackball' : 'Ultimate'} · ${t.taille} players · ${dateH}`,
          url: '/',
          tag: 'tournoi-' + t.id,
        },
        es: {
          title: '🎱 Nuevo torneo — inscripciones abiertas',
          body: `« ${t.nom} » · ${t.regle === 'blackball' ? 'Blackball' : 'Ultimate'} · ${t.taille} jugadores · ${dateH}`,
          url: '/',
          tag: 'tournoi-' + t.id,
        },
        it: {
          title: '🎱 Nuovo torneo — iscrizioni aperte',
          body: `« ${t.nom} » · ${t.regle === 'blackball' ? 'Blackball' : 'Ultimate'} · ${t.taille} giocatori · ${dateH}`,
          url: '/',
          tag: 'tournoi-' + t.id,
        },
        de: {
          title: '🎱 Neues Turnier — Anmeldung offen',
          body: `« ${t.nom} » · ${t.regle === 'blackball' ? 'Blackball' : 'Ultimate'} · ${t.taille} Spieler · ${dateH}`,
          url: '/',
          tag: 'tournoi-' + t.id,
        },
      }).catch(() => {}); // push scopé au club courant
    } catch {}
  }
  majEtBroadcast();
  res.json({ ok: true, ...etatGlobal(req) });
});

app.delete('/api/admin/tournoi', requireAdmin, requireConfirmPin, (req, res) => {
  const id = (tournoiActif(req.club.id) || {}).id;
  if (!id) return res.status(404).json({ error: 'Aucun tournoi' });
  const t = db.prepare('SELECT * FROM tournoi WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });
  db.prepare('UPDATE tournoi SET champion_id = NULL WHERE id = ?').run(id);
  db.prepare('DELETE FROM match_event WHERE match_id IN (SELECT id FROM match WHERE tournoi_id = ?)').run(id);
  db.prepare('DELETE FROM match WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM joueur WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM table_billard WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM distance_round WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM audit_snapshot WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM tournoi WHERE id = ?').run(id);
  logAuditReq(req, 'suppression_tournoi', `tournoi ${id}`, { nom: t.nom, statut: t.statut }, null);
  majEtBroadcast();
  res.json({ ok: true });
});

app.delete('/api/admin/tournoi/:id', requireAdmin, requireConfirmPin, (req, res) => {
  const id = Number(req.params.id);
  const t = tournoiDuClub(req, id); // isolation multi-club: un autre club -> 404
  if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });
  db.prepare('UPDATE tournoi SET champion_id = NULL WHERE id = ?').run(id);
  db.prepare('DELETE FROM match_event WHERE match_id IN (SELECT id FROM match WHERE tournoi_id = ?)').run(id);
  db.prepare('DELETE FROM match WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM joueur WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM table_billard WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM distance_round WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM audit_snapshot WHERE tournoi_id = ?').run(id);
  db.prepare('DELETE FROM tournoi WHERE id = ?').run(id);
  logAuditReq(req, 'suppression_tournoi', `tournoi ${id}`, { nom: t.nom, statut: t.statut }, null);
  majEtBroadcast();
  res.json({ ok: true });
});

app.put('/api/admin/tournoi', requireAdmin, (req, res) => {
  const t = tournoiActif(req.club.id);
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
  logAuditReq(req, 'maj_tournoi', `tournoi ${t.id}`, null, req.body);
  majEtBroadcast();
  res.json({ ok: true, ...etatGlobal(req) });
});

app.put('/api/admin/distances', requireAdmin, (req, res) => {
  const t = tournoiActif(req.club.id);
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
  logAuditReq(req, 'maj_distances', `tournoi ${t.id}`, { statut: t.statut }, distances);
  majEtBroadcast();
  res.json({ ok: true });
});

app.post('/api/admin/joueur', requireAdmin, (req, res) => {
  const t = tournoiActif(req.club.id);
  if (!t) return res.status(404).json({ error: 'Aucun tournoi ouvert aux inscriptions (le précédent doit être terminé et le prochain créé)' });
  if (t.statut !== 'inscription') return res.status(409).json({ error: 'Inscriptions closes : le tournoi en cours n\'est pas terminé' });
  const pseudo = cleanPseudo(req.body.pseudo, 40);
  if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' });
  const count = db.prepare('SELECT COUNT(*) c FROM joueur WHERE tournoi_id = ?').get(t.id).c;
  if (count >= t.taille) return res.status(409).json({ error: `Tableau complet (${t.taille} joueurs max)` });
  let tds = null;
  if (t.tetes_de_serie && req.body.tete_de_serie != null && req.body.tete_de_serie !== '') {
    tds = Number(req.body.tete_de_serie);
  }
  // pseudo d'un compte = réservé: confirmation explicite requise (l'UI admin demande, puis renvoie confirme=true)
  const cReserve = compteAvecPseudo(pseudo, req.club && req.club.id);
  if (cReserve && !req.body.confirme) {
    return res.status(409).json({ error: `Un compte existe déjà avec le pseudo « ${pseudo} » — inscrire quand même ce joueur à la place du titulaire ?`, compte_pseudo: true });
  }
  try {
    const info = db.prepare('INSERT INTO joueur (tournoi_id, pseudo, tete_de_serie) VALUES (?, ?, ?)').run(t.id, pseudo, tds);
    // admin a confirmé: on rattache le joueur au compte (notifs « à toi de jouer » et amis fonctionnent)
    if (cReserve) db.prepare('UPDATE joueur SET compte_id = ? WHERE id = ?').run(cReserve.id, info.lastInsertRowid);
    logAuditReq(req, 'inscription', `joueur ${info.lastInsertRowid}`, null, { pseudo, tds, rattache_compte: cReserve ? cReserve.id : null });
    // push « inscription d'un ami » aux comptes qui ont ce compte en ami ou suivent ce pseudo (même comportement que /api/joueur et /api/tournoi/inscrire)
    try { push.notifierInscriptionAmi(cReserve ? cReserve.id : null, pseudo, t.nom, req.club.id); } catch (e) { console.error('[PUSH] notifierInscriptionAmi:', e.message); }
    majEtBroadcast();
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Pseudo déjà pris' });
    throw e;
  }
});

app.post('/api/admin/joueurs/simulation', requireAdmin, (req, res) => {
  const t = tournoiActif(req.club.id);
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
  const existeCompte = db.prepare('SELECT 1 FROM compte WHERE pseudo = ? COLLATE NOCASE'); // pseudo d'un compte = réservé
  while (crees.length < n) {
    const pseudo = `${prefix}${String(k).padStart(2, '0')}`;
    if (!existe.get(t.id, pseudo) && !existeCompte.get(pseudo)) {
      const info = ins.run(t.id, pseudo, 'paye');
      crees.push({ id: Number(info.lastInsertRowid), pseudo });
    }
    k++;
    if (k > 999) break;
  }
  logAuditReq(req, 'simulation_joueurs', `tournoi ${t.id}`, null, { prefix, demandes: count, crees: crees.length, statut: 'paye' });
  majEtBroadcast();
  res.json({ ok: true, crees: crees.length, joueurs: crees });
});

app.post('/api/joueur', (req, res) => {
  const t = tournoiActif(req.club.id);
  if (!t) return res.status(404).json({ error: 'Aucun tournoi ouvert aux inscriptions — attendez que le tournoi en cours soit terminé et que le prochain soit créé' });
  if (t.statut !== 'inscription') return res.status(409).json({ error: 'Inscriptions closes : le tournoi en cours n\'est pas terminé' });
  const pseudo = cleanPseudo(req.body.pseudo, 40);
  if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' });
  // compte connecté : l'inscription anonyme n'est pas proposée (l'accueil n'affiche plus le champ pseudo),
  // le joueur passe par son compte (bouton « M'inscrire » -> /api/tournoi/inscrire)
  if (req.compte) {
    return res.status(409).json({ error: 'Compte connecté : inscris-toi avec le bouton « M\'inscrire » de ton compte', compte_connecte: true });
  }
  // pseudo d'un compte = réservé (anti-usurpation): l'inscription anonyme est refusée, le titulaire doit se connecter
  if (compteAvecPseudo(pseudo, req.club && req.club.id)) {
    return res.status(409).json({ error: 'Ce pseudo appartient à un compte : connecte-toi pour t\'inscrire, ou choisis un autre pseudo', compte_pseudo: true });
  }
  const count = db.prepare('SELECT COUNT(*) c FROM joueur WHERE tournoi_id = ?').get(t.id).c;
  if (count >= t.taille) return res.status(409).json({ error: `Tableau complet (${t.taille} joueurs max)` });
  try {
    const info = db.prepare('INSERT INTO joueur (tournoi_id, pseudo) VALUES (?, ?)').run(t.id, pseudo);
    logAuditReq(req, 'inscription_publique', `joueur ${info.lastInsertRowid}`, null, { pseudo });
    // push « inscription d'un ami » aux comptes qui suivent ce pseudo (ami sans compte)
    try { push.notifierInscriptionAmi(null, pseudo, t.nom, req.club.id); } catch (e) { console.error('[PUSH] notifierInscriptionAmi (pseudo):', e.message); }
    majEtBroadcast();
    res.json({ ok: true, id: Number(info.lastInsertRowid), pseudo });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Pseudo déjà pris' });
    throw e;
  }
});

app.delete('/api/admin/joueur/:id', requireAdmin, (req, res) => { // désinscription: pas de re-confirmation PIN (routine, phase inscription uniquement)
  const t = tournoiActif(req.club.id);
  if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
  if (t.statut !== 'inscription') return res.status(409).json({ error: 'Tournoi lancé' });
  const j = joueurDuClub(req, req.params.id);
  if (!j || j.tournoi_id !== t.id) return res.status(404).json({ error: 'Joueur introuvable' });
  db.prepare('DELETE FROM joueur WHERE id = ?').run(j.id);
  logAuditReq(req, 'desinscription', `joueur ${j.id}`, { pseudo: j.pseudo }, null);
  majEtBroadcast();
  res.json({ ok: true });
});

app.put('/api/admin/joueur/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const j = joueurDuClub(req, id);
  if (!j) return res.status(404).json({ error: 'Joueur introuvable' });
  const pseudo = cleanPseudo(req.body.pseudo, 40);
  if (pseudo.length >= 2) {
    const pris = db.prepare('SELECT id FROM joueur WHERE tournoi_id = ? AND pseudo = ? COLLATE NOCASE AND id != ?').get(j.tournoi_id, pseudo, id);
    if (pris) return res.status(409).json({ error: 'Pseudo déjà pris dans ce tournoi' });
    // pseudo d'un compte = réservé (sauf si le joueur est déjà rattaché à CE compte: alignement de pseudo autorisé)
    const cReserve = compteAvecPseudo(pseudo, req.club && req.club.id);
    if (cReserve && cReserve.id !== j.compte_id) {
      return res.status(409).json({ error: `Le pseudo « ${pseudo} » appartient à un compte (pseudo réservé)`, compte_pseudo: true });
    }
    db.prepare('UPDATE joueur SET pseudo = ? WHERE id = ?').run(pseudo, id);
  }
  if (req.body.statut === 'paye' || req.body.statut === 'inscrit' || req.body.statut === 'absent') {
    db.prepare('UPDATE joueur SET statut = ? WHERE id = ?').run(req.body.statut, id);
  }
  logAuditReq(req, 'joueur_edite', `joueur #${id}`, j.tournoi_id, { pseudo });
  majEtBroadcast();
  res.json({ ok: true, joueur: db.prepare('SELECT * FROM joueur WHERE id = ?').get(id) });
});

app.post('/api/admin/joueur/:id/paiement', requireAdmin, (req, res) => {
  const t = tournoiActif(req.club.id);
  if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
  if (t.statut !== 'inscription') return res.status(409).json({ error: 'Tournoi lancé' });
  const j = joueurDuClub(req, req.params.id);
  if (!j || j.tournoi_id !== t.id) return res.status(404).json({ error: 'Joueur introuvable' });
  const nouveau = req.body.statut === 'paye' ? 'paye' : 'en_attente';
  db.prepare('UPDATE joueur SET statut = ? WHERE id = ?').run(nouveau, j.id);
  logAuditReq(req, 'paiement', `joueur ${j.id}`, { statut: j.statut }, { statut: nouveau, pseudo: j.pseudo });
  majEtBroadcast();
  res.json({ ok: true });
});

app.post('/api/admin/tirage', requireAdmin, (req, res) => {
  const t = tournoiActif(req.club.id);
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
      logAuditReq(req, 'ajustement_taille', `tournoi ${t.id}`, { taille_max: t.taille }, { taille_effective: tailleEff, nb_payes: joueurs.length });
      Object.assign(t, { taille: tailleEff });
    }
  }
  const manchesMap = distancesMap(t.id);
  // Tirage VRAIMENT aléatoire (crypto), pas Math.random prévisible
  const rngCrypto = () => crypto.randomInt(0, 2 ** 31) / 2 ** 31;
  bracket.genererBracket(t, joueurs, manchesMap, rngCrypto);
  db.prepare(`UPDATE tournoi SET statut = 'en_cours' WHERE id = ?`).run(t.id);
  logAuditReq(req, 'tirage', `tournoi ${t.id}`, { nb_joueurs: joueurs.length }, null);
  majEtBroadcast();
  res.json({ ok: true, ...etatGlobal(req) });
});

app.post('/api/admin/match/:id/lancer', requireAdmin, (req, res) => {
  if (!matchDuClub(req, req.params.id)) return res.status(404).json({ error: "Match introuvable" }); // isolation club
  const tableId = req.body.table_id != null ? Number(req.body.table_id) : null;
  const m = M.lancerMatch(Number(req.params.id), tableId);
  const p1 = m.joueur1_id ? M.pseudo(m.joueur1_id) : 'blanc';
  const p2 = m.joueur2_id ? M.pseudo(m.joueur2_id) : 'blanc';
  logAuditReq(req, 'lancement_match', `${codeMatchRow(m)} — ${p1} vs ${p2}`, null, { table: m.table_id ? M.tableNumero(m.table_id) : null });
  majEtBroadcast();
  // notif push "à toi de jouer" (fire and forget)
  try {
    const mm = vueMatch(m);
    if (mm.etat === 'en_cours' && (mm.joueur1 || mm.joueur2)) {
      push.notifierMatchLance(
        { id: mm.id, joueur1_id: mm.joueur1 ? mm.joueur1.id : null, joueur2_id: mm.joueur2 ? mm.joueur2.id : null },
        mm.joueur1 ? mm.joueur1.pseudo : '—', mm.joueur2 ? mm.joueur2.pseudo : '—', mm.table,
        `${mm.bracket ? mm.bracket.toLowerCase() : ''}${mm.tour}-${String(mm.position).padStart(3, '0')}`
      );
    }
  } catch (e) { console.error('[PUSH]', e.message); }
  res.json({ ok: true, match: vueMatch(m) });
});



app.post('/api/admin/match/:id/joueurs', requireAdmin, (req, res) => {
  if (!matchDuClub(req, req.params.id)) return res.status(404).json({ error: "Match introuvable" }); // isolation club
  const j1 = req.body.joueur1_id == null || req.body.joueur1_id === '' ? null : Number(req.body.joueur1_id);
  const j2 = req.body.joueur2_id == null || req.body.joueur2_id === '' ? null : Number(req.body.joueur2_id);
  const m = M.setJoueursAdmin(Number(req.params.id), j1, j2);
  logAuditReq(req, 'match_joueurs_change', `match #${req.params.id} -> j1=${j1} j2=${j2}`, null, {});
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.post('/api/admin/match/:id/table', requireAdmin, (req, res) => {
  if (!matchDuClub(req, req.params.id)) return res.status(404).json({ error: "Match introuvable" }); // isolation club
  const m = M.setTableAdmin(Number(req.params.id), req.body.table_id == null ? null : Number(req.body.table_id));
  logAuditReq(req, 'match_table_change', `match #${req.params.id} -> table ${req.body.table_id}`, null, {});
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.post('/api/admin/match/:id/correction', requireAdmin, (req, res) => {
  if (!matchDuClub(req, req.params.id)) return res.status(404).json({ error: "Match introuvable" }); // isolation club
  const { score1, score2, manches, motif } = req.body;
  const m = M.corrigerScore(Number(req.params.id), Number(score1) || 0, Number(score2) || 0, Number(manches) || 3, motif || '', auteurAdmin(req));
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.post('/api/admin/match/:id/rouvrir', requireAdmin, (req, res) => {
  if (!matchDuClub(req, req.params.id)) return res.status(404).json({ error: "Match introuvable" }); // isolation club
  const m = M.rouvrirMatch(Number(req.params.id));
  logAuditReq(req, 'rouvrir_match', `match ${m.id}`, null, { etat: 'en_cours' });
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.post('/api/admin/match/:id/forfait', requireAdmin, (req, res) => {
  const mid = Number(req.params.id);
  const m0 = matchDuClub(req, mid);
  if (!m0) return res.status(404).json({ error: "Match introuvable" }); // isolation club
  const jid = Number(req.body.joueur_id);
  if (!jid || (m0.joueur1_id !== jid && m0.joueur2_id !== jid)) {
    return res.status(400).json({ error: 'joueur_id requis (doit être l\'un des 2 joueurs du match)' });
  }
  const m = M.declarerForfait(mid, jid, auteurAdmin(req));
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.post('/api/admin/terminer', requireAdmin, (req, res) => {
  const t = tournoiActif(req.club.id);
  if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
  if (t.statut === 'termine') return res.status(409).json({ error: 'Tournoi déjà terminé' });
  // arrêt manuel = coupe net: champion UNIQUEMENT si explicitement choisi (pas de fallback auto)
  const championId = req.body.champion_id ? Number(req.body.champion_id) : null;
  db.prepare(`UPDATE tournoi SET statut = 'termine', champion_id = ? WHERE id = ?`).run(championId, t.id);
  db.prepare(`UPDATE match SET etat = 'termine', ended_at = COALESCE(ended_at, datetime('now')), updated_at = datetime('now') WHERE tournoi_id = ? AND etat IN ('prevu', 'pret', 'en_cours')`).run(t.id);
  logAuditReq(req, 'tournoi_termine_manuellement', `tournoi ${t.id}`, { statut: t.statut }, { champion_id: championId });
  majEtBroadcast();
  res.json({ ok: true, ...etatGlobal(req) });
});

app.post('/api/admin/push-test-ami', requireAdmin, async (req, res) => {
  const { envoyerTestAmi } = require('./push');
  const r = await envoyerTestAmi(Number(req.body.joueur_id));
  if (r.error) return res.status(404).json(r);
  res.json({ ok: true, ...r });
});

// Rappel push « inscriptions ouvertes » : réservé aux admins, uniquement tant que le tournoi actif est en phase inscription
app.post('/api/admin/tournoi/rappel-inscriptions', requireAdmin, async (req, res) => {
  const t = tournoiActif(req.club.id);
  if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
  if (t.statut !== 'inscription') return res.status(409).json({ error: 'Les inscriptions ne sont pas ouvertes (tirage déjà effectué)' });
  const inscrits = db.prepare('SELECT COUNT(*) AS c FROM joueur WHERE tournoi_id = ?').get(t.id).c;
  const dateH = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(t.date_heure || '') ? t.date_heure.replace('T', ' ').slice(0, 16) : bracket.prochainMardi20h();
  const envoyes = await push.envoyerTous({
    title: '🎱 Rappel — inscriptions ouvertes',
    body: `« ${t.nom} » · ${inscrits}/${t.taille} inscrits · ${dateH}`,
    url: '/',
    tag: 'tournoi-' + t.id, // même tag que la notif de création : le rappel remplace la précédente au lieu de s'empiler
  }, req.club.id, { // versions traduites pour les comptes selon leur langue (compte.lang)
    en: {
      title: '🎱 Reminder — registration open',
      body: `"${t.nom}" · ${inscrits}/${t.taille} signed up · ${dateH}`,
      url: '/',
      tag: 'tournoi-' + t.id, // même tag que la notif de création : le rappel remplace la précédente au lieu de s'empiler
    },
    es: {
      title: '🎱 Recordatorio — inscripciones abiertas',
      body: `« ${t.nom} » · ${inscrits}/${t.taille} inscritos · ${dateH}`,
      url: '/',
      tag: 'tournoi-' + t.id,
    },
    it: {
      title: '🎱 Promemoria — iscrizioni aperte',
      body: `« ${t.nom} » · ${inscrits}/${t.taille} iscritti · ${dateH}`,
      url: '/',
      tag: 'tournoi-' + t.id,
    },
    de: {
      title: '🎱 Erinnerung — Anmeldung offen',
      body: `« ${t.nom} » · ${inscrits}/${t.taille} eingeschrieben · ${dateH}`,
      url: '/',
      tag: 'tournoi-' + t.id,
    },
  }).catch(() => 0);
  logAuditReq(req, 'rappel_inscriptions', `tournoi ${t.id}`, null, { envoyes });
  res.json({ ok: true, envoyes });
});

app.post('/api/admin/simuler', requireAdmin, (req, res) => {
  const t = tournoiActif(req.club.id);
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
    if (m.casseur_id == null) M.setBande(m.id, m.joueur1_id); // tirage à la bande requis avant toute saisie
    const gagnant = Math.random() < 0.5 ? m.joueur1_id : m.joueur2_id;
    for (let i = 0; i < m.manches; i++) M.declarerManche(m.id, gagnant);
    joues++;
  }
  const final = db.prepare('SELECT * FROM tournoi WHERE id = ?').get(t.id);
  logAuditReq(req, 'simulation_tournoi', `tournoi ${t.id}`, null, { matchs_joues: joues, statut: final.statut, champion_id: final.champion_id });
  majEtBroadcast();
  res.json({ ok: true, matchs_joues: joues, statut: final.statut, champion: final.champion_id ? M.pseudo(final.champion_id) : null });
});

// ---- Gestion des comptes joueurs (admin) ----
// un compte compte comme « du club courant » s il a un rôle sur le club ou un joueur
// inscrit dans un tournoi du club (les comptes restent globaux à la plateforme)
function comptePresentClub(clubId, compteId) { // 17f: un compte appartient désormais à UN club (compte.club_id)
  return !!(db.prepare('SELECT 1 FROM compte WHERE id = ? AND club_id = ?').get(compteId, clubId)
    || db.prepare('SELECT 1 FROM compte_club WHERE compte_id = ? AND club_id = ?').get(compteId, clubId)
    || db.prepare('SELECT 1 FROM joueur j JOIN tournoi t ON t.id = j.tournoi_id WHERE j.compte_id = ? AND t.club_id = ?').get(compteId, clubId));
}
// super-admin: tous les comptes. Session de club: uniquement les comptes de son club (404 sinon)
function requireGestionCompte(req, res, next) {
  if (superAdminSoumis(req)) return next();
  if (comptePresentClub(req.club.id, Number(req.params.id))) return next();
  return res.status(404).json({ error: 'Compte introuvable' });
}
// 17h: la table de marque est TOUJOURS scopée au club du contexte, MÊME pour le super-admin
// (le tenant principal ne voit plus les comptes des autres clubs). La vue « tous les clubs »
// est explicite: GET ?tous=1, réservée au super-admin (page Clubs, interface plateforme).
app.get('/api/admin/comptes', requireAdmin, (req, res) => {
  const cid = req.club ? req.club.id : clubParDefaut().id;
  const tous = superAdminSoumis(req) && String(req.query.tous || '') === '1'; // 17h: vue plateforme explicite
  const where = tous ? '' : `
      WHERE c.club_id = ? OR EXISTS (SELECT 1 FROM compte_club cc WHERE cc.compte_id = c.id AND cc.club_id = ?)`; // 17f: comptes DU club + roles staff
  const colTous = tous
    ? `,
           (SELECT cl.slug FROM club cl WHERE cl.id = c.club_id) club_slug,
           (SELECT group_concat(cl.slug || ':' || cc.role, ', ') FROM compte_club cc JOIN club cl ON cl.id = cc.club_id WHERE cc.compte_id = c.id) roles_clubs`
    : ''; // 17h: club d'origine + rôles club agrégés (« slug:role ») en vue tous-clubs
  const rows = db.prepare(`
    SELECT c.id, c.pseudo, c.email, c.role, c.created_at,
           (SELECT COUNT(*) FROM session s WHERE s.compte_id = c.id) sessions,
           c.last_login_at,
           (SELECT COUNT(*) FROM joueur j WHERE j.compte_id = c.id) joueurs,
           (SELECT COUNT(*) FROM match m WHERE m.joueur1_id IN (SELECT id FROM joueur WHERE compte_id = c.id) OR m.joueur2_id IN (SELECT id FROM joueur WHERE compte_id = c.id)) matchs,
           (SELECT COUNT(*) FROM push_subscription ps WHERE ps.compte_id = c.id AND ps.club_id = ?) push_abonnements,
           c.club_id,
           (SELECT cc.role FROM compte_club cc WHERE cc.compte_id = c.id AND cc.club_id = ?) role_club${colTous},
           (SELECT group_concat(c2.pseudo, ', ') FROM ami a JOIN compte c2 ON c2.id = a.ami_compte_id WHERE a.compte_id = c.id) amis_comptes,
           (SELECT group_concat(p.pseudo, ', ') FROM ami_pseudo p WHERE p.compte_id = c.id) amis_pseudos
    FROM compte c${where}
    ORDER BY c.id DESC
  `).all(cid, cid, ...(tous ? [] : [cid, cid]));
  // 17g: rôle club du contexte + autorisation de gérer les rôles (table de marque: sélecteur par compte)
  res.json({
    comptes: rows,
    club: req.club ? { id: req.club.id, slug: req.club.slug, nom: req.club.nom } : null,
    peut_gerer_roles: superAdminSoumis(req) || roleClubSession(req) === 'admin' || req.adminViaPin === 'club',
    tous, // 17h: la vue « tous les clubs » est-elle active (super-admin explicite uniquement)
  });
});

app.post('/api/admin/compte/:id/pseudo', requireAdmin, requireGestionCompte, (req, res) => {
  try {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT id FROM compte WHERE id = ?').get(id);
    if (!c) return res.status(404).json({ error: 'Compte introuvable' });
    const p = comptes.setPseudoAdmin(id, req.body.pseudo);
    logAuditReq(req, 'compte_pseudo_change', `compte #${id} -> ${p}`, null, {});
    res.json({ ok: true, pseudo: p });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// rôle GLOBAL d'un compte (user/admin): réglage plateforme, super-admin uniquement.
// Les rôles de club (admin/operateur d un club) se gèrent via /api/admin/club/compte.
function handlerRoleGlobal(req, res) {
  const role = req.body && req.body.role;
  if (!['admin', 'user', 'super_admin'].includes(role)) return res.status(400).json({ error: "role invalide ('admin', 'user' ou 'super_admin')" });
  const id = Number(req.params.id);
  const c = db.prepare('SELECT id, pseudo, role FROM compte WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Compte introuvable' });
  db.prepare('UPDATE compte SET role = ? WHERE id = ?').run(role, id);
  logAuditReq(req, 'compte_role_change', `compte #${id} (${c.pseudo}) -> ${role}`, { role: c.role }, { role });
  majEtBroadcast();
  res.json({ ok: true, id, role });
}
app.post('/api/admin/compte/:id/role', requireAdmin, requireSuperAdmin, handlerRoleGlobal);

app.post('/api/admin/compte/:id/password', requireAdmin, requireGestionCompte, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM compte WHERE id = ?').get(id)) return res.status(404).json({ error: 'Compte introuvable' });
    comptes.setPasswordAdmin(id, req.body.password);
    logAuditReq(req, 'compte_mdp_change', `compte #${id}`, null, {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/admin/compte/:id', requireAdmin, requireGestionCompte, requireConfirmPin, (req, res) => {
  const id = Number(req.params.id);
  const c = comptes.supprimerCompte(id);
  if (!c) return res.status(404).json({ error: 'Compte introuvable' });
  logAuditReq(req, 'compte_supprime', `compte ${c.pseudo}`, null, { id });
  res.json({ ok: true });
});

app.get('/api/admin/match/:id/events', requireAdmin, (req, res) => {
  if (!matchDuClub(req, req.params.id)) return res.status(404).json({ error: "Match introuvable" }); // isolation club
  res.json({ events: M.listerEvents(Number(req.params.id)) });
});
app.delete('/api/admin/match/:id/event/:eventId', requireAdmin, requireConfirmPin, (req, res) => {
  if (!matchDuClub(req, req.params.id)) return res.status(404).json({ error: "Match introuvable" }); // isolation club
  const m = M.supprimerEventAdmin(Number(req.params.id), Number(req.params.eventId));
  logAuditReq(req, 'event_supprime', `match #${req.params.id} event #${req.params.eventId}`, null, {});
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.delete('/api/admin/audit', requireAdmin, requireConfirmPin, (req, res) => {
  const info = db.prepare('DELETE FROM audit_log WHERE club_id = ?').run(req.club.id); // vidage scopé au club
  logAuditReq(req, 'audit_purge', 'journal vidé', null, { supprimes: info.changes });
  res.json({ ok: true, supprimes: info.changes });
});

app.get('/api/admin/audit', requireAdmin, (req, res) => {
  // filtres optionnels: ?q= (texte dans action/cible/avant/apres) et ?action= (action exacte) — journal scopé au club courant
  const q = String(req.query.q || '').trim().slice(0, 80);
  const action = String(req.query.action || '').trim().slice(0, 60);
  let sql = `SELECT a.*, EXISTS(SELECT 1 FROM audit_snapshot s WHERE s.audit_id = a.id) AS has_snapshot FROM audit_log a`;
  const where = ['a.club_id = ?'], params = [req.club.id];
  if (q) { where.push('(a.action LIKE ? OR a.cible LIKE ? OR a.avant LIKE ? OR a.apres LIKE ?)'); const like = `%${q}%`; params.push(like, like, like, like); }
  if (action) { where.push('a.action = ?'); params.push(action); }
  sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY a.id DESC LIMIT 500';
  res.json({ audit: db.prepare(sql).all(...params), q, action });
});

// ---------- Multi-club: gestion des clubs (réservé admin global/super-admin pour l'instant) ----------
// super-admin uniquement (code global OU session admin globale): liste complète et création des clubs.
// un compte de club (admin comme operateur) ou le seul PIN d'un club ne doivent pas gérer les clubs.
function requireSuperAdmin(req, res, next) {
  if (superAdminSoumis(req)) return next();
  return res.status(403).json({ error: 'Gestion des clubs réservée au super-admin (code global ou compte admin global)' });
}
// le front s'en sert pour ne proposer le menu Clubs qu aux super-admins (jamais aux comptes de club)
app.get('/api/admin/super', requireAdmin, (req, res) => {
  res.json({ super_admin: superAdminSoumis(req), via: req.adminVia });
});

function handlerCreateClub(req, res) {
  const slug = String(req.body.slug || '').trim().toLowerCase();
  const nom = String(req.body.nom || '').trim().slice(0, 80);
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(slug)) return res.status(400).json({ error: 'slug invalide (2-30 car. a-z 0-9 -)' });
  if (!nom) return res.status(400).json({ error: 'nom requis' });
  if (clubParSlug(slug)) return res.status(409).json({ error: `slug « ${slug} » déjà pris` });
  const pinHash = req.body.pin ? crypto.createHash('sha256').update(String(req.body.pin)).digest('hex') : null;
  const info = db.prepare('INSERT INTO club (slug, nom, pin_hash) VALUES (?, ?, ?)').run(slug, nom, pinHash);
  logAuditReq(req, 'club_cree', `club ${slug}`, null, { nom });
  res.json({ ok: true, club: db.prepare('SELECT id, slug, nom, actif FROM club WHERE id = ?').get(Number(info.lastInsertRowid)) });
}
app.post('/api/admin/club', requireAdmin, requireSuperAdmin, handlerCreateClub);

// ---------- Multi-club: réglages d'un club (nom, PIN propre, actif) ----------
// GET /api/admin/clubs : liste complète (super-admin), pin_propre = a son propre PIN, jamais de hash ni PIN en réponse
function handlerListeClubs(req, res) {
  const clubs = db.prepare(`
    SELECT c.id, c.slug, c.nom, c.actif, c.pin_hash, c.created_at,
      (SELECT COUNT(*) FROM compte_club cc WHERE cc.club_id = c.id) nb_comptes
    FROM club c ORDER BY c.id
  `).all()
    .map(c => ({ id: c.id, slug: c.slug, nom: c.nom, actif: !!c.actif, pin_propre: !!c.pin_hash, nb_comptes: c.nb_comptes || 0, created_at: c.created_at }));
  res.json({ clubs });
}
app.get('/api/admin/clubs', requireAdmin, requireSuperAdmin, handlerListeClubs);
function hashPin(p) { return crypto.createHash('sha256').update(String(p)).digest('hex'); }
// le PIN global (settings) ou une session admin = niveau super-admin ; le seul PIN d'un club ne l'est pas
function superAdminSoumis(req) {
  const gh = getSetting('admin_pin_hash');
  return estAdminSession(req) || [req.headers['x-admin-pin'], req.body && req.body.pin, req.body && req.body.confirm_pin]
    .some(x => x != null && hashPin(x) === gh);
}
// PUT /api/admin/club : modifie le club courant ; body.slug = modifie un autre club (super-admin uniquement)
app.put('/api/admin/club', requireAdmin, (req, res) => {
  const slugCible = req.body.slug != null ? String(req.body.slug).trim().toLowerCase() : null;
  let cible;
  if (slugCible) {
    cible = db.prepare('SELECT * FROM club WHERE slug = ? COLLATE NOCASE').get(slugCible);
    if (!cible) return res.status(404).json({ error: `Club inconnu « ${slugCible} »` });
    if (cible.id !== req.club.id && !superAdminSoumis(req)) {
      return res.status(403).json({ error: 'Modifier un autre club nécessite le code global ou un compte admin' });
    }
  } else cible = req.club;

  const maj = {};
  if ('nom' in req.body) {
    const nom = String(req.body.nom || '').trim().slice(0, 80);
    if (!nom) return res.status(400).json({ error: 'nom requis' });
    if (nom !== cible.nom) maj.nom = nom;
  }
  let pinChange = false;
  if ('pin' in req.body) {
    if (!/^\d{4,8}$/.test(String(req.body.pin))) return res.status(400).json({ error: 'PIN invalide (4 à 8 chiffres)' });
    const h = hashPin(req.body.pin);
    if (h !== cible.pin_hash) { maj.pin_hash = h; pinChange = true; }
  }
  if ('actif' in req.body) {
    const actif = !!req.body.actif;
    if (actif !== !!cible.actif) {
      if (!actif && cible.id === clubParDefaut().id) return res.status(400).json({ error: 'Le club par défaut ne peut pas être désactivé' });
      maj.actif = actif ? 1 : 0;
    }
  }
  // nom : libre pour l'admin du club ; PIN ou actif : geste sensible, code re-saisi exigé (sauf session admin)
  if ((pinChange || maj.actif !== undefined) && !estAdminSession(req) && roleClubSession(req) !== 'admin') {
    const rc = verifierPinAdmin(req, req.body.confirm_pin);
    if (rc.bloque) return res.status(429).json({ error: rc.message });
    if (!rc.ok) return res.status(401).json({ error: 'Code administrateur requis pour confirmer ce changement' });
  }
  if (!Object.keys(maj).length) {
    return res.json({ ok: true, club: { id: cible.id, slug: cible.slug, nom: cible.nom, actif: !!cible.actif, pin_propre: !!cible.pin_hash } });
  }
  const sets = Object.keys(maj).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE club SET ${sets} WHERE id = ?`).run(...Object.values(maj), cible.id);
  logAuditReq(req, 'club_modifie', `club ${cible.slug}`, null, { changements: Object.keys(maj) }); // jamais le PIN lui-même
  res.json({ ok: true, club: { id: cible.id, slug: cible.slug, nom: maj.nom != null ? maj.nom : cible.nom, actif: maj.actif != null ? !!maj.actif : !!cible.actif, pin_propre: maj.pin_hash ? true : !!cible.pin_hash } });
});

// 17j. Personnalisation du club : accent de l interface + défauts de tournoi (nom, jour récurrent, heure)
// GET/PUT de SON club : PIN du club ou session admin (geste NON sensible, aucun confirm_pin)
// ?slug (GET) / body.slug (PUT) = un autre club : super-admin uniquement (code global ou compte admin), comme PUT club
app.get('/api/admin/club/prefs', requireAdmin, (req, res) => {
  const slugCible = req.query.slug ? String(req.query.slug).trim().toLowerCase() : null;
  let cible = req.club;
  if (slugCible) {
    cible = db.prepare('SELECT * FROM club WHERE slug = ? COLLATE NOCASE').get(slugCible);
    if (!cible) return res.status(404).json({ error: `Club inconnu « ${slugCible} »` });
    if (cible.id !== req.club.id && !superAdminSoumis(req)) return res.status(403).json({ error: 'Voir la personnalisation d un autre club nécessite le code global ou un compte admin' });
  }
  res.json({ ok: true, slug: cible.slug, prefs: themeDuClub(cible) });
});

app.put('/api/admin/club/prefs', requireAdmin, (req, res) => {
  const slugCible = req.body.slug != null ? String(req.body.slug).trim().toLowerCase() : null;
  let cible = req.club;
  if (slugCible) {
    cible = db.prepare('SELECT * FROM club WHERE slug = ? COLLATE NOCASE').get(slugCible);
    if (!cible) return res.status(404).json({ error: `Club inconnu « ${slugCible} »` });
    if (cible.id !== req.club.id && !superAdminSoumis(req)) return res.status(403).json({ error: 'Modifier la personnalisation d un autre club nécessite le code global ou un compte admin' });
  }
  const prefs = themeDuClub(cible);
  if ('accent' in req.body) {
    const accent = String(req.body.accent || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) return res.status(400).json({ error: 'Couleur invalide (format #rrggbb)' });
    prefs.accent = accent;
  }
  if ('defaut_nom' in req.body) prefs.defaut_nom = String(req.body.defaut_nom || '').trim().slice(0, 80);
  if ('defaut_jour' in req.body) {
    if (req.body.defaut_jour === null || req.body.defaut_jour === '') prefs.defaut_jour = null;
    else {
      const j = Number(req.body.defaut_jour);
      if (!Number.isInteger(j) || j < 0 || j > 6) return res.status(400).json({ error: 'Jour invalide (0 = dimanche à 6 = samedi)' });
      prefs.defaut_jour = j;
    }
  }
  if ('defaut_heure' in req.body) {
    const h = String(req.body.defaut_heure || '').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) return res.status(400).json({ error: 'Heure invalide (format HH:MM)' });
    prefs.defaut_heure = h;
  }
  if ('adresse' in req.body) prefs.adresse = String(req.body.adresse || '').trim().slice(0, 200); // 17j v2: adresse par défaut du club (0-200 caractères, '' l efface)
  if ('logo' in req.body) { // 17k: '' = aucun, /logos/<prédéfini>.svg ou data:image (png/jpeg/svg+xml) plafonnée
    const lg = String(req.body.logo || '').trim();
    if (!logoClubValide(lg)) { // 17k v5: la réponse 400 dit la cause réelle (envoyé vs attendu)
      if (lg.length > LOGO_TAILLE_MAX) return res.status(400).json({ error: 'Logo refusé : ' + lg.length + ' caractères reçus, ' + LOGO_TAILLE_MAX + ' maximum attendu.' });
      if (!lg.startsWith('/logos/')) return res.status(400).json({ error: 'Logo refusé : format non supporté, attendu /logos/<prédéfini>.svg ou data:image/png|jpeg|svg+xml en base64.' });
      return res.status(400).json({ error: 'Logo refusé : logo prédéfini inconnu (whitelist /logos/*.svg).' });
    }
    prefs.logo = lg;
  }
  if ('logo_mode' in req.body) { // 17k: switch logo d en-tête / filigrane / les deux
    if (!logoModeValide(String(req.body.logo_mode))) return res.status(400).json({ error: 'Mode d affichage du logo invalide (entete, filigrane ou les-deux)' });
    prefs.logo_mode = String(req.body.logo_mode);
  }
  if ('banniere' in req.body) { // 17n: '' = aucune, sinon data:image (png/jpeg/svg+xml) base64 plafonnée
    const bn = String(req.body.banniere || '').trim();
    if (!photoClubValide(bn)) { // même cause réelle que le logo (17k v5)
      if (bn.length > PHOTO_TAILLE_MAX) return res.status(400).json({ error: 'Banniere refusée : ' + bn.length + ' caractères reçus, ' + PHOTO_TAILLE_MAX + ' maximum attendu.' });
      return res.status(400).json({ error: 'Banniere refusée : format non supporté, attendu data:image/png|jpeg|svg+xml en base64 (ou vide pour retirer).' });
    }
    prefs.banniere = bn;
  }
  if ('tv_fond' in req.body) { // 17n: photo de fond de la TV, mêmes règles que la bannière
    const tf = String(req.body.tv_fond || '').trim();
    if (!photoClubValide(tf)) {
      if (tf.length > PHOTO_TAILLE_MAX) return res.status(400).json({ error: 'Photo de fond TV refusée : ' + tf.length + ' caractères reçus, ' + PHOTO_TAILLE_MAX + ' maximum attendu.' });
      return res.status(400).json({ error: 'Photo de fond TV refusée : format non supporté, attendu data:image/png|jpeg|svg+xml en base64 (ou vide pour retirer).' });
    }
    prefs.tv_fond = tf;
  }
  if ('icone' in req.body) { // 17o: icône 192 px de l écran d accueil du téléphone ('' = repli logo raster puis icône générique)
    const ic = String(req.body.icone || '').trim();
    if (!iconeClubValide17o(ic)) { // 17k v5: la réponse 400 dit la cause réelle (envoyé vs attendu)
      if (ic.length > ICONE_TAILLE_MAX) return res.status(400).json({ error: 'Icône refusée : ' + ic.length + ' caractères reçus, ' + ICONE_TAILLE_MAX + ' maximum attendu.' });
      return res.status(400).json({ error: 'Icône refusée : format non supporté, attendu data:image/png ou data:image/jpeg en base64 (ou vide pour retirer).' });
    }
    prefs.icone = ic;
  }
  if ('description' in req.body) prefs.description = String(req.body.description || '').trim().slice(0, 500); // 17n: présentation de la page Le club (0-500, '' l efface)
  if ('contact' in req.body) prefs.contact = String(req.body.contact || '').trim().slice(0, 200); // 17n: contact de la page Le club
  db.prepare('UPDATE club SET theme_json = ? WHERE id = ?').run(JSON.stringify(prefs), cible.id);
  logAuditReq(req, 'club_prefs', `club ${cible.slug}`, null, { changements: Object.keys(req.body).filter(k => k !== 'slug') }); // couleurs et défauts, jamais de secret
  res.json({ ok: true, slug: cible.slug, prefs });
});

// DELETE /api/admin/club (super-admin uniquement): supprime un club créé par erreur.
// - club par défaut protégé (400) - un club avec des tournois (même terminés) est refusé (409): pas d effacement d historique par accident
// - rôles compte_club et abonnements push du club purgés ; le journal d audit du club est conservé (FK coupé le temps de la suppression)
function handlerSuppressionClub(req, res) {
  const slug = String(req.body.slug || '').trim().toLowerCase();
  const club = slug ? db.prepare('SELECT * FROM club WHERE slug = ? COLLATE NOCASE').get(slug) : null;
  if (!club) return res.status(404).json({ error: `Club inconnu « ${slug} »` });
  if (club.id === clubParDefaut().id) return res.status(400).json({ error: 'Le club par défaut ne peut pas être supprimé' });
  const nbT = db.prepare('SELECT COUNT(*) AS n FROM tournoi WHERE club_id = ?').get(club.id).n;
  if (nbT > 0) return res.status(409).json({ error: `Impossible de supprimer « ${club.nom} » : ${nbT} tournoi(s) rattaché(s) à ce club` });
  const nbComptes = db.prepare('SELECT COUNT(*) AS n FROM compte_club WHERE club_id = ?').get(club.id).n;
  db.prepare('DELETE FROM compte_club WHERE club_id = ?').run(club.id); // rôles purgés
  db.prepare('DELETE FROM push_subscription WHERE club_id = ?').run(club.id); // abonnements push du club
  db.pragma('foreign_keys = OFF'); // le journal d audit du club est conservé
  try { db.prepare('DELETE FROM club WHERE id = ?').run(club.id); }
  finally { db.pragma('foreign_keys = ON'); }
  // trace dans le journal du club par défaut: le journal du club supprimé disparaît avec lui,
  // et une insertion visant le club effacé violerait la clé étrangère. Jamais de hash ni de PIN.
  logAudit('club_supprime', `club ${club.slug}`, { nom: club.nom, nb_tournois: nbT, comptes_rattaches: nbComptes }, null, clubParDefaut().id, auteurAdmin(req));
  res.json({ ok: true });
}
app.delete('/api/admin/club', requireAdmin, requireSuperAdmin, requireConfirmPin, handlerSuppressionClub);


// ---------- 17i. Zone super-admin décorrelée des clubs (/api/super/*, page console.html) ----------
// La console plateforme n appartient à AUCUN club: le PIN d un club, une session de club
// (admin comme operateur) ou un compte de club n y ont AUCUN accès. Accès: code global OU
// session d un compte plateforme (super_admin dédié, ou admin legacy). Les routes /api/admin/*
// restent le terrain des clubs (avec surpouvoirs super-admin quand superAdminSoumis),
// les routes /api/super/* sont le terrain réservé de la plateforme (clubs, tous les comptes,
// base complète, rôles plateforme). Le club par défaut reste protégé (non supprimable,
// non désactivable, rattrapage des données héritées à club_id nul).
function requireSuperZone(req, res, next) {
  if (estAdminSession(req)) { req.superVia = 'session'; req.superZone = true; return next(); }
  const ip = ipClient(req);
  const bloque = pinBloque(ip);
  if (bloque) return res.status(429).json({ error: bloque });
  const pin = req.headers['x-admin-pin'] || (req.body && req.body.pin);
  if (pin != null && String(pin) !== '' && hashPin(pin) === getSetting('admin_pin_hash')) { pinAttempts.delete(ip); req.superVia = 'global'; req.superZone = true; return next(); }
  if (pin != null && String(pin) !== '') pinEchec(ip); // un PIN de club ne compte ici que comme un échec
  return res.status(pin != null && String(pin) !== '' ? 401 : 403).json({ error: 'Zone super-admin : code global ou compte super-admin requis (un code de club n y a jamais accès)' });
}
// geste sensible en zone super (PIN de club, club supprimé, base restaurée, rôle plateforme):
// confirmation par le code GLOBAL uniquement (jamais un PIN de club, jamais une session de club)
function requireConfirmGlobal(req, res, next) {
  if (estAdminSession(req)) return next();
  const ip = ipClient(req);
  const bloque = pinBloque(ip);
  if (bloque) return res.status(429).json({ error: bloque });
  const pin = req.body && req.body.confirm_pin;
  if (pin != null && String(pin) !== '' && hashPin(pin) === getSetting('admin_pin_hash')) { pinAttempts.delete(ip); return next(); }
  if (pin != null && String(pin) !== '') pinEchec(ip);
  return res.status(401).json({ error: 'Code global requis pour confirmer ce geste' });
}
// vue « tous les comptes de la plateforme » (17h via ?tous=1, 17i depuis la console dédiée)
function vueComptesTous() {
  return db.prepare(`
    SELECT c.id, c.pseudo, c.email, c.role, c.created_at,
           (SELECT COUNT(*) FROM session s WHERE s.compte_id = c.id) sessions,
           c.last_login_at,
           (SELECT COUNT(*) FROM joueur j WHERE j.compte_id = c.id) joueurs,
           (SELECT COUNT(*) FROM match m WHERE m.joueur1_id IN (SELECT id FROM joueur WHERE compte_id = c.id) OR m.joueur2_id IN (SELECT id FROM joueur WHERE compte_id = c.id)) matchs,
           (SELECT COUNT(*) FROM push_subscription ps WHERE ps.compte_id = c.id) push_abonnements,
           c.club_id,
           (SELECT cl.slug FROM club cl WHERE cl.id = c.club_id) club_slug,
           (SELECT group_concat(cl.slug || ':' || cc.role, ', ') FROM compte_club cc JOIN club cl ON cl.id = cc.club_id WHERE cc.compte_id = c.id) roles_clubs,
           (SELECT group_concat(c2.pseudo, ', ') FROM ami a JOIN compte c2 ON c2.id = a.ami_compte_id WHERE a.compte_id = c.id) amis_comptes,
           (SELECT group_concat(p.pseudo, ', ') FROM ami_pseudo p WHERE p.compte_id = c.id) amis_pseudos
    FROM compte c
    ORDER BY c.id DESC
  `).all();
}
// modification d un club DEPUIS la console plateforme (slug explicite requis, jamais le club du contexte)
function handlerSuperModifClub(req, res) {
  const slugCible = String(req.body.slug || '').trim().toLowerCase();
  if (!slugCible) return res.status(400).json({ error: 'slug requis en zone super-admin' });
  const cible = db.prepare('SELECT * FROM club WHERE slug = ? COLLATE NOCASE').get(slugCible);
  if (!cible) return res.status(404).json({ error: `Club inconnu « ${slugCible} »` });
  const maj = {};
  if ('nom' in req.body) {
    const nom = String(req.body.nom || '').trim().slice(0, 80);
    if (!nom) return res.status(400).json({ error: 'nom requis' });
    if (nom !== cible.nom) maj.nom = nom;
  }
  let pinChange = false;
  if ('pin' in req.body) {
    if (!/^\d{4,8}$/.test(String(req.body.pin))) return res.status(400).json({ error: 'PIN invalide (4 à 8 chiffres)' });
    const h = hashPin(req.body.pin);
    if (h !== cible.pin_hash) { maj.pin_hash = h; pinChange = true; }
  }
  if ('actif' in req.body) {
    const actif = !!req.body.actif;
    if (actif !== !!cible.actif) {
      if (!actif && cible.id === clubParDefaut().id) return res.status(400).json({ error: 'Le club par défaut ne peut pas être désactivé' });
      maj.actif = actif ? 1 : 0;
    }
  }
  if (!Object.keys(maj).length) {
    return res.json({ ok: true, club: { id: cible.id, slug: cible.slug, nom: cible.nom, actif: !!cible.actif, pin_propre: !!cible.pin_hash } });
  }
  const sets = Object.keys(maj).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE club SET ${sets} WHERE id = ?`).run(...Object.values(maj), cible.id);
  logAuditReq(req, 'club_modifie', `club ${cible.slug}`, null, { changements: Object.keys(maj) }); // jamais le PIN lui-même
  res.json({ ok: true, club: { id: cible.id, slug: cible.slug, nom: maj.nom != null ? maj.nom : cible.nom, actif: maj.actif != null ? !!maj.actif : !!cible.actif, pin_propre: maj.pin_hash ? true : !!cible.pin_hash } });
}

// montée des routes super: aucune ne lit req.club, l audit y est rattaché à aucun club (superZone)
app.get('/api/super/scan', requireSuperZone, (req, res) => res.json({ super_admin: true, via: req.superVia }));
app.get('/api/super/clubs', requireSuperZone, handlerListeClubs);
app.post('/api/super/club', requireSuperZone, handlerCreateClub);
app.put('/api/super/club', requireSuperZone, requireConfirmGlobal, handlerSuperModifClub);
app.delete('/api/super/club', requireSuperZone, requireConfirmGlobal, handlerSuppressionClub);
app.get('/api/super/comptes', requireSuperZone, (req, res) => res.json({ comptes: vueComptesTous(), tous: true }));
app.post('/api/super/compte/:id/role', requireSuperZone, handlerRoleGlobal);
app.get('/api/super/base/export', requireSuperZone, handlerExportBase);
app.post('/api/super/base/import', requireSuperZone, requireConfirmGlobal, handlerImportBase);

// ---------- Multi-club: rôles des comptes sur un club (table compte_club) ----------
// gestion des rôles: code global (super-admin), session admin du club, session admin globale,
// OU le code PIN du club courant (17g: autonomie du club, choix explicite.
// toute personne ayant le code du club peut nommer un admin du club, y compris son propre compte une fois connecté).
// un operateur (session) ne peut toujours pas gérer les rôles.
function requireRoleClub(req, res, next) {
  if (superAdminSoumis(req) || roleClubSession(req) === 'admin') return next();
  if (req.adminViaPin === 'club') return next(); // 17g: le code du club suffit pour gérer les rôles de SON club
  return res.status(403).json({ error: 'Gérer les rôles du club nécessite le code du club, une session admin du club ou le code global' });
}
// rôles du club courant (jamais de hash ni d email en réponse)
app.get('/api/admin/club/comptes', requireAdmin, requireRoleClub, (req, res) => {
  const liens = db.prepare(`
    SELECT cc.compte_id, cc.role, cc.created_at, c.pseudo FROM compte_club cc
    JOIN compte c ON c.id = cc.compte_id
    WHERE cc.club_id = ? ORDER BY cc.id
  `).all(req.club.id);
  res.json({ comptes: liens });
});
// attribuer ou changer le rôle d un compte sur le club courant (idempotent: mise à jour du rôle si déjà lié)
app.put('/api/admin/club/compte', requireAdmin, requireRoleClub, (req, res) => {
  const pseudo = String(req.body.pseudo || '').trim().slice(0, 24);
  const role = req.body.role === 'operateur' ? 'operateur' : (req.body.role === 'admin' ? 'admin' : null);
  if (!pseudo) return res.status(400).json({ error: 'pseudo requis' });
  if (!role) return res.status(400).json({ error: 'Rôle invalide (admin ou operateur)' });
  // 17g: un acteur du club (code du club ou session admin du club) ne promeut QUE des comptes DU club;
  // le super-admin garde l attachement cross-club (staff multi-club, page clubs.html)
  const superSoumis = superAdminSoumis(req);
  const cible = superSoumis
    ? db.prepare('SELECT id, pseudo FROM compte WHERE pseudo = ? COLLATE NOCASE').get(pseudo)
    : db.prepare('SELECT id, pseudo FROM compte WHERE pseudo = ? COLLATE NOCASE AND club_id = ?').get(pseudo, req.club.id);
  if (!cible) return res.status(404).json({ error: superSoumis ? `Compte « ${pseudo} » introuvable` : `Compte « ${pseudo} » introuvable dans ce club` });
  const deja = db.prepare('SELECT id FROM compte_club WHERE compte_id = ? AND club_id = ?').get(cible.id, req.club.id);
  if (deja) db.prepare('UPDATE compte_club SET role = ? WHERE id = ?').run(role, deja.id);
  else db.prepare('INSERT INTO compte_club (compte_id, club_id, role) VALUES (?, ?, ?)').run(cible.id, req.club.id, role);
  logAuditReq(req, 'club_role', `club ${req.club.slug} : ${cible.pseudo}`, null, { role });
  res.json({ ok: true, compte_id: cible.id, pseudo: cible.pseudo, role });
});
// retirer le rôle d un compte sur le club courant (destructif: confirmation exigée, sauf session admin)
app.delete('/api/admin/club/compte', requireAdmin, requireRoleClub, requireConfirmPin, (req, res) => {
  const compteId = Number(req.body.compte_id);
  if (!compteId) return res.status(400).json({ error: 'compte_id requis' });
  const info = db.prepare('DELETE FROM compte_club WHERE club_id = ? AND compte_id = ?').run(req.club.id, compteId);
  if (!info.changes) return res.status(404).json({ error: 'Ce compte n a pas de rôle sur ce club' });
  logAuditReq(req, 'club_role_retire', `club ${req.club.slug} : compte ${compteId}`, null, null);
  res.json({ ok: true });
});

// ---------- Sauvegarde / restauration de TOUTE la base (super-admin: code global ou compte admin global) ----------
// Un code de club administre SON club : il n'a pas à exporter/importer la base entière de la plateforme.
function tablesBase() { // toutes les tables du schéma (hors tables internes sqlite_*), ordre stable
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
}

// Sauvegarde complète: TOUTES les tables, TOUTES les lignes, ids exacts -> fichier JSON téléchargeable
function handlerExportBase(req, res) {
  const tables = {};
  for (const t of tablesBase()) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  const lignes = Object.values(tables).reduce((n, rows) => n + rows.length, 0);
  // orphelins hérités (opérations FK-OFF, ex: club supprimé): déclarés dans l'export pour une restauration à l'identique
  const fkViol = db.prepare('PRAGMA foreign_key_check').all().map(v => `${v.table}#${v.rowid}->${v.parent}`);
  const payload = { sauvegarde: 'ebpc-tournoi-billard', version: 1, genere_le: new Date().toISOString(), tables, fk_violations: fkViol };
  logAuditReq(req, 'export_base', `${Object.keys(tables).length} tables / ${lignes} lignes`, null, { format: 1 });
  res.setHeader('Content-Disposition', `attachment; filename="base-${payload.genere_le.slice(0, 19).replace(/[:T]/g, '-')}.json"`);
  res.json(payload);
}
app.get('/api/admin/base/export', requireAdmin, requireSuperAdmin, handlerExportBase);

// Restauration complète: REMPLACE tout le contenu actuel par la sauvegarde, dans UNE transaction (tout ou rien, FK différées, ids préservés)
function handlerImportBase(req, res) {
  const p = req.body && req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : req.body;
  const err400 = (m) => res.status(400).json({ error: m });
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.sauvegarde !== 'ebpc-tournoi-billard' ||
      !p.tables || typeof p.tables !== 'object' || Array.isArray(p.tables)) return err400("Sauvegarde invalide (format: attend un export de /api/admin/base/export)");
  const connues = tablesBase();
  const cols = {}; for (const t of connues) cols[t] = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name));
  const lignes = [];
  for (const nom of Object.keys(p.tables)) {
    if (!cols[nom]) return err400(`Sauvegarde invalide (table inconnue: ${nom})`);
    if (!Array.isArray(p.tables[nom])) return err400(`Sauvegarde invalide (${nom} doit être un tableau)`);
    for (const row of p.tables[nom]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return err400(`Sauvegarde invalide (${nom}: ligne invalide)`);
      for (const c of Object.keys(row)) if (!cols[nom].has(c)) return err400(`Sauvegarde invalide (${nom}: colonne inconnue ${c})`);
      lignes.push([nom, row]);
    }
  }
  // 17d v2: sauvegarde générée AVANT le cloisonnement des comptes par club (17f): les lignes de compte
  // n ont pas club_id (devenu NOT NULL à la reconstruction 17f, ex: prod ancienne restaurée sur l app de test)
  // -> même règle que la migration 17f au boot: rattachées au club par défaut de la sauvegarde (MIN des ids du club exporté)
  let rattaches17f = 0;
  if (Array.isArray(p.tables.compte) && p.tables.compte.some((c) => c && !('club_id' in c))) {
    const idsClubs17d = (Array.isArray(p.tables.club) ? p.tables.club : []).map((c) => c && Number(c.id)).filter((n) => Number.isInteger(n) && n > 0);
    const clubDefaut17d = idsClubs17d.length ? Math.min(...idsClubs17d) : clubParDefaut().id;
    for (const c of p.tables.compte) if (c && !('club_id' in c)) { c.club_id = clubDefaut17d; rattaches17f++; }
  }
  const annoncees = new Set((Array.isArray(p.fk_violations) ? p.fk_violations : []).map(String)); // orphelins hérités acceptés à l'identique
  const avant = {}; for (const t of connues) avant[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  db.pragma('foreign_keys = OFF'); // orphelins hérités (clubs supprimés): le COMMIT ne les refuse pas, ils sont validés par foreign_key_check ci-dessous
  let txImport;
  try {
  txImport = db.transaction(() => {
    for (const t of connues) db.prepare(`DELETE FROM ${t}`).run();
    for (const [nom, row] of lignes) {
      const cles = Object.keys(row);
      if (!cles.length) continue;
      db.prepare(`INSERT INTO ${nom} (${cles.map(c => `"${c}"`).join(', ')}) VALUES (${cles.map(() => '?').join(', ')})`).run(...cles.map(c => row[c]));
    }
    const vios = db.prepare('PRAGMA foreign_key_check').all();
    const nouvelles = vios.filter(v => !annoncees.has(`${v.table}#${v.rowid}->${v.parent}`)); // hors orphelins déjà déclarés par l'export
    if (nouvelles.length) { const e = new Error('Sauvegarde invalide: références cassées: ' + nouvelles.slice(0, 5).map(v => `${v.table}#${v.rowid} -> ${v.parent}`).join(', ')); e.status = 400; throw e; }
  });
  txImport(); // n'importe quelle erreur -> rollback intégral, la base actuelle reste intacte
  } finally {
    db.pragma('foreign_keys = ON'); // contraintes réactivées même en cas d'erreur
  }
  const apres = {}; for (const t of connues) apres[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  logAuditReq(req, 'import_base', `${lignes.length} lignes restaurées sur ${connues.length} tables`, { tables: avant }, { tables: apres, ...(rattaches17f ? { comptes_rattaches_pre17f: rattaches17f } : {}) });
  majEtBroadcast();
  res.json({ ok: true, tables: apres, ...etatGlobal(req) });
}
app.post('/api/admin/base/import', requireAdmin, requireConfirmPin, requireSuperAdmin, handlerImportBase);

// ---------- 17e. Sauvegarde / restauration des DONNÉES du club (un code de club administre SON club) ----------
// Périmètre club uniquement: jamais les comptes, sessions, emails ou préférences des utilisateurs (données plateforme).
const TABLES_CLUB = {
  tournoi: 'SELECT r.* FROM tournoi r WHERE r.club_id = ?',
  distance_round: 'SELECT r.* FROM distance_round r JOIN tournoi t ON t.id = r.tournoi_id WHERE t.club_id = ?',
  joueur: 'SELECT r.* FROM joueur r JOIN tournoi t ON t.id = r.tournoi_id WHERE t.club_id = ?',
  table_billard: 'SELECT r.* FROM table_billard r JOIN tournoi t ON t.id = r.tournoi_id WHERE t.club_id = ?',
  match: 'SELECT r.* FROM "match" r JOIN tournoi t ON t.id = r.tournoi_id WHERE t.club_id = ?',
  match_event: 'SELECT r.* FROM match_event r JOIN "match" m ON m.id = r.match_id JOIN tournoi t ON t.id = m.tournoi_id WHERE t.club_id = ?',
  audit_log: 'SELECT r.* FROM audit_log r WHERE r.club_id = ?',
  audit_snapshot: 'SELECT r.* FROM audit_snapshot r WHERE r.club_id = ?',
};
function compterClub(table, clubId) { // compteurs before/after de la restauration ciblée (lignes du périmètre club)
  const SQL = {
    tournoi: 'SELECT COUNT(*) n FROM tournoi WHERE club_id = ?',
    distance_round: 'SELECT COUNT(*) n FROM distance_round WHERE tournoi_id IN (SELECT id FROM tournoi WHERE club_id = ?)',
    joueur: 'SELECT COUNT(*) n FROM joueur WHERE tournoi_id IN (SELECT id FROM tournoi WHERE club_id = ?)',
    table_billard: 'SELECT COUNT(*) n FROM table_billard WHERE tournoi_id IN (SELECT id FROM tournoi WHERE club_id = ?)',
    match: 'SELECT COUNT(*) n FROM "match" WHERE tournoi_id IN (SELECT id FROM tournoi WHERE club_id = ?)',
    match_event: 'SELECT COUNT(*) n FROM match_event WHERE match_id IN (SELECT m.id FROM "match" m JOIN tournoi t ON t.id = m.tournoi_id WHERE t.club_id = ?)',
    audit_log: 'SELECT COUNT(*) n FROM audit_log WHERE club_id = ?',
    audit_snapshot: 'SELECT COUNT(*) n FROM audit_snapshot WHERE club_id = ?',
  };
  return db.prepare(SQL[table]).get(clubId).n;
}

// Export club: les données DU club courant (8 tables périmètre club), ids exacts -> fichier JSON téléchargeable.
// Ouvert à TOUS les admins du club (code de club accepté): le club sauvegarde SES données, pas celles des autres.
app.get('/api/admin/base/export-club', requireAdmin, (req, res) => {
  const tables = {}; let lignes = 0;
  for (const [nom, sql] of Object.entries(TABLES_CLUB)) { const rs = db.prepare(sql).all(req.club.id); tables[nom] = rs; lignes += rs.length; }
  const payload = { sauvegarde: 'ebpc-tournoi-billard-club', version: 1, genere_le: new Date().toISOString(),
    club: { id: req.club.id, slug: req.club.slug, nom: req.club.nom }, tables };
  logAuditReq(req, 'export_club', `club ${req.club.slug} : ${Object.keys(tables).length} tables / ${lignes} lignes`, null, { format: 1 });
  res.setHeader('Content-Disposition', `attachment; filename="club-${req.club.slug}-${payload.genere_le.slice(0, 19).replace(/[:T]/g, '-')}.json"`);
  res.json(payload);
});

// Import club: REMPLACE uniquement les données du club courant par une sauvegarde de CE club.
// Jamais les autres clubs, jamais les comptes/sessions de la plateforme. Transaction intégrale, rollback si erreur.
app.post('/api/admin/base/import-club', requireAdmin, requireConfirmPin, (req, res) => {
  const err400 = (m) => res.status(400).json({ error: m });
  const p = req.body && req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : req.body;
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.sauvegarde !== 'ebpc-tournoi-billard-club' ||
      !p.tables || typeof p.tables !== 'object' || Array.isArray(p.tables)) return err400("Sauvegarde invalide (format: attend un export de /api/admin/base/export-club)");
  if (!p.club || typeof p.club !== 'object' || typeof p.club.slug !== 'string' || !p.club.slug) return err400('Sauvegarde invalide (club d origine absent)');
  if (p.club.slug.toLowerCase() !== String(req.club.slug).toLowerCase()) return err400(`Cette sauvegarde provient du club « ${p.club.slug} » : elle ne peut pas restaurer le club « ${req.club.slug} » (chaque club restaure uniquement ses propres données)`);
  const connues = Object.keys(TABLES_CLUB);
  for (const nom of Object.keys(p.tables)) if (!connues.includes(nom)) return err400(`Sauvegarde invalide (table ${nom} hors périmètre club : les comptes et les données de la plateforme ne sont jamais importables par un club)`);
  const cols = {}; for (const t of connues) cols[t] = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name));
  const lignes = [];
  for (const nom of connues) {
    if (!Array.isArray(p.tables[nom])) return err400(`Sauvegarde invalide (${nom} doit être un tableau)`);
    for (const row of p.tables[nom]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return err400(`Sauvegarde invalide (${nom} : ligne invalide)`);
      for (const c of Object.keys(row)) if (!cols[nom].has(c)) return err400(`Sauvegarde invalide (${nom} : colonne inconnue ${c})`);
      lignes.push([nom, row]);
    }
  }
  // cohérence interne: chaque ligne reste STRICTEMENT dans le périmètre du club (aucune ligne d un autre club, aucune référence externe)
  const idsT = new Set(p.tables.tournoi.map(x => Number(x.id)));
  const idsM = new Set(p.tables.match.map(x => Number(x.id)));
  const idsJ = new Set(p.tables.joueur.map(x => Number(x.id)));
  const idsA = new Set(p.tables.audit_log.map(x => Number(x.id)));
  const dedans = (v, s) => s.has(Number(v));
  const absentOk = (v, s) => v === null || v === undefined || s.has(Number(v));
  for (const [nom, row] of lignes) {
    if (nom === 'tournoi' && (Number(row.club_id) !== req.club.id || !absentOk(row.champion_id, idsJ))) return err400(`Tournoi ${row.id} : n appartient pas au club courant (club_id ${row.club_id})`);
    if (['distance_round', 'joueur', 'table_billard', 'match'].includes(nom) && !dedans(row.tournoi_id, idsT)) return err400(`${nom} : tournoi ${row.tournoi_id} absent de la sauvegarde (référence incohérente)`);
    if (nom === 'match' && (!absentOk(row.joueur1_id, idsJ) || !absentOk(row.joueur2_id, idsJ) || !absentOk(row.gagnant_id, idsJ) || !absentOk(row.suivant_id, idsM) || !absentOk(row.perdant_id, idsM))) return err400(`Match ${row.id} : référence un joueur/match absent de la sauvegarde du club`);
    if (nom === 'match_event' && (!dedans(row.match_id, idsM) || !absentOk(row.joueur_id, idsJ))) return err400(`Event ${row.id} : référence un match/joueur absent de la sauvegarde du club`);
    if (nom === 'audit_log' && Number(row.club_id) !== req.club.id) return err400(`Journal ${row.id} : n appartient pas au club courant`);
    if (nom === 'audit_snapshot' && (Number(row.club_id) !== req.club.id || !dedans(row.audit_id, idsA))) return err400(`Snapshot ${row.id} : n appartient pas au journal du club courant`);
  }
  // ids déjà pris par des lignes N appartenant PAS au club (base divergente): refus AVANT toute écriture
  const CLUB_DE = {
    tournoi: 'SELECT club_id AS c FROM tournoi WHERE id = ?',
    joueur: 'SELECT t.club_id AS c FROM joueur r JOIN tournoi t ON t.id = r.tournoi_id WHERE r.id = ?',
    table_billard: 'SELECT t.club_id AS c FROM table_billard r JOIN tournoi t ON t.id = r.tournoi_id WHERE r.id = ?',
    match: 'SELECT t.club_id AS c FROM "match" r JOIN tournoi t ON t.id = r.tournoi_id WHERE r.id = ?',
    match_event: 'SELECT t.club_id AS c FROM match_event r JOIN "match" m ON m.id = r.match_id JOIN tournoi t ON t.id = m.tournoi_id WHERE r.id = ?',
    audit_log: 'SELECT club_id AS c FROM audit_log WHERE id = ?',
    audit_snapshot: 'SELECT club_id AS c FROM audit_snapshot WHERE id = ?',
  };
  for (const [nom, row] of lignes) {
    const exist = CLUB_DE[nom] ? db.prepare(CLUB_DE[nom]).get(Number(row.id)) : null;
    if (exist && exist.c !== req.club.id) return err400(`Sauvegarde incompatible : ${nom} ${row.id} existe déjà avec une autre origine (base divergente). Demandez une restauration de la base complète au super-admin.`);
  }
  const avant = {}; for (const t of connues) avant[t] = compterClub(t, req.club.id);
  db.pragma('foreign_keys = OFF'); // cf. import base: validation par foreign_key_check intégré (FK réactivées dans le finally)
  let txClub;
  try {
    txClub = db.transaction(() => {
      const SUPPR = {
        match_event: 'DELETE FROM match_event WHERE match_id IN (SELECT m.id FROM "match" m JOIN tournoi t ON t.id = m.tournoi_id WHERE t.club_id = ?)',
        match: 'DELETE FROM "match" WHERE tournoi_id IN (SELECT id FROM tournoi WHERE club_id = ?)',
        table_billard: 'DELETE FROM table_billard WHERE tournoi_id IN (SELECT id FROM tournoi WHERE club_id = ?)',
        distance_round: 'DELETE FROM distance_round WHERE tournoi_id IN (SELECT id FROM tournoi WHERE club_id = ?)',
        joueur: 'DELETE FROM joueur WHERE tournoi_id IN (SELECT id FROM tournoi WHERE club_id = ?)',
        audit_snapshot: 'DELETE FROM audit_snapshot WHERE club_id = ?',
        audit_log: 'DELETE FROM audit_log WHERE club_id = ?',
        tournoi: 'DELETE FROM tournoi WHERE club_id = ?',
      };
      // ordre enfants d'abord, tournoi en DERNIER: les suppressions ciblent les tournois du club par sous-requête,
      // le tournoi doit donc encore exister quand on purge ses lignes filles.
      const ORDRE_SUPPR = ['match_event', 'match', 'table_billard', 'distance_round', 'joueur', 'audit_snapshot', 'audit_log', 'tournoi'];
      for (const nom of ORDRE_SUPPR) db.prepare(SUPPR[nom]).run(req.club.id);
      for (const [nom, row] of lignes) {
        const cles = Object.keys(row);
        if (!cles.length) continue;
        db.prepare(`INSERT INTO ${nom} (${cles.map(c => `"${c}"`).join(', ')}) VALUES (${cles.map(() => '?').join(', ')})`).run(...cles.map(c => row[c]));
      }
      const vios = db.prepare('PRAGMA foreign_key_check').all();
      for (const [nom, row] of lignes) {
        if (nom === 'distance_round') continue; // pas de colonne id (PK tournoi_id+round): cohérence déjà validée ci-dessus
        if (vios.some(v => v.table === nom && Number(v.rowid) === Number(row.id))) { const e = new Error(`Sauvegarde invalide : ${nom} ${row.id} laisse une référence cassée`); e.status = 400; throw e; }
      }
    });
    txClub(); // toute erreur -> rollback intégral: le club garde ses données actuelles
  } finally {
    db.pragma('foreign_keys = ON'); // contraintes réactivées même en cas d erreur
  }
  const apres = {}; for (const t of connues) apres[t] = compterClub(t, req.club.id);
  logAuditReq(req, 'import_club', `club ${req.club.slug} : ${lignes.length} lignes restaurées sur ${connues.length} tables`, { tables: avant }, { tables: apres });
  majEtBroadcast();
  res.json({ ok: true, tables: apres, ...etatGlobal(req) });
});

// Rollback point-in-time : restaure le tournoi actif à l'état du snapshot d'un événement d'audit
app.post('/api/admin/tournoi/rollback', requireAdmin, requireConfirmPin, (req, res) => {
  const auditId = Number(req.body.audit_id);
  const snap = db.prepare('SELECT * FROM audit_snapshot WHERE audit_id = ?').get(auditId);
  if (!snap) return res.status(404).json({ error: 'Aucun snapshot pour cet événement' });
  const actif = tournoiActif(req.club.id);
  if (!actif || actif.id !== snap.tournoi_id) {
    return res.status(409).json({ error: 'Seul le tournoi actif peut être restauré (ce snapshot concerne un autre tournoi)' });
  }
  const data = JSON.parse(snap.payload);
  const tid = snap.tournoi_id;
  const reinsert = (table, rows) => {
    if (!rows || !rows.length) return;
    const cols = Object.keys(rows[0]);
    const ins = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    for (const r of rows) ins.run(...cols.map(c => r[c]));
  };
  // transaction atomique : tout ou rien, ordre des FK respecté
  const tx = db.transaction(() => {
    db.pragma('defer_foreign_keys = ON'); // match.suivant_id/perdant_id sont des auto-références: vérifiées au COMMIT
    db.prepare('DELETE FROM match_event WHERE match_id IN (SELECT id FROM match WHERE tournoi_id = ?)').run(tid);
    db.prepare('DELETE FROM match WHERE tournoi_id = ?').run(tid);
    db.prepare('DELETE FROM distance_round WHERE tournoi_id = ?').run(tid);
    db.prepare('DELETE FROM table_billard WHERE tournoi_id = ?').run(tid);
    db.prepare('DELETE FROM joueur WHERE tournoi_id = ?').run(tid);
    db.prepare('DELETE FROM tournoi WHERE id = ?').run(tid);
    reinsert('tournoi', [data.tournoi]);
    reinsert('joueur', data.joueurs);
    reinsert('table_billard', data.tables);
    reinsert('distance_round', data.distances);
    reinsert('match', data.matchs);
    reinsert('match_event', data.events);
  });
  tx();
  logAuditReq(req, 'rollback', `tournoi ${tid} restauré à l'événement #${auditId}`, null, { audit_id: auditId, taken_at: snap.taken_at });
  majEtBroadcast();
  res.json({ ok: true, ...etatGlobal(req) });
});

// ---------- Export / import JSON d'un tournoi (backup + rejouer ailleurs) ----------
function payloadTournoi(tid) {
  return {
    app: 'ebpc-tournoi-billard', version: 1, exported_at: new Date().toISOString(),
    tournoi: db.prepare('SELECT * FROM tournoi WHERE id = ?').get(tid),
    joueurs: db.prepare('SELECT * FROM joueur WHERE tournoi_id = ? ORDER BY id').all(tid),
    matchs: db.prepare('SELECT * FROM match WHERE tournoi_id = ? ORDER BY id').all(tid),
    events: db.prepare('SELECT * FROM match_event WHERE match_id IN (SELECT id FROM match WHERE tournoi_id = ?) ORDER BY id').all(tid),
    distances: db.prepare('SELECT * FROM distance_round WHERE tournoi_id = ? ORDER BY round').all(tid),
    tables: db.prepare('SELECT * FROM table_billard WHERE tournoi_id = ? ORDER BY numero').all(tid),
  };
}

app.get('/api/admin/tournoi/export', requireAdmin, (req, res) => {
  const t = req.query.id ? tournoiDuClub(req, req.query.id) : tournoiActif(req.club.id); // isolation club
  if (!t) return res.status(404).json({ error: 'Tournoi introuvable (ou aucun tournoi actif)' });
  res.setHeader('Content-Disposition', `attachment; filename="tournoi-${t.id}-${String(t.nom).replace(/[^\w-]+/g, '_')}.json"`);
  res.json(payloadTournoi(t.id));
});

// Import: recrée un tournoi depuis un export JSON. Si un tournoi est actif -> exige replace=true + confirm_pin.
app.post('/api/admin/tournoi/import', requireAdmin, requireConfirmPin, (req, res) => {
  const p = req.body && req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : req.body;
  const t = p && p.tournoi;
  const err400 = (m) => res.status(400).json({ error: m });
  if (!t || typeof t.nom !== 'string' || !t.nom) return err400('Export invalide (tournoi.nom manquant)');
  if (!['blackball', 'ultimate'].includes(t.regle)) return err400('Export invalide (règle)');
  if (![16, 32, 64, 128].includes(Number(t.taille))) return err400('Export invalide (taille)');
  if (!['simple', 'double'].includes(t.format)) return err400('Export invalide (format)');
  for (const k of ['joueurs', 'matchs', 'events', 'distances', 'tables']) if (p[k] != null && !Array.isArray(p[k])) return err400(`Export invalide (${k} doit être un tableau)`);
  const joueurs = p.joueurs || [], matchs = p.matchs || [], events = p.events || [], distances = p.distances || [], tables = p.tables || [];
  const actif = tournoiActif(req.club.id);
  if (actif && req.body.replace !== true) {
    return res.status(409).json({ error: `Un tournoi est actif (${actif.nom}). Envoyez replace=true + confirm_pin pour le remplacer par l'import.`, actif_id: actif.id });
  }
  // remap des ids (le tournoi importé reçoit de nouveaux ids, on recopie les FK)
  const mapJ = new Map(), mapM = new Map(), mapT = new Map();
  // validation préalable des références (évite un 500 FK au COMMIT): toute ref doit exister dans l'export
  const refs = [];
  for (const m of matchs) for (const c of ['joueur1_id', 'joueur2_id', 'gagnant_id', 'casseur_id']) if (m[c] != null) refs.push(['joueur', m[c]]);
  for (const m of matchs) { if (m.table_id != null) refs.push(['table', m.table_id]); if (m.suivant_id != null) refs.push(['match', m.suivant_id]); if (m.perdant_id != null) refs.push(['match', m.perdant_id]); }
  for (const e of events) { if (e.match_id != null) refs.push(['match', e.match_id]); if (e.joueur_id != null) refs.push(['joueur', e.joueur_id]); }
  if (t.champion_id != null) refs.push(['joueur', t.champion_id]);
  const setJ = new Set(joueurs.map(j => j.id)), setM = new Set(matchs.map(m => m.id)), setT = new Set(tables.map(tb => tb.id));
  const casses = refs.filter(([k, v]) => (k === 'joueur' ? !setJ.has(v) : k === 'match' ? !setM.has(v) : !setT.has(v)));
  if (casses.length) return err400(`Export invalide: ${casses.length} référence(s) cassée(s) (ex: ${casses[0][0]} #${casses[0][1]})`);
  t.club_id = req.club.id; // un import atterrit toujours dans le club courant
  const tx = db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    if (actif) {
      db.prepare('UPDATE tournoi SET champion_id = NULL WHERE id = ?').run(actif.id);
      db.prepare('DELETE FROM match_event WHERE match_id IN (SELECT id FROM match WHERE tournoi_id = ?)').run(actif.id);
      db.prepare('DELETE FROM match WHERE tournoi_id = ?').run(actif.id);
      db.prepare('DELETE FROM joueur WHERE tournoi_id = ?').run(actif.id);
      db.prepare('DELETE FROM table_billard WHERE tournoi_id = ?').run(actif.id);
      db.prepare('DELETE FROM distance_round WHERE tournoi_id = ?').run(actif.id);
      db.prepare('DELETE FROM audit_snapshot WHERE tournoi_id = ?').run(actif.id);
      db.prepare('DELETE FROM tournoi WHERE id = ?').run(actif.id);
    }
    const tCols = Object.keys(t).filter(c => c !== 'id');
    const newTid = db.prepare(`INSERT INTO tournoi (${tCols.join(',')}) VALUES (${tCols.map(() => '?').join(',')})`).run(...tCols.map(c => t[c])).lastInsertRowid;
    for (const j of joueurs) {
      const cols = Object.keys(j).filter(c => c !== 'id' && c !== 'tournoi_id');
      const nj = db.prepare(`INSERT INTO joueur (tournoi_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`).run(newTid, ...cols.map(c => j[c]));
      mapJ.set(j.id, Number(nj.lastInsertRowid));
    }
    for (const tb of tables) {
      const cols = Object.keys(tb).filter(c => c !== 'id' && c !== 'tournoi_id');
      const nt = db.prepare(`INSERT INTO table_billard (tournoi_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`).run(newTid, ...cols.map(c => tb[c]));
      mapT.set(tb.id, Number(nt.lastInsertRowid));
    }
    const mapId = (v, map) => (v == null ? null : (map.get(v) != null ? map.get(v) : v));
    // 1re passe: insère les matchs SANS les liens self-FK (suivant_id/perdant_id), en remplissant mapM
    for (const m of matchs) {
      const cols = Object.keys(m).filter(c => c !== 'id' && c !== 'suivant_id' && c !== 'perdant_id');
      const vals = cols.map(c => {
        if (c === 'tournoi_id') return newTid;
        if (['joueur1_id', 'joueur2_id', 'gagnant_id', 'casseur_id'].includes(c)) return mapId(m[c], mapJ);
        if (c === 'table_id') return mapId(m[c], mapT);
        return m[c];
      });
      const nm = db.prepare(`INSERT INTO match (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
      mapM.set(m.id, Number(nm.lastInsertRowid));
    }
    // 2e passe: liens self-FK, maintenant que tous les matchs (et leur mapM) existent
    for (const m of matchs) {
      if (m.suivant_id == null && m.perdant_id == null) continue;
      db.prepare('UPDATE match SET suivant_id = ?, perdant_id = ? WHERE id = ?')
        .run(mapId(m.suivant_id, mapM), mapId(m.perdant_id, mapM), mapM.get(m.id));
    }
    for (const e of events) {
      const cols = Object.keys(e).filter(c => c !== 'id');
      const vals = cols.map(c => {
        if (c === 'match_id') return mapId(e[c], mapM);
        if (c === 'joueur_id') return mapId(e[c], mapJ);
        return e[c];
      });
      db.prepare(`INSERT INTO match_event (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    }
    for (const d of distances) {
      db.prepare('INSERT INTO distance_round (tournoi_id, round, manches) VALUES (?, ?, ?)').run(newTid, d.round, d.manches);
    }
    // champion_id après coup (les joueurs sont insérés)
    if (t.champion_id != null && mapJ.has(t.champion_id)) {
      db.prepare('UPDATE tournoi SET champion_id = ? WHERE id = ?').run(mapJ.get(t.champion_id), newTid);
    }
    // sécurité: aucune FK cassée avant le COMMIT (sinon rollback + 400 explicite au lieu d'un 500)
    const vios = db.prepare('PRAGMA foreign_key_check').all();
    if (vios.length) { const e = new Error('Export invalide: références cassées: ' + vios.slice(0, 5).map(v => `${v.table}#${v.rowid} -> ${v.parent}`).join(', ')); e.status = 400; throw e; }
    return newTid;
  });
  const newTid = tx();
  logAuditReq(req, 'import_tournoi', `tournoi importé -> #${newTid} (${t.nom})`, null, { nom: t.nom, joueurs: joueurs.length, matchs: matchs.length, remplace: !!actif });
  majEtBroadcast();
  res.json({ ok: true, tournoi_id: Number(newTid), ...etatGlobal(req) });
});

// ---------- Diff avant rollback: ce qui va changer si on restaure à cet événement ----------
app.get('/api/admin/tournoi/rollback/diff', requireAdmin, (req, res) => {
  const auditId = Number(req.query.audit_id);
  const snap = db.prepare('SELECT * FROM audit_snapshot WHERE audit_id = ?').get(auditId);
  if (!snap) return res.status(404).json({ error: 'Aucun snapshot pour cet événement' });
  const actif = tournoiActif(req.club.id);
  if (!actif || actif.id !== snap.tournoi_id) return res.status(409).json({ error: 'Seul le tournoi actif peut être comparé (ce snapshot concerne un autre tournoi)' });
  const data = JSON.parse(snap.payload);
  const cur = db.prepare('SELECT * FROM match WHERE tournoi_id = ?').all(actif.id);
  const snapM = new Map(data.matchs.map(m => [m.id, m]));
  const curM = new Map(cur.map(m => [m.id, m]));
  const cmp = ['etat', 'score1', 'score2', 'joueur1_id', 'joueur2_id', 'gagnant_id', 'table_id', 'manches'];
  const modifies = [];
  for (const m of cur) {
    const s = snapM.get(m.id);
    if (!s) continue;
    if (cmp.some(c => s[c] !== m[c])) {
      modifies.push({
        id: m.id, code: `${String(m.bracket).toLowerCase()}${m.tour}-${String(m.position).padStart(3, '0')}`,
        avant: Object.fromEntries(cmp.map(c => [c, s[c]])), apres: Object.fromEntries(cmp.map(c => [c, m[c]])),
      });
    }
  }
  const ajoutes = cur.filter(m => !snapM.has(m.id)).map(m => ({ id: m.id, code: `${String(m.bracket).toLowerCase()}${m.tour}-${String(m.position).padStart(3, '0')}` }));
  const supprimes = data.matchs.filter(m => !curM.has(m.id)).map(m => ({ id: m.id, code: `${String(m.bracket).toLowerCase()}${m.tour}-${String(m.position).padStart(3, '0')}` }));
  const jAv = data.joueurs.length, jAp = db.prepare('SELECT COUNT(*) c FROM joueur WHERE tournoi_id = ?').get(actif.id).c;
  res.json({
    audit_id: auditId, taken_at: snap.taken_at,
    resume: {
      matchs_modifies: modifies.length, matchs_ajoutes: ajoutes.length, matchs_supprimes: supprimes.length,
      joueurs_avant: jAv, joueurs_apres: jAp,
      statut_avant: data.tournoi.statut, statut_apres: actif.statut,
      champion_avant: data.tournoi.champion_id, champion_apres: actif.champion_id,
    },
    modifies: modifies.slice(0, 100), ajoutes, supprimes,
  });
});

// Tirage à la bande: déclare qui casse en premier (joueur du match ou admin)
app.post('/api/match/:id/bande', (req, res, next) => {
  if (!matchDuClub(req, req.params.id)) return res.status(404).json({ error: "Match introuvable" }); // isolation club
  try {
    const m = M.setBande(Number(req.params.id), Number(req.body.joueur_id));
    majEtBroadcast();
    res.json({ ok: true, match: vueMatch(m) });
  } catch (e) { next(e); }
});

app.post('/api/match/:id/manche', (req, res) => {
  if (!matchDuClub(req, req.params.id)) return res.status(404).json({ error: "Match introuvable" }); // isolation club
  const joueurId = Number(req.body.joueur_id);
  if (!joueurId) return res.status(400).json({ error: 'joueur_id requis (gagnant de la manche)' });
  const m = M.declarerManche(Number(req.params.id), joueurId);
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.post('/api/match/:id/runout', (req, res) => {
  if (!matchDuClub(req, req.params.id)) return res.status(404).json({ error: "Match introuvable" }); // isolation club
  const joueurId = Number(req.body.joueur_id);
  if (!joueurId) return res.status(400).json({ error: 'joueur_id requis' });
  const kind = req.body.kind === 'casse' ? 'casse' : 'reprise';
  const m = M.declarerRunout(Number(req.params.id), joueurId, kind);
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.get('/api/joueur/:id/stats', (req, res) => {
  if (!joueurDuClub(req, req.params.id)) return res.status(404).json({ error: "Joueur introuvable" }); // isolation club
  const id = Number(req.params.id);
  const j = db.prepare('SELECT id, pseudo FROM joueur WHERE id = ?').get(id);
  if (!j) return res.status(404).json({ error: 'Joueur introuvable' });
  const { ids } = idsMemeJoueur(id, req.club.id);
  const ph = ids.map(() => '?').join(',');
  const matchs = db.prepare(`SELECT * FROM match WHERE (joueur1_id IN (${ph}) OR joueur2_id IN (${ph})) AND joueur1_id IS NOT NULL AND joueur2_id IS NOT NULL`).all(...ids, ...ids);
  const evs = db.prepare(`SELECT e.type, e.detail, e.match_id, m.tournoi_id FROM match_event e JOIN match m ON m.id = e.match_id WHERE e.joueur_id IN (${ph})`).all(...ids);
  // manches gagnées = somme des scores du joueur (fiable, pas de double comptage runout+manche)
  const manches = matchs.reduce((a, m) => a + (ids.includes(m.joueur1_id) ? m.score1 : 0) + (ids.includes(m.joueur2_id) ? m.score2 : 0), 0);
  const runouts = evs.filter(e => e.type === 'runout');
  const casse = runouts.filter(e => { try { return JSON.parse(e.detail || '{}').kind === 'casse'; } catch { return false; } }).length;
  const reprise = runouts.length - casse;
  // un match clôturé sans gagnant (tournoi arrêté) ne compte ni comme joué ni comme perdu
  const termines = matchs.filter(m => (m.etat === 'termine' || m.etat === 'forfait') && m.gagnant_id != null);
  const gagnes = termines.filter(m => ids.includes(m.gagnant_id)).length;
  const joues = termines.length;
  const enCours = matchs.filter(m => m.etat === 'en_cours').length;
  res.json({ joueur: j, joues, gagnes, perdus: joues - gagnes, enCours, manches, runouts: runouts.length, casse, reprise, winrate: joues ? Math.round(100 * gagnes / joues) : 0 });
});

app.post('/api/match/:id/retirer', (req, res) => {
  if (!matchDuClub(req, req.params.id)) return res.status(404).json({ error: "Match introuvable" }); // isolation club
  const joueurId = Number(req.body.joueur_id);
  if (!joueurId) return res.status(400).json({ error: 'joueur_id requis (à qui retirer la manche)' });
  const m = M.retirerManche(Number(req.params.id), joueurId);
  majEtBroadcast();
  res.json({ ok: true, match: vueMatch(m) });
});

app.get('/api/joueur/:id/matchs', (req, res) => {
  if (!joueurDuClub(req, req.params.id)) return res.status(404).json({ error: "Joueur introuvable" }); // isolation club
  const id = Number(req.params.id);
  const { ids: idsM } = idsMemeJoueur(id, req.club.id);
  const phM = idsM.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT * FROM match WHERE joueur1_id IN (${phM}) OR joueur2_id IN (${phM})
    ORDER BY tournoi_id DESC, CASE bracket WHEN 'WB' THEN 1 WHEN 'LB' THEN 2 ELSE 3 END, tour, position
  `).all(...idsM, ...idsM);
  res.json({ matchs: rows.map(vueMatch) });
});

app.get('/api/joueur/:id/historique', (req, res) => {
  if (!joueurDuClub(req, req.params.id)) return res.status(404).json({ error: "Joueur introuvable" }); // isolation club
  const id = Number(req.params.id);
  const j = db.prepare('SELECT id, pseudo FROM joueur WHERE id = ?').get(id);
  if (!j) return res.status(404).json({ error: 'Joueur introuvable' });
  const { ids: idsH } = idsMemeJoueur(id, req.club.id);
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
    WHERE (m.joueur1_id IN (${phH}) OR m.joueur2_id IN (${phH})) AND m.joueur1_id IS NOT NULL AND m.joueur2_id IS NOT NULL AND m.etat IN ('termine', 'forfait')
    ORDER BY m.ended_at DESC, m.id DESC
  `).all(...idsH, ...idsH);
  // head-to-head : bilan V/D contre chaque adversaire rencontré, agrégé par personne
  // (même compte ou même pseudo hors compte, exactement comme idsMemeJoueur) ;
  // rows étant triées par date décroissante, le premier match croisé = le plus récent
  const h2hMap = new Map();
  for (const m of rows) {
    if (m.gagnant_id == null) continue; // tournoi arrêté : ni V ni D
    const advRowId = idsH.includes(m.joueur1_id) ? m.joueur2_id : m.joueur1_id;
    if (advRowId == null) continue;
    const cle = Math.min(...idsMemeJoueur(advRowId, req.club.id).ids);
    const gagne = idsH.includes(m.gagnant_id);
    let e = h2hMap.get(cle);
    if (!e) {
      e = { adversaire: idsH.includes(m.joueur1_id) ? m.j2_pseudo : m.j1_pseudo, adversaire_id: advRowId, joues: 0, victoires: 0, defaites: 0, dernier_victoire: gagne };
      h2hMap.set(cle, e);
    }
    e.joues++;
    if (gagne) e.victoires++; else e.defaites++;
  }
  const h2h = [...h2hMap.values()].sort((a, b) => b.joues - a.joues || String(a.adversaire).localeCompare(String(b.adversaire)));
  res.json({
    joueur: j,
    h2h,
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
push.registerPushRoutes(app, { vueMatch });

app.get('/api/qrcode.svg', async (req, res) => {
  const text = String(req.query.text || BASE_URL).slice(0, 500);
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#0b0b10', light: '#ffffff' } });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  } catch (e) { res.status(500).json({ error: 'QR invalide' }); }
});

// health check (monitoring Fly/Render): vérifie que la BDD répond
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, db: 'ok', uptime_s: Math.round(process.uptime()) });
  } catch (e) {
    res.status(503).json({ ok: false, db: e.message });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

// middleware d'erreur global: toujours du JSON, jamais une page HTML d'erreur
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Body trop volumineux (max 256ko)' });
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return next(err);
  res.status(status).json({ error: err.message || 'Erreur serveur' });
});

// Purge auto des comptes inactifs > 18 mois (au boot + toutes les heures)
if (typeof comptes.purgerComptesInactifs === 'function') {
  try { comptes.purgerComptesInactifs(); } catch (e) { console.error('[PURGE]', e.message); }
  setInterval(() => { try { comptes.purgerComptesInactifs(); } catch {} }, 60 * 60 * 1000);
}

if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => { // 0.0.0.0 obligatoire sur Fly/Render sinon 'instance refused connection'
    console.log(`EBPC Tournoi Billard démarré sur 0.0.0.0:${PORT}`);
    // JAMAIS de log du PIN en clair (fuite dans les logs Fly/Render)
    console.log(process.env.ADMIN_PIN ? 'PIN admin: défini via ADMIN_PIN (secret)' : 'PIN admin: non défini, valeur par défaut active -> définis ADMIN_PIN !');
  });
  // arrêt propre (SIGTERM Fly au deploy, SIGINT local): on ferme les flux SSE puis la BDD
  let arretEnCours = false;
  function arretPropre(signal) {
    if (arretEnCours) return;
    arretEnCours = true;
    console.log(`[${signal}] arrêt propre…`);
    for (const c of clients) { try { c.write('event: bye\ndata: {}\n\n'); c.end(); } catch {} }
    clients.clear();
    server.close(() => {
      try { db.close(); } catch {}
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref(); // garde-fou si des connexions restent ouvertes
  }
  process.on('SIGTERM', () => arretPropre('SIGTERM'));
  process.on('SIGINT', () => arretPropre('SIGINT'));
}

module.exports = { app, broadcast };

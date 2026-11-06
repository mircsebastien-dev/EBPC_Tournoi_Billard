// Comptes joueurs : pseudo + email + mot de passe (scrypt), sessions cookie, réinit par mail (Resend)
const crypto = require('crypto');
const { db, logAudit } = require('./db');

const SESSION_COOKIE = 'ebpc_session';
const SESSION_JOURS = 30;
const RESET_VALIDITE_H = 1; // 1h

// ---------- mdp (scrypt natif, pas de dep externe) ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function nouveauSalt() { return crypto.randomBytes(16).toString('hex'); }
function verifierPassword(password, salt, hash) {
  const h = hashPassword(password, salt);
  const a = Buffer.from(h, 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

// ---------- mail (Resend si RESEND_API_KEY, sinon log) ----------
async function envoyerMail({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || 'Pink City Billard <no-reply@ebpc-tournoi.fly.dev>';
  if (!key) {
    console.log(`[MAIL dev - RESEND_API_KEY absent] to=${to} subject=${subject}\n${text}`);
    return { dev: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!r.ok) throw new Error('Resend: ' + (await r.text()).slice(0, 200));
  return { ok: true };
}

// ---------- rate limit basique en mémoire ----------
const rl = new Map();
function rateLimit(cle, max, fenetreMs) {
  const now = Date.now();
  const arr = (rl.get(cle) || []).filter(t => now - t < fenetreMs);
  if (arr.length >= max) return false;
  arr.push(now);
  rl.set(cle, arr);
  return true;
}

// ---------- helpers ----------
function comptePublic(c) { return c ? { id: c.id, pseudo: c.pseudo } : null; }
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setSessionCookie(res, token, jours) {
  const maxAge = jours * 24 * 3600;
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function creerSession(compteId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_JOURS * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO session (token_hash, compte_id, expires) VALUES (?, ?, ?)').run(hashToken(token), compteId, expires);
  // ménage
  db.prepare(`DELETE FROM session WHERE expires < datetime('now')`).run();
  return token;
}

function compteDepuisReq(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT c.id, c.pseudo, c.email, s.expires FROM session s JOIN compte c ON c.id = s.compte_id
    WHERE s.token_hash = ? AND s.expires > datetime('now')
  `).get(hashToken(token));
  return row || null;
}

function middlewareSession(req, res, next) {
  req.compte = compteDepuisReq(req);
  next();
}

function validerPseudo(p) {
  return typeof p === 'string' && /^[\p{L}\p{N}_\-]{2,24}$/u.test(p.trim());
}
function validerEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim()) && e.length <= 190;
}
function validerPassword(p) {
  return typeof p === 'string' && p.length >= 4 && p.length <= 128;
}

// ---------- routes ----------
function registerCompteRoutes(app, { baseUrl, tournoiActif, majEtBroadcast, vueMatch }) {
  // inscription compte
  app.post('/api/compte/inscription', (req, res) => {
    const ip = req.ip || 'local';
    if (!rateLimit('insc:' + ip, 5, 10 * 60 * 1000)) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans 10 min' });
    const pseudo = String(req.body.pseudo || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = req.body.password;
    if (!validerPseudo(pseudo)) return res.status(400).json({ error: 'Pseudo invalide (2-24 caractères : lettres, chiffres, _ -)' });
    if (!validerEmail(email)) return res.status(400).json({ error: 'Email invalide' });
    if (!validerPassword(password)) return res.status(400).json({ error: 'Mot de passe trop court (min 4 caractères)' });
    const existe = db.prepare('SELECT id FROM compte WHERE pseudo = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(pseudo, email);
    if (existe) return res.status(409).json({ error: 'Pseudo ou email déjà utilisé' });
    const salt = nouveauSalt();
    const info = db.prepare('INSERT INTO compte (pseudo, email, pass_hash, salt) VALUES (?, ?, ?, ?)')
      .run(pseudo, email, hashPassword(password, salt), salt);
    const compte = db.prepare('SELECT id, pseudo, email FROM compte WHERE id = ?').get(info.lastInsertRowid);
    const token = creerSession(compte.id);
    setSessionCookie(res, token, SESSION_JOURS);
    logAudit('compte_cree', `compte ${compte.id}`, null, { pseudo: compte.pseudo });
    res.status(201).json({ ok: true, compte: comptePublic(compte) });
  });

  // connexion
  app.post('/api/compte/connexion', (req, res) => {
    const ip = req.ip || 'local';
    if (!rateLimit('conn:' + ip, 10, 10 * 60 * 1000)) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans 10 min' });
    const pseudo = String(req.body.pseudo || '').trim();
    const password = req.body.password;
    const c = db.prepare('SELECT * FROM compte WHERE pseudo = ? COLLATE NOCASE').get(pseudo);
    if (!c || !verifierPassword(password, c.salt, c.pass_hash)) {
      return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
    }
    const token = creerSession(c.id);
    setSessionCookie(res, token, SESSION_JOURS);
    logAudit('compte_connexion', `compte ${c.id}`, null, { pseudo: c.pseudo });
    res.json({ ok: true, compte: comptePublic(c) });
  });

  // déconnexion
  app.post('/api/compte/deconnexion', (req, res) => {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM session WHERE token_hash = ?').run(hashToken(token));
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // moi
  app.get('/api/compte/moi', (req, res) => {
    if (!req.compte) return res.json({ compte: null, joueur_id: null });
    const j = db.prepare('SELECT id FROM joueur WHERE compte_id = ? ORDER BY id DESC LIMIT 1').get(req.compte.id);
    res.json({ compte: comptePublic(req.compte), joueur_id: j ? j.id : null });
  });

  // mes matchs (via les joueurs liés à mon compte)
  app.get('/api/compte/moi/matchs', (req, res) => {
    if (!req.compte) return res.status(401).json({ error: 'Non connecté' });
    const rows = db.prepare(`
      SELECT m.* FROM match m JOIN joueur j ON (j.id = m.joueur1_id OR j.id = m.joueur2_id)
      WHERE j.compte_id = ?
      ORDER BY m.tournoi_id DESC, m.tour, m.position
    `).all(req.compte.id);
    res.json({ matchs: rows.map(r => vueMatch(r)) });
  });

  // mot de passe oublié -> mail avec lien de réinit
  app.post('/api/compte/oubli', async (req, res) => {
    const ip = req.ip || 'local';
    if (!rateLimit('oubli:' + ip, 3, 60 * 60 * 1000)) return res.status(429).json({ error: 'Trop de demandes, réessaie plus tard' });
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!validerEmail(email)) return res.status(400).json({ error: 'Email invalide' });
    const c = db.prepare('SELECT * FROM compte WHERE email = ? COLLATE NOCASE').get(email);
    // réponse identique même si le compte n'existe pas (pas d'énumération)
    let devLink = null;
    if (c) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + RESET_VALIDITE_H * 3600 * 1000).toISOString();
      db.prepare('UPDATE compte SET reset_token_hash = ?, reset_expires = ? WHERE id = ?').run(hashToken(token), expires, c.id);
      const link = `${baseUrl}/reinit.html?token=${token}`;
      await envoyerMail({
        to: c.email,
        subject: 'Réinitialisation de ton mot de passe — Pink City Billard',
        text: `Bonjour ${c.pseudo},\n\nTu as demandé à réinitialiser ton mot de passe. Clique sur ce lien (valable 1h) :\n${link}\n\nSi tu n'es pas à l'origine de la demande, ignore ce mail.`,
        html: `<p>Bonjour <b>${c.pseudo}</b>,</p><p>Tu as demandé à réinitialiser ton mot de passe. Clique sur ce lien (valable 1h) :</p><p><a href="${link}">${link}</a></p><p>Si tu n'es pas à l'origine de la demande, ignore ce mail.</p>`,
      });
      if (!process.env.RESEND_API_KEY) devLink = link; // visible en dev/test uniquement
      logAudit('compte_oubli', `compte ${c.id}`, null, { pseudo: c.pseudo });
    }
    res.json({ ok: true, message: 'Si un compte existe pour cet email, un lien de réinitialisation vient d\'être envoyé.', dev_reset_link: devLink });
  });

  // réinitialisation via token
  app.post('/api/compte/reinit', (req, res) => {
    const token = String(req.body.token || '');
    const password = req.body.password;
    if (!token || token.length < 32) return res.status(400).json({ error: 'Lien invalide' });
    if (!validerPassword(password)) return res.status(400).json({ error: 'Mot de passe trop court (min 4 caractères)' });
    const c = db.prepare(`SELECT * FROM compte WHERE reset_token_hash = ? AND reset_expires > datetime('now')`).get(hashToken(token));
    if (!c) return res.status(400).json({ error: 'Lien invalide ou expiré (valable 1h)' });
    const salt = nouveauSalt();
    db.prepare('UPDATE compte SET pass_hash = ?, salt = ?, reset_token_hash = NULL, reset_expires = NULL WHERE id = ?')
      .run(hashPassword(password, salt), salt, c.id);
    // invalide les sessions existantes
    db.prepare('DELETE FROM session WHERE compte_id = ?').run(c.id);
    const newToken = creerSession(c.id);
    setSessionCookie(res, newToken, SESSION_JOURS);
    logAudit('compte_reinit', `compte ${c.id}`, null, { pseudo: c.pseudo });
    res.json({ ok: true, compte: { id: c.id, pseudo: c.pseudo } });
  });

  // self-enrollment au tournoi actif avec le pseudo du compte
  app.post('/api/tournoi/inscrire', (req, res) => {
    if (!req.compte) return res.status(401).json({ error: 'Crée un compte ou connecte-toi d\'abord (pseudo + email + mot de passe)' });
    const t = tournoiActif();
    if (!t) return res.status(404).json({ error: 'Aucun tournoi actif' });
    if (t.statut !== 'inscription') return res.status(409).json({ error: 'Les inscriptions sont fermées (tournoi lancé)' });
    if (t.taille && t.nb_inscrits >= t.taille) return res.status(409).json({ error: 'Tournoi complet' });
    // déjà inscrit via ce compte ?
    const deja = db.prepare('SELECT j.* FROM joueur j WHERE j.tournoi_id = ? AND j.compte_id = ?').get(t.id, req.compte.id);
    if (deja) return res.status(409).json({ error: `Déjà inscrit en tant que ${deja.pseudo}`, joueur: { id: deja.id, pseudo: deja.pseudo, statut: deja.statut } });
    // un joueur anonyme avec le même pseudo existe déjà -> on le rattache au compte
    const anon = db.prepare('SELECT * FROM joueur WHERE tournoi_id = ? AND pseudo = ? COLLATE NOCASE').get(t.id, req.compte.pseudo);
    if (anon) {
      db.prepare('UPDATE joueur SET compte_id = ? WHERE id = ?').run(req.compte.id, anon.id);
      logAudit('inscription', `joueur ${anon.id}`, null, { compte: req.compte.pseudo, rattache: true });
      majEtBroadcast();
      return res.json({ ok: true, rattache: true, joueur: { id: anon.id, pseudo: anon.pseudo, statut: anon.statut } });
    }
    const info = db.prepare('INSERT INTO joueur (tournoi_id, pseudo, statut, compte_id) VALUES (?, ?, ?, ?)')
      .run(t.id, req.compte.pseudo, 'en_attente', req.compte.id);
    logAudit('inscription', `joueur ${info.lastInsertRowid}`, null, { compte: req.compte.pseudo });
    majEtBroadcast();
    res.status(201).json({ ok: true, joueur: { id: Number(info.lastInsertRowid), pseudo: req.compte.pseudo, statut: 'en_attente' } });
  });
}

module.exports = { registerCompteRoutes, middlewareSession, hashToken, SESSION_COOKIE };

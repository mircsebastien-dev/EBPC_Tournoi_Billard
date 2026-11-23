const API = '';

// multi-club: ?club=<slug> dans l'URL est mémorisé et envoyé en header X-Club sur tous les appels API
const CLUB_KEY = 'ebpc_club';
try {
  const c = new URLSearchParams(location.search).get('club');
  if (c) localStorage.setItem(CLUB_KEY, c);
} catch {}
function clubHeaders() {
  try { const c = localStorage.getItem(CLUB_KEY); return c ? { 'X-Club': c } : {}; } catch { return {}; }
}
// 19a. Tournoi affiché : mémorisé par club (sélecteur du bandeau) ; /api/etat?tournoi_id= cible ce tournoi,
// sans choix -> le tournoi actif du club (comportement d origine)
const TOURNOI_SEL_KEY_19a = () => { try { return 'ebpc_tournoi_' + (localStorage.getItem(CLUB_KEY) || ''); } catch { return 'ebpc_tournoi_'; } };
function tournoiChoisi19a() {
  try {
    const v = localStorage.getItem(TOURNOI_SEL_KEY_19a());
    const n = v == null ? NaN : Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}
function urlEtat19a() { const id = tournoiChoisi19a(); return '/api/etat' + (id != null ? '?tournoi_id=' + id : ''); }
// 17n. suffixe ?club= pour les <img>/<fetch> qui ne portent pas l en-tête X-Club (bannière de l accueil, photo de fond TV)
function qsClub17n() {
  try { const c = localStorage.getItem(CLUB_KEY); return c ? '?club=' + encodeURIComponent(c) : ''; } catch { return ''; }
}

// 17s. Étanchéité multi-club : les liens internes portent le club dans l URL.
// 2 apps installées du même site (une par club) partagent le même stockage : une URL sans ?club=
// rouvrirait le DERNIER club utilisé. Chaque clic sur un lien interne reçoit donc le club courant,
// le contexte ne quitte plus jamais la page (interception au clic : sans toucher aux <a> un par un).
// 17s: paramètre club=<slug> prêt à concaténer à une URL interne ('' si aucun club mémorisé)
function clubParam17s() {
  try { const c = localStorage.getItem(CLUB_KEY); return c ? 'club=' + encodeURIComponent(c) : ''; } catch { return ''; }
}

// 20a. Hub plateforme : les pages SANS club explicite (accueil / sans ?club=, page joueur de la plateforme)
// sont NEUTRES : la page n appartient à aucun club, aucun accent, logo, bannière ou badge de club ne doit
// s y appliquer (EBPC est un club comme les autres). Toute autre page garde le comportement d origine.
function pageSansClub20a() {
  try {
    if (!['/', '/index.html', '/joueurs.html'].includes(location.pathname)) return false;
    const p20b = new URLSearchParams(location.search);
    if (p20b.get('hub')) return true; // 20b: ?hub=1 force le hub (retour depuis une page de club), même avec un club mémorisé
    if (location.pathname === '/joueurs.html') return true; // 20b: page joueur = toujours plateforme
    return !p20b.get('club');
  } catch (e) { return false; }
}
document.addEventListener('click', (e) => {
  try {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('/') || href.startsWith('//')) return;
    if (/[?&]hub=/.test(href)) return; // 20b: ?hub=1 (retour au hub de la plateforme) : pas une page de club, jamais de club ajouté
    if (/[?&]club=/.test(href)) return; // le club est déjà explicite dans le lien
    const param17s = clubParam17s();
    if (!param17s) return;
    a.setAttribute('href', href + (href.includes('?') ? '&' : '?') + param17s);
  } catch {}
}, true);

// 17j. Personnalisation du club : l admin du club choisit une couleur d accent (remplace le rose partout),
// visible par TOUS les visiteurs des pages du club. Anti-flash : cache localStorage par slug (ebpc_accent_club)
// appliqué avant le premier rendu, puis rafraîchi par GET /api/club-theme (léger, public).
// La page TV garde volontairement le thème sombre d origine.
const ACCENT_KEY = 'ebpc_accent_club';
let accentClubApplique = ''; // dernier accent appliqué (re-appliqué au changement de thème: le soft dépend du thème)
// accent -> HSL (h 0-360, s 0-1, l 0-1), pour garantir la lisibilité de la teinte dérivée
function accentVersHsl(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, s, l];
}
function appliquerAccentClub(hex) {
  if (!/^[#][0-9a-fA-F]{6}$/.test(hex)) return;
  try {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    accentClubApplique = hex;
    // --pink-soft sert de TEXTE (grands scores de la page match, score des cards, liens, titres) :
    // on garde la TEINTE du club mais on garantit la LISIBILITÉ sur le fond du thème courant,
    // sinon un accent sombre rend le score invisible (retour Sébastien, 17j v2).
    const [h, s, l] = accentVersHsl(r, g, b);
    const clair = document.documentElement.dataset.theme === 'light';
    const sPct = Math.round(Math.min(1, Math.max(0, s)) * 100);
    const lPct = clair ? Math.round(Math.min(l, 0.50) * 100) : Math.round(Math.max(l, 0.66) * 100);
    // --pink-fort (17j v5, retour Sébastien « accent blanc ») : l accent comme FOND à texte blanc
    // (boutons, interrupteurs, badges actifs, surbrillances). Un accent trop clair (blanc, pastel)
    // rend le texte blanc invisible -> luminosité plafonnée à 45 %, teinte et saturation conservées,
    // identique aux deux thèmes (le texte des boutons est blanc dans les deux). --pink reste la teinte
    // brute pour les bordures et le décor, --pink-soft reste la teinte de TEXTE lisible.
    const lFond = Math.min(l, 0.45);
    const pinkFond = lFond === l ? hex : `hsl(${Math.round(h)}, ${sPct}%, ${Math.round(lFond * 100)}%)`;
    document.documentElement.style.setProperty('--pink', hex);
    document.documentElement.style.setProperty('--pink-fort', pinkFond);
    document.documentElement.style.setProperty('--pink-soft', `hsl(${Math.round(h)}, ${sPct}%, ${lPct}%)`);
    document.documentElement.style.setProperty('--pink-glow', `rgba(${r}, ${g}, ${b}, 0.22)`);
  } catch {}
}
function accentDepuisCache() {
  try {
    if (location.pathname.startsWith('/tv.html')) return; // page TV : thème sombre d origine, jamais d accent de club
    if (pageSansClub20a()) return; // 20a: accueil hub et joueur de la plateforme : pages neutres, aucun accent de club
    const stocke = JSON.parse(localStorage.getItem(ACCENT_KEY) || '{}');
    const k = localStorage.getItem(CLUB_KEY) || '_defaut';
    if (typeof stocke[k] === 'string' && stocke[k] !== '#d6336c') appliquerAccentClub(stocke[k]);
  } catch {}
}
// ATTENTION: rafraichirThemeClub() appelle api(), qui référence LANG (const déclaré plus bas dans ce fichier).
// TDZ: l appeler avant la déclaration lèverait « Cannot access 'LANG' before initialization » (avalée par le
// catch -> /api/club-theme jamais appelé -> accent jamais appliqué). L APPEL se fait en FIN de fichier.
function rafraichirThemeClub() {
  try {
    if (location.pathname.startsWith('/tv.html')) return; // page TV : jamais d accent de club
    if (pageSansClub20a()) return; // 20a: accueil hub et joueur de la plateforme : neutres, ni logo ni badge de club
    api('/api/club-theme').then((th) => {
      if (!th || !th.accent) return;
      const stocke = JSON.parse(localStorage.getItem(ACCENT_KEY) || '{}');
      stocke[th.slug] = th.accent;
      if (!localStorage.getItem(CLUB_KEY)) stocke._defaut = th.accent;
      localStorage.setItem(ACCENT_KEY, JSON.stringify(stocke));
      appliquerAccentClub(th.accent);
      const stockeL = JSON.parse(localStorage.getItem(LOGO_KEY) || '{}'); // 17k: logo + mode d affichage, même pattern
      stockeL[th.slug] = { l: logoValide17k(th.logo) ? (th.logo || '') : '', m: logoModeValide(th.logo_mode) ? th.logo_mode : 'les-deux' };
      if (!localStorage.getItem(CLUB_KEY)) stockeL._defaut = stockeL[th.slug];
      localStorage.setItem(LOGO_KEY, JSON.stringify(stockeL));
      appliquerLogoClub(th.logo, th.logo_mode);
      // 17o. Icône du club sur l écran du téléphone : manifeste et apple-touch-icon du club courant
      // (nom, couleur et icône de l app installée ; posés ici pour toutes les pages, replis gérés par le serveur)
      try {
        // 17t. iOS/Safari RETIRE la query des liens d installation et ne lit que le PREMIER manifeste de la page :
        const p17t = th.slug ? encodeURIComponent(th.slug) : ''; // chemins par club pour manifeste, icône et splash
        let mf17o = document.querySelector('link[rel="manifest"]');
        if (!mf17o) { mf17o = document.createElement('link'); mf17o.rel = 'manifest'; document.head.append(mf17o); } // 17t: jamais de base générique, directement le chemin du club ci-dessous
        const mfHref17t = p17t ? '/manifest-' + p17t + '.webmanifest' : '/manifest.webmanifest'; // 17t: chemin par club (Safari retire la query), garde le club dans start_url à l installation
        if (mf17o.getAttribute('href') !== mfHref17t) mf17o.href = mfHref17t;
        let at17o = document.querySelector('link[rel="apple-touch-icon"]');
        if (!at17o) { at17o = document.createElement('link'); at17o.rel = 'apple-touch-icon'; document.head.append(at17o); } // 17t: jamais de base générique, directement le chemin du club ci-dessous
        const atHref17t = p17t ? '/icone-' + p17t + '.png' : '/apple-touch-icon.png'; // 17t: chemin par club (Safari retire la query), repli générique côté serveur
        if (at17o.getAttribute('href') !== atHref17t) at17o.href = atHref17t;
        const mt17o = document.querySelector('meta[name="theme-color"]');
        if (mt17o && mt17o.content !== th.accent) mt17o.content = th.accent; // 17o: barre d état du téléphone aux couleurs du club
        // 17q. Splash iPhone : images de démarrage par taille d écran, servies par club (fond accent + icône) ;
        // Android, lui, lit background_color du manifeste (mis à l accent côté serveur)
        const TAILLES_SPLASH_17Q = [
          [320, 568, 2, 640, 1136], [375, 667, 2, 750, 1334], [375, 812, 3, 1125, 2436], [390, 844, 3, 1170, 2532],
          [393, 852, 3, 1179, 2556], [414, 736, 3, 1242, 2208], [414, 896, 2, 828, 1792], [414, 896, 3, 1242, 2688],
          [428, 926, 3, 1284, 2778], [430, 932, 3, 1290, 2796],
        ];
        for (const d17q of TAILLES_SPLASH_17Q) {
          const media17q = 'screen and (device-width: ' + d17q[0] + 'px) and (device-height: ' + d17q[1] + 'px) and (-webkit-device-pixel-ratio: ' + d17q[2] + ')';
          let ls17q = document.querySelector('link[rel="apple-touch-startup-image"][media="' + media17q + '"]');
          if (!ls17q) { ls17q = document.createElement('link'); ls17q.rel = 'apple-touch-startup-image'; ls17q.media = media17q; document.head.append(ls17q); }
          ls17q.href = p17t ? '/splash/' + p17t + '/' + d17q[3] + 'x' + d17q[4] + '.png' : '/api/club-splash?w=' + d17q[3] + '&h=' + d17q[4]; // 17t: chemin par club, jamais de query (iOS la retire à l installation)
        }
        // 17r. Badge du club courant dans le bandeau (hors TV, jamais ici ; hors console super-admin) :
        // on voit TOUJOURS le nom du club qu on regarde, la multi-club ne doit jamais être invisible
        // 24b/24c: sur les pages dont le titre est la marque générique « 🎱 Pink City Billard », le club
        // EST la marque (retour Sébastien) : le titre devient le nom du club, l icône reste en haut à gauche
        // sur la même ligne et le badge est retiré (il ne ferait que doubler le titre) ; sur les pages au
        // titre descriptif le titre reste et le badge se place DANS le titre en fin de ligne (24b, jamais empilé)
        if (th.slug && th.nom && !location.pathname.startsWith('/console.html')) {
          const h1b17r = document.querySelector('header.top h1');
          if (h1b17r) {
            if (h1b17r.textContent.trim() === '🎱 Pink City Billard') { // 24c: marque générique -> nom du club
              const chip24c = document.getElementById('logo-entete-club');
              if (chip24c) chip24c.remove(); // textContent efface les enfants: le logo d en-tête repart après
              h1b17r.textContent = th.nom;
              if (chip24c) h1b17r.prepend(chip24c);
              const bd24c = document.getElementById('club-badge-17r');
              if (bd24c) bd24c.remove(); // 24c: plus de badge, le nom du club est le titre
            } else {
              let bd17r = document.getElementById('club-badge-17r');
              if (!bd17r) {
                bd17r = document.createElement('span');
                bd17r.id = 'club-badge-17r';
                bd17r.style.cssText = 'margin-left:10px;padding:2px 10px;border-radius:99px;font-size:.72em;font-weight:700;border:1px solid var(--pink);color:var(--pink);white-space:nowrap;vertical-align:middle;max-width:58vw;overflow:hidden;text-overflow:ellipsis';
                h1b17r.append(bd17r); // 24b: dans le titre (plus jamais un frère sous le h1, empilé en colonne mobile)
              }
              if (bd17r.textContent !== th.nom) bd17r.textContent = th.nom;
            }
          }
        }
      } catch {}
    }).catch(() => {});
  } catch {}
}
// 17k. Logo du club (prédéfini servi statique ou importé en data:image) : affiché en FILIGRANE très discret
// centré sur toutes les pages (derrière le contenu, jamais cliquable) + en petit à côté du nom du club.
// Même pattern anti-flash que l accent : cache localStorage par slug (ebpc_logo_club), AUCUN appel réseau ici
// (logoDepuisCache est appelé en haut de fichier, avant api()/LANG : mêmes contraintes TDZ que accentDepuisCache).
const LOGO_KEY = 'ebpc_logo_club';
function logoValide17k(l) {
  if (typeof l !== 'string') return false;
  if (l === '' || /^\/logos\/[a-z0-9-]+\.svg$/.test(l)) return true; // prédéfini de la bibliothèque
  return /^data:image\/(?:png|jpeg|svg\+xml);base64,[A-Za-z0-9+\/]+={0,2}$/.test(l) && l.length <= 200000; // import plafonné (17k v9: le + du base64 manquait ici alors que le serveur l accepte -> un logo importé contenant un + était refusé par le front: ni filigrane ni en-tête jamais affichés, même après enregistrement)
}
const LOGO_MODES = ['entete', 'filigrane', 'les-deux']; // 17k switch: où afficher le logo
function logoModeValide(m) { return LOGO_MODES.includes(m); }
function appliquerLogoClub(logo, mode) {
  try {
    const chemin = logoValide17k(logo) ? logo : '';
    const lesDeux = !logoModeValide(mode) || mode === 'les-deux'; // mode absent/corrompu -> les deux
    // filigrane centré : PEINT AU-DESSUS du contenu (les panneaux ont des fonds OPAQUES: derrière (z-index:-1)
    // il était invisible), très discret (opacité 7%), jamais cliquable ni sélectionnable
    let wm = document.getElementById('filigrane-logo');
    if (chemin && (lesDeux || mode === 'filigrane')) {
      if (!wm) {
        wm = document.createElement('img');
        wm.id = 'filigrane-logo';
        wm.alt = '';
        wm.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);max-width:min(62vmin,430px);max-height:62vmin;opacity:.1;pointer-events:none;user-select:none;';
        document.body.append(wm);
      }
      wm.src = chemin;
    } else if (wm) wm.remove();
    // petit logo d en-tête, à côté du nom du club
    const h1 = document.querySelector('header.top h1');
    if (h1) {
      let chip = document.getElementById('logo-entete-club');
      if (chemin && (lesDeux || mode === 'entete')) {
        if (!chip) {
          chip = document.createElement('img');
          chip.id = 'logo-entete-club';
          chip.alt = '';
          chip.style.cssText = 'height:1.25em;vertical-align:-.25em;margin-right:8px;border-radius:6px;';
          h1.prepend(chip);
        }
        chip.src = chemin;
      } else if (chip) chip.remove();
    }
    // 17n. Favicon du club : le logo devient la favicon de l onglet sur toutes les pages où le logo s affiche
    // (prédéfinis /logos ou data:), repli sur /favicon.svg quand il n y a aucun logo (jamais d URL externe)
    let fav17n = document.querySelector('link[rel="icon"]');
    if (chemin) {
      if (!fav17n) { fav17n = document.createElement('link'); fav17n.rel = 'icon'; document.head.append(fav17n); }
      fav17n.type = chemin.startsWith('data:image/svg+xml') || chemin.startsWith('/logos/') ? 'image/svg+xml' : (chemin.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png');
      fav17n.href = chemin;
    } else if (fav17n && fav17n.getAttribute('href') !== '/favicon.svg') {
      fav17n.type = 'image/svg+xml';
      fav17n.href = '/favicon.svg';
    }
  } catch {}
}
function logoDepuisCache() {
  try {
    if (location.pathname.startsWith('/tv.html')) return; // page TV : filigrane exclu comme l accent
    if (pageSansClub20a()) return; // 20a: accueil hub et joueur de la plateforme : neutres, aucun logo de club
    const stocke = JSON.parse(localStorage.getItem(LOGO_KEY) || '{}');
    const k = localStorage.getItem(CLUB_KEY) || '_defaut';
    const entree = stocke[k];
    if (entree && typeof entree.l === 'string' && entree.l) appliquerLogoClub(entree.l, entree.m); // {l: logo, m: mode}
    else if (typeof entree === 'string' && entree) appliquerLogoClub(entree, 'les-deux'); // ancien format
  } catch {}
}
accentDepuisCache(); // anti-flash: cache local uniquement, AVANT le premier rendu, sans aucun appel réseau
logoDepuisCache(); // 17k: logo du club, même anti-flash, toujours sans réseau

// i18n front : langue choisie dans le compte (ebpc_lang), defaut fr. t() traduit via le dictionnaire,
// avec repli sur le francais si la chaine est absente (aucun changement en mode fr).
const LANG = (() => { try { const v = localStorage.getItem('ebpc_lang'); return ['en','es','it','de'].includes(v) ? v : 'fr'; } catch { return 'fr'; } })();
const I18N = {
  "🎨 Apparence du club": "🎨 Club appearance",
  "Couleur d accent": "Accent colour",
  "Nom par défaut des tournois": "Default tournament name",
  "Jour récurrent": "Recurring day",
  "Heure habituelle": "Usual time",
  "Personnalisation enregistrée": "Personalization saved",
  "Visible par tous les visiteurs du club.": "Visible to every visitor of the club.",
  "Logo du club": "Club logo",
  "Aucun logo": "No logo",
  "Logo prédéfini ou importé, affiché en filigrane discret et à côté du nom du club pour tous les visiteurs.": "Preset or imported logo, shown as a discreet watermark and next to the club name for every visitor.",
  "Importer une image (PNG/JPG/SVG, photo jusqu à 8 Mo, réduite à 256 px)": "Import an image (PNG/JPG/SVG, photo up to 8 MB, shrunk to 256 px)",
  "Logo trop volumineux ou format non supporté": "Logo too large or unsupported format",
  "Logo refusé": "Logo rejected",
  "Aperçu du logo retenu : « Enregistrer » l applique aux pages du club pour tous les visiteurs.": "Preview of the selected logo: \"Save\" applies it to the club pages for all visitors.",
  "Logo importé": "Imported logo",
  "Adresse par défaut du club": "Default club address",
  "Attendu : image PNG, JPG ou SVG décodable (photo iPhone acceptée), 8 Mo maximum.": "Expected: a decodable PNG, JPG or SVG image (iPhone photo accepted), 8 MB maximum.",
  "Cause : fichier plus lourd que la limite de 8 Mo.": "Cause: file heavier than the 8 MB limit.",
  "Cause probable : le navigateur n a pas réussi à décoder ce fichier (fichier endommagé ou format d image exotique).": "Likely cause: the browser could not decode this file (damaged file or exotic image format).",
  "Cause probable : le fichier SVG est vide ou ne contient pas de balise <svg>.": "Likely cause: the SVG file is empty or contains no <svg> tag.",
  "Affichage du logo": "Logo display",
  "Logo d en-tête": "Header logo",
  "Filigrane": "Watermark",
  "Logo + filigrane": "Logo + watermark",
  "Dimanche": "Sunday",
  "Lundi": "Monday",
  "Mardi": "Tuesday",
  "Mercredi": "Wednesday",
  "Jeudi": "Thursday",
  "Vendredi": "Friday",
  "Samedi": "Saturday",
  "Clubs": "Clubs",
  "Créer un club": "Create a club",
  "Nom du club": "Club name",
  "Code PIN du club": "Club PIN code",
  "Code PIN propre": "Own PIN code",
  "Comptes rattachés": "Linked accounts",
  "Actif": "Active",
  "Inactif": "Inactive",
  "Activer": "Activate",
  "Rôles du club": "Club roles",
  "Administrateur": "Administrator",
  "Opérateur": "Operator",
  "Retirer": "Remove",
  "Aide": "Help",
  "Amis": "Friends",
  "Annuler": "Cancel",
  "Aucun ami pour le moment": "No friends yet",
  "Aucun historique": "No history",
  "Aucun match pour le moment": "No matches yet",
  "Aucun tournoi pour le moment": "No tournament right now",
  "Aucun tournoi": "No tournament",
  "Aucune donnée": "No data",
  "Bille perdue": "Ball lost",
  "Bille perdue ?": "Ball lost?",
  "Classement": "Ranking",
  "Club": "Club",
  "Compte": "Account",
  "Confidentialité": "Privacy",
  "Confirmation": "Confirmation",
  "Connecté": "Logged in",
  "Connecte-toi pour t'inscrire": "Log in to enter",
  "Créer mon compte": "Create my account",
  "Créer un compte": "Create an account",
  "Déconnexion": "Log out",
  "Défaite": "Loss",
  "Défaillant": "Losing",
  "Détails": "Details",
  "Distance": "Distance",
  "En cours": "Ongoing",
  "Enregistrer": "Save",
  "En cours de match": "Playing now",
  "Envoi du lien de réinitialisation...": "Sending the reset link...",
  "Envoi...": "Sending...",
  "Erreur": "Error",
  "Fermer": "Close",
  "Final": "Final",
  "Finale": "Final",
  "Forfait": "Forfeit",
  "Gagnant": "Winner",
  "gagnant": "winner",
  "Gagné": "Won",
  "Historique": "History",
  "Honnêteté": "Sportsmanship",
  "Inconnu": "Unknown",
  "Inscrits": "Registered",
  "Inscription": "Entry",
  "Inséré": "Entered",
  "Interrompu": "Interrupted",
  "Joueur": "Player",
  "Mon tournoi": "My tournament",
  "Joueurs": "Players",
  "jour": "day",
  "Langue": "Language",
  "Manche": "Frame",
  "Manches": "Frames",
  "Manches gagnées": "Frames won",
  "Match": "Match",
  "Matchs": "Matches",
  "Matchs en direct": "Live matches",
  "Me désinscrire": "Unregister me",
  "Mon espace": "My space",
  "Mot de passe": "Password",
  "Mot de passe oublié ?": "Forgot password?",
  "Modifier": "Edit",
  "Mute": "Mute",
  "Notifications": "Notifications",
  "Nom": "Name",
  "Non": "No",
  "Oui": "Yes",
  "Ouvrir": "Open",
  "Paramètres": "Settings",
  "Perdu": "Lost",
  "Perdant": "Loser",
  "perdant": "loser",
  "Pseudo": "Username",
  "Prévu": "Scheduled",
  "Prêt": "Ready",
  "Points": "Points",
  "Quitter": "Leave",
  "Rafraîchir": "Refresh",
  "Rejouer": "Replay",
  "Remerciements": "Credits",
  "Retour": "Back",
  "Réduire": "Collapse",
  "Réglages": "Settings",
  "Score": "Score",
  "Se connecter": "Log in",
  "Se déconnecter": "Log out",
  "Sécurité": "Security",
  "Statistiques": "Statistics",
  "Stats": "Stats",
  "Suivre": "Follow",
  "Suivi": "Following",
  "Suivre un joueur": "Follow a player",
  "Table de marque": "Scoreboard",
  "← Table de marque": "← Scoreboard",
  "Tables": "Tables",
  "Terminé": "Finished",
  "Terminer": "Finish",
  "Thème": "Theme",
  "Titres": "Titles",
  "Ton compte": "Your account",
  "Tournoi": "Tournament",
  "Tournoi précédent": "Previous tournament",
  "Tournois": "Tournaments",
  "Tout voir": "See all",
  "Tableau": "Bracket",
  "Vainqueur": "Winner",
  "Valider": "Submit",
  "Victoire": "Win",
  "Victoires": "Wins",
  "Vues": "Views",
  "Échec": "Failed",
  "Éditer": "Edit",
  "Préférences": "Preferences",
  "Prénom": "First name",
  "Email": "Email",
  "Chargement...": "Loading...",
  "Charger plus": "Load more",
  "Changer de club": "Change club",
  "M'inscrire": "Enter",
  "Inscriptions": "Entries",
  "Nombre de joueurs": "Number of players",
  "Numéro de match": "Match number",
  "Aucun joueur trouvé": "No player found",
  "Aucun résultat": "No result",
  "Tournoi terminé": "Tournament finished",
  "Tournoi en cours": "Tournament ongoing",
  "Tirage au sort": "Draw",
  "tirage": "draw",
  "Faute": "Foul",
  "Fautes": "Fouls",
  "Meilleure série": "Best run",
  "Membre": "Member",
  "Membres": "Members",
  "Suite": "Next",
  "Suivant": "Next",
  "Précédent": "Previous",
  "Accueil": "Home",
  "Aucun": "None",
  "Aucune": "None",
  "Ajouter": "Add",
  "Supprimer": "Delete",
  "Confirmer": "Confirm",
  "Copier": "Copy",
  "Copié !": "Copied!",
  "Attention": "Warning",
  "Info": "Info",
  "Libre": "Free",
  "Occupée": "Busy",
  "Manche en cours": "Frame ongoing",
  "Match en cours": "Match ongoing",
  "Clic = éditer (admin)": "Click = edit (admin)",
  "Déjà suivi": "Already followed",
  "Ne plus suivre": "Unfollow",
  "Face à face": "Head to head",
  "Adversaire": "Opponent",
  "Adversaires": "Opponents",
  "Série": "Run",
  "Séries": "Runs",
  "Trois quarts": "Quarter finals",
  "Quarts": "Quarters",
  "Demis": "Semis",
  "Demi-finales": "Semi finals",
  "Poules": "Groups",
  "Poule": "Group",
  "Vidéos": "Videos",
  "A propos": "About",
  "Voir": "See",
  "Voir tout": "See all",
  "Eight Ball Pink City — Tournoi": "Eight Ball Pink City — Tournament",
  "Mon compte — Pink City Billard": "My account — Pink City Billard",
  "Paramètres — Pink City Billard": "Settings — Pink City Billard",
  "Amis — Pink City Billard": "Friends — Pink City Billard",
  "Mes matchs — Pink City Billard": "My matches — Pink City Billard",
  "Match — Pink City Billard": "Match — Pink City Billard",
  "Fiche joueur — Pink City Billard": "Player page — Pink City Billard",
  "Stats joueurs — Pink City Billard": "Player stats — Pink City Billard",
  "Joueur — Pink City Billard": "Player — Pink City Billard",
  "Tableau — Pink City Billard": "Bracket — Pink City Billard",
  "Tournoi archivé — Pink City Billard": "Archived tournament — Pink City Billard",
  "Historique — Pink City Billard": "History — Pink City Billard",
  "Historique admin — Pink City Billard": "Admin history — Pink City Billard",
  "Mot de passe oublié — Pink City Billard": "Forgot password — Pink City Billard",
  "Nouveau mot de passe — Pink City Billard": "New password — Pink City Billard",
  "Table de marque — Pink City Billard": "Scoreboard — Pink City Billard",
  "Gérer le tournoi — Pink City Billard": "Manage tournament — Pink City Billard",
  "Journal d'audit — Pink City Billard": "Audit log — Pink City Billard",
  "Comptes joueurs — Table de marque": "Player accounts — Scoreboard",
  "🗄 Données — Table de marque": "🗄 Data — Scoreboard",
  "❓ Aide — Tournoi EBPC": "❓ Help — EBPC Tournament",
  "🔒 Confidentialité — Tournoi EBPC": "🔒 Privacy — EBPC Tournament",
  "⚙️ Guide admin — Tournoi EBPC": "⚙️ Admin guide — EBPC Tournament",
  "dimanche": "Sunday",
  "lundi": "Monday",
  "mardi": "Tuesday",
  "mercredi": "Wednesday",
  "jeudi": "Thursday",
  "vendredi": "Friday",
  "samedi": "Saturday",
  "Casse la manche en cours": "Break the current frame",
  "Gagnés": "Won",
  "Joués": "Played",
  "Mon compte": "My account",
  "Phase finale": "Final stage",
  "⏳ match attendu": "⏳ match pending",
  "▶ Lancer": "▶ Start",
  "🏅 Classement": "🏅 Ranking",
  "💾 Enregistrer le score": "💾 Save the score",
  "PIN invalide — reconnecte-toi dans l'admin": "Invalid PIN — log back into the admin",
  "Annulé : code non saisi": "Cancelled: code not entered",
  "Annulé : mot de confirmation non saisi": "Cancelled: confirmation word not entered",
  "Effacer le code mémorisé (sera redemandé à la prochaine action admin)": "Clear the saved code (it will be asked again on the next admin action)",
  "Verrouiller la table de marque ? Le code PIN sera redemandé.": "Lock the scoreboard? The PIN code will be asked again.",
  "connecte-toi avec un compte admin": "log in with an admin account",
  "pour confirmer :": "to confirm:",
  "— aucune —": "— none —",
  "✏️ Score (correction)": "✏️ Score (correction)",
  "👥 Joueurs du match": "👥 Match players",
  "🔐 Table de marque": "🔐 Scoreboard",
  "🔓 Rouvrir le match": "🔓 Reopen the match",
  "Permission refusée": "Permission denied",
  "Push non supporté sur ce navigateur": "Push not supported on this browser",
  "❓ Aide": "❓ Help",
  "🎱 S'inscrire": "🎱 Entering",
  "Compte (bouton « Compte » en haut à droite) → pseudo + email + mot de passe, puis « M'inscrire » sur l'accueil. Sans compte : champ pseudo sur l'accueil, mais pas de notif push ni d'historique perso. Inscrit par erreur ? Bouton « Me désinscrire » (accueil ou page compte), tant que les inscriptions sont ouvertes et avant paiement (déjà payé : voir la table de marque).": "Account (\"Account\" button top right) → username + email + password, then \"Enter\" on the home page. Without an account: username field on the home page, but no push notification and no personal history. Entered by mistake? \"Unregister me\" button (home or account page), as long as registration is open and before payment (already paid: see the scoreboard).",
  "🔔 Notifications « à toi de jouer »": "🔔 \"Your turn to play\" notifications",
  "Ajoute d'abord le site à l'écran d'accueil : Android → ⋯ → « Installer l'application » ; iPhone → OUVRIR LE SITE DANS SAFARI (obligatoire, Chrome iOS ne le permet pas) → Partager → « Sur l'écran d'accueil ». Ouvre ensuite l'app depuis l'écran d'accueil, puis Compte → 🔔 Activer les notifications. Au lancement de ton match tu reçois une notif — un tap ouvre directement la card du match (même écran verrouillé).": "First add the site to your home screen: Android → ⋯ → \"Install app\"; iPhone → OPEN THE SITE IN SAFARI (required, Chrome iOS does not allow it) → Share → \"Add to Home Screen\". Then open the app from the home screen, then Account → 🔔 Enable notifications. When your match starts you get a notification — one tap opens the match card directly (even on the lock screen).",
  "Tu reçois aussi une notif « 🎱 Nouveau tournoi — inscriptions ouvertes » quand la table de marque crée un tournoi (sauf si elle a désactivé le switch 🔔 du formulaire de création).": "You also get a \"🎱 New tournament — registration open\" notification when the scoreboard creates a tournament (unless it disabled the 🔔 switch in the creation form).",
  "🗺️ Suivre le tournoi": "🗺️ Follow the tournament",
  "Tableau : vue bracket (onglets Tout / WB / LB / Phase finale, liens entre matchs sur l’onglet final) ou liste, liste déroulante « Aller au tour », filtre joueur avec Entrée. Dans un match pas encore joué, la place inconnue affiche « gagnant wb1-001 », « perdant lb2-003 » ou « blanc » : tu sais d’où vient le joueur que tu attends. Match en cours = entouré en rouge, terminé = bord vert, gagnant en vert. Avant le tirage au sort, le tableau affiche déjà la structure à vide : les places du tour 1 sont numérotées j1, j2, ... (jusqu’à j32 pour un tableau de 32), tu vois donc le format du tournoi dès sa création. · 📺 TV pour la salle · « Mon tournoi » = tes matchs · 📊 Stats · 🗂 Historique.": "Bracket: bracket view (All / WB / LB / Final stage tabs, links between matches on the final tab) or list, \"Go to round\" dropdown, player filter with Enter. In a match not yet played, the unknown slot shows \"winner wb1-001\", \"loser lb2-003\" or \"blank\": you know where the player you are waiting for comes from. Ongoing match = red outline, finished = green border, winner in green. Before the draw, the bracket already shows the empty structure: round 1 slots are numbered j1, j2, ... (up to j32 for a 32 bracket), so you see the tournament format as soon as it is created. · 📺 TV for the room · \"My tournament\" = your matches · 📊 Stats · 🗂 History.",
  "🎲 Jouer un match": "🎲 Play a match",
  "Au lancement, panneau « Tirage à la bande » : chaque joueur fait rouler une bille, le plus proche de la bande gagne → clique « ⚪ [pseudo] casse ». La ⚪ alterne ensuite à chaque manche.": "At match start, \"Lag\" panel: each player rolls a ball, the closest to the cushion wins → click \"⚪ [username] breaks\". The ⚪ then alternates every frame.",
  "Saisie : +1 manche pour le gagnant de la manche, −1 pour corriger (la ⚪ revient alors à l’état précédent). 💥 Casse ferme = réservé au joueur ⚪ (l'autre bouton est grisé). 🎯 Reprise ferme = réservé à l'autre. Dernier point → confirmation du score avec possibilité de modifier.": "Scoring: +1 frame for the frame winner, −1 to correct (the ⚪ then goes back to its previous state). 💥 Break and run = reserved for the ⚪ player (the other button is greyed out). 🎯 Re-rack = reserved for the other. Last point → score confirmation with a chance to edit.",
  "🔑 Mot de passe oublié": "🔑 Forgot password",
  "Compte → « Mot de passe oublié » → email → lien de réinit (valable 1 h).": "Account → \"Forgot password\" → email → reset link (valid for 1 h).",
  "👥 Amis": "👥 Friends",
  "Compte → section Amis : recherche un pseudo (Entrée) et ajoute un ami. Tu reçois une notif push « match d'un ami » quand son match commence, et tu vois son statut en direct (en cours vs …, programmé, inscrit) sur ton compte et sur l'accueil.": "Account → Friends section: search a username (Enter) and add a friend. You get a \"friend's match\" push notification when their match starts, and you see their live status (ongoing vs …, scheduled, entered) on your account and on the home page.",
  "📊 Mon historique": "📊 My history",
  "Compte → « 📊 Ma fiche joueur » : joués/gagnés, %, manches, run-outs + historique de tous tes matchs.": "Account → \"📊 My player page\": played/won, %, frames, run-outs + the history of all your matches.",
  "👤 Ton compte": "👤 Your account",
  "Ton email est masqué (affiché partiellement) ; changement séparé. Un match contre blanc (bye) ne compte ni gagné ni perdu dans tes stats.": "Your email is masked (partially shown); changed separately. A match against a blank (bye) counts as neither won nor lost in your stats.",
  "Guide complet : docs/GUIDE_UTILISATEUR.md dans le dépôt GitHub.": "Full guide: docs/GUIDE_UTILISATEUR.md in the GitHub repository.",
  "🔒 Confidentialité & données": "🔒 Privacy & data",
  "Ce qu'on collecte": "What we collect",
  "Tournoi : inscriptions, matchs, scores, événements, statistiques": "Tournament: entries, matches, scores, events, statistics",
  "Compte joueur : pseudo, email, mot de passe (hashé scrypt+salt, jamais en clair)": "Player account: username, email, password (scrypt+salt hashed, never in plain text)",
  "Notifications push : uniquement si tu les actives (opt-in), abonnement révocable à tout moment": "Push notifications: only if you enable them (opt-in), subscription revocable at any time",
  "Ce qu'on ne fait PAS": "What we do NOT do",
  "Aucun cookie de tracking/publicité, aucune revente de données, aucun partage à des tiers (sauf envoi d'emails via Resend pour la réinitialisation de mot de passe).": "No tracking/advertising cookies, no data resale, no sharing with third parties (except emails sent via Resend for password reset).",
  "Finalités & base légale": "Purposes & legal basis",
  "Faire fonctionner le tournoi (inscriptions, matchs, scores, classements, notifications) = exécution du service demandé. Les emails servent uniquement à la réinit du mot de passe. Les données sont conservées tant que le compte est actif ; les comptes inactifs 18 mois sont supprimés automatiquement.": "Running the tournament (entries, matches, scores, rankings, notifications) = execution of the requested service. Emails are only used for password reset. Data is kept as long as the account is active; accounts inactive for 18 months are deleted automatically.",
  "Hébergement": "Hosting",
  "Application hébergée sur Fly.io (société américaine) en région Paris (cdg), base SQLite sur volume. Un transfert hors UE peut exister côté infrastructure ; les données restent sous notre responsabilité.": "Application hosted on Fly.io (US company) in the Paris (cdg) region, SQLite database on a volume. A transfer outside the EU may exist on the infrastructure side; the data remains our responsibility.",
  "Responsable du traitement": "Data controller",
  "Voir avec la table de marque du tournoi.": "Contact the tournament scoreboard.",
  "Technique : cookie de session strictement nécessaire (HttpOnly, SameSite, Secure), préférences navigateur (localStorage : joueur suivi, vue tableau)": "Technical: strictly necessary session cookie (HttpOnly, SameSite, Secure), browser preferences (localStorage: followed player, bracket view)",
  "Mots de passe hashés (scrypt + sel), sessions en cookie HttpOnly/SameSite/Secure, tokens de réinit hashés et valables 1 h, rate-limit sur connexion/inscription. Contact en cas d'incident : via la table de marque.": "Passwords hashed (scrypt + salt), sessions in HttpOnly/SameSite/Secure cookies, reset tokens hashed and valid for 1 h, rate limit on login/signup. Contact in case of an incident: via the scoreboard.",
  "✏️ Rectification : changer pseudo/email dans le compte ; corrections admin possibles": "✏️ Rectification: change username/email in the account; admin corrections possible",
  "📥 Accès/export : bouton « Exporter mes données » dans ton compte (JSON complet)": "📥 Access/export: \"Export my data\" button in your account (full JSON)",
  "🗑 Effacement : suppression du compte par l'admin (les matchs restent dans l'historique anonymisé du tournoi), purge auto 18 mois": "🗑 Erasure: account deleted by the admin (matches remain in the tournament's anonymised history), automatic purge after 18 months",
  "🚫 Opposition : désactive les notifications push à tout moment": "🚫 Objection: disable push notifications at any time",
  "Donne l'email de ton compte : on t'envoie un lien de réinitialisation (valable 1h).": "Enter your account email: we will send you a reset link (valid for 1h).",
  "Envoyer le lien": "Send the link",
  "🔐 Nouveau mot de passe": "🔐 New password",
  "Changer le mot de passe": "Change the password",
  "Nouveau mot de passe (min 4)": "New password (min 4)",
  "✅ Mot de passe changé, tu es connecté. Redirection…": "✅ Password changed, you are logged in. Redirecting…",
  "Joueur introuvable.": "Player not found.",
  "Bilan tous tournois confondus.": "Record across all tournaments.",
  "Résultat": "Result",
  "Statistiques joueurs (tous les tournois)": "Player statistics (all tournaments)",
  "Aucune statistique pour le moment.": "No statistics yet.",
  "🔴 À toi de jouer": "🔴 Your turn to play",
  "Qui es-tu ?": "Who are you?",
  "Touche ton pseudo ci-dessous.": "Tap your username below.",
  "Tes matchs": "Your matches",
  "Aucun match pour le moment. Le tirage arrive bientôt ! 🎱": "No matches yet. The draw is coming soon! 🎱",
  "Aucun tournoi en cours.": "No ongoing tournament.",
  "🎱 Aucun tournoi en cours": "🎱 No ongoing tournament",
  "Aller au tour :": "Go to round:",
  "— Choisir un tour —": "— Pick a round —",
  "🔍 Filtrer par joueur (ex: seb) — Entrée pour valider": "🔍 Filter by player (e.g. seb) — Enter to apply",
  "Le tableau (structure à vide) apparaîtra ici dès la création d'un tournoi, les joueurs après le tirage au sort.": "The bracket (empty structure) will appear here as soon as a tournament is created, and the players after the draw.",
  "📊 Statistiques du tournoi": "📊 Tournament statistics",
  "🔍 Surligner un joueur (ex: seb) — Entrée pour valider": "🔍 Highlight a player (e.g. seb) — Enter to apply",
  "Aucun tournoi terminé pour le moment.": "No finished tournament yet.",
  "Tous les tournois terminés restent consultables ici.": "All finished tournaments remain available here.",
  "Voir le tableau": "See the bracket",
  "La TV Pink City est pensée pour le mode paysage": "The Pink City TV is designed for landscape mode",
  "Tourne l'écran en paysage": "Turn your screen to landscape",
  "QR code du site": "Site QR code",
  "Scanner pour ouvrir le site sur ton téléphone": "Scan to open the site on your phone",
  "🎉 Félicitations ! 🎉": "🎉 Congratulations! 🎉",
  "Champion de la Pink City": "Pink City champion",
  "En attente des matchs…": "Waiting for matches…",
  "Le tournoi va bientôt commencer": "The tournament will start soon",
  "🎱 Aucun tournoi pour le moment": "🎱 No tournament right now",
  "🏁 TERMINÉ": "🏁 FINISHED",
  "📱 Scanne pour ouvrir le site": "📱 Scan to open the site",
  "📱 Scanne pour t'inscrire": "📱 Scan to enter",
  "Inscriptions ouvertes": "Registration open",
  "🏁 Terminé": "🏁 Finished",
  "👤 Mon compte": "👤 My account",
  "🗺 Voir le tableau complet →": "🗺 See the full bracket →",
  "— hors tournoi": "— outside the tournament",
  "Aucun ami — ajoute-en depuis le menu Compte.": "No friends — add some from the Account menu.",
  "Inscrit par erreur ? Tu peux te désinscrire tant que les inscriptions sont ouvertes et que tu n'as pas payé.": "Entered by mistake? You can unregister as long as registration is open and you have not paid.",
  "Jamais inscrit à un tournoi de ce club — pas de fiche": "Never entered a tournament in this club — no player page",
  "Revenez bientôt !": "Come back soon!",
  "Te désinscrire du tournoi ?": "Unregister from the tournament?",
  "Ton pseudo": "Your username",
  "gérer mon compte": "manage my account",
  "Élimination directe": "Single elimination",
  "💡 Crée un compte (pseudo + email + mot de passe) pour t'inscrire en 1 clic et retrouver tes stats :": "💡 Create an account (username + email + password) to enter in 1 click and find your stats:",
  "💰 Déjà payé : la désinscription se fait auprès de la table de marque (remboursement à voir avec le club).": "💰 Already paid: unregistering is done at the scoreboard (refund to be discussed with the club).",
  "📝 inscrit au tournoi": "📝 entered in the tournament",
  "✨ Créer un compte": "✨ Create an account",
  "Juste un pseudo, un email et un mot de passe. Rien d'autre.": "Just a username, an email and a password. Nothing else.",
  "Ma fiche joueur": "My player page",
  "Email (pour réinit du mot de passe)": "Email (for password reset)",
  "Nouvel email (vide = inchangé)": "New email (empty = unchanged)",
  "Email inchangé": "Email unchanged",
  "✅ Email mis à jour": "✅ Email updated",
  "Mot de passe (min 4)": "Password (min 4)",
  "Se déconnecter ?": "Log out?",
  "(sans compte)": "(no account)",
  "📋 Mon inscription": "📋 My entry",
  "Possible tant que les inscriptions sont ouvertes et que tu n'as pas payé.": "Possible as long as registration is open and you have not paid.",
  "Exporter mes données (RGPD)": "Export my data (GDPR)",
  "Voir aussi : 🔒 Confidentialité (menu ☰)": "See also: 🔒 Privacy (☰ menu)",
  "Aucun ami pour le moment — recherche un pseudo ci-dessus.": "No friends yet — search a username above.",
  "déjà ami": "already a friend",
  "Suis des joueurs : tu reçois une notif quand leur match commence ou quand ils s'inscrivent à un tournoi, et leur statut ici. Pas besoin de compte pour eux : entre son pseudo dans la recherche puis « Suivre ».": "Follow players: you get a notification when their match starts or when they enter a tournament, and their status here. They do not need an account: type their username in the search then \"Follow\".",
  "🔔 Notifier quand le match d'un ami commence": "🔔 Notify me when a friend's match starts",
  "🔔 Notifier quand un ami s'inscrit à un tournoi": "🔔 Notify me when a friend enters a tournament",
  "Activer les notifications": "Enable notifications",
  "Désactiver": "Disable",
  "Tester la notification": "Test the notification",
  "Notifications activées !": "Notifications enabled!",
  "Notifications désactivées": "Notifications disabled",
  "⚠️ Aucun appareil abonné — active les notifications avant.": "⚠️ No subscribed device — enable notifications first.",
  "Reçois une notification push quand un de tes matchs est lancé (même écran verrouillé).": "Get a push notification when one of your matches starts (even on the lock screen).",
  "📱 Sur iPhone : ajoute d'abord le site à l'écran d'accueil (Safari → Partager → « Sur l'écran d'accueil »), puis active les notifications.": "📱 On iPhone: first add the site to the home screen (Safari → Share → \"Add to Home Screen\"), then enable notifications.",
  "Pas (encore !) d'inscription ni de match à afficher.": "No registration or match to display (yet!).",
  "🔍 Rechercher un pseudo… (Entrée)": "🔍 Search a username… (Enter)",
  "🎱 Match en direct": "🎱 Live match",
  "← Mes matchs": "← My matches",
  "+1 manche": "+1 frame",
  "−1 manche": "−1 frame",
  "🎲 Tirage à la bande": "🎲 Lag",
  "Chaque joueur fait rouler une bille sur le tapis : le plus proche de la bande remporte le tirage et casse en premier (⚪).": "Each player rolls a ball on the cloth: the closest to the cushion wins the lag and breaks first (⚪).",
  "En attente de la table…": "Waiting for the table…",
  "La table de marque va lancer le match…": "The scoreboard will start the match…",
  "La saisie des points est bloquée tant que le tirage à la bande n'est pas fait.": "Scoring is locked until the lag is done.",
  "Confirmer le score": "Confirm the score",
  "Vérifie le score sur la table avant de confirmer.": "Check the score at the table before confirming.",
  "Modifier (annuler ce point)": "Edit (cancel this point)",
  "⚠️ Dernier point ?": "⚠️ Last point?",
  "Le joueur qui a la casse ne fait pas de reprise ferme": "The player who breaks cannot re-rack",
  "Seul le joueur qui a la casse peut faire une casse ferme": "Only the player who breaks can break and run",
  "Match introuvable.": "Match not found.",
  "Consultation seule — tu ne joues pas ce match.": "View only — you are not playing this match.",
  "🎱 Table de marque": "🎱 Scoreboard",
  "Espace table de marque": "Scoreboard area",
  "📌 Accès rapide": "📌 Quick access",
  "Comptes joueurs": "Player accounts",
  "Configurer / gérer le tournoi": "Configure / manage the tournament",
  "Données": "Data",
  "Journal d'audit": "Audit log",
  "Aucun tournoi actif pour le moment.": "No active tournament right now.",
  "Nouveau tournoi": "New tournament",
  "Créer le tournoi": "Create the tournament",
  "Règle": "Rule",
  "Taille max": "Max size",
  "Nombre de tables": "Number of tables",
  "📅 Date et heure": "📅 Date and time",
  "Têtes de série": "Seeds",
  "Préfixe": "Prefix",
  "N° série": "Seed #",
  "Double KO + tableau final": "Double KO + final bracket",
  "Double KO sur": "Double KO on",
  "Finale seule": "Final only",
  "Distance spéciale": "Special distance",
  "Distance spéciale à partir de": "Special distance from",
  "Réservées à partir du tour n° (vide = quarts)": "Reserved from round # (empty = quarters)",
  "Tables réservées en phase finale (jamais utilisées en auto à partir des quarts)": "Tables reserved for the final stage (never used automatically from the quarter-finals)",
  "Ordre des tables (mode auto)": "Table order (auto mode)",
  "Ajuster auto la taille au nombre de payés": "Auto-adjust size to the number of paid players",
  "Nouveau joueur": "New player",
  "Lancer le tirage ? Inscriptions closes.": "Start the draw? Registration will be closed.",
  "▶ Simuler tout le tournoi": "▶ Simulate the whole tournament",
  "⚠️ Clôturer le tournoi": "⚠️ Close the tournament",
  "Terminer le tournoi maintenant": "Finish the tournament now",
  "Terminer le tournoi maintenant ?": "Finish the tournament now?",
  "Termine le tournoi immédiatement (même si la finale n'a pas été jouée). Les tableaux restent en ligne.": "Finishes the tournament immediately (even if the final has not been played). The brackets stay online.",
  "Supprimer le tournoi": "Delete the tournament",
  "Supprimer le tournoi et TOUT son contenu ?": "Delete the tournament and ALL its content?",
  "Enregistré ✅": "Saved ✅",
  "✅ Tournoi importé": "✅ Tournament imported",
  "📥 Exporter le tournoi actif": "📥 Export the active tournament",
  "📤 Importer un JSON": "📤 Import a JSON",
  "Exporte le tournoi actif en JSON (backup, rejouer ailleurs), ou importe un export (remplace le tournoi actif — code PIN re-demandé).": "Export the active tournament as JSON (backup, replay elsewhere), or import an export (replaces the active tournament — PIN code asked again).",
  "🗺 Voir / éditer les matchs": "🗺 See / edit the matches",
  "Ouvrir le tableau": "Open the bracket",
  "Ouvrir l'historique": "Open the history",
  "🎱 Tables disponibles": "🎱 Available tables",
  "🎱 Table auto (libre)": "🎱 Auto table (free)",
  "🤖 Mode auto :": "🤖 Auto mode:",
  "Mode auto :": "Auto mode:",
  "🤖 Gestion automatique": "🤖 Automatic management",
  "Lance automatiquement le prochain match dès qu'un match se termine (priorité : Tour 1, puis LB1#1, WB2#1, LB2#1…).": "Automatically starts the next match as soon as one finishes (priority: Round 1, then LB1#1, WB2#1, LB2#1…).",
  "🔔 Notif push « inscriptions ouvertes »": "🔔 \"Registration open\" push notification",
  "🔔 Rappel inscriptions ouvertes (push aux joueurs abonnés)": "🔔 Registration reminder (push to subscribed players)",
  "Clique sur un match du tableau pour lancer, corriger le score, déclarer un forfait ou rouvrir — sans quitter le tableau.": "Click a bracket match to start it, fix the score, declare a forfeit or reopen — without leaving the bracket.",
  "📏 Distances (modifiables à tout moment)": "📏 Distances (editable at any time)",
  "Inscrit des joueurs fictifs en masse, directement payés.": "Enters fake players in bulk, directly paid.",
  "— aucun (coupe net) —": "— none (straight cut) —",
  "ex: 1,2 (vide = aucune)": "e.g. 1,2 (empty = none)",
  "marquer payé": "mark as paid",
  "🗄 Gestion des données": "🗄 Data management",
  "👥 Joueurs": "👥 Players",
  "🎱 Matchs": "🎱 Matches",
  "📜 Events d'un match": "📜 Match events",
  "Choisis un match.": "Pick a match.",
  "Aucun tournoi actif.": "No active tournament.",
  "Aucun événement.": "No event.",
  "🔍 Filtrer (pseudo/joueur) — Entrée": "🔍 Filter (username/player) — Enter",
  "➕ manche": "➕ frame",
  "🎲 tirage à la bande": "🎲 lag",
  "🚀 lancement": "🚀 match start",
  "▶ tournoi actif": "▶ active tournament",
  "État": "State",
  "(recalcul du score)": "(score recalculated)",
  "Supprimer cet événement ? Le score sera recalculé.": "Delete this event? The score will be recalculated.",
  "👤 Comptes joueurs": "👤 Player accounts",
  "Aucun compte.": "No account.",
  "Aucun ami": "No friend",
  "Aucune notification activée": "No notification enabled",
  "Créé le": "Created",
  "Dernière connexion": "Last login",
  "Nb inscri. tournois": "Tournament entries",
  "✏️ pseudo": "✏️ username",
  "Renommer le pseudo du compte": "Rename the account username",
  "Changer le mot de passe du compte": "Change the account password",
  "🔍 Rechercher (pseudo ou email)…": "🔍 Search (username or email)…",
  "✅ Pseudo changé": "✅ Username changed",
  "✅ Mot de passe changé (sessions invalidées)": "✅ Password changed (sessions invalidated)",
  "Rétrograder en simple utilisateur (le PIN restera nécessaire pour l’admin)": "Demote to regular user (the PIN will still be required for the admin)",
  "Promouvoir administrateur (sa session suffira pour l’admin, sans PIN)": "Promote to administrator (their session will be enough for the admin, without PIN)",
  "Rétrograder": "Demote",
  "Rechercher (action, cible, détails)…": "Search (action, target, details)…",
  "Action exacte (ex: tirage)": "Exact action (e.g. draw)",
  "Vider le journal": "Clear the log",
  "Vider tout le journal d'audit ? (irréversible)": "Clear the whole audit log? (irreversible)",
  "✖ Tout afficher": "✖ Show all",
  "⏪ Restaurer à ce point": "⏪ Restore to this point",
  "✅ Tournoi restauré": "✅ Tournament restored",
  "Le contenu actuel du tournoi sera remplacé.": "The current tournament content will be replaced.",
  "Exemples de matchs modifiés:": "Examples of changed matches:",
  "⚙️ Guide admin": "⚙️ Admin guide",
  "1. Créer le tournoi": "1. Create the tournament",
  "2. Inscriptions": "2. Registration",
  "3. Tirage": "3. Draw",
  "4. Lancer les matchs": "4. Start the matches",
  "5. Interventions en cours (clic card avec PIN → modale ⚙️)": "5. In-match interventions (card click with PIN → ⚙️ modal)",
  "6. Données (/admin-data.html)": "6. Data (/admin-data.html)",
  "7. Classement par points": "7. Points ranking",
  "8. Clôturer": "8. Closing",
  "9. Annuler une action : rollback point-in-time (journal d'audit)": "9. Undo an action: point-in-time rollback (audit log)",
  "10. Comptes & audit": "10. Accounts & audit",
  "11. Tests & déploiement": "11. Tests & deployment",
  "Accès : code PIN (env `ADMIN_PIN`) ou session d'un compte avec le rôle `admin` (bootstrap via `ADMIN_EMAIL`/`ADMIN_PASSWORD`, promotion depuis /admin-comptes.html).": "Access: PIN code (`ADMIN_PIN` env) or the session of an account with the `admin` role (bootstrap via `ADMIN_EMAIL`/`ADMIN_PASSWORD`, promoted from /admin-comptes.html).",
  "/admin-tournoi.html → nom, règle, taille (16/32/64/128), format (élim. directe / double KO + nb tours), nb tables, date. Ajustement auto à la taille des payés. Tables réservées: vide par défaut. En phase inscription, la TV montre un grand QR centré pour s'inscrire. Switch 🔔 « Notif push « inscriptions ouvertes » (coché par défaut) : à la création, un push « 🎱 Nouveau tournoi — inscriptions ouvertes » est envoyé à tous les comptes abonnés.": "/admin-tournoi.html → name, rule, size (16/32/64/128), format (single elimination / double KO + rounds), table count, date. Auto-adjust to the number of paid players. Reserved tables: empty by default. During registration, the TV shows a big centred QR code to enter. 🔔 \"Registration open\" push switch (checked by default): on creation, a \"🎱 New tournament — registration open\" push is sent to all subscribed accounts.",
  "Ajouter / simuler / payer / supprimer. Seuls les payés sont tirés. ⛔ Pseudo d'un compte = réservé: inscription anonyme refusée (409, anti-usurpation); ajout admin possible après confirmation (joueur rattaché au compte). Un invité qui crée un compte avec le même pseudo est rattaché auto (reçoit les pushs). ♻️ Un compte connecté peut se désinscrire lui-même (bouton « Me désinscrire »), en phase d'inscription uniquement et avant paiement ; un joueur déjà payé ou sans compte passe par un admin. Pseudo/mdp oublié → /admin-comptes.html (✏️ pseudo, 🔑 mdp).": "Add / simulate / pay / delete. Only paid players are drawn. ⛔ An account's username = reserved: anonymous entry refused (409, anti-impersonation); admin addition possible after confirmation (player linked to the account). A guest who creates an account with the same username is auto-linked (receives the pushes). ♻️ A logged-in account can unregister itself (\"Unregister me\" button), during registration only and before payment; an already-paid player or one without an account goes through an admin. Forgotten username/password → /admin-comptes.html (✏️ username, 🔑 password).",
  "Bouton Tirage: appariements aléatoires crypto, byes répartis. ⚠️ Fige le bracket (retour en arrière possible uniquement par rollback point-in-time via le journal d'audit, voir §9).": "Draw button: crypto-random pairings, byes spread out. ⚠️ Freezes the bracket (going back only possible via point-in-time rollback in the audit log, see §9).",
  "Mode auto ON = départ auto sur table libre (ordre personnalisable). Manuel: clic sur une card (PIN) → modale. Tirage à la bande ⚪ sur la card, puis alternance à chaque manche. Joueurs: seul le ⚪ fait « casse ferme », l'autre « reprise ferme » (grisé + 403). Dernier point = confirmation obligatoire.": "Auto mode ON = auto start on a free table (customisable order). Manual: click a card (PIN) → modal. Lag ⚪ on the card, then alternating every frame. Players: only the ⚪ does \"break and run\", the other \"re-rack\" (greyed out + 403). Last point = mandatory confirmation.",
  "✏️ Corriger le score (si distance atteinte → termine + propage)": "✏️ Fix the score (if distance reached → finishes + propagates)",
  "🎱 Déplacer de table (409 si occupée, « aucune » pour libérer)": "🎱 Move to another table (409 if busy, \"none\" to free it)",
  "👥 Changer les joueurs (WB/LB, blanc possible, bye auto) — 409 auto si la paire est déjà appariée ailleurs (hors finale): rematch impossible": "👥 Change the players (WB/LB, blank possible, auto bye) — auto 409 if the pair is already paired elsewhere (except the final): rematch impossible",
  "🔓 Rouvrir un match — ⚠️ 409 INTERDIT si un match aval a déjà commencé": "🔓 Reopen a match — ⚠️ 409 FORBIDDEN if a downstream match has already started",
  "🚫 Forfait (définitif)": "🚫 Forfeit (final)",
  "Onglets Matchs / Joueurs / Events sur le tournoi actif OU un tournoi terminé (sélecteur), filtre par pseudo (Entrée). Events: 🗑 supprime un event et recalcule le score → les stats se corrigent. Joueurs: éditer pseudo/statut, supprimer.": "Matchs / Players / Events tabs on the active tournament OR a finished tournament (selector), filter by username (Enter). Events: 🗑 deletes an event and recalculates the score → stats fix themselves. Players: edit username/status, delete.",
  "Points = profondeur atteinte (WB: tour, F: k+tour en DKO), ex-aequo (1,1,1,4…). Les matchs clôturés sans gagnant ne comptent pas comme perdus.": "Points = depth reached (WB: round, F: k+round in DKO), ties (1,1,1,4…). Matches closed without a winner do not count as losses.",
  "Règles DKO: WB/LB séparés jusqu'en finale; en F, alternance des moitiés + swap anti-rematch auto sur tous les tours WB/LB/F (rematch autorisé uniquement en vraie finale).": "DKO rules: WB/LB separate until the final; in F, halves alternate + auto anti-rematch swap on all WB/LB/F rounds (rematch allowed only in a true final).",
  "« Terminer maintenant » = coupe net, aucun champion auto (sauf choix explicite dans le select). Fin normale = champion auto via la finale. Historique ensuite en liste + recherche/surbrillance joueur.": "\"Finish now\" = straight cut, no auto champion (unless explicitly chosen in the select). Normal finish = auto champion via the final. History then as a list + search/player highlight.",
  "/admin-journal.html : chaque action admin est loguée ET snapshotée. Bouton ⏮ « Restaurer à ce point » sur une entrée = restaure le tournoi actif à l'état exact de cet événement (transaction atomique ; fonctionne même avec des matchs en cours → remis à 0-0, tables libérées). Un diff (matchs modifiés/ajoutés/supprimés, joueurs, statut, champion) s'affiche dans la confirmation avant validation. 409 si le snapshot concerne un autre tournoi, 404 sans snapshot. Le rollback est lui-même logué. Filtres du journal : recherche texte + type d'action.": "/admin-journal.html: every admin action is logged AND snapshotted. ⏮ \"Restore to this point\" button on an entry = restores the active tournament to the exact state of that event (atomic transaction; works even with ongoing matches → reset to 0-0, tables freed). A diff (changed/added/deleted matches, players, status, champion) shows in the confirmation before validating. 409 if the snapshot is from another tournament, 404 without snapshot. The rollback itself is logged. Log filters: text search + action type.",
  "/admin-comptes.html: liste (dernière connexion, inscri., matchs, sessions, amis : amis avec compte + pseudos suivis sans compte), ✏️ pseudo, 🔑 mdp, 🗑 supprimer (historique matchs conservé). Purge auto des comptes inactifs > 18 mois. /admin-journal.html: 500 dernières actions admin, lancements lisibles (« wb1-001 — P11 vs P07 (table 3) »). Le rollback point-in-time (bouton ⏮ « Restaurer à ce point ») est détaillé §9. 🔐 Toute action destructive (suppression tournoi/compte/event, vidage du journal, rollback) exige le code PIN re-saisi (modale masquée, `confirm_pin`) — sauf la désinscription d'un joueur. Une session de compte avec le rôle `admin` ne redemande pas le PIN, mais exige de saisir le mot `SUPPRIMER` dans la modale de confirmation.": "/admin-comptes.html: list (last login, entries, matches, sessions, friends: friends with accounts + followed usernames without accounts), ✏️ username, 🔑 password, 🗑 delete (match history kept). Automatic purge of accounts inactive > 18 months. /admin-journal.html: last 500 admin actions, readable starts (\"wb1-001 — P11 vs P07 (table 3)\"). The point-in-time rollback (⏮ \"Restore to this point\" button) is detailed in §9. 🔐 Every destructive action (tournament/account/event deletion, log clearing, rollback) requires the PIN re-entered (masked modal, `confirm_pin`) — except unregistering a player. An account session with the `admin` role does not ask for the PIN again, but requires typing the word `SUPPRIMER` in the confirmation modal.",
  "Batterie: BASE=http://127.0.0.1:PORT node test/batterie.js (203 checks → test/rapport.md) + test/e2e.js + test/fullrun.js ; sans serveur : node test/push-unit.js (push mocké), node test/purge-unit.js (purge > 90 j). Fly: secrets ADMIN_PIN, RESEND_API_KEY, MAIL_FROM, VAPID_* (jamais BASE_URL); volume tournoi_data sur /data; snapshots dans Volumes.": "Battery: BASE=http://127.0.0.1:PORT node test/batterie.js (203 checks → test/rapport.md) + test/e2e.js + test/fullrun.js ; without a server: node test/push-unit.js (mocked push), node test/purge-unit.js (purge > 90 d). Fly: secrets ADMIN_PIN, RESEND_API_KEY, MAIL_FROM, VAPID_* (never BASE_URL); tournoi_data volume on /data; snapshots in Volumes.",
  "Version complète: docs/GUIDE_ADMIN.md dans le dépôt GitHub.": "Full version: docs/GUIDE_ADMIN.md in the GitHub repository.",
  "Aucun tournoi terminé.": "No finished tournament.",
  "Consultation et suppression (admin).": "Viewing and deletion (admin).",
  "Simuler tout le tournoi (scores aléatoires) jusqu'au champion ?": "Simulate the whole tournament (random scores) up to the champion?",
  "payé annuler": "cancel paid",
  "déjà suivi": "already followed",
  "👤 Connecté en tant que": "👤 Logged in as",
  "Retour à": "Back to",
  "Restaurer le tournoi actif à l'état de cet événement ?": "Restore the active tournament to this event's state?",
  "Ou": "Or",
  "⚙️ Paramètres": "⚙️ Settings",
  "Mode clair": "Light mode",
  "🔑 Connexion": "🔑 Log in",
  "Connexion": "Log in",
  "Mes matchs": "My matches",
  // --- fil du tournoi (accueil) ---
  "Fil du tournoi": "Tournament feed",
  "Replier": "Show less",
  "en direct": "live",
  "☰ Menu": "☰ Menu",
  "Menu": "Menu",
  "🏆 Titres": "🏆 Titles",
  "Perdus": "Lost",
  "% victoires": "% wins",
  "⭐ Pts": "⭐ Pts",
  "💥 Run-outs": "💥 Run-outs",
  "Guide admin": "Admin guide",
  "Historique public": "Public history",
  "🔗 Liens publics": "🔗 Public links",
  "💾 Sauvegarde (export / import JSON)": "💾 Backup (JSON export / import)",
  "📍 Lieu": "📍 Venue",
  "géré dans sa page dédiée": "managed in its dedicated page",
  "Format": "Format",
  "Inscrire": "Register",
  "Corriger": "Correct",
  "Nombre": "Number",
  "Jamais (3 partout)": "Never (3 everywhere)",
  "Distance (3/5/7) :": "Distance (3/5/7):",
  "Motif :": "Reason:",
  "correction table de marque": "scoreboard correction",
  "Champion (optionnel)": "Champion (optional)",
  "Enregistrer date/lieu": "Save date/venue",
  "Enregistrer l'ordre": "Save the order",
  "Tableau final": "Final bracket",
  "Tour": "Round",
  "🎬 Simulation": "🎬 Simulation",
  "🎲 Mode simulation": "🎲 Simulation mode",
  "🏆 Champion :": "🏆 Champion:",
  "ACTIF": "ACTIVE",
  "ACTIF ✅": "ACTIVE ✅",
  "inactif": "inactive",
  "· après la belle": "· after the decider",
  "· revanche prise !": "· revenge taken!",
  "· revanche manquée": "· revenge missed",
  "Le club": "The club",
  "Club introuvable": "Club not found",
  "Club inconnu ici, tu regardes le club par défaut": "Unknown club here, you are viewing the default club",
  "Choisis ton club": "Pick your club",
  "Bienvenue sur la plateforme": "Welcome to the platform",
  "Plateforme": "Platform",
  "Hub de la plateforme": "Platform hub",
  "Choisis ton club, ouvre un tournoi en cours, retrouve un joueur.": "Pick your club, open a live tournament, find a player.",
  "Reprendre": "Resume",
  "Les tournois en cours et à venir": "Live and upcoming tournaments",
  "Aucun tournoi en cours ou à venir.": "No live or upcoming tournament.",
  "Joueur de la plateforme": "Player of the platform",
  "Un pseudo": "A nickname",
  "Rechercher un joueur": "Search a player",
  "Rechercher un joueur dans tous les clubs de la plateforme.": "Search a player across all the clubs of the platform.",
  "Résultats": "Results",
  "Aucun joueur trouvé.": "No player found.",
  "Un seul compte pour toute la plateforme : le même login dans tous les clubs.": "One account for the whole platform: the same login in every club.",
  "Bannière du club": "Club banner",
  "Bannière de l accueil": "Home banner",
  "Retirer la bannière": "Remove the banner",
  "Importer une bannière (PNG/JPG/SVG, photo jusqu à 8 Mo, réduite à 1600 px)": "Import a banner (PNG/JPG/SVG, photo up to 8 MB, reduced to 1600 px)",
  "Photo affichée en tête de l accueil et de la page Le club pour tous les visiteurs.": "Photo shown at the top of the home page and the Club page for every visitor.",
  "Photo de fond de la TV": "TV background photo",
  "Retirer le fond de TV": "Remove the TV background",
  "Importer un fond de TV (PNG/JPG/SVG, photo jusqu à 8 Mo, réduite à 1280 px)": "Import a TV background (PNG/JPG/SVG, photo up to 8 MB, reduced to 1280 px)",
  "Photo de fond affichée derrière les scores de l écran TV (assombrie automatiquement).": "Background photo behind the scores of the club TV screen (automatically darkened).",
  "Page Le club": "Club page",
  "Logo, bannière et textes de la page publique « Le club » (lien du menu).": "Logo, banner and texts of the public « Club » page (menu link).",
  "Présentation du club (500 caractères max)": "Club presentation (500 characters max)",
  "Contact (page Le club, 200 caractères max)": "Contact (Club page, 200 characters max)",
  "Image refusée": "Image rejected",
  "Cause : l image réduite dépasse encore la taille maximum, choisis une image plus simple.": "Cause: the reduced image still exceeds the maximum size, pick a simpler image.",
  "Icône du téléphone": "Phone icon",
  "Le logo devient l app des téléphones (icône 192 px, effective aux prochaines installations).": "The logo becomes the phone app (192 px icon, applied to future installs).",
};
const I18N_DYN = [
  [/^Erreur (\d+)$/, "Error $1"],
  [/^Fiche de (.+)$/, "Player page of $1"],
  [/^Te désinscrire du tournoi « (.+) » \?$/, "Unregister from tournament \"$1\"?"],
  [/^Supprimer le joueur « (.+) » \?$/, "Delete player \"$1\"?"],
  [/^Supprimer « (.+) » de l'historique \?$/, "Delete \"$1\" from history?"],
  [/^Supprimer définitivement « (.+) » de l'historique \?$/, "Permanently delete \"$1\" from history?"],
  [/^Gérer le tournoi « (.+) »$/, "Manage tournament \"$1\""],
  [/^🕐 programmé vs (.+)$/, "🕐 scheduled vs $1"],
  [/^🕐 match programmé vs (.+)$/, "🕐 match scheduled vs $1"],
  [/^🟢 en cours vs (.+)$/, "🟢 ongoing vs $1"],
  [/^✅ Inscrit \(payé\)$/, "✅ Entered (paid)"],
  [/^✅ Inscrit \(en attente de paiement\)$/, "✅ Entered (awaiting payment)"],
  [/^M'inscrire à « (.+) » en tant que (.+)$/, "Enter \"$1\" as $2"],
  [/^Tableau de (\d+)$/, "Bracket of $1"],
  [/^Lancer le tirage \((\d+) payés\)$/, "Start the draw ($1 paid)"],
  [/^⏳ Prêts à lancer \((\d+)\)$/, "⏳ Ready to start ($1)"],
  [/^Forfait de (.+) \?$/, "Forfeit for $1?"],
  [/^Score de (.+) \(0-(\d+)\) :$/, "Score for $1 (0-$2):"],
  [/^Nouveau pseudo pour « (.+) » \(min (\d+) caractères?\) :$/, "New username for \"$1\" (min $2 characters):"],
  [/^Nouveau mot de passe pour « (.+) » \(min (\d+) caractères?\) :$/, "New password for \"$1\" (min $2 characters):"],
  [/^Supprimer le compte « (.+) » \?\nLes joueurs rattachés sont détachés \(l'historique des matchs est conservé\), les sessions et abonnements push sont supprimés\.$/, "Delete account \"$1\"?\nAttached players are detached (match history kept), sessions and push subscriptions deleted."],
  [/^Manches gagnées : (\d+)$/, "Frames won: $1"],
  [/^⚔️ Face-à-face \((\d+) adversaire\)$/, "⚔️ Head to head ($1 opponent)"],
  [/^⚔️ Face-à-face \((\d+) adversaires\)$/, "⚔️ Head to head ($1 opponents)"],
  [/^🎱 (\d+) joués$/, "🎱 $1 played"],
  [/^🏆 (\d+) gagnés$/, "🏆 $1 won"],
  [/^Début : (.+)$/, "Start: $1"],
  [/^· Durée : (.+)$/, "· Duration: $1"],
  [/^🏁 (.+) remporte le match$/, "🏁 $1 wins the match"],
  [/^🏆 (.+) remporte le match$/, "🏆 $1 wins the match"],
  [/^Le score deviendrait (\d+) - (\d+)\.$/, "The score would become $1 - $2."],
  [/^📍 Va à la table n° (\d+)$/, "📍 Go to table #$1"],
  [/^Historique des tournois \((\d+)\)$/, "Tournament history ($1)"],
  [/^Historique \((\d+) tournois terminés\)$/, "History ($1 finished tournaments)"],
  [/^(\d+) joueurs recensés$/, "$1 players recorded"],
  [/^(\d+) entrée\(s\)$/, "$1 entry(ies)"],
  [/^(\d+) entrées supprimées$/, "$1 entries deleted"],
  [/^Retour à (.+)$/, "Back to $1"],
  [/^Rouvrir le match #(.+) \? Le résultat est annulé et les matchs suivants seront vidés\.$/, "Reopen match #$1? The result is cancelled and the following matches will be cleared."],
  [/^(\d+)\/(\d+) inscrits · (\d+) payés$/, "$1/$2 entered · $3 paid"],
  [/^(\d+) max · (\d+) inscrits · (\d+) payés · (\d+) tables$/, "$1 max · $2 entered · $3 paid · $4 tables"],
  [/^(\d+)\/(\d+) matchs joués$/, "$1/$2 matches played"],
  [/^(\d+) tables créées · (\d+) libres$/, "$1 tables created · $2 free"],
  [/^(\d+) joueurs$/, "$1 players"],
  [/^(\d+) inscrits$/, "$1 entered"],
  [/^(\d+) payés$/, "$1 paid"],
  [/^(\d+) libres$/, "$1 free"],
  [/^DKO (\d+) tours$/, "DKO $1 rounds"],
  [/^DKO (\d+) tours \+ tableau final$/, "DKO $1 rounds + final bracket"],
  [/^élim\. directe$/, "single elimination"],
  [/^Matchs modifiés: (\d+) · ajoutés: (\d+) · supprimés: (\d+)$/, "Matches changed: $1 · added: $2 · deleted: $3"],
  [/^Événement #(\d+) \((.+)\) du (.+)$/, "Event #$1 ($2) on $3"],
  [/^Restaurer le tournoi actif à l'état de cet événement \?\n\n/, "Restore the active tournament to this event's state?\n\n"],
  [/^Table (\d+) \(occupée\)$/, "Table $1 (busy)"],
  [/^⏳ Tirage au sort non effectué : structure du tableau à vide, les places j1 à j(\d+) seront prises par les joueurs après le tirage$/, "⏳ Draw not done yet: empty bracket structure, slots j1 to j$1 will be filled by the players after the draw"],
  [/^Simulation terminée : (\d+) matchs joués\. (.+)$/, "Simulation done: $1 matches played. $2"],
  [/^(.+) (\d\d?)\/(\d\d?)\/(\d{4}) à (\d\d?)h(\d\d)$/, "$1 $2/$3/$4 at $5:$6"],
  [/^(\d\d?)\/(\d\d?)\/(\d{4}) à (\d\d?)h(\d\d)$/, "$1/$2/$3 at $4:$5"],
  [/^Un compte existe déjà avec le pseudo « (.+) »\.\n\nInscrire quand même ce joueur \? Il sera rattaché à ce compte \(notifications « à toi de jouer » et amis incluses\)\.\n\nSinon, le titulaire peut s'inscrire lui-même depuis son compte\.$/, "An account already exists with the username \"$1\".\n\nRegister this player anyway? They will be linked to this account (\"your turn to play\" notifications and friends included).\n\nOtherwise, the owner can register themselves from their own account."],
  [/^Retirer (.+) de tes amis \?$/, "Remove $1 from your friends?"],
  [/^📨 Notif de test envoyée \((\d+) appareil\(s\)\) !$/, "📨 Test notification sent ($1 device(s))!"],
  [/^🎱 Matchs \((\d+)\)$/, "🎱 Matches ($1)"],
  [/^⏱ début (.+)$/, "⏱ start $1"],
  [/^⏱ durée moyenne (.+)$/, "⏱ average duration $1"],
  [/^(\d{2}\/\d{2}\/\d{4}) à (\d{2})h(\d{2})$/, "$1 at $2:$3"],
  [/^(\S+) (\d{2}\/\d{2}\/\d{4}) à (\d{2})h(\d{2})$/, "$1 $2 at $3:$4"],
  // --- fil du tournoi (accueil) : fragments de lignes ---
  [/^(.+) bat (.+) (\d+)-(\d+)$/, "$1 beats $2 $3-$4"],
  [/^· table (\d+)$/, "· table $1"],
  [/^· tournoi terminé pour (.+)$/, "· tournament over for $1"],
  [/^(.+) déclare forfait, (.+) passe au tour suivant$/, "$1 forfeits, $2 moves on to the next round"],
  [/^🏆 (.+) remporte le tournoi !$/, "🏆 $1 wins the tournament!"],
  [/^Suspense : (.+) et (.+) sont à la belle à la table (\d+)$/, "Suspense: $1 and $2 are both one frame from victory at table $3"],
  [/^Suspense : (.+) et (.+) sont à la belle$/, "Suspense: $1 and $2 are both one frame from victory"],
  [/^à l'instant$/, "just now"],
  [/^il y a (\d+) min$/, "$1 min ago"],
  [/^il y a (\d+) h$/, "$1 h ago"],
  [/^il y a (\d+) j$/, "$1 d ago"],
  [/^(.+) s'impose face à (.+) (\d+)-(\d+)$/, "$1 gets the better of $2 $3-$4"],
  [/^(.+) vient à bout de (.+) (\d+)-(\d+)$/, "$1 overcomes $2 $3-$4"],
  [/^(.+) domine (.+) (\d+)-(\d+)$/, "$1 dominates $2 $3-$4"],
  [/^(.+) écarte (.+) (\d+)-(\d+)$/, "$1 brushes $2 aside $3-$4"],

  [/^(.+) surclasse (.+) (\d+)-(\d+)$/, "$1 outclasses $2 $3-$4"],
  [/^(.+) fait la loi face à (.+) (\d+)-(\d+)$/, "$1 lays down the law against $2 $3-$4"],
  [/^(.+) abandonne, (.+) passe au tour suivant$/, "$1 withdraws, $2 moves on to the next round"],
  [/^forfait de (.+), (.+) passe au tour suivant$/, "forfeit by $1, $2 moves on to the next round"],
  [/^(.+) jette l'éponge, (.+) passe au tour suivant$/, "$1 throws in the towel, $2 moves on to the next round"],
  [/^forfait de (.+), (.+) avance sans jouer$/, "forfeit by $1, $2 advances without playing"],

  [/^(.+) ne se présente pas, (.+) passe au tour suivant$/, "$1 doesn't show up, $2 moves on to the next round"],
  [/^forfait de (.+) : (.+) file au tour suivant$/, "forfeit by $1: $2 races into the next round"],
  [/^🏆 (.+) soulève le trophée !$/, "🏆 $1 lifts the trophy!"],
  [/^🏆 (.+) décroche le titre !$/, "🏆 $1 takes the title!"],
  [/^🏆 Fin du suspense : (.+) est champion !$/, "🏆 End of the suspense: $1 is the champion!"],
  [/^🏆 (.+) a eu le dernier mot : le titre est à lui !$/, "🏆 $1 had the last word: the title is his!"],

  [/^🏆 (.+) entre au palmarès du club !$/, "🏆 $1 enters the club's roll of honour!"],
  [/^🏆 (.+) règne sur le tournoi !$/, "🏆 $1 rules the tournament!"],
  [/^La belle ! (.+) et (.+) à la table (\d+)$/, "The decider! $1 and $2 at table $3"],
  [/^Ça se joue à la belle entre (.+) et (.+) \(table (\d+)\)$/, "It all comes down to the decider between $1 and $2 (table $3)"],
  [/^Manche décisive entre (.+) et (.+) \(table (\d+)\) !$/, "Deciding frame between $1 and $2 (table $3)!"],
  [/^Tous debout : (.+) et (.+) disputent la belle à la table (\d+) !$/, "On your feet: $1 and $2 play the decider at table $3!"],

  [/^Le tournoi se joue maintenant : (.+) et (.+) à la belle à la table (\d+) !$/, "The tournament is decided now: $1 and $2 in the decider at table $3!"],
  [/^Dernière manche pour (.+) et (.+) à la table (\d+) !$/, "Last frame for $1 and $2 at table $3!"],
  [/^La belle entre (.+) et (.+) !$/, "The decider between $1 and $2!"],

  [/^Ça se joue à la belle entre (.+) et (.+) !$/, "It all comes down to the decider between $1 and $2!"],
  [/^Manche décisive entre (.+) et (.+) !$/, "Deciding frame between $1 and $2!"],
  [/^🔥 Revanche : (.+) joue contre (.+), une revanche à prendre !$/, "🔥 Revenge match: $1 plays $2, a revenge to take!"],
  [/^🔥 (.+) joue sa revanche contre (.+) !$/, "🔥 $1 plays his revenge match against $2!"],
  [/^🔥 (.+) retente sa chance contre (.+) !$/, "🔥 $1 tries his luck again against $2!"],
  [/^🔥 (.+) veut renverser la vapeur contre (.+) !$/, "🔥 $1 wants to turn the tide against $2!"],
  [/^🔥 À (.+) de trouver la faille face à (.+) !$/, "🔥 Up to $1 to find a way past $2!"],

  [/^🔥 Un compte à régler pour (.+) face à (.+) !$/, "🔥 A score to settle for $1 against $2!"],
  [/^🔥 Ce match sent la revanche : (.+) défie (.+) !$/, "🔥 This one smells like revenge: $1 takes on $2!"],
  [/^🔥 Revanche : (.+) et (.+) se retrouvent à égalité !$/, "🔥 Revenge match: $1 and $2 meet again, dead even!"],
  [/^🔥 Fierté en jeu : (.+) et (.+) se retrouvent !$/, "🔥 Pride at stake: $1 and $2 meet again!"],
  [/^🔥 (.+) et (.+) se retrouvent, bilan parfaitement équilibré !$/, "🔥 $1 and $2 meet again, record perfectly balanced!"],
  [/^🔥 Égalité parfaite avant ce round : (.+) vs (.+) !$/, "🔥 Perfect tie before this round: $1 vs $2!"],

  [/^🔥 Vieilles connaissances dos à dos : (.+) et (.+) se retrouvent !$/, "🔥 Old rivals dead even: $1 and $2 meet again!"],
  [/^🔥 Rien à départager : (.+) et (.+) rejouent leur histoire !$/, "🔥 Nothing to split them: $1 and $2 write a new chapter!"],
  [/^(.+) mène (\d+)-(\d+)$/, "$1 leads $2-$3"],
  [/^· durée (\d+) min$/, "· duration $1 min"],
  [/^· durée (\d+) h (\d+)$/, "· duration $1 h $2"],
  [/^Reçu : « (.+) », ([0-9.,]+) Ko, type MIME « (.*) »\.$/, "Sent: “$1”, $2 KB, MIME type “$3”."],
];
// --- i18n ES : dictionnaire espagnol (cles = textes fr, meme jeu que I18N) + remplacements dynamiques ---
const I18N_ES = {
  "🎨 Apparence du club": "🎨 Apariencia del club",
  "Couleur d accent": "Color de acento",
  "Nom par défaut des tournois": "Nombre de torneo predeterminado",
  "Jour récurrent": "Día recurrente",
  "Heure habituelle": "Hora habitual",
  "Personnalisation enregistrée": "Personalización guardada",
  "Visible par tous les visiteurs du club.": "Visible para todos los visitantes del club.",
  "Logo du club": "Logo del club",
  "Aucun logo": "Sin logo",
  "Logo prédéfini ou importé, affiché en filigrane discret et à côté du nom du club pour tous les visiteurs.": "Logo predefinido o importado, mostrado como marca de agua discreta y junto al nombre del club para todos los visitantes.",
  "Importer une image (PNG/JPG/SVG, photo jusqu à 8 Mo, réduite à 256 px)": "Importar una imagen (PNG/JPG/SVG, foto hasta 8 MB, reducida a 256 px)",
  "Logo trop volumineux ou format non supporté": "Logo demasiado grande o formato no compatible",
  "Logo refusé": "Logotipo rechazado",
  "Aperçu du logo retenu : « Enregistrer » l applique aux pages du club pour tous les visiteurs.": "Vista previa del logotipo seleccionado: « Guardar » lo aplica a las páginas del club para todos los visitantes.",
  "Logo importé": "Logotipo importado",
  "Adresse par défaut du club": "Dirección predeterminada del club",
  "Attendu : image PNG, JPG ou SVG décodable (photo iPhone acceptée), 8 Mo maximum.": "Se espera: imagen PNG, JPG o SVG decodificable (se aceptan fotos de iPhone), 8 MB máximo.",
  "Cause : fichier plus lourd que la limite de 8 Mo.": "Causa: archivo más pesado que el límite de 8 MB.",
  "Cause probable : le navigateur n a pas réussi à décoder ce fichier (fichier endommagé ou format d image exotique).": "Causa probable: el navegador no pudo decodificar este archivo (archivo dañado o formato de imagen exótico).",
  "Cause probable : le fichier SVG est vide ou ne contient pas de balise <svg>.": "Causa probable: el archivo SVG está vacío o no contiene ninguna etiqueta <svg>.",
  "Affichage du logo": "Mostrar el logo",
  "Logo d en-tête": "Logo del encabezado",
  "Filigrane": "Marca de agua",
  "Logo + filigrane": "Logo + marca de agua",
  "Dimanche": "Domingo",
  "Lundi": "Lunes",
  "Mardi": "Martes",
  "Mercredi": "Miércoles",
  "Jeudi": "Jueves",
  "Vendredi": "Viernes",
  "Samedi": "Sábado",
  "Clubs": "Clubes",
  "Créer un club": "Crear un club",
  "Nom du club": "Nombre del club",
  "Code PIN du club": "Código PIN del club",
  "Code PIN propre": "Código PIN propio",
  "Comptes rattachés": "Cuentas vinculadas",
  "Actif": "Activo",
  "Inactif": "Inactivo",
  "Activer": "Activar",
  "Rôles du club": "Roles del club",
  "Administrateur": "Administrador",
  "Opérateur": "Operador",
  "Retirer": "Quitar",
  "Aide": "Ayuda",
  "Amis": "Amigos",
  "Annuler": "Cancelar",
  "Aucun ami pour le moment": "Aún no tienes amigos",
  "Aucun historique": "Sin historial",
  "Aucun match pour le moment": "Aún no hay partidos",
  "Aucun tournoi pour le moment": "No hay torneo por ahora",
  "Aucun tournoi": "No hay torneo",
  "Aucune donnée": "Sin datos",
  "Bille perdue": "Bola perdida",
  "Bille perdue ?": "¿Bola perdida?",
  "Classement": "Clasificación",
  "Club": "Club",
  "Compte": "Cuenta",
  "Confidentialité": "Privacidad",
  "Confirmation": "Confirmación",
  "Connecté": "Conectado",
  "Connecte-toi pour t'inscrire": "Conéctate para inscribirte",
  "Créer mon compte": "Crear mi cuenta",
  "Créer un compte": "Crear una cuenta",
  "Déconnexion": "Cerrar sesión",
  "Défaite": "Derrota",
  "Défaillant": "Perdedor",
  "Détails": "Detalles",
  "Distance": "Distancia",
  "En cours": "En curso",
  "Enregistrer": "Guardar",
  "En cours de match": "Jugando ahora",
  "Envoi du lien de réinitialisation...": "Enviando el enlace de restablecimiento...",
  "Envoi...": "Enviando...",
  "Erreur": "Error",
  "Fermer": "Cerrar",
  "Final": "Final",
  "Finale": "Final",
  "Forfait": "Abandono",
  "Gagnant": "Ganador",
  "gagnant": "ganador",
  "Gagné": "Ganado",
  "Historique": "Historial",
  "Honnêteté": "Deportividad",
  "Inconnu": "Desconocido",
  "Inscrits": "Inscritos",
  "Inscription": "Inscripción",
  "Inséré": "Inscrito",
  "Interrompu": "Interrumpido",
  "Joueur": "Jugador",
  "Mon tournoi": "Mi torneo",
  "Joueurs": "Jugadores",
  "jour": "día",
  "Langue": "Idioma",
  "Manche": "Manga",
  "Manches": "Mangas",
  "Manches gagnées": "Mangas ganadas",
  "Match": "Partido",
  "Matchs": "Partidos",
  "Matchs en direct": "Partidos en directo",
  "Me désinscrire": "Desinscribirme",
  "Mon espace": "Mi espacio",
  "Mot de passe": "Contraseña",
  "Mot de passe oublié ?": "¿Olvidaste la contraseña?",
  "Modifier": "Editar",
  "Mute": "Silenciar",
  "Notifications": "Notificaciones",
  "Nom": "Nombre",
  "Non": "No",
  "Oui": "Sí",
  "Ouvrir": "Abrir",
  "Paramètres": "Ajustes",
  "Perdu": "Perdido",
  "Perdant": "Perdedor",
  "perdant": "perdedor",
  "Pseudo": "Usuario",
  "Prévu": "Programado",
  "Prêt": "Listo",
  "Points": "Puntos",
  "Quitter": "Salir",
  "Rafraîchir": "Actualizar",
  "Rejouer": "Repetir",
  "Remerciements": "Créditos",
  "Retour": "Volver",
  "Réduire": "Reducir",
  "Réglages": "Ajustes",
  "Score": "Marcador",
  "Se connecter": "Iniciar sesión",
  "Se déconnecter": "Cerrar sesión",
  "Sécurité": "Seguridad",
  "Statistiques": "Estadísticas",
  "Stats": "Estadísticas",
  "Suivre": "Seguir",
  "Suivi": "Siguiendo",
  "Suivre un joueur": "Seguir a un jugador",
  "Table de marque": "Mesa de control",
  "← Table de marque": "← Mesa de control",
  "Tables": "Mesas",
  "Terminé": "Terminado",
  "Terminer": "Finalizar",
  "Thème": "Tema",
  "Titres": "Títulos",
  "Ton compte": "Tu cuenta",
  "Tournoi": "Torneo",
  "Tournoi précédent": "Torneo anterior",
  "Tournois": "Torneos",
  "Tout voir": "Ver todo",
  "Tableau": "Cuadro",
  "Vainqueur": "Vencedor",
  "Valider": "Validar",
  "Victoire": "Victoria",
  "Victoires": "Victorias",
  "Vues": "Vistas",
  "Échec": "Fallo",
  "Éditer": "Editar",
  "Préférences": "Preferencias",
  "Prénom": "Nombre de pila",
  "Email": "Correo electrónico",
  "Chargement...": "Cargando...",
  "Charger plus": "Cargar más",
  "Changer de club": "Cambiar de club",
  "M'inscrire": "Inscribirme",
  "Inscriptions": "Inscripciones",
  "Nombre de joueurs": "Número de jugadores",
  "Numéro de match": "Número de partido",
  "Aucun joueur trouvé": "No se encontró jugador",
  "Aucun résultat": "Sin resultados",
  "Tournoi terminé": "Torneo terminado",
  "Tournoi en cours": "Torneo en curso",
  "Tirage au sort": "Sorteo",
  "tirage": "sorteo",
  "Faute": "Falta",
  "Fautes": "Faltas",
  "Meilleure série": "Mejor serie",
  "Membre": "Miembro",
  "Membres": "Miembros",
  "Suite": "Siguiente",
  "Suivant": "Siguiente",
  "Précédent": "Anterior",
  "Accueil": "Inicio",
  "Aucun": "Ninguno",
  "Aucune": "Ninguna",
  "Ajouter": "Añadir",
  "Supprimer": "Eliminar",
  "Confirmer": "Confirmar",
  "Copier": "Copiar",
  "Copié !": "¡Copiado!",
  "Attention": "Atención",
  "Info": "Info",
  "Libre": "Libre",
  "Occupée": "Ocupada",
  "Manche en cours": "Manga en curso",
  "Match en cours": "Partido en curso",
  "Clic = éditer (admin)": "Clic = editar (admin)",
  "Déjà suivi": "Ya seguido",
  "Ne plus suivre": "Dejar de seguir",
  "Face à face": "Cara a cara",
  "Adversaire": "Adversario",
  "Adversaires": "Adversarios",
  "Série": "Serie",
  "Séries": "Series",
  "Trois quarts": "Cuartos de final",
  "Quarts": "Cuartos",
  "Demis": "Semifinales",
  "Demi-finales": "Semifinales",
  "Poules": "Grupos",
  "Poule": "Grupo",
  "Vidéos": "Vídeos",
  "A propos": "Acerca de",
  "Voir": "Ver",
  "Voir tout": "Ver todo",
  "Eight Ball Pink City — Tournoi": "Eight Ball Pink City — Torneo",
  "Mon compte — Pink City Billard": "Mi cuenta — Pink City Billard",
  "Paramètres — Pink City Billard": "Ajustes — Pink City Billard",
  "Amis — Pink City Billard": "Amigos — Pink City Billard",
  "Mes matchs — Pink City Billard": "Mis partidos — Pink City Billard",
  "Match — Pink City Billard": "Partido — Pink City Billard",
  "Fiche joueur — Pink City Billard": "Ficha de jugador — Pink City Billard",
  "Stats joueurs — Pink City Billard": "Estadísticas de jugadores — Pink City Billard",
  "Joueur — Pink City Billard": "Jugador — Pink City Billard",
  "Tableau — Pink City Billard": "Cuadro — Pink City Billard",
  "Tournoi archivé — Pink City Billard": "Torneo archivado — Pink City Billard",
  "Historique — Pink City Billard": "Historial — Pink City Billard",
  "Historique admin — Pink City Billard": "Historial de administración — Pink City Billard",
  "Mot de passe oublié — Pink City Billard": "Contraseña olvidada — Pink City Billard",
  "Nouveau mot de passe — Pink City Billard": "Nueva contraseña — Pink City Billard",
  "Table de marque — Pink City Billard": "Mesa de control — Pink City Billard",
  "Gérer le tournoi — Pink City Billard": "Gestionar el torneo — Pink City Billard",
  "Journal d'audit — Pink City Billard": "Registro de auditoría — Pink City Billard",
  "Comptes joueurs — Table de marque": "Cuentas de jugadores — Mesa de control",
  "🗄 Données — Table de marque": "🗄 Datos — Mesa de control",
  "❓ Aide — Tournoi EBPC": "❓ Ayuda — Torneo EBPC",
  "🔒 Confidentialité — Tournoi EBPC": "🔒 Privacidad — Torneo EBPC",
  "⚙️ Guide admin — Tournoi EBPC": "⚙️ Guía de administración — Torneo EBPC",
  "dimanche": "domingo",
  "lundi": "lunes",
  "mardi": "martes",
  "mercredi": "miércoles",
  "jeudi": "jueves",
  "vendredi": "viernes",
  "samedi": "sábado",
  "Casse la manche en cours": "Break de la manga en curso",
  "Gagnés": "Ganados",
  "Joués": "Jugados",
  "Mon compte": "Mi cuenta",
  "Phase finale": "Fase final",
  "⏳ match attendu": "⏳ partido pendiente",
  "▶ Lancer": "▶ Iniciar",
  "🏅 Classement": "🏅 Clasificación",
  "💾 Enregistrer le score": "💾 Guardar el marcador",
  "PIN invalide — reconnecte-toi dans l'admin": "PIN no válido — vuelve a conectarte a la administración",
  "Annulé : code non saisi": "Cancelado: código no introducido",
  "Annulé : mot de confirmation non saisi": "Cancelado: palabra de confirmación no introducida",
  "Effacer le code mémorisé (sera redemandé à la prochaine action admin)": "Borrar el código guardado (se volverá a pedir en la próxima acción de administración)",
  "Verrouiller la table de marque ? Le code PIN sera redemandé.": "¿Bloquear la mesa de control? Se volverá a pedir el código PIN.",
  "connecte-toi avec un compte admin": "conéctate con una cuenta de administración",
  "pour confirmer :": "para confirmar:",
  "— aucune —": "— ninguna —",
  "✏️ Score (correction)": "✏️ Marcador (corrección)",
  "👥 Joueurs du match": "👥 Jugadores del partido",
  "🔐 Table de marque": "🔐 Mesa de control",
  "🔓 Rouvrir le match": "🔓 Reabrir el partido",
  "Permission refusée": "Permiso denegado",
  "Push non supporté sur ce navigateur": "Notificaciones push no compatibles con este navegador",
  "❓ Aide": "❓ Ayuda",
  "🎱 S'inscrire": "🎱 Inscribirse",
  "Compte (bouton « Compte » en haut à droite) → pseudo + email + mot de passe, puis « M'inscrire » sur l'accueil. Sans compte : champ pseudo sur l'accueil, mais pas de notif push ni d'historique perso. Inscrit par erreur ? Bouton « Me désinscrire » (accueil ou page compte), tant que les inscriptions sont ouvertes et avant paiement (déjà payé : voir la table de marque).": "Cuenta (botón « Cuenta » arriba a la derecha) → usuario + correo + contraseña, luego « Inscribirme » en la página de inicio. Sin cuenta: campo de usuario en la página de inicio, pero sin notificaciones push ni historial personal. ¿Inscrito por error? Botón « Desinscribirme » (inicio o página de cuenta), mientras las inscripciones estén abiertas y antes de pagar (ya pagado: ver la mesa de control).",
  "🔔 Notifications « à toi de jouer »": "🔔 Notificaciones de « te toca jugar »",
  "Ajoute d'abord le site à l'écran d'accueil : Android → ⋯ → « Installer l'application » ; iPhone → OUVRIR LE SITE DANS SAFARI (obligatoire, Chrome iOS ne le permet pas) → Partager → « Sur l'écran d'accueil ». Ouvre ensuite l'app depuis l'écran d'accueil, puis Compte → 🔔 Activer les notifications. Au lancement de ton match tu reçois une notif — un tap ouvre directement la card du match (même écran verrouillé).": "Añade primero el sitio a la pantalla de inicio: Android → ⋯ → « Instalar la aplicación »; iPhone → ABRE EL SITIO EN SAFARI (obligatorio, Chrome iOS no lo permite) → Compartir → « A la pantalla de inicio ». Luego abre la app desde la pantalla de inicio y ve a Cuenta → 🔔 Activar notificaciones. Al empezar tu partido recibes una notificación — un toque abre directamente la tarjeta del partido (incluso con la pantalla bloqueada).",
  "Tu reçois aussi une notif « 🎱 Nouveau tournoi — inscriptions ouvertes » quand la table de marque crée un tournoi (sauf si elle a désactivé le switch 🔔 du formulaire de création).": "También recibes una notificación « 🎱 Nuevo torneo — inscripciones abiertas » cuando la mesa de control crea un torneo (salvo si ha desactivado el interruptor 🔔 del formulario de creación).",
  "🗺️ Suivre le tournoi": "🗺️ Seguir el torneo",
  "Tableau : vue bracket (onglets Tout / WB / LB / Phase finale, liens entre matchs sur l’onglet final) ou liste, liste déroulante « Aller au tour », filtre joueur avec Entrée. Dans un match pas encore joué, la place inconnue affiche « gagnant wb1-001 », « perdant lb2-003 » ou « blanc » : tu sais d’où vient le joueur que tu attends. Match en cours = entouré en rouge, terminé = bord vert, gagnant en vert. Avant le tirage au sort, le tableau affiche déjà la structure à vide : les places du tour 1 sont numérotées j1, j2, ... (jusqu’à j32 pour un tableau de 32), tu vois donc le format du tournoi dès sa création. · 📺 TV pour la salle · « Mon tournoi » = tes matchs · 📊 Stats · 🗂 Historique.": "Cuadro: vista de bracket (pestañas Todo / WB / LB / Fase final, enlaces entre partidos en la pestaña final) o lista, menú desplegable « Ir a la ronda », filtro de jugador con Intro. En un partido aún no jugado, la plaza desconocida muestra « ganador wb1-001 », « perdedor lb2-003 » o « blanco »: sabes de dónde viene el jugador que esperas. Partido en curso = bordeado en rojo, terminado = borde verde, ganador en verde. Antes del sorteo, el cuadro ya muestra la estructura vacía: las plazas de la ronda 1 están numeradas j1, j2, ... (hasta j32 para un cuadro de 32), así que ves el formato del torneo desde su creación. · 📺 TV para la sala · « Mi torneo » = tus partidos · 📊 Estadísticas · 🗂 Historial.",
  "🎲 Jouer un match": "🎲 Jugar un partido",
  "Au lancement, panneau « Tirage à la bande » : chaque joueur fait rouler une bille, le plus proche de la bande gagne → clique « ⚪ [pseudo] casse ». La ⚪ alterne ensuite à chaque manche.": "Al empezar, panel « Sorteo a la banda »: cada jugador hace rodar una bola, el más cercano a la banda gana → pulsa « ⚪ [usuario] rompe ». La ⚪ alterna después en cada manga.",
  "Saisie : +1 manche pour le gagnant de la manche, −1 pour corriger (la ⚪ revient alors à l’état précédent). 💥 Casse ferme = réservé au joueur ⚪ (l'autre bouton est grisé). 🎯 Reprise ferme = réservé à l'autre. Dernier point → confirmation du score avec possibilité de modifier.": "Puntuación: +1 manga para el ganador de la manga, −1 para corregir (la ⚪ vuelve entonces a su estado anterior). 💥 Break completo = reservado al jugador ⚪ (el otro botón queda en gris). 🎯 Re-rack = reservado al otro. Último punto → confirmación del marcador con posibilidad de modificarlo.",
  "🔑 Mot de passe oublié": "🔑 Contraseña olvidada",
  "Compte → « Mot de passe oublié » → email → lien de réinit (valable 1 h).": "Cuenta → « Contraseña olvidada » → correo → enlace de restablecimiento (válido 1 h).",
  "👥 Amis": "👥 Amigos",
  "Compte → section Amis : recherche un pseudo (Entrée) et ajoute un ami. Tu reçois une notif push « match d'un ami » quand son match commence, et tu vois son statut en direct (en cours vs …, programmé, inscrit) sur ton compte et sur l'accueil.": "Cuenta → sección Amigos: busca un usuario (Intro) y añade un amigo. Recibes una notificación push « partido de un amigo » cuando empieza su partido, y ves su estado en directo (en curso contra…, programado, inscrito) en tu cuenta y en la página de inicio.",
  "📊 Mon historique": "📊 Mi historial",
  "Compte → « 📊 Ma fiche joueur » : joués/gagnés, %, manches, run-outs + historique de tous tes matchs.": "Cuenta → « 📊 Mi ficha de jugador »: jugados/ganados, %, mangas, run-outs + historial de todos tus partidos.",
  "👤 Ton compte": "👤 Tu cuenta",
  "Ton email est masqué (affiché partiellement) ; changement séparé. Un match contre blanc (bye) ne compte ni gagné ni perdu dans tes stats.": "Tu correo está enmascarado (mostrado parcialmente); cambio aparte. Un partido contra blanco (bye) no cuenta ni como ganado ni como perdido en tus estadísticas.",
  "Guide complet : docs/GUIDE_UTILISATEUR.md dans le dépôt GitHub.": "Guía completa: docs/GUIDE_UTILISATEUR.md en el repositorio GitHub.",
  "🔒 Confidentialité & données": "🔒 Privacidad y datos",
  "Ce qu'on collecte": "Qué recopilamos",
  "Tournoi : inscriptions, matchs, scores, événements, statistiques": "Torneo: inscripciones, partidos, marcadores, eventos, estadísticas",
  "Compte joueur : pseudo, email, mot de passe (hashé scrypt+salt, jamais en clair)": "Cuenta de jugador: usuario, correo, contraseña (hash scrypt+salt, nunca en texto claro)",
  "Notifications push : uniquement si tu les actives (opt-in), abonnement révocable à tout moment": "Notificaciones push: solo si las activas (opt-in), suscripción revocable en cualquier momento",
  "Ce qu'on ne fait PAS": "Qué NO hacemos",
  "Aucun cookie de tracking/publicité, aucune revente de données, aucun partage à des tiers (sauf envoi d'emails via Resend pour la réinitialisation de mot de passe).": "Sin cookies de rastreo/publicidad, sin venta de datos, sin compartirlos con terceros (salvo el envío de correos vía Resend para restablecer la contraseña).",
  "Finalités & base légale": "Fines y base legal",
  "Faire fonctionner le tournoi (inscriptions, matchs, scores, classements, notifications) = exécution du service demandé. Les emails servent uniquement à la réinit du mot de passe. Les données sont conservées tant que le compte est actif ; les comptes inactifs 18 mois sont supprimés automatiquement.": "Hacer funcionar el torneo (inscripciones, partidos, marcadores, clasificaciones, notificaciones) = ejecución del servicio solicitado. Los correos solo sirven para restablecer la contraseña. Los datos se conservan mientras la cuenta esté activa; las cuentas inactivas 18 meses se eliminan automáticamente.",
  "Hébergement": "Alojamiento",
  "Application hébergée sur Fly.io (société américaine) en région Paris (cdg), base SQLite sur volume. Un transfert hors UE peut exister côté infrastructure ; les données restent sous notre responsabilité.": "Aplicación alojada en Fly.io (empresa estadounidense) en la región de París (cdg), base SQLite en un volumen. Puede existir una transferencia fuera de la UE en la infraestructura; los datos siguen bajo nuestra responsabilidad.",
  "Responsable du traitement": "Responsable del tratamiento",
  "Voir avec la table de marque du tournoi.": "Consultar con la mesa de control del torneo.",
  "Technique : cookie de session strictement nécessaire (HttpOnly, SameSite, Secure), préférences navigateur (localStorage : joueur suivi, vue tableau)": "Técnico: cookie de sesión estrictamente necesaria (HttpOnly, SameSite, Secure), preferencias del navegador (localStorage: jugador seguido, vista del cuadro)",
  "Mots de passe hashés (scrypt + sel), sessions en cookie HttpOnly/SameSite/Secure, tokens de réinit hashés et valables 1 h, rate-limit sur connexion/inscription. Contact en cas d'incident : via la table de marque.": "Contraseñas con hash (scrypt + salt), sesiones en cookies HttpOnly/SameSite/Secure, tokens de restablecimiento con hash y válidos 1 h, límite de intentos en conexión/inscripción. Contacto en caso de incidente: vía la mesa de control.",
  "✏️ Rectification : changer pseudo/email dans le compte ; corrections admin possibles": "✏️ Rectificación: cambiar usuario/correo en la cuenta; correcciones de administración posibles",
  "📥 Accès/export : bouton « Exporter mes données » dans ton compte (JSON complet)": "📥 Acceso/exportación: botón « Exportar mis datos » en tu cuenta (JSON completo)",
  "🗑 Effacement : suppression du compte par l'admin (les matchs restent dans l'historique anonymisé du tournoi), purge auto 18 mois": "🗑 Supresión: eliminación de la cuenta por la administración (los partidos permanecen en el historial anonimizado del torneo), purga automática a los 18 meses",
  "🚫 Opposition : désactive les notifications push à tout moment": "🚫 Oposición: desactiva las notificaciones push en cualquier momento",
  "Donne l'email de ton compte : on t'envoie un lien de réinitialisation (valable 1h).": "Introduce el correo de tu cuenta: te enviaremos un enlace de restablecimiento (válido 1 h).",
  "Envoyer le lien": "Enviar el enlace",
  "🔐 Nouveau mot de passe": "🔐 Nueva contraseña",
  "Changer le mot de passe": "Cambiar la contraseña",
  "Nouveau mot de passe (min 4)": "Nueva contraseña (mín. 4)",
  "✅ Mot de passe changé, tu es connecté. Redirection…": "✅ Contraseña cambiada, estás conectado. Redirigiendo…",
  "Joueur introuvable.": "Jugador no encontrado.",
  "Bilan tous tournois confondus.": "Balance en todos los torneos.",
  "Résultat": "Resultado",
  "Statistiques joueurs (tous les tournois)": "Estadísticas de jugadores (todos los torneos)",
  "Aucune statistique pour le moment.": "Aún no hay estadísticas.",
  "🔴 À toi de jouer": "🔴 Te toca jugar",
  "Qui es-tu ?": "¿Quién eres?",
  "Touche ton pseudo ci-dessous.": "Toca tu usuario abajo.",
  "Tes matchs": "Tus partidos",
  "Aucun match pour le moment. Le tirage arrive bientôt ! 🎱": "Aún no hay partidos. ¡El sorteo llega pronto! 🎱",
  "Aucun tournoi en cours.": "No hay torneo en curso.",
  "🎱 Aucun tournoi en cours": "🎱 No hay torneo en curso",
  "Aller au tour :": "Ir a la ronda:",
  "— Choisir un tour —": "— Elegir una ronda —",
  "🔍 Filtrer par joueur (ex: seb) — Entrée pour valider": "🔍 Filtrar por jugador (ej.: seb) — Intro para aplicar",
  "Le tableau (structure à vide) apparaîtra ici dès la création d'un tournoi, les joueurs après le tirage au sort.": "El cuadro (estructura vacía) aparecerá aquí en cuanto se cree un torneo, y los jugadores tras el sorteo.",
  "📊 Statistiques du tournoi": "📊 Estadísticas del torneo",
  "🔍 Surligner un joueur (ex: seb) — Entrée pour valider": "🔍 Resaltar un jugador (ej.: seb) — Intro para aplicar",
  "Aucun tournoi terminé pour le moment.": "Aún no hay torneos terminados.",
  "Tous les tournois terminés restent consultables ici.": "Todos los torneos terminados siguen consultables aquí.",
  "Voir le tableau": "Ver el cuadro",
  "La TV Pink City est pensée pour le mode paysage": "La TV de Pink City está pensada para el modo horizontal",
  "Tourne l'écran en paysage": "Gira la pantalla al modo horizontal",
  "QR code du site": "Código QR del sitio",
  "Scanner pour ouvrir le site sur ton téléphone": "Escanéalo para abrir el sitio en tu teléfono",
  "🎉 Félicitations ! 🎉": "¡🎉 Enhorabuena! 🎉",
  "Champion de la Pink City": "Campeón de la Pink City",
  "En attente des matchs…": "Esperando partidos…",
  "Le tournoi va bientôt commencer": "El torneo empezará pronto",
  "🎱 Aucun tournoi pour le moment": "🎱 No hay torneo por ahora",
  "🏁 TERMINÉ": "🏁 TERMINADO",
  "📱 Scanne pour ouvrir le site": "📱 Escanea para abrir el sitio",
  "📱 Scanne pour t'inscrire": "📱 Escanea para inscribirte",
  "Inscriptions ouvertes": "Inscripciones abiertas",
  "🏁 Terminé": "🏁 Terminado",
  "👤 Mon compte": "👤 Mi cuenta",
  "🗺 Voir le tableau complet →": "🗺 Ver el cuadro completo →",
  "— hors tournoi": "— fuera del torneo",
  "Aucun ami — ajoute-en depuis le menu Compte.": "Sin amigos — añade desde el menú Cuenta.",
  "Inscrit par erreur ? Tu peux te désinscrire tant que les inscriptions sont ouvertes et que tu n'as pas payé.": "¿Inscrito por error? Puedes desinscribirte mientras las inscripciones estén abiertas y no hayas pagado.",
  "Jamais inscrit à un tournoi de ce club — pas de fiche": "Nunca inscrito en un torneo de este club — sin ficha",
  "Revenez bientôt !": "¡Vuelve pronto!",
  "Te désinscrire du tournoi ?": "¿Desinscribirte del torneo?",
  "Ton pseudo": "Tu usuario",
  "gérer mon compte": "gestionar mi cuenta",
  "Élimination directe": "Eliminación directa",
  "💡 Crée un compte (pseudo + email + mot de passe) pour t'inscrire en 1 clic et retrouver tes stats :": "💡 Crea una cuenta (usuario + correo + contraseña) para inscribirte en 1 clic y recuperar tus estadísticas:",
  "💰 Déjà payé : la désinscription se fait auprès de la table de marque (remboursement à voir avec le club).": "💰 Ya pagado: la desinscripción se hace en la mesa de control (reembolso a tratar con el club).",
  "📝 inscrit au tournoi": "📝 inscrito en el torneo",
  "✨ Créer un compte": "✨ Crear una cuenta",
  "Juste un pseudo, un email et un mot de passe. Rien d'autre.": "Solo un usuario, un correo y una contraseña. Nada más.",
  "Ma fiche joueur": "Mi ficha de jugador",
  "Email (pour réinit du mot de passe)": "Correo (para restablecer la contraseña)",
  "Nouvel email (vide = inchangé)": "Nuevo correo (vacío = sin cambios)",
  "Email inchangé": "Correo sin cambios",
  "✅ Email mis à jour": "✅ Correo actualizado",
  "Mot de passe (min 4)": "Contraseña (mín. 4)",
  "Se déconnecter ?": "¿Cerrar sesión?",
  "(sans compte)": "(sin cuenta)",
  "📋 Mon inscription": "📋 Mi inscripción",
  "Possible tant que les inscriptions sont ouvertes et que tu n'as pas payé.": "Posible mientras las inscripciones estén abiertas y no hayas pagado.",
  "Exporter mes données (RGPD)": "Exportar mis datos (RGPD)",
  "Voir aussi : 🔒 Confidentialité (menu ☰)": "Ver también: 🔒 Privacidad (menú ☰)",
  "Aucun ami pour le moment — recherche un pseudo ci-dessus.": "Aún no tienes amigos — busca un usuario arriba.",
  "déjà ami": "ya es amigo",
  "Suis des joueurs : tu reçois une notif quand leur match commence ou quand ils s'inscrivent à un tournoi, et leur statut ici. Pas besoin de compte pour eux : entre son pseudo dans la recherche puis « Suivre ».": "Sigue a jugadores: recibes una notificación cuando empieza su partido o cuando se inscriben en un torneo, y su estado aquí. No necesitan cuenta: escribe su usuario en la búsqueda y pulsa « Seguir ».",
  "🔔 Notifier quand le match d'un ami commence": "🔔 Avisarme cuando empieza el partido de un amigo",
  "🔔 Notifier quand un ami s'inscrit à un tournoi": "🔔 Avisarme cuando un amigo se inscribe en un torneo",
  "Activer les notifications": "Activar las notificaciones",
  "Désactiver": "Desactivar",
  "Tester la notification": "Probar la notificación",
  "Notifications activées !": "¡Notificaciones activadas!",
  "Notifications désactivées": "Notificaciones desactivadas",
  "⚠️ Aucun appareil abonné — active les notifications avant.": "⚠️ Ningún dispositivo suscrito — activa antes las notificaciones.",
  "Reçois une notification push quand un de tes matchs est lancé (même écran verrouillé).": "Recibe una notificación push cuando se inicia uno de tus partidos (incluso con la pantalla bloqueada).",
  "📱 Sur iPhone : ajoute d'abord le site à l'écran d'accueil (Safari → Partager → « Sur l'écran d'accueil »), puis active les notifications.": "📱 En iPhone: añade primero el sitio a la pantalla de inicio (Safari → Compartir → « A la pantalla de inicio »), y luego activa las notificaciones.",
  "Pas (encore !) d'inscription ni de match à afficher.": "Sin inscripción ni partido que mostrar (¡todavía!).",
  "🔍 Rechercher un pseudo… (Entrée)": "🔍 Buscar un usuario… (Intro)",
  "🎱 Match en direct": "🎱 Partido en directo",
  "← Mes matchs": "← Mis partidos",
  "+1 manche": "+1 manga",
  "−1 manche": "−1 manga",
  "🎲 Tirage à la bande": "🎲 Sorteo a la banda",
  "Chaque joueur fait rouler une bille sur le tapis : le plus proche de la bande remporte le tirage et casse en premier (⚪).": "Cada jugador hace rodar una bola por el tapete: el más cercano a la banda gana el sorteo y rompe primero (⚪).",
  "En attente de la table…": "Esperando la mesa…",
  "La table de marque va lancer le match…": "La mesa de control va a iniciar el partido…",
  "La saisie des points est bloquée tant que le tirage à la bande n'est pas fait.": "La introducción de puntos está bloqueada hasta que se haga el sorteo a la banda.",
  "Confirmer le score": "Confirmar el marcador",
  "Vérifie le score sur la table avant de confirmer.": "Comprueba el marcador en la mesa antes de confirmar.",
  "Modifier (annuler ce point)": "Editar (anular este punto)",
  "⚠️ Dernier point ?": "¿⚠️ Último punto?",
  "Le joueur qui a la casse ne fait pas de reprise ferme": "El jugador que rompe no puede hacer re-rack",
  "Seul le joueur qui a la casse peut faire une casse ferme": "Solo el jugador que rompe puede hacer un break completo",
  "Match introuvable.": "Partido no encontrado.",
  "Consultation seule — tu ne joues pas ce match.": "Solo consulta — no juegas este partido.",
  "🎱 Table de marque": "🎱 Mesa de control",
  "Espace table de marque": "Zona de mesa de control",
  "📌 Accès rapide": "📌 Acceso rápido",
  "Comptes joueurs": "Cuentas de jugadores",
  "Configurer / gérer le tournoi": "Configurar / gestionar el torneo",
  "Données": "Datos",
  "Journal d'audit": "Registro de auditoría",
  "Aucun tournoi actif pour le moment.": "No hay torneo activo por ahora.",
  "Nouveau tournoi": "Nuevo torneo",
  "Créer le tournoi": "Crear el torneo",
  "Règle": "Regla",
  "Taille max": "Tamaño máx.",
  "Nombre de tables": "Número de mesas",
  "📅 Date et heure": "📅 Fecha y hora",
  "Têtes de série": "Cabezas de serie",
  "Préfixe": "Prefijo",
  "N° série": "N.º de serie",
  "Double KO + tableau final": "Doble KO + cuadro final",
  "Double KO sur": "Doble KO de",
  "Finale seule": "Solo la final",
  "Distance spéciale": "Distancia especial",
  "Distance spéciale à partir de": "Distancia especial a partir de",
  "Réservées à partir du tour n° (vide = quarts)": "Reservadas a partir de la ronda n.º (vacío = cuartos)",
  "Tables réservées en phase finale (jamais utilisées en auto à partir des quarts)": "Mesas reservadas para la fase final (nunca usadas en automático desde los cuartos)",
  "Ordre des tables (mode auto)": "Orden de las mesas (modo auto)",
  "Ajuster auto la taille au nombre de payés": "Ajustar automáticamente el tamaño al número de pagados",
  "Nouveau joueur": "Nuevo jugador",
  "Lancer le tirage ? Inscriptions closes.": "¿Iniciar el sorteo? Las inscripciones se cerrarán.",
  "▶ Simuler tout le tournoi": "▶ Simular todo el torneo",
  "⚠️ Clôturer le tournoi": "⚠️ Cerrar el torneo",
  "Terminer le tournoi maintenant": "Finalizar el torneo ahora",
  "Terminer le tournoi maintenant ?": "¿Finalizar el torneo ahora?",
  "Termine le tournoi immédiatement (même si la finale n'a pas été jouée). Les tableaux restent en ligne.": "Finaliza el torneo inmediatamente (aunque la final no se haya jugado). Los cuadros permanecen en línea.",
  "Supprimer le tournoi": "Eliminar el torneo",
  "Supprimer le tournoi et TOUT son contenu ?": "¿Eliminar el torneo y TODO su contenido?",
  "Enregistré ✅": "Guardado ✅",
  "✅ Tournoi importé": "✅ Torneo importado",
  "📥 Exporter le tournoi actif": "📥 Exportar el torneo activo",
  "📤 Importer un JSON": "📤 Importar un JSON",
  "Exporte le tournoi actif en JSON (backup, rejouer ailleurs), ou importe un export (remplace le tournoi actif — code PIN re-demandé).": "Exporta el torneo activo en JSON (copia de seguridad, repetirlo en otro sitio), o importa una exportación (sustituye el torneo activo — se vuelve a pedir el código PIN).",
  "🗺 Voir / éditer les matchs": "🗺 Ver / editar los partidos",
  "Ouvrir le tableau": "Abrir el cuadro",
  "Ouvrir l'historique": "Abrir el historial",
  "🎱 Tables disponibles": "🎱 Mesas disponibles",
  "🎱 Table auto (libre)": "🎱 Mesa automática (libre)",
  "🤖 Mode auto :": "🤖 Modo auto:",
  "Mode auto :": "Modo auto:",
  "🤖 Gestion automatique": "🤖 Gestión automática",
  "Lance automatiquement le prochain match dès qu'un match se termine (priorité : Tour 1, puis LB1#1, WB2#1, LB2#1…).": "Inicia automáticamente el próximo partido en cuanto termina otro (prioridad: Ronda 1, luego LB1#1, WB2#1, LB2#1…).",
  "🔔 Notif push « inscriptions ouvertes »": "🔔 Notificación push de « inscripciones abiertas »",
  "🔔 Rappel inscriptions ouvertes (push aux joueurs abonnés)": "🔔 Recordatorio de inscripciones abiertas (push a los jugadores suscritos)",
  "Clique sur un match du tableau pour lancer, corriger le score, déclarer un forfait ou rouvrir — sans quitter le tableau.": "Pulsa en un partido del cuadro para iniciarlo, corregir el marcador, declarar un abandono o reabrirlo — sin salir del cuadro.",
  "📏 Distances (modifiables à tout moment)": "📏 Distancias (modificables en cualquier momento)",
  "Inscrit des joueurs fictifs en masse, directement payés.": "Inscribe jugadores fictivos en masa, directamente pagados.",
  "— aucun (coupe net) —": "— ninguna (corte directo) —",
  "ex: 1,2 (vide = aucune)": "ej.: 1,2 (vacío = ninguna)",
  "marquer payé": "marcar como pagado",
  "🗄 Gestion des données": "🗄 Gestión de datos",
  "👥 Joueurs": "👥 Jugadores",
  "🎱 Matchs": "🎱 Partidos",
  "📜 Events d'un match": "📜 Eventos de un partido",
  "Choisis un match.": "Elige un partido.",
  "Aucun tournoi actif.": "No hay torneo activo.",
  "Aucun événement.": "Ningún evento.",
  "🔍 Filtrer (pseudo/joueur) — Entrée": "🔍 Filtrar (usuario/jugador) — Intro",
  "➕ manche": "➕ manga",
  "🎲 tirage à la bande": "🎲 sorteo a la banda",
  "🚀 lancement": "🚀 inicio del partido",
  "▶ tournoi actif": "▶ torneo activo",
  "État": "Estado",
  "(recalcul du score)": "recálculo del marcador",
  "Supprimer cet événement ? Le score sera recalculé.": "¿Eliminar este evento? El marcador se recalculará.",
  "👤 Comptes joueurs": "👤 Cuentas de jugadores",
  "Aucun compte.": "Ninguna cuenta.",
  "Aucun ami": "Sin amigos",
  "Aucune notification activée": "Ninguna notificación activada",
  "Créé le": "Creado el",
  "Dernière connexion": "Última conexión",
  "Nb inscri. tournois": "Inscripciones en torneos",
  "✏️ pseudo": "✏️ usuario",
  "Renommer le pseudo du compte": "Renombrar el usuario de la cuenta",
  "Changer le mot de passe du compte": "Cambiar la contraseña de la cuenta",
  "🔍 Rechercher (pseudo ou email)…": "🔍 Buscar (usuario o correo)…",
  "✅ Pseudo changé": "✅ Usuario cambiado",
  "✅ Mot de passe changé (sessions invalidées)": "✅ Contraseña cambiada (sesiones invalidadas)",
  "Rétrograder en simple utilisateur (le PIN restera nécessaire pour l’admin)": "Degradar a usuario normal (el PIN seguirá siendo necesario para la administración)",
  "Promouvoir administrateur (sa session suffira pour l’admin, sans PIN)": "Promover a administrador (su sesión bastará para la administración, sin PIN)",
  "Rétrograder": "Degradar",
  "Rechercher (action, cible, détails)…": "Buscar (acción, objetivo, detalles)…",
  "Action exacte (ex: tirage)": "Acción exacta (ej.: sorteo)",
  "Vider le journal": "Vaciar el registro",
  "Vider tout le journal d'audit ? (irréversible)": "¿Vaciar todo el registro de auditoría? (irreversible)",
  "✖ Tout afficher": "✖ Mostrar todo",
  "⏪ Restaurer à ce point": "⏪ Restaurar a este punto",
  "✅ Tournoi restauré": "✅ Torneo restaurado",
  "Le contenu actuel du tournoi sera remplacé.": "El contenido actual del torneo será reemplazado.",
  "Exemples de matchs modifiés:": "Ejemplos de partidos modificados:",
  "⚙️ Guide admin": "⚙️ Guía de administración",
  "1. Créer le tournoi": "1. Crear el torneo",
  "2. Inscriptions": "2. Inscripciones",
  "3. Tirage": "3. Sorteo",
  "4. Lancer les matchs": "4. Iniciar los partidos",
  "5. Interventions en cours (clic card avec PIN → modale ⚙️)": "5. Intervenciones durante el torneo (clic en la tarjeta con PIN → modal ⚙️)",
  "6. Données (/admin-data.html)": "6. Datos (/admin-data.html)",
  "7. Classement par points": "7. Clasificación por puntos",
  "8. Clôturer": "8. Cerrar",
  "9. Annuler une action : rollback point-in-time (journal d'audit)": "9. Anular una acción: retroceso point-in-time (registro de auditoría)",
  "10. Comptes & audit": "10. Cuentas y auditoría",
  "11. Tests & déploiement": "11. Tests y despliegue",
  "Accès : code PIN (env `ADMIN_PIN`) ou session d'un compte avec le rôle `admin` (bootstrap via `ADMIN_EMAIL`/`ADMIN_PASSWORD`, promotion depuis /admin-comptes.html).": "Acceso: código PIN (env `ADMIN_PIN`) o la sesión de una cuenta con el rol `admin` (arranque vía `ADMIN_EMAIL`/`ADMIN_PASSWORD`, promoción desde /admin-comptes.html).",
  "/admin-tournoi.html → nom, règle, taille (16/32/64/128), format (élim. directe / double KO + nb tours), nb tables, date. Ajustement auto à la taille des payés. Tables réservées: vide par défaut. En phase inscription, la TV montre un grand QR centré pour s'inscrire. Switch 🔔 « Notif push « inscriptions ouvertes » (coché par défaut) : à la création, un push « 🎱 Nouveau tournoi — inscriptions ouvertes » est envoyé à tous les comptes abonnés.": "/admin-tournoi.html → nombre, regla, tamaño (16/32/64/128), formato (eliminación directa / doble KO + n.º de rondas), n.º de mesas, fecha. Ajuste automático al tamaño de los pagados. Mesas reservadas: vacío por defecto. En fase de inscripción, la TV muestra un gran QR centrado para inscribirse. Interruptor 🔔 « Notificación push de « inscripciones abiertas » (marcado por defecto): al crearlo, se envía un push « 🎱 Nuevo torneo — inscripciones abiertas » a todas las cuentas suscritas.",
  "Ajouter / simuler / payer / supprimer. Seuls les payés sont tirés. ⛔ Pseudo d'un compte = réservé: inscription anonyme refusée (409, anti-usurpation); ajout admin possible après confirmation (joueur rattaché au compte). Un invité qui crée un compte avec le même pseudo est rattaché auto (reçoit les pushs). ♻️ Un compte connecté peut se désinscrire lui-même (bouton « Me désinscrire »), en phase d'inscription uniquement et avant paiement ; un joueur déjà payé ou sans compte passe par un admin. Pseudo/mdp oublié → /admin-comptes.html (✏️ pseudo, 🔑 mdp).": "Añadir / simular / pagar / eliminar. Solo se sortean los pagados. ⛔ El usuario de una cuenta = reservado: inscripción anónima rechazada (409, anti-usurpación); añadir vía administración posible tras confirmación (jugador vinculado a la cuenta). Un invitado que crea una cuenta con el mismo usuario queda vinculado automáticamente (recibe los push). ♻️ Una cuenta conectada puede desinscribirse sola (botón « Desinscribirme »), solo en fase de inscripción y antes de pagar; un jugador ya pagado o sin cuenta pasa por la administración. Usuario/contraseña olvidados → /admin-comptes.html (✏️ usuario, 🔑 contraseña).",
  "Bouton Tirage: appariements aléatoires crypto, byes répartis. ⚠️ Fige le bracket (retour en arrière possible uniquement par rollback point-in-time via le journal d'audit, voir §9).": "Botón de sorteo: emparejamientos aleatorios criptográficos, byes repartidos. ⚠️ Congela el bracket (solo se puede volver atrás mediante retroceso point-in-time en el registro de auditoría, ver §9).",
  "Mode auto ON = départ auto sur table libre (ordre personnalisable). Manuel: clic sur une card (PIN) → modale. Tirage à la bande ⚪ sur la card, puis alternance à chaque manche. Joueurs: seul le ⚪ fait « casse ferme », l'autre « reprise ferme » (grisé + 403). Dernier point = confirmation obligatoire.": "Modo auto ON = salida automática en mesa libre (orden personalizable). Manual: clic en una tarjeta (PIN) → modal. Sorteo a la banda ⚪ en la tarjeta, luego alternancia en cada manga. Jugadores: solo el ⚪ hace « break completo », el otro « re-rack » (en gris + 403). Último punto = confirmación obligatoria.",
  "✏️ Corriger le score (si distance atteinte → termine + propage)": "✏️ Corregir el marcador (si se alcanza la distancia → finaliza + propaga)",
  "🎱 Déplacer de table (409 si occupée, « aucune » pour libérer)": "🎱 Cambiar de mesa (409 si está ocupada, « ninguna » para liberarla)",
  "👥 Changer les joueurs (WB/LB, blanc possible, bye auto) — 409 auto si la paire est déjà appariée ailleurs (hors finale): rematch impossible": "👥 Cambiar los jugadores (WB/LB, blanco posible, bye automático) — 409 automático si la pareja ya está emparejada en otro sitio (salvo la final): imposible repetir el duelo",
  "🔓 Rouvrir un match — ⚠️ 409 INTERDIT si un match aval a déjà commencé": "🔓 Reabrir un partido — ⚠️ 409 PROHIBIDO si un partido posterior ya ha empezado",
  "🚫 Forfait (définitif)": "🚫 Abandono (definitivo)",
  "Onglets Matchs / Joueurs / Events sur le tournoi actif OU un tournoi terminé (sélecteur), filtre par pseudo (Entrée). Events: 🗑 supprime un event et recalcule le score → les stats se corrigent. Joueurs: éditer pseudo/statut, supprimer.": "Pestañas Partidos / Jugadores / Eventos en el torneo activo O en un torneo terminado (selector), filtro por usuario (Intro). Eventos: 🗑 elimina un evento y recalcula el marcador → las estadísticas se corrigen. Jugadores: editar usuario/estado, eliminar.",
  "Points = profondeur atteinte (WB: tour, F: k+tour en DKO), ex-aequo (1,1,1,4…). Les matchs clôturés sans gagnant ne comptent pas comme perdus.": "Puntos = profundidad alcanzada (WB: ronda, F: k+ronda en DKO), empates (1,1,1,4…). Los partidos cerrados sin ganador no cuentan como perdidos.",
  "Règles DKO: WB/LB séparés jusqu'en finale; en F, alternance des moitiés + swap anti-rematch auto sur tous les tours WB/LB/F (rematch autorisé uniquement en vraie finale).": "Reglas DKO: WB/LB separados hasta la final; en F, alternancia de mitades + intercambio anti-repetición automático en todas las rondas WB/LB/F (repetición permitida solo en la verdadera final).",
  "« Terminer maintenant » = coupe net, aucun champion auto (sauf choix explicite dans le select). Fin normale = champion auto via la finale. Historique ensuite en liste + recherche/surbrillance joueur.": "« Finalizar ahora » = corte directo, sin campeón automático (salvo elección explícita en el selector). Final normal = campeón automático vía la final. Historial después en lista + búsqueda/resaltado de jugador.",
  "/admin-journal.html : chaque action admin est loguée ET snapshotée. Bouton ⏮ « Restaurer à ce point » sur une entrée = restaure le tournoi actif à l'état exact de cet événement (transaction atomique ; fonctionne même avec des matchs en cours → remis à 0-0, tables libérées). Un diff (matchs modifiés/ajoutés/supprimés, joueurs, statut, champion) s'affiche dans la confirmation avant validation. 409 si le snapshot concerne un autre tournoi, 404 sans snapshot. Le rollback est lui-même logué. Filtres du journal : recherche texte + type d'action.": "/admin-journal.html: cada acción de administración se registra Y se captura en snapshot. Botón ⏮ « Restaurar a este punto » en una entrada = restaura el torneo activo al estado exacto de ese evento (transacción atómica; funciona incluso con partidos en curso → vuelven a 0-0, mesas liberadas). Un diff (partidos modificados/añadidos/eliminados, jugadores, estado, campeón) se muestra en la confirmación antes de validar. 409 si el snapshot es de otro torneo, 404 sin snapshot. El retroceso también queda registrado. Filtros del registro: búsqueda de texto + tipo de acción.",
  "/admin-comptes.html: liste (dernière connexion, inscri., matchs, sessions, amis : amis avec compte + pseudos suivis sans compte), ✏️ pseudo, 🔑 mdp, 🗑 supprimer (historique matchs conservé). Purge auto des comptes inactifs > 18 mois. /admin-journal.html: 500 dernières actions admin, lancements lisibles (« wb1-001 — P11 vs P07 (table 3) »). Le rollback point-in-time (bouton ⏮ « Restaurer à ce point ») est détaillé §9. 🔐 Toute action destructive (suppression tournoi/compte/event, vidage du journal, rollback) exige le code PIN re-saisi (modale masquée, `confirm_pin`) — sauf la désinscription d'un joueur. Une session de compte avec le rôle `admin` ne redemande pas le PIN, mais exige de saisir le mot `SUPPRIMER` dans la modale de confirmation.": "/admin-comptes.html: lista (última conexión, inscripciones, partidos, sesiones, amigos: amigos con cuenta + usuarios seguidos sin cuenta), ✏️ usuario, 🔑 contraseña, 🗑 eliminar (se conserva el historial de partidos). Purga automática de cuentas inactivas > 18 meses. /admin-journal.html: últimas 500 acciones de administración, salidas legibles (« wb1-001 — P11 vs P07 (mesa 3) »). El retroceso point-in-time (botón ⏮ « Restaurar a este punto ») se detalla en §9. 🔐 Toda acción destructiva (eliminación de torneo/cuenta/evento, vaciado del registro, retroceso) exige reintroducir el código PIN (modal enmascarada, `confirm_pin`) — salvo la desinscripción de un jugador. Una sesión de cuenta con el rol `admin` no vuelve a pedir el PIN, pero exige escribir la palabra `SUPPRIMER` en la modal de confirmación.",
  "Batterie: BASE=http://127.0.0.1:PORT node test/batterie.js (203 checks → test/rapport.md) + test/e2e.js + test/fullrun.js ; sans serveur : node test/push-unit.js (push mocké), node test/purge-unit.js (purge > 90 j). Fly: secrets ADMIN_PIN, RESEND_API_KEY, MAIL_FROM, VAPID_* (jamais BASE_URL); volume tournoi_data sur /data; snapshots dans Volumes.": "Batería: BASE=http://127.0.0.1:PORT node test/batterie.js (203 checks → test/rapport.md) + test/e2e.js + test/fullrun.js ; sin servidor: node test/push-unit.js (push simulado), node test/purge-unit.js (purga > 90 d). Fly: secrets ADMIN_PIN, RESEND_API_KEY, MAIL_FROM, VAPID_* (nunca BASE_URL); volumen tournoi_data en /data; snapshots en Volumes.",
  "Version complète: docs/GUIDE_ADMIN.md dans le dépôt GitHub.": "Versión completa: docs/GUIDE_ADMIN.md en el repositorio GitHub.",
  "Aucun tournoi terminé.": "Ningún torneo terminado.",
  "Consultation et suppression (admin).": "Consulta y eliminación (administración).",
  "Simuler tout le tournoi (scores aléatoires) jusqu'au champion ?": "¿Simular todo el torneo (marcadores aleatorios) hasta el campeón?",
  "payé annuler": "pagado cancelar",
  "déjà suivi": "ya seguido",
  "👤 Connecté en tant que": "👤 Conectado como",
  "Retour à": "Volver a",
  "Restaurer le tournoi actif à l'état de cet événement ?": "¿Restaurar el torneo activo al estado de este evento?",
  "Ou": "O",
  "⚙️ Paramètres": "⚙️ Ajustes",
  "Mode clair": "Modo claro",
  "🔑 Connexion": "🔑 Iniciar sesión",
  "Connexion": "Iniciar sesión",
  "Mes matchs": "Mis partidos",
  "Fil du tournoi": "Crónica del torneo",
  "Replier": "Ver menos",
  "en direct": "en directo",
  "☰ Menu": "☰ Menú",
  "Menu": "Menú",
  "🏆 Titres": "🏆 Títulos",
  "Perdus": "Perdidos",
  "% victoires": "% victorias",
  "⭐ Pts": "⭐ Pts",
  "💥 Run-outs": "💥 Run-outs",
  "Guide admin": "Guía de administración",
  "Historique public": "Historial público",
  "🔗 Liens publics": "🔗 Enlaces públicos",
  "💾 Sauvegarde (export / import JSON)": "💾 Copia de seguridad (exportación / importación JSON)",
  "📍 Lieu": "📍 Lugar",
  "géré dans sa page dédiée": "gestionado en su página dedicada",
  "Format": "Formato",
  "Inscrire": "Inscribir",
  "Corriger": "Corregir",
  "Nombre": "Número",
  "Jamais (3 partout)": "Nunca (3 en todas partes)",
  "Distance (3/5/7) :": "Distancia (3/5/7):",
  "Motif :": "Motivo:",
  "correction table de marque": "corrección de la mesa de control",
  "Champion (optionnel)": "Campeón (opcional)",
  "Enregistrer date/lieu": "Guardar fecha/lugar",
  "Enregistrer l'ordre": "Guardar el orden",
  "Tableau final": "Cuadro final",
  "Tour": "Ronda",
  "🎬 Simulation": "🎬 Simulación",
  "🎲 Mode simulation": "🎲 Modo simulación",
  "🏆 Champion :": "🏆 Campeón:",
  "ACTIF": "ACTIVO",
  "ACTIF ✅": "ACTIVO ✅",
  "inactif": "inactivo",
  "· après la belle": "· tras la bella",
  "· revanche prise !": "· ¡revancha conseguida!",
  "· revanche manquée": "· revancha fallida",
  "Le club": "El club",
  "Club introuvable": "Club no encontrado",
  "Club inconnu ici, tu regardes le club par défaut": "Club desconocido aquí, estás viendo el club predeterminado",
  "Choisis ton club": "Elige tu club",
  "Bienvenue sur la plateforme": "Bienvenida a la plataforma",
  "Plateforme": "Plataforma",
  "Hub de la plateforme": "Hub de la plataforma",
  "Choisis ton club, ouvre un tournoi en cours, retrouve un joueur.": "Elige tu club, abre un torneo en curso, encuentra a un jugador.",
  "Reprendre": "Reanudar",
  "Les tournois en cours et à venir": "Torneos en curso y próximos",
  "Aucun tournoi en cours ou à venir.": "Ningún torneo en curso ni próximo.",
  "Joueur de la plateforme": "Jugador de la plataforma",
  "Un pseudo": "Un pseudo",
  "Rechercher un joueur": "Buscar a un jugador",
  "Rechercher un joueur dans tous les clubs de la plateforme.": "Busca a un jugador en todos los clubes de la plataforma.",
  "Résultats": "Resultados",
  "Aucun joueur trouvé.": "Ningún jugador encontrado.",
  "Un seul compte pour toute la plateforme : le même login dans tous les clubs.": "Una sola cuenta para toda la plataforma: el mismo inicio de sesión en todos los clubes.",
  "Bannière du club": "Banner del club",
  "Bannière de l accueil": "Banner de inicio",
  "Retirer la bannière": "Quitar el banner",
  "Importer une bannière (PNG/JPG/SVG, photo jusqu à 8 Mo, réduite à 1600 px)": "Importar un banner (PNG/JPG/SVG, foto de hasta 8 MB, reducida a 1600 px)",
  "Photo affichée en tête de l accueil et de la page Le club pour tous les visiteurs.": "Foto mostrada en la cabecera de la portada y de la página El club para todos los visitantes.",
  "Photo de fond de la TV": "Foto de fondo de la TV",
  "Retirer le fond de TV": "Quitar el fondo de la TV",
  "Importer un fond de TV (PNG/JPG/SVG, photo jusqu à 8 Mo, réduite à 1280 px)": "Importar un fondo de TV (PNG/JPG/SVG, foto de hasta 8 MB, reducida a 1280 px)",
  "Photo de fond affichée derrière les scores de l écran TV (assombrie automatiquement).": "Foto de fondo detrás de los resultados de la pantalla TV del club (oscurecida automáticamente).",
  "Page Le club": "Página El club",
  "Logo, bannière et textes de la page publique « Le club » (lien du menu).": "Logo, banner y textos de la página pública « El club » (enlace del menú).",
  "Présentation du club (500 caractères max)": "Presentación del club (500 caracteres máximo)",
  "Contact (page Le club, 200 caractères max)": "Contacto (página El club, 200 caracteres máximo)",
  "Image refusée": "Imagen rechazada",
  "Cause : l image réduite dépasse encore la taille maximum, choisis une image plus simple.": "Causa: la imagen reducida todavía supera el tamaño máximo, elige una imagen más simple.",
  "Icône du téléphone": "Icono del teléfono",
  "Le logo devient l app des téléphones (icône 192 px, effective aux prochaines installations).": "El logo se convierte en la app del teléfono (icono de 192 px, aplicada en futuras instalaciones).",
};
// remplacements dynamiques ES : meme ordre que les regex de I18N_DYN
const REPS_DYN_ES = [
  "Error $1",
  "Ficha de jugador de $1",
  "¿Desinscribirse del torneo « $1 »?",
  "¿Eliminar al jugador « $1 »?",
  "¿Eliminar « $1 » del historial?",
  "¿Eliminar definitivamente « $1 » del historial?",
  "Gestionar el torneo « $1 »",
  "🕐 programado contra $1",
  "🕐 partido programado contra $1",
  "🟢 en curso contra $1",
  "✅ Inscrito (pagado)",
  "✅ Inscrito (pendiente de pago)",
  "Inscribirse en « $1 » como $2",
  "Cuadro de $1",
  "Iniciar el sorteo ($1 pagados)",
  "⏳ Listos para empezar ($1)",
  "¿Abandono de $1?",
  "Marcador de $1 (0-$2):",
  "Nuevo usuario para « $1 » (mín. $2 caracteres):",
  "Nueva contraseña para « $1 » (mín. $2 caracteres):",
  "¿Eliminar la cuenta « $1 »?\nLos jugadores vinculados quedan desasociados (se conserva el historial de partidos), y las sesiones y suscripciones push se eliminan.",
  "Mangas ganadas: $1",
  "⚔️ Cara a cara ($1 adversario)",
  "⚔️ Cara a cara ($1 adversarios)",
  "🎱 $1 jugados",
  "🏆 $1 ganados",
  "Inicio: $1",
  "· Duración: $1",
  "🏁 $1 gana el partido",
  "🏆 $1 gana el partido",
  "El marcador pasaría a $1 - $2.",
  "📍 Ir a la mesa n.º $1",
  "Historial de torneos ($1)",
  "Historial ($1 torneos terminados)",
  "$1 jugadores registrados",
  "$1 inscripción(es)",
  "$1 entradas eliminadas",
  "Volver a $1",
  "¿Reabrir el partido n.º $1? El resultado se anula y los partidos siguientes se vaciarán.",
  "$1/$2 inscritos · $3 pagados",
  "$1 máx · $2 inscritos · $3 pagados · $4 mesas",
  "$1/$2 partidos jugados",
  "$1 mesas creadas · $2 libres",
  "$1 jugadores",
  "$1 inscritos",
  "$1 pagados",
  "$1 libres",
  "DKO de $1 rondas",
  "DKO de $1 rondas + cuadro final",
  "eliminación directa",
  "Partidos modificados: $1 · añadidos: $2 · eliminados: $3",
  "Evento n.º $1 ($2) el $3",
  "¿Restaurar el torneo activo al estado de este evento?\n\n",
  "Mesa $1 (ocupada)",
  "⏳ Sorteo aún no realizado: estructura del cuadro vacía, las plazas j1 a j$1 las ocuparán los jugadores tras el sorteo",
  "Simulación terminada: $1 partidos jugados. $2",
  "$1 $2/$3/$4 a las $5:$6",
  "$1/$2/$3 a las $4:$5",
  "Ya existe una cuenta con el usuario « $1 ».\n\n¿Inscribir de todos modos a este jugador? Quedará vinculado a esa cuenta (notificaciones de « te toca jugar » y de amigos incluidas).\n\nSi no, el titular puede inscribirse él mismo desde su cuenta.",
  "¿Quitar a $1 de tus amigos?",
  "¡📨 Notificación de prueba enviada ($1 dispositivo(s))!",
  "🎱 Partidos ($1)",
  "⏱ inicio $1",
  "⏱ duración media $1",
  "$1 a las $2:$3",
  "$1 $2 a las $3:$4",
  "$1 vence a $2 $3-$4",
  "· mesa $1",
  "· torneo terminado para $1",
  "$1 declara forfait, $2 pasa a la ronda siguiente",
  "🏆 ¡$1 gana el torneo!",
  "¡Emoción! $1 y $2 están a un frame de ganar en la mesa $3",
  "¡Emoción! $1 y $2 están a un frame de ganar",
  "hace un instante",
  "hace $1 min",
  "hace $1 h",
  "hace $1 d",
  "$1 se impone a $2 $3-$4",
  "$1 supera a $2 $3-$4",
  "$1 domina a $2 $3-$4",
  "$1 aparta a $2 $3-$4",

  "$1 supera con autoridad a $2 $3-$4",
  "$1 impone su ley ante $2 $3-$4",
  "$1 se retira, $2 pasa a la ronda siguiente",
  "forfait de $1, $2 pasa a la ronda siguiente",
  "$1 tira la toalla, $2 pasa a la ronda siguiente",
  "forfait de $1, $2 avanza sin jugar",

  "$1 no se presenta, $2 pasa a la ronda siguiente",
  "forfait de $1: $2 pasa directo a la ronda siguiente",
  "🏆 ¡$1 levanta el trofeo!",
  "🏆 ¡$1 se lleva el título!",
  "🏆 Fin del suspenso: ¡$1 es campeón!",
  "🏆 $1 tuvo la última palabra: ¡el título es suyo!",

  "🏆 ¡$1 entra al palmarés del club!",
  "🏆 ¡$1 reina sobre el torneo!",
  "¡El decisivo! $1 y $2 en la mesa $3",
  "¡Todo se decide entre $1 y $2 (mesa $3)!",
  "¡Manga decisiva entre $1 y $2 (mesa $3)!",
  "Todos de pie: ¡$1 y $2 disputan la bella en la mesa $3!",

  "¡El torneo se decide ahora: $1 y $2 a la bella en la mesa $3!",
  "¡Última manga para $1 y $2 en la mesa $3!",
  "¡La bella entre $1 y $2!",

  "¡Todo se decide entre $1 y $2!",
  "¡Manga decisiva entre $1 y $2!",
  "🔥 Revancha: ¡$1 juega contra $2 con una revancha por delante!",
  "🔥 ¡$1 juega su revancha contra $2!",
  "🔥 ¡$1 vuelve a intentarlo contra $2!",
  "🔥 ¡$1 quiere darle la vuelta contra $2!",
  "🔥 ¡A $1 le toca encontrar la grieta ante $2!",

  "🔥 ¡$1 tiene cuentas pendientes con $2!",
  "🔥 Este partido huele a revancha: ¡$1 desafía a $2!",
  "🔥 Revancha: ¡$1 y $2 se reencuentran en total igualdad!",
  "🔥 Orgullo en juego: ¡$1 y $2 se reencuentran!",
  "🔥 $1 y $2 se reencuentran, marcador perfectamente equilibrado!",
  "🔥 Empate perfecto antes de esta ronda: ¡$1 vs $2!",

  "🔥 Viejos conocidos cara a cara: ¡$1 y $2 se reencuentran!",
  "🔥 Nada que los separe: ¡$1 y $2 escriben un nuevo capítulo!",
  "$1 lidera $2-$3",
  "· duración $1 min",
  "· duración $1 h $2",
  "Enviado: « $1 », $2 KB, tipo MIME « $3 ».",
];

// --- i18n IT : dictionnaire italien (cles = textes fr, meme jeu que I18N) + remplacements dynamiques ---
const I18N_IT = {
  "🎨 Apparence du club": "🎨 Aspetto del club",
  "Couleur d accent": "Colore d'accento",
  "Nom par défaut des tournois": "Nome del torneo predefinito",
  "Jour récurrent": "Giorno ricorrente",
  "Heure habituelle": "Ora abituale",
  "Personnalisation enregistrée": "Personalizzazione salvata",
  "Visible par tous les visiteurs du club.": "Visibile a tutti i visitatori del club.",
  "Logo du club": "Logo del club",
  "Aucun logo": "Nessun logo",
  "Logo prédéfini ou importé, affiché en filigrane discret et à côté du nom du club pour tous les visiteurs.": "Logo predefinito o importato, mostrato come filigrana discreta e accanto al nome del club per tutti i visitatori.",
  "Importer une image (PNG/JPG/SVG, photo jusqu à 8 Mo, réduite à 256 px)": "Importa un'immagine (PNG/JPG/SVG, foto fino a 8 MB, ridotta a 256 px)",
  "Logo trop volumineux ou format non supporté": "Logo troppo grande o formato non supportato",
  "Logo refusé": "Logo rifiutato",
  "Aperçu du logo retenu : « Enregistrer » l applique aux pages du club pour tous les visiteurs.": "Anteprima del logo selezionato: « Salva » lo applica alle pagine del club per tutti i visitatori.",
  "Logo importé": "Logo importato",
  "Adresse par défaut du club": "Indirizzo predefinito del club",
  "Attendu : image PNG, JPG ou SVG décodable (photo iPhone acceptée), 8 Mo maximum.": "Atteso: immagine PNG, JPG o SVG decodificabile (foto iPhone accettata), 8 MB massimo.",
  "Cause : fichier plus lourd que la limite de 8 Mo.": "Causa: file più pesante del limite di 8 MB.",
  "Cause probable : le navigateur n a pas réussi à décoder ce fichier (fichier endommagé ou format d image exotique).": "Causa probabile: il browser non è riuscito a decodificare questo file (file danneggiato o formato immagine esotico).",
  "Cause probable : le fichier SVG est vide ou ne contient pas de balise <svg>.": "Causa probabile: il file SVG è vuoto o non contiene alcun tag <svg>.",
  "Affichage du logo": "Visualizzazione del logo",
  "Logo d en-tête": "Logo dell'intestazione",
  "Filigrane": "Filigrana",
  "Logo + filigrane": "Logo + filigrana",
  "Dimanche": "Domenica",
  "Lundi": "Lunedì",
  "Mardi": "Martedì",
  "Mercredi": "Mercoledì",
  "Jeudi": "Giovedì",
  "Vendredi": "Venerdì",
  "Samedi": "Sabato",
  "Clubs": "Club",
  "Créer un club": "Crea un club",
  "Nom du club": "Nome del club",
  "Code PIN du club": "Codice PIN del club",
  "Code PIN propre": "Codice PIN proprio",
  "Comptes rattachés": "Account collegati",
  "Actif": "Attivo",
  "Inactif": "Inattivo",
  "Activer": "Attiva",
  "Rôles du club": "Ruoli del club",
  "Administrateur": "Amministratore",
  "Opérateur": "Operatore",
  "Retirer": "Rimuovi",
  "Aide": "Aiuto",
  "Amis": "Amici",
  "Annuler": "Annulla",
  "Aucun ami pour le moment": "Ancora nessun amico",
  "Aucun historique": "Nessuna cronologia",
  "Aucun match pour le moment": "Ancora nessuna partita",
  "Aucun tournoi pour le moment": "Nessun torneo al momento",
  "Aucun tournoi": "Nessun torneo",
  "Aucune donnée": "Nessun dato",
  "Bille perdue": "Bila persa",
  "Bille perdue ?": "Bila persa?",
  "Classement": "Classifica",
  "Club": "Club",
  "Compte": "Account",
  "Confidentialité": "Privacy",
  "Confirmation": "Conferma",
  "Connecté": "Connesso",
  "Connecte-toi pour t'inscrire": "Accedi per iscriverti",
  "Créer mon compte": "Crea il mio account",
  "Créer un compte": "Crea un account",
  "Déconnexion": "Disconnessione",
  "Défaite": "Sconfitta",
  "Défaillant": "Perdente",
  "Détails": "Dettagli",
  "Distance": "Distanza",
  "En cours": "In corso",
  "Enregistrer": "Salva",
  "En cours de match": "In partita",
  "Envoi du lien de réinitialisation...": "Invio del link di ripristino...",
  "Envoi...": "Invio...",
  "Erreur": "Errore",
  "Fermer": "Chiudi",
  "Final": "Finale",
  "Finale": "Finale",
  "Forfait": "Forfait",
  "Gagnant": "Vincitore",
  "gagnant": "vincitore",
  "Gagné": "Vinto",
  "Historique": "Cronologia",
  "Honnêteté": "Sportività",
  "Inconnu": "Sconosciuto",
  "Inscrits": "Iscritti",
  "Inscription": "Iscrizione",
  "Inséré": "Iscritto",
  "Interrompu": "Interrotto",
  "Joueur": "Giocatore",
  "Mon tournoi": "Il mio torneo",
  "Joueurs": "Giocatori",
  "jour": "giorno",
  "Langue": "Lingua",
  "Manche": "Frame",
  "Manches": "Frame",
  "Manches gagnées": "Frame vinti",
  "Match": "Partita",
  "Matchs": "Partite",
  "Matchs en direct": "Partite in diretta",
  "Me désinscrire": "Annulla la mia iscrizione",
  "Mon espace": "Il mio spazio",
  "Mot de passe": "Password",
  "Mot de passe oublié ?": "Password dimenticata?",
  "Modifier": "Modifica",
  "Mute": "Muto",
  "Notifications": "Notifiche",
  "Nom": "Nome",
  "Non": "No",
  "Oui": "Sì",
  "Ouvrir": "Apri",
  "Paramètres": "Impostazioni",
  "Perdu": "Perso",
  "Perdant": "Perdente",
  "perdant": "perdente",
  "Pseudo": "Nome utente",
  "Prévu": "Programmata",
  "Prêt": "Pronto",
  "Points": "Punti",
  "Quitter": "Esci",
  "Rafraîchir": "Aggiorna",
  "Rejouer": "Rigioca",
  "Remerciements": "Ringraziamenti",
  "Retour": "Indietro",
  "Réduire": "Riduci",
  "Réglages": "Impostazioni",
  "Score": "Punteggio",
  "Se connecter": "Accedi",
  "Se déconnecter": "Disconnetti",
  "Sécurité": "Sicurezza",
  "Statistiques": "Statistiche",
  "Stats": "Stat",
  "Suivre": "Segui",
  "Suivi": "Seguito",
  "Suivre un joueur": "Segui un giocatore",
  "Table de marque": "Tavolo arbitrale",
  "← Table de marque": "← Tavolo arbitrale",
  "Tables": "Tavoli",
  "Terminé": "Terminato",
  "Terminer": "Termina",
  "Thème": "Tema",
  "Titres": "Titoli",
  "Ton compte": "Il tuo account",
  "Tournoi": "Torneo",
  "Tournoi précédent": "Torneo precedente",
  "Tournois": "Tornei",
  "Tout voir": "Vedi tutto",
  "Tableau": "Tabellone",
  "Vainqueur": "Vincitore",
  "Valider": "Conferma",
  "Victoire": "Vittoria",
  "Victoires": "Vittorie",
  "Vues": "Visite",
  "Échec": "Fallito",
  "Éditer": "Modifica",
  "Préférences": "Preferenze",
  "Prénom": "Nome di battesimo",
  "Email": "Email",
  "Chargement...": "Caricamento...",
  "Charger plus": "Carica altro",
  "Changer de club": "Cambia club",
  "M'inscrire": "Iscrivimi",
  "Inscriptions": "Iscrizioni",
  "Nombre de joueurs": "Numero di giocatori",
  "Numéro de match": "Numero di partita",
  "Aucun joueur trouvé": "Nessun giocatore trovato",
  "Aucun résultat": "Nessun risultato",
  "Tournoi terminé": "Torneo terminato",
  "Tournoi en cours": "Torneo in corso",
  "Tirage au sort": "Sorteggio",
  "tirage": "sorteggio",
  "Faute": "Fallo",
  "Fautes": "Falli",
  "Meilleure série": "Serie migliore",
  "Membre": "Membro",
  "Membres": "Membri",
  "Suite": "Avanti",
  "Suivant": "Avanti",
  "Précédent": "Precedente",
  "Accueil": "Home",
  "Aucun": "Nessuno",
  "Aucune": "Nessuna",
  "Ajouter": "Aggiungi",
  "Supprimer": "Elimina",
  "Confirmer": "Conferma",
  "Copier": "Copia",
  "Copié !": "Copiato!",
  "Attention": "Attenzione",
  "Info": "Info",
  "Libre": "Libero",
  "Occupée": "Occupato",
  "Manche en cours": "Frame in corso",
  "Match en cours": "Partita in corso",
  "Clic = éditer (admin)": "Clic = modifica (admin)",
  "Déjà suivi": "Già seguito",
  "Ne plus suivre": "Non seguire più",
  "Face à face": "Testa a testa",
  "Adversaire": "Avversario",
  "Adversaires": "Avversari",
  "Série": "Serie",
  "Séries": "Serie",
  "Trois quarts": "Quarti di finale",
  "Quarts": "Quarti",
  "Demis": "Semifinali",
  "Demi-finales": "Semifinali",
  "Poules": "Gironi",
  "Poule": "Girone",
  "Vidéos": "Video",
  "A propos": "Chi siamo",
  "Voir": "Vedi",
  "Voir tout": "Vedi tutto",
  "Eight Ball Pink City — Tournoi": "Eight Ball Pink City — Torneo",
  "Mon compte — Pink City Billard": "Il mio account — Pink City Billard",
  "Paramètres — Pink City Billard": "Impostazioni — Pink City Billard",
  "Amis — Pink City Billard": "Amici — Pink City Billard",
  "Mes matchs — Pink City Billard": "Le mie partite — Pink City Billard",
  "Match — Pink City Billard": "Partita — Pink City Billard",
  "Fiche joueur — Pink City Billard": "Scheda del giocatore — Pink City Billard",
  "Stats joueurs — Pink City Billard": "Statistiche giocatori — Pink City Billard",
  "Joueur — Pink City Billard": "Giocatore — Pink City Billard",
  "Tableau — Pink City Billard": "Tabellone — Pink City Billard",
  "Tournoi archivé — Pink City Billard": "Torneo archiviato — Pink City Billard",
  "Historique — Pink City Billard": "Cronologia — Pink City Billard",
  "Historique admin — Pink City Billard": "Cronologia admin — Pink City Billard",
  "Mot de passe oublié — Pink City Billard": "Password dimenticata — Pink City Billard",
  "Nouveau mot de passe — Pink City Billard": "Nuova password — Pink City Billard",
  "Table de marque — Pink City Billard": "Tavolo arbitrale — Pink City Billard",
  "Gérer le tournoi — Pink City Billard": "Gestisci il torneo — Pink City Billard",
  "Journal d'audit — Pink City Billard": "Registro di controllo — Pink City Billard",
  "Comptes joueurs — Table de marque": "Account giocatori — Tavolo arbitrale",
  "🗄 Données — Table de marque": "🗄 Dati — Tavolo arbitrale",
  "❓ Aide — Tournoi EBPC": "❓ Aiuto — Torneo EBPC",
  "🔒 Confidentialité — Tournoi EBPC": "🔒 Privacy — Torneo EBPC",
  "⚙️ Guide admin — Tournoi EBPC": "⚙️ Guida admin — Torneo EBPC",
  "dimanche": "domenica",
  "lundi": "lunedì",
  "mardi": "martedì",
  "mercredi": "mercoledì",
  "jeudi": "giovedì",
  "vendredi": "venerdì",
  "samedi": "sabato",
  "Casse la manche en cours": "Break del frame in corso",
  "Gagnés": "Vinti",
  "Joués": "Giocate",
  "Mon compte": "Il mio account",
  "Phase finale": "Fase finale",
  "⏳ match attendu": "⏳ partita in attesa",
  "▶ Lancer": "▶ Avvia",
  "🏅 Classement": "🏅 Classifica",
  "💾 Enregistrer le score": "💾 Salva il punteggio",
  "PIN invalide — reconnecte-toi dans l'admin": "PIN non valido — riaccedi all'area admin",
  "Annulé : code non saisi": "Annullato: codice non inserito",
  "Annulé : mot de confirmation non saisi": "Annullato: parola di conferma non inserita",
  "Effacer le code mémorisé (sera redemandé à la prochaine action admin)": "Cancella il codice memorizzato (verrà richiesto alla prossima azione admin)",
  "Verrouiller la table de marque ? Le code PIN sera redemandé.": "Bloccare il tavolo arbitrale? Il codice PIN verrà richiesto di nuovo.",
  "connecte-toi avec un compte admin": "accedi con un account admin",
  "pour confirmer :": "per confermare:",
  "— aucune —": "— nessuna —",
  "✏️ Score (correction)": "✏️ Punteggio (correzione)",
  "👥 Joueurs du match": "👥 Giocatori della partita",
  "🔐 Table de marque": "🔐 Tavolo arbitrale",
  "🔓 Rouvrir le match": "🔓 Riapri la partita",
  "Permission refusée": "Permesso negato",
  "Push non supporté sur ce navigateur": "Notifiche push non supportate su questo browser",
  "❓ Aide": "❓ Aiuto",
  "🎱 S'inscrire": "🎱 Iscriviti",
  "Compte (bouton « Compte » en haut à droite) → pseudo + email + mot de passe, puis « M'inscrire » sur l'accueil. Sans compte : champ pseudo sur l'accueil, mais pas de notif push ni d'historique perso. Inscrit par erreur ? Bouton « Me désinscrire » (accueil ou page compte), tant que les inscriptions sont ouvertes et avant paiement (déjà payé : voir la table de marque).": "Account (pulsante « Account » in alto a destra) → nome utente + email + password, poi « Iscrivimi » nella home. Senza account: campo nome utente nella home, ma nessuna notifica push né cronologia personale. Iscritto per sbaglio? Pulsante « Annulla la mia iscrizione » (home o pagina account), finché le iscrizioni sono aperte e prima del pagamento (già pagato: vedi il tavolo arbitrale).",
  "🔔 Notifications « à toi de jouer »": "🔔 Notifiche di « tocca a te »",
  "Ajoute d'abord le site à l'écran d'accueil : Android → ⋯ → « Installer l'application » ; iPhone → OUVRIR LE SITE DANS SAFARI (obligatoire, Chrome iOS ne le permet pas) → Partager → « Sur l'écran d'accueil ». Ouvre ensuite l'app depuis l'écran d'accueil, puis Compte → 🔔 Activer les notifications. Au lancement de ton match tu reçois une notif — un tap ouvre directement la card du match (même écran verrouillé).": "Aggiungi prima il sito alla schermata Home: Android → ⋯ → « Installa l'app »; iPhone → APRI IL SITO IN SAFARI (obbligatorio, Chrome iOS non lo permette) → Condividi → « Aggiungi alla schermata Home ». Poi apri l'app dalla schermata Home e vai su Account → 🔔 Attiva le notifiche. All'avvio della tua partita ricevi una notifica — un tocco apre direttamente la scheda della partita (anche a schermo bloccato).",
  "Tu reçois aussi une notif « 🎱 Nouveau tournoi — inscriptions ouvertes » quand la table de marque crée un tournoi (sauf si elle a désactivé le switch 🔔 du formulaire de création).": "Ricevi anche una notifica « 🎱 Nuovo torneo — iscrizioni aperte » quando il tavolo arbitrale crea un torneo (a meno che non abbia disattivato l'interruttore 🔔 del modulo di creazione).",
  "🗺️ Suivre le tournoi": "🗺️ Segui il torneo",
  "Tableau : vue bracket (onglets Tout / WB / LB / Phase finale, liens entre matchs sur l’onglet final) ou liste, liste déroulante « Aller au tour », filtre joueur avec Entrée. Dans un match pas encore joué, la place inconnue affiche « gagnant wb1-001 », « perdant lb2-003 » ou « blanc » : tu sais d’où vient le joueur que tu attends. Match en cours = entouré en rouge, terminé = bord vert, gagnant en vert. Avant le tirage au sort, le tableau affiche déjà la structure à vide : les places du tour 1 sont numérotées j1, j2, ... (jusqu’à j32 pour un tableau de 32), tu vois donc le format du tournoi dès sa création. · 📺 TV pour la salle · « Mon tournoi » = tes matchs · 📊 Stats · 🗂 Historique.": "Tabellone: vista bracket (schede Tutto / WB / LB / Fase finale, collegamenti tra le partite nella scheda finale) o elenco, menu a tendina « Vai al turno », filtro giocatore con Invio. In una partita non ancora giocata, la posizione sconosciuta mostra « vincitore wb1-001 », « perdente lb2-003 » o « bianco »: sai da dove arriva il giocatore che aspetti. Partita in corso = bordata di rosso, terminata = bordo verde, vincitore in verde. Prima del sorteggio, il tabellone mostra già la struttura vuota: le posizioni del turno 1 sono numerate j1, j2, ... (fino a j32 per un tabellone di 32), quindi vedi il formato del torneo fin dalla sua creazione. · 📺 TV per la sala · « Il mio torneo » = le tue partite · 📊 Statistiche · 🗂 Cronologia.",
  "🎲 Jouer un match": "🎲 Gioca una partita",
  "Au lancement, panneau « Tirage à la bande » : chaque joueur fait rouler une bille, le plus proche de la bande gagne → clique « ⚪ [pseudo] casse ». La ⚪ alterne ensuite à chaque manche.": "All'avvio, pannello « Lag »: ogni giocatore fa rotolare una bila, chi si avvicina più alla sponda vince → tocca « ⚪ [nome utente] rompe ». La ⚪ poi si alterna a ogni frame.",
  "Saisie : +1 manche pour le gagnant de la manche, −1 pour corriger (la ⚪ revient alors à l’état précédent). 💥 Casse ferme = réservé au joueur ⚪ (l'autre bouton est grisé). 🎯 Reprise ferme = réservé à l'autre. Dernier point → confirmation du score avec possibilité de modifier.": "Inserimento: +1 frame per il vincitore del frame, −1 per correggere (la ⚪ torna allora allo stato precedente). 💥 Break e corsa = riservato al giocatore ⚪ (l'altro pulsante è in grigio). 🎯 Re-rack = riservato all'altro. Ultimo punto → conferma del punteggio con possibilità di modificarlo.",
  "🔑 Mot de passe oublié": "🔑 Password dimenticata",
  "Compte → « Mot de passe oublié » → email → lien de réinit (valable 1 h).": "Account → « Password dimenticata » → email → link di ripristino (valido 1 h).",
  "👥 Amis": "👥 Amici",
  "Compte → section Amis : recherche un pseudo (Entrée) et ajoute un ami. Tu reçois une notif push « match d'un ami » quand son match commence, et tu vois son statut en direct (en cours vs …, programmé, inscrit) sur ton compte et sur l'accueil.": "Account → sezione Amici: cerca un nome utente (Invio) e aggiungi un amico. Ricevi una notifica push « partita di un amico » quando inizia la sua partita, e vedi il suo stato in diretta (in corso contro…, programmata, iscritto) nel tuo account e nella home.",
  "📊 Mon historique": "📊 La mia cronologia",
  "Compte → « 📊 Ma fiche joueur » : joués/gagnés, %, manches, run-outs + historique de tous tes matchs.": "Account → « 📊 La mia scheda giocatore »: giocate/vinte, %, frame, run-out + cronologia di tutte le tue partite.",
  "👤 Ton compte": "👤 Il tuo account",
  "Ton email est masqué (affiché partiellement) ; changement séparé. Un match contre blanc (bye) ne compte ni gagné ni perdu dans tes stats.": "La tua email è mascherata (mostrata in parte); modifica separata. Una partita contro bianco (bye) non conta né vinta né persa nelle tue statistiche.",
  "Guide complet : docs/GUIDE_UTILISATEUR.md dans le dépôt GitHub.": "Guida completa: docs/GUIDE_UTILISATEUR.md nel repository GitHub.",
  "🔒 Confidentialité & données": "🔒 Privacy e dati",
  "Ce qu'on collecte": "Cosa raccogliamo",
  "Tournoi : inscriptions, matchs, scores, événements, statistiques": "Torneo: iscrizioni, partite, punteggi, eventi, statistiche",
  "Compte joueur : pseudo, email, mot de passe (hashé scrypt+salt, jamais en clair)": "Account giocatore: nome utente, email, password (con hash scrypt+salt, mai in chiaro)",
  "Notifications push : uniquement si tu les actives (opt-in), abonnement révocable à tout moment": "Notifiche push: solo se le attivi (opt-in), abrevocabile in qualsiasi momento",
  "Ce qu'on ne fait PAS": "Cosa NON facciamo",
  "Aucun cookie de tracking/publicité, aucune revente de données, aucun partage à des tiers (sauf envoi d'emails via Resend pour la réinitialisation de mot de passe).": "Nessun cookie di tracciamento/pubblicità, nessuna rivendita di dati, nessuna condivisione con terzi (tranne l'invio di email via Resend per il ripristino della password).",
  "Finalités & base légale": "Finalità e base giuridica",
  "Faire fonctionner le tournoi (inscriptions, matchs, scores, classements, notifications) = exécution du service demandé. Les emails servent uniquement à la réinit du mot de passe. Les données sont conservées tant que le compte est actif ; les comptes inactifs 18 mois sont supprimés automatiquement.": "Far funzionare il torneo (iscrizioni, partite, punteggi, classifiche, notifiche) = esecuzione del servizio richiesto. Le email servono solo al ripristino della password. I dati sono conservati finché l'account è attivo; gli account inattivi da 18 mesi vengono eliminati automaticamente.",
  "Hébergement": "Hosting",
  "Application hébergée sur Fly.io (société américaine) en région Paris (cdg), base SQLite sur volume. Un transfert hors UE peut exister côté infrastructure ; les données restent sous notre responsabilité.": "Applicazione ospitata su Fly.io (società statunitense) nella regione Parigi (cdg), database SQLite su volume. Un trasferimento fuori dall'UE può esistere lato infrastruttura; i dati restano sotto la nostra responsabilità.",
  "Responsable du traitement": "Titolare del trattamento",
  "Voir avec la table de marque du tournoi.": "Contatta il tavolo arbitrale del torneo.",
  "Technique : cookie de session strictement nécessaire (HttpOnly, SameSite, Secure), préférences navigateur (localStorage : joueur suivi, vue tableau)": "Tecnico: cookie di sessione strettamente necessario (HttpOnly, SameSite, Secure), preferenze del browser (localStorage: giocatore seguito, vista tabellone)",
  "Mots de passe hashés (scrypt + sel), sessions en cookie HttpOnly/SameSite/Secure, tokens de réinit hashés et valables 1 h, rate-limit sur connexion/inscription. Contact en cas d'incident : via la table de marque.": "Password con hash (scrypt + salt), sessioni in cookie HttpOnly/SameSite/Secure, token di ripristino con hash e validi 1 h, rate-limit su accesso/iscrizione. Contatto in caso di incidente: tramite il tavolo arbitrale.",
  "✏️ Rectification : changer pseudo/email dans le compte ; corrections admin possibles": "✏️ Rettifica: cambia nome utente/email nell'account; correzioni admin possibili",
  "📥 Accès/export : bouton « Exporter mes données » dans ton compte (JSON complet)": "📥 Accesso/esportazione: pulsante « Esporta i miei dati » nel tuo account (JSON completo)",
  "🗑 Effacement : suppression du compte par l'admin (les matchs restent dans l'historique anonymisé du tournoi), purge auto 18 mois": "🗑 Cancellazione: eliminazione dell'account da parte dell'admin (le partite restano nella cronologia anonimizzata del torneo), purge automatica a 18 mesi",
  "🚫 Opposition : désactive les notifications push à tout moment": "🚫 Opposizione: disattiva le notifiche push in qualsiasi momento",
  "Donne l'email de ton compte : on t'envoie un lien de réinitialisation (valable 1h).": "Inserisci l'email del tuo account: ti invieremo un link di ripristino (valido 1 h).",
  "Envoyer le lien": "Invia il link",
  "🔐 Nouveau mot de passe": "🔐 Nuova password",
  "Changer le mot de passe": "Cambia la password",
  "Nouveau mot de passe (min 4)": "Nuova password (min 4)",
  "✅ Mot de passe changé, tu es connecté. Redirection…": "✅ Password cambiata, sei connesso. Reindirizzamento…",
  "Joueur introuvable.": "Giocatore non trovato.",
  "Bilan tous tournois confondus.": "Bilancio su tutti i tornei.",
  "Résultat": "Risultato",
  "Statistiques joueurs (tous les tournois)": "Statistiche giocatori (tutti i tornei)",
  "Aucune statistique pour le moment.": "Ancora nessuna statistica.",
  "🔴 À toi de jouer": "🔴 Tocca a te",
  "Qui es-tu ?": "Chi sei?",
  "Touche ton pseudo ci-dessous.": "Tocca il tuo nome utente qui sotto.",
  "Tes matchs": "Le tue partite",
  "Aucun match pour le moment. Le tirage arrive bientôt ! 🎱": "Ancora nessuna partita. Il sorteggio arriva presto! 🎱",
  "Aucun tournoi en cours.": "Nessun torneo in corso.",
  "🎱 Aucun tournoi en cours": "🎱 Nessun torneo in corso",
  "Aller au tour :": "Vai al turno:",
  "— Choisir un tour —": "— Scegli un turno —",
  "🔍 Filtrer par joueur (ex: seb) — Entrée pour valider": "🔍 Filtra per giocatore (es.: seb) — Invio per applicare",
  "Le tableau (structure à vide) apparaîtra ici dès la création d'un tournoi, les joueurs après le tirage au sort.": "Il tabellone (struttura vuota) apparirà qui appena viene creato un torneo, e i giocatori dopo il sorteggio.",
  "📊 Statistiques du tournoi": "📊 Statistiche del torneo",
  "🔍 Surligner un joueur (ex: seb) — Entrée pour valider": "🔍 Evidenzia un giocatore (es.: seb) — Invio per applicare",
  "Aucun tournoi terminé pour le moment.": "Ancora nessun torneo terminato.",
  "Tous les tournois terminés restent consultables ici.": "Tutti i tornei terminati restano consultabili qui.",
  "Voir le tableau": "Vedi il tabellone",
  "La TV Pink City est pensée pour le mode paysage": "La TV Pink City è pensata per la modalità orizzontale",
  "Tourne l'écran en paysage": "Gira lo schermo in orizzontale",
  "QR code du site": "Codice QR del sito",
  "Scanner pour ouvrir le site sur ton téléphone": "Scansionalo per aprire il sito sul telefono",
  "🎉 Félicitations ! 🎉": "🎉 Congratulazioni! 🎉",
  "Champion de la Pink City": "Campione della Pink City",
  "En attente des matchs…": "In attesa delle partite…",
  "Le tournoi va bientôt commencer": "Il torneo inizierà presto",
  "🎱 Aucun tournoi pour le moment": "🎱 Nessun torneo al momento",
  "🏁 TERMINÉ": "🏁 TERMINATO",
  "📱 Scanne pour ouvrir le site": "📱 Scansiona per aprire il sito",
  "📱 Scanne pour t'inscrire": "📱 Scansiona per iscriverti",
  "Inscriptions ouvertes": "Iscrizioni aperte",
  "🏁 Terminé": "🏁 Terminato",
  "👤 Mon compte": "👤 Il mio account",
  "🗺 Voir le tableau complet →": "🗺 Vedi il tabellone completo →",
  "— hors tournoi": "— fuori dal torneo",
  "Aucun ami — ajoute-en depuis le menu Compte.": "Nessun amico — aggiungine dal menu Account.",
  "Inscrit par erreur ? Tu peux te désinscrire tant que les inscriptions sont ouvertes et que tu n'as pas payé.": "Iscritto per sbaglio? Puoi annullare l'iscrizione finché le iscrizioni sono aperte e non hai pagato.",
  "Jamais inscrit à un tournoi de ce club — pas de fiche": "Mai iscritto a un torneo di questo club — nessuna scheda",
  "Revenez bientôt !": "Tornate presto!",
  "Te désinscrire du tournoi ?": "Annullare la tua iscrizione al torneo?",
  "Ton pseudo": "Il tuo nome utente",
  "gérer mon compte": "gestisci il mio account",
  "Élimination directe": "Eliminazione diretta",
  "💡 Crée un compte (pseudo + email + mot de passe) pour t'inscrire en 1 clic et retrouver tes stats :": "💡 Crea un account (nome utente + email + password) per iscriverti in 1 clic e ritrovare le tue statistiche:",
  "💰 Déjà payé : la désinscription se fait auprès de la table de marque (remboursement à voir avec le club).": "💰 Già pagato: l'annullamento dell'iscrizione si fa al tavolo arbitrale (rimborso da concordare con il club).",
  "📝 inscrit au tournoi": "📝 iscritto al torneo",
  "✨ Créer un compte": "✨ Crea un account",
  "Juste un pseudo, un email et un mot de passe. Rien d'autre.": "Solo un nome utente, un'email e una password. Nient'altro.",
  "Ma fiche joueur": "La mia scheda giocatore",
  "Email (pour réinit du mot de passe)": "Email (per il ripristino della password)",
  "Nouvel email (vide = inchangé)": "Nuova email (vuoto = invariata)",
  "Email inchangé": "Email invariata",
  "✅ Email mis à jour": "✅ Email aggiornata",
  "Mot de passe (min 4)": "Password (min 4)",
  "Se déconnecter ?": "Disconnettersi?",
  "(sans compte)": "(senza account)",
  "📋 Mon inscription": "📋 La mia iscrizione",
  "Possible tant que les inscriptions sont ouvertes et que tu n'as pas payé.": "Possibile finché le iscrizioni sono aperte e non hai pagato.",
  "Exporter mes données (RGPD)": "Esporta i miei dati (GDPR)",
  "Voir aussi : 🔒 Confidentialité (menu ☰)": "Vedi anche: 🔒 Privacy (menu ☰)",
  "Aucun ami pour le moment — recherche un pseudo ci-dessus.": "Ancora nessun amico — cerca un nome utente sopra.",
  "déjà ami": "già amico",
  "Suis des joueurs : tu reçois une notif quand leur match commence ou quand ils s'inscrivent à un tournoi, et leur statut ici. Pas besoin de compte pour eux : entre son pseudo dans la recherche puis « Suivre ».": "Segui dei giocatori: ricevi una notifica quando inizia la loro partita o quando si iscrivono a un torneo, e il loro stato qui. Non serve che abbiano un account: digita il suo nome utente nella ricerca e poi « Segui ».",
  "🔔 Notifier quand le match d'un ami commence": "🔔 Avvisami quando inizia la partita di un amico",
  "🔔 Notifier quand un ami s'inscrit à un tournoi": "🔔 Avvisami quando un amico si iscrive a un torneo",
  "Activer les notifications": "Attiva le notifiche",
  "Désactiver": "Disattiva",
  "Tester la notification": "Prova la notifica",
  "Notifications activées !": "Notifiche attivate!",
  "Notifications désactivées": "Notifiche disattivate",
  "⚠️ Aucun appareil abonné — active les notifications avant.": "⚠️ Nessun dispositivo iscritto — attiva prima le notifiche.",
  "Reçois une notification push quand un de tes matchs est lancé (même écran verrouillé).": "Ricevi una notifica push quando viene avviata una delle tue partite (anche a schermo bloccato).",
  "📱 Sur iPhone : ajoute d'abord le site à l'écran d'accueil (Safari → Partager → « Sur l'écran d'accueil »), puis active les notifications.": "📱 Su iPhone: aggiungi prima il sito alla schermata Home (Safari → Condividi → « Aggiungi alla schermata Home »), poi attiva le notifiche.",
  "Pas (encore !) d'inscription ni de match à afficher.": "Nessuna iscrizione né partita da mostrare (per ora!).",
  "🔍 Rechercher un pseudo… (Entrée)": "🔍 Cerca un nome utente… (Invio)",
  "🎱 Match en direct": "🎱 Partita in diretta",
  "← Mes matchs": "← Le mie partite",
  "+1 manche": "+1 frame",
  "−1 manche": "−1 frame",
  "🎲 Tirage à la bande": "🎲 Lag",
  "Chaque joueur fait rouler une bille sur le tapis : le plus proche de la bande remporte le tirage et casse en premier (⚪).": "Ogni giocatore fa rotolare una bila sul panno: chi si avvicina più alla sponda vince il lag e rompe per primo (⚪).",
  "En attente de la table…": "In attesa del tavolo…",
  "La table de marque va lancer le match…": "Il tavolo arbitrale avvierà la partita…",
  "La saisie des points est bloquée tant que le tirage à la bande n'est pas fait.": "L'inserimento dei punti è bloccato finché non si fa il lag.",
  "Confirmer le score": "Conferma il punteggio",
  "Vérifie le score sur la table avant de confirmer.": "Controlla il punteggio al tavolo prima di confermare.",
  "Modifier (annuler ce point)": "Modifica (annulla questo punto)",
  "⚠️ Dernier point ?": "⚠️ Ultimo punto?",
  "Le joueur qui a la casse ne fait pas de reprise ferme": "Il giocatore che rompe non può fare re-rack",
  "Seul le joueur qui a la casse peut faire une casse ferme": "Solo il giocatore che rompe può fare break e corsa",
  "Match introuvable.": "Partita non trovata.",
  "Consultation seule — tu ne joues pas ce match.": "Solo consultazione — non stai giocando questa partita.",
  "🎱 Table de marque": "🎱 Tavolo arbitrale",
  "Espace table de marque": "Zona tavolo arbitrale",
  "📌 Accès rapide": "📌 Accesso rapido",
  "Comptes joueurs": "Account giocatori",
  "Configurer / gérer le tournoi": "Configura / gestisci il torneo",
  "Données": "Dati",
  "Journal d'audit": "Registro di controllo",
  "Aucun tournoi actif pour le moment.": "Nessun torneo attivo al momento.",
  "Nouveau tournoi": "Nuovo torneo",
  "Créer le tournoi": "Crea il torneo",
  "Règle": "Regola",
  "Taille max": "Dimensione max",
  "Nombre de tables": "Numero di tavoli",
  "📅 Date et heure": "📅 Data e ora",
  "Têtes de série": "Teste di serie",
  "Préfixe": "Prefisso",
  "N° série": "N.º di serie",
  "Double KO + tableau final": "Doppio KO + tabellone finale",
  "Double KO sur": "Doppio KO su",
  "Finale seule": "Solo finale",
  "Distance spéciale": "Distanza speciale",
  "Distance spéciale à partir de": "Distanza speciale a partire da",
  "Réservées à partir du tour n° (vide = quarts)": "Riservati a partire dal turno n.º (vuoto = quarti)",
  "Tables réservées en phase finale (jamais utilisées en auto à partir des quarts)": "Tavoli riservati alla fase finale (mai usati in automatico dai quarti)",
  "Ordre des tables (mode auto)": "Ordine dei tavoli (modalità auto)",
  "Ajuster auto la taille au nombre de payés": "Adatta automaticamente la dimensione al numero di pagati",
  "Nouveau joueur": "Nuovo giocatore",
  "Lancer le tirage ? Inscriptions closes.": "Avviare il sorteggio? Le iscrizioni verranno chiuse.",
  "▶ Simuler tout le tournoi": "▶ Simula tutto il torneo",
  "⚠️ Clôturer le tournoi": "⚠️ Chiudi il torneo",
  "Terminer le tournoi maintenant": "Termina il torneo adesso",
  "Terminer le tournoi maintenant ?": "Terminare il torneo adesso?",
  "Termine le tournoi immédiatement (même si la finale n'a pas été jouée). Les tableaux restent en ligne.": "Termina il torneo immediatamente (anche se la finale non è stata giocata). I tabelloni restano online.",
  "Supprimer le tournoi": "Elimina il torneo",
  "Supprimer le tournoi et TOUT son contenu ?": "Eliminare il torneo e TUTTO il suo contenuto?",
  "Enregistré ✅": "Salvato ✅",
  "✅ Tournoi importé": "✅ Torneo importato",
  "📥 Exporter le tournoi actif": "📥 Esporta il torneo attivo",
  "📤 Importer un JSON": "📤 Importa un JSON",
  "Exporte le tournoi actif en JSON (backup, rejouer ailleurs), ou importe un export (remplace le tournoi actif — code PIN re-demandé).": "Esporta il torneo attivo in JSON (backup, rigiocarlo altrove), o importa un export (sostituisce il torneo attivo — codice PIN richiesto di nuovo).",
  "🗺 Voir / éditer les matchs": "🗺 Vedi / modifica le partite",
  "Ouvrir le tableau": "Apri il tabellone",
  "Ouvrir l'historique": "Apri la cronologia",
  "🎱 Tables disponibles": "🎱 Tavoli disponibili",
  "🎱 Table auto (libre)": "🎱 Tavolo automatico (libero)",
  "🤖 Mode auto :": "🤖 Modalità auto:",
  "Mode auto :": "Modalità auto:",
  "🤖 Gestion automatique": "🤖 Gestione automatica",
  "Lance automatiquement le prochain match dès qu'un match se termine (priorité : Tour 1, puis LB1#1, WB2#1, LB2#1…).": "Avvia automaticamente la prossima partita appena una termina (priorità: Turno 1, poi LB1#1, WB2#1, LB2#1…).",
  "🔔 Notif push « inscriptions ouvertes »": "🔔 Notifica push di « iscrizioni aperte »",
  "🔔 Rappel inscriptions ouvertes (push aux joueurs abonnés)": "🔔 Promemoria iscrizioni aperte (push ai giocatori iscritti)",
  "Clique sur un match du tableau pour lancer, corriger le score, déclarer un forfait ou rouvrir — sans quitter le tableau.": "Tocca una partita del tabellone per avviarla, correggere il punteggio, dichiarare un forfait o riaprirla — senza uscire dal tabellone.",
  "📏 Distances (modifiables à tout moment)": "📏 Distanze (modificabili in qualsiasi momento)",
  "Inscrit des joueurs fictifs en masse, directement payés.": "Iscrive giocatori fittizi in massa, direttamente pagati.",
  "— aucun (coupe net) —": "— nessuno (taglio netto) —",
  "ex: 1,2 (vide = aucune)": "es.: 1,2 (vuoto = nessuno)",
  "marquer payé": "segna come pagato",
  "🗄 Gestion des données": "🗄 Gestione dei dati",
  "👥 Joueurs": "👥 Giocatori",
  "🎱 Matchs": "🎱 Partite",
  "📜 Events d'un match": "📜 Eventi di una partita",
  "Choisis un match.": "Scegli una partita.",
  "Aucun tournoi actif.": "Nessun torneo attivo.",
  "Aucun événement.": "Nessun evento.",
  "🔍 Filtrer (pseudo/joueur) — Entrée": "🔍 Filtra (nome utente/giocatore) — Invio",
  "➕ manche": "➕ frame",
  "🎲 tirage à la bande": "🎲 lag",
  "🚀 lancement": "🚀 avvio partita",
  "▶ tournoi actif": "▶ torneo attivo",
  "État": "Stato",
  "(recalcul du score)": "(ricalcolo del punteggio)",
  "Supprimer cet événement ? Le score sera recalculé.": "Eliminare questo evento? Il punteggio verrà ricalcolato.",
  "👤 Comptes joueurs": "👤 Account giocatori",
  "Aucun compte.": "Nessun account.",
  "Aucun ami": "Nessun amico",
  "Aucune notification activée": "Nessuna notifica attivata",
  "Créé le": "Creato il",
  "Dernière connexion": "Ultimo accesso",
  "Nb inscri. tournois": "Iscrizioni ai tornei",
  "✏️ pseudo": "✏️ nome utente",
  "Renommer le pseudo du compte": "Rinomina il nome utente dell'account",
  "Changer le mot de passe du compte": "Cambia la password dell'account",
  "🔍 Rechercher (pseudo ou email)…": "🔍 Cerca (nome utente o email)…",
  "✅ Pseudo changé": "✅ Nome utente cambiato",
  "✅ Mot de passe changé (sessions invalidées)": "✅ Password cambiata (sessioni invalidate)",
  "Rétrograder en simple utilisateur (le PIN restera nécessaire pour l’admin)": "Retrocedi a utente normale (il PIN resterà necessario per l'admin)",
  "Promouvoir administrateur (sa session suffira pour l’admin, sans PIN)": "Promuovi ad amministratore (la sua sessione basterà per l'admin, senza PIN)",
  "Rétrograder": "Retrocedi",
  "Rechercher (action, cible, détails)…": "Cerca (azione, obiettivo, dettagli)…",
  "Action exacte (ex: tirage)": "Azione esatta (es.: sorteggio)",
  "Vider le journal": "Svuota il registro",
  "Vider tout le journal d'audit ? (irréversible)": "Svuotare tutto il registro di controllo? (irreversibile)",
  "✖ Tout afficher": "✖ Mostra tutto",
  "⏪ Restaurer à ce point": "⏪ Ripristina a questo punto",
  "✅ Tournoi restauré": "✅ Torneo ripristinato",
  "Le contenu actuel du tournoi sera remplacé.": "Il contenuto attuale del torneo verrà sostituito.",
  "Exemples de matchs modifiés:": "Esempi di partite modificate:",
  "⚙️ Guide admin": "⚙️ Guida admin",
  "1. Créer le tournoi": "1. Crea il torneo",
  "2. Inscriptions": "2. Iscrizioni",
  "3. Tirage": "3. Sorteggio",
  "4. Lancer les matchs": "4. Avvia le partite",
  "5. Interventions en cours (clic card avec PIN → modale ⚙️)": "5. Interventi in corsa (clic sulla scheda con PIN → modale ⚙️)",
  "6. Données (/admin-data.html)": "6. Dati (/admin-data.html)",
  "7. Classement par points": "7. Classifica per punti",
  "8. Clôturer": "8. Chiusura",
  "9. Annuler une action : rollback point-in-time (journal d'audit)": "9. Annullare un'azione: rollback point-in-time (registro di controllo)",
  "10. Comptes & audit": "10. Account e controllo",
  "11. Tests & déploiement": "11. Test e rilascio",
  "Accès : code PIN (env `ADMIN_PIN`) ou session d'un compte avec le rôle `admin` (bootstrap via `ADMIN_EMAIL`/`ADMIN_PASSWORD`, promotion depuis /admin-comptes.html).": "Accesso: codice PIN (env `ADMIN_PIN`) o la sessione di un account con il ruolo `admin` (bootstrap via `ADMIN_EMAIL`/`ADMIN_PASSWORD`, promozione da /admin-comptes.html).",
  "/admin-tournoi.html → nom, règle, taille (16/32/64/128), format (élim. directe / double KO + nb tours), nb tables, date. Ajustement auto à la taille des payés. Tables réservées: vide par défaut. En phase inscription, la TV montre un grand QR centré pour s'inscrire. Switch 🔔 « Notif push « inscriptions ouvertes » (coché par défaut) : à la création, un push « 🎱 Nouveau tournoi — inscriptions ouvertes » est envoyé à tous les comptes abonnés.": "/admin-tournoi.html → nome, regola, dimensione (16/32/64/128), formato (eliminazione diretta / doppio KO + n.º turni), n.º tavoli, data. Adattamento automatico alla dimensione dei pagati. Tavoli riservati: vuoto per impostazione predefinita. In fase di iscrizione, la TV mostra un grande QR centrato per iscriversi. Interruttore 🔔 « Notifica push di « iscrizioni aperte » (spuntato per impostazione predefinita): alla creazione, un push « 🎱 Nuovo torneo — iscrizioni aperte » viene inviato a tutti gli account iscritti.",
  "Ajouter / simuler / payer / supprimer. Seuls les payés sont tirés. ⛔ Pseudo d'un compte = réservé: inscription anonyme refusée (409, anti-usurpation); ajout admin possible après confirmation (joueur rattaché au compte). Un invité qui crée un compte avec le même pseudo est rattaché auto (reçoit les pushs). ♻️ Un compte connecté peut se désinscrire lui-même (bouton « Me désinscrire »), en phase d'inscription uniquement et avant paiement ; un joueur déjà payé ou sans compte passe par un admin. Pseudo/mdp oublié → /admin-comptes.html (✏️ pseudo, 🔑 mdp).": "Aggiungere / simulare / pagare / eliminare. Vengono sorteggiati solo i pagati. ⛔ Il nome utente di un account = riservato: iscrizione anonima rifiutata (409, anti-usurpazione); aggiunta admin possibile dopo conferma (giocatore collegato all'account). Un ospite che crea un account con lo stesso nome utente viene collegato automaticamente (riceve i push). ♻️ Un account connesso può annullare la propria iscrizione (pulsante « Annulla la mia iscrizione »), solo in fase di iscrizione e prima del pagamento; un giocatore già pagato o senza account passa da un admin. Nome utente/password dimenticati → /admin-comptes.html (✏️ nome utente, 🔑 password).",
  "Bouton Tirage: appariements aléatoires crypto, byes répartis. ⚠️ Fige le bracket (retour en arrière possible uniquement par rollback point-in-time via le journal d'audit, voir §9).": "Pulsante sorteggio: abbinamenti casuali crittografici, bye distribuiti. ⚠️ Congela il bracket (si può tornare indietro solo tramite rollback point-in-time nel registro di controllo, vedi §9).",
  "Mode auto ON = départ auto sur table libre (ordre personnalisable). Manuel: clic sur une card (PIN) → modale. Tirage à la bande ⚪ sur la card, puis alternance à chaque manche. Joueurs: seul le ⚪ fait « casse ferme », l'autre « reprise ferme » (grisé + 403). Dernier point = confirmation obligatoire.": "Modalità auto ON = partenza automatica su tavolo libero (ordine personalizzabile). Manuale: clic su una scheda (PIN) → modale. Lag ⚪ sulla scheda, poi alternanza a ogni frame. Giocatori: solo il ⚪ fa « break e corsa », l'altro « re-rack » (in grigio + 403). Ultimo punto = conferma obbligatoria.",
  "✏️ Corriger le score (si distance atteinte → termine + propage)": "✏️ Correggi il punteggio (se la distanza è raggiunta → termina + propaga)",
  "🎱 Déplacer de table (409 si occupée, « aucune » pour libérer)": "🎱 Sposta di tavolo (409 se occupato, « nessuno » per liberarlo)",
  "👥 Changer les joueurs (WB/LB, blanc possible, bye auto) — 409 auto si la paire est déjà appariée ailleurs (hors finale): rematch impossible": "👥 Cambia i giocatori (WB/LB, bianco possibile, bye automatico) — 409 automatico se la coppia è già abbinata altrove (tranne la finale): rivincita impossibile",
  "🔓 Rouvrir un match — ⚠️ 409 INTERDIT si un match aval a déjà commencé": "🔓 Riapri una partita — ⚠️ 409 VIETATO se una partita successiva è già iniziata",
  "🚫 Forfait (définitif)": "🚫 Forfait (definitivo)",
  "Onglets Matchs / Joueurs / Events sur le tournoi actif OU un tournoi terminé (sélecteur), filtre par pseudo (Entrée). Events: 🗑 supprime un event et recalcule le score → les stats se corrigent. Joueurs: éditer pseudo/statut, supprimer.": "Schede Partite / Giocatori / Eventi sul torneo attivo O su un torneo terminato (selettore), filtro per nome utente (Invio). Eventi: 🗑 elimina un evento e ricalcola il punteggio → le statistiche si correggono. Giocatori: modificare nome utente/stato, eliminare.",
  "Points = profondeur atteinte (WB: tour, F: k+tour en DKO), ex-aequo (1,1,1,4…). Les matchs clôturés sans gagnant ne comptent pas comme perdus.": "Punti = profondità raggiunta (WB: turno, F: k+turno in DKO), pari merito (1,1,1,4…). Le partite chiuse senza vincitore non contano come perse.",
  "Règles DKO: WB/LB séparés jusqu'en finale; en F, alternance des moitiés + swap anti-rematch auto sur tous les tours WB/LB/F (rematch autorisé uniquement en vraie finale).": "Regole DKO: WB/LB separati fino alla finale; in F, alternanza delle metà + scambio anti-rivincita automatico su tutti i turni WB/LB/F (rivincita permessa solo nella vera finale).",
  "« Terminer maintenant » = coupe net, aucun champion auto (sauf choix explicite dans le select). Fin normale = champion auto via la finale. Historique ensuite en liste + recherche/surbrillance joueur.": "« Termina adesso » = taglio netto, nessun campione automatico (salvo scelta esplicita nel selettore). Fine normale = campione automatico via la finale. Cronologia poi in elenco + ricerca/evidenziazione giocatore.",
  "/admin-journal.html : chaque action admin est loguée ET snapshotée. Bouton ⏮ « Restaurer à ce point » sur une entrée = restaure le tournoi actif à l'état exact de cet événement (transaction atomique ; fonctionne même avec des matchs en cours → remis à 0-0, tables libérées). Un diff (matchs modifiés/ajoutés/supprimés, joueurs, statut, champion) s'affiche dans la confirmation avant validation. 409 si le snapshot concerne un autre tournoi, 404 sans snapshot. Le rollback est lui-même logué. Filtres du journal : recherche texte + type d'action.": "/admin-journal.html: ogni azione admin viene registrata E catturata in snapshot. Pulsante ⏮ « Ripristina a questo punto » su una voce = ripristina il torneo attivo allo stato esatto di quell'evento (transazione atomica; funziona anche con partite in corso → riportate a 0-0, tavoli liberati). Un diff (partite modificate/aggiunte/eliminate, giocatori, stato, campione) appare nella conferma prima della validazione. 409 se lo snapshot riguarda un altro torneo, 404 senza snapshot. Il rollback stesso viene registrato. Filtri del registro: ricerca testo + tipo di azione.",
  "/admin-comptes.html: liste (dernière connexion, inscri., matchs, sessions, amis : amis avec compte + pseudos suivis sans compte), ✏️ pseudo, 🔑 mdp, 🗑 supprimer (historique matchs conservé). Purge auto des comptes inactifs > 18 mois. /admin-journal.html: 500 dernières actions admin, lancements lisibles (« wb1-001 — P11 vs P07 (table 3) »). Le rollback point-in-time (bouton ⏮ « Restaurer à ce point ») est détaillé §9. 🔐 Toute action destructive (suppression tournoi/compte/event, vidage du journal, rollback) exige le code PIN re-saisi (modale masquée, `confirm_pin`) — sauf la désinscription d'un joueur. Une session de compte avec le rôle `admin` ne redemande pas le PIN, mais exige de saisir le mot `SUPPRIMER` dans la modale de confirmation.": "/admin-comptes.html: elenco (ultimo accesso, iscrizioni, partite, sessioni, amici: amici con account + nomi utente seguiti senza account), ✏️ nome utente, 🔑 password, 🗑 elimina (cronologia partite conservata). Purge automatica degli account inattivi > 18 mesi. /admin-journal.html: ultime 500 azioni admin, avvii leggibili (« wb1-001 — P11 vs P07 (tavolo 3) »). Il rollback point-in-time (pulsante ⏮ « Ripristina a questo punto ») è dettagliato al §9. 🔐 Ogni azione distruttiva (eliminazione torneo/account/evento, svuotamento del registro, rollback) richiede il codice PIN reinserito (modale mascherata, `confirm_pin`) — tranne l'annullamento dell'iscrizione di un giocatore. Una sessione di account con il ruolo `admin` non richiede di nuovo il PIN, ma richiede di digitare la parola `SUPPRIMER` nella modale di conferma.",
  "Batterie: BASE=http://127.0.0.1:PORT node test/batterie.js (203 checks → test/rapport.md) + test/e2e.js + test/fullrun.js ; sans serveur : node test/push-unit.js (push mocké), node test/purge-unit.js (purge > 90 j). Fly: secrets ADMIN_PIN, RESEND_API_KEY, MAIL_FROM, VAPID_* (jamais BASE_URL); volume tournoi_data sur /data; snapshots dans Volumes.": "Batteria: BASE=http://127.0.0.1:PORT node test/batterie.js (203 checks → test/rapport.md) + test/e2e.js + test/fullrun.js ; senza server: node test/push-unit.js (push simulato), node test/purge-unit.js (purge > 90 g). Fly: secrets ADMIN_PIN, RESEND_API_KEY, MAIL_FROM, VAPID_* (mai BASE_URL); volume tournoi_data su /data; snapshot in Volumes.",
  "Version complète: docs/GUIDE_ADMIN.md dans le dépôt GitHub.": "Versione completa: docs/GUIDE_ADMIN.md nel repository GitHub.",
  "Aucun tournoi terminé.": "Nessun torneo terminato.",
  "Consultation et suppression (admin).": "Consultazione ed eliminazione (admin).",
  "Simuler tout le tournoi (scores aléatoires) jusqu'au champion ?": "Simulare tutto il torneo (punteggi casuali) fino al campione?",
  "payé annuler": "pagato annulla",
  "déjà suivi": "già seguito",
  "👤 Connecté en tant que": "👤 Connesso come",
  "Retour à": "Torna a",
  "Restaurer le tournoi actif à l'état de cet événement ?": "Ripristinare il torneo attivo allo stato di questo evento?",
  "Ou": "Oppure",
  "⚙️ Paramètres": "⚙️ Impostazioni",
  "Mode clair": "Modalità chiara",
  "🔑 Connexion": "🔑 Accedi",
  "Connexion": "Accedi",
  "Mes matchs": "Le mie partite",
  "Fil du tournoi": "Cronaca del torneo",
  "Replier": "Mostra meno",
  "en direct": "in diretta",
  "☰ Menu": "☰ Menu",
  "Menu": "Menu",
  "🏆 Titres": "🏆 Titoli",
  "Perdus": "Persi",
  "% victoires": "% vittorie",
  "⭐ Pts": "⭐ Punti",
  "💥 Run-outs": "💥 Run-outs",
  "Guide admin": "Guida admin",
  "Historique public": "Cronologia pubblica",
  "🔗 Liens publics": "🔗 Link pubblici",
  "💾 Sauvegarde (export / import JSON)": "💾 Backup (esportazione / importazione JSON)",
  "📍 Lieu": "📍 Luogo",
  "géré dans sa page dédiée": "gestito nella sua pagina dedicata",
  "Format": "Formato",
  "Inscrire": "Iscrivere",
  "Corriger": "Correggere",
  "Nombre": "Numero",
  "Jamais (3 partout)": "Mai (3 ovunque)",
  "Distance (3/5/7) :": "Distanza (3/5/7):",
  "Motif :": "Motivo:",
  "correction table de marque": "correzione del tavolo arbitrale",
  "Champion (optionnel)": "Campione (opzionale)",
  "Enregistrer date/lieu": "Salva data/luogo",
  "Enregistrer l'ordre": "Salva l'ordine",
  "Tableau final": "Tabellone finale",
  "Tour": "Turno",
  "🎬 Simulation": "🎬 Simulazione",
  "🎲 Mode simulation": "🎲 Modalità simulazione",
  "🏆 Champion :": "🏆 Campione:",
  "ACTIF": "ATTIVO",
  "ACTIF ✅": "ATTIVO ✅",
  "inactif": "inattivo",
  "· après la belle": "· dopo la bella",
  "· revanche prise !": "· rivincita riuscita!",
  "· revanche manquée": "· rivincita sfumata",
  "Le club": "Il club",
  "Club introuvable": "Club non trovato",
  "Club inconnu ici, tu regardes le club par défaut": "Club sconosciuto qui, stai vedendo il club predefinito",
  "Choisis ton club": "Scegli il tuo club",
  "Bienvenue sur la plateforme": "Benvenuto sulla piattaforma",
  "Plateforme": "Piattaforma",
  "Hub de la plateforme": "Hub della piattaforma",
  "Choisis ton club, ouvre un tournoi en cours, retrouve un joueur.": "Scegli il tuo club, apri un torneo in corso, trova un giocatore.",
  "Reprendre": "Riprendi",
  "Les tournois en cours et à venir": "Tornei in corso e in arrivo",
  "Aucun tournoi en cours ou à venir.": "Nessun torneo in corso né in arrivo.",
  "Joueur de la plateforme": "Giocatore della piattaforma",
  "Un pseudo": "Uno pseudonimo",
  "Rechercher un joueur": "Cerca un giocatore",
  "Rechercher un joueur dans tous les clubs de la plateforme.": "Cerca un giocatore in tutti i club della piattaforma.",
  "Résultats": "Risultati",
  "Aucun joueur trouvé.": "Nessun giocatore trovato.",
  "Un seul compte pour toute la plateforme : le même login dans tous les clubs.": "Un solo account per tutta la piattaforma: lo stesso login in tutti i circoli.",
  "Bannière du club": "Banner del club",
  "Bannière de l accueil": "Banner della home",
  "Retirer la bannière": "Rimuovi il banner",
  "Importer une bannière (PNG/JPG/SVG, photo jusqu à 8 Mo, réduite à 1600 px)": "Importa un banner (PNG/JPG/SVG, foto fino a 8 MB, ridotta a 1600 px)",
  "Photo affichée en tête de l accueil et de la page Le club pour tous les visiteurs.": "Foto mostrata in cima alla home e alla pagina Il club per tutti i visitatori.",
  "Photo de fond de la TV": "Foto di sfondo della TV",
  "Retirer le fond de TV": "Rimuovi lo sfondo TV",
  "Importer un fond de TV (PNG/JPG/SVG, photo jusqu à 8 Mo, réduite à 1280 px)": "Importa uno sfondo TV (PNG/JPG/SVG, foto fino a 8 MB, ridotta a 1280 px)",
  "Photo de fond affichée derrière les scores de l écran TV (assombrie automatiquement).": "Foto di sfondo dietro i punteggi dello schermo TV del club (scurita automaticamente).",
  "Page Le club": "Pagina Il club",
  "Logo, bannière et textes de la page publique « Le club » (lien du menu).": "Logo, banner e testi della pagina pubblica « Il club » (voce del menu).",
  "Présentation du club (500 caractères max)": "Presentazione del club (500 caratteri al massimo)",
  "Contact (page Le club, 200 caractères max)": "Contatto (pagina Il club, 200 caratteri al massimo)",
  "Image refusée": "Immagine rifiutata",
  "Cause : l image réduite dépasse encore la taille maximum, choisis une image plus simple.": "Causa: l immagine ridotta supera ancora le dimensioni massime, scegli un immagine più semplice.",
  "Icône du téléphone": "Icona del telefono",
  "Le logo devient l app des téléphones (icône 192 px, effective aux prochaines installations).": "Il logo diventa l app del telefono (icona 192 px, applicata alle prossime installazioni).",
};
// remplacements dynamiques IT : meme ordre que les regex de I18N_DYN
const REPS_DYN_IT = [
  "Errore $1",
  "Scheda del giocatore di $1",
  "Annullare l'iscrizione al torneo « $1 »?",
  "Eliminare il giocatore « $1 »?",
  "Eliminare « $1 » dalla cronologia?",
  "Eliminare definitivamente « $1 » dalla cronologia?",
  "Gestisci il torneo « $1 »",
  "🕐 programmata contro $1",
  "🕐 partita programmata contro $1",
  "🟢 in corso contro $1",
  "✅ Iscritto (pagato)",
  "✅ Iscritto (in attesa del pagamento)",
  "Iscriviti a « $1 » come $2",
  "Tabellone di $1",
  "Avvia il sorteggio ($1 pagati)",
  "⏳ Pronti a partire ($1)",
  "Forfait di $1?",
  "Punteggio di $1 (0-$2):",
  "Nuovo nome utente per « $1 » (min $2 caratteri):",
  "Nuova password per « $1 » (min $2 caratteri):",
  "Eliminare l'account « $1 »?\nI giocatori collegati vengono scollegati (la cronologia delle partite resta), le sessioni e le iscrizioni push vengono eliminate.",
  "Frame vinti: $1",
  "⚔️ Testa a testa ($1 avversario)",
  "⚔️ Testa a testa ($1 avversari)",
  "🎱 $1 giocate",
  "🏆 $1 vinte",
  "Inizio: $1",
  "· Durata: $1",
  "🏁 $1 vince la partita",
  "🏆 $1 vince la partita",
  "Il punteggio diventerebbe $1 - $2.",
  "📍 Vai al tavolo n.º $1",
  "Cronologia dei tornei ($1)",
  "Cronologia ($1 tornei terminati)",
  "$1 giocatori registrati",
  "$1 iscrizione(i)",
  "$1 voci eliminate",
  "Torna a $1",
  "Riaprire la partita n.º $1? Il risultato viene annullato e le partite successive verranno svuotate.",
  "$1/$2 iscritti · $3 pagati",
  "$1 max · $2 iscritti · $3 pagati · $4 tavoli",
  "$1/$2 partite giocate",
  "$1 tavoli creati · $2 liberi",
  "$1 giocatori",
  "$1 iscritti",
  "$1 pagati",
  "$1 liberi",
  "DKO di $1 turni",
  "DKO di $1 turni + tabellone finale",
  "eliminazione diretta",
  "Partite modificate: $1 · aggiunte: $2 · eliminate: $3",
  "Evento n.º $1 ($2) il $3",
  "Ripristinare il torneo attivo allo stato di questo evento?\n\n",
  "Tavolo $1 (occupato)",
  "⏳ Sorteggio non ancora effettuato: struttura del tabellone vuota, le posizioni da j1 a j$1 verranno occupate dai giocatori dopo il sorteggio",
  "Simulazione completata: $1 partite giocate. $2",
  "$1 $2/$3/$4 alle $5:$6",
  "$1/$2/$3 alle $4:$5",
  "Esiste già un account con il nome utente « $1 ».\n\nIscrivere comunque questo giocatore? Verrà collegato a questo account (notifiche di « tocca a te » e amici incluse).\n\nAltrimenti, il titolare può iscriversi da solo dal proprio account.",
  "Rimuovere $1 dai tuoi amici?",
  "📨 Notifica di prova inviata ($1 dispositivo(i))!",
  "🎱 Partite ($1)",
  "⏱ inizio $1",
  "⏱ durata media $1",
  "$1 alle $2:$3",
  "$1 $2 alle $3:$4",
  "$1 batte $2 $3-$4",
  "· tavolo $1",
  "· torneo finito per $1",
  "$1 dà forfait, $2 passa al turno successivo",
  "🏆 $1 vince il torneo!",
  "Che suspense: $1 e $2 sono a un frame dalla vittoria al tavolo $3",
  "Che suspense: $1 e $2 sono a un frame dalla vittoria",
  "proprio ora",
  "$1 min fa",
  "$1 h fa",
  "$1 g fa",
  "$1 ha la meglio su $2 $3-$4",
  "$1 supera $2 $3-$4",
  "$1 domina $2 $3-$4",
  "$1 estromette $2 $3-$4",

  "$1 surclassa $2 $3-$4",
  "$1 detta legge contro $2 $3-$4",
  "$1 si ritira, $2 passa al turno successivo",
  "forfait di $1, $2 passa al turno successivo",
  "$1 getta la spugna, $2 passa al turno successivo",
  "forfait di $1, $2 avanza senza giocare",

  "$1 non si presenta, $2 passa al turno successivo",
  "forfait di $1: $2 fila dritto al turno successivo",
  "🏆 $1 alza il trofeo!",
  "🏆 $1 si aggiudica il titolo!",
  "🏆 Fine del suspense: $1 è il campione!",
  "🏆 $1 ha avuto l'ultima parola: il titolo è suo!",

  "🏆 $1 entra nell'albo d'oro del club!",
  "🏆 $1 domina il torneo!",
  "Il frame decisivo! $1 e $2 al tavolo $3",
  "Tutto si decide tra $1 e $2 (tavolo $3)!",
  "Frame decisivo tra $1 e $2 (tavolo $3)!",
  "Tutti in piedi: $1 e $2 si giocano la bella al tavolo $3!",

  "Il torneo si decide adesso: $1 e $2 alla bella al tavolo $3!",
  "Ultima manche per $1 e $2 al tavolo $3!",
  "La bella tra $1 e $2!",

  "Tutto si decide tra $1 e $2!",
  "Frame decisivo tra $1 e $2!",
  "🔥 Rivincita: $1 gioca contro $2, una rivincita da prendere!",
  "🔥 $1 gioca la sua rivincita contro $2!",
  "🔥 $1 ci riprova contro $2!",
  "🔥 $1 vuole ribaltare la partita contro $2!",
  "🔥 A $1 trovare la falla contro $2!",

  "🔥 $1 ha un conto in sospeso con $2!",
  "🔥 Questa partita sa di rivincita: $1 sfida $2!",
  "🔥 Rivincita: $1 e $2 si ritrovano in perfetta parità!",
  "🔥 Orgoglio in palio: $1 e $2 si ritrovano!",
  "🔥 $1 e $2 si ritrovano, bilancio perfettamente in equilibrio!",
  "🔥 Pareggio perfetto prima di questo round: $1 vs $2!",

  "🔥 Vecchi rivali a pari merito: $1 e $2 si ritrovano!",
  "🔥 Niente da dividere: $1 e $2 scrivono un nuovo capitolo!",
  "$1 conduce $2-$3",
  "· durata $1 min",
  "· durata $1 h $2",
  "Inviato: « $1 », $2 KB, tipo MIME « $3 ».",
];

// --- i18n DE : dictionnaire allemand (cles = textes fr, meme jeu que I18N) + remplacements dynamiques ---
const I18N_DE = {
  "🎨 Apparence du club": "🎨 Darstellung des Clubs",
  "Couleur d accent": "Akzentfarbe",
  "Nom par défaut des tournois": "Standardname für Turniere",
  "Jour récurrent": "Wiederkehrender Tag",
  "Heure habituelle": "Übliche Zeit",
  "Personnalisation enregistrée": "Personalisierung gespeichert",
  "Visible par tous les visiteurs du club.": "Für alle Besucher des Clubs sichtbar.",
  "Logo du club": "Clublogo",
  "Aucun logo": "Kein Logo",
  "Logo prédéfini ou importé, affiché en filigrane discret et à côté du nom du club pour tous les visiteurs.": "Voreingestelltes oder importiertes Logo, dezent als Wasserzeichen und neben dem Vereinsnamen für alle Besucher.",
  "Importer une image (PNG/JPG/SVG, photo jusqu à 8 Mo, réduite à 256 px)": "Bild importieren (PNG/JPG/SVG, auf 256 px verkleinert, Foto bis 8 MB)",
  "Logo trop volumineux ou format non supporté": "Logo zu groß oder Format nicht unterstützt",
  "Logo refusé": "Logo abgelehnt",
  "Aperçu du logo retenu : « Enregistrer » l applique aux pages du club pour tous les visiteurs.": "Vorschau des ausgewählten Logos: « Speichern » wendet es auf die Clubseiten für alle Besucher an.",
  "Logo importé": "Importiertes Logo",
  "Adresse par défaut du club": "Standardadresse des Clubs",
  "Attendu : image PNG, JPG ou SVG décodable (photo iPhone acceptée), 8 Mo maximum.": "Erwartet: dekodierbares PNG-, JPG- oder SVG-Bild (iPhone-Foto akzeptiert), maximal 8 MB.",
  "Cause : fichier plus lourd que la limite de 8 Mo.": "Ursache: Datei schwerer als das 8-MB-Limit.",
  "Cause probable : le navigateur n a pas réussi à décoder ce fichier (fichier endommagé ou format d image exotique).": "Wahrscheinliche Ursache: Der Browser konnte diese Datei nicht dekodieren (beschädigte Datei oder exotisches Bildformat).",
  "Cause probable : le fichier SVG est vide ou ne contient pas de balise <svg>.": "Wahrscheinliche Ursache: Die SVG-Datei ist leer oder enthält kein <svg>-Tag.",
  "Affichage du logo": "Logo-Anzeige",
  "Logo d en-tête": "Kopfzeilen-Logo",
  "Filigrane": "Wasserzeichen",
  "Logo + filigrane": "Logo + Wasserzeichen",
  "Dimanche": "Sonntag",
  "Lundi": "Montag",
  "Mardi": "Dienstag",
  "Mercredi": "Mittwoch",
  "Jeudi": "Donnerstag",
  "Vendredi": "Freitag",
  "Samedi": "Samstag",
  "Clubs": "Clubs",
  "Créer un club": "Club erstellen",
  "Nom du club": "Clubname",
  "Code PIN du club": "Club-PIN-Code",
  "Code PIN propre": "Eigener PIN-Code",
  "Comptes rattachés": "Verknüpfte Konten",
  "Actif": "Aktiv",
  "Inactif": "Inaktiv",
  "Activer": "Aktivieren",
  "Rôles du club": "Club-Rollen",
  "Administrateur": "Administrator",
  "Opérateur": "Operator",
  "Retirer": "Entfernen",
  "Aide": "Hilfe",
  "Amis": "Freunde",
  "Annuler": "Abbrechen",
  "Aucun ami pour le moment": "Noch keine Freunde",
  "Aucun historique": "Kein Verlauf",
  "Aucun match pour le moment": "Noch keine Spiele",
  "Aucun tournoi pour le moment": "Derzeit kein Turnier",
  "Aucun tournoi": "Kein Turnier",
  "Aucune donnée": "Keine Daten",
  "Bille perdue": "Verlorene Kugel",
  "Bille perdue ?": "Verlorene Kugel?",
  "Classement": "Rangliste",
  "Club": "Club",
  "Compte": "Konto",
  "Confidentialité": "Datenschutz",
  "Confirmation": "Bestätigung",
  "Connecté": "Angemeldet",
  "Connecte-toi pour t'inscrire": "Melde dich an, um dich einzuschreiben",
  "Créer mon compte": "Mein Konto erstellen",
  "Créer un compte": "Konto erstellen",
  "Déconnexion": "Abmelden",
  "Défaite": "Niederlage",
  "Défaillant": "Verlierend",
  "Détails": "Details",
  "Distance": "Distanz",
  "En cours": "Laufend",
  "Enregistrer": "Speichern",
  "En cours de match": "Im Spiel",
  "Envoi du lien de réinitialisation...": "Reset-Link wird gesendet...",
  "Envoi...": "Senden...",
  "Erreur": "Fehler",
  "Fermer": "Schließen",
  "Final": "Finale",
  "Finale": "Finale",
  "Forfait": "Aufgabe",
  "Gagnant": "Gewinner",
  "gagnant": "Gewinner",
  "Gagné": "Gewonnen",
  "Historique": "Verlauf",
  "Honnêteté": "Sportlichkeit",
  "Inconnu": "Unbekannt",
  "Inscrits": "Eingeschrieben",
  "Inscription": "Anmeldung",
  "Inséré": "Eingeschrieben",
  "Interrompu": "Unterbrochen",
  "Joueur": "Spieler",
  "Mon tournoi": "Mein Turnier",
  "Joueurs": "Spieler",
  "jour": "Tag",
  "Langue": "Sprache",
  "Manche": "Frame",
  "Manches": "Frames",
  "Manches gagnées": "Gewonnene Frames",
  "Match": "Spiel",
  "Matchs": "Spiele",
  "Matchs en direct": "Live-Spiele",
  "Me désinscrire": "Meine Anmeldung zurückziehen",
  "Mon espace": "Mein Bereich",
  "Mot de passe": "Passwort",
  "Mot de passe oublié ?": "Passwort vergessen?",
  "Modifier": "Bearbeiten",
  "Mute": "Stumm",
  "Notifications": "Benachrichtigungen",
  "Nom": "Name",
  "Non": "Nein",
  "Oui": "Ja",
  "Ouvrir": "Öffnen",
  "Paramètres": "Einstellungen",
  "Perdu": "Verloren",
  "Perdant": "Verlierer",
  "perdant": "Verlierer",
  "Pseudo": "Benutzername",
  "Prévu": "Geplant",
  "Prêt": "Bereit",
  "Points": "Punkte",
  "Quitter": "Verlassen",
  "Rafraîchir": "Aktualisieren",
  "Rejouer": "Wiederholen",
  "Remerciements": "Danksagung",
  "Retour": "Zurück",
  "Réduire": "Einklappen",
  "Réglages": "Einstellungen",
  "Score": "Spielstand",
  "Se connecter": "Anmelden",
  "Se déconnecter": "Abmelden",
  "Sécurité": "Sicherheit",
  "Statistiques": "Statistiken",
  "Stats": "Statistik",
  "Suivre": "Folgen",
  "Suivi": "Gefolgt",
  "Suivre un joueur": "Einem Spieler folgen",
  "Table de marque": "Schreibertisch",
  "← Table de marque": "← Schreibertisch",
  "Tables": "Tische",
  "Terminé": "Beendet",
  "Terminer": "Beenden",
  "Thème": "Design",
  "Titres": "Titel",
  "Ton compte": "Dein Konto",
  "Tournoi": "Turnier",
  "Tournoi précédent": "Vorheriges Turnier",
  "Tournois": "Turniere",
  "Tout voir": "Alle ansehen",
  "Tableau": "Turnierbaum",
  "Vainqueur": "Sieger",
  "Valider": "Bestätigen",
  "Victoire": "Sieg",
  "Victoires": "Siege",
  "Vues": "Aufrufe",
  "Échec": "Fehlgeschlagen",
  "Éditer": "Bearbeiten",
  "Préférences": "Einstellungen",
  "Prénom": "Vorname",
  "Email": "E-Mail",
  "Chargement...": "Wird geladen...",
  "Charger plus": "Mehr laden",
  "Changer de club": "Club wechseln",
  "M'inscrire": "Einschreiben",
  "Inscriptions": "Anmeldungen",
  "Nombre de joueurs": "Spieleranzahl",
  "Numéro de match": "Spielnummer",
  "Aucun joueur trouvé": "Kein Spieler gefunden",
  "Aucun résultat": "Kein Ergebnis",
  "Tournoi terminé": "Turnier beendet",
  "Tournoi en cours": "Turnier läuft",
  "Tirage au sort": "Auslosung",
  "tirage": "Auslosung",
  "Faute": "Foul",
  "Fautes": "Fouls",
  "Meilleure série": "Beste Serie",
  "Membre": "Mitglied",
  "Membres": "Mitglieder",
  "Suite": "Weiter",
  "Suivant": "Weiter",
  "Précédent": "Zurück",
  "Accueil": "Startseite",
  "Aucun": "Keine",
  "Aucune": "Keine",
  "Ajouter": "Hinzufügen",
  "Supprimer": "Löschen",
  "Confirmer": "Bestätigen",
  "Copier": "Kopieren",
  "Copié !": "Kopiert!",
  "Attention": "Achtung",
  "Info": "Info",
  "Libre": "Frei",
  "Occupée": "Besetzt",
  "Manche en cours": "Frame läuft",
  "Match en cours": "Spiel läuft",
  "Clic = éditer (admin)": "Klick = bearbeiten (Admin)",
  "Déjà suivi": "Bereits gefolgt",
  "Ne plus suivre": "Nicht mehr folgen",
  "Face à face": "Direktvergleich",
  "Adversaire": "Gegner",
  "Adversaires": "Gegner",
  "Série": "Serie",
  "Séries": "Serien",
  "Trois quarts": "Viertelfinale",
  "Quarts": "Viertel",
  "Demis": "Halbfinale",
  "Demi-finales": "Halbfinals",
  "Poules": "Gruppen",
  "Poule": "Gruppe",
  "Vidéos": "Videos",
  "A propos": "Über",
  "Voir": "Ansehen",
  "Voir tout": "Alles ansehen",
  "Eight Ball Pink City — Tournoi": "Eight Ball Pink City — Turnier",
  "Mon compte — Pink City Billard": "Mein Konto — Pink City Billard",
  "Paramètres — Pink City Billard": "Einstellungen — Pink City Billard",
  "Amis — Pink City Billard": "Freunde — Pink City Billard",
  "Mes matchs — Pink City Billard": "Meine Spiele — Pink City Billard",
  "Match — Pink City Billard": "Spiel — Pink City Billard",
  "Fiche joueur — Pink City Billard": "Spielerseite — Pink City Billard",
  "Stats joueurs — Pink City Billard": "Spielerstatistiken — Pink City Billard",
  "Joueur — Pink City Billard": "Spieler — Pink City Billard",
  "Tableau — Pink City Billard": "Turnierbaum — Pink City Billard",
  "Tournoi archivé — Pink City Billard": "Archiviertes Turnier — Pink City Billard",
  "Historique — Pink City Billard": "Verlauf — Pink City Billard",
  "Historique admin — Pink City Billard": "Admin-Verlauf — Pink City Billard",
  "Mot de passe oublié — Pink City Billard": "Passwort vergessen — Pink City Billard",
  "Nouveau mot de passe — Pink City Billard": "Neues Passwort — Pink City Billard",
  "Table de marque — Pink City Billard": "Schreibertisch — Pink City Billard",
  "Gérer le tournoi — Pink City Billard": "Turnier verwalten — Pink City Billard",
  "Journal d'audit — Pink City Billard": "Audit-Log — Pink City Billard",
  "Comptes joueurs — Table de marque": "Spielerkonten — Schreibertisch",
  "🗄 Données — Table de marque": "🗄 Daten — Schreibertisch",
  "❓ Aide — Tournoi EBPC": "❓ Hilfe — EBPC-Turnier",
  "🔒 Confidentialité — Tournoi EBPC": "🔒 Datenschutz — EBPC-Turnier",
  "⚙️ Guide admin — Tournoi EBPC": "⚙️ Admin-Anleitung — EBPC-Turnier",
  "dimanche": "Sonntag",
  "lundi": "Montag",
  "mardi": "Dienstag",
  "mercredi": "Mittwoch",
  "jeudi": "Donnerstag",
  "vendredi": "Freitag",
  "samedi": "Samstag",
  "Casse la manche en cours": "Break des laufenden Frames",
  "Gagnés": "Gewonnen",
  "Joués": "Gespielt",
  "Mon compte": "Mein Konto",
  "Phase finale": "Finalphase",
  "⏳ match attendu": "⏳ Spiel ausstehend",
  "▶ Lancer": "▶ Starten",
  "🏅 Classement": "🏅 Rangliste",
  "💾 Enregistrer le score": "💾 Spielstand speichern",
  "PIN invalide — reconnecte-toi dans l'admin": "Ungültige PIN — melde dich im Admin-Bereich neu an",
  "Annulé : code non saisi": "Abgebrochen: Code nicht eingegeben",
  "Annulé : mot de confirmation non saisi": "Abgebrochen: Bestätigungswort nicht eingegeben",
  "Effacer le code mémorisé (sera redemandé à la prochaine action admin)": "Gespeicherten Code löschen (wird bei der nächsten Admin-Aktion erneut abgefragt)",
  "Verrouiller la table de marque ? Le code PIN sera redemandé.": "Schreibertisch sperren? Der PIN-Code wird erneut abgefragt.",
  "connecte-toi avec un compte admin": "melde dich mit einem Admin-Konto an",
  "pour confirmer :": "zum Bestätigen:",
  "— aucune —": "— keine —",
  "✏️ Score (correction)": "✏️ Spielstand (Korrektur)",
  "👥 Joueurs du match": "👥 Spieler des Spiels",
  "🔐 Table de marque": "🔐 Schreibertisch",
  "🔓 Rouvrir le match": "🔓 Spiel wieder öffnen",
  "Permission refusée": "Zugriff verweigert",
  "Push non supporté sur ce navigateur": "Push wird von diesem Browser nicht unterstützt",
  "❓ Aide": "❓ Hilfe",
  "🎱 S'inscrire": "🎱 Einschreiben",
  "Compte (bouton « Compte » en haut à droite) → pseudo + email + mot de passe, puis « M'inscrire » sur l'accueil. Sans compte : champ pseudo sur l'accueil, mais pas de notif push ni d'historique perso. Inscrit par erreur ? Bouton « Me désinscrire » (accueil ou page compte), tant que les inscriptions sont ouvertes et avant paiement (déjà payé : voir la table de marque).": "Konto (Schaltfläche « Konto » oben rechts) → Benutzername + E-Mail + Passwort, dann auf der Startseite « Einschreiben ». Ohne Konto: Benutzername-Feld auf der Startseite, aber keine Push-Benachrichtigung und kein persönlicher Verlauf. Versehentlich eingeschrieben? Button « Anmeldung zurückziehen » (Startseite oder Kontoseite), solange die Anmeldung offen ist und vor der Zahlung (bereits bezahlt: siehe Schreibertisch).",
  "🔔 Notifications « à toi de jouer »": "🔔 Benachrichtigungen « du bist dran »",
  "Ajoute d'abord le site à l'écran d'accueil : Android → ⋯ → « Installer l'application » ; iPhone → OUVRIR LE SITE DANS SAFARI (obligatoire, Chrome iOS ne le permet pas) → Partager → « Sur l'écran d'accueil ». Ouvre ensuite l'app depuis l'écran d'accueil, puis Compte → 🔔 Activer les notifications. Au lancement de ton match tu reçois une notif — un tap ouvre directement la card du match (même écran verrouillé).": "Füge zuerst die Seite zum Startbildschirm hinzu: Android → ⋯ → « App installieren »; iPhone → ÖFFNE DIE SEITE IN SAFARI (Pflicht, Chrome iOS erlaubt es nicht) → Teilen → « Zum Startbildschirm ». Öffne dann die App vom Startbildschirm und gehe zu Konto → 🔔 Benachrichtigungen aktivieren. Beim Start deines Spiels bekommst du eine Benachrichtigung — ein Tipp öffnet direkt die Spielkarte (auch bei gesperrtem Bildschirm).",
  "Tu reçois aussi une notif « 🎱 Nouveau tournoi — inscriptions ouvertes » quand la table de marque crée un tournoi (sauf si elle a désactivé le switch 🔔 du formulaire de création).": "Du bekommst auch eine Benachrichtigung « 🎱 Neues Turnier — Anmeldung offen », wenn der Schreibertisch ein Turnier anlegt (außer wenn der 🔔-Schalter im Erstellungsformular deaktiviert wurde).",
  "🗺️ Suivre le tournoi": "🗺️ Dem Turnier folgen",
  "Tableau : vue bracket (onglets Tout / WB / LB / Phase finale, liens entre matchs sur l’onglet final) ou liste, liste déroulante « Aller au tour », filtre joueur avec Entrée. Dans un match pas encore joué, la place inconnue affiche « gagnant wb1-001 », « perdant lb2-003 » ou « blanc » : tu sais d’où vient le joueur que tu attends. Match en cours = entouré en rouge, terminé = bord vert, gagnant en vert. Avant le tirage au sort, le tableau affiche déjà la structure à vide : les places du tour 1 sont numérotées j1, j2, ... (jusqu’à j32 pour un tableau de 32), tu vois donc le format du tournoi dès sa création. · 📺 TV pour la salle · « Mon tournoi » = tes matchs · 📊 Stats · 🗂 Historique.": "Turnierbaum: Bracket-Ansicht (Registerkarten Alle / WB / LB / Finalphase, Verbindungen zwischen Spielen auf der letzten Registerkarte) oder Liste, Dropdown « Zur Runde springen », Spielerfilter mit Eingabetaste. In einem noch nicht gespielten Spiel zeigt der unbekannte Platz « Gewinner wb1-001 », « Verlierer lb2-003 » oder « Frei »: du weißt, woher der Spieler kommt, auf den du wartest. Laufendes Spiel = rot umrahmt, beendet = grüner Rand, Gewinner in grün. Vor der Auslosung zeigt der Turnierbaum bereits die leere Struktur: die Plätze von Runde 1 sind nummeriert j1, j2, ... (bis j32 bei einem Baum mit 32), du siehst das Turnierformat also gleich nach der Erstellung. · 📺 TV für den Raum · « Mein Turnier » = deine Spiele · 📊 Statistik · 🗂 Verlauf.",
  "🎲 Jouer un match": "🎲 Ein Spiel spielen",
  "Au lancement, panneau « Tirage à la bande » : chaque joueur fait rouler une bille, le plus proche de la bande gagne → clique « ⚪ [pseudo] casse ». La ⚪ alterne ensuite à chaque manche.": "Beim Start das Panel « Banden-Lag »: jeder Spieler lässt eine Kugel rollen, wer der Bande am nächsten kommt, gewinnt → klicke « ⚪ [Benutzername] stößt an ». Das ⚪ wechselt danach bei jedem Frame.",
  "Saisie : +1 manche pour le gagnant de la manche, −1 pour corriger (la ⚪ revient alors à l’état précédent). 💥 Casse ferme = réservé au joueur ⚪ (l'autre bouton est grisé). 🎯 Reprise ferme = réservé à l'autre. Dernier point → confirmation du score avec possibilité de modifier.": "Eingabe: +1 Frame für den Frame-Gewinner, −1 zum Korrigieren (das ⚪ kehrt dann in den vorherigen Zustand zurück). 💥 Break-and-Run = nur für den ⚪-Spieler (die andere Schaltfläche ist ausgegraut). 🎯 Neuaufbau = nur für den anderen. Letzter Punkt → Bestätigung des Spielstands mit Änderungsmöglichkeit.",
  "🔑 Mot de passe oublié": "🔑 Passwort vergessen",
  "Compte → « Mot de passe oublié » → email → lien de réinit (valable 1 h).": "Konto → « Passwort vergessen » → E-Mail → Reset-Link (1 h gültig).",
  "👥 Amis": "👥 Freunde",
  "Compte → section Amis : recherche un pseudo (Entrée) et ajoute un ami. Tu reçois une notif push « match d'un ami » quand son match commence, et tu vois son statut en direct (en cours vs …, programmé, inscrit) sur ton compte et sur l'accueil.": "Konto → Bereich Freunde: suche einen Benutzernamen (Eingabetaste) und füge einen Freund hinzu. Du bekommst eine Push-Benachrichtigung « Spiel eines Freundes », wenn sein Spiel beginnt, und siehst seinen Live-Status (laufend gegen…, geplant, eingeschrieben) in deinem Konto und auf der Startseite.",
  "📊 Mon historique": "📊 Mein Verlauf",
  "Compte → « 📊 Ma fiche joueur » : joués/gagnés, %, manches, run-outs + historique de tous tes matchs.": "Konto → « 📊 Meine Spielerseite »: gespielt/gewonnen, %, Frames, Run-outs + Verlauf aller deiner Spiele.",
  "👤 Ton compte": "👤 Dein Konto",
  "Ton email est masqué (affiché partiellement) ; changement séparé. Un match contre blanc (bye) ne compte ni gagné ni perdu dans tes stats.": "Deine E-Mail ist maskiert (teilweise angezeigt); separate Änderung. Ein Spiel gegen Frei (Bye) zählt in deiner Statistik weder als gewonnen noch als verloren.",
  "Guide complet : docs/GUIDE_UTILISATEUR.md dans le dépôt GitHub.": "Vollständige Anleitung: docs/GUIDE_UTILISATEUR.md im GitHub-Repository.",
  "🔒 Confidentialité & données": "🔒 Datenschutz & Daten",
  "Ce qu'on collecte": "Was wir erheben",
  "Tournoi : inscriptions, matchs, scores, événements, statistiques": "Turnier: Anmeldungen, Spiele, Spielstände, Ereignisse, Statistiken",
  "Compte joueur : pseudo, email, mot de passe (hashé scrypt+salt, jamais en clair)": "Spielerkonto: Benutzername, E-Mail, Passwort (scrypt+salt gehasht, nie im Klartext)",
  "Notifications push : uniquement si tu les actives (opt-in), abonnement révocable à tout moment": "Push-Benachrichtigungen: nur wenn du sie aktivierst (Opt-in), Abonnement jederzeit widerrufbar",
  "Ce qu'on ne fait PAS": "Was wir NICHT tun",
  "Aucun cookie de tracking/publicité, aucune revente de données, aucun partage à des tiers (sauf envoi d'emails via Resend pour la réinitialisation de mot de passe).": "Keine Tracking-/Werbe-Cookies, kein Datenverkauf, keine Weitergabe an Dritte (außer E-Mail-Versand über Resend für den Passwort-Reset).",
  "Finalités & base légale": "Zwecke & Rechtsgrundlage",
  "Faire fonctionner le tournoi (inscriptions, matchs, scores, classements, notifications) = exécution du service demandé. Les emails servent uniquement à la réinit du mot de passe. Les données sont conservées tant que le compte est actif ; les comptes inactifs 18 mois sont supprimés automatiquement.": "Der Turnierbetrieb (Anmeldungen, Spiele, Spielstände, Ranglisten, Benachrichtigungen) = Erfüllung des angeforderten Dienstes. E-Mails dienen nur dem Passwort-Reset. Daten werden gespeichert, solange das Konto aktiv ist; 18 Monate inaktive Konten werden automatisch gelöscht.",
  "Hébergement": "Hosting",
  "Application hébergée sur Fly.io (société américaine) en région Paris (cdg), base SQLite sur volume. Un transfert hors UE peut exister côté infrastructure ; les données restent sous notre responsabilité.": "Anwendung gehostet auf Fly.io (US-Unternehmen) in der Region Paris (cdg), SQLite-Datenbank auf einem Volume. Eine Übertragung außerhalb der EU kann infrastrukturseitig bestehen; die Daten bleiben in unserer Verantwortung.",
  "Responsable du traitement": "Verantwortlicher",
  "Voir avec la table de marque du tournoi.": "Wende dich an den Schreibertisch des Turniers.",
  "Technique : cookie de session strictement nécessaire (HttpOnly, SameSite, Secure), préférences navigateur (localStorage : joueur suivi, vue tableau)": "Technisch: unbedingt erforderliches Sitzungs-Cookie (HttpOnly, SameSite, Secure), Browser-Einstellungen (localStorage: gefolgter Spieler, Turnierbaum-Ansicht)",
  "Mots de passe hashés (scrypt + sel), sessions en cookie HttpOnly/SameSite/Secure, tokens de réinit hashés et valables 1 h, rate-limit sur connexion/inscription. Contact en cas d'incident : via la table de marque.": "Passwörter gehasht (scrypt + Salt), Sitzungen in HttpOnly/SameSite/Secure-Cookies, Reset-Tokens gehasht und 1 h gültig, Rate-Limit bei Anmeldung/Registrierung. Kontakt bei einem Vorfall: über den Schreibertisch.",
  "✏️ Rectification : changer pseudo/email dans le compte ; corrections admin possibles": "✏️ Berichtigung: Benutzername/E-Mail im Konto ändern; Admin-Korrekturen möglich",
  "📥 Accès/export : bouton « Exporter mes données » dans ton compte (JSON complet)": "📥 Zugang/Export: Button « Meine Daten exportieren » in deinem Konto (vollständiges JSON)",
  "🗑 Effacement : suppression du compte par l'admin (les matchs restent dans l'historique anonymisé du tournoi), purge auto 18 mois": "🗑 Löschung: Kontolöschung durch den Admin (die Spiele bleiben im anonymisierten Turnierverlauf), automatische Löschung nach 18 Monaten",
  "🚫 Opposition : désactive les notifications push à tout moment": "🚫 Widerspruch: deaktiviere die Push-Benachrichtigungen jederzeit",
  "Donne l'email de ton compte : on t'envoie un lien de réinitialisation (valable 1h).": "Gib die E-Mail deines Kontos an: wir senden dir einen Reset-Link (1 h gültig).",
  "Envoyer le lien": "Link senden",
  "🔐 Nouveau mot de passe": "🔐 Neues Passwort",
  "Changer le mot de passe": "Passwort ändern",
  "Nouveau mot de passe (min 4)": "Neues Passwort (min. 4)",
  "✅ Mot de passe changé, tu es connecté. Redirection…": "✅ Passwort geändert, du bist angemeldet. Weiterleitung…",
  "Joueur introuvable.": "Spieler nicht gefunden.",
  "Bilan tous tournois confondus.": "Bilanz über alle Turniere.",
  "Résultat": "Ergebnis",
  "Statistiques joueurs (tous les tournois)": "Spielerstatistiken (alle Turniere)",
  "Aucune statistique pour le moment.": "Noch keine Statistiken.",
  "🔴 À toi de jouer": "🔴 Du bist dran",
  "Qui es-tu ?": "Wer bist du?",
  "Touche ton pseudo ci-dessous.": "Tippe unten auf deinen Benutzernamen.",
  "Tes matchs": "Deine Spiele",
  "Aucun match pour le moment. Le tirage arrive bientôt ! 🎱": "Noch keine Spiele. Die Auslosung kommt bald! 🎱",
  "Aucun tournoi en cours.": "Kein laufendes Turnier.",
  "🎱 Aucun tournoi en cours": "🎱 Kein laufendes Turnier",
  "Aller au tour :": "Zur Runde springen:",
  "— Choisir un tour —": "— Runde wählen —",
  "🔍 Filtrer par joueur (ex: seb) — Entrée pour valider": "🔍 Nach Spieler filtern (z. B. seb) — Eingabetaste zum Anwenden",
  "Le tableau (structure à vide) apparaîtra ici dès la création d'un tournoi, les joueurs après le tirage au sort.": "Der Turnierbaum (leere Struktur) erscheint hier, sobald ein Turnier erstellt wird, und die Spieler nach der Auslosung.",
  "📊 Statistiques du tournoi": "📊 Turnierstatistiken",
  "🔍 Surligner un joueur (ex: seb) — Entrée pour valider": "🔍 Spieler hervorheben (z. B. seb) — Eingabetaste zum Anwenden",
  "Aucun tournoi terminé pour le moment.": "Noch kein beendetes Turnier.",
  "Tous les tournois terminés restent consultables ici.": "Alle beendeten Turniere bleiben hier einsehbar.",
  "Voir le tableau": "Turnierbaum ansehen",
  "La TV Pink City est pensée pour le mode paysage": "Die Pink City TV ist für den Querformat-Modus konzipiert",
  "Tourne l'écran en paysage": "Drehe den Bildschirm ins Querformat",
  "QR code du site": "QR-Code der Website",
  "Scanner pour ouvrir le site sur ton téléphone": "Scanne, um die Seite auf deinem Telefon zu öffnen",
  "🎉 Félicitations ! 🎉": "🎉 Glückwunsch! 🎉",
  "Champion de la Pink City": "Pink City Champion",
  "En attente des matchs…": "Warten auf Spiele…",
  "Le tournoi va bientôt commencer": "Das Turnier beginnt bald",
  "🎱 Aucun tournoi pour le moment": "🎱 Derzeit kein Turnier",
  "🏁 TERMINÉ": "🏁 BEENDET",
  "📱 Scanne pour ouvrir le site": "📱 Scanne, um die Seite zu öffnen",
  "📱 Scanne pour t'inscrire": "📱 Scanne, um dich einzuschreiben",
  "Inscriptions ouvertes": "Anmeldung offen",
  "🏁 Terminé": "🏁 Beendet",
  "👤 Mon compte": "👤 Mein Konto",
  "🗺 Voir le tableau complet →": "🗺 Vollständigen Turnierbaum ansehen →",
  "— hors tournoi": "— außerhalb des Turniers",
  "Aucun ami — ajoute-en depuis le menu Compte.": "Keine Freunde — füge welche über das Konto-Menü hinzu.",
  "Inscrit par erreur ? Tu peux te désinscrire tant que les inscriptions sont ouvertes et que tu n'as pas payé.": "Versehentlich eingeschrieben? Du kannst deine Anmeldung zurückziehen, solange die Anmeldung offen ist und du nicht bezahlt hast.",
  "Jamais inscrit à un tournoi de ce club — pas de fiche": "Nie bei einem Turnier dieses Clubs eingeschrieben — keine Spielerseite",
  "Revenez bientôt !": "Bald wieder!",
  "Te désinscrire du tournoi ?": "Anmeldung für das Turnier zurückziehen?",
  "Ton pseudo": "Dein Benutzername",
  "gérer mon compte": "mein Konto verwalten",
  "Élimination directe": "Einfache Ausscheidung",
  "💡 Crée un compte (pseudo + email + mot de passe) pour t'inscrire en 1 clic et retrouver tes stats :": "💡 Erstelle ein Konto (Benutzername + E-Mail + Passwort), um dich mit 1 Klick einzuschreiben und deine Statistiken wiederzufinden:",
  "💰 Déjà payé : la désinscription se fait auprès de la table de marque (remboursement à voir avec le club).": "💰 Bereits bezahlt: die Abmeldung erfolgt beim Schreibertisch (Rückerstattung mit dem Club zu klären).",
  "📝 inscrit au tournoi": "📝 für das Turnier eingeschrieben",
  "✨ Créer un compte": "✨ Konto erstellen",
  "Juste un pseudo, un email et un mot de passe. Rien d'autre.": "Nur ein Benutzername, eine E-Mail und ein Passwort. Nichts weiter.",
  "Ma fiche joueur": "Meine Spielerseite",
  "Email (pour réinit du mot de passe)": "E-Mail (für den Passwort-Reset)",
  "Nouvel email (vide = inchangé)": "Neue E-Mail (leer = unverändert)",
  "Email inchangé": "E-Mail unverändert",
  "✅ Email mis à jour": "✅ E-Mail aktualisiert",
  "Mot de passe (min 4)": "Passwort (min. 4)",
  "Se déconnecter ?": "Abmelden?",
  "(sans compte)": "(ohne Konto)",
  "📋 Mon inscription": "📋 Meine Anmeldung",
  "Possible tant que les inscriptions sont ouvertes et que tu n'as pas payé.": "Möglich, solange die Anmeldung offen ist und du nicht bezahlt hast.",
  "Exporter mes données (RGPD)": "Meine Daten exportieren (DSGVO)",
  "Voir aussi : 🔒 Confidentialité (menu ☰)": "Siehe auch: 🔒 Datenschutz (Menü ☰)",
  "Aucun ami pour le moment — recherche un pseudo ci-dessus.": "Noch keine Freunde — suche oben einen Benutzernamen.",
  "déjà ami": "bereits Freund",
  "Suis des joueurs : tu reçois une notif quand leur match commence ou quand ils s'inscrivent à un tournoi, et leur statut ici. Pas besoin de compte pour eux : entre son pseudo dans la recherche puis « Suivre ».": "Folge Spielern: du bekommst eine Benachrichtigung, wenn ihr Spiel beginnt oder sie sich für ein Turnier einschreiben, und hier ihren Status. Sie brauchen kein Konto: gib ihren Benutzernamen in die Suche ein und dann « Folgen ».",
  "🔔 Notifier quand le match d'un ami commence": "🔔 Mich benachrichtigen, wenn das Spiel eines Freundes beginnt",
  "🔔 Notifier quand un ami s'inscrit à un tournoi": "🔔 Mich benachrichtigen, wenn sich ein Freund für ein Turnier einschreibt",
  "Activer les notifications": "Benachrichtigungen aktivieren",
  "Désactiver": "Deaktivieren",
  "Tester la notification": "Benachrichtigung testen",
  "Notifications activées !": "Benachrichtigungen aktiviert!",
  "Notifications désactivées": "Benachrichtigungen deaktiviert",
  "⚠️ Aucun appareil abonné — active les notifications avant.": "⚠️ Kein angemeldetes Gerät — aktiviere vorher die Benachrichtigungen.",
  "Reçois une notification push quand un de tes matchs est lancé (même écran verrouillé).": "Erhalte eine Push-Benachrichtigung, wenn eines deiner Spiele gestartet wird (auch bei gesperrtem Bildschirm).",
  "📱 Sur iPhone : ajoute d'abord le site à l'écran d'accueil (Safari → Partager → « Sur l'écran d'accueil »), puis active les notifications.": "📱 Auf dem iPhone: füge zuerst die Seite zum Startbildschirm hinzu (Safari → Teilen → « Zum Startbildschirm »), und aktiviere dann die Benachrichtigungen.",
  "Pas (encore !) d'inscription ni de match à afficher.": "Noch keine Anmeldung und kein Spiel anzuzeigen.",
  "🔍 Rechercher un pseudo… (Entrée)": "🔍 Benutzernamen suchen… (Eingabetaste)",
  "🎱 Match en direct": "🎱 Live-Spiel",
  "← Mes matchs": "← Meine Spiele",
  "+1 manche": "+1 Frame",
  "−1 manche": "−1 Frame",
  "🎲 Tirage à la bande": "🎲 Banden-Lag",
  "Chaque joueur fait rouler une bille sur le tapis : le plus proche de la bande remporte le tirage et casse en premier (⚪).": "Jeder Spieler lässt eine Kugel über das Tuch rollen: wer der Bande am nächsten ist, gewinnt das Lag und stößt zuerst an (⚪).",
  "En attente de la table…": "Warten auf den Tisch…",
  "La table de marque va lancer le match…": "Der Schreibertisch wird das Spiel starten…",
  "La saisie des points est bloquée tant que le tirage à la bande n'est pas fait.": "Die Punkteingabe ist gesperrt, bis das Banden-Lag gemacht ist.",
  "Confirmer le score": "Spielstand bestätigen",
  "Vérifie le score sur la table avant de confirmer.": "Prüfe den Spielstand am Tisch, bevor du bestätigst.",
  "Modifier (annuler ce point)": "Bearbeiten (diesen Punkt annullieren)",
  "⚠️ Dernier point ?": "⚠️ Letzter Punkt?",
  "Le joueur qui a la casse ne fait pas de reprise ferme": "Der Spieler, der anstößt, kann keinen Neuaufbau machen",
  "Seul le joueur qui a la casse peut faire une casse ferme": "Nur der Spieler, der anstößt, kann ein Break-and-Run machen",
  "Match introuvable.": "Spiel nicht gefunden.",
  "Consultation seule — tu ne joues pas ce match.": "Nur Ansicht — du spielst dieses Spiel nicht.",
  "🎱 Table de marque": "🎱 Schreibertisch",
  "Espace table de marque": "Schreibertisch-Bereich",
  "📌 Accès rapide": "📌 Schnellzugriff",
  "Comptes joueurs": "Spielerkonten",
  "Configurer / gérer le tournoi": "Turnier konfigurieren / verwalten",
  "Données": "Daten",
  "Journal d'audit": "Audit-Log",
  "Aucun tournoi actif pour le moment.": "Derzeit kein aktives Turnier.",
  "Nouveau tournoi": "Neues Turnier",
  "Créer le tournoi": "Turnier erstellen",
  "Règle": "Regel",
  "Taille max": "Maximale Größe",
  "Nombre de tables": "Tischanzahl",
  "📅 Date et heure": "📅 Datum und Uhrzeit",
  "Têtes de série": "Setzplätze",
  "Préfixe": "Präfix",
  "N° série": "Setz-Nr.",
  "Double KO + tableau final": "Doppel-KO + Finalbaum",
  "Double KO sur": "Doppel-KO über",
  "Finale seule": "Nur Finale",
  "Distance spéciale": "Spezialdistanz",
  "Distance spéciale à partir de": "Spezialdistanz ab",
  "Réservées à partir du tour n° (vide = quarts)": "Reserviert ab Runde Nr. (leer = Viertelfinale)",
  "Tables réservées en phase finale (jamais utilisées en auto à partir des quarts)": "Reservierte Tische für die Finalphase (ab dem Viertelfinale nie automatisch genutzt)",
  "Ordre des tables (mode auto)": "Tischreihenfolge (Auto-Modus)",
  "Ajuster auto la taille au nombre de payés": "Größe automatisch an die Zahl der Bezahler anpassen",
  "Nouveau joueur": "Neuer Spieler",
  "Lancer le tirage ? Inscriptions closes.": "Auslosung starten? Die Anmeldung wird geschlossen.",
  "▶ Simuler tout le tournoi": "▶ Das ganze Turnier simulieren",
  "⚠️ Clôturer le tournoi": "⚠️ Turnier abschließen",
  "Terminer le tournoi maintenant": "Turnier jetzt beenden",
  "Terminer le tournoi maintenant ?": "Turnier jetzt beenden?",
  "Termine le tournoi immédiatement (même si la finale n'a pas été jouée). Les tableaux restent en ligne.": "Beendet das Turnier sofort (auch wenn das Finale nicht gespielt wurde). Die Turnierbäume bleiben online.",
  "Supprimer le tournoi": "Turnier löschen",
  "Supprimer le tournoi et TOUT son contenu ?": "Turnier und ALLEN Inhalt löschen?",
  "Enregistré ✅": "Gespeichert ✅",
  "✅ Tournoi importé": "✅ Turnier importiert",
  "📥 Exporter le tournoi actif": "📥 Aktives Turnier exportieren",
  "📤 Importer un JSON": "📤 JSON importieren",
  "Exporte le tournoi actif en JSON (backup, rejouer ailleurs), ou importe un export (remplace le tournoi actif — code PIN re-demandé).": "Exportiert das aktive Turnier als JSON (Backup, woanders wiedergeben) oder importiert einen Export (ersetzt das aktive Turnier — PIN-Code wird erneut abgefragt).",
  "🗺 Voir / éditer les matchs": "🗺 Spiele ansehen / bearbeiten",
  "Ouvrir le tableau": "Turnierbaum öffnen",
  "Ouvrir l'historique": "Verlauf öffnen",
  "🎱 Tables disponibles": "🎱 Freie Tische",
  "🎱 Table auto (libre)": "🎱 Auto-Tisch (frei)",
  "🤖 Mode auto :": "🤖 Auto-Modus:",
  "Mode auto :": "Auto-Modus:",
  "🤖 Gestion automatique": "🤖 Automatische Verwaltung",
  "Lance automatiquement le prochain match dès qu'un match se termine (priorité : Tour 1, puis LB1#1, WB2#1, LB2#1…).": "Startet automatisch das nächste Spiel, sobald eines endet (Priorität: Runde 1, dann LB1#1, WB2#1, LB2#1…).",
  "🔔 Notif push « inscriptions ouvertes »": "🔔 Push-Benachrichtigung « Anmeldung offen »",
  "🔔 Rappel inscriptions ouvertes (push aux joueurs abonnés)": "🔔 Erinnerung an die offene Anmeldung (Push an angemeldete Spieler)",
  "Clique sur un match du tableau pour lancer, corriger le score, déclarer un forfait ou rouvrir — sans quitter le tableau.": "Klicke auf ein Spiel im Turnierbaum, um es zu starten, den Spielstand zu korrigieren, eine Aufgabe zu erklären oder es wieder zu öffnen — ohne den Turnierbaum zu verlassen.",
  "📏 Distances (modifiables à tout moment)": "📏 Distanzen (jederzeit änderbar)",
  "Inscrit des joueurs fictifs en masse, directement payés.": "Schreibt fiktive Spieler massenhaft ein, direkt bezahlt.",
  "— aucun (coupe net) —": "— keine (glatter Schnitt) —",
  "ex: 1,2 (vide = aucune)": "z. B. 1,2 (leer = keine)",
  "marquer payé": "als bezahlt markieren",
  "🗄 Gestion des données": "🗄 Datenverwaltung",
  "👥 Joueurs": "👥 Spieler",
  "🎱 Matchs": "🎱 Spiele",
  "📜 Events d'un match": "📜 Ereignisse eines Spiels",
  "Choisis un match.": "Wähle ein Spiel.",
  "Aucun tournoi actif.": "Kein aktives Turnier.",
  "Aucun événement.": "Kein Ereignis.",
  "🔍 Filtrer (pseudo/joueur) — Entrée": "🔍 Filtern (Benutzername/Spieler) — Eingabetaste",
  "➕ manche": "➕ Frame",
  "🎲 tirage à la bande": "🎲 Banden-Lag",
  "🚀 lancement": "🚀 Spielstart",
  "▶ tournoi actif": "▶ aktives Turnier",
  "État": "Status",
  "(recalcul du score)": "(Spielstand neu berechnet)",
  "Supprimer cet événement ? Le score sera recalculé.": "Dieses Ereignis löschen? Der Spielstand wird neu berechnet.",
  "👤 Comptes joueurs": "👤 Spielerkonten",
  "Aucun compte.": "Kein Konto.",
  "Aucun ami": "Kein Freund",
  "Aucune notification activée": "Keine Benachrichtigung aktiviert",
  "Créé le": "Erstellt am",
  "Dernière connexion": "Letzte Anmeldung",
  "Nb inscri. tournois": "Turnier-Anmeldungen",
  "✏️ pseudo": "✏️ Benutzername",
  "Renommer le pseudo du compte": "Benutzernamen des Kontos umbenennen",
  "Changer le mot de passe du compte": "Passwort des Kontos ändern",
  "🔍 Rechercher (pseudo ou email)…": "🔍 Suchen (Benutzername oder E-Mail)…",
  "✅ Pseudo changé": "✅ Benutzername geändert",
  "✅ Mot de passe changé (sessions invalidées)": "✅ Passwort geändert (Sitzungen ungültig)",
  "Rétrograder en simple utilisateur (le PIN restera nécessaire pour l’admin)": "Zum normalen Benutzer herabstufen (die PIN bleibt für den Admin erforderlich)",
  "Promouvoir administrateur (sa session suffira pour l’admin, sans PIN)": "Zum Administrator befördern (seine Sitzung genügt für den Admin, ohne PIN)",
  "Rétrograder": "Herabstufen",
  "Rechercher (action, cible, détails)…": "Suchen (Aktion, Ziel, Details)…",
  "Action exacte (ex: tirage)": "Genaue Aktion (z. B. Auslosung)",
  "Vider le journal": "Log leeren",
  "Vider tout le journal d'audit ? (irréversible)": "Das ganze Audit-Log leeren? (unwiderruflich)",
  "✖ Tout afficher": "✖ Alles anzeigen",
  "⏪ Restaurer à ce point": "⏪ Zu diesem Punkt wiederherstellen",
  "✅ Tournoi restauré": "✅ Turnier wiederhergestellt",
  "Le contenu actuel du tournoi sera remplacé.": "Der aktuelle Turnierinhalt wird ersetzt.",
  "Exemples de matchs modifiés:": "Beispiele geänderter Spiele:",
  "⚙️ Guide admin": "⚙️ Admin-Anleitung",
  "1. Créer le tournoi": "1. Turnier erstellen",
  "2. Inscriptions": "2. Anmeldungen",
  "3. Tirage": "3. Auslosung",
  "4. Lancer les matchs": "4. Spiele starten",
  "5. Interventions en cours (clic card avec PIN → modale ⚙️)": "5. Eingriffe während des Betriebs (Klick auf die Karte mit PIN → Modalfenster ⚙️)",
  "6. Données (/admin-data.html)": "6. Daten (/admin-data.html)",
  "7. Classement par points": "7. Punkte-Rangliste",
  "8. Clôturer": "8. Abschluss",
  "9. Annuler une action : rollback point-in-time (journal d'audit)": "9. Aktion rückgängig machen: Point-in-Time-Rollback (Audit-Log)",
  "10. Comptes & audit": "10. Konten & Audit",
  "11. Tests & déploiement": "11. Tests & Bereitstellung",
  "Accès : code PIN (env `ADMIN_PIN`) ou session d'un compte avec le rôle `admin` (bootstrap via `ADMIN_EMAIL`/`ADMIN_PASSWORD`, promotion depuis /admin-comptes.html).": "Zugang: PIN-Code (env `ADMIN_PIN`) oder die Sitzung eines Kontos mit der Rolle `admin` (Bootstrap über `ADMIN_EMAIL`/`ADMIN_PASSWORD`, Beförderung über /admin-comptes.html).",
  "/admin-tournoi.html → nom, règle, taille (16/32/64/128), format (élim. directe / double KO + nb tours), nb tables, date. Ajustement auto à la taille des payés. Tables réservées: vide par défaut. En phase inscription, la TV montre un grand QR centré pour s'inscrire. Switch 🔔 « Notif push « inscriptions ouvertes » (coché par défaut) : à la création, un push « 🎱 Nouveau tournoi — inscriptions ouvertes » est envoyé à tous les comptes abonnés.": "/admin-tournoi.html → Name, Regel, Größe (16/32/64/128), Format (einfache Ausscheidung / Doppel-KO + Rundenzahl), Tischanzahl, Datum. Automatische Anpassung an die Zahl der Bezahler. Reservierte Tische: standardmäßig leer. In der Anmeldephase zeigt die TV einen großen zentrierten QR-Code zum Einschreiben. 🔔-Schalter « Push-Benachrichtigung « Anmeldung offen » (standardmäßig angehakt): bei der Erstellung wird ein Push « 🎱 Neues Turnier — Anmeldung offen » an alle angemeldeten Konten gesendet.",
  "Ajouter / simuler / payer / supprimer. Seuls les payés sont tirés. ⛔ Pseudo d'un compte = réservé: inscription anonyme refusée (409, anti-usurpation); ajout admin possible après confirmation (joueur rattaché au compte). Un invité qui crée un compte avec le même pseudo est rattaché auto (reçoit les pushs). ♻️ Un compte connecté peut se désinscrire lui-même (bouton « Me désinscrire »), en phase d'inscription uniquement et avant paiement ; un joueur déjà payé ou sans compte passe par un admin. Pseudo/mdp oublié → /admin-comptes.html (✏️ pseudo, 🔑 mdp).": "Hinzufügen / simulieren / bezahlen / löschen. Nur Bezahler werden ausgelost. ⛔ Benutzername eines Kontos = reserviert: anonyme Anmeldung abgelehnt (409, gegen Identitätsmissbrauch); Admin-Hinzufügung nach Bestätigung möglich (Spieler mit dem Konto verknüpft). Ein Gast, der ein Konto mit demselben Benutzernamen erstellt, wird automatisch verknüpft (bekommt die Push). ♻️ Ein angemeldetes Konto kann seine Anmeldung selbst zurückziehen (Button « Anmeldung zurückziehen »), nur in der Anmeldephase und vor der Zahlung; ein bereits bezahlter Spieler oder einer ohne Konto geht über einen Admin. Benutzername/Passwort vergessen → /admin-comptes.html (✏️ Benutzername, 🔑 Passwort).",
  "Bouton Tirage: appariements aléatoires crypto, byes répartis. ⚠️ Fige le bracket (retour en arrière possible uniquement par rollback point-in-time via le journal d'audit, voir §9).": "Auslosungs-Button: kryptografisch zufällige Paarungen, verteilte Freilose. ⚠️ Friert den Bracket ein (zurück nur per Point-in-Time-Rollback über das Audit-Log möglich, siehe §9).",
  "Mode auto ON = départ auto sur table libre (ordre personnalisable). Manuel: clic sur une card (PIN) → modale. Tirage à la bande ⚪ sur la card, puis alternance à chaque manche. Joueurs: seul le ⚪ fait « casse ferme », l'autre « reprise ferme » (grisé + 403). Dernier point = confirmation obligatoire.": "Auto-Modus AN = automatischer Start an einem freien Tisch (Reihenfolge anpassbar). Manuell: Klick auf eine Karte (PIN) → Modalfenster. Banden-Lag ⚪ auf der Karte, dann Wechsel bei jedem Frame. Spieler: nur der ⚪ macht « Break-and-Run », der andere « Neuaufbau » (ausgegraut + 403). Letzter Punkt = Pflichtbestätigung.",
  "✏️ Corriger le score (si distance atteinte → termine + propage)": "✏️ Spielstand korrigieren (bei erreichter Distanz → beendet + überträgt)",
  "🎱 Déplacer de table (409 si occupée, « aucune » pour libérer)": "🎱 Tisch wechseln (409 wenn besetzt, « keine » zum Freigeben)",
  "👥 Changer les joueurs (WB/LB, blanc possible, bye auto) — 409 auto si la paire est déjà appariée ailleurs (hors finale): rematch impossible": "👥 Spieler wechseln (WB/LB, Frei möglich, automatisches Bye) — automatisches 409, wenn das Paar bereits woanders gepaart ist (außer im Finale): Rückspiel unmöglich",
  "🔓 Rouvrir un match — ⚠️ 409 INTERDIT si un match aval a déjà commencé": "🔓 Spiel wieder öffnen — ⚠️ 409 UNZULÄSSIG, wenn ein nachgelagertes Spiel bereits begonnen hat",
  "🚫 Forfait (définitif)": "🚫 Aufgabe (endgültig)",
  "Onglets Matchs / Joueurs / Events sur le tournoi actif OU un tournoi terminé (sélecteur), filtre par pseudo (Entrée). Events: 🗑 supprime un event et recalcule le score → les stats se corrigent. Joueurs: éditer pseudo/statut, supprimer.": "Registerkarten Spiele / Spieler / Ereignisse für das aktive Turnier ODER ein beendetes Turnier (Auswahl), Filter nach Benutzername (Eingabetaste). Ereignisse: 🗑 löscht ein Ereignis und berechnet den Spielstand neu → die Statistiken korrigieren sich. Spieler: Benutzername/Status bearbeiten, löschen.",
  "Points = profondeur atteinte (WB: tour, F: k+tour en DKO), ex-aequo (1,1,1,4…). Les matchs clôturés sans gagnant ne comptent pas comme perdus.": "Punkte = erreichte Tiefe (WB: Runde, F: k+Runde im DKO), Punktgleichheit (1,1,1,4…). Ohne Gewinner abgeschlossene Spiele zählen nicht als Niederlagen.",
  "Règles DKO: WB/LB séparés jusqu'en finale; en F, alternance des moitiés + swap anti-rematch auto sur tous les tours WB/LB/F (rematch autorisé uniquement en vraie finale).": "DKO-Regeln: WB/LB bis zum Finale getrennt; in F Wechsel der Hälften + automatischer Anti-Rückspiel-Tausch in allen WB/LB/F-Runden (Rückspiel nur im echten Finale erlaubt).",
  "« Terminer maintenant » = coupe net, aucun champion auto (sauf choix explicite dans le select). Fin normale = champion auto via la finale. Historique ensuite en liste + recherche/surbrillance joueur.": "« Jetzt beenden » = glatter Schnitt, kein automatischer Champion (außer ausdrücklich im Auswahlfeld gewählt). Normales Ende = automatischer Champion über das Finale. Verlauf danach als Liste + Suche/Hervorhebung von Spielern.",
  "/admin-journal.html : chaque action admin est loguée ET snapshotée. Bouton ⏮ « Restaurer à ce point » sur une entrée = restaure le tournoi actif à l'état exact de cet événement (transaction atomique ; fonctionne même avec des matchs en cours → remis à 0-0, tables libérées). Un diff (matchs modifiés/ajoutés/supprimés, joueurs, statut, champion) s'affiche dans la confirmation avant validation. 409 si le snapshot concerne un autre tournoi, 404 sans snapshot. Le rollback est lui-même logué. Filtres du journal : recherche texte + type d'action.": "/admin-journal.html: jede Admin-Aktion wird protokolliert UND als Snapshot gespeichert. Button ⏮ « Zu diesem Punkt wiederherstellen » bei einem Eintrag = stellt das aktive Turnier auf den exakten Zustand dieses Ereignisses wieder her (atomare Transaktion; funktioniert auch mit laufenden Spielen → zurück auf 0-0, Tische freigegeben). Ein Diff (geänderte/hinzugefügte/gelöschte Spiele, Spieler, Status, Champion) erscheint in der Bestätigung vor der Validierung. 409, wenn der Snapshot ein anderes Turnier betrifft, 404 ohne Snapshot. Das Rollback selbst wird protokolliert. Log-Filter: Textsuche + Aktionstyp.",
  "/admin-comptes.html: liste (dernière connexion, inscri., matchs, sessions, amis : amis avec compte + pseudos suivis sans compte), ✏️ pseudo, 🔑 mdp, 🗑 supprimer (historique matchs conservé). Purge auto des comptes inactifs > 18 mois. /admin-journal.html: 500 dernières actions admin, lancements lisibles (« wb1-001 — P11 vs P07 (table 3) »). Le rollback point-in-time (bouton ⏮ « Restaurer à ce point ») est détaillé §9. 🔐 Toute action destructive (suppression tournoi/compte/event, vidage du journal, rollback) exige le code PIN re-saisi (modale masquée, `confirm_pin`) — sauf la désinscription d'un joueur. Une session de compte avec le rôle `admin` ne redemande pas le PIN, mais exige de saisir le mot `SUPPRIMER` dans la modale de confirmation.": "/admin-comptes.html: Liste (letzte Anmeldung, Anmeldungen, Spiele, Sitzungen, Freunde: Freunde mit Konto + gefolgte Benutzernamen ohne Konto), ✏️ Benutzername, 🔑 Passwort, 🗑 löschen (Spielverlauf bleibt erhalten). Automatische Löschung von Konten, die länger als 18 Monate inaktiv sind. /admin-journal.html: die letzten 500 Admin-Aktionen, lesbare Starts (« wb1-001 — P11 vs P07 (Tisch 3) »). Das Point-in-Time-Rollback (Button ⏮ « Zu diesem Punkt wiederherstellen ») ist unter §9 beschrieben. 🔐 Jede destruktive Aktion (Löschen von Turnier/Konto/Ereignis, Leeren des Logs, Rollback) erfordert die erneute Eingabe des PIN-Codes (maskiertes Modalfenster, `confirm_pin`) — außer der Abmeldung eines Spielers. Eine Kontositzung mit der Rolle `admin` verlangt den PIN nicht erneut, sondern das Eingeben des Wortes `SUPPRIMER` im Bestätigungsfenster.",
  "Batterie: BASE=http://127.0.0.1:PORT node test/batterie.js (203 checks → test/rapport.md) + test/e2e.js + test/fullrun.js ; sans serveur : node test/push-unit.js (push mocké), node test/purge-unit.js (purge > 90 j). Fly: secrets ADMIN_PIN, RESEND_API_KEY, MAIL_FROM, VAPID_* (jamais BASE_URL); volume tournoi_data sur /data; snapshots dans Volumes.": "Batterie: BASE=http://127.0.0.1:PORT node test/batterie.js (203 Checks → test/rapport.md) + test/e2e.js + test/fullrun.js ; ohne Server: node test/push-unit.js (Push gemockt), node test/purge-unit.js (Bereinigung > 90 T). Fly: Secrets ADMIN_PIN, RESEND_API_KEY, MAIL_FROM, VAPID_* (niemals BASE_URL); Volume tournoi_data auf /data; Snapshots in Volumes.",
  "Version complète: docs/GUIDE_ADMIN.md dans le dépôt GitHub.": "Vollständige Version: docs/GUIDE_ADMIN.md im GitHub-Repository.",
  "Aucun tournoi terminé.": "Kein beendetes Turnier.",
  "Consultation et suppression (admin).": "Ansicht und Löschung (Admin).",
  "Simuler tout le tournoi (scores aléatoires) jusqu'au champion ?": "Das ganze Turnier simulieren (zufällige Spielstände) bis zum Champion?",
  "payé annuler": "bezahlt annullieren",
  "déjà suivi": "bereits gefolgt",
  "👤 Connecté en tant que": "👤 Angemeldet als",
  "Retour à": "Zurück zu",
  "Restaurer le tournoi actif à l'état de cet événement ?": "Das aktive Turnier auf den Zustand dieses Ereignisses wiederherstellen?",
  "Ou": "Oder",
  "⚙️ Paramètres": "⚙️ Einstellungen",
  "Mode clair": "Heller Modus",
  "🔑 Connexion": "🔑 Anmelden",
  "Connexion": "Anmelden",
  "Mes matchs": "Meine Spiele",
  "Fil du tournoi": "Turnier-Feed",
  "Replier": "Weniger anzeigen",
  "en direct": "live",
  "☰ Menu": "☰ Menü",
  "Menu": "Menü",
  "🏆 Titres": "🏆 Titel",
  "Perdus": "Verloren",
  "% victoires": "% Siege",
  "⭐ Pts": "⭐ Pkt.",
  "💥 Run-outs": "💥 Run-outs",
  "Guide admin": "Admin-Anleitung",
  "Historique public": "Öffentlicher Verlauf",
  "🔗 Liens publics": "🔗 Öffentliche Links",
  "💾 Sauvegarde (export / import JSON)": "💾 Sicherkung (JSON-Export / Import)",
  "📍 Lieu": "📍 Ort",
  "géré dans sa page dédiée": "in der eigenen Seite verwaltet",
  "Format": "Format",
  "Inscrire": "Eintragen",
  "Corriger": "Korrigieren",
  "Nombre": "Anzahl",
  "Jamais (3 partout)": "Nie (überall 3)",
  "Distance (3/5/7) :": "Distanz (3/5/7):",
  "Motif :": "Grund:",
  "correction table de marque": "Korrektur am Schreibertisch",
  "Champion (optionnel)": "Champion (optional)",
  "Enregistrer date/lieu": "Datum/Ort speichern",
  "Enregistrer l'ordre": "Reihenfolge speichern",
  "Tableau final": "Endrunde",
  "Tour": "Runde",
  "🎬 Simulation": "🎬 Simulation",
  "🎲 Mode simulation": "🎲 Simulationsmodus",
  "🏆 Champion :": "🏆 Champion:",
  "ACTIF": "AKTIV",
  "ACTIF ✅": "AKTIV ✅",
  "inactif": "inaktiv",
  "· après la belle": "· nach der Belle",
  "· revanche prise !": "· Revanche geglückt!",
  "· revanche manquée": "· Revanche verpasst",
  "Le club": "Der Club",
  "Club introuvable": "Club nicht gefunden",
  "Club inconnu ici, tu regardes le club par défaut": "Club hier unbekannt, du siehst den Standard-Club",
  "Choisis ton club": "Wähle deinen Club",
  "Bienvenue sur la plateforme": "Willkommen auf der Plattform",
  "Plateforme": "Plattform",
  "Hub de la plateforme": "Hub der Plattform",
  "Choisis ton club, ouvre un tournoi en cours, retrouve un joueur.": "Wähle deinen Club, öffne ein laufendes Turnier, finde einen Spieler.",
  "Reprendre": "Fortsetzen",
  "Les tournois en cours et à venir": "Laufende und kommende Turniere",
  "Aucun tournoi en cours ou à venir.": "Kein laufendes oder kommendes Turnier.",
  "Joueur de la plateforme": "Spieler der Plattform",
  "Un pseudo": "Ein Nickname",
  "Rechercher un joueur": "Einen Spieler suchen",
  "Rechercher un joueur dans tous les clubs de la plateforme.": "Suche einen Spieler in allen Clubs der Plattform.",
  "Résultats": "Ergebnisse",
  "Aucun joueur trouvé.": "Kein Spieler gefunden.",
  "Un seul compte pour toute la plateforme : le même login dans tous les clubs.": "Ein Konto für die ganze Plattform: derselbe Login in allen Clubs.",
  "Bannière du club": "Club-Banner",
  "Bannière de l accueil": "Startseiten-Banner",
  "Retirer la bannière": "Banner entfernen",
  "Importer une bannière (PNG/JPG/SVG, photo jusqu à 8 Mo, réduite à 1600 px)": "Banner importieren (PNG/JPG/SVG, Foto bis 8 MB, auf 1600 px verkleinert)",
  "Photo affichée en tête de l accueil et de la page Le club pour tous les visiteurs.": "Foto oben auf der Startseite und der Club-Seite für alle Besucher sichtbar.",
  "Photo de fond de la TV": "TV-Hintergrundbild",
  "Retirer le fond de TV": "TV-Hintergrund entfernen",
  "Importer un fond de TV (PNG/JPG/SVG, photo jusqu à 8 Mo, réduite à 1280 px)": "TV-Hintergrund importieren (PNG/JPG/SVG, Foto bis 8 MB, auf 1280 px verkleinert)",
  "Photo de fond affichée derrière les scores de l écran TV (assombrie automatiquement).": "Hintergrundfoto hinter den Ergebnissen des TV-Bildschirms des Clubs (automatisch abgedunkelt).",
  "Page Le club": "Club-Seite",
  "Logo, bannière et textes de la page publique « Le club » (lien du menu).": "Logo, Banner und Texte der öffentlichen Seite « Der Club » (Menülink).",
  "Présentation du club (500 caractères max)": "Club-Vorstellung (max. 500 Zeichen)",
  "Contact (page Le club, 200 caractères max)": "Kontakt (Club-Seite, max. 200 Zeichen)",
  "Image refusée": "Bild abgelehnt",
  "Cause : l image réduite dépasse encore la taille maximum, choisis une image plus simple.": "Ursache: das verkleinerte Bild überschreitet immer noch die Maximalgröße, wähle ein einfacheres Bild.",
  "Icône du téléphone": "Telefonsymbol",
  "Le logo devient l app des téléphones (icône 192 px, effective aux prochaines installations).": "Das Logo wird zur Handy-App (192-Px-Symbol, wirksam bei künftigen Installationen).",
};
// remplacements dynamiques DE : meme ordre que les regex de I18N_DYN
const REPS_DYN_DE = [
  "Fehler $1",
  "Spielerseite von $1",
  "Anmeldung für das Turnier « $1 » zurückziehen?",
  "Spieler « $1 » löschen?",
  "« $1 » aus dem Verlauf löschen?",
  "« $1 » endgültig aus dem Verlauf löschen?",
  "Turnier « $1 » verwalten",
  "🕐 geplant gegen $1",
  "🕐 Spiel geplant gegen $1",
  "🟢 laufend gegen $1",
  "✅ Eingeschrieben (bezahlt)",
  "✅ Eingeschrieben (wartet auf Zahlung)",
  "Bei « $1 » als $2 einschreiben",
  "Turnierbaum mit $1",
  "Auslosung starten ($1 bezahlt)",
  "⏳ Startklar ($1)",
  "Aufgabe von $1?",
  "Spielstand von $1 (0-$2):",
  "Neuer Benutzername für « $1 » (mind. $2 Zeichen):",
  "Neues Passwort für « $1 » (mind. $2 Zeichen):",
  "Konto « $1 » löschen?\nDie verknüpften Spieler werden abgekoppelt (der Spielverlauf bleibt), Sitzungen und Push-Abonnements werden gelöscht.",
  "Gewonnene Frames: $1",
  "⚔️ Direktvergleich ($1 Gegner)",
  "⚔️ Direktvergleich ($1 Gegner)",
  "🎱 $1 gespielt",
  "🏆 $1 gewonnen",
  "Beginn: $1",
  "· Dauer: $1",
  "🏁 $1 gewinnt das Spiel",
  "🏆 $1 gewinnt das Spiel",
  "Der Spielstand würde $1 - $2.",
  "📍 Gehe zu Tisch Nr. $1",
  "Turnier-Verlauf ($1)",
  "Verlauf ($1 beendete Turniere)",
  "$1 Spieler erfasst",
  "$1 Anmeldung(en)",
  "$1 Einträge gelöscht",
  "Zurück zu $1",
  "Spiel Nr. $1 wieder öffnen? Das Ergebnis wird annulliert und die folgenden Spiele werden geleert.",
  "$1/$2 eingeschrieben · $3 bezahlt",
  "$1 max · $2 eingeschrieben · $3 bezahlt · $4 Tische",
  "$1/$2 Spiele gespielt",
  "$1 Tische erstellt · $2 frei",
  "$1 Spieler",
  "$1 eingeschrieben",
  "$1 bezahlt",
  "$1 frei",
  "DKO mit $1 Runden",
  "DKO mit $1 Runden + Finalbaum",
  "einfache Ausscheidung",
  "Spiele geändert: $1 · hinzugefügt: $2 · gelöscht: $3",
  "Ereignis Nr. $1 ($2) am $3",
  "Das aktive Turnier auf den Zustand dieses Ereignisses wiederherstellen?\n\n",
  "Tisch $1 (besetzt)",
  "⏳ Auslosung noch nicht durchgeführt: leere Turnierbaum-Struktur, die Plätze j1 bis j$1 werden nach der Auslosung von den Spielern eingenommen",
  "Simulation abgeschlossen: $1 Spiele gespielt. $2",
  "$1 $2/$3/$4 um $5:$6",
  "$1/$2/$3 um $4:$5",
  "Mit dem Benutzernamen « $1 » existiert bereits ein Konto.\n\nDiesen Spieler trotzdem einschreiben? Er wird mit diesem Konto verknüpft (einschließlich « du bist dran »- und Freundes-Benachrichtigungen).\n\nAndernfalls kann der Inhaber sich selbst über sein Konto einschreiben.",
  "$1 aus deinen Freunden entfernen?",
  "📨 Testbenachrichtigung gesendet ($1 Gerät(e))!",
  "🎱 Spiele ($1)",
  "⏱ Beginn $1",
  "⏱ durchschnittliche Dauer $1",
  "$1 um $2:$3",
  "$1 $2 um $3:$4",
  "$1 schlägt $2 $3-$4",
  "· Tisch $1",
  "· Turnier beendet für $1",
  "$1 gibt Forfait, $2 kommt in die nächste Runde",
  "🏆 $1 gewinnt das Turnier!",
  "Spannung: $1 und $2 sind beide einen Frame vom Sieg entfernt, am Tisch $3",
  "Spannung: $1 und $2 sind beide einen Frame vom Sieg entfernt",
  "gerade eben",
  "vor $1 Min.",
  "vor $1 Std.",
  "vor $1 T",
  "$1 setzt sich mit $3-$4 gegen $2 durch",
  "$1 überwindet $2 $3-$4",
  "$1 dominiert $2 mit $3-$4",
  "$1 schaltet $2 mit $3-$4 aus",

  "$1 übertrumpft $2 mit $3-$4",
  "$1 diktiert gegen $2 mit $3-$4 das Tempo",
  "$1 gibt auf, $2 kommt in die nächste Runde",
  "Forfait von $1, $2 kommt in die nächste Runde",
  "$1 wirft das Handtuch, $2 kommt in die nächste Runde",
  "Forfait von $1, $2 kommt ohne Spielen weiter",

  "$1 erscheint nicht, $2 kommt in die nächste Runde",
  "Forfait von $1: $2 zieht direkt in die nächste Runde",
  "🏆 $1 hebt die Trophäe!",
  "🏆 $1 holt sich den Titel!",
  "🏆 Ende der Spannung: $1 ist Champion!",
  "🏆 $1 hatte das letzte Wort: Der Titel gehört ihm!",

  "🏆 $1 geht in die Siegerliste des Clubs ein!",
  "🏆 $1 beherrscht das Turnier!",
  "Der Entscheidungsframe! $1 und $2 am Tisch $3",
  "Alles entscheidet sich im Decider zwischen $1 und $2 (Tisch $3)!",
  "Entscheidungsframe zwischen $1 und $2 (Tisch $3)!",
  "Alle aufstehen: $1 und $2 spielen den Entscheidungsframe an Tisch $3!",

  "Jetzt wird das Turnier entschieden: $1 und $2 in der Belle an Tisch $3!",
  "Letzter Frame für $1 und $2 am Tisch $3!",
  "Die Belle zwischen $1 und $2!",

  "Alles entscheidet sich im Decider zwischen $1 und $2!",
  "Entscheidungsframe zwischen $1 und $2!",
  "🔥 Revanche: $1 spielt gegen $2, eine Revanche zu holen!",
  "🔥 $1 spielt seine Revanche gegen $2!",
  "🔥 $1 versucht es erneut gegen $2!",
  "🔥 $1 will das Blatt gegen $2 wenden!",
  "🔥 $1 muss eine Lücke bei $2 finden!",

  "🔥 $1 hat mit $2 noch eine Rechnung offen!",
  "🔥 Dieses Match riecht nach Revanche: $1 fordert $2 heraus!",
  "🔥 Revanche: $1 und $2 treffen erneut aufeinander, komplett gleich!",
  "🔥 Stolz auf dem Spiel: $1 und $2 treffen sich wieder!",
  "🔥 $1 und $2 treffen wieder aufeinander, Bilanz perfekt ausbalanciert!",
  "🔥 Perfektes Unentschieden vor dieser Runde: $1 gegen $2!",

  "🔥 Alte Bekannte auf Augenhöhe: $1 und $2 treffen erneut aufeinander!",
  "🔥 Kein Vorsprung für beide: $1 und $2 schreiben ein neues Kapitel!",
  "$1 führt $2-$3",
  "· Dauer $1 Min.",
  "· Dauer $1 h $2",
  "Gesendet: « $1 », $2 KB, MIME-Typ « $3 ».",
];

;
// --- dictionnaires par langue (fr = source, en = I18N, es/it/de ajoutes) ---
const DICTS = { en: I18N, es: I18N_ES, it: I18N_IT, de: I18N_DE };
// memes regex dynamiques, remplacements par langue
const I18N_DYN_ALL = { en: I18N_DYN, es: I18N_DYN.map(([re], i) => [re, REPS_DYN_ES[i]]), it: I18N_DYN.map(([re], i) => [re, REPS_DYN_IT[i]]), de: I18N_DYN.map(([re], i) => [re, REPS_DYN_DE[i]]) };
function t(s) {
  if (LANG === 'fr' || typeof s !== 'string' || !s) return s;
  const d = DICTS[LANG] || I18N;
  if (d[s]) return d[s];
  const tr = s.trim();
  if (tr && tr !== s && d[tr]) return s.replace(tr, d[tr]);
  for (const [re, rep] of (I18N_DYN_ALL[LANG] || I18N_DYN)) if (re.test(s)) return s.replace(re, rep);
  return s;
}
// traduit le HTML statique au chargement : phrases completes, fragments texte, attributs
function traduireDomStatique(root) {
  if (LANG === 'fr' || !root) return;
  const d = DICTS[LANG] || I18N;
  const INLINE_OK = { B: 1, I: 1, EM: 1, STRONG: 1, SPAN: 1, SMALL: 1, CODE: 1, ABBR: 1, U: 1, BR: 1, SUB: 1, SUP: 1 };
  for (const e of root.querySelectorAll('p,li,h1,h2,h3,h4,th,td,label,dt,dd,legend,summary,figcaption')) {
    if (e.querySelector('a,button,input,select,textarea,img,svg,script')) continue;
    if (![...e.children].every(c => INLINE_OK[c.tagName])) continue;
    const cle = (e.textContent || '').trim();
    if (cle && d[cle]) e.textContent = d[cle];
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const noeuds = [];
  while (walker.nextNode()) noeuds.push(walker.currentNode);
  for (const n of noeuds) {
    const brut = n.nodeValue;
    const cle = brut.trim();
    if (cle && d[cle]) n.nodeValue = brut.replace(cle, () => d[cle]);
  }
  for (const e of root.querySelectorAll('[placeholder],[title],[aria-label],[alt]')) {
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
      const v = e.getAttribute ? e.getAttribute(a) : null;
      if (v) { const cle = v.trim(); if (cle && d[cle]) e.setAttribute(a, v.replace(cle, d[cle])); }
    }
  }
}
traduireDomStatique(document.body);
// alert/confirm natifs passes par t() (messages d'erreur client, confirmations)
if (LANG !== 'fr') {
  const _confirm = window.confirm, _alert = window.alert;
  window.confirm = (m) => _confirm(typeof m === 'string' ? t(m) : m);
  window.alert = (m) => _alert(typeof m === 'string' ? t(m) : m);
  const _prompt = window.prompt;
  window.prompt = (m, d) => _prompt(typeof m === 'string' ? t(m) : m, typeof d === 'string' ? t(d) : d);
}
if (LANG !== 'fr') { const tt = t(document.title.trim()); if (tt !== document.title.trim()) document.title = tt; }

// Thème clair/sombre : préférence locale (ebpc_theme), appliquée tôt dans <head> par un petit script inline anti-flash.
// La page TV reste toujours sombre (pas de script anti-flash là-bas).
function themeActuel() { try { return localStorage.getItem('ebpc_theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } }
function appliquerTheme(t) { try { if (t === 'light') document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme; } catch {} }
function basculerTheme() { const t = themeActuel() === 'light' ? 'dark' : 'light'; try { localStorage.setItem('ebpc_theme', t); } catch {} appliquerTheme(t); if (accentClubApplique) appliquerAccentClub(accentClubApplique); return t; } // 17j v2: le soft (lisibilité) dépend du thème -> on re-applique l accent du club

let compteCourant = null; // mémo du compte connecté (le broadcast SSE ne le renvoie pas)
// 17r. Étanchéité du contexte du club : un club mémorisé inconnu (404 « Club inconnu » : club supprimé,
// désactivé, ou inexistant sur CETTE application) déclenchait une bascule SILENCIEUSE vers le club par
// défaut (repli 17h v2) -> l utilisateur croyait être sur son club et voyait les données d un autre club
// (retour Sébastien 17r). Le repli reste (page jamais blanche, ex: club disparu après restauration)
// mais une bannière explicite s affiche : le contexte ne change JAMAIS à l insu de l utilisateur.
// Utilisée par api() ici ET par adminApi() dans admin-common.js.
let clubInconnuAvise17r = false; // une seule bannière par page (jamais de spray si plusieurs 404)
function aviserClubInconnu17r(slug) {
  if (clubInconnuAvise17r) return;
  clubInconnuAvise17r = true;
  try {
    if (document.getElementById('club-inconnu-17r')) return;
    const b17r = document.createElement('div');
    b17r.id = 'club-inconnu-17r';
    b17r.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483000;background:#a32a37;color:#fff;padding:10px 36px 10px 14px;font-weight:600;font-size:14px;line-height:1.45;text-align:center';
    const msg17r = (typeof t === 'function') ? t('Club inconnu ici, tu regardes le club par défaut') : 'Club inconnu ici, tu regardes le club par défaut';
    b17r.append(document.createTextNode(msg17r + ' : « ' + slug + ' »'));
    const f17r = document.createElement('button');
    f17r.textContent = '✖';
    f17r.setAttribute('aria-label', (typeof t === 'function') ? t('Fermer') : 'Fermer');
    f17r.style.cssText = 'position:absolute;top:8px;right:10px;background:none;border:none;color:#fff;font-size:16px;cursor:pointer';
    f17r.addEventListener('click', () => b17r.remove());
    b17r.append(f17r);
    (document.body || document.documentElement).append(b17r);
  } catch {}
}

async function api(path, opts = {}) {
  const appel17h = () => fetch(API + path, {
    headers: { 'Content-Type': 'application/json', 'X-Lang': LANG, ...clubHeaders(), ...(opts.headers || {}) },
    ...opts,
  });
  let res = await appel17h();
  if (res.status === 404) {
    const data404 = await res.json().catch(() => ({}));
    // club mémorisé disparu (club supprimé/désactivé, restauration d une base d origine différente, ex: prod importée
    // sur l app de test alors que le navigateur retenait un club de test) -> page blanche silencieuse
    // -> on efface le slug mémorisé et on rejoue l appel sur le club par défaut (17h v2: repli club par défaut)
    if (data404 && typeof data404.error === 'string' && data404.error.startsWith('Club inconnu') && clubHeaders()['X-Club']) {
      const slugPerdu17r = clubHeaders()['X-Club']; // 17r: le slug AVANT effacement, pour la bannière
      try { localStorage.removeItem(CLUB_KEY); } catch {}
      aviserClubInconnu17r(slugPerdu17r); // 17r: repli club par défaut conservé (page jamais blanche) mais PLUS JAMAIS silencieux
      res = await appel17h();
    } else {
      res = { ok: false, status: 404, json: async () => data404 };
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  if (data && typeof data.compte !== 'undefined') compteCourant = data.compte;
  return data;
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) e.setAttribute(k, (k === 'placeholder' || k === 'title' || k === 'aria-label' || k === 'alt') && typeof v === 'string' ? t(v) : (v === true ? '' : v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) { for (const cc of c) e.append(cc.nodeType ? cc : document.createTextNode(t(cc))); continue; }
    e.append(c.nodeType ? c : document.createTextNode(typeof c === 'string' ? t(c) : c));
  }
  return e;
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email || '—';
  const [local, domain] = email.split('@');
  const m = local.length <= 2 ? local[0] + '•' : local.slice(0, 2) + '•'.repeat(Math.min(local.length - 2, 6));
  return m + '@' + domain;
}

function badgeEtat(etat) {
  const labels = { prevu: 'Prévu', pret: 'Prêt', en_cours: 'En cours', termine: 'Terminé', forfait: 'Forfait' };
  return el('span', { class: `badge ${etat}` }, labels[etat] || etat);
}

function fmtDuree(s) {
  if (s == null) return null;
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m} min ${String(sec).padStart(2, '0')} s` : `${sec} s`;
}

// choix de langue persistant (ebpc_lang) + rechargement immediat ; appele par le selecteur FR/EN du bandeau
// persiste la langue cote client (localStorage) ET cote serveur (compte.lang) pour les notifications push ;
// attend la reponse du POST avant le reload, sinon la requete est annulee par le unload de la page
async function choisirLangue(l) {
  try { localStorage.setItem('ebpc_lang', l); } catch {}
  try { await api('/api/compte/preferences', { method: 'POST', body: JSON.stringify({ lang: l }) }); } catch {} // silencieux si non connecte (401)
  location.reload();
}

// menu deroulant reutilisable (burger navigation, burger compte, selecteur de langue) : dropdown + scrim dans le body,
// contenu reconstruit a chaque ouverture (entrees dynamiques), fermeture au clic exterieur / scrim / resize
function menuDeroulant(btn, remplir) {
  const drop = el('div', { class: 'nav-dropdown', role: 'menu' });
  const scrim = el('div', { class: 'nav-scrim' });
  document.body.appendChild(drop);
  document.body.appendChild(scrim);
  const fermer = () => { drop.classList.remove('open'); scrim.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (drop.classList.contains('open')) return fermer();
    drop.innerHTML = '';
    remplir(drop);
    // ouvrir d'abord (display flex) pour mesurer la largeur REELLE du menu, puis positionner sans flash (meme frame)
    drop.classList.add('open'); scrim.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
    // positionner le dropdown sous le bouton (fixed) -> PAS de scrollY/scrollX (sinon le menu part hors ecran quand on est scrolle)
    const r = btn.getBoundingClientRect();
    drop.style.top = (r.bottom + 6) + 'px';
    // bord droit du menu aligne sur le bord droit du bouton : le selecteur de langue etant colle au bord
    // droit de l'ecran, sa liste deroulante y reste accrochee ; sans jamais deborder a gauche (min 8px)
    const w = Math.min(Math.max(drop.offsetWidth, 220), window.innerWidth - 16);
    drop.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    // si le menu depasserait en bas du viewport, le limiter en hauteur (scroll interne)
    const maxH = window.innerHeight - r.bottom - 14;
    drop.style.maxHeight = Math.max(120, maxH) + 'px';
  });
  scrim.addEventListener('click', fermer);
  scrim.addEventListener('touchstart', fermer, { passive: true });
  drop.addEventListener('click', (e) => { if (e.target.closest('a')) fermer(); });
  document.addEventListener('click', (e) => { if (!btn.contains(e.target) && !drop.contains(e.target)) fermer(); });
  document.addEventListener('touchstart', (e) => { if (!btn.contains(e.target) && !drop.contains(e.target) && !scrim.contains(e.target)) fermer(); }, { passive: true });
  window.addEventListener('resize', fermer);
}

// 17v. Choisir un club de la plateforme : mémorise le slug (même mécanisme que ?club= du haut de ce
// fichier) puis recharge la page EN COURS dans le contexte du club choisi (paramètres utiles de l URL
// conservés, ex: ?id= d une fiche joueur, le club y est remplacé). Rechargement explicite : thème, état,
// SSE et liens internes (17s) repartent tous dans le contexte du club, aucune bascule à l insu de
// l utilisateur (17r), PWA par club inchangée (17t).
function ouvrirClub17v(slug) {
  try { localStorage.setItem(CLUB_KEY, slug); } catch {}
  try {
    const u17v = new URL(location.href);
    u17v.searchParams.delete('hub'); // 20b v2: le retour hub (?hub=1) ne survit pas au choix d un club
    u17v.searchParams.set('club', slug);
    location.href = u17v.pathname + u17v.search + u17v.hash;
  } catch { location.href = '/?club=' + encodeURIComponent(slug); }
}
function nav(active) {
  // liens « tournoi seul » (Tableau / TV / Mon tournoi) : masqués tant qu'aucun tournoi n'est ouvert.
  // null = réponse pas encore arrivée (on affiche par défaut), false = aucun tournoi actif.
  // le burger (re)remplit son menu à chaque ouverture -> le masquage est ré-évalué à chaque clic.
  let tournoiOuvert = null;
  api('/api/etat').then((s) => { tournoiOuvert = !!(s && s.actif); }).catch(() => { tournoiOuvert = true; });
  const links = [
    ['/', 'home', 'Accueil'],
    ['/tableau.html', 'tableau', 'Tableau', true],
    ['/tv.html', 'tv', 'TV', true],
    ['/suivi.html', 'joueur', 'Mon tournoi', true],
    ['/stats.html', 'stats', 'Stats'],
    ['/historique.html', 'hist', 'Historique'],
    ['/leclub.html', 'club', 'Le club'], // 17n: page publique du club (bannière, présentation, contact)
    ['/admin.html', 'admin', 'Table de marque'],
    ['/aide.html', 'aide', 'Aide'],
    ['/confidentialite.html', '', 'Confidentialité'],
  ];
  const btn = el('button', { class: 'nav-burger', type: 'button', 'aria-label': 'Menu', 'aria-expanded': 'false' }, '☰ Menu');
  menuDeroulant(btn, (drop) => { for (const [href, key, label, tournoiSeul] of links) { if (tournoiSeul && tournoiOuvert === false) continue; drop.append(el('a', { href, class: active === key ? 'active' : null, role: 'menuitem' }, label)); } });
  const wrap = el('div', { class: 'nav-menu' }, btn);
  // selecteur de langue a l extremite droite du bandeau (pousse par margin-left auto en CSS),
  // liste deroulante FR/EN/ES/IT/DE avec drapeaux (meme mecanique que les burgers),
  // bouton affichant la langue courante ; libelles en langue native (Francais / English / Espanol / Italiano / Deutsch)
  const LANGUES = [['fr','🇫🇷','Français'],['en','🇬🇧','English'],['es','🇪🇸','Español'],['it','🇮🇹','Italiano'],['de','🇩🇪','Deutsch']];
  const btnLang = el('button', { class: 'nav-lang', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Langue · Language' }, ({ fr: '🇫🇷 FR', en: '🇬🇧 EN', es: '🇪🇸 ES', it: '🇮🇹 IT', de: '🇩🇪 DE' })[LANG] || '🇫🇷 FR');
  menuDeroulant(btnLang, (drop) => {
    for (const [code, drapeau, nom] of LANGUES) {
      drop.append(el('a', { href: '#', role: 'menuitem', class: LANG === code ? 'active' : null, onclick: (e) => { e.preventDefault(); if (LANG !== code) choisirLangue(code); } }, `${drapeau} ${nom}`));
    }
  });
  // 22a. Le sélecteur discret du club (17v) est retiré du bandeau : il doublonnait le hub, qui liste
  // déjà les clubs (cartes cliquables -> ouvrirClub17v) ; le badge 17r affiche toujours le club
  // regardé, les liens 17s gardent le club dans l URL. ouvrirClub17v reste utilisé par le hub.
  // 19a. Sélecteur de tournoi dans le bandeau : affiché uniquement si le club OUVERT a PLUSIEURS tournois actifs
  // (mono-tournoi : rien ne change). Le bouton montre le tournoi affiché (le mémorisé sinon le plus récent),
  // le menu liste les actifs du club (GET /api/tournois public) ; choisir un tournoi mémorise son id (clé par
  // club : ebpc_tournoi_<slug>) et recharge la page, les pages état repassent alors par urlEtat19a()
  let tournoisNav19a = [];
  const btnTournoi19a = el('button', { class: 'nav-lang club-selecteur-17v', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Choisir le tournoi', style: 'display:none;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, 'Tournoi');
  menuDeroulant(btnTournoi19a, (drop) => {
    const choisi19a = tournoiChoisi19a();
    for (const t of tournoisNav19a) {
      drop.append(el('a', { href: '#', role: 'menuitem', class: t.id === choisi19a ? 'active' : null, onclick: (e) => { e.preventDefault(); if (t.id !== choisi19a) { try { localStorage.setItem(TOURNOI_SEL_KEY_19a(), String(t.id)); } catch {} location.reload(); } } }, `${t.nom}${t.statut === 'inscription' ? ' (inscriptions)' : ''}`));
    }
  });
  api('/api/tournois').then((r19a) => {
    tournoisNav19a = ((r19a && r19a.tournois) || []).filter((t) => t.statut === 'inscription' || t.statut === 'en_cours');
    if (tournoisNav19a.length < 2 || location.pathname.startsWith('/console.html')) return;
    // 19a: tournoi mémorisé terminé entre deux pages -> on l oublie (retour au plus récent, repli silencieux côté serveur)
    if (tournoiChoisi19a() != null && !tournoisNav19a.some((t) => t.id === tournoiChoisi19a())) { try { localStorage.removeItem(TOURNOI_SEL_KEY_19a()); } catch {} }
    const courant19a = tournoisNav19a.find((t) => t.id === tournoiChoisi19a()) || tournoisNav19a[0];
    btnTournoi19a.textContent = (courant19a.nom || '') + ' ▾';
    btnTournoi19a.style.display = '';
  }).catch(() => {});
  // burger compte : entrees dynamiques selon l etat de connexion et le role (admin ou joueur),
  // vers des pages dediees (parametres / amis / mes matchs) + fiche joueur ; admin : table de marque uniquement
  let compteNav = null, joueurIdNav = null;
  api('/api/compte/moi').then((r) => { compteNav = r && r.compte ? r.compte : null; joueurIdNav = r ? (r.joueur_id || null) : null; }).catch(() => {});
  const btnCompte = el('a', { href: '/compte.html', class: 'nav-login' + (active === 'compte' ? ' active' : ''), 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Mon compte' }, 'Compte');
  menuDeroulant(btnCompte, (drop) => {
    if (!compteNav) {
      drop.append(el('a', { href: '/compte.html#connexion', role: 'menuitem' }, 'Connexion'));
      drop.append(el('a', { href: '/compte.html#creer', role: 'menuitem' }, 'Créer un compte'));
      drop.append(el('a', { href: '/parametres.html', role: 'menuitem' }, 'Paramètres'));
      return;
    }
    drop.append(el('a', { href: '/parametres.html', role: 'menuitem' }, 'Paramètres'));
    drop.append(el('a', { href: '/amis.html', role: 'menuitem' }, 'Amis'));
    drop.append(el('a', { href: '/mes-matchs.html', role: 'menuitem' }, 'Mes matchs'));
    drop.append(el('a', { href: joueurIdNav ? '/joueur.html?id=' + joueurIdNav : '/compte.html', role: 'menuitem' }, 'Ma fiche joueur'));
    if (compteNav.role === 'admin' || compteNav.role === 'super_admin') drop.append(el('a', { href: '/admin.html', role: 'menuitem' }, 'Table de marque')); // 17i
    drop.append(el('a', { href: '#', role: 'menuitem', onclick: async (e) => { e.preventDefault(); if (!confirm('Se déconnecter ?')) return; try { await api('/api/compte/deconnexion', { method: 'POST' }); } catch {} location.href = '/'; } }, 'Se déconnecter'));
  });
  // 20b/22a. Retour au hub de la plateforme : petit logo bille 8 en haut à GAUCHE du bandeau (avant
  // le titre), à la place de l ancien gros bouton « 🏠 Plateforme » ; un clic ouvre /?hub=1 (l intercepteur
  // 17s n ajoute jamais de club à un lien ?hub= ; le hub n est pas une page de club). Ancre de marque
  // visible sur TOUTES les pages (depuis le hub, il recharge le hub), sauf la console super-admin.
  const btnPlateforme20b = el('button', { id: 'logo-plateforme-22a', type: 'button', class: 'logo-plateforme-22a', title: t('Hub de la plateforme') }, el('img', { src: '/favicon.svg', alt: '', width: '26', height: '26' }));
  btnPlateforme20b.addEventListener('click', () => { location.href = '/?hub=1'; });
  const titre22a = document.querySelector('header.top h1');
  if (titre22a && !document.getElementById('logo-plateforme-22a') && !location.pathname.startsWith('/console.html')) titre22a.before(btnPlateforme20b);

  return el('nav', {}, wrap, btnCompte, btnLang, btnTournoi19a); // 22a: sélecteur de club retiré, retour plateforme = logo en haut à gauche du bandeau
}

function codeMatch(m) {
  return `${String(m.bracket || '').toLowerCase()}${m.tour}-${String(m.position).padStart(3, '0')}`;
}

// libellés d'origine des slots manquants (ex: "gagnant wb1-001"), comme dans le bracket
function feederLabels(t, m) {
  // tableau virtuel (avant tirage) : les slots du tour 1 WB affichent j1, j2, ... jN
  if (m.virtuel && m.bracket === 'WB' && m.tour === 1) {
    return { lbl1: `j${2 * m.position - 1}`, lbl2: `j${2 * m.position}` };
  }
  const feeders = (t && t.matchs ? t.matchs : []).filter(x => x.suivant_id === m.id || x.perdant_id === m.id);
  const srcOf = (slot) => {
    const f = feeders.find(x => x.suivant_id === m.id && x.suivant_slot === slot) || feeders.find(x => x.perdant_id === m.id && x.perdant_slot === slot);
    return f ? (f.suivant_id === m.id ? 'gagnant' : 'perdant') + ' ' + codeMatch(f) : null;
  };
  return { lbl1: m.joueur1 ? null : srcOf(1), lbl2: m.joueur2 ? null : srcOf(2) };
}

function matchCard(m, opts = {}) {
  const j1g = m.gagnant_id && m.joueur1 && m.gagnant_id === m.joueur1.id;
  const j2g = m.gagnant_id && m.joueur2 && m.gagnant_id === m.joueur2.id;
  let lbl1 = opts.lbl1, lbl2 = opts.lbl2;
  if (opts.t && (lbl1 === undefined || lbl2 === undefined)) {
    const fl = feederLabels(opts.t, m);
    if (lbl1 === undefined) lbl1 = fl.lbl1;
    if (lbl2 === undefined) lbl2 = fl.lbl2;
  }
  const card = el('div', { class: 'match-card' + (m.etat === 'prevu' ? ' attente' : '') + (m.etat === 'en_cours' ? ' live' : '') + ((m.etat === 'termine' || m.etat === 'forfait') ? ' done' : '') + (opts.hit ? ' hit' : ''), 'data-match-id': m.id },
    el('div', { class: 'joueurs' },
      el('span', { class: 'p p1' + (j1g ? ' gagnant' : '') + (!m.joueur1 ? (lbl1 ? ' attente-j' : ' blanc') : '') }, m.joueur1 ? m.joueur1.pseudo : (lbl1 || 'blanc')),
      el('span', { class: 'score' }, `${m.score1} - ${m.score2}`),
      el('span', { class: 'p p2' + (j2g ? ' gagnant' : '') + (!m.joueur2 ? (lbl2 ? ' attente-j' : ' blanc') : '') }, m.joueur2 ? m.joueur2.pseudo : (lbl2 || 'blanc'))),
    el('div', { class: 'meta' },
      el('span', { class: 'code-match' }, codeMatch(m)),
      badgeEtat(m.etat),
      m.etat === 'en_cours' ? el('span', { class: 'live-dot' }, '● LIVE') : null,
      m.table != null ? el('span', { class: 'table-badge' }, `🎱 Table ${m.table}`) : null,
      el('span', {}, `race to ${m.manches}`),
      m.started_at ? el('span', {}, `⏱ début ${fmtHeureSql(m.started_at)}`) : null,
      m.casseur ? el('span', { class: 'chip', title: 'Casse la manche en cours' }, `⚪ casse`) : null,
      m.duree_s != null ? el('span', {}, `⏳ ${fmtDuree(m.duree_s)}`) : null,
      opts.extra || null));
  // match virtuel (tableau à vide avant tirage) : pure affichage, pas de navigation
  if (!m.virtuel) {
    card.addEventListener('click', () => {
      if (opts.onClick) { opts.onClick(m); return; }
      if (typeof hasAdminPin === 'function' && hasAdminPin() && typeof openMatchEditor === 'function') {
        openMatchEditor(m, () => { if (opts.onAdminChange) opts.onAdminChange(); });
      } else {
        location.href = matchUrl(m);
      }
    });
    card.style.cursor = 'pointer';
    if (typeof hasAdminPin === 'function' && hasAdminPin()) card.title = 'Clic = éditer (admin)';
  }
  return card;
}

function grouperParRound(matchs, rounds) {
  const byKey = {};
  for (const m of matchs) {
    const k = `${m.bracket}${m.tour}`.toLowerCase(); // clés de rounds en minuscules (wb1, lb2, f1...)
    (byKey[k] = byKey[k] || []).push(m);
  }
  return rounds
    .map(r => ({ round: r, matchs: (byKey[r.key] || []).sort((a, b) => a.position - b.position) }))
    .filter(g => g.matchs.length > 0);
}

function connecterSSE(onUpdate) {
  const refetch = async () => {
    try {
      const s = await api(urlEtat19a(), { pin: null }); // payload SSE léger -> re-fetch état complet (19a: tournoi choisi)
      // le broadcast global ne contient pas le compte de la session -> on le réinjecte
      if (s && !s.compte && compteCourant) s.compte = compteCourant;
      onUpdate(s);
    } catch {}
  };
  const src = new EventSource('/api/events');
  src.addEventListener('update', refetch);
  // reconnexion du flux (coupure réseau, sortie de veille): les événements émis pendant
  // la coupure ne sont pas rejoués -> on re-synchronise dès que le flux est réouvert
  src.addEventListener('open', refetch);
  // retour sur la page (onglet ravivé, écran déverrouillé, PWA sortie de l'arrière-plan):
  // les navigateurs suspendent EventSource en arrière-plan -> re-sync immédiate à l'affichage
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refetch(); });
  src.onerror = () => {};
  return src;
}

function confirmer(msg) { return window.confirm(msg); }

/* ===== Bracket visuel partagé (tableau.html actif + tournoi.html archivé) ===== */
let bracketTab = (typeof localStorage !== 'undefined' && localStorage.getItem('ebpc_bracket_tab')) || 'tout';
let bracketLinksOnlyTab = null; // onglet autorisé pour les liens (renseigné par renderBracket, anti lignes parasites)

function feederLabelBracket(t, src, kind) {
  const nom = src.joueur1 && src.joueur2 ? `${src.joueur1.pseudo}–${src.joueur2.pseudo}` : (src.joueur1 || src.joueur2 || {}).pseudo || '…';
  return `${kind === 'perdant' ? 'perdant' : 'vainqueur'} #${src.position} (${nom})`;
}

function renderBracket(container, t, opts = {}) {
  bracketLinksOnlyTab = opts.linksOnlyTab || null; // garde-fou global appliqué dans drawBracketLinks
  const rounds = t.rounds;
  const byKey = {};
  for (const m of t.matchs) {
    const k = m.bracket + m.tour;
    (byKey[k] = byKey[k] || []).push(m);
  }
  for (const k in byKey) byKey[k].sort((a, b) => a.position - b.position);
  const singleTab = bracketTab !== 'tout';
  // Loser bracket en miroir : le tour 1 est collé au WB (lecture du LB de droite à gauche)
  let ordered = [
    ...rounds.filter(r => r.bracket === 'LB').reverse(),
    ...rounds.filter(r => r.bracket === 'WB'),
    ...rounds.filter(r => r.bracket === 'F'),
  ];
  if (singleTab) ordered = rounds.filter(r => r.bracket === bracketTab); // onglet seul : tours dans l'ordre naturel
  let groups = ordered.map(r => ({ round: r, matchs: byKey[r.bracket + r.tour] || [] })).filter(g => g.matchs.length > 0);
  if (singleTab) groups = groups.filter(g => g.round.bracket === bracketTab);

  const hasLB = rounds.some(r => r.bracket === 'LB');
  const tabs = [['tout', 'Tout'], ['WB', 'WB'], ...(hasLB ? [['LB', 'LB']] : []), ['F', 'Phase finale']];
  const tabBar = el('div', { class: 'view-switch', style: 'margin-bottom:10px' },
    ...tabs.map(([k2, label]) => el('button', {
      class: bracketTab === k2 ? '' : 'secondary',
      onclick: () => { bracketTab = k2; try { localStorage.setItem('ebpc_bracket_tab', k2); } catch {} if (typeof render === 'function') render(); },
    }, label)));

  const wrap = el('div', { class: 'bracket-scroll' });
  const bracket = el('div', { class: 'bracket', id: 'bracket' });
  // VRAI élément SVG (createElementNS) : el('svg') créerait un élément HTML inconnu, les <path> ne rendraient jamais
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'bracket-svg');
  bracket.append(svg);
  const NODE_H = 84; // hauteur d'un nœud de match (carte resserrée)
  const GAP = 10;
  const SLOT_H = NODE_H + GAP; // 118 : hauteur d'un slot de base
  // Onglet "tout" : escalier global (WB resserré au centre, LB en miroir, F compact).
  // Onglet seul (WB/LB/F) : escalier compact par bracket, tours dans l'ordre naturel.
  const levelOf = (r) => singleTab ? r.tour - 1
    : r.bracket === 'WB' ? r.tour - 1
    : r.bracket === 'LB' ? r.tour
    : r.tour - 1;
  let prevNb = 0, prevStep = 1;
  for (const g of groups) {
    const colCls = g.round.bracket === 'LB' ? 'lb' : g.round.bracket === 'F' ? 'finale' : 'wb';
    const col = el('div', { class: `bracket-col ${colCls}`, id: 'col-' + g.round.bracket + g.round.tour }, el('h3', {}, g.round.label + ' · race to ' + g.round.manches));
    // onglet seul : pas d'escalier imposé, le pas suit les vrais effectifs (ex. LB1=4, LB2=4 -> pas identique, pas d'escalier)
    const step = singleTab
      ? (prevNb ? Math.max(1, Math.round(prevStep * prevNb / g.matchs.length)) : 1)
      : Math.pow(2, levelOf(g.round));
    prevNb = g.matchs.length; prevStep = step;
    const lastTop = 40 + (g.matchs.length - 1) * step * SLOT_H + (step - 1) * SLOT_H / 2;
    col.style.height = (lastTop + NODE_H + 24) + 'px';
    col.style.justifyContent = 'flex-start';
    for (const m of g.matchs) {
      // escalier : le match #p est centré verticalement entre ses 2 parents (#2p-1 et #2p du niveau -1)
      const top = 40 + (m.position - 1) * step * SLOT_H + (step - 1) * SLOT_H / 2;
      const win1 = m.gagnant_id && m.joueur1 && m.gagnant_id === m.joueur1.id;
      const win2 = m.gagnant_id && m.joueur2 && m.gagnant_id === m.joueur2.id;
      const enAttente = m.etat === 'prevu';
      // pour un match en attente, la place du joueur manquant affiche son match d'origine
      const feeders = t.matchs.filter(x => x.suivant_id === m.id || x.perdant_id === m.id);
      const srcOf = (slot) => {
        const f = feeders.find(x => x.suivant_id === m.id && x.suivant_slot === slot) || feeders.find(x => x.perdant_id === m.id && x.perdant_slot === slot);
        if (!f) return 'blanc';
        const kind = f.suivant_id === m.id ? 'gagnant' : 'perdant';
        return kind + ' ' + codeMatch(f); // max 15 caractères (ex: "gagnant wb1-001")
      };
      // tableau virtuel (avant tirage) : slots du tour 1 WB = j1, j2, ... jN
      const virtuelWB1 = m.virtuel && m.bracket === 'WB' && m.tour === 1;
      const lbl1 = m.joueur1 ? m.joueur1.pseudo : (virtuelWB1 ? `j${2 * m.position - 1}` : srcOf(1));
      const lbl2 = m.joueur2 ? m.joueur2.pseudo : (virtuelWB1 ? `j${2 * m.position}` : srcOf(2));
      const node = el('div', {
        class: 'node' + (m.etat === 'en_cours' ? ' live' : '') + ((m.etat === 'termine' || m.etat === 'forfait') ? ' done' : '') + (enAttente ? ' attente' : ''),
        'data-id': m.id,
      },
        el('div', { class: 'nj' + (win1 ? ' win' : '') + (!m.joueur1 ? (lbl1 === 'blanc' ? ' blanc-j' : ' attente-j') : '') },
          el('span', {}, lbl1), el('span', { class: 'sc' }, String(m.score1))),
        el('div', { class: 'nj' + (win2 ? ' win' : '') + (!m.joueur2 ? (lbl2 === 'blanc' ? ' blanc-j' : ' attente-j') : '') },
          el('span', {}, lbl2), el('span', { class: 'sc' }, String(m.score2))),
        el('div', { class: 'meta' },
          el('span', { class: 'code-match' }, codeMatch(m)),
          enAttente ? el('span', { class: 'attente-tag' }, '⏳ match attendu') : null,
          m.etat === 'en_cours' ? el('span', { class: 'live-dot' }, '● LIVE') : null,
          (m.etat === 'termine' || m.etat === 'forfait') ? badgeEtat(m.etat) : null,
          m.table != null ? el('span', { class: 'table-badge' }, '🎱 Table ' + m.table) : null,
          m.duree_s != null ? el('span', {}, '⏳ ' + fmtDuree(m.duree_s)) : null));
      if (!opts.readonly && !m.virtuel) {
        node.addEventListener('click', () => {
          if (typeof hasAdminPin === 'function' && hasAdminPin() && typeof openMatchEditor === 'function') {
            openMatchEditor(m, () => { if (opts.onAdminChange) opts.onAdminChange(); });
          } else {
            location.href = matchUrl(m);
          }
        });
        node.style.cursor = 'pointer';
        if (typeof hasAdminPin === 'function' && hasAdminPin()) node.title = 'Clic = éditer (admin)';
      }
      node.style.position = 'absolute';
      node.style.top = top + 'px';
      node.style.left = '0';
      node.style.right = '0';
      col.append(node);
    }
    bracket.append(col);
  }
  wrap.append(bracket);
  container.append(tabBar);
  container.append(wrap);
  if (opts.drawLinks !== false) {
    // redraws robustes (iOS charge lentement, layout tardif)
    // liens uniquement sur l'onglet demandé (ex. 'F') : ailleurs, on ne dessine rien
    const redraw = () => {
      if (opts.linksOnlyTab && bracketTab !== opts.linksOnlyTab) { svg.innerHTML = ''; return; }
      drawBracketLinks(t);
    };
    requestAnimationFrame(redraw);
    [60, 300, 800, 1500].forEach(ms => setTimeout(redraw, ms));
    window.addEventListener('load', redraw, { once: true });
    const sc = container.querySelector('.bracket-scroll') || container;
    sc.addEventListener('scroll', redraw, { passive: true });
  }
}

function drawBracketLinks(t) {
  const bracket = document.getElementById('bracket');
  const svg = document.getElementById('bracket-svg');
  if (!bracket || !svg || !t) return;
  // appels directs (resize, etc.) : jamais de liens hors de l onglet autorisé par renderBracket
  if (bracketLinksOnlyTab && bracketTab !== bracketLinksOnlyTab) { svg.innerHTML = ''; return; }
  const rect = bracket.getBoundingClientRect();
  // Pas de viewBox : 1 unité SVG = 1 px CSS, pour que les liens collent exactement aux nœuds
  svg.setAttribute('width', Math.ceil(rect.width));
  svg.setAttribute('height', Math.ceil(rect.height));
  svg.removeAttribute('viewBox');
  svg.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  // flèche pour les bouts de lien (onglets) : context-stroke = couleur du trait
  const defs = document.createElementNS(ns, 'defs');
  defs.innerHTML = '<marker id="pcb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker>';
  svg.append(defs);
  const drawPath = (d, cls, marker) => {
    // trait fin coloré; halo (gros trait translucide) uniquement en live, sinon ça fait des "pâtés" quand les liens convergent
    for (const haloMode of (/\blive\b/.test(cls) ? [true, false] : [false])) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', haloMode ? (cls ? cls + ' halo' : 'halo') : (cls || ''));
      if (marker) p.setAttribute(marker, 'url(#pcb-arrow)');
      svg.append(p);
    }
  };
  for (const m of t.matchs) {
    for (const targetId of [m.suivant_id, m.perdant_id]) {
      if (!targetId) continue;
      const a = bracket.querySelector(`[data-id="${m.id}"]`);
      const b = bracket.querySelector(`[data-id="${targetId}"]`);
      const cible = t.matchs.find(x => x.id === targetId);
      let cls = cible ? 'to-' + cible.bracket.toLowerCase() : '';
      if (m.etat === 'en_cours') cls += ' live';
      else if (m.etat === 'termine' || m.etat === 'forfait') cls += ' done';
      else if (m.etat === 'prevu') cls += ' attente';
      if (a && b) {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const x1 = ra.right - rect.left, y1 = ra.top + ra.height / 2 - rect.top;
        const x2 = rb.left - rect.left, y2 = rb.top + rb.height / 2 - rect.top;
        const mx = (x1 + x2) / 2;
        // lien en coude (orthogonal) : plus lisible qu'une courbe pour relier les cases
        drawPath(`M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`, cls);
      } else if (a) {
        // cible dans un onglet masqué : bout de lien vers la droite, avec flèche
        const ra = a.getBoundingClientRect();
        const x1 = ra.right - rect.left, y1 = ra.top + ra.height / 2 - rect.top;
        drawPath(`M ${x1} ${y1} H ${x1 + 46}`, cls + ' stub', 'marker-end');
      }
      // pas de bout de lien à gauche (source masquée) : sinon les flèches entrantes s'empilent en artefact sur le bord gauche
    }
  }
}

function renderStatsPanel(stats, titre = '📊 Statistiques', topN = 10) {
  if (!stats) return null;
  const r = stats.resume;
  const panels = [];
  panels.push(el('div', { class: 'panel' },
    el('h2', {}, titre),
    el('div', { class: 'row' },
      el('span', { class: 'chip' }, `${r.joues}/${r.total} matchs joués`),
      r.restants > 0 ? el('span', { class: 'chip' }, `${r.restants} restants`) : null,
      r.duree_moyenne_s != null ? el('span', { class: 'chip' }, `⏱ durée moyenne ${fmtDuree(r.duree_moyenne_s)}`) : null,
      r.plus_rapide ? el('span', { class: 'chip' }, `⚡ plus rapide ${fmtDuree(r.plus_rapide.d)} (${r.plus_rapide.gagnant})`) : null,
      r.plus_long ? el('span', { class: 'chip' }, `🐢 plus long ${fmtDuree(r.plus_long.d)} (${r.plus_long.gagnant})`) : null,
      r.dernier_gagnant ? el('span', { class: 'chip' }, `🔥 dernier vainqueur : ${r.dernier_gagnant}`) : null)));
  const top = stats.classement.filter(p => p.joues > 0).slice(0, topN);
  const all = stats.classement.filter(p => p.joues > 0); // pour le rang avec ex-aequo
  const rang = (p) => 1 + all.filter(q => (q.points || 0) > (p.points || 0)).length;
  if (top.length > 0) {
    panels.push(el('div', { class: 'panel' },
      el('h2', {}, '🏅 Classement'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'audit' },
        el('tr', {}, el('th', {}, '#'), el('th', {}, 'Joueur'), el('th', {}, 'Joués'), el('th', {}, 'Gagnés'), el('th', {}, 'Perdus'), el('th', {}, '%'), el('th', {}, '⭐ Pts'), el('th', {}, 'Série')),
        ...top.map((p) => el('tr', {},
          el('td', {}, String(rang(p))),
          el('td', { style: 'font-weight:700' }, p.pseudo),
          el('td', {}, String(p.joues)), el('td', {}, String(p.gagnes)), el('td', {}, String(p.perdus)),
          el('td', {}, `${p.pct} %`),
          el('td', { style: 'font-weight:800;color:var(--gold)' }, String(p.points || 0)),
          el('td', {}, p.serie > 0 ? `🔥 ${p.serie}V` : p.serie < 0 ? `${-p.serie}D` : '—')))))));
  }
  return panels;
}

// Convertit une date SQL stockée en UTC ("YYYY-MM-DD HH:MM:SS") en heure locale navigateur
function dateSqlUtc(utc) { return new Date(String(utc).replace(' ', 'T') + 'Z'); }
function fmtHeureSql(utc) {
  if (!utc) return '';
  const d = dateSqlUtc(utc);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}h${p(d.getMinutes())}`;
}
function fmtDateHeureSql(utc) {
  if (!utc) return '';
  const d = dateSqlUtc(utc);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}h${p(d.getMinutes())}`;
}

function fmtDateHeure(dh) {
  if (!dh) return '';
  const d = new Date(dh.replace(' ', 'T')); // heure telle que saisie, AUCUN décalage horaire
  const p = n => String(n).padStart(2, '0');
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  return `${t(jours[d.getDay()])} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}h${p(d.getMinutes())}`;
}

/* ===== Édition admin inline d'un match (depuis le tableau quand le PIN est mémorisé) ===== */
// URL de la card match en propageant la page courante (retour contextuel depuis match.html)
function matchUrl(m, extra = '') {
  const ret = encodeURIComponent(location.pathname + location.search);
  const param17s = clubParam17s(); // 17s: le club courant dans l URL de la card
  return `/match.html?id=${m.id}${extra ? '&' + extra : ''}${param17s ? '&' + param17s : ''}&retour=${ret}`;
}

function hasAdminPin() {
  return !!(localStorage.getItem('ebpc_admin_pin') || '');
}

async function adminCall(path, opts = {}) {
  const pin = localStorage.getItem('ebpc_admin_pin') || '';
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(typeof LANG !== 'undefined' && LANG && LANG !== 'fr' ? { 'X-Lang': LANG } : {}), ...(pin ? { 'X-Admin-Pin': pin } : {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { localStorage.removeItem('ebpc_admin_pin'); throw new Error('PIN invalide — reconnecte-toi dans l\'admin'); }
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function openMatchEditor(m, onDone) {
  closeMatchEditor();
  const overlay = el('div', { id: 'match-editor', style: 'position:fixed;inset:0;z-index:100;background:rgba(5,5,8,.8);display:flex;align-items:center;justify-content:center;padding:16px' });
  const j1 = m.joueur1 ? m.joueur1.pseudo : '—';
  const j2 = m.joueur2 ? m.joueur2.pseudo : '—';
  const s1 = el('input', { type: 'number', min: 0, max: m.manches, value: m.score1, style: 'width:70px;text-align:center;font-size:22px;font-weight:800' });
  const s2 = el('input', { type: 'number', min: 0, max: m.manches, value: m.score2, style: 'width:70px;text-align:center;font-size:22px;font-weight:800' });
  const man = el('select', { style: 'width:auto' }, [2, 3, 5, 7].map(n => el('option', { value: n, ...(n === m.manches ? { selected: '' } : {}) }, `race to ${n}`)));
  const motif = el('input', { placeholder: 'Motif (optionnel)', maxlength: 80, style: 'width:100%' });
  const msg = el('div', { class: 'msg err', style: 'display:none' });

  const btn = (label, cls, fn) => el('button', { class: cls, onclick: async () => {
    msg.style.display = 'none';
    try { await fn(); closeMatchEditor(); if (onDone) onDone(); }
    catch (e) { msg.textContent = e.message; msg.style.display = 'block'; }
  } }, label);

  const actions = [];
  if (m.etat === 'pret' || m.etat === 'prevu') {
    actions.push(btn('▶ Lancer', '', () => adminCall(`/api/admin/match/${m.id}/lancer`, { method: 'POST', body: '{}' })));
  }
  actions.push(btn('💾 Enregistrer le score', '', () => adminCall(`/api/admin/match/${m.id}/correction`, {
    method: 'POST', body: JSON.stringify({ score1: Number(s1.value), score2: Number(s2.value), manches: Number(man.value), motif: motif.value })
  })));
  if (m.etat === 'termine' || m.etat === 'forfait') {
    actions.push(btn('🔓 Rouvrir', 'secondary', () => adminCall(`/api/admin/match/${m.id}/rouvrir`, { method: 'POST', body: '{}' })));
  } else if (m.joueur1 && m.joueur2) {
    actions.push(btn(`${j1} forfait`, 'danger', () => adminCall(`/api/admin/match/${m.id}/forfait`, { method: 'POST', body: JSON.stringify({ joueur_id: m.joueur1.id }) })));
    actions.push(btn(`${j2} forfait`, 'danger', () => adminCall(`/api/admin/match/${m.id}/forfait`, { method: 'POST', body: JSON.stringify({ joueur_id: m.joueur2.id }) })));
  }

  overlay.append(el('div', { class: 'panel', style: 'max-width:460px;width:100%' },
    el('h2', {}, `✏️ Match #${m.position}`),
    el('p', { class: 'muted small' }, `${j1}  vs  ${j2} · ${badgeEtat(m.etat)}${m.table != null ? ' · 🎱 Table ' + m.table : ''}`),
    el('div', { style: 'display:flex;align-items:center;justify-content:center;gap:12px;margin:14px 0' },
      el('div', { style: 'font-weight:800;font-size:18px;max-width:130px;overflow:hidden;text-overflow:ellipsis' }, j1), s1,
      el('span', { class: 'muted', style: 'font-weight:800' }, '–'), s2,
      el('div', { style: 'font-weight:800;font-size:18px;max-width:130px;overflow:hidden;text-overflow:ellipsis' }, j2)),
    el('div', { class: 'row', style: 'justify-content:center' }, man, motif),
    msg,
    el('div', { class: 'actions', style: 'display:flex;flex-direction:column;gap:8px;margin-top:12px' }, ...actions),
    el('div', { style: 'margin-top:10px' }, el('button', { class: 'secondary', style: 'width:100%', onclick: closeMatchEditor }, 'Fermer'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMatchEditor(); });
  document.body.append(overlay);
}

function closeMatchEditor() {
  const e = document.getElementById('match-editor');
  if (e) e.remove();
}

// 17j: appelé ici, en fin de fichier: LANG et les autres const sont initialisés (voir TDZ ci-dessus)
rafraichirThemeClub();

# 🗺️ Roadmap / idées — EBPC Tournoi Billard

**Objectif final : transformer l'app en produit** (multi-club, invitations, compte joueur valorisé…) — **cap confirmé : tout centralisé, séparation logique** : une seule plateforme, chaque club / discipline / tournoi isolé logiquement (ses données, son PIN, ses comptes, son vocabulaire), multi-clubs et multi-tournois simultanés, super admin plateforme, KPI d'usage pour piloter.
Liste des fonctionnalités et améliorations identifiées, triées par thème. ✅ = fait, 🚧 = en cours, ⬜ = à faire.

L'estimation est en effort relatif (S < 1 j, M ~ 1-2 j, L > 2 j ou chantier structurant).

---

## 🔒 Sécurité / robustesse

| # | Idée | Effort | Statut |
|---|---|---|---|
| 1 | **Anti brute-force PIN admin** : fenêtre glissante d'échecs par IP + lockout temporaire (même le bon code refusé pendant le lockout, 429). Env : `PIN_MAX_ESSAIS` (10), `PIN_FENETRE_MS` (10 min), `PIN_BLOCAGE_MS` (10 min). S'applique à `X-Admin-Pin` **et** `confirm_pin`. | S | ✅ fait |
| 2 | **Session admin à durée limitée** : bouton 🔒 Verrouiller + expiration du PIN mémorisé après 8 h (`ADMIN_SESSION_MS`, `ebpc_admin_pin_since`) | S | ✅ fait |
| 3 | **Export / import JSON du tournoi** : `GET /api/admin/tournoi/export` (téléchargement) + `POST /api/admin/tournoi/import` (remap des ids en 2 passes, FK checkées, `replace=true` + confirm_pin si tournoi actif) — boutons 💾 dans la table de marque | M | ✅ fait |
| 4 | Rate-limit côté comptes (`insc:`/`conn:`/`oubli:`) keyé sur `x-forwarded-for` via `ipClient(req)` (derrière Fly, `req.ip` = IP du proxy sinon tout le monde partage la même clé) | S | ✅ fait |

## 👥 Côté joueurs

| # | Idée | Effort | Statut |
|---|---|---|---|
| 5 | **Notif push « ton prochain match arrive »** (quand le match précédent de ton futur adversaire se termine, avec table) | S-M | ✅ fait (17p) |
| 6 | **Rôle « arbitre » sur la card match** : lien secret / mini-PIN permettant de saisir les scores à la place d'un joueur (téléphone en panne) | M | ⬜ |
| 7 | **Shot clock / minuteur par manche** affiché card + TV (anti-jeu lent) — timestamp par manche dans `match_event.detail` | M | ⬜ |
| 8 | **Liste d'attente à l'inscription** : au-delà de N inscrits, file d'attente, promotion auto à la désinscription | M | ⬜ |
| 9 | **Classement ELO all-time** par compte (victoire contre un fort rapporte plus) | M | ⬜ |
| 10 | **Head-to-head entre 2 joueurs sur la fiche joueur** : bilan V/D par adversaire, agrégé par personne (compte/pseudo), dernier duel, tableau plié à 5 + bouton « Tout voir », adversaire cliquable (`h2h` dans `GET /api/joueur/:id/historique`) | S | ✅ fait |

## 📺 Salle / TV / affichage

| # | Idée | Effort | Statut |
|---|---|---|---|
| 11 | **Replay manche par manche** d'un match terminé (timeline rejouant les `match_event` immuables) sur card/TV | M | ⬜ |
| 12 | **QR code par match** (en plus du QR tournoi) sur TV/cards → saisie directe depuis la table | S | ⬜ |
| 13 | **Affiche de tournoi générée** (SVG/PNG : nom, date, bracket, QR) partageable réseaux sociaux | M | ⬜ |
| 14 | **Chat léger par match** (SSE) ou bandeau admin visible sur la TV (« demi-finale dans 10 min ») | M | ⬜ |
| 15 | Stats TV avancées : temps moyen par manche, match le plus serré, run-outs en cours | S | ⬜ |
| 16 | Thème clair / personnalisation club : thème clair/sombre (interrupteur `/parametres.html`, cache anti-flash) + accent et logo du club réglés par l admin (17j/17k, page dédiée 17l), appliqués sur l accueil et toutes les pages pour tous les visiteurs ; page TV volontairement exclue (toujours sombre, pensée grands écrans) | M | ✅ fait |

## 🏆 Compétition (structurant)

| # | Idée | Effort | Statut |
|---|---|---|---|
| 17 | **Phase de poules (round-robin) puis KO** : nouveau bracket 'P' + points par poule dans `bracket.js` | L | ⬜ |
| 18 | **Handicap** : X manches d'avance pour un joueur (colonne `joueur.handicap`, score de départ) | S | ⬜ |
| 19 | **Plusieurs tournois actifs simultanés** (ex. blackball + ultimate le même soir) : `tournoi_id` dans le flux SSE + sélecteur de tournoi dans le header (`tournoiActif()` appelé partout → refactor) | L | ⬜ |
| 20 | **Multi-club / multi-tenant** : plusieurs clubs sur une instance (sous-domaine ou préfixe), chacun son PIN et sa BDD logique — **le chantier « produit »**. 🟡 étapes 1-4 faites : table `club` + `club_id` backfillé, `req.club` (X-Club/?club=), routes scopées + isolation cross-club (404), fiches joueurs étanches par club (idsMemeJoueur club: stats/matchs/historique/h2h ne voient que le club courant), gestion des comptes cloisonnée (liste/pseudo/mdp/suppression limités aux comptes du club, rôle global super-admin uniquement), `POST /api/admin/club`, push scopé ; **étape 3 : PIN par club + réglages via `PUT /api/admin/club` (nom / PIN 4-8 chiffres confirmé / actif, garde super-admin 403), `GET /api/admin/clubs`, clubs inactifs hors résolution (404)** ; **étape 4 : `compte_club`/role_club** (rôles admin de club et operateur par session, attribution/retrait super-admin, `role_club` dans moi) + **UI admin des clubs `/clubs.html`** (création, réglages, rôles, lien accueil admin **réservé au super-admin** : `requireSuperAdmin` 403 pour un compte de club, `GET /api/admin/super` conditionne le bouton, `DELETE /api/admin/club` + bouton Supprimer : refus 409 si tournois rattachés, club par défaut protégé). Reste : sous-domaines, multi-tournois actifs par club | L | 🟡 1-4 faits |

## 🧪 Table de marque / admin

| # | Idée | Effort | Statut |
|---|---|---|---|
| 21 | **Filtre / recherche dans le journal d'audit** : `GET /api/admin/audit?q=…&action=…` + champs de filtre dans la page journal (Entrée pour valider) | S | ✅ fait |
| 22 | **Diff avant rollback** : `GET /api/admin/tournoi/rollback/diff?audit_id=…` (resume: matchs modifiés/ajoutés/supprimés, joueurs, statut, champion + exemples) affiché dans la confirmation avant le code PIN | M | ✅ fait |
| 23 | **Import CSV de joueurs + invitations mail** avec lien magique de connexion (Resend déjà branché ; rattachement auto au pseudo déjà en place) | M | ⬜ |
| 24 | Export PDF/CSV du tournoi (classement, matchs, stats) pour l'affiche officielle | S-M | ⬜ |

## 🌐 Produit / divers

| # | Idée | Effort | Statut |
|---|---|---|---|
| 25 | Notifications email (Resend) en complément du push : récap, invitation tournoi | M | ⬜ |
| 26 | Webhook / API publique en lecture seule (clé API) pour un site club externe | M | ⬜ |
| 27 | i18n : **5 langues livrées** (FR + EN/ES/IT/DE), déjà au-delà du « EN au moins » initial : burger 🌐 langue, dictionnaires des 4 langues + règles dynamiques du fil, pages table de marque / compte / apparence, payloads push par destinataire (`compte.lang`) | M | ✅ fait |
| 28 | Accessibilité : contraste, taille de police réglable, navigation clavier | S-M | ⬜ |
| 29 | PWA offline : la card match consultable sans réseau (vérifier ce que cache `sw.js`) | S-M | ⬜ |
| 30 | **Rôles compte (`user`/`admin`)** : session admin = accès `/api/admin/*` sans PIN + exempte de `confirm_pin` sur les destructifs (mais modale front demandant de saisir `SUPPRIMER`) ; PIN conservé en fallback ; bootstrap 1er admin via `ADMIN_EMAIL`/`ADMIN_PASSWORD`, promotion via `POST /api/admin/compte/:id/role` ; pages admin sans PIN si session admin | M | ✅ fait |
| 31 | **Rapport d'usage par tournoi (KPI joueurs)** : taux d'adoption (joueurs inscrits ayant ouvert l'appli), répartition des pages consultées (Mon tournoi / fil / tableau), persistance après élimination, réactivité post-saisie, santé d'usage (temps de chargement médian, taux d'erreurs) ; mesure serveur agrégée, rapport généré par tournoi, sans cookie ni tracker | M | ⬜ |

## 🏗️ Environnements / mise en production

| # | Idée | Effort | Statut |
|---|---|---|---|
| 32 | **App de test `ebpc-tournoi-billard-test` déployée automatiquement à chaque push sur la branche `staging`** (après CI verte) : `fly.test.toml` + job `deploy-test`, volume `tournoi_data` séparé (restaurable depuis un snapshot prod), secrets propres, PIN différent ; notice et saut tant que `FLY_TEST_TOKEN` ou l'app manquent | S-M | ✅ fait |
| 33 | **Flux à deux branches** : `staging` → app de test (auto via CI), `main` → prod (auto via l'intégration GitHub de Fly, conservée) ; mise en prod = fusion `staging` → `main` une fois validé sur le test ; workflow manuel « Déployer prod » conservé en plan B ; voir `docs/GUIDE_DEPLOY.md` | S | ✅ fait |
| 38 | **Sauvegarde / restauration de TOUTE la base depuis l'admin** : `GET /api/admin/base/export` télécharge un JSON complet (toutes les tables, ids exacts), `POST /api/admin/base/import` restaure à l'identique dans une transaction intégrale (FK différées, rollback si erreur) ; réservé au super-admin (403 pour un code de club) ; panneau 💾 dans `/admin-data.html` — complément des snapshots de volume Fly, voir `docs/GUIDE_ADMIN.md` | S | ✅ fait |
| 39 | **Sauvegarde / restauration des données du club (17e)** : `GET /api/admin/base/export-club` + `POST /api/admin/base/import-club` : chaque club sauvegarde et restaure SES données avec SON code de club (8 tables du périmètre club, jamais les comptes/emails/sessions de la plateforme) ; la restauration ne touche jamais les autres clubs (400 si origine différente, table hors périmètre, référence cassée ou ids divergents) ; panneau 💾 club dans `/admin-data.html`, panneau base complète réservé au super-admin | M | ✅ fait |
| 40 | **Comptes cloisonnés par club (17f)** : chaque club a son propre espace de comptes, isolation stricte : `compte.club_id` NOT NULL + unicité du pseudo ET de l email PAR club (`UNIQUE (club_id, pseudo)`, `UNIQUE (club_id, email)`), migration auto au boot (comptes existants rattachés au club par défaut) ; le club est figé à la création (jamais de liaison implicite à la connexion : 401 cross-club) ; inscription/connexion/oubli/amis/recherche scopés club ; la liste des comptes au code PIN d un club ne montre que son club (super-admin voit tout) ; 409 « Ton compte appartient à un autre club » sur inscription cross-club | M | ✅ fait |
| 41 | **Promotion admin du club depuis la table de marque (17g)** : le code PIN du club suffit pour gérer les rôles de SON club (nommer un admin/opérateur, y compris son propre compte une fois connecté) ; depuis le club, seuls les comptes DU club sont promouvables (404 sinon, isolation 17f étendue), le super-admin garde le cross-club (staff multi-club) ; la table de marque affiche le rôle club (chips 👑/🛠) et un sélecteur par compte (`peut_gerer_roles`) ; l opérateur reste exclu de la gestion des rôles ; retrait confirmé (confirm_pin) sauf session admin du club | S | ✅ fait |
| 42 | **Tenant principal cloisonné (17h)** : la liste des comptes est TOUJOURS scopée au club du contexte, même pour le super-admin (le tenant principal ne voit plus les comptes des autres clubs) ; la vue « tous les clubs » devient explicite : `GET /api/admin/comptes?tous=1` réservé au super-admin (club d origine `club_slug` + rôles `roles_clubs`), panneau « Comptes de la plateforme » dans la page Clubs ; un code de club ne peut pas forcer la vue globale | S | ✅ fait |
| 43 | **Console super-admin (17i)** : la plateforme a sa propre interface décorrelée de TOUS les clubs (y compris ebpc) : zone `/api/super/*` sans contexte de club + page `console.html` (gestion des clubs, vue tous comptes + rôle plateforme `super_admin` dédié, sauvegarde base complète déménagée de admin-data) ; code global ou compte plateforme requis, code/session de club toujours refusés (401/403, confirmations par le code global seul, audit sans club) ; sélecteur « accès club » pour le support ; ebpc protégé mais ordinaire en usage | M | ✅ fait |

| 44 | **Personnalisation du club (17j)** : l admin du club règle sa **couleur d accent** (color picker, #rrggbb, appliquée à toutes les pages pour tous les visiteurs via variables CSS + cache anti-flash, page TV exclue) et les **défauts de ses tournois** (nom, jour récurrent, heure habituelle, pré-renseignés à la création) : `GET/PUT /api/admin/club/prefs` (sans confirm_pin, PIN du club ou session admin ; autre club = super-admin uniquement), couleur publique via `/api/club-theme` + `/api/etat` (`club.accent`), stockage `club.theme_json` ; panneau « 🎨 Apparence du club » sur l accueil admin + panneau console super-admin, i18n 4 langues | M | ✅ fait |
| 45 | **Logo du club (17k)** : logo **prédéfini** (bibliothèque mixte billard + écussons servie statiquement, whitelist `/logos/*.svg`) ou **importé** (PNG/JPG/SVG réduite à 256 px en `data:image`, plafonnée), affiché pour tous les visiteurs en **filigrane discret** centré (au-dessus du contenu pour rester visible) +/ou en **petit logo d en-tête** à côté du nom du club, au choix par switch trois positions (`logo_mode`, hors page TV, cache anti-flash) : même `GET/PUT /api/admin/club/prefs` (champs `logo` et `logo_mode`, autre club = super-admin), public via `/api/club-theme`, galerie + import dans le panneau Apparence et dans la console, i18n 4 langues | S | ✅ fait |
| 46 | **Page Apparence dédiée (17l)** : le panneau « 🎨 Apparence du club » (accent, défauts de tournoi, adresse par défaut, logo : galerie + import + aperçu + mode d affichage) quitte l accueil de la table de marque `/admin.html` (page trop chargée) pour une page dédiée `/admin-apparence.html` (bouton « 🎨 Apparence du club » de l Accès rapide, lien « ← Table de marque » pour revenir) : mêmes réglages, même sécurité (PIN du club ou session admin, geste non sensible sans confirm_pin, autre club = super-admin), même écran de code que toutes les pages admin ; panneau « 🎨 Personnalisation » de la console super-admin inchangé | S | ✅ fait |
| 47 | **Historique de la fiche joueur replié (17m)** : sur `/joueur.html`, l historique des matchs est replié au-delà des 5 derniers (bouton « Tout voir (N) » / « Réduire », même mécanique que le face-à-face) ; en mode déplié, il est paginé par pages de 20 matchs (‹ Précédent / Suivant › + « Page X / Y »), bornes désactivées grâces à la règle CSS `button:disabled`, table conservée dans son enveloppe `.table-wrap` (mobile), 524 checks conservés (gardes repliées dans les checks h2h et tableaux existants) | S | ✅ fait |
| 48 | **Identité visuelle du club (17n)** : **favicon de l onglet** = logo du club (repli favicon d origine), **bannière de l accueil** (import PNG/JPG/SVG photo 8 Mo réduite à 1600 px, servie par `/api/club-banniere`, placée en tête de l accueil et de la page Le club), **photo de fond de la TV** (1280 px, `/api/club-tv-fond`, assombrie pour garder les scores lisibles) et **page publique « Le club »** `/leclub.html` (lien du menu : bannière + nom + adresse + présentation 500 + contact 200) ; mêmes `GET/PUT /api/admin/club/prefs` (champs `banniere`/`tv_fond`/`description`/`contact`, plafond photo 400 000 caractères, répondants 204 sans image, images lourdes hors payload `/api/club-theme`), i18n 4 langues, 524 checks conservés (gardes pliées dans le check 17k réinitialisation) | S | ✅ fait |
| 49 | **Icône du club sur l écran du téléphone (17o)** : manifeste PWA **dynamique** `GET /manifest.webmanifest?club=` (nom du club, couleur d accent, `start_url` conservant le club, monté avant `express.static`), champ `icone` des prefs (PNG/JPEG 192 px **converti automatiquement depuis le logo** côté front (canvas, fond couleur d accent), plafonné 200 000 caractères, SVG refusé), `GET /api/club-icone` (?club=, préférence icone puis logo raster, sinon 302 vers l icône générique), liens `manifest`/`apple-touch-icon` + `meta theme-color` par club côté front, jamais dans le payload `/api/club-theme`, gardes pliées dans le check 17k (524 checks conservés) | S | ✅ fait |
| 50 | **Notification du prochain match (17p)** : push « 🕐 Ton prochain match arrive » aux 2 joueurs d un match devenu `pret` quand la propagation d un match terminé complète leur appariement (gagnant, perdant loser bracket, forfait, correction) : adversaire connu + code du match + table si déjà attribuée, payloads par langue du compte (fr/en/es/it/de), tag `prochain-<id>`, fire-and-forget jamais bloquant, déclenché dans `setJoueurDansSuivant` (jamais au retrait, aucune notif sur rollback), complément du « À toi de jouer » du lancement | S | ✅ fait |

## 🏛️ Plateforme / centralisation (cap confirmé)

Ce que le produit devient : tout centralisé, séparation logique. Chaque club vit sa vie (données, PIN, comptes, vocabulaire), la plateforme pilote l'ensemble.

| # | Idée | Effort | Statut |
|---|---|---|---|
| 34 | **Vidéo live du tournoi** : stream intégré sur la page tournoi + écran TV (phase 1 : embed d'un flux externe configuré par l'admin du tournoi, YouTube/Twitch, un lien par tournoi ; phase 2 : diffusion maison WebRTC/HLS si l'usage le justifie) | S / L (phase 2) | ⬜ |
| 35 | **Chat live modéré** : fil de messages du tournoi visible par tous (SSE, même mécanique que le fil), modération par les comptes admin (suppression, bannissement temporaire, anti-flood / rate-limit) — distinct du chat par match #14 (cercle restreint) | M | ⬜ |
| 36 | **Disciplines paramétrables par club** : profils par discipline à la place du billard hard-codé (blackball / ultimate / snooker / 8-ball, puis au-delà du billard si un club le demande) : vocabulaire paramétrable (table/terrain, set/leg, « belle »/« manche décisive »), format de score configurable (première à X manches vs premier à X points), règles activables (belles/revanches, forfaits) ; à construire APRÈS le multi-club stabilisé | L | ⬜ |
| 37 | **Super admin plateforme** : rôle au-dessus des admins de club : création/gestion des clubs (quotas, isolation), KPI globaux (31), modération des abus, journal des opérations plateforme ; s'appuie sur le multi-club #20 (compte_club / role_club) — **entamé (17i)** : console super-admin déjà en place (rôle `super_admin`, gestion des clubs, vue tous comptes, sauvegarde base) ; restent quotas, KPI globaux (31), modération, journal des opérations plateforme | M-L | 🟡 entamé (17i) |

---

## Ordre conseillé

0. 🏗️ 32, 33 (✅) — flux à deux branches : staging → app de test automatiquement, main → prod : le socle avant tout chantier conséquent
1. 🔒 1 (✅), 2, 3, 4 — sécurité + fiabilité
2. 👥 5, 6 — confort au quotidien pendant un tournoi
3. 🧪 21, 22, 24 — fiabilité admin
4. 📺 11, 12 — effet « salle »
5. 🏆 18, puis 19/20/17 selon la stratégie produit (multi-club d'abord si SaaS, poules d'abord si club unique avec beaucoup de tournois)
6. 🏛️ cap plateforme confirmé : multi-club (20) → super admin (37) → multi-tournois (19) → KPI en continu (31) → disciplines (36) une fois le multi-club stabilisé ; vidéo live et chat modéré (34/35) quand l'usage salle le justifie

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
| 5 | **Notif push « ton prochain match arrive »** (quand le match précédent de ton futur adversaire se termine, avec table) | S-M | ⬜ |
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
| 16 | Thème clair / personnalisation club (couleurs, logo uploadé, affiché accueil + TV) | M | ⬜ |

## 🏆 Compétition (structurant)

| # | Idée | Effort | Statut |
|---|---|---|---|
| 17 | **Phase de poules (round-robin) puis KO** : nouveau bracket 'P' + points par poule dans `bracket.js` | L | ⬜ |
| 18 | **Handicap** : X manches d'avance pour un joueur (colonne `joueur.handicap`, score de départ) | S | ⬜ |
| 19 | **Plusieurs tournois actifs simultanés** (ex. blackball + ultimate le même soir) : `tournoi_id` dans le flux SSE + sélecteur de tournoi dans le header (`tournoiActif()` appelé partout → refactor) | L | ⬜ |
| 20 | **Multi-club / multi-tenant** : plusieurs clubs sur une instance (sous-domaine ou préfixe), chacun son PIN et sa BDD logique — **le chantier « produit »**. 🟡 étapes 1-2 faites : table `club` + `club_id` backfillé, `req.club` (X-Club/?club=), routes scopées + isolation cross-club (404), `POST /api/admin/club`, push scopé. Reste : sous-domaines, `club_settings`, `compte_club`/role_club, multi-tournois actifs par club | L | 🟡 1-2 faits |

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
| 27 | i18n (EN au moins) | M | ⬜ |
| 28 | Accessibilité : contraste, taille de police réglable, navigation clavier | S-M | ⬜ |
| 29 | PWA offline : la card match consultable sans réseau (vérifier ce que cache `sw.js`) | S-M | ⬜ |
| 30 | **Rôles compte (`user`/`admin`)** : session admin = accès `/api/admin/*` sans PIN + exempte de `confirm_pin` sur les destructifs (mais modale front demandant de saisir `SUPPRIMER`) ; PIN conservé en fallback ; bootstrap 1er admin via `ADMIN_EMAIL`/`ADMIN_PASSWORD`, promotion via `POST /api/admin/compte/:id/role` ; pages admin sans PIN si session admin | M | ✅ fait |
| 31 | **Rapport d'usage par tournoi (KPI joueurs)** : taux d'adoption (joueurs inscrits ayant ouvert l'appli), répartition des pages consultées (Mon tournoi / fil / tableau), persistance après élimination, réactivité post-saisie, santé d'usage (temps de chargement médian, taux d'erreurs) ; mesure serveur agrégée, rapport généré par tournoi, sans cookie ni tracker | M | ⬜ |

## 🏗️ Environnements / mise en production

| # | Idée | Effort | Statut |
|---|---|---|---|
| 32 | **App de test `ebpc-tournoi-billard-test` déployée automatiquement à chaque push sur la branche `staging`** (après CI verte) : `fly.test.toml` + job `deploy-test`, volume `tournoi_data` séparé (restaurable depuis un snapshot prod), secrets propres, PIN différent ; notice et saut tant que `FLY_TEST_TOKEN` ou l'app manquent | S-M | ✅ fait |
| 33 | **Flux à deux branches** : `staging` → app de test (auto via CI), `main` → prod (auto via l'intégration GitHub de Fly, conservée) ; mise en prod = fusion `staging` → `main` une fois validé sur le test ; workflow manuel « Déployer prod » conservé en plan B ; voir `docs/GUIDE_DEPLOY.md` | S | ✅ fait |
| 38 | **Sauvegarde / restauration de TOUTE la base depuis l'admin** (hotfix prod, direct sur `main`) : `GET /api/admin/base/export` télécharge un JSON complet (toutes les tables, ids exacts), `POST /api/admin/base/import` restaure à l'identique dans une transaction intégrale (FK différées, rollback si erreur) ; réservé au code global (403 pour un code de club) ; panneau 💾 dans `/admin-data.html` — complément des snapshots de volume Fly, voir `docs/GUIDE_ADMIN.md` | S | ✅ fait |
| 39 | **TV breaking news** (hotfix prod, direct sur `main`) : bandeau rouge (blanc sur rouge) en bas de l'écran TV avec le fil du tournoi défilant, aligné avec le QR code ; helpers du fil (`lignesFil` & co) partagés dans `common.js` — voir SPEC 86 | S | ✅ fait |

## 🏛️ Plateforme / centralisation (cap confirmé)

Ce que le produit devient : tout centralisé, séparation logique. Chaque club vit sa vie (données, PIN, comptes, vocabulaire), la plateforme pilote l'ensemble.

| # | Idée | Effort | Statut |
|---|---|---|---|
| 34 | **Vidéo live du tournoi** : stream intégré sur la page tournoi + écran TV (phase 1 : embed d'un flux externe configuré par l'admin du tournoi, YouTube/Twitch, un lien par tournoi ; phase 2 : diffusion maison WebRTC/HLS si l'usage le justifie) | S / L (phase 2) | ⬜ |
| 35 | **Chat live modéré** : fil de messages du tournoi visible par tous (SSE, même mécanique que le fil), modération par les comptes admin (suppression, bannissement temporaire, anti-flood / rate-limit) — distinct du chat par match #14 (cercle restreint) | M | ⬜ |
| 36 | **Disciplines paramétrables par club** : profils par discipline à la place du billard hard-codé (blackball / ultimate / snooker / 8-ball, puis au-delà du billard si un club le demande) : vocabulaire paramétrable (table/terrain, set/leg, « belle »/« manche décisive »), format de score configurable (première à X manches vs premier à X points), règles activables (belles/revanches, forfaits) ; à construire APRÈS le multi-club stabilisé | L | ⬜ |
| 37 | **Super admin plateforme** : rôle au-dessus des admins de club : création/gestion des clubs (quotas, isolation), KPI globaux (31), modération des abus, journal des opérations plateforme ; s'appuie sur le multi-club #20 (compte_club / role_club) | M-L | ⬜ |

---

## Ordre conseillé

0. 🏗️ 32, 33 (✅) — flux à deux branches : staging → app de test automatiquement, main → prod : le socle avant tout chantier conséquent
1. 🔒 1 (✅), 2, 3, 4 — sécurité + fiabilité
2. 👥 5, 6 — confort au quotidien pendant un tournoi
3. 🧪 21, 22, 24 — fiabilité admin
4. 📺 11, 12 — effet « salle »
5. 🏆 18, puis 19/20/17 selon la stratégie produit (multi-club d'abord si SaaS, poules d'abord si club unique avec beaucoup de tournois)
6. 🏛️ cap plateforme confirmé : multi-club (20) → super admin (37) → multi-tournois (19) → KPI en continu (31) → disciplines (36) une fois le multi-club stabilisé ; vidéo live et chat modéré (34/35) quand l'usage salle le justifie

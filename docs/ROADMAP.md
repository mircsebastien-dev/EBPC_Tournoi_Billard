# 🗺️ Roadmap / idées — EBPC Tournoi Billard

**Objectif final : transformer l'app en produit** (multi-club, invitations, compte joueur valorisé…).
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
| 10 | Head-to-head entre 2 joueurs sur la fiche joueur (les données anti-rematch existent déjà) | S | ⬜ |

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
| 20 | **Multi-club / multi-tenant** : plusieurs clubs sur une instance (sous-domaine ou préfixe), chacun son PIN et sa BDD logique — **le chantier « produit »** | L | ⬜ |

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

---

## Ordre conseillé

1. 🔒 1 (✅), 2, 3, 4 — sécurité + fiabilité
2. 👥 5, 6 — confort au quotidien pendant un tournoi
3. 🧪 21, 22, 24 — fiabilité admin
4. 📺 11, 12 — effet « salle »
5. 🏆 18, puis 19/20/17 selon la stratégie produit (multi-club d'abord si SaaS, poules d'abord si club unique avec beaucoup de tournois)

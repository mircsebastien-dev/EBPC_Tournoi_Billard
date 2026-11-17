# 📋 Cahier des charges / Spec fonctionnelle — EBPC Tournoi Billard (Pink City Billard)

Application web de gestion de tournois de billard (blackball / ultimate) : inscriptions, tirage, tableaux (élimination directe ou double KO), saisie des scores en direct par les joueurs, affichage public (TV), statistiques, notifications push PWA, interface d'administration complète.

- **URL prod** : https://ebpc-tournoi-billard.fly.dev
- **Dépôt** : `mircsebastien-dev/EBPC_Tournoi_Billard` (branche prod `main` — commits et push directs sur `main`, déploiement auto Fly depuis GitHub à chaque push)
- **Stack** : Node.js + Express, better-sqlite3 (SQLite sur volume), vanilla JS front (pas de framework), PWA (manifest + service worker + web-push), hébergement Fly.io

---

## 1. Rôles

| Rôle | Accès | Identité |
|---|---|---|
| Visiteur | public | — |
| Joueur invité | pages publiques + saisie score de ses matchs | pseudo choisi (localStorage) |
| Joueur avec compte | + notifs push, amis, fiche perso, export RGPD | pseudo + email + mdp (session cookie) |
| Admin (table de marque) | `/admin*.html` + routes `/api/admin/*` | code PIN (`ADMIN_PIN`) **ou** session d'un compte `role=admin` (vérifié côté serveur à chaque requête) |

Un joueur invité qui crée un compte avec le **même pseudo** est rattaché automatiquement (création de compte, connexion, ET inscription admin si le compte existe déjà).

**Compte connecté = pas d'inscription anonyme** : `POST /api/joueur` refuse avec **409 `compte_connecte`** (l'inscription passe par `/api/tournoi/inscrire`) ; l'accueil ne propose que le bouton 1-clic du compte, le champ pseudo n'est affiché qu'aux non-connectés.

**Self-désinscription** : `DELETE /api/tournoi/desinscrire` (compte connecté, **401** sinon) retire du tournoi actif le joueur rattaché au compte — uniquement en phase `inscription` (**409** si tournoi lancé) et **sans avoir payé** (**409 `deja_paye`** si `statut = paye`), **404** si pas inscrit ; bouton « Me désinscrire » sur l'accueil et `/compte.html` (masqué si déjà payé), logué `desinscription` (`self: true`) dans l'audit ; un joueur sans compte ou déjà payé reste désinscriptible par un admin uniquement.

---

## 2. Tournois

- Création admin : nom, règle (`blackball`/`ultimate`), taille (16/32/64/128), format (`simple` = élimination directe, `double` = DKO avec `dko_tours` tours de WB), nombre de tables, date/heure, lieu, têtes de série, ajustement auto de la taille au nombre de payés (puissance de 2)
- Switch **notif push « inscriptions ouvertes »** (champ `notif_push`, **actif par défaut**) : à la création, `POST /api/admin/tournoi` envoie un push à **tous les comptes abonnés** (`push.envoyerTous`) — désactivable par switch sur le formulaire
- **Un seul tournoi actif** à la fois (statuts : `inscription` → `en_cours` → `termine`)
- Tables du tournoi (numéro 1..N), modifiables en cours (ajout/retrait, 409 si occupées)
- **Mode auto** : ON/OFF persistant ; un match `pret` part seul sur une table libre, dans l'ordre des tables personnalisable (ex. `3,4,5,6,7,8,1,2`)
- **Tables réservées** : setting `tables_reservees` (vide par défaut) — à partir des quarts (niveau calculé selon la taille), ces tables ne sont plus utilisées en auto
- Distances (race to) par tour, éditables (défaut 3, seuil « jamais » ou tour spécial)
- **Simulation** du tournoi complet (scores aléatoires) pour tests/démo
- **Clôture** : « Terminer maintenant » = coupe net (aucun champion automatique, sauf choix explicite dans le select) ; fin normale = la finale déclare le champion

## 3. Inscriptions

- Admin : ajouter/supprimer un joueur, simuler N joueurs, marquer payé, tirage = uniquement les payés
- Joueur : self-enroll par pseudo (invité) ou via compte ; self-désinscription via compte (phase inscription uniquement)
- **Tirage au sort** crypto (`crypto.randomInt`, mélange Fisher-Yates) : si les têtes de série sont activées, les seedés (triés par TDS) sont placés en ordre **serpentin** sur les matchs WB1 (TDS 1 → match 1, TDS 2 → dernier match, TDS 3 → match 2, TDS 4 → avant-dernier, etc. ; TDS impaires en slot 1, paires en slot 2 → les seedés ne peuvent se rencontrer qu'en fin de tableau) ; les non-seedés ET les blancs sont **mélangés ensemble** puis versés dans les slots restants (un match WB1 peut donc être joueur-vs-blanc = passe direct, ou blanc-vs-blanc = match vide auto-terminé par `appliquerBye`) ; bye = victoire auto + propagation

## 4. Matchs

- États : `prevu` → `pret` (2 joueurs connus) → `en_cours` (table attribuée) → `termine`/`forfait`
- **Lancement** : manuel (modale admin : table choisie) ou auto
- **Tirage à la bande** au lancement : panneau 🎲 sur la card, le gagnant reçoit la **⚪** et casse en premier ; **alternance stricte** ensuite à chaque manche (manche ou runout)
- **Saisie par les joueurs** (card match, uniquement les 2 joueurs) :
  - +1 manche / −1 corriger ; 💥 **casse ferme** réservée au ⚪, 🎯 **reprise ferme** à l'autre (boutons grisés + 403 serveur)
  - **Saisie bloquée tant que le tirage à la bande n'est pas fait** (UI + 409 serveur)
  - **Dernier point** (atteint race to) → modale de confirmation du score final avec « Modifier »
- Forfait (admin ou arrêt), réouverture admin **409 si un match aval a commencé ou a reçu un joueur**
- **−1 (retirer une manche)** : correction possible à tout moment ; la ⚪ revient à l'état précédent (le casseur redevient l'adversaire du casseur courant)
- **Corrections admin** (modale « Gérer le match », clic sur card avec PIN) : changer les joueurs (WB/LB, blanc possible → bye auto **uniquement si le feeder du côté blanc est terminé** ; **409 si la paire est déjà appariée ailleurs hors finale**), déplacer de table (409 si occupée, libérer = null), corriger le score (scores absolus), rouvrir (409 si aval commencé), forfait. Audit logué.

## 5. Bracket (génération, croisements, anti-rematch)

**Structure** (source unique : `structureBracket`, fonction **pure** sans BDD ni joueurs, partagée par le tirage réel ET le tableau virtuel pré-tirage) :

- Format **simple** : `log2(taille)` tours WB, WB t = `taille >> t` matchs ; gagnant WB(t,p) → WB(t+1, ⌈p/2⌉)
- **DKO partiel k** : WB k tours ; **LB `2k-2` tours** (1 seul si k=1) ; les LB tours `2j-1` et `2j` comptent chacun `taille >> (j+1)` matchs (LB1/LB2 = taille/4, LB3/LB4 = taille/8, …) ; **tableau final F** de `taille >> (k-1)` joueurs (`log2` tours) : gagnant WB(k,p) → **F1 slot 1**, dernier tour LB → F1 slot 2 (croisement ci-dessous)
- **Liens perdants** : perdant WB1 (positions 2p-1 et 2p) → LB1 p (slots 1 et 2) ; perdant WB t (t ≥ 2, position p) → LB tour **2t-2**, position p, **slot 2** (le slot 1 vient du LB)
- Propagation gagnant/perdant en cascade, byes auto (`appliquerBye` : joueur seul + feeder adverse terminé = victoire bye propagée ; blanc-vs-blanc = match vide auto-terminé)

**Croisements LB** (câblage statique anti-rematch, calibré pour retarder au maximum les re-rencontres) :

- Tour **impair → pair** (LB1→LB2, LB3→LB4…, même nombre de matchs) : croisement **par paires p ↔ p^1 en slot 1** ; le tour pair reçoit par ailleurs un perdant WB en slot 2 (même position) → le perdant de WB(t,p) ne peut jamais retomber sur le gagnant LB issu de son propre groupe de 4 du WB (élimine le re-match immédiat « J1 vs J2 »)
- Tour **pair → impair** (LB2→LB3, LB4→LB5…, moitié moins de matchs) : croisement **par blocs de 4** — les feeders extérieurs du bloc (rangs 1 et 4) alimentent un match suivant, les intérieurs (rangs 2 et 3) l'autre → les 2 feeders d'un match LB suivant ne viennent jamais du même groupe de 4 du WB
- **Dernier tour LB → F1 slot 2** en **rotation d'une demi-moitié croisée** (moitié opposée à la zone WB d'origine, puis miroir binaire à l'intérieur de chaque moitié : deux revenants issus de matchs LB adjacents tombent dans des quarts différents, risque de re-match repoussé des quarts F2 vers les demis F3, 22,7 % → 6,2 % des tournois ; plancher mesuré des 40 320 réventilations statiques possibles)

**Anti-rematch strict, garanti hors finale** (filet de sécurité dynamique, quel que soit le câblage) :

- **Sweep à chaque propagation** (`setJoueurDansSuivant`) : si un match non démarré a ses 2 joueurs déjà appariés ailleurs (joués OU prévus, `paireExiste`), on échange **un seul joueur** avec un autre match du même tour (**4 orientations** testées, partenaires même partiellement remplis), logué `rematch_swap_*` ; le sweep reboucle (jusqu'à 10 passes) sur tout le tour WB/LB/F tant qu'un swap est possible, car un swap devient possible quand les autres matchs du tour se remplissent. Ne touche que les matchs `prevu`/`pret`, ne crée jamais `j1 === j2`
- **Garde-fou au lancement** (`assertPasDeRematch` dans `lancerMatch`, `declarerForfait`, `corrigerScore` quand ça termine) : après un dernier sweep, si la paire existe encore ailleurs → **409 « Rematch interdit hors finale »**. **Changement manuel des joueurs** (`setJoueursAdmin`) : 409 si la paire est déjà appariée ailleurs (joué ou prévu), sauf si l'un des deux matchs est la vraie finale. **Seule exception** : dernier tour d'un bracket à **1 seul match** (finale F / dernier LB forcé). Conséquence : aucun rematch ne peut jamais être joué hors finale ; en cas d'état manuellement corrompu sans swap possible, le lancement est bloqué (fail-closed, 409 explicite)

## 6. Affichage public

- **Accueil** : en phase inscription, le haut de page devient une **affiche auto-générée du tournoi à venir** (thème du site, or/sombre) : eyebrow « Inscriptions ouvertes », nom en grand, date/heure + lieu en or, chips règle (Blackball/Ultimate) + format (Élimination directe / Double KO (k tours)) + taille du tableau, **jauge de remplissage** (`X/Y inscrits · N places restantes`, « Complet » si plein), boule 8 en filigrane derrière le texte — 100 % générée depuis les données du tournoi, rien à saisir (pas de QR : le visiteur est déjà sur le site) ; ensuite : inscription rapide (bouton 1-clic du compte si connecté, champ pseudo uniquement si non connecté), bouton « Me désinscrire » si déjà inscrit non payé, panneau **Amis** (si connecté)
- **Tableau** (`/tableau.html`) : vue **bracket** avec **onglets Tout / WB / LB / Phase finale** (mémorisés) ; **liens SVG entre matchs visibles uniquement sur l'onglet « Phase finale »** (stubs courts sur les autres onglets), halo uniquement sur les matchs en cours ; cartes 230 px max ; **slots explicites** : match attendu = « gagnant wb1-001 » / « perdant lb2-003 » / « blanc » (une ligne par slot, ≤ 15 caractères) tant que les joueurs ne sont pas connus — exposé aussi dans l'API (`suivant_slot`/`perdant_slot` sur chaque match) ; vue **liste** (cartes en flux, une ligne `joueur1  0 - 0  joueur2`, gagnant en vert, match terminé bordé vert, match en cours entouré rouge, labels de slots) ; « Aller au tour » (select) ; **filtre joueur** (préfixe, Entrée pour valider, focus conservé) ; **tableau à vide avant le tirage** : dès la création (statut inscription), `/api/etat` expose la structure complète en **matchs virtuels** (`virtuel: true`, ids `v1`…`vN`, `etat` prévu, aucun joueur, non cliquables côté client, rien en base) issus de `structureBracket` — la même fonction pure qui câble le vrai tirage — et la page affiche le tour 1 en `j1`…`jN` (ex. j1 à j32), les tours suivants en « gagnant/perdant … » ; le tirage remplace les matchs virtuels par les réels
- **TV** (`/tv.html`) : uniquement les matchs **en cours**, champion en fin ; **grand QR centré**, **horloge en cours** (haut droite, sous le bandeau), **Screen Wake Lock** (anti veille écran) ; (520px/60vh/92vw) quand aucun tournoi lancé ou phase inscription (petit QR coin masqué dans ce cas) ; overlay « tourne l'écran » sur grand écran portrait
- **Joueur** (`/suivi.html`) : choisir son joueur (invité = uniquement joueurs sans compte) → ses matchs en cours/à venir
- **Stats** (`/stats.html`) : classement global tous tournois (joués/gagnés/perdus/%/⭐points/manches/runouts/titres), **tri par points, rang ex-aequo (1,1,1,4…)** ; fiche joueur `/joueur.html?id=` (stats + historique, matchs en cours à part, **face-à-face : bilan V/D contre chaque adversaire rencontré, agrégé par personne (compte ou pseudo, cf. `idsMemeJoueur`), en tableau plié au-delà des 5 plus joués (bouton « Tout voir (N) » / « Réduire »), adversaire cliquable — exposé dans `h2h` de `GET /api/joueur/:id/historique`**, matchs vs blanc exclus du classement par tournoi aussi)
- **Historique** (`/historique.html`, admin-historique) : tournois terminés en **liste de matchs par tour** + **surbrillance** d'un joueur (champ recherche, Entrée)
- Mises à jour temps réel par **SSE** (`/api/events`, broadcast à chaque changement)

## 7. Statistiques & points

- Par tournoi (`calculerStats`) : joués/gagnés/perdus/%/série + résumé (durée moyenne, plus rapide/long, dernier gagnant)
- **Points** (`pointsParTournoi`) = **profondeur max atteinte** (WB: n° tour ; DKO: F tour t = k+tour), un seul côté peuplé suffit (qualifié même si adversaire inconnu) ; **pas de bonus LB**
- Matchs clôturés sans gagnant = ni joués ni perdus (fiche + global)
- Classement trié par points, **ex-aequo** dans le panneau tournoi et /stats.html

## 8. Comptes joueurs

- Inscription/connexion (scrypt+salt, rate-limit 5/10min par IP), session cookie HttpOnly/SameSite/Secure 30 j (token hashé en BDD)
- Réinit mdp par email (Resend, token hashé, 1 h, lien calculé depuis l'hôte — jamais `BASE_URL`)
- Changement d'email (vérif unicité 409), changement de pseudo (admin), dernière connexion (`last_login_at`)
- **Email masqué** sur la page compte (`p***@domaine`) + champ de changement séparé
- **Purge auto** des comptes inactifs > 18 mois (boot + toutes les heures)
- **Amis** : table `ami`, recherche par pseudo (`/api/comptes/recherche`), ajout/suppression, statut live par ami (en cours vs X (score, table) / programmé / inscrit / hors tournoi) ; **suivi par pseudo sans compte** (table `ami_pseudo` : mêmes notifs match + inscription, statut live par pseudo dans le tournoi actif, anti-doublon par endpoint) ; **push « match d'un ami »** au lancement pour les comptes amis et les suiveurs du pseudo (**préférences `notif_amis_match` / `notif_amis_inscription` désactivables depuis /compte.html**, défaut activées) ; section Amis dans le compte + panneau accueil
- **RGPD** : page `/confidentialite.html` (lien nav), export JSON « mes données » (`/api/compte/export`), emails masqués dans l'admin-comptes, un seul cookie de session, localStorage = préférences uniquement

## 9. Notifications push (PWA)

- Installable (manifest : nom « Pink City Billard — Tournois », short_name « Tournoi EBPC », icônes 192/512 + apple-touch + **favicon.svg bille 8**)
- iOS : **obligatoirement via Safari** → « Sur l'écran d'accueil », puis activer dans l'app
- **Tests push manuels** : `POST /api/push/test` (bouton « Tester la notification » dans le compte) + `POST /api/admin/push-test-ami {joueur_id}` (bouton admin)
- **Rappel « inscriptions ouvertes »** : `POST /api/admin/tournoi/rappel-inscriptions` (bouton 🔔 de la table de marque, phase inscription uniquement — 409 après le tirage —, push à tous les abonnés du club, même `tag` que la notif de création → le rappel remplace la précédente au lieu de s'empiler ; action auditée `rappel_inscriptions` avec le nombre envoyé)
- Push VAPID : « 🎱 À toi de jouer ! » au lancement (joueurs) + « 👥 Match d'un ami » (amis) ; **clic sur la notif → ouvre `/match.html?id=<match>` directement** (SW robuste : navigate+focus si onglet ouvert, openWindow URL absolue sinon, fallback accueil)
- Abonnement stocké par compte, révocable

## 10. Admin (table de marque)

- `/admin.html` + PIN (vérifié serveur, 401 sinon) ; accès rapides : gérer tournoi, historique, journal d'audit, comptes, 🗄 Données, ⚙️ Guide admin
- **`/admin-tournoi.html`** : config tournoi, inscriptions, tirage, auto, tables, distances, simulation, clôture
- **`/admin-comptes.html`** : liste comptes (pseudo, email masqué, créé, dernière connexion, nb inscri. tournois, matchs, sessions, **push : 🔔 nb d'appareils avec notifs activées (`push_abonnements` dans `GET /api/admin/comptes`, scopé au club) + total « N avec notifs push activées » en tête**, amis : amis compte + pseudos suivis sans compte), recherche (Entrée), ✏️ pseudo, 🔑 mdp (sessions invalidées), 🗑 supprimer (historique matchs conservé), audit
- **`/admin-data.html`** (🗄 Données) : sélecteur de tournoi (actif **ou terminé** = corrections historiques), filtre pseudo (Entrée) ; onglets Matchs (liste + modale ⚙️ + 📜), Joueurs (éditer pseudo/statut, supprimer), Events (🗑 supprime un event → **score recalculé** → stats corrigées)
- **`/admin-journal.html`** : **500 dernières actions admin** (lancements lisibles : « wb1-001 — P11 vs P07 (table 3) ») ; chaque entrée avec snapshot a un bouton **⏪ Restaurer à ce point** (1re colonne) → `POST /api/admin/tournoi/rollback {audit_id, confirm_pin}` : restauration **point-in-time** du tournoi actif (transaction atomique, FK différées, match en cours OK → remis à `pret` 0-0 + table libérée ; 409 si snapshot d'un autre tournoi, 404 sans snapshot) ; le rollback est logué ; la page se re-rend en place (zoom/scroll conservés)
- **`/admin-aide.html`** : guide admin in-app
- **confirm_pin** : middleware `requireConfirmPin` exige le code re-saisi (`body.confirm_pin`, hash SHA-256, 401 sinon) sur **toutes les routes destructives** : `DELETE /api/admin/tournoi`, `DELETE /api/admin/tournoi/:id`, `DELETE /api/admin/compte/:id`, `DELETE /api/admin/match/:id/event/:id`, `DELETE /api/admin/audit`, `POST /api/admin/tournoi/rollback`. UI : modale `demanderPin` (champ `type=password`, masqué) + `adminApiDestructif`. **Exception** : `DELETE /api/admin/joueur/:id` (désinscription) sans confirm_pin

## 11. Modèle de données (SQLite, `/data/tournoi.db`)

`tournoi`, `joueur`, `match` (bracket/tour/position, joueurs, scores, manches, gagnant, etat, table, liens suivant/perdant **+ `suivant_slot`/`perdant_slot`**, `casseur_id`, `started_at`/`ended_at`), `match_event` (types : `lancement`/`bande`/`manche`/`runout`/`correction`/`forfait`/`bye`/`tirage`), `table_billard`, `distance_round`, `settings`, `compte` (+`last_login_at`, reset token hashé), `session`, `push_subscription`, `ami`, `audit_log`, **`audit_snapshot`** (snapshot JSON du tournoi actif par événement d'audit, FK cascade, index tournoi, **cap 200/tournoi**, **purge > 90 j au boot**)

## 12. API (principales)

- Public : `/api/etat` (SSE aussi, matchs avec `suivant_slot`/`perdant_slot`), `/api/tournois`, `/api/tournois/:id`, `/api/stats-joueurs`, `/api/joueur/:id/stats|historique|matchs`, `/api/comptes/recherche`, `/api/qrcode.svg`, `/api/events` (SSE)
- Joueur : `/api/match/:id/bande|manche|runout|retirer`, `/api/tournoi/inscrire|desinscrire`, `/api/compte/*` (inscription, connexion, déconnexion, moi, email, amis, export, push subscribe), `/api/push/vapid-public|subscribe|unsubscribe`, `/api/push/test`
- Admin (PIN) : `/api/admin/*` (tournoi [+ `notif_push` à la création], joueur(s), paiement, tirage, auto, match lancer/table/joueurs/correction/rouvrir/forfait/events, terminer, simuler, comptes, compte pseudo/password/suppr, audit [500 entrées + `has_snapshot`, filtres `?q=`/`?action=`], data events, distances, tables) + **`POST /api/admin/tournoi/rollback {audit_id, confirm_pin}`** + **`GET /api/admin/tournoi/rollback/diff?audit_id=`** (diff snapshot vs courant avant restauration) + **`GET /api/admin/tournoi/export[?id=]`** (JSON téléchargeable) + **`POST /api/admin/tournoi/import {payload, replace?, confirm_pin}`** (remap des ids en 2 passes — liens self-FK en UPDATE après — `PRAGMA foreign_key_check` avant COMMIT, 400 explicite si refs cassées, 409 si tournoi actif sans `replace:true`) ; routes destructives protégées par `requireConfirmPin` (`confirm_pin` dans le body)

## 13. Sécurité
- Headers : CSP (`script-src 'self' 'unsafe-inline'`), X-Frame-Options DENY, nosniff, Referrer-Policy
- SQLite WAL + busy_timeout 5 s ; SSE broadcast léger `{changed}` + re-fetch client
- Boutons radius 1 px uniformes ; thème sombre « charbon + rose profond #d6336c » ; liens de contenu en rose clair `--pink-soft` (#ef7ba4) pour tous les états (`a` et `a:visited`, le bleu/violet par défaut du navigateur étant illisible sur fond sombre) — la nav, les chips et les round-links gardent leurs couleurs propres

- **Session admin 8 h** : le PIN en localStorage expire (`ebpc_admin_pin_since`, `ADMIN_SESSION_MS = 8h`) + bouton 🔒 Verrouiller (efface le PIN mémorisé) ; re-saisie obligatoire ensuite
- **Rôles compte** (`compte.role` : `user` par défaut, `admin`) : `requireAdmin` accepte la **session d'un compte admin** (sans PIN) ; sinon fallback sur le PIN. `requireConfirmPin` (actions destructives) est **exempté** si session admin (sinon exige `confirm_pin`), mais le front affiche quand même une **modale de confirmation par saisie du mot `SUPPRIMER`** (`demanderConfirmationTexte` dans admin-common.js). Bootstrap du 1er admin via env `ADMIN_EMAIL`/`ADMIN_PASSWORD` ; promotion/rétrogradation via `POST /api/admin/compte/:id/role` (`admin`|`user`, 400 sinon, PIN requis). Les pages `/admin*.html` s'ouvrent sans PIN si la session courante est admin (sinon écran PIN).
- **Multi-club (étapes 1-2, zéro impact en mono-club)** : table `club (id, slug UNIQUE, nom, pin_hash, theme_json, actif)` ; `club_id` ajouté à `tournoi`, `audit_log`, `audit_snapshot`, `push_subscription` (migrations auto + backfill sur le club par défaut créé au boot, env `CLUB_DEFAULT_SLUG`/`CLUB_DEFAULT_NAME`, idempotent — vérifié sur une vieille BDD). Le club courant `req.club` est résolu par header `X-Club` ou `?club=<slug>` (404 si slug inconnu, club par défaut sinon ; le front mémorise `?club=` en localStorage et envoie `X-Club` partout). `tournoiActif(clubId)`, `etatGlobal`, `vueTournoiListe`, stats, routes match/joueur (garde `matchDuClub`/`joueurDuClub`/`tournoiDuClub` → 404 cross-club), routes admin, audit (filtré `club_id`), export/import (import rattaché au club courant), rollback/diff, `majEtBroadcast` (auto-lancement par club), `logAudit(..., clubId)` + snapshots scopés, `envoyerTous(payload, clubId)`. `GET /api/clubs` (public), `POST /api/admin/club` (slug `^[a-z0-9][a-z0-9-]{1,29}$`, 409 doublon, pin optionnel → `pin_hash`, accepté par `verifierPinAdmin` en plus du PIN global). Tests : section 17 de la batterie (21 checks d'isolation).
- Rate-limit comptes (`insc:`/`conn:`/`oubli:`) keyé sur `x-forwarded-for` via `ipClient(req)` (derrière proxy, `req.ip` = IP du proxy)
- PIN admin vérifié serveur sur toutes les routes `/api/admin/*` (401) + **anti brute-force** : `PIN_MAX_ESSAIS` (10) échecs max par IP (via `x-forwarded-for` puis `req.ip`) dans `PIN_FENETRE_MS` (10 min) → lockout `PIN_BLOCAGE_MS` (10 min) avec **429 même pour le bon code** ; succès = compteur remis à zéro. S'applique à `X-Admin-Pin` (header/query/body) **et** à `confirm_pin`. Test : section 12 de la batterie, active si `TEST_BRUTEFORCE=1` (serveur lancé avec les 3 variables petites)
- mdp scrypt+salt ; sessions cookie HttpOnly/SameSite/Secure, token hashé ; réinit 1 h hashée ; rate-limit inscription/connexion/oubli
- Saisie match réservée aux 2 joueurs (403), blocage sans bande (409), règles ⚪ (403)
- Pas de cookie tiers/tracking ; emails masqués côté admin ; `Cache-Control: no-store` sur html/js/css
- **Robustesse** : middleware d'erreur global JSON (`entity.parse.failed` → 400, `entity.too.large` → 413, 404 JSON sur `/api/*`) ; `/api/health` (`SELECT 1` + uptime, 503 si BDD KO) ; `process.on('unhandledRejection'/'uncaughtException')` logués sans crash (écritures SQLite synchrones, WAL cohérent) ; arrêt propre SIGTERM/SIGINT (SSE `bye` + `server.close` + `db.close`, garde-fou 3 s) ; `synchronous=FULL` ; body limité à 256 ko ; pseudo nettoyé (contrôle retirés, max 40) ; PIN jamais en query string ; XSS impossible (front 100 % `createTextNode`)

## 14. Déploiement / hébergement / services

- **Fly.io** : app `ebpc-tournoi-billard`, région `cdg`, **1 machine** `shared-cpu-1x` / **256 Mo** (SQLite = 1 seule machine écrivante — ne pas scaler en horizontal ; monter en vertical si besoin : `fly scale memory 512`), `auto_stop off`, volume `tournoi_data` (snapshoté) monté sur `/data`, `DB_PATH=/data/tournoi.db`, `PORT=3000`, listen `0.0.0.0`
- **Secrets Fly** (jamais `BASE_URL`) : `ADMIN_PIN`, `ADMIN_EMAIL`/`ADMIN_PASSWORD` (bootstrap compte admin, optionnels), `RESEND_API_KEY`, `MAIL_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- **Emails** : Resend (réinit mdp) ; en dev sans clé, le lien est loggé
- **Push** : VAPID (web-push), clés en secrets ; en dev, clés générées à la volée (log)
- **Déploiement** : push sur `main` → déploiement auto Fly depuis GitHub (prod `ebpc-tournoi-billard`) ; **app de test** séparée (`ebpc-tournoi-billard-test`) : volume neuf ou restauré depuis snapshot prod (jamais partagé), secrets recopiés à la main (Fly ne les lit pas), PIN différent conseillé
- **Snapshots volume** : `fly volumes snapshots list/create tournoi_data` pour backup/restauration
- **Tests** (serveur frais sur DB temporaire : `PORT=xxxx DB_PATH=/tmp/x.db ADMIN_PIN=0000 node src/server.js`) :
  - `BASE=http://127.0.0.1:PORT node test/batterie.js` → **244 checks** (`test/rapport.md`) : sécurité PIN + confirm_pin, tournois, comptes, matchs, DKO, amis, règles, **rollback point-in-time (401/404/200, état restauré, match en cours → pret 0-0 + table libérée)**, slots API, byes exclus du classement, lancements lisibles, **robustesse (section 13 : health, 400/413/404 JSON, id NaN, pseudo tronqué/nettoyé, injection SQL, 20 manches parallèles sans 500 ni double comptage)**
  - `BASE=… node test/e2e.js` (structure DKO 32 k=2/k=3, distances LB race-to-2, SSE) · `BASE=… node test/fullrun.js` (simulations complètes 16/32 joueurs simple + DKO)
  - `node test/push-unit.js` (push `envoyerTous` avec web-push mocké via `require.cache` : payload « inscriptions ouvertes », cleanup 410/404, 500 conservé) · `node test/purge-unit.js` (purge au boot `audit_log`/`audit_snapshot` > 90 j, test en 2 processus)
  - anti brute-force PIN : `TEST_BRUTEFORCE=1 PIN_MAX_ESSAIS=4 PIN_FENETRE_MS=1500 PIN_BLOCAGE_MS=2000` (côté serveur ET côté batterie) active la section 12 (429 après N échecs, lockout même pour le bon code, déblocage après délai)
  - `BASE=… [NO_MANUEL=1] [NB_SIMUS=3] [SEED=…] node test/simu-invariants.js` : simulations complètes randomisées (32j DKO k=1/2/3, 32j simple, 16j DKO k=2) avec interventions admin aléatoires (lancer/table, bande, manche, retirer, correction, forfait, rouvrir, delete event, changer joueurs) ; **invariant anti-rematch vérifié après chaque mutation** (aucune paire dans 2 matchs joués hors finale + aucun match j1===j2), impacts vérifiés (propagation gagnant/perdant, recalc score, 409 rematch), stats cohérentes en fin, aucun 500
- **Monitoring** : `fly status`, `fly logs`, métriques mémoire pendant un tournoi

## 15. Fichiers clés

`src/server.js` (routes, SSE, stats, confirm_pin, rollback), `src/matchs.js` (règles, propagation, corrections, ⚪ sur retirer), `src/bracket.js` (génération WB/LB/F, liens), `src/comptes.js` (auth, amis, RGPD), `src/push.js` (VAPID, `envoyerTous`, envois), `src/db.js` (schéma + migrations + `logAudit` + snapshots + purge), `public/` (pages + common.js [rendu bracket/liste/cartes] + sw.js + push-client.js), `test/` (batterie.js, e2e.js, fullrun.js, simu-invariants.js, push-unit.js, purge-unit.js, rapport.md), `docs/` (guides + cette spec + **ROADMAP.md** : idées produit — multi-club, poules, ELO, arbitre, shot clock…)

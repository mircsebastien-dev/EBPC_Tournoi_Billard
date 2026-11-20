# ⚙️ Guide admin — Table de marque (EBPC / Pink City Billard)

Accès : `/admin.html` → **code PIN** (variable `ADMIN_PIN` sur Fly) **ou** connexion d'un compte avec le **rôle `admin`** (créé au démarrage via `ADMIN_EMAIL`/`ADMIN_PASSWORD`, ou promu depuis la page Comptes). Toutes les routes `/api/admin/*` exigent le PIN **ou** une session admin (401 sinon). Seules les données publiques (tableau, TV, stats, historique) sont visibles sans PIN.

**Session limitée à 8 h** : le code mémorisé expire après 8 h (re-saisie obligatoire) ; bouton **🔒 Verrouiller** dans le menu admin pour effacer immédiatement le code mémorisé.

**Anti brute-force** : après `PIN_MAX_ESSAIS` (10 par défaut) mauvais codes soumis depuis la même IP dans `PIN_FENETRE_MS` (10 min), l'IP est lockée `PIN_BLOCAGE_MS` (10 min) — **même le bon code reçoit 429** pendant le lockout. S'applique au header `X-Admin-Pin` **et** au `confirm_pin`. Un code correct remet le compteur à zéro. Variables d'env ajustables (voir README).

---

## 1. Créer le tournoi (`/admin-tournoi.html`)

- Nom, règle (blackball/ultimate), taille (16/32/64/128), format : **élimination directe** ou **double KO** (préciser le nombre de tours DKO), nombre de tables, date/heure, lieu, têtes de série
- **Ajustement auto** : la taille se réduit automatiquement au nombre de joueurs payés (puissance de 2)
- Switch **🔔 Notif push « inscriptions ouvertes »** (coché par défaut) : à la création, tous les comptes abonnés reçoivent une notif push « 🎱 Nouveau tournoi — inscriptions ouvertes »
- Un seul tournoi actif à la fois
- ⚠️ **Tables réservées** : vide par défaut (aucune réservation). Remplir ex. `1,2` pour réserver des tables à partir des quarts
- Une fois créé (statut `inscription`) : la **TV affiche un grand QR code centré** pour que les joueurs s'inscrivent depuis leur téléphone


**Astuce :** si tu personnalises ton club (panneau « 🎨 Apparence du club », section « Outils divers »), le nom du tournoi, la date et l heure sont **pré-remplis** à partir de tes réglages (nom habituel, jour récurrent, heure habituelle). Le lieu reste à saisir.

## 2. Inscriptions

- Ajouter un joueur (pseudo), **simuler** N joueurs, marquer **payé**, supprimer
- Seuls les joueurs **payés** sont tirés au sort
- ⛔ **Pseudo d'un compte = réservé** : l'inscription publique anonyme est refusée avec **409** (anti-usurpation) ; l'ajout admin est possible **après confirmation explicite** (l'UI demande « inscrire quand même ? », le joueur est alors rattaché au compte). Exception renommage : aligner le pseudo d'un joueur déjà rattaché à son propre compte reste possible
- Un joueur inscrit en invité (sans compte) qui crée plus tard un compte avec le **même pseudo** est rattaché automatiquement (inscription ET connexion, phase inscription ET tournoi en cours) → il reçoit les pushs
- 🔒 **Compte connecté = pas d'inscription anonyme** : l'accueil ne propose que le bouton 1-clic du compte (pas de champ pseudo), et `POST /api/joueur` refuse avec **409 `compte_connecte`** ; l'inscription passe par `/api/tournoi/inscrire`
- ♻️ **Self-désinscription** : un compte connecté peut se retirer lui-même du tournoi (bouton « Me désinscrire » sur l'accueil et `/compte.html`, `DELETE /api/tournoi/desinscrire`) tant que les inscriptions sont ouvertes **et qu'il n'a pas payé** (**409 `deja_paye`** sinon ; le bouton est masqué au joueur payé, qui est invité à voir la table de marque) — action loguée `desinscription` (`self: true`). Un joueur déjà payé ou sans compte reste désinscriptible par un admin uniquement (remboursement à gérer par le club).
- Compte joueur oublie son pseudo/mdp : `/admin-comptes.html` → ✏️ pseudo / 🔑 mdp (sessions invalidées)

## 3. Tirage au sort

- Dès la création du tournoi, `/tableau.html` affiche déjà la **structure à vide** (même câblage que le futur tirage) : tour 1 en `j1` … `jN` (ex. j1 à j32 pour un tableau de 32), tours suivants en « gagnant wb1-001 » / « perdant lb2-003 ». Ces matchs sont **virtuels** (`virtuel: true`, ids `v1`…, non cliquables) : rien n'est écrit en base
- Bouton **Tirage** : appariements aléatoires (crypto), blancs (bye) répartis, le gagnant d'un bye passe directement
- ⚠️ Le tirage fige le bracket WB + LB (+ tableau final F en DKO). Après, on ne peut plus re-générer sans tout perdre

## 4. Lancer les matchs

- **Mode auto** 🎖️ ON : chaque match prêt part seul sur une table libre, dans l'ordre des tables (champ personnalisable, ex. `3,4,5,6,7,8,1,2`)
- Lancement manuel : clic sur une card (avec le PIN) → modale → table choisie
- Au lancement, les 2 joueurs font le **tirage à la bande** sur la card (panneau 🎲) : le gagnant a la **⚪** et casse en premier ; ensuite **alternance stricte** à chaque manche
- Règles de saisie joueurs : seul le ⚪ peut « 💥 casse ferme », l'autre « 🎯 reprise ferme » (boutons grisés + 403 serveur) ; **dernier point** → modale de confirmation (anti-fausse manip)

## 5. Interventions pendant le tournoi (modale « ⚙️ Gérer le match »)

Clic sur une card avec le PIN saisi → modale avec **joueurs / table / score / rouvrir / forfait**.

| Action | Comment | Impacts | Risques |
|---|---|---|---|
| **Changer les joueurs** (👥, WB ou LB, blanc possible) | `POST /admin/match/:id/joueurs` | Maj immédiate, broadcast SSE, audit. Blanc sur match `prevu` → bye auto (uniquement si le feeder du côté blanc est terminé) | **409 automatique** si la paire est déjà appariée (jouée ou prévue) dans un autre match, hors finale — le rematch est impossible |
| **Déplacer de table** (🎱) | `POST /admin/match/:id/table` | 409 si table occupée ; `null` pour libérer | Aucun, juste la TV/cards qui suivent |
| **Corriger le score** (✏️) | `POST /admin/match/:id/correction` (scores absolus) | Si la distance est atteinte → le match se termine et propage le gagnant | ⚠️ Si le match était terminé, l'aval est annulé en cascade (voir rouvrir) |
| **Rouvrir un match** (🔓) | `POST /admin/match/:id/rouvrir` | **409 interdit si un match aval a déjà commencé/reçu un joueur** | Corriger alors à la main les matchs suivants (joueurs/score) |
| **Forfait** (🚫) | `POST /admin/match/:id/forfait` (joueur perdant) | Le gagnant (l'autre) propage, le perdant part en LB (DKO) | Le forfait est définitif dans l'historique |

⚠️ **Règles structurelles à connaître** (DKO) : WB et LB ne se croisent qu'en finale ; swap anti-rematch automatique sur **tous les tours WB/LB/F** à chaque propagation (tant qu'un match partenaire du tour permet un échange propre).

**Anti-rematch strict (garanti)** : aucun match ne peut démarrer (`lancer`), ni finir par forfait/correction, avec une paire de joueurs déjà appariée ailleurs — **409 « Rematch interdit hors finale »** après un dernier sweep du tour. Seule exception : le dernier tour d'un bracket à **1 seul match** (vraie finale F, ou dernier tour LB s'il n'en reste qu'un). Les swaps sont logués dans l'audit (`rematch_swap_f` / `_lb` / `_wb`). Test de simulation complet avec invariant vérifié après chaque mutation : `test/simu-invariants.js`.

## 6. Gestion des données (`/admin-data.html`, lien « 🗄 Données »)

- Sélecteur de tournoi (actif **ou terminé** = corrections historiques) + filtre par pseudo (Entrée)
- Onglet **Matchs** : liste + modale ⚙️ + accès 📜 events
- Onglet **Joueurs** : éditer pseudo/statut (💾), supprimer (🗑)
- Onglet **Events** : 🗑 supprime un event → **score recalculé** → stats corrigées automatiquement

## 7. Classement par points

- Points = **profondeur atteinte** (WB: n° de tour; en DKO, F tour t = k+tour)
- **Ex-aequo** : 3 joueurs à 5 pts = 1er,1er,1er puis 4ème
- Matchs clôturés sans gagnant = ni joués ni perdus

## 8. Clôturer le tournoi

- **Terminer maintenant** : coupe net — **aucun champion automatique** (sauf si tu choisis explicitement un joueur dans le select « Champion »)
- Fin normale : la finale F déclare le champion automatiquement
- Le tournoi part dans l'historique (`/admin-historique.html` ou `/historique.html`) : détail en **liste de matchs** avec surbrillance d'un joueur (champ recherche, validé par Entrée)

## 9. Comptes joueurs (`/admin-comptes.html`)

- Liste : pseudo, email, créé le, **dernière connexion**, nb inscri. tournois, matchs, sessions actives, **amis** (amis avec compte + pseudos suivis sans compte)
- Recherche pseudo/email (Entrée), actions : ✏️ pseudo, 🔑 mdp, 🗑 supprimer (détache les joueurs — l'historique des matchs est conservé — supprime sessions/push, logué audit)
- **Purge auto** : comptes sans connexion depuis **18 mois** supprimés au boot + toutes les heures

### 9.1 🔒 Comptes cloisonnés par club (multi-club)

- **Chaque club a son propre espace de comptes** : une isolation stricte : des comptes cloisonnés par club. Un compte créé depuis le contexte d un club appartient à ce club, définitivement.
- **Le club est figé à la création** : créer un compte depuis les pages d un club (ou son URL `?club=`) le lie à CE club ; se connecter depuis un autre club ne crée jamais de lien (401 : le compte n existe pas dans ce club là).
- **Pseudo et email uniques PAR club** : deux clubs peuvent chacun avoir leur « Seb » ou le même email ; dans le même club, doublon refusé (409).
- **La liste des comptes (`/admin-comptes.html`) ne montre que VOTRE club** avec votre code PIN : un compte créé dans un autre club n apparaît pas chez vous ; le super-admin (code global) voit tous les clubs.
- **Amis, recherche et « mot de passe oublié » sont scopés** : tout se passe dans le club du compte ; l oubli ne révèle jamais si un email existe dans un autre club (réponse générique).
- **Un compte d un autre club ne peut pas s inscrire à vos tournois** (409) ; son pseudo reste utilisable en joueur anonyme chez vous.
- Les comptes rattachés via `compte_club` (staff multi-club) restent visibles dans les clubs concernés.

### 9.2 👑 Rôle club depuis la table de marque (multi-club)

- **Sélecteur « Club : aucun / 🛠 opérateur / 👑 admin »** en face de chaque compte de votre club dans `/admin-comptes.html`, visible dès que vous pouvez gérer les rôles : **le code PIN de votre club suffit**, ou une session admin du club (ou le code global).
- **Le code de votre club suffit pour nommer un admin** : choix assumé, c est votre club, votre code ; toute personne qui a le code peut promouvoir (y compris son propre compte une fois connecté). Le nouveau code PIN d un club ne peut rien sur les autres clubs.
- Un **admin du club** se connecte (pseudo + mdp) et administre le club **sans jamais taper le PIN**, confirmations destructives levées ; un **opérateur** garde les routes admin du club mais ne gère ni les rôles ni les actions destructives (code exigé).
- Le sélecteur n apparaît que pour les comptes DE votre club (isolation stricte) ; le super-admin de la plateforme conserve l attachement cross-club (staff multi-club) depuis la console super-admin.
- **Retirer un rôle** : sélecteur sur « Club : aucun », confirmation par le code (ou mot de confirmation pour une session admin). Les sessions du compte perdent immédiatement l accès admin du club.

### 9.3 🛡️ Console super-admin (`/console.html`) et vue « tous les clubs »

- **La page Comptes est TOUJOURS cloisonnée au club sélectionné** : même avec le code global (super-admin), la liste ne montre que les comptes du club du contexte. Le tenant principal ne voit plus les comptes créés dans les autres clubs.
- **Personnaliser un club à distance** (couleur d accent + logo + défauts de tournoi, section « Outils divers ») : panneau « 🎨 Personnalisation du club ».
- Pour voir **tous les comptes de la plateforme** : 🛡️ **Console super-admin** (`/console.html`, entrée « 🛡️ Console » de l accueil admin ; `clubs.html` redirige vers elle), panneau « 👥 Comptes de la plateforme » : pseudo, club d origine, rôle plateforme, rôles club, dernière connexion — et réglage du rôle plateforme par compte (`user` / `👑 admin` legacy / `🛡️ super_admin`).
- **La console n appartient à AUCUN club** : routes `/api/super/*` sans contexte de club ; accès par le code global ou un compte `super_admin` (`👑 admin` legacy accepté) ; un code de club ou une session de club y reçoit toujours 401/403, les gestes sensibles demandent le code global en confirmation. Elle regroupe la gestion des clubs (création, PIN, actif, rôles, suppression) et la sauvegarde complète de la base (voir §13).
- **Accès support** : sélecteur « 🚪 Accès aux pages d un club » pour ouvrir l admin d un club précis dans son contexte explicite (X-Club) ; le club par défaut (ebpc) reste protégé (non supprimable, non désactivable).
- Un code de club (ou une session de club) ne peut jamais forcer cette vue globale : le paramètre est ignoré côté serveur.

## 10. Journal d'audit + rollback point-in-time (`/admin-journal.html`)

Toutes les actions admin (créations, lancements — lisibles « wb1-001 — P11 vs P07 (table 3) » —, changements joueurs/table, rouvrir, forfaits, suppressions, swaps anti-rematch…) — **500 dernières entrées du club courant** (multi-club : le journal est scopé `club_id`, comme les snapshots).

- Filtres : champ texte (`?q=`, dans action/cible/détails) + champ action exacte (`?action=`), Entrée pour valider
- Chaque entrée a un **snapshot** du tournoi actif du club (`has_snapshot`) : table `audit_snapshot`, **200 snapshots max par tournoi**, **purge auto > 90 jours** au boot
- Bouton **⏪ Restaurer à ce point** (1re colonne) : affiche d'abord le **diff** (`GET /api/admin/tournoi/rollback/diff?audit_id=…` : matchs modifiés/ajoutés/supprimés, joueurs, statut, champion) dans la confirmation, puis demande le code PIN, puis restaure via `POST /api/admin/tournoi/rollback {audit_id, confirm_pin}` — **transaction atomique** (tout ou rien, FK différées), fonctionne **même avec des matchs en cours** (scores remis à 0, tables libérées, événements supprimés), 409 si le snapshot concerne un autre tournoi, 404 si pas de snapshot. Le rollback est lui-même logué. La page se re-rend en place (zoom/scroll conservés)

### 10.1 ⏮ Rollback point-in-time — mode d’emploi

**Où :** `/admin-journal.html`, 1re colonne de chaque entrée snapshotée : bouton **⏮ « Restaurer à ce point »**.

**Étapes concrètes :**
1. Repérer l’événement auquel revenir (le journal affiche action + cible + avant/après ; filtres `?q=`/`?action=` pour chercher, ex. `?q=wb1-001`).
2. Clic sur **⏮** → la confirmation affiche d’abord le **diff** (`GET /api/admin/tournoi/rollback/diff?audit_id=…` : matchs modifiés/ajoutés/supprimés avec avant/après, joueurs, statut, champion).
3. Saisir le code (PIN re-saisi `confirm_pin`, ou mot `SUPPRIMER` si session compte admin) → restauration via `POST /api/admin/tournoi/rollback {audit_id, confirm_pin}`.

**Ce qui est restauré :** le tournoi actif du club à l’état exact du snapshot — joueurs, matchs (scores, états, liens suivant/perdant), événements, tables, distances, statut, champion. **Transaction atomique** (tout ou rien, FK différées au COMMIT).

**Cas particuliers :**
- Fonctionne **même avec des matchs en cours** : ils repassent à 0-0 « prêt », tables libérées, événements supprimés.
- **409** si le snapshot concerne un autre tournoi que l’actif du club courant ; **404** si pas de snapshot.
- Le rollback est **lui-même logué** (action `rollback`) — on peut annuler un rollback.
- La page se re-rend en place (zoom/scroll conservés).
- Limites : 200 snapshots max par tournoi, purge auto > 90 jours — au-delà, rollback impossible (d’où l’export JSON régulier depuis /admin-tournoi.html 💾).

### 10.2 🔐 Confirmation par code re-saisi (actions destructives)

Toute action admin qui **supprime des données** exige le **code PIN re-saisi** dans le body (`confirm_pin`, 401 sinon), via une **modale à mot de passe masqué** — pas seulement la session déjà ouverte :
- `DELETE /api/admin/tournoi` (tournoi actif), `DELETE /api/admin/tournoi/:id`, `DELETE /api/admin/compte/:id`, `DELETE /api/admin/match/:id/event/:id`, `DELETE /api/admin/audit` (vidage), `POST /api/admin/tournoi/rollback`
- **Seule exception** : `DELETE /api/admin/joueur/:id` (désinscription d'un joueur) ne demande pas le code
- Une **session de compte `admin`** est dispensée de `confirm_pin` (le PIN n'est pas redemandé), mais une **modale de confirmation par saisie du mot `SUPPRIMER`** reste obligatoire ; sinon le code re-saisi est obligatoire

## 11. Outils divers

### 🎨 Apparence du club : couleur d accent, logo + réglage des défauts de tournoi

**Où :** panneau « 🎨 Apparence du club » de `/admin.html` (l accueil de la table de marque), visible de tout admin du club (code ou session), confirmation supplémentaire inutile (réglage non sensible : jamais de PIN, jamais de suppression).

- **Couleur d accent** (sélecteur de couleur) : remplace le rose de l interface sur **toutes les pages du club, pour tous les visiteurs** (boutons, liens, tableau, fil du tournoi). Elle est appliquée par le navigateur via les variables CSS, avec un cache local pour éviter un flash de couleur au chargement. Quelle que soit la teinte choisie (même sombre), les textes qui en dérivent (grands scores de la page match, scores des cards, liens) restent lisibles dans les deux thèmes : la teinte claire est recalculée automatiquement selon le thème, et le gros score de la page match est peint depuis la couleur de texte du thème (jamais de zone colorée à la place des chiffres). Les boutons (texte blanc) sont protégés de la même façon : un accent très clair (blanc, pastel) est automatiquement assombri pour leur fond, afin que les libellés restent lisibles. La page TV reste sur le thème sombre d origine. Laisser le rose d origine est parfaitement valable.
- **Nom par défaut des tournois** (ex : « Open du Mercredi »), **jour récurrent** et **heure habituelle** : pré-renseignent le formulaire de création de tournoi (`Date et heure` calculée sur le prochain jour récurrent à l heure habituelle). Aucun tournoi n est jamais créé automatiquement : ce ne sont que des valeurs proposées.
- **Logo du club** (17k) : au choix dans la **galerie de logos prédéfinis** (bille noire, bille 8, queue, triangle, table, étoile, bouclier, couronne, flamme, cercle) ou **import d une image perso** (PNG/JPG/SVG, réduite automatiquement à 256 px, 300 Ko max). Il est affiché pour tous les visiteurs, au choix grâce au switch **« Affichage du logo »** (trois boutons : « Logo d en-tête », « Filigrane », « Logo + filigrane », par défaut les deux) : en **filigrane très discret** centré (10 % d opacité, affiché par-dessus les pages pour rester visible, sans jamais gêner les clics ni la sélection), et/ou en **petit logo à côté du nom du club** dans l en-tête. « Aucun logo » retire tout. L aperçu est immédiat sur la page admin. La page TV reste sans logo (thème sombre d origine).
- Enregistrer : message de confirmation + application immédiate de la couleur et du logo (aperçu).
- Le super-admin peut régler la personnalisation de **n importe quel club** à distance depuis la 🛡️ Console (panneau « 🎨 Personnalisation du club », section 9.3) : couleur d accent, logo (même galerie et même import) et défauts de tournoi, utile pour ré-harmoniser un club en support.


- **Simuler tout le tournoi** (scores aléatoires jusqu'au bout) — test/démo
- **TV** (`/tv.html`) : matchs en cours uniquement (8/page), QR en coin ; en phase inscription : grand QR centré
- **Tableau** (`/tableau.html`) : bracket (défaut) ou liste (toggle, `?vue=liste`), filtre joueur (Entrée)
- Stats joueurs (`/stats.html`, fiches `/joueur.html?id=`), matchs contre blanc exclus des stats

## 12. Tests & déploiement

```bash
# serveur frais sur DB temporaire, puis:
BASE=http://127.0.0.1:PORT node test/batterie.js   # 203 checks → test/rapport.md (rollback, confirm_pin, slots, byes, rematch 409, robustesse, export/import, diff, filtres, pseudos réservés…)
BASE=http://127.0.0.1:PORT [NO_MANUEL=1] [SEED=…] node test/simu-invariants.js   # simus randomisées 32j DKO k=1/2/3 + 32j simple + 16j, interventions admin aléatoires, invariant anti-rematch après chaque mutation
BASE=http://127.0.0.1:PORT node test/e2e.js         # structure DKO, distances LB, SSE
BASE=http://127.0.0.1:PORT node test/fullrun.js     # simulations complètes (16/32 joueurs, simple + DKO)
node test/push-unit.js                              # push « inscriptions ouvertes » (web-push mocké) + cleanup 410/404
node test/purge-unit.js                             # purge auto audit_log/audit_snapshot > 90 j au boot
```

Fly.io : secrets `ADMIN_PIN`, `RESEND_API_KEY`, `MAIL_FROM`, `VAPID_*` (ne JAMAIS définir `BASE_URL`) ; volume `tournoi_data` sur `/data` ; snapshots dans Volumes → Snapshots pour restaurer.

## 13. 💾 Sauvegarde / restauration de la base (`/console.html`)

**Où :** panneau « 💾 Base complète de la plateforme » de la 🛡️ **Console super-admin** (`/console.html`). (Ce panneau a déménagé de `/admin-data.html` ; la page Données de chaque club garde uniquement la sauvegarde du club.)

- **Sauvegarder** : bouton « ⬇️ Télécharger la sauvegarde (JSON) » → télécharge un fichier `base-AAAA-MM-JJ-HH-MM-SS.json` contenant TOUTE la base : tous les clubs, tournois (même terminés), joueurs, comptes (hashs, pas de mots de passe en clair), matchs, events, journal d'audit. À conserver en lieu sûr (cloud perso + clé USB par exemple).
- **Restaurer** : bouton « ⬆️ Restaurer depuis un fichier… » → choisir un fichier JSON d'export → confirmation → la base actuelle est ENTIÈREMENT REMPLACÉE par le contenu du fichier (transaction : tout ou rien, aucune donnée mixée).
- **Réservé au super-admin** (code global ou compte super_admin / admin global) : un code PIN ou une session de club reçoit 401/403, il ne peut ni télécharger ni restaurer la base des autres clubs. La confirmation destructive reste exigée (code global re-saisi ou mot `SUPPRIMER` en session).
- Fréquence conseillée : un export après chaque tournoi terminé, et avant toute opération risquée (migration, gros correctif). C'est le complément des snapshots du volume Fly (infrastructure).

### 💾 Données du club : sauvegarde / restauration

**Où :** panneau « 💾 Données du club : sauvegarde / restauration » de `/admin-data.html`, visible de tous les admins du club (la sauvegarde « base complète » vit désormais dans la 🛡️ Console super-admin).

- **Sauvegarder** : bouton « 📤 Télécharger la sauvegarde du club (JSON) » → fichier `club-<slug>-AAAA-MM-JJ-HH-MM-SS.json` contenant UNIQUEMENT les données de votre club (tournois même terminés, joueurs, matchs, events, journal, snapshots). Ni les comptes, ni les emails, ni les données des autres clubs.
- **Restaurer** : bouton « 📥 Restaurer le club depuis un fichier… » → la restauration REMPLACE les données actuelles du club par le fichier, uniquement si le fichier provient du même club (sinon refus clair, jamais de mélange). Les autres clubs et les comptes ne sont jamais touchés ; transaction intégrale (tout ou rien) + confirmation destructive exigée.
- **Ouvert à votre code de club** : c est la sauvegarde de VOTRE club, à faire avant chaque tournoi et après chaque clôture. Une sauvegarde de club ne restaure ni les comptes rattachés ni le PIN du club (gérés par le super-admin) ; en cas d ids incompatibles (base divergente), demandez plutôt la restauration de la base complète au super-admin.

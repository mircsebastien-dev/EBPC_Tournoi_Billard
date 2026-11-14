# ⚙️ Guide admin — Table de marque (EBPC / Pink City Billard)

Accès : `/admin.html` → **code PIN** (variable `ADMIN_PIN` sur Fly). Toutes les routes `/api/admin/*` exigent le PIN (401 sinon). Seules les données publiques (tableau, TV, stats, historique) sont visibles sans PIN.

---

## 1. Créer le tournoi (`/admin-tournoi.html`)

- Nom, règle (blackball/ultimate), taille (16/32/64/128), format : **élimination directe** ou **double KO** (préciser le nombre de tours DKO), nombre de tables, date/heure, lieu, têtes de série
- **Ajustement auto** : la taille se réduit automatiquement au nombre de joueurs payés (puissance de 2)
- Switch **🔔 Notif push « inscriptions ouvertes »** (coché par défaut) : à la création, tous les comptes abonnés reçoivent une notif push « 🎱 Nouveau tournoi — inscriptions ouvertes »
- Un seul tournoi actif à la fois
- ⚠️ **Tables réservées** : vide par défaut (aucune réservation). Remplir ex. `1,2` pour réserver des tables à partir des quarts
- Une fois créé (statut `inscription`) : la **TV affiche un grand QR code centré** pour que les joueurs s'inscrivent depuis leur téléphone

## 2. Inscriptions

- Ajouter un joueur (pseudo), **simuler** N joueurs, marquer **payé**, supprimer
- Seuls les joueurs **payés** sont tirés au sort
- Un joueur inscrit en invité (sans compte) qui crée plus tard un compte avec le **même pseudo** est rattaché automatiquement (inscription ET connexion, phase inscription ET tournoi en cours) → il reçoit les pushs
- Compte joueur oublie son pseudo/mdp : `/admin-comptes.html` → ✏️ pseudo / 🔑 mdp (sessions invalidées)

## 3. Tirage au sort

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
| **Changer les joueurs** (👥, WB ou LB, blanc possible) | `POST /admin/match/:id/joueurs` | Maj immédiate, broadcast SSE, audit. Blanc sur match `prevu` → bye auto | ⚠️ Peut créer un **rematch** (deux joueurs déjà joués) — le swap anti-rematch ne s'applique qu'en F et à la propagation auto, pas à un changement manuel. Vérifie avant |
| **Déplacer de table** (🎱) | `POST /admin/match/:id/table` | 409 si table occupée ; `null` pour libérer | Aucun, juste la TV/cards qui suivent |
| **Corriger le score** (✏️) | `POST /admin/match/:id/correction` (scores absolus) | Si la distance est atteinte → le match se termine et propage le gagnant | ⚠️ Si le match était terminé, l'aval est annulé en cascade (voir rouvrir) |
| **Rouvrir un match** (🔓) | `POST /admin/match/:id/rouvrir` | **409 interdit si un match aval a déjà commencé/reçu un joueur** | Corriger alors à la main les matchs suivants (joueurs/score) |

### 🗄 Gestion des données (`/admin-data.html`, lien « 🗄 Données »)
- Sélecteur de tournoi (actif **ou terminé** = corrections historiques) + filtre par pseudo (Entrée)
- Onglet **Matchs** : liste + modale ⚙️ + accès 📜 events
- Onglet **Joueurs** : éditer pseudo/statut (💾), supprimer (🗑)
- Onglet **Events** : 🗑 supprime un event → **score recalculé** → stats corrigées automatiquement

### ⭐ Classement par points
Points = **profondeur atteinte** (WB: n° de tour; en DKO, F tour t = k+tour), **ex-aequo** (3 joueurs à 5 pts = 1er,1er,1er puis 4ème). Matchs clôturés sans gagnant = ni joués ni perdus.
| **Forfait** (🚫) | `POST /admin/match/:id/forfait` (joueur perdant) | Le gagnant (l'autre) propage, le perdant part en LB (DKO) | Le forfait est définitif dans l'historique |

⚠️ **Règles structurelles à connaître** (DKO) : WB et LB ne se croisent qu'en finale ; en F, alternance des moitiés + swap anti-rematch automatique jusqu'à la vraie finale (rematch autorisé en finale uniquement).

## 6. Clôturer le tournoi

- **Terminer maintenant** : coupe net — **aucun champion automatique** (sauf si tu choisis explicitement un joueur dans le select « Champion »)
- Fin normale : la finale F déclare le champion automatiquement
- Le tournoi part dans l'historique (`/admin-historique.html` ou `/historique.html`) : détail en **liste de matchs** avec surbrillance d'un joueur (champ recherche, validé par Entrée)

## 7. Comptes joueurs (`/admin-comptes.html`)

- Liste : pseudo, email, créé le, **dernière connexion**, nb inscri. tournois, matchs, sessions actives
- Recherche pseudo/email (Entrée), actions : ✏️ pseudo, 🔑 mdp, 🗑 supprimer (détache les joueurs — l'historique des matchs est conservé — supprime sessions/push, logué audit)
- **Purge auto** : comptes sans connexion depuis **18 mois** supprimés au boot + toutes les heures

## 8. Journal d'audit + rollback point-in-time (`/admin-journal.html`)

Toutes les actions admin (créations, lancements — lisibles « wb1-001 — P11 vs P07 (table 3) » —, changements joueurs/table, rouvrir, forfaits, suppressions, swaps anti-rematch…) — **500 dernières entrées**.

- Chaque entrée a un **snapshot** du tournoi actif (`has_snapshot`) : table `audit_snapshot`, **200 snapshots max par tournoi**, **purge auto > 90 jours** au boot
- Bouton **⏪ Restaurer à ce point** (1re colonne) : restaure le tournoi actif à l'état exact de l'événement via `POST /api/admin/tournoi/rollback {audit_id}` — **transaction atomique** (tout ou rien, FK différées), fonctionne **même avec des matchs en cours** (scores remis à 0, tables libérées, événements supprimés), 409 si le snapshot concerne un autre tournoi, 404 si pas de snapshot. Le rollback est lui-même logué. La page se re-rend en place (zoom/scroll conservés)

### 🔐 Confirmation par code re-saisi (actions destructives)

Toute action admin qui **supprime des données** exige le **code PIN re-saisi** dans le body (`confirm_pin`, 401 sinon), via une **modale à mot de passe masqué** — pas seulement la session déjà ouverte :
- `DELETE /api/admin/tournoi` (tournoi actif), `DELETE /api/admin/tournoi/:id`, `DELETE /api/admin/compte/:id`, `DELETE /api/admin/match/:id/event/:id`, `DELETE /api/admin/audit` (vidage), `POST /api/admin/tournoi/rollback`
- **Seule exception** : `DELETE /api/admin/joueur/:id` (désinscription d'un joueur) ne demande pas le code

## 9. Outils divers

- **Simuler tout le tournoi** (scores aléatoires jusqu'au bout) — test/démo
- **TV** (`/tv.html`) : matchs en cours uniquement (8/page), QR en coin ; en phase inscription : grand QR centré
- **Tableau** (`/tableau.html`) : bracket (défaut) ou liste (toggle, `?vue=liste`), filtre joueur (Entrée)
- Stats joueurs (`/stats.html`, fiches `/joueur.html?id=`), matchs contre blanc exclus des stats

## 10. Tests & déploiement

```bash
# serveur frais sur DB temporaire, puis:
BASE=http://127.0.0.1:PORT node test/batterie.js   # 120 checks → test/rapport.md (rollback, confirm_pin, slots, byes…)
BASE=http://127.0.0.1:PORT node test/e2e.js         # structure DKO, distances LB, SSE
BASE=http://127.0.0.1:PORT node test/fullrun.js     # simulations complètes (16/32 joueurs, simple + DKO)
node test/push-unit.js                              # push « inscriptions ouvertes » (web-push mocké) + cleanup 410/404
node test/purge-unit.js                             # purge auto audit_log/audit_snapshot > 90 j au boot
```

Fly.io : secrets `ADMIN_PIN`, `RESEND_API_KEY`, `MAIL_FROM`, `VAPID_*` (ne JAMAIS définir `BASE_URL`) ; volume `tournoi_data` sur `/data` ; snapshots dans Volumes → Snapshots pour restaurer.

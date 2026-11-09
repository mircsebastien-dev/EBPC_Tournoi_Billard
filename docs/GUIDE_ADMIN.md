# ⚙️ Guide admin — Table de marque (EBPC Tournoi Billard)

Accès : `/admin.html` → **code PIN** (défini par la variable d'environnement `ADMIN_PIN` sur Fly). Le PIN est vérifié côté serveur à chaque action.

## 1. Créer un tournoi
`/admin-tournoi.html` → **Configurer / gérer le tournoi** :
- Nom, règle (Blackball / Ultimate), taille (16/32/64), format (élimination directe / double KO avec k tours), nombre de tables, date/heure, lieu, têtes de série, ajustement auto de la taille au nombre de payés
- ⚠️ Un seul tournoi actif à la fois

## 2. Inscriptions
- Ajouter un joueur (pseudo), simuler N joueurs, marquer **payé**, supprimer un joueur
- Le tirage ne prend que les joueurs **payés**

## 3. Tirage au sort
Bouton **Tirage** : appariements aléatoires (crypto), blancs (bye) répartis, gagnant d'un bye passe directement.

## 4. Lancer les matchs
- **Mode auto** 🎖️ : ON → chaque match prêt part tout seul sur une table libre (ordre des tables personnalisable, ex. `3,4,5,6,7,8,1,2`)
- **Tables réservées en phase finale** : champ « Tables réservées » (défaut `1,2`) — à partir des quarts (calculé selon la taille, surchargeable), ces tables ne sont plus utilisées en auto
- Lancement manuel aussi possible (clic sur une card, choix de la table)
- Au lancement : **tirage à la bande** à déclarer sur la card par un des joueurs (⚪ = premier casseur, puis alternance à chaque manche)

## 5. Suivi en cours
- Tableau (bracket/liste + recherche joueur), TV, scores en direct (SSE)
- Corrections possibles sur une card (admin) : retirer une manche, forfait, rouvrir un match
- Règles de saisie côté joueurs : seul le ⚪ peut « casse ferme », l'autre « reprise ferme » ; confirmation obligatoire sur le dernier point

## 6. Clôturer
Bouton **Terminer le tournoi** → champion enregistré, le tournoi part dans l'historique (consultable en liste avec recherche par joueur).

## 7. Comptes joueurs
`/admin.html` → **👤 Comptes joueurs** : liste (pseudo, email, création, **dernière connexion**, joueurs rattachés, matchs), recherche, **suppression** (détache les joueurs, supprime sessions/push ; l'historique des matchs est conservé).
⚠️ Purge automatique : les comptes sans connexion depuis **18 mois** sont supprimés automatiquement (au boot + toutes les heures).

## 8. Journal d'audit
`/admin.html` → **📜 Journal** : toutes les actions admin (création, lancements, forfaits, suppressions de comptes…), 200 dernières entrées.

## 9. Historique des tournois
`/admin-historique.html` (ou `/historique.html` public) : liste des tournois terminés → détail en liste de matchs + surbrillance d'un joueur.

## 10. Déploiement (Fly.io)
- Secrets : `ADMIN_PIN`, `RESEND_API_KEY`, `MAIL_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (ne JAMAIS définir `BASE_URL`)
- Volume `tournoi_data` monté sur `/data` (SQLite) ; snapshots dans Volumes → Snapshots
- `app.listen` sur `0.0.0.0` (déjà en place)
- En cas de panne de host : créer un nouveau volume depuis un snapshot + nouvelle machine (voir docs/DEPLOiement si besoin)

## 11. Tests
```bash
BASE=http://127.0.0.1:PORT node test/batterie.js   # 63 checks, génère test/rapport.md
```

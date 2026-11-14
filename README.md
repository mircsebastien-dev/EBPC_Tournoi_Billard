# EBPC — Tournoi de billard « Eight Ball Pink City »

Gestionnaire de tournois de billard (règles **blackball** ou **ultimate**) : inscription, tirage au sort, tableaux en **élimination directe** ou **double KO partiel** (paramètre 1/2/3 tours) puis tableau final, matchs en direct avec saisie des scores par les joueurs, gestion des tables, écran TV castable. 100 % open source (MIT), stack Node.js + Express + SQLite + SSE.

Design **« Eight Ball Pink City »** : thème sombre noir profond avec accents néon rose, gros boutons tactiles, parcours simplifiés (mobile-first).

## Fonctionnalités

- Tournois jusqu'à **16 / 32 / 64 / 128** joueurs ; par défaut la **taille du tableau s'ajuste automatiquement au nombre de joueurs payés** au moment du tirage (ex. 5 payés → tableau de 8), désactivable pour forcer la taille max avec byes
- **3 manches gagnantes par défaut pour tous les matchs** (race to 3). La table de marque peut :
  - régler une **distance spéciale (3/5/7) à partir d'un seuil** (quarts / demis / finale) dans les paramètres,
  - **modifier les distances à tout moment**, même en cours de tournoi (appliqué aux matchs non joués)
- **Clôture manuelle** : la table de marque peut terminer le tournoi à tout moment (champion = dernier gagnant ou choix manuel)
- **Historique multi-tournois** : chaque tournoi terminé est archivé automatiquement et reste consultable (tableau complet, stats, classement) via `/historique.html` et `/tournoi.html?id=…` ; la table de marque peut **supprimer des tournois de l'historique** (bouton 🗑, `DELETE /api/admin/tournoi/:id`)
- **Stats joueurs all-time** (`/stats.html`, `GET /api/stats-joueurs`) : par pseudo sur tous les tournois — matchs joués/gagnés/perdus, % victoires, nombre de tournois, 🏆 titres
- **Statistiques live** : heure de début/fin et durée de chaque match (affichées sur les cartes), panneau stats (matchs joués/restants, durée moyenne, match le plus rapide/long, dernier vainqueur) et **classement des joueurs** (joués, gagnés, perdus, % victoires, série en cours) sur l'accueil et la TV
- **Droit d'inscription** : les joueurs s'inscrivent eux-mêmes (statut « en attente »), la table de marque valide le paiement (« 💰 payé ») ; **seuls les joueurs payés entrent dans le tirage**
- **Mode simulation** (table de marque) :
  - phase inscriptions : `POST /api/admin/joueurs/simulation {count, prefix}` inscrit des joueurs fictifs en masse (`Bot01…`), directement **payés** ;
  - tournoi en cours : bouton **▶ Simuler tout le tournoi** (`POST /api/admin/simuler`) joue automatiquement tous les matchs restants (scores aléatoires) jusqu'au champion, qui est archivé dans l'historique avec les stats all-time mises à jour
- **Inscriptions strictement liées à un tournoi** : on ne peut s'inscrire (public ou admin) qu'à un tournoi en statut « inscription » ; tant qu'un tournoi est « en cours » ou « terminé » sans successeur, l'inscription renvoie 409/404 explicite, et un nouveau tournoi ne peut être créé que lorsque le précédent est « terminé »
- **Élimination directe** ou **double KO partiel** (N = 1/2/3 tours) : les perdants des N premiers tours passent en loser bracket, puis **tableau final à élimination directe** entre tous les survivants, finale en 1 match
- **Distances paramétrables par round** : 3, 5 ou 7 manches gagnantes (défaut : 3 / 5 / 7 vers la fin)
- **Tirage aléatoire** ou avec **têtes de série**
- **Saisie live** des manches par les 2 joueurs (écran dédié par match), validation serveur (race to N)
- **Table de marque** (code PIN) : lancer les matchs, assigner une **table libre automatiquement** ou manuellement, corriger les scores, déclarer un forfait — chaque action est journalisée (audit)
- **Export / import JSON du tournoi** (boutons 💾 table de marque) + **diff affiché avant chaque rollback** + **filtres du journal d'audit** (texte + action)
- **Rollback point-in-time** : chaque action admin prend un **snapshot** du tournoi actif (table `audit_snapshot`, 200 max par tournoi, purge auto > 90 j) → dans le **journal d'audit**, « ⏪ Restaurer à ce point » restaure le tournoi actif à l'état exact de l'événement (transaction atomique, fonctionne même avec des matchs en cours : scores remis à 0, tables libérées)
- **Confirmation par code re-saisi** (`confirm_pin`) obligatoire pour **toute action admin destructive** (suppression tournoi / compte / événement de match, vidage du journal, rollback) via une modale à mot de passe masqué — seule la désinscription d'un joueur en est exempte
- **Notif push « 🎱 Nouveau tournoi — inscriptions ouvertes »** envoyée à tous les abonnés à la création d'un tournoi (switch sur le formulaire de création, **actif par défaut**)
- **Slots explicites** dans les tableaux : tant que les joueurs d'un match ne sont pas connus, les cartes affichent « gagnant wb1-001 » / « perdant lb2-003 » / « blanc » (une ligne par slot)
- **Byes exclus du classement** : un match contre blanc ne compte ni gagné ni perdu dans les stats
- **Email masqué** sur la page compte du joueur
- **Spectateurs** : accueil public + **page TV** (`/tv.html`) rafraîchie en temps réel (SSE), castable sur TV
- Un seul tournoi actif à la fois

## Prérequis

- Node.js >= 18 (20+ recommandé)
- Aucune base de données externe : SQLite embarqué (`tournoi.db`)

## Lancer en local

```bash
npm install
npm start          # http://localhost:3000
```

Variables d'environnement :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute |
| `ADMIN_PIN` | `0000` | Code PIN de la table de marque (**à changer en production**) |
| `DB_PATH` | `./tournoi.db` | Chemin du fichier SQLite |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | générées à la volée en dev | Clés web-push (**secrets en prod**, sinon les notifs ne marchent pas d'un déploiement à l'autre) |
| `VAPID_SUBJECT` | `mailto:admin@…` | Sujet VAPID (contact) |
| `RESEND_API_KEY` / `MAIL_FROM` | — | Envoi des emails (réinit mot de passe) ; en dev le lien est juste loggé |
| `PIN_MAX_ESSAIS` | `10` | Anti brute-force : nb max d'échecs PIN admin par IP dans la fenêtre avant lockout |
| `PIN_FENETRE_MS` | `600000` (10 min) | Fenêtre glissante de comptage des échecs PIN |
| `PIN_BLOCAGE_MS` | `600000` (10 min) | Durée du lockout (même le bon code est refusé, HTTP 429) |

Pages :

| URL | Rôle |
|---|---|
| `/` | Accueil public + inscription + tableau live + stats |
| `/tv.html` | Écran TV (plein écran, auto-refresh, stats) |
| `/tableau.html` | **Bracket visuel** (colonnes par round, liens SVG, surlignage live) |
| `/suivi.html` | Suivi joueur (sélection du pseudo, ses matchs) |
| `/match.html?id=<id>&joueur=<id>` | Écran de saisie live d'un match |
| `/historique.html` | Liste des tournois terminés (consultation + suppression admin) |
| `/tournoi.html?id=<id>` | Détail d'un tournoi archivé (tableau, stats, classement) |
| `/stats.html` | Statistiques joueurs all-time (tous tournois) |
| `/joueur.html?id=<id>` | Fiche joueur (stats + historique de ses matchs) |
| `/aide.html` | Aide joueur (inscription, push, saisie des scores…) |
| `/compte.html` | Compte joueur (email masqué, amis, notifs, export RGPD) |
| `/confidentialite.html` | Confidentialité / RGPD |
| `/admin.html` | Table de marque (PIN requis) + gestion de l'historique |
| `/admin-tournoi.html` | Création/config du tournoi, inscriptions, tirage, tables, distances |
| `/admin-journal.html` | Journal d'audit (500 entrées) + **rollback point-in-time** |
| `/admin-comptes.html` / `/admin-data.html` / `/admin-historique.html` | Comptes, données (matchs/joueurs/events), historique |
| `/admin-aide.html` | Guide admin in-app |

## Tests

```bash
PORT=4100 DB_PATH=/tmp/t.db ADMIN_PIN=0000 node src/server.js &   # serveur frais
BASE=http://127.0.0.1:4100 ADMIN_PIN=0000 node test/batterie.js    # 155 checks → test/rapport.md
BASE=http://127.0.0.1:4100 node test/e2e.js                        # structure DKO, SSE…
BASE=http://127.0.0.1:4100 node test/fullrun.js                    # simulations complètes 16/32 joueurs
node test/push-unit.js                                             # push (web-push mocké), sans serveur
node test/purge-unit.js                                            # purge audit/snapshots > 90 j au boot, sans serveur
BASE=http://127.0.0.1:4100 node test/simu-invariants.js           # simus randomisées 32j DKO k=2… + invariant anti-rematch après chaque mutation
```

## Déploiement sur un VPS (recommandé, ~5 €/mois)

Hetzner CX22 / OVH VPS-1 / équiv. Ubuntu 24.04 :

```bash
# 1. Installer Node.js 22 + Caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs caddy

# 2. Cloner et installer l'app
sudo mkdir -p /srv/tournoi && sudo chown $USER /srv/tournoi
cd /srv/tournoi
git clone https://github.com/mircsebastien-dev/EBPC_Tournoi_Billard.git .
npm install --omit=dev

# 3. Service systemd (démarrage auto + redémarrage)
sudo tee /etc/systemd/system/tournoi.service > /dev/null <<'EOF'
[Unit]
Description=EBPC Tournoi Billard
After=network.target
[Service]
Type=simple
WorkingDirectory=/srv/tournoi
Environment=PORT=3000
Environment=ADMIN_PIN=CHANGEZ_MOI
ExecStart=/usr/bin/node src/server.js
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now tournoi

# 4. Caddy en frontal (HTTPS Let's Encrypt automatique)
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
votre-domaine.example
reverse_proxy localhost:3000
EOF
sudo systemctl reload caddy

# 5. Sauvegarde quotidienne de la base (cron)
( crontab -l 2>/dev/null; echo "0 3 * * * cp /srv/tournoi/tournoi.db /srv/tournoi/backups/tournoi-\$(date +\%F).db" ) | crontab -
mkdir -p /srv/tournoi/backups
```

Mise à jour : `cd /srv/tournoi && git pull && npm install --omit=dev && sudo systemctl restart tournoi`

## Déploiement gratuit recommandé : Fly.io — 100 % navigateur (sans CLI locale)

Le dépôt contient `fly.toml` (app `ebpc-tournoi-billard`, région Paris `cdg`, `DB_PATH=/data/tournoi.db`, volume `tournoi_data` sur `/data`, machine jamais éteinte, 256 Mo). Fly.io construit **depuis GitHub**, aucune commande locale nécessaire (utile si un administrateur bloque les exécutables) :

1. Va sur [fly.io](https://fly.io) → **Sign up with GitHub** → autorise Fly à lire `mircsebastien-dev/EBPC_Tournoi_Billard`
2. Dashboard Fly → **Launch an App** → onglet **Deploy from GitHub** → choisis le dépôt + branche `main` → Fly détecte `fly.toml` automatiquement
3. **Create app** → choisis le nom `ebpc-tournoi-billard` (ou un autre dispo) et la région **Paris (cdg)**
4. Va dans l'app créée → **Volumes** → **Create volume** : nom `tournoi_data`, size **3 Go**, région `cdg` (gratuit, inclus)
5. **Secrets** (ou Variables) → ajoute `ADMIN_PIN` = ton code PIN table de marque
6. **Deploy** (ou laisse le déploiement auto depuis GitHub à chaque push sur `main`)
7. L'URL publique : **Overview** → `https://ebpc-tournoi-billard.fly.dev` (ou le nom choisi)

Le plan gratuit Fly.io inclut 3 VM shared-cpu-1x + 3 Go de volume + 160 Go de bande passante/mois : largement suffisant pour 128 joueurs, **pas de cold start**, base persistante sur le volume.

Variante CLI (si un jour tu as un PC libre) : voir ancienne procédure (`fly auth login`, `fly launch --no-deploy`, `fly volumes create tournoi_data --region cdg --size 3`, `fly secrets set ADMIN_PIN=...`, `fly deploy`).

## Alternative : Railway (volume payant mais crédits gratuits)

```bash
# Railway : New Project → Deploy from GitHub → dépôt + branche main
# Variables : ADMIN_PIN=..., DB_PATH=/data/tournoi.db
# Puis : Add Volume (1 Go) monté sur /data
```
Le dépôt contient `railway.json` (build/start). ~500 h/mois de crédit gratuit ; au-delà, le volume devient payant.

## Render (gratuit mais SANS persistance)

⚠️ Le plan gratuit Render **n'autorise pas les disques** : `tournoi.db` serait perdu à chaque redéploiement/sleep. Le `render.yaml` du dépôt reste présent pour un **test rapide** (ajoute juste `ADMIN_PIN` dans les variables d'env). Pour de la production gratuite, préfère Fly.io.

Dans tous les cas : `PORT` est fourni automatiquement par la plateforme, ne le fixe pas.

## Architecture

```
public/          pages (accueil, TV, tableau, suivi, match, admin, aide) + common.js
src/
  db.js          schéma SQLite + audit_log + audit_snapshot (purge > 90 j au boot)
  bracket.js     génération des tableaux (simple / double KO partiel / final)
  matchs.js      logique métier : manches, byes, propagation, forfaits, corrections
  comptes.js     auth, sessions, amis, RGPD
  push.js        VAPID + web-push (à toi de jouer, ami, inscriptions ouvertes)
  server.js      API REST + SSE + PIN admin (+ confirm_pin sur actions destructives + rollback)
```

- Le score d'un match est dérivé de la table `match_event` (événements immuables) : chaque manche déclarée est un événement, les corrections admin aussi.
- Temps réel : **SSE** (`GET /api/events`), un seul flux pour tous les clients.
- Sécurité : PIN admin en header `X-Admin-Pin` uniquement (jamais en query string, hash SHA-256 côté serveur) + **re-saisie du code (`confirm_pin`) pour toute action destructive** + **anti brute-force** (après `PIN_MAX_ESSAIS` échecs par IP → lockout `PIN_BLOCAGE_MS`, HTTP 429 même pour le bon code ; compteur remis à zéro en cas de succès) ; joueurs et spectateurs sans authentification, saisie validée serveur (joueur bien dans le match, match en cours, race to N).
- **Session table de marque limitée à 8 h** : le PIN mémorisé expire (re-saisie obligatoire) + bouton **🔒 Verrouiller** dans le menu admin pour l'effacer ; rate-limit des comptes keyé sur `x-forwarded-for` (IP réelle derrière le proxy Fly).
- **Robustesse** : middleware d'erreur global 100 % JSON (400 JSON malformé, 413 body > 256 ko, 404 JSON sur `/api/*`), `/api/health` (check BDD pour le monitoring), `unhandledRejection`/`uncaughtException` logués sans crash, arrêt propre SIGTERM/SIGINT (SSE fermés + `db.close()`), SQLite `synchronous=FULL` + WAL + `busy_timeout`, entrées nettoyées (pseudo tronqué à 40 caractères sans caractères de contrôle, toutes les requêtes paramétrées), XSS impossible côté front (`createTextNode` partout).
- Feuille de route produit (idées multi-club, poules, ELO…) : `docs/ROADMAP.md`

## Licence

MIT

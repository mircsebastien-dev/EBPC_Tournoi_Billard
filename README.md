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
- **Inscriptions strictement liées à un tournoi** : on ne peut s'inscrire (public ou admin) qu'à un tournoi en statut « inscription » ; tant qu'un tournoi est « en cours » ou « terminé » sans successeur, l'inscription renvoie 409/404 explicite, et un nouveau tournoi ne peut être créé que lorsque le précédent est « terminé »
- **Élimination directe** ou **double KO partiel** (N = 1/2/3 tours) : les perdants des N premiers tours passent en loser bracket, puis **tableau final à élimination directe** entre tous les survivants, finale en 1 match
- **Distances paramétrables par round** : 3, 5 ou 7 manches gagnantes (défaut : 3 / 5 / 7 vers la fin)
- **Tirage aléatoire** ou avec **têtes de série**
- **Saisie live** des manches par les 2 joueurs (écran dédié par match), validation serveur (race to N)
- **Table de marque** (code PIN) : lancer les matchs, assigner une **table libre automatiquement** ou manuellement, corriger les scores, déclarer un forfait — chaque action est journalisée (audit)
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

Pages :

| URL | Rôle |
|---|---|
| `/` | Accueil public + inscription + tableau live + stats |
| `/tv.html` | Écran TV (plein écran, auto-refresh, stats) |
| `/suivi.html` | Suivi joueur (sélection du pseudo, ses matchs) |
| `/match.html?id=<id>&joueur=<id>` | Écran de saisie live d'un match |
| `/historique.html` | Liste des tournois terminés (consultation + suppression admin) |
| `/tournoi.html?id=<id>` | Détail d'un tournoi archivé (tableau, stats, classement) |
| `/stats.html` | Statistiques joueurs all-time (tous tournois) |
| `/admin.html` | Table de marque (PIN requis) + gestion de l'historique |

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

## Déploiement sans serveur (PaaS)

Railway / Render / Fly.io : pousser ce dépôt, définir `ADMIN_PIN` et `PORT` (fourni par la plateforme). SQLite fonctionne en local sur le disque éphémère — pour la persistance, monter un volume sur `DB_PATH` (Fly.io/Railway) ou exporter régulièrement `tournoi.db`.

## Architecture

```
public/          pages (accueil, TV, suivi, match, admin) + common.js
src/
  db.js          schéma SQLite + audit
  bracket.js     génération des tableaux (simple / double KO partiel / final)
  matchs.js      logique métier : manches, byes, propagation, forfaits, corrections
  server.js      API REST + SSE + PIN admin
```

- Le score d'un match est dérivé de la table `match_event` (événements immuables) : chaque manche déclarée est un événement, les corrections admin aussi.
- Temps réel : **SSE** (`GET /api/events`), un seul flux pour tous les clients.
- Sécurité : PIN admin en header `X-Admin-Pin` (hash SHA-256 côté serveur) ; joueurs et spectateurs sans authentification, saisie validée serveur (joueur bien dans le match, match en cours, race to N).

## Licence

MIT

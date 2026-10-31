# EBPC — Tournoi de billard « Eight Ball Pink City »

Gestionnaire de tournois de billard (règles **blackball** ou **ultimate**) : inscription, tirage au sort, tableaux en **élimination directe** ou **double KO partiel** (paramètre 1/2/3 tours) puis tableau final, matchs en direct avec saisie des scores par les joueurs, gestion des tables, écran TV castable. 100 % open source (MIT), stack Node.js + Express + SQLite + SSE.

Design **« Eight Ball Pink City »** : thème sombre noir profond avec accents néon rose, gros boutons tactiles, parcours simplifiés (mobile-first).

## Fonctionnalités

- Tournois de **16 / 32 / 64 / 128** joueurs, byes automatiques si moins d'inscrits
- **Droit d'inscription** : les joueurs s'inscrivent eux-mêmes (statut « en attente »), la table de marque valide le paiement (« 💰 payé ») ; **seuls les joueurs payés entrent dans le tirage**
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
| `/` | Accueil public + inscription + tableau live |
| `/tv.html` | Écran TV (plein écran, auto-refresh) |
| `/suivi.html` | Suivi joueur (sélection du pseudo, ses matchs) |
| `/match.html?id=<id>&joueur=<id>` | Écran de saisie live d'un match |
| `/admin.html` | Table de marque (PIN requis) |

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

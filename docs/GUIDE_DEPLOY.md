# 🚀 Guide de déploiement : app de test + prod à la demande

Deux environnements Fly.io (région `cdg`), chacun avec **sa propre base SQLite sur son volume, jamais partagée** :

| Environnement | App Fly | URL | Déclenchement |
|---|---|---|---|
| **Test** | `ebpc-tournoi-billard-test` | https://ebpc-tournoi-billard-test.fly.dev | automatique : chaque push sur `main` avec CI verte (job `deploy-test`) |
| **Prod** | `ebpc-tournoi-billard` | https://ebpc-tournoi-billard.fly.dev | manuel : onglet Actions → « Déployer prod » → confirmation `PROD` |

**Le flux** : push sur `main` → CI complète (batterie, e2e, fullrun, simu, unitaires) → déploiement **test** automatique → validation sur le terrain (tournois de répétition, données de test, vrais usages) → quand c'est stable et livrable → **Déployer prod**.

Tant que la mise en place n'est pas finie, le job `deploy-test` reste vert avec une notice « déploiement sauté » (secret absent) : c'est voulu, tout reste visible dans l'onglet Actions.

## Mise en place (une seule fois, depuis ta machine avec la CLI fly connectée)

### 1. Créer l'app de test et son volume

```
fly apps create ebpc-tournoi-billard-test
fly volumes create tournoi_data --app ebpc-tournoi-billard-test --region cdg --size 1
fly secrets set ADMIN_PIN=<un-code-spe-pour-le-test> --app ebpc-tournoi-billard-test
```

Secrets utiles à recopier à la main depuis la prod si tu veux les tester ici (Fly ne lit jamais les secrets d'une autre app) : `RESEND_API_KEY`, `MAIL_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Règle de la SPEC conservée : jamais de secret `BASE_URL`.

### 2. Créer les tokens de déploiement (portée minimale : un token par app, aucun ne peut créer/supprimer une app ni lire les secrets)

```
fly tokens create deploy -a ebpc-tournoi-billard-test
fly tokens create deploy -a ebpc-tournoi-billard
```

Puis dans GitHub : repo → Settings → Secrets and variables → Actions → New repository secret :
- premier token → nom **`FLY_TEST_TOKEN`**
- second token → nom **`FLY_PROD_TOKEN`**

### 3. Couper l'auto-deploy GitHub de la prod

Aujourd'hui la prod se redéploie toute seule à chaque push sur `main` (intégration GitHub de Fly). Pour que le bouton « Déployer prod » devienne la seule porte :
- tableau de bord Fly.io, app `ebpc-tournoi-billard` : retire la source de déploiement liée à GitHub ; ou côté GitHub, Settings → Applications → Fly.io, reconfigure/supprime l'accès au repo ;
- vérification : après un push sur `main`, `fly releases -a ebpc-tournoi-billard` ne doit plus montrer de déploiement déclenché par GitHub.

Tant que ce point n'est pas fait, la prod continue de suivre `main` automatiquement (aucun danger, mais ce n'est pas le but recherché).

### 4. Premier déploiement de l'app de test

Pousse n'importe quel commit sur `main` : CI verte → `deploy-test` déploie l'app de test → https://ebpc-tournoi-billard-test.fly.dev répond.

## Routines

- **Passer en prod** : onglet Actions → workflow « Déployer prod » → Run workflow (branche `main`) → champ confirmation : `PROD`. La CI du commit est déjà passée (sinon `main` serait rouge), le déploiement reprend le HEAD de main.
- **Suivre un déploiement** : `fly releases -a ebpc-tournoi-billard-test`, `fly logs -a ebpc-tournoi-billard-test` (idem prod).
- **Réinitialiser la base de test** : `fly ssh console -a ebpc-tournoi-billard-test` puis `rm /data/tournoi.db*` et redémarrage de la machine ; ou détruire puis recréer le volume.
- **Charger une copie des données prod sur le test** (jamais l'inverse) : `fly volumes snapshots list tournoi_data -a ebpc-tournoi-billard` pour lister les snapshots, puis créer le volume test depuis un snapshot (`fly volumes create tournoi_data --app ebpc-tournoi-billard-test --region cdg --size 1 --snapshot-id <id>`, voir `fly volumes create --help`), et recopier à la main les secrets nécessaires.

## Sécurité

- Les secrets GitHub ne contiennent que des tokens de déploiement à portée unique app ; GitHub n'a jamais les secrets Fly (PIN, VAPID, Resend).
- Le mot de confirmation `PROD` du workflow manuel protège contre un déclenchement par erreur.
- L'app de test est publique : utilise un PIN admin différent de la prod, et souviens-toi que ce qui s'y joue n'est pas critique (c'est son rôle).

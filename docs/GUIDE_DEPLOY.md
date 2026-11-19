# 🚀 Guide de déploiement : flux à deux branches (staging → test, main → prod)

Deux environnements Fly.io (région `cdg`), chacun avec **sa propre base SQLite sur son volume, jamais partagée** :

| Environnement | App Fly | URL | Suit | Déclenchement |
|---|---|---|---|---|
| **Test** | `ebpc-tournoi-billard-test` | https://ebpc-tournoi-billard-test.fly.dev | branche **`staging`** | automatique : push sur `staging` avec CI verte (job `deploy-test`) |
| **Prod** | `ebpc-tournoi-billard` | https://ebpc-tournoi-billard.fly.dev | branche **`main`** | automatique : intégration GitHub de Fly, déployée dès le push |

**Le flux au quotidien** :
1. tu travailles et tu pousses sur `staging` → CI complète (batterie 316, e2e, fullrun, simu, unitaires) → l'app de **test** se déploie automatiquement,
2. tu valides sur https://ebpc-tournoi-billard-test.fly.dev (tournois de répétition, données de test, vrais usages),
3. quand c'est stable et livrable : **fusion `staging` → `main`** (PR ou push direct) → la **prod** se déploie automatiquement via l'intégration GitHub de Fly.

Plan B : l'action manuelle **« Déployer prod »** (onglet Actions, confirmation `PROD`, secret `FLY_PROD_TOKEN`) déploie le HEAD de `main` à la demande, utile si l'intégration GitHub devait avoir un coup dans l'aile.

⚠️ **Nuance à connaître** : l'intégration GitHub de Fly déploie la prod dès le push sur `main`, elle n'attend pas la CI. La batterie rattrape toujours (ci-rapport + run rouge), mais par réflexe, valide sur `staging` et ne fusione vers `main` qu'une fois la CI verte du commit concerné.

## Mise en place (faite ✅)

- App de test créée avec son volume (`fly apps create` / `fly volumes create tournoi_data`), secrets posés, app déployée et saine : https://ebpc-tournoi-billard-test.fly.dev
- Secret GitHub `FLY_TEST_TOKEN` (token de déploiement limité à l'app de test) : le job `deploy-test` tourne sur chaque push `staging`
- Secret GitHub `FLY_PROD_TOKEN` (token de déploiement limité à l'app prod) : pour le plan B manuel uniquement
- **Intégration GitHub de Fly laissée en place sur la prod** : c'est elle qui déploie automatiquement à chaque push `main` ; ne pas la retirer, c'est le mécanisme voulu
- Branche `staging` créée depuis `main` ; les deux branches existent côte à côte, `main` reste la branche de production

Si l'app de test doit être recréée un jour : `fly apps create ebpc-tournoi-billard-test`, `fly volumes create tournoi_data --app ebpc-tournoi-billard-test --region cdg --size 1`, `fly secrets set ADMIN_PIN=<code> --app ebpc-tournoi-billard-test`, recopier à la main les secrets utiles (mails Resend, VAPID push ; Fly ne lit jamais les secrets d'une autre app ; jamais de secret `BASE_URL`), puis `fly tokens create deploy -a ebpc-tournoi-billard-test` → secret GitHub `FLY_TEST_TOKEN`.

## Routines

- **Faire vivre l'app de test** : pousse n'importe quel commit sur `staging` → job `deploy-test` dans l'onglet Actions → l'app se met à jour en ~5 minutes après la CI.
- **Passer en prod** : fusionne `staging` → `main` (PR recommandée pour relecture + CI visible) → la prod se redéploie toute seule. Ou, en plan B : onglet Actions → « Déployer prod » → Run workflow → champ confirmation : `PROD`.
- **Garder les branches propres** : après chaque fusion, rebase ou mets à jour `staging` depuis `main` pour éviter les divergences longues (l'app de test doit refléter le futur proche de la prod, pas un ancêtre éloigné).
- **Suivre un déploiement** : `fly releases -a ebpc-tournoi-billard-test` / `fly logs -a ebpc-tournoi-billard-test` (idem prod).
- **Réinitialiser la base de test** : `fly ssh console -a ebpc-tournoi-billard-test` puis `rm /data/tournoi.db*` et redémarrage de la machine ; ou détruire puis recréer le volume.
- **Charger une copie des données prod sur le test** (jamais l'inverse) : `fly volumes snapshots list tournoi_data -a ebpc-tournoi-billard` pour lister les snapshots, puis créer le volume test depuis un snapshot (`fly volumes create tournoi_data --app ebpc-tournoi-billard-test --region cdg --size 1 --snapshot-id <id>`, voir `fly volumes create --help`), et recopier à la main les secrets nécessaires.
- **Tant que `FLY_TEST_TOKEN` est absent** : le job `deploy-test` reste vert avec une notice « déploiement sauté », tout reste visible dans l'onglet Actions.

## Sécurité

- Les secrets GitHub ne contiennent que des tokens de déploiement à portée unique app ; GitHub n'a jamais les secrets Fly (PIN, VAPID, Resend). Un token ne peut pas créer/supprimer une app ni lire les secrets.
- Le mot de confirmation `PROD` du workflow manuel protège contre un déclenchement par erreur.
- L'intégration GitHub de Fly a accès au repo en écriture (c'est son rôle) ; c'est le seul canal qui déploie la prod automatiquement, et il est auditable dans l'historique des releases (`fly releases -a ebpc-tournoi-billard`).
- L'app de test est publique : utilise un PIN admin différent de la prod, et souviens-toi que ce qui s'y joue n'est pas critique (c'est son rôle).

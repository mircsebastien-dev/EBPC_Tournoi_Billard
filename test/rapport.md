# Rapport de batterie de tests — EBPC Tournoi Billard

- Date : 2026-11-13T11:54:30.965Z
- Base : http://127.0.0.1:3652
- Résultat : **100 OK / 0 ÉCHEC** (2.5s)

| Statut | Test | Détail |
|---|---|---|

## 1. Sécurité admin (PIN)

| ✅ | sans PIN -> 401 |  |
| ✅ | mauvais PIN -> 401 |  |
| ✅ | bon PIN -> 200 |  |

## 2. Création / validation tournoi

| ✅ | règle invalide -> 400 |  |
| ✅ | taille 8 refusée (min 16) -> 400 |  |
| ✅ | création OK |  |
| ✅ | 2e tournoi actif -> 409 |  |
| ✅ | /api/etat OK + tables = 4 |  |
| ✅ | /api/etat expose auto/table_pref/compte |  |

## 3. Inscriptions joueurs

| ✅ | ajout Alice |  |
| ✅ | doublon pseudo (casse) -> 409 |  |
| ✅ | simulation 15 joueurs |  |
| ✅ | 16 inscrits au total |  |
| ✅ | paiement Alice |  |
| ✅ | annulation paiement |  |
| ✅ | suppression joueur |  |

## 4. Comptes joueurs (auth, réinit, enroll)

| ✅ | inscription compte 201 + cookie |  |
| ✅ | GET moi -> Seb |  |
| ✅ | doublon pseudo -> 409 |  |
| ✅ | email invalide -> 400 |  |
| ✅ | mdp trop court -> 400 |  |
| ✅ | mauvais mdp -> 401 |  |
| ✅ | connexion OK + cookie |  |
| ✅ | self-enroll tournoi -> 201 (Seb) |  |
| ✅ | double enroll -> 409 |  |
| ✅ | enroll sans compte -> 401 |  |
| ✅ | oubli mdp -> 200 + message générique |  |
| ✅ | dev_reset_link présent (pas de RESEND_API_KEY) |  |
| ✅ | oubli email inconnu -> même réponse (anti-énumération) |  |
| ✅ | reinit avec token -> 200 + reconnecté |  |
| ✅ | token réutilisé -> 400 |  |
| ✅ | connexion avec nouveau mdp -> 200 |  |
| ✅ | déconnexion |  |

## 5. Tirage simple, blancs (bye), aléatoire crypto

| ✅ | tirage OK |  |
| ✅ | 8 matchs WB1 |  |
| ✅ | byes auto-terminés avec gagnant |  |
| ✅ | gagnants byes propagés au tour 2 |  |
| ✅ | 2 tirages -> appariements différents (crypto) |  |

## 6. Matchs (lancer/scores/runout/forfait/sécurité)

| ✅ | lancer sur table 1 |  |
| ✅ | manche par externe -> 403 |  |
| ✅ | +1 manche J1 |  |
| ✅ | −1 manche J1 |  |
| ✅ | runout casse ferme J2 (+1) |  |
| ✅ | forfait J2 -> match terminé, gagnant J1 |  |
| ✅ | stats J2: runouts=1, casse=1 |  |
| ✅ | historique J2: 1 ligne, défaite, score présent |  |

## 7. Mode auto + préférence de tables

| ✅ | auto ON + table_pref enregistrés |  |
| ✅ | etat.auto=true persistant + table_pref |  |
| ✅ | 8 matchs lancés auto sur 8 tables |  |
| ✅ | tour 2 lancé sur T3,T4,T5,T6 (ordre pref 3,4,5,6...) |  |
| ✅ | auto OFF persistant |  |

## 8. Tables modifiables en cours

| ✅ | 8 -> 10 tables en cours |  |
| ✅ | 10 -> 2 avec tables occupées -> 409 |  |
| ✅ | après libérations, réduction à 4 OK |  |
| ✅ | nom verrouillé en cours |  |

## 9. Double KO: liens, croisement LB, anti-re-match

| ✅ | DKO32: WB1=16, WB2=8, LB1=8, LB2=8, F=15 (8+4+2+1) |  |
| ✅ | DKO32: 32 joueurs inscrits |  |
| ✅ | tournoi DKO terminé |  |
| ✅ | 0 re-match hors finale (croisement LB OK) |  |
| ✅ | champion renseigné |  |
| ✅ | DKO32: max points = 6 (finale F4, k=2) |  |
| ✅ | DKO32: 2 finalistes à 6 pts (ex-aequo) |  |

## 10. Stats globales, QR code, audit

| ✅ | stats-joueurs 200 + joueurs avec id/manches/runouts |  |
| ✅ | titres = 1 par tournoi gagné (pas par match) |  |
| ✅ | QR svg 200 + svg valide |  |
| ✅ | journal audit lisible |  |

## Amis, admin-data, règles, points, clôture

| ✅ | création Batterie2 |  |
| ✅ | simulation 15 joueurs |  |
| ✅ | 16 joueurs inscrits |  |
| ✅ | 16 joueurs payés |  |
| ✅ | inscription AliceBT |  |
| ✅ | recherche compte par pseudo |  |
| ✅ | ajout ami |  |
| ✅ | ami doublon -> 409 |  |
| ✅ | ami inconnu -> 404 |  |
| ✅ | s'ajouter soi-même -> 400 |  |
| ✅ | tirage OK |  |
| ✅ | liste amis = 1 (Seb) |  |
| ✅ | ami a un statut de tournoi |  |
| ✅ | joueur Seb rattaché au compte |  |
| ✅ | retrait ami |  |
| ✅ | saisie bloquée sans tirage à la bande |  |
| ✅ | bande -> casseau = gagnant |  |
| ✅ | casseur fait reprise -> 403 |  |
| ✅ | non-casseur fait casse -> 403 |  |
| ✅ | alternance après manche (casseur a changé) |  |
| ✅ | changer table -> 200 |  |
| ✅ | table inconnue -> 400 |  |
| ✅ | rouvrir avec aval propagé -> 409 |  |
| ✅ | changer joueur1 -> 200 |  |
| ✅ | même joueur x2 -> 400 |  |
| ✅ | points présents dans le classement |  |
| ✅ | joueurs avec points >= 1 |  |
| ✅ | stats globales ont points |  |
| ✅ | PUT joueur pseudo -> 200 |  |
| ✅ | PUT joueur pseudo pris -> 409 |  |
| ✅ | delete event recalcule le score (diminue) |  |
| ✅ | delete event sans PIN -> 401 |  |
| ✅ | clôture -> 200 |  |
| ✅ | clôture coupe net -> champion null |  |

## Couverture

- Sécurité admin (PIN 401/200)
- Création/validation tournoi (taille, règle, doublon)
- Inscriptions (ajout, doublon, paiement, suppression, simulation)
- Comptes joueurs (inscription, doublon, email/mdp invalides, connexion, mauvais mdp, déconnexion, oubli mdp + réinit par token, anti-énumération, self-enroll, 401 sans compte, double enroll)
- Tirage (blancs/bye auto-gagnés + propagation, match vide, aléatoire crypto)
- Matchs (lancer, table, +1/−1, runout casse, forfait, 403 externe)
- Mode auto (on/off persistant, ordre des tables préféré 3..8,1,2)
- Tables dynamiques en cours (ajout, réduction, 409 si occupées, nom verrouillé)
- Double KO (liens LB/F, croisement anti-re-match sur tournoi complet, champion)
- Stats (stats-joueurs avec titres distincts, fiche joueur, historique), QR code, journal d'audit
- Amis (recherche, ajout 200/409/404/400, liste+statut, retrait, rattachement compte à l'inscription)
- Règles match (bande ⚪, alternance, blocage saisie sans bande, 403 casse/reprise, modale admin table/joueurs/rouvrir-409)
- Admin-data (PUT joueur 200/409, delete event + recalc, 401 sans PIN)
- Points au classement (présents, gagnant >= 1) + clôture coupe net (champion null)

# Rapport de batterie de tests — EBPC Tournoi Billard

- Date : 2026-11-12T09:33:22.923Z
- Base : http://127.0.0.1:3579
- Résultat : **63 OK / 0 ÉCHEC** (1.8s)

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

| ✅ | LB2 existe (4 matchs) |  |
| ✅ | tournoi DKO terminé |  |
| ✅ | 0 re-match hors finale (croisement LB OK) |  |
| ✅ | champion renseigné |  |

## 10. Stats globales, QR code, audit

| ✅ | stats-joueurs 200 + joueurs avec id/manches/runouts |  |
| ✅ | titres = 1 par tournoi gagné (pas par match) |  |
| ✅ | QR svg 200 + svg valide |  |
| ✅ | journal audit lisible |  |

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

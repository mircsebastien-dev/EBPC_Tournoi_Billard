# Rapport de batterie de tests — EBPC Tournoi Billard

- Date : 2026-11-21T13:16:29.327Z
- Base : http://127.0.0.1:4100
- Résultat : **524 OK / 0 ÉCHEC** (5.9s)

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
| ✅ | rappel inscriptions sans PIN -> 401 |  |
| ✅ | rappel inscriptions en phase inscription -> 200 + envoyes=0 (aucun abonné en CI) |  |
| ✅ | /api/etat OK + tables = 4 |  |
| ✅ | /api/etat expose auto/table_pref/compte |  |
| ✅ | bracket virtuel avant tirage : 15 matchs (16j simple) |  |
| ✅ | virtuel : wb1-001 -> wb2-001 slot 1 |  |
| ✅ | virtuel : aucun joueur, tout prevu, ids v*, pas de perdant (simple) |  |

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
| ✅ | self-désinscription sans compte -> 401 |  |
| ✅ | Seb marqué payé (setup) |  |
| ✅ | self-désinscription déjà payé -> 409 (deja_paye) |  |
| ✅ | paiement Seb annulé (setup) |  |
| ✅ | self-désinscription -> 200 (Seb) |  |
| ✅ | désinscrit : Seb absent du tournoi |  |
| ✅ | double désinscription -> 404 |  |
| ✅ | ré-inscription après désinscription -> 201 |  |
| ✅ | inscription anonyme avec compte connecté -> 409 (compte_connecte) |  |
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
| ✅ | byes/vides auto-terminés : 6 blancs répartis, byes avec gagnant, vides sans gagnant |  |
| ✅ | gagnants byes propagés au tour 2 |  |
| ✅ | 2 tirages -> appariements différents (crypto) |  |

## 6. Matchs (lancer/scores/runout/forfait/sécurité)

| ✅ | lancer sur table 1 |  |
| ✅ | manche par externe -> 403 |  |
| ✅ | +1 manche J1 |  |
| ✅ | −1 manche J1 |  |
| ✅ | runout reprise ferme J2 (+1) |  |
| ✅ | forfait J2 -> match terminé, gagnant J1 |  |
| ✅ | forfait joueur hors match -> 400 (pas de 500 FK) |  |
| ✅ | forfait sans joueur_id -> 400 |  |
| ✅ | stats J2: runouts=1, reprise=1, casse=0 |  |
| ✅ | historique J2: 1 ligne, défaite, score présent |  |

## 7. Mode auto + préférence de tables

| ✅ | auto ON + table_pref enregistrés |  |
| ✅ | etat.auto=true persistant + table_pref |  |
| ✅ | 8 matchs lancés auto sur 8 tables |  |
| ✅ | tour 2 lancé sur T3,T4,T5,T6 (ordre pref 3,4,5,6...) |  |
| ✅ | manche provoquant un auto-lancement -> 200 (régression req is not defined) |  |
| ✅ | auto_lancement bien logué (avec club_id) |  |
| ✅ | auto OFF persistant |  |

## 8. Tables modifiables en cours

| ✅ | 8 -> 10 tables en cours |  |
| ✅ | 10 -> 2 avec tables occupées -> 409 |  |
| ✅ | après libérations, réduction à 4 OK |  |
| ✅ | nom verrouillé en cours |  |

## 9. Double KO: liens, croisement LB, anti-re-match

| ✅ | virtuel DKO32: 55 matchs, tous virtuels prevu sans joueur |  |
| ✅ | virtuel DKO32: lb2-001 -> f1-005 slot 2 (croisement demi-moitié) |  |
| ✅ | virtuel DKO32: perdant wb1-001 -> lb1-001 slot 1 |  |
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
| ✅ | fiche joueur: h2h par adversaire (joues = victoires + defaites, dernier renseigné) |  |
| ✅ | fiche joueur: totaux h2h = totaux historique (matchs decides et victoires) |  |
| ✅ | QR svg 200 + svg valide |  |
| ✅ | journal audit lisible |  |

## 11. Rollback point-in-time, confirm_pin sur suppressions, snapshots audit

| ✅ | création tournoi RB (notif_push=false accepté) |  |
| ✅ | tirage RB |  |
| ✅ | rappel inscriptions après tirage -> 409 |  |
| ✅ | slots exposés dans /api/etat (suivant_slot/perdant_slot) |  |
| ✅ | classement: byes exclus (joues=0 juste après tirage) |  |
| ✅ | match joué 3-0 avant rollback |  |
| ✅ | changer joueurs vers paire déjà jouée -> 409 rematch (hors finale) |  |
| ✅ | changer joueurs vers paire inédite -> 200 |  |
| ✅ | audit: événement tirage a un snapshot (has_snapshot) |  |
| ✅ | audit: lancement lisible (code match + "vs") |  |
| ✅ | DELETE tournoi sans confirm_pin -> 401 |  |
| ✅ | DELETE tournoi mauvais code -> 401 |  |
| ✅ | rollback sans confirm_pin -> 401 |  |
| ✅ | rollback audit_id inconnu -> 404 |  |
| ✅ | rollback avec bon code -> 200 |  |
| ✅ | après rollback: match revenu à pret 0-0 |  |
| ✅ | rollback logué dans l'audit |  |
| ✅ | match en cours 1-0 sur table avant rollback |  |
| ✅ | rollback avec match en cours -> 200 |  |
| ✅ | après rollback (match en cours): pret 0-0, table libérée |  |
| ✅ | DELETE tournoi avec bon code -> 200 |  |
| ✅ | désinscription joueur SANS confirm_pin -> 200 (exempté) |  |

## 13. Robustesse: health, 404/400/413 JSON, validation entrées, concurrence manches

| ✅ | création tournoi Robust |  |
| ✅ | /api/health -> 200 ok + db ok |  |
| ✅ | route API inconnue -> 404 JSON |  |
| ✅ | JSON malformé -> 400 JSON (pas HTML) |  |
| ✅ | id non numérique -> pas de 500 |  |
| ✅ | pseudo 500 chars -> tronqué à 40 |  |
| ✅ | pseudo injection SQL -> 200 (paramétré), pas d'erreur |  |
| ✅ | table joueur intacte après tentative d'injection |  |
| ✅ | pseudo avec caractères de contrôle -> nettoyé |  |
| ✅ | body > 256ko -> 413 JSON |  |
| ✅ | 20 manches en parallèle -> aucune 500 |  |
| ✅ | concurrence: score == nb events manche (pas de double comptage) |  |
| ✅ | concurrence: match terminé proprement à la distance |  |

## 14. Rate-limit comptes keyé sur X-Forwarded-For + session admin 8h (front)

| ✅ | 10 mauvaises connexions XFF 9.9.9.9 -> 401, la 11e -> 429 |  |
| ✅ | sans XFF (IP réelle 127.0.0.1) -> pas locké par le bucket 9.9.9.9 (401) |  |
| ✅ | front: expiration session admin 8h (ADMIN_SESSION_MS + ebpc_admin_pin_since) |  |
| ✅ | front: bouton Verrouiller + effacement du PIN mémorisé |  |

## 15. Export/import JSON tournoi, diff avant rollback, filtre du journal

| ✅ | création tournoi ExpImp |  |
| ✅ | tirage ExpImp |  |
| ✅ | export -> 200, payload complet (tournoi+16 joueurs+matchs+events) |  |
| ✅ | diff rollback -> 200 avec resume |  |
| ✅ | diff: le match joué apparaît modifié |  |
| ✅ | audit?action=tirage -> uniquement des tirages |  |
| ✅ | audit?q=ExpImp -> au moins la création, tout filtré côté serveur |  |
| ✅ | import sans confirm_pin -> 401 |  |
| ✅ | import mauvais confirm_pin -> 401 |  |
| ✅ | import JSON invalide -> 400 |  |
| ✅ | import valide -> 200, tournoi recréé (FK remappées, validées au COMMIT) |  |
| ✅ | import: 16 joueurs et tous les matchs présents |  |
| ✅ | import: match en cours conservé (score 1-0) |  |
| ✅ | import: lien suivant_id valide |  |
| ✅ | import avec actif sans replace -> 409 |  |
| ✅ | export?id= -> 200 |  |

## Amis, admin-data, règles, points, clôture

| ✅ | création Batterie2 |  |
| ✅ | simulation 15 joueurs |  |
| ✅ | inscription anonyme avec pseudo libre -> 200 |  |
| ✅ | suppression du joueur anonyme InviteBT |  |
| ✅ | inscription anonyme avec pseudo d'un compte -> 409 (réservé) |  |
| ✅ | ajout admin pseudo d'un compte sans confirmation -> 409 |  |
| ✅ | ajout admin avec confirmation -> 200 |  |
| ✅ | 16 joueurs inscrits |  |
| ✅ | 16 joueurs payés |  |
| ✅ | inscription AliceBT |  |
| ✅ | recherche compte par pseudo |  |
| ✅ | ajout ami |  |
| ✅ | ami doublon -> 409 |  |
| ✅ | ami inconnu -> 404 |  |
| ✅ | s'ajouter soi-même -> 400 |  |
| ✅ | tirage OK |  |
| ✅ | self-désinscription tournoi lancé -> 409 |  |
| ✅ | liste amis = 1 (Seb) |  |
| ✅ | ami a un statut de tournoi |  |
| ✅ | ami inscrit expose joueur_id (lien fiche joueur) |  |
| ✅ | front: panneau amis page tournoi -> clic nom renvoie /joueur.html?id= |  |
| ✅ | joueur Seb rattaché au compte |  |
| ✅ | retrait ami |  |
| ✅ | suivi pseudo sans compte -> 200 |  |
| ✅ | suivi pseudo doublon (casse ignorée) -> 409 |  |
| ✅ | suivi du pseudo d'un compte -> 409 |  |
| ✅ | suivre son propre pseudo -> 400 |  |
| ✅ | suivi pseudo vide -> 400 |  |
| ✅ | liste amis = 1 suivi pseudo (Ghost) |  |
| ✅ | suivi pseudo jamais inscrit -> hors_tournoi + joueur_id null |  |
| ✅ | re-ajout ami Seb (pour test admin) |  |
| ✅ | push: abonnement enregistré (session compte) |  |
| ✅ | admin comptes: amis_comptes (Seb) + amis_pseudos (Ghost) exposés |  |
| ✅ | admin comptes: push_abonnements exposé (1 appareil pour le compte abonné) |  |
| ✅ | front: colonne Amis dans admin-comptes (comptes + sans compte) |  |
| ✅ | front: colonne Push (abonnements notifs) + total notifiables dans admin-comptes |  |
| ✅ | front: bouton « Me désinscrire » (accueil + page mes matchs) |  |
| ✅ | front: self-désinscription masquée si déjà payé |  |
| ✅ | front: panneau Face-à-face (h2h) sur la fiche joueur, tableau plié à 5 + bouton Tout voir, adversaire cliquable + historique des matchs REPLIÉ aux 5 derniers (17m) puis paginé par pages de 20 en mode déplié (Tout voir (N) / Réduire, Précédent / Suivant, Page X / Y, bornes boutons désactivés) |  |
| ✅ | front: bouton Rappel inscriptions ouvertes (admin-tournoi, phase inscription) |  |
| ✅ | front: affiche tournoi à venir (poster) : eyebrow + jauge inscrits, sans QR ni emojis |  |
| ✅ | front: SSE re-sync au retour sur la page (visibilitychange) et à la reconnexion (open) |  |
| ✅ | front: styles poster accueil (or/sombre + boule 8 filigrane) |  |
| ✅ | retrait suivi pseudo |  |
| ✅ | saisie bloquée sans tirage à la bande |  |
| ✅ | bande -> casseau = gagnant |  |
| ✅ | casseur fait reprise -> 403 |  |
| ✅ | non-casseur fait casse -> 403 |  |
| ✅ | alternance après manche (casseur a changé) |  |
| ✅ | retirer une manche -> ⚪ casseur revient à l'état précédent |  |
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
| ✅ | PUT pseudo d'un compte (sans joueur homonyme) -> 409 (réservé) |  |
| ✅ | delete event recalcule le score (diminue) |  |
| ✅ | delete event sans PIN -> 401 |  |
| ✅ | clôture -> 200 |  |
| ✅ | clôture coupe net -> champion null |  |

## 16. Rôles: compte admin = session suffit (requireAdmin + confirm_pin), PIN sinon

| ✅ | login Seb (user) -> 200 + cookie |  |
| ✅ | session user sans PIN -> 401 sur /api/admin/* |  |
| ✅ | compte AliceBT retrouvé (role=user) |  |
| ✅ | session AliceBT (role=user) -> 401 |  |
| ✅ | POST role=admin (PIN) -> 200 |  |
| ✅ | role invalide -> 400 |  |
| ✅ | session AliceBT (role=admin) sans PIN -> 200 |  |
| ✅ | création RoleT (PIN) |  |
| ✅ | DELETE tournoi avec session admin, SANS confirm_pin -> 200 |  |
| ✅ | DELETE tournoi avec PIN seul (pas de confirm_pin, pas de session admin) -> 401 |  |
| ✅ | session user + confirm_pin sans PIN -> 401 (PIN ou session admin requis) |  |
| ✅ | DELETE tournoi avec PIN + confirm_pin correct -> 200 |  |
| ✅ | front: modale confirmation par mot court (SUPPRIMER) pour session admin sur actions destructives |  |

## 17. Multi-club: club par défaut, création club, isolation par X-Club/?club=

| ✅ | GET /api/clubs -> club par défaut ebpc |  |
| ✅ | etat expose le club courant |  |
| ✅ | création tournoi ClubA (club défaut) |  |
| ✅ | tournoi ClubA rattaché au club par défaut (club_id=1) |  |
| ✅ | POST /api/admin/club clubb -> 200 |  |
| ✅ | club slug doublon -> 409 |  |
| ✅ | club slug invalide -> 400 |  |
| ✅ | club inconnu (X-Club) -> 404 |  |
| ✅ | club inconnu (?club=) -> 404 |  |
| ✅ | création tournoi ClubB-T dans clubb (X-Club) |  |
| ✅ | etat clubb: actif = ClubB-T, club.slug=clubb |  |
| ✅ | etat club défaut: actif reste ClubA (pas ClubB-T) |  |
| ✅ | tournoi du club A invisible depuis clubb -> 404 |  |
| ✅ | suppression tournoi club A depuis clubb -> 404 |  |
| ✅ | tournoi A existe toujours après la tentative cross-club |  |
| ✅ | tirage ClubA |  |
| ✅ | events match A depuis club défaut -> 200 |  |
| ✅ | events match A depuis clubb -> 404 (isolation) |  |
| ✅ | saisie manche match A depuis clubb -> 404 (isolation) |  |
| ✅ | homonyme du joueur A inscrit dans clubb (ClubB-T) -> 200 (+id) |  |
| ✅ | fiche de l homonyme vue depuis clubb: 0 match joué (le club par défaut ne fuit pas) |  |
| ✅ | matchs de l homonyme depuis clubb: aucune ligne du club par défaut |  |
| ✅ | historique de l homonyme depuis clubb: vide, face-à-face vide aussi |  |
| ✅ | fiche du joueur du club par défaut: son match ClubA reste compté (1 joué / 1 gagné) |  |
| ✅ | audit clubb: toutes les entrées appartiennent à clubb |  |
| ✅ | audit club défaut: toutes les entrées club_id=1 |  |

## 17b. Multi-club: PIN par club + réglages du club + garde super-admin

| ✅ | clubc créé avec son PIN propre -> 200 |  |
| ✅ | tournoi ClubC-T créé dans clubc via son PIN seul, club bien clubc |  |
| ✅ | PIN de clubc refusé sur le club par défaut -> 401 |  |
| ✅ | PIN global ouvre les routes admin de clubc (super-admin) -> 200 |  |
| ✅ | PUT club: renommage par l admin du club, sans re-confirmation -> 200 |  |
| ✅ | PUT club: pin trop court -> 400 |  |
| ✅ | PUT club: nouveau PIN sans confirm_pin -> 401 |  |
| ✅ | PUT club: nouveau PIN confirmé par le code actuel -> 200 + pin_propre |  |
| ✅ | le nouveau PIN de clubc ouvre les routes admin -> 200 |  |
| ✅ | ancien PIN de clubc révoqué -> 401 |  |
| ✅ | admin de clubc ne peut pas modifier le club par défaut -> 403 |  |
| ✅ | super-admin (code global): change le PIN et désactive clubc à distance -> 200 |  |
| ✅ | club désactivé absent de la liste publique des clubs actifs |  |
| ✅ | club désactivé -> 404 à la résolution (X-Club) |  |
| ✅ | réactivation de clubc à distance par le super-admin -> 200 |  |
| ✅ | clubc de retour dans la liste publique des clubs actifs |  |
| ✅ | GET /api/admin/clubs: clubc pin_propre+actif, défaut pin_propre=false |  |
| ✅ | le club par défaut ne peut pas être désactivé -> 400 |  |
| ✅ | PUT club slug inconnu -> 404 |  |
| ✅ | audit (club défaut): club_cree et club_modifie journalisés |  |

## 17c. Multi-club: rôles des comptes par club (admin de club / operateur)

| ✅ | login Seb (17c): session fraîche -> 200 + cookie |  |
| ✅ | attribution du rôle admin de clubc à Seb par le code global -> 200 |  |
| ✅ | rôle inconnu (chef) -> 400 |  |
| ✅ | GET rôles du club: Seb listé admin (pseudo + role, jamais de hash) |  |
| ✅ | session Seb (admin de clubc) ouvre les routes admin de clubc sans PIN -> 200 |  |
| ✅ | session Seb sans rôle sur le club par défaut -> 401 |  |
| ✅ | Seb crée un tournoi dans clubc par sa session (session_club) -> 200 |  |
| ✅ | Seb renomme clubc par session, sans confirm_pin -> 200 |  |
| ✅ | Seb (admin de club) change le PIN de clubc sans confirm_pin -> 200 |  |
| ✅ | Seb ne peut pas modifier le club par défaut (garde super-admin) -> 403 |  |
| ✅ | admin de club: liste des comptes limitée à son club (Seb présent, AliceBT absente) |  |
| ✅ | admin de club: promotion au rôle GLOBAL refusée (super-admin uniquement) -> 403 |  |
| ✅ | admin de club: renommage d un compte hors de son club -> 404 |  |
| ✅ | admin de club: reset du mot de passe d un compte hors de son club -> 404 |  |
| ✅ | admin de club: suppression d un compte hors de son club -> 404 |  |
| ✅ | super-admin dans le club par défaut: SES comptes visibles (AliceBT et Seb), la liste reste scopée au club du contexte (17h) |  |
| ✅ | admin de club: liste des clubs interdite (super-admin uniquement) -> 403 |  |
| ✅ | admin de club: création d un club interdite -> 403 |  |
| ✅ | GET /api/admin/super: session de club -> super_admin false (menu Clubs masqué) |  |
| ✅ | GET /api/admin/super: code global -> super_admin true |  |
| ✅ | GET /api/admin/super: code PIN du club -> super_admin false |  |
| ✅ | downgrade de Seb en operateur de clubc -> 200 |  |
| ✅ | session operateur ouvre toujours les routes admin de clubc -> 200 |  |
| ✅ | operateur: suppression du tournoi refusée sans code (confirm non levée) -> 401 |  |
| ✅ | operateur: gestion des rôles du club interdite -> 403 |  |
| ✅ | retrait du rôle de Seb (super-admin + confirm_pin) -> 200 |  |
| ✅ | session Seb révoquée: plus aucune route admin de clubc -> 401 |  |
| ✅ | (admin) liste des clubs: nb_comptes retombe à 0 pour clubc après le retrait |  |
| ✅ | audit de clubc: club_role et club_role_retire journalisés |  |
| ✅ | front: console super-admin (création, réglages club par slug cible, X-Club par appel, table-wrap, rôles admin/operateur) + lien Console depuis l accueil admin (17i) |  |
| ✅ | front: menu Console réservé au super-admin (/api/admin/super conditionne le bouton, console affiche un message si 403) |  |
| ✅ | front: bouton 👑 (rôle global) masqué aux sessions de club sur la page Comptes joueurs |  |
| ✅ | suppression clubc refusée: un tournoi est encore rattaché -> 409 |  |
| ✅ | suppression clubc sans confirm_pin -> 401 |  |
| ✅ | le club par défaut ne peut pas être supprimé -> 400 |  |
| ✅ | suppression d un club inconnu -> 404 |  |
| ✅ | suppression du clubc par le super-admin (confirm_pin) -> 200 |  |
| ✅ | clubc absent de la liste des clubs après suppression |  |
| ✅ | rôle admin de Seb sur clubb (la suppression du club devra purger ce rattachement) |  |
| ✅ | suppression de clubb avec un compte rattaché -> 200 (rôles purgés) |  |
| ✅ | clubb absent de la liste des clubs après suppression |  |
| ✅ | audit: club_supprime journalisé (clubc et clubb) |  |
| ✅ | front: bouton Supprimer sur chaque ligne sauf le club par défaut (confirmation destructive, routes super 17i) |  |

## 17d. Sauvegarde complète de la base (export/import JSON, réservé au code global)

| ✅ | export base: 200 + format complet (marqueur ebpc-tournoi-billard, genere_le, tables) |  |
| ✅ | export base: toutes les tables du schéma présentes (16, compte_club inclus) |  |
| ✅ | export base: téléchargeable (Content-Disposition attachment) |  |
| ✅ | export base: contenu non vide (clubs, tournois, joueurs, audit) |  |
| ✅ | export base: fk_violations expose les orphelins hérités (clubs supprimés en 17c -> journal orphelin déclaré, clé fk_violations) |  |
| ✅ | vidage du journal du club défaut (confirm_pin) -> 200, supprimées >= 1 |  |
| ✅ | journal vidé: il ne reste que le log du vidage (audit_purge) |  |
| ✅ | import base: 200 + ok (base restaurée) + sauvegarde ANCIENNE (avant 17f, comptes sans club_id) acceptée pareil |  |
| ✅ | import base: chaque table retrouve exactement ses lignes (identique à l export) |  |
| ✅ | import base: les ids sont préservés (club ebpc garde son id) |  |
| ✅ | import base: journal du club défaut restauré (entrées de retour) |  |
| ✅ | export base avec un code de club -> 403 (réservé au super-admin) |  |
| ✅ | import base avec un code de club -> 403 (aucune écriture) |  |
| ✅ | import base: payload sans marqueur de sauvegarde -> 400 (aucune écriture) |  |
| ✅ | import base: table inconnue -> 400 (aucune écriture) |  |
| ✅ | import base: référence cassée NON déclarée -> 400 (falsification refusée, aucun écriture) |  |
| ✅ | front: panneau 💾 sauvegarde base dans la console super-admin (export téléchargeant, import fichier avec confirmation destructible, 17i) |  |
| ✅ | doc: SPEC 17d + GUIDE_ADMIN dédié + serveur (requireSuperAdmin sur export/import, limite 25mb sur l import UNIQUEMENT) + compat sauvegardes anciennes pre-17f |  |

## 17e. Sauvegarde des données du club (export/import ciblés, code de club)

| ✅ | export club: 200 + format club (marqueur ebpc-tournoi-billard-club, club ebpc, genere_le, tables) |  |
| ✅ | export club: périmètre club uniquement (8 tables de données, JAMAIS compte/session/email/club) |  |
| ✅ | export club: téléchargeable (Content-Disposition attachment, nom club-ebpc…) |  |
| ✅ | export club: contenu du club uniquement (tournois/joueurs/matchs du club, aucune ligne d un autre club) |  |
| ✅ | export club avec un code de club -> 200 (le club sauvegarde SES données: club clubsb vide) |  |
| ✅ | export club sans code admin -> 401 |  |
| ✅ | vidage du journal du club (confirm_pin) -> 200, supprimées >= 1 |  |
| ✅ | import club: 200 + ok (données du club restaurées) |  |
| ✅ | import club: chaque table du club retrouve exactement ses lignes (identique à l export) |  |
| ✅ | import club: ids préservés (le 1er tournoi du club garde son id) |  |
| ✅ | import club: journal du club restauré (entrées de retour) |  |
| ✅ | import club: état du club cohérent après restauration (actif null ou tableau de matchs) |  |
| ✅ | import club sans confirm_pin (code de club) -> 401 (confirmation destructive exigée) |  |
| ✅ | import club: sauvegarde d un AUTRE club -> 400 (clubsb ne peut pas importer le fichier d ebpc) |  |
| ✅ | import club: marqueur de sauvegarde absent -> 400 (aucune écriture) |  |
| ✅ | import club: table hors périmètre club (compte) -> 400 (emails/mots de passe jamais importables par un club) |  |
| ✅ | import club: ligne d un autre club (tournoi club_id 999) -> 400 (aucune écriture) |  |
| ✅ | import club: référence interne cassée (match_event.match_id 999999) -> 400 (falsification refusée) |  |
| ✅ | front: panneau 💾 données du club dans admin-data.html (export club téléchargeant + import fichier avec confirmation destructible) |  |
| ✅ | doc: SPEC 17e + GUIDE_ADMIN club + serveur (export-club/import-club SANS requireSuperAdmin: un code de club sauvegarde/restaure SON club, limite 25mb) |  |

## 17f. Comptes cloisonnés par club (pseudo et email par club, creation seule lie le club)

| ✅ | clubvm créé avec son PIN (2e club avec PIN pour tester l isolation des comptes) |  |
| ✅ | compte créé DEPUIS le contexte du club clubsb -> 201 (lié au club au moment de la création) |  |
| ✅ | le compte est VISIBLE dans la liste des comptes de SON club (table de marque, code PIN du club) |  |
| ✅ | le compte est INVISIBLE dans la liste d un autre club (code PIN de clubvm) |  |
| ✅ | super-admin (code global): vue tous clubs EXPLICITE (?tous=1) -> MembreSb (clubsb) visible |  |
| ✅ | même pseudo accepté dans un AUTRE club (unicité PAR club, plus globale) -> 201 |  |
| ✅ | pseudo déjà pris DANS le même club -> 409 |  |
| ✅ | email déjà pris dans le même club -> 409 |  |
| ✅ | même email accepté dans un autre club (unicité email PAR club) -> 201 |  |
| ✅ | connexion depuis SON club -> 200 + session |  |
| ✅ | connexion depuis clubvm du compte AutreSb (existant UNIQUEMENT dans clubsb) -> 401 (le pseudo MembreSb lui répond 200 car le jumeau de clubvm est un autre compte) |  |
| ✅ | connexion du jumeau MembreSb depuis clubvm -> 200 + session distincte de celle de clubsb (deux comptes indépendants) |  |
| ✅ | oubli depuis le bon club -> compte trouvé (dev_reset_link en dev) |  |
| ✅ | oubli depuis un autre club: ce email n a pas de compte ici -> réponse générique sans lien (anti-énumération) |  |
| ✅ | connexion d un compte du club défaut depuis clubvm -> 401 (le compte n existe pas dans CE club) |  |
| ✅ | aucune liaison implicite: Seb reste absent de clubvm (seule la création fige le club) |  |
| ✅ | tournoi ClubVM-T créé dans clubvm (pour la garde d isolation des inscriptions) |  |
| ✅ | inscription au tournoi d un autre club avec sa session -> 409 (compte cloisonné) |  |
| ✅ | pseudo d un compte d un autre club utilisable anonymement dans ce club (réservation cloisonnée) -> 200 |  |
| ✅ | pseudo d un compte de CE club toujours réservé (409 compte_pseudo, inscription anonyme refusée) |  |
| ✅ | doc: SPEC 17f + GUIDE_ADMIN + schema db (club_id NOT NULL + unicite PAR club) + serveur/comptes scopés PAR club |  |

## 17g. Promotion admin du club depuis la table de marque (le PIN du club suffit)

| ✅ | compte ChefVm créé dans clubvm (future cible de la promotion) -> 201 |  |
| ✅ | LE PIN DU CLUB promeut ChefVm en admin de clubvm -> 200 (autonomie du club: plus besoin du code global) |  |
| ✅ | table de marque clubvm (PIN du club): ChefVm listé avec role_club admin + peut_gerer_roles true + club.slug (sélecteur du front) |  |
| ✅ | rôle inconnu (chef) refusé via le PIN du club -> 400 |  |
| ✅ | GET rôles du club ouvert au PIN du club: ChefVm listé admin |  |
| ✅ | isolation 17f étendue: le PIN de clubvm ne promeut qu un compte DU club (AutreSb n existe QUE dans clubsb) -> 404 introuvable dans ce club |  |
| ✅ | compte DeuxVm créé dans clubvm -> 201 |  |
| ✅ | connexion de ChefVm depuis SON club -> 200 + session |  |
| ✅ | la SESSION de ChefVm (admin de clubvm, sans aucun PIN) promeut DeuxVm -> 200 |  |
| ✅ | changement de rôle: DeuxVm passé en OPERATEUR via le PIN du club -> 200 |  |
| ✅ | connexion de DeuxVm (operateur) -> 200 + session |  |
| ✅ | session OPERATEUR: gestion des rôles toujours interdite -> 403 |  |
| ✅ | retrait du rôle par une session ADMIN du club, sans confirm_pin (exemption confirm) -> 200 |  |
| ✅ | re-promotion de DeuxVm en admin via le PIN du club -> 200 (pour tester le retrait par code) |  |
| ✅ | retrait du rôle DEPUIS le PIN du club avec confirm_pin = le code du club -> 200 |  |
| ✅ | table de marque clubvm: DeuxVm sans rôle club, ChefVm toujours admin |  |
| ✅ | super-admin: attachement cross-club conservé (Seb, compte du club par défaut, promu admin de clubvm) -> 200 |  |
| ✅ | retrait du rôle cross-club par le super-admin + confirm_pin global -> 200 (nettoyage) |  |
| ✅ | nettoyage: retrait du rôle de ChefVm par le super-admin -> 200 |  |
| ✅ | clubvm sans aucun rôle résiduel -> liste vide (état propre pour les sections suivantes) |  |
| ✅ | doc: SPEC 17g + GUIDE_ADMIN + serveur (PIN du club suffit: adminViaPin club, cible DU club, peut_gerer_roles) + front (chips + sélecteur rôle club) |  |

## 17h. Tenant principal cloisonné: la table de marque ne montre jamais les comptes des autres clubs, même au super-admin

| ✅ | 17h: super-admin (code global) dans le tenant principal -> MembreSb (compte de clubsb) ABSENT |  |
| ✅ | 17h: ChefVm et DeuxVm (comptes de clubvm) absents du tenant principal |  |
| ✅ | 17h: le tenant principal garde SES comptes (Seb, club par défaut, visible) |  |
| ✅ | 17h: réponse avec tous=false (vue cloisonnée par défaut) |  |
| ✅ | ?tous=1 (super-admin): restriction levée -> MembreSb (clubsb), ChefVm (clubvm) ET Seb visibles |  |
| ✅ | ?tous=1: club_slug dévoile le club d origine de chaque compte (MembreSb -> clubsb) |  |
| ✅ | ?tous=1: compte sans aucun rôle club -> roles_clubs vide |  |
| ✅ | setup: Seb staff admin de clubvm (cross-club par le super-admin) -> 200 |  |
| ✅ | ?tous=1: rôles club agrégés -> Seb porte « clubvm:admin » dans roles_clubs |  |
| ✅ | nettoyage: retrait du rôle staff de Seb sur clubvm -> 200 |  |
| ✅ | un code de club NE PEUT PAS forcer la vue tous-clubs (?tous=1 ignoré): liste = clubvm uniquement (DeuxVm présent, AliceBT (club par défaut) absente) |  |
| ✅ | doc: SPEC 17h + serveur (scoping inconditionnel + ?tous=1 super-admin) + front (panneau tous comptes de la plateforme dans la console, 17i) |  |

## 17i. Console super-admin décorrelée: zone /api/super/* + rôle super_admin dédié (aucun club)

| ✅ | 17i: GET /api/super/scan avec le code global -> 200, super_admin via global |  |
| ✅ | 17i: le PIN de clubvm sur /api/super/scan -> 401 (un code de club n ouvre JAMAIS la zone super) |  |
| ✅ | 17i: la SESSION admin du club (ChefVm, sans PIN) sur /api/super/scan -> 403 |  |
| ✅ | 17i: GET /api/super/clubs (code global) -> 200, tous les clubs (ebpc, clubvm, clubsb) sans contexte de club |  |
| ✅ | 17i: GET /api/super/comptes -> 200, vue plateforme: MembreSb (clubsb) ET ChefVm (clubvm) d origines distinctes + Seb, tous=true |  |
| ✅ | 17i: GET /api/super/base/export (code global) -> 200, payload complet (table club + comptes multi-clubs) |  |
| ✅ | 17i: POST /api/super/club crée clubsi depuis la zone super -> 200 |  |
| ✅ | 17i: PUT /api/super/club désactive clubsi avec confirm_pin (code global) -> 200 actif=false |  |
| ✅ | 17i: PUT /api/super/club SANS confirm_pin -> 401 (geste sensible: code global exigé) |  |
| ✅ | 17i: DELETE /api/super/club supprime clubsi (confirm_pin global) -> 200 |  |
| ✅ | 17i: clubsi bien absent de la liste après suppression (état propre) |  |
| ✅ | 17i: setup AliceBT retrouvée dans la vue plateforme (rôle admin hérité) |  |
| ✅ | 17i: promotion du rôle plateforme super_admin via /api/super (code global) -> 200 |  |
| ✅ | 17i: la SESSION du compte super_admin ouvre la zone super (via session) -> 200 |  |
| ✅ | 17i: accès support conservé: la session super_admin ouvre l admin D un autre club (X-Club clubvm -> comptes de clubvm, DeuxVm visible, tous=false) |  |
| ✅ | 17i: démotion en user -> 200 puis la même session est immédiatement refusée (scan 403) |  |
| ✅ | 17i: le PIN de club ne promeut ni ne rétrograde en zone super -> 401 |  |
| ✅ | doc: SPEC 17i + serveur (zone /api/super/* sans club, rôle super_admin) + console.html (panneaux clubs/comptes/base) + clubs.html redirigé + menus (Console) + admin-data épuré (base partie dans la console) + GUIDE |  |

## 17j. Personnalisation du club: accent visible par tous + défauts tournoi (nom/jour/heure), panneau admin + console

| ✅ | 17j: GET /api/admin/club/prefs (PIN du club) -> 200, réglages par défaut jamais configurés |  |
| ✅ | 17j: PUT prefs couleur non hexadécimale -> 400 (format #rrggbb exigé) |  |
| ✅ | 17j: PUT prefs jour/heure hors bornes -> 400 (jour 7, heure 25:00, jamais écrits) |  |
| ✅ | 17j: PUT prefs SANS confirm_pin (geste non sensible) -> 200: accent + nom + jour + heure enregistrés |  |
| ✅ | 17j: GET /api/club-theme public (visiteur sans aucun code) -> 200, accent du club servi à tous |  |
| ✅ | 17j: /api/etat expose club.accent (publique, contexte club résolu sans code) |  |
| ✅ | 17j: isolation: le tenant principal garde l accent d origine (clubvm ne fuit pas sur ebpc) |  |
| ✅ | 17j: le PIN de clubvm ne peut pas modifier la personnalisation d un AUTRE club (body.slug clubsb) -> 403 |  |
| ✅ | 17j: le super-admin règle la personnalisation d un autre club à distance (body.slug, code global) -> 200 |  |
| ✅ | 17j: GET /api/club-theme clubsb -> accent personnalisé servi publiquement (chaque club a le sien) |  |
| ✅ | 17j: la SESSION admin du club (ChefVm, sans PIN) lit la personnalisation -> 200 (panneau Apparence de l accueil admin) |  |
| ✅ | 17j: PUT prefs par la SESSION admin du club -> 200 (accent changé sans code, défauts conservés) |  |
| ✅ | 17j: réinitialisation clubvm -> 200, /api/club-theme redescendu au rose d origine (état propre) |  |
| ✅ | 17j: réinitialisation clubsb par le super-admin -> 200 + retrait du rôle de ChefVm (nettoyage) |  |
| ✅ | 17j: front — common.js applique l accent du club aux variables CSS (--pink/-fort/soft/glow, --pink-soft recalculée en HSL LISIBLE quel que soit l accent et le thème, --pink-fort (fonds de boutons à texte blanc) plafonnée à 45 % de luminosité sinon un accent blanc rend les libellés invisibles: scores/liens/boutons jamais invisibles), cache anti-flash ebpc_accent_club, rafraîchi par /api/club-theme APPELÉ après const LANG (régression TDZ: LANG inaccessible sinon), page TV exclue |  |
| ✅ | 17j/17l: front — 🎨 Apparence du club dans SA PAGE DÉDIÉE /admin-apparence.html (color picker + nom + jour + heure + adresse, adminApi sans confirmation, même écran de code que les pages admin), bouton d accès conservé sur l accueil admin |  |
| ✅ | 17j: front — création de tournoi prérenseignée par les réglages du club (nom/jour/heure via /api/admin/club/prefs, replis d origine) |  |
| ✅ | 17j: front — console: panneau 🎨 Personnalisation avec sélecteur de club (réglage à distance body.slug) |  |
| ✅ | 17j: i18n — panneau Apparence et jours traduits dans les 4 langues (EN/ES/IT/DE) |  |
| ✅ | doc: SPEC 17j + GUIDE_ADMIN (Apparence du club + prérenseignement de tournoi) + ROADMAP #44 |  |

## 17k. Logo du club: prédéfini (whitelist /logos) ou importé (data:image png/jpeg/svg), filigrane discret + en-tête, toutes pages hors TV

| ✅ | 17k: PUT prefs logo prédéfini (whitelist) -> 200 et /api/club-theme sert le logo à TOUS les visiteurs |  |
| ✅ | 17k: bibliothèque statique publique /logos/bille-8.svg -> 200 image/svg+xml (prédéfinis servis à tous) |  |
| ✅ | 17k: PUT prefs logo importé data:image/png;base64 -> 200 (petit logo accepté, stocké dans theme_json) |  |
| ✅ | 17k: PUT prefs logo importé data:image/svg+xml;base64 -> 200 (logo vectoriel accepté) |  |
| ✅ | 17k: PUT logo hors whitelist (/logos/intrus.svg), data:text/html et https:// -> 400 (seuls prédéfinis + data:image png/jpeg/svg) |  |
| ✅ | 17k: PUT logo data:image trop volumineux (> 200 000 caractères) -> 400 (garde-fou stockage) |  |
| ✅ | 17k: super-admin règle le logo d un autre club (body.slug) -> 200, PIN du club refusé (403), isolation par club |  |
| ✅ | 17k: PUT prefs logo_mode invalide -> 400 (switch: entete / filigrane / les-deux) |  |
| ✅ | 17k: PUT prefs logo_mode filigrane -> 200 (switch logo d en-tête / filigrane / les deux) et /api/club-theme sert le mode |  |
| ✅ | 17k: réinitialisation (logo vide, mode les-deux -> défaut, état propre) + front (filigrane filigrane-logo AU-DESSUS du contenu + logo d en-tête + switch logo_mode entete/filigrane/les-deux + cache ebpc_logo_club + galerie page dédiée /admin-apparence.html (17l) + import tolérant 17k v4 (8 Mo, HEIC iPhone et MIME absent acceptés, repli JPEG si PNG trop lourd) + refus explicite 17k v5 (fichier reçu vs attendu + cause probable, cause réelle dans le 400 serveur) + CSP img-src blob: 17k v6 corrigeant le refus de TOUT import via URL.createObjectURL + aperçu 17k v7 du logo retenu avant Enregistrer + vignette importée sélectionnable 17k v8 dans la galerie + repli api() sur club par défaut 17h v2 si le club mémorisé a disparu (404 Club inconnu effacé et appel rejoué, ex: restauration d une base) + regex front base64 corrigée 17k v9 (le + manquait : un logo importé en contenant un n apparaissait ni en filigrane ni en en-tête) + adresse par défaut du club 17j v2 (prérenseigne le lieu de création de tournoi) + console) + docs (SPEC 17k, GUIDE, ROADMAP #45 + #46 page dédiée 17l, 524 checks) + identité visuelle 17n (favicon de l onglet = logo du club, bannière de l accueil (1600 px) + page publique « Le club » (description 500/contact 200, lien du menu), photo de fond TV (1280 px) assombrie, images décodées servies par /api/club-banniere|/api/club-tv-fond avec ?club= (jamais dans le payload club-theme), plafond photo 400 000 caractères, répondants 204 sans image, isolation PIN autre club 403) + icône du club sur l écran du téléphone 17o (manifeste dynamique GET /manifest.webmanifest?club= : nom du club, couleur d accent, start_url conservant le club, Content-Type application/manifest+json ; GET /api/club-icone?club= : préférence au champ icone, repli logo raster, sinon redirection 302 vers /icon-192.png ; champ pref icone png/jpeg base64 plafonné 200 000 caractères, SVG refusé (Android n affiche pas le vectoriel), refus 400 cause réelle, isolation 403 autre club ; conversion AUTOMATIQUE du logo en PNG 192 px côté front à l Enregistrement (canvas, fond couleur d accent, échec -> repli) ; liens manifest et apple-touch-icon + meta theme-color par club côté front) + notification du prochain match 17p (push aux 2 joueurs d un match devenu pret : adversaire + code du match + table si attribuée, 5 langues serveur, fire-and-forget jamais bloquant) + splash screen 17q (manifeste background_color accent pour Android + route /api/club-splash?club=&w=&h= : PNG maison codec serveur sans dépendance, fond accent + icône centrée, 400 dimensions hors bornes + apple-touch-startup-image par taille d écran iPhone côté front) + étanchéité 17r du contexte du club (bannière « Club inconnu ici, tu regardes le club par défaut » sur repli club par défaut : plus jamais de bascule silencieuse, front public ET pages admin, i18n 4 langues + badge du club courant dans le bandeau hors TV/console) + urls du club 17s (payloads push avec ?club=<slug> : match, prochain match, ami, tournoi, rappel, test, repli silencieux si club introuvable ; service worker ne navigue QUE la fenêtre du club du payload, jamais celle d un autre club en multi-PWA ; tous les liens internes portent le club dans l URL (interception au clic, matchUrl comprise) ; sélecteur de la console explicite /admin.html?club=) + chemins du club 17t (Safari/iOS RETIRE la query string des liens d installation et ne lit que le PREMIER manifeste posé sur la page : manifeste, icône et splash servis par CHEMIN par club, /manifest-<slug>.webmanifest, /icone-<slug>.png et /splash/<slug>/<w>x<h>.png, mêmes contenus et mêmes replis que les routes ?club= conservées, slug inconnu -> club par défaut) |  |

## 18. Rattachement compte <-> anciens joueurs anonymes (même pseudo, tournois passés)

| ✅ | création tournoi Retro1 |  |
| ✅ | tirage Retro1 |  |
| ✅ | Retro1 terminé automatiquement (Legende champion), plus de tournoi actif |  |
| ✅ | compte Legende créé après le tournoi (sans tournoi actif) |  |
| ✅ | joueur anonyme du tournoi archivé rattaché au compte (joueurs=1) |  |
| ✅ | fiche joueur: stats du tournoi passé comptées via le compte (1 joué, 1 gagné) |  |
| ✅ | classement: Legende garde ses stats après rattachement (1 joué, 1 titre) |  |

## 19. Front: card match avec retour contextuel (?retour=/referrer) + menu nav

| ✅ | match.html: lien retour dynamique (?retour= > referrer > /suivi.html) + menu nav() |  |
| ✅ | common.js: matchUrl propage ?retour= depuis les cards |  |
| ✅ | common.js: garde-fou onglet dans drawBracketLinks (fix lignes parasites du bracket complet apres resize) |  |
| ✅ | style.css: theme clair (variables + header + liens bracket) + gros score lisible des 2 themes (17j v4: degrade ancre sur var(--text), JAMAIS d override shorthand background: seul sur .scoreboard .s: il reset background-clip -> zone bleue sans chiffres en theme clair) |  |
| ✅ | parametres: interrupteurs 0-1 alignes dans le panneau Parametres (page dediee parametres.html + vue partagee compte-vues.js, basculerTheme + .pref-row + sous-sections, sans texte d aide) |  |
| ✅ | script anti-flash theme present sur toutes les pages sauf TV |  |
| ✅ | i18n: erreur API traduite avec X-Lang: en (Route inconnue -> Unknown route) |  |
| ✅ | i18n: sans X-Lang, erreur API en francais (defaut inchange) |  |
| ✅ | i18n: erreurs API traduites avec X-Lang es/it/de (Route inconnue -> Ruta desconocida / Percorso sconosciuto / Unbekannte Route) |  |
| ✅ | i18n: serveur traduit les erreurs (src/i18n.js + middleware X-Lang dans server.js) |  |
| ✅ | i18n: front traduit (LANG + t() + X-Lang + dictionnaire common.js, selecteur de langue FR/EN dans le bandeau) |  |
| ✅ | front: selecteur de langue dans le bandeau (liste deroulante FR/EN avec drapeaux via menuDeroulant, entree active marquee, bouton = langue courante, ancienne rangee Langue retiree du panneau Parametres) |  |
| ✅ | front: selecteur langue colle a l extremite droite du bandeau (burgers groupes a gauche: #nav flex, justify-content flex-start, margin-left auto) + entree menu principal Tournoi renommee Accueil (traduite Home en EN) |  |
| ✅ | front: selecteur langue detache au bord droit de l ecran aussi sur mobile (<=560px: #nav pleine largeur en colonne, sinon le bouton reste colle au burger Compte) + liste deroulante alignee sur le bord droit du bouton (largeur reelle mesuree via offsetWidth) |  |
| ✅ | push: notifications traduites par destinataire (compte.lang persiste par le selecteur, payloads fr/en: match lance, ami, inscription, test, creation/rappel tournoi; repli hint X-Lang pour le test manuel; position du selecteur a l extremite opposee du menu principal) |  |
| ✅ | i18n: push etendus es/it/de + dictionnaires 5 langues (payloads Te toca jugar / Notifica di prova / Testbenachrichtigung / Spiel eines Freundes läuft, creation tournoi traduite, STATIQUES_ES serveur, I18N_ES front, test unitaire i18n etendu) |  |
| ✅ | front: selecteur de langue 5 entrees dans le bandeau (FR/EN/ES/IT/DE data-driven via LANGUES, drapeaux + libelles natifs, bouton = code langue courante) |  |
| ✅ | i18n: couverture complete (~490 entrees + regles dynamiques dans common.js) |  |
| ✅ | i18n: appels admin traduits aussi (X-Lang dans adminHeaders de admin-common.js + adminCall) |  |
| ✅ | front: burger compte a entrees dynamiques vers des pages dediees (login/register/parametres hors connexion, parametres/amis/mes matchs/ma fiche/deconnexion connecte, table de marque seule si role admin) + checkboxes toggle-mini + append filtre null |  |
| ✅ | front: pages dediees parametres/amis/mes matchs (vues partagees compte-vues.js, garde connexion vers compte.html#connexion sur amis et mes matchs, push-client sur parametres, titres traduits) |  |

## 20. Fil du tournoi (accueil: faits + belle + champion, 3 lignes + étendre, i18n 5 langues)

| ✅ | fil: création tournoi FilT |  |
| ✅ | fil: /api/tournois/:id public expose gagnant + perdant + scores + table + ended_at (contrat du fil) |  |
| ✅ | fil: forfait exposé (etat forfait + gagnant + ended_at pour la ligne dédiée) |  |
| ✅ | fil: front accueil (lignesFil + panneauFil + 3 lignes + Voir tout/Replier + chargerFilDernier) |  |
| ✅ | fil: phrases des lignes (victoire + table + forfait + champion + belle) |  |
| ✅ | fil: élimination définitive uniquement en double KO (LB/F), fusionnée dans la ligne de victoire |  |
| ✅ | fil: horodatage relatif (à l'instant / il y a N min/h/j) + tri par ended_at décroissant |  |
| ✅ | fil: sans tournoi actif, fil du dernier tournoi terminé via /api/tournois/:id (public, champion visible) |  |
| ✅ | fil: i18n EN — règles dyn du fil dans I18N_DYN (beats / table / tournament over / forfeits / wins the tournament / one frame from victory / ago) |  |
| ✅ | fil: i18n ES/IT/DE — remplacements du fil présents (vence/batte/schlägt + champion + hace/fa/vor) |  |
| ✅ | fil: i18n — 4 tableaux dynamiques alignés (I18N_DYN = REPS_DYN_ES = REPS_DYN_IT = REPS_DYN_DE) |  |
| ✅ | fil: i18n — clés statiques du fil dans les 4 dictionnaires (Fil du tournoi + Replier + en direct) |  |
| ✅ | fil: styles du panneau (.fil-ligne, live en rose, colonne sur mobile) |  |

## 21. Fil : variantes de phrases + durées des matchs finis + revanche (confrontations passées, i18n 5 langues)

| ✅ | revanche: création RevA (2 joueurs, duel garanti dans le tableau) |  |
| ✅ | revanche: /api/etat expose actif.h2h pour les matchs pas terminés (première rencontre: n=0, v1=v2=0, dernier null) |  |
| ✅ | revanche: duel de RevA archivé avec sa durée (gagnant + duree_s numérique dans /api/tournois/:id) + h2h du duel FINI exposé dans le payload (première rencontre du club : n=0, v1=v2=0, le match lui-même exclu) |  |
| ✅ | revanche: création RevB (mêmes pseudos, autre tournoi du même club) |  |
| ✅ | revanche: RevB retrouve la paire dans l historique du club (n=1, victoire du bon côté, dernier = gagnant + score + tournoi RevA) |  |
| ✅ | fil: variantes déterministes (filHash/filPick) - victoires, forfaits, champion, belles avec table/sans table 7/4, revanches underdog 7, égalités 6 (complément : +2 par catégorie) |  |
| ✅ | fil: durées des matchs finis composées dans les lignes (dureeFil + duree_s du payload) |  |
| ✅ | fil: lignes revanche (déjà rencontrés via actif.h2h, underdog « une revanche à prendre », égalité, mène X-Y, pas de double si à la belle) |  |
| ✅ | fil: i18n EN - les 43 règles du fil (variantes victoire/forfait/champion/belle, revanche, mène, durée) |  |
| ✅ | fil: i18n ES/IT/DE - variantes et revanche traduites (se impone/ha la meglio/setzt sich durch, domine/tira la toalla/getta la spugna/wirft das Handtuch, revanche adoucie, durées, conduce/führt) |  |
| ✅ | fil: i18n - 4 tableaux toujours alignés après les 43 règles du fil + règle Reçu du refus logo 17k v5 (cDyn = 121) |  |
| ✅ | fil: traces après fin : h2h aussi pour les matchs terminés/forfaits (rencontres STRICTEMENT antérieures, jamais le match lui-même ni un duel postérieur) + h2h servi sur le payload public /api/tournois/:id (fil du dernier tournoi terminé) + suffixes « · après la belle » (score manches-(manches-1)) et « · revanche prise ! » / « · revanche manquée » selon le vainqueur (h2h avant le match), traduits dans les 4 langues |  |

## 22. Menu principal : liens Tableau/TV/« Mon tournoi » masqués sans tournoi ouvert

| ✅ | menu: liens Tableau/TV/Mon tournoi marqués « tournoi seul », retirés du burger tant qu aucun tournoi actif (ré-évalué à chaque ouverture, affichés par défaut avant réponse) |  |
| ✅ | menu: lien suivi.html renommé « Mon tournoi » (ex-« Joueur ») et traduit dans les 4 langues cibles (« Joueur » conservé pour l en-tête stats) |  |

## 23. Journal d'audit : auteur (pseudo admin des modifications), préférences du compte non loggées, burger Compte sans emojis

| ✅ | audit: création du compte de test JRNaudit (201) |  |
| ✅ | audit: JRNaudit promu admin (PIN) |  |
| ✅ | audit: connexion JRNaudit (session admin) |  |
| ✅ | audit: création du tournoi JourA en session admin -> 200 |  |
| ✅ | audit: auteur = JRNaudit dans le journal (colonne auteur sur creation_tournoi en session admin) |  |
| ✅ | audit: création du tournoi JourB via code PIN -> 200 |  |
| ✅ | audit: auteur null quand l action vient du code PIN (aucun pseudo) |  |
| ✅ | audit: préférences du compte modifiables (lang + notif amis -> 200) |  |
| ✅ | audit: les modifications de préférences du compte ne sont plus loggées (0 entrée) |  |
| ✅ | audit: sources cohérentes (colonne « Par » dans admin-journal.html, auteurAdmin(req) sur les routes et corrections/forfaits, colonne auteur en base, aucune trace compte_preferences, burger Compte sans emojis traduit) |  |

## 24. Tableaux responsive : enveloppe .table-wrap, bordures du panneau complètes sur petit écran

| ✅ | tableaux: règle .table-wrap dans style.css (overflow-x: auto, défilement fluide mobile) + table des stats enveloppée |  |
| ✅ | tableaux: fiche joueur (face-à-face + historique), journal d'audit, classement du compte et comptes admin tous enveloppés .table-wrap |  |

## 25. i18n compléments : menu Confidentialité, en-têtes stats, boutons admin, prompts (4 langues)

| ✅ | i18n: menu principal — label « Confidentialitè » corrigé en « Confidentialité » et les nouveaux clés ☰ Menu / Menu traduites dans les 4 langues |  |
| ✅ | i18n: en-têtes des stats traduits (Perdus, % victoires, 🏆 Titres, ⭐ Pts, 💥 Run-outs ×4) + table de marque (Guide admin, Historique public, 🔗 Liens publics ×4, bouton Historique (N) segmenté) |  |
| ✅ | i18n: tournoi admin (Sauvegarde, 📍 Lieu, historique dédié, Inscrire, Corriger, Jamais (3 partout), Tableau final, Tour, Mode auto ACTIF/inactif ×4) + segmentations + window.prompt patché (Distance, Motif, correction table de marque) |  |
| ✅ | i18n: boutons « 🗑 Supprimer » segmentés (historique public, historique de la table de marque, comptes admin) pour matcher la clé « Supprimer » ×4 langues + alerte du journal « 🗑 N entrées supprimées » traduite via t() |  |
| ✅ | infra: app de test ebpc-tournoi-billard-test déployée automatiquement sur la branche staging après CI verte (job deploy-test, fly.test.toml, volume tournoi_data séparé, notice et saut si FLY_TEST_TOKEN absent) + prod déployée automatiquement sur push main (intégration GitHub Fly conservée) + workflow « Déployer prod » conservé en plan B (confirmation PROD, FLY_PROD_TOKEN) + GUIDE_DEPLOY.md + SPEC/ROADMAP à jour |  |
| ✅ | roadmap: cap produit plateforme confirme dans l en-tete + nouveaux chantiers documentes : vidéo live (embed externe puis WebRTC/HLS) + chat live modéré (modération admin, anti-flood, distinct du chat par match) + disciplines paramétrables par club (vocabulaire, format de score, règles activables) + super admin plateforme (gestion clubs, KPI globaux) + KPI enrichis santé d usage + ordre conseillé axe plateforme (20 -> 37 -> 19 -> 31 -> 36) |  |

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
- Rollback point-in-time (snapshots audit: has_snapshot, rollback 200/401/404, état restauré, logué, rollback avec match en cours -> pret 0-0 + table libérée) + confirm_pin requis sur suppressions admin (401 sans/mauvais code) sauf désinscription joueur + slots suivant/perdant exposés + byes exclus du classement + lancements lisibles dans l'audit
- Anti brute-force PIN admin (section 12, si TEST_BRUTEFORCE=1: 429 après N échecs par IP, lockout même pour le bon code, déblocage après délai, compteur remis à zéro au succès)
- Anti-rematch: changement manuel de joueurs vers une paire déjà jouée -> 409 hors finale (section 11) ; simu complète randomisée avec invariant anti-rematch après chaque mutation: test/simu-invariants.js
- Robustesse (section 13): /api/health, 404 JSON routes inconnues, 400 JSON malformé, 413 body >256ko, id NaN -> 404, pseudo tronqué/nettoyé, injection SQL sans effet, 20 manches en parallèle sans 500 ni double comptage
- Lot sécurité 1 (section 14): rate-limit comptes keyé sur x-forwarded-for (429 après 10 échecs sur une IP proxy, IP réelle non lockée) + session admin 8h avec bouton Verrouiller (front)
- Lot fiabilité admin (section 15): export JSON du tournoi, import avec remap des ids + FK validées au COMMIT (401 sans/bon confirm_pin, 400 invalide, 409 si actif sans replace), diff avant rollback (resume + matchs modifiés), filtre du journal ?q=/?action=
- Rôles (section 16): compte role=admin -> session suffit pour requireAdmin ET confirm_pin (destructif); sinon PIN requis (401 sans), confirm_pin requis sur destructifs; POST /api/admin/compte/:id/role (admin/user, 400 invalide)
- Multi-club (section 17): table club + backfill club_id au boot, req.club via X-Club/?club= (404 si slug inconnu, défaut sinon), GET /api/clubs, POST /api/admin/club (200/409/400), tournoi créé dans le club courant, etat/historique/audit/match/joueur scopés par club, isolation cross-club (404: lecture, suppression, saisie) — mono-club = comportement inchangé
- Multi-club PIN et réglages (section 17b): PUT /api/admin/club (nom sans confirm / pin 4-8 chiffres avec confirm_pin / actif), club inactif exclu de /api/clubs et 404 à la résolution, réactivation à distance (super-admin: PIN global ou session admin, 403 pour un simple admin de club), GET /api/admin/clubs (pin_propre/actif, jamais de hash), audit club_modifié
- Multi-club comptes et rôles (section 17c): table compte_club, rôles admin (gestion complète du club par session, confirmations levées) et operateur (routes admin ouvertes, confirmations et rôles refusés), attribution/changement/retrait par le super-admin (PUT/DELETE /api/admin/club/compte), GET /api/admin/club/comptes, /api/compte/moi expose role_club, nb_comptes dans GET /api/admin/clubs, console super-admin /console.html (création, réglages, rôles, 17i)
- Rattachement compte/joueurs anonymes (section 18): compte créé après un tournoi archivé (sans tournoi actif) rattache quand même les lignes anonymes du même pseudo (tournois passés inclus), fiche joueur + classement conservent les stats
- Fil du tournoi (section 20): chronique du tournoi dérivée de l'état (aucun stockage -> cohérente avec les tableaux, rollback et corrections inclus), lignes victoire/forfait/champion/belle, élimination définitive mentionnée uniquement en double KO (LB/F) et fusionnée dans la ligne, 3 dernières lignes + « Voir tout » sur l'accueil, horodatage relatif, dernier tournoi terminé consultable sans tournoi actif (/api/tournois/:id public), phrases i18n dans les 5 langues (clés statiques + règles dynamiques alignées I18N_DYN/REPS_DYN_*)
- Variantes, durées et revanche (section 21): phrases variées par hachage déterministe (7 variantes victoires/forfaits/champion/belles, 4 belles sans table, 6 égalités, 7 revanches underdog), durée des matchs finis dans les lignes (· durée 42 min), lignes « revanche » en direct pour les paires déjà croisées (actif.h2h, historique du club complet, underdog « une revanche à prendre », « mène X-Y », égalité), pas de double ligne si à la belle ; traces après fin (suffixes « · après la belle » et « · revanche prise ! / manquée » via h2h antérieur sur les résultats, servies aussi sur /api/tournois/:id sans tournoi actif) ; 43 règles i18n du fil + règle Reçu du refus logo (17k v5) alignées dans les 5 langues (cDyn = 121)
- Menu principal (section 22): liens Tableau / TV / « Mon tournoi » masqués tant qu'aucun tournoi n'est actif (ré-évalué à chaque ouverture du burger, affichés par défaut avant la réponse), lien suivi.html renommé « Mon tournoi » (ex-« Joueur »), traduit dans les 5 langues
- Journal d'audit (section 23): colonne « Par » = pseudo du compte admin à l'origine de chaque modification (null si code PIN ou action automatique, migration incluse), corrections de score et forfaits porteurs de l'auteur ; les modifications de préférences du compte (langue des push, notifs amis) ne sont plus loggées ; burger Compte sans emojis, labels traduits dans les 4 langues
- Tableaux responsive (section 24): enveloppe .table-wrap (overflow-x: auto) autour de chaque table de données (stats joueurs, fiche joueur face-à-face/historique, journal d'audit admin, classement du compte, comptes admin) : sur petit écran la table défile horizontalement à l'intérieur du panneau, les bordures du panneau englobent toujours toute la table
- i18n compléments (section 25): label « Confidentialité » du menu corrigé (traduit dans les 4 langues, ex-label fautif « Confidentialitè » impossible), burger « ☰ Menu » + aria-label traduits, en-têtes du tableau des stats (Perdus, % victoires, Titres, Pts, Run-outs), boutons de la table de marque (Guide admin, Historique public, Liens publics, Historique (N) segmenté), Sauvegarde / 📍 Lieu / « géré dans sa page dédiée » du tournoi admin, champion et zone WB/LB (Tour, Tableau final) segmentés, Mode auto ACTIF/inactif traduits, window.prompt patché (Distance, Motif, correction table de marque), boutons « 🗑 Supprimer » segmentés (historique public/admin, comptes), alerte du journal « entrées supprimées » traduite
- Infra CI/CD (section 26): flux à deux branches — staging → app de test ebpc-tournoi-billard-test auto-déployée après CI verte (job deploy-test, fly.test.toml, volume tournoi_data séparé, notice et saut si FLY_TEST_TOKEN absent) ; main → prod automatique (intégration GitHub Fly conservée), mise en prod = fusion staging vers main ; workflow « Déployer prod » en plan B (confirmation PROD, FLY_PROD_TOKEN) ; docs/GUIDE_DEPLOY.md (tokens Fly par app, restauration snapshot prod vers test)
- Roadmap cap produit (section 27): plateforme centralisée, séparation logique par club/discipline/tournoi ; nouveaux chantiers : vidéo live (34), chat live modéré (35), disciplines paramétrables par club (36), super admin plateforme (37), KPI enrichis santé d'usage (31) ; axe conseillé : 20 -> 37 -> 19 -> 31 -> 36
- Identité visuelle du club (section 17n): favicon de l onglet = logo du club (repli favicon.svg), bannière de l accueil + photo de fond TV importées (PNG/JPG/SVG, 8 Mo, réduites à 1600/1280 px, plafond 400 000 caractères) servies par /api/club-banniere et /api/club-tv-fond (?club=, 204 sans image, jamais dans le payload club-theme), page publique « Le club » (leclub.html, lien du menu : bannière + nom + adresse + présentation 500 + contact 200) avec fond TV assombri par dégradé pour garder les scores lisibles, gardes pliées dans le check 17k réinitialisation (524 checks conservés)
- i18n FR/EN/ES/IT/DE (section 19): header X-Lang (en/es/it/de) -> erreurs API traduites (Route inconnue -> Unknown route / Ruta desconocida / Percorso sconosciuto / Unbekannte Route), defaut fr inchange, couverture front complete dans common.js (~490 entrees x 4 langues cibles + ~66 regles dynamiques x 4 via I18N_ES/IT/DE + REPS_DYN, LANG multi-valeurs, t(), traduireDomStatique, X-Lang sur api() ET les appels admin, alert/confirm natifs traduits, titre de page traduit, attributs placeholder/title/aria-label/alt), selecteur de langue 5 entrees dans le bandeau (FR/EN/ES/IT/DE data-driven via LANGUES, drapeaux + libelles natifs, ancienne rangee Langue retiree de parametres.html ; interrupteurs theme alignes .pref-row, sous-sections Preferences et Notifications, sans texte d aide; checkboxes de reglages habillees en interrupteurs toggle-mini, burger compte a entrees dynamiques vers des pages dediees (login/register, parametres, amis, mes matchs, ma fiche, deconnexion, table de marque seule si role admin), append filtre les null; selecteur langue colle a l extremite droite de l ecran, sur desktop comme sur mobile <=560px (#nav flex + margin-left auto, #nav pleine largeur en colonne mobile ; listes deroulantes du bandeau alignees sur le bord droit de leur bouton ; entree Accueil ex-Tournoi du menu principal, traduite Home en EN) ; push traduits par destinataire en 5 langues (compte.lang, repli X-Lang pour le test manuel, payloads par langue dans push.js + envoyerTous versions {en,es,it,de}) ; limite restante: payload SSE restent en francais)

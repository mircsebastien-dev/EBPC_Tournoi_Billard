const API = '';

// multi-club: ?club=<slug> dans l'URL est mémorisé et envoyé en header X-Club sur tous les appels API
const CLUB_KEY = 'ebpc_club';
try {
  const c = new URLSearchParams(location.search).get('club');
  if (c) localStorage.setItem(CLUB_KEY, c);
} catch {}
function clubHeaders() {
  try { const c = localStorage.getItem(CLUB_KEY); return c ? { 'X-Club': c } : {}; } catch { return {}; }
}

// i18n front : langue choisie dans le compte (ebpc_lang), defaut fr. t() traduit via le dictionnaire,
// avec repli sur le francais si la chaine est absente (aucun changement en mode fr).
const LANG = (() => { try { return localStorage.getItem('ebpc_lang') === 'en' ? 'en' : 'fr'; } catch { return 'fr'; } })();
const I18N = {
  "Aide": "Help",
  "Amis": "Friends",
  "Annuler": "Cancel",
  "Aucun ami pour le moment": "No friends yet",
  "Aucun historique": "No history",
  "Aucun match pour le moment": "No matches yet",
  "Aucun tournoi pour le moment": "No tournament right now",
  "Aucun tournoi": "No tournament",
  "Aucune donnée": "No data",
  "Bille perdue": "Ball lost",
  "Bille perdue ?": "Ball lost?",
  "Classement": "Ranking",
  "Club": "Club",
  "Compte": "Account",
  "Confidentialité": "Privacy",
  "Confirmation": "Confirmation",
  "Connecté": "Logged in",
  "Connecte-toi pour t'inscrire": "Log in to enter",
  "Créer mon compte": "Create my account",
  "Créer un compte": "Create an account",
  "Déconnexion": "Log out",
  "Défaite": "Loss",
  "Défaillant": "Losing",
  "Détails": "Details",
  "Distance": "Distance",
  "En cours": "Ongoing",
  "Enregistrer": "Save",
  "En cours de match": "Playing now",
  "Envoi du lien de réinitialisation...": "Sending the reset link...",
  "Envoi...": "Sending...",
  "Erreur": "Error",
  "Fermer": "Close",
  "Final": "Final",
  "Finale": "Final",
  "Forfait": "Forfeit",
  "Gagnant": "Winner",
  "gagnant": "winner",
  "Gagné": "Won",
  "Historique": "History",
  "Honnêteté": "Sportsmanship",
  "Inconnu": "Unknown",
  "Inscrits": "Registered",
  "Inscription": "Entry",
  "Inséré": "Entered",
  "Interrompu": "Interrupted",
  "Joueur": "Player",
  "Joueurs": "Players",
  "jour": "day",
  "Langue": "Language",
  "Manche": "Frame",
  "Manches": "Frames",
  "Manches gagnées": "Frames won",
  "Match": "Match",
  "Matchs": "Matches",
  "Matchs en direct": "Live matches",
  "Me désinscrire": "Unregister me",
  "Mon espace": "My space",
  "Mot de passe": "Password",
  "Mot de passe oublié ?": "Forgot password?",
  "Modifier": "Edit",
  "Mute": "Mute",
  "Notifications": "Notifications",
  "Nom": "Name",
  "Non": "No",
  "Oui": "Yes",
  "Ouvrir": "Open",
  "Paramètres": "Settings",
  "Perdu": "Lost",
  "Perdant": "Loser",
  "perdant": "loser",
  "Pseudo": "Username",
  "Prévu": "Scheduled",
  "Prêt": "Ready",
  "Points": "Points",
  "Quitter": "Leave",
  "Rafraîchir": "Refresh",
  "Rejouer": "Replay",
  "Remerciements": "Credits",
  "Retour": "Back",
  "Réduire": "Collapse",
  "Réglages": "Settings",
  "Score": "Score",
  "Se connecter": "Log in",
  "Se déconnecter": "Log out",
  "Sécurité": "Security",
  "Statistiques": "Statistics",
  "Stats": "Stats",
  "Suivre": "Follow",
  "Suivi": "Following",
  "Suivre un joueur": "Follow a player",
  "Table de marque": "Scoreboard",
  "Tables": "Tables",
  "Terminé": "Finished",
  "Terminer": "Finish",
  "Thème": "Theme",
  "Titres": "Titles",
  "Ton compte": "Your account",
  "Tournoi": "Tournament",
  "Tournoi précédent": "Previous tournament",
  "Tournois": "Tournaments",
  "Tout voir": "See all",
  "Tableau": "Bracket",
  "Vainqueur": "Winner",
  "Valider": "Submit",
  "Victoire": "Win",
  "Victoires": "Wins",
  "Vues": "Views",
  "Échec": "Failed",
  "Éditer": "Edit",
  "Préférences": "Preferences",
  "Prénom": "First name",
  "Email": "Email",
  "Chargement...": "Loading...",
  "Charger plus": "Load more",
  "Changer de club": "Change club",
  "M'inscrire": "Enter",
  "Inscriptions": "Entries",
  "Nombre de joueurs": "Number of players",
  "Numéro de match": "Match number",
  "Aucun joueur trouvé": "No player found",
  "Aucun résultat": "No result",
  "Tournoi terminé": "Tournament finished",
  "Tournoi en cours": "Tournament ongoing",
  "Tirage au sort": "Draw",
  "tirage": "draw",
  "Faute": "Foul",
  "Fautes": "Fouls",
  "Meilleure série": "Best run",
  "Membre": "Member",
  "Membres": "Members",
  "Suite": "Next",
  "Suivant": "Next",
  "Précédent": "Previous",
  "Accueil": "Home",
  "Aucun": "None",
  "Aucune": "None",
  "Ajouter": "Add",
  "Supprimer": "Delete",
  "Confirmer": "Confirm",
  "Copier": "Copy",
  "Copié !": "Copied!",
  "Attention": "Warning",
  "Info": "Info",
  "Libre": "Free",
  "Occupée": "Busy",
  "Manche en cours": "Frame ongoing",
  "Match en cours": "Match ongoing",
  "Clic = éditer (admin)": "Click = edit (admin)",
  "Déjà suivi": "Already followed",
  "Ne plus suivre": "Unfollow",
  "Face à face": "Head to head",
  "Adversaire": "Opponent",
  "Adversaires": "Opponents",
  "Série": "Run",
  "Séries": "Runs",
  "Trois quarts": "Quarter finals",
  "Quarts": "Quarters",
  "Demis": "Semis",
  "Demi-finales": "Semi finals",
  "Poules": "Groups",
  "Poule": "Group",
  "Vidéos": "Videos",
  "A propos": "About",
  "Voir": "See",
  "Voir tout": "See all",
  "Eight Ball Pink City — Tournoi": "Eight Ball Pink City — Tournament",
  "Mon compte — Pink City Billard": "My account — Pink City Billard",
  "Paramètres — Pink City Billard": "Settings — Pink City Billard",
  "Amis — Pink City Billard": "Friends — Pink City Billard",
  "Mes matchs — Pink City Billard": "My matches — Pink City Billard",
  "Match — Pink City Billard": "Match — Pink City Billard",
  "Fiche joueur — Pink City Billard": "Player page — Pink City Billard",
  "Stats joueurs — Pink City Billard": "Player stats — Pink City Billard",
  "Joueur — Pink City Billard": "Player — Pink City Billard",
  "Tableau — Pink City Billard": "Bracket — Pink City Billard",
  "Tournoi archivé — Pink City Billard": "Archived tournament — Pink City Billard",
  "Historique — Pink City Billard": "History — Pink City Billard",
  "Historique admin — Pink City Billard": "Admin history — Pink City Billard",
  "Mot de passe oublié — Pink City Billard": "Forgot password — Pink City Billard",
  "Nouveau mot de passe — Pink City Billard": "New password — Pink City Billard",
  "Table de marque — Pink City Billard": "Scoreboard — Pink City Billard",
  "Gérer le tournoi — Pink City Billard": "Manage tournament — Pink City Billard",
  "Journal d'audit — Pink City Billard": "Audit log — Pink City Billard",
  "Comptes joueurs — Table de marque": "Player accounts — Scoreboard",
  "🗄 Données — Table de marque": "🗄 Data — Scoreboard",
  "❓ Aide — Tournoi EBPC": "❓ Help — EBPC Tournament",
  "🔒 Confidentialité — Tournoi EBPC": "🔒 Privacy — EBPC Tournament",
  "⚙️ Guide admin — Tournoi EBPC": "⚙️ Admin guide — EBPC Tournament",
  "dimanche": "Sunday",
  "lundi": "Monday",
  "mardi": "Tuesday",
  "mercredi": "Wednesday",
  "jeudi": "Thursday",
  "vendredi": "Friday",
  "samedi": "Saturday",
  "Casse la manche en cours": "Break the current frame",
  "Gagnés": "Won",
  "Joués": "Played",
  "Mon compte": "My account",
  "Phase finale": "Final stage",
  "⏳ match attendu": "⏳ match pending",
  "▶ Lancer": "▶ Start",
  "🏅 Classement": "🏅 Ranking",
  "👤 Compte": "👤 Account",
  "💾 Enregistrer le score": "💾 Save the score",
  "PIN invalide — reconnecte-toi dans l'admin": "Invalid PIN — log back into the admin",
  "Annulé : code non saisi": "Cancelled: code not entered",
  "Annulé : mot de confirmation non saisi": "Cancelled: confirmation word not entered",
  "Effacer le code mémorisé (sera redemandé à la prochaine action admin)": "Clear the saved code (it will be asked again on the next admin action)",
  "Verrouiller la table de marque ? Le code PIN sera redemandé.": "Lock the scoreboard? The PIN code will be asked again.",
  "connecte-toi avec un compte admin": "log in with an admin account",
  "pour confirmer :": "to confirm:",
  "— aucune —": "— none —",
  "✏️ Score (correction)": "✏️ Score (correction)",
  "👥 Joueurs du match": "👥 Match players",
  "🔐 Table de marque": "🔐 Scoreboard",
  "🔓 Rouvrir le match": "🔓 Reopen the match",
  "Permission refusée": "Permission denied",
  "Push non supporté sur ce navigateur": "Push not supported on this browser",
  "❓ Aide": "❓ Help",
  "🎱 S'inscrire": "🎱 Entering",
  "Compte (👤 en haut à droite) → pseudo + email + mot de passe, puis « M'inscrire » sur l'accueil. Sans compte : champ pseudo sur l'accueil, mais pas de notif push ni d'historique perso. Inscrit par erreur ? Bouton « Me désinscrire » (accueil ou page compte), tant que les inscriptions sont ouvertes et avant paiement (déjà payé : voir la table de marque).": "Account (👤 top right) → username + email + password, then \"Enter\" on the home page. Without an account: username field on the home page, but no push notification and no personal history. Entered by mistake? \"Unregister me\" button (home or account page), as long as registration is open and before payment (already paid: see the scoreboard).",
  "🔔 Notifications « à toi de jouer »": "🔔 \"Your turn to play\" notifications",
  "Ajoute d'abord le site à l'écran d'accueil : Android → ⋯ → « Installer l'application » ; iPhone → OUVRIR LE SITE DANS SAFARI (obligatoire, Chrome iOS ne le permet pas) → Partager → « Sur l'écran d'accueil ». Ouvre ensuite l'app depuis l'écran d'accueil, puis Compte → 🔔 Activer les notifications. Au lancement de ton match tu reçois une notif — un tap ouvre directement la card du match (même écran verrouillé).": "First add the site to your home screen: Android → ⋯ → \"Install app\"; iPhone → OPEN THE SITE IN SAFARI (required, Chrome iOS does not allow it) → Share → \"Add to Home Screen\". Then open the app from the home screen, then Account → 🔔 Enable notifications. When your match starts you get a notification — one tap opens the match card directly (even on the lock screen).",
  "Tu reçois aussi une notif « 🎱 Nouveau tournoi — inscriptions ouvertes » quand la table de marque crée un tournoi (sauf si elle a désactivé le switch 🔔 du formulaire de création).": "You also get a \"🎱 New tournament — registration open\" notification when the scoreboard creates a tournament (unless it disabled the 🔔 switch in the creation form).",
  "🗺️ Suivre le tournoi": "🗺️ Follow the tournament",
  "Tableau : vue bracket (onglets Tout / WB / LB / Phase finale, liens entre matchs sur l’onglet final) ou liste, liste déroulante « Aller au tour », filtre joueur avec Entrée. Dans un match pas encore joué, la place inconnue affiche « gagnant wb1-001 », « perdant lb2-003 » ou « blanc » : tu sais d’où vient le joueur que tu attends. Match en cours = entouré en rouge, terminé = bord vert, gagnant en vert. Avant le tirage au sort, le tableau affiche déjà la structure à vide : les places du tour 1 sont numérotées j1, j2, ... (jusqu’à j32 pour un tableau de 32), tu vois donc le format du tournoi dès sa création. · 📺 TV pour la salle · 🎱 Joueur = tes matchs · 📊 Stats · 🗂 Historique.": "Bracket: bracket view (All / WB / LB / Final stage tabs, links between matches on the final tab) or list, \"Go to round\" dropdown, player filter with Enter. In a match not yet played, the unknown slot shows \"winner wb1-001\", \"loser lb2-003\" or \"blank\": you know where the player you are waiting for comes from. Ongoing match = red outline, finished = green border, winner in green. Before the draw, the bracket already shows the empty structure: round 1 slots are numbered j1, j2, ... (up to j32 for a 32 bracket), so you see the tournament format as soon as it is created. · 📺 TV for the room · 🎱 Player = your matches · 📊 Stats · 🗂 History.",
  "🎲 Jouer un match": "🎲 Play a match",
  "Au lancement, panneau « Tirage à la bande » : chaque joueur fait rouler une bille, le plus proche de la bande gagne → clique « ⚪ [pseudo] casse ». La ⚪ alterne ensuite à chaque manche.": "At match start, \"Lag\" panel: each player rolls a ball, the closest to the cushion wins → click \"⚪ [username] breaks\". The ⚪ then alternates every frame.",
  "Saisie : +1 manche pour le gagnant de la manche, −1 pour corriger (la ⚪ revient alors à l’état précédent). 💥 Casse ferme = réservé au joueur ⚪ (l'autre bouton est grisé). 🎯 Reprise ferme = réservé à l'autre. Dernier point → confirmation du score avec possibilité de modifier.": "Scoring: +1 frame for the frame winner, −1 to correct (the ⚪ then goes back to its previous state). 💥 Break and run = reserved for the ⚪ player (the other button is greyed out). 🎯 Re-rack = reserved for the other. Last point → score confirmation with a chance to edit.",
  "🔑 Mot de passe oublié": "🔑 Forgot password",
  "Compte → « Mot de passe oublié » → email → lien de réinit (valable 1 h).": "Account → \"Forgot password\" → email → reset link (valid for 1 h).",
  "👥 Amis": "👥 Friends",
  "Compte → section Amis : recherche un pseudo (Entrée) et ajoute un ami. Tu reçois une notif push « match d'un ami » quand son match commence, et tu vois son statut en direct (en cours vs …, programmé, inscrit) sur ton compte et sur l'accueil.": "Account → Friends section: search a username (Enter) and add a friend. You get a \"friend's match\" push notification when their match starts, and you see their live status (ongoing vs …, scheduled, entered) on your account and on the home page.",
  "📊 Mon historique": "📊 My history",
  "Compte → « 📊 Ma fiche joueur » : joués/gagnés, %, manches, run-outs + historique de tous tes matchs.": "Account → \"📊 My player page\": played/won, %, frames, run-outs + the history of all your matches.",
  "👤 Ton compte": "👤 Your account",
  "Ton email est masqué (affiché partiellement) ; changement séparé. Un match contre blanc (bye) ne compte ni gagné ni perdu dans tes stats.": "Your email is masked (partially shown); changed separately. A match against a blank (bye) counts as neither won nor lost in your stats.",
  "Guide complet : docs/GUIDE_UTILISATEUR.md dans le dépôt GitHub.": "Full guide: docs/GUIDE_UTILISATEUR.md in the GitHub repository.",
  "🔒 Confidentialité & données": "🔒 Privacy & data",
  "Ce qu'on collecte": "What we collect",
  "Tournoi : inscriptions, matchs, scores, événements, statistiques": "Tournament: entries, matches, scores, events, statistics",
  "Compte joueur : pseudo, email, mot de passe (hashé scrypt+salt, jamais en clair)": "Player account: username, email, password (scrypt+salt hashed, never in plain text)",
  "Notifications push : uniquement si tu les actives (opt-in), abonnement révocable à tout moment": "Push notifications: only if you enable them (opt-in), subscription revocable at any time",
  "Ce qu'on ne fait PAS": "What we do NOT do",
  "Aucun cookie de tracking/publicité, aucune revente de données, aucun partage à des tiers (sauf envoi d'emails via Resend pour la réinitialisation de mot de passe).": "No tracking/advertising cookies, no data resale, no sharing with third parties (except emails sent via Resend for password reset).",
  "Finalités & base légale": "Purposes & legal basis",
  "Faire fonctionner le tournoi (inscriptions, matchs, scores, classements, notifications) = exécution du service demandé. Les emails servent uniquement à la réinit du mot de passe. Les données sont conservées tant que le compte est actif ; les comptes inactifs 18 mois sont supprimés automatiquement.": "Running the tournament (entries, matches, scores, rankings, notifications) = execution of the requested service. Emails are only used for password reset. Data is kept as long as the account is active; accounts inactive for 18 months are deleted automatically.",
  "Hébergement": "Hosting",
  "Application hébergée sur Fly.io (société américaine) en région Paris (cdg), base SQLite sur volume. Un transfert hors UE peut exister côté infrastructure ; les données restent sous notre responsabilité.": "Application hosted on Fly.io (US company) in the Paris (cdg) region, SQLite database on a volume. A transfer outside the EU may exist on the infrastructure side; the data remains our responsibility.",
  "Responsable du traitement": "Data controller",
  "Voir avec la table de marque du tournoi.": "Contact the tournament scoreboard.",
  "Technique : cookie de session strictement nécessaire (HttpOnly, SameSite, Secure), préférences navigateur (localStorage : joueur suivi, vue tableau)": "Technical: strictly necessary session cookie (HttpOnly, SameSite, Secure), browser preferences (localStorage: followed player, bracket view)",
  "Mots de passe hashés (scrypt + sel), sessions en cookie HttpOnly/SameSite/Secure, tokens de réinit hashés et valables 1 h, rate-limit sur connexion/inscription. Contact en cas d'incident : via la table de marque.": "Passwords hashed (scrypt + salt), sessions in HttpOnly/SameSite/Secure cookies, reset tokens hashed and valid for 1 h, rate limit on login/signup. Contact in case of an incident: via the scoreboard.",
  "✏️ Rectification : changer pseudo/email dans le compte ; corrections admin possibles": "✏️ Rectification: change username/email in the account; admin corrections possible",
  "📥 Accès/export : bouton « Exporter mes données » dans ton compte (JSON complet)": "📥 Access/export: \"Export my data\" button in your account (full JSON)",
  "🗑 Effacement : suppression du compte par l'admin (les matchs restent dans l'historique anonymisé du tournoi), purge auto 18 mois": "🗑 Erasure: account deleted by the admin (matches remain in the tournament's anonymised history), automatic purge after 18 months",
  "🚫 Opposition : désactive les notifications push à tout moment": "🚫 Objection: disable push notifications at any time",
  "Donne l'email de ton compte : on t'envoie un lien de réinitialisation (valable 1h).": "Enter your account email: we will send you a reset link (valid for 1h).",
  "Envoyer le lien": "Send the link",
  "🔐 Nouveau mot de passe": "🔐 New password",
  "Changer le mot de passe": "Change the password",
  "Nouveau mot de passe (min 4)": "New password (min 4)",
  "✅ Mot de passe changé, tu es connecté. Redirection…": "✅ Password changed, you are logged in. Redirecting…",
  "Joueur introuvable.": "Player not found.",
  "Bilan tous tournois confondus.": "Record across all tournaments.",
  "Résultat": "Result",
  "Statistiques joueurs (tous les tournois)": "Player statistics (all tournaments)",
  "Aucune statistique pour le moment.": "No statistics yet.",
  "🔴 À toi de jouer": "🔴 Your turn to play",
  "Qui es-tu ?": "Who are you?",
  "Touche ton pseudo ci-dessous.": "Tap your username below.",
  "Tes matchs": "Your matches",
  "Aucun match pour le moment. Le tirage arrive bientôt ! 🎱": "No matches yet. The draw is coming soon! 🎱",
  "Aucun tournoi en cours.": "No ongoing tournament.",
  "🎱 Aucun tournoi en cours": "🎱 No ongoing tournament",
  "Aller au tour :": "Go to round:",
  "— Choisir un tour —": "— Pick a round —",
  "🔍 Filtrer par joueur (ex: seb) — Entrée pour valider": "🔍 Filter by player (e.g. seb) — Enter to apply",
  "Le tableau (structure à vide) apparaîtra ici dès la création d'un tournoi, les joueurs après le tirage au sort.": "The bracket (empty structure) will appear here as soon as a tournament is created, and the players after the draw.",
  "📊 Statistiques du tournoi": "📊 Tournament statistics",
  "🔍 Surligner un joueur (ex: seb) — Entrée pour valider": "🔍 Highlight a player (e.g. seb) — Enter to apply",
  "Aucun tournoi terminé pour le moment.": "No finished tournament yet.",
  "Tous les tournois terminés restent consultables ici.": "All finished tournaments remain available here.",
  "Voir le tableau": "See the bracket",
  "La TV Pink City est pensée pour le mode paysage": "The Pink City TV is designed for landscape mode",
  "Tourne l'écran en paysage": "Turn your screen to landscape",
  "QR code du site": "Site QR code",
  "Scanner pour ouvrir le site sur ton téléphone": "Scan to open the site on your phone",
  "🎉 Félicitations ! 🎉": "🎉 Congratulations! 🎉",
  "Champion de la Pink City": "Pink City champion",
  "En attente des matchs…": "Waiting for matches…",
  "Le tournoi va bientôt commencer": "The tournament will start soon",
  "🎱 Aucun tournoi pour le moment": "🎱 No tournament right now",
  "🏁 TERMINÉ": "🏁 FINISHED",
  "📱 Scanne pour ouvrir le site": "📱 Scan to open the site",
  "📱 Scanne pour t'inscrire": "📱 Scan to enter",
  "Inscriptions ouvertes": "Registration open",
  "🏁 Terminé": "🏁 Finished",
  "👤 Mon compte": "👤 My account",
  "🗺 Voir le tableau complet →": "🗺 See the full bracket →",
  "— hors tournoi": "— outside the tournament",
  "Aucun ami — ajoute-en depuis ton compte (👤).": "No friends — add some from your account (👤).",
  "Inscrit par erreur ? Tu peux te désinscrire tant que les inscriptions sont ouvertes et que tu n'as pas payé.": "Entered by mistake? You can unregister as long as registration is open and you have not paid.",
  "Jamais inscrit à un tournoi de ce club — pas de fiche": "Never entered a tournament in this club — no player page",
  "Revenez bientôt !": "Come back soon!",
  "Te désinscrire du tournoi ?": "Unregister from the tournament?",
  "Ton pseudo": "Your username",
  "gérer mon compte": "manage my account",
  "Élimination directe": "Single elimination",
  "💡 Crée un compte (pseudo + email + mot de passe) pour t'inscrire en 1 clic et retrouver tes stats :": "💡 Create an account (username + email + password) to enter in 1 click and find your stats:",
  "💰 Déjà payé : la désinscription se fait auprès de la table de marque (remboursement à voir avec le club).": "💰 Already paid: unregistering is done at the scoreboard (refund to be discussed with the club).",
  "📝 inscrit au tournoi": "📝 entered in the tournament",
  "✨ Créer un compte": "✨ Create an account",
  "Juste un pseudo, un email et un mot de passe. Rien d'autre.": "Just a username, an email and a password. Nothing else.",
  "Ma fiche joueur": "My player page",
  "Email (pour réinit du mot de passe)": "Email (for password reset)",
  "Nouvel email (vide = inchangé)": "New email (empty = unchanged)",
  "Email inchangé": "Email unchanged",
  "✅ Email mis à jour": "✅ Email updated",
  "Mot de passe (min 4)": "Password (min 4)",
  "Se déconnecter ?": "Log out?",
  "(sans compte)": "(no account)",
  "📋 Mon inscription": "📋 My entry",
  "Possible tant que les inscriptions sont ouvertes et que tu n'as pas payé.": "Possible as long as registration is open and you have not paid.",
  "Exporter mes données (RGPD)": "Export my data (GDPR)",
  "Voir aussi : 🔒 Confidentialité (menu ☰)": "See also: 🔒 Privacy (☰ menu)",
  "Aucun ami pour le moment — recherche un pseudo ci-dessus.": "No friends yet — search a username above.",
  "déjà ami": "already a friend",
  "Suis des joueurs : tu reçois une notif quand leur match commence ou quand ils s'inscrivent à un tournoi, et leur statut ici. Pas besoin de compte pour eux : entre son pseudo dans la recherche puis « Suivre ».": "Follow players: you get a notification when their match starts or when they enter a tournament, and their status here. They do not need an account: type their username in the search then \"Follow\".",
  "🔔 Notifier quand le match d'un ami commence": "🔔 Notify me when a friend's match starts",
  "🔔 Notifier quand un ami s'inscrit à un tournoi": "🔔 Notify me when a friend enters a tournament",
  "Activer les notifications": "Enable notifications",
  "Désactiver": "Disable",
  "Tester la notification": "Test the notification",
  "Notifications activées !": "Notifications enabled!",
  "Notifications désactivées": "Notifications disabled",
  "⚠️ Aucun appareil abonné — active les notifications avant.": "⚠️ No subscribed device — enable notifications first.",
  "Reçois une notification push quand un de tes matchs est lancé (même écran verrouillé).": "Get a push notification when one of your matches starts (even on the lock screen).",
  "📱 Sur iPhone : ajoute d'abord le site à l'écran d'accueil (Safari → Partager → « Sur l'écran d'accueil »), puis active les notifications.": "📱 On iPhone: first add the site to the home screen (Safari → Share → \"Add to Home Screen\"), then enable notifications.",
  "🎱 Mes matchs": "🎱 My matches",
  "Pas (encore !) d'inscription ni de match à afficher.": "No registration or match to display (yet!).",
  "🔍 Rechercher un pseudo… (Entrée)": "🔍 Search a username… (Enter)",
  "🎱 Match en direct": "🎱 Live match",
  "← Mes matchs": "← My matches",
  "+1 manche": "+1 frame",
  "−1 manche": "−1 frame",
  "🎲 Tirage à la bande": "🎲 Lag",
  "Chaque joueur fait rouler une bille sur le tapis : le plus proche de la bande remporte le tirage et casse en premier (⚪).": "Each player rolls a ball on the cloth: the closest to the cushion wins the lag and breaks first (⚪).",
  "En attente de la table…": "Waiting for the table…",
  "La table de marque va lancer le match…": "The scoreboard will start the match…",
  "La saisie des points est bloquée tant que le tirage à la bande n'est pas fait.": "Scoring is locked until the lag is done.",
  "Confirmer le score": "Confirm the score",
  "Vérifie le score sur la table avant de confirmer.": "Check the score at the table before confirming.",
  "Modifier (annuler ce point)": "Edit (cancel this point)",
  "⚠️ Dernier point ?": "⚠️ Last point?",
  "Le joueur qui a la casse ne fait pas de reprise ferme": "The player who breaks cannot re-rack",
  "Seul le joueur qui a la casse peut faire une casse ferme": "Only the player who breaks can break and run",
  "Match introuvable.": "Match not found.",
  "Consultation seule — tu ne joues pas ce match.": "View only — you are not playing this match.",
  "🎱 Table de marque": "🎱 Scoreboard",
  "Espace table de marque": "Scoreboard area",
  "📌 Accès rapide": "📌 Quick access",
  "Comptes joueurs": "Player accounts",
  "Configurer / gérer le tournoi": "Configure / manage the tournament",
  "Données": "Data",
  "Journal d'audit": "Audit log",
  "Aucun tournoi actif pour le moment.": "No active tournament right now.",
  "Nouveau tournoi": "New tournament",
  "Créer le tournoi": "Create the tournament",
  "Règle": "Rule",
  "Taille max": "Max size",
  "Nombre de tables": "Number of tables",
  "📅 Date et heure": "📅 Date and time",
  "Têtes de série": "Seeds",
  "Préfixe": "Prefix",
  "N° série": "Seed #",
  "Double KO + tableau final": "Double KO + final bracket",
  "Double KO sur": "Double KO on",
  "Finale seule": "Final only",
  "Distance spéciale": "Special distance",
  "Distance spéciale à partir de": "Special distance from",
  "Réservées à partir du tour n° (vide = quarts)": "Reserved from round # (empty = quarters)",
  "Tables réservées en phase finale (jamais utilisées en auto à partir des quarts)": "Tables reserved for the final stage (never used automatically from the quarter-finals)",
  "Ordre des tables (mode auto)": "Table order (auto mode)",
  "Ajuster auto la taille au nombre de payés": "Auto-adjust size to the number of paid players",
  "Nouveau joueur": "New player",
  "Lancer le tirage ? Inscriptions closes.": "Start the draw? Registration will be closed.",
  "▶ Simuler tout le tournoi": "▶ Simulate the whole tournament",
  "⚠️ Clôturer le tournoi": "⚠️ Close the tournament",
  "Terminer le tournoi maintenant": "Finish the tournament now",
  "Terminer le tournoi maintenant ?": "Finish the tournament now?",
  "Termine le tournoi immédiatement (même si la finale n'a pas été jouée). Les tableaux restent en ligne.": "Finishes the tournament immediately (even if the final has not been played). The brackets stay online.",
  "Supprimer le tournoi": "Delete the tournament",
  "Supprimer le tournoi et TOUT son contenu ?": "Delete the tournament and ALL its content?",
  "Enregistré ✅": "Saved ✅",
  "✅ Tournoi importé": "✅ Tournament imported",
  "📥 Exporter le tournoi actif": "📥 Export the active tournament",
  "📤 Importer un JSON": "📤 Import a JSON",
  "Exporte le tournoi actif en JSON (backup, rejouer ailleurs), ou importe un export (remplace le tournoi actif — code PIN re-demandé).": "Export the active tournament as JSON (backup, replay elsewhere), or import an export (replaces the active tournament — PIN code asked again).",
  "🗺 Voir / éditer les matchs": "🗺 See / edit the matches",
  "Ouvrir le tableau": "Open the bracket",
  "Ouvrir l'historique": "Open the history",
  "🎱 Tables disponibles": "🎱 Available tables",
  "🎱 Table auto (libre)": "🎱 Auto table (free)",
  "🤖 Mode auto :": "🤖 Auto mode:",
  "Mode auto :": "Auto mode:",
  "🤖 Gestion automatique": "🤖 Automatic management",
  "Lance automatiquement le prochain match dès qu'un match se termine (priorité : Tour 1, puis LB1#1, WB2#1, LB2#1…).": "Automatically starts the next match as soon as one finishes (priority: Round 1, then LB1#1, WB2#1, LB2#1…).",
  "🔔 Notif push « inscriptions ouvertes »": "🔔 \"Registration open\" push notification",
  "🔔 Rappel inscriptions ouvertes (push aux joueurs abonnés)": "🔔 Registration reminder (push to subscribed players)",
  "Clique sur un match du tableau pour lancer, corriger le score, déclarer un forfait ou rouvrir — sans quitter le tableau.": "Click a bracket match to start it, fix the score, declare a forfeit or reopen — without leaving the bracket.",
  "📏 Distances (modifiables à tout moment)": "📏 Distances (editable at any time)",
  "Inscrit des joueurs fictifs en masse, directement payés.": "Enters fake players in bulk, directly paid.",
  "— aucun (coupe net) —": "— none (straight cut) —",
  "ex: 1,2 (vide = aucune)": "e.g. 1,2 (empty = none)",
  "marquer payé": "mark as paid",
  "🗄 Gestion des données": "🗄 Data management",
  "👥 Joueurs": "👥 Players",
  "🎱 Matchs": "🎱 Matches",
  "📜 Events d'un match": "📜 Match events",
  "Choisis un match.": "Pick a match.",
  "Aucun tournoi actif.": "No active tournament.",
  "Aucun événement.": "No event.",
  "🔍 Filtrer (pseudo/joueur) — Entrée": "🔍 Filter (username/player) — Enter",
  "➕ manche": "➕ frame",
  "🎲 tirage à la bande": "🎲 lag",
  "🚀 lancement": "🚀 match start",
  "▶ tournoi actif": "▶ active tournament",
  "État": "State",
  "(recalcul du score)": "(score recalculated)",
  "Supprimer cet événement ? Le score sera recalculé.": "Delete this event? The score will be recalculated.",
  "👤 Comptes joueurs": "👤 Player accounts",
  "Aucun compte.": "No account.",
  "Aucun ami": "No friend",
  "Aucune notification activée": "No notification enabled",
  "Créé le": "Created",
  "Dernière connexion": "Last login",
  "Nb inscri. tournois": "Tournament entries",
  "✏️ pseudo": "✏️ username",
  "Renommer le pseudo du compte": "Rename the account username",
  "Changer le mot de passe du compte": "Change the account password",
  "🔍 Rechercher (pseudo ou email)…": "🔍 Search (username or email)…",
  "✅ Pseudo changé": "✅ Username changed",
  "✅ Mot de passe changé (sessions invalidées)": "✅ Password changed (sessions invalidated)",
  "Rétrograder en simple utilisateur (le PIN restera nécessaire pour l’admin)": "Demote to regular user (the PIN will still be required for the admin)",
  "Promouvoir administrateur (sa session suffira pour l’admin, sans PIN)": "Promote to administrator (their session will be enough for the admin, without PIN)",
  "Rétrograder": "Demote",
  "Rechercher (action, cible, détails)…": "Search (action, target, details)…",
  "Action exacte (ex: tirage)": "Exact action (e.g. draw)",
  "Vider le journal": "Clear the log",
  "Vider tout le journal d'audit ? (irréversible)": "Clear the whole audit log? (irreversible)",
  "✖ Tout afficher": "✖ Show all",
  "⏪ Restaurer à ce point": "⏪ Restore to this point",
  "✅ Tournoi restauré": "✅ Tournament restored",
  "Le contenu actuel du tournoi sera remplacé.": "The current tournament content will be replaced.",
  "Exemples de matchs modifiés:": "Examples of changed matches:",
  "⚙️ Guide admin": "⚙️ Admin guide",
  "1. Créer le tournoi": "1. Create the tournament",
  "2. Inscriptions": "2. Registration",
  "3. Tirage": "3. Draw",
  "4. Lancer les matchs": "4. Start the matches",
  "5. Interventions en cours (clic card avec PIN → modale ⚙️)": "5. In-match interventions (card click with PIN → ⚙️ modal)",
  "6. Données (/admin-data.html)": "6. Data (/admin-data.html)",
  "7. Classement par points": "7. Points ranking",
  "8. Clôturer": "8. Closing",
  "9. Annuler une action : rollback point-in-time (journal d'audit)": "9. Undo an action: point-in-time rollback (audit log)",
  "10. Comptes & audit": "10. Accounts & audit",
  "11. Tests & déploiement": "11. Tests & deployment",
  "Accès : code PIN (env `ADMIN_PIN`) ou session d'un compte avec le rôle `admin` (bootstrap via `ADMIN_EMAIL`/`ADMIN_PASSWORD`, promotion depuis /admin-comptes.html).": "Access: PIN code (`ADMIN_PIN` env) or the session of an account with the `admin` role (bootstrap via `ADMIN_EMAIL`/`ADMIN_PASSWORD`, promoted from /admin-comptes.html).",
  "/admin-tournoi.html → nom, règle, taille (16/32/64/128), format (élim. directe / double KO + nb tours), nb tables, date. Ajustement auto à la taille des payés. Tables réservées: vide par défaut. En phase inscription, la TV montre un grand QR centré pour s'inscrire. Switch 🔔 « Notif push « inscriptions ouvertes » (coché par défaut) : à la création, un push « 🎱 Nouveau tournoi — inscriptions ouvertes » est envoyé à tous les comptes abonnés.": "/admin-tournoi.html → name, rule, size (16/32/64/128), format (single elimination / double KO + rounds), table count, date. Auto-adjust to the number of paid players. Reserved tables: empty by default. During registration, the TV shows a big centred QR code to enter. 🔔 \"Registration open\" push switch (checked by default): on creation, a \"🎱 New tournament — registration open\" push is sent to all subscribed accounts.",
  "Ajouter / simuler / payer / supprimer. Seuls les payés sont tirés. ⛔ Pseudo d'un compte = réservé: inscription anonyme refusée (409, anti-usurpation); ajout admin possible après confirmation (joueur rattaché au compte). Un invité qui crée un compte avec le même pseudo est rattaché auto (reçoit les pushs). ♻️ Un compte connecté peut se désinscrire lui-même (bouton « Me désinscrire »), en phase d'inscription uniquement et avant paiement ; un joueur déjà payé ou sans compte passe par un admin. Pseudo/mdp oublié → /admin-comptes.html (✏️ pseudo, 🔑 mdp).": "Add / simulate / pay / delete. Only paid players are drawn. ⛔ An account's username = reserved: anonymous entry refused (409, anti-impersonation); admin addition possible after confirmation (player linked to the account). A guest who creates an account with the same username is auto-linked (receives the pushes). ♻️ A logged-in account can unregister itself (\"Unregister me\" button), during registration only and before payment; an already-paid player or one without an account goes through an admin. Forgotten username/password → /admin-comptes.html (✏️ username, 🔑 password).",
  "Bouton Tirage: appariements aléatoires crypto, byes répartis. ⚠️ Fige le bracket (retour en arrière possible uniquement par rollback point-in-time via le journal d'audit, voir §9).": "Draw button: crypto-random pairings, byes spread out. ⚠️ Freezes the bracket (going back only possible via point-in-time rollback in the audit log, see §9).",
  "Mode auto ON = départ auto sur table libre (ordre personnalisable). Manuel: clic sur une card (PIN) → modale. Tirage à la bande ⚪ sur la card, puis alternance à chaque manche. Joueurs: seul le ⚪ fait « casse ferme », l'autre « reprise ferme » (grisé + 403). Dernier point = confirmation obligatoire.": "Auto mode ON = auto start on a free table (customisable order). Manual: click a card (PIN) → modal. Lag ⚪ on the card, then alternating every frame. Players: only the ⚪ does \"break and run\", the other \"re-rack\" (greyed out + 403). Last point = mandatory confirmation.",
  "✏️ Corriger le score (si distance atteinte → termine + propage)": "✏️ Fix the score (if distance reached → finishes + propagates)",
  "🎱 Déplacer de table (409 si occupée, « aucune » pour libérer)": "🎱 Move to another table (409 if busy, \"none\" to free it)",
  "👥 Changer les joueurs (WB/LB, blanc possible, bye auto) — 409 auto si la paire est déjà appariée ailleurs (hors finale): rematch impossible": "👥 Change the players (WB/LB, blank possible, auto bye) — auto 409 if the pair is already paired elsewhere (except the final): rematch impossible",
  "🔓 Rouvrir un match — ⚠️ 409 INTERDIT si un match aval a déjà commencé": "🔓 Reopen a match — ⚠️ 409 FORBIDDEN if a downstream match has already started",
  "🚫 Forfait (définitif)": "🚫 Forfeit (final)",
  "Onglets Matchs / Joueurs / Events sur le tournoi actif OU un tournoi terminé (sélecteur), filtre par pseudo (Entrée). Events: 🗑 supprime un event et recalcule le score → les stats se corrigent. Joueurs: éditer pseudo/statut, supprimer.": "Matchs / Players / Events tabs on the active tournament OR a finished tournament (selector), filter by username (Enter). Events: 🗑 deletes an event and recalculates the score → stats fix themselves. Players: edit username/status, delete.",
  "Points = profondeur atteinte (WB: tour, F: k+tour en DKO), ex-aequo (1,1,1,4…). Les matchs clôturés sans gagnant ne comptent pas comme perdus.": "Points = depth reached (WB: round, F: k+round in DKO), ties (1,1,1,4…). Matches closed without a winner do not count as losses.",
  "Règles DKO: WB/LB séparés jusqu'en finale; en F, alternance des moitiés + swap anti-rematch auto sur tous les tours WB/LB/F (rematch autorisé uniquement en vraie finale).": "DKO rules: WB/LB separate until the final; in F, halves alternate + auto anti-rematch swap on all WB/LB/F rounds (rematch allowed only in a true final).",
  "« Terminer maintenant » = coupe net, aucun champion auto (sauf choix explicite dans le select). Fin normale = champion auto via la finale. Historique ensuite en liste + recherche/surbrillance joueur.": "\"Finish now\" = straight cut, no auto champion (unless explicitly chosen in the select). Normal finish = auto champion via the final. History then as a list + search/player highlight.",
  "/admin-journal.html : chaque action admin est loguée ET snapshotée. Bouton ⏮ « Restaurer à ce point » sur une entrée = restaure le tournoi actif à l'état exact de cet événement (transaction atomique ; fonctionne même avec des matchs en cours → remis à 0-0, tables libérées). Un diff (matchs modifiés/ajoutés/supprimés, joueurs, statut, champion) s'affiche dans la confirmation avant validation. 409 si le snapshot concerne un autre tournoi, 404 sans snapshot. Le rollback est lui-même logué. Filtres du journal : recherche texte + type d'action.": "/admin-journal.html: every admin action is logged AND snapshotted. ⏮ \"Restore to this point\" button on an entry = restores the active tournament to the exact state of that event (atomic transaction; works even with ongoing matches → reset to 0-0, tables freed). A diff (changed/added/deleted matches, players, status, champion) shows in the confirmation before validating. 409 if the snapshot is from another tournament, 404 without snapshot. The rollback itself is logged. Log filters: text search + action type.",
  "/admin-comptes.html: liste (dernière connexion, inscri., matchs, sessions, amis : amis avec compte + pseudos suivis sans compte), ✏️ pseudo, 🔑 mdp, 🗑 supprimer (historique matchs conservé). Purge auto des comptes inactifs > 18 mois. /admin-journal.html: 500 dernières actions admin, lancements lisibles (« wb1-001 — P11 vs P07 (table 3) »). Le rollback point-in-time (bouton ⏮ « Restaurer à ce point ») est détaillé §9. 🔐 Toute action destructive (suppression tournoi/compte/event, vidage du journal, rollback) exige le code PIN re-saisi (modale masquée, `confirm_pin`) — sauf la désinscription d'un joueur. Une session de compte avec le rôle `admin` ne redemande pas le PIN, mais exige de saisir le mot `SUPPRIMER` dans la modale de confirmation.": "/admin-comptes.html: list (last login, entries, matches, sessions, friends: friends with accounts + followed usernames without accounts), ✏️ username, 🔑 password, 🗑 delete (match history kept). Automatic purge of accounts inactive > 18 months. /admin-journal.html: last 500 admin actions, readable starts (\"wb1-001 — P11 vs P07 (table 3)\"). The point-in-time rollback (⏮ \"Restore to this point\" button) is detailed in §9. 🔐 Every destructive action (tournament/account/event deletion, log clearing, rollback) requires the PIN re-entered (masked modal, `confirm_pin`) — except unregistering a player. An account session with the `admin` role does not ask for the PIN again, but requires typing the word `SUPPRIMER` in the confirmation modal.",
  "Batterie: BASE=http://127.0.0.1:PORT node test/batterie.js (203 checks → test/rapport.md) + test/e2e.js + test/fullrun.js ; sans serveur : node test/push-unit.js (push mocké), node test/purge-unit.js (purge > 90 j). Fly: secrets ADMIN_PIN, RESEND_API_KEY, MAIL_FROM, VAPID_* (jamais BASE_URL); volume tournoi_data sur /data; snapshots dans Volumes.": "Battery: BASE=http://127.0.0.1:PORT node test/batterie.js (203 checks → test/rapport.md) + test/e2e.js + test/fullrun.js ; without a server: node test/push-unit.js (mocked push), node test/purge-unit.js (purge > 90 d). Fly: secrets ADMIN_PIN, RESEND_API_KEY, MAIL_FROM, VAPID_* (never BASE_URL); tournoi_data volume on /data; snapshots in Volumes.",
  "Version complète: docs/GUIDE_ADMIN.md dans le dépôt GitHub.": "Full version: docs/GUIDE_ADMIN.md in the GitHub repository.",
  "Aucun tournoi terminé.": "No finished tournament.",
  "Consultation et suppression (admin).": "Viewing and deletion (admin).",
  "Simuler tout le tournoi (scores aléatoires) jusqu'au champion ?": "Simulate the whole tournament (random scores) up to the champion?",
  "payé annuler": "cancel paid",
  "déjà suivi": "already followed",
  "👤 Connecté en tant que": "👤 Logged in as",
  "Retour à": "Back to",
  "Restaurer le tournoi actif à l'état de cet événement ?": "Restore the active tournament to this event's state?",
  "Ou": "Or",
  "⚙️ Paramètres": "⚙️ Settings",
  "Mode clair": "Light mode",
  "🔑 Connexion": "🔑 Log in",
  "👤 Ma fiche joueur": "👤 My player page",
  "🛠 Table de marque": "🛠 Scoreboard",
  "🚪 Se déconnecter": "🚪 Log out",
};
const I18N_DYN = [
  [/^Erreur (\d+)$/, "Error $1"],
  [/^Fiche de (.+)$/, "Player page of $1"],
  [/^Te désinscrire du tournoi « (.+) » \?$/, "Unregister from tournament \"$1\"?"],
  [/^Supprimer le joueur « (.+) » \?$/, "Delete player \"$1\"?"],
  [/^Supprimer « (.+) » de l'historique \?$/, "Delete \"$1\" from history?"],
  [/^Supprimer définitivement « (.+) » de l'historique \?$/, "Permanently delete \"$1\" from history?"],
  [/^Gérer le tournoi « (.+) »$/, "Manage tournament \"$1\""],
  [/^🕐 programmé vs (.+)$/, "🕐 scheduled vs $1"],
  [/^🕐 match programmé vs (.+)$/, "🕐 match scheduled vs $1"],
  [/^🟢 en cours vs (.+)$/, "🟢 ongoing vs $1"],
  [/^✅ Inscrit \(payé\)$/, "✅ Entered (paid)"],
  [/^✅ Inscrit \(en attente de paiement\)$/, "✅ Entered (awaiting payment)"],
  [/^M'inscrire à « (.+) » en tant que (.+)$/, "Enter \"$1\" as $2"],
  [/^Tableau de (\d+)$/, "Bracket of $1"],
  [/^Lancer le tirage \((\d+) payés\)$/, "Start the draw ($1 paid)"],
  [/^⏳ Prêts à lancer \((\d+)\)$/, "⏳ Ready to start ($1)"],
  [/^Forfait de (.+) \?$/, "Forfeit for $1?"],
  [/^Score de (.+) \(0-(\d+)\) :$/, "Score for $1 (0-$2):"],
  [/^Nouveau pseudo pour « (.+) » \(min (\d+) caractères?\) :$/, "New username for \"$1\" (min $2 characters):"],
  [/^Nouveau mot de passe pour « (.+) » \(min (\d+) caractères?\) :$/, "New password for \"$1\" (min $2 characters):"],
  [/^Supprimer le compte « (.+) » \?\nLes joueurs rattachés sont détachés \(l'historique des matchs est conservé\), les sessions et abonnements push sont supprimés\.$/, "Delete account \"$1\"?\nAttached players are detached (match history kept), sessions and push subscriptions deleted."],
  [/^Manches gagnées : (\d+)$/, "Frames won: $1"],
  [/^⚔️ Face-à-face \((\d+) adversaire\)$/, "⚔️ Head to head ($1 opponent)"],
  [/^⚔️ Face-à-face \((\d+) adversaires\)$/, "⚔️ Head to head ($1 opponents)"],
  [/^🎱 (\d+) joués$/, "🎱 $1 played"],
  [/^🏆 (\d+) gagnés$/, "🏆 $1 won"],
  [/^Début : (.+)$/, "Start: $1"],
  [/^· Durée : (.+)$/, "· Duration: $1"],
  [/^🏁 (.+) remporte le match$/, "🏁 $1 wins the match"],
  [/^🏆 (.+) remporte le match$/, "🏆 $1 wins the match"],
  [/^Le score deviendrait (\d+) - (\d+)\.$/, "The score would become $1 - $2."],
  [/^📍 Va à la table n° (\d+)$/, "📍 Go to table #$1"],
  [/^Historique des tournois \((\d+)\)$/, "Tournament history ($1)"],
  [/^Historique \((\d+) tournois terminés\)$/, "History ($1 finished tournaments)"],
  [/^(\d+) joueurs recensés$/, "$1 players recorded"],
  [/^(\d+) entrée\(s\)$/, "$1 entry(ies)"],
  [/^(\d+) entrées supprimées$/, "$1 entries deleted"],
  [/^Retour à (.+)$/, "Back to $1"],
  [/^Rouvrir le match #(.+) \? Le résultat est annulé et les matchs suivants seront vidés\.$/, "Reopen match #$1? The result is cancelled and the following matches will be cleared."],
  [/^(\d+)\/(\d+) inscrits · (\d+) payés$/, "$1/$2 entered · $3 paid"],
  [/^(\d+) max · (\d+) inscrits · (\d+) payés · (\d+) tables$/, "$1 max · $2 entered · $3 paid · $4 tables"],
  [/^(\d+)\/(\d+) matchs joués$/, "$1/$2 matches played"],
  [/^(\d+) tables créées · (\d+) libres$/, "$1 tables created · $2 free"],
  [/^(\d+) joueurs$/, "$1 players"],
  [/^(\d+) inscrits$/, "$1 entered"],
  [/^(\d+) payés$/, "$1 paid"],
  [/^(\d+) libres$/, "$1 free"],
  [/^DKO (\d+) tours$/, "DKO $1 rounds"],
  [/^DKO (\d+) tours \+ tableau final$/, "DKO $1 rounds + final bracket"],
  [/^élim\. directe$/, "single elimination"],
  [/^Matchs modifiés: (\d+) · ajoutés: (\d+) · supprimés: (\d+)$/, "Matches changed: $1 · added: $2 · deleted: $3"],
  [/^Événement #(\d+) \((.+)\) du (.+)$/, "Event #$1 ($2) on $3"],
  [/^Restaurer le tournoi actif à l'état de cet événement \?\n\n/, "Restore the active tournament to this event's state?\n\n"],
  [/^Table (\d+) \(occupée\)$/, "Table $1 (busy)"],
  [/^⏳ Tirage au sort non effectué : structure du tableau à vide, les places j1 à j(\d+) seront prises par les joueurs après le tirage$/, "⏳ Draw not done yet: empty bracket structure, slots j1 to j$1 will be filled by the players after the draw"],
  [/^Simulation terminée : (\d+) matchs joués\. (.+)$/, "Simulation done: $1 matches played. $2"],
  [/^(.+) (\d\d?)\/(\d\d?)\/(\d{4}) à (\d\d?)h(\d\d)$/, "$1 $2/$3/$4 at $5:$6"],
  [/^(\d\d?)\/(\d\d?)\/(\d{4}) à (\d\d?)h(\d\d)$/, "$1/$2/$3 at $4:$5"],
  [/^Un compte existe déjà avec le pseudo « (.+) »\.\n\nInscrire quand même ce joueur \? Il sera rattaché à ce compte \(notifications « à toi de jouer » et amis incluses\)\.\n\nSinon, le titulaire peut s'inscrire lui-même depuis son compte\.$/, "An account already exists with the username \"$1\".\n\nRegister this player anyway? They will be linked to this account (\"your turn to play\" notifications and friends included).\n\nOtherwise, the owner can register themselves from their own account."],
  [/^Retirer (.+) de tes amis \?$/, "Remove $1 from your friends?"],
  [/^📨 Notif de test envoyée \((\d+) appareil\(s\)\) !$/, "📨 Test notification sent ($1 device(s))!"],
  [/^🎱 Matchs \((\d+)\)$/, "🎱 Matches ($1)"],
  [/^⏱ début (.+)$/, "⏱ start $1"],
  [/^⏱ durée moyenne (.+)$/, "⏱ average duration $1"],
  [/^(\d{2}\/\d{2}\/\d{4}) à (\d{2})h(\d{2})$/, "$1 at $2:$3"],
  [/^(\S+) (\d{2}\/\d{2}\/\d{4}) à (\d{2})h(\d{2})$/, "$1 $2 at $3:$4"],
];
function t(s) {
  if (LANG !== 'en' || typeof s !== 'string' || !s) return s;
  if (I18N[s]) return I18N[s];
  const tr = s.trim();
  if (tr && tr !== s && I18N[tr]) return s.replace(tr, I18N[tr]);
  for (const [re, rep] of I18N_DYN) if (re.test(s)) return s.replace(re, rep);
  return s;
}
// traduit le HTML statique au chargement : phrases completes, fragments texte, attributs
function traduireDomStatique(root) {
  if (LANG !== 'en' || !root) return;
  const INLINE_OK = { B: 1, I: 1, EM: 1, STRONG: 1, SPAN: 1, SMALL: 1, CODE: 1, ABBR: 1, U: 1, BR: 1, SUB: 1, SUP: 1 };
  for (const e of root.querySelectorAll('p,li,h1,h2,h3,h4,th,td,label,dt,dd,legend,summary,figcaption')) {
    if (e.querySelector('a,button,input,select,textarea,img,svg,script')) continue;
    if (![...e.children].every(c => INLINE_OK[c.tagName])) continue;
    const cle = (e.textContent || '').trim();
    if (cle && I18N[cle]) e.textContent = I18N[cle];
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const noeuds = [];
  while (walker.nextNode()) noeuds.push(walker.currentNode);
  for (const n of noeuds) {
    const brut = n.nodeValue;
    const cle = brut.trim();
    if (cle && I18N[cle]) n.nodeValue = brut.replace(cle, () => I18N[cle]);
  }
  for (const e of root.querySelectorAll('[placeholder],[title],[aria-label],[alt]')) {
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
      const v = e.getAttribute ? e.getAttribute(a) : null;
      if (v) { const cle = v.trim(); if (cle && I18N[cle]) e.setAttribute(a, v.replace(cle, I18N[cle])); }
    }
  }
}
traduireDomStatique(document.body);
// alert/confirm natifs passes par t() (messages d'erreur client, confirmations)
if (LANG === 'en') {
  const _confirm = window.confirm, _alert = window.alert;
  window.confirm = (m) => _confirm(typeof m === 'string' ? t(m) : m);
  window.alert = (m) => _alert(typeof m === 'string' ? t(m) : m);
}
if (LANG === 'en' && I18N[document.title.trim()]) document.title = I18N[document.title.trim()];

// Thème clair/sombre : préférence locale (ebpc_theme), appliquée tôt dans <head> par un petit script inline anti-flash.
// La page TV reste toujours sombre (pas de script anti-flash là-bas).
function themeActuel() { try { return localStorage.getItem('ebpc_theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } }
function appliquerTheme(t) { try { if (t === 'light') document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme; } catch {} }
function basculerTheme() { const t = themeActuel() === 'light' ? 'dark' : 'light'; try { localStorage.setItem('ebpc_theme', t); } catch {} appliquerTheme(t); return t; }

let compteCourant = null; // mémo du compte connecté (le broadcast SSE ne le renvoie pas)
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', 'X-Lang': LANG, ...clubHeaders(), ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  if (data && typeof data.compte !== 'undefined') compteCourant = data.compte;
  return data;
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) e.setAttribute(k, (k === 'placeholder' || k === 'title' || k === 'aria-label' || k === 'alt') && typeof v === 'string' ? t(v) : (v === true ? '' : v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) { for (const cc of c) e.append(cc.nodeType ? cc : document.createTextNode(t(cc))); continue; }
    e.append(c.nodeType ? c : document.createTextNode(typeof c === 'string' ? t(c) : c));
  }
  return e;
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email || '—';
  const [local, domain] = email.split('@');
  const m = local.length <= 2 ? local[0] + '•' : local.slice(0, 2) + '•'.repeat(Math.min(local.length - 2, 6));
  return m + '@' + domain;
}

function badgeEtat(etat) {
  const labels = { prevu: 'Prévu', pret: 'Prêt', en_cours: 'En cours', termine: 'Terminé', forfait: 'Forfait' };
  return el('span', { class: `badge ${etat}` }, labels[etat] || etat);
}

function fmtDuree(s) {
  if (s == null) return null;
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m} min ${String(sec).padStart(2, '0')} s` : `${sec} s`;
}

// choix de langue persistant (ebpc_lang) + rechargement immediat ; appele par le selecteur FR/EN du bandeau
// persiste la langue cote client (localStorage) ET cote serveur (compte.lang) pour les notifications push ;
// attend la reponse du POST avant le reload, sinon la requete est annulee par le unload de la page
async function choisirLangue(l) {
  try { localStorage.setItem('ebpc_lang', l); } catch {}
  try { await api('/api/compte/preferences', { method: 'POST', body: JSON.stringify({ lang: l }) }); } catch {} // silencieux si non connecte (401)
  location.reload();
}

// menu deroulant reutilisable (burger navigation, burger compte, selecteur de langue) : dropdown + scrim dans le body,
// contenu reconstruit a chaque ouverture (entrees dynamiques), fermeture au clic exterieur / scrim / resize
function menuDeroulant(btn, remplir) {
  const drop = el('div', { class: 'nav-dropdown', role: 'menu' });
  const scrim = el('div', { class: 'nav-scrim' });
  document.body.appendChild(drop);
  document.body.appendChild(scrim);
  const fermer = () => { drop.classList.remove('open'); scrim.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (drop.classList.contains('open')) return fermer();
    drop.innerHTML = '';
    remplir(drop);
    // positionner le dropdown sous le bouton (fixed) -> PAS de scrollY/scrollX (sinon le menu part hors ecran quand on est scrolle)
    const r = btn.getBoundingClientRect();
    drop.style.top = (r.bottom + 6) + 'px';
    const w = Math.min(260, window.innerWidth - 16);
    drop.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    // si le menu depasserait en bas du viewport, le limiter en hauteur (scroll interne)
    const maxH = window.innerHeight - r.bottom - 14;
    drop.style.maxHeight = Math.max(120, maxH) + 'px';
    drop.classList.add('open'); scrim.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
  });
  scrim.addEventListener('click', fermer);
  scrim.addEventListener('touchstart', fermer, { passive: true });
  drop.addEventListener('click', (e) => { if (e.target.closest('a')) fermer(); });
  document.addEventListener('click', (e) => { if (!btn.contains(e.target) && !drop.contains(e.target)) fermer(); });
  document.addEventListener('touchstart', (e) => { if (!btn.contains(e.target) && !drop.contains(e.target) && !scrim.contains(e.target)) fermer(); }, { passive: true });
  window.addEventListener('resize', fermer);
}

function nav(active) {
  const links = [
    ['/', 'home', 'Accueil'],
    ['/tableau.html', 'tableau', 'Tableau'],
    ['/tv.html', 'tv', 'TV'],
    ['/suivi.html', 'joueur', 'Joueur'],
    ['/stats.html', 'stats', 'Stats'],
    ['/historique.html', 'hist', 'Historique'],
    ['/admin.html', 'admin', 'Table de marque'],
    ['/aide.html', 'aide', 'Aide'],
    ['/confidentialite.html', '', 'Confidentialitè'],
  ];
  const btn = el('button', { class: 'nav-burger', type: 'button', 'aria-label': 'Menu', 'aria-expanded': 'false' }, '☰ Menu');
  menuDeroulant(btn, (drop) => { for (const [href, key, label] of links) drop.append(el('a', { href, class: active === key ? 'active' : null, role: 'menuitem' }, label)); });
  const wrap = el('div', { class: 'nav-menu' }, btn);
  // selecteur de langue a l extremite droite du bandeau (pousse par margin-left auto en CSS),
  // liste deroulante FR/EN avec drapeaux (meme mecanique que les burgers),
  // bouton affichant la langue courante ; libelles en langue native (Francais / English)
  const btnLang = el('button', { class: 'nav-lang', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Langue · Language' }, LANG === 'en' ? '🇬🇧 EN' : '🇫🇷 FR');
  menuDeroulant(btnLang, (drop) => {
    drop.append(el('a', { href: '#', role: 'menuitem', class: LANG === 'fr' ? 'active' : null, onclick: (e) => { e.preventDefault(); if (LANG !== 'fr') choisirLangue('fr'); } }, '🇫🇷 Français'));
    drop.append(el('a', { href: '#', role: 'menuitem', class: LANG === 'en' ? 'active' : null, onclick: (e) => { e.preventDefault(); if (LANG !== 'en') choisirLangue('en'); } }, '🇬🇧 English'));
  });
  // burger compte : entrees dynamiques selon l etat de connexion et le role (admin ou joueur),
  // vers des pages dediees (parametres / amis / mes matchs) + fiche joueur ; admin : table de marque uniquement
  let compteNav = null, joueurIdNav = null;
  api('/api/compte/moi').then((r) => { compteNav = r && r.compte ? r.compte : null; joueurIdNav = r ? (r.joueur_id || null) : null; }).catch(() => {});
  const btnCompte = el('a', { href: '/compte.html', class: 'nav-login' + (active === 'compte' ? ' active' : ''), 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Mon compte' }, '👤 Compte');
  menuDeroulant(btnCompte, (drop) => {
    if (!compteNav) {
      drop.append(el('a', { href: '/compte.html#connexion', role: 'menuitem' }, '🔑 Connexion'));
      drop.append(el('a', { href: '/compte.html#creer', role: 'menuitem' }, '✨ Créer un compte'));
      drop.append(el('a', { href: '/parametres.html', role: 'menuitem' }, '⚙️ Paramètres'));
      return;
    }
    drop.append(el('a', { href: '/parametres.html', role: 'menuitem' }, '⚙️ Paramètres'));
    drop.append(el('a', { href: '/amis.html', role: 'menuitem' }, '👥 Amis'));
    drop.append(el('a', { href: '/mes-matchs.html', role: 'menuitem' }, '🎱 Mes matchs'));
    drop.append(el('a', { href: joueurIdNav ? '/joueur.html?id=' + joueurIdNav : '/compte.html', role: 'menuitem' }, '👤 Ma fiche joueur'));
    if (compteNav.role === 'admin') drop.append(el('a', { href: '/admin.html', role: 'menuitem' }, '🛠 Table de marque'));
    drop.append(el('a', { href: '#', role: 'menuitem', onclick: async (e) => { e.preventDefault(); if (!confirm('Se déconnecter ?')) return; try { await api('/api/compte/deconnexion', { method: 'POST' }); } catch {} location.href = '/'; } }, '🚪 Se déconnecter'));
  });
  return el('nav', {}, wrap, btnCompte, btnLang);
}

function codeMatch(m) {
  return `${String(m.bracket || '').toLowerCase()}${m.tour}-${String(m.position).padStart(3, '0')}`;
}

// libellés d'origine des slots manquants (ex: "gagnant wb1-001"), comme dans le bracket
function feederLabels(t, m) {
  // tableau virtuel (avant tirage) : les slots du tour 1 WB affichent j1, j2, ... jN
  if (m.virtuel && m.bracket === 'WB' && m.tour === 1) {
    return { lbl1: `j${2 * m.position - 1}`, lbl2: `j${2 * m.position}` };
  }
  const feeders = (t && t.matchs ? t.matchs : []).filter(x => x.suivant_id === m.id || x.perdant_id === m.id);
  const srcOf = (slot) => {
    const f = feeders.find(x => x.suivant_id === m.id && x.suivant_slot === slot) || feeders.find(x => x.perdant_id === m.id && x.perdant_slot === slot);
    return f ? (f.suivant_id === m.id ? 'gagnant' : 'perdant') + ' ' + codeMatch(f) : null;
  };
  return { lbl1: m.joueur1 ? null : srcOf(1), lbl2: m.joueur2 ? null : srcOf(2) };
}

function matchCard(m, opts = {}) {
  const j1g = m.gagnant_id && m.joueur1 && m.gagnant_id === m.joueur1.id;
  const j2g = m.gagnant_id && m.joueur2 && m.gagnant_id === m.joueur2.id;
  let lbl1 = opts.lbl1, lbl2 = opts.lbl2;
  if (opts.t && (lbl1 === undefined || lbl2 === undefined)) {
    const fl = feederLabels(opts.t, m);
    if (lbl1 === undefined) lbl1 = fl.lbl1;
    if (lbl2 === undefined) lbl2 = fl.lbl2;
  }
  const card = el('div', { class: 'match-card' + (m.etat === 'prevu' ? ' attente' : '') + (m.etat === 'en_cours' ? ' live' : '') + ((m.etat === 'termine' || m.etat === 'forfait') ? ' done' : '') + (opts.hit ? ' hit' : ''), 'data-match-id': m.id },
    el('div', { class: 'joueurs' },
      el('span', { class: 'p p1' + (j1g ? ' gagnant' : '') + (!m.joueur1 ? (lbl1 ? ' attente-j' : ' blanc') : '') }, m.joueur1 ? m.joueur1.pseudo : (lbl1 || 'blanc')),
      el('span', { class: 'score' }, `${m.score1} - ${m.score2}`),
      el('span', { class: 'p p2' + (j2g ? ' gagnant' : '') + (!m.joueur2 ? (lbl2 ? ' attente-j' : ' blanc') : '') }, m.joueur2 ? m.joueur2.pseudo : (lbl2 || 'blanc'))),
    el('div', { class: 'meta' },
      el('span', { class: 'code-match' }, codeMatch(m)),
      badgeEtat(m.etat),
      m.etat === 'en_cours' ? el('span', { class: 'live-dot' }, '● LIVE') : null,
      m.table != null ? el('span', { class: 'table-badge' }, `🎱 Table ${m.table}`) : null,
      el('span', {}, `race to ${m.manches}`),
      m.started_at ? el('span', {}, `⏱ début ${fmtHeureSql(m.started_at)}`) : null,
      m.casseur ? el('span', { class: 'chip', title: 'Casse la manche en cours' }, `⚪ casse`) : null,
      m.duree_s != null ? el('span', {}, `⏳ ${fmtDuree(m.duree_s)}`) : null,
      opts.extra || null));
  // match virtuel (tableau à vide avant tirage) : pure affichage, pas de navigation
  if (!m.virtuel) {
    card.addEventListener('click', () => {
      if (opts.onClick) { opts.onClick(m); return; }
      if (typeof hasAdminPin === 'function' && hasAdminPin() && typeof openMatchEditor === 'function') {
        openMatchEditor(m, () => { if (opts.onAdminChange) opts.onAdminChange(); });
      } else {
        location.href = matchUrl(m);
      }
    });
    card.style.cursor = 'pointer';
    if (typeof hasAdminPin === 'function' && hasAdminPin()) card.title = 'Clic = éditer (admin)';
  }
  return card;
}

function grouperParRound(matchs, rounds) {
  const byKey = {};
  for (const m of matchs) {
    const k = `${m.bracket}${m.tour}`.toLowerCase(); // clés de rounds en minuscules (wb1, lb2, f1...)
    (byKey[k] = byKey[k] || []).push(m);
  }
  return rounds
    .map(r => ({ round: r, matchs: (byKey[r.key] || []).sort((a, b) => a.position - b.position) }))
    .filter(g => g.matchs.length > 0);
}

function connecterSSE(onUpdate) {
  const refetch = async () => {
    try {
      const s = await api('/api/etat', { pin: null }); // payload SSE léger -> re-fetch état complet
      // le broadcast global ne contient pas le compte de la session -> on le réinjecte
      if (s && !s.compte && compteCourant) s.compte = compteCourant;
      onUpdate(s);
    } catch {}
  };
  const src = new EventSource('/api/events');
  src.addEventListener('update', refetch);
  // reconnexion du flux (coupure réseau, sortie de veille): les événements émis pendant
  // la coupure ne sont pas rejoués -> on re-synchronise dès que le flux est réouvert
  src.addEventListener('open', refetch);
  // retour sur la page (onglet ravivé, écran déverrouillé, PWA sortie de l'arrière-plan):
  // les navigateurs suspendent EventSource en arrière-plan -> re-sync immédiate à l'affichage
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refetch(); });
  src.onerror = () => {};
  return src;
}

function confirmer(msg) { return window.confirm(msg); }

/* ===== Bracket visuel partagé (tableau.html actif + tournoi.html archivé) ===== */
let bracketTab = (typeof localStorage !== 'undefined' && localStorage.getItem('ebpc_bracket_tab')) || 'tout';
let bracketLinksOnlyTab = null; // onglet autorisé pour les liens (renseigné par renderBracket, anti lignes parasites)

function feederLabelBracket(t, src, kind) {
  const nom = src.joueur1 && src.joueur2 ? `${src.joueur1.pseudo}–${src.joueur2.pseudo}` : (src.joueur1 || src.joueur2 || {}).pseudo || '…';
  return `${kind === 'perdant' ? 'perdant' : 'vainqueur'} #${src.position} (${nom})`;
}

function renderBracket(container, t, opts = {}) {
  bracketLinksOnlyTab = opts.linksOnlyTab || null; // garde-fou global appliqué dans drawBracketLinks
  const rounds = t.rounds;
  const byKey = {};
  for (const m of t.matchs) {
    const k = m.bracket + m.tour;
    (byKey[k] = byKey[k] || []).push(m);
  }
  for (const k in byKey) byKey[k].sort((a, b) => a.position - b.position);
  const singleTab = bracketTab !== 'tout';
  // Loser bracket en miroir : le tour 1 est collé au WB (lecture du LB de droite à gauche)
  let ordered = [
    ...rounds.filter(r => r.bracket === 'LB').reverse(),
    ...rounds.filter(r => r.bracket === 'WB'),
    ...rounds.filter(r => r.bracket === 'F'),
  ];
  if (singleTab) ordered = rounds.filter(r => r.bracket === bracketTab); // onglet seul : tours dans l'ordre naturel
  let groups = ordered.map(r => ({ round: r, matchs: byKey[r.bracket + r.tour] || [] })).filter(g => g.matchs.length > 0);
  if (singleTab) groups = groups.filter(g => g.round.bracket === bracketTab);

  const hasLB = rounds.some(r => r.bracket === 'LB');
  const tabs = [['tout', 'Tout'], ['WB', 'WB'], ...(hasLB ? [['LB', 'LB']] : []), ['F', 'Phase finale']];
  const tabBar = el('div', { class: 'view-switch', style: 'margin-bottom:10px' },
    ...tabs.map(([k2, label]) => el('button', {
      class: bracketTab === k2 ? '' : 'secondary',
      onclick: () => { bracketTab = k2; try { localStorage.setItem('ebpc_bracket_tab', k2); } catch {} if (typeof render === 'function') render(); },
    }, label)));

  const wrap = el('div', { class: 'bracket-scroll' });
  const bracket = el('div', { class: 'bracket', id: 'bracket' });
  // VRAI élément SVG (createElementNS) : el('svg') créerait un élément HTML inconnu, les <path> ne rendraient jamais
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'bracket-svg');
  bracket.append(svg);
  const NODE_H = 84; // hauteur d'un nœud de match (carte resserrée)
  const GAP = 10;
  const SLOT_H = NODE_H + GAP; // 118 : hauteur d'un slot de base
  // Onglet "tout" : escalier global (WB resserré au centre, LB en miroir, F compact).
  // Onglet seul (WB/LB/F) : escalier compact par bracket, tours dans l'ordre naturel.
  const levelOf = (r) => singleTab ? r.tour - 1
    : r.bracket === 'WB' ? r.tour - 1
    : r.bracket === 'LB' ? r.tour
    : r.tour - 1;
  let prevNb = 0, prevStep = 1;
  for (const g of groups) {
    const colCls = g.round.bracket === 'LB' ? 'lb' : g.round.bracket === 'F' ? 'finale' : 'wb';
    const col = el('div', { class: `bracket-col ${colCls}`, id: 'col-' + g.round.bracket + g.round.tour }, el('h3', {}, g.round.label + ' · race to ' + g.round.manches));
    // onglet seul : pas d'escalier imposé, le pas suit les vrais effectifs (ex. LB1=4, LB2=4 -> pas identique, pas d'escalier)
    const step = singleTab
      ? (prevNb ? Math.max(1, Math.round(prevStep * prevNb / g.matchs.length)) : 1)
      : Math.pow(2, levelOf(g.round));
    prevNb = g.matchs.length; prevStep = step;
    const lastTop = 40 + (g.matchs.length - 1) * step * SLOT_H + (step - 1) * SLOT_H / 2;
    col.style.height = (lastTop + NODE_H + 24) + 'px';
    col.style.justifyContent = 'flex-start';
    for (const m of g.matchs) {
      // escalier : le match #p est centré verticalement entre ses 2 parents (#2p-1 et #2p du niveau -1)
      const top = 40 + (m.position - 1) * step * SLOT_H + (step - 1) * SLOT_H / 2;
      const win1 = m.gagnant_id && m.joueur1 && m.gagnant_id === m.joueur1.id;
      const win2 = m.gagnant_id && m.joueur2 && m.gagnant_id === m.joueur2.id;
      const enAttente = m.etat === 'prevu';
      // pour un match en attente, la place du joueur manquant affiche son match d'origine
      const feeders = t.matchs.filter(x => x.suivant_id === m.id || x.perdant_id === m.id);
      const srcOf = (slot) => {
        const f = feeders.find(x => x.suivant_id === m.id && x.suivant_slot === slot) || feeders.find(x => x.perdant_id === m.id && x.perdant_slot === slot);
        if (!f) return 'blanc';
        const kind = f.suivant_id === m.id ? 'gagnant' : 'perdant';
        return kind + ' ' + codeMatch(f); // max 15 caractères (ex: "gagnant wb1-001")
      };
      // tableau virtuel (avant tirage) : slots du tour 1 WB = j1, j2, ... jN
      const virtuelWB1 = m.virtuel && m.bracket === 'WB' && m.tour === 1;
      const lbl1 = m.joueur1 ? m.joueur1.pseudo : (virtuelWB1 ? `j${2 * m.position - 1}` : srcOf(1));
      const lbl2 = m.joueur2 ? m.joueur2.pseudo : (virtuelWB1 ? `j${2 * m.position}` : srcOf(2));
      const node = el('div', {
        class: 'node' + (m.etat === 'en_cours' ? ' live' : '') + ((m.etat === 'termine' || m.etat === 'forfait') ? ' done' : '') + (enAttente ? ' attente' : ''),
        'data-id': m.id,
      },
        el('div', { class: 'nj' + (win1 ? ' win' : '') + (!m.joueur1 ? (lbl1 === 'blanc' ? ' blanc-j' : ' attente-j') : '') },
          el('span', {}, lbl1), el('span', { class: 'sc' }, String(m.score1))),
        el('div', { class: 'nj' + (win2 ? ' win' : '') + (!m.joueur2 ? (lbl2 === 'blanc' ? ' blanc-j' : ' attente-j') : '') },
          el('span', {}, lbl2), el('span', { class: 'sc' }, String(m.score2))),
        el('div', { class: 'meta' },
          el('span', { class: 'code-match' }, codeMatch(m)),
          enAttente ? el('span', { class: 'attente-tag' }, '⏳ match attendu') : null,
          m.etat === 'en_cours' ? el('span', { class: 'live-dot' }, '● LIVE') : null,
          (m.etat === 'termine' || m.etat === 'forfait') ? badgeEtat(m.etat) : null,
          m.table != null ? el('span', { class: 'table-badge' }, '🎱 Table ' + m.table) : null,
          m.duree_s != null ? el('span', {}, '⏳ ' + fmtDuree(m.duree_s)) : null));
      if (!opts.readonly && !m.virtuel) {
        node.addEventListener('click', () => {
          if (typeof hasAdminPin === 'function' && hasAdminPin() && typeof openMatchEditor === 'function') {
            openMatchEditor(m, () => { if (opts.onAdminChange) opts.onAdminChange(); });
          } else {
            location.href = matchUrl(m);
          }
        });
        node.style.cursor = 'pointer';
        if (typeof hasAdminPin === 'function' && hasAdminPin()) node.title = 'Clic = éditer (admin)';
      }
      node.style.position = 'absolute';
      node.style.top = top + 'px';
      node.style.left = '0';
      node.style.right = '0';
      col.append(node);
    }
    bracket.append(col);
  }
  wrap.append(bracket);
  container.append(tabBar);
  container.append(wrap);
  if (opts.drawLinks !== false) {
    // redraws robustes (iOS charge lentement, layout tardif)
    // liens uniquement sur l'onglet demandé (ex. 'F') : ailleurs, on ne dessine rien
    const redraw = () => {
      if (opts.linksOnlyTab && bracketTab !== opts.linksOnlyTab) { svg.innerHTML = ''; return; }
      drawBracketLinks(t);
    };
    requestAnimationFrame(redraw);
    [60, 300, 800, 1500].forEach(ms => setTimeout(redraw, ms));
    window.addEventListener('load', redraw, { once: true });
    const sc = container.querySelector('.bracket-scroll') || container;
    sc.addEventListener('scroll', redraw, { passive: true });
  }
}

function drawBracketLinks(t) {
  const bracket = document.getElementById('bracket');
  const svg = document.getElementById('bracket-svg');
  if (!bracket || !svg || !t) return;
  // appels directs (resize, etc.) : jamais de liens hors de l onglet autorisé par renderBracket
  if (bracketLinksOnlyTab && bracketTab !== bracketLinksOnlyTab) { svg.innerHTML = ''; return; }
  const rect = bracket.getBoundingClientRect();
  // Pas de viewBox : 1 unité SVG = 1 px CSS, pour que les liens collent exactement aux nœuds
  svg.setAttribute('width', Math.ceil(rect.width));
  svg.setAttribute('height', Math.ceil(rect.height));
  svg.removeAttribute('viewBox');
  svg.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  // flèche pour les bouts de lien (onglets) : context-stroke = couleur du trait
  const defs = document.createElementNS(ns, 'defs');
  defs.innerHTML = '<marker id="pcb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker>';
  svg.append(defs);
  const drawPath = (d, cls, marker) => {
    // trait fin coloré; halo (gros trait translucide) uniquement en live, sinon ça fait des "pâtés" quand les liens convergent
    for (const haloMode of (/\blive\b/.test(cls) ? [true, false] : [false])) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', haloMode ? (cls ? cls + ' halo' : 'halo') : (cls || ''));
      if (marker) p.setAttribute(marker, 'url(#pcb-arrow)');
      svg.append(p);
    }
  };
  for (const m of t.matchs) {
    for (const targetId of [m.suivant_id, m.perdant_id]) {
      if (!targetId) continue;
      const a = bracket.querySelector(`[data-id="${m.id}"]`);
      const b = bracket.querySelector(`[data-id="${targetId}"]`);
      const cible = t.matchs.find(x => x.id === targetId);
      let cls = cible ? 'to-' + cible.bracket.toLowerCase() : '';
      if (m.etat === 'en_cours') cls += ' live';
      else if (m.etat === 'termine' || m.etat === 'forfait') cls += ' done';
      else if (m.etat === 'prevu') cls += ' attente';
      if (a && b) {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const x1 = ra.right - rect.left, y1 = ra.top + ra.height / 2 - rect.top;
        const x2 = rb.left - rect.left, y2 = rb.top + rb.height / 2 - rect.top;
        const mx = (x1 + x2) / 2;
        // lien en coude (orthogonal) : plus lisible qu'une courbe pour relier les cases
        drawPath(`M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`, cls);
      } else if (a) {
        // cible dans un onglet masqué : bout de lien vers la droite, avec flèche
        const ra = a.getBoundingClientRect();
        const x1 = ra.right - rect.left, y1 = ra.top + ra.height / 2 - rect.top;
        drawPath(`M ${x1} ${y1} H ${x1 + 46}`, cls + ' stub', 'marker-end');
      }
      // pas de bout de lien à gauche (source masquée) : sinon les flèches entrantes s'empilent en artefact sur le bord gauche
    }
  }
}

function renderStatsPanel(stats, titre = '📊 Statistiques', topN = 10) {
  if (!stats) return null;
  const r = stats.resume;
  const panels = [];
  panels.push(el('div', { class: 'panel' },
    el('h2', {}, titre),
    el('div', { class: 'row' },
      el('span', { class: 'chip' }, `${r.joues}/${r.total} matchs joués`),
      r.restants > 0 ? el('span', { class: 'chip' }, `${r.restants} restants`) : null,
      r.duree_moyenne_s != null ? el('span', { class: 'chip' }, `⏱ durée moyenne ${fmtDuree(r.duree_moyenne_s)}`) : null,
      r.plus_rapide ? el('span', { class: 'chip' }, `⚡ plus rapide ${fmtDuree(r.plus_rapide.d)} (${r.plus_rapide.gagnant})`) : null,
      r.plus_long ? el('span', { class: 'chip' }, `🐢 plus long ${fmtDuree(r.plus_long.d)} (${r.plus_long.gagnant})`) : null,
      r.dernier_gagnant ? el('span', { class: 'chip' }, `🔥 dernier vainqueur : ${r.dernier_gagnant}`) : null)));
  const top = stats.classement.filter(p => p.joues > 0).slice(0, topN);
  const all = stats.classement.filter(p => p.joues > 0); // pour le rang avec ex-aequo
  const rang = (p) => 1 + all.filter(q => (q.points || 0) > (p.points || 0)).length;
  if (top.length > 0) {
    panels.push(el('div', { class: 'panel' },
      el('h2', {}, '🏅 Classement'),
      el('table', { class: 'audit' },
        el('tr', {}, el('th', {}, '#'), el('th', {}, 'Joueur'), el('th', {}, 'Joués'), el('th', {}, 'Gagnés'), el('th', {}, 'Perdus'), el('th', {}, '%'), el('th', {}, '⭐ Pts'), el('th', {}, 'Série')),
        ...top.map((p) => el('tr', {},
          el('td', {}, String(rang(p))),
          el('td', { style: 'font-weight:700' }, p.pseudo),
          el('td', {}, String(p.joues)), el('td', {}, String(p.gagnes)), el('td', {}, String(p.perdus)),
          el('td', {}, `${p.pct} %`),
          el('td', { style: 'font-weight:800;color:var(--gold)' }, String(p.points || 0)),
          el('td', {}, p.serie > 0 ? `🔥 ${p.serie}V` : p.serie < 0 ? `${-p.serie}D` : '—'))))));
  }
  return panels;
}

// Convertit une date SQL stockée en UTC ("YYYY-MM-DD HH:MM:SS") en heure locale navigateur
function dateSqlUtc(utc) { return new Date(String(utc).replace(' ', 'T') + 'Z'); }
function fmtHeureSql(utc) {
  if (!utc) return '';
  const d = dateSqlUtc(utc);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}h${p(d.getMinutes())}`;
}
function fmtDateHeureSql(utc) {
  if (!utc) return '';
  const d = dateSqlUtc(utc);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}h${p(d.getMinutes())}`;
}

function fmtDateHeure(dh) {
  if (!dh) return '';
  const d = new Date(dh.replace(' ', 'T')); // heure telle que saisie, AUCUN décalage horaire
  const p = n => String(n).padStart(2, '0');
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  return `${t(jours[d.getDay()])} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}h${p(d.getMinutes())}`;
}

/* ===== Édition admin inline d'un match (depuis le tableau quand le PIN est mémorisé) ===== */
// URL de la card match en propageant la page courante (retour contextuel depuis match.html)
function matchUrl(m, extra = '') {
  const ret = encodeURIComponent(location.pathname + location.search);
  return `/match.html?id=${m.id}${extra ? '&' + extra : ''}&retour=${ret}`;
}

function hasAdminPin() {
  return !!(localStorage.getItem('ebpc_admin_pin') || '');
}

async function adminCall(path, opts = {}) {
  const pin = localStorage.getItem('ebpc_admin_pin') || '';
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(typeof LANG !== 'undefined' && LANG === 'en' ? { 'X-Lang': 'en' } : {}), ...(pin ? { 'X-Admin-Pin': pin } : {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { localStorage.removeItem('ebpc_admin_pin'); throw new Error('PIN invalide — reconnecte-toi dans l\'admin'); }
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function openMatchEditor(m, onDone) {
  closeMatchEditor();
  const overlay = el('div', { id: 'match-editor', style: 'position:fixed;inset:0;z-index:100;background:rgba(5,5,8,.8);display:flex;align-items:center;justify-content:center;padding:16px' });
  const j1 = m.joueur1 ? m.joueur1.pseudo : '—';
  const j2 = m.joueur2 ? m.joueur2.pseudo : '—';
  const s1 = el('input', { type: 'number', min: 0, max: m.manches, value: m.score1, style: 'width:70px;text-align:center;font-size:22px;font-weight:800' });
  const s2 = el('input', { type: 'number', min: 0, max: m.manches, value: m.score2, style: 'width:70px;text-align:center;font-size:22px;font-weight:800' });
  const man = el('select', { style: 'width:auto' }, [2, 3, 5, 7].map(n => el('option', { value: n, ...(n === m.manches ? { selected: '' } : {}) }, `race to ${n}`)));
  const motif = el('input', { placeholder: 'Motif (optionnel)', maxlength: 80, style: 'width:100%' });
  const msg = el('div', { class: 'msg err', style: 'display:none' });

  const btn = (label, cls, fn) => el('button', { class: cls, onclick: async () => {
    msg.style.display = 'none';
    try { await fn(); closeMatchEditor(); if (onDone) onDone(); }
    catch (e) { msg.textContent = e.message; msg.style.display = 'block'; }
  } }, label);

  const actions = [];
  if (m.etat === 'pret' || m.etat === 'prevu') {
    actions.push(btn('▶ Lancer', '', () => adminCall(`/api/admin/match/${m.id}/lancer`, { method: 'POST', body: '{}' })));
  }
  actions.push(btn('💾 Enregistrer le score', '', () => adminCall(`/api/admin/match/${m.id}/correction`, {
    method: 'POST', body: JSON.stringify({ score1: Number(s1.value), score2: Number(s2.value), manches: Number(man.value), motif: motif.value })
  })));
  if (m.etat === 'termine' || m.etat === 'forfait') {
    actions.push(btn('🔓 Rouvrir', 'secondary', () => adminCall(`/api/admin/match/${m.id}/rouvrir`, { method: 'POST', body: '{}' })));
  } else if (m.joueur1 && m.joueur2) {
    actions.push(btn(`${j1} forfait`, 'danger', () => adminCall(`/api/admin/match/${m.id}/forfait`, { method: 'POST', body: JSON.stringify({ joueur_id: m.joueur1.id }) })));
    actions.push(btn(`${j2} forfait`, 'danger', () => adminCall(`/api/admin/match/${m.id}/forfait`, { method: 'POST', body: JSON.stringify({ joueur_id: m.joueur2.id }) })));
  }

  overlay.append(el('div', { class: 'panel', style: 'max-width:460px;width:100%' },
    el('h2', {}, `✏️ Match #${m.position}`),
    el('p', { class: 'muted small' }, `${j1}  vs  ${j2} · ${badgeEtat(m.etat)}${m.table != null ? ' · 🎱 Table ' + m.table : ''}`),
    el('div', { style: 'display:flex;align-items:center;justify-content:center;gap:12px;margin:14px 0' },
      el('div', { style: 'font-weight:800;font-size:18px;max-width:130px;overflow:hidden;text-overflow:ellipsis' }, j1), s1,
      el('span', { class: 'muted', style: 'font-weight:800' }, '–'), s2,
      el('div', { style: 'font-weight:800;font-size:18px;max-width:130px;overflow:hidden;text-overflow:ellipsis' }, j2)),
    el('div', { class: 'row', style: 'justify-content:center' }, man, motif),
    msg,
    el('div', { class: 'actions', style: 'display:flex;flex-direction:column;gap:8px;margin-top:12px' }, ...actions),
    el('div', { style: 'margin-top:10px' }, el('button', { class: 'secondary', style: 'width:100%', onclick: closeMatchEditor }, 'Fermer'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMatchEditor(); });
  document.body.append(overlay);
}

function closeMatchEditor() {
  const e = document.getElementById('match-editor');
  if (e) e.remove();
}

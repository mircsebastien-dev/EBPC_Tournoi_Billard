// i18n serveur : traduction fr -> en des messages d'erreur / confirmation renvoyés par l'API.
// Active uniquement si le client envoie le header "X-Lang: en" (defaut: fr, aucun changement).
// Repli gracieux : toute chaine absente du dictionnaire est renvoyee telle quelle (en francais).

// messages statiques (cles = textes exacts cotes serveur, apostrophes reels)
const STATIQUES = {
  "Aucun compte avec ce pseudo": "No account with this username",
  "Aucun snapshot pour cet événement": "No snapshot for this event",
  "Aucun tournoi actif": "No active tournament",
  "Aucun tournoi ouvert aux inscriptions (le précédent doit être terminé et le prochain créé)": "No tournament open for registration (the previous one must be finished and the next one created)",
  "Aucun tournoi ouvert aux inscriptions — attendez que le tournoi en cours soit terminé et que le prochain soit créé": "No tournament open for registration — wait for the current tournament to finish and the next one to be created",
  "Aucun tournoi": "No tournament",
  "Aucune préférence reconnue": "Unrecognized preference",
  "Body trop volumineux (max 256ko)": "Body too large (max 256 KB)",
  "Ce pseudo appartient à un compte : ajoute-le comme ami normal": "This username belongs to an account: add it as a regular friend",
  "Ce pseudo appartient à un compte : connecte-toi pour t'inscrire, ou choisis un autre pseudo": "This username belongs to an account: log in to enter, or pick another username",
  "Cet email est déjà utilisé par un autre compte": "This email is already used by another account",
  "Code administrateur requis pour confirmer cette suppression": "Admin code required to confirm this deletion",
  "Compte connecté : inscris-toi avec le bouton « M'inscrire » de ton compte": "Account logged in: register with the \"Enter\" button on your account",
  "Compte introuvable": "Account not found",
  "Connecte-toi à ton compte pour te désinscrire": "Log in to your account to unregister",
  "Crée un compte ou connecte-toi d'abord (pseudo + email + mot de passe)": "Create an account or log in first (username + email + password)",
  "Déjà dans tes amis": "Already in your friends",
  "Déjà suivi": "Already followed",
  "Email invalide": "Invalid email",
  "Format invalide": "Invalid format",
  "Inscriptions closes : le tournoi en cours n'est pas terminé": "Registration closed: the current tournament is not finished",
  "Inscriptions closes": "Registration closed",
  "JSON invalide": "Invalid JSON",
  "Joueur introuvable": "Player not found",
  "joueur introuvable": "player not found",
  "Match introuvable": "Match not found",
  "Le tournoi doit être en cours (faites le tirage d'abord)": "The tournament must be running (do the draw first)",
  "Les inscriptions ne sont pas ouvertes (tirage déjà effectué)": "Registration is not open (draw already done)",
  "Les inscriptions sont fermées (tournoi lancé)": "Registration is closed (tournament started)",
  "Lien invalide ou expiré (valable 1h)": "Invalid or expired link (valid for 1h)",
  "Lien invalide": "Invalid link",
  "Mot de passe trop court (min 4 caractères)": "Password too short (min 4 characters)",
  "Non connecté": "Not logged in",
  "PIN administrateur invalide (ou connectez-vous avec un compte admin)": "Invalid admin PIN (or log in with an admin account)",
  "Pseudo déjà pris dans ce tournoi": "Username already taken in this tournament",
  "Pseudo déjà pris": "Username already taken",
  "Pseudo invalide (2-24 caractères : lettres, chiffres, _ -)": "Invalid username (2-24 characters: letters, digits, _ -)",
  "Pseudo ou email déjà utilisé": "Username or email already used",
  "Pseudo ou mot de passe incorrect": "Incorrect username or password",
  "Pseudo requis": "Username required",
  "QR invalide": "Invalid QR",
  "Route inconnue": "Unknown route",
  "Règle invalide": "Invalid rule",
  "Seul le tournoi actif peut être comparé (ce snapshot concerne un autre tournoi)": "Only the active tournament can be compared (this snapshot is from another tournament)",
  "Seul le tournoi actif peut être restauré (ce snapshot concerne un autre tournoi)": "Only the active tournament can be restored (this snapshot is from another tournament)",
  "Si un compte existe pour cet email, un lien de réinitialisation vient d'être envoyé.": "If an account exists for this email, a reset link has just been sent.",
  "Tableau déjà plein": "Bracket already full",
  "Taille invalide (max)": "Invalid size (max)",
  "Tirage déjà effectué": "Draw already done",
  "Tournoi complet": "Tournament full",
  "Tournoi déjà terminé": "Tournament already finished",
  "Tournoi introuvable (ou aucun tournoi actif)": "Tournament not found (or no active tournament)",
  "Tournoi introuvable": "Tournament not found",
  "Tournoi lancé": "Tournament started",
  "Tournoi terminé, config verrouillée": "Tournament finished, configuration locked",
  "Trop de demandes, réessaie plus tard": "Too many requests, try again later",
  "Trop de tentatives, réessaie dans 10 min": "Too many attempts, try again in 10 minutes",
  "Tu n'es pas inscrit à ce tournoi": "You are not registered in this tournament",
  "Tu ne peux pas t'ajouter toi-même": "You cannot add yourself",
  "Tu ne peux pas te suivre toi-même": "You cannot follow yourself",
  "Valeur invalide": "Invalid value",
  "distances requis": "distances required",
  "joueur_id requis (à qui retirer la manche)": "joueur_id required (whose frame to remove)",
  "joueur_id requis (doit être l'un des 2 joueurs du match)": "joueur_id required (must be one of the 2 players of the match)",
  "joueur_id requis (gagnant de la manche)": "joueur_id required (frame winner)",
  "joueur_id requis": "joueur_id required",
  "nom requis": "name required",
  "role invalide ('admin' ou 'user')": "invalid role ('admin' or 'user')",
  "slug invalide (2-30 car. a-z 0-9 -)": "invalid slug (2-30 chars a-z 0-9 -)"
};

// messages dynamiques: regex sur le texte fr, remplacement par le template en
const DYNAMIQUES = [
  [/^Au moins 2 joueurs payés requis \(actuellement (\d+)\)$/, "At least 2 paid players required (currently $1)"],
  [/^Club inconnu « (.+) »$/, 'Unknown club "$1"'],
  [/^Distance invalide pour (.+)$/, "Invalid distance for $1"],
  [/^Déjà inscrit en tant que (.+)$/, "Already registered as $1"],
  [/^Impossible de descendre à (\d+) table\(s\) : (\d+) table\(s\) occupée\(s\) par un match en cours$/, "Cannot go down to $1 table(s): $2 table(s) occupied by an ongoing match"],
  [/^Tableau complet \((\d+) joueurs max\)$/, "Bracket full ($1 players max)"],
  [/^Le pseudo « (.+) » appartient à un compte \(pseudo réservé\)$/, 'The username "$1" belongs to an account (reserved username)'],
  [/^Un compte existe déjà avec le pseudo « (.+) » — inscrire quand même ce joueur à la place du titulaire \?$/, 'An account already exists with the username "$1" — register this player in place of the holder anyway?'],
  [/^Un tournoi est actif \((.+)\)\. Envoyez replace=true \+ confirm_pin pour le remplacer par l\'import\.$/, "A tournament is active ($1). Send replace=true + confirm_pin to replace it with the import."],
  [/^Un tournoi est encore actif \((.+)\)\. Terminez-le ou supprimez-le d\'abord\.$/, "A tournament is still active ($1). Finish or delete it first."],
  [/^slug « (.+) » déjà pris$/, 'slug "$1" already taken']
];

function traduireErreur(msg, lang) {
  if (lang !== 'en' || typeof msg !== 'string' || !msg) return msg;
  if (STATIQUES[msg]) return STATIQUES[msg];
  for (const [re, rep] of DYNAMIQUES) {
    if (re.test(msg)) return msg.replace(re, rep);
  }
  return msg; // repli: francais
}

module.exports = { traduireErreur };

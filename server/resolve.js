// server/resolve.js

const { melanger } = require("./utils");
const { passerAuJoueurSuivant } = require("./gameLogic");

function resoudreVote(partie) {
  const action = partie.actionEnCours;
  const totalAttendus = partie.joueurs.filter(j => !j.estElimine && j.nom !== action.joueur).length;
  const totalVotes = Object.keys(partie.votesAction).length;

  console.log(`🗳️ [VOTE] ${totalVotes}/${totalAttendus} votes reçus`);

  if (totalVotes < totalAttendus) return;

  const accusations = Object.values(partie.votesAction).filter(v => v === "menteur");

  if (accusations.length > 0) {
    // Il y a eu une contestation
    console.log(`⚔️ [MENTEUR] Contestation déclenchée`);
    resoudreContestations(partie);
  } else {
    // Tous ont dit "non menteur", on exécute l'action normalement
    console.log(`✅ [VOTE] Personne n’a dit menteur — action validée`);
    const joueur = partie.joueurs.find(j => j.nom === action.joueur);
    joueur.socket.emit("actionValidee", action);
    delete partie.actionEnCours;
    partie.votesAction = {};
    setTimeout(() => passerAuJoueurSuivant(partie), 1000);
  }
}

function resoudreContestations(partie) {
  const action = partie.actionEnCours;
  const joueur = partie.joueurs.find(j => j.nom === action.joueur);
  const menteurs = Object.entries(partie.votesAction)
    .filter(([_, v]) => v === "menteur")
    .map(([nom]) => partie.joueurs.find(j => j.nom === nom));

  const possedeRole = joueur.cartes.includes(action.role);
  console.log(`🎭 [RÉVÉLATION] ${joueur.nom} a-t-il ${action.role} ? ${possedeRole ? "✅ OUI" : "❌ NON"}`);

  if (possedeRole) {
    joueur.socket.emit("revelerCarte", action.role);
    joueur.cartes.splice(joueur.cartes.indexOf(action.role), 1);
    const nouvelle = partie.pioche.pop();
    joueur.cartes.push(nouvelle);
    partie.pioche.push(action.role);
    partie.pioche = melanger(partie.pioche);

    menteurs.forEach(m => m.socket.emit("choisirCartePerdue", m.cartes));
    joueur.socket.emit("actionValidee", action);
  } else {
    joueur.socket.emit("choisirCartePerdue", joueur.cartes);
    joueur.socket.emit("actionRefusee", action);
  }

  delete partie.actionEnCours;
  partie.votesAction = {};
  setTimeout(() => passerAuJoueurSuivant(partie), 1500);
}

module.exports = {
  resoudreVote
};
// gameLogic.js

function passerAuJoueurSuivant(partie) {
  const total = partie.joueurs.length;
  let i = partie.tourActuel;

  // Trouve le prochain joueur vivant
  do {
    i = (i + 1) % total;
  } while (partie.joueurs[i].estElimine);

  partie.tourActuel = i;

  // Émet l’événement à tous les joueurs
  partie.joueurs.forEach(joueur => {
    joueur.socket.emit("nouveauTour", {
      joueurActif: partie.joueurs[i].nom,
      estTonTour: joueur.nom === partie.joueurs[i].nom
    });
  });

  console.log(`🔁 [TOUR] Nouveau tour pour ${partie.joueurs[i].nom}`);
}
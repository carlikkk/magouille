// server/gameManager.js
// Gestion des instances de parties pour Complots 2
// Tout le cœur de la logique de jeu a été centralisé dans index.js,
// ce module conserve la liste des parties actives et fournit un utilitaire
// pour retrouver une partie à partir d’un socket.

const games = {};

/**
 * Ajoute une nouvelle partie dans le registre.
 * @param {Game} game  Instance de Game créée dans index.js
 */
function registerGame(game) {
  games[game.code] = game;
}

/**
 * Supprime une partie du registre (appelé à la fin de partie).
 * @param {string} code  Code de la partie
 */
function unregisterGame(code) {
  delete games[code];
}

/**
 * Récupère la partie à laquelle appartient un socket donné.
 * @param {string} socketId  ID du socket
 * @returns {Game | null}
 */
function getPartieParSocketId(socketId) {
  for (const code of Object.keys(games)) {
    const partie = games[code];
    if (partie.players.some(p => p.id === socketId)) {
      return partie;
    }
  }
  return null;
}

module.exports = {
  registerGame,
  unregisterGame,
  getPartieParSocketId,
  games
};
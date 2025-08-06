// server/utils.js
// Fonctions utilitaires pour Complots 2

const { ROLES, creerDeck } = require("./cards");

/**
 * Mélange un tableau (Fisher–Yates) et renvoie la nouvelle séquence.
 *
 * @param {Array} array
 * @returns {Array} copie mélangée du tableau
 */
function melanger(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = {
  ROLES,
  creerDeck,
  melanger
};
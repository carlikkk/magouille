// public/cards.js
// Gestion de l’affichage des cartes — face et dos

const nomFichierCarte = {
  "Pape": "pape",
  "Illusionniste": "illusionniste",
  "Maître-Chanteur": "maitrechanteur",
  "Croque-Mort": "croquemort",
  "Espion": "espion"
};

/**
 * Crée et renvoie un élément IMG pour la face d’une carte donnée.
 * @param {string} nomCarte  Nom du rôle (doit correspondre à une clé de nomFichierCarte)
 * @returns {HTMLImageElement}
 */
export function renderCard(nomCarte) {
  const fichier = nomFichierCarte[nomCarte] || "inconnu";
  const img = document.createElement("img");
  img.src = `images/cartes/${fichier}.png`;
  img.alt = nomCarte;
  img.className = "carte";
  // Permet de cibler la carte via CSS si besoin (pixel-art, overrides, etc.)
  img.setAttribute("data-role", nomCarte);
  return img;
}

/**
 * Crée et renvoie un élément IMG pour le dos d’une carte.
 * @returns {HTMLImageElement}
 */
export function renderCardBack() {
  const img = document.createElement("img");
  img.src = `images/cartes/dos.png`;
  img.alt = "Dos de carte";
  img.className = "carte";
  return img;
}
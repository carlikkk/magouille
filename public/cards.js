// public/cards.js
// Visuels existants et aide de jeu correspondant aux mécaniques de Magouille.

export const ROLE_DETAILS = Object.freeze({
  "Illusionniste": Object.freeze({
    name: "Illusionniste",
    slug: "illusionniste",
    clan: "Perceptrices",
    color: "#93435e",
    short: "Prends 4 pièces, puis partage tes gains.",
    effect: "Prends 4 pièces au trésor. Chaque adversaire dont la revendication Illusionniste est acceptée et qui reste en vie reçoit 1 pièce de tes gains.",
    note: "Tu peux aussi te déclarer Illusionniste pour contrer l’aide étrangère.",
    icon: "mask"
  }),
  "Croque-Mort": Object.freeze({
    name: "Croque-Mort",
    slug: "croquemort",
    clan: "Intouchables",
    color: "#8a6934",
    short: "Partage l’or d’un joueur éliminé.",
    effect: "À une élimination, les Croque-Morts dont la revendication est acceptée et qui restent en vie se partagent les pièces du défunt. Le reste retourne au trésor.",
    note: "Interviens lors d’une élimination, sans utiliser ton tour. Tu peux aussi contrer le Maître-Chanteur.",
    icon: "shield"
  }),
  "Pape": Object.freeze({
    name: "Pape",
    slug: "pape",
    clan: "Voleurs",
    color: "#346072",
    short: "Demande 1 pièce à chaque adversaire.",
    effect: "Réclame 1 pièce à chaque adversaire encore en vie qui peut payer. Chacun peut se déclarer Pape pour refuser cette dîme ; son contre peut être contesté.",
    note: "Les adversaires répondent un à un. Une fois ton rôle prouvé, il ne peut plus être contesté pendant cette dîme.",
    icon: "cross"
  }),
  "Maître-Chanteur": Object.freeze({
    name: "Maître-Chanteur",
    slug: "maitrechanteur",
    clan: "Assassins",
    color: "#506837",
    short: "Exige 3 pièces ou fais perdre une carte.",
    effect: "Ta cible te paie 3 pièces ou reçoit 3 pièces de ta part et perd une carte. Tu dois posséder au moins 3 pièces pour lancer le chantage.",
    note: "Le Croque-Mort peut contrer le chantage. Sans 3 pièces, la cible ne peut pas choisir de payer.",
    icon: "dagger"
  }),
  "Espion": Object.freeze({
    name: "Espion",
    slug: "espion",
    clan: "Négociateurs",
    color: "#95503a",
    short: "Pioche 1 carte et choisis ta main.",
    effect: "Pioche 1 carte, puis garde autant de cartes que de vies restantes. Tu peux faire un second échange pour 1 pièce, après une nouvelle déclaration d’Espion.",
    note: "Le premier échange est gratuit. Le second est payé au trésor seulement si la déclaration est acceptée.",
    icon: "eye"
  })
});

const CARD_SIZES = Object.freeze({
  illusionniste: [476, 714],
  croquemort: [478, 717],
  pape: [477, 716],
  maitrechanteur: [477, 716],
  espion: [477, 715],
  dos: [173, 260]
});

function cardImage(slug, alt) {
  const img = document.createElement("img");
  const [width, height] = CARD_SIZES[slug];
  img.src = `images/cartes/${slug}.png`;
  img.alt = alt;
  img.className = "carte";
  img.width = width;
  img.height = height;
  img.draggable = false;
  img.decoding = "async";
  return img;
}

/** Crée la face d’une carte connue, sans construire de chemin à partir d’une saisie. */
export function renderCard(role) {
  const details = typeof role === "string" && Object.hasOwn(ROLE_DETAILS, role)
    ? ROLE_DETAILS[role]
    : null;
  if (!details) {
    const img = renderCardBack();
    img.alt = "Carte inconnue";
    return img;
  }
  const img = cardImage(details.slug, `Carte : ${details.name}`);
  img.setAttribute("data-role", details.name);
  return img;
}

/** Le dos ne contient aucune information sur le rôle caché. */
export function renderCardBack() {
  const img = cardImage("dos", "Carte face cachée");
  img.setAttribute("data-face", "back");
  return img;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Tracés statiques, indépendants de toute police ou bibliothèque d’icônes.
const ICONS = Object.freeze({
  crown: [
    ["path", { d: "M3 6l5 4 4-6 4 6 5-4-2 12H5L3 6Z" }],
    ["path", { d: "M6 21h12" }]
  ],
  coins: [
    ["ellipse", { cx: 9, cy: 6, rx: 6, ry: 3 }],
    ["path", { d: "M3 6v5c0 1.7 2.7 3 6 3 1.2 0 2.3-.2 3.2-.5M3 11v5c0 1.7 2.7 3 6 3h1" }],
    ["ellipse", { cx: 17, cy: 14, rx: 4, ry: 2 }],
    ["path", { d: "M13 14v5c0 1.1 1.8 2 4 2s4-.9 4-2v-5" }]
  ],
  hand: [
    ["path", { d: "M3 16h3l4 4h6l5-5a1.5 1.5 0 0 0-2-2l-3 2h-5m-5 1v-4h4l3 2h2a1.5 1.5 0 0 1 0 3h-4M3 11v10" }],
    ["circle", { cx: 14, cy: 6, r: 3 }]
  ],
  dagger: [
    ["path", { d: "m9 15 10-10 1-3-3 1L7 13m-2-2 8 8M7 17l-4 4m-1-2 3 3" }]
  ],
  mask: [
    ["path", { d: "M3 5c3 1.3 6 1.3 9 0 3 1.3 6 1.3 9 0v7c0 4-4 7-9 9-5-2-9-5-9-9V5Z" }],
    ["path", { d: "m6 10 3 1m6 0 3-1m-9 6c2 1 4 1 6 0" }]
  ],
  eye: [
    ["path", { d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" }],
    ["circle", { cx: 12, cy: 12, r: 3 }]
  ],
  shield: [
    ["path", { d: "M12 3 4 6v6c0 4 4 7 8 9 4-2 8-5 8-9V6l-8-3Z" }],
    ["path", { d: "m8.5 12 2.5 2.5 4.5-5" }]
  ],
  cross: [
    ["path", { d: "M10 3h4v5h5v4h-5v9h-4v-9H5V8h5V3Z" }]
  ],
  book: [
    ["path", { d: "M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v15" }],
    ["path", { d: "M6 9h3m6 0h3M6 13h3m6 0h3" }]
  ],
  arrow: [
    ["path", { d: "M5 12h14m-6-6 6 6-6 6" }]
  ],
  arrowRight: [
    ["path", { d: "M5 12h14m-6-6 6 6-6 6" }]
  ],
  chevron: [
    ["path", { d: "m6 9 6 6 6-6" }]
  ],
  check: [
    ["path", { d: "m5 12 4 4L19 6" }]
  ],
  close: [
    ["path", { d: "m6 6 12 12M18 6 6 18" }]
  ],
  copy: [
    ["rect", { x: 8, y: 8, width: 12, height: 13, rx: 2 }],
    ["path", { d: "M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" }]
  ],
  volume: [
    ["path", { d: "m11 4-5 4H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" }]
  ],
  volumeOff: [
    ["path", { d: "m11 4-5 4H3v8h3l5 4V4Zm5 5 6 6m0-6-6 6" }]
  ],
  users: [
    ["circle", { cx: 9, cy: 7, r: 3 }],
    ["path", { d: "M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m3 11v-3a6 6 0 0 0-2-4.5" }]
  ],
  hourglass: [
    ["path", { d: "M6 3h12M6 21h12M7 3v4c0 2 3 3 5 5-2 2-5 3-5 5v4m10-18v4c0 2-3 3-5 5 2 2 5 3 5 5v4M9 18h6" }]
  ],
  spark: [
    ["path", { d: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" }]
  ],
  target: [
    ["circle", { cx: 12, cy: 12, r: 7 }],
    ["circle", { cx: 12, cy: 12, r: 2 }],
    ["path", { d: "M12 2v3m0 14v3M2 12h3m14 0h3" }]
  ],
  shuffle: [
    ["path", { d: "M3 6h3c4 0 8 12 12 12h3m-4-4 4 4-4 4M3 18h3c1.5 0 3-1.7 4.5-4M13.5 10C15 7.7 16.5 6 18 6h3m-4-4 4 4-4 4" }]
  ],
  lock: [
    ["rect", { x: 5, y: 10, width: 14, height: 11, rx: 2 }],
    ["path", { d: "M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" }]
  ],
  moon: [
    ["path", { d: "M20.6 14.2A9 9 0 0 1 9.8 3.4a9 9 0 1 0 10.8 10.8Z" }]
  ]
});

/** Crée une icône décorative ; le contrôle qui la contient porte son propre libellé. */
export function createIcon(name, options = {}) {
  const { className = "", size = 20 } = options && typeof options === "object" ? options : {};
  const dimension = Number.isFinite(size) && size > 0 ? size : 20;
  const shapes = typeof name === "string" && Object.hasOwn(ICONS, name) ? ICONS[name] : ICONS.spark;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(dimension));
  svg.setAttribute("height", String(dimension));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.65");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", typeof className === "string" && className.trim()
    ? `icon ${className.trim()}` : "icon");
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [attribute, value] of Object.entries(attributes)) {
      shape.setAttribute(attribute, String(value));
    }
    svg.appendChild(shape);
  }
  return svg;
}

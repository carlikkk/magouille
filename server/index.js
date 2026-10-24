// server/index.js
// Point d’entrée serveur pour Complots 2, avec enregistrement/cleanup des parties

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { nanoid } = require("nanoid");

// Gestionnaire global des parties
const {
  registerGame,
  unregisterGame,
  getPartieParSocketId,
  games
} = require("./gameManager");

// Constantes de configuration
const MAX_PLAYERS = 4;
const STARTING_COINS_PER_PLAYER = 2;
const TOTAL_COIN_POOL = 50;
const ROLES = [
  "Illusionniste",
  "Croque-Mort",
  "Pape",
  "Maître-Chanteur",
  "Espion"
];

// --- Classes de base ---

class Card {
  constructor(role) {
    this.role = role;
    this.isRevealed = false;
  }
}

class Player {
  constructor(socket, name) {
    this.socket = socket;
    this.id = socket.id;
    this.name = name;
    this.coins = STARTING_COINS_PER_PLAYER;
    this.hand = [];        // Card[]
    this.revealed = [];    // string[]
    this.isAlive = true;
  }

  loseLife() {
    if (this.hand.length === 0) return;
    const lost = this.hand.pop();
    this.revealed.push(lost.role);
    if (this.hand.length === 0) this.isAlive = false;
  }
}

// --- Classe Game encapsulant toute la logique ---

class Game {
  constructor(code) {
    this.code = code;
    this.players = [];            // Player[]
    this.deck = [];               // Card[]
    this.treasure = 0;
    this.currentPlayerIndex = 0;
    this.phase = "WAITING";       // WAITING, IN_PROGRESS, ENDED
    this.actionInProgress = null; // { actor, role, targetName }
    this.votes = {};              // { playerName: "ok"|"menteur" }
    this.claimsIllu = [];         // noms revendiquant Illusionniste
  }

  init() {
    this.phase = "IN_PROGRESS";
    this.buildDeck();
    this.shuffleDeck();
    this.dealHands();
    this.setupTreasure();
    this.broadcastState();
    this.startTurn();
  }

  buildDeck() {
    this.deck = [];
    ROLES.forEach(r => {
      for (let i = 0; i < 3; i++) {
        this.deck.push(new Card(r));
      }
    });
  }

  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  dealHands() {
    this.players.forEach(p => {
      p.hand.push(this.deck.pop());
      p.hand.push(this.deck.pop());
      p.socket.emit("cartesDistribuees", p.hand.map(c => c.role));
    });
  }

  setupTreasure() {
    this.treasure =
      TOTAL_COIN_POOL - this.players.length * STARTING_COINS_PER_PLAYER;
  }

  startTurn() {
    if (this.aliveCount() < 2) {
      return this.endGame();
    }
    const active = this.players[this.currentPlayerIndex];
    if (!active.isAlive) {
      return this.nextPlayer();
    }
    this.broadcastTurn(active);
    active.socket.emit("yourTurn", { coins: active.coins });
  }

  broadcastTurn(player) {
    this.players.forEach(p => {
      p.socket.emit("nouveauTour", { joueurActif: player.name });
    });
  }

  playAction(actorName, action, targetName) {
    const actor = this.players.find(p => p.name === actorName);
    if (!actor) return;
    // Forcer assassinat si ≥10 pièces
    if (actor.coins >= 10 && action !== "Assassinat") {
      return actor.socket.emit("actionInvalidée", "Tu dois assassiner.");
    }

    this.actionInProgress = { actor, role: action, targetName };
    this.votes = {};
    this.claimsIllu = [];

    this.addLog(
      `${actor.name} déclare ${action}${targetName ? " sur " + targetName : ""}`
    );
    this.players.forEach(p => {
      p.socket.emit("actionAnnoncee", {
        joueur: actor.name,
        role: action,
        description: action,
        cible: targetName || null
      });
    });
  }

  receiveVote(playerName, vote) {
    this.votes[playerName] = vote;
    if (Object.keys(this.votes).length === this.aliveCount() - 1) {
      this.resolveChallenge();
    }
  }

  claimIllu(playerName) {
    if (!this.claimsIllu.includes(playerName)) {
      this.claimsIllu.push(playerName);
      this.addLog(`${playerName} revendique Illusionniste`);
    }
  }

  resolveChallenge() {
    const accusers = Object.entries(this.votes)
      .filter(([_, v]) => v === "menteur")
      .map(([n]) => this.players.find(p => p.name === n));

    if (accusers.length > 0) {
      return this.doRevealCheck(accusers);
    }
    return this.promptCounter();
  }

  doRevealCheck(accusers) {
    const { actor, role } = this.actionInProgress;
    const hasRole = actor.hand.some(c => c.role === role);

    if (hasRole) {
      accusers.forEach(ch => ch.loseLife());
      this.replaceCard(actor, role);
      return this.applyEffect();
    }

    actor.loseLife();
    this.cleanupAfterAction();
  }

  promptCounter() {
    const { role, targetName } = this.actionInProgress;
    const counterable = ["Aide étrangère", "Assassinat"].includes(role);
    if (!counterable || !targetName) {
      return this.applyEffect();
    }
    const target = this.players.find(p => p.name === targetName);
    target.socket.emit("counterRequested", {
      role,
      actor: this.actionInProgress.actor.name
    });
    // attente d'un 'counter' ou d'un timeout...
  }

  receiveCounter(playerName) {
    // À implémenter : bluff du contreur vs contrecoup
  }

  applyEffect() {
    const { actor, role, targetName } = this.actionInProgress;
    const target = this.players.find(p => p.name === targetName);

    switch (role) {
      case "Revenu":
        actor.coins += 1; this.treasure -= 1;
        break;
      case "Aide étrangère":
        actor.coins += 2; this.treasure -= 2;
        break;
      case "Assassinat":
        actor.coins -= 3; this.treasure += 3;
        if (target && target.isAlive) target.loseLife();
        break;
      case "Illusionniste":
        this.powerIllusionniste(actor);
        break;
      case "Croque-Mort":
        this.powerCroqueMort(actor);
        break;
      case "Pape":
        this.powerPape(actor);
        break;
      case "Maître-Chanteur":
        this.powerMaitreChanteur(actor, target);
        break;
      case "Espion":
        this.powerEspion(actor);
        break;
    }
    this.cleanupAfterAction();
  }

  powerIllusionniste(player) {
    player.coins += 4; 
    this.treasure -= 4;

    const count = this.claimsIllu.length;
    if (count >= 1 && count <= 3) {
      this.claimsIllu.forEach(name => {
        const p = this.players.find(x => x.name === name);
        player.coins += 1; 
        p.treasure -= 1;
      });
    }
  }

  powerCroqueMort(player) {
    const dead = this.players.filter(p => !p.isAlive);
    const sum = dead.reduce((a,p) => a + p.coins, 0);
    const share = dead.length ? Math.floor(sum/dead.length) : 0;
    dead.forEach(() => player.coins += share);
    this.treasure += sum - share*dead.length;
  }

  powerPape(player) {
    this.players.forEach(p => {
      if (p !== player && p.isAlive && p.coins > 0) {
        player.coins += 1; 
        p.coins -= 1;
      }
    });
  }

  powerMaitreChanteur(player, target) {
    if (target.coins >= 3) {
      target.socket.emit("maitreChanteurDemand", { from: player.name });
    } else {
      player.coins += 3;
      target.loseLife();
    }
  }

  powerEspion(player) {
    const drawn = this.deck.pop();
    player.socket.emit("choixEspionCartes", {
      main: player.hand.map(c => c.role),
      piochée: drawn.role
    });
  }

  resolveEspionChoice(playerName, keep, discard) {
    const p = this.players.find(x => x.name === playerName);
    p.hand = keep.map(r => new Card(r));
    this.deck.push(...discard.map(r => new Card(r)));
    this.shuffleDeck();
  }

  replaceCard(player, role) {
    const idx = player.hand.findIndex(
      c => c.role === role && !c.isRevealed
    );
    if (idx < 0) return;

    const [provedCard] = player.hand.splice(idx, 1);
    this.deck.push(provedCard);
    this.shuffleDeck();
    player.hand.push(this.deck.pop());
  }

  cleanupAfterAction() {
    this.actionInProgress = null;
    this.votes = {};
    this.claimsIllu = [];

    // éliminations & transfert trésor
    this.players.forEach(p => {
      if (!p.isAlive && p.coins > 0) {
        this.addLog(`☠️ ${p.name} éliminé`);
        this.treasure += p.coins;
        p.coins = 0;
      }
    });

    this.broadcastState();
    this.nextPlayer();
  }

  nextPlayer() {
    do {
      this.currentPlayerIndex =
        (this.currentPlayerIndex + 1) % this.players.length;
    } while (!this.players[this.currentPlayerIndex].isAlive);
    this.startTurn();
  }

  aliveCount() {
    return this.players.filter(p => p.isAlive).length;
  }

  endGame() {
    const winner = this.players.find(p => p.isAlive);
    this.addLog(`🏆 Victoire de ${winner.name} !`);
    this.players.forEach(p => p.socket.emit("gameEnded", winner.name));
    this.phase = "ENDED";
    unregisterGame(this.code); // <-- cleanup de la partie
  }

  addLog(line) {
    const ts = new Date().toLocaleTimeString();
    const msg = `[${ts}] ${line}`;
    this.players.forEach(p => p.socket.emit("logUpdate", msg));
  }

  broadcastState() {
    const state = {
      players: this.players.map(p => ({
        name: p.name,
        coins: p.coins,
        hand: p.hand.map(c => c.role),
        revealed: p.revealed,
        isAlive: p.isAlive
      })),
      treasure: this.treasure,
      deckCount: this.deck.length
    };
    this.players.forEach(p => p.socket.emit("stateUpdate", state));
  }
}

// --- Serveur HTTP + WebSocket ---

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "../public")));

io.on("connection", socket => {
  console.log("🔗 Connexion :", socket.id);

  socket.on("creerPartie", (nom, cb) => {
    const code = nanoid(6).toUpperCase();
    const game = new Game(code);
    registerGame(game);                // <- enregistrement
    game.players.push(new Player(socket, nom));
    socket.join(code);
    cb({ ok: true, code });
    console.log(`🆕 Partie ${code} créée par ${nom}`);
  });

  socket.on("rejoindrePartie", (code, nom, cb) => {
    const game = games[code];
    if (!game) return cb({ ok: false, message: "Partie introuvable." });
    if (game.phase !== "WAITING")
      return cb({ ok: false, message: "Partie déjà lancée." });
    if (game.players.length >= MAX_PLAYERS)
      return cb({ ok: false, message: "Partie pleine." });

    game.players.push(new Player(socket, nom));
    socket.join(code);

    io.to(code).emit("etatSalle", {
      code,
      joueurs: game.players.map(p => p.name)
    });
    cb({ ok: true });

    if (game.players.length === MAX_PLAYERS) {
      game.init();
    }
  });

  socket.on("jouerAction", ({ action, target }, cb) => {
    const game = getPartieParSocketId(socket.id);
    const actor = game.players.find(p => p.id === socket.id);
    if (!actor || game.players[game.currentPlayerIndex].id !== socket.id) {
      return cb({ ok: false, message: "Pas ton tour." });
    }
    game.playAction(actor.name, action, target);
    cb({ ok: true });
  });

  socket.on("voteAction", vote => {
    const game = getPartieParSocketId(socket.id);
    const player = game.players.find(p => p.id === socket.id);
    game.receiveVote(player.name, vote);
  });

  socket.on("revendiquerIllusionniste", () => {
    const game = getPartieParSocketId(socket.id);
    const player = game.players.find(p => p.id === socket.id);
    game.claimIllu(player.name);
  });

  socket.on("choixEspion", ({ garder, defausse }) => {
    const game = getPartieParSocketId(socket.id);
    const player = game.players.find(p => p.id === socket.id);
    game.resolveEspionChoice(player.name, garder, defausse);
  });

  socket.on("disconnect", () => {
    console.log("❌ Déconnexion :", socket.id);
  });
});

server.listen(3000, () => {
  console.log("🚀 Serveur démarré sur http://localhost:3000");
});
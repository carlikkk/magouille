// server/index.js
// Magouille : règles de jeu et échanges privés avec chaque joueur.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { nanoid } = require("nanoid");
const {
  registerGame,
  unregisterGame,
  getPartieParSocketId,
  games
} = require("./gameManager");

const MAX_PLAYERS = 4;
const STARTING_COINS_PER_PLAYER = 2;
const TOTAL_COIN_POOL = 54;
const ROLES = ["Illusionniste", "Croque-Mort", "Pape", "Maître-Chanteur", "Espion"];
const ACTIONS = [
  "Revenu", "Aide étrangère", "Assassinat",
  "Illusionniste", "Pape", "Maître-Chanteur", "Espion"
];
// L'Illusionniste appartient au clan des Perceptrices dans cette sélection.
const FOREIGN_AID_BLOCK_ROLE = "Illusionniste";

class GameStopped extends Error {}

class Card {
  constructor(role) {
    this.role = role;
  }
}

class Player {
  constructor(socket, name) {
    this.socket = socket;
    this.id = socket.id;
    this.name = name;
    this.coins = STARTING_COINS_PER_PLAYER;
    this.hand = [];
    this.revealed = [];
    this.isAlive = true;
  }
}

class Game {
  constructor(code) {
    this.code = code;
    this.players = [];
    this.deck = [];
    this.treasure = 0;
    this.phase = "WAITING";
    this.currentPlayerIndex = 0;
    this.turnId = 0;
    this.actionInProgress = null;
    this.interaction = null;
    this.estates = [];
    this.activeEstate = null;
    this.processingEstates = false;
    this.pendingDraw = null;
    this.actionTask = null;
  }

  broadcast(event, payload) {
    this.players.forEach(p => p.socket.emit(event, payload));
  }

  addLog(line) {
    this.broadcast("logUpdate", "[" + new Date().toLocaleTimeString() + "] " + line);
  }

  broadcastLobby() {
    this.broadcast("etatSalle", {
      code: this.code,
      joueurs: this.players.map(p => p.name),
      maxPlayers: MAX_PLAYERS
    });
  }

  buildDeck() {
    this.deck = ROLES.flatMap(role => [
      new Card(role), new Card(role), new Card(role)
    ]);
  }

  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  init() {
    if (this.phase !== "WAITING" || this.players.length !== MAX_PLAYERS) return;
    this.buildDeck();
    this.shuffleDeck();
    this.players.forEach(p => {
      p.hand = [this.deck.pop(), this.deck.pop()];
    });
    this.treasure = TOTAL_COIN_POOL - this.players.length * STARTING_COINS_PER_PLAYER;
    this.phase = "IN_PROGRESS";
    this.addLog("La partie commence.");
    this.startTurn();
  }

  livingPlayers() {
    return this.players.filter(p => p.isAlive);
  }

  aliveCount() {
    return this.livingPlayers().length;
  }

  assertRunning() {
    if (this.phase !== "IN_PROGRESS") throw new GameStopped();
  }

  actionError(player, action, targetId, turnId) {
    if (this.phase !== "IN_PROGRESS") return "La partie n'est pas en cours.";
    if (!player || !this.players.includes(player) || !player.isAlive) {
      return "Tu ne peux pas jouer dans cette partie.";
    }
    if (this.players[this.currentPlayerIndex] !== player) return "Ce n'est pas ton tour.";
    if (turnId !== this.turnId) return "Ce tour est terminé. Utilise les boutons actuels.";
    if (this.actionInProgress) return "L'action précédente est encore en cours.";
    if (!ACTIONS.includes(action)) return "Action inconnue.";
    if (player.coins >= 10 && action !== "Assassinat") {
      return "Avec 10 pièces ou plus, tu dois assassiner.";
    }
    if (action === "Assassinat" && player.coins < 7) {
      return "L'assassinat coûte 7 pièces.";
    }
    if (action === "Maître-Chanteur" && player.coins < 3) {
      return "Il faut au moins 3 pièces pour lancer un chantage.";
    }
    const bankCost = { Revenu: 1, "Aide étrangère": 2, Illusionniste: 4 }[action] || 0;
    if (this.treasure < bankCost) return "Le trésor ne contient pas assez de pièces.";
    const targeted = action === "Assassinat" || action === "Maître-Chanteur";
    if (targeted) {
      const target = this.players.find(p => p.id === targetId);
      if (!target || !target.isAlive || target === player) {
        return "Choisis un autre joueur encore en vie.";
      }
    } else if (targetId !== null && targetId !== undefined) {
      return "Cette action n'a pas de cible.";
    }
    return null;
  }

  availableActions(player) {
    if (
      this.phase !== "IN_PROGRESS" || this.actionInProgress ||
      !player.isAlive || this.players[this.currentPlayerIndex] !== player
    ) return [];

    const sampleTarget = this.players.find(p => p !== player && p.isAlive);
    return ACTIONS.map(action => {
      const targetable = action === "Assassinat" || action === "Maître-Chanteur";
      const reason = this.actionError(
        player, action, targetable ? sampleTarget?.id : null, this.turnId
      );
      return {
        action,
        label: action === "Assassinat" ? "Assassinat — 7 pièces" : action,
        targetable,
        disabled: Boolean(reason),
        reason: reason || ""
      };
    });
  }

  broadcastState() {
    this.players.forEach(recipient => {
      recipient.socket.emit("stateUpdate", {
        code: this.code,
        phase: this.phase,
        players: this.players.map(p => ({
          id: p.id,
          name: p.name,
          coins: p.coins,
          hand: p.id === recipient.id ? p.hand.map(c => c.role) : p.hand.map(() => null),
          revealed: [...p.revealed],
          isAlive: p.isAlive
        })),
        treasure: this.treasure,
        deckCount: this.deck.length,
        currentPlayerId: this.players[this.currentPlayerIndex]?.id || null,
        turnId: this.turnId,
        actions: this.availableActions(recipient)
      });
    });
  }

  startTurn() {
    if (this.phase !== "IN_PROGRESS") return;
    if (this.aliveCount() < 2) return this.endGame();
    if (!this.players[this.currentPlayerIndex].isAlive) {
      this.advancePlayer();
    }
    this.turnId += 1;
    const active = this.players[this.currentPlayerIndex];
    this.broadcastState();
    this.broadcast("nouveauTour", {
      joueurActif: active.name,
      playerId: active.id,
      turnId: this.turnId
    });
  }

  advancePlayer() {
    for (let i = 0; i < this.players.length; i++) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      if (this.players[this.currentPlayerIndex].isAlive) return;
    }
  }

  playAction(player, payload) {
    if (!payload || typeof payload !== "object") {
      return { ok: false, message: "Action invalide." };
    }
    const { action, targetId = null, turnId } = payload;
    const error = this.actionError(player, action, targetId, turnId);
    if (error) return { ok: false, message: error };

    const current = {
      id: nanoid(12),
      actor: player,
      role: action,
      target: this.players.find(p => p.id === targetId) || null
    };
    this.actionInProgress = current;
    this.addLog(player.name + " annonce " + action +
      (current.target ? " sur " + current.target.name : "") + ".");
    this.broadcastState();
    this.broadcast("actionAnnoncee", {
      actionId: current.id,
      joueur: player.name,
      actorId: player.id,
      role: action,
      description: action,
      cible: current.target?.name || null,
      targetId
    });

    // Le verrou est posé avant de rendre la main au gestionnaire Socket.IO.
    this.actionTask = Promise.resolve()
      .then(() => this.runAction(current))
      .catch(error => {
        if (error instanceof GameStopped) return;
        console.error("Erreur dans la partie " + this.code + " :", error);
        this.abort("Une erreur a interrompu la partie. Créez une nouvelle salle.");
      });
    return { ok: true };
  }

  async runAction(action) {
    this.assertRunning();
    const { actor, role, target } = action;
    switch (role) {
      case "Revenu":
        this.takeFromTreasury(actor, 1);
        break;
      case "Aide étrangère":
        await this.foreignAid(actor);
        break;
      case "Assassinat":
        actor.coins -= 7;
        this.treasure += 7;
        this.broadcastState();
        await this.loseInfluence(target, "Assassinat");
        await this.settleEstates();
        break;
      case "Illusionniste":
        await this.powerIllusionniste(actor);
        break;
      case "Pape":
        await this.powerPape(actor);
        break;
      case "Maître-Chanteur":
        await this.powerMaitreChanteur(actor, target);
        break;
      case "Espion":
        await this.powerEspion(actor);
        break;
    }
    this.assertRunning();
    await this.settleEstates();
    this.finishAction(action);
  }

  finishAction(action) {
    if (this.phase !== "IN_PROGRESS" || this.actionInProgress !== action) return;
    this.actionInProgress = null;
    if (this.aliveCount() < 2) return this.endGame();
    this.advancePlayer();
    this.startTurn();
  }

  takeFromTreasury(player, amount) {
    if (!Number.isInteger(amount) || amount < 0 || this.treasure < amount) {
      throw new Error("Retrait impossible du trésor.");
    }
    this.treasure -= amount;
    player.coins += amount;
    this.addLog(player.name + " prend " + amount + " pièce(s) du trésor.");
  }

  transfer(from, to, amount) {
    if (!Number.isInteger(amount) || amount < 0 || from.coins < amount) {
      throw new Error("Transfert de pièces impossible.");
    }
    from.coins -= amount;
    to.coins += amount;
  }

  requestDecision({
    participants, title, message = "", viewFor, mode = "all", firstChoices = []
  }) {
    this.assertRunning();
    if (this.interaction) throw new Error("Deux décisions simultanées.");
    const eligible = [...new Set(participants)].filter(p => p.isAlive);
    if (!eligible.length) return Promise.resolve({ answers: new Map(), first: null });

    return new Promise((resolve, reject) => {
      const promptId = nanoid(16);
      const views = new Map(eligible.map(p => [p.id, viewFor(p)]));
      this.interaction = {
        promptId, views, answers: new Map(), mode, firstChoices, resolve, reject
      };
      this.broadcast("decisionStatus", { promptId, title, message });
      eligible.forEach(p => {
        const view = views.get(p.id);
        p.socket.emit("decisionDemand", {
          promptId, title, message, kind: "choice", ...view
        });
      });
    });
  }

  respond(player, payload) {
    if (this.phase !== "IN_PROGRESS" || !player || !player.isAlive) {
      return { ok: false, message: "Tu ne peux pas répondre." };
    }
    const interaction = this.interaction;
    if (!interaction || !payload || payload.promptId !== interaction.promptId) {
      return { ok: false, message: "Cette décision est déjà terminée." };
    }
    const view = interaction.views.get(player.id);
    if (!view || interaction.answers.has(player.id)) {
      return { ok: false, message: "Tu ne peux pas répondre à nouveau à cette décision." };
    }

    let answer;
    if (view.kind === "cards") {
      const indices = payload.indices;
      if (
        !Array.isArray(indices) || indices.length !== view.count ||
        new Set(indices).size !== indices.length ||
        indices.some(i => !Number.isInteger(i) || i < 0 || i >= view.cards.length)
      ) {
        return { ok: false, message: "Sélection de cartes invalide." };
      }
      answer = [...indices];
    } else {
      if (
        typeof payload.choice !== "string" ||
        !view.options.some(option => option.value === payload.choice)
      ) {
        return { ok: false, message: "Choix invalide." };
      }
      answer = payload.choice;
    }

    interaction.answers.set(player.id, answer);
    const first = interaction.mode === "first" || interaction.firstChoices.includes(answer);
    if (first || interaction.answers.size === interaction.views.size) {
      this.interaction = null;
      this.broadcast("decisionClosed", { promptId: interaction.promptId });
      interaction.resolve({
        answers: interaction.answers,
        first: first ? { playerId: player.id, choice: answer } : null
      });
    }
    return { ok: true };
  }

  async challengeWindow(claimant, role, title) {
    this.assertRunning();
    if (!claimant.isAlive) return { accepted: false, proved: false };
    const result = await this.requestDecision({
      participants: this.livingPlayers().filter(p => p !== claimant),
      title: title || (claimant.name + " affirme être " + role),
      message: "La première accusation interrompt immédiatement les réponses.",
      firstChoices: ["challenge"],
      viewFor: () => ({
        options: [
          { value: "ok", label: "Accepter" },
          { value: "challenge", label: "Menteur !" }
        ]
      })
    });
    this.assertRunning();
    if (!result.first) return { accepted: true, proved: false };
    const challenger = this.players.find(p => p.id === result.first.playerId);
    const truthful = await this.resolveChallenge(claimant, role, challenger);
    return { accepted: truthful, proved: truthful };
  }

  async resolveChallenge(claimant, role, challenger) {
    this.assertRunning();
    const truthful = claimant.hand.some(c => c.role === role);
    this.addLog(challenger.name + " accuse " + claimant.name + " de mentir.");
    if (truthful) {
      this.addLog(claimant.name + " prouve sa carte " + role + ".");
      this.replaceCard(claimant, role);
      this.broadcastState();
      await this.loseInfluence(challenger, "Accusation incorrecte");
    } else {
      this.addLog(claimant.name + " n'a pas de carte " + role + ".");
      await this.loseInfluence(claimant, "Bluff découvert");
    }
    await this.settleEstates();
    return truthful;
  }

  replaceCard(player, role) {
    const index = player.hand.findIndex(c => c.role === role);
    if (index < 0) throw new Error("La carte prouvée est absente.");
    const [card] = player.hand.splice(index, 1);
    this.deck.push(card);
    this.shuffleDeck();
    player.hand.push(this.deck.pop());
  }

  async loseInfluence(player, reason) {
    this.assertRunning();
    if (!player || !player.isAlive || !player.hand.length) return;
    let index = 0;
    if (player.hand.length > 1) {
      const result = await this.requestDecision({
        participants: [player],
        title: player.name + " doit perdre une carte",
        message: reason + " : choisis la carte à révéler définitivement.",
        viewFor: () => ({
          kind: "cards",
          cards: player.hand.map(c => c.role),
          count: 1
        })
      });
      this.assertRunning();
      index = result.answers.get(player.id)[0];
    }
    const [lost] = player.hand.splice(index, 1);
    player.revealed.push(lost.role);
    this.addLog(player.name + " perd sa carte " + lost.role + ".");
    if (!player.hand.length) {
      player.isAlive = false;
      const coins = player.coins;
      player.coins = 0;
      if (coins > 0) this.estates.push({ name: player.name, coins });
      this.addLog("☠️ " + player.name + " est éliminé.");
    }
    this.broadcastState();
    if (this.aliveCount() < 2) {
      this.endGame();
      throw new GameStopped();
    }
  }

  async foreignAid(actor) {
    const result = await this.requestDecision({
      participants: this.livingPlayers().filter(p => p !== actor),
      title: "Aide étrangère de " + actor.name,
      message: "Le clan des Perceptrices peut bloquer l'aide étrangère.",
      firstChoices: ["block"],
      viewFor: () => ({
        options: [
          { value: "pass", label: "Laisser passer" },
          { value: "block", label: "Contrer : je suis " + FOREIGN_AID_BLOCK_ROLE }
        ]
      })
    });
    this.assertRunning();
    if (result.first) {
      const blocker = this.players.find(p => p.id === result.first.playerId);
      const block = await this.challengeWindow(
        blocker, FOREIGN_AID_BLOCK_ROLE, "Contre de " + blocker.name
      );
      if (block.accepted) {
        this.addLog("L'aide étrangère est bloquée.");
        return;
      }
    }
    if (actor.isAlive) this.takeFromTreasury(actor, 2);
  }

  async powerIllusionniste(actor) {
    const initial = await this.challengeWindow(actor, "Illusionniste");
    if (!initial.accepted || !actor.isAlive) return;

    const opponents = this.livingPlayers().filter(p => p !== actor);
    const answers = await this.requestDecision({
      participants: opponents,
      title: "Revendications Illusionniste",
      message: "Chaque autre joueur peut réclamer une pièce sur les gains.",
      viewFor: () => ({
        options: [
          { value: "claim", label: "Moi aussi, je suis Illusionniste" },
          { value: "pass", label: "Ne pas revendiquer" }
        ]
      })
    });
    this.assertRunning();
    const claimants = opponents.filter(p => answers.answers.get(p.id) === "claim");
    const valid = [];
    for (const claimant of claimants) {
      if (!actor.isAlive) return;
      if (!claimant.isAlive) continue;
      const claim = await this.challengeWindow(
        claimant, "Illusionniste", "Revendication de " + claimant.name
      );
      if (claim.accepted) valid.push(claimant);
    }
    if (!actor.isAlive) return;
    const survivors = valid.filter(p => p.isAlive);
    if (survivors.length >= 4) {
      this.addLog("Quatre revendications ou plus : aucun gain.");
      return;
    }
    this.takeFromTreasury(actor, 4);
    survivors.forEach(p => this.transfer(actor, p, 1));
    if (survivors.length) this.addLog(actor.name + " partage ses gains avec les revendiquants.");
  }

  async powerEspion(actor) {
    // La mécanique déjà présente dans le projet est conservée : une carte piochée,
    // puis autant de cartes gardées que de vies restantes. Le coût revient au trésor.
    for (let round = 0; round < 2; round++) {
      const claim = await this.challengeWindow(
        actor, "Espion",
        actor.name + " annonce Espion" + (round ? " — deuxième échange, 1 pièce" : "")
      );
      if (!claim.accepted || !actor.isAlive) return;
      if (round === 1) {
        if (actor.coins < 1) return;
        actor.coins -= 1;
        this.treasure += 1;
        this.addLog(actor.name + " paie 1 pièce pour son deuxième échange.");
      }

      const drawn = this.deck.pop();
      if (!drawn) throw new Error("La pioche est vide.");
      this.pendingDraw = drawn;
      const keepCount = actor.hand.length;
      const pool = [...actor.hand, drawn];
      this.broadcastState();
      const selection = await this.requestDecision({
        participants: [actor],
        title: "Échange de l'Espion",
        message: "Choisis " + keepCount + " carte(s) à garder.",
        viewFor: () => ({
          kind: "cards", cards: pool.map(c => c.role), count: keepCount
        })
      });
      this.assertRunning();
      const chosen = new Set(selection.answers.get(actor.id));
      actor.hand = pool.filter((_, i) => chosen.has(i));
      this.deck.push(...pool.filter((_, i) => !chosen.has(i)));
      this.pendingDraw = null;
      this.shuffleDeck();
      this.broadcastState();

      if (round === 1 || actor.coins < 1) return;
      const repeat = await this.requestDecision({
        participants: [actor],
        title: "Rejouer l'Espion ?",
        message: "Un seul échange supplémentaire est possible, pour 1 pièce.",
        viewFor: () => ({
          options: [
            { value: "again", label: "Rejouer pour 1 pièce" },
            { value: "finish", label: "Terminer mon tour" }
          ]
        })
      });
      this.assertRunning();
      if (repeat.answers.get(actor.id) !== "again") return;
    }
  }

  async powerMaitreChanteur(actor, target) {
    // La première réaction clôt la fenêtre d'accusation initiale. Après une preuve,
    // le contre Croque-Mort reste possible (règle générale : défi puis contre).
    // Un faux contre laisse à une cible survivante le choix payer/refuser.
    let actorClaimOpen = true;
    let blockAvailable = true;
    while (actor.isAlive && target.isAlive) {
      const participants = actorClaimOpen
        ? this.livingPlayers().filter(p => p !== actor)
        : [target];
      const decision = await this.requestDecision({
        participants,
        title: "Chantage de " + actor.name + " sur " + target.name,
        message: actorClaimOpen
          ? "La première accusation, réponse ou déclaration de contre est prise en compte."
          : "Le chantage continue. La cible doit choisir.",
        mode: "first",
        viewFor: player => {
          const options = [];
          if (player === target) {
            if (target.coins >= 3) options.push({ value: "pay", label: "Payer 3 pièces" });
            options.push({ value: "refuse", label: "Recevoir 3 pièces et perdre une carte" });
            if (blockAvailable) {
              options.push({ value: "block", label: "Contrer : je suis Croque-Mort" });
            }
          }
          if (actorClaimOpen) options.push({ value: "challenge", label: "Menteur !" });
          return { options };
        }
      });
      this.assertRunning();
      const { playerId, choice } = decision.first;
      actorClaimOpen = false;

      if (choice === "challenge") {
        const challenger = this.players.find(p => p.id === playerId);
        const truthful = await this.resolveChallenge(actor, "Maître-Chanteur", challenger);
        if (!truthful) return;
        continue;
      }
      if (choice === "block") {
        blockAvailable = false;
        const block = await this.challengeWindow(target, "Croque-Mort", "Contre du Croque-Mort");
        if (block.accepted) {
          this.addLog("Le Croque-Mort bloque le chantage.");
          return;
        }
        continue;
      }
      if (choice === "pay") {
        this.transfer(target, actor, 3);
        this.addLog(target.name + " paie 3 pièces à " + actor.name + ".");
        return;
      }
      this.transfer(actor, target, 3);
      this.addLog(actor.name + " donne 3 pièces à " + target.name + ".");
      this.broadcastState();
      await this.loseInfluence(target, "Refus du chantage");
      await this.settleEstates();
      return;
    }
  }

  async powerPape(actor) {
    // Ordre de la table depuis le joueur actif. Une accusation tardive annule
    // la suite de la dîme ; les paiements déjà effectués ne sont pas remboursés.
    let actorProved = false;
    const actorIndex = this.players.indexOf(actor);
    const opponents = [];
    for (let offset = 1; offset < this.players.length; offset++) {
      opponents.push(this.players[(actorIndex + offset) % this.players.length]);
    }

    for (const opponent of opponents) {
      if (!actor.isAlive) return;
      if (!opponent.isAlive) continue;
      const defense = await this.requestDecision({
        participants: [opponent],
        title: "Dîme du Pape : " + opponent.name,
        message: actor.name + " réclame une pièce. Tu peux te déclarer Pape pour être exempté.",
        viewFor: () => ({
          options: [
            { value: "pay", label: opponent.coins > 0 ? "Accepter la dîme" : "Je n'ai pas de pièce" },
            { value: "block", label: "Contrer : je suis aussi Pape" }
          ]
        })
      });
      this.assertRunning();
      let exempt = false;
      if (defense.answers.get(opponent.id) === "block") {
        const counter = await this.challengeWindow(opponent, "Pape", "Contre de " + opponent.name);
        exempt = counter.accepted;
      }
      if (!actor.isAlive) return;
      if (!actorProved) {
        const claim = await this.challengeWindow(
          actor, "Pape", "Contester le Pape avant la dîme de " + opponent.name
        );
        if (!claim.accepted || !actor.isAlive) return;
        actorProved = claim.proved;
      }
      if (opponent.isAlive && !exempt && opponent.coins > 0) {
        this.transfer(opponent, actor, 1);
        this.addLog(opponent.name + " donne une pièce à " + actor.name + ".");
        this.broadcastState();
      }
    }
  }

  async settleEstates() {
    this.assertRunning();
    // Une élimination pendant une revendication crée un héritage à traiter
    // après l'héritage courant, sans réentrer dans cette procédure.
    if (this.processingEstates) return;
    this.processingEstates = true;
    try {
      while (this.estates.length) {
        this.assertRunning();
        const estate = this.estates.shift();
        this.activeEstate = estate;
        const participants = this.livingPlayers();
        const replies = await this.requestDecision({
          participants,
          title: "Héritage de " + estate.name + " : " + estate.coins + " pièce(s)",
          message: "Les Croque-Morts peuvent se partager cet héritage.",
          viewFor: () => ({
            options: [
              { value: "claim", label: "Je suis Croque-Mort" },
              { value: "pass", label: "Ne pas revendiquer" }
            ]
          })
        });
        this.assertRunning();
        const claimants = participants.filter(p => replies.answers.get(p.id) === "claim");
        const valid = [];
        for (const claimant of claimants) {
          if (!claimant.isAlive) continue;
          const claim = await this.challengeWindow(
            claimant, "Croque-Mort", "Héritage revendiqué par " + claimant.name
          );
          if (claim.accepted) valid.push(claimant);
        }
        const survivors = valid.filter(p => p.isAlive);
        const share = survivors.length ? Math.floor(estate.coins / survivors.length) : 0;
        survivors.forEach(p => { p.coins += share; });
        this.treasure += estate.coins - share * survivors.length;
        this.activeEstate = null;
        this.addLog(survivors.length
          ? "Héritage partagé : " + share + " pièce(s) par Croque-Mort."
          : "L'héritage retourne au trésor.");
        this.broadcastState();
      }
    } finally {
      this.processingEstates = false;
    }
  }

  stop(reason, aborted) {
    if (this.phase === "ENDED") return;
    this.phase = "ENDED";
    if (this.interaction) {
      const interaction = this.interaction;
      this.interaction = null;
      this.broadcast("decisionClosed", { promptId: interaction.promptId });
      interaction.reject(new GameStopped());
    }
    if (this.pendingDraw) {
      this.deck.push(this.pendingDraw);
      this.pendingDraw = null;
      this.shuffleDeck();
    }
    // Une partie terminée ne laisse aucun héritage réservé hors du trésor.
    this.treasure += this.estates.reduce((sum, estate) => sum + estate.coins, 0);
    this.estates = [];
    if (this.activeEstate) {
      this.treasure += this.activeEstate.coins;
      this.activeEstate = null;
    }
    this.actionInProgress = null;
    const winner = aborted ? null : this.livingPlayers()[0] || null;
    this.broadcastState();
    this.broadcast("gameEnded", {
      winnerId: winner?.id || null,
      winnerName: winner?.name || null,
      aborted,
      reason
    });
    this.players.forEach(p => p.socket.leave?.(this.code));
    if (games[this.code] === this) unregisterGame(this.code);
  }

  endGame() {
    const winner = this.livingPlayers()[0];
    const reason = winner ? "Victoire de " + winner.name + " !" : "La partie est terminée.";
    this.addLog(reason);
    this.stop(reason, false);
  }

  abort(reason) {
    this.addLog(reason);
    this.stop(reason, true);
  }

  removeDisconnected(socketId) {
    const player = this.players.find(p => p.id === socketId);
    if (!player) return;
    if (this.phase === "WAITING") {
      this.players = this.players.filter(p => p !== player);
      if (!this.players.length) {
        if (games[this.code] === this) unregisterGame(this.code);
      } else {
        this.broadcastLobby();
      }
    } else if (this.phase === "IN_PROGRESS" && player.isAlive) {
      // Aucun abandon automatique ne décide du gagnant.
      this.abort(player.name + " s'est déconnecté. La partie est interrompue ; créez une nouvelle salle.");
    }
  }
}

function reply(callback, payload) {
  if (typeof callback === "function") callback(payload);
}

function validName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > 30 || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

function createApplication() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  app.use(express.static(path.join(__dirname, "../public")));

  io.on("connection", socket => {
    console.log("🔗 Connexion :", socket.id);

    socket.on("creerPartie", (rawName, callback) => {
      const name = validName(rawName);
      if (!name) return reply(callback, { ok: false, message: "Choisis un prénom de 1 à 30 caractères." });
      if (getPartieParSocketId(socket.id)) {
        return reply(callback, { ok: false, message: "Tu es déjà dans une salle." });
      }
      let code;
      do { code = nanoid(6).toUpperCase(); } while (Object.hasOwn(games, code));
      const game = new Game(code);
      game.players.push(new Player(socket, name));
      registerGame(game);
      socket.join(code);
      reply(callback, { ok: true, code, playerId: socket.id, name });
      game.broadcastLobby();
      console.log("🆕 Partie " + code + " créée par " + name);
    });

    socket.on("rejoindrePartie", (rawCode, rawName, callback) => {
      const name = validName(rawName);
      const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
      const game = Object.hasOwn(games, code) ? games[code] : null;
      if (!name) return reply(callback, { ok: false, message: "Choisis un prénom de 1 à 30 caractères." });
      if (getPartieParSocketId(socket.id)) {
        return reply(callback, { ok: false, message: "Tu es déjà dans une salle." });
      }
      if (!game) return reply(callback, { ok: false, message: "Partie introuvable." });
      if (game.phase !== "WAITING") return reply(callback, { ok: false, message: "Partie déjà lancée." });
      if (game.players.length >= MAX_PLAYERS) return reply(callback, { ok: false, message: "Partie pleine." });
      if (game.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        return reply(callback, { ok: false, message: "Ce prénom est déjà utilisé dans cette partie." });
      }
      game.players.push(new Player(socket, name));
      socket.join(code);
      reply(callback, { ok: true, code, playerId: socket.id, name });
      game.broadcastLobby();
      console.log("👤 " + name + " rejoint " + code + " (" + game.players.length + "/" + MAX_PLAYERS + ")");
      if (game.players.length === MAX_PLAYERS) game.init();
    });

    socket.on("jouerAction", (payload, callback) => {
      const game = getPartieParSocketId(socket.id);
      const player = game?.players.find(p => p.id === socket.id);
      if (!game || !player) {
        return reply(callback, { ok: false, message: "Rejoins une partie avant de jouer." });
      }
      reply(callback, game.playAction(player, payload));
    });

    socket.on("repondreDecision", (payload, callback) => {
      const game = getPartieParSocketId(socket.id);
      const player = game?.players.find(p => p.id === socket.id);
      if (!game || !player) {
        return reply(callback, { ok: false, message: "Cette partie n'est plus disponible." });
      }
      reply(callback, game.respond(player, payload));
    });

    socket.on("disconnect", () => {
      console.log("❌ Déconnexion :", socket.id);
      getPartieParSocketId(socket.id)?.removeDisconnected(socket.id);
    });
  });

  return { app, server, io };
}

if (require.main === module) {
  const { server } = createApplication();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "0.0.0.0", () => {
    console.log("🚀 Serveur démarré sur le port " + port);
  });
}

module.exports = {
  Game, Player, Card, GameStopped, createApplication,
  MAX_PLAYERS, TOTAL_COIN_POOL, ROLES, ACTIONS, FOREIGN_AID_BLOCK_ROLE
};


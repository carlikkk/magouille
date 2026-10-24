// public/client.js
// Interface de Magouille : les actions et décisions autorisées viennent du serveur.

import { renderCard, renderCardBack } from './cards.js';

const socket = io();
let playerName = '';
let playerId = null;
let roomCode = null;
let currentState = null;
let sessionVersion = 0;
let pendingLobby = null;
let pendingAction = null;
let activeDecision = null;

const etatDiv = document.getElementById('etat');
const journalDiv = document.getElementById('journal');
const actionsDiv = document.getElementById('actions');
const annoncesDiv = document.getElementById('annonces');
const votesDiv = document.getElementById('votes');
const ownCardsDiv = document.getElementById('cartes');
const ownCoinsDiv = document.getElementById('pieces');
const piocheCount = document.getElementById('nb-pioche');
const tableSlots = {
  top: document.getElementById('joueur-top'),
  right: document.getElementById('joueur-right'),
  bottom: document.getElementById('joueur-bottom'),
  left: document.getElementById('joueur-left')
};

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(label, onClick) {
  const element = textElement('button', label);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

function freezeControls(container) {
  const previous = [...container.querySelectorAll('button, input, select')]
    .map(control => ({ control, disabled: control.disabled }));
  previous.forEach(({ control }) => { control.disabled = true; });
  return () => previous.forEach(({ control, disabled }) => {
    control.disabled = disabled;
  });
}

function clearSession() {
  sessionVersion += 1;
  playerId = null;
  roomCode = null;
  currentState = null;
  pendingLobby = null;
  pendingAction = null;
  activeDecision = null;
  votesDiv.replaceChildren();
  annoncesDiv.replaceChildren();
  ownCardsDiv.textContent = 'Tes cartes seront distribuées au début de la partie.';
  ownCoinsDiv.textContent = '💰 Pièces : —';
  piocheCount.textContent = 'Pioche';
  renderCircle({ players: [] });
}

function renderLobby(message = 'Crée une salle ou rejoins tes amis avec leur code.') {
  actionsDiv.replaceChildren();
  const form = document.createElement('form');
  form.appendChild(textElement('p', message));

  const nameLabel = textElement('label', 'Ton prénom');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.name = 'playerName';
  nameInput.maxLength = 30;
  nameInput.required = true;
  nameInput.value = playerName;
  nameInput.autocomplete = 'nickname';
  nameInput.style.display = 'block';
  nameInput.style.margin = '8px 0';
  nameLabel.appendChild(nameInput);

  const codeLabel = textElement('label', 'Code de la salle à rejoindre');
  const codeInput = document.createElement('input');
  codeInput.type = 'text';
  codeInput.name = 'roomCode';
  codeInput.maxLength = 6;
  codeInput.autocomplete = 'off';
  codeInput.style.display = 'block';
  codeInput.style.margin = '8px 0';
  codeInput.style.textTransform = 'uppercase';
  codeLabel.appendChild(codeInput);

  const feedback = textElement('p', '');
  feedback.setAttribute('role', 'status');
  const create = button('Créer une partie', () => submitLobby(false));
  const join = button('Rejoindre', () => submitLobby(true));
  create.disabled = join.disabled = !socket.connected;
  form.append(nameLabel, codeLabel, create, join, feedback);
  form.addEventListener('submit', event => {
    event.preventDefault();
    submitLobby(Boolean(codeInput.value.trim()));
  });

  if (!socket.connected) {
    form.appendChild(button('Réessayer la connexion', () => socket.connect()));
  }
  actionsDiv.appendChild(form);

  function submitLobby(joining) {
    if (pendingLobby || !socket.connected || form.parentNode !== actionsDiv) return;
    const name = nameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();
    if (!name || name.length > 30) {
      feedback.textContent = 'Choisis un prénom de 1 à 30 caractères.';
      return;
    }
    if (joining && !code) {
      feedback.textContent = 'Indique le code de la salle à rejoindre.';
      return;
    }

    playerName = name;
    const request = { version: sessionVersion, form };
    pendingLobby = request;
    const restore = freezeControls(form);
    feedback.textContent = 'Connexion à la salle…';
    const onReply = response => {
      if (pendingLobby !== request || request.version !== sessionVersion) return;
      pendingLobby = null;
      if (!response?.ok) {
        if (form.parentNode === actionsDiv) {
          restore();
          feedback.textContent = response?.message || 'Impossible de rejoindre la salle.';
        }
        return;
      }
      playerId = response.playerId;
      playerName = response.name;
      roomCode = response.code;
      journalDiv.textContent = '';
      if (form.parentNode === actionsDiv) {
        actionsDiv.replaceChildren(textElement('p', 'En attente des autres joueurs…'));
      }
      etatDiv.textContent = `🎲 Salle ${roomCode}`;
    };
    if (joining) socket.emit('rejoindrePartie', code, name, onReply);
    else socket.emit('creerPartie', name, onReply);
  }
}

socket.on('connect', () => {
  clearSession();
  etatDiv.textContent = 'Connecté — bienvenue dans Magouille.';
  renderLobby();
});

socket.on('disconnect', () => {
  const wasInRoom = Boolean(roomCode);
  clearSession();
  etatDiv.textContent = 'Connexion interrompue.';
  renderLobby(wasInRoom
    ? 'Ta connexion à la salle est perdue. Après reconnexion, crée ou rejoins une nouvelle salle.'
    : 'En attente de reconnexion au serveur…');
});

socket.on('connect_error', () => {
  etatDiv.textContent = 'Le serveur est indisponible. Nouvelle tentative de connexion en cours…';
});

socket.on('etatSalle', ({ code, joueurs, maxPlayers }) => {
  roomCode = code;
  playerId = playerId || socket.id;
  currentState = null;
  pendingAction = null;
  activeDecision = null;
  ownCardsDiv.textContent = 'Tes cartes seront distribuées au début de la partie.';
  ownCoinsDiv.textContent = '💰 Pièces : —';
  piocheCount.textContent = 'Pioche';
  etatDiv.textContent = `🎲 Salle ${code} — ${joueurs.length}/${maxPlayers} joueurs : ${joueurs.join(', ')}`;
  actionsDiv.replaceChildren(textElement('p', `La partie commencera à ${maxPlayers} joueurs.`));
  votesDiv.replaceChildren();
  Object.values(tableSlots).forEach((slot, index) => {
    slot.replaceChildren(textElement('strong', joueurs[index] || 'Place libre'));
  });
});

socket.on('stateUpdate', state => {
  currentState = state;
  roomCode = state.code || roomCode;
  playerId = playerId || socket.id;
  const me = state.players.find(p => p.id === playerId);
  if (me) playerName = me.name;
  renderCircle(state);
  piocheCount.textContent = `${state.deckCount} carte${state.deckCount > 1 ? 's' : ''}`;
  ownCardsDiv.textContent = me
    ? `🃏 Tes cartes : ${me.hand.join(' / ') || 'aucune'}`
    : '🃏 Tes cartes : —';
  ownCoinsDiv.textContent = `💰 Tes pièces : ${me?.coins ?? '—'} · Trésor : ${state.treasure}`;

  if (pendingAction && (state.turnId !== pendingAction.turnId || !state.actions.length)) {
    pendingAction = null;
  }
  if (state.phase === 'IN_PROGRESS') {
    const active = state.players.find(p => p.id === state.currentPlayerId);
    etatDiv.textContent = `🎯 Tour de ${active?.name || '—'} · Salle ${roomCode}`;
  }
  renderActions(state);
});

function renderActions(state) {
  actionsDiv.replaceChildren();
  if (state.phase !== 'IN_PROGRESS') return;
  if (!state.actions.length) {
    actionsDiv.appendChild(textElement('p', state.currentPlayerId === playerId
      ? 'Action en cours. Suis les indications dans la zone Vote.'
      : 'Les actions apparaîtront à ton tour.'));
    return;
  }

  const panel = document.createElement('div');
  const targetSelect = document.createElement('select');
  targetSelect.setAttribute('aria-label', 'Joueur ciblé');
  targetSelect.appendChild(textElement('option', 'Choisir une cible'));
  targetSelect.firstChild.value = '';
  state.players.filter(p => p.isAlive && p.id !== playerId).forEach(p => {
    const option = textElement('option', p.name);
    option.value = p.id;
    targetSelect.appendChild(option);
  });
  if (state.actions.some(action => action.targetable)) {
    const label = textElement('label', 'Cible pour une action ciblée : ');
    label.appendChild(targetSelect);
    panel.appendChild(label);
  }

  const feedback = textElement('p', '');
  feedback.setAttribute('role', 'status');
  state.actions.forEach(option => {
    const row = document.createElement('div');
    const control = button(option.label, () => {
      if (pendingAction || option.disabled || panel.parentNode !== actionsDiv) return;
      const targetId = option.targetable ? targetSelect.value : null;
      if (option.targetable && !targetId) {
        feedback.textContent = 'Choisis un autre joueur encore en vie dans la liste.';
        return;
      }
      if (!socket.connected) {
        feedback.textContent = 'La connexion au serveur est interrompue.';
        return;
      }

      const request = { version: sessionVersion, turnId: state.turnId, panel };
      pendingAction = request;
      const restore = freezeControls(panel);
      feedback.textContent = 'Envoi de l’action…';
      socket.emit('jouerAction', {
        action: option.action, targetId, turnId: state.turnId
      }, response => {
        if (pendingAction !== request || request.version !== sessionVersion) return;
        pendingAction = null;
        if (panel.parentNode !== actionsDiv) return;
        if (!response?.ok) {
          restore();
          feedback.textContent = response?.message || 'Cette action a été refusée.';
        } else {
          panel.replaceChildren(textElement('p', 'Action envoyée. En attente de sa résolution…'));
        }
      });
    });
    control.disabled = Boolean(option.disabled);
    control.title = option.reason || option.label;
    row.appendChild(control);
    if (option.disabled && option.reason) row.appendChild(textElement('small', option.reason));
    panel.appendChild(row);
  });
  panel.appendChild(feedback);
  actionsDiv.appendChild(panel);
}

socket.on('nouveauTour', ({ joueurActif, turnId }) => {
  if (currentState && currentState.turnId !== turnId) return;
  etatDiv.textContent = `🎯 Tour de ${joueurActif} · Salle ${roomCode}`;
  annoncesDiv.replaceChildren();
});

socket.on('actionAnnoncee', ({ joueur, description, cible }) => {
  annoncesDiv.appendChild(textElement('p', `🗣️ ${joueur} annonce ${description}${cible ? ' ➜ ' + cible : ''}`));
});

socket.on('logUpdate', line => {
  journalDiv.textContent += line + '\n';
  journalDiv.scrollTop = journalDiv.scrollHeight;
});

function decisionPanel({ promptId, title, message }) {
  const panel = document.createElement('div');
  panel.appendChild(textElement('h4', title));
  if (message) panel.appendChild(textElement('p', message));
  const feedback = textElement('p', 'En attente des joueurs concernés…');
  feedback.setAttribute('role', 'status');
  panel.appendChild(feedback);
  const decision = { promptId, panel, feedback, version: sessionVersion, pending: false };
  activeDecision = decision;
  votesDiv.replaceChildren(panel);
  return decision;
}

socket.on('decisionStatus', prompt => { decisionPanel(prompt); });

socket.on('decisionDemand', prompt => {
  const decision = decisionPanel(prompt);
  const { panel, feedback } = decision;
  feedback.textContent = 'À toi de répondre.';
  const controls = document.createElement('div');
  panel.insertBefore(controls, feedback);

  if (prompt.kind === 'cards') {
    const selected = new Set();
    const cardButtons = [];
    const hint = textElement('p', `Choisis ${prompt.count} carte${prompt.count > 1 ? 's' : ''}.`);
    controls.appendChild(hint);
    const confirm = button('Valider la sélection', () => {
      if (selected.size === prompt.count) submitDecision(decision, { indices: [...selected] });
    });
    confirm.disabled = true;
    prompt.cards.forEach((role, index) => {
      const cardButton = button('', () => {
        if (decision.pending || activeDecision !== decision) return;
        if (selected.has(index)) selected.delete(index);
        else if (selected.size < prompt.count) selected.add(index);
        else {
          feedback.textContent = 'Désélectionne une carte avant d’en choisir une autre.';
          return;
        }
        cardButtons.forEach((control, i) => {
          const chosen = selected.has(i);
          control.setAttribute('aria-pressed', String(chosen));
          control.style.outline = chosen ? '3px solid #ffd700' : '';
        });
        confirm.disabled = selected.size !== prompt.count;
        feedback.textContent = `${selected.size}/${prompt.count} carte${prompt.count > 1 ? 's' : ''} sélectionnée${prompt.count > 1 ? 's' : ''}.`;
      });
      cardButton.setAttribute('aria-pressed', 'false');
      cardButton.append(renderCard(role), textElement('div', `Carte ${index + 1} : ${role}`));
      cardButtons.push(cardButton);
      controls.appendChild(cardButton);
    });
    controls.appendChild(confirm);
  } else {
    prompt.options.forEach(option => {
      controls.appendChild(button(option.label, () => {
        submitDecision(decision, { choice: option.value });
      }));
    });
  }
});

function submitDecision(decision, answer) {
  if (activeDecision !== decision || decision.pending || !socket.connected) return;
  decision.pending = true;
  const restore = freezeControls(decision.panel);
  decision.feedback.textContent = 'Envoi de ta réponse…';
  socket.emit('repondreDecision', { promptId: decision.promptId, ...answer }, response => {
    if (
      activeDecision !== decision || decision.version !== sessionVersion ||
      decision.panel.parentNode !== votesDiv
    ) return;
    if (!response?.ok) {
      decision.pending = false;
      restore();
      decision.feedback.textContent = response?.message || 'Cette réponse a été refusée.';
    } else {
      decision.feedback.textContent = 'Réponse envoyée. En attente des autres joueurs…';
    }
  });
}

socket.on('decisionClosed', ({ promptId }) => {
  if (activeDecision?.promptId !== promptId) return;
  activeDecision = null;
  votesDiv.replaceChildren();
});

socket.on('gameEnded', ({ winnerName, aborted, reason }) => {
  sessionVersion += 1;
  pendingAction = null;
  pendingLobby = null;
  activeDecision = null;
  roomCode = null;
  votesDiv.replaceChildren();
  const result = aborted
    ? `⛔ ${reason || 'La partie est interrompue.'}`
    : winnerName ? `🏆 Victoire de ${winnerName} !` : reason || 'La partie est terminée.';
  etatDiv.textContent = result;
  annoncesDiv.appendChild(textElement('p', result));
  renderLobby('La partie est terminée. Tu peux créer ou rejoindre une nouvelle salle.');
});

function renderCircle(state) {
  ['top', 'right', 'bottom', 'left'].forEach((position, i) => {
    const slot = tableSlots[position];
    slot.replaceChildren();
    const p = state.players[i];
    if (!p) {
      slot.textContent = 'Absent';
      return;
    }
    const content = document.createElement('div');
    content.style.textAlign = 'center';
    const name = textElement('strong', `${p.name}${p.isAlive ? '' : ' — Éliminé'}`);
    const coins = textElement('div', `💰 ${p.coins}`, 'pieces');
    const cards = document.createElement('div');
    cards.className = 'cartes';
    cards.style.display = 'flex';
    cards.style.justifyContent = 'center';
    const isMe = p.id === playerId;
    p.hand.forEach(role => {
      cards.appendChild(isMe && typeof role === 'string' ? renderCard(role) : renderCardBack());
    });
    p.revealed.forEach(role => {
      const card = renderCard(role);
      card.style.opacity = '0.55';
      card.style.filter = 'grayscale(1)';
      card.title = `Carte perdue : ${role}`;
      cards.appendChild(card);
    });
    content.append(name, coins, cards);
    if (p.revealed.length) content.appendChild(textElement('small', 'En grisé : cartes perdues'));
    slot.appendChild(content);
  });
}

clearSession();
etatDiv.textContent = socket.connected ? 'Connecté — bienvenue dans Magouille.' : 'Connexion au serveur…';
renderLobby();

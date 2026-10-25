// public/client.js
// Présentation de Magouille. Le serveur reste seul responsable des règles et des choix autorisés.
import { renderCard, renderCardBack, ROLE_DETAILS, createIcon } from './cards.js?v=salon-1';

const socket = io();
const $ = id => document.getElementById(id);
const ui = {
  lobby: $('lobby-view'), play: $('play-view'), lobbyActions: $('lobby-actions'),
  connection: $('connection-status'), indicator: $('connection-indicator'),
  roomChip: $('room-chip'), roomCode: $('room-code'), copyRoom: $('copy-room'),
  waiting: $('waiting-panel'), waitingCount: $('waiting-count'), waitingCode: $('waiting-code'),
  waitingCopy: $('waiting-copy'), waitingHint: $('waiting-hint'), tableEmpty: $('table-empty'),
  caption: $('table-caption'), status: $('table-status'), state: $('etat'),
  deck: $('nb-pioche'), treasury: $('treasure-count'), announcements: $('annonces'),
  handSummary: $('hand-summary'), ownCards: $('cartes'), ownCoins: $('pieces'),
  privacy: $('privacy-toggle'), actions: $('actions'), actionHeading: $('action-heading'),
  actionSubtitle: $('action-subtitle'), decisions: $('decision-section'), votes: $('votes'),
  journal: $('journal'), logCount: $('log-count'), journalPanel: $('journal-panel'),
  toasts: $('toast-region'), banner: $('turn-banner'),
  dialog: $('game-dialog'), dialogContent: $('dialog-content'), dialogClose: $('dialog-close'),
  sound: $('sound-toggle'), soundLabel: $('sound-label')
};
const tableSlots = {
  bottom: $('joueur-bottom'), left: $('joueur-left'),
  top: $('joueur-top'), right: $('joueur-right')
};
const seatPositions = ['bottom', 'left', 'top', 'right'];
const baseActions = {
  Revenu: { icon: 'coins', short: 'Une pièce, sans contestation.', effect: 'Prends 1 pièce au trésor. Cette action ne peut pas être contestée.', cost: '+1 pièce' },
  'Aide étrangère': { icon: 'hand', short: 'Deux pièces, à condition de passer.', effect: "Prends 2 pièces au trésor. Un adversaire peut se déclarer Illusionniste pour bloquer cette aide.", cost: '+2 pièces' },
  Assassinat: { icon: 'dagger', short: 'Une influence en moins pour ta cible.', effect: "Paie 7 pièces au trésor. Ta cible perd une influence. L'assassinat ne peut être ni contesté, ni contré.", cost: '7 pièces' }
};

function stored(key, fallback = '') {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function remember(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* Le stockage est facultatif. */ }
}
function inviteCode() {
  try { return (new URL(location.href).searchParams.get('room') || '').trim().toUpperCase().slice(0, 6); }
  catch { return ''; }
}
let nameDraft = stored('magouille.nickname').slice(0, 30);
let codeDraft = inviteCode();
let lobbyMode = codeDraft ? 'join' : 'create';
let playerName = '';
let playerId = null;
let roomCode = null;
let currentState = null;
let sessionVersion = 0;
let pendingLobby = null;
let pendingAction = null;
let selectedAction = null;
let activeDecision = null;
let hasConnected = false;
let disconnectedFromRoom = false;
let lastTurnNotified = null;
let hiddenHand = stored('magouille.hideHand') === 'true';
let soundEnabled = stored('magouille.sound') === 'true';
let audioContext = null;
let dialogKind = null;
let dialogOpener = null;
let privateInspection = null;
let bannerTimer = null;
let logTotal = 0;
const knownPlayers = new Set();

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  if (text !== '') node.textContent = text;
  if (className) node.className = className;
  return node;
}
function makeButton(label, onClick, className = 'button button-secondary', iconName) {
  const node = element('button', '', className);
  node.type = 'button';
  if (iconName) node.appendChild(createIcon(iconName));
  node.appendChild(element('span', label));
  if (onClick) node.addEventListener('click', onClick);
  return node;
}
function freezeControls(container) {
  const previous = [...container.querySelectorAll('button, input, select')]
    .map(control => ({ control, disabled: control.disabled }));
  previous.forEach(item => { item.control.disabled = true; });
  return () => previous.forEach(item => { item.control.disabled = item.disabled; });
}
function setScreen(screen) {
  document.body.dataset.screen = screen;
  const isLobby = screen === 'lobby' || screen === 'ended';
  ui.lobby.hidden = !isLobby;
  ui.play.hidden = isLobby;
  ui.waiting.hidden = screen !== 'waiting';
  ui.handSummary.hidden = screen !== 'game';
  if (ui.tableEmpty) ui.tableEmpty.hidden = screen !== 'waiting';
}
function connectionState(state) {
  ui.indicator.dataset.state = state;
  ui.connection.textContent = { connected: 'En ligne', connecting: 'Connexion…', offline: 'Hors ligne' }[state];
}
function updateRoom() {
  ui.roomChip.hidden = !roomCode;
  ui.roomCode.textContent = roomCode || '';
  ui.caption.textContent = roomCode ? 'Salon ' + roomCode : 'Salon privé';
}
function toast(message, tone = 'neutral') {
  const node = element('div', '', 'toast');
  node.dataset.tone = tone;
  node.append(createIcon(tone === 'danger' ? 'cross' : tone === 'success' ? 'check' : 'spark'), element('span', message));
  ui.toasts.appendChild(node);
  while (ui.toasts.children.length > 3) ui.toasts.firstChild.remove();
  setTimeout(() => node.remove(), 5200);
}
function pulseTurn() {
  clearTimeout(bannerTimer);
  ui.banner.textContent = 'À toi de jouer';
  ui.banner.classList.add('is-visible');
  bannerTimer = setTimeout(() => ui.banner.classList.remove('is-visible'), 2400);
}

function prepareAudio() {
  if (!soundEnabled) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!audioContext) audioContext = new Audio();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch { /* Le son ne doit jamais empêcher de jouer. */ }
}
function playSound(kind) {
  if (!soundEnabled || !audioContext || audioContext.state !== 'running') return;
  try {
    const notes = kind === 'turn' ? [392, 587] : kind === 'win' ? [392, 494, 587] : [523];
    notes.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = audioContext.currentTime + index * 0.12;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.035, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.17);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.19);
    });
  } catch { /* Option purement visuelle/sonore, sans impact sur le protocole. */ }
}
function updateSound() {
  ui.sound.setAttribute('aria-pressed', String(soundEnabled));
  ui.sound.setAttribute('aria-label', soundEnabled ? 'Désactiver le son' : 'Activer le son');
  ui.sound.title = soundEnabled ? 'Désactiver le son' : 'Activer le son';
  ui.sound.replaceChildren(createIcon(soundEnabled ? 'volume' : 'volumeOff'));
  const label = element('span', soundEnabled ? 'Son activé' : 'Son coupé');
  label.id = 'sound-label';
  ui.sound.appendChild(label);
}
ui.sound.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  remember('magouille.sound', soundEnabled);
  updateSound();
  prepareAudio();
  if (soundEnabled) setTimeout(() => playSound('decision'), 70);
});
document.addEventListener('pointerdown', prepareAudio, { once: true });
document.addEventListener('keydown', prepareAudio, { once: true });

function afterDialogClose() {
  const opener = dialogOpener;
  dialogKind = null;
  dialogOpener = null;
  privateInspection = null;
  ui.dialogContent.replaceChildren();
  if (opener?.isConnected && !opener.disabled) opener.focus({ preventScroll: true });
}
function closeDialog() {
  if (ui.dialog.open && typeof ui.dialog.close === 'function') ui.dialog.close();
  else ui.dialog.removeAttribute('open');
  afterDialogClose();
}
function showDialog(content, kind = 'guide', opener = document.activeElement) {
  if (!ui.dialog.open) dialogOpener = opener;
  dialogKind = kind;
  if (kind !== 'private-card') privateInspection = null;
  ui.dialogContent.replaceChildren(content);
  const title = content.querySelector('h2');
  if (title) {
    title.id = 'dynamic-dialog-title';
    ui.dialog.setAttribute('aria-labelledby', title.id);
  }
  if (!ui.dialog.open) {
    if (typeof ui.dialog.showModal === 'function') ui.dialog.showModal();
    else ui.dialog.setAttribute('open', '');
  }
}
ui.dialogClose.addEventListener('click', closeDialog);
ui.dialog.addEventListener('close', () => {
  // Un ancien événement close peut arriver après l'ouverture d'un nouveau résultat.
  if (!ui.dialog.open) afterDialogClose();
});
ui.dialog.addEventListener('click', event => {
  if (event.target !== ui.dialog) return;
  const bounds = ui.dialog.getBoundingClientRect();
  if (
    event.clientX < bounds.left || event.clientX > bounds.right ||
    event.clientY < bounds.top || event.clientY > bounds.bottom
  ) closeDialog();
});
function roleText(role) {
  return ROLE_DETAILS[role] || { name: role, short: '', effect: '', note: '', icon: 'spark', clan: '' };
}
function inspectCard(role, opener, inspection = null) {
  const detail = roleText(role);
  const content = element('div', '', 'card-detail');
  content.appendChild(renderCard(role));
  const copy = element('div', '', 'role-copy');
  copy.append(
    element('p', detail.clan, 'dialog-eyebrow'),
    element('h2', detail.name, 'dialog-title'),
    element('p', detail.effect, 'role-description')
  );
  if (detail.note) copy.appendChild(element('p', detail.note, 'role-note'));
  content.appendChild(copy);
  privateInspection = inspection;
  showDialog(content, inspection ? 'private-card' : 'public-card', opener);
}
function openGuide() {
  const content = element('div');
  content.append(
    element('p', 'Le petit livre des intrigues', 'dialog-eyebrow'),
    element('h2', 'Les règles du salon', 'dialog-title'),
    element('p', 'Garde tes cartes secrètes. Lis les autres. Et choisis le bon moment pour bluffer.', 'dialog-lead')
  );
  const basics = element('div', '', 'guide-basics');
  [
    ['users', 'Quatre autour de la table', 'La partie commence automatiquement à 4 joueurs, avec 2 cartes et 2 pièces chacun.'],
    ['mask', 'Le bluff est permis', "Tu peux annoncer un rôle que tu n'as pas. Une accusation peut te coûter une influence, ou en coûter une à ton accusateur."],
    ['dagger', 'Le poids des pièces', "L'assassinat coûte 7 pièces. Avec 10 pièces ou plus, il devient obligatoire."],
    ['crown', 'La dernière influence', 'Le dernier joueur encore en jeu gagne. Une carte perdue reste visible pour toute la table.']
  ].forEach(([icon, title, text]) => {
    const item = element('div', '', 'guide-basic');
    item.append(createIcon(icon), element('h3', title), element('p', text));
    basics.appendChild(item);
  });
  content.append(basics, element('h3', 'Les cinq rôles', 'guide-section-title'));
  const grid = element('div', '', 'role-grid');
  Object.values(ROLE_DETAILS).forEach(detail => {
    const reference = element('article', '', 'role-reference');
    const portrait = element('div', '', 'role-portrait');
    portrait.appendChild(renderCard(detail.name));
    const copy = element('div', '', 'role-copy');
    copy.append(element('p', detail.clan, 'role-tag'), element('h3', detail.name, 'role-name'), element('p', detail.effect, 'role-description'));
    if (detail.note) copy.appendChild(element('p', detail.note, 'role-note'));
    reference.append(portrait, copy);
    grid.appendChild(reference);
  });
  content.appendChild(grid);
  showDialog(content, 'guide');
}
['guide-toggle', 'help-inline', 'lobby-guide'].forEach(id => $(id)?.addEventListener('click', openGuide));

async function copyRoom() {
  const code = roomCode;
  if (!code) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(code);
    if (roomCode === code) toast('Code du salon copié : ' + code, 'success');
  } catch {
    if (roomCode !== code) return;
    const content = element('div', '', 'copy-fallback');
    content.append(element('p', 'Inviter tes amis', 'dialog-eyebrow'), element('h2', 'Le code du salon', 'dialog-title'),
      element('p', 'Copie ce code et partage-le avec les autres joueurs.', 'dialog-lead'));
    const input = element('input', '', 'field-input');
    input.value = code;
    input.readOnly = true;
    input.setAttribute('aria-label', 'Code du salon');
    content.appendChild(input);
    showDialog(content, 'copy');
    input.focus();
    input.select();
  }
}
ui.copyRoom.addEventListener('click', copyRoom);
ui.waitingCopy.addEventListener('click', copyRoom);

function updatePrivacy() {
  ui.privacy.setAttribute('aria-pressed', String(hiddenHand));
  ui.privacy.setAttribute('aria-label', hiddenHand ? 'Montrer mes cartes' : 'Masquer mes cartes');
  ui.privacy.replaceChildren(createIcon(hiddenHand ? 'eye' : 'lock'), element('span', hiddenHand ? 'Montrer ma main' : 'Masquer ma main'));
  const me = currentState?.players.find(p => p.id === playerId);
  ui.ownCards.textContent = me
    ? me.isAlive ? me.hand.length + ' influence' + (me.hand.length > 1 ? 's' : '') + ' en jeu · ' + (hiddenHand ? 'main masquée' : 'visible pour toi seulement') : 'Tes cartes sont désormais révélées.'
    : 'Tes cartes seront distribuées au début de la partie.';
}
ui.privacy.addEventListener('click', () => {
  hiddenHand = !hiddenHand;
  remember('magouille.hideHand', hiddenHand);
  if (hiddenHand && dialogKind === 'private-card') closeDialog();
  updatePrivacy();
  if (currentState) renderCircle(currentState, currentState);
});

function resetSession() {
  sessionVersion += 1;
  clearTimeout(bannerTimer);
  bannerTimer = null;
  ui.banner.classList.remove('is-visible');
  playerId = null;
  roomCode = null;
  currentState = null;
  pendingLobby = null;
  pendingAction = null;
  selectedAction = null;
  activeDecision = null;
  lastTurnNotified = null;
  knownPlayers.clear();
  closeDialog();
  ui.votes.replaceChildren();
  ui.decisions.hidden = true;
  ui.announcements.textContent = 'Les meilleures intentions cachent parfois un beau mensonge.';
  ui.actions.replaceChildren();
  ui.ownCoins.textContent = '—';
  ui.deck.textContent = '—';
  ui.treasury.textContent = '—';
  updateRoom();
  updatePrivacy();
  renderWaitingSeats([]);
}
function renderLobby(message = '') {
  ui.lobbyActions.replaceChildren();
  const container = element('div');
  const tabs = element('div', '', 'lobby-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Entrer dans le salon');
  const createTab = makeButton('Créer un salon', () => switchMode('create'), 'lobby-tab');
  const joinTab = makeButton('Rejoindre', () => switchMode('join'), 'lobby-tab');
  [createTab, joinTab].forEach((tab, index) => {
    const mode = index ? 'join' : 'create';
    tab.id = 'lobby-' + mode + '-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(lobbyMode === mode));
    tab.setAttribute('aria-controls', 'lobby-form-panel');
    tab.tabIndex = lobbyMode === mode ? 0 : -1;
    tab.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        switchMode(mode === 'create' ? 'join' : 'create', true);
      }
    });
  });
  tabs.append(createTab, joinTab);
  const form = element('form', '', 'lobby-form');
  form.id = 'lobby-form-panel';
  form.setAttribute('role', 'tabpanel');
  form.setAttribute('aria-labelledby', 'lobby-' + lobbyMode + '-tab');
  form.noValidate = true;
  const joining = lobbyMode === 'join';
  form.appendChild(element('h2', joining ? 'Ta place t’attend.' : 'Ouvre les portes du salon.', 'lobby-form-heading'));
  const nameField = element('label', '', 'field');
  nameField.appendChild(element('span', 'Ton prénom', 'field-label'));
  const nameInput = element('input', '', 'field-input');
  nameInput.name = 'playerName';
  nameInput.type = 'text';
  nameInput.maxLength = 30;
  nameInput.required = true;
  nameInput.autocomplete = 'nickname';
  nameInput.placeholder = 'Comment doit-on t’appeler ?';
  nameInput.value = nameDraft;
  nameInput.addEventListener('input', () => { nameDraft = nameInput.value; });
  nameField.appendChild(nameInput);
  form.appendChild(nameField);
  let codeInput = null;
  if (joining) {
    const codeField = element('label', '', 'field join-code-field');
    codeField.appendChild(element('span', 'Le code du salon', 'field-label'));
    codeInput = element('input', '', 'field-input');
    codeInput.name = 'roomCode';
    codeInput.type = 'text';
    codeInput.maxLength = 6;
    codeInput.required = true;
    codeInput.autocomplete = 'off';
    codeInput.autocapitalize = 'characters';
    codeInput.spellcheck = false;
    codeInput.placeholder = '6 caractères';
    codeInput.value = codeDraft;
    codeInput.addEventListener('input', () => { codeDraft = codeInput.value; });
    codeField.appendChild(codeInput);
    form.appendChild(codeField);
  }
  const feedback = element('p', message || (!socket.connected ? 'Connexion au serveur en cours…' : ''), 'form-feedback');
  feedback.setAttribute('role', 'status');
  const submit = makeButton(joining ? 'Rejoindre la partie' : 'Créer une partie', null, 'button button-primary lobby-submit', 'arrowRight');
  submit.type = 'submit';
  submit.disabled = !socket.connected;
  form.append(submit, feedback, element('p', joining ? 'Demande le code à la personne qui a créé le salon.' : 'Quatre joueurs. Un code à partager. La partie peut commencer.', 'form-footer'));
  if (!socket.connected) form.appendChild(makeButton('Réessayer la connexion', () => socket.connect(), 'button button-ghost'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!socket.connected || pendingLobby || container.parentNode !== ui.lobbyActions) return;
    const name = nameInput.value.trim();
    const code = joining ? codeInput.value.trim().toUpperCase() : '';
    if (!name || name.length > 30) {
      feedback.textContent = 'Choisis un prénom de 1 à 30 caractères.';
      nameInput.focus();
      return;
    }
    if (joining && code.length !== 6) {
      feedback.textContent = 'Le code du salon contient 6 caractères.';
      codeInput.focus();
      return;
    }
    prepareAudio();
    nameDraft = name;
    const request = { version: sessionVersion, container };
    pendingLobby = request;
    const restore = freezeControls(container);
    feedback.textContent = joining ? 'Nous cherchons ton salon…' : 'Nous préparons le salon…';
    const onReply = response => {
      if (pendingLobby !== request || request.version !== sessionVersion) return;
      pendingLobby = null;
      if (!response?.ok) {
        if (container.parentNode === ui.lobbyActions) {
          restore();
          feedback.textContent = response?.message || 'Le salon est indisponible. Réessaie.';
        }
        return;
      }
      playerId = response.playerId;
      playerName = response.name;
      nameDraft = playerName;
      roomCode = response.code;
      codeDraft = '';
      remember('magouille.nickname', playerName);
      ui.journal.replaceChildren();
      logTotal = 0;
      ui.logCount.textContent = '0';
      setScreen('waiting');
      updateRoom();
      ui.state.textContent = 'Le salon est ouvert.';
      ui.status.textContent = 'En attendant les convives';
      ui.waitingCode.textContent = roomCode;
    };
    if (joining) socket.emit('rejoindrePartie', code, name, onReply);
    else socket.emit('creerPartie', name, onReply);
  });
  container.append(tabs, form);
  ui.lobbyActions.appendChild(container);

  function switchMode(mode, focus = false) {
    if (pendingLobby) return;
    lobbyMode = mode;
    renderLobby();
    if (focus) $('lobby-' + mode + '-tab')?.focus();
  }
}

function relativePlayers(players, isWaiting = false) {
  const index = players.findIndex(p => isWaiting ? p.name === playerName : p.id === playerId);
  const start = index < 0 ? 0 : index;
  return seatPositions.map((position, offset) => ({
    position, player: players[(start + offset) % Math.max(players.length, 1)],
    originalIndex: (start + offset) % Math.max(players.length, 1)
  })).map((seat, index) => index < players.length ? seat : { ...seat, player: null });
}
function emptySeat(slot) {
  slot.className = 'player-slot is-empty';
  slot.removeAttribute('data-player-id');
  slot.removeAttribute('data-seat');
  slot.removeAttribute('role');
  slot.removeAttribute('aria-pressed');
  slot.onclick = null;
  slot.onkeydown = null;
  slot.tabIndex = -1;
  slot.setAttribute('aria-label', 'Place libre');
  const content = element('div', '', 'player-content');
  content.append(createIcon('users', { className: 'empty-seat-icon', size: 24 }), element('p', 'Place libre', 'player-name'), element('span', 'Un complice se fait attendre', 'player-badge'));
  slot.replaceChildren(content);
}
function renderWaitingSeats(names) {
  relativePlayers(names.map(name => ({ name })), true).forEach(({ position, player, originalIndex }) => {
    const slot = tableSlots[position];
    if (!player) return emptySeat(slot);
    const isMe = player.name === playerName;
    slot.className = 'player-slot' + (isMe ? ' is-me' : '');
    slot.dataset.seat = String(originalIndex);
    slot.removeAttribute('data-player-id');
    slot.removeAttribute('role');
    slot.removeAttribute('aria-pressed');
    slot.onclick = null;
    slot.onkeydown = null;
    slot.tabIndex = -1;
    slot.setAttribute('aria-label', player.name + (isMe ? ', toi' : ''));
    const content = element('div', '', 'player-content');
    const meta = element('div', '', 'player-meta');
    const identity = element('div', '', 'player-identity');
    identity.append(element('strong', player.name, 'player-name'), element('span', isMe ? 'Toi · prêt à jouer' : 'A rejoint le salon', 'player-badge'));
    meta.append(element('span', player.name.slice(0, 1).toLocaleUpperCase('fr'), 'avatar'), identity);
    content.appendChild(meta);
    slot.replaceChildren(content);
  });
}
function targetableNow() {
  if (!selectedAction || !currentState || pendingAction || currentState.turnId !== selectedAction.turnId) return false;
  const option = currentState.actions.find(action => action.action === selectedAction.action);
  return Boolean(option && !option.disabled && option.targetable);
}
function renderCircle(state, previous = null) {
  relativePlayers(state.players).forEach(({ position, player: p, originalIndex }) => {
    const slot = tableSlots[position];
    if (!p) return emptySeat(slot);
    const isMe = p.id === playerId;
    const isActive = state.phase === 'IN_PROGRESS' && p.id === state.currentPlayerId;
    const canTarget = targetableNow() && !isMe && p.isAlive;
    const isTarget = canTarget && selectedAction.targetId === p.id;
    const oldPlayer = previous?.players.find(item => item.id === p.id);
    slot.className = ['player-slot', isMe && 'is-me', isActive && 'is-active', !p.isAlive && 'is-eliminated', canTarget && 'can-target', isTarget && 'is-target', !knownPlayers.has(p.id) && 'is-arriving'].filter(Boolean).join(' ');
    knownPlayers.add(p.id);
    slot.dataset.playerId = p.id;
    slot.dataset.seat = String(originalIndex);
    if (canTarget) {
      slot.setAttribute('role', 'button');
      slot.setAttribute('aria-pressed', String(isTarget));
    } else {
      slot.removeAttribute('role');
      slot.removeAttribute('aria-pressed');
    }
    slot.setAttribute('aria-label', p.name + (isMe ? ', toi' : '') + (canTarget ? ', sélectionner comme cible' : ''));
    slot.tabIndex = canTarget ? 0 : -1;
    slot.onclick = canTarget ? event => {
      if (!event.target.closest('button')) selectTarget(p.id);
    } : null;
    slot.onkeydown = canTarget ? event => {
      if (event.target === slot && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        selectTarget(p.id);
      }
    } : null;
    const content = element('div', '', 'player-content');
    const meta = element('div', '', 'player-meta');
    const identity = element('div', '', 'player-identity');
    const tags = element('div', '', 'player-tags');
    if (isMe) tags.appendChild(element('span', 'Toi', 'player-badge'));
    if (!p.isAlive) tags.appendChild(element('span', 'Éliminé', 'player-badge'));
    else if (isActive) tags.appendChild(element('span', 'À son tour', 'player-badge is-turn'));
    identity.append(element('strong', p.name, 'player-name'), tags);
    const coins = element('span', '', 'player-coins' + (oldPlayer && oldPlayer.coins !== p.coins ? ' coin-bump' : ''));
    coins.append(createIcon('coins', { size: 15 }), element('span', String(p.coins)));
    coins.setAttribute('aria-label', p.coins + ' pièces');
    meta.append(element('span', p.name.slice(0, 1).toLocaleUpperCase('fr'), 'avatar'), identity, coins);
    const cards = element('div', '', 'player-cards');
    p.hand.forEach((role, index) => {
      const wrapper = element('div', '', 'hand-card' + ((!oldPlayer || index >= oldPlayer.hand.length) ? ' card-enter' : ''));
      if (isMe && !hiddenHand && typeof role === 'string') {
        const inspect = makeButton('', null, 'card-inspect');
        inspect.replaceChildren(renderCard(role));
        inspect.setAttribute('aria-label', 'Consulter ta carte ' + role);
        inspect.addEventListener('click', () => inspectCard(role, inspect, { playerId: p.id, index, role }));
        wrapper.appendChild(inspect);
      } else {
        wrapper.appendChild(renderCardBack());
      }
      cards.appendChild(wrapper);
    });
    p.revealed.forEach(role => {
      const wrapper = element('div', '', 'hand-card is-revealed');
      const inspect = makeButton('', null, 'card-inspect');
      inspect.replaceChildren(renderCard(role));
      inspect.setAttribute('aria-label', 'Carte perdue : ' + role);
      inspect.addEventListener('click', () => inspectCard(role, inspect));
      wrapper.append(inspect, element('span', 'Révélée', 'card-caption'));
      cards.appendChild(wrapper);
    });
    const pips = element('div', '', 'influence-pips');
    pips.setAttribute('aria-label', p.hand.length + ' influence' + (p.hand.length > 1 ? 's restantes' : ' restante'));
    [...p.hand.map(() => false), ...p.revealed.map(() => true)].forEach(lost => {
      pips.appendChild(element('span', '', 'influence-pip' + (lost ? ' is-lost' : '')));
    });
    content.append(meta, cards, pips);
    slot.replaceChildren(content);
  });
}

function emptyAction(title, message, icon = 'hourglass') {
  const panel = element('div', '', 'empty-state');
  panel.append(createIcon(icon, { size: 25 }), element('h3', title), element('p', message));
  ui.actions.replaceChildren(panel);
}
function actionDetails(option) {
  const base = baseActions[option.action];
  if (base) return base;
  const role = roleText(option.action);
  const costs = { Illusionniste: '+4 à partager', Pape: 'La dîme', 'Maître-Chanteur': '3 pièces requises', Espion: 'Un échange' };
  return { ...role, cost: costs[option.action] || '', effect: role.effect || role.short };
}
function renderActions(state) {
  ui.actions.replaceChildren();
  if (state.phase !== 'IN_PROGRESS') return;
  const me = state.players.find(p => p.id === playerId);
  const active = state.players.find(p => p.id === state.currentPlayerId);
  if (!state.actions.length) {
    selectedAction = null;
    ui.actionHeading.textContent = me?.isAlive ? 'L’intrigue se poursuit' : 'La partie continue';
    ui.actionSubtitle.textContent = me?.isAlive ? 'Chaque réaction compte.' : 'Tu peux suivre la fin de la partie.';
    emptyAction(me?.isAlive ? state.currentPlayerId === playerId ? 'Ton action est en cours.' : 'Observe la table.' : 'Tu es éliminé.',
      me?.isAlive ? 'Les décisions qui te concernent apparaîtront ici.' : 'Tes cartes restent visibles. Les autres joueurs continuent.', me?.isAlive ? 'hourglass' : 'eye');
    return;
  }
  ui.actionHeading.textContent = 'À toi de jouer';
  ui.actionSubtitle.textContent = me?.coins >= 10 ? 'Avec 10 pièces ou plus, tu dois assassiner.' : 'Choisis ton action. Le bluff est permis.';
  if (selectedAction && (selectedAction.turnId !== state.turnId || !state.actions.some(option => option.action === selectedAction.action && !option.disabled))) selectedAction = null;
  const panel = element('div', '', 'action-panel');
  const grid = element('div', '', 'action-grid');
  state.actions.forEach(option => {
    const details = actionDetails(option);
    const selected = selectedAction?.action === option.action;
    const card = makeButton('', () => {
      if (option.disabled || pendingAction || panel.parentNode !== ui.actions) return;
      selectedAction = { action: option.action, turnId: state.turnId, targetId: selected ? selectedAction.targetId : null };
      renderActions(currentState);
      renderCircle(currentState, currentState);
      [...ui.actions.querySelectorAll('.action-card')].find(node => node.dataset.action === option.action)?.focus({ preventScroll: true });
    }, 'action-card' + (selected ? ' is-selected' : '') + (option.action === 'Assassinat' ? ' is-danger' : ''));
    card.replaceChildren();
    card.dataset.action = option.action;
    card.disabled = Boolean(option.disabled);
    card.setAttribute('aria-pressed', String(selected));
    card.title = option.reason || details.short;
    const icon = element('span', '', 'action-icon');
    icon.appendChild(createIcon(details.icon || 'spark'));
    const copy = element('span', '', 'action-copy');
    copy.append(element('span', option.action, 'action-name'), element('span', option.disabled && option.reason ? option.reason : details.short, 'action-description'));
    card.append(icon, copy, element('span', details.cost, 'action-cost'));
    grid.appendChild(card);
  });
  panel.appendChild(grid);
  if (selectedAction) {
    const option = state.actions.find(item => item.action === selectedAction.action);
    const details = actionDetails(option);
    const preview = element('div', '', 'action-confirmation');
    preview.append(element('p', 'Ton prochain mouvement', 'decision-eyebrow'), element('h3', option.action),
      element('p', details.effect, 'action-explanation'));
    if (option.targetable) {
      preview.appendChild(element('p', 'Choisis une cible ici ou directement à la table.', 'target-hint'));
      const picker = element('div', '', 'target-picker');
      picker.setAttribute('role', 'group');
      picker.setAttribute('aria-label', 'Cible de ' + option.action);
      state.players.filter(p => p.isAlive && p.id !== playerId).forEach(p => {
        const chip = makeButton(p.name, () => selectTarget(p.id), 'target-chip', 'target');
        chip.dataset.playerId = p.id;
        chip.setAttribute('aria-pressed', String(selectedAction.targetId === p.id));
        picker.appendChild(chip);
      });
      preview.appendChild(picker);
    }
    const target = state.players.find(p => p.id === selectedAction.targetId && p.isAlive && p.id !== playerId);
    const confirm = makeButton(option.targetable && target ? 'Confirmer sur ' + target.name : 'Confirmer ' + option.action,
      () => submitAction(option, state, panel, feedback), 'button ' + (option.action === 'Assassinat' ? 'button-danger' : 'button-primary') + ' confirm-action', 'arrowRight');
    confirm.disabled = option.targetable && !target;
    const feedback = element('p', '', 'form-feedback');
    feedback.setAttribute('role', 'status');
    preview.append(confirm, feedback);
    panel.appendChild(preview);
  } else {
    panel.appendChild(element('p', 'Sélectionne une action pour en voir les détails.', 'action-explanation'));
  }
  ui.actions.appendChild(panel);
}
function selectTarget(targetId) {
  if (!targetableNow()) return;
  const target = currentState.players.find(p => p.id === targetId && p.isAlive && p.id !== playerId);
  if (!target) return;
  selectedAction.targetId = targetId;
  renderActions(currentState);
  renderCircle(currentState, currentState);
  [...ui.actions.querySelectorAll('.target-chip')].find(node => node.dataset.playerId === targetId)?.focus({ preventScroll: true });
}
function submitAction(option, state, panel, feedback) {
  if (pendingAction || option.disabled || !socket.connected || panel.parentNode !== ui.actions || currentState?.turnId !== state.turnId) return;
  const targetId = option.targetable ? selectedAction?.targetId : null;
  if (option.targetable && !currentState.players.some(p => p.id === targetId && p.id !== playerId && p.isAlive)) {
    feedback.textContent = 'Choisis un autre joueur encore en jeu.';
    return;
  }
  prepareAudio();
  const request = { version: sessionVersion, turnId: state.turnId, panel };
  pendingAction = request;
  const restore = freezeControls(panel);
  feedback.textContent = 'Ton action est transmise…';
  renderCircle(currentState, currentState);
  socket.emit('jouerAction', { action: option.action, targetId, turnId: state.turnId }, response => {
    if (pendingAction !== request || request.version !== sessionVersion) return;
    pendingAction = null;
    if (panel.parentNode !== ui.actions) return;
    if (!response?.ok) {
      restore();
      feedback.textContent = response?.message || 'Cette action a été refusée.';
      renderCircle(currentState, currentState);
    } else {
      panel.replaceChildren(element('p', 'Action annoncée. La table réagit…', 'action-explanation'));
    }
  });
}

function makeDecision(prompt, eligible = false) {
  const panel = element('div', '', 'decision-panel');
  panel.dataset.promptId = prompt.promptId;
  panel.append(element('p', eligible ? 'À toi de répondre' : 'La table délibère', 'decision-eyebrow'),
    element('h3', prompt.title, 'decision-title'));
  if (prompt.message) panel.appendChild(element('p', prompt.message, 'decision-message'));
  const feedback = element('p', eligible ? '' : 'En attente des joueurs concernés.', 'decision-feedback');
  feedback.setAttribute('role', 'status');
  panel.appendChild(feedback);
  const decision = { promptId: prompt.promptId, panel, feedback, version: sessionVersion, pending: false, eligible };
  activeDecision = decision;
  ui.votes.replaceChildren(panel);
  ui.decisions.hidden = false;
  return decision;
}
function choiceTone(value) {
  if (['challenge', 'refuse'].includes(value)) return ' is-danger';
  if (['block', 'claim'].includes(value)) return ' is-defend';
  return '';
}
socket.on('decisionStatus', prompt => { makeDecision(prompt); });
socket.on('decisionDemand', prompt => {
  if (ui.dialog.open) closeDialog();
  const decision = makeDecision(prompt, true);
  const controls = element('div', '', prompt.kind === 'cards' ? 'decision-selection' : 'decision-options');
  decision.panel.insertBefore(controls, decision.feedback);
  if (prompt.kind === 'cards') {
    const selected = new Set();
    const cardButtons = [];
    const count = element('p', '0 / ' + prompt.count + ' sélectionnée' + (prompt.count > 1 ? 's' : ''), 'selection-count');
    const cards = element('div', '', 'decision-cards');
    const confirm = makeButton('Valider ma sélection', () => {
      if (selected.size === prompt.count) submitDecision(decision, { indices: [...selected] });
    }, 'button button-primary decision-confirm', 'check');
    confirm.disabled = prompt.count !== 0;
    prompt.cards.forEach((role, index) => {
      const cardButton = makeButton('', () => {
        if (decision.pending || activeDecision !== decision) return;
        if (selected.has(index)) selected.delete(index);
        else if (prompt.count === 1) { selected.clear(); selected.add(index); }
        else if (selected.size < prompt.count) selected.add(index);
        else {
          decision.feedback.textContent = 'Désélectionne une carte avant d’en choisir une autre.';
          return;
        }
        cardButtons.forEach((node, i) => node.setAttribute('aria-pressed', String(selected.has(i))));
        count.textContent = selected.size + ' / ' + prompt.count + ' sélectionnée' + (prompt.count > 1 ? 's' : '');
        confirm.disabled = selected.size !== prompt.count;
        decision.feedback.textContent = '';
      }, 'decision-card');
      cardButton.replaceChildren(renderCard(role), element('span', role, 'decision-card-name'),
        element('small', 'Carte ' + (index + 1), 'decision-card-index'));
      cardButton.dataset.cardIndex = String(index);
      cardButton.setAttribute('aria-label', role + ', carte ' + (index + 1));
      cardButton.setAttribute('aria-pressed', 'false');
      cardButtons.push(cardButton);
      cards.appendChild(cardButton);
    });
    controls.append(count, cards, confirm);
  } else {
    prompt.options.forEach(option => {
      controls.appendChild(makeButton(option.label, () => submitDecision(decision, { choice: option.value }),
        'decision-option' + choiceTone(option.value),
        option.value === 'challenge' ? 'cross' : ['block', 'claim'].includes(option.value) ? 'shield' : 'check'));
    });
  }
  playSound('decision');
  if (!window.matchMedia?.('(max-width: 900px)').matches) {
    toast('Une décision t’attend : ' + prompt.title);
  }
  const firstControl = controls.querySelector('button');
  firstControl?.focus({ preventScroll: true });
  if (window.matchMedia?.('(max-width: 900px)').matches) {
    requestAnimationFrame(() => {
      if (activeDecision !== decision || !decision.panel.isConnected) return;
      const bounds = ui.decisions.getBoundingClientRect();
      if (bounds.top < 20 || bounds.bottom > window.innerHeight - 20) {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        ui.decisions.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      }
    });
  }
});
function submitDecision(decision, answer) {
  if (activeDecision !== decision || decision.pending || !socket.connected) return;
  decision.pending = true;
  const restore = freezeControls(decision.panel);
  decision.feedback.textContent = 'Ta réponse est transmise…';
  socket.emit('repondreDecision', { promptId: decision.promptId, ...answer }, response => {
    if (activeDecision !== decision || decision.version !== sessionVersion || decision.panel.parentNode !== ui.votes) return;
    if (!response?.ok) {
      decision.pending = false;
      restore();
      decision.feedback.textContent = response?.message || 'Cette réponse a été refusée.';
    } else {
      decision.feedback.textContent = 'Réponse reçue. Les autres joueurs se prononcent.';
    }
  });
}
socket.on('decisionClosed', ({ promptId }) => {
  if (activeDecision?.promptId !== promptId) return;
  activeDecision = null;
  ui.votes.replaceChildren();
  ui.decisions.hidden = true;
});

function appendLog(line) {
  const match = String(line).match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  const time = match ? match[1] : '';
  const text = (match ? match[2] : String(line)).replace(/^☠️\s*/u, '');
  const tone = /éliminé|perd sa carte|n'a pas de carte|interrompue/.test(text) ? 'danger'
    : /Victoire|prouve sa carte/.test(text) ? 'success'
      : /pièce|trésor|héritage/i.test(text) ? 'gold' : 'neutral';
  const entry = element('div', '', 'journal-entry');
  entry.dataset.tone = tone;
  const mark = element('span', '', 'journal-mark');
  mark.appendChild(createIcon(tone === 'danger' ? 'dagger' : tone === 'success' ? 'check' : tone === 'gold' ? 'coins' : 'arrowRight', { size: 14 }));
  entry.append(mark, element('span', text, 'journal-text'), element('time', time, 'journal-time'));
  const nearBottom = ui.journal.scrollHeight - ui.journal.scrollTop - ui.journal.clientHeight < 80;
  ui.journal.appendChild(entry);
  logTotal += 1;
  while (ui.journal.children.length > 100) ui.journal.firstChild.remove();
  ui.logCount.textContent = String(ui.journal.children.length);
  ui.logCount.title = logTotal > 100 ? 'Les 100 événements les plus récents' : 'Événements de la partie';
  if (nearBottom) ui.journal.scrollTop = ui.journal.scrollHeight;
}
socket.on('logUpdate', appendLog);

socket.on('connect', () => {
  const reconnecting = hasConnected;
  hasConnected = true;
  resetSession();
  connectionState('connected');
  setScreen('lobby');
  renderLobby(disconnectedFromRoom ? 'Connexion rétablie. Crée ou rejoins un nouveau salon pour jouer.' : '');
  if (reconnecting) toast('La connexion est rétablie.', 'success');
  disconnectedFromRoom = false;
});
socket.on('disconnect', () => {
  disconnectedFromRoom = Boolean(roomCode);
  resetSession();
  connectionState('offline');
  setScreen('lobby');
  renderLobby(disconnectedFromRoom ? 'Ta connexion au salon a été interrompue. Après reconnexion, crée ou rejoins un nouveau salon.' : 'En attente de reconnexion au serveur…');
  toast('Connexion interrompue.', 'danger');
});
socket.on('connect_error', () => {
  connectionState('offline');
  const feedback = ui.lobbyActions.querySelector('.form-feedback');
  if (feedback && !pendingLobby) feedback.textContent = 'Le serveur est indisponible. Une nouvelle connexion sera tentée.';
});
socket.on('etatSalle', ({ code, joueurs, maxPlayers }) => {
  roomCode = code;
  playerId = playerId || socket.id;
  currentState = null;
  pendingAction = null;
  selectedAction = null;
  activeDecision = null;
  closeDialog();
  setScreen('waiting');
  updateRoom();
  ui.status.textContent = 'En attendant les convives';
  ui.state.textContent = joueurs.length === 1 ? 'La première place est prise.' : joueurs.length + ' joueurs ont rejoint la table.';
  ui.waitingCount.textContent = joueurs.length + ' / ' + maxPlayers;
  ui.waitingCode.textContent = code;
  ui.waitingHint.textContent = 'Partage le code. La partie démarre automatiquement à ' + maxPlayers + ' joueurs.';
  ui.deck.textContent = '—';
  ui.treasury.textContent = '—';
  ui.announcements.textContent = 'Un salon privé. Des intentions secrètes.';
  ui.actionHeading.textContent = 'Le salon est ouvert';
  ui.actionSubtitle.textContent = 'Tout commence autour de cette table.';
  emptyAction('Invitez les autres joueurs.', 'Chacun rejoint le salon avec le code ' + code + '.', 'users');
  ui.votes.replaceChildren();
  ui.decisions.hidden = true;
  renderWaitingSeats(joueurs);
});
socket.on('stateUpdate', state => {
  const previous = currentState;
  currentState = state;
  roomCode = state.code || roomCode;
  playerId = playerId || socket.id;
  const me = state.players.find(p => p.id === playerId);
  if (me) playerName = me.name;
  if (privateInspection) {
    const owner = state.players.find(p => p.id === privateInspection.playerId);
    if (!owner || owner.hand[privateInspection.index] !== privateInspection.role) closeDialog();
  }
  if (pendingAction && (state.turnId !== pendingAction.turnId || !state.actions.length)) pendingAction = null;
  if (selectedAction && (selectedAction.turnId !== state.turnId || !state.actions.some(option => option.action === selectedAction.action && !option.disabled))) selectedAction = null;
  if (state.phase === 'IN_PROGRESS') setScreen('game');
  updateRoom();
  updatePrivacy();
  ui.deck.textContent = String(state.deckCount);
  ui.treasury.textContent = String(state.treasure);
  ui.ownCoins.textContent = (me?.coins ?? '—') + ' pièce' + (me?.coins === 1 ? '' : 's');
  renderActions(state);
  renderCircle(state, previous);
  if (state.phase === 'IN_PROGRESS') {
    const active = state.players.find(p => p.id === state.currentPlayerId);
    ui.status.textContent = me?.isAlive ? 'L’intrigue est en cours' : 'Depuis les coulisses';
    ui.state.textContent = state.currentPlayerId === playerId ? 'C’est ton tour.' : 'Au tour de ' + (active?.name || '…') + '.';
  }
});
socket.on('nouveauTour', ({ joueurActif, playerId: activeId, turnId }) => {
  if (currentState && currentState.turnId !== turnId) return;
  ui.state.textContent = activeId === playerId ? 'C’est ton tour.' : 'Au tour de ' + joueurActif + '.';
  ui.announcements.textContent = activeId === playerId ? 'La table attend ton prochain mouvement.' : joueurActif + ' prépare son prochain mouvement.';
  if (activeId === playerId && lastTurnNotified !== turnId) {
    lastTurnNotified = turnId;
    pulseTurn();
    playSound('turn');
  }
});
socket.on('actionAnnoncee', ({ joueur, description, cible }) => {
  const action = element('div');
  action.append(element('span', joueur, 'announcement-player'), element('strong', description, 'announcement-action'));
  if (cible) action.appendChild(element('span', 'sur ' + cible, 'announcement-target'));
  ui.announcements.replaceChildren(action);
});
socket.on('gameEnded', ({ winnerId, winnerName, aborted, reason }) => {
  sessionVersion += 1;
  clearTimeout(bannerTimer);
  bannerTimer = null;
  lastTurnNotified = null;
  ui.banner.classList.remove('is-visible');
  pendingAction = null;
  pendingLobby = null;
  selectedAction = null;
  activeDecision = null;
  roomCode = null;
  closeDialog();
  currentState = null;
  ui.votes.replaceChildren();
  ui.decisions.hidden = true;
  updateRoom();
  setScreen('ended');
  lobbyMode = 'create';
  renderLobby(aborted ? 'Le salon a été interrompu. Une nouvelle partie peut commencer.' : 'La table attend déjà sa prochaine intrigue.');
  const content = element('div', '', 'result-view');
  content.append(createIcon(aborted ? 'cross' : 'crown', { size: 44 }),
    element('p', aborted ? 'Partie interrompue' : winnerId === playerId ? 'Le salon t’appartient' : 'Le dernier mot', 'dialog-eyebrow'),
    element('h2', aborted ? 'On se retrouve au prochain salon.' : winnerName ? winnerName + ' remporte la partie.' : 'La partie est terminée.', 'dialog-title'),
    element('p', aborted ? reason || 'La connexion d’un joueur a été perdue.' : 'Un seul joueur encore en lice. Et toute la table pour témoin.', 'dialog-lead'));
  const controls = element('div', '', 'result-actions');
  controls.appendChild(makeButton('Revenir au salon', closeDialog, 'button button-primary', 'arrowRight'));
  content.appendChild(controls);
  showDialog(content, 'result');
  if (!aborted) playSound('win');
  toast(aborted ? reason || 'La partie a été interrompue.' : 'Victoire de ' + winnerName + '.', aborted ? 'danger' : 'success');
});

resetSession();
setScreen('lobby');
connectionState(socket.connected ? 'connected' : 'connecting');
if (window.matchMedia?.('(max-width: 900px)').matches) ui.journalPanel.open = false;
updateSound();
updatePrivacy();
renderLobby();

// Behavioral regression tests for Magouille's shared declarations.
// Run: node tests/shared-discussion.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, Player, TOTAL_COIN_POOL, ROLES } = require('../server/index.js');

const I = 'Illusionniste';
const C = 'Croque-Mort';
const P = 'Pape';
const M = 'Maître-Chanteur';
const E = 'Espion';

class SocketRecorder {
  constructor(id) { this.id = id; this.events = []; }
  emit(event, payload) { this.events.push({ event, payload: structuredClone(payload) }); }
  leave() {}
  last(event) { return this.events.findLast(item => item.event === event)?.payload; }
  open(updateEvent, closeEvent, idKey) {
    const closed = new Set();
    for (let index = this.events.length - 1; index >= 0; index--) {
      const item = this.events[index];
      if (item.event === closeEvent) closed.add(item.payload[idKey]);
      if (item.event === updateEvent && !closed.has(item.payload[idKey])) return item.payload;
    }
    return null;
  }
}

function fixture({
  hands = [[I, M], [I, P], [C, E], [C, M]],
  coins = [2, 2, 2, 2], current = 0
} = {}) {
  const game = new Game('TEST');
  game.buildDeck();
  const take = role => {
    const index = game.deck.findIndex(card => card.role === role);
    assert(index >= 0, 'Fixture uses at most three copies of ' + role);
    return game.deck.splice(index, 1)[0];
  };
  game.players = hands.map((roles, index) => {
    const player = new Player(new SocketRecorder('player-' + index), ['Alice', 'Basile', 'Clara', 'David'][index]);
    player.hand = roles.map(take);
    player.isAlive = roles.length > 0;
    player.coins = coins[index];
    return player;
  });
  // Missing influences have already been revealed. Take real cards so the
  // complete fixture still contains exactly the original fifteen cards.
  for (const player of game.players) {
    while (player.hand.length + player.revealed.length < 2) player.revealed.push(game.deck.shift().role);
  }
  game.treasure = TOTAL_COIN_POOL - coins.reduce((sum, amount) => sum + amount, 0);
  game.phase = 'IN_PROGRESS';
  game.currentPlayerIndex = current;
  game.startTurn();
  invariant(game);
  return game;
}

function invariant(game) {
  const pots = [...(game.estates || []), ...(game.activeEstate ? [game.activeEstate] : [])];
  const total = game.treasure + game.players.reduce((sum, player) => sum + player.coins, 0)
    + pots.reduce((sum, estate) => sum + estate.coins, 0);
  assert.equal(total, TOTAL_COIN_POOL, 'All 54 coins remain in hands, treasury, or distinct reserved estates');
  assert(game.treasure >= 0 && game.players.every(player => Number.isInteger(player.coins) && player.coins >= 0));
  const roles = [
    ...game.deck.map(card => card.role),
    ...game.players.flatMap(player => [...player.hand.map(card => card.role), ...player.revealed]),
    ...(game.pendingDraw ? [game.pendingDraw.role] : [])
  ];
  assert.equal(roles.length, 15, 'No card is created or lost');
  for (const role of ROLES) assert.equal(roles.filter(item => item === role).length, 3, 'Three copies of ' + role);
  for (const recipient of game.players) {
    const state = recipient.socket.last('stateUpdate');
    if (!state) continue;
    for (const player of state.players) {
      if (player.id !== recipient.id) assert(player.hand.every(card => card === null), 'Other hands stay private');
    }
  }
}

async function flush() {
  for (let count = 0; count < 5; count++) await new Promise(resolve => setImmediate(resolve));
}

function board(game, index = 0) {
  return game.players[index].socket.open('discussionUpdate', 'discussionClosed', 'discussionId');
}

function prompt(game, index) {
  return game.players[index].socket.open('decisionDemand', 'decisionClosed', 'promptId');
}

function context(game, index, kind = 'action') {
  const current = board(game, index);
  assert(current, 'A shared discussion is visible');
  const item = current.contexts.find(candidate => candidate.kind === kind);
  assert(item, 'Context ' + kind + ' is visible');
  return item;
}

function declaration(game, recipient, playerIndex, kind = 'action') {
  const result = context(game, recipient, kind).declarations.find(item => item.playerId === game.players[playerIndex].id);
  assert(result, 'The requested declaration is visible');
  return result;
}

function send(game, index, payload) {
  const current = board(game, index);
  assert(current, 'A shared discussion exists before sending ' + payload.type);
  const result = game.respondDiscussion(game.players[index], {
    discussionId: current.discussionId, revision: current.revision, ...payload
  });
  return result;
}

async function declare(game, index, choice, kind = 'action') {
  const item = context(game, index, kind);
  assert(item.options.some(option => option.value === choice), 'Choice ' + choice + ' is offered to player ' + index);
  const result = send(game, index, { type: 'declare', contextId: item.id, choice });
  assert.equal(result.ok, true, result.message);
  await flush();
  invariant(game);
}

async function accept(game, index) {
  const result = send(game, index, { type: 'accept' });
  assert.equal(result.ok, true, result.message);
  await flush();
  invariant(game);
}

async function approveAll(game) {
  // A wave may open another independent estate. It has new mandatory choices,
  // so this helper cannot silently decide them or consent on anyone's behalf.
  for (let sweep = 0; sweep < 5; sweep++) {
    let accepted = false;
    for (let index = 0; index < game.players.length; index++) {
      const current = board(game, index);
      if (game.players[index].isAlive && current?.canAccept) {
        await accept(game, index);
        accepted = true;
      }
    }
    if (!accepted) return;
  }
  throw new Error('Collective acceptance did not stabilize');
}

async function challenge(game, challenger, claimant, kind = 'action') {
  const claim = declaration(game, challenger, claimant, kind);
  assert.equal(claim.challengeable, true, 'This exact claim is still challengeable');
  const result = send(game, challenger, { type: 'challenge', claimId: claim.id });
  assert.equal(result.ok, true, result.message);
  await flush();
  invariant(game);
}

async function chooseCards(game, index, indices) {
  const current = prompt(game, index);
  assert(current?.kind === 'cards', 'Player ' + index + ' receives a private indexed card choice');
  const result = game.respond(game.players[index], { promptId: current.promptId, indices });
  assert.equal(result.ok, true, result.message);
  await flush();
  invariant(game);
}

async function choose(game, index, choice) {
  const current = prompt(game, index);
  assert(current?.options?.some(option => option.value === choice), 'Private choice ' + choice + ' is available');
  const result = game.respond(game.players[index], { promptId: current.promptId, choice });
  assert.equal(result.ok, true, result.message);
  await flush();
  invariant(game);
}

async function play(game, action, targetIndex) {
  const result = game.playAction(game.players[game.currentPlayerIndex], {
    action, targetId: targetIndex === undefined ? null : game.players[targetIndex].id, turnId: game.turnId
  });
  assert.equal(result.ok, true, result.message);
  await flush();
  invariant(game);
}

function coins(game) { return game.players.map(player => player.coins); }
function noTransfers(game, expected) { assert.deepEqual(coins(game), expected, 'Unaccepted claims do not transfer coins'); }
function claimsOpen(game, recipient, expected) {
  const actual = context(game, recipient).declarations.filter(claim => claim.challengeable).map(claim => claim.playerName);
  assert.deepEqual(new Set(actual), new Set(expected));
}

test('Illusionniste: shared claims, fixed choices, invalidated consent, and unanimity including actor', async () => {
  const game = fixture();
  const firstTurn = game.turnId;
  await play(game, I);
  await accept(game, 0);
  const acceptedVersion = board(game).revision;
  assert.equal(board(game).accepted, true);
  await declare(game, 1, 'claim');
  assert(board(game).revision > acceptedVersion);
  assert(board(game).participants.every(player => !player.accepted));
  const obsolete = game.respondDiscussion(game.players[0], {
    discussionId: board(game).discussionId, revision: acceptedVersion, type: 'accept'
  });
  assert.equal(obsolete.ok, false, 'An acceptance for the old situation is refused');
  const changedClaim = send(game, 1, { type: 'declare', contextId: context(game, 1).id, choice: 'pass' });
  assert.equal(changedClaim.ok, false, 'A claim cannot be withdrawn');
  await declare(game, 2, 'claim');
  await declare(game, 3, 'pass');
  const changedPass = send(game, 3, { type: 'declare', contextId: context(game, 3).id, choice: 'claim' });
  assert.equal(changedPass.ok, false, 'A pass cannot become a claim');
  claimsOpen(game, 3, ['Alice', 'Basile', 'Clara']);
  const revision = board(game).revision;
  for (const index of [1, 2, 3]) await accept(game, index);
  assert.equal(board(game).revision, revision, 'Simple acceptance does not invalidate other acceptances');
  noTransfers(game, [2, 2, 2, 2]);
  assert.equal(game.turnId, firstTurn);
  await accept(game, 0);
  assert.deepEqual(coins(game), [4, 3, 3, 2]);
  assert.equal(game.turnId, firstTurn + 1);
  assert.equal(game.currentPlayerIndex, 1);
  assert.equal(board(game), null);
});

test('A player who passed and accepted can accuse several other declarers until collective closure', async () => {
  const game = fixture({ hands: [[I, E], [P, C], [P, M], [E, M]] });
  await play(game, I);
  await declare(game, 1, 'claim');
  await declare(game, 2, 'claim');
  await declare(game, 3, 'pass');
  await accept(game, 3);
  await challenge(game, 3, 1);
  assert.equal(board(game, 3).accepted, false);
  assert.equal(board(game).status, 'challenge');
  assert.equal(prompt(game, 1).cards.length, 2);
  assert.equal(prompt(game, 0), null, 'Only the losing player receives their cards');
  await chooseCards(game, 1, [0]);
  assert.equal(declaration(game, 3, 1).status, 'disproved');
  assert.equal(board(game).status, 'open');
  await challenge(game, 3, 2);
  await chooseCards(game, 2, [1]);
  assert.deepEqual(game.players.map(player => player.hand.length), [2, 1, 1, 2]);
  assert.equal(declaration(game, 3, 0).challengeable, true);
  await approveAll(game);
  assert.deepEqual(coins(game), [6, 2, 2, 2]);
});

test('A proved declaration survives card replacement but does not immunize another declarer', async () => {
  const game = fixture();
  game.shuffleDeck = () => {
    const index = game.deck.findIndex(card => card.role !== I);
    [game.deck[index], game.deck[game.deck.length - 1]] = [game.deck[game.deck.length - 1], game.deck[index]];
  };
  await play(game, I);
  await declare(game, 1, 'claim');
  await declare(game, 2, 'pass');
  await declare(game, 3, 'pass');
  await challenge(game, 3, 0);
  await chooseCards(game, 3, [0]);
  assert(game.players[0].hand.every(card => card.role !== I), 'The proof card was replaced by a different role');
  const actorClaim = declaration(game, 2, 0);
  assert.equal(actorClaim.status, 'proved');
  assert.equal(actorClaim.challengeable, false);
  assert.equal(send(game, 2, { type: 'challenge', claimId: actorClaim.id }).ok, false);
  assert.equal(declaration(game, 2, 1).challengeable, true);
  assert(board(game).participants.every(player => !player.accepted));
  await approveAll(game);
  assert.deepEqual(coins(game), [5, 3, 2, 2]);
});

test('Only one simultaneous accusation is accepted; other commands stay locked during card loss', async () => {
  const game = fixture({ hands: [[I, E], [P, C], [P, M], [E, M]] });
  await play(game, I);
  await declare(game, 1, 'claim');
  await declare(game, 2, 'pass');
  await declare(game, 3, 'pass');
  const current = board(game, 2);
  const claim = declaration(game, 2, 1);
  const payload = { discussionId: current.discussionId, revision: current.revision, type: 'challenge', claimId: claim.id };
  assert.equal(game.respondDiscussion(game.players[2], payload).ok, true);
  assert.equal(game.respondDiscussion(game.players[3], payload).ok, false);
  await flush();
  assert.equal(send(game, 0, { type: 'accept' }).ok, false);
  assert.equal(send(game, 3, { type: 'challenge', claimId: declaration(game, 3, 0).id }).ok, false);
  assert.equal(game.players[1].hand.length, 2, 'Card loss waits for the selected card');
  const cardPrompt = prompt(game, 1);
  assert.equal(game.respond(game.players[0], { promptId: cardPrompt.promptId, indices: [0] }).ok, false);
  assert.equal(game.respond(game.players[1], { promptId: cardPrompt.promptId, indices: [4] }).ok, false);
  await chooseCards(game, 1, [0]);
  assert.equal(game.players[1].hand.length, 1);
  assert.equal(game.respond(game.players[1], { promptId: cardPrompt.promptId, indices: [1] }).ok, false);
  await approveAll(game);
  assert.equal(game.players[1].revealed.length, 1);
});

test('Pape: all counters are visible together and a caught initiating bluff cancels every unpaid transfer', async () => {
  const game = fixture({ hands: [[I, M], [P, E], [P, C], [I, E]] });
  const firstTurn = game.turnId;
  await play(game, P);
  await declare(game, 1, 'pay');
  await declare(game, 2, 'block');
  await declare(game, 3, 'pay');
  claimsOpen(game, 1, ['Alice', 'Clara']);
  await accept(game, 0);
  await accept(game, 1);
  noTransfers(game, [2, 2, 2, 2]);
  await challenge(game, 3, 0);
  noTransfers(game, [2, 2, 2, 2]);
  await chooseCards(game, 0, [1]);
  noTransfers(game, [2, 2, 2, 2]);
  assert.equal(game.turnId, firstTurn + 1);
  assert.equal(game.currentPlayerIndex, 1);
  assert.equal(board(game), null);
  assert.equal(game.players[2].hand.length, 2, 'The abandoned counter is not processed afterward');
});

test('Pape: unanimous consent applies the complete tax once, exempts valid counters, and permits zero coins', async () => {
  const game = fixture({ hands: [[P, M], [P, E], [I, C], [I, E]], coins: [2, 2, 2, 0] });
  await play(game, P);
  await declare(game, 3, 'pay');
  await declare(game, 1, 'block');
  await declare(game, 2, 'pay');
  for (const index of [0, 2, 3]) await accept(game, index);
  noTransfers(game, [2, 2, 2, 0]);
  await accept(game, 1);
  assert.deepEqual(coins(game), [3, 2, 1, 0]);
});

test('Maître-Chanteur and Croque-Mort counter remain challengeable together until actor bluff is resolved', async () => {
  const game = fixture({ hands: [[I, P], [C, E], [P, M], [I, E]], coins: [3, 3, 2, 2] });
  const turn = game.turnId;
  await play(game, M, 1);
  await declare(game, 1, 'block');
  claimsOpen(game, 2, ['Alice', 'Basile']);
  await accept(game, 1);
  await challenge(game, 3, 0);
  await chooseCards(game, 0, [0]);
  noTransfers(game, [3, 3, 2, 2]);
  assert.equal(game.players[1].hand.length, 2);
  assert.equal(game.turnId, turn + 1);
  assert.equal(board(game), null);
});

test('Maître-Chanteur: target payment stays provisional and cannot hide a false primary claim', async () => {
  const game = fixture({ hands: [[I, P], [C, E], [P, M], [I, E]], coins: [3, 3, 2, 2] });
  await play(game, M, 1);
  await declare(game, 1, 'pay');
  for (const index of [0, 1, 2]) await accept(game, index);
  noTransfers(game, [3, 3, 2, 2]);
  await challenge(game, 3, 0);
  await chooseCards(game, 0, [0]);
  noTransfers(game, [3, 3, 2, 2]);
});

test('A false Croque-Mort counter reopens only pay/refuse; the main blackmail claim remains contestable', async () => {
  const game = fixture({ hands: [[M, I], [P, E], [C, M], [I, E]], coins: [3, 3, 2, 2] });
  await play(game, M, 1);
  await declare(game, 1, 'block');
  await challenge(game, 2, 1);
  await chooseCards(game, 1, [0]);
  assert.deepEqual(new Set(context(game, 1).options.map(option => option.value)), new Set(['pay', 'refuse']));
  assert.equal(declaration(game, 3, 0).challengeable, true);
  await declare(game, 1, 'pay');
  assert.equal(send(game, 1, { type: 'declare', contextId: context(game, 1).id, choice: 'refuse' }).ok, false);
  await challenge(game, 3, 0);
  await chooseCards(game, 3, [0]);
  noTransfers(game, [3, 3, 2, 2]);
  await approveAll(game);
  assert.deepEqual(coins(game), [6, 0, 2, 2]);
});

test('Blackmail refusal transfers only after consent; a fatal refusal creates an estate including the gift', async () => {
  const game = fixture({ hands: [[M, C], [P], [I, E], [C, P]], coins: [3, 2, 2, 2] });
  const turn = game.turnId;
  await play(game, M, 1);
  await declare(game, 1, 'refuse');
  for (const index of [0, 1, 2]) await accept(game, index);
  assert.equal(game.players[1].isAlive, true);
  noTransfers(game, [3, 2, 2, 2]);
  await accept(game, 3);
  assert.equal(game.players[1].isAlive, false);
  assert.equal(context(game, 0, 'estate').amount, 5);
  assert.equal(game.players[0].coins, 0);
  assert.equal(game.turnId, turn, 'The turn waits for the new inheritance');
  await declare(game, 0, 'claim', 'estate');
  await declare(game, 2, 'pass', 'estate');
  await declare(game, 3, 'pass', 'estate');
  await approveAll(game);
  assert.deepEqual(coins(game), [5, 0, 2, 2]);
  assert.equal(game.turnId, turn + 1);
  assert.equal(game.currentPlayerIndex, 2, 'The eliminated next player is skipped');
});

test('Reported regression: two Croque-Morts, one exposed and eliminated, then a fresh separate estate', async () => {
  const game = fixture({ hands: [[C, I], [C, P], [E], [M]], coins: [7, 3, 4, 5] });
  const turn = game.turnId;
  await play(game, 'Assassinat', 3);
  assert.equal(context(game, 0, 'estate').deceasedName, 'David');
  assert.equal(context(game, 0, 'estate').amount, 5);
  const firstEstateId = context(game, 0, 'estate').id;
  await declare(game, 0, 'pass', 'estate');
  await declare(game, 1, 'claim', 'estate');
  await declare(game, 2, 'claim', 'estate');
  await challenge(game, 1, 2, 'estate');
  assert.equal(game.players[2].isAlive, false);
  assert.equal(context(game, 0, 'estate').id, firstEstateId, 'The current estate is not merged or replaced');
  assert.equal(context(game, 0, 'estate').amount, 5);
  assert.equal(game.players[1].coins, 3, 'Winning a challenge does not skip remaining collective consent');
  assert.deepEqual(board(game).participants.map(player => player.name), ['Alice', 'Basile']);
  assert.equal(declaration(game, 0, 1, 'estate').challengeable, true, 'The accuser has not proved their own card');
  await approveAll(game);
  assert.equal(game.players[1].coins, 8, 'Basile receives all of David’s estate');
  const secondEstate = context(game, 0, 'estate');
  assert.notEqual(secondEstate.id, firstEstateId);
  assert.equal(secondEstate.deceasedName, 'Clara');
  assert.equal(secondEstate.amount, 4, 'Clara’s coins form a separate pot');
  assert.equal(secondEstate.declarations.length, 0, 'Prior claims are not copied to the next death');
  await declare(game, 0, 'claim', 'estate');
  await declare(game, 1, 'pass', 'estate');
  await approveAll(game);
  assert.deepEqual(coins(game), [4, 8, 0, 0]);
  assert.equal(game.turnId, turn + 1);
  assert.equal(board(game), null);
});

test('The original Illusionniste can be challenged while an inheritance is open; canceling it preserves the estate', async () => {
  const game = fixture({ hands: [[M, P], [C, P], [E], [I, M]], coins: [2, 2, 5, 2] });
  await play(game, I);
  await declare(game, 1, 'pass');
  await declare(game, 2, 'claim');
  await declare(game, 3, 'pass');
  await challenge(game, 3, 2);
  assert.equal(game.players[2].isAlive, false);
  await declare(game, 0, 'pass', 'estate');
  await declare(game, 1, 'claim', 'estate');
  await declare(game, 3, 'pass', 'estate');
  assert.equal(board(game).contexts.length, 2, 'Primary claims and inheritance coexist');
  await challenge(game, 3, 0);
  await chooseCards(game, 0, [0]);
  assert.equal(context(game, 1, 'estate').declarations.find(claim => claim.playerName === 'Basile').status, 'open');
  await approveAll(game);
  assert.deepEqual(coins(game), [2, 7, 0, 2], 'Only the independently reserved estate is paid');
  assert.equal(game.turnId, 2);
});

test('An inheritance claim can be challenged while the initial action stays open, without accepting that action', async () => {
  const game = fixture({ hands: [[I, M], [C, P], [E], [P, E]], coins: [2, 2, 5, 2] });
  await play(game, I);
  await declare(game, 1, 'pass');
  await declare(game, 2, 'claim');
  await declare(game, 3, 'pass');
  await challenge(game, 1, 2);
  await declare(game, 0, 'pass', 'estate');
  await declare(game, 1, 'pass', 'estate');
  await declare(game, 3, 'claim', 'estate');
  await challenge(game, 0, 3, 'estate');
  await chooseCards(game, 3, [0]);
  assert.equal(declaration(game, 1, 0).challengeable, true, 'The primary claim was never silently accepted');
  noTransfers(game, [2, 2, 0, 2]);
  await approveAll(game);
  assert.deepEqual(coins(game), [6, 2, 0, 2]);
  assert.equal(board(game), null);
});

test('Espion waits for all players including actor; first draw closes the claim and second draw opens a fresh one', async () => {
  const game = fixture({ hands: [[E, P], [I, M], [C, P], [I, M]] });
  const drawIndex = game.deck.findIndex(card => card.role === C);
  [game.deck[drawIndex], game.deck[game.deck.length - 1]] = [game.deck[game.deck.length - 1], game.deck[drawIndex]];
  await play(game, E);
  const firstBoard = board(game);
  const firstClaimId = declaration(game, 1, 0).id;
  const deckBefore = game.deck.length;
  for (const index of [1, 2, 3]) await accept(game, index);
  assert.equal(game.deck.length, deckBefore);
  assert.equal(prompt(game, 0), null);
  await accept(game, 0);
  assert.equal(board(game), null);
  assert.equal(game.deck.length, deckBefore - 1);
  const selection = prompt(game, 0);
  assert.equal(selection.cards.length, 3);
  assert.equal(selection.count, 2);
  assert.equal(game.respondDiscussion(game.players[1], {
    discussionId: firstBoard.discussionId, revision: firstBoard.revision, type: 'challenge', claimId: firstClaimId
  }).ok, false, 'The first claim cannot be challenged after drawing');
  assert.equal(game.respond(game.players[0], { promptId: selection.promptId, indices: [1, 1] }).ok, false);
  await chooseCards(game, 0, [1, 2]);
  assert(game.players[0].hand.every(card => card.role !== E));
  await choose(game, 0, 'again');
  assert.notEqual(declaration(game, 1, 0).id, firstClaimId);
  assert.equal(declaration(game, 1, 0).challengeable, true);
  assert.equal(game.deck.length, deckBefore, 'No second card is drawn before a new consensus');
  assert.equal(game.players[0].coins, 2, 'The second exchange is not charged before approval');
  await challenge(game, 1, 0);
  await chooseCards(game, 0, [0]);
  assert.equal(game.players[0].coins, 2, 'A rejected second declaration is not charged');
  assert.equal(game.turnId, 2);
});

test('Proving Espion does not skip the renewed collective agreement before drawing', async () => {
  const game = fixture({ hands: [[E, P], [I, M], [C, P], [I, M]] });
  await play(game, E);
  const deckBefore = game.deck.length;
  await challenge(game, 1, 0);
  await chooseCards(game, 1, [0]);
  assert.equal(declaration(game, 2, 0).status, 'proved');
  assert.equal(game.deck.length, deckBefore, 'Replacing a proof card is not an Espion draw');
  assert.equal(prompt(game, 0), null);
  assert(board(game).participants.every(player => !player.accepted));
  for (const index of [0, 1, 2]) await accept(game, index);
  assert.equal(prompt(game, 0), null);
  await accept(game, 3);
  await chooseCards(game, 0, [0, 1]);
  await choose(game, 0, 'finish');
  assert.equal(game.turnId, 2);
});

test('Two successful Espion exchanges charge exactly once and never create or lose a card', async () => {
  const game = fixture({ hands: [[E, P], [I, M], [C, P], [I, M]], coins: [2, 2, 2, 2] });
  await play(game, E);
  await approveAll(game);
  await chooseCards(game, 0, [0, 2]);
  await choose(game, 0, 'again');
  noTransfers(game, [2, 2, 2, 2]);
  await approveAll(game);
  assert.equal(game.players[0].coins, 1);
  await chooseCards(game, 0, [0, 1]);
  assert.equal(game.turnId, 2);
  assert.equal(prompt(game, 0), null);
  assert.equal(board(game), null);
});

test('Malformed, self, outsider, and stale discussion commands cannot alter the table', async () => {
  const game = fixture();
  await play(game, I);
  const current = board(game);
  const actorClaim = declaration(game, 1, 0);
  assert.equal(send(game, 0, { type: 'challenge', claimId: actorClaim.id }).ok, false);
  assert.equal(send(game, 1, { type: 'declare', contextId: 'invented', choice: 'claim' }).ok, false);
  assert.equal(send(game, 1, { type: 'declare', contextId: context(game, 1).id, choice: '__proto__' }).ok, false);
  assert.equal(send(game, 1, { type: 'challenge', claimId: 'invented' }).ok, false);
  assert.equal(send(game, 1, { type: 'accept' }).ok, false, 'Required declaration cannot be bypassed');
  const outsider = new Player(new SocketRecorder('outsider'), 'Outside');
  assert.equal(game.respondDiscussion(outsider, {
    discussionId: current.discussionId, revision: current.revision, type: 'accept'
  }).ok, false);
  for (const invalid of [null, {}, [], 'accept', { type: 'accept', discussionId: current.discussionId, revision: '1' }]) {
    assert.equal(game.respondDiscussion(game.players[0], invalid).ok, false);
  }
  assert.equal(board(game).revision, current.revision);
  noTransfers(game, [2, 2, 2, 2]);
  for (const index of [1, 2, 3]) await declare(game, index, 'pass');
  await approveAll(game);
  assert.equal(game.respondDiscussion(game.players[1], {
    discussionId: current.discussionId, revision: current.revision, type: 'challenge', claimId: actorClaim.id
  }).ok, false);
  assert.equal(game.turnId, 2);
});

test('Aborting during a selected card loss closes both interactions without a second loss or dangling action', async () => {
  const game = fixture({ hands: [[I, E], [P, C], [P, M], [E, M]] });
  await play(game, I);
  await declare(game, 1, 'claim');
  await challenge(game, 3, 1);
  const oldPrompt = prompt(game, 1);
  game.abort('Test disconnect');
  await game.actionTask;
  await flush();
  assert.equal(game.phase, 'ENDED');
  assert.equal(board(game), null);
  assert.equal(prompt(game, 1), null);
  assert.equal(game.players[1].hand.length, 2);
  assert.equal(game.respond(game.players[1], { promptId: oldPrompt.promptId, indices: [0] }).ok, false);
  invariant(game);
});

test('Aborting with a current and a queued estate restores both separate pots exactly once', async () => {
  const game = fixture({ hands: [[C, I], [C, P], [E], [M]], coins: [7, 3, 4, 5] });
  await play(game, 'Assassinat', 3);
  await declare(game, 0, 'pass', 'estate');
  await declare(game, 1, 'claim', 'estate');
  await declare(game, 2, 'claim', 'estate');
  await challenge(game, 1, 2, 'estate');
  game.abort('Test disconnect');
  await game.actionTask;
  await flush();
  assert.deepEqual(coins(game), [0, 3, 0, 0]);
  assert.equal(game.treasure, 51);
  assert.equal(board(game), null);
  game.abort('Repeated cleanup');
  assert.equal(game.treasure, 51);
  invariant(game);
});

test('Victory during a challenge finishes immediately and releases reserved inheritance without waiting on the dead', async () => {
  const game = fixture({ hands: [[I, C], [P], [], []], coins: [2, 5, 0, 0] });
  await play(game, I);
  await declare(game, 1, 'claim');
  await challenge(game, 0, 1);
  await game.actionTask;
  assert.equal(game.phase, 'ENDED');
  const ended = game.players[0].socket.last('gameEnded');
  assert.equal(ended.winnerId, game.players[0].id);
  assert.equal(ended.aborted, false);
  assert.equal(game.treasure, 52);
  assert.equal(board(game), null);
  invariant(game);
});

test('A Croque-Mort proof belongs to one inheritance; the next estate requires a fresh challengeable claim', async () => {
  const game = fixture({ hands: [[C, I], [C, P], [E], [M]], coins: [7, 3, 4, 5] });
  game.shuffleDeck = () => {
    const index = game.deck.findIndex(card => card.role !== C);
    [game.deck[index], game.deck[game.deck.length - 1]] = [game.deck[game.deck.length - 1], game.deck[index]];
  };
  await play(game, 'Assassinat', 3);
  await declare(game, 0, 'pass', 'estate');
  await declare(game, 1, 'claim', 'estate');
  await declare(game, 2, 'pass', 'estate');
  const firstClaim = declaration(game, 0, 1, 'estate');
  await challenge(game, 2, 1, 'estate');
  assert.equal(game.players[2].isAlive, false, 'The incorrect accuser is eliminated');
  assert.equal(declaration(game, 0, 1, 'estate').status, 'proved');
  assert(game.players[1].hand.every(card => card.role !== C));
  await approveAll(game);
  assert.equal(game.players[1].coins, 8);
  assert.equal(context(game, 0, 'estate').deceasedName, 'Clara');
  await declare(game, 0, 'claim', 'estate');
  await declare(game, 1, 'claim', 'estate');
  const nextClaim = declaration(game, 0, 1, 'estate');
  assert.notEqual(nextClaim.id, firstClaim.id);
  assert.equal(nextClaim.status, 'open');
  assert.equal(nextClaim.challengeable, true);
  await challenge(game, 0, 1, 'estate');
  await chooseCards(game, 1, [0]);
  await approveAll(game);
  assert.deepEqual(coins(game), [4, 8, 0, 0], 'Losing the new claim does not undo the previously settled estate');
});

test('Foreign aid retains the first-counter selection, then waits for collective acceptance of that counter', async () => {
  const game = fixture();
  await play(game, 'Aide étrangère');
  assert.equal(board(game), null);
  await choose(game, 2, 'pass');
  await choose(game, 1, 'block');
  assert.equal(declaration(game, 0, 1).role, I);
  assert.equal(context(game, 0).options.length, 0, 'No extra simultaneous blocker rule is introduced');
  for (const index of [0, 2, 3]) await accept(game, index);
  noTransfers(game, [2, 2, 2, 2]);
  assert.equal(game.turnId, 1);
  await accept(game, 1);
  noTransfers(game, [2, 2, 2, 2]);
  assert.equal(game.turnId, 2);
});

test('A false foreign-aid blocker is eliminated, their estate resolves, then the living actor receives aid', async () => {
  const game = fixture({ hands: [[C, P], [M], [I, E], [I, P]], coins: [2, 5, 2, 2] });
  await play(game, 'Aide étrangère');
  await choose(game, 1, 'block');
  await challenge(game, 2, 1);
  assert.equal(game.players[1].isAlive, false);
  assert.equal(game.players[0].coins, 2, 'The aid remains unapplied while the separate inheritance is open');
  assert.equal(context(game, 0, 'estate').amount, 5);
  await declare(game, 0, 'claim', 'estate');
  await declare(game, 2, 'pass', 'estate');
  await declare(game, 3, 'pass', 'estate');
  await approveAll(game);
  assert.deepEqual(coins(game), [9, 0, 2, 2], 'Five inherited coins plus two coins of aid');
  assert.equal(game.turnId, 2);
  assert.equal(game.currentPlayerIndex, 2);
});

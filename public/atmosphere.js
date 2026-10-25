// Une couche de mise en scène. Aucune règle, aucun message réseau et aucun choix de jeu ici.
export function createAtmosphere() {
  const doc = document;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)');
  const animations = new Set();
  const timers = new Set();
  const seenChallenges = new Set();
  const seenDeals = new Set();
  let preference = readPreference();
  let enabled = false;
  let lastState = '';
  let lastDiscussion = '';
  let lastTurn = '';
  let lastEnd = '';
  let lastLog = '';
  let tiltTarget = null;
  let tiltPoint = null;
  let tiltFrame = 0;
  const layer = doc.createElement('div');
  layer.className = 'fx-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  doc.body.appendChild(layer);

  function readPreference() {
    try { return localStorage.getItem('magouille.motion') || 'full'; }
    catch { return 'full'; }
  }

  function later(callback, delay) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function clearTimer(timer) {
    window.clearTimeout(timer);
    timers.delete(timer);
  }

  function safe(callback) {
    return (...args) => {
      try { callback(...args); }
      catch { /* Une animation indisponible ne doit jamais interrompre la partie. */ }
    };
  }

  function visibleRect(node) {
    if (!node?.isConnected || node.closest('[hidden]')) return null;
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height || box.bottom < 0 || box.top > window.innerHeight || box.right < 0 || box.left > window.innerWidth) return null;
    return box;
  }

  function point(node) {
    const box = visibleRect(node);
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2, box } : null;
  }

  function playerSlot(id) {
    return [...doc.querySelectorAll('.player-slot[data-player-id]')].find(node => node.dataset.playerId === id);
  }

  function play(node, frames, options = {}, done) {
    if (!enabled || !node?.isConnected || typeof node.animate !== 'function') {
      done?.();
      return;
    }
    const animation = node.animate(frames, { duration: 520, easing: 'cubic-bezier(.18,.75,.28,1)', ...options });
    animations.add(animation);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimer(fuse);
      animations.delete(animation);
      done?.();
    };
    // Les onglets en arrière-plan ne gardent pas de particules indéfiniment.
    const fuse = later(() => { animation.cancel(); finish(); }, (options.delay || 0) + (options.duration || 520) + 1000);
    animation.finished.then(finish, finish);
    return animation;
  }

  function transient(className, text = '') {
    if (!enabled || layer.childElementCount >= 36) return null;
    const node = doc.createElement('span');
    node.className = className;
    node.textContent = text;
    layer.appendChild(node);
    return node;
  }

  function stamp(text, anchor, tone = 'wine', large = false, delay = 0) {
    const at = point(anchor);
    if (!at) return;
    const node = transient('fx-stamp fx-stamp-' + tone + (large ? ' fx-stamp-large' : ''), text);
    if (!node) return;
    node.style.left = Math.max(90, Math.min(window.innerWidth - 90, at.x)) + 'px';
    node.style.top = Math.max(75, Math.min(window.innerHeight - 65, at.y)) + 'px';
    play(node, [
      { transform: 'translate(-50%, -50%) rotate(-13deg) scale(1.65)', opacity: 0 },
      { transform: 'translate(-50%, -50%) rotate(-8deg) scale(.95)', opacity: .94, offset: .16 },
      { transform: 'translate(-50%, -50%) rotate(-8deg) scale(1)', opacity: .94, offset: .28 },
      { transform: 'translate(-50%, -50%) rotate(-8deg) scale(1)', opacity: .94, offset: .70 },
      { transform: 'translate(-50%, -62%) rotate(-8deg) scale(1.01)', opacity: 0 }
    ], { duration: large ? 1150 : 1050, delay }, () => node.remove());
  }

  function floatAmount(anchor, difference) {
    const at = point(anchor);
    if (!at || !difference) return;
    const node = transient('fx-amount ' + (difference > 0 ? 'fx-gain' : 'fx-loss'), (difference > 0 ? '+' : '−') + Math.abs(difference));
    if (!node) return;
    node.style.left = at.x + 'px';
    node.style.top = Math.max(40, at.box.top) + 'px';
    play(node, [
      { opacity: 0, transform: 'translate(-50%, 3px) scale(.85)' },
      { opacity: 1, transform: 'translate(-50%, -12px) scale(1)', offset: .2 },
      { opacity: 1, transform: 'translate(-50%, -23px) scale(1)', offset: .65 },
      { opacity: 0, transform: 'translate(-50%, -42px) scale(.95)' }
    ], { duration: 1150 }, () => node.remove());
  }

  function coinFlight(from, to, amount, routeIndex = 0) {
    const start = point(from);
    const end = point(to);
    if (!start || !end) return;
    const count = Math.min(3, Math.abs(amount));
    for (let index = 0; index < count; index += 1) {
      const node = transient('fx-coin', 'M');
      if (!node) break;
      node.style.left = start.x + 'px';
      node.style.top = start.y + 'px';
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const arc = Math.min(58, 20 + Math.abs(dx) * .12);
      play(node, [
        { transform: 'translate(-50%, -50%) rotate(-25deg) scale(.65)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * .42}px), calc(-50% + ${dy * .42 - arc}px)) rotate(90deg) scale(1)`, opacity: 1, offset: .48 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(215deg) scale(.65)`, opacity: 1, offset: .9 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 4}px)) rotate(225deg) scale(.55)`, opacity: 0 }
      ], { duration: 690, delay: routeIndex * 45 + index * 80 }, () => node.remove());
    }
  }

  function dealCard(target, order) {
    const deck = doc.querySelector('.deck-stack');
    const start = point(deck);
    const end = point(target);
    const source = deck?.querySelector('img');
    if (!start || !end || !source || layer.childElementCount >= 36) return;
    const ghost = source.cloneNode(false);
    ghost.removeAttribute('id');
    ghost.alt = '';
    ghost.className = 'fx-flying-card';
    ghost.width = Math.min(75, end.box.width);
    ghost.style.width = ghost.width + 'px';
    ghost.style.left = start.x + 'px';
    ghost.style.top = start.y + 'px';
    layer.appendChild(ghost);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    play(ghost, [
      { transform: 'translate(-50%, -50%) rotate(-16deg) scale(.5)', opacity: 0 },
      { transform: 'translate(-50%, -50%) rotate(-16deg) scale(.7)', opacity: 1, offset: .1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(5deg) scale(1)`, opacity: 1, offset: .85 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(0deg) scale(1)`, opacity: 0 }
    ], { duration: 600, delay: order * 85 }, () => ghost.remove());
  }

  function onState(previous, state) {
    if (!state || !Array.isArray(state.players)) return;
    const signature = JSON.stringify([state.code, state.phase, state.turnId, state.treasure, state.deckCount,
      state.players.map(p => [p.id, p.coins, p.hand.length, p.revealed.length, p.isAlive])]);
    if (signature === lastState) return;
    lastState = signature;
    if (state.phase !== 'IN_PROGRESS') return;
    const isFirstDeal = (!previous || previous.phase !== 'IN_PROGRESS') && !seenDeals.has(state.code);
    if (isFirstDeal) seenDeals.add(state.code);
    if (!enabled) return;
    const bank = doc.querySelector('.coin-stack');
    const sources = [];
    const destinations = [];
    let cardOrder = 0;
    for (const player of state.players) {
      const slot = playerSlot(player.id);
      const old = previous?.players?.find(p => p.id === player.id);
      if (!slot) continue;
      if (isFirstDeal) slot.querySelectorAll('.hand-card:not(.is-revealed)').forEach(card => dealCard(card, cardOrder++));
      if (!old) continue;
      const delta = player.coins - old.coins;
      const coins = slot.querySelector('.player-coins');
      if (delta) {
        floatAmount(coins, delta);
        (delta > 0 ? destinations : sources).push({ node: coins, amount: Math.abs(delta) });
      }
      if (player.revealed.length > old.revealed.length) {
        const card = slot.querySelector('.hand-card.is-revealed:last-child');
        play(card, [
          { transform: 'perspective(550px) rotateY(55deg) rotate(-6deg)', filter: 'sepia(.2)' },
          { transform: 'perspective(550px) rotateY(0deg) rotate(3deg)', offset: .65 },
          { transform: 'perspective(550px) rotateY(0deg) rotate(0deg)' }
        ], { duration: 560 });
        stamp(player.isAlive ? 'RÉVÉLÉE' : 'ÉLIMINÉ', card || slot, 'wine', false, 180);
      }
    }
    if (previous) {
      const bankDelta = state.treasure - previous.treasure;
      if (bankDelta) (bankDelta > 0 ? destinations : sources).push({ node: bank, amount: Math.abs(bankDelta) });
      // Un héritage réservé n'est pas un versement au trésor : n'inventons pas ce trajet.
      const outgoing = sources.reduce((sum, item) => sum + item.amount, 0);
      const incoming = destinations.reduce((sum, item) => sum + item.amount, 0);
      if (outgoing === incoming) {
        let route = 0;
        for (const source of sources) {
          for (const destination of destinations) {
            const amount = Math.min(source.amount, destination.amount);
            if (amount > 0 && route < 6) coinFlight(source.node, destination.node, amount, route++);
            source.amount -= amount;
            destination.amount -= amount;
          }
        }
      }
      if (state.deckCount < previous.deckCount && !isFirstDeal) {
        const destination = playerSlot(state.currentPlayerId)?.querySelector('.player-cards');
        if (destination) dealCard(destination, 0);
      }
    }
  }

  function onDiscussion(previous, payload) {
    if (!payload?.contexts) return;
    const signature = JSON.stringify([payload.discussionId, payload.revision, payload.status,
      payload.participants.map(p => [p.id, p.accepted]),
      payload.contexts.map(c => [c.id, c.responses.length, c.declarations.map(d => [d.id, d.status])])]);
    if (signature === lastDiscussion) return;
    lastDiscussion = signature;
    const challenge = payload.challenge;
    const challengeKey = challenge ? [payload.discussionId, challenge.claimId, challenge.challengerId].join(':') : '';
    const newChallenge = challengeKey && !seenChallenges.has(challengeKey);
    if (newChallenge) seenChallenges.add(challengeKey);
    if (!enabled) return;
    const panel = doc.querySelector('.discussion-panel');
    const fresh = previous?.discussionId !== payload.discussionId;
    if (fresh) play(panel, [{ opacity: .65, transform: 'translateY(12px) rotate(.35deg)' }, { opacity: 1, transform: 'translateY(0) rotate(0)' }], { duration: 400 });
    if (newChallenge) {
      const table = doc.getElementById('table-container');
      const notice = doc.querySelector('.discussion-challenge');
      const anchor = visibleRect(table) ? table : visibleRect(notice) ? notice : panel;
      stamp('MENTEUR !', anchor, 'wine', true);
      play(notice, [{ transform: 'translateX(-5px)' }, { transform: 'translateX(4px)', offset: .4 }, { transform: 'translateX(0)' }], { duration: 270 });
    }
    const oldClaims = new Map((previous?.contexts || []).flatMap(context => context.declarations.map(claim => [claim.id, claim.status])));
    for (const context of payload.contexts) {
      let cancelledStamped = false;
      if (context.kind === 'estate' && !previous?.contexts?.some(old => old.id === context.id)) {
        const estate = [...doc.querySelectorAll('.discussion-context')].find(node => node.dataset.contextId === context.id);
        play(estate, [{ transform: 'translateY(15px) rotate(-1deg)', opacity: .6 }, { transform: 'translateY(0) rotate(0)', opacity: 1 }], { duration: 480, delay: 120 });
      }
      for (const claim of context.declarations) {
        if (!oldClaims.has(claim.id) || oldClaims.get(claim.id) === claim.status) continue;
        const row = [...doc.querySelectorAll('.discussion-claim')].find(node => node.dataset.claimId === claim.id);
        if (claim.status === 'proved') stamp('PROUVÉ', row, 'green', false, 150);
        else if (claim.status === 'disproved') stamp('DÉMASQUÉ', row, 'wine', false, 150);
        else if (claim.status === 'cancelled') {
          if (!cancelledStamped) stamp('ANNULÉ', row, 'wine', false, 150);
          cancelledStamped = true;
          play(row, [{ opacity: 1 }, { opacity: .65 }, { opacity: 1 }], { duration: 550 });
        }
      }
    }
    for (const participant of payload.participants) {
      if (!participant.accepted || previous?.participants?.find(old => old.id === participant.id)?.accepted) continue;
      const chip = [...doc.querySelectorAll('.discussion-participant')].find(node => node.dataset.playerId === participant.id);
      play(chip, [{ transform: 'scale(1.12) rotate(-3deg)' }, { transform: 'scale(.98) rotate(1deg)', offset: .6 }, { transform: 'scale(1) rotate(0)' }], { duration: 320 });
    }
  }

  function onTurn({ name, isMine }) {
    const key = name + ':' + isMine + ':' + lastState;
    if (lastTurn === key) return;
    lastTurn = key;
    const meta = doc.querySelector('.player-slot.is-active .player-meta');
    play(meta, [
      { boxShadow: '0 0 0 0 #dcb96d00' },
      { boxShadow: '0 0 0 7px #dcb96d55', offset: .4 },
      { boxShadow: '0 0 0 12px #dcb96d00' }
    ], { duration: 850 });
    if (isMine) play(doc.querySelector('.action-heading, #action-heading'), [{ transform: 'translateY(4px)', opacity: .6 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 380 });
  }

  function onAction() {
    const announcement = doc.getElementById('annonces');
    play(announcement, [{ transform: 'translateY(7px) rotate(-3deg)', opacity: .35 }, { transform: 'translateY(-1px) rotate(1deg)', opacity: 1, offset: .72 }, { transform: 'translateY(0) rotate(0)', opacity: 1 }], { duration: 520 });
  }

  function onLog(text) {
    if (lastLog === text) return;
    lastLog = text;
    const line = doc.querySelector('.journal-entry:last-child');
    if (visibleRect(line)) play(line, [{ transform: 'translateX(-6px)', opacity: .4 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 350 });
  }

  function onEnd({ winnerName, isWinner, aborted }) {
    const key = [winnerName, isWinner, aborted].join(':');
    if (lastEnd === key) return;
    lastEnd = key;
    if (!enabled || aborted) return;
    const result = doc.querySelector('.result-view');
    if (!result) return;
    play(result.querySelector('.icon'), [{ transform: 'translateY(-12px) rotate(-12deg) scale(.8)' }, { transform: 'translateY(2px) rotate(3deg) scale(1.08)', offset: .65 }, { transform: 'translateY(0) rotate(0) scale(1)' }], { duration: 850 });
    const flecks = doc.createElement('div');
    flecks.className = 'fx-victory-flecks';
    flecks.setAttribute('aria-hidden', 'true');
    flecks.inert = true;
    result.appendChild(flecks);
    for (let index = 0; index < 18; index += 1) {
      const fleck = doc.createElement('i');
      fleck.style.left = (8 + (index * 47 % 84)) + '%';
      fleck.style.top = (8 + index % 4 * 5) + '%';
      flecks.appendChild(fleck);
      play(fleck, [
        { transform: 'translateY(-12px) rotate(0deg)', opacity: 0 },
        { opacity: .8, offset: .18 },
        { transform: `translate(${index % 2 ? 28 : -28}px, ${120 + index % 6 * 20}px) rotate(${150 + index * 27}deg)`, opacity: 0 }
      ], { duration: 1500 + index % 5 * 110, delay: index % 6 * 85 }, () => {
        fleck.remove();
        if (!flecks.childElementCount) flecks.remove();
      });
    }
  }

  function clearTilt() {
    if (tiltFrame) window.cancelAnimationFrame(tiltFrame);
    tiltFrame = 0;
    tiltPoint = null;
    if (tiltTarget) {
      tiltTarget.classList.remove('fx-card-tilt');
      tiltTarget.style.removeProperty('--fx-tilt-x');
      tiltTarget.style.removeProperty('--fx-tilt-y');
    }
    tiltTarget = null;
  }

  function onPointerMove(event) {
    if (!enabled || !finePointer?.matches || event.pointerType === 'touch') return;
    const control = event.target.closest?.('.card-inspect, .hero-card-fan [data-inspect-role], .role-lineup [data-inspect-role]');
    const image = control?.querySelector('img');
    if (!image || control.disabled) { clearTilt(); return; }
    if (tiltTarget !== image) { clearTilt(); tiltTarget = image; }
    tiltPoint = { x: event.clientX, y: event.clientY, control };
    if (tiltFrame) return;
    tiltFrame = window.requestAnimationFrame(() => {
      tiltFrame = 0;
      if (!tiltPoint || !tiltTarget?.isConnected || !enabled) return;
      const box = tiltPoint.control.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const x = Math.max(-.5, Math.min(.5, (tiltPoint.x - box.left) / box.width - .5));
      const y = Math.max(-.5, Math.min(.5, (tiltPoint.y - box.top) / box.height - .5));
      tiltTarget.classList.add('fx-card-tilt');
      tiltTarget.style.setProperty('--fx-tilt-x', (-y * 11).toFixed(2) + 'deg');
      tiltTarget.style.setProperty('--fx-tilt-y', (x * 13).toFixed(2) + 'deg');
    });
  }

  function stopEffects() {
    [...animations].forEach(animation => animation.cancel());
    animations.clear();
    [...timers].forEach(clearTimer);
    layer.replaceChildren();
    doc.querySelectorAll('.fx-victory-flecks').forEach(node => node.remove());
    clearTilt();
  }

  function updatePreference() {
    enabled = preference !== 'reduced' && !reduced?.matches;
    doc.body.dataset.motion = enabled ? 'full' : 'reduced';
    const toggle = doc.getElementById('motion-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(enabled));
      toggle.setAttribute('aria-label', reduced?.matches ? 'Animations réduites selon tes réglages système' : enabled ? 'Réduire les animations' : 'Activer les animations');
      toggle.title = reduced?.matches ? 'Les animations sont réduites par tes réglages système.' : enabled ? 'Réduire les animations de la table' : 'Activer les animations de la table';
      toggle.disabled = Boolean(reduced?.matches);
      const label = toggle.querySelector('span') || toggle.appendChild(doc.createElement('span'));
      label.textContent = enabled ? 'Animations' : 'Animations réduites';
    }
    if (!enabled) stopEffects();
  }

  const toggleMotion = safe(() => {
    preference = enabled ? 'reduced' : 'full';
    try { localStorage.setItem('magouille.motion', preference); } catch { /* Facultatif. */ }
    updatePreference();
  });
  const preferenceChanged = safe(() => { preference = readPreference(); updatePreference(); });
  doc.getElementById('motion-toggle')?.addEventListener('click', toggleMotion);
  reduced?.addEventListener?.('change', preferenceChanged);
  doc.addEventListener('pointermove', onPointerMove, { passive: true });
  doc.addEventListener('pointerleave', clearTilt);
  window.addEventListener('blur', clearTilt);
  window.addEventListener('storage', event => { if (event.key === 'magouille.motion') preferenceChanged(); });
  updatePreference();

  return {
    onState: safe(onState), onDiscussion: safe(onDiscussion), onTurn: safe(onTurn),
    onAction: safe(onAction), onLog: safe(onLog), onEnd: safe(onEnd),
    reset: safe(() => {
      stopEffects();
      lastState = lastDiscussion = lastTurn = lastEnd = lastLog = '';
      seenChallenges.clear();
      seenDeals.clear();
    })
  };
}

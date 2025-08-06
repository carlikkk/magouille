// public/client.js
// Interface client pour Complots 2 – version complète mise à jour

import { renderCard, renderCardBack } from './cards.js';

const socket = io();
let playerName = null;
let currentState = null;

// Sélecteurs DOM
const etatDiv        = document.getElementById('etat');
const journalDiv     = document.getElementById('journal');
const actionsDiv     = document.getElementById('actions');
const annoncesDiv    = document.getElementById('annonces');
const votesDiv       = document.getElementById('votes');
const tableSlots     = {
  top:    document.getElementById('joueur-top'),
  right:  document.getElementById('joueur-right'),
  bottom: document.getElementById('joueur-bottom'),
  left:   document.getElementById('joueur-left')
};
const piocheCount    = document.getElementById('nb-pioche');

// 1. IDENTIFICATION & SALLE D’ATTENTE
playerName = prompt("Ton prénom ?");
const choice = prompt("Nouvelle partie (n) ou Rejoindre (r) ?");
if (choice === 'n') {
  socket.emit('creerPartie', playerName, res => {
    if (res.ok) {
      etatDiv.textContent = `✅ Partie créée – Code : ${res.code}`;
    }
  });
} else {
  const code = prompt("Code de la partie ?");
  socket.emit('rejoindrePartie', code, playerName, res => {
    if (!res.ok) alert(res.message);
  });
}

socket.on('etatSalle', ({ code, joueurs }) => {
  etatDiv.textContent = `🎲 Partie ${code} – Joueurs : ${joueurs.join(', ')}`;
});

// 2. DISTRIBUTION INITIALE
socket.on('cartesDistribuees', cartes => {
  alert(`🃏 Tes cartes : ${cartes.join(' / ')}`);
});

// 3. MISE À JOUR D’ÉTAT GLOBALE
socket.on('stateUpdate', state => {
  currentState = state;
  renderCircle(state);
  piocheCount.textContent = `${state.deckCount} carte${state.deckCount > 1 ? 's' : ''}`;
});

// 4. JOURNAL
socket.on('logUpdate', line => {
  journalDiv.innerText += line + '\n';
  journalDiv.scrollTop = journalDiv.scrollHeight;
});

// 5. TOUR & ACTIONS DISPONIBLES
socket.on('nouveauTour', ({ joueurActif }) => {
  etatDiv.textContent = `🎯 Tour de ${joueurActif}`;
  annoncesDiv.innerHTML = '';
  votesDiv.innerHTML = '';
  actionsDiv.innerHTML = '';

  if (joueurActif === playerName && currentState) {
    const me = currentState.players.find(p => p.name === playerName);
    const forced = me.coins >= 10;
    const options = forced
      ? [{ action: 'Assassinat', targetable: true }]
      : [
          { action: 'Revenu', targetable: false },
          { action: 'Aide étrangère', targetable: false },
          { action: 'Assassinat', targetable: true },
          { action: 'Illusionniste', targetable: false },
          { action: 'Croque-Mort', targetable: false },
          { action: 'Pape', targetable: false },
          { action: 'Maître-Chanteur', targetable: true },
          { action: 'Espion', targetable: false }
        ];
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.textContent = opt.action;
      btn.disabled = forced && opt.action !== 'Assassinat';
      btn.onclick = () => chooseAction(opt);
      actionsDiv.appendChild(btn);
    });
  }
});

// Sélection et annonce d’une action
function chooseAction({ action, targetable }) {
  if (targetable) {
    const cible = prompt("Choisis une cible (nom exact) :");
    if (!cible) return;
    socket.emit('jouerAction', { action, target: cible }, () => {});
  } else {
    socket.emit('jouerAction', { action, target: null }, () => {});
  }
  actionsDiv.innerHTML = '';
}

// 6. ANNONCE & VOTE
socket.on('actionAnnoncee', ({ joueur, role, description, cible }) => {
  annoncesDiv.innerHTML += `<p>🗣️ ${joueur} annonce <strong>${description}</strong>${cible ? ' ➜ '+cible : ''}</p>`;
  votesDiv.innerHTML = '';

  if (joueur !== playerName) {
    // Boutons Mentir ou OK
    const btnLie = document.createElement('button');
    btnLie.textContent = 'Menteur !';
    btnLie.onclick = () => {
      socket.emit('voteAction', 'menteur');
      disableVoteButtons();
    };

    const btnOk = document.createElement('button');
    btnOk.textContent = 'Non menteur';
    btnOk.onclick = () => {
      socket.emit('voteAction', 'ok');
      disableVoteButtons();
    };

    votesDiv.appendChild(btnLie);
    votesDiv.appendChild(btnOk);

    // Spécifique Illusionniste
    if (role === 'Illusionniste') {
      const btnIllu = document.createElement('button');
      btnIllu.textContent = 'Moi aussi Illusionniste';
      btnIllu.onclick = () => {
        socket.emit('revendiquerIllusionniste');
        btnIllu.disabled = true;
      };
      votesDiv.appendChild(btnIllu);
    }
  }
});

function disableVoteButtons() {
  votesDiv.querySelectorAll('button').forEach(b => (b.disabled = true));
}

// 7. CONTRE-ATTAQUE
socket.on('counterRequested', ({ role, actor }) => {
  if (actor === playerName) return; // pas soi-même
  votesDiv.innerHTML = '';
  const btnCounter = document.createElement('button');
  btnCounter.textContent = 'Contre !';
  btnCounter.onclick = () => {
    socket.emit('counterAction');
    btnCounter.disabled = true;
  };
  votesDiv.appendChild(btnCounter);
});

// 8. MAÎTRE-CHANTEUR
socket.on('maitreChanteurDemand', ({ from }) => {
  const choix = confirm(`${from} te demande 3 pièces. OK pour payer et garder tes cartes, Annuler pour perdre une vie.`);
  socket.emit('maitreChanteurResponse', choix ? 'payer' : 'refuser');
});

// 9. ESPION
socket.on('choixEspionCartes', ({ main, piochée }) => {
  // Affiche trois boutons mêlant main + piochée
  const ensemble = [...main, piochée];
  const sel = [];
  const cont = document.createElement('div');
  cont.innerHTML = '<p>🕵️ Choisis 2 cartes à garder :</p>';
  ensemble.forEach(r => {
    const b = document.createElement('button');
    b.textContent = r;
    b.onclick = () => {
      if (sel.includes(r)) return;
      sel.push(r);
      b.disabled = true;
      if (sel.length === 2) {
        const defausse = ensemble.filter(x => !sel.includes(x));
        socket.emit('choixEspion', { garder: sel, defausse });
        cont.remove();
      }
    };
    cont.appendChild(b);
  });
  document.body.appendChild(cont);
});

// 10. FIN DE PARTIE
socket.on('gameEnded', winner => {
  alert(`🏆 Partie terminée ! Victoire de ${winner}`);
  actionsDiv.innerHTML = '';
  votesDiv.innerHTML   = '';
});

// 11. RENDU CERCLE DE JOUEURS
function renderCircle(state) {
  state.players.forEach((p,i) => {
    const pos = ['top','right','bottom','left'][i];
    const slot = tableSlots[pos];
    if (!slot) return;
    if (!p || !p.isAlive) {
      slot.innerHTML = '<em>Éliminé ou absent</em>';
      return;
    }
    const isMe = p.name === playerName;
    const cardsHTML = p.hand.map(c =>
      isMe || p.revealed.includes(c)
        ? renderCard(c).outerHTML
        : renderCardBack().outerHTML
    ).join('');
    slot.innerHTML = `
      <strong>${p.name}</strong><br>
      <div class="pieces">💰 ${p.coins}</div>
      <div class="cartes">${cardsHTML}</div>
    `;
  });
}
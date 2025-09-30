function startGameClient(room, myname) {
  const socket = io();
  let cardCount = 0;
  let revealed = [];
  let temp = [];
  let players = [];
  let myIndex = null;
  let currentTurn = null;
  let isProcessing = false;

  socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('join_room', { room: room, name: myname });
    socket.emit('create_room', { room: room, name: myname });
  });

  socket.on('game_started', (data) => {
    console.log('Game started:', data);
    cardCount = data.card_count;
    players = data.players;
    currentTurn = data.current_turn;
    renderBoard(cardCount);
    renderPlayers(players);
    updateTurnInfo();
  });

  socket.on('board_state', (data) => {
    console.log('Board state update:', data);
    revealed = data.revealed;
    temp = data.temp;
    players = data.players;
    currentTurn = data.current_turn;
    updateTurnInfo();
    renderPlayers(players);
    updateMatchCount();
  });

  socket.on('card_flipped', (data) => {
    console.log('Card flipped:', data);
    showCardFlip(data.index, data.value);
  });

  socket.on('match_result', (data) => {
    console.log('Match result:', data);
    isProcessing = true;
    
    if (data.match) {
      // Show success animation
      data.indices.forEach(i => markAsMatched(i));
      playMatchSound();
      setTimeout(() => {
        isProcessing = false;
      }, 800);
    } else {
      // Show mismatch and flip back
      setTimeout(() => {
        data.indices.forEach(i => flipCardBack(i));
        isProcessing = false;
      }, 1500);
    }
  });

  socket.on('game_over', (data) => {
    console.log('Game over:', data);
    players = data.players;
    renderPlayers(players);
    showWinnerModal(data.players);
  });

  socket.on('error', (d) => {
    console.error('Error:', d);
    showNotification(d.msg || 'An error occurred', 'error');
  });

  socket.on('turn_error', (d) => {
    showNotification(d.msg || "It's not your turn!", 'warning');
  });

  socket.on('join_failed', (d) => {
    alert(d.reason);
    window.location = '/';
  });

  // Render the game board
  function renderBoard(n) {
    const board = document.getElementById('board');
    board.innerHTML = '';
    
    if (!n) {
      board.innerHTML = `
        <div class="loading-message">
          <div class="spinner"></div>
          <p>Waiting for game to start...</p>
        </div>
      `;
      return;
    }

    for (let i = 0; i < n; i++) {
      const card = document.createElement('div');
      card.classList.add('card');
      card.dataset.index = i;
      
      // Create card back
      const cardBack = document.createElement('div');
      cardBack.classList.add('card-face', 'card-back');
      
      // Create card front
      const cardFront = document.createElement('div');
      cardFront.classList.add('card-face', 'card-front');
      cardFront.textContent = '';
      
      card.appendChild(cardBack);
      card.appendChild(cardFront);
      
      // Check if already revealed
      if (revealed[i]) {
        card.classList.add('flipped', 'matched');
      }
      
      card.addEventListener('click', () => onCardClick(i));
      board.appendChild(card);
    }
  }

  // Handle card click
  function onCardClick(index) {
    if (isProcessing) {
      showNotification('Please wait...', 'info');
      return;
    }

    if (currentTurn === null) {
      showNotification('Game is loading...', 'info');
      return;
    }

    // Determine my index
    if (myIndex === null) {
      myIndex = players.findIndex(p => p.name === myname);
    }

    if (currentTurn !== myIndex) {
      showNotification("Not your turn!", 'warning');
      return;
    }

    const card = document.querySelector(`.card[data-index="${index}"]`);
    if (card.classList.contains('flipped') || card.classList.contains('matched')) {
      showNotification('Card already revealed', 'warning');
      return;
    }

    // Request flip from server
    socket.emit('flip_card', { room: room, index: index });
  }

  // Show card flip animation
  function showCardFlip(index, value) {
    const card = document.querySelector(`.card[data-index="${index}"]`);
    if (!card) return;

    card.classList.add('flipped');
    const cardFront = card.querySelector('.card-front');
    cardFront.textContent = value;
  }

  // Flip card back (no match)
  function flipCardBack(index) {
    const card = document.querySelector(`.card[data-index="${index}"]`);
    if (!card) return;

    card.classList.remove('flipped');
    const cardFront = card.querySelector('.card-front');
    setTimeout(() => {
      cardFront.textContent = '';
    }, 600);
  }

  // Mark card as matched
  function markAsMatched(index) {
    const card = document.querySelector(`.card[data-index="${index}"]`);
    if (!card) return;

    card.classList.add('matched');
  }

  // Render players list
  function renderPlayers(playerList) {
    const container = document.getElementById('playersList');
    container.innerHTML = '';

    const emojis = ['🎮', '🎯', '🎨', '🎪', '🎭', '🎸', '🏀', '⚽'];

    playerList.forEach((p, i) => {
      const playerItem = document.createElement('div');
      playerItem.classList.add('player-item');
      
      if (i === currentTurn) {
        playerItem.classList.add('active');
      }

      playerItem.innerHTML = `
        <div class="player-name-score">
          <span class="player-emoji">${emojis[i % emojis.length]}</span>
          <div class="player-details">
            <span>${p.name}</span>
            <span>${i === currentTurn ? 'Playing...' : 'Waiting'}</span>
          </div>
        </div>
        <span class="player-score">${p.score} 🏆</span>
      `;

      container.appendChild(playerItem);
    });
  }

  // Update turn indicator
  function updateTurnInfo() {
    const turnPlayer = document.getElementById('turnPlayer');
    if (currentTurn === null || !players[currentTurn]) {
      turnPlayer.textContent = 'Loading...';
      return;
    }

    const currentPlayerName = players[currentTurn].name;
    turnPlayer.textContent = currentPlayerName;

    // Highlight if it's my turn
    if (myIndex === currentTurn) {
      turnPlayer.style.color = '#10b981';
      showNotification("It's your turn!", 'success');
    } else {
      turnPlayer.style.color = '#6366f1';
    }
  }

  // Update match count
  function updateMatchCount() {
    const totalMatchesEl = document.getElementById('totalMatches');
    if (!totalMatchesEl) return;

    const matchedCount = revealed.filter(r => r).length / 2;
    const totalPairs = cardCount / 2;
    totalMatchesEl.textContent = `${matchedCount}/${totalPairs}`;
  }

  // Show winner modal
  function showWinnerModal(playerList) {
    const modal = document.getElementById('winnerModal');
    const winnerInfo = document.getElementById('winnerInfo');

    // Sort players by score
    const sortedPlayers = [...playerList].sort((a, b) => b.score - a.score);
    const maxScore = sortedPlayers[0].score;
    const winners = sortedPlayers.filter(p => p.score === maxScore);

    let html = '';
    
    if (winners.length === 1) {
      html = `<p style="font-size: 1.5rem; margin-bottom: 1rem;">🏆 Winner: <strong>${winners[0].name}</strong></p>`;
    } else {
      html = `<p style="font-size: 1.5rem; margin-bottom: 1rem;">🏆 It's a tie!</p>`;
    }

    html += '<div class="winner-list">';
    sortedPlayers.forEach((p, i) => {
      html += `
        <div class="winner-item ${i === 0 ? 'first' : ''}">
          <span class="winner-name">${i + 1}. ${p.name}</span>
          <span class="winner-score">${p.score} points</span>
        </div>
      `;
    });
    html += '</div>';

    winnerInfo.innerHTML = html;
    modal.style.display = 'flex';
  }

  // Play match sound (simple beep using Web Audio API)
  function playMatchSound() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (e) {
      // Audio not supported, silently fail
    }
  }

  // Show notification
  function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    const colors = {
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#6366f1'
    };

    notification.style.cssText = `
      position: fixed;
      top: 2rem;
      right: 2rem;
      background: ${colors[type]};
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      z-index: 10000;
      font-weight: 600;
      animation: slideInRight 0.3s ease-out;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // Leave button
  document.getElementById('leaveBtn').addEventListener('click', () => {
    if (confirm('Are you sure you want to leave the game?')) {
      socket.emit('leave_room', { room: room });
      window.location = '/';
    }
  });

  // Back to home button in modal
  const backToHomeBtn = document.getElementById('backToHomeBtn');
  if (backToHomeBtn) {
    backToHomeBtn.addEventListener('click', () => {
      window.location = '/';
    });
  }
}

// Add notification animations to document
if (!document.getElementById('notification-styles')) {
  const style = document.createElement('style');
  style.id = 'notification-styles';
  style.textContent = `
    @keyframes slideInRight {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    @keyframes slideOutRight {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}
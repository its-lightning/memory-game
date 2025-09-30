function startGameClient(room, myname) {
  const socket = io();
  let cardCount = 0;
  let revealed = [];
  let temp = [];
  let players = [];
  let myIndex = null;
  let currentTurn = null;

  socket.on('connect', () => {
    // attempt to join (if this client came from lobby)
    socket.emit('join_room', { room: room, name: myname });
    socket.emit('create_room', { room: room, name: myname }); // harmless: create will fail if exists
  });

  socket.on('game_started', (data) => {
    cardCount = data.card_count;
    players = data.players;
    renderBoard(cardCount);
    renderPlayers(players);
    currentTurn = data.current_turn;
    updateTurnInfo();
  });

  socket.on('board_state', (data) => {
    revealed = data.revealed;
    temp = data.temp;
    players = data.players;
    currentTurn = data.current_turn;
    renderBoard(cardCount);
    renderPlayers(players);
    updateTurnInfo();
  });

  socket.on('card_flipped', (data) => {
    // show the value temporarily
    showTemporaryFlip(data.index, data.value);
  });

  socket.on('match_result', (data) => {
    if (data.match) {
      // mark indices as revealed
      data.indices.forEach(i => markRevealed(i));
    } else {
      // visually show them then flip back after a short delay
      setTimeout(() => {
        hideTemporary(data.indices);
      }, 700);
    }
  });

  socket.on('game_over', (data) => {
    players = data.players;
    renderPlayers(players);
    const winner = players.reduce((a,b) => a.score > b.score ? a : b);
    alert('Game over! Winner: ' + winner.name + ' (' + winner.score + ' points)');
    window.location = '/';
  });

  socket.on('error', (d) => alert(d.msg || JSON.stringify(d)));
  socket.on('join_failed', (d) => { alert(d.reason); window.location = '/'; });

  function renderBoard(n) {
    const board = document.getElementById('board');
    board.innerHTML = '';
    if (!n) {
      board.innerHTML = '<p>Waiting for host to start the game...</p>';
      return;
    }
    for (let i=0;i<n;i++) {
      const tile = document.createElement('div');
      tile.classList.add('tile');
      tile.dataset.index = i;
      if (revealed[i]) {
        tile.classList.add('revealed');
        tile.textContent = '✔'; // matched
        tile.style.cursor = 'default';
      } else if (temp.includes(i)) {
        tile.classList.remove('face-down');
        tile.textContent = '?'; // temporary (value will be filled by card_flipped event)
      } else {
        tile.classList.add('face-down');
        tile.textContent = '';
      }
      tile.addEventListener('click', onTileClick);
      board.appendChild(tile);
    }
  }

  function onTileClick(e) {
    const idx = parseInt(e.currentTarget.dataset.index);
    // only allow click if it's this player's turn
    if (currentTurn === null) {
      alert('Waiting for game to start or sync.');
      return;
    }
    if (myIndex === null) {
      // Figure out my index by matching player name and socket id isn't available on client side
      // We'll find by matching name (works for this demo). If duplicate names exist, server-side index mapping is better.
      for (let i=0;i<players.length;i++) {
        if (players[i].name === myname) { myIndex = i; break; }
      }
    }
    if (currentTurn !== myIndex) {
      alert('Not your turn');
      return;
    }
    // request flip
    socket.emit('flip_card', { room: room, index: idx });
  }

  function showTemporaryFlip(index, value) {
    const tiles = document.querySelectorAll('.tile');
    const tile = tiles[index];
    if (!tile) return;
    tile.classList.remove('face-down');
    tile.textContent = value;
  }

  function hideTemporary(indices) {
    indices.forEach(i => {
      const tiles = document.querySelectorAll('.tile');
      const tile = tiles[i];
      if (!tile) return;
      // if not permanently revealed, hide it
      if (!revealed[i]) {
        tile.classList.add('face-down');
        tile.textContent = '';
      }
    });
  }

  function markRevealed(index) {
    const tiles = document.querySelectorAll('.tile');
    const tile = tiles[index];
    if (!tile) return;
    tile.classList.remove('face-down');
    tile.classList.add('revealed');
    tile.textContent = '✔';
  }

  function renderPlayers(list) {
    const ul = document.getElementById('players');
    ul.innerHTML = '';
    list.forEach((p, i) => {
      const li = document.createElement('li');
      li.textContent = p.name + ' — ' + p.score;
      if (i === currentTurn) {
        li.style.fontWeight = '700';
      }
      ul.appendChild(li);
    });
  }

  function updateTurnInfo() {
    const info = document.getElementById('turnInfo');
    if (currentTurn === null) {
      info.textContent = 'Waiting...';
      return;
    }
    info.textContent = 'Current turn: ' + (players[currentTurn] ? players[currentTurn].name : '—');
  }

  document.getElementById('leaveBtn').addEventListener('click', () => {
    socket.emit('leave_room', { room: room });
    window.location = '/';
  });
}

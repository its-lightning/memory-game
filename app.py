# app.py
from flask import Flask, render_template, request, redirect, url_for
from flask_socketio import SocketIO, join_room, leave_room, emit
import secrets
import string
import random
from dataclasses import dataclass, field
from typing import List, Dict, Optional

# Force threading async mode (no eventlet)
async_mode_choice = "threading"

app = Flask(__name__)
app.config["SECRET_KEY"] = "replace-this-with-a-secure-key"

socketio = SocketIO(app, cors_allowed_origins="*", async_mode=async_mode_choice)

def generate_room_code(length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))

def generate_cards(pair_count: int = 8) -> List[str]:
    # Generate pair_count distinct values (A, B, C...) and duplicate them
    base = [chr(ord("A") + i) for i in range(pair_count)]
    cards = base + base[:]
    random.shuffle(cards)
    return cards

@dataclass
class Player:
    sid: str
    name: str
    score: int = 0

@dataclass
class GameState:
    room_code: str
    host_sid: Optional[str] = None
    cards: List[str] = field(default_factory=list)
    revealed: List[bool] = field(default_factory=list)   # permanently matched
    temp_flips: List[int] = field(default_factory=list)  # currently flipped indices (max 2)
    players: List[Player] = field(default_factory=list)
    current_turn: int = 0
    started: bool = False

# In-memory storage (suitable for local development)
games: Dict[str, GameState] = {}

# ---------- HTTP routes ----------

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/create", methods=["POST"])
def create():
    """
    Host requests a new room. Generate a room code, create GameState immediately
    (so the lobby exists before the host socket connects) and redirect to lobby.
    """
    name = request.form.get("name", "Host")
    room_code = generate_room_code()

    # Create GameState so room exists immediately (host_sid will be set later when socket connects)
    cards = generate_cards(pair_count=8)
    games[room_code] = GameState(
        room_code=room_code,
        host_sid=None,
        cards=cards,
        revealed=[False] * len(cards),
        players=[]
    )

    return redirect(url_for("lobby", room=room_code, name=name))

@app.route("/join", methods=["POST"])
def join_post():
    """
    Player posts a room + name to join. Redirect to lobby URL.
    """
    name = request.form.get("name", "Player")
    room = request.form.get("room", "").upper().strip()
    if not room:
        return redirect(url_for("index"))
    return redirect(url_for("lobby", room=room, name=name))

@app.route("/lobby/<room>")
def lobby(room: str):
    """
    Render lobby page for a given room code.
    The `room` param comes from the URL path; player name may be passed in querystring.
    """
    name = request.args.get("name", "Player")
    return render_template("lobby.html", room=room.upper(), name=name)

@app.route("/game/<room>")
def game(room: str):
    """
    Game page (after the host starts the game).
    """
    name = request.args.get("name", "Player")
    return render_template("game.html", room=room.upper(), name=name)

# ---------- Socket.IO events ----------

@socketio.on("connect")
def on_connect():
    # nothing special on low-level connect
    pass

@socketio.on("create_room")
def on_create_room(data):
    """
    Client asks to create a room (host). Two supported cases:
    1) Room was NOT created by HTTP earlier -> create it now and register host.
    2) Room WAS created by HTTP (host arrived at lobby) -> claim it (set host_sid) and add host as player.
    """
    name = (data.get("name") or "Host").strip()
    room = (data.get("room") or generate_room_code()).upper()
    sid = request.sid

    if room not in games:
        # create new state
        cards = generate_cards(pair_count=8)
        state = GameState(room_code=room, host_sid=sid, cards=cards, revealed=[False] * len(cards))
        state.players.append(Player(sid=sid, name=name))
        games[room] = state
        join_room(room)
        emit("room_created", {"room": room})
        emit_lobby_update(room)
        return

    # room exists already (likely created via HTTP). Claim it if host not set.
    state = games[room]
    if state.host_sid is None:
        state.host_sid = sid
        # add host player if not already present
        if not any(p.sid == sid for p in state.players):
            state.players.insert(0, Player(sid=sid, name=name))
        join_room(room)
        emit("room_created", {"room": room})
        emit_lobby_update(room)
        return

    # If host already set and this sid is not the host, fail to create
    if state.host_sid != sid:
        emit("create_failed", {"reason": "Room already has a host"})
        return

    # If same host reconnected, just re-ack
    emit("room_created", {"room": room})
    emit_lobby_update(room)

@socketio.on("join_room")
def on_join_room(data):
    """
    Client asks to join an existing room.
    """
    name = (data.get("name") or "Player").strip()
    room = (data.get("room") or "").upper().strip()
    sid = request.sid

    if not room or room not in games:
        emit("join_failed", {"reason": "Room does not exist"})
        return

    state = games[room]

    # If the same socket already exists as a player, acknowledge
    if any(p.sid == sid for p in state.players):
        emit("join_ok", {"room": room})
        return

    # Add new player
    state.players.append(Player(sid=sid, name=name))
    join_room(room)
    emit("join_ok", {"room": room})
    emit_lobby_update(room)

@socketio.on("start_game")
def on_start_game(data):
    room = (data.get("room") or "").upper().strip()
    sid = request.sid

    if not room or room not in games:
        emit("error", {"msg": "Room not found"})
        return

    state = games[room]
    if state.host_sid is None or sid != state.host_sid:
        emit("error", {"msg": "Only the host can start the game"})
        return

    state.started = True
    state.current_turn = 0
    # broadcast game start
    emit(
        "game_started",
        {
            "card_count": len(state.cards),
            "players": [{"name": p.name, "score": p.score} for p in state.players],
            "current_turn": state.current_turn,
        },
        room=room,
    )
    emit_board_state(room)

@socketio.on("flip_card")
def on_flip_card(data):
    room = (data.get("room") or "").upper().strip()
    try:
        idx = int(data.get("index", -1))
    except Exception:
        idx = -1
    sid = request.sid

    if not room or room not in games:
        emit("error", {"msg": "Room not found"})
        return

    state = games[room]
    # determine player index from sid
    player_index: Optional[int] = next((i for i, p in enumerate(state.players) if p.sid == sid), None)
    if player_index is None:
        emit("error", {"msg": "You are not in this room"})
        return

    # enforce turn order
    if state.current_turn != player_index:
        emit("turn_error", {"msg": "Not your turn"})
        return

    if idx < 0 or idx >= len(state.cards):
        emit("error", {"msg": "Invalid card index"})
        return

    if state.revealed[idx] or idx in state.temp_flips:
        emit("error", {"msg": "Card already matched or currently flipped"})
        return

    # register temporary flip and broadcast its value
    state.temp_flips.append(idx)
    emit("card_flipped", {"index": idx, "value": state.cards[idx]}, room=room)

    # If two cards are flipped, evaluate
    if len(state.temp_flips) == 2:
        i1, i2 = state.temp_flips
        if state.cards[i1] == state.cards[i2]:
            # match
            state.revealed[i1] = True
            state.revealed[i2] = True
            state.players[player_index].score += 1
            emit("match_result", {"match": True, "indices": [i1, i2], "player": player_index}, room=room)
            state.temp_flips = []

            # Check for game end
            if all(state.revealed):
                emit("game_over", {"players": [{"name": p.name, "score": p.score} for p in state.players]}, room=room)
                # Cleanup memory for finished room
                del games[room]
                return

            # same player goes again -> do not change state.current_turn
            emit_board_state(room)
            emit_lobby_update(room)
        else:
            # not a match -> notify, then pause briefly and advance turn
            emit("match_result", {"match": False, "indices": [i1, i2], "player": player_index}, room=room)
            # server-side sleep: safe with eventlet; short-block when threading (acceptable for dev)
            socketio.sleep(1.0)
            state.temp_flips = []
            state.current_turn = (state.current_turn + 1) % max(1, len(state.players))
            emit_board_state(room)
            emit_lobby_update(room)

# ---------- helpers to broadcast state ----------

def emit_board_state(room: str):
    if room not in games:
        return
    state = games[room]
    emit(
        "board_state",
        {
            "revealed": state.revealed,
            "temp": state.temp_flips,
            "players": [{"name": p.name, "score": p.score} for p in state.players],
            "current_turn": state.current_turn,
        },
        room=room,
    )

def emit_lobby_update(room: str):
    if room not in games:
        return
    state = games[room]
    emit(
        "lobby_update",
        {
            "room": room,
            "players": [{"name": p.name} for p in state.players],
            "host": next((p.name for p in state.players if p.sid == state.host_sid), None),
            "started": state.started,
        },
        room=room,
    )

# ---------- leaving / disconnect ----------

@socketio.on("leave_room")
def on_leave_room(data):
    room = (data.get("room") or "").upper().strip()
    sid = request.sid

    if not room or room not in games:
        return

    state = games[room]
    state.players = [p for p in state.players if p.sid != sid]
    leave_room(room)
    if state.players:
        # if the host left, promote the first player to host
        if state.host_sid == sid:
            state.host_sid = state.players[0].sid
        emit_lobby_update(room)
    else:
        # no players left -> remove room
        del games[room]

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    rooms_to_delete = []
    for room, state in list(games.items()):
        if any(p.sid == sid for p in state.players):
            state.players = [p for p in state.players if p.sid != sid]
            # if host left, promote another player
            if state.host_sid == sid and state.players:
                state.host_sid = state.players[0].sid
            if state.players:
                emit_lobby_update(room)
            else:
                rooms_to_delete.append(room)
    for r in rooms_to_delete:
        del games[r]

# ---------- run ----------

if __name__ == "__main__":
    print(f"Starting server with async_mode='{async_mode_choice}'")
    socketio.run(app, host="0.0.0.0", port=5000)

import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChatPanel } from "../components/ChatPanel.jsx";
import { DrawingCanvas } from "../components/DrawingCanvas.jsx";
import { DrawingToolbar } from "../components/DrawingToolbar.jsx";
import { GuessPanel } from "../components/GuessPanel.jsx";
import { Logo } from "../components/Layout.jsx";
import { Modal } from "../components/Modal.jsx";
import { PlayerList } from "../components/PlayerList.jsx";
import { TimerRing } from "../components/TimerRing.jsx";
import { WordDisplay } from "../components/WordDisplay.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { useServerCountdown } from "../hooks/useServerCountdown.js";
import { emitWithAck, connectSocket, takePendingRoomSocket } from "../lib/socket.js";
function mergeStrokeSegment(current, segment) {
  const index = current.findIndex((stroke) => stroke.id === segment.id);
  if (index === -1) {
    return [...current, { ...segment, points: [...segment.points] }];
  }
  const existing = current[index];
  const next = [...current];
  next[index] = { ...existing, points: [...existing.points, ...segment.points] };
  return next;
}
function RoomPage() {
  const { code } = useParams();
  const roomCode = (code ?? "").toUpperCase();
  const { user } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const joinedRef = useRef(false);
  const leavingRef = useRef(false);
  const socketRef = useRef(null);
  const [room, setRoom] = useState(null);
  const [strokes, setStrokes] = useState([]);
  const [joining, setJoining] = useState(true);
  const [connected, setConnected] = useState(false);
  const [fatal, setFatal] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [guessFeedback, setGuessFeedback] = useState(null);
  const [color, setColor] = useState("#171727");
  const [brushWidth, setBrushWidth] = useState(5);
  const [tool, setTool] = useState("pen");
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [clearOpen, setClearOpen] = useState(false);
  const [kickTarget, setKickTarget] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState("");
  const [reporting, setReporting] = useState(false);
  const drawingErrorAt = useRef(0);
  const countdown = useServerCountdown(room?.roundEndsAt ?? null, room?.serverNow ?? Date.now());
  const requestFreshState = useCallback(() => {
    const current = socketRef.current;
    if (!current?.connected) return;
    current.emit("game:requestState", {}, (response) => {
      if (response?.ok && response.data) {
        setRoom(response.data);
        setStrokes(response.data.strokes);
      }
    });
  }, []);
  useEffect(() => {
    if (!user || !/^[A-Z2-9]{6}$/.test(roomCode)) {
      setFatal({ title: "Invalid room code", message: "Room codes are six characters." });
      setJoining(false);
      return;
    }
    let disposed = false;
    const currentSocket = takePendingRoomSocket() ?? connectSocket();
    socketRef.current = currentSocket;
    let joinInFlight = false;
    const joinRoom = async () => {
      if (disposed || joinInFlight) return;
      joinInFlight = true;
      try {
        const response = await emitWithAck(currentSocket, "room:join", { code: roomCode });
        if (disposed) return;
        if (!response.ok) {
          setFatal({ title: "Unable to enter this room", message: response.error.message });
          setJoining(false);
          currentSocket.disconnect();
          return;
        }
        joinedRef.current = true;
        setRoom(response.data.state);
        setStrokes(response.data.state.strokes);
        setJoining(false);
        setFatal(null);
        setConnected(true);
      } finally {
        joinInFlight = false;
      }
    };
    const onConnect = () => {
      if (disposed) return;
      setConnected(true);
      setFatal(null);
      void joinRoom();
    };
    const onDisconnect = (reason) => {
      if (disposed) return;
      setConnected(false);
      if (reason === "io server disconnect") {
        setFatal({
          title: "Connection ended",
          message: "The server ended this session. Rejoin from mission control."
        });
      } else if (reason !== "io client disconnect") {
        pushToast("Connection lost. Trying to reconnect\u2026", "info");
      }
    };
    const onConnectError = (error) => {
      if (disposed) return;
      setConnected(false);
      if (error.message === "UNAUTHENTICATED") {
        pushToast("Your session expired. Please sign in again.", "error");
        navigate("/login", { replace: true, state: { from: `/room/${roomCode}` } });
        return;
      }
      if (error.message === "SERVER_BUSY" || error.message === "TOO_MANY_CONNECTIONS") {
        setFatal({
          title: "Too many connections",
          message: "The server is at capacity right now. Try again in a moment."
        });
        setJoining(false);
        return;
      }
      pushToast("Still trying to reach the room\u2026", "info");
    };
    const onRoomState = (next) => {
      setRoom(next);
      setStrokes(next.strokes);
      setJoining(false);
      setFatal(null);
      joinedRef.current = true;
    };
    const onRoundStarted = (payload) => {
      setRoom(
        (previous) => previous ? {
          ...previous,
          phase: "round",
          roundNumber: payload.roundNumber,
          currentDrawerId: payload.drawerId,
          currentDrawerName: payload.drawerName,
          roundEndsAt: payload.endsAt,
          serverNow: payload.serverNow,
          word: payload.word ?? null,
          hint: payload.hint,
          maskedGuesses: [],
          lastRound: null,
          gameOver: null
        } : previous
      );
      setStrokes([]);
      setGuessFeedback(null);
      setAnnouncement(
        `Round ${payload.roundNumber}. ${payload.drawerName} is drawing. ${countdown.seconds} seconds on the clock.`
      );
    };
    const onTimer = (payload) => {
      setRoom(
        (previous) => previous ? { ...previous, roundEndsAt: payload.endsAt, serverNow: payload.serverNow } : previous
      );
    };
    const onHint = (hint) => {
      setRoom((previous) => previous ? { ...previous, hint } : previous);
    };
    const onGuessResult = (result) => {
      if (result.correct) {
        setGuessFeedback(`Correct! +${result.points ?? 0} points`);
        pushToast(`Correct! +${result.points ?? 0} points`, "success");
        setAnnouncement(`Correct guess. You earned ${result.points ?? 0} points.`);
      } else {
        setGuessFeedback("Not quite \u2014 try another angle.");
        setAnnouncement("That guess was not correct.");
      }
    };
    const onMaskedGuess = (feed) => {
      setRoom(
        (previous) => previous && previous.roundNumber === feed.roundNumber ? { ...previous, maskedGuesses: feed.guesses } : previous
      );
    };
    const onRoundEnded = (summary) => {
      setRoom(
        (previous) => previous ? {
          ...previous,
          phase: "roundEnd",
          roundEndsAt: null,
          lastRound: summary,
          word: null,
          hint: null
        } : previous
      );
      setAnnouncement(
        `Round ${summary.roundNumber} ended. The word was ${summary.word}.`
      );
    };
    const onGameOver = (summary) => {
      setRoom(
        (previous) => previous ? {
          ...previous,
          phase: "gameOver",
          currentDrawerId: null,
          roundEndsAt: null,
          word: null,
          hint: null,
          gameOver: summary
        } : previous
      );
      pushToast(`${summary.winnerName} wins with ${summary.standings[0]?.score ?? 0} points!`, "success");
      setAnnouncement(`${summary.winnerName} wins the game.`);
    };
    const onScoreUpdated = (payload) => {
      setRoom((previous) => previous ? { ...previous, leaderboard: payload.leaderboard } : previous);
    };
    const onChatMessage = (message) => {
      setRoom((previous) => {
        if (!previous || previous.chat.some((entry) => entry.id === message.id)) return previous;
        return { ...previous, chat: [...previous.chat, message].slice(-100) };
      });
    };
    const onDrawingStroke = (segment) => {
      setStrokes((current) => mergeStrokeSegment(current, segment));
    };
    const onDrawingSync = (payload) => {
      setStrokes(payload.strokes);
      setCanvasEpoch((value) => value + 1);
    };
    const onDrawingClear = () => {
      setStrokes([]);
      setCanvasEpoch((value) => value + 1);
    };
    const onSocketError = (error) => {
      if (error.code === "KICKED") {
        joinedRef.current = false;
        currentSocket.disconnect();
        setFatal({
          title: "Removed from the room",
          message: "The room owner removed you. You can join another room from mission control."
        });
        return;
      }
      pushToast(error.message, "error");
    };
    const onSessionExpired = (payload) => {
      pushToast(payload.message, "error");
      currentSocket.disconnect();
      navigate("/login", { replace: true, state: { from: `/room/${roomCode}` } });
    };
    const onSystemMessage = (payload) => {
      if (payload.text.includes("closed")) {
        setFatal({ title: "Room closed", message: payload.text });
      } else {
        pushToast(payload.text, "info");
      }
    };
    const onReconnectFailed = () => {
      setConnected(false);
      setFatal({
        title: "Connection lost",
        message: "We could not restore the live connection. Rejoin from mission control."
      });
    };
    currentSocket.on("connect", onConnect);
    currentSocket.on("disconnect", onDisconnect);
    currentSocket.on("connect_error", onConnectError);
    currentSocket.on("room:state", onRoomState);
    currentSocket.on("game:roundStarted", onRoundStarted);
    currentSocket.on("game:timerUpdate", onTimer);
    currentSocket.on("game:hint", onHint);
    currentSocket.on("guess:result", onGuessResult);
    currentSocket.on("guess:masked", onMaskedGuess);
    currentSocket.on("game:roundEnded", onRoundEnded);
    currentSocket.on("game:over", onGameOver);
    currentSocket.on("score:updated", onScoreUpdated);
    currentSocket.on("leaderboard:updated", onScoreUpdated);
    currentSocket.on("chat:message", onChatMessage);
    currentSocket.on("system:message", onSystemMessage);
    currentSocket.on("drawing:stroke", onDrawingStroke);
    currentSocket.on("drawing:sync", onDrawingSync);
    currentSocket.on("drawing:clear", onDrawingClear);
    currentSocket.on("error", onSocketError);
    currentSocket.on("session:expired", onSessionExpired);
    currentSocket.on("reconnect_failed", onReconnectFailed);
    if (currentSocket.connected) {
      onConnect();
    } else {
      currentSocket.connect();
    }
    return () => {
      disposed = true;
      currentSocket.off("connect", onConnect);
      currentSocket.off("disconnect", onDisconnect);
      currentSocket.off("connect_error", onConnectError);
      currentSocket.off("room:state", onRoomState);
      currentSocket.off("game:roundStarted", onRoundStarted);
      currentSocket.off("game:timerUpdate", onTimer);
      currentSocket.off("game:hint", onHint);
      currentSocket.off("guess:result", onGuessResult);
      currentSocket.off("guess:masked", onMaskedGuess);
      currentSocket.off("game:roundEnded", onRoundEnded);
      currentSocket.off("game:over", onGameOver);
      currentSocket.off("score:updated", onScoreUpdated);
      currentSocket.off("leaderboard:updated", onScoreUpdated);
      currentSocket.off("chat:message", onChatMessage);
      currentSocket.off("system:message", onSystemMessage);
      currentSocket.off("drawing:stroke", onDrawingStroke);
      currentSocket.off("drawing:sync", onDrawingSync);
      currentSocket.off("drawing:clear", onDrawingClear);
      currentSocket.off("error", onSocketError);
      currentSocket.off("session:expired", onSessionExpired);
      currentSocket.off("reconnect_failed", onReconnectFailed);
      if (!leavingRef.current && currentSocket.connected && joinedRef.current) {
        void emitWithAck(currentSocket, "room:leave", {}, 2e3).finally(() => {
          currentSocket.disconnect();
        });
      } else {
        currentSocket.disconnect();
      }
      socketRef.current = null;
    };
  }, [user, roomCode, navigate, pushToast]);
  const isDrawer = Boolean(room && user && room.phase === "round" && room.currentDrawerId === user.id);
  const me = room?.players.find((player) => player.id === user?.id);
  const muted = Boolean(me?.mutedUntil && me.mutedUntil > Date.now());
  const canDraw = Boolean(isDrawer && connected);
  const totalRoundMs = (room?.roundDurationSeconds ?? 60) * 1e3;
  const sendChat = useCallback(
    async (text) => {
      const current = socketRef.current;
      if (!current) return false;
      const response = await emitWithAck(current, "chat:send", { text });
      if (!response.ok) {
        pushToast(response.error.message, "error");
        return false;
      }
      return true;
    },
    [pushToast]
  );
  const submitGuess = useCallback(
    async (text) => {
      const current = socketRef.current;
      if (!current || !room || room.phase !== "round" || isDrawer || me?.guessedThisRound) {
        return false;
      }
      setGuessFeedback(null);
      const response = await emitWithAck(current, "guess:submit", { text });
      if (!response.ok) {
        pushToast(response.error.message, "error");
        return false;
      }
      return true;
    },
    [room, isDrawer, me?.guessedThisRound, pushToast]
  );
  const sendChunk = useCallback(
    (chunk) => {
      const current = socketRef.current;
      if (!current) return;
      void emitWithAck(current, "drawing:stroke", chunk).then((response) => {
        if (!response.ok) {
          const now = Date.now();
          if (now - drawingErrorAt.current > 1500) {
            drawingErrorAt.current = now;
            pushToast(response.error.message, "error");
          }
          if (response.error.code === "CANVAS_FULL" || response.error.code === "FORBIDDEN") {
            setCanvasEpoch((value) => value + 1);
            requestFreshState();
          }
        }
      });
    },
    [pushToast, requestFreshState]
  );
  const handleStrokeComplete = useCallback((stroke) => {
    setStrokes((current) => {
      const exists = current.some((entry) => entry.id === stroke.id);
      if (!exists) return [...current, stroke];
      return current.map((entry) => entry.id === stroke.id ? stroke : entry);
    });
  }, []);
  const drawingAction = async (event) => {
    const current = socketRef.current;
    if (!current) return;
    const response = await emitWithAck(current, event);
    if (!response.ok) pushToast(response.error.message, "error");
  };
  const toggleReady = async () => {
    const current = socketRef.current;
    if (!current || !me) return;
    const response = await emitWithAck(current, "game:ready", { ready: !me.ready });
    if (!response.ok) pushToast(response.error.message, "error");
  };
  const startGame = async () => {
    const current = socketRef.current;
    if (!current) return;
    const response = await emitWithAck(current, "game:start");
    if (!response.ok) pushToast(response.error.message, "error");
  };
  const playAgain = async () => {
    const current = socketRef.current;
    if (!current) return;
    const response = await emitWithAck(current, "game:playAgain");
    if (!response.ok) pushToast(response.error.message, "error");
  };
  const leaveRoom = async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    const current = socketRef.current;
    if (current?.connected) {
      await emitWithAck(current, "room:leave", {}, 3e3);
      current.disconnect();
    }
    navigate("/");
  };
  const copyInvite = async () => {
    const url = `${window.location.origin}/room/${roomCode}`;
    try {
      await navigator.clipboard.writeText(url);
      pushToast("Invite link copied.", "success");
    } catch {
      pushToast(`Share this code: ${roomCode}`, "info");
    }
  };
  const moderate = async (action, targetUserId) => {
    if (action === "kick") {
      setKickTarget(targetUserId);
      return;
    }
    const current = socketRef.current;
    if (!current) return;
    const response = await emitWithAck(current, "moderation:action", { action, targetUserId });
    if (!response.ok) pushToast(response.error.message, "error");
    else pushToast(action === "mute" ? "Player muted for five minutes." : "Player unmuted.", "success");
  };
  const confirmKick = async () => {
    const target = kickTarget;
    setKickTarget(null);
    if (!target) return;
    const current = socketRef.current;
    if (!current) return;
    const response = await emitWithAck(current, "moderation:action", { action: "kick", targetUserId: target });
    if (!response.ok) pushToast(response.error.message, "error");
    else pushToast("Player removed from the room.", "success");
  };
  const submitReport = async (event) => {
    event.preventDefault();
    if (!reportTarget || reporting) return;
    setReporting(true);
    const current = socketRef.current;
    if (!current) return;
    const response = await emitWithAck(current, "moderation:report", {
      targetUserId: reportTarget,
      reason: reportReason.trim()
    });
    setReporting(false);
    if (!response.ok) {
      pushToast(response.error.message, "error");
      return;
    }
    setReportTarget(null);
    setReportReason("");
    pushToast("Report received. Thank you.", "success");
  };
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!canDraw || !room || room.phase !== "round") return;
      const target = event.target;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return;
      if (event.key.toLowerCase() === "e") {
        setTool((current) => current === "eraser" ? "pen" : "eraser");
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void drawingAction(event.shiftKey ? "drawing:redo" : "drawing:undo");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canDraw, room, drawingAction]);
  if (fatal) {
    return <div className="centered-page">
        <div className="empty-orbit" aria-hidden="true">
          <Logo compact />
        </div>
        <span className="eyebrow">Signal interrupted</span>
        <h1>{fatal.title}</h1>
        <p className="lede">{fatal.message}</p>
        <div className="button-row">
          <Link to="/" className="button button--primary">
            Mission control
          </Link>
          <button type="button" className="button button--ghost" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>;
  }
  if (joining || !room) {
    return <div className="page-loader page-loader--room" role="status">
        <span className="orbit-loader" aria-hidden="true">
          <span />
        </span>
        <h1>Entering {roomCode}</h1>
        <p>Opening a stable channel to the room…</p>
      </div>;
  }
  const phaseLabel = room.phase === "lobby" ? "Lobby" : room.phase === "round" ? `Round ${room.roundNumber} of ${room.totalRounds}` : room.phase === "roundEnd" ? "Round complete" : "Game over";
  const targetForKick = kickTarget ? room.players.find((player) => player.id === kickTarget) : null;
  const reportPlayer = reportTarget ? room.players.find((player) => player.id === reportTarget) : null;
  const connectedPlayers = room.players.filter((player) => player.connected);
  const readyCount = connectedPlayers.filter((player) => player.ready).length;
  const isOwner = room.ownerId === user?.id;
  return <div className="room-page">
      <p className="sr-only" aria-live="assertive">
        {announcement}
      </p>

      {!connected && <div className="connection-banner" role="status">
          <span className="live-dot" /> Reconnecting to the room. Your seat is being held.
        </div>}

      <header className="room-topbar">
        <div className="room-topbar__identity">
          <button
    type="button"
    className="icon-button room-back"
    aria-label="Leave room and return to mission control"
    onClick={() => void leaveRoom()}
  >
            ←
          </button>
          <div>
            <div className="room-topbar__kicker">
              <span className={`status-badge status-badge--${room.phase === "lobby" ? "waiting" : "playing"}`}>
                {phaseLabel}
              </span>
              <span className="visibility-tag">{room.visibility === "public" ? "Public room" : "Private room"}</span>
            </div>
            <h1>{room.name}</h1>
          </div>
        </div>
        <div className="room-topbar__actions">
          <button type="button" className="room-code" onClick={() => void copyInvite()} aria-label={`Copy invite link for room ${room.code}`}>
            <span>Room code</span>
            <strong>{room.code}</strong>
            <span className="room-code__copy" aria-hidden="true">
              ⧉
            </span>
          </button>
          <button type="button" className="button button--ghost button--small" onClick={() => void leaveRoom()}>
            Leave
          </button>
        </div>
      </header>

      <div className="room-layout">
        <div className="room-stage">
          <section className="game-board panel" aria-label="Game board">
            <div className="stage-hud">
              <WordDisplay
    word={room.word}
    hint={room.hint}
    isDrawer={isDrawer}
    guessed={Boolean(me?.guessedThisRound)}
    phase={room.phase}
  />
              <div className="stage-hud__right">
                {room.phase === "round" ? <TimerRing
    seconds={countdown.seconds}
    remainingMs={countdown.remainingMs}
    totalMs={totalRoundMs}
    roundNumber={room.roundNumber}
    totalRounds={room.totalRounds}
  /> : <div className="phase-badge">
                    <span aria-hidden="true">{room.phase === "gameOver" ? "\u2726" : "\u25CC"}</span>
                    <strong>{phaseLabel}</strong>
                    <small>{room.currentDrawerName ? `${room.currentDrawerName} drawing` : "Waiting for launch"}</small>
                  </div>}
              </div>
            </div>

            {room.phase === "lobby" ? <div className="lobby-stage">
                <div className="lobby-stage__art" aria-hidden="true">
                  <div className="lobby-orbit lobby-orbit--outer" />
                  <div className="lobby-orbit lobby-orbit--inner" />
                  <div className="lobby-planet">
                    <Logo compact />
                  </div>
                  <span className="lobby-star lobby-star--one">✦</span>
                  <span className="lobby-star lobby-star--two">✧</span>
                  <span className="lobby-star lobby-star--three">·</span>
                </div>
                <div className="lobby-stage__copy">
                  <span className="eyebrow">Crew assembling</span>
                  <h2>{readyCount} of {connectedPlayers.length} ready</h2>
                  <p>
                    {isOwner ? room.canStart ? "Everyone is ready. Launch when you are." : "Ready up, then launch once every connected player is ready." : "Ready up and wait for the host to launch the game."}
                  </p>
                  <div className="lobby-stage__actions">
                    <button
    type="button"
    className={`button ${me?.ready ? "button--ghost" : "button--primary"}`}
    onClick={() => void toggleReady()}
    disabled={!connected}
  >
                      {me?.ready ? "Not ready" : "I'm ready"}
                    </button>
                    {isOwner && <button
    type="button"
    className="button button--primary"
    onClick={() => void startGame()}
    disabled={!room.canStart || !connected}
  >
                        Launch game
                      </button>}
                  </div>
                  <div className="lobby-stage__specs">
                    <span><strong>{room.roundDurationSeconds}s</strong> rounds</span>
                    <span><strong>{room.totalRounds}</strong> total rounds</span>
                    <span><strong>{room.maxPlayers}</strong> max crew</span>
                  </div>
                  <p className="lobby-stage__tip">
                    Tip: the drawer cannot write letters or numbers in the drawing. Keep it visual.
                  </p>
                </div>
              </div> : <>
                <div className="canvas-area">
                  <DrawingCanvas
    key={`${room.roundNumber}-${canvasEpoch}`}
    strokes={strokes}
    canDraw={canDraw}
    color={color}
    width={brushWidth}
    tool={tool}
    onChunk={sendChunk}
    onEnd={(strokeId) => {
      const current = socketRef.current;
      if (current) void emitWithAck(current, "drawing:end", { strokeId });
    }}
    onComplete={handleStrokeComplete}
    label={canDraw ? "Your shared drawing canvas. Use a pointer or finger to draw." : "Shared drawing canvas. The active drawer is painting."}
  />

                  {room.phase === "roundEnd" && room.lastRound && <div className="game-overlay game-overlay--round">
                      <span className="eyebrow">Word revealed</span>
                      <h2 className="reveal-word">{room.lastRound.word.toUpperCase()}</h2>
                      <p>
                        {room.lastRound.reason === "allGuessed" ? "Every connected guesser cracked it." : room.lastRound.reason === "drawerLeft" ? "The artist left the canvas." : "The clock ran out."}
                      </p>
                      {room.lastRound.results.length > 0 ? <ul className="round-results">
                          {room.lastRound.results.map((result) => <li key={result.userId}>
                              <span>{result.username}</span>
                              <strong>+{result.points}</strong>
                            </li>)}
                        </ul> : <p className="round-results--empty">No one guessed this round.</p>}
                      <span className="overlay-next">Next round starting shortly…</span>
                    </div>}

                  {room.phase === "gameOver" && room.gameOver && <div className="game-overlay game-overlay--final">
                      <span className="overlay-glow" aria-hidden="true" />
                      <span className="eyebrow">Final orbit</span>
                      <h2>{room.gameOver.winnerName} wins!</h2>
                      <p>Final standings</p>
                      <ol className="final-standings">
                        {room.gameOver.standings.map((entry) => <li key={entry.userId} className={entry.userId === user?.id ? "final-standings__self" : ""}>
                            <span>{entry.rank}</span>
                            <strong>{entry.username}</strong>
                            <em>{entry.score.toLocaleString()} pts</em>
                          </li>)}
                      </ol>
                      <div className="game-overlay__actions">
                        {isOwner ? <button type="button" className="button button--primary" onClick={() => void playAgain()}>
                            Return to lobby
                          </button> : <p className="muted">Waiting for the host to open another game.</p>}
                        <button type="button" className="button button--ghost" onClick={() => void leaveRoom()}>
                          Leave room
                        </button>
                      </div>
                    </div>}
                </div>

                <DrawingToolbar
    canDraw={canDraw}
    color={color}
    width={brushWidth}
    tool={tool}
    canUndo={Boolean(room.canUndo)}
    canRedo={Boolean(room.canRedo)}
    onColorChange={setColor}
    onWidthChange={setBrushWidth}
    onToolChange={setTool}
    onUndo={() => void drawingAction("drawing:undo")}
    onRedo={() => void drawingAction("drawing:redo")}
    onClear={() => setClearOpen(true)}
  />

                <GuessPanel
    phase={room.phase}
    isDrawer={isDrawer}
    guessed={Boolean(me?.guessedThisRound)}
    connected={connected}
    guesses={room.maskedGuesses}
    feedback={guessFeedback}
    onSubmit={submitGuess}
  />
              </>}
          </section>
        </div>

        <aside className="room-sidebar">
          <PlayerList
    room={room}
    currentUserId={user?.id ?? ""}
    onModerate={(action, targetUserId) => void moderate(action, targetUserId)}
    onReport={(targetUserId) => {
      setReportTarget(targetUserId);
      setReportReason("");
    }}
  />
          <ChatPanel messages={room.chat} onSend={sendChat} connected={connected} muted={muted} />
        </aside>
      </div>

      <Modal
    open={clearOpen}
    onClose={() => setClearOpen(false)}
    title="Clear the canvas?"
    description="Every stroke will be removed for everyone. This cannot be undone."
    size="small"
    footer={<>
            <button type="button" className="button button--ghost" onClick={() => setClearOpen(false)}>
              Keep drawing
            </button>
            <button
      type="button"
      className="button button--danger"
      onClick={() => {
        setClearOpen(false);
        void drawingAction("drawing:clear");
      }}
    >
              Clear canvas
            </button>
          </>}
  >
        <p className="muted">Other players are watching your shared canvas.</p>
      </Modal>

      <Modal
    open={Boolean(kickTarget)}
    onClose={() => setKickTarget(null)}
    title={`Remove ${targetForKick?.username ?? "player"}?`}
    description="They will be removed from this room and cannot rejoin until it closes."
    size="small"
    footer={<>
            <button type="button" className="button button--ghost" onClick={() => setKickTarget(null)}>
              Cancel
            </button>
            <button type="button" className="button button--danger" onClick={() => void confirmKick()}>
              Remove player
            </button>
          </>}
  >
        <p className="muted">Use removal for disruptive behaviour. The action is recorded.</p>
      </Modal>

      <Modal
    open={Boolean(reportTarget)}
    onClose={() => setReportTarget(null)}
    title={`Report ${reportPlayer?.username ?? "player"}`}
    description="Reports are private and stored for operator review."
    size="small"
    footer={<>
            <button type="button" className="button button--ghost" onClick={() => setReportTarget(null)}>
              Cancel
            </button>
            <button
      type="submit"
      form="report-form"
      className="button button--danger"
      disabled={reporting || reportReason.trim().length < 3}
    >
              {reporting ? "Sending\u2026" : "Submit report"}
            </button>
          </>}
  >
        <form id="report-form" className="form-stack" onSubmit={(event) => void submitReport(event)}>
          <div className="field">
            <label htmlFor="report-reason">What happened?</label>
            <textarea
    id="report-reason"
    value={reportReason}
    onChange={(event) => setReportReason(event.target.value)}
    maxLength={500}
    rows={4}
    placeholder="Describe the behaviour briefly."
    required
  />
            <p className="field__help">3–500 characters. Do not include passwords or personal information.</p>
          </div>
        </form>
      </Modal>
    </div>;
}
export {
  RoomPage
};

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PublicRoomSummary, RoomVisibility } from '../../shared/protocol';
import { ROOM_LIMITS } from '../../shared/protocol';
import { Modal } from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch, ApiError } from '../lib/api';
import { connectSocket, emitWithAck, setPendingRoomSocket } from '../lib/socket';

function formatRelative(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function LandingPage(): React.JSX.Element {
  return (
    <>
      <section className="hero">
        <div className="hero__copy">
          <span className="eyebrow eyebrow--glow">Real-time multiplayer drawing</span>
          <h1>
            Draw the cosmos.
            <br />
            <span className="gradient-text">Guess the word.</span>
          </h1>
          <p className="lede">
            Take turns sketching secret words among the stars. Guess fast, climb the leaderboard, and
            blame the gravity when nobody can tell a comet from a croissant.
          </p>
          <div className="hero__actions">
            <Link to="/register" className="button button--primary button--large">
              Start playing
            </Link>
            <Link to="/login" className="button button--ghost button--large">
              I have an account
            </Link>
          </div>
          <div className="hero__proof" aria-label="Game features">
            <span>
              <strong>2–12</strong> players
            </span>
            <span>
              <strong>Live</strong> canvas sync
            </span>
            <span>
              <strong>Server</strong> verified scores
            </span>
          </div>
        </div>

        <div className="game-preview" aria-hidden="true">
          <div className="game-preview__orbit" />
          <div className="game-preview__card">
            <div className="game-preview__head">
              <span className="game-preview__badge">Round 2 / 4</span>
              <span className="game-preview__timer">0:47</span>
            </div>
            <div className="game-preview__canvas">
              <svg viewBox="0 0 420 280" className="game-preview__drawing">
                <defs>
                  <linearGradient id="comet-tail" x1="0" x2="1">
                    <stop offset="0" stopColor="#4cc9f0" stopOpacity="0.1" />
                    <stop offset="1" stopColor="#4cc9f0" />
                  </linearGradient>
                </defs>
                <path d="M60 210 C 130 190, 175 120, 280 80" fill="none" stroke="url(#comet-tail)" strokeWidth="9" strokeLinecap="round" />
                <circle cx="292" cy="75" r="24" fill="none" stroke="#ffd166" strokeWidth="5" />
                <circle cx="292" cy="75" r="12" fill="#ffd166" fillOpacity="0.2" />
                <path d="M332 42 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z" fill="#ff5d8f" />
                <path d="M95 70 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#8c7bff" />
                <path d="M160 230 q 20 -30 44 -8 q 25 -18 44 6" fill="none" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="2" strokeDasharray="4 8" />
              </svg>
              <span className="game-preview__hint">_ _ _ _ T</span>
            </div>
            <div className="game-preview__players">
              <span className="preview-player preview-player--one">L</span>
              <span className="preview-player preview-player--two">M</span>
              <span className="preview-player preview-player--three">A</span>
              <span className="preview-player preview-player--four">R</span>
              <span className="game-preview__guess">
                <strong>nova</strong> guessed it <em>+84</em>
              </span>
            </div>
          </div>
          <div className="game-preview__float game-preview__float--one">comet</div>
          <div className="game-preview__float game-preview__float--two">+84 pts</div>
        </div>
      </section>

      <section className="landing-features" aria-labelledby="features-title">
        <div className="section-heading">
          <span className="eyebrow">Mission profile</span>
          <h2 id="features-title">A party game with a serious engine</h2>
        </div>
        <div className="feature-grid">
          <article className="feature-card">
            <span className="feature-card__icon" aria-hidden="true">
              ✎
            </span>
            <h3>Draw together, live</h3>
            <p>Strokes stream through Socket.IO. Colours, brush sizes, undo, redo and eraser included.</p>
          </article>
          <article className="feature-card">
            <span className="feature-card__icon" aria-hidden="true">
              ⏱
            </span>
            <h3>The server keeps time</h3>
            <p>Deadlines, hints and points are authoritative. Refreshing the page cannot buy extra seconds.</p>
          </article>
          <article className="feature-card">
            <span className="feature-card__icon" aria-hidden="true">
              ✦
            </span>
            <h3>Every round counts</h3>
            <p>Earn remaining whole seconds × 2. Your lifetime points, wins and guesses live on your profile.</p>
          </article>
          <article className="feature-card">
            <span className="feature-card__icon" aria-hidden="true">
              ◈
            </span>
            <h3>Built to play fair</h3>
            <p>Only the drawer can paint, guesses are server-checked, and duplicate score events are rejected.</p>
          </article>
        </div>
      </section>

      <section className="how-it-works">
        <div>
          <span className="eyebrow">Flight plan</span>
          <h2>Three steps to orbit</h2>
        </div>
        <ol className="steps">
          <li>
            <span className="steps__number">01</span>
            <div>
              <h3>Open a room</h3>
              <p>Public or private, 2–12 players, round length and total rounds under your control.</p>
            </div>
          </li>
          <li>
            <span className="steps__number">02</span>
            <div>
              <h3>Sketch your word</h3>
              <p>The drawer gets a secret word and a shared canvas. Everyone else gets a masked hint.</p>
            </div>
          </li>
          <li>
            <span className="steps__number">03</span>
            <div>
              <h3>Guess before zero</h3>
              <p>Correct guesses lock in points instantly. Highest total after the final round wins.</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="landing-cta panel">
        <div>
          <span className="eyebrow">Ready for launch?</span>
          <h2>Your constellation needs a seventh player.</h2>
          <p className="muted">Create a free account and join the next room.</p>
        </div>
        <div className="landing-cta__actions">
          <Link to="/register" className="button button--primary">
            Create account
          </Link>
          <Link to="/login" className="button button--ghost">
            Sign in
          </Link>
        </div>
      </section>
    </>
  );
}

interface CreateForm {
  name: string;
  visibility: RoomVisibility;
  maxPlayers: number;
  roundDurationSeconds: number;
  totalRounds: number;
}

const initialCreateForm: CreateForm = {
  name: '',
  visibility: 'public',
  maxPlayers: 8,
  roundDurationSeconds: 80,
  totalRounds: 3,
};

function LobbyDashboard({ rooms, loading, error, onRefresh }: {
  rooms: PublicRoomSummary[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}): React.JSX.Element {
  const { user } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(initialCreateForm);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const handoffSocket = useRef<ReturnType<typeof connectSocket> | null>(null);

  useEffect(() => {
    return () => {
      if (handoffSocket.current && !handoffSocket.current.connected) {
        handoffSocket.current.close();
      }
    };
  }, []);

  const joinByCode = (event: FormEvent) => {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) {
      pushToast('Room codes are six characters.', 'error');
      return;
    }
    navigate(`/room/${code}`);
  };

  const createRoom = async (event: FormEvent) => {
    event.preventDefault();
    if (creating) return;
    if (createForm.name.trim().length < 3) {
      setCreateError('Give the room a name of at least 3 characters.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    const socket = connectSocket();
    handoffSocket.current = socket;
    try {
      const created = await emitWithAck<{ code: string; roomId: string }>(socket, 'room:create', {
        name: createForm.name.trim(),
        visibility: createForm.visibility,
        maxPlayers: Number(createForm.maxPlayers),
        roundDurationSeconds: Number(createForm.roundDurationSeconds),
        totalRounds: Number(createForm.totalRounds),
      });
      if (!created.ok) {
        setCreateError(created.error.message);
        socket.close();
        handoffSocket.current = null;
        return;
      }
      const joined = await emitWithAck(socket, 'room:join', { code: created.data!.code });
      if (!joined.ok) {
        setCreateError(joined.error.message);
        socket.close();
        handoffSocket.current = null;
        return;
      }
      setPendingRoomSocket(socket);
      handoffSocket.current = null;
      setCreateOpen(false);
      navigate(`/room/${created.data!.code}`);
    } catch (caught) {
      setCreateError(caught instanceof ApiError ? caught.message : 'Could not create the room.');
      socket.close();
      handoffSocket.current = null;
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="dashboard">
      <section className="dashboard-hero">
        <div>
          <span className="eyebrow eyebrow--glow">Mission control</span>
          <h1>
            Welcome back, <span className="gradient-text">{user?.username}</span>.
          </h1>
          <p className="lede">
            {user?.stats.gamesPlayed
              ? `${user.stats.gamesPlayed} games flown · ${user.stats.wins} wins · ${user.stats.totalPoints.toLocaleString()} lifetime points`
              : 'You have a clean flight record. Join a room and make your first mark on the cosmos.'}
          </p>
        </div>
        <div className="dashboard-hero__actions">
          <button type="button" className="button button--primary" onClick={() => setCreateOpen(true)}>
            + Create a room
          </button>
          <form className="join-code" onSubmit={joinByCode}>
            <label htmlFor="join-code" className="sr-only">
              Room code
            </label>
            <input
              id="join-code"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6))}
              placeholder="ROOM CODE"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
            />
            <button type="submit" className="button button--ghost">
              Join
            </button>
          </form>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel rooms-panel" aria-labelledby="rooms-title">
          <div className="panel__heading">
            <div>
              <span className="eyebrow">Open frequencies</span>
              <h2 id="rooms-title">Public rooms</h2>
            </div>
            <button type="button" className="button button--ghost button--small" onClick={onRefresh} disabled={loading}>
              Refresh
            </button>
          </div>

          {loading && rooms.length === 0 && (
            <div className="room-grid" aria-label="Loading rooms">
              {[0, 1, 2].map((key) => (
                <div className="room-card room-card--skeleton" key={key}>
                  <span className="skeleton-line" />
                  <span className="skeleton-line skeleton-line--short" />
                  <span className="skeleton-line skeleton-line--short" />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="empty-state empty-state--error">
              <p>{error}</p>
              <button type="button" className="button button--ghost button--small" onClick={onRefresh}>
                Try again
              </button>
            </div>
          )}

          {!loading && !error && rooms.length === 0 && (
            <div className="empty-state">
              <span className="empty-state__icon" aria-hidden="true">
                ✦
              </span>
              <h3>The sky is quiet</h3>
              <p>No public rooms are open. Start one and invite the void.</p>
              <button type="button" className="button button--primary button--small" onClick={() => setCreateOpen(true)}>
                Create a room
              </button>
            </div>
          )}

          {rooms.length > 0 && (
            <div className="room-grid">
              {rooms.map((room) => (
                <article className="room-card" key={room.code}>
                  <div className="room-card__top">
                    <span className={`status-badge status-badge--${room.status}`}>
                      {room.status === 'waiting' ? 'Waiting' : 'In game'}
                    </span>
                    <span className="room-card__age">{formatRelative(room.updatedAt)}</span>
                  </div>
                  <h3>{room.name}</h3>
                  <p className="room-card__host">Hosted by {room.ownerName}</p>
                  <dl className="room-card__stats">
                    <div>
                      <dt>Players</dt>
                      <dd>
                        {room.playerCount}/{room.maxPlayers}
                      </dd>
                    </div>
                    <div>
                      <dt>Round</dt>
                      <dd>{room.roundDurationSeconds}s</dd>
                    </div>
                    <div>
                      <dt>Rounds</dt>
                      <dd>{room.totalRounds}</dd>
                    </div>
                  </dl>
                  <Link to={`/room/${room.code}`} className="button button--ghost button--small button--wide">
                    {room.status === 'waiting' ? 'Join room' : 'Rejoin'}
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="dashboard-aside">
          <section className="panel rules-card">
            <span className="eyebrow">Scoring rule</span>
            <h2>Seconds × 2</h2>
            <p>
              A correct guess earns the remaining whole seconds multiplied by two. Only the server clock
              counts, and each player can score once per round.
            </p>
            <Link to="/about" className="text-link">
              Fair play details
            </Link>
          </section>
        </aside>
      </div>

      <Modal
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        title="Create a room"
        description="Set the flight parameters. You can invite players with the room code."
        footer={
          <>
            <button type="button" className="button button--ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </button>
            <button type="submit" form="create-room-form" className="button button--primary" disabled={creating}>
              {creating ? 'Creating…' : 'Create room'}
            </button>
          </>
        }
      >
        <form id="create-room-form" className="form-stack" onSubmit={(event) => void createRoom(event)}>
          {createError && (
            <div className="form-alert" role="alert">
              {createError}
            </div>
          )}
          <div className="field">
            <label htmlFor="room-name">Room name</label>
            <input
              id="room-name"
              value={createForm.name}
              onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
              maxLength={40}
              placeholder="The Drawing Nebula"
              data-autofocus
              required
            />
          </div>
          <fieldset className="field field--fieldset">
            <legend>Visibility</legend>
            <div className="segmented">
              <label>
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={createForm.visibility === 'public'}
                  onChange={() => setCreateForm({ ...createForm, visibility: 'public' })}
                />
                <span>Public</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  checked={createForm.visibility === 'private'}
                  onChange={() => setCreateForm({ ...createForm, visibility: 'private' })}
                />
                <span>Private</span>
              </label>
            </div>
            <p className="field__help">
              {createForm.visibility === 'public'
                ? 'Listed in mission control for anyone to join.'
                : 'Hidden from the list. Share the six-character code.'}
            </p>
          </fieldset>
          <div className="field-row">
            <div className="field">
              <label htmlFor="max-players">Max players</label>
              <select
                id="max-players"
                value={createForm.maxPlayers}
                onChange={(event) => setCreateForm({ ...createForm, maxPlayers: Number(event.target.value) })}
              >
                {Array.from(
                  { length: ROOM_LIMITS.maxPlayers - ROOM_LIMITS.minPlayers + 1 },
                  (_, index) => index + ROOM_LIMITS.minPlayers,
                ).map((count) => (
                  <option key={count} value={count}>
                    {count} players
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="round-duration">Round length</label>
              <select
                id="round-duration"
                value={createForm.roundDurationSeconds}
                onChange={(event) =>
                  setCreateForm({ ...createForm, roundDurationSeconds: Number(event.target.value) })
                }
              >
                {[45, 60, 80, 100, 120, 150, 180].map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} seconds
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="total-rounds">Total rounds</label>
            <select
              id="total-rounds"
              value={createForm.totalRounds}
              onChange={(event) => setCreateForm({ ...createForm, totalRounds: Number(event.target.value) })}
            >
              {Array.from({ length: 10 }, (_, index) => index + 1).map((rounds) => (
                <option key={rounds} value={rounds}>
                  {rounds} round{rounds === 1 ? '' : 's'}
                </option>
              ))}
            </select>
            <p className="field__help">Drawers rotate each round. The highest total wins.</p>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function LobbyPage(): React.JSX.Element {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<PublicRoomSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const roomResult = await apiFetch<{ rooms: PublicRoomSummary[] }>('/api/rooms/public');
      setRooms(roomResult.rooms);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the lobby.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [user, load]);

  if (!user) return <LandingPage />;

  return (
    <LobbyDashboard
      rooms={rooms}
      loading={loading}
      error={error}
      onRefresh={() => void load()}
    />
  );
}

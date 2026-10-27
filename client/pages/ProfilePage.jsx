import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { ApiError, changePasswordRequest, fetchProfile } from "../lib/api.js";
function ProfilePage() {
  const { user, setUser } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [recentGames, setRecentGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [passwordError, setPasswordError] = useState(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    fetchProfile().then((result) => {
      if (!active) return;
      setUser(result.user);
      setRecentGames(result.recentGames);
      setLoadError(null);
    }).catch((caught) => {
      if (!active) return;
      if (caught instanceof ApiError && caught.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      setLoadError(caught instanceof ApiError ? caught.message : "Could not load your profile.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user?.id, navigate, setUser]);
  const changePassword = async (event) => {
    event.preventDefault();
    if (changing) return;
    setPasswordError(null);
    setPasswordSuccess(false);
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPasswordError("Use at least 10 characters with a letter and a number.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords do not match.");
      return;
    }
    setChanging(true);
    try {
      const result = await changePasswordRequest(currentPassword, newPassword);
      setUser(result.user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess(true);
      pushToast("Password changed. Other sessions have been signed out.", "success");
    } catch (caught) {
      setPasswordError(
        caught instanceof ApiError ? caught.fields?.newPassword ?? caught.fields?.currentPassword ?? caught.message : "Could not change your password."
      );
    } finally {
      setChanging(false);
    }
  };
  if (!user) return <div className="page-loader"><p>Loading profile…</p></div>;
  const winRate = user.stats.gamesPlayed > 0 ? Math.round(user.stats.wins / user.stats.gamesPlayed * 100) : 0;
  return <div className="profile-page">
      <section className="profile-hero panel">
        <div className="profile-identity">
          <div className="profile-avatar" aria-hidden="true">
            {user.username.slice(0, 1).toUpperCase()}
            <span className="profile-avatar__ring" />
          </div>
          <div>
            <span className="eyebrow">Flight record</span>
            <h1>{user.username}</h1>
            <p className="muted">{user.email}</p>
            <p className="profile-since">
              Aboard since{" "}
              {new Intl.DateTimeFormat(void 0, { month: "long", year: "numeric" }).format(
    new Date(user.createdAt)
  )}
            </p>
          </div>
        </div>
        <Link to="/" className="button button--ghost">
          Back to mission control
        </Link>
      </section>

      <section aria-labelledby="stats-title">
        <div className="section-heading section-heading--compact">
          <span className="eyebrow">Lifetime telemetry</span>
          <h2 id="stats-title">Your numbers</h2>
        </div>
        <div className="stats-grid">
          <article className="stat-card">
            <span className="stat-card__label">Games played</span>
            <strong>{user.stats.gamesPlayed.toLocaleString()}</strong>
            <span className="stat-card__hint">completed missions</span>
          </article>
          <article className="stat-card stat-card--gold">
            <span className="stat-card__label">Wins</span>
            <strong>{user.stats.wins.toLocaleString()}</strong>
            <span className="stat-card__hint">{winRate}% win rate</span>
          </article>
          <article className="stat-card stat-card--blue">
            <span className="stat-card__label">Correct guesses</span>
            <strong>{user.stats.correctGuesses.toLocaleString()}</strong>
            <span className="stat-card__hint">words uncovered</span>
          </article>
          <article className="stat-card stat-card--pink">
            <span className="stat-card__label">Total points</span>
            <strong>{user.stats.totalPoints.toLocaleString()}</strong>
            <span className="stat-card__hint">server verified</span>
          </article>
        </div>
      </section>

      <div className="profile-grid">
        <section className="panel" aria-labelledby="recent-title">
          <div className="panel__heading">
            <div>
              <span className="eyebrow">Last flights</span>
              <h2 id="recent-title">Recent games</h2>
            </div>
          </div>
          {loading ? <p className="muted" role="status">
              Loading flight records…
            </p> : loadError ? <div className="empty-state empty-state--error">
              <p>{loadError}</p>
            </div> : recentGames.length === 0 ? <div className="empty-state">
              <span className="empty-state__icon" aria-hidden="true">
                ◌
              </span>
              <h3>No completed games yet</h3>
              <p>Finish a game and it will appear here.</p>
              <Link to="/" className="button button--primary button--small">
                Find a room
              </Link>
            </div> : <div className="table-scroll">
              <table className="data-table">
                <caption className="sr-only">Your ten most recent completed games</caption>
                <thead>
                  <tr>
                    <th scope="col">Room</th>
                    <th scope="col">Finished</th>
                    <th scope="col">Place</th>
                    <th scope="col">Score</th>
                    <th scope="col">Winner</th>
                  </tr>
                </thead>
                <tbody>
                  {recentGames.map((game) => <tr key={game.id}>
                      <td>
                        <span className="mono">{game.roomCode}</span>
                      </td>
                      <td>
                        {game.endedAt ? new Intl.DateTimeFormat(void 0, { dateStyle: "medium" }).format(new Date(game.endedAt)) : "\u2014"}
                      </td>
                      <td>
                        {game.playerRank} / {game.totalPlayers}
                      </td>
                      <td>{game.playerScore.toLocaleString()}</td>
                      <td>{game.winnerName ?? "\u2014"}</td>
                    </tr>)}
                </tbody>
              </table>
            </div>}
        </section>

        <section className="panel" aria-labelledby="security-title">
          <div className="panel__heading">
            <div>
              <span className="eyebrow">Security</span>
              <h2 id="security-title">Change password</h2>
            </div>
          </div>
          <p className="muted">
            Changing your password signs out every session, including this one, then gives this browser a
            fresh session.
          </p>
          <form className="form-stack" onSubmit={(event) => void changePassword(event)}>
            {passwordError && <div className="form-alert" role="alert">
                {passwordError}
              </div>}
            {passwordSuccess && <div className="form-success" role="status">
                Password updated.
              </div>}
            <div className="field">
              <label htmlFor="current-password">Current password</label>
              <input
    id="current-password"
    type="password"
    autoComplete="current-password"
    value={currentPassword}
    onChange={(event) => setCurrentPassword(event.target.value)}
    required
  />
            </div>
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input
    id="new-password"
    type="password"
    autoComplete="new-password"
    value={newPassword}
    onChange={(event) => setNewPassword(event.target.value)}
    aria-describedby="new-password-help"
    required
  />
              <p className="field__help" id="new-password-help">
                10+ characters with a letter and a number.
              </p>
            </div>
            <div className="field">
              <label htmlFor="confirm-new-password">Confirm new password</label>
              <input
    id="confirm-new-password"
    type="password"
    autoComplete="new-password"
    value={confirmPassword}
    onChange={(event) => setConfirmPassword(event.target.value)}
    required
  />
            </div>
            <button type="submit" className="button button--primary" disabled={changing}>
              {changing ? "Updating\u2026" : "Update password"}
            </button>
          </form>
        </section>
      </div>
    </div>;
}
export {
  ProfilePage
};

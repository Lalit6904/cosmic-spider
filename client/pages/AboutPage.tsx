import { Link } from 'react-router-dom';

export function AboutPage(): React.JSX.Element {
  return (
    <div className="content-page">
      <div className="content-page__heading">
        <span className="eyebrow">Flight manual</span>
        <h1>Fair play, privacy &amp; the shape of the game</h1>
        <p className="lede">
          Cosmic Spider is a server-authoritative drawing game. Your browser paints the picture; the
          server owns the clock, the secret word, and every point.
        </p>
      </div>

      <div className="prose-grid">
        <section className="panel prose-card">
          <h2>How scoring works</h2>
          <p>
            A correct guess earns <strong>remaining whole seconds × 2</strong>. The remaining time is
            measured on the server at the instant the guess is processed. Points are awarded once per
            player per round. The drawer does not receive guess points under this rule.
          </p>
          <p>Ties use correct guesses, join time, then username. The server broadcasts one winner per game.</p>
        </section>
        <section className="panel prose-card">
          <h2>What we store</h2>
          <p>
            Your username, email, password hash, session metadata, game results and aggregate statistics
            are stored in MongoDB. Passwords are hashed with bcrypt; raw passwords and session tokens are
            never stored. Session cookies are HttpOnly and SameSite=Lax.
          </p>
          <p>Reset tokens are hashed in the database and expire after 30 minutes.</p>
        </section>
        <section className="panel prose-card">
          <h2>Security honesty</h2>
          <p>
            We apply layered controls: strict validation, rate limits, CSRF tokens, origin allowlists,
            draw authorization, idempotent scoring and security headers. No system is perfectly secure.
            Active rooms are kept in one Node process; multi-instance deployments require a shared state
            and Socket.IO adapter. See the deployment and security documents in the project repository.
          </p>
        </section>
        <section className="panel prose-card">
          <h2>Reporting &amp; moderation</h2>
          <p>
            Room owners can mute or remove players. Every report and moderation action is recorded for
            review. Reports are intentionally kept private from the reported player.
          </p>
          <p className="muted">
            This demonstration build does not include an operator dashboard. Reports are stored in the
            <code> moderationrecords</code> collection for an administrator to review.
          </p>
        </section>
      </div>

      <div className="content-page__actions">
        <Link to="/" className="button button--primary">
          Back to the lobby
        </Link>
        <Link to="/register" className="button button--ghost">
          Create an account
        </Link>
      </div>
    </div>
  );
}

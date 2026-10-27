import { Suspense } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
function Logo({ compact = false }) {
  return <span className={`logo ${compact ? "logo--compact" : ""}`}>
      <span className="logo__mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="18.5" stroke="currentColor" strokeOpacity="0.35" />
          <ellipse
    cx="24"
    cy="24"
    rx="21"
    ry="8"
    stroke="currentColor"
    strokeOpacity="0.55"
    transform="rotate(-28 24 24)"
  />
          <circle cx="24" cy="25" r="5.5" fill="currentColor" />
          <circle cx="24" cy="19.5" r="2.8" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M19.5 22.5 12 19M19.5 24.8 10 24M19.5 27.2 12 31M28.5 22.5 36 19M28.5 24.8 38 24M28.5 27.2 36 31" />
          </g>
          <circle cx="40" cy="12" r="1.8" fill="var(--star-gold, #ffcf6e)" />
        </svg>
      </span>
      {!compact && <span className="logo__text">
          Cosmic <strong>Spider</strong>
        </span>}
    </span>;
}
function Layout() {
  const { user, logout } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const handleLogout = async () => {
    try {
      await logout();
      navigate("/");
      pushToast("Signed out. See you among the stars.", "info");
    } catch {
      pushToast("Sign out failed. Please try again.", "error");
    }
  };
  return <div className="app-shell">
      <div className="cosmos" aria-hidden="true">
        <div className="cosmos__stars cosmos__stars--near" />
        <div className="cosmos__stars cosmos__stars--far" />
        <div className="cosmos__glow cosmos__glow--one" />
        <div className="cosmos__glow cosmos__glow--two" />
      </div>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" className="brand-link" aria-label="Cosmic Spider home">
            <Logo />
          </Link>
          <nav className="site-nav" aria-label="Main navigation">
            <NavLink to="/" end className={({ isActive }) => isActive ? "nav-link nav-link--active" : "nav-link"}>
              Discover
            </NavLink>
            {user && <NavLink
    to="/profile"
    className={({ isActive }) => isActive ? "nav-link nav-link--active" : "nav-link"}
  >
                Profile
              </NavLink>}
          </nav>
          <div className="site-header__account">
            {user ? <>
                <span className="account-chip" title={user.email}>
                  <span className="account-chip__avatar" aria-hidden="true">
                    {user.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="account-chip__name">{user.username}</span>
                  <span className="account-chip__score">{user.stats.totalPoints.toLocaleString()} pts</span>
                </span>
                <button type="button" className="button button--ghost button--small" onClick={() => void handleLogout()}>
                  Sign out
                </button>
              </> : <>
                <Link to="/login" className="button button--ghost button--small">
                  Sign in
                </Link>
                <Link to="/register" className="button button--primary button--small">
                  Create account
                </Link>
              </>}
          </div>
        </div>
      </header>
      <main id="main" className="site-main">
        <Suspense
    fallback={<div className="page-loader" role="status">
              <span className="orbit-loader" aria-hidden="true">
                <span />
              </span>
              <p>Charting this page…</p>
            </div>}
  >
          <Outlet />
        </Suspense>
      </main>
      <footer className="site-footer">
        <span>Cosmic Spider</span>
        <span className="site-footer__sep" aria-hidden="true">
          ·
        </span>
        <span>Draw boldly. Guess quickly.</span>
        <Link to="/about">Fair play &amp; privacy</Link>
      </footer>
    </div>;
}
export {
  Layout,
  Logo
};

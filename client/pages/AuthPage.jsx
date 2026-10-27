import { useEffect, useId, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "../components/Layout.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { ApiError } from "../lib/api.js";
function AuthPage({ mode }) {
  const { user, login, register } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state;
  const safeFrom = state?.from && state.from.startsWith("/") && !state.from.startsWith("//") ? state.from : "/";
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const formId = useId();
  useEffect(() => {
    if (user) navigate(safeFrom, { replace: true });
  }, [user, navigate, safeFrom]);
  const validate = () => {
    const next = {};
    if (mode === "register" && !/^[A-Za-z0-9_]{3,20}$/.test(username.trim())) {
      next.username = "Use 3\u201320 letters, numbers or underscores.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = "Enter a valid email address.";
    }
    if (mode === "register") {
      if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        next.password = "Use at least 10 characters with a letter and a number.";
      }
      if (password !== confirm) next.confirm = "Passwords do not match.";
    } else if (!password) {
      next.password = "Enter your password.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!validate() || submitting) return;
    setSubmitting(true);
    setErrors({});
    try {
      if (mode === "login") {
        await login(email.trim(), password);
        pushToast("Welcome back to the stars.", "success");
      } else {
        await register(username.trim(), email.trim(), password);
        pushToast("Account created. Your constellation awaits.", "success");
      }
      navigate(safeFrom, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "RATE_LIMITED") {
          setErrors({ form: error.message });
        } else if (error.fields) {
          setErrors({
            username: error.fields.username,
            email: error.fields.email,
            password: error.fields.password,
            form: error.code === "ACCOUNT_EXISTS" ? error.message : void 0
          });
        } else {
          setErrors({ form: error.message });
        }
      } else {
        setErrors({ form: "Something went wrong. Please try again." });
      }
    } finally {
      setSubmitting(false);
    }
  };
  return <div className="auth-page">
      <section className="auth-visual" aria-hidden="true">
        <div className="auth-visual__orbit">
          <div className="auth-visual__planet">
            <Logo compact />
          </div>
          <span className="auth-visual__satellite auth-visual__satellite--one" />
          <span className="auth-visual__satellite auth-visual__satellite--two" />
        </div>
        <div className="auth-visual__sketch">
          <div className="sketch-card">
            <span className="sketch-card__line sketch-card__line--one" />
            <span className="sketch-card__line sketch-card__line--two" />
            <span className="sketch-card__star">✦</span>
            <span className="sketch-card__label">guess: &ldquo;nebula&rdquo;</span>
          </div>
          <div className="sketch-score">
            <span>+84</span>
            <small>correct guess</small>
          </div>
        </div>
        <blockquote>
          &ldquo;A comet, a cactus, a tiny teapot — draw it before the clock runs out.&rdquo;
          <cite>The Cosmic Spider field guide</cite>
        </blockquote>
      </section>

      <section className="auth-card" aria-labelledby={`${formId}-title`}>
        <div className="auth-card__top">
          <span className="eyebrow">{mode === "login" ? "Re-enter orbit" : "Join the constellation"}</span>
          <h1 id={`${formId}-title`}>{mode === "login" ? "Welcome back" : "Create your player"}</h1>
          <p>
            {mode === "login" ? "Sign in to join a room, draw, and guess." : "One account, every room. Your stats travel with you."}
          </p>
        </div>

        <form onSubmit={(event) => void submit(event)} noValidate className="form-stack">
          {errors.form && <div className="form-alert" role="alert">
              {errors.form}
            </div>}

          {mode === "register" && <div className="field">
              <label htmlFor="auth-username">Username</label>
              <input
    id="auth-username"
    name="username"
    autoComplete="username"
    value={username}
    onChange={(event) => setUsername(event.target.value)}
    aria-invalid={Boolean(errors.username)}
    aria-describedby={errors.username ? "username-error" : void 0}
    placeholder="stardust_artist"
    maxLength={20}
  />
              {errors.username && <p className="field__error" id="username-error">
                  {errors.username}
                </p>}
            </div>}

          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input
    id="auth-email"
    name="email"
    type="email"
    inputMode="email"
    autoComplete="email"
    value={email}
    onChange={(event) => setEmail(event.target.value)}
    aria-invalid={Boolean(errors.email)}
    aria-describedby={errors.email ? "email-error" : void 0}
    placeholder="you@example.com"
  />
            {errors.email && <p className="field__error" id="email-error">
                {errors.email}
              </p>}
          </div>

          <div className="field">
            <div className="field__label-row">
              <label htmlFor="auth-password">Password</label>
              {mode === "login" && <Link to="/forgot-password" className="text-link">
                  Forgot password?
                </Link>}
            </div>
            <div className="password-input">
              <input
    id="auth-password"
    name="password"
    type={showPassword ? "text" : "password"}
    autoComplete={mode === "login" ? "current-password" : "new-password"}
    value={password}
    onChange={(event) => setPassword(event.target.value)}
    aria-invalid={Boolean(errors.password)}
    aria-describedby={errors.password ? "password-error" : mode === "register" ? "password-help" : void 0}
    placeholder={mode === "register" ? "At least 10 characters" : "Your password"}
  />
              <button
    type="button"
    className="password-toggle"
    onClick={() => setShowPassword((value) => !value)}
    aria-label={showPassword ? "Hide password" : "Show password"}
    aria-pressed={showPassword}
  >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {mode === "register" && !errors.password && <p className="field__help" id="password-help">
                10+ characters, including a letter and a number.
              </p>}
            {errors.password && <p className="field__error" id="password-error">
                {errors.password}
              </p>}
          </div>

          {mode === "register" && <div className="field">
              <label htmlFor="auth-confirm">Confirm password</label>
              <input
    id="auth-confirm"
    name="confirm-password"
    type={showPassword ? "text" : "password"}
    autoComplete="new-password"
    value={confirm}
    onChange={(event) => setConfirm(event.target.value)}
    aria-invalid={Boolean(errors.confirm)}
    aria-describedby={errors.confirm ? "confirm-error" : void 0}
  />
              {errors.confirm && <p className="field__error" id="confirm-error">
                  {errors.confirm}
                </p>}
            </div>}

          <button type="submit" className="button button--primary button--wide" disabled={submitting}>
            {submitting ? <>
                <span className="button-spinner" aria-hidden="true" /> Please wait…
              </> : mode === "login" ? "Enter the lobby" : "Create account"}
          </button>
        </form>

        <p className="auth-card__switch">
          {mode === "login" ? <>
              New to Cosmic Spider? <Link to="/register">Create an account</Link>
            </> : <>
              Already have a flight record? <Link to="/login">Sign in</Link>
            </>}
        </p>
        <p className="auth-card__legal">
          By continuing you agree to play fairly and treat other players with respect.
        </p>
      </section>
    </div>;
}
export {
  AuthPage
};

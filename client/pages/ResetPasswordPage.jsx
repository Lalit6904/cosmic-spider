import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { resetPasswordRequest, ApiError } from "../lib/api.js";
function ResetPasswordPage() {
  const { token } = useParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (!token) {
      setError("This reset link is incomplete.");
      return;
    }
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Use at least 10 characters with a letter and a number.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await resetPasswordRequest(token, password);
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not reset your password.");
    } finally {
      setSubmitting(false);
    }
  };
  return <div className="centered-page centered-page--auth">
      <div className="auth-card auth-card--narrow">
        <span className="eyebrow">New launch code</span>
        <h1>Choose a new password</h1>
        {success ? <div className="success-panel" role="status">
            <span className="success-panel__icon" aria-hidden="true">
              ✓
            </span>
            <p>Your password was reset and all previous sessions were signed out.</p>
            <Link to="/login" className="button button--primary">
              Sign in with your new password
            </Link>
          </div> : <>
            <p className="lede">Resetting your password signs out every existing session.</p>
            <form onSubmit={(event) => void submit(event)} className="form-stack" noValidate>
              {error && <div className="form-alert" role="alert">
                  {error}
                </div>}
              <div className="field">
                <label htmlFor="reset-password">New password</label>
                <input
    id="reset-password"
    type="password"
    autoComplete="new-password"
    value={password}
    onChange={(event) => setPassword(event.target.value)}
    aria-describedby="reset-help"
  />
                <p className="field__help" id="reset-help">
                  10+ characters, including a letter and a number.
                </p>
              </div>
              <div className="field">
                <label htmlFor="reset-confirm">Confirm new password</label>
                <input
    id="reset-confirm"
    type="password"
    autoComplete="new-password"
    value={confirm}
    onChange={(event) => setConfirm(event.target.value)}
  />
              </div>
              <button type="submit" className="button button--primary button--wide" disabled={submitting}>
                {submitting ? "Updating\u2026" : "Reset password"}
              </button>
              <Link to="/login" className="text-link text-link--center">
                Back to sign in
              </Link>
            </form>
          </>}
      </div>
    </div>;
}
export {
  ResetPasswordPage
};

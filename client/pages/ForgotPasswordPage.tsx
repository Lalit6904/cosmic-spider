import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { forgotPasswordRequest, ApiError } from '../lib/api';

export function ForgotPasswordPage(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await forgotPasswordRequest(email.trim());
      setMessage(result.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not submit the request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="centered-page centered-page--auth">
      <div className="auth-card auth-card--narrow">
        <span className="eyebrow">Recovery beacon</span>
        <h1>Reset your password</h1>
        <p className="lede">
          Enter the email tied to your account. If it exists, we&apos;ll send a link that expires in 30
          minutes.
        </p>

        {message ? (
          <div className="success-panel" role="status">
            <span className="success-panel__icon" aria-hidden="true">
              ✓
            </span>
            <p>{message}</p>
            <p className="muted">Check your spam folder if it does not arrive shortly.</p>
            <Link to="/login" className="button button--primary">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="form-stack" noValidate>
            {error && (
              <div className="form-alert" role="alert">
                {error}
              </div>
            )}
            <div className="field">
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="you@example.com"
              />
            </div>
            <button type="submit" className="button button--primary button--wide" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
            <Link to="/login" className="text-link text-link--center">
              Return to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}

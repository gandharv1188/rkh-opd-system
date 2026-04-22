import { useState } from 'react';

export interface SignInProps {
  readonly onSignedIn?: (token: string, operatorId: string) => void;
  /** Endpoint override (default: /auth/sign-in). */
  readonly endpoint?: string;
}

export function SignIn({ onSignedIn, endpoint = '/auth/sign-in' }: SignInProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? 'Invalid email or password' : 'Sign-in failed');
        return;
      }
      const body = (await res.json()) as { access_token: string; operator_id: string };
      onSignedIn?.(body.access_token, body.operator_id);
    } catch {
      setError('Network error — try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form data-testid="sign-in-form" onSubmit={submit}>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        data-testid="sign-in-email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        data-testid="sign-in-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="current-password"
      />
      {error && <p data-testid="sign-in-error" role="alert">{error}</p>}
      <button data-testid="sign-in-submit" type="submit" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

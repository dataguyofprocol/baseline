import { useState } from 'react';
import { Lockup } from './Logo.js';

/** why the last sign-in came back (the server redirects to /?auth_error=…) */
const REASONS: Record<string, string> = {
  'not-invited': 'That Google account isn’t a member of this workspace. Ask an admin to invite you.',
  suspended: 'This account has been suspended. Ask an admin if that’s a mistake.',
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in took too long. Try again.',
  google: 'Google didn’t complete the sign-in. Try again.',
};

function takeAuthError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('auth_error');
  if (!code) return null;
  // drop it from the address bar so a reload doesn't show it again
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  return REASONS[code] ?? REASONS.google!;
}

/** Hosted mode, no session: the only way in is Google. */
export function SignIn() {
  const [error] = useState(takeAuthError);
  const signIn = () => {
    // come back to the page that asked (hash routes included)
    const next = window.location.pathname + window.location.hash;
    window.location.href = `/auth/google?next=${encodeURIComponent(next)}`;
  };
  return (
    <div className="on-ink" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'bl-fade-up 320ms var(--ease) both' }}>
          <Lockup size={34} />
          <h1 className="brand-headline">Sign in</h1>
          <div className="brand-sub">Use the Google account your workspace knows you by.</div>
        </div>
        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, animation: 'bl-fade-up 340ms var(--ease) 100ms both' }}>
          {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger, #eb5757)' }}>{error}</div>}
          <button className="btn primary" style={{ height: 32 }} autoFocus onClick={signIn}>Continue with Google</button>
        </div>
      </div>
    </div>
  );
}

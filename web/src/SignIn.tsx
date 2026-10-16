import { useEffect, useState } from 'react';
import { Lockup } from './Logo.js';
import { api } from './api.js';

/** why the last sign-in came back (the server redirects to /?auth_error=…) */
const REASONS: Record<string, string> = {
  'not-invited': 'That Google account isn’t a member of this workspace. Ask an admin to invite you.',
  suspended: 'This account has been suspended. Ask an admin if that’s a mistake.',
  'invite-mismatch': 'This invite was sent to a different address. Sign in with the Google account it was sent to.',
  'invite-expired': 'This invite has expired or was revoked. Ask for a new one.',
  'rate-limited': 'Too many sign-in attempts from here. Wait a few minutes and try again.',
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in took too long. Try again.',
  google: 'Google didn’t complete the sign-in. Try again.',
};

type InviteInfo = Awaited<ReturnType<typeof api.inviteInfo>>;

/** read ?auth_error and ?invite once, then drop them from the address bar so a reload is clean */
function takeParams(): { error: string | null; invite: string | null } {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('auth_error');
  const invite = params.get('invite');
  if (code || invite) window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  return { error: code ? REASONS[code] ?? REASONS.google! : null, invite };
}

/** Hosted mode, no session: the only way in is Google — arriving from an invite link says whose. */
export function SignIn() {
  const [{ error, invite }] = useState(takeParams);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  useEffect(() => { if (invite) void api.inviteInfo(invite).then(setInfo); }, [invite]);

  const signIn = () => {
    // come back to the page that asked (hash routes included), carrying the invite through Google
    const next = window.location.pathname + window.location.hash;
    window.location.href = `/auth/google?next=${encodeURIComponent(next)}${invite ? `&invite=${encodeURIComponent(invite)}` : ''}`;
  };
  const valid = info?.state === 'valid';
  const headline = valid ? `Join ${info!.workspace}` : 'Sign in';
  const sub = valid
    ? `${info!.inviter ?? 'A teammate'} invited you. Sign in with the Google account for ${info!.email}.`
    : 'Use the Google account your workspace knows you by.';
  const inviteProblem = info && !valid
    ? info.state === 'accepted' ? 'This invite has already been used — sign in to continue.'
    : info.state === 'unknown' ? 'That invite link isn’t valid. Ask for a new one.'
    : `This invite has ${info.state === 'revoked' ? 'been revoked' : 'expired'}. Ask ${info.inviter ?? 'whoever sent it'} for a new one.`
    : null;

  return (
    <div className="on-ink" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'bl-fade-up 320ms var(--ease) both' }}>
          <Lockup size={34} />
          <h1 className="brand-headline">{headline}</h1>
          <div className="brand-sub">{sub}</div>
        </div>
        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, animation: 'bl-fade-up 340ms var(--ease) 100ms both' }}>
          {(error || inviteProblem) && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger, #eb5757)' }}>{error ?? inviteProblem}</div>}
          <button className="btn primary" style={{ height: 32 }} autoFocus onClick={signIn}>Continue with Google</button>
        </div>
      </div>
    </div>
  );
}

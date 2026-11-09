import { useEffect, useRef, useState } from 'react';
import { Lockup } from './Logo.js';
import { api, authApi } from './api.js';
import { PASSWORD_MIN, type SignInMethod } from '../../src/core/types.js';

/** why the last Google sign-in came back (the server redirects to /?auth_error=…) */
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
type ResetInfo = Awaited<ReturnType<typeof authApi.resetInfo>>;
type Config = Awaited<ReturnType<typeof authApi.config>>;

/** the same rule as the server's safeNext: only a path on this site */
const sameSite = (next: string | null) =>
  next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !/[\u0000-\u001f]/.test(next) ? next : null;

interface Params { error: string | null; invite: string | null; reset: string | null; next: string | null }

/** read the sign-in params once, then drop them from the address bar so a reload is clean */
function takeParams(): Params {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('auth_error');
  const p = { invite: params.get('invite'), reset: params.get('reset'), next: sameSite(params.get('next')) };
  if (code || p.invite || p.reset || params.get('next')) window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  return { error: code ? REASONS[code] ?? REASONS.google! : null, ...p };
}

/** Hosted mode, no session. One screen picks itself from the link that brought you here and the
 *  server's state: first-run setup, a reset link, an invite, or plain sign-in. */
export function SignIn() {
  const [params] = useState(takeParams);
  const [config, setConfig] = useState<Config | null>(null);
  // unreachable server: fall back to the password form rather than a blank shell
  useEffect(() => { void authApi.config().then(setConfig, () => setConfig({ methods: ['password'], setup: false, mail: false } as Config)); }, []);
  // where to land once signed in: back to the page that asked (the CLI's approval page sends ?next)
  const back = params.next ?? window.location.pathname + window.location.hash;
  const done = () => {
    const to = new URL(back, window.location.href);
    // a hash-only change doesn't load the page, and the app has to start over signed in
    if (to.pathname === window.location.pathname && to.search === window.location.search) { window.location.hash = to.hash; window.location.reload(); }
    else window.location.replace(to.href);
  };
  const google = (invite?: string | null) => {
    window.location.href = `/auth/google?next=${encodeURIComponent(back)}${invite ? `&invite=${encodeURIComponent(invite)}` : ''}`;
  };

  if (!config) return <Shell headline="" sub="" />;
  const ctx: Ctx = { methods: config.methods, mail: config.mail, done, google };
  if (params.reset) return <ResetPassword token={params.reset} ctx={ctx} />;
  if (config.setup) return <Setup ctx={ctx} />;
  return <SignInOrJoin ctx={ctx} invite={params.invite} error={params.error} />;
}

interface Ctx { methods: SignInMethod[]; mail: boolean; done: () => void; google: (invite?: string | null) => void }

/* ---------- the brand frame every signed-out screen shares ---------- */
function Shell(props: { headline: string; sub: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="on-ink auth-page">
      <div className="auth-col">
        <div className="auth-head">
          <Lockup size={34} />
          {props.headline && <h1 className="brand-headline">{props.headline}</h1>}
          {props.sub && <div className="brand-sub">{props.sub}</div>}
        </div>
        {props.children && <div className="card auth-card">{props.children}</div>}
      </div>
    </div>
  );
}

function Field(props: { label: string; hint?: string; value: string; onChange: (v: string) => void; type?: string; autoComplete?: string; autoFocus?: boolean; placeholder?: string; mono?: boolean; name?: string }) {
  // a password field can be shown, so a new password can be checked before it's set
  const [shown, setShown] = useState(false);
  const isPassword = props.type === 'password';
  return (
    <label className="auth-field">
      <span className="auth-label">{props.label}</span>
      <span className="auth-input-wrap">
        <input className={`text-input${props.mono ? ' mono' : ''}`} name={props.name} type={isPassword && shown ? 'text' : props.type ?? 'text'} value={props.value} autoComplete={props.autoComplete}
          autoFocus={props.autoFocus} placeholder={props.placeholder} spellCheck={false} onChange={e => props.onChange(e.target.value)} />
        {isPassword && <button type="button" className="auth-reveal" aria-pressed={shown} onClick={() => setShown(v => !v)}>{shown ? 'Hide' : 'Show'}</button>}
      </span>
      {props.hint && <span className="auth-hint">{props.hint}</span>}
    </label>
  );
}

const Alert = ({ children }: { children: React.ReactNode }) => children ? <div role="alert" className="auth-alert">{children}</div> : null;

/** a form that posts to /auth/*, shows the server's reason when refused, and lands signed in */
function useSubmit(path: string, onOk: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await authApi.post(path, body);
    if (r.ok) { onOk(); return; }
    setError(r.error);
    setBusy(false);
  };
  return { busy, error, setError, submit };
}

const passwordHint = `At least ${PASSWORD_MIN} characters.`;

function GoogleButton({ onClick, label = 'Continue with Google' }: { onClick: () => void; label?: string }) {
  return (
    <>
      <div className="auth-or"><span>or</span></div>
      <button type="button" className="btn auth-secondary" onClick={onClick}>{label}</button>
    </>
  );
}

/* ---------- first run: the owner account ---------- */
function Setup({ ctx }: { ctx: Ctx }) {
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const { busy, error, submit } = useSubmit('/auth/setup', ctx.done);
  return (
    <Shell headline="Set up Baseline" sub={<>Create the owner account for this server. The setup token is in the server log from when Baseline started, or run <code>baseline setup-token</code> beside the database.</>}>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); void submit({ token, name, email, password, workspaceName }); }}>
        <Alert>{error}</Alert>
        <Field label="Setup token" name="token" value={token} onChange={setToken} autoFocus mono autoComplete="off" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" />
        <Field label="Workspace name" name="workspaceName" value={workspaceName} onChange={setWorkspaceName} autoComplete="organization" placeholder="Acme" />
        <Field label="Your name" name="name" value={name} onChange={setName} autoComplete="name" />
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint={passwordHint} />
        <button className="btn primary auth-submit" disabled={busy || !token.trim() || !name.trim() || !email.trim() || !password}>{busy ? 'Creating…' : 'Create owner account'}</button>
      </form>
    </Shell>
  );
}

/* ---------- sign in, or join through an invite ---------- */
function SignInOrJoin({ ctx, invite, error: initialError }: { ctx: Ctx; invite: string | null; error: string | null }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [mode, setMode] = useState<'join' | 'signin' | 'forgot'>(invite ? 'join' : 'signin');
  useEffect(() => { if (invite) void api.inviteInfo(invite).then(setInfo); }, [invite]);
  if (invite && !info) return <Shell headline="" sub="" />;

  const valid = info?.state === 'valid';
  if (valid && mode === 'join') return <Join ctx={ctx} code={invite!} info={info!} error={initialError} onSignIn={() => setMode('signin')} />;
  if (mode === 'forgot') return <Forgot onBack={() => setMode('signin')} />;
  const inviteProblem = info && !valid
    ? info.state === 'accepted' ? 'This invite has already been used. Sign in to continue.'
    : info.state === 'unknown' ? 'That invite link isn’t valid. Ask for a new one.'
    : `This invite has ${info.state === 'revoked' ? 'been revoked' : 'expired'}. Ask ${info.inviter ?? 'whoever sent it'} for a new one.`
    : null;
  return <PasswordSignIn ctx={ctx} problem={initialError ?? inviteProblem} onForgot={() => setMode('forgot')} invite={valid ? invite : null} onJoin={valid ? () => setMode('join') : undefined} />;
}

function PasswordSignIn({ ctx, problem, onForgot, invite, onJoin }: { ctx: Ctx; problem: string | null; onForgot: () => void; invite: string | null; onJoin?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit('/auth/password', ctx.done);
  const hasGoogle = ctx.methods.includes('google');
  return (
    <Shell headline="Sign in" sub={hasGoogle ? 'With your email and password, or the Google account your workspace knows you by.' : 'With the email and password for your account here.'}>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); void submit({ email, password }); }}>
        <Alert>{error ?? problem}</Alert>
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus />
        <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <button className="btn primary auth-submit" disabled={busy || !email.trim() || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {hasGoogle && <GoogleButton onClick={() => ctx.google(invite)} />}
      </form>
      <div className="auth-foot">
        {ctx.mail
          ? <button type="button" className="auth-link" onClick={onForgot}>Forgot your password?</button>
          : <span>Forgot your password? Ask an admin for a reset link.</span>}
        {onJoin && <button type="button" className="auth-link" onClick={onJoin}>Use your invite</button>}
      </div>
    </Shell>
  );
}

function Join({ ctx, code, info, error: googleError, onSignIn }: { ctx: Ctx; code: string; info: InviteInfo; error: string | null; onSignIn: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(`/auth/invite/${encodeURIComponent(code)}/accept`, ctx.done);
  const hasGoogle = ctx.methods.includes('google');
  return (
    <Shell headline={`Join ${info.workspace}`} sub={`${info.inviter ?? 'A teammate'} invited ${info.email}. Enter that address and choose a password${hasGoogle ? ', or continue with its Google account' : ''}.`}>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); void submit({ email, name, password }); }}>
        <Alert>{error ?? googleError}</Alert>
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus placeholder={info.email} />
        <Field label="Your name" name="name" value={name} onChange={setName} autoComplete="name" />
        <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint={passwordHint} />
        <button className="btn primary auth-submit" disabled={busy || !email.trim() || !name.trim() || !password}>{busy ? 'Joining…' : `Join ${info.workspace}`}</button>
        {hasGoogle && <GoogleButton onClick={() => ctx.google(code)} />}
      </form>
      <div className="auth-foot"><button type="button" className="auth-link" onClick={onSignIn}>Already have an account? Sign in</button></div>
    </Shell>
  );
}

function Forgot({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, submit } = useSubmit('/auth/forgot', () => setSent(true));
  if (sent) return (
    <Shell headline="Check your email" sub={<>If there’s an account for <b>{email.trim()}</b>, a link to choose a new password is on its way. It works once, for an hour.</>}>
      <button type="button" className="btn auth-secondary" onClick={onBack}>Back to sign in</button>
    </Shell>
  );
  return (
    <Shell headline="Reset your password" sub="We’ll email you a link to choose a new one.">
      <form className="auth-form" onSubmit={e => { e.preventDefault(); void submit({ email }); }}>
        <Alert>{error}</Alert>
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus />
        <button className="btn primary auth-submit" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      <div className="auth-foot"><button type="button" className="auth-link" onClick={onBack}>Back to sign in</button></div>
    </Shell>
  );
}

/* ---------- a one-use reset link (from an admin, or a forgot-password email) ---------- */
function ResetPassword({ token, ctx }: { token: string; ctx: Ctx }) {
  const [info, setInfo] = useState<ResetInfo | null>(null);
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(`/auth/reset/${encodeURIComponent(token)}`, ctx.done);
  const asked = useRef(false);
  useEffect(() => { if (!asked.current) { asked.current = true; void authApi.resetInfo(token).then(setInfo); } }, [token]);
  if (!info) return <Shell headline="" sub="" />;
  if (info.state !== 'valid') return (
    <Shell headline="This link has expired" sub="Reset links work once, and only for a while. Ask an admin for a new one.">
      <button type="button" className="btn auth-secondary" onClick={() => window.location.replace('/')}>Go to sign in</button>
    </Shell>
  );
  return (
    <Shell headline="Choose a new password" sub={<>For <b>{info.name}</b> ({info.email}). Every other device signed in as you is signed out.</>}>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); void submit({ password }); }}>
        <Alert>{error}</Alert>
        <input type="email" name="email" value={info.email} autoComplete="username" readOnly hidden />
        <Field label="New password" name="password" type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus hint={passwordHint} />
        <button className="btn primary auth-submit" disabled={busy || !password}>{busy ? 'Saving…' : 'Set password and sign in'}</button>
      </form>
    </Shell>
  );
}

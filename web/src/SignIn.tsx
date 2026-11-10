import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Logo } from './Logo.js';
import { markArrival, reducedMotion } from './arrival.js';
import { api, authApi } from './api.js';
import { PASSWORD_MIN, type SignInMethod } from '../../src/core/types.js';

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

const sameSite = (next: string | null) =>
  next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !/[\u0000-\u001f]/.test(next) ? next : null;

interface Params { error: string | null; invite: string | null; join: string | null; reset: string | null; next: string | null }

function takeParams(): Params {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('auth_error');
  const p = { invite: params.get('invite'), join: params.get('join'), reset: params.get('reset'), next: sameSite(params.get('next')) };
  if (code || p.invite || p.join || p.reset || params.get('next')) window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  return { error: code ? REASONS[code] ?? REASONS.google! : null, ...p };
}

export function SignIn() {
  const [params] = useState(takeParams);
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => { void authApi.config().then(setConfig, () => setConfig({ methods: ['password'], setup: false, mail: false } as Config)); }, []);
  const back = params.next ?? window.location.pathname + window.location.hash;
  const [leaving, setLeaving] = useState(false);
  const go = () => {
    const to = new URL(back, window.location.href);
    // a hash-only change doesn't load the page, and the app has to start over signed in
    if (to.pathname === window.location.pathname && to.search === window.location.search) { window.location.hash = to.hash; window.location.reload(); }
    else window.location.replace(to.href);
  };
  const done = () => {
    if (params.next || reducedMotion()) return go();
    setLeaving(true);
    markArrival();
    window.setTimeout(go, 560);
  };
  const google = (invite?: string | null, kind: 'invite' | 'join' = 'invite') => {
    window.location.href = `/auth/google?next=${encodeURIComponent(back)}${invite ? `&${kind}=${encodeURIComponent(invite)}` : ''}`;
  };

  if (!config) return <Shell headline="" sub="" />;
  const ctx: Ctx = { methods: config.methods, mail: config.mail, done, google };
  return (
    <Leaving.Provider value={leaving}>
      {params.reset ? <ResetPassword token={params.reset} ctx={ctx} />
        : config.setup ? <Setup ctx={ctx} />
        : <SignInOrJoin ctx={ctx} invite={params.invite ?? params.join} kind={params.invite ? 'invite' : 'join'} error={params.error} />}
    </Leaving.Provider>
  );
}

const Leaving = createContext(false);

interface Ctx { methods: SignInMethod[]; mail: boolean; done: () => void; google: (invite?: string | null, kind?: 'invite' | 'join') => void }

let shellStart: number | null = null;

const TICKER: Array<[string, string, string]> = [
  ['Issues', 'triaged from the keyboard', 'var(--status-started)'],
  ['Cycles', 'with a burn-up chart', 'var(--brand-register)'],
  ['Agents', 'pick up issues from the CLI', 'var(--prio-urgent)'],
  ['Inbox', 'for what needs you', 'var(--green)'],
  ['Projects', 'and initiatives above them', 'var(--status-todo)'],
  ['Docs', 'next to the work', 'var(--status-backlog)'],
];

interface ShellProps {
  headline: string;
  sub: React.ReactNode;
  children?: React.ReactNode;
  progress?: number;
  state?: 'busy' | 'error' | null;
  step?: string;
  aside?: React.ReactNode;
  foot?: React.ReactNode;
  word?: string;
  wordLive?: boolean;
  ticks?: string[];
  under?: React.ReactNode;
  at?: number;
  leaving?: boolean;
}

export function LineFrame(props: ShellProps) {
  const [since] = useState(() => {
    if (shellStart === null) shellStart = performance.now();
    return Math.round(shellStart - performance.now());
  });
  const word = props.word || 'Baseline';
  const firstLetters = useRef(word.length);
  const p = props.state === 'busy' || props.leaving ? 1 : 0.66 * Math.min(1, Math.max(0, props.progress ?? 0));
  return (
    <div className={`on-ink auth-page${props.leaving ? ' auth-leaving' : ''}`} style={{ '--auth-since': `${since}ms` } as React.CSSProperties}>
      <div className="auth-frame">
        <header className="auth-top">
          <span className="auth-brand"><Logo size={22} tone="paper" />Baseline</span>
          {props.aside && <span>{props.aside}</span>}
        </header>
        <div className="auth-stage">
          <div className="auth-wrap">
            <div className="auth-word" role="img" aria-label={word}>
              {word.split('').map((ch, i) => props.wordLive && i >= firstLetters.current
                ? <span key={i} aria-hidden="true" className="typed">{ch}</span>
                : <span key={i} aria-hidden="true" style={{ '--d': `${300 + i * 45}ms` } as React.CSSProperties}>{ch}</span>)}
            </div>
          </div>
          <div className={`auth-line${props.state ? ' ' + props.state : ''}${props.at !== undefined && !props.leaving ? ' col' : ''}`} style={{ '--p': props.at !== undefined && !props.leaving ? props.at : p } as React.CSSProperties} aria-hidden="true">
            <div className="auth-line-rule" />
            <div className="auth-line-fill" />
            <div className="auth-node"><span key={props.state ?? 'idle'} className="auth-node-ground"><span className="auth-node-dot" /></span></div>
          </div>
          {props.under ? props.under : props.ticks ? (
            <div className="auth-wrap auth-ticks" aria-hidden="true">
              {props.ticks.map((t, i) => <span key={i} style={{ '--d': `${i * 90}ms` } as React.CSSProperties}>{t}</span>)}
            </div>
          ) : (
            <div className="auth-ticker" aria-hidden="true">
              <div className="auth-ticker-track">
                {[...TICKER, ...TICKER].map(([w, rest, color], i) => (
                  <span key={i} className="auth-ticker-item"><i style={{ background: color }} /><b>{w}</b>{rest}</span>
                ))}
              </div>
            </div>
          )}
          {(props.headline || props.children) && (
            <div className="auth-wrap auth-body">
              <div className="auth-intro">
                {props.headline && <h1 className="brand-headline">{props.headline}</h1>}
                {props.sub && <div className="brand-sub">{props.sub}</div>}
                {props.step && <div className="auth-step" aria-live="polite">{props.step}</div>}
              </div>
              {props.children && <div className="auth-card">{props.children}</div>}
            </div>
          )}
        </div>
        {props.foot && <footer className="auth-bottom">{props.foot}</footer>}
      </div>
    </div>
  );
}

function Shell(props: ShellProps) {
  const leaving = useContext(Leaving);
  return <LineFrame {...props} leaving={leaving} />;
}

export const filled = (...values: string[]) => values.filter(v => v.trim()).length / values.length;
export const lineState = (busy: boolean, error: string | null | undefined) => busy ? 'busy' : error ? 'error' : null;

function Field(props: { label: string; hint?: string; value: string; onChange: (v: string) => void; type?: string; autoComplete?: string; autoFocus?: boolean; placeholder?: string; mono?: boolean; name?: string }) {
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
    <button type="button" className="btn auth-secondary" onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {label}
    </button>
  );
}

function Submit({ busy, disabled, children }: { busy: boolean; disabled: boolean; children: React.ReactNode }) {
  return (
    <button className="btn primary auth-submit auth-go" disabled={disabled}>
      <span>{children}</span>
      {busy
        ? <span className="auth-busy-dot" aria-hidden="true" />
        : <svg className="auth-arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </button>
  );
}

function Setup({ ctx }: { ctx: Ctx }) {
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const { busy, error, submit } = useSubmit('/auth/setup', ctx.done);
  return (
    <Shell headline="Set up Baseline" progress={filled(token, workspaceName, name, email, password)} state={lineState(busy, error)} sub={<>Create the owner account for this server. The setup token is in the server log from when Baseline started, or run <code>baseline setup-token</code> beside the database.</>}>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); void submit({ token, name, email, password, workspaceName }); }}>
        <Alert>{error}</Alert>
        <Field label="Setup token" name="token" value={token} onChange={setToken} autoFocus mono autoComplete="off" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" />
        <Field label="Workspace name" name="workspaceName" value={workspaceName} onChange={setWorkspaceName} autoComplete="organization" placeholder="Acme" />
        <Field label="Your name" name="name" value={name} onChange={setName} autoComplete="name" />
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint={passwordHint} />
        <Submit busy={busy} disabled={busy || !token.trim() || !name.trim() || !email.trim() || !password}>{busy ? 'Creating…' : 'Create owner account'}</Submit>
      </form>
    </Shell>
  );
}

function SignInOrJoin({ ctx, invite, kind, error: initialError }: { ctx: Ctx; invite: string | null; kind: 'invite' | 'join'; error: string | null }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [mode, setMode] = useState<'join' | 'signin' | 'forgot'>(invite ? 'join' : 'signin');
  useEffect(() => { if (invite) void api.inviteInfo(invite, kind).then(setInfo); }, [invite, kind]);
  if (invite && !info) return <Shell headline="" sub="" />;

  const valid = info?.state === 'valid';
  if (valid && mode === 'join') return <Join ctx={ctx} code={invite!} kind={kind} info={info!} error={initialError} onSignIn={() => setMode('signin')} />;
  if (mode === 'forgot') return <Forgot onBack={() => setMode('signin')} />;
  return <PasswordSignIn ctx={ctx} problem={initialError ?? (info && inviteProblem(info, kind))} onForgot={() => setMode('forgot')} invite={valid ? invite : null} kind={kind} onJoin={valid ? () => setMode('join') : undefined} />;
}

function inviteProblem(info: InviteInfo, kind: 'invite' | 'join'): string | null {
  if (info.state === 'valid') return null;
  if (kind === 'join') return 'That join link was turned off. Ask your team for a new one.';
  return info.state === 'accepted' ? 'This invite has already been used. Sign in to continue.'
    : info.state === 'unknown' ? 'That invite link isn’t valid. Ask for a new one.'
    : `This invite has ${info.state === 'revoked' ? 'been revoked' : 'expired'}. Ask ${info.inviter ?? 'whoever sent it'} for a new one.`;
}

const listOf = (names: string[] = []) => names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

function PasswordSignIn({ ctx, problem, onForgot, invite, kind = 'invite', onJoin }: { ctx: Ctx; problem: string | null; onForgot: () => void; invite: string | null; kind?: 'invite' | 'join'; onJoin?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit('/auth/password', ctx.done);
  const hasGoogle = ctx.methods.includes('google');
  const step = busy ? 'Checking your details…' : !email.trim() ? 'Start with your email' : !password ? 'Now your password' : 'Ready when you are';
  return (
    <Shell headline="Sign in to your workspace" sub={hasGoogle ? 'Use your email and password, or the Google account your workspace knows you by.' : 'Use the email and password for your account here.'}
      progress={filled(email, password)} state={lineState(busy, error ?? problem)} step={step}
      aside={onJoin ? undefined : 'No account yet? Ask an admin for an invite.'}
      foot={<><span>Tab moves between fields · Enter signs in</span>{!onJoin && <span>Invited? Open the link from your invite to join.</span>}</>}>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); void submit({ email, password }); }}>
        <Alert>{error ?? problem}</Alert>
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus />
        <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="auth-actions">
          <Submit busy={busy} disabled={busy || !email.trim() || !password}>{busy ? 'Signing in…' : 'Sign in'}</Submit>
          {hasGoogle && <GoogleButton onClick={() => ctx.google(invite, kind)} />}
        </div>
      </form>
      <div className="auth-foot">
        {ctx.mail
          ? <button type="button" className="auth-link" onClick={onForgot}>Forgot your password?</button>
          : <span>Forgot your password? Ask an admin for a reset link.</span>}
        {onJoin && <button type="button" className="auth-link" onClick={onJoin}>{kind === 'join' ? 'New here? Create your account' : 'Use your invite'}</button>}
      </div>
    </Shell>
  );
}

function Join({ ctx, code, kind, info, error: googleError, onSignIn }: { ctx: Ctx; code: string; kind: 'invite' | 'join'; info: InviteInfo; error: string | null; onSignIn: () => void }) {
  const fixed = kind === 'invite' && info.email ? info.email : null;
  const [email, setEmail] = useState(fixed ?? '');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(`/auth/${kind}/${encodeURIComponent(code)}/accept`, ctx.done);
  const hasGoogle = ctx.methods.includes('google');
  const teams = listOf(info.teams);
  return (
    <Shell headline={teams ? `Join ${teams} on ${info.workspace}` : `Join ${info.workspace}`}
      progress={filled(email, name, password)} state={lineState(busy, error)}
      sub={<>{info.inviter ?? 'A teammate'} invited {fixed ? <b>{fixed}</b> : 'you'}{teams ? <> to {teams}</> : null}. Choose a password{hasGoogle ? `, or continue with ${fixed ? 'that address’s' : 'your'} Google account` : ''}.</>}>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); void submit({ email, name, password }); }}>
        <Alert>{error ?? googleError}</Alert>
        {fixed
          ? <label className="auth-field"><span className="auth-label">Email</span><input className="text-input" name="email" type="email" value={fixed} autoComplete="username" readOnly /></label>
          : <Field label="Work email" name="email" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus />}
        <Field label="Your name" name="name" value={name} onChange={setName} autoComplete="name" autoFocus={!!fixed} />
        <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint={passwordHint} />
        <div className="auth-actions">
          <Submit busy={busy} disabled={busy || !email.trim() || !name.trim() || !password}>{busy ? 'Joining…' : `Join ${info.workspace}`}</Submit>
          {hasGoogle && <GoogleButton onClick={() => ctx.google(code, kind)} />}
        </div>
      </form>
      <div className="auth-foot"><button type="button" className="auth-link" onClick={onSignIn}>Already have an account? Sign in</button></div>
    </Shell>
  );
}

export function SignedInInvite({ me, teams, onDone, onSignOut, onJoinTeam }: {
  me: { name: string; email: string }; teams: Array<{ id: string; name: string; joined: boolean }>;
  onDone: () => void; onSignOut: () => void; onJoinTeam: (teamId: string) => Promise<void>;
}) {
  const [{ code, kind }] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('invite') ? { code: p.get('invite')!, kind: 'invite' as const } : { code: p.get('join') ?? '', kind: 'join' as const };
  });
  const [info, setInfo] = useState<InviteInfo | null>(null);
  useEffect(() => { void api.inviteInfo(code, kind).then(setInfo); }, [code, kind]);
  if (!info) return <Shell headline="" sub="" />;
  const you = <>You’re signed in as <b>{me.name}</b> ({me.email}).</>;
  const continueBtn = <button type="button" className="btn auth-secondary" onClick={onDone}>Continue as {me.name}</button>;
  const problem = inviteProblem(info, kind);
  if (problem) return <Shell headline="This link can’t be used" sub={<>{problem} {you}</>}><div className="auth-actions">{continueBtn}</div></Shell>;
  if (kind === 'join') {
    const team = teams.find(t => t.name === info.teams?.[0]);
    return (
      <Shell headline={`Join ${info.teams?.[0] ?? 'this team'}`} sub={<>{you} {team?.joined ? `You’re already on ${team.name}.` : 'You’re already in this workspace, so you can join the team now.'}</>}>
        <div className="auth-actions">
          {team && !team.joined && <button type="button" className="btn primary auth-submit" onClick={() => void onJoinTeam(team.id)}>Join {team.name}</button>}
          {continueBtn}
        </div>
      </Shell>
    );
  }
  if (info.email?.toLowerCase() === me.email.toLowerCase()) {
    return <Shell headline="You’re already in" sub={<>{you} This invite is for you, and you already have an account.</>}><div className="auth-actions">{continueBtn}</div></Shell>;
  }
  return (
    <Shell headline="This invite is for someone else" sub={<>It was sent to <b>{info.email}</b>. {you} Sign out to accept it as {info.email}.</>}>
      <div className="auth-actions">
        <button type="button" className="btn primary auth-submit" onClick={onSignOut}>Sign out and accept</button>
        {continueBtn}
      </div>
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
    <Shell headline="Reset your password" sub="We’ll email you a link to choose a new one." progress={filled(email)} state={lineState(busy, error)}>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); void submit({ email }); }}>
        <Alert>{error}</Alert>
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus />
        <Submit busy={busy} disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send reset link'}</Submit>
      </form>
      <div className="auth-foot"><button type="button" className="auth-link" onClick={onBack}>Back to sign in</button></div>
    </Shell>
  );
}

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
    <Shell headline="Choose a new password" progress={filled(password)} state={lineState(busy, error)} sub={<>For <b>{info.name}</b> ({info.email}). Every other device signed in as you is signed out.</>}>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); void submit({ password }); }}>
        <Alert>{error}</Alert>
        <input type="email" name="email" value={info.email} autoComplete="username" readOnly hidden />
        <Field label="New password" name="password" type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus hint={passwordHint} />
        <Submit busy={busy} disabled={busy || !password}>{busy ? 'Saving…' : 'Set password and sign in'}</Submit>
      </form>
    </Shell>
  );
}

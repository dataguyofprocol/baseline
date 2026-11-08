// People in a workspace: invites, roles, suspension, team membership, and who may join.
import type { Context, Hono } from 'hono';
import { AccountError, isEmail, normalizeEmail, type Accounts, type InviteRow } from '../core/accounts.js';
import type { Store } from '../core/store.js';
import type { Invite, InviteResult } from '../core/types.js';
import { signInMethods, type HostedAuth } from './auth.js';
import { inviteEmail, type Mailer } from './mail.js';
import { RESET_LINK_TTL, resetLink } from './password-auth.js';
import { limiter } from './ratelimit.js';

const MAX_INVITES = 50;

export function mountMembers(app: Hono, o: { store: Store; accounts: Accounts; mailer: Mailer; hosted: HostedAuth | null }): void {
  const { store, accounts, mailer, hosted } = o;
  // invites send email in the workspace's name: at most 100 addresses (or resends) per person per hour
  const inviteLimit = limiter(100, 60 * 60_000);
  const tooMany = (c: Context) => c.json({ error: 'You\'ve sent a lot of invites — try again in an hour', code: 'rate-limited' }, 429);
  const forbid = (c: Context, error: string) => c.json({ error, code: 'forbidden' }, 403);
  const me = () => store.actor();
  const knownTeams = (ids: unknown): string[] =>
    Array.isArray(ids) ? [...new Set(ids.filter((x): x is string => typeof x === 'string' && !!store.getTeam(x)))] : [];
  const toInvite = (r: InviteRow): Invite => ({
    id: r.id, email: r.email, admin: !!r.admin, teamIds: JSON.parse(r.team_ids) as string[], invitedBy: r.invited_by,
    createdAt: r.created_at, expiresAt: r.expires_at, expired: Date.parse(r.expires_at) <= Date.now(),
    link: hosted ? new URL(`/?invite=${r.code}`, hosted.publicUrl).toString() : '',
  });
  const sendInvite = async (r: InviteRow): Promise<Pick<InviteResult, 'emailed' | 'error'>> => {
    if (!mailer.configured || !hosted) return { emailed: 'off' };
    const inviter = r.invited_by ? accounts.userBrief(r.invited_by) : undefined;
    try {
      await mailer.send(inviteEmail({ to: r.email, inviter: inviter?.name ?? 'A teammate', workspace: store.workspaceMeta().name, link: toInvite(r).link, expiresAt: r.expires_at, methods: signInMethods(hosted) }));
      return { emailed: 'sent' };
    } catch (err) {
      console.error('[baseline] invite email failed:', (err as Error).message);
      return { emailed: 'failed', error: (err as Error).message };
    }
  };
  // invites only make sense where people sign in
  const invitesOff = (c: Context) => !hosted ? c.json({ error: 'Invites need a hosted workspace (BASELINE_PUBLIC_URL)', code: 'not-hosted' }, 400) : null;

  // ---------- invites ----------
  app.get('/api/invites', (c) => {
    if (!accounts.canInvite(me())) return forbid(c, 'You can\'t invite people to this workspace');
    return c.json({ invites: accounts.openInvites().map(toInvite) });
  });
  app.post('/api/invites', async (c) => {
    const off = invitesOff(c); if (off) return off;
    if (!accounts.canInvite(me())) return forbid(c, 'You can\'t invite people to this workspace');
    const b = await c.req.json() as { emails?: string | string[]; admin?: boolean; teamIds?: string[] };
    if (b.admin && !accounts.isAdmin(me())) return forbid(c, 'Only admins can invite admins');
    // "a@x.com, b@x.com" or one per line — whatever was pasted
    const raw = (Array.isArray(b.emails) ? b.emails.join(' ') : b.emails ?? '').split(/[\s,;]+/).map(normalizeEmail).filter(Boolean);
    const emails = [...new Set(raw)];
    if (!emails.length) return c.json({ error: 'Add at least one email address' }, 400);
    if (emails.length > MAX_INVITES) return c.json({ error: `Invite at most ${MAX_INVITES} people at a time` }, 400);
    if (!inviteLimit.take(me(), emails.length)) return tooMany(c);
    const teamIds = knownTeams(b.teamIds);
    const results: InviteResult[] = [];
    for (const email of emails) {
      if (!isEmail(email)) { results.push({ email, status: 'invalid' }); continue; }
      if (accounts.memberByEmail(email)) { results.push({ email, status: 'already-member' }); continue; }
      const row = accounts.createInvite(email, !!b.admin, teamIds, me());
      results.push({ email, status: 'invited', invite: toInvite(row), ...await sendInvite(row) });
    }
    return c.json({ results }, 201);
  });
  app.post('/api/invites/:id/resend', async (c) => {
    if (!accounts.canInvite(me())) return forbid(c, 'You can\'t invite people to this workspace');
    if (!inviteLimit.take(me())) return tooMany(c);
    const row = accounts.renewInvite(c.req.param('id'));
    if (!row || row.accepted_at || row.revoked_at) return c.json({ error: 'That invite is no longer open' }, 404);
    return c.json({ invite: toInvite(row), ...await sendInvite(row) });
  });
  app.delete('/api/invites/:id', (c) => {
    const row = accounts.getInvite(c.req.param('id'));
    if (!row) return c.json({ error: 'not found' }, 404);
    // whoever sent it, or an admin
    if (row.invited_by !== me() && !accounts.isAdmin(me())) return forbid(c, 'Only admins can revoke other people\'s invites');
    accounts.revokeInvite(row.id);
    return c.json({ ok: true });
  });

  // ---------- people ----------
  app.patch('/api/members/:id', async (c) => {
    if (!accounts.isAdmin(me())) return forbid(c, 'Only admins can change people\'s access');
    const b = await c.req.json() as { admin?: boolean; suspended?: boolean; teamIds?: string[] };
    const target = c.req.param('id');
    try {
      if (typeof b.admin === 'boolean') accounts.setAdmin(target, b.admin);
      if (typeof b.suspended === 'boolean') accounts.setSuspended(target, b.suspended, me());
      if (Array.isArray(b.teamIds)) store.setUserTeams(target, knownTeams(b.teamIds));
    } catch (err) {
      if (err instanceof AccountError) return c.json({ error: err.message, code: err.code }, err.code === 'not-found' ? 404 : 400);
      throw err;
    }
    return c.json({ ok: true });
  });

  // a one-use link that sets this person's password — shared by the admin, so no email is needed
  // (a key can't ask for one, see principal.ts)
  app.post('/api/members/:id/reset-link', (c) => {
    if (!hosted) return c.json({ error: 'Passwords are for hosted workspaces (BASELINE_PUBLIC_URL)', code: 'not-hosted' }, 400);
    if (!accounts.isAdmin(me())) return forbid(c, 'Only admins can make password reset links');
    const target = store.snapshot().users.find(u => u.id === c.req.param('id') && u.kind === 'human');
    if (!target) return c.json({ error: 'No such person', code: 'not-found' }, 404);
    if (target.status === 'suspended') return c.json({ error: `${target.name} is suspended — reactivate them first`, code: 'invalid' }, 400);
    const { token, expiresAt } = accounts.createPasswordReset(target.id, me(), RESET_LINK_TTL);
    return c.json({ link: resetLink(hosted.publicUrl, token), expiresAt });
  });

  // anyone can join or leave a team themselves
  app.post('/api/teams/:id/join', (c) => {
    if (!knownTeams([c.req.param('id')]).length) return c.json({ error: 'not found' }, 404);
    store.addTeamMember(c.req.param('id'), me());
    return c.json({ ok: true });
  });
  app.post('/api/teams/:id/leave', (c) => { store.removeTeamMember(c.req.param('id'), me()); return c.json({ ok: true }); });

  // ---------- who may join ----------
  app.patch('/api/security', async (c) => {
    if (!accounts.isAdmin(me())) return forbid(c, 'Only admins can change security settings');
    const b = await c.req.json() as { approvedDomains?: string[]; domainTeamIds?: string[]; whoCanInvite?: 'admins' | 'members' };
    const security = store.setSecurity({
      approvedDomains: Array.isArray(b.approvedDomains) ? b.approvedDomains.map(String) : undefined,
      domainTeamIds: b.domainTeamIds !== undefined ? knownTeams(b.domainTeamIds) : undefined,
      whoCanInvite: b.whoCanInvite,
    });
    return c.json({ security });
  });
}

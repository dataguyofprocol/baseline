// People in a workspace: invites, roles, suspension, team membership, and who may join.
import type { Context, Hono } from 'hono';
import { AccountError, emailProblem, isEmail, normalizeEmail, type Accounts, type InviteRow } from '../core/accounts.js';
import type { Store } from '../core/store.js';
import type { Invite, InviteEntry, InviteResult, Team, TeamJoinLink } from '../core/types.js';
import { signInMethods, type HostedAuth } from './auth.js';
import { inviteEmail, type Mailer } from './mail.js';
import { RESET_LINK_TTL, resetLink } from './password-auth.js';
import { limiter } from './ratelimit.js';

const MAX_INVITES = 50;


/** `userIds` name people already in the workspace; `emails` is whatever was pasted ("a@x.com, b@x.com" or one per line) */
function inviteEntries(b: { emails?: unknown; userIds?: unknown }): InviteEntry[] {
  const ids = Array.isArray(b.userIds) ? b.userIds.filter((x): x is string => typeof x === 'string') : [];
  const text = Array.isArray(b.emails) ? b.emails.filter((x): x is string => typeof x === 'string').join(' ') : typeof b.emails === 'string' ? b.emails : '';
  const emails = text.split(/[\s,;]+/).map(normalizeEmail).filter(Boolean);
  return [
    ...[...new Set(ids)].map(userId => ({ kind: 'member' as const, userId })),
    ...[...new Set(emails)].map(email => ({ kind: 'email' as const, email })),
  ];
}

export function mountMembers(app: Hono, o: { store: Store; accounts: Accounts; mailer: Mailer; hosted: HostedAuth | null }): void {
  const { store, accounts, mailer, hosted } = o;
  // invites send email in the workspace's name: at most 100 addresses (or resends) per person per hour
  const inviteLimit = limiter(100, 60 * 60_000);
  const tooMany = (c: Context) => c.json({ error: 'You\'ve sent a lot of invites. Try again in an hour.', code: 'rate-limited' }, 429);
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
  // as in Linear: anyone on a team, or an admin, adds people to it; only admins remove someone else.
  // A laptop has one person, who passes every admin and team check.
  const admin = () => !hosted || accounts.isAdmin(me());
  const canAddTo = (team: Team) => admin() || team.memberIds.includes(me());
  /** a team's lead, or an admin (who leads every team, CORE_FLOW.md › Roles) */
  const leads = (team: Team) => admin() || team.leadIds.includes(me());
  const cantAdd = (c: Context, team: Team) => forbid(c, `Only ${team.name}'s members and admins can add people to it`);
  /** puts active people on a team and tells them in their inbox; returns who wasn't on it already */
  const addToTeam = (team: Team, ids: string[]): string[] => {
    const added = ids.filter(id => !team.memberIds.includes(id));
    for (const id of added) store.addTeamMember(team.id, id);
    store.notifyEach(added, 'teamMemberAdded', { actorId: me(), body: `${team.id}|${team.name}` });
    return added;
  };
  // invites only make sense where people sign in
  const invitesOff = (c: Context) => !hosted ? c.json({ error: 'Invites need a hosted workspace (BASELINE_PUBLIC_URL)', code: 'not-hosted' }, 400) : null;

  // ---------- invites ----------
  app.get('/api/invites', (c) => {
    if (!accounts.canInvite(me())) return forbid(c, 'You can\'t invite people to this workspace');
    return c.json({ invites: accounts.openInvites().map(toInvite) });
  });
  // One request names people already here (by id, or by an address that's theirs) and new addresses.
  // Someone already here isn't invited again: they're put on the requested teams under the same rule
  // as Team settings › Members, so only new addresses need permission to invite.
  app.post('/api/invites', async (c) => {
    const off = invitesOff(c); if (off) return off;
    const b = await c.req.json().catch(() => ({})) as { emails?: unknown; userIds?: unknown; admin?: unknown; teamIds?: unknown };
    const entries = inviteEntries(b);
    if (!entries.length) return c.json({ error: 'Add at least one person or email address', code: 'invalid' }, 400);
    if (entries.length > MAX_INVITES) return c.json({ error: `Invite at most ${MAX_INVITES} people at a time` }, 400);
    // agents work in every team, so they're never on one; nor is someone who can't sign in
    const refused = entries.flatMap(e => e.kind === 'member' && !accounts.isActivePerson(e.userId) ? [e.userId] : []);
    if (refused.length) return c.json({ error: 'Only active people in this workspace can be added to a team. Agents work in every team.', code: 'invalid', userIds: refused }, 400);

    type Step = { kind: 'member'; userId: string; email: string } | { kind: 'invite'; email: string } | { kind: 'invalid'; email: string; error?: string };
    const steps: Step[] = [];
    const seen = new Set<string>();
    for (const e of entries) {
      if (e.kind === 'member') {
        if (seen.has(e.userId)) continue;
        seen.add(e.userId);
        steps.push({ kind: 'member', userId: e.userId, email: accounts.userBrief(e.userId)!.email });
        continue;
      }
      if (!isEmail(e.email)) { steps.push({ kind: 'invalid', email: e.email, error: emailProblem(e.email) }); continue; }
      const existing = accounts.memberByEmail(e.email);
      if (seen.has(existing?.id ?? e.email)) continue;
      seen.add(existing?.id ?? e.email);
      steps.push(!existing ? { kind: 'invite', email: e.email }
        : existing.status === 'active' ? { kind: 'member', userId: existing.id, email: e.email }
        : { kind: 'invalid', email: e.email, error: 'Suspended. An admin can reactivate them in Members' });
    }

    const teams = knownTeams(b.teamIds).map(id => store.getTeam(id)!);
    const invites = steps.filter(s => s.kind === 'invite');
    if (invites.length && !accounts.canInvite(me())) return forbid(c, 'You can\'t invite people to this workspace');
    if (b.admin === true && !accounts.isAdmin(me())) return forbid(c, 'Only admins can invite admins');
    const missing = (userId: string) => teams.filter(t => !t.memberIds.includes(userId));
    const closed = steps.flatMap(s => s.kind === 'member' ? missing(s.userId) : []).find(t => !canAddTo(t));
    if (closed) return cantAdd(c, closed);
    if (invites.length && !inviteLimit.take(me(), invites.length)) return tooMany(c);

    const results: InviteResult[] = [];
    for (const s of steps) {
      if (s.kind === 'invalid') results.push({ email: s.email, status: 'invalid', ...(s.error ? { error: s.error } : {}) });
      else if (s.kind === 'member') {
        const add = missing(s.userId);
        for (const t of add) addToTeam(t, [s.userId]);
        results.push(!teams.length ? { email: s.email, userId: s.userId, status: 'already-in-workspace' }
          : add.length ? { email: s.email, userId: s.userId, status: 'added-to-teams', teamIds: add.map(t => t.id) }
          : { email: s.email, userId: s.userId, status: 'already-on-teams', teamIds: teams.map(t => t.id) });
      } else {
        const row = accounts.createInvite(s.email, b.admin === true, teams.map(t => t.id), me());
        results.push({ email: s.email, status: 'invited', invite: toInvite(row), ...await sendInvite(row) });
      }
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

  // ---------- team join links ----------
  // One link per team that anyone can open to make an account on it. Admins and the team's lead make and revoke them;
  // anyone who may invite can see and copy the open one.
  const toJoinLink = (teamId: string): TeamJoinLink | null => {
    const r = accounts.joinLinkFor(teamId);
    return r && hosted ? { teamId, link: new URL(`/?join=${r.code}`, hosted.publicUrl).toString(), createdBy: r.created_by, createdAt: r.created_at } : null;
  };
  app.get('/api/teams/:id/join-link', (c) => {
    const off = invitesOff(c); if (off) return off;
    if (!store.getTeam(c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    if (!accounts.canInvite(me())) return forbid(c, 'You can\'t invite people to this workspace');
    return c.json({ joinLink: toJoinLink(c.req.param('id')) });
  });
  app.post('/api/teams/:id/join-link', (c) => {
    const off = invitesOff(c); if (off) return off;
    const team = store.getTeam(c.req.param('id'));
    if (!team) return c.json({ error: 'not found' }, 404);
    if (!accounts.isAdmin(me()) && !team.leadIds.includes(me())) return forbid(c, 'Only admins and the team\'s lead can make a team join link');
    accounts.createJoinLink(team.id, me());
    return c.json({ joinLink: toJoinLink(team.id) }, 201);
  });
  app.delete('/api/teams/:id/join-link', (c) => {
    const off = invitesOff(c); if (off) return off;
    const team = store.getTeam(c.req.param('id'));
    if (!team) return c.json({ error: 'not found' }, 404);
    if (!accounts.isAdmin(me()) && !team.leadIds.includes(me())) return forbid(c, 'Only admins and the team\'s lead can turn off a team join link');
    accounts.revokeJoinLink(c.req.param('id'));
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

  // a one-use link that sets this person's password. The admin shares it, so no email is needed
  // (a key can't ask for one, see principal.ts)
  app.post('/api/members/:id/reset-link', (c) => {
    if (!hosted) return c.json({ error: 'Passwords are for hosted workspaces (BASELINE_PUBLIC_URL)', code: 'not-hosted' }, 400);
    if (!accounts.isAdmin(me())) return forbid(c, 'Only admins can make password reset links');
    const target = store.snapshot().users.find(u => u.id === c.req.param('id') && u.kind === 'human');
    if (!target) return c.json({ error: 'No such person', code: 'not-found' }, 404);
    if (target.status === 'suspended') return c.json({ error: `${target.name} is suspended. Reactivate them first.`, code: 'invalid' }, 400);
    const { token, expiresAt } = accounts.createPasswordReset(target.id, me(), RESET_LINK_TTL);
    return c.json({ link: resetLink(hosted.publicUrl, token), expiresAt });
  });

  // ---------- team membership (TEAM_PLAN.md › Team membership) ----------
  app.post('/api/teams/:id/members', async (c) => {
    const team = store.getTeam(c.req.param('id'));
    if (!team) return c.json({ error: 'not found' }, 404);
    if (!canAddTo(team)) return cantAdd(c, team);
    const b = await c.req.json().catch(() => ({})) as { userIds?: unknown };
    const ids = Array.isArray(b.userIds) ? [...new Set(b.userIds.filter((x): x is string => typeof x === 'string'))] : [];
    if (!ids.length) return c.json({ error: 'Pick at least one person', code: 'invalid' }, 400);
    // agents work in every team, so they're never on one; nor is someone who can't sign in
    const refused = ids.filter(id => !accounts.isActivePerson(id));
    if (refused.length) return c.json({ error: 'Only active people in this workspace can be added to a team. Agents work in every team.', code: 'invalid', userIds: refused }, 400);
    return c.json({ added: addToTeam(team, ids) });
  });
  app.delete('/api/teams/:id/members/:userId', (c) => {
    const team = store.getTeam(c.req.param('id'));
    if (!team) return c.json({ error: 'not found' }, 404);
    const target = c.req.param('userId');
    if (target !== me() && !leads(team)) return forbid(c, `Only ${team.name}'s lead or an admin can remove someone else from it`);
    // every team is open to everyone, so a team nobody is on is still reachable: no last-member rule
    store.removeTeamMember(team.id, target);
    return c.json({ ok: true });
  });
  // make someone a team's lead, or not: its leads and admins decide. A team may end up with no
  // lead; its admins then set it up, as before team leads existed
  app.put('/api/teams/:id/leads/:userId', async (c) => {
    const team = store.getTeam(c.req.param('id'));
    if (!team) return c.json({ error: 'not found' }, 404);
    if (!leads(team)) return forbid(c, `Only ${team.name}'s lead or an admin can choose its leads`);
    const target = c.req.param('userId');
    if (!accounts.isActivePerson(target)) return c.json({ error: 'Only active people in this workspace can lead a team', code: 'invalid' }, 400);
    const b = await c.req.json().catch(() => ({})) as { lead?: unknown };
    if (typeof b.lead !== 'boolean') return c.json({ error: 'lead must be true or false', code: 'invalid' }, 400);
    if (b.lead && !team.memberIds.includes(target)) addToTeam(team, [target]);
    store.setTeamLead(team.id, target, b.lead);
    return c.json({ team: store.getTeam(team.id) });
  });

  // ---------- "Ask <name>" ----------
  // A member who meets a setting they can't change asks someone who can, in one click: a plain row in
  // that person's inbox saying what was asked, linking to the page. Only admins and team leads are askable.
  const askLimit = limiter(30, 60 * 60_000);
  app.post('/api/access-requests', async (c) => {
    const b = await c.req.json().catch(() => ({})) as { to?: unknown; what?: unknown; path?: unknown };
    const to = typeof b.to === 'string' ? b.to : '';
    const what = typeof b.what === 'string' ? b.what.trim().slice(0, 200) : '';
    const path = typeof b.path === 'string' && /^\/[\w\-/]*$/.test(b.path) ? b.path : '';
    if (!what) return c.json({ error: 'Say what you need', code: 'invalid' }, 400);
    const askable = accounts.isActivePerson(to) && (accounts.isAdmin(to) || store.snapshot().teams.some(t => t.leadIds.includes(to)));
    if (!askable) return c.json({ error: 'Ask an admin or a team lead', code: 'invalid' }, 400);
    if (to === me()) return c.json({ error: 'That\'s you: you can change it yourself', code: 'invalid' }, 400);
    if (!askLimit.take(me())) return c.json({ error: 'You\'ve asked a lot this hour. Try again later.', code: 'rate-limited' }, 429);
    store.notifyEach([to], 'accessRequested', { actorId: me(), body: `${path}|${what}` });
    return c.json({ ok: true }, 201);
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
    const b = await c.req.json() as { approvedDomains?: string[]; domainTeamIds?: string[]; whoCanInvite?: 'admins' | 'members'; smallTeamInvites?: boolean };
    const security = store.setSecurity({
      approvedDomains: Array.isArray(b.approvedDomains) ? b.approvedDomains.map(String) : undefined,
      domainTeamIds: b.domainTeamIds !== undefined ? knownTeams(b.domainTeamIds) : undefined,
      whoCanInvite: b.whoCanInvite,
      smallTeamInvites: b.smallTeamInvites,
    });
    return c.json({ security });
  });
}

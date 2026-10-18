# Baseline for teams: plan

Baseline today is a single-person app on a laptop. This plan turns it into the tracker one
company runs for all its teams. It covers Google sign-in, email invites, notifications
by inbox and email with full per-person controls, and GitHub integration across many repos.
Linear is the reference throughout. Where this plan copies a Linear behaviour, it says so.

## Decisions taken

| Topic | Decision |
|---|---|
| Hosting | One GCP VM per company. One Node server, SQLite (WAL) on a persistent disk, HTTPS through Caddy. One workspace per deployment, not multi-tenant. |
| Sign-in | Google only. No passwords and no magic links. |
| Joining | Admins invite by email. Anyone with a verified Google email at an approved domain (e.g. `acme.dev`) joins as a Member automatically. |
| Coding agents | Linear's model: agents are members you delegate issues to, and each request is a session with visible progress. Agents run on runners (`baseline connect`) that dial out to the server: each person's laptop, or a shared team machine. The server never runs an agent itself. |
| GitHub | A GitHub App with webhooks, now possible because the server has a public URL. This replaces the `gh` polling idea from the single-user plan. Read-only. Links PRs by branch, title or body; magic words decide what closes an issue. Adds an "In Review" state. |
| Email | SMTP, credentials in env. GCP blocks outbound port 25, so use 587 or 465 through Google Workspace SMTP relay, SES, Postmark or similar. |

## What has to change first (from the code audit)

Today the whole app assumes one person. These are the facts that drive Phase 1.

- **Identity is global.** "Me" is one row, `meta.currentUser`. "Set as me" in Settings changes it for every client. Every write with no actor is attributed to that user (`logActivity`, `src/core/store.ts`). Some routes accept a `userId` from the client body (comments, reactions, subscribe, project updates).
- **No auth anywhere.** `/api/seed` wipes the database. `/api/import`, `POST /api/users` (with `admin` in the body) and `PATCH /api/users/:id` are open to anyone who can reach the server. `admin` is stored but never checked.
- **Notifications have no recipient.** The `notifications` table has no `user_id` column. Every emitter (`notifyAssign`, `notifySubscribed`, `notifyMention`, `notifyProject`, `remindUpdates`) only notifies `currentUser`. Read state, snooze and mark-all-read are global.
- **Per-person state is global.** Favorites, saved views (no owner), preferences including `notify.*` (`meta.preferences`), terminal choice and the handoff template are one copy for the whole workspace.
- **Stored XSS.** `marked` output goes through `dangerouslySetInnerHTML` without sanitising (`web/src/Markdown.tsx`). This is harmless with one user and a hole with many. Attachments are served inline with a content type the client chose.
- **Mentions match by name** (`@Name`), and names aren't unique.
- **Realtime is a 5-second poll of the whole workspace** (`web/src/store.ts`). `/api/bootstrap` returns everything: all users, up to 2000 activity rows and up to 500 notifications. That is fine for one tab and wasteful for 30 people.
- **Nothing runs on a timer.** `store.tick()` (cycles, recurring issues, reminders) only runs when a browser polls `/api/bootstrap`. Email digests need a real scheduler.
- **The CLI opens SQLite directly** (`createApp(dbPath)`). It can't reach a remote server, and it's how Claude Code reads and writes issues.
- **Machine-local endpoints run on the server host.** These are `/api/issues/:id/open-claude` (writes a `.command` file and runs `open -a Terminal`), `/api/directories/pick` (AppleScript), `/api/directories/check`, `/api/terminals` and `/api/locations`. On a VM they would act on the VM.
- **No team membership.** There's no `team_members` table, so everyone sees every team.

---

## Phase 1: Accounts and hosting (deployable)

After this phase, the team can sign in to the hosted app at, for example, `https://baseline.example.com`.

### Identity and sessions
- `users` gets new columns: `google_sub` (unique), `avatar_url`, `role` (`admin`/`member`; `guest` comes later), `status` (`active`/`suspended`), `created_at`, `last_seen_at`. Add a unique index on `lower(email)` for humans. Agent users stay as they are (`kind = 'agent'`).
- New `sessions` table: hashed token, `user_id`, `expires_at`, `user_agent`, `ip`, `created_at`. The cookie is HttpOnly, Secure and `SameSite=Lax`, with a 30-day sliding expiry.
- Hono middleware loads the session and sets `c.get('user')`, else returns 401. Every route passes `actorId` from the session. Remove `b.userId` from request bodies, `PATCH /api/workspace {currentUserId}` and "Set as me". `meta.currentUser` goes away. The bootstrap `currentUser` comes from the session.
- CSRF: `SameSite=Lax` cookies, plus the existing Origin check rewritten to compare against `BASELINE_PUBLIC_URL`, plus JSON content type on writes.
- Authorization helper `requireAdmin` covers users and roles, workspace settings, security settings, integrations, import and export. `/api/seed` is disabled in production.

### Google sign-in
- OAuth 2.0 authorization code flow with PKCE, `state` and `nonce`, using the `arctic` library or about 100 lines of `fetch`. Scopes are `openid email profile`.
- Accept a sign-in only when `email_verified` is true. Use the `hd` claim to check approved domains.
- Sign-in decision, in order:
  1. A user with a matching `google_sub` exists → sign in.
  2. A user with a matching email exists and has no `google_sub` (seeded or imported) → link and sign in.
  3. There's a pending invite for that email → create the user with the invite's role and teams.
  4. The email domain is approved → create a Member and add them to the workspace's default teams.
  5. Otherwise → "Ask an admin for an invite" page.
- `BASELINE_OWNER_EMAIL` makes the first person to sign in with that address the admin.
- Suspended users can't sign in, and suspending someone revokes their sessions.

### Invites (Linear: Settings → Members → Invite)
- New `invites` table: `email`, `role`, `team_ids`, `invited_by`, hashed `token`, `expires_at` (7 days), `accepted_at`, `revoked_at`.
- The Invite dialog takes several emails (comma-separated, like Linear), a role and teams. The invite email links to `/invite/:token`, which goes to Google sign-in. The Google email must match the invite email, ignoring case.
- The Members page lists Active, Invited and Suspended people, with role, teams, joined date and last seen (Linear's columns). Admins can resend or revoke invites, change roles, suspend, and export CSV.
- Inviters get an "Invite accepted" email (Linear's "Other updates"). This uses Phase 3's email sender. Until Phase 3 ships, invite links can be copied from the Members page.

### Security settings (Linear: Settings → Security)
- Approved email domains (add or remove), and the default teams for people who join through a domain.
- Who can invite: Admins only, or all Members.
- Google is the only sign-in method, so this page just shows that.

### Team membership
- New `team_members(team_id, user_id)` table. "Your teams" in the sidebar, team pickers and default team filters follow membership. Every member can still see and join any team; private teams come later.
- Issue triage changes from "creator isn't me" to Linear's rule: an issue lands in triage when it's created by someone who isn't a member of the team, or by an agent.

### Per-person state
- `favorites.user_id`; `views.owner_id` with `shared` (personal versus workspace views, as in Linear).
- New `user_preferences(user_id, json)` table that replaces `meta.preferences`. Terminal app and handoff overrides move here too. The workspace handoff template stays as the default.
- `project_subscriptions` and `subscriptions` are already per user. Their emitters get fixed in Phase 3.

### Hardening
- Sanitize rendered markdown with DOMPurify, keeping only allowed tags and attributes. Mentions and links keep working.
- Attachments: require a session, send `X-Content-Type-Options: nosniff`, serve images inline, and send everything else with `Content-Disposition: attachment`.
- Mentions become ID-based, e.g. `@[Ada](user:u_123)` in stored markdown. The editor and the server parse IDs. Old `@Name` text resolves once when migrated.
- Rate-limit sign-in and invite endpoints.

### Realtime and scheduling
- Replace the 5-second full-snapshot poll with server-sent events. The server bumps a change counter on every write and pushes `{"v": 123}` to open tabs, and a tab refetches `/api/bootstrap` only when the counter moves. One SSE connection per tab, with a heartbeat every 25 seconds.
- `store.tick()` moves to a server `setInterval` every 60 seconds, and so does the outbox worker from Phase 3. This is safe because there's a single process.

### Deployment (GCP)
- An e2-small VM running Debian, with a persistent disk at `/var/lib/baseline` for the db and attachments. Node 22 runs under systemd and Caddy terminates TLS.
- Config is env vars in `/etc/baseline.env`: `BASELINE_PUBLIC_URL`, `BASELINE_DB`, `BASELINE_OWNER_EMAIL`, `GOOGLE_CLIENT_ID`/`SECRET`, `SMTP_*`, `GITHUB_APP_*`, `SESSION_SECRET`.
- Backups: a nightly `VACUUM INTO` snapshot plus the attachments directory, synced to a GCS bucket, keeping 30 days. A `deploy.sh` does a git pull, `npm ci`, build and restart, mirroring `app.sh update` in OPERATIONS.md.
- Moving your data: export from your laptop instance, import on the server, then sign in with Google. The match-by-email rule links your existing user row.
- Update SECURITY.md (its bind-address section is stale today), OPERATIONS.md and README.

**Done when:** a teammate you invite gets the email, signs in with Google, and sees their own inbox and favorites. Someone at an approved domain joins without an invite, and a stranger is turned away. Nightly backups land in GCS.

---

## Phase 2: Coding agents on a hosted server

Today, hand-off to Claude Code assumes the server is your laptop. Open in Claude Code starts a terminal on the server's own machine. The CLI writes straight to the SQLite file and names itself with `BASELINE_AS`. Nothing records a run, and nothing reports back. This phase copies Linear's agent model (Linear: Settings → AI & agents, and the "Linear for Agents" developer docs):
- agents are workspace members you delegate issues to;
- every request is a session people can watch and steer;
- the code runs on machines the team controls: each person's laptop, or a shared runner. The server never runs an agent itself.

### The model (copying Linear)
- **Agents are installed members.** Agent users (`kind = 'agent'`) stay as they are. Admins add them in Settings → Agents and choose the teams each one may work in. An agent shows in assignee and @mention menus only on those teams.
- **Delegate, not assignee.** New column `issues.delegate_id`.
  - **Ownership:** assigning an issue to an agent sets it as the delegate. The assignee stays the person who delegated, or becomes them if the issue had none, so the issue stays in their My issues.
  - **Views:** Delegate is a filter, a display property and a grouping, as in Linear.
  - **Status:** when an agent starts on an issue that isn't started yet, the issue moves to the team's first started status (Linear's rule).
  - **Automations:** an issue an automation delegated stays in triage and keeps no assignee, so a person decides who owns it.
- **Agent sessions.** New table `agent_sessions(id, issue_id, comment_id, agent_id, requested_by, runner_id, state, plan, external_urls, branch, created_at, updated_at, ended_at)`.
  - **Created by:** delegating an issue to an agent, @mentioning an agent in a comment, or Open in Claude Code.
  - **States** are Linear's: `pending`, `active`, `awaitingInput`, `error`, `complete`, `stale`. A session's state follows its last activity, so nobody sets it by hand.
- **Activities.** New table `agent_activities(id, session_id, type, body, ephemeral, created_at)`.
  - **Types:** `prompt` (from a person), `thought`, `action`, `elicitation` (a question for the person), `response`, `error`.
  - **Ephemeral:** a `thought` or `action` marked ephemeral is replaced by the next activity.
  - **Questions, answers, errors:** an `elicitation`, `response` or `error` also posts a comment in the issue's thread, as Linear does. It lands in the requester's inbox.
  - **Steering:** replying in the session adds a `prompt`, and the runner continues the same run.
  - **Snapshots:** activities never change after they're written, so a runner rebuilds the conversation from them, not from editable comments.
- **Plan.** A session-level checklist (`content`, `status`: pending, inProgress, completed, canceled). The agent replaces it whole each time.
- **Timing (Linear's limits).** A runner must acknowledge a new session within 10 seconds, or the session shows as unresponsive. A session with no activity for 30 minutes becomes `stale`, and another activity brings it back.
- **Guidance.** Markdown instructions at workspace level and team level, with history. Team guidance wins when both say something.
  - **Contents:** which repo to use, how to name branches and reference issues, what review to ask for.
  - **Prompt:** it goes into the prompt with the issue, its comments and the existing hand-off template (Settings → Coding tools).
- **Attribution.** An agent's writes record the agent as the actor and the requester in a new `via_user_id` field. This covers comments, status and property changes, and activity. It shows as "Claude Code via Parth".

### Runners: where the code runs
A runner is a `baseline connect` process. It keeps an outbound SSE connection to the server and takes sessions down it.
- **Why outbound.** The hosted page can't safely call into a laptop: it would hit Chrome's Private Network Access rules, CORS and Safari quirks. The server can't reach machines behind NAT either. So every runner dials out, and the server sends work down the open connection.
- **Personal runner** (each person's laptop):
  - **Setup:** `baseline connect`, with `--install` adding a launchd agent so it starts at login. It's authenticated with that person's API key, and it only takes sessions that person requested.
  - **Interactive (Open in Claude Code):** opens Claude Code in that person's terminal, in the issue's repo, as `openInClaudeCode` (`src/server/launch.ts`) does today. The session shows "Opened in Parth's terminal", and the agent reports progress through `baseline session …` commands as it works.
  - **Background:** when someone delegates to Claude Code and picks "on my machine", the runner runs `claude -p` with streaming JSON output in a new git worktree. It maps that output to activities:

    | Claude Code output | Activity or session field |
    |---|---|
    | text | `thought` |
    | tool calls | `action` |
    | its to-do list | plan |
    | the result | `response` |
    | a failure | `error` |

    A reply in the session resumes the same Claude Code conversation.
- **Shared runner** (a team VM or Mac mini):
  - **Registration:** an admin registers it with a runner token. It's bound to an agent identity, such as "Claude Code", and to the teams that agent works in, and anyone on those teams can delegate to it.
  - **Each session:** it works in a fresh git worktree of the repo, on a branch named by the workspace branch format. It pushes the branch and opens a draft PR (`gh pr create --draft`), then adds the PR's URL to the session's links.
  - **Credentials:** tool setup and credentials live on that machine, never on the server.
  - **Loops:** this is where the "Open in Claude Code" loop action runs on a hosted server.
- **Which runner takes a session:**
  - **Interactive:** always the requester's personal runner.
  - **Delegated, "on my machine" chosen:** the requester's personal runner, if it's online.
  - **Delegated otherwise:** a shared runner bound to that agent.
  - **No runner online:** the session stays `pending` with "No runner online", and starts when one connects.
- **Repos and paths.**
  - **Repos** are workspace-level: a name plus an optional GitHub `owner/repo`. Projects and issues point at repos.
  - **Paths** are per person: `user_repo_paths(user_id, repo_id, path)`. The personal runner fills them in by reading `git remote get-url origin` from folders you pick. A shared runner keeps its own clones.
  - **Moving today's data:** each `location` becomes a repo, and your own paths come with it.
  - **Picking the repo:** a session uses the issue's repo, then the project's repos (still only suggestions). If it's still unsure, it asks with an `elicitation`, as Linear's repo suggestions do.
- **Folder picker and directory check** use the same channel as a request and reply.

### API keys, session keys and the CLI over HTTP
- **API keys on a hosted server.** Personal keys exist already (`api_keys`, with scopes and team limits, Settings → Security & access). On a hosted server, though, the sign-in guard runs first and refuses any request without a cookie. Accept a valid key in place of the cookie, still checking the host, scopes and teams.
- **Session keys.** When a runner starts a session, the server gives it a key that belongs to that session only. The key:
  - acts as the agent via the requester;
  - is limited to the issue's team;
  - stops working when the session ends.

  The runner hands it to Claude Code as `BASELINE_URL` and `BASELINE_TOKEN`, with `BASELINE_SESSION` naming the session. On a hosted server these replace `BASELINE_DB` and `BASELINE_AS`; local mode keeps today's variables.
- **Acting as an agent with a personal key.** For CLI use outside a session, `--as <agent>` is allowed only for agent users and records you as `via_user_id`.
- **CLI.**
  - **Login:** `baseline login --server https://baseline.example.com` opens the browser, you approve, and the key is stored in `~/.baseline/config.json` (mode 0600).
  - **Over HTTP:** commands call the REST API instead of `createApp(dbPath)`. Snapshot reads use `/api/bootstrap`, writes use the existing routes, and anything the CLI does without a route gets one.
  - **Tests:** `scripts/test-cli.sh` runs against a local server.
- **Session commands** for the agent itself: `baseline session thought|action|ask|reply|error "text"`, `session plan`, and `session link <url>`. They act on `BASELINE_SESSION`.
  - **Manual runs:** `baseline session start <KEY>` opens a session for a Claude Code run someone started by hand.
  - **Agent instructions:** the skill (`skills/baseline/SKILL.md`) and the hand-off prompt's footer teach these commands.

### UI
- **Issue page:** a Delegate chip next to the assignee. Each session appears in the activity feed with:
  - the agent, the requester and the state;
  - the plan;
  - activities, with tool actions collapsed;
  - links, including the PR;
  - a reply box and a Stop button.
- **My issues** includes issues you delegated, and Delegate is in filters, display options and grouping.
- **Inbox:** questions, replies and errors from sessions you started.
- **Settings → Agents** (admins): agents and their teams, workspace and team guidance, shared runners with "last seen", and recent sessions.
- **Settings → Coding tools** (personal):
  - runner status, such as "Runner connected on Parth's MacBook · last seen 10s ago", or how to install it;
  - your repo paths and terminal;
  - whether delegating runs on your machine or a shared runner.

### Order inside the phase
1. **API keys on hosted, CLI over HTTP, attribution.** This must ship before you move your own work to the server, or Claude Code hand-off breaks.
2. **Delegate, sessions, activities, guidance, the session UI and `baseline session` commands.** These are useful before any runner exists, because a hand-started Claude Code run can report into its session.
3. **Personal runner:** interactive first, then background.
4. **Shared runner and Loops.**

**Done when:**
- On a laptop running only `baseline connect`, Open in Claude Code from the hosted app opens the right repo in that person's terminal, and the session shows on the issue.
- Delegating ENG-42 to Claude Code with a shared runner online:
  - the session acknowledges within 10 seconds and shows its plan and progress;
  - its question reaches the requester's inbox, and it carries on after the reply;
  - it ends with a draft PR linked on the issue.
- Every agent write shows as "Claude Code via <person>". A session key can't reach another team, and it stops working when its session ends.

---

## Phase 3: Notifications and email

### Delivery to each person
- `notifications.user_id`, with read and snooze state per recipient. Mark-all-read is scoped to the recipient. Retention: delete read notifications older than 90 days.
- One `notify(event)` fan-out computes recipients, then filters them by each person's settings. The actor is never notified of their own action, as in Linear. Recipients by event:
  - **Assigned or unassigned:** the assignee and the previous assignee.
  - **Comment or reply:** issue subscribers, plus everyone in the thread for replies.
  - **Mention in a comment or description:** the person mentioned. This also fixes today's gap where a mention made while creating an issue doesn't notify.
  - **Status, priority or blocking changes:** subscribers.
  - **Reaction:** the author of the comment.
  - **Project updates and update reminders:** project subscribers, and the lead for reminders.
  - **Due date and reminders:** the assignee, or whoever set the reminder.
  - **New issue in triage:** team triage subscribers.
  - **GitHub events:** see Phase 4.

### Settings (copying Linear: Settings → Account → Notifications)
- **Channels:** Inbox (always on), Email, and Desktop. Desktop means browser push and comes later. The Notifications page lists each channel with its summary, e.g. "Enabled for all notifications".
- **Email channel page**, with every option Linear has:
  - Enable email notifications ("Email notifications to you@…").
  - Notification format: **Digest** or **Immediate**.
  - Digest settings:
    - Delay low-priority emails outside work hours until the next work day. This needs a timezone and work hours on the profile.
    - Immediately notify when an assigned issue is Urgent.
  - Per-category toggles: Assignments; Status changes; Comments and replies; Mentions; Reactions; Subscriptions; Document changes; Updates; Reminders and deadlines; Apps and integrations (GitHub); Triage.
  - Other: Invite accepted.
- **Priority inbox** (Linear has it, and it's off by default) is deferred.
- **Subscriptions:** issues (existing), projects (the existing bell), and teams, which is new: "notify me of every new issue in team X". View subscriptions come later.
- Stored in a new `notification_settings(user_id, channel, category, enabled)` table plus email options in `user_preferences`. Defaults are all on, with Digest format.

### Email
- nodemailer over SMTP, configured in env. Admin settings get a "Send test email" button and a status line such as "Last sent 2m ago" or the last error.
- **Outbox table:** `email_outbox(id, user_id, kind, payload, status, attempts, next_attempt_at, sent_at, error)`. A worker on the 60-second tick sends pending emails with exponential retry, up to 5 attempts.
- **Timing:**
  - Immediate mode waits a 2-minute grace period.
  - Digest mode collects notifications for 10 minutes and sends them as one email, grouped by issue.
  - Either way, anything you already read in the app before sending is dropped, as in Linear.
  - Urgent assignments skip the wait.
- **Email content:** `Subject: [ENG-42] Fix login redirect`, plus a plain-text and a simple HTML version with the issue link and a short excerpt. Sends a `List-Unsubscribe` header with a one-click token per category. `Reply-To` is no-reply; replying by email to comment is deferred.
- **Sending emails:** invites, invite accepted, notification digest, and individual notifications.
- **Deliverability:** the README documents SPF and DKIM for whichever relay you use.

**Done when:** two people on the same issue each see only their own notifications in the inbox. One gets a digest email and the other an immediate one. Turning off "Status changes" for email stops those emails but not the inbox items.

---

## Phase 4: GitHub (copying Linear's GitHub integration)

### Connecting
- **The company registers its own GitHub App.** Settings → Integrations → GitHub has a "Create GitHub App" button that uses GitHub's app-manifest flow, which pre-fills the name, permissions, events and webhook URL and returns the keys. The app ID, private key and webhook secret are stored server-side.
  - **Permissions (all read-only):** pull requests, checks, commit statuses, contents (for pushes), metadata.
  - **Events:** `pull_request`, `pull_request_review`, `check_suite`, `status`, `push`, `installation*`.
- **Install on one or more GitHub orgs**, choosing "All repositories" or "Only select repositories". Several orgs are supported, as in Linear.
- **New tables:**
  - `github_installations`
  - `github_repos` (`full_name`, `default_branch`, `installation_id`). These link to Phase 2's repos by `owner/repo`.
  - `pull_requests` and `issue_prs` already exist from the single-user git integration on main (`src/core/git.ts`). Webhooks feed its `ingestPullRequest` / `ingestPush` instead of `gh` polling.
- **Personal connection** (Linear: Settings → Connected accounts): each person links their GitHub login. PR activity is then attributed to them, and they get notified about reviews.

### Webhooks
- `POST /api/github/webhook` verifies `X-Hub-Signature-256` with HMAC and skips duplicate deliveries using `X-GitHub-Delivery` (`github_deliveries` table). It returns 200 straight away and does the work from a queue on the tick.
- Reconciliation: on install, and hourly, list recently updated PRs per repo so missed webhooks are caught up.

### Linking (from the single-user plan, now with Linear's full word lists)
- **Branch name containing `ENG-42`:** closing link.
- **Issue ID in the PR title:** linked.
- **Magic words in the PR title or description:**
  - **Closing:** close(s/d/ing), fix(es/ed/ing), resolve(s/d/ing), complete(s/d/ing), implement(s/ed/ing).
  - **Non-closing:** ref, refs, references, part of, contributes to, toward(s).
  - **Relation only:** relates to, related to.
  - **Skip:** `ignore ENG-42` and `skip ENG-42`.
  - Several IDs can follow one magic word, e.g. `Fixes ENG-1, ENG-2`.
- If the issue is unassigned when a PR links, assign it to the PR author if their GitHub account is connected (Linear does this).
- **Commits:** magic words in commit messages on `push` events. Pushed means In Progress, and reaching the default branch means Done.
- **One issue, many PRs:** status changes when the last linked PR reaches the required state, as in Linear. Closed-unmerged PRs don't count.
- Unlink from the PR row's menu. A dismissed link is never re-created.
- **Agent sessions (Phase 2):** a PR whose branch is an agent session's branch is also added to that session's links. A PR opened by a shared runner is attributed to the agent via the person who delegated.

### Status automation (Linear: Team → Workflows & automations → Pull request automations)
- Per team, these events map to a state or "No action":
  - Draft PR opened. Default: In Progress.
  - PR opened. Default: In Progress.
  - Review requested or activity. Default: In Review.
  - Ready for merge. Default: No action.
  - Merged. Default: Done.
- **Branch-specific rules:** a target-branch regex overrides those rules, e.g. merged into `staging` → "In QA", or `^release/.*` → No action. This copies Linear.
- Status only moves forward, canceled issues are never touched, and each move logs "Moved to In Review by PR #123", which you can undo.
- "In Review" (type `started`) is added to existing teams once, and is in new teams' defaults.

### UI
- **Issue page:** an attachment row per PR showing state, number, title, repo, reviewer avatars with their review state ("review requested" for team reviews), checks status, and preview links. Linear detects Vercel, Netlify and Cloudflare preview links, plus any Markdown link labelled "…Preview".
- **Lists and boards:** a PR icon colored by state.
- **Branch naming:** a workspace setting with Linear's format variables, e.g. `{username}/{issueIdentifier}-{issueTitle}`. It feeds the existing `branchName()` and "Copy branch".
- **Notifications, in the Apps and integrations category:**
  - Review requested from you.
  - A review on your PR (approved or changes requested).
  - Checks failed on your PR.
  - Your PR merged.

**Done when:** in a repo whose org installed the app, Claude Code opens a PR from `eng-42-…`, and ENG-42 shows the PR and moves to In Progress. The issue moves to In Review when a review is requested and to Done when the PR merges. A second org's repo works the same way.

---

## Later (deliberately out of these phases)
Guests with team-scoped visibility (this needs a per-person filtered snapshot); private teams; desktop push; replying to notification emails to add a comment; GitHub Issues sync both ways; linkback comments on PRs; auto-closing PRs when an issue is canceled; Slack; GitLab; priority inbox; view subscriptions; SAML/SCIM; outside agents (Codex cloud, Cursor, Devin) through an outgoing webhook for session events plus the activity API, close to Linear's protocol; cloud sandboxes like Linear's coding sessions.

## Order and size
1. **Phase 1: accounts and hosting.** The largest phase, because it touches most routes and store methods. Split it into PRs: identity and sessions → Google and invites → per-person state and hardening → SSE and scheduler → deploy.
2. **Phase 2: coding agents.** Its first step (API keys on hosted, CLI over HTTP) must ship before you move your own work to the server, or Claude Code hand-off breaks.
3. **Phase 3: notifications and email.**
4. **Phase 4: GitHub.**

Phases 3 and 4 are independent of each other once Phase 2 is done.

## Verification for every phase
- `npm run typecheck`, and `npm run test:cli` against a local server.
- A local two-user run: run the server with `BASELINE_PUBLIC_URL=http://localhost:7327` and a Google OAuth client set to localhost. Sign in as two Google accounts in two browser profiles and walk through that phase's "Done when".
- Email: point SMTP at a local catcher (Mailpit) in dev and check rendering, digest grouping and unsubscribe links.
- GitHub: a test org with a test repo. Replay webhooks with `gh webhook forward`, or use the "Redeliver" button on the App's advanced page.

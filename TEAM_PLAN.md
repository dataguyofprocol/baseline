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
| Local tools | A local companion: `baseline connect` runs on each laptop. It opens Claude Code in that person's terminal, runs the folder picker, and holds that person's repo paths. |
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

## Phase 2: CLI over HTTP and the local companion

Claude Code hand-off has to keep working once the server is remote.

### Personal API keys (Linear: Settings → API)
- New `api_keys` table: `user_id`, `name`, hashed `token`, `last_used_at`, `revoked_at`. Requests use `Authorization: Bearer`, accepted alongside the session cookie.
- **Agent attribution.** A request may send `X-Baseline-As: <agent user>`, but only agent-kind users are allowed. Activity then records the agent as the actor and the human in a `via_user_id` field, shown as "Claude Code via Parth". Today's `BASELINE_AS` keeps working.

### CLI
- `baseline login --server https://baseline.example.com` opens the browser, you approve, and the key is stored in `~/.baseline/config.json` (mode 0600).
- CLI commands call the REST API instead of `createApp(dbPath)`. The snapshot-reading commands use `/api/bootstrap`, and the write commands use the existing routes. Add routes for anything the CLI does that has no route yet.
- `scripts/test-cli.sh` runs against a local server.

### Companion (`baseline connect`)
- A long-running process on each laptop that holds an SSE connection to the server, authenticated with the person's key. `baseline connect --install` adds a launchd agent so it starts at login.
- **Why outbound.** The hosted page can't safely call into your laptop: it would hit Chrome's Private Network Access rules, CORS, and Safari quirks. Instead the companion keeps an outbound connection open and the server sends requests down it.
- **Open in Claude Code:** the web app calls `POST /api/issues/:id/open-claude`, the server sends `{open, issue, repo}` to *that person's* connected companions, and the companion runs today's `openInClaudeCode` (`src/server/launch.ts`) locally. `BASELINE_AS` is set to the Claude Code agent, and the companion passes its own key to the session.
- **Folder picker and directory check** use the same channel as a request and reply.
- **Locations get split in two:**
  - **Repos** are workspace-level: a name plus an optional GitHub `owner/repo`. Projects and issues point at repos.
  - **Paths** are per person: `user_repo_paths(user_id, repo_id, path)`. They're filled in by the companion, which reads `git remote get-url origin` from folders you pick.
  - Moving today's data: each `location` becomes a repo, and your own paths come with it.
- Settings → Coding tools shows "Companion connected on Parth's MacBook · last seen 10s ago", or how to install it.

**Done when:** on a laptop running only `baseline connect`, Open in Claude Code from the hosted app opens the right repo in your terminal. Claude Code's `baseline` CLI calls work, and its comments show as "Claude Code via Parth".

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
Guests with team-scoped visibility (this needs a per-person filtered snapshot); private teams; desktop push; replying to notification emails to add a comment; GitHub Issues sync both ways; linkback comments on PRs; auto-closing PRs when an issue is canceled; Slack; GitLab; priority inbox; view subscriptions; SAML/SCIM.

## Order and size
1. **Phase 1: accounts and hosting.** The largest phase, because it touches most routes and store methods. Split it into PRs: identity and sessions → Google and invites → per-person state and hardening → SSE and scheduler → deploy.
2. **Phase 2: CLI and companion.** It must ship before you move your own work to the server, or Claude Code hand-off breaks.
3. **Phase 3: notifications and email.**
4. **Phase 4: GitHub.**

Phases 3 and 4 are independent of each other once Phase 2 is done.

## Verification for every phase
- `npm run typecheck`, and `npm run test:cli` against a local server.
- A local two-user run: run the server with `BASELINE_PUBLIC_URL=http://localhost:7327` and a Google OAuth client set to localhost. Sign in as two Google accounts in two browser profiles and walk through that phase's "Done when".
- Email: point SMTP at a local catcher (Mailpit) in dev and check rendering, digest grouping and unsubscribe links.
- GitHub: a test org with a test repo. Replay webhooks with `gh webhook forward`, or use the "Redeliver" button on the App's advanced page.

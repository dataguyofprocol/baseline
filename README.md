# Baseline

Local-first issue & project tracker in the Linear style — one SQLite file, drivable from the **web UI** or the **CLI** (the CLI is the coding-agent surface).

## Work vs dev instances

| | work | dev (this repo) |
|---|---|---|
| code | `~/sideones/baseline-work` — git worktree, branch `work` | this checkout, branch `main` |
| web | http://localhost:7770 | http://localhost:7327 |
| data | `~/.baseline/baseline.db` | `~/.baseline/baseline-dev.db` (sandbox, auto-seeded) |

The work instance runs the real database — daily tracking and agent traffic (CLI) belong
there. Ops from the worktree:

```bash
~/sideones/baseline-work/app.sh start        # also: status · stop · restart
~/sideones/baseline-work/app.sh update       # DB backup → merge --ff-only main → build → restart
~/sideones/baseline-work/app.sh backup       # sqlite backup → ~/.baseline/backups (keeps last 10)
```

Ship a feature by landing it on `main` in this repo, then `app.sh update` in the worktree — data
lives outside the repo, so updates never touch it.

Dev commands here (`npm run dev`, `dev:server`, `start`, `serve`, `cli`, `seed`) default to the
sandbox DB and port 7327 so they can't touch real data — including `seed --reset`. Bare
`node dist/server/index.js` and `node bin/baseline.js` default to the real DB on
port 7770. Override anything with `BASELINE_DB`, `BASELINE_PORT`, or `BASELINE_URL`.
The server only listens on this machine (127.0.0.1 and ::1) and rejects requests addressed to any other host or sent cross-site from another origin; set `BASELINE_HOST=0.0.0.0` to open it to your network (launching Claude Code stays local-only either way).

**Live updates.** Open tabs keep a server-sent-events connection to `/api/events`. When the database changes, the server announces a new version and each tab refetches its own snapshot. That covers changes from the app, from teammates, and from agents writing through the CLI: the server watches SQLite's `data_version`. Cycles, recurring issues and update reminders run on a one-minute server timer, and only while the server is running.

**Hosted mode (a team server).** Setting `BASELINE_PUBLIC_URL` makes the server hosted: people sign in with an
email and password. Setting `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as well adds "Continue with Google"; the
server refuses to start with only one of the two.

**First run.** A new hosted server has no accounts. It prints a one-time setup token in its log (`baseline
setup-token --db <path>` prints it again, on the server). Open `BASELINE_PUBLIC_URL`, enter the token, and create the
owner account and the workspace name. The token stops working once the owner exists.

| Variable | Meaning |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional. An OAuth client of type "Web application" in Google Cloud. Its authorised redirect URI is `<BASELINE_PUBLIC_URL>/auth/google/callback`. |
| `BASELINE_PUBLIC_URL` | The address people open, e.g. `https://baseline.example.com`. Requests addressed to any other host, and writes from any other origin, are refused. |
| `BASELINE_OWNER_EMAIL` | With Google sign-in: signing in with this Google account creates the first admin, and always keeps them an admin. |
| `BASELINE_WORKSPACE_NAME` | Name of a new hosted workspace (default "Baseline"). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional email for invites. `SMTP_PORT` defaults to 587, and `SMTP_FROM` (e.g. `Baseline <baseline@acme.dev>`) is required once `SMTP_HOST` is set. GCP blocks outbound port 25, so use 587 or 465. Without SMTP, invites still work: copy the link from Settings › Members. With SMTP, the sign-in screen also offers "Forgot your password?". |

How hosted mode differs:
- **A new hosted workspace starts empty**, with no sample data.
- **Who can sign in:**
  - the owner, created on the setup screen (or, with Google, `BASELINE_OWNER_EMAIL`);
  - anyone who has set a password: through an invite or a reset link;
  - with Google: someone whose email matches an existing member who hasn't signed in yet, which covers imported data;
  - someone with an open invite, which lasts 7 days and is emailed or shared as a link. Opening it, they type the invited address and choose a password (or continue with that Google account);
  - with Google: a Google Workspace account at an approved domain (Settings › Security).

  Opening an invite with a different address or Google account says so instead of letting them in.
- **Passwords:** at least 10 characters, stored as scrypt hashes with a per-user salt. A wrong email and a wrong password get the same answer. An admin can make a one-use reset link for a member (Settings › Members, the member's menu; it lasts 24 hours). Everyone can change their own password in Settings › Security & access. Setting a new password signs out that person's other sessions.
- **Settings › Members:** invite people as Members or Admins onto chosen teams; resend, copy or revoke invites; change roles and teams; suspend or reactivate people. The workspace always keeps at least one admin, and nobody can suspend themselves.
- **Settings › Security:** approved domains and the teams those people start on, and whether members may invite (only admins invite admins).
- **Sessions** last 30 days, renewed as long as you keep using them.
- **Admin-only:** roles, suspension, security settings, workspace settings, import and export.
- **Teams:** anyone can join or leave any team from the Teams page. "Your teams" in the sidebar lists the teams you're on.
- **Per person:** favorites, preferences and your inbox (read, snoozed, reminders). A saved view is shared with the workspace unless its owner makes it personal (the view's menu on the Views page).
- **Mentions** are stored as `@[Ada Osei](user:u_…)`, so two people with the same name can't be confused. A plain `@Ada Osei`, for example one an agent writes through the CLI, still counts if only one member has that name.
- **Hardening:**
  - Comments and descriptions are sanitized before display.
  - Uploads other than images, video, audio and PDF download instead of rendering.
  - Sign-in, setup, invite links, reset links and invite sending are rate-limited per address, and password sign-in per account too. The limits read the client address from `X-Forwarded-For` only when the connection comes from a proxy on the same machine (Caddy).
- **Not available on a hosted server:** opening Claude Code and adding locations, which act on the machine they run on.

`npm run test:auth` covers setup, password and Google sign-in, invites, reset links, domains and roles.

**Production data:** the work DB was wiped of all seed/demo data on 2026-08-29 — the workspace
starts empty (create your team in Settings) and only real work lives there now. A database whose
`meta` table is empty starts blank in the web app (a first-run flow names your team and offers
the sample data) and seeded from the CLI, so never point dev tools or experiments at
`~/.baseline/baseline.db`; deleting or resetting that file would lose your work.
Pre-wipe backups: `~/.baseline/backups/`.

## Self-host with Docker

One deployment per organization: one container, one SQLite database on the `/data` volume, any number of teams and people.

**Start.** Copy `.env.example` to `.env` and fill in `BASELINE_PUBLIC_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `BASELINE_OWNER_EMAIL` (each variable is described there). Then:

```bash
docker compose up -d          # builds the image and serves on port 7770
docker compose ps             # "healthy" once GET /healthz answers
```

The container refuses to start without sign-in configured, because anyone who can reach the port would otherwise act as any user. `BASELINE_REQUIRE_SIGN_IN=0` turns that check off, for a trusted private network only.

**HTTPS.** In `.env`, uncomment `COMPOSE_FILE=compose.yaml:compose.https.yaml` and `BASELINE_DOMAIN`, set `BASELINE_PUBLIC_URL=https://<that domain>` and `BASELINE_PUBLISH=127.0.0.1:7770`, and point the domain's DNS at the machine. Caddy gets the certificate.

**First sign-in.** Open `BASELINE_PUBLIC_URL` and sign in with Google as `BASELINE_OWNER_EMAIL`: you become the admin, and onboarding asks for the first team. Invite everyone else from Settings › Members.

**Admin CLI.** `docker compose exec baseline baseline <command>` runs the CLI against the server's database, e.g. `user list`, `export --out /data/export.json`.

**Back up.** Everything lives in `/data`. Stop the server so the copy is consistent, copy, start:

```bash
docker compose stop baseline && docker compose cp baseline:/data ./baseline-backup && docker compose start baseline
```

To restore, stop, copy back, and give the files to the container's user:

```bash
docker compose stop baseline
docker compose cp ./baseline-backup/. baseline:/data
docker compose run --rm --no-deps --user root --entrypoint chown baseline -R node:node /data
docker compose start baseline
```

**Upgrade.** Back up, then `git pull && docker compose up -d --build`. The volume is kept, and the database schema migrates when the server starts.

**Connect a coding agent.** Each person installs the CLI on their own machine (not on npm yet: `npm pack` in this repo, then `npm install -g baseline-<version>.tgz`; it needs Node 22.13 or later), then in each repo:

```bash
baseline login --server https://baseline.example.com   # approve in the browser
baseline connect claude                                 # or: codex, pi
```

## What's inside

Issues with statuses, priorities, labels, sub-issues, relations, due dates, estimates and cycles · list & board views with grouping/sub-grouping/filters/display options · projects with updates, milestones and progress · issue templates & agent hand-off briefs (copy an issue as a ready-to-paste prompt) · inbox notifications · saved views & favorites · full keyboard model (press `?`) with undo toasts · command palette (⌘K) · dark & light themes · team settings with workflow-state and label editors. See `FEATURES.md` for the complete list.

## CLI

Every project & task operation is drivable from the CLI — `node bin/baseline.js`, `npm run cli`, or `baseline` when linked. Issues are addressed by key (`CORE-3`); teams, projects, labels and users by name. Every command accepts `--db <path>` (or `BASELINE_DB` env), so agents can work on scratch databases. Run `baseline <command> --help` for all flags.

```bash
# tasks
issue create "Title" -t CORE -s "In Progress" -p high -a Ada -l Bug -j "Project" --parent CORE-1 --estimate 3 --due 2026-09-15 [--json]
issue list -t CORE -s Todo -a me -j Project -p high -L Bug -q text [--archived] [--json]
issue show CORE-3 [--json]     # description, sub-issues, relations, comments, activity
issue handoff CORE-3 [--copy|--json]   # ready-to-paste agent prompt + suggested branch name
issue open CORE-3 [--location <name|path>]   # interactive Claude Code session in a new terminal window (macOS), in the issue's location
issue update CORE-3 -s Done -p urgent -a Jun --title "New" -d "md" --labels Bug,Perf --parent none --estimate none --due none --project none
issue archive CORE-3 · issue unarchive CORE-3 · issue restore CORE-3 · issue delete CORE-3 [--purge]
issue bulk CORE-3 CORE-4 -s Done -a Ada --add-labels Bug [--delete] [--archive]
issue move CORE-3 --before CORE-4
issue relate CORE-3 CORE-4 --type blocks · issue unrelate CORE-3 CORE-4
issue comments CORE-3 · issue comment CORE-3 "text" · comment edit <id> "text" · comment delete <id>

# projects
project create "Name" -d "desc" -l Jun -t CORE --start 2026-08-01 --target 2026-10-01 -p high
project list [--json] · project show "Name" [--json]    # progress, issues, updates, milestones
project update "Name" --status started --health atRisk -n "New" -l Ada -p low --target none --add-location api --remove-location web
project note "Name" "update body" --health onTrack · project delete "Name"
project milestone-add "Name" "Beta cut" --target 2026-09-30 · milestone-update "Name" "Beta cut" --status done · milestone-delete "Name" "Beta cut"

# discovery & workspace
team list · user list · user add "Codex" --agent · label list [-t CORE] · search "query"
label create "Bug" -t CORE -c "#eb5757" · label update … · label delete …
location list · location add ~/code/api [-n api] [-j "Project"] · location rename api backend · location remove backend
issue update CORE-3 --location api     # every task works in exactly one location ("none" clears); sub-issues inherit the parent's; a project's locations are only suggestions
agent config [--terminal Terminal|iTerm|Ghostty|Warp|kitty|Alacritty|WezTerm]   # where `issue open` sessions launch
export [--out file] · import <file>    # full workspace backup / restore (images included — they live in the database)
seed [--reset]
```

Regression suite for all of the above: `npm run test:cli` (builds, then exercises every command against throwaway databases — never touches your workspace).

### Against a hosted server

```bash
baseline login --server https://baseline.example.com   # approve in the browser; the key goes to ~/.baseline/config.json (0600)
baseline whoami                                         # who the CLI acts as, and where commands go
baseline logout                                         # revokes that key and forgets it
BASELINE_URL=https://… BASELINE_TOKEN=bl_api_… baseline issue list   # or a key from the environment
```

Where a command goes: `--db <path>` (a local database), else `BASELINE_DB`, else `BASELINE_URL` + `BASELINE_TOKEN`, else the login in `~/.baseline/config.json`, else `~/.baseline/baseline.db`. Setting both `BASELINE_DB` and `BASELINE_URL`, only one of `BASELINE_URL`/`BASELINE_TOKEN`, or an unusable config file is an error; a command never falls back from a server to a local file. The login key can read and write, never administer. On a server every write is yours: `--as`/`BASELINE_AS` naming someone else is refused, not rewritten.

So far `team list`, `user list`, `issue list|show|create|update|comment|handoff` and `search` work against a server; the other commands still need a local database and say so.

## Coding agents over MCP

Claude Code, Codex and pi keep their issues current through Baseline's MCP tools (`start_issue`, `post_progress`, `file_followup`, `finish_issue`, `draft_project_update`, `undo`, `get_issue`, `list_issues`). One command per repo:

```bash
baseline connect claude|codex|pi            # the agent starts `baseline mcp` (stdio), which uses the CLI's target
baseline connect claude|codex|pi --remote   # the agent calls https://<your server>/mcp with the key in $BASELINE_TOKEN
```

It writes the agent's project MCP config (`.mcp.json`, `.codex/config.toml` or `.pi/mcp.json`) and a block in `CLAUDE.md` / `AGENTS.md` that tells the agent to use the tools (and the `baseline agent` commands when MCP isn't available). Those files are usually committed, so connect never writes a machine path, a database path or a key into them: `baseline` must be on your PATH (`npm run build && npm install -g .` in this checkout), and `--remote` entries read the key from `$BASELINE_TOKEN` (set it, with `BASELINE_URL`, in the shell that starts the agent). The hosted `/mcp` endpoint accepts API keys only; each tool call runs with that key's permissions and teams, and publishing a project update stays a person's action in the web app. Writes show as "<agent> via <you>": the agent is recognized by the name its MCP client reports.

## Skill (AI coding tools)

`skills/baseline/SKILL.md` is an [Agent Skills](https://agentskills.io)-format skill that teaches Claude Code / OpenCode / ZCode to drive the tracker through this CLI. It ships with the repo; to install it user-wide, symlink the directory into your tools' skill folders:

```bash
ln -sfn ~/sideones/baseline/skills/baseline ~/.agents/skills/baseline   # cross-tool standard
ln -sfn ~/sideones/baseline/skills/baseline ~/.claude/skills/baseline   # Claude Code
```

Agents report back through the same CLI: comments, status flips and relations land under their own identity when the commands pass `--as "AgentName"` (agent identities are created in Settings ▸ Members or via `user add "Codex" --agent`).

## License

[Apache License 2.0](LICENSE). © 2026 Baseline contributors.

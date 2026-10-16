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

**Hosted mode (a team server).** Setting `GOOGLE_CLIENT_ID` switches the server to Google sign-in. That mode
also needs `GOOGLE_CLIENT_SECRET` and `BASELINE_PUBLIC_URL`; the server refuses to start with only some of them.

| Variable | Meaning |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | An OAuth client of type "Web application" in Google Cloud. Its authorised redirect URI is `<BASELINE_PUBLIC_URL>/auth/google/callback`. |
| `BASELINE_PUBLIC_URL` | The address people open, e.g. `https://baseline.example.com`. Requests addressed to any other host, and writes from any other origin, are refused. |
| `BASELINE_OWNER_EMAIL` | The first admin. Signing in with this Google account creates them, and always keeps them an admin. |
| `BASELINE_WORKSPACE_NAME` | Name of a new hosted workspace (default "Baseline"). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional email for invites. `SMTP_PORT` defaults to 587, and `SMTP_FROM` (e.g. `Baseline <baseline@acme.dev>`) is required once `SMTP_HOST` is set. GCP blocks outbound port 25, so use 587 or 465. Without SMTP, invites still work: copy the link from Settings › Members. |

How hosted mode differs:
- **A new hosted workspace starts empty**, with no sample data.
- **Who can sign in:**
  - the owner;
  - someone whose email matches an existing member who hasn't signed in yet, which covers imported data;
  - someone with an open invite, which lasts 7 days and is emailed or shared as a link;
  - a Google Workspace account at an approved domain (Settings › Security).

  Opening an invite with a different Google account says so instead of letting them in.
- **Settings › Members:** invite people as Members or Admins onto chosen teams; resend, copy or revoke invites; change roles and teams; suspend or reactivate people. The workspace always keeps at least one admin, and nobody can suspend themselves.
- **Settings › Security:** approved domains and the teams those people start on, and whether members may invite (only admins invite admins).
- **Sessions** last 30 days, renewed as long as you keep using them.
- **Admin-only:** roles, suspension, security settings, workspace settings, import and export.
- **Teams:** anyone can join or leave any team from the Teams page. "Your teams" in the sidebar lists the teams you're on.
- **Not available on a hosted server:** opening Claude Code and adding locations, which act on the machine they run on.

`npm run test:auth` covers sign-in, invites, domains and roles.

**Production data:** the work DB was wiped of all seed/demo data on 2026-08-29 — the workspace
starts empty (create your team in Settings) and only real work lives there now. The app auto-seeds
any database whose `meta` table is empty, so never point dev tools or experiments at
`~/.baseline/baseline.db`; deleting or resetting that file would resurrect the sample data.
Pre-wipe backups: `~/.baseline/backups/`.

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
export [--out file] · import <file>    # full workspace backup / restore
seed [--reset]
```

Regression suite for all of the above: `npm run test:cli` (builds, then exercises every command against throwaway databases — never touches your workspace).

## Skill (AI coding tools)

`skills/baseline/SKILL.md` is an [Agent Skills](https://agentskills.io)-format skill that teaches Claude Code / OpenCode / ZCode to drive the tracker through this CLI. It ships with the repo; to install it user-wide, symlink the directory into your tools' skill folders:

```bash
ln -sfn ~/sideones/baseline/skills/baseline ~/.agents/skills/baseline   # cross-tool standard
ln -sfn ~/sideones/baseline/skills/baseline ~/.claude/skills/baseline   # Claude Code
```

Agents report back through the same CLI: comments, status flips and relations land under their own identity when the commands pass `--as "AgentName"` (agent identities are created in Settings ▸ Members or via `user add "Codex" --agent`).

## License

[Apache License 2.0](LICENSE). © 2026 Baseline contributors.

---
name: baseline
description: Manage tasks and projects in the Baseline tracker via its CLI — create/update/list/search issues, change status, priority, assignees, labels, sub-issues, relations, comments; create projects, post progress updates and milestones; take hand-off briefs for coding agents (`issue handoff`); back up or restore the workspace. Use whenever the user mentions Baseline, their tracker, backlog, tasks, issues, or project status, asks to check off, move, triage, or break down work, or wants project state read or updated — even if they don't say "Baseline".
---

# Baseline CLI

Baseline is the user's local-first project tracker (Linear-style, one SQLite file). This skill drives it entirely through its CLI — reading project state, creating and updating tasks, and keeping progress current.

## Invocation

Examples below call a `baseline` shell function. Define it once per shell invocation (shell state does not persist between tool calls — or just inline the full path):

```bash
baseline() { node /Users/parthbatra/sideones/baseline/bin/baseline.js "$@"; }
baseline team list
# or directly:
node /Users/parthbatra/sideones/baseline/bin/baseline.js team list
```

Don't use a plain variable like `baseline="node /path…"` — invoking it as an unquoted `$baseline team list` breaks in zsh (no word splitting of unquoted variables), and neither variables nor functions survive across separate agent tool calls, so re-define the function each time or inline the full path.

If `dist/` is missing, build once first: `cd /Users/parthbatra/sideones/baseline && npx tsc -p tsconfig.node.json`.

## Before you write: know what you're touching

- The **default database is production** — the user's real workspace (`~/.baseline/baseline.db`, UI at `localhost:7770`). It was wiped of all demo/seed data on 2026-08-29 and starts empty; everything in it now is real work. Reads are always safe. Writes change their real tracker — that is normally the goal when doing real tracking.
- **Feature dev in `~/sideones/baseline` must never touch production.** The repo's npm scripts (`npm run cli`, `npm run dev:server`, `npm run seed`) are sandboxed to `~/.baseline/baseline-dev.db` (:7327) automatically. When invoking `node bin/baseline.js` directly for dev/testing, pass `--db` or `BASELINE_DB` explicitly.
- For experiments, rehearsals, or previews, point every command at a scratch database with `--db /tmp/scratch.db` (or the `BASELINE_DB` env var). Never mix the two in one workflow.
- **Destructive:** `import <file>` and `seed --reset` wipe the target database first — running them without an explicit scratch `--db` means production. `issue delete` is soft (undoable via `issue restore`); `--purge` is permanent.
- Errors print to stderr and exit 1 with the list of valid values (e.g. an unknown state lists the team's states). Treat exit 0 as success; don't retry blindly.

## Addressing things

- **Issues by key**: `CORE-3` (case-insensitive). Keys are `TEAM-NUMBER`.
- **Teams, projects, labels, users by name**: case-insensitive, substring match (`-j "Agent"` finds "Agent Handoff").
- Workflow states are **per team**. Defaults are Backlog / Todo / In Progress / Done / Canceled, but teams may define others — discover them with `baseline team list` before setting `-s`.
- Priorities: `none|urgent|high|medium|low` (or `0`–`4`).
- `"none"` clears a field: `--assignee none`, `--project none`, `--parent none`, `--estimate none`, `--due none`.

## Output modes

- Human-readable by default; count summary on stderr — good for grepping.
- Add `--json` to `issue list|show|create` and `project list|show` for machine-readable output. Prefer `--json` when you need to parse fields (keys, ids, dates, progress); never parse prose.
- `--help` works on every command.

## Command reference

```bash
# discover
baseline team list                          # teams, their states, issue counts
baseline user list                          # who can be assigned (agents marked `agent`)
baseline user add "Codex" --agent           # add a named agent identity
baseline label list [-t CORE]               # labels per team
baseline search "query"                     # issues + projects by substring

# read issues
baseline issue list [-t CORE] [-s Todo] [-a me] [-j Project] [-p high] [-L Bug] [-q text] [--archived] [--json] [--limit N]
baseline issue show CORE-3 [--json]         # description, sub-issues, relations, comments, activity
baseline issue handoff CORE-3 [--copy|--json]   # ready-to-paste agent prompt + suggested branch name
baseline issue open CORE-3 [--location <name>]  # human-facing: opens an interactive Claude Code session in a terminal window (macOS)

# create / update issues
baseline issue create "Title" -t CORE -s "In Progress" -p high -a "Ada Osei" \
  -l Bug,Perf -j "Agent Handoff" -d "Markdown description" \
  --parent CORE-1 --estimate 3 --due 2026-09-15 [--cycle current|next|22] [--milestone "Beta"] [--json]   # prints new key
baseline issue update CORE-3 -s Done -p urgent -a "Jun Watanabe" --title "New title" -d "New description"
baseline issue update CORE-3 --labels Bug,Perf             # replace the whole label set…
baseline issue update CORE-3 --add-labels Perf --remove-labels Bug   # …or delta-label
baseline issue update CORE-3 --cycle next --milestone "Beta"           # "none" clears either
baseline issue transfer CORE-3 AGO           # move to another team (new key printed)
baseline issue link CORE-3 https://github.com/org/repo/pull/12 --title "PR #12"   # attach a PR / doc / design
baseline issue subscribe CORE-3 / unsubscribe CORE-3   # follow an issue (notifications)
baseline issue remind CORE-3 2d              # inbox reminder later (2d, 3h, 2026-10-20, 2026-10-20T14:00)
baseline issue archive CORE-3 / unarchive / restore
baseline issue delete CORE-3 [--purge]

# bulk + ordering
baseline issue bulk CORE-3 CORE-4 CORE-5 -s Done -a "Ada Osei" --add-labels Bug [--archive] [--delete]
baseline issue move CORE-3 --before CORE-4   # or --after

# relations & comments
baseline issue relate CORE-3 CORE-4 --type blocks   # blocks|blocked_by|related|duplicate; inverse auto-stored
baseline issue unrelate CORE-3 CORE-4 [--type blocks]
baseline issue comment CORE-3 "text"         # prints the new comment id
baseline issue comment CORE-3 "text" --reply <commentId>   # answer inside that thread
baseline issue comments CORE-3                # list with comment ids
baseline comment resolve <commentId> [--undo] # close / reopen a thread
baseline comment edit <commentId> "new text" / comment delete <commentId>

# triage (issues filed into a team with triage on wait here for review)
baseline triage list [-t AGO]
baseline triage accept AGO-6 [-s Todo]        # into the team (default: its first Todo state)
baseline triage decline AGO-6                 # moves it to Canceled
baseline triage snooze AGO-6 2d               # out of the queue until then ("none" brings it back)

# recurring issues (file themselves on a cadence)
baseline recurring list [-t CORE]
baseline recurring add "Weekly dependency bump" -t CORE -c weekly [--start 2026-10-20]   # or --from CORE-12 to repeat an issue
baseline recurring remove <id>

# teams
baseline team update CORE --triage on --estimates fibonacci --auto-cycles on --cycle-weeks 2 --cooldown 0 --upcoming 2 --rollover on

# projects
baseline project create "Name" --summary "one line" -d "desc" -l "Jun Watanabe" -t CORE --start 2026-08-01 --target 2026-10-01 -p high
baseline project list [--json]
baseline project show "Name" [--json]         # status, health, progress %, issues, updates, milestones
baseline project update "Name" --status started --health atRisk -p low --target none --summary "…"   # backlog|planned|started|paused|completed|canceled, onTrack|atRisk|offTrack
baseline project link "Name" https://figma.com/file/… --title "Designs"   # project resources
baseline project depend "Mobile" "Design System"     # Mobile is blocked by Design System (--remove to drop)
baseline project templates                            # list project templates
baseline project create "Search v2" --template "Feature launch"   # fields + milestones + starter issues
baseline location list                           # directories agents work in (usually git repos), with the projects using them
baseline location add ~/code/api -n api -j "Name"  # register one (and link it to a project); a location can serve several projects
baseline project update "Name" --add-location api  # / --remove-location api
baseline issue update CORE-3 --location api      # where this task happens — exactly one per task ("none" clears)
baseline project note "Name" "Weekly update: shipped X, Y at risk" --health onTrack
baseline project milestone-add "Name" "Beta cut" --target 2026-09-30
baseline project milestone-update "Name" "Beta cut" --status inProgress   # planned|inProgress|done
baseline project milestone-delete "Name" "Beta cut"
baseline project delete "Name"                # issues are kept and detached

# project labels, statuses, update schedule
baseline project labels                       # groups end with "/" and list their labels
baseline project label-create "Infra" [--group] [--in "Area"] [-c "#3b82f6"]
baseline project statuses                     # named statuses by category
baseline project status-create started "In Review"
baseline project update "Name" --status "In Review" --label Infra --remove-label "Q4 bet" --updates weekly   # --updates none|weekly|biweekly|monthly|default

# initiatives & releases
baseline initiative list [--json]
baseline initiative create "Agent-first tracker" --status active --project "Agent Handoff" "Design System" [--parent "…"] [--target 2026-12-01]
baseline initiative update "Agent-first tracker" --status completed --add-project "Mobile" --remove-project "…"
baseline initiative update I-3 --priority high --label Growth "Q1 bet" --remove-label Docs --team CORE --updates weekly   # by name or I-12; labels are created if new
baseline initiative label list | create <name> [--color #hex] | delete <name>
baseline initiative note "Agent-first tracker" "On track for Q4" --health onTrack
baseline release list [--json]
baseline release create v1.5.0 [--target 2026-11-01] [-d "notes"]
baseline release update v1.5.0 --add CORE-3 CORE-7 --stage released   # planned|started|released|canceled

# SLAs, Asks, Loops
baseline sla list                               # rules + breached issues
baseline sla create "Urgent in 24h" --hours 24 -p urgent [-t CORE]
baseline ask list                               # forms and their field ids (* = required)
baseline ask submit "Bug report" f_title="Export crashes" f_sev=Blocking   # files into the team's triage
baseline loop list
baseline loop run "Bug acknowledgement" CORE-12  # run a loop now, optionally on an issue

# git / GitHub (Linear's linking rules: key in branch or PR title; Fixes/Closes … moves the issue)
baseline git sync                               # pull PRs (gh) and commits (git log) from your locations
baseline git prs CORE-12 [--json]               # PRs and commits linked to an issue
baseline git webhook [--rotate] [--url https://…] [--off]   # real-time GitHub webhooks (signed, inbound only)
baseline git import-issues owner/repo -t CORE [--follow]    # one-way import of open GitHub issues into a team
# the integration is read-only: Baseline never comments, labels or pushes on GitHub
# name branches with the issue key (Copy git branch, ⌘⇧.) and write "Fixes CORE-12" in the PR so it moves on merge

# customers (customer requests)
baseline customer list [--json]
baseline customer create "Acme" --domain acme.dev --revenue 240000 --size 120
baseline customer request "Acme" CORE-12 -b "what they said" [--important]   # or a project name instead of an issue key

# documents (specs, briefs, runbooks on a project or team — Markdown)
baseline doc list [--project "Name"] [--team CORE] [--json]
baseline doc show "Hand-off spec" [--json]    # by id or title
baseline doc create "API spec" --project "Name" --content "## Goals…"   # or --team CORE; --content - reads stdin
baseline doc update "API spec" --append "- new decision"   # --title / --content (replace) / --append; --as "Agent" notifies the doc's author
baseline doc delete "API spec"

# personal API keys for scripts calling the REST API (curl -H "Authorization: Bearer <key>" localhost:7770/api/bootstrap)
baseline api-key create "CI" [-s read createIssues] [-t CORE]   # prints the token once; no -s = full access
baseline api-key list [--all] [--json] / baseline api-key revoke "CI"

# labels & workspace backup
baseline label create "Flaky" -t CORE -c "#eb5757" -d "description" / label update / label delete
baseline export --out backup.json             # full workspace snapshot
baseline import backup.json                   # restore (WIPES target first)
```

## Recipes

**Get oriented** (do this first in an unfamiliar session):
```bash
baseline project list && baseline team list && baseline issue list -a me
```

**Read one task with full context:**
```bash
baseline issue show CORE-3 --json
```

**Triage work:** list, then update status/priority/assignee:
```bash
baseline issue list -t CORE -s "In Progress" --json
baseline issue update CORE-7 -s Done
```

**Break a task down:** create children, attach to the parent, link blockers:
```bash
baseline issue create "Add Zod schemas" -t CORE --parent CORE-3 --json
baseline issue relate CORE-4 CORE-3 --type blocks
```

**Update a project's state of the world:**
```bash
baseline project show "Agent Handoff" --json        # progress, issues, milestones
baseline project note "Agent Handoff" "CLI parity shipped; templates next" --health onTrack
```

**Rehearse risky changes** on a scratch copy, then apply for real:
```bash
baseline export --out /tmp/ws.json
BASELINE_DB=/tmp/scratch.db baseline import /tmp/ws.json
# …experiment freely with --db /tmp/scratch.db, then run the real commands
```

## Handoff loop (picking up an issue handed to you)

A human hands you an issue one of two ways: copies its brief into your prompt (web toolbar, or `baseline issue handoff KEY --copy`), or opens it with **Open in Claude Code** (a terminal session started in the issue's location, with `BASELINE_DB`/`BASELINE_AS` already set, so your CLI writes post as "Claude Code"). Nothing is ever picked up automatically — assigning an issue to an agent user is just a label. The brief names the issue key and a suggested branch. Your side of the loop:

```bash
baseline issue show CORE-3 --json          # full context: description, comments, blockers
git checkout -b core-3-short-token-audit   # branch from the brief ("Branch:" line); main as base
baseline issue update CORE-3 -s "In Progress"   # claim it so the human sees it's picked up
# …do the work, committing in small steps…
baseline issue comment CORE-3 "Shipped X; Y still open because Z"   # progress note
baseline issue update CORE-3 -s Done       # only when truly finished; otherwise leave the state and say what remains
```

- Report back even on partial work — the comment is the deliverable the human reads. Shape it to the work:
  - **Code:** branch, commit or PR link, files changed, how you verified it (tests/commands run).
  - **Docs / write-ups:** absolute path of each file you created (or the artifact link) plus a 2–3 line summary.
  - **Bug / investigation:** root cause, evidence (`file:line`, log lines), then the fix or next step.
  - **Research / decision:** the recommendation, options weighed, links to sources.
  - Absolute paths for local files; backticks around paths, branches and commands; keep it short.
- If the work splits into separate pieces, create sub-issues (`issue create "…" -t CORE --parent KEY`) instead of one long comment.
- Attribute your writes to your agent identity: add `--as "Codex"` to write commands (`issue create|update|bulk|archive|relate|comment`, `project note`) so activity, comments and notifications land under that user instead of the human's. Agent identities are marked `agent` in `user list`.
- `BASELINE_AS=<name or user id>` does the same for every command without the flag (an explicit `--as` still wins) — export it once per agent session.
- Locations: every task works in exactly one **location** (a registered directory, usually a git repo). There is no default directory — an issue without a location is never run anywhere by guess. Sub-issues start in their parent's location; nothing else is defaulted — a project's linked locations are only suggestions in the picker, so every other issue needs one chosen (the UI shows "Needs a location"). Set one with `issue update KEY --location <name>`.
- Where sessions open: `baseline agent config --terminal Terminal|iTerm|Ghostty|Warp|kitty|Alacritty|WezTerm`. Session briefs live in `~/.baseline/sessions/` (owner-only, pruned after a week).
- Template overrides live in the web app under Settings ▸ Coding tools; `issue handoff --json` always reflects the current template.

## Conventions the store enforces (why your updates look the way they do)

- Completing an issue (moving to a done-type state) sets `completedAt`; canceling sets `canceledAt`. Project progress % counts completed + canceled issues over total.
- Every mutation writes an activity entry. Notifications follow subscriptions: creating, being assigned, commenting or being @mentioned subscribes a user, and the human's inbox gets status changes, comments, replies and mentions on issues they follow — so your status moves and comments reach them. `issue show --json` exposes the activity trail, comment threads (`replyTo`), subscribers and links — read it to catch up on an issue's history.
- Triage: when a team has triage on, issues you create there (as an agent, via `--as` or `BASELINE_AS`) land in its Triage state for the human to accept. Pass `-s Todo` to skip triage only when you were asked to.
- Cycles with automation on are created and closed by the app; unfinished issues roll into the next cycle. Use `--cycle current|next` instead of guessing numbers.
- `@Full Name` in a comment or description mentions that member (and notifies them); an issue key like `CORE-12` renders as a link to it.
- Blocked relations store both directions, so `issue show` on either issue displays them.
- Verify your changes: after a write, re-read with `--json` rather than trusting the confirmation line alone.

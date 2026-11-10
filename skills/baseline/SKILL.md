---
name: baseline
description: Manage tasks and projects in the Baseline tracker via its CLI — create/update/list/search issues, change status, priority, assignees, labels, sub-issues, relations, comments; create projects, post progress updates and milestones; take hand-off briefs for coding agents (`issue handoff`); back up or restore the workspace. Use whenever the user mentions Baseline, their tracker, backlog, tasks, issues, or project status, asks to check off, move, triage, or break down work, or wants project state read or updated — even if they don't say "Baseline".
---

# Baseline CLI

Baseline is the team's issue and project tracker (Linear-style; a hosted server, or one SQLite file on a laptop). This skill drives it through its CLI — reading project state, creating and updating tasks, and keeping progress current.

## Invocation

The examples call `baseline`, the CLI on your PATH. Setup is three steps, once per person and once per repo:

```bash
npm install -g <the Baseline package>             # puts `baseline` on PATH
baseline login --server https://baseline.example.com   # browser sign-in; stores a key in ~/.baseline/config.json
baseline connect claude --team ENG                # in each repo, once; commit the files it writes
baseline doctor                                   # checks all of it
```

If `baseline` is not on PATH, say so and stop: don't guess a path to a checkout. When working on Baseline's own source, run it from the checkout as `node bin/baseline.js` with an explicit `--db` / `BASELINE_DB` scratch database.

## A hosted (team) server

The same commands work against a shared Baseline server instead of a local file:

```bash
baseline login --server https://baseline.example.com   # browser sign-in; stores a personal key in ~/.baseline/config.json
baseline whoami                                          # who the CLI acts as, and where commands go
baseline logout                                          # revokes that key
```

Or set `BASELINE_URL` + `BASELINE_TOKEN` (a personal API key) for one shell; setting `BASELINE_DB` or `--db` instead targets a local file (both at once is an error). Commands not yet ported say so and exit 1.

**Your agent identity:** `baseline agent …` commands and MCP tools write as your coding tool on the person's behalf: "Claude Code via <the signed-in person>" (detected), or the tool `--as` / `BASELINE_AS` names (`Codex`, `Cursor`, `pi`; its agent user is made on first use), else the workspace's "Agent". Other commands write as the person. A server refuses `--as` / `BASELINE_AS` naming another person.

**Not connected:** with no login and no `--db` / `BASELINE_DB` naming an existing database, `baseline agent …`, `baseline mcp`, `work`, `next` and `standup` refuse with "Not connected to Baseline. Run `baseline login --server <url>`". They never create or seed a database. Relay that to the person.

## Before you write: know what you're touching

- The tracker you are connected to is the team's real one. Reads are always safe; writes change real work, which is normally the goal.
- For experiments, rehearsals, or previews, point every command at a scratch database with `--db /tmp/scratch.db` (or the `BASELINE_DB` env var). Never mix the two in one workflow.
- **Destructive:** `import <file>` and `seed --reset` wipe the target database first, so only ever run them with an explicit scratch `--db`. `issue delete` is soft (undoable via `issue restore`); `--purge` is permanent.
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
baseline user add "<name>" --agent          # add another agent identity
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

# initiatives
baseline initiative list [--json]
baseline initiative create "Agent-first tracker" --status active --project "Agent Handoff" "Design System" [--parent "…"] [--target 2026-12-01]
baseline initiative update "Agent-first tracker" --status completed --add-project "Mobile" --remove-project "…"
baseline initiative update I-3 --priority high --label Growth "Q1 bet" --remove-label Docs --team CORE --updates weekly   # by name or I-12; labels are created if new
baseline initiative label list | create <name> [--color #hex] | delete <name>
baseline initiative note "Agent-first tracker" "On track for Q4" --health onTrack

# SLAs, Loops
baseline sla list                               # rules + breached issues
baseline sla create "Urgent in 24h" --hours 24 -p urgent [-t CORE]
baseline loop list
baseline loop run "Bug acknowledgement" CORE-12  # run a loop now, optionally on an issue

# git / GitHub (Linear's linking rules: key in branch or PR title; Fixes/Closes … moves the issue)
baseline git sync                               # pull PRs (gh) and commits (git log) from your locations
baseline git prs CORE-12 [--json]               # PRs and commits linked to an issue
baseline git webhook [--rotate] [--url https://…] [--off]   # real-time GitHub webhooks (signed, inbound only)
baseline git import-issues owner/repo -t CORE [--follow]    # one-way import of open GitHub issues into a team
# the integration is read-only: Baseline never comments, labels or pushes on GitHub
# name branches with the issue key (Copy git branch, ⌘⇧.) and write "Fixes CORE-12" in the PR so it moves on merge

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

The person names an issue ("let's do CORE-3"), runs `baseline work CORE-3` (which starts it, checks out its branch and opens Claude Code), pastes its brief (web toolbar, or `baseline issue handoff KEY --copy`), or asks for work with no key. Nothing is ever picked up automatically. Your side of the loop (the MCP tools of the same names come first; these are the CLI forms):

```bash
baseline agent next-issue                  # "what should I work on?"
baseline agent find-issues "login redirect"   # a request with no key: search the whole team, then ask once whether to track it there
baseline agent propose-issue "Fix login redirect after SSO" --team CORE   # no match: a draft only; show it and ask
baseline agent create-issue --draft-id dr_… --start   # only after the person says yes
baseline agent start-issue CORE-3          # In Progress, assigned to the person if nobody is; checks out the branch (or prints the git command)
baseline agent create-sub-issues CORE-3 --titles "Parser" "Tests"   # split a started issue; no need to ask
baseline agent post-progress CORE-3 --did "Reproduced in Safari" --left "Fix + test"   # one note per issue, rewritten in place
baseline agent propose-followup CORE-3 "Session cookie lacks SameSite" --description "src/auth.ts:88"   # a note, asked about at finish
baseline agent finish-issue CORE-3 --outcome in_review --summary "…" --pr-url https://github.com/o/r/pull/12   # lists the follow-up notes: ask once, create-issue the approved ones
baseline agent my-activity --since yesterday   # standup lines
```

Each command is described in **Agent loop** below. Prefer them to `issue update` / `issue comment` for your own work: they converge on retries, keep one progress note instead of a pile of comments, and return an `op_id` the person can ask you to undo.

- Report back even on partial work — the comment is the deliverable the human reads. Shape it to the work:
  - **Code:** branch, commit or PR link, files changed, how you verified it (tests/commands run).
  - **Docs / write-ups:** absolute path of each file you created (or the artifact link) plus a 2–3 line summary.
  - **Bug / investigation:** root cause, evidence (`file:line`, log lines), then the fix or next step.
  - **Research / decision:** the recommendation, options weighed, links to sources.
  - Absolute paths for local files; backticks around paths, branches and commands; keep it short.
- If the work splits into separate pieces, `create_sub_issues` instead of one long comment.
- Attribute other writes to your agent identity: add `--as "Claude Code"` (or your tool's name) to write commands (`issue create|update|bulk|archive|relate|comment`, `project note`) so activity, comments and notifications land under that user, recorded as "Claude Code via <the human>". Agent identities are marked `agent` in `user list`.
- `BASELINE_AS=<name or user id>` does the same for every command without the flag (an explicit `--as` still wins) — export it once per agent session.
- Locations: every task works in exactly one **location** (a registered directory, usually a git repo). There is no default directory — an issue without a location is never run anywhere by guess. Sub-issues start in their parent's location; nothing else is defaulted — a project's linked locations are only suggestions in the picker, so every other issue needs one chosen (the UI shows "Needs a location"). Set one with `issue update KEY --location <name>`.
- Where sessions open: `baseline agent config --terminal Terminal|iTerm|Ghostty|Warp|kitty|Alacritty|WezTerm`. Session briefs live in `~/.baseline/sessions/` (owner-only, pruned after a week).
- Template overrides live in the web app under Settings ▸ Coding tools; `issue handoff --json` always reflects the current template.

## Agents beside the terminal UI

The person may be browsing Baseline in its terminal UI (bare `baseline` in a terminal) in a neighbouring pane. To resolve "this issue", "the one I'm on" or "the top three" without asking for keys:

```bash
baseline context          # what the TUI in this directory shows: the open issue, and the list with "← cursor" on the selected row
baseline context --json   # the same as data: route, openIssue {key,title}, list {title, groupBy, preset, rows[], cursorKey}, open (is that TUI still running)
```

"This issue" is the open issue, else the row marked `← cursor`; "the top three" are rows 1-3 of the list as shown. It reads the TUI's own state file (`~/.baseline/tui/`), so it works while the TUI is open or after it closed (the output says which); with no TUI run yet it exits 1. Then act with the usual commands (`issue show KEY`, `agent start-issue KEY`, …).

<!-- agent-loop:start — generated from src/ops/index.ts by `npm run gen:skill`; edit the operations, not this block -->
## Agent loop (your work on an issue, as your agent identity)

Each command is one agent operation; an MCP client gets the same operations as tools, with the same descriptions, input and `--json` output. Every write shows as "<tool> via <person>": Claude Code (detected), or the tool `--as` / `BASELINE_AS` names (`Codex`, `Cursor`, `pi`; its agent user is made on first use), else the workspace's Agent. Set `BASELINE_SESSION` only to keep two parallel sessions on one issue apart. Every write prints an `op_id` (or null when nothing changed); repeating a call is safe. Without a login (`baseline login --server <url>`) or a `--db` / `BASELINE_DB` naming an existing database, every command refuses: it never makes a database.

### `next_issue` (read)

```bash
baseline agent next-issue [--team <text>] [--limit <n>] [--json]
```

Answer "what should I work on?": up to 3 unblocked issues for the person you work for. First their issues in progress, then their Todo issues by priority, then unassigned issues in the current cycle of their teams. Suggest the first one and ask; call start_issue when they pick.

### `find_issues` (read)

```bash
baseline agent find-issues <query> [--team <text>] [--state <open|all>] [--limit <n>] [--json]
```

Search the team's issues for work the person asks about, before you create anything. Searches everyone's issues (not only the person's), ranks them by how many of the query's words are in the title or description, and says what it searched. On a match, ask once whether to track the work on it; with no match, use propose_issue.

### `get_issue` (read)

```bash
baseline agent get-issue <issue> [--json]
```

Get one Baseline issue by key: description, state, assignee, comments, sub-issues, blockers, links, and the progress that agents posted. Call this before you work on an issue that you did not start in this conversation.

### `list_issues` (read)

```bash
baseline agent list-issues [--query <text>] [--assignee <text>] [--state <text>] [--team <text>] [--project <text>] [--limit <n>] [--json]
```

List Baseline issues, most recently updated first. With no filters it lists the open issues assigned to you (the person the agent works for). With query, it searches everyone's issues unless you pass assignee; to find work by its words, find_issues ranks the matches. Use assignee "any" to list everyone's issues. Names match without case; an unknown name returns the valid names.

### `my_activity` (read)

```bash
baseline agent my-activity [--since <text>] [--json]
```

What the person (and agents working for them) did since a time: issues started, progressed, finished and filed, and their pull requests, as a few lines ready to paste into a standup. Use it for "what did I do since yesterday?".

### `propose_issue` (write)

```bash
baseline agent propose-issue <title> [--description <text>] [--team <text>] [--priority <none|urgent|high|medium|low>] [--json]
```

Draft a new issue for work the person asked for that matches no open issue (check with find_issues first). Nothing is created and the team sees nothing: it returns the draft for you to show the person. Ask once, for example: Create WEB issue "Fix login redirect after SSO", assigned to you? (yes / edit / don't track). Call create_issue with the draft_id only after they say yes. The same title again returns the same draft.

### `create_issue` (write)

```bash
baseline agent create-issue [--draft-id <text>] [--title <text>] [--description <text>] [--team <text>] [--priority <none|urgent|high|medium|low>] [--project <text>] [--start] [--json]
```

Create an issue the person said yes to in this conversation. Never call it without that yes. Pass the draft_id from propose_issue (or a follow-up from finish_issue) to create exactly what they approved, or title and team for an issue they dictated. A new issue is assigned to them; start: true also starts it and checks out its branch, like start_issue. An approved follow-up goes to the team's Triage (Backlog when triage is off). The same draft again returns the same issue.

### `start_issue` (write)

```bash
baseline agent start-issue <issue> [--take-over] [--json]
```

Tell Baseline that you start work on an issue now, and get on its git branch. If the issue is not started (Triage, Backlog or Todo), it moves to the team's first started state, usually In Progress. If nobody is assigned, it is assigned to the person you work for. If it is another person's, nothing changes and you are told whose it is: ask the person whether to take it over, then call again with take_over. The branch is checked out (or created from the default branch) in the repo you run in when that is safe; otherwise you get the exact git command. The first call returns the work brief; a repeat returns a short status and your last progress. Call this once, before you change code for the issue.

### `create_sub_issues` (write)

```bash
baseline agent create-sub-issues <issue> --titles <text...> [--json]
```

Split the issue you are working on into sub-issues, one per title, without asking the person first. The issue must be started (start_issue). Each sub-issue gets the issue's assignee and project and starts in Todo. A title the issue already has as a sub-issue is skipped. Use it when the plan has separable parts; keep steps of one change in post_progress instead.

### `post_progress` (write)

```bash
baseline agent post-progress <issue> [--did <text>] [--left <text>] [--blocked <text>] [--links <url...>] [--pr-url <url>] [--json]
```

Update your progress note on an issue. You have one progress note per issue: the first call creates it as a comment, and later calls rewrite it in place, so post after each meaningful step without making noise. A field you leave out keeps its last value; an empty string clears it. Put PR, commit or doc URLs in links or pr_url; each URL is attached to the issue once. Calling again with the same text changes nothing.

### `propose_followup` (write)

```bash
baseline agent propose-followup <from_issue> <title> [--description <text>] [--team <text>] [--json]
```

Note new work that you found while you work on an issue, but that is not part of it. Nothing is filed and nobody is interrupted: the note waits, and finish_issue lists your notes so you ask the person once whether to file them. Do not use this for steps of your current task; put those in post_progress. Noting the same title from the same issue again returns the first note.

### `finish_issue` (write)

```bash
baseline agent finish-issue <issue> --outcome <in_review|done|stopped> --summary <text> [--left <text>] [--links <url...>] [--pr-url <url>] [--json]
```

Close out your work on an issue. Your progress note becomes the final summary. outcome "in_review": a pull request or another review waits for a person; the issue moves to In Review when the team has that state. outcome "done": the work is complete and needs no review; the issue moves to Done. outcome "stopped": you stop before the work is complete; the state does not change, and left must say what remains. It returns the follow-ups you noted on the issue: ask the person once whether to file them, and call create_issue with the draft_id of each one they approve. Calling again with the same outcome and summary changes nothing.

### `draft_project_update` (write)

```bash
baseline agent draft-project-update <project> [--body <text>] [--health <onTrack|atRisk|offTrack>] [--json]
```

Draft a status update for a project. Baseline collects what changed since the last published update (issues completed, in review, in progress, blocked, new) and returns those facts with the draft. Pass body to use your own words, and health if you can judge it. The draft is not published: only the person you work for sees it, and they publish, edit or discard it in Baseline. Tell them it is ready. Calling again replaces the draft.

### `undo` (revert)

```bash
baseline agent undo <op_id> [--json]
```

Reverse one change that you made in Baseline, by the op_id that the change returned. It reverts the state, the assignee, a created issue or sub-issues, a draft, attached links and the progress note of that change. If a person changed the same issue field since, nothing is undone and the error says what changed. Use this only when the person asks you to undo, or when you made a change in error. Calling again changes nothing.

<!-- agent-loop:end -->

## Conventions the store enforces (why your updates look the way they do)

- Completing an issue (moving to a done-type state) sets `completedAt`; canceling sets `canceledAt`. Project progress % counts completed + canceled issues over total.
- Every mutation writes an activity entry. Notifications follow subscriptions: creating, being assigned, commenting or being @mentioned subscribes a user, and the human's inbox gets status changes, comments, replies and mentions on issues they follow — so your status moves and comments reach them. `issue show --json` exposes the activity trail, comment threads (`replyTo`), subscribers and links — read it to catch up on an issue's history.
- Triage: when a team has triage on, issues you create there (as an agent, via `--as` or `BASELINE_AS`) land in its Triage state for the human to accept. Pass `-s Todo` to skip triage only when you were asked to.
- Cycles with automation on are created and closed by the app; unfinished issues roll into the next cycle. Use `--cycle current|next` instead of guessing numbers.
- `@Full Name` in a comment or description mentions that member (and notifies them); an issue key like `CORE-12` renders as a link to it.
- Blocked relations store both directions, so `issue show` on either issue displays them.
- Verify your changes: after a write, re-read with `--json` rather than trusting the confirmation line alone.

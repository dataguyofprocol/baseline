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

- The **default database is the user's live workspace** (`~/.baseline/baseline.db`). Reads are always safe. Writes change their real tracker — that is normally the goal.
- For experiments, rehearsals, or previews, point every command at a scratch database with `--db /tmp/scratch.db` (or the `BASELINE_DB` env var). Never mix the two in one workflow.
- **Destructive:** `import <file>` and `seed --reset` wipe the target database first. `issue delete` is soft (undoable via `issue restore`); `--purge` is permanent.
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

# create / update issues
baseline issue create "Title" -t CORE -s "In Progress" -p high -a "Ada Osei" \
  -l Bug,Perf -j "Agent Handoff" -d "Markdown description" \
  --parent CORE-1 --estimate 3 --due 2026-09-15 [--json]   # prints new key
baseline issue update CORE-3 -s Done -p urgent -a "Jun Watanabe" --title "New title" -d "New description"
baseline issue update CORE-3 --labels Bug,Perf             # replace the whole label set…
baseline issue update CORE-3 --add-labels Perf --remove-labels Bug   # …or delta-label
baseline issue archive CORE-3 / unarchive / restore
baseline issue delete CORE-3 [--purge]

# bulk + ordering
baseline issue bulk CORE-3 CORE-4 CORE-5 -s Done -a "Ada Osei" --add-labels Bug [--archive] [--delete]
baseline issue move CORE-3 --before CORE-4   # or --after

# relations & comments
baseline issue relate CORE-3 CORE-4 --type blocks   # blocks|blocked_by|related|duplicate; inverse auto-stored
baseline issue unrelate CORE-3 CORE-4 [--type blocks]
baseline issue comment CORE-3 "text"
baseline issue comments CORE-3                # list with comment ids
baseline comment edit <commentId> "new text" / comment delete <commentId>

# projects
baseline project create "Name" -d "desc" -l "Jun Watanabe" -t CORE --start 2026-08-01 --target 2026-10-01 -p high
baseline project list [--json]
baseline project show "Name" [--json]         # status, health, progress %, issues, updates, milestones
baseline project update "Name" --status started --health atRisk -p low --target none   # planned|started|completed|paused, onTrack|atRisk|offTrack
baseline project note "Name" "Weekly update: shipped X, Y at risk" --health onTrack
baseline project milestone-add "Name" "Beta cut" --target 2026-09-30
baseline project milestone-update "Name" "Beta cut" --status inProgress   # planned|inProgress|done
baseline project milestone-delete "Name" "Beta cut"
baseline project delete "Name"                # issues are kept and detached

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
baseline project note "Agent Handoff" "CLI parity shipped; MCP next" --health onTrack
```

**Rehearse risky changes** on a scratch copy, then apply for real:
```bash
baseline export --out /tmp/ws.json
BASELINE_DB=/tmp/scratch.db baseline import /tmp/ws.json
# …experiment freely with --db /tmp/scratch.db, then run the real commands
```

## Handoff loop (picking up an issue handed to you)

A human picks an issue, copies its brief (web button, or `baseline issue handoff KEY --copy`), and pastes it into your prompt. The brief names the issue key and a suggested branch. Your side of the loop:

```bash
baseline issue show CORE-3 --json          # full context: description, comments, blockers
git checkout -b core-3-short-token-audit   # branch from the brief ("Branch:" line); main as base
baseline issue update CORE-3 -s "In Progress"   # claim it so the human sees it's picked up
# …do the work, committing in small steps…
baseline issue comment CORE-3 "Shipped X; Y still open because Z"   # progress note
baseline issue update CORE-3 -s Done       # only when truly finished; otherwise leave the state and say what remains
```

- Report back even on partial work — the comment is the deliverable the human reads.
- MCP writes are attributed for you: the MCP server stamps comments/status changes on the agent identity configured at launch (`baseline mcp --agent "Codex"`, or `BASELINE_AGENT` env; default is the workspace's "Agent" user). CLI writes attribute to the current user, so if you work via CLI and want agent attribution, assign the issue to the agent user instead.
- Template overrides live in the web app under Settings ▸ Handoff; `issue handoff --json` always reflects the current template.

## Conventions the store enforces (why your updates look the way they do)

- Completing an issue (moving to a done-type state) sets `completedAt`; canceling sets `canceledAt`. Project progress % counts completed + canceled issues over total.
- Every mutation writes an activity entry; comments notify the assignee. `issue show --json` exposes the activity trail — read it to catch up on an issue's history.
- Blocked relations store both directions, so `issue show` on either issue displays them.
- Verify your changes: after a write, re-read with `--json` rather than trusting the confirmation line alone.

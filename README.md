# Baseline

Local-first issue & project tracker in the Linear style — one SQLite file, drivable three ways: **web UI**, **CLI**, and **MCP** (for coding agents).

## Start the service

```bash
cd ~/sideones/baseline
npm run build     # first time only
npm run serve     # → http://localhost:7327
```

Dev mode with hot reload: `npm run dev` (web on :5183, API on :7327).

Data lives in `~/.baseline/baseline.db` (override with `BASELINE_DB=<path>`). The workspace seeds sample data on first run.

## What's inside

Issues with statuses, priorities, labels, sub-issues, relations, due dates, estimates and cycles · list & board views with grouping/sub-grouping/filters/display options · projects with updates, milestones and progress · inbox notifications · saved views & favorites · full keyboard model (press `?`) with undo toasts · command palette (⌘K) · dark & light themes · team settings with workflow-state and label editors. See `FEATURES.md` for the complete list.

## CLI

Every project & task operation is drivable from the CLI — `node bin/baseline.js`, `npm run cli`, or `baseline` when linked. Issues are addressed by key (`CORE-3`); teams, projects, labels and users by name. Every command accepts `--db <path>` (or `BASELINE_DB` env), so agents can work on scratch databases. Run `baseline <command> --help` for all flags.

```bash
# tasks
issue create "Title" -t CORE -s "In Progress" -p high -a Ada -l Bug -j "Project" --parent CORE-1 --estimate 3 --due 2026-09-15 [--json]
issue list -t CORE -s Todo -a me -j Project -p high -L Bug -q text [--archived] [--json]
issue show CORE-3 [--json]     # description, sub-issues, relations, comments, activity
issue update CORE-3 -s Done -p urgent -a Jun --title "New" -d "md" --labels Bug,Perf --parent none --estimate none --due none --project none
issue archive CORE-3 · issue unarchive CORE-3 · issue restore CORE-3 · issue delete CORE-3 [--purge]
issue bulk CORE-3 CORE-4 -s Done -a Ada --add-labels Bug [--delete] [--archive]
issue move CORE-3 --before CORE-4
issue relate CORE-3 CORE-4 --type blocks · issue unrelate CORE-3 CORE-4
issue comments CORE-3 · issue comment CORE-3 "text" · comment edit <id> "text" · comment delete <id>

# projects
project create "Name" -d "desc" -l Jun -t CORE --start 2026-08-01 --target 2026-10-01 -p high
project list [--json] · project show "Name" [--json]    # progress, issues, updates, milestones
project update "Name" --status started --health atRisk -n "New" -l Ada -p low --target none
project note "Name" "update body" --health onTrack · project delete "Name"

# discovery & workspace
team list · user list · label list [-t CORE] · search "query"
label create "Bug" -t CORE -c "#eb5757" · label update … · label delete …
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

## MCP (agents)

```json
{ "mcp": { "servers": { "baseline": {
  "command": "node",
  "args": ["/Users/parthbatra/sideones/baseline/dist/mcp/index.js"]
} } } }
```

Already registered in `~/.zcode/cli/config.json`. 14 tools; issues are addressed by key (e.g. `CORE-3`). See `FEATURES.md` / `DESIGN.md` for the full spec.

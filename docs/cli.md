# CLI reference

[← README](../README.md)

Every project & task operation is drivable from the CLI: `node bin/baseline.js`, `npm run cli`, or `baseline` when linked. Issues are addressed by key (`CORE-3`); teams, projects, labels and users by name. Every command accepts `--db <path>` (or `BASELINE_DB` env), so agents can work on scratch databases. Run `baseline <command> --help` for all flags.

The examples below show command syntax, not a script. Prefix commands with `baseline`; brackets
mark optional flags, and `·` separates alternatives.

## Issues

`show` includes description, sub-issues, relations, comments and activity. `handoff` returns an
agent prompt and suggested branch name. `open` launches an interactive Claude Code session in a
new terminal window on macOS, using the issue location.

```text
issue create "Title" -t CORE -s "In Progress" -p high -a Ada -l Bug -j "Project" --parent CORE-1 --estimate 3 --due 2026-09-15 [--json]
issue list -t CORE -s Todo -a me -j Project -p high -L Bug -q text [--archived] [--json]
issue show CORE-3 [--json]
issue handoff CORE-3 [--copy|--json]
issue open CORE-3 [--location <name|path>]
issue update CORE-3 -s Done -p urgent -a Jun --title "New" -d "md" --labels Bug,Perf --parent none --estimate none --due none --project none
issue archive CORE-3 · issue unarchive CORE-3 · issue restore CORE-3 · issue delete CORE-3 [--purge]
issue bulk CORE-3 CORE-4 -s Done -a Ada --add-labels Bug [--delete] [--archive]
issue move CORE-3 --before CORE-4
issue relate CORE-3 CORE-4 --type blocks · issue unrelate CORE-3 CORE-4
issue comments CORE-3 · issue comment CORE-3 "text" · comment edit <id> "text" · comment delete <id>

```

## Projects

`show` includes progress, issues, updates and milestones.

```text
project create "Name" -d "desc" -l Jun -t CORE --start 2026-08-01 --target 2026-10-01 -p high
project list [--json] · project show "Name" [--json]
project update "Name" --status started --health atRisk -n "New" -l Ada -p low --target none --add-location api --remove-location web
project note "Name" "update body" --health onTrack · project delete "Name"
project milestone-add "Name" "Beta cut" --target 2026-09-30 · milestone-update "Name" "Beta cut" --status done · milestone-delete "Name" "Beta cut"

```

## Discovery and workspace

Each issue has one location; `none` clears it. Sub-issues inherit their parent's location, and
project locations are suggestions only. `agent config` selects the terminal used by `issue open`.
Import/export covers the full workspace, including images stored in the database.

```text
team list · user list · user add "<name>" --agent · label list [-t CORE] · search "query"
label create "Bug" -t CORE -c "#eb5757" · label update … · label delete …
location list · location add ~/code/api [-n api] [-j "Project"] · location rename api backend · location remove backend
issue update CORE-3 --location api
agent config [--terminal Terminal|iTerm|Ghostty|Warp|kitty|Alacritty|WezTerm]
export [--out file] · import <file>
seed [--reset]
```

Regression suite for all of the above: `npm run test:cli` (builds, then exercises every command against throwaway databases, so it never touches your workspace).

## Against a hosted server

Approve login in the browser. Its key is stored in `~/.baseline/config.json` with permissions
`0600`. `whoami` reports identity and destination; `logout` revokes and forgets the key.
Alternatively, supply the server and API key through environment variables.

```bash
baseline login --server https://baseline.example.com
baseline whoami
baseline logout
BASELINE_URL=https://… BASELINE_TOKEN=bl_api_… baseline issue list
```

Where a command goes: `--db <path>` (a local database), else `BASELINE_DB`, else `BASELINE_URL` + `BASELINE_TOKEN`, else the login in `~/.baseline/config.json`, else `~/.baseline/baseline.db`. Setting both `BASELINE_DB` and `BASELINE_URL`, only one of `BASELINE_URL`/`BASELINE_TOKEN`, or an unusable config file is an error; a command never falls back from a server to a local file. The login key can read and write, never administer. On a server every write is yours: `--as`/`BASELINE_AS` naming someone else is refused, not rewritten.

So far `team list`, `user list`, `issue list|show|create|update|comment|handoff` and `search` work against a server; the other commands still need a local database and say so.


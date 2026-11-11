# Connect a coding agent

[← README](../README.md)

## Claude Code

```bash
npm run build
npm install -g .
```

The package is not published to npm yet. Run the commands above in the Baseline checkout.
Then, from the repo where you want the agent to work:

```bash
baseline login --server https://baseline.example.com
baseline connect claude --team ENG
baseline doctor
```

Replace the server address and `ENG` with your server and team key. Commit the files that
`connect` writes; each teammate installs the CLI and signs in separately.

## Use a local database

If you already have a local workspace, you can connect without a hosted server. Set its database
path explicitly before running `connect` and before launching your agent, so the MCP subprocess
uses the same database:

```bash
export BASELINE_DB=/absolute/path/to/your/existing/baseline.db
baseline connect claude --team ENG
claude
```

Use an existing workspace, not a new path: agent commands do not create databases. Database paths
are machine-specific and are not written to shared repo config.

## What connect installs

`connect claude` writes plain files, merged into what is there: `.mcp.json` (the `baseline mcp` server), `.claude/settings.json` (the Baseline hooks, plus an allow-list for the reads and the reversible writes `start_issue`, `post_progress`, `create_sub_issues`, `propose_issue` and `propose_followup`), `.baseline.json` (the repo's team) and a five-line block in `CLAUDE.md`. Nothing machine-specific or secret goes in them. `baseline connect codex|pi` writes the same server and an `AGENTS.md` block for those tools.

What the agent then does on its own:
- **Hooks.** `baseline hook session-start` tells Claude which issue the branch is on and what else is yours; `baseline hook prompt` adds a one-line "track this?" nudge when no issue is active (turn it off with `"promptHook": false` in `.baseline.json`); `baseline hook stop` asks for a progress note when there are commits newer than the last one, once.
- **Tools.** `next_issue` ("what should I work on?"), `find_issues` (searches the whole team), `get_issue`, `list_issues`, `my_activity` (standup), `propose_issue` then `create_issue` (an issue is created only after you say yes), `start_issue` (checks out the branch), `create_sub_issues`, `post_progress`, `propose_followup` (asked about once, at finish), `finish_issue`, `draft_project_update` (never published by the agent) and `undo`. Each write returns an `op_id` that `undo` reverses.
- **Attribution.** Writes show as "Claude Code via <you>" (or Codex, Cursor, pi): each tool gets its own agent user the first time it writes.

Without a login (or a `--db` / `BASELINE_DB` naming an existing local database), `baseline mcp`, `baseline agent …`, `work`, `next` and `standup` refuse with "Not connected to Baseline. Run `baseline login --server <url>`"; they never create a database.

In a plain terminal: `baseline work ENG-15` starts the issue, checks out its branch and opens Claude Code on it; `baseline next` and `baseline standup` answer the same questions as the tools.

For sandboxes and cloud agents that can't run the CLI, `baseline connect claude --remote` points the agent at `https://<your server>/mcp` with an API key read from `$BASELINE_TOKEN`; tool calls there run with that key's permissions and teams, and `start_issue` returns the git command instead of running it.

## Skill (AI coding tools)

[`skills/baseline/SKILL.md`](../skills/baseline/SKILL.md) is an [Agent Skills](https://agentskills.io)-format skill that teaches Claude Code / OpenCode / ZCode to drive the tracker through this CLI. It ships in the package; to install it user-wide, symlink the directory into your tools' skill folders (`<checkout>` is wherever this repo or the installed package lives):

Use `~/.agents/skills` for the cross-tool standard, or `~/.claude/skills` for Claude Code:

```bash
ln -sfn <checkout>/skills/baseline ~/.agents/skills/baseline
ln -sfn <checkout>/skills/baseline ~/.claude/skills/baseline
```


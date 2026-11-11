# Baseline

**An issue tracker for engineering teams working with coding agents.**

Work in Claude Code and git. Your agent keeps issues current—starts work, posts progress, and hands it back for review. Open Baseline to see what's moving, plan what's next, or make a decision.

Local-first. A web app, CLI and MCP server backed by one SQLite database. Run it on your machine or self-host it for your team.

## See it in action

A coding agent picks up an issue, creates a branch, splits the work into sub-issues, posts progress, and hands it off for review. The web app updates as it goes. **77 seconds, narrated.**

https://github.com/user-attachments/assets/46c72046-dad7-42b8-9b9a-3cdfe003e780

## Why Baseline?

- **Less status upkeep.** Agent tools and Claude Code hooks carry issue context into a session and report progress back to the tracker.
- **A shared view of the work.** Issues, sub-issues, blockers, projects and milestones, with list and board views for planning and review.
- **People stay in control.** The agent is instructed to ask before creating new issues. It can split started work into sub-issues, draft follow-ups, and hand work back for review. Agent writes are attributed and reversible.
- **Your infrastructure, your data.** One Node server and one SQLite database. No external service required for local use or email/password sign-in on a team server.

Baseline connects to the coding agent you already use; it is not an agent runner. Claude Code has MCP tools and lifecycle hooks. Codex and pi have MCP configuration and repo instructions; other CLI-capable agents can use the [Baseline skill](skills/baseline/SKILL.md).

**Alpha:** the database schema and CLI may change between releases. Back up before upgrading.

## Try it locally

Requires **Node.js 22.13 or later**.

```bash
git clone https://github.com/dataguyofprocol/baseline
cd baseline
npm install
npm run dev
```

Open **http://localhost:5183**. On a fresh workspace, onboarding lets you name your team and load sample data. The API runs on port 7327; development uses `~/.baseline/baseline-dev.db`, separate from your regular workspace.

For database paths and local configuration, see [Running Baseline](docs/running.md#local-development).

## Use it with your team

Baseline runs as one Docker deployment with a persistent data volume. Set the server address, create the owner account with the setup token, then invite your team. Email/password sign-in is built in; Google sign-in and email delivery are optional.

**[Self-host with Docker →](docs/running.md#self-host-with-docker)**

## Connect your coding agent

The CLI is not on npm yet. Install it from the Baseline checkout:

```bash
npm run build
npm install -g .
```

Then, in the repo where you work, connect to your team's server:

```bash
baseline login --server https://baseline.example.com
baseline connect claude --team ENG
baseline doctor
```

Replace the server address and team key with yours. Commit the config files `connect` writes so teammates share the setup; each person signs in separately. Use `connect codex` or `connect pi` for those agents.

Now ask your agent **“What should I work on?”** or **“Let's work on ENG-15.”** It can find the issue, start its branch, record progress, and finish with a review handoff.

**[Agent setup, local databases and remote MCP →](docs/agents.md)**

## From the terminal

After connecting to a server, you can also read and update issues directly:

```bash
baseline issue list -t ENG --json
baseline issue show ENG-15
baseline issue comment ENG-15 "Found the cause; working on a fix."
baseline standup
```

Local-database commands cover the wider workspace, including projects, labels, locations and import/export. Hosted CLI coverage is narrower; see the [CLI reference](docs/cli.md#against-a-hosted-server) for supported commands and connection rules.

## Documentation

- [Running Baseline](docs/running.md) — local configuration, Docker, HTTPS, backups and accounts.
- [Agent setup](docs/agents.md) — MCP, hooks, attribution and the CLI skill.
- [CLI reference](docs/cli.md) — commands, flags and local/server targeting.
- [Feature inventory](FEATURES.md) — implemented features and known gaps.
- [Core flow](CORE_FLOW.md) — product intent and the engineer's day.

## Development

```bash
npm run typecheck
npm run test:cli
```

Run the suites relevant to your changes; see [AGENTS.md](AGENTS.md). Tests use scratch databases. Never seed, reset or test against `~/.baseline/baseline.db` or `~/.baseline/baseline-dev.db`.

## License

[Apache License 2.0](LICENSE). © 2026 Baseline contributors.

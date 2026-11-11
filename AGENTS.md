# AGENTS.md

Baseline is a local-first issue tracker for engineering teams that work with coding agents.
One Node server (`src/server`) serves the React app (`web/src`) and a REST API over one SQLite
file; the `baseline` CLI (`src/cli`), the MCP server (`src/mcp`) and the terminal UI (`src/tui`)
work on the same data. Domain logic lives in `src/core`. How the product is meant to work:
`CORE_FLOW.md`. What exists: `FEATURES.md`.

## Verify a change

- `npm run typecheck` checks the server, the scripts and the web app.
- `npm run test:cli` and the other `test:*` scripts each use their own scratch databases. CI runs
  only `test:cli`, so run the suites that cover what you touched.
- For UI, REST or CLI behaviour, use the `verify-baseline` skill. It starts a throwaway instance
  and drives it in headless Chrome with the journey harness (`scripts/journey-harness.js`).

## Never touch real data

`~/.baseline/baseline.db` is a real workspace and `~/.baseline/baseline-dev.db` is a personal
sandbox. Never seed, reset or drive either. `node bin/baseline.js` and `node dist/server/index.js`
default to the real database when run without `--db` or `BASELINE_DB`.

## Comments: /no-comments

Code says what it does; comments are for what the code cannot say. Before you hand back a change,
run `/no-comments` on your diff. When you write code, the same rule applies:

- No narration, section banners, commented-out code, history ("used to…") or doc comments on
  internal symbols.
- A comment stays only if it is one of these:
  - a legal or license header;
  - non-obvious behaviour forced by something outside our code (a dependency, platform, vendor
    or protocol: SQLite, scrypt, Ink, tmux, OSC 52, MCP stdio, GitHub webhooks, Google OAuth,
    browser and React quirks);
  - a doc comment that defines a contract leaving the process (REST bodies, MCP or CLI output,
    snapshot fields);
  - an issue or RFC link for a constraint the code cannot express;
  - `// prettier-ignore`, or a lint suppression whose rule is style-only.
- When our own code needs a comment to be understood, do not write it: rename, extract or type
  the code until it reads without one.
- When unsure whether a comment qualifies, delete it.

## pstack skills

The [pstack](https://github.com/cursor/plugins/tree/main/pstack) plugin (MIT) is installed under
the `.agents/` convention:

- Skills live in `.agents/skills/<name>/SKILL.md`. A pstack skill's
  `<pstack>/skills/<name>/SKILL.md` means that path here.
- Claude Code finds them through `.claude/skills`, a symlink to `../.agents/skills`.
- When a pstack skill names a Cursor-specific tool or subagent, map it with
  `.agents/pstack/docs/harness/claude-code.md`. The comment-sicko agent's brief is
  `.agents/pstack/agents/comment-sicko.md`.
- `verify-baseline` is this repo's own skill, not pstack's. It lives in `.agents/skills/` too, so
  an update that replaces that folder must keep it.
- Provenance and update steps: `.agents/pstack/INSTALLED.md`.

---
name: verify-baseline
description: Launch an isolated Baseline instance (scratch SQLite DB, private port) and drive it the way a user does — the web UI in headless Chrome via the repo's journey harness, and the `baseline` CLI — then capture proof (screenshots, harness PASS/FAIL rows, CLI output, a second read of stored data). Use to prove a change to Baseline's web app, REST API or CLI actually works, to reproduce a UI bug, or before claiming a feature is done. Never touches ~/.baseline/baseline.db.
---

# Verify Baseline

Baseline is a local-first issue tracker: one Node server (`dist/server/index.js`) that serves the React app in `web/dist` plus a REST API, and a CLI (`bin/baseline.js`) that writes the same SQLite file. The two surfaces are the **web UI** and the **CLI**. This skill starts a throwaway copy of both and drives them.

All helpers live in this skill's `scripts/`. Paths below are relative to the repo root; `VB=.claude/skills/verify-baseline/scripts/vb` and `DRIVE=.claude/skills/verify-baseline/scripts/drive.mjs`. Shell state does not persist between tool calls, so write the full paths or re-set them each call.

## Never touch real data

- `~/.baseline/baseline.db` is the user's real workspace (served at :7770 by `~/sideones/baseline-work`). `~/.baseline/baseline-dev.db` (:7327) is the user's own dev sandbox. Do not drive, seed or reset either.
- `vb` refuses any DB under `~/.baseline/`. Do not run `node bin/baseline.js` or `node dist/server/index.js` bare: without `--db`/`BASELINE_DB` they default to the real DB. Use `vb cli <run> …` instead.
- Do not run `issue open` (opens a terminal window with Claude Code on the user's machine), `agent config`, or `location add` against anything but a scratch run.

## Launch

```bash
.claude/skills/verify-baseline/scripts/vb start
# RUN=run-20261108-003758-84356
# URL=http://localhost:7390
# HARNESS=http://127.0.0.1:7391/journey-harness.js
# EVIDENCE=/Users/…/.cache/baseline-verify/run-…/evidence
```

`vb start`:
1. Runs `npm ci` if `node_modules/` is missing, and `npm run build` if `dist/` or `web/dist/` is older than `src/` or `web/src/` (build log: `~/.cache/baseline-verify.build.log`).
2. Creates `~/.cache/baseline-verify/<run>/instance/baseline.db` and seeds the sample workspace into it (`seed --reset` on that scratch file only).
3. Starts the server on the first free port from 7390 (loopback only, no hosted mode, no `--open`), and a tiny static server on the next port that serves `scripts/journey-harness.js`.
4. Waits until the server is usable: the log says `[baseline] serving on`, `/api/bootstrap` returns the seeded `CORE` team, and the harness URL answers. If that fails, it prints the server log, stops the run, and exits 1.

Keep the printed `RUN` id; every other command takes it. `vb list` shows runs and whether they are alive. Runs are independent: several can run side by side.

Seed data you can rely on in a fresh run: teams `CORE` (Backlog/Todo/In Progress/In Review/Done/Canceled) and `AGO` "Agent Surface" (adds `Triage`); 24 issues, `CORE-1`…`CORE-17` and `AGO-1`…`AGO-7` (`AGO-7` is in Triage); projects `Agent Handoff`, `Mobile Companion`, `Design System 2.0`; members `Ada Osei`, `Jun Watanabe`, and the agent user `Agent` (`Claude Code`, `Codex` and other coding-tool agents are made the first time that tool writes, e.g. an MCP client named `claude-code` or `--as "Claude Code"`); the current user (admin) is named after `git config --global user.name`.

## Doctor

Run this first, and again whenever anything looks off:

```bash
.claude/skills/verify-baseline/scripts/vb doctor <run>
```

Read-only. Checks the server pid is alive, that pid owns the port, the server log names this run's scratch DB, `/api/bootstrap` answers (prints teams, issue count, current user), the harness URL is served, and `dist/` is not older than `src/`. Exit 0 means the instance is worth driving. `WARN … stale build` means you edited code after `vb start`: `vb stop` then `vb start` (it rebuilds).

## Drive

### Web UI: `drive.mjs` (headless Chrome over CDP)

`drive.mjs` launches `/Applications/Google Chrome.app` headless with a throwaway profile (override with `CHROME=/path`), opens the run's URL at 1440×900, injects `scripts/journey-harness.js`, acts, then saves a screenshot and a JSON record. It needs no npm packages and no Chrome extension.

```bash
# run whole harness sections (the repo's maintained UI journeys)
node .claude/skills/verify-baseline/scripts/drive.mjs <run> harness create,triage --name my-proof

# run your own journey: an async JS body with `t` = the harness helpers; `return` what you saw, throw on failure
node .claude/skills/verify-baseline/scripts/drive.mjs <run> eval /team/CORE/all .claude/skills/verify-baseline/journeys/create-issue.js --name create-issue

# screenshot one route
node .claude/skills/verify-baseline/scripts/drive.mjs <run> shot /issue/CORE-1 --name core-1
```

Harness sections: `shell`, `create`, `triage`, `issue`, `lists`, `projects`, `cycles`, `inbox`, `settings`, `more`, `parity`, `bell`, `routes`. Each row prints `PASS`/`FAIL <id> <journey> — <what it saw>`. The full catalogue with row ids is in `JOURNEYS.md` at the repo root.

Harness helpers you use in `eval` journeys (all on `t`, see the top of `scripts/journey-harness.js`):
- Navigate: `await t.nav('/team/CORE/all')` (routes are hash routes: `/inbox`, `/my-issues`, `/team/<KEY>/all|active|backlog|triage|cycles/current`, `/issue/<KEY-N>`, `/projects/<id>`, `/search`, `/drafts`, `/settings`).
- Keys: `await t.press('c')`, `t.key('Enter', { meta: true })` for ⌘↵, `await t.press('p', { shift: true })`.
- Find and act: `t.q(sel)`, `t.qa(sel)`, `t.byText('Save draft')`, `await t.click(target)`, `await t.type(input, 'text')`, `await t.write(proseMirrorEl, 'text')`, `t.menuOpen()`, `t.menuItem('Done')`, `await t.closeAll()`.
- Read state: `t.text()` (main pane text), `t.rows()` (issue rows), `await t.snap()` (`/api/bootstrap` snapshot), `await t.issue('CORE-3')`, `await t.sync()` (refetch after a write).
- Fail: `t.fail('why')`.

Stable handles in the app: `.sidebar`, `.cm-root` (create-issue modal), `.cm-pills` (its property pills), `.ProseMirror` (rich text), `.menu:not(.closing)` (open menu), `.menu-item`, `[data-issue-row]`, `[data-search-row="Issue"]`, `.inbox-row` / `.inbox-title` (inbox and triage), `.activity` and `.cmt` (issue timeline and comments), `.subscribe-btn`, `[title="Display options"]`, `[title="Create triage issue"]`, `.topbar`, `.board`. Keyboard is the primary user path: `c` create, `/` search, `s p a l` property menus, `1 2 3` triage accept/duplicate/decline, ⌘K palette, `?` help.

The Claude in Chrome tools also work against `URL` when the extension is connected (navigate there, then inject the harness with a `<script src=HARNESS>` tag via `javascript_tool`). `drive.mjs` is the default because it needs nothing connected.

### CLI: `vb cli`

```bash
.claude/skills/verify-baseline/scripts/vb cli <run> issue create "Title" -t CORE -p high --json
.claude/skills/verify-baseline/scripts/vb cli <run> issue show CORE-3 --json
.claude/skills/verify-baseline/scripts/vb cli <run> issue list -t CORE -q "text"
```

Runs `node bin/baseline.js` with this run's `BASELINE_DB` and `BASELINE_PORT` (hand-off links use the port). It never sets `BASELINE_URL`, because the CLI treats that as a server target and refuses it beside a database. Full command list: the CLI section of `README.md`, or `vb cli <run> <command> --help`. Errors go to stderr with exit 1. Use `--json` for assertions. The CLI writes the same DB the server watches, so an open page picks the change up live (within about a second, or after `t.sync()`).

### REST: `vb api`

`vb api <run> /api/bootstrap` (or `/api/search?q=…`, `/api/issues/<id>`, `/api/notifications`) prints JSON. Use it only as a second view of state, never as the action under test.

## Evidence

Everything goes to `~/.cache/baseline-verify/<run>/evidence/`; `vb stop` never deletes it.
- `drive.mjs` writes `<name>.png` (final screen) and `<name>.json` (`results` or `value`, `consoleErrors`, `pageErrors`, `finalUrl`, `ok`). Treat non-empty `pageErrors` as a finding, even when the rows pass.
- For CLI proof, save the command, stdout, stderr and exit code: `vb cli <run> … > "$EVID/name.out" 2> "$EVID/name.err"; echo $? > "$EVID/name.rc"` (`vb info <run>` prints `EVIDENCE=`).

Proof standards:
- Drive the real user path (keys, clicks, CLI commands). Seeding state through `t.post` or `vb api` is setup, not proof.
- Capture the action and the resulting state: what the journey did, then a second view. A toast is not proof. Re-read the stored value through `t.snap()`, `vb cli … show --json`, or by reopening the page.
- Check side effects alongside the screen: the issue exists in the DB, the notification is in `/api/notifications`, activity was recorded.
- A change touching both surfaces needs proof from both: write in one, read in the other.
- When a feature has several entry points (feature map), prove each one or report which you skipped. Do not count one entry point as proof for another.

## Cleanup

```bash
.claude/skills/verify-baseline/scripts/vb stop <run>
```

Kills only the server and harness pids recorded for that run (TERM, then KILL after 2s), then deletes `<run>/instance/` (DB, logs). Evidence stays. `drive.mjs` kills its own Chrome and deletes its profile on exit. Never `pkill node` or kill by port: the user's work instance and dev servers are node too. Run `vb stop` after every failed attempt as well, and `vb list` to find runs you left alive.

## Feature map

`features/README.md` indexes the user-facing features, with one recipe file per feature. Read the matching file before you verify a change to that feature. Keep it current with `/maintain-verification-skill` when you add or change features.

## Gotchas

- Harness rows mutate data and assume fresh seed keys (`CORE-1`…). For clean results, start a new run per proof, or run sections in the order the harness lists them.
- CLI `search` matches titles and descriptions, not issue keys (`search CORE-3` finds nothing). The web `/search` page does match keys.
- `issue create` without `--json` prints only the new key.
- The first-run "name your team" screen appears only for a server started on an empty DB without seeding. `vb start` always seeds, so to verify first-run, start the server by hand on a scratch path under the run dir: `BASELINE_DB=<run>/instance/empty.db BASELINE_PORT=<free> node dist/server/index.js`. Kill that pid yourself.
- Hosted mode starts when `BASELINE_PUBLIC_URL` is set (password sign-in; Google too with `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`). `vb` clears all three so runs stay local mode; `npm run test:auth` covers the hosted API. To drive hosted mode in the browser, start a server by hand on a scratch DB with `BASELINE_PUBLIC_URL=http://localhost:<port>` and read the setup token from its log.
- `npm run test:cli` (about 300 CLI checks, own scratch DBs) and `npm run typecheck` complement this skill: run them for CLI or type-level changes. They do not replace a UI drive.

# Operations runbook

Two instances of Baseline run on this machine. This is the whole playbook: shipping
features, server control, backups, and what to do when something looks broken.

## The layout

| | work (daily use) | dev (feature work) |
|---|---|---|
| code | `~/sideones/baseline-work` — worktree, branch `work` | `~/sideones/baseline` — branch `main` |
| UI | http://localhost:7770 | http://localhost:7327 |
| database | `~/.baseline/baseline.db` — production | `~/.baseline/baseline-dev.db` — sandbox, auto-seeded |
| control | `~/sideones/baseline-work/app.sh` | `npm run dev:server` in the repo |

The database lives outside both repos, so git operations can never touch your data.

## Ship a feature (the loop)

```bash
cd ~/sideones/baseline                    # 1. land the work on main
git add -A && git commit -m "…"

~/sideones/baseline-work/app.sh update    # 2. ship it to the work copy
```

`update` is conflict-proof by design: it backs up the database, archives any local residue
into a git stash (never re-applied), resets the worktree exactly onto main, runs `npm ci`
only if the lockfile changed, rebuilds, and restarts. Your data is never touched.

## Server control

Work instance (from anywhere):

```bash
~/sideones/baseline-work/app.sh status    # pid, port, commit
~/sideones/baseline-work/app.sh restart
~/sideones/baseline-work/app.sh backup    # manual backup, keeps the last 10
```

Dev instance (from `~/sideones/baseline`):

```bash
npm run dev:server     # API on :7327 straight from source, auto-reloads, sandbox DB
npm run dev            # same + hot-reload web on :5183
```

The dev server only runs when started. The work instance is the one that must always be
up — `app.sh start` brings it back.

## Backups & restore

- Every `update` takes a sqlite backup first; the last 10 live in `~/.baseline/backups/`.
- Restore one:

```bash
~/sideones/baseline-work/app.sh stop
sqlite3 ~/.baseline/baseline.db ".restore '$HOME/.baseline/backups/baseline-YYYYMMDD-HHMMSS.db'"
~/sideones/baseline-work/app.sh start
```

- Human-readable JSON export (restorable via Settings ▸ Import & export):
  `node ~/sideones/baseline/bin/baseline.js export --out backup.json`

## Rules that keep production safe

1. `seed --reset` and `import <file>` wipe the database they point at — with no `--db`,
   that is production. When experimenting, always pass a scratch path: `--db /tmp/scratch.db`.
2. Dev commands (`npm run cli`, `npm run seed`, `npm run dev:server`) are sandboxed to
   `baseline-dev.db`. Bare commands are production: `node bin/baseline.js`, `npm run mcp`,
   anything serving :7770.
3. The app auto-seeds any database whose `meta` table is empty. Deleting `baseline.db`
   resurrects demo data — restore from a backup instead of deleting.
4. Restart servers only between batches of work; agents may be writing concurrently.

## When something looks broken

- **Broken on work, fine on dev** (or the reverse): almost always data or version drift,
  not the server. Compare `app.sh status` (commit) and the issue counts on both ports.
  A restart is rarely the fix.
- **Server won't start:** read the log — `~/.baseline/work-server.log` or
  `~/.baseline/dev-server.log`. Port squatted? `lsof -ti tcp:7770` names the pid.
- **"Team not found" or an empty page after a reset:** stale tab state; the app
  self-heals unknown team routes on load — refresh. Zero teams shows the onboarding screen.
- **Dependency errors after an update:** `cd ~/sideones/baseline-work && npm ci`.

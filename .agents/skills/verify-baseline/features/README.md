# Baseline verification map

This directory is the maintained source for verifying Baseline's user-facing behavior. Read this index before you drive the app, then use the matching feature file as the recipe. `vb` and `drive.mjs` below mean `.claude/skills/verify-baseline/scripts/vb` and `node .claude/skills/verify-baseline/scripts/drive.mjs`, run from the repo root.

## Baseline preconditions

- Start a fresh run with `vb start` and keep its `RUN` id. Never drive `:7770` or `:7327`, or any instance this run did not start.
- `vb doctor <run>` exits 0.
- The run holds the seeded sample workspace: teams `CORE` and `AGO`, issues `CORE-1`…`CORE-17` and `AGO-1`…`AGO-7`, members `Ada Osei` and `Jun Watanabe`.

## Driving conventions

- UI actions go through `drive.mjs <run> harness <sections>` or `drive.mjs <run> eval <route> <journey.js>`. Use keys and clicks through the harness helpers on `t`, never `t.post` for the action under test.
- CLI actions go through `vb cli <run> <command>`. Use `--json` when you assert.
- Prefer the stable handles listed in `SKILL.md` (class names and `title` attributes the harness uses) over coordinates.
- Harness rows assume fresh seed keys. Start a new run when a recipe needs clean state.

## Proof and skip reporting

- UI proof: the `drive.mjs` `<name>.png` plus `<name>.json` with `ok: true` and no `pageErrors`.
- CLI proof: the command, stdout, stderr and exit code saved under the run's evidence dir.
- Mutation proof: a second read of the stored value (`t.snap()`, `vb cli … show --json`, or reopening the page). A toast alone does not count.
- Record the feature file and entry point with every artifact name (for example `--name create-issue-C`).
- Report an unreachable entry point with the command you tried and the unmet precondition. Do not report one entry point as verified through another.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior, then exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with drive.mjs and vb` (starts with `Preconditions:`), `Gotchas`. Keep implementation details out; name only user paths, stable handles, required state, commands and observable proof.

## Features

- [Create an issue](./create-issue.md): the C modal, drafts, context-aware prefill, and CLI `issue create`.
- [Work an issue](./issue-page.md): property shortcut menus, comments, subscribe, and CLI `issue update` / `comment`.
- [Triage](./triage.md): the AGO triage queue with accept, duplicate, decline, snooze, and CLI-filed triage issues.
- [Search and navigation](./search-navigation.md): the `/` search page, ⌘K palette, G-chords, and CLI `search`.
- [Projects](./projects.md): projects list, project page, updates with health, milestones, and CLI `project`.

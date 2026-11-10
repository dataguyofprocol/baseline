# Contributing to Baseline

Thanks for your interest in Baseline. This guide covers how to file issues, run the test suite, and submit pull requests.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to its terms.

## Filing issues

- **Bugs and feature requests** → GitHub Issues. Use the templates.
- **Security vulnerabilities** → see [`SECURITY.md`](SECURITY.md). Do **not** file them as public issues.

Before opening a bug: search existing issues, run the latest commit, and confirm it reproduces on a fresh clone.

## Development setup

Requires Node.js ≥ 22.13.

```bash
git clone <repo-url>
cd baseline
npm install
npm run dev          # starts the server on :7327 and Vite on :5183
```

The dev scripts sandbox to a separate SQLite file (`~/.baseline/baseline-dev.db`) so they can't touch real data. Pass `BASELINE_DB` and `BASELINE_PORT` to override.

## Running tests

```bash
npm run typecheck    # tsc --noEmit on both the node and web projects
npm run test:cli     # builds, then exercises every CLI command against throwaway databases
```

The CLI test suite builds a fresh database per scenario, so it never touches your workspace.

## Coding conventions

- TypeScript strict mode. `tsc --noEmit` must pass.
- Two tsconfig roots: `tsconfig.node.json` (server, CLI) and `web/tsconfig.json` (web). Keep them in sync when adding shared types.
- No bundler-only type checking: the CI workflow runs `tsc` explicitly.
- Match the surrounding code's comment density and naming. Don't restate the obvious.
- Before opening a PR, run `npm run typecheck && npm run test:cli` and paste the result in the description.

## Commit and PR conventions

- Prefer squash merges with a Conventional-Commits-style subject (`feat: …`, `fix: …`, `docs: …`, `chore: …`).
- One logical change per PR. Keep diffs reviewable.
- Reference the issue in the PR body (`Closes #123` or `Refs #123`).
- Add a short note for any user-facing change in the PR description: what users do now, what they used to do, and what they'd notice.

## Releasing

Maintainers handle releases. Tags follow semver (`vMAJOR.MINOR.PATCH`) on the default branch. Do not push tags from a fork.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).

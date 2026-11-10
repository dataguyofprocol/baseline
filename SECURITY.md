# Security policy

## Supported versions

The `main` branch receives security fixes. Released tags will be supported on a best-effort basis until the next minor release ships.

| Version | Supported |
|---|---|
| `main` (latest commit) | ✅ |
| Tagged releases | until the next minor |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Email **security@baseline.local** (placeholder — replace before publishing) with:

- A description of the issue and its impact
- Steps to reproduce, or a proof-of-concept
- The commit hash or release tag you reproduced against

You can expect an acknowledgement within 72 hours and a triage decision within one week. We coordinate disclosure timing with the reporter.

## Scope

Baseline is a local-first tracker. The CLI runs on your machine and talks straight to the SQLite file; it opens no network listeners. The web server listens only on this machine (127.0.0.1 and ::1) and refuses requests addressed to any other host. Setting `BASELINE_HOST` (for example `0.0.0.0`) opens it to your network, and requests from other devices then need an API key. To serve a team, run hosted mode (sign-in required) behind HTTPS, as the Docker setup in the README does.

## GitHub integration: read-only

Baseline never writes to GitHub: no comments, status checks, labels, branches, merges or pushes.

- **Polling** reads with a GitHub token added in Settings › Integrations › GitHub (a classic token that can write is refused), or, on a local install with no token, your own `gh` login. On a hosted server each member can add their own token, and a repo is read only with the token of someone who added it. Every `gh` / `git` invocation goes through one function (`run` in `src/core/git.ts`) that only allows read commands (`pr list/view`, `issue list/view`, `repo view`, `api` without a body or a non-GET method, `git log`, …) and throws on anything else. The test suite checks the allowlist against a list of write commands.
- **Webhooks** need no GitHub credential at all: GitHub pushes events to `POST /api/github/webhook`. That one route is reachable from hosts other than localhost (so a tunnel can deliver to it); it accepts a request only when its `X-Hub-Signature-256` HMAC matches the workspace secret (compared in constant time), drops repeat deliveries by `X-GitHub-Delivery`, caps payloads at 25 MB and logs every delivery, including rejected ones. Every other route keeps its usual rule: this machine only, or signed in on a hosted server. The secret is shown once when it's generated and can be rotated or turned off in Settings › GitHub or with `baseline git webhook`.
- **GitHub Issues import** is one way: it reads issues with `gh issue list` (or from `issues` webhooks) and creates Baseline issues; nothing changes on GitHub.

## Secrets and supply chain

- No telemetry. The server does not phone home.
- The CLI accepts `--db <path>` and `BASELINE_DB`; treat those paths and any database file the same as the data they hold.
- Dependencies are pinned in `package-lock.json` and updated via PR. We do not enable post-install scripts from transitive dependencies.

## Acknowledgements

We credit reporters in the release notes (unless they ask to stay anonymous).

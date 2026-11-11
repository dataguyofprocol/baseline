# Running Baseline

[← README](../README.md)

## Local development

Requires Node.js ≥ 22.13.

```bash
git clone https://github.com/dataguyofprocol/baseline
cd baseline
npm install
npm run dev
```

Open http://localhost:5183. The API server runs on port 7327.

Dev commands (`npm run dev`, `dev:server`, `start`, `serve`, `cli`, `seed`) default to
`~/.baseline/baseline-dev.db` and port 7327. Bare `node dist/server/index.js` and
`node bin/baseline.js` default to the real database, `~/.baseline/baseline.db`, and port 7770.
Override with `BASELINE_DB`, `BASELINE_PORT`, or `BASELINE_URL`.

**Never point tests, seeds or experiments at either of those databases.** Use an explicit scratch
path for experiments. `seed --reset` deletes the data in its target database.

A database whose `meta` table is empty starts blank in the web app: onboarding names your team
and offers sample data. The CLI seeds a new database.

The local server listens on this machine only (127.0.0.1 and ::1). It rejects requests addressed
to other hosts and cross-site writes. `BASELINE_HOST=0.0.0.0` opens it to your network; do not
expose an unauthenticated instance to an untrusted network. Launching Claude Code remains local-only.

## Live updates

Open tabs subscribe to `/api/events`. When the database changes, the server announces a new
version and each tab refetches its snapshot. This includes writes from the app, teammates and
agents using the CLI; the server watches SQLite's `data_version`.

Cycles, recurring issues and update reminders run on a one-minute timer, only while the server runs.

## Self-host with Docker

One deployment per organization: one container, one SQLite database on the `/data` volume,
with multiple teams and people.

### Start

Clone the repo, copy [`.env.example`](../.env.example) to `.env`, and set `BASELINE_PUBLIC_URL`
to the address people will open. Email/password sign-in needs no external service. Google sign-in
and email delivery are optional.

```bash
cp .env.example .env
```

After editing `.env`:

```bash
docker compose up -d
docker compose ps
```

The image builds and serves on port 7770 by default. The container becomes healthy when
`GET /healthz` answers.

The container refuses to start without `BASELINE_PUBLIC_URL`: without sign-in, anyone who can
reach it could act as any user. `BASELINE_REQUIRE_SIGN_IN=0` disables this check **for a trusted
private network only**.

### HTTPS

In `.env`:

- Uncomment `COMPOSE_FILE=compose.yaml:compose.https.yaml` and `BASELINE_DOMAIN`.
- Set `BASELINE_PUBLIC_URL=https://<that domain>`.
- Set `BASELINE_PUBLISH=127.0.0.1:7770`.

Point the domain's DNS at the machine. Caddy obtains the certificate.

### First sign-in

A new hosted workspace starts empty. Get the one-time setup token:

```bash
docker compose logs baseline
```

Or print it again:

```bash
docker compose exec baseline baseline setup-token
```

Open `BASELINE_PUBLIC_URL`, enter the token, and create the owner account and workspace name.
The token stops working once the owner exists. Onboarding asks for the first team.
Invite everyone else from **Settings › Members**. Without email configured, copy and send each
invite link.

On a non-Docker server, `baseline setup-token --db <path>` prints the token on the server.

### Configuration

Setting `BASELINE_PUBLIC_URL` enables hosted mode. Setting both `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` adds **Continue with Google**; the server refuses to start with only one.

| Variable | Meaning |
|---|---|
| `BASELINE_PUBLIC_URL` | The address people open, e.g. `https://baseline.example.com`. Other hosts and write origins are refused. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google OAuth client of type **Web application**. Set its authorized redirect URI to `<BASELINE_PUBLIC_URL>/auth/google/callback`. |
| `BASELINE_OWNER_EMAIL` | With Google sign-in, this account creates the first admin and always remains an admin. |
| `BASELINE_WORKSPACE_NAME` | Name of a new hosted workspace; defaults to `Baseline`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional email delivery. Port defaults to 587. `SMTP_FROM`, e.g. `Baseline <baseline@example.com>`, is required when `SMTP_HOST` is set. GCP blocks outbound port 25; use 587 or 465. |

Without SMTP, invites work as shared links. With SMTP, the sign-in screen also offers
**Forgot your password?**. See [`.env.example`](../.env.example) for port, HTTPS and TLS settings.

### Back up and restore

Everything lives in `/data`. Stop the server before copying so the backup is consistent:

```bash
docker compose stop baseline
docker compose cp baseline:/data ./baseline-backup
docker compose start baseline
```

To restore:

```bash
docker compose stop baseline
docker compose cp ./baseline-backup/. baseline:/data
docker compose run --rm --no-deps --user root --entrypoint chown baseline -R node:node /data
docker compose start baseline
```

### Upgrade

Back up first, then:

```bash
git pull
docker compose up -d --build
```

The volume is kept. The database schema migrates when the server starts.

### Admin CLI

Run commands against the server's database inside the container:

```bash
docker compose exec baseline baseline user list
docker compose exec baseline baseline export --out /data/export.json
```

For a coding agent on your own machine, see [Connect a coding agent](agents.md).

## Accounts and permissions

People can sign in through:

- The owner account created during setup, or `BASELINE_OWNER_EMAIL` with Google.
- An existing password, set through an invite or reset link.
- An open invite, valid for seven days: use the invited email and choose a password or continue
  with the matching Google account. A different address or Google account is refused.
- Google sign-in matching an existing member who has not signed in yet, including imported members.
- A Google Workspace account at an approved domain (**Settings › Security**).

Passwords need at least 10 characters and are stored as scrypt hashes with per-user salts.
Wrong emails and wrong passwords receive the same response. Admins can create one-use reset links
in **Settings › Members**, valid for 24 hours. Everyone can change their password in
**Settings › Account & API keys**; doing so signs out their other sessions.
Sessions last 30 days and renew with use.

**Settings › Members** lets admins invite Members or Admins onto selected teams; add existing
people to teams by name or email; resend, copy or revoke invites; change roles and teams; and
suspend or reactivate members. At least one admin must remain, and nobody can suspend themselves.

**Settings › Security** controls approved domains, initial teams for domain sign-ins, and whether
members may invite. Only admins may invite admins. Roles, suspension, security, workspace
settings, import and export are admin-only.

Anyone can join or leave a team from the Teams page. **Your teams** lists your memberships.
Favorites, preferences and inbox state are personal. Saved views are shared unless the owner
makes them personal from the view's menu.

Mentions use `@[Ada Osei](user:u_…)` to distinguish identical names. Plain `@Ada Osei`, including
CLI-written text, also counts when exactly one member has that name.

## Hosted security and limits

- Comments and descriptions are sanitized before display.
- Uploads other than images, video, audio and PDF download rather than render.
- Sign-in, setup, invite links, reset links and invite sending are rate-limited per address;
  password sign-in is also limited per account.
- `X-Forwarded-For` supplies the client address only when the connection comes from a proxy on
  the same machine, such as Caddy.
- Opening Claude Code and adding locations are unavailable on hosted servers: they act on the
  machine they run on.

`npm run test:auth` covers setup, password and Google sign-in, invites, reset links, domains and roles.

# Baseline core flow

Status: proposal, 2026-11-09. Builds on `PRODUCT_AUDIT.md` and the decisions recorded there (§5.3).

## The product in one sentence

**An engineer works in Claude Code and git as they already do. Baseline writes down what happened. They open the web app only to decide or to look.**

Who it's for, in order:
1. **The engineer.** Lives in Claude Code (Claude Max) and git. Baseline must cost them close to zero keystrokes.
2. **The team lead.** Needs to see what's moving, decide what's next and review agent output. Works in the web app.
3. **The admin.** Sets it up once. Wants a team working within 15 minutes.

Everything else (PMs, designers, stakeholders) can read the web app, but no flow is designed for them yet.

## Fixed rules (from the decisions)

| Rule | Meaning in practice |
|---|---|
| Ask before creating | The agent may *propose* a new issue at any time; it creates one only after the person says yes in the chat. |
| Sub-issues are free | Inside an issue the person already started, the agent splits work into sub-issues without asking. |
| Git is how status moves | GitHub is strongly offered in onboarding and can be skipped. Without it, agent start and finish still move status. |
| Read-only GitHub | Baseline reads PRs, commits and webhooks. It never writes to GitHub, under any setting. |
| Home is My work | Every person lands on their own work across all their teams. |
| No runners | Each engineer's own Claude Code reports in. Baseline never runs an agent. |
| Core, not niche | A feature stays only if a 5–30 person engineering team uses it weekly. |

---

## 1. The engineer's day

The table shows each moment: what the engineer does, what Claude Code and git do, and what Baseline does as a result. **Bold** marks behaviour that doesn't exist today.

| Moment | The engineer | Claude Code / git | Baseline |
|---|---|---|---|
| **Session starts** | Opens Claude Code in a repo. | **SessionStart hook** asks Baseline about this repo and branch. | Injects 3–6 lines: "On branch `parth/core-12-fix-login-redirect` → CORE-12 *Fix login redirect* (In Progress, yours). Last progress: …. Also yours here: CORE-15 (Todo), CORE-18 (In Review)." Nothing on `main` with no open work. |
| **"What should I work on?"** | Asks Claude. | Calls **`next_issue`**. | Returns the top 3 of: in progress and mine, then Todo assigned to me by priority, then unassigned in my teams' current cycle. Unblocked only. |
| **Picks an issue** | "Let's do CORE-15", or runs **`baseline work CORE-15`** in the terminal. | `start_issue` **checks out the branch** (creating it from the default branch if new). | CORE-15 → In Progress, assigned to them if nobody is. The activity log shows "Claude Code via Parth started work". |
| **Asks for work with no key** | "Fix the login redirect bug." | Calls **`find_issues`** over the whole team (no "me" filter), ranked by word match. | **Match:** Claude asks once: "Track this on CORE-31 *Login redirect loops*? (yes / new issue / don't track)". **No match:** Claude proposes a draft: "Create WEB issue *Fix login redirect after SSO*, priority none, assigned to you? (yes / edit / don't track)". It creates and starts the issue only on yes. |
| **Splits the work** | (nothing) | Calls **`create_sub_issues`** when the plan has separable parts. | Sub-issues created under the started issue, same assignee and project, without asking. |
| **Works** | Codes with Claude. | `post_progress` after meaningful steps. A **Stop hook** nudges it when there are new commits since the last post. | One progress note on the issue, rewritten in place. Nobody is notified. |
| **Finds unrelated work** | (nothing) | Notes it with **`propose_followup`**, which stores a draft. | Nothing is created yet. Drafts are listed back at finish (see below). |
| **Commits** | `git commit` (or Claude does). | **The branch ties commits to the issue.** No key needed in the message. | The commit appears on CORE-15. A bare key in a commit message is a reference, never a close. |
| **Opens a PR** | `gh pr create` from the branch. | — | PR linked by branch. Status → In Review when review is requested (team automation, on by default once GitHub is linked). |
| **Finishes** | "Ship it" / ends the session. | `finish_issue` (in_review / done / stopped). It **lists pending follow-up drafts** in the chat: "I also noticed 2 things. File them? 1. … 2. …" | In Review exists on every team. The issue owner gets **"Ready for your review"** in My work when the agent finished for someone else, or when there's no PR. Approved follow-ups go to Triage, or to Backlog when triage is off. |
| **PR merges** | Merges on GitHub. | — | → Done. Parent → Done when its last sub-issue closes (on by default). |
| **Standup** | Asks Claude "what did I do since yesterday?" or runs `baseline standup`. | Calls **`my_activity`**. | Issues started, progressed, finished, PRs opened and merged, follow-ups filed, as 5–8 lines ready to paste. |

**What the engineer never does:** open the web app to move a status, retype what they did, or copy a key into a commit.

### 1a. Without GitHub

The same day, minus the PR rows: `finish_issue in_review` moves the issue to In Review and notifies the owner. A person moves it to Done after review. Onboarding says this plainly ("Link GitHub so merges close issues for you").

### 1b. Without Claude Code (plain terminal)

`baseline work CORE-15` starts the issue and checks out the branch. `baseline standup` and `baseline next` work on their own. The git rules (branch binds, merge closes) work the same.

---

## 2. The agent surface (MCP + hooks + CLI)

### 2.1 Tools (v2)

| Tool | Kind | Change from today |
|---|---|---|
| `next_issue` | read | **new.** "What should I work on?" |
| `find_issues` | read | **replaces `list_issues`' search use.** The whole team, ranked token match, says what it searched. `list_issues` stays for "mine". |
| `get_issue` | read | Text output includes sub-issues, blockers and links. |
| `my_activity` | read | **new.** Standup, since a time. |
| `propose_issue` | write (draft) | **new.** Stores a draft and returns it for the chat. Nothing is visible to the team. |
| `create_issue` | write | **new.** Takes a `draft_id` (the person said yes) or explicit fields. The guide says to call it only after a yes. |
| `start_issue` | write | Checks out the branch (or returns the exact command when it can't). Short output on repeat calls. Refuses quietly on someone else's started issue: it asks to take it over. |
| `create_sub_issues` | write | **new.** Several titles under a started issue, no confirmation needed. |
| `post_progress` | write | Unchanged (the best tool today). |
| `propose_followup` | write (draft) | **replaces `file_followup`.** A draft listed at finish. Never fails on a team without triage. |
| `finish_issue` | write | Returns pending drafts so the agent asks about them. In Review always exists. Notifies the owner. |
| `draft_project_update` | write (draft) | Unchanged; adds titles. |
| `undo` | revert | Receipts name the tool, not the CLI command. |

A note on "ask before creating": the confirmation lives in the conversation, not in Baseline. The guide says *"Never call `create_issue` without the person's yes in this conversation."* A draft keeps the exact text the person approved, so what they said yes to is what gets created.

### 2.2 Hooks (what makes it proactive)

Installed by `baseline connect claude`, in the committed `.claude/settings.json`:

| Hook | Runs | Does |
|---|---|---|
| `SessionStart` | `baseline hook session-start` | Prints the context block for the repo and branch (section 1). Silent when there's nothing to say. Under 300 ms; prints nothing on error. |
| `UserPromptSubmit` | `baseline hook prompt` | When the session has no started issue and the prompt reads like a work request, adds one line: "No Baseline issue is active. If this is work to track, use find_issues first." Never blocks. |
| `Stop` | `baseline hook stop` | When an issue is active and HEAD has commits newer than the last progress note, asks Claude to post progress (once per stop). Never loops. |

The CLAUDE.md block shrinks to 5 lines; the hooks carry the behaviour.

**Better packaging:** ship all of this as a Claude Code **plugin** (MCP server + hooks + skill in one install). `baseline connect claude` then adds the plugin for the repo instead of writing three files.

### 2.3 Setup: three steps, loud failure

```
npm i -g baseline        # or npx; published, no clone and build
baseline login                   # opens the browser; stores the key; knows the server
baseline connect claude          # once per repo, committed: plugin or .mcp.json + hooks + allow-list
```

- With no login, every agent path fails with "Not connected to Baseline. Run `baseline login`." It never creates or seeds a local database.
- `baseline doctor` prints the server, who you are, the repo → team mapping and whether hooks and MCP are live.
- The allow-list covers the reversible writes (`start_issue`, `post_progress`, `create_sub_issues`, `propose_*`), so "post often" doesn't mean "click often".
- Each tool writes as its own agent user, created on first use: "Claude Code via Parth".

### 2.4 Repo → team

The SessionStart hook and `find_issues` need to know which team a repo belongs to. The rule: the repo's GitHub `owner/name`, mapped to a team in the GitHub settings. Before GitHub is linked, the team the person picked when they ran `connect`, written to the committed config.

---

## 3. The web app

The web app has five jobs. Everything that serves none of them is hidden or cut.

| Job | Surface | Notes |
|---|---|---|
| Start my day | **My work** (home) | Three sections across all my teams: *Needs you* (reviews, mentions, agent drafts and questions, triage on teams I lead), *In progress*, *Up next*. Closed work is collapsed. The inbox becomes the *Needs you* section plus an "all notifications" link. |
| See the team | **Team issues** (list / board) | Default columns: status, title, assignee, PR. Everything else is opt-in. |
| Decide intake | **Triage** | Agent follow-ups and GitHub imports land here. Accept / duplicate / decline. |
| Read and steer one issue | **Issue page** | Timeline with attribution, agent progress card, PR rows. Empty optional properties hidden. |
| Plan | **Projects** (light) | Projects with issues, progress and a lead. Milestones stay. |

**Notifications rules:**
- One row per issue, showing the latest headline.
- The agent acting for you never notifies you, except "finished" and "blocked".
- A mention notifies once; replying subscribes.
- Opening the inbox marks nothing read.

---

## 4. First runs

### 4.1 Admin (hosted): target 15 minutes
1. Setup token → owner account and workspace name (unchanged).
2. **First team:** name, with a 3-letter key suggested (ENG, not ENGI).
3. **Invite:** paste emails *and* get one team join link to drop in Slack. "Copy all" when email is off.
4. **GitHub (strongly offered):** paste a read-only token → pick repos → map each repo to a team → see "23 open PRs, 9 already reference issues". Skippable.
5. **Land on the team board**, with "Create your first issue" and a checklist: invite (2/8 joined), GitHub, connect your agent (`baseline login` / `connect` with a copy button).

### 4.2 Engineer (invitee)
1. Open the link; the email is prefilled; choose a password.
2. One screen: "Olivia added you to Engineering. Your GitHub username?" (suggested from PR authors when GitHub is linked).
3. "Connect Claude Code": the three commands, with copy buttons.
4. Land on **My work**.

---

## 5. Roles

| Role | Who | Owns |
|---|---|---|
| Admin | 1–3 people | People, invites, security, GitHub, data |
| Team lead | Per team; the creator by default | That team's name, statuses, triage, templates, labels and membership |
| Member | Everyone | Everything else. Can invite under 10 people (setting) |

Members see only controls they can use. Every refusal names who to ask and offers "Ask <name>", which lands in that person's *Needs you*.

---

## 6. Core vs niche

| Keep, on by default | Keep, off until a team turns it on | Cut |
|---|---|---|
| Issues, sub-issues, relations, labels, priority, statuses incl. In Review, assignee | Cycles | SLAs |
| Projects + milestones | Estimates | Loops |
| Triage | Templates | Initiatives |
| Views + filters, search | Recurring issues | Named project statuses, project labels |
| My work / notifications | Documents | Priority inbox / focus grouping, natural-language snooze |
| GitHub (read-only) | Project update cadence | Customize sidebar, badge styles |
| Agent loop + timeline attribution | | Browser push categories |
| ⌘K, keyboard, ⌘Z | | 10 of the 14 display properties |

"Cut" means removed from the UI. The data stays in the database until we're sure.

---

## 7. Build order

| Phase | What | Fixes (audit #) | Size |
|---|---|---|---|
| **0. Stop the bleeding** | No auto-seed from `mcp`/`agent`; In Review on every team; finish notifies the owner; follow-ups never fail; bare key in a commit = reference; branch binds commits; agent users per tool; inbox doesn't auto-read; mention notifies once; remove hosted local-mode wording and the Reset button; skill path | 1, 2, 6, 7, 10, 11, 21, 23 | small, ~1–2 days |
| **1. Agent loop v2** | `next_issue`, `find_issues`, `propose_issue`/`create_issue`, `create_sub_issues`, `propose_followup`, `my_activity`; `start_issue` checks out the branch; hooks; `baseline work`, `standup`, `doctor`; plugin packaging; npm publish | 5, 8, 9 + the proactivity gap | medium, ~1 week |
| **2. First runs + My work** | Hosted onboarding with invite and GitHub steps; join link; prefilled invite email; invitee welcome with GitHub username; My work as home; one-row-per-issue notifications | 3, 12–15, 18, 22, 25 | medium, ~1 week |
| **3. Roles + slimming** | Team lead; hide what members can't use; "Ask <name>"; turn off or cut the niche list; lean issue rail and create modal; one sub-issue path | 4, 16, 17, 19, 20 | medium |

Phase 0 is safe to start now. Phases 1 and 2 can run in parallel.

## Open points
1. Whether `UserPromptSubmit` nudges feel helpful or naggy. Ship it behind a setting and read the result after a week.
2. The package name for npm (`baseline`?).
3. Plugin vs plain files for `connect claude`: the plugin is cleaner but adds a marketplace step. Recommendation: plugin, with plain files as a fallback.

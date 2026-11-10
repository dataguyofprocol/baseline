# Baseline product audit: flows, friction, adoption

Date: 2026-11-09. Method: four walkthroughs, each on its own scratch instance (never `~/.baseline`). Admin and member flows ran on a **hosted** server with password sign-in and no SMTP. The issue lifecycle and agent flows ran on a **seeded local** instance, plus a hosted one for `login` and `/mcp`. Every flow was driven in Chrome or the CLI and checked against the code.

Raw reports, with screenshots and file:line evidence, are in the session scratchpad: `admin-audit.md`, `member-audit.md`, `issues-audit.md` and `agent-audit.md`.

**The lens:** adoption is the only thing that separates a good tracker from a bad one. Baseline should be an extension of the workflow people already have, nothing more. Every finding below is judged by one question: does this make a person do tracker work, or does the tracker do the work for them?

---

## 0. The six themes

1. **Baseline only tracks work a human already filed.** The agent loop (start, progress, finish) is good, but it needs an issue key. Without one, nothing gets tracked: the MCP has no create tool, the search defaults to "my issues", and the agent guide says to *ask*. This is the biggest gap between the thesis and the product.
2. **Defaults are tuned to match Linear, not for a 5-person team.** Auto-assign, assign-on-start, parent auto-close, GitHub, triage and the In Review state are all off or missing by default. Each one turns a side effect back into a chore. Two agent tools fail outright on a default team.
3. **The first five minutes are wasted for every role.**
   - The owner's onboarding ends silently after creating a team, and never asks them to invite anyone.
   - Invitees retype their own email, then land on an empty Inbox.
   - An engineer needs 9 steps to connect their agent.
4. **Permissions say "no" without saying "who".** There is no team lead. A member can create a team and then can't rename it. About 20 of the settings pages a member sees are greyed out, each with "Only admins can change this" and no name.
5. **The inbox is an event log, not a to-do list.**
   - It shows 3 rows per agent run.
   - The agent acting for you notifies you about itself.
   - One @mention subscribes someone for good.
   - Opening the inbox marks the top row as read.
6. **Feature weight.** SLAs, cycles, estimates, initiatives, loops, milestones, 14 display properties and 27 settings pages are all visible on day one. They were copied for parity with Linear (JOURNEYS.md maps Baseline against Linear row by row) and they bury the 4 things a small team needs.

---

## 1. Ranked friction list (blockers and high)

| # | Sev | Flow | Finding | Proposed change |
|---|---|---|---|---|
| 1 | **Critical** | Agent setup | A teammate's agent can end up on a fake workspace. The committed `.mcp.json` runs `baseline mcp`. On a machine without `baseline login`, that silently creates `~/.baseline/baseline.db` **seeded with sample issues**, and the agent works on fake CORE-1… issues. | `mcp`/`agent` never create or seed a database. Return an error: "Not connected: run `baseline login --server …`". |
| 2 | **Blocker** | Issue status | `finish_issue in_review` changes nothing. No team has an "In Review" state unless GitHub is enabled. The status stays In Progress and **the human gets no notification**; only the agent sees the warning. | Put In Review in every default workflow. On finish, send a priority "Ready for your review" notification to the person the agent works for. |
| 3 | **Blocker** | Onboarding (hosted) | Onboarding has no invite step and stops after 3 of its 5 dots. `onboarding: 'pending'` is only set by `seed.ts`, so a hosted owner falls into an empty Inbox. | A hosted flow whose finish line is a teammate joining: team → invite (one link) → GitHub → first issue. |
| 4 | **Blocker** | Team member | A member can create a team, then gets a 403 trying to rename, delete or configure it. | Whoever creates a team is its lead. |
| 5 | High | Agent | No `create_issue` or `create_sub_issues` tool. `list_issues` with a query still filters to "me", so an unassigned matching issue is invisible. The guide says "ask whether to track". | Track, then tell. Add the create tools. Search the whole team by default. |
| 6 | High | Agent | `file_followup` errors on any team with triage off, and triage is off by default. | Fall back to Backlog with an agent-filed marker, or turn triage on by default. |
| 7 | High | Agent setup | The guide tells agents to pass `--as "Claude Code"/Codex/pi`, but those users don't exist, so the first CLI write fails. | Create an agent user per harness ("Claude Code via Parth"), or drop the advice. |
| 8 | High | Agent setup | 9 steps to connect: clone, build, pack, install globally, sign in, login, a second key + env vars for `--remote`, connect, approve. The tool isn't on npm. | npm + `npx`. Three steps: install, `login`, `connect`. Stdio after `login` is the default; `--remote` only for cloud agents. |
| 9 | High | Agent setup | Write tools prompt for permission on every call. The allow-list goes in a gitignored file, so teammates don't get it. | Allow-list the reversible writes in the committed `.claude/settings.json`. |
| 10 | High | GitHub | **Any commit on the default branch with the key in its title closes the issue**, for example "CORE-6: wip, not done". "does not fix CORE-12" counts as closing. | A bare key in a commit counts as a reference, not a close. Closing needs a magic word or a PR merge. |
| 11 | High | GitHub | A commit on a key-bearing branch whose message lacks the key links to nothing. Branches that agents name themselves never link. | Use the branch for commits too. `start_issue` checks out or returns the key branch. |
| 12 | High | GitHub (hosted) | Pull requests can't be matched to people. Nobody is asked for a GitHub username, and the hosted Members page has no field for it, although the GitHub page says to set it there. | Ask on invite accept. Admins can edit it. Suggest matches from PR authors. |
| 13 | High | GitHub (admin) | The GitHub page asks the admin to choose an architecture (token vs webhook, 5 permissions set by hand, a separate toggle) before showing any payoff. | One path: paste a token, pick repos, then show "23 PRs, 9 linked, 3 people matched". Webhooks offered later as an upgrade. |
| 14 | High | Invites | Without SMTP, every invite is a per-email link copied by hand: 8 people means 7 DMs. Approved domains only work with Google sign-in. | One revocable team join link, plus "copy all". |
| 15 | High | First run | Invitees land on an empty Inbox: no welcome, no "you're on Engineering", no pointer to work. | Land them on their team's active issues, say who added them, ask for their GitHub username. |
| 16 | High | Permissions | No team lead role. Statuses, triage, templates, estimates and the team name all need a workspace admin. | Workspace admin / team lead (creator by default) / member. |
| 17 | High | Permissions | Locked pages are dead ends: about 20 greyed-out pages that name no admin and offer no way to ask. | Hide what members can't use. Every lock says "Ask Parth" with a one-click request to that admin's inbox. |
| 18 | High | Issue create | A new issue is unassigned. The issue you just filed doesn't show in My issues › Assigned. | Auto-assign the creator by default on small teams. |
| 19 | High | Issue create | Every bug shows an orange "Needs a location", an agent concept, in its rail. | Show it only when someone hands the issue to an agent. |
| 20 | High | Sub-issues | ⌘⇧O and the sub-issues card "+" create children with different defaults (the card inherits priority and assignee, ⌘⇧O doesn't). The inline composer can also create duplicates. | One path, one set of defaults, and the same double-submit guard as the main modal. |
| 21 | High | Inbox | Opening the inbox auto-selects the newest unread row and marks it read after 900 ms. | Don't auto-mark a row that was auto-selected. |
| 22 | High | Inbox | Rows merge only when issue and kind are the same, so one agent run gives 3 rows. The agent acting for you notifies you about its own moves. | One row per issue showing the latest headline. Treat "Agent via X" as X, except for finish and blocked. |
| 23 | High | Comments | One @mention subscribes the person for good, so they get status changes forever. | A mention notifies once; it subscribes only if they reply. |
| 24 | High | Status | GitHub automation is off by default. Even when on, "review requested" maps to nothing if there's no review state. | Turn PR automations on when a repo is linked; ship In Review. |
| 25 | High | Home | There is no morning view for an individual contributor. Home is the noisy inbox; My issues includes Done and Canceled. | "My work": In Progress, then Todo, then waiting on me (reviews, mentions), on one screen. |

---

## 2. Flow by flow

### 2.1 Workspace admin: from server running to a team working
Observed step count: about **25 admin actions, 9 decisions and 7 links sent by hand. That is 30–45 minutes of admin time spread over a day.**

1. Setup token from the server log, then a 5-field form. The page is dark; onboarding then switches to light and asks for a theme, a decision nobody needs to make now.
2. Name the team. The key is cut to 4 letters (Engineering → ENGI, General → GENE), and it appears in every branch and PR forever. The "Agent" user is already listed as a team member.
3. **Dropped into an empty Inbox.** No invite step, and the sample-data and ⌘K steps never appear.
4. Finding Members: Settings opens on *Workspace*; Members is item 3 in the last group of a 25-item nav.
5. The invite dialog itself is good (email chips, role, teams). The button says "Send invites" even with email off. The result lists the same links twice and has no "copy all".
6. The admin isn't told when someone joins unless SMTP is set.
7. GitHub: one long page explaining the security model before what you get. The examples use `ENG-42` while the team key is ENGI. PR automations live on a different page (team › Workflows). Turning on GitHub silently adds In Review to every team.
8. Local-mode wording on hosted screens:
   - "2 members in this local workspace", which counts the Agent;
   - `node bin/baseline.js --help`;
   - "only answers this machine";
   - "coming in Phase 2";
   - a "Reset sample workspace" button the server refuses.
9. There are two "Security" pages, and `#/settings/security` opens the personal one.
10. Missing on day one:
    - import from Linear, Jira or CSV (only JSON or GitHub Issues);
    - bulk invite;
    - pending-invite nudges;
    - an SMTP status line and a test-email button;
    - default labels (Bug / Feature / Improvement);
    - a workspace health panel (GitHub sync, pending invites, people without a GitHub username).

### 2.2 Invited member
1. The invite page reads "Join Baseline. Parth invited ma•••@example.com. Enter that address", so they retype an email the link already holds. It doesn't name the team they're joining.
2. First screen: an empty Inbox plus "Nothing to preview". My issues is empty and points nowhere.
3. Team Home is a directory (resources, avatars, "Go to"), not the team's work.
4. Someone invited with no team gets "Browse teams to join", which works well. But the create modal silently defaults to CORE, so they can file into a team they're not on.
5. Approved-domain joining is silently hidden without Google sign-in. An invalid email (`maya@local`) fails with no reason.

### 2.3 Team member, day to day
- Teams sits under More. The Join/Leave chip is good.
- The team Issues list is the right page, but rows are dense: priority, key, status, sub-issue count, PR icon, SLA chip, avatar, date.
- Cycles shows a burn-up chart and 4 breakdowns, which is heavy for 5 people.
- Triage is off, and the only explanation is "Only admins can turn on triage".
- The team bell has no label.

### 2.4 Team lead and permissions
- There is no team lead. On a team's Members page, "Admin" means workspace admin.
- Contradictions:
  - The Cycles settings page says it's locked, but "Add cycle" works.
  - The team hub says "Cycles: Off" while Cycle 22 is running ("Off" means the auto-schedule).
  - Members can add a label but can't fix a typo in it.
- Members see 27 settings entries, about 20 of them read-only, with nothing marking which.
- **Verdict:** "admins configure, members work" is consistent on the server and hostile in the UI. The proposal is three roles:
  - workspace admin for people, security, data and integrations;
  - team lead (creator by default) for everything about that team;
  - member for everything else, including labels and templates on their teams.

  Below about 10 people, members can invite.

### 2.5 Capturing work
- C → title → ⌘↵ is fast. The issue that results is an orphan: Todo, unassigned, no priority, "Needs a location".
- The modal shows 7 pills. Estimate and Cycle are always visible, so a quick bug comes with decisions nobody asked for.
- Drafts and templates work.

### 2.6 Issue page
- **Best adoption feature in the app:** the timeline attribution ("Agent via Parth changed status…", "GitHub linked PR…", "Automation applied SLA").
- The rail shows 9 properties for a one-line bug, 5 of them empty. Empty optional properties should hide behind "+ Add property".
- A "Finished: ready for review" card can sit next to an In Progress status, and a PR in review can sit next to Todo. The tracker contradicts itself exactly when it matters.
- The agent's progress note is rewritten in place, so after finish the journey is gone. Keep the last progress, collapsed.
- The header icons and the "+" under the description have no labels.

### 2.7 Comments
- Mentions, threads, replies and resolve work. Notifications don't double up (mention > reply > comment).
- Editing a comment to add a mention notifies nobody.
- The CLI prints raw `@[Name](user:u_…)`.
- Inbox previews show raw markdown (`**Progress** **Did:**`).

### 2.8 Status upkeep: what moves by itself today
| Transition | Automatic? | On by default? |
|---|---|---|
| → In Progress on Copy branch / Copy as prompt | yes | **on** |
| → In Progress on agent `start_issue` | yes | on |
| → Done on agent `finish done` | yes | on |
| → In Review on agent `finish in_review` | only if an In Review state exists | **no** |
| PR opened / review / merged → In Progress / In Review / Done | yes | **no** (GitHub off; review has no state to move to) |
| Commit with "fixes KEY" on the default branch → Done | yes (and too eager: a bare key closes) | GitHub off |
| Parent → Done when all sub-issues are done | yes | **off** |
| Manual start → assigned to me | yes | **off** |
| Human starts work without git or an agent | **human** | — |
| Review of an agent's work, without GitHub → Done | **human**, and nothing prompts it | — |

On default settings, only three moves happen without someone doing them: In Progress when the branch or prompt is copied, In Progress when an agent starts, and Done when an agent finishes. Everything else is a chore.

### 2.9 Inbox and notifications
After one simulated day there were 19 unread rows; 10 of the 20 rows came from 4 issues. The specific problems:
- Rows merge only when the issue and the kind are the same.
- The agent acting for you notifies you about itself.
- Mentions subscribe for good.
- Status changes can't be muted in the inbox (Settings › Notifications only controls push).
- Project updates arrive both as single rows and as a digest.
- Initiative updates land in an IC's inbox.
- The inbox auto-marks the top row read.

### 2.10 Lists and views
- Team Issues opens on All issues. Board headers read "Todo 7 ▲8": an unlabeled count and an estimate sum.
- Every card ends with "Created Nov 5".
- Defaults should be ID, status, title and assignee; everything else opt-in.
- Filters, saved views and AND/OR filters are fine to keep (they're opt-in, so they add no load).

### 2.11 GitHub, from the engineer's side
What works:
- A key in the branch or PR title links the PR.
- Magic words parse well (`Fixes CORE-1, CORE-2 and refs CORE-5`).
- `[CORE-NEW]` in a PR title files an issue.
- An unassigned issue is assigned to the PR author, when their GitHub username is set.
- Status only moves forward, and every move is logged and undoable.

What doesn't work:
- A bare key in a commit closes the issue.
- The branch name is ignored for commits.
- Branches named by agents never link.
- GitHub is off by default.
- There's no GitHub App flow.
- A PR on an agent's branch isn't added to the agent's work thread.
- `CORE-NEW` appears in no agent instructions.

### 2.12 CLI, MCP and agents
**Architecture today:**
- One CLI with two targets: a local SQLite file, or a remote server through the REST API with `login`.
- `baseline mcp` serves over stdio; a hosted server also serves `/mcp` over HTTP with a bearer key.
- 8 tools are generated from one `OPERATIONS` list. The same list generates the CLI commands, the CLAUDE.md block and the skill text, so they can't drift.
- Writes show as "Agent via <person>". Every write returns an `op_id` for undo, and undo refuses if a person changed the field since.
- Each agent keeps one progress note per issue, rewritten in place.

**What's built from TEAM_PLAN Phase 2:** API keys on hosted, CLI over HTTP, `login`, attribution, and work threads (a lighter form of sessions).

**What's not built:** delegates, agent sessions and activities, runners, elicitations, plans, and "Open in Claude Code" on a hosted server (it returns 403).

**Tool notes:**

| Tool | Notes |
|---|---|
| `post_progress` | The best tool: one note, merged in place, links attached once. |
| `undo` | Solid. Receipts tell MCP clients to use the CLI to undo instead of the tool. |
| `start_issue` | Moves someone else's issue with only a warning. Doesn't check out the branch. Repeats a ~500-token brief on every call. |
| `get_issue` | Its text output drops sub-issues, links and blockers. |
| `draft_project_update` | Keys only, no titles. |

**Incidental CLI problems:**
- The skill hard-codes `/Users/parthbatra/sideones/baseline`, which no longer exists.
- In remote mode, ported-not-yet commands tell members to "Pass --db".
- No `baseline doctor`.
- `--json` is missing on `team list`.
- Remote MCP has no session key, so two cloud agents share one note.

---

## 3. Feature weight

**Hidden by default; a team turns each on in Settings › Features:**
- estimates (pill, rail, ▲ sums);
- cycles;
- SLAs;
- milestones;
- initiatives;
- the project-update cadence and digests;
- loops;
- recurring issues;
- priority inbox and Focus grouping;
- customize sidebar;
- 10 of the 14 display properties.

**Cut or demote:**
- the separate initiatives layer;
- named project statuses;
- board swimlanes with estimate sums;
- sidebar badge styles;
- natural-language snooze.

**Keep and promote:**
- the timeline with "Agent via X";
- start-on-branch-copy;
- the agent start/progress/finish loop;
- ⌘Z everywhere;
- triage for work agents file.

---

## 4. Incidental bugs found
- `POST /api/cycles` without `number` returns a 500 (no input check).
- The sub-issue inline composer can create duplicates on a double Enter (no `guard()`).
- The invite API returns `{"status":"invalid"}` with no reason.
- Opening an invite link while signed in as someone else silently drops you into your own inbox.
- The verify-baseline skill says the seed has a "Claude Code" agent user; it doesn't.
- The connect fallback `claude mcp add … mcp` drops `BASELINE_DB`.

---

## 5. Brainstorm seeds (strawman, to argue with)

### 5.1 The core loop, in one sentence
**You say what you're doing (to your agent, your terminal, or git), and Baseline writes it down. You open Baseline only to decide (triage, review, priority) or to look (what's going on).**

That gives three surfaces, each with one job:
- **Agent / CLI (write path):** issues are created, started, updated, split and finished as a side effect of doing the work.
- **Git (truth path):** branches, PRs and merges move status. No human drags a card to Done.
- **Web (decide-and-look path):**
  - "My work": what's mine, what's waiting on me;
  - triage: decide on what agents and others filed;
  - review queue: agent finished, PR waiting;
  - a team view.

  Everything else is opt-in.

### 5.2 The MCP integration (proposed)
1. **Setup in 3 steps:** `npm i -g baseline` (or `npx`), `baseline login`, `baseline connect claude` once per repo, committed. After that, a teammate who clones the repo is prompted to log in, never silently given a fake workspace.
2. **Hooks rather than CLAUDE.md text:**
   - a SessionStart hook injects "you're on branch `core-12-…` → CORE-12 'Fix login redirect' (In Progress, yours)", or "your open issues in this repo";
   - a Stop hook nudges `post_progress`/`finish_issue` when there are new commits.
3. **Track, then tell:** with no key, the agent searches the team. On a match it starts that issue; with no match it creates one ("Agent via you", started, assigned to you) and reports it in one line, with undo.
4. **The branch is the binding:** `start_issue` checks out the key-bearing branch, and from then on everything can infer the issue from the branch: tools, hooks, commits, PRs.
5. **New tools for the questions people actually open a tracker for:** `create_issue`, `create_sub_issues`, `next_issue` ("what should I work on?"), `my_activity(since)` (the standup).
6. **Defaults that close the loop:** In Review exists; finishing work sends a "Ready for your review" notification; follow-ups always land somewhere; one agent user per tool ("Claude Code via Parth").

### 5.3 Decisions (2026-11-09)
1. The agent proactively drafts new issues and **asks before creating them**. It creates sub-issues of the issue it is working on without asking.
2. Engineering first. The whole engineering team has Claude Max, so Claude Code is the main surface.
3. GitHub is highly recommended, not required.
4. Core features must work well. Niche features go. Linear parity is not a goal in itself.
5. Home is "My work", across every team the person is on.
6. No runners or delegation for now. A local `baseline work KEY` command (start the issue, check out the branch, open Claude Code) replaces hosted "Open in Claude Code".
7. GitHub access is strictly read-only. Baseline never writes to GitHub.

### 5.4 The questions as first asked
1. Should the agent create issues without asking? (My view: yes, because undo exists. The risk is noise; dedupe and the triage lane are the guardrails.)
2. Does a non-engineer (PM, designer, founder) get the same "extension of workflow" story? Through what: Claude desktop over remote MCP, Slack, email?
3. Is GitHub required or optional? If git is the truth path, should onboarding refuse to finish without a linked repo?
4. How much of the Linear-parity surface do we hide or cut? Is parity still a goal at all?
5. Is the web app's home "My work", or the team board?
6. Runners and delegation (TEAM_PLAN Phase 2): build them, or does "your own agent in your own terminal, reporting in" already cover it?
7. Should Baseline write back to GitHub (a linkback comment on the PR)? It's declined today. It's the main adoption surface for reviewers who never open Baseline.

# Baseline Roadmap — exhaustive Linear experience audit (Aug 29, 2026)

Source: live, hands-on session in the logged-in Linear workspace `parthline` (Chrome, dark theme) on 2026-08-29. I drove Linear end-to-end as "a solo founder running product + side projects with coding agents": enabled cycles/estimates/triage, customized statuses, created labels, 9 new issues + 2 sub-issues (PAR-10…PAR-19), 1 project + milestone, 1 saved view, 1 initiative, and walked every settings surface. The workspace keeps that demo data — extend it, don't re-create it.

Companion docs: `FEATURES.md` (what Baseline already ships, ✅/🟡/⬜) and `DESIGN.md`. This file is the **build list for the next few months**, ordered by priority. Every item says: what Linear does (the experience), why it matters for your profile (solo founder + AI coding agents), and how to build it in Baseline's stack (SQLite + REST + CLI + MCP + vanilla web UI).

Priority marks: **P0** = do next (high leverage, small), **P1** = next 1–2 months, **P2** = later / differentiating bets, **SKIP** = deliberately not building (see §9).

> **Rescope v2 (Aug 29, 2026, per Parth).** Two decisions re-order everything below; **§12 is the canonical build order** where it conflicts with section-level marks:
> 1. **Single-user.** Baseline is a personal tracker. Deferred until there's a second human: subscribers + subscription-based inbox routing (§2.1), the Subscribed tab (§6.4), member roles/invites, update broadcasts to subscribers. The inbox stays, but as a solo "what moved + what my agents did" feed.
> 2. **PM tool first, agent-CLI handoff second — no agent chat.** No Linear Agent home/chat, no Loops, no Triage Intelligence, no service-side AI (§1.3.3–4, §1.4 stay SKIP). The entire agent story is one loop: human picks an issue → **Copy as prompt** → paste into any coding CLI → the agent reports back through the existing MCP/CLI (comments, status flips, sub-issue updates). §1.3 narrows to *agent as an actor* only (identity rows, assignable, activity badge, filter) — that's the return path, not a chat product.

---

## 1. The agent hand-off layer (Linear's biggest 2025–26 push — and our home turf)

This is where Linear is investing and where Baseline's MCP/CLI-first design should beat it.

### 1.1 "Work on issue" hand-off palette — **P0**
- **Linear:** every issue header has a **Work on issue** button. It opens a command palette: *Copy as prompt*, *Configure coding tools…*, plus (once tools are enabled) direct hand-off. "Copy as prompt" puts a structured "Work on Linear issue PAR-10: …" prompt (title, description, branch suggestion) on the clipboard for pasting into any agent.
- **Why:** your whole workflow is ZCode/Claude agents picking up tasks. Today in Baseline an agent must go through MCP; a human-approved "hand this to the agent" step is missing.
- **Build:** add `POST /api/issues/:id/handoff` returning `{prompt, branchName}` (prompt template below, branch = `<team-key>-<key>-<slug>`); add a header button + palette entry "Copy as prompt"; CLI: `baseline issue handoff PAR-10 --copy`. ~1 day.

### 1.2 Coding-tools registry + prompt template — **P0**
- **Linear:** Settings → Code & reviews → *Coding tools* lists 18 hand-off targets (Amp, Claude Code, Claude Code desktop, Codex CLI, Codex desktop, Conductor, Cursor, Devin, Factory, GitHub Copilot, Lovable, Netlify Agent Runners, OpenCode, Replit, v0, Warp, Zed) + **Custom script**, **Custom link**, and a globally editable **Prompt template** with `{{issue.identifier}}`-style variables. "Opens in your terminal. Requires the Linear desktop app."
- **Build:** `coding_tools` table (name, kind: prompt|script|link, enabled, command_template); render the same palette from §1.1 with enabled tools; store the prompt template in workspace settings with `{{issue.key}} {{issue.title}} {{issue.description}} {{branch}}` vars. Ship 3 presets (clipboard, Ghostty script, custom link). This is small and is *the* demo feature for an agent-native tracker.

### 1.3 Agent as a first-class actor — **P1**
- **Linear:** the sidebar's #3 item is **Agent** (an AI chat, and the *default home view* — Preferences → "Default home view: Linear Agent (default)"). Agents appear in **assignee pickers**, as **filters** ("Agent", "Agent Session"), and post activity/comments into issues. There are **Agent skills** and **Team agents** settings pages, **Loops** ("Automations have been renamed to Loops" — recurring agent automations acting on triage), and **Triage Intelligence** (agentic duplicate/related-issue detection on new issues).
- **Build (phased):**
  1. Agent actor: `users.kind = 'agent'` rows (e.g. "ZCode", "Claude") that can be assignees and comment authors; already half-modeled via MCP identity. Agent filter = assignee filter by kind. (P1)
  2. Agent activity rendering: activity events authored by agents get a distinct icon/badge. (P1)
  3. Agent home/chat is SKIP for now (§9) — but steal the *positioning*: make **My issues** the default home, not last-page (P2 preference).
  4. Loops/Triage Intelligence = SKIP (needs LLM service); note as future paid-tier ideas.

### 1.4 AI assist surfaces worth copying cheaply — **P1**
- **"Ask Linear" Tab hint inside ⌘K** — palette input that falls through to AI search.
- **AI filter** in filter menus ("show bugs from last week assigned to me" → parsed into the filter grammar).
- **Quick-suggestion label chips** in the create modal (Linear matched my "…agent…" title to the Agent label instantly). Baseline already has keyword-suggestion chips ✅ — extend match list to labels + projects, and add "suggested" chips on issue detail too.
- **Build:** palette gets a "Ask Baseline" row only when an MCP-connected agent CLI is detected (`which zcode` / configured command); keep it a hand-off, not a service. AI *filter* = parse text → existing filter grammar via the local agent; ship as an experimental palette command, not inline UI.

---

## 2. Issue model upgrades

### 2.1 Subscribers + notification routing — **P0**
- **Linear:** every issue has **Unsubscribe from issue** and **Change subscribers**; My Issues has an **Subscribed** tab; inbox volume is governed by subscription, not just assignment.
- **Build:** `issue_subscribers(issue_id, user_id)`; notifications generated for: assignment, comment by others, **subscription events** (status/priority/due changes on issues you subscribe to — but not your own edits); unsubscribe state per user+issue. Inbox rows already exist; add the subscription event type. ~2–3 days. Unlocks the solo "watch everything I care about" flow without assigning everything to yourself.

### 2.2 Reactions on the issue description — **P1**
- **Linear:** description block has its own **Add reaction** (plus comment reactions ✅ already in Baseline).
- **Build:** reactions table is already polymorphic-friendly — add `target: 'description'` rows. Trivial.

### 2.3 Detailed issue history — **P1**
- **Linear:** team setting **"Enable detailed issue history"** ("each change to an issue receives and persists a distinct history entry"). Off by default (storage).
- **Build:** Baseline's activity feed already records events ✅; add `issue_history` table recording *every* field transition with old→new values, behind a workspace setting; surface in a "History" tab in the side panel. For a founder debugging "who changed what when", this is worth it even solo.

### 2.4 Estimates: configurable scale — **P1**
- **Linear:** team General → Issue estimation: **Not in use / Exponential (1,2,4,8,16) / Fibonacci (1,2,3,5,8) / Linear (1..5) / T-Shirt (XS–XL)** + three extra toggles: *Allow zero estimates*, *Extended estimate scale*, *Count unestimated issues* (for capacity math). Changing the scale is admin-gated.
- **Build:** Baseline hardcodes 0/1/2/3/5/8/13/21 ✅. Add `estimate_scales` workspace setting (JSON: name + points array), per-team override, and the "count unestimated" flag consumed by cycle capacity (§4.2). Display labels for T-Shirt sizes.

### 2.5 Recurring issues — **P1**
- **Linear:** per-team **Recurring issues** settings: templates that re-create an issue on a schedule (weekly standup prep, weekly release checklist…).
- **Build:** `recurring_issues(template, cron/cadence, next_run, team)` + a check on server start (or lazily on first API hit of a new day) that materializes due instances. Perfect for a solo founder's weekly review ritual — pairs with the weekly project update habit (§5.3).

### 2.6 Smaller issue-model parity items — **P0/P1**
- **Relations filter** ("Relations" is a filter dimension in Linear; e.g. "show all blocked issues") — **P0**: add `has:blocks|blocked-by` to filter grammar + a "Blocked" smart view.
- **Copy branch name** — **P0** (see 1.1; also add a row in the issue context menu like Linear's copy URL/ID/branch stack).
- **Issue templates** per team with template picker in create modal + `template` filter — **P1** (Linear also templates *projects* and *project updates*; see §5).
- **Email-to-create** per team ("Create issues by email" toggle, team address) — **P2** (needs inbound mail; alternative: keep CLI/MCP as the capture path and SKIP).
- **SLAs** — **SKIP** (support-desk concept).
- **Due-date quick chips**: Linear's calendar popover has Today/Tomorrow/Next week ✅ already in Baseline; add **keyboard `⌥D` set-due** to match Linear's property shortcuts (P1, §8).

---

## 3. Statuses, workflow & automation

### 3.1 Status groups: one more nuance — **P0**
- **Linear:** workflow editor groups are **Triage / Backlog / Unstarted / Started / Completed / Canceled / Duplicate** — *Duplicate is its own type* (not just a relation), *Triage appears only when triage is enabled*, each group can hold multiple named statuses (we added "Blocked" under Started), and default statuses are marked ("Backlog · Default").
- **Build:** Baseline has typed workflow states ✅. Add the `duplicate` type (or map duplicate status ↔ duplicates relation), a per-type default flag, and show "· Default" in settings. ~half a day.

### 3.2 Team workflow automations — **P1**
- **Linear:** team → *Workflows & automations*: **Auto-close parent issues** (when last sub-issue closes), **Auto-close sub-issues** (when parent closes), **Auto-close stale issues** (after N months → status Canceled), **Auto-archive closed items** (issues, cycles, projects after N months), **"When progressing status, place issues First/Last"** (ordering rule), and PR automations via GitHub/GitLab connect.
- **Build:** these are pure server-side rules — perfect for Baseline:
  - `team_automations` JSON column: `{closeParentOnSubDone, closeSubsOnParentDone, closeStaleAfterMonths, archiveClosedAfterMonths, moveToPositionOnProgress: 'first'|'last'}`.
  - Implement close-parent/close-subs at write time (in the API layer where status changes already funnel); stale/archive as a lazy sweep on first request per day (same pattern as recurring issues). The "place first/last" rule slots into the existing sortOrder midpoint logic. ~3–4 days total. High perceived value, zero UI beyond toggles in team settings.

### 3.3 Auto-assign preference — **P1**
- **Linear:** personal Preferences → "Auto-assign to self / On move to started status, assign to yourself."
- **Build:** one user-preference flag applied in the status-change path. Pairs with the solo workflow: drag something into In Progress → it's yours.

### 3.4 Triage (per team) — **P1**
- **Linear:** *Enable triage* per team → new **Triage** status group + sidebar **Triage** view (split-pane peek list). Options: *Require explicit prioritization* (can't leave triage without priority), **Triage responsibility** routing (Business-gated — SKIP), **Loops** acting on triage (SKIP), **Triage Intelligence** (SKIP).
- **Build:** for a solo founder triage = "agent-created / quick-capture issues land here until I've looked". Add triage status type + sidebar view (reuse Active-view component with the triage filter) + the explicit-priority gate. ~1–2 days. Make **MCP `issue create` default new agent issues into Triage** when the flag is on — that's the real win: agent noise gets one review funnel.

---

## 4. Cycles: from CRUD to a planning instrument

Baseline ships cycle CRUD ✅; Linear makes cycles *the* weekly operating rhythm. Build these in order:

### 4.1 Auto-created cycles + schedule — **P0**
- **Linear:** enabling cycles auto-creates the next **2 cycles** from settings: **Cycle duration** (1/2/3/4 weeks), **Cooldown** (0/1/2 weeks between cycles for slack), **Cycle start** (fixed date → auto-rolls), timezone-aware ("Used for team schedules, dates, and cycle start times").
- **Build:** cycle generator in the API layer: given duration/cooldown/start-anchor, ensure cycles exist through `now + 2 durations`. Runs lazily. ~1 day.

### 4.2 Capacity, scope and stats — **P0**
- **Linear:** cycle header + detail rail: **Capacity %** (Σ estimates of member(s) vs. their per-cycle capacity), **Scope** (Σ estimates incl. added-late work), **Days to start / remaining**; cycle detail has a breadcrumb **cycle switcher (⌄)** and is favorite-able; empty state = illustration + video + "Create new issue (C)".
- **Build:** capacity math = Σ estimates of issues in cycle ÷ (members × weekly points setting); scope = same Σ; days-to-start/remaining from dates. Render in the existing cycle card + a stats strip on the cycle page. ~2 days. This is the number a solo founder actually glances at ("am I overloading my week?").

### 4.3 Cycle automation toggles — **P0**
- **Linear:** *Auto-add started issues* (to current, else next), *Auto-add completed issues*, *Auto-add active issues & issues with due dates within the cycle window*. Plus Linear's classic (not seen in the free-tier UI but standard): carryover ("include issues not completed") and auto-remove unfinished — treat as P2.
- **Build:** on status→started transition, attach to current-or-next cycle if unassigned (toggle per team, default ON — this single rule makes cycles self-maintaining). ~half a day. (Observed live: moving PAR-10 to In Progress did *not* auto-add because no cycle was "current" yet — the rule keys off the current cycle existing, so with 4.1 in place it works.)

### 4.4 Cycle page polish — **P1**
- Progress bar + sparkline of completed-vs-scope over the cycle window (Baseline's cycle page already lists issues ✅). Keep the chart tiny (canvas, ~80px) — don't rebuild Linear's analytics suite (see SKIP). Team settings: which day cycles start (Monday default; remember user preference: Monday, IST timezone).

---

## 5. Projects, initiatives & updates

### 5.1 Project model gaps — **P0**
- **Linear project =** status (Backlog / Planned / In Progress / Paused / Done / Canceled — *Paused* missing in Baseline), **health** (On track / At risk / Off track — derived-or-set), **lead** + **members**, start/target dates (start auto-fills with creation date — do the same), progress % (from issues), **labels (separate namespace)**, **dependencies** ("Add dependency" — project-level blocks), **Resources** (attach docs/links), **Slack channel** binding (SKIP Slack; repurpose as "webhook channel"), **Overview / Activity / Issues tabs** (Baseline has overview+issues ✅; add Activity tab = project-scoped activity feed), per-project **saved views** in the Issues tab ("Add new view"), and the **"No updates. Click to write update."** nudge right in the projects list row.
- **Build order:** Paused status + start-date default + Activity tab + row-level update nudge (P0, ~2 days) → project labels namespace + dependencies table (P1) → resources (P2; documents first, §5.4).

### 5.2 Project health hygiene — **P1**
- **Linear:** health dot in the projects list (grey "No updates" until an update is written), health set *through updates* (a health-tagged update moves the project's health), ordered by Health in list views.
- **Build:** `projects.health` + rule: latest update's health wins; show dot+tooltip in list; add "stale project" indicator when `updated_at > 14d` and status = In Progress. This is the "is anything quietly dying" glance — exactly what a solo founder needs.

### 5.3 Project & initiative updates with cadence — **P1**
- **Linear:** **Write first project update** composer (health tag + body), updates feed on overview, **subscribers get updates in their inbox**, and in Settings → *Updates*: **Update schedule** ("how often updates are expected; owners receive reminders") + **post updates to Slack channel**. Initiative updates work the same way with an enforced cadence.
- **Build:** updates exist in Baseline ✅. Add: (a) update *schedule* per project (weekly/biweekly/monthly) with a "due for update" badge + sidebar nudge; (b) generate an **inbox notification** to project subscribers on each update; (c) seed the update composer with auto-text: issues completed since last update, current health. ~2–3 days. This turns Baseline into the weekly ritual tool.

### 5.4 Documents — **P1**
- **Linear:** workspace **Documents** (feature toggle) — rich pages creatable standalone or attached to projects/cycles via **Resources → "Add document or link…"**; project description editor is the same component.
- **Build:** Baseline has documents modelled in the DB but no UI (per FEATURES.md gaps). Ship the 80% version: title + markdown body + `parent_project_id`, list under Workspace ▸ Documents, attach from project Resources, render linked docs on project overview. Reuse the issue-description markdown editor. ~3–4 days.

### 5.5 Initiatives — **P1** (workspace feature toggle, *not* plan-gated on our workspace)
- **Linear:** **Initiatives group multiple projects toward one strategic effort**: sidebar section under Workspace, page with **Active / Planned / All** tabs, initiative = icon/name/summary/status/priority/**owner**/target date/labels + **Projects, Health, Active Projects columns** (rollup), initiative **updates with cadence + reminders + Slack broadcast**, and shortcut **N then I**.
- **Build:** `initiatives` + `initiative_projects` tables; rollup = count of child projects + rolled-up progress (weighted by issue counts); status enum (Active/Planned/Done); page = clone of the projects list with different columns; updates reuse 5.3's update engine. ~4–5 days. This completes the hierarchy Issue ▸ Project ▸ Initiative and retires the FEATURES.md "modelled but no UI" gap.

---

## 6. Views & filters (the daily-driver surface)

### 6.1 Saved views as first-class objects — **P0**
- **Linear:** Views page (team + workspace levels) with **Issues / Projects** tabs; a view has an **icon, name, scope (team/workspace), shareable URL** (`/view/all-work-radar-…`), filters + display options, **live preview while editing**, and **Save**/⌥V; any list can be saved as a view (**⌥V** shortcut or the ⌗ icon in the header); favorites any view.
- **Build:** Baseline has saved views ✅ but team-scoped only. Add: workspace scope, icon, slug URL (`/view/<slug>`), **Projects-type views** (view over projects with its own filter vocabulary), and **⌥V "save current list as view"** from any filtered list (pre-fills filters from the URL state). ~2–3 days. Projects-views are the sleeper feature — "all projects targeted this quarter, on track only".

### 6.2 Filter vocabulary — expand to match — **P0/P1**
- **Linear's full filter menu** (verbatim, capture from the Add Filter popover): `AI filter`, `Advanced filter` (boolean groups), `Status`, `Assignee`, `Agent`, `Agent Session`, `Creator`, `Priority`, `Estimate`, `Labels`, `Relations`, `Suggested label`, `Dates`, `Project`, `Project properties`, `Cycle`, `Added to cycle`, `Subscribers`, `Auto-closed`, `Content` (text in title/description), `Links`, `Template`.
- **Build:** Baseline covers status/priority/assignee/label/project/cycle/due ✅. Add in this order: **Creator** and **Content** (P0, trivial), **Relations** (P0, `has:blocks` etc.), **Estimate** (P1), **Subscribers** (P1, with §2.1), **Added to cycle** (P1), **Project properties** (P1: project status/health/target — powerful cross-project view), **Advanced** boolean groups (P2 — parser addition to the filter grammar), **Auto-closed/Template/Agent Session** (P2/SKIP).

### 6.3 Board view nuance — **P1**
- **Linear:** board columns can be hidden; hidden ones collapse into a **"Hidden columns" rail** on the right — drag a card onto a hidden column to move it there. Column headers show WIP-warning icons. (Also observed: the board kept per-column "＋" and counts ✅ parity.)
- **Build:** add the hidden-columns rail to Baseline's board (persist per view). ~1 day. Delightful and cheap.

### 6.4 My Issues tabs — **P0**
- **Linear:** **Assigned / Created / Subscribed / Activity** tabs, each a full filtered list.
- **Build:** "Created" is just a saved-view filter (`creator: me`) — render the four tabs over the shared list component; "Activity" = issues where `activity.actor = me` recently. ~1 day (subscribed depends on §2.1).

---

## 7. Shell, navigation & inbox

### 7.1 Sidebar & favorites — **P0/P1**
- **Linear:** top-level **Inbox / My issues / Agent**; **Workspace** section (Initiatives, Projects, Views, "More"→Members/Teams); **Your teams** with per-team links: **Home / Triage / Issues / Cycles / Upcoming / Projects / Views**; dismissible **"Try"** onboarding hints (Import issues · Invite people · Connect GitHub); **Customize sidebar** (toggle which links appear); favorites for *any* object incl. **cycles pages and issues** (star in every header).
- **Build:** add per-team **Upcoming** link (next-cycle view) and **Triage** (when enabled) — P0, trivial; favorites-for-issues and favorites-for-cycle-pages — P1 (favorites table is already polymorphic ✅); "Customize sidebar" — P2; onboarding "Try" hints — P2 (only if Baseline gets public users).

### 7.2 Team Home page — **P1**
- **Linear:** every team has **Home** (pinned views + your active work + cycle summary). Baseline's team section jumps straight to All issues.
- **Build:** team home = 3 sections: current cycle card (progress + my issues in cycle), "Active" list, pinned views. Cheap composite of existing components.

### 7.3 Inbox upgrades — **P1**
- **Linear:** split-pane with **preview pane** ("No notification selected"), filter + display-options menus, grouped by time ✅ (Baseline has this), mark unread, and (feature-gated) **snooze**.
- **Build:** preview pane = reuse the issue side-peek on inbox selection (P1); mark-unread exists ✅; snooze = `snoozed_until` + lazy re-insert (P2).

### 7.4 Command palette & keyboard — **P0/P1**
- **Linear extra chords confirmed:** `G then T` triage, `G then D` drafts, `G then J` Agent, `Ctrl⇧1-9` jump-to-team, `O then I` open issue, `⌘⇧↑` open parent, `[`/`]` toggle sidebars, `⌥V` save view, `N then I` new initiative, `⌘/` shortcuts panel, `?` = help menu (not the cheatsheet directly — the cheatsheet lives at ⌘/), **"Ask Linear" Tab** in palette, **"Copy as prompt"** in Work-on-issue palette.
- **Build:** add G→T (triage), ⌥V (save view), ⌘/ (existing cheatsheet ✅), and "Copy as prompt" (§1.1) to the palette actions. Keep `?` = cheatsheet (Baseline's choice is honestly better than Linear's indirection). ~half a day each.

### 7.5 Preferences parity — **P2**
Worth stealing (all cheap): **Default home view** selector, **Send comments on Enter/⌘↩**, **first day of week**, **display names (full/first)**, emoticon→emoji conversion, **font size**, separate **light/dark accent themes**, "Open in desktop app" (SKIP), auto-assign-on-start (§3.3).

---

## 8. Admin, data & settings surfaces

- **Workspace settings:** logo (256²), name, URL slug, **fiscal-year start month** ("used when grouping projects and issues quarterly/half-yearly/yearly" — feeds initiative/roadmap grouping; P2), region lock (SKIP).
- **API page + OAuth Applications** — **P1**: Baseline already has REST+MCP ✅; add a **Personal API keys** page (create/revoke/scopes) so external scripts don't reuse the SQLite file path, and document the REST API in-app. Webhooks = P2 (outbound POST on issue/project events; enables the Slack-broadcast story without Slack).
- **Members page** — exists ✅ (with "set as me"); Linear adds roles/invites — SKIP beyond what's there until multi-user matters.
- **Import & export** — export/import JSON ✅. Linear also has **migrators** (Jira/Shortcut/…) and CSV — P2: a CSV import wizard would be the first real one to add if anyone ever migrates *to* Baseline.
- **Trash/archive browsing** — Linear auto-archives closed work after N months (§3.2); paired with a **"Archive" browsable filter** (`archived: true`) rather than a separate trash page — P1, resolves the FEATURES.md trash-bin gap the Linear way.
- **Labels** — Linear: workspace + per-team scopes, **groups**, **rules** ("auto-apply when…"), per-label descriptions, usage counts, "Last applied". Baseline ✅ mostly; add label **groups** (P2) and skip rules (automations cover it).

---

## 9. Deliberately NOT building (scope discipline)

Learned from walking every settings page — these are Linear's org-scale features that would be dead weight for a solo-founder tracker:
- **SLAs**, **Customer requests** (VoC intake), **Releases** (version/release management), **Pulse** (team sentiment), **Asks** (Linear's Slack intake bot), **custom Emojis**, **Figma/GitLab/Loom/etc. connectors** (GitHub PR-linking stays as the one integration, P2), **Triage responsibility routing**, **Loops / Triage Intelligence / Agent chat home** (service-dependent AI), **welcome messages / Enterprise onboarding**, **region/data-residency**, **billing & usage pages**, **SSO/SCIM/security-compliance surfaces**, **multi-workspace switching**, **desktop app**, ** Slack notifications broadcasts** (replaced by webhooks + inbox).
- Revisit only when Baseline gets its first external users.

---

## 10. Micro-UX details worth copying verbatim

Small things that made Linear feel finished — each ≤ a few hours in Baseline:
1. Menus print their own shortcuts inline (`Settings · G then S`).
2. Toasts after create with a **View issue** link; undo toasts for destructive ops ✅ already.
3. Create modal: **Tab** walks title → description → property pills; **⌘⏎** creates from anywhere in the modal (Baseline ✅) — but Linear *keeps focus in description*, so Enter moves fields instead of submitting (Baseline's Enter-to-submit is actually safer; keep it).
4. Inline editors: **Enter commits, Esc cancels** (label rows), while richer editors show explicit Cancel/Create buttons (statuses, sub-issues, milestones). Be consistent per context.
5. Sub-issue inline composer **inherits parent priority** and sits inline under the sub-issues card with a live `0/2` progress counter.
6. Group headers on lists: count + `＋` (create with that state) + `⋯` + collapse, and a **focus funnel** button. Baseline ✅ mostly; add the funnel.
7. Breadcrumbs contain **switchers** (Cycle 1 ⌄, project ⌄) — jump between sibling cycles/projects without leaving the page.
8. Copy-icon stack in issue header: URL / ID / **branch name**.
9. Empty states: mono illustration + one-line explainer + primary action (+ **video thumbnail for complex features** like cycles).
10. "No updates. Click to write update." — call-to-action *in place of* empty data, in the row itself.
11. Favorites star in **every** header (issues, views, projects, cycles, initiatives).
12. Bell icon in headers = subscribe (when §2.1 lands).
13. Property rows are click-to-edit **everywhere** — no settings detour, ever.
14. The board's **hidden-columns rail** (§6.3).
15. Keyboard-first everything; but every affordance also exists as a visible control (discoverability duality).

---

## 11. Performance observations (live)

- Linear's SPA **crashed the Chrome renderer 4× in ~40 min** ("Aw, Snap", error 5, renderer at ~1.2 GB) on this machine while other apps were open; each crash lost in-progress composer text. Local-first Baseline (SQLite + small DOM) should never do this — keep list virtualization, avoid mega-trees in memory, and *preserve composer drafts* (Baseline already drafts create-modals ✅; do the same for comments/updates).
- Linear's settings pages are heavy for what they are; Baseline's flat settings layout is fine.

---

## 12. Build order — re-scoped phases (v2, single-user + agent-CLI handoff)

### Phase 1 — The hand-off loop (the daily driver; ~1 week)
The whole product story: pick an issue → paste a rich prompt into any coding CLI → agent reports back via MCP/CLI.
1. **Copy-as-prompt hand-off** (§1.1): `POST /api/issues/:id/handoff` → `{prompt, branchName}`; header button + palette action; CLI `baseline issue handoff PAR-10 --copy`.
2. **Prompt template + branch convention** (§1.2): workspace-level editable template with `{{issue.key}} {{issue.title}} {{issue.description}} {{branch}}` vars; branch = `<key>-<slug>`; copy-branch row in the issue context menu (§2.6).
3. **Coding-tools presets** (§1.2): clipboard preset always; optional custom script/link tools (Ghostty, terminal launchers). No daemon, no integrations.
4. **Issue templates** (§2.6, promoted): per-team templates + picker in create modal — hand-off prompts are only as good as the issue body; templates make them consistently rich.
5. **Agent as an actor, slim** (§1.3.1–2): `users.kind='agent'` rows (e.g. "ZCode") assignable + able to comment/flip status via the existing MCP server; distinct activity badge; `assignee kind` filter. Hand-off state becomes visible: issue assigned to an agent = handed off.
6. **Close the loop in the skill** (§7/§8, promoted): document the end-to-end recipe in `skills/baseline/SKILL.md` — take issue → work → post progress comment → mark In Progress/Done via MCP — so any agent that can paste a prompt can also report back with zero new infrastructure.

### Phase 2 — Cycles + views: the weekly rhythm (~1–2 weeks)
What makes Baseline the place you plan the week, not just a list.
1. Cycle auto-create from duration/cooldown/start-anchor (§4.1).
2. Capacity / scope / days-remaining stats on the cycle page (§4.2) — the "am I overloading my week?" glance.
3. Started-issues auto-join current-or-next cycle (§4.3) — makes cycles self-maintaining.
4. Workspace-scoped saved views + slug URLs + **⌥V save-from-any-list** (§6.1).
5. My Issues tabs: **Assigned / Created / Activity** (Subscribed dropped by rescope) (§6.4).
6. Relations filter `has:blocks|blocked-by` + **Blocked smart view** (§2.6) — tells you (and the agent) what's actually parallelizable.
7. Creator + Content filters (§6.2, trivial).

### Phase 3 — Self-maintaining hygiene + the agent audit trail (~2 weeks)
Bookkeeping a solo founder shouldn't do by hand, plus a record of what agents changed.
1. Team automations (§3.2): auto-close parent↔sub-issues, auto-assign-on-start (§3.3), stale sweep, auto-archive + browsable `archived:` filter (§8).
2. Duplicate status type + per-type default flags (§3.1).
3. **Detailed issue history (§2.3, promoted)** — reframed as the **agent audit log**: every field transition old→new, so you can review exactly what an agent changed while you were away.
4. Triage-lite (§3.4): triage status + sidebar view, and **MCP `issue create` defaults agent-authored issues into Triage** — one review funnel for agent noise.
5. Project quick wins (§5.1): Paused status, start-date default, project Activity tab, "No updates — click to write" row nudge.

### Phase 4 — Rituals & breadth (good additions)
1. Project update cadence (§5.3): weekly review ritual with auto-text from issues completed since last update (subscriber broadcast dropped).
2. Recurring issues (§2.5): weekly review / release checklists.
3. Team home (§7.2): current-cycle card + active work + pinned views.
4. Polish: board hidden-columns rail (§6.3), inbox preview pane (§7.3), cycle sparkline (§4.4).
5. Documents UI (§5.4).
6. Initiatives (§5.5): "my quarters/goals" rollup across projects — still fits a solo founder, but after the above.
7. Personal API keys page + in-app REST docs (§8).
8. **GitHub PR-linking (§9-adjacent, promoted from SKIP-land):** the one integration worth having — PR open/merge flips linked-issue status; closes the loop when agents open PRs. *(Confirmed in linear.app/docs: "GitHub Automations" — their docs describe exactly this.)*

### Bets & deferred
AI filter via the local agent, webhooks, label groups, CSV import, `linear.new`-style pre-filled capture URL (from their docs), preferences parity (default home view, first-day-of-week, font size), configurable estimate scales (keep hardcoded Fibonacci until it itches).
**Deferred by rescope:** subscribers/subscription routing, Subscribed tab, member roles/invites, all Slack surfaces — revisit only if a second human ever appears.

---

## Appendix A — Demo data created in `parthline` (keep as the living scenario)

- **Team Parth-personal (PAR):** Fibonacci estimates; cycles ON (2-week, cooldown none, next starts Aug 31, auto-create 2, auto-add started/completed ON); triage ON (+ "require explicit prioritization" available); custom status **Blocked** (Started group); labels Bug / Feature / Improvement / **Agent**.
- **Issues:** PAR-10 WAL contention (Urgent, Agent, 8 pts, In Progress, sub-issues PAR-18/19) · PAR-11 retry/backoff · PAR-12 MCP docs · PAR-13 palette perf · PAR-14 launch checklist · PAR-15 GitHub sync spike · PAR-16 inbox snooze · PAR-17 initiative rollup research (+ pre-existing PAR-5…9).
- **Projects:** *Baseline v1.0 Public Launch* (In Progress, milestone **Beta hardening**) and *Agent Integrations*.
- **View:** *All work radar* (`/view/all-work-radar-…`, workspace URL pattern).
- **Initiative:** *H2 2026: Baseline launch readiness* (Active; feature toggle enabled).
- **Cycles:** Cycle 1 (Aug 31→Sep 13, Upcoming), Cycle 2 (Sep 14, Planned).

## Appendix B — Linear settings map (for future reference)

Personal: Preferences · Profile · Notifications · Code & reviews (**Coding tools**) · Security & access · Connected accounts · **Agent personalization**
Issues: Labels · Templates · SLAs — Projects: Labels · Templates · Statuses · Updates
Features: **AI & Agents** · **Initiatives** · **Documents** · Customer requests · Releases · Pulse · Asks · Emojis · Integrations
Administration: Workspace · Teams · Members · Security · API · Applications · Billing · Usage & limits · Import & export
Per-team: General (icon/name/identifier/description/timezone/estimates/email-in/detailed history) · Members · Slack notifications · Issue labels · Templates · **Recurring issues** · Issue statuses · **Workflows & automations** · **Triage** · **Cycles** · Team agents · Agent skills · Project updates · Resolved thread summaries

# Baseline — Feature Spec (defines "done")

Sources: user's reference video (60 frames catalogued, light theme, projects/initiatives promo) + live inspection of the logged-in Linear workspace (dark theme, screenshots in /tmp/linear-ref).

Status marks: ✅ implemented & QA'd in the app · 🟡 partially implemented · ⬜ not built (documented gap).

## 1. App shell
- ✅ Left sidebar (#09090a): workspace switcher (avatar + name + caret) with menu (settings, theme, reset)
- ✅ Nav: Inbox (unread badge), My issues, Favorites section (projects/views/issues, star-synced), Workspace section (Projects, Views), "Your teams" with per-team: Home, All issues, Active, Backlog, Cycles (when the team has cycles)
- ✅ Collapsible team groups (persisted in localStorage); hover reveals +/add buttons
- ✅ Active item bg #232325, rounded 4px, full-width row
- ✅ Main area bg #121213; top bar = breadcrumb (workspace › view / issue), star (favorite), more menu
- ✅ Sub-nav pills row: All issues / Active / Backlog (+ filter count badge); right: Add filter, Display options, side-panel toggle
- ✅ Tab title pattern: "Workspace › View - App"
- ✅ Team rows: Triage (with count, when on), Issues, Cycles, Projects, Views; "…" menu (archive, settings, copy link)
- ✅ Search page (`/`), Trash page, team Archive page; ⌘Z undo for every issue change; `[` toggles the sidebar
- ✅ Team Home (team "…" › Team overview): Overview (icon, name, description, team resources), Documents, Members; right rail with members and Go to links
- ✅ "+" beside Your teams opens Create a new team (name, identifier derived from it)
- ✅ Team sub-items start with Home; Workspace adds Pulse and Customers (when on); Drafts shows when you have drafts
- ✅ Customize sidebar (More › Customize sidebar): badge style (count / dot / none) and per-item Always show / Show when badged / Don't show — hidden items live in More
- ✅ Teams and Members directory pages; Drafts page

## 2. Issues list
- ✅ Grouping: Status (cross-team merge by name), Priority, Assignee, Label, Project, Cycle, None
- ✅ Sub-grouping: Priority or Assignee nested under the primary group
- ✅ Group header row (chevron, icon, name, count) ~36px, sticky; collapse persisted; "+" creates issue with that state preselected; focus-status funnel button
- ✅ Row: hover checkbox, priority icon, key, status icon, title, label pills, project/due chips (optional), assignee avatar, updated date
- ✅ Order within group: priority asc then manual (sortOrder); ordering switchable (priority/updated/created/due/title/manual)
- ✅ Empty state: mono status icons, heading, description, "Create new issue (C)"
- ✅ Display options popover: List/Board, Grouping, Sub-grouping, Ordering, Show empty groups, Display-property toggles (ID/Priority/Assignee/Labels/Project/Due date)
- ✅ Filters: pill bar with dismissible pills (query, status, priority, assignee, label, project); `/` focuses filter; per-view persistence
- ✅ J/K cursor ring with scrollIntoView; X select; Enter opens peek; multi-select bulk bar (status/priority/assignee/archive/delete)
- ✅ Context menu: status/priority/assignee/labels (opens the same menus as detail), copy ID, copy as prompt (agent hand-off brief), open full page, duplicate, archive, delete — all with undo toasts
- ✅ Linear filter menu: Status, Assignee (incl. Me / none), Creator, Priority, Estimate, Labels, Relations, Sub-issues, Due, Created, Updated, Project, Milestone, Cycle, Content — typing searches values across fields, per-value counts; pills are field · operator (is / is not / any of) · values · ×, with Clear and Save-as-view; "N issues hidden by filters"
- ✅ Display options (Linear's popover): Grouping/Columns, Sub-grouping/Rows, Ordering, Order completed by recency, Completed issues window, Show sub-issues, Show triage issues, empty groups, 14 display properties, Reset
- ✅ Every property menu (shortcut, rail, context menu, bulk bar) is the same filterable menu with number keys, acting on one issue or the selection
- ✅ Right-click menu with property flyouts, Create related, Mark as (parent/sub-issue/related/blocked/blocking/duplicate), Copy ▸, Favorite, Subscribe, Remind me, Delete
- ✅ Space peeks the hovered/cursor row; ⌘-click / ⇧-click select; ⌘A selects all; ⌘B flips list ↔ board
- ✅ Advanced filters: nested AND / OR groups of conditions next to the simple pills, saved with views

## 3. Create issue modal (C)
- ✅ Centered modal (#1a1a1b, radius 14, shadow), header: [team switcher ▾] › New issue (or "New sub-issue of KEY"), expand, close
- ✅ Title + description; quick-suggestion label chips from title keywords; per-team issue-template picker pre-fills both
- ✅ Property pills: status (numbered menu), priority, assignee, labels, project, "…" → due date (calendar) + estimate (points)
- ✅ Save as draft (localStorage per team, restored on reopen with Discard), Create more toggle, ⌘⏎ creates
- ✅ Sub-issue mode: opens with parent pre-wired from issue detail or cycle page
- ✅ Draft state persists; toasts on create with View issue link
- ✅ Cycle pill (current / upcoming cycles), Milestone pill once the project has milestones; ⌘↵ works after picking from any pill menu
- ✅ On the triage page, C (or "+") files the new issue straight into triage

## 4. Issue detail
- ✅ Full page + side-peek variants; breadcrumb, star, copy link/ID, split view, more menu
- ✅ Inline editable title (debounced save), description (markdown, ⌘⏎ saves)
- ✅ Sub-issues card: children with status/priority/assignee, done progress bar, add new / attach existing / remove
- ✅ Parent row in properties rail (links to parent)
- ✅ Relations card: blocks / blocked by / related / duplicates with search picker + remove
- ✅ Properties rail: Status, Priority, Assignee, Labels, Project, Cycle, Due date (calendar popover with Today/Tomorrow/Next week), Estimate (0/1/2/3/5/8/13/21)
- ✅ Activity feed: created/renamed/description/status/priority/assignee/label/project/parent/cycle/due/estimate/related events with relative times; comment composer (⌘⏎)
- ✅ Comments: reactions (👍👎❤️🎉🚀😄 with counts + picker), edit/delete own, (edited) marker
- ✅ Agent hand-off: Linear-style issue toolbar (copy URL ⌘⇧, · copy ID ⌘. · copy branch ⌘⇧. · copy as prompt ⌘⌥P) with a caret menu: **Open in Claude Code ▸** (the issue's location, its project's locations, other locations, or "Choose a folder…" via the native folder picker — picking one makes it the issue's location) launches an interactive `claude` session in your terminal (Terminal, iTerm, Ghostty, Warp, kitty, Alacritty or WezTerm); also in row context menus and the palette
- ✅ Locations: a workspace list of directories (usually git repos) linked many-to-many to projects; every issue works in exactly one (Location property; every open issue without one shows "Needs a location"); sub-issues inherit the parent's location; a project's locations are suggestions in the picker, never defaults; add several at once (⌘-click in the folder picker)
- ✅ Hand-off is always explicit (Copy as prompt, Open in Claude Code): nothing picks up assigned issues on its own
- ✅ Sub-issues: list rows nest under their parent (elbow + indent), show "› parent" when apart, and parents show a closed/total progress ring; issue page shows "Sub-issue of ◐ KEY title  ◌ n/m"; inline sub-issue composer inherits the parent's priority, assignee, cycle and project, and Enter creates and keeps it open for the next one
- ✅ Breadcrumb names the list you came from, "3 / 27" with ↓↑, J/K steps through it; every issue shortcut works on the open issue (menus anchor at the rail)
- ✅ Rich-text description and comments (TipTap, stored as Markdown): headings, lists, checklists, code, quotes, `/` commands, @mentions of people and issues, pasted/dropped images (images only, up to 2 MB, stored in the database — the same in docs, project, initiative and team descriptions)
- ✅ One activity timeline; comment threads with reply / resolve / reactions; real subscriptions (subscribers shown, ⇧S); link attachments (⌃L) — files aren't hosted, link to them; Remind me (⇧H); move to team (⌘⇧M); Make a copy
- ✅ Triage banner (Accept / Duplicate / Decline) on issues waiting in triage; archived and trashed URLs open with Restore

## 5. Board view
- ✅ Columns per group (status/priority/assignee/project/cycle); header icon+name+count+actions; "+" per status column
- ✅ Cards (Linear layout): key + "› parent" for sub-issues + assignee; status icon + title; bordered chips for priority, cycle, project, sub-issue progress, labels, estimate, due; created date — chips that repeat the column's grouping are omitted
- ✅ Drag & drop: reorder within a column (sortOrder midpoint) and across columns (moves the group field)
- ✅ Hidden columns panel: empty columns and Canceled (plus any you hide) move to a side panel with counts; rows accept drops and a click brings the column back
- ✅ One agent identity per workspace ("Agent"): every agent write records the person it acted for ("Agent via Parth")
- ✅ Rows (swimlanes) from sub-grouping, cards follow the display properties, estimate sums in column headers, card context menu, drag across lanes

## 6. Projects
- ✅ List: name + favorite star, health dot, priority icon, lead, target date, issue count, progress donut + %
- ✅ Row context menu: favorite, copy link, delete
- ✅ New project page: emoji icon picker, name, summary, lead, priority, start/target dates
- ✅ Overview: editable name/summary (click to edit), property chips (Status, Health, Priority, Lead, Target), project updates (health-tagged composer + feed), milestones (add/advance-status/delete, target dates), editable description (markdown)
- ✅ Right rail: Status, Lead, Members (multi-pick), Dates, Progress, Activity feed
- ✅ Issues tab: full grouped list with filters/display options, "New issue" and "Add existing issue" pickers
- ✅ Projects list: filters (status, priority, lead, members, health, team, target, text), grouping, ordering, closed-projects window, display properties; Board and draggable Timeline layouts
- ✅ Project statuses Backlog / Planned / In Progress / Paused / Completed / Canceled; summary; resources (links); Overview · Activity · Issues tabs; details panel (⌘I) with milestones and progress breakdown
- ✅ Issues belong to milestones (rail, filter, grouping, CLI `--milestone`), milestone progress
- ✅ Project templates (Settings › Templates; pick one in New project) and project dependencies (blocked by / blocking, arrows on the timeline)
- ✅ Documents: "Add document or link…" in project and team resources; document page with the rich editor; `baseline doc`
- ✅ Project labels (Settings › Projects › Labels) with groups whose labels are exclusive; Labels in the properties "…" menu (P then L), list chips, filter and display property
- ✅ Named project statuses (Settings › Projects › Statuses): add, rename, recolour or delete statuses inside each category
- ✅ Project bell: choose which project events reach your inbox (issue added, issue completed/canceled, description changes, new update) and the project's update schedule
- ✅ Update schedule (Settings › Projects › Updates, or per project): next-due hint under the update card; leads get an inbox reminder when an update is due
- ✅ Pulse: one feed of every project update (All / Following / My projects) and an optional daily or weekly summary in the inbox
- ✅ Customer requests (Settings › Customer requests): customers with status, tier, revenue, size, owner and domains; requests on issues and projects; New issue from a customer page goes to the default team
- ✅ Document templates (Settings › Documents) offered in "Add document or link…"
- ✅ Custom emojis (Settings › Emojis): reactions and :name: in Markdown
- ✅ Initiatives (sidebar, G then N): Active / Planned / All, owner, target, health from updates, projects and sub-initiatives, progress across their projects; a project's properties show its initiatives
- ✅ Releases: stages Planned / In progress / Released / Canceled, issues per release, Release on the issue rail, Release filter
- ✅ Project saved views: Views has Issues | Projects tabs; a project view keeps filters, grouping, ordering, layout and properties; ⌥V saves whatever list is on screen

## 7. Command palette (⌘K)
- ✅ Linear's default command list and grouping, multi-key hints; O then I · P · F · C · L · U · V · D · S pickers; N then P · I · D; V creates full screen; Export issues as CSV; user (profile) and label pages; `?` help menu; ⌘/ shortcuts drawer; ⌘⇧C copies the page URL; Not found page
- ✅ Fuzzy subsequence search with scoring over commands, issues, projects, views and documents
- ✅ Commands: go to inbox/my issues/projects/views/settings pages, per-team home/cycles, create issue, create project, switch theme, shortcuts overlay, copy as prompt (when an issue is in view)
- ✅ Acts on the open / peeked / hovered issue when nothing is selected: assign to me, relations, remind, move team, subscribe, copy ID/URL/title/branch/Markdown/prompt; navigation to triage, archive, current cycle, search, trash, settings pages

## 8. Settings
- ✅ Own layout: "‹ Back to app", nav sections
- ✅ Workspace: name, members summary, agent-CLI hint
- ✅ Teams: rename inline, cycle key, delete; workflow state CRUD (add with name/type/color, rename inline, retype, recolor, reorder ↑↓, delete with issue-migration to Backlog); cycles CRUD (add with dates, delete)
- ✅ Members: list, add (human or agent identity), "set as me" (current user switch)
- ✅ Labels: create with color, rename/recolor inline, delete (issue counts shown)
- ✅ Templates: per-team issue templates (name, optional title, markdown description) offered in the create modal
- ✅ Coding tools: locations (add, rename, see projects/issues using each, missing-path warning, remove), terminal app dropdown (installed terminals only), prompt template editor with live preview
- ✅ Appearance: dark/light
- ✅ Import & export: export JSON, import JSON (full restore), reset sample workspace
- ✅ Account: Preferences (home view, first day of week, theme), Profile (name, email, avatar colour), Notifications (per kind)
- ✅ Recurring issues per team (daily / weekly / every 2 weeks / monthly); any issue converts to one, or to a template, or to a project
- ✅ Preferences: Underline links, Auto-assign to self (off by default, as in Linear), On move to started status assign to yourself
- ✅ Profile: picture upload, title, username (feeds `{username}` in branch names)
- ✅ Notifications: Priority inbox + which kinds count as priority; Desktop push by category through browser notifications (also from a background tab); reaction and document-change notifications
- ✅ Team settings hub (Linear's layout): General (name, identifier, description, estimates with zero / extended / count-unestimated), Members, Issue labels, Templates, Recurring issues, Issue statuses, Workflows & automations (PR automations, auto-close parent / sub-issues / stale issues, auto-archive, re-order on status change), Triage, Cycles, Danger zone
- ✅ Security & access: personal API keys (name, permissions, team limits, shown once, last used, revoke); Administration › API: who may create keys, every issued key, require a key from other devices
- ✅ Per-team page: triage, estimate scale (none / exponential / fibonacci / linear / t-shirt), cycle automation (length, cooldown, upcoming, rollover), workflow, cycles

## 9. Inbox & notifications
- ✅ Grouped Today / Yesterday / Earlier with counts
- ✅ Rows: type icon (assignment arrow / comment bubble), actor avatar, bold refs, unread accent bar, hover mark-read/unread, mark all as read
- ✅ Click opens the issue in split peek and marks read
- Generated on: assignment to you, comments by others (self-comments don't notify)
- ✅ Linear inbox: U read/unread, ⌫ delete, H snooze (with natural-language times), ⇧⌫ delete all read, row menu, filters (type, from), display (ordering, show snoozed, unread first)
- ✅ Notifications follow subscriptions: status changes (e.g. an agent finishing), comments, replies, mentions, assignment, reminders
- ✅ Priority inbox (assignments, mentions, replies and reminders first) and grouping by Focus
- ✅ SLAs (Settings › Issues › SLAs): rules by priority, label and team give issues a deadline; badges on rows and the rail, SLA filter, breach notifications
- ✅ Asks (sidebar › Asks, Settings › Asks): intake forms with fields; submissions land in the team's triage
- ✅ Loops (Settings › Loops): on issue created / label added / status changed / a schedule → comment, assign, label, move, file an issue, open in Claude Code; run log and Run now
- ✅ GitHub (Settings › Integrations › GitHub): Linear's linking rules and magic words, per-team PR automations with branch rules, In Review state, PR and commit rows on issues, PR icon and filter, branch-name format. **Read-only by design**: nothing is ever written to GitHub (an allowlist in `git.ts` lets only read commands reach `gh` / `git`). Data comes from `gh` + `git log` for the tracked repos (picked in settings, plus a laptop's locations; polled every 2 min) and from **signed GitHub webhooks** (real time, no token: HMAC-verified, repeat deliveries dropped, delivery log in settings). A hosted server reads with an admin-pasted **read-only token** (a fine-grained token with Read-only permissions; a classic token with any write scope is refused, and the token never reaches the browser) and syncs the same way. One-way **GitHub Issues import** into a team's triage, optionally following new issues
- ✅ Team bell: inbox notifications when issues are added to a team, closed, or land in its triage
- ✅ Triage queue: filters, ordering (oldest / newest / priority), show snoozed, H snoozes, "Create triage issue"

## 10. Cycles
- ✅ Team cycles page: Current / Upcoming / Previous sections, per-cycle card with date range, issue count, progress bar, inline issue rows, "+ Issue" (create pre-assigned to the cycle)
- ✅ Cycle picker in issue properties; cycles manageable in team settings
- ✅ Cycle page: full list/board with filters, burn-up chart (scope / started / completed), breakdown by assignee / label / project, rename, delete, previous/next
- ✅ Automation keeps cycles scheduled and rolls unfinished issues into the next cycle

## 11. Keyboard model
- ✅ Linear's map: C create; ⌘K palette; / search; F filter; [ sidebar; ⌘B list/board; ⌘Z undo; J/K; Enter open; Space peek; X select; S P A L, I, ⇧D ⇧E ⇧C ⇧P ⇧M ⇧H ⇧S ⇧R, ⌥F, ⌘⇧P ⌘⇧M ⌘⇧O, M then B/X/R/M; 1–9 status; E archive; ⌘⌫ delete; copy chords; G then I/M/A/E/B/T/C/P/V/X/F/S
- ✅ Inbox U / ⌫ / H / ⇧⌫; Triage 1 / 2 / 3 / H; ⌥V save as view
- ✅ ? opens the searchable cheatsheet (also in Settings › Keyboard shortcuts), one source for both

## 12. Non-UI (agentic core)
- ✅ SQLite store (WAL); REST /api; CLI (issue create/list/update/comment/handoff/…, seed, serve) with `--as <user>` write attribution for agent identities; personal API keys for the REST API (`Authorization: Bearer <key>`, `baseline api-key create|list|revoke`); JSON export/import; seeded sample workspace (3 projects, 2 teams, cycles, sub-issues, relations, milestones, due dates, estimates); undo toasts for destructive ops (soft delete + restore underneath)

## Known gaps (deliberate)
- Slack, SSO, billing and OAuth apps (declined; see JOURNEYS.md › Not built). Writing back to GitHub (linkback comments, statuses, labels) is declined on purpose: the integration stays read-only
- See JOURNEYS.md for the journey-by-journey comparison with Linear

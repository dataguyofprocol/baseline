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

## 3. Create issue modal (C)
- ✅ Centered modal (#1a1a1b, radius 14, shadow), header: [team switcher ▾] › New issue (or "New sub-issue of KEY"), expand, close
- ✅ Title + description; quick-suggestion label chips from title keywords; per-team issue-template picker pre-fills both
- ✅ Property pills: status (numbered menu), priority, assignee, labels, project, "…" → due date (calendar) + estimate (points)
- ✅ Save as draft (localStorage per team, restored on reopen with Discard), Create more toggle, ⌘⏎ creates
- ✅ Sub-issue mode: opens with parent pre-wired from issue detail or cycle page
- ✅ Draft state persists; toasts on create with View issue link

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

## 5. Board view
- ✅ Columns per group (status/priority/assignee/project/cycle); header icon+name+count+actions; "+" per status column
- ✅ Cards (Linear layout): key + "› parent" for sub-issues + assignee; status icon + title; bordered chips for priority, cycle, project, sub-issue progress, labels, estimate, due; created date — chips that repeat the column's grouping are omitted
- ✅ Drag & drop: reorder within a column (sortOrder midpoint) and across columns (moves the group field)
- ✅ Hidden columns panel: empty columns and Canceled (plus any you hide) move to a side panel with counts; rows accept drops and a click brings the column back
- ✅ Claude Code identity: the integrated agent's avatar is an orange burst mark (also used for Open in Claude Code)

## 6. Projects
- ✅ List: name + favorite star, health dot, priority icon, lead, target date, issue count, progress donut + %
- ✅ Row context menu: favorite, copy link, delete
- ✅ New project page: emoji icon picker, name, summary, lead, priority, start/target dates
- ✅ Overview: editable name/summary (click to edit), property chips (Status, Health, Priority, Lead, Target), project updates (health-tagged composer + feed), milestones (add/advance-status/delete, target dates), editable description (markdown)
- ✅ Right rail: Status, Lead, Members (multi-pick), Dates, Progress, Activity feed
- ✅ Issues tab: full grouped list with filters/display options, "New issue" and "Add existing issue" pickers

## 7. Command palette (⌘K)
- ✅ Fuzzy subsequence search with scoring; sections: Navigation, Actions, Teams, Projects, Views, Issues
- ✅ Commands: go to inbox/my issues/projects/views/settings pages, per-team home/cycles, create issue, create project, switch theme, shortcuts overlay, copy as prompt (when an issue is in view)

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

## 9. Inbox & notifications
- ✅ Grouped Today / Yesterday / Earlier with counts
- ✅ Rows: type icon (assignment arrow / comment bubble), actor avatar, bold refs, unread accent bar, hover mark-read/unread, mark all as read
- ✅ Click opens the issue in split peek and marks read
- Generated on: assignment to you, comments by others (self-comments don't notify)

## 10. Cycles
- ✅ Team cycles page: Current / Upcoming / Previous sections, per-cycle card with date range, issue count, progress bar, inline issue rows, "+ Issue" (create pre-assigned to the cycle)
- ✅ Cycle picker in issue properties; cycles manageable in team settings

## 11. Keyboard model
- ✅ C create; ⌘K palette; ⌘B sidebar; / filter; ? shortcuts overlay; J/K cursor; Enter open; Esc close/back (menus swallow Esc properly); S/P/A/L quick menus on the cursored row; 1-5 set status; ⇧U/H/M/L set priority; X select; E archive; ⌘⌫ delete (archive/delete undoable via toast); G then I/M/P/A/V navigation
- ✅ ? opens the two-column cheatsheet (kept in sync with the above)

## 12. Non-UI (agentic core)
- ✅ SQLite store (WAL); REST /api; CLI (issue create/list/update/comment/handoff/…, seed, serve) with `--as <user>` write attribution for agent identities; JSON export/import; seeded sample workspace (3 projects, 2 teams, cycles, sub-issues, relations, milestones, due dates, estimates); undo toasts for destructive ops (soft delete + restore underneath)

## Known gaps (deliberate)
- Issue subscriptions/unsubscribe, mentions parsing, markdown @-links
- Rich-text toolbar on description editor (markdown textarea + renderer instead)
- Trash bin page (soft-deleted issues are restorable via undo toast or API, but not browsable)

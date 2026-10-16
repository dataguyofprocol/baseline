# Linear user journeys vs Baseline

Each Linear journey, checked against the live Linear app, and where Baseline stands.
Status: ✅ matches Linear · — out of scope. Every ✅ row was exercised in the running app (click-through or scripted keyboard/route checks).
Out of scope for a local-first, single-machine tracker: billing, SSO, Slack/GitHub sync,
customer requests, AI filters. Initiatives were removed from the model on purpose earlier
and stay out unless you want them back.

## 1. Find my way around (shell & navigation)
| Journey | Status | How it works now |
|---|---|---|
| Sidebar: Inbox, My issues, Workspace (Projects, Views, More), Favorites, Your teams | ✅ | |
| Team sub-items: Triage (with count), Issues, Cycles, Projects, Views | ✅ | Triage shows when the team has it on |
| Team row "…" menu | ✅ | Team overview, Issues, Cycles, Triage, Archive, Team settings, Copy link |
| Cycles › Current / Upcoming in the sidebar | ✅ | G then V opens the current cycle |
| Team Home: Overview (description, team resources), Documents, Members, Go to | ✅ | team "…" › Team overview |
| "+" beside Your teams → Create a new team | ✅ | identifier derived from the name, editable |
| G-chords | ✅ | G then I · M · A · E · B · T · C · P · V · X · F · S |
| ⌘K palette acts on the open / peeked / hovered issue, not only a selection | ✅ | plus copy actions, relations, remind, move team, undo, layout toggle |
| Search page (`/`) | ✅ | matches titles, descriptions, IDs and comment text; filters + display apply |
| ⌘Z undo | ✅ | every property change, archive, delete and team move |
| `[` toggles the sidebar, ⌘B flips list ↔ board | ✅ | Linear's bindings |
| Initiatives | — | removed earlier by decision |

## 2. Capture work (create issue)
| Journey | Status | How it works now |
|---|---|---|
| C opens the modal: team, title, rich description, properties, templates, drafts, create-more, ⌘↵ | ✅ | description is the rich editor |
| C is context-aware | ✅ | prefills the team / project / cycle of the page you're on |
| Rich text: headings, lists, checklists, code, quotes, links, `/` commands, @mentions | ✅ | stored as Markdown so agents read it raw |
| Paste or drop an image / attach a file | ✅ | on issue pages, comments, and the create modal's paperclip; files live next to the database |
| Cycle and Milestone pills in the create modal | ✅ | current / upcoming cycles; milestones once a project is picked |

## 3. Triage incoming work
| Journey | Status | How it works now |
|---|---|---|
| Team Triage queue for issues filed by agents and teammates | ✅ | team toggle in Settings › team; agent-filed issues land there |
| Accept (1) · Duplicate (2) · Decline (3), queue advances | ✅ | also as a banner on the issue page; `baseline triage accept/decline` |
| Snooze a triage issue | ✅ | H, or the Snooze button; snoozed issues come back on time; show snoozed in Display |
| Triage filters, ordering, "Create triage issue" | ✅ | C on the triage page files into triage too |

## 4. Work an issue (issue page)
| Journey | Status | How it works now |
|---|---|---|
| Breadcrumb names the list you came from; "3 / 27" with ↓ ↑; J/K moves through it | ✅ | |
| Keyboard on the open issue: S P A L, I, ⇧D ⇧E ⇧C ⇧P ⇧M ⇧H ⇧S ⇧R, ⌥F, ⌘⇧P ⌘⇧M ⌘⇧O, M-chords, E, ⌘⌫ | ✅ | menus open anchored at the property in the rail |
| Every property menu has a filter field and number keys | ✅ | the same menus from shortcuts, rail, context menu and bulk bar |
| One activity timeline: events and comments by time | ✅ | |
| Comment threads: reply, resolve / reopen, reactions, edit, delete | ✅ | `baseline issue comment --reply`, `comment resolve` |
| Subscribe / unsubscribe, subscribers shown | ✅ | auto-subscribe on create, assign, comment, mention |
| @mention people (notifies) and issues (links) | ✅ | |
| Links and file attachments | ✅ | ⌃L adds a link; `baseline issue link` |
| Milestone in the rail when the project has milestones | ✅ | |
| Move to another team (new key) | ✅ | ⌘⇧M; `baseline issue transfer` |
| Mark as duplicate (cancels and relates) | ✅ | M then M |
| Remind me later (⇧H) | ✅ | lands in the inbox at the time; `baseline issue remind` |
| Peek from a list (Space) | ✅ | J/K moves the peek along the list |
| Archived / trashed issue URLs open with Restore | ✅ | |
| Create related → sub-issue / parent / blocked / blocking issue | ✅ | the new issue is wired to this one on create |
| Convert to project | ✅ | sub-issues become the project's issues; the issue is archived; undoable |
| Convert to template / recurring issue | ✅ | recurring issues file a copy on their cadence (Settings › team, `baseline recurring`) |

## 5. Slice the backlog (lists, boards, filters, views)
| Journey | Status | How it works now |
|---|---|---|
| Filter menu: Status, Assignee, Creator, Priority, Estimate, Labels, Relations, Sub-issues, Due, Created, Updated, Project, Milestone, Cycle, Subscribers, Links, Content | ✅ | typing searches values across every field; per-value counts |
| Pills: field · operator · values · ×, "is / is not / any of", Clear, Save as view | ✅ | |
| "N issues hidden by filters · Clear filters" | ✅ | |
| Display: list/board, grouping, sub-grouping (rows on board), ordering, completed by recency, completed issues window, show sub-issues, show triage, empty groups, 14 display properties | ✅ | |
| Board swimlanes, cards follow display properties, estimate sums in headers | ✅ | drag across columns and lanes |
| Right-click menu with property flyouts, Create related, Mark as, Copy, Favorite, Remind, Delete | ✅ | acts on the whole selection when the row is selected |
| Selection: X, ⇧-click, ⌘-click, ⌘A; floating bar with property buttons | ✅ | |
| Saved views (workspace and team), save / discard changes | ✅ | |
| Views page with Issues · Projects tabs; project views; ⌥V saves the list on screen | ✅ | |
| Archive and Trash pages | ✅ | restore, delete forever, empty trash |
| Advanced (AND/OR) filter groups | ✅ | nested groups beside the simple pills; saved with views |

## 6. Plan (projects, milestones, roadmap)
| Journey | Status | How it works now |
|---|---|---|
| Projects list: health ("No updates"), priority, lead, target, issues, status % | ✅ | |
| Projects filters (status, priority, lead, members, health, team, target, text) and display (grouping, ordering, closed window, properties) | ✅ | |
| Board and Timeline layouts | ✅ | timeline bars drag to move and resize dates |
| Project statuses: Backlog, Planned, In Progress, Paused, Completed, Canceled | ✅ | |
| Project page: Overview · Activity · Issues; details panel (⌘I) | ✅ | |
| Overview: icon, name, summary, properties row, resources (documents and links), latest update, description, milestones | ✅ | |
| Documents: create from resources, rich editor page, listed on the team's Documents tab | ✅ | `baseline doc` for agents |
| Issues belong to milestones; milestone progress | ✅ | `--milestone` on the CLI |
| Updates with health; Activity tab history | ✅ | |
| Project templates | ✅ | Settings › Templates; New project › template; `--template` on the CLI |
| Project dependencies (blocked by / blocking) | ✅ | details panel, timeline arrows, `baseline project depend` |
| Project labels | — | not modelled; project status, priority and health cover grouping |

## 7. Run iterations (cycles)
| Journey | Status | How it works now |
|---|---|---|
| Cycles page: Linear's timeline with current / upcoming / previous, capacity and success | ✅ | |
| Cycle page: full list/board with filters, burn-up chart (scope / started / completed), breakdown by assignee / label / project | ✅ | |
| Automation: cycle length, cooldown, upcoming count, roll unfinished work over | ✅ | Settings › team, or `baseline team update` |

## 8. Stay in the loop (inbox, my issues, notifications)
| Journey | Status | How it works now |
|---|---|---|
| Inbox: U read/unread, ⌫ delete, H snooze, ⇧⌫ delete all read, row menu | ✅ | |
| Inbox filters (type, from) and display (ordering, show snoozed, unread first) | ✅ | |
| Notifications from subscriptions: status changes, comments, replies, mentions, assignment, reminders | ✅ | each kind can be switched off in Settings › Notifications |
| My issues: Assigned / Created / Subscribed / Activity | ✅ | |
| Priority inbox, group by Focus | ✅ | Display › Priority inbox |

## 9. Configure (settings)
| Journey | Status | How it works now |
|---|---|---|
| Account: Preferences (home view, first day of week, theme), Profile (name, email, avatar colour), Notifications | ✅ | |
| Workspace: General, Members, Teams, Labels, Templates, Coding tools, Import & export | ✅ | |
| Per-team page: triage, estimates scale (none / exponential / fibonacci / linear / t-shirt), cycle automation, workflow, cycles | ✅ | |
| Keyboard shortcuts reference, searchable | ✅ | `?` anywhere |
| Billing, SSO, integrations, API keys | — | the CLI is the integration surface |

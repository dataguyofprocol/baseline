# Linear user journeys vs Baseline

Every journey below was mapped against the live Linear workspace (parthline), then exercised
in the running Baseline app by a scripted harness that drives the UI the way a person does
(key presses, clicks, typing, file picks) and checks the result on screen and in the data.
**Check** names the harness row that passed in the last full run (bottom of this file).

Status: ✅ matches Linear · — not part of this workspace's Linear (see the end).

## 1. Find my way around (shell & navigation)
| Journey | Status | Check | How it works |
|---|---|---|---|
| Sidebar: Inbox, My issues, Drafts (when you have some), Workspace (Projects, Views, Pulse, Customers, More), Favorites, Your teams | ✅ | 1.1 | |
| Team sub-items: Home, Triage (count), Issues, Cycles › Current / Upcoming, Projects, Views | ✅ | 1.2, 1.4 | |
| Team row "…" menu | ✅ | 1.3 | Team overview, Issues, Cycles, Triage, Archive, Team settings, Copy link |
| Team Home: Overview (description, team resources), Documents, Members, Go to | ✅ | 1.5 | |
| "+" beside Your teams → Create a new team | ✅ | 1.6 | identifier derived from the name |
| Customize sidebar: badge style; Always show / Show when badged / Don't show; hidden items in More | ✅ | 9.11 | More › Customize sidebar |
| Teams and Members directory pages | ✅ | 9.10 | |
| G-chords | ✅ | 1.7 | G then I · M · A · E · B · T · C · V · P · W · X · F · S |
| ⌘K palette scoped to the open / peeked / hovered issue | ✅ | 1.8 | |
| Search page (`/`): titles, IDs and comment text | ✅ | 1.9 | |
| ⌘Z undo | ✅ | 1.10 | every property change, archive, delete, team move |
| `[` toggles the sidebar, ⌘B flips list ↔ board | ✅ | 1.11 | |
| Issue shortcuts only act on the page you're on | ✅ | 1.12 | a list left behind can't be edited from a project page |

## 2. Capture work (create issue)
| Journey | Status | Check | How it works |
|---|---|---|---|
| C opens the modal: team, title, rich description, properties, templates, create-more, ⌘↵ | ✅ | 2.1 | ⌘↵ also works right after picking from a pill menu (2.7) |
| Drafts: Save draft, Drafts page, reopen restores | ✅ | 2.2 | |
| C is context-aware: project, cycle and triage pages prefill | ✅ | 2.3 | |
| Rich text: `/` commands (headings, lists, checklists, code, quotes), @mentions | ✅ | 2.4 | stored as Markdown |
| Attach files from the create modal (uploaded on create) and on the issue page | ✅ | 2.5, 2.6 | files live next to the database |
| Cycle and Milestone pills | ✅ | 2.7 | |

## 3. Triage incoming work
| Journey | Status | Check | How it works |
|---|---|---|---|
| Triage queue for issues filed by agents and teammates | ✅ | 3.1 | |
| Accept (1) · Duplicate (2) · Decline (3), queue advances | ✅ | 3.2, 3.3 | |
| Snooze (H), Show snoozed | ✅ | 3.4 | |
| Filters, ordering, "Create triage issue" | ✅ | 3.5 | |

## 4. Work an issue (issue page)
| Journey | Status | Check | How it works |
|---|---|---|---|
| Breadcrumb names the source list; "n / total"; J/K | ✅ | 4.1 | |
| Shortcut menus: S P A L ⇧D ⇧E ⇧C ⇧P ⇧M ⌘⇧P ⌘⇧M ⇧H, M then B/X/R/M | ✅ | 4.2 | |
| I, ⇧S, ⌥F, ⇧R, ⌘⇧O | ✅ | 4.3 | |
| Property menus: filter field and number keys | ✅ | 4.4 | |
| One activity timeline | ✅ | 4.5 | |
| Comment threads: post, react, reply, resolve, edit, delete | ✅ | 4.6 | custom emojis in reactions (9.8) |
| Subscribe / unsubscribe | ✅ | 4.7 | |
| @mentions notify; issue keys link | ✅ | 4.8 | |
| Links (⌃L) | ✅ | 4.9 | |
| Milestone in the rail | ✅ | 4.10 | |
| Move to another team (⌘⇧M) | ✅ | 4.11 | |
| Mark as duplicate (M then M) | ✅ | 4.12 | |
| Remind me (⇧H) | ✅ | 4.13 | |
| Peek (Space), J moves the peek | ✅ | 4.14 | |
| Archived / trashed URLs open with Unarchive / Restore | ✅ | 4.15 | |
| Create related (sub-issue, parent, blocked, blocking) | ✅ | 4.16 | |
| Convert to project | ✅ | 4.17 | |
| Convert to template / recurring issue | ✅ | 4.18 | |
| Customer requests on the issue | ✅ | 4.19 | |

## 5. Slice the backlog (lists, boards, filters, views)
| Journey | Status | Check | How it works |
|---|---|---|---|
| Filter menu: 17 fields | ✅ | 5.1 | |
| Pills (field · operator · values · ×), is not, Clear, Save, "N issues hidden by filters" | ✅ | 5.2 | |
| Display options | ✅ | 5.3 | |
| Board swimlanes, estimate sums | ✅ | 5.4 | |
| Right-click menu | ✅ | 5.5 | |
| Selection: X, ⇧-click (extends from the last selected row), ⌘-click, ⌘A, bulk bar | ✅ | 5.6 | |
| Saved views: save, rename, Save / Discard | ✅ | 5.7 | |
| Views: Issues · Projects tabs; project views; ⌥V | ✅ | 5.8 | |
| Archive and Trash pages | ✅ | 5.9 | |
| Advanced AND / OR filter groups | ✅ | 5.10 | |

## 6. Plan (projects)
| Journey | Status | Check | How it works |
|---|---|---|---|
| Projects list: health, priority, lead, target, issues, status %, labels | ✅ | 6.1 | |
| Projects filters (incl. labels) and display | ✅ | 6.2 | |
| Board and Timeline | ✅ | 6.3 | |
| Named project statuses, custom ones per category | ✅ | 6.4, 9.3 | Settings › Projects › Statuses |
| Project page tabs, details panel (⌘I) | ✅ | 6.5 | |
| Overview: hero, properties, resources, update, description, milestones, customer requests | ✅ | 6.6 | |
| Documents from resources (blank or template), editor page, team Documents tab | ✅ | 6.7 | templates in Settings › Documents (9.5) |
| Milestones with progress | ✅ | 6.8 | |
| Updates with health; Activity tab | ✅ | 6.9 | |
| Project templates | ✅ | 6.10 | |
| Dependencies from the properties "…" menu | ✅ | 6.11 | |
| Project labels with groups (P then L) | ✅ | 6.12 | Settings › Projects › Labels |
| Project bell: per-project inbox notifications + update schedule | ✅ | 6.13 | |
| Update schedule: due hint, lead reminders | ✅ | 6.14, 9.4 | reminder timing also checked against the store on a scratch database |
| Customer requests on a project | ✅ | 6.15 | |
| Pulse: feed of project updates, daily / weekly summary | ✅ | 9.7 | |

## 7. Run iterations (cycles)
| Journey | Status | Check | How it works |
|---|---|---|---|
| Cycles page timeline | ✅ | 7.1 | |
| Cycle page: list/board, burn-up, breakdown | ✅ | 7.2 | |
| Automation: length, cooldown, upcoming, rollover | ✅ | 7.3 | |

## 8. Stay in the loop (inbox, my issues)
| Journey | Status | Check | How it works |
|---|---|---|---|
| Inbox: U, ⌫, H, row menu | ✅ | 8.1 | |
| Inbox filters (incl. project kinds) and display | ✅ | 8.2 | |
| Project and Pulse notifications with a preview | ✅ | 8.3 | |
| My issues: Assigned / Created / Subscribed / Activity | ✅ | 8.4 | |
| Priority inbox, Focus grouping | ✅ | 8.5 | |

## 9. Configure (settings)
| Journey | Status | Check | How it works |
|---|---|---|---|
| Settings nav: Account · Issues · Projects · Features · Administration · Your teams | ✅ | 9.1 | |
| Account: Preferences, Profile, Notifications | ✅ | 9.2 | |
| Customer requests settings, customers, customer page, New issue from a customer | ✅ | 9.6, 9.9 | |
| Custom emojis | ✅ | 9.8 | |
| Administration pages | ✅ | 9.12 | |
| Per-team settings | ✅ | 9.13 | |
| Keyboard shortcuts reference, searchable | ✅ | 9.14 | |
| Every route renders without console errors | ✅ | 10.1 | |

## 10. Plan and automate at scale
| Journey | Status | Check | How it works |
|---|---|---|---|
| Initiatives: Active / Planned / All, owner, target, health from updates, projects, sub-initiatives, G then N | ✅ | 11.1, 11.2 | brought back at your request; a project's properties list its initiatives |
| Releases: Planned → In progress → Released, issues per release, Release on the issue, filter | ✅ | 11.3 | |
| SLAs: rules by priority / label / team, deadline badges, SLA filter, breach notifications | ✅ | 11.4 | breach timing also checked on a scratch database |
| Asks: intake forms with fields and validation; submissions land in triage | ✅ | 11.5 | |
| Loops: issue created / label added / status changed / schedule → comment, assign, label, move, file an issue, Claude Code | ✅ | 11.6 | actions run as the Automation agent |
| GitHub: Linear's linking rules and magic words, per-team PR automations with branch rules, In Review, PR + commit rows, PR filter, branch format | ✅ | 11.7 | also run for real: `gh` pulled 50 PRs from `cli/cli` (all four states) and `git log` 225 commits |
| Team bell: notify on issues added, closed, or sent to triage | ✅ | 11.8 | |

## Side-by-side with Linear
Each main page was screenshotted in the live Linear workspace and in Baseline at the same
window size, and every difference that showed was fixed:

| Page | What differed | Now |
|---|---|---|
| Team issues | team picker and a Cycles tab in the tab row; three-level breadcrumb; underlined tabs | Active · Backlog · All issues pills + new-view icon; `Team › Issues`; team bell |
| Cycles | team tabs in the header, outlined coloured badges, "— capacity", date ranges | header is just "Cycles"; flat grey badges; capacity / success rings; dates only on the timeline |
| Issue page | "…" at the far edge, bold title crumb, bordered rail, clock-shaped estimate and arrow-shaped cycle icons, bold activity names, customer-requests section always shown | "…" beside the title; Linear's triangle and play-circle icons; muted activity; send button on the composer; customer requests from the toolbar icon |
| Projects / project page | bordered "New project", "…" on list pages, monospace dates, bold names, "Projects ›" crumb, details panel open by default | Linear's text button, figures in the UI font, single crumb, panel closed until ⌘I |
| My issues / lists | rule-line group headers, wrapping issue keys | filled group bands, keys on one line |
| Sidebar | underline on the current page | filled row |
| Settings | no search, no icons, "Account", bare rows and native selects; four preferences missing | search, icons, "Personal", carded rows with button-style menus; display names, emoticons, send comments on, font size, pointer cursors, app sidebar |
| Triage | team crumb and a tab row | "Triage ☆" with filter / display; "Nothing to triage" + Create triage issue |

## Not built
- **Hosted integrations** (Slack, connected accounts, SSO, billing, API keys): they need accounts and a public server. The GitHub integration reads GitHub through your own `gh` login instead; a hosted GitHub App can feed the same ingest functions (planned in TEAM_PLAN.md on `team/identity-sessions`).
- **AI (Agent, AI & agents)**: Baseline hands work to Claude Code instead (Open in Claude Code, Loops).

## Last full run
**98 of 98 checks passed** on 2026-10-16 in one run from a fresh sample workspace (7 min,
78 routes visited with no console errors), plus check 11.8 (team bell), run on its own right after.
Every check also passed in earlier runs, except 4.6 and 4.17: they failed once, in a run where
the app hot-reloaded mid-check because a source file changed. Both passed when re-run by hand
and in the clean run above. The CLI suite (174 checks), typecheck and production build pass.

The harness is `scripts/journey-harness.js`. To re-run it: reseed the dev sandbox
(`npm run seed`), open the dev app, load the script in the browser console (paste it, or
serve it and add a `<script>` tag), then `await __runAll()`. It returns one PASS / FAIL line
per check, with what it saw. It writes test data, so only run it against the dev sandbox,
never `~/.baseline/baseline.db`.

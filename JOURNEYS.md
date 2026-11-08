# Linear user journeys vs Baseline

Every journey below was mapped against the live Linear workspace (parthline), then exercised
in the running Baseline app by a scripted harness that drives the UI the way a person does
(key presses, clicks, typing, file picks) and checks the result on screen and in the data.
**Check** names the harness row that passed in the last full run (bottom of this file).

Status: ✅ matches Linear · — not part of this workspace's Linear (see the end).

## 1. Find my way around (shell & navigation)
| Journey | Status | Check | How it works |
|---|---|---|---|
| Sidebar: Inbox, My issues, Drafts (when you have some), Workspace (Projects, Views, More), Favorites, Your teams | ✅ | 1.1 | |
| Team sub-items: Home, Triage (count), Issues, Cycles › Current / Upcoming, Projects, Views | ✅ | 1.2, 1.4 | |
| Team row "…" menu | ✅ | 1.3 | Team overview, Issues, Cycles, Triage, Archive, Team settings, Copy link |
| Team Home: Overview (description, team resources), Documents, Members, Go to | ✅ | 1.5 | |
| "+" beside Your teams → Create a new team | ✅ | 1.6 | identifier derived from the name |
| Customize sidebar: badge style; Always show / Show when badged / Don't show; hidden items in More | ✅ | 9.11 | More › Customize sidebar |
| Teams and Members directory pages | ✅ | 9.10 | |
| G-chords, mapped as Linear does | ✅ | 1.7 | G then I · M · A (active) · E (all) · B · T · C · V (current) · W (upcoming) · U (views) · D (drafts) · N · P · X · S; N then P / I / D creates; O then I · P · F · C · L · U · V · D · S opens a picker |
| ⌘K palette scoped to the open / peeked / hovered issue | ✅ | 1.8 | |
| Search page (`/`): one field, tabs for All · Issues · Projects · Initiatives · Documents; titles, IDs, descriptions, comments; archived issues included | ✅ | 1.9, 12.7 | |
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
| Comment threads: post, react, reply, resolve, edit, delete | ✅ | 4.6 | |
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
| Overview: hero, properties, resources, update, description, milestones | ✅ | 6.6 | |
| Documents from resources, editor page, team Documents tab | ✅ | 6.7 | |
| Milestones with progress | ✅ | 6.8 | |
| Updates with health; Activity tab | ✅ | 6.9 | |
| Dependencies from the properties "…" menu | ✅ | 6.11 | |
| Project labels with groups (P then L) | ✅ | 6.12 | Settings › Projects › Labels |
| Project bell: per-project inbox notifications + update schedule | ✅ | 6.13 | |
| Update schedule: due hint, lead reminders | ✅ | 6.14, 9.4 | reminder timing also checked against the store on a scratch database |

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
| Project notifications with a preview | ✅ | 8.3 | |
| My issues: Assigned / Created / Subscribed / Activity | ✅ | 8.4 | |
| Priority inbox, Focus grouping | ✅ | 8.5 | |
| Project updates summary: daily / weekly / off per person (Settings › Notifications); counts updates on projects you lead, are a member of, or follow; the preview lists each update with an Open project button | ✅ | 8.6 | `npm run test:summaries` checks the scoping and schedule on a scratch database |

## 9. Configure (settings)
| Journey | Status | Check | How it works |
|---|---|---|---|
| Settings nav: Account · Issues · Projects · Features · Administration · Your teams | ✅ | 9.1 | |
| Account: Preferences, Profile, Notifications | ✅ | 9.2 | |
| Administration pages | ✅ | 9.12 | |
| Per-team settings | ✅ | 9.13 | |
| Keyboard shortcuts reference, searchable | ✅ | 9.14 | |
| Personal API keys (Security & access): name, Full access or Read / Write / Create issues / Create comments / Admin, all or some teams; shown once; last used; revoke. Administration › API: who may create keys, every issued key | ✅ | 9.15 | keys are sha256-hashed; a key acts as its owner; `Authorization: Bearer <key>` or the bare key, as Linear accepts; `baseline api-key` on the CLI; can be required for other devices when `BASELINE_HOST` opens Baseline to the network |
| Every route renders without console errors | ✅ | 10.1 | |

## 10. Plan and automate at scale
| Journey | Status | Check | How it works |
|---|---|---|---|
| Initiatives: Active / Planned / All, owner, target, health from updates, projects, sub-initiatives, G then N | ✅ | 11.1, 11.2 | brought back at your request; a project's properties list its initiatives |
| SLAs: rules by priority / label / team, deadline badges, SLA filter, breach notifications | ✅ | 11.4 | breach timing also checked on a scratch database |
| Loops: issue created / label added / status changed / schedule → comment, assign, label, move, file an issue, Claude Code | ✅ | 11.6 | actions run as the Automation agent |
| GitHub: Linear's linking rules and magic words, per-team PR automations with branch rules, In Review, PR + commit rows, PR filter, branch format | ✅ | 11.7 | also run for real: `gh` pulled 50 PRs from `cli/cli` (all four states) and `git log` 225 commits |
| Team bell: notify on issues added, closed, or sent to triage | ✅ | 11.8 | |

## 11. Second side-by-side pass
| Journey | Status | Check | How it works |
|---|---|---|---|
| Create modal: team-key chip, pill properties, no dimming, unassigned unless Auto-assign is on, V for full screen | ✅ | 12.1 | |
| ⌘K: Linear's groups and wording (Issues · Projects · Documents · Views · Initiatives · Team · Filter · Templates · Favorite · Navigation · Miscellaneous · Export · Settings · Teams · Help); O-pickers; user (profile) and label pages | ✅ | 12.2 | Export issues as CSV downloads the list on screen |
| Filter menu groups dates under Dates; menus open below their button; right-click menus open at the pointer | ✅ | 12.3 | |
| Issue context menu: More properties (milestone, add link, rename), Create related, Mark as, Copy (+ title as link, everything as Markdown), Convert to, Make a copy…, Move, Open in (Claude Code, Configure coding tools), Favorite, Remind me, Delete | ✅ | 12.3 | |
| Display options: pill chips, ordering direction | ✅ | — | checked by eye side by side |
| Preferences: Underline links, Auto-assign to self, On move to started status assign to yourself | ✅ | 12.4 | assign-on-start checked on a scratch database |
| Profile: picture upload, Title, Username (used by `{username}` in branch names) | ✅ | 12.4 | |
| Notifications: Priority inbox + Priority notifications, Desktop push by category (browser notifications, also from a background tab) | ✅ | 12.4 | reaction and document-change notifications added so every category has a source |
| Team settings: hub with General (name, identifier, description, estimates incl. zero / extended / count unestimated), Members, Issue labels, Templates, Recurring issues, Issue statuses, Workflows & automations, Triage, Cycles, Danger zone | ✅ | 12.5 | |
| Workflows & automations: auto-close parent / sub-issues, auto-close stale issues, auto-archive closed issues, re-order on status change | ✅ | 12.6 | stale + archive sweeps checked on a scratch database |
| `?` help menu, ⌘/ keyboard-shortcuts drawer with Linear's groups | ✅ | 9.14 | |
| Team archive: Issues · Cycles · Recently deleted issues; Not found page | ✅ | 12.8 | |
| Project board cards (status · priority · lead, issue count, + per column) and timeline (caps months, day ticks, today pill, Today / zoom incl. Year) | ✅ | 12.9 | |

## Side-by-side with Linear
Each main page was screenshotted in the live Linear workspace and in Baseline at the same
window size, and every difference that showed was fixed:

| Page | What differed | Now |
|---|---|---|
| Team issues | team picker and a Cycles tab in the tab row; three-level breadcrumb; underlined tabs | Active · Backlog · All issues pills + new-view icon; `Team › Issues`; team bell |
| Cycles | team tabs in the header, outlined coloured badges, "— capacity", date ranges | header is just "Cycles"; flat grey badges; capacity / success rings; dates only on the timeline |
| Issue page | "…" at the far edge, bold title crumb, bordered rail, clock-shaped estimate and arrow-shaped cycle icons, bold activity names | "…" beside the title; Linear's triangle and play-circle icons; muted activity; send button on the composer |
| Projects / project page | bordered "New project", "…" on list pages, monospace dates, bold names, "Projects ›" crumb, details panel open by default | Linear's text button, figures in the UI font, single crumb, panel closed until ⌘I |
| My issues / lists | rule-line group headers, wrapping issue keys | filled group bands, keys on one line |
| Sidebar | underline on the current page | filled row |
| Settings | no search, no icons, "Account", bare rows and native selects; four preferences missing | search, icons, "Personal", carded rows with button-style menus; display names, emoticons, send comments on, font size, pointer cursors, app sidebar |
| Triage | team crumb and a tab row | "Triage ☆" with filter / display; "Nothing to triage" + Create triage issue |
| Create modal | heavy blurred backdrop, team name chip, filled square chips, assignee preset, grey disabled button with ⌘↵ | no backdrop, `CORE` chip, outlined pills, cycle as an icon chip, unassigned by default, purple-style pill button |
| ⌘K palette | recent issues first, search icon, footer bar, 32px rows, Linear's commands missing | Linear's command list and grouping, multi-key hints (`N then P`), 46px rows, no footer; issues and projects appear as you type |
| Filter / display / context menus | filter menu jumped above the button; dates as three items; bordered property chips; context menu at the row's edge with Milestone, Subscribe and Move to team at top level | below the button; Dates submenu; pill chips + ordering arrow; at the pointer, Linear's items and order |
| Preferences, Profile, Notifications | three automation prefs, picture / title / username, the Inbox + Desktop structure were missing; four inbox-type toggles Linear doesn't have | added; inbox gets everything, as Linear says; push categories decide what reaches the desktop |
| Team settings | one long page | hub + subpages, as Linear |
| Search, shortcuts, archive, drafts, members, teams | issue-only search under a "Search" crumb; centered shortcuts modal on `?`; archive without tabs; serif empty-state titles; pills for Joined / teams | query in the header with tabs; `?` help menu + ⌘/ drawer; archive tabs; plain empty-state titles; plain Joined, team icons, cycle / project counts |
| Project board and timeline | progress chip, "No projects" placeholders; red Today line, segmented zoom on the left | Linear's card props + issue count, + per column; brand Today pill, Today button and zoom select on the right |
| Initiatives | no filter or display options | filter by health / owner; ordering; nest sub-initiatives |
| Security & access, Create API key, Administration › API | page was missing | same sections, form, permission list and team limits; Linear's Passkeys, Commit signing key and Authorized applications sections are left out (no sign-in, no OAuth apps) |

## Not built
Asked about on 2026-10-16; you chose API keys and left these out:
- **Slack notifications**, **connected accounts**, **SSO / passkeys / security policies**, **billing and usage**, **OAuth applications and outgoing webhooks**: they need accounts or a public server. GitHub is read-only: your own `gh` login (read commands only) plus *incoming* signed GitHub webhooks reached through a tunnel; Baseline never writes to GitHub.
- **AI (Agent, AI & agents)**: Baseline hands work to Claude Code instead (Open in Claude Code, Loops).

## Last full run
**110 of 110 checks passed** on 2026-10-16 in one run from a freshly seeded sample workspace
(6.9 min, 81 routes visited with no console errors), including the second side-by-side pass
(section 11, checks 12.1–12.10). Check 4.6 (comment threads) has failed intermittently before
and did once in an earlier run today; it passed on its own straight after and in the clean
run above. The CLI suite (179 checks), typecheck and production build pass.

The harness is `scripts/journey-harness.js`. To re-run it: reseed the dev sandbox
(`npm run seed`), open the dev app, load the script in the browser console (paste it, or
serve it and add a `<script>` tag), then `await __runAll()`. It returns one PASS / FAIL line
per check, with what it saw. It writes test data, so only run it against the dev sandbox,
never `~/.baseline/baseline.db`.

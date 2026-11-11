# Linear user journeys vs Baseline

Every journey below was mapped against a live Linear workspace, then exercised
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
| Sidebar: Teams and Members in More (Customize sidebar and badge styles cut, CORE_FLOW §6) | ✅ | 9.11 | More |
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
| File attachments on issues | ✂️ cut | 2.5 | issues link to files instead of hosting them |
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
| I, ⇧S, ⌥F, ⇧R, ⌘⇧O (opens the inline sub-issue composer: one sub-issue path, parent's defaults) | ✅ | 4.3 | |
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
| One sub-issue path: ⌘⇧O, Add sub-issue and the card + open the inline composer with the parent's defaults; double Enter files one | ✅ | 4.19 | |
| Lean rail: empty optional properties behind "Add property"; "Needs a location" only once an agent has the issue | ✅ | 4.20 | |

## 5. Slice the backlog (lists, boards, filters, views)
| Journey | Status | Check | How it works |
|---|---|---|---|
| Filter menu: 17 fields | ✅ | 5.1 | |
| Pills (field · operator · values · ×), is not, Clear, Save, "N issues hidden by filters" | ✅ | 5.2 | |
| Display options | ✅ | 5.3 | |
| Board swimlanes, estimate sums (labeled pts, only with Estimates on) | ✅ | 5.4 | |
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
| Board layout | ✅ | 6.3 | the Timeline layout was removed from the Projects list |
| Named project statuses, custom ones per category | cut | 6.4 | settings page cut from the UI (CORE_FLOW §6); data stays |
| Project page tabs, details panel (⌘I) | ✅ | 6.5 | |
| Overview: hero, properties, resources, update, description, milestones | ✅ | 6.6 | |
| Documents from resources, editor page, team Documents tab | ✅ | 6.7 | |
| Milestones with progress | ✅ | 6.8 | |
| Updates with health; Activity tab | ✅ | 6.9 | |
| Project labels with groups (P then L) | ✅ | 6.12 | settings page cut (CORE_FLOW §6) |
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
| Settings nav: Personal · Issues · Projects · Features · Administration · Your teams | ✅ | 9.1 | hosted members see only pages they can use |
| Settings › Features: cycles, estimates, templates, documents, recurring, project updates, initiatives, SLAs, loops (off for a new workspace) | ✅ | 9.3 | |
| Account: Preferences, Profile, Notifications | ✅ | 9.2 | |
| Administration pages | ✅ | 9.12 | |
| Per-team settings | ✅ | 9.13 | |
| Keyboard shortcuts reference, searchable | ✅ | 9.14 | |
| Personal API keys (Account & API keys): name, Full access or Read / Write / Create issues / Create comments / Admin, all or some teams; shown once; last used; revoke. Administration › API: who may create keys, every issued key | ✅ | 9.15 | keys are sha256-hashed; a key acts as its owner; `Authorization: Bearer <key>` or the bare key, as Linear accepts; `baseline api-key` on the CLI; can be required for other devices when `BASELINE_HOST` opens Baseline to the network |
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
| Notifications: one browser switch (priority inbox and push categories cut, CORE_FLOW §6) | ✅ | 12.4 | |
| Team settings: hub with General (name, identifier, description, estimates incl. zero / extended / count unestimated), Members, Issue labels, Templates, Recurring issues, Issue statuses, Workflows & automations, Triage, Cycles, Danger zone | ✅ | 12.5 | |
| Workflows & automations: auto-close parent / sub-issues, auto-close stale issues, auto-archive closed issues, re-order on status change | ✅ | 12.6 | stale + archive sweeps checked on a scratch database |
| `?` help menu, ⌘/ keyboard-shortcuts drawer with Linear's groups | ✅ | 9.14 | |
| Team archive: Issues · Cycles · Recently deleted issues; Not found page | ✅ | 12.8 | |
| Project board cards (status · priority · lead, issue count, + per column); an initiative's Projects tab timeline (caps months, day ticks, today pill, Today / zoom incl. Year) | ✅ | 12.9 | |

## Not built
- **Slack notifications**, **SSO / passkeys**, **billing and usage**, **OAuth applications and outgoing webhooks**. GitHub is read-only: a read-only token or your own `gh` login (read commands only), plus *incoming* signed GitHub webhooks; Baseline never writes to GitHub.
- **AI (Agent, AI & agents)**: Baseline hands work to Claude Code instead (Open in Claude Code, Loops).

## Last full run
**101 of 101 checks passed** on 2026-11-11 in one run from a freshly seeded scratch workspace,
with no page or console errors.

The harness is `scripts/journey-harness.js`. Run it through the verify-baseline skill, which
starts a throwaway instance on a scratch database and drives it in headless Chrome:
`.claude/skills/verify-baseline/scripts/vb start`, then
`node .claude/skills/verify-baseline/scripts/drive.mjs <run> harness <sections>`. Each check prints
one PASS / FAIL line with what it saw. The harness writes test data, so never run it against
`~/.baseline/baseline.db`.

# Projects

A user tracks a project's issues, health, milestones and written updates on the projects list and the project page. The CLI creates projects, posts updates with health, and manages milestones.

## Sub-features

- `proj-list` list with health, priority, lead, target date, issue count, status %, labels; filters and display options; list and board layouts.
- `proj-page` Overview, Activity and Issues tabs; ⌘I details panel; resources, description, milestones with progress.
- `proj-update` post an update with health; it shows on Overview and in Activity.
- `proj-status` named statuses, including the custom "In Review".
- `proj-docs` documents from a project's resources, listed under the team.
- `proj-cli` `project create|list|show|update|note|milestone-add`.

## How to get to it (user POV)

- Sidebar › Workspace › Projects, or `G` then `P`; open a project from the list.
- A team's Projects sub-item lists that team's projects.
- Terminal: `baseline project note "Agent Handoff" "text" --health atRisk`.

## Driving it with drive.mjs and vb

Preconditions:

- A fresh run that passes `vb doctor <run>`. Projects `Agent Handoff`, `Mobile Companion` and `Design System 2.0` exist.

- **All project journeys.** Run `drive.mjs <run> harness projects --name projects-section`. Every row in section 6 prints `PASS`.
- **CLI update, UI read.** Run `vb cli <run> project note "Agent Handoff" "Verify: update from CLI" --health offTrack`, then `vb cli <run> project show "Agent Handoff" --json`. The updates include that body with health `offTrack`. Open the project page with a `drive.mjs <run> eval` journey that navigates to `/projects/<id>` (id from `t.snap().projects`) and returns `t.text().includes('Verify: update from CLI')`.
- **CLI list.** Run `vb cli <run> project list`. Stdout lists the three seed projects with status, health, % and issue counts.

## Gotchas

- Row `4.17` (in the `issue` section) creates a `Harness convert me` project. Expect it in `project list` after that section has run.
- Row `6.14` reports "reminders in inbox: 0" in a fresh run. That is the expected value, not a failure: reminders appear only after a cadence has elapsed.
- Project routes use ids, not names (`#/projects/<id>`). Read the id from `t.snap().projects` or `project show --json`.

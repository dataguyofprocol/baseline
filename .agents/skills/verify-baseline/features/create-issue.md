# Create an issue

A user files a new issue from the keyboard (C) or the terminal, gives it a title and properties, and finds it in the team list and on its own page. Unfinished issues can be saved as drafts and reopened.

## Sub-features

- `create-modal` C opens the create modal with team chip, title, rich description, property pills, Save draft, Create more, and Create issue.
- `create-submit` ⌘↵ creates the issue and closes the modal (stays open with Create more on).
- `create-draft` Save draft lists it on the Drafts page; reopening restores it.
- `create-context` C on a project, cycle or triage page prefills that project, cycle or Triage state.
- `create-pills` Cycle and Milestone pills; ⌘↵ works straight after a pill menu.
- `create-cli` `issue create` makes the same issue from the terminal.

## How to get to it (user POV)

- Press `c` anywhere outside a text field (team list, project page, cycle page, triage page).
- The pencil button beside the search icon at the top of the sidebar.
- Drafts page (`G` then `D`) to reopen a draft.
- Terminal: `baseline issue create "Title" -t CORE …`.

## Driving it with drive.mjs and vb

Preconditions:

- A fresh run that passes `vb doctor <run>`.
- No issue titled with the `Verify:` prefix exists yet (true in a fresh run).

- **C, title, ⌘↵ (journey).** Run `drive.mjs <run> eval /team/CORE/all .claude/skills/verify-baseline/journeys/create-issue.js --name create-issue-C`. It presses `c`, checks `.cm-root` shows `CORE` and `Create issue`, types the title, presses ⌘↵, then confirms the issue in `/api/bootstrap`, in the CORE list, and on `/issue/<key>`. It returns `{ title, key, listedInTeamList: true }`, and the screenshot shows the issue page with the "Issue created" toast.
- **Second view from the CLI.** Run `vb cli <run> issue show <key> --json`. Exit 0, with the same title and state `Todo`.
- **Modal contents, Create more, drafts, context prefill, pills.** Run `drive.mjs <run> harness create --name create-section`. Rows `2.1`–`2.4` and `2.7` print `PASS`.
- **CLI entry.** Run `vb cli <run> issue create "Verify: created from CLI" -t CORE -p high --json`. Exit 0, and stdout has `"key": "CORE-<n>"`, `"priority": "High"`, `"state": "Todo"`.
- **CLI write, UI read.** Run `drive.mjs <run> shot /team/CORE/all --name create-cli-in-list`. The screenshot lists `Verify: created from CLI`.

## Gotchas

- Harness rows `2.5` and `2.6` (attach files) always fail: file attachments were removed on purpose in commit `3cd386d`. Do not count them as regressions, and do not report attachments as verified.
- Pressing `c` while a text field has focus types the letter. The harness `t.press` dispatches to the focused element, so call `await t.closeAll()` first when chaining.
- With Create more on, the modal stays open after ⌘↵. A journey that expects it to close must leave Create more off.
- New issues are unassigned by default and land in the team's first unstarted state (`Todo`).

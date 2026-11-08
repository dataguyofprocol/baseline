# Work an issue

On an issue's page a user changes status, priority, assignee and labels with single-key menus, discusses it in comment threads, subscribes, and sees one activity timeline. The CLI changes the same fields and posts comments under an agent's name.

## Sub-features

- `issue-menus` S P A L ⇧D ⇧E ⇧C ⇧P ⇧M ⌘⇧P ⌘⇧M ⇧H and M then B/X/R/M open their menus.
- `issue-quick` I assigns to me, ⇧S subscribes, ⌥F favorites, ⇧R focuses the comment box, ⌘⇧O creates a sub-issue.
- `issue-pick` property menus have a filter field; number keys pick an option.
- `issue-undo` ⌘Z undoes a property change.
- `issue-comments` post, react, reply, resolve, edit and delete comments.
- `issue-move` move to another team (⌘⇧M) gives a new key and the page follows.
- `issue-cli` `issue update`, `issue comment`, `issue show` from the terminal.

## How to get to it (user POV)

- Open any issue from a list (Enter on a focused row, or click), or go to `#/issue/CORE-4`.
- J/K steps through the list the issue was opened from.
- Terminal: `baseline issue update CORE-4 -s Done`, `baseline issue comment CORE-4 "text" --as "Claude Code"`.

## Driving it with drive.mjs and vb

Preconditions:

- A fresh run that passes `vb doctor <run>`. `CORE-4` and `CORE-5` exist with seed values.

- **All issue-page journeys.** Run `drive.mjs <run> harness issue --name issue-section`. Rows `4.1`–`4.19` print `PASS`, including `4.2` "16 menus open" and `4.6` "posted, reacted, replied, resolved, edit offered, deleted".
- **Undo.** Run `drive.mjs <run> harness shell --name shell-section` and check row `1.10` reads `priority a→b→a`.
- **CLI update, UI read.** Run `vb cli <run> issue update CORE-4 -s "In Progress" -p low`, then `drive.mjs <run> shot /issue/CORE-4 --name issue-cli-update`. The screenshot's property rail shows `In Progress` and `Low`, and the activity timeline records the change.
- **CLI comment as an agent.** Run `vb cli <run> issue comment CORE-4 "Verify: from the CLI" --as "Claude Code"`, then `vb cli <run> issue show CORE-4 --json`. The comments include that body by `Claude Code`.

## Gotchas

- Row `4.6` (comment threads) has failed intermittently in past runs and passed when re-run alone (`JOURNEYS.md`). Re-run the `issue` section once before you call it a regression, and report the flake.
- Shortcut menus act on the open issue only. On a project page, S must not open an issue menu (row `1.12`).
- Row `4.11` moves an issue to `AGO`, so `CORE` keys shift for rows that run after it. Use a fresh run when a recipe needs a specific seed key.
